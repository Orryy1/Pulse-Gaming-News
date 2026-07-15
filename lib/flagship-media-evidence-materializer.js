"use strict";

const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const fs = require("fs-extra");

const execFileAsync = promisify(execFile);
const SCHEMA_VERSION = 1;
const FFMPEG_EXECUTABLE = "ffmpeg";
const FFPROBE_EXECUTABLE = "ffprobe";
const FLAGSHIP_FINAL_VIDEO_PROFILE = Object.freeze({
  container: "mp4",
  width: 1080,
  height: 1920,
  aspect_ratio: "9:16",
  video_codec: "h264",
  audio_codec: "aac",
  audio_sample_rate_hz: 48000,
  require_audio: true,
});
const SHA256_RE = /^[a-f0-9]{64}$/;
const ACCEPTABLE_RIGHTS_VERDICTS = new Set(["APPROVED", "CLEARED", "GREEN", "PASS", "PASSED"]);
const TRUSTED_GENERATION_PRODUCER_IDS = new Set(["pulse-gaming-flagship-renderer"]);
const APPROVED_ISO_BMFF_BRANDS = new Set(["avc1", "iso2", "isom", "mp41", "mp42"]);
const MEDIA_EXTENSIONS = new Set([
  ".aac", ".flac", ".gif", ".jpeg", ".jpg", ".m4a", ".m4v", ".mkv",
  ".mov", ".mp3", ".mp4", ".ogg", ".opus", ".png", ".wav", ".webm", ".webp",
]);
const trustedRenderInputContexts = new WeakMap();

function clean(value) {
  return String(value || "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function isPlaceholder(value) {
  const normalised = clean(value).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if ([
    "n/a", "na", "none", "not applicable", "not provided", "pending", "placeholder",
    "tbd", "todo", "unknown", "unspecified",
  ].includes(normalised)) return true;
  return /\b(?:unknown|tbd|todo|pending|placeholder|unspecified)\b/.test(normalised) ||
    /\b(?:not applicable|not provided)\b/.test(normalised);
}

function normaliseSha256(value) {
  const hash = clean(value).replace(/^sha256:/i, "").toLowerCase();
  return SHA256_RE.test(hash) ? hash : "";
}

function normalisePathForComparison(value) {
  return path.resolve(value).replace(/\\/g, "/").toLowerCase();
}

function pathIsWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function canonicalDestination(destination) {
  let existingAncestor = path.resolve(destination);
  const missingSegments = [];
  while (!(await fs.pathExists(existingAncestor))) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  const canonicalAncestor = await realpath(existingAncestor);
  return path.resolve(canonicalAncestor, ...missingSegments);
}

async function assertOutputOutsidePackage(outputDir, packageDir) {
  const resolvedOutput = path.resolve(outputDir);
  if (pathIsWithin(resolvedOutput, packageDir)) {
    throw new Error("flagship media evidence output must be outside the immutable package directory");
  }
  const canonicalOutput = await canonicalDestination(resolvedOutput);
  if (pathIsWithin(canonicalOutput, packageDir)) {
    throw new Error("flagship media evidence output must be outside the immutable package directory");
  }
  return resolvedOutput;
}

function realpath(filePath) {
  return fs.realpath(filePath);
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function inspectPackageFile(packageDir, declaredPath, label) {
  const blockers = [];
  const declared = clean(declaredPath);
  const result = {
    declared_path: declared || null,
    path: null,
    relative_path: null,
    exists: false,
    non_empty: false,
    bytes: 0,
    sha256: null,
    blockers,
  };
  if (!declared) {
    blockers.push(`${label}_path_missing`);
    return result;
  }
  if (declared.split(/[\\/]+/).includes("..")) {
    blockers.push(`${label}_path_traversal`);
    return result;
  }
  const resolved = path.isAbsolute(declared)
    ? path.resolve(declared)
    : path.resolve(packageDir, declared);
  if (!pathIsWithin(resolved, packageDir)) {
    blockers.push(`${label}_path_outside_package`);
    return result;
  }
  result.path = resolved;
  result.relative_path = path.relative(packageDir, resolved).replace(/\\/g, "/");
  try {
    const canonical = await realpath(resolved);
    if (!pathIsWithin(canonical, packageDir)) {
      blockers.push(`${label}_symlink_escape`);
      return result;
    }
    const stat = await fs.stat(canonical);
    if (!stat.isFile()) {
      blockers.push(`${label}_not_file`);
      return result;
    }
    result.path = canonical;
    result.exists = true;
    result.bytes = stat.size;
    result.non_empty = stat.size > 0;
    if (!result.non_empty) {
      blockers.push(`${label}_empty`);
      return result;
    }
    result.sha256 = await sha256File(canonical);
  } catch {
    blockers.push(`${label}_missing`);
  }
  return result;
}

function mediaExtension(filePath) {
  return path.extname(clean(filePath)).toLowerCase();
}

function shouldProbeMedia(asset, filePath) {
  const declaredType = clean(asset?.media_type || asset?.type || asset?.kind).toLowerCase();
  return MEDIA_EXTENSIONS.has(mediaExtension(filePath)) || [
    "audio", "backdrop", "footage", "generated_card", "image", "music", "sfx", "video",
  ].includes(declaredType);
}

async function defaultProbeMedia(filePath) {
  const { stdout } = await execFileAsync(FFPROBE_EXECUTABLE, [
    "-v", "error",
    "-show_format",
    "-show_streams",
    "-of", "json",
    filePath,
  ], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30000,
    windowsHide: true,
  });
  return JSON.parse(stdout);
}

async function defaultDecodeMedia(filePath, {
  metadata = {},
} = {}) {
  const streams = asArray(metadata.streams);
  const hasVideo = streams.some((stream) => stream.codec_type === "video");
  const hasAudio = streams.some((stream) => stream.codec_type === "audio");
  const args = [
    "-nostdin", "-hide_banner", "-v", "error", "-xerror",
    "-progress", "pipe:1", "-nostats", "-i", filePath,
  ];
  if (hasVideo) args.push("-map", "0:v");
  if (hasAudio) args.push("-map", "0:a");
  if (hasVideo && [".gif", ".jpeg", ".jpg", ".png", ".webp"].includes(mediaExtension(filePath))) {
    args.push("-frames:v", "1");
  }
  args.push("-f", "null", "-");
  const { stdout } = await execFileAsync(FFMPEG_EXECUTABLE, args, {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
    windowsHide: true,
  });
  const progressDurations = [...String(stdout || "").matchAll(/^out_time_us=(\d+)$/gm)]
    .map((match) => Number(match[1]) / 1e6)
    .filter(Number.isFinite);
  const decodedDuration = progressDurations.length ? Math.max(...progressDurations) : 0;
  const expectedDurations = [
    metadata.duration_seconds,
    ...streams.map((stream) => stream.duration_seconds),
  ].map(Number).filter((value) => Number.isFinite(value) && value > 0);
  const expectedDuration = expectedDurations.length ? Math.max(...expectedDurations) : null;
  const decodedStreamIndexes = streams
    .filter((stream) => stream.codec_type === "video" || stream.codec_type === "audio")
    .map((stream) => stream.index);
  const expectedStreamIndexes = streams.map((stream) => stream.index);
  const unverifiedStreamIndexes = expectedStreamIndexes.filter(
    (index) => !decodedStreamIndexes.includes(index),
  );
  const durationTolerance = expectedDuration === null ? 0 : Math.max(0.05, expectedDuration * 0.01);
  const durationComplete = expectedDuration === null || decodedDuration + durationTolerance >= expectedDuration;
  return {
    fully_decoded: durationComplete && unverifiedStreamIndexes.length === 0,
    errors: [],
    decoded_duration_seconds: decodedDuration,
    expected_duration_seconds: expectedDuration,
    decoded_stream_indexes: decodedStreamIndexes,
    expected_stream_indexes: expectedStreamIndexes,
    unverified_stream_indexes: unverifiedStreamIndexes,
    duration_tolerance_seconds: durationTolerance,
  };
}

function technicalMetadata(probe = {}) {
  const format = asObject(probe.format);
  const formatTags = asObject(format.tags);
  return {
    duration_seconds: Number.isFinite(Number(format.duration)) ? Number(format.duration) : null,
    format_name: clean(format.format_name) || null,
    format_long_name: clean(format.format_long_name) || null,
    bit_rate: Number.isFinite(Number(format.bit_rate)) ? Number(format.bit_rate) : null,
    probe_size_bytes: Number.isFinite(Number(format.size)) ? Number(format.size) : null,
    major_brand: clean(formatTags.major_brand) || null,
    compatible_brands: clean(formatTags.compatible_brands) || null,
    streams: asArray(probe.streams).map((stream) => ({
      index: Number.isInteger(Number(stream.index)) ? Number(stream.index) : null,
      codec_type: clean(stream.codec_type) || null,
      codec_name: clean(stream.codec_name) || null,
      codec_long_name: clean(stream.codec_long_name) || null,
      width: Number.isFinite(Number(stream.width)) ? Number(stream.width) : null,
      height: Number.isFinite(Number(stream.height)) ? Number(stream.height) : null,
      sample_rate: Number.isFinite(Number(stream.sample_rate)) ? Number(stream.sample_rate) : null,
      channels: Number.isFinite(Number(stream.channels)) ? Number(stream.channels) : null,
      channel_layout: clean(stream.channel_layout) || null,
      frame_rate: clean(stream.avg_frame_rate || stream.r_frame_rate) || null,
      duration_seconds: Number.isFinite(Number(stream.duration)) ? Number(stream.duration) : null,
      frame_count: Number.isInteger(Number(stream.nb_frames)) ? Number(stream.nb_frames) : null,
    })),
  };
}

async function inspectIsoBmffContainer(filePath) {
  const handle = await fsp.open(filePath, "r");
  try {
    const header = Buffer.alloc(32);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const boxSize = bytesRead >= 4 ? header.readUInt32BE(0) : 0;
    const boxType = bytesRead >= 8 ? header.toString("ascii", 4, 8) : "";
    const majorBrand = bytesRead >= 12 ? header.toString("ascii", 8, 12) : "";
    return {
      ftyp_present: boxType === "ftyp" && boxSize >= 16,
      major_brand: majorBrand || null,
      approved_brand: APPROVED_ISO_BMFF_BRANDS.has(majorBrand),
    };
  } finally {
    await handle.close();
  }
}

function bigintStatField(stat, field, fallbackField) {
  if (typeof stat[field] === "bigint") return stat[field].toString();
  const fallback = Number(stat[fallbackField]);
  return Number.isFinite(fallback) ? String(Math.trunc(fallback * 1e6)) : null;
}

async function criticalFileSnapshot(filePath) {
  const canonicalPath = await realpath(filePath);
  const statBeforeHash = await fsp.stat(canonicalPath, { bigint: true });
  if (!statBeforeHash.isFile()) throw new Error("critical media path is not a file");
  const sha256 = await sha256File(canonicalPath);
  const statAfterHash = await fsp.stat(canonicalPath, { bigint: true });
  const before = {
    device: statBeforeHash.dev.toString(),
    inode: statBeforeHash.ino.toString(),
    size_bytes: statBeforeHash.size.toString(),
    mtime_ns: bigintStatField(statBeforeHash, "mtimeNs", "mtimeMs"),
    ctime_ns: bigintStatField(statBeforeHash, "ctimeNs", "ctimeMs"),
  };
  const after = {
    device: statAfterHash.dev.toString(),
    inode: statAfterHash.ino.toString(),
    size_bytes: statAfterHash.size.toString(),
    mtime_ns: bigintStatField(statAfterHash, "mtimeNs", "mtimeMs"),
    ctime_ns: bigintStatField(statAfterHash, "ctimeNs", "ctimeMs"),
  };
  return {
    canonical_path: canonicalPath,
    ...after,
    sha256,
    stable_during_hash: JSON.stringify(before) === JSON.stringify(after),
  };
}

function criticalSnapshotsMatch(left, right) {
  if (!left || !right || left.stable_during_hash !== true || right.stable_during_hash !== true) {
    return false;
  }
  return [
    "canonical_path", "device", "inode", "size_bytes", "mtime_ns", "ctime_ns", "sha256",
  ].every((field) => left[field] === right[field]);
}

async function probeInspectedFile(
  inspected,
  label,
  expectedStreamType,
  probeMedia,
  decodeMedia,
) {
  if (!inspected.exists || !inspected.non_empty) {
    return {
      readable: false,
      metadata: null,
      verification_identity_stable: false,
      verification_snapshots: null,
      blockers: [],
    };
  }
  const blockers = [];
  const snapshots = {};
  let snapshotFailed = false;
  const capture = async (stage) => {
    try {
      snapshots[stage] = await criticalFileSnapshot(inspected.path);
      return snapshots[stage];
    } catch {
      snapshotFailed = true;
      blockers.push(`critical_file_snapshot_failed:${label}:${stage}`);
      snapshots[stage] = null;
      return null;
    }
  };

  const beforeProbe = await capture("before_probe");
  let metadata = null;
  let probeError = null;
  let hasExpectedStream = false;
  try {
    const raw = await probeMedia(inspected.path);
    metadata = technicalMetadata(raw);
    hasExpectedStream = expectedStreamType
      ? metadata.streams.some((stream) => stream.codec_type === expectedStreamType)
      : metadata.streams.length > 0;
    if (!hasExpectedStream) {
      blockers.push(`media_stream_missing:${label}:${expectedStreamType || "media"}`);
    }
  } catch (error) {
    probeError = clean(error?.message) || "ffprobe failed";
    blockers.push(`media_unreadable:${label}`);
  }
  const afterProbe = await capture("after_probe");

  let decodeVerified = false;
  let decodeError = null;
  let decodeEvidence = null;
  let beforeDecode = null;
  let afterDecode = null;
  if (!probeError && hasExpectedStream) {
    beforeDecode = await capture("before_decode");
    try {
      const decode = await decodeMedia(inspected.path, {
        expectedStreamType,
        metadata,
      });
      const decodeErrors = asArray(decode?.errors);
      decodeEvidence = {
        fully_decoded: decode?.fully_decoded === true,
        errors: decodeErrors,
        decoded_duration_seconds: Number.isFinite(Number(decode?.decoded_duration_seconds))
          ? Number(decode.decoded_duration_seconds)
          : null,
        expected_duration_seconds: Number.isFinite(Number(decode?.expected_duration_seconds))
          ? Number(decode.expected_duration_seconds)
          : null,
        decoded_stream_indexes: Array.isArray(decode?.decoded_stream_indexes)
          ? decode.decoded_stream_indexes.filter((index) => Number.isInteger(index))
          : [],
        expected_stream_indexes: Array.isArray(decode?.expected_stream_indexes)
          ? decode.expected_stream_indexes.filter((index) => Number.isInteger(index))
          : [],
        unverified_stream_indexes: Array.isArray(decode?.unverified_stream_indexes)
          ? decode.unverified_stream_indexes.filter((index) => Number.isInteger(index))
          : [],
        duration_tolerance_seconds: Number.isFinite(Number(decode?.duration_tolerance_seconds))
          ? Number(decode.duration_tolerance_seconds)
          : null,
      };
      if (decodeErrors.length) {
        throw new Error(decodeErrors.join("; "));
      }
      if (decode?.fully_decoded !== true) {
        decodeError = "decoder did not cover every probed stream and duration";
        blockers.push(`media_decode_incomplete:${label}`);
      } else {
        decodeVerified = true;
      }
    } catch (error) {
      decodeError = clean(error?.message) || "ffmpeg decode failed";
      blockers.push(`media_decode_failed:${label}`);
    }
    afterDecode = await capture("after_decode");
  }

  const initiallyMatched = Boolean(
    beforeProbe &&
    beforeProbe.sha256 === inspected.sha256 &&
    beforeProbe.size_bytes === String(inspected.bytes),
  );
  const probeStable = criticalSnapshotsMatch(beforeProbe, afterProbe);
  const decodeStable = !beforeDecode || (
    criticalSnapshotsMatch(afterProbe, beforeDecode) &&
    criticalSnapshotsMatch(beforeDecode, afterDecode)
  );
  const verificationIdentityStable = !snapshotFailed && initiallyMatched && probeStable && decodeStable;
  if (!verificationIdentityStable) {
    blockers.push(`critical_file_mutated_during_media_verification:${label}`);
  }

  return {
    readable: !probeError && hasExpectedStream,
    metadata,
    error: probeError,
    decode_verified: decodeVerified,
    decode_error: decodeError,
    decode_evidence: decodeEvidence,
    verification_identity_stable: verificationIdentityStable,
    verification_snapshots: snapshots,
    blockers: unique(blockers),
  };
}

function descriptorForFinalOutput(inventory, key) {
  const outputs = asObject(inventory.final_outputs || inventory.final_media || inventory.outputs);
  const aliases = {
    video: ["video", "final_video", "final_mp4", "media"],
    audio: ["audio", "final_audio", "narration", "narration_audio"],
    script: ["script", "final_script", "transcript"],
    timestamps: ["timestamps", "word_timestamps", "timestamp_manifest"],
    captions: ["captions", "caption", "caption_manifest", "subtitles"],
  }[key];
  for (const alias of aliases) {
    const value = outputs[alias] ?? inventory[alias];
    if (typeof value === "string") return { path: value };
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  }
  return {};
}

function descriptorPath(descriptor) {
  return descriptor.path || descriptor.file_path || descriptor.local_path || descriptor.output_path || descriptor.file;
}

function descriptorHash(descriptor) {
  return descriptor.sha256 || descriptor.hash || descriptor.file_sha256 || descriptor.asset_sha256;
}

function flattenUsedAssets(inventory) {
  const roots = asArray(inventory.used_assets || inventory.assets || inventory.used_asset_inventory);
  const rightsRecords = asArray(
    inventory.records || inventory.rights_records || inventory.rights_ledger,
  );
  const flattened = [];
  function visit(asset, parentAssetId = null, nested = false) {
    const assetId = clean(asset.asset_id || asset.id || asset.asset_identity || asset.identity);
    const matchedRightsRecords = rightsRecords.filter((record) => (
      clean(record.asset_id || record.id || record.asset_identity || record.identity) === assetId
    ));
    const matchedRights = matchedRightsRecords.length === 1 ? matchedRightsRecords[0] : {};
    const mergedAsset = {
      ...asset,
      ...matchedRights,
      path: descriptorPath(asset) || descriptorPath(matchedRights),
      nested_backdrops: asset.nested_backdrops,
      backdrops: asset.backdrops,
      generated_card: asset.generated_card,
    };
    flattened.push({
      asset: mergedAsset,
      assetId,
      parentAssetId,
      nested,
      rightsRecordMatched: matchedRightsRecords.length === 1,
      duplicateRightsRecord: matchedRightsRecords.length > 1,
    });
    const nestedRows = [
      ...asArray(asset.nested_backdrops),
      ...asArray(asset.backdrops),
      ...asArray(asset.generated_card?.backdrops),
    ];
    for (const child of nestedRows) visit(child, assetId || null, true);
  }
  for (const asset of roots) visit(asset);
  return flattened;
}

function sourceUrlFor(asset) {
  return clean(asset.source_url || asset.source?.url || asset.origin_url);
}

function creatorFor(asset) {
  return clean(
    asset.creator || asset.source_owner || asset.owner ||
    asset.source?.creator || asset.source?.owner || asset.rights?.creator,
  );
}

function licenceBasisFor(asset) {
  return clean(
    asset.licence_basis || asset.license_basis || asset.licence || asset.license ||
    asset.rights?.licence_basis || asset.rights?.license_basis,
  );
}

function evidencePathFor(asset) {
  return clean(
    asset.evidence_file || asset.evidence_path || asset.rights_evidence_path ||
    asset.licence_evidence || asset.license_evidence || asset.permission_evidence ||
    asset.rights?.evidence_file || asset.rights?.evidence_path,
  );
}

function allowedPlatformsFor(asset) {
  return unique(asArray(asset.allowed_platforms || asset.platforms || asset.rights?.allowed_platforms).map(clean));
}

function rightsVerdictFor(asset) {
  return clean(
    asset.rights_verdict || asset.rights_status || asset.approval_status ||
    asset.rights?.verdict || asset.rights?.status,
  ).toUpperCase();
}

function commercialUseAllowedFor(asset) {
  return asset.commercial_use_allowed === true || asset.rights?.commercial_use_allowed === true;
}

function assetClassFor(asset, nested) {
  if (nested) return "nested_backdrop";
  const kind = clean(asset.kind || asset.type || asset.media_type).toLowerCase();
  return kind === "generated_card" || asset.generated === true ? "generated_card" : "used_asset";
}

function validSourceUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol && (parsed.hostname || parsed.protocol === "file:"));
  } catch {
    return false;
  }
}

function firstDefined(values) {
  return values.find((value) => value !== undefined && value !== null);
}

function scalarStringField(values) {
  const raw = firstDefined(values);
  return {
    raw,
    structureInvalid: raw !== undefined && typeof raw !== "string",
    value: typeof raw === "string" ? clean(raw) : "",
  };
}

function sourceRightsLedgerRows(document) {
  return [
    ...asArray(document.records),
    ...asArray(document.assets),
    ...asArray(document.matched_assets),
    ...asArray(document.rights_ledger),
  ].filter((row) => row && typeof row === "object" && !Array.isArray(row));
}

function sourceRightsVerdictAcceptable(asset) {
  const verdict = rightsVerdictFor(asset);
  if (ACCEPTABLE_RIGHTS_VERDICTS.has(verdict)) return true;
  const tokens = verdict
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .split("_")
    .filter(Boolean);
  const negative = new Set([
    "red", "reject", "rejected", "deny", "denied", "block", "blocked",
    "fail", "failed", "restricted", "prohibited", "not", "unapproved",
  ]);
  if (tokens.some((token) => negative.has(token))) return false;
  return tokens.some((token) => ["green", "pass", "passed", "approve", "approved"].includes(token));
}

function sourceRightsRecordMatchesExpected(record, expected) {
  const platforms = allowedPlatformsFor(record).sort();
  return sourceUrlFor(record) === expected.sourceUrl &&
    creatorFor(record) === expected.creator &&
    licenceBasisFor(record) === expected.licenceBasis &&
    commercialUseAllowedFor(record) &&
    sourceRightsVerdictAcceptable(record) &&
    canonicalJson(platforms) === canonicalJson([...expected.allowedPlatforms].sort());
}

function generatedCardLineageFor(value) {
  const lineage = asObject(value);
  return asArray(lineage.source_assets || lineage.inputs || lineage.backdrops)
    .map((row) => ({
      asset_id: clean(row?.asset_id || row?.id),
      sha256: normaliseSha256(row?.sha256 || row?.asset_sha256),
    }))
    .filter((row) => row.asset_id || row.sha256)
    .sort((left, right) => left.asset_id.localeCompare(right.asset_id));
}

async function inspectSourceRightsLedger({ packageDir, evidenceFile, document, expected }) {
  const blockers = [];
  const declaredPath = clean(document.source_ledger_path);
  const declaredLedgerHash = normaliseSha256(document.source_ledger_sha256);
  const declaredRecordHash = normaliseSha256(document.source_record_sha256);
  if (!declaredPath || !declaredLedgerHash || !declaredRecordHash) {
    blockers.push("used_asset_evidence_source_ledger_binding_missing");
  }
  if (declaredPath && isPlaceholder(declaredPath)) {
    blockers.push("used_asset_evidence_source_ledger_path_placeholder");
  }
  const file = await inspectPackageFile(
    packageDir,
    declaredPath,
    "used_asset_evidence_source_ledger_file",
  );
  blockers.push(...file.blockers);
  if (
    file.path && evidenceFile.path &&
    normalisePathForComparison(file.path) === normalisePathForComparison(evidenceFile.path)
  ) {
    blockers.push("used_asset_evidence_source_ledger_not_distinct");
  }
  if (file.sha256 && declaredLedgerHash && file.sha256 !== declaredLedgerHash) {
    blockers.push("used_asset_evidence_source_ledger_hash_mismatch");
  }

  let ledger = null;
  if (file.exists && file.non_empty) {
    try {
      const parsed = await fs.readJson(file.path);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ledger = parsed;
    } catch {
      // The explicit JSON blocker below is the public evidence result.
    }
  }
  if (file.exists && file.non_empty && !ledger) {
    blockers.push("used_asset_evidence_source_ledger_json_invalid");
  }
  let matchedRecords = [];
  if (ledger) {
    const ledgerVerdict = clean(ledger.verdict || ledger.result || ledger.status).toUpperCase();
    if (!ACCEPTABLE_RIGHTS_VERDICTS.has(ledgerVerdict)) {
      blockers.push("used_asset_evidence_source_ledger_verdict_unacceptable");
    }
    if (asArray(ledger.blockers).length || asArray(ledger.failures).length) {
      blockers.push("used_asset_evidence_source_ledger_has_blockers");
    }
    matchedRecords = sourceRightsLedgerRows(ledger).filter((record) => (
      clean(record.asset_id || record.id || record.asset_identity || record.identity) === expected.assetId
    ));
    if (!matchedRecords.length) {
      blockers.push("used_asset_evidence_source_record_missing");
    } else if (matchedRecords.length > 1) {
      blockers.push("used_asset_evidence_source_record_duplicate");
    } else {
      if (sha256Text(canonicalJson(matchedRecords)) !== declaredRecordHash) {
        blockers.push("used_asset_evidence_source_record_hash_mismatch");
      }
      if (!sourceRightsRecordMatchesExpected(matchedRecords[0], expected)) {
        blockers.push("used_asset_evidence_source_record_mismatch");
      }
    }
  }
  return {
    verified: blockers.length === 0,
    path: file.path,
    relative_path: file.relative_path,
    sha256: file.sha256,
    declared_sha256: declaredLedgerHash || null,
    declared_record_sha256: declaredRecordHash || null,
    matched_record_count: matchedRecords.length,
    generated_card_lineage: generatedCardLineageFor(
      matchedRecords[0]?.generated_card_lineage,
    ),
    blockers: unique(blockers),
  };
}

async function inspectRightsEvidence(file, expected) {
  const blockers = [];
  if (!file.exists || !file.non_empty) {
    return {
      substantive: false,
      format: null,
      binding_verified: false,
      bound_asset_id: null,
      source_ledger: null,
      generated_card_lineage: [],
      blockers,
    };
  }
  let document = null;
  try {
    const parsed = JSON.parse(await fs.readFile(file.path, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) document = parsed;
  } catch {
    // The explicit JSON blocker below is the public evidence result.
  }
  if (!document) {
    blockers.push("used_asset_evidence_json_required");
    blockers.push("used_asset_evidence_binding_incomplete");
    return {
      substantive: false,
      format: "text",
      binding_verified: false,
      bound_asset_id: null,
      source_ledger: null,
      generated_card_lineage: [],
      blockers,
    };
  }
  const assetId = clean(document.asset_id);
  const assetHash = normaliseSha256(document.asset_sha256 || document.sha256);
  const sourceUrl = clean(document.source_url);
  const creator = clean(document.creator);
  const licenceBasis = clean(
    document.licence_basis || document.license_basis || document.permission_basis || document.permission,
  );
  const verdict = clean(document.rights_verdict || document.verdict).toUpperCase();
  const platforms = unique(asArray(document.allowed_platforms).map(clean)).sort();
  const expectedPlatforms = [...expected.allowedPlatforms].sort();
  if (document.schema_version !== 1) blockers.push("used_asset_evidence_schema_invalid");
  if (assetId !== expected.assetId) blockers.push("used_asset_evidence_asset_id_mismatch");
  if (!assetHash || assetHash !== expected.assetSha256) blockers.push("used_asset_evidence_asset_hash_mismatch");
  if (sourceUrl !== expected.sourceUrl) blockers.push("used_asset_evidence_source_mismatch");
  if (creator !== expected.creator) blockers.push("used_asset_evidence_creator_mismatch");
  if (licenceBasis !== expected.licenceBasis) blockers.push("used_asset_evidence_licence_mismatch");
  if (document.commercial_use_allowed !== true) {
    blockers.push("used_asset_evidence_commercial_entitlement_missing");
  }
  if (!ACCEPTABLE_RIGHTS_VERDICTS.has(verdict)) {
    blockers.push("used_asset_evidence_rights_verdict_unacceptable");
  }
  if (canonicalJson(platforms) !== canonicalJson(expectedPlatforms)) {
    blockers.push("used_asset_evidence_platforms_mismatch");
  }
  const sourceLedger = await inspectSourceRightsLedger({
    packageDir: expected.packageDir,
    evidenceFile: file,
    document,
    expected,
  });
  blockers.push(...sourceLedger.blockers);
  if (blockers.length) blockers.push("used_asset_evidence_binding_incomplete");
  return {
    substantive: blockers.length === 0,
    format: "json",
    binding_verified: blockers.length === 0,
    bound_asset_id: assetId || null,
    source_ledger: sourceLedger,
    generated_card_lineage: generatedCardLineageFor(document.generated_card_lineage),
    blockers: unique(blockers),
  };
}

async function inspectUsedAsset(row, packageDir, options) {
  const {
    asset,
    assetId,
    parentAssetId,
    nested,
    rightsRecordMatched,
    duplicateRightsRecord,
  } = row;
  const safeId = assetId || `row_${options.rowIndex + 1}`;
  const blockers = [];
  if (!assetId) blockers.push(`used_asset_identity_missing:${safeId}`);
  if (options.duplicateIds.has(assetId) && assetId) blockers.push(`used_asset_identity_duplicate:${assetId}`);
  if (duplicateRightsRecord) blockers.push(`used_asset_rights_record_duplicate:${safeId}`);

  const file = await inspectPackageFile(packageDir, descriptorPath(asset), "used_asset_file");
  blockers.push(...file.blockers.map((blocker) => `${blocker}:${safeId}`));
  const declaredHash = clean(descriptorHash(asset));
  if (declaredHash && !normaliseSha256(declaredHash)) blockers.push(`used_asset_hash_invalid:${safeId}`);
  else if (declaredHash && file.sha256 && normaliseSha256(declaredHash) !== file.sha256) {
    blockers.push(`used_asset_hash_mismatch:${safeId}`);
  }

  const sourceField = scalarStringField([
    asset.source_url, asset.source?.url, asset.origin_url,
  ]);
  const creatorField = scalarStringField([
    asset.creator, asset.source_owner, asset.owner,
    asset.source?.creator, asset.source?.owner, asset.rights?.creator,
  ]);
  const licenceField = scalarStringField([
    asset.licence_basis, asset.license_basis, asset.licence, asset.license,
    asset.rights?.licence_basis, asset.rights?.license_basis,
  ]);
  const evidenceField = scalarStringField([
    asset.evidence_file, asset.evidence_path, asset.rights_evidence_path,
    asset.licence_evidence, asset.license_evidence, asset.permission_evidence,
    asset.rights?.evidence_file, asset.rights?.evidence_path,
  ]);
  const platformRaw = firstDefined([
    asset.allowed_platforms, asset.platforms, asset.rights?.allowed_platforms,
  ]);
  const platformStructureInvalid = platformRaw !== undefined && (
    !Array.isArray(platformRaw) || platformRaw.some((value) => typeof value !== "string")
  );
  const allowedPlatforms = platformStructureInvalid
    ? []
    : unique(asArray(platformRaw).map(clean));
  const verdictField = scalarStringField([
    asset.rights_verdict, asset.rights_status, asset.approval_status,
    asset.rights?.verdict, asset.rights?.status,
  ]);
  const sourceUrl = sourceField.value;
  const creator = creatorField.value;
  const licenceBasis = licenceField.value;
  const rightsVerdict = verdictField.value.toUpperCase();
  const commercialUseAllowed = commercialUseAllowedFor(asset);
  const assertedRightsPass = ACCEPTABLE_RIGHTS_VERDICTS.has(rightsVerdict);
  if (
    assertedRightsPass &&
    (!sourceUrl || !creator || !licenceBasis || !evidencePathFor(asset) || !allowedPlatforms.length)
  ) {
    blockers.push(`bare_rights_pass_rejected:${safeId}`);
  }
  if (sourceField.structureInvalid) blockers.push(`used_asset_source_url_structure_invalid:${safeId}`);
  if (!sourceUrl) blockers.push(`used_asset_source_url_missing:${safeId}`);
  else if (isPlaceholder(sourceUrl)) blockers.push(`used_asset_source_url_placeholder:${safeId}`);
  else if (!validSourceUrl(sourceUrl)) blockers.push(`used_asset_source_url_invalid:${safeId}`);
  if (creatorField.structureInvalid) blockers.push(`used_asset_creator_structure_invalid:${safeId}`);
  if (!creator) blockers.push(`used_asset_creator_missing:${safeId}`);
  else if (isPlaceholder(creator)) blockers.push(`used_asset_creator_placeholder:${safeId}`);
  if (licenceField.structureInvalid) blockers.push(`used_asset_licence_basis_structure_invalid:${safeId}`);
  if (!licenceBasis) blockers.push(`used_asset_licence_basis_missing:${safeId}`);
  else if (isPlaceholder(licenceBasis)) blockers.push(`used_asset_licence_basis_placeholder:${safeId}`);
  if (platformStructureInvalid) blockers.push(`used_asset_allowed_platforms_structure_invalid:${safeId}`);
  if (!allowedPlatforms.length) blockers.push(`used_asset_allowed_platforms_missing:${safeId}`);
  else if (allowedPlatforms.some(isPlaceholder)) {
    blockers.push(`used_asset_allowed_platforms_placeholder:${safeId}`);
  }
  if (!commercialUseAllowed) blockers.push(`used_asset_commercial_use_not_allowed:${safeId}`);
  if (verdictField.structureInvalid) blockers.push(`used_asset_rights_verdict_structure_invalid:${safeId}`);
  if (!rightsVerdict) blockers.push(`used_asset_rights_verdict_missing:${safeId}`);
  else if (isPlaceholder(rightsVerdict) || !ACCEPTABLE_RIGHTS_VERDICTS.has(rightsVerdict)) {
    blockers.push(`used_asset_rights_verdict_unacceptable:${safeId}`);
  }
  if (evidenceField.structureInvalid) blockers.push(`used_asset_evidence_file_structure_invalid:${safeId}`);
  if (isPlaceholder(evidenceField.value)) {
    blockers.push(`used_asset_evidence_file_placeholder:${safeId}`);
  }

  const evidenceFile = await inspectPackageFile(
    packageDir,
    evidenceField.value,
    "used_asset_evidence_file",
  );
  blockers.push(...evidenceFile.blockers.map((blocker) => `${blocker}:${safeId}`));
  const evidenceContent = await inspectRightsEvidence(evidenceFile, {
    packageDir,
    assetId,
    assetSha256: file.sha256,
    sourceUrl,
    creator,
    licenceBasis,
    allowedPlatforms,
  });
  blockers.push(...evidenceContent.blockers.map((blocker) => `${blocker}:${safeId}`));
  if (evidenceFile.exists && evidenceFile.non_empty && !evidenceContent.substantive) {
    blockers.push(`used_asset_evidence_not_substantive:${safeId}`);
  }

  let media = { readable: null, metadata: null, blockers: [] };
  if (shouldProbeMedia(asset, file.path || descriptorPath(asset))) {
    media = await probeInspectedFile(
      file,
      `used_asset:${safeId}`,
      null,
      options.probeMedia,
      options.decodeMedia,
    );
    blockers.push(...media.blockers);
  }

  return {
    asset_id: assetId || null,
    parent_asset_id: parentAssetId,
    rights_record_matched: rightsRecordMatched,
    asset_class: assetClassFor(asset, nested),
    kind: clean(asset.kind || asset.type || asset.media_type) || null,
    path: file.path,
    relative_path: file.relative_path,
    exists: file.exists,
    non_empty: file.non_empty,
    bytes: file.bytes,
    sha256: file.sha256,
    source_url: sourceUrl || null,
    creator: creator || null,
    licence_basis: licenceBasis || null,
    commercial_use_allowed: commercialUseAllowed,
    rights_verdict: rightsVerdict || null,
    evidence_file: {
      path: evidenceFile.path,
      relative_path: evidenceFile.relative_path,
      exists: evidenceFile.exists,
      non_empty: evidenceFile.non_empty,
      bytes: evidenceFile.bytes,
      sha256: evidenceFile.sha256,
      substantive: evidenceContent.substantive,
      format: evidenceContent.format,
      binding_verified: evidenceContent.binding_verified,
      bound_asset_id: evidenceContent.bound_asset_id,
      source_ledger: evidenceContent.source_ledger,
      generated_card_lineage: evidenceContent.generated_card_lineage,
    },
    allowed_platforms: allowedPlatforms,
    technical_metadata: media.metadata,
    probe_error: media.error || null,
    decode_verified: media.decode_verified === true,
    decode_error: media.decode_error || null,
    decode_evidence: media.decode_evidence || null,
    verification_identity_stable: media.verification_identity_stable === true,
    verification_snapshots: media.verification_snapshots || null,
    verified: blockers.length === 0,
    blockers: unique(blockers),
  };
}

async function inspectTimestampDocument(inspected) {
  const blockers = [];
  if (!inspected.exists || !inspected.non_empty) {
    return { document: {}, words: [], valid: false, blockers };
  }
  if (mediaExtension(inspected.path) !== ".json") {
    blockers.push("word_timestamps_json_required");
    return { document: {}, words: [], valid: false, blockers };
  }
  let document;
  try {
    document = asObject(await fs.readJson(inspected.path));
  } catch {
    blockers.push("word_timestamps_json_invalid");
    return { document: {}, words: [], valid: false, blockers };
  }
  if (document.complete !== true) blockers.push("word_timestamps_complete_not_true");
  const words = Array.isArray(document.words) ? document.words : [];
  if (!words.length) blockers.push("word_timestamps_words_missing");
  let previousEnd = 0;
  words.forEach((row, index) => {
    const ordinal = index + 1;
    const word = clean(row?.word);
    const start = row?.start;
    const end = row?.end;
    if (!word) blockers.push(`word_timestamp_word_missing:${ordinal}`);
    if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) {
      blockers.push(`word_timestamp_non_finite:${ordinal}`);
      return;
    }
    if (start < 0 || end <= start) blockers.push(`word_timestamp_range_invalid:${ordinal}`);
    if (index > 0 && start < previousEnd) blockers.push(`word_timestamps_non_monotonic:${ordinal}`);
    previousEnd = Math.max(previousEnd, end);
  });
  return { document, words, valid: blockers.length === 0, blockers };
}

function captionTimeSeconds(value) {
  const match = clean(value).match(/^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);
  if (minutes > 59 || seconds > 59) return null;
  return (hours * 3600) + (minutes * 60) + seconds + (milliseconds / 1000);
}

function timedTextCues(contents) {
  const cues = [];
  const blocks = String(contents || "").replace(/^\uFEFF/, "").split(/\r?\n\s*\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((line) => line.trim());
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [rawStart, rawEndWithSettings] = lines[timingIndex].split(/\s+-->\s+/);
    const rawEnd = clean(rawEndWithSettings).split(/\s+/)[0];
    cues.push({
      start: captionTimeSeconds(rawStart),
      end: captionTimeSeconds(rawEnd),
      text: lines.slice(timingIndex + 1).join(" ").trim(),
    });
  }
  return cues;
}

async function inspectCaptionContent(inspected) {
  const blockers = [];
  if (!inspected.exists || !inspected.non_empty) {
    return { valid: false, cueCount: 0, cues: [], blockers };
  }
  const extension = mediaExtension(inspected.path);
  let cues = [];
  try {
    if (extension === ".srt" || extension === ".vtt") {
      cues = timedTextCues(await fs.readFile(inspected.path, "utf8"));
    } else if (extension === ".json") {
      const document = asObject(await fs.readJson(inspected.path));
      const rows = asArray(document.cues || document.captions || document.chunks || document.subtitles);
      cues = rows.map((row) => ({
        start: row.start ?? row.start_seconds,
        end: row.end ?? row.end_seconds,
        text: clean(row.text || row.caption),
      }));
    } else {
      blockers.push("captions_format_unsupported");
    }
  } catch {
    blockers.push("captions_content_unparseable");
  }
  if (!cues.length && !blockers.includes("captions_content_unparseable")) {
    blockers.push("captions_content_unparseable");
  }
  let previousStart = 0;
  cues.forEach((cue, index) => {
    const ordinal = index + 1;
    if (
      typeof cue.start !== "number" || typeof cue.end !== "number" ||
      !Number.isFinite(cue.start) || !Number.isFinite(cue.end) ||
      cue.start < 0 || cue.end <= cue.start || !/[a-z0-9]/i.test(clean(cue.text))
    ) {
      blockers.push(`caption_cue_invalid:${ordinal}`);
      return;
    }
    if (index > 0 && cue.start < previousStart) blockers.push(`caption_cues_non_monotonic:${ordinal}`);
    previousStart = cue.start;
  });
  return { valid: blockers.length === 0, cueCount: cues.length, cues, blockers };
}

function declaredTimestampAudioHash(inventory, descriptor, timestampDocument) {
  const bindings = asObject(inventory.bindings || inventory.hash_bindings);
  return normaliseSha256(
    descriptor.audio_sha256 || descriptor.final_audio_sha256 ||
    timestampDocument.audio_sha256 || timestampDocument.final_audio_sha256 ||
    timestampDocument.bindings?.audio_sha256 ||
    bindings.timestamp_audio_sha256 || bindings.word_timestamps_audio_sha256,
  );
}

function declaredCaptionBindings(inventory, descriptor) {
  const bindings = asObject(inventory.bindings || inventory.hash_bindings);
  return {
    final_video: clean(
      descriptor.final_video_sha256 || descriptor.video_sha256 ||
      bindings.caption_final_video_sha256 || bindings.captions_final_video_sha256,
    ).replace(/^sha256:/i, "").toLowerCase(),
    final_audio: clean(
      descriptor.final_audio_sha256 || descriptor.audio_sha256 ||
      bindings.caption_final_audio_sha256 || bindings.captions_final_audio_sha256,
    ).replace(/^sha256:/i, "").toLowerCase(),
    word_timestamps: clean(
      descriptor.word_timestamps_sha256 || descriptor.timestamps_sha256 ||
      bindings.caption_word_timestamps_sha256 || bindings.captions_word_timestamps_sha256,
    ).replace(/^sha256:/i, "").toLowerCase(),
    script: clean(
      descriptor.script_sha256 || descriptor.final_script_sha256 ||
      bindings.caption_script_sha256 || bindings.captions_script_sha256,
    ).replace(/^sha256:/i, "").toLowerCase(),
  };
}

function verifyDeclaredBinding(name, declared, actual) {
  if (!declared) return { verified: false, blocker: `binding_missing:${name}` };
  if (!SHA256_RE.test(declared)) return { verified: false, blocker: `binding_invalid:${name}` };
  if (!actual || declared !== actual) return { verified: false, blocker: `binding_mismatch:${name}` };
  return { verified: true, blocker: null };
}

function parseAspectRatio(value) {
  const match = clean(value).match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

function validateFinalVideoContract(inventory, finalVideo) {
  const contract = asObject(
    inventory.episode_contract?.final_video ||
    inventory.media_contract?.final_video ||
    inventory.episode_contract?.media,
  );
  const blockers = [];
  const metadata = asObject(finalVideo?.technical_metadata);
  const streams = asArray(metadata.streams);
  const video = streams.find((stream) => stream.codec_type === "video") || null;
  const audio = streams.find((stream) => stream.codec_type === "audio") || null;
  const formatNames = clean(metadata.format_name).toLowerCase().split(",").map((value) => value.trim());
  if (!formatNames.some((value) => value === "mp4" || value === "mov")) {
    blockers.push("final_video_container_not_mp4_or_quicktime");
  }
  if (!(Number(metadata.duration_seconds) > 0)) blockers.push("final_video_duration_not_positive");
  const signature = asObject(finalVideo?.container_signature);
  const rawProbeBrand = clean(metadata.major_brand);
  const probeBrand = rawProbeBrand ? rawProbeBrand.padEnd(4, " ").slice(0, 4) : "";
  if (
    !formatNames.includes("mp4") ||
    mediaExtension(finalVideo?.path) !== ".mp4" ||
    signature.ftyp_present !== true ||
    signature.approved_brand !== true
  ) {
    blockers.push("final_video_container_not_mp4");
  }
  if (
    signature.ftyp_present !== true ||
    signature.approved_brand !== true ||
    (probeBrand && signature.major_brand !== probeBrand) ||
    ![".mov", ".mp4"].includes(mediaExtension(finalVideo?.path))
  ) {
    blockers.push("final_video_brand_not_mp4_or_quicktime");
  }

  const expectedWidth = Number(contract.width);
  const expectedHeight = Number(contract.height);
  const expectedAspect = parseAspectRatio(contract.aspect_ratio);
  if (!Number.isInteger(expectedWidth) || expectedWidth <= 0) {
    blockers.push("episode_contract_final_video_width_invalid");
  }
  if (!Number.isInteger(expectedHeight) || expectedHeight <= 0) {
    blockers.push("episode_contract_final_video_height_invalid");
  }
  if (!expectedAspect) blockers.push("episode_contract_final_video_aspect_invalid");
  if (expectedWidth !== FLAGSHIP_FINAL_VIDEO_PROFILE.width) {
    blockers.push("episode_contract_final_video_width_must_be_1080");
  }
  if (expectedHeight !== FLAGSHIP_FINAL_VIDEO_PROFILE.height) {
    blockers.push("episode_contract_final_video_height_must_be_1920");
  }
  if (clean(contract.aspect_ratio) !== FLAGSHIP_FINAL_VIDEO_PROFILE.aspect_ratio) {
    blockers.push("episode_contract_final_video_aspect_must_be_9_16");
  }
  if (!video) {
    blockers.push("final_video_video_stream_missing");
  } else {
    if (clean(video.codec_name).toLowerCase() !== "h264") {
      blockers.push("final_video_video_codec_not_h264");
    }
    if (Number(video.width) !== FLAGSHIP_FINAL_VIDEO_PROFILE.width) {
      blockers.push("final_video_width_mismatch");
    }
    if (Number(video.height) !== FLAGSHIP_FINAL_VIDEO_PROFILE.height) {
      blockers.push("final_video_height_mismatch");
    }
    if (
      Number(video.width) > 0 && Number(video.height) > 0 &&
      Math.abs(
        (Number(video.width) / Number(video.height)) -
        parseAspectRatio(FLAGSHIP_FINAL_VIDEO_PROFILE.aspect_ratio)
      ) > 0.001
    ) {
      blockers.push("final_video_aspect_ratio_mismatch");
    }
  }

  const expectedVideoCodec = clean(contract.video_codec).toLowerCase();
  if (expectedVideoCodec !== "h264") blockers.push("episode_contract_video_codec_must_be_h264");
  if (contract.require_audio !== true) blockers.push("episode_contract_audio_stream_requirement_missing");
  const expectedAudioCodec = clean(contract.audio_codec).toLowerCase();
  const expectedSampleRate = Number(contract.audio_sample_rate_hz || contract.audio_sample_rate);
  if (!expectedAudioCodec || isPlaceholder(expectedAudioCodec)) {
    blockers.push("episode_contract_audio_codec_invalid");
  }
  if (!Number.isInteger(expectedSampleRate) || expectedSampleRate <= 0) {
    blockers.push("episode_contract_audio_sample_rate_invalid");
  }
  if (expectedAudioCodec !== FLAGSHIP_FINAL_VIDEO_PROFILE.audio_codec) {
    blockers.push("episode_contract_audio_codec_must_be_aac");
  }
  if (expectedSampleRate !== FLAGSHIP_FINAL_VIDEO_PROFILE.audio_sample_rate_hz) {
    blockers.push("episode_contract_audio_sample_rate_must_be_48000");
  }
  if (!audio) {
    blockers.push("final_video_audio_stream_missing");
  } else {
    if (clean(audio.codec_name).toLowerCase() !== FLAGSHIP_FINAL_VIDEO_PROFILE.audio_codec) {
      blockers.push("final_video_audio_codec_not_aac");
    }
    if (expectedAudioCodec && clean(audio.codec_name).toLowerCase() !== expectedAudioCodec) {
      blockers.push("final_video_audio_codec_mismatch");
    }
    if (Number(audio.sample_rate) !== FLAGSHIP_FINAL_VIDEO_PROFILE.audio_sample_rate_hz) {
      blockers.push("final_video_audio_sample_rate_not_48000");
    }
    if (Number.isInteger(expectedSampleRate) && Number(audio.sample_rate) !== expectedSampleRate) {
      blockers.push("final_video_audio_sample_rate_mismatch");
    }
  }
  return {
    verified: blockers.length === 0,
    contract: { ...FLAGSHIP_FINAL_VIDEO_PROFILE, audio_required: true },
    blockers,
  };
}

function validateFinalMediaDurations(finalVideo, finalAudio) {
  const blockers = [];
  const videoStreams = asArray(finalVideo?.technical_metadata?.streams);
  const audioStreams = asArray(finalAudio?.technical_metadata?.streams);
  const finalVideoDuration = Number(
    videoStreams.find((stream) => stream.codec_type === "video")?.duration_seconds,
  );
  const embeddedAudioDuration = Number(
    videoStreams.find((stream) => stream.codec_type === "audio")?.duration_seconds,
  );
  const finalAudioDuration = Number(
    audioStreams.find((stream) => stream.codec_type === "audio")?.duration_seconds,
  );
  if (!(finalVideoDuration > 0)) blockers.push("final_video_stream_duration_invalid");
  if (!(embeddedAudioDuration > 0)) blockers.push("final_video_audio_stream_duration_invalid");
  if (!(finalAudioDuration > 0)) blockers.push("final_audio_duration_invalid");
  const toleranceSeconds = 0.1;
  if (
    finalVideoDuration > 0 && embeddedAudioDuration > 0 &&
    Math.abs(finalVideoDuration - embeddedAudioDuration) > toleranceSeconds
  ) {
    blockers.push("final_video_stream_duration_mismatch");
  }
  if (
    finalVideoDuration > 0 && finalAudioDuration > 0 &&
    Math.abs(finalVideoDuration - finalAudioDuration) > toleranceSeconds
  ) {
    blockers.push("final_audio_video_duration_mismatch");
  }
  return {
    verified: blockers.length === 0,
    final_video_seconds: finalVideoDuration > 0 ? finalVideoDuration : null,
    embedded_audio_seconds: embeddedAudioDuration > 0 ? embeddedAudioDuration : null,
    final_audio_seconds: finalAudioDuration > 0 ? finalAudioDuration : null,
    tolerance_seconds: toleranceSeconds,
    blockers,
  };
}

function lexicalTokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9']+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function spokenScriptTokens(value) {
  const currencyNames = {
    "$": "dollars",
    "£": "pounds",
    "€": "euros",
  };
  const spoken = String(value || "").replace(
    /([$£€])(\d[\d,]*)(?:\.(\d{1,2}))?/g,
    (_match, symbol, whole, fractional) => [
      String(whole).replace(/,/g, ""),
      currencyNames[symbol],
      fractional || "",
    ].filter(Boolean).join(" "),
  );
  return lexicalTokens(spoken);
}

function validateTimedCoverage(rows, durationSeconds, {
  beginBlocker,
  boundsBlocker,
  coverageBlocker,
} = {}) {
  const blockers = [];
  const duration = Number(durationSeconds);
  const validRows = asArray(rows).filter((row) => (
    typeof row?.start === "number" && typeof row?.end === "number" &&
    Number.isFinite(row.start) && Number.isFinite(row.end) && row.end > row.start
  ));
  if (!(duration > 0) || !validRows.length) return { blockers, coverageRatio: 0 };
  const firstStart = Math.min(...validRows.map((row) => row.start));
  const lastEnd = Math.max(...validRows.map((row) => row.end));
  const tolerance = Math.max(0.05, duration * 0.01);
  if (firstStart > Math.min(0.5, duration * 0.25)) blockers.push(beginBlocker);
  if (lastEnd > duration + tolerance) blockers.push(boundsBlocker);
  const intervals = validRows
    .map((row) => ({
      start: Math.min(duration, Math.max(0, row.start)),
      end: Math.min(duration, Math.max(0, row.end)),
    }))
    .filter((row) => row.end > row.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let coveredSeconds = 0;
  let mergedStart = null;
  let mergedEnd = null;
  for (const interval of intervals) {
    if (mergedStart === null) {
      mergedStart = interval.start;
      mergedEnd = interval.end;
    } else if (interval.start <= mergedEnd) {
      mergedEnd = Math.max(mergedEnd, interval.end);
    } else {
      coveredSeconds += mergedEnd - mergedStart;
      mergedStart = interval.start;
      mergedEnd = interval.end;
    }
  }
  if (mergedStart !== null) coveredSeconds += mergedEnd - mergedStart;
  const coverageRatio = Number((coveredSeconds / duration).toFixed(6));
  if (coverageRatio < 0.8) blockers.push(coverageBlocker);
  return { blockers, coverageRatio };
}

function sameTokenSequence(left, right) {
  return left.length > 0 && left.length === right.length && left.every((token, index) => token === right[index]);
}

function generationManifestDescriptor(inventory) {
  const value = inventory.generation_manifest || inventory.generation_manifest_path;
  if (typeof value === "string") return { path: value };
  return asObject(value);
}

function normaliseRelativePath(value) {
  return clean(value).replace(/\\/g, "/").replace(/^\.\//, "");
}

async function inspectTrustedGenerationManifest({
  packageDir,
  inventory,
  finals,
  timestampDocument,
}) {
  const blockers = [];
  const descriptor = generationManifestDescriptor(inventory);
  if (!descriptorPath(descriptor)) {
    return {
      verified: false,
      blockers: ["trusted_generation_manifest_missing"],
      file: null,
      producer_id: null,
      run_id: null,
    };
  }
  const file = await inspectPackageFile(packageDir, descriptorPath(descriptor), "generation_manifest_file");
  if (!file.exists || !file.non_empty) blockers.push("trusted_generation_manifest_missing");
  let document = {};
  if (file.exists && file.non_empty) {
    try {
      document = asObject(await fs.readJson(file.path));
    } catch {
      blockers.push("trusted_generation_manifest_json_invalid");
    }
  }
  const producerId = clean(document.producer_id);
  const runId = clean(document.run_id);
  const timestampRunId = clean(timestampDocument?.flagship_generation_run_id);
  if (document.schema_version !== 1) blockers.push("trusted_generation_manifest_schema_invalid");
  if (document.complete !== true) blockers.push("trusted_generation_manifest_incomplete");
  if (!TRUSTED_GENERATION_PRODUCER_IDS.has(producerId)) {
    blockers.push("trusted_generation_manifest_producer_untrusted");
  }
  if (isPlaceholder(runId) || !/^[a-z0-9][a-z0-9._:-]{7,}$/i.test(runId)) {
    blockers.push("trusted_generation_manifest_run_id_invalid");
  }
  if (!timestampRunId) {
    blockers.push("trusted_generation_manifest_timestamp_run_binding_missing");
  } else if (timestampRunId !== runId) {
    blockers.push("trusted_generation_manifest_timestamp_run_binding_mismatch");
  }
  const scriptHash = finals.script?.sha256 || "";
  if (normaliseSha256(document.script_sha256) !== scriptHash) {
    blockers.push("trusted_generation_manifest_script_hash_mismatch");
  }
  const artifacts = asObject(document.artifacts);
  for (const key of ["final_video", "final_audio", "word_timestamps", "captions", "script"]) {
    const row = asObject(artifacts[key]);
    const actual = finals[key];
    if (!Object.keys(row).length) {
      blockers.push(`trusted_generation_manifest_artifact_missing:${key}`);
      continue;
    }
    if (normaliseRelativePath(row.path) !== normaliseRelativePath(actual?.relative_path)) {
      blockers.push(`trusted_generation_manifest_artifact_path_mismatch:${key}`);
    }
    if (normaliseSha256(row.sha256) !== actual?.sha256) {
      blockers.push(`trusted_generation_manifest_artifact_hash_mismatch:${key}`);
    }
    if (clean(row.run_id) !== runId) {
      blockers.push(`trusted_generation_manifest_artifact_run_mismatch:${key}`);
    }
    if (normaliseSha256(row.script_sha256) !== scriptHash) {
      blockers.push(`trusted_generation_manifest_artifact_script_mismatch:${key}`);
    }
  }
  return {
    verified: blockers.length === 0,
    blockers: unique(blockers),
    file: file.exists ? {
      path: file.path,
      relative_path: file.relative_path,
      bytes: file.bytes,
      sha256: file.sha256,
    } : null,
    producer_id: producerId || null,
    run_id: runId || null,
    timestamp_run_id: timestampRunId || null,
  };
}

async function packageSnapshot(packageDir) {
  const rows = [];
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile()) {
        const stat = await fs.stat(target);
        rows.push({
          path: path.relative(packageDir, target).replace(/\\/g, "/"),
          bytes: stat.size,
          sha256: await sha256File(target),
        });
      } else if (entry.isSymbolicLink()) {
        rows.push({ path: path.relative(packageDir, target).replace(/\\/g, "/"), symlink: true });
      }
    }
  }
  await walk(packageDir);
  const canonical = JSON.stringify(rows);
  return {
    file_count: rows.length,
    sha256: crypto.createHash("sha256").update(canonical).digest("hex"),
  };
}

async function createTrustedRenderInputInventory({ packageDir, inventory } = {}) {
  if (!clean(packageDir)) throw new Error("createTrustedRenderInputInventory requires packageDir");
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) {
    throw new Error("createTrustedRenderInputInventory requires an explicit inventory object");
  }
  const resolvedPackageDir = await realpath(path.resolve(packageDir));
  const finalConfig = [
    ["video", "final_video"],
    ["audio", "final_audio"],
    ["script", "script"],
    ["timestamps", "word_timestamps"],
    ["captions", "captions"],
  ];
  const entries = {};
  for (const [inventoryKey, reportKey] of finalConfig) {
    const descriptor = descriptorForFinalOutput(inventory, inventoryKey);
    const file = await inspectPackageFile(
      resolvedPackageDir,
      descriptorPath(descriptor),
      `trusted_render_input_${reportKey}`,
    );
    entries[reportKey] = {
      relative_path: file.relative_path,
      exists: file.exists,
      non_empty: file.non_empty,
      bytes: file.bytes,
      sha256: file.sha256,
    };
  }
  const inventoryDigest = sha256Text(canonicalJson(inventory));
  const packageState = await packageSnapshot(resolvedPackageDir);
  const inputDigest = sha256Text(canonicalJson(entries));
  const token = Object.freeze({
    schema_version: 1,
    run_id: crypto.randomUUID(),
    input_digest: inputDigest,
    entry_count: Object.keys(entries).length,
  });
  trustedRenderInputContexts.set(token, {
    consumed: false,
    created_at_ms: Date.now(),
    package_dir: resolvedPackageDir,
    package_snapshot_sha256: packageState.sha256,
    inventory_digest: inventoryDigest,
    input_digest: inputDigest,
    entries,
    run_id: token.run_id,
  });
  return token;
}

function verifyTrustedRenderInputs({
  context,
  preflightBlocker,
  packageDir,
  inventory,
  packageState,
  finals,
}) {
  const blockers = [];
  if (preflightBlocker) blockers.push(preflightBlocker);
  if (context) {
    if (context.package_dir !== packageDir) blockers.push("trusted_render_input_package_mismatch");
    if (context.inventory_digest !== sha256Text(canonicalJson(inventory))) {
      blockers.push("trusted_render_input_inventory_digest_mismatch");
    }
    if (context.package_snapshot_sha256 !== packageState.sha256) {
      blockers.push("trusted_render_input_package_snapshot_mismatch");
    }
    if (Date.now() - context.created_at_ms > 5 * 60 * 1000) {
      blockers.push("trusted_render_input_inventory_stale");
    }
    for (const key of ["final_video", "final_audio", "script", "word_timestamps", "captions"]) {
      const expected = asObject(context.entries[key]);
      const actual = asObject(finals[key]);
      if (expected.exists !== true || expected.non_empty !== true) {
        blockers.push(`trusted_render_input_missing:${key}`);
      }
      if (expected.relative_path !== actual.relative_path) {
        blockers.push(`trusted_render_input_path_mismatch:${key}`);
      }
      if (expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256) {
        blockers.push(`trusted_render_input_hash_mismatch:${key}`);
      }
    }
  }
  return {
    verified: Boolean(context) && blockers.length === 0,
    run_id: context?.run_id || null,
    input_digest: context?.input_digest || null,
    inventory_digest: context?.inventory_digest || null,
    package_snapshot_sha256: context?.package_snapshot_sha256 || null,
    entry_count: context ? Object.keys(context.entries).length : 0,
    blockers: unique(blockers),
  };
}

function renderFlagshipMediaEvidenceSummary(report = {}) {
  const lines = [
    "# Flagship Media Evidence",
    "",
    `Story: ${report.story_id || "unknown"}`,
    `Generated: ${report.generated_at || "unknown"}`,
    `Mode: ${report.mode || "LOCAL_PROOF"}`,
    `Verdict: ${report.verdict || "RED"}`,
    `Complete: ${report.complete === true ? "yes" : "no"}`,
    `Publish ready: no`,
    `Human AV signoff: ${report.human_av_signoff?.status || "NOT_PERFORMED"}`,
    "",
    "## Verification",
    `- final artefacts: ${report.summary?.verified_final_output_count || 0}/${report.summary?.final_output_count || 0}`,
    `- used assets: ${report.summary?.verified_used_asset_count || 0}/${report.summary?.used_asset_count || 0}`,
    `- generated cards: ${report.summary?.generated_card_count || 0}`,
    `- nested backdrops: ${report.summary?.nested_backdrop_count || 0}`,
    `- package unchanged: ${report.package_immutability?.unchanged === true ? "yes" : "no"}`,
    "",
    "## Blockers",
    ...(asArray(report.blockers).length ? report.blockers.map((blocker) => `- ${blocker}`) : ["- none"]),
    "",
    "## Safety",
    "Local proof only. No publishing, database mutation, token/OAuth mutation or human AV attestation occurred.",
  ];
  return `${lines.join("\n")}\n`;
}

async function writeFlagshipMediaEvidence(report, { outputDir, packageDir }) {
  if (!clean(outputDir)) throw new Error("writeFlagshipMediaEvidence requires outputDir");
  const resolvedOutput = await assertOutputOutsidePackage(outputDir, packageDir);
  await fs.ensureDir(resolvedOutput);
  const jsonPath = path.join(resolvedOutput, "flagship_media_evidence.json");
  const markdownPath = path.join(resolvedOutput, "flagship_media_evidence_summary.md");
  const targets = [jsonPath, markdownPath];
  for (const target of targets) {
    if (await fs.pathExists(target)) {
      throw new Error(`proof output leaf must be fresh: ${target}`);
    }
  }

  const committed = [];
  const atomicWriteFresh = async (target, contents) => {
    const tempPath = path.join(
      resolvedOutput,
      `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(12).toString("hex")}.tmp`,
    );
    let handle = null;
    try {
      handle = await fsp.open(tempPath, "wx", 0o600);
      await handle.writeFile(contents, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.link(tempPath, target);
      committed.push(target);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.remove(tempPath).catch(() => {});
    }
  };

  try {
    await atomicWriteFresh(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    await atomicWriteFresh(markdownPath, renderFlagshipMediaEvidenceSummary(report));
  } catch (error) {
    for (const target of committed) await fs.unlink(target).catch(() => {});
    if (error?.code === "EEXIST") {
      throw new Error(`proof output leaf must be fresh: ${error.path || "output leaf"}`);
    }
    throw error;
  }
  return { output_dir: resolvedOutput, json_path: jsonPath, markdown_path: markdownPath };
}

async function materializeFlagshipMediaEvidenceInternal({
  packageDir,
  inventory,
  outputDir,
  generatedAt = new Date().toISOString(),
  trustedRenderInputContext = null,
  trustedRenderInputPreflightBlocker = null,
} = {}) {
  if (!clean(packageDir)) throw new Error("materializeFlagshipMediaEvidence requires packageDir");
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) {
    throw new Error("materializeFlagshipMediaEvidence requires an explicit inventory object");
  }
  if (!clean(outputDir)) throw new Error("materializeFlagshipMediaEvidence requires outputDir");
  const resolvedPackageDir = await realpath(path.resolve(packageDir));
  const packageStat = await fs.stat(resolvedPackageDir);
  if (!packageStat.isDirectory()) throw new Error("packageDir must be a directory");
  const resolvedOutputDir = path.resolve(outputDir);
  await assertOutputOutsidePackage(resolvedOutputDir, resolvedPackageDir);

  const snapshotBefore = await packageSnapshot(resolvedPackageDir);
  const blockers = [];
  const upstreamInventoryVerdict = clean(inventory.verdict || inventory.status).toUpperCase();
  if (inventory.complete !== true) blockers.push("upstream_inventory_not_complete");
  if (upstreamInventoryVerdict !== "GREEN") {
    blockers.push(
      upstreamInventoryVerdict
        ? `upstream_inventory_verdict_${upstreamInventoryVerdict.toLowerCase()}`
        : "upstream_inventory_verdict_missing",
    );
  }
  blockers.push(
    ...asArray(inventory.blockers)
      .map(clean)
      .filter(Boolean)
      .map((blocker) => `upstream_inventory_blocker:${blocker}`),
  );
  const finalOutputConfig = [
    ["video", "final_video", "video"],
    ["audio", "final_audio", "audio"],
    ["script", "script", null],
    ["timestamps", "word_timestamps", null],
    ["captions", "captions", null],
  ];
  const finals = {};
  const descriptors = {};
  for (const [key, reportKey, expectedStreamType] of finalOutputConfig) {
    const descriptor = descriptorForFinalOutput(inventory, key);
    descriptors[key] = descriptor;
    const file = await inspectPackageFile(resolvedPackageDir, descriptorPath(descriptor), `${reportKey}_file`);
    const itemBlockers = [...file.blockers];
    const declaredHash = clean(descriptorHash(descriptor));
    if (declaredHash && !normaliseSha256(declaredHash)) itemBlockers.push(`${reportKey}_hash_invalid`);
    else if (declaredHash && file.sha256 && normaliseSha256(declaredHash) !== file.sha256) {
      itemBlockers.push(`${reportKey}_hash_mismatch`);
    }
    let media = { readable: null, metadata: null, blockers: [] };
    if (expectedStreamType) {
      media = await probeInspectedFile(
        file,
        reportKey,
        expectedStreamType,
        defaultProbeMedia,
        defaultDecodeMedia,
      );
      itemBlockers.push(...media.blockers);
    }
    finals[reportKey] = {
      path: file.path,
      relative_path: file.relative_path,
      exists: file.exists,
      non_empty: file.non_empty,
      bytes: file.bytes,
      sha256: file.sha256,
      technical_metadata: media.metadata,
      media_readable: media.readable,
      probe_error: media.error || null,
      decode_verified: media.decode_verified === true,
      decode_error: media.decode_error || null,
      decode_evidence: media.decode_evidence || null,
      verification_identity_stable: media.verification_identity_stable === true,
      verification_snapshots: media.verification_snapshots || null,
      verified: itemBlockers.length === 0,
      blockers: unique(itemBlockers),
    };
    blockers.push(...itemBlockers);
  }

  const trustedRenderInputs = verifyTrustedRenderInputs({
    context: trustedRenderInputContext,
    preflightBlocker: trustedRenderInputPreflightBlocker,
    packageDir: resolvedPackageDir,
    inventory,
    packageState: snapshotBefore,
    finals,
  });
  blockers.push(...trustedRenderInputs.blockers);

  try {
    finals.final_video.container_signature = await inspectIsoBmffContainer(finals.final_video.path);
  } catch {
    finals.final_video.container_signature = {
      ftyp_present: false,
      major_brand: null,
      approved_brand: false,
    };
  }
  const finalVideoContract = validateFinalVideoContract(inventory, finals.final_video);
  finals.final_video.contract = finalVideoContract.contract;
  finals.final_video.contract_verified = finalVideoContract.verified;
  finals.final_video.blockers.push(...finalVideoContract.blockers);
  if (!finalVideoContract.verified) finals.final_video.verified = false;
  blockers.push(...finalVideoContract.blockers);
  const finalMediaDurations = validateFinalMediaDurations(finals.final_video, finals.final_audio);
  finals.final_video.duration_evidence = finalMediaDurations;
  finals.final_audio.duration_evidence = finalMediaDurations;
  finals.final_video.blockers.push(...finalMediaDurations.blockers);
  finals.final_audio.blockers.push(...finalMediaDurations.blockers);
  if (!finalMediaDurations.verified) {
    finals.final_video.verified = false;
    finals.final_audio.verified = false;
  }
  blockers.push(...finalMediaDurations.blockers);

  let scriptText = "";
  if (finals.script.exists && finals.script.non_empty) {
    try {
      scriptText = await fs.readFile(finals.script.path, "utf8");
    } catch {
      blockers.push("final_script_unreadable");
      finals.script.blockers.push("final_script_unreadable");
      finals.script.verified = false;
    }
  }
  const scriptTokens = lexicalTokens(scriptText);
  if (!scriptTokens.length) {
    blockers.push("final_script_content_not_meaningful");
    finals.script.blockers.push("final_script_content_not_meaningful");
    finals.script.verified = false;
  }

  const timestampInspection = await inspectTimestampDocument(finals.word_timestamps);
  const timestampDocument = timestampInspection.document;
  finals.word_timestamps.content_valid = timestampInspection.valid;
  finals.word_timestamps.blockers.push(...timestampInspection.blockers);
  if (timestampInspection.blockers.length) finals.word_timestamps.verified = false;
  blockers.push(...timestampInspection.blockers);
  const captionContent = await inspectCaptionContent(finals.captions);
  finals.captions.content_valid = captionContent.valid;
  finals.captions.cue_count = captionContent.cueCount;
  finals.captions.blockers.push(...captionContent.blockers);
  if (captionContent.blockers.length) finals.captions.verified = false;
  blockers.push(...captionContent.blockers);
  const timestampCoverage = validateTimedCoverage(
    timestampInspection.words,
    finalMediaDurations.final_audio_seconds,
    {
      beginBlocker: "word_timestamps_begin_too_late",
      boundsBlocker: "word_timestamps_outside_audio_duration",
      coverageBlocker: "word_timestamps_coverage_insufficient",
    },
  );
  const captionCoverage = validateTimedCoverage(
    captionContent.cues,
    finalMediaDurations.final_video_seconds,
    {
      beginBlocker: "captions_begin_too_late",
      boundsBlocker: "captions_outside_video_duration",
      coverageBlocker: "captions_coverage_insufficient",
    },
  );
  const timestampVideoCoverage = validateTimedCoverage(
    timestampInspection.words,
    finalMediaDurations.final_video_seconds,
    {
      beginBlocker: "word_timestamps_video_begin_too_late",
      boundsBlocker: "word_timestamps_outside_video_duration",
      coverageBlocker: "word_timestamps_video_coverage_insufficient",
    },
  );
  const captionAudioCoverage = validateTimedCoverage(
    captionContent.cues,
    finalMediaDurations.final_audio_seconds,
    {
      beginBlocker: "captions_audio_begin_too_late",
      boundsBlocker: "captions_outside_audio_duration",
      coverageBlocker: "captions_audio_coverage_insufficient",
    },
  );
  finals.word_timestamps.coverage_ratio = timestampCoverage.coverageRatio;
  finals.word_timestamps.video_coverage_ratio = timestampVideoCoverage.coverageRatio;
  finals.captions.coverage_ratio = captionCoverage.coverageRatio;
  finals.captions.audio_coverage_ratio = captionAudioCoverage.coverageRatio;
  finals.word_timestamps.blockers.push(
    ...timestampCoverage.blockers,
    ...timestampVideoCoverage.blockers,
  );
  finals.captions.blockers.push(...captionCoverage.blockers, ...captionAudioCoverage.blockers);
  if (timestampCoverage.blockers.length || timestampVideoCoverage.blockers.length) {
    finals.word_timestamps.verified = false;
  }
  if (captionCoverage.blockers.length || captionAudioCoverage.blockers.length) {
    finals.captions.verified = false;
  }
  blockers.push(
    ...timestampCoverage.blockers,
    ...timestampVideoCoverage.blockers,
    ...captionCoverage.blockers,
    ...captionAudioCoverage.blockers,
  );

  const timestampTokens = asArray(timestampInspection.words).flatMap((row) => lexicalTokens(row.word));
  const captionTokens = asArray(captionContent.cues).flatMap((cue) => lexicalTokens(cue.text));
  if (!sameTokenSequence(timestampTokens, spokenScriptTokens(scriptText))) {
    blockers.push("word_timestamps_current_script_mismatch");
    finals.word_timestamps.blockers.push("word_timestamps_current_script_mismatch");
    finals.word_timestamps.verified = false;
  }
  if (!sameTokenSequence(captionTokens, scriptTokens)) {
    blockers.push("captions_current_script_mismatch");
    finals.captions.blockers.push("captions_current_script_mismatch");
    finals.captions.verified = false;
  }

  const timestampAudioHash = declaredTimestampAudioHash(inventory, descriptors.timestamps, timestampDocument);
  let timestampAudioBindingVerified = false;
  let timestampBindingBlocker = null;
  if (!timestampAudioHash) timestampBindingBlocker = "binding_missing:word_timestamps_to_final_audio";
  else if (timestampAudioHash !== finals.final_audio.sha256) {
    timestampBindingBlocker = "binding_mismatch:word_timestamps_to_final_audio";
  } else timestampAudioBindingVerified = true;
  if (timestampBindingBlocker) {
    blockers.push(timestampBindingBlocker);
    finals.word_timestamps.blockers.push(timestampBindingBlocker);
    finals.word_timestamps.verified = false;
  }
  const timestampScriptBinding = verifyDeclaredBinding(
    "word_timestamps_to_script",
    clean(timestampDocument.script_sha256).replace(/^sha256:/i, "").toLowerCase(),
    finals.script.sha256,
  );
  const timestampCaptionBinding = verifyDeclaredBinding(
    "word_timestamps_to_captions",
    clean(timestampDocument.captions_sha256).replace(/^sha256:/i, "").toLowerCase(),
    finals.captions.sha256,
  );
  for (const check of [timestampScriptBinding, timestampCaptionBinding]) {
    if (!check.blocker) continue;
    blockers.push(check.blocker);
    finals.word_timestamps.blockers.push(check.blocker);
    finals.word_timestamps.verified = false;
  }
  const timestampBindingsVerified = timestampAudioBindingVerified &&
    timestampScriptBinding.verified && timestampCaptionBinding.verified;

  const captionDeclaredBindings = declaredCaptionBindings(inventory, descriptors.captions);
  const captionBindingChecks = {
    final_video: verifyDeclaredBinding(
      "captions_to_final_video",
      captionDeclaredBindings.final_video,
      finals.final_video.sha256,
    ),
    final_audio: verifyDeclaredBinding(
      "captions_to_final_audio",
      captionDeclaredBindings.final_audio,
      finals.final_audio.sha256,
    ),
    word_timestamps: verifyDeclaredBinding(
      "captions_to_word_timestamps",
      captionDeclaredBindings.word_timestamps,
      finals.word_timestamps.sha256,
    ),
    script: verifyDeclaredBinding(
      "captions_to_script",
      captionDeclaredBindings.script,
      finals.script.sha256,
    ),
  };
  const captionBindingBlockers = Object.values(captionBindingChecks)
    .map((check) => check.blocker)
    .filter(Boolean);
  const captionBindingsVerified = Object.values(captionBindingChecks)
    .every((check) => check.verified);
  blockers.push(...captionBindingBlockers);
  finals.captions.blockers.push(...captionBindingBlockers);
  if (!captionBindingsVerified) finals.captions.verified = false;

  const generationManifest = await inspectTrustedGenerationManifest({
    packageDir: resolvedPackageDir,
    inventory,
    finals,
    timestampDocument,
  });
  blockers.push(...generationManifest.blockers);

  const rows = flattenUsedAssets(inventory);
  if (!rows.length) blockers.push("used_asset_inventory_missing");
  const idCounts = new Map();
  for (const row of rows) {
    if (row.assetId) idCounts.set(row.assetId, (idCounts.get(row.assetId) || 0) + 1);
  }
  const duplicateIds = new Set([...idCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id));
  const usedAssets = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const inspected = await inspectUsedAsset(rows[rowIndex], resolvedPackageDir, {
      duplicateIds,
      rowIndex,
      probeMedia: defaultProbeMedia,
      decodeMedia: defaultDecodeMedia,
    });
    usedAssets.push(inspected);
    blockers.push(...inspected.blockers);
  }
  const expectedRightsAssetIds = usedAssets.map((asset) => asset.asset_id).filter(Boolean).sort();
  const boundRightsAssetIds = usedAssets
    .filter((asset) => asset.evidence_file.binding_verified)
    .map((asset) => asset.evidence_file.bound_asset_id)
    .filter(Boolean)
    .sort();
  const boundRightsCounts = new Map();
  boundRightsAssetIds.forEach((assetId) => {
    boundRightsCounts.set(assetId, (boundRightsCounts.get(assetId) || 0) + 1);
  });
  const duplicateRightsEvidenceIds = [...boundRightsCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([assetId]) => assetId)
    .sort();
  const missingRightsEvidenceIds = expectedRightsAssetIds
    .filter((assetId) => !boundRightsCounts.has(assetId));
  const unexpectedRightsEvidenceIds = boundRightsAssetIds
    .filter((assetId) => !expectedRightsAssetIds.includes(assetId));
  const rightsEvidenceCoverageVerified = usedAssets.length > 0 &&
    expectedRightsAssetIds.length === usedAssets.length &&
    missingRightsEvidenceIds.length === 0 &&
    unexpectedRightsEvidenceIds.length === 0 &&
    duplicateRightsEvidenceIds.length === 0;
  if (!rightsEvidenceCoverageVerified) blockers.push("rights_evidence_inventory_coverage_incomplete");
  duplicateRightsEvidenceIds.forEach((assetId) => {
    blockers.push(`rights_evidence_asset_duplicate:${assetId}`);
  });
  unexpectedRightsEvidenceIds.forEach((assetId) => {
    blockers.push(`rights_evidence_asset_unexpected:${assetId}`);
  });
  const rightsEvidenceCoverage = {
    verified: rightsEvidenceCoverageVerified,
    expected_asset_ids: expectedRightsAssetIds,
    bound_asset_ids: boundRightsAssetIds,
    missing_asset_ids: missingRightsEvidenceIds,
    unexpected_asset_ids: unique(unexpectedRightsEvidenceIds).sort(),
    duplicate_asset_ids: duplicateRightsEvidenceIds,
  };
  for (const card of usedAssets.filter((asset) => asset.asset_class === "generated_card")) {
    const backdrops = usedAssets.filter((asset) => (
      asset.asset_class === "nested_backdrop" && asset.parent_asset_id === card.asset_id
    ));
    for (const backdrop of backdrops) {
      const backdropKind = clean(backdrop.kind).toLowerCase().replace(/[-\s]+/g, "_");
      if (!["backdrop", "backdrop_still", "image", "still"].includes(backdropKind)) {
        const reason = `generated_card_backdrop_type_invalid:${backdrop.asset_id || "unknown"}`;
        backdrop.blockers = unique([...backdrop.blockers, reason]);
        backdrop.verified = false;
        blockers.push(reason);
      }
      const samePath = normalisePathForComparison(backdrop.path || "") ===
        normalisePathForComparison(card.path || "");
      const sameHash = Boolean(backdrop.sha256 && card.sha256 && backdrop.sha256 === card.sha256);
      if (samePath || sameHash) {
        const reason = `generated_card_backdrop_not_distinct:${card.asset_id || "unknown"}:${backdrop.asset_id || "unknown"}`;
        backdrop.blockers = unique([...backdrop.blockers, reason]);
        backdrop.verified = false;
        blockers.push(reason);
      }
    }
    const expectedLineage = backdrops
      .map((asset) => ({ asset_id: asset.asset_id, sha256: asset.sha256 }))
      .sort((left, right) => clean(left.asset_id).localeCompare(clean(right.asset_id)));
    const evidenceLineage = asArray(card.evidence_file.generated_card_lineage);
    const sourceLedgerLineage = asArray(
      card.evidence_file.source_ledger?.generated_card_lineage,
    );
    const evidenceBindingVerified = expectedLineage.length > 0 &&
      expectedLineage.every((row) => row.asset_id && row.sha256) &&
      canonicalJson(evidenceLineage) === canonicalJson(expectedLineage) &&
      canonicalJson(sourceLedgerLineage) === canonicalJson(expectedLineage);
    if (!evidenceBindingVerified) {
      blockers.push(`generated_card_backdrop_lineage_unbound:${card.asset_id || "unknown"}`);
    }
    const lineageVerified = backdrops.length > 0 &&
      backdrops.every((asset) => asset.verified) && evidenceBindingVerified;
    card.backdrop_lineage = {
      required: true,
      row_count: backdrops.length,
      asset_ids: backdrops.map((asset) => asset.asset_id).filter(Boolean),
      evidence_binding_verified: evidenceBindingVerified,
      verified: lineageVerified,
    };
    if (!lineageVerified) {
      const reason = backdrops.length
        ? `generated_card_backdrop_lineage_incomplete:${card.asset_id || "unknown"}`
        : `generated_card_backdrop_lineage_missing:${card.asset_id || "unknown"}`;
      card.blockers = unique([...card.blockers, reason]);
      card.verified = false;
      blockers.push(reason);
    }
  }

  const snapshotAfter = await packageSnapshot(resolvedPackageDir);
  const packageUnchanged = snapshotBefore.sha256 === snapshotAfter.sha256;
  if (!packageUnchanged) blockers.push("package_mutated_during_materialization");
  const uniqueBlockers = unique(blockers);
  const bindings = {
    final_video: {
      sha256: finals.final_video.sha256,
      bytes: finals.final_video.bytes,
    },
    final_audio: {
      sha256: finals.final_audio.sha256,
      bytes: finals.final_audio.bytes,
    },
    word_timestamps: {
      sha256: finals.word_timestamps.sha256,
      bytes: finals.word_timestamps.bytes,
      declared_audio_sha256: timestampAudioHash || null,
      final_audio_sha256: finals.final_audio.sha256,
      audio_binding_verified: timestampAudioBindingVerified,
      declared_script_sha256: clean(timestampDocument.script_sha256).replace(/^sha256:/i, "").toLowerCase() || null,
      declared_captions_sha256: clean(timestampDocument.captions_sha256).replace(/^sha256:/i, "").toLowerCase() || null,
      script_binding_verified: timestampScriptBinding.verified,
      captions_binding_verified: timestampCaptionBinding.verified,
      binding_verified: timestampBindingsVerified,
    },
    captions: {
      sha256: finals.captions.sha256,
      bytes: finals.captions.bytes,
      declared_final_video_sha256: captionDeclaredBindings.final_video || null,
      declared_final_audio_sha256: captionDeclaredBindings.final_audio || null,
      declared_word_timestamps_sha256: captionDeclaredBindings.word_timestamps || null,
      declared_script_sha256: captionDeclaredBindings.script || null,
      actual_final_video_sha256: finals.final_video.sha256,
      actual_final_audio_sha256: finals.final_audio.sha256,
      actual_word_timestamps_sha256: finals.word_timestamps.sha256,
      actual_script_sha256: finals.script.sha256,
      final_video_binding_verified: captionBindingChecks.final_video.verified,
      final_audio_binding_verified: captionBindingChecks.final_audio.verified,
      word_timestamps_binding_verified: captionBindingChecks.word_timestamps.verified,
      script_binding_verified: captionBindingChecks.script.verified,
      binding_verified: captionBindingsVerified,
    },
  };
  bindings.binding_sha256 = crypto.createHash("sha256").update(JSON.stringify(bindings)).digest("hex");

  const complete = uniqueBlockers.length === 0 &&
    Object.values(finals).every((item) => item.verified) &&
    usedAssets.length > 0 && usedAssets.every((asset) => asset.verified) &&
    timestampBindingsVerified && captionBindingsVerified && generationManifest.verified &&
    trustedRenderInputs.verified && rightsEvidenceCoverage.verified && packageUnchanged;
  const report = {
    schema_version: SCHEMA_VERSION,
    report_type: "flagship_media_evidence_materialization",
    generated_at: generatedAt,
    story_id: clean(inventory.story_id || inventory.id) || null,
    mode: "LOCAL_PROOF",
    package_dir: resolvedPackageDir,
    output_dir: resolvedOutputDir,
    complete,
    verdict: complete ? "GREEN" : "RED",
    publish_ready: false,
    blockers: uniqueBlockers,
    final_outputs: finals,
    bindings,
    generation_manifest: generationManifest,
    trusted_render_inputs: trustedRenderInputs,
    rights_evidence_coverage: rightsEvidenceCoverage,
    used_assets: usedAssets,
    duplicate_asset_identities: [...duplicateIds].sort(),
    missing_asset_identity_rows: usedAssets
      .map((asset, index) => (asset.asset_id ? null : index + 1))
      .filter(Boolean),
    missing_evidence_asset_identities: usedAssets
      .filter((asset) => !asset.evidence_file.exists || !asset.evidence_file.non_empty)
      .map((asset) => asset.asset_id)
      .filter(Boolean)
      .sort(),
    package_immutability: {
      unchanged: packageUnchanged,
      verified_after_all_writes: true,
      before: snapshotBefore,
      after: snapshotAfter,
    },
    human_av_signoff: {
      status: "NOT_PERFORMED",
      supplied_by_materializer: false,
      required_separately: true,
    },
    safety: {
      local_only: true,
      published: false,
      database_mutated: false,
      tokens_mutated: false,
      live_outputs_mutated: false,
    },
    summary: {
      final_output_count: Object.keys(finals).length,
      verified_final_output_count: Object.values(finals).filter((item) => item.verified).length,
      used_asset_count: usedAssets.length,
      verified_used_asset_count: usedAssets.filter((asset) => asset.verified).length,
      generated_card_count: usedAssets.filter((asset) => asset.asset_class === "generated_card").length,
      nested_backdrop_count: usedAssets.filter((asset) => asset.asset_class === "nested_backdrop").length,
    },
  };
  report.written = await writeFlagshipMediaEvidence(report, {
    outputDir: resolvedOutputDir,
    packageDir: resolvedPackageDir,
  });
  const snapshotAfterAllWrites = await packageSnapshot(resolvedPackageDir);
  if (snapshotAfterAllWrites.sha256 !== snapshotBefore.sha256) {
    report.complete = false;
    report.verdict = "RED";
    report.package_immutability.unchanged = false;
    report.package_immutability.verified_after_all_writes = false;
    report.package_immutability.after = snapshotAfterAllWrites;
    report.blockers = unique([...report.blockers, "package_mutated_during_proof_write"]);
    for (const proofPath of [report.written.json_path, report.written.markdown_path]) {
      await fs.unlink(proofPath).catch(() => {});
    }
    throw new Error("immutable package changed during proof output writes");
  }
  report.package_immutability.after = snapshotAfterAllWrites;
  return report;
}

async function materializeFlagshipMediaEvidence(options = {}) {
  const forbiddenVerifierOptions = ["probeMedia", "decodeMedia", "ffprobePath", "ffmpegPath"];
  if (forbiddenVerifierOptions.some((key) => Object.hasOwn(options, key))) {
    throw new Error("caller-selected verifier binaries are forbidden on the public API");
  }
  const suppliedToken = options.trustedRenderInputs;
  const trustedContext = suppliedToken && typeof suppliedToken === "object"
    ? trustedRenderInputContexts.get(suppliedToken)
    : null;
  let trustedRenderInputPreflightBlocker = null;
  if (!suppliedToken) trustedRenderInputPreflightBlocker = "trusted_render_input_inventory_missing";
  else if (!trustedContext) trustedRenderInputPreflightBlocker = "trusted_render_input_inventory_untrusted";
  else if (trustedContext.consumed) trustedRenderInputPreflightBlocker = "trusted_render_input_inventory_reused";
  if (trustedContext && !trustedContext.consumed) trustedContext.consumed = true;
  return materializeFlagshipMediaEvidenceInternal({
    packageDir: options.packageDir,
    inventory: options.inventory,
    outputDir: options.outputDir,
    generatedAt: options.generatedAt,
    trustedRenderInputContext: trustedRenderInputPreflightBlocker ? null : trustedContext,
    trustedRenderInputPreflightBlocker,
  });
}

module.exports = {
  SCHEMA_VERSION,
  createTrustedRenderInputInventory,
  materializeFlagshipMediaEvidence,
  renderFlagshipMediaEvidenceSummary,
  writeFlagshipMediaEvidence,
};

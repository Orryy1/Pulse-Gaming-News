"use strict";

const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const nativeFs = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const fsExtra = require("fs-extra");
const sharp = require("sharp");
const {
  FINAL_AV_REVIEW_ATTESTATION_KEYS,
  FINAL_AV_REVIEW_SCHEMA_VERSION,
  verifySampledFrameHashesWithFfmpeg,
} = require("./goal-final-av-review");

const execFileAsync = promisify(execFile);

const FINAL_AV_CONTACT_SHEET_FILENAME = "final_av_contact_sheet.png";
const FINAL_AV_FORENSIC_REPORT_FILENAME = "decoded_forensic_report.json";
const FINAL_AV_REVIEW_FILENAME = "final_av_review.json";
const DEFAULT_SAMPLE_COUNT = 9;
const MIN_SAMPLE_COUNT = 4;
const MAX_SAMPLE_COUNT = 24;

class FinalAvReviewPackError extends Error {
  constructor(code, message, options = {}) {
    super(`${code}: ${message}`, options);
    this.name = "FinalAvReviewPackError";
    this.code = code;
  }
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanPath(value) {
  return String(value || "").trim();
}

function pathIsWithin(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function portableRelativePath(rootPath, filePath) {
  return path.relative(rootPath, filePath).split(path.sep).join("/");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fingerprintBytes(bytes) {
  return {
    sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
    size_bytes: bytes.length,
  };
}

async function fingerprintFile(filePath) {
  const statBefore = await fs.stat(filePath);
  if (!statBefore.isFile()) {
    throw new FinalAvReviewPackError("final_mp4_unusable", "current final MP4 is not a file");
  }
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = nativeFs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  const statAfter = await fs.stat(filePath);
  if (statBefore.size !== statAfter.size || statBefore.mtimeMs !== statAfter.mtimeMs) {
    throw new FinalAvReviewPackError(
      "final_mp4_changed_during_generation",
      "current final MP4 changed while it was being fingerprinted",
    );
  }
  return {
    sha256: `sha256:${hash.digest("hex")}`,
    size_bytes: statAfter.size,
    mtime_ms: statAfter.mtimeMs,
  };
}

function fingerprintsMatch(left, right) {
  return Boolean(
    left &&
    right &&
    left.sha256 === right.sha256 &&
    left.size_bytes === right.size_bytes,
  );
}

function generatedAtIso(value) {
  const supplied = clean(value);
  const date = supplied ? new Date(supplied) : new Date();
  if (!Number.isFinite(date.getTime())) {
    throw new FinalAvReviewPackError("generated_at_invalid", "generatedAt must be a valid timestamp");
  }
  return date.toISOString();
}

function normaliseSampleCount(value) {
  const sampleCount = value === undefined ? DEFAULT_SAMPLE_COUNT : Number(value);
  if (
    !Number.isInteger(sampleCount) ||
    sampleCount < MIN_SAMPLE_COUNT ||
    sampleCount > MAX_SAMPLE_COUNT
  ) {
    throw new FinalAvReviewPackError(
      "sample_count_invalid",
      `sampleCount must be an integer between ${MIN_SAMPLE_COUNT} and ${MAX_SAMPLE_COUNT}`,
    );
  }
  return sampleCount;
}

async function canonicalDirectory(artifactDir) {
  const declared = cleanPath(artifactDir);
  if (!declared) {
    throw new FinalAvReviewPackError("story_artifact_dir_missing", "artifactDir is required");
  }
  const resolved = path.resolve(declared);
  let canonical;
  let stat;
  try {
    canonical = await fs.realpath(resolved);
    stat = await fs.stat(canonical);
  } catch (error) {
    throw new FinalAvReviewPackError(
      "story_artifact_dir_unusable",
      "story artifact directory is missing or unreadable",
      { cause: error },
    );
  }
  if (!stat.isDirectory()) {
    throw new FinalAvReviewPackError(
      "story_artifact_dir_unusable",
      "story artifact path is not a directory",
    );
  }
  return canonical;
}

async function validateMp4Signature(filePath) {
  let handle;
  try {
    handle = await fs.open(filePath, "r");
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < 8 || header.subarray(4, 8).toString("ascii") !== "ftyp") {
      throw new FinalAvReviewPackError(
        "final_mp4_invalid",
        "current final media is not an MP4 with an ftyp signature",
      );
    }
  } catch (error) {
    if (error instanceof FinalAvReviewPackError) throw error;
    throw new FinalAvReviewPackError(
      "final_mp4_unreadable",
      "current final MP4 cannot be read",
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}

async function resolveCurrentFinalMp4(artifactDir, finalMp4Path) {
  const declared = cleanPath(finalMp4Path);
  if (!declared) {
    throw new FinalAvReviewPackError("final_mp4_path_missing", "finalMp4Path is required");
  }
  const resolved = path.isAbsolute(declared)
    ? path.resolve(declared)
    : path.resolve(artifactDir, declared);
  if (!pathIsWithin(resolved, artifactDir)) {
    throw new FinalAvReviewPackError(
      "final_mp4_outside_story_dir",
      "current final MP4 must live inside the story artifact directory",
    );
  }
  let canonical;
  let stat;
  try {
    canonical = await fs.realpath(resolved);
    stat = await fs.stat(canonical);
  } catch (error) {
    throw new FinalAvReviewPackError(
      "final_mp4_unreadable",
      "current final MP4 is missing or unreadable",
      { cause: error },
    );
  }
  if (!pathIsWithin(canonical, artifactDir)) {
    throw new FinalAvReviewPackError(
      "final_mp4_symlink_escape",
      "current final MP4 resolves outside the story artifact directory",
    );
  }
  if (!stat.isFile() || path.extname(canonical).toLowerCase() !== ".mp4") {
    throw new FinalAvReviewPackError(
      "final_mp4_invalid",
      "current final media must be a regular .mp4 file",
    );
  }
  await validateMp4Signature(canonical);
  return canonical;
}

function commandFailure(code, message, error) {
  const detail = clean(error?.stderr || error?.message);
  return new FinalAvReviewPackError(
    code,
    detail ? `${message}: ${detail.slice(0, 500)}` : message,
    { cause: error },
  );
}

async function probeCurrentMedia(filePath, {
  ffprobePath,
  timeoutMs,
  execFileImpl,
}) {
  let stdout;
  try {
    ({ stdout } = await execFileImpl(ffprobePath, [
      "-v", "error",
      "-show_entries",
      "format=duration,format_name,size:stream=index,codec_type,codec_name,duration,width,height,sample_rate,channels",
      "-of", "json",
      filePath,
    ], {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    }));
  } catch (error) {
    throw commandFailure("final_mp4_probe_failed", "ffprobe could not read current final MP4", error);
  }
  let metadata;
  try {
    metadata = JSON.parse(stdout || "{}");
  } catch (error) {
    throw new FinalAvReviewPackError(
      "final_mp4_probe_invalid",
      "ffprobe returned invalid JSON",
      { cause: error },
    );
  }
  const streams = Array.isArray(metadata.streams) ? metadata.streams : [];
  const audioStreams = streams.filter((stream) => stream?.codec_type === "audio");
  const videoStreams = streams.filter((stream) => stream?.codec_type === "video");
  const streamDurations = streams
    .map((stream) => Number(stream?.duration))
    .filter((duration) => Number.isFinite(duration) && duration > 0);
  const formatDuration = Number(metadata.format?.duration);
  const durationSeconds = Number.isFinite(formatDuration) && formatDuration > 0
    ? formatDuration
    : Math.max(0, ...streamDurations);
  if (!videoStreams.length || !audioStreams.length) {
    throw new FinalAvReviewPackError(
      "final_mp4_required_stream_missing",
      "current final MP4 must contain decodable video and audio streams",
    );
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new FinalAvReviewPackError(
      "final_mp4_duration_invalid",
      "current final MP4 has no positive duration",
    );
  }
  return {
    duration_seconds: durationSeconds,
    streams,
    format: metadata.format || {},
    audio_stream_count: audioStreams.length,
    video_stream_count: videoStreams.length,
    primary_video: videoStreams[0],
  };
}

function durationFromProgress(output = "") {
  const rows = String(output).split(/\r?\n/);
  const outTime = rows
    .filter((row) => row.startsWith("out_time="))
    .map((row) => row.slice("out_time=".length))
    .filter(Boolean)
    .at(-1);
  const match = outTime?.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (match) {
    return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
  }
  const outTimeUs = rows
    .filter((row) => row.startsWith("out_time_us="))
    .map((row) => Number(row.slice("out_time_us=".length)))
    .filter(Number.isFinite)
    .at(-1);
  return Number.isFinite(outTimeUs) ? outTimeUs / 1_000_000 : null;
}

async function decodeCurrentMedia(filePath, durationSeconds, {
  ffmpegPath,
  timeoutMs,
  execFileImpl,
}) {
  const nullSink = process.platform === "win32" ? "NUL" : "/dev/null";
  let stdout;
  let stderr;
  try {
    ({ stdout, stderr } = await execFileImpl(ffmpegPath, [
      "-hide_banner",
      "-nostdin",
      "-v", "error",
      "-xerror",
      "-i", filePath,
      "-map", "0:v:0",
      "-map", "0:a:0",
      "-progress", "pipe:1",
      "-f", "null",
      nullSink,
    ], {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    }));
  } catch (error) {
    throw commandFailure("final_mp4_decode_failed", "ffmpeg could not fully decode current final MP4", error);
  }
  const errors = clean(stderr) ? String(stderr).split(/\r?\n/).filter(Boolean) : [];
  const decodedDurationSeconds = durationFromProgress(stdout);
  if (
    errors.length > 0 ||
    !Number.isFinite(decodedDurationSeconds) ||
    decodedDurationSeconds + 0.25 < durationSeconds
  ) {
    throw new FinalAvReviewPackError(
      "final_mp4_decode_incomplete",
      "ffmpeg did not decode both streams across the full declared duration",
    );
  }
  return {
    fully_decoded: true,
    decoded_duration_seconds: decodedDurationSeconds,
    audio_checked: true,
    video_checked: true,
    errors: [],
  };
}

function fullDurationSampleTimes(durationSeconds, sampleCount) {
  return Array.from({ length: sampleCount }, (_, index) => {
    if (index === 0) return 0;
    if (index === sampleCount - 1) return Number(durationSeconds.toFixed(6));
    return Number(((durationSeconds * index) / (sampleCount - 1)).toFixed(6));
  });
}

function extractionAttemptTimes(timeSeconds) {
  return [...new Set([
    String(timeSeconds),
    String(Number(Math.max(0, timeSeconds - 0.05).toFixed(6))),
  ])];
}

async function extractSamplePng(filePath, timeSeconds, {
  ffmpegPath,
  timeoutMs,
  execFileImpl,
}) {
  let lastError = null;
  for (const attemptTime of extractionAttemptTimes(timeSeconds)) {
    try {
      const { stdout } = await execFileImpl(ffmpegPath, [
        "-hide_banner",
        "-nostdin",
        "-v", "error",
        "-xerror",
        "-i", filePath,
        "-ss", attemptTime,
        "-map", "0:v:0",
        "-frames:v", "1",
        "-an",
        "-sn",
        "-dn",
        "-threads", "1",
        "-c:v", "png",
        "-f", "image2pipe",
        "pipe:1",
      ], {
        encoding: null,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      });
      const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || "");
      if (bytes.length > 0) return bytes;
    } catch (error) {
      lastError = error;
    }
  }
  throw commandFailure(
    "sampled_frame_decode_failed",
    `could not decode sampled frame at ${timeSeconds}s`,
    lastError,
  );
}

async function resolveSamplePng(filePath, targetTimeSeconds, {
  allowEndpointBacktrack = false,
  durationSeconds,
  ...options
}) {
  const coverageWindow = Math.min(1, Math.max(0.5, durationSeconds * 0.05));
  const offsets = allowEndpointBacktrack
    ? Array.from(
      { length: Math.floor(coverageWindow / 0.1) + 1 },
      (_, index) => Number((index * 0.1).toFixed(6)),
    )
    : [0];
  let lastError = null;
  for (const offset of offsets) {
    const timeSeconds = Number(Math.max(0, targetTimeSeconds - offset).toFixed(6));
    try {
      return {
        time_seconds: timeSeconds,
        bytes: await extractSamplePng(filePath, timeSeconds, options),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new FinalAvReviewPackError(
    "sampled_frame_decode_failed",
    `could not decode a reproducible frame near ${targetTimeSeconds}s`,
    { cause: lastError },
  );
}

function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function buildContactSheet({
  storyId,
  durationSeconds,
  sampledFrames,
  samplePngs,
  primaryVideo,
  finalMp4Fingerprint,
}) {
  const columns = Math.min(3, sampledFrames.length);
  const rows = Math.ceil(sampledFrames.length / columns);
  const tileWidth = 288;
  const sourceWidth = Number(primaryVideo?.width);
  const sourceHeight = Number(primaryVideo?.height);
  const sourceRatio = sourceWidth > 0 && sourceHeight > 0 ? sourceHeight / sourceWidth : 16 / 9;
  const tileHeight = Math.max(180, Math.min(512, Math.round(tileWidth * sourceRatio)));
  const margin = 18;
  const gap = 12;
  const headerHeight = 94;
  const labelHeight = 36;
  const footerHeight = 58;
  const width = (margin * 2) + (columns * tileWidth) + ((columns - 1) * gap);
  const height = headerHeight + (rows * (tileHeight + labelHeight)) + ((rows - 1) * gap) + footerHeight;
  const composites = [];
  const labelRows = [];

  for (let index = 0; index < samplePngs.length; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = margin + (column * (tileWidth + gap));
    const top = headerHeight + (row * (tileHeight + labelHeight + gap));
    const tile = await sharp(samplePngs[index], { failOn: "error" })
      .rotate()
      .resize(tileWidth, tileHeight, {
        fit: "contain",
        background: "#09090b",
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();
    composites.push({ input: tile, left, top });
    labelRows.push(
      `<rect x="${left}" y="${top}" width="${tileWidth}" height="${tileHeight}" fill="none" stroke="#3f3f46" stroke-width="2"/>`,
      `<text x="${left + 10}" y="${top + tileHeight + 25}" class="sample">${String(index + 1).padStart(2, "0")}  ${sampledFrames[index].time_seconds.toFixed(3)}s</text>`,
    );
  }

  const storyLabel = xmlEscape(clean(storyId).slice(0, 80));
  const hashLabel = xmlEscape(finalMp4Fingerprint.sha256.slice("sha256:".length, 20));
  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        text { font-family: Arial, sans-serif; letter-spacing: 0; }
        .title { fill: #fafafa; font-size: 24px; font-weight: 700; }
        .meta { fill: #a1a1aa; font-size: 15px; }
        .sample { fill: #e4e4e7; font-size: 16px; font-weight: 600; }
      </style>
      <rect width="${width}" height="${height}" fill="none"/>
      <rect x="${margin}" y="24" width="5" height="44" fill="#ff6b1a"/>
      <text x="${margin + 18}" y="45" class="title">FINAL AV REVIEW EVIDENCE</text>
      <text x="${margin + 18}" y="69" class="meta">${storyLabel} | 0.000s to ${durationSeconds.toFixed(3)}s</text>
      ${labelRows.join("\n")}
      <line x1="${margin}" y1="${height - footerHeight + 10}" x2="${width - margin}" y2="${height - footerHeight + 10}" stroke="#3f3f46"/>
      <text x="${margin}" y="${height - 20}" class="meta">${sampledFrames.length} uniform samples | MP4 SHA-256 ${hashLabel}...</text>
    </svg>`,
    "utf8",
  );
  const contactSheet = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: "#18181b",
    },
  })
    .composite([...composites, { input: overlay, left: 0, top: 0 }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const metadata = await sharp(contactSheet, { failOn: "error" }).metadata();
  if (metadata.format !== "png" || !metadata.width || !metadata.height) {
    throw new FinalAvReviewPackError(
      "contact_sheet_generation_failed",
      "generated contact sheet could not be decoded",
    );
  }
  return { bytes: contactSheet, width: metadata.width, height: metadata.height };
}

function machineCheck(method, evidence) {
  return {
    review_mode: "machine_decode",
    checked: true,
    verdict: "pass",
    method,
    evidence,
  };
}

function pendingSemanticCheck({
  semanticCheck,
  requiredMethod,
  machineMethod,
  machineEvidence,
}) {
  return {
    semantic_check: semanticCheck,
    review_mode: "independent_semantic_review",
    checked: false,
    verdict: "PENDING",
    independent_review_required: true,
    required_method: requiredMethod,
    machine_evidence: {
      method: machineMethod,
      evidence: machineEvidence,
    },
  };
}

function buildForensicReport({
  storyId,
  generatedAt,
  artifactDir,
  finalMp4Path,
  finalMp4Fingerprint,
  probe,
  decode,
  sampledFrames,
  contactSheetPath,
  contactSheetDimensions,
}) {
  const sampleEvidence = {
    sample_count: sampledFrames.length,
    first_sample_seconds: sampledFrames[0]?.time_seconds ?? null,
    last_sample_seconds: sampledFrames.at(-1)?.time_seconds ?? null,
    duration_seconds: probe.duration_seconds,
  };
  return {
    schema_version: 1,
    story_id: storyId,
    generated_at: generatedAt,
    status: "PENDING",
    verdict: "PENDING",
    decoded: true,
    full_duration_decoded: true,
    publish_ready: false,
    can_auto_publish: false,
    independent_review_required: true,
    analysis_scope: {
      machine_decode_and_binding_complete: true,
      semantic_av_acceptance: "PENDING_INDEPENDENT_REVIEW",
    },
    final_media: {
      path: portableRelativePath(artifactDir, finalMp4Path),
      sha256: finalMp4Fingerprint.sha256,
      size_bytes: finalMp4Fingerprint.size_bytes,
      duration_seconds: probe.duration_seconds,
      audio_stream_count: probe.audio_stream_count,
      video_stream_count: probe.video_stream_count,
    },
    decode_evidence: {
      probe: {
        duration_seconds: probe.duration_seconds,
        streams: probe.streams,
        format: probe.format,
      },
      decode,
    },
    checks: {
      audio: machineCheck("ffmpeg_full_stream_decode", {
        audio_stream_count: probe.audio_stream_count,
        decoded_duration_seconds: decode.decoded_duration_seconds,
      }),
      video: machineCheck("ffmpeg_full_stream_decode", {
        video_stream_count: probe.video_stream_count,
        decoded_duration_seconds: decode.decoded_duration_seconds,
      }),
      captions: pendingSemanticCheck({
        semanticCheck: "caption_readability",
        requiredMethod: "independent_full_duration_visual_review",
        machineMethod: "uniform_full_duration_raster_sampling",
        machineEvidence: sampleEvidence,
      }),
      av_sync: pendingSemanticCheck({
        semanticCheck: "av_sync",
        requiredMethod: "independent_full_watch_and_listen",
        machineMethod: "joint_audio_video_full_decode",
        machineEvidence: {
          declared_duration_seconds: probe.duration_seconds,
          decoded_duration_seconds: decode.decoded_duration_seconds,
        },
      }),
      freeze: pendingSemanticCheck({
        semanticCheck: "freeze",
        requiredMethod: "independent_full_duration_visual_review",
        machineMethod: "uniform_full_duration_raster_sampling",
        machineEvidence: sampleEvidence,
      }),
      black: pendingSemanticCheck({
        semanticCheck: "black_frames",
        requiredMethod: "independent_full_duration_visual_review",
        machineMethod: "uniform_full_duration_raster_sampling",
        machineEvidence: sampleEvidence,
      }),
      blur: pendingSemanticCheck({
        semanticCheck: "blur",
        requiredMethod: "independent_full_duration_visual_review",
        machineMethod: "uniform_full_duration_raster_sampling",
        machineEvidence: sampleEvidence,
      }),
      repetition: pendingSemanticCheck({
        semanticCheck: "repetition",
        requiredMethod: "independent_full_duration_visual_review",
        machineMethod: "uniform_full_duration_frame_hashing",
        machineEvidence: sampleEvidence,
      }),
    },
    sampling: {
      strategy: "uniform_full_duration_inclusive",
      full_duration_covered: true,
      ...sampleEvidence,
      hash_algorithm: "sha256",
      hash_pixel_format: "rgba",
    },
    sampled_frames: sampledFrames,
    contact_sheet: {
      path: portableRelativePath(artifactDir, contactSheetPath),
      width: contactSheetDimensions.width,
      height: contactSheetDimensions.height,
      sample_count: sampledFrames.length,
    },
    critical_defects: [],
    blockers: ["independent_semantic_av_review_pending"],
    failures: [],
    errors: [],
  };
}

function buildPendingReviewTemplate({
  storyId,
  generatedAt,
  artifactDir,
  finalMp4Path,
  contactSheetPath,
  forensicReportPath,
  fingerprints,
  sampledFrames,
}) {
  return {
    schema_version: FINAL_AV_REVIEW_SCHEMA_VERSION,
    story_id: storyId,
    template_generated_at: generatedAt,
    reviewed_at: null,
    signed_at: null,
    reviewer: {
      id: null,
      independent: null,
    },
    signoff: null,
    status: "PENDING",
    verdict: "PENDING",
    final_verdict: null,
    publish_ready: false,
    can_auto_publish: false,
    artefacts: {
      final_mp4: portableRelativePath(artifactDir, finalMp4Path),
      contact_sheet: portableRelativePath(artifactDir, contactSheetPath),
      decoded_forensic_report: portableRelativePath(artifactDir, forensicReportPath),
    },
    reviewed_artefact_fingerprints: {
      final_mp4: fingerprints.final_mp4.sha256,
      contact_sheet: fingerprints.contact_sheet.sha256,
      decoded_forensic_report: fingerprints.decoded_forensic_report.sha256,
    },
    contact_sheet_binding: {
      contact_sheet_sha256: fingerprints.contact_sheet.sha256,
      final_mp4_sha256: fingerprints.final_mp4.sha256,
      decoded_forensic_report_sha256: fingerprints.decoded_forensic_report.sha256,
      sampled_frames: sampledFrames.map((frame) => ({
        time_seconds: frame.time_seconds,
        hash: frame.hash,
      })),
    },
    attestations: Object.fromEntries(
      FINAL_AV_REVIEW_ATTESTATION_KEYS.map((key) => [key, false]),
    ),
    defects: null,
    blockers: ["independent_final_av_review_pending"],
    failures: [],
    errors: [],
    required_reviewer_actions: [
      "Set reviewed_at after completing a full watch and full listen.",
      "Supply a trusted reviewer id and attest independence.",
      "Set every attestation explicitly from observed evidence.",
      "Record defects as an array, clear pending blockers and set the final verdict.",
      "Set publish_ready only after the authoritative validator returns GREEN.",
    ],
  };
}

async function assertSafeOutputPath(artifactDir, filePath) {
  if (!pathIsWithin(filePath, artifactDir)) {
    throw new FinalAvReviewPackError(
      "output_path_outside_story_dir",
      "review-pack output resolved outside the story artifact directory",
    );
  }
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new FinalAvReviewPackError(
        "output_path_unusable",
        `refusing to replace non-regular output path ${path.basename(filePath)}`,
      );
    }
  } catch (error) {
    if (error?.code === "ENOENT") return;
    if (error instanceof FinalAvReviewPackError) throw error;
    throw new FinalAvReviewPackError(
      "output_path_unusable",
      `cannot inspect output path ${path.basename(filePath)}`,
      { cause: error },
    );
  }
}

async function atomicWriteInside(artifactDir, filePath, bytes) {
  await assertSafeOutputPath(artifactDir, filePath);
  const temporaryPath = path.join(
    artifactDir,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    await fs.writeFile(temporaryPath, bytes, { flag: "wx" });
    await fsExtra.move(temporaryPath, filePath, { overwrite: true });
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function removeGeneratedOutputs(paths) {
  await Promise.all(Object.values(paths).map((filePath) => fs.rm(filePath, { force: true }).catch(() => {})));
}

async function generateFinalAvReviewPack({
  storyId,
  artifactDir,
  finalMp4Path,
  generatedAt,
  sampleCount,
  ffprobePath = process.env.FFPROBE_PATH || "ffprobe",
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
  probeTimeoutMs = 30_000,
  decodeTimeoutMs = 300_000,
  frameTimeoutMs = 30_000,
  execFileImpl = execFileAsync,
} = {}) {
  if (typeof execFileImpl !== "function") {
    throw new FinalAvReviewPackError("exec_file_invalid", "execFileImpl must be a function");
  }
  const canonicalArtifactDir = await canonicalDirectory(artifactDir);
  const canonicalFinalMp4Path = await resolveCurrentFinalMp4(
    canonicalArtifactDir,
    finalMp4Path,
  );
  const resolvedStoryId = clean(storyId) || path.basename(canonicalArtifactDir);
  if (!resolvedStoryId) {
    throw new FinalAvReviewPackError("story_id_missing", "storyId is required");
  }
  const resolvedGeneratedAt = generatedAtIso(generatedAt);
  const resolvedSampleCount = normaliseSampleCount(sampleCount);
  const paths = {
    contact_sheet: path.join(canonicalArtifactDir, FINAL_AV_CONTACT_SHEET_FILENAME),
    decoded_forensic_report: path.join(
      canonicalArtifactDir,
      FINAL_AV_FORENSIC_REPORT_FILENAME,
    ),
    final_av_review: path.join(canonicalArtifactDir, FINAL_AV_REVIEW_FILENAME),
  };
  for (const outputPath of Object.values(paths)) {
    await assertSafeOutputPath(canonicalArtifactDir, outputPath);
  }

  const initialFingerprint = await fingerprintFile(canonicalFinalMp4Path);
  const probe = await probeCurrentMedia(canonicalFinalMp4Path, {
    ffprobePath,
    timeoutMs: probeTimeoutMs,
    execFileImpl,
  });
  const decode = await decodeCurrentMedia(canonicalFinalMp4Path, probe.duration_seconds, {
    ffmpegPath,
    timeoutMs: decodeTimeoutMs,
    execFileImpl,
  });
  const targetSampleTimes = fullDurationSampleTimes(probe.duration_seconds, resolvedSampleCount);
  const resolvedSamples = [];
  for (let index = 0; index < targetSampleTimes.length; index += 1) {
    resolvedSamples.push(await resolveSamplePng(
      canonicalFinalMp4Path,
      targetSampleTimes[index],
      {
        allowEndpointBacktrack: index === targetSampleTimes.length - 1,
        durationSeconds: probe.duration_seconds,
        ffmpegPath,
        timeoutMs: frameTimeoutMs,
        execFileImpl,
      },
    ));
  }
  const sampleTimes = resolvedSamples.map((sample) => sample.time_seconds);
  let frameHashVerification;
  try {
    frameHashVerification = await verifySampledFrameHashesWithFfmpeg({
      finalMp4Path: canonicalFinalMp4Path,
      sampledFrames: sampleTimes.map((timeSeconds) => ({ time_seconds: timeSeconds })),
    }, {
      ffmpegPath,
      timeoutMs: frameTimeoutMs,
      execFileImpl,
    });
  } catch (error) {
    throw commandFailure(
      "sampled_frame_hash_failed",
      "could not hash full-duration sampled frames",
      error,
    );
  }
  if (
    frameHashVerification?.checked !== true ||
    !Array.isArray(frameHashVerification.sampled_frames) ||
    frameHashVerification.sampled_frames.length !== sampleTimes.length
  ) {
    throw new FinalAvReviewPackError(
      "sampled_frame_hash_failed",
      "sampled frame hashing did not return every requested frame",
    );
  }
  const sampledFrames = frameHashVerification.sampled_frames.map((frame, index) => {
    const hash = clean(frame?.sha256).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      throw new FinalAvReviewPackError(
        "sampled_frame_hash_invalid",
        `sampled frame ${index} did not produce a strict SHA-256 hash`,
      );
    }
    return {
      index,
      time_seconds: sampleTimes[index],
      hash,
      hash_algorithm: "sha256",
      hash_pixel_format: "rgba",
      source_mp4_sha256: initialFingerprint.sha256,
    };
  });
  const samplePngs = resolvedSamples.map((sample) => sample.bytes);
  const contactSheet = await buildContactSheet({
    storyId: resolvedStoryId,
    durationSeconds: probe.duration_seconds,
    sampledFrames,
    samplePngs,
    primaryVideo: probe.primary_video,
    finalMp4Fingerprint: initialFingerprint,
  });
  const stableFingerprint = await fingerprintFile(canonicalFinalMp4Path);
  if (!fingerprintsMatch(initialFingerprint, stableFingerprint)) {
    throw new FinalAvReviewPackError(
      "final_mp4_changed_during_generation",
      "current final MP4 changed while review evidence was generated",
    );
  }

  const forensicReport = buildForensicReport({
    storyId: resolvedStoryId,
    generatedAt: resolvedGeneratedAt,
    artifactDir: canonicalArtifactDir,
    finalMp4Path: canonicalFinalMp4Path,
    finalMp4Fingerprint: stableFingerprint,
    probe,
    decode,
    sampledFrames,
    contactSheetPath: paths.contact_sheet,
    contactSheetDimensions: contactSheet,
  });
  const contactSheetFingerprint = fingerprintBytes(contactSheet.bytes);
  const forensicReportBytes = jsonBytes(forensicReport);
  const forensicReportFingerprint = fingerprintBytes(forensicReportBytes);
  const fingerprints = {
    final_mp4: stableFingerprint,
    contact_sheet: contactSheetFingerprint,
    decoded_forensic_report: forensicReportFingerprint,
  };
  const reviewTemplate = buildPendingReviewTemplate({
    storyId: resolvedStoryId,
    generatedAt: resolvedGeneratedAt,
    artifactDir: canonicalArtifactDir,
    finalMp4Path: canonicalFinalMp4Path,
    contactSheetPath: paths.contact_sheet,
    forensicReportPath: paths.decoded_forensic_report,
    fingerprints,
    sampledFrames,
  });
  const reviewTemplateBytes = jsonBytes(reviewTemplate);

  try {
    await atomicWriteInside(canonicalArtifactDir, paths.contact_sheet, contactSheet.bytes);
    await atomicWriteInside(
      canonicalArtifactDir,
      paths.decoded_forensic_report,
      forensicReportBytes,
    );
    await atomicWriteInside(canonicalArtifactDir, paths.final_av_review, reviewTemplateBytes);
    const finalFingerprint = await fingerprintFile(canonicalFinalMp4Path);
    if (!fingerprintsMatch(stableFingerprint, finalFingerprint)) {
      throw new FinalAvReviewPackError(
        "final_mp4_changed_during_generation",
        "current final MP4 changed before the review pack was sealed",
      );
    }
    const writtenContactSheet = fingerprintBytes(await fs.readFile(paths.contact_sheet));
    const writtenForensicReport = fingerprintBytes(await fs.readFile(paths.decoded_forensic_report));
    if (
      !fingerprintsMatch(contactSheetFingerprint, writtenContactSheet) ||
      !fingerprintsMatch(forensicReportFingerprint, writtenForensicReport)
    ) {
      throw new FinalAvReviewPackError(
        "review_pack_write_verification_failed",
        "written review evidence did not retain its generated fingerprints",
      );
    }
  } catch (error) {
    await removeGeneratedOutputs(paths);
    throw error;
  }

  return {
    schema_version: 1,
    story_id: resolvedStoryId,
    status: "PENDING",
    publish_ready: false,
    can_auto_publish: false,
    artifact_dir: canonicalArtifactDir,
    final_mp4: canonicalFinalMp4Path,
    duration_seconds: probe.duration_seconds,
    sample_count: sampledFrames.length,
    paths,
    fingerprints,
    forensic_report: forensicReport,
    review_template: reviewTemplate,
  };
}

module.exports = {
  DEFAULT_SAMPLE_COUNT,
  FINAL_AV_CONTACT_SHEET_FILENAME,
  FINAL_AV_FORENSIC_REPORT_FILENAME,
  FINAL_AV_REVIEW_FILENAME,
  FinalAvReviewPackError,
  fullDurationSampleTimes,
  generateFinalAvReviewPack,
};

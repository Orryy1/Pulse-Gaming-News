"use strict";

const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const fs = require("fs-extra");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const SHA256_RE = /^[a-f0-9]{64}$/;
const DEFAULT_EXPECTED_CARD_KINDS = Object.freeze([
  "source",
  "context",
  "timeline",
  "quote",
  "takeaway",
  "outro",
]);

class FlagshipCardEvidenceError extends Error {
  constructor(report) {
    super(`flagship_card_evidence_invalid:${(report.blockers || []).join(",")}`);
    this.name = "FlagshipCardEvidenceError";
    this.code = "flagship_card_evidence_invalid";
    this.report = report;
  }
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normaliseSha256(value) {
  const digest = clean(value).replace(/^sha256:/i, "").toLowerCase();
  return SHA256_RE.test(digest) ? digest : "";
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function fingerprintFile(filePath) {
  const bytes = await fs.readFile(filePath);
  return {
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    size_bytes: bytes.length,
  };
}

async function defaultProbeVideo(
  filePath,
  {
    ffprobePath = process.env.FFPROBE_PATH || "ffprobe",
    timeoutMs = 30_000,
  } = {},
) {
  const { stdout } = await execFileAsync(
    ffprobePath,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration,format_name:stream=codec_type,codec_name,width,height,duration",
      "-of",
      "json",
      filePath,
    ],
    {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: Math.max(5_000, Number(timeoutMs) || 30_000),
      windowsHide: true,
    },
  );
  const payload = JSON.parse(stdout || "{}");
  const streams = asArray(payload.streams);
  const video = streams.find((stream) => clean(stream.codec_type) === "video") || null;
  const durationSeconds = positiveNumber(payload.format?.duration)
    || positiveNumber(video?.duration);
  return {
    decodable: Boolean(video && durationSeconds),
    duration_seconds: durationSeconds,
    format_name: clean(payload.format?.format_name).toLowerCase() || null,
    video: video
      ? {
        codec: clean(video.codec_name).toLowerCase() || null,
        width: positiveNumber(video.width),
        height: positiveNumber(video.height),
      }
      : null,
  };
}

function normaliseProbe(probe = {}) {
  const streams = asArray(probe.streams);
  const streamVideo = streams.find((stream) => clean(stream.codec_type) === "video") || null;
  const video = probe.video && typeof probe.video === "object"
    ? probe.video
    : streamVideo;
  const durationSeconds = positiveNumber(
    probe.duration_seconds
      ?? probe.duration_s
      ?? probe.format?.duration
      ?? video?.duration,
  );
  return {
    decodable: probe.decodable === true,
    duration_seconds: durationSeconds,
    format_name: clean(probe.format_name || probe.format?.format_name).toLowerCase() || null,
    video: video
      ? {
        codec: clean(video.codec || video.codec_name).toLowerCase() || null,
        width: positiveNumber(video.width),
        height: positiveNumber(video.height),
      }
      : null,
  };
}

function cardRows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).map(([kind, descriptor]) => (
    typeof descriptor === "string"
      ? { card_kind: kind, path: descriptor }
      : { card_kind: kind, ...(descriptor || {}) }
  ));
}

async function loadManifest(cardManifest, approvedRealRoots) {
  if (!cardManifest) return { manifest: {}, manifest_path: null };
  if (typeof cardManifest !== "string") {
    if (typeof cardManifest !== "object" || Array.isArray(cardManifest)) {
      return { manifest: {}, manifest_path: null, blocker: "card_manifest_invalid" };
    }
    return { manifest: cardManifest, manifest_path: null };
  }

  const manifestPath = path.resolve(cardManifest);
  let realManifestPath;
  try {
    realManifestPath = await fs.realpath(manifestPath);
  } catch {
    return {
      manifest: {},
      manifest_path: manifestPath,
      blocker: "card_manifest_missing_or_unreadable",
    };
  }
  if (!approvedRealRoots.some((root) => isInside(root, realManifestPath))) {
    return {
      manifest: {},
      manifest_path: realManifestPath,
      blocker: "card_manifest_outside_approved_roots",
    };
  }
  try {
    return {
      manifest: await fs.readJson(realManifestPath),
      manifest_path: realManifestPath,
    };
  } catch {
    return {
      manifest: {},
      manifest_path: realManifestPath,
      blocker: "card_manifest_missing_or_unreadable",
    };
  }
}

function emptyReport({
  generatedAt,
  storyId,
  generationId,
  artifactDir,
  targetArtifactDir,
  expectedCardKinds,
  manifestPath,
} = {}) {
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "FLAGSHIP_CARD_EVIDENCE_COPY",
    verdict: "RED",
    status: "blocked",
    story_id: storyId || null,
    generation_id: generationId || null,
    source_artifact_dir: artifactDir || null,
    target_artifact_dir: targetArtifactDir || null,
    source_manifest_path: manifestPath || null,
    expected_card_kinds: expectedCardKinds,
    cards: [],
    blockers: [],
    summary: {
      expected_card_count: expectedCardKinds.length,
      validated_card_count: 0,
      copied_card_count: 0,
      blocker_count: 0,
    },
    safety: {
      local_copy_only: true,
      publish_authorised: false,
      external_posting_performed: false,
      production_db_mutated: false,
      oauth_or_token_mutated: false,
    },
  };
}

function throwBlocked(report, blockers) {
  const uniqueBlockers = unique(blockers);
  report.blockers = uniqueBlockers;
  report.summary.blocker_count = uniqueBlockers.length;
  throw new FlagshipCardEvidenceError(report);
}

async function validateAndCopyFlagshipCardEvidence({
  artifactDir,
  cardManifest = null,
  cardPaths = null,
  currentGenerationId,
  expectedCardKinds = DEFAULT_EXPECTED_CARD_KINDS,
  approvedRoots = null,
  targetArtifactDir,
  targetCardSubdir = path.join("flagship", "cards"),
  generatedAt = new Date().toISOString(),
  probeVideo = defaultProbeVideo,
  ffprobePath = process.env.FFPROBE_PATH || "ffprobe",
  probeTimeoutMs = 30_000,
  durationToleranceSeconds = 0.08,
} = {}) {
  const sourceArtifactDir = artifactDir ? path.resolve(artifactDir) : "";
  const targetDir = targetArtifactDir ? path.resolve(targetArtifactDir) : "";
  const generationId = clean(currentGenerationId);
  const expectedKinds = unique(asArray(expectedCardKinds).map(clean));
  const blockers = [];

  if (!sourceArtifactDir) blockers.push("artifact_dir_missing");
  if (!targetDir) blockers.push("target_artifact_dir_missing");
  if (!generationId) blockers.push("current_generation_id_missing");
  if (!expectedKinds.length) blockers.push("expected_card_kinds_missing");

  const rootInputs = asArray(approvedRoots).length
    ? approvedRoots
    : sourceArtifactDir
      ? [sourceArtifactDir]
      : [];
  const approvedRealRoots = [];
  for (const rootInput of rootInputs) {
    try {
      approvedRealRoots.push(await fs.realpath(path.resolve(rootInput)));
    } catch {
      blockers.push("approved_root_missing_or_unreadable");
    }
  }
  if (!approvedRealRoots.length) blockers.push("approved_roots_missing");

  const loaded = blockers.length
    ? { manifest: {}, manifest_path: null }
    : await loadManifest(cardManifest, approvedRealRoots);
  if (loaded.blocker) blockers.push(loaded.blocker);
  const manifest = loaded.manifest || {};
  const manifestGenerationId = clean(
    manifest.generation_id
      || manifest.render_generation_id
      || manifest.evidence_generation_id,
  );
  if (cardManifest && !manifestGenerationId) blockers.push("card_manifest_generation_id_missing");
  if (manifestGenerationId && manifestGenerationId !== generationId) {
    blockers.push("card_manifest_generation_stale");
  }

  const storyId = clean(manifest.story_id || manifest.storyId);
  const report = emptyReport({
    generatedAt: new Date(generatedAt).toISOString(),
    storyId,
    generationId,
    artifactDir: sourceArtifactDir,
    targetArtifactDir: targetDir,
    expectedCardKinds: expectedKinds,
    manifestPath: loaded.manifest_path,
  });
  if (blockers.length) throwBlocked(report, blockers);

  const suppliedRows = cardRows(
    cardPaths || manifest.cards || manifest.card_evidence || manifest.entries,
  );
  if (!suppliedRows.length) throwBlocked(report, ["card_evidence_missing"]);

  const seenKinds = new Set();
  const seenPaths = new Set();
  const seenHashes = new Set();
  const seenBasenames = new Set();
  const validated = [];

  for (const descriptor of suppliedRows) {
    const kind = clean(descriptor.card_kind || descriptor.kind || descriptor.id);
    if (!kind) {
      blockers.push("card_kind_missing");
      continue;
    }
    if (!expectedKinds.includes(kind)) blockers.push(`unexpected_card_kind:${kind}`);
    if (seenKinds.has(kind)) blockers.push(`duplicate_card_kind:${kind}`);
    seenKinds.add(kind);

    const generation = clean(
      descriptor.generation_id
        || descriptor.render_generation_id
        || descriptor.evidence_generation_id,
    );
    if (!generation) blockers.push(`card_generation_id_missing:${kind}`);
    else if (generation !== generationId) blockers.push(`card_generation_stale:${kind}`);

    const declaredPath = clean(
      descriptor.path
        || descriptor.file_path
        || descriptor.output_path
        || descriptor.mp4_path,
    );
    const resolvedPath = declaredPath
      ? path.isAbsolute(declaredPath)
        ? path.resolve(declaredPath)
        : path.resolve(sourceArtifactDir, declaredPath)
      : "";
    if (!resolvedPath) {
      blockers.push(`card_path_missing:${kind}`);
      continue;
    }
    if (path.extname(resolvedPath).toLowerCase() !== ".mp4") {
      blockers.push(`card_not_mp4:${kind}`);
    }

    let realPath;
    try {
      realPath = await fs.realpath(resolvedPath);
    } catch {
      blockers.push(`card_missing_or_unreadable:${kind}`);
      continue;
    }
    if (!approvedRealRoots.some((root) => isInside(root, realPath))) {
      blockers.push(`card_path_outside_approved_roots:${kind}`);
      continue;
    }

    const currentPathKey = pathKey(realPath);
    if (seenPaths.has(currentPathKey)) blockers.push(`duplicate_card_path:${kind}`);
    seenPaths.add(currentPathKey);
    const basenameKey = process.platform === "win32"
      ? path.basename(realPath).toLowerCase()
      : path.basename(realPath);
    if (seenBasenames.has(basenameKey)) blockers.push(`duplicate_card_basename:${kind}`);
    seenBasenames.add(basenameKey);

    const declaredSha256 = normaliseSha256(
      descriptor.sha256 || descriptor.asset_sha256 || descriptor.file_sha256,
    );
    const declaredSize = positiveNumber(
      descriptor.size_bytes || descriptor.asset_size_bytes || descriptor.file_size_bytes,
    );
    const declaredDuration = positiveNumber(
      descriptor.duration_seconds || descriptor.duration_s || descriptor.probed_duration_seconds,
    );
    if (!declaredSha256) blockers.push(`card_sha256_missing_or_invalid:${kind}`);
    if (!declaredSize) blockers.push(`card_size_missing_or_invalid:${kind}`);
    if (!declaredDuration) blockers.push(`card_duration_missing_or_invalid:${kind}`);

    let fingerprint;
    try {
      fingerprint = await fingerprintFile(realPath);
    } catch {
      blockers.push(`card_missing_or_unreadable:${kind}`);
      continue;
    }
    if (declaredSha256 && fingerprint.sha256 !== declaredSha256) {
      blockers.push(`card_sha256_mismatch:${kind}`);
    }
    if (declaredSize && fingerprint.size_bytes !== declaredSize) {
      blockers.push(`card_size_mismatch:${kind}`);
    }
    if (seenHashes.has(fingerprint.sha256)) blockers.push(`duplicate_card_sha256:${kind}`);
    seenHashes.add(fingerprint.sha256);

    let probe;
    try {
      probe = normaliseProbe(await probeVideo(realPath, {
        ffprobePath,
        timeoutMs: probeTimeoutMs,
      }));
    } catch {
      blockers.push(`card_probe_failed:${kind}`);
      continue;
    }
    if (probe.decodable !== true) blockers.push(`card_not_decodable:${kind}`);
    if (!probe.video) blockers.push(`card_video_stream_missing:${kind}`);
    if (!probe.duration_seconds) blockers.push(`card_probe_duration_missing:${kind}`);
    if (
      declaredDuration
      && probe.duration_seconds
      && Math.abs(declaredDuration - probe.duration_seconds)
        > Math.max(0, Number(durationToleranceSeconds) || 0)
    ) {
      blockers.push(`card_duration_mismatch:${kind}`);
    }

    validated.push({
      card_kind: kind,
      generation_id: generation || null,
      source_path: realPath,
      filename: path.basename(realPath),
      sha256: fingerprint.sha256,
      size_bytes: fingerprint.size_bytes,
      duration_seconds: probe.duration_seconds,
      declared_duration_seconds: declaredDuration,
      video_codec: probe.video?.codec || null,
      width: probe.video?.width || null,
      height: probe.video?.height || null,
      format_name: probe.format_name,
      generation_bound: generation === generationId,
      path_approved: true,
      decodable_video: probe.decodable === true && Boolean(probe.video),
    });
  }

  for (const kind of expectedKinds) {
    if (!seenKinds.has(kind)) blockers.push(`expected_card_missing:${kind}`);
  }
  if (suppliedRows.length !== expectedKinds.length) {
    blockers.push("card_count_mismatch");
  }
  if (blockers.length) throwBlocked(report, blockers);

  const targetCardsDir = path.resolve(targetDir, targetCardSubdir);
  if (!isInside(targetDir, targetCardsDir)) {
    throwBlocked(report, ["target_card_dir_outside_target_artifact"]);
  }
  const stageRoot = path.join(
    path.dirname(targetDir),
    `.${path.basename(targetDir)}-flagship-card-stage-${process.pid}-${Date.now()}`,
  );
  const stageCardsDir = path.join(stageRoot, "cards");
  try {
    await fs.ensureDir(stageCardsDir);
    for (const card of validated) {
      const stagedPath = path.join(stageCardsDir, card.filename);
      await fs.copy(card.source_path, stagedPath, { overwrite: false });
      const stagedFingerprint = await fingerprintFile(stagedPath);
      if (
        stagedFingerprint.sha256 !== card.sha256
        || stagedFingerprint.size_bytes !== card.size_bytes
      ) {
        throw new Error(`staged_card_fingerprint_mismatch:${card.card_kind}`);
      }
    }
    await fs.remove(targetCardsDir);
    await fs.ensureDir(path.dirname(targetCardsDir));
    await fs.move(stageCardsDir, targetCardsDir, { overwrite: false });
  } catch (error) {
    await fs.remove(stageRoot).catch(() => {});
    throwBlocked(report, [clean(error?.message || "card_copy_failed")]);
  } finally {
    await fs.remove(stageRoot).catch(() => {});
  }

  report.cards = validated.map((card) => ({
    ...card,
    target_path: path.join(targetCardsDir, card.filename),
  }));
  report.verdict = "GREEN";
  report.status = "copied";
  report.summary.validated_card_count = validated.length;
  report.summary.copied_card_count = validated.length;
  return report;
}

module.exports = {
  DEFAULT_EXPECTED_CARD_KINDS,
  FlagshipCardEvidenceError,
  defaultProbeVideo,
  validateAndCopyFlagshipCardEvidence,
};

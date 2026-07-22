"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");
const { execFileSync: defaultExecFileSync } = require("node:child_process");

const {
  materializeStudioV4BridgeClips,
  isSafeDirectMediaUrl,
} = require("./studio/v4/render-clip-materializer");
const { ffprobeDuration: defaultFfprobeDuration } = require("./studio/media-acquisition");
const { isSafeOutboundUrl } = require("./safe-url");
const {
  fingerprintVideoClip,
  compareVideoFingerprints,
} = require("./video-visual-fingerprint");
const {
  canonicaliseMotionSourceUrl,
  resolveMotionSourceIdentity,
  assessProfessionalSourceDiversity,
} = require("./studio/motion-source-identity");

const ALL_SOCIAL_PLATFORMS = ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"];
const DEFAULT_MIN_CLIPS = 5;
const DEFAULT_MIN_FAMILIES = 4;
const DEFAULT_MAX_DIRECT_MOTION_CLIPS_PER_BASE_SOURCE = 1;
const PULSE_SOURCE_IDENTITY_SIDECAR_SCHEMA = "pulse_motion_source_identity_sidecar_v1";
const PULSE_SOURCE_IDENTITY_SIDECAR_PRODUCER = "pulse_source_identity_oembed_verifier_v1";
const DIRECT_VIDEO_MOTION_BLOCKER = "visual_evidence:direct_video_motion_missing";
const SCRIPT_REPAIR_RIGHTS_TRANSITION_BLOCKER =
  "narration_and_render_regeneration_required_after_script_repair";
const REAL_MOTION_SOURCE_ACQUISITION_BLOCKERS = new Set([
  "validated_direct_media_candidates_missing",
  "real_motion_clip_minimum_not_met",
  "real_motion_family_minimum_not_met",
  "direct_video_motion_clip_missing",
  "visual_motion_duplicate_content_detected",
]);
const TRANSFORMATION_PROVENANCE_FIELDS = new Set([
  "base_source_family",
  "media_start_s",
  "duration_s",
  "original_media_start_s",
  "original_duration_s",
  "validator_trim_applied",
  "source_media_start_s",
  "source_window_duration_s",
  "source_crop_top_px",
  "source_crop_bottom_px",
  "materialized_media_start_s",
  "materialized_duration_s",
  "materialized_at",
  "refresh_window_materialized",
  "expanded_from_source_window",
  "source_window_index",
  "source_window_direction",
]);

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseStoryIds(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => cleanText(item).split(","))
    .map(cleanText)
    .filter(Boolean);
}

function lowerText(value) {
  return cleanText(value).toLowerCase();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasOwn(object, key) {
  return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
}

function rightsFieldPresence(asset = {}) {
  return {
    licence_basis: ["licence_basis", "license_basis", "rights_basis"].some((key) => hasOwn(asset, key)),
    allowed_use: ["allowed_use", "allowed_render_use"].some((key) => hasOwn(asset, key)),
    allowed_platforms: hasOwn(asset, "allowed_platforms"),
    platform_restrictions: hasOwn(asset, "platform_restrictions"),
    restricted_platforms: hasOwn(asset, "restricted_platforms"),
    commercial_use_allowed: hasOwn(asset, "commercial_use_allowed"),
    risk_score: hasOwn(asset, "risk_score"),
    credit_required: hasOwn(asset, "credit_required"),
    evidence_reference: hasOwn(asset, "evidence_reference"),
    evidence_file: hasOwn(asset, "evidence_file") || hasOwn(asset, "rights_evidence_file"),
    evidence_kind: hasOwn(asset, "evidence_kind"),
    evidence_sha256: hasOwn(asset, "evidence_sha256") || hasOwn(asset, "rights_evidence_sha256"),
    evidence_size_bytes:
      hasOwn(asset, "evidence_size_bytes") || hasOwn(asset, "rights_evidence_size_bytes"),
    transformative_rights_evidence_verified:
      hasOwn(asset, "transformative_rights_evidence_verified"),
    rights_grant: hasOwn(asset, "rights_grant"),
  };
}

function splitProvenance(value = {}) {
  const validation = {};
  const transformation = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { validation, transformation };
  }
  for (const [key, entry] of Object.entries(value)) {
    if (TRANSFORMATION_PROVENANCE_FIELDS.has(key) || key.startsWith("materialized_")) {
      transformation[key] = entry;
    } else {
      validation[key] = entry;
    }
  }
  return { validation, transformation };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function mergeValidationProvenance(legacy = {}, explicit = {}) {
  const merged = structuredClone(isPlainObject(legacy) ? legacy : {});
  for (const [key, value] of Object.entries(isPlainObject(explicit) ? explicit : {})) {
    if (isPlainObject(merged[key]) && isPlainObject(value)) {
      merged[key] = mergeValidationProvenance(merged[key], value);
    } else {
      merged[key] = structuredClone(value);
    }
  }
  return merged;
}

function provenanceValueConflicts(legacy = {}, explicit = {}, prefix = "") {
  const conflicts = [];
  for (const [key, explicitValue] of Object.entries(isPlainObject(explicit) ? explicit : {})) {
    if (!hasOwn(legacy, key)) continue;
    const field = prefix ? `${prefix}.${key}` : key;
    const legacyValue = legacy[key];
    if (isPlainObject(legacyValue) && isPlainObject(explicitValue)) {
      conflicts.push(...provenanceValueConflicts(legacyValue, explicitValue, field));
    } else if (stableJson(legacyValue) !== stableJson(explicitValue)) {
      conflicts.push(field);
    }
  }
  return conflicts;
}

function restrictiveValidationStatus(value) {
  const status = lowerText(value);
  return /^(?:reject|rejected|deny|denied|blocked|fail|failed|red|revoked)$/.test(status) ||
    /(?:^|[_ -])(?:reject(?:ed)?|deny|denied|block(?:ed)?|fail(?:ed)?|red|revok(?:ed)?|invalid|not[_ -]?approved|unapproved|prohibited)(?:$|[_ -])/.test(status)
    ? status
    : "";
}

function validationProvenanceRejections(value = {}, prefix = "") {
  const conflicts = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      conflicts.push(...validationProvenanceRejections(entry, `${prefix}[${index}]`));
    });
    return conflicts;
  }
  if (!isPlainObject(value)) return conflicts;
  for (const [key, entry] of Object.entries(value)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (
      ["segment_validated", "allowed_for_flash_lane", "validated", "validation_passed", "passed"]
        .includes(lowerText(key)) &&
      entry === false
    ) {
      conflicts.push(`${field}_rejected`);
    }
    if (/(?:^|_)(?:status|verdict|approval_status|validation_result|decision)(?:$|_)/.test(lowerText(key))) {
      const restrictive = restrictiveValidationStatus(entry);
      if (restrictive) conflicts.push(`${field}_${restrictive}`);
    }
    if (isPlainObject(entry) || Array.isArray(entry)) {
      conflicts.push(...validationProvenanceRejections(entry, field));
    }
  }
  return conflicts;
}

function affirmativeValidationReason(value) {
  const reason = lowerText(value);
  return Boolean(
    reason &&
    (/(?:^|[_ -])(?:pass|passed)$/.test(reason) || /_samples_passed$/.test(reason)),
  );
}

function validationProvenanceRefreshEquivalent(current = {}, previous = {}) {
  if (stableJson(current) === stableJson(previous)) return true;
  if (
    validationProvenanceRejections(current).length ||
    validationProvenanceRejections(previous).length
  ) {
    return false;
  }
  const currentNormalised = structuredClone(current);
  const previousNormalised = structuredClone(previous);
  const currentReason = cleanText(currentNormalised.validation_reason);
  const previousReason = cleanText(previousNormalised.validation_reason);
  if (currentReason || previousReason) {
    if (
      currentReason !== previousReason &&
      !(affirmativeValidationReason(currentReason) &&
        affirmativeValidationReason(previousReason))
    ) {
      return false;
    }
    delete currentNormalised.validation_reason;
    delete previousNormalised.validation_reason;
  }
  const currentDuration = numberOrNull(currentNormalised.source_duration_s);
  const previousDuration = numberOrNull(previousNormalised.source_duration_s);
  if (
    currentDuration != null &&
    previousDuration != null &&
    Math.abs(currentDuration - previousDuration) <= 1
  ) {
    delete currentNormalised.source_duration_s;
    delete previousNormalised.source_duration_s;
  }
  return stableJson(currentNormalised) === stableJson(previousNormalised);
}

function provenanceStateForAsset(asset = {}) {
  const legacy = splitProvenance(asset.provenance || {});
  const explicit = splitProvenance(asset.validation_provenance || {});
  const transformation = {
    ...legacy.transformation,
    ...(asset.transformation_provenance && typeof asset.transformation_provenance === "object"
      ? asset.transformation_provenance
      : {}),
  };
  const conflicts = [];
  if (Object.keys(explicit.transformation).length) {
    conflicts.push(...Object.keys(explicit.transformation).map((field) => `validation_contains_${field}`));
  }
  conflicts.push(...provenanceValueConflicts(legacy.validation, explicit.validation));
  const validation = mergeValidationProvenance(legacy.validation, explicit.validation);
  conflicts.push(...validationProvenanceRejections(validation));
  return {
    validation,
    transformation,
    conflicts: [...new Set(conflicts)],
  };
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function defaultMaterializedClipProbe(filePath) {
  const stdout = defaultExecFileSync(process.env.FFPROBE_PATH || "ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,duration",
    "-of", "json",
    filePath,
  ], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const metadata = JSON.parse(stdout || "{}");
  const streams = asArray(metadata.streams);
  const video = streams.find((stream) => cleanText(stream.codec_type) === "video") || null;
  const streamDurations = streams
    .map((stream) => numberOrNull(stream.duration))
    .filter((duration) => duration != null && duration > 0);
  const durationSeconds = numberOrNull(metadata.format?.duration) || Math.max(0, ...streamDurations);
  return {
    available: true,
    decodable: Boolean(video && durationSeconds > 0),
    duration_seconds: durationSeconds > 0 ? durationSeconds : null,
    video: video
      ? {
          codec: cleanText(video.codec_name).toLowerCase(),
          width: numberOrNull(video.width),
          height: numberOrNull(video.height),
        }
      : null,
  };
}

function defaultMaterializedClipDecode(filePath) {
  defaultExecFileSync(process.env.FFMPEG_PATH || "ffmpeg", [
    "-nostdin",
    "-v", "error",
    "-xerror",
    "-i", filePath,
    "-map", "0:v:0",
    "-f", "null",
    "-",
  ], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    available: true,
    decodable: true,
    full_clip: true,
  };
}

async function captureMaterializedClipEvidence(filePath, {
  generatedAt,
  materializedClipProbe = defaultMaterializedClipProbe,
  materializedClipDecode = defaultMaterializedClipDecode,
  expectedEvidence = null,
  expectedMedia = null,
  allowExpectedEvidenceCompletion = false,
} = {}) {
  const resolvedPath = path.resolve(cleanText(filePath));
  if (!resolvedPath || !(await fs.pathExists(resolvedPath))) {
    throw new Error("materialized_clip_file_missing");
  }
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile() || stat.size <= 0) throw new Error("materialized_clip_file_empty");
  const sha256 = await sha256File(resolvedPath);
  const normalizedExpectedEvidence =
    expectedEvidence &&
    typeof expectedEvidence === "object" &&
    Object.keys(expectedEvidence).length
      ? {
          sha256: cleanText(expectedEvidence.sha256),
          size_bytes: numberOrNull(expectedEvidence.size_bytes),
          duration_seconds: numberOrNull(expectedEvidence.duration_seconds),
          video_codec: cleanText(expectedEvidence.video_codec).toLowerCase(),
          width: numberOrNull(expectedEvidence.width),
          height: numberOrNull(expectedEvidence.height),
        }
      : null;
  if (normalizedExpectedEvidence) {
    const immutableMismatches = [];
    if (
      normalizedExpectedEvidence.sha256 &&
      normalizedExpectedEvidence.sha256 !== sha256
    ) {
      immutableMismatches.push("sha256");
    }
    if (
      normalizedExpectedEvidence.size_bytes != null &&
      normalizedExpectedEvidence.size_bytes !== stat.size
    ) {
      immutableMismatches.push("size_bytes");
    }
    if (immutableMismatches.length) {
      throw new Error(
        `materialized_clip_evidence_mismatch:${immutableMismatches.join(",")}`,
      );
    }
  }
  const probe = await Promise.resolve(materializedClipProbe(resolvedPath, expectedMedia || {}));
  let decode = null;
  try {
    decode = await Promise.resolve(materializedClipDecode(resolvedPath, expectedMedia || {}));
  } catch (error) {
    throw new Error(`materialized_clip_decode_failed:${cleanText(error.message)}`);
  }
  if (
    decode !== true &&
    !(decode?.available === true && decode?.decodable === true && decode?.full_clip === true)
  ) {
    throw new Error("materialized_clip_decode_failed:full_clip_decode_not_verified");
  }
  const postProbeStat = await fs.stat(resolvedPath);
  const postProbeSha256 = await sha256File(resolvedPath);
  if (
    !postProbeStat.isFile() ||
    postProbeStat.size !== stat.size ||
    postProbeSha256 !== sha256
  ) {
    throw new Error("materialized_clip_changed_during_evidence_capture");
  }
  const durationSeconds = numberOrNull(probe?.duration_seconds ?? probe?.duration_s ?? probe?.duration);
  const videoCodec = cleanText(probe?.video?.codec || probe?.video?.codec_name || probe?.video_codec).toLowerCase();
  const width = numberOrNull(probe?.video?.width ?? probe?.width);
  const height = numberOrNull(probe?.video?.height ?? probe?.height);
  if (
    probe?.available !== true ||
    probe?.decodable !== true ||
    !durationSeconds ||
    durationSeconds <= 0.2 ||
    !videoCodec ||
    !width ||
    width <= 0 ||
    !height ||
    height <= 0
  ) {
    throw new Error("materialized_clip_probe_incomplete");
  }
  const evidence = {
    schema_version: 1,
    captured_at: cleanText(generatedAt),
    sha256,
    size_bytes: stat.size,
    duration_seconds: durationSeconds,
    video_codec: videoCodec,
    width,
    height,
  };
  if (expectedMedia && typeof expectedMedia === "object") {
    const expectedDuration = numberOrNull(expectedMedia.duration_seconds);
    const expectedCodec = cleanText(expectedMedia.video_codec).toLowerCase();
    const expectedWidth = numberOrNull(expectedMedia.width);
    const expectedHeight = numberOrNull(expectedMedia.height);
    const mismatches = [];
    if (expectedDuration != null) {
      const tolerance = Math.max(0.12, expectedDuration * 0.04);
      if (Math.abs(expectedDuration - evidence.duration_seconds) > tolerance) {
        mismatches.push("duration_seconds");
      }
    }
    if (expectedCodec && evidence.video_codec !== expectedCodec) mismatches.push("video_codec");
    if (expectedWidth != null && evidence.width !== expectedWidth) mismatches.push("width");
    if (expectedHeight != null && evidence.height !== expectedHeight) mismatches.push("height");
    if (mismatches.length) {
      throw new Error(`materialized_clip_probe_contract_mismatch:${mismatches.join(",")}`);
    }
  }
  if (normalizedExpectedEvidence) {
    const expected = normalizedExpectedEvidence;
    const missing = Object.entries(expected)
      .filter(([, value]) => value === "" || value == null)
      .map(([field]) => field);
    if (missing.length && allowExpectedEvidenceCompletion !== true) {
      throw new Error(`materialized_clip_evidence_incomplete:${missing.join(",")}`);
    }
    const mismatches = [];
    if (expected.sha256 && expected.sha256 !== evidence.sha256) mismatches.push("sha256");
    if (expected.size_bytes != null && expected.size_bytes !== evidence.size_bytes) {
      mismatches.push("size_bytes");
    }
    if (
      expected.duration_seconds != null &&
      Math.abs(expected.duration_seconds - evidence.duration_seconds) > 0.05
    ) {
      mismatches.push("duration_seconds");
    }
    if (expected.video_codec && expected.video_codec !== evidence.video_codec) {
      mismatches.push("video_codec");
    }
    if (expected.width != null && expected.width !== evidence.width) mismatches.push("width");
    if (expected.height != null && expected.height !== evidence.height) mismatches.push("height");
    if (mismatches.length) {
      throw new Error(`materialized_clip_evidence_mismatch:${mismatches.join(",")}`);
    }
  }
  return evidence;
}

function materializedEvidenceBlocker(error) {
  const reason = cleanText(error?.message);
  if (reason.startsWith("materialized_clip_evidence_mismatch:")) {
    return "materialized_clip_evidence_mismatch";
  }
  if (reason.startsWith("materialized_clip_evidence_conflict:")) {
    return "materialized_clip_evidence_mismatch";
  }
  if (reason.startsWith("materialized_clip_evidence_incomplete:")) {
    return "materialized_clip_evidence_incomplete";
  }
  if (reason.startsWith("materialized_clip_probe_contract_mismatch:")) {
    return "materialized_clip_probe_contract_mismatch";
  }
  if (reason.startsWith("materialized_clip_decode_failed:")) {
    return "materialized_clip_decode_failed";
  }
  return "materialized_clip_evidence_unavailable";
}

function existingMaterializedFileEvidence(clip = {}) {
  const topLevel = {
    sha256: cleanText(clip.asset_sha256 || clip.sha256),
    size_bytes: numberOrNull(clip.asset_size_bytes ?? clip.size_bytes),
    duration_seconds: numberOrNull(
      clip.probed_duration_seconds ?? clip.duration_seconds ?? clip.materialized_duration_s,
    ),
    video_codec: cleanText(clip.video_codec),
    width: numberOrNull(clip.width),
    height: numberOrNull(clip.height),
  };
  const hasTopLevelEvidence = Object.values(topLevel).some(
    (value) => value !== "" && value != null,
  );
  const nested = clip.materialized_file_evidence &&
    typeof clip.materialized_file_evidence === "object" &&
    !Array.isArray(clip.materialized_file_evidence)
    ? clip.materialized_file_evidence
    : null;
  const immutableFields = [
    "sha256",
    "size_bytes",
    "duration_seconds",
    "video_codec",
    "width",
    "height",
  ];
  const hasNestedEvidence = Boolean(
    nested && immutableFields.some((field) => hasOwn(nested, field)),
  );
  if (hasNestedEvidence) {
    const nestedComparable = {
      sha256: cleanText(nested.sha256),
      size_bytes: numberOrNull(nested.size_bytes),
      duration_seconds: numberOrNull(nested.duration_seconds),
      video_codec: cleanText(nested.video_codec).toLowerCase(),
      width: numberOrNull(nested.width),
      height: numberOrNull(nested.height),
    };
    const conflicts = immutableFields.filter((field) => {
      const topValue = topLevel[field];
      const nestedValue = nestedComparable[field];
      if (topValue === "" || topValue == null || nestedValue === "" || nestedValue == null) {
        return false;
      }
      if (field === "duration_seconds") return Math.abs(topValue - nestedValue) > 0.05;
      return topValue !== nestedValue;
    });
    if (conflicts.length) {
      throw new Error(`materialized_clip_evidence_conflict:nested_top_level:${conflicts.join(",")}`);
    }
    return hasTopLevelEvidence ? { ...topLevel, ...nested } : nested;
  }
  return hasTopLevelEvidence ? topLevel : null;
}

function resolveClipVisualFingerprint(options = {}) {
  if (typeof options.clipVisualFingerprint === "function") return options.clipVisualFingerprint;
  return options.execFileSync ? null : fingerprintVideoClip;
}

async function filterVisuallyDistinctClips(clips = [], {
  clipVisualFingerprint,
  root = process.cwd(),
  storyId = "",
} = {}) {
  if (typeof clipVisualFingerprint !== "function") {
    return { clips: [...asArray(clips)], skipped: [], failures: [] };
  }
  const accepted = [];
  const acceptedFingerprints = [];
  const skipped = [];
  const failures = [];
  for (const clip of asArray(clips)) {
    let fingerprint = null;
    try {
      fingerprint = await clipVisualFingerprint(clip, { root, storyId, candidate: clip });
    } catch (error) {
      failures.push({
        id: cleanText(clip.id),
        source_url: cleanText(clip.source_url),
        reason: "visual_fingerprint_error",
        error: cleanText(error.message),
      });
      continue;
    }
    if (!fingerprint) {
      failures.push({
        id: cleanText(clip.id),
        source_url: cleanText(clip.source_url),
        reason: "visual_fingerprint_unavailable",
      });
      continue;
    }
    const duplicate = acceptedFingerprints
      .map((entry) => ({
        ...entry,
        comparison: compareVideoFingerprints(entry.fingerprint, fingerprint),
      }))
      .find((entry) => entry.comparison.near_duplicate);
    if (duplicate) {
      skipped.push({
        id: cleanText(clip.id),
        source_family: cleanText(clip.source_family),
        source_url: cleanText(clip.source_url),
        matched_clip_id: duplicate.clip_id,
        comparison: duplicate.comparison,
      });
      continue;
    }
    accepted.push({ ...clip, visual_content_fingerprint: fingerprint });
    acceptedFingerprints.push({ clip_id: cleanText(clip.id), fingerprint });
  }
  return { clips: accepted, skipped, failures };
}

function safeFileStem(value) {
  return (
    cleanText(value)
      .replace(/[^a-z0-9_-]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 90) || "asset"
  );
}

function sourceUrlFamilyKey(value) {
  const text = cleanText(value);
  if (!text) return "";
  try {
    const url = new URL(text);
    const canonicalMotionSource = canonicaliseMotionSourceUrl(text);
    if (canonicalMotionSource.startsWith("youtube:")) {
      return canonicalMotionSource.toLowerCase();
    }
    url.search = "";
    url.hash = "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host.endsWith("steamstatic.com") && url.pathname.includes("/store_trailers/")) {
      const pathname = url.pathname.toLowerCase();
      const basePath = pathname.replace(
        /\/(?:hls[^/]*\.m3u8|dash[^/]*\.mpd|[^/]+\.(?:mp4|webm|mov))(?:$|[?#])/i,
        "",
      );
      return `steamstatic:${basePath}`;
    }
    if (host.endsWith("steamstatic.com") && url.pathname.includes("/store_item_assets/steam/apps/")) {
      const pathname = url.pathname.toLowerCase();
      const basePath = pathname.replace(/\/extras\/([^/.]+)\.(?:mp4|webm|mov|mkv)$/i, "/extras/$1");
      if (basePath !== pathname) return `steamstatic:${basePath}`;
    }
    return `url:${url.toString().toLowerCase()}`;
  } catch {
    return "";
  }
}

function sourceUrlLooksLikeDirectMedia(value) {
  const text = cleanText(value);
  if (!text) return false;
  try {
    const url = new URL(text);
    if (!new Set(["http:", "https:"]).has(url.protocol)) return false;
    return /\.(?:mp4|mov|webm|mkv|m3u8|mpd)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function familyBaseKey(value) {
  const text = cleanText(value);
  if (!text) return "";
  const urlText = text.startsWith("url:") ? text.slice(4) : text;
  const urlKey = sourceUrlFamilyKey(urlText);
  if (urlKey) return urlKey;
  return text
    .replace(/_window_\d+(?:_\d+)?$/i, "")
    .replace(/[-_]window[-_]\d+(?:[-_]\d+)?$/i, "")
    .replace(/\|window\|\d+(?:\|\d+)?$/i, "");
}

function clipLooksDirectVideo(clip = {}) {
  const text = lowerText([
    clip.media_kind,
    clip.mediaKind,
    clip.source_url_kind,
    clip.source_kind,
    clip.source_type,
    clip.provider,
    clip.path,
    clip.source_url,
    clip.url,
  ].join(" "));
  return (
    text.includes("direct_video") ||
    text.includes("hls_manifest") ||
    text.includes("dash_manifest") ||
    text.includes("steam_movie") ||
    text.includes("official_trailer") ||
    text.includes("official_video") ||
    text.includes("official_platform_product_page") ||
    text.includes("licensed_direct_media") ||
    /\.(?:mp4|mov|webm|mkv|m3u8|mpd)(?:$|[?#])/i.test(cleanText(clip.path || clip.source_url || clip.url))
  );
}

function directMotionBaseSourceFamily(clip = {}, index = 0) {
  const youtubeVideoId = firstSourceIdentityValue(clip, [
    "youtube_video_id",
    "source_youtube_id",
  ]);
  const explicitCanonicalSource = firstSourceIdentityValue(clip, [
    "canonical_source_url",
    "master_source_url",
    "original_source_url",
    "reference_url",
  ]);
  const canonicalSourceIdentity = canonicaliseMotionSourceUrl(
    explicitCanonicalSource,
  );
  const directSourceReference = cleanText(
    clip.source_url || clip.source || clip.path,
  );
  const directSourceHasMediaIdentity = sourceUrlLooksLikeDirectMedia(
    directSourceReference,
  );
  const canonicalSourceHasMediaIdentity = sourceUrlLooksLikeDirectMedia(
    explicitCanonicalSource,
  );
  const sourceMasterSha256 = firstSourceIdentityValue(clip, [
    "source_master_sha256",
    "master_sha256",
    "base_source_sha256",
    "original_source_sha256",
    "master_content_sha256",
  ]).replace(/^sha256:/i, "").toLowerCase();
  if (youtubeVideoId) {
    return `youtube:${youtubeVideoId}`;
  }
  if (
    canonicalSourceIdentity &&
    explicitCanonicalSource !== directSourceReference &&
    (!directSourceHasMediaIdentity ||
      canonicalSourceHasMediaIdentity ||
      canonicalSourceIdentity.startsWith("youtube:"))
  ) {
    return canonicalSourceIdentity;
  }
  if (/^[a-f0-9]{64}$/.test(sourceMasterSha256)) {
    return `sha256:${sourceMasterSha256}`;
  }
  const sourceKey = sourceUrlFamilyKey(clip.source_url || clip.source || clip.path);
  if (clipLooksDirectVideo(clip) && sourceKey) {
    return sourceKey;
  }
  const baseFamily = familyBaseKey(
    clip.base_source_family ||
      clip.original_source_family ||
      clip.provenance?.base_source_family ||
      clip.provenance?.source_family,
  );
  if (baseFamily) return baseFamily;
  if (sourceKey) return sourceKey;
  return familyBaseKey(clip.source_family || clip.motion_family || clip.family) ||
    cleanText(`source_family_${index + 1}`);
}

function directMotionWindowKey(clip = {}, index = 0) {
  const baseFamily = directMotionBaseSourceFamily(clip, index);
  const start = numberOrNull(clip.mediaStartS ?? clip.media_start_s ?? clip.materialized_media_start_s) || 0;
  const duration = numberOrNull(clip.durationS ?? clip.duration_s ?? clip.materialized_duration_s) || 0;
  return [
    baseFamily || cleanText(clip.source_url || clip.path || clip.id || `direct_motion_${index + 1}`),
    start.toFixed(2),
    duration.toFixed(2),
  ].join("|");
}

function overlappingDirectMotionWindow(candidate = {}, selected = [], index = 0) {
  const baseFamily = directMotionBaseSourceFamily(candidate, index);
  if (!baseFamily) return null;
  const start = numberOrNull(candidate.mediaStartS ?? candidate.media_start_s) || 0;
  const duration = numberOrNull(candidate.durationS ?? candidate.duration_s) || 0;
  if (duration <= 0) return null;
  return asArray(selected).find((clip, clipIndex) => {
    if (directMotionBaseSourceFamily(clip, clipIndex) !== baseFamily) return false;
    const existingStart = numberOrNull(clip.mediaStartS ?? clip.media_start_s) || 0;
    const existingDuration = numberOrNull(clip.durationS ?? clip.duration_s) || 0;
    return start < existingStart + existingDuration - 0.05 &&
      start + duration > existingStart + 0.05;
  }) || null;
}

function directMotionSegmentFamily(clip = {}, index = 0) {
  const explicitFamily = cleanText(clip.source_family || clip.motion_family || clip.visual_family || clip.id);
  const baseFamily = directMotionBaseSourceFamily(clip, index);
  const start = numberOrNull(clip.mediaStartS ?? clip.media_start_s ?? clip.materialized_media_start_s);
  const duration = numberOrNull(clip.durationS ?? clip.duration_s ?? clip.materialized_duration_s);
  const hasWindowFamily = /(?:^|[_|-])window[_|-]?\d/i.test(explicitFamily);
  if (explicitFamily && hasWindowFamily) return explicitFamily;
  if (explicitFamily && !baseFamily) return explicitFamily;
  const windowSuffix =
    start != null || duration != null
      ? `window_${String((start || 0).toFixed(2)).replace(/\.00$/, "")}_${String((duration || 0).toFixed(2)).replace(/\.00$/, "")}`
          .replace(/[^0-9a-z]+/gi, "_")
          .replace(/^_+|_+$/g, "")
      : "";
  if (baseFamily && windowSuffix) return `${baseFamily}_${windowSuffix}`;
  return explicitFamily || baseFamily || cleanText(`source_family_${index + 1}`);
}

function directMotionReadinessFamily(clip = {}, index = 0) {
  if (clipLooksDirectVideo(clip)) {
    return directMotionSegmentFamily(clip, index);
  }
  const sourceKey = sourceUrlFamilyKey(clip.source_url || clip.source || clip.path);
  const baseFamily = familyBaseKey(
    clip.base_source_family ||
      clip.original_source_family ||
      clip.provenance?.base_source_family ||
      clip.provenance?.source_family,
  );
  if (baseFamily) return baseFamily;
  if (sourceKey) return sourceKey;
  return familyBaseKey(clip.source_family || clip.motion_family || clip.family) ||
    cleanText(`source_family_${index + 1}`);
}

function motionReadinessFamilies(rows = []) {
  return [
    ...new Set(
      asArray(rows)
        .map((clip, index) => directMotionReadinessFamily(clip, index))
        .filter(Boolean),
    ),
  ];
}

function genuineBaseSourceFamilies(rows = []) {
  return [
    ...new Set(
      asArray(rows)
        .filter((clip) =>
          cleanText(clip.media_kind || clip.mediaKind || "direct_video") === "direct_video" &&
          clipLooksDirectVideo(clip),
        )
        .map((clip, index) => directMotionBaseSourceFamily(clip, index))
        .filter(Boolean),
    ),
  ];
}

function sourceIdentityOwners(value = {}) {
  return [
    value,
    value.provenance,
    value.source_identity,
    value.motion_source_identity,
  ].filter((owner) => owner && typeof owner === "object");
}

function firstSourceIdentityValue(value = {}, fields = []) {
  for (const owner of sourceIdentityOwners(value)) {
    for (const field of fields) {
      const candidate = cleanText(owner[field]);
      if (candidate) return candidate;
    }
  }
  return "";
}

function explicitCanonicalSourceUrl(value = {}) {
  const explicit = firstSourceIdentityValue(value, [
    "canonical_source_url",
    "master_source_url",
    "original_source_url",
    "reference_url",
  ]);
  const sourceUrl = cleanText(value.source_url || value.sourceUrl);
  const explicitAlias = canonicaliseMotionSourceUrl(explicit);
  if (
    sourceUrlLooksLikeDirectMedia(sourceUrl) &&
    explicitAlias &&
    !explicitAlias.startsWith("youtube:") &&
    !sourceUrlLooksLikeDirectMedia(explicit)
  ) {
    return sourceUrl;
  }
  if (explicitAlias) return explicit;
  return canonicaliseMotionSourceUrl(sourceUrl) ? sourceUrl : "";
}

function sampledVisualFingerprintValue(value = {}) {
  const explicit = firstSourceIdentityValue(value, [
    "sampled_visual_fingerprint",
    "master_visual_fingerprint",
    "source_visual_fingerprint",
  ]);
  const normalise = (candidate) => {
    const text = cleanText(candidate).toLowerCase().replace(/\s+/g, "");
    return text.length >= 8 && /^[a-z0-9:+/_=-]+$/.test(text)
      ? text.replace(/^fingerprint:/, "")
      : "";
  };
  if (explicit) return normalise(explicit);
  const fingerprint = value.visual_content_fingerprint;
  if (!fingerprint || typeof fingerprint !== "object") return "";
  if (cleanText(fingerprint.algorithm) === "opaque-test-signature") return "";
  return normalise(fingerprint.signature);
}

function sourceIdentityFields(value = {}) {
  const canonicalSourceUrl = explicitCanonicalSourceUrl(value);
  const youtubeVideoId = firstSourceIdentityValue(value, [
    "youtube_video_id",
    "source_youtube_id",
  ]);
  const sourceMasterSha256 = firstSourceIdentityValue(value, [
    "source_master_sha256",
    "master_sha256",
    "base_source_sha256",
    "original_source_sha256",
    "master_content_sha256",
  ]).replace(/^sha256:/i, "").toLowerCase();
  const sampledVisualFingerprint = sampledVisualFingerprintValue(value);
  return {
    canonical_source_url: canonicalSourceUrl || undefined,
    youtube_video_id: youtubeVideoId || undefined,
    source_master_sha256: /^[a-f0-9]{64}$/.test(sourceMasterSha256)
      ? sourceMasterSha256
      : undefined,
    sampled_visual_fingerprint: sampledVisualFingerprint || undefined,
  };
}

function sourceIdentityProvenance(value = {}) {
  const candidates = [
    value.source_identity_provenance,
    value.sourceIdentityProvenance,
    value.provenance?.source_identity_provenance,
    value.provenance?.sourceIdentityProvenance,
  ];
  const provenance = candidates.find(
    (candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate),
  );
  return provenance ? structuredClone(provenance) : undefined;
}

function sourceIdentityConflicts(value = {}) {
  return [...new Set([
    ...asArray(value.source_identity_conflicts),
    ...asArray(value.sourceIdentityConflicts),
    ...asArray(value.provenance?.source_identity_conflicts),
  ].map(cleanText).filter(Boolean))];
}

function trustedLocalSourceMasterPath(root = process.cwd(), value = {}) {
  const explicitPath = firstSourceIdentityValue(value, [
    "source_master_path",
    "master_source_path",
    "original_source_path",
    "source_asset_path",
  ]);
  const sourceRef = cleanText(value.source_url || value.sourceUrl || value.path);
  const candidatePath = cleanText(explicitPath || (!/^https?:\/\//i.test(sourceRef) ? sourceRef : ""));
  if (!candidatePath) return "";
  const resolved = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(root, candidatePath);
  const relative = normalisePathText(path.relative(path.resolve(root), resolved));
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith("../") ||
    path.isAbsolute(relative) ||
    (!relative.startsWith("output/") && !relative.startsWith("test/output/"))
  ) {
    return "";
  }
  return /\.(?:mp4|mov|mkv|webm)$/i.test(resolved) ? resolved : "";
}

function sourceIdentitySidecarPaths(masterPath = "") {
  if (!cleanText(masterPath)) return [];
  const parsed = path.parse(masterPath);
  return [...new Set([
    path.join(parsed.dir, `${parsed.name}.info.json`),
    `${masterPath}.info.json`,
  ])];
}

async function readYtDlpSourceIdentitySidecar(masterPath = "") {
  for (const sidecarPath of sourceIdentitySidecarPaths(masterPath)) {
    if (!(await fs.pathExists(sidecarPath))) continue;
    let sidecar;
    try {
      sidecar = await fs.readJson(sidecarPath);
    } catch {
      return {
        status: "blocked",
        fields: {},
        conflicts: ["professional_motion_source_sidecar_unreadable"],
        provenance: {
          kind: "yt_dlp_info_sidecar",
          status: "blocked",
          sidecar_path: sidecarPath,
        },
      };
    }

    const canonicalSourceUrl = cleanText(sidecar.webpage_url || sidecar.original_url);
    const canonicalAlias = canonicaliseMotionSourceUrl(canonicalSourceUrl);
    const youtubeVideoId = cleanText(sidecar.id);
    const youtubeAlias = canonicalAlias.startsWith("youtube:")
      ? canonicalAlias.slice("youtube:".length)
      : "";
    const extractor = lowerText(sidecar.extractor_key || sidecar.extractor);
    const masterStem = path.parse(masterPath).name;
    const sidecarMatchesMaster = Boolean(
      youtubeVideoId &&
      (masterStem === youtubeVideoId || masterStem.startsWith(`${youtubeVideoId}_`)),
    );
    const conflicts = [];
    if (!extractor.includes("youtube")) {
      conflicts.push("professional_motion_source_sidecar_extractor_untrusted");
    }
    if (!youtubeAlias || !youtubeVideoId || youtubeAlias !== youtubeVideoId) {
      conflicts.push("professional_motion_source_sidecar_youtube_identity_conflict");
    }
    if (!sidecarMatchesMaster) {
      conflicts.push("professional_motion_source_sidecar_master_mismatch");
    }
    const provenance = {
      schema_version: 1,
      kind: "yt_dlp_info_sidecar",
      status: conflicts.length ? "blocked" : "resolved",
      sidecar_path: sidecarPath,
      sidecar_sha256: await sha256File(sidecarPath),
      canonical_source_url: canonicalSourceUrl || undefined,
      youtube_video_id: youtubeVideoId || undefined,
      extractor: cleanText(sidecar.extractor || sidecar.extractor_key),
      uploader: cleanText(sidecar.uploader || sidecar.channel) || undefined,
      channel: cleanText(sidecar.channel || sidecar.uploader) || undefined,
      title: cleanText(sidecar.title) || undefined,
    };
    const fields = {
      canonical_source_url: canonicalSourceUrl || undefined,
      youtube_video_id: youtubeVideoId || undefined,
    };
    if (conflicts.length) {
      return { status: "blocked", fields, conflicts, provenance };
    }
    return {
      status: "resolved",
      fields,
      conflicts: [],
      provenance,
    };
  }
  return { status: "missing", fields: {}, conflicts: [], provenance: null };
}

function isCanonicalYoutubeChannelUrl(value = "") {
  try {
    const parsed = new URL(cleanText(value));
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return parsed.protocol === "https:" &&
      host === "youtube.com" &&
      /^\/@[A-Za-z0-9._-]+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function readPulseSourceIdentitySidecar(masterPath = "", currentMasterSha256 = "") {
  if (!cleanText(masterPath)) {
    return { status: "missing", fields: {}, conflicts: [], provenance: null };
  }
  const parsedMaster = path.parse(masterPath);
  const sidecarPath = path.join(parsedMaster.dir, `${parsedMaster.name}.source-identity.json`);
  if (!(await fs.pathExists(sidecarPath))) {
    return { status: "missing", fields: {}, conflicts: [], provenance: null };
  }
  let sidecar;
  try {
    sidecar = await fs.readJson(sidecarPath);
  } catch {
    return {
      status: "blocked",
      fields: {},
      conflicts: ["professional_motion_source_identity_sidecar_unreadable"],
      provenance: {
        kind: "pulse_source_identity_sidecar",
        status: "blocked",
        sidecar_path: sidecarPath,
        identity_scope: "source_identity_only",
        rights_grant: false,
      },
    };
  }

  const canonicalSourceUrl = cleanText(sidecar.canonical_source_url);
  const canonicalAlias = canonicaliseMotionSourceUrl(canonicalSourceUrl);
  const youtubeVideoId = cleanText(sidecar.youtube_video_id);
  const canonicalYoutubeId = canonicalAlias.startsWith("youtube:")
    ? canonicalAlias.slice("youtube:".length)
    : "";
  const channelIdentity = sidecar.channel_identity && typeof sidecar.channel_identity === "object"
    ? sidecar.channel_identity
    : {};
  const authorName = cleanText(channelIdentity.author_name);
  const authorUrl = cleanText(channelIdentity.author_url);
  const sidecarMasterSha256 = cleanText(sidecar.source_master_sha256)
    .replace(/^sha256:/i, "")
    .toLowerCase();
  const evidence = sidecar.evidence && typeof sidecar.evidence === "object"
    ? sidecar.evidence
    : {};
  const verifiedAt = cleanText(evidence.verified_at);
  const conflicts = [];
  if (
    cleanText(sidecar.schema) !== PULSE_SOURCE_IDENTITY_SIDECAR_SCHEMA ||
    Number(sidecar.schema_version) !== 1
  ) {
    conflicts.push("professional_motion_source_identity_sidecar_schema_invalid");
  }
  if (cleanText(sidecar.producer) !== PULSE_SOURCE_IDENTITY_SIDECAR_PRODUCER) {
    conflicts.push("professional_motion_source_identity_sidecar_producer_invalid");
  }
  if (!youtubeVideoId || !canonicalYoutubeId || canonicalYoutubeId !== youtubeVideoId) {
    conflicts.push("professional_motion_source_identity_sidecar_youtube_identity_conflict");
  }
  if (
    !youtubeVideoId ||
    !(parsedMaster.name === youtubeVideoId || parsedMaster.name.startsWith(`${youtubeVideoId}_`))
  ) {
    conflicts.push("professional_motion_source_identity_sidecar_master_mismatch");
  }
  if (!authorName || !isCanonicalYoutubeChannelUrl(authorUrl)) {
    conflicts.push("professional_motion_source_identity_sidecar_channel_invalid");
  }
  if (
    !/^[a-f0-9]{64}$/.test(sidecarMasterSha256) ||
    sidecarMasterSha256 !== cleanText(currentMasterSha256).toLowerCase()
  ) {
    conflicts.push("professional_motion_source_sidecar_master_sha256_conflict");
  }
  if (cleanText(sidecar.identity_scope) !== "source_identity_only") {
    conflicts.push("professional_motion_source_identity_sidecar_scope_invalid");
  }
  if (sidecar.rights_grant !== false) {
    conflicts.push("professional_motion_source_identity_sidecar_rights_boundary_invalid");
  }
  if (
    cleanText(evidence.provider) !== "youtube_oembed" ||
    !verifiedAt ||
    !Number.isFinite(Date.parse(verifiedAt))
  ) {
    conflicts.push("professional_motion_source_identity_sidecar_evidence_invalid");
  }
  const provenance = {
    schema_version: 1,
    kind: "pulse_source_identity_sidecar",
    status: conflicts.length ? "blocked" : "resolved",
    sidecar_path: sidecarPath,
    sidecar_sha256: await sha256File(sidecarPath),
    schema: cleanText(sidecar.schema) || undefined,
    producer: cleanText(sidecar.producer) || undefined,
    canonical_source_url: canonicalSourceUrl || undefined,
    youtube_video_id: youtubeVideoId || undefined,
    channel_identity: {
      author_name: authorName || undefined,
      author_url: authorUrl || undefined,
    },
    source_master_sha256: sidecarMasterSha256 || undefined,
    identity_scope: cleanText(sidecar.identity_scope) || undefined,
    rights_grant: sidecar.rights_grant === false ? false : undefined,
    evidence: {
      provider: cleanText(evidence.provider) || undefined,
      verified_at: verifiedAt || undefined,
      title: cleanText(evidence.title) || undefined,
    },
  };
  const fields = {
    canonical_source_url: canonicalSourceUrl || undefined,
    youtube_video_id: youtubeVideoId || undefined,
    source_master_sha256: sidecarMasterSha256 || undefined,
  };
  if (conflicts.length) {
    return { status: "blocked", fields, conflicts, provenance };
  }
  return {
    status: "resolved",
    fields,
    conflicts: [],
    provenance,
  };
}

function reconcileRenamedYoutubeSourceIdentitySidecars(
  sidecars = [],
  currentMasterSha256 = "",
) {
  const ytDlp = sidecars.find(
    (entry) => entry?.provenance?.kind === "yt_dlp_info_sidecar",
  );
  const pulse = sidecars.find(
    (entry) => entry?.provenance?.kind === "pulse_source_identity_sidecar",
  );
  const ytDlpMismatchOnly =
    ytDlp?.status === "blocked" &&
    ytDlp.conflicts.length === 1 &&
    ytDlp.conflicts[0] === "professional_motion_source_sidecar_master_mismatch";
  const pulseMismatchOnly =
    pulse?.status === "blocked" &&
    pulse.conflicts.length === 1 &&
    pulse.conflicts[0] ===
      "professional_motion_source_identity_sidecar_master_mismatch";
  const ytDlpAlias = canonicaliseMotionSourceUrl(
    ytDlp?.fields?.canonical_source_url,
  );
  const pulseAlias = canonicaliseMotionSourceUrl(
    pulse?.fields?.canonical_source_url,
  );
  const sameYoutubeIdentity = Boolean(
    ytDlpAlias.startsWith("youtube:") &&
      ytDlpAlias === pulseAlias &&
      cleanText(ytDlp?.fields?.youtube_video_id) ===
        cleanText(pulse?.fields?.youtube_video_id),
  );
  const pulseBindsCurrentMaster =
    cleanText(pulse?.fields?.source_master_sha256).toLowerCase() ===
    cleanText(currentMasterSha256).toLowerCase();
  if (
    !ytDlpMismatchOnly ||
    !pulseMismatchOnly ||
    !sameYoutubeIdentity ||
    !pulseBindsCurrentMaster
  ) {
    return sidecars;
  }
  return sidecars.map((entry) => {
    if (entry !== ytDlp && entry !== pulse) return entry;
    return {
      ...entry,
      status: "resolved",
      conflicts: [],
      provenance: {
        ...entry.provenance,
        status: "resolved",
        legacy_master_name_reconciled: true,
        reconciliation_basis:
          "paired_ytdlp_identity_plus_sha_bound_pulse_oembed_identity",
      },
    };
  });
}

async function materializedSourceIdentityFields(value = {}, { root = process.cwd() } = {}) {
  const explicitFields = sourceIdentityFields(value);
  const explicitProvenance = sourceIdentityProvenance(value);
  const explicitConflicts = sourceIdentityConflicts(value);
  const masterPath = trustedLocalSourceMasterPath(root, value);
  if (!masterPath || !(await fs.pathExists(masterPath))) {
    return {
      ...explicitFields,
      source_identity_provenance: explicitProvenance,
      source_identity_conflicts: explicitConflicts,
    };
  }
  const currentMasterSha256 = await sha256File(masterPath);
  const sidecars = reconcileRenamedYoutubeSourceIdentitySidecars([
    await readYtDlpSourceIdentitySidecar(masterPath),
    await readPulseSourceIdentitySidecar(masterPath, currentMasterSha256),
  ], currentMasterSha256);
  const presentSidecars = sidecars.filter((sidecar) => sidecar.status !== "missing");
  const conflicts = [
    ...explicitConflicts,
    ...presentSidecars.flatMap((sidecar) => sidecar.conflicts),
  ];
  if (
    explicitFields.source_master_sha256 &&
    explicitFields.source_master_sha256 !== currentMasterSha256
  ) {
    conflicts.push("professional_motion_source_explicit_master_sha256_conflict");
  }
  const metadataFields = {};
  for (const sidecar of presentSidecars.filter((entry) => entry.status === "resolved")) {
    const currentCanonicalAlias = canonicaliseMotionSourceUrl(metadataFields.canonical_source_url);
    const nextCanonicalAlias = canonicaliseMotionSourceUrl(sidecar.fields.canonical_source_url);
    if (
      currentCanonicalAlias.startsWith("youtube:") &&
      nextCanonicalAlias.startsWith("youtube:") &&
      currentCanonicalAlias !== nextCanonicalAlias
    ) {
      conflicts.push("professional_motion_source_sidecar_canonical_url_conflict");
    }
    if (
      metadataFields.youtube_video_id &&
      sidecar.fields.youtube_video_id &&
      metadataFields.youtube_video_id !== sidecar.fields.youtube_video_id
    ) {
      conflicts.push("professional_motion_source_sidecar_youtube_id_conflict");
    }
    Object.assign(metadataFields, sidecar.fields);
  }
  const explicitCanonicalAlias = canonicaliseMotionSourceUrl(explicitFields.canonical_source_url);
  const sidecarCanonicalAlias = canonicaliseMotionSourceUrl(metadataFields.canonical_source_url);
  if (
    explicitCanonicalAlias.startsWith("youtube:") &&
    sidecarCanonicalAlias.startsWith("youtube:") &&
    explicitCanonicalAlias !== sidecarCanonicalAlias
  ) {
    conflicts.push("professional_motion_source_explicit_sidecar_url_conflict");
  }
  if (
    explicitFields.youtube_video_id &&
    metadataFields.youtube_video_id &&
    explicitFields.youtube_video_id !== metadataFields.youtube_video_id
  ) {
    conflicts.push("professional_motion_source_explicit_sidecar_youtube_id_conflict");
  }
  const explicitPresentFields = Object.fromEntries(
    Object.entries(explicitFields).filter(([, fieldValue]) => Boolean(cleanText(fieldValue))),
  );
  const fields = conflicts.length
    ? explicitFields
    : { ...metadataFields, ...explicitPresentFields };
  const provenanceSources = [
    explicitProvenance,
    ...presentSidecars.map((sidecar) => sidecar.provenance),
  ].filter(Boolean);
  const sourceIdentityProvenanceValue = provenanceSources.length <= 1
    ? provenanceSources[0]
    : {
        schema_version: 1,
        kind: "source_identity_evidence_bundle",
        status: conflicts.length ? "blocked" : "resolved",
        identity_scope: "source_identity_only",
        rights_grant: provenanceSources.every((source) => source.rights_grant === false)
          ? false
          : undefined,
        sources: provenanceSources,
      };
  return {
    ...fields,
    source_master_sha256: fields.source_master_sha256 || currentMasterSha256,
    source_identity_provenance: sourceIdentityProvenanceValue,
    source_identity_conflicts: [...new Set(conflicts)],
  };
}

function compoundMotionSourceIdentity(value = {}, index = 0) {
  const fields = sourceIdentityFields(value);
  const canonicalAlias = canonicaliseMotionSourceUrl(fields.canonical_source_url);
  const canonicalEvidencePresent = Boolean(canonicalAlias || fields.youtube_video_id);
  const contentEvidencePresent = Boolean(
    fields.source_master_sha256 || fields.sampled_visual_fingerprint,
  );
  const blockers = [];
  if (!canonicalEvidencePresent) {
    blockers.push("professional_motion_source_canonical_identity_missing");
  }
  if (!contentEvidencePresent) {
    blockers.push("professional_motion_source_content_identity_missing");
  }
  blockers.push(...asArray(value.source_identity_conflicts).map(cleanText));
  const resolved = resolveMotionSourceIdentity({
    id: value.id,
    path: value.path,
    ...fields,
  }, { clipIndex: index });
  blockers.push(...resolved.blockers);
  const status = blockers.length || !resolved.resolved ? "blocked" : "resolved";
  return {
    schema_version: 1,
    status,
    strict_pass: status === "resolved",
    compound_identity_required: true,
    ...fields,
    source_identity_provenance: value.source_identity_provenance || undefined,
    source_identity_conflicts: asArray(value.source_identity_conflicts).map(cleanText),
    base_source_asset_id: status === "resolved" ? resolved.base_source_asset_id : null,
    base_source_identity_basis: status === "resolved"
      ? resolved.base_source_identity_basis
      : null,
    aliases: status === "resolved" ? resolved.aliases : [],
    identity_evidence: status === "resolved" ? resolved.identity_evidence : [],
    rejected_identity_fields: resolved.rejected_identity_fields,
    blockers: [...new Set(blockers.filter(Boolean))],
  };
}

function isGovernedOwnedSupportMotion(row = {}) {
  const sourceMasterIdentity = isPlainObject(row.source_master_identity)
    ? row.source_master_identity
    : {};
  const rightsGrant = isPlainObject(row.rights_grant) ? row.rights_grant : {};
  const generatorProjectId = cleanText(row.generator_project_id);
  const sourceMasterSha256 = cleanText(row.source_master_sha256).toLowerCase();
  const identityMasterSha256 = cleanText(
    sourceMasterIdentity.source_master_sha256,
  ).toLowerCase();
  return Boolean(
    row.owned_explainer_visual_plan === true &&
    lowerText(row.source_type) === "internally_generated_motion_graphic" &&
    lowerText(row.media_kind) === "owned_explainer_motion" &&
    lowerText(row.source_url).startsWith("local://pulse-generated-motion/") &&
    lowerText(row.licence_basis || row.rights_basis) ===
      "owned_generated_editorial_motion_graphic" &&
    generatorProjectId &&
    lowerText(sourceMasterIdentity.identity_kind) ===
      "owned_generator_project_master" &&
    cleanText(sourceMasterIdentity.generator_project_id) === generatorProjectId &&
    /^[a-f0-9]{64}$/.test(sourceMasterSha256) &&
    sourceMasterSha256 === identityMasterSha256 &&
    lowerText(rightsGrant.grant_type) === "owned_generated" &&
    lowerText(rightsGrant.rights_holder) === "pulse gaming" &&
    lowerText(rightsGrant.granted_by) === "pulse gaming" &&
    rightsGrant.commercial_use_allowed === true &&
    rightsGrant.derivative_use_allowed === true
  );
}

function buildProfessionalSourceDiversity(rows = [], requiredBaseSourceCount = 2) {
  const allRows = asArray(rows);
  const governedOwnedSupportRows = allRows.filter(isGovernedOwnedSupportMotion);
  const evaluatedRows = allRows
    .filter((row) => !isGovernedOwnedSupportMotion(row))
    .map((row, index) => ({
      row,
      identity: row.motion_source_identity || compoundMotionSourceIdentity(row, index),
    }));
  const identityRows = evaluatedRows.map(({ row, identity }) => {
    return identity.status === "resolved"
      ? {
          id: row.id,
          path: row.path,
          canonical_source_url: identity.canonical_source_url,
          youtube_video_id: identity.youtube_video_id,
          source_master_sha256: identity.source_master_sha256,
          sampled_visual_fingerprint: identity.sampled_visual_fingerprint,
        }
      : { id: row.id, path: row.path };
  });
  const assessment = assessProfessionalSourceDiversity({
    clips: identityRows,
    scenes: identityRows,
    requiredBaseSources: Math.max(2, Number(requiredBaseSourceCount || 0)),
  });
  assessment.governed_owned_support_scene_count = governedOwnedSupportRows.length;
  const evaluatedById = new Map(
    evaluatedRows
      .filter(({ row }) => cleanText(row.id))
      .map((entry) => [cleanText(entry.row.id), entry]),
  );
  const evaluatedByPath = new Map(
    evaluatedRows
      .filter(({ row }) => cleanText(row.path))
      .map((entry) => [normalisePathText(entry.row.path).toLowerCase(), entry]),
  );
  assessment.unresolved_clips = asArray(assessment.unresolved_clips).map((unresolved) => {
    const evaluated = evaluatedById.get(cleanText(unresolved.clip_id)) ||
      evaluatedByPath.get(normalisePathText(unresolved.path).toLowerCase());
    if (!evaluated) return unresolved;
    return {
      ...unresolved,
      blockers: [...new Set([
        ...asArray(unresolved.blockers),
        ...asArray(evaluated.identity.blockers),
      ].map(cleanText).filter(Boolean))],
      source_identity_conflicts: asArray(
        evaluated.identity.source_identity_conflicts || evaluated.row.source_identity_conflicts,
      ).map(cleanText),
      source_identity_provenance:
        evaluated.identity.source_identity_provenance ||
        evaluated.row.source_identity_provenance ||
        undefined,
    };
  });
  assessment.identity_evidence = asArray(assessment.identity_evidence).map((source) => {
    const provenanceRows = evaluatedRows
      .filter(({ identity }) => identity.base_source_asset_id === source.base_source_asset_id)
      .map(({ identity, row }) => identity.source_identity_provenance || row.source_identity_provenance)
      .filter(Boolean)
      .filter((provenance, index, all) =>
        all.findIndex((candidate) =>
          cleanText(candidate.sidecar_sha256) === cleanText(provenance.sidecar_sha256) &&
          normalisePathText(candidate.sidecar_path).toLowerCase() ===
            normalisePathText(provenance.sidecar_path).toLowerCase(),
        ) === index,
      );
    return {
      ...source,
      source_identity_provenance: provenanceRows,
    };
  });
  return assessment;
}

function isRealMotionJob(job = {}) {
  return asArray(job.actions).some(
    (action) => cleanText(action.action_id) === "materialise_validated_real_motion_clips",
  );
}

function jobRequiresDirectVideoMotion(job = {}) {
  const blockers = [
    ...asArray(job.blockers),
    ...asArray(job.render_input_blockers),
    ...asArray(job.actions).flatMap((action) => asArray(action.reason_codes)),
  ];
  const markers = blockers.map(cleanText);
  return markers.includes(DIRECT_VIDEO_MOTION_BLOCKER) ||
    markers.some((marker) => marker.includes("direct_video_motion_clip_floor_not_met"));
}

function hasRealMotionSourceAcquisitionBlocker(job = {}) {
  if (cleanText(job.status) !== "blocked") return false;
  return asArray(job.blockers)
    .map(cleanText)
    .some((blocker) => REAL_MOTION_SOURCE_ACQUISITION_BLOCKERS.has(blocker));
}

function primaryRealMotionSourceBlocker(job = {}) {
  const blockers = asArray(job.blockers).map(cleanText);
  if (blockers.includes("direct_video_motion_clip_missing")) return "direct_video_motion_clip_missing";
  if (blockers.includes("validated_direct_media_candidates_missing")) return "validated_direct_media_candidates_missing";
  if (blockers.includes("visual_motion_duplicate_content_detected")) return "visual_motion_duplicate_content_detected";
  if (blockers.includes("real_motion_family_minimum_not_met")) return "real_motion_family_minimum_not_met";
  if (blockers.includes("real_motion_clip_minimum_not_met")) return "real_motion_clip_minimum_not_met";
  return blockers.find((blocker) => REAL_MOTION_SOURCE_ACQUISITION_BLOCKERS.has(blocker)) || "real_motion_source_missing";
}

function repairLaneForRealMotionSourceBlocker(job = {}) {
  const blocker = primaryRealMotionSourceBlocker(job);
  if (blocker === "direct_video_motion_clip_missing") return "direct_video_motion_source_acquisition";
  if (blocker === "validated_direct_media_candidates_missing") return "validated_direct_media_candidate_acquisition";
  return "real_motion_depth_acquisition";
}

function missingInputForRealMotionSourceBlocker(job = {}) {
  const blocker = primaryRealMotionSourceBlocker(job);
  if (blocker === "direct_video_motion_clip_missing") {
    return "Segment-validated direct-video, HLS or DASH motion from an official or licensed source. Screenshot-derived motion exists but cannot satisfy the direct-video gate.";
  }
  if (blocker === "validated_direct_media_candidates_missing") {
    return "Validated source-media candidates from official, licensed or operator-approved sources before local materialisation can run.";
  }
  return "Enough validated source-media candidates to produce at least five local motion clips across four distinct motion families.";
}

function expectedOutputForRealMotionSourceBlocker(job = {}) {
  const blocker = primaryRealMotionSourceBlocker(job);
  if (blocker === "direct_video_motion_clip_missing") {
    return [
      "source-family acquisition report with at least one segment-validation eligible direct-video, HLS or DASH candidate",
      "official direct-media discovery or licensed direct-media intake filled when automated source-family acquisition cannot prove a direct-video source",
      "motion pack manifest regenerated with direct-video candidates that can be materialised locally",
      "real motion materialisation rerun without direct_video_motion_clip_missing",
    ];
  }
  if (blocker === "validated_direct_media_candidates_missing") {
    return [
      "source-family acquisition report naming official, licensed or operator-approved media sources",
      "official search or direct-media intake template filled where no automated candidate exists",
      "motion pack manifest regenerated with validated source-media candidates",
      "real motion materialisation rerun with materialised clips and distinct source families",
    ];
  }
  return [
    "motion pack manifest enriched with additional validated source-media families",
    "real motion materialisation rerun with at least five local motion clips",
    "distinct motion family report showing at least four source families",
  ];
}

function requiredMotionPackPath(storyId) {
  const safeStoryId = safeFileStem(storyId);
  return path.join("output", "studio-v4", "motion-packs", `${safeStoryId}_motion_pack_manifest.json`);
}

function buildRealMotionSourceAcquisitionWorkOrder(report = {}) {
  const jobs = asArray(report.jobs)
    .filter(hasRealMotionSourceAcquisitionBlocker)
    .map((job) => {
      const storyId = cleanText(job.story_id);
      const artifactDir = cleanText(job.artifact_dir);
      const repairLane = repairLaneForRealMotionSourceBlocker(job);
      return {
        story_id: storyId,
        title: cleanText(job.title),
        artifact_dir: artifactDir || null,
        blocker_type: primaryRealMotionSourceBlocker(job),
        blockers: asArray(job.blockers).map(cleanText),
        repair_lane: repairLane,
        exact_missing_input: missingInputForRealMotionSourceBlocker(job),
        candidate_count: Number(job.candidate_count || 0),
        materialized_count: Number(job.materialized_count || 0),
        distinct_motion_family_count: Number(job.distinct_motion_family_count || 0),
        direct_video_motion_clip_count: Number(job.direct_video_motion_clip_count || 0),
        required_artefact_path: requiredMotionPackPath(storyId),
        recommended_command:
          `npm run ops:v4-source-family-acquisition -- --story-id ${storyId} --work-order output/goal-contract/render_input_work_order.json --output-json output/goal-04/studio_v4_source_family_acquisition_${storyId}.json --output-md output/goal-04/studio_v4_source_family_acquisition_${storyId}.md --intake-template output/goal-04/visual_v4_source_family_intake_template_${storyId}.json --search-template output/goal-04/visual_v4_official_search_template_${storyId}.json --json`,
        expected_output: expectedOutputForRealMotionSourceBlocker(job),
        db_mutation_required: false,
        operator_approval_required: true,
        post_repair_validation_command:
          `npm run ops:goal-real-motion -- --story-id ${storyId} --work-order output/goal-contract/render_input_work_order.json --out-dir output/goal-04 --json`,
      };
    });
  return {
    schema_version: 1,
    generated_at: report.generated_at || null,
    mode: "REAL_MOTION_SOURCE_ACQUISITION_WORK_ORDER",
    summary: {
      story_count: jobs.length,
      operator_required_count: jobs.filter((job) => job.operator_approval_required).length,
      auto_repairable_count: 0,
    },
    jobs,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  };
}

function normalisePathText(value) {
  return lowerText(value).replace(/\\/g, "/");
}

function hostText(value) {
  try {
    return new URL(cleanText(value)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function candidateSegmentValidationState(asset = {}) {
  const provenanceState = provenanceStateForAsset(asset);
  const provenance = provenanceState.validation;
  const status = cleanText(
    asset.segment_validation_status ||
      asset.segmentValidationStatus ||
      provenance.segment_validation_status ||
      provenance.validation_status ||
      provenance.status,
  );
  const statusText = lowerText(status);
  const explicitNegative =
    asset.segmentValidationPassed === false ||
    asset.segment_validation_passed === false ||
    asset.segment_validated === false ||
    provenance.segment_validated === false ||
    provenance.allowed_for_flash_lane === false ||
    Boolean(restrictiveValidationStatus(statusText));
  const affirmative = Boolean(
    asset.segmentValidationPassed === true ||
      asset.segment_validation_passed === true ||
      asset.segment_validated === true ||
      provenance.segment_validated === true ||
      ["validated", "pass", "passed", "green", "approved"].includes(statusText),
  );
  return {
    eligible: affirmative,
    affirmative: affirmative && !explicitNegative,
    status,
    provenanceState,
  };
}

function isOfficialSteamDirectMotionAsset(asset = {}) {
  const sourceUrl = cleanText(asset.source_url || asset.path);
  const host = hostText(sourceUrl);
  const sourceText = lowerText([
    asset.source_type,
    asset.source_kind,
    asset.source_url_kind,
    asset.provider,
    asset.source_family,
    asset.rights_risk_class,
  ].join(" "));
  const steamHost =
    host === "video.akamai.steamstatic.com" ||
    host.endsWith(".steamstatic.com") ||
    host.endsWith(".akamai.steamstatic.com");
  return (
    steamHost &&
    sourceText.includes("steam") &&
    sourceText.match(/movie|video|hls|dash|trailer|official_reference/) &&
    candidateSegmentValidationState(asset).eligible === true &&
    asset.validated !== false
  );
}

function isSegmentValidatedOfficialDirectMediaAsset(asset = {}) {
  const sourceUrl = cleanText(asset.source_url || asset.path);
  if (!isSafeDirectMediaUrl(sourceUrl)) return false;
  const sourceText = lowerText([
    asset.source_type,
    asset.source_kind,
    asset.source_url_kind,
    asset.provider,
    asset.rights_risk_class,
    asset.allowed_render_use,
    asset.provenance?.source,
    asset.provenance?.source_report,
    asset.provenance?.validation_reason,
  ].join(" "));
  return (
    asset.segmentValidationPassed === true &&
    asset.validated === true &&
    /direct_video|hls_manifest|dash_manifest|video/.test(sourceText) &&
    /official|licensed_direct_media|official_trailer_segment_validation/.test(sourceText) &&
    !/trusted_creator|creator_reference|reupload|compilation|reaction/.test(sourceText)
  );
}

function isPreviouslyMaterializedMotionRecord(asset = {}) {
  const pathText = normalisePathText(asset.path);
  const localPathText = normalisePathText(asset.local_materialized_path);
  const approvalStatus = lowerText(asset.approval_status);
  const sourceUrl = cleanText(asset.source_url);
  const hasLocalMaterializedPath = Boolean(
    asset.materialized === true ||
      localPathText ||
      pathText.includes("/output/video_cache/") ||
      pathText.includes("/output/goal-proof/") ||
      /(?:^|[/\\])output[/\\]video_cache[/\\]/i.test(cleanText(asset.path)),
  );
  if (hasLocalMaterializedPath) return true;
  return (
    approvalStatus === "approved_for_transformative_editorial_use" &&
    Boolean(sourceUrl) &&
    isSafeDirectMediaUrl(sourceUrl) &&
    !isSafeDirectMediaUrl(cleanText(asset.path))
  );
}

function resolveLocalMotionPath(root = process.cwd(), value = "") {
  const text = cleanText(value);
  if (!text || /^https?:\/\//i.test(text)) return "";
  return path.isAbsolute(text) ? text : path.resolve(root, text);
}

function isValidatedLocalOfficialMotionSource(asset = {}, { root = process.cwd() } = {}) {
  if (cleanText(asset.source_url_kind) !== "local_video_file") return false;
  if (asset.segmentValidationPassed !== true || asset.validated !== true) return false;
  if (asset.provenance?.segment_validated !== true || asset.provenance?.allowed_for_flash_lane !== true) {
    return false;
  }
  if (asset.commercial_use_allowed === false) return false;
  const risk = numberOrNull(asset.risk_score);
  if (risk != null && risk >= 0.65) return false;

  const localPath = resolveLocalMotionPath(root, asset.source_url || asset.path);
  if (!localPath || !fs.existsSync(localPath) || !/\.(?:mp4|mov|mkv|webm)$/i.test(localPath)) return false;
  const relative = path.relative(path.resolve(root), path.resolve(localPath));
  const relativePath = normalisePathText(relative);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    path.isAbsolute(relative) ||
    (!relativePath.startsWith("output/") && !relativePath.startsWith("test/output/"))
  ) {
    return false;
  }

  const evidence = lowerText([
    asset.source_type,
    asset.source_kind,
    asset.provider,
    asset.rights_risk_class,
    asset.allowed_render_use,
    asset.provenance?.source,
    asset.provenance?.source_report,
    asset.provenance?.validation_reason,
  ].join(" "));
  return (
    /\bofficial\b|official_|_official|official_trailer_segment_validation/.test(evidence) &&
    /segment|validator|validation|editorial_intake/.test(evidence) &&
    !/trusted_creator|creator_reference|reupload|compilation|reaction|fan[_ -]?made|unofficial/.test(evidence)
  );
}

function isRestorableMaterializedMotionPackClip(asset = {}, { root = process.cwd() } = {}) {
  const mediaKind = cleanText(asset.media_kind || asset.mediaKind || "direct_video");
  if (mediaKind !== "direct_video") return false;
  if (asset.counts_towards_motion_readiness !== true) return false;
  if (asset.materialized !== true && !cleanText(asset.local_materialized_path)) return false;
  const localPath = resolveLocalMotionPath(root, asset.local_materialized_path || asset.path);
  if (!localPath || !fs.existsSync(localPath)) return false;
  const sourceUrl = cleanText(asset.source_url || asset.source);
  if (!isSafeDirectMediaUrl(sourceUrl)) return false;
  if (asset.commercial_use_allowed === false) return false;
  const risk = numberOrNull(asset.risk_score);
  if (risk != null && risk >= 0.65) return false;
  return (
    isOfficialSteamDirectMotionAsset(asset) ||
    isSegmentValidatedOfficialDirectMediaAsset(asset) ||
    (
      asset.segmentValidationPassed === true &&
      asset.validated === true &&
      asset.provenance?.segment_validated === true &&
      /\bofficial|steam|storefront|licensed_direct_media\b/i.test(objectEvidenceText(asset))
    )
  );
}

function objectEvidenceText(value = {}) {
  if (!value || typeof value !== "object") return "";
  const strings = [];
  const visit = (item) => {
    if (typeof item === "string") strings.push(item);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") Object.values(item).forEach(visit);
  };
  visit(value);
  return strings.join(" ").toLowerCase();
}

function restorableMaterializedMotionPackClips(motionPack = {}, { root = process.cwd() } = {}) {
  if (!motionPackReady(motionPack)) return [];
  return asArray(motionPack.clips)
    .filter((clip) => isRestorableMaterializedMotionPackClip(clip, { root }))
    .map((clip) => {
      const localPath = resolveLocalMotionPath(root, clip.local_materialized_path || clip.path);
      return {
        ...clip,
        path: localPath,
        local_materialized_path: localPath,
        source_url: cleanText(clip.source_url || clip.source),
        media_kind: "direct_video",
        durationS: numberOrNull(clip.durationS ?? clip.duration_s) || 3,
        mediaStartS: numberOrNull(clip.mediaStartS ?? clip.media_start_s) || 0,
        source_type: cleanText(clip.source_type || clip.source_kind || "validated_direct_media"),
        rights_basis: cleanText(clip.rights_basis || clip.licence_basis || "official_direct_media"),
        counts_towards_motion_readiness: true,
        materialized: true,
      };
    });
}

async function readJsonIfPresent(filePath, fallback = {}) {
  try {
    if (filePath && await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

function isValidatedRealMotionAsset(asset = {}, { root = process.cwd() } = {}) {
  if (isPreviouslyMaterializedMotionRecord(asset)) return false;
  if (candidateSegmentValidationState(asset).eligible !== true) return false;
  const sourceUrl = cleanText(asset.source_url || asset.path);
  const validatedLocalOfficialSource = isValidatedLocalOfficialMotionSource(asset, { root });
  if (!validatedLocalOfficialSource && !isSafeDirectMediaUrl(sourceUrl)) return false;
  if (asset.segmentValidationPassed === false || asset.validated === false) return false;
  if (
    asset.trusted_source_matched === false &&
    !isOfficialSteamDirectMotionAsset(asset) &&
    !isSegmentValidatedOfficialDirectMediaAsset(asset)
  ) {
    return false;
  }
  if (asset.commercial_use_allowed === false) return false;
  const risk = numberOrNull(asset.risk_score);
  if (risk != null && risk >= 0.65) return false;
  const typeText = lowerText([
    asset.kind,
    asset.type,
    asset.asset_type,
    asset.source_type,
    asset.source_kind,
    asset.source_url_kind,
  ].join(" "));
  return (
    typeText.includes("video") ||
    typeText.includes("motion") ||
    typeText.includes("direct") ||
    /\.mp4(?:$|\?)/i.test(sourceUrl)
  );
}

function isSafeStillImageUrl(value) {
  const text = cleanText(value);
  if (!/^https?:\/\//i.test(text)) return false;
  if (!isSafeOutboundUrl(text)) return false;
  return /\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(text);
}

function isLocalImagePath(value) {
  const text = cleanText(value);
  if (!text || /^https?:\/\//i.test(text)) return false;
  return /\.(?:jpe?g|png|webp)$/i.test(text);
}

function isValidatedRealStillAsset(asset = {}) {
  if (isPreviouslyMaterializedMotionRecord(asset)) return false;
  if (asset.commercial_use_allowed === false) return false;
  const risk = numberOrNull(asset.risk_score);
  if (risk != null && risk >= 0.65) return false;
  const sourceType = lowerText([asset.source_type, asset.type, asset.kind, asset.asset_type].join(" "));
  const allowedStillType =
    sourceType.includes("screenshot") ||
    sourceType.includes("steam") ||
    sourceType.includes("hero") ||
    sourceType.includes("key_art") ||
    sourceType.includes("capsule") ||
    sourceType.includes("official_press_kit_stills") ||
    sourceType.includes("official_still") ||
    sourceType.includes("press_kit");
  if (!allowedStillType) return false;
  if (sourceType.includes("article") || sourceType.includes("rendered_story_card")) return false;
  const sourceRef = cleanText(asset.source_url);
  const pathRef = cleanText(asset.path);
  return isLocalImagePath(pathRef) || isSafeStillImageUrl(pathRef) || isSafeStillImageUrl(sourceRef);
}

function familyForAsset(asset = {}, index = 0) {
  return cleanText(
    asset.source_family ||
      asset.family ||
      asset.provider ||
      asset.id ||
      asset.asset_id ||
      asset.source_type ||
      `source_family_${index + 1}`,
  );
}

function normaliseCandidate(asset = {}, index = 0) {
  const sourceUrl = cleanText(asset.source_url || asset.path);
  const family = familyForAsset(asset, index);
  const baseSourceFamily = directMotionBaseSourceFamily(
    {
      ...asset,
      media_kind: "direct_video",
      source_family: family,
      source_url: sourceUrl,
      path: sourceUrl,
    },
    index,
  );
  const validationState = candidateSegmentValidationState(asset);
  const provenanceState = validationState.provenanceState;
  const validationConflicts = [...new Set([
    ...asArray(asset.validation_provenance_conflicts).map(cleanText),
    ...provenanceState.conflicts,
  ].filter(Boolean))];
  const timingProvenance = asset.provenance?.validator_trim_applied === true
    ? {
        media_start_s: numberOrNull(asset.mediaStartS ?? asset.media_start_s),
        duration_s: numberOrNull(asset.durationS ?? asset.duration_s),
        original_media_start_s: numberOrNull(asset.provenance?.original_media_start_s),
        original_duration_s: numberOrNull(asset.provenance?.original_duration_s),
        validator_trim_applied: true,
      }
    : {};
  return {
    id: cleanText(asset.id || asset.asset_id || `real_motion_${index + 1}`),
    media_kind: "direct_video",
    source_family: family,
    path: sourceUrl,
    source_url: sourceUrl,
    source_type: cleanText(asset.source_type || asset.source_kind || "validated_direct_media"),
    source_kind: cleanText(asset.source_kind),
    source_url_kind: cleanText(asset.source_url_kind),
    materialize_source_window: asset.materialize_source_window === true,
    provider: cleanText(asset.provider),
    base_source_family: baseSourceFamily,
    mediaStartS: numberOrNull(asset.mediaStartS ?? asset.media_start_s) || 0,
    durationS: Math.max(0.5, numberOrNull(asset.durationS ?? asset.duration_s) || 3),
    source_crop_top_px: Math.max(0, numberOrNull(asset.source_crop_top_px) || 0),
    source_crop_bottom_px: Math.max(0, numberOrNull(asset.source_crop_bottom_px) || 0),
    source_duration_s: numberOrNull(asset.source_duration_s ?? asset.sourceDurationS ?? asset.source_duration),
    licence_basis: cleanText(
      asset.licence_basis ||
        asset.license_basis ||
        asset.rights_basis ||
        asset.rights_risk_class ||
        "source_documented_transformative_editorial_use",
    ),
    allowed_use: cleanText(asset.allowed_use || asset.allowed_render_use || "transformative_editorial_short_form"),
    allowed_platforms: Array.isArray(asset.allowed_platforms) ? [...asset.allowed_platforms] : undefined,
    platform_restrictions: asset.platform_restrictions && typeof asset.platform_restrictions === "object"
      ? structuredClone(asset.platform_restrictions)
      : undefined,
    restricted_platforms: Array.isArray(asset.restricted_platforms) ? [...asset.restricted_platforms] : undefined,
    commercial_use_allowed:
      typeof asset.commercial_use_allowed === "boolean" ? asset.commercial_use_allowed : undefined,
    source_owner: cleanText(asset.source_owner || asset.entity || asset.provider || "source owner not specified"),
    ...sourceIdentityFields(asset),
    source_identity_provenance: sourceIdentityProvenance(asset),
    source_identity_conflicts: sourceIdentityConflicts(asset),
    risk_score: numberOrNull(asset.risk_score) ?? 0.28,
    evidence_reference: cleanText(asset.evidence_reference || asset.provenance?.source_report || sourceUrl),
    evidence_file: cleanText(asset.evidence_file || asset.rights_evidence_file) || undefined,
    rights_evidence_file:
      cleanText(asset.rights_evidence_file || asset.evidence_file) || undefined,
    evidence_kind: cleanText(asset.evidence_kind) || undefined,
    evidence_sha256:
      cleanText(asset.evidence_sha256 || asset.rights_evidence_sha256) || undefined,
    rights_evidence_sha256:
      cleanText(asset.rights_evidence_sha256 || asset.evidence_sha256) || undefined,
    evidence_size_bytes: numberOrNull(
      asset.evidence_size_bytes ?? asset.rights_evidence_size_bytes,
    ),
    rights_evidence_size_bytes: numberOrNull(
      asset.rights_evidence_size_bytes ?? asset.evidence_size_bytes,
    ),
    transformative_rights_evidence_verified:
      asset.transformative_rights_evidence_verified === true,
    rights_grant:
      asset.rights_grant && typeof asset.rights_grant === "object"
        ? structuredClone(asset.rights_grant)
        : asset.rights_grant,
    usage_scope: cleanText(asset.usage_scope) || undefined,
    rights_decision_basis: cleanText(asset.rights_decision_basis) || undefined,
    required_public_notice: cleanText(asset.required_public_notice) || undefined,
    required_rules_link: cleanText(asset.required_rules_link) || undefined,
    live_publish_allowed:
      typeof asset.live_publish_allowed === "boolean"
        ? asset.live_publish_allowed
        : undefined,
    requires_human_legal_review_before_publish:
      asset.requires_human_legal_review_before_publish === true,
    credit_required: typeof asset.credit_required === "boolean" ? asset.credit_required : undefined,
    validated: asset.validated === true ? true : undefined,
    segmentValidationPassed:
      validationState.affirmative === true
        ? true
        : undefined,
    segment_validation_status: validationState.status || undefined,
    validation_provenance: provenanceState.validation,
    transformation_provenance: {
      ...provenanceState.transformation,
      ...timingProvenance,
    },
    validation_provenance_conflicts: validationConflicts,
    rights_field_presence: rightsFieldPresence(asset),
    ...rightsStatusFields(asset),
    provenance: {
      ...provenanceState.validation,
      ...timingProvenance,
    },
  };
}

function normaliseStillCandidate(asset = {}, index = 0) {
  const pathRef = cleanText(asset.path);
  const sourceRef = cleanText(asset.source_url);
  const ref = isLocalImagePath(pathRef) ? pathRef : cleanText(pathRef || sourceRef);
  const sourceUrl = cleanText(sourceRef || ref);
  const family = familyForAsset(asset, index);
  const provenanceState = provenanceStateForAsset(asset);
  return {
    id: cleanText(asset.id || asset.asset_id || `real_still_${index + 1}`),
    media_kind: "visual_still",
    source_family: family,
    path: ref,
    source_url: sourceUrl || ref,
    source_type: cleanText(asset.source_type || asset.source_kind || "validated_visual_still"),
    mediaStartS: 0,
    durationS: Math.max(1.5, numberOrNull(asset.durationS ?? asset.duration_s) || 3),
    licence_basis: cleanText(
      asset.licence_basis ||
        asset.license_basis ||
        asset.rights_basis ||
        asset.rights_risk_class ||
        "source_documented_transformative_editorial_use",
    ),
    allowed_use: cleanText(asset.allowed_use || asset.allowed_render_use || "screenshot_derived_editorial_motion"),
    allowed_platforms: Array.isArray(asset.allowed_platforms) ? [...asset.allowed_platforms] : undefined,
    platform_restrictions: asset.platform_restrictions && typeof asset.platform_restrictions === "object"
      ? structuredClone(asset.platform_restrictions)
      : undefined,
    restricted_platforms: Array.isArray(asset.restricted_platforms) ? [...asset.restricted_platforms] : undefined,
    commercial_use_allowed:
      typeof asset.commercial_use_allowed === "boolean" ? asset.commercial_use_allowed : undefined,
    source_owner: cleanText(asset.source_owner || asset.entity || asset.provider || "source owner not specified"),
    risk_score: numberOrNull(asset.risk_score) ?? 0.32,
    evidence_reference: cleanText(asset.evidence_reference || asset.provenance?.source_report || sourceUrl || ref),
    credit_required: typeof asset.credit_required === "boolean" ? asset.credit_required : undefined,
    validation_provenance: provenanceState.validation,
    transformation_provenance: provenanceState.transformation,
    validation_provenance_conflicts: provenanceState.conflicts,
    rights_field_presence: rightsFieldPresence(asset),
    ...rightsStatusFields(asset),
    provenance: provenanceState.validation,
  };
}

function motionPackReady(motionPack = {}) {
  const status = cleanText(motionPack.readiness?.status || motionPack.status);
  return ["v4_motion_ready", "ready", "pass"].includes(status);
}

function motionEvidenceClaimsReady(evidence = {}) {
  const statuses = [
    evidence.status,
    evidence.readiness?.status,
    evidence.motion_budget?.status,
    evidence.motion_inventory?.status,
    evidence.motion_inventory?.readiness?.status,
  ].map(lowerText).filter(Boolean);
  return statuses.some((status) => ["v4_motion_ready", "ready", "pass", "passed", "green"].includes(status)) ||
    evidence.ready === true ||
    evidence.motion_ready === true ||
    evidence.can_publish === true ||
    evidence.counts_towards_final_render_readiness === true ||
    evidence.readiness?.ready === true ||
    evidence.readiness?.motion_ready === true ||
    evidence.readiness?.can_publish === true ||
    evidence.readiness?.counts_towards_final_render_readiness === true ||
    evidence.motion_budget?.ready === true ||
    evidence.motion_budget?.motion_ready === true ||
    evidence.motion_budget?.counts_towards_final_render_readiness === true ||
    evidence.motion_inventory?.ready === true ||
    evidence.motion_inventory?.motion_ready === true ||
    evidence.motion_inventory?.counts_towards_final_render_readiness === true ||
    evidence.motion_inventory?.readiness?.ready === true ||
    evidence.motion_inventory?.readiness?.motion_ready === true ||
    evidence.motion_inventory?.readiness?.can_publish === true;
}

function motionPackRows(motionPack = {}, { root = process.cwd() } = {}) {
  const clips = asArray(motionPack.clips).map((clip) => ({
    ...clip,
    source: "visual_v4_motion_pack",
  }));
  if (motionPackReady(motionPack)) return clips;
  return clips.filter((clip) => {
    const hasSegmentEvidence =
      clip.segmentValidationPassed === true ||
      clip.validated === true ||
      clip.provenance?.segment_validated === true ||
      clip.provenance?.allowed_for_flash_lane === true ||
      cleanText(clip.provenance?.segment_motion_class) === "gameplay_action";
    return hasSegmentEvidence && isValidatedRealMotionAsset(clip, { root });
  });
}

function segmentValidationRows(segmentValidationReport = {}, storyId = "") {
  const targetStoryId = cleanText(storyId);
  return asArray(segmentValidationReport.segments)
    .filter((segment) => {
      const status = cleanText(segment.status);
      if (targetStoryId && cleanText(segment.story_id) !== targetStoryId) return false;
      return (
        status === "validated" &&
        segment.segment_validated === true &&
        segment.allowed_for_flash_lane === true
      );
    })
    .map((segment, index) => {
      const sourceUrl = cleanText(segment.source_url);
      const sourceKey = sourceUrlFamilyKey(sourceUrl);
      const declaredSourceFamily = cleanText(
        segment.base_source_family ||
          segment.provenance?.base_source_family ||
          segment.source_family,
      );
      const baseSourceFamily = familyBaseKey(declaredSourceFamily) ||
        sourceKey ||
        `segment_source_family_${index + 1}`;
      const originalMediaStartS =
        numberOrNull(segment.mediaStartS ?? segment.media_start_s) || 0;
      const originalDurationS = Math.max(
        0.5,
        numberOrNull(segment.durationS ?? segment.duration_s) || 5,
      );
      const recommendedMediaStartS = numberOrNull(
        segment.recommendedMediaStartS ?? segment.recommended_media_start_s,
      );
      const recommendedDurationS = numberOrNull(
        segment.recommendedDurationS ?? segment.recommended_duration_s,
      );
      const validatorTrimRequested = segment.trim_recommended === true;
      const validatorTrimValid =
        validatorTrimRequested &&
        recommendedMediaStartS != null &&
        recommendedDurationS != null &&
        recommendedMediaStartS >= originalMediaStartS - 0.05 &&
        recommendedDurationS >= 0.5 &&
        recommendedMediaStartS + recommendedDurationS <=
          originalMediaStartS + originalDurationS + 0.05;
      if (validatorTrimRequested && !validatorTrimValid) return null;
      const mediaStartS = validatorTrimValid ? recommendedMediaStartS : originalMediaStartS;
      const durationS = validatorTrimValid ? recommendedDurationS : originalDurationS;
      const windowKey = `${String(mediaStartS.toFixed(2)).replace(/\.00$/, "")}_${String(durationS.toFixed(2)).replace(/\.00$/, "")}`
        .replace(/[^0-9a-z]+/gi, "_")
        .replace(/^_+|_+$/g, "");
      const motionFamily = `${baseSourceFamily}_window_${windowKey || index + 1}`;
      return {
        id: cleanText(segment.id || `segment_direct_motion_${index + 1}`),
        story_id: cleanText(segment.story_id),
        type: "motion_clip",
        source: "official_trailer_segment_validation",
        source_family: motionFamily,
        motion_family: motionFamily,
        base_source_family: baseSourceFamily,
        path: sourceUrl,
        source_url: sourceUrl,
        ...sourceIdentityFields(segment),
        source_kind: cleanText(segment.source_url_kind || "direct_video"),
        source_url_kind: cleanText(segment.source_url_kind || "direct_video"),
        materialize_source_window: cleanText(segment.source_url_kind) === "local_video_file",
        source_type: cleanText(segment.source_type || "licensed_direct_media_url"),
        provider: cleanText(segment.provider || "official_trailer_segment_validation"),
        entity: cleanText(segment.entity),
        source_owner: cleanText(segment.source_owner || segment.entity || segment.provider),
        mediaStartS,
        durationS,
        source_crop_top_px: Math.max(0, numberOrNull(segment.source_crop_top_px) || 0),
        source_crop_bottom_px: Math.max(0, numberOrNull(segment.source_crop_bottom_px) || 0),
        source_duration_s: numberOrNull(segment.source_duration_s),
        licence_basis: cleanText(
          segment.licence_basis ||
            segment.license_basis ||
            segment.rights_basis ||
            segment.rights_risk_class,
        ),
        allowed_use: cleanText(segment.allowed_use || segment.allowed_render_use),
        allowed_platforms: Array.isArray(segment.allowed_platforms)
          ? [...segment.allowed_platforms]
          : undefined,
        platform_restrictions:
          segment.platform_restrictions && typeof segment.platform_restrictions === "object"
            ? structuredClone(segment.platform_restrictions)
            : undefined,
        restricted_platforms: Array.isArray(segment.restricted_platforms)
          ? [...segment.restricted_platforms]
          : undefined,
        commercial_use_allowed:
          typeof segment.commercial_use_allowed === "boolean"
            ? segment.commercial_use_allowed
            : undefined,
        credit_required:
          typeof segment.credit_required === "boolean"
            ? segment.credit_required
            : undefined,
        evidence_reference: cleanText(
          segment.evidence_reference ||
            segment.provenance?.source_report ||
            segment.canonical_source_url ||
            sourceUrl,
        ),
        evidence_file:
          cleanText(segment.evidence_file || segment.rights_evidence_file) || undefined,
        rights_evidence_file:
          cleanText(segment.rights_evidence_file || segment.evidence_file) || undefined,
        evidence_kind: cleanText(segment.evidence_kind) || undefined,
        evidence_sha256:
          cleanText(segment.evidence_sha256 || segment.rights_evidence_sha256) || undefined,
        rights_evidence_sha256:
          cleanText(segment.rights_evidence_sha256 || segment.evidence_sha256) || undefined,
        evidence_size_bytes: numberOrNull(
          segment.evidence_size_bytes ?? segment.rights_evidence_size_bytes,
        ),
        rights_evidence_size_bytes: numberOrNull(
          segment.rights_evidence_size_bytes ?? segment.evidence_size_bytes,
        ),
        transformative_rights_evidence_verified:
          segment.transformative_rights_evidence_verified === true,
        rights_grant:
          segment.rights_grant && typeof segment.rights_grant === "object"
            ? structuredClone(segment.rights_grant)
            : segment.rights_grant,
        usage_scope: cleanText(segment.usage_scope) || undefined,
        rights_decision_basis: cleanText(segment.rights_decision_basis) || undefined,
        required_public_notice: cleanText(segment.required_public_notice) || undefined,
        required_rules_link: cleanText(segment.required_rules_link) || undefined,
        live_publish_allowed:
          typeof segment.live_publish_allowed === "boolean"
            ? segment.live_publish_allowed
            : undefined,
        requires_human_legal_review_before_publish:
          segment.requires_human_legal_review_before_publish === true,
        ...rightsStatusFields(segment),
        source_identity_provenance: sourceIdentityProvenance(segment),
        source_identity_conflicts: sourceIdentityConflicts(segment),
        validated: true,
        segmentValidationPassed: true,
        segment_validation_status: cleanText(
          segment.segment_validation_status || segment.status,
        ),
        validation_provenance_conflicts: asArray(
          segment.validation_provenance_conflicts,
        ).map(cleanText).filter(Boolean),
        trusted_source_matched: segment.trusted_source_matched !== false,
        rights_risk_class: cleanText(segment.rights_risk_class || "official_direct_media"),
        allowed_render_use: cleanText(segment.allowed_render_use || "official_direct_media_segment_candidate"),
        risk_score: numberOrNull(segment.risk_score) ?? 0.28,
        validation_provenance:
          segment.validation_provenance && typeof segment.validation_provenance === "object"
            ? structuredClone(segment.validation_provenance)
            : undefined,
        provenance: {
          ...(segment.provenance || {}),
          source: segment.provenance?.source || "official_trailer_segment_validation",
          validation_reason: segment.validation_reason,
          segment_validated: segment.segment_validated,
          allowed_for_flash_lane: segment.allowed_for_flash_lane,
          source_duration_s: numberOrNull(segment.source_duration_s),
           base_source_family: baseSourceFamily,
           motion_family_basis: "validated_official_segment_window",
           media_start_s: mediaStartS,
           duration_s: durationS,
           original_media_start_s: originalMediaStartS,
           original_duration_s: originalDurationS,
           validator_trim_applied: validatorTrimValid,
         },
       };
     })
     .filter(Boolean);
}

function segmentValidationStoryIds(segmentValidationReport = {}) {
  const storyIds = new Set();
  for (const segment of asArray(segmentValidationReport.segments)) {
    const storyId = cleanText(segment.story_id);
    if (!storyId) continue;
    const status = cleanText(segment.status);
    if (
      status === "validated" &&
      segment.segment_validated === true &&
      segment.allowed_for_flash_lane === true
    ) {
      storyIds.add(storyId);
    }
  }
  return [...storyIds];
}

function resolveMaybeRootedPath(root, value) {
  const text = cleanText(value);
  if (!text) return "";
  return path.isAbsolute(text) ? path.resolve(text) : path.resolve(root, text);
}

function segmentValidationEntity(segmentValidationReport = {}, storyId = "") {
  const targetStoryId = cleanText(storyId);
  const row = asArray(segmentValidationReport.segments).find(
    (segment) => cleanText(segment.story_id) === targetStoryId && cleanText(segment.entity),
  );
  return cleanText(row?.entity);
}

function syntheticSegmentValidationJobs({
  root = process.cwd(),
  artifactRoot = "",
  segmentValidationReport = {},
  requestedStoryIds = new Set(),
  existingStoryIds = new Set(),
} = {}) {
  const artifactRootPath = resolveMaybeRootedPath(root, artifactRoot);
  if (!artifactRootPath) return [];
  return segmentValidationStoryIds(segmentValidationReport)
    .filter((storyId) => !requestedStoryIds.size || requestedStoryIds.has(storyId))
    .filter((storyId) => !existingStoryIds.has(storyId))
    .map((storyId) => ({
      story_id: storyId,
      title: segmentValidationEntity(segmentValidationReport, storyId),
      artifact_dir: path.join(artifactRootPath, storyId),
      status: "blocked_on_render_inputs",
      blockers: [],
      actions: [
        {
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["validated_segment_report_artifact_root_repair"],
        },
      ],
    }));
}

function candidateRows({
  root = process.cwd(),
  rightsLedger = {},
  footageInventory = {},
  motionPack = {},
  segmentValidationReport = {},
  storyId = "",
} = {}) {
  const rows = [
    ...asArray(rightsLedger.assets),
    ...asArray(rightsLedger.records),
    ...asArray(rightsLedger.matched_assets),
    ...asArray(footageInventory.motion_inventory?.accepted_local_clips),
    ...asArray(footageInventory.motion_inventory?.production_motion_clips),
    ...asArray(footageInventory.accepted_local_clips),
    ...asArray(footageInventory.production_motion_clips),
    ...motionPackRows(motionPack, { root }),
    ...segmentValidationRows(segmentValidationReport, storyId),
  ];
  const byKey = new Map();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    let candidate = null;
    if (isValidatedRealMotionAsset(row, { root })) candidate = normaliseCandidate(row, index);
    else if (isValidatedRealStillAsset(row)) candidate = normaliseStillCandidate(row, index);
    if (!candidate) continue;
    const key = `${candidate.media_kind}|${candidate.source_url}|${candidate.mediaStartS.toFixed(2)}|${candidate.durationS.toFixed(2)}`;
    if (!byKey.has(key)) byKey.set(key, candidate);
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.media_kind !== b.media_kind) return a.media_kind === "direct_video" ? -1 : 1;
    return 0;
  });
}

function mergePreservedMotionEvidence(existing = {}, incoming = {}) {
  const merged = { ...existing };
  for (const field of ["approval_status", "rights_status", "usage_status", "status", "verdict"]) {
    const values = [existing[field], incoming[field]].map(cleanText).filter(Boolean);
    merged[field] = values.find((value) => restrictiveRightsStatus(value)) || values[0] || "";
  }
  const risks = [existing.risk_score, incoming.risk_score]
    .map(numberOrNull)
    .filter((value) => value != null);
  merged.risk_score = risks.length ? Math.max(...risks) : null;
  if (existing.commercial_use_allowed === false || incoming.commercial_use_allowed === false) {
    merged.commercial_use_allowed = false;
  } else if (
    existing.commercial_use_allowed === true ||
    incoming.commercial_use_allowed === true
  ) {
    merged.commercial_use_allowed = true;
  }
  const existingAllowedPlatforms = Array.isArray(existing.allowed_platforms)
    ? existing.allowed_platforms.map(cleanText).filter(Boolean)
    : null;
  const incomingAllowedPlatforms = Array.isArray(incoming.allowed_platforms)
    ? incoming.allowed_platforms.map(cleanText).filter(Boolean)
    : null;
  if (existingAllowedPlatforms && incomingAllowedPlatforms) {
    const incomingSet = new Set(
      normalisedRightsPlatformSet(incomingAllowedPlatforms),
    );
    merged.allowed_platforms = existingAllowedPlatforms.filter((platform) =>
      incomingSet.has(normaliseRightsPlatform(platform)),
    );
  } else if (existingAllowedPlatforms || incomingAllowedPlatforms) {
    merged.allowed_platforms = [...(existingAllowedPlatforms || incomingAllowedPlatforms)];
  }
  merged.restricted_platforms = [
    ...new Set([
      ...asArray(existing.restricted_platforms),
      ...asArray(incoming.restricted_platforms),
    ].map(cleanText).filter(Boolean)),
  ];
  merged.platform_restrictions = {
    ...(existing.platform_restrictions || {}),
    ...(incoming.platform_restrictions || {}),
  };
  if (
    existing.live_publish_allowed === false ||
    incoming.live_publish_allowed === false
  ) {
    merged.live_publish_allowed = false;
  } else if (
    existing.live_publish_allowed === true &&
    incoming.live_publish_allowed === true
  ) {
    merged.live_publish_allowed = true;
  }
  merged.requires_human_legal_review_before_publish = Boolean(
    existing.requires_human_legal_review_before_publish === true ||
      incoming.requires_human_legal_review_before_publish === true,
  );
  for (const field of [
    "usage_scope",
    "rights_decision_basis",
    "required_public_notice",
    "required_rules_link",
  ]) {
    merged[field] = cleanText(existing[field] || incoming[field]) || undefined;
  }
  merged.validation_provenance_conflicts = [
    ...new Set([
      ...asArray(existing.validation_provenance_conflicts),
      ...asArray(incoming.validation_provenance_conflicts),
    ].map(cleanText).filter(Boolean)),
  ];
  merged.rights_field_presence = Object.fromEntries(
    Object.keys({
      ...(existing.rights_field_presence || {}),
      ...(incoming.rights_field_presence || {}),
    }).map((field) => [
      field,
      existing.rights_field_presence?.[field] === true ||
        incoming.rights_field_presence?.[field] === true,
    ]),
  );
  return merged;
}

function existingMotionClipRows(footageInventory = {}) {
  const rows = [
    ...asArray(footageInventory.motion_inventory?.production_motion_clips),
    ...asArray(footageInventory.motion_inventory?.accepted_local_clips),
    ...asArray(footageInventory.production_motion_clips),
    ...asArray(footageInventory.accepted_local_clips),
  ];
  const byKey = new Map();
  for (const [index, asset] of rows.entries()) {
    const pathText = cleanText(asset.path || asset.local_materialized_path || asset.file);
    const family = familyForAsset(asset, index);
    const duration = numberOrNull(asset.durationS ?? asset.duration_s ?? asset.duration);
    if (!pathText || !family || !duration || duration < 1.2) continue;
    const mediaStartS = numberOrNull(asset.mediaStartS ?? asset.media_start_s) || 0;
    const provenanceState = provenanceStateForAsset(asset);
    const provenance = provenanceState.validation;
    const provenanceValidated =
      provenance.segment_validated === true && provenance.allowed_for_flash_lane === true;
    const row = {
      id: cleanText(asset.id || asset.clip_id || `existing_motion_${index + 1}`),
      path: pathText,
      source_url: cleanText(asset.source_url || asset.source || pathText),
      source_master_path: cleanText(
        asset.source_master_path ||
          asset.sourceMasterPath ||
          asset.master_source_path ||
          asset.original_source_path,
      ) || undefined,
      source_family: family,
      base_source_family: cleanText(asset.base_source_family || asset.provenance?.base_source_family),
      motion_family: cleanText(asset.motion_family || asset.source_family || family),
      source_type: cleanText(asset.source_type || asset.sourceType || asset.source_kind || "existing_motion"),
      source_kind: cleanText(asset.source_kind) || undefined,
      source_url_kind: cleanText(asset.source_url_kind) || undefined,
      media_kind: cleanText(asset.media_kind || asset.mediaKind || "owned_motion"),
      durationS: duration,
      mediaStartS,
      source_duration_s: numberOrNull(
        asset.source_duration_s ||
          asset.sourceDurationS ||
          asset.validation_provenance?.source_duration_s ||
          asset.provenance?.source_duration_s,
      ),
      rights_basis: cleanText(asset.rights_basis || asset.licence_basis || asset.license_basis),
      licence_basis: cleanText(asset.licence_basis || asset.license_basis || asset.rights_basis),
      allowed_use: cleanText(asset.allowed_use || asset.allowed_render_use),
      allowed_platforms: Array.isArray(asset.allowed_platforms) ? [...asset.allowed_platforms] : undefined,
      platform_restrictions: asset.platform_restrictions && typeof asset.platform_restrictions === "object"
        ? structuredClone(asset.platform_restrictions)
        : undefined,
      restricted_platforms: Array.isArray(asset.restricted_platforms) ? [...asset.restricted_platforms] : undefined,
      commercial_use_allowed:
        typeof asset.commercial_use_allowed === "boolean" ? asset.commercial_use_allowed : undefined,
      credit_required: typeof asset.credit_required === "boolean" ? asset.credit_required : undefined,
      evidence_reference: cleanText(asset.evidence_reference),
      evidence_file: cleanText(asset.evidence_file) || undefined,
      rights_evidence_file:
        cleanText(asset.rights_evidence_file || asset.evidence_file) || undefined,
      evidence_kind: cleanText(asset.evidence_kind) || undefined,
      evidence_sha256:
        cleanText(asset.evidence_sha256 || asset.rights_evidence_sha256) || undefined,
      rights_evidence_sha256:
        cleanText(asset.rights_evidence_sha256 || asset.evidence_sha256) || undefined,
      evidence_size_bytes: numberOrNull(
        asset.evidence_size_bytes ?? asset.rights_evidence_size_bytes,
      ),
      rights_evidence_size_bytes: numberOrNull(
        asset.rights_evidence_size_bytes ?? asset.evidence_size_bytes,
      ),
      usage_scope: cleanText(asset.usage_scope) || undefined,
      rights_decision_basis: cleanText(asset.rights_decision_basis) || undefined,
      required_public_notice: cleanText(asset.required_public_notice) || undefined,
      required_rules_link: cleanText(asset.required_rules_link) || undefined,
      live_publish_allowed:
        typeof asset.live_publish_allowed === "boolean"
          ? asset.live_publish_allowed
          : undefined,
      requires_human_legal_review_before_publish:
        asset.requires_human_legal_review_before_publish === true,
      rights_grant:
        asset.rights_grant && typeof asset.rights_grant === "object"
          ? structuredClone(asset.rights_grant)
          : asset.rights_grant,
      owned_explainer_visual_plan: asset.owned_explainer_visual_plan === true,
      generator_project_id: cleanText(asset.generator_project_id) || undefined,
      source_master_identity:
        asset.source_master_identity && typeof asset.source_master_identity === "object"
          ? structuredClone(asset.source_master_identity)
          : undefined,
      transformative_rights_evidence_verified:
        asset.transformative_rights_evidence_verified === true,
      expiry: cleanText(asset.expiry) || undefined,
      risk_score: numberOrNull(asset.risk_score),
      rights_field_presence: asset.rights_field_presence || rightsFieldPresence(asset),
      counts_towards_motion_readiness: asset.counts_towards_motion_readiness === true,
      materialized: asset.materialized !== false,
      local_materialized_path: cleanText(asset.local_materialized_path || pathText),
      materialized_file_evidence: asset.materialized_file_evidence || undefined,
      asset_sha256: cleanText(asset.asset_sha256 || asset.sha256) || undefined,
      asset_size_bytes: numberOrNull(asset.asset_size_bytes ?? asset.size_bytes),
      probed_duration_seconds: numberOrNull(asset.probed_duration_seconds ?? asset.duration_seconds),
      video_codec: cleanText(asset.video_codec) || undefined,
      width: numberOrNull(asset.width),
      height: numberOrNull(asset.height),
      validated:
        provenanceValidated || asset.validated === true
          ? true
          : asset.validated === false
            ? false
            : undefined,
      segmentValidationPassed:
        provenanceValidated ||
        asset.segmentValidationPassed === true ||
        asset.segment_validation_passed === true
          ? true
          : asset.segmentValidationPassed === false || asset.segment_validation_passed === false
            ? false
            : undefined,
      validation_provenance: provenanceState.validation,
      transformation_provenance: provenanceState.transformation,
      validation_provenance_conflicts: provenanceState.conflicts,
      ...sourceIdentityFields(asset),
      source_identity_provenance: sourceIdentityProvenance(asset),
      source_identity_conflicts: sourceIdentityConflicts(asset),
      base_source_asset_id: cleanText(asset.base_source_asset_id) || undefined,
      base_source_identity_basis: cleanText(asset.base_source_identity_basis) || undefined,
      motion_source_identity: asset.motion_source_identity || undefined,
      ...rightsStatusFields(asset),
      provenance,
    };
    const key = `${row.path}|${row.source_family}|${row.mediaStartS.toFixed(2)}|${row.durationS.toFixed(2)}`;
    if (!byKey.has(key)) byKey.set(key, row);
    else byKey.set(key, mergePreservedMotionEvidence(byKey.get(key), row));
  }
  return uniqueMotionRowIds([...byKey.values()]);
}

function directVideoMotionRows(rows = []) {
  return asArray(rows).filter((clip) => cleanText(clip.media_kind || "direct_video") === "direct_video");
}

function directVideoMotionFamilyCount(rows = []) {
  return motionReadinessFamilies(directVideoMotionRows(rows)).length;
}

function governedExistingDirectMotionRows(
  footageInventory = {},
  { allowInvalidatedReadiness = false } = {},
) {
  return existingMotionClipRows(footageInventory).filter((row) => {
    if (cleanText(row.media_kind) !== "direct_video") return false;
    if (
      row.materialized !== true ||
      (
        allowInvalidatedReadiness !== true &&
        row.counts_towards_motion_readiness !== true
      )
    ) {
      return false;
    }
    const provenance = row.provenance || {};
    if (provenance.segment_validated !== true || provenance.allowed_for_flash_lane !== true) {
      return false;
    }
    const evidence = lowerText([
      row.source_type,
      row.rights_basis,
      provenance.source,
      provenance.validation_reason,
    ].join(" "));
    return (
      /official|steam_movie|platform_storefront/.test(evidence) &&
      !/unofficial|reupload|reaction|compilation|trusted_creator/.test(evidence)
    );
  });
}

function selectorReportClaimsStrictProfessionalPass(report = {}) {
  const sourceDiversity = report.source_diversity || {};
  const professionalDiversity = report.professional_source_diversity || {};
  return (
    cleanText(report.policy_tier) === "ultimate_professional" &&
    asArray(report.blockers).length === 0 &&
    sourceDiversity.strict_pass === true &&
    asArray(sourceDiversity.reasons).length === 0 &&
    asArray(sourceDiversity.blockers).length === 0 &&
    cleanText(professionalDiversity.status) === "pass" &&
    professionalDiversity.strict_pass === true &&
    asArray(professionalDiversity.blockers).length === 0
  );
}

function selectorLocalRightsEvidenceMatches(clip = {}, { root = process.cwd() } = {}) {
  const evidencePathText = cleanText(
    clip.evidence_file || clip.rights_evidence_file,
  );
  const expectedSha256 = lowerText(
    clip.evidence_sha256 || clip.rights_evidence_sha256,
  );
  const expectedSize = numberOrNull(
    clip.evidence_size_bytes ?? clip.rights_evidence_size_bytes,
  );
  if (
    !evidencePathText ||
    !/^[a-f0-9]{64}$/.test(expectedSha256) ||
    expectedSize == null ||
    expectedSize <= 0 ||
    clip.rights_grant !== true
  ) {
    return false;
  }
  const evidencePath = path.isAbsolute(evidencePathText)
    ? path.resolve(evidencePathText)
    : path.resolve(root, evidencePathText);
  let stat;
  try {
    stat = fs.statSync(evidencePath);
  } catch {
    return false;
  }
  if (!stat.isFile() || stat.size !== expectedSize) return false;
  const actualSha256 = crypto
    .createHash("sha256")
    .update(fs.readFileSync(evidencePath))
    .digest("hex");
  return actualSha256 === expectedSha256;
}

function selectorClipRecoveryEvidenceComplete(
  clip = {},
  {
    root = process.cwd(),
    requireReadinessClaim = true,
    verifyAssetHash = false,
  } = {},
) {
  const filePath = cleanText(clip.local_materialized_path || clip.path || clip.file);
  if (!filePath || !fs.pathExistsSync(filePath)) return false;
  let fileEvidence;
  try {
    fileEvidence = existingMaterializedFileEvidence(clip);
  } catch {
    return false;
  }
  if (!evidenceSnapshotComplete(fileEvidence)) return false;
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile() || stat.size !== numberOrNull(fileEvidence.size_bytes)) return false;
  if (verifyAssetHash === true) {
    const expectedSha256 = lowerText(fileEvidence.sha256);
    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) return false;
    const actualSha256 = crypto
      .createHash("sha256")
      .update(fs.readFileSync(filePath))
      .digest("hex");
    if (actualSha256 !== expectedSha256) return false;
  }

  const rightsPresence = rightsFieldPresence(clip);
  const rightsEvidenceComplete = Boolean(
    cleanText(clip.evidence_reference) ||
      selectorLocalRightsEvidenceMatches(clip, { root }),
  );
  const rightsComplete = (
    rightsPresence.licence_basis &&
    rightsPresence.allowed_use &&
    rightsPresence.allowed_platforms &&
    rightsPresence.commercial_use_allowed &&
    rightsPresence.credit_required &&
    rightsEvidenceComplete &&
    rightsPresence.risk_score &&
    cleanText(clip.licence_basis || clip.license_basis || clip.rights_basis) &&
    cleanText(clip.allowed_use || clip.allowed_render_use) &&
    asArray(clip.allowed_platforms).map(cleanText).filter(Boolean).length > 0 &&
    typeof clip.commercial_use_allowed === "boolean" &&
    typeof clip.credit_required === "boolean" &&
    numberOrNull(clip.risk_score) != null
  );
  if (!rightsComplete) return false;

  const sourceIdentity = clip.motion_source_identity || {};
  return (
    clip.materialized === true &&
    (
      requireReadinessClaim !== true ||
      clip.counts_towards_motion_readiness === true
    ) &&
    clip.validated === true &&
    clip.segmentValidationPassed === true &&
    asArray(clip.validation_provenance_conflicts).length === 0 &&
    asArray(clip.source_identity_conflicts).length === 0 &&
    sourceIdentity.status === "resolved" &&
    sourceIdentity.strict_pass === true &&
    cleanText(sourceIdentity.base_source_asset_id || clip.base_source_asset_id) &&
    cleanText(sourceIdentity.base_source_identity_basis || clip.base_source_identity_basis) &&
    asArray(sourceIdentity.blockers).length === 0
  );
}

function declaredMotionEvidenceBlockers(evidence = {}) {
  return [...new Set([
    ...asArray(evidence.blockers),
    ...asArray(evidence.readiness?.blockers),
    ...asArray(evidence.motion_inventory?.blockers),
    ...asArray(evidence.motion_inventory?.readiness?.blockers),
  ].map(cleanText).filter(Boolean))];
}

const STALE_INVENTORY_RECOVERY_BLOCKERS = new Set([
  "validation_provenance_conflict",
  "refresh_window_plan_incomplete",
  "real_motion_clip_minimum_not_met",
  "real_motion_family_minimum_not_met",
  "genuine_base_source_minimum_not_met",
  "direct_video_motion_clip_missing",
  "direct_video_motion_clip_floor_not_met",
  "stale_ready_motion_manifest_unvalidated",
  "stale_ready_central_motion_pack_unvalidated",
  "stale_ready_owned_motion_manifest_unvalidated",
  "stale_ready_footage_inventory_unvalidated",
]);

function governedStaleInventoryRecoveryRows(
  footageInventory = {},
  materialisedArtifact = {},
  { root = process.cwd() } = {},
) {
  const footageStatus = lowerText(
    footageInventory.status ||
      footageInventory.readiness?.status ||
      footageInventory.verdict,
  );
  const priorBlockers = declaredMotionEvidenceBlockers(footageInventory);
  if (
    !materialisedArtifactClaimsReady(materialisedArtifact) ||
    !["blocked", "red", "fail", "failed", "v4_motion_blocked"].includes(footageStatus) ||
    priorBlockers.length === 0 ||
    priorBlockers.some((blocker) => !STALE_INVENTORY_RECOVERY_BLOCKERS.has(blocker))
  ) {
    return [];
  }

  const artifactClips = asArray(
    materialisedArtifact.clips || materialisedArtifact.materialised_clips,
  );
  const inventoryClips = asArray(
    footageInventory.motion_inventory?.production_motion_clips ||
      footageInventory.motion_inventory?.accepted_local_clips,
  );
  if (!artifactClips.length || inventoryClips.length !== artifactClips.length) return [];

  const inventoryByIdentity = new Map(
    inventoryClips
      .map((clip) => [exactClipIdentityKey(clip), clip])
      .filter(([key]) => key),
  );
  if (inventoryByIdentity.size !== inventoryClips.length) return [];

  const recovered = [];
  for (const clip of artifactClips) {
    const identity = exactClipIdentityKey(clip);
    if (
      !identity ||
      !inventoryByIdentity.has(identity) ||
      !selectorClipRecoveryEvidenceComplete(clip, {
        root,
        requireReadinessClaim: true,
        verifyAssetHash: true,
      }) ||
      !selectorLocalRightsEvidenceMatches(clip, { root })
    ) {
      return [];
    }
    recovered.push({
      ...clip,
      counts_towards_motion_readiness: true,
      recovery_provenance: {
        mode: "hash_bound_ready_materialised_inventory_reconciliation",
        prior_blockers: priorBlockers,
      },
    });
  }
  return recovered;
}

function governedRightsInvalidationRecoveryRows(
  footageInventory = {},
  materialisedArtifact = {},
  { root = process.cwd() } = {},
) {
  const combinedBlockers = [...new Set([
    ...declaredMotionEvidenceBlockers(materialisedArtifact),
    ...declaredMotionEvidenceBlockers(footageInventory),
  ])];
  if (
    lowerText(materialisedArtifact.status) !== "blocked" ||
    materialisedArtifact.ready === true ||
    materialisedArtifact.motion_ready === true ||
    combinedBlockers.length === 0 ||
    combinedBlockers.some((blocker) => blocker !== "rights_evidence_contradiction")
  ) {
    return [];
  }

  const artifactClips = asArray(
    materialisedArtifact.clips || materialisedArtifact.materialised_clips,
  );
  const inventoryClips = asArray(
    footageInventory.motion_inventory?.production_motion_clips ||
      footageInventory.motion_inventory?.accepted_local_clips,
  );
  if (!artifactClips.length || inventoryClips.length !== artifactClips.length) return [];

  const inventoryById = new Map(
    inventoryClips.map((clip) => [lowerText(clip.id || clip.clip_id), clip]),
  );
  const verifiedIds = new Set();
  for (const clip of artifactClips) {
    const id = lowerText(clip.id || clip.clip_id);
    const inventoryClip = inventoryById.get(id);
    if (
      !id ||
      !inventoryClip ||
      normalisePathText(clip.local_materialized_path || clip.path) !==
        normalisePathText(
          inventoryClip.local_materialized_path || inventoryClip.path,
        ) ||
      !selectorClipRecoveryEvidenceComplete(clip, {
        root,
        requireReadinessClaim: false,
        verifyAssetHash: true,
      })
    ) {
      return [];
    }
    verifiedIds.add(id);
  }

  const rows = governedExistingDirectMotionRows(footageInventory, {
    allowInvalidatedReadiness: true,
  }).filter((row) => verifiedIds.has(lowerText(row.id || row.clip_id)));
  if (rows.length !== artifactClips.length) return [];
  return rows.map((row) => ({
    ...row,
    counts_towards_motion_readiness: true,
    recovery_provenance: {
      mode: "hash_bound_rights_invalidation_recheck",
      prior_blockers: combinedBlockers,
    },
  }));
}

async function governedSelectorRecoveryRows(
  artifactDir = "",
  { root = process.cwd() } = {},
) {
  const reportPath = path.join(
    cleanText(artifactDir),
    "qa",
    "direct-motion",
    "final_selection_dense_selector_report.json",
  );
  if (!cleanText(artifactDir) || !(await fs.pathExists(reportPath))) return [];
  let report;
  try {
    report = await fs.readJson(reportPath);
  } catch {
    return [];
  }
  if (!selectorReportClaimsStrictProfessionalPass(report)) return [];
  const clips = asArray(report.clips);
  if (
    clips.length === 0 ||
    numberOrNull(report.selected_clip_count) !== clips.length ||
    !clips.every((clip) => selectorClipRecoveryEvidenceComplete(clip, { root }))
  ) {
    return [];
  }
  const rows = governedExistingDirectMotionRows({
    motion_inventory: {
      production_motion_clips: clips,
    },
  });
  return rows.length === clips.length ? rows : [];
}

function materialisedArtifactClaimsReady(materialisedArtifact = {}) {
  const status = lowerText(
    materialisedArtifact.status ||
      materialisedArtifact.readiness?.status ||
      materialisedArtifact.verdict,
  );
  return ["ready", "v4_motion_ready", "pass", "green"].includes(status);
}

function exactClipIdentityKey(clip = {}) {
  const id = lowerText(clip.id || clip.clip_id);
  const filePath = normalisePathText(
    clip.local_materialized_path || clip.path || clip.file,
  ).toLowerCase();
  return id && filePath ? `${id}|${filePath}` : "";
}

function evidenceSnapshotComplete(evidence = {}) {
  return Boolean(
    cleanText(evidence.sha256) &&
      numberOrNull(evidence.size_bytes) != null &&
      numberOrNull(evidence.duration_seconds) != null &&
      cleanText(evidence.video_codec) &&
      numberOrNull(evidence.width) != null &&
      numberOrNull(evidence.height) != null
  );
}

function evidenceSnapshotCoreComplete(evidence = {}) {
  return Boolean(
    cleanText(evidence.sha256) &&
      numberOrNull(evidence.size_bytes) != null &&
      numberOrNull(evidence.duration_seconds) != null,
  );
}

function independentlyBoundSourceMasterIdentity(value = {}) {
  const fields = sourceIdentityFields(value);
  const masterPath = cleanText(
    value.source_master_path ||
      value.sourceMasterPath ||
      value.master_source_path ||
      value.original_source_path,
  );
  return Boolean(
    masterPath &&
      (fields.canonical_source_url || fields.youtube_video_id) &&
      fields.source_master_sha256,
  );
}

function evidenceSnapshotConflicts(left = {}, right = {}) {
  const conflicts = [];
  if (cleanText(left.sha256) !== cleanText(right.sha256)) conflicts.push("sha256");
  if (numberOrNull(left.size_bytes) !== numberOrNull(right.size_bytes)) conflicts.push("size_bytes");
  if (Math.abs(numberOrNull(left.duration_seconds) - numberOrNull(right.duration_seconds)) > 0.05) {
    conflicts.push("duration_seconds");
  }
  if (lowerText(left.video_codec) !== lowerText(right.video_codec)) conflicts.push("video_codec");
  if (numberOrNull(left.width) !== numberOrNull(right.width)) conflicts.push("width");
  if (numberOrNull(left.height) !== numberOrNull(right.height)) conflicts.push("height");
  return conflicts;
}

function hydrateExactMaterialisedSourceIdentities(rows = [], materialisedArtifact = {}) {
  if (!materialisedArtifactClaimsReady(materialisedArtifact)) return [...asArray(rows)];
  const identityRows = new Map(
    asArray(materialisedArtifact.clips)
      .map((clip) => [exactClipIdentityKey(clip), clip])
      .filter(([key]) => key),
  );
  return asArray(rows).map((row) => {
    const identityRow = identityRows.get(exactClipIdentityKey(row));
    if (!identityRow) return row;
    const rowSource = normalisePathText(row.source_url || row.source).toLowerCase();
    const identitySource = normalisePathText(
      identityRow.source_url || identityRow.source,
    ).toLowerCase();
    if (!rowSource || !identitySource || rowSource !== identitySource) {
      return {
        ...row,
        source_identity_conflicts: [...new Set([
          ...sourceIdentityConflicts(row),
          "refresh_materialised_identity_source_mismatch",
        ])],
      };
    }
    let rowEvidence = null;
    let identityEvidence = null;
    try {
      rowEvidence = existingMaterializedFileEvidence(row);
      identityEvidence = existingMaterializedFileEvidence(identityRow);
    } catch (error) {
      return {
        ...row,
        source_identity_conflicts: [...new Set([
          ...sourceIdentityConflicts(row),
          `refresh_materialised_identity_${cleanText(error.message)}`,
        ])],
      };
    }
    if (!evidenceSnapshotComplete(rowEvidence) || !evidenceSnapshotComplete(identityEvidence)) {
      const coreConflicts = evidenceSnapshotConflicts(rowEvidence, identityEvidence).filter(
        (field) => ["sha256", "size_bytes", "duration_seconds"].includes(field),
      );
      const rowIdentity = sourceIdentityFields(row);
      const materialisedIdentity = sourceIdentityFields(identityRow);
      const sourceMasterConflict = Boolean(
        rowIdentity.source_master_sha256 &&
          materialisedIdentity.source_master_sha256 &&
          rowIdentity.source_master_sha256 !== materialisedIdentity.source_master_sha256,
      );
      if (
        evidenceSnapshotCoreComplete(rowEvidence) &&
        evidenceSnapshotCoreComplete(identityEvidence) &&
        coreConflicts.length === 0 &&
        !sourceMasterConflict &&
        independentlyBoundSourceMasterIdentity(row)
      ) {
        return {
          ...row,
          refresh_materialised_identity_warnings: [...new Set([
            ...asArray(row.refresh_materialised_identity_warnings).map(cleanText),
            "refresh_materialised_derivative_evidence_incomplete_source_master_revalidated",
          ].filter(Boolean))],
        };
      }
      return {
        ...row,
        source_identity_conflicts: [...new Set([
          ...sourceIdentityConflicts(row),
          "refresh_materialised_identity_evidence_incomplete",
        ])],
      };
    }
    const conflicts = evidenceSnapshotConflicts(rowEvidence, identityEvidence);
    if (conflicts.length) {
      return {
        ...row,
        source_identity_conflicts: [...new Set([
          ...sourceIdentityConflicts(row),
          `refresh_materialised_identity_evidence_conflict:${conflicts.join(",")}`,
        ])],
      };
    }
    return {
      ...row,
      ...sourceIdentityFields(identityRow),
      source_identity_provenance:
        sourceIdentityProvenance(identityRow) || sourceIdentityProvenance(row),
      source_identity_conflicts: [...new Set([
        ...sourceIdentityConflicts(row),
        ...sourceIdentityConflicts(identityRow),
      ])],
    };
  });
}

async function hydrateMaterialisedSourceIdentitiesFromLocalMasters(rows = [], {
  root = process.cwd(),
} = {}) {
  return Promise.all(asArray(rows).map(async (row, index) => {
    const scanned = await materializedSourceIdentityFields(row, { root });
    const merged = {
      ...row,
      ...scanned,
      source_identity_provenance:
        scanned.source_identity_provenance || sourceIdentityProvenance(row) || undefined,
      source_identity_conflicts: [...new Set([
        ...sourceIdentityConflicts(row),
        ...asArray(scanned.source_identity_conflicts).map(cleanText),
      ].filter(Boolean))],
    };
    const identity = compoundMotionSourceIdentity(merged, index);
    return {
      ...merged,
      base_source_asset_id: identity.status === "resolved"
        ? identity.base_source_asset_id
        : cleanText(row.base_source_asset_id) || undefined,
      base_source_identity_basis: identity.status === "resolved"
        ? identity.base_source_identity_basis
        : cleanText(row.base_source_identity_basis) || undefined,
      motion_source_identity: identity,
    };
  }));
}

function jobDirectVideoFloor(job = {}, fallback = DEFAULT_MIN_CLIPS) {
  const values = [
    job.render_input_evidence?.real_motion_input_readiness?.direct_video_motion_clip_floor,
    job.render_input_evidence?.direct_video_motion_clip_floor,
    job.evidence?.direct_video_motion_clip_floor,
    ...asArray(job.actions).map((action) => action.evidence?.direct_video_motion_clip_floor),
  ];
  for (const value of values) {
    const number = numberOrNull(value);
    if (number != null && number > 0) return number;
  }
  return Number(fallback || DEFAULT_MIN_CLIPS);
}

function requiredGenuineBaseSourceCount(job = {}, options = {}) {
  const configuredValues = [
    options.minBaseSources,
    job.min_genuine_base_source_count,
    job.required_genuine_base_source_count,
    job.shot_budget?.min_distinct_motion_base_sources,
    job.render_input_evidence?.real_motion_input_readiness?.required_genuine_base_source_count,
    job.render_input_evidence?.real_motion_input_readiness?.min_distinct_motion_base_sources,
    job.evidence?.required_genuine_base_source_count,
    ...asArray(job.actions).map((action) => action.evidence?.required_genuine_base_source_count),
  ];
  const configured = Math.max(0, ...configuredValues
    .map(numberOrNull)
    .filter((value) => value != null && value > 0));
  const strict = options.strictBaseSourceDiversity === true ||
    job.strict_base_source_diversity === true ||
    job.ultimate_quality_bar === true;
  if (strict) return Math.max(2, configured || 2);
  return configured > 0 ? Math.max(1, configured) : 0;
}

function recordedGenuineBaseSourceFloor(...artifacts) {
  const values = artifacts.flatMap((artifact = {}) => [
    artifact.minimum_requirements?.min_genuine_base_sources,
    artifact.motion_budget?.required_distinct_base_sources,
    artifact.professional_source_diversity?.required_genuine_base_source_count,
    artifact.readiness?.required_genuine_base_source_count,
    artifact.motion_inventory?.professional_source_diversity
      ?.required_genuine_base_source_count,
    artifact.handoff?.professional_source_diversity
      ?.required_genuine_base_source_count,
  ]);
  return Math.max(
    0,
    ...values
      .map(numberOrNull)
      .filter((value) => value != null && value > 0),
  );
}

function requiresProfessionalSourceIdentity(job = {}, options = {}) {
  return options.strictBaseSourceDiversity === true ||
    job.strict_base_source_diversity === true ||
    job.ultimate_quality_bar === true;
}

function jobNeedsDirectVideoFloorRepair(job = {}) {
  const markers = [
    ...asArray(job.blockers),
    ...asArray(job.render_input_blockers),
    ...asArray(job.actions).flatMap((action) => asArray(action.reason_codes)),
  ].map(cleanText);
  return markers.some((marker) => marker.includes("direct_video_motion_clip_floor_not_met"));
}

function jobIsValidatedSegmentArtifactRootRepair(job = {}) {
  return asArray(job.actions)
    .flatMap((action) => asArray(action.reason_codes))
    .map(cleanText)
    .includes("validated_segment_report_artifact_root_repair");
}

function isExpandableDirectVideoCandidate(candidate = {}) {
  if (cleanText(candidate.media_kind) !== "direct_video") return false;
  const sourceUrl = cleanText(candidate.path || candidate.source_url);
  if (!isSafeDirectMediaUrl(sourceUrl)) return false;
  const text = lowerText([
    candidate.source_type,
    candidate.source_kind,
    candidate.source_url_kind,
    candidate.provider,
    candidate.source_family,
    sourceUrl,
  ].join(" "));
  return /hls_manifest|dash_manifest|steam_movie|official_trailer|official_video|official_platform_product_page|platform_storefront|official_game_page_direct_video|trailer|gameplay|steamstatic|xboxservices/.test(text);
}

function expandDirectVideoWindowCandidates(candidates = [], { job = {}, minClips = DEFAULT_MIN_CLIPS, maxClips = 8 } = {}) {
  if (!jobNeedsDirectVideoFloorRepair(job)) return candidates;
  const directCandidates = candidates.filter((candidate) => cleanText(candidate.media_kind) === "direct_video");
  const floor = Math.max(1, jobDirectVideoFloor(job, minClips));
  const target = Math.min(Math.max(floor, directCandidates.length), Number(maxClips || 8));
  if (directCandidates.length >= target) return candidates;

  const expandedDirect = [...directCandidates];
  const seen = new Set(
    directCandidates.map((candidate) =>
      [
        cleanText(candidate.path || candidate.source_url),
        Number(candidate.mediaStartS || 0).toFixed(2),
        Number(candidate.durationS || 0).toFixed(2),
      ].join("|"),
    ),
  );
  let directCount = expandedDirect.length;
  for (const sourceCandidate of directCandidates) {
    if (directCount >= target) break;
    if (!isExpandableDirectVideoCandidate(sourceCandidate)) continue;
    const duration = Math.max(2, numberOrNull(sourceCandidate.durationS) || 3);
    const baseStart = Math.max(0, numberOrNull(sourceCandidate.mediaStartS) || 0);
    const sourceDuration = numberOrNull(sourceCandidate.source_duration_s);
    let generatedWindowIndex = 1;
    const step = duration + 0.5;
    for (let radius = 1; directCount < target && radius < 24; radius += 1) {
      const starts = [
        { start: baseStart - radius * step, direction: "before" },
        { start: baseStart + radius * step, direction: "after" },
      ];
      for (const startCandidate of starts) {
        if (directCount >= target) break;
        if (startCandidate.start < 0) continue;
        const start = Number(startCandidate.start.toFixed(2));
        if (sourceDuration != null && start + duration > sourceDuration) continue;
        const key = [
          cleanText(sourceCandidate.path || sourceCandidate.source_url),
          start.toFixed(2),
          duration.toFixed(2),
        ].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        generatedWindowIndex += 1;
        directCount += 1;
        expandedDirect.push({
          ...sourceCandidate,
          id: `${safeFileStem(sourceCandidate.id || sourceCandidate.source_family || "direct_video")}_window_${generatedWindowIndex}`,
          mediaStartS: start,
          durationS: duration,
          expanded_from_source_window: cleanText(sourceCandidate.id || sourceCandidate.source_family || sourceCandidate.source_url),
          source_window_index: generatedWindowIndex,
          source_window_direction: startCandidate.direction,
        });
      }
    }
    if (directCount >= target) break;
  }
  return [
    ...expandedDirect,
    ...candidates.filter((candidate) => cleanText(candidate.media_kind) !== "direct_video"),
  ];
}

function balanceDirectVideoCandidatesByBaseSource(candidates = []) {
  const groups = new Map();
  const groupOrder = [];
  const nonDirect = [];
  for (const candidate of asArray(candidates)) {
    if (cleanText(candidate.media_kind) !== "direct_video") {
      nonDirect.push(candidate);
      continue;
    }
    const key = directMotionBaseSourceFamily(candidate, groupOrder.length) || cleanText(candidate.source_family);
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key).push(candidate);
  }
  if (groupOrder.length <= 1) return candidates;
  const balanced = [];
  let round = 0;
  while (true) {
    let added = false;
    for (const key of groupOrder) {
      const candidate = groups.get(key)?.[round];
      if (!candidate) continue;
      balanced.push(candidate);
      added = true;
    }
    if (!added) break;
    round += 1;
  }
  return [...balanced, ...nonDirect];
}

function dynamicMaxDirectClipsPerBaseSource(candidates = [], {
  job = {},
  minClips = DEFAULT_MIN_CLIPS,
  minFamilies = DEFAULT_MIN_FAMILIES,
  maxClips = 8,
  explicitMax = null,
  hasRightsLedger = false,
} = {}) {
  const explicit = numberOrNull(explicitMax);
  if (explicit != null && explicit > 0) return Math.max(1, explicit);
  const directBaseSources = new Set();
  const directWindowKeysByBaseSource = new Map();
  asArray(candidates).forEach((candidate, index) => {
    if (cleanText(candidate.media_kind) !== "direct_video") return;
    const family = directMotionBaseSourceFamily(candidate, index);
    if (!family) return;
    directBaseSources.add(family);
    if (!directWindowKeysByBaseSource.has(family)) directWindowKeysByBaseSource.set(family, new Set());
    const windowKey = directMotionWindowKey(candidate, index);
    if (windowKey) directWindowKeysByBaseSource.get(family).add(windowKey);
  });
  const baseSourceCount = directBaseSources.size;
  const clipFloor = Math.max(
    1,
    Math.min(
      Number(maxClips || DEFAULT_MIN_CLIPS),
      Math.max(Number(minClips || DEFAULT_MIN_CLIPS), jobDirectVideoFloor(job, minClips)),
    ),
  );
  const familyFloor = Math.max(1, Number(minFamilies || DEFAULT_MIN_FAMILIES));
  if (hasRightsLedger && jobIsValidatedSegmentArtifactRootRepair(job) && baseSourceCount === 1) {
    const availableWindowCount = [...directWindowKeysByBaseSource.values()][0]?.size || 0;
    if (availableWindowCount >= 2 && clipFloor >= 2) return 2;
  }
  if (baseSourceCount === 2) {
    const totalDistinctWindows = [...directWindowKeysByBaseSource.values()]
      .reduce((sum, windows) => sum + (windows?.size || 0), 0);
    const everyBaseHasMultipleWindows = [...directWindowKeysByBaseSource.values()]
      .every((windows) => (windows?.size || 0) >= 2);
    if (
      totalDistinctWindows >= clipFloor &&
      everyBaseHasMultipleWindows &&
      clipFloor <= baseSourceCount * 3
    ) {
      return 3;
    }
  }
  const totalDistinctWindows = [...directWindowKeysByBaseSource.values()]
    .reduce((sum, windows) => sum + (windows?.size || 0), 0);
  const allDirectCandidatesAreOfficialSteam = asArray(candidates)
    .filter((candidate) => cleanText(candidate.media_kind) === "direct_video")
    .every((candidate) => {
      const sourceFamilyKey = sourceUrlFamilyKey(candidate.source_url || candidate.path);
      const sourceText = lowerText([
        candidate.source_type,
        candidate.source_kind,
        candidate.source_url_kind,
        candidate.provider,
        candidate.rights_risk_class,
        candidate.allowed_render_use,
      ].join(" "));
      return (
        sourceFamilyKey.startsWith("steamstatic:/store_trailers/") &&
        /official|platform_product_page|hls_manifest|dash_manifest|steam|direct_media/.test(sourceText) &&
        candidate.segmentValidationPassed !== false &&
        candidate.validated !== false
      );
    });
  const oneSteamSourceHasThirdDistinctWindow = [...directWindowKeysByBaseSource.values()]
    .some((windows) => (windows?.size || 0) >= 3);
  if (
    allDirectCandidatesAreOfficialSteam &&
    baseSourceCount >= 4 &&
    oneSteamSourceHasThirdDistinctWindow &&
    totalDistinctWindows >= 8 &&
    Number(maxClips || 0) >= 8
  ) {
    return 3;
  }
  if (baseSourceCount >= familyFloor && clipFloor > baseSourceCount) {
    return Math.max(1, Math.min(3, Math.ceil(clipFloor / baseSourceCount)));
  }
  if (
    baseSourceCount >= Math.max(3, familyFloor - 1) &&
    clipFloor > baseSourceCount &&
    clipFloor <= baseSourceCount * 2
  ) {
    return 2;
  }
  if (baseSourceCount >= 4 && clipFloor > baseSourceCount && clipFloor <= baseSourceCount * 2) {
    return 2;
  }
  return DEFAULT_MAX_DIRECT_MOTION_CLIPS_PER_BASE_SOURCE;
}

function mergeMotionRows(existingRows = [], newRows = []) {
  const byKey = new Map();
  for (const row of [...asArray(existingRows), ...asArray(newRows)]) {
    const pathText = cleanText(row.path || row.local_materialized_path);
    const sourceUrl = cleanText(row.source_url || pathText);
    const family = cleanText(row.source_family || row.motion_family);
    const start = numberOrNull(row.mediaStartS ?? row.media_start_s) || 0;
    const duration = numberOrNull(row.durationS ?? row.duration_s) || 0;
    if (!pathText || !family || duration < 1.2) continue;
    const key = `${pathText}|${sourceUrl}|${family}|${start.toFixed(2)}|${duration.toFixed(2)}`;
    byKey.set(key, {
      ...row,
      path: pathText,
      source_url: sourceUrl,
      source_family: family,
      motion_family: cleanText(row.motion_family || family),
      durationS: duration,
      mediaStartS: start,
    });
  }
  return uniqueMotionRowIds([...byKey.values()]);
}

function excludedMotionClipIdSet(excludedClipIds = []) {
  return new Set(normaliseStoryIds(excludedClipIds).map(lowerText));
}

function withoutExcludedMotionClips(rows = [], excludedClipIds = []) {
  const excluded = excludedMotionClipIdSet(excludedClipIds);
  if (!excluded.size) return [...asArray(rows)];
  return asArray(rows).filter(
    (row) => !excluded.has(lowerText(row.id || row.clip_id)),
  );
}

function stableMotionRowIdentity(row = {}) {
  const sourceIdentity = cleanText(
    row.canonical_source_url ||
      row.source_url ||
      row.source ||
      row.base_source_family ||
      row.local_materialized_path ||
      row.path,
  ).toLowerCase();
  const start = numberOrNull(
    row.source_media_start_s ?? row.mediaStartS ?? row.media_start_s,
  ) || 0;
  const duration = numberOrNull(
    row.source_window_duration_s ?? row.durationS ?? row.duration_s,
  ) || 0;
  return [
    sourceIdentity,
    cleanText(row.base_source_family).toLowerCase(),
    cleanText(row.source_family || row.motion_family).toLowerCase(),
    start.toFixed(3),
    duration.toFixed(3),
  ].join("|");
}

function uniqueMotionRowIds(rows = []) {
  const normalisedRows = asArray(rows).map((row, index) => ({
    row,
    baseId: cleanText(row.id || `motion_clip_${index + 1}`) || `motion_clip_${index + 1}`,
  }));
  const baseIdCounts = new Map();
  for (const { baseId } of normalisedRows) {
    const key = baseId.toLowerCase();
    baseIdCounts.set(key, (baseIdCounts.get(key) || 0) + 1);
  }
  const usedIds = new Set();
  const collisionCounts = new Map();
  return normalisedRows.map(({ row, baseId }) => {
    const baseKey = baseId.toLowerCase();
    const collisionDigest = crypto
      .createHash("sha256")
      .update(stableMotionRowIdentity(row))
      .digest("hex")
      .slice(0, 10);
    const collisionBase = `${baseId}__window_${collisionDigest}`;
    let id = baseIdCounts.get(baseKey) > 1 ? collisionBase : baseId;
    let suffix = collisionCounts.get(collisionBase.toLowerCase()) || 2;
    while (usedIds.has(id.toLowerCase())) {
      id = `${collisionBase}_${suffix}`;
      suffix += 1;
    }
    collisionCounts.set(collisionBase.toLowerCase(), suffix);
    usedIds.add(id.toLowerCase());
    return id === row.id ? row : { ...row, id };
  });
}

function existingRowsWithoutReplacementCollisions(existingRows = [], newRows = []) {
  const replacementDirectRows = asArray(newRows)
    .filter((clip) => cleanText(clip.media_kind || "direct_video") === "direct_video");
  const replacementDirectFamilies = new Set(
    replacementDirectRows
      .map((clip) => cleanText(clip.source_family))
      .filter(Boolean),
  );
  const replacementDirectWindows = new Set(
    replacementDirectRows
      .map((clip, index) => directMotionWindowKey(clip, index))
      .filter(Boolean),
  );
  return asArray(existingRows).filter((row, index) => {
    if (row.counts_towards_motion_readiness !== true) return false;
    if (cleanText(row.media_kind) !== "direct_video") return true;
    return (
      !replacementDirectFamilies.has(cleanText(row.source_family)) &&
      !replacementDirectWindows.has(directMotionWindowKey(row, index)) &&
      !overlappingDirectMotionWindow(row, replacementDirectRows, index)
    );
  });
}

function capMergedMotionRows(mergedRows = [], incomingRows = [], maximumClipCount = 0) {
  const cap = Math.max(0, Number(maximumClipCount || 0));
  const rows = asArray(mergedRows);
  const directRows = rows.filter(
    (row) => cleanText(row.media_kind || "direct_video") === "direct_video",
  );
  if (!cap || directRows.length <= cap) return rows;

  const incomingIdentities = new Set(
    asArray(incomingRows)
      .filter((row) => cleanText(row.media_kind || "direct_video") === "direct_video")
      .map(stableMotionRowIdentity)
      .filter(Boolean),
  );
  const incoming = directRows.filter((row) =>
    incomingIdentities.has(stableMotionRowIdentity(row)),
  );
  const retainedIncoming = incoming.slice(0, cap);
  const retainedIncomingIdentities = new Set(
    retainedIncoming.map(stableMotionRowIdentity),
  );
  const retainedExisting = directRows
    .filter((row) => !retainedIncomingIdentities.has(stableMotionRowIdentity(row)))
    .slice(0, Math.max(0, cap - retainedIncoming.length));
  const retainedDirectIdentities = new Set(
    [...retainedExisting, ...retainedIncoming].map(stableMotionRowIdentity),
  );
  return rows.filter((row) =>
    cleanText(row.media_kind || "direct_video") !== "direct_video" ||
    retainedDirectIdentities.has(stableMotionRowIdentity(row)),
  );
}

function existingMotionEvidenceReady(job = {}, footageInventory = {}, options = {}) {
  const existingRows = existingMotionClipRows(footageInventory)
    .filter((row) => row.counts_towards_motion_readiness === true);
  const minClips = Math.max(DEFAULT_MIN_CLIPS, Number(options.minClips || DEFAULT_MIN_CLIPS));
  const minFamilies = Math.max(
    DEFAULT_MIN_FAMILIES,
    Number(options.minFamilies || DEFAULT_MIN_FAMILIES),
  );
  const families = new Set(motionReadinessFamilies(existingRows));
  return existingRows.length >= Math.max(0, minClips - 1) && families.size >= minFamilies;
}

async function loadMotionPackForStory(root = process.cwd(), storyId = "") {
  const safeStoryId = cleanText(storyId);
  if (!safeStoryId) return {};
  return readJsonIfPresent(
    path.join(root, "output", "studio-v4", "motion-packs", `${safeStoryId}_motion_pack_manifest.json`),
    {},
  );
}

function rightsRecordForClip(clip = {}) {
  const stillDerived = cleanText(clip.media_kind) === "visual_still";
  const fileEvidence = clip.materialized_file_evidence || {};
  const rightsStatuses = rightsStatusFields(clip);
  const explicitAllowedPlatforms = Array.isArray(clip.allowed_platforms)
    ? [...clip.allowed_platforms]
    : undefined;
  const explicitCommercialUseAllowed =
    typeof clip.commercial_use_allowed === "boolean"
      ? clip.commercial_use_allowed
      : undefined;
  const hasAffirmativeCommercialScope =
    explicitCommercialUseAllowed === true &&
    explicitAllowedPlatforms?.length > 0;
  return {
    asset_id: cleanText(clip.id || `materialised_${path.basename(cleanText(clip.path), ".mp4")}`),
    asset_type: stillDerived ? "screenshot_derived_motion_clip" : "motion_clip",
    kind: "video",
    path: cleanText(clip.path),
    source_url: cleanText(clip.source_url),
    source_owner: cleanText(clip.source_owner || "source owner not specified"),
    source_type: cleanText(clip.source_type || "validated_direct_media"),
    licence_basis: cleanText(clip.licence_basis || "source_documented_transformative_editorial_use"),
    allowed_use: cleanText(clip.allowed_use || "transformative_editorial_short_form"),
    allowed_platforms: explicitAllowedPlatforms,
    platform_restrictions: clip.platform_restrictions && typeof clip.platform_restrictions === "object"
      ? structuredClone(clip.platform_restrictions)
      : undefined,
    restricted_platforms: Array.isArray(clip.restricted_platforms)
      ? [...clip.restricted_platforms]
      : undefined,
    commercial_use_allowed: explicitCommercialUseAllowed,
    transformation_notes: stillDerived
      ? "Official/key-art still transformed into a short, source-labelled Pulse Gaming editorial motion beat for a governed V4 render."
      : "Trimmed into a short, source-labelled Pulse Gaming editorial motion beat for a governed V4 render.",
    expiry: null,
    credit_required: typeof clip.credit_required === "boolean" ? clip.credit_required : false,
    evidence_reference: cleanText(clip.evidence_reference || clip.source_url || clip.path),
    evidence_file:
      cleanText(clip.evidence_file || clip.rights_evidence_file) || undefined,
    rights_evidence_file:
      cleanText(clip.rights_evidence_file || clip.evidence_file) || undefined,
    evidence_kind: cleanText(clip.evidence_kind) || undefined,
    evidence_sha256:
      cleanText(clip.evidence_sha256 || clip.rights_evidence_sha256) || undefined,
    rights_evidence_sha256:
      cleanText(clip.rights_evidence_sha256 || clip.evidence_sha256) || undefined,
    evidence_size_bytes: numberOrNull(
      clip.evidence_size_bytes ?? clip.rights_evidence_size_bytes,
    ),
    rights_evidence_size_bytes: numberOrNull(
      clip.rights_evidence_size_bytes ?? clip.evidence_size_bytes,
    ),
    usage_scope: cleanText(clip.usage_scope) || undefined,
    rights_decision_basis: cleanText(clip.rights_decision_basis) || undefined,
    required_public_notice: cleanText(clip.required_public_notice) || undefined,
    required_rules_link: cleanText(clip.required_rules_link) || undefined,
    live_publish_allowed:
      typeof clip.live_publish_allowed === "boolean"
        ? clip.live_publish_allowed
        : undefined,
    requires_human_legal_review_before_publish:
      clip.requires_human_legal_review_before_publish === true,
    rights_grant:
      clip.rights_grant && typeof clip.rights_grant === "object"
        ? structuredClone(clip.rights_grant)
        : clip.rights_grant,
    transformative_rights_evidence_verified:
      clip.transformative_rights_evidence_verified === true,
    risk_score: numberOrNull(clip.risk_score) ?? 0.28,
    approval_status:
      rightsStatuses.approval_status ||
      (hasAffirmativeCommercialScope
        ? "approved_for_transformative_editorial_use"
        : undefined),
    rights_status: rightsStatuses.rights_status || undefined,
    usage_status: rightsStatuses.usage_status || undefined,
    status: rightsStatuses.status || undefined,
    verdict: rightsStatuses.verdict || undefined,
    asset_sha256: cleanText(fileEvidence.sha256),
    asset_size_bytes: numberOrNull(fileEvidence.size_bytes),
    probed_duration_seconds: numberOrNull(fileEvidence.duration_seconds),
    video_codec: cleanText(fileEvidence.video_codec),
    width: numberOrNull(fileEvidence.width),
    height: numberOrNull(fileEvidence.height),
    base_source_family: directMotionBaseSourceFamily(clip),
    source_media_start_s: numberOrNull(
      clip.source_media_start_s ?? clip.mediaStartS ?? clip.media_start_s,
    ) || 0,
    source_window_duration_s: numberOrNull(
      clip.source_window_duration_s ?? clip.durationS ?? clip.duration_s,
    ),
    validation_provenance: clip.validation_provenance || clip.provenance || {},
    transformation_provenance: clip.transformation_provenance || {},
    materialized_file_evidence: fileEvidence,
    ...sourceIdentityFields(clip),
    source_master_path: cleanText(clip.source_master_path) || undefined,
    source_identity_provenance: sourceIdentityProvenance(clip),
    source_identity_conflicts: sourceIdentityConflicts(clip),
    base_source_asset_id: cleanText(clip.base_source_asset_id) || undefined,
    base_source_identity_basis: cleanText(clip.base_source_identity_basis) || undefined,
    motion_source_identity: clip.motion_source_identity || undefined,
  };
}

function rightsRecordIdentity(record = {}) {
  return lowerText(record.asset_id) || lowerText(record.source_url) || lowerText(record.path);
}

function isMaterializedMotionRightsRecord(record = {}) {
  const assetType = lowerText(record.asset_type);
  const kind = lowerText(record.kind);
  const sourceType = lowerText(record.source_type);
  const sourceUrl = lowerText(record.source_url);
  const provider = lowerText(record.provider_id || record.provider);
  const licenceBasis = lowerText(
    record.licence_basis || record.license_basis || record.rights_basis,
  );
  if (
    /(?:generated_motion_graphic|internally_generated|hyperframes|platform_native)/.test(
      `${assetType} ${sourceType} ${sourceUrl} ${provider} ${licenceBasis}`,
    )
  ) {
    return false;
  }
  return assetType.includes("motion_clip") ||
    assetType.includes("trailer_segment") ||
    (kind === "video" && /(?:direct_media|motion|trailer_segment)/.test(sourceType));
}

function currentEvidenceFields(record = {}) {
  const evidenceFile = cleanText(
    record.evidence_file || record.rights_evidence_file,
  );
  const evidenceSha256 = cleanText(
    record.evidence_sha256 || record.rights_evidence_sha256,
  );
  const evidenceSizeBytes = numberOrNull(
    record.evidence_size_bytes ?? record.rights_evidence_size_bytes,
  );
  return {
    asset_id: record.asset_id,
    id: record.asset_id,
    rights_record_id: record.asset_id,
    asset_type: record.asset_type,
    kind: record.kind,
    path: record.path,
    source_url: record.source_url,
    asset_sha256: record.asset_sha256,
    asset_size_bytes: record.asset_size_bytes,
    probed_duration_seconds: record.probed_duration_seconds,
    video_codec: record.video_codec,
    width: record.width,
    height: record.height,
    base_source_family: record.base_source_family,
    source_media_start_s: record.source_media_start_s,
    source_window_duration_s: record.source_window_duration_s,
    transformation_provenance: record.transformation_provenance,
    materialized_file_evidence: record.materialized_file_evidence,
    ...(evidenceFile
      ? {
          evidence_file: evidenceFile,
          rights_evidence_file: evidenceFile,
        }
      : {}),
    ...(evidenceSha256
      ? {
          evidence_sha256: evidenceSha256,
          rights_evidence_sha256: evidenceSha256,
        }
      : {}),
    ...(evidenceSizeBytes != null
      ? {
          evidence_size_bytes: evidenceSizeBytes,
          rights_evidence_size_bytes: evidenceSizeBytes,
        }
      : {}),
  };
}

function normalisedStringSet(value) {
  return asArray(value).map(lowerText).filter(Boolean).sort();
}

function normaliseRightsPlatform(value) {
  const key = lowerText(value);
  const aliases = {
    youtube: "youtube_shorts",
    youtube_short: "youtube_shorts",
    youtube_shorts: "youtube_shorts",
    instagram: "instagram_reels",
    instagram_reel: "instagram_reels",
    instagram_reels: "instagram_reels",
    facebook: "facebook_reels",
    facebook_reel: "facebook_reels",
    facebook_reels: "facebook_reels",
    twitter: "x",
  };
  return aliases[key] || key;
}

function normalisedRightsPlatformSet(value) {
  return [
    ...new Set(
      asArray(value)
        .map(normaliseRightsPlatform)
        .filter(Boolean),
    ),
  ].sort();
}

function rightsStatusFields(record = {}) {
  return {
    approval_status: cleanText(record.approval_status),
    rights_status: cleanText(record.rights_status),
    usage_status: cleanText(record.usage_status),
    status: cleanText(record.status),
    verdict: cleanText(record.verdict || record.rights_verdict),
  };
}

function restrictiveRightsStatus(value) {
  const status = lowerText(value);
  return /^(?:reject|rejected|deny|denied|blocked|defer|deferred|revoked|expired|fail|failed|red)$/.test(status) ||
    /(?:^|[_ -])(?:reject(?:ed)?|deny|denied|block(?:ed)?|defer(?:red)?|revok(?:ed)?|expir(?:ed)?|fail(?:ed)?|not[_ -]?approved|unapproved|hold|restricted|prohibited)(?:$|[_ -])/.test(status)
    ? status
    : "";
}

function onlyRepairableMissingRightsRecordFailure(rightsLedger = {}) {
  const failures = asArray(rightsLedger.failures).map(cleanText).filter(Boolean);
  const statuses = rightsStatusFields(rightsLedger);
  const nonVerdictRestrictiveStatuses = [
    statuses.approval_status,
    statuses.rights_status,
    statuses.usage_status,
    statuses.status,
  ].map(restrictiveRightsStatus).filter(Boolean);
  const verdictStatus = restrictiveRightsStatus(statuses.verdict);
  return nonVerdictRestrictiveStatuses.length === 0 &&
    /^(?:fail|failed|red)$/.test(verdictStatus) &&
    failures.length > 0 &&
    failures.every((failure) => failure === "rights:no_rights_record");
}

function restrictiveRightsRecordStatus(record = {}) {
  for (const value of Object.values(rightsStatusFields(record))) {
    const restrictive = restrictiveRightsStatus(value);
    if (restrictive) return restrictive;
  }
  return "";
}

function resolveArtifactEvidencePath(artifactDir, ...candidates) {
  for (const candidate of candidates.map(cleanText).filter(Boolean)) {
    const resolved = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(artifactDir, candidate);
    const relative = path.relative(path.resolve(artifactDir), resolved);
    if (relative && (relative.startsWith("..") || path.isAbsolute(relative))) continue;
    return resolved;
  }
  return "";
}

async function inspectPostScriptMediaTransition({
  artifactDir,
  rightsLedger = {},
  materializedClipProbe = defaultMaterializedClipProbe,
  materializedClipDecode = defaultMaterializedClipDecode,
} = {}) {
  const statuses = rightsStatusFields(rightsLedger);
  const blockers = asArray(rightsLedger.blockers).map(cleanText).filter(Boolean);
  const failures = asArray(rightsLedger.failures);
  const invalidatedAt = Date.parse(cleanText(rightsLedger.script_repair_invalidated_at));
  const narrationUpdatedAt = Date.parse(cleanText(rightsLedger.narration_rights_updated_at));
  const nonTransitionRestrictions = [
    statuses.approval_status,
    statuses.rights_status,
    statuses.usage_status,
  ].map(restrictiveRightsStatus).filter(Boolean);
  const narrationRecord = asArray(
    rightsLedger.records || rightsLedger.rights_ledger,
  ).find((record) => (
    lowerText(record.asset_type).includes("narration") ||
    lowerText(record.asset_id).endsWith("_audio_path")
  ));
  const recognised = (
    /^(?:red|fail|failed)$/.test(lowerText(statuses.verdict)) &&
    ["", "blocked"].includes(lowerText(statuses.status)) &&
    nonTransitionRestrictions.length === 0 &&
    failures.length === 0 &&
    blockers.length === 1 &&
    blockers[0] === SCRIPT_REPAIR_RIGHTS_TRANSITION_BLOCKER &&
    Number.isFinite(invalidatedAt) &&
    Number.isFinite(narrationUpdatedAt) &&
    narrationUpdatedAt >= invalidatedAt &&
    Boolean(narrationRecord) &&
    /^[a-f0-9]{64}$/i.test(cleanText(narrationRecord.asset_sha256)) &&
    Number(narrationRecord.asset_size_bytes) > 0 &&
    narrationRecord.commercial_use_allowed === true &&
    Array.isArray(narrationRecord.allowed_platforms) &&
    narrationRecord.allowed_platforms.length > 0 &&
    !restrictiveRightsRecordStatus(narrationRecord)
  );
  if (!recognised) {
    return {
      recognised: false,
      reconciliation_allowed: false,
      narration_fresh: false,
      render_fresh: false,
    };
  }

  const audioManifest = await readJsonIfPresent(
    path.join(artifactDir, "audio_manifest.json"),
    null,
  );
  const audioPath = resolveArtifactEvidencePath(
    artifactDir,
    audioManifest?.resolved_narration_audio_path,
    audioManifest?.narration_audio_path,
    narrationRecord.path,
    path.join("audio", "narration.mp3"),
  );
  const timestampsPath = resolveArtifactEvidencePath(
    artifactDir,
    audioManifest?.resolved_word_timestamps_path,
    audioManifest?.word_timestamps_path,
    path.join("audio", "word_timestamps.json"),
  );
  const manifestMaterializedAt = Date.parse(cleanText(audioManifest?.materialized_at));
  let narrationFresh = false;
  let currentAudioEvidence = null;
  if (
    audioManifest &&
    cleanText(audioManifest.story_id) === cleanText(rightsLedger.story_id) &&
    ["materialized", "ready"].includes(lowerText(audioManifest.voice_status)) &&
    audioManifest.word_timestamp_provenance?.strict_whisper_aligned === true &&
    Number.isFinite(manifestMaterializedAt) &&
    manifestMaterializedAt >= invalidatedAt &&
    audioPath &&
    timestampsPath &&
    await fs.pathExists(audioPath) &&
    await fs.pathExists(timestampsPath)
  ) {
    const [audioStat, timestampsStat, audioSha256, timestampsSha256] = await Promise.all([
      fs.stat(audioPath),
      fs.stat(timestampsPath),
      sha256File(audioPath),
      sha256File(timestampsPath),
    ]);
    narrationFresh = (
      audioStat.isFile() &&
      timestampsStat.isFile() &&
      audioStat.size > 0 &&
      timestampsStat.size > 0 &&
      audioStat.mtimeMs + 1 >= invalidatedAt &&
      timestampsStat.mtimeMs + 1 >= invalidatedAt &&
      lowerText(audioManifest.narration_audio_sha256) === audioSha256 &&
      Number(audioManifest.narration_audio_size_bytes) === audioStat.size &&
      lowerText(audioManifest.word_timestamps_sha256) === timestampsSha256 &&
      Number(audioManifest.word_timestamps_size_bytes) === timestampsStat.size &&
      lowerText(narrationRecord.asset_sha256) === audioSha256 &&
      Number(narrationRecord.asset_size_bytes) === audioStat.size
    );
    if (narrationFresh) {
      currentAudioEvidence = {
        audio_sha256: audioSha256,
        word_timestamps_sha256: timestampsSha256,
        audio_size_bytes: audioStat.size,
        word_timestamps_size_bytes: timestampsStat.size,
        freshness_floor_ms: Math.max(
          invalidatedAt,
          audioStat.mtimeMs,
          timestampsStat.mtimeMs,
        ),
      };
    }
  }

  let renderFresh = false;
  let renderChecks = null;
  if (narrationFresh && currentAudioEvidence) {
    const renderManifest = await readJsonIfPresent(
      path.join(artifactDir, "render_manifest.json"),
      null,
    );
    const canonical = await readJsonIfPresent(
      path.join(artifactDir, "canonical_story_manifest.json"),
      null,
    );
    const renderPath = resolveArtifactEvidencePath(
      artifactDir,
      renderManifest?.output_path,
      renderManifest?.output,
      "visual_v4_render.mp4",
    );
    const renderGeneratedAt = Date.parse(cleanText(renderManifest?.generated_at));
    const renderPreconditions = {
      manifest_present: Boolean(renderManifest),
      canonical_present: Boolean(canonical),
      story_matches:
        cleanText(renderManifest?.story_id) === cleanText(rightsLedger.story_id),
      final_publish_render: renderManifest?.final_publish_render === true,
      renderer_current:
        cleanText(renderManifest?.renderer) === "visual_v4_production",
      visual_tier_current:
        cleanText(renderManifest?.visual_tier) === "production_v4_motion",
      quality_gate_passed:
        cleanText(renderManifest?.quality_gate_status) ===
        "post_render_forensics_passed",
      generated_at_current:
        Number.isFinite(renderGeneratedAt) && renderGeneratedAt >= invalidatedAt,
      render_path_resolved: Boolean(renderPath),
      render_path_exists: Boolean(renderPath && await fs.pathExists(renderPath)),
    };
    renderChecks = { ...renderPreconditions };
    if (
      Object.values(renderPreconditions).every(Boolean)
    ) {
      const renderStat = await fs.stat(renderPath);
      const canonicalSnapshot = {
        story_id: cleanText(canonical.story_id),
        selected_title: cleanText(canonical.selected_title || canonical.short_title),
        thumbnail_headline: cleanText(
          canonical.thumbnail_headline || canonical.thumbnail_text,
        ),
        first_spoken_line: cleanText(
          canonical.first_spoken_line || canonical.narration_hook,
        ),
        narration_script: cleanText(canonical.narration_script),
        canonical_subject: cleanText(
          canonical.canonical_subject || canonical.canonical_game,
        ),
        canonical_angle: cleanText(canonical.canonical_angle),
        primary_source: cleanText(
          canonical.primary_source || canonical.source_card_label,
        ),
        public_copy_repaired_at: cleanText(canonical.public_copy_repaired_at),
        duration_variant_repaired_at: cleanText(
          canonical.duration_variant_repaired_at,
        ),
      };
      const fingerprintSource = {
        canonical_snapshot: canonicalSnapshot,
        audio_sha256: currentAudioEvidence.audio_sha256,
        word_timestamps_sha256:
          currentAudioEvidence.word_timestamps_sha256,
        audio_size_bytes: currentAudioEvidence.audio_size_bytes,
        word_timestamps_size_bytes:
          currentAudioEvidence.word_timestamps_size_bytes,
      };
      const expectedSignature = crypto
        .createHash("sha256")
        .update(stableJson(fingerprintSource))
        .digest("hex");
      let renderProbe = null;
      let renderDecode = null;
      try {
        renderProbe = await Promise.resolve(materializedClipProbe(renderPath, {
          video_codec: "h264",
          width: 1080,
          height: 1920,
        }));
      } catch {}
      try {
        renderDecode = await Promise.resolve(materializedClipDecode(renderPath));
      } catch {}
      renderChecks = {
        ...renderChecks,
        render_is_file: renderStat.isFile(),
        render_size_valid: renderStat.size >= 1024,
        render_mtime_current:
          renderStat.mtimeMs + 1000 >= currentAudioEvidence.freshness_floor_ms,
        render_size_matches:
          !Number(renderManifest.file_size_bytes) ||
          Number(renderManifest.file_size_bytes) === renderStat.size,
        input_fingerprint_matches:
          cleanText(renderManifest.input_fingerprint?.signature) ===
          expectedSignature,
        render_probe_available: renderProbe?.available === true,
        render_probe_decodable: renderProbe?.decodable === true,
        render_full_decode_available: renderDecode?.available === true,
        render_full_decode_passed:
          renderDecode?.decodable === true &&
          renderDecode?.full_clip === true,
      };
      renderFresh = Object.values(renderChecks).every(Boolean);
    }
  }

  return {
    recognised: true,
    reconciliation_allowed: narrationFresh,
    narration_fresh: narrationFresh,
    render_fresh: renderFresh,
    render_checks: renderChecks,
    invalidated_at: new Date(invalidatedAt).toISOString(),
    narration_updated_at: Number.isFinite(narrationUpdatedAt)
      ? new Date(narrationUpdatedAt).toISOString()
      : null,
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function rightsLedgerEvidenceRows(rightsLedger = {}) {
  return [
    ...asArray(rightsLedger.assets),
    ...asArray(rightsLedger.records),
    ...asArray(rightsLedger.matched_assets),
    ...asArray(rightsLedger.rights_ledger),
  ].filter((record) => record && typeof record === "object");
}

function rightsSourceWindow(record = {}) {
  const sourceReference = cleanText(
    record.canonical_source_url ||
      record.source_url ||
      record.url ||
      (/^https?:/i.test(cleanText(record.path)) ? record.path : ""),
  );
  const sourceUrl = sourceUrlFamilyKey(sourceReference) || lowerText(sourceReference);
  const start = numberOrNull(
    record.source_media_start_s ?? record.mediaStartS ?? record.media_start_s,
  );
  const duration = numberOrNull(
    record.source_window_duration_s ?? record.durationS ?? record.duration_s,
  );
  return {
    source_url: sourceUrl,
    start,
    duration,
    complete: Boolean(sourceUrl && start != null && duration != null),
  };
}

function rightsEvidenceMatchesClip(record = {}, generated = {}) {
  const recordWindow = rightsSourceWindow(record);
  const generatedWindow = rightsSourceWindow(generated);
  if (recordWindow.complete && generatedWindow.complete) {
    return recordWindow.source_url === generatedWindow.source_url &&
      Math.abs(recordWindow.start - generatedWindow.start) < 0.01 &&
      Math.abs(recordWindow.duration - generatedWindow.duration) < 0.01;
  }
  if (
    recordWindow.source_url &&
    generatedWindow.source_url &&
    recordWindow.source_url !== generatedWindow.source_url
  ) {
    return false;
  }
  const recordIdentity = rightsRecordIdentity(record);
  const generatedIdentity = rightsRecordIdentity(generated);
  if (recordIdentity && generatedIdentity && recordIdentity === generatedIdentity) return true;
  const recordPath = normalisePathText(record.path || record.local_path);
  const generatedPath = normalisePathText(generated.path || generated.local_path);
  if (recordPath && generatedPath && recordPath === generatedPath) return true;
  return Boolean(
    recordWindow.source_url &&
    generatedWindow.source_url &&
    recordWindow.source_url === generatedWindow.source_url
  );
}

function sameMaterializedRightsAsset(record = {}, generated = {}) {
  const recordPath = normalisePathText(record.path || record.local_path);
  const generatedPath = normalisePathText(generated.path || generated.local_path);
  if (recordPath && generatedPath && recordPath === generatedPath) return true;
  const recordSha256 = lowerText(
    record.asset_sha256 || record.materialized_file_evidence?.sha256,
  );
  const generatedSha256 = lowerText(
    generated.asset_sha256 || generated.materialized_file_evidence?.sha256,
  );
  if (
    /^[a-f0-9]{64}$/.test(recordSha256) &&
    recordSha256 === generatedSha256
  ) {
    return true;
  }
  const recordWindow = rightsSourceWindow(record);
  const generatedWindow = rightsSourceWindow(generated);
  return Boolean(
    recordWindow.complete &&
      generatedWindow.complete &&
      recordWindow.source_url === generatedWindow.source_url &&
      Math.abs(recordWindow.start - generatedWindow.start) < 0.01 &&
      Math.abs(recordWindow.duration - generatedWindow.duration) < 0.01,
  );
}

function rightsSourceIdentityAliases(record = {}) {
  const fields = sourceIdentityFields(record);
  const aliases = new Set();
  const canonicalSource = canonicaliseMotionSourceUrl(
    fields.canonical_source_url || record.source_url,
  );
  if (canonicalSource) aliases.add(canonicalSource.toLowerCase());
  if (fields.youtube_video_id) {
    aliases.add(`youtube:${fields.youtube_video_id}`.toLowerCase());
  }
  if (fields.source_master_sha256) {
    aliases.add(`sha256:${fields.source_master_sha256}`.toLowerCase());
  }
  return aliases;
}

function sameRightsSourceIdentity(left = {}, right = {}) {
  const leftFields = sourceIdentityFields(left);
  const rightFields = sourceIdentityFields(right);
  if (
    leftFields.source_master_sha256 &&
    rightFields.source_master_sha256 &&
    leftFields.source_master_sha256 !== rightFields.source_master_sha256
  ) {
    return false;
  }
  if (
    leftFields.youtube_video_id &&
    rightFields.youtube_video_id &&
    leftFields.youtube_video_id !== rightFields.youtube_video_id
  ) {
    return false;
  }
  const leftAliases = rightsSourceIdentityAliases(left);
  const rightAliases = rightsSourceIdentityAliases(right);
  return [...leftAliases].some((alias) => rightAliases.has(alias));
}

function explicitSourcePolicyGrant(record = {}) {
  return Boolean(
    record.rights_grant === true &&
      record.commercial_use_allowed === true &&
      Array.isArray(record.allowed_platforms) &&
      record.allowed_platforms.length > 0 &&
      cleanText(record.evidence_file || record.rights_evidence_file) &&
      /^[a-f0-9]{64}$/i.test(
        cleanText(record.evidence_sha256 || record.rights_evidence_sha256),
      ),
  );
}

function inheritedSourcePolicyFields(current = {}, donor = {}) {
  if (!explicitSourcePolicyGrant(donor)) return {};
  const inherited = {};
  for (const field of [
    "source_owner",
    "licence_basis",
    "allowed_use",
    "allowed_platforms",
    "platform_restrictions",
    "restricted_platforms",
    "commercial_use_allowed",
    "credit_required",
    "evidence_reference",
    "usage_scope",
    "rights_decision_basis",
    "rights_grant",
    "risk_score",
    "approval_status",
    "rights_status",
    "usage_status",
    "status",
    "verdict",
    "required_public_notice",
    "required_rules_link",
    "live_publish_allowed",
    "requires_human_legal_review_before_publish",
  ]) {
    const currentValue = current[field];
    const donorValue = donor[field];
    const currentMissing =
      currentValue == null ||
      (typeof currentValue === "string" && !cleanText(currentValue));
    const donorMissing =
      donorValue == null ||
      (typeof donorValue === "string" && !cleanText(donorValue));
    if (currentMissing && !donorMissing) {
      inherited[field] =
        donorValue && typeof donorValue === "object"
          ? structuredClone(donorValue)
          : donorValue;
    }
  }
  const evidenceFile = cleanText(
    current.evidence_file ||
      current.rights_evidence_file ||
      donor.evidence_file ||
      donor.rights_evidence_file,
  );
  const evidenceSha256 = cleanText(
    current.evidence_sha256 ||
      current.rights_evidence_sha256 ||
      donor.evidence_sha256 ||
      donor.rights_evidence_sha256,
  );
  const evidenceSizeBytes = numberOrNull(
    current.evidence_size_bytes ??
      current.rights_evidence_size_bytes ??
      donor.evidence_size_bytes ??
      donor.rights_evidence_size_bytes,
  );
  if (evidenceFile) {
    inherited.evidence_file = evidenceFile;
    inherited.rights_evidence_file = evidenceFile;
  }
  if (evidenceSha256) {
    inherited.evidence_sha256 = evidenceSha256;
    inherited.rights_evidence_sha256 = evidenceSha256;
  }
  if (evidenceSizeBytes != null) {
    inherited.evidence_size_bytes = evidenceSizeBytes;
    inherited.rights_evidence_size_bytes = evidenceSizeBytes;
  }
  return inherited;
}

function strictOfficialPublisherRightsEvidence(record = {}) {
  const licenceBasis = lowerText(
    record.licence_basis || record.license_basis || record.rights_basis,
  );
  const allowedUse = lowerText(record.allowed_use || record.allowed_render_use);
  const sourceType = lowerText(record.source_type);
  const canonicalSourceUrl = cleanText(
    record.canonical_source_url || record.evidence_reference,
  );
  const youtubeVideoId = cleanText(record.youtube_video_id);
  const sourceMasterSha256 = lowerText(record.source_master_sha256);
  const identity = record.source_identity_provenance || {};
  const allowedPlatforms = new Set(
    normalisedRightsPlatformSet(record.allowed_platforms),
  );
  const requiredPlatforms = [
    "facebook_reels",
    "instagram_reels",
    "youtube_shorts",
  ];
  return (
    licenceBasis === "official_publisher_promotional_editorial_use" &&
    allowedUse === "transformative_editorial_short_form" &&
    sourceType === "official_youtube_channel_url" &&
    /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=[a-z0-9_-]{11}(?:&|$)/i.test(
      canonicalSourceUrl,
    ) &&
    /^[a-z0-9_-]{11}$/i.test(youtubeVideoId) &&
    canonicalSourceUrl.includes(`v=${youtubeVideoId}`) &&
    /^[a-f0-9]{64}$/.test(sourceMasterSha256) &&
    record.commercial_use_allowed === true &&
    requiredPlatforms.every((platform) => allowedPlatforms.has(platform)) &&
    identity.status === "resolved" &&
    identity.kind === "pulse_source_identity_sidecar" &&
    /^[a-f0-9]{64}$/i.test(cleanText(identity.sidecar_sha256)) &&
    lowerText(identity.source_master_sha256) === sourceMasterSha256 &&
    cleanText(identity.canonical_source_url) === canonicalSourceUrl &&
    cleanText(identity.youtube_video_id) === youtubeVideoId &&
    identity.identity_scope === "source_identity_only" &&
    identity.rights_grant === false &&
    record.validation_provenance?.segment_validated === true
  );
}

function hashBoundPulseSourceIdentityMatches(record = {}) {
  const fields = sourceIdentityFields(record);
  const canonicalSourceUrl = cleanText(fields.canonical_source_url);
  const youtubeVideoId = cleanText(fields.youtube_video_id);
  const sourceMasterSha256 = lowerText(fields.source_master_sha256);
  if (
    asArray(record.source_identity_conflicts).length > 0 ||
    !canonicalSourceUrl ||
    !youtubeVideoId ||
    !/^[a-f0-9]{64}$/.test(sourceMasterSha256)
  ) {
    return false;
  }

  const pulseSidecars = [];
  let nodeCount = 0;
  let validStructure = true;
  const visit = (value, depth = 0) => {
    if (
      !validStructure ||
      depth > 6 ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      validStructure = false;
      return;
    }
    nodeCount += 1;
    if (nodeCount > 64) {
      validStructure = false;
      return;
    }
    const kind = cleanText(value.kind);
    if (kind === "source_identity_evidence_bundle") {
      const sources = asArray(value.sources);
      if (
        cleanText(value.status) !== "resolved" ||
        cleanText(value.identity_scope) !== "source_identity_only" ||
        value.rights_grant !== false ||
        sources.length === 0
      ) {
        validStructure = false;
        return;
      }
      for (const source of sources) visit(source, depth + 1);
      return;
    }
    if (kind === "yt_dlp_info_sidecar") {
      if (
        cleanText(value.status) !== "resolved" ||
        cleanText(value.canonical_source_url) !== canonicalSourceUrl ||
        cleanText(value.youtube_video_id) !== youtubeVideoId
      ) {
        validStructure = false;
      }
      return;
    }
    if (kind !== "pulse_source_identity_sidecar") {
      validStructure = false;
      return;
    }
    pulseSidecars.push(value);
  };
  visit(record.source_identity_provenance || {});
  if (!validStructure || pulseSidecars.length === 0) return false;

  return pulseSidecars.every((identity) => {
    const sidecarPathText = cleanText(identity.sidecar_path);
    const expectedSidecarSha256 = lowerText(identity.sidecar_sha256);
    if (
      cleanText(identity.status) !== "resolved" ||
      !sidecarPathText ||
      !/^[a-f0-9]{64}$/.test(expectedSidecarSha256) ||
      cleanText(identity.canonical_source_url) !== canonicalSourceUrl ||
      cleanText(identity.youtube_video_id) !== youtubeVideoId ||
      lowerText(identity.source_master_sha256) !== sourceMasterSha256 ||
      cleanText(identity.identity_scope) !== "source_identity_only" ||
      identity.rights_grant !== false
    ) {
      return false;
    }

    const sidecarPath = path.isAbsolute(sidecarPathText)
      ? path.resolve(sidecarPathText)
      : path.resolve(process.cwd(), sidecarPathText);
    let sidecarBytes;
    let sidecar;
    try {
      sidecarBytes = fs.readFileSync(sidecarPath);
      sidecar = JSON.parse(sidecarBytes.toString("utf8"));
    } catch {
      return false;
    }
    const actualSidecarSha256 = crypto
      .createHash("sha256")
      .update(sidecarBytes)
      .digest("hex");
    const channelIdentity =
      sidecar.channel_identity && typeof sidecar.channel_identity === "object"
        ? sidecar.channel_identity
        : {};
    const evidence =
      sidecar.evidence && typeof sidecar.evidence === "object"
        ? sidecar.evidence
        : {};
    return (
      actualSidecarSha256 === expectedSidecarSha256 &&
      cleanText(sidecar.schema) === PULSE_SOURCE_IDENTITY_SIDECAR_SCHEMA &&
      Number(sidecar.schema_version) === 1 &&
      cleanText(sidecar.producer) === PULSE_SOURCE_IDENTITY_SIDECAR_PRODUCER &&
      cleanText(sidecar.canonical_source_url) === canonicalSourceUrl &&
      cleanText(sidecar.youtube_video_id) === youtubeVideoId &&
      lowerText(sidecar.source_master_sha256) === sourceMasterSha256 &&
      cleanText(sidecar.identity_scope) === "source_identity_only" &&
      sidecar.rights_grant === false &&
      Boolean(cleanText(channelIdentity.author_name)) &&
      isCanonicalYoutubeChannelUrl(channelIdentity.author_url) &&
      cleanText(evidence.provider) === "youtube_oembed" &&
      Boolean(cleanText(evidence.verified_at)) &&
      Number.isFinite(Date.parse(evidence.verified_at))
    );
  });
}

function strictHashBoundPublisherVideoPolicyRightsEvidence(record = {}) {
  const licenceBasis = lowerText(
    record.licence_basis || record.license_basis || record.rights_basis,
  );
  const allowedUse = lowerText(record.allowed_use || record.allowed_render_use);
  const sourceType = lowerText(record.source_type);
  const evidenceKind = lowerText(record.evidence_kind);
  const evidenceReference = cleanText(record.evidence_reference);
  const fields = sourceIdentityFields(record);
  const canonicalSourceUrl = fields.canonical_source_url;
  const youtubeVideoId = fields.youtube_video_id;
  const sourceMasterSha256 = fields.source_master_sha256;
  const allowedPlatforms = new Set(
    normalisedRightsPlatformSet(record.allowed_platforms),
  );
  const requiredPlatforms = [
    "facebook_reels",
    "instagram_reels",
    "youtube_shorts",
  ];
  return (
    licenceBasis === "publisher_video_policy_transformative_editorial_use" &&
    allowedUse === "transformative_editorial_short_form" &&
    sourceType === "official_youtube_channel_url" &&
    evidenceKind === "publisher_video_policy" &&
    /^https:\/\//i.test(evidenceReference) &&
    selectorLocalRightsEvidenceMatches(record) &&
    record.transformative_rights_evidence_verified === true &&
    record.rights_grant === true &&
    record.commercial_use_allowed === true &&
    typeof record.credit_required === "boolean" &&
    numberOrNull(record.risk_score) != null &&
    numberOrNull(record.risk_score) < 0.65 &&
    requiredPlatforms.every((platform) => allowedPlatforms.has(platform)) &&
    record.platform_restrictions?.source_audio === "must_not_be_used" &&
    /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=[a-z0-9_-]{11}(?:&|$)/i.test(
      canonicalSourceUrl,
    ) &&
    /^[a-z0-9_-]{11}$/i.test(youtubeVideoId) &&
    canonicalSourceUrl.includes(`v=${youtubeVideoId}`) &&
    /^[a-f0-9]{64}$/i.test(sourceMasterSha256) &&
    hashBoundPulseSourceIdentityMatches(record) &&
    record.validation_provenance?.segment_validated === true &&
    record.validation_provenance?.allowed_for_flash_lane === true
  );
}

function verifiedPublisherPolicySupersedesLegacyRecord(
  clip = {},
  existingRecord = {},
) {
  return Boolean(
    strictHashBoundPublisherVideoPolicyRightsEvidence(clip) &&
      rightsEvidenceMatchesClip(existingRecord, clip) &&
      sameRightsSourceIdentity(existingRecord, clip) &&
      !restrictiveRightsRecordStatus(existingRecord) &&
      existingRecord.commercial_use_allowed !== false &&
      !(
        Array.isArray(existingRecord.allowed_platforms) &&
        existingRecord.allowed_platforms.length === 0
      ) &&
      (
        numberOrNull(existingRecord.risk_score) == null ||
        numberOrNull(existingRecord.risk_score) < 0.65
      )
  );
}

function officialPublisherRightsUpgradeEquivalent(clip = {}, existingRecord = {}, field = "") {
  if (verifiedPublisherPolicySupersedesLegacyRecord(clip, existingRecord)) {
    return true;
  }
  if (!strictOfficialPublisherRightsEvidence(clip)) return false;
  if (!rightsEvidenceMatchesClip(existingRecord, clip)) return false;
  if (restrictiveRightsRecordStatus(existingRecord)) return false;
  if (field === "licence_basis") {
    const existing = lowerText(
      existingRecord.licence_basis ||
        existingRecord.license_basis ||
        existingRecord.rights_basis,
    );
    return [
      "official_direct_media",
      "official_direct_media_reference_for_motion_acquisition",
    ].includes(existing);
  }
  if (field === "allowed_use") {
    return lowerText(
      existingRecord.allowed_use || existingRecord.allowed_render_use,
    ) === "official_direct_media_segment_candidate";
  }
  return false;
}

function disambiguatedWindowAssetId(record = {}) {
  const window = rightsSourceWindow(record);
  if (!window.complete) return cleanText(record.asset_id);
  const digest = crypto
    .createHash("sha256")
    .update(`${window.source_url}|${window.start}|${window.duration}`)
    .digest("hex")
    .slice(0, 10);
  const baseId = cleanText(record.asset_id || "materialised_motion_clip");
  return `${baseId}__window_${digest}`;
}

function explicitRightsComparableValue(record = {}, field, authoritativeClip = null) {
  if (
    authoritativeClip &&
    officialPublisherRightsUpgradeEquivalent(authoritativeClip, record, field)
  ) {
    return explicitRightsComparableValue(authoritativeClip, field);
  }
  const presence = rightsFieldPresence(record);
  if (!presence[field]) return undefined;
  let value;
  if (field === "licence_basis") {
    value = record.licence_basis || record.license_basis || record.rights_basis;
  } else if (field === "allowed_use") {
    value = record.allowed_use || record.allowed_render_use;
  } else if (field === "evidence_reference") {
    const evidenceReference = cleanText(record.evidence_reference);
    const sourceUrl = cleanText(record.source_url || record.source);
    const canonicalSourceUrl = cleanText(record.canonical_source_url);
    value =
      canonicalSourceUrl &&
      (
        !evidenceReference ||
        (
          sourceUrl &&
          normalisePathText(evidenceReference).toLowerCase() ===
            normalisePathText(sourceUrl).toLowerCase()
        )
      )
        ? canonicalSourceUrl
        : evidenceReference;
  } else {
    value = record[field];
  }
  if (Array.isArray(value)) {
    return stableJson(
      ["allowed_platforms", "restricted_platforms"].includes(field)
        ? normalisedRightsPlatformSet(value)
        : normalisedStringSet(value),
    );
  }
  if (value && typeof value === "object") return stableJson(value);
  if (typeof value === "string") return lowerText(value);
  return value;
}

function aggregateRightsEvidenceContradictions(
  records = [],
  authoritativeClip = null,
  { includeEvidenceReference = true } = {},
) {
  const conflicts = [];
  const fields = [
    "licence_basis",
    "allowed_use",
    "allowed_platforms",
    "platform_restrictions",
    "restricted_platforms",
    "commercial_use_allowed",
    "risk_score",
    "credit_required",
    ...(includeEvidenceReference ? ["evidence_reference"] : []),
  ];
  for (const field of fields) {
    const values = asArray(records)
      .map((record) =>
        explicitRightsComparableValue(record, field, authoritativeClip),
      )
      .filter((value) => value !== undefined && value !== null && value !== "");
    if (new Set(values.map(stableJson)).size > 1) conflicts.push(field);
  }
  return conflicts;
}

function rightsContradictions(clip = {}, existingRecord = {}) {
  if (verifiedPublisherPolicySupersedesLegacyRecord(clip, existingRecord)) {
    return [];
  }
  const presence = clip.rights_field_presence || rightsFieldPresence(clip);
  const conflicts = [];
  for (const field of ["licence_basis", "allowed_use", "evidence_reference"]) {
    const clipValue = cleanText(field === "licence_basis" ? clip.licence_basis || clip.rights_basis : clip[field]);
    const existingValue = cleanText(existingRecord[field]);
    if (
      presence[field] &&
      clipValue &&
      existingValue &&
      lowerText(clipValue) !== lowerText(existingValue) &&
      !officialPublisherRightsUpgradeEquivalent(clip, existingRecord, field)
    ) {
      conflicts.push(field);
    }
  }
  for (const field of ["commercial_use_allowed", "credit_required"]) {
    if (
      presence[field] &&
      typeof clip[field] === "boolean" &&
      typeof existingRecord[field] === "boolean" &&
      clip[field] !== existingRecord[field]
    ) {
      conflicts.push(field);
    }
  }
  if (
    presence.risk_score &&
    numberOrNull(clip.risk_score) != null &&
    numberOrNull(existingRecord.risk_score) != null &&
    Math.abs(Number(clip.risk_score) - Number(existingRecord.risk_score)) > 0.0001
  ) {
    conflicts.push("risk_score");
  }
  for (const field of ["allowed_platforms", "restricted_platforms"]) {
    if (
      presence[field] &&
      Array.isArray(clip[field]) &&
      Array.isArray(existingRecord[field]) &&
      stableJson(normalisedRightsPlatformSet(clip[field])) !==
        stableJson(normalisedRightsPlatformSet(existingRecord[field]))
    ) {
      conflicts.push(field);
    }
  }
  if (
    presence.platform_restrictions &&
    clip.platform_restrictions &&
    existingRecord.platform_restrictions &&
    stableJson(clip.platform_restrictions) !== stableJson(existingRecord.platform_restrictions)
  ) {
    conflicts.push("platform_restrictions");
  }
  if (
    clip.validation_provenance &&
    existingRecord.validation_provenance &&
    !validationProvenanceRefreshEquivalent(
      clip.validation_provenance,
      existingRecord.validation_provenance,
    )
  ) {
    conflicts.push("validation_provenance");
  }
  return [...new Set(conflicts)];
}

function reconcileMaterializedRightsRecords(clips = [], rightsLedger = {}) {
  const existing = mergeRecords(
    rightsLedger.records || rightsLedger.rights_ledger,
    rightsLedger.rights_ledger || rightsLedger.records,
  );
  const allRightsEvidence = rightsLedgerEvidenceRows(rightsLedger);
  const byIdentity = new Map(existing
    .filter((record) => !isMaterializedMotionRightsRecord(record))
    .map((record) => [rightsRecordIdentity(record), record]));
  const failures = [];
  for (const clip of asArray(clips)) {
    const generated = rightsRecordForClip(clip);
    const generatedRestrictiveStatus = restrictiveRightsRecordStatus(generated);
    if (generatedRestrictiveStatus) {
      failures.push({
        id: cleanText(clip.id),
        source_url: cleanText(clip.source_url),
        reason: "rights_record_rejected",
        error: `rights_record_rejected:${generatedRestrictiveStatus}`,
      });
      continue;
    }
    const generatedRiskScore = numberOrNull(generated.risk_score);
    if (generatedRiskScore != null && generatedRiskScore >= 0.65) {
      failures.push({
        id: cleanText(clip.id),
        source_url: cleanText(clip.source_url),
        reason: "rights_evidence_high_risk",
        error: `rights_evidence_high_risk:${generatedRiskScore}`,
      });
      continue;
    }
    const collidingIdentity = rightsRecordIdentity(generated);
    const collidingRecord = byIdentity.get(collidingIdentity);
    if (
      collidingRecord &&
      !rightsEvidenceMatchesClip(collidingRecord, generated) &&
      rightsSourceWindow(collidingRecord).complete &&
      rightsSourceWindow(generated).complete
    ) {
      generated.asset_id = disambiguatedWindowAssetId(generated);
    }
    const identity = rightsRecordIdentity(generated);
    const matchingEvidence = allRightsEvidence.filter((record) =>
      rightsEvidenceMatchesClip(record, generated),
    );
    const sourcePolicyEvidence = allRightsEvidence.filter((record) =>
      sameRightsSourceIdentity(record, generated),
    );
    const governingEvidence = [...new Set([
      ...matchingEvidence,
      ...sourcePolicyEvidence,
    ])];
    const sourcePolicyDonor = sourcePolicyEvidence.find(explicitSourcePolicyGrant);
    const existingRecord = byIdentity.get(identity) ||
      existing.find((record) => rightsEvidenceMatchesClip(record, generated)) ||
      sourcePolicyDonor ||
      matchingEvidence[0];
    const restrictiveStatus = governingEvidence
      .map(restrictiveRightsRecordStatus)
      .find(Boolean) || restrictiveRightsRecordStatus(existingRecord);
    if (restrictiveStatus) {
      failures.push({
        id: cleanText(clip.id),
        source_url: cleanText(clip.source_url),
        reason: "rights_record_rejected",
        error: `rights_record_rejected:${restrictiveStatus}`,
      });
      continue;
    }
    const matchingHighRisk = governingEvidence
      .map((record) => numberOrNull(record.risk_score))
      .find((risk) => risk != null && risk >= 0.65);
    if (matchingHighRisk != null) {
      failures.push({
        id: cleanText(clip.id),
        source_url: cleanText(clip.source_url),
        reason: "rights_evidence_high_risk",
        error: `rights_evidence_high_risk:${matchingHighRisk}`,
      });
      continue;
    }
    if (governingEvidence.some((record) => record.commercial_use_allowed === false)) {
      failures.push({
        id: cleanText(clip.id),
        source_url: cleanText(clip.source_url),
        reason: "rights_evidence_restricts_commercial_use",
        error: "rights_evidence_restricts_commercial_use:commercial_use_allowed=false",
      });
      continue;
    }
    if (governingEvidence.some((record) => Array.isArray(record.allowed_platforms) && record.allowed_platforms.length === 0)) {
      failures.push({
        id: cleanText(clip.id),
        source_url: cleanText(clip.source_url),
        reason: "rights_evidence_restricts_all_platforms",
        error: "rights_evidence_restricts_all_platforms:allowed_platforms_empty",
      });
      continue;
    }
    const contradictionEvidence = (
      existingRecord &&
      !matchingEvidence.includes(existingRecord) &&
      sameMaterializedRightsAsset(existingRecord, generated)
    )
      ? [...matchingEvidence, existingRecord]
      : matchingEvidence;
    const contradictions = [...new Set([
      ...contradictionEvidence.flatMap((record) => rightsContradictions(clip, record)),
      ...aggregateRightsEvidenceContradictions(matchingEvidence, clip),
      ...aggregateRightsEvidenceContradictions(sourcePolicyEvidence, clip, {
        includeEvidenceReference: false,
      }),
    ])];
    if (contradictions.length) {
      failures.push({
        id: cleanText(clip.id),
        source_url: cleanText(clip.source_url),
        reason: "rights_evidence_contradiction",
        error: `rights_evidence_contradiction:${contradictions.join(",")}`,
      });
      continue;
    }
    const authoritativeOfficialUpgradeFields = existingRecord
      ? {
          ...(officialPublisherRightsUpgradeEquivalent(
            clip,
            existingRecord,
            "licence_basis",
          )
            ? {
                licence_basis: cleanText(
                  clip.licence_basis || clip.license_basis || clip.rights_basis,
                ),
              }
            : {}),
          ...(officialPublisherRightsUpgradeEquivalent(
            clip,
            existingRecord,
            "allowed_use",
          )
            ? {
                allowed_use: cleanText(
                  clip.allowed_use || clip.allowed_render_use,
                ),
              }
            : {}),
          ...(clip.validation_provenance &&
          existingRecord.validation_provenance &&
          validationProvenanceRefreshEquivalent(
            clip.validation_provenance,
            existingRecord.validation_provenance,
          )
            ? {
                validation_provenance: structuredClone(
                  clip.validation_provenance,
                ),
              }
            : {}),
        }
      : {};
    const verifiedPublisherPolicyUpgrade =
      existingRecord &&
      verifiedPublisherPolicySupersedesLegacyRecord(clip, existingRecord);
    const reconciledBase = existingRecord
      ? verifiedPublisherPolicyUpgrade
        ? {
            ...existingRecord,
            ...generated,
            ...currentEvidenceFields(generated),
          }
        : {
          ...generated,
          ...existingRecord,
          ...currentEvidenceFields(generated),
          ...authoritativeOfficialUpgradeFields,
          }
      : generated;
    const reconciled = {
      ...reconciledBase,
      ...inheritedSourcePolicyFields(reconciledBase, sourcePolicyDonor),
    };
    if (reconciled.commercial_use_allowed !== true) {
      const explicitlyRestricted = reconciled.commercial_use_allowed === false;
      failures.push({
        id: cleanText(clip.id),
        source_url: cleanText(clip.source_url),
        reason: explicitlyRestricted
          ? "rights_evidence_restricts_commercial_use"
          : "commercial_rights_evidence_missing",
        error: explicitlyRestricted
          ? "rights_evidence_restricts_commercial_use:commercial_use_allowed=false"
          : "commercial_rights_evidence_missing:commercial_use_allowed_not_affirmative",
      });
      continue;
    }
    if (!Array.isArray(reconciled.allowed_platforms) || reconciled.allowed_platforms.length === 0) {
      const explicitlyRestricted =
        Array.isArray(reconciled.allowed_platforms) &&
        reconciled.allowed_platforms.length === 0;
      failures.push({
        id: cleanText(clip.id),
        source_url: cleanText(clip.source_url),
        reason: explicitlyRestricted
          ? "rights_evidence_restricts_all_platforms"
          : "platform_rights_evidence_missing",
        error: explicitlyRestricted
          ? "rights_evidence_restricts_all_platforms:allowed_platforms_empty"
          : "platform_rights_evidence_missing:allowed_platforms_not_declared",
      });
      continue;
    }
    const existingIdentity = rightsRecordIdentity(existingRecord);
    if (
      existingIdentity &&
      existingIdentity !== identity &&
      sameMaterializedRightsAsset(existingRecord, generated)
    ) {
      byIdentity.delete(existingIdentity);
    }
    if (identity) byIdentity.set(identity, reconciled);
  }
  return { records: [...byIdentity.values()], failures };
}

function mergeRecords(existing = [], additions = []) {
  const byKey = new Map();
  for (const record of [...asArray(existing), ...asArray(additions)]) {
    const key = lowerText(record.asset_id) || lowerText(record.path) || lowerText(record.source_url);
    if (key && !byKey.has(key)) byKey.set(key, record);
  }
  return [...byKey.values()];
}

async function backupOnce(filePath, generatedAt, reason) {
  if (!(await fs.pathExists(filePath))) return null;
  const backupPath = `${filePath}.pre_real_motion_materialization.json`;
  if (!(await fs.pathExists(backupPath))) {
    await fs.writeJson(backupPath, {
      ...(await fs.readJson(filePath)),
      backup_created_at: generatedAt,
      backup_reason: reason,
    }, { spaces: 2 });
  }
  return backupPath;
}

function materializedMotionClipRows(clips = [], storyId = "", { countsTowardsMotionReadiness = true } = {}) {
  return uniqueMotionRowIds(asArray(clips).map((clip, index) => {
    const sourceMediaStartS = numberOrNull(
      clip.source_media_start_s ?? clip.provenance?.media_start_s ?? clip.mediaStartS ?? clip.media_start_s,
    ) || 0;
    const sourceWindowDurationS = numberOrNull(
      clip.source_window_duration_s ?? clip.provenance?.duration_s ?? clip.durationS ?? clip.duration_s,
    );
    const baseSourceFamily = directMotionBaseSourceFamily(clip, index);
    const identityFields = sourceIdentityFields(clip);
    const motionSourceIdentity = compoundMotionSourceIdentity({
      ...clip,
      ...identityFields,
    }, index);
    return {
      id: cleanText(clip.id || `${storyId}-real-motion-${index + 1}`),
      path: cleanText(clip.path),
      source_url: cleanText(clip.source_url),
      source_family: cleanText(clip.source_family),
      base_source_family: baseSourceFamily,
      motion_family: cleanText(clip.motion_family || clip.source_family),
      source_type: cleanText(clip.source_type),
      media_kind: cleanText(clip.media_kind || "direct_video"),
      durationS: sourceWindowDurationS,
      mediaStartS: sourceMediaStartS,
      source_media_start_s: sourceMediaStartS,
      source_window_duration_s: sourceWindowDurationS,
      source_crop_top_px: Math.max(0, numberOrNull(clip.source_crop_top_px) || 0),
      source_crop_bottom_px: Math.max(0, numberOrNull(clip.source_crop_bottom_px) || 0),
      materialized_duration_s: numberOrNull(
        clip.materialized_duration_s ?? clip.materialized_file_evidence?.duration_seconds,
      ),
      rights_basis: cleanText(clip.licence_basis || clip.rights_basis),
      licence_basis: cleanText(clip.licence_basis || clip.rights_basis),
      allowed_use: cleanText(clip.allowed_use),
      allowed_platforms: Array.isArray(clip.allowed_platforms) ? [...clip.allowed_platforms] : undefined,
      platform_restrictions: clip.platform_restrictions && typeof clip.platform_restrictions === "object"
        ? structuredClone(clip.platform_restrictions)
        : undefined,
      restricted_platforms: Array.isArray(clip.restricted_platforms) ? [...clip.restricted_platforms] : undefined,
      commercial_use_allowed:
        typeof clip.commercial_use_allowed === "boolean" ? clip.commercial_use_allowed : undefined,
      credit_required: typeof clip.credit_required === "boolean" ? clip.credit_required : undefined,
      evidence_reference: cleanText(clip.evidence_reference),
      evidence_file: cleanText(clip.evidence_file) || undefined,
      rights_evidence_file:
        cleanText(clip.rights_evidence_file || clip.evidence_file) || undefined,
      evidence_kind: cleanText(clip.evidence_kind) || undefined,
      evidence_sha256:
        cleanText(clip.evidence_sha256 || clip.rights_evidence_sha256) || undefined,
      rights_evidence_sha256:
        cleanText(clip.rights_evidence_sha256 || clip.evidence_sha256) || undefined,
      evidence_size_bytes: numberOrNull(
        clip.evidence_size_bytes ?? clip.rights_evidence_size_bytes,
      ),
      rights_evidence_size_bytes: numberOrNull(
        clip.rights_evidence_size_bytes ?? clip.evidence_size_bytes,
      ),
      usage_scope: cleanText(clip.usage_scope) || undefined,
      rights_decision_basis: cleanText(clip.rights_decision_basis) || undefined,
      required_public_notice: cleanText(clip.required_public_notice) || undefined,
      required_rules_link: cleanText(clip.required_rules_link) || undefined,
      live_publish_allowed:
        typeof clip.live_publish_allowed === "boolean"
          ? clip.live_publish_allowed
          : undefined,
      requires_human_legal_review_before_publish:
        clip.requires_human_legal_review_before_publish === true,
      rights_grant:
        clip.rights_grant && typeof clip.rights_grant === "object"
          ? structuredClone(clip.rights_grant)
          : clip.rights_grant,
      owned_explainer_visual_plan: clip.owned_explainer_visual_plan === true,
      generator_project_id: cleanText(clip.generator_project_id) || undefined,
      source_master_identity:
        clip.source_master_identity && typeof clip.source_master_identity === "object"
          ? structuredClone(clip.source_master_identity)
          : undefined,
      transformative_rights_evidence_verified:
        clip.transformative_rights_evidence_verified === true,
      expiry: cleanText(clip.expiry) || undefined,
      risk_score: numberOrNull(clip.risk_score),
      counts_towards_motion_readiness: countsTowardsMotionReadiness,
      materialized: true,
      local_materialized_path: cleanText(clip.local_materialized_path || clip.path),
      asset_sha256: cleanText(clip.asset_sha256 || clip.sha256) || undefined,
      asset_size_bytes: numberOrNull(clip.asset_size_bytes ?? clip.size_bytes),
      probed_duration_seconds: numberOrNull(
        clip.probed_duration_seconds ?? clip.duration_seconds,
      ),
      video_codec: cleanText(clip.video_codec) || undefined,
      width: numberOrNull(clip.width),
      height: numberOrNull(clip.height),
      entity: cleanText(clip.entity || clip.canonical_subject || clip.source_owner),
      source_owner: cleanText(clip.source_owner || clip.entity || clip.canonical_subject),
      ...identityFields,
      source_identity_provenance: clip.source_identity_provenance || undefined,
      source_identity_conflicts: asArray(clip.source_identity_conflicts).map(cleanText),
      base_source_asset_id: motionSourceIdentity.base_source_asset_id || undefined,
      base_source_identity_basis: motionSourceIdentity.base_source_identity_basis || undefined,
      motion_source_identity: motionSourceIdentity,
      visual_content_fingerprint: clip.visual_content_fingerprint || undefined,
      visual_repair:
        clip.visual_repair && typeof clip.visual_repair === "object"
          ? structuredClone(clip.visual_repair)
          : undefined,
      validated: clip.validated === true ? true : undefined,
      segmentValidationPassed: clip.segmentValidationPassed === true ? true : undefined,
      materialized_file_evidence: clip.materialized_file_evidence || undefined,
      validation_provenance_conflicts: asArray(clip.validation_provenance_conflicts).map(cleanText),
      validation_provenance: clip.validation_provenance || clip.provenance || undefined,
      transformation_provenance: clip.transformation_provenance || undefined,
      recovery_provenance:
        clip.recovery_provenance && typeof clip.recovery_provenance === "object"
          ? structuredClone(clip.recovery_provenance)
          : undefined,
      rights_field_presence: clip.rights_field_presence || undefined,
      ...rightsStatusFields(clip),
      provenance: clip.provenance || undefined,
    };
  }));
}

async function balancedRestorableArtifactClips(footageInventory = {}, {
  root = process.cwd(),
  job = {},
  minClips = DEFAULT_MIN_CLIPS,
  minFamilies = DEFAULT_MIN_FAMILIES,
  maxClips = 8,
  maxDirectClipsPerBaseSource = null,
  canonicalSubject = "",
  materialisedArtifact = {},
  excludedClipIds = [],
} = {}) {
  const governedRows = governedExistingDirectMotionRows(footageInventory);
  const recoveryRows = governedRows.length
    ? []
    : governedRightsInvalidationRecoveryRows(
        footageInventory,
        materialisedArtifact,
        { root },
      );
  const staleInventoryRecoveryRows = governedRows.length || recoveryRows.length
    ? []
    : governedStaleInventoryRecoveryRows(
        footageInventory,
        materialisedArtifact,
        { root },
      );
  const allCandidates = balanceDirectVideoCandidatesByBaseSource(
    await hydrateMaterialisedSourceIdentitiesFromLocalMasters(
      hydrateExactMaterialisedSourceIdentities(
        governedRows.length
          ? governedRows
          : recoveryRows.length
            ? recoveryRows
            : staleInventoryRecoveryRows,
        materialisedArtifact,
      ),
      { root },
    ),
  );
  const candidates = withoutExcludedMotionClips(allCandidates, excludedClipIds);
  if (!candidates.length) {
    return {
      clips: [],
      candidates: allCandidates,
      maxPerBaseSource: 0,
      baseSourceCounts: new Map(),
    };
  }
  const maxPerBaseSource = dynamicMaxDirectClipsPerBaseSource(candidates, {
    job,
    minClips,
    minFamilies,
    maxClips,
    explicitMax: maxDirectClipsPerBaseSource,
    hasRightsLedger: true,
  });
  const selected = [];
  const baseSourceCounts = new Map();
  for (const candidate of candidates) {
    if (selected.length >= maxClips) break;
    const baseSource = directMotionBaseSourceFamily(candidate, selected.length);
    if (!baseSource || (baseSourceCounts.get(baseSource) || 0) >= maxPerBaseSource) continue;
    baseSourceCounts.set(baseSource, (baseSourceCounts.get(baseSource) || 0) + 1);
    selected.push({
      ...candidate,
      entity: cleanText(candidate.entity || canonicalSubject),
      source_owner: cleanText(candidate.source_owner || candidate.entity || canonicalSubject),
      validated: true,
      segmentValidationPassed: true,
    });
  }
  return { clips: selected, candidates: allCandidates, maxPerBaseSource, baseSourceCounts };
}

function resetDerivativeClipEvidence(clip = {}) {
  return {
    ...clip,
    local_materialized_path: "",
    materialized: false,
    asset_sha256: undefined,
    sha256: undefined,
    asset_size_bytes: undefined,
    size_bytes: undefined,
    probed_duration_seconds: undefined,
    duration_seconds: undefined,
    video_codec: undefined,
    width: undefined,
    height: undefined,
    materialized_duration_s: undefined,
    materialized_file_evidence: undefined,
    visual_content_fingerprint: undefined,
    base_source_asset_id: undefined,
    base_source_identity_basis: undefined,
    motion_source_identity: undefined,
  };
}

function refreshWindowPlanRows(plan = {}, storyId = "") {
  if (Array.isArray(plan)) return plan;
  if (!plan || typeof plan !== "object") return [];
  if (Array.isArray(plan.windows) && (!plan.story_id || cleanText(plan.story_id) === cleanText(storyId))) {
    return plan.windows;
  }
  const story = asArray(plan.stories).find(
    (candidate) => cleanText(candidate.story_id) === cleanText(storyId),
  );
  return asArray(story?.windows);
}

function refreshWindowSourceReference(sourceClip = {}, { root = process.cwd() } = {}) {
  const sourceMasterPath = trustedLocalSourceMasterPath(root, sourceClip);
  const sourceIdentity = sourceClip.motion_source_identity ||
    compoundMotionSourceIdentity(sourceClip);
  const identityConflicts = sourceIdentityConflicts(sourceClip);
  if (
    sourceMasterPath &&
    fs.pathExistsSync(sourceMasterPath) &&
    sourceIdentity?.status === "resolved" &&
    identityConflicts.length === 0
  ) {
    return sourceMasterPath;
  }
  return cleanText(sourceClip.source_url || sourceClip.source || sourceClip.path);
}

function exactRefreshWindowCandidate(
  candidates = [],
  selected = [],
  entry = {},
  index = 0,
  { root = process.cwd() } = {},
) {
  const sourceClipId = cleanText(entry.source_clip_id || entry.sourceClipId);
  const requestedBaseSource = cleanText(entry.base_source_family || entry.baseSourceFamily);
  const requestedYoutubeId = cleanText(entry.youtube_video_id || entry.youtubeVideoId);
  const sourceClip = asArray(candidates).find((candidate, candidateIndex) => {
    if (sourceClipId && cleanText(candidate.id || candidate.clip_id) === sourceClipId) return true;
    if (
      requestedBaseSource &&
      directMotionBaseSourceFamily(candidate, candidateIndex) === requestedBaseSource
    ) return true;
    if (requestedYoutubeId && cleanText(sourceIdentityFields(candidate).youtube_video_id) === requestedYoutubeId) {
      return true;
    }
    return false;
  });
  if (!sourceClip) return { candidate: null, error: "refresh_window_plan_source_missing" };
  const sourceRef = refreshWindowSourceReference(sourceClip, { root });
  if (!sourceRef) return { candidate: null, error: "refresh_window_plan_source_reference_missing" };
  const baseSource = directMotionBaseSourceFamily(sourceClip, index);
  const mediaStartS = numberOrNull(entry.media_start_s ?? entry.mediaStartS);
  const durationS = numberOrNull(entry.duration_s ?? entry.durationS);
  if (mediaStartS == null || mediaStartS < 0) {
    return { candidate: null, error: "refresh_window_plan_start_invalid" };
  }
  if (durationS == null || durationS < 2 || durationS > 5) {
    return { candidate: null, error: "refresh_window_plan_duration_invalid" };
  }
  const sourceDuration = numberOrNull(
    sourceClip.source_duration_s ||
      sourceClip.validation_provenance?.source_duration_s ||
      sourceClip.provenance?.source_duration_s,
  );
  if (sourceDuration != null && mediaStartS + durationS > sourceDuration) {
    return { candidate: null, error: "refresh_window_plan_exceeds_source_duration" };
  }
  const overlaps = asArray(selected).some((clip, clipIndex) => {
    if (directMotionBaseSourceFamily(clip, clipIndex) !== baseSource) return false;
    const existingStart = numberOrNull(clip.mediaStartS ?? clip.media_start_s) || 0;
    const existingDuration = numberOrNull(clip.durationS ?? clip.duration_s) || 0;
    return mediaStartS < existingStart + existingDuration - 0.05 &&
      mediaStartS + durationS > existingStart + 0.05;
  });
  if (overlaps) return { candidate: null, error: "refresh_window_plan_overlaps_selected_window" };
  const localSource = !/^https?:\/\//i.test(sourceRef);
  const sourceUrlKind = localSource
    ? "local_video_file"
    : /\.m3u8(?:$|[?#])/i.test(sourceRef)
      ? "hls_manifest"
      : /\.mpd(?:$|[?#])/i.test(sourceRef)
        ? "dash_manifest"
        : "direct_video";
  const provenanceState = provenanceStateForAsset(sourceClip);
  const windowKey = `${String(mediaStartS).replace(/\./g, "_")}_${String(durationS).replace(/\./g, "_")}`;
  return {
    candidate: {
      ...resetDerivativeClipEvidence(sourceClip),
      id: cleanText(entry.id) || `${safeFileStem(sourceClip.id || baseSource)}_planned_window_${index + 1}`,
      path: sourceRef,
      source_url: sourceRef,
      source_kind: sourceUrlKind,
      source_url_kind: sourceUrlKind,
      materialize_source_window: localSource,
      source_family: cleanText(entry.source_family) || `${baseSource}_window_${windowKey}`,
      motion_family: cleanText(entry.source_family) || `${baseSource}_window_${windowKey}`,
      base_source_family: baseSource,
      mediaStartS,
      durationS,
      source_crop_top_px: Math.max(0, numberOrNull(entry.source_crop_top_px) || 0),
      source_crop_bottom_px: Math.max(0, numberOrNull(entry.source_crop_bottom_px) || 0),
      validated: true,
      segmentValidationPassed: true,
      validation_provenance: provenanceState.validation,
      transformation_provenance: {
        ...provenanceState.transformation,
        base_source_family: baseSource,
        media_start_s: mediaStartS,
        duration_s: durationS,
        source_crop_top_px: Math.max(0, numberOrNull(entry.source_crop_top_px) || 0),
        source_crop_bottom_px: Math.max(0, numberOrNull(entry.source_crop_bottom_px) || 0),
        refresh_window_materialized: true,
        refresh_window_plan: true,
      },
      validation_provenance_conflicts: provenanceState.conflicts,
      provenance: provenanceState.validation,
    },
    error: "",
  };
}

function supplementalRefreshWindowCandidate(candidates = [], selected = [], baseSource = "", index = 0) {
  const sourceClip = candidates.find(
    (candidate, candidateIndex) => directMotionBaseSourceFamily(candidate, candidateIndex) === baseSource,
  );
  if (!sourceClip) return null;
  const sourceRef = cleanText(sourceClip.source_url || sourceClip.source || sourceClip.path);
  if (!sourceRef) return null;
  const duration = Math.max(2, numberOrNull(sourceClip.durationS ?? sourceClip.duration_s) || 5);
  const sourceDuration = numberOrNull(
    sourceClip.source_duration_s || sourceClip.provenance?.source_duration_s,
  );
  const usedStarts = new Set(
    [...candidates, ...selected]
      .filter((clip, clipIndex) => directMotionBaseSourceFamily(clip, clipIndex) === baseSource)
      .map((clip) => Number(numberOrNull(clip.mediaStartS ?? clip.media_start_s) || 0).toFixed(2)),
  );
  const baseStart = Math.max(0, numberOrNull(sourceClip.mediaStartS ?? sourceClip.media_start_s) || 0);
  const step = duration + 1;
  let mediaStartS = null;
  for (let radius = 1; radius < 24 && mediaStartS == null; radius += 1) {
    for (const candidateStart of [baseStart + radius * step, baseStart - radius * step]) {
      if (candidateStart < 0) continue;
      if (sourceDuration != null && candidateStart + duration > sourceDuration) continue;
      const key = Number(candidateStart).toFixed(2);
      if (!usedStarts.has(key)) {
        mediaStartS = Number(key);
        break;
      }
    }
  }
  if (mediaStartS == null) return null;
  const localSource = !/^https?:\/\//i.test(sourceRef);
  const sourceUrlKind = localSource
    ? "local_video_file"
    : /\.m3u8(?:$|[?#])/i.test(sourceRef)
      ? "hls_manifest"
      : /\.mpd(?:$|[?#])/i.test(sourceRef)
        ? "dash_manifest"
        : "direct_video";
  const windowKey = `${String(mediaStartS).replace(/\./g, "_")}_${String(duration).replace(/\./g, "_")}`;
  const provenanceState = provenanceStateForAsset(sourceClip);
  return {
    ...resetDerivativeClipEvidence(sourceClip),
    id: `${safeFileStem(sourceClip.id || baseSource)}_refresh_window_${index + 1}`,
    path: sourceRef,
    source_url: sourceRef,
    source_kind: sourceUrlKind,
    source_url_kind: sourceUrlKind,
    materialize_source_window: localSource,
    source_family: `${baseSource}_window_${windowKey}`,
    motion_family: `${baseSource}_window_${windowKey}`,
    base_source_family: baseSource,
    mediaStartS,
    durationS: duration,
    validated: true,
    segmentValidationPassed: true,
    validation_provenance: provenanceState.validation,
    transformation_provenance: {
      ...provenanceState.transformation,
      base_source_family: baseSource,
      media_start_s: mediaStartS,
      duration_s: duration,
      refresh_window_materialized: true,
    },
    validation_provenance_conflicts: provenanceState.conflicts,
    provenance: provenanceState.validation,
  };
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function uniqueFamiliesFromRows(rows = []) {
  return motionReadinessFamilies(rows);
}

function reconciledMotionBudgetAfterRealMaterialization(
  motionBudget = {},
  mergedClipRows = [],
  requiredBaseSourceCount = 0,
) {
  const families = uniqueFamiliesFromRows(mergedClipRows);
  const baseSourceFamilies = genuineBaseSourceFamilies(mergedClipRows);
  const availableMotionClips = asArray(mergedClipRows).length;
  const availableDistinctFamilies = families.length;
  const explicitRequiredMotion = numberOr(motionBudget.required_motion_scenes, DEFAULT_MIN_CLIPS);
  const explicitRequiredFamilies = numberOr(motionBudget.required_distinct_families, DEFAULT_MIN_FAMILIES);
  const metricStory =
    motionBudget.steam_metric_story === true || motionBudget.review_score_story === true;
  const normalDistinctFloor = Math.max(DEFAULT_MIN_FAMILIES, availableDistinctFamilies);
  const requiredDistinctFamilies = metricStory
    ? Math.max(DEFAULT_MIN_FAMILIES, explicitRequiredFamilies)
    : Math.max(
        DEFAULT_MIN_FAMILIES,
        Math.min(explicitRequiredFamilies, normalDistinctFloor),
      );

  return {
    ...motionBudget,
    required_motion_scenes: Math.max(DEFAULT_MIN_CLIPS, explicitRequiredMotion),
    available_motion_clips: availableMotionClips,
    required_distinct_families: requiredDistinctFamilies,
    available_distinct_families: availableDistinctFamilies,
    required_distinct_base_sources: Number(requiredBaseSourceCount || 0),
    available_distinct_base_sources: baseSourceFamilies.length,
    available_distinct_motion_families: availableDistinctFamilies,
  };
}

function reconciledMotionReadinessAfterRealMaterialization(
  existingReadiness = {},
  motionBudget = {},
  { rightsReconciled = false } = {},
) {
  const blockers = [];
  if (numberOr(motionBudget.available_motion_clips, 0) < numberOr(motionBudget.required_motion_scenes, DEFAULT_MIN_CLIPS)) {
    blockers.push("actual_motion_clip_minimum_not_met");
  }
  if (numberOr(motionBudget.available_distinct_families, 0) < numberOr(motionBudget.required_distinct_families, DEFAULT_MIN_FAMILIES)) {
    blockers.push("distinct_motion_families_minimum_not_met");
  }
  if (
    numberOr(motionBudget.required_distinct_base_sources, 0) > 0 &&
    numberOr(motionBudget.available_distinct_base_sources, 0) <
      numberOr(motionBudget.required_distinct_base_sources, 0)
  ) {
    blockers.push("genuine_base_source_minimum_not_met");
  }
  const staleMotionBlockers = new Set([
    ...STALE_INVENTORY_RECOVERY_BLOCKERS,
    "actual_motion_clip_minimum_not_met",
    "distinct_motion_families_minimum_not_met",
    "genuine_base_source_minimum_not_met",
    "professional_genuine_base_source_minimum_not_met",
    "no_trusted_footage_references_for_story",
  ]);
  const staleReconciledRightsBlockers = new Set([
    "rights_evidence_contradiction",
    "rights_evidence_unresolved",
    "rights:no_rights_record",
    "rights_record_missing",
    SCRIPT_REPAIR_RIGHTS_TRANSITION_BLOCKER,
  ]);
  for (const blocker of asArray(existingReadiness.blockers).map(cleanText)) {
    if (staleMotionBlockers.has(blocker)) continue;
    if (rightsReconciled && staleReconciledRightsBlockers.has(blocker)) continue;
    blockers.push(blocker);
  }
  const ready = blockers.length === 0;
  return {
    ...existingReadiness,
    status: ready ? "v4_motion_ready" : "v4_motion_blocked",
    ready,
    motion_ready: ready,
    can_publish: ready,
    blockers: [...new Set(blockers)],
    warnings: asArray(existingReadiness.warnings),
  };
}

async function materializeCandidate({
  root,
  storyId,
  canonicalSubject = "",
  candidate,
  execFileSync,
  ffprobeDuration,
  generatedAt,
  materializedClipProbe,
  materializedClipDecode,
} = {}) {
  const restrictiveCandidateRightsStatus = restrictiveRightsRecordStatus(candidate);
  if (restrictiveCandidateRightsStatus) {
    return {
      status: "failed",
      candidate,
      rejected: [{
        id: cleanText(candidate.id),
        source_url: cleanText(candidate.source_url),
        reason: "rights_candidate_rejected",
        error: `rights_candidate_rejected:${restrictiveCandidateRightsStatus}`,
      }],
      blockers: ["rights_candidate_rejected"],
    };
  }
  const provenanceConflicts = asArray(candidate.validation_provenance_conflicts).map(cleanText);
  if (provenanceConflicts.length) {
    return {
      status: "failed",
      candidate,
      rejected: [{
        id: cleanText(candidate.id),
        source_url: cleanText(candidate.source_url),
        reason: "validation_provenance_conflict",
        error: `validation_provenance_conflict:${provenanceConflicts.join(",")}`,
      }],
      blockers: ["validation_provenance_conflict"],
    };
  }
  const validationState = candidateSegmentValidationState(candidate);
  if (cleanText(candidate.media_kind) === "direct_video" && validationState.affirmative !== true) {
    const status = cleanText(candidate.segment_validation_status || validationState.status || "not_affirmatively_validated");
    return {
      status: "failed",
      candidate,
      rejected: [{
        id: cleanText(candidate.id),
        source_url: cleanText(candidate.source_url),
        reason: "candidate_segment_validation_rejected",
        error: `candidate_segment_validation_rejected:${status}`,
      }],
      blockers: ["candidate_segment_validation_rejected"],
    };
  }
  if (cleanText(candidate.media_kind) === "visual_still") {
    return materializeStillCandidate({
      root,
      storyId,
      candidate,
      execFileSync,
      ffprobeDuration,
      generatedAt,
      materializedClipProbe,
      materializedClipDecode,
    });
  }
  const immutableSourceIdentity = await materializedSourceIdentityFields(candidate, { root });
  const result = await materializeStudioV4BridgeClips({
    root,
    story: {
      id: storyId,
      canonical_subject: cleanText(canonicalSubject || candidate.entity || candidate.source_owner),
    },
    bridge: {
      story_id: storyId,
      readiness: { status: "bridge_ready", blockers: [] },
      video_clips: [candidate],
    },
    execFileSync,
    ffprobeDuration,
  });
  const clip = result.bridge?.video_clips?.[0] || null;
  if (result.readiness?.status !== "materialized" || !clip) {
    return {
      status: "failed",
      candidate,
      rejected: result.rejected || [],
      blockers: result.readiness?.blockers || ["real_motion_materialization_failed"],
    };
  }
  const baseSourceFamily = directMotionBaseSourceFamily(candidate);
  const sourceMediaStartS = numberOrNull(candidate.mediaStartS ?? candidate.media_start_s) || 0;
  const sourceWindowDurationS = numberOrNull(candidate.durationS ?? candidate.duration_s);
  const materializedClip = {
    ...candidate,
    ...clip,
    source_url: cleanText(candidate.source_url),
    mediaStartS: sourceMediaStartS,
    durationS: sourceWindowDurationS,
    source_media_start_s: sourceMediaStartS,
    source_window_duration_s: sourceWindowDurationS,
    media_kind: "direct_video",
    base_source_family: baseSourceFamily,
    motion_family: candidate.source_family,
    visual_family: candidate.source_family,
    source_family: candidate.source_family,
    validation_provenance: candidate.validation_provenance || candidate.provenance || {},
    transformation_provenance: {
      ...(candidate.transformation_provenance || {}),
      base_source_family: baseSourceFamily,
      media_start_s: sourceMediaStartS,
      duration_s: sourceWindowDurationS,
    },
    provenance: candidate.validation_provenance || candidate.provenance || {},
    counts_towards_motion_readiness: true,
    ...immutableSourceIdentity,
  };
  try {
    materializedClip.materialized_file_evidence = await captureMaterializedClipEvidence(
      materializedClip.local_materialized_path || materializedClip.path,
      {
        generatedAt,
        materializedClipProbe,
        materializedClipDecode,
        expectedMedia: {
          duration_seconds: sourceWindowDurationS,
          video_codec: "h264",
          width: 1080,
          height: 1920,
        },
      },
    );
    materializedClip.materialized_duration_s = materializedClip.materialized_file_evidence.duration_seconds;
    materializedClip.asset_sha256 = materializedClip.materialized_file_evidence.sha256;
    materializedClip.asset_size_bytes = materializedClip.materialized_file_evidence.size_bytes;
    materializedClip.probed_duration_seconds =
      materializedClip.materialized_file_evidence.duration_seconds;
    materializedClip.video_codec = materializedClip.materialized_file_evidence.video_codec;
    materializedClip.width = materializedClip.materialized_file_evidence.width;
    materializedClip.height = materializedClip.materialized_file_evidence.height;
  } catch (error) {
    const blocker = materializedEvidenceBlocker(error);
    return {
      status: "failed",
      candidate,
      rejected: [{
        id: cleanText(candidate.id),
        path: cleanText(materializedClip.local_materialized_path || materializedClip.path),
        reason: blocker,
        error: cleanText(error.message),
      }],
      blockers: [blocker],
    };
  }
  return {
    status: "materialized",
    candidate,
    clip: materializedClip,
    materialized: result.materialized || [],
  };
}

function outputStillMotionPath({ root, storyId, candidate, index = 0 }) {
  return path.join(
    root,
    "output",
    "video_cache",
    `${safeFileStem(storyId)}_v4_still_${index + 1}_${safeFileStem(candidate.id || candidate.source_family)}.mp4`,
  );
}

function localStillInputPath(root, input) {
  const text = cleanText(input);
  if (!text || /^https?:\/\//i.test(text)) return text;
  return path.isAbsolute(text) ? text : path.resolve(root, text);
}

function buildStillMotionFfmpegArgs({ input, output, durationS }) {
  const duration = Math.max(1.5, numberOrNull(durationS) || 3);
  const frames = Math.max(45, Math.round(duration * 30));
  const zoompan =
    `scale=1240:2200:force_original_aspect_ratio=increase,` +
    `crop=1080:1920,setsar=1,` +
    `zoompan=z='min(zoom+0.0012,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30,` +
    `trim=duration=${duration.toFixed(2)},format=yuv420p`;
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-loop",
    "1",
    "-t",
    duration.toFixed(2),
    "-i",
    input,
    "-vf",
    zoompan,
    "-an",
    "-c:v",
    "libx264",
    "-crf",
    "20",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    output,
  ];
}

async function materializeStillCandidate({
  root = process.cwd(),
  storyId,
  candidate,
  execFileSync = defaultExecFileSync,
  ffprobeDuration = defaultFfprobeDuration,
  generatedAt,
  materializedClipProbe = defaultMaterializedClipProbe,
  materializedClipDecode = defaultMaterializedClipDecode,
} = {}) {
  const input = localStillInputPath(root, candidate.path || candidate.source_url);
  if (!input) {
    return {
      status: "failed",
      candidate,
      rejected: [{ id: candidate.id || null, reason: "still_input_missing" }],
      blockers: ["still_input_missing"],
    };
  }
  if (!/^https?:\/\//i.test(input) && !(await fs.pathExists(input))) {
    return {
      status: "failed",
      candidate,
      rejected: [{ id: candidate.id || null, path: input, reason: "local_still_missing" }],
      blockers: ["local_still_missing"],
    };
  }
  const output = outputStillMotionPath({ root, storyId, candidate });
  await fs.ensureDir(path.dirname(output));
  try {
    execFileSync("ffmpeg", buildStillMotionFfmpegArgs({
      input,
      output,
      durationS: candidate.durationS,
    }), {
      cwd: root,
      stdio: "ignore",
    });
    const duration = ffprobeDuration(output);
    if (!Number.isFinite(duration) || duration <= 0.2) {
      await fs.remove(output).catch(() => {});
      return {
        status: "failed",
        candidate,
        rejected: [{ id: candidate.id || null, path: output, reason: "still_motion_invalid" }],
        blockers: ["still_motion_invalid"],
      };
    }
    const clip = {
      ...candidate,
      path: output,
      source_url: cleanText(candidate.source_url || candidate.path),
      local_materialized_path: output,
      materialized: true,
      materialized_media_start_s: 0,
      materialized_duration_s: duration,
      media_kind: "visual_still",
      motion_family: candidate.source_family,
      visual_family: candidate.source_family,
      source_family: candidate.source_family,
      counts_towards_motion_readiness: true,
      screenshot_derived_motion: true,
    };
    try {
      clip.materialized_file_evidence = await captureMaterializedClipEvidence(output, {
        generatedAt,
        materializedClipProbe,
        materializedClipDecode,
        expectedMedia: {
          duration_seconds: candidate.durationS,
          video_codec: "h264",
          width: 1080,
          height: 1920,
        },
      });
      clip.materialized_duration_s = clip.materialized_file_evidence.duration_seconds;
    } catch (error) {
      const blocker = materializedEvidenceBlocker(error);
      await fs.remove(output).catch(() => {});
      return {
        status: "failed",
        candidate,
        rejected: [{
          id: candidate.id || null,
          path: output,
          reason: blocker,
          error: cleanText(error.message),
        }],
        blockers: [blocker],
      };
    }
    return {
      status: "materialized",
      candidate,
      clip,
      materialized: [{
        id: candidate.id || null,
        source_family: candidate.source_family || null,
        source_url: candidate.source_url || candidate.path,
        path: output,
        mediaStartS: 0,
        durationS: duration,
      }],
    };
  } catch (err) {
    await fs.remove(output).catch(() => {});
    return {
      status: "failed",
      candidate,
      rejected: [{ id: candidate.id || null, path: input, reason: "ffmpeg_still_motion_failed", error: err.message }],
      blockers: ["ffmpeg_still_motion_failed"],
    };
  }
}

async function writePartialMotionEvidence({
  artifactDir,
  storyId,
  clips,
  blockers,
  generatedAt,
  minClips,
  minFamilies,
  minBaseSources = 0,
} = {}) {
  const partialPath = path.join(artifactDir, "partial_real_motion_evidence.json");
  const clipRows = materializedMotionClipRows(clips, storyId, {
    countsTowardsMotionReadiness: false,
  });
  const families = motionReadinessFamilies(clipRows);
  const baseSourceFamilies = genuineBaseSourceFamilies(clipRows);
  const professionalDiversity = buildProfessionalSourceDiversity(clipRows, minBaseSources);
  const directVideoMotionAssetCount = clipRows.filter(
    (clip) => cleanText(clip.media_kind || "direct_video") === "direct_video",
  ).length;
  const directVideoMotionFamilyCountValue = directVideoMotionFamilyCount(clipRows);
  await fs.writeJson(partialPath, {
    schema_version: 1,
    story_id: storyId,
    status: "blocked",
    ready: false,
    motion_ready: false,
    generated_at: generatedAt,
    not_publishable: true,
    counts_towards_final_render_readiness: false,
    blockers: asArray(blockers).map(cleanText),
    clips: clipRows,
    materialised_clips: clipRows,
    distinct_motion_families: families,
    distinct_source_families: baseSourceFamilies,
    clip_count: clipRows.length,
    distinct_motion_family_count: families.length,
    professional_source_diversity: professionalDiversity,
    direct_video_motion_asset_count: directVideoMotionAssetCount,
    direct_video_motion_family_count: directVideoMotionFamilyCountValue,
    minimum_requirements: {
      min_clips: Number(minClips || DEFAULT_MIN_CLIPS),
      min_distinct_motion_families: Number(minFamilies || DEFAULT_MIN_FAMILIES),
      min_genuine_base_sources: Number(minBaseSources || 0),
      direct_video_motion_required_when_requested: true,
    },
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
      not_scheduler_ready: true,
    },
  }, { spaces: 2 });
  return {
    path: partialPath,
    clip_count: clipRows.length,
    distinct_motion_family_count: families.length,
    distinct_genuine_base_source_count: baseSourceFamilies.length,
    direct_video_motion_asset_count: directVideoMotionAssetCount,
    direct_video_motion_family_count: directVideoMotionFamilyCountValue,
  };
}

async function invalidateArtifactMotionReadiness({
  root = process.cwd(),
  artifactDir,
  storyId,
  clips = [],
  blockers = [],
  generatedAt,
  minBaseSources = 0,
} = {}) {
  const blockedReasons = [...new Set(asArray(blockers).map(cleanText).filter(Boolean))];
  const clipRows = materializedMotionClipRows(clips, storyId, {
    countsTowardsMotionReadiness: false,
  });
  const families = motionReadinessFamilies(clipRows);
  const baseSourceFamilies = genuineBaseSourceFamilies(clipRows);
  const professionalDiversity = buildProfessionalSourceDiversity(clipRows, minBaseSources);
  const materialisedPath = path.join(artifactDir, "materialised_motion_clips.json");
  const familyReportPath = path.join(artifactDir, "distinct_motion_family_report.json");
  const ownedMotionPath = path.join(artifactDir, "owned_motion_manifest.json");
  const footagePath = path.join(artifactDir, "footage_inventory.json");
  const motionPackPath = path.join(
    path.resolve(root),
    "output",
    "studio-v4",
    "motion-packs",
    `${safeFileStem(storyId)}_motion_pack_manifest.json`,
  );
  for (const filePath of [materialisedPath, familyReportPath, ownedMotionPath, footagePath, motionPackPath]) {
    if (await fs.pathExists(filePath)) {
      await backupOnce(filePath, generatedAt, "visual_motion_readiness_invalidation");
    }
  }

  const blockedManifest = {
    schema_version: 1,
    story_id: storyId,
    status: "blocked",
    ready: false,
    motion_ready: false,
    generated_at: generatedAt,
    not_publishable: true,
    counts_towards_final_render_readiness: false,
    blockers: blockedReasons,
    readiness: {
      status: "v4_motion_blocked",
      ready: false,
      motion_ready: false,
      can_publish: false,
      blockers: blockedReasons,
      warnings: [],
    },
    clips: clipRows,
    materialised_clips: clipRows,
    clip_count: clipRows.length,
    distinct_motion_families: families,
    distinct_source_families: baseSourceFamilies,
    distinct_motion_family_count: families.length,
    distinct_genuine_base_source_count: baseSourceFamilies.length,
    professional_source_diversity: professionalDiversity,
    minimum_requirements: {
      min_clips: DEFAULT_MIN_CLIPS,
      min_distinct_motion_families: DEFAULT_MIN_FAMILIES,
      min_genuine_base_sources: Number(minBaseSources || 0),
    },
    safety: {
      stale_ready_evidence_invalidated: true,
      no_publish_triggered: true,
      no_db_mutation: true,
      no_gate_weakened: true,
    },
  };
  await fs.writeJson(materialisedPath, blockedManifest, { spaces: 2 });
  await fs.writeJson(familyReportPath, {
    schema_version: 1,
    story_id: storyId,
    status: "blocked",
    generated_at: generatedAt,
    blockers: blockedReasons,
    summary: {
      clip_count: clipRows.length,
      distinct_motion_family_count: families.length,
      distinct_genuine_base_source_count: baseSourceFamilies.length,
      minimum_required_distinct_motion_families: DEFAULT_MIN_FAMILIES,
      minimum_required_genuine_base_sources: Number(minBaseSources || 0),
    },
    families,
    distinct_motion_families: families,
    distinct_source_families: baseSourceFamilies,
    professional_source_diversity: professionalDiversity,
  }, { spaces: 2 });
  await fs.writeJson(ownedMotionPath, {
    ...blockedManifest,
    source: "validated_real_motion_materializer_visual_audit",
  }, { spaces: 2 });

  const footageInventory = await readJsonIfPresent(footagePath, {});
  await fs.writeJson(footagePath, {
    ...footageInventory,
    status: "blocked",
    ready: false,
    motion_ready: false,
    not_publishable: true,
    counts_towards_final_render_readiness: false,
    readiness: {
      ...(footageInventory.readiness || {}),
      status: "v4_motion_blocked",
      ready: false,
      motion_ready: false,
      can_publish: false,
      blockers: blockedReasons,
    },
    motion_budget: {
      ...(footageInventory.motion_budget || {}),
      status: "blocked",
      ready: false,
      motion_ready: false,
      available_motion_clips: clipRows.length,
      available_distinct_families: families.length,
      available_distinct_motion_families: families.length,
      available_distinct_base_sources: baseSourceFamilies.length,
      required_distinct_base_sources: Number(minBaseSources || 0),
    },
    motion_inventory: {
      ...(footageInventory.motion_inventory || {}),
      status: "blocked",
      ready: false,
      motion_ready: false,
      counts_towards_final_render_readiness: false,
      accepted_local_clips: clipRows,
      production_motion_clips: clipRows,
      distinct_source_families: baseSourceFamilies,
      trusted_local_source_families: baseSourceFamilies,
      professional_source_diversity: professionalDiversity,
    },
  }, { spaces: 2 });

  await fs.ensureDir(path.dirname(motionPackPath));
  await fs.writeJson(motionPackPath, {
    schema_version: 1,
    story_id: storyId,
    status: "blocked",
    generated_at: generatedAt,
    source: "validated_real_motion_materializer_visual_audit",
    readiness: {
      status: "v4_motion_blocked",
      blockers: blockedReasons,
      warnings: [],
    },
    clips: clipRows,
    professional_source_diversity: professionalDiversity,
    motion_budget: {
      available_motion_clips: clipRows.length,
      available_distinct_families: families.length,
      available_distinct_motion_families: families.length,
      available_distinct_base_sources: baseSourceFamilies.length,
      required_motion_scenes: DEFAULT_MIN_CLIPS,
      required_distinct_families: DEFAULT_MIN_FAMILIES,
      required_distinct_base_sources: Number(minBaseSources || 0),
    },
    safety: blockedManifest.safety,
  }, { spaces: 2 });
  return {
    materialised_path: materialisedPath,
    family_report_path: familyReportPath,
    motion_pack_path: motionPackPath,
    clip_count: clipRows.length,
    distinct_motion_family_count: families.length,
    distinct_genuine_base_source_count: baseSourceFamilies.length,
    professional_source_diversity: professionalDiversity,
  };
}

async function bindMaterializedMotionEvidence(clips = [], {
  generatedAt,
  materializedClipProbe,
  materializedClipDecode,
} = {}) {
  const boundClips = [];
  const failures = [];
  for (const [index, clip] of asArray(clips).entries()) {
    const mediaKind = cleanText(clip.media_kind || "direct_video");
    const provenanceState = provenanceStateForAsset(clip);
    const sourceUrl = cleanText(clip.source_url);
    const baseSourceFamily = mediaKind === "direct_video"
      ? directMotionBaseSourceFamily(clip, index)
      : cleanText(clip.base_source_family || clip.source_family);
    const sourceMediaStartS = numberOrNull(
      clip.source_media_start_s ?? clip.mediaStartS ?? clip.media_start_s,
    ) || 0;
    const sourceWindowDurationS = numberOrNull(
      clip.source_window_duration_s ?? clip.durationS ?? clip.duration_s,
    );
    const provenanceConflicts = [
      ...asArray(clip.validation_provenance_conflicts).map(cleanText),
      ...provenanceState.conflicts,
    ].filter(Boolean);
    if (provenanceConflicts.length) {
      failures.push({
        id: cleanText(clip.id),
        path: cleanText(clip.local_materialized_path || clip.path),
        source_url: sourceUrl,
        base_source_family: baseSourceFamily,
        media_start_s: sourceMediaStartS,
        duration_s: sourceWindowDurationS,
        reason: "validation_provenance_conflict",
        error: `validation_provenance_conflict:${[...new Set(provenanceConflicts)].join(",")}`,
      });
      boundClips.push(clip);
      continue;
    }
    try {
      const expectedEvidence = existingMaterializedFileEvidence(clip);
      const materializedFileEvidence = await captureMaterializedClipEvidence(
        clip.local_materialized_path || clip.path,
        {
          generatedAt,
          materializedClipProbe,
          materializedClipDecode,
          expectedEvidence,
          allowExpectedEvidenceCompletion: true,
          expectedMedia: {
            duration_seconds: sourceWindowDurationS,
            video_codec: "h264",
            width: expectedEvidence?.width,
            height: expectedEvidence?.height,
          },
        },
      );
      boundClips.push({
        ...clip,
        source_url: sourceUrl,
        base_source_family: baseSourceFamily,
        mediaStartS: sourceMediaStartS,
        durationS: sourceWindowDurationS,
        source_media_start_s: sourceMediaStartS,
        source_window_duration_s: sourceWindowDurationS,
        materialized_duration_s: materializedFileEvidence.duration_seconds,
        materialized_file_evidence: materializedFileEvidence,
        validation_provenance: provenanceState.validation,
        transformation_provenance: {
          ...provenanceState.transformation,
          base_source_family: baseSourceFamily,
          media_start_s: sourceMediaStartS,
          duration_s: sourceWindowDurationS,
        },
        provenance: provenanceState.validation,
      });
    } catch (error) {
      const blocker = materializedEvidenceBlocker(error);
      failures.push({
        id: cleanText(clip.id),
        path: cleanText(clip.local_materialized_path || clip.path),
        source_url: sourceUrl,
        base_source_family: baseSourceFamily,
        media_start_s: sourceMediaStartS,
        duration_s: sourceWindowDurationS,
        reason: blocker,
        error: cleanText(error.message),
      });
      boundClips.push(clip);
    }
  }
  return { clips: boundClips, failures };
}

async function updateArtifactMotionEvidence({
  root = process.cwd(),
  artifactDir,
  storyId,
  clips,
  rightsLedger,
  footageInventory,
  generatedAt,
  preserveExistingMotion = false,
  recoveredExistingRows = [],
  materializedClipProbe,
  materializedClipDecode,
  clipVisualFingerprint,
  requiredBaseSourceCount = 0,
  requireProfessionalSourceIdentity = false,
  excludedClipIds = [],
  maximumClipCount = 0,
} = {}) {
  const materialisedPath = path.join(artifactDir, "materialised_motion_clips.json");
  const ownedMotionPath = path.join(artifactDir, "owned_motion_manifest.json");
  const footagePath = path.join(artifactDir, "footage_inventory.json");
  const rightsPath = path.join(artifactDir, "rights_ledger.json");
  const motionPackPath = path.join(
    path.resolve(root),
    "output",
    "studio-v4",
    "motion-packs",
    `${safeFileStem(storyId)}_motion_pack_manifest.json`,
  );

  const clipRows = withoutExcludedMotionClips(
    materializedMotionClipRows(clips, storyId),
    excludedClipIds,
  );
  const existingRows = preserveExistingMotion
    ? withoutExcludedMotionClips(mergeMotionRows(
        existingMotionClipRows(footageInventory)
          .filter((row) => row.counts_towards_motion_readiness === true),
        recoveredExistingRows,
      ), excludedClipIds)
    : [];
  const preservedRows = existingRowsWithoutReplacementCollisions(existingRows, clipRows);
  const uncappedMergedCandidateRows = preserveExistingMotion
    ? mergeMotionRows(preservedRows, clipRows)
    : clipRows;
  const mergedCandidateRows = capMergedMotionRows(
    uncappedMergedCandidateRows,
    clipRows,
    maximumClipCount,
  );
  const visualGate = preserveExistingMotion
    ? await filterVisuallyDistinctClips(mergedCandidateRows, {
        clipVisualFingerprint,
        root,
        storyId,
      })
    : { clips: mergedCandidateRows, skipped: [], failures: [] };
  if (visualGate.failures.length) {
    const blockers = ["visual_motion_fingerprint_unavailable"];
    const invalidated = await invalidateArtifactMotionReadiness({
      root,
      artifactDir,
      storyId,
      clips: visualGate.clips,
      blockers,
      generatedAt,
      minBaseSources: requiredBaseSourceCount,
    });
    return {
      status: "blocked",
      blockers,
      evidence_failures: visualGate.failures,
      ...invalidated,
    };
  }
  const unboundMergedClipRows = visualGate.clips;
  const evidenceBinding = await bindMaterializedMotionEvidence(unboundMergedClipRows, {
    generatedAt,
    materializedClipProbe,
    materializedClipDecode,
  });
  if (evidenceBinding.failures.length) {
    const blockers = [...new Set(evidenceBinding.failures.map((failure) => cleanText(failure.reason)))];
    const invalidated = await invalidateArtifactMotionReadiness({
      root,
      artifactDir,
      storyId,
      clips: evidenceBinding.clips,
      blockers,
      generatedAt,
      minBaseSources: requiredBaseSourceCount,
    });
    return {
      status: "blocked",
      blockers,
      evidence_failures: evidenceBinding.failures,
      ...invalidated,
    };
  }
  const mergedClipRows = evidenceBinding.clips;
  const families = motionReadinessFamilies(mergedClipRows);
  const baseSourceFamilies = genuineBaseSourceFamilies(mergedClipRows);
  const professionalSourceDiversity = buildProfessionalSourceDiversity(
    mergedClipRows,
    requiredBaseSourceCount,
  );
  const hardMotionBudgetFailures = [
    ...(mergedClipRows.length < DEFAULT_MIN_CLIPS
      ? [{
          reason: "real_motion_clip_minimum_not_met",
          error: `real_motion_clip_minimum_not_met:${mergedClipRows.length}/${DEFAULT_MIN_CLIPS}`,
        }]
      : []),
    ...(families.length < DEFAULT_MIN_FAMILIES
      ? [{
          reason: "real_motion_family_minimum_not_met",
          error: `real_motion_family_minimum_not_met:${families.length}/${DEFAULT_MIN_FAMILIES}`,
        }]
      : []),
    ...(requiredBaseSourceCount > 0 && baseSourceFamilies.length < requiredBaseSourceCount
      ? [{
          reason: "genuine_base_source_minimum_not_met",
          error: `genuine_base_source_minimum_not_met:${baseSourceFamilies.length}/${requiredBaseSourceCount}`,
        }]
      : []),
    ...(requireProfessionalSourceIdentity && professionalSourceDiversity.status !== "pass"
      ? professionalSourceDiversity.blockers.map((reason) => ({
          reason,
          error: `${reason}:ultimate_professional_motion_source_proof_failed`,
        }))
      : []),
  ];
  if (hardMotionBudgetFailures.length) {
    const blockers = hardMotionBudgetFailures.map((failure) => failure.reason);
    const invalidated = await invalidateArtifactMotionReadiness({
      root,
      artifactDir,
      storyId,
      clips: mergedClipRows,
      blockers,
      generatedAt,
      minBaseSources: requiredBaseSourceCount,
    });
    return {
      status: "blocked",
      blockers,
      evidence_failures: hardMotionBudgetFailures,
      ...invalidated,
      professional_source_diversity: professionalSourceDiversity,
    };
  }

  await backupOnce(footagePath, generatedAt, "real_motion_materialization");
  await backupOnce(rightsPath, generatedAt, "real_motion_materialization");
  const directVideoMotionAssetCount = mergedClipRows.filter(
    (clip) => cleanText(clip.media_kind || "direct_video") === "direct_video",
  ).length;
  const directVideoMotionFamilyCountValue = directVideoMotionFamilyCount(mergedClipRows);
  const reconciledMotionBudget = reconciledMotionBudgetAfterRealMaterialization(
    footageInventory.motion_budget || {},
    mergedClipRows,
    requiredBaseSourceCount,
  );

  const rightsReconciliation = reconcileMaterializedRightsRecords(mergedClipRows, rightsLedger);
  const restrictiveLedgerStatus = restrictiveRightsRecordStatus(rightsLedger);
  const scriptRepairTransition = await inspectPostScriptMediaTransition({
    artifactDir,
    rightsLedger,
    materializedClipProbe,
    materializedClipDecode,
  });
  const repairableScriptTransition =
    scriptRepairTransition.reconciliation_allowed === true;
  const scriptRepairRenderHold =
    repairableScriptTransition &&
    scriptRepairTransition.render_fresh !== true;
  const ledgerStatusFailures = restrictiveLedgerStatus &&
    !onlyRepairableMissingRightsRecordFailure(rightsLedger) &&
    !repairableScriptTransition
    ? [{
        reason: "rights_ledger_rejected",
        error: `rights_ledger_rejected:${restrictiveLedgerStatus}`,
      }]
    : [];
  const remainingRightsFailures = asArray(rightsLedger.failures)
    .filter((failure) => cleanText(failure) !== "rights:no_rights_record");
  const unresolvedRightsFailures = remainingRightsFailures.map((failure) => ({
    reason: "rights_evidence_unresolved",
    error: `rights_evidence_unresolved:${cleanText(failure)}`,
  }));
  const rightsFailures = [
    ...ledgerStatusFailures,
    ...rightsReconciliation.failures,
    ...unresolvedRightsFailures,
  ];
  if (rightsFailures.length) {
    const blockers = [...new Set(rightsFailures.map((failure) => cleanText(failure.reason)))];
    const invalidated = await invalidateArtifactMotionReadiness({
      root,
      artifactDir,
      storyId,
      clips: mergedClipRows,
      blockers,
      generatedAt,
      minBaseSources: requiredBaseSourceCount,
    });
    return {
      status: "blocked",
      blockers,
      evidence_failures: rightsFailures,
      ...invalidated,
    };
  }
  const reconciledReadiness = reconciledMotionReadinessAfterRealMaterialization(
    footageInventory.readiness || {},
    reconciledMotionBudget,
    { rightsReconciled: true },
  );
  const ready = reconciledReadiness.ready === true;
  const updatedFootage = {
    ...footageInventory,
    status: ready ? "ready" : "blocked",
    ready,
    motion_ready: ready,
    not_publishable: scriptRepairRenderHold || !ready,
    counts_towards_final_render_readiness: ready,
    readiness: {
      ...reconciledReadiness,
      can_publish: scriptRepairRenderHold
        ? false
        : reconciledReadiness.can_publish,
      blockers: asArray(reconciledReadiness.blockers),
      publish_blockers: scriptRepairRenderHold
        ? [SCRIPT_REPAIR_RIGHTS_TRANSITION_BLOCKER]
        : [],
    },
    motion_budget: {
      ...reconciledMotionBudget,
      status: ready ? "ready" : "blocked",
      ready,
      motion_ready: ready,
      counts_towards_final_render_readiness: ready,
    },
    motion_inventory: {
      ...(footageInventory.motion_inventory || {}),
      status: ready ? "ready" : "blocked",
      ready,
      motion_ready: ready,
      counts_towards_final_render_readiness: ready,
      accepted_local_clips: mergedClipRows,
      production_motion_clips: mergedClipRows,
      distinct_source_families: baseSourceFamilies,
      trusted_local_source_families: baseSourceFamilies,
      direct_video_motion_asset_count: directVideoMotionAssetCount,
      direct_video_motion_family_count: directVideoMotionFamilyCountValue,
      real_motion_materialized_at: generatedAt,
      professional_source_diversity: professionalSourceDiversity,
    },
  };
  const records = rightsReconciliation.records;
  const {
    rights_ledger: _legacyRightsLedger,
    rights_records: _legacyRightsRecords,
    matched_assets: _legacyMatchedAssets,
    used_assets: _staleUsedAssets,
    metrics: _staleMetrics,
    ...canonicalLedgerBase
  } = rightsLedger;
  const updatedRights = {
    ...canonicalLedgerBase,
    story_id: storyId,
    verdict: scriptRepairRenderHold ? "RED" : "pass",
    status: scriptRepairRenderHold ? "blocked" : "ready",
    blockers: scriptRepairRenderHold
      ? [SCRIPT_REPAIR_RIGHTS_TRANSITION_BLOCKER]
      : [],
    failures: remainingRightsFailures,
    records,
    used_assets: records.map((record) => ({
      asset_id: record.asset_id,
      kind: record.kind,
      path: record.path,
      source_url: record.source_url,
      source_type: record.source_type,
      source_family: record.source_family || record.motion_family,
      asset_sha256: record.asset_sha256,
      asset_size_bytes: record.asset_size_bytes,
    })),
    metrics: {
      used_asset_count: records.length,
      rights_record_count: records.length,
      missing_asset_count: 0,
      duplicate_record_count: 0,
    },
    rights_ledger_repaired_at: generatedAt,
    rights_ledger_repair_strategy: "materialised_validated_direct_media_to_explicit_rights_records",
    narration_transition_reconciled:
      repairableScriptTransition && !scriptRepairRenderHold
        ? SCRIPT_REPAIR_RIGHTS_TRANSITION_BLOCKER
        : null,
    can_auto_publish: scriptRepairRenderHold
      ? false
      : canonicalLedgerBase.can_auto_publish,
    result: scriptRepairRenderHold ? "BLOCKED" : "PASS",
    reconciliation: {
      ...(canonicalLedgerBase.reconciliation || {}),
      current_files_hashed: true,
      final_render_decoded: repairableScriptTransition
        ? scriptRepairTransition.render_fresh === true
        : canonicalLedgerBase.reconciliation?.final_render_decoded,
      current_narration_regenerated_after_script_repair:
        repairableScriptTransition
          ? scriptRepairTransition.narration_fresh === true
          : canonicalLedgerBase.reconciliation
            ?.current_narration_regenerated_after_script_repair,
      current_render_regenerated_after_script_repair:
        repairableScriptTransition
          ? scriptRepairTransition.render_fresh === true
          : canonicalLedgerBase.reconciliation
            ?.current_render_regenerated_after_script_repair,
    },
    script_repair_media_transition: repairableScriptTransition
      ? {
          ...scriptRepairTransition,
          status: scriptRepairRenderHold
            ? "awaiting_fresh_render"
            : "reconciled",
          motion_rights_reconciled: true,
          blocker: scriptRepairRenderHold
            ? SCRIPT_REPAIR_RIGHTS_TRANSITION_BLOCKER
            : null,
          reconciled_at: generatedAt,
        }
      : canonicalLedgerBase.script_repair_media_transition,
  };

  await fs.writeJson(footagePath, updatedFootage, { spaces: 2 });
  await fs.writeJson(rightsPath, updatedRights, { spaces: 2 });
  await fs.writeJson(materialisedPath, {
    schema_version: 1,
    story_id: storyId,
    status: "ready",
    generated_at: generatedAt,
    clips: mergedClipRows,
    materialised_clips: mergedClipRows,
    distinct_motion_families: families,
    distinct_source_families: baseSourceFamilies,
    clip_count: mergedClipRows.length,
    distinct_motion_family_count: families.length,
    distinct_genuine_base_source_count: baseSourceFamilies.length,
    professional_source_diversity: professionalSourceDiversity,
    minimum_requirements: {
      min_clips: DEFAULT_MIN_CLIPS,
      min_distinct_motion_families: DEFAULT_MIN_FAMILIES,
      min_genuine_base_sources: Number(requiredBaseSourceCount || 0),
    },
    direct_video_motion_asset_count: directVideoMotionAssetCount,
    direct_video_motion_family_count: directVideoMotionFamilyCountValue,
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "distinct_motion_family_report.json"), {
    schema_version: 1,
    story_id: storyId,
    status: "ready",
    generated_at: generatedAt,
    summary: {
      clip_count: mergedClipRows.length,
      distinct_motion_family_count: families.length,
      distinct_genuine_base_source_count: baseSourceFamilies.length,
      direct_video_motion_family_count: directVideoMotionFamilyCountValue,
      minimum_required_distinct_motion_families: DEFAULT_MIN_FAMILIES,
      minimum_required_genuine_base_sources: Number(requiredBaseSourceCount || 0),
    },
    families,
    distinct_motion_families: families,
    distinct_source_families: baseSourceFamilies,
    professional_source_diversity: professionalSourceDiversity,
  }, { spaces: 2 });
  await fs.writeJson(ownedMotionPath, {
    schema_version: 1,
    story_id: storyId,
    status: "ready",
    generated_at: generatedAt,
    materialised_clips: mergedClipRows,
    distinct_motion_families: families,
    distinct_source_families: baseSourceFamilies,
    direct_video_motion_asset_count: directVideoMotionAssetCount,
    direct_video_motion_family_count: directVideoMotionFamilyCountValue,
    professional_source_diversity: professionalSourceDiversity,
    source: "validated_real_motion_materializer",
    note: "Real source motion clips, not owned/generated card substitutes.",
  }, { spaces: 2 });
  await fs.ensureDir(path.dirname(motionPackPath));
  await fs.writeJson(motionPackPath, {
    schema_version: 1,
    story_id: storyId,
    status: "ready",
    generated_at: generatedAt,
    source: "validated_real_motion_materializer",
    readiness: {
      status: "v4_motion_ready",
      blockers: [],
      warnings: [],
    },
    clips: mergedClipRows,
    professional_source_diversity: professionalSourceDiversity,
    handoff: {
      visual_v4_local_motion_clips: mergedClipRows,
      trusted_local_source_families: baseSourceFamilies,
      direct_video_motion_asset_count: directVideoMotionAssetCount,
      direct_video_motion_family_count: directVideoMotionFamilyCountValue,
      professional_source_diversity: professionalSourceDiversity,
    },
    motion_budget: {
      available_motion_clips: mergedClipRows.length,
      available_distinct_families: families.length,
      available_distinct_motion_families: families.length,
      available_distinct_base_sources: baseSourceFamilies.length,
      required_motion_scenes: DEFAULT_MIN_CLIPS,
      required_distinct_families: DEFAULT_MIN_FAMILIES,
      required_distinct_base_sources: Number(requiredBaseSourceCount || 0),
    },
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  }, { spaces: 2 });
  return {
    status: "ready",
    publish_hold: scriptRepairRenderHold
      ? SCRIPT_REPAIR_RIGHTS_TRANSITION_BLOCKER
      : null,
    rights_transition_status: repairableScriptTransition
      ? scriptRepairRenderHold
        ? "awaiting_fresh_render"
        : "reconciled"
      : null,
    clip_count: mergedClipRows.length,
    selected_clips: mergedClipRows,
    distinct_motion_family_count: families.length,
    distinct_genuine_base_source_count: baseSourceFamilies.length,
    direct_video_motion_asset_count: directVideoMotionAssetCount,
    direct_video_motion_family_count: directVideoMotionFamilyCountValue,
    professional_source_diversity: professionalSourceDiversity,
    motion_pack_path: motionPackPath,
  };
}

async function materializeRealMotionJob(job = {}, options = {}) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  const storyId = cleanText(job.story_id);
  const title = cleanText(job.title);
  const blockers = [];
  if (!storyId) blockers.push("story_id_missing");
  if (!artifactDir || !(await fs.pathExists(artifactDir))) blockers.push("artifact_dir_missing");
  const rightsPath = path.join(artifactDir, "rights_ledger.json");
  const footagePath = path.join(artifactDir, "footage_inventory.json");
  const rightsLedgerRaw = await readJsonIfPresent(rightsPath, null);
  const rightsLedger = rightsLedgerRaw || {};
  const rightsLedgerStoryId = cleanText(
    rightsLedger.story_id || rightsLedger.storyId,
  );
  if (rightsLedgerStoryId && rightsLedgerStoryId !== storyId) {
    blockers.push("rights_ledger_story_id_mismatch");
  }
  const footageInventory = await readJsonIfPresent(footagePath, {});
  const materialisedArtifact = await readJsonIfPresent(
    path.join(artifactDir, "materialised_motion_clips.json"),
    {},
  );
  const ownedMotionManifest = await readJsonIfPresent(
    path.join(artifactDir, "owned_motion_manifest.json"),
    {},
  );
  const canonicalStory = await readJsonIfPresent(
    path.join(artifactDir, "canonical_story_manifest.json"),
    {},
  );
  const canonicalSubject = cleanText(
    canonicalStory.canonical_subject ||
      canonicalStory.canonical_game ||
      canonicalStory.game_title ||
      canonicalStory.entity,
  );
  const motionPack = await loadMotionPackForStory(options.root, storyId);
  const requiredBaseSourceCount = Math.max(
    requiredGenuineBaseSourceCount(job, options),
    recordedGenuineBaseSourceFloor(
      materialisedArtifact,
      ownedMotionManifest,
      footageInventory,
      motionPack,
    ),
  );
  const staleReadyArtifactDetected = ["ready", "v4_motion_ready", "pass"].includes(
    cleanText(materialisedArtifact.status || materialisedArtifact.readiness?.status),
  );
  const staleReadyCentralPackDetected = motionPackReady(motionPack);
  const staleReadyOwnedMotionDetected = motionEvidenceClaimsReady(ownedMotionManifest);
  const staleReadyFootageDetected = motionEvidenceClaimsReady(footageInventory);
  const segmentValidationReport = options.segmentValidationReport || {};
  const segmentValidationBootstrapCandidates = rightsLedgerRaw
    ? []
    : candidateRows({
      root: options.root,
      rightsLedger: {},
      footageInventory: {},
      motionPack: {},
      segmentValidationReport,
      storyId,
    });
  if (!rightsLedgerRaw && !segmentValidationBootstrapCandidates.length) {
    blockers.push("rights_ledger_missing");
  }
  if (blockers.length) {
    const shouldInvalidateStaleReady = Boolean(
      storyId &&
      await fs.pathExists(artifactDir) &&
      (
        staleReadyArtifactDetected ||
        staleReadyCentralPackDetected ||
        staleReadyOwnedMotionDetected ||
        staleReadyFootageDetected
      ),
    );
    const finalBlockers = [
      ...blockers,
      ...(staleReadyArtifactDetected ? ["stale_ready_motion_manifest_unvalidated"] : []),
      ...(staleReadyCentralPackDetected ? ["stale_ready_central_motion_pack_unvalidated"] : []),
      ...(staleReadyOwnedMotionDetected ? ["stale_ready_owned_motion_manifest_unvalidated"] : []),
      ...(staleReadyFootageDetected ? ["stale_ready_footage_inventory_unvalidated"] : []),
    ];
    const invalidatedEvidence = shouldInvalidateStaleReady
      ? await invalidateArtifactMotionReadiness({
          root: options.root,
          artifactDir,
          storyId,
          clips: [],
          blockers: finalBlockers,
          generatedAt: options.generatedAt,
          minBaseSources: requiredBaseSourceCount,
        })
      : null;
    return {
      story_id: storyId,
      title,
      artifact_dir: artifactDir,
      status: "blocked",
      blockers: finalBlockers,
      stale_ready_evidence_invalidated: Boolean(invalidatedEvidence),
      invalidated_evidence: invalidatedEvidence,
    };
  }

  const minClips = Math.max(DEFAULT_MIN_CLIPS, Number(options.minClips || DEFAULT_MIN_CLIPS));
  const minFamilies = Math.max(
    DEFAULT_MIN_FAMILIES,
    Number(options.minFamilies || DEFAULT_MIN_FAMILIES),
  );
  const maximumClipCount = Math.max(
    minClips,
    Number(options.maxClips || 8),
    requiredBaseSourceCount,
  );
  const skippedVisualDuplicates = [];
  const visualFingerprintFailures = [];
  const clipVisualFingerprint = resolveClipVisualFingerprint(options);
  let candidates = balanceDirectVideoCandidatesByBaseSource(expandDirectVideoWindowCandidates(
    withoutExcludedMotionClips(
      candidateRows({
        root: options.root,
        rightsLedger,
        footageInventory,
        motionPack,
        segmentValidationReport,
        storyId,
      }),
      options.excludedClipIds,
    ),
    {
      job,
      minClips,
      maxClips: options.maxClips || 8,
    },
  ));
  const requestedRefreshWindows = refreshWindowPlanRows(options.refreshWindowPlan, storyId);
  const exactRefreshPlanRequested =
    options.refreshExistingMotion === true &&
    requestedRefreshWindows.length > 0;
  if (
    exactRefreshPlanRequested &&
    candidates.length > 0
  ) {
    const plannedCandidates = [];
    const refreshPlanFailures = [];
    for (const [planIndex, planEntry] of requestedRefreshWindows.entries()) {
      if (plannedCandidates.length >= Number(options.maxClips || 8)) {
        refreshPlanFailures.push({
          id: cleanText(planEntry.id),
          reason: "refresh_window_plan_capacity_exceeded",
        });
        continue;
      }
      const planned = exactRefreshWindowCandidate(
        candidates,
        plannedCandidates,
        planEntry,
        planIndex,
        { root: options.root },
      );
      if (!planned.candidate) {
        refreshPlanFailures.push({
          id: cleanText(planEntry.id),
          reason: planned.error,
        });
        continue;
      }
      plannedCandidates.push(planned.candidate);
    }
    if (refreshPlanFailures.length > 0) {
      return {
        story_id: storyId,
        title,
        artifact_dir: artifactDir,
        status: "blocked",
        blockers: ["refresh_window_plan_failed"],
        candidate_count: candidates.length,
        materialized_count: 0,
        failed_count: refreshPlanFailures.length,
        failed: refreshPlanFailures,
      };
    }
    candidates = balanceDirectVideoCandidatesByBaseSource(plannedCandidates);
  }
  if (!candidates.length) {
    if (options.refreshExistingMotion === true) {
      const refreshSelection = await balancedRestorableArtifactClips(footageInventory, {
        root: options.root,
        job,
        minClips,
        minFamilies,
        maxClips: Number(options.maxClips || 8),
        maxDirectClipsPerBaseSource: options.maxDirectClipsPerBaseSource,
        canonicalSubject,
        materialisedArtifact,
        excludedClipIds: options.excludedClipIds,
      });
      let refreshedClips = [...refreshSelection.clips];
      const refreshBaseSourceCounts = new Map(refreshSelection.baseSourceCounts);
      const plannedWindows = refreshWindowPlanRows(options.refreshWindowPlan, storyId);
      const refreshPlanFailures = [];
      for (const [planIndex, planEntry] of plannedWindows.entries()) {
        if (refreshedClips.length >= Number(options.maxClips || 8)) {
          refreshPlanFailures.push({
            id: cleanText(planEntry.id),
            reason: "refresh_window_plan_capacity_exceeded",
          });
          continue;
        }
        const planned = exactRefreshWindowCandidate(
          refreshSelection.candidates,
          refreshedClips,
          planEntry,
          planIndex,
          { root: options.root },
        );
        if (!planned.candidate) {
          refreshPlanFailures.push({
            id: cleanText(planEntry.id),
            reason: planned.error,
          });
          continue;
        }
        const baseSource = directMotionBaseSourceFamily(planned.candidate, planIndex);
        if ((refreshBaseSourceCounts.get(baseSource) || 0) >= refreshSelection.maxPerBaseSource) {
          refreshPlanFailures.push({
            id: cleanText(planEntry.id),
            reason: "refresh_window_plan_base_source_cap_exceeded",
          });
          continue;
        }
        const plannedResult = await materializeCandidate({
          root: options.root,
          storyId,
          canonicalSubject,
          candidate: planned.candidate,
          execFileSync: options.execFileSync,
          ffprobeDuration: options.ffprobeDuration,
          generatedAt: options.generatedAt,
          materializedClipProbe: options.materializedClipProbe,
          materializedClipDecode: options.materializedClipDecode,
        });
        if (plannedResult.status !== "materialized") {
          refreshPlanFailures.push({
            id: cleanText(planEntry.id),
            reason: "refresh_window_plan_materialization_failed",
            blockers: plannedResult.blockers,
            rejected: plannedResult.rejected,
          });
          continue;
        }
        refreshedClips.push({
          ...plannedResult.clip,
          entity: cleanText(plannedResult.clip.entity || canonicalSubject),
          source_owner: cleanText(plannedResult.clip.source_owner || canonicalSubject),
        });
        refreshBaseSourceCounts.set(
          baseSource,
          (refreshBaseSourceCounts.get(baseSource) || 0) + 1,
        );
      }
      if (refreshPlanFailures.length) {
        return {
          story_id: storyId,
          title,
          artifact_dir: artifactDir,
          status: "blocked",
          blockers: ["refresh_window_plan_failed"],
          candidate_count: 0,
          materialized_count: refreshedClips.length,
          failed_count: refreshPlanFailures.length,
          failed: refreshPlanFailures,
        };
      }
      if (refreshBaseSourceCounts.size >= minFamilies) {
        const automaticTarget = plannedWindows.length
          ? minClips
          : Number(options.maxClips || 8);
        while (refreshedClips.length < automaticTarget) {
          const baseSource = [...refreshBaseSourceCounts.entries()]
            .filter(([, count]) => count < refreshSelection.maxPerBaseSource)
            .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0]?.[0];
          if (!baseSource) break;
          const supplementalCandidate = supplementalRefreshWindowCandidate(
            refreshSelection.candidates,
            refreshedClips,
            baseSource,
            refreshedClips.length,
          );
          if (!supplementalCandidate) {
            refreshBaseSourceCounts.set(baseSource, refreshSelection.maxPerBaseSource);
            continue;
          }
          const supplementalResult = await materializeCandidate({
            root: options.root,
            storyId,
            canonicalSubject,
            candidate: supplementalCandidate,
            execFileSync: options.execFileSync,
            ffprobeDuration: options.ffprobeDuration,
            generatedAt: options.generatedAt,
            materializedClipProbe: options.materializedClipProbe,
            materializedClipDecode: options.materializedClipDecode,
          });
          if (supplementalResult.status !== "materialized") {
            refreshBaseSourceCounts.set(baseSource, refreshSelection.maxPerBaseSource);
            continue;
          }
          refreshedClips.push({
            ...supplementalResult.clip,
            entity: cleanText(supplementalResult.clip.entity || canonicalSubject),
            source_owner: cleanText(supplementalResult.clip.source_owner || canonicalSubject),
          });
          refreshBaseSourceCounts.set(
            baseSource,
            (refreshBaseSourceCounts.get(baseSource) || 0) + 1,
          );
        }
      }
      const refreshedVisualGate = await filterVisuallyDistinctClips(refreshedClips, {
        clipVisualFingerprint,
        root: options.root,
        storyId,
      });
      refreshedClips = refreshedVisualGate.clips;
      skippedVisualDuplicates.push(...refreshedVisualGate.skipped);
      visualFingerprintFailures.push(...refreshedVisualGate.failures);
      if (refreshedClips.length >= minClips) {
        const updateSummary = await updateArtifactMotionEvidence({
          root: options.root,
          artifactDir,
          storyId,
          clips: refreshedClips,
          rightsLedger,
          footageInventory,
          generatedAt: options.generatedAt,
          preserveExistingMotion: false,
          materializedClipProbe: options.materializedClipProbe,
          materializedClipDecode: options.materializedClipDecode,
          clipVisualFingerprint,
          requiredBaseSourceCount,
          excludedClipIds: options.excludedClipIds,
          maximumClipCount,
        });
        if (updateSummary.status === "blocked") {
          return {
            story_id: storyId,
            title,
            artifact_dir: artifactDir,
            status: "blocked",
            blockers: updateSummary.blockers,
            candidate_count: 0,
            materialized_count: refreshedClips.length,
            failed_count: updateSummary.evidence_failures.length,
            failed: updateSummary.evidence_failures,
            stale_ready_evidence_invalidated: true,
            invalidated_evidence: updateSummary,
          };
        }
        const directBaseSourceCounts = new Map();
        refreshedClips.forEach((clip, index) => {
          const baseSource = directMotionBaseSourceFamily(clip, index);
          if (baseSource) {
            directBaseSourceCounts.set(baseSource, (directBaseSourceCounts.get(baseSource) || 0) + 1);
          }
        });
        return {
          story_id: storyId,
          title,
          artifact_dir: artifactDir,
          status: "materialized",
          repair_scope: refreshedClips.some(
            (clip) =>
              clip.recovery_provenance?.mode ===
              "hash_bound_ready_materialised_inventory_reconciliation",
          )
            ? "stale_inventory_authority_reconciliation"
            : "artifact_materialized_motion_rebalance",
          blockers: [],
          publish_hold: updateSummary.publish_hold,
          rights_transition_status: updateSummary.rights_transition_status,
          candidate_count: 0,
          materialized_count: refreshedClips.length,
          distinct_motion_family_count: motionReadinessFamilies(refreshedClips).length,
          direct_video_motion_clip_count: refreshedClips.length,
          direct_video_motion_family_count: directVideoMotionFamilyCount(refreshedClips),
          direct_motion_base_source_clip_counts: [...directBaseSourceCounts.entries()]
            .map(([base_source_family, count]) => ({ base_source_family, count }))
            .sort((a, b) => b.count - a.count || a.base_source_family.localeCompare(b.base_source_family)),
          max_direct_motion_clips_per_base_source: Math.max(...directBaseSourceCounts.values()),
          total_motion_clip_count: updateSummary.clip_count,
          total_distinct_motion_family_count: updateSummary.distinct_motion_family_count,
          total_direct_video_motion_asset_count: updateSummary.direct_video_motion_asset_count,
          total_direct_video_motion_family_count: updateSummary.direct_video_motion_family_count,
          central_motion_pack_path: updateSummary.motion_pack_path,
          failed_count: 0,
          skipped_visual_duplicate_count: skippedVisualDuplicates.length,
          skipped_visual_duplicates: skippedVisualDuplicates.slice(0, 10),
          visual_fingerprint_failure_count: visualFingerprintFailures.length,
          visual_fingerprint_failures: visualFingerprintFailures.slice(0, 10),
          clips: (updateSummary.selected_clips || refreshedClips).map((clip) => ({
            id: clip.id,
            path: clip.path,
            source_family: clip.source_family,
            source_url: clip.source_url,
            media_kind: "direct_video",
            entity: clip.entity,
          })),
        };
      }
    }
    const centralRestorableClips = withoutExcludedMotionClips(
      restorableMaterializedMotionPackClips(
        motionPack,
        { root: options.root },
      ),
      options.excludedClipIds,
    );
    const selectorRestorableClips = withoutExcludedMotionClips(
      await governedSelectorRecoveryRows(
        artifactDir,
        { root: options.root },
      ),
      options.excludedClipIds,
    );
    const restorableClips = centralRestorableClips.length >= minClips
      ? centralRestorableClips
      : selectorRestorableClips.length >= minClips
        ? selectorRestorableClips
        : mergeMotionRows(centralRestorableClips, selectorRestorableClips);
    const selectorClipKeys = new Set(
      selectorRestorableClips.map((clip) => exactClipIdentityKey(clip)).filter(Boolean),
    );
    const restoredVisualGate = await filterVisuallyDistinctClips(
      restorableClips,
      { clipVisualFingerprint, root: options.root, storyId },
    );
    const restoredClips = restoredVisualGate.clips;
    const recoveredSelectorClipCount = restoredClips.filter((clip) =>
      selectorClipKeys.has(exactClipIdentityKey(clip)),
    ).length;
    skippedVisualDuplicates.push(...restoredVisualGate.skipped);
    visualFingerprintFailures.push(...restoredVisualGate.failures);
    if (restoredClips.length >= minClips) {
      const updateSummary = await updateArtifactMotionEvidence({
        root: options.root,
        artifactDir,
        storyId,
        clips: restoredClips,
        rightsLedger,
        footageInventory,
        generatedAt: options.generatedAt,
        preserveExistingMotion: true,
        materializedClipProbe: options.materializedClipProbe,
        materializedClipDecode: options.materializedClipDecode,
        clipVisualFingerprint,
        requiredBaseSourceCount,
        excludedClipIds: options.excludedClipIds,
        maximumClipCount,
      });
      if (updateSummary.status === "blocked") {
        return {
          story_id: storyId,
          title,
          artifact_dir: artifactDir,
          status: "blocked",
          blockers: updateSummary.blockers,
          candidate_count: 0,
          materialized_count: restoredClips.length,
          failed_count: updateSummary.evidence_failures.length,
          failed: updateSummary.evidence_failures,
          stale_ready_evidence_invalidated: true,
          invalidated_evidence: updateSummary,
        };
      }
      return {
        story_id: storyId,
        title,
        artifact_dir: artifactDir,
        status: "materialized",
        repair_scope: recoveredSelectorClipCount > 0
          ? "selector_materialized_motion_restore"
          : "central_materialized_motion_restore",
        blockers: [],
        publish_hold: updateSummary.publish_hold,
        rights_transition_status: updateSummary.rights_transition_status,
        candidate_count: 0,
        recovered_selector_clip_count: recoveredSelectorClipCount,
        materialized_count: restoredClips.length,
        distinct_motion_family_count: motionReadinessFamilies(restoredClips).length,
        direct_video_motion_clip_count: restoredClips.length,
        direct_video_motion_family_count: directVideoMotionFamilyCount(restoredClips),
        total_motion_clip_count: updateSummary.clip_count,
        total_distinct_motion_family_count: updateSummary.distinct_motion_family_count,
        total_direct_video_motion_asset_count: updateSummary.direct_video_motion_asset_count,
        total_direct_video_motion_family_count: updateSummary.direct_video_motion_family_count,
        central_motion_pack_path: updateSummary.motion_pack_path,
        failed_count: 0,
        skipped_visual_duplicate_count: skippedVisualDuplicates.length,
        skipped_visual_duplicates: skippedVisualDuplicates.slice(0, 10),
        visual_fingerprint_failure_count: visualFingerprintFailures.length,
        visual_fingerprint_failures: visualFingerprintFailures.slice(0, 10),
        clips: (updateSummary.selected_clips || restoredClips).map((clip) => ({
          id: clip.id,
          path: clip.path,
          source_family: clip.source_family,
          source_url: clip.source_url,
          media_kind: "direct_video",
        })),
      };
    }
    let invalidationClips = restoredClips;
    if (staleReadyArtifactDetected && !restoredClips.length) {
      const artifactRows = existingMotionClipRows({
        motion_inventory: {
          accepted_local_clips: asArray(
            materialisedArtifact.clips || materialisedArtifact.materialised_clips,
          ),
        },
      });
      const existingArtifactRows = [];
      for (const row of artifactRows) {
        const localPath = cleanText(row.path || row.local_materialized_path);
        if (!localPath || /^https?:\/\//i.test(localPath)) continue;
        if (await fs.pathExists(localPath)) existingArtifactRows.push(row);
      }
      const artifactVisualGate = await filterVisuallyDistinctClips(existingArtifactRows, {
        clipVisualFingerprint,
        root: options.root,
        storyId,
      });
      invalidationClips = artifactVisualGate.clips;
      skippedVisualDuplicates.push(...artifactVisualGate.skipped);
      visualFingerprintFailures.push(...artifactVisualGate.failures);
    }
    const invalidationFamilies = motionReadinessFamilies(invalidationClips);
    const invalidationBaseSourceFamilies = genuineBaseSourceFamilies(invalidationClips);
    const hardFloorBlockers = [
      ...(invalidationClips.length < DEFAULT_MIN_CLIPS
        ? ["real_motion_clip_minimum_not_met"]
        : []),
      ...(invalidationFamilies.length < DEFAULT_MIN_FAMILIES
        ? ["real_motion_family_minimum_not_met"]
        : []),
      ...(requiredBaseSourceCount > 0 &&
      invalidationBaseSourceFamilies.length < requiredBaseSourceCount
        ? ["genuine_base_source_minimum_not_met"]
        : []),
    ];
    const finalBlockers = [
      "validated_direct_media_candidates_missing",
      ...(staleReadyArtifactDetected ? ["stale_ready_motion_manifest_unvalidated"] : []),
      ...(staleReadyCentralPackDetected ? ["stale_ready_central_motion_pack_unvalidated"] : []),
      ...(staleReadyOwnedMotionDetected ? ["stale_ready_owned_motion_manifest_unvalidated"] : []),
      ...(staleReadyFootageDetected ? ["stale_ready_footage_inventory_unvalidated"] : []),
      ...hardFloorBlockers,
      ...(skippedVisualDuplicates.length ? ["visual_motion_duplicate_content_detected"] : []),
      ...(visualFingerprintFailures.length ? ["visual_motion_fingerprint_unavailable"] : []),
    ];
    const invalidatedEvidence = staleReadyArtifactDetected ||
      staleReadyCentralPackDetected ||
      staleReadyOwnedMotionDetected ||
      staleReadyFootageDetected ||
      skippedVisualDuplicates.length ||
      visualFingerprintFailures.length
      ? await invalidateArtifactMotionReadiness({
        root: options.root,
        artifactDir,
        storyId,
        clips: invalidationClips,
        blockers: finalBlockers,
        generatedAt: options.generatedAt,
        minBaseSources: requiredBaseSourceCount,
      })
      : null;
    return {
      story_id: storyId,
      title,
      artifact_dir: artifactDir,
      status: "blocked",
      blockers: finalBlockers,
      candidate_count: 0,
      skipped_visual_duplicate_count: skippedVisualDuplicates.length,
      skipped_visual_duplicates: skippedVisualDuplicates.slice(0, 10),
      visual_fingerprint_failure_count: visualFingerprintFailures.length,
      visual_fingerprint_failures: visualFingerprintFailures.slice(0, 10),
      stale_ready_evidence_invalidated: Boolean(invalidatedEvidence),
      invalidated_evidence: invalidatedEvidence,
    };
  }

  const materialized = [];
  const failed = [];
  const seenFamilies = new Set();
  const seenDirectWindows = new Set();
  const directBaseSourceCounts = new Map();
  const skippedDuplicateBaseSources = [];
  const skippedDuplicateDirectWindows = [];
  const skippedVisualQuality = [];
  const visualQualityFailures = [];
  const visualRepairs = [];
  const acceptedVisualFingerprints = [];
  const maxDirectClipsPerBaseSource = dynamicMaxDirectClipsPerBaseSource(candidates, {
    job,
    minClips,
    minFamilies,
    maxClips: options.maxClips || 8,
    explicitMax: options.maxDirectClipsPerBaseSource,
    hasRightsLedger: Boolean(rightsLedgerRaw),
  });
  for (const candidate of candidates) {
    if (materialized.length >= (options.maxClips || 8)) break;
    const isDirectVideoCandidate = cleanText(candidate.media_kind) === "direct_video";
    const candidateFamily = directMotionReadinessFamily(candidate, materialized.length);
    const candidateBaseFamily = directMotionBaseSourceFamily(candidate, materialized.length);
    const candidateWindowKey = directMotionWindowKey(candidate, materialized.length);
    if (isDirectVideoCandidate && candidateWindowKey && seenDirectWindows.has(candidateWindowKey)) {
      skippedDuplicateDirectWindows.push({
        id: cleanText(candidate.id),
        source_family: cleanText(candidate.source_family),
        base_source_family: candidateBaseFamily,
        source_url: cleanText(candidate.source_url),
        media_start_s: numberOrNull(candidate.mediaStartS ?? candidate.media_start_s),
        duration_s: numberOrNull(candidate.durationS ?? candidate.duration_s),
      });
      continue;
    }
    if (
      isDirectVideoCandidate &&
      candidateBaseFamily &&
      (directBaseSourceCounts.get(candidateBaseFamily) || 0) >= maxDirectClipsPerBaseSource
    ) {
      skippedDuplicateBaseSources.push({
        id: cleanText(candidate.id),
        source_family: cleanText(candidate.source_family),
        base_source_family: candidateBaseFamily,
        source_url: cleanText(candidate.source_url),
        max_clips_per_base_source: maxDirectClipsPerBaseSource,
      });
      continue;
    }
    const overlappingWindow = isDirectVideoCandidate
      ? overlappingDirectMotionWindow(candidate, materialized, materialized.length)
      : null;
    if (overlappingWindow) {
      skippedDuplicateDirectWindows.push({
        id: cleanText(candidate.id),
        source_family: cleanText(candidate.source_family),
        base_source_family: candidateBaseFamily,
        source_url: cleanText(candidate.source_url),
        media_start_s: numberOrNull(candidate.mediaStartS ?? candidate.media_start_s),
        duration_s: numberOrNull(candidate.durationS ?? candidate.duration_s),
        matched_clip_id: cleanText(overlappingWindow.id),
        reason: "source_window_overlaps_selected_window",
      });
      continue;
    }
    const result = await materializeCandidate({
      root: options.root,
      storyId,
      canonicalSubject,
      candidate,
      execFileSync: options.execFileSync,
      ffprobeDuration: options.ffprobeDuration,
      generatedAt: options.generatedAt,
      materializedClipProbe: options.materializedClipProbe,
      materializedClipDecode: options.materializedClipDecode,
    });
    if (result.status === "materialized") {
      let acceptedClip = result.clip;
      if (typeof options.clipVisualEligibility === "function") {
        let visualQuality = null;
        try {
          visualQuality = await options.clipVisualEligibility(result.clip, {
            root: options.root,
            storyId,
            candidate,
          });
        } catch (error) {
          visualQualityFailures.push({
            id: cleanText(candidate.id),
            source_family: cleanText(candidate.source_family),
            source_url: cleanText(candidate.source_url),
            reason: "premium_motion_visual_quality_scan_failed",
            error: cleanText(error.message),
          });
          continue;
        }
        const visualQualityEligible =
          visualQuality === true ||
          (visualQuality && visualQuality.eligible === true);
        if (!visualQualityEligible) {
          skippedVisualQuality.push({
            id: cleanText(candidate.id),
            source_family: cleanText(candidate.source_family),
            base_source_family: candidateBaseFamily,
            source_url: cleanText(candidate.source_url),
            reasons: asArray(visualQuality?.reasons).map(cleanText).filter(Boolean),
            metrics:
              visualQuality?.metrics && typeof visualQuality.metrics === "object"
                ? structuredClone(visualQuality.metrics)
                : undefined,
            visual_repair:
              visualQuality?.visual_repair &&
              typeof visualQuality.visual_repair === "object"
                ? structuredClone(visualQuality.visual_repair)
                : undefined,
            repairs: asArray(visualQuality?.repairs)
              .filter((repair) => repair && typeof repair === "object")
              .map((repair) => structuredClone(repair)),
          });
          continue;
        }
        const replacementClip =
          visualQuality &&
          typeof visualQuality === "object" &&
          visualQuality.replacement_clip &&
          typeof visualQuality.replacement_clip === "object"
            ? visualQuality.replacement_clip
            : null;
        if (replacementClip) {
          const originalClipId = cleanText(result.clip.id || candidate.id);
          const replacementClipId = cleanText(replacementClip.id || originalClipId);
          const replacementPath = cleanText(
            replacementClip.local_materialized_path ||
              replacementClip.path ||
              replacementClip.local_path,
          );
          if (
            !replacementPath ||
            !(await fs.pathExists(path.resolve(replacementPath))) ||
            (originalClipId && replacementClipId !== originalClipId)
          ) {
            visualQualityFailures.push({
              id: cleanText(candidate.id),
              source_family: cleanText(candidate.source_family),
              source_url: cleanText(candidate.source_url),
              reason: "premium_motion_visual_repair_invalid",
              error: !replacementPath
                ? "replacement_path_missing"
                : originalClipId && replacementClipId !== originalClipId
                  ? "replacement_clip_identity_mismatch"
                  : "replacement_path_unreadable",
            });
            continue;
          }
          acceptedClip = {
            ...result.clip,
            ...replacementClip,
            id: originalClipId,
            path: replacementPath,
            local_materialized_path: replacementPath,
            source_url: result.clip.source_url,
            source_family: result.clip.source_family,
            base_source_family: result.clip.base_source_family,
            source_master_sha256: result.clip.source_master_sha256,
            source_identity_provenance: result.clip.source_identity_provenance,
            validation_provenance: result.clip.validation_provenance,
            counts_towards_motion_readiness: true,
          };
          visualRepairs.push({
            id: originalClipId,
            status: cleanText(replacementClip.visual_repair?.status || "pass"),
            kind: cleanText(replacementClip.visual_repair?.kind),
            source_path: cleanText(
              replacementClip.visual_repair?.source_path || result.clip.path,
            ),
            output_path: replacementPath,
          });
        }
      }
      if (clipVisualFingerprint) {
        let fingerprint = null;
        try {
          fingerprint = await clipVisualFingerprint(acceptedClip, {
            root: options.root,
            storyId,
            candidate,
          });
        } catch (error) {
          visualFingerprintFailures.push({
            id: cleanText(candidate.id),
            source_url: cleanText(candidate.source_url),
            reason: "visual_fingerprint_error",
            error: cleanText(error.message),
          });
          continue;
        }
        if (!fingerprint) {
          visualFingerprintFailures.push({
            id: cleanText(candidate.id),
            source_url: cleanText(candidate.source_url),
            reason: "visual_fingerprint_unavailable",
          });
          continue;
        }
        const duplicate = acceptedVisualFingerprints
          .map((accepted) => ({
            ...accepted,
            comparison: compareVideoFingerprints(accepted.fingerprint, fingerprint),
          }))
          .find((accepted) => accepted.comparison.near_duplicate);
        if (duplicate) {
          skippedVisualDuplicates.push({
            id: cleanText(candidate.id),
            source_family: cleanText(candidate.source_family),
            source_url: cleanText(candidate.source_url),
            matched_clip_id: duplicate.clip_id,
            comparison: duplicate.comparison,
          });
          continue;
        }
        acceptedClip.visual_content_fingerprint = fingerprint;
        acceptedVisualFingerprints.push({
          clip_id: cleanText(acceptedClip.id || candidate.id),
          fingerprint,
        });
      }
      materialized.push(acceptedClip);
      const resultIndex = materialized.length - 1;
      const resultFamily = directMotionReadinessFamily(acceptedClip, resultIndex);
      const resultBaseFamily = directMotionBaseSourceFamily(acceptedClip, resultIndex);
      const resultWindowKey = directMotionWindowKey(acceptedClip, resultIndex);
      if (resultFamily) seenFamilies.add(resultFamily);
      if (resultWindowKey) seenDirectWindows.add(resultWindowKey);
      if (isDirectVideoCandidate && resultBaseFamily) {
        directBaseSourceCounts.set(resultBaseFamily, (directBaseSourceCounts.get(resultBaseFamily) || 0) + 1);
      }
    } else {
      failed.push(result);
    }
  }
  const directBaseSourceClipCounts = [...directBaseSourceCounts.entries()]
    .map(([base_source_family, count]) => ({ base_source_family, count }))
    .sort((a, b) => b.count - a.count || a.base_source_family.localeCompare(b.base_source_family));

  const directVideoCount = directVideoMotionRows(materialized).length;
  const directVideoFamilyCount = directVideoMotionFamilyCount(materialized);
  const directVideoRequired = jobRequiresDirectVideoMotion(job);
  const directVideoFloorRequired = jobNeedsDirectVideoFloorRepair(job);
  const requiredDirectVideoCount = jobNeedsDirectVideoFloorRepair(job)
    ? jobDirectVideoFloor(job, minClips)
    : 1;
  const premiumRefreshRevalidationRequired =
    options.refreshExistingMotion === true &&
    typeof options.clipVisualEligibility === "function";
  const directVideoGapOnlyRepair =
    directVideoRequired &&
    directVideoCount >= requiredDirectVideoCount &&
    !premiumRefreshRevalidationRequired &&
    existingMotionEvidenceReady(job, footageInventory, { minClips, minFamilies });
  const recoveredSelectorRows = withoutExcludedMotionClips(
    await governedSelectorRecoveryRows(
      artifactDir,
      { root: options.root },
    ),
    options.excludedClipIds,
  );
  let governedExistingRows = mergeMotionRows(
    governedExistingDirectMotionRows(footageInventory),
    recoveredSelectorRows,
  );
  const existingReadinessRows = existingMotionClipRows(footageInventory)
    .filter((row) => row.counts_towards_motion_readiness === true);
  const preserveGovernedSupportMotionPack =
    options.refreshExistingMotion !== true &&
    existingReadinessRows.length > 0 &&
    existingReadinessRows.every(isGovernedOwnedSupportMotion);
  let revalidatedExistingMotionClipCount = 0;
  let rejectedExistingMotionClipCount = 0;
  if (premiumRefreshRevalidationRequired) {
    const eligibleExistingRows = [];
    for (const existingClip of governedExistingRows) {
      let visualQuality = null;
      try {
        visualQuality = await options.clipVisualEligibility(existingClip, {
          root: options.root,
          storyId,
          candidate: existingClip,
          existingMotionRevalidation: true,
        });
      } catch (error) {
        rejectedExistingMotionClipCount += 1;
        visualQualityFailures.push({
          id: cleanText(existingClip.id),
          source_family: cleanText(existingClip.source_family),
          source_url: cleanText(existingClip.source_url),
          reason: "premium_motion_visual_quality_scan_failed",
          error: cleanText(error.message),
          existing_motion_revalidation: true,
        });
        continue;
      }
      const visualQualityEligible =
        visualQuality === true ||
        (visualQuality && visualQuality.eligible === true);
      if (!visualQualityEligible) {
        rejectedExistingMotionClipCount += 1;
        skippedVisualQuality.push({
          id: cleanText(existingClip.id),
          source_family: cleanText(existingClip.source_family),
          base_source_family: directMotionBaseSourceFamily(
            existingClip,
            eligibleExistingRows.length,
          ),
          source_url: cleanText(existingClip.source_url),
          reasons: asArray(visualQuality?.reasons).map(cleanText).filter(Boolean),
          metrics:
            visualQuality?.metrics && typeof visualQuality.metrics === "object"
              ? structuredClone(visualQuality.metrics)
              : undefined,
          visual_repair:
            visualQuality?.visual_repair && typeof visualQuality.visual_repair === "object"
              ? structuredClone(visualQuality.visual_repair)
              : undefined,
          repairs: asArray(visualQuality?.repairs)
            .filter((repair) => repair && typeof repair === "object")
            .map((repair) => structuredClone(repair)),
          existing_motion_revalidation: true,
        });
        continue;
      }

      let eligibleExistingClip = existingClip;
      const replacementClip =
        visualQuality &&
        typeof visualQuality === "object" &&
        visualQuality.replacement_clip &&
        typeof visualQuality.replacement_clip === "object"
          ? visualQuality.replacement_clip
          : null;
      if (replacementClip) {
        const originalClipId = cleanText(existingClip.id);
        const replacementClipId = cleanText(replacementClip.id || originalClipId);
        const replacementPath = cleanText(
          replacementClip.local_materialized_path ||
            replacementClip.path ||
            replacementClip.local_path,
        );
        if (
          !replacementPath ||
          !(await fs.pathExists(path.resolve(replacementPath))) ||
          (originalClipId && replacementClipId !== originalClipId)
        ) {
          rejectedExistingMotionClipCount += 1;
          visualQualityFailures.push({
            id: originalClipId,
            source_family: cleanText(existingClip.source_family),
            source_url: cleanText(existingClip.source_url),
            reason: "premium_motion_visual_repair_invalid",
            error: !replacementPath
              ? "replacement_path_missing"
              : originalClipId && replacementClipId !== originalClipId
                ? "replacement_clip_identity_mismatch"
                : "replacement_path_unreadable",
            existing_motion_revalidation: true,
          });
          continue;
        }
        eligibleExistingClip = {
          ...existingClip,
          ...replacementClip,
          id: originalClipId,
          path: replacementPath,
          local_materialized_path: replacementPath,
          source_url: existingClip.source_url,
          source_family: existingClip.source_family,
          base_source_family: existingClip.base_source_family,
          source_master_sha256: existingClip.source_master_sha256,
          source_identity_provenance: existingClip.source_identity_provenance,
          validation_provenance: existingClip.validation_provenance,
          counts_towards_motion_readiness: true,
        };
        visualRepairs.push({
          id: originalClipId,
          status: cleanText(replacementClip.visual_repair?.status || "pass"),
          kind: cleanText(replacementClip.visual_repair?.kind),
          source_path: cleanText(
            replacementClip.visual_repair?.source_path || existingClip.path,
          ),
          output_path: replacementPath,
          existing_motion_revalidation: true,
        });
      }
      eligibleExistingRows.push(eligibleExistingClip);
      revalidatedExistingMotionClipCount += 1;
    }
    governedExistingRows = eligibleExistingRows;
  }
  const incrementalMergedRows = mergeMotionRows(
    existingRowsWithoutReplacementCollisions(governedExistingRows, materialized),
    materialized,
  );
  const materializedBaseSourceFamilies = genuineBaseSourceFamilies(materialized);
  const materializedRefreshWindowIds = new Set(
    materialized.map((clip) => cleanText(clip.id)).filter(Boolean),
  );
  const refreshWindowPlanFailedWindowIds = exactRefreshPlanRequested
    ? requestedRefreshWindows
        .map((window) => cleanText(window.id))
        .filter((id) => id && !materializedRefreshWindowIds.has(id))
    : [];
  const refreshWindowPlanIncomplete =
    exactRefreshPlanRequested &&
    refreshWindowPlanFailedWindowIds.length > 0;
  const currentSelectedPackComplete =
    materialized.length >= minClips &&
    seenFamilies.size >= minFamilies &&
    (
      requiredBaseSourceCount === 0 ||
      materializedBaseSourceFamilies.length >= requiredBaseSourceCount
    ) &&
    (!directVideoRequired || directVideoCount >= 1) &&
    (!directVideoFloorRequired || directVideoCount >= requiredDirectVideoCount);
  const refreshReplacesPriorSelectedPack =
    options.refreshExistingMotion === true &&
    currentSelectedPackComplete;
  const incrementalMotionCompletion =
    !exactRefreshPlanRequested &&
    !refreshReplacesPriorSelectedPack &&
    materialized.length > 0 &&
    governedExistingRows.length > 0 &&
    incrementalMergedRows.length >= minClips &&
    motionReadinessFamilies(incrementalMergedRows).length >= minFamilies &&
    (
      requiredBaseSourceCount === 0 ||
      genuineBaseSourceFamilies(incrementalMergedRows).length >= requiredBaseSourceCount
    ) &&
    (!directVideoRequired || directVideoMotionRows(incrementalMergedRows).length >= 1) &&
    (!directVideoFloorRequired ||
      directVideoMotionRows(incrementalMergedRows).length >= requiredDirectVideoCount);
  const premiumRefreshMergedCompletion =
    premiumRefreshRevalidationRequired && incrementalMotionCompletion;
  const materializedClipEvidenceFailures = failed.filter((result) =>
    asArray(result.blockers).map(cleanText).some((blocker) =>
      blocker.startsWith("materialized_clip_") || blocker === "validation_provenance_conflict",
    ),
  );
  if (
    materializedClipEvidenceFailures.length > 0 ||
    refreshWindowPlanIncomplete ||
    (
      !directVideoGapOnlyRepair &&
      !incrementalMotionCompletion &&
        (materialized.length < minClips ||
          seenFamilies.size < minFamilies ||
          (requiredBaseSourceCount > 0 &&
            materializedBaseSourceFamilies.length < requiredBaseSourceCount) ||
          (directVideoRequired && directVideoCount < 1) ||
        (directVideoFloorRequired && directVideoCount < requiredDirectVideoCount))
    )
  ) {
    const thresholdBlockers = [
      ...failed.flatMap((result) => asArray(result.blockers).map(cleanText)),
      ...materializedClipEvidenceFailures.flatMap((result) => asArray(result.blockers).map(cleanText)),
      ...(refreshWindowPlanIncomplete ? ["refresh_window_plan_incomplete"] : []),
      ...(materialized.length < minClips ? ["real_motion_clip_minimum_not_met"] : []),
      ...(seenFamilies.size < minFamilies ? ["real_motion_family_minimum_not_met"] : []),
      ...(requiredBaseSourceCount > 0 &&
      materializedBaseSourceFamilies.length < requiredBaseSourceCount
        ? ["genuine_base_source_minimum_not_met"]
        : []),
      ...(directVideoRequired && directVideoCount < 1 ? ["direct_video_motion_clip_missing"] : []),
      ...(directVideoFloorRequired && directVideoCount > 0 && directVideoCount < requiredDirectVideoCount
        ? ["direct_video_motion_clip_floor_not_met"]
        : []),
      ...(skippedVisualDuplicates.length ? ["visual_motion_duplicate_content_detected"] : []),
      ...(visualFingerprintFailures.length ? ["visual_motion_fingerprint_unavailable"] : []),
      ...(skippedVisualQuality.length ? ["premium_motion_visual_quality_insufficient"] : []),
      ...(visualQualityFailures.length ? ["premium_motion_visual_quality_scan_failed"] : []),
      ...(staleReadyArtifactDetected ? ["stale_ready_motion_manifest_unvalidated"] : []),
      ...(staleReadyCentralPackDetected ? ["stale_ready_central_motion_pack_unvalidated"] : []),
      ...(staleReadyOwnedMotionDetected ? ["stale_ready_owned_motion_manifest_unvalidated"] : []),
      ...(staleReadyFootageDetected ? ["stale_ready_footage_inventory_unvalidated"] : []),
    ];
    const uniqueThresholdBlockers = [...new Set(thresholdBlockers.filter(Boolean))];
    const thresholdEvidenceClips = premiumRefreshRevalidationRequired
      ? incrementalMergedRows
      : materialized;
    const partialEvidence = thresholdEvidenceClips.length
      ? await writePartialMotionEvidence({
        artifactDir,
        storyId,
        clips: thresholdEvidenceClips,
        blockers: uniqueThresholdBlockers,
        generatedAt: options.generatedAt,
        minClips,
        minFamilies,
        minBaseSources: requiredBaseSourceCount,
      })
      : null;
    const invalidatedEvidence = thresholdEvidenceClips.length > 0 ||
      rejectedExistingMotionClipCount > 0 ||
      staleReadyArtifactDetected ||
      staleReadyCentralPackDetected ||
      staleReadyOwnedMotionDetected ||
      staleReadyFootageDetected
      ? await invalidateArtifactMotionReadiness({
        root: options.root,
        artifactDir,
        storyId,
        clips: thresholdEvidenceClips,
        blockers: uniqueThresholdBlockers,
        generatedAt: options.generatedAt,
        minBaseSources: requiredBaseSourceCount,
      })
      : null;
    return {
      story_id: storyId,
      title,
      artifact_dir: artifactDir,
      status: "blocked",
      blockers: uniqueThresholdBlockers,
      candidate_count: candidates.length,
      recovered_selector_clip_count: recoveredSelectorRows.length,
      materialized_count: materialized.length,
      distinct_motion_family_count: seenFamilies.size,
      direct_video_motion_clip_count: directVideoCount,
      direct_video_motion_family_count: directVideoFamilyCount,
      direct_motion_base_source_clip_counts: directBaseSourceClipCounts,
      max_direct_motion_clips_per_base_source: maxDirectClipsPerBaseSource,
      skipped_duplicate_base_source_count: skippedDuplicateBaseSources.length,
      skipped_duplicate_base_sources: skippedDuplicateBaseSources.slice(0, 10),
      skipped_duplicate_direct_window_count: skippedDuplicateDirectWindows.length,
      skipped_duplicate_direct_windows: skippedDuplicateDirectWindows.slice(0, 10),
      skipped_visual_duplicate_count: skippedVisualDuplicates.length,
      skipped_visual_duplicates: skippedVisualDuplicates.slice(0, 10),
      visual_fingerprint_failure_count: visualFingerprintFailures.length,
      visual_fingerprint_failures: visualFingerprintFailures.slice(0, 10),
      skipped_visual_quality_count: skippedVisualQuality.length,
      skipped_visual_quality: skippedVisualQuality.slice(0, 10),
      visual_quality_failure_count: visualQualityFailures.length,
      visual_quality_failures: visualQualityFailures.slice(0, 10),
      visual_repair_count: visualRepairs.length,
      visual_repairs: visualRepairs.slice(0, 10),
      revalidated_existing_motion_clip_count: revalidatedExistingMotionClipCount,
      rejected_existing_motion_clip_count: rejectedExistingMotionClipCount,
      refresh_window_plan_atomic: exactRefreshPlanRequested,
      refresh_window_plan_requested_count: requestedRefreshWindows.length,
      refresh_window_plan_materialized_count:
        exactRefreshPlanRequested
          ? requestedRefreshWindows.length - refreshWindowPlanFailedWindowIds.length
          : 0,
      refresh_window_plan_failed_window_ids: refreshWindowPlanFailedWindowIds,
      partial_evidence_path: partialEvidence?.path || null,
      partial_evidence_clip_count: partialEvidence?.clip_count || 0,
      partial_direct_video_motion_family_count:
        partialEvidence?.direct_video_motion_family_count || 0,
      partial_evidence_counts_towards_final_render_readiness: false,
      stale_ready_evidence_invalidated: Boolean(invalidatedEvidence),
      invalidated_evidence: invalidatedEvidence,
      failed_count: failed.length,
      failed: failed.slice(0, 10),
    };
  }

  const updateSummary = await updateArtifactMotionEvidence({
    root: options.root,
    artifactDir,
    storyId,
    clips: premiumRefreshMergedCompletion ? incrementalMergedRows : materialized,
    rightsLedger,
    footageInventory,
    generatedAt: options.generatedAt,
    preserveExistingMotion:
      !premiumRefreshMergedCompletion &&
      !refreshReplacesPriorSelectedPack &&
      (
        directVideoGapOnlyRepair ||
        incrementalMotionCompletion ||
        preserveGovernedSupportMotionPack
      ),
    recoveredExistingRows: premiumRefreshMergedCompletion ? [] : recoveredSelectorRows,
    materializedClipProbe: options.materializedClipProbe,
    materializedClipDecode: options.materializedClipDecode,
    clipVisualFingerprint,
    requiredBaseSourceCount,
    requireProfessionalSourceIdentity: requiresProfessionalSourceIdentity(job, options),
    excludedClipIds: options.excludedClipIds,
    maximumClipCount,
  });

  if (updateSummary.status === "blocked") {
    return {
      story_id: storyId,
      title,
      artifact_dir: artifactDir,
      status: "blocked",
      blockers: updateSummary.blockers,
      candidate_count: candidates.length,
      recovered_selector_clip_count: recoveredSelectorRows.length,
      materialized_count: materialized.length,
      failed_count: updateSummary.evidence_failures.length,
      failed: updateSummary.evidence_failures,
      professional_source_diversity: updateSummary.professional_source_diversity,
      skipped_visual_quality_count: skippedVisualQuality.length,
      skipped_visual_quality: skippedVisualQuality.slice(0, 10),
      visual_quality_failure_count: visualQualityFailures.length,
      visual_quality_failures: visualQualityFailures.slice(0, 10),
      visual_repair_count: visualRepairs.length,
      visual_repairs: visualRepairs.slice(0, 10),
      revalidated_existing_motion_clip_count: revalidatedExistingMotionClipCount,
      rejected_existing_motion_clip_count: rejectedExistingMotionClipCount,
      stale_ready_evidence_invalidated: true,
      invalidated_evidence: updateSummary,
    };
  }

  return {
    story_id: storyId,
    title,
    artifact_dir: artifactDir,
    status: "materialized",
    repair_scope: refreshReplacesPriorSelectedPack
      ? "refreshed_same_run_selected_pack"
      : directVideoGapOnlyRepair
        ? "direct_video_gap_only"
        : incrementalMotionCompletion
          ? "incremental_motion_completion"
          : preserveGovernedSupportMotionPack
            ? "mixed_motion_completion"
          : "full_real_motion_readiness",
    blockers: [],
    publish_hold: updateSummary.publish_hold,
    rights_transition_status: updateSummary.rights_transition_status,
    candidate_count: candidates.length,
    recovered_selector_clip_count: recoveredSelectorRows.length,
    materialized_count: materialized.length,
    distinct_motion_family_count: seenFamilies.size,
    direct_video_motion_clip_count: directVideoCount,
    direct_video_motion_family_count: directVideoFamilyCount,
    direct_motion_base_source_clip_counts: directBaseSourceClipCounts,
    max_direct_motion_clips_per_base_source: maxDirectClipsPerBaseSource,
    skipped_duplicate_base_source_count: skippedDuplicateBaseSources.length,
    skipped_duplicate_base_sources: skippedDuplicateBaseSources.slice(0, 10),
    skipped_duplicate_direct_window_count: skippedDuplicateDirectWindows.length,
    skipped_duplicate_direct_windows: skippedDuplicateDirectWindows.slice(0, 10),
    skipped_visual_duplicate_count: skippedVisualDuplicates.length,
    skipped_visual_duplicates: skippedVisualDuplicates.slice(0, 10),
    visual_fingerprint_failure_count: visualFingerprintFailures.length,
    visual_fingerprint_failures: visualFingerprintFailures.slice(0, 10),
    skipped_visual_quality_count: skippedVisualQuality.length,
    skipped_visual_quality: skippedVisualQuality.slice(0, 10),
    visual_quality_failure_count: visualQualityFailures.length,
    visual_quality_failures: visualQualityFailures.slice(0, 10),
    visual_repair_count: visualRepairs.length,
    visual_repairs: visualRepairs.slice(0, 10),
    revalidated_existing_motion_clip_count: revalidatedExistingMotionClipCount,
    rejected_existing_motion_clip_count: rejectedExistingMotionClipCount,
    total_motion_clip_count: updateSummary.clip_count,
    total_distinct_motion_family_count: updateSummary.distinct_motion_family_count,
    total_direct_video_motion_asset_count: updateSummary.direct_video_motion_asset_count,
    total_direct_video_motion_family_count: updateSummary.direct_video_motion_family_count,
    professional_source_diversity: updateSummary.professional_source_diversity,
    central_motion_pack_path: updateSummary.motion_pack_path,
    failed_count: failed.length,
    clips: (updateSummary.selected_clips || materialized).map((clip) => ({
      id: clip.id,
      path: clip.path,
      source_family: clip.source_family,
      source_url: clip.source_url,
      media_kind: cleanText(clip.media_kind || "direct_video"),
      visual_repair: clip.visual_repair || null,
    })),
  };
}

async function materializeGoalRealMotion({
  root = process.cwd(),
  workOrder = {},
  generatedAt = new Date().toISOString(),
  limit = 0,
  storyIds = [],
  includeReadyStories = false,
  minClips = DEFAULT_MIN_CLIPS,
  minFamilies = DEFAULT_MIN_FAMILIES,
  minBaseSources = 0,
  strictBaseSourceDiversity = false,
  maxClips = 8,
  maxDirectClipsPerBaseSource = null,
  segmentValidationReport = {},
  artifactRoot = "",
  execFileSync,
  ffprobeDuration,
  materializedClipProbe,
  materializedClipDecode,
  clipVisualFingerprint,
  clipVisualEligibility,
  refreshWindowPlan = {},
  excludedClipIds = [],
} = {}) {
  const requestedStoryIds = new Set(normaliseStoryIds(storyIds));
  const resolvedRoot = path.resolve(root);
  const workOrderJobs = asArray(workOrder.jobs)
    .filter((job) => {
      if (isRealMotionJob(job)) return true;
      if (!includeReadyStories || !requestedStoryIds.size) return false;
      return requestedStoryIds.has(cleanText(job.story_id)) && Boolean(cleanText(job.artifact_dir));
    })
    .filter((job) => !requestedStoryIds.size || requestedStoryIds.has(cleanText(job.story_id)));
  const existingStoryIds = new Set(workOrderJobs.map((job) => cleanText(job.story_id)).filter(Boolean));
  const jobs = [
    ...workOrderJobs,
    ...syntheticSegmentValidationJobs({
      root: resolvedRoot,
      artifactRoot,
      segmentValidationReport,
      requestedStoryIds,
      existingStoryIds,
    }),
  ];
  const selected = Number(limit) > 0 ? jobs.slice(0, Number(limit)) : jobs;
  const results = [];
  for (const job of selected) {
    try {
      results.push(await materializeRealMotionJob(job, {
        root: resolvedRoot,
        generatedAt,
        minClips,
        minFamilies,
        minBaseSources,
        strictBaseSourceDiversity,
        maxClips,
        maxDirectClipsPerBaseSource,
        segmentValidationReport,
        refreshExistingMotion: includeReadyStories,
        execFileSync,
        ffprobeDuration,
        materializedClipProbe,
        materializedClipDecode,
        clipVisualFingerprint,
        clipVisualEligibility,
        refreshWindowPlan,
        excludedClipIds,
      }));
    } catch (error) {
      results.push({
        story_id: cleanText(job.story_id),
        artifact_dir: job.artifact_dir || null,
        status: "failed",
        error: error.message,
      });
    }
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "REAL_MOTION_MATERIALIZATION",
    summary: {
      candidate_count: selected.length,
      materialized_story_count: results.filter((item) => item.status === "materialized").length,
      blocked_story_count: results.filter((item) => item.status === "blocked").length,
      failed_story_count: results.filter((item) => item.status === "failed").length,
      materialized_clip_count: results
        .filter((item) => item.status === "materialized")
        .reduce((sum, item) => sum + Number(item.materialized_count || 0), 0),
      attempted_materialized_clip_count: results.reduce(
        (sum, item) => sum + Number(item.materialized_count || 0),
        0,
      ),
      screenshot_derived_motion_clip_count: results.reduce(
        (sum, item) =>
          item.status === "materialized"
            ? sum + asArray(item.clips).filter((clip) => clip.media_kind === "visual_still").length
            : sum,
        0,
      ),
    },
    jobs: results,
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
      trusted_real_visual_media_only: true,
      direct_video_or_screenshot_derived_only: true,
      direct_media_only: results.every((item) =>
        asArray(item.clips).every((clip) => cleanText(clip.media_kind || "direct_video") === "direct_video"),
      ),
    },
  };
}

function renderGoalRealMotionMarkdown(report = {}) {
  const lines = [];
  lines.push("# Real Motion Materialization");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Candidates: ${report.summary?.candidate_count || 0}`);
  lines.push(`Materialized stories: ${report.summary?.materialized_story_count || 0}`);
  lines.push(`Blocked stories: ${report.summary?.blocked_story_count || 0}`);
  lines.push(`Failed stories: ${report.summary?.failed_story_count || 0}`);
  lines.push(`Materialized clips: ${report.summary?.materialized_clip_count || 0}`);
  lines.push(`Screenshot-derived clips: ${report.summary?.screenshot_derived_motion_clip_count || 0}`);
  lines.push("");
  lines.push("## Jobs");
  for (const job of asArray(report.jobs).slice(0, 40)) {
    const detail = job.blockers?.length ? `; blockers: ${job.blockers.join(", ")}` : "";
    lines.push(`- ${job.story_id}: ${job.status}; clips=${job.materialized_count || 0}; families=${job.distinct_motion_family_count || 0}${detail}`);
  }
  if (!asArray(report.jobs).length) lines.push("- none");
  lines.push("");
  lines.push("Safety: local trusted visual materialisation only. No publishing, DB mutation, OAuth or token change.");
  return `${lines.join("\n")}\n`;
}

async function writeGoalRealMotionReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalRealMotionReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "real_motion_materialization_report.json");
  const markdownPath = path.join(outDir, "real_motion_materialization_report.md");
  const realMotionSourceAcquisitionWorkOrderPath = path.join(outDir, "real_motion_source_acquisition_work_order.json");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalRealMotionMarkdown(report), "utf8");
  await fs.writeJson(
    realMotionSourceAcquisitionWorkOrderPath,
    buildRealMotionSourceAcquisitionWorkOrder(report),
    { spaces: 2 },
  );
  return { outputDir: outDir, jsonPath, markdownPath, realMotionSourceAcquisitionWorkOrderPath };
}

module.exports = {
  candidateRows,
  loadMotionPackForStory,
  materializeGoalRealMotion,
  buildRealMotionSourceAcquisitionWorkOrder,
  renderGoalRealMotionMarkdown,
  writeGoalRealMotionReport,
  _private: {
    compoundMotionSourceIdentity,
    expandDirectVideoWindowCandidates,
    dynamicMaxDirectClipsPerBaseSource,
    governedStaleInventoryRecoveryRows,
    isExpandableDirectVideoCandidate,
    jobDirectVideoFloor,
    jobNeedsDirectVideoFloorRepair,
    jobRequiresDirectVideoMotion,
    materializedSourceIdentityFields,
    sameRightsSourceIdentity,
    explicitSourcePolicyGrant,
    reconcileMaterializedRightsRecords,
  },
};

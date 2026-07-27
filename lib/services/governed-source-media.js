"use strict";

const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const MANIFEST_SCHEMA = "pulse-governed-source-media-manifest-v1";
const RIGHTS_REVIEW_SCHEMA =
  "pulse-governed-rights-review-evidence-v1";
const RIGHTS_BASIS = "LICENSED";
const PUBLISHER = "Square Enix";
const REVIEW_STATUS = "ACCEPTED";
const ATTRIBUTION_TEXT = "© SQUARE ENIX";
const EDITORIAL_PURPOSE = "TRANSFORMATIVE_EDITORIAL";
const CANONICAL_LICENCE_URL =
  "https://support.eu.square-enix.com/rule.php?id=5383&la=2&tag=authc";
const LICENCE_EFFECTIVE_DATE = "2026-05-07";
const PERMITTED_DESTINATION =
  "YouTube and comparable social-network partner programmes";
const COVERED_MATERIALS = [
  "art",
  "images",
  "screenshots",
  "video",
];
const OFFICIAL_FFXIV_PAGE_HOSTS = new Set([
  "de.finalfantasyxiv.com",
  "eu.finalfantasyxiv.com",
  "fr.finalfantasyxiv.com",
  "jp.finalfantasyxiv.com",
  "na.finalfantasyxiv.com",
]);
const OFFICIAL_FFXIV_MEDIA_HOSTS = new Set([
  "i.ytimg.com",
  "lds-img.finalfantasyxiv.com",
]);
const REVIEWED_FFXIV_YOUTUBE_THUMBNAIL =
  "https://i.ytimg.com/vi/uaZlrprwSq4/maxresdefault.jpg";
const MAX_IMAGE_DIMENSION = 8_192;
const MAX_IMAGE_PIXELS = 40_000_000;
// Evidence producers and validators may disagree by at most one minute due
// to normal host clock drift. Anything later is not contemporaneous proof.
const SOURCE_MEDIA_TIMESTAMP_SKEW_MS = 60_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

class GovernedSourceMediaError extends Error {
  constructor(
    codes,
    message = "governed_source_media_validation_failed",
  ) {
    const normalised = unique(Array.isArray(codes) ? codes : [codes]);
    super(`${message}: ${normalised.join(", ")}`);
    this.name = "GovernedSourceMediaError";
    this.codes = normalised;
  }
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function text(value) {
  return String(value ?? "").trim();
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hasExactTextSet(value, expected, normalise = (item) => item) {
  if (!Array.isArray(value)) return false;
  const observed = unique(
    value.map((item) => normalise(text(item))).filter(Boolean),
  ).sort();
  const required = [...expected].map(normalise).sort();
  return (
    observed.length === required.length &&
    observed.every((item, index) => item === required[index])
  );
}

function readRegularFile(filePath, prefix) {
  const resolvedPath = path.resolve(text(filePath));
  let stat;
  try {
    stat = fs.lstatSync(resolvedPath);
  } catch {
    throw new GovernedSourceMediaError(`${prefix}_file_not_found`);
  }
  if (
    !resolvedPath ||
    stat.isSymbolicLink() ||
    !stat.isFile()
  ) {
    throw new GovernedSourceMediaError(`${prefix}_file_invalid`);
  }
  const bytes = fs.readFileSync(resolvedPath);
  if (bytes.length === 0) {
    throw new GovernedSourceMediaError(`${prefix}_file_empty`);
  }
  return {
    path: resolvedPath,
    bytes,
    sha256: sha256Buffer(bytes),
    size_bytes: bytes.length,
  };
}

function readJsonFile(filePath, prefix) {
  const file = readRegularFile(filePath, prefix);
  try {
    return {
      ...file,
      value: JSON.parse(file.bytes.toString("utf8")),
    };
  } catch {
    throw new GovernedSourceMediaError(`${prefix}_json_invalid`);
  }
}

function probePng(bytes) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, signature.length).equals(signature) ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    return null;
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1) return null;
  return { mime_type: "image/png", width, height };
}

function probeJpeg(bytes) {
  if (
    bytes.length < 12 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8
  ) {
    return null;
  }
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0x01) continue;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 1 >= bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (
      segmentLength < 2 ||
      offset + segmentLength > bytes.length
    ) {
      break;
    }
    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (width < 1 || height < 1) return null;
      return { mime_type: "image/jpeg", width, height };
    }
    offset += segmentLength;
  }
  return null;
}

function probeImageDecode(filePath) {
  const sharpModulePath = require.resolve("sharp");
  const script = [
    '"use strict";',
    "const sharp = require(process.argv[1]);",
    "(async () => {",
    "  const filePath = process.argv[2];",
    "  const options = {",
    '    failOn: "warning",',
    `    limitInputPixels: ${MAX_IMAGE_PIXELS},`,
    "    sequentialRead: true,",
    "  };",
    "  const metadata = await sharp(filePath, options).metadata();",
    "  const decoded = await sharp(filePath, options)",
    "    .raw()",
    "    .toBuffer({ resolveWithObject: true });",
    "  process.stdout.write(JSON.stringify({",
    "    format: metadata.format,",
    "    width: decoded.info.width,",
    "    height: decoded.info.height,",
    "  }));",
    "})().catch(() => { process.exitCode = 1; });",
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    ["-e", script, sharpModulePath, filePath],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 15_000,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function probeImageMedia(bytes, filePath) {
  const signatureProbe = probePng(bytes) || probeJpeg(bytes);
  if (!signatureProbe) return null;
  const decoded = probeImageDecode(filePath);
  const mimeTypeByFormat = {
    jpeg: "image/jpeg",
    png: "image/png",
  };
  const decodedMimeType = mimeTypeByFormat[text(decoded?.format).toLowerCase()];
  const width = Number(decoded?.width);
  const height = Number(decoded?.height);
  if (
    !decodedMimeType ||
    decodedMimeType !== signatureProbe.mime_type ||
    !Number.isInteger(width) ||
    width < 1 ||
    width > MAX_IMAGE_DIMENSION ||
    !Number.isInteger(height) ||
    height < 1 ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS ||
    width !== signatureProbe.width ||
    height !== signatureProbe.height
  ) {
    return null;
  }
  return {
    mime_type: decodedMimeType,
    width,
    height,
    fully_decoded: true,
  };
}

function mimeTypeForVideoFormat(formatName) {
  const formats = new Set(
    text(formatName)
      .toLowerCase()
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (formats.has("mp4") || formats.has("mov")) return "video/mp4";
  if (formats.has("webm")) return "video/webm";
  if (formats.has("matroska")) return "video/x-matroska";
  if (formats.has("avi")) return "video/x-msvideo";
  if (formats.has("mpegts")) return "video/mp2t";
  return "";
}

function probeVideoMedia(filePath, prefix) {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ],
    {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 15_000,
      windowsHide: true,
    },
  );
  if (result.error?.code === "ENOENT") {
    throw new GovernedSourceMediaError(
      `${prefix}_asset_probe_unavailable`,
    );
  }
  if (result.error || result.status !== 0) return null;
  let probe;
  try {
    probe = JSON.parse(result.stdout);
  } catch {
    return null;
  }
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const videoStreams = streams.filter(
    (stream) => text(stream?.codec_type).toLowerCase() === "video",
  );
  const audioStreams = streams.filter(
    (stream) => text(stream?.codec_type).toLowerCase() === "audio",
  );
  if (videoStreams.length !== 1) return null;
  const videoStream = videoStreams[0];
  const width = Number(videoStream?.width);
  const height = Number(videoStream?.height);
  const duration = Number(
    probe?.format?.duration ?? videoStream?.duration,
  );
  const mimeType = mimeTypeForVideoFormat(probe?.format?.format_name);
  if (
    !Number.isInteger(width) ||
    width < 1 ||
    !Number.isInteger(height) ||
    height < 1 ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !mimeType
  ) {
    return null;
  }
  return {
    mime_type: mimeType,
    width,
    height,
    duration_seconds: duration,
    has_audio: audioStreams.length > 0,
    video_stream_count: videoStreams.length,
    audio_stream_count: audioStreams.length,
  };
}

function validateDeclaredMediaMetadata(component, probe, prefix) {
  if (!probe) {
    throw new GovernedSourceMediaError(
      `${prefix}_asset_media_invalid`,
    );
  }
  const declaredWidth = component?.asset?.width;
  const declaredHeight = component?.asset?.height;
  if (
    !Number.isInteger(declaredWidth) ||
    declaredWidth < 1 ||
    !Number.isInteger(declaredHeight) ||
    declaredHeight < 1
  ) {
    throw new GovernedSourceMediaError(
      `${prefix}_asset_dimensions_required`,
    );
  }
  if (
    declaredWidth !== probe.width ||
    declaredHeight !== probe.height
  ) {
    throw new GovernedSourceMediaError(
      `${prefix}_asset_dimensions_mismatch`,
    );
  }
  const declaredMimeType = text(component?.asset?.mime_type).toLowerCase();
  if (declaredMimeType && declaredMimeType !== probe.mime_type) {
    throw new GovernedSourceMediaError(
      `${prefix}_asset_mime_type_mismatch`,
    );
  }
  return probe;
}

function resolveDeclaredPath(manifestDir, declaredPath, prefix) {
  const declared = text(declaredPath);
  if (!declared) {
    throw new GovernedSourceMediaError(`${prefix}_path_required`);
  }
  if (declared.includes("\0") || path.isAbsolute(declared)) {
    throw new GovernedSourceMediaError(`${prefix}_path_escape`);
  }
  const resolvedManifestDir = path.resolve(manifestDir);
  const resolved = path.resolve(resolvedManifestDir, declared);
  const relative = path.relative(resolvedManifestDir, resolved);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new GovernedSourceMediaError(`${prefix}_path_escape`);
  }
  if (fs.existsSync(resolved)) {
    const canonicalRoot = fs.realpathSync.native(resolvedManifestDir);
    const canonicalTarget = fs.realpathSync.native(resolved);
    const canonicalRelative = path.relative(
      canonicalRoot,
      canonicalTarget,
    );
    if (
      !canonicalRelative ||
      canonicalRelative.startsWith(`..${path.sep}`) ||
      canonicalRelative === ".." ||
      path.isAbsolute(canonicalRelative)
    ) {
      throw new GovernedSourceMediaError(`${prefix}_path_escape`);
    }
  }
  return resolved;
}

function assertExpectedHash(observed, expected, code) {
  const normalised = text(expected).replace(/^sha256:/i, "").toLowerCase();
  if (!SHA256_PATTERN.test(normalised)) {
    throw new GovernedSourceMediaError(code.replace("_mismatch", "_invalid"));
  }
  if (normalised !== observed) {
    throw new GovernedSourceMediaError(code);
  }
  return normalised;
}

function resolveCompositionDuration(
  declaredDuration,
  suppliedDuration,
) {
  const declaredPresent = declaredDuration !== undefined;
  const suppliedPresent = suppliedDuration !== undefined;
  if (
    declaredPresent &&
    (!Number.isFinite(declaredDuration) || declaredDuration <= 0)
  ) {
    throw new GovernedSourceMediaError(
      "source_media_composition_duration_invalid",
    );
  }
  if (
    suppliedPresent &&
    (!Number.isFinite(suppliedDuration) || suppliedDuration <= 0)
  ) {
    throw new GovernedSourceMediaError(
      "source_media_expected_composition_duration_invalid",
    );
  }
  if (
    declaredPresent &&
    suppliedPresent &&
    declaredDuration !== suppliedDuration
  ) {
    throw new GovernedSourceMediaError(
      "source_media_composition_duration_mismatch",
    );
  }
  return declaredPresent
    ? declaredDuration
    : suppliedPresent
      ? suppliedDuration
      : null;
}

function parseCleanHttpsUrl(value) {
  try {
    const parsed = new URL(text(value));
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.port
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isOfficialFfxivPageUrl(value) {
  const parsed = parseCleanHttpsUrl(value);
  return Boolean(
    parsed &&
      OFFICIAL_FFXIV_PAGE_HOSTS.has(parsed.hostname.toLowerCase()),
  );
}

function isOfficialFfxivMediaUrl(value) {
  const parsed = parseCleanHttpsUrl(value);
  if (
    !parsed ||
    !OFFICIAL_FFXIV_MEDIA_HOSTS.has(
      parsed.hostname.toLowerCase(),
    )
  ) {
    return false;
  }
  if (parsed.hostname.toLowerCase() === "i.ytimg.com") {
    return parsed.href === REVIEWED_FFXIV_YOUTUBE_THUMBNAIL;
  }
  return true;
}

function isCanonicalSquareEnixLicenceUrl(value) {
  return text(value) === CANONICAL_LICENCE_URL;
}

function validateGovernedSourceMediaManifest({
  manifestPath,
  expectedManifestSha256,
  expectedStoryId,
  compositionDurationSeconds,
  validationBoundaryAt,
} = {}) {
  const validationBoundaryText = text(validationBoundaryAt);
  if (!validationBoundaryText) {
    throw new GovernedSourceMediaError(
      "source_media_validation_boundary_required",
    );
  }
  if (!Number.isFinite(Date.parse(validationBoundaryText))) {
    throw new GovernedSourceMediaError(
      "source_media_validation_boundary_invalid",
    );
  }
  const validationBoundaryMs = Date.parse(validationBoundaryText);
  const validationNowMs = Date.now();
  if (!Number.isFinite(validationNowMs)) {
    throw new GovernedSourceMediaError(
      "source_media_validation_clock_invalid",
    );
  }
  if (
    validationBoundaryMs >
    validationNowMs + SOURCE_MEDIA_TIMESTAMP_SKEW_MS
  ) {
    throw new GovernedSourceMediaError(
      "source_media_validation_boundary_in_future",
    );
  }
  const latestEvidenceTimestampMs =
    Math.min(validationBoundaryMs, validationNowMs) +
    SOURCE_MEDIA_TIMESTAMP_SKEW_MS;
  const manifestFile = readJsonFile(
    manifestPath,
    "source_media_manifest",
  );
  assertExpectedHash(
    manifestFile.sha256,
    expectedManifestSha256,
    "source_media_manifest_sha256_mismatch",
  );

  const manifest = manifestFile.value;
  if (manifest?.schema_version !== MANIFEST_SCHEMA) {
    throw new GovernedSourceMediaError(
      "source_media_manifest_schema_invalid",
    );
  }
  const manifestGeneratedAtMs = Date.parse(
    text(manifest?.generated_at),
  );
  if (!Number.isFinite(manifestGeneratedAtMs)) {
    throw new GovernedSourceMediaError(
      "source_media_manifest_generated_at_invalid",
    );
  }
  if (
    manifestGeneratedAtMs >
    latestEvidenceTimestampMs
  ) {
    throw new GovernedSourceMediaError(
      "source_media_manifest_generated_at_in_future",
    );
  }
  const storyId = text(expectedStoryId);
  if (!storyId) {
    throw new GovernedSourceMediaError(
      "source_media_expected_story_id_required",
    );
  }
  if (text(manifest?.story_id) !== storyId) {
    throw new GovernedSourceMediaError(
      "source_media_story_id_mismatch",
    );
  }
  const compositionDuration = resolveCompositionDuration(
    manifest?.composition_duration_seconds,
    compositionDurationSeconds,
  );
  const manifestDir = path.dirname(manifestFile.path);
  const evidenceFile = readJsonFile(
    resolveDeclaredPath(
      manifestDir,
      manifest?.rights_review?.path,
      "source_media_rights_review",
    ),
    "source_media_rights_review",
  );
  assertExpectedHash(
    evidenceFile.sha256,
    manifest?.rights_review?.sha256,
    "source_media_rights_review_sha256_mismatch",
  );
  if (text(evidenceFile.value?.story_id) !== storyId) {
    throw new GovernedSourceMediaError(
      "source_media_rights_review_story_id_mismatch",
    );
  }
  const rightsReview = evidenceFile.value;
  if (rightsReview?.schema_version !== RIGHTS_REVIEW_SCHEMA) {
    throw new GovernedSourceMediaError(
      "source_media_rights_review_schema_invalid",
    );
  }
  if (
    text(manifest?.rights_review?.review_status) !== REVIEW_STATUS ||
    text(rightsReview?.review_status) !== REVIEW_STATUS
  ) {
    throw new GovernedSourceMediaError(
      "source_media_rights_review_status_invalid",
    );
  }
  if (text(rightsReview?.rights_basis) !== RIGHTS_BASIS) {
    throw new GovernedSourceMediaError(
      "source_media_rights_review_basis_invalid",
    );
  }
  if (text(rightsReview?.publisher) !== PUBLISHER) {
    throw new GovernedSourceMediaError(
      "source_media_rights_review_publisher_invalid",
    );
  }
  if (
    !isCanonicalSquareEnixLicenceUrl(
      rightsReview?.licence_evidence_url,
    )
  ) {
    throw new GovernedSourceMediaError(
      "source_media_rights_review_licence_evidence_url_invalid",
    );
  }
  const rightsReviewedAtMs = Date.parse(
    text(rightsReview?.reviewed_at),
  );
  if (
    !text(rightsReview?.reviewed_by) ||
    !Number.isFinite(rightsReviewedAtMs) ||
    !text(rightsReview?.scope)
  ) {
    throw new GovernedSourceMediaError(
      "source_media_rights_review_evidence_incomplete",
    );
  }
  if (
    rightsReviewedAtMs >
    latestEvidenceTimestampMs
  ) {
    throw new GovernedSourceMediaError(
      "source_media_rights_review_reviewed_at_in_future",
    );
  }
  if (
    text(rightsReview?.licence_effective_date) !==
    LICENCE_EFFECTIVE_DATE
  ) {
    throw new GovernedSourceMediaError(
      "source_media_rights_review_licence_effective_date_invalid",
    );
  }
  const findings = rightsReview?.findings;
  if (
    !hasExactTextSet(
      findings?.covered_materials,
      COVERED_MATERIALS,
      (item) => item.toLowerCase(),
    )
  ) {
    throw new GovernedSourceMediaError(
      "source_media_rights_review_covered_materials_invalid",
    );
  }
  if (
    text(findings?.permitted_destination) !==
    PERMITTED_DESTINATION
  ) {
    throw new GovernedSourceMediaError(
      "source_media_rights_review_permitted_destination_invalid",
    );
  }
  if (text(findings?.copyright_notice) !== ATTRIBUTION_TEXT) {
    throw new GovernedSourceMediaError(
      "source_media_rights_review_copyright_notice_invalid",
    );
  }
  if (
    !hasExactTextSet(
      findings?.copyright_notice_delivery,
      ["DESCRIPTION", "ON_SCREEN"],
      (item) => item.toUpperCase(),
    )
  ) {
    throw new GovernedSourceMediaError(
      "source_media_rights_review_copyright_notice_delivery_invalid",
    );
  }
  if (findings?.third_party_music_used !== false) {
    throw new GovernedSourceMediaError(
      "source_media_rights_review_third_party_music_invalid",
    );
  }
  if (findings?.source_audio_used !== false) {
    throw new GovernedSourceMediaError(
      "source_media_rights_review_source_audio_invalid",
    );
  }
  if (findings?.raw_asset_redistribution !== false) {
    throw new GovernedSourceMediaError(
      "source_media_rights_review_raw_asset_redistribution_invalid",
    );
  }
  if (findings?.removal_request_must_be_honoured !== true) {
    throw new GovernedSourceMediaError(
      "source_media_rights_review_removal_request_invalid",
    );
  }

  if (
    !Array.isArray(manifest?.components) ||
    manifest.components.length === 0
  ) {
    throw new GovernedSourceMediaError(
      "source_media_components_required",
    );
  }
  const componentIds = new Set();
  const components = manifest.components.map((component, index) => {
    const prefix = `source_media_component_${index}`;
    const componentId = text(component?.component_id);
    if (!/^[a-z0-9][a-z0-9._-]{2,127}$/i.test(componentId)) {
      throw new GovernedSourceMediaError(
        `${prefix}_component_id_invalid`,
      );
    }
    if (componentIds.has(componentId)) {
      throw new GovernedSourceMediaError(
        "source_media_component_id_duplicate",
      );
    }
    componentIds.add(componentId);
    const mediaType = text(component?.media_type).toUpperCase();
    if (!["IMAGE", "VIDEO"].includes(mediaType)) {
      throw new GovernedSourceMediaError(
        `${prefix}_media_type_invalid`,
      );
    }
    if (!isOfficialFfxivPageUrl(component?.source?.page_url)) {
      throw new GovernedSourceMediaError(
        `${prefix}_source_page_url_invalid`,
      );
    }
    if (!isOfficialFfxivMediaUrl(component?.source?.direct_media_url)) {
      throw new GovernedSourceMediaError(
        `${prefix}_direct_media_url_invalid`,
      );
    }
    if (text(component?.source?.publisher) !== PUBLISHER) {
      throw new GovernedSourceMediaError(
        `${prefix}_publisher_invalid`,
      );
    }
    if (text(component?.rights_basis) !== RIGHTS_BASIS) {
      throw new GovernedSourceMediaError(
        `${prefix}_rights_basis_invalid`,
      );
    }
    if (
      !isCanonicalSquareEnixLicenceUrl(
        component?.licence_evidence_url,
      ) ||
      text(component?.licence_evidence_url) !==
        text(rightsReview.licence_evidence_url)
    ) {
      throw new GovernedSourceMediaError(
        `${prefix}_licence_evidence_url_invalid`,
      );
    }
    if (text(component?.review_status) !== REVIEW_STATUS) {
      throw new GovernedSourceMediaError(
        `${prefix}_review_status_invalid`,
      );
    }
    if (component?.attribution?.required !== true) {
      throw new GovernedSourceMediaError(
        `${prefix}_attribution_required`,
      );
    }
    if (text(component?.attribution?.text) !== ATTRIBUTION_TEXT) {
      throw new GovernedSourceMediaError(
        `${prefix}_attribution_invalid`,
      );
    }
    const attributionDelivery = Array.isArray(
      component?.attribution?.delivery,
    )
      ? unique(
          component.attribution.delivery.map((value) =>
            text(value).toUpperCase(),
          ),
        ).sort()
      : [];
    if (
      attributionDelivery.length !== 2 ||
      !attributionDelivery.includes("DESCRIPTION") ||
      !attributionDelivery.includes("ON_SCREEN")
    ) {
      throw new GovernedSourceMediaError(
        `${prefix}_attribution_delivery_invalid`,
      );
    }
    if (text(component?.editorial?.purpose) !== EDITORIAL_PURPOSE) {
      throw new GovernedSourceMediaError(
        `${prefix}_editorial_purpose_invalid`,
      );
    }
    if (component?.editorial?.third_party_music_used !== false) {
      throw new GovernedSourceMediaError(
        `${prefix}_third_party_music`,
      );
    }
    const usageSeconds = component?.editorial?.usage_seconds;
    if (
      !Array.isArray(usageSeconds) ||
      usageSeconds.length !== 2 ||
      !usageSeconds.every((value) => Number.isFinite(value))
    ) {
      throw new GovernedSourceMediaError(
        `${prefix}_usage_seconds_invalid`,
      );
    }
    const [usageStart, usageEnd] = usageSeconds;
    if (usageStart < 0 || usageEnd <= usageStart) {
      throw new GovernedSourceMediaError(
        `${prefix}_usage_seconds_order_invalid`,
      );
    }
    if (
      compositionDuration !== null &&
      usageEnd > compositionDuration
    ) {
      throw new GovernedSourceMediaError(
        `${prefix}_usage_seconds_out_of_bounds`,
      );
    }
    const sourceAudioDisposition = text(
      component?.editorial?.source_audio_disposition,
    ).toUpperCase();
    if (
      mediaType === "VIDEO" &&
      !["MUTED", "REMOVED"].includes(sourceAudioDisposition)
    ) {
      throw new GovernedSourceMediaError(
        `${prefix}_source_audio_not_removed`,
      );
    }
    if (
      mediaType === "IMAGE" &&
      sourceAudioDisposition !== "NOT_APPLICABLE"
    ) {
      throw new GovernedSourceMediaError(
        `${prefix}_source_audio_disposition_invalid`,
      );
    }
    const assetFile = readRegularFile(
      resolveDeclaredPath(
        manifestDir,
        component?.asset?.path,
        `${prefix}_asset`,
      ),
      `${prefix}_asset`,
    );
    assertExpectedHash(
      assetFile.sha256,
      component?.asset?.sha256,
      `${prefix}_asset_sha256_mismatch`,
    );
    const mediaProbe = validateDeclaredMediaMetadata(
      component,
      mediaType === "IMAGE"
        ? probeImageMedia(assetFile.bytes, assetFile.path)
        : probeVideoMedia(assetFile.path, prefix),
      prefix,
    );
    const postProbeAssetFile = readRegularFile(
      assetFile.path,
      `${prefix}_asset`,
    );
    if (
      postProbeAssetFile.sha256 !== assetFile.sha256 ||
      postProbeAssetFile.size_bytes !== assetFile.size_bytes
    ) {
      throw new GovernedSourceMediaError(
        `${prefix}_asset_changed_during_probe`,
      );
    }
    if (
      mediaType === "VIDEO" &&
      ["MUTED", "REMOVED"].includes(sourceAudioDisposition) &&
      mediaProbe.has_audio
    ) {
      throw new GovernedSourceMediaError(
        `${prefix}_asset_audio_stream_present`,
      );
    }
    return {
      ...component,
      component_id: componentId,
      media_type: mediaType,
      attribution: {
        required: true,
        text: ATTRIBUTION_TEXT,
        delivery: attributionDelivery,
      },
      editorial: {
        purpose: EDITORIAL_PURPOSE,
        third_party_music_used: false,
        source_audio_disposition: sourceAudioDisposition,
        usage_seconds: [usageStart, usageEnd],
      },
      asset: {
        path: assetFile.path,
        sha256: assetFile.sha256,
        size_bytes: assetFile.size_bytes,
        ...(mediaProbe || {}),
      },
    };
  });

  return {
    schema_version: manifest?.schema_version,
    story_id: storyId,
    composition_duration_seconds: compositionDuration,
    manifest_path: manifestFile.path,
    manifest_sha256: manifestFile.sha256,
    rights_review: {
      path: evidenceFile.path,
      sha256: evidenceFile.sha256,
      review_status: REVIEW_STATUS,
      evidence: evidenceFile.value,
    },
    components,
  };
}

module.exports = {
  ATTRIBUTION_TEXT,
  CANONICAL_LICENCE_URL,
  COVERED_MATERIALS,
  EDITORIAL_PURPOSE,
  GovernedSourceMediaError,
  MANIFEST_SCHEMA,
  LICENCE_EFFECTIVE_DATE,
  PERMITTED_DESTINATION,
  PUBLISHER,
  REVIEW_STATUS,
  RIGHTS_BASIS,
  RIGHTS_REVIEW_SCHEMA,
  SOURCE_MEDIA_TIMESTAMP_SKEW_MS,
  validateGovernedSourceMediaManifest,
};

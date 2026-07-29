"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const {
  evaluateApplyGates,
  scriptSha256,
} = require("./governed-story-intake");
const {
  assessPublicationEvidence,
  hashRightsLedger,
} = require("./publication-evidence-gates");
const {
  classifyPlatformVideoQa,
  parseFfprobeJson,
} = require("./platform-video-qa");
const {
  evaluateRendererManifest,
  fingerprintRendererManifest,
} = require("../stabilisation/renderer-governance");
const {
  GovernedSourceMediaError,
  validateGovernedSourceMediaManifest,
} = require("./governed-source-media");
const {
  POLICY: GOVERNED_GAME_MEDIA_POLICY,
} = require("./governed-game-media-admission");
const {
  GovernedPublicationMetadataError,
  validateGovernedPublicationMetadata,
} = require("./governed-publication-metadata");
const {
  GovernedLicensedAudioPackError,
  validateGovernedLicensedAudioPack,
} = require("./governed-licensed-audio-pack");
const {
  getDurationBand,
} = require("./pulse-editorial-contract");
const {
  buildOfficialSourceReleaseBinding,
} = require("./official-source-revalidation");

const execFileAsync = promisify(execFile);
const REVIEW_SCHEMA_VERSION = "pulse-governed-publication-review-v1";
const RESULT_SCHEMA_VERSION =
  "pulse-governed-publication-review-result-v1";
const SOURCE_SCHEMA_VERSION = "pulse-source-evidence-v1";
const QA_SCHEMA_VERSION = "pulse-final-render-qa-v1";
const TRANSFORMATION_SCHEMA_VERSION =
  "pulse-transformation-evidence-v1";
const OWNED_MOTION_SCHEMA_VERSION = "pulse-owned-motion-manifest-v1";
const TIMESTAMPS_SCHEMA_VERSION = "pulse-word-timestamps-v1";
const MIN_DURATION_SECONDS = 25;
const MAX_DURATION_SECONDS = 32;
const MAX_LICENSED_AUDIO_DURATION_SECONDS = 59;
const LICENSED_AUDIO_DURATION_TOLERANCE_SECONDS = 0.001;
const PULSE_YOUTUBE_ACCOUNT_URI =
  "https://www.youtube.com/@PulseGMG";
const PUBLICATION_PLATFORM = "youtube_shorts";
const OWNED_ONLY_SOURCE_MEDIA_POLICY = "OWNED_ONLY";
const LICENSED_SOURCE_MEDIA_POLICY = "LICENSED_OFFICIAL_FFXIV";
const THIRD_PARTY_SOURCE_MEDIA_POLICIES = new Set([
  LICENSED_SOURCE_MEDIA_POLICY,
  GOVERNED_GAME_MEDIA_POLICY,
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const EMBEDDED_ROLES = new Set([
  "motion",
  "narration",
  "music",
  "sfx",
  "source_media",
]);
const NON_EMBEDDED_ROLES = new Set(["word_timestamps"]);

class GovernedPublicationReviewError extends Error {
  constructor(
    codes,
    message = "governed_publication_review_validation_failed",
  ) {
    const normalised = unique(Array.isArray(codes) ? codes : [codes]);
    super(`${message}: ${normalised.join(", ")}`);
    this.name = "GovernedPublicationReviewError";
    this.codes = normalised;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function text(value) {
  return String(value || "").trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashFile(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function parseJsonBytes(bytes, invalidCode) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new GovernedPublicationReviewError(invalidCode);
  }
}

function resolveBoundFile({
  baseDir,
  record,
  prefix,
  requireJson = false,
} = {}) {
  const errors = [];
  const declaredPath = text(record?.path);
  const declaredSha = text(record?.sha256).toLowerCase();
  const resolvedPath = declaredPath
    ? path.resolve(baseDir, declaredPath)
    : null;
  if (!declaredPath) errors.push(`${prefix}_path_required`);
  if (!SHA256_PATTERN.test(declaredSha)) {
    errors.push(`${prefix}_sha256_required`);
  }
  if (
    !resolvedPath ||
    !fs.existsSync(resolvedPath) ||
    !fs.statSync(resolvedPath).isFile()
  ) {
    errors.push(`${prefix}_file_not_found`);
  }
  let bytes = null;
  let value = null;
  if (resolvedPath && fs.existsSync(resolvedPath)) {
    bytes = fs.readFileSync(resolvedPath);
    if (bytes.length === 0) errors.push(`${prefix}_file_empty`);
    if (
      SHA256_PATTERN.test(declaredSha) &&
      sha256Bytes(bytes) !== declaredSha
    ) {
      errors.push(`${prefix}_sha256_mismatch`);
    }
    if (requireJson) {
      try {
        value = JSON.parse(bytes.toString("utf8"));
      } catch {
        errors.push(`${prefix}_invalid_json`);
      }
    }
  }
  if (errors.length) throw new GovernedPublicationReviewError(errors);
  return {
    declaredPath,
    path: resolvedPath,
    sha256: declaredSha,
    bytes,
    value,
  };
}

function resolveBoundJson({ baseDir, record, prefix } = {}) {
  return resolveBoundFile({
    baseDir,
    record,
    prefix,
    requireJson: true,
  });
}

function normaliseInput(input) {
  return {
    component_id: text(input?.component_id),
    role: text(input?.role).toLowerCase(),
    path: text(input?.path).replace(/\\/g, "/"),
    sha256: text(input?.sha256).toLowerCase(),
    embedded_in_final: input?.embedded_in_final === true,
  };
}

function normaliseInputList(value) {
  return (Array.isArray(value) ? value : [])
    .map(normaliseInput)
    .sort((left, right) =>
      left.component_id.localeCompare(right.component_id),
    );
}

async function defaultProbe(filePath, options = {}) {
  const result = await execFileAsync(
    options.ffprobePath || "ffprobe",
    [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ],
    {
      timeout: options.probeTimeoutMs || 15000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  const parsed = parseFfprobeJson(result.stdout);
  if (!parsed) {
    throw new GovernedPublicationReviewError(
      "final_mp4_ffprobe_output_invalid",
    );
  }
  return parsed;
}

async function inspectFinalMedia({
  filePath,
  probe = defaultProbe,
  ffprobePath,
  probeTimeoutMs,
  expectedDurationSeconds,
} = {}) {
  let raw;
  try {
    raw = await probe(filePath, { ffprobePath, probeTimeoutMs });
  } catch (error) {
    if (error instanceof GovernedPublicationReviewError) throw error;
    throw new GovernedPublicationReviewError(
      "final_mp4_ffprobe_failed",
    );
  }
  if (typeof raw === "string") raw = parseFfprobeJson(raw);
  if (raw?.stdout !== undefined) raw = parseFfprobeJson(raw.stdout);
  const qa = classifyPlatformVideoQa(raw, { platform: "youtube_shorts" });
  const technical = qa.technical || {};
  const blockers = [];
  if (qa.result !== "pass") blockers.push("final_mp4_platform_qa_failed");
  if (
    technical.width !== 1080 ||
    technical.height !== 1920
  ) {
    blockers.push("final_mp4_dimensions_must_be_1080x1920");
  }
  if (text(technical.video_codec).toLowerCase() !== "h264") {
    blockers.push("final_mp4_video_codec_must_be_h264");
  }
  if (text(technical.audio_codec).toLowerCase() !== "aac") {
    blockers.push("final_mp4_audio_codec_must_be_aac");
  }
  if (technical.audio_sample_rate_hz !== 48000) {
    blockers.push("final_mp4_audio_sample_rate_must_be_48000");
  }
  if (technical.has_audio !== true) {
    blockers.push("final_mp4_audio_stream_required");
  }
  const governedDuration = Number(expectedDurationSeconds);
  if (Number.isFinite(governedDuration)) {
    if (
      !Number.isFinite(technical.duration_seconds) ||
      governedDuration <= 0 ||
      governedDuration > MAX_LICENSED_AUDIO_DURATION_SECONDS ||
      Math.abs(
        technical.duration_seconds - governedDuration,
      ) > LICENSED_AUDIO_DURATION_TOLERANCE_SECONDS
    ) {
      blockers.push(
        "final_mp4_duration_must_match_licensed_audio_pack",
      );
    }
  } else if (
    !Number.isFinite(technical.duration_seconds) ||
    technical.duration_seconds < MIN_DURATION_SECONDS ||
    technical.duration_seconds > MAX_DURATION_SECONDS
  ) {
    blockers.push("final_mp4_duration_must_be_25_to_32_seconds");
  }
  if (blockers.length) {
    throw new GovernedPublicationReviewError(blockers);
  }
  return { qa, probe: raw, technical };
}

function validateOwnedMotion({
  bound,
  storyId,
  sourceMedia,
} = {}) {
  const manifest = bound.value;
  const errors = [];
  if (manifest?.schema_version !== OWNED_MOTION_SCHEMA_VERSION) {
    errors.push("owned_motion_manifest_schema_invalid");
  }
  if (text(manifest?.story_id) !== storyId) {
    errors.push("owned_motion_story_id_mismatch");
  }
  const rawAssets = Array.isArray(manifest?.assets)
    ? manifest.assets
    : [];
  if (!rawAssets.length) errors.push("owned_motion_assets_required");
  const assets = [];
  for (const [index, raw] of rawAssets.entries()) {
    const prefix = `owned_motion_asset_${index}`;
    let file;
    try {
      file = resolveBoundFile({
        baseDir: path.dirname(bound.path),
        record: raw,
        prefix,
      });
    } catch (error) {
      if (error instanceof GovernedPublicationReviewError) {
        errors.push(...error.codes);
        continue;
      }
      throw error;
    }
    const mediaType = text(raw?.media_type).toLowerCase();
    if (!["image", "video"].includes(mediaType)) {
      errors.push(`${prefix}_media_type_invalid`);
    }
    const isMixedIntermediate =
      Boolean(sourceMedia) &&
      text(raw?.role) === "hyperframes_intermediate";
    if (isMixedIntermediate) {
      if (
        text(raw?.ownership).toLowerCase() !== "mixed" ||
        text(raw?.rights_basis).toUpperCase() !== "LICENSED"
      ) {
        errors.push(`${prefix}_mixed_licensed_required`);
      }
      if (
        raw?.attribution_required !== true ||
        raw?.provenance?.third_party_media_used !== true
      ) {
        errors.push(`${prefix}_mixed_provenance_invalid`);
      }
      try {
        const sourceBinding = resolveBoundFile({
          baseDir: path.dirname(bound.path),
          record: raw?.provenance?.source_media_manifest,
          prefix: `${prefix}_source_media_manifest`,
        });
        if (
          sourceBinding.path !== sourceMedia.manifest_path ||
          sourceBinding.sha256 !== sourceMedia.manifest_sha256
        ) {
          errors.push(`${prefix}_source_media_manifest_mismatch`);
        }
      } catch (error) {
        if (error instanceof GovernedPublicationReviewError) {
          errors.push(...error.codes);
        } else {
          throw error;
        }
      }
    } else {
      if (text(raw?.ownership).toLowerCase() !== "owned") {
        errors.push(`${prefix}_ownership_must_be_owned`);
      }
      if (
        sourceMedia &&
        (text(raw?.rights_basis).toUpperCase() !== "OWNED" ||
          raw?.attribution_required !== false ||
          raw?.provenance?.third_party_media_used !== false)
      ) {
        errors.push(`${prefix}_owned_rights_provenance_invalid`);
      }
    }
    assets.push({
      path: file.path,
      sha256: file.sha256,
      media_type: mediaType,
      role: text(raw?.role),
      ownership: text(raw?.ownership).toLowerCase(),
      rights_basis: text(raw?.rights_basis).toUpperCase(),
      attribution_required: raw?.attribution_required === true,
      mixed_licensed_intermediate: isMixedIntermediate,
    });
  }
  if (!assets.some((asset) => asset.media_type === "video")) {
    errors.push("owned_motion_video_required");
  }
  if (errors.length) throw new GovernedPublicationReviewError(errors);
  return { manifest, assets };
}

function validateTimestamps({ bound, storyId, maxDuration } = {}) {
  const input = bound.value;
  const errors = [];
  if (input?.schema_version !== TIMESTAMPS_SCHEMA_VERSION) {
    errors.push("word_timestamps_schema_invalid");
  }
  if (text(input?.story_id) !== storyId) {
    errors.push("word_timestamps_story_id_mismatch");
  }
  if (!Array.isArray(input?.words) || input.words.length === 0) {
    errors.push("word_timestamps_words_required");
  } else {
    let lastEnd = 0;
    for (const word of input.words) {
      const start = Number(word?.start_seconds);
      const end = Number(word?.end_seconds);
      if (
        !text(word?.text) ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < lastEnd ||
        end <= start
      ) {
        errors.push("word_timestamps_sequence_invalid");
        break;
      }
      lastEnd = end;
    }
    if (lastEnd > maxDuration) {
      errors.push("word_timestamps_exceed_final_duration");
    }
  }
  if (errors.length) throw new GovernedPublicationReviewError(errors);
}

function resolveGovernedTimestampSource(timestamps) {
  const sourceRecord = timestamps?.value?.source;
  if (!sourceRecord) return timestamps;
  return resolveBoundFile({
    baseDir: path.dirname(timestamps.path),
    record: sourceRecord,
    prefix: "licensed_audio_source_word_timestamps",
  });
}

function sourceMediaRightsContract(sourceMedia) {
  const components = Array.isArray(sourceMedia?.components)
    ? sourceMedia.components
    : [];
  const requiredAttributionTexts = unique(
    components
      .filter(
        (component) =>
          component?.attribution?.required === true,
      )
      .map((component) => text(component?.attribution?.text)),
  );
  const publishers = unique(
    components.map((component) =>
      text(component?.source?.publisher),
    ),
  );
  const attributionDelivery = unique(
    components.flatMap((component) =>
      Array.isArray(component?.attribution?.delivery)
        ? component.attribution.delivery.map((value) =>
            text(value).toUpperCase(),
          )
        : [],
    ),
  ).sort();
  return {
    rights_basis:
      text(sourceMedia?.policy).toUpperCase() ===
      GOVERNED_GAME_MEDIA_POLICY
        ? "PER_ASSET_GOVERNED"
        : "LICENSED",
    publisher:
      publishers.length === 1 ? publishers[0] : "MULTIPLE",
    attribution_required: requiredAttributionTexts.length > 0,
    attribution_text: requiredAttributionTexts.join(" | "),
    attribution_delivery: attributionDelivery,
  };
}

function validateSourceMediaRightsEvidence({
  sourceMedia,
  publicationMetadata,
  includedItems,
  rightsLedgerPath,
  storyId,
  errors,
} = {}) {
  const contract = sourceMediaRightsContract(sourceMedia);
  const sourceItems = sourceMedia.components.map((component) => ({
    component,
    item: includedItems.find(
      (candidate) =>
        text(candidate?.item_id) === component.component_id,
    ),
  }));
  const evidenceBindings = sourceItems
    .map(({ item }) => ({
      path: text(item?.rights_evidence?.reference),
      sha256: text(item?.rights_evidence?.sha256).toLowerCase(),
    }))
    .filter((record) => record.path && record.sha256);
  if (
    evidenceBindings.length !== sourceMedia.components.length ||
    new Set(
      evidenceBindings.map(
        (record) => `${record.path}\0${record.sha256}`,
      ),
    ).size !== 1
  ) {
    errors.push("source_media_rights_evidence_binding_mismatch");
    return;
  }
  let evidence;
  try {
    evidence = resolveBoundJson({
      baseDir: path.dirname(rightsLedgerPath),
      record: evidenceBindings[0],
      prefix: "source_media_rights_evidence",
    });
  } catch (error) {
    if (error instanceof GovernedPublicationReviewError) {
      errors.push(...error.codes);
      return;
    }
    throw error;
  }
  const value = evidence.value;
  if (
    value?.schema_version !== "pulse-rights-evidence-v1" ||
    text(value?.story_id) !== storyId ||
    text(value?.rights_basis).toUpperCase() !==
      contract.rights_basis ||
    text(value?.rights_decision).toUpperCase() !== "CLEARED" ||
    text(value?.publisher) !== contract.publisher ||
    value?.attribution_required !==
      contract.attribution_required ||
    text(value?.attribution_text) !== contract.attribution_text ||
    stableJson(
      unique(
        (Array.isArray(value?.attribution_delivery)
          ? value.attribution_delivery
          : []
        ).map((item) => text(item).toUpperCase()),
      ).sort(),
    ) !== stableJson(contract.attribution_delivery) ||
    value?.third_party_media_used !== true
  ) {
    errors.push("source_media_rights_evidence_policy_invalid");
  }
  const descriptionEvidence =
    value?.description_attribution_evidence;
  if (
    text(descriptionEvidence?.notice) !==
      contract.attribution_text ||
    descriptionEvidence?.exact_standalone_line_verified !== true ||
    text(descriptionEvidence?.publication_metadata?.platform) !==
      PUBLICATION_PLATFORM
  ) {
    errors.push(
      "source_media_description_attribution_evidence_invalid",
    );
  }
  try {
    const metadataBinding = resolveBoundFile({
      baseDir: path.dirname(evidence.path),
      record: descriptionEvidence?.publication_metadata,
      prefix: "source_media_publication_metadata_binding",
    });
    if (
      metadataBinding.path !== publicationMetadata.path ||
      metadataBinding.sha256 !== publicationMetadata.sha256
    ) {
      errors.push(
        "source_media_publication_metadata_binding_mismatch",
      );
    }
  } catch (error) {
    if (error instanceof GovernedPublicationReviewError) {
      errors.push(...error.codes);
    } else {
      throw error;
    }
  }
  try {
    const manifestBinding = resolveBoundFile({
      baseDir: path.dirname(evidence.path),
      record: value?.manifest_binding,
      prefix: "source_media_rights_manifest_binding",
    });
    if (
      manifestBinding.path !== sourceMedia.manifest_path ||
      manifestBinding.sha256 !== sourceMedia.manifest_sha256
    ) {
      errors.push("source_media_rights_manifest_binding_mismatch");
    }
    const reviewBinding = resolveBoundFile({
      baseDir: path.dirname(evidence.path),
      record: {
        path: value?.licence?.rights_review_path,
        sha256: value?.licence?.rights_review_sha256,
      },
      prefix: "source_media_rights_review_binding",
    });
    if (
      reviewBinding.path !== sourceMedia.rights_review.path ||
      reviewBinding.sha256 !== sourceMedia.rights_review.sha256
    ) {
      errors.push("source_media_rights_review_binding_mismatch");
    }
  } catch (error) {
    if (error instanceof GovernedPublicationReviewError) {
      errors.push(...error.codes);
    } else {
      throw error;
    }
  }
  const actualComponents = (Array.isArray(value?.components)
    ? value.components
    : []
  )
    .map((component) => ({
      component_id: text(component?.component_id),
      asset_path: path.resolve(
        path.dirname(evidence.path),
        text(component?.asset_path),
      ),
      asset_sha256: text(component?.asset_sha256).toLowerCase(),
      direct_media_url: text(component?.direct_media_url),
      rights_basis: text(component?.rights_basis).toUpperCase(),
      attribution_required:
        component?.attribution_required === true,
      attribution_text: text(component?.attribution_text),
    }))
    .sort((left, right) =>
      left.component_id.localeCompare(right.component_id),
    );
  const expectedComponents = sourceMedia.components
    .map((component) => ({
      component_id: component.component_id,
      asset_path: component.asset.path,
      asset_sha256: component.asset.sha256,
      direct_media_url: component.source.direct_media_url,
      rights_basis: text(component.rights_basis).toUpperCase(),
      attribution_required:
        component.attribution?.required === true,
      attribution_text: text(component.attribution?.text),
    }))
    .sort((left, right) =>
      left.component_id.localeCompare(right.component_id),
    );
  if (stableJson(actualComponents) !== stableJson(expectedComponents)) {
    errors.push("source_media_rights_evidence_components_mismatch");
  }
}

function validateLicensedAudioReview({
  manifest,
  manifestDir,
  storyId,
  channelId,
  scriptSha,
  narration,
  timestamps,
  expectedYoutubeAccountUri,
  validationBoundaryAt,
} = {}) {
  if (!manifest?.licensed_audio) return null;
  if (
    text(expectedYoutubeAccountUri) !==
    PULSE_YOUTUBE_ACCOUNT_URI
  ) {
    throw new GovernedPublicationReviewError(
      "licensed_audio_youtube_account_uri_invalid",
    );
  }
  const storyIntake = resolveBoundJson({
    baseDir: manifestDir,
    record: manifest.story_intake,
    prefix: "story_intake",
  });
  const intake = storyIntake.value;
  const errors = [];
  if (
    intake?.schema_version !==
      "pulse-governed-story-intake-v1" ||
    text(intake?.story?.id) !== storyId ||
    text(intake?.story?.channel_id || "pulse-gaming") !==
      channelId ||
    text(intake?.story?.script_sha256).toLowerCase() !==
      scriptSha ||
    scriptSha256(intake?.story?.full_script) !== scriptSha
  ) {
    errors.push("licensed_audio_story_intake_identity_invalid");
  }
  const durationBandId = text(
    intake?.contract?.duration_band_id,
  );
  let durationBand = null;
  try {
    durationBand = getDurationBand(durationBandId);
  } catch {
    errors.push("licensed_audio_story_duration_band_invalid");
  }
  const targetDurationSeconds = Number(
    intake?.contract?.target_duration_seconds,
  );
  if (
    !Number.isFinite(targetDurationSeconds) ||
    targetDurationSeconds <= 0
  ) {
    errors.push("licensed_audio_story_target_duration_required");
  } else {
    if (
      targetDurationSeconds >
      MAX_LICENSED_AUDIO_DURATION_SECONDS
    ) {
      errors.push(
        "licensed_audio_story_target_exceeds_short_limit",
      );
    }
    if (
      !durationBand ||
      targetDurationSeconds < durationBand.min_seconds ||
      targetDurationSeconds > durationBand.max_seconds ||
      text(intake?.contract?.editorial_lane_id) !==
        text(durationBand?.lane_id)
    ) {
      errors.push(
        "licensed_audio_story_target_outside_named_band",
      );
    }
  }
  const targetReview =
    intake?.contract?.target_duration_review;
  if (
    durationBand?.target_duration_review_required === true ||
    targetReview
  ) {
    if (
      text(targetReview?.status).toUpperCase() !== "APPROVED" ||
      Number(targetReview?.target_duration_seconds) !==
        targetDurationSeconds ||
      text(targetReview?.script_sha256).toLowerCase() !==
        scriptSha ||
      !text(targetReview?.reviewed_by) ||
      !Number.isFinite(
        Date.parse(text(targetReview?.reviewed_at)),
      ) ||
      Date.parse(text(targetReview?.reviewed_at)) >
        Date.parse(text(validationBoundaryAt))
    ) {
      errors.push(
        "licensed_audio_target_duration_review_invalid",
      );
    }
  }
  if (errors.length) {
    throw new GovernedPublicationReviewError(errors);
  }

  const review = manifest.licensed_audio;
  const sourceTimestamps =
    resolveGovernedTimestampSource(timestamps);
  const pack = resolveBoundFile({
    baseDir: manifestDir,
    record: review.manifest,
    prefix: "licensed_audio_manifest",
  });
  const rightsLedger = resolveBoundFile({
    baseDir: manifestDir,
    record: review.rights_ledger,
    prefix: "licensed_audio_rights_ledger",
  });
  let validation;
  try {
    validation = validateGovernedLicensedAudioPack({
      manifestPath: pack.path,
      expectedManifestSha256: pack.sha256,
      expectedStoryId: storyId,
      expectedChannelId: channelId,
      expectedNarrationSha256: narration.sha256,
      expectedTimestampsSha256: sourceTimestamps.sha256,
      expectedTargetDurationSeconds: targetDurationSeconds,
      expectedRightsLedgerSha256: rightsLedger.sha256,
      expectedYoutubeAccountUri: PULSE_YOUTUBE_ACCOUNT_URI,
      requiredDestination: "YOUTUBE_SHORTS",
      requiredRevenueMode: "PLATFORM_ADVERTISING",
      validationBoundaryAt,
    });
  } catch (error) {
    if (error instanceof GovernedLicensedAudioPackError) {
      throw new GovernedPublicationReviewError(error.codes);
    }
    throw error;
  }
  const actualAssets = [];
  for (const [index, asset] of (
    Array.isArray(review?.assets) ? review.assets : []
  ).entries()) {
    const file = resolveBoundFile({
      baseDir: manifestDir,
      record: asset,
      prefix: `licensed_audio_review_asset_${index}`,
    });
    const rightsEvidence = resolveBoundFile({
      baseDir: manifestDir,
      record: asset?.rights_evidence,
      prefix: `licensed_audio_review_asset_${index}_rights_evidence`,
    });
    actualAssets.push({
      asset_id: text(asset?.asset_id),
      source_role: text(asset?.source_role).toUpperCase(),
      renderer_role: text(asset?.renderer_role).toLowerCase(),
      path: file.path,
      sha256: file.sha256,
      size_bytes: Number(asset?.size_bytes),
      provider_asset_reference: text(
        asset?.provider_asset_reference,
      ),
      rights_record_sha256: text(
        asset?.rights_record_sha256,
      ).toLowerCase(),
      rights_evidence_path: rightsEvidence.path,
      rights_evidence_sha256: rightsEvidence.sha256,
      embedded_in_final: asset?.embedded_in_final === true,
    });
  }
  actualAssets.sort((left, right) =>
    left.asset_id.localeCompare(right.asset_id),
  );
  const expectedAssets = validation.assets
    .map((asset) => ({
      asset_id: asset.asset_id,
      source_role: asset.role,
      renderer_role:
        asset.role === "MUSIC_BED" ? "music" : "sfx",
      path: asset.path,
      sha256: asset.sha256,
      size_bytes: asset.size_bytes,
      provider_asset_reference:
        asset.provider_asset_reference,
      rights_record_sha256: asset.rights_record_sha256,
      rights_evidence_path: asset.rights_evidence_path,
      rights_evidence_sha256:
        asset.rights_evidence_sha256,
      embedded_in_final: true,
    }))
    .sort((left, right) =>
      left.asset_id.localeCompare(right.asset_id),
    );
  if (
    text(review?.policy) !== validation.policy ||
    pack.path !== validation.manifest_path ||
    pack.sha256 !== validation.manifest_sha256 ||
    rightsLedger.path !== validation.rights_ledger.path ||
    rightsLedger.sha256 !== validation.rights_ledger.sha256 ||
    stableJson(review?.provider) !==
      stableJson(validation.provider) ||
    stableJson(review?.scope) !== stableJson(validation.scope) ||
    stableJson(review?.render_binding) !==
      stableJson(validation.render_binding) ||
    stableJson(review?.mix) !== stableJson(validation.mix) ||
    stableJson(actualAssets) !== stableJson(expectedAssets)
  ) {
    throw new GovernedPublicationReviewError(
      "licensed_audio_review_evidence_mismatch",
    );
  }
  return {
    storyIntake,
    validation,
    evidence: {
      policy: validation.policy,
      manifest: {
        path: pack.path,
        sha256: pack.sha256,
      },
      rights_ledger: {
        path: rightsLedger.path,
        sha256: rightsLedger.sha256,
      },
      provider: validation.provider,
      scope: validation.scope,
      render_binding: validation.render_binding,
      mix: validation.mix,
      assets: actualAssets,
    },
  };
}

function validateRendererInputs({
  manifestDir,
  reviewInputs,
  rendererInputs,
  narration,
  timestamps,
  ownedMotion,
  sourceMedia,
  licensedAudio,
  publicationMetadata,
  rightsLedger,
  rightsLedgerPath,
} = {}) {
  const errors = [];
  const normalisedReview = normaliseInputList(reviewInputs);
  const normalisedRenderer = normaliseInputList(rendererInputs);
  if (!normalisedReview.length) errors.push("renderer_inputs_required");
  if (stableJson(normalisedReview) !== stableJson(normalisedRenderer)) {
    errors.push("renderer_inputs_manifest_mismatch");
  }
  const ids = new Set();
  const resolvedInputs = [];
  for (const input of normalisedReview) {
    if (!input.component_id) errors.push("renderer_input_component_id_required");
    if (ids.has(input.component_id)) {
      errors.push("renderer_input_component_id_duplicate");
    }
    ids.add(input.component_id);
    if (
      !EMBEDDED_ROLES.has(input.role) &&
      !NON_EMBEDDED_ROLES.has(input.role)
    ) {
      errors.push("renderer_input_role_invalid");
    }
    if (
      EMBEDDED_ROLES.has(input.role) &&
      input.embedded_in_final !== true
    ) {
      errors.push("renderer_embedded_input_flag_required");
    }
    if (
      NON_EMBEDDED_ROLES.has(input.role) &&
      input.embedded_in_final !== false
    ) {
      errors.push("renderer_non_embedded_input_flag_required");
    }
    try {
      const file = resolveBoundFile({
        baseDir: manifestDir,
        record: input,
        prefix: `renderer_input_${input.component_id || "unknown"}`,
      });
      resolvedInputs.push({ ...input, absolutePath: file.path });
    } catch (error) {
      if (error instanceof GovernedPublicationReviewError) {
        errors.push(...error.codes);
      } else {
        throw error;
      }
    }
  }

  const narrationInput = resolvedInputs.find(
    (input) => input.role === "narration",
  );
  if (
    !narrationInput ||
    narrationInput.component_id !== text(narration.component_id) ||
    narrationInput.absolutePath !== narration.path ||
    narrationInput.sha256 !== narration.sha256
  ) {
    errors.push("narration_renderer_input_mismatch");
  }
  const timestampsInput = resolvedInputs.find(
    (input) => input.role === "word_timestamps",
  );
  if (
    !timestampsInput ||
    timestampsInput.component_id !== text(timestamps.component_id) ||
    timestampsInput.absolutePath !== timestamps.path ||
    timestampsInput.sha256 !== timestamps.sha256
  ) {
    errors.push("word_timestamps_renderer_input_mismatch");
  }
  const motionInputs = resolvedInputs.filter(
    (input) => input.role === "motion",
  );
  if (!motionInputs.length) errors.push("owned_motion_renderer_input_required");
  for (const input of motionInputs) {
    if (
      !ownedMotion.assets.some(
        (asset) =>
          asset.path === input.absolutePath &&
          asset.sha256 === input.sha256 &&
          asset.media_type === "video",
      )
    ) {
      errors.push("owned_motion_renderer_input_mismatch");
    }
  }
  const sourceMediaInputs = resolvedInputs.filter(
    (input) => input.role === "source_media",
  );
  if (sourceMedia) {
    const expectedSourceMediaInputs = sourceMedia.components
      .map((component) => ({
        component_id: component.component_id,
        absolutePath: component.asset.path,
        sha256: component.asset.sha256,
      }))
      .sort((left, right) =>
        left.component_id.localeCompare(right.component_id),
      );
    const actualSourceMediaInputs = sourceMediaInputs
      .map((input) => ({
        component_id: input.component_id,
        absolutePath: input.absolutePath,
        sha256: input.sha256,
      }))
      .sort((left, right) =>
        left.component_id.localeCompare(right.component_id),
      );
    if (
      stableJson(expectedSourceMediaInputs) !==
      stableJson(actualSourceMediaInputs)
    ) {
      errors.push("source_media_renderer_input_coverage_mismatch");
    }
  } else if (sourceMediaInputs.length) {
    errors.push("source_media_manifest_required");
  }
  const licensedAudioInputs = resolvedInputs
    .filter((input) => ["music", "sfx"].includes(input.role))
    .map((input) => ({
      component_id: input.component_id,
      role: input.role,
      absolutePath: input.absolutePath,
      sha256: input.sha256,
      embedded_in_final: input.embedded_in_final,
    }))
    .sort((left, right) =>
      left.component_id.localeCompare(right.component_id),
    );
  if (licensedAudio) {
    const expectedLicensedAudioInputs =
      licensedAudio.validation.assets
        .map((asset) => ({
          component_id: asset.asset_id,
          role: asset.role === "MUSIC_BED" ? "music" : "sfx",
          absolutePath: asset.path,
          sha256: asset.sha256,
          embedded_in_final: true,
        }))
        .sort((left, right) =>
          left.component_id.localeCompare(right.component_id),
        );
    if (
      stableJson(licensedAudioInputs) !==
      stableJson(expectedLicensedAudioInputs)
    ) {
      errors.push(
        "licensed_audio_renderer_input_coverage_mismatch",
      );
    }
  } else if (licensedAudioInputs.length) {
    errors.push(
      "licensed_audio_evidence_required_for_music_or_sfx",
    );
  }

  const includedItems = Array.isArray(rightsLedger?.items)
    ? rightsLedger.items.filter((item) => item?.included_in_final === true)
    : [];
  const embeddedInputs = resolvedInputs.filter(
    (input) => input.embedded_in_final,
  );
  const includedIds = includedItems
    .map((item) => text(item?.item_id))
    .sort();
  const embeddedIds = embeddedInputs
    .map((input) => input.component_id)
    .sort();
  if (stableJson(includedIds) !== stableJson(embeddedIds)) {
    errors.push("rights_ledger_renderer_component_coverage_mismatch");
  }
  for (const item of includedItems) {
    const itemId = text(item?.item_id);
    const input = embeddedInputs.find(
      (candidate) => candidate.component_id === itemId,
    );
    const assetPath = text(item?.asset_path)
      ? path.resolve(path.dirname(rightsLedgerPath), item.asset_path)
      : null;
    if (
      !input ||
      !assetPath ||
      input.absolutePath !== assetPath ||
      input.sha256 !== text(item?.asset_sha256).toLowerCase()
    ) {
      errors.push("rights_ledger_component_asset_mismatch");
    }
    const rightsEvidence = item?.rights_evidence || {};
    try {
      resolveBoundFile({
        baseDir: path.dirname(rightsLedgerPath),
        record: {
          path: rightsEvidence.reference,
          sha256: rightsEvidence.sha256,
        },
        prefix: `rights_evidence_${itemId || "unknown"}`,
      });
    } catch (error) {
      if (error instanceof GovernedPublicationReviewError) {
        errors.push(...error.codes);
      } else {
        throw error;
      }
    }
  }
  if (licensedAudio) {
    for (const asset of licensedAudio.validation.assets) {
      const item = includedItems.find(
        (candidate) =>
          text(candidate?.item_id) === asset.asset_id,
      );
      let rightsEvidence = null;
      try {
        rightsEvidence = resolveBoundFile({
          baseDir: path.dirname(rightsLedgerPath),
          record: {
            path: item?.rights_evidence?.reference,
            sha256: item?.rights_evidence?.sha256,
          },
          prefix: `licensed_audio_rights_${asset.asset_id}`,
        });
      } catch (error) {
        if (error instanceof GovernedPublicationReviewError) {
          errors.push(...error.codes);
        } else {
          throw error;
        }
      }
      if (
        !item ||
        text(item?.source_url) !==
          asset.provider_asset_reference ||
        text(item?.rights_basis).toUpperCase() !== "LICENSED" ||
        text(item?.rights_decision).toUpperCase() !== "CLEARED" ||
        text(item?.attribution_decision).toUpperCase() !==
          "NOT_REQUIRED" ||
        text(item?.attribution_text) ||
        rightsEvidence?.path !== asset.rights_evidence_path ||
        rightsEvidence?.sha256 !==
          asset.rights_evidence_sha256
      ) {
        errors.push(
          "licensed_audio_rights_ledger_item_invalid",
        );
      }
    }
  }
  if (sourceMedia) {
    const sourceMediaContract =
      sourceMediaRightsContract(sourceMedia);
    for (const component of sourceMedia.components) {
      const item = includedItems.find(
        (candidate) =>
          text(candidate?.item_id) === component.component_id,
      );
      const attributionRequired =
        component.attribution?.required === true;
      if (
        !item ||
        text(item?.source_url) !==
          component.source.direct_media_url ||
        text(item?.rights_basis).toUpperCase() !==
          text(component.rights_basis).toUpperCase() ||
        text(item?.attribution_decision).toUpperCase() !==
          (attributionRequired
            ? "REQUIRED_AND_SUPPLIED"
            : "NOT_REQUIRED") ||
        text(item?.attribution_text) !==
          text(component.attribution?.text)
      ) {
        errors.push("source_media_rights_ledger_item_invalid");
      }
    }
    validateSourceMediaRightsEvidence({
      sourceMedia,
      publicationMetadata,
      includedItems,
      rightsLedgerPath,
      storyId: sourceMedia.story_id,
      errors,
    });
    const motionItem = includedItems.find(
      (item) =>
        motionInputs.some(
          (input) =>
            input.component_id === text(item?.item_id),
        ),
    );
    if (
      !motionItem ||
      text(motionItem?.rights_basis).toUpperCase() !== "LICENSED" ||
      text(motionItem?.attribution_decision).toUpperCase() !==
        (sourceMediaContract.attribution_required
          ? "REQUIRED_AND_SUPPLIED"
          : "NOT_REQUIRED") ||
      text(motionItem?.attribution_text) !==
        sourceMediaContract.attribution_text
    ) {
      errors.push("mixed_motion_rights_ledger_item_invalid");
    } else {
      try {
        const motionEvidence = resolveBoundJson({
          baseDir: path.dirname(rightsLedgerPath),
          record: {
            path: motionItem.rights_evidence?.reference,
            sha256: motionItem.rights_evidence?.sha256,
          },
          prefix: "mixed_motion_rights_evidence",
        });
        const value = motionEvidence.value;
        const motionInput = motionInputs.find(
          (input) =>
            input.component_id === text(motionItem.item_id),
        );
        if (
          value?.schema_version !== "pulse-rights-evidence-v1" ||
          text(value?.story_id) !== sourceMedia.story_id ||
          text(value?.component_id) !== motionInput?.component_id ||
          text(value?.asset_sha256).toLowerCase() !==
            motionInput?.sha256 ||
          text(value?.rights_basis).toUpperCase() !== "LICENSED" ||
          text(value?.rights_decision).toUpperCase() !== "CLEARED" ||
          text(value?.ownership).toLowerCase() !== "mixed" ||
          value?.attribution_required !==
            sourceMediaContract.attribution_required ||
          text(value?.attribution_text) !==
            sourceMediaContract.attribution_text ||
          value?.third_party_media_used !== true
        ) {
          errors.push("mixed_motion_rights_evidence_invalid");
        }
        const sourceBinding = resolveBoundFile({
          baseDir: path.dirname(motionEvidence.path),
          record: value?.source_media_manifest_binding,
          prefix: "mixed_motion_rights_source_media_binding",
        });
        if (
          sourceBinding.path !== sourceMedia.manifest_path ||
          sourceBinding.sha256 !== sourceMedia.manifest_sha256
        ) {
          errors.push(
            "mixed_motion_rights_source_media_binding_mismatch",
          );
        }
      } catch (error) {
        if (error instanceof GovernedPublicationReviewError) {
          errors.push(...error.codes);
        } else {
          throw error;
        }
      }
    }
  }
  if (errors.length) throw new GovernedPublicationReviewError(errors);
  return resolvedInputs;
}

async function validatePublicationReviewManifest({
  manifestPath,
  probe,
  ffprobePath,
  probeTimeoutMs,
  validationBoundaryAt,
  expectedYoutubeAccountUri,
} = {}) {
  const resolvedManifestPath = path.resolve(text(manifestPath));
  if (
    !manifestPath ||
    !fs.existsSync(resolvedManifestPath) ||
    !fs.statSync(resolvedManifestPath).isFile()
  ) {
    throw new GovernedPublicationReviewError(
      "publication_review_manifest_file_required",
    );
  }
  const manifestBytes = fs.readFileSync(resolvedManifestPath);
  const manifest = parseJsonBytes(
    manifestBytes,
    "publication_review_manifest_invalid_json",
  );
  const manifestDir = path.dirname(resolvedManifestPath);
  const errors = [];
  if (manifest?.schema_version !== REVIEW_SCHEMA_VERSION) {
    errors.push("publication_review_manifest_schema_invalid");
  }
  const storyId = text(manifest?.story_id);
  const channelId = text(manifest?.channel_id);
  const expectedScriptSha = text(manifest?.script_sha256).toLowerCase();
  if (!storyId) errors.push("publication_review_story_id_required");
  if (!channelId) errors.push("publication_review_channel_id_required");
  if (!SHA256_PATTERN.test(expectedScriptSha)) {
    errors.push("publication_review_script_sha256_required");
  }
  const sourceMediaPolicy = text(
    manifest?.policy?.source_media_policy,
  );
  let sourceMedia = null;
  if (THIRD_PARTY_SOURCE_MEDIA_POLICIES.has(sourceMediaPolicy)) {
    if (manifest?.policy?.third_party_media_used !== true) {
      errors.push("publication_review_source_media_policy_invalid");
    }
    const sourceManifestPath = text(
      manifest?.source_media_manifest?.path,
    );
    const sourceManifestSha256 = text(
      manifest?.source_media_manifest?.sha256,
    );
    if (!sourceManifestPath || !sourceManifestSha256) {
      errors.push(
        "publication_review_source_media_manifest_required",
      );
      if (!sourceManifestPath) {
        errors.push(
          "publication_review_source_media_manifest_path_required",
        );
      }
      if (!sourceManifestSha256) {
        errors.push(
          "publication_review_source_media_manifest_sha256_required",
        );
      }
    } else {
      try {
        sourceMedia = validateGovernedSourceMediaManifest({
          manifestPath: path.resolve(
            manifestDir,
            sourceManifestPath,
          ),
          expectedManifestSha256: sourceManifestSha256,
          expectedStoryId: storyId,
          validationBoundaryAt,
        });
        const admittedPolicy = text(
          sourceMedia?.policy,
        ).toUpperCase();
        if (
          (sourceMediaPolicy === GOVERNED_GAME_MEDIA_POLICY &&
            admittedPolicy !== GOVERNED_GAME_MEDIA_POLICY) ||
          (sourceMediaPolicy === LICENSED_SOURCE_MEDIA_POLICY &&
            admittedPolicy === GOVERNED_GAME_MEDIA_POLICY)
        ) {
          errors.push(
            "publication_review_source_media_policy_manifest_mismatch",
          );
        }
        const attributionRequired = sourceMedia.components.some(
          (component) =>
            component?.attribution?.required === true,
        );
        if (
          manifest?.policy?.attribution_required !==
          attributionRequired
        ) {
          errors.push(
            "publication_review_source_media_policy_invalid",
          );
        }
      } catch (error) {
        if (error instanceof GovernedSourceMediaError) {
          errors.push(...error.codes);
        } else {
          throw error;
        }
      }
    }
  } else if (sourceMediaPolicy === OWNED_ONLY_SOURCE_MEDIA_POLICY) {
    if (
      manifest?.policy?.third_party_media_used !== false ||
      manifest?.policy?.attribution_required !== false
    ) {
      errors.push("publication_review_source_media_policy_invalid");
    }
    if (manifest?.source_media_manifest) {
      errors.push(
        "publication_review_source_media_forbidden_for_owned_only_policy",
      );
    }
  } else {
    errors.push("publication_review_source_media_policy_invalid");
  }

  const publicationMetadataPath = text(
    manifest?.publication_metadata?.path,
  );
  const publicationMetadataSha256 = text(
    manifest?.publication_metadata?.sha256,
  );
  if (!publicationMetadataPath) {
    errors.push("publication_metadata_path_required");
  }
  if (!publicationMetadataSha256) {
    errors.push("publication_metadata_sha256_required");
  }
  if (
    manifest?.publication_metadata &&
    text(manifest.publication_metadata.platform) !==
      PUBLICATION_PLATFORM
  ) {
    errors.push(
      "publication_review_publication_metadata_platform_invalid",
    );
  }
  let publicationMetadata = null;
  if (publicationMetadataPath && publicationMetadataSha256) {
    try {
      publicationMetadata = validateGovernedPublicationMetadata({
        metadataPath: path.resolve(
          manifestDir,
          publicationMetadataPath,
        ),
        expectedMetadataSha256: publicationMetadataSha256,
        expectedStoryId: storyId,
        expectedChannelId: channelId,
        expectedPlatform: PUBLICATION_PLATFORM,
        requiredDescriptionAttributions: sourceMedia
          ? sourceMedia.components
              .filter((component) =>
                component.attribution.delivery.includes("DESCRIPTION"),
              )
              .map((component) => component.attribution.text)
          : [],
      });
    } catch (error) {
      if (error instanceof GovernedPublicationMetadataError) {
        errors.push(...error.codes);
      } else {
        throw error;
      }
    }
  }
  if (errors.length) throw new GovernedPublicationReviewError(errors);

  const finalMp4 = resolveBoundFile({
    baseDir: manifestDir,
    record: manifest.final_mp4,
    prefix: "final_mp4",
  });
  const narration = {
    ...resolveBoundFile({
      baseDir: manifestDir,
      record: manifest.narration_audio,
      prefix: "narration_audio",
    }),
    component_id: text(manifest?.narration_audio?.component_id),
  };
  const timestamps = {
    ...resolveBoundJson({
      baseDir: manifestDir,
      record: manifest.word_timestamps,
      prefix: "word_timestamps",
    }),
    component_id: text(manifest?.word_timestamps?.component_id),
  };
  const ownedMotionBound = resolveBoundJson({
    baseDir: manifestDir,
    record: manifest.owned_motion_manifest,
    prefix: "owned_motion_manifest",
  });
  const source = resolveBoundJson({
    baseDir: manifestDir,
    record: manifest.source_evidence,
    prefix: "source_evidence",
  });
  const qaReport = resolveBoundJson({
    baseDir: manifestDir,
    record: manifest.qa_report,
    prefix: "qa_report",
  });
  const transformation = resolveBoundJson({
    baseDir: manifestDir,
    record: manifest.transformation_evidence,
    prefix: "transformation_evidence",
  });

  const rightsRecord = {
    path: manifest?.rights_ledger?.path,
    sha256: manifest?.rights_ledger?.file_sha256,
  };
  const rights = resolveBoundJson({
    baseDir: manifestDir,
    record: rightsRecord,
    prefix: "rights_ledger",
  });
  const rendererRecord = {
    path: manifest?.renderer_manifest?.path,
    sha256: manifest?.renderer_manifest?.file_sha256,
  };
  const renderer = resolveBoundJson({
    baseDir: manifestDir,
    record: rendererRecord,
    prefix: "renderer_manifest",
  });
  const licensedAudio = validateLicensedAudioReview({
    manifest,
    manifestDir,
    storyId,
    channelId,
    scriptSha: expectedScriptSha,
    narration,
    timestamps,
    expectedYoutubeAccountUri,
    validationBoundaryAt,
  });

  const mediaInspection = await inspectFinalMedia({
    filePath: finalMp4.path,
    probe,
    ffprobePath,
    probeTimeoutMs,
    expectedDurationSeconds:
      licensedAudio?.validation?.render_binding
        ?.target_duration_seconds,
  });
  const validationErrors = [];
  let officialSourceReleaseBinding = null;
  if (
    source.value?.schema_version !== SOURCE_SCHEMA_VERSION ||
    source.value?.source_type !== "official"
  ) {
    validationErrors.push("official_source_evidence_required");
  }
  try {
    officialSourceReleaseBinding =
      buildOfficialSourceReleaseBinding({
        storyId,
        sourceEvidenceSha256: source.sha256,
        sourceEvidence: source.value,
      });
  } catch (error) {
    validationErrors.push(
      text(error?.code) ||
        "official_source_release_binding_invalid",
    );
  }
  if (
    qaReport.value?.schema_version !== QA_SCHEMA_VERSION ||
    text(qaReport.value?.verdict).toUpperCase() !== "PASS"
  ) {
    validationErrors.push("qa_pass_report_required");
  }
  if (text(qaReport.value?.story_id) !== storyId) {
    validationErrors.push("qa_report_story_id_mismatch");
  }
  if (text(qaReport.value?.channel_id) !== channelId) {
    validationErrors.push("qa_report_channel_id_mismatch");
  }
  if (text(qaReport.value?.media_sha256).toLowerCase() !== finalMp4.sha256) {
    validationErrors.push("qa_report_media_sha256_mismatch");
  }
  if (
    text(qaReport.value?.script_sha256).toLowerCase() !==
    expectedScriptSha
  ) {
    validationErrors.push("qa_report_script_sha256_mismatch");
  }
  if (
    transformation.value?.schema_version !==
      TRANSFORMATION_SCHEMA_VERSION
  ) {
    validationErrors.push("transformation_evidence_schema_invalid");
  }
  if (text(transformation.value?.story_id) !== storyId) {
    validationErrors.push("transformation_evidence_story_id_mismatch");
  }
  const canonicalRightsSha = hashRightsLedger(rights.value);
  if (
    text(manifest?.rights_ledger?.canonical_sha256).toLowerCase() !==
    canonicalRightsSha
  ) {
    validationErrors.push("rights_ledger_canonical_sha256_mismatch");
  }
  if (text(rights.value?.story_id) !== storyId) {
    validationErrors.push("rights_ledger_story_id_mismatch");
  }
  const canonicalRendererSha = fingerprintRendererManifest(renderer.value);
  if (
    text(manifest?.renderer_manifest?.canonical_sha256).toLowerCase() !==
    canonicalRendererSha
  ) {
    validationErrors.push("renderer_manifest_canonical_sha256_mismatch");
  }
  if (
    text(qaReport.value?.renderer_manifest_sha256).toLowerCase() !==
    canonicalRendererSha
  ) {
    validationErrors.push("qa_report_renderer_manifest_sha256_mismatch");
  }
  if (text(renderer.value?.story_id) !== storyId) {
    validationErrors.push("renderer_manifest_story_id_mismatch");
  }
  if (text(renderer.value?.channel_id) !== channelId) {
    validationErrors.push("renderer_manifest_channel_id_mismatch");
  }
  if (
    text(renderer.value?.output?.sha256).toLowerCase() !== finalMp4.sha256
  ) {
    validationErrors.push("renderer_output_media_sha256_mismatch");
  }
  const technical = mediaInspection.technical;
  for (const [key, actual] of [
    ["width", technical.width],
    ["height", technical.height],
    ["video_codec", technical.video_codec],
    ["audio_codec", technical.audio_codec],
    ["audio_sample_rate_hz", technical.audio_sample_rate_hz],
    ["has_audio", technical.has_audio],
    ["duration_seconds", technical.duration_seconds],
  ]) {
    const declared = renderer.value?.output?.[key];
    const matches =
      key === "duration_seconds"
        ? Math.abs(Number(declared) - Number(actual)) <= 0.05
        : String(declared) === String(actual);
    if (!matches) validationErrors.push(`renderer_output_${key}_mismatch`);
  }

  const rendererEvaluation = evaluateRendererManifest(renderer.value, {
    operatingMode: "HUMAN_REVIEW",
  });
  if (
    rendererEvaluation.verdict !== "PASS" ||
    rendererEvaluation.publishable !== true
  ) {
    validationErrors.push(...rendererEvaluation.blockers);
    validationErrors.push("renderer_not_publishable_under_human_review");
  }
  const ownedMotion = validateOwnedMotion({
    bound: ownedMotionBound,
    storyId,
    sourceMedia,
  });
  validateTimestamps({
    bound: timestamps,
    storyId,
    maxDuration: technical.duration_seconds,
  });
  const resolvedInputs = validateRendererInputs({
    manifestDir,
    reviewInputs: manifest.renderer_inputs,
    rendererInputs: renderer.value?.inputs,
    narration,
    timestamps,
    ownedMotion,
    sourceMedia,
    licensedAudio,
    publicationMetadata,
    rightsLedger: rights.value,
    rightsLedgerPath: rights.path,
  });

  const preflightEvidence = {
    schema_version: "pulse-publication-review-evidence-v1",
    story_id: storyId,
    channel_id: channelId,
    script_sha256: expectedScriptSha,
    media_sha256: finalMp4.sha256,
    source_evidence_sha256: source.sha256,
    official_source_release_binding:
      officialSourceReleaseBinding,
    publication_metadata_sha256: publicationMetadata.sha256,
    publication_metadata: {
      path: publicationMetadata.path,
      sha256: publicationMetadata.sha256,
      platform: publicationMetadata.platform,
      title: publicationMetadata.title,
      description: publicationMetadata.description,
    },
    source_media_manifest_sha256:
      sourceMedia?.manifest_sha256 || null,
    ...(licensedAudio
      ? {
          story_intake_sha256:
            licensedAudio.storyIntake.sha256,
          licensed_audio: licensedAudio.evidence,
        }
      : {}),
    policy: {
      source_media_policy: sourceMediaPolicy,
      third_party_media_used:
        manifest.policy.third_party_media_used,
      attribution_required: manifest.policy.attribution_required,
    },
    qa_report_sha256: qaReport.sha256,
    originality_transformation: {
      verdict: text(transformation.value?.verdict).toUpperCase(),
      rationale: text(transformation.value?.rationale),
      evidence_ref: transformation.path,
      evidence_sha256: transformation.sha256,
    },
    rights_ledger: rights.value,
    rights_ledger_sha256: canonicalRightsSha,
    synthetic_media_disclosure:
      manifest.synthetic_media_disclosure,
    renderer_manifest: renderer.value,
    renderer_manifest_sha256: canonicalRendererSha,
    artifact_evidence: {
      final_mp4_exists: true,
      narration_audio_exists: true,
      word_timestamps_exist: true,
      motion_materialised: true,
      hashes_verified: true,
    },
  };
  const publicationAssessment =
    assessPublicationEvidence(preflightEvidence);
  if (!publicationAssessment.eligible) {
    validationErrors.push(...publicationAssessment.blockers);
  }
  if (validationErrors.length) {
    throw new GovernedPublicationReviewError(validationErrors);
  }
  return {
    manifest,
    manifestPath: resolvedManifestPath,
    manifestSha256: sha256Bytes(manifestBytes),
    storyId,
    channelId,
    scriptSha256: expectedScriptSha,
    mediaSha256: finalMp4.sha256,
    finalMp4,
    narration,
    timestamps,
    ownedMotion: {
      ...ownedMotion,
      path: ownedMotionBound.path,
      sha256: ownedMotionBound.sha256,
    },
    publicationMetadata,
    sourceMedia,
    licensedAudio,
    storyIntake: licensedAudio?.storyIntake || null,
    source,
    qaReport,
    transformation,
    rights: {
      ...rights,
      canonicalSha256: canonicalRightsSha,
    },
    renderer: {
      ...renderer,
      canonicalSha256: canonicalRendererSha,
      evaluation: rendererEvaluation,
    },
    rendererInputs: resolvedInputs,
    mediaInspection,
    preflightEvidence,
  };
}

function buildResult({
  validation,
  generatedAt,
  mode,
  verdict,
  mutated = false,
  idempotent = false,
  blockers = [],
  backup = null,
  inspection = null,
} = {}) {
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    generated_at: generatedAt,
    mode,
    verdict,
    mutated,
    idempotent,
    story_id: validation?.storyId || null,
    channel_id: validation?.channelId || null,
    script_sha256: validation?.scriptSha256 || null,
    media_sha256: validation?.mediaSha256 || null,
    review_manifest_sha256: validation?.manifestSha256 || null,
    preflight_evidence: validation?.preflightEvidence || null,
    blockers: unique(blockers),
    backup_evidence: backup,
    database_inspection: inspection,
    safety: {
      lifecycle_admission_performed: false,
      external_calls: [],
      uploads_performed: false,
      oauth_or_tokens_mutated: false,
      platform_objects_created: false,
    },
  };
}

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function tableExists(db, tableName) {
  return !!db
    .prepare(
      `SELECT 1 FROM sqlite_master
       WHERE type = 'table' AND name = ? LIMIT 1`,
    )
    .get(tableName);
}

function inspectStoppedRuntime(db, generatedAt) {
  const blockers = [];
  if (
    tableExists(db, "runtime_leases") &&
    db
      .prepare(
        `SELECT 1 FROM runtime_leases
         WHERE julianday(expires_at) > julianday(?) LIMIT 1`,
      )
      .get(generatedAt)
  ) {
    blockers.push("active_runtime_leases_present");
  }
  if (
    tableExists(db, "jobs") &&
    db
      .prepare(
        `SELECT 1 FROM jobs
         WHERE status IN ('claimed', 'running') LIMIT 1`,
      )
      .get()
  ) {
    blockers.push("running_jobs_present");
  }
  if (
    tableExists(db, "workers") &&
    db
      .prepare(
        `SELECT 1 FROM workers
         WHERE COALESCE(status, '') NOT IN ('offline', 'locked') LIMIT 1`,
      )
      .get()
  ) {
    blockers.push("active_workers_present");
  }
  return blockers;
}

function applyCommandBlockers(options, validation) {
  const blockers = [];
  if (text(options.confirmStoryId) !== validation.storyId) {
    blockers.push("exact_story_confirmation_required");
  }
  const confirmedMedia = text(
    options.confirmMediaSha256,
  ).toLowerCase();
  if (!SHA256_PATTERN.test(confirmedMedia)) {
    blockers.push("exact_media_sha256_confirmation_required");
  } else if (confirmedMedia !== validation.mediaSha256) {
    blockers.push("exact_media_sha256_confirmation_mismatch");
  }
  const confirmedScript = text(
    options.confirmScriptSha256,
  ).toLowerCase();
  if (!SHA256_PATTERN.test(confirmedScript)) {
    blockers.push("exact_script_sha256_confirmation_required");
  } else if (confirmedScript !== validation.scriptSha256) {
    blockers.push("exact_script_sha256_confirmation_mismatch");
  }
  if (!text(options.actorId)) blockers.push("operator_actor_required");
  if (!text(options.reason)) blockers.push("operator_reason_required");
  return blockers;
}

function buildReviewProvenance({
  validation,
  actorId,
  reason,
  generatedAt,
} = {}) {
  const admissionEvidence = stableValue(
    validation.preflightEvidence,
  );
  return {
    schema_version: "pulse-final-publication-review-v1",
    story_id: validation.storyId,
    channel_id: validation.channelId,
    admission_evidence: admissionEvidence,
    admission_evidence_sha256: sha256Bytes(
      Buffer.from(stableJson(admissionEvidence), "utf8"),
    ),
    review_manifest_path: validation.manifestPath,
    review_manifest_sha256: validation.manifestSha256,
    script_sha256: validation.scriptSha256,
    media_sha256: validation.mediaSha256,
    source_evidence: {
      path: validation.source.path,
      sha256: validation.source.sha256,
    },
    qa_report: {
      path: validation.qaReport.path,
      sha256: validation.qaReport.sha256,
      verdict: "PASS",
    },
    transformation_evidence: {
      path: validation.transformation.path,
      sha256: validation.transformation.sha256,
      verdict:
        validation.preflightEvidence.originality_transformation.verdict,
      rationale:
        validation.preflightEvidence.originality_transformation.rationale,
    },
    rights_ledger: {
      path: validation.rights.path,
      file_sha256: validation.rights.sha256,
      canonical_sha256: validation.rights.canonicalSha256,
    },
    renderer_manifest: {
      path: validation.renderer.path,
      file_sha256: validation.renderer.sha256,
      canonical_sha256: validation.renderer.canonicalSha256,
      verdict: validation.renderer.evaluation.verdict,
      publishable_under_human_review:
        validation.renderer.evaluation.publishable === true,
    },
    final_mp4: {
      path: validation.finalMp4.path,
      sha256: validation.finalMp4.sha256,
    },
    narration_audio: {
      path: validation.narration.path,
      sha256: validation.narration.sha256,
      component_id: validation.narration.component_id,
    },
    word_timestamps: {
      path: validation.timestamps.path,
      sha256: validation.timestamps.sha256,
      component_id: validation.timestamps.component_id,
    },
    owned_motion_manifest: {
      path: validation.ownedMotion.path,
      sha256: validation.ownedMotion.sha256,
    },
    publication_metadata: {
      path: validation.publicationMetadata.path,
      sha256: validation.publicationMetadata.sha256,
      platform: validation.publicationMetadata.platform,
    },
    policy: validation.preflightEvidence.policy,
    ...(validation.sourceMedia
      ? {
          source_media_manifest: {
            path: validation.sourceMedia.manifest_path,
            sha256: validation.sourceMedia.manifest_sha256,
            rights_review_path:
              validation.sourceMedia.rights_review.path,
            rights_review_sha256:
              validation.sourceMedia.rights_review.sha256,
          },
        }
      : {}),
    ...(validation.licensedAudio
      ? {
          story_intake: {
            path: validation.storyIntake.path,
            sha256: validation.storyIntake.sha256,
          },
          licensed_audio: validation.licensedAudio.evidence,
        }
      : {}),
    renderer_inputs: validation.rendererInputs.map((input) => ({
      component_id: input.component_id,
      role: input.role,
      path: input.absolutePath,
      sha256: input.sha256,
      embedded_in_final: input.embedded_in_final,
    })),
    ffprobe: validation.mediaInspection.technical,
    reviewed_by: actorId,
    review_reason: reason,
    reviewed_at: generatedAt,
  };
}

function insertAuditIdempotently(db, audit) {
  db.prepare(
    `INSERT OR IGNORE INTO operator_audit_log
       (actor_id, action, target_type, target_id, decision, reason,
        evidence_json, idempotency_key)
     VALUES (?, 'governed_publication_review', 'story', ?,
             'HUMAN_RENDER_APPROVED', ?, ?, ?)`,
  ).run(
    audit.actorId,
    audit.storyId,
    audit.reason,
    JSON.stringify(audit.evidence),
    audit.idempotencyKey,
  );
  return db
    .prepare(
      "SELECT * FROM operator_audit_log WHERE idempotency_key = ?",
    )
    .get(audit.idempotencyKey);
}

function applyReviewTransaction({
  db,
  validation,
  actorId,
  reason,
  generatedAt,
} = {}) {
  const idempotencyKey =
    `governed-publication-review:${validation.storyId}:` +
    `${validation.mediaSha256}:${validation.scriptSha256}:` +
    validation.manifestSha256;
  const story = db
    .prepare("SELECT * FROM stories WHERE id = ?")
    .get(validation.storyId);
  if (!story) {
    throw new GovernedPublicationReviewError("story_not_found");
  }
  const extra = parseJsonObject(story._extra);
  const blockers = [];
  if (text(story.channel_id || "pulse-gaming") !== validation.channelId) {
    blockers.push("story_channel_id_mismatch");
  }
  if (story.approved !== 1 && story.approved !== true) {
    blockers.push("human_script_approval_required");
  }
  if (story.auto_approved !== 0 && story.auto_approved !== false) {
    blockers.push("auto_approved_story_forbidden");
  }
  const actualScriptSha = scriptSha256(story.full_script);
  if (actualScriptSha !== validation.scriptSha256) {
    blockers.push("story_script_sha256_mismatch");
  }
  if (
    text(extra.script_approved_sha256).toLowerCase() !==
    validation.scriptSha256
  ) {
    blockers.push("human_script_approval_hash_mismatch");
  }
  if (
    text(extra.operator_review_status).toLowerCase() !==
    "script_approved"
  ) {
    blockers.push("human_script_approval_evidence_required");
  }
  if (
    !text(extra.script_approved_by) ||
    !text(extra.script_approved_at)
  ) {
    blockers.push("human_script_approval_provenance_required");
  }
  if (
    text(extra.source_evidence_sha256).toLowerCase() !==
    validation.source.sha256
  ) {
    blockers.push("source_evidence_intake_hash_mismatch");
  }
  if (
    text(extra.owned_asset_manifest_sha256).toLowerCase() !==
    validation.ownedMotion.sha256
  ) {
    blockers.push("owned_motion_intake_hash_mismatch");
  }
  if (blockers.length) {
    throw new GovernedPublicationReviewError(blockers);
  }

  const existingAudit = db
    .prepare(
      "SELECT * FROM operator_audit_log WHERE idempotency_key = ?",
    )
    .get(idempotencyKey);
  const existingReview = parseJsonObject(
    extra.final_publication_review,
  );
  if (existingAudit) {
    if (
      extra.render_review_status === "approved" &&
      extra.preflight_evidence?.media_sha256 ===
        validation.mediaSha256 &&
      existingReview.review_manifest_sha256 ===
        validation.manifestSha256 &&
      story.exported_path === validation.finalMp4.path &&
      story.audio_path === validation.narration.path
    ) {
      return { mutated: false, idempotent: true };
    }
    throw new GovernedPublicationReviewError(
      "publication_review_idempotency_conflict",
    );
  }
  if (
    text(story.exported_path) &&
    story.exported_path !== validation.finalMp4.path
  ) {
    throw new GovernedPublicationReviewError(
      "existing_final_render_conflict",
    );
  }
  const provenance = buildReviewProvenance({
    validation,
    actorId,
    reason,
    generatedAt,
  });
  const nextExtra = {
    ...extra,
    render_review_status: "approved",
    preflight_evidence: validation.preflightEvidence,
    final_publication_review: provenance,
  };
  db.prepare(
    `UPDATE stories
     SET exported_path = ?, audio_path = ?, updated_at = ?, _extra = ?
     WHERE id = ?`,
  ).run(
    validation.finalMp4.path,
    validation.narration.path,
    generatedAt,
    JSON.stringify(nextExtra),
    validation.storyId,
  );
  insertAuditIdempotently(db, {
    actorId,
    storyId: validation.storyId,
    reason,
    idempotencyKey,
    evidence: provenance,
  });
  return { mutated: true, idempotent: false };
}

async function executeGovernedPublicationReview(options = {}) {
  const generatedAt = new Date(
    options.generatedAt || new Date(),
  ).toISOString();
  const validation = await validatePublicationReviewManifest({
    manifestPath: options.manifestPath,
    probe: options.probe,
    ffprobePath: options.ffprobePath,
    probeTimeoutMs: options.probeTimeoutMs,
    validationBoundaryAt: generatedAt,
    expectedYoutubeAccountUri:
      options.expectedYoutubeAccountUri,
  });
  if (options.apply !== true) {
    return buildResult({
      validation,
      generatedAt,
      mode: "DRY_RUN",
      verdict: "VALID",
    });
  }
  const commandBlockers = applyCommandBlockers(options, validation);
  const gates = evaluateApplyGates({
    databasePath: options.databasePath,
    backupEvidencePath: options.backupEvidencePath,
    generatedAt,
    env: options.env || process.env,
    DatabaseImpl: options.DatabaseImpl,
  });
  const blockers = unique([...commandBlockers, ...gates.blockers]);
  if (blockers.length) {
    return buildResult({
      validation,
      generatedAt,
      mode: "APPLY",
      verdict: "HOLD",
      blockers,
      backup: gates.backup,
      inspection: gates.inspection,
    });
  }
  const Database = options.DatabaseImpl || require("better-sqlite3");
  const db = new Database(path.resolve(options.databasePath), {
    fileMustExist: true,
  });
  let transactionResult;
  try {
    transactionResult = db.transaction(() => {
      const runtimeBlockers = inspectStoppedRuntime(db, generatedAt);
      if (runtimeBlockers.length) {
        throw new GovernedPublicationReviewError(runtimeBlockers);
      }
      return applyReviewTransaction({
        db,
        validation,
        actorId: text(options.actorId),
        reason: text(options.reason),
        generatedAt,
      });
    }).immediate();
  } catch (error) {
    if (error instanceof GovernedPublicationReviewError) {
      return buildResult({
        validation,
        generatedAt,
        mode: "APPLY",
        verdict: "HOLD",
        blockers: error.codes,
        backup: gates.backup,
        inspection: gates.inspection,
      });
    }
    throw error;
  } finally {
    db.close();
  }
  return buildResult({
    validation,
    generatedAt,
    mode: "APPLY",
    verdict: transactionResult.idempotent
      ? "IDEMPOTENT"
      : "APPLIED",
    mutated: transactionResult.mutated,
    idempotent: transactionResult.idempotent,
    backup: gates.backup,
    inspection: gates.inspection,
  });
}

module.exports = {
  GovernedPublicationReviewError,
  MAX_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
  REVIEW_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION,
  executeGovernedPublicationReview,
  hashFile,
  inspectFinalMedia,
  sha256Bytes,
  stableJson,
  validatePublicationReviewManifest,
};

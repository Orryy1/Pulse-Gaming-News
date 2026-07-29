"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { hashRightsLedger } = require("./publication-evidence-gates");
const {
  ATTRIBUTION_TEXT,
  GovernedSourceMediaError,
  validateGovernedSourceMediaManifest,
} = require("./governed-source-media");
const {
  GovernedPublicationMetadataError,
  validateGovernedPublicationMetadata,
} = require("./governed-publication-metadata");
const {
  GovernedLicensedAudioPackError,
  validateGovernedLicensedAudioPack,
} = require("./governed-licensed-audio-pack");
const {
  POLICY: GOVERNED_GAME_MEDIA_POLICY,
} = require("./governed-game-media-admission");
const {
  fingerprintRendererManifest,
  evaluateRendererManifest,
} = require("../stabilisation/renderer-governance");
const {
  buildOfficialSourceReleaseBinding,
} = require("./official-source-revalidation");
const {
  ControlledExperimentObservationError,
  validateControlledExperimentObservation,
} = require("./controlled-experiment-observation");

const RESULT_SCHEMA = "pulse-governed-publication-evidence-package-result-v1";
const PACKAGE_SCHEMA = "pulse-governed-publication-evidence-package-v1";
const REVIEW_SCHEMA = "pulse-governed-publication-review-v1";
const TRANSFORMATION_SCHEMA = "pulse-transformation-evidence-v1";
const RIGHTS_EVIDENCE_SCHEMA = "pulse-rights-evidence-v1";
const DISCLOSURE_CONFIRMATION = "DISCLOSE_AND_SET_YOUTUBE_TRUE";
const PUBLICATION_PLATFORM = "youtube_shorts";
const PULSE_YOUTUBE_ACCOUNT_URI =
  "https://www.youtube.com/@PulseGMG";
const OWNED_ONLY_SOURCE_MEDIA_POLICY = "OWNED_ONLY";
const LICENSED_SOURCE_MEDIA_POLICY = "LICENSED_OFFICIAL_FFXIV";
const SUPPORTED_SOURCE_MEDIA_POLICIES = new Set([
  OWNED_ONLY_SOURCE_MEDIA_POLICY,
  LICENSED_SOURCE_MEDIA_POLICY,
  GOVERNED_GAME_MEDIA_POLICY,
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

const OUTPUT_NAMES = Object.freeze({
  transformation_evidence: "transformation-evidence.json",
  owned_motion_rights_evidence: "owned-motion-rights-evidence.json",
  source_media_rights_evidence: "source-media-rights-evidence.json",
  narration_rights_evidence: "narration-rights-evidence.json",
  rights_ledger: "rights-ledger.json",
  publication_review: "publication-review.json",
  package_manifest: "governed-publication-evidence-package.json",
  markdown: "governed-publication-evidence-package.md",
});

class GovernedPublicationEvidencePackageError extends Error {
  constructor(codes) {
    const normalised = [
      ...new Set(
        (Array.isArray(codes) ? codes : [codes])
          .map((code) => String(code || "").trim())
          .filter(Boolean),
      ),
    ];
    super(normalised.join(", "));
    this.name = "GovernedPublicationEvidencePackageError";
    this.codes = normalised;
  }
}

function text(value) {
  return String(value || "").trim();
}

function canonicalise(value) {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalise(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalise(value));
}

function serialiseJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashFile(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function normalisePath(value) {
  return String(value).replace(/\\/g, "/");
}

function samePath(left, right) {
  const leftPath = path.resolve(left);
  const rightPath = path.resolve(right);
  return process.platform === "win32"
    ? leftPath.toLowerCase() === rightPath.toLowerCase()
    : leftPath === rightPath;
}

function pathForRecord(baseDir, targetPath) {
  const relative = path.relative(baseDir, targetPath);
  return normalisePath(relative || path.basename(targetPath));
}

function parseJsonBytes(bytes, code) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new GovernedPublicationEvidencePackageError(code);
  }
}

function readRequiredFile(filePath, prefix) {
  const resolvedPath = path.resolve(text(filePath));
  if (
    !filePath ||
    !fs.existsSync(resolvedPath) ||
    !fs.statSync(resolvedPath).isFile()
  ) {
    throw new GovernedPublicationEvidencePackageError(
      `${prefix}_file_required`,
    );
  }
  const bytes = fs.readFileSync(resolvedPath);
  return {
    path: resolvedPath,
    bytes,
    sha256: sha256Bytes(bytes),
  };
}

function readRequiredJson(filePath, prefix) {
  const record = readRequiredFile(filePath, prefix);
  return {
    ...record,
    value: parseJsonBytes(record.bytes, `${prefix}_invalid_json`),
  };
}

function resolveBoundFile({ baseDir, record, prefix, errors }) {
  const recordPath = text(record?.path);
  const expectedSha = text(record?.sha256).toLowerCase();
  if (!recordPath) {
    errors.push(`${prefix}_path_required`);
    return null;
  }
  if (!SHA256_PATTERN.test(expectedSha)) {
    errors.push(`${prefix}_sha256_required`);
  }
  const absolutePath = path.resolve(baseDir, recordPath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    errors.push(`${prefix}_file_required`);
    return {
      path: absolutePath,
      sha256: null,
    };
  }
  const actualSha = hashFile(absolutePath);
  if (actualSha !== expectedSha) {
    errors.push(`${prefix}_sha256_mismatch`);
  }
  return {
    path: absolutePath,
    sha256: actualSha,
  };
}

function expectBoundRecord({
  baseDir,
  record,
  supplied,
  prefix,
  errors,
  shaField = "sha256",
}) {
  const normalised = {
    path: record?.path,
    sha256: record?.[shaField],
  };
  const resolved = resolveBoundFile({
    baseDir,
    record: normalised,
    prefix,
    errors,
  });
  if (
    resolved &&
    (!supplied?.path || !samePath(resolved.path, supplied.path))
  ) {
    errors.push(`${prefix}_path_mismatch`);
  }
  if (
    text(record?.[shaField]).toLowerCase() !==
    text(supplied?.sha256).toLowerCase()
  ) {
    errors.push(`${prefix}_sha256_mismatch`);
  }
}

function validateStory({ intake, source, errors }) {
  if (intake.value?.schema_version !== "pulse-governed-story-intake-v1") {
    errors.push("story_intake_schema_invalid");
  }
  const storyId = text(intake.value?.story?.id);
  const channelId = text(intake.value?.story?.channel_id) || "pulse-gaming";
  const fullScript = text(intake.value?.story?.full_script);
  const scriptSha256 = text(intake.value?.story?.script_sha256).toLowerCase();
  if (!storyId) errors.push("story_id_required");
  if (!channelId) errors.push("channel_id_required");
  if (!fullScript) errors.push("story_script_required");
  if (!SHA256_PATTERN.test(scriptSha256)) {
    errors.push("story_script_sha256_required");
  } else if (sha256Bytes(Buffer.from(fullScript, "utf8")) !== scriptSha256) {
    errors.push("story_script_sha256_mismatch");
  }
  if (
    source.value?.schema_version !== "pulse-source-evidence-v1" ||
    source.value?.source_type !== "official"
  ) {
    errors.push("official_source_evidence_required");
  }
  if (
    text(intake.value?.source_type) !== "official" ||
    text(intake.value?.source_url) !== text(source.value?.source_url)
  ) {
    errors.push("story_intake_source_mismatch");
  }
  expectBoundRecord({
    baseDir: path.dirname(intake.path),
    record: {
      path: intake.value?.source_evidence_path,
      sha256: intake.value?.source_evidence_sha256,
    },
    supplied: source,
    prefix: "source_evidence",
    errors,
  });
  let officialSourceReleaseBinding = null;
  try {
    officialSourceReleaseBinding =
      buildOfficialSourceReleaseBinding({
        storyId,
        sourceEvidenceSha256: source.sha256,
        sourceEvidence: source.value,
      });
  } catch (error) {
    errors.push(
      text(error?.code) ||
        "official_source_release_binding_invalid",
    );
  }
  return {
    storyId,
    channelId,
    fullScript,
    scriptSha256,
    officialSourceReleaseBinding,
  };
}

function validateOptionalSourceMedia({
  options,
  intake,
  story,
  errors,
  validationBoundaryAt,
}) {
  const sourceMediaPolicy = text(
    intake.value?.story?.visual_brief?.source_media_policy,
  );
  const manifestSupplied = Boolean(text(options.sourceMediaManifestPath));
  const hashSupplied = Boolean(text(options.sourceMediaManifestSha256));
  if (!SUPPORTED_SOURCE_MEDIA_POLICIES.has(sourceMediaPolicy)) {
    errors.push("story_intake_source_media_policy_invalid");
    return null;
  }
  if (sourceMediaPolicy === OWNED_ONLY_SOURCE_MEDIA_POLICY) {
    if (manifestSupplied || hashSupplied) {
      errors.push("source_media_forbidden_for_owned_only_policy");
    }
    return null;
  }
  if (manifestSupplied !== hashSupplied) {
    errors.push("source_media_manifest_pair_required");
  }
  if (!manifestSupplied) {
    errors.push("source_media_manifest_path_required");
  }
  if (!hashSupplied) {
    errors.push("source_media_manifest_sha256_required");
  }
  if (!manifestSupplied || !hashSupplied) return null;
  try {
    const sourceMedia = validateGovernedSourceMediaManifest({
      manifestPath: options.sourceMediaManifestPath,
      expectedManifestSha256: options.sourceMediaManifestSha256,
      expectedStoryId: story.storyId,
      validationBoundaryAt,
    });
    if (
      sourceMediaPolicy === GOVERNED_GAME_MEDIA_POLICY &&
      text(sourceMedia?.policy).toUpperCase() !==
        GOVERNED_GAME_MEDIA_POLICY
    ) {
      errors.push("source_media_policy_manifest_mismatch");
      return null;
    }
    return sourceMedia;
  } catch (error) {
    if (error instanceof GovernedSourceMediaError) {
      errors.push(...error.codes);
      return null;
    }
    throw error;
  }
}

function validatePublicationMetadata({
  options,
  story,
  sourceMedia,
  errors,
}) {
  const pathSupplied = Boolean(text(options.publicationMetadataPath));
  const hashSupplied = Boolean(text(options.publicationMetadataSha256));
  if (pathSupplied !== hashSupplied) {
    errors.push("publication_metadata_pair_required");
  }
  if (!pathSupplied) {
    errors.push("publication_metadata_path_required");
  }
  if (!hashSupplied) {
    errors.push("publication_metadata_sha256_required");
  }
  if (!pathSupplied || !hashSupplied) return null;
  const requiredDescriptionAttributions = sourceMedia
    ? sourceMedia.components
        .filter((component) =>
          component.attribution.delivery.includes("DESCRIPTION"),
        )
        .map((component) => component.attribution.text)
    : [];
  try {
    return validateGovernedPublicationMetadata({
      metadataPath: options.publicationMetadataPath,
      expectedMetadataSha256: options.publicationMetadataSha256,
      expectedStoryId: story.storyId,
      expectedChannelId: story.channelId,
      expectedPlatform: PUBLICATION_PLATFORM,
      requiredDescriptionAttributions,
    });
  } catch (error) {
    if (error instanceof GovernedPublicationMetadataError) {
      errors.push(...error.codes);
      return null;
    }
    throw error;
  }
}

function validateOptionalControlledExperimentObservation({
  options,
  story,
  intake,
  narrationManifest,
  renderer,
  rendererValidation,
  qa,
  finalMp4,
  errors,
}) {
  const pathSupplied = Boolean(
    text(options.controlledExperimentObservationPath),
  );
  const hashSupplied = Boolean(
    text(options.controlledExperimentObservationFileSha256),
  );
  if (!pathSupplied && !hashSupplied) return null;
  if (pathSupplied !== hashSupplied) {
    errors.push("controlled_experiment_observation_pair_required");
    return null;
  }
  const observationFile = readRequiredJson(
    options.controlledExperimentObservationPath,
    "controlled_experiment_observation",
  );
  const expectedFileSha256 = text(
    options.controlledExperimentObservationFileSha256,
  ).toLowerCase();
  if (!SHA256_PATTERN.test(expectedFileSha256)) {
    errors.push(
      "controlled_experiment_observation_file_sha256_required",
    );
  } else if (observationFile.sha256 !== expectedFileSha256) {
    errors.push(
      "controlled_experiment_observation_file_sha256_mismatch",
    );
  }
  try {
    const validation = validateControlledExperimentObservation(
      observationFile.value,
      {
        expectedIdentity: {
          story_id: story.storyId,
          channel_id: story.channelId,
        },
        expectedBindings: {
          story_intake_sha256: intake.sha256,
          narration_manifest_sha256: narrationManifest.sha256,
          renderer_manifest_file_sha256: renderer.sha256,
          renderer_manifest_canonical_sha256:
            rendererValidation.canonicalSha256,
          qa_report_sha256: qa.sha256,
          media_sha256: finalMp4.sha256,
          script_sha256: story.scriptSha256,
        },
      },
    );
    return {
      path: observationFile.path,
      file_sha256: observationFile.sha256,
      observation_sha256: validation.sha256,
      eligible: validation.observation.experiment.eligible,
      observation: validation.observation,
    };
  } catch (error) {
    if (error instanceof ControlledExperimentObservationError) {
      errors.push(error.code);
      return null;
    }
    throw error;
  }
}

function validateOptionalLicensedAudio({
  options,
  intake,
  story,
  narration,
  rendererValidation,
  validationBoundaryAt,
  validateLicensedAudioPack,
  errors,
}) {
  const optionGroup = [
    options.licensedAudioPackPath,
    options.expectedLicensedAudioPackSha256,
    options.expectedLicensedAudioRightsLedgerSha256,
    options.expectedYoutubeAccountUri,
  ];
  const suppliedCount = optionGroup.filter((value) => text(value)).length;
  if (suppliedCount === 0) return null;
  if (suppliedCount !== optionGroup.length) {
    errors.push("licensed_audio_option_group_incomplete");
    return null;
  }
  if (
    text(options.expectedYoutubeAccountUri) !==
    PULSE_YOUTUBE_ACCOUNT_URI
  ) {
    errors.push("licensed_audio_youtube_account_uri_invalid");
    return null;
  }
  const targetDurationSeconds = Number(
    intake.value?.contract?.target_duration_seconds,
  );
  if (
    !Number.isFinite(targetDurationSeconds) ||
    targetDurationSeconds <= 0 ||
    targetDurationSeconds > 59
  ) {
    errors.push("licensed_audio_story_target_duration_required");
    return null;
  }
  try {
    return validateLicensedAudioPack({
      manifestPath: options.licensedAudioPackPath,
      expectedManifestSha256:
        options.expectedLicensedAudioPackSha256,
      expectedStoryId: story.storyId,
      expectedChannelId: story.channelId,
      expectedNarrationSha256: narration.audio?.sha256,
      expectedTimestampsSha256:
        rendererValidation.timestampLineage?.source_sha256,
      expectedTargetDurationSeconds: targetDurationSeconds,
      expectedRightsLedgerSha256:
        options.expectedLicensedAudioRightsLedgerSha256,
      expectedYoutubeAccountUri: PULSE_YOUTUBE_ACCOUNT_URI,
      requiredDestination: "YOUTUBE_SHORTS",
      requiredRevenueMode: "PLATFORM_ADVERTISING",
      validationBoundaryAt,
    });
  } catch (error) {
    if (error instanceof GovernedLicensedAudioPackError) {
      errors.push(...error.codes);
      return null;
    }
    throw error;
  }
}

function validateLicensedAudioRendererInputs({
  licensedAudio,
  rendererValidation,
  errors,
}) {
  const actualInputs = rendererValidation.inputs
    .filter((input) => input.role === "music" || input.role === "sfx")
    .map((input) => ({
      component_id: input.componentId,
      role: input.role,
      path: input.absolutePath,
      sha256: input.sha256,
      embedded_in_final: input.raw?.embedded_in_final === true,
    }))
    .sort((left, right) =>
      left.component_id.localeCompare(right.component_id),
    );
  if (!licensedAudio) {
    if (actualInputs.length) {
      errors.push("renderer_licensed_audio_pack_required");
    }
    return actualInputs;
  }
  const expectedInputs = licensedAudio.assets
    .map((asset) => ({
      component_id: asset.asset_id,
      role: asset.role === "MUSIC_BED" ? "music" : "sfx",
      path: asset.path,
      sha256: asset.sha256,
      embedded_in_final: true,
    }))
    .sort((left, right) =>
      left.component_id.localeCompare(right.component_id),
    );
  if (stableJson(actualInputs) !== stableJson(expectedInputs)) {
    errors.push("renderer_licensed_audio_inputs_mismatch");
  }
  return actualInputs;
}

function validateLicensedAudioEvidence({
  evidence,
  baseDir,
  licensedAudio,
  prefix,
  errors,
}) {
  if (
    !evidence ||
    typeof evidence !== "object" ||
    Array.isArray(evidence)
  ) {
    errors.push(`${prefix}_required`);
    return;
  }
  if (text(evidence.policy) !== licensedAudio.policy) {
    errors.push(`${prefix}_policy_mismatch`);
  }
  expectBoundRecord({
    baseDir,
    record: evidence.manifest,
    supplied: {
      path: licensedAudio.manifest_path,
      sha256: licensedAudio.manifest_sha256,
    },
    prefix: `${prefix}_manifest`,
    errors,
  });
  expectBoundRecord({
    baseDir,
    record: evidence.rights_ledger,
    supplied: licensedAudio.rights_ledger,
    prefix: `${prefix}_rights_ledger`,
    errors,
  });
  for (const field of ["provider", "scope", "render_binding", "mix"]) {
    if (stableJson(evidence[field]) !== stableJson(licensedAudio[field])) {
      errors.push(`${prefix}_${field}_mismatch`);
    }
  }
  const rawAssets = Array.isArray(evidence.assets)
    ? evidence.assets
    : [];
  if (rawAssets.length !== licensedAudio.assets.length) {
    errors.push(`${prefix}_asset_coverage_mismatch`);
  }
  const seen = new Set();
  for (const expectedAsset of licensedAudio.assets) {
    const raw = rawAssets.find(
      (asset) => text(asset?.asset_id) === expectedAsset.asset_id,
    );
    if (!raw || seen.has(expectedAsset.asset_id)) {
      errors.push(`${prefix}_asset_coverage_mismatch`);
      continue;
    }
    seen.add(expectedAsset.asset_id);
    const expectedRendererRole =
      expectedAsset.role === "MUSIC_BED" ? "music" : "sfx";
    if (
      text(raw.source_role) !== expectedAsset.role ||
      text(raw.renderer_role) !== expectedRendererRole ||
      text(raw.sha256).toLowerCase() !== expectedAsset.sha256 ||
      Number(raw.size_bytes) !== expectedAsset.size_bytes ||
      text(raw.provider_asset_reference) !==
        expectedAsset.provider_asset_reference ||
      text(raw.rights_record_sha256).toLowerCase() !==
        expectedAsset.rights_record_sha256 ||
      raw.embedded_in_final !== true
    ) {
      errors.push(`${prefix}_asset_binding_mismatch`);
    }
    expectBoundRecord({
      baseDir,
      record: raw,
      supplied: {
        path: expectedAsset.path,
        sha256: expectedAsset.sha256,
      },
      prefix: `${prefix}_asset_${expectedAsset.asset_id}`,
      errors,
    });
    expectBoundRecord({
      baseDir,
      record: raw.rights_evidence,
      supplied: {
        path: expectedAsset.rights_evidence_path,
        sha256: expectedAsset.rights_evidence_sha256,
      },
      prefix: `${prefix}_asset_${expectedAsset.asset_id}_rights_evidence`,
      errors,
    });
  }
}

function validateOwnedMotion({
  ownedMotion,
  story,
  sourceMedia,
  errors,
}) {
  const manifest = ownedMotion.value;
  if (manifest?.schema_version !== "pulse-owned-motion-manifest-v1") {
    errors.push("owned_motion_manifest_schema_invalid");
  }
  if (text(manifest?.story_id) !== story.storyId) {
    errors.push("owned_motion_manifest_story_id_mismatch");
  }
  const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];
  if (!assets.length) {
    errors.push("owned_motion_assets_required");
  }
  const resolvedAssets = assets.map((asset, index) => {
    const resolved = resolveBoundFile({
      baseDir: path.dirname(ownedMotion.path),
      record: asset,
      prefix: `owned_motion_asset_${index}`,
      errors,
    });
    const isBoundMixedIntermediate =
      Boolean(sourceMedia) &&
      text(asset?.role) === "hyperframes_intermediate";
    if (isBoundMixedIntermediate) {
      if (
        text(asset?.ownership).toLowerCase() !== "mixed" ||
        text(asset?.rights_basis).toUpperCase() !== "LICENSED"
      ) {
        errors.push("mixed_motion_rights_basis_invalid");
      }
      if (asset?.attribution_required !== true) {
        errors.push("mixed_motion_attribution_required");
      }
      if (asset?.provenance?.third_party_media_used !== true) {
        errors.push("mixed_motion_third_party_media_required");
      }
      expectBoundRecord({
        baseDir: path.dirname(ownedMotion.path),
        record: asset?.provenance?.source_media_manifest,
        supplied: {
          path: sourceMedia.manifest_path,
          sha256: sourceMedia.manifest_sha256,
        },
        prefix: "mixed_motion_source_media_manifest",
        errors,
      });
    } else {
      if (
        text(asset?.ownership).toLowerCase() !== "owned" ||
        text(asset?.rights_basis).toUpperCase() !== "OWNED"
      ) {
        errors.push("owned_motion_rights_basis_invalid");
      }
      if (asset?.attribution_required !== false) {
        errors.push("owned_motion_attribution_must_not_be_required");
      }
      if (asset?.provenance?.third_party_media_used !== false) {
        errors.push("third_party_media_forbidden");
      }
    }
    return {
      ...asset,
      mixedLicensedIntermediate: isBoundMixedIntermediate,
      absolutePath: resolved?.path || null,
      verifiedSha256: resolved?.sha256 || null,
    };
  });
  return resolvedAssets;
}

function validateNarration({ narrationManifest, story, errors }) {
  const manifest = narrationManifest.value;
  if (manifest?.schema_version !== "pulse-governed-narration-manifest-v1") {
    errors.push("governed_narration_manifest_schema_invalid");
  }
  if (text(manifest?.story_id) !== story.storyId) {
    errors.push("governed_narration_story_id_mismatch");
  }
  if (
    text(manifest?.script?.sha256).toLowerCase() !== story.scriptSha256 ||
    text(manifest?.script?.aligned_text_sha256).toLowerCase() !==
      story.scriptSha256 ||
    manifest?.script?.exact_alignment_match !== true
  ) {
    errors.push("governed_narration_script_binding_invalid");
  }
  const licence = manifest?.licence || {};
  if (
    text(licence.rights_basis).toUpperCase() !== "LICENSED" ||
    !text(licence.evidence_reference) ||
    !text(licence.attested_by) ||
    Number.isNaN(new Date(licence.attested_at).getTime()) ||
    !text(licence.evidence_scope)
  ) {
    errors.push("governed_narration_licence_invalid");
  }
  const controls = manifest?.controls || {};
  for (const [key, expected] of [
    ["operating_mode", "HUMAN_REVIEW"],
    ["emergency_kill_switch_tripped", true],
    ["auto_publish_enabled", false],
    ["live_dispatch_enabled", false],
    ["external_publish_authorised", false],
    ["database_mutation_authorised", false],
    ["oauth_mutation_authorised", false],
    ["network_used", false],
  ]) {
    if (controls[key] !== expected) {
      errors.push(`governed_narration_control_${key}_invalid`);
    }
  }
  const audioRecord = manifest?.sources?.audio || {};
  const audio = resolveBoundFile({
    baseDir: path.dirname(narrationManifest.path),
    record: {
      path: audioRecord.path,
      sha256: audioRecord.post_apply_sha256,
    },
    prefix: "governed_narration_audio",
    errors,
  });
  const actualAudioSha = audio?.sha256;
  for (const key of [
    "expected_sha256",
    "pre_apply_sha256",
    "post_apply_sha256",
  ]) {
    if (text(audioRecord[key]).toLowerCase() !== actualAudioSha) {
      errors.push(`governed_narration_audio_${key}_mismatch`);
    }
  }
  const timestampRecord = manifest?.outputs?.word_timestamps || {};
  const timestamps = resolveBoundFile({
    baseDir: path.dirname(narrationManifest.path),
    record: timestampRecord,
    prefix: "governed_narration_word_timestamps",
    errors,
  });
  return {
    audio,
    timestamps,
    licence,
    durationSeconds: Number(manifest?.narration?.duration_seconds),
  };
}

function readTimestampValue(record, prefix, errors) {
  const filePath = record?.path || record?.absolutePath;
  if (
    !filePath ||
    !fs.existsSync(filePath) ||
    !fs.statSync(filePath).isFile()
  ) {
    errors.push(`${prefix}_file_required`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    errors.push(`${prefix}_invalid_json`);
    return null;
  }
}

function validateTimestampPayload({
  value,
  prefix,
  story,
  narration,
  requireTranscript,
  errors,
}) {
  if (
    value?.schema_version !== "pulse-word-timestamps-v1" ||
    text(value?.story_id) !== story.storyId
  ) {
    errors.push(`${prefix}_schema_invalid`);
  }
  if (text(value?.script_sha256).toLowerCase() !== story.scriptSha256) {
    errors.push(`${prefix}_script_sha256_mismatch`);
  }
  if (!SHA256_PATTERN.test(text(value?.source_alignment_sha256))) {
    errors.push(`${prefix}_source_alignment_sha256_required`);
  }
  if (text(value?.audio_sha256).toLowerCase() !== narration.audio?.sha256) {
    errors.push(`${prefix}_audio_sha256_mismatch`);
  }
  if (
    !Number.isFinite(Number(value?.audio_duration_seconds)) ||
    Math.abs(
      Number(value?.audio_duration_seconds) - narration.durationSeconds,
    ) > 0.05
  ) {
    errors.push(`${prefix}_audio_duration_mismatch`);
  }
  const words = Array.isArray(value?.words) ? value.words : [];
  if (!words.length || Number(value?.word_count) !== words.length) {
    errors.push(`${prefix}_word_count_mismatch`);
  }
  if (
    requireTranscript &&
    sha256Bytes(Buffer.from(text(value?.transcript), "utf8")) !==
      story.scriptSha256
  ) {
    errors.push(`${prefix}_transcript_mismatch`);
  }
}

function validateRendererTimestampLineage({
  timestampInput,
  narration,
  story,
  errors,
}) {
  const sourceRecord = narration.timestamps;
  if (
    !timestampInput?.absolutePath ||
    !timestampInput?.sha256 ||
    !sourceRecord?.path ||
    !sourceRecord?.sha256
  ) {
    errors.push("renderer_word_timestamps_binding_invalid");
    return {
      mode: "INVALID",
      source_path: sourceRecord?.path || null,
      source_sha256: sourceRecord?.sha256 || null,
      normalised_path: timestampInput?.absolutePath || null,
      normalised_sha256: timestampInput?.sha256 || null,
    };
  }
  const direct =
    samePath(timestampInput.absolutePath, sourceRecord.path) &&
    timestampInput.sha256 === sourceRecord.sha256;
  const normalisedValue = readTimestampValue(
    timestampInput,
    "renderer_word_timestamps",
    errors,
  );
  const sourceValue = direct
    ? normalisedValue
    : readTimestampValue(
        sourceRecord,
        "governed_source_word_timestamps",
        errors,
      );
  validateTimestampPayload({
    value: normalisedValue,
    prefix: "renderer_word_timestamps",
    story,
    narration,
    requireTranscript: !direct,
    errors,
  });
  if (!direct) {
    validateTimestampPayload({
      value: sourceValue,
      prefix: "governed_source_word_timestamps",
      story,
      narration,
      requireTranscript: false,
      errors,
    });
    const sourceBinding = resolveBoundFile({
      baseDir: path.dirname(timestampInput.absolutePath),
      record: normalisedValue?.source,
      prefix: "normalised_word_timestamps_source",
      errors,
    });
    if (
      !sourceBinding?.path ||
      !samePath(sourceBinding.path, sourceRecord.path)
    ) {
      errors.push("normalised_word_timestamps_source_path_mismatch");
    }
    if (
      text(normalisedValue?.source?.sha256).toLowerCase() !==
      sourceRecord.sha256
    ) {
      errors.push("normalised_word_timestamps_source_sha256_mismatch");
    }
    for (const field of [
      "script_sha256",
      "source_alignment_sha256",
      "audio_sha256",
      "audio_duration_seconds",
      "word_count",
    ]) {
      if (
        stableJson(normalisedValue?.[field]) !==
        stableJson(sourceValue?.[field])
      ) {
        errors.push(`normalised_word_timestamps_${field}_lineage_mismatch`);
      }
    }
    if (stableJson(normalisedValue?.words) !== stableJson(sourceValue?.words)) {
      errors.push("normalised_word_timestamps_words_lineage_mismatch");
    }
  }
  return {
    mode: direct ? "DIRECT" : "NORMALISED_DERIVATIVE",
    source_path: sourceRecord.path,
    source_sha256: sourceRecord.sha256,
    normalised_path: timestampInput.absolutePath,
    normalised_sha256: timestampInput.sha256,
  };
}

function validateRenderer({
  renderer,
  story,
  finalMp4,
  ownedAssets,
  sourceMedia,
  narration,
  errors,
}) {
  const manifest = renderer.value;
  if (manifest?.schema_version !== "pulse-render-manifest-v1") {
    errors.push("renderer_manifest_schema_invalid");
  }
  if (text(manifest?.story_id) !== story.storyId) {
    errors.push("renderer_manifest_story_id_mismatch");
  }
  if (text(manifest?.channel_id) !== story.channelId) {
    errors.push("renderer_manifest_channel_id_mismatch");
  }
  const canonicalSha256 = fingerprintRendererManifest(manifest);
  const evaluation = evaluateRendererManifest(manifest, {
    operatingMode: "HUMAN_REVIEW",
  });
  if (evaluation.verdict !== "PASS" || evaluation.publishable !== true) {
    errors.push(...evaluation.blockers);
    errors.push("renderer_not_publishable_under_human_review");
  }
  if (text(manifest?.output?.sha256).toLowerCase() !== finalMp4.sha256) {
    errors.push("renderer_output_media_sha256_mismatch");
  }
  const rawInputs = Array.isArray(manifest?.inputs) ? manifest.inputs : [];
  if (!rawInputs.length) errors.push("renderer_inputs_required");
  const ids = new Set();
  const inputs = rawInputs.map((input, index) => {
    const componentId = text(input?.component_id);
    if (!componentId) {
      errors.push("renderer_input_component_id_required");
    } else if (ids.has(componentId)) {
      errors.push("renderer_input_component_id_duplicate");
    }
    ids.add(componentId);
    const resolved = resolveBoundFile({
      baseDir: path.dirname(renderer.path),
      record: input,
      prefix: `renderer_input_${componentId || index}`,
      errors,
    });
    return {
      raw: input,
      componentId,
      role: text(input?.role),
      absolutePath: resolved?.path || null,
      sha256: resolved?.sha256 || null,
    };
  });
  const motionInputs = inputs.filter((input) => input.role === "motion");
  const narrationInputs = inputs.filter((input) => input.role === "narration");
  const timestampInputs = inputs.filter(
    (input) => input.role === "word_timestamps",
  );
  const sourceMediaInputs = inputs.filter(
    (input) => input.role === "source_media",
  );
  if (motionInputs.length !== 1) {
    errors.push("exactly_one_motion_renderer_input_required");
  }
  if (narrationInputs.length !== 1) {
    errors.push("exactly_one_narration_renderer_input_required");
  }
  if (timestampInputs.length !== 1) {
    errors.push("exactly_one_word_timestamps_renderer_input_required");
  }
  const motion = motionInputs[0];
  const ownedAsset = motion
    ? ownedAssets.find(
        (asset) =>
          asset.media_type === "video" &&
          asset.role === "hyperframes_intermediate" &&
          asset.absolutePath &&
          samePath(asset.absolutePath, motion.absolutePath) &&
          asset.verifiedSha256 === motion.sha256,
      )
    : null;
  if (!ownedAsset) {
    errors.push("renderer_motion_not_in_owned_manifest");
  }
  if (sourceMedia) {
    const expectedSourceMedia = sourceMedia.components
      .map((component) => ({
        componentId: component.component_id,
        absolutePath: component.asset.path,
        sha256: component.asset.sha256,
      }))
      .sort((left, right) =>
        left.componentId.localeCompare(right.componentId),
      );
    const actualSourceMedia = sourceMediaInputs
      .map((input) => ({
        componentId: input.componentId,
        absolutePath: input.absolutePath,
        sha256: input.sha256,
      }))
      .sort((left, right) =>
        left.componentId.localeCompare(right.componentId),
      );
    if (stableJson(actualSourceMedia) !== stableJson(expectedSourceMedia)) {
      errors.push("renderer_source_media_inputs_mismatch");
    }
  } else if (sourceMediaInputs.length) {
    errors.push("renderer_source_media_manifest_required");
  }
  const narrationInput = narrationInputs[0];
  if (
    !narrationInput ||
    !narration.audio?.path ||
    !samePath(narrationInput.absolutePath, narration.audio.path) ||
    narrationInput.sha256 !== narration.audio.sha256
  ) {
    errors.push("renderer_narration_binding_invalid");
  }
  const timestampInput = timestampInputs[0];
  const timestampLineage = validateRendererTimestampLineage({
    timestampInput,
    narration,
    story,
    errors,
  });
  if (
    motion?.raw?.embedded_in_final !== true ||
    narrationInput?.raw?.embedded_in_final !== true ||
    timestampInput?.raw?.embedded_in_final !== false ||
    sourceMediaInputs.some(
      (input) => input.raw?.embedded_in_final !== true,
    )
  ) {
    errors.push("renderer_input_embedding_flags_invalid");
  }
  return {
    canonicalSha256,
    evaluation,
    inputs,
    rawInputs,
    motion,
    ownedAsset,
    narrationInput,
    timestampInput,
    sourceMediaInputs,
    timestampLineage,
  };
}

function validateCompositeAndQa({
  composite,
  renderer,
  qa,
  intake,
  ownedMotion,
  narrationManifest,
  narration,
  sourceMedia,
  licensedAudio,
  controlledExperimentObservation,
  story,
  rendererValidation,
  finalMp4,
  errors,
}) {
  const manifest = composite.value;
  if (manifest?.schema_version !== "pulse-governed-final-composite-v1") {
    errors.push("final_composite_manifest_schema_invalid");
  }
  if (
    text(manifest?.story_id) !== story.storyId ||
    text(manifest?.channel_id) !== story.channelId
  ) {
    errors.push("final_composite_identity_mismatch");
  }
  if (text(manifest?.script_sha256).toLowerCase() !== story.scriptSha256) {
    errors.push("final_composite_script_sha256_mismatch");
  }
  if (
    text(manifest?.mode).toUpperCase() !== "LOCAL_PROOF" ||
    text(manifest?.verdict).toUpperCase() !== "MATERIALIZED_LOCAL_PROOF" ||
    text(manifest?.renderer_identity) !== "studio-v21"
  ) {
    errors.push("final_composite_governance_state_invalid");
  }
  for (const [key, expected] of [
    ["publish_authorised", false],
    ["human_visual_review_required", true],
  ]) {
    if (manifest?.[key] !== expected) {
      errors.push(`final_composite_${key}_invalid`);
    }
  }
  const licensedAudioUsed = Boolean(licensedAudio);
  if (
    manifest?.ffmpeg?.background_music_used !== licensedAudioUsed
  ) {
    errors.push(
      licensedAudioUsed
        ? "composite_background_music_required"
        : "composite_background_music_must_be_false",
    );
  }
  if (manifest?.ffmpeg?.sound_effects_used !== licensedAudioUsed) {
    errors.push(
      licensedAudioUsed
        ? "composite_sound_effects_required"
        : "composite_sound_effects_must_be_false",
    );
  }
  expectBoundRecord({
    baseDir: path.dirname(composite.path),
    record: manifest?.inputs?.story_intake,
    supplied: intake,
    prefix: "story_intake",
    errors,
  });
  if (licensedAudio) {
    expectBoundRecord({
      baseDir: path.dirname(composite.path),
      record: manifest?.inputs?.licensed_audio_pack,
      supplied: {
        path: licensedAudio.manifest_path,
        sha256: licensedAudio.manifest_sha256,
      },
      prefix: "licensed_audio_pack",
      errors,
    });
    expectBoundRecord({
      baseDir: path.dirname(composite.path),
      record: manifest?.inputs?.licensed_audio_rights_ledger,
      supplied: licensedAudio.rights_ledger,
      prefix: "licensed_audio_rights_ledger",
      errors,
    });
    validateLicensedAudioEvidence({
      evidence: manifest?.licensed_audio,
      baseDir: path.dirname(composite.path),
      licensedAudio,
      prefix: "composite_licensed_audio",
      errors,
    });
    const targetDurationSeconds =
      licensedAudio.render_binding.target_duration_seconds;
    if (
      Math.abs(
        Number(manifest?.ffmpeg?.duration_seconds) -
          targetDurationSeconds,
      ) > 0.001 ||
      Math.abs(
        Number(renderer.value?.output?.duration_seconds) -
          targetDurationSeconds,
      ) > 0.001
    ) {
      errors.push("licensed_audio_composite_duration_mismatch");
    }
  } else if (
    manifest?.licensed_audio ||
    manifest?.inputs?.licensed_audio_pack ||
    manifest?.inputs?.licensed_audio_rights_ledger
  ) {
    errors.push("composite_licensed_audio_must_be_absent");
  }
  if (sourceMedia) {
    expectBoundRecord({
      baseDir: path.dirname(composite.path),
      record: manifest?.inputs?.source_media_manifest,
      supplied: {
        path: sourceMedia.manifest_path,
        sha256: sourceMedia.manifest_sha256,
      },
      prefix: "source_media_manifest",
      errors,
    });
    expectBoundRecord({
      baseDir: path.dirname(composite.path),
      record: manifest?.source_media?.manifest,
      supplied: {
        path: sourceMedia.manifest_path,
        sha256: sourceMedia.manifest_sha256,
      },
      prefix: "composite_source_media_manifest",
      errors,
    });
    expectBoundRecord({
      baseDir: path.dirname(composite.path),
      record: manifest?.source_media?.rights_review,
      supplied: {
        path: sourceMedia.rights_review.path,
        sha256: sourceMedia.rights_review.sha256,
      },
      prefix: "composite_source_media_rights_review",
      errors,
    });
    if (
      text(manifest?.source_media?.policy).toUpperCase() !==
        text(
          intake.value?.story?.visual_brief?.source_media_policy,
        ).toUpperCase() ||
      manifest?.hyperframes?.third_party_media_used !== true
    ) {
      errors.push("final_composite_source_media_policy_invalid");
    }
    const declaredComponents = Array.isArray(
      manifest?.source_media?.components,
    )
      ? manifest.source_media.components
          .map((component) => ({
            component_id: text(component?.component_id),
            path: path.resolve(
              path.dirname(composite.path),
              text(component?.path),
            ),
            sha256: text(component?.sha256).toLowerCase(),
            attribution_required:
              component?.attribution?.required === true,
            attribution_text: text(
              component?.attribution?.text,
            ),
          }))
          .sort((left, right) =>
            left.component_id.localeCompare(right.component_id),
          )
      : [];
    const expectedComponents = sourceMedia.components
      .map((component) => ({
        component_id: component.component_id,
        path: component.asset.path,
        sha256: component.asset.sha256,
        attribution_required:
          component.attribution?.required === true,
        attribution_text: text(component.attribution?.text),
      }))
      .sort((left, right) =>
        left.component_id.localeCompare(right.component_id),
      );
    if (
      stableJson(declaredComponents) !== stableJson(expectedComponents)
    ) {
      errors.push("final_composite_source_media_components_mismatch");
    }
  } else if (manifest?.inputs?.source_media_manifest) {
    errors.push("source_media_manifest_option_required");
  }
  if (controlledExperimentObservation) {
    const expectedObservationRecord = {
      path: controlledExperimentObservation.path,
      sha256: controlledExperimentObservation.file_sha256,
    };
    expectBoundRecord({
      baseDir: path.dirname(composite.path),
      record: {
        path:
          manifest?.inputs?.controlled_experiment_observation
            ?.path,
        sha256:
          manifest?.inputs?.controlled_experiment_observation
            ?.file_sha256,
      },
      supplied: expectedObservationRecord,
      prefix: "composite_controlled_experiment_observation",
      errors,
    });
    expectBoundRecord({
      baseDir: path.dirname(composite.path),
      record: {
        path: manifest?.controlled_experiment_observation?.path,
        sha256:
          manifest?.controlled_experiment_observation
            ?.file_sha256,
      },
      supplied: expectedObservationRecord,
      prefix:
        "final_composite_controlled_experiment_observation",
      errors,
    });
    for (const [record, prefix] of [
      [
        manifest?.inputs?.controlled_experiment_observation,
        "composite_controlled_experiment_observation",
      ],
      [
        manifest?.controlled_experiment_observation,
        "final_composite_controlled_experiment_observation",
      ],
    ]) {
      if (
        text(record?.observation_sha256).toLowerCase() !==
        controlledExperimentObservation.observation_sha256
      ) {
        errors.push(`${prefix}_self_sha256_mismatch`);
      }
      if (
        record?.eligible !==
        controlledExperimentObservation.eligible
      ) {
        errors.push(`${prefix}_eligibility_mismatch`);
      }
    }
  } else if (
    manifest?.controlled_experiment_observation ||
    manifest?.inputs?.controlled_experiment_observation
  ) {
    errors.push(
      "controlled_experiment_observation_option_required",
    );
  }
  expectBoundRecord({
    baseDir: path.dirname(composite.path),
    record: manifest?.inputs?.owned_motion_manifest,
    supplied: ownedMotion,
    prefix: "owned_motion_manifest",
    errors,
  });
  expectBoundRecord({
    baseDir: path.dirname(composite.path),
    record: manifest?.inputs?.hyperframes_intermediate,
    supplied: {
      path: rendererValidation.motion?.absolutePath,
      sha256: rendererValidation.motion?.sha256,
    },
    prefix: "hyperframes_intermediate",
    errors,
  });
  expectBoundRecord({
    baseDir: path.dirname(composite.path),
    record: manifest?.inputs?.narration_audio,
    supplied: {
      path: rendererValidation.narrationInput?.absolutePath,
      sha256: rendererValidation.narrationInput?.sha256,
    },
    prefix: "narration_audio",
    errors,
  });
  expectBoundRecord({
    baseDir: path.dirname(composite.path),
    record: manifest?.inputs?.word_timestamps,
    supplied: {
      path: rendererValidation.timestampInput?.absolutePath,
      sha256: rendererValidation.timestampInput?.sha256,
    },
    prefix: "word_timestamps",
    errors,
  });
  expectBoundRecord({
    baseDir: path.dirname(composite.path),
    record: manifest?.renderer_manifest,
    supplied: renderer,
    prefix: "renderer_manifest",
    errors,
    shaField: "file_sha256",
  });
  if (
    text(manifest?.renderer_manifest?.canonical_sha256).toLowerCase() !==
    rendererValidation.canonicalSha256
  ) {
    errors.push("final_composite_renderer_canonical_sha256_mismatch");
  }
  expectBoundRecord({
    baseDir: path.dirname(composite.path),
    record: manifest?.qa_report,
    supplied: qa,
    prefix: "qa_report",
    errors,
  });
  expectBoundRecord({
    baseDir: path.dirname(composite.path),
    record: manifest?.output,
    supplied: finalMp4,
    prefix: "final_mp4",
    errors,
  });
  const qaValue = qa.value;
  if (
    qaValue?.schema_version !== "pulse-final-render-qa-v1" ||
    text(qaValue?.verdict).toUpperCase() !== "PASS"
  ) {
    errors.push("qa_pass_report_required");
  }
  if (
    text(qaValue?.story_id) !== story.storyId ||
    text(qaValue?.channel_id) !== story.channelId
  ) {
    errors.push("qa_identity_mismatch");
  }
  if (text(qaValue?.media_sha256).toLowerCase() !== finalMp4.sha256) {
    errors.push("qa_media_sha256_mismatch");
  }
  if (text(qaValue?.script_sha256).toLowerCase() !== story.scriptSha256) {
    errors.push("qa_script_sha256_mismatch");
  }
  if (
    text(qaValue?.renderer_manifest_sha256).toLowerCase() !==
    rendererValidation.canonicalSha256
  ) {
    errors.push("qa_renderer_manifest_sha256_mismatch");
  }
  if (
    qaValue?.audio?.background_music_used !== licensedAudioUsed
  ) {
    errors.push(
      licensedAudioUsed
        ? "qa_background_music_required"
        : "qa_background_music_must_be_false",
    );
  }
  if (
    qaValue?.audio?.sound_effects_used !== licensedAudioUsed
  ) {
    errors.push(
      licensedAudioUsed
        ? "qa_sound_effects_required"
        : "qa_sound_effects_must_be_false",
    );
  }
  if (licensedAudio) {
    expectBoundRecord({
      baseDir: path.dirname(qa.path),
      record: qaValue?.audio?.licensed_audio_pack,
      supplied: {
        path: licensedAudio.manifest_path,
        sha256: licensedAudio.manifest_sha256,
      },
      prefix: "qa_licensed_audio_pack",
      errors,
    });
    validateLicensedAudioEvidence({
      evidence: qaValue?.licensed_audio,
      baseDir: path.dirname(qa.path),
      licensedAudio,
      prefix: "qa_licensed_audio",
      errors,
    });
    if (
      Math.abs(
        Number(qaValue?.technical?.duration_seconds) -
          licensedAudio.render_binding.target_duration_seconds,
      ) > 0.001
    ) {
      errors.push("licensed_audio_qa_duration_mismatch");
    }
  } else if (
    qaValue?.licensed_audio ||
    qaValue?.audio?.licensed_audio_pack
  ) {
    errors.push("qa_licensed_audio_must_be_absent");
  }
  if (
    text(qaValue?.audio?.source_sha256).toLowerCase() !==
    narration.audio?.sha256
  ) {
    errors.push("qa_narration_audio_sha256_mismatch");
  }
  if (
    text(qaValue?.audio?.governed_manifest_sha256).toLowerCase() !==
    narrationManifest.sha256
  ) {
    errors.push("qa_governed_narration_manifest_sha256_mismatch");
  }
  if (text(qaValue?.audio?.rights_basis).toUpperCase() !== "LICENSED") {
    errors.push("qa_narration_rights_basis_invalid");
  }
  const safety = manifest?.safety || {};
  for (const key of [
    "database_mutated",
    "oauth_or_tokens_mutated",
    "platform_objects_created",
    "live_publish_attempted",
    "network_used",
  ]) {
    if (safety[key] !== false) {
      errors.push(`final_composite_safety_${key}_invalid`);
    }
  }
  if (
    !Array.isArray(safety.external_calls) ||
    safety.external_calls.length !== 0
  ) {
    errors.push("final_composite_external_calls_must_be_empty");
  }
}

function validateHumanApproval({
  humanApproval,
  story,
  finalMp4,
  rendererCanonicalSha256,
}) {
  const approval = humanApproval || {};
  const errors = [];
  const actor = text(approval.actor);
  const approvedAt = text(approval.approvedAt);
  const parsedAt = new Date(approvedAt);
  if (!actor) errors.push("human_approval_actor_required");
  if (!approvedAt || Number.isNaN(parsedAt.getTime())) {
    errors.push("human_approval_timestamp_required");
  }
  if (text(approval.confirmStoryId) !== story.storyId) {
    errors.push("human_approval_story_id_mismatch");
  }
  if (text(approval.confirmMediaSha256).toLowerCase() !== finalMp4.sha256) {
    errors.push("human_approval_media_sha256_mismatch");
  }
  if (text(approval.confirmScriptSha256).toLowerCase() !== story.scriptSha256) {
    errors.push("human_approval_script_sha256_mismatch");
  }
  if (
    text(approval.confirmRendererCanonicalSha256).toLowerCase() !==
    rendererCanonicalSha256
  ) {
    errors.push("human_approval_renderer_canonical_sha256_mismatch");
  }
  if (text(approval.disclosureConfirmation) !== DISCLOSURE_CONFIRMATION) {
    errors.push("human_approval_disclosure_confirmation_required");
  }
  if (errors.length) {
    throw new GovernedPublicationEvidencePackageError(errors);
  }
  return {
    actor,
    approved_at: parsedAt.toISOString(),
    confirmed_story_id: story.storyId,
    confirmed_media_sha256: finalMp4.sha256,
    confirmed_script_sha256: story.scriptSha256,
    confirmed_renderer_canonical_sha256: rendererCanonicalSha256,
    disclosure_confirmation: DISCLOSURE_CONFIRMATION,
  };
}

function buildMarkdown(value) {
  const output = value.outputs;
  return [
    "# Governed publication evidence package",
    "",
    `- Story: ${value.story_id}`,
    `- Channel: ${value.channel_id}`,
    `- Decision: ${value.decision}`,
    `- Approved by: ${value.human_approval.actor}`,
    `- Approved at: ${value.human_approval.approved_at}`,
    `- Media SHA-256: ${value.bindings.media_sha256}`,
    `- Script SHA-256: ${value.bindings.script_sha256}`,
    `- Renderer canonical SHA-256: ${value.bindings.renderer_canonical_sha256}`,
    "- Synthetic-media disclosure: DISCLOSE",
    "- YouTube altered/synthetic-content field: true",
    `- Third-party media used: ${value.policy.third_party_media_used}`,
    `- Attribution required: ${value.policy.attribution_required}`,
    `- Background music used: ${value.policy.background_music_used}`,
    `- Sound effects used: ${value.policy.sound_effects_used}`,
    "",
    "## Review artefacts",
    "",
    `- Publication review: ${output.publication_review.path}`,
    `- Rights ledger: ${output.rights_ledger.path}`,
    `- Transformation evidence: ${output.transformation_evidence.path}`,
    "",
    "This package is local evidence only. It does not authorise or attempt publication.",
    "",
  ].join("\n");
}

function recordFromSerialised(outDir, fileName, contents) {
  return {
    path: normalisePath(fileName),
    absolute_path: path.join(outDir, fileName),
    sha256: sha256Bytes(Buffer.from(contents, "utf8")),
  };
}

function plannedOutputs(outDir) {
  return Object.fromEntries(
    Object.entries(OUTPUT_NAMES).map(([key, name]) => [
      key,
      path.join(outDir, name),
    ]),
  );
}

function writeBundleAtomically(files) {
  const targets = files.map((entry) => entry.path);
  const collisions = targets.filter((target) => fs.existsSync(target));
  if (collisions.length) {
    throw new GovernedPublicationEvidencePackageError(
      collisions.map(
        (target) => `evidence_output_already_exists:${path.basename(target)}`,
      ),
    );
  }
  const staged = [];
  const committed = [];
  try {
    for (const entry of files) {
      const temporaryPath = `${entry.path}.tmp-${process.pid}-${crypto.randomUUID()}`;
      fs.writeFileSync(temporaryPath, entry.contents, {
        encoding: "utf8",
        flag: "wx",
      });
      staged.push(temporaryPath);
    }
    for (let index = 0; index < files.length; index += 1) {
      fs.renameSync(staged[index], files[index].path);
      committed.push(files[index].path);
    }
  } catch (error) {
    for (const temporaryPath of staged) {
      if (fs.existsSync(temporaryPath)) {
        fs.rmSync(temporaryPath, { force: true });
      }
    }
    for (const committedPath of committed) {
      if (fs.existsSync(committedPath)) {
        fs.rmSync(committedPath, { force: true });
      }
    }
    if (error instanceof GovernedPublicationEvidencePackageError) {
      throw error;
    }
    throw new GovernedPublicationEvidencePackageError(
      `evidence_package_write_failed:${error.code || "unknown"}`,
    );
  }
}

async function executeGovernedPublicationEvidencePackage(
  options = {},
  dependencies = {},
) {
  const errors = [];
  const generatedDate = new Date(
    options.generatedAt || new Date().toISOString(),
  );
  if (Number.isNaN(generatedDate.getTime())) {
    throw new GovernedPublicationEvidencePackageError("generated_at_invalid");
  }
  const generatedAt = generatedDate.toISOString();
  const intake = readRequiredJson(options.storyIntakePath, "story_intake");
  const source = readRequiredJson(
    options.sourceEvidencePath,
    "source_evidence",
  );
  const ownedMotion = readRequiredJson(
    options.ownedMotionManifestPath,
    "owned_motion_manifest",
  );
  const narrationManifest = readRequiredJson(
    options.governedNarrationManifestPath,
    "governed_narration_manifest",
  );
  const composite = readRequiredJson(
    options.finalCompositeManifestPath,
    "final_composite_manifest",
  );
  const renderer = readRequiredJson(
    options.rendererManifestPath,
    "renderer_manifest",
  );
  const qa = readRequiredJson(options.qaReportPath, "qa_report");
  const finalMp4 = readRequiredFile(options.finalMp4Path, "final_mp4");
  const outDir = path.resolve(
    text(options.outDir) || path.dirname(renderer.path),
  );
  if (!samePath(outDir, path.dirname(renderer.path))) {
    errors.push(
      "package_output_directory_must_match_renderer_manifest_directory",
    );
  }
  if (!fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) {
    errors.push("package_output_directory_required");
  }

  const story = validateStory({ intake, source, errors });
  const sourceMedia = validateOptionalSourceMedia({
    options,
    intake,
    story,
    errors,
    validationBoundaryAt: generatedAt,
  });
  const publicationMetadata = validatePublicationMetadata({
    options,
    story,
    sourceMedia,
    errors,
  });
  const ownedAssets = validateOwnedMotion({
    ownedMotion,
    story,
    sourceMedia,
    errors,
  });
  const narration = validateNarration({
    narrationManifest,
    story,
    errors,
  });
  const rendererValidation = validateRenderer({
    renderer,
    story,
    finalMp4,
    ownedAssets,
    sourceMedia,
    narration,
    errors,
  });
  const controlledExperimentObservation =
    validateOptionalControlledExperimentObservation({
      options,
      story,
      intake,
      narrationManifest,
      renderer,
      rendererValidation,
      qa,
      finalMp4,
      errors,
    });
  const licensedAudio = validateOptionalLicensedAudio({
    options,
    intake,
    story,
    narration,
    rendererValidation,
    validationBoundaryAt: generatedAt,
    validateLicensedAudioPack:
      dependencies.validateLicensedAudioPack ||
      validateGovernedLicensedAudioPack,
    errors,
  });
  validateLicensedAudioRendererInputs({
    licensedAudio,
    rendererValidation,
    errors,
  });
  validateCompositeAndQa({
    composite,
    renderer,
    qa,
    intake,
    ownedMotion,
    narrationManifest,
    narration,
    sourceMedia,
    licensedAudio,
    controlledExperimentObservation,
    story,
    rendererValidation,
    finalMp4,
    errors,
  });
  if (errors.length) {
    throw new GovernedPublicationEvidencePackageError(errors);
  }

  const outputs = plannedOutputs(outDir);
  const baseResult = {
    schema_version: RESULT_SCHEMA,
    generated_at: generatedAt,
    mode: options.apply === true ? "APPLY" : "DRY_RUN",
    verdict:
      options.apply === true
        ? "PACKAGE_WRITTEN_HUMAN_APPROVED"
        : "VALIDATED_DRY_RUN",
    mutated: options.apply === true,
    story_id: story.storyId,
    channel_id: story.channelId,
    script_sha256: story.scriptSha256,
    story_intake: {
      path: pathForRecord(outDir, intake.path),
      sha256: intake.sha256,
    },
    media_sha256: finalMp4.sha256,
    renderer_canonical_sha256: rendererValidation.canonicalSha256,
    publication_metadata_sha256:
      publicationMetadata?.sha256 || null,
    publication_platform:
      publicationMetadata?.platform || PUBLICATION_PLATFORM,
    official_source_release_binding:
      story.officialSourceReleaseBinding,
    source_media_policy: text(
      intake.value?.story?.visual_brief?.source_media_policy,
    ),
    source_media_manifest_sha256:
      sourceMedia?.manifest_sha256 || null,
    third_party_media_used: Boolean(sourceMedia),
    attribution_required: Boolean(sourceMedia),
    licensed_audio_pack_sha256:
      licensedAudio?.manifest_sha256 || null,
    licensed_audio_rights_ledger_sha256:
      licensedAudio?.rights_ledger?.sha256 || null,
    background_music_used: Boolean(licensedAudio),
    sound_effects_used: Boolean(licensedAudio),
    controlled_experiment_observation_file_sha256:
      controlledExperimentObservation?.file_sha256 || null,
    controlled_experiment_observation_sha256:
      controlledExperimentObservation?.observation_sha256 || null,
    timestamp_lineage: {
      mode: rendererValidation.timestampLineage.mode,
      source_path: rendererValidation.timestampLineage.source_path,
      source_sha256: rendererValidation.timestampLineage.source_sha256,
      normalised_path: rendererValidation.timestampLineage.normalised_path,
      normalised_sha256: rendererValidation.timestampLineage.normalised_sha256,
    },
    human_approval: {
      required_for_apply: true,
      supplied: Boolean(options.humanApproval),
      inferred: false,
    },
    planned_outputs: outputs,
    controls: {
      local_files_only: true,
      database_mutated: false,
      oauth_or_tokens_mutated: false,
      platform_objects_created: false,
      live_publish_attempted: false,
      network_used: false,
    },
  };
  if (options.apply !== true) return baseResult;

  const humanApproval = validateHumanApproval({
    humanApproval: options.humanApproval,
    story,
    finalMp4,
    rendererCanonicalSha256: rendererValidation.canonicalSha256,
  });
  const motionInput = rendererValidation.motion;
  const narrationInput = rendererValidation.narrationInput;
  const timestampInput = rendererValidation.timestampInput;
  const licensedAudioInputs = rendererValidation.inputs.filter(
    (input) => input.role === "music" || input.role === "sfx",
  );
  const licensedAudioEvidence = licensedAudio
    ? composite.value.licensed_audio
    : null;
  const sourceMediaAttributionTexts = [
    ...new Set(
      (sourceMedia?.components || [])
        .filter(
          (component) =>
            component.attribution?.required === true,
        )
        .map((component) => text(component.attribution?.text))
        .filter(Boolean),
    ),
  ];
  const sourceMediaPublishers = [
    ...new Set(
      (sourceMedia?.components || [])
        .map((component) => text(component.source?.publisher))
        .filter(Boolean),
    ),
  ];
  const sourceMediaRightsBasis =
    sourceMedia?.policy === GOVERNED_GAME_MEDIA_POLICY
      ? "PER_ASSET_GOVERNED"
      : "LICENSED";
  const sourceMediaAttributionText =
    sourceMediaAttributionTexts.length === 1
      ? sourceMediaAttributionTexts[0]
      : sourceMediaAttributionTexts.join(" | ") || null;

  const transformationEvidence = {
    schema_version: TRANSFORMATION_SCHEMA,
    story_id: story.storyId,
    verdict: "STRONG",
    rationale: sourceMedia
      ? "Original scripted narration, player-focused editorial framing, tightly selected licensed official source media, designed motion, kinetic captions and final sequencing materially transform the verified official facts."
      : "Original scripted narration, player-focused editorial framing, designed owned motion, kinetic captions and final sequencing materially transform the verified official facts.",
    reviewed_by: humanApproval.actor,
    reviewed_at: humanApproval.approved_at,
    bindings: {
      story_intake: {
        path: pathForRecord(outDir, intake.path),
        sha256: intake.sha256,
      },
      source_evidence: {
        path: pathForRecord(outDir, source.path),
        sha256: source.sha256,
      },
      publication_metadata: {
        path: pathForRecord(outDir, publicationMetadata.path),
        sha256: publicationMetadata.sha256,
        platform: publicationMetadata.platform,
      },
      owned_motion_manifest: {
        path: pathForRecord(outDir, ownedMotion.path),
        sha256: ownedMotion.sha256,
      },
      ...(sourceMedia
        ? {
            source_media_manifest: {
              path: pathForRecord(
                outDir,
                sourceMedia.manifest_path,
              ),
              sha256: sourceMedia.manifest_sha256,
            },
          }
        : {}),
      ...(licensedAudio
        ? {
            licensed_audio_pack: {
              path: pathForRecord(
                outDir,
                licensedAudio.manifest_path,
              ),
              sha256: licensedAudio.manifest_sha256,
            },
            licensed_audio_rights_ledger: {
              path: pathForRecord(
                outDir,
                licensedAudio.rights_ledger.path,
              ),
              sha256: licensedAudio.rights_ledger.sha256,
            },
          }
        : {}),
      ...(controlledExperimentObservation
        ? {
            controlled_experiment_observation: {
              path: pathForRecord(
                outDir,
                controlledExperimentObservation.path,
              ),
              file_sha256:
                controlledExperimentObservation.file_sha256,
              observation_sha256:
                controlledExperimentObservation.observation_sha256,
            },
          }
        : {}),
      governed_narration_manifest: {
        path: pathForRecord(outDir, narrationManifest.path),
        sha256: narrationManifest.sha256,
      },
      word_timestamps_source: {
        path: pathForRecord(
          outDir,
          rendererValidation.timestampLineage.source_path,
        ),
        sha256: rendererValidation.timestampLineage.source_sha256,
      },
      word_timestamps_normalised: {
        path: pathForRecord(
          outDir,
          rendererValidation.timestampLineage.normalised_path,
        ),
        sha256: rendererValidation.timestampLineage.normalised_sha256,
        source_sha256: rendererValidation.timestampLineage.source_sha256,
      },
      final_composite_manifest: {
        path: pathForRecord(outDir, composite.path),
        sha256: composite.sha256,
      },
      renderer_manifest: {
        path: pathForRecord(outDir, renderer.path),
        file_sha256: renderer.sha256,
        canonical_sha256: rendererValidation.canonicalSha256,
      },
      qa_report: {
        path: pathForRecord(outDir, qa.path),
        sha256: qa.sha256,
      },
      final_mp4: {
        path: pathForRecord(outDir, finalMp4.path),
        sha256: finalMp4.sha256,
      },
    },
  };
  const transformationContents = serialiseJson(transformationEvidence);
  const transformationRecord = recordFromSerialised(
    outDir,
    OUTPUT_NAMES.transformation_evidence,
    transformationContents,
  );

  const ownedRightsEvidence = {
    schema_version: RIGHTS_EVIDENCE_SCHEMA,
    story_id: story.storyId,
    component_id: motionInput.componentId,
    asset_path: motionInput.raw.path,
    asset_sha256: motionInput.sha256,
    rights_basis: sourceMedia ? "LICENSED" : "OWNED",
    rights_decision: "CLEARED",
    ownership: sourceMedia ? "mixed" : "owned",
    attribution_required: Boolean(sourceMedia),
    attribution_text: sourceMedia
      ? sourceMediaAttributionText
      : null,
    third_party_media_used: Boolean(sourceMedia),
    provenance: rendererValidation.ownedAsset.provenance,
    manifest_binding: {
      path: pathForRecord(outDir, ownedMotion.path),
      sha256: ownedMotion.sha256,
    },
    ...(sourceMedia
      ? {
          source_media_manifest_binding: {
            path: pathForRecord(
              outDir,
              sourceMedia.manifest_path,
            ),
            sha256: sourceMedia.manifest_sha256,
          },
        }
      : {}),
    reviewed_by: humanApproval.actor,
    reviewed_at: humanApproval.approved_at,
  };
  const ownedRightsContents = serialiseJson(ownedRightsEvidence);
  const ownedRightsRecord = recordFromSerialised(
    outDir,
    OUTPUT_NAMES.owned_motion_rights_evidence,
    ownedRightsContents,
  );

  const narrationRightsEvidence = {
    schema_version: RIGHTS_EVIDENCE_SCHEMA,
    story_id: story.storyId,
    component_id: narrationInput.componentId,
    asset_path: narrationInput.raw.path,
    asset_sha256: narrationInput.sha256,
    rights_basis: "LICENSED",
    rights_decision: "CLEARED",
    attribution_required: false,
    third_party_media_used: false,
    licence: {
      evidence_reference: narration.licence.evidence_reference,
      attested_by: narration.licence.attested_by,
      attested_at: new Date(narration.licence.attested_at).toISOString(),
      evidence_scope: narration.licence.evidence_scope,
    },
    manifest_binding: {
      path: pathForRecord(outDir, narrationManifest.path),
      sha256: narrationManifest.sha256,
    },
    reviewed_by: humanApproval.actor,
    reviewed_at: humanApproval.approved_at,
  };
  const narrationRightsContents = serialiseJson(narrationRightsEvidence);
  const narrationRightsRecord = recordFromSerialised(
    outDir,
    OUTPUT_NAMES.narration_rights_evidence,
    narrationRightsContents,
  );

  let sourceMediaRightsContents = null;
  let sourceMediaRightsRecord = null;
  if (sourceMedia) {
    const sourceMediaRightsEvidence = {
      schema_version: RIGHTS_EVIDENCE_SCHEMA,
      story_id: story.storyId,
      rights_basis: sourceMediaRightsBasis,
      rights_decision: "CLEARED",
      publisher:
        sourceMediaPublishers.length === 1
          ? sourceMediaPublishers[0]
          : "MULTIPLE",
      attribution_required:
        sourceMediaAttributionTexts.length > 0,
      attribution_text: sourceMediaAttributionText,
      attribution_delivery: [
        ...new Set(
          sourceMedia.components.flatMap(
            (component) =>
              component.attribution?.delivery || [],
          ),
        ),
      ].sort(),
      description_attribution_evidence: {
        publication_metadata: {
          path: pathForRecord(outDir, publicationMetadata.path),
          sha256: publicationMetadata.sha256,
          platform: publicationMetadata.platform,
        },
        notice: sourceMediaAttributionText,
        exact_standalone_line_verified: true,
      },
      third_party_media_used: true,
      licence: {
        evidence_url:
          sourceMedia.rights_review.evidence.licence_evidence_url,
        rights_review_path: pathForRecord(
          outDir,
          sourceMedia.rights_review.path,
        ),
        rights_review_sha256: sourceMedia.rights_review.sha256,
        review_status: sourceMedia.rights_review.review_status,
      },
      manifest_binding: {
        path: pathForRecord(outDir, sourceMedia.manifest_path),
        sha256: sourceMedia.manifest_sha256,
      },
      components: sourceMedia.components.map((component) => ({
        component_id: component.component_id,
        media_type: component.media_type,
        asset_path: pathForRecord(outDir, component.asset.path),
        asset_sha256: component.asset.sha256,
        source_page_url: component.source.page_url,
        direct_media_url: component.source.direct_media_url,
        rights_basis: component.rights_basis,
        attribution_required:
          component.attribution?.required === true,
        attribution_text: text(component.attribution?.text) || null,
        editorial: component.editorial,
      })),
      reviewed_by: humanApproval.actor,
      reviewed_at: humanApproval.approved_at,
    };
    sourceMediaRightsContents = serialiseJson(
      sourceMediaRightsEvidence,
    );
    sourceMediaRightsRecord = recordFromSerialised(
      outDir,
      OUTPUT_NAMES.source_media_rights_evidence,
      sourceMediaRightsContents,
    );
  }

  const rightsLedger = {
    ledger_version: 1,
    decision: "CLEARED",
    story_id: story.storyId,
    reviewed_by: humanApproval.actor,
    reviewed_at: humanApproval.approved_at,
    items: [
      {
        item_id: motionInput.componentId,
        source_url: sourceMedia
          ? `pulse-licensed://${story.storyId}/hyperframes-intermediate`
          : `pulse-owned://${story.storyId}/hyperframes-intermediate`,
        asset_path: motionInput.raw.path,
        asset_sha256: motionInput.sha256,
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: sourceMedia ? "LICENSED" : "OWNED",
        rights_evidence: {
          reference: OUTPUT_NAMES.owned_motion_rights_evidence,
          sha256: ownedRightsRecord.sha256,
        },
        attribution_decision: sourceMedia
          ? "REQUIRED_AND_SUPPLIED"
          : "NOT_REQUIRED",
        attribution_text: sourceMedia
          ? sourceMediaAttributionText
          : null,
      },
      {
        item_id: narrationInput.componentId,
        source_url: `pulse-licensed://${story.storyId}/narration`,
        asset_path: narrationInput.raw.path,
        asset_sha256: narrationInput.sha256,
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "LICENSED",
        rights_evidence: {
          reference: OUTPUT_NAMES.narration_rights_evidence,
          sha256: narrationRightsRecord.sha256,
        },
        attribution_decision: "NOT_REQUIRED",
        attribution_text: null,
      },
      ...(licensedAudio
        ? licensedAudio.assets.map((asset) => {
            const input = licensedAudioInputs.find(
              (candidate) =>
                candidate.componentId === asset.asset_id,
            );
            return {
              item_id: asset.asset_id,
              source_url: asset.provider_asset_reference,
              asset_path: input.raw.path,
              asset_sha256: asset.sha256,
              included_in_final: true,
              rights_decision: "CLEARED",
              rights_basis: "LICENSED",
              rights_evidence: {
                reference: pathForRecord(
                  outDir,
                  asset.rights_evidence_path,
                ),
                sha256: asset.rights_evidence_sha256,
              },
              attribution_decision: "NOT_REQUIRED",
              attribution_text: null,
            };
          })
        : []),
      ...(sourceMedia
        ? rendererValidation.sourceMediaInputs.map((input) => {
            const component = sourceMedia.components.find(
              (candidate) =>
                candidate.component_id === input.componentId,
            );
            return {
              item_id: input.componentId,
              source_url: component.source.direct_media_url,
              asset_path: input.raw.path,
              asset_sha256: input.sha256,
              included_in_final: true,
              rights_decision: "CLEARED",
              rights_basis: component.rights_basis,
              rights_evidence: {
                reference: OUTPUT_NAMES.source_media_rights_evidence,
                sha256: sourceMediaRightsRecord.sha256,
              },
              attribution_decision:
                component.attribution?.required === true
                  ? "REQUIRED_AND_SUPPLIED"
                  : "NOT_REQUIRED",
              attribution_text:
                text(component.attribution?.text) || null,
            };
          })
        : []),
    ],
  };
  const rightsContents = serialiseJson(rightsLedger);
  const rightsRecord = recordFromSerialised(
    outDir,
    OUTPUT_NAMES.rights_ledger,
    rightsContents,
  );
  const rightsCanonicalSha256 = hashRightsLedger(rightsLedger);

  const publicationReview = {
    schema_version: REVIEW_SCHEMA,
    story_id: story.storyId,
    channel_id: story.channelId,
    script_sha256: story.scriptSha256,
    story_intake: {
      path: pathForRecord(outDir, intake.path),
      sha256: intake.sha256,
    },
    source_evidence: {
      path: pathForRecord(outDir, source.path),
      sha256: source.sha256,
    },
    qa_report: {
      path: pathForRecord(outDir, qa.path),
      sha256: qa.sha256,
    },
    transformation_evidence: {
      path: OUTPUT_NAMES.transformation_evidence,
      sha256: transformationRecord.sha256,
    },
    rights_ledger: {
      path: OUTPUT_NAMES.rights_ledger,
      file_sha256: rightsRecord.sha256,
      canonical_sha256: rightsCanonicalSha256,
    },
    synthetic_media_disclosure: {
      contains_synthetic_media: true,
      decision: "DISCLOSE",
      rationale:
        "The final edit contains licensed synthetic narration and designed synthetic visual elements.",
      disclosure_text:
        "Includes AI-generated narration and synthetic visual elements.",
      youtube_field_value: true,
      reviewed_at: humanApproval.approved_at,
    },
    renderer_manifest: {
      path: pathForRecord(outDir, renderer.path),
      file_sha256: renderer.sha256,
      canonical_sha256: rendererValidation.canonicalSha256,
    },
    final_mp4: {
      path: pathForRecord(outDir, finalMp4.path),
      sha256: finalMp4.sha256,
    },
    narration_audio: {
      path: narrationInput.raw.path,
      sha256: narrationInput.sha256,
      component_id: narrationInput.componentId,
    },
    word_timestamps: {
      path: timestampInput.raw.path,
      sha256: timestampInput.sha256,
      component_id: timestampInput.componentId,
    },
    owned_motion_manifest: {
      path: pathForRecord(outDir, ownedMotion.path),
      sha256: ownedMotion.sha256,
    },
    publication_metadata: {
      path: pathForRecord(outDir, publicationMetadata.path),
      sha256: publicationMetadata.sha256,
      platform: publicationMetadata.platform,
    },
    ...(controlledExperimentObservation
      ? {
          controlled_experiment_observation: {
            path: pathForRecord(
              outDir,
              controlledExperimentObservation.path,
            ),
            file_sha256:
              controlledExperimentObservation.file_sha256,
            observation_sha256:
              controlledExperimentObservation.observation_sha256,
          },
          governed_narration_manifest: {
            path: pathForRecord(outDir, narrationManifest.path),
            sha256: narrationManifest.sha256,
          },
        }
      : {}),
    policy: {
      source_media_policy: text(
        intake.value?.story?.visual_brief?.source_media_policy,
      ),
      third_party_media_used: Boolean(sourceMedia),
      attribution_required: Boolean(sourceMedia),
      ...(licensedAudio
        ? {
            background_music_used: true,
            sound_effects_used: true,
          }
        : {}),
    },
    ...(sourceMedia
      ? {
          source_media_manifest: {
            path: pathForRecord(
              outDir,
              sourceMedia.manifest_path,
            ),
            sha256: sourceMedia.manifest_sha256,
          },
        }
      : {}),
    ...(licensedAudio
      ? { licensed_audio: licensedAudioEvidence }
      : {}),
    renderer_inputs: rendererValidation.rawInputs,
  };
  const reviewContents = serialiseJson(publicationReview);
  const reviewRecord = recordFromSerialised(
    outDir,
    OUTPUT_NAMES.publication_review,
    reviewContents,
  );

  const packageManifest = {
    schema_version: PACKAGE_SCHEMA,
    generated_at: generatedAt,
    story_id: story.storyId,
    channel_id: story.channelId,
    decision: "HUMAN_APPROVED_LOCAL_EVIDENCE_PACKAGE",
    publish_authorised: false,
    human_approval: humanApproval,
    inputs: {
      story_intake: {
        path: pathForRecord(outDir, intake.path),
        sha256: intake.sha256,
      },
      source_evidence: {
        path: pathForRecord(outDir, source.path),
        sha256: source.sha256,
      },
      publication_metadata: {
        path: pathForRecord(outDir, publicationMetadata.path),
        sha256: publicationMetadata.sha256,
        platform: publicationMetadata.platform,
      },
      owned_motion_manifest: {
        path: pathForRecord(outDir, ownedMotion.path),
        sha256: ownedMotion.sha256,
      },
      ...(sourceMedia
        ? {
            source_media_manifest: {
              path: pathForRecord(
                outDir,
                sourceMedia.manifest_path,
              ),
              sha256: sourceMedia.manifest_sha256,
            },
          }
        : {}),
      ...(licensedAudio
        ? {
            licensed_audio_pack: {
              path: pathForRecord(
                outDir,
                licensedAudio.manifest_path,
              ),
              sha256: licensedAudio.manifest_sha256,
            },
            licensed_audio_rights_ledger: {
              path: pathForRecord(
                outDir,
                licensedAudio.rights_ledger.path,
              ),
              sha256: licensedAudio.rights_ledger.sha256,
            },
          }
        : {}),
      ...(controlledExperimentObservation
        ? {
            controlled_experiment_observation: {
              path: pathForRecord(
                outDir,
                controlledExperimentObservation.path,
              ),
              file_sha256:
                controlledExperimentObservation.file_sha256,
              observation_sha256:
                controlledExperimentObservation.observation_sha256,
            },
          }
        : {}),
      governed_narration_manifest: {
        path: pathForRecord(outDir, narrationManifest.path),
        sha256: narrationManifest.sha256,
      },
      word_timestamps_source: {
        path: pathForRecord(
          outDir,
          rendererValidation.timestampLineage.source_path,
        ),
        sha256: rendererValidation.timestampLineage.source_sha256,
      },
      word_timestamps_normalised: {
        path: pathForRecord(
          outDir,
          rendererValidation.timestampLineage.normalised_path,
        ),
        sha256: rendererValidation.timestampLineage.normalised_sha256,
        source_sha256: rendererValidation.timestampLineage.source_sha256,
      },
      final_composite_manifest: {
        path: pathForRecord(outDir, composite.path),
        sha256: composite.sha256,
      },
      renderer_manifest: {
        path: pathForRecord(outDir, renderer.path),
        file_sha256: renderer.sha256,
        canonical_sha256: rendererValidation.canonicalSha256,
      },
      qa_report: {
        path: pathForRecord(outDir, qa.path),
        sha256: qa.sha256,
      },
      final_mp4: {
        path: pathForRecord(outDir, finalMp4.path),
        sha256: finalMp4.sha256,
      },
    },
    bindings: {
      media_sha256: finalMp4.sha256,
      script_sha256: story.scriptSha256,
      renderer_canonical_sha256: rendererValidation.canonicalSha256,
      renderer_file_sha256: renderer.sha256,
      final_composite_manifest_sha256: composite.sha256,
      qa_report_sha256: qa.sha256,
      story_intake_sha256: intake.sha256,
      source_evidence_sha256: source.sha256,
      official_source_release_binding:
        story.officialSourceReleaseBinding,
      publication_metadata_sha256: publicationMetadata.sha256,
      owned_motion_manifest_sha256: ownedMotion.sha256,
      source_media_manifest_sha256:
        sourceMedia?.manifest_sha256 || null,
      licensed_audio_pack_sha256:
        licensedAudio?.manifest_sha256 || null,
      licensed_audio_rights_ledger_sha256:
        licensedAudio?.rights_ledger?.sha256 || null,
      governed_narration_manifest_sha256: narrationManifest.sha256,
      word_timestamps_source_sha256:
        rendererValidation.timestampLineage.source_sha256,
      word_timestamps_normalised_sha256:
        rendererValidation.timestampLineage.normalised_sha256,
      ...(controlledExperimentObservation
        ? {
            controlled_experiment_observation_file_sha256:
              controlledExperimentObservation.file_sha256,
            controlled_experiment_observation_sha256:
              controlledExperimentObservation.observation_sha256,
          }
        : {}),
    },
    policy: {
      contains_synthetic_media: true,
      synthetic_media_disclosure: "DISCLOSE",
      youtube_field_value: true,
      source_media_policy: text(
        intake.value?.story?.visual_brief?.source_media_policy,
      ),
      third_party_media_used: Boolean(sourceMedia),
      attribution_required: Boolean(sourceMedia),
      background_music_used: Boolean(licensedAudio),
      sound_effects_used: Boolean(licensedAudio),
    },
    outputs: {
      transformation_evidence: {
        path: OUTPUT_NAMES.transformation_evidence,
        sha256: transformationRecord.sha256,
      },
      owned_motion_rights_evidence: {
        path: OUTPUT_NAMES.owned_motion_rights_evidence,
        sha256: ownedRightsRecord.sha256,
      },
      narration_rights_evidence: {
        path: OUTPUT_NAMES.narration_rights_evidence,
        sha256: narrationRightsRecord.sha256,
      },
      ...(sourceMediaRightsRecord
        ? {
            source_media_rights_evidence: {
              path: OUTPUT_NAMES.source_media_rights_evidence,
              sha256: sourceMediaRightsRecord.sha256,
            },
          }
        : {}),
      rights_ledger: {
        path: OUTPUT_NAMES.rights_ledger,
        file_sha256: rightsRecord.sha256,
        canonical_sha256: rightsCanonicalSha256,
      },
      publication_review: {
        path: OUTPUT_NAMES.publication_review,
        sha256: reviewRecord.sha256,
        schema_version: REVIEW_SCHEMA,
      },
    },
    controls: {
      local_files_only: true,
      database_mutated: false,
      oauth_or_tokens_mutated: false,
      platform_objects_created: false,
      live_publish_attempted: false,
      network_used: false,
    },
  };
  const packageContents = serialiseJson(packageManifest);
  const packageRecord = recordFromSerialised(
    outDir,
    OUTPUT_NAMES.package_manifest,
    packageContents,
  );
  const markdownContents = buildMarkdown(packageManifest);

  writeBundleAtomically([
    {
      path: transformationRecord.absolute_path,
      contents: transformationContents,
    },
    {
      path: ownedRightsRecord.absolute_path,
      contents: ownedRightsContents,
    },
    {
      path: narrationRightsRecord.absolute_path,
      contents: narrationRightsContents,
    },
    ...(sourceMediaRightsRecord
      ? [
          {
            path: sourceMediaRightsRecord.absolute_path,
            contents: sourceMediaRightsContents,
          },
        ]
      : []),
    {
      path: rightsRecord.absolute_path,
      contents: rightsContents,
    },
    {
      path: reviewRecord.absolute_path,
      contents: reviewContents,
    },
    {
      path: packageRecord.absolute_path,
      contents: packageContents,
    },
    {
      path: outputs.markdown,
      contents: markdownContents,
    },
  ]);

  return {
    ...baseResult,
    human_approval: {
      required_for_apply: true,
      supplied: true,
      inferred: false,
      actor: humanApproval.actor,
      approved_at: humanApproval.approved_at,
    },
    transformation_evidence_path: transformationRecord.absolute_path,
    owned_motion_rights_evidence_path: ownedRightsRecord.absolute_path,
    narration_rights_evidence_path: narrationRightsRecord.absolute_path,
    source_media_rights_evidence_path:
      sourceMediaRightsRecord?.absolute_path || null,
    rights_ledger_path: rightsRecord.absolute_path,
    rights_ledger_canonical_sha256: rightsCanonicalSha256,
    publication_review_path: reviewRecord.absolute_path,
    package_manifest_path: packageRecord.absolute_path,
    package_manifest_sha256: packageRecord.sha256,
    markdown_path: outputs.markdown,
  };
}

module.exports = {
  DISCLOSURE_CONFIRMATION,
  GovernedPublicationEvidencePackageError,
  OUTPUT_NAMES,
  PACKAGE_SCHEMA,
  RESULT_SCHEMA,
  executeGovernedPublicationEvidencePackage,
  hashFile,
  sha256Bytes,
  stableJson,
};

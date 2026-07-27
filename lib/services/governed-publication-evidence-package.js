"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { hashRightsLedger } = require("./publication-evidence-gates");
const {
  fingerprintRendererManifest,
  evaluateRendererManifest,
} = require("../stabilisation/renderer-governance");

const RESULT_SCHEMA = "pulse-governed-publication-evidence-package-result-v1";
const PACKAGE_SCHEMA = "pulse-governed-publication-evidence-package-v1";
const REVIEW_SCHEMA = "pulse-governed-publication-review-v1";
const TRANSFORMATION_SCHEMA = "pulse-transformation-evidence-v1";
const RIGHTS_EVIDENCE_SCHEMA = "pulse-rights-evidence-v1";
const DISCLOSURE_CONFIRMATION = "DISCLOSE_AND_SET_YOUTUBE_TRUE";
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

const OUTPUT_NAMES = Object.freeze({
  transformation_evidence: "transformation-evidence.json",
  owned_motion_rights_evidence: "owned-motion-rights-evidence.json",
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
  return {
    storyId,
    channelId,
    fullScript,
    scriptSha256,
  };
}

function validateOwnedMotion({ ownedMotion, story, errors }) {
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
    return {
      ...asset,
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
    timestampInput?.raw?.embedded_in_final !== false
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
  if (manifest?.ffmpeg?.background_music_used !== false) {
    errors.push("composite_background_music_must_be_false");
  }
  if (manifest?.ffmpeg?.sound_effects_used !== false) {
    errors.push("composite_sound_effects_must_be_false");
  }
  expectBoundRecord({
    baseDir: path.dirname(composite.path),
    record: manifest?.inputs?.story_intake,
    supplied: intake,
    prefix: "story_intake",
    errors,
  });
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
  if (qaValue?.audio?.background_music_used !== false) {
    errors.push("qa_background_music_must_be_false");
  }
  if (qaValue?.audio?.sound_effects_used !== false) {
    errors.push("qa_sound_effects_must_be_false");
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
    "- Third-party media used: false",
    "- Attribution required: false",
    "- Background music used: false",
    "- Sound effects used: false",
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

async function executeGovernedPublicationEvidencePackage(options = {}) {
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
  const ownedAssets = validateOwnedMotion({
    ownedMotion,
    story,
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
    narration,
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
    media_sha256: finalMp4.sha256,
    renderer_canonical_sha256: rendererValidation.canonicalSha256,
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

  const transformationEvidence = {
    schema_version: TRANSFORMATION_SCHEMA,
    story_id: story.storyId,
    verdict: "STRONG",
    rationale:
      "Original scripted narration, player-focused editorial framing, designed owned motion, kinetic captions and final sequencing materially transform the verified official facts.",
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
      owned_motion_manifest: {
        path: pathForRecord(outDir, ownedMotion.path),
        sha256: ownedMotion.sha256,
      },
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
    rights_basis: "OWNED",
    rights_decision: "CLEARED",
    ownership: "owned",
    attribution_required: false,
    third_party_media_used: false,
    provenance: rendererValidation.ownedAsset.provenance,
    manifest_binding: {
      path: pathForRecord(outDir, ownedMotion.path),
      sha256: ownedMotion.sha256,
    },
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

  const rightsLedger = {
    ledger_version: 1,
    decision: "CLEARED",
    story_id: story.storyId,
    reviewed_by: humanApproval.actor,
    reviewed_at: humanApproval.approved_at,
    items: [
      {
        item_id: motionInput.componentId,
        source_url: `pulse-owned://${story.storyId}/hyperframes-intermediate`,
        asset_path: motionInput.raw.path,
        asset_sha256: motionInput.sha256,
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "OWNED",
        rights_evidence: {
          reference: OUTPUT_NAMES.owned_motion_rights_evidence,
          sha256: ownedRightsRecord.sha256,
        },
        attribution_decision: "NOT_REQUIRED",
        attribution_text: null,
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
      owned_motion_manifest: {
        path: pathForRecord(outDir, ownedMotion.path),
        sha256: ownedMotion.sha256,
      },
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
      owned_motion_manifest_sha256: ownedMotion.sha256,
      governed_narration_manifest_sha256: narrationManifest.sha256,
      word_timestamps_source_sha256:
        rendererValidation.timestampLineage.source_sha256,
      word_timestamps_normalised_sha256:
        rendererValidation.timestampLineage.normalised_sha256,
    },
    policy: {
      contains_synthetic_media: true,
      synthetic_media_disclosure: "DISCLOSE",
      youtube_field_value: true,
      third_party_media_used: false,
      attribution_required: false,
      background_music_used: false,
      sound_effects_used: false,
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

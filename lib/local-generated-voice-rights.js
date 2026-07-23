"use strict";

const crypto = require("node:crypto");
const fs = require("fs-extra");
const path = require("node:path");

const VOXCPM_MODEL_ID = "openbmb/VoxCPM2";
const VOXCPM_MODEL_SOURCE_URL = "https://huggingface.co/openbmb/VoxCPM2";
const VOXCPM_MODEL_LICENCE = "Apache-2.0";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(clean(value));
}

function safeId(value) {
  return clean(value)
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

async function fingerprintFile(filePath) {
  const bytes = await fs.readFile(filePath);
  return {
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    size_bytes: bytes.length,
  };
}

function samePath(left, right) {
  if (!left || !right) return false;
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

async function inspectGeneratedVoiceReference({
  referencePath,
  auditionReportPath,
  variantName = "no_ref_default",
  humanReview = {},
} = {}) {
  const blockers = [];
  const resolvedReferencePath = referencePath ? path.resolve(referencePath) : "";
  const resolvedReportPath = auditionReportPath ? path.resolve(auditionReportPath) : "";
  const referencePresent = Boolean(
    resolvedReferencePath && await fs.pathExists(resolvedReferencePath),
  );
  const reportPresent = Boolean(
    resolvedReportPath && await fs.pathExists(resolvedReportPath),
  );
  const referenceFingerprint = referencePresent
    ? await fingerprintFile(resolvedReferencePath)
    : { sha256: null, size_bytes: 0 };
  const report = reportPresent
    ? await fs.readJson(resolvedReportPath).catch(() => null)
    : null;

  if (!referencePresent) blockers.push("generated_voice_reference_missing");
  if (!referenceFingerprint.size_bytes) blockers.push("generated_voice_reference_empty");
  if (!reportPresent) blockers.push("generated_voice_audition_report_missing");
  if (!report) blockers.push("generated_voice_audition_report_invalid");

  const model = report?.model || {};
  if (Number(report?.schema_version) !== 2) {
    blockers.push("generated_voice_audition_schema_invalid");
  }
  if (clean(model.id) !== VOXCPM_MODEL_ID) {
    blockers.push("generated_voice_model_id_unverified");
  }
  if (!/^[a-f0-9]{40}$/i.test(clean(model.revision))) {
    blockers.push("generated_voice_model_revision_unverified");
  }
  if (clean(model.licence).toLowerCase() !== VOXCPM_MODEL_LICENCE.toLowerCase()) {
    blockers.push("generated_voice_model_licence_unverified");
  }
  if (clean(model.source_url).replace(/\/+$/, "") !== VOXCPM_MODEL_SOURCE_URL) {
    blockers.push("generated_voice_model_source_unverified");
  }

  const variants = Array.isArray(report?.variants) ? report.variants : [];
  const matches = variants.filter((item) => clean(item?.name) === clean(variantName));
  const variant = matches.length === 1 ? matches[0] : null;
  if (!variant) blockers.push("generated_voice_variant_missing_or_ambiguous");
  if (variant && !samePath(variant.path, resolvedReferencePath)) {
    blockers.push("generated_voice_variant_path_mismatch");
  }
  if (variant && variant.reference !== null) {
    blockers.push("generated_voice_human_reference_present");
  }
  if (variant && variant.prompt_text !== false) {
    blockers.push("generated_voice_prompt_reference_present");
  }
  if (variant && clean(variant.generation_mode) !== "no_reference") {
    blockers.push("generated_voice_generation_mode_unverified");
  }

  const humanReviewHash = clean(humanReview.candidate_sha256).toLowerCase();
  if (clean(humanReview.status).toLowerCase() !== "approved") {
    blockers.push("generated_voice_human_review_pending");
  }
  if (!clean(humanReview.reviewer)) {
    blockers.push("generated_voice_human_reviewer_missing");
  }
  if (!clean(humanReview.reviewed_at)) {
    blockers.push("generated_voice_human_review_time_missing");
  }
  if (!validSha256(humanReviewHash) || humanReviewHash !== referenceFingerprint.sha256) {
    blockers.push("generated_voice_human_review_hash_mismatch");
  }
  if (humanReview.no_impersonation_confirmed !== true) {
    blockers.push("generated_voice_no_impersonation_unconfirmed");
  }
  if (humanReview.quality_approved !== true) {
    blockers.push("generated_voice_quality_unapproved");
  }

  return {
    schema_version: 1,
    verdict: blockers.length ? "RED" : "GREEN",
    blockers: [...new Set(blockers)],
    reference: {
      id: referenceFingerprint.sha256
        ? `pulse-voxcpm2-no-ref-${referenceFingerprint.sha256.slice(0, 12)}`
        : null,
      path: resolvedReferencePath || null,
      sha256: referenceFingerprint.sha256,
      size_bytes: referenceFingerprint.size_bytes,
      generation_mode: variant?.generation_mode || null,
      human_voice_source_used: variant ? variant.reference !== null : null,
      prompt_reference_used: variant ? variant.prompt_text !== false : null,
      audition_report_path: resolvedReportPath || null,
    },
    model: {
      id: clean(model.id) || null,
      revision: clean(model.revision) || null,
      licence: clean(model.licence) || null,
      source_url: clean(model.source_url) || null,
    },
    human_review: {
      status: clean(humanReview.status).toLowerCase() || "pending",
      reviewer: clean(humanReview.reviewer) || null,
      reviewed_at: clean(humanReview.reviewed_at) || null,
      candidate_sha256: humanReviewHash || null,
      no_impersonation_confirmed: humanReview.no_impersonation_confirmed === true,
      quality_approved: humanReview.quality_approved === true,
    },
  };
}

function renderGeneratedVoiceReviewMarkdown(packet = {}) {
  const review = packet.review || {};
  const evidence = packet.evidence || {};
  const lines = [
    "# Pulse Generated Voice Review",
    "",
    `Verdict: ${review.verdict || "RED"}`,
    `Reference: ${evidence.variants?.[0]?.path || "missing"}`,
    `SHA-256: ${evidence.variants?.[0]?.sha256 || "missing"}`,
    `Model: ${evidence.model?.id || "missing"} @ ${evidence.model?.revision || "missing"}`,
    `Licence: ${evidence.model?.licence || "missing"}`,
    "",
    "## Required operator decision",
    "",
    "Listen to the exact hash-bound candidate and approve only if it is clear, natural, distinct from a real person and suitable for Pulse Gaming narration.",
    "",
    "## Blockers",
    "",
    ...(review.blockers || []).map((blocker) => `- ${blocker}`),
    "",
    "This packet does not change live voice configuration, publish authority, tokens or platform state.",
    "",
  ];
  return lines.join("\n");
}

async function materializeGeneratedVoiceReviewPacket({
  referencePath,
  legacyAuditionReportPath,
  generatorScriptPath,
  outDir,
  modelRevision,
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedReferencePath = path.resolve(referencePath || "");
  const resolvedLegacyReportPath = path.resolve(legacyAuditionReportPath || "");
  const resolvedGeneratorScriptPath = path.resolve(generatorScriptPath || "");
  const resolvedOutDir = path.resolve(outDir || "");
  const [reference, legacyReport, legacyReportFingerprint, generatorFingerprint, generatorText] =
    await Promise.all([
      fingerprintFile(resolvedReferencePath),
      fs.readJson(resolvedLegacyReportPath),
      fingerprintFile(resolvedLegacyReportPath),
      fingerprintFile(resolvedGeneratorScriptPath),
      fs.readFile(resolvedGeneratorScriptPath, "utf8"),
    ]);
  const legacyMatches = (Array.isArray(legacyReport.variants) ? legacyReport.variants : [])
    .filter((variant) => clean(variant?.name) === "no_ref_default");
  const legacyVariant = legacyMatches.length === 1 ? legacyMatches[0] : null;
  const modelDeclaredByGenerator =
    /VoxCPM\.from_pretrained\(\s*["']openbmb\/VoxCPM2["']/.test(generatorText);
  const noReferenceGeneration = Boolean(
    legacyVariant &&
      samePath(legacyVariant.path, resolvedReferencePath) &&
      legacyVariant.reference === null &&
      legacyVariant.prompt_text === false,
  );
  const evidence = {
    schema_version: 2,
    generated_at: generatedAt,
    model: {
      id: modelDeclaredByGenerator ? VOXCPM_MODEL_ID : null,
      revision: clean(modelRevision) || null,
      licence: VOXCPM_MODEL_LICENCE,
      source_url: VOXCPM_MODEL_SOURCE_URL,
    },
    provenance: {
      kind: "legacy_audition_report_envelope",
      legacy_report_path: resolvedLegacyReportPath,
      legacy_report_sha256: legacyReportFingerprint.sha256,
      legacy_report_size_bytes: legacyReportFingerprint.size_bytes,
      generator_script_path: resolvedGeneratorScriptPath,
      generator_script_sha256: generatorFingerprint.sha256,
      generator_script_size_bytes: generatorFingerprint.size_bytes,
      model_declared_by_generator: modelDeclaredByGenerator,
      legacy_variant_no_reference: noReferenceGeneration,
    },
    variants: [{
      name: "no_ref_default",
      path: resolvedReferencePath,
      reference: noReferenceGeneration ? null : "unverified",
      prompt_text: noReferenceGeneration ? false : null,
      generation_mode: noReferenceGeneration ? "no_reference" : "unverified",
      sha256: reference.sha256,
      size_bytes: reference.size_bytes,
      sample_rate_hz: Number(legacyReport.model_sample_rate) || null,
    }],
  };
  await fs.ensureDir(resolvedOutDir);
  const evidencePath = path.join(
    resolvedOutDir,
    "generated_voice_audition_evidence.json",
  );
  await fs.writeJson(evidencePath, evidence, { spaces: 2 });
  const review = await inspectGeneratedVoiceReference({
    referencePath: resolvedReferencePath,
    auditionReportPath: evidencePath,
    variantName: "no_ref_default",
    humanReview: {
      status: "pending",
      candidate_sha256: reference.sha256,
    },
  });
  review.generated_at = generatedAt;
  const reviewPath = path.join(
    resolvedOutDir,
    "generated_voice_reference_review.json",
  );
  const markdownPath = path.join(
    resolvedOutDir,
    "generated_voice_reference_review.md",
  );
  await fs.writeJson(reviewPath, review, { spaces: 2 });
  await fs.writeFile(
    markdownPath,
    renderGeneratedVoiceReviewMarkdown({ evidence, review }),
    "utf8",
  );
  return {
    evidence,
    review,
    paths: {
      evidence_json: evidencePath,
      review_json: reviewPath,
      review_markdown: markdownPath,
    },
  };
}

function generationReceiptBlockers({
  receipt = {},
  referenceInspection = {},
  audioFingerprint = {},
} = {}) {
  const blockers = [];
  if (Number(receipt.schema_version) !== 1) {
    blockers.push("generated_narration_receipt_schema_invalid");
  }
  if (clean(receipt.provider_id) !== "pulse_local_tts") {
    blockers.push("generated_narration_provider_unverified");
  }
  if (clean(receipt.model_id) !== VOXCPM_MODEL_ID) {
    blockers.push("generated_narration_model_id_mismatch");
  }
  if (clean(receipt.model_revision) !== clean(referenceInspection.model?.revision)) {
    blockers.push("generated_narration_model_revision_mismatch");
  }
  if (clean(receipt.generation_mode) !== "approved_generated_reference") {
    blockers.push("generated_narration_generation_mode_unverified");
  }
  if (
    clean(receipt.reference_sha256).toLowerCase() !==
    clean(referenceInspection.reference?.sha256).toLowerCase()
  ) {
    blockers.push("generated_narration_reference_hash_mismatch");
  }
  if (
    clean(receipt.final_audio_sha256).toLowerCase() !== audioFingerprint.sha256
  ) {
    blockers.push("generated_narration_audio_hash_mismatch");
  }
  if (Number(receipt.final_audio_size_bytes) !== audioFingerprint.size_bytes) {
    blockers.push("generated_narration_audio_size_mismatch");
  }
  if (!clean(receipt.generated_at)) {
    blockers.push("generated_narration_generation_time_missing");
  }
  return blockers;
}

async function validateGeneratedNarrationRightsEvidence({
  evidence = {},
  audioPath,
  targetPlatforms = ["youtube"],
} = {}) {
  const blockers = [];
  const resolvedAudioPath = audioPath ? path.resolve(audioPath) : "";
  const audioPresent = Boolean(
    resolvedAudioPath && await fs.pathExists(resolvedAudioPath),
  );
  const audioFingerprint = audioPresent
    ? await fingerprintFile(resolvedAudioPath)
    : { sha256: null, size_bytes: 0 };
  const model = evidence.model || {};
  const reference = evidence.reference || {};
  const humanReview = evidence.human_review || {};
  const lineage = evidence.lineage || {};
  const rights = evidence.rights || {};
  const allowedPlatforms = unique(
    (Array.isArray(rights.allowed_platforms) ? rights.allowed_platforms : [])
      .map((item) => clean(item).toLowerCase()),
  );

  if (Number(evidence.schema_version) !== 1) {
    blockers.push("generated_narration_rights_schema_invalid");
  }
  if (clean(evidence.evidence_kind) !== "local_generated_narration_rights") {
    blockers.push("generated_narration_rights_kind_invalid");
  }
  if (clean(evidence.verdict).toUpperCase() !== "GREEN") {
    blockers.push("generated_narration_rights_not_green");
  }
  if (Array.isArray(evidence.blockers) && evidence.blockers.length) {
    blockers.push("generated_narration_rights_declares_blockers");
  }
  if (clean(evidence.provider_id) !== "pulse_local_tts") {
    blockers.push("generated_narration_provider_unverified");
  }
  if (clean(model.id) !== VOXCPM_MODEL_ID) {
    blockers.push("generated_narration_model_id_mismatch");
  }
  if (!/^[a-f0-9]{40}$/i.test(clean(model.revision))) {
    blockers.push("generated_narration_model_revision_unverified");
  }
  if (clean(model.licence).toLowerCase() !== VOXCPM_MODEL_LICENCE.toLowerCase()) {
    blockers.push("generated_narration_model_licence_unverified");
  }
  if (clean(model.source_url).replace(/\/+$/, "") !== VOXCPM_MODEL_SOURCE_URL) {
    blockers.push("generated_narration_model_source_unverified");
  }
  if (!validSha256(reference.sha256)) {
    blockers.push("generated_narration_reference_hash_missing");
  }
  if (clean(reference.generation_mode) !== "no_reference") {
    blockers.push("generated_narration_reference_mode_unverified");
  }
  if (reference.human_voice_source_used !== false) {
    blockers.push("generated_narration_human_voice_source_unverified");
  }
  if (reference.prompt_reference_used !== false) {
    blockers.push("generated_narration_prompt_reference_unverified");
  }
  if (clean(humanReview.status).toLowerCase() !== "approved") {
    blockers.push("generated_narration_human_review_missing");
  }
  if (!clean(humanReview.reviewer) || !clean(humanReview.reviewed_at)) {
    blockers.push("generated_narration_human_review_identity_missing");
  }
  if (
    clean(humanReview.candidate_sha256).toLowerCase() !==
    clean(reference.sha256).toLowerCase()
  ) {
    blockers.push("generated_narration_human_review_hash_mismatch");
  }
  if (
    humanReview.no_impersonation_confirmed !== true ||
    humanReview.quality_approved !== true
  ) {
    blockers.push("generated_narration_human_review_incomplete");
  }
  if (Number(lineage.receipt_schema_version) !== 1) {
    blockers.push("generated_narration_receipt_schema_invalid");
  }
  if (clean(lineage.generation_mode) !== "approved_generated_reference") {
    blockers.push("generated_narration_generation_mode_unverified");
  }
  if (
    clean(lineage.reference_sha256).toLowerCase() !==
    clean(reference.sha256).toLowerCase()
  ) {
    blockers.push("generated_narration_reference_hash_mismatch");
  }
  if (!audioPresent) blockers.push("generated_narration_audio_missing");
  if (
    clean(lineage.final_audio_sha256).toLowerCase() !== audioFingerprint.sha256
  ) {
    blockers.push("generated_narration_audio_hash_mismatch");
  }
  if (Number(lineage.final_audio_size_bytes) !== audioFingerprint.size_bytes) {
    blockers.push("generated_narration_audio_size_mismatch");
  }
  if (
    rights.licence_basis !== "apache_2_0_voxcpm2_model_generated_voice" ||
    rights.commercial_use_allowed !== true ||
    rights.live_publish_allowed !== true ||
    rights.no_human_voice_source !== true ||
    rights.no_impersonation_confirmed !== true
  ) {
    blockers.push("generated_narration_commercial_rights_incomplete");
  }
  const missingPlatforms = unique(targetPlatforms.map((item) => clean(item).toLowerCase()))
    .filter((platform) => !allowedPlatforms.includes(platform));
  if (missingPlatforms.length) {
    blockers.push("generated_narration_platform_scope_incomplete");
  }
  return {
    verdict: blockers.length ? "RED" : "GREEN",
    blockers: unique(blockers),
    audio_sha256: audioFingerprint.sha256,
    audio_size_bytes: audioFingerprint.size_bytes,
  };
}

async function materializeGeneratedNarrationRights({
  storyId,
  audioPath,
  artifactDir,
  referenceReviewPath,
  generationReceipt = {},
  targetPlatforms = ["youtube"],
  generatedAt = new Date().toISOString(),
} = {}) {
  const id = safeId(storyId);
  const resolvedArtifactDir = path.resolve(artifactDir || "");
  const resolvedAudioPath = path.resolve(audioPath || "");
  const resolvedReferenceReviewPath = path.resolve(referenceReviewPath || "");
  const inputBlockers = [];
  if (!id) inputBlockers.push("generated_narration_story_id_missing");
  if (!await fs.pathExists(resolvedAudioPath)) {
    inputBlockers.push("generated_narration_audio_missing");
  }
  if (!await fs.pathExists(resolvedReferenceReviewPath)) {
    inputBlockers.push("generated_voice_reference_review_missing");
  }
  const audioFingerprint = inputBlockers.includes("generated_narration_audio_missing")
    ? { sha256: null, size_bytes: 0 }
    : await fingerprintFile(resolvedAudioPath);
  const storedReview = inputBlockers.includes("generated_voice_reference_review_missing")
    ? {}
    : await fs.readJson(resolvedReferenceReviewPath).catch(() => ({}));
  const referenceInspection = await inspectGeneratedVoiceReference({
    referencePath: storedReview.reference?.path,
    auditionReportPath: storedReview.reference?.audition_report_path,
    variantName: "no_ref_default",
    humanReview: storedReview.human_review || {},
  });
  const blockers = unique([
    ...inputBlockers,
    ...referenceInspection.blockers,
    ...generationReceiptBlockers({
      receipt: generationReceipt,
      referenceInspection,
      audioFingerprint,
    }),
  ]);
  const green = blockers.length === 0;
  const platforms = unique(targetPlatforms.map((item) => clean(item).toLowerCase()));
  const evidence = {
    schema_version: 1,
    evidence_kind: "local_generated_narration_rights",
    generated_at: generatedAt,
    story_id: id || null,
    verdict: green ? "GREEN" : "RED",
    blockers,
    provider_id: "pulse_local_tts",
    model: referenceInspection.model,
    reference: referenceInspection.reference,
    human_review: referenceInspection.human_review,
    lineage: {
      receipt_schema_version: Number(generationReceipt.schema_version) || null,
      generation_mode: clean(generationReceipt.generation_mode) || null,
      generated_at: clean(generationReceipt.generated_at) || null,
      reference_sha256: clean(generationReceipt.reference_sha256).toLowerCase() || null,
      final_audio_path: resolvedAudioPath || null,
      final_audio_sha256: audioFingerprint.sha256,
      final_audio_size_bytes: audioFingerprint.size_bytes,
    },
    rights: {
      licence_basis: "apache_2_0_voxcpm2_model_generated_voice",
      allowed_use: "pulse_gaming_editorial_narration",
      allowed_platforms: platforms,
      commercial_use_allowed: green,
      no_human_voice_source: referenceInspection.reference?.human_voice_source_used === false,
      no_impersonation_confirmed:
        referenceInspection.human_review?.no_impersonation_confirmed === true,
      live_publish_allowed: green,
    },
  };
  const evidencePath = path.join(
    resolvedArtifactDir,
    "rights",
    "local-generated-narration-rights.json",
  );
  await fs.ensureDir(path.dirname(evidencePath));
  await fs.writeJson(evidencePath, evidence, { spaces: 2 });
  const evidenceFingerprint = await fingerprintFile(evidencePath);
  const rightsRecord = {
    asset_id: `${id || "story"}_audio_path`,
    asset_type: "narration_audio",
    kind: "narration",
    path: resolvedAudioPath || null,
    source_url: `local://pulse-local-tts/${id || "story"}`,
    source_type: "local_tts_voice",
    source_owner: "Pulse Gaming",
    creator: "Pulse Gaming via VoxCPM2",
    provider_id: "pulse_local_tts",
    provider_name: "Pulse Local TTS",
    licence_basis: "apache_2_0_voxcpm2_model_generated_voice",
    allowed_use: "pulse_gaming_editorial_narration",
    allowed_platforms: platforms,
    commercial_use_allowed: green,
    credit_required: false,
    expiry: null,
    risk_score: green ? 0.08 : 0.8,
    approval_status: green
      ? "approved_generated_voice_reference"
      : "blocked_generated_voice_evidence",
    verdict: green ? "GREEN" : "RED",
    live_publish_allowed: green,
    requires_human_legal_review_before_publish: !green,
    rights_grant: green,
    evidence_file: evidencePath,
    evidence_reference: evidencePath,
    evidence_sha256: evidenceFingerprint.sha256,
    evidence_size_bytes: evidenceFingerprint.size_bytes,
    asset_sha256: audioFingerprint.sha256,
    asset_size_bytes: audioFingerprint.size_bytes,
  };
  return {
    schema_version: 1,
    generated_at: generatedAt,
    story_id: id || null,
    verdict: green ? "GREEN" : "RED",
    blockers,
    evidence,
    rights_record: rightsRecord,
    paths: {
      evidence_json: evidencePath,
    },
  };
}

module.exports = {
  VOXCPM_MODEL_ID,
  VOXCPM_MODEL_LICENCE,
  VOXCPM_MODEL_SOURCE_URL,
  fingerprintFile,
  inspectGeneratedVoiceReference,
  materializeGeneratedNarrationRights,
  materializeGeneratedVoiceReviewPacket,
  renderGeneratedVoiceReviewMarkdown,
  validateGeneratedNarrationRightsEvidence,
};

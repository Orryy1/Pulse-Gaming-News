"use strict";

const path = require("node:path");
const mediaPaths = require("../media-paths");
const {
  resolvePulseScriptContract,
  validatePulseScriptRuntime,
} = require("./pulse-editorial-contract");
const {
  sha256File,
  sha256Text,
} = require("./publication-request-fingerprint");

const FINAL_REVIEW_SCHEMA = "pulse-final-publication-review-v1";
const PREFLIGHT_SCHEMA = "pulse-publication-review-evidence-v1";
const RENDER_MANIFEST_SCHEMA = "pulse-render-manifest-v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REVIEWED_LEGACY_RENDER_FAILURE =
  "legacy_unstamped_render_requires_rerender";
const LEGACY_SCRIPT_TOO_SHORT_PATTERN =
  /^script_too_short \((\d+) words, min (\d+)\)$/;

class GovernedReviewedContentQaError extends Error {
  constructor(codes) {
    const values = Array.isArray(codes) ? codes : [codes];
    super(values[0] || "governed_reviewed_content_qa_invalid");
    this.name = "GovernedReviewedContentQaError";
    this.code = values[0] || "governed_reviewed_content_qa_invalid";
    this.codes = [...new Set(values.filter(Boolean))];
  }
}

function text(value) {
  return String(value || "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function isSha256(value) {
  return SHA256_PATTERN.test(lower(value));
}

function samePath(left, right) {
  if (!text(left) || !text(right)) return false;
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function addPair(blockers, actual, expected, code) {
  if (!actual || actual !== expected) blockers.push(code);
}

function allArtifactEvidencePresent(value) {
  return [
    "final_mp4_exists",
    "narration_audio_exists",
    "word_timestamps_exist",
    "motion_materialised",
    "hashes_verified",
  ].every((field) => value?.[field] === true);
}

async function resolveGovernedReviewedContentQaAuthority({
  story,
  scheduledDispatch,
  exactDispatchBinding,
  resolveMediaPath = mediaPaths.resolveExisting,
} = {}) {
  const blockers = [];
  const preflight = story?.preflight_evidence;
  const review = story?.final_publication_review;
  const scheduledEvidence = scheduledDispatch?.publicationEvidence;
  const rendererManifest = preflight?.renderer_manifest;
  const reviewedRenderer = rendererManifest?.renderer;
  const finalRenderer = review?.renderer_manifest;

  if (!story || typeof story !== "object") {
    throw new GovernedReviewedContentQaError("governed_review_story_required");
  }
  if (
    story.approved !== true &&
    story.approved !== 1
  ) {
    blockers.push("governed_review_human_editorial_approval_required");
  }
  if (
    story.auto_approved !== false &&
    story.auto_approved !== 0
  ) {
    blockers.push("governed_review_auto_approval_must_be_false");
  }
  if (lower(story.render_review_status) !== "approved") {
    blockers.push("governed_review_render_approval_required");
  }
  if (lower(story.operator_review_status) !== "script_approved") {
    blockers.push("governed_review_script_approval_required");
  }
  if (preflight?.schema_version !== PREFLIGHT_SCHEMA) {
    blockers.push("governed_review_preflight_schema_invalid");
  }
  if (review?.schema_version !== FINAL_REVIEW_SCHEMA) {
    blockers.push("governed_review_final_schema_invalid");
  }
  if (rendererManifest?.schema_version !== RENDER_MANIFEST_SCHEMA) {
    blockers.push("governed_review_renderer_schema_invalid");
  }

  const storyId = text(story.id);
  const channelId = text(story.channel_id || "pulse-gaming");
  for (const [actual, expected, code] of [
    [text(preflight?.story_id), storyId, "governed_review_preflight_story_mismatch"],
    [text(review?.story_id), storyId, "governed_review_final_story_mismatch"],
    [
      text(rendererManifest?.story_id),
      storyId,
      "governed_review_renderer_story_mismatch",
    ],
    [
      text(preflight?.channel_id),
      channelId,
      "governed_review_preflight_channel_mismatch",
    ],
    [
      text(review?.channel_id),
      channelId,
      "governed_review_final_channel_mismatch",
    ],
    [
      text(rendererManifest?.channel_id),
      channelId,
      "governed_review_renderer_channel_mismatch",
    ],
  ]) {
    addPair(blockers, actual, expected, code);
  }

  if (
    !exactDispatchBinding ||
    !scheduledDispatch ||
    !scheduledEvidence
  ) {
    blockers.push("governed_review_exact_scheduled_authority_required");
  } else {
    for (const [actual, expected, code] of [
      [
        text(exactDispatchBinding.storyId),
        storyId,
        "governed_review_exact_story_mismatch",
      ],
      [
        text(exactDispatchBinding.platform),
        "youtube",
        "governed_review_exact_platform_mismatch",
      ],
      [
        text(exactDispatchBinding.scheduledFor),
        text(scheduledDispatch.scheduledFor),
        "governed_review_exact_schedule_mismatch",
      ],
      [
        text(exactDispatchBinding.scheduledEventId),
        text(scheduledDispatch.event?.id),
        "governed_review_exact_event_mismatch",
      ],
      [
        text(exactDispatchBinding.dispatchIdempotencyKey),
        text(scheduledDispatch.idempotencyKey),
        "governed_review_exact_dispatch_key_mismatch",
      ],
      [
        lower(exactDispatchBinding.requestFingerprint),
        lower(scheduledDispatch.requestFingerprint),
        "governed_review_exact_request_fingerprint_mismatch",
      ],
    ]) {
      addPair(blockers, actual, expected, code);
    }
  }

  const script = String(story.full_script || "");
  const currentScriptSha256 = sha256Text(script);
  let resolvedMediaPath = null;
  let currentMediaSha256 = null;
  try {
    resolvedMediaPath = await resolveMediaPath(story.exported_path);
    if (!resolvedMediaPath) throw new Error("media_not_found");
    currentMediaSha256 = await sha256File(resolvedMediaPath);
  } catch {
    blockers.push("governed_review_current_media_hash_unavailable");
  }

  const expectedScriptHashes = [
    story.script_sha256,
    story.script_approved_sha256,
    preflight?.script_sha256,
    review?.script_sha256,
  ];
  if (
    expectedScriptHashes.some(
      (value) =>
        !isSha256(value) || lower(value) !== currentScriptSha256,
    )
  ) {
    blockers.push("governed_review_current_script_hash_mismatch");
  }
  const expectedMediaHashes = [
    preflight?.media_sha256,
    rendererManifest?.output?.sha256,
    review?.media_sha256,
    review?.final_mp4?.sha256,
  ];
  if (
    !isSha256(currentMediaSha256) ||
    expectedMediaHashes.some(
      (value) =>
        !isSha256(value) || lower(value) !== currentMediaSha256,
    )
  ) {
    blockers.push("governed_review_current_media_hash_mismatch");
  }
  if (
    !samePath(story.exported_path, review?.final_mp4?.path) ||
    (resolvedMediaPath &&
      !samePath(resolvedMediaPath, review?.final_mp4?.path))
  ) {
    blockers.push("governed_review_final_media_path_mismatch");
  }

  if (!allArtifactEvidencePresent(preflight?.artifact_evidence)) {
    blockers.push("governed_review_artifact_evidence_incomplete");
  }
  if (text(review?.qa_report?.verdict).toUpperCase() !== "PASS") {
    blockers.push("governed_review_final_qa_pass_required");
  }
  if (
    text(finalRenderer?.verdict).toUpperCase() !== "PASS" ||
    finalRenderer?.publishable_under_human_review !== true
  ) {
    blockers.push("governed_review_renderer_publishability_required");
  }
  if (
    lower(rendererManifest?.output?.platform_video_qa_result) !== "pass"
  ) {
    blockers.push("governed_review_platform_video_qa_pass_required");
  }
  if (
    !text(review?.reviewed_by) ||
    Number.isNaN(Date.parse(review?.reviewed_at))
  ) {
    blockers.push("governed_review_operator_evidence_required");
  }

  const rendererManifestSha256 = lower(
    preflight?.renderer_manifest_sha256,
  );
  for (const [actual, expected, code] of [
    [
      lower(review?.renderer_manifest?.canonical_sha256),
      rendererManifestSha256,
      "governed_review_renderer_hash_mismatch",
    ],
    [
      lower(review?.qa_report?.sha256),
      lower(preflight?.qa_report_sha256),
      "governed_review_qa_hash_mismatch",
    ],
    [
      lower(scheduledEvidence?.source_evidence_sha256),
      lower(preflight?.source_evidence_sha256),
      "governed_review_scheduled_source_hash_mismatch",
    ],
    [
      lower(scheduledEvidence?.qa_report_sha256),
      lower(preflight?.qa_report_sha256),
      "governed_review_scheduled_qa_hash_mismatch",
    ],
    [
      lower(scheduledEvidence?.rights_ledger_sha256),
      lower(preflight?.rights_ledger_sha256),
      "governed_review_scheduled_rights_hash_mismatch",
    ],
    [
      lower(scheduledEvidence?.renderer_manifest_sha256),
      rendererManifestSha256,
      "governed_review_scheduled_renderer_hash_mismatch",
    ],
    [
      lower(scheduledEvidence?.publication_metadata_sha256),
      lower(preflight?.publication_metadata_sha256),
      "governed_review_scheduled_metadata_hash_mismatch",
    ],
    [
      text(scheduledEvidence?.renderer?.id),
      text(reviewedRenderer?.id),
      "governed_review_scheduled_renderer_id_mismatch",
    ],
    [
      text(scheduledEvidence?.renderer?.role),
      text(reviewedRenderer?.role),
      "governed_review_scheduled_renderer_role_mismatch",
    ],
    [
      text(scheduledEvidence?.renderer?.version),
      text(reviewedRenderer?.version),
      "governed_review_scheduled_renderer_version_mismatch",
    ],
  ]) {
    addPair(blockers, actual, expected, code);
  }

  let contract = null;
  let runtime = null;
  try {
    contract = resolvePulseScriptContract({ story });
    runtime = validatePulseScriptRuntime({
      text: script,
      contract,
    });
    if (
      contract.format_family !== "short" ||
      runtime.result !== "pass"
    ) {
      blockers.push("governed_review_editorial_runtime_contract_failed");
    }
  } catch {
    blockers.push("governed_review_editorial_runtime_contract_invalid");
  }

  if (blockers.length) {
    throw new GovernedReviewedContentQaError(blockers);
  }
  return Object.freeze({
    storyId,
    channelId,
    scriptSha256: currentScriptSha256,
    mediaSha256: currentMediaSha256,
    resolvedMediaPath,
    renderer: Object.freeze({
      id: text(reviewedRenderer.id),
      role: text(reviewedRenderer.role),
      version: text(reviewedRenderer.version),
      manifestSha256: rendererManifestSha256,
    }),
    editorialContract: Object.freeze({ ...contract }),
    runtime: Object.freeze({ ...runtime }),
  });
}

function reconcileGovernedReviewedContentQa(result, authority) {
  const failures = Array.isArray(result?.failures)
    ? result.failures.slice()
    : [];
  const warnings = Array.isArray(result?.warnings)
    ? result.warnings.slice()
    : [];
  const retained = [];
  const resolved = [];
  for (const failure of failures) {
    if (failure === REVIEWED_LEGACY_RENDER_FAILURE) {
      resolved.push(failure);
      continue;
    }
    const match = LEGACY_SCRIPT_TOO_SHORT_PATTERN.exec(String(failure));
    if (
      match &&
      Number(match[1]) === authority.runtime.word_count &&
      authority.runtime.result === "pass"
    ) {
      resolved.push(failure);
      continue;
    }
    retained.push(failure);
  }
  warnings.push(
    ...resolved.map((failure) => `governed_review_resolved:${failure}`),
  );
  return {
    result: retained.length
      ? "fail"
      : warnings.length
        ? "warn"
        : "pass",
    failures: retained,
    warnings: [...new Set(warnings)],
    resolved,
  };
}

function hasGovernedReviewedContentQaEvidence(story) {
  return Boolean(
    story?.preflight_evidence ||
      story?.final_publication_review ||
      lower(story?.render_review_status) === "approved",
  );
}

module.exports = {
  FINAL_REVIEW_SCHEMA,
  GovernedReviewedContentQaError,
  PREFLIGHT_SCHEMA,
  REVIEWED_LEGACY_RENDER_FAILURE,
  hasGovernedReviewedContentQaEvidence,
  reconcileGovernedReviewedContentQa,
  resolveGovernedReviewedContentQaAuthority,
};

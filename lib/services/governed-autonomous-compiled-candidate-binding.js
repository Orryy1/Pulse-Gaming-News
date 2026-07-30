"use strict";

const crypto = require("node:crypto");

const {
  validateGovernedFastNewsLaneDecision,
} = require("./governed-fast-news-lane-decision");

const CANDIDATE_REVISION_SCHEMA_VERSION =
  "pulse-governed-autonomous-breaking-candidate-revision-v1";
const REQUEST_FINGERPRINT_SCHEMA_VERSION =
  "pulse-governed-autonomous-breaking-production-request-fingerprint-v1";
const CHANNEL_ID = "pulse-gaming";
const LANE_ID = "breaking_short";
const PLATFORM = "youtube";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STORY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const REVISION_FIELDS = new Set([
  "schema_version",
  "legacy_story_id",
  "story_id",
  "scheduled_for",
  "inventory_file_sha256",
  "inventory_canonical_sha256",
  "primary_source_packet_sha256",
  "publication_source_evidence_sha256",
  "rights_ledger_sha256",
  "supplemental_source_packet_sha256",
  "final_script_sha256",
  "fast_news_lane_decision_sha256",
  "locked_intake_sha256",
  "creative_package_sha256",
  "runtime_policy_sha256",
]);
const BINDING_FIELDS = new Set([
  "candidate_revision",
  "candidate_revision_sha256",
  "request_fingerprint",
  "story_id",
  "channel_id",
  "lane_id",
  "platform",
  "scheduled_for",
  "source_evidence_sha256",
  "locked_intake_binding",
  "creative_package",
  "runtime_policy",
]);

class GovernedAutonomousCompiledCandidateBindingError extends Error {
  constructor(code) {
    super(code);
    this.name =
      "GovernedAutonomousCompiledCandidateBindingError";
    this.code = code;
  }
}

function fail(code) {
  throw new GovernedAutonomousCompiledCandidateBindingError(
    code,
  );
}

function text(value) {
  return String(value ?? "").trim();
}

function plainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactFields(value, fields, code) {
  if (!plainObject(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    fail(code);
  }
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((field) => value[field] !== undefined)
        .sort()
        .map((field) => [field, stableValue(value[field])]),
    );
  }
  return value;
}

function canonicalSha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function exactSha256(value, code) {
  const hash = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(hash)) fail(code);
  return hash;
}

function exactStoryId(value, code) {
  const storyId = text(value);
  if (!STORY_ID_PATTERN.test(storyId)) fail(code);
  return storyId;
}

function exactTimestamp(value, code) {
  const raw = text(value);
  const timestamp = Date.parse(raw);
  if (
    !raw ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== raw
  ) {
    fail(code);
  }
  return raw;
}

function exactHashList(value, code) {
  if (!Array.isArray(value) || value.length > 32) fail(code);
  const hashes = value.map((entry) =>
    exactSha256(entry, code),
  );
  if (new Set(hashes).size !== hashes.length) fail(code);
  return hashes;
}

function deepFreeze(value) {
  if (
    value &&
    typeof value === "object" &&
    !Object.isFrozen(value)
  ) {
    for (const entry of Object.values(value)) {
      deepFreeze(entry);
    }
    Object.freeze(value);
  }
  return value;
}

function createGovernedAutonomousCompiledCandidateRevision(
  value,
) {
  exactFields(
    value,
    REVISION_FIELDS,
    "compiled_candidate_revision_fields_invalid",
  );
  if (
    value.schema_version !==
    CANDIDATE_REVISION_SCHEMA_VERSION
  ) {
    fail("compiled_candidate_revision_schema_invalid");
  }
  return deepFreeze({
    schema_version: CANDIDATE_REVISION_SCHEMA_VERSION,
    legacy_story_id: exactStoryId(
      value.legacy_story_id,
      "compiled_candidate_legacy_story_id_invalid",
    ),
    story_id: exactStoryId(
      value.story_id,
      "compiled_candidate_story_id_invalid",
    ),
    scheduled_for: exactTimestamp(
      value.scheduled_for,
      "compiled_candidate_scheduled_for_invalid",
    ),
    inventory_file_sha256: exactSha256(
      value.inventory_file_sha256,
      "compiled_candidate_inventory_file_sha256_invalid",
    ),
    inventory_canonical_sha256: exactSha256(
      value.inventory_canonical_sha256,
      "compiled_candidate_inventory_canonical_sha256_invalid",
    ),
    primary_source_packet_sha256: exactSha256(
      value.primary_source_packet_sha256,
      "compiled_candidate_primary_source_sha256_invalid",
    ),
    publication_source_evidence_sha256: exactSha256(
      value.publication_source_evidence_sha256,
      "compiled_candidate_publication_source_sha256_invalid",
    ),
    rights_ledger_sha256: exactSha256(
      value.rights_ledger_sha256,
      "compiled_candidate_rights_sha256_invalid",
    ),
    supplemental_source_packet_sha256: exactHashList(
      value.supplemental_source_packet_sha256,
      "compiled_candidate_supplemental_source_sha256_invalid",
    ),
    final_script_sha256: exactSha256(
      value.final_script_sha256,
      "compiled_candidate_final_script_sha256_invalid",
    ),
    fast_news_lane_decision_sha256: exactSha256(
      value.fast_news_lane_decision_sha256,
      "compiled_candidate_fast_news_decision_sha256_invalid",
    ),
    locked_intake_sha256: exactSha256(
      value.locked_intake_sha256,
      "compiled_candidate_locked_intake_sha256_invalid",
    ),
    creative_package_sha256: exactSha256(
      value.creative_package_sha256,
      "compiled_candidate_creative_package_sha256_invalid",
    ),
    runtime_policy_sha256: exactSha256(
      value.runtime_policy_sha256,
      "compiled_candidate_runtime_policy_sha256_invalid",
    ),
  });
}

function validateGovernedAutonomousCompiledCandidateBinding(
  value,
) {
  exactFields(
    value,
    BINDING_FIELDS,
    "compiled_candidate_binding_fields_invalid",
  );
  const storyId = exactStoryId(
    value.story_id,
    "compiled_candidate_story_id_invalid",
  );
  const scheduledFor = exactTimestamp(
    value.scheduled_for,
    "compiled_candidate_scheduled_for_invalid",
  );
  if (
    text(value.channel_id) !== CHANNEL_ID ||
    text(value.lane_id) !== LANE_ID ||
    text(value.platform).toLowerCase() !== PLATFORM
  ) {
    fail("compiled_candidate_scope_mismatch");
  }
  const sourceEvidenceSha256 = exactSha256(
    value.source_evidence_sha256,
    "compiled_candidate_primary_source_sha256_invalid",
  );
  const candidateRevision =
    createGovernedAutonomousCompiledCandidateRevision(
      value.candidate_revision,
    );
  const candidateRevisionSha256 = exactSha256(
    value.candidate_revision_sha256,
    "compiled_candidate_revision_sha256_invalid",
  );
  if (
    canonicalSha256(candidateRevision) !==
    candidateRevisionSha256
  ) {
    fail("compiled_candidate_revision_sha256_mismatch");
  }

  if (
    !plainObject(value.locked_intake_binding) ||
    text(value.locked_intake_binding.story_id) !== storyId ||
    !plainObject(value.locked_intake_binding.locked_intake) ||
    !plainObject(value.creative_package) ||
    !plainObject(value.runtime_policy)
  ) {
    fail("compiled_candidate_surface_invalid");
  }
  const lockedIntake =
    value.locked_intake_binding.locked_intake;
  const databaseStoryBinding =
    lockedIntake.database_story_binding;
  if (
    !plainObject(databaseStoryBinding) ||
    text(databaseStoryBinding.canonical_story_id) !== storyId
  ) {
    fail("compiled_candidate_database_story_binding_mismatch");
  }
  const legacyStoryId = exactStoryId(
    databaseStoryBinding.database_story_id,
    "compiled_candidate_legacy_story_id_invalid",
  );
  if (
    candidateRevision.story_id !== storyId ||
    candidateRevision.legacy_story_id !== legacyStoryId ||
    candidateRevision.scheduled_for !== scheduledFor ||
    candidateRevision.primary_source_packet_sha256 !==
      sourceEvidenceSha256 ||
    candidateRevision.inventory_file_sha256 !==
      text(lockedIntake.inventory_file_sha256).toLowerCase() ||
    candidateRevision.final_script_sha256 !==
      text(lockedIntake.final_script_sha256).toLowerCase()
  ) {
    fail("compiled_candidate_revision_binding_mismatch");
  }

  let fastNewsLaneDecision;
  try {
    fastNewsLaneDecision =
      validateGovernedFastNewsLaneDecision(
        lockedIntake.fast_news_lane_decision,
        {
          story_id: legacyStoryId,
          scheduled_for: scheduledFor,
          operational_lane_id: LANE_ID,
          public_breaking_claim_authorised: false,
        },
      );
  } catch {
    fail("compiled_candidate_fast_news_decision_invalid");
  }
  if (
    candidateRevision.fast_news_lane_decision_sha256 !==
    fastNewsLaneDecision.decision_sha256
  ) {
    fail(
      "compiled_candidate_fast_news_decision_sha256_mismatch",
    );
  }
  if (
    candidateRevision.locked_intake_sha256 !==
    canonicalSha256(lockedIntake)
  ) {
    fail("compiled_candidate_locked_intake_sha256_mismatch");
  }
  if (
    candidateRevision.creative_package_sha256 !==
    canonicalSha256(value.creative_package)
  ) {
    fail(
      "compiled_candidate_creative_package_sha256_mismatch",
    );
  }
  if (
    candidateRevision.runtime_policy_sha256 !==
    canonicalSha256(value.runtime_policy)
  ) {
    fail("compiled_candidate_runtime_policy_sha256_mismatch");
  }

  const requestFingerprint = exactSha256(
    value.request_fingerprint,
    "compiled_candidate_request_fingerprint_invalid",
  );
  const expectedFingerprint = canonicalSha256({
    schema_version: REQUEST_FINGERPRINT_SCHEMA_VERSION,
    story_id: storyId,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    platform: PLATFORM,
    scheduled_for: scheduledFor,
    candidate_revision_sha256: candidateRevisionSha256,
    locked_intake_sha256:
      candidateRevision.locked_intake_sha256,
    creative_package_sha256:
      candidateRevision.creative_package_sha256,
    runtime_policy_sha256:
      candidateRevision.runtime_policy_sha256,
  });
  if (requestFingerprint !== expectedFingerprint) {
    fail("compiled_candidate_request_fingerprint_mismatch");
  }

  return deepFreeze({
    candidate_revision: structuredClone(candidateRevision),
    candidate_revision_sha256: candidateRevisionSha256,
    request_fingerprint: requestFingerprint,
  });
}

module.exports = {
  CANDIDATE_REVISION_SCHEMA_VERSION,
  GovernedAutonomousCompiledCandidateBindingError,
  REQUEST_FINGERPRINT_SCHEMA_VERSION,
  canonicalSha256,
  createGovernedAutonomousCompiledCandidateRevision,
  validateGovernedAutonomousCompiledCandidateBinding,
};

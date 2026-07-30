"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

const {
  MODE,
  validateGovernedAutonomousWindowReservationSet,
} = require("./governed-autonomous-window-reservation-set");
const {
  REQUEST_SCHEMA_VERSION: PRODUCTION_REQUEST_SCHEMA_VERSION,
} = require("./governed-autonomous-production-coordinator");
const {
  validateGovernedAutonomousDatabaseStoryBinding,
} = require("./governed-autonomous-database-story-binding");
const {
  validateGovernedFastNewsLaneDecision,
} = require("./governed-fast-news-lane-decision");
const {
  validateGovernedAutonomousCompiledCandidateBinding,
} = require("./governed-autonomous-compiled-candidate-binding");

const BUILDER_SCHEMA_VERSION =
  "pulse-governed-autonomous-production-request-builder-input-v1";
const BUILDER_RESULT_SCHEMA_VERSION =
  "pulse-governed-autonomous-production-request-builder-result-v1";
const RUNTIME_POLICY_SCHEMA_VERSION =
  "pulse-governed-autonomous-production-runtime-policy-v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STORY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const INPUT_FIELDS = Object.freeze([
  "candidate_revision_sha256",
  "creative_package",
  "locked_intake_binding",
  "mode",
  "request_fingerprint",
  "reservation_set",
  "schema_version",
  "selected_role",
  "story_id",
  "runtime_policy",
]);
const INPUT_FIELDS_WITH_REVISION = Object.freeze([
  ...INPUT_FIELDS,
  "candidate_revision",
]);
const LOCKED_BINDING_FIELDS = Object.freeze([
  "locked_intake",
  "story_id",
]);
const LOCKED_INTAKE_FIELDS = Object.freeze([
  "allowed_roots",
  "canonical_identity_url",
  "contract",
  "database_story_binding",
  "experiment_dimensions",
  "final_script",
  "final_script_sha256",
  "freshness",
  "inventory_file_sha256",
  "inventory_path",
  "inventory_root",
  "presentation_claim_bindings",
  "script_claim_bindings",
  "supplemental_official_sources",
  "visual_brief",
]);
const LOCKED_INTAKE_FIELDS_WITH_FAST_NEWS = Object.freeze([
  ...LOCKED_INTAKE_FIELDS,
  "fast_news_lane_decision",
]);
const CREATIVE_FIELDS = Object.freeze([
  "description",
  "official_source_url",
  "required_attributions",
  "scenes",
  "subject_terms",
  "title",
]);
const RUNTIME_POLICY_FIELDS = Object.freeze([
  "candidate_source_root",
  "disclosure_policy",
  "generated_at",
  "mode",
  "narration",
  "safety",
  "schema_version",
  "visual_qa",
  "workspace_root",
]);
const NARRATION_FIELDS = Object.freeze([
  "model_id",
  "provider",
  "speed",
  "voice_id",
]);
const VISUAL_QA_FIELDS = Object.freeze(["reviewers"]);
const DISCLOSURE_FIELDS = Object.freeze([
  "policy_id",
  "policy_version",
]);
const SAFETY_FIELDS = Object.freeze([
  "database_authority",
  "database_mutated",
  "external_publish_authorised",
  "local_proof_only",
  "network_authority",
  "network_used",
  "oauth_or_token_authority",
  "oauth_or_tokens_mutated",
  "platform_contacted",
  "publish_authority",
  "scheduler_authority",
]);
const PRODUCTION_REQUEST_FIELDS = Object.freeze([
  "candidate_revision_sha256",
  "candidate_source_root",
  "candidate_workspace_relative_root",
  "creative",
  "disclosure_policy",
  "generated_at",
  "locked_intake",
  "mode",
  "narration",
  "request_fingerprint",
  "role",
  "scheduled_for",
  "schema_version",
  "visual_qa",
  "workspace_root",
]);
const PRODUCTION_REQUEST_FIELDS_WITH_REVISION = Object.freeze([
  ...PRODUCTION_REQUEST_FIELDS,
  "candidate_revision",
]);
const RESULT_FIELDS = Object.freeze([
  "builder_sha256",
  "mode",
  "production_request",
  "reservation_set_sha256",
  "role",
  "safety",
  "scheduled_for",
  "schema_version",
  "story_id",
]);
const FORBIDDEN_OPERATIONAL_FIELDS = new Set([
  "auto_publish",
  "database_authority",
  "database_mutated",
  "external_posting",
  "external_publish_authorised",
  "live_publish_attempted",
  "mutation_authority",
  "network_authority",
  "network_used",
  "oauth_authority",
  "oauth_or_token_authority",
  "oauth_or_tokens_mutated",
  "platform_authority",
  "platform_contacted",
  "platform_posting_authorised",
  "publish_authority",
  "publish_now",
  "scheduler_authority",
  "upload_authority",
]);

class GovernedAutonomousProductionRequestBuilderError extends Error {
  constructor(code) {
    super(code);
    this.name = "GovernedAutonomousProductionRequestBuilderError";
    this.code = code;
  }
}

function fail(code) {
  throw new GovernedAutonomousProductionRequestBuilderError(code);
}

function plainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function text(value) {
  return String(value ?? "").trim();
}

function exactFields(value, expected, code) {
  if (!plainObject(value)) fail(code);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((field, index) => field !== required[index])
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

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function exactSha256(value, code) {
  const hash = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(hash)) fail(code);
  return hash;
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
  return { raw, timestamp };
}

function exactGuardedWindow(value) {
  const parsed = exactTimestamp(
    value,
    "production_request_builder_scheduled_for_invalid",
  );
  const date = new Date(parsed.timestamp);
  if (
    ![9, 19].includes(date.getUTCHours()) ||
    date.getUTCMinutes() !== 0 ||
    date.getUTCSeconds() !== 0 ||
    date.getUTCMilliseconds() !== 0
  ) {
    fail("production_request_builder_guarded_window_required");
  }
  return parsed;
}

function exactStoryId(value, code) {
  const storyId = text(value);
  if (!STORY_ID_PATTERN.test(storyId)) fail(code);
  return storyId;
}

function exactAbsolutePath(value, code) {
  const supplied = text(value);
  if (
    !supplied ||
    !path.isAbsolute(supplied) ||
    path.resolve(supplied) !== supplied
  ) {
    fail(code);
  }
  return supplied;
}

function exactStringList(value, code, minimum = 0) {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    fail(code);
  }
  const normalised = value.map((entry) => entry.trim());
  if (new Set(normalised).size !== normalised.length) fail(code);
  return normalised;
}

function exactUrl(value, code) {
  const supplied = text(value);
  let parsed;
  try {
    parsed = new URL(supplied);
  } catch {
    fail(code);
  }
  if (!["https:", "http:"].includes(parsed.protocol)) fail(code);
  return supplied;
}

function assertNoAuthoritySmuggling(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) assertNoAuthoritySmuggling(entry);
    return;
  }
  for (const [field, entry] of Object.entries(value)) {
    const normalised = field.toLowerCase();
    const authorityLike =
      FORBIDDEN_OPERATIONAL_FIELDS.has(normalised) ||
      /(?:^|_)(?:authority|authorised|authorized|mutated|contacted)(?:_|$)/.test(
        normalised,
      );
    if (authorityLike && entry !== false) {
      fail(`production_request_builder_${normalised}_forbidden`);
    }
    assertNoAuthoritySmuggling(entry);
  }
}

function exactSafety(value) {
  exactFields(
    value,
    SAFETY_FIELDS,
    "production_request_builder_safety_fields_invalid",
  );
  for (const field of SAFETY_FIELDS) {
    const expected = field === "local_proof_only";
    if (value[field] !== expected) {
      fail(`production_request_builder_${field}_forbidden`);
    }
  }
  return structuredClone(value);
}

function exactLockedIntake(
  value,
  expectedStoryId,
  expectedScheduledFor,
) {
  exactFields(
    value,
    LOCKED_BINDING_FIELDS,
    "production_request_builder_locked_binding_fields_invalid",
  );
  if (
    exactStoryId(
      value.story_id,
      "production_request_builder_locked_story_invalid",
    ) !== expectedStoryId
  ) {
    fail("production_request_builder_locked_story_mismatch");
  }
  const lockedFields = Object.hasOwn(
    value.locked_intake,
    "fast_news_lane_decision",
  )
    ? LOCKED_INTAKE_FIELDS_WITH_FAST_NEWS
    : LOCKED_INTAKE_FIELDS;
  const locked = exactFields(
    value.locked_intake,
    lockedFields,
    "production_request_builder_locked_intake_fields_invalid",
  );
  const finalScript = String(locked.final_script ?? "").trim();
  if (
    !finalScript ||
    finalScript !== locked.final_script ||
    exactSha256(
      locked.final_script_sha256,
      "production_request_builder_script_sha256_invalid",
    ) !== sha256Bytes(Buffer.from(finalScript, "utf8"))
  ) {
    fail("production_request_builder_script_binding_invalid");
  }
  exactSha256(
    locked.inventory_file_sha256,
    "production_request_builder_inventory_sha256_invalid",
  );
  let databaseStoryBinding;
  try {
    databaseStoryBinding =
      validateGovernedAutonomousDatabaseStoryBinding(
      locked.database_story_binding,
      {
        canonical_story_id: expectedStoryId,
        canonical_identity_url:
          locked.canonical_identity_url,
        inventory_file_sha256:
          locked.inventory_file_sha256,
        final_script_sha256:
          locked.final_script_sha256,
      },
    );
  } catch {
    fail(
      "production_request_builder_database_story_binding_invalid",
    );
  }
  if (locked.fast_news_lane_decision !== undefined) {
    let decision;
    try {
      decision =
        validateGovernedFastNewsLaneDecision(
          locked.fast_news_lane_decision,
        );
    } catch {
      fail(
        "production_request_builder_fast_news_decision_invalid",
      );
    }
    if (
      decision.story_id !==
        databaseStoryBinding.database_story_id ||
      decision.inventory_file_sha256 !==
        locked.inventory_file_sha256 ||
      (expectedScheduledFor &&
        decision.scheduled_for !== expectedScheduledFor)
    ) {
      fail(
        "production_request_builder_fast_news_decision_binding_invalid",
      );
    }
  }
  exactAbsolutePath(
    locked.inventory_path,
    "production_request_builder_inventory_path_invalid",
  );
  exactAbsolutePath(
    locked.inventory_root,
    "production_request_builder_inventory_root_invalid",
  );
  exactStringList(
    locked.allowed_roots,
    "production_request_builder_allowed_roots_invalid",
    1,
  ).forEach((root) =>
    exactAbsolutePath(
      root,
      "production_request_builder_allowed_roots_invalid",
    ),
  );
  exactUrl(
    locked.canonical_identity_url,
    "production_request_builder_identity_url_invalid",
  );
  if (
    !Array.isArray(locked.script_claim_bindings) ||
    locked.script_claim_bindings.length === 0 ||
    !Array.isArray(locked.presentation_claim_bindings) ||
    !Array.isArray(locked.supplemental_official_sources) ||
    !plainObject(locked.contract) ||
    !plainObject(locked.freshness) ||
    !plainObject(locked.visual_brief) ||
    !plainObject(locked.experiment_dimensions)
  ) {
    fail("production_request_builder_locked_intake_invalid");
  }
  return structuredClone(locked);
}

function exactCreative(value) {
  const creative = exactFields(
    value,
    CREATIVE_FIELDS,
    "production_request_builder_creative_fields_invalid",
  );
  if (
    !Array.isArray(creative.scenes) ||
    creative.scenes.length === 0 ||
    !text(creative.title) ||
    !text(creative.description)
  ) {
    fail("production_request_builder_creative_invalid");
  }
  return {
    scenes: structuredClone(creative.scenes),
    title: text(creative.title),
    description: text(creative.description),
    official_source_url: exactUrl(
      creative.official_source_url,
      "production_request_builder_official_source_url_invalid",
    ),
    required_attributions: exactStringList(
      creative.required_attributions,
      "production_request_builder_attributions_invalid",
    ),
    subject_terms: exactStringList(
      creative.subject_terms,
      "production_request_builder_subject_terms_invalid",
      1,
    ),
  };
}

function exactNarration(value) {
  exactFields(
    value,
    NARRATION_FIELDS,
    "production_request_builder_narration_fields_invalid",
  );
  const provider = text(value.provider).toLowerCase();
  const speed = Number(value.speed);
  if (
    provider !== "elevenlabs" ||
    !text(value.voice_id) ||
    !text(value.model_id) ||
    !Number.isFinite(speed) ||
    speed <= 0
  ) {
    fail("production_request_builder_narration_invalid");
  }
  return {
    provider,
    voice_id: text(value.voice_id),
    model_id: text(value.model_id),
    speed,
  };
}

function exactVisualQa(value) {
  exactFields(
    value,
    VISUAL_QA_FIELDS,
    "production_request_builder_visual_qa_fields_invalid",
  );
  if (
    !Array.isArray(value.reviewers) ||
    value.reviewers.length < 2
  ) {
    fail("production_request_builder_visual_qa_invalid");
  }
  return structuredClone(value);
}

function exactDisclosurePolicy(value) {
  exactFields(
    value,
    DISCLOSURE_FIELDS,
    "production_request_builder_disclosure_fields_invalid",
  );
  if (
    !text(value.policy_id) ||
    !text(value.policy_version)
  ) {
    fail("production_request_builder_disclosure_invalid");
  }
  return {
    policy_id: text(value.policy_id),
    policy_version: text(value.policy_version),
  };
}

function exactRuntimePolicy(value, reservation) {
  exactFields(
    value,
    RUNTIME_POLICY_FIELDS,
    "production_request_builder_runtime_policy_fields_invalid",
  );
  if (
    value.schema_version !== RUNTIME_POLICY_SCHEMA_VERSION ||
    value.mode !== MODE
  ) {
    fail("production_request_builder_runtime_policy_invalid");
  }
  const generatedAt = exactTimestamp(
    value.generated_at,
    "production_request_builder_generated_at_invalid",
  );
  const reservationGeneratedAt = Date.parse(
    reservation.generated_at,
  );
  const scheduledFor = Date.parse(reservation.scheduled_for);
  if (
    generatedAt.timestamp < reservationGeneratedAt ||
    generatedAt.timestamp >= scheduledFor
  ) {
    fail("production_request_builder_generated_at_outside_window");
  }
  return {
    generated_at: generatedAt.raw,
    workspace_root: exactAbsolutePath(
      value.workspace_root,
      "production_request_builder_workspace_root_invalid",
    ),
    candidate_source_root: exactAbsolutePath(
      value.candidate_source_root,
      "production_request_builder_candidate_source_root_invalid",
    ),
    narration: exactNarration(value.narration),
    visual_qa: exactVisualQa(value.visual_qa),
    disclosure_policy: exactDisclosurePolicy(
      value.disclosure_policy,
    ),
    safety: exactSafety(value.safety),
  };
}

function validateProductionRequest(
  value,
  { storyId, role, scheduledFor, runtimeSafety } = {},
) {
  exactFields(
    value,
    Object.hasOwn(value, "candidate_revision")
      ? PRODUCTION_REQUEST_FIELDS_WITH_REVISION
      : PRODUCTION_REQUEST_FIELDS,
    "production_request_builder_production_request_fields_invalid",
  );
  if (
    value.schema_version !== PRODUCTION_REQUEST_SCHEMA_VERSION ||
    value.mode !== MODE ||
    value.role !== role ||
    value.scheduled_for !== scheduledFor
  ) {
    fail("production_request_builder_production_identity_mismatch");
  }
  const generatedAt = exactTimestamp(
    value.generated_at,
    "production_request_builder_generated_at_invalid",
  );
  const scheduledAt = exactGuardedWindow(
    value.scheduled_for,
  );
  if (generatedAt.timestamp >= scheduledAt.timestamp) {
    fail("production_request_builder_generated_at_outside_window");
  }
  exactSha256(
    value.candidate_revision_sha256,
    "production_request_builder_candidate_revision_invalid",
  );
  exactSha256(
    value.request_fingerprint,
    "production_request_builder_request_fingerprint_invalid",
  );
  exactAbsolutePath(
    value.workspace_root,
    "production_request_builder_workspace_root_invalid",
  );
  exactAbsolutePath(
    value.candidate_source_root,
    "production_request_builder_candidate_source_root_invalid",
  );
  if (
    value.candidate_workspace_relative_root !==
    `output/canary/${storyId}`
  ) {
    fail("production_request_builder_candidate_root_mismatch");
  }
  const lockedIntake = exactLockedIntake(
    { story_id: storyId, locked_intake: value.locked_intake },
    storyId,
    scheduledFor,
  );
  const creative = exactCreative(value.creative);
  const narration = exactNarration(value.narration);
  const visualQa = exactVisualQa(value.visual_qa);
  const disclosurePolicy = exactDisclosurePolicy(
    value.disclosure_policy,
  );
  const carriesFastNewsDecision =
    lockedIntake.fast_news_lane_decision !== undefined;
  if (
    carriesFastNewsDecision &&
    !Object.hasOwn(value, "candidate_revision")
  ) {
    fail(
      "production_request_builder_candidate_revision_required",
    );
  }
  if (Object.hasOwn(value, "candidate_revision")) {
    const safety = exactSafety(runtimeSafety);
    const runtimePolicy = {
      schema_version: RUNTIME_POLICY_SCHEMA_VERSION,
      mode: MODE,
      generated_at: generatedAt.raw,
      workspace_root: value.workspace_root,
      candidate_source_root: value.candidate_source_root,
      narration,
      visual_qa: visualQa,
      disclosure_policy: disclosurePolicy,
      safety,
    };
    try {
      validateGovernedAutonomousCompiledCandidateBinding({
        candidate_revision: value.candidate_revision,
        candidate_revision_sha256:
          value.candidate_revision_sha256,
        request_fingerprint: value.request_fingerprint,
        story_id: storyId,
        channel_id: "pulse-gaming",
        lane_id: "breaking_short",
        platform: "youtube",
        scheduled_for: scheduledFor,
        source_evidence_sha256:
          value.candidate_revision
            .primary_source_packet_sha256,
        locked_intake_binding: {
          story_id: storyId,
          locked_intake: lockedIntake,
        },
        creative_package: creative,
        runtime_policy: runtimePolicy,
      });
    } catch {
      fail(
        "production_request_builder_candidate_revision_invalid",
      );
    }
  }
  return structuredClone(value);
}

function validateGovernedAutonomousProductionRequestBuild(value) {
  exactFields(
    value,
    RESULT_FIELDS,
    "production_request_builder_result_fields_invalid",
  );
  const supplied = exactSha256(
    value.builder_sha256,
    "production_request_builder_sha256_invalid",
  );
  const body = { ...value };
  delete body.builder_sha256;
  if (canonicalSha256(body) !== supplied) {
    fail("production_request_builder_sha256_mismatch");
  }
  if (
    value.schema_version !== BUILDER_RESULT_SCHEMA_VERSION ||
    value.mode !== MODE
  ) {
    fail("production_request_builder_result_invalid");
  }
  const storyId = exactStoryId(
    value.story_id,
    "production_request_builder_story_id_invalid",
  );
  const role = text(value.role).toUpperCase();
  if (!["PRIMARY", "STANDBY"].includes(role) || role !== value.role) {
    fail("production_request_builder_role_invalid");
  }
  const scheduledFor = exactGuardedWindow(
    value.scheduled_for,
  ).raw;
  exactSha256(
    value.reservation_set_sha256,
    "production_request_builder_reservation_sha256_invalid",
  );
  exactSafety(value.safety);
  validateProductionRequest(value.production_request, {
    storyId,
    role,
    scheduledFor,
    runtimeSafety: value.safety,
  });
  assertNoAuthoritySmuggling(value);
  return structuredClone(value);
}

function buildGovernedAutonomousProductionRequest(value) {
  exactFields(
    value,
    Object.hasOwn(value, "candidate_revision")
      ? INPUT_FIELDS_WITH_REVISION
      : INPUT_FIELDS,
    "production_request_builder_input_fields_invalid",
  );
  if (
    value.schema_version !== BUILDER_SCHEMA_VERSION ||
    value.mode !== MODE
  ) {
    fail("production_request_builder_local_proof_only");
  }
  assertNoAuthoritySmuggling(value);
  const reservation =
    validateGovernedAutonomousWindowReservationSet(
      value.reservation_set,
    );
  const role = text(value.selected_role).toUpperCase();
  if (!["PRIMARY", "STANDBY"].includes(role)) {
    fail("production_request_builder_role_invalid");
  }
  const storyId = exactStoryId(
    value.story_id,
    "production_request_builder_story_id_invalid",
  );
  const reserved = reservation.reservations.find(
    (candidate) => candidate.role === role,
  );
  if (!reserved || reserved.story_id !== storyId) {
    fail("production_request_builder_reservation_mismatch");
  }
  const lockedIntake = exactLockedIntake(
    value.locked_intake_binding,
    storyId,
    reservation.scheduled_for,
  );
  const creative = exactCreative(value.creative_package);
  const runtime = exactRuntimePolicy(
    value.runtime_policy,
    reservation,
  );
  const carriesFastNewsDecision =
    lockedIntake.fast_news_lane_decision !== undefined;
  if (
    carriesFastNewsDecision &&
    !Object.hasOwn(value, "candidate_revision")
  ) {
    fail(
      "production_request_builder_candidate_revision_required",
    );
  }
  if (Object.hasOwn(value, "candidate_revision")) {
    try {
      validateGovernedAutonomousCompiledCandidateBinding({
        candidate_revision: value.candidate_revision,
        candidate_revision_sha256:
          value.candidate_revision_sha256,
        request_fingerprint: value.request_fingerprint,
        story_id: storyId,
        channel_id: "pulse-gaming",
        lane_id: "breaking_short",
        platform: "youtube",
        scheduled_for: reservation.scheduled_for,
        source_evidence_sha256:
          value.candidate_revision
            .primary_source_packet_sha256,
        locked_intake_binding: {
          story_id: storyId,
          locked_intake: lockedIntake,
        },
        creative_package: creative,
        runtime_policy: value.runtime_policy,
      });
    } catch {
      fail(
        "production_request_builder_candidate_revision_invalid",
      );
    }
  }
  const productionRequest = {
    schema_version: PRODUCTION_REQUEST_SCHEMA_VERSION,
    mode: MODE,
    generated_at: runtime.generated_at,
    scheduled_for: reservation.scheduled_for,
    role,
    candidate_revision_sha256: exactSha256(
      value.candidate_revision_sha256,
      "production_request_builder_candidate_revision_invalid",
    ),
    request_fingerprint: exactSha256(
      value.request_fingerprint,
      "production_request_builder_request_fingerprint_invalid",
    ),
    workspace_root: runtime.workspace_root,
    candidate_source_root: runtime.candidate_source_root,
    candidate_workspace_relative_root:
      `output/canary/${storyId}`,
    ...(value.candidate_revision
      ? {
          candidate_revision: structuredClone(
            value.candidate_revision,
          ),
        }
      : {}),
    locked_intake: lockedIntake,
    creative,
    narration: runtime.narration,
    visual_qa: runtime.visual_qa,
    disclosure_policy: runtime.disclosure_policy,
  };
  validateProductionRequest(productionRequest, {
    storyId,
    role,
    scheduledFor: reservation.scheduled_for,
    runtimeSafety: runtime.safety,
  });
  const body = {
    schema_version: BUILDER_RESULT_SCHEMA_VERSION,
    mode: MODE,
    story_id: storyId,
    role,
    scheduled_for: reservation.scheduled_for,
    reservation_set_sha256:
      reservation.reservation_set_sha256,
    production_request: productionRequest,
    safety: runtime.safety,
  };
  return Object.freeze(
    validateGovernedAutonomousProductionRequestBuild({
      ...body,
      builder_sha256: canonicalSha256(body),
    }),
  );
}

module.exports = {
  BUILDER_RESULT_SCHEMA_VERSION,
  BUILDER_SCHEMA_VERSION,
  GovernedAutonomousProductionRequestBuilderError,
  RUNTIME_POLICY_SCHEMA_VERSION,
  buildGovernedAutonomousProductionRequest,
  canonicalSha256,
  validateGovernedAutonomousProductionRequestBuild,
};

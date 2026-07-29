"use strict";

const {
  EVIDENCE_SCHEMA_VERSION,
  evaluateAutonomousGreenAdmission,
} = require("./autonomous-green-admission");
const {
  validateAutonomousOfficialJitPreparationManifest,
} = require("./autonomous-official-jit-admission-packet");
const {
  canonicalSha256,
  createAutonomousWindowEligibilityAttestation,
  validateAutonomousWindowEligibilityAttestation,
} = require("./governed-youtube-release-runway");
const {
  MAX_CHECKPOINT_LATENESS_MS,
} = require("./governed-youtube-window-checkpoint-primer");

const REQUEST_SCHEMA_VERSION =
  "pulse-governed-autonomous-pre-t90-candidate-composition-request-v1";
const RESULT_SCHEMA_VERSION =
  "pulse-governed-autonomous-pre-t90-candidate-composition-result-v1";
const MUTATION_PLAN_SCHEMA_VERSION =
  "pulse-governed-autonomous-pre-t90-candidate-mutation-plan-v1";
const COORDINATOR_RESULT_SCHEMA_VERSION =
  "pulse-governed-autonomous-production-result-v1";
const STAGING_RESULT_SCHEMA_VERSION =
  "pulse-autonomous-official-candidate-staging-result-v3";
const MODE = "LOCAL_PROOF";
const CHANNEL_ID = "pulse-gaming";
const LANE_ID = "breaking_short";
const PLATFORM = "youtube";
const APPROVAL_TYPE = "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE";
const T90_OFFSET_MS = 90 * 60 * 1000;
const T90_EARLY_TOLERANCE_MS = 5 * 60 * 1000;
const T75_OFFSET_MS = 75 * 60 * 1000;
// Checkpoint timing permits exactly 60 seconds of lateness while evidence
// expiry is exclusive. One additional second keeps the exact accepted
// boundary inside the validity interval.
const T75_VALIDITY_MARGIN_MS =
  MAX_CHECKPOINT_LATENESS_MS + 1000;
const GUARDED_PUBLISH_HOURS_UTC = new Set([9, 19]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REQUEST_FIELDS = new Set([
  "schema_version",
  "mode",
  "now",
  "scheduled_for",
  "primary",
  "reserve",
]);
const CANDIDATE_FIELDS = new Set([
  "coordinator_result",
  "source_snapshot",
]);
const SOURCE_SNAPSHOT_FIELDS = new Set([
  "discovered_at",
  "source_last_checked_at",
  "publish_by",
  "stale_after",
  "stale_reframe_option",
  "source_report",
]);
const STALE_REFRAME_FIELDS = new Set(["allowed", "reason"]);
const SOURCE_REPORT_FIELDS = new Set([
  "path",
  "file_sha256",
  "report_sha256",
  "request_sha256",
  "generated_at",
  "valid_until",
]);
const RESULT_FIELDS = new Set([
  "schema_version",
  "mode",
  "verdict",
  "blockers",
  "generated_at",
  "scheduled_for",
  "t90_at",
  "t75_at",
  "required_valid_through",
  "candidates",
  "safety",
  "composition_sha256",
]);
const RESULT_CANDIDATE_FIELDS = new Set([
  "story_id",
  "channel_id",
  "lane_id",
  "platform",
  "role",
  "scheduled_for",
  "candidate_revision_sha256",
  "request_fingerprint",
  "eligibility",
  "mutation_plan",
  "publish_authority",
  "external_publish_authorised",
]);
const RESULT_ELIGIBILITY_FIELDS = new Set([
  "editorial_evidence",
  "green_admission",
  "attestation_input",
  "attestation",
  "evidence_hashes",
  "jit_preparation",
  "validity_contract",
]);
const RESULT_EVIDENCE_HASH_FIELDS = new Set([
  "media_sha256",
  "script_sha256",
  "qa_report_sha256",
  "rights_ledger_sha256",
  "source_evidence_sha256",
]);
const VALIDITY_CONTRACT_FIELDS = new Set([
  "checkpoint",
  "t75_at",
  "margin_ms",
  "required_valid_through",
  "source_report_valid_until",
  "green_admission_valid_until",
  "attestation_valid_until",
  "two_minute_jit_report_reusable",
  "dedicated_t90_eligibility_report_required",
]);
const MUTATION_PLAN_FIELDS = new Set([
  "schema_version",
  "story_id",
  "role",
  "scheduled_for",
  "admission_run_at",
  "story_media_binding",
  "window_candidate_admission",
  "mutation_authority",
  "database_mutated",
  "network_used",
  "oauth_or_tokens_mutated",
  "platform_contacted",
  "publish_authority_created",
]);
const STORY_MEDIA_BINDING_FIELDS = new Set([
  "operation",
  "preconditions",
  "set",
]);
const STORY_MEDIA_PRECONDITION_FIELDS = new Set([
  "story_id",
  "channel_id",
  "lane_id",
  "youtube_post_id",
  "editorial_approval_required",
  "full_script_sha256",
  "final_mp4_sha256",
]);
const STORY_MEDIA_SET_FIELDS = new Set(["exported_path"]);
const WINDOW_CANDIDATE_ADMISSION_FIELDS = new Set([
  "preparation_service",
  "preparation_request",
  "service",
  "exact_confirmation",
]);
const AUTHORITY_PREPARATION_REQUEST_FIELDS = new Set([
  "storyId",
  "role",
  "scheduledFor",
  "approval",
  "now",
]);
const AUTHORITY_APPROVAL_FIELDS = new Set([
  "type",
  "eligibilityAttestation",
  "jitPreparation",
]);
const EXACT_CONFIRMATION_FIELDS = new Set([
  "confirmStoryId",
  "confirmRole",
  "confirmScheduledFor",
  "confirmAuthorityBindingSha256From",
]);
const RESULT_SAFETY_FIELDS = new Set([
  "local_proof_only",
  "database_mutated",
  "network_used",
  "oauth_or_tokens_mutated",
  "platform_contacted",
  "publish_authority",
  "scheduler_authority",
  "external_publish_authorised",
]);
const GREEN_HASH_FIELDS = Object.freeze([
  "source_intake_sha256",
  "claim_map_sha256",
  "script_sha256",
  "narration_sha256",
  "timestamps_sha256",
  "media_inventory_sha256",
  "rights_ledger_sha256",
  "motion_manifest_sha256",
  "render_manifest_sha256",
  "final_mp4_sha256",
  "qa_report_sha256",
  "publication_metadata_sha256",
  "package_manifest_sha256",
]);

class GovernedAutonomousPreT90CandidateCompositionError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "GovernedAutonomousPreT90CandidateCompositionError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, details) {
  throw new GovernedAutonomousPreT90CandidateCompositionError(code, details);
}

function text(value) {
  return String(value ?? "").trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function exactFields(value, fields, code) {
  if (!object(value)) fail(code);
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

function exactTimestamp(value, code) {
  const raw = text(value);
  const parsed = new Date(raw);
  if (
    !raw ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== raw
  ) {
    fail(code);
  }
  return parsed;
}

function exactSha256(value, code) {
  const candidate = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(candidate)) fail(code);
  return candidate;
}

function assertFalse(value, code) {
  if (value !== false) fail(code);
}

function assertNoAuthority(result) {
  const safety = object(result.safety);
  if (!safety) fail("pre_t90_coordinator_safety_required");
  for (const field of [
    "publish_authority",
    "scheduler_authority",
    "database_mutated",
    "oauth_or_tokens_mutated",
    "platform_contacted",
    "external_publish_authorised",
  ]) {
    assertFalse(safety[field], `pre_t90_coordinator_${field}_forbidden`);
  }
  const stagingSafety = object(result.staging?.safety);
  if (!stagingSafety) fail("pre_t90_staging_safety_required");
  for (const field of [
    "publish_authority",
    "external_publish_authorised",
    "database_mutated",
    "oauth_or_tokens_mutated",
    "platform_contacted",
    "network_used",
  ]) {
    assertFalse(stagingSafety[field], `pre_t90_staging_${field}_forbidden`);
  }
  const greenSafety = object(
    result.green_supplement?.safety,
  );
  if (!greenSafety) fail("pre_t90_green_safety_required");
  for (const field of [
    "publish_authority",
    "scheduler_authority",
    "database_authority",
    "oauth_or_token_authority",
    "network_authority",
    "platform_contacted",
  ]) {
    assertFalse(greenSafety[field], `pre_t90_green_${field}_forbidden`);
  }
}

function exactSchedule(rawScheduledFor, rawNow) {
  const scheduledFor = exactTimestamp(
    rawScheduledFor,
    "pre_t90_schedule_invalid",
  );
  const now = exactTimestamp(rawNow, "pre_t90_now_invalid");
  if (
    !GUARDED_PUBLISH_HOURS_UTC.has(scheduledFor.getUTCHours()) ||
    scheduledFor.getUTCMinutes() !== 0 ||
    scheduledFor.getUTCSeconds() !== 0 ||
    scheduledFor.getUTCMilliseconds() !== 0
  ) {
    fail("pre_t90_guarded_window_required");
  }
  const leadMs = scheduledFor.getTime() - now.getTime();
  if (
    leadMs < T90_OFFSET_MS ||
    leadMs > T90_OFFSET_MS + T90_EARLY_TOLERANCE_MS
  ) {
    fail("pre_t90_composition_phase_invalid");
  }
  const t75At = new Date(
    scheduledFor.getTime() - T75_OFFSET_MS,
  );
  const requiredValidThrough = new Date(
    t75At.getTime() + T75_VALIDITY_MARGIN_MS,
  );
  return {
    now,
    scheduledFor,
    t75At,
    requiredValidThrough,
  };
}

function exactSourceSnapshot(value, timing, storyId) {
  exactFields(
    value,
    SOURCE_SNAPSHOT_FIELDS,
    "pre_t90_source_snapshot_fields_invalid",
  );
  exactFields(
    value.stale_reframe_option,
    STALE_REFRAME_FIELDS,
    "pre_t90_stale_reframe_fields_invalid",
  );
  if (
    typeof value.stale_reframe_option.allowed !== "boolean" ||
    !text(value.stale_reframe_option.reason)
  ) {
    fail("pre_t90_stale_reframe_invalid");
  }
  exactFields(
    value.source_report,
    SOURCE_REPORT_FIELDS,
    "pre_t90_source_report_fields_invalid",
  );
  const sourceReport = {
    path: text(value.source_report.path),
    file_sha256: exactSha256(
      value.source_report.file_sha256,
      "pre_t90_source_report_file_sha256_invalid",
    ),
    report_sha256: exactSha256(
      value.source_report.report_sha256,
      "pre_t90_source_report_sha256_invalid",
    ),
    request_sha256: exactSha256(
      value.source_report.request_sha256,
      "pre_t90_source_report_request_sha256_invalid",
    ),
    generated_at: exactTimestamp(
      value.source_report.generated_at,
      "pre_t90_source_report_generated_at_invalid",
    ).toISOString(),
    valid_until: exactTimestamp(
      value.source_report.valid_until,
      "pre_t90_source_report_valid_until_invalid",
    ).toISOString(),
  };
  if (!sourceReport.path) fail("pre_t90_source_report_path_required");
  if (
    Date.parse(sourceReport.generated_at) > timing.now.getTime()
  ) {
    fail("pre_t90_source_report_from_future");
  }
  if (
    Date.parse(sourceReport.valid_until) <
    timing.requiredValidThrough.getTime()
  ) {
    fail("pre_t90_source_report_must_cover_t75", {
      story_id: storyId,
      required_valid_through:
        timing.requiredValidThrough.toISOString(),
      observed_valid_until: sourceReport.valid_until,
    });
  }
  const freshness = {
    discovered_at: exactTimestamp(
      value.discovered_at,
      "pre_t90_discovered_at_invalid",
    ).toISOString(),
    source_last_checked_at: exactTimestamp(
      value.source_last_checked_at,
      "pre_t90_source_last_checked_at_invalid",
    ).toISOString(),
    publish_by: exactTimestamp(
      value.publish_by,
      "pre_t90_publish_by_invalid",
    ).toISOString(),
    stale_after: exactTimestamp(
      value.stale_after,
      "pre_t90_stale_after_invalid",
    ).toISOString(),
    valid_until: timing.requiredValidThrough.toISOString(),
    reverification_required: true,
    stale_reframe_option: {
      allowed: value.stale_reframe_option.allowed,
      reason: text(value.stale_reframe_option.reason),
    },
  };
  const sourceReportGeneratedAt = Date.parse(
    sourceReport.generated_at,
  );
  const sourceLastCheckedAt = Date.parse(
    freshness.source_last_checked_at,
  );
  if (
    sourceReportGeneratedAt < sourceLastCheckedAt ||
    timing.now.getTime() - sourceReportGeneratedAt >
      T90_EARLY_TOLERANCE_MS
  ) {
    fail("pre_t90_source_report_freshness_binding_invalid", {
      story_id: storyId,
      source_report_generated_at: sourceReport.generated_at,
      source_last_checked_at: freshness.source_last_checked_at,
      composition_time: timing.now.toISOString(),
    });
  }
  return {
    freshness,
    source_report: sourceReport,
  };
}

function exactIdentity(result, preparation, role, timing) {
  const staging = result.staging;
  const green = result.green_supplement;
  const storyId = text(result.story_id);
  if (!storyId) fail("pre_t90_story_id_required");
  for (const [actual, expected, code] of [
    [text(staging.story_id), storyId, "pre_t90_staging_story_mismatch"],
    [text(green.story_id), storyId, "pre_t90_green_story_mismatch"],
    [preparation.story_id, storyId, "pre_t90_preparation_story_mismatch"],
    [text(staging.channel_id), CHANNEL_ID, "pre_t90_channel_mismatch"],
    [text(green.channel_id), CHANNEL_ID, "pre_t90_channel_mismatch"],
    [preparation.channel_id, CHANNEL_ID, "pre_t90_channel_mismatch"],
    [text(staging.lane_id), LANE_ID, "pre_t90_lane_mismatch"],
    [text(green.lane_id), LANE_ID, "pre_t90_lane_mismatch"],
    [preparation.lane_id, LANE_ID, "pre_t90_lane_mismatch"],
    [text(staging.platform).toLowerCase(), PLATFORM, "pre_t90_platform_mismatch"],
    [text(green.platform).toLowerCase(), PLATFORM, "pre_t90_platform_mismatch"],
    [preparation.platform, PLATFORM, "pre_t90_platform_mismatch"],
    [
      text(staging.scheduled_for),
      timing.scheduledFor.toISOString(),
      "pre_t90_schedule_mismatch",
    ],
    [
      preparation.scheduled_for,
      timing.scheduledFor.toISOString(),
      "pre_t90_schedule_mismatch",
    ],
    [text(staging.role).toUpperCase(), role, "pre_t90_role_mismatch"],
    [preparation.role, role, "pre_t90_role_mismatch"],
  ]) {
    if (actual !== expected) fail(code, { story_id: storyId });
  }
  return storyId;
}

function exactGreenHashes(green, preparation, storyId) {
  const hashes = object(green.hashes);
  if (!hashes) fail("pre_t90_green_hashes_required");
  const actualFields = Object.keys(hashes).sort();
  const expectedFields = [...GREEN_HASH_FIELDS].sort();
  if (
    actualFields.length !== expectedFields.length ||
    actualFields.some(
      (field, index) => field !== expectedFields[index],
    )
  ) {
    fail("pre_t90_green_hashes_fields_invalid");
  }
  const normalised = Object.fromEntries(
    GREEN_HASH_FIELDS.map((field) => [
      field,
      exactSha256(hashes[field], `pre_t90_${field}_invalid`),
    ]),
  );
  for (const [actual, expected, code] of [
    [
      normalised.source_intake_sha256,
      preparation.artifacts.story_intake.sha256,
      "pre_t90_source_intake_binding_mismatch",
    ],
    [
      normalised.narration_sha256,
      preparation.artifacts.narration_audio.sha256,
      "pre_t90_narration_binding_mismatch",
    ],
    [
      normalised.motion_manifest_sha256,
      preparation.artifacts.owned_motion_manifest.sha256,
      "pre_t90_motion_binding_mismatch",
    ],
    [
      normalised.render_manifest_sha256,
      preparation.artifacts.renderer_manifest.sha256,
      "pre_t90_renderer_binding_mismatch",
    ],
    [
      normalised.final_mp4_sha256,
      preparation.artifacts.final_mp4.sha256,
      "pre_t90_media_binding_mismatch",
    ],
    [
      normalised.qa_report_sha256,
      preparation.artifacts.deterministic_qa.sha256,
      "pre_t90_qa_binding_mismatch",
    ],
    [
      normalised.publication_metadata_sha256,
      preparation.artifacts.publication_metadata.sha256,
      "pre_t90_metadata_binding_mismatch",
    ],
  ]) {
    if (actual !== expected) fail(code, { story_id: storyId });
  }
  return normalised;
}

function greenEvidence({
  storyId,
  green,
  hashes,
  preparation,
  freshness,
}) {
  if (
    !Array.isArray(green.media_items) ||
    green.media_items.length === 0
  ) {
    fail("pre_t90_green_media_items_required");
  }
  const firstScope = object(green.media_items[0]?.scope);
  if (!firstScope) fail("pre_t90_commercial_scope_required");
  const disclosure =
    preparation.publication_evidence_gate_input
      .synthetic_media_disclosure;
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    story: {
      story_id: storyId,
      channel_id: CHANNEL_ID,
      lane_id: LANE_ID,
      platform: PLATFORM,
      source_type: "OFFICIAL",
      primary_source: true,
      verification_status: "CONFIRMED",
      content_classification: "CONFIRMED_NEWS",
      rumour: false,
    },
    freshness,
    prompt_injection: {
      verdict: text(green.prompt_injection?.verdict).toUpperCase(),
    },
    hashes,
    qa: {
      story_id: storyId,
      report_sha256: hashes.qa_report_sha256,
      final_mp4_sha256: hashes.final_mp4_sha256,
      verdict: "PASS",
      blockers: [],
    },
    renderer: {
      story_id: storyId,
      manifest_sha256: hashes.render_manifest_sha256,
      final_mp4_sha256: hashes.final_mp4_sha256,
      script_sha256: hashes.script_sha256,
      narration_sha256: hashes.narration_sha256,
      timestamps_sha256: hashes.timestamps_sha256,
      media_inventory_sha256: hashes.media_inventory_sha256,
      rights_ledger_sha256: hashes.rights_ledger_sha256,
      motion_manifest_sha256: hashes.motion_manifest_sha256,
      verdict: "PASS",
      publishable: true,
      blockers: [],
    },
    package_binding: {
      story_id: storyId,
      ...hashes,
    },
    synthetic_media_disclosure: {
      contains_synthetic_media: disclosure.altered_content,
      disclosure_required:
        disclosure.policy_basis === "DISCLOSE",
      decision: disclosure.policy_basis,
      youtube_field_value: disclosure.youtube_field_value,
    },
    commercial_scope: {
      destinations: [...firstScope.destinations],
      revenue_modes: [...firstScope.revenue_modes],
      territory: firstScope.territory,
      account_id: firstScope.account_id,
      sponsor: false,
      affiliate: false,
      client: false,
      paid_access: false,
    },
    media_items: structuredClone(green.media_items),
  };
}

function evidenceHashes(preparation, greenHashes) {
  return {
    media_sha256: greenHashes.final_mp4_sha256,
    script_sha256: greenHashes.script_sha256,
    qa_report_sha256:
      preparation.artifacts.deterministic_qa.sha256,
    rights_ledger_sha256:
      preparation.publication_evidence_gate_input
        .rights_ledger_sha256,
    source_evidence_sha256:
      preparation.artifacts.source_evidence.sha256,
  };
}

function mutationPlan({
  storyId,
  role,
  timing,
  preparation,
  hashes,
  attestation,
}) {
  const authorityPreparationRequest = {
    storyId,
    role,
    scheduledFor: timing.scheduledFor.toISOString(),
    approval: {
      type: APPROVAL_TYPE,
      eligibilityAttestation: attestation,
      jitPreparation: preparation,
    },
    now: timing.now.toISOString(),
  };
  return {
    schema_version: MUTATION_PLAN_SCHEMA_VERSION,
    story_id: storyId,
    role,
    scheduled_for: timing.scheduledFor.toISOString(),
    admission_run_at:
      role === "PRIMARY" ? timing.t75At.toISOString() : null,
    story_media_binding: {
      operation: "BIND_CANONICAL_STORY_MEDIA",
      preconditions: {
        story_id: storyId,
        channel_id: CHANNEL_ID,
        lane_id: LANE_ID,
        youtube_post_id: null,
        editorial_approval_required: true,
        full_script_sha256: hashes.script_sha256,
        final_mp4_sha256: hashes.final_mp4_sha256,
      },
      set: {
        exported_path: preparation.artifacts.final_mp4.path,
      },
    },
    window_candidate_admission: {
      preparation_service:
        "prepareGovernedWindowCandidateAuthority",
      preparation_request: authorityPreparationRequest,
      service: "admitAutonomousGovernedWindowCandidate",
      exact_confirmation: {
        confirmStoryId: storyId,
        confirmRole: role,
        confirmScheduledFor: timing.scheduledFor.toISOString(),
        confirmAuthorityBindingSha256From:
          "prepared.authority.authority_binding_sha256",
      },
    },
    mutation_authority: false,
    database_mutated: false,
    network_used: false,
    oauth_or_tokens_mutated: false,
    platform_contacted: false,
    publish_authority_created: false,
  };
}

function composeCandidate(candidate, role, timing) {
  exactFields(
    candidate,
    CANDIDATE_FIELDS,
    "pre_t90_candidate_fields_invalid",
  );
  const result = object(candidate.coordinator_result);
  if (!result) fail("pre_t90_coordinator_result_required");
  if (
    result.schema_version !== COORDINATOR_RESULT_SCHEMA_VERSION ||
    result.mode !== MODE ||
    result.verdict !== "GREEN" ||
    !Array.isArray(result.blockers) ||
    result.blockers.length !== 0
  ) {
    fail("pre_t90_coordinator_result_not_green");
  }
  const staging = object(result.staging);
  const green = object(result.green_supplement);
  if (
    !staging ||
    staging.schema_version !== STAGING_RESULT_SCHEMA_VERSION ||
    staging.mode !== MODE ||
    staging.verdict !== "GREEN" ||
    !Array.isArray(staging.blockers) ||
    staging.blockers.length !== 0
  ) {
    fail("pre_t90_staging_result_not_green");
  }
  if (
    !green ||
    green.verdict !== "GREEN" ||
    green.authority_scope !== "LOCAL_PROOF_EVIDENCE_ONLY"
  ) {
    fail("pre_t90_green_supplement_not_green");
  }
  assertNoAuthority(result);
  const preparation =
    validateAutonomousOfficialJitPreparationManifest(
      staging.preparation_manifest,
    );
  if (
    exactSha256(
      staging.preparation_sha256,
      "pre_t90_staging_preparation_sha256_invalid",
    ) !== preparation.preparation_sha256 ||
    exactSha256(
      staging.rights_ledger_sha256,
      "pre_t90_staging_rights_sha256_invalid",
    ) !==
      preparation.publication_evidence_gate_input
        .rights_ledger_sha256
  ) {
    fail("pre_t90_staging_preparation_binding_mismatch");
  }
  const storyId = exactIdentity(
    result,
    preparation,
    role,
    timing,
  );
  const hashes = exactGreenHashes(
    green,
    preparation,
    storyId,
  );
  const snapshot = exactSourceSnapshot(
    candidate.source_snapshot,
    timing,
    storyId,
  );
  const editorialEvidence = greenEvidence({
    storyId,
    green,
    hashes,
    preparation,
    freshness: snapshot.freshness,
  });
  const greenAdmission = evaluateAutonomousGreenAdmission(
    editorialEvidence,
    {
      clock: () => new Date(timing.now),
    },
  );
  if (
    greenAdmission.verdict !== "GREEN" ||
    greenAdmission.eligible !== true ||
    greenAdmission.valid_until !==
      timing.requiredValidThrough.toISOString()
  ) {
    fail("pre_t90_green_admission_not_valid_through_t75", {
      story_id: storyId,
      blockers: greenAdmission.blockers,
      required_valid_through:
        timing.requiredValidThrough.toISOString(),
      observed_valid_until: greenAdmission.valid_until,
    });
  }
  const eligibilityEvidenceHashes = evidenceHashes(
    preparation,
    hashes,
  );
  const attestationInput = {
    now: new Date(timing.now),
    story_id: storyId,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    platform: PLATFORM,
    scheduled_for: timing.scheduledFor.toISOString(),
    role,
    evidence_hashes: eligibilityEvidenceHashes,
    source_report: snapshot.source_report,
    green_admission: greenAdmission,
    jit_preparation: preparation,
  };
  const attestation =
    createAutonomousWindowEligibilityAttestation(
      attestationInput,
    );
  if (
    Date.parse(attestation.valid_until) <
    timing.requiredValidThrough.getTime()
  ) {
    fail("pre_t90_attestation_not_valid_through_t75");
  }
  const plan = mutationPlan({
    storyId,
    role,
    timing,
    preparation,
    hashes,
    attestation,
  });
  return {
    story_id: storyId,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    platform: PLATFORM,
    role,
    scheduled_for: timing.scheduledFor.toISOString(),
    candidate_revision_sha256:
      preparation.candidate_revision_sha256,
    request_fingerprint: preparation.request_fingerprint,
    eligibility: {
      editorial_evidence: editorialEvidence,
      green_admission: greenAdmission,
      attestation_input: {
        ...attestationInput,
        now: timing.now.toISOString(),
      },
      attestation,
      evidence_hashes: eligibilityEvidenceHashes,
      jit_preparation: preparation,
      validity_contract: {
        checkpoint: "T75",
        t75_at: timing.t75At.toISOString(),
        margin_ms: T75_VALIDITY_MARGIN_MS,
        required_valid_through:
          timing.requiredValidThrough.toISOString(),
        source_report_valid_until:
          snapshot.source_report.valid_until,
        green_admission_valid_until:
          greenAdmission.valid_until,
        attestation_valid_until: attestation.valid_until,
        two_minute_jit_report_reusable: false,
        dedicated_t90_eligibility_report_required: true,
      },
    },
    mutation_plan: plan,
    publish_authority: false,
    external_publish_authorised: false,
  };
}

function validateResultSafety(safety) {
  exactFields(
    safety,
    RESULT_SAFETY_FIELDS,
    "pre_t90_result_safety_invalid",
  );
  if (safety.local_proof_only !== true) {
    fail("pre_t90_result_safety_invalid");
  }
  for (const field of [
    "database_mutated",
    "network_used",
    "oauth_or_tokens_mutated",
    "platform_contacted",
    "publish_authority",
    "scheduler_authority",
    "external_publish_authorised",
  ]) {
    assertFalse(safety[field], `pre_t90_result_${field}_forbidden`);
  }
}

function validateResultCandidate(candidate, role, timing) {
  exactFields(
    candidate,
    RESULT_CANDIDATE_FIELDS,
    "pre_t90_result_candidate_fields_invalid",
  );
  const storyId = text(candidate.story_id);
  if (
    !storyId ||
    candidate.channel_id !== CHANNEL_ID ||
    candidate.lane_id !== LANE_ID ||
    candidate.platform !== PLATFORM ||
    candidate.role !== role ||
    candidate.scheduled_for !== timing.scheduledFor.toISOString()
  ) {
    fail("pre_t90_result_candidate_binding_invalid");
  }
  assertFalse(
    candidate.publish_authority,
    "pre_t90_result_candidate_publish_authority_forbidden",
  );
  assertFalse(
    candidate.external_publish_authorised,
    "pre_t90_result_candidate_external_publish_forbidden",
  );
  exactFields(
    candidate.eligibility,
    RESULT_ELIGIBILITY_FIELDS,
    "pre_t90_result_eligibility_fields_invalid",
  );
  const preparation =
    validateAutonomousOfficialJitPreparationManifest(
      candidate.eligibility.jit_preparation,
    );
  if (
    preparation.story_id !== storyId ||
    preparation.role !== role ||
    preparation.scheduled_for !==
      timing.scheduledFor.toISOString() ||
    preparation.candidate_revision_sha256 !==
      exactSha256(
        candidate.candidate_revision_sha256,
        "pre_t90_result_candidate_revision_invalid",
      ) ||
    preparation.request_fingerprint !==
      exactSha256(
        candidate.request_fingerprint,
        "pre_t90_result_request_fingerprint_invalid",
      )
  ) {
    fail("pre_t90_result_preparation_binding_invalid");
  }
  const expectedGreenAdmission =
    evaluateAutonomousGreenAdmission(
      candidate.eligibility.editorial_evidence,
      {
        clock: () => new Date(timing.now),
      },
    );
  if (
    JSON.stringify(expectedGreenAdmission) !==
      JSON.stringify(candidate.eligibility.green_admission) ||
    expectedGreenAdmission.verdict !== "GREEN" ||
    expectedGreenAdmission.valid_until !==
      timing.requiredValidThrough.toISOString()
  ) {
    fail("pre_t90_result_green_admission_invalid");
  }
  const evidence = candidate.eligibility.evidence_hashes;
  exactFields(
    evidence,
    RESULT_EVIDENCE_HASH_FIELDS,
    "pre_t90_result_evidence_hashes_invalid",
  );
  for (const field of RESULT_EVIDENCE_HASH_FIELDS) {
    exactSha256(
      evidence[field],
      `pre_t90_result_${field}_invalid`,
    );
  }
  const expectedAttestationInput = {
    now: timing.now.toISOString(),
    story_id: storyId,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    platform: PLATFORM,
    scheduled_for: timing.scheduledFor.toISOString(),
    role,
    evidence_hashes: evidence,
    source_report:
      candidate.eligibility.attestation?.source_report,
    green_admission:
      candidate.eligibility.green_admission,
    jit_preparation: preparation,
  };
  if (
    canonicalSha256(
      candidate.eligibility.attestation_input,
    ) !== canonicalSha256(expectedAttestationInput)
  ) {
    fail("pre_t90_result_attestation_input_invalid");
  }
  const attestation =
    validateAutonomousWindowEligibilityAttestation(
      candidate.eligibility.attestation,
      {
        now: new Date(timing.t75At),
        expected: {
          story_id: storyId,
          channel_id: CHANNEL_ID,
          lane_id: LANE_ID,
          platform: PLATFORM,
          scheduled_for: timing.scheduledFor.toISOString(),
          role,
          candidate_binding_sha256:
            candidate.eligibility.attestation
              .candidate_binding_sha256,
          evidence_hashes: evidence,
          jit_preparation: preparation,
        },
      },
    );
  if (
    Date.parse(attestation.valid_until) <
    timing.requiredValidThrough.getTime()
  ) {
    fail("pre_t90_result_attestation_not_valid_through_t75");
  }
  const validity = object(
    candidate.eligibility.validity_contract,
  );
  exactFields(
    validity,
    VALIDITY_CONTRACT_FIELDS,
    "pre_t90_result_validity_contract_invalid",
  );
  if (
    validity.checkpoint !== "T75" ||
    validity.t75_at !== timing.t75At.toISOString() ||
    validity.margin_ms !== T75_VALIDITY_MARGIN_MS ||
    validity.required_valid_through !==
      timing.requiredValidThrough.toISOString() ||
    Date.parse(validity.source_report_valid_until) <
      timing.requiredValidThrough.getTime() ||
    validity.green_admission_valid_until !==
      timing.requiredValidThrough.toISOString() ||
    validity.attestation_valid_until !==
      timing.requiredValidThrough.toISOString() ||
    validity.two_minute_jit_report_reusable !== false ||
    validity.dedicated_t90_eligibility_report_required !== true
  ) {
    fail("pre_t90_result_validity_contract_invalid");
  }
  const plan = object(candidate.mutation_plan);
  exactFields(
    plan,
    MUTATION_PLAN_FIELDS,
    "pre_t90_result_mutation_plan_invalid",
  );
  exactFields(
    plan.story_media_binding,
    STORY_MEDIA_BINDING_FIELDS,
    "pre_t90_result_mutation_plan_invalid",
  );
  exactFields(
    plan.story_media_binding.preconditions,
    STORY_MEDIA_PRECONDITION_FIELDS,
    "pre_t90_result_mutation_plan_invalid",
  );
  exactFields(
    plan.story_media_binding.set,
    STORY_MEDIA_SET_FIELDS,
    "pre_t90_result_mutation_plan_invalid",
  );
  exactFields(
    plan.window_candidate_admission,
    WINDOW_CANDIDATE_ADMISSION_FIELDS,
    "pre_t90_result_mutation_plan_invalid",
  );
  exactFields(
    plan.window_candidate_admission.preparation_request,
    AUTHORITY_PREPARATION_REQUEST_FIELDS,
    "pre_t90_result_mutation_plan_invalid",
  );
  exactFields(
    plan.window_candidate_admission.preparation_request.approval,
    AUTHORITY_APPROVAL_FIELDS,
    "pre_t90_result_mutation_plan_invalid",
  );
  exactFields(
    plan.window_candidate_admission.exact_confirmation,
    EXACT_CONFIRMATION_FIELDS,
    "pre_t90_result_mutation_plan_invalid",
  );
  const expectedAuthorityPreparationRequest = {
    storyId,
    role,
    scheduledFor: timing.scheduledFor.toISOString(),
    approval: {
      type: APPROVAL_TYPE,
      eligibilityAttestation: attestation,
      jitPreparation: preparation,
    },
    now: timing.now.toISOString(),
  };
  const expectedConfirmation = {
    confirmStoryId: storyId,
    confirmRole: role,
    confirmScheduledFor: timing.scheduledFor.toISOString(),
    confirmAuthorityBindingSha256From:
      "prepared.authority.authority_binding_sha256",
  };
  if (
    !plan ||
    plan.schema_version !== MUTATION_PLAN_SCHEMA_VERSION ||
    plan.story_id !== storyId ||
    plan.role !== role ||
    plan.scheduled_for !== timing.scheduledFor.toISOString() ||
    plan.admission_run_at !==
      (role === "PRIMARY" ? timing.t75At.toISOString() : null) ||
    plan.story_media_binding?.operation !==
      "BIND_CANONICAL_STORY_MEDIA" ||
    plan.story_media_binding?.preconditions?.story_id !== storyId ||
    plan.story_media_binding?.preconditions?.channel_id !==
      CHANNEL_ID ||
    plan.story_media_binding?.preconditions?.lane_id !== LANE_ID ||
    plan.story_media_binding?.preconditions?.youtube_post_id !==
      null ||
    plan.story_media_binding?.preconditions
      ?.editorial_approval_required !== true ||
    plan.story_media_binding?.set?.exported_path !==
      preparation.artifacts.final_mp4.path ||
    plan.story_media_binding?.preconditions?.full_script_sha256 !==
      evidence.script_sha256 ||
    plan.story_media_binding?.preconditions?.final_mp4_sha256 !==
      evidence.media_sha256 ||
    plan.window_candidate_admission?.preparation_service !==
      "prepareGovernedWindowCandidateAuthority" ||
    plan.window_candidate_admission?.service !==
      "admitAutonomousGovernedWindowCandidate" ||
    canonicalSha256(
      plan.window_candidate_admission?.preparation_request,
    ) !== canonicalSha256(expectedAuthorityPreparationRequest) ||
    canonicalSha256(
      plan.window_candidate_admission?.exact_confirmation,
    ) !== canonicalSha256(expectedConfirmation)
  ) {
    fail("pre_t90_result_mutation_plan_invalid");
  }
  for (const field of [
    "mutation_authority",
    "database_mutated",
    "network_used",
    "oauth_or_tokens_mutated",
    "platform_contacted",
    "publish_authority_created",
  ]) {
    assertFalse(plan[field], `pre_t90_result_plan_${field}_forbidden`);
  }
  return storyId;
}

function validateGovernedAutonomousPreT90CandidateComposition(
  value,
) {
  exactFields(
    value,
    RESULT_FIELDS,
    "pre_t90_result_fields_invalid",
  );
  const suppliedSha256 = exactSha256(
    value.composition_sha256,
    "pre_t90_composition_sha256_invalid",
  );
  const body = { ...value };
  delete body.composition_sha256;
  if (canonicalSha256(body) !== suppliedSha256) {
    fail("pre_t90_composition_sha256_mismatch");
  }
  if (
    value.schema_version !== RESULT_SCHEMA_VERSION ||
    value.mode !== MODE ||
    value.verdict !== "GREEN" ||
    !Array.isArray(value.blockers) ||
    value.blockers.length !== 0 ||
    !Array.isArray(value.candidates) ||
    value.candidates.length !== 2
  ) {
    fail("pre_t90_result_not_green");
  }
  const timing = exactSchedule(
    value.scheduled_for,
    value.generated_at,
  );
  if (
    value.t90_at !==
      new Date(
        timing.scheduledFor.getTime() - T90_OFFSET_MS,
      ).toISOString() ||
    value.t75_at !== timing.t75At.toISOString() ||
    value.required_valid_through !==
      timing.requiredValidThrough.toISOString()
  ) {
    fail("pre_t90_result_timing_binding_invalid");
  }
  const primaryStoryId = validateResultCandidate(
    value.candidates[0],
    "PRIMARY",
    timing,
  );
  const reserveStoryId = validateResultCandidate(
    value.candidates[1],
    "STANDBY",
    timing,
  );
  if (primaryStoryId === reserveStoryId) {
    fail("pre_t90_distinct_primary_and_reserve_required");
  }
  validateResultSafety(value.safety);
  return JSON.parse(JSON.stringify(value));
}

function composeGovernedAutonomousPreT90Candidates(
  request = {},
) {
  exactFields(
    request,
    REQUEST_FIELDS,
    "pre_t90_request_fields_invalid",
  );
  if (
    request.schema_version !== REQUEST_SCHEMA_VERSION ||
    request.mode !== MODE
  ) {
    fail("pre_t90_local_proof_only");
  }
  const timing = exactSchedule(
    request.scheduled_for,
    request.now,
  );
  const primary = composeCandidate(
    request.primary,
    "PRIMARY",
    timing,
  );
  const reserve = composeCandidate(
    request.reserve,
    "STANDBY",
    timing,
  );
  if (primary.story_id === reserve.story_id) {
    fail("pre_t90_distinct_primary_and_reserve_required");
  }
  const body = {
    schema_version: RESULT_SCHEMA_VERSION,
    mode: MODE,
    verdict: "GREEN",
    blockers: [],
    generated_at: timing.now.toISOString(),
    scheduled_for: timing.scheduledFor.toISOString(),
    t90_at: new Date(
      timing.scheduledFor.getTime() - T90_OFFSET_MS,
    ).toISOString(),
    t75_at: timing.t75At.toISOString(),
    required_valid_through:
      timing.requiredValidThrough.toISOString(),
    candidates: [primary, reserve],
    safety: {
      local_proof_only: true,
      database_mutated: false,
      network_used: false,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      publish_authority: false,
      scheduler_authority: false,
      external_publish_authorised: false,
    },
  };
  return Object.freeze(validateGovernedAutonomousPreT90CandidateComposition({
    ...body,
    composition_sha256: canonicalSha256(body),
  }));
}

module.exports = {
  GovernedAutonomousPreT90CandidateCompositionError,
  MUTATION_PLAN_SCHEMA_VERSION,
  REQUEST_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION,
  T75_VALIDITY_MARGIN_MS,
  composeGovernedAutonomousPreT90Candidates,
  validateGovernedAutonomousPreT90CandidateComposition,
};

"use strict";

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const { JobsRunner } = require("../services/jobs-runner");
const {
  canonicalSha256,
  validateGovernedAutonomousProductionRequestBuild,
} = require(
  "../services/governed-autonomous-production-request-builder"
);
const {
  validateGovernedAutonomousWindowReservationSet,
} = require(
  "../services/governed-autonomous-window-reservation-set"
);
const {
  validateGovernedAutonomousCandidateCompletionReceipt,
} = require(
  "../services/governed-autonomous-candidate-completion-receipt"
);
const {
  validateLiveGuardedRuntimeProfile,
} = require(
  "../stabilisation/windows-live-guarded-runtime"
);

const DRAIN_REQUEST_SCHEMA_VERSION =
  "pulse-governed-exact-production-plan-drain-request-v1";
const DRAIN_REPORT_SCHEMA_VERSION =
  "pulse-governed-exact-production-plan-drain-report-v1";
const EVIDENCE_RESERVATION_SCHEMA_VERSION =
  "pulse-governed-exact-production-plan-drain-reservation-v1";
const JOB_ATTESTATION_SCHEMA_VERSION =
  "pulse-governed-exact-production-job-attestation-v1";
const PLAN_SCHEMA_VERSION_V1 =
  "pulse-governed-autonomous-window-production-plan-v1";
const PLAN_SCHEMA_VERSION_V2 =
  "pulse-governed-autonomous-window-production-plan-v2";
const CANDIDATE_SET_REVISION_SCHEMA_VERSION =
  "pulse-governed-autonomous-window-candidate-set-revision-v1";
const PLAN_LINEAGE_SCHEMA_VERSION =
  "pulse-governed-autonomous-window-plan-lineage-v1";
const SELECTION_POLICY =
  "SCORE_DESC_SOURCE_PUBLISHED_DESC_STORY_ID_ASC";
const MODE = "LOCAL_PROOF";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const WORKER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_FIELDS = new Set([
  "schema_version",
  "mode",
  "generated_at",
  "plan_path",
  "expected_plan_file_sha256",
  "expected_plan_sha256",
  "workspace_root",
  "database_path",
  "runtime_profile_path",
  "expected_runtime_profile_file_sha256",
  "expected_checkout_commit",
  "output_dir",
  "worker_id",
  "timeout_ms",
  "poll_interval_ms",
]);
const PLAN_FIELDS_V1 = new Set([
  "schema_version",
  "mode",
  "verdict",
  "generated_at",
  "scheduled_for",
  "channel_id",
  "lane_id",
  "platform",
  "selection_policy",
  "eligible_candidate_count",
  "selected_candidates",
  "not_selected_story_ids",
  "reservation_set",
  "production_jobs",
  "job_queue_state",
  "database_scope",
  "story_approval_mutated",
  "human_approval_dependency",
  "source_network_used",
  "platform_contacted",
  "oauth_or_tokens_mutated",
  "publish_authority_created",
  "scheduler_authority_created",
  "external_posting",
  "plan_sha256",
]);
const PLAN_FIELDS_V2 = new Set([
  ...PLAN_FIELDS_V1,
  "candidate_set_revision",
  "lineage",
]);
const SELECTED_FIELDS = new Set([
  "story_id",
  "role",
  "selection_score",
  "source_published_at",
  "verified_at",
  "source_evidence_sha256",
  "candidate_revision_sha256",
  "request_fingerprint",
  "builder_sha256",
]);
const PLAN_JOB_FIELDS = new Set([
  "job_id",
  "kind",
  "story_id",
  "database_story_id",
  "role",
  "idempotency_key",
  "builder_sha256",
]);
const PLAN_RESERVATION_FIELDS = new Set([
  "path",
  "file_sha256",
  "reservation_set_sha256",
]);
const CANDIDATE_SET_REVISION_FIELDS = new Set([
  "schema_version",
  "scheduled_for",
  "channel_id",
  "lane_id",
  "platform",
  "ordered_candidates",
  "compiled_candidate_bindings",
  "exact_compiled_candidate_set_sha256",
  "candidate_set_revision_sha256",
]);
const ORDERED_CANDIDATE_FIELDS = new Set([
  "rank",
  "story_id",
  "semantic_candidate_revision_sha256",
  "source_evidence_sha256",
  "timing_evidence_hashes",
]);
const TIMING_EVIDENCE_HASH_FIELDS = new Set([
  "field_path",
  "sha256",
]);
const COMPILED_CANDIDATE_BINDING_FIELDS = new Set([
  "rank",
  "story_id",
  "candidate_revision_sha256",
  "request_fingerprint",
]);
const PLAN_LINEAGE_FIELDS = new Set([
  "schema_version",
  "supersedes",
  "lineage_sha256",
]);
const SUPERSEDES_FIELDS = new Set([
  "candidate_set_revision_sha256",
  "plan_file_sha256",
  "plan_path",
  "plan_sha256",
]);
const PRODUCTION_SAFETY_FIELDS = new Set([
  "local_proof_only",
  "database_mutated",
  "database_mutation_scope",
  "narration_network_used",
  "oauth_or_tokens_mutated",
  "platform_contacted",
  "publish_authority",
  "scheduler_authority",
  "external_publish_authorised",
]);
const PROBE_NAMES = Object.freeze([
  "listeners",
  "processes",
  "scheduled_tasks",
]);
const AUTHORITY_ENVIRONMENT = Object.freeze({
  PULSE_OPERATING_MODE: "LOCAL_PROOF",
  OPERATING_MODE: "LOCAL_PROOF",
  PULSE_PRIMARY_INSTANCE: "false",
  AUTO_PUBLISH: "false",
  PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
  PULSE_EMERGENCY_KILL_SWITCH: "true",
  PULSE_KILL_SWITCH: "true",
  YOUTUBE_AUTO_PUBLISH: "false",
  TIKTOK_ENABLED: "false",
  TIKTOK_AUTO_PUBLISH: "false",
  INSTAGRAM_AUTO_PUBLISH: "false",
  FACEBOOK_AUTO_PUBLISH: "false",
  FACEBOOK_REELS_ENABLED: "false",
  TWITTER_ENABLED: "false",
  X_AUTO_PUBLISH: "false",
  THREADS_AUTO_PUBLISH: "false",
  PINTEREST_AUTO_PUBLISH: "false",
  PULSE_MULTI_LANE_WORKERS: "false",
  PULSE_MULTI_LANE_STARTUP_PRIME: "false",
  BREAKING_WATCHER_ENABLED: "false",
  ELEVENLABS_CREDIT_MONITOR_ENABLED: "false",
  INSTAGRAM_PENDING_VERIFIER_ENABLED: "false",
  TIKTOK_AUTH_CHECK_ENABLED: "false",
  PULSE_PUBLISH_CRITICAL_RUNNER: "false",
  PULSE_MAINTENANCE_RUNNER: "false",
  PULSE_MISSED_WINDOW_RECOVERY: "false",
  PULSE_RESET_SCHEDULES_ON_BOOT: "false",
  PULSE_LOCAL_STARTUP_NOTIFICATION: "false",
  DISCORD_NOTIFY_FAILED_JOBS: "false",
});

class GovernedExactProductionPlanDrainError extends Error {
  constructor(code, cause = null) {
    super(code, cause ? { cause } : undefined);
    this.name = "GovernedExactProductionPlanDrainError";
    this.code = code;
  }
}

function fail(code, cause = null) {
  throw new GovernedExactProductionPlanDrainError(code, cause);
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
  const observed = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    observed.length !== expected.length ||
    observed.some((field, index) => field !== expected[index])
  ) {
    fail(code);
  }
}

function exactIso(value, code) {
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== String(value)
  ) {
    fail(code);
  }
  return parsed.toISOString();
}

function exactPositiveInteger(value, code, { min = 1, max } = {}) {
  const number = Number(value);
  if (
    !Number.isInteger(number) ||
    number < min ||
    (max !== undefined && number > max)
  ) {
    fail(code);
  }
  return number;
}

function exactSha256(value, code) {
  const normalised = String(value || "").trim().toLowerCase();
  if (!SHA256_PATTERN.test(normalised)) fail(code);
  return normalised;
}

function normalPath(value, code) {
  const text = String(value || "").trim();
  if (!text || !path.isAbsolute(text)) fail(code);
  const resolved = path.resolve(text);
  if (text !== resolved) fail(code);
  return resolved;
}

function normalEmbeddedPath(value, code) {
  const text = String(value || "").trim();
  if (
    !text ||
    !path.isAbsolute(text) ||
    /(^|[\\/])\.\.?([\\/]|$)/.test(text)
  ) {
    fail(code);
  }
  return path.resolve(text);
}

function samePath(left, right) {
  const a = path.resolve(String(left || ""));
  const b = path.resolve(String(right || ""));
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function pathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function normaliseRequest(value) {
  exactFields(value, REQUEST_FIELDS, "exact_plan_drain_request_fields_invalid");
  if (value.schema_version !== DRAIN_REQUEST_SCHEMA_VERSION) {
    fail("exact_plan_drain_request_schema_invalid");
  }
  if (value.mode !== MODE) fail("exact_plan_drain_local_proof_only");
  const workerId = String(value.worker_id || "").trim();
  if (!WORKER_ID_PATTERN.test(workerId)) {
    fail("exact_plan_drain_worker_id_invalid");
  }
  const expectedCommit = String(
    value.expected_checkout_commit || "",
  )
    .trim()
    .toLowerCase();
  if (!COMMIT_PATTERN.test(expectedCommit)) {
    fail("exact_plan_drain_checkout_commit_invalid");
  }
  return Object.freeze({
    schema_version: DRAIN_REQUEST_SCHEMA_VERSION,
    mode: MODE,
    generated_at: exactIso(
      value.generated_at,
      "exact_plan_drain_generated_at_invalid",
    ),
    plan_path: normalPath(
      value.plan_path,
      "exact_plan_drain_plan_path_invalid",
    ),
    expected_plan_file_sha256: exactSha256(
      value.expected_plan_file_sha256,
      "exact_plan_drain_plan_file_sha256_invalid",
    ),
    expected_plan_sha256: exactSha256(
      value.expected_plan_sha256,
      "exact_plan_drain_plan_sha256_invalid",
    ),
    workspace_root: normalPath(
      value.workspace_root,
      "exact_plan_drain_workspace_root_invalid",
    ),
    database_path: normalPath(
      value.database_path,
      "exact_plan_drain_database_path_invalid",
    ),
    runtime_profile_path: normalPath(
      value.runtime_profile_path,
      "exact_plan_drain_runtime_profile_path_invalid",
    ),
    expected_runtime_profile_file_sha256: exactSha256(
      value.expected_runtime_profile_file_sha256,
      "exact_plan_drain_runtime_profile_file_sha256_invalid",
    ),
    expected_checkout_commit: expectedCommit,
    output_dir: normalPath(
      value.output_dir,
      "exact_plan_drain_output_dir_invalid",
    ),
    worker_id: workerId,
    timeout_ms: exactPositiveInteger(
      value.timeout_ms,
      "exact_plan_drain_timeout_invalid",
      { min: 10, max: 6 * 60 * 60 * 1000 },
    ),
    poll_interval_ms: exactPositiveInteger(
      value.poll_interval_ms,
      "exact_plan_drain_poll_interval_invalid",
      { min: 1, max: 5000 },
    ),
  });
}

function parseJsonBytes(bytes, code) {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!plainObject(value)) fail(code);
    return value;
  } catch (error) {
    if (error instanceof GovernedExactProductionPlanDrainError) throw error;
    fail(code, error);
  }
}

function validateCandidateSetRevision(value, plan) {
  exactFields(
    value,
    CANDIDATE_SET_REVISION_FIELDS,
    "exact_plan_candidate_set_revision_fields_invalid",
  );
  if (
    value.schema_version !==
      CANDIDATE_SET_REVISION_SCHEMA_VERSION ||
    value.scheduled_for !== plan.scheduled_for ||
    value.channel_id !== plan.channel_id ||
    value.lane_id !== plan.lane_id ||
    value.platform !== plan.platform ||
    !Array.isArray(value.ordered_candidates) ||
    value.ordered_candidates.length < 2 ||
    !Array.isArray(value.compiled_candidate_bindings) ||
    value.compiled_candidate_bindings.length !==
      value.ordered_candidates.length
  ) {
    fail("exact_plan_candidate_set_revision_invalid");
  }
  const storyIds = new Set();
  for (
    let index = 0;
    index < value.ordered_candidates.length;
    index += 1
  ) {
    const ordered = value.ordered_candidates[index];
    const compiled = value.compiled_candidate_bindings[index];
    exactFields(
      ordered,
      ORDERED_CANDIDATE_FIELDS,
      "exact_plan_ordered_candidate_fields_invalid",
    );
    exactFields(
      compiled,
      COMPILED_CANDIDATE_BINDING_FIELDS,
      "exact_plan_compiled_candidate_binding_fields_invalid",
    );
    if (
      ordered.rank !== index + 1 ||
      compiled.rank !== index + 1 ||
      !String(ordered.story_id || "").trim() ||
      ordered.story_id !== compiled.story_id ||
      storyIds.has(ordered.story_id)
    ) {
      fail("exact_plan_candidate_set_order_invalid");
    }
    storyIds.add(ordered.story_id);
    exactSha256(
      ordered.semantic_candidate_revision_sha256,
      "exact_plan_semantic_candidate_revision_sha256_invalid",
    );
    exactSha256(
      ordered.source_evidence_sha256,
      "exact_plan_candidate_source_evidence_sha256_invalid",
    );
    exactSha256(
      compiled.candidate_revision_sha256,
      "exact_plan_compiled_candidate_revision_sha256_invalid",
    );
    exactSha256(
      compiled.request_fingerprint,
      "exact_plan_compiled_request_fingerprint_invalid",
    );
    if (!Array.isArray(ordered.timing_evidence_hashes)) {
      fail("exact_plan_timing_evidence_hashes_invalid");
    }
    let priorFieldPath = null;
    for (const timing of ordered.timing_evidence_hashes) {
      exactFields(
        timing,
        TIMING_EVIDENCE_HASH_FIELDS,
        "exact_plan_timing_evidence_hash_fields_invalid",
      );
      const fieldPath = String(timing.field_path || "").trim();
      if (
        !fieldPath ||
        fieldPath.startsWith(".") ||
        fieldPath.endsWith(".") ||
        fieldPath.includes("..") ||
        (priorFieldPath !== null &&
          fieldPath.localeCompare(priorFieldPath) <= 0)
      ) {
        fail("exact_plan_timing_evidence_hash_order_invalid");
      }
      exactSha256(
        timing.sha256,
        "exact_plan_timing_evidence_sha256_invalid",
      );
      priorFieldPath = fieldPath;
    }
  }
  const revisionBody = {
    schema_version: value.schema_version,
    scheduled_for: value.scheduled_for,
    channel_id: value.channel_id,
    lane_id: value.lane_id,
    platform: value.platform,
    ordered_candidates: value.ordered_candidates,
  };
  if (
    canonicalSha256(revisionBody) !==
      exactSha256(
        value.candidate_set_revision_sha256,
        "exact_plan_candidate_set_revision_sha256_invalid",
      ) ||
    canonicalSha256(value.compiled_candidate_bindings) !==
      exactSha256(
        value.exact_compiled_candidate_set_sha256,
        "exact_plan_compiled_candidate_set_sha256_invalid",
      )
  ) {
    fail("exact_plan_candidate_set_revision_hash_mismatch");
  }
  for (let index = 0; index < 2; index += 1) {
    const selected = plan.selected_candidates[index];
    const ordered = value.ordered_candidates[index];
    const compiled = value.compiled_candidate_bindings[index];
    if (
      selected.story_id !== ordered.story_id ||
      selected.source_evidence_sha256 !==
        ordered.source_evidence_sha256 ||
      selected.candidate_revision_sha256 !==
        compiled.candidate_revision_sha256 ||
      selected.request_fingerprint !==
        compiled.request_fingerprint
    ) {
      fail("exact_plan_candidate_set_selection_binding_mismatch");
    }
  }
  return value.candidate_set_revision_sha256;
}

function validatePlanLineage(value) {
  exactFields(
    value,
    PLAN_LINEAGE_FIELDS,
    "exact_plan_lineage_fields_invalid",
  );
  if (value.schema_version !== PLAN_LINEAGE_SCHEMA_VERSION) {
    fail("exact_plan_lineage_schema_invalid");
  }
  let supersedes = null;
  if (value.supersedes !== null) {
    exactFields(
      value.supersedes,
      SUPERSEDES_FIELDS,
      "exact_plan_lineage_supersedes_fields_invalid",
    );
    const relativePlanPath = String(
      value.supersedes.plan_path || "",
    ).trim();
    if (
      !relativePlanPath ||
      path.isAbsolute(relativePlanPath) ||
      relativePlanPath.includes("\\") ||
      relativePlanPath.split("/").some(
        (part) => !part || part === "." || part === "..",
      )
    ) {
      fail("exact_plan_lineage_supersedes_path_invalid");
    }
    supersedes = {
      candidate_set_revision_sha256: exactSha256(
        value.supersedes.candidate_set_revision_sha256,
        "exact_plan_lineage_candidate_set_sha256_invalid",
      ),
      plan_file_sha256: exactSha256(
        value.supersedes.plan_file_sha256,
        "exact_plan_lineage_plan_file_sha256_invalid",
      ),
      plan_path: relativePlanPath,
      plan_sha256: exactSha256(
        value.supersedes.plan_sha256,
        "exact_plan_lineage_plan_sha256_invalid",
      ),
    };
  }
  const lineageBody = {
    schema_version: value.schema_version,
    supersedes,
  };
  if (
    canonicalSha256(lineageBody) !==
    exactSha256(
      value.lineage_sha256,
      "exact_plan_lineage_sha256_invalid",
    )
  ) {
    fail("exact_plan_lineage_hash_mismatch");
  }
  return supersedes;
}

function legacyCandidateSetRevision(plan) {
  if (
    !Array.isArray(plan.selected_candidates) ||
    plan.selected_candidates.length !== 2 ||
    !Array.isArray(plan.production_jobs) ||
    plan.production_jobs.length !== 2 ||
    !Array.isArray(plan.not_selected_story_ids)
  ) {
    fail("exact_plan_legacy_candidate_set_invalid");
  }
  const body = {
    schema_version:
      "pulse-governed-autonomous-window-legacy-candidate-set-revision-v1",
    scheduled_for: plan.scheduled_for,
    channel_id: plan.channel_id,
    lane_id: plan.lane_id,
    platform: plan.platform,
    selected_candidates: plan.selected_candidates.map(
      (candidate) => ({
        story_id: String(candidate.story_id || "").trim(),
        role: String(candidate.role || "")
          .trim()
          .toUpperCase(),
        candidate_revision_sha256: exactSha256(
          candidate.candidate_revision_sha256,
          "exact_plan_legacy_candidate_revision_sha256_invalid",
        ),
        request_fingerprint: exactSha256(
          candidate.request_fingerprint,
          "exact_plan_legacy_request_fingerprint_invalid",
        ),
        source_evidence_sha256: exactSha256(
          candidate.source_evidence_sha256,
          "exact_plan_legacy_source_evidence_sha256_invalid",
        ),
      }),
    ),
    not_selected_story_ids: [...plan.not_selected_story_ids]
      .map((storyId) => String(storyId || "").trim())
      .sort(),
    production_jobs: plan.production_jobs.map((job) => ({
      job_id: Number(job.job_id),
      story_id: String(job.story_id || "").trim(),
      role: String(job.role || "")
        .trim()
        .toUpperCase(),
      idempotency_key: String(job.idempotency_key || "").trim(),
      builder_sha256: exactSha256(
        job.builder_sha256,
        "exact_plan_legacy_builder_sha256_invalid",
      ),
    })),
  };
  if (
    body.not_selected_story_ids.some((storyId) => !storyId) ||
    body.selected_candidates.some(
      (candidate, index) =>
        !candidate.story_id ||
        candidate.role !==
          (index === 0 ? "PRIMARY" : "STANDBY"),
    ) ||
    body.production_jobs.some(
      (job, index) =>
        !Number.isInteger(job.job_id) ||
        job.job_id <= 0 ||
        !job.story_id ||
        !job.idempotency_key ||
        job.role !==
          (index === 0 ? "PRIMARY" : "STANDBY") ||
        job.story_id !==
          body.selected_candidates[index].story_id,
    )
  ) {
    fail("exact_plan_legacy_candidate_set_invalid");
  }
  return canonicalSha256(body);
}

function planCandidateSetRevisionSha256(plan) {
  return plan.schema_version === PLAN_SCHEMA_VERSION_V2
    ? plan.candidate_set_revision.candidate_set_revision_sha256
    : legacyCandidateSetRevision(plan);
}

function validatePlan(value, expectedPlanSha256) {
  if (!plainObject(value)) fail("exact_plan_structure_invalid");
  const schemaVersion = String(value.schema_version || "");
  if (schemaVersion === PLAN_SCHEMA_VERSION_V1) {
    exactFields(
      value,
      PLAN_FIELDS_V1,
      "exact_plan_v1_structure_invalid",
    );
  } else if (schemaVersion === PLAN_SCHEMA_VERSION_V2) {
    exactFields(
      value,
      PLAN_FIELDS_V2,
      "exact_plan_v2_structure_invalid",
    );
  } else {
    fail("exact_plan_schema_invalid");
  }
  if (
    value.mode !== MODE ||
    value.verdict !== "QUEUED_LOCAL_PROOF" ||
    value.channel_id !== "pulse-gaming" ||
    value.lane_id !== "breaking_short" ||
    value.platform !== "youtube" ||
    value.job_queue_state !== "EXACT_TWO_DURABLE_JOBS_PRESENT" ||
    value.database_scope !== "DURABLE_JOB_QUEUE_ONLY" ||
    value.story_approval_mutated !== false ||
    value.human_approval_dependency !== false ||
    value.source_network_used !== false ||
    value.platform_contacted !== false ||
    value.oauth_or_tokens_mutated !== false ||
    value.publish_authority_created !== false ||
    value.scheduler_authority_created !== false ||
    value.external_posting !== false
  ) {
    fail("exact_plan_policy_invalid");
  }
  if (
    value.selection_policy !== SELECTION_POLICY ||
    !Number.isInteger(value.eligible_candidate_count) ||
    value.eligible_candidate_count < 2 ||
    !Array.isArray(value.not_selected_story_ids)
  ) {
    fail("exact_plan_selection_contract_invalid");
  }
  exactIso(value.generated_at, "exact_plan_generated_at_invalid");
  exactIso(value.scheduled_for, "exact_plan_scheduled_for_invalid");
  if (
    !Array.isArray(value.selected_candidates) ||
    value.selected_candidates.length !== 2 ||
    !Array.isArray(value.production_jobs) ||
    value.production_jobs.length !== 2
  ) {
    fail("exact_plan_two_candidate_job_contract_invalid");
  }
  const expectedRoles = ["PRIMARY", "STANDBY"];
  exactFields(
    value.reservation_set,
    PLAN_RESERVATION_FIELDS,
    "exact_plan_reservation_reference_fields_invalid",
  );
  exactSha256(
    value.reservation_set.file_sha256,
    "exact_plan_reservation_file_sha256_invalid",
  );
  exactSha256(
    value.reservation_set.reservation_set_sha256,
    "exact_plan_reservation_set_sha256_invalid",
  );
  const ids = new Set();
  const storyIds = new Set();
  const databaseStoryIds = new Set();
  const idempotencyKeys = new Set();
  for (let index = 0; index < 2; index += 1) {
    const selected = value.selected_candidates[index];
    const plannedJob = value.production_jobs[index];
    exactFields(
      selected,
      SELECTED_FIELDS,
      "exact_plan_selected_candidate_fields_invalid",
    );
    exactFields(
      plannedJob,
      PLAN_JOB_FIELDS,
      "exact_plan_production_job_fields_invalid",
    );
    const role = expectedRoles[index];
    if (
      selected.role !== role ||
      plannedJob.role !== role ||
      selected.story_id !== plannedJob.story_id ||
      selected.builder_sha256 !== plannedJob.builder_sha256 ||
      plannedJob.kind !== "produce_breaking_short"
    ) {
      fail("exact_plan_role_identity_binding_invalid");
    }
    exactSha256(
      selected.builder_sha256,
      "exact_plan_builder_sha256_invalid",
    );
    exactSha256(
      selected.candidate_revision_sha256,
      "exact_plan_candidate_revision_sha256_invalid",
    );
    exactSha256(
      selected.request_fingerprint,
      "exact_plan_request_fingerprint_invalid",
    );
    const jobId = exactPositiveInteger(
      plannedJob.job_id,
      "exact_plan_job_id_invalid",
    );
    if (
      !String(plannedJob.story_id || "").trim() ||
      !String(plannedJob.database_story_id || "").trim() ||
      !String(plannedJob.idempotency_key || "").trim() ||
      ids.has(jobId) ||
      storyIds.has(plannedJob.story_id) ||
      databaseStoryIds.has(plannedJob.database_story_id) ||
      idempotencyKeys.has(plannedJob.idempotency_key)
    ) {
      fail("exact_plan_job_identity_not_distinct");
    }
    ids.add(jobId);
    storyIds.add(plannedJob.story_id);
    databaseStoryIds.add(plannedJob.database_story_id);
    idempotencyKeys.add(plannedJob.idempotency_key);
  }
  const notSelectedStoryIds = value.not_selected_story_ids.map(
    (storyId) => String(storyId || "").trim(),
  );
  if (
    value.eligible_candidate_count !==
      2 + notSelectedStoryIds.length ||
    notSelectedStoryIds.some(
      (storyId, index) =>
        !storyId ||
        storyId !== value.not_selected_story_ids[index] ||
        storyIds.has(storyId) ||
        (index > 0 &&
          storyId.localeCompare(notSelectedStoryIds[index - 1]) <= 0),
    )
  ) {
    fail("exact_plan_selection_contract_invalid");
  }
  if (schemaVersion === PLAN_SCHEMA_VERSION_V2) {
    validateCandidateSetRevision(
      value.candidate_set_revision,
      value,
    );
    const orderedStoryIds =
      value.candidate_set_revision.ordered_candidates.map(
        (candidate) => candidate.story_id,
      );
    if (
      orderedStoryIds.length !== value.eligible_candidate_count ||
      notSelectedStoryIds.some(
        (storyId) => !orderedStoryIds.slice(2).includes(storyId),
      ) ||
      orderedStoryIds
        .slice(2)
        .some((storyId) => !notSelectedStoryIds.includes(storyId))
    ) {
      fail("exact_plan_selection_contract_invalid");
    }
    validatePlanLineage(value.lineage);
  }
  const body = { ...value };
  delete body.plan_sha256;
  const observedSha256 = canonicalSha256(body);
  if (
    value.plan_sha256 !== observedSha256 ||
    value.plan_sha256 !== expectedPlanSha256
  ) {
    fail("exact_plan_sha256_mismatch");
  }
  return Object.freeze(value);
}

function canonicalPlanPathShape(rootPath, planPath) {
  const relative = path.relative(rootPath, planPath);
  const parts = relative.split(path.sep);
  const canonicalName =
    parts.at(-1) === "production-plan.json";
  const revision =
    parts.length >= 3 &&
    parts.at(-3) === "revisions" &&
    SHA256_PATTERN.test(String(parts.at(-2) || ""));
  return {
    canonical_name: canonicalName,
    revision,
    revision_sha256: revision ? parts.at(-2) : null,
    base_directory: revision
      ? path.resolve(
          rootPath,
          ...parts.slice(0, parts.length - 3),
        )
      : path.dirname(planPath),
    contains_revision_segment: parts.includes("revisions"),
  };
}

async function validatePlanLineageBinding({
  plan,
  planPath,
  root,
  fileSystem,
}) {
  const currentCandidateSetSha256 =
    planCandidateSetRevisionSha256(plan);
  let link =
    plan.schema_version === PLAN_SCHEMA_VERSION_V2
      ? validatePlanLineage(plan.lineage)
      : null;
  const currentShape = canonicalPlanPathShape(
    root.path,
    planPath,
  );
  if (link) {
    if (
      !currentShape.canonical_name ||
      !currentShape.revision ||
      currentShape.revision_sha256 !==
        currentCandidateSetSha256
    ) {
      fail("exact_plan_lineage_successor_path_mismatch");
    }
  } else if (
    !currentShape.canonical_name ||
    currentShape.revision ||
    currentShape.contains_revision_segment
  ) {
    fail("exact_plan_lineage_root_path_mismatch");
  }
  const seenPlanHashes = new Set([plan.plan_sha256]);
  const predecessors = [];
  const predecessorPlans = [];
  while (link) {
    if (seenPlanHashes.has(link.plan_sha256)) {
      fail("exact_plan_lineage_cycle");
    }
    seenPlanHashes.add(link.plan_sha256);
    if (predecessors.length >= 100) {
      fail("exact_plan_lineage_depth_exceeded");
    }
    const predecessorPath = path.resolve(
      root.path,
      ...link.plan_path.split("/"),
    );
    if (!pathWithin(root.path, predecessorPath)) {
      fail("exact_plan_lineage_predecessor_outside_workspace");
    }
    const bytes = await exactFile(
      predecessorPath,
      root,
      fileSystem,
      "exact_plan_lineage_predecessor_outside_workspace",
    );
    const fileSha256 = sha256Bytes(bytes);
    if (fileSha256 !== link.plan_file_sha256) {
      fail("exact_plan_lineage_predecessor_file_sha256_mismatch");
    }
    const predecessor = validatePlan(
      parseJsonBytes(
        bytes,
        "exact_plan_lineage_predecessor_json_invalid",
      ),
      link.plan_sha256,
    );
    const predecessorShape = canonicalPlanPathShape(
      root.path,
      predecessorPath,
    );
    const predecessorLink =
      predecessor.schema_version === PLAN_SCHEMA_VERSION_V2
        ? validatePlanLineage(predecessor.lineage)
        : null;
    if (
      !predecessorShape.canonical_name ||
      (predecessorLink &&
        (!predecessorShape.revision ||
          predecessorShape.revision_sha256 !==
            planCandidateSetRevisionSha256(predecessor))) ||
      (!predecessorLink &&
        (predecessorShape.revision ||
          predecessorShape.contains_revision_segment)) ||
      !samePath(
        predecessorShape.base_directory,
        currentShape.base_directory,
      )
    ) {
      fail("exact_plan_lineage_predecessor_path_mismatch");
    }
    if (
      predecessor.scheduled_for !== plan.scheduled_for ||
      predecessor.channel_id !== plan.channel_id ||
      predecessor.lane_id !== plan.lane_id ||
      predecessor.platform !== plan.platform ||
      planCandidateSetRevisionSha256(predecessor) !==
        link.candidate_set_revision_sha256
    ) {
      fail("exact_plan_lineage_predecessor_binding_mismatch");
    }
    predecessors.push({
      path: predecessorPath,
      relative_path: link.plan_path,
      file_sha256: fileSha256,
      plan_sha256: predecessor.plan_sha256,
      candidate_set_revision_sha256:
        link.candidate_set_revision_sha256,
      schema_version: predecessor.schema_version,
    });
    predecessorPlans.push(predecessor);
    link = predecessorLink;
  }
  return {
    inspection: {
      schema_version: plan.schema_version,
      candidate_set_revision_sha256:
        currentCandidateSetSha256,
      predecessor_count: predecessors.length,
      predecessors,
    },
    predecessor_plans: predecessorPlans,
  };
}

async function validateReservationBinding({
  plan,
  root,
  fileSystem,
}) {
  const reservationPath = normalPath(
    plan.reservation_set.path,
    "exact_plan_reservation_path_invalid",
  );
  if (!pathWithin(root.path, reservationPath)) {
    fail("exact_plan_reservation_outside_workspace");
  }
  const bytes = await exactFile(
    reservationPath,
    root,
    fileSystem,
    "exact_plan_reservation_outside_workspace",
  );
  const fileSha256 = sha256Bytes(bytes);
  if (fileSha256 !== plan.reservation_set.file_sha256) {
    fail("exact_plan_reservation_file_sha256_mismatch");
  }
  let reservation;
  try {
    reservation = validateGovernedAutonomousWindowReservationSet(
      parseJsonBytes(
        bytes,
        "exact_plan_reservation_json_invalid",
      ),
    );
  } catch (error) {
    if (error instanceof GovernedExactProductionPlanDrainError) throw error;
    fail("exact_plan_reservation_invalid", error);
  }
  const expectedReservations = plan.production_jobs.map((job) => ({
    role: job.role,
    story_id: job.story_id,
  }));
  if (
    reservation.reservation_set_sha256 !==
      plan.reservation_set.reservation_set_sha256 ||
    reservation.generated_at !== plan.generated_at ||
    reservation.scheduled_for !== plan.scheduled_for ||
    reservation.channel_id !== plan.channel_id ||
    reservation.lane_id !== plan.lane_id ||
    reservation.platform !== plan.platform ||
    canonicalSha256(reservation.reservations) !==
      canonicalSha256(expectedReservations)
  ) {
    fail("exact_plan_reservation_binding_mismatch");
  }
  return {
    path: reservationPath,
    file_sha256: fileSha256,
    reservation_set_sha256:
      reservation.reservation_set_sha256,
  };
}

function parseSqliteTimestamp(value) {
  const text = String(value || "").trim();
  const normalised =
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
      ? `${text.replace(" ", "T")}Z`
      : text;
  const parsed = Date.parse(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

function exactIdempotencyKey(builder) {
  return (
    "governed-autonomous-breaking-production:v1:" +
    canonicalSha256({
      reservation_set_sha256: builder.reservation_set_sha256,
      story_id: builder.story_id,
      role: builder.role,
      scheduled_for: builder.scheduled_for,
      builder_sha256: builder.builder_sha256,
    })
  );
}

function parsePayload(value) {
  if (plainObject(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ""));
    return plainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readActiveBreakingJobs(db) {
  return db
    .prepare(
      `SELECT id, kind, channel_id, story_id, payload, priority, run_at,
              status, attempt_count, max_attempts, requires_gpu,
              idempotency_key, claimed_by, claimed_at, lease_until
       FROM jobs
       WHERE kind = 'produce_breaking_short'
         AND status IN ('pending', 'claimed', 'running')
       ORDER BY priority ASC, run_at ASC, id ASC`,
    )
    .all()
    .map((row) => ({ ...row, payload: parsePayload(row.payload) }));
}

function readPlanJobs(db, plan) {
  const query = db.prepare(
    `SELECT id, kind, channel_id, story_id, payload, priority, run_at,
            status, attempt_count, max_attempts, requires_gpu,
            idempotency_key, claimed_by, claimed_at, lease_until,
            completed_at, last_error
     FROM jobs
     WHERE id = ?`,
  );
  return plan.production_jobs.map((job) => {
    const row = query.get(job.job_id);
    return row ? { ...row, payload: parsePayload(row.payload) } : null;
  });
}

function validatePlanJobRows({
  db,
  plan,
  workspaceRoot,
  statusPolicy,
  errorPrefix = "exact_plan",
}) {
  const rows = readPlanJobs(db, plan);
  const bindingCode =
    errorPrefix === "exact_plan_lineage_predecessor"
      ? "exact_plan_lineage_predecessor_job_binding_mismatch"
      : null;
  for (let index = 0; index < 2; index += 1) {
    const planned = plan.production_jobs[index];
    const selected = plan.selected_candidates[index];
    const row = rows[index];
    if (!row) {
      fail(
        bindingCode || `${errorPrefix}_database_job_missing`,
      );
    }
    if (
      row.kind !== planned.kind ||
      row.channel_id !== "pulse-gaming" ||
      row.story_id !== planned.database_story_id ||
      row.idempotency_key !== planned.idempotency_key ||
      Number(row.priority) !== (index === 0 ? 10 : 11) ||
      Number(row.max_attempts) !== 3 ||
      Number(row.requires_gpu) !== 0 ||
      !Number.isInteger(Number(row.attempt_count)) ||
      Number(row.attempt_count) < 0 ||
      Number(row.attempt_count) > Number(row.max_attempts) ||
      parseSqliteTimestamp(row.run_at) === null ||
      parseSqliteTimestamp(row.run_at) > Date.now()
    ) {
      fail(
        bindingCode ||
          `${errorPrefix}_database_job_binding_mismatch`,
      );
    }
    if (!statusPolicy(row.status, row, index)) {
      fail(
        errorPrefix === "exact_plan_lineage_predecessor"
          ? "exact_plan_lineage_predecessor_job_not_terminal"
          : "exact_plan_database_job_status_invalid",
      );
    }
    const payload = row.payload;
    if (
      !plainObject(payload) ||
      payload.lane_id !== "breaking_short" ||
      payload.story_id !== planned.story_id ||
      payload.candidate_revision_sha256 !==
        selected.candidate_revision_sha256 ||
      !plainObject(payload.autonomous_production_job) ||
        payload.autonomous_production_job.schema_version !==
        "pulse-governed-autonomous-production-job-payload-v1"
    ) {
      fail(
        bindingCode ||
          `${errorPrefix}_database_payload_binding_mismatch`,
      );
    }
    let builder;
    try {
      builder = validateGovernedAutonomousProductionRequestBuild(
        payload.autonomous_production_job.builder_result,
      );
    } catch (error) {
      fail(
        bindingCode || `${errorPrefix}_builder_invalid`,
        error,
      );
    }
    if (
      builder.role !== planned.role ||
      builder.story_id !== planned.story_id ||
      builder.builder_sha256 !== planned.builder_sha256 ||
      builder.builder_sha256 !== selected.builder_sha256 ||
      builder.scheduled_for !== plan.scheduled_for ||
      builder.production_request.candidate_revision_sha256 !==
        selected.candidate_revision_sha256 ||
      builder.production_request.request_fingerprint !==
        selected.request_fingerprint ||
      !samePath(
        builder.production_request.workspace_root,
        workspaceRoot,
      ) ||
      exactIdempotencyKey(builder) !== planned.idempotency_key
    ) {
      fail(
        bindingCode ||
          `${errorPrefix}_builder_binding_mismatch`,
      );
    }
  }
  return rows;
}

function validateQueueBindings({ db, plan, workspaceRoot }) {
  const rows = validatePlanJobRows({
    db,
    plan,
    workspaceRoot,
    statusPolicy: (status) =>
      status === "pending" || status === "done",
  });
  const statuses = rows.map((row) => row.status);
  const accepted =
    (statuses[0] === "pending" && statuses[1] === "pending") ||
    (statuses[0] === "done" && statuses[1] === "pending") ||
    (statuses[0] === "done" && statuses[1] === "done");
  if (!accepted) fail("exact_plan_database_job_status_invalid");
  const expectedActive = plan.production_jobs
    .filter((_job, index) => statuses[index] === "pending")
    .map((job) => Number(job.job_id));
  const active = readActiveBreakingJobs(db);
  if (
    active.length !== expectedActive.length ||
    active.some(
      (row, index) => Number(row.id) !== expectedActive[index],
    )
  ) {
    fail("exact_plan_active_breaking_job_set_mismatch");
  }
  return { rows, active, statuses };
}

function validatePredecessorQueueBindings({
  db,
  predecessorPlans,
  workspaceRoot,
}) {
  for (const predecessor of predecessorPlans) {
    validatePlanJobRows({
      db,
      plan: predecessor,
      workspaceRoot,
      statusPolicy: (status) =>
        ["done", "failed", "cancelled"].includes(status),
      errorPrefix: "exact_plan_lineage_predecessor",
    });
  }
}

function normaliseQuiescence(value) {
  const fields = [
    "owner_pids",
    "listener_pids",
    "scheduler_process_pids",
    "enabled_tasks",
    "running_tasks",
    "task_states",
    "absent_task_names",
  ];
  const report = {
    available: value?.available === true,
    probe_attestations: {},
  };
  for (const probe of PROBE_NAMES) {
    report.probe_attestations[probe] =
      value?.probe_attestations?.[probe] === true;
  }
  for (const field of fields) {
    report[field] = Array.isArray(value?.[field])
      ? [...value[field]]
      : [];
  }
  return report;
}

function assertQuiescent(value) {
  const report = normaliseQuiescence(value);
  if (
    !report.available ||
    PROBE_NAMES.some(
      (probe) => report.probe_attestations[probe] !== true,
    )
  ) {
    fail("exact_plan_runtime_quiescence_inspection_unavailable");
  }
  if (
    report.owner_pids.length ||
    report.listener_pids.length ||
    report.scheduler_process_pids.length ||
    report.enabled_tasks.length ||
    report.running_tasks.length
  ) {
    fail("exact_plan_live_runtime_not_quiescent");
  }
  return report;
}

function powershellProbe(
  expectedProbe,
  source,
  execFileSyncImpl = execFileSync,
) {
  const output = String(
    execFileSyncImpl(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        source,
      ],
      {
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ) || "",
  ).trim();
  if (!output) {
    fail("exact_plan_runtime_probe_attestation_invalid");
  }
  const parsed = JSON.parse(output);
  if (
    !plainObject(parsed) ||
    parsed.probe !== expectedProbe ||
    parsed.attested !== true ||
    !Array.isArray(parsed.items)
  ) {
    fail("exact_plan_runtime_probe_attestation_invalid");
  }
  return parsed;
}

function psLiteral(value) {
  const text = String(value || "");
  if (/[\r\n]/.test(text)) {
    fail("exact_plan_runtime_inspection_value_invalid");
  }
  return `'${text.replace(/'/g, "''")}'`;
}

function inspectWindowsPulseQuiescence({
  profile,
  workspaceRoot,
  execFileSyncImpl = execFileSync,
  fileSystemSync = require("node:fs"),
  platform = process.platform,
} = {}) {
  if (platform !== "win32") {
    return {
      available: false,
      probe_attestations: {
        listeners: false,
        processes: false,
        scheduled_tasks: false,
      },
      owner_pids: [],
      listener_pids: [],
      scheduler_process_pids: [],
      enabled_tasks: [],
      running_tasks: [],
      task_states: [],
      absent_task_names: [],
    };
  }
  try {
    const port = Number(profile?.port);
    if (!Number.isInteger(port) || port !== 3001) {
      fail("exact_plan_runtime_profile_port_invalid");
    }
    const listenerProbe = powershellProbe(
      "listeners",
      "$ErrorActionPreference = 'Stop'; try { " +
        `$items = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | ` +
        `Where-Object { [int]$_.LocalPort -eq ${port} } | ` +
        "Select-Object -ExpandProperty OwningProcess -Unique); " +
        "[pscustomobject]@{probe='listeners';attested=$true;" +
        "items=@($items)} | ConvertTo-Json -Depth 6 -Compress " +
        "} catch { [Console]::Error.WriteLine('listeners_probe_failed'); exit 7 }",
      execFileSyncImpl,
    );
    const processProbe = powershellProbe(
      "processes",
      "$ErrorActionPreference = 'Stop'; try { " +
        "$items = @(Get-CimInstance Win32_Process -ErrorAction Stop | " +
        "Where-Object { $_.Name -ieq 'node.exe' } | " +
        "Select-Object @{n='pid';e={[int]$_.ProcessId}}," +
        "@{n='command_line';e={[string]$_.CommandLine}}); " +
        "if (@($items | Where-Object { [string]::IsNullOrWhiteSpace(" +
        "$_.command_line) }).Count -gt 0) { throw 'node_command_line_unavailable' }; " +
        "[pscustomobject]@{probe='processes';attested=$true;" +
        "items=@($items)} | ConvertTo-Json -Depth 6 -Compress " +
        "} catch { [Console]::Error.WriteLine('processes_probe_failed'); exit 8 }",
      execFileSyncImpl,
    );
    const taskNames = [
      profile.task_name,
      ...(Array.isArray(profile.conflicting_task_names)
        ? profile.conflicting_task_names
        : []),
    ];
    if (
      taskNames.some(
        (name) => !String(name || "").trim() || /[\\/]/.test(name),
      )
    ) {
      fail("exact_plan_runtime_task_name_invalid");
    }
    const taskArray = taskNames
      .map((name) => psLiteral(name))
      .join(",");
    const taskProbe = powershellProbe(
      "scheduled_tasks",
      "$ErrorActionPreference = 'Stop'; try { " +
        "$service = New-Object -ComObject 'Schedule.Service'; " +
        "$service.Connect(); $folder = $service.GetFolder('\\'); " +
        `$names = @(${taskArray}); $items = @(); $absent = @(); ` +
        "foreach ($name in $names) { try { " +
        "$task = $folder.GetTask('\\' + $name); " +
        "$items += [pscustomobject]@{TaskName=[string]$name;" +
        "State=[int]$task.State;Enabled=[bool]$task.Enabled} " +
        "} catch { if ([int]$_.Exception.HResult -eq -2147024894) { " +
        "$absent += [string]$name } else { throw } } }; " +
        "[pscustomobject]@{probe='scheduled_tasks';attested=$true;" +
        "items=@($items);absent_task_names=@($absent)} | " +
        "ConvertTo-Json -Depth 6 -Compress " +
        "} catch { [Console]::Error.WriteLine('scheduled_tasks_probe_failed'); exit 9 }",
      execFileSyncImpl,
    );
    if (!Array.isArray(taskProbe.absent_task_names)) {
      fail("exact_plan_runtime_probe_attestation_invalid");
    }
    const listenerRows = listenerProbe.items;
    const processRows = processProbe.items;
    const taskRows = taskProbe.items;
    const workspaceHint = String(workspaceRoot || "")
      .replace(/\\/g, "/")
      .toLowerCase();
    const stateHint = String(profile.state_root || "")
      .replace(/\\/g, "/")
      .toLowerCase();
    const runtimePattern =
      /(windows-local-runtime-supervisor|windows-live-guarded-runtime|server\.js|run\.js\s+schedule|bootstrap-queue)/i;
    const schedulerPattern =
      /(server\.js|run\.js\s+schedule|bootstrap-queue)/i;
    const pulseProcesses = processRows.filter((row) => {
      const command = String(row.command_line || "");
      const normal = command.replace(/\\/g, "/").toLowerCase();
      return (
        runtimePattern.test(command) &&
        (normal.includes(workspaceHint) ||
          normal.includes(stateHint) ||
          normal.includes("pulse-gaming") ||
          normal.includes("pulse-worktrees"))
      );
    });
    const ownerPids = new Set();
    const ownerPath = path.join(
      path.resolve(String(profile.state_root || "")),
      "supervisor-owner.json",
    );
    if (fileSystemSync.existsSync(ownerPath)) {
      try {
        const owner = JSON.parse(
          fileSystemSync.readFileSync(ownerPath, "utf8"),
        );
        for (const pid of [owner.pid, owner.child_pid]) {
          if (
            processRows.some(
              (row) => Number(row.pid) === Number(pid),
            )
          ) {
            ownerPids.add(Number(pid));
          }
        }
      } catch {
        return {
          available: false,
          owner_pids: [],
          listener_pids: [],
          scheduler_process_pids: [],
          enabled_tasks: [],
          running_tasks: [],
        };
      }
    }
    for (const row of pulseProcesses) ownerPids.add(Number(row.pid));
    return {
      available: true,
      probe_attestations: {
        listeners: true,
        processes: true,
        scheduled_tasks: true,
      },
      owner_pids: [...ownerPids]
        .filter(Number.isInteger)
        .sort((a, b) => a - b),
      listener_pids: listenerRows
        .map(Number)
        .filter(Number.isInteger)
        .sort((a, b) => a - b),
      scheduler_process_pids: pulseProcesses
        .filter((row) =>
          schedulerPattern.test(String(row.command_line || "")),
        )
        .map((row) => Number(row.pid))
        .filter(Number.isInteger)
        .sort((a, b) => a - b),
      enabled_tasks: taskRows
        .filter((row) => row.Enabled === true)
        .map((row) => String(row.TaskName))
        .sort(),
      running_tasks: taskRows
        .filter(
          (row) => {
            const raw = row.State;
            return (
              Number(raw) === 4 ||
              String(raw || "").trim().toLowerCase() === "running"
            );
          },
        )
        .map((row) => String(row.TaskName))
        .sort(),
      task_states: taskRows
        .map((row) => ({
          task_name: String(row.TaskName),
          state:
            Number(row.State) === 4
              ? "Running"
              : String(row.State),
          enabled: row.Enabled === true,
        }))
        .sort((left, right) =>
          left.task_name.localeCompare(right.task_name),
        ),
      absent_task_names: taskProbe.absent_task_names
        .map(String)
        .sort(),
    };
  } catch {
    return {
      available: false,
      probe_attestations: {
        listeners: false,
        processes: false,
        scheduled_tasks: false,
      },
      owner_pids: [],
      listener_pids: [],
      scheduler_process_pids: [],
      enabled_tasks: [],
      running_tasks: [],
      task_states: [],
      absent_task_names: [],
    };
  }
}

function inspectWorkspace(
  { workspaceRoot },
  execFileSyncImpl = execFileSync,
) {
  try {
    const commit = String(
      execFileSyncImpl("git", ["rev-parse", "HEAD"], {
        cwd: workspaceRoot,
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    )
      .trim()
      .toLowerCase();
    const status = String(
      execFileSyncImpl(
        "git",
        ["status", "--porcelain", "--untracked-files=no"],
        {
          cwd: workspaceRoot,
          encoding: "utf8",
          timeout: 5000,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    ).trim();
    return {
      available: COMMIT_PATTERN.test(commit),
      commit,
      tracked_clean: status === "",
    };
  } catch {
    return {
      available: false,
      commit: null,
      tracked_clean: false,
    };
  }
}

async function exactRoot(rootPath, fileSystem) {
  let stat;
  try {
    stat = await fileSystem.lstat(rootPath);
  } catch (error) {
    fail("exact_plan_drain_workspace_root_missing", error);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("exact_plan_drain_workspace_root_invalid");
  }
  const real = path.resolve(await fileSystem.realpath(rootPath));
  if (!samePath(real, rootPath)) {
    fail("exact_plan_drain_workspace_root_link_forbidden");
  }
  return Object.freeze({ path: rootPath, real_path: real });
}

async function exactFile(filePath, root, fileSystem, outsideCode) {
  let stat;
  try {
    stat = await fileSystem.lstat(filePath);
  } catch (error) {
    fail("exact_plan_drain_input_file_missing", error);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("exact_plan_drain_input_file_invalid");
  }
  const real = path.resolve(await fileSystem.realpath(filePath));
  if (!samePath(real, filePath)) {
    fail("exact_plan_drain_input_link_forbidden");
  }
  if (!pathWithin(root.real_path, real)) fail(outsideCode);
  return fileSystem.readFile(filePath);
}

async function exactDatabaseFile(databasePath, fileSystem) {
  let stat;
  try {
    stat = await fileSystem.lstat(databasePath);
  } catch (error) {
    fail("exact_plan_database_file_missing", error);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("exact_plan_database_file_invalid");
  }
  const real = path.resolve(
    await fileSystem.realpath(databasePath),
  );
  if (!samePath(real, databasePath)) {
    fail("exact_plan_database_link_forbidden");
  }
  return Object.freeze({
    path: databasePath,
    real_path: real,
    size: Number(stat.size),
  });
}

async function inspectAbsentNoLinkPath(filePath, fileSystem) {
  const exactPath = path.resolve(String(filePath || ""));
  if (!path.isAbsolute(exactPath) || exactPath !== filePath) {
    fail("exact_plan_activation_receipt_path_invalid");
  }
  try {
    await fileSystem.lstat(exactPath);
    fail("exact_plan_activation_receipt_present");
  } catch (error) {
    if (
      error instanceof GovernedExactProductionPlanDrainError
    ) {
      throw error;
    }
    if (error?.code !== "ENOENT") {
      fail("exact_plan_activation_receipt_inspection_failed");
    }
  }
  let existingParent = path.dirname(exactPath);
  for (;;) {
    try {
      const stat = await fileSystem.lstat(existingParent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        fail("exact_plan_activation_receipt_parent_link_forbidden");
      }
      const real = path.resolve(
        await fileSystem.realpath(existingParent),
      );
      if (!samePath(real, existingParent)) {
        fail("exact_plan_activation_receipt_parent_link_forbidden");
      }
      break;
    } catch (error) {
      if (
        error instanceof GovernedExactProductionPlanDrainError
      ) {
        throw error;
      }
      if (error?.code !== "ENOENT") {
        fail("exact_plan_activation_receipt_inspection_failed");
      }
      const parent = path.dirname(existingParent);
      if (parent === existingParent) {
        fail("exact_plan_activation_receipt_inspection_failed");
      }
      existingParent = parent;
    }
  }
  return {
    path: exactPath,
    absent: true,
    parent_real_path: existingParent,
  };
}

async function ensureOutputRoot(root, outputDir, fileSystem) {
  if (
    !pathWithin(root.path, outputDir) ||
    samePath(root.path, outputDir)
  ) {
    fail("exact_plan_drain_output_outside_workspace");
  }
  const relative = path.relative(root.path, outputDir);
  let cursor = root.path;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      await fileSystem.mkdir(cursor);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const stat = await fileSystem.lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail("exact_plan_drain_output_path_invalid");
    }
    const real = path.resolve(await fileSystem.realpath(cursor));
    if (
      !samePath(real, cursor) ||
      !pathWithin(root.real_path, real)
    ) {
      fail("exact_plan_drain_output_outside_workspace");
    }
  }
}

function buildLocalProofEnvironment(baseEnvironment, profile, request) {
  return Object.freeze({
    ...baseEnvironment,
    ...(plainObject(profile.environment)
      ? profile.environment
      : {}),
    ...AUTHORITY_ENVIRONMENT,
    USE_SQLITE: "true",
    USE_JOB_QUEUE: "true",
    SQLITE_DB_PATH: request.database_path,
    CHANNEL: "pulse-gaming",
    PULSE_STATE_ROOT: String(profile.state_root || ""),
  });
}

function applyLocalProofProcessEnvironment(
  environment,
  localEnvironment,
) {
  const previous = new Map();
  const values = {
    ...AUTHORITY_ENVIRONMENT,
    USE_SQLITE: localEnvironment.USE_SQLITE,
    USE_JOB_QUEUE: localEnvironment.USE_JOB_QUEUE,
    SQLITE_DB_PATH: localEnvironment.SQLITE_DB_PATH,
    CHANNEL: localEnvironment.CHANNEL,
    PULSE_STATE_ROOT: localEnvironment.PULSE_STATE_ROOT,
  };
  for (const [key, value] of Object.entries(values)) {
    previous.set(
      key,
      Object.prototype.hasOwnProperty.call(environment, key)
        ? { present: true, value: environment[key] }
        : { present: false, value: undefined },
    );
    environment[key] = value;
  }
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const [key, state] of previous) {
      if (state.present) environment[key] = state.value;
      else delete environment[key];
    }
  };
}

function safeBlocker(error) {
  if (
    error instanceof GovernedExactProductionPlanDrainError &&
    /^exact_plan_[a-z0-9_]+$/.test(String(error.code || ""))
  ) {
    return error.code;
  }
  if (
    /^exact_plan_unexpected_error:[a-f0-9]{64}$/.test(
      String(error?.code || ""),
    )
  ) {
    return String(error.code);
  }
  if (
    ["job_lease_lost", "retryable_job_outcome"].includes(
      String(error?.code || ""),
    )
  ) {
    return String(error.code);
  }
  const fingerprint = sha256Bytes(
    Buffer.from(
      `${String(error?.name || "Error")}:${String(
        error?.message || "unknown_error",
      )}`,
      "utf8",
    ),
  );
  return `exact_plan_unexpected_error:${fingerprint}`;
}

function redactedExecutionError(error) {
  const blocker = safeBlocker(error);
  const redacted = new Error(blocker);
  redacted.name = "GovernedExactProductionPlanDrainExecutionError";
  redacted.code = blocker;
  return redacted;
}

function runnerReposProvider(repos, state, hooks = {}) {
  const jobs = repos.jobs;
  const gatedJobs = new Proxy(jobs, {
    get(target, property) {
      if (property === "claim") {
        return (workerId, options) => {
          if (state.next_index >= state.expected_jobs.length) return null;
          const expected =
            state.expected_jobs[state.next_index];
          const before = target.get(expected.job_id);
          if (!before || before.status !== "pending") {
            state.execution_error =
              "exact_plan_expected_job_not_pending_at_claim";
            return null;
          }
          const claimed = target.claimExact(
            expected.job_id,
            workerId,
            options,
          );
          if (!claimed) return null;
          if (Number(claimed.id) !== Number(expected.job_id)) {
            try {
              target.fail(
                claimed.id,
                workerId,
                claimed.claim_token,
                new Error("exact_plan_unexpected_job_claimed"),
              );
            } catch {
              // The ordinary lease-fenced failure path was attempted.
            }
            state.execution_error =
              "exact_plan_unexpected_job_claimed";
            return null;
          }
          state.claimed_order.push(Number(claimed.id));
          return claimed;
        };
      }
      if (property === "complete") {
        return (jobId, workerId, claimToken, options) => {
          const expected =
            state.expected_jobs[state.next_index];
          if (!expected || Number(jobId) !== Number(expected.job_id)) {
            throw new Error("exact_plan_completion_order_mismatch");
          }
          const completed = target.complete(
            jobId,
            workerId,
            claimToken,
            options,
          );
          state.completed_order.push(Number(jobId));
          state.next_index += 1;
          if (typeof hooks.afterDurableCompletion === "function") {
            const hookResult = hooks.afterDurableCompletion({
              role: expected.role,
              job_id: Number(jobId),
              job_run_id: Number(claimToken),
              completed,
            });
            if (
              hookResult &&
              typeof hookResult.then === "function"
            ) {
              throw new Error(
                "exact_plan_async_after_completion_hook_forbidden",
              );
            }
          }
          return completed;
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return () => ({ ...repos, jobs: gatedJobs });
}

function exactRelativeFilePath(value, code) {
  const supplied = String(value || "").trim();
  if (
    !supplied ||
    supplied.includes("\\") ||
    path.posix.isAbsolute(supplied) ||
    path.posix.normalize(supplied) !== supplied ||
    supplied === "." ||
    supplied === ".." ||
    supplied.startsWith("../")
  ) {
    fail(code);
  }
  return supplied;
}

function validateCompletionReference(value) {
  exactFields(
    value,
    new Set(["status", "path", "file_sha256", "receipt_sha256"]),
    "exact_plan_job_result_authority_attestation_invalid",
  );
  const status = String(value.status || "");
  if (!["CREATED", "REPLAYED"].includes(status)) {
    fail("exact_plan_job_result_authority_attestation_invalid");
  }
  return {
    status,
    path: exactRelativeFilePath(
      value.path,
      "exact_plan_job_result_authority_attestation_invalid",
    ),
    file_sha256: exactSha256(
      value.file_sha256,
      "exact_plan_job_result_authority_attestation_invalid",
    ),
    receipt_sha256: exactSha256(
      value.receipt_sha256,
      "exact_plan_job_result_authority_attestation_invalid",
    ),
  };
}

function validateCompletionIndex(value) {
  exactFields(
    value,
    new Set(["status", "audit_id", "idempotency_key"]),
    "exact_plan_job_result_authority_attestation_invalid",
  );
  if (
    !["INDEXED", "REPLAYED"].includes(String(value.status || "")) ||
    !Number.isInteger(Number(value.audit_id)) ||
    Number(value.audit_id) <= 0 ||
    !String(value.idempotency_key || "").trim()
  ) {
    fail("exact_plan_job_result_authority_attestation_invalid");
  }
  return {
    status: String(value.status),
    audit_id: Number(value.audit_id),
    idempotency_key: String(value.idempotency_key),
  };
}

function strictProductionSafety(value) {
  exactFields(
    value,
    PRODUCTION_SAFETY_FIELDS,
    "exact_plan_job_result_authority_attestation_invalid",
  );
  if (
    value.local_proof_only !== true ||
    typeof value.database_mutated !== "boolean" ||
    value.database_mutation_scope !==
      "IMMUTABLE_COMPLETION_RECEIPT_INDEX" ||
    typeof value.narration_network_used !== "boolean" ||
    value.oauth_or_tokens_mutated !== false ||
    value.platform_contacted !== false ||
    value.publish_authority !== false ||
    value.scheduler_authority !== false ||
    value.external_publish_authorised !== false
  ) {
    fail("exact_plan_job_result_authority_attestation_invalid");
  }
  return {
    local_proof_only: true,
    database_mutated: value.database_mutated,
    database_mutation_scope:
      "IMMUTABLE_COMPLETION_RECEIPT_INDEX",
    narration_network_used: value.narration_network_used,
    oauth_or_tokens_mutated: false,
    platform_contacted: false,
    publish_authority: false,
    scheduler_authority: false,
    external_publish_authorised: false,
  };
}

function buildJobAttestation({
  result,
  job,
  planned,
  selected,
  plan,
  attemptSha256,
}) {
  if (
    result?.no_publish !== true ||
    result?.no_external_posting !== true ||
    result?.no_oauth_or_token_change !== true ||
    result?.production?.mode !== MODE
  ) {
    fail("exact_plan_job_result_authority_attestation_invalid");
  }
  if (
    result?.status !== "autonomous_candidate_materialised" ||
    result?.production?.status !==
      "AUTONOMOUS_CANDIDATE_MATERIALISED" ||
    result?.production?.verdict !== "GREEN"
  ) {
    fail("exact_plan_job_not_green");
  }
  const safety = strictProductionSafety(
    result.production.safety,
  );
  const completionReceipt = validateCompletionReference(
    result.production.completion_receipt,
  );
  const completionIndex = validateCompletionIndex(
    result.production.completion_index,
  );
  const body = {
    schema_version: JOB_ATTESTATION_SCHEMA_VERSION,
    attempt_sha256: attemptSha256,
    plan_sha256: plan.plan_sha256,
    job_id: Number(job.id),
    job_run_id: Number(job.claim_token),
    role: planned.role,
    story_id: planned.story_id,
    channel_id: plan.channel_id,
    lane_id: plan.lane_id,
    platform: plan.platform,
    scheduled_for: plan.scheduled_for,
    builder_sha256: planned.builder_sha256,
    candidate_revision_sha256:
      selected.candidate_revision_sha256,
    request_fingerprint: selected.request_fingerprint,
    status: result.status,
    production_status: result.production.status,
    production_verdict: result.production.verdict,
    no_publish: true,
    no_external_posting: true,
    no_oauth_or_token_change: true,
    safety,
    completion_receipt: completionReceipt,
    completion_index: completionIndex,
  };
  const attestation = {
    ...body,
    attestation_sha256: canonicalSha256(body),
  };
  if (
    Buffer.byteLength(JSON.stringify(attestation), "utf8") > 3000
  ) {
    fail("exact_plan_job_attestation_too_large");
  }
  return attestation;
}

function validateJobAttestation(value, expected) {
  exactFields(
    value,
    new Set([
      "schema_version",
      "attempt_sha256",
      "plan_sha256",
      "job_id",
      "job_run_id",
      "role",
      "story_id",
      "channel_id",
      "lane_id",
      "platform",
      "scheduled_for",
      "builder_sha256",
      "candidate_revision_sha256",
      "request_fingerprint",
      "status",
      "production_status",
      "production_verdict",
      "no_publish",
      "no_external_posting",
      "no_oauth_or_token_change",
      "safety",
      "completion_receipt",
      "completion_index",
      "attestation_sha256",
    ]),
    "exact_plan_job_attestation_invalid",
  );
  const supplied = exactSha256(
    value.attestation_sha256,
    "exact_plan_job_attestation_invalid",
  );
  const body = { ...value };
  delete body.attestation_sha256;
  if (
    value.schema_version !== JOB_ATTESTATION_SCHEMA_VERSION ||
    canonicalSha256(body) !== supplied ||
    value.attempt_sha256 !== expected.attempt_sha256 ||
    value.plan_sha256 !== expected.plan.plan_sha256 ||
    Number(value.job_id) !== Number(expected.planned.job_id) ||
    Number(value.job_run_id) !== Number(expected.jobRunId) ||
    value.role !== expected.planned.role ||
    value.story_id !== expected.planned.story_id ||
    value.channel_id !== expected.plan.channel_id ||
    value.lane_id !== expected.plan.lane_id ||
    value.platform !== expected.plan.platform ||
    value.scheduled_for !== expected.plan.scheduled_for ||
    value.builder_sha256 !== expected.planned.builder_sha256 ||
    value.candidate_revision_sha256 !==
      expected.selected.candidate_revision_sha256 ||
    value.request_fingerprint !==
      expected.selected.request_fingerprint ||
    value.status !== "autonomous_candidate_materialised" ||
    value.production_status !==
      "AUTONOMOUS_CANDIDATE_MATERIALISED" ||
    value.production_verdict !== "GREEN" ||
    value.no_publish !== true ||
    value.no_external_posting !== true ||
    value.no_oauth_or_token_change !== true
  ) {
    fail("exact_plan_job_attestation_invalid");
  }
  strictProductionSafety(value.safety);
  validateCompletionReference(value.completion_receipt);
  validateCompletionIndex(value.completion_index);
  return value;
}

async function defaultCompletionReceiptInspector({
  attestation,
  root,
  db,
  fileSystem,
}) {
  const receiptPath = path.resolve(
    root.path,
    ...attestation.completion_receipt.path.split("/"),
  );
  const bytes = await exactFile(
    receiptPath,
    root,
    fileSystem,
    "exact_plan_completion_receipt_outside_workspace",
  );
  if (
    sha256Bytes(bytes) !==
    attestation.completion_receipt.file_sha256
  ) {
    fail("exact_plan_completion_receipt_file_sha256_mismatch");
  }
  let receipt;
  try {
    receipt =
      validateGovernedAutonomousCandidateCompletionReceipt(
        parseJsonBytes(
          bytes,
          "exact_plan_completion_receipt_json_invalid",
        ),
      );
  } catch (error) {
    if (error instanceof GovernedExactProductionPlanDrainError) {
      throw error;
    }
    fail("exact_plan_completion_receipt_invalid", error);
  }
  for (const field of [
    "story_id",
    "role",
    "channel_id",
    "lane_id",
    "platform",
    "scheduled_for",
    "candidate_revision_sha256",
    "request_fingerprint",
  ]) {
    if (receipt[field] !== attestation[field]) {
      fail("exact_plan_completion_receipt_binding_mismatch");
    }
  }
  if (
    receipt.receipt_sha256 !==
      attestation.completion_receipt.receipt_sha256
  ) {
    fail("exact_plan_completion_receipt_binding_mismatch");
  }
  let audit;
  try {
    audit = db
      .prepare(
        `SELECT id, idempotency_key, evidence_json
           FROM operator_audit_log
          WHERE id = ? AND idempotency_key = ?`,
      )
      .get(
        attestation.completion_index.audit_id,
        attestation.completion_index.idempotency_key,
      );
  } catch (error) {
    fail("exact_plan_completion_index_invalid", error);
  }
  if (!audit) fail("exact_plan_completion_index_invalid");
  let evidence;
  try {
    evidence = JSON.parse(audit.evidence_json);
  } catch (error) {
    fail("exact_plan_completion_index_invalid", error);
  }
  if (
    evidence?.story_id !== attestation.story_id ||
    evidence?.role !== attestation.role ||
    evidence?.channel_id !== attestation.channel_id ||
    evidence?.lane_id !== attestation.lane_id ||
    evidence?.platform !== attestation.platform ||
    evidence?.scheduled_for !== attestation.scheduled_for ||
    evidence?.candidate_revision_sha256 !==
      attestation.candidate_revision_sha256 ||
    evidence?.request_fingerprint !==
      attestation.request_fingerprint ||
    evidence?.receipt_ref?.path !==
      attestation.completion_receipt.path ||
    evidence?.receipt_ref?.file_sha256 !==
      attestation.completion_receipt.file_sha256 ||
    evidence?.receipt_ref?.receipt_sha256 !==
      attestation.completion_receipt.receipt_sha256
  ) {
    fail("exact_plan_completion_index_binding_mismatch");
  }
  return {
    valid: true,
    path: receiptPath,
    file_sha256: sha256Bytes(bytes),
    receipt_sha256: receipt.receipt_sha256,
    audit_id: Number(audit.id),
  };
}

function activeSetStillExact(db, expectedIds) {
  const active = readActiveBreakingJobs(db);
  return active.every((row) => expectedIds.includes(Number(row.id)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderMarkdown(report) {
  const lines = [
    "# Exact governed production-plan drain",
    "",
    `- Mode: ${report.mode}`,
    `- Verdict: ${report.verdict}`,
    `- Status: ${report.status}`,
    `- Plan SHA-256: ${report.plan.plan_sha256 || "unverified"}`,
    `- Checkout commit: ${report.workspace.commit || "unverified"}`,
    `- Runner count: ${report.execution.runner_count}`,
    `- Sequential order proven: ${report.execution.sequential_order_proven}`,
    `- Drained: ${report.execution.drained}`,
    "",
    "## Exact jobs",
    "",
  ];
  for (const job of report.execution.jobs) {
    lines.push(
      `- ${job.role}: job #${job.job_id} — ${job.final_status}`,
    );
  }
  lines.push("", "## Blockers", "");
  if (report.blockers.length) {
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  } else {
    lines.push("- None");
  }
  lines.push(
    "",
    "## Authority boundary",
    "",
    "- LOCAL_PROOF only.",
    "- No publication, OAuth or token authority.",
    "- No scheduler, watcher or credit-monitor process was started.",
    "- The only durable queue mutations were ordinary lease-fenced status transitions for the two exact production jobs and the ordinary worker heartbeat.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

async function readExactOptionalFile(filePath, fileSystem) {
  let stat;
  try {
    stat = await fileSystem.lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("exact_plan_drain_evidence_conflict");
  }
  const real = path.resolve(await fileSystem.realpath(filePath));
  if (!samePath(real, filePath)) {
    fail("exact_plan_drain_evidence_conflict");
  }
  return fileSystem.readFile(filePath);
}

async function writeCrashSafeNoClobber(
  filePath,
  bytes,
  fileSystem,
) {
  const digest = sha256Bytes(bytes);
  const temporaryPath = `${filePath}.${digest}.tmp`;
  try {
    const handle = await fileSystem.open(temporaryPath, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existingTemporary = await readExactOptionalFile(
      temporaryPath,
      fileSystem,
    );
    if (!existingTemporary?.equals(bytes)) {
      fail("exact_plan_drain_evidence_conflict");
    }
  }
  let status = "CREATED";
  try {
    await fileSystem.link(temporaryPath, filePath);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readExactOptionalFile(
      filePath,
      fileSystem,
    );
    if (!existing?.equals(bytes)) {
      fail("exact_plan_drain_evidence_conflict");
    }
    status = "REPLAYED";
  } finally {
    try {
      await fileSystem.unlink(temporaryPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return status;
}

function buildAttemptIdentity({
  request,
  plan,
  planFileSha256,
  profileFileSha256,
  database,
}) {
  return {
    schema_version:
      "pulse-governed-exact-production-plan-drain-attempt-v1",
    mode: MODE,
    plan_path: request.plan_path,
    plan_file_sha256: planFileSha256,
    plan_sha256: plan.plan_sha256,
    candidate_set_revision_sha256:
      planCandidateSetRevisionSha256(plan),
    scheduled_for: plan.scheduled_for,
    runtime_profile_path: request.runtime_profile_path,
    runtime_profile_file_sha256: profileFileSha256,
    workspace_root: request.workspace_root,
    database_path: database.path,
    database_real_path: database.real_path,
    expected_checkout_commit: request.expected_checkout_commit,
    output_dir: request.output_dir,
    worker_id: request.worker_id,
    production_jobs: plan.production_jobs.map((job, index) => ({
      job_id: Number(job.job_id),
      role: job.role,
      story_id: job.story_id,
      idempotency_key: job.idempotency_key,
      builder_sha256: job.builder_sha256,
      candidate_revision_sha256:
        plan.selected_candidates[index]
          .candidate_revision_sha256,
      request_fingerprint:
        plan.selected_candidates[index].request_fingerprint,
    })),
  };
}

function validateEvidenceReservation(value, expectedAttempt) {
  exactFields(
    value,
    new Set([
      "schema_version",
      "reserved_at",
      "attempt",
      "attempt_sha256",
      "reservation_sha256",
    ]),
    "exact_plan_drain_reservation_invalid",
  );
  const supplied = exactSha256(
    value.reservation_sha256,
    "exact_plan_drain_reservation_invalid",
  );
  const body = { ...value };
  delete body.reservation_sha256;
  const attemptSha256 = canonicalSha256(expectedAttempt);
  if (
    value.schema_version !==
      EVIDENCE_RESERVATION_SCHEMA_VERSION ||
    exactIso(
      value.reserved_at,
      "exact_plan_drain_reservation_invalid",
    ) !== value.reserved_at ||
    canonicalSha256(value.attempt) !== attemptSha256 ||
    value.attempt_sha256 !== attemptSha256 ||
    canonicalSha256(body) !== supplied
  ) {
    fail("exact_plan_drain_reservation_conflict");
  }
  return value;
}

async function reserveEvidenceNamespace({
  request,
  attempt,
  fileSystem,
}) {
  const reservationPath = path.join(
    request.output_dir,
    "exact-plan-drain-reservation.json",
  );
  const existing = await readExactOptionalFile(
    reservationPath,
    fileSystem,
  );
  if (existing) {
    return {
      path: reservationPath,
      status: "REPLAYED",
      reservation: validateEvidenceReservation(
        parseJsonBytes(
          existing,
          "exact_plan_drain_reservation_invalid",
        ),
        attempt,
      ),
      file_sha256: sha256Bytes(existing),
    };
  }
  const body = {
    schema_version: EVIDENCE_RESERVATION_SCHEMA_VERSION,
    reserved_at: request.generated_at,
    attempt,
    attempt_sha256: canonicalSha256(attempt),
  };
  const reservation = {
    ...body,
    reservation_sha256: canonicalSha256(body),
  };
  const bytes = Buffer.from(
    `${JSON.stringify(reservation, null, 2)}\n`,
    "utf8",
  );
  const status = await writeCrashSafeNoClobber(
    reservationPath,
    bytes,
    fileSystem,
  );
  const observed = await readExactOptionalFile(
    reservationPath,
    fileSystem,
  );
  if (!observed?.equals(bytes)) {
    fail("exact_plan_drain_reservation_conflict");
  }
  return {
    path: reservationPath,
    status,
    reservation,
    file_sha256: sha256Bytes(bytes),
  };
}

function validateFinalReport(
  value,
  attemptSha256,
  expectedGeneratedAt,
) {
  if (
    !plainObject(value) ||
    value.schema_version !== DRAIN_REPORT_SCHEMA_VERSION ||
    value.mode !== MODE ||
    value.verdict !== "GREEN" ||
    value.status !== "EXACT_PLAN_DRAIN_COMPLETED" ||
    value.attempt_sha256 !== attemptSha256 ||
    value.generated_at !== expectedGeneratedAt ||
    !exactSha256(
      value.report_sha256,
      "exact_plan_drain_evidence_conflict",
    )
  ) {
    fail("exact_plan_drain_evidence_conflict");
  }
  const body = { ...value };
  delete body.report_sha256;
  if (canonicalSha256(body) !== value.report_sha256) {
    fail("exact_plan_drain_evidence_conflict");
  }
  return value;
}

async function inspectFinalEvidence({
  outputDir,
  attemptSha256,
  expectedGeneratedAt,
  fileSystem,
}) {
  const jsonPath = path.join(outputDir, "exact-plan-drain.json");
  const markdownPath = path.join(outputDir, "exact-plan-drain.md");
  const jsonBytes = await readExactOptionalFile(jsonPath, fileSystem);
  const markdownBytes = await readExactOptionalFile(
    markdownPath,
    fileSystem,
  );
  if (!jsonBytes) {
    if (markdownBytes) fail("exact_plan_drain_evidence_conflict");
    return null;
  }
  const report = validateFinalReport(
    parseJsonBytes(
      jsonBytes,
      "exact_plan_drain_evidence_conflict",
    ),
    attemptSha256,
    expectedGeneratedAt,
  );
  const expectedMarkdown = Buffer.from(
    renderMarkdown(report),
    "utf8",
  );
  if (markdownBytes && !markdownBytes.equals(expectedMarkdown)) {
    fail("exact_plan_drain_evidence_conflict");
  }
  return {
    report,
    jsonPath,
    jsonBytes,
    markdownPath,
    markdownBytes,
    expectedMarkdown,
  };
}

async function writeEvidence(
  report,
  { root, outputDir, fileSystem },
) {
  await ensureOutputRoot(root, outputDir, fileSystem);
  const jsonPath = path.join(outputDir, "exact-plan-drain.json");
  const markdownPath = path.join(outputDir, "exact-plan-drain.md");
  const jsonBytes = Buffer.from(
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  const markdownBytes = Buffer.from(renderMarkdown(report), "utf8");
  const jsonStatus = await writeCrashSafeNoClobber(
    jsonPath,
    jsonBytes,
    fileSystem,
  );
  const markdownStatus = await writeCrashSafeNoClobber(
    markdownPath,
    markdownBytes,
    fileSystem,
  );
  return {
    json_path: jsonPath,
    json_file_sha256: sha256Bytes(jsonBytes),
    json_status: jsonStatus,
    markdown_path: markdownPath,
    markdown_file_sha256: sha256Bytes(markdownBytes),
    markdown_status: markdownStatus,
  };
}

async function finaliseReplayedEvidence(existing, fileSystem) {
  const markdownStatus = existing.markdownBytes
    ? "REPLAYED"
    : await writeCrashSafeNoClobber(
        existing.markdownPath,
        existing.expectedMarkdown,
        fileSystem,
      );
  return {
    json_path: existing.jsonPath,
    json_file_sha256: sha256Bytes(existing.jsonBytes),
    json_status: "REPLAYED",
    markdown_path: existing.markdownPath,
    markdown_file_sha256: sha256Bytes(
      existing.expectedMarkdown,
    ),
    markdown_status: markdownStatus,
  };
}

function readExactDoneRun(db, jobId) {
  const rows = db
    .prepare(
      `SELECT id, job_id, worker_id, attempt, status, started_at,
              finished_at, log_excerpt
         FROM job_runs
        WHERE job_id = ? AND status = 'done'
        ORDER BY id`,
    )
    .all(jobId);
  if (rows.length !== 1 || !rows[0].finished_at) {
    fail("exact_plan_job_run_attestation_missing");
  }
  return rows[0];
}

async function recoverDurablePrefix({
  db,
  plan,
  attemptSha256,
  root,
  fileSystem,
  completionReceiptInspector,
}) {
  const rows = readPlanJobs(db, plan);
  const statuses = rows.map((row) => row?.status || "missing");
  const recovered = [];
  let seenPending = false;
  for (let index = 0; index < rows.length; index += 1) {
    const status = statuses[index];
    if (status === "pending") {
      seenPending = true;
      continue;
    }
    if (status !== "done" || seenPending) {
      fail("exact_plan_database_job_status_invalid");
    }
    const run = readExactDoneRun(
      db,
      plan.production_jobs[index].job_id,
    );
    let parsed;
    try {
      parsed = JSON.parse(String(run.log_excerpt || ""));
    } catch (error) {
      fail("exact_plan_job_attestation_invalid", error);
    }
    const attestation = validateJobAttestation(parsed, {
      attempt_sha256: attemptSha256,
      plan,
      planned: plan.production_jobs[index],
      selected: plan.selected_candidates[index],
      jobRunId: run.id,
    });
    const receiptInspection = await completionReceiptInspector({
      attestation,
      root,
      db,
      fileSystem,
    });
    if (receiptInspection?.valid !== true) {
      fail("exact_plan_completion_receipt_invalid");
    }
    recovered.push({
      job_id: Number(plan.production_jobs[index].job_id),
      job_run_id: Number(run.id),
      role: plan.production_jobs[index].role,
      attestation,
      receipt: receiptInspection,
    });
  }
  if (
    recovered.length === 2 &&
    recovered[0].job_run_id >= recovered[1].job_run_id
  ) {
    fail("exact_plan_job_run_order_invalid");
  }
  return { rows, statuses, recovered };
}

async function stopRunnerUntilDrained({
  runner,
  execution,
  blockers,
  sleepImpl,
}) {
  if (!runner) return;
  for (;;) {
    execution.stop_attempts += 1;
    try {
      const result = await runner.stop();
      if (result?.drained === true) {
        execution.drained = true;
        return;
      }
      execution.drain_bound_exceeded = true;
      blockers.push("exact_plan_runner_drain_bound_exceeded");
    } catch (error) {
      execution.drain_bound_exceeded = true;
      blockers.push(safeBlocker(error));
    }
    await sleepImpl(10);
  }
}

function executionJobsFromRows(plan, rows) {
  return plan.production_jobs.map((job, index) => ({
    job_id: Number(job.job_id),
    role: job.role,
    final_status: rows[index]?.status || "missing",
    attempt_count: Number(rows[index]?.attempt_count || 0),
    idempotency_key: job.idempotency_key,
    builder_sha256: job.builder_sha256,
  }));
}

async function drainExactGovernedProductionPlan(value, dependencies = {}) {
  const request = normaliseRequest(value);
  const fileSystem = dependencies.fileSystem || defaultFileSystem;
  const root = await exactRoot(request.workspace_root, fileSystem);
  if (
    !pathWithin(root.path, request.plan_path) ||
    !pathWithin(root.path, request.runtime_profile_path)
  ) {
    fail("exact_plan_drain_inputs_outside_workspace");
  }
  await ensureOutputRoot(root, request.output_dir, fileSystem);

  const execution = {
    runner_count: 0,
    worker_id: request.worker_id,
    claimed_order: [],
    completed_order: [],
    sequential_order_proven: false,
    drained: true,
    work_window_exceeded: false,
    drain_bound_exceeded: false,
    stop_attempts: 0,
    recovered_done_prefix: 0,
    jobs: [],
  };
  const blockers = [];
  const quiescenceChecks = [];
  const activationReceiptChecks = [];
  let plan = null;
  let profile = null;
  let planFileSha256 = null;
  let profileFileSha256 = null;
  let attemptSha256 = null;
  let evidenceReservation = null;
  let existingFinalEvidence = null;
  let completedReplay = null;
  let reservationInspection = {
    path: null,
    file_sha256: null,
    reservation_set_sha256: null,
  };
  let lineageInspection = {
    schema_version: null,
    candidate_set_revision_sha256: null,
    predecessor_count: 0,
    predecessors: [],
  };
  let workspaceInspection = {
    available: false,
    commit: null,
    tracked_clean: false,
  };
  let databaseInspection = {
    path: request.database_path,
    real_path: null,
    profile_path_match: false,
    opened_path_match: false,
    opened_real_path: null,
  };
  let runner = null;
  let state = null;
  let restoreProcessEnvironment = null;
  let processEnvironmentForced = false;
  const sleepImpl = dependencies.sleep || sleep;
  const completionReceiptInspector =
    dependencies.completionReceiptInspector ||
    defaultCompletionReceiptInspector;

  try {
    const planBytes = await exactFile(
      request.plan_path,
      root,
      fileSystem,
      "exact_plan_drain_plan_outside_workspace",
    );
    planFileSha256 = sha256Bytes(planBytes);
    if (planFileSha256 !== request.expected_plan_file_sha256) {
      fail("exact_plan_file_sha256_mismatch");
    }
    plan = validatePlan(
      parseJsonBytes(planBytes, "exact_plan_json_invalid"),
      request.expected_plan_sha256,
    );
    const lineageBinding = await validatePlanLineageBinding({
      plan,
      planPath: request.plan_path,
      root,
      fileSystem,
    });
    lineageInspection = lineageBinding.inspection;
    reservationInspection = await validateReservationBinding({
      plan,
      root,
      fileSystem,
    });

    const profileBytes = await exactFile(
      request.runtime_profile_path,
      root,
      fileSystem,
      "exact_plan_drain_runtime_profile_outside_workspace",
    );
    profileFileSha256 = sha256Bytes(profileBytes);
    if (
      profileFileSha256 !==
      request.expected_runtime_profile_file_sha256
    ) {
      fail("exact_plan_runtime_profile_file_sha256_mismatch");
    }
    profile = parseJsonBytes(
      profileBytes,
      "exact_plan_runtime_profile_json_invalid",
    );
    const profileValidation = (
      dependencies.runtimeProfileValidator ||
      validateLiveGuardedRuntimeProfile
    )(profile);
    if (
      profileValidation?.valid !== true ||
      (Array.isArray(profileValidation?.blockers) &&
        profileValidation.blockers.length)
    ) {
      fail("exact_plan_runtime_profile_invalid");
    }
    if (!samePath(profile.database_path, request.database_path)) {
      fail("exact_plan_runtime_profile_database_mismatch");
    }
    const activationReceiptPath = normalEmbeddedPath(
      profile.activation_receipt_path,
      "exact_plan_activation_receipt_path_invalid",
    );
    databaseInspection.profile_path_match = true;

    workspaceInspection = (
      dependencies.workspaceInspector || inspectWorkspace
    )({ workspaceRoot: root.path });
    if (
      workspaceInspection?.available !== true ||
      workspaceInspection.commit !== request.expected_checkout_commit ||
      workspaceInspection.tracked_clean !== true
    ) {
      fail("exact_plan_workspace_checkout_mismatch");
    }

    const db = dependencies.db;
    const repos = dependencies.repos;
    if (
      !db ||
      typeof db.prepare !== "function" ||
      !repos?.jobs ||
      typeof repos.jobs.claimExact !== "function" ||
      !repos?.workers ||
      repos.db !== db
    ) {
      fail("exact_plan_drain_database_dependencies_required");
    }
    const requestedDatabase = await exactDatabaseFile(
      request.database_path,
      fileSystem,
    );
    databaseInspection.real_path = requestedDatabase.real_path;
    const databaseList = db.prepare("PRAGMA database_list").all();
    const mainDatabase = databaseList.find((row) => row.name === "main");
    if (!mainDatabase?.file) {
      fail("exact_plan_open_database_path_mismatch");
    }
    const openedDatabasePath = normalEmbeddedPath(
      mainDatabase.file,
      "exact_plan_open_database_path_mismatch",
    );
    const openedDatabase = await exactDatabaseFile(
      openedDatabasePath,
      fileSystem,
    );
    if (
      !samePath(openedDatabase.path, requestedDatabase.path) ||
      !samePath(
        openedDatabase.real_path,
        requestedDatabase.real_path,
      )
    ) {
      fail("exact_plan_open_database_path_mismatch");
    }
    databaseInspection.opened_path_match = true;
    databaseInspection.opened_real_path =
      openedDatabase.real_path;

    validatePredecessorQueueBindings({
      db,
      predecessorPlans: lineageBinding.predecessor_plans,
      workspaceRoot: root.path,
    });
    validateQueueBindings({ db, plan, workspaceRoot: root.path });

    const inspectQuiescence =
      dependencies.quiescenceInspector ||
      ((options) => inspectWindowsPulseQuiescence(options));
    const inspectNow = async () => {
      const observed = assertQuiescent(
        await inspectQuiescence({
          profile,
          workspaceRoot: root.path,
        }),
      );
      const activation = await inspectAbsentNoLinkPath(
        activationReceiptPath,
        fileSystem,
      );
      quiescenceChecks.push({
        sequence: quiescenceChecks.length + 1,
        ...observed,
      });
      activationReceiptChecks.push({
        sequence: activationReceiptChecks.length + 1,
        path: activation.path,
        absent: true,
        parent_real_path: activation.parent_real_path,
      });
      return observed;
    };
    await inspectNow();
    validateQueueBindings({ db, plan, workspaceRoot: root.path });
    await inspectNow();

    const attempt = buildAttemptIdentity({
      request,
      plan,
      planFileSha256,
      profileFileSha256,
      database: requestedDatabase,
    });
    attemptSha256 = canonicalSha256(attempt);
    evidenceReservation = await reserveEvidenceNamespace({
      request,
      attempt,
      fileSystem,
    });
    if (
      evidenceReservation.reservation.attempt_sha256 !==
      attemptSha256
    ) {
      fail("exact_plan_drain_reservation_conflict");
    }
    existingFinalEvidence = await inspectFinalEvidence({
      outputDir: request.output_dir,
      attemptSha256,
      expectedGeneratedAt:
        evidenceReservation.reservation.reserved_at,
      fileSystem,
    });

    const recoveredBeforeRun = await recoverDurablePrefix({
      db,
      plan,
      attemptSha256,
      root,
      fileSystem,
      completionReceiptInspector,
    });
    execution.recovered_done_prefix =
      recoveredBeforeRun.recovered.length;
    execution.claimed_order.push(
      ...recoveredBeforeRun.recovered.map(
        (entry) => entry.job_id,
      ),
    );
    execution.completed_order.push(
      ...recoveredBeforeRun.recovered.map(
        (entry) => entry.job_id,
      ),
    );
    execution.jobs = executionJobsFromRows(
      plan,
      recoveredBeforeRun.rows,
    );

    const expectedJobs = plan.production_jobs.map((job) => ({
      job_id: Number(job.job_id),
      role: job.role,
    }));
    if (
      existingFinalEvidence &&
      recoveredBeforeRun.recovered.length !== 2
    ) {
      fail("exact_plan_drain_evidence_conflict");
    }
    if (
      !existingFinalEvidence &&
      recoveredBeforeRun.recovered.length < expectedJobs.length
    ) {
      state = {
        expected_jobs: expectedJobs,
        next_index: recoveredBeforeRun.recovered.length,
        claimed_order: execution.claimed_order,
        completed_order: execution.completed_order,
        execution_error: null,
        handler_results: recoveredBeforeRun.recovered.map(
          (entry) => entry.attestation,
        ),
      };
      const reposProvider = runnerReposProvider(repos, state, {
        afterDurableCompletion:
          dependencies.afterDurableCompletion,
      });
      const localEnvironment = buildLocalProofEnvironment(
        dependencies.baseEnvironment ||
          dependencies.processEnvironment ||
          process.env,
        profile,
        request,
      );
      restoreProcessEnvironment =
        applyLocalProofProcessEnvironment(
          dependencies.processEnvironment || process.env,
          localEnvironment,
        );
      processEnvironmentForced = true;
      const productionHandler =
        dependencies.productionHandler ||
        require("../job-handlers").handlers
          .produce_breaking_short;
      const guardedProductionHandler = async (job, ctx) => {
        const index = state.next_index;
        const expected = expectedJobs[index];
        if (!expected || Number(job.id) !== expected.job_id) {
          fail("exact_plan_handler_order_mismatch");
        }
        await inspectNow();
        let result;
        try {
          result = await productionHandler(job, {
            ...ctx,
            env: localEnvironment,
            autonomousProductionWorkspaceRoot: root.path,
            workspaceRoot: root.path,
          });
        } catch (error) {
          throw redactedExecutionError(error);
        }
        await inspectNow();
        const attestation = buildJobAttestation({
          result,
          job,
          planned: plan.production_jobs[index],
          selected: plan.selected_candidates[index],
          plan,
          attemptSha256,
        });
        const receiptInspection =
          await completionReceiptInspector({
            attestation,
            root,
            db,
            fileSystem,
          });
        if (receiptInspection?.valid !== true) {
          fail("exact_plan_completion_receipt_invalid");
        }
        state.handler_results.push(attestation);
        return attestation;
      };
      runner = new (dependencies.JobsRunnerClass || JobsRunner)({
        workerId: request.worker_id,
        handlers: {
          produce_breaking_short: guardedProductionHandler,
        },
        kinds: ["produce_breaking_short"],
        gpu: false,
        pollIntervalMs: request.poll_interval_ms,
        heartbeatMs: Math.min(
          30000,
          Math.max(10, request.timeout_ms),
        ),
        leaseMs: Math.min(
          30 * 60 * 1000,
          Math.max(5000, request.timeout_ms + 5000),
        ),
        drainTimeoutMs: Math.min(
          30000,
          Math.max(1000, request.timeout_ms),
        ),
        reposProvider,
        log: dependencies.log || (() => {}),
        onError: async (error) => {
          state.execution_error = safeBlocker(error);
        },
      });
      execution.runner_count = 1;
      execution.drained = false;
      const deadline = Date.now() + request.timeout_ms;
      let lastQuiescenceCheck = Date.now();
      await runner.start();
      while (
        state.next_index < expectedJobs.length &&
        !state.execution_error &&
        Date.now() < deadline
      ) {
        await sleepImpl(request.poll_interval_ms);
        if (
          Date.now() - lastQuiescenceCheck >=
          Math.max(5000, request.poll_interval_ms)
        ) {
          await inspectNow();
          lastQuiescenceCheck = Date.now();
        }
        if (
          !activeSetStillExact(
            db,
            expectedJobs.map((job) => job.job_id),
          )
        ) {
          state.execution_error =
            "exact_plan_active_breaking_job_set_changed";
        }
      }
      if (
        state.next_index < expectedJobs.length &&
        !state.execution_error &&
        Date.now() >= deadline
      ) {
        execution.work_window_exceeded = true;
        blockers.push("exact_plan_drain_timeout");
      }
      if (state.execution_error) {
        blockers.push(state.execution_error);
      }
      await stopRunnerUntilDrained({
        runner,
        execution,
        blockers,
        sleepImpl,
      });
      runner = null;
      restoreProcessEnvironment?.();
      restoreProcessEnvironment = null;
      await inspectNow();
    }

    const recoveredAfterRun = await recoverDurablePrefix({
      db,
      plan,
      attemptSha256,
      root,
      fileSystem,
      completionReceiptInspector,
    });
    execution.jobs = executionJobsFromRows(
      plan,
      recoveredAfterRun.rows,
    );
    execution.sequential_order_proven =
      recoveredAfterRun.recovered.length === 2 &&
      execution.claimed_order.length === 2 &&
      execution.completed_order.length === 2 &&
      execution.claimed_order.every(
        (id, index) => id === expectedJobs[index].job_id,
      ) &&
      execution.completed_order.every(
        (id, index) => id === expectedJobs[index].job_id,
      ) &&
      execution.jobs.every((job) => job.final_status === "done");
    if (
      blockers.length === 0 &&
      !execution.sequential_order_proven
    ) {
      blockers.push("exact_plan_sequential_completion_not_proven");
    }
    if (existingFinalEvidence && blockers.length === 0) {
      completedReplay = existingFinalEvidence;
    } else if (
      !existingFinalEvidence &&
      blockers.length === 0 &&
      typeof dependencies.beforeEvidenceFinalise === "function"
    ) {
      await dependencies.beforeEvidenceFinalise({
        attempt_sha256: attemptSha256,
        execution,
      });
    }
  } catch (error) {
    blockers.push(safeBlocker(error));
    if (runner) {
      await stopRunnerUntilDrained({
        runner,
        execution,
        blockers,
        sleepImpl,
      });
      runner = null;
    }
    restoreProcessEnvironment?.();
    restoreProcessEnvironment = null;
    if (plan && dependencies.db?.prepare) {
      const finalRows = readPlanJobs(dependencies.db, plan);
      execution.jobs = executionJobsFromRows(plan, finalRows);
    }
  }

  const uniqueBlockers = [...new Set(blockers)];
  if (completedReplay && uniqueBlockers.length === 0) {
    const evidence = await finaliseReplayedEvidence(
      completedReplay,
      fileSystem,
    );
    return Object.freeze({
      ...completedReplay.report,
      evidence,
    });
  }
  const reportBody = {
    schema_version: DRAIN_REPORT_SCHEMA_VERSION,
    mode: MODE,
    generated_at:
      evidenceReservation?.reservation?.reserved_at ||
      request.generated_at,
    attempt_sha256: attemptSha256,
    verdict: uniqueBlockers.length ? "HOLD" : "GREEN",
    status: uniqueBlockers.length
      ? "EXACT_PLAN_DRAIN_HELD"
      : "EXACT_PLAN_DRAIN_COMPLETED",
    blockers: uniqueBlockers,
    plan: {
      path: request.plan_path,
      file_sha256: planFileSha256,
      expected_file_sha256: request.expected_plan_file_sha256,
      plan_sha256: plan?.plan_sha256 || null,
      expected_plan_sha256: request.expected_plan_sha256,
      scheduled_for: plan?.scheduled_for || null,
      reservation: reservationInspection,
      lineage: lineageInspection,
    },
    runtime_profile: {
      path: request.runtime_profile_path,
      file_sha256: profileFileSha256,
      expected_file_sha256:
        request.expected_runtime_profile_file_sha256,
      profile_id: profile?.profile_id || null,
    },
    workspace: {
      root: request.workspace_root,
      expected_commit: request.expected_checkout_commit,
      commit: workspaceInspection?.commit || null,
      tracked_clean: workspaceInspection?.tracked_clean === true,
    },
    database: databaseInspection,
    queue_preflight: {
      exact_active_job_count_required: 2,
      exact_active_job_ids:
        plan?.production_jobs?.map((job) => Number(job.job_id)) || [],
      other_active_breaking_jobs_allowed: false,
    },
    runtime_quiescence: {
      required: true,
      checks: quiescenceChecks,
    },
    activation_receipt: {
      required_absent: true,
      path: profile?.activation_receipt_path || null,
      checks: activationReceiptChecks,
    },
    execution,
    safety: {
      local_proof_only: true,
      publication_handler_registered: false,
      publish_authority: false,
      platform_contact_authority: false,
      oauth_or_token_authority: false,
      oauth_or_tokens_mutated: false,
      scheduler_started: false,
      watcher_started: false,
      credit_monitor_started: false,
      publisher_started: false,
      process_authority_environment_forced_local_proof:
        processEnvironmentForced,
      exact_jobs_runner_only: true,
    },
  };
  const report = Object.freeze({
    ...reportBody,
    report_sha256: canonicalSha256(reportBody),
  });
  if (uniqueBlockers.length) {
    return Object.freeze({
      ...report,
      evidence: {
        reservation_path: evidenceReservation?.path || null,
        reservation_file_sha256:
          evidenceReservation?.file_sha256 || null,
        reservation_status:
          evidenceReservation?.status || null,
        final_json_path: null,
        final_markdown_path: null,
      },
    });
  }
  const evidence = await writeEvidence(report, {
    root,
    outputDir: request.output_dir,
    fileSystem,
  });
  return Object.freeze({ ...report, evidence });
}

module.exports = {
  DRAIN_REPORT_SCHEMA_VERSION,
  DRAIN_REQUEST_SCHEMA_VERSION,
  GovernedExactProductionPlanDrainError,
  drainExactGovernedProductionPlan,
  inspectWindowsPulseQuiescence,
  normaliseRequest,
  renderMarkdown,
};

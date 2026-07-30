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
  validateLiveGuardedRuntimeProfile,
} = require(
  "../stabilisation/windows-live-guarded-runtime"
);

const DRAIN_REQUEST_SCHEMA_VERSION =
  "pulse-governed-exact-production-plan-drain-request-v1";
const DRAIN_REPORT_SCHEMA_VERSION =
  "pulse-governed-exact-production-plan-drain-report-v1";
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
  if (link) {
    const relativeCurrent = path
      .relative(root.path, planPath)
      .split(path.sep);
    const revisionIndex =
      relativeCurrent.length - 3;
    if (
      revisionIndex < 0 ||
      relativeCurrent[revisionIndex] !== "revisions" ||
      relativeCurrent[revisionIndex + 1] !==
        currentCandidateSetSha256 ||
      relativeCurrent[relativeCurrent.length - 1] !==
        path.basename(planPath)
    ) {
      fail("exact_plan_lineage_successor_path_mismatch");
    }
  }
  const seenPlanHashes = new Set([plan.plan_sha256]);
  const predecessors = [];
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
    link =
      predecessor.schema_version === PLAN_SCHEMA_VERSION_V2
        ? validatePlanLineage(predecessor.lineage)
        : null;
  }
  return {
    schema_version: plan.schema_version,
    candidate_set_revision_sha256:
      currentCandidateSetSha256,
    predecessor_count: predecessors.length,
    predecessors,
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
    fail(
      `exact_plan_reservation_invalid:${String(
        error?.code || "validation_failed",
      )}`,
      error,
    );
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

function validateQueueBindings({ db, plan, workspaceRoot, requirePending }) {
  const rows = readPlanJobs(db, plan);
  const active = readActiveBreakingJobs(db);
  const expectedIds = plan.production_jobs.map((job) => job.job_id);
  if (
    active.length !== 2 ||
    active.some((row, index) => row.id !== expectedIds[index])
  ) {
    fail("exact_plan_active_breaking_job_set_mismatch");
  }
  for (let index = 0; index < 2; index += 1) {
    const planned = plan.production_jobs[index];
    const selected = plan.selected_candidates[index];
    const row = rows[index];
    if (!row) fail("exact_plan_database_job_missing");
    if (
      row.kind !== planned.kind ||
      row.channel_id !== "pulse-gaming" ||
      row.story_id !== planned.database_story_id ||
      row.idempotency_key !== planned.idempotency_key ||
      Number(row.priority) !== (index === 0 ? 10 : 11) ||
      Number(row.max_attempts) !== 3 ||
      Number(row.requires_gpu) !== 0 ||
      Number(row.attempt_count) >= Number(row.max_attempts) ||
      (requirePending && row.status !== "pending") ||
      parseSqliteTimestamp(row.run_at) === null ||
      parseSqliteTimestamp(row.run_at) > Date.now()
    ) {
      fail("exact_plan_database_job_binding_mismatch");
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
      fail("exact_plan_database_payload_binding_mismatch");
    }
    let builder;
    try {
      builder = validateGovernedAutonomousProductionRequestBuild(
        payload.autonomous_production_job.builder_result,
      );
    } catch (error) {
      fail(
        `exact_plan_builder_invalid:${String(
          error?.code || "validation_failed",
        )}`,
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
      fail("exact_plan_builder_binding_mismatch");
    }
  }
  return { rows, active };
}

function normaliseQuiescence(value) {
  const fields = [
    "owner_pids",
    "listener_pids",
    "scheduler_process_pids",
    "enabled_tasks",
    "running_tasks",
  ];
  const report = {
    available: value?.available === true,
  };
  for (const field of fields) {
    report[field] = Array.isArray(value?.[field])
      ? [...value[field]]
      : [];
  }
  return report;
}

function assertQuiescent(value) {
  const report = normaliseQuiescence(value);
  if (!report.available) {
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

function powershellJson(source, execFileSyncImpl = execFileSync) {
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
  if (!output) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
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
      owner_pids: [],
      listener_pids: [],
      scheduler_process_pids: [],
      enabled_tasks: [],
      running_tasks: [],
    };
  }
  try {
    const port = Number(profile?.port);
    if (!Number.isInteger(port) || port !== 3001) {
      fail("exact_plan_runtime_profile_port_invalid");
    }
    const listenerRows = powershellJson(
      `$items = @(Get-NetTCPConnection -LocalPort ${port} ` +
        "-State Listen -ErrorAction SilentlyContinue | " +
        "Select-Object -ExpandProperty OwningProcess -Unique); " +
        "@($items) | ConvertTo-Json -Compress",
      execFileSyncImpl,
    );
    const processRows = powershellJson(
      "$items = @(Get-CimInstance Win32_Process -ErrorAction Stop | " +
        "Where-Object { $_.Name -ieq 'node.exe' } | " +
        "Select-Object @{n='pid';e={[int]$_.ProcessId}}," +
        "@{n='command_line';e={[string]$_.CommandLine}}); " +
        "@($items) | ConvertTo-Json -Compress",
      execFileSyncImpl,
    );
    const taskNames = [
      profile.task_name,
      ...(Array.isArray(profile.conflicting_task_names)
        ? profile.conflicting_task_names
        : []),
    ];
    const taskFilter = taskNames
      .map((name) => `$_.TaskName -eq ${psLiteral(name)}`)
      .join(" -or ");
    const taskRows = taskFilter
      ? powershellJson(
          "$items = @(Get-ScheduledTask -ErrorAction SilentlyContinue | " +
            `Where-Object { ${taskFilter} } | ` +
            "Select-Object TaskName,State," +
            "@{n='Enabled';e={[bool]$_.Settings.Enabled}}); " +
            "@($items) | ConvertTo-Json -Compress",
          execFileSyncImpl,
        )
      : [];
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
          (row) =>
            String(row.State || "").toLowerCase() === "running",
        )
        .map((row) => String(row.TaskName))
        .sort(),
    };
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
  if (!pathWithin(root.real_path, real)) fail(outsideCode);
  return fileSystem.readFile(filePath);
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
    if (!pathWithin(root.real_path, real)) {
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
  const raw = String(error?.code || error?.message || "unknown_error");
  return raw
    .replace(/[^a-zA-Z0-9_:.-]/g, "_")
    .slice(0, 240);
}

function runnerReposProvider(repos, state) {
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
          return completed;
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return () => ({ ...repos, jobs: gatedJobs });
}

function validateJobResult(result) {
  if (
    result?.no_publish !== true ||
    result?.no_external_posting !== true
  ) {
    fail("exact_plan_job_result_authority_attestation_invalid");
  }
  if (
    result?.status !== "autonomous_candidate_materialised" ||
    result?.production?.status !==
      "AUTONOMOUS_CANDIDATE_MATERIALISED" ||
    result?.production?.verdict !== "GREEN"
  ) {
    const firstBlocker = Array.isArray(result?.blockers)
      ? result.blockers[0]
      : Array.isArray(result?.production?.blockers)
        ? result.production.blockers[0]
        : "not_green";
    fail(
      `exact_plan_job_not_green:${String(firstBlocker || "not_green")}`,
    );
  }
  return result;
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

async function writeIdempotently(filePath, bytes, fileSystem) {
  try {
    const handle = await fileSystem.open(filePath, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return "CREATED";
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await fileSystem.readFile(filePath);
    if (!existing.equals(bytes)) {
      fail("exact_plan_drain_evidence_conflict");
    }
    return "REPLAYED";
  }
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
  const jsonStatus = await writeIdempotently(
    jsonPath,
    jsonBytes,
    fileSystem,
  );
  const markdownStatus = await writeIdempotently(
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
    jobs: [],
  };
  const blockers = [];
  const quiescenceChecks = [];
  let plan = null;
  let profile = null;
  let planFileSha256 = null;
  let profileFileSha256 = null;
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
    profile_path_match: false,
    opened_path_match: false,
  };
  let runner = null;
  let stopResult = { drained: true };
  let state = null;
  let restoreProcessEnvironment = null;
  let processEnvironmentForced = false;

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
    lineageInspection = await validatePlanLineageBinding({
      plan,
      planPath: request.plan_path,
      root,
      fileSystem,
    });
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
      fail(
        `exact_plan_runtime_profile_invalid:${
          profileValidation?.blockers?.[0] || "validation_failed"
        }`,
      );
    }
    if (!samePath(profile.database_path, request.database_path)) {
      fail("exact_plan_runtime_profile_database_mismatch");
    }
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
    const databaseList = db.prepare("PRAGMA database_list").all();
    const mainDatabase = databaseList.find((row) => row.name === "main");
    if (
      !mainDatabase?.file ||
      !samePath(mainDatabase.file, request.database_path)
    ) {
      fail("exact_plan_open_database_path_mismatch");
    }
    databaseInspection.opened_path_match = true;

    validateQueueBindings({
      db,
      plan,
      workspaceRoot: root.path,
      requirePending: true,
    });

    const inspectQuiescence =
      dependencies.quiescenceInspector ||
      ((options) => inspectWindowsPulseQuiescence(options));
    const inspectNow = () => {
      const observed = assertQuiescent(
        inspectQuiescence({
          profile,
          workspaceRoot: root.path,
        }),
      );
      quiescenceChecks.push({
        checked_at: new Date().toISOString(),
        ...observed,
      });
      return observed;
    };
    inspectNow();
    validateQueueBindings({
      db,
      plan,
      workspaceRoot: root.path,
      requirePending: true,
    });
    inspectNow();

    const expectedJobs = plan.production_jobs.map((job) => ({
      job_id: Number(job.job_id),
      role: job.role,
    }));
    state = {
      expected_jobs: expectedJobs,
      next_index: 0,
      claimed_order: execution.claimed_order,
      completed_order: execution.completed_order,
      execution_error: null,
      handler_results: [],
    };
    const reposProvider = runnerReposProvider(repos, state);
    const localEnvironment = buildLocalProofEnvironment(
      dependencies.baseEnvironment ||
        dependencies.processEnvironment ||
        process.env,
      profile,
      request,
    );
    restoreProcessEnvironment = applyLocalProofProcessEnvironment(
      dependencies.processEnvironment || process.env,
      localEnvironment,
    );
    processEnvironmentForced = true;
    const productionHandler =
      dependencies.productionHandler ||
      require("../job-handlers").handlers.produce_breaking_short;
    const guardedProductionHandler = async (job, ctx) => {
      const expected = expectedJobs[state.next_index];
      if (!expected || Number(job.id) !== expected.job_id) {
        fail("exact_plan_handler_order_mismatch");
      }
      inspectNow();
      const result = validateJobResult(
        await productionHandler(job, {
          ...ctx,
          env: localEnvironment,
          autonomousProductionWorkspaceRoot: root.path,
          workspaceRoot: root.path,
        }),
      );
      inspectNow();
      state.handler_results.push({
        job_id: Number(job.id),
        role: expected.role,
        status: result.status,
        production_status: result.production.status,
        production_verdict: result.production.verdict,
      });
      return result;
    };
    runner = new (dependencies.JobsRunnerClass || JobsRunner)({
      workerId: request.worker_id,
      handlers: {
        produce_breaking_short: guardedProductionHandler,
      },
      kinds: ["produce_breaking_short"],
      gpu: false,
      pollIntervalMs: request.poll_interval_ms,
      heartbeatMs: Math.min(30000, Math.max(10, request.timeout_ms)),
      leaseMs: Math.min(
        30 * 60 * 1000,
        Math.max(5000, request.timeout_ms + 5000),
      ),
      drainTimeoutMs: Math.min(30000, Math.max(1000, request.timeout_ms)),
      reposProvider,
      log: dependencies.log || (() => {}),
      onError: async (error) => {
        state.execution_error = safeBlocker(error);
      },
    });
    execution.runner_count = 1;
    const deadline = Date.now() + request.timeout_ms;
    let lastQuiescenceCheck = Date.now();
    await runner.start();
    while (
      state.next_index < expectedJobs.length &&
      !state.execution_error &&
      Date.now() < deadline
    ) {
      await (dependencies.sleep || sleep)(request.poll_interval_ms);
      if (
        Date.now() - lastQuiescenceCheck >=
        Math.max(5000, request.poll_interval_ms)
      ) {
        inspectNow();
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
      blockers.push("exact_plan_drain_timeout");
    }
    if (state.execution_error) blockers.push(state.execution_error);
    stopResult = await runner.stop();
    runner = null;
    restoreProcessEnvironment?.();
    restoreProcessEnvironment = null;
    execution.drained = stopResult.drained === true;
    if (!execution.drained) {
      blockers.push("exact_plan_runner_drain_timeout");
    }
    inspectNow();
    const finalRows = readPlanJobs(db, plan);
    execution.jobs = expectedJobs.map((expected, index) => ({
      job_id: expected.job_id,
      role: expected.role,
      final_status: finalRows[index]?.status || "missing",
      attempt_count: Number(finalRows[index]?.attempt_count || 0),
      idempotency_key:
        plan.production_jobs[index].idempotency_key,
      builder_sha256:
        plan.production_jobs[index].builder_sha256,
    }));
    execution.sequential_order_proven =
      state.claimed_order.length === 2 &&
      state.completed_order.length === 2 &&
      state.claimed_order.every(
        (id, index) => id === expectedJobs[index].job_id,
      ) &&
      state.completed_order.every(
        (id, index) => id === expectedJobs[index].job_id,
      ) &&
      execution.jobs.every((job) => job.final_status === "done");
    if (
      blockers.length === 0 &&
      !execution.sequential_order_proven
    ) {
      blockers.push("exact_plan_sequential_completion_not_proven");
    }
  } catch (error) {
    blockers.push(safeBlocker(error));
    if (runner) {
      try {
        stopResult = await runner.stop();
        execution.drained = stopResult.drained === true;
      } catch (stopError) {
        execution.drained = false;
        blockers.push(safeBlocker(stopError));
      }
      runner = null;
    }
    restoreProcessEnvironment?.();
    restoreProcessEnvironment = null;
    if (plan && dependencies.db?.prepare) {
      const finalRows = readPlanJobs(dependencies.db, plan);
      execution.jobs = plan.production_jobs.map((job, index) => ({
        job_id: Number(job.job_id),
        role: job.role,
        final_status: finalRows[index]?.status || "missing",
        attempt_count: Number(finalRows[index]?.attempt_count || 0),
        idempotency_key: job.idempotency_key,
        builder_sha256: job.builder_sha256,
      }));
    }
  }

  const uniqueBlockers = [...new Set(blockers)];
  const reportBody = {
    schema_version: DRAIN_REPORT_SCHEMA_VERSION,
    mode: MODE,
    generated_at: request.generated_at,
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

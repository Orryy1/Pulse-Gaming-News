"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const {
  ARTIFACT_SCHEMA_VERSION:
    RESERVATION_ARTIFACT_SCHEMA_VERSION,
  REQUEST_SCHEMA_VERSION: RESERVATION_REQUEST_SCHEMA_VERSION,
  materialiseGovernedAutonomousWindowReservationSet,
  validateGovernedAutonomousWindowReservationSet,
} = require("./governed-autonomous-window-reservation-set");
const {
  BUILDER_SCHEMA_VERSION,
  buildGovernedAutonomousProductionRequest,
  canonicalSha256,
  validateGovernedAutonomousProductionRequestBuild,
} = require("./governed-autonomous-production-request-builder");
const {
  validateGovernedAutonomousDatabaseStoryBinding,
} = require("./governed-autonomous-database-story-binding");
const {
  validateGovernedAutonomousCompiledCandidateBinding,
} = require("./governed-autonomous-compiled-candidate-binding");

const REQUEST_SCHEMA_VERSION =
  "pulse-governed-autonomous-window-production-planner-request-v1";
const CANDIDATE_SCHEMA_VERSION =
  "pulse-governed-autonomous-window-production-candidate-v1";
const RESULT_SCHEMA_VERSION =
  "pulse-governed-autonomous-window-production-plan-v1";
const MODE = "LOCAL_PROOF";
const CHANNEL_ID = "pulse-gaming";
const LANE_ID = "breaking_short";
const PLATFORM = "youtube";
const AUTONOMOUS_JOB_PAYLOAD_SCHEMA_VERSION =
  "pulse-governed-autonomous-production-job-payload-v1";
const T90_OFFSET_MS = 90 * 60 * 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STORY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_FIELDS = new Set([
  "schema_version",
  "mode",
  "generated_at",
  "scheduled_for",
  "workspace_root",
  "reservation_output_path",
  "plan_output_path",
  "candidates",
]);
const CANDIDATE_FIELDS = new Set([
  "schema_version",
  "mode",
  "story_id",
  "channel_id",
  "lane_id",
  "platform",
  "scheduled_for",
  "source_type",
  "verification_status",
  "eligibility_verdict",
  "source_evidence_sha256",
  "source_published_at",
  "verified_at",
  "selection_score",
  "locked_intake_binding",
  "creative_package",
  "runtime_policy",
  "candidate_revision_sha256",
  "request_fingerprint",
]);
const CANDIDATE_FIELDS_WITH_REVISION = new Set([
  ...CANDIDATE_FIELDS,
  "candidate_revision",
]);
const ALWAYS_FORBIDDEN_FIELDS = new Set([
  "approval",
  "approved",
  "human_approval",
  "human_approval_required",
  "human_review_required",
  "manual_approval",
]);
const AUTHORITY_FIELDS = new Set([
  "auto_publish",
  "database_authority",
  "database_mutated",
  "dispatch_authorised",
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

class GovernedAutonomousWindowProductionPlannerError extends Error {
  constructor(code, cause = null) {
    super(code, cause ? { cause } : undefined);
    this.name =
      "GovernedAutonomousWindowProductionPlannerError";
    this.code = code;
  }
}

function fail(code, cause = null) {
  throw new GovernedAutonomousWindowProductionPlannerError(
    code,
    cause,
  );
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
  if (
    !plainObject(value) ||
    Object.keys(value).length !== expected.size ||
    Object.keys(value).some((field) => !expected.has(field))
  ) {
    fail(code);
  }
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
  return { raw, timestamp, date: new Date(timestamp) };
}

function exactSha256(value, code) {
  const candidate = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(candidate)) fail(code);
  return candidate;
}

function exactStoryId(value) {
  const storyId = text(value);
  if (!STORY_ID_PATTERN.test(storyId)) {
    fail("autonomous_window_planner_candidate_incomplete");
  }
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

function guardedWindow(value) {
  const scheduled = exactTimestamp(
    value,
    "autonomous_window_planner_scheduled_for_invalid",
  );
  if (
    ![9, 19].includes(scheduled.date.getUTCHours()) ||
    scheduled.date.getUTCMinutes() !== 0 ||
    scheduled.date.getUTCSeconds() !== 0 ||
    scheduled.date.getUTCMilliseconds() !== 0
  ) {
    fail("autonomous_window_planner_guarded_window_required");
  }
  return scheduled;
}

function assertNoAuthority(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) assertNoAuthority(entry);
    return;
  }
  for (const [field, entry] of Object.entries(value)) {
    const normalised = field.toLowerCase();
    if (ALWAYS_FORBIDDEN_FIELDS.has(normalised)) {
      fail("autonomous_window_planner_human_approval_forbidden");
    }
    const authorityLike =
      AUTHORITY_FIELDS.has(normalised) ||
      /(?:^|_)(?:authority|authorised|authorized|mutated|contacted)(?:_|$)/.test(
        normalised,
      );
    if (authorityLike && entry !== false) {
      fail("autonomous_window_planner_authority_forbidden");
    }
    assertNoAuthority(entry);
  }
}

function normaliseCandidate(value, request) {
  assertNoAuthority(value);
  exactFields(
    value,
    Object.hasOwn(value, "candidate_revision")
      ? CANDIDATE_FIELDS_WITH_REVISION
      : CANDIDATE_FIELDS,
    "autonomous_window_planner_candidate_incomplete",
  );
  const storyId = exactStoryId(value.story_id);
  if (
    value.schema_version !== CANDIDATE_SCHEMA_VERSION ||
    value.mode !== MODE
  ) {
    fail("autonomous_window_planner_candidate_incomplete");
  }
  if (
    value.channel_id !== CHANNEL_ID ||
    value.lane_id !== LANE_ID ||
    text(value.platform).toLowerCase() !== PLATFORM ||
    value.scheduled_for !== request.scheduled_for
  ) {
    fail("autonomous_window_planner_candidate_binding_mismatch");
  }
  if (
    text(value.source_type).toLowerCase() !== "official" ||
    text(value.verification_status).toUpperCase() !== "CONFIRMED" ||
    text(value.eligibility_verdict).toUpperCase() !== "GREEN"
  ) {
    fail("autonomous_window_planner_candidate_not_eligible");
  }
  const published = exactTimestamp(
    value.source_published_at,
    "autonomous_window_planner_candidate_incomplete",
  );
  const verified = exactTimestamp(
    value.verified_at,
    "autonomous_window_planner_candidate_incomplete",
  );
  if (
    published.timestamp > verified.timestamp ||
    verified.timestamp > request.generated_timestamp
  ) {
    fail("autonomous_window_planner_candidate_time_invalid");
  }
  const score = Number(value.selection_score);
  if (
    !Number.isFinite(score) ||
    score < 0 ||
    score > 1_000_000
  ) {
    fail("autonomous_window_planner_candidate_score_invalid");
  }
  const revision = exactSha256(
    value.candidate_revision_sha256,
    "autonomous_window_planner_candidate_incomplete",
  );
  const fingerprint = exactSha256(
    value.request_fingerprint,
    "autonomous_window_planner_candidate_incomplete",
  );
  const sourceEvidenceSha256 = exactSha256(
    value.source_evidence_sha256,
    "autonomous_window_planner_candidate_incomplete",
  );
  if (
    value.locked_intake_binding?.story_id !== storyId ||
    value.creative_package?.official_source_url !==
      value.locked_intake_binding?.locked_intake
        ?.canonical_identity_url ||
    value.runtime_policy?.workspace_root !==
      request.workspace_root ||
    value.runtime_policy?.generated_at !== request.generated_at
  ) {
    fail("autonomous_window_planner_candidate_binding_mismatch");
  }
  const carriesFastNewsDecision =
    value.locked_intake_binding?.locked_intake
      ?.fast_news_lane_decision !== undefined;
  if (
    carriesFastNewsDecision &&
    !Object.hasOwn(value, "candidate_revision")
  ) {
    fail(
      "autonomous_window_planner_candidate_revision_required",
    );
  }
  if (Object.hasOwn(value, "candidate_revision")) {
    try {
      validateGovernedAutonomousCompiledCandidateBinding({
        candidate_revision: value.candidate_revision,
        candidate_revision_sha256: revision,
        request_fingerprint: fingerprint,
        story_id: storyId,
        channel_id: value.channel_id,
        lane_id: value.lane_id,
        platform: value.platform,
        scheduled_for: value.scheduled_for,
        source_evidence_sha256: sourceEvidenceSha256,
        locked_intake_binding: value.locked_intake_binding,
        creative_package: value.creative_package,
        runtime_policy: value.runtime_policy,
      });
    } catch (error) {
      fail(
        "autonomous_window_planner_candidate_revision_invalid",
        error,
      );
    }
  }
  return Object.freeze({
    raw: structuredClone(value),
    story_id: storyId,
    selection_score: score,
    source_published_at: published.raw,
    source_published_timestamp: published.timestamp,
    verified_at: verified.raw,
    source_evidence_sha256: sourceEvidenceSha256,
    candidate_revision_sha256: revision,
    request_fingerprint: fingerprint,
  });
}

function candidateOrder(left, right) {
  const score =
    right.selection_score - left.selection_score;
  if (score) return score;
  const recency =
    right.source_published_timestamp -
    left.source_published_timestamp;
  if (recency) return recency;
  return left.story_id.localeCompare(right.story_id);
}

function normaliseRequest(value) {
  assertNoAuthority(value);
  exactFields(
    value,
    REQUEST_FIELDS,
    "autonomous_window_planner_request_fields_invalid",
  );
  if (
    value.schema_version !== REQUEST_SCHEMA_VERSION ||
    value.mode !== MODE
  ) {
    fail("autonomous_window_planner_local_proof_only");
  }
  const workspaceRoot = exactAbsolutePath(
    value.workspace_root,
    "autonomous_window_planner_workspace_root_invalid",
  );
  const reservationOutputPath = exactAbsolutePath(
    value.reservation_output_path,
    "autonomous_window_planner_reservation_path_invalid",
  );
  const planOutputPath = exactAbsolutePath(
    value.plan_output_path,
    "autonomous_window_planner_plan_path_invalid",
  );
  if (
    reservationOutputPath === planOutputPath ||
    path.extname(reservationOutputPath).toLowerCase() !== ".json" ||
    path.extname(planOutputPath).toLowerCase() !== ".json"
  ) {
    fail("autonomous_window_planner_output_paths_invalid");
  }
  const generated = exactTimestamp(
    value.generated_at,
    "autonomous_window_planner_generated_at_invalid",
  );
  const scheduled = guardedWindow(value.scheduled_for);
  if (
    generated.timestamp >=
    scheduled.timestamp - T90_OFFSET_MS
  ) {
    fail("autonomous_window_planner_must_precede_t90");
  }
  const base = Object.freeze({
    generated_at: generated.raw,
    generated_timestamp: generated.timestamp,
    scheduled_for: scheduled.raw,
    workspace_root: workspaceRoot,
    reservation_output_path: reservationOutputPath,
    plan_output_path: planOutputPath,
  });
  if (!Array.isArray(value.candidates) || value.candidates.length < 2) {
    fail(
      "autonomous_window_planner_two_complete_candidates_required",
    );
  }
  const candidates = value.candidates.map((candidate) =>
    normaliseCandidate(candidate, base),
  );
  const ids = new Set(candidates.map((candidate) => candidate.story_id));
  if (ids.size !== candidates.length) {
    fail("autonomous_window_planner_distinct_candidates_required");
  }
  return Object.freeze({
    ...base,
    candidates: Object.freeze(candidates.sort(candidateOrder)),
  });
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

async function exactWorkspaceRoot(rootPath, fileSystem) {
  let stat;
  try {
    stat = await fileSystem.lstat(rootPath);
  } catch (error) {
    fail("autonomous_window_planner_workspace_root_invalid", error);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("autonomous_window_planner_workspace_root_invalid");
  }
  const real = path.resolve(await fileSystem.realpath(rootPath));
  if (real !== rootPath) {
    fail("autonomous_window_planner_workspace_root_link_forbidden");
  }
  return Object.freeze({ path: rootPath, real_path: real });
}

async function ensureSafeParent(
  root,
  outputPath,
  fileSystem,
  code,
) {
  if (
    !pathWithin(root.path, outputPath) ||
    outputPath === root.path
  ) {
    fail(code);
  }
  const relative = path.relative(
    root.path,
    path.dirname(outputPath),
  );
  let cursor = root.path;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      await fileSystem.mkdir(cursor);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const stat = await fileSystem.lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail(code);
    const real = path.resolve(await fileSystem.realpath(cursor));
    if (!pathWithin(root.real_path, real)) fail(code);
  }
}

function productionJobFor(builder, generatedAt) {
  const rolePriority =
    builder.role === "PRIMARY" ? 10 : 11;
  const databaseStoryBinding =
    validateGovernedAutonomousDatabaseStoryBinding(
      builder.production_request.locked_intake
        .database_story_binding,
      {
        canonical_story_id: builder.story_id,
      },
    );
  const payload = {
    lane_id: LANE_ID,
    story_id: builder.story_id,
    candidate_revision_sha256:
      builder.production_request.candidate_revision_sha256,
    autonomous_production_job: {
      schema_version:
        AUTONOMOUS_JOB_PAYLOAD_SCHEMA_VERSION,
      builder_result: builder,
    },
  };
  const idempotencyKey =
    "governed-autonomous-breaking-production:v1:" +
    canonicalSha256({
      reservation_set_sha256:
        builder.reservation_set_sha256,
      story_id: builder.story_id,
      role: builder.role,
      scheduled_for: builder.scheduled_for,
      builder_sha256: builder.builder_sha256,
    });
  return Object.freeze({
    kind: "produce_breaking_short",
    channel_id: CHANNEL_ID,
    story_id: databaseStoryBinding.database_story_id,
    payload,
    priority: rolePriority,
    run_at: generatedAt,
    max_attempts: 3,
    requires_gpu: false,
    idempotency_key: idempotencyKey,
  });
}

function validateEnqueuedJobs(jobs, requests) {
  if (
    !Array.isArray(jobs) ||
    jobs.length !== 2 ||
    jobs[0]?.id === jobs[1]?.id
  ) {
    fail("autonomous_window_planner_job_batch_invalid");
  }
  for (let index = 0; index < requests.length; index += 1) {
    const expected = requests[index];
    const observed = jobs[index];
    if (
      observed.kind !== expected.kind ||
      observed.channel_id !== expected.channel_id ||
      observed.story_id !== expected.story_id ||
      observed.idempotency_key !== expected.idempotency_key ||
      canonicalSha256(observed.payload) !==
        canonicalSha256(expected.payload)
    ) {
      fail("autonomous_window_planner_job_batch_invalid");
    }
  }
  return jobs;
}

async function writeIdempotently({
  root,
  outputPath,
  plan,
  fileSystem,
}) {
  await ensureSafeParent(
    root,
    outputPath,
    fileSystem,
    "autonomous_window_planner_plan_outside_workspace",
  );
  const bytes = Buffer.from(
    `${JSON.stringify(plan, null, 2)}\n`,
    "utf8",
  );
  try {
    const handle = await fileSystem.open(outputPath, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { status: "CREATED", bytes };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await fileSystem.readFile(outputPath);
    if (!existing.equals(bytes)) {
      fail("autonomous_window_planner_plan_conflict");
    }
    return { status: "REPLAYED", bytes: existing };
  }
}

function selectedEvidence(candidate, role, builder) {
  return {
    story_id: candidate.story_id,
    role,
    selection_score: candidate.selection_score,
    source_published_at: candidate.source_published_at,
    verified_at: candidate.verified_at,
    source_evidence_sha256:
      candidate.source_evidence_sha256,
    candidate_revision_sha256:
      candidate.candidate_revision_sha256,
    request_fingerprint: candidate.request_fingerprint,
    builder_sha256: builder.builder_sha256,
  };
}

function proposedReservationSet(input, primary, standby) {
  const body = {
    schema_version: RESERVATION_ARTIFACT_SCHEMA_VERSION,
    mode: MODE,
    state: "RESERVED_LOCAL_PROOF",
    binding_scope: "WINDOW_STORY_ROLE_ONLY",
    generated_at: input.generated_at,
    scheduled_for: input.scheduled_for,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    platform: PLATFORM,
    reservations: [
      { role: "PRIMARY", story_id: primary.story_id },
      { role: "STANDBY", story_id: standby.story_id },
    ],
    safety: {
      local_proof_only: true,
      database_authority: false,
      database_mutated: false,
      network_authority: false,
      network_used: false,
      oauth_or_token_authority: false,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      publish_authority: false,
      scheduler_authority: false,
      external_publish_authorised: false,
    },
  };
  return validateGovernedAutonomousWindowReservationSet({
    ...body,
    reservation_set_sha256: canonicalSha256(body),
  });
}

async function planGovernedAutonomousWindowProduction(
  value,
  options = {},
) {
  const input = normaliseRequest(value);
  const fileSystem = options.fileSystem || defaultFileSystem;
  const root = await exactWorkspaceRoot(
    input.workspace_root,
    fileSystem,
  );
  await ensureSafeParent(
    root,
    input.reservation_output_path,
    fileSystem,
    "autonomous_window_planner_reservation_outside_workspace",
  );
  await ensureSafeParent(
    root,
    input.plan_output_path,
    fileSystem,
    "autonomous_window_planner_plan_outside_workspace",
  );
  if (!options.jobs || typeof options.jobs.enqueueBatch !== "function") {
    fail("autonomous_window_planner_durable_jobs_required");
  }

  const primaryCandidate = input.candidates[0];
  const standbyCandidate = input.candidates[1];
  const exactReservationSet = proposedReservationSet(
    input,
    primaryCandidate,
    standbyCandidate,
  );

  const builder = options.buildProductionRequest ||
    buildGovernedAutonomousProductionRequest;
  let primary;
  let standby;
  try {
    primary = validateGovernedAutonomousProductionRequestBuild(
      builder({
        schema_version: BUILDER_SCHEMA_VERSION,
        mode: MODE,
        reservation_set: exactReservationSet,
        selected_role: "PRIMARY",
        story_id: primaryCandidate.story_id,
        locked_intake_binding:
          primaryCandidate.raw.locked_intake_binding,
        creative_package:
          primaryCandidate.raw.creative_package,
        runtime_policy: primaryCandidate.raw.runtime_policy,
        ...(primaryCandidate.raw.candidate_revision
          ? {
              candidate_revision:
                primaryCandidate.raw.candidate_revision,
            }
          : {}),
        candidate_revision_sha256:
          primaryCandidate.candidate_revision_sha256,
        request_fingerprint:
          primaryCandidate.request_fingerprint,
      }),
    );
    standby = validateGovernedAutonomousProductionRequestBuild(
      builder({
        schema_version: BUILDER_SCHEMA_VERSION,
        mode: MODE,
        reservation_set: exactReservationSet,
        selected_role: "STANDBY",
        story_id: standbyCandidate.story_id,
        locked_intake_binding:
          standbyCandidate.raw.locked_intake_binding,
        creative_package:
          standbyCandidate.raw.creative_package,
        runtime_policy: standbyCandidate.raw.runtime_policy,
        ...(standbyCandidate.raw.candidate_revision
          ? {
              candidate_revision:
                standbyCandidate.raw.candidate_revision,
            }
          : {}),
        candidate_revision_sha256:
          standbyCandidate.candidate_revision_sha256,
        request_fingerprint:
          standbyCandidate.request_fingerprint,
      }),
    );
  } catch (error) {
    fail("autonomous_window_planner_candidate_incomplete", error);
  }
  assertNoAuthority(primary);
  assertNoAuthority(standby);

  let reservation;
  try {
    reservation =
      await (
        options.materialiseReservationSet ||
        materialiseGovernedAutonomousWindowReservationSet
      )(
        {
          schema_version:
            RESERVATION_REQUEST_SCHEMA_VERSION,
          mode: MODE,
          generated_at: input.generated_at,
          scheduled_for: input.scheduled_for,
          channel_id: CHANNEL_ID,
          lane_id: LANE_ID,
          platform: PLATFORM,
          reservations: exactReservationSet.reservations,
          workspace_root: root.path,
          output_path: input.reservation_output_path,
        },
        { fileSystem },
      );
  } catch (error) {
    fail("autonomous_window_planner_reservation_failed", error);
  }
  let observedReservation;
  try {
    observedReservation =
      validateGovernedAutonomousWindowReservationSet(
        reservation.reservation_set,
      );
  } catch (error) {
    fail("autonomous_window_planner_reservation_failed", error);
  }
  if (
    canonicalSha256(observedReservation) !==
      canonicalSha256(exactReservationSet) ||
    primary.reservation_set_sha256 !==
      observedReservation.reservation_set_sha256 ||
    standby.reservation_set_sha256 !==
      observedReservation.reservation_set_sha256
  ) {
    fail("autonomous_window_planner_reservation_binding_mismatch");
  }

  const jobRequests = [
    productionJobFor(primary, input.generated_at),
    productionJobFor(standby, input.generated_at),
  ];
  let jobs;
  try {
    jobs = validateEnqueuedJobs(
      options.jobs.enqueueBatch(jobRequests),
      jobRequests,
    );
  } catch (error) {
    if (
      error instanceof
      GovernedAutonomousWindowProductionPlannerError
    ) {
      throw error;
    }
    fail("autonomous_window_planner_job_batch_failed", error);
  }

  const selected = [
    selectedEvidence(primaryCandidate, "PRIMARY", primary),
    selectedEvidence(standbyCandidate, "STANDBY", standby),
  ];
  const planBody = {
    schema_version: RESULT_SCHEMA_VERSION,
    mode: MODE,
    verdict: "QUEUED_LOCAL_PROOF",
    generated_at: input.generated_at,
    scheduled_for: input.scheduled_for,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    platform: PLATFORM,
    selection_policy:
      "SCORE_DESC_SOURCE_PUBLISHED_DESC_STORY_ID_ASC",
    eligible_candidate_count: input.candidates.length,
    selected_candidates: selected,
    not_selected_story_ids: input.candidates
      .slice(2)
      .map((candidate) => candidate.story_id)
      .sort(),
    reservation_set: {
      path: reservation.path,
      file_sha256: reservation.file_sha256,
      reservation_set_sha256:
        reservation.reservation_set.reservation_set_sha256,
    },
    production_jobs: jobs.map((job, index) => ({
      job_id: job.id,
      kind: "produce_breaking_short",
      story_id:
        jobRequests[index].payload.story_id,
      database_story_id: job.story_id,
      role: index === 0 ? "PRIMARY" : "STANDBY",
      idempotency_key: job.idempotency_key,
      builder_sha256:
        jobRequests[index].payload.autonomous_production_job
          .builder_result.builder_sha256,
    })),
    job_queue_state: "EXACT_TWO_DURABLE_JOBS_PRESENT",
    database_scope: "DURABLE_JOB_QUEUE_ONLY",
    story_approval_mutated: false,
    human_approval_dependency: false,
    source_network_used: false,
    platform_contacted: false,
    oauth_or_tokens_mutated: false,
    publish_authority_created: false,
    scheduler_authority_created: false,
    external_posting: false,
  };
  const plan = Object.freeze({
    ...planBody,
    plan_sha256: canonicalSha256(planBody),
  });
  const written = await writeIdempotently({
    root,
    outputPath: input.plan_output_path,
    plan,
    fileSystem,
  });
  return Object.freeze({
    status: written.status,
    path: input.plan_output_path,
    file_sha256: crypto
      .createHash("sha256")
      .update(written.bytes)
      .digest("hex"),
    plan,
  });
}

module.exports = {
  AUTONOMOUS_JOB_PAYLOAD_SCHEMA_VERSION,
  CANDIDATE_SCHEMA_VERSION,
  GovernedAutonomousWindowProductionPlannerError,
  REQUEST_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION,
  planGovernedAutonomousWindowProduction,
};

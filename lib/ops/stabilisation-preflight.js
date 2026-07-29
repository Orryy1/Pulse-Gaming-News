"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  cleanCommit,
  resolveRuntimeBuildInfo,
} = require("../runtime-build-info");
const {
  assessPublicationEvidence,
} = require("../services/publication-evidence-gates");
const {
  evaluateStoryHumanReview,
  PLATFORM_POLICY,
  resolveOperatingContract,
} = require("../stabilisation/operating-contract");
const {
  evaluateRendererManifest,
} = require("../stabilisation/renderer-governance");
const {
  GUARDED_UTC_HOURS,
  isGuardedUtcSchedule,
} = require("../services/publication-admission");
const {
  resolveExactScheduledDispatchBindingFromRows,
} = require("../services/scheduled-dispatch-binding");
const {
  createReportMetadata,
} = require("../stabilisation/report-governance");
const {
  governedYoutubeRunwayScheduleContract,
} = require("../scheduler");
const {
  youtubeAdmissionJobIdempotencyKey,
} = require("../services/governed-publication-job-identity");

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const COMMIT_PATTERN = /^[a-f0-9]{7,64}$/i;
const ACTIVE_JOB_STATES = new Set(["pending", "claimed", "running"]);
const STABILISATION_SCHEDULER_PROFILE = "stabilisation_30d";
const GOVERNED_MULTI_LANE_SCHEDULER_PROFILE = "governed_multi_lane";
const REQUIRED_ARTIFACT_EVIDENCE = Object.freeze([
  "final_mp4_exists",
  "narration_audio_exists",
  "word_timestamps_exist",
  "motion_materialised",
  "hashes_verified",
]);

function parseCliArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function resolvePreflightProvenance({
  cwd = process.cwd(),
  env = process.env,
  sourceCommitSha = null,
  runtimeCommitSha = null,
} = {}) {
  const build = resolveRuntimeBuildInfo({ cwd, env });
  const source =
    cleanCommit(sourceCommitSha) || cleanCommit(build.commit_sha);
  const runtime =
    cleanCommit(runtimeCommitSha) ||
    cleanCommit(env.PULSE_RUNTIME_COMMIT_SHA) ||
    cleanCommit(build.commit_sha);
  return {
    sourceCommitSha: source,
    runtimeCommitSha: runtime,
    commitSource: build.commit_source,
  };
}

function readSnapshot(snapshotPath) {
  if (!snapshotPath) throw new Error("read_only_snapshot_required");
  const resolved = path.resolve(snapshotPath);
  const snapshot = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (
    !snapshot ||
    snapshot.schema_version !== "pulse-preflight-snapshot-v1" ||
    snapshot.source?.read_only !== true
  ) {
    throw new Error("valid_read_only_snapshot_required");
  }
  const platformPosts = Array.isArray(snapshot.platform_posts)
    ? snapshot.platform_posts
    : [];
  const dispatchLedger = Array.isArray(snapshot.dispatch_ledger)
    ? snapshot.dispatch_ledger
    : [];
  return {
    ...snapshot,
    stories: Array.isArray(snapshot.stories) ? snapshot.stories : [],
    platform_posts: platformPosts,
    cadence_platform_posts: Array.isArray(
      snapshot.cadence_platform_posts,
    )
      ? snapshot.cadence_platform_posts
      : platformPosts,
    schedules: Array.isArray(snapshot.schedules) ? snapshot.schedules : [],
    jobs: Array.isArray(snapshot.jobs) ? snapshot.jobs : [],
    runtime_leases: Array.isArray(snapshot.runtime_leases)
      ? snapshot.runtime_leases
      : [],
    dispatch_ledger: dispatchLedger,
    cadence_dispatch_ledger: Array.isArray(
      snapshot.cadence_dispatch_ledger,
    )
      ? snapshot.cadence_dispatch_ledger
      : dispatchLedger,
    scheduled_dispatch_bindings: Array.isArray(
      snapshot.scheduled_dispatch_bindings,
    )
      ? snapshot.scheduled_dispatch_bindings
      : [],
    evidence_by_story:
      snapshot.evidence_by_story &&
      typeof snapshot.evidence_by_story === "object"
        ? snapshot.evidence_by_story
        : {},
  };
}

function evidenceFromStories(stories) {
  const entries = [];
  for (const story of stories) {
    if (!story?.id) continue;
    const evidence =
      story.preflight_evidence ||
      story.publication_evidence_package ||
      story.publication_evidence;
    if (
      evidence &&
      typeof evidence === "object" &&
      !Array.isArray(evidence)
    ) {
      entries.push([String(story.id), evidence]);
    }
  }
  return Object.fromEntries(entries);
}

function loadReadOnlySnapshot({
  snapshotPath = null,
  stateRoot = process.cwd(),
  env = process.env,
} = {}) {
  if (snapshotPath) return readSnapshot(snapshotPath);
  const root = path.resolve(stateRoot);
  if (/^(true|1|yes|on)$/i.test(String(env.USE_SQLITE || "").trim())) {
    return readSqliteSnapshot({ stateRoot: root, env });
  }
  const storiesPath = path.join(root, "daily_news.json");
  let stories = [];
  const errors = [];
  if (fs.existsSync(storiesPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(storiesPath, "utf8"));
      if (Array.isArray(parsed)) stories = parsed;
      else errors.push("daily_news_not_array");
    } catch {
      errors.push("daily_news_invalid_json");
    }
  } else {
    errors.push("daily_news_missing");
  }
  return {
    schema_version: "pulse-preflight-snapshot-v1",
    source: {
      kind: "json_fallback",
      read_only: true,
      errors,
    },
    stories,
    platform_posts: [],
    cadence_platform_posts: [],
    schedules: [],
    jobs: [],
    runtime_leases: [],
    dispatch_ledger: [],
    cadence_dispatch_ledger: [],
    scheduled_dispatch_bindings: [],
    evidence_by_story: evidenceFromStories(stories),
  };
}

function mergeStoryExtra(row) {
  if (!row || typeof row !== "object") return row;
  let extra = {};
  if (typeof row._extra === "string" && row._extra.trim()) {
    try {
      const parsed = JSON.parse(row._extra);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        extra = parsed;
      }
    } catch {
      extra = {};
    }
  }
  const story = { ...row, ...extra };
  delete story._extra;
  if (story.approved === 0 || story.approved === 1) {
    story.approved = story.approved === 1;
  }
  if (story.auto_approved === 0 || story.auto_approved === 1) {
    story.auto_approved = story.auto_approved === 1;
  }
  return story;
}

function readSqliteSnapshot({
  stateRoot = process.cwd(),
  env = process.env,
  dataVersionReader = (database) =>
    Number(database.pragma("data_version", { simple: true })),
} = {}) {
  const configured = String(env.SQLITE_DB_PATH || "").trim();
  const dbPath = configured
    ? path.isAbsolute(configured)
      ? configured
      : path.resolve(stateRoot, configured)
    : path.join(path.resolve(stateRoot), "data", "pulse.db");
  const empty = (kind, errors) => ({
    schema_version: "pulse-preflight-snapshot-v1",
    source: { kind, read_only: true, errors },
    stories: [],
    platform_posts: [],
    cadence_platform_posts: [],
    schedules: [],
    jobs: [],
    runtime_leases: [],
    dispatch_ledger: [],
    cadence_dispatch_ledger: [],
    scheduled_dispatch_bindings: [],
    evidence_by_story: {},
  });
  if (!fs.existsSync(dbPath)) {
    return empty("sqlite_missing", ["sqlite_database_missing"]);
  }

  const before = fs.statSync(dbPath);
  const Database = require("better-sqlite3");
  let database;
  let readTransactionOpen = false;
  try {
    database = new Database(dbPath, {
      readonly: true,
      fileMustExist: true,
    });
    database.pragma("query_only = ON");
    database.exec("BEGIN");
    readTransactionOpen = true;
    const dataVersionBefore = Number(dataVersionReader(database));
    const tables = new Set(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table'",
        )
        .all()
        .map((row) => row.name),
    );
    const readTable = (name, sql) =>
      tables.has(name) ? database.prepare(sql).all() : [];
    const tableColumns = (name) =>
      tables.has(name)
        ? new Set(
            database
              .prepare(`PRAGMA table_info(${name})`)
              .all()
              .map((column) => String(column.name)),
          )
        : new Set();
    const jobColumns = tableColumns("jobs");
    const stories = readTable(
      "stories",
      `SELECT *
       FROM stories
       WHERE TRIM(COALESCE(youtube_post_id, '')) = ''
         AND (
           approved = 1
           OR TRIM(COALESCE(exported_path, '')) <> ''
         )
       ORDER BY COALESCE(breaking_score, 0) DESC, id ASC`,
    ).map(mergeStoryExtra);
    const platformPosts = readTable(
      "platform_posts",
      `SELECT *
       FROM platform_posts
       ORDER BY
         julianday(COALESCE(published_at, updated_at)) DESC,
         id DESC
       LIMIT 1000`,
    );
    const cadencePlatformPosts = readTable(
      "platform_posts",
      `SELECT *
       FROM platform_posts
       WHERE LOWER(platform) = 'youtube'
         AND LOWER(status) = 'published'
         AND TRIM(COALESCE(external_id, '')) <> ''
       ORDER BY
         julianday(COALESCE(published_at, updated_at)) DESC,
         id DESC
       LIMIT 1000`,
    );
    const schedules = readTable(
      "schedules",
      "SELECT * FROM schedules",
    );
    let jobs = readTable(
      "jobs",
      `SELECT *
       FROM jobs
       WHERE LOWER(status) IN ('pending', 'claimed', 'running')
          AND kind IN (
            'publish',
            'admit_governed_publication',
            'prestage_governed_youtube_release',
            'verify_governed_youtube_release_tminus15',
            'verify_governed_youtube_release_t0'
          )
       ORDER BY ${
         jobColumns.has("run_at") ? "julianday(run_at) ASC," : ""
       } id ASC`,
    );
    const runtimeLeases = readTable(
      "runtime_leases",
      "SELECT * FROM runtime_leases",
    );
    const dispatchLedger = readTable(
      "platform_dispatch_ledger",
      `SELECT *
       FROM platform_dispatch_ledger
       WHERE LOWER(platform) = 'youtube'
         AND UPPER(event_type) = 'PUBLISHED'
         AND LOWER(verification_status) = 'confirmed'
       ORDER BY julianday(created_at) DESC, id DESC
       LIMIT 1000`,
    );
    const scheduledDispatchBindings =
      tables.has("platform_publication_state") &&
      tables.has("publication_lifecycle_events")
        ? database
            .prepare(`
              SELECT
                state.story_id,
                state.platform,
                state.lifecycle_state,
                event.id AS scheduled_event_id,
                event.evidence_json,
                event.created_at AS scheduled_event_created_at
              FROM platform_publication_state AS state
              JOIN publication_lifecycle_events AS event
                ON event.id = (
                  SELECT candidate.id
                  FROM publication_lifecycle_events AS candidate
                  WHERE candidate.story_id = state.story_id
                    AND candidate.platform = state.platform
                    AND candidate.to_state = 'SCHEDULED'
                  ORDER BY candidate.id DESC
                  LIMIT 1
                )
              WHERE state.platform = 'youtube'
                AND state.lifecycle_state = 'SCHEDULED'
              ORDER BY event.id ASC
              LIMIT 100
            `)
            .all()
        : [];
    const scheduledStoryIds = [
      ...new Set(
        scheduledDispatchBindings
          .map((row) => String(row.story_id || "").trim())
          .filter(Boolean),
      ),
    ];
    if (
      tables.has("jobs") &&
      scheduledStoryIds.length > 0 &&
      jobColumns.has("story_id")
    ) {
      const placeholders = scheduledStoryIds.map(() => "?").join(", ");
      const persistedAdmissionJobs = database
        .prepare(
          `SELECT *
           FROM jobs
           WHERE kind = 'admit_governed_publication'
             AND story_id IN (${placeholders})
             AND LOWER(status) NOT IN ('failed', 'cancelled')
           ORDER BY id DESC`,
        )
        .all(...scheduledStoryIds);
      const jobsById = new Map(
        [...jobs, ...persistedAdmissionJobs].map((job) => [
          String(job.id),
          job,
        ]),
      );
      jobs = [...jobsById.values()];
    }
    const dataVersionAfter = Number(dataVersionReader(database));
    const dataVersionStable =
      Number.isInteger(dataVersionBefore) &&
      Number.isInteger(dataVersionAfter) &&
      dataVersionBefore === dataVersionAfter;
    database.exec("COMMIT");
    readTransactionOpen = false;
    database.close();
    database = null;
    const after = fs.statSync(dbPath);
    const unchanged =
      before.size === after.size && before.mtimeMs === after.mtimeMs;
    const errors = [];
    if (!unchanged) errors.push("sqlite_file_changed_during_read");
    if (!dataVersionStable) {
      errors.push("sqlite_data_version_changed_during_read");
    }
    return {
      schema_version: "pulse-preflight-snapshot-v1",
      source: {
        kind: "sqlite_readonly",
        read_only: true,
        database_file_unchanged: unchanged,
        read_transaction_committed: true,
        transaction_consistent: dataVersionStable,
        data_version_before: Number.isInteger(dataVersionBefore)
          ? dataVersionBefore
          : null,
        data_version_after: Number.isInteger(dataVersionAfter)
          ? dataVersionAfter
          : null,
        errors,
      },
      stories,
      platform_posts: platformPosts,
      cadence_platform_posts: cadencePlatformPosts,
      schedules,
      jobs,
      runtime_leases: runtimeLeases,
      dispatch_ledger: dispatchLedger,
      cadence_dispatch_ledger: dispatchLedger,
      scheduled_dispatch_bindings: scheduledDispatchBindings,
      evidence_by_story: evidenceFromStories(stories),
    };
  } catch {
    if (readTransactionOpen) {
      try {
        database?.exec("ROLLBACK");
      } catch {
        // The connection is read-only and closes immediately below.
      }
      readTransactionOpen = false;
    }
    try {
      database?.close();
    } catch {
      // The connection is read-only and best-effort close is enough here.
    }
    return empty("sqlite_unavailable", ["sqlite_read_failed"]);
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function preflightMetadata({
  generatedAt,
  sourceCommitSha,
  runtimeCommitSha,
  scope,
  environment = "LOCAL_PROOF read-only snapshot",
} = {}) {
  const generated = new Date(generatedAt).toISOString();
  return createReportMetadata({
    generatedAt: generated,
    sourceCommitSha,
    runtimeCommitSha,
    environment,
    scope,
    expiresAt: new Date(
      Date.parse(generated) + 60 * 60 * 1000,
    ).toISOString(),
    supersedes: [],
    supersededBy: [],
    authoritative: false,
  });
}

function parseSchedulePayload(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function resolveSchedulerProfile(env = process.env) {
  return (
    String(
      env?.PULSE_SCHEDULER_PROFILE ||
        STABILISATION_SCHEDULER_PROFILE,
    ).trim() || STABILISATION_SCHEDULER_PROFILE
  );
}

function normaliseUtcTimestamp(value) {
  let raw = String(value || "").trim();
  if (
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
  ) {
    raw = `${raw.replace(" ", "T")}Z`;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function governedScheduledAdmissionJobAssessment({
  snapshot,
  binding,
} = {}) {
  const blockers = [];
  const jobs = (snapshot?.jobs || []).filter((job) => {
    if (job?.kind !== "admit_governed_publication") return false;
    const payload = parseSchedulePayload(job.payload);
    return (
      String(job.story_id || "").trim() === binding.storyId ||
      String(payload.story_id || "").trim() === binding.storyId
    );
  });
  if (jobs.length !== 1) {
    blockers.push("exact_scheduled_admission_job_count_must_be_one");
  }
  const job = jobs.length === 1 ? jobs[0] : null;
  if (job) {
    const payload = parseSchedulePayload(job.payload);
    const admission = parseSchedulePayload(payload.admission);
    const laneId = String(payload.lane_id || "").trim();
    const revision = String(
      payload.candidate_revision_sha256 || "",
    )
      .trim()
      .toLowerCase();
    const scheduledFor = normaliseUtcTimestamp(
      admission.scheduled_for,
    );
    const expectedRunAt = new Date(
      Date.parse(binding.scheduledFor) - 75 * 60 * 1000,
    ).toISOString();
    const status = String(job.status || "").trim().toLowerCase();
    if (!Number.isInteger(Number(job.id)) || Number(job.id) <= 0) {
      blockers.push("scheduled_admission_job_id_invalid");
    }
    if (String(job.story_id || "").trim() !== binding.storyId) {
      blockers.push("scheduled_admission_story_id_mismatch");
    }
    if (String(payload.story_id || "").trim() !== binding.storyId) {
      blockers.push("scheduled_admission_payload_story_id_mismatch");
    }
    if (String(payload.platform || "").trim() !== "youtube") {
      blockers.push("scheduled_admission_platform_mismatch");
    }
    if (!SHA256_PATTERN.test(revision)) {
      blockers.push("scheduled_admission_revision_sha256_invalid");
    }
    if (!laneId) {
      blockers.push("scheduled_admission_lane_id_required");
    }
    if (scheduledFor !== binding.scheduledFor) {
      blockers.push("scheduled_admission_time_mismatch");
    }
    if (normaliseUtcTimestamp(job.run_at) !== expectedRunAt) {
      blockers.push("scheduled_admission_run_at_mismatch");
    }
    if (
      !new Set(["pending", "claimed", "running", "done"]).has(status)
    ) {
      blockers.push("scheduled_admission_job_status_invalid");
    }
    let expectedIdempotencyKey = null;
    try {
      expectedIdempotencyKey =
        youtubeAdmissionJobIdempotencyKey({
          laneId,
          storyId: binding.storyId,
          candidateRevisionSha256: revision,
          scheduledFor,
        });
    } catch {
      blockers.push(
        "scheduled_admission_job_idempotency_identity_invalid",
      );
    }
    if (
      String(job.idempotency_key || "").trim() !==
      expectedIdempotencyKey
    ) {
      blockers.push("scheduled_admission_job_idempotency_key_mismatch");
    }
  }
  const uniqueBlockers = unique(blockers);
  return {
    blockers: uniqueBlockers,
    evidence: {
      admission_job_id:
        job && Number.isInteger(Number(job.id))
          ? Number(job.id)
          : null,
      admission_job_status:
        String(job?.status || "").trim().toLowerCase() || null,
      admission_job_run_at: job
        ? normaliseUtcTimestamp(job.run_at)
        : null,
      admission_job_idempotency_key:
        String(job?.idempotency_key || "").trim() || null,
    },
  };
}

function governedScheduledDispatchAssessment({
  snapshot,
  generatedAt,
  nextCandidate,
} = {}) {
  const rows = Array.isArray(snapshot?.scheduled_dispatch_bindings)
    ? snapshot.scheduled_dispatch_bindings
    : [];
  let binding = null;
  const blockers = [];
  try {
    binding = resolveExactScheduledDispatchBindingFromRows({
      rows,
      now: generatedAt,
    });
  } catch (error) {
    blockers.push(
      error?.code ||
        error?.message ||
        "scheduled_dispatch_binding_invalid",
    );
  }
  if (!binding) {
    return {
      blockers: unique(blockers),
      evidence: {
        required: true,
        observed: rows.length === 1,
        valid: false,
        story_id: null,
        scheduled_event_id: null,
        scheduled_for: null,
        dispatch_job_id: null,
        dispatch_job_run_at: null,
        dispatch_job_idempotency_key: null,
        admission_job_id: null,
        admission_job_status: null,
        admission_job_run_at: null,
        admission_job_idempotency_key: null,
        blocker: blockers[0] || "scheduled_dispatch_binding_invalid",
      },
    };
  }

  if (!isGuardedUtcSchedule(new Date(binding.scheduledFor))) {
    blockers.push("schedule_outside_guarded_youtube_windows");
  }
  if (
    !nextCandidate ||
    String(nextCandidate.story_id || "") !== binding.storyId
  ) {
    blockers.push("scheduled_candidate_identity_mismatch");
  }
  const activeDispatchJobs = (snapshot?.jobs || []).filter(
    (job) =>
      job?.kind === "verify_governed_youtube_release_t0" &&
      ACTIVE_JOB_STATES.has(String(job.status || "").toLowerCase()),
  );
  if (activeDispatchJobs.length !== 1) {
    blockers.push("exact_scheduled_dispatch_job_count_must_be_one");
  } else {
    const dispatchJob = activeDispatchJobs[0];
    const payload = parseSchedulePayload(dispatchJob.payload);
    const scheduledFor = Number.isFinite(
      Date.parse(String(payload.scheduled_for || "")),
    )
      ? new Date(payload.scheduled_for).toISOString()
      : null;
    for (const [actual, expected, code] of [
      [
        String(payload.story_id || "").trim(),
        binding.storyId,
        "scheduled_story_id_mismatch",
      ],
      [
        String(payload.platform || "").trim(),
        binding.platform,
        "scheduled_platform_mismatch",
      ],
      [
        Number(payload.scheduled_event_id),
        binding.scheduledEventId,
        "scheduled_event_id_mismatch",
      ],
      [
        scheduledFor,
        binding.scheduledFor,
        "scheduled_time_mismatch",
      ],
      [
        String(payload.dispatch_idempotency_key || "").trim(),
        binding.dispatchIdempotencyKey,
        "scheduled_dispatch_idempotency_key_mismatch",
      ],
      [
        String(payload.request_fingerprint || "")
          .trim()
          .toLowerCase(),
        binding.requestFingerprint,
        "scheduled_request_fingerprint_mismatch",
      ],
    ]) {
      if (actual !== expected) blockers.push(code);
    }
    if (
      payload.public_release_verification_authority !== true
    ) {
      blockers.push(
        "exact_public_release_verification_authority_required",
      );
    }
    const runAt = normaliseUtcTimestamp(dispatchJob.run_at);
    if (runAt !== binding.scheduledFor) {
      blockers.push("scheduled_dispatch_run_at_mismatch");
    }
    const {
      youtubeReleaseJobIdempotencyKey,
    } = require("../services/governed-publication-job-identity");
    const expectedJobIdempotencyKey =
      youtubeReleaseJobIdempotencyKey({
        phase: "T0",
        scheduledEventId: binding.scheduledEventId,
        requestFingerprint: binding.requestFingerprint,
      });
    if (
      String(dispatchJob.idempotency_key || "").trim() !==
      expectedJobIdempotencyKey
    ) {
      blockers.push(
        "scheduled_dispatch_job_idempotency_key_mismatch",
      );
    }
  }
  const admissionJob = governedScheduledAdmissionJobAssessment({
    snapshot,
    binding,
  });
  blockers.push(...admissionJob.blockers);

  const uniqueBlockers = unique(blockers);
  const dispatchJob =
    activeDispatchJobs.length === 1 ? activeDispatchJobs[0] : null;
  return {
    blockers: uniqueBlockers,
    evidence: {
      required: true,
      observed: true,
      valid: uniqueBlockers.length === 0,
      story_id: binding.storyId,
      scheduled_event_id: binding.scheduledEventId,
      scheduled_for: binding.scheduledFor,
      dispatch_job_id:
        dispatchJob && Number.isFinite(Number(dispatchJob.id))
          ? Number(dispatchJob.id)
          : null,
      dispatch_job_run_at: dispatchJob
        ? normaliseUtcTimestamp(dispatchJob.run_at)
        : null,
      dispatch_job_idempotency_key:
        String(dispatchJob?.idempotency_key || "").trim() || null,
      ...admissionJob.evidence,
      blocker: uniqueBlockers[0] || null,
    },
  };
}

function buildGovernedSchedulerContract({
  snapshot,
  operatingContract,
  nextCandidate,
  generatedAt,
} = {}) {
  const blockers = [];
  const enabledSchedules = (snapshot?.schedules || [])
    .filter(
      (schedule) =>
        schedule.enabled !== false && schedule.enabled !== 0,
    )
    .map((schedule) => ({
      ...schedule,
      payload: parseSchedulePayload(schedule.payload),
    }));
  const enabledGenericSchedules = enabledSchedules.filter(
    (schedule) =>
      schedule?.kind === "publish",
  );
  const enabledOneShotReleaseSchedules = enabledSchedules.filter(
    (schedule) =>
      [
        "admit_governed_publication",
        "prestage_governed_youtube_release",
        "verify_governed_youtube_release_tminus15",
        "verify_governed_youtube_release_t0",
      ].includes(schedule?.kind),
  );
  const activeGenericJobs = (snapshot?.jobs || []).filter(
    (job) =>
      job?.kind === "publish" &&
      ACTIVE_JOB_STATES.has(String(job.status || "").toLowerCase()),
  );
  if (enabledGenericSchedules.length > 0) {
    blockers.push("governed_generic_publish_schedule_forbidden");
  }
  if (activeGenericJobs.length > 0) {
    blockers.push("governed_generic_publish_job_forbidden");
  }
  if (enabledOneShotReleaseSchedules.length > 0) {
    blockers.push("governed_one_shot_release_schedule_forbidden");
  }
  const runwayScheduleContract =
    governedYoutubeRunwayScheduleContract(enabledSchedules);
  blockers.push(...runwayScheduleContract.blockers);

  const recurringYoutubeWindows = [...GUARDED_UTC_HOURS]
    .sort((left, right) => left - right)
    .map((hour) => ({
      platform: "youtube",
      utc_time: `${String(hour).padStart(2, "0")}:00`,
      cron_expr: `0 ${hour} * * *`,
      authority: "allowlisted_admission_only",
    }));
  if (
    recurringYoutubeWindows.length !== 2 ||
    recurringYoutubeWindows[0]?.utc_time !== "09:00" ||
    recurringYoutubeWindows[1]?.utc_time !== "19:00"
  ) {
    blockers.push("governed_youtube_window_contract_invalid");
  }

  const scheduledDispatch = governedScheduledDispatchAssessment({
    snapshot,
    generatedAt,
    nextCandidate,
  });
  blockers.push(...scheduledDispatch.blockers);

  const candidateApproved =
    nextCandidate?.evidence?.human_review === "approved";
  if (!candidateApproved) {
    blockers.push("human_review_not_approved");
  }
  const liveAuthorityProven =
    operatingContract?.mode === "LIVE_GUARDED" &&
    operatingContract?.valid === true &&
    operatingContract?.live_mutation_allowed === true;
  if (!liveAuthorityProven) {
    blockers.push("live_publish_authority_not_proven");
  }

  return {
    blockers: unique(blockers),
    contract: {
      schema_version: "pulse-scheduler-preflight-contract-v1",
      profile: GOVERNED_MULTI_LANE_SCHEDULER_PROFILE,
      strategy: "exact_scheduled_admission_release_chain",
      youtube_account_binding:
        operatingContract?.youtube_account_binding || {
          required: false,
          expected_oauth_client_sha256: null,
        },
      recurring_youtube_windows: recurringYoutubeWindows,
      runway_schedule_contract: runwayScheduleContract,
      one_shot_job_contract: {
        recurring_schedule_count:
          enabledOneShotReleaseSchedules.length,
        valid: enabledOneShotReleaseSchedules.length === 0,
        admission: {
          kind: "admit_governed_publication",
          timing: "T-75",
          durable_run_at_required: true,
        },
        private_prestage: {
          kind: "prestage_governed_youtube_release",
          timing: "T-70",
          durable_run_at_required: true,
        },
        scheduled_verification: {
          kind: "verify_governed_youtube_release_tminus15",
          timing: "T-15",
          durable_run_at_required: true,
        },
        public_verification: {
          kind: "verify_governed_youtube_release_t0",
          timing: "T0",
          durable_run_at_required: true,
        },
      },
      generic_publish_schedules: {
        required: false,
        enabled_count: enabledGenericSchedules.length,
        valid: enabledGenericSchedules.length === 0,
      },
      generic_publish_jobs: {
        required: false,
        active_count: activeGenericJobs.length,
        valid: activeGenericJobs.length === 0,
      },
      exact_scheduled_dispatch_binding: scheduledDispatch.evidence,
      human_review: {
        required: true,
        candidate_approved: candidateApproved,
      },
      live_authority: {
        required_for_dispatch: true,
        operating_mode: operatingContract?.mode || null,
        proven: liveAuthorityProven,
      },
    },
  };
}

function buildSchedulerBlockers({
  snapshot,
  generatedAt,
  sourceCommitSha,
  runtimeCommitSha,
  schedulerProfile = STABILISATION_SCHEDULER_PROFILE,
} = {}) {
  const blockers = [];
  if (snapshot?.source?.read_only !== true) {
    blockers.push("read_only_snapshot_required");
  }
  if (!COMMIT_PATTERN.test(String(sourceCommitSha || ""))) {
    blockers.push("source_commit_sha_required");
  }
  if (!COMMIT_PATTERN.test(String(runtimeCommitSha || ""))) {
    blockers.push("runtime_commit_sha_required");
  } else if (
    String(sourceCommitSha).toLowerCase() !==
    String(runtimeCommitSha).toLowerCase()
  ) {
    blockers.push("source_runtime_commit_mismatch");
  }

  const enabledPublishSchedules = (snapshot?.schedules || []).filter(
    (schedule) =>
      schedule?.kind === "publish" &&
      schedule.enabled !== false &&
      schedule.enabled !== 0,
  );
  if (schedulerProfile === STABILISATION_SCHEDULER_PROFILE) {
    const expectedWindows = new Map([
      ["publish_morning", "0 9 * * *"],
      ["publish_primary", "0 19 * * *"],
    ]);
    if (enabledPublishSchedules.length !== expectedWindows.size) {
      blockers.push("exactly_two_publish_windows_required");
    }
    for (const [name, cron] of expectedWindows) {
      const schedule = enabledPublishSchedules.find(
        (entry) => entry.name === name,
      );
      if (!schedule || schedule.cron_expr !== cron) {
        blockers.push(`governed_publish_window_missing:${name}`);
        continue;
      }
      const payload = parseSchedulePayload(schedule.payload);
      if (
        payload.target_platform !== "youtube" ||
        payload.scheduler_profile !== STABILISATION_SCHEDULER_PROFILE
      ) {
        blockers.push(`youtube_stabilisation_schedule_required:${name}`);
      }
      const policy = payload.cadence_policy || {};
      if (
        Number(policy.rolling_window_hours) !== 24 ||
        Number(policy.max_publish_windows) !== 2 ||
        Number(policy.minimum_gap_hours) !== 4 ||
        policy.catch_up !== false
      ) {
        blockers.push(`stabilisation_cadence_policy_required:${name}`);
      }
    }
  } else if (schedulerProfile !== GOVERNED_MULTI_LANE_SCHEDULER_PROFILE) {
    blockers.push(`unknown_scheduler_profile:${schedulerProfile}`);
  }

  const activePublishJobs = (snapshot?.jobs || []).filter(
    (job) =>
      job?.kind === "publish" &&
      ACTIVE_JOB_STATES.has(String(job.status || "").toLowerCase()),
  );
  if (
    schedulerProfile === STABILISATION_SCHEDULER_PROFILE &&
    activePublishJobs.length > 0
  ) {
    blockers.push("stabilisation_publish_job_already_active");
  }

  const atMs = Date.parse(generatedAt);
  const activeSchedulerOwners = unique(
    (snapshot?.runtime_leases || [])
      .filter(
        (lease) =>
          lease?.name === "scheduler:primary" &&
          Number.isFinite(Date.parse(lease.expires_at)) &&
          Date.parse(lease.expires_at) > atMs,
      )
      .map((lease) => String(lease.owner_id || "").trim()),
  );
  if (activeSchedulerOwners.length !== 1) {
    blockers.push("single_scheduler_owner_not_proven");
  }

  const cutoffMs = atMs - 24 * 60 * 60 * 1000;
  const recentPublications = new Map();
  const recordPublication = (externalId, publishedAt) => {
    const key = String(externalId || "").trim();
    if (
      !key ||
      !Number.isFinite(publishedAt) ||
      publishedAt <= cutoffMs
    ) {
      return;
    }
    const previous = recentPublications.get(key);
    if (previous === undefined || publishedAt < previous) {
      recentPublications.set(key, publishedAt);
    }
  };
  const cadencePlatformPosts =
    snapshot?.cadence_platform_posts || snapshot?.platform_posts || [];
  for (const post of cadencePlatformPosts) {
    if (
      String(post?.platform || "").toLowerCase() !== "youtube" ||
      String(post?.status || "").toLowerCase() !== "published" ||
      !String(post?.external_id || "").trim()
    ) {
      continue;
    }
    const publishedAt = Date.parse(post.published_at || post.updated_at);
    recordPublication(post.external_id, publishedAt);
  }
  const cadenceDispatchLedger =
    snapshot?.cadence_dispatch_ledger ||
    snapshot?.dispatch_ledger ||
    [];
  for (const event of cadenceDispatchLedger) {
    if (
      String(event?.platform || "").toLowerCase() !== "youtube" ||
      String(event?.event_type || "").toUpperCase() !== "PUBLISHED" ||
      String(event?.verification_status || "").toLowerCase() !==
        "confirmed"
    ) {
      continue;
    }
    let externalId = event.external_id;
    if (!String(externalId || "").trim()) {
      try {
        const evidence =
          typeof event.verification_evidence_json === "string"
            ? JSON.parse(event.verification_evidence_json)
            : event.verification_evidence_json;
        externalId = evidence?.external_id;
      } catch {
        externalId = null;
      }
    }
    recordPublication(externalId, Date.parse(event.created_at));
  }
  const publicationTimes = [...recentPublications.values()].sort(
    (left, right) => right - left,
  );
  if (publicationTimes.length >= 2) {
    blockers.push("stabilisation_rolling_publish_limit");
  }
  if (
    publicationTimes[0] !== undefined &&
    atMs - publicationTimes[0] < 4 * 60 * 60 * 1000
  ) {
    blockers.push("stabilisation_minimum_publish_gap");
  }
  return unique(blockers);
}

function evaluateCandidate(story, evidence = {}) {
  const blockers = [];
  const channelId = story?.channel_id || "pulse-gaming";
  if (!(story?.approved === true || story?.approved === 1)) {
    blockers.push("editorial_approval_required");
  }
  if (!String(story?.full_script || "").trim()) {
    blockers.push("final_script_required");
  }
  if (!String(story?.exported_path || "").trim()) {
    blockers.push("final_render_required");
  }
  if (story?.qa_failed === true || story?.qa_failed === 1) {
    blockers.push("story_has_unresolved_qa_failure");
  }
  if (String(story?.youtube_post_id || "").trim()) {
    blockers.push("youtube_already_projected");
  }
  const humanReview = evaluateStoryHumanReview(story);
  if (!humanReview.approved) blockers.push(humanReview.blocker);
  for (const [field, code] of [
    ["source_evidence_sha256", "source_evidence_hash_required"],
    ["qa_report_sha256", "qa_report_hash_required"],
  ]) {
    if (!SHA256_PATTERN.test(String(evidence?.[field] || ""))) {
      blockers.push(code);
    }
  }
  const evidenceAssessment = assessPublicationEvidence(evidence);
  blockers.push(...evidenceAssessment.blockers);
  const rendererEvaluation = evaluateRendererManifest(
    evidence?.renderer_manifest,
    { operatingMode: "LOCAL_PROOF" },
  );
  blockers.push(...rendererEvaluation.blockers);
  if (rendererEvaluation.verdict !== "PASS") {
    blockers.push("governed_standard_renderer_required");
  }
  if (
    !SHA256_PATTERN.test(
      String(evidence?.renderer_manifest_sha256 || ""),
    )
  ) {
    blockers.push("renderer_manifest_hash_required");
  } else if (
    String(evidence.renderer_manifest_sha256).toLowerCase() !==
    rendererEvaluation.manifest_sha256
  ) {
    blockers.push("renderer_manifest_hash_mismatch");
  }
  if (
    String(evidence?.renderer_manifest?.story_id || "") !==
    String(story?.id || "")
  ) {
    blockers.push("renderer_story_identity_mismatch");
  }
  if (
    String(evidence?.renderer_manifest?.channel_id || "") !==
    String(channelId)
  ) {
    blockers.push("renderer_channel_identity_mismatch");
  }
  for (const key of REQUIRED_ARTIFACT_EVIDENCE) {
    if (evidence?.artifact_evidence?.[key] !== true) {
      blockers.push(`artifact_evidence_required:${key}`);
    }
  }
  return {
    story_id: story?.id || null,
    title: String(story?.title || "").slice(0, 160),
    channel_id: channelId,
    platform: "youtube",
    breaking_score: Number(story?.breaking_score || story?.score || 0),
    preflight_verdict: blockers.length ? "HOLD" : "PASS",
    blockers: unique(blockers),
    evidence: {
      human_review: humanReview.status,
      rights_eligible: evidenceAssessment.eligible,
      renderer_verdict: rendererEvaluation.verdict,
      renderer_id: rendererEvaluation.renderer.id,
      renderer_manifest_sha256: rendererEvaluation.manifest_sha256,
      artifact_evidence_complete: REQUIRED_ARTIFACT_EVIDENCE.every(
        (key) => evidence?.artifact_evidence?.[key] === true,
      ),
    },
  };
}

function buildNextPublishCandidatesReport({
  snapshot,
  env = process.env,
  generatedAt = new Date().toISOString(),
  sourceCommitSha = null,
  runtimeCommitSha = null,
} = {}) {
  const operatingContract = resolveOperatingContract({ env });
  const schedulerProfile = resolveSchedulerProfile(env);
  const candidates = (snapshot?.stories || [])
    .filter(
      (story) =>
        story &&
        !String(story.youtube_post_id || "").trim() &&
        ((story.approved === true || story.approved === 1) ||
          String(story.exported_path || "").trim()),
    )
    .map((story) =>
      evaluateCandidate(
        story,
        snapshot?.evidence_by_story?.[String(story.id)] || {},
      ),
    )
    .sort((left, right) => {
      if (
        (left.preflight_verdict === "PASS") !==
        (right.preflight_verdict === "PASS")
      ) {
        return left.preflight_verdict === "PASS" ? -1 : 1;
      }
      if (left.breaking_score !== right.breaking_score) {
        return right.breaking_score - left.breaking_score;
      }
      return String(left.story_id).localeCompare(String(right.story_id));
    });
  const bindingRows = Array.isArray(
    snapshot?.scheduled_dispatch_bindings,
  )
    ? snapshot.scheduled_dispatch_bindings
    : [];
  const nextCandidate =
    schedulerProfile === GOVERNED_MULTI_LANE_SCHEDULER_PROFILE
      ? bindingRows.length === 1
        ? candidates.find(
            (candidate) =>
              String(candidate.story_id || "") ===
              String(bindingRows[0]?.story_id || ""),
          ) || null
        : null
      : candidates[0] || null;
  const globalBlockers = buildSchedulerBlockers({
    snapshot,
    generatedAt,
    sourceCommitSha,
    runtimeCommitSha,
    schedulerProfile,
  });
  const governedScheduler =
    schedulerProfile === GOVERNED_MULTI_LANE_SCHEDULER_PROFILE
      ? buildGovernedSchedulerContract({
          snapshot,
          operatingContract,
          nextCandidate,
          generatedAt,
        })
      : null;
  globalBlockers.push(...(governedScheduler?.blockers || []));
  globalBlockers.push(...operatingContract.blockers);
  if (
    schedulerProfile !== GOVERNED_MULTI_LANE_SCHEDULER_PROFILE &&
    operatingContract.mode !== "LOCAL_PROOF"
  ) {
    globalBlockers.push("preflight_requires_local_proof_mode");
  }
  for (const error of snapshot?.source?.errors || []) {
    globalBlockers.push(`snapshot_source:${error}`);
  }
  if (!nextCandidate) globalBlockers.push("no_publish_candidate");
  const blockers = unique([
    ...globalBlockers,
    ...(nextCandidate?.blockers || []),
  ]);
  const schedulerReady =
    blockers.length === 0 &&
    nextCandidate?.preflight_verdict === "PASS";
  const metadata = preflightMetadata({
    generatedAt,
    sourceCommitSha,
    runtimeCommitSha,
    environment: `${operatingContract.mode} read-only snapshot`,
    scope:
      "YouTube candidate, scheduler, cadence and governed evidence preflight",
  });
  return {
    schema_version: "pulse-next-publish-candidates-v1",
    ...metadata,
    mode: operatingContract.mode,
    scheduler_profile: schedulerProfile,
    scheduler_contract: governedScheduler?.contract || null,
    snapshot: {
      kind: snapshot?.source?.kind || "unknown",
      read_only: snapshot?.source?.read_only === true,
      story_count: snapshot?.stories?.length || 0,
      database_file_unchanged:
        snapshot?.source?.database_file_unchanged ?? null,
      read_transaction_committed:
        snapshot?.source?.read_transaction_committed ?? null,
      transaction_consistent:
        snapshot?.source?.transaction_consistent ?? null,
      data_version_before:
        snapshot?.source?.data_version_before ?? null,
      data_version_after:
        snapshot?.source?.data_version_after ?? null,
    },
    verdict: schedulerReady ? "PASS" : "HOLD",
    scheduler_ready: schedulerReady,
    publish_authorised: false,
    candidates,
    next_candidate: nextCandidate,
    blockers,
    safety: {
      external_calls: [],
      production_database_mutated: false,
      oauth_or_tokens_mutated: false,
      platform_objects_created: false,
    },
  };
}

function renderNextPublishCandidatesMarkdown(report) {
  const lines = [
    "# Next Publish Candidates",
    "",
    `Generated: ${report.generated_at}`,
    `Mode: ${report.mode}`,
    `Verdict: ${report.verdict}`,
    `Scheduler profile: ${report.scheduler_profile}`,
    `Scheduler ready: ${report.scheduler_ready ? "yes" : "no"}`,
    "Publish authorised: no",
    "",
  ];
  if (report.scheduler_contract) {
    const contract = report.scheduler_contract;
    lines.push(
      "## Governed scheduler contract",
      "",
      `Strategy: ${contract.strategy}`,
      `Runway schedules: ${contract.runway_schedule_contract.verdict} (${contract.runway_schedule_contract.schedule_count}/4 exact recurring checkpoints)`,
      `T-15/T0 recurring schedules: ${contract.one_shot_job_contract.recurring_schedule_count} (required: 0; durable jobs only)`,
      `Generic publish schedules: ${contract.generic_publish_schedules.enabled_count} (required: no)`,
      `Generic publish jobs: ${contract.generic_publish_jobs.active_count} (required: no)`,
      `Exact scheduled binding: ${contract.exact_scheduled_dispatch_binding.valid ? "PASS" : "HOLD"}`,
      `Human review required: ${contract.human_review.required ? "yes" : "no"}`,
      `Live authority proven: ${contract.live_authority.proven ? "yes" : "no"}`,
      "",
      "Allowed recurring YouTube admission windows:",
      "",
    );
    for (const window of contract.recurring_youtube_windows) {
      lines.push(`- ${window.utc_time} UTC (${window.cron_expr})`);
    }
    lines.push("");
  }
  lines.push("## Blockers", "");
  if (report.blockers.length === 0) lines.push("- none");
  else for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  lines.push(
    "",
    `> ${report.mode} preflight evidence is read-only and is not publication authority.`,
    "",
  );
  return lines.join("\n");
}

const PLATFORM_DISPLAY_NAMES = Object.freeze({
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  x: "X",
  threads: "Threads",
  pinterest: "Pinterest",
});

const PLATFORM_CREDENTIAL_KEYS = Object.freeze({
  youtube: [
    "YOUTUBE_REFRESH_TOKEN",
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET",
  ],
  instagram: [
    "INSTAGRAM_ACCESS_TOKEN",
    "INSTAGRAM_BUSINESS_ACCOUNT_ID",
  ],
  facebook: ["FACEBOOK_PAGE_TOKEN", "FACEBOOK_PAGE_ID"],
  tiktok: ["TIKTOK_ACCESS_TOKEN", "TIKTOK_CLIENT_KEY"],
  x: [
    "TWITTER_API_KEY",
    "TWITTER_API_SECRET",
    "TWITTER_ACCESS_TOKEN",
    "TWITTER_ACCESS_SECRET",
  ],
  threads: [],
  pinterest: [],
});

function credentialPresence(env, platform) {
  const keys = PLATFORM_CREDENTIAL_KEYS[platform] || [];
  const present = keys.filter(
    (key) => String(env?.[key] || "").trim().length > 0,
  );
  return {
    required_key_count: keys.length,
    present_key_count: present.length,
    complete: keys.length > 0 && present.length === keys.length,
  };
}

function platformPostCounts(snapshot, platform) {
  const aliases = {
    instagram: new Set(["instagram", "instagram_reel"]),
    facebook: new Set(["facebook", "facebook_reel"]),
    x: new Set(["x", "twitter", "twitter_video"]),
  };
  const accepted = aliases[platform] || new Set([platform]);
  const counts = {};
  for (const post of snapshot?.platform_posts || []) {
    if (!accepted.has(String(post?.platform || "").toLowerCase())) continue;
    const status = String(post?.status || "unknown").toLowerCase();
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function buildPlatformDoctorReport({
  snapshot,
  env = process.env,
  generatedAt = new Date().toISOString(),
  sourceCommitSha = null,
  runtimeCommitSha = null,
} = {}) {
  const contract = resolveOperatingContract({ env });
  const blockers = [...contract.blockers];
  if (contract.mode !== "LOCAL_PROOF") {
    blockers.push("preflight_requires_local_proof_mode");
  }
  if (snapshot?.source?.read_only !== true) {
    blockers.push("read_only_snapshot_required");
  }
  for (const error of snapshot?.source?.errors || []) {
    blockers.push(`snapshot_source:${error}`);
  }
  if (!COMMIT_PATTERN.test(String(sourceCommitSha || ""))) {
    blockers.push("source_commit_sha_required");
  }
  if (!COMMIT_PATTERN.test(String(runtimeCommitSha || ""))) {
    blockers.push("runtime_commit_sha_required");
  } else if (
    String(sourceCommitSha).toLowerCase() !==
    String(runtimeCommitSha).toLowerCase()
  ) {
    blockers.push("source_runtime_commit_mismatch");
  }

  const platforms = Object.entries(PLATFORM_POLICY).map(
    ([platform, policy]) => {
      const credentials = credentialPresence(env, platform);
      return {
        platform,
        display_name: PLATFORM_DISPLAY_NAMES[platform] || platform,
        visible: policy.visible === true,
        automation: policy.automation,
        phase: policy.phase,
        credentials,
        observed_platform_posts: platformPostCounts(snapshot, platform),
        adapter_state: "UNVERIFIED",
        authentication_state: "UNVERIFIED",
        eligibility_state: "UNVERIFIED",
        publishable: false,
        publishability_reason:
          platform === "youtube"
            ? "local_proof_and_governed_approval_required"
            : policy.automation === "manual_only"
              ? "manual_only_during_stabilisation"
              : "automation_disabled_during_stabilisation",
      };
    },
  );
  const metadata = preflightMetadata({
    generatedAt,
    sourceCommitSha,
    runtimeCommitSha,
    scope:
      "Stabilisation platform policy and sanitised local configuration presence",
  });
  return {
    schema_version: "pulse-platform-doctor-v1",
    ...metadata,
    mode: contract.mode,
    verdict: blockers.length ? "HOLD" : "PASS",
    publish_authorised: false,
    snapshot: {
      kind: snapshot?.source?.kind || "unknown",
      read_only: snapshot?.source?.read_only === true,
    },
    platform_policy_version: contract.contract_version,
    platforms,
    blockers: unique(blockers),
    advisory: contract.advisory,
    safety: {
      credential_values_emitted: false,
      external_calls: [],
      production_database_mutated: false,
      oauth_or_tokens_mutated: false,
      platform_objects_created: false,
    },
  };
}

function renderPlatformDoctorMarkdown(report) {
  const lines = [
    "# Platform Doctor",
    "",
    `Generated: ${report.generated_at}`,
    `Mode: ${report.mode}`,
    `Verdict: ${report.verdict}`,
    "Publish authorised: no",
    "",
    "| Platform | Visible | Automation | Credentials | Publishable | Reason |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const platform of report.platforms) {
    lines.push(
      `| ${platform.display_name} | ${platform.visible ? "yes" : "no"} | ` +
        `${platform.automation} | ` +
        `${platform.credentials.present_key_count}/${platform.credentials.required_key_count} present | ` +
        `${platform.publishable ? "yes" : "no"} | ` +
        `${platform.publishability_reason} |`,
    );
  }
  lines.push("", "## Blockers", "");
  if (report.blockers.length === 0) lines.push("- none");
  else for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  lines.push(
    "",
    "> Credential values were not read into this report. LOCAL_PROOF does not establish authentication, eligibility or publication authority.",
    "",
  );
  return lines.join("\n");
}

function buildGoalDryRunPublishReport({
  snapshot,
  env = process.env,
  generatedAt = new Date().toISOString(),
  sourceCommitSha = null,
  runtimeCommitSha = null,
} = {}) {
  const candidateReport = buildNextPublishCandidatesReport({
    snapshot,
    env,
    generatedAt,
    sourceCommitSha,
    runtimeCommitSha,
  });
  const platformReport = buildPlatformDoctorReport({
    snapshot,
    env,
    generatedAt,
    sourceCommitSha,
    runtimeCommitSha,
  });
  const selectedCandidate = candidateReport.next_candidate;
  const blockers = unique([
    ...candidateReport.blockers,
    ...platformReport.blockers,
  ]);
  const packageReady =
    candidateReport.scheduler_ready === true &&
    selectedCandidate?.preflight_verdict === "PASS" &&
    blockers.length === 0;
  const platformPlan = platformReport.platforms.map((platform) => ({
    platform: platform.platform,
    action:
      platform.platform === "youtube"
        ? packageReady
          ? "PLAN_HUMAN_REVIEWED_DISPATCH"
          : "HOLD_PREFLIGHT"
        : "SKIP_POLICY",
    reason:
      platform.platform === "youtube"
        ? packageReady
          ? "dry_run_package_only"
          : "candidate_or_scheduler_preflight_blocked"
        : platform.publishability_reason,
    external_action_executed: false,
  }));
  const metadata = preflightMetadata({
    generatedAt,
    sourceCommitSha,
    runtimeCommitSha,
    scope:
      "Strict YouTube-only dry-run package plan before the external create boundary",
  });
  return {
    schema_version: "pulse-goal-dry-run-publish-v1",
    ...metadata,
    execution_mode: "DRY_RUN_PUBLISH",
    operating_mode: candidateReport.mode,
    verdict: packageReady ? "PASS" : "HOLD",
    package_ready: packageReady,
    scheduler_ready: candidateReport.scheduler_ready,
    publish_authorised: false,
    target_platform: "youtube",
    selected_candidate: selectedCandidate,
    platform_plan: platformPlan,
    planned_steps: [
      {
        step: "validate_read_only_snapshot",
        result: snapshot?.source?.read_only === true ? "PASS" : "HOLD",
      },
      {
        step: "evaluate_scheduler_candidate",
        result: candidateReport.scheduler_ready ? "PASS" : "HOLD",
      },
      {
        step: "evaluate_stabilisation_platform_policy",
        result: platformReport.verdict,
      },
      {
        step: "materialise_local_package_plan",
        result: packageReady ? "PASS" : "HOLD",
      },
      {
        step: "stop_before_external_create_boundary",
        result: "ENFORCED",
      },
    ],
    blockers,
    safety: {
      dry_run: true,
      external_calls: [],
      production_database_mutated: false,
      oauth_or_tokens_mutated: false,
      platform_objects_created: false,
      uploader_modules_loaded: false,
    },
    limitations: [
      "A dry-run package is not scheduler publication authority",
      "Scheduler readiness is not platform authentication or eligibility proof",
      "No live platform object was created or verified",
    ],
  };
}

function renderGoalDryRunPublishMarkdown(report) {
  const lines = [
    "# Goal Dry-Run Publish",
    "",
    `Generated: ${report.generated_at}`,
    `Execution mode: ${report.execution_mode}`,
    `Operating mode: ${report.operating_mode}`,
    `Verdict: ${report.verdict}`,
    `Package ready: ${report.package_ready ? "yes" : "no"}`,
    `Scheduler ready: ${report.scheduler_ready ? "yes" : "no"}`,
    "Publish authorised: no",
    "",
    "## Selected candidate",
    "",
  ];
  if (report.selected_candidate) {
    lines.push(
      `- ${report.selected_candidate.story_id}: ${report.selected_candidate.title}`,
      `- Preflight: ${report.selected_candidate.preflight_verdict}`,
    );
  } else {
    lines.push("- none");
  }
  lines.push(
    "",
    "## Platform plan",
    "",
    "| Platform | Action | Reason | External action |",
    "| --- | --- | --- | --- |",
  );
  for (const entry of report.platform_plan) {
    lines.push(
      `| ${PLATFORM_DISPLAY_NAMES[entry.platform] || entry.platform} | ` +
        `${entry.action} | ${entry.reason} | no |`,
    );
  }
  lines.push("", "## Blockers", "");
  if (report.blockers.length === 0) lines.push("- none");
  else for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  lines.push(
    "",
    "> This DRY_RUN_PUBLISH package is local evidence, not publication authority. No uploader or external create boundary was entered.",
    "",
  );
  return lines.join("\n");
}

function writeProofArtifacts({
  outDir,
  stem,
  report,
  markdown,
} = {}) {
  if (!outDir) throw new Error("out_dir_required");
  const resolved = path.resolve(outDir);
  fs.mkdirSync(resolved, { recursive: true });
  const jsonPath = path.join(resolved, `${stem}.json`);
  const markdownPath = path.join(resolved, `${stem}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, markdown, "utf8");
  return { jsonPath, markdownPath };
}

module.exports = {
  buildGoalDryRunPublishReport,
  buildNextPublishCandidatesReport,
  buildPlatformDoctorReport,
  loadReadOnlySnapshot,
  parseCliArgs,
  readSnapshot,
  readSqliteSnapshot,
  renderGoalDryRunPublishMarkdown,
  renderNextPublishCandidatesMarkdown,
  renderPlatformDoctorMarkdown,
  resolvePreflightProvenance,
  writeProofArtifacts,
};

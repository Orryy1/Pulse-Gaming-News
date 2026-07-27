"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  sqliteMutationBoundaryBlockers,
  verifyBackupEvidence,
  withReadOnlySqliteSnapshot,
} = require("./stabilisation-cutover-reconcile");
const governanceFactory = require("../repositories/publication_governance");
const {
  reconcileGovernedReviewedContentQa,
  resolveGovernedReviewedContentQaAuthority,
} = require("../services/governed-reviewed-content-qa");
const { runContentQa } = require("../services/content-qa");

const RESULT_SCHEMA_VERSION = "pulse-governed-reviewed-qa-repair-result-v1";
const PLATFORM = "youtube";
const CHANNEL_ID = "pulse-gaming";
const SCHEDULE_EXPIRY_MS = 15 * 60 * 1000;
const GENERATED_AT_MAX_SKEW_MS = 5 * 60 * 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FULL_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const EXPECTED_QA_PUBLISH_ERROR =
  "qa_blocked: legacy_unstamped_render_requires_rerender";
const SECONDARY_AUTOMATION_FLAGS = Object.freeze([
  "TIKTOK_ENABLED",
  "TIKTOK_AUTO_PUBLISH",
  "INSTAGRAM_AUTO_PUBLISH",
  "FACEBOOK_AUTO_PUBLISH",
  "TWITTER_ENABLED",
  "X_AUTO_PUBLISH",
  "THREADS_AUTO_PUBLISH",
  "PINTEREST_AUTO_PUBLISH",
]);

function text(value) {
  return String(value || "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function samePath(left, right) {
  if (!text(left) || !text(right)) return false;
  return (
    path.resolve(left).replace(/\\/g, "/").toLowerCase() ===
    path.resolve(right).replace(/\\/g, "/").toLowerCase()
  );
}

function truthy(value) {
  return value === true || /^(true|1|yes|on)$/i.test(text(value));
}

function explicitFalse(value) {
  return value === false || /^(false|0|no|off)$/i.test(text(value));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseObject(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function qaPublishErrorPersistenceShape(rawStory) {
  if (
    text(rawStory?.publish_error) !== EXPECTED_QA_PUBLISH_ERROR
  ) {
    return null;
  }
  const storedExtra = parseObject(rawStory?._extra);
  if (
    !Object.prototype.hasOwnProperty.call(storedExtra, "publish_error")
  ) {
    return "top_level_only";
  }
  return text(storedExtra.publish_error) === EXPECTED_QA_PUBLISH_ERROR
    ? "mirrored_exact"
    : null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashFileSync(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function isRuntimeTreeClean(
  cwd,
  { execFileSyncImpl = execFileSync } = {},
) {
  try {
    const output = String(
      execFileSyncImpl(
        "git",
        ["status", "--porcelain", "--untracked-files=normal"],
        {
          cwd,
          encoding: "utf8",
          timeout: 2000,
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        },
      ) || "",
    ).trim();
    return output === "";
  } catch {
    return false;
  }
}

function tableExists(db, tableName) {
  return !!db
    .prepare(
      `SELECT 1 FROM sqlite_master
       WHERE type = 'table' AND name = ? LIMIT 1`,
    )
    .get(tableName);
}

function rowToStory(row) {
  if (!row) return null;
  const extra = parseObject(row._extra);
  return {
    ...row,
    ...extra,
    approved: row.approved === 1 || row.approved === true,
    auto_approved:
      row.auto_approved === 1 || row.auto_approved === true,
  };
}

function inspectOpenDatabase(db, storyId, generatedAt) {
  const requiredTables = [
    "stories",
    "operator_audit_log",
    "platform_publication_state",
    "publication_lifecycle_events",
    "platform_dispatch_ledger",
    "platform_posts",
    "runtime_leases",
    "jobs",
    "workers",
  ];
  const missingTables = requiredTables.filter(
    (tableName) => !tableExists(db, tableName),
  );
  if (missingTables.length) {
    return {
      missing_tables: missingTables,
      story: null,
      raw_story: null,
    };
  }
  const rawStory = db
    .prepare("SELECT * FROM stories WHERE id = ?")
    .get(storyId);
  const state = db
    .prepare(
      `SELECT * FROM platform_publication_state
       WHERE story_id = ? AND platform = ?`,
    )
    .get(storyId, PLATFORM);
  const scheduled = db
    .prepare(
      `SELECT * FROM publication_lifecycle_events
       WHERE story_id = ? AND platform = ? AND to_state = 'SCHEDULED'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(storyId, PLATFORM);
  const laterLifecycleCount = scheduled
    ? db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM publication_lifecycle_events
           WHERE story_id = ? AND platform = ? AND id > ?`,
        )
        .get(storyId, PLATFORM, scheduled.id).count
    : null;
  const latestLifecycle = db
    .prepare(
      `SELECT * FROM publication_lifecycle_events
       WHERE story_id = ? AND platform = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(storyId, PLATFORM);
  const dispatchLedgerCount = db
    .prepare(
      `SELECT COUNT(*) AS count FROM platform_dispatch_ledger
       WHERE story_id = ? AND platform = ?`,
    )
    .get(storyId, PLATFORM).count;
  const platformPostCount = db
    .prepare(
      `SELECT COUNT(*) AS count FROM platform_posts
       WHERE story_id = ? AND platform = ?`,
    )
    .get(storyId, PLATFORM).count;
  const reviewAudit = db
    .prepare(
      `SELECT * FROM operator_audit_log
       WHERE action = 'governed_publication_review'
         AND target_type = 'story'
         AND target_id = ?
         AND decision = 'HUMAN_RENDER_APPROVED'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(storyId);
  const activeRuntimeLeaseCount = db
    .prepare(
      `SELECT COUNT(*) AS count FROM runtime_leases
       WHERE expires_at IS NULL
          OR julianday(expires_at) IS NULL
          OR julianday(expires_at) > julianday(?)`,
    )
    .get(generatedAt).count;
  const runningJobCount = db
    .prepare(
      `SELECT COUNT(*) AS count FROM jobs
       WHERE status IN ('claimed', 'running')`,
    )
    .get().count;
  const activeWorkerCount = db
    .prepare(
      `SELECT COUNT(*) AS count FROM workers
       WHERE COALESCE(status, '') NOT IN ('offline', 'locked')`,
    )
    .get().count;
  return {
    missing_tables: [],
    raw_story: rawStory || null,
    story: rowToStory(rawStory),
    state: state || null,
    scheduled: scheduled || null,
    scheduled_evidence: parseObject(scheduled?.evidence_json),
    later_lifecycle_count: Number(laterLifecycleCount || 0),
    latest_lifecycle: latestLifecycle || null,
    dispatch_ledger_count: Number(dispatchLedgerCount || 0),
    platform_post_count: Number(platformPostCount || 0),
    review_audit: reviewAudit || null,
    review_audit_evidence: parseObject(reviewAudit?.evidence_json),
    active_runtime_lease_count: Number(activeRuntimeLeaseCount || 0),
    running_job_count: Number(runningJobCount || 0),
    active_worker_count: Number(activeWorkerCount || 0),
  };
}

function scheduledDispatchFromInspection(inspection) {
  const event = inspection.scheduled;
  const evidence = inspection.scheduled_evidence;
  return {
    event,
    evidence,
    idempotencyKey: text(evidence.dispatch_idempotency_key),
    requestFingerprint: lower(evidence.request_fingerprint),
    publicationEvidence: evidence.publication_evidence,
    scheduledFor: new Date(evidence.scheduled_for).toISOString(),
  };
}

function exactBindingFromInspection(inspection) {
  const scheduled = scheduledDispatchFromInspection(inspection);
  return {
    storyId: inspection.story.id,
    platform: PLATFORM,
    scheduledFor: scheduled.scheduledFor,
    scheduledEventId: String(scheduled.event.id),
    dispatchIdempotencyKey: scheduled.idempotencyKey,
    requestFingerprint: scheduled.requestFingerprint,
  };
}

function environmentBlockers(env = {}) {
  const blockers = [];
  const mode = text(env.PULSE_OPERATING_MODE || env.OPERATING_MODE);
  if (mode !== "HUMAN_REVIEW") {
    blockers.push("human_review_operating_mode_required");
  }
  if (
    (env.PULSE_OPERATING_MODE &&
      text(env.PULSE_OPERATING_MODE) !== "HUMAN_REVIEW") ||
    (env.OPERATING_MODE &&
      text(env.OPERATING_MODE) !== "HUMAN_REVIEW")
  ) {
    blockers.push("operating_mode_conflict");
  }
  if (!explicitFalse(env.AUTO_PUBLISH)) {
    blockers.push("auto_publish_must_be_false");
  }
  if (!explicitFalse(env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED)) {
    blockers.push("guarded_live_dispatch_must_be_false");
  }
  if (
    !truthy(env.PULSE_EMERGENCY_KILL_SWITCH) &&
    !truthy(env.PULSE_KILL_SWITCH)
  ) {
    blockers.push("emergency_kill_switch_required");
  }
  if (!truthy(env.PULSE_CUTOVER_SCHEDULER_STOPPED)) {
    blockers.push("stopped_scheduler_confirmation_required");
  }
  if (!truthy(env.PULSE_CUTOVER_WORKERS_STOPPED)) {
    blockers.push("stopped_workers_confirmation_required");
  }
  if (!truthy(env.USE_SQLITE) || !truthy(env.USE_JOB_QUEUE)) {
    blockers.push("durable_sqlite_queue_required");
  }
  if (!explicitFalse(env.PULSE_PRIMARY_INSTANCE)) {
    blockers.push("primary_instance_must_be_false");
  }
  if (SECONDARY_AUTOMATION_FLAGS.some((key) => truthy(env[key]))) {
    blockers.push("secondary_platform_automation_must_be_false");
  }
  return unique(blockers);
}

function inspectionBlockers(inspection, generatedAt) {
  const blockers = [];
  if (inspection.missing_tables.length) {
    blockers.push(
      ...inspection.missing_tables.map(
        (tableName) => `required_table_missing:${tableName}`,
      ),
    );
    return blockers;
  }
  const story = inspection.story;
  if (!story) return ["publication_story_not_found"];
  if (text(story.channel_id || CHANNEL_ID) !== CHANNEL_ID) {
    blockers.push("publication_story_channel_mismatch");
  }
  if (story.qa_failed !== true || story.publish_status !== "failed") {
    blockers.push("exact_persisted_qa_failure_required");
  }
  if (!qaPublishErrorPersistenceShape(inspection.raw_story)) {
    blockers.push("exact_qa_publish_error_required");
  }
  if (
    inspection.state?.lifecycle_state !== "SCHEDULED" ||
    !inspection.scheduled
  ) {
    blockers.push("expired_scheduled_admission_required");
  }
  const scheduledFor = Date.parse(
    inspection.scheduled_evidence?.scheduled_for,
  );
  const generatedMs = Date.parse(generatedAt);
  if (
    !Number.isFinite(scheduledFor) ||
    !Number.isFinite(generatedMs) ||
    generatedMs - scheduledFor <= SCHEDULE_EXPIRY_MS
  ) {
    blockers.push("scheduled_admission_not_expired");
  }
  if (
    inspection.later_lifecycle_count !== 0 ||
    inspection.latest_lifecycle?.id !== inspection.scheduled?.id ||
    inspection.dispatch_ledger_count !== 0 ||
    inspection.platform_post_count !== 0 ||
    text(inspection.state?.external_id) ||
    text(inspection.state?.external_url) ||
    text(story.youtube_post_id) ||
    text(story.youtube_url)
  ) {
    blockers.push("create_boundary_not_clear");
  }
  if (
    inspection.active_runtime_lease_count !== 0 ||
    inspection.running_job_count !== 0 ||
    inspection.active_worker_count !== 0
  ) {
    blockers.push("stopped_runtime_database_state_required");
  }
  const review = story.final_publication_review;
  const audit = inspection.review_audit_evidence;
  if (
    !inspection.review_audit ||
    sha256(JSON.stringify(stableValue(audit))) !==
      sha256(JSON.stringify(stableValue(review || {})))
  ) {
    blockers.push("immutable_publication_review_audit_required");
  }
  return unique(blockers);
}

function exactQaFailureBlockers(story, authority, contentQa, reconciled) {
  const expected = [
    "legacy_unstamped_render_requires_rerender",
    `script_too_short (${authority.runtime.word_count} words, min 80)`,
  ];
  const persisted = Array.isArray(story.qa_failures)
    ? story.qa_failures.slice()
    : [];
  const observed = Array.isArray(contentQa.failures)
    ? contentQa.failures.slice()
    : [];
  const sort = (values) => values.slice().sort();
  const blockers = [];
  if (
    JSON.stringify(sort(persisted)) !== JSON.stringify(sort(expected)) ||
    JSON.stringify(sort(observed)) !== JSON.stringify(sort(expected))
  ) {
    blockers.push("exact_resolved_qa_failures_required");
  }
  if (
    reconciled.failures.length !== 0 ||
    JSON.stringify(sort(reconciled.resolved)) !==
      JSON.stringify(sort(expected))
  ) {
    blockers.push("reviewed_content_qa_not_clean");
  }
  return blockers;
}

function confirmationBlockers(options, plan) {
  const blockers = [];
  for (const [actual, expected, code] of [
    [
      text(options.confirmStoryId),
      plan.story_id,
      "exact_story_confirmation_required",
    ],
    [
      String(options.confirmScheduledEventId ?? ""),
      String(plan.scheduled_event_id),
      "exact_scheduled_event_confirmation_required",
    ],
    [
      text(options.confirmDispatchIdempotencyKey),
      plan.dispatch_idempotency_key,
      "exact_dispatch_key_confirmation_required",
    ],
    [
      lower(options.confirmRequestFingerprint),
      plan.request_fingerprint,
      "exact_request_fingerprint_confirmation_required",
    ],
    [
      lower(options.confirmMediaSha256),
      plan.media_sha256,
      "exact_media_sha256_confirmation_required",
    ],
    [
      lower(options.confirmScriptSha256),
      plan.script_sha256,
      "exact_script_sha256_confirmation_required",
    ],
    [
      lower(options.confirmReviewManifestSha256),
      plan.review_manifest_sha256,
      "exact_review_manifest_sha256_confirmation_required",
    ],
  ]) {
    if (!actual || actual !== expected) blockers.push(code);
  }
  if (!text(options.actorId)) blockers.push("operator_actor_required");
  if (!text(options.reason)) blockers.push("operator_reason_required");
  if (
    !text(options.confirmActorId) ||
    text(options.confirmActorId) !== text(options.actorId)
  ) {
    blockers.push("exact_operator_actor_confirmation_required");
  }
  if (
    !text(options.confirmReason) ||
    text(options.confirmReason) !== text(options.reason)
  ) {
    blockers.push("exact_operator_reason_confirmation_required");
  }
  if (
    !text(options.confirmDatabasePath) ||
    !samePath(options.confirmDatabasePath, plan.database_path)
  ) {
    blockers.push("exact_database_path_confirmation_required");
  }
  if (
    !text(options.changeWindowId) ||
    !text(options.confirmChangeWindowId) ||
    text(options.changeWindowId) !==
      text(options.confirmChangeWindowId)
  ) {
    blockers.push("exact_change_window_confirmation_required");
  }
  return unique(blockers);
}

function boundaryFingerprint(inspection) {
  return sha256(
    JSON.stringify(
      stableValue({
        raw_story: inspection.raw_story || null,
        state: inspection.state || null,
        scheduled: inspection.scheduled || null,
        scheduled_evidence: inspection.scheduled_evidence || null,
        latest_lifecycle: inspection.latest_lifecycle || null,
        later_lifecycle_count: inspection.later_lifecycle_count,
        dispatch_ledger_count: inspection.dispatch_ledger_count,
        platform_post_count: inspection.platform_post_count,
        review_audit: inspection.review_audit || null,
        review_audit_evidence:
          inspection.review_audit_evidence || null,
        active_runtime_lease_count:
          inspection.active_runtime_lease_count,
        running_job_count: inspection.running_job_count,
        active_worker_count: inspection.active_worker_count,
      }),
    ),
  );
}

function historicalSafety(inspection) {
  if (!inspection || inspection.missing_tables?.length) {
    return {
      create_boundary_entered: null,
      external_object_created: null,
    };
  }
  if (!inspection.story || !inspection.state || !inspection.scheduled) {
    return {
      create_boundary_entered: null,
      external_object_created: null,
    };
  }
  const createBoundaryEntered =
    Number(inspection.later_lifecycle_count || 0) > 0 ||
    Number(inspection.dispatch_ledger_count || 0) > 0 ||
    Number(inspection.platform_post_count || 0) > 0 ||
    Boolean(text(inspection.state?.external_id)) ||
    Boolean(text(inspection.state?.external_url)) ||
    Boolean(text(inspection.story?.youtube_post_id)) ||
    Boolean(text(inspection.story?.youtube_url));
  const externalObjectCreated =
    Number(inspection.platform_post_count || 0) > 0 ||
    Boolean(text(inspection.state?.external_id)) ||
    Boolean(text(inspection.state?.external_url)) ||
    Boolean(text(inspection.story?.youtube_post_id)) ||
    Boolean(text(inspection.story?.youtube_url));
  return {
    create_boundary_entered: createBoundaryEntered,
    external_object_created: externalObjectCreated,
  };
}

function buildResult({
  generatedAt,
  mode,
  verdict,
  mutated = false,
  blockers = [],
  plan = null,
  backup = null,
  repair = null,
  inspection = null,
  safetyUnknown = false,
} = {}) {
  const historical = safetyUnknown
    ? {
        create_boundary_entered: null,
        external_object_created: null,
      }
    : historicalSafety(inspection);
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    generated_at: generatedAt || null,
    mode,
    verdict,
    mutated,
    blockers: unique(blockers),
    ...(plan || {}),
    backup: backup?.evidence || null,
    repair,
    safety: {
      ...historical,
      platform_calls_performed: false,
      oauth_or_tokens_mutated: false,
      secondary_platforms_contacted: false,
    },
  };
}

async function executeGovernedReviewedQaRepair(options = {}) {
  const generatedDate = new Date(options.generatedAt || new Date());
  if (Number.isNaN(generatedDate.getTime())) {
    throw new Error("valid_generated_at_required");
  }
  const generatedAt = generatedDate.toISOString();
  const trustedCurrent = new Date(
    typeof options.nowImpl === "function"
      ? options.nowImpl()
      : new Date(),
  );
  if (Number.isNaN(trustedCurrent.getTime())) {
    throw new Error("trusted_current_time_invalid");
  }
  const trustedAt = trustedCurrent.toISOString();
  const databaseInput = text(options.databasePath || options.database);
  const storyId = text(options.storyId);
  if (!databaseInput || !storyId) {
    throw new Error("database_and_story_required");
  }
  const databasePath = path.resolve(databaseInput);
  const inspection = withReadOnlySqliteSnapshot(
    databasePath,
    (db) => inspectOpenDatabase(db, storyId, trustedAt),
    { DatabaseImpl: options.DatabaseImpl },
  );
  let blockers = inspectionBlockers(inspection, trustedAt);
  if (
    Math.abs(generatedDate.getTime() - trustedCurrent.getTime()) >
    GENERATED_AT_MAX_SKEW_MS
  ) {
    blockers.push("reviewed_qa_repair_generated_at_not_current");
  }
  const resolveRuntimeBuildInfo =
    options.resolveRuntimeBuildInfoImpl ||
    require("../runtime-build-info").resolveRuntimeBuildInfo;
  const build = resolveRuntimeBuildInfo({
    cwd: options.cwd || process.cwd(),
    env: {
      ...(options.env || process.env),
      DEPLOYMENT_MODE: "local",
    },
  });
  const runtimeCommit = lower(build?.commit_sha);
  const runtimeTreeClean =
    (options.isRuntimeTreeCleanImpl || isRuntimeTreeClean)(
      options.cwd || process.cwd(),
    ) === true;
  if (
    !FULL_COMMIT_PATTERN.test(runtimeCommit) ||
    lower(options.expectedSourceCommit) !== runtimeCommit
  ) {
    blockers.push("source_commit_mismatch");
  }
  if (
    !FULL_COMMIT_PATTERN.test(runtimeCommit) ||
    lower(options.expectedRuntimeCommit) !== runtimeCommit
  ) {
    blockers.push("runtime_commit_mismatch");
  }
  if (!runtimeTreeClean) {
    blockers.push("runtime_worktree_must_be_clean");
  }
  let authority = null;
  let contentQa = null;
  let reconciled = null;
  if (!blockers.length) {
    try {
      authority = await resolveGovernedReviewedContentQaAuthority({
        story: inspection.story,
        scheduledDispatch: scheduledDispatchFromInspection(inspection),
        exactDispatchBinding: exactBindingFromInspection(inspection),
        resolveMediaPath: options.resolveMediaPath,
      });
      contentQa = await (options.runContentQaImpl || runContentQa)(
        inspection.story,
      );
      reconciled = reconcileGovernedReviewedContentQa(
        contentQa,
        authority,
      );
      blockers.push(
        ...exactQaFailureBlockers(
          inspection.story,
          authority,
          contentQa,
          reconciled,
        ),
      );
    } catch (error) {
      blockers.push(
        ...(Array.isArray(error?.codes)
          ? error.codes
          : [error?.code || error?.message || "reviewed_qa_validation_failed"]),
      );
    }
  }
  blockers.push(...environmentBlockers(options.env || process.env));
  let scheduled = null;
  if (inspection.scheduled) {
    try {
      scheduled = scheduledDispatchFromInspection(inspection);
    } catch {
      blockers.push("scheduled_dispatch_evidence_invalid");
    }
  }
  const plan =
    inspection.story && scheduled && authority
      ? {
          generated_at: generatedAt,
          database_path: databasePath,
          story_id: inspection.story.id,
          channel_id: CHANNEL_ID,
          platform: PLATFORM,
          scheduled_event_id: Number(scheduled.event.id),
          scheduled_for: scheduled.scheduledFor,
          dispatch_idempotency_key: scheduled.idempotencyKey,
          request_fingerprint: scheduled.requestFingerprint,
          media_sha256: authority.mediaSha256,
          script_sha256: authority.scriptSha256,
          review_manifest_sha256: lower(
            inspection.story.final_publication_review
              ?.review_manifest_sha256,
          ),
          qa_publish_error_persistence_shape:
            qaPublishErrorPersistenceShape(inspection.raw_story),
          qa_failures_before: inspection.story.qa_failures,
          qa_failures_resolved: reconciled?.resolved || [],
          boundary_fingerprint: boundaryFingerprint(inspection),
          source_commit: runtimeCommit || null,
          runtime_commit: runtimeCommit || null,
          runtime_tree_clean: runtimeTreeClean,
        }
      : null;

  const verifyBackup =
    options.verifyBackupEvidenceImpl || verifyBackupEvidence;
  let backup = null;
  try {
    backup = verifyBackup({
      evidencePath: options.backupEvidencePath,
      databasePath,
      generatedAt: trustedAt,
    });
  } catch (error) {
    backup = {
      verified: false,
      blockers: [error?.message || "backup_evidence_verification_failed"],
    };
  }
  const backupVerified = backup?.verified === true;
  if (!backupVerified) {
    blockers.push(
      ...(backup?.blockers?.length
        ? backup.blockers
        : ["valid_backup_evidence_required"]),
    );
  }
  blockers = unique(blockers);
  if (options.apply !== true) {
    return buildResult({
      generatedAt,
      mode: "DRY_RUN",
      verdict: blockers.length ? "HOLD" : "READY",
      blockers,
      plan,
      backup,
      inspection,
    });
  }
  if (plan) blockers.push(...confirmationBlockers(options, plan));
  else blockers.push("repair_plan_required");
  blockers = unique(blockers);
  if (blockers.length) {
    return buildResult({
      generatedAt,
      mode: "APPLY",
      verdict: "HOLD",
      blockers,
      plan,
      backup,
      inspection,
    });
  }

  const mutationBoundaryBlockers =
    options.sqliteMutationBoundaryBlockersImpl ||
    sqliteMutationBoundaryBlockers;
  const preOpenBoundaryBlockers = mutationBoundaryBlockers({
    databasePath,
    expectedSourceSha256:
      backup?.evidence?.source_database_sha256,
    allowSharedMemory: false,
  });
  if (preOpenBoundaryBlockers.length) {
    return buildResult({
      generatedAt,
      mode: "APPLY",
      verdict: "HOLD",
      blockers: preOpenBoundaryBlockers,
      plan,
      backup,
      inspection,
      safetyUnknown: true,
    });
  }

  const Database = options.DatabaseImpl || require("better-sqlite3");
  const db = new Database(databasePath, { fileMustExist: true });
  db.pragma("foreign_keys = ON");
  let repair;
  try {
    repair = db
      .transaction(() => {
        const transactionBoundaryBlockers = mutationBoundaryBlockers({
          databasePath,
          expectedSourceSha256:
            backup?.evidence?.source_database_sha256,
          allowSharedMemory: true,
        });
        if (transactionBoundaryBlockers.length) {
          throw new Error(transactionBoundaryBlockers[0]);
        }
        const current = inspectOpenDatabase(db, storyId, trustedAt);
        const currentInspectionBlockers = inspectionBlockers(
          current,
          trustedAt,
        );
        if (currentInspectionBlockers.length) {
          throw new Error(currentInspectionBlockers[0]);
        }
        if (boundaryFingerprint(current) !== plan.boundary_fingerprint) {
          throw new Error("reviewed_qa_repair_database_boundary_changed");
        }
        const currentMediaPath = path.resolve(
          text(current.story.exported_path),
        );
        if (
          !fs.existsSync(currentMediaPath) ||
          hashFileSync(currentMediaPath) !== plan.media_sha256 ||
          sha256(String(current.story.full_script || "")) !==
            plan.script_sha256
        ) {
          throw new Error("reviewed_qa_repair_media_or_script_drift");
        }
        const governance = governanceFactory.bind(db);
        const decisionKey =
          `governed-reviewed-qa-repair:${storyId}:` +
          `${plan.scheduled_event_id}:` +
          `${plan.review_manifest_sha256}:` +
          `${text(options.changeWindowId)}`;
        const decision = governance.recordOperatorDecision({
          actorId: text(options.actorId),
          action: "repair_governed_reviewed_qa_refusal",
          targetType: "platform_publication",
          targetId: `${storyId}:${PLATFORM}`,
          decision: "APPROVED",
          reason: text(options.reason),
          evidence: {
            scheduled_event_id: plan.scheduled_event_id,
            dispatch_idempotency_key: plan.dispatch_idempotency_key,
            request_fingerprint: plan.request_fingerprint,
            media_sha256: plan.media_sha256,
            script_sha256: plan.script_sha256,
            review_manifest_sha256: plan.review_manifest_sha256,
            source_commit: plan.source_commit,
            runtime_commit: plan.runtime_commit,
            runtime_tree_clean: plan.runtime_tree_clean,
            change_window_id: text(options.changeWindowId),
            backup_id: backup?.evidence?.backup_id || null,
            backup_sha256:
              backup?.evidence?.backup_sha256 || null,
            backup_evidence_file_sha256:
              backup?.evidence?.evidence_file_sha256 || null,
            source_database_sha256:
              backup?.evidence?.source_database_sha256 || null,
            qa_failures_resolved: plan.qa_failures_resolved,
            qa_publish_error_persistence_shape:
              plan.qa_publish_error_persistence_shape,
            create_boundary_entered: false,
            external_object_created: false,
          },
          idempotencyKey: `${decisionKey}:operator-decision`,
        });
        const cancellation = governance.cancelScheduledAdmissionBeforeDispatch({
          storyId,
          platform: PLATFORM,
          channelId: CHANNEL_ID,
          scheduledEventId: plan.scheduled_event_id,
          scheduledDispatchIdempotencyKey:
            plan.dispatch_idempotency_key,
          requestFingerprint: plan.request_fingerprint,
          actorId: text(options.actorId),
          operatorDecisionId: decision.id,
          now: trustedCurrent,
          evidence: {
            create_boundary_entered: false,
            external_object_created: false,
            media_sha256: plan.media_sha256,
            script_sha256: plan.script_sha256,
            review_manifest_sha256: plan.review_manifest_sha256,
            source_commit: plan.source_commit,
            runtime_commit: plan.runtime_commit,
            change_window_id: text(options.changeWindowId),
            backup_id: backup?.evidence?.backup_id || null,
            source_database_sha256:
              backup?.evidence?.source_database_sha256 || null,
            qa_failures_resolved: plan.qa_failures_resolved,
            qa_publish_error_persistence_shape:
              plan.qa_publish_error_persistence_shape,
          },
          idempotencyKey: `${decisionKey}:cancel-admission`,
        });
        const nextExtra = {
          ...parseObject(current.raw_story._extra),
          qa_failed: false,
          qa_failures: [],
          qa_failed_at: null,
          publish_error: null,
          governed_reviewed_qa_repair: {
            schema_version: RESULT_SCHEMA_VERSION,
            repaired_at: trustedAt,
            repaired_by: text(options.actorId),
            repair_reason: text(options.reason),
            scheduled_event_id: plan.scheduled_event_id,
            cancellation_event_id: Number(cancellation.id),
            operator_decision_id: Number(decision.id),
            media_sha256: plan.media_sha256,
            script_sha256: plan.script_sha256,
            review_manifest_sha256: plan.review_manifest_sha256,
            source_commit: plan.source_commit,
            runtime_commit: plan.runtime_commit,
            change_window_id: text(options.changeWindowId),
            backup_id: backup?.evidence?.backup_id || null,
            source_database_sha256:
              backup?.evidence?.source_database_sha256 || null,
            qa_failures_resolved: plan.qa_failures_resolved,
            qa_publish_error_persistence_shape:
              plan.qa_publish_error_persistence_shape,
            create_boundary_entered: false,
            external_object_created: false,
          },
        };
        const update = db.prepare(
          `UPDATE stories
           SET publish_status = NULL,
               publish_error = NULL,
               updated_at = ?,
               _extra = ?
           WHERE id = ?`,
        ).run(trustedAt, JSON.stringify(nextExtra), storyId);
        if (update.changes !== 1) {
          throw new Error("reviewed_qa_repair_story_update_count_invalid");
        }
        const after = inspectOpenDatabase(db, storyId, trustedAt);
        if (
          after.state?.lifecycle_state !==
            "ADMISSION_CANCELLED_BEFORE_DISPATCH" ||
          after.story?.qa_failed !== false ||
          after.story?.publish_status !== null ||
          text(after.raw_story?.publish_error) ||
          after.dispatch_ledger_count !== 0 ||
          after.platform_post_count !== 0 ||
          text(after.state?.external_id) ||
          text(after.state?.external_url) ||
          text(after.story?.youtube_post_id) ||
          text(after.story?.youtube_url)
        ) {
          throw new Error(
            "reviewed_qa_repair_postconditions_not_satisfied",
          );
        }
        return {
          operator_decision_id: Number(decision.id),
          cancellation_event_id: Number(cancellation.id),
          lifecycle_state:
            governance.getState(storyId, PLATFORM)?.lifecycle_state,
          qa_failure_cleared: true,
        };
      })
      .immediate();
  } catch (error) {
    return buildResult({
      generatedAt,
      mode: "APPLY",
      verdict: "ROLLED_BACK",
      blockers: [error?.message || "reviewed_qa_repair_transaction_failed"],
      plan,
      backup,
      repair: null,
      inspection,
      safetyUnknown: true,
    });
  } finally {
    db.close();
  }
  return buildResult({
    generatedAt,
    mode: "APPLY",
    verdict: "APPLIED",
    mutated: true,
    blockers: [],
    plan,
    backup,
    repair,
    inspection,
  });
}

module.exports = {
  RESULT_SCHEMA_VERSION,
  executeGovernedReviewedQaRepair,
  inspectOpenDatabase,
};

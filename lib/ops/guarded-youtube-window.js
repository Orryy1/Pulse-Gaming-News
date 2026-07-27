"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  SECONDARY_AUTOMATION_FLAGS,
  resolveOperatingContract,
  truthy,
} = require("../stabilisation/operating-contract");

const RESULT_SCHEMA_VERSION = "pulse-guarded-youtube-window-result-v1";
const REVIEW_RESULT_SCHEMA_VERSION =
  "pulse-governed-publication-review-result-v1";
const BACKUP_SCHEMA_VERSION = "pulse-cutover-backup-evidence-v1";
const CHANNEL_ID = "pulse-gaming";
const PLATFORM = "youtube";
const EARLY_TOLERANCE_MS = 60 * 1000;
const LATE_TOLERANCE_MS = 15 * 60 * 1000;
const CONTROL_TOWER_MAX_AGE_MS = 15 * 60 * 1000;
const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const FULL_COMMIT_PATTERN = /^[a-f0-9]{40}$/i;
const ACTIONS = new Set(["inspect", "admit", "dispatch"]);

function text(value) {
  return String(value || "").trim();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
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

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function parseObject(value) {
  if (!value) return {};
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function normalisePath(value) {
  return path.resolve(text(value)).replace(/\\/g, "/").toLowerCase();
}

function samePath(left, right) {
  if (!text(left) || !text(right)) return false;
  return normalisePath(left) === normalisePath(right);
}

function readJson(filePath, missingCode, invalidCode) {
  if (!text(filePath)) {
    const error = new Error(missingCode);
    error.code = missingCode;
    throw error;
  }
  try {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
  } catch (error) {
    const code =
      error?.code === "ENOENT" || error?.code === "EISDIR"
        ? missingCode
        : invalidCode;
    const wrapped = new Error(code);
    wrapped.code = code;
    throw wrapped;
  }
}

function decodeStory(row) {
  if (!row) return null;
  const story = { ...row };
  const extra = parseObject(row._extra);
  delete story._extra;
  for (const field of [
    "title_variants",
    "game_images",
    "downloaded_images",
    "video_clips",
  ]) {
    if (typeof story[field] === "string" && story[field].startsWith("[")) {
      try {
        story[field] = JSON.parse(story[field]);
      } catch {
        // The publisher preserves malformed legacy values as strings.
      }
    }
  }
  Object.assign(story, extra);
  story.approved = story.approved === true || story.approved === 1;
  story.auto_approved =
    story.auto_approved === true || story.auto_approved === 1;
  return story;
}

function tableExists(db, tableName) {
  return !!db
    .prepare(
      `SELECT 1 FROM sqlite_master
       WHERE type = 'table' AND name = ? LIMIT 1`,
    )
    .get(tableName);
}

function inspectGuardedYoutubeDatabase({
  databasePath,
  storyId,
  generatedAt,
  DatabaseImpl,
} = {}) {
  const resolvedPath = path.resolve(text(databasePath));
  const snapshot = {
    database_path: resolvedPath,
    database_sha256: null,
    schema_ready: false,
    schema_blockers: [],
    story: null,
    review_binding: null,
    scheduled_rows: [],
    lifecycle_by_state: {},
    active_runtime_lease_count: 0,
    running_job_count: 0,
    active_worker_count: 0,
    published: null,
  };
  if (!text(databasePath) || !fs.existsSync(resolvedPath)) {
    snapshot.schema_blockers.push("guarded_database_file_required");
    return snapshot;
  }
  snapshot.database_sha256 = sha256File(resolvedPath);
  const walPath = `${resolvedPath}-wal`;
  if (fs.existsSync(walPath) && fs.statSync(walPath).size > 0) {
    snapshot.schema_blockers.push("database_wal_must_be_checkpointed");
  }
  const Database = DatabaseImpl || require("better-sqlite3");
  let db;
  try {
    db = new Database(resolvedPath, {
      readonly: true,
      fileMustExist: true,
    });
    db.pragma("query_only = ON");
    const requiredTables = [
      "stories",
      "schema_migrations",
      "operator_audit_log",
      "publication_lifecycle_events",
      "platform_publication_state",
      "platform_dispatch_ledger",
      "runtime_leases",
      "jobs",
      "workers",
    ];
    for (const table of requiredTables) {
      if (!tableExists(db, table)) {
        snapshot.schema_blockers.push(`required_table_missing:${table}`);
      }
    }
    if (snapshot.schema_blockers.length) return snapshot;
    const migration = db
      .prepare("SELECT version FROM schema_migrations WHERE version = '023'")
      .get();
    if (!migration) {
      snapshot.schema_blockers.push("migration_023_required");
      return snapshot;
    }

    const rawStory = db
      .prepare("SELECT * FROM stories WHERE id = ?")
      .get(text(storyId));
    snapshot.story = decodeStory(rawStory);
    const storyExtra = parseObject(rawStory?._extra);
    const reviewAudit = db
      .prepare(
        `SELECT evidence_json
         FROM operator_audit_log
         WHERE action = 'governed_publication_review'
           AND target_type = 'story'
           AND target_id = ?
           AND decision = 'HUMAN_RENDER_APPROVED'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(text(storyId));
    snapshot.review_binding = rawStory
      ? {
          render_review_status: text(
            storyExtra.render_review_status,
          ).toLowerCase(),
          review_manifest_sha256: text(
            storyExtra.final_publication_review?.review_manifest_sha256,
          ).toLowerCase(),
          preflight_evidence: storyExtra.preflight_evidence || null,
          immutable_audit_found: !!reviewAudit,
          audit_evidence: parseObject(reviewAudit?.evidence_json),
        }
      : null;

    const scheduledRows = db
      .prepare(
        `SELECT state.story_id, state.platform, state.lifecycle_state,
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
         ORDER BY event.id ASC`,
      )
      .all();
    snapshot.scheduled_rows = scheduledRows.map((row) => ({
      story_id: row.story_id,
      platform: row.platform,
      lifecycle_state: row.lifecycle_state,
      scheduled_event_id: row.scheduled_event_id,
      scheduled_event_created_at: row.scheduled_event_created_at,
      evidence: parseObject(row.evidence_json),
    }));

    const lifecycleRows = db
      .prepare(
        `SELECT to_state, evidence_json, id
         FROM publication_lifecycle_events
         WHERE story_id = ? AND platform = 'youtube'
         ORDER BY id ASC`,
      )
      .all(text(storyId));
    for (const row of lifecycleRows) {
      snapshot.lifecycle_by_state[row.to_state] = {
        ...parseObject(row.evidence_json),
        lifecycle_event_id: row.id,
      };
    }
    snapshot.active_runtime_lease_count = Number(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM runtime_leases
           WHERE julianday(expires_at) > julianday(?)`,
        )
        .get(new Date(generatedAt).toISOString()).count,
    );
    snapshot.running_job_count = Number(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM jobs
           WHERE status IN ('claimed', 'running')`,
        )
        .get().count,
    );
    snapshot.active_worker_count = Number(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM workers
           WHERE COALESCE(status, '') NOT IN ('offline', 'locked')`,
        )
        .get().count,
    );
    const publishedState = db
      .prepare(
        `SELECT state.story_id, state.lifecycle_state,
                state.external_id, state.external_url,
                state.verification_status, state.verified_at,
                ledger.event_type AS ledger_event_type,
                ledger.external_id AS ledger_external_id,
                ledger.external_url AS ledger_external_url,
                ledger.verification_status AS ledger_verification_status
         FROM platform_publication_state AS state
         LEFT JOIN platform_dispatch_ledger AS ledger
           ON ledger.id = state.last_event_id
         WHERE state.story_id = ?
           AND state.platform = 'youtube'
           AND state.lifecycle_state = 'PUBLISHED'`,
      )
      .get(text(storyId));
    snapshot.published = publishedState || null;
    snapshot.schema_ready = snapshot.schema_blockers.length === 0;
    return snapshot;
  } catch {
    snapshot.schema_blockers.push("guarded_database_read_failed");
    return snapshot;
  } finally {
    if (db) db.close();
  }
}

function validateBackupEvidence({
  backupEvidencePath,
  databasePath,
  databaseSha256,
  generatedAt,
} = {}) {
  const blockers = [];
  let evidence = null;
  try {
    evidence = readJson(
      backupEvidencePath,
      "fresh_cutover_backup_evidence_required",
      "cutover_backup_evidence_invalid_json",
    );
  } catch (error) {
    blockers.push(error.code || error.message);
    return { valid: false, blockers: unique(blockers), evidence: null };
  }
  if (evidence.schema_version !== BACKUP_SCHEMA_VERSION) {
    blockers.push("cutover_backup_evidence_schema_invalid");
  }
  if (!samePath(evidence.source_database_path, databasePath)) {
    blockers.push("cutover_backup_source_path_mismatch");
  }
  if (
    !SHA256_PATTERN.test(text(evidence.source_database_sha256)) ||
    text(evidence.source_database_sha256).toLowerCase() !==
      text(databaseSha256).toLowerCase()
  ) {
    blockers.push("cutover_backup_source_sha256_mismatch");
  }
  const nowMs = Date.parse(generatedAt);
  const verifiedMs = Date.parse(evidence.verified_at);
  if (!Number.isFinite(verifiedMs) || !Number.isFinite(nowMs)) {
    blockers.push("cutover_backup_verified_time_required");
  } else {
    if (verifiedMs - nowMs > FUTURE_CLOCK_SKEW_MS) {
      blockers.push("cutover_backup_verified_time_in_future");
    }
    if (nowMs - verifiedMs > BACKUP_MAX_AGE_MS) {
      blockers.push("cutover_backup_evidence_stale");
    }
  }
  const backupPath = text(evidence.backup_path);
  if (!backupPath || !fs.existsSync(path.resolve(backupPath))) {
    blockers.push("cutover_backup_file_required");
  } else if (
    !SHA256_PATTERN.test(text(evidence.backup_sha256)) ||
    sha256File(path.resolve(backupPath)) !==
      text(evidence.backup_sha256).toLowerCase()
  ) {
    blockers.push("cutover_backup_file_sha256_mismatch");
  }
  if (
    evidence.restore_test_status !== "PASS" ||
    evidence.integrity_check !== "ok" ||
    evidence.foreign_key_check !== "ok" ||
    evidence.quick_check !== "ok" ||
    evidence.backup_restore_hashes_match !== true ||
    evidence.production_database_mutated !== false
  ) {
    blockers.push("cutover_backup_restore_verification_required");
  }
  return {
    valid: blockers.length === 0,
    blockers: unique(blockers),
    evidence,
  };
}

function evaluateWindow(scheduledFor, generatedAt) {
  const blockers = [];
  const schedule = new Date(scheduledFor);
  const now = new Date(generatedAt);
  if (Number.isNaN(schedule.getTime()) || Number.isNaN(now.getTime())) {
    blockers.push("valid_guarded_schedule_required");
    return { blockers, scheduled_for: null, delta_ms: null };
  }
  if (
    ![9, 19].includes(schedule.getUTCHours()) ||
    schedule.getUTCMinutes() !== 0 ||
    schedule.getUTCSeconds() !== 0 ||
    schedule.getUTCMilliseconds() !== 0
  ) {
    blockers.push("schedule_outside_guarded_youtube_windows");
  }
  const deltaMs = now.getTime() - schedule.getTime();
  if (deltaMs < -EARLY_TOLERANCE_MS) {
    blockers.push("guarded_youtube_window_not_open");
  }
  if (deltaMs > LATE_TOLERANCE_MS) {
    blockers.push("guarded_youtube_window_expired");
  }
  return {
    blockers,
    scheduled_for: schedule.toISOString(),
    delta_ms: deltaMs,
  };
}

function evaluateScheduledRow(row, { generatedAt } = {}) {
  const blockers = [];
  const evidence = row?.evidence || {};
  const window = evaluateWindow(evidence.scheduled_for, generatedAt);
  blockers.push(...window.blockers);
  if (
    row?.platform !== PLATFORM ||
    row?.lifecycle_state !== "SCHEDULED" ||
    evidence.schedule_verified !== true
  ) {
    blockers.push("scheduled_youtube_lifecycle_evidence_invalid");
  }
  if (text(evidence.control_tower_verdict).toUpperCase() !== "GREEN") {
    blockers.push("scheduled_control_tower_not_green");
  }
  if (
    evidence.kill_switch_healthy !== true ||
    evidence.operating_contract_valid !== true
  ) {
    blockers.push("scheduled_runtime_controls_invalid");
  }
  const checkedMs = Date.parse(evidence.control_tower_checked_at);
  const nowMs = Date.parse(generatedAt);
  if (!Number.isFinite(checkedMs) || !Number.isFinite(nowMs)) {
    blockers.push("scheduled_control_tower_time_required");
  } else if (checkedMs > nowMs) {
    blockers.push("scheduled_control_tower_evidence_in_future");
  } else if (nowMs - checkedMs > CONTROL_TOWER_MAX_AGE_MS) {
    blockers.push("scheduled_control_tower_evidence_stale");
  }
  if (!text(evidence.dispatch_idempotency_key)) {
    blockers.push("scheduled_dispatch_key_required");
  }
  if (!SHA256_PATTERN.test(text(evidence.request_fingerprint))) {
    blockers.push("scheduled_request_fingerprint_required");
  }
  return {
    fresh: blockers.length === 0,
    blockers: unique(blockers),
    row,
  };
}

function expectedIdentity(options, review) {
  return {
    story_id: text(options.storyId),
    channel_id: CHANNEL_ID,
    platform: PLATFORM,
    scheduled_for: new Date(options.scheduledFor).toISOString(),
    media_sha256: text(options.confirmMediaSha256).toLowerCase(),
    script_sha256: text(options.confirmScriptSha256).toLowerCase(),
    request_fingerprint: text(options.confirmRequestFingerprint).toLowerCase(),
    renderer_manifest_sha256: text(
      options.confirmRendererManifestSha256,
    ).toLowerCase(),
    source_evidence_sha256: text(
      options.confirmSourceEvidenceSha256,
    ).toLowerCase(),
    dispatch_idempotency_key: text(options.confirmDispatchKey),
    review_manifest_sha256: text(review?.review_manifest_sha256).toLowerCase(),
  };
}

function exactConfirmationBlockers(options, review, identity) {
  const blockers = [];
  if (text(options.confirmStoryId) !== identity.story_id) {
    blockers.push("exact_story_confirmation_required");
  }
  if (
    text(options.confirmScheduledFor) !== identity.scheduled_for ||
    text(options.scheduledFor) !== identity.scheduled_for
  ) {
    blockers.push("exact_schedule_confirmation_required");
  }
  const expectedDispatchKey = `${PLATFORM}:${identity.story_id}:${identity.scheduled_for}`;
  if (identity.dispatch_idempotency_key !== expectedDispatchKey) {
    blockers.push("exact_dispatch_key_mismatch");
  }
  const comparisons = [
    [
      identity.media_sha256,
      text(review?.media_sha256).toLowerCase(),
      "exact_media_sha256_mismatch",
    ],
    [
      identity.script_sha256,
      text(review?.script_sha256).toLowerCase(),
      "exact_script_sha256_mismatch",
    ],
    [
      identity.renderer_manifest_sha256,
      text(review?.preflight_evidence?.renderer_manifest_sha256).toLowerCase(),
      "exact_renderer_manifest_sha256_mismatch",
    ],
    [
      identity.source_evidence_sha256,
      text(review?.preflight_evidence?.source_evidence_sha256).toLowerCase(),
      "exact_source_evidence_sha256_mismatch",
    ],
  ];
  for (const [provided, expected, code] of comparisons) {
    if (!SHA256_PATTERN.test(provided) || provided !== expected) {
      blockers.push(code);
    }
  }
  if (
    text(options.actorId) === "" ||
    text(options.confirmActorId) !== text(options.actorId)
  ) {
    blockers.push("exact_actor_confirmation_required");
  }
  if (
    text(options.reason) === "" ||
    text(options.confirmReason) !== text(options.reason)
  ) {
    blockers.push("exact_reason_confirmation_required");
  }
  if (
    text(options.changeWindowId) === "" ||
    text(options.confirmChangeWindowId) !== text(options.changeWindowId)
  ) {
    blockers.push("exact_change_window_confirmation_required");
  }
  return blockers;
}

function validateReviewResult(review, snapshot) {
  const blockers = [];
  if (
    review?.schema_version !== REVIEW_RESULT_SCHEMA_VERSION ||
    review?.mode !== "APPLY" ||
    review?.verdict !== "APPLIED" ||
    review?.mutated !== true ||
    review?.idempotent !== false ||
    (review?.blockers || []).length !== 0
  ) {
    blockers.push("applied_publication_review_required");
  }
  if (
    review?.story_id !== snapshot?.story?.id ||
    review?.channel_id !== CHANNEL_ID ||
    review?.preflight_evidence?.story_id !== snapshot?.story?.id ||
    review?.preflight_evidence?.channel_id !== CHANNEL_ID
  ) {
    blockers.push("publication_review_identity_mismatch");
  }
  const binding = snapshot?.review_binding;
  if (
    binding?.render_review_status !== "approved" ||
    binding?.review_manifest_sha256 !==
      text(review?.review_manifest_sha256).toLowerCase() ||
    binding?.immutable_audit_found !== true ||
    stableJson(binding?.preflight_evidence) !==
      stableJson(review?.preflight_evidence)
  ) {
    blockers.push("publication_review_database_binding_mismatch");
  }
  const audit = binding?.audit_evidence || {};
  if (
    text(audit.review_manifest_sha256).toLowerCase() !==
      text(review?.review_manifest_sha256).toLowerCase() ||
    text(audit.script_sha256).toLowerCase() !==
      text(review?.script_sha256).toLowerCase() ||
    text(audit.media_sha256).toLowerCase() !==
      text(review?.media_sha256).toLowerCase() ||
    text(audit.source_evidence?.sha256).toLowerCase() !==
      text(review?.preflight_evidence?.source_evidence_sha256).toLowerCase() ||
    text(audit.renderer_manifest?.canonical_sha256).toLowerCase() !==
      text(review?.preflight_evidence?.renderer_manifest_sha256).toLowerCase()
  ) {
    blockers.push("publication_review_audit_binding_mismatch");
  }
  if (
    review?.safety?.uploads_performed !== false ||
    review?.safety?.oauth_or_tokens_mutated !== false ||
    review?.safety?.platform_objects_created !== false
  ) {
    blockers.push("publication_review_safety_evidence_invalid");
  }
  return unique(blockers);
}

function validateRuntime({ options, snapshot, actualCommit, backup } = {}) {
  const blockers = [];
  const env = options.env || process.env;
  const contract = resolveOperatingContract({ env });
  if (!contract.live_mutation_allowed) {
    blockers.push(...contract.blockers);
    blockers.push("live_guarded_operating_contract_required");
  }
  if (text(env.CHANNEL) !== CHANNEL_ID) {
    blockers.push("explicit_pulse_gaming_channel_required");
  }
  for (const [key, expected, code] of [
    [
      "PULSE_OPERATING_MODE",
      "LIVE_GUARDED",
      "exact_live_guarded_mode_required",
    ],
    ["AUTO_PUBLISH", "true", "exact_auto_publish_arm_required"],
    [
      "PULSE_GUARDED_LIVE_DISPATCH_ENABLED",
      "true",
      "exact_guarded_dispatch_arm_required",
    ],
    ["USE_JOB_QUEUE", "true", "exact_durable_queue_required"],
    ["USE_SQLITE", "true", "exact_sqlite_mode_required"],
    ["PULSE_PRIMARY_INSTANCE", "true", "exact_primary_instance_required"],
    [
      "PULSE_EMERGENCY_KILL_SWITCH",
      "false",
      "explicit_untripped_kill_switch_required",
    ],
  ]) {
    if (text(env[key]).toUpperCase() !== expected.toUpperCase()) {
      blockers.push(code);
    }
  }
  if (!samePath(env.SQLITE_DB_PATH, options.databasePath)) {
    blockers.push("runtime_database_path_mismatch");
  }
  if (SECONDARY_AUTOMATION_FLAGS.some((key) => truthy(env[key]))) {
    blockers.push("secondary_platform_automation_must_be_false");
  }
  if (options.confirmSupervisorStopped !== true) {
    blockers.push("stopped_supervisor_confirmation_required");
  }
  if (options.confirmWorkersStopped !== true) {
    blockers.push("stopped_workers_confirmation_required");
  }
  if (Number(snapshot?.active_runtime_lease_count) !== 0) {
    blockers.push("active_runtime_leases_present");
  }
  if (Number(snapshot?.running_job_count) !== 0) {
    blockers.push("running_jobs_present");
  }
  if (Number(snapshot?.active_worker_count) !== 0) {
    blockers.push("active_workers_present");
  }
  if (snapshot?.schema_ready !== true) {
    blockers.push(...(snapshot?.schema_blockers || []));
    blockers.push("guarded_database_schema_required");
  }
  if (!backup?.valid) blockers.push(...(backup?.blockers || []));
  if (
    !FULL_COMMIT_PATTERN.test(text(actualCommit)) ||
    text(options.expectedSourceCommit).toLowerCase() !==
      text(actualCommit).toLowerCase()
  ) {
    blockers.push("source_commit_mismatch");
  }
  if (
    !FULL_COMMIT_PATTERN.test(text(actualCommit)) ||
    text(options.expectedRuntimeCommit).toLowerCase() !==
      text(actualCommit).toLowerCase()
  ) {
    blockers.push("runtime_commit_mismatch");
  }
  return unique(blockers);
}

function validateStory(snapshot, identity) {
  const blockers = [];
  const story = snapshot?.story;
  if (!story) return ["publication_story_not_found"];
  if (story.id !== identity.story_id) {
    blockers.push("publication_story_identity_mismatch");
  }
  if (text(story.channel_id || CHANNEL_ID) !== CHANNEL_ID) {
    blockers.push("publication_story_channel_mismatch");
  }
  if (story.approved !== true || story.auto_approved === true) {
    blockers.push("human_editorial_approval_required");
  }
  if (!text(story.full_script) || !text(story.exported_path)) {
    blockers.push("final_script_and_media_required");
  }
  if (story.qa_failed === true || story.publish_status === "failed") {
    blockers.push("story_has_unresolved_qa_failure");
  }
  if (text(story.youtube_post_id)) {
    blockers.push("youtube_already_projected");
  }
  return unique(blockers);
}

function validateScheduledBinding(snapshot, identity, generatedAt) {
  const blockers = [];
  const evaluations = (snapshot?.scheduled_rows || []).map((row) =>
    evaluateScheduledRow(row, { generatedAt }),
  );
  const fresh = evaluations.filter((entry) => entry.fresh);
  if (fresh.length !== 1) {
    blockers.push("fresh_scheduled_candidate_count_must_be_one");
  }
  const target = fresh.find(
    (entry) => entry.row.story_id === identity.story_id,
  );
  if (!target) blockers.push("exact_scheduled_story_not_found");
  if (
    (snapshot?.scheduled_rows || []).some(
      (row) => row.story_id !== identity.story_id,
    )
  ) {
    blockers.push("another_scheduled_youtube_row_present");
  }
  if (target) {
    const evidence = target.row.evidence || {};
    const expectedPairs = [
      [
        text(evidence.scheduled_for),
        identity.scheduled_for,
        "scheduled_time_mismatch",
      ],
      [
        text(evidence.dispatch_idempotency_key),
        identity.dispatch_idempotency_key,
        "scheduled_dispatch_key_mismatch",
      ],
      [
        text(evidence.request_fingerprint).toLowerCase(),
        identity.request_fingerprint,
        "scheduled_request_fingerprint_mismatch",
      ],
      [
        text(
          evidence.publication_evidence?.source_evidence_sha256,
        ).toLowerCase(),
        identity.source_evidence_sha256,
        "scheduled_source_evidence_sha256_mismatch",
      ],
      [
        text(
          evidence.publication_evidence?.renderer_manifest_sha256,
        ).toLowerCase(),
        identity.renderer_manifest_sha256,
        "scheduled_renderer_manifest_sha256_mismatch",
      ],
      [
        text(
          snapshot.lifecycle_by_state?.SCRIPT_READY?.script_sha256,
        ).toLowerCase(),
        identity.script_sha256,
        "scheduled_script_sha256_mismatch",
      ],
      [
        text(snapshot.lifecycle_by_state?.RENDERED?.media_sha256).toLowerCase(),
        identity.media_sha256,
        "scheduled_media_sha256_mismatch",
      ],
      [
        text(
          snapshot.lifecycle_by_state?.RENDERED?.renderer_manifest_sha256,
        ).toLowerCase(),
        identity.renderer_manifest_sha256,
        "scheduled_rendered_manifest_sha256_mismatch",
      ],
    ];
    for (const [actual, expected, code] of expectedPairs) {
      if (actual !== expected) blockers.push(code);
    }
  }
  return {
    blockers: unique(blockers),
    candidate: target?.row || null,
    fresh_candidate_count: fresh.length,
    binding: {
      bound: blockers.length === 0,
      method: "unique_fresh_scheduled_candidate_in_exact_sqlite",
      story_id: target?.row?.story_id || null,
      scheduled_event_id: target?.row?.scheduled_event_id || null,
    },
  };
}

function validatePublished(snapshot, identity) {
  const blockers = [];
  const published = snapshot?.published;
  const externalId = text(published?.external_id);
  const externalUrl = text(published?.external_url);
  const verifiedAtMs = Date.parse(published?.verified_at);
  if (
    published?.story_id !== identity.story_id ||
    published?.lifecycle_state !== "PUBLISHED" ||
    published?.verification_status !== "confirmed" ||
    !externalId ||
    !externalUrl ||
    !Number.isFinite(verifiedAtMs) ||
    published?.ledger_event_type !== "PUBLISHED" ||
    published?.ledger_verification_status !== "confirmed" ||
    text(published?.ledger_external_id) !== externalId ||
    text(published?.ledger_external_url) !== externalUrl
  ) {
    blockers.push("published_state_confirmation_required");
  }
  if (
    text(snapshot?.story?.youtube_post_id) !== externalId ||
    text(snapshot?.story?.youtube_url) !== externalUrl
  ) {
    blockers.push("published_story_projection_mismatch");
  }
  return {
    valid: blockers.length === 0,
    blockers,
    publication: published
      ? {
          external_id: externalId || null,
          external_url: externalUrl || null,
          verification_status: published.verification_status || null,
          story_projection_confirmed: blockers.length === 0,
        }
      : null,
  };
}

function defaultOpenRepositories(databasePath) {
  const Database = require("better-sqlite3");
  const db = new Database(path.resolve(databasePath), {
    fileMustExist: true,
  });
  const { bindRepositories } = require("../repositories");
  return {
    repos: bindRepositories(db),
    close() {
      db.close();
    },
  };
}

function defaultPublisherRuntimeDatabasePath() {
  return require("../db").DB_PATH;
}

function resultBase({
  options,
  identity,
  blockers = [],
  mutated = false,
  platformsContacted = false,
} = {}) {
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    generated_at: new Date(options.generatedAt).toISOString(),
    action: options.action,
    verdict: blockers.length ? "HOLD" : "READY",
    story_id: identity?.story_id || text(options.storyId) || null,
    channel_id: CHANNEL_ID,
    platform: PLATFORM,
    scheduled_for: identity?.scheduled_for || null,
    change_window_id: text(options.changeWindowId) || null,
    mutated,
    blockers: unique(blockers),
    retry_attempted: false,
    safety: {
      database_mutated: mutated,
      platforms_contacted: platformsContacted,
      oauth_or_tokens_mutated: false,
      uploader_override_used: false,
      automatic_retry_performed: false,
    },
  };
}

async function executeGuardedYoutubeWindow(options = {}) {
  const action = text(options.action || "inspect").toLowerCase();
  const generatedAt = new Date(options.generatedAt || new Date()).toISOString();
  const effective = {
    ...options,
    action,
    generatedAt,
    env: options.env || process.env,
  };
  const dependencies = options.dependencies || {};
  const earlyBlockers = [];
  if (!ACTIONS.has(action)) earlyBlockers.push("guarded_action_invalid");
  if (
    Object.keys(dependencies).length > 0 &&
    text(effective.env.NODE_ENV).toLowerCase() !== "test"
  ) {
    earlyBlockers.push("production_dependency_override_forbidden");
  }
  const inspectDatabase =
    dependencies.inspectDatabase || inspectGuardedYoutubeDatabase;
  const readReviewResult =
    dependencies.readReviewResult ||
    ((filePath) =>
      readJson(
        filePath,
        "publication_review_result_required",
        "publication_review_result_invalid_json",
      ));
  let review = null;
  try {
    review = readReviewResult(effective.publicationReviewResultPath);
  } catch (error) {
    earlyBlockers.push(error.code || error.message);
  }
  let snapshot;
  try {
    snapshot = inspectDatabase({
      databasePath: effective.databasePath,
      storyId: effective.storyId,
      generatedAt,
      phase: "pre_action",
    });
  } catch {
    snapshot = {
      schema_ready: false,
      schema_blockers: ["guarded_database_read_failed"],
      scheduled_rows: [],
    };
  }
  const validateBackup =
    dependencies.validateBackupEvidence || validateBackupEvidence;
  let backup;
  try {
    backup = validateBackup({
      backupEvidencePath: effective.backupEvidencePath,
      databasePath: effective.databasePath,
      databaseSha256: snapshot?.database_sha256,
      generatedAt,
    });
  } catch {
    backup = {
      valid: false,
      blockers: ["fresh_cutover_backup_evidence_required"],
    };
  }
  const resolveBuild =
    dependencies.resolveRuntimeBuildInfo ||
    ((input) =>
      require("../runtime-build-info").resolveRuntimeBuildInfo(input));
  const build = resolveBuild({
    cwd: process.cwd(),
    env: { ...effective.env, DEPLOYMENT_MODE: "local" },
  });
  let identity = null;
  try {
    identity = expectedIdentity(effective, review);
  } catch {
    earlyBlockers.push("valid_guarded_schedule_required");
  }
  if (!identity) {
    return resultBase({
      options: effective,
      blockers: earlyBlockers,
    });
  }
  const blockers = [
    ...earlyBlockers,
    ...evaluateWindow(effective.scheduledFor, generatedAt).blockers,
    ...exactConfirmationBlockers(effective, review, identity),
    ...validateReviewResult(review, snapshot),
    ...validateStory(snapshot, identity),
    ...validateRuntime({
      options: effective,
      snapshot,
      actualCommit: build?.commit_sha,
      backup,
    }),
  ];
  const fingerprintPublicationRequest =
    dependencies.fingerprintPublicationRequest ||
    require("../services/publication-request-fingerprint")
      .fingerprintPublicationRequest;
  let fingerprint = null;
  if (snapshot?.story && review?.preflight_evidence) {
    try {
      const {
        buildImmutablePublicationEvidence,
      } = require("../services/publication-admission");
      const publicationEvidence = buildImmutablePublicationEvidence({
        evidence: review.preflight_evidence,
        operatingMode: "LIVE_GUARDED",
      });
      const resolveMediaPath =
        dependencies.resolveMediaPath ||
        require("../media-paths").resolveExisting;
      const channel =
        dependencies.channel ||
        require("../../channels").getChannel(CHANNEL_ID);
      fingerprint = await fingerprintPublicationRequest(snapshot.story, {
        channelId: CHANNEL_ID,
        platform: PLATFORM,
        resolveMediaPath,
        channel,
        publicationEvidence,
      });
      if (fingerprint.media_sha256 !== identity.media_sha256) {
        blockers.push("current_media_sha256_mismatch");
      }
      if (fingerprint.script_sha256 !== identity.script_sha256) {
        blockers.push("current_script_sha256_mismatch");
      }
      if (fingerprint.request_fingerprint !== identity.request_fingerprint) {
        blockers.push("current_request_fingerprint_mismatch");
      }
    } catch {
      blockers.push("current_publication_fingerprint_unavailable");
    }
  }

  const preBlockers = unique(blockers);
  if (action === "inspect") {
    const scheduledRows = snapshot?.scheduled_rows || [];
    if (scheduledRows.length === 0) {
      const result = resultBase({
        options: effective,
        identity,
        blockers: preBlockers,
      });
      result.verdict = preBlockers.length ? "HOLD" : "READY_TO_ADMIT";
      result.selection_binding = {
        bound: preBlockers.length === 0,
        method: "exact_reviewed_story_in_exact_sqlite",
        story_id: identity.story_id,
      };
      result.backup_evidence = backup?.evidence || null;
      result.runtime_commit = build?.commit_sha || null;
      return result;
    }
    const scheduled = validateScheduledBinding(snapshot, identity, generatedAt);
    const result = resultBase({
      options: effective,
      identity,
      blockers: unique([...preBlockers, ...scheduled.blockers]),
    });
    result.verdict = result.blockers.length ? "HOLD" : "READY_TO_DISPATCH";
    result.selection_binding = scheduled.binding;
    result.scheduled_candidate = scheduled.candidate;
    result.backup_evidence = backup?.evidence || null;
    result.runtime_commit = build?.commit_sha || null;
    return result;
  }

  if (action === "admit") {
    const scheduledRows = snapshot?.scheduled_rows || [];
    if (scheduledRows.some((row) => row.story_id !== identity.story_id)) {
      preBlockers.push("another_scheduled_youtube_row_present");
    }
    if (scheduledRows.some((row) => row.story_id === identity.story_id)) {
      preBlockers.push("target_story_already_scheduled");
    }
    const admissionBlockers = unique(preBlockers);
    if (admissionBlockers.length) {
      return resultBase({
        options: effective,
        identity,
        blockers: admissionBlockers,
      });
    }
    const openRepositories =
      dependencies.openRepositories || defaultOpenRepositories;
    const admitPublication =
      dependencies.admitPublication ||
      require("../services/publication-admission").admitPublication;
    const handle = openRepositories(effective.databasePath);
    let admission;
    try {
      const originalStories = handle.repos.stories;
      const admissionRepos = {
        ...handle.repos,
        stories: {
          ...originalStories,
          get(storyId) {
            return decodeStory(originalStories.get(storyId));
          },
        },
      };
      admission = await admitPublication({
        repos: admissionRepos,
        storyId: identity.story_id,
        channelId: CHANNEL_ID,
        platform: PLATFORM,
        actorId: text(effective.actorId),
        reason: text(effective.reason),
        confirmationStoryId: text(effective.confirmStoryId),
        scheduledFor: identity.scheduled_for,
        evidence: review.preflight_evidence,
        env: effective.env,
        now: new Date(generatedAt),
        resolveMediaPath:
          dependencies.resolveMediaPath ||
          require("../media-paths").resolveExisting,
        channel:
          dependencies.channel ||
          require("../../channels").getChannel(CHANNEL_ID),
      });
    } catch {
      return resultBase({
        options: effective,
        identity,
        blockers: ["publication_admission_failed"],
      });
    } finally {
      if (handle?.close) handle.close();
    }
    const admissionPairs = [
      [admission?.admitted, true],
      [admission?.story_id, identity.story_id],
      [admission?.scheduled_for, identity.scheduled_for],
      [admission?.dispatch_idempotency_key, identity.dispatch_idempotency_key],
      [admission?.request_fingerprint, identity.request_fingerprint],
      [admission?.media_sha256, identity.media_sha256],
      [admission?.script_sha256, identity.script_sha256],
      [admission?.renderer_manifest_sha256, identity.renderer_manifest_sha256],
      [admission?.lifecycle_state, "SCHEDULED"],
    ];
    if (
      admissionPairs.some(([actual, expected]) => actual !== expected) ||
      (admission?.blockers || []).length
    ) {
      return resultBase({
        options: effective,
        identity,
        blockers: ["publication_admission_result_mismatch"],
        mutated: admission?.admitted === true,
      });
    }
    const post = inspectDatabase({
      databasePath: effective.databasePath,
      storyId: identity.story_id,
      generatedAt,
      phase: "post_admit",
    });
    const scheduled = validateScheduledBinding(post, identity, generatedAt);
    const result = resultBase({
      options: effective,
      identity,
      blockers: scheduled.blockers,
      mutated: true,
    });
    result.verdict = scheduled.blockers.length ? "HOLD" : "ADMITTED";
    result.admission = admission;
    result.scheduled_candidate = scheduled.candidate;
    result.selection_binding = scheduled.binding;
    return result;
  }

  const scheduled = validateScheduledBinding(snapshot, identity, generatedAt);
  const dispatchBlockers = unique([...preBlockers, ...scheduled.blockers]);
  if (effective.confirmLiveYoutubeDispatch !== true) {
    dispatchBlockers.push("live_youtube_dispatch_confirmation_required");
  }
  const publisherRuntimeDatabasePath =
    dependencies.publisherRuntimeDatabasePath ||
    defaultPublisherRuntimeDatabasePath;
  let runtimeDatabasePath = null;
  try {
    runtimeDatabasePath = publisherRuntimeDatabasePath();
  } catch {
    dispatchBlockers.push("publisher_runtime_database_unavailable");
  }
  if (
    runtimeDatabasePath &&
    !samePath(runtimeDatabasePath, effective.databasePath)
  ) {
    dispatchBlockers.push("publisher_runtime_database_path_mismatch");
  }
  if (dispatchBlockers.length) {
    const result = resultBase({
      options: effective,
      identity,
      blockers: unique(dispatchBlockers),
    });
    result.selection_binding = scheduled.binding;
    result.scheduled_candidate = scheduled.candidate;
    return result;
  }
  const openRepositories =
    dependencies.openRepositories || defaultOpenRepositories;
  const publishNextStory =
    dependencies.publishNextStory ||
    require("../../publisher").publishNextStory;
  const handle = openRepositories(effective.databasePath);
  let publisherResult = null;
  let publisherError = false;
  try {
    publisherResult = await publishNextStory({
      repos: handle.repos,
      leases: handle.repos.runtimeLeases,
      channelId: CHANNEL_ID,
      env: effective.env,
      now: new Date(generatedAt),
      actorId: text(effective.actorId),
    });
  } catch {
    publisherError = true;
  } finally {
    if (handle?.close) handle.close();
  }
  const post = inspectDatabase({
    databasePath: effective.databasePath,
    storyId: identity.story_id,
    generatedAt,
    phase: "post_dispatch",
  });
  const published = validatePublished(post, identity);
  const finalBlockers = [...published.blockers];
  if (publisherError && !published.valid) {
    finalBlockers.push("publisher_dispatch_ambiguous_no_retry");
  } else if (!published.valid) {
    finalBlockers.push("publisher_did_not_confirm_new_upload");
  }
  const result = resultBase({
    options: effective,
    identity,
    blockers: unique(finalBlockers),
    mutated: true,
    platformsContacted: true,
  });
  result.verdict = published.valid ? "PUBLISHED_CONFIRMED" : "HOLD";
  result.selection_binding = scheduled.binding;
  result.scheduled_candidate = scheduled.candidate;
  result.publisher_result = publisherResult;
  result.publisher_threw = publisherError;
  result.publication = published.publication;
  return result;
}

function renderGuardedYoutubeWindowMarkdown(result) {
  const lines = [
    "# Guarded YouTube Window",
    "",
    `Generated: ${result.generated_at}`,
    `Action: ${result.action}`,
    `Verdict: ${result.verdict}`,
    `Story: ${result.story_id || "none"}`,
    `Scheduled: ${result.scheduled_for || "none"}`,
    "",
    "## Outcome",
    "",
  ];
  if (result.publication?.external_id) {
    lines.push(
      `- Confirmed external ID: ${result.publication.external_id}`,
      `- Confirmed external URL: ${result.publication.external_url}`,
      "- Lifecycle, dispatch ledger and story projection agree.",
    );
  } else {
    lines.push(`- ${result.verdict}`);
  }
  lines.push("", "## Blockers", "");
  if ((result.blockers || []).length === 0) lines.push("- none");
  else result.blockers.forEach((blocker) => lines.push(`- ${blocker}`));
  lines.push(
    "",
    "## Safety",
    "",
    `- Database mutated: ${result.safety?.database_mutated === true}`,
    `- Platform contacted: ${result.safety?.platforms_contacted === true}`,
    `- OAuth or tokens mutated: ${result.safety?.oauth_or_tokens_mutated === true}`,
    "- No automatic retry is attempted after a dispatch ambiguity.",
    "",
  );
  return lines.join("\n");
}

module.exports = {
  ACTIONS,
  BACKUP_SCHEMA_VERSION,
  CHANNEL_ID,
  RESULT_SCHEMA_VERSION,
  decodeStory,
  evaluateScheduledRow,
  evaluateWindow,
  executeGuardedYoutubeWindow,
  inspectGuardedYoutubeDatabase,
  renderGuardedYoutubeWindowMarkdown,
  validateBackupEvidence,
  validatePublished,
  validateScheduledBinding,
};

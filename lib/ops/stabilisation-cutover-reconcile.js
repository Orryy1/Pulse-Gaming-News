"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const COMMIT_PATTERN = /^[a-f0-9]{7,64}$/i;
const ACTIVE_JOB_STATUSES = new Set(["pending", "claimed", "running"]);
const RUNNING_JOB_STATUSES = new Set(["claimed", "running"]);
const SAFE_REQUEUE_KINDS = new Set([
  "hunt",
  "process",
  "image",
  "audio",
  "assemble",
  "produce",
  "analytics",
  "db_backup",
  "jobs_reap",
  "render_health_digest",
  "scoring_digest",
]);
const NON_GOVERNED_DEBT_KINDS = new Set([
  "engage",
  "engage_first_hour",
  "roundup_weekly",
  "roundup_monthly_topics",
  "roundup_fanout",
  "blog_rebuild",
  "timing_reanalysis",
  "studio_analytics_loop",
  "live_performance_analyst",
  "instagram_token_refresh",
  "instagram_pending_verify",
  "tiktok_auth_check",
  "local_tts_retry_recovery",
  "fresh_production_refill",
  "growth_autopilot",
  "oauth_uptime_maintenance",
]);
const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SECONDARY_AUTOMATION_FLAGS = [
  "TIKTOK_ENABLED",
  "TIKTOK_AUTO_PUBLISH",
  "INSTAGRAM_AUTO_PUBLISH",
  "FACEBOOK_AUTO_PUBLISH",
  "TWITTER_ENABLED",
  "X_AUTO_PUBLISH",
  "THREADS_AUTO_PUBLISH",
  "PINTEREST_AUTO_PUBLISH",
];

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function hashFile(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || "").trim());
}

function explicitlyFalse(value) {
  return /^(false|0|no|off)$/i.test(String(value || "").trim());
}

function samePath(left, right) {
  const normalise = (value) =>
    path
      .resolve(String(value || ""))
      .replace(/\\/g, "/")
      .toLowerCase();
  return normalise(left) === normalise(right);
}

function sqliteSidecarSnapshot(databasePath) {
  const resolved = path.resolve(String(databasePath || ""));
  const inspect = (suffix) => {
    const sidecarPath = `${resolved}${suffix}`;
    try {
      const stat = fs.lstatSync(sidecarPath);
      return {
        path: sidecarPath,
        exists: true,
        regular_file: stat.isFile(),
        symbolic_link: stat.isSymbolicLink(),
        size_bytes: stat.size,
        mtime_ms: stat.mtimeMs,
        ctime_ms: stat.ctimeMs,
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return {
          path: sidecarPath,
          exists: false,
          regular_file: false,
          symbolic_link: false,
          size_bytes: 0,
          mtime_ms: null,
          ctime_ms: null,
        };
      }
      return {
        path: sidecarPath,
        exists: true,
        regular_file: false,
        symbolic_link: false,
        size_bytes: null,
        mtime_ms: null,
        ctime_ms: null,
        inspection_error: true,
      };
    }
  };
  return {
    database_path: resolved,
    wal: inspect("-wal"),
    shm: inspect("-shm"),
  };
}

function checkpointedSqliteBlockers(
  snapshot,
  { allowSharedMemory = false } = {},
) {
  const blockers = [];
  const wal = snapshot?.wal;
  const shm = snapshot?.shm;
  if (
    !wal ||
    wal.inspection_error ||
    (wal.exists && (!wal.regular_file || wal.symbolic_link)) ||
    Number(wal.size_bytes) > 0
  ) {
    blockers.push("source_database_wal_not_checkpointed");
  }
  if (
    !allowSharedMemory &&
    (!shm ||
      shm.inspection_error ||
      (shm.exists && (!shm.regular_file || shm.symbolic_link)) ||
      Number(shm.size_bytes) > 0)
  ) {
    blockers.push("source_database_shared_memory_present");
  }
  return unique(blockers);
}

function sqliteMutationBoundaryBlockers({
  databasePath,
  expectedSourceSha256,
  allowSharedMemory = false,
  allowSourceMismatch = false,
  sourceMismatchCode = "source_database_sha256_changed_before_apply",
} = {}) {
  const blockers = checkpointedSqliteBlockers(
    sqliteSidecarSnapshot(databasePath),
    { allowSharedMemory },
  );
  const expected = String(expectedSourceSha256 || "")
    .trim()
    .toLowerCase();
  if (
    !allowSourceMismatch &&
    (!SHA256_PATTERN.test(expected) ||
      hashFile(databasePath) !== expected)
  ) {
    blockers.push(sourceMismatchCode);
  }
  return unique(blockers);
}

function withReadOnlySqliteSnapshot(
  databasePath,
  callback,
  { DatabaseImpl = null } = {},
) {
  const resolved = requiredDatabasePath(databasePath);
  const snapshotRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-sqlite-inspection-"),
  );
  const snapshotPath = path.join(snapshotRoot, "snapshot.db");
  let db = null;
  try {
    fs.copyFileSync(resolved, snapshotPath);
    const Database = DatabaseImpl || require("better-sqlite3");
    db = new Database(snapshotPath, {
      readonly: true,
      fileMustExist: true,
    });
    db.pragma("query_only = ON");
    return callback(db, resolved);
  } finally {
    if (db) db.close();
    fs.rmSync(snapshotRoot, { recursive: true, force: true });
  }
}

function verifyBackupEvidence({
  evidencePath,
  databasePath,
  generatedAt,
  allowSourceMismatch = false,
} = {}) {
  const blockers = [];
  if (!evidencePath) {
    return {
      verified: false,
      blockers: ["backup_evidence_file_required"],
      evidence: null,
    };
  }
  const resolvedEvidence = path.resolve(evidencePath);
  if (!fs.existsSync(resolvedEvidence)) {
    return {
      verified: false,
      blockers: ["backup_evidence_file_not_found"],
      evidence: null,
    };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(resolvedEvidence, "utf8"));
  } catch {
    return {
      verified: false,
      blockers: ["backup_evidence_invalid_json"],
      evidence: null,
    };
  }
  if (raw?.schema_version !== "pulse-cutover-backup-evidence-v1") {
    blockers.push("backup_evidence_schema_invalid");
  }
  const backupId = String(raw?.backup_id || "").trim();
  const verifiedBy = String(raw?.verified_by || "").trim();
  const backupPath = raw?.backup_path
    ? path.resolve(path.dirname(resolvedEvidence), raw.backup_path)
    : null;
  const claimedBackupSha = String(raw?.backup_sha256 || "").trim();
  const sourceSha = String(raw?.source_database_sha256 || "").trim();
  const sqliteSidecars = sqliteSidecarSnapshot(databasePath);
  if (!backupId) blockers.push("backup_id_required");
  if (!verifiedBy) blockers.push("backup_verifier_required");
  if (!backupPath || !fs.existsSync(backupPath)) {
    blockers.push("backup_file_not_found");
  }
  if (backupPath && samePath(backupPath, databasePath)) {
    blockers.push("backup_must_be_distinct_from_database");
  }
  if (!SHA256_PATTERN.test(claimedBackupSha)) {
    blockers.push("backup_sha256_required");
  } else if (
    backupPath &&
    fs.existsSync(backupPath) &&
    hashFile(backupPath) !== claimedBackupSha.toLowerCase()
  ) {
    blockers.push("backup_sha256_mismatch");
  }
  if (!samePath(raw?.source_database_path, databasePath)) {
    blockers.push("backup_source_database_mismatch");
  }
  if (!SHA256_PATTERN.test(sourceSha)) {
    blockers.push("source_database_sha256_required");
  } else if (
    !allowSourceMismatch &&
    hashFile(databasePath) !== sourceSha.toLowerCase()
  ) {
    blockers.push("source_database_sha256_mismatch");
  }
  blockers.push(...checkpointedSqliteBlockers(sqliteSidecars));
  const verifiedAtMs = timestampMs(raw?.verified_at);
  const generatedAtMs = timestampMs(generatedAt);
  if (verifiedAtMs === null) {
    blockers.push("backup_verification_time_required");
  } else if (verifiedAtMs > generatedAtMs) {
    blockers.push("backup_verification_time_in_future");
  } else if (generatedAtMs - verifiedAtMs > BACKUP_MAX_AGE_MS) {
    blockers.push("backup_verification_stale");
  }
  if (String(raw?.restore_test_status || "").toUpperCase() !== "PASS") {
    blockers.push("backup_restore_test_required");
  }
  if (String(raw?.integrity_check || "").toLowerCase() !== "ok") {
    blockers.push("backup_integrity_check_required");
  }
  if (String(raw?.foreign_key_check || "").toLowerCase() !== "ok") {
    blockers.push("backup_foreign_key_check_required");
  }
  return {
    verified: blockers.length === 0,
    blockers: unique(blockers),
    evidence: {
      schema_version: raw?.schema_version || null,
      evidence_file: resolvedEvidence,
      evidence_file_sha256: hashFile(resolvedEvidence),
      backup_id: backupId || null,
      backup_path: backupPath,
      backup_sha256: SHA256_PATTERN.test(claimedBackupSha)
        ? claimedBackupSha.toLowerCase()
        : null,
      source_database_path: raw?.source_database_path || null,
      source_database_sha256: SHA256_PATTERN.test(sourceSha)
        ? sourceSha.toLowerCase()
        : null,
      sqlite_sidecars: sqliteSidecars,
      verified_at:
        verifiedAtMs === null ? null : new Date(verifiedAtMs).toISOString(),
      verified_by: verifiedBy || null,
      restore_test_status: raw?.restore_test_status || null,
      integrity_check: raw?.integrity_check || null,
      foreign_key_check: raw?.foreign_key_check || null,
    },
  };
}

function readExistingCutoverAudit({ databasePath, cutoverId } = {}) {
  const normalisedId = String(cutoverId || "").trim();
  if (!normalisedId) return null;
  return withReadOnlySqliteSnapshot(databasePath, (db) => {
    if (!tableNames(db).has("operator_audit_log")) return null;
    const row = db
      .prepare(
        `SELECT id, target_id, decision, evidence_json
         FROM operator_audit_log
         WHERE action = 'stabilisation_cutover_reconcile'
           AND target_id = ?
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(normalisedId);
    if (!row) return null;
    let evidence = {};
    try {
      evidence = JSON.parse(row.evidence_json || "{}");
    } catch {
      evidence = {};
    }
    return {
      id: row.id,
      target_id: row.target_id,
      decision: row.decision,
      request_fingerprint: evidence.request_fingerprint || null,
    };
  });
}

function applyEnvironmentBlockers(env = process.env) {
  const blockers = [];
  const pulseMode = String(env.PULSE_OPERATING_MODE || "")
    .trim()
    .toUpperCase();
  const aliasMode = String(env.OPERATING_MODE || "")
    .trim()
    .toUpperCase();
  if (
    (pulseMode || aliasMode) !== "HUMAN_REVIEW" ||
    (pulseMode && aliasMode && pulseMode !== aliasMode)
  ) {
    blockers.push("cutover_human_review_mode_required");
  }
  if (!truthy(env.PULSE_CUTOVER_RECONCILIATION_ENABLED)) {
    blockers.push("cutover_reconciliation_gate_required");
  }
  if (!truthy(env.PULSE_RECONCILIATION_MAINTENANCE)) {
    blockers.push("cutover_maintenance_mode_required");
  }
  if (
    !truthy(env.PULSE_EMERGENCY_KILL_SWITCH) &&
    !truthy(env.PULSE_KILL_SWITCH)
  ) {
    blockers.push("cutover_kill_switch_required");
  }
  if (!truthy(env.PULSE_CUTOVER_SCHEDULER_STOPPED)) {
    blockers.push("scheduler_stop_evidence_required");
  }
  if (!truthy(env.PULSE_CUTOVER_WORKERS_STOPPED)) {
    blockers.push("worker_stop_evidence_required");
  }
  if (!explicitlyFalse(env.AUTO_PUBLISH)) {
    blockers.push("auto_publish_must_be_false");
  }
  if (!explicitlyFalse(env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED)) {
    blockers.push("guarded_live_dispatch_must_be_false");
  }
  if (!explicitlyFalse(env.PULSE_PRIMARY_INSTANCE)) {
    blockers.push("primary_instance_must_be_false_during_cutover");
  }
  if (!truthy(env.USE_SQLITE)) blockers.push("sqlite_required");
  if (!truthy(env.USE_JOB_QUEUE)) blockers.push("durable_job_queue_required");
  if (
    String(env.PULSE_SCHEDULER_PROFILE || "").trim() !== "stabilisation_30d"
  ) {
    blockers.push("stabilisation_scheduler_profile_required");
  }
  if (!String(env.PULSE_CUTOVER_OPERATOR_ID || "").trim()) {
    blockers.push("cutover_operator_id_required");
  }
  if (!String(env.PULSE_CUTOVER_CHANGE_WINDOW_ID || "").trim()) {
    blockers.push("cutover_change_window_id_required");
  }
  if (SECONDARY_AUTOMATION_FLAGS.some((key) => truthy(env[key]))) {
    blockers.push("secondary_platform_automation_must_be_false");
  }
  return unique(blockers);
}

function isPublishFamily(kind) {
  const value = String(kind || "")
    .trim()
    .toLowerCase();
  return (
    /(^|_)(publish|upload|dispatch)(_|$)/.test(value) ||
    value === "instagram_pending_verify"
  );
}

function isNonGovernedDebt(kind) {
  const value = String(kind || "")
    .trim()
    .toLowerCase();
  return (
    NON_GOVERNED_DEBT_KINDS.has(value) ||
    value.startsWith("derivative_") ||
    value.startsWith("overnight_")
  );
}

function timestampMs(value) {
  if (!value) return null;
  let normalised = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(normalised)) {
    normalised = `${normalised.replace(" ", "T")}Z`;
  }
  const parsed = Date.parse(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

function staleLease(job, generatedAt, orphanGraceMin = 10) {
  if (!RUNNING_JOB_STATUSES.has(String(job?.status || "").toLowerCase())) {
    return false;
  }
  const nowMs = timestampMs(generatedAt);
  const leaseMs = timestampMs(job?.lease_until);
  if (leaseMs !== null) return leaseMs < nowMs;
  const claimedMs = timestampMs(job?.claimed_at);
  return (
    claimedMs !== null && claimedMs + Number(orphanGraceMin) * 60 * 1000 < nowMs
  );
}

function canonicalPublishSchedules() {
  const {
    STABILISATION_SCHEDULER_PROFILE,
    schedulesForProfile,
  } = require("../scheduler");
  return schedulesForProfile(STABILISATION_SCHEDULER_PROFILE)
    .filter((schedule) => schedule.kind === "publish")
    .map((schedule) => ({
      ...schedule,
      payload: {
        ...(schedule.payload || {}),
        idempotencyTemplate: schedule.idempotencyTemplate,
      },
    }));
}

function cutoverActions(inspection, { orphanGraceMin = 10 } = {}) {
  const actions = [];
  const blockers = [];
  for (const job of inspection.jobs) {
    const status = String(job.status || "").toLowerCase();
    if (!ACTIVE_JOB_STATUSES.has(status)) continue;
    const kind = String(job.kind || "")
      .trim()
      .toLowerCase();
    if (isPublishFamily(kind) || isNonGovernedDebt(kind)) {
      actions.push({
        action: "QUARANTINE",
        target_type: "job",
        target_id: job.id,
        target: `job:${job.id}:${kind}`,
        reason: isPublishFamily(kind)
          ? "publish_family_requires_fresh_human_review"
          : "non_governed_autonomous_debt_frozen",
        from_status: status,
        to_status: "cancelled",
      });
      continue;
    }
    if (
      RUNNING_JOB_STATUSES.has(status) &&
      SAFE_REQUEUE_KINDS.has(kind) &&
      staleLease(job, inspection.generated_at, orphanGraceMin)
    ) {
      const exhausted =
        Number(job.attempt_count || 0) >= Number(job.max_attempts || 0);
      actions.push({
        action: exhausted
          ? "FAIL_EXPIRED_SAFE_LEASE"
          : "REQUEUE_EXPIRED_SAFE_LEASE",
        target_type: "job",
        target_id: job.id,
        target: `job:${job.id}:${kind}`,
        reason: "existing_job_lease_reaper_semantics",
        from_status: status,
        to_status: exhausted ? "failed" : "pending",
      });
      continue;
    }
    if (RUNNING_JOB_STATUSES.has(status)) {
      const action = SAFE_REQUEUE_KINDS.has(kind)
        ? "HOLD_ACTIVE_LEASE"
        : "HOLD_MANUAL_REVIEW";
      actions.push({
        action,
        target_type: "job",
        target_id: job.id,
        target: `job:${job.id}:${kind}`,
        reason:
          action === "HOLD_ACTIVE_LEASE"
            ? "live_or_unexpired_lease_must_not_be_stolen"
            : "unknown_job_kind_requires_operator_review",
        from_status: status,
        to_status: status,
      });
      blockers.push(
        action === "HOLD_ACTIVE_LEASE"
          ? `active_job_lease_present:${job.id}:${kind}`
          : `manual_job_review_required:${job.id}:${kind}`,
      );
      continue;
    }
    if (status === "pending" && !SAFE_REQUEUE_KINDS.has(kind)) {
      actions.push({
        action: "HOLD_MANUAL_REVIEW",
        target_type: "job",
        target_id: job.id,
        target: `job:${job.id}:${kind}`,
        reason: "unknown_job_kind_requires_operator_review",
        from_status: status,
        to_status: status,
      });
      blockers.push(`manual_job_review_required:${job.id}:${kind}`);
    }
  }

  const canonical = canonicalPublishSchedules();
  const canonicalNames = new Set(canonical.map((row) => row.name));
  for (const schedule of inspection.schedules) {
    if (
      schedule.enabled === 0 ||
      schedule.enabled === false ||
      canonicalNames.has(schedule.name)
    ) {
      continue;
    }
    if (
      isPublishFamily(schedule.kind) ||
      isPublishFamily(schedule.name) ||
      isNonGovernedDebt(schedule.kind)
    ) {
      actions.push({
        action: "DISABLE",
        target_type: "schedule",
        target_id: schedule.id,
        target: schedule.name,
        reason: isPublishFamily(schedule.kind)
          ? "legacy_publish_window_disabled"
          : "non_governed_autonomous_schedule_frozen",
      });
    }
  }
  for (const schedule of canonical) {
    actions.push({
      action: "UPSERT_GOVERNED_WINDOW",
      target_type: "schedule",
      target_id:
        inspection.schedules.find((row) => row.name === schedule.name)?.id ||
        null,
      target: schedule.name,
      reason: "canonical_stabilisation_publish_window",
      definition: {
        kind: schedule.kind,
        channel_id: schedule.channel_id || null,
        cron_expr: schedule.cron_expr,
        payload: schedule.payload,
        requires_gpu: schedule.requires_gpu ? 1 : 0,
        priority: schedule.priority ?? 50,
      },
    });
  }
  return { actions, blockers, canonical };
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const options = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply") {
      options.apply = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`unexpected_argument:${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing_value:${key}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function requiredDatabasePath(databasePath) {
  const resolved = path.resolve(String(databasePath || "").trim());
  if (!databasePath || !fs.existsSync(resolved)) {
    throw new Error("cutover_database_required");
  }
  return resolved;
}

function tableNames(db) {
  return new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
}

function inspectOpenDatabase(db, { databasePath, generatedAt }) {
  const tables = tableNames(db);
  const read = (table, sql) => (tables.has(table) ? db.prepare(sql).all() : []);
  const quick = db.prepare("PRAGMA quick_check").all();
  const integrity = db.prepare("PRAGMA integrity_check").all();
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  return {
    database_path: databasePath,
    generated_at: new Date(generatedAt).toISOString(),
    tables: [...tables].sort(),
    migrations: read(
      "schema_migrations",
      "SELECT version, filename, checksum, applied_at FROM schema_migrations ORDER BY version",
    ),
    jobs: read(
      "jobs",
      `SELECT id, kind, channel_id, story_id, status, attempt_count,
              max_attempts, claimed_by, claimed_at, lease_until,
              run_at, last_error
       FROM jobs
       ORDER BY id`,
    ),
    schedules: read(
      "schedules",
      `SELECT id, name, kind, channel_id, cron_expr, payload, enabled,
              requires_gpu, priority
       FROM schedules
       ORDER BY id`,
    ),
    runtime_leases: read(
      "runtime_leases",
      `SELECT name, owner_id, acquired_at, heartbeat_at, expires_at,
              metadata
       FROM runtime_leases
       ORDER BY name`,
    ),
    integrity: {
      quick_check:
        quick.length === 1 &&
        String(Object.values(quick[0])[0]).toLowerCase() === "ok"
          ? "ok"
          : "failed",
      integrity_check:
        integrity.length === 1 &&
        String(Object.values(integrity[0])[0]).toLowerCase() === "ok"
          ? "ok"
          : "failed",
      foreign_key_check: foreignKeys.length === 0 ? "ok" : "failed",
    },
  };
}

function inspectDatabase({ databasePath, generatedAt }) {
  return withReadOnlySqliteSnapshot(databasePath, (db, resolved) => {
    return inspectOpenDatabase(db, {
      databasePath: resolved,
      generatedAt,
    });
  });
}

function buildCutoverPlan({
  inspection,
  applyRequested = false,
  cutoverId = null,
  sourceCommitSha = null,
  runtimeCommitSha = null,
  orphanGraceMin = 10,
  confirmationId = null,
  backupVerification = null,
  env = process.env,
} = {}) {
  const blockers = [];
  if (!applyRequested) blockers.push("explicit_apply_required");
  const normalisedCutoverId = String(cutoverId || "").trim();
  if (!normalisedCutoverId) blockers.push("cutover_id_required");
  if (
    applyRequested &&
    (!normalisedCutoverId ||
      String(confirmationId || "").trim() !== normalisedCutoverId)
  ) {
    blockers.push("matching_cutover_confirmation_required");
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
  for (const [name, status] of Object.entries(inspection.integrity)) {
    if (status !== "ok") blockers.push(`database_${name}_failed`);
  }
  for (const required of [
    "jobs",
    "job_runs",
    "schedules",
    "runtime_leases",
    "operator_audit_log",
  ]) {
    if (!inspection.tables.includes(required)) {
      blockers.push(`required_table_missing:${required}`);
    }
  }
  if (
    !inspection.migrations.some(
      (migration) => String(migration.version) === "020",
    )
  ) {
    blockers.push("governance_migration_020_required");
  }
  const planned = cutoverActions(inspection, { orphanGraceMin });
  blockers.push(...planned.blockers);
  blockers.push(
    ...(backupVerification?.blockers || ["backup_evidence_file_required"]),
  );
  blockers.push(...applyEnvironmentBlockers(env));
  const generatedAtMs = timestampMs(inspection.generated_at);
  for (const lease of inspection.runtime_leases) {
    if (
      lease.name === "scheduler:primary" &&
      timestampMs(lease.expires_at) > generatedAtMs
    ) {
      blockers.push("active_scheduler_lease_present");
    }
  }
  blockers.push(
    ...checkpointedSqliteBlockers(
      sqliteSidecarSnapshot(inspection.database_path),
    ),
  );
  const uniqueBlockers = unique(blockers);
  const applyAuthorised =
    Boolean(applyRequested) && uniqueBlockers.length === 0;
  const request = {
    cutover_id: normalisedCutoverId || null,
    database_path: inspection.database_path,
    source_commit_sha: sourceCommitSha,
    runtime_commit_sha: runtimeCommitSha,
    backup_id: backupVerification?.evidence?.backup_id || null,
    backup_evidence_file_sha256:
      backupVerification?.evidence?.evidence_file_sha256 || null,
    operator_id: String(env.PULSE_CUTOVER_OPERATOR_ID || "").trim() || null,
    change_window_id:
      String(env.PULSE_CUTOVER_CHANGE_WINDOW_ID || "").trim() || null,
  };
  const planCore = {
    cutover_id: normalisedCutoverId || null,
    generated_at: inspection.generated_at,
    source_commit_sha: sourceCommitSha,
    runtime_commit_sha: runtimeCommitSha,
    database: {
      path: inspection.database_path,
      integrity: inspection.integrity,
      read_only_inspection: true,
    },
    apply_requested: Boolean(applyRequested),
    apply_authorised: applyAuthorised,
    request_fingerprint: fingerprint(request),
    operator: {
      actor_id: request.operator_id,
      change_window_id: request.change_window_id,
    },
    backup_evidence: backupVerification?.evidence || null,
    orphan_grace_minutes: Number(orphanGraceMin),
    canonical_publish_windows: planned.canonical.map((schedule) => ({
      name: schedule.name,
      cron_expr: schedule.cron_expr,
      target_platform: schedule.payload.target_platform,
    })),
    actions: planned.actions,
    blockers: uniqueBlockers,
    safety: {
      external_calls: [],
      external_objects_created: false,
      oauth_or_tokens_mutated: false,
      scheduler_lease_claimed: false,
    },
  };
  return {
    schema_version: "pulse-stabilisation-cutover-plan-v1",
    ...planCore,
    verdict: applyAuthorised ? "READY_TO_APPLY" : "HOLD",
    plan_sha256: fingerprint(planCore),
  };
}

function assertPostCutoverState(db) {
  const enabledPublish = db
    .prepare(
      `SELECT name, cron_expr, payload
       FROM schedules
       WHERE kind = 'publish' AND enabled = 1
       ORDER BY name`,
    )
    .all();
  const expected = canonicalPublishSchedules();
  if (
    enabledPublish.length !== expected.length ||
    expected.some((schedule, index) => {
      const actual = enabledPublish[index];
      if (
        !actual ||
        actual.name !== schedule.name ||
        actual.cron_expr !== schedule.cron_expr
      ) {
        return true;
      }
      try {
        return (
          stableJson(JSON.parse(actual.payload || "{}")) !==
          stableJson(schedule.payload)
        );
      } catch {
        return true;
      }
    })
  ) {
    throw new Error("post_cutover_publish_schedule_verification_failed");
  }
  const riskySchedules = db
    .prepare(
      `SELECT id, name, kind
       FROM schedules
       WHERE enabled = 1`,
    )
    .all()
    .filter(
      (schedule) =>
        !expected.some((row) => row.name === schedule.name) &&
        (isPublishFamily(schedule.kind) ||
          isPublishFamily(schedule.name) ||
          isNonGovernedDebt(schedule.kind)),
    );
  if (riskySchedules.length) {
    throw new Error("post_cutover_risky_schedule_still_enabled");
  }
  const activeRiskyJobs = db
    .prepare(
      `SELECT id, kind, status
       FROM jobs
       WHERE status IN ('pending', 'claimed', 'running')`,
    )
    .all()
    .filter((job) => isPublishFamily(job.kind) || isNonGovernedDebt(job.kind));
  if (activeRiskyJobs.length) {
    throw new Error("post_cutover_risky_job_still_active");
  }
  const quick = db.prepare("PRAGMA quick_check").all();
  const integrity = db.prepare("PRAGMA integrity_check").all();
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  const checks = {
    quick_check:
      quick.length === 1 &&
      String(Object.values(quick[0])[0]).toLowerCase() === "ok"
        ? "ok"
        : "failed",
    integrity_check:
      integrity.length === 1 &&
      String(Object.values(integrity[0])[0]).toLowerCase() === "ok"
        ? "ok"
        : "failed",
    foreign_key_check: foreignKeys.length === 0 ? "ok" : "failed",
  };
  if (Object.values(checks).some((value) => value !== "ok")) {
    throw new Error("post_cutover_database_integrity_failed");
  }
  return {
    ...checks,
    enabled_publish_windows: enabledPublish.map((row) => row.name),
    active_risky_job_count: activeRiskyJobs.length,
    enabled_risky_schedule_count: riskySchedules.length,
  };
}

function executeCutoverApply({
  databasePath,
  plan,
  env = process.env,
  DatabaseImpl = null,
  allowSourceMismatch = false,
} = {}) {
  if (!plan?.apply_authorised || plan?.verdict !== "READY_TO_APPLY") {
    throw new Error("cutover_apply_not_authorised");
  }
  const resolved = requiredDatabasePath(databasePath);
  const expectedSourceSha256 =
    plan?.backup_evidence?.source_database_sha256;
  const preOpenBlockers = sqliteMutationBoundaryBlockers({
    databasePath: resolved,
    expectedSourceSha256,
    allowSharedMemory: false,
    allowSourceMismatch,
  });
  if (preOpenBlockers.length) {
    throw new Error(preOpenBlockers[0]);
  }
  const Database = DatabaseImpl || require("better-sqlite3");
  const db = new Database(resolved, {
    fileMustExist: true,
  });
  db.pragma("foreign_keys = ON");
  try {
    const apply = db.transaction(() => {
      const transactionBoundaryBlockers =
        sqliteMutationBoundaryBlockers({
          databasePath: resolved,
          expectedSourceSha256,
          allowSharedMemory: true,
          allowSourceMismatch,
        });
      if (transactionBoundaryBlockers.length) {
        throw new Error(transactionBoundaryBlockers[0]);
      }
      const existing = db
        .prepare(
          `SELECT *
           FROM operator_audit_log
           WHERE action = 'stabilisation_cutover_reconcile'
             AND target_id = ?
           ORDER BY id DESC
           LIMIT 1`,
        )
        .get(plan.cutover_id);
      if (existing) {
        let evidence = {};
        try {
          evidence = JSON.parse(existing.evidence_json || "{}");
        } catch {
          evidence = {};
        }
        if (evidence.request_fingerprint !== plan.request_fingerprint) {
          return {
            idempotency_conflict: true,
            existing_audit_id: existing.id,
          };
        }
        try {
          assertPostCutoverState(db);
        } catch {
          return {
            idempotency_state_drift: true,
            existing_audit_id: existing.id,
          };
        }
        return {
          idempotent: true,
          existing_audit_id: existing.id,
          prior_mutations: evidence.mutations_performed || [],
          post_cutover_checks: evidence.post_cutover_checks || null,
        };
      }

      const currentInspection = inspectOpenDatabase(db, {
        databasePath: resolved,
        generatedAt: plan.generated_at,
      });
      const currentActions = cutoverActions(currentInspection, {
        orphanGraceMin: plan.orphan_grace_minutes,
      });
      if (fingerprint(currentActions.actions) !== fingerprint(plan.actions)) {
        throw new Error("cutover_plan_drift");
      }
      if (currentActions.blockers.length) {
        throw new Error("cutover_plan_became_blocked");
      }

      const mutations = [];
      const quarantine = db.prepare(`
        UPDATE jobs
        SET status = 'cancelled',
            last_error = CASE
              WHEN last_error IS NULL OR TRIM(last_error) = ''
                THEN @reason
              ELSE last_error || char(10) || @reason
            END,
            claimed_by = NULL,
            claimed_at = NULL,
            lease_until = NULL,
            completed_at = COALESCE(completed_at, @timestamp),
            updated_at = @timestamp
        WHERE id = @id AND status = @fromStatus
      `);
      const reapSafe = db.prepare(`
        UPDATE jobs
        SET status = CASE
              WHEN attempt_count >= max_attempts THEN 'failed'
              ELSE 'pending'
            END,
            claimed_by = NULL,
            claimed_at = NULL,
            lease_until = NULL,
            completed_at = CASE
              WHEN attempt_count >= max_attempts THEN @timestamp
              ELSE completed_at
            END,
            last_error = COALESCE(
              last_error,
              'reaped: stale claim (' || COALESCE(@claimedBy, 'unknown') || ')'
            ),
            updated_at = @timestamp
        WHERE id = @id AND status = @fromStatus
      `);
      const finishRuns = db.prepare(`
        UPDATE job_runs
        SET status = 'failed',
            finished_at = @timestamp,
            duration_ms = CAST(
              (julianday(@timestamp) - julianday(started_at)) * 86400000
              AS INTEGER
            ),
            error_message = @error
        WHERE job_id = @jobId
          AND worker_id = @workerId
          AND finished_at IS NULL
      `);
      const disableSchedule = db.prepare(`
        UPDATE schedules SET enabled = 0
        WHERE id = ? AND enabled <> 0
      `);
      const upsertSchedule = db.prepare(`
        INSERT INTO schedules
          (name, kind, channel_id, cron_expr, payload, enabled,
           requires_gpu, priority)
        VALUES
          (@name, @kind, @channelId, @cronExpr, @payload, 1,
           @requiresGpu, @priority)
        ON CONFLICT(name) DO UPDATE SET
          kind = excluded.kind,
          channel_id = excluded.channel_id,
          cron_expr = excluded.cron_expr,
          payload = excluded.payload,
          enabled = 1,
          requires_gpu = excluded.requires_gpu,
          priority = excluded.priority
      `);

      for (const action of plan.actions) {
        if (action.action === "QUARANTINE") {
          const before = currentInspection.jobs.find(
            (job) => job.id === action.target_id,
          );
          const reason =
            `stabilisation_cutover_quarantine:${plan.cutover_id}:` +
            action.reason;
          const changed = quarantine.run({
            id: action.target_id,
            fromStatus: action.from_status,
            reason,
            timestamp: plan.generated_at,
          }).changes;
          if (changed !== 1) throw new Error("cutover_plan_drift");
          if (before?.claimed_by) {
            finishRuns.run({
              jobId: action.target_id,
              workerId: before.claimed_by,
              timestamp: plan.generated_at,
              error: "stabilisation_cutover_quarantined",
            });
          }
        } else if (
          action.action === "REQUEUE_EXPIRED_SAFE_LEASE" ||
          action.action === "FAIL_EXPIRED_SAFE_LEASE"
        ) {
          const before = currentInspection.jobs.find(
            (job) => job.id === action.target_id,
          );
          const changed = reapSafe.run({
            id: action.target_id,
            fromStatus: action.from_status,
            claimedBy: before?.claimed_by || null,
            timestamp: plan.generated_at,
          }).changes;
          if (changed !== 1) throw new Error("cutover_plan_drift");
          finishRuns.run({
            jobId: action.target_id,
            workerId: before?.claimed_by,
            timestamp: plan.generated_at,
            error: "job_lease_expired_and_reaped",
          });
        } else if (action.action === "DISABLE") {
          if (disableSchedule.run(action.target_id).changes !== 1) {
            throw new Error("cutover_plan_drift");
          }
        } else if (action.action === "UPSERT_GOVERNED_WINDOW") {
          const definition = action.definition;
          upsertSchedule.run({
            name: action.target,
            kind: definition.kind,
            channelId: definition.channel_id,
            cronExpr: definition.cron_expr,
            payload: JSON.stringify(definition.payload),
            requiresGpu: definition.requires_gpu,
            priority: definition.priority,
          });
        } else {
          throw new Error(`unsupported_cutover_action:${action.action}`);
        }
        mutations.push({
          action: action.action,
          target_type: action.target_type,
          target_id: action.target_id,
          target: action.target,
          reason: action.reason,
        });
      }

      const postCutoverChecks = assertPostCutoverState(db);
      const safety = {
        external_calls: [],
        external_objects_created: false,
        oauth_or_tokens_mutated: false,
        scheduler_lease_claimed: false,
      };
      const auditEvidence = {
        schema_version: "pulse-stabilisation-cutover-audit-v1",
        cutover_id: plan.cutover_id,
        generated_at: plan.generated_at,
        request_fingerprint: plan.request_fingerprint,
        plan_sha256: plan.plan_sha256,
        source_commit_sha: plan.source_commit_sha,
        runtime_commit_sha: plan.runtime_commit_sha,
        backup: plan.backup_evidence,
        operator: plan.operator,
        mutations_performed: mutations,
        post_cutover_checks: postCutoverChecks,
        safety,
      };
      const audit = db
        .prepare(
          `INSERT INTO operator_audit_log
             (actor_id, action, target_type, target_id, decision, reason,
              evidence_json, created_at)
           VALUES
             (?, 'stabilisation_cutover_reconcile', 'sqlite_database', ?,
              'APPLIED', ?, ?, ?)`,
        )
        .run(
          String(env.PULSE_CUTOVER_OPERATOR_ID).trim(),
          plan.cutover_id,
          String(env.PULSE_CUTOVER_CHANGE_WINDOW_ID).trim(),
          JSON.stringify(auditEvidence),
          plan.generated_at,
        );
      return {
        idempotent: false,
        audit_id: Number(audit.lastInsertRowid),
        mutations,
        post_cutover_checks: postCutoverChecks,
      };
    });
    const applied =
      typeof apply.immediate === "function" ? apply.immediate() : apply();
    if (applied.idempotency_conflict) {
      return {
        schema_version: "pulse-stabilisation-cutover-result-v1",
        generated_at: plan.generated_at,
        cutover_id: plan.cutover_id,
        mode: "DRY_RUN",
        verdict: "HOLD",
        apply_requested: true,
        apply_authorised: false,
        plan_sha256: plan.plan_sha256,
        blockers: ["cutover_idempotency_conflict"],
        mutations_performed: [],
        existing_audit_id: applied.existing_audit_id,
        safety: {
          production_database_mutated: false,
          external_calls: [],
          external_objects_created: false,
          oauth_or_tokens_mutated: false,
          scheduler_lease_claimed: false,
        },
      };
    }
    if (applied.idempotency_state_drift) {
      return {
        schema_version: "pulse-stabilisation-cutover-result-v1",
        generated_at: plan.generated_at,
        cutover_id: plan.cutover_id,
        mode: "DRY_RUN",
        verdict: "HOLD",
        apply_requested: true,
        apply_authorised: false,
        plan_sha256: plan.plan_sha256,
        blockers: ["cutover_idempotent_state_drift"],
        mutations_performed: [],
        existing_audit_id: applied.existing_audit_id,
        safety: {
          production_database_mutated: false,
          external_calls: [],
          external_objects_created: false,
          oauth_or_tokens_mutated: false,
          scheduler_lease_claimed: false,
        },
      };
    }
    return {
      schema_version: "pulse-stabilisation-cutover-result-v1",
      generated_at: plan.generated_at,
      cutover_id: plan.cutover_id,
      mode: "APPLY",
      verdict: applied.idempotent ? "IDEMPOTENT_NOOP" : "APPLIED",
      apply_requested: true,
      apply_authorised: true,
      plan_sha256: plan.plan_sha256,
      blockers: [],
      mutations_performed: applied.idempotent ? [] : applied.mutations,
      prior_mutations: applied.prior_mutations || [],
      audit_id: applied.audit_id || applied.existing_audit_id,
      post_cutover_checks: applied.post_cutover_checks,
      safety: {
        production_database_mutated: !applied.idempotent,
        external_calls: [],
        external_objects_created: false,
        oauth_or_tokens_mutated: false,
        scheduler_lease_claimed: false,
      },
    };
  } finally {
    db.close();
  }
}

function dryRunResult(plan) {
  return {
    schema_version: "pulse-stabilisation-cutover-result-v1",
    generated_at: plan.generated_at,
    cutover_id: plan.cutover_id,
    mode: "DRY_RUN",
    verdict: "HOLD",
    apply_requested: plan.apply_requested,
    apply_authorised: false,
    plan_sha256: plan.plan_sha256,
    blockers: plan.blockers,
    mutations_performed: [],
    safety: {
      production_database_mutated: false,
      external_calls: [],
      external_objects_created: false,
      oauth_or_tokens_mutated: false,
      scheduler_lease_claimed: false,
    },
  };
}

function safeErrorCode(error) {
  const message = String(error?.message || error || "unknown");
  return (
    message
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9:_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 160) || "unknown"
  );
}

function failedApplyResult({ plan, error, rollbackVerified }) {
  const code = safeErrorCode(error);
  return {
    schema_version: "pulse-stabilisation-cutover-result-v1",
    generated_at: plan.generated_at,
    cutover_id: plan.cutover_id,
    mode: "APPLY",
    verdict: "ROLLED_BACK",
    apply_requested: true,
    apply_authorised: true,
    plan_sha256: plan.plan_sha256,
    blockers: [`apply_failed:${code}`],
    mutations_performed: [],
    rollback_verified: rollbackVerified === true,
    safety: {
      production_database_mutated: rollbackVerified === true ? false : null,
      external_calls: [],
      external_objects_created: false,
      oauth_or_tokens_mutated: false,
      scheduler_lease_claimed: false,
    },
  };
}

function renderPlanMarkdown(plan) {
  const lines = [
    "# Stabilisation Cutover Plan",
    "",
    `Generated: ${plan.generated_at}`,
    `Cutover ID: ${plan.cutover_id || "missing"}`,
    `Verdict: ${plan.verdict}`,
    `Apply requested: ${plan.apply_requested ? "yes" : "no"}`,
    `Apply authorised: ${plan.apply_authorised ? "yes" : "no"}`,
    "",
    "## Planned actions",
    "",
  ];
  if (!plan.actions.length) lines.push("- none");
  for (const action of plan.actions) {
    lines.push(`- ${action.action}: ${action.target}`);
  }
  lines.push("", "## Blockers", "");
  if (!plan.blockers.length) lines.push("- none");
  else for (const blocker of plan.blockers) lines.push(`- ${blocker}`);
  lines.push(
    "",
    "> A plan is not publication authority. No scheduler lease or external create boundary is entered.",
    "",
  );
  return lines.join("\n");
}

function renderResultMarkdown(result) {
  const lines = [
    "# Stabilisation Cutover Result",
    "",
    `Generated: ${result.generated_at}`,
    `Cutover ID: ${result.cutover_id || "missing"}`,
    `Mode: ${result.mode}`,
    `Verdict: ${result.verdict}`,
    `Database mutated: ${result.safety.production_database_mutated ? "yes" : "no"}`,
    "",
    "## Mutations",
    "",
  ];
  if (!result.mutations_performed.length) lines.push("- none");
  for (const mutation of result.mutations_performed) {
    lines.push(`- ${mutation.action}: ${mutation.target}`);
  }
  lines.push("", "## Blockers", "");
  if (!result.blockers.length) lines.push("- none");
  else for (const blocker of result.blockers) lines.push(`- ${blocker}`);
  lines.push(
    "",
    "> No external object was created, no OAuth material was changed and no scheduler lease was claimed.",
    "",
  );
  return lines.join("\n");
}

function writeCutoverArtifacts({ outDir, plan, result }) {
  const resolved = path.resolve(String(outDir || "").trim());
  if (!outDir) throw new Error("cutover_output_directory_required");
  fs.mkdirSync(resolved, { recursive: true });
  const files = {
    plan_json: path.join(resolved, "stabilisation_cutover_plan.json"),
    plan_markdown: path.join(resolved, "stabilisation_cutover_plan.md"),
    result_json: path.join(resolved, "stabilisation_cutover_result.json"),
    result_markdown: path.join(resolved, "stabilisation_cutover_result.md"),
  };
  fs.writeFileSync(
    files.plan_json,
    `${JSON.stringify(plan, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(files.plan_markdown, renderPlanMarkdown(plan), "utf8");
  fs.writeFileSync(
    files.result_json,
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(files.result_markdown, renderResultMarkdown(result), "utf8");
  return files;
}

module.exports = {
  SHA256_PATTERN,
  buildCutoverPlan,
  checkpointedSqliteBlockers,
  dryRunResult,
  executeCutoverApply,
  failedApplyResult,
  fingerprint,
  hashFile,
  inspectDatabase,
  parseCliArgs,
  readExistingCutoverAudit,
  renderPlanMarkdown,
  renderResultMarkdown,
  sqliteMutationBoundaryBlockers,
  sqliteSidecarSnapshot,
  verifyBackupEvidence,
  withReadOnlySqliteSnapshot,
  writeCutoverArtifacts,
};

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  SHA256_PATTERN,
  sqliteMutationBoundaryBlockers,
  hashFile,
  verifyBackupEvidence,
  withReadOnlySqliteSnapshot,
} = require("./stabilisation-cutover-reconcile");

const RESULT_SCHEMA_VERSION =
  "pulse-governed-worker-containment-result-v1";
const WORKER_CONTAINMENT_CONFIRMATION =
  "I CONFIRM PULSE SCHEDULER AND WORKERS ARE STOPPED; SET ACTIVE WORKERS OFFLINE";
const GENERATED_AT_MAX_SKEW_MS = 5 * 60 * 1000;
const AUDIT_ACTION = "GOVERNED_WORKER_CONTAINMENT";
const AUDIT_SCHEMA_VERSION = "pulse-worker-containment-audit-v1";

class GovernedWorkerContainmentError extends Error {
  constructor(codes) {
    const normalised = unique(Array.isArray(codes) ? codes : [codes]);
    super(
      `governed_worker_containment_failed: ${normalised.join(", ")}`,
    );
    this.name = "GovernedWorkerContainmentError";
    this.codes = normalised;
  }
}

function text(value) {
  return String(value || "").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(text(value));
}

function explicitlyFalse(value) {
  return /^(false|0|no|off)$/i.test(text(value));
}

function pathKey(filePath) {
  const resolved = path.resolve(String(filePath || "")).replace(/\\/g, "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  if (!left || !right) return false;
  try {
    return (
      pathKey(fs.realpathSync.native(left)) ===
      pathKey(fs.realpathSync.native(right))
    );
  } catch {
    return pathKey(left) === pathKey(right);
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

function columnNames(db, tableName) {
  return new Set(
    db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .map((column) => column.name),
  );
}

function requiredColumns(db, tableName, expected, blockers) {
  if (!tableExists(db, tableName)) return;
  const actual = columnNames(db, tableName);
  for (const column of expected) {
    if (!actual.has(column)) {
      blockers.push(`${tableName}_${column}_column_required`);
    }
  }
}

function inspectOpenDatabase(db, generatedAt) {
  const blockers = [];
  for (const tableName of [
    "workers",
    "jobs",
    "runtime_leases",
    "operator_audit_log",
  ]) {
    if (!tableExists(db, tableName)) {
      blockers.push(`${tableName}_table_required`);
    }
  }
  if (!tableExists(db, "schema_migrations")) {
    blockers.push("schema_migrations_table_required");
  } else {
    const migration = db
      .prepare(
        `SELECT filename, checksum FROM schema_migrations
         WHERE version = '023'`,
      )
      .get();
    const migrationPath = path.join(
      __dirname,
      "..",
      "..",
      "db",
      "migrations",
      "023_stabilisation_governance_hardening.sql",
    );
    if (!migration) {
      blockers.push("migration_023_required");
    } else if (
      migration.filename !==
        "023_stabilisation_governance_hardening.sql" ||
      migration.checksum !== hashFile(migrationPath)
    ) {
      blockers.push("migration_023_integrity_mismatch");
    }
  }
  requiredColumns(
    db,
    "workers",
    ["id", "status", "last_job_id", "last_seen_at"],
    blockers,
  );
  requiredColumns(
    db,
    "jobs",
    ["id", "status", "claimed_by", "claimed_at", "lease_until"],
    blockers,
  );
  requiredColumns(
    db,
    "runtime_leases",
    ["name", "owner_id", "expires_at"],
    blockers,
  );
  requiredColumns(
    db,
    "operator_audit_log",
    [
      "id",
      "actor_id",
      "action",
      "target_type",
      "target_id",
      "decision",
      "reason",
      "evidence_json",
      "idempotency_key",
      "created_at",
    ],
    blockers,
  );
  if (tableExists(db, "operator_audit_log")) {
    for (const triggerName of [
      "trg_operator_audit_log_immutable_update",
      "trg_operator_audit_log_immutable_delete",
    ]) {
      if (
        !db
          .prepare(
            `SELECT 1 FROM sqlite_master
             WHERE type = 'trigger' AND name = ?`,
          )
          .get(triggerName)
      ) {
        blockers.push(`${triggerName}_required`);
      }
    }
  }
  if (blockers.length) {
    return {
      blockers,
      target_worker_ids: [],
      preserved_locked_worker_ids: [],
      existing_offline_worker_ids: [],
      active_runtime_lease_count: null,
      claimed_or_running_job_count: null,
    };
  }
  const workers = db
    .prepare(
      `SELECT id, status, last_job_id, last_seen_at
       FROM workers ORDER BY id`,
    )
    .all();
  const targetWorkers = workers.filter(
    (worker) => !["offline", "locked"].includes(text(worker.status)),
  );
  const lockedWorkers = workers.filter(
    (worker) => text(worker.status) === "locked",
  );
  const offlineWorkers = workers.filter(
    (worker) => text(worker.status) === "offline",
  );
  const activeLeases = db
    .prepare(
      `SELECT name, owner_id, expires_at
       FROM runtime_leases
       WHERE julianday(expires_at) IS NULL
          OR julianday(expires_at) > julianday(?)
       ORDER BY name`,
    )
    .all(generatedAt);
  const activeJobs = db
    .prepare(
      `SELECT id, kind, status, claimed_by, claimed_at, lease_until
       FROM jobs
       WHERE status IN ('claimed', 'running')
       ORDER BY id`,
    )
    .all();
  return {
    blockers,
    target_worker_ids: targetWorkers.map((worker) => worker.id),
    target_workers: targetWorkers,
    preserved_locked_worker_ids: lockedWorkers.map((worker) => worker.id),
    existing_offline_worker_ids: offlineWorkers.map((worker) => worker.id),
    active_runtime_lease_count: activeLeases.length,
    active_runtime_leases: activeLeases,
    claimed_or_running_job_count: activeJobs.length,
    claimed_or_running_jobs: activeJobs,
  };
}

function buildResult({
  generatedAt,
  databasePath,
  mode,
  verdict,
  blockers = [],
  inspection = null,
  mutated = false,
  idempotent = false,
  change = null,
} = {}) {
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    generated_at: generatedAt,
    mode,
    verdict,
    mutated,
    idempotent,
    database_path: databasePath || null,
    blockers,
    inspection,
    change,
    safety: {
      scheduler_started: false,
      workers_started: false,
      external_calls: [],
      oauth_or_tokens_mutated: false,
      platform_objects_created: false,
      jobs_mutated: false,
      runtime_leases_mutated: false,
    },
  };
}

function pairedTextBlockers({
  value,
  confirmation,
  requiredCode,
  confirmationCode,
  mismatchCode,
}) {
  const blockers = [];
  const expected = text(value);
  const confirmed = text(confirmation);
  if (!expected) blockers.push(requiredCode);
  if (!confirmed) {
    blockers.push(confirmationCode);
  } else if (!expected || confirmed !== expected) {
    blockers.push(mismatchCode);
  }
  return blockers;
}

function verifyContainmentBackupEvidence({
  evidencePath,
  databasePath,
  generatedAt,
} = {}) {
  const base = verifyBackupEvidence({
    evidencePath,
    databasePath,
    generatedAt,
  });
  const blockers = [...base.blockers];
  let raw = null;
  const resolvedEvidencePath = evidencePath
    ? path.resolve(evidencePath)
    : null;
  if (resolvedEvidencePath && fs.existsSync(resolvedEvidencePath)) {
    try {
      raw = JSON.parse(fs.readFileSync(resolvedEvidencePath, "utf8"));
    } catch {
      // The canonical verifier already emits the invalid JSON blocker.
    }
  }
  if (raw) {
    if (text(raw.quick_check).toLowerCase() !== "ok") {
      blockers.push("backup_quick_check_required");
    }
    if (raw.backup_restore_hashes_match !== true) {
      blockers.push("backup_restore_hash_match_required");
    }
    if (raw.production_database_mutated !== false) {
      blockers.push(
        "backup_production_database_unmutated_evidence_required",
      );
    }
    const restorePath = raw.restore_path
      ? path.resolve(
          path.dirname(resolvedEvidencePath),
          String(raw.restore_path),
        )
      : null;
    const claimedRestoreSha = text(raw.restore_sha256).toLowerCase();
    if (!restorePath || !fs.existsSync(restorePath)) {
      blockers.push("restored_copy_file_required");
    } else {
      if (
        samePath(restorePath, databasePath) ||
        samePath(restorePath, base.evidence?.backup_path)
      ) {
        blockers.push("restored_copy_must_be_distinct");
      }
      if (!SHA256_PATTERN.test(claimedRestoreSha)) {
        blockers.push("restored_copy_sha256_required");
      } else if (hashFile(restorePath) !== claimedRestoreSha) {
        blockers.push("restored_copy_sha256_mismatch");
      }
      if (
        SHA256_PATTERN.test(claimedRestoreSha) &&
        claimedRestoreSha !== base.evidence?.backup_sha256
      ) {
        blockers.push("backup_restore_sha256_mismatch");
      }
    }
    if (
      raw.backup_restore_hashes_match === true &&
      base.evidence?.backup_sha256 &&
      SHA256_PATTERN.test(claimedRestoreSha) &&
      claimedRestoreSha !== base.evidence.backup_sha256
    ) {
      blockers.push("backup_restore_hash_match_invalid");
    }
    return {
      verified: blockers.length === 0,
      blockers: unique(blockers),
      evidence: {
        ...base.evidence,
        quick_check: raw.quick_check || null,
        restore_path: restorePath,
        restore_sha256: SHA256_PATTERN.test(claimedRestoreSha)
          ? claimedRestoreSha
          : null,
        backup_restore_hashes_match:
          raw.backup_restore_hashes_match === true,
        production_database_mutated:
          raw.production_database_mutated,
      },
    };
  }
  return {
    verified: blockers.length === 0,
    blockers: unique(blockers),
    evidence: base.evidence,
  };
}

function evaluateApplyGates({
  options,
  databasePath,
  generatedAt,
  current,
  inspection,
} = {}) {
  const blockers = [...(inspection?.blockers || [])];
  const env = options.env || {};
  const generatedAtMs = Date.parse(generatedAt);
  const currentMs = new Date(current).getTime();
  if (
    !Number.isFinite(generatedAtMs) ||
    !Number.isFinite(currentMs) ||
    Math.abs(generatedAtMs - currentMs) > GENERATED_AT_MAX_SKEW_MS
  ) {
    blockers.push("worker_containment_generated_at_not_current");
  }
  if (!path.isAbsolute(String(options.databasePath || ""))) {
    blockers.push("absolute_database_path_required");
  }
  if (!text(options.confirmDatabasePath)) {
    blockers.push("exact_database_path_confirmation_required");
  } else if (!samePath(options.confirmDatabasePath, databasePath)) {
    blockers.push("exact_database_path_confirmation_mismatch");
  }
  if (!samePath(env.SQLITE_DB_PATH, databasePath)) {
    blockers.push("runtime_database_path_mismatch");
  }
  const declaredModes = [
    env.PULSE_OPERATING_MODE,
    env.PULSE_RUNTIME_MODE,
    env.OPERATING_MODE,
  ]
    .filter((value) => text(value))
    .map((value) => text(value).toUpperCase());
  if (
    declaredModes.length === 0 ||
    declaredModes.some((value) => value !== "HUMAN_REVIEW")
  ) {
    blockers.push("human_review_operating_mode_required");
  }
  if (!explicitlyFalse(env.AUTO_PUBLISH)) {
    blockers.push("auto_publish_must_be_explicitly_false");
  }
  if (!truthy(env.PULSE_EMERGENCY_KILL_SWITCH)) {
    blockers.push("emergency_kill_switch_must_be_true");
  }
  if (!truthy(env.PULSE_KILL_SWITCH)) {
    blockers.push("primary_kill_switch_must_be_true");
  }
  if (!truthy(env.PULSE_CUTOVER_SCHEDULER_STOPPED)) {
    blockers.push("scheduler_must_be_stopped");
  }
  if (!truthy(env.PULSE_CUTOVER_WORKERS_STOPPED)) {
    blockers.push("workers_must_be_stopped");
  }
  if (options.confirmSchedulerStopped !== true) {
    blockers.push("stopped_scheduler_confirmation_required");
  }
  if (options.confirmWorkersStopped !== true) {
    blockers.push("stopped_workers_confirmation_required");
  }
  blockers.push(
    ...pairedTextBlockers({
      value: options.actorId,
      confirmation: options.confirmActorId,
      requiredCode: "operator_actor_required",
      confirmationCode: "exact_operator_actor_confirmation_required",
      mismatchCode: "exact_operator_actor_confirmation_mismatch",
    }),
    ...pairedTextBlockers({
      value: options.reason,
      confirmation: options.confirmReason,
      requiredCode: "operator_reason_required",
      confirmationCode: "exact_operator_reason_confirmation_required",
      mismatchCode: "exact_operator_reason_confirmation_mismatch",
    }),
    ...pairedTextBlockers({
      value: options.changeWindowId,
      confirmation: options.confirmChangeWindowId,
      requiredCode: "change_window_id_required",
      confirmationCode: "exact_change_window_confirmation_required",
      mismatchCode: "exact_change_window_confirmation_mismatch",
    }),
  );
  if (
    options.confirmWorkerContainment !==
    WORKER_CONTAINMENT_CONFIRMATION
  ) {
    blockers.push("worker_containment_confirmation_required");
  }
  if (Number(inspection?.active_runtime_lease_count) !== 0) {
    blockers.push("active_runtime_leases_present");
  }
  if (Number(inspection?.claimed_or_running_job_count) !== 0) {
    blockers.push("running_jobs_present");
  }
  const backup = verifyContainmentBackupEvidence({
    evidencePath: options.backupEvidencePath,
    databasePath,
    generatedAt,
  });
  blockers.push(...backup.blockers);
  return {
    blockers: unique(blockers),
    backup: backup.evidence,
  };
}

function idempotencyKey(changeWindowId) {
  return `governed-worker-containment:${text(changeWindowId)}`;
}

function auditChangeEvidence({
  options,
  generatedAt,
  databasePath,
  backup,
  before,
  after,
} = {}) {
  const transitionedWorkerIds = [...before.target_worker_ids];
  const clearedLastJobWorkerIds = before.target_workers
    .filter((worker) => worker.last_job_id !== null)
    .map((worker) => worker.id);
  return {
    schema_version: AUDIT_SCHEMA_VERSION,
    generated_at: generatedAt,
    database_path: databasePath,
    change_window_id: text(options.changeWindowId),
    backup: {
      backup_id: backup?.backup_id || null,
      evidence_file_sha256: backup?.evidence_file_sha256 || null,
      source_database_sha256:
        backup?.source_database_sha256 || null,
    },
    before: {
      active_worker_count: before.target_worker_ids.length,
      active_worker_ids: before.target_worker_ids,
      active_runtime_lease_count:
        before.active_runtime_lease_count,
      claimed_or_running_job_count:
        before.claimed_or_running_job_count,
    },
    after: {
      active_worker_count: after.target_worker_ids.length,
      active_worker_ids: after.target_worker_ids,
      active_runtime_lease_count:
        after.active_runtime_lease_count,
      claimed_or_running_job_count:
        after.claimed_or_running_job_count,
    },
    transitioned_worker_ids: transitionedWorkerIds,
    cleared_last_job_worker_ids: clearedLastJobWorkerIds,
    preserved_locked_worker_ids: before.preserved_locked_worker_ids,
    controls: {
      operating_mode: "HUMAN_REVIEW",
      auto_publish: false,
      emergency_kill_switch: true,
      primary_kill_switch: true,
      scheduler_stopped: true,
      workers_stopped: true,
      fixed_confirmation_matched: true,
    },
    scope: {
      workers_table_mutated: true,
      jobs_mutated: false,
      runtime_leases_mutated: false,
      platform_or_oauth_accessed: false,
    },
  };
}

function normalisedChange(evidence) {
  return {
    before: evidence.before,
    after: evidence.after,
    transitioned_worker_ids: evidence.transitioned_worker_ids,
    cleared_last_job_worker_ids:
      evidence.cleared_last_job_worker_ids,
    preserved_locked_worker_ids:
      evidence.preserved_locked_worker_ids,
  };
}

function parseEvidence(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function applyContainmentTransaction({
  db,
  options,
  generatedAt,
  databasePath,
  backup,
} = {}) {
  const boundaryBlockers = sqliteMutationBoundaryBlockers({
    databasePath,
    expectedSourceSha256: backup?.source_database_sha256,
    allowSharedMemory: true,
  });
  if (boundaryBlockers.length) {
    throw new GovernedWorkerContainmentError(boundaryBlockers);
  }
  const before = inspectOpenDatabase(db, generatedAt);
  const runtimeBlockers = [
    ...before.blockers,
    ...(before.active_runtime_lease_count === 0
      ? []
      : ["active_runtime_leases_present"]),
    ...(before.claimed_or_running_job_count === 0
      ? []
      : ["running_jobs_present"]),
  ];
  if (runtimeBlockers.length) {
    throw new GovernedWorkerContainmentError(runtimeBlockers);
  }

  const key = idempotencyKey(options.changeWindowId);
  const existing = db
    .prepare(
      `SELECT * FROM operator_audit_log
       WHERE idempotency_key = ?`,
    )
    .get(key);
  if (existing) {
    const evidence = parseEvidence(existing.evidence_json);
    if (
      existing.action !== AUDIT_ACTION ||
      existing.actor_id !== text(options.actorId) ||
      existing.reason !== text(options.reason) ||
      existing.target_id !== text(options.changeWindowId) ||
      evidence?.schema_version !== AUDIT_SCHEMA_VERSION ||
      before.target_worker_ids.length !== 0
    ) {
      throw new GovernedWorkerContainmentError(
        "worker_containment_idempotency_conflict",
      );
    }
    return {
      mutated: false,
      idempotent: true,
      inspection: before,
      change: normalisedChange(evidence),
    };
  }

  const updateWorker = db.prepare(
    `UPDATE workers
     SET status = 'offline',
         last_job_id = NULL
     WHERE id = ?
       AND COALESCE(status, '') NOT IN ('offline', 'locked')`,
  );
  let changed = 0;
  for (const workerId of before.target_worker_ids) {
    changed += updateWorker.run(workerId).changes;
  }
  if (changed !== before.target_worker_ids.length) {
    throw new GovernedWorkerContainmentError(
      "worker_containment_update_count_mismatch",
    );
  }

  const after = inspectOpenDatabase(db, generatedAt);
  const postBlockers = [
    ...after.blockers,
    ...(after.target_worker_ids.length === 0
      ? []
      : ["worker_containment_post_state_mismatch"]),
    ...(after.active_runtime_lease_count === 0
      ? []
      : ["active_runtime_leases_present"]),
    ...(after.claimed_or_running_job_count === 0
      ? []
      : ["running_jobs_present"]),
  ];
  for (const workerId of before.target_worker_ids) {
    const row = db
      .prepare(
        `SELECT status, last_job_id FROM workers WHERE id = ?`,
      )
      .get(workerId);
    if (row?.status !== "offline" || row.last_job_id !== null) {
      postBlockers.push("worker_containment_post_state_mismatch");
    }
  }
  if (postBlockers.length) {
    throw new GovernedWorkerContainmentError(postBlockers);
  }

  const evidence = auditChangeEvidence({
    options,
    generatedAt,
    databasePath,
    backup,
    before,
    after,
  });
  const inserted = db
    .prepare(
      `INSERT INTO operator_audit_log
         (actor_id, action, target_type, target_id, decision, reason,
          evidence_json, idempotency_key, created_at)
       VALUES (?, ?, 'worker_registry', ?,
               'SET_ELIGIBLE_WORKERS_OFFLINE', ?, ?, ?, ?)`,
    )
    .run(
      text(options.actorId),
      AUDIT_ACTION,
      text(options.changeWindowId),
      text(options.reason),
      JSON.stringify(evidence),
      key,
      generatedAt,
    );
  const audit = db
    .prepare("SELECT * FROM operator_audit_log WHERE id = ?")
    .get(inserted.lastInsertRowid);
  const verifiedEvidence = parseEvidence(audit?.evidence_json);
  if (
    audit?.idempotency_key !== key ||
    verifiedEvidence?.before?.active_worker_count !==
      before.target_worker_ids.length ||
    verifiedEvidence?.after?.active_worker_count !== 0 ||
    JSON.stringify(verifiedEvidence?.transitioned_worker_ids) !==
      JSON.stringify(before.target_worker_ids)
  ) {
    throw new GovernedWorkerContainmentError(
      "worker_containment_audit_verification_failed",
    );
  }
  return {
    mutated: true,
    idempotent: false,
    inspection: after,
    change: normalisedChange(evidence),
  };
}

async function executeGovernedWorkerContainment(options = {}) {
  const current = options.now ? options.now() : new Date();
  const databasePath = options.databasePath
    ? path.resolve(options.databasePath)
    : null;
  const generatedDate = new Date(options.generatedAt || current);
  if (Number.isNaN(generatedDate.getTime())) {
    return buildResult({
      generatedAt: null,
      databasePath,
      mode: options.apply === true ? "APPLY" : "INSPECT",
      verdict: options.apply === true ? "HOLD" : "INSPECTED",
      blockers: ["worker_containment_generated_at_invalid"],
    });
  }
  const generatedAt = generatedDate.toISOString();
  const Database = options.DatabaseImpl || require("better-sqlite3");
  let inspection;
  try {
    inspection = withReadOnlySqliteSnapshot(databasePath, (db) => {
      return inspectOpenDatabase(db, generatedAt);
    });
  } catch {
    return buildResult({
      generatedAt,
      databasePath,
      mode: options.apply === true ? "APPLY" : "INSPECT",
      verdict: options.apply === true ? "HOLD" : "INSPECTED",
      blockers: ["worker_containment_database_file_required"],
    });
  }
  if (options.apply !== true) {
    return buildResult({
      generatedAt,
      databasePath,
      mode: "INSPECT",
      verdict: "INSPECTED",
      blockers: inspection.blockers,
      inspection,
    });
  }
  const gates = evaluateApplyGates({
    options,
    databasePath,
    generatedAt,
    current,
    inspection,
  });
  if (gates.blockers.length) {
    return buildResult({
      generatedAt,
      databasePath,
      mode: "APPLY",
      verdict: "HOLD",
      blockers: gates.blockers,
      inspection,
    });
  }

  const preOpenBlockers = sqliteMutationBoundaryBlockers({
    databasePath,
    expectedSourceSha256: gates.backup?.source_database_sha256,
    allowSharedMemory: false,
  });
  if (preOpenBlockers.length) {
    return buildResult({
      generatedAt,
      databasePath,
      mode: "APPLY",
      verdict: "HOLD",
      blockers: preOpenBlockers,
      inspection,
    });
  }

  let db = new Database(databasePath, { fileMustExist: true });
  let applied;
  try {
    db.pragma("foreign_keys = ON");
    applied = db
      .transaction(() =>
        applyContainmentTransaction({
          db,
          options,
          generatedAt,
          databasePath,
          backup: gates.backup,
        }),
      )
      .immediate();
  } catch (error) {
    const blockers =
      error instanceof GovernedWorkerContainmentError
        ? error.codes
        : ["worker_containment_transaction_failed"];
    return buildResult({
      generatedAt,
      databasePath,
      mode: "APPLY",
      verdict: "HOLD",
      blockers,
      inspection,
    });
  } finally {
    db.close();
  }
  return buildResult({
    generatedAt,
    databasePath,
    mode: "APPLY",
    verdict: applied.idempotent ? "IDEMPOTENT" : "APPLIED",
    mutated: applied.mutated,
    idempotent: applied.idempotent,
    inspection: applied.inspection,
    change: applied.change,
  });
}

module.exports = {
  AUDIT_ACTION,
  AUDIT_SCHEMA_VERSION,
  GovernedWorkerContainmentError,
  RESULT_SCHEMA_VERSION,
  WORKER_CONTAINMENT_CONFIRMATION,
  applyContainmentTransaction,
  evaluateApplyGates,
  executeGovernedWorkerContainment,
  inspectOpenDatabase,
  verifyContainmentBackupEvidence,
};

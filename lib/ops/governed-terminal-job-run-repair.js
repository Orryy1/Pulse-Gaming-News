"use strict";

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  validateCanonicalCutoverBackupEvidenceV1,
} = require("./cutover-backup-evidence");
const {
  withReadOnlySqliteSnapshot,
} = require("./stabilisation-cutover-reconcile");
const {
  canonicalSqliteSnapshotDigest,
} = require("./sqlite-canonical-logical-snapshot");
const {
  LIVE_RUNTIME_TRANSITION_LEASE_NAME,
} = require("../stabilisation/live-runtime-transition-lease");

const PLAN_SCHEMA = "pulse-terminal-job-run-repair-plan-v1";
const RESULT_SCHEMA = "pulse-terminal-job-run-repair-result-v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const REPAIR_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const AUTHORITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const BACKUP_VERIFICATION_SCHEMA = "pulse-sqlite-backup-verification-v1";
const RESTORE_REHEARSAL_SCHEMA = "pulse-restore-rehearsal-v1";
const ONLINE_BACKUP_METHOD = "better-sqlite3-online-backup";
const WORKER_FRESHNESS_MS = 5 * 60_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_PLAN_AGE_MS = 30 * 60_000;
const MAX_BACKUP_AGE_MS = 24 * 60 * 60_000;
const ACTIVE_WORKER_STATUSES = new Set(["idle", "busy", "draining", "locked"]);
const MIGRATION_023_FILENAME =
  "023_stabilisation_governance_hardening.sql";
const MIGRATION_023_PATH = path.resolve(
  __dirname,
  "../../db/migrations",
  MIGRATION_023_FILENAME,
);
const REPAIR_SCHEMA_VERSION = "pulse-terminal-job-run-repair-schema-v1";
const REQUIRED_REPAIR_COLUMNS = Object.freeze({
  jobs: [
    "id",
    "status",
    "attempt_count",
    "claimed_by",
    "updated_at",
    "completed_at",
  ],
  job_runs: [
    "id",
    "job_id",
    "worker_id",
    "attempt",
    "status",
    "started_at",
    "finished_at",
    "duration_ms",
    "error_message",
    "log_excerpt",
  ],
  runtime_leases: ["name", "expires_at"],
  workers: ["id", "status", "last_seen_at"],
  operator_audit_log: [
    "id",
    "actor_id",
    "action",
    "target_type",
    "target_id",
    "decision",
    "reason",
    "evidence_json",
    "created_at",
    "idempotency_key",
  ],
  schema_migrations: ["version", "filename", "checksum"],
});
const EXPECTED_AUDIT_TRIGGER_SQL = Object.freeze({
  trg_operator_audit_log_immutable_update:
    "CREATE TRIGGER trg_operator_audit_log_immutable_update BEFORE UPDATE ON operator_audit_log BEGIN SELECT RAISE(ABORT, 'immutable_operator_audit_log'); END",
  trg_operator_audit_log_immutable_delete:
    "CREATE TRIGGER trg_operator_audit_log_immutable_delete BEFORE DELETE ON operator_audit_log BEGIN SELECT RAISE(ABORT, 'immutable_operator_audit_log'); END",
});
const EXPECTED_AUDIT_INDEX_SQL =
  "CREATE UNIQUE INDEX ux_operator_audit_idempotency ON operator_audit_log(idempotency_key) WHERE idempotency_key IS NOT NULL";

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashFile(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function samePath(left, right) {
  return (
    path.resolve(String(left || "")).replace(/\\/g, "/").toLowerCase() ===
    path.resolve(String(right || "")).replace(/\\/g, "/").toLowerCase()
  );
}

function canonicalSingleLinkFile(filePath) {
  const supplied = String(filePath || "");
  if (
    !supplied ||
    !path.isAbsolute(supplied) ||
    path.resolve(supplied) !== supplied
  ) {
    return false;
  }
  try {
    const stat = fs.lstatSync(supplied, { bigint: true });
    return (
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      BigInt(stat.nlink || 0) === 1n &&
      path.resolve(fs.realpathSync.native(supplied)) === supplied
    );
  } catch {
    return false;
  }
}

function exactFileHashMatches(filePath, expectedSha256) {
  try {
    return (
      canonicalSingleLinkFile(filePath) &&
      hashFile(filePath) === String(expectedSha256 || "").toLowerCase()
    );
  } catch {
    return false;
  }
}

function canonicalFileIdentity(filePath) {
  if (!canonicalSingleLinkFile(filePath)) return null;
  try {
    const stat = fs.statSync(filePath, { bigint: true });
    return {
      canonical_path: path.resolve(fs.realpathSync.native(filePath)),
      device_id: String(stat.dev),
      file_id: String(stat.ino),
      size_bytes: String(stat.size),
      link_count: String(stat.nlink),
    };
  } catch {
    return null;
  }
}

function openedMainDatabasePath(db) {
  try {
    const main = db
      .prepare("PRAGMA database_list")
      .all()
      .find((row) => String(row.name) === "main");
    const file = String(main?.file || "");
    return file && path.isAbsolute(file) ? path.resolve(file) : null;
  } catch {
    return null;
  }
}

function sameFileIdentity(left, right) {
  return Boolean(left && right && stableJson(left) === stableJson(right));
}

function durableFileIdentity(identity) {
  if (!identity) return null;
  return {
    canonical_path: identity.canonical_path,
    device_id: identity.device_id,
    file_id: identity.file_id,
    link_count: identity.link_count,
  };
}

function sameDurableFileIdentity(left, right) {
  return Boolean(
    left && right &&
    stableJson(durableFileIdentity(left)) === stableJson(durableFileIdentity(right)),
  );
}

function canonicalDirectory(directoryPath) {
  const supplied = String(directoryPath || "");
  if (!supplied || !path.isAbsolute(supplied) || path.resolve(supplied) !== supplied) {
    return false;
  }
  try {
    const stat = fs.lstatSync(supplied);
    return (
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      path.resolve(fs.realpathSync.native(supplied)) === supplied
    );
  } catch {
    return false;
  }
}

function defaultExecutorInspector({
  workspaceRoot,
  modulePath,
  entrypointPath,
}) {
  try {
    const call = (args) =>
      String(
        execFileSync("git", args, {
          cwd: workspaceRoot,
          encoding: "utf8",
          timeout: 5000,
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        }),
      ).trim();
    const commit = call(["rev-parse", "HEAD"]).toLowerCase();
    const topLevel = path.resolve(call(["rev-parse", "--show-toplevel"]));
    const status = call([
      "status",
      "--porcelain",
      "--untracked-files=normal",
    ]);
    const codeTrackedAtHead = [modulePath, entrypointPath].every(
      (filePath) => {
        const relativePath = path
          .relative(workspaceRoot, filePath)
          .replace(/\\/g, "/");
        if (!relativePath || relativePath.startsWith("../")) return false;
        call(["ls-files", "--error-unmatch", "--", relativePath]);
        const committedBlob = call(["rev-parse", `HEAD:${relativePath}`]);
        const workingBlob = call([
          "hash-object",
          `--path=${relativePath}`,
          filePath,
        ]);
        return committedBlob === workingBlob;
      },
    );
    return {
      available: COMMIT_PATTERN.test(commit),
      commit,
      root_match: samePath(topLevel, workspaceRoot),
      tracked_clean: status === "",
      code_tracked_at_head: codeTrackedAtHead,
    };
  } catch {
    return {
      available: false,
      commit: null,
      root_match: false,
      tracked_clean: false,
      code_tracked_at_head: false,
    };
  }
}

function inspectExecutorAuthority({
  workspaceRoot,
  expectedCommit,
  executorInspector = defaultExecutorInspector,
  modulePath = __filename,
  entrypointPath = require.main?.filename,
}) {
  const root = path.resolve(String(workspaceRoot || ""));
  const expectedModulePath = path.join(
    root,
    "lib",
    "ops",
    "governed-terminal-job-run-repair.js",
  );
  const expectedEntrypointPath = path.join(
    root,
    "tools",
    "governed-terminal-job-run-repair.js",
  );
  const codePathsValid =
    canonicalDirectory(root) &&
    canonicalSingleLinkFile(String(modulePath || "")) &&
    canonicalSingleLinkFile(String(entrypointPath || "")) &&
    samePath(modulePath, expectedModulePath) &&
    samePath(entrypointPath, expectedEntrypointPath);
  let observed = { available: false, commit: null, tracked_clean: false };
  try {
    observed = executorInspector({
      workspaceRoot: root,
      expectedCommit,
      modulePath,
      entrypointPath,
    });
  } catch {
    // Executor inspection is authority: any error is a fail-closed HOLD.
  }
  const attested =
    codePathsValid &&
    observed?.available === true &&
    observed?.commit === expectedCommit &&
    observed?.root_match === true &&
    observed?.tracked_clean === true &&
    observed?.code_tracked_at_head === true;
  return {
    blockers: attested
      ? []
      : ["terminal_job_run_repair_executor_not_attested"],
    evidence: {
      workspace_root: root,
      expected_commit: COMMIT_PATTERN.test(String(expectedCommit || ""))
        ? expectedCommit
        : null,
      observed_commit: COMMIT_PATTERN.test(String(observed?.commit || ""))
        ? observed.commit
        : null,
      tracked_clean: observed?.tracked_clean === true,
      git_root_bound: observed?.root_match === true,
      code_tracked_at_head: observed?.code_tracked_at_head === true,
      module_path: path.resolve(String(modulePath || "")),
      entrypoint_path: path.resolve(String(entrypointPath || "")),
      code_paths_bound: codePathsValid,
    },
  };
}

function timestampMs(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let normalised = value.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(normalised)) {
    normalised = `${normalised.replace(" ", "T")}Z`;
  }
  const parsed = Date.parse(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normaliseSchemaSql(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/ifnotexists/g, "")
    .replace(/;+$/g, "");
}

function classifyActions(actions) {
  const countsByJob = new Map();
  for (const action of actions) {
    countsByJob.set(action.job_id, (countsByJob.get(action.job_id) || 0) + 1);
  }
  return {
    eligible_run_count: actions.length,
    affected_job_count: countsByJob.size,
    done_run_count: actions.filter(
      (action) => action.terminal_job_status === "done",
    ).length,
    failed_run_count: actions.filter(
      (action) => action.terminal_job_status === "failed",
    ).length,
    max_open_runs_per_job:
      countsByJob.size === 0 ? 0 : Math.max(...countsByJob.values()),
  };
}

function requiredDatabasePath(databasePath) {
  const resolved = path.resolve(String(databasePath || "").trim());
  if (!databasePath || !fs.existsSync(resolved)) {
    throw new Error("terminal_job_run_repair_database_required");
  }
  if (!canonicalSingleLinkFile(resolved)) {
    throw new Error("terminal_job_run_repair_database_file_unsafe");
  }
  return resolved;
}

function sqliteSidecarState(databasePath) {
  const inspect = (suffix) => {
    const sidecarPath = `${databasePath}${suffix}`;
    try {
      const stat = fs.lstatSync(sidecarPath, { bigint: true });
      const realPath = path.resolve(fs.realpathSync.native(sidecarPath));
      return {
        path: sidecarPath,
        exists: true,
        regular_file: stat.isFile(),
        symbolic_link: stat.isSymbolicLink(),
        canonical_path: realPath,
        link_count: String(stat.nlink),
        size_bytes: Number(stat.size),
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return {
          path: sidecarPath,
          exists: false,
          regular_file: false,
          symbolic_link: false,
          canonical_path: null,
          link_count: null,
          size_bytes: 0,
        };
      }
      return {
        path: sidecarPath,
        exists: true,
        regular_file: false,
        symbolic_link: false,
        canonical_path: null,
        link_count: null,
        size_bytes: null,
        inspection_error: true,
      };
    }
  };
  return {
    wal: inspect("-wal"),
    shm: inspect("-shm"),
    journal: inspect("-journal"),
  };
}

function sidecarBlockers(sidecars) {
  const blockers = [];
  const wal = sidecars.wal;
  if (
    wal.inspection_error ||
    (wal.exists &&
      (!wal.regular_file ||
        wal.symbolic_link ||
        wal.link_count !== "1" ||
        !samePath(wal.canonical_path, wal.path))) ||
    Number(wal.size_bytes) > 0
  ) {
    blockers.push("terminal_job_run_repair_wal_not_checkpointed");
  }
  const shm = sidecars.shm;
  if (
    shm.inspection_error ||
    (shm.exists &&
      (!shm.regular_file ||
        shm.symbolic_link ||
        shm.link_count !== "1" ||
        !samePath(shm.canonical_path, shm.path)))
  ) {
    blockers.push("terminal_job_run_repair_shared_memory_unsafe");
  }
  if (
    shm.inspection_error ||
    shm.exists
  ) {
    blockers.push("terminal_job_run_repair_shared_memory_present");
  }
  const journal = sidecars.journal;
  if (
    journal.inspection_error ||
    journal.exists
  ) {
    blockers.push("terminal_job_run_repair_rollback_journal_present");
  }
  return blockers;
}

function planCore(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return null;
  const { plan_sha256: ignored, ...core } = plan;
  return core;
}

function holdResult({ plan, blockers }) {
  return {
    schema_version: RESULT_SCHEMA,
    generated_at: plan?.generated_at || null,
    repair_id: plan?.repair_id || null,
    mode: "APPLY",
    verdict: "HOLD",
    plan_sha256: plan?.plan_sha256 || null,
    blockers: unique(blockers),
    mutations_performed: [],
    post_checks: null,
    safety: {
      production_database_mutated: false,
      external_calls: [],
      oauth_or_tokens_mutated: false,
      publication_state_mutated: false,
    },
  };
}

function snapshotRepairState(db, plan) {
  const selectRun = db.prepare(
    `SELECT id, job_id, worker_id, attempt, status, started_at, finished_at,
            duration_ms, error_message, log_excerpt
     FROM job_runs
     WHERE id = ?`,
  );
  const runs = plan.actions
    .map((action) => selectRun.get(action.run_id) || null)
    .sort((left, right) => Number(left?.id || 0) - Number(right?.id || 0));
  const audit = db
    .prepare(
      `SELECT id, actor_id, action, target_type, target_id, decision, reason,
              evidence_json, created_at, idempotency_key
       FROM operator_audit_log
       WHERE idempotency_key = ?`,
    )
    .get(`governed-terminal-job-run-repair:${plan.repair_id}`);
  return { runs, audit: audit || null };
}

function databaseChecks(db) {
  const quick = db.pragma("quick_check");
  const foreignKeys = db.pragma("foreign_key_check");
  return {
    quick_check:
      quick.length === 1 &&
      String(Object.values(quick[0])[0]).toLowerCase() === "ok"
        ? "ok"
        : "failed",
    foreign_key_check: foreignKeys.length === 0 ? "ok" : "failed",
  };
}

function verifyRollback(db, plan, beforeState) {
  const afterState = snapshotRepairState(db, plan);
  const checks = databaseChecks(db);
  const plannedRowsRestored =
    stableJson(beforeState.runs) === stableJson(afterState.runs);
  const auditAbsent = beforeState.audit === null && afterState.audit === null;
  const auditRestored =
    stableJson(beforeState.audit) === stableJson(afterState.audit);
  return {
    planned_rows_restored: plannedRowsRestored,
    audit_absent: auditAbsent,
    audit_state_restored: auditRestored,
    quick_check: checks.quick_check,
    foreign_key_check: checks.foreign_key_check,
    verified:
      plannedRowsRestored &&
      auditRestored &&
      checks.quick_check === "ok" &&
      checks.foreign_key_check === "ok",
  };
}

function rollbackResult({ plan, error, checks }) {
  const drift = [
    "terminal_job_run_repair_plan_drift",
    "terminal_job_run_repair_source_drift_at_fence",
    "terminal_job_run_repair_source_identity_drift_at_fence",
    "terminal_job_run_repair_backup_drift_at_fence",
    "terminal_job_run_repair_postcheck_open_run_present",
    "terminal_job_run_repair_postcheck_failed",
  ].includes(error?.message);
  const blockers = [
    drift
      ? error.message
      : "terminal_job_run_repair_transaction_rolled_back",
  ];
  if (!checks.verified) {
    blockers.push("terminal_job_run_repair_rollback_unverified");
  }
  return {
    schema_version: RESULT_SCHEMA,
    generated_at: plan.generated_at,
    repair_id: plan.repair_id,
    mode: "APPLY",
    verdict: checks.verified && !drift ? "ROLLED_BACK_VERIFIED" : "HOLD",
    plan_sha256: plan.plan_sha256,
    blockers,
    mutations_performed: [],
    rollback_checks: checks,
    post_checks: null,
    safety: {
      production_database_mutated: checks.verified ? false : null,
      external_calls: [],
      oauth_or_tokens_mutated: false,
      publication_state_mutated: false,
    },
  };
}

function expectedMutations(plan) {
  return plan.actions.map((action) => ({
    run_id: action.run_id,
    job_id: action.job_id,
    successor_run_id: action.successor_run_id,
    status: action.repair_status,
    finished_at: action.repair_finished_at,
  }));
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function operationRemainderDigest(db, excludedIdempotencyKey) {
  return canonicalSqliteSnapshotDigest(db, {
    excludeOperationRows: {
      audit_idempotency_key: excludedIdempotencyKey,
      operator_audit_sequence: true,
    },
  });
}

function liveRuntimeTransitionLeaseDigest(db) {
  const columns = db
    .prepare(`PRAGMA table_info(${quoteIdentifier("runtime_leases")})`)
    .safeIntegers(true)
    .all()
    .map((column) => ({
      name: String(column.name),
      declared_type: String(column.type || "").toUpperCase(),
      not_null: String(column.notnull),
      primary_key_position: String(column.pk),
    }));
  if (!columns.some((column) => column.name === "name")) {
    throw new Error("terminal_job_run_repair_runtime_lease_schema_invalid");
  }
  const reads = columns.map((column, index) => {
    const identifier = quoteIdentifier(column.name);
    const typeAlias = quoteIdentifier(`__pulse_type_${index}`);
    const valueAlias = quoteIdentifier(`__pulse_value_${index}`);
    return {
      typeKey: `__pulse_type_${index}`,
      valueKey: `__pulse_value_${index}`,
      projection: [
        `typeof(${identifier}) AS ${typeAlias}`,
        `CASE typeof(${identifier})
           WHEN 'text' THEN hex(CAST(${identifier} AS BLOB))
           WHEN 'blob' THEN hex(${identifier})
           WHEN 'integer' THEN CAST(${identifier} AS TEXT)
           WHEN 'real' THEN quote(${identifier})
           ELSE NULL
         END AS ${valueAlias}`,
      ],
    };
  });
  const row = db
    .prepare(
      `SELECT ${reads.flatMap((read) => read.projection).join(", ")}
         FROM runtime_leases
        WHERE name = ?`,
    )
    .get(LIVE_RUNTIME_TRANSITION_LEASE_NAME);
  const canonicalRow = row
    ? reads.map((read) => ({
        type: row[read.typeKey],
        value: row[read.valueKey],
      }))
    : null;
  return sha256(
    stableJson({
      schema_version: "pulse-terminal-job-run-repair-transition-lease-v1",
      columns,
      row: canonicalRow,
    }),
  );
}

function canonicalAuditBackupEvidence(backup, plan) {
  return {
    evidence_path: backup.evidencePath,
    expected_evidence_sha256:
      plan.backup_authority.expected_evidence_sha256,
    evidence_sha256: backup.evidenceSha256,
    evidence_identity: backup.evidenceIdentity,
    canonical_evidence: backup.evidence,
    backup_id: backup.evidence.backup_id,
    backup_path: backup.evidence.backup_path,
    backup_sha256: backup.evidence.backup_sha256,
    backup_identity: backup.backupIdentity,
    backup_sidecars: backup.backupSidecars,
    restore_path: backup.evidence.restore_path,
    restore_sha256: backup.evidence.restore_sha256,
    restore_identity: backup.restoreIdentity,
    restore_sidecars: backup.restoreSidecars,
    restore_test_status: backup.evidence.restore_test_status,
    verified_at: backup.evidence.verified_at,
    backup_verification: {
      path: backup.backupProof.path,
      expected_sha256:
        plan.backup_authority.expected_backup_verification_sha256,
      observed_sha256: backup.backupProof.sha256,
      identity: backup.backupProof.identity,
      proof: backup.backupProof.value,
    },
    restore_rehearsal: {
      path: backup.restoreProof.path,
      expected_sha256:
        plan.backup_authority.expected_restore_rehearsal_sha256,
      observed_sha256: backup.restoreProof.sha256,
      identity: backup.restoreProof.identity,
      proof: backup.restoreProof.value,
    },
  };
}

function inspectExistingRepair(
  db,
  plan,
  { currentSourceIdentity = null, backup = null, executor = null } = {},
) {
  const idempotencyKey =
    `governed-terminal-job-run-repair:${plan.repair_id}`;
  const audit = db
    .prepare(
      `SELECT id, actor_id, action, target_type, target_id, decision, reason,
              evidence_json, created_at, idempotency_key
       FROM operator_audit_log
       WHERE idempotency_key = ?`,
    )
    .get(idempotencyKey);
  if (!audit) return null;

  let evidence = null;
  try {
    evidence = JSON.parse(audit.evidence_json);
  } catch {
    // Invalid immutable evidence is an idempotency conflict, never authority.
  }
  const appliedAtMs = timestampMs(evidence?.applied_at);
  const backupVerifiedAtMs = timestampMs(backup?.evidence?.verified_at);
  const originalBackupFresh =
    appliedAtMs !== null &&
    backupVerifiedAtMs !== null &&
    backupVerifiedAtMs <= appliedAtMs + MAX_CLOCK_SKEW_MS &&
    appliedAtMs - backupVerifiedAtMs <= MAX_BACKUP_AGE_MS;
  const conflict =
    audit.actor_id !== plan.operator_id ||
    audit.action !== "governed_terminal_job_run_repair" ||
    audit.target_type !== "sqlite_database" ||
    audit.target_id !== plan.repair_id ||
    audit.decision !== "APPLIED" ||
    audit.reason !== "causally_superseded_terminal_job_runs_closed" ||
    audit.idempotency_key !== idempotencyKey ||
    !canonicalIso(audit.created_at) ||
    audit.created_at !== evidence?.applied_at ||
    evidence?.schema_version !== RESULT_SCHEMA ||
    evidence?.repair_id !== plan.repair_id ||
    evidence?.plan_sha256 !== plan.plan_sha256 ||
    evidence?.plan_generated_at !== plan.generated_at ||
    evidence?.source_database_sha256 !== plan.database.source_sha256 ||
    stableJson(evidence?.source_database_identity) !==
      stableJson(plan.database.source_identity) ||
    evidence?.operator_id !== plan.operator_id ||
    evidence?.change_window_id !== plan.change_window_id ||
    stableJson(evidence?.executor) !== stableJson(plan.executor) ||
    stableJson(executor?.evidence) !== stableJson(plan.executor) ||
    stableJson(evidence?.backup) !==
      stableJson(canonicalAuditBackupEvidence(backup, plan)) ||
    stableJson(evidence?.post_checks) !==
      stableJson({
        open_job_run_count: 0,
        quick_check: "ok",
        foreign_key_check: "ok",
      }) ||
    !sameDurableFileIdentity(
      evidence?.durable_after_state?.source_identity,
      currentSourceIdentity,
    ) ||
    !originalBackupFresh ||
    stableJson(evidence?.mutations_performed) !==
      stableJson(expectedMutations(plan));
  if (conflict) {
    return { outcome: "CONFLICT", audit, evidence };
  }

  const selectRun = db.prepare(
    `SELECT id, job_id, worker_id, attempt, status, started_at, finished_at,
            duration_ms, error_message, log_excerpt
     FROM job_runs
     WHERE id = ?`,
  );
  const selectJob = db.prepare(
    "SELECT id, status, attempt_count FROM jobs WHERE id = ?",
  );
  let exactState = true;
  for (const action of plan.actions) {
    const repaired = selectRun.get(action.run_id);
    const finalRun = selectRun.get(action.final_run_id);
    const job = selectJob.get(action.job_id);
    exactState =
      exactState &&
      repaired?.job_id === action.job_id &&
      repaired?.worker_id === action.worker_id &&
      repaired?.attempt === action.attempt &&
      repaired?.started_at === action.started_at &&
      repaired?.status === action.repair_status &&
      repaired?.finished_at === action.repair_finished_at &&
      repaired?.duration_ms === null &&
      repaired?.error_message === action.repair_error_message &&
      repaired?.log_excerpt === null &&
      finalRun?.status === action.final_run_status &&
      finalRun?.finished_at === action.final_run_finished_at &&
      job?.status === action.terminal_job_status &&
      job?.attempt_count === action.terminal_attempt_count;
  }
  const openCount = db
    .prepare("SELECT COUNT(*) AS count FROM job_runs WHERE finished_at IS NULL")
    .get().count;
  const checks = databaseChecks(db);
  const logicalDigest = operationRemainderDigest(db, idempotencyKey);
  const transitionLeaseDigest = liveRuntimeTransitionLeaseDigest(db);
  if (
    !exactState ||
    openCount !== 0 ||
    checks.quick_check !== "ok" ||
    checks.foreign_key_check !== "ok" ||
    logicalDigest !== evidence?.durable_after_state?.logical_digest ||
    transitionLeaseDigest !==
      evidence?.durable_after_state?.live_runtime_transition_lease_digest
  ) {
    return {
      outcome: "STATE_DRIFT",
      audit,
      evidence,
      postChecks: {
        open_job_run_count: openCount,
        ...checks,
      },
    };
  }
  return {
    outcome: "IDEMPOTENT",
    audit,
    evidence,
    postChecks: {
      open_job_run_count: openCount,
      ...checks,
    },
  };
}

function replayCommittedHoldResult(
  plan,
  inspection,
  blockers,
  postCommitChecks = null,
) {
  return {
    schema_version: RESULT_SCHEMA,
    generated_at: inspection.evidence.applied_at,
    applied_at: inspection.evidence.applied_at,
    plan_generated_at: plan.generated_at,
    repair_id: plan.repair_id,
    mode: "APPLY",
    verdict: "COMMITTED_HOLD",
    plan_sha256: plan.plan_sha256,
    blockers: unique([
      "terminal_job_run_repair_idempotent_verification_required",
      ...blockers,
    ]),
    mutations_performed: [],
    prior_mutations: inspection.evidence.mutations_performed,
    audit_id: Number(inspection.audit.id),
    post_checks: inspection.postChecks || null,
    post_commit_checks: postCommitChecks,
    committed_state: {
      previously_committed: true,
      this_invocation_mutated: false,
    },
    safety: {
      production_database_mutated: false,
      external_calls: [],
      oauth_or_tokens_mutated: false,
      publication_state_mutated: false,
    },
  };
}

function existingRepairResult(plan, inspection) {
  if (inspection.outcome === "CONFLICT") {
    return {
      ...holdResult({
        plan,
        blockers: ["terminal_job_run_repair_idempotency_conflict"],
      }),
      existing_audit_id: Number(inspection.audit.id),
    };
  }
  if (inspection.outcome === "STATE_DRIFT") {
    return replayCommittedHoldResult(plan, inspection, [
      "terminal_job_run_repair_idempotent_state_drift",
    ]);
  }
  return {
    schema_version: RESULT_SCHEMA,
    generated_at: plan.generated_at,
    repair_id: plan.repair_id,
    mode: "APPLY",
    verdict: "IDEMPOTENT_NOOP",
    plan_sha256: plan.plan_sha256,
    blockers: [],
    mutations_performed: [],
    prior_mutations: inspection.evidence.mutations_performed,
    audit_id: Number(inspection.audit.id),
    post_checks: inspection.postChecks,
    safety: {
      production_database_mutated: false,
      external_calls: [],
      oauth_or_tokens_mutated: false,
      publication_state_mutated: false,
    },
  };
}

function committedHoldResult({ plan, applied, blockers }) {
  return {
    schema_version: RESULT_SCHEMA,
    generated_at: applied.appliedAt,
    applied_at: applied.appliedAt,
    plan_generated_at: plan.generated_at,
    repair_id: plan.repair_id,
    mode: "APPLY",
    verdict: "COMMITTED_HOLD",
    plan_sha256: plan.plan_sha256,
    blockers: unique([
      "terminal_job_run_repair_post_commit_verification_required",
      ...blockers,
    ]),
    mutations_performed: applied.mutations,
    audit_id: applied.auditId,
    post_checks: applied.postChecks,
    post_commit_checks: applied.postCommitChecks || null,
    safety: {
      production_database_mutated: true,
      external_calls: [],
      oauth_or_tokens_mutated: false,
      publication_state_mutated: false,
    },
  };
}

function checkpointWalAfterCommit(db) {
  const journalMode = String(
    db.pragma("journal_mode", { simple: true }) || "",
  ).toLowerCase();
  if (journalMode !== "wal") {
    throw new Error("terminal_job_run_repair_journal_mode_not_wal");
  }
  const rows = db.pragma("wal_checkpoint(TRUNCATE)");
  const row = rows[0] || {};
  const busy = Number(row.busy ?? Object.values(row)[0] ?? 1);
  const logFrames = Number(row.log ?? Object.values(row)[1] ?? 1);
  if (busy !== 0 || logFrames !== 0) {
    throw new Error("terminal_job_run_repair_wal_checkpoint_incomplete");
  }
  return { journal_mode: journalMode, wal_checkpoint: "ok" };
}

function finalExistingRepairAttestation(
  db,
  plan,
  {
    databasePath,
    openedSourceIdentity,
    backup,
    executorWorkspaceRoot,
    executorInspector,
    executorModulePath,
    executorEntrypointPath,
  },
) {
  const inspect = db.transaction(() => {
    const beforeDataVersion = Number(
      db.pragma("data_version", { simple: true }),
    );
    const beforeMainPath = openedMainDatabasePath(db);
    const beforeIdentity = beforeMainPath
      ? canonicalFileIdentity(beforeMainPath)
      : null;
    const beforeExecutor = inspectExecutorAuthority({
      workspaceRoot: path.resolve(String(executorWorkspaceRoot || "")),
      expectedCommit: plan.source_commit_sha,
      executorInspector,
      modulePath: executorModulePath,
      entrypointPath: executorEntrypointPath,
    });
    const inspection = inspectExistingRepair(db, plan, {
      currentSourceIdentity: beforeIdentity,
      backup,
      executor: beforeExecutor,
    });
    const afterExecutor = inspectExecutorAuthority({
      workspaceRoot: path.resolve(String(executorWorkspaceRoot || "")),
      expectedCommit: plan.source_commit_sha,
      executorInspector,
      modulePath: executorModulePath,
      entrypointPath: executorEntrypointPath,
    });
    const afterDataVersion = Number(
      db.pragma("data_version", { simple: true }),
    );
    const afterMainPath = openedMainDatabasePath(db);
    const afterIdentity = afterMainPath
      ? canonicalFileIdentity(afterMainPath)
      : null;
    return {
      inspection,
      executor: afterExecutor,
      executorStable:
        beforeExecutor.blockers.length === 0 &&
        afterExecutor.blockers.length === 0 &&
        stableJson(beforeExecutor.evidence) === stableJson(plan.executor) &&
        stableJson(afterExecutor.evidence) === stableJson(plan.executor),
      dataVersionStable: beforeDataVersion === afterDataVersion,
      identityStable:
        samePath(beforeMainPath, databasePath) &&
        samePath(afterMainPath, databasePath) &&
        sameDurableFileIdentity(beforeIdentity, openedSourceIdentity) &&
        sameDurableFileIdentity(afterIdentity, openedSourceIdentity) &&
        sameDurableFileIdentity(beforeIdentity, afterIdentity),
      beforeDataVersion,
      afterDataVersion,
      beforeIdentity,
      afterIdentity,
    };
  });
  return inspect.immediate();
}

function proofChecksPass(verification) {
  return (
    verification?.openedReadOnly === true &&
    verification?.quick_check === "ok" &&
    verification?.integrity_check === "ok" &&
    verification?.foreign_key_check === "ok" &&
    Number(verification?.foreign_key_violation_count) === 0
  );
}

function canonicalIso(value) {
  const parsed = timestampMs(value);
  return parsed !== null && new Date(parsed).toISOString() === value;
}

function readStableJsonProof(filePath, expectedSha256) {
  if (
    !canonicalSingleLinkFile(filePath) ||
    !SHA256_PATTERN.test(String(expectedSha256 || "").toLowerCase())
  ) {
    return null;
  }
  try {
    const identity = canonicalFileIdentity(filePath);
    const first = fs.readFileSync(filePath);
    const observedSha256 = sha256(first);
    const value = JSON.parse(first.toString("utf8"));
    if (
      observedSha256 !== String(expectedSha256).toLowerCase() ||
      sha256(fs.readFileSync(filePath)) !== observedSha256 ||
      !sameFileIdentity(identity, canonicalFileIdentity(filePath))
    ) {
      return null;
    }
    return { path: filePath, identity, sha256: observedSha256, value };
  } catch {
    return null;
  }
}

function validateBackupProvenance({
  evidence,
  backupPath,
  restorePath,
  expectedBackupVerificationSha256,
  expectedRestoreRehearsalSha256,
  observedAtMs,
  enforceFreshness,
}) {
  const backupProofPath = String(
    evidence?.provenance?.backup_verification_file || "",
  );
  const restoreProofPath = String(
    evidence?.provenance?.restore_rehearsal_file || "",
  );
  const backupProof = readStableJsonProof(
    backupProofPath,
    expectedBackupVerificationSha256,
  );
  const restoreProof = readStableJsonProof(
    restoreProofPath,
    expectedRestoreRehearsalSha256,
  );
  if (!backupProof || !restoreProof) {
    return {
      valid: false,
      backupProof,
      restoreProof,
    };
  }
  const backup = backupProof.value;
  const restore = restoreProof.value;
  const backupHash = String(evidence.backup_sha256 || "").toLowerCase();
  const restoreHash = String(evidence.restore_sha256 || "").toLowerCase();
  let valid = false;
  try {
    const evidenceVerifiedAtMs = Date.parse(evidence.verified_at);
    const backupCreatedAtMs = Date.parse(backup?.createdAt);
    const backupVerifiedAtMs = Date.parse(backup?.verifiedAt);
    const restoreGeneratedAtMs = Date.parse(restore?.generated_at);
    const chronologyValid =
      [
        evidenceVerifiedAtMs,
        backupCreatedAtMs,
        backupVerifiedAtMs,
        restoreGeneratedAtMs,
      ].every(Number.isFinite) &&
      backupCreatedAtMs <= backupVerifiedAtMs &&
      backupVerifiedAtMs <= restoreGeneratedAtMs &&
      restoreGeneratedAtMs <= evidenceVerifiedAtMs &&
      evidenceVerifiedAtMs - backupCreatedAtMs <= MAX_BACKUP_AGE_MS &&
      evidenceVerifiedAtMs - backupVerifiedAtMs <= MAX_BACKUP_AGE_MS &&
      evidenceVerifiedAtMs - restoreGeneratedAtMs <= MAX_BACKUP_AGE_MS;
    const currentFreshnessValid =
      !enforceFreshness ||
      ([backupCreatedAtMs, backupVerifiedAtMs, restoreGeneratedAtMs].every(
        (value) =>
          Number.isFinite(observedAtMs) &&
          value <= observedAtMs + MAX_CLOCK_SKEW_MS &&
          observedAtMs - value <= MAX_BACKUP_AGE_MS,
      ));
    valid =
    chronologyValid &&
    currentFreshnessValid &&
    backup?.schemaVersion === BACKUP_VERIFICATION_SCHEMA &&
    backup?.method === ONLINE_BACKUP_METHOD &&
    backup?.mutationPerformed === true &&
    backup?.verified === true &&
    String(backup?.backup_id || "").trim() === evidence.backup_id &&
    samePath(backup?.backupPath, backupPath) &&
    samePath(backup?.evidencePath, backupProofPath) &&
    samePath(backup?.sourcePath, evidence.source_database_path) &&
    String(backup?.sha256 || "").toLowerCase() === backupHash &&
    Number.isSafeInteger(backup?.sizeBytes) &&
    backup.sizeBytes === fs.statSync(backupPath).size &&
    canonicalIso(backup?.createdAt) &&
    canonicalIso(backup?.verifiedAt) &&
    Date.parse(backup.createdAt) <= Date.parse(backup.verifiedAt) &&
    backup.verifiedAt === evidence.provenance.backup_verified_at &&
    proofChecksPass(backup?.verification) &&
    restore?.schema_version === RESTORE_REHEARSAL_SCHEMA &&
    canonicalIso(restore?.generated_at) &&
    restore.generated_at === evidence.provenance.restore_verified_at &&
    samePath(restore?.source_backup, backupPath) &&
    samePath(restore?.source_backup_verification, backupProofPath) &&
    String(restore?.source_backup_verification_sha256 || "").toLowerCase() ===
      backupProof.sha256 &&
    restore?.source_backup_verification_schema === BACKUP_VERIFICATION_SCHEMA &&
    restore?.source_backup_verified_at === backup.verifiedAt &&
    String(restore?.source_backup_id || "").trim() === evidence.backup_id &&
    samePath(restore?.restored_copy, restorePath) &&
    samePath(restore?.evidence_path, restoreProofPath) &&
    String(restore?.source_sha256 || "").toLowerCase() === backupHash &&
    String(restore?.restored_sha256 || "").toLowerCase() === restoreHash &&
    Number.isSafeInteger(restore?.source_size_bytes) &&
    restore.source_size_bytes === fs.statSync(backupPath).size &&
    Number.isSafeInteger(restore?.restored_size_bytes) &&
    restore.restored_size_bytes === fs.statSync(restorePath).size &&
    restore?.hashes_match === true &&
    proofChecksPass(restore?.verification) &&
    restore?.production_database_mutated === false &&
    restore?.restored_copy_opened_read_only === true &&
      restore?.source_backup_opened_as_database === false;
  } catch {
    valid = false;
  }
  return { valid, backupProof, restoreProof };
}

function verifyBackupEvidence({
  evidencePath,
  databasePath,
  plan,
  observedAtMs,
  expectedBackupEvidenceSha256,
  expectedBackupVerificationSha256,
  expectedRestoreRehearsalSha256,
  enforceFreshness = true,
}) {
  const blockers = [];
  const resolvedEvidencePath = evidencePath
    ? path.resolve(String(evidencePath))
    : null;
  if (
    !resolvedEvidencePath ||
    !canonicalSingleLinkFile(resolvedEvidencePath)
  ) {
    return {
      blockers: ["terminal_job_run_repair_backup_evidence_required"],
      evidence: null,
      evidencePath: resolvedEvidencePath,
      evidenceSha256: null,
    };
  }
  let evidence;
  let evidenceRaw;
  let evidenceSha256;
  try {
    evidenceRaw = fs.readFileSync(resolvedEvidencePath);
    evidenceSha256 = sha256(evidenceRaw);
    evidence = JSON.parse(evidenceRaw.toString("utf8"));
  } catch {
    return {
      blockers: ["terminal_job_run_repair_backup_evidence_invalid"],
      evidence: null,
      evidencePath: resolvedEvidencePath,
      evidenceSha256: null,
    };
  }
  if (
    !SHA256_PATTERN.test(
      String(expectedBackupEvidenceSha256 || "").toLowerCase(),
    ) ||
    evidenceSha256 !== String(expectedBackupEvidenceSha256).toLowerCase()
  ) {
    blockers.push(
      "terminal_job_run_repair_backup_evidence_confirmation_mismatch",
    );
  }
  const canonical = validateCanonicalCutoverBackupEvidenceV1(evidence);
  if (!canonical.valid) {
    blockers.push("terminal_job_run_repair_backup_evidence_invalid");
  }
  if (
    evidence.restore_test_status !== "PASS" ||
    evidence.backup_restore_hashes_match !== true ||
    evidence.quick_check !== "ok" ||
    evidence.integrity_check !== "ok" ||
    evidence.foreign_key_check !== "ok"
  ) {
    blockers.push("terminal_job_run_repair_restore_rehearsal_required");
  }
  const backupPath = String(evidence.backup_path || "");
  const restorePath = String(evidence.restore_path || "");
  const evidenceIdentity = canonicalFileIdentity(resolvedEvidencePath);
  const backupIdentity = canonicalFileIdentity(backupPath);
  const restoreIdentity = canonicalFileIdentity(restorePath);
  const backupSidecars = sqliteSidecarState(backupPath);
  const restoreSidecars = sqliteSidecarState(restorePath);
  if (sidecarBlockers(backupSidecars).length > 0) {
    blockers.push("terminal_job_run_repair_backup_sidecar_unsafe");
  }
  if (sidecarBlockers(restoreSidecars).length > 0) {
    blockers.push("terminal_job_run_repair_restore_sidecar_unsafe");
  }
  const provenance = validateBackupProvenance({
    evidence,
    backupPath,
    restorePath,
    expectedBackupVerificationSha256,
    expectedRestoreRehearsalSha256,
    observedAtMs,
    enforceFreshness,
  });
  if (!provenance.valid) {
    blockers.push("terminal_job_run_repair_backup_provenance_invalid");
  }
  if (!samePath(evidence.source_database_path, databasePath)) {
    blockers.push("terminal_job_run_repair_backup_source_path_mismatch");
  }
  if (
    String(evidence.source_database_sha256 || "").toLowerCase() !==
    plan?.database?.source_sha256
  ) {
    blockers.push("terminal_job_run_repair_backup_source_hash_mismatch");
  }
  if (samePath(backupPath, databasePath)) {
    blockers.push(
      "terminal_job_run_repair_backup_must_be_distinct_from_source",
    );
  }
  if (samePath(restorePath, databasePath)) {
    blockers.push(
      "terminal_job_run_repair_restore_must_be_distinct_from_source",
    );
  }
  if (samePath(restorePath, backupPath)) {
    blockers.push(
      "terminal_job_run_repair_restore_must_be_distinct_from_backup",
    );
  }
  if (!exactFileHashMatches(backupPath, evidence.backup_sha256)) {
    if (!canonicalSingleLinkFile(backupPath)) {
      blockers.push("terminal_job_run_repair_backup_file_unsafe");
    }
    blockers.push("terminal_job_run_repair_backup_hash_mismatch");
  }
  if (!exactFileHashMatches(restorePath, evidence.restore_sha256)) {
    if (!canonicalSingleLinkFile(restorePath)) {
      blockers.push("terminal_job_run_repair_restore_file_unsafe");
    }
    blockers.push("terminal_job_run_repair_restore_hash_mismatch");
  }
  const verifiedAtMs = timestampMs(evidence.verified_at);
  if (
    enforceFreshness &&
    !Number.isFinite(observedAtMs) ||
    (enforceFreshness &&
      (verifiedAtMs === null ||
        verifiedAtMs > observedAtMs + MAX_CLOCK_SKEW_MS ||
        observedAtMs - verifiedAtMs > MAX_BACKUP_AGE_MS))
  ) {
    blockers.push("terminal_job_run_repair_backup_evidence_stale");
  }
  if (hashFile(resolvedEvidencePath) !== evidenceSha256) {
    blockers.push("terminal_job_run_repair_backup_evidence_changed");
  }
  return {
    blockers: unique(blockers),
    evidence,
    evidencePath: resolvedEvidencePath,
    evidenceSha256,
    evidenceIdentity,
    backupIdentity,
    restoreIdentity,
    backupSidecars,
    restoreSidecars,
    backupProof: provenance.backupProof,
    restoreProof: provenance.restoreProof,
  };
}

function tableNames(db) {
  return new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
}

function inspectRepairSchema(db) {
  const blockers = [];
  const tables = tableNames(db);
  const columns = {};
  for (const [table, required] of Object.entries(REQUIRED_REPAIR_COLUMNS)) {
    if (!tables.has(table)) {
      blockers.push(`required_table_missing:${table}`);
      columns[table] = [];
      continue;
    }
    const actual = db
      .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
      .all()
      .map((column) => String(column.name));
    columns[table] = actual;
    for (const column of required) {
      if (!actual.includes(column)) {
        blockers.push(`required_column_missing:${table}.${column}`);
      }
    }
    if (
      table === "operator_audit_log" &&
      stableJson([...actual].sort()) !== stableJson([...required].sort())
    ) {
      blockers.push("terminal_job_run_repair_operator_audit_schema_invalid");
    }
  }

  let expectedMigrationChecksum = null;
  try {
    expectedMigrationChecksum = hashFile(MIGRATION_023_PATH);
  } catch {
    blockers.push("terminal_job_run_repair_migration_023_integrity_mismatch");
  }
  const migration = tables.has("schema_migrations")
    ? db
        .prepare(
          `SELECT version, filename, checksum
           FROM schema_migrations
           WHERE version = '023'`,
        )
        .get() || null
    : null;
  if (!migration) {
    blockers.push("terminal_job_run_repair_migration_023_required");
  } else if (
    migration.filename !== MIGRATION_023_FILENAME ||
    String(migration.checksum || "").toLowerCase() !== expectedMigrationChecksum
  ) {
    blockers.push("terminal_job_run_repair_migration_023_integrity_mismatch");
  }

  const auditTriggers = tables.has("operator_audit_log")
    ? db
        .prepare(
          `SELECT name, sql
           FROM sqlite_master
           WHERE type = 'trigger' AND tbl_name = 'operator_audit_log'
           ORDER BY name`,
        )
        .all()
        .map((trigger) => ({
          name: String(trigger.name),
          normalised_sql: normaliseSchemaSql(trigger.sql),
        }))
    : [];
  const expectedAuditTriggers = Object.entries(EXPECTED_AUDIT_TRIGGER_SQL)
    .map(([name, sql]) => ({
      name,
      normalised_sql: normaliseSchemaSql(sql),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (stableJson(auditTriggers) !== stableJson(expectedAuditTriggers)) {
    blockers.push(
      "terminal_job_run_repair_operator_audit_immutability_invalid",
    );
  }

  const auditIndexRow = tables.has("operator_audit_log")
    ? db
        .prepare(
          `SELECT name, sql
           FROM sqlite_master
           WHERE type = 'index'
             AND tbl_name = 'operator_audit_log'
             AND name = 'ux_operator_audit_idempotency'`,
        )
        .get() || null
    : null;
  const auditIndexList = tables.has("operator_audit_log")
    ? db
        .prepare("PRAGMA index_list(operator_audit_log)")
        .all()
        .find((index) => index.name === "ux_operator_audit_idempotency") || null
    : null;
  const auditIndexColumns = auditIndexRow
    ? db
        .prepare(
          `PRAGMA index_info(${quoteIdentifier("ux_operator_audit_idempotency")})`,
        )
        .all()
        .map((column) => String(column.name))
    : [];
  const auditIndex = {
    name: auditIndexRow?.name || null,
    normalised_sql: normaliseSchemaSql(auditIndexRow?.sql),
    unique: auditIndexList ? Number(auditIndexList.unique) : null,
    partial: auditIndexList ? Number(auditIndexList.partial) : null,
    columns: auditIndexColumns,
  };
  if (
    auditIndex.name !== "ux_operator_audit_idempotency" ||
    auditIndex.normalised_sql !== normaliseSchemaSql(EXPECTED_AUDIT_INDEX_SQL) ||
    auditIndex.unique !== 1 ||
    auditIndex.partial !== 1 ||
    stableJson(auditIndex.columns) !== stableJson(["idempotency_key"])
  ) {
    blockers.push(
      "terminal_job_run_repair_operator_audit_idempotency_invalid",
    );
  }

  const jobRunTriggers = tables.has("job_runs")
    ? db
        .prepare(
          `SELECT name, sql
           FROM sqlite_master
           WHERE type = 'trigger' AND tbl_name = 'job_runs'
           ORDER BY name`,
        )
        .all()
        .map((trigger) => ({
          name: String(trigger.name),
          normalised_sql: normaliseSchemaSql(trigger.sql),
        }))
    : [];
  if (jobRunTriggers.length > 0) {
    blockers.push("terminal_job_run_repair_job_runs_trigger_present");
  }

  const evidence = {
    schema_version: REPAIR_SCHEMA_VERSION,
    migration_023: migration
      ? {
          version: String(migration.version),
          filename: String(migration.filename),
          checksum: String(migration.checksum).toLowerCase(),
          expected_checksum: expectedMigrationChecksum,
        }
      : null,
    columns,
    operator_audit_triggers: auditTriggers,
    operator_audit_idempotency_index: auditIndex,
    job_runs_triggers: jobRunTriggers,
  };
  return {
    blockers: unique(blockers),
    evidence: {
      ...evidence,
      contract_sha256: sha256(stableJson(evidence)),
    },
  };
}

function inspectRepairRows(db, { generatedAtMs }) {
  const schema = inspectRepairSchema(db);
  const blockers = [...schema.blockers];
  if (blockers.length) {
    return { actions: [], blockers: unique(blockers), schemaContract: schema.evidence };
  }

  const jobs = db
    .prepare(
      `SELECT id, kind, status, attempt_count, claimed_by, updated_at,
              completed_at
       FROM jobs
       ORDER BY id`,
    )
    .all();
  if (jobs.some((job) => ["claimed", "running"].includes(job.status))) {
    blockers.push("terminal_job_run_repair_active_job_present");
  }
  const leases = db
    .prepare("SELECT name, expires_at FROM runtime_leases ORDER BY name")
    .all();
  for (const lease of leases) {
    const expiresAtMs = timestampMs(lease.expires_at);
    if (expiresAtMs === null) {
      blockers.push("terminal_job_run_repair_runtime_authority_invalid");
    } else if (expiresAtMs > generatedAtMs) {
      blockers.push("terminal_job_run_repair_active_lease_present");
    }
  }
  const workers = db
    .prepare(
      `SELECT id, status, last_seen_at
       FROM workers
       ORDER BY id`,
    )
    .all();
  for (const worker of workers) {
    if (worker.status === "offline") continue;
    if (!ACTIVE_WORKER_STATUSES.has(worker.status)) {
      blockers.push("terminal_job_run_repair_runtime_authority_invalid");
      continue;
    }
    const lastSeenAtMs = timestampMs(worker.last_seen_at);
    if (lastSeenAtMs === null) {
      blockers.push("terminal_job_run_repair_runtime_authority_invalid");
    } else if (generatedAtMs - lastSeenAtMs <= WORKER_FRESHNESS_MS) {
      blockers.push("terminal_job_run_repair_fresh_worker_present");
    }
  }
  const runs = db
    .prepare(
      `SELECT id, job_id, worker_id, attempt, status, started_at,
              finished_at, duration_ms, error_message, log_excerpt
       FROM job_runs
       ORDER BY job_id, attempt, id`,
    )
    .all();
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const runsByJobId = new Map();
  for (const run of runs) {
    const rows = runsByJobId.get(run.job_id) || [];
    rows.push(run);
    runsByJobId.set(run.job_id, rows);
  }

  const actions = [];
  for (const run of runs.filter((row) => row.finished_at === null)) {
    const job = jobsById.get(run.job_id);
    if (!job || !["done", "failed"].includes(job.status)) {
      blockers.push(`terminal_job_run_repair_open_run_not_terminal:${run.id}`);
      continue;
    }
    const lineage = runsByJobId.get(run.job_id) || [];
    const runsByAttempt = new Map();
    for (const lineageRun of lineage) {
      const attemptRuns = runsByAttempt.get(lineageRun.attempt) || [];
      attemptRuns.push(lineageRun);
      runsByAttempt.set(lineageRun.attempt, attemptRuns);
    }
    const attemptCount = Number(job.attempt_count);
    const uniqueContiguousLineage =
      Number.isInteger(attemptCount) &&
      attemptCount > 0 &&
      lineage.length === attemptCount &&
      Array.from({ length: attemptCount }, (_, index) => index + 1).every(
        (attempt) => (runsByAttempt.get(attempt) || []).length === 1,
      );
    const successor = uniqueContiguousLineage
      ? runsByAttempt.get(run.attempt + 1)?.[0] || null
      : null;
    const finalRun = uniqueContiguousLineage
      ? runsByAttempt.get(attemptCount)?.[0] || null
      : null;
    const monotonicStarts =
      uniqueContiguousLineage &&
      Array.from({ length: attemptCount }, (_, index) => index + 1).every(
        (attempt, index, attempts) => {
          const startedAt = timestampMs(
            runsByAttempt.get(attempt)?.[0]?.started_at,
          );
          if (startedAt === null) return false;
          if (index === 0) return true;
          const priorStartedAt = timestampMs(
            runsByAttempt.get(attempts[index - 1])?.[0]?.started_at,
          );
          return priorStartedAt !== null && startedAt >= priorStartedAt;
        },
      );
    const valid =
      uniqueContiguousLineage &&
      monotonicStarts &&
      run.status === "running" &&
      run.duration_ms === null &&
      run.error_message === null &&
      run.log_excerpt === null &&
      successor &&
      successor.attempt === run.attempt + 1 &&
      timestampMs(run.started_at) !== null &&
      timestampMs(successor.started_at) !== null &&
      timestampMs(successor.started_at) >= timestampMs(run.started_at) &&
      finalRun &&
      finalRun.finished_at !== null &&
      finalRun.attempt === job.attempt_count &&
      finalRun.status === job.status;
    if (!valid) {
      blockers.push(`terminal_job_run_repair_lineage_invalid:${run.id}`);
      continue;
    }
    actions.push({
      run_id: run.id,
      job_id: run.job_id,
      worker_id: run.worker_id,
      attempt: run.attempt,
      started_at: run.started_at,
      successor_run_id: successor.id,
      successor_attempt: successor.attempt,
      successor_started_at: successor.started_at,
      terminal_job_status: job.status,
      terminal_attempt_count: job.attempt_count,
      final_run_id: finalRun.id,
      final_run_status: finalRun.status,
      final_run_finished_at: finalRun.finished_at,
      repair_status: "failed",
      repair_finished_at: successor.started_at,
      repair_error_message:
        `historical_run_superseded_by_next_attempt:${successor.id}`,
    });
  }
  if (actions.length === 0 && blockers.length === 0) {
    blockers.push("terminal_job_run_repair_no_eligible_rows");
  }
  return {
    actions,
    blockers: unique(blockers),
    schemaContract: schema.evidence,
  };
}

function planTerminalJobRunRepair({
  databasePath,
  generatedAt = new Date(),
  now = new Date(),
  repairId,
  sourceCommitSha,
  operatorId,
  changeWindowId,
  backupEvidencePath,
  expectedBackupEvidenceSha256,
  expectedBackupVerificationSha256,
  expectedRestoreRehearsalSha256,
  executorWorkspaceRoot = path.resolve(__dirname, "../.."),
  executorInspector = defaultExecutorInspector,
  executorModulePath = __filename,
  executorEntrypointPath = require.main?.filename,
  DatabaseImpl = null,
} = {}) {
  const resolved = requiredDatabasePath(databasePath);
  const generatedAtDate = new Date(generatedAt);
  const observedAtDate = new Date(now);
  const blockers = [];
  const normalisedRepairId = String(repairId || "").trim();
  const normalisedCommit = String(sourceCommitSha || "").trim().toLowerCase();
  const normalisedOperatorId = String(operatorId || "").trim();
  const normalisedChangeWindowId = String(changeWindowId || "").trim();
  if (!REPAIR_ID_PATTERN.test(normalisedRepairId)) {
    blockers.push("terminal_job_run_repair_id_required");
  }
  if (!COMMIT_PATTERN.test(normalisedCommit)) {
    blockers.push("terminal_job_run_repair_source_commit_required");
  }
  if (!AUTHORITY_ID_PATTERN.test(normalisedOperatorId)) {
    blockers.push("terminal_job_run_repair_operator_authority_required");
  }
  if (!AUTHORITY_ID_PATTERN.test(normalisedChangeWindowId)) {
    blockers.push("terminal_job_run_repair_change_window_authority_required");
  }
  if (Number.isNaN(generatedAtDate.getTime())) {
    blockers.push("terminal_job_run_repair_generated_at_invalid");
  }
  if (Number.isNaN(observedAtDate.getTime())) {
    blockers.push("terminal_job_run_repair_clock_invalid");
  } else if (
    !Number.isNaN(generatedAtDate.getTime()) &&
    Math.abs(generatedAtDate.getTime() - observedAtDate.getTime()) >
      MAX_CLOCK_SKEW_MS
  ) {
    blockers.push("terminal_job_run_repair_generated_at_not_current");
  }
  const sourceDatabaseSha256 = hashFile(resolved);
  const sourceIdentity = canonicalFileIdentity(resolved);
  const executor = inspectExecutorAuthority({
    workspaceRoot: path.resolve(String(executorWorkspaceRoot || "")),
    expectedCommit: normalisedCommit,
    executorInspector,
    modulePath: executorModulePath,
    entrypointPath: executorEntrypointPath,
  });
  blockers.push(...executor.blockers);
  const backup = verifyBackupEvidence({
    evidencePath: backupEvidencePath,
    databasePath: resolved,
    plan: { database: { source_sha256: sourceDatabaseSha256 } },
    observedAtMs: observedAtDate.getTime(),
    expectedBackupEvidenceSha256,
    expectedBackupVerificationSha256,
    expectedRestoreRehearsalSha256,
  });
  blockers.push(...backup.blockers);
  const sidecars = sqliteSidecarState(resolved);
  const preOpenBlockers = sidecarBlockers(sidecars);
  blockers.push(...preOpenBlockers);
  let inspection = {
    actions: [],
    blockers: [],
    journalMode: null,
    schemaContract: null,
  };
  if (preOpenBlockers.length === 0) {
    inspection = withReadOnlySqliteSnapshot(
      resolved,
      (db) => {
        db.pragma("temp_store = MEMORY");
        const journalMode = String(
          db.pragma("journal_mode", { simple: true }) || "",
        ).toLowerCase();
        const inspected = inspectRepairRows(db, {
          generatedAtMs: observedAtDate.getTime(),
        });
        return {
          ...inspected,
          journalMode,
          blockers: unique([
            ...inspected.blockers,
            ...(journalMode === "wal"
              ? []
              : ["terminal_job_run_repair_journal_mode_not_wal"]),
          ]),
        };
      },
      { DatabaseImpl },
    );
  }
  blockers.push(...inspection.blockers);
  const postInspectionSidecars = sqliteSidecarState(resolved);
  blockers.push(...sidecarBlockers(postInspectionSidecars));
  const postInspectionIdentity = canonicalFileIdentity(resolved);
  if (!sameFileIdentity(sourceIdentity, postInspectionIdentity)) {
    blockers.push("terminal_job_run_repair_source_identity_changed_during_plan");
  }
  if (hashFile(resolved) !== sourceDatabaseSha256) {
    blockers.push("terminal_job_run_repair_source_changed_during_plan");
  }
  const uniqueBlockers = unique(blockers);
  const core = {
    schema_version: PLAN_SCHEMA,
    mode: "PLAN",
    generated_at: Number.isNaN(generatedAtDate.getTime())
      ? null
      : generatedAtDate.toISOString(),
    authority_observed_at: Number.isNaN(observedAtDate.getTime())
      ? null
      : observedAtDate.toISOString(),
    repair_id: normalisedRepairId || null,
    source_commit_sha: COMMIT_PATTERN.test(normalisedCommit)
      ? normalisedCommit
      : null,
    operator_id: AUTHORITY_ID_PATTERN.test(normalisedOperatorId)
      ? normalisedOperatorId
      : null,
    change_window_id: AUTHORITY_ID_PATTERN.test(normalisedChangeWindowId)
      ? normalisedChangeWindowId
      : null,
    executor: executor.evidence,
    backup_authority: {
      evidence_path: backup.evidencePath,
      expected_evidence_sha256: SHA256_PATTERN.test(
        String(expectedBackupEvidenceSha256 || "").toLowerCase(),
      )
        ? String(expectedBackupEvidenceSha256).toLowerCase()
        : null,
      backup_verification_path:
        backup.backupProof?.path ||
        String(backup.evidence?.provenance?.backup_verification_file || "") ||
        null,
      expected_backup_verification_sha256: SHA256_PATTERN.test(
        String(expectedBackupVerificationSha256 || "").toLowerCase(),
      )
        ? String(expectedBackupVerificationSha256).toLowerCase()
        : null,
      restore_rehearsal_path:
        backup.restoreProof?.path ||
        String(backup.evidence?.provenance?.restore_rehearsal_file || "") ||
        null,
      expected_restore_rehearsal_sha256: SHA256_PATTERN.test(
        String(expectedRestoreRehearsalSha256 || "").toLowerCase(),
      )
        ? String(expectedRestoreRehearsalSha256).toLowerCase()
        : null,
      backup_sidecars: backup.backupSidecars,
      restore_sidecars: backup.restoreSidecars,
    },
    database: {
      path: resolved,
      source_sha256: sourceDatabaseSha256,
      source_identity: sourceIdentity,
      journal_mode: inspection.journalMode,
      read_only_inspection: true,
      sqlite_sidecars: sidecars,
      sqlite_sidecars_after_inspection: postInspectionSidecars,
      source_identity_after_inspection: postInspectionIdentity,
      repair_schema_contract: inspection.schemaContract,
    },
    classification: classifyActions(inspection.actions),
    actions: inspection.actions,
    blockers: uniqueBlockers,
    verdict: uniqueBlockers.length === 0 ? "READY_TO_APPLY" : "HOLD",
  };
  return {
    ...core,
    plan_sha256: sha256(stableJson(core)),
  };
}

function applyTerminalJobRunRepair({
  databasePath,
  plan,
  expectedPlanSha256,
  confirmationRepairId,
  backupEvidencePath,
  expectedBackupEvidenceSha256,
  expectedBackupVerificationSha256,
  expectedRestoreRehearsalSha256,
  confirmationOperatorId,
  confirmationChangeWindowId,
  actorId,
  changeWindowId,
  executorWorkspaceRoot = path.resolve(__dirname, "../.."),
  executorInspector = defaultExecutorInspector,
  executorModulePath = __filename,
  executorEntrypointPath = require.main?.filename,
  now = new Date(),
  DatabaseImpl = null,
  hooks = {},
} = {}) {
  const resolved = requiredDatabasePath(databasePath);
  const blockers = [];
  const firstApplyBlockers = [];
  const applyNowDate = new Date(now);
  const applyNowMs = applyNowDate.getTime();
  const appliedAt = Number.isFinite(applyNowMs)
    ? applyNowDate.toISOString()
    : null;
  const planGeneratedAtMs = timestampMs(plan?.generated_at);
  if (!Number.isFinite(applyNowMs)) {
    blockers.push("terminal_job_run_repair_clock_invalid");
  } else if (
    planGeneratedAtMs === null ||
    planGeneratedAtMs > applyNowMs + MAX_CLOCK_SKEW_MS ||
    applyNowMs - planGeneratedAtMs > MAX_PLAN_AGE_MS
  ) {
    firstApplyBlockers.push("terminal_job_run_repair_plan_stale");
  }
  const core = planCore(plan);
  if (
    !core ||
    plan.schema_version !== PLAN_SCHEMA ||
    plan.mode !== "PLAN" ||
    plan.verdict !== "READY_TO_APPLY" ||
    !Array.isArray(plan.blockers) ||
    plan.blockers.length !== 0 ||
    !Array.isArray(plan.actions) ||
    plan.actions.length === 0 ||
    sha256(stableJson(core)) !== plan.plan_sha256
  ) {
    blockers.push("terminal_job_run_repair_plan_invalid");
  }
  if (
    !SHA256_PATTERN.test(String(expectedPlanSha256 || "")) ||
    expectedPlanSha256 !== plan?.plan_sha256
  ) {
    blockers.push("terminal_job_run_repair_expected_plan_hash_required");
  }
  if (
    !REPAIR_ID_PATTERN.test(String(confirmationRepairId || "")) ||
    confirmationRepairId !== plan?.repair_id
  ) {
    blockers.push("terminal_job_run_repair_matching_confirmation_required");
  }
  const operatorConfirmation = String(
    confirmationOperatorId || actorId || "",
  ).trim();
  const changeWindowConfirmation = String(
    confirmationChangeWindowId || changeWindowId || "",
  ).trim();
  if (
    !AUTHORITY_ID_PATTERN.test(operatorConfirmation) ||
    operatorConfirmation !== plan?.operator_id
  ) {
    blockers.push(
      "terminal_job_run_repair_operator_confirmation_mismatch",
    );
  }
  if (
    !AUTHORITY_ID_PATTERN.test(changeWindowConfirmation) ||
    changeWindowConfirmation !== plan?.change_window_id
  ) {
    blockers.push(
      "terminal_job_run_repair_change_window_confirmation_mismatch",
    );
  }
  if (
    actorId != null &&
    String(actorId).trim() !== plan?.operator_id
  ) {
    blockers.push(
      "terminal_job_run_repair_operator_authority_ambiguous",
    );
  }
  if (
    changeWindowId != null &&
    String(changeWindowId).trim() !== plan?.change_window_id
  ) {
    blockers.push(
      "terminal_job_run_repair_change_window_authority_ambiguous",
    );
  }
  if (
    !samePath(backupEvidencePath, plan?.backup_authority?.evidence_path) ||
    expectedBackupEvidenceSha256 !==
      plan?.backup_authority?.expected_evidence_sha256
  ) {
    blockers.push(
      "terminal_job_run_repair_backup_evidence_confirmation_mismatch",
    );
  }
  if (
    expectedBackupVerificationSha256 !==
      plan?.backup_authority?.expected_backup_verification_sha256
  ) {
    blockers.push(
      "terminal_job_run_repair_backup_verification_confirmation_mismatch",
    );
  }
  if (
    expectedRestoreRehearsalSha256 !==
      plan?.backup_authority?.expected_restore_rehearsal_sha256
  ) {
    blockers.push(
      "terminal_job_run_repair_restore_rehearsal_confirmation_mismatch",
    );
  }
  if (!samePath(resolved, plan?.database?.path)) {
    blockers.push("terminal_job_run_repair_database_path_mismatch");
  }
  const currentSourceSha256 = hashFile(resolved);
  const currentSourceIdentity = canonicalFileIdentity(resolved);
  blockers.push(...sidecarBlockers(sqliteSidecarState(resolved)));
  const executor = inspectExecutorAuthority({
    workspaceRoot: path.resolve(String(executorWorkspaceRoot || "")),
    expectedCommit: plan?.source_commit_sha,
    executorInspector,
    modulePath: executorModulePath,
    entrypointPath: executorEntrypointPath,
  });
  blockers.push(...executor.blockers);
  if (stableJson(executor.evidence) !== stableJson(plan?.executor)) {
    blockers.push("terminal_job_run_repair_executor_attestation_drift");
  }
  const backup = verifyBackupEvidence({
    evidencePath: backupEvidencePath,
    databasePath: resolved,
    plan,
    observedAtMs: applyNowMs,
    expectedBackupEvidenceSha256,
    expectedBackupVerificationSha256,
    expectedRestoreRehearsalSha256,
    enforceFreshness: false,
  });
  blockers.push(...backup.blockers);
  if (
    stableJson(backup.backupSidecars) !==
      stableJson(plan?.backup_authority?.backup_sidecars) ||
    stableJson(backup.restoreSidecars) !==
      stableJson(plan?.backup_authority?.restore_sidecars)
  ) {
    blockers.push("terminal_job_run_repair_backup_sidecar_drift");
  }
  if (blockers.length) return holdResult({ plan, blockers });

  const Database = DatabaseImpl || require("better-sqlite3");
  if (typeof hooks.beforeDatabaseOpen === "function") {
    hooks.beforeDatabaseOpen();
  }
  const db = new Database(resolved, { fileMustExist: true });
  let dbClosed = false;
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 0");
  db.pragma("temp_store = MEMORY");
  try {
    const openedJournalMode = String(
      db.pragma("journal_mode", { simple: true }) || "",
    ).toLowerCase();
    if (
      plan?.database?.journal_mode !== "wal" ||
      openedJournalMode !== "wal"
    ) {
      return holdResult({
        plan,
        blockers: ["terminal_job_run_repair_journal_mode_not_wal"],
      });
    }
    const openedMainPath = openedMainDatabasePath(db);
    const openedSourceIdentity = openedMainPath
      ? canonicalFileIdentity(openedMainPath)
      : null;
    const existing = inspectExistingRepair(db, plan, {
      currentSourceIdentity,
      backup,
      executor,
    });
    if (typeof hooks.afterExistingRepairInspection === "function") {
      hooks.afterExistingRepairInspection({ db, existing });
    }
    const openedIdentityValid =
      samePath(openedMainPath, resolved) &&
      sameDurableFileIdentity(currentSourceIdentity, openedSourceIdentity) &&
      sameDurableFileIdentity(
        openedSourceIdentity,
        plan.database.source_identity,
      );
    if (!openedIdentityValid) {
      return holdResult({
        plan,
        blockers: [
          existing
            ? "terminal_job_run_repair_idempotent_opened_database_identity_drift"
            : "terminal_job_run_repair_source_identity_changed",
        ],
      });
    }
    if (existing) {
      const replayResult = existingRepairResult(plan, existing);
      if (replayResult.verdict !== "IDEMPOTENT_NOOP") return replayResult;
      let replayCheckpoint;
      try {
        replayCheckpoint = checkpointWalAfterCommit(db);
      } catch {
        return replayCommittedHoldResult(plan, existing, [
          "terminal_job_run_repair_idempotent_clean_close_failed",
        ]);
      }
      if (typeof hooks.afterReplayFinalInspection === "function") {
        hooks.afterReplayFinalInspection({ db, existing });
      }
      const replayFinal = finalExistingRepairAttestation(db, plan, {
        databasePath: resolved,
        openedSourceIdentity,
        backup,
        executorWorkspaceRoot,
        executorInspector,
        executorModulePath,
        executorEntrypointPath,
      });
      if (!replayFinal.executorStable) {
        return replayCommittedHoldResult(
          plan,
          existing,
          ["terminal_job_run_repair_idempotent_executor_drift"],
          replayCheckpoint,
        );
      }
      if (!replayFinal.identityStable) {
        return replayCommittedHoldResult(
          plan,
          existing,
          [
            "terminal_job_run_repair_idempotent_opened_database_identity_drift",
          ],
          replayCheckpoint,
        );
      }
      if (!replayFinal.dataVersionStable) {
        return replayCommittedHoldResult(
          plan,
          existing,
          ["terminal_job_run_repair_idempotent_state_drift"],
          replayCheckpoint,
        );
      }
      if (
        !replayFinal.inspection ||
        replayFinal.inspection.outcome !== "IDEMPOTENT"
      ) {
        return replayCommittedHoldResult(
          plan,
          existing,
          [
            replayFinal.inspection?.outcome === "CONFLICT"
              ? "terminal_job_run_repair_idempotency_conflict"
              : "terminal_job_run_repair_idempotent_state_drift",
          ],
          replayCheckpoint,
        );
      }
      replayResult.post_commit_checks = {
        replay_audit_and_remainder: "ok",
        opened_database_identity: "ok",
        data_version: "stable",
        ...replayCheckpoint,
      };
      try {
        db.close();
        dbClosed = true;
      } catch {
        return replayCommittedHoldResult(
          plan,
          existing,
          ["terminal_job_run_repair_idempotent_clean_close_failed"],
          replayResult.post_commit_checks,
        );
      }
      const replayPostCloseIdentity = canonicalFileIdentity(resolved);
      if (
        !sameDurableFileIdentity(
          replayPostCloseIdentity,
          openedSourceIdentity,
        )
      ) {
        return replayCommittedHoldResult(
          plan,
          existing,
          [
            "terminal_job_run_repair_idempotent_opened_database_identity_drift",
          ],
          replayResult.post_commit_checks,
        );
      }
      const replaySidecars = sqliteSidecarState(resolved);
      const replaySidecarBlockers = sidecarBlockers(replaySidecars);
      replayResult.post_commit_checks.post_close_sidecar_state = replaySidecars;
      replayResult.post_commit_checks.post_close_sidecars =
        replaySidecarBlockers.length === 0 ? "clean" : "unsafe";
      if (replaySidecarBlockers.length > 0) {
        return replayCommittedHoldResult(
          plan,
          existing,
          [
            "terminal_job_run_repair_idempotent_post_close_sidecars_unsafe",
            ...replaySidecarBlockers,
          ],
          replayResult.post_commit_checks,
        );
      }
      return replayResult;
    }
    const freshBackup = verifyBackupEvidence({
      evidencePath: backupEvidencePath,
      databasePath: resolved,
      plan,
      observedAtMs: applyNowMs,
      expectedBackupEvidenceSha256,
      expectedBackupVerificationSha256,
      expectedRestoreRehearsalSha256,
      enforceFreshness: true,
    });
    firstApplyBlockers.push(...freshBackup.blockers);
    if (firstApplyBlockers.length > 0) {
      return holdResult({ plan, blockers: firstApplyBlockers });
    }
    if (currentSourceSha256 !== plan.database.source_sha256) {
      return holdResult({
        plan,
        blockers: ["terminal_job_run_repair_source_hash_changed"],
      });
    }
    const beforeFenceSidecars = sqliteSidecarState(resolved);
    const beforeFenceHash = hashFile(resolved);
    const beforeFenceIdentity = canonicalFileIdentity(resolved);
    if (
      beforeFenceHash !== plan.database.source_sha256 ||
      !sameFileIdentity(beforeFenceIdentity, plan.database.source_identity) ||
      sidecarBlockers(beforeFenceSidecars).some(
        (blocker) =>
          blocker !== "terminal_job_run_repair_shared_memory_present",
      )
    ) {
      return holdResult({
        plan,
        blockers: ["terminal_job_run_repair_source_drift_before_fence"],
      });
    }
    const baselineDataVersion = Number(
      db.pragma("data_version", { simple: true }),
    );
    const beforeState = snapshotRepairState(db, plan);
    if (typeof hooks.beforeTransaction === "function") {
      hooks.beforeTransaction({ db });
    }
    const execute = db.transaction(() => {
      const fencedDataVersion = Number(
        db.pragma("data_version", { simple: true }),
      );
      const fencedIdentity = canonicalFileIdentity(resolved);
      const fencedSidecars = sqliteSidecarState(resolved);
      const fencedSidecarBlockers = sidecarBlockers(fencedSidecars).filter(
        (blocker) =>
          blocker !== "terminal_job_run_repair_shared_memory_present",
      );
      if (
        fencedDataVersion !== baselineDataVersion ||
        hashFile(resolved) !== plan.database.source_sha256 ||
        fencedSidecarBlockers.length > 0
      ) {
        throw new Error("terminal_job_run_repair_source_drift_at_fence");
      }
      if (!sameFileIdentity(fencedIdentity, plan.database.source_identity)) {
        throw new Error(
          "terminal_job_run_repair_source_identity_drift_at_fence",
        );
      }
      const fencedExecutor = inspectExecutorAuthority({
        workspaceRoot: path.resolve(String(executorWorkspaceRoot || "")),
        expectedCommit: plan.source_commit_sha,
        executorInspector,
        modulePath: executorModulePath,
        entrypointPath: executorEntrypointPath,
      });
      if (
        fencedExecutor.blockers.length > 0 ||
        stableJson(fencedExecutor.evidence) !== stableJson(plan.executor)
      ) {
        throw new Error("terminal_job_run_repair_executor_drift_at_fence");
      }
      const fencedBackupSidecars = sqliteSidecarState(
        backup.evidence.backup_path,
      );
      const fencedRestoreSidecars = sqliteSidecarState(
        backup.evidence.restore_path,
      );
      if (
        hashFile(backup.evidencePath) !== backup.evidenceSha256 ||
        !sameFileIdentity(
          canonicalFileIdentity(backup.evidencePath),
          backup.evidenceIdentity,
        ) ||
        !exactFileHashMatches(
          backup.evidence.backup_path,
          backup.evidence.backup_sha256,
        ) ||
        !sameFileIdentity(
          canonicalFileIdentity(backup.evidence.backup_path),
          backup.backupIdentity,
        ) ||
        !exactFileHashMatches(
          backup.evidence.restore_path,
          backup.evidence.restore_sha256,
        ) ||
        !sameFileIdentity(
          canonicalFileIdentity(backup.evidence.restore_path),
          backup.restoreIdentity,
        ) ||
        hashFile(backup.backupProof.path) !== backup.backupProof.sha256 ||
        !sameFileIdentity(
          canonicalFileIdentity(backup.backupProof.path),
          backup.backupProof.identity,
        ) ||
        hashFile(backup.restoreProof.path) !== backup.restoreProof.sha256 ||
        !sameFileIdentity(
          canonicalFileIdentity(backup.restoreProof.path),
          backup.restoreProof.identity,
        ) ||
        sidecarBlockers(fencedBackupSidecars).length > 0 ||
        stableJson(fencedBackupSidecars) !==
          stableJson(backup.backupSidecars) ||
        sidecarBlockers(fencedRestoreSidecars).length > 0 ||
        stableJson(fencedRestoreSidecars) !==
          stableJson(backup.restoreSidecars)
      ) {
        throw new Error("terminal_job_run_repair_backup_drift_at_fence");
      }
      const current = inspectRepairRows(db, {
        generatedAtMs: applyNowMs,
      });
      if (
        current.blockers.length > 0 ||
        stableJson(current.schemaContract) !==
          stableJson(plan.database.repair_schema_contract) ||
        sha256(stableJson(current.actions)) !== sha256(stableJson(plan.actions))
      ) {
        throw new Error("terminal_job_run_repair_plan_drift");
      }
      const update = db.prepare(`
        UPDATE job_runs
        SET status = @repairStatus,
            finished_at = @repairFinishedAt,
            error_message = @repairErrorMessage
        WHERE id = @runId
          AND job_id = @jobId
          AND worker_id IS @workerId
          AND attempt = @attempt
          AND status = 'running'
          AND started_at = @startedAt
          AND finished_at IS NULL
          AND duration_ms IS NULL
          AND error_message IS NULL
          AND log_excerpt IS NULL
          AND EXISTS (
            SELECT 1 FROM job_runs successor
            WHERE successor.id = @successorRunId
              AND successor.job_id = @jobId
              AND successor.attempt = @successorAttempt
              AND successor.started_at = @successorStartedAt
          )
          AND EXISTS (
            SELECT 1 FROM jobs terminal_job
            WHERE terminal_job.id = @jobId
              AND terminal_job.status = @terminalJobStatus
              AND terminal_job.attempt_count = @terminalAttemptCount
          )
          AND EXISTS (
            SELECT 1 FROM job_runs final_run
            WHERE final_run.id = @finalRunId
              AND final_run.job_id = @jobId
              AND final_run.status = @finalRunStatus
              AND final_run.finished_at = @finalRunFinishedAt
          )
      `);
      const mutations = [];
      for (const [index, action] of plan.actions.entries()) {
        if (typeof hooks.beforeUpdate === "function") {
          hooks.beforeUpdate({ index, action, db });
        }
        const changed = update.run({
          repairStatus: action.repair_status,
          repairFinishedAt: action.repair_finished_at,
          repairErrorMessage: action.repair_error_message,
          runId: action.run_id,
          jobId: action.job_id,
          workerId: action.worker_id,
          attempt: action.attempt,
          startedAt: action.started_at,
          successorRunId: action.successor_run_id,
          successorAttempt: action.successor_attempt,
          successorStartedAt: action.successor_started_at,
          terminalJobStatus: action.terminal_job_status,
          terminalAttemptCount: action.terminal_attempt_count,
          finalRunId: action.final_run_id,
          finalRunStatus: action.final_run_status,
          finalRunFinishedAt: action.final_run_finished_at,
        }).changes;
        if (changed !== 1) {
          throw new Error("terminal_job_run_repair_plan_drift");
        }
        mutations.push({
          run_id: action.run_id,
          job_id: action.job_id,
          successor_run_id: action.successor_run_id,
          status: action.repair_status,
          finished_at: action.repair_finished_at,
        });
      }
      const openJobRunCount = db
        .prepare("SELECT COUNT(*) AS count FROM job_runs WHERE finished_at IS NULL")
        .get().count;
      if (openJobRunCount !== 0) {
        throw new Error("terminal_job_run_repair_postcheck_open_run_present");
      }
      const quick = db.pragma("quick_check");
      const foreignKeys = db.pragma("foreign_key_check");
      const postChecks = {
        open_job_run_count: openJobRunCount,
        quick_check:
          quick.length === 1 &&
          String(Object.values(quick[0])[0]).toLowerCase() === "ok"
            ? "ok"
            : "failed",
        foreign_key_check: foreignKeys.length === 0 ? "ok" : "failed",
      };
      if (
        postChecks.quick_check !== "ok" ||
        postChecks.foreign_key_check !== "ok"
      ) {
        throw new Error("terminal_job_run_repair_postcheck_failed");
      }
      const idempotencyKey =
        `governed-terminal-job-run-repair:${plan.repair_id}`;
      const evidence = {
        schema_version: RESULT_SCHEMA,
        repair_id: plan.repair_id,
        plan_generated_at: plan.generated_at,
        applied_at: appliedAt,
        plan_sha256: plan.plan_sha256,
        source_database_sha256: plan.database.source_sha256,
        source_database_identity: plan.database.source_identity,
        operator_id: plan.operator_id,
        change_window_id: plan.change_window_id,
        executor: executor.evidence,
        backup: canonicalAuditBackupEvidence(backup, plan),
        mutations_performed: mutations,
        post_checks: postChecks,
        durable_after_state: {
          source_identity: durableFileIdentity(
            canonicalFileIdentity(resolved),
          ),
          logical_digest: operationRemainderDigest(db, idempotencyKey),
          live_runtime_transition_lease_digest:
            liveRuntimeTransitionLeaseDigest(db),
        },
      };
      if (typeof hooks.beforeAudit === "function") {
        hooks.beforeAudit({ db, evidence });
      }
      const audit = db
        .prepare(
          `INSERT INTO operator_audit_log
             (actor_id, action, target_type, target_id, decision, reason,
              evidence_json, created_at, idempotency_key)
           VALUES
             (?, 'governed_terminal_job_run_repair', 'sqlite_database', ?,
              'APPLIED', ?, ?, ?, ?)`,
        )
        .run(
          plan.operator_id,
          plan.repair_id,
          "causally_superseded_terminal_job_runs_closed",
          JSON.stringify(evidence),
          appliedAt,
          idempotencyKey,
        );
      return {
        mutations,
        postChecks,
        auditId: Number(audit.lastInsertRowid),
        appliedAt,
      };
    });
    let applied;
    try {
      applied = execute.immediate();
    } catch (error) {
      return rollbackResult({
        plan,
        error,
        checks: verifyRollback(db, plan, beforeState),
      });
    }
    try {
      if (typeof hooks.afterCommit === "function") {
        hooks.afterCommit({ db, applied });
      }
      const committedCheckpoint = checkpointWalAfterCommit(db);
      if (typeof hooks.afterPostCommitCheckpoint === "function") {
        hooks.afterPostCommitCheckpoint({ db, applied });
      }
      const committed = finalExistingRepairAttestation(db, plan, {
        databasePath: resolved,
        openedSourceIdentity,
        backup,
        executorWorkspaceRoot,
        executorInspector,
        executorModulePath,
        executorEntrypointPath,
      });
      if (!committed.executorStable) {
        throw new Error(
          "terminal_job_run_repair_post_commit_executor_drift",
        );
      }
      if (
        !committed.identityStable ||
        !committed.dataVersionStable ||
        !committed.inspection ||
        committed.inspection.outcome !== "IDEMPOTENT"
      ) {
        throw new Error("terminal_job_run_repair_post_commit_state_invalid");
      }
      applied.postCommitChecks = {
        audit_and_row_state: "ok",
        opened_database_identity: "ok",
        data_version: "stable",
        ...committedCheckpoint,
      };
    } catch (error) {
      const committedBlockers = [
        [
          "terminal_job_run_repair_wal_checkpoint_incomplete",
          "terminal_job_run_repair_post_commit_executor_drift",
        ].includes(error?.message)
          ? error.message
          : "terminal_job_run_repair_post_commit_evidence_incomplete",
      ];
      const cleanupChecks = {
        post_commit_verification: "incomplete",
      };
      try {
        Object.assign(cleanupChecks, checkpointWalAfterCommit(db));
      } catch (cleanupError) {
        committedBlockers.push(
          [
            "terminal_job_run_repair_wal_checkpoint_incomplete",
            "terminal_job_run_repair_journal_mode_not_wal",
          ].includes(cleanupError?.message)
            ? cleanupError.message
            : "terminal_job_run_repair_post_commit_checkpoint_failed",
        );
      }
      try {
        db.close();
        dbClosed = true;
      } catch {
        committedBlockers.push(
          "terminal_job_run_repair_database_close_failed",
        );
      }
      if (dbClosed) {
        const cleanupSidecars = sqliteSidecarState(resolved);
        const cleanupSidecarBlockers = sidecarBlockers(cleanupSidecars);
        cleanupChecks.post_close_sidecar_state = cleanupSidecars;
        cleanupChecks.post_close_sidecars =
          cleanupSidecarBlockers.length === 0 ? "clean" : "unsafe";
        if (cleanupSidecarBlockers.length > 0) {
          committedBlockers.push(
            "terminal_job_run_repair_post_close_sidecars_unsafe",
            ...cleanupSidecarBlockers,
          );
        }
      }
      applied.postCommitChecks = cleanupChecks;
      return committedHoldResult({
        plan,
        applied,
        blockers: committedBlockers,
      });
    }
    try {
      db.close();
      dbClosed = true;
    } catch {
      return committedHoldResult({
        plan,
        applied,
        blockers: ["terminal_job_run_repair_database_close_failed"],
      });
    }
    const postCloseSidecars = sqliteSidecarState(resolved);
    const postCloseBlockers = sidecarBlockers(postCloseSidecars);
    applied.postCommitChecks.post_close_sidecars =
      postCloseBlockers.length === 0 ? "clean" : "unsafe";
    applied.postCommitChecks.post_close_sidecar_state = postCloseSidecars;
    if (postCloseBlockers.length > 0) {
      return committedHoldResult({
        plan,
        applied,
        blockers: [
          "terminal_job_run_repair_post_close_sidecars_unsafe",
          ...postCloseBlockers,
        ],
      });
    }
    return {
      schema_version: RESULT_SCHEMA,
      generated_at: applied.appliedAt,
      applied_at: applied.appliedAt,
      plan_generated_at: plan.generated_at,
      repair_id: plan.repair_id,
      mode: "APPLY",
      verdict: "APPLIED",
      plan_sha256: plan.plan_sha256,
      blockers: [],
      mutations_performed: applied.mutations,
      audit_id: applied.auditId,
      post_checks: applied.postChecks,
      post_commit_checks: applied.postCommitChecks,
      safety: {
        production_database_mutated: true,
        external_calls: [],
        oauth_or_tokens_mutated: false,
        publication_state_mutated: false,
      },
    };
  } finally {
    if (!dbClosed) {
      try {
        db.close();
      } catch {
        // APPLY paths surface close failure after commit as COMMITTED_HOLD.
      }
    }
  }
}

module.exports = {
  PLAN_SCHEMA,
  RESULT_SCHEMA,
  applyTerminalJobRunRepair,
  planTerminalJobRunRepair,
  stableJson,
};

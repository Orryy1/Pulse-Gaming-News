"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const test = require("node:test");
const Database = require("better-sqlite3");

const {
  applyTerminalJobRunRepair: applyTerminalJobRunRepairImpl,
  planTerminalJobRunRepair: planTerminalJobRunRepairImpl,
} = require("../../lib/ops/governed-terminal-job-run-repair");
const {
  LIVE_RUNTIME_TRANSITION_LEASE_NAME,
} = require("../../lib/stabilisation/live-runtime-transition-lease");

const GENERATED_AT = "2026-08-08T14:00:00.000Z";
const ROOT = path.resolve(__dirname, "../..");
const SOURCE_COMMIT_SHA = String(
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }),
)
  .trim()
  .toLowerCase();
const TOOL_PATH = path.resolve(
  ROOT,
  "tools/governed-terminal-job-run-repair.js",
);
const MIGRATION_023_PATH = path.resolve(
  ROOT,
  "db/migrations/023_stabilisation_governance_hardening.sql",
);
const MIGRATION_023_SHA256 = sha256File(MIGRATION_023_PATH);

function planTerminalJobRunRepair(options) {
  const backup = options.backupEvidencePath
    ? backupAuthorityFromEvidence(options.backupEvidencePath)
    : createCanonicalBackupEvidence(
        {
          databasePath: options.databasePath,
          directory: path.dirname(options.databasePath),
        },
        { referenceTime: options.generatedAt || GENERATED_AT },
      );
  const backupAuthority = backupAuthorityFromEvidence(backup.evidencePath);
  return planTerminalJobRunRepairImpl({
    operatorId: "repair-operator",
    changeWindowId: `change-window-${options.repairId}`,
    backupEvidencePath: backupAuthority.evidencePath,
    expectedBackupEvidenceSha256: backupAuthority.evidenceSha256,
    expectedBackupVerificationSha256:
      backupAuthority.backupVerificationSha256,
    expectedRestoreRehearsalSha256:
      backupAuthority.restoreRehearsalSha256,
    executorWorkspaceRoot: ROOT,
    executorInspector: ({ expectedCommit }) => ({
      available: true,
      commit: expectedCommit,
      root_match: true,
      tracked_clean: true,
      code_tracked_at_head: true,
    }),
    executorModulePath: path.join(
      ROOT,
      "lib",
      "ops",
      "governed-terminal-job-run-repair.js",
    ),
    executorEntrypointPath: TOOL_PATH,
    ...options,
    now: options.now || options.generatedAt,
  });
}

function applyTerminalJobRunRepair(options) {
  const forwarded = { ...options };
  delete forwarded.forwardLegacyAuthority;
  if (!options.forwardLegacyAuthority) {
    delete forwarded.actorId;
    delete forwarded.changeWindowId;
  }
  return applyTerminalJobRunRepairImpl({
    confirmationOperatorId:
      options.confirmationOperatorId || options.plan?.operator_id,
    confirmationChangeWindowId:
      options.confirmationChangeWindowId || options.plan?.change_window_id,
    expectedBackupEvidenceSha256:
      options.expectedBackupEvidenceSha256 ||
      options.plan?.backup_authority?.expected_evidence_sha256,
    expectedBackupVerificationSha256:
      options.expectedBackupVerificationSha256 ||
      options.plan?.backup_authority?.expected_backup_verification_sha256,
    expectedRestoreRehearsalSha256:
      options.expectedRestoreRehearsalSha256 ||
      options.plan?.backup_authority?.expected_restore_rehearsal_sha256,
    executorWorkspaceRoot: ROOT,
    executorInspector: ({ expectedCommit }) => ({
      available: true,
      commit: expectedCommit,
      root_match: true,
      tracked_clean: true,
      code_tracked_at_head: true,
    }),
    executorModulePath: path.join(
      ROOT,
      "lib",
      "ops",
      "governed-terminal-job-run-repair.js",
    ),
    executorEntrypointPath: TOOL_PATH,
    ...forwarded,
    now: options.now || options.plan?.generated_at,
  });
}

function runTool(args, env = {}) {
  const harness = `
    "use strict";
    const tool = require(${JSON.stringify(TOOL_PATH)});
    try {
      tool.main(JSON.parse(process.env.PULSE_TERMINAL_REPAIR_TEST_ARGS), {
        executorInspector: ({ expectedCommit }) => ({
          available: true,
          commit: expectedCommit,
          root_match: true,
          tracked_clean: true,
          code_tracked_at_head: true,
        }),
      });
    } catch (error) {
      process.stderr.write(JSON.stringify({
        mode: "HOLD",
        verdict: "HOLD",
        blockers: [String(error?.message || "terminal_job_run_repair_failed")],
      }) + "\\n");
      process.exitCode = 1;
    }
  `;
  return spawnSync(process.execPath, ["-e", harness], {
    cwd: path.resolve(__dirname, "../.."),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      PULSE_TERMINAL_REPAIR_TEST_ARGS: JSON.stringify(args),
    },
  });
}

function cliPlanAuthorityArgs(backup, changeWindowId) {
  return [
    "--executor-workspace-root",
    ROOT,
    "--operator-id",
    "repair-operator",
    "--change-window-id",
    changeWindowId,
    "--backup-evidence",
    backup.evidencePath,
    "--expected-backup-evidence-sha256",
    backup.evidenceSha256,
    "--expected-backup-verification-sha256",
    backup.backupVerificationSha256,
    "--expected-restore-rehearsal-sha256",
    backup.restoreRehearsalSha256,
  ];
}

function cliApplyAuthorityArgs(plan) {
  return [
    "--executor-workspace-root",
    ROOT,
    "--backup-evidence",
    plan.backup_authority.evidence_path,
    "--confirm-operator-id",
    plan.operator_id,
    "--confirm-change-window-id",
    plan.change_window_id,
    "--confirm-backup-evidence-sha256",
    plan.backup_authority.expected_evidence_sha256,
    "--confirm-backup-verification-sha256",
    plan.backup_authority.expected_backup_verification_sha256,
    "--confirm-restore-rehearsal-sha256",
    plan.backup_authority.expected_restore_rehearsal_sha256,
  ];
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function backupAuthorityFromEvidence(evidencePath) {
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  return {
    evidencePath,
    evidenceSha256: sha256File(evidencePath),
    backupVerificationSha256: sha256File(
      evidence.provenance.backup_verification_file,
    ),
    restoreRehearsalSha256: sha256File(
      evidence.provenance.restore_rehearsal_file,
    ),
  };
}

function createFixture(t, { seedBase = true } = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-terminal-run-repair-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, "pulse.db");
  const db = new Database(databasePath);
  assert.equal(
    String(db.pragma("journal_mode = WAL", { simple: true })),
    "wal",
  );
  db.exec(`
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL,
      claimed_by TEXT,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE job_runs (
      id INTEGER PRIMARY KEY,
      job_id INTEGER NOT NULL,
      worker_id TEXT,
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      error_message TEXT,
      log_excerpt TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );
    CREATE TABLE runtime_leases (
      name TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE workers (
      id TEXT PRIMARY KEY,
      status TEXT,
      last_seen_at TEXT
    );
    CREATE TABLE operator_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      decision TEXT,
      reason TEXT,
      evidence_json TEXT,
      created_at TEXT NOT NULL,
      idempotency_key TEXT
    );
    CREATE UNIQUE INDEX ux_operator_audit_idempotency
      ON operator_audit_log(idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    CREATE TRIGGER trg_operator_audit_log_immutable_update
    BEFORE UPDATE ON operator_audit_log
    BEGIN
      SELECT RAISE(ABORT, 'immutable_operator_audit_log');
    END;
    CREATE TRIGGER trg_operator_audit_log_immutable_delete
    BEFORE DELETE ON operator_audit_log
    BEGIN
      SELECT RAISE(ABORT, 'immutable_operator_audit_log');
    END;
    CREATE TABLE schema_migrations (
      version TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    `INSERT INTO schema_migrations (version, filename, checksum)
     VALUES ('023', '023_stabilisation_governance_hardening.sql', ?)`,
  ).run(MIGRATION_023_SHA256);
  if (seedBase) {
    db.prepare(
      `INSERT INTO jobs
         (id, kind, status, attempt_count, claimed_by, updated_at, completed_at)
       VALUES (101, 'produce', 'done', 2, 'worker-final', ?, ?)`,
    ).run("2026-06-01 10:10:00", "2026-06-01 10:10:00");
    db.prepare(
      `INSERT INTO job_runs
         (id, job_id, worker_id, attempt, status, started_at)
       VALUES (1001, 101, 'worker-first', 1, 'running', ?)`,
    ).run("2026-06-01 10:00:00");
    db.prepare(
      `INSERT INTO job_runs
         (id, job_id, worker_id, attempt, status, started_at, finished_at,
          duration_ms)
       VALUES (1002, 101, 'worker-final', 2, 'done', ?, ?, 300000)`,
    ).run("2026-06-01 10:05:00", "2026-06-01 10:10:00");
  }
  db.close();
  return { databasePath, directory };
}

function insertTerminalChain(
  databasePath,
  { jobId, firstRunId, openCount, terminalStatus },
) {
  const db = new Database(databasePath);
  const finalAttempt = openCount + 1;
  const finalRunId = firstRunId + openCount;
  const finalStartedAt = `2026-06-02 10:${String(openCount).padStart(2, "0")}:00`;
  const finalFinishedAt = `2026-06-02 11:${String(openCount).padStart(2, "0")}:00`;
  db.prepare(
    `INSERT INTO jobs
       (id, kind, status, attempt_count, claimed_by, updated_at, completed_at)
     VALUES (?, 'publish', ?, ?, ?, ?, ?)`,
  ).run(
    jobId,
    terminalStatus,
    finalAttempt,
    terminalStatus === "done" ? `worker-${finalAttempt}` : null,
    finalFinishedAt,
    terminalStatus === "done" ? finalFinishedAt : null,
  );
  const insertOpen = db.prepare(
    `INSERT INTO job_runs
       (id, job_id, worker_id, attempt, status, started_at)
     VALUES (?, ?, ?, ?, 'running', ?)`,
  );
  for (let attempt = 1; attempt <= openCount; attempt += 1) {
    insertOpen.run(
      firstRunId + attempt - 1,
      jobId,
      `worker-${attempt}`,
      attempt,
      `2026-06-02 10:${String(attempt - 1).padStart(2, "0")}:00`,
    );
  }
  db.prepare(
    `INSERT INTO job_runs
       (id, job_id, worker_id, attempt, status, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    finalRunId,
    jobId,
    `worker-${finalAttempt}`,
    finalAttempt,
    terminalStatus,
    finalStartedAt,
    finalFinishedAt,
  );
  db.close();
}

function createCanonicalBackupEvidence(
  fixture,
  { referenceTime = GENERATED_AT } = {},
) {
  const backupPath = path.join(fixture.directory, "pulse.backup.db");
  const restorePath = path.join(fixture.directory, "pulse.restore.db");
  const backupVerificationFile = path.join(
    fixture.directory,
    "backup.verification.json",
  );
  const restoreRehearsalFile = path.join(
    fixture.directory,
    "restore.rehearsal.json",
  );
  const evidencePath = path.join(fixture.directory, "backup.evidence.json");
  fs.copyFileSync(fixture.databasePath, backupPath);
  fs.copyFileSync(backupPath, restorePath);
  const passed = {
    openedReadOnly: true,
    quick_check: "ok",
    integrity_check: "ok",
    foreign_key_check: "ok",
    foreign_key_violation_count: 0,
  };
  const backupVerifiedAt = new Date(
    Date.parse(referenceTime) - 180_000,
  ).toISOString();
  const restoreVerifiedAt = new Date(
    Date.parse(referenceTime) - 120_000,
  ).toISOString();
  const backupVerification = {
    backup_id: "terminal-run-repair-backup",
    backupPath,
    createdAt: backupVerifiedAt,
    evidencePath: backupVerificationFile,
    method: "better-sqlite3-online-backup",
    mutationPerformed: true,
    prunedBackups: [],
    schemaVersion: "pulse-sqlite-backup-verification-v1",
    sha256: sha256File(backupPath),
    sizeBytes: fs.statSync(backupPath).size,
    sourcePath: fixture.databasePath,
    verification: { ...passed },
    verified: true,
    verifiedAt: backupVerifiedAt,
  };
  fs.writeFileSync(
    backupVerificationFile,
    `${JSON.stringify(backupVerification, null, 2)}\n`,
  );
  const restoreRehearsal = {
    schema_version: "pulse-restore-rehearsal-v1",
    generated_at: restoreVerifiedAt,
    source_backup: backupPath,
    source_backup_verification: backupVerificationFile,
    source_backup_verification_sha256: sha256File(backupVerificationFile),
    source_backup_verification_schema:
      "pulse-sqlite-backup-verification-v1",
    source_backup_verified_at: backupVerifiedAt,
    source_backup_id: "terminal-run-repair-backup",
    restored_copy: restorePath,
    evidence_path: restoreRehearsalFile,
    source_sha256: sha256File(backupPath),
    restored_sha256: sha256File(restorePath),
    source_size_bytes: fs.statSync(backupPath).size,
    restored_size_bytes: fs.statSync(restorePath).size,
    hashes_match: true,
    verification: { ...passed },
    latest_migration: "fixture",
    latest_migration_filename: "fixture.sql",
    migration_count: 1,
    row_counts: {},
    production_database_mutated: false,
    restored_copy_opened_read_only: true,
    source_backup_opened_as_database: false,
    safety: {
      production_database_opened: false,
      production_database_mutated: false,
      source_backup_mutated: false,
      oauth_or_tokens_mutated: false,
      platforms_contacted: false,
      network_contacted: false,
    },
  };
  fs.writeFileSync(
    restoreRehearsalFile,
    `${JSON.stringify(restoreRehearsal, null, 2)}\n`,
  );
  const evidence = {
    schema_version: "pulse-cutover-backup-evidence-v1",
    backup_id: "terminal-run-repair-backup",
    backup_path: backupPath,
    backup_sha256: sha256File(backupPath),
    source_database_path: fixture.databasePath,
    source_database_sha256: sha256File(fixture.databasePath),
    verified_at: new Date(Date.parse(referenceTime) - 60_000).toISOString(),
    verified_by: "backup-operator",
    restore_test_status: "PASS",
    integrity_check: "ok",
    foreign_key_check: "ok",
    quick_check: "ok",
    restore_path: restorePath,
    restore_sha256: sha256File(restorePath),
    backup_restore_hashes_match: true,
    production_database_mutated: false,
    verification: {
      source: { ...passed },
      backup: { ...passed },
      restore: { ...passed },
    },
    provenance: {
      backup_verification_file: backupVerificationFile,
      backup_verification_schema: "pulse-sqlite-backup-verification-v1",
      backup_verified_at: backupVerifiedAt,
      restore_rehearsal_file: restoreRehearsalFile,
      restore_rehearsal_schema: "pulse-restore-rehearsal-v1",
      restore_verified_at: restoreVerifiedAt,
    },
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return { evidence, evidencePath };
}

test("PLAN identifies one causally superseded terminal run without mutating the database", (t) => {
  const fixture = createFixture(t);
  const beforeHash = sha256File(fixture.databasePath);

  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-20260808",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });

  assert.equal(plan.schema_version, "pulse-terminal-job-run-repair-plan-v1");
  assert.equal(plan.mode, "PLAN");
  assert.equal(plan.verdict, "READY_TO_APPLY");
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.actions.length, 1);
  assert.deepEqual(plan.actions[0], {
    run_id: 1001,
    job_id: 101,
    worker_id: "worker-first",
    attempt: 1,
    started_at: "2026-06-01 10:00:00",
    successor_run_id: 1002,
    successor_attempt: 2,
    successor_started_at: "2026-06-01 10:05:00",
    terminal_job_status: "done",
    terminal_attempt_count: 2,
    final_run_id: 1002,
    final_run_status: "done",
    final_run_finished_at: "2026-06-01 10:10:00",
    repair_status: "failed",
    repair_finished_at: "2026-06-01 10:05:00",
    repair_error_message:
      "historical_run_superseded_by_next_attempt:1002",
  });
  assert.match(plan.plan_sha256, /^[a-f0-9]{64}$/);
  assert.equal(sha256File(fixture.databasePath), beforeHash);
});

test("PLAN inspects a disposable snapshot without opening the governed source", (t) => {
  const fixture = createFixture(t);
  const beforeHash = sha256File(fixture.databasePath);
  function SnapshotOnlyDatabase(databasePath, options) {
    assert.notEqual(
      path.resolve(databasePath),
      path.resolve(fixture.databasePath),
      "the governed source database must not be opened during PLAN",
    );
    return new Database(databasePath, options);
  }

  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-snapshot-plan",
    sourceCommitSha: SOURCE_COMMIT_SHA,
    DatabaseImpl: SnapshotOnlyDatabase,
  });

  assert.equal(plan.verdict, "READY_TO_APPLY");
  assert.equal(sha256File(fixture.databasePath), beforeHash);
  assert.equal(fs.existsSync(`${fixture.databasePath}-wal`), false);
  assert.equal(fs.existsSync(`${fixture.databasePath}-shm`), false);
});

test("PLAN fails closed when the governed source is not in WAL mode", (t) => {
  const fixture = createFixture(t);
  const db = new Database(fixture.databasePath);
  assert.equal(
    String(db.pragma("journal_mode = DELETE", { simple: true })),
    "delete",
  );
  db.close();

  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-delete-journal-mode",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });

  assert.equal(plan.verdict, "HOLD");
  assert.ok(
    plan.blockers.includes(
      "terminal_job_run_repair_journal_mode_not_wal",
    ),
  );
});

test("PLAN rejects a hard-linked source instead of trusting lexical path identity", (t) => {
  const fixture = createFixture(t);
  const hardLinkPath = path.join(fixture.directory, "pulse-hardlink.db");
  fs.linkSync(fixture.databasePath, hardLinkPath);

  assert.throws(
    () =>
      planTerminalJobRunRepair({
        databasePath: hardLinkPath,
        generatedAt: GENERATED_AT,
        repairId: "terminal-runs-hardlink-source",
        sourceCommitSha: SOURCE_COMMIT_SHA,
      }),
    /terminal_job_run_repair_database_file_unsafe/,
  );
});

test("PLAN covers every member of 1..11 superseded chains for done and failed jobs", (t) => {
  const fixture = createFixture(t, { seedBase: false });
  insertTerminalChain(fixture.databasePath, {
    jobId: 201,
    firstRunId: 2001,
    openCount: 11,
    terminalStatus: "done",
  });
  insertTerminalChain(fixture.databasePath, {
    jobId: 202,
    firstRunId: 3001,
    openCount: 3,
    terminalStatus: "failed",
  });

  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-chains",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });

  assert.equal(plan.verdict, "READY_TO_APPLY");
  assert.equal(plan.actions.length, 14);
  assert.equal(plan.actions.filter((row) => row.job_id === 201).length, 11);
  assert.equal(plan.actions.filter((row) => row.job_id === 202).length, 3);
  assert.deepEqual(plan.classification, {
    eligible_run_count: 14,
    affected_job_count: 2,
    done_run_count: 11,
    failed_run_count: 3,
    max_open_runs_per_job: 11,
  });
});

test("PLAN fails closed for every unsafe historical lineage shape", (t) => {
  const scenarios = [
    {
      id: "missing-successor",
      mutate(db) {
        db.prepare("DELETE FROM job_runs WHERE id = 1002").run();
      },
    },
    {
      id: "attempt-gap",
      mutate(db) {
        db.prepare("UPDATE job_runs SET attempt = 3 WHERE id = 1002").run();
        db.prepare("UPDATE jobs SET attempt_count = 3 WHERE id = 101").run();
      },
    },
    {
      id: "reversed-time",
      mutate(db) {
        db.prepare("UPDATE job_runs SET started_at = ? WHERE id = 1002").run(
          "2026-06-01 09:59:00",
        );
      },
    },
    {
      id: "unexpected-metadata",
      mutate(db) {
        db.prepare("UPDATE job_runs SET error_message = ? WHERE id = 1001").run(
          "existing terminal reason",
        );
      },
    },
    {
      id: "final-status-mismatch",
      mutate(db) {
        db.prepare("UPDATE job_runs SET status = 'failed' WHERE id = 1002").run();
      },
    },
  ];

  for (const scenario of scenarios) {
    const fixture = createFixture(t);
    const db = new Database(fixture.databasePath);
    scenario.mutate(db);
    db.close();
    const plan = planTerminalJobRunRepair({
      databasePath: fixture.databasePath,
      generatedAt: GENERATED_AT,
      repairId: `terminal-runs-${scenario.id}`,
      sourceCommitSha: SOURCE_COMMIT_SHA,
    });
    assert.equal(plan.verdict, "HOLD", scenario.id);
    assert.deepEqual(plan.actions, [], scenario.id);
    assert.ok(
      plan.blockers.includes("terminal_job_run_repair_lineage_invalid:1001"),
      scenario.id,
    );
  }
});

test("PLAN holds when duplicate attempts make successor lineage ambiguous", (t) => {
  const fixture = createFixture(t);
  const db = new Database(fixture.databasePath);
  db.prepare(
    `INSERT INTO job_runs
       (id, job_id, worker_id, attempt, status, started_at, finished_at,
        duration_ms)
     VALUES (1003, 101, 'worker-duplicate', 2, 'done', ?, ?, 120000)`,
  ).run("2026-06-01 10:06:00", "2026-06-01 10:08:00");
  db.close();

  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-duplicate-attempt",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });

  assert.equal(plan.verdict, "HOLD");
  assert.deepEqual(plan.actions, []);
  assert.ok(
    plan.blockers.includes("terminal_job_run_repair_lineage_invalid:1001"),
  );
});

test("PLAN holds while any claimed or running job still has runtime authority", (t) => {
  const fixture = createFixture(t);
  const db = new Database(fixture.databasePath);
  db.prepare(
    `INSERT INTO jobs
       (id, kind, status, attempt_count, claimed_by, updated_at, completed_at)
     VALUES (303, 'hunt', 'running', 1, 'worker-live', ?, NULL)`,
  ).run("2026-08-08 13:59:59");
  db.close();

  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-active-job",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });

  assert.equal(plan.verdict, "HOLD");
  assert.ok(
    plan.blockers.includes("terminal_job_run_repair_active_job_present"),
  );
});

test("PLAN holds for an unexpired lease or a fresh live worker heartbeat", (t) => {
  const fixture = createFixture(t);
  const db = new Database(fixture.databasePath);
  db.prepare(
    `INSERT INTO runtime_leases
       (name, owner_id, heartbeat_at, expires_at)
     VALUES ('scheduler:primary', 'scheduler-live', ?, ?)`,
  ).run("2026-08-08T13:59:30.000Z", "2026-08-08T14:01:00.000Z");
  db.prepare(
    `INSERT INTO workers (id, status, last_seen_at)
     VALUES ('worker-live', 'idle', ?)`,
  ).run("2026-08-08T13:59:45.000Z");
  db.close();

  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-active-owner",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });

  assert.equal(plan.verdict, "HOLD");
  assert.ok(
    plan.blockers.includes("terminal_job_run_repair_active_lease_present"),
  );
  assert.ok(
    plan.blockers.includes("terminal_job_run_repair_fresh_worker_present"),
  );
});

test("PLAN classifies every nullable worker status fail closed", async (t) => {
  const cases = [
    {
      label: "NULL status with a fresh heartbeat",
      status: null,
      lastSeenAt: "2026-08-08T13:59:59.000Z",
      expectedVerdict: "HOLD",
      expectedBlocker: "terminal_job_run_repair_runtime_authority_invalid",
    },
    {
      label: "unknown status with a stale heartbeat",
      status: "unknown-runtime-state",
      lastSeenAt: "2026-08-08T12:00:00.000Z",
      expectedVerdict: "HOLD",
      expectedBlocker: "terminal_job_run_repair_runtime_authority_invalid",
    },
    {
      label: "exact offline status with no heartbeat",
      status: "offline",
      lastSeenAt: null,
      expectedVerdict: "READY_TO_APPLY",
      expectedBlocker: null,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.label, () => {
      const fixture = createFixture(t);
      const db = new Database(fixture.databasePath);
      db.prepare(
        `INSERT INTO workers (id, status, last_seen_at)
         VALUES ('worker-status-case', ?, ?)`,
      ).run(scenario.status, scenario.lastSeenAt);
      db.close();

      const plan = planTerminalJobRunRepair({
        databasePath: fixture.databasePath,
        generatedAt: GENERATED_AT,
        repairId: `terminal-runs-worker-status-${scenario.status || "null"}`,
        sourceCommitSha: SOURCE_COMMIT_SHA,
      });

      assert.equal(plan.verdict, scenario.expectedVerdict);
      if (scenario.expectedBlocker) {
        assert.ok(plan.blockers.includes(scenario.expectedBlocker));
      } else {
        assert.deepEqual(plan.blockers, []);
      }
    });
  }
});

test("PLAN cannot age live authority out with a caller-controlled future time", (t) => {
  const fixture = createFixture(t);
  const db = new Database(fixture.databasePath);
  db.prepare(
    `INSERT INTO runtime_leases
       (name, owner_id, heartbeat_at, expires_at)
     VALUES ('scheduler:primary', 'scheduler-live', ?, ?)`,
  ).run("2026-08-08T13:59:30.000Z", "2026-08-08T14:01:00.000Z");
  db.prepare(
    `INSERT INTO workers (id, status, last_seen_at)
     VALUES ('worker-live', 'idle', ?)`,
  ).run("2026-08-08T13:59:45.000Z");
  db.close();

  const plan = planTerminalJobRunRepairImpl({
    databasePath: fixture.databasePath,
    generatedAt: "2036-08-08T14:00:00.000Z",
    now: GENERATED_AT,
    repairId: "terminal-runs-future-clock",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });

  assert.equal(plan.verdict, "HOLD");
  assert.ok(
    plan.blockers.includes("terminal_job_run_repair_generated_at_not_current"),
  );
  assert.ok(
    plan.blockers.includes("terminal_job_run_repair_active_lease_present"),
  );
  assert.ok(
    plan.blockers.includes("terminal_job_run_repair_fresh_worker_present"),
  );
});

test("PLAN fails closed before opening a database with WAL or SHM authority", (t) => {
  const fixture = createFixture(t);
  fs.writeFileSync(`${fixture.databasePath}-wal`, "not-checkpointed");
  fs.writeFileSync(`${fixture.databasePath}-shm`, "shared-memory-present");

  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-sidecars",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });

  assert.equal(plan.verdict, "HOLD");
  assert.deepEqual(plan.actions, []);
  assert.ok(
    plan.blockers.includes("terminal_job_run_repair_wal_not_checkpointed"),
  );
  assert.ok(
    plan.blockers.includes("terminal_job_run_repair_shared_memory_present"),
  );
});

test("PLAN rejects empty or multiply-linked SQLite sidecars", async (t) => {
  for (const scenario of ["empty-shm", "hardlinked-wal", "hardlinked-shm"]) {
    await t.test(scenario, () => {
      const fixture = createFixture(t);
      const suffix = scenario.endsWith("shm") ? "-shm" : "-wal";
      const sidecarPath = `${fixture.databasePath}${suffix}`;
      fs.writeFileSync(sidecarPath, Buffer.alloc(0));
      if (scenario.startsWith("hardlinked")) {
        fs.linkSync(
          sidecarPath,
          path.join(fixture.directory, `${scenario}.alias`),
        );
      }

      const plan = planTerminalJobRunRepair({
        databasePath: fixture.databasePath,
        generatedAt: GENERATED_AT,
        repairId: `terminal-runs-${scenario}`,
        sourceCommitSha: SOURCE_COMMIT_SHA,
      });

      assert.equal(plan.verdict, "HOLD");
      assert.ok(
        plan.blockers.includes(
          suffix === "-shm"
            ? "terminal_job_run_repair_shared_memory_present"
            : "terminal_job_run_repair_wal_not_checkpointed",
        ),
      );
    });
  }
});

test("APPLY closes only the reviewed run and records immutable evidence atomically", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-apply",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const backup = createCanonicalBackupEvidence(fixture);

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
    actorId: "repair-operator",
    changeWindowId: "change-window-1",
  });

  assert.equal(result.schema_version, "pulse-terminal-job-run-repair-result-v1");
  assert.equal(result.verdict, "APPLIED");
  assert.equal(result.mutations_performed.length, 1);
  assert.equal(result.post_checks.open_job_run_count, 0);
  assert.equal(result.safety.external_calls.length, 0);
  assert.equal(result.safety.oauth_or_tokens_mutated, false);
  assert.equal(result.safety.publication_state_mutated, false);

  const check = new Database(fixture.databasePath, { readonly: true });
  const repaired = check.prepare("SELECT * FROM job_runs WHERE id = 1001").get();
  const finalRun = check.prepare("SELECT * FROM job_runs WHERE id = 1002").get();
  const job = check.prepare("SELECT * FROM jobs WHERE id = 101").get();
  const audits = check
    .prepare(
      `SELECT * FROM operator_audit_log
       WHERE action = 'governed_terminal_job_run_repair'`,
    )
    .all();
  check.close();

  assert.equal(repaired.status, "failed");
  assert.equal(repaired.finished_at, "2026-06-01 10:05:00");
  assert.equal(repaired.duration_ms, null);
  assert.equal(
    repaired.error_message,
    "historical_run_superseded_by_next_attempt:1002",
  );
  assert.equal(finalRun.status, "done");
  assert.equal(finalRun.finished_at, "2026-06-01 10:10:00");
  assert.equal(job.status, "done");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].target_id, plan.repair_id);
});

test("APPLY inserts final evidence once under the production audit immutability triggers", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-immutable-audit",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const backup = createCanonicalBackupEvidence(fixture);

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
  });

  assert.equal(result.verdict, "APPLIED");
  const check = new Database(fixture.databasePath);
  const audit = check
    .prepare(
      `SELECT id, evidence_json
       FROM operator_audit_log
       WHERE idempotency_key = ?`,
    )
    .get(`governed-terminal-job-run-repair:${plan.repair_id}`);
  const evidence = JSON.parse(audit.evidence_json);
  assert.match(evidence.durable_after_state.logical_digest, /^[a-f0-9]{64}$/);
  assert.match(
    evidence.durable_after_state.live_runtime_transition_lease_digest,
    /^[a-f0-9]{64}$/,
  );
  assert.throws(
    () =>
      check
        .prepare("UPDATE operator_audit_log SET evidence_json = '{}' WHERE id = ?")
        .run(audit.id),
    /immutable_operator_audit_log/,
  );
  check.close();
});

test("PLAN fails closed when the production repair schema contract is weakened", async (t) => {
  const scenarios = [
    {
      name: "immutable audit trigger missing",
      mutate(db) {
        db.exec("DROP TRIGGER trg_operator_audit_log_immutable_update");
      },
      blocker: "terminal_job_run_repair_operator_audit_immutability_invalid",
    },
    {
      name: "audit idempotency index weakened",
      mutate(db) {
        db.exec(`
          DROP INDEX ux_operator_audit_idempotency;
          CREATE INDEX ux_operator_audit_idempotency
            ON operator_audit_log(idempotency_key);
        `);
      },
      blocker: "terminal_job_run_repair_operator_audit_idempotency_invalid",
    },
    {
      name: "job run update trigger added",
      mutate(db) {
        db.exec(`
          CREATE TRIGGER fixture_job_runs_side_effect
          AFTER UPDATE ON job_runs
          BEGIN
            UPDATE jobs SET updated_at = 'fixture-side-effect' WHERE id = NEW.job_id;
          END;
        `);
      },
      blocker: "terminal_job_run_repair_job_runs_trigger_present",
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      const fixture = createFixture(t);
      const schema = new Database(fixture.databasePath);
      scenario.mutate(schema);
      schema.close();

      const plan = planTerminalJobRunRepair({
        databasePath: fixture.databasePath,
        generatedAt: GENERATED_AT,
        repairId: `terminal-runs-schema-${scenario.name.replaceAll(" ", "-")}`,
        sourceCommitSha: SOURCE_COMMIT_SHA,
      });

      assert.equal(plan.verdict, "HOLD");
      assert.ok(plan.blockers.includes(scenario.blocker));
    });
  }
});

test("APPLY audit chronology and restore proof bind to actual mutation time", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-audit-chronology",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const backup = createCanonicalBackupEvidence(fixture);
  const appliedAt = "2026-08-08T14:04:00.000Z";

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
    actorId: "repair-operator",
    changeWindowId: "change-window-chronology",
    now: appliedAt,
  });

  assert.equal(result.verdict, "APPLIED");
  assert.equal(result.generated_at, appliedAt);
  assert.equal(result.applied_at, appliedAt);
  assert.equal(result.plan_generated_at, GENERATED_AT);
  const check = new Database(fixture.databasePath, { readonly: true });
  const audit = check
    .prepare(
      "SELECT created_at, evidence_json FROM operator_audit_log WHERE id = ?",
    )
    .get(result.audit_id);
  check.close();
  const evidence = JSON.parse(audit.evidence_json);
  assert.equal(audit.created_at, appliedAt);
  assert.equal(evidence.applied_at, appliedAt);
  assert.equal(evidence.plan_generated_at, GENERATED_AT);
  assert.equal(evidence.backup.evidence_sha256, sha256File(backup.evidencePath));
  assert.equal(evidence.backup.restore_path, backup.evidence.restore_path);
  assert.equal(evidence.backup.restore_sha256, backup.evidence.restore_sha256);
  assert.equal(evidence.backup.verified_at, backup.evidence.verified_at);
});

test("APPLY holds with a specific blocker when the restore rehearsal did not pass", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-restore-hold",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const backup = createCanonicalBackupEvidence(fixture);
  backup.evidence.restore_test_status = "FAIL";
  fs.writeFileSync(
    backup.evidencePath,
    `${JSON.stringify(backup.evidence, null, 2)}\n`,
  );
  const beforeHash = sha256File(fixture.databasePath);

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
    actorId: "repair-operator",
    changeWindowId: "change-window-restore-hold",
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "terminal_job_run_repair_restore_rehearsal_required",
    ),
  );
  assert.equal(sha256File(fixture.databasePath), beforeHash);
  const check = new Database(fixture.databasePath, { readonly: true });
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM job_runs WHERE finished_at IS NULL").get()
      .count,
    1,
  );
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    0,
  );
  check.close();
});

test("APPLY refuses a reviewed plan after its bounded change window expires", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-stale-plan",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const backup = createCanonicalBackupEvidence(fixture);
  const beforeHash = sha256File(fixture.databasePath);

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
    now: "2026-08-08T15:00:01.000Z",
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("terminal_job_run_repair_plan_stale"),
  );
  assert.equal(sha256File(fixture.databasePath), beforeHash);
});

test("APPLY holds when the exact backup file no longer matches its evidence", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-backup-drift",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const backup = createCanonicalBackupEvidence(fixture);
  fs.appendFileSync(backup.evidence.backup_path, "tampered");
  const beforeHash = sha256File(fixture.databasePath);

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
    actorId: "repair-operator",
    changeWindowId: "change-window-backup-drift",
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("terminal_job_run_repair_backup_hash_mismatch"),
  );
  assert.equal(sha256File(fixture.databasePath), beforeHash);
});

test("APPLY rejects backup or restore sidecars introduced after PLAN", async (t) => {
  for (const target of ["backup", "restore"]) {
    await t.test(target, () => {
      const fixture = createFixture(t);
      const plan = planTerminalJobRunRepair({
        databasePath: fixture.databasePath,
        generatedAt: GENERATED_AT,
        repairId: `terminal-runs-${target}-sidecar-drift`,
        sourceCommitSha: SOURCE_COMMIT_SHA,
      });
      const evidence = JSON.parse(
        fs.readFileSync(plan.backup_authority.evidence_path, "utf8"),
      );
      const targetPath =
        target === "backup" ? evidence.backup_path : evidence.restore_path;
      fs.writeFileSync(`${targetPath}-wal`, "unreviewed sidecar");

      const result = applyTerminalJobRunRepair({
        databasePath: fixture.databasePath,
        plan,
        expectedPlanSha256: plan.plan_sha256,
        confirmationRepairId: plan.repair_id,
        backupEvidencePath: plan.backup_authority.evidence_path,
      });

      assert.equal(result.verdict, "HOLD");
      assert.ok(
        result.blockers.includes(
          `terminal_job_run_repair_${target}_sidecar_unsafe`,
        ),
      );
      const check = new Database(fixture.databasePath, { readonly: true });
      assert.equal(
        check
          .prepare(
            "SELECT COUNT(*) AS count FROM job_runs WHERE finished_at IS NULL",
          )
          .get().count,
        1,
      );
      check.close();
    });
  }
});

test("APPLY holds when backup evidence is bound to another source hash", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-source-binding",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const backup = createCanonicalBackupEvidence(fixture);
  backup.evidence.source_database_sha256 = "f".repeat(64);
  fs.writeFileSync(
    backup.evidencePath,
    `${JSON.stringify(backup.evidence, null, 2)}\n`,
  );
  const beforeHash = sha256File(fixture.databasePath);

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
    actorId: "repair-operator",
    changeWindowId: "change-window-source-binding",
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "terminal_job_run_repair_backup_source_hash_mismatch",
    ),
  );
  assert.equal(sha256File(fixture.databasePath), beforeHash);
});

test("APPLY rejects backup or restore paths that alias the source database", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-backup-alias",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const backup = createCanonicalBackupEvidence(fixture);
  const sourceHash = sha256File(fixture.databasePath);
  backup.evidence.backup_path = fixture.databasePath;
  backup.evidence.backup_sha256 = sourceHash;
  backup.evidence.restore_path = fixture.databasePath;
  backup.evidence.restore_sha256 = sourceHash;
  fs.writeFileSync(
    backup.evidencePath,
    `${JSON.stringify(backup.evidence, null, 2)}\n`,
  );
  const beforeHash = sha256File(fixture.databasePath);

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
    actorId: "repair-operator",
    changeWindowId: "change-window-backup-alias",
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "terminal_job_run_repair_backup_must_be_distinct_from_source",
    ),
  );
  assert.ok(
    result.blockers.includes(
      "terminal_job_run_repair_restore_must_be_distinct_from_source",
    ),
  );
  assert.ok(
    result.blockers.includes(
      "terminal_job_run_repair_restore_must_be_distinct_from_backup",
    ),
  );
  assert.equal(sha256File(fixture.databasePath), beforeHash);
});

test("APPLY rechecks WAL and SHM immediately before opening the database", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-apply-sidecars",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const backup = createCanonicalBackupEvidence(fixture);
  fs.writeFileSync(`${fixture.databasePath}-wal`, "not-checkpointed");
  fs.writeFileSync(`${fixture.databasePath}-shm`, "shared-memory-present");
  const beforeHash = sha256File(fixture.databasePath);

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
    actorId: "repair-operator",
    changeWindowId: "change-window-sidecars",
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("terminal_job_run_repair_wal_not_checkpointed"),
  );
  assert.ok(
    result.blockers.includes("terminal_job_run_repair_shared_memory_present"),
  );
  assert.equal(sha256File(fixture.databasePath), beforeHash);
});

test("APPLY checkpoints WAL and verifies clean sidecars after the committed close", (t) => {
  const fixture = createFixture(t);
  const walDb = new Database(fixture.databasePath);
  assert.equal(String(walDb.pragma("journal_mode = WAL", { simple: true })), "wal");
  walDb.pragma("wal_checkpoint(TRUNCATE)");
  walDb.close();
  for (const suffix of ["-wal", "-shm"]) {
    const sidecarPath = `${fixture.databasePath}${suffix}`;
    if (fs.existsSync(sidecarPath) && fs.statSync(sidecarPath).size === 0) {
      fs.rmSync(sidecarPath);
    }
  }
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-wal-close",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  assert.equal(plan.verdict, "READY_TO_APPLY");
  const backup = createCanonicalBackupEvidence(fixture);

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
    actorId: "repair-operator",
    changeWindowId: "change-window-wal-close",
  });

  assert.equal(result.verdict, "APPLIED");
  assert.equal(result.post_commit_checks.journal_mode, "wal");
  assert.equal(result.post_commit_checks.wal_checkpoint, "ok");
  assert.equal(result.post_commit_checks.post_close_sidecars, "clean");
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const sidecarPath = `${fixture.databasePath}${suffix}`;
    assert.equal(
      !fs.existsSync(sidecarPath) || fs.statSync(sidecarPath).size === 0,
      true,
      sidecarPath,
    );
  }
});

test("APPLY verifies full rollback when the Nth reviewed update fails", (t) => {
  const fixture = createFixture(t, { seedBase: false });
  insertTerminalChain(fixture.databasePath, {
    jobId: 501,
    firstRunId: 5001,
    openCount: 3,
    terminalStatus: "done",
  });
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-nth-rollback",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const backup = createCanonicalBackupEvidence(fixture);

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
    actorId: "repair-operator",
    changeWindowId: "change-window-nth-rollback",
    hooks: {
      beforeUpdate({ index }) {
        if (index === 1) throw new Error("fixture_nth_update_failure");
      },
    },
  });

  assert.equal(result.verdict, "ROLLED_BACK_VERIFIED");
  assert.deepEqual(result.mutations_performed, []);
  assert.equal(result.rollback_checks.planned_rows_restored, true);
  assert.equal(result.rollback_checks.audit_absent, true);
  assert.equal(result.rollback_checks.quick_check, "ok");
  assert.equal(result.rollback_checks.foreign_key_check, "ok");

  const check = new Database(fixture.databasePath, { readonly: true });
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM job_runs WHERE finished_at IS NULL").get()
      .count,
    3,
  );
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    0,
  );
  check.close();
});

test("APPLY detects in-transaction lineage drift and rolls the drift back", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-plan-drift",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const backup = createCanonicalBackupEvidence(fixture);

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
    actorId: "repair-operator",
    changeWindowId: "change-window-plan-drift",
    hooks: {
      beforeUpdate({ db }) {
        db.prepare("UPDATE job_runs SET started_at = ? WHERE id = 1002").run(
          "2026-06-01 10:06:00",
        );
      },
    },
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("terminal_job_run_repair_plan_drift"),
  );
  assert.equal(result.rollback_checks.verified, true);
  const check = new Database(fixture.databasePath, { readonly: true });
  assert.equal(
    check.prepare("SELECT started_at FROM job_runs WHERE id = 1002").get()
      .started_at,
    "2026-06-01 10:05:00",
  );
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM job_runs WHERE finished_at IS NULL").get()
      .count,
    1,
  );
  check.close();
});

test("APPLY fences and rejects an unrelated commit after preflight", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-fence-race",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const backup = createCanonicalBackupEvidence(fixture);

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
    actorId: "repair-operator",
    changeWindowId: "change-window-fence-race",
    hooks: {
      beforeTransaction() {
        const concurrent = new Database(fixture.databasePath);
        concurrent
          .prepare("UPDATE jobs SET updated_at = ? WHERE id = 101")
          .run("2026-08-08 14:00:01");
        concurrent.close();
      },
    },
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("terminal_job_run_repair_source_drift_at_fence"),
  );
  assert.equal(result.rollback_checks.verified, true);
  const check = new Database(fixture.databasePath, { readonly: true });
  assert.equal(
    check.prepare("SELECT updated_at FROM jobs WHERE id = 101").get().updated_at,
    "2026-08-08 14:00:01",
  );
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM job_runs WHERE finished_at IS NULL").get()
      .count,
    1,
  );
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    0,
  );
  check.close();
});

test("APPLY fence rejects a byte-identical backup file replacement", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-backup-identity-race",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const backup = createCanonicalBackupEvidence(fixture);

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
    actorId: "repair-operator",
    changeWindowId: "change-window-backup-identity-race",
    hooks: {
      beforeTransaction() {
        fs.renameSync(
          backup.evidence.backup_path,
          `${backup.evidence.backup_path}.replaced`,
        );
        fs.copyFileSync(
          backup.evidence.restore_path,
          backup.evidence.backup_path,
        );
      },
    },
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("terminal_job_run_repair_backup_drift_at_fence"),
  );
  const check = new Database(fixture.databasePath, { readonly: true });
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM job_runs WHERE finished_at IS NULL").get()
      .count,
    1,
  );
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    0,
  );
  check.close();
});

test("APPLY fence rejects backup or restore sidecars racing after preflight", async (t) => {
  for (const target of ["backup", "restore"]) {
    await t.test(target, () => {
      const fixture = createFixture(t);
      const plan = planTerminalJobRunRepair({
        databasePath: fixture.databasePath,
        generatedAt: GENERATED_AT,
        repairId: `terminal-runs-${target}-sidecar-fence-race`,
        sourceCommitSha: SOURCE_COMMIT_SHA,
      });
      const evidence = JSON.parse(
        fs.readFileSync(plan.backup_authority.evidence_path, "utf8"),
      );
      const targetPath =
        target === "backup" ? evidence.backup_path : evidence.restore_path;

      const result = applyTerminalJobRunRepair({
        databasePath: fixture.databasePath,
        plan,
        expectedPlanSha256: plan.plan_sha256,
        confirmationRepairId: plan.repair_id,
        backupEvidencePath: plan.backup_authority.evidence_path,
        hooks: {
          beforeTransaction() {
            fs.writeFileSync(`${targetPath}-wal`, "racing sidecar");
          },
        },
      });

      assert.equal(
        result.verdict,
        "HOLD",
        JSON.stringify(result),
      );
      assert.ok(
        result.blockers.includes(
          "terminal_job_run_repair_backup_drift_at_fence",
        ),
      );
      assert.equal(result.rollback_checks.verified, true);
      const check = new Database(fixture.databasePath, { readonly: true });
      assert.equal(
        check
          .prepare(
            "SELECT COUNT(*) AS count FROM job_runs WHERE finished_at IS NULL",
          )
          .get().count,
        1,
      );
      assert.equal(
        check.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get()
          .count,
        0,
      );
      check.close();
    });
  }
});

test("APPLY fence rejects an unsafe SHM inode created by the open connection", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-shm-identity-fence-race",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: plan.backup_authority.evidence_path,
    hooks: {
      beforeTransaction() {
        const shmPath = `${fixture.databasePath}-shm`;
        assert.equal(fs.existsSync(shmPath), true);
        fs.linkSync(shmPath, path.join(fixture.directory, "shm.alias"));
      },
    },
  });

  assert.equal(
    result.verdict,
    "HOLD",
    JSON.stringify(result),
  );
  assert.ok(
    result.blockers.includes(
      "terminal_job_run_repair_source_drift_at_fence",
    ),
  );
  assert.equal(result.rollback_checks.verified, true);
});

test("APPLY rolls every row back when immutable audit insertion fails", (t) => {
  const fixture = createFixture(t, { seedBase: false });
  insertTerminalChain(fixture.databasePath, {
    jobId: 502,
    firstRunId: 6001,
    openCount: 2,
    terminalStatus: "failed",
  });
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-audit-rollback",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const backup = createCanonicalBackupEvidence(fixture);

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
    actorId: "repair-operator",
    changeWindowId: "change-window-audit-rollback",
    hooks: {
      beforeAudit() {
        throw new Error("fixture_audit_insert_failure");
      },
    },
  });

  assert.equal(result.verdict, "ROLLED_BACK_VERIFIED");
  assert.equal(result.rollback_checks.planned_rows_restored, true);
  assert.equal(result.rollback_checks.audit_absent, true);
  const check = new Database(fixture.databasePath, { readonly: true });
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM job_runs WHERE finished_at IS NULL").get()
      .count,
    2,
  );
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    0,
  );
  check.close();
});

test("APPLY retry of the same audited plan is an exact idempotent no-op", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-idempotent",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const backup = createCanonicalBackupEvidence(fixture);
  const request = {
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
    actorId: "repair-operator",
    changeWindowId: "change-window-idempotent",
  };

  const first = applyTerminalJobRunRepair(request);
  const afterFirstHash = sha256File(fixture.databasePath);
  const retry = applyTerminalJobRunRepair(request);

  assert.equal(first.verdict, "APPLIED");
  assert.equal(retry.verdict, "IDEMPOTENT_NOOP");
  assert.deepEqual(retry.mutations_performed, []);
  assert.equal(retry.prior_mutations.length, 1);
  assert.equal(retry.audit_id, first.audit_id);
  assert.equal(retry.safety.production_database_mutated, false);
  assert.equal(retry.post_commit_checks.post_close_sidecars, "clean");
  assert.equal(fs.existsSync(`${fixture.databasePath}-wal`), false);
  assert.equal(fs.existsSync(`${fixture.databasePath}-shm`), false);
  assert.equal(sha256File(fixture.databasePath), afterFirstHash);
  const check = new Database(fixture.databasePath, { readonly: true });
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    1,
  );
  check.close();
});

test("IDEMPOTENT retry remains durable after plan and backup freshness expire", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-idempotent-expired",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const request = {
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: plan.backup_authority.evidence_path,
  };
  const first = applyTerminalJobRunRepair(request);
  assert.equal(first.verdict, "APPLIED");

  const retry = applyTerminalJobRunRepair({
    ...request,
    now: new Date(Date.parse(GENERATED_AT) + 25 * 60 * 60_000).toISOString(),
  });
  assert.equal(retry.verdict, "IDEMPOTENT_NOOP");
});

test("IDEMPOTENT retry rejects unrelated row and schema drift", async (t) => {
  for (const scenario of ["row", "schema"]) {
    await t.test(scenario, () => {
      const fixture = createFixture(t);
      const plan = planTerminalJobRunRepair({
        databasePath: fixture.databasePath,
        generatedAt: GENERATED_AT,
        repairId: `terminal-runs-idempotent-${scenario}-drift`,
        sourceCommitSha: SOURCE_COMMIT_SHA,
      });
      const request = {
        databasePath: fixture.databasePath,
        plan,
        expectedPlanSha256: plan.plan_sha256,
        confirmationRepairId: plan.repair_id,
        backupEvidencePath: plan.backup_authority.evidence_path,
      };
      assert.equal(applyTerminalJobRunRepair(request).verdict, "APPLIED");
      const db = new Database(fixture.databasePath);
      if (scenario === "row") {
        db.prepare("UPDATE jobs SET kind = 'publish' WHERE id = 101").run();
      } else {
        db.exec("CREATE TABLE unrelated_drift (id INTEGER PRIMARY KEY)");
      }
      db.close();

      const retry = applyTerminalJobRunRepair(request);
      assert.equal(retry.verdict, "COMMITTED_HOLD");
      assert.ok(
        retry.blockers.includes(
          "terminal_job_run_repair_idempotent_state_drift",
        ),
      );
    });
  }
});

test("IDEMPOTENT retry detects full-range INTEGER drift without precision loss", (t) => {
  const fixture = createFixture(t);
  const db = new Database(fixture.databasePath);
  db.exec("CREATE TABLE precision_drift (value INTEGER NOT NULL)");
  db.prepare("INSERT INTO precision_drift(value) VALUES (?)").run(
    9_007_199_254_740_992n,
  );
  db.close();
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-idempotent-integer-precision-drift",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const request = {
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: plan.backup_authority.evidence_path,
  };
  assert.equal(applyTerminalJobRunRepair(request).verdict, "APPLIED");

  const mutate = new Database(fixture.databasePath);
  mutate
    .prepare("UPDATE precision_drift SET value = ?")
    .run(9_007_199_254_740_993n);
  mutate.close();

  const retry = applyTerminalJobRunRepair(request);
  assert.equal(retry.verdict, "COMMITTED_HOLD");
  assert.ok(
    retry.blockers.includes(
      "terminal_job_run_repair_idempotent_state_drift",
    ),
  );
});

test("IDEMPOTENT retry binds the otherwise excluded live transition lease", (t) => {
  const fixture = createFixture(t);
  const seed = new Database(fixture.databasePath);
  seed
    .prepare(
      `INSERT INTO runtime_leases
         (name, owner_id, heartbeat_at, expires_at)
       VALUES (?, 'stopped-owner', '2026-06-01T00:00:00.000Z',
               '2026-06-01T00:01:00.000Z')`,
    )
    .run(LIVE_RUNTIME_TRANSITION_LEASE_NAME);
  seed.close();
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-idempotent-transition-lease-drift",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const request = {
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: plan.backup_authority.evidence_path,
  };
  assert.equal(applyTerminalJobRunRepair(request).verdict, "APPLIED");

  const mutate = new Database(fixture.databasePath);
  mutate
    .prepare("UPDATE runtime_leases SET owner_id = ? WHERE name = ?")
    .run("unexpected-owner", LIVE_RUNTIME_TRANSITION_LEASE_NAME);
  mutate.close();

  const retry = applyTerminalJobRunRepair(request);
  assert.equal(retry.verdict, "COMMITTED_HOLD");
  assert.ok(
    retry.blockers.includes(
      "terminal_job_run_repair_idempotent_state_drift",
    ),
  );
});

test("IDEMPOTENT retry requires the complete immutable audit authority", async (t) => {
  const scenarios = [
    {
      label: "actor",
      mutate(db) {
        db.prepare("UPDATE operator_audit_log SET actor_id = 'other'").run();
      },
    },
    {
      label: "reason",
      mutate(db) {
        db.prepare("UPDATE operator_audit_log SET reason = 'other'").run();
      },
    },
    {
      label: "created-at",
      mutate(db) {
        db.prepare(
          "UPDATE operator_audit_log SET created_at = '2026-08-08T14:01:00.000Z'",
        ).run();
      },
    },
    {
      label: "authority-evidence",
      mutate(db) {
        const row = db.prepare(
          "SELECT id, evidence_json FROM operator_audit_log",
        ).get();
        const evidence = JSON.parse(row.evidence_json);
        evidence.operator_id = "other";
        db.prepare(
          "UPDATE operator_audit_log SET evidence_json = ? WHERE id = ?",
        ).run(JSON.stringify(evidence), row.id);
      },
    },
    {
      label: "backup-provenance",
      mutate(db) {
        const row = db.prepare(
          "SELECT id, evidence_json FROM operator_audit_log",
        ).get();
        const evidence = JSON.parse(row.evidence_json);
        evidence.backup.backup_verification.observed_sha256 = "f".repeat(64);
        db.prepare(
          "UPDATE operator_audit_log SET evidence_json = ? WHERE id = ?",
        ).run(JSON.stringify(evidence), row.id);
      },
    },
    {
      label: "backup-identity",
      mutate(db) {
        const row = db.prepare(
          "SELECT id, evidence_json FROM operator_audit_log",
        ).get();
        const evidence = JSON.parse(row.evidence_json);
        evidence.backup.backup_identity.file_id = "tampered";
        db.prepare(
          "UPDATE operator_audit_log SET evidence_json = ? WHERE id = ?",
        ).run(JSON.stringify(evidence), row.id);
      },
    },
    {
      label: "restore-identity",
      mutate(db) {
        const row = db.prepare(
          "SELECT id, evidence_json FROM operator_audit_log",
        ).get();
        const evidence = JSON.parse(row.evidence_json);
        evidence.backup.restore_identity.file_id = "tampered";
        db.prepare(
          "UPDATE operator_audit_log SET evidence_json = ? WHERE id = ?",
        ).run(JSON.stringify(evidence), row.id);
      },
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.label, () => {
      const fixture = createFixture(t);
      const plan = planTerminalJobRunRepair({
        databasePath: fixture.databasePath,
        generatedAt: GENERATED_AT,
        repairId: `terminal-runs-audit-${scenario.label}`,
        sourceCommitSha: SOURCE_COMMIT_SHA,
      });
      const request = {
        databasePath: fixture.databasePath,
        plan,
        expectedPlanSha256: plan.plan_sha256,
        confirmationRepairId: plan.repair_id,
        backupEvidencePath: plan.backup_authority.evidence_path,
      };
      assert.equal(applyTerminalJobRunRepair(request).verdict, "APPLIED");
      const db = new Database(fixture.databasePath);
      try {
        db.exec(`
          DROP TRIGGER trg_operator_audit_log_immutable_update;
          DROP TRIGGER trg_operator_audit_log_immutable_delete;
        `);
        scenario.mutate(db);
      } finally {
        db.close();
      }

      const retry = applyTerminalJobRunRepair(request);
      assert.equal(retry.verdict, "HOLD");
      assert.ok(
        retry.blockers.includes(
          "terminal_job_run_repair_idempotency_conflict",
        ),
      );
    });
  }
});

test("PLAN independently rejects a caller commit claim when executor attestation disagrees", (t) => {
  const fixture = createFixture(t);
  const backup = createCanonicalBackupEvidence(fixture);
  const backupAuthority = backupAuthorityFromEvidence(backup.evidencePath);
  const plan = planTerminalJobRunRepairImpl({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    now: GENERATED_AT,
    repairId: "terminal-runs-executor-claim",
    sourceCommitSha: SOURCE_COMMIT_SHA,
    operatorId: "repair-operator-a",
    changeWindowId: "change-window-executor",
    backupEvidencePath: backup.evidencePath,
    expectedBackupEvidenceSha256: backupAuthority.evidenceSha256,
    expectedBackupVerificationSha256:
      backupAuthority.backupVerificationSha256,
    expectedRestoreRehearsalSha256:
      backupAuthority.restoreRehearsalSha256,
    executorWorkspaceRoot: ROOT,
    executorInspector: () => ({
      available: true,
      commit: "5".repeat(40),
      tracked_clean: true,
    }),
    executorModulePath: path.join(
      ROOT,
      "lib",
      "ops",
      "governed-terminal-job-run-repair.js",
    ),
    executorEntrypointPath: TOOL_PATH,
  });

  assert.equal(plan.verdict, "HOLD");
  assert.ok(
    plan.blockers.includes("terminal_job_run_repair_executor_not_attested"),
  );

  const untrackedCodePlan = planTerminalJobRunRepairImpl({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    now: GENERATED_AT,
    repairId: "terminal-runs-executor-untracked",
    sourceCommitSha: SOURCE_COMMIT_SHA,
    operatorId: "repair-operator-a",
    changeWindowId: "change-window-executor-untracked",
    backupEvidencePath: backup.evidencePath,
    expectedBackupEvidenceSha256: backupAuthority.evidenceSha256,
    expectedBackupVerificationSha256:
      backupAuthority.backupVerificationSha256,
    expectedRestoreRehearsalSha256:
      backupAuthority.restoreRehearsalSha256,
    executorWorkspaceRoot: ROOT,
    executorInspector: () => ({
      available: true,
      commit: SOURCE_COMMIT_SHA,
      root_match: true,
      tracked_clean: true,
      code_tracked_at_head: false,
    }),
    executorModulePath: path.join(
      ROOT,
      "lib",
      "ops",
      "governed-terminal-job-run-repair.js",
    ),
    executorEntrypointPath: TOOL_PATH,
  });
  assert.equal(untrackedCodePlan.verdict, "HOLD");
  assert.ok(
    untrackedCodePlan.blockers.includes(
      "terminal_job_run_repair_executor_not_attested",
    ),
  );
});

test("APPLY cannot substitute operator or change-window authority after PLAN", (t) => {
  const fixture = createFixture(t);
  const backup = createCanonicalBackupEvidence(fixture);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-authority-substitution",
    sourceCommitSha: SOURCE_COMMIT_SHA,
    operatorId: "repair-operator-a",
    changeWindowId: "change-window-a",
    backupEvidencePath: backup.evidencePath,
    expectedBackupEvidenceSha256: sha256File(backup.evidencePath),
  });

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    confirmationOperatorId: "repair-operator-b",
    confirmationChangeWindowId: "change-window-b",
    backupEvidencePath: backup.evidencePath,
    expectedBackupEvidenceSha256: sha256File(backup.evidencePath),
    actorId: "repair-operator-b",
    changeWindowId: "change-window-b",
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "terminal_job_run_repair_operator_confirmation_mismatch",
    ),
  );
  assert.ok(
    result.blockers.includes(
      "terminal_job_run_repair_change_window_confirmation_mismatch",
    ),
  );

  const ambiguous = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    confirmationOperatorId: "repair-operator-a",
    confirmationChangeWindowId: "change-window-a",
    backupEvidencePath: backup.evidencePath,
    actorId: "repair-operator-b",
    changeWindowId: "change-window-b",
    forwardLegacyAuthority: true,
  });
  assert.equal(ambiguous.verdict, "HOLD");
  assert.ok(
    ambiguous.blockers.includes(
      "terminal_job_run_repair_operator_authority_ambiguous",
    ),
  );
  assert.ok(
    ambiguous.blockers.includes(
      "terminal_job_run_repair_change_window_authority_ambiguous",
    ),
  );
});

test("APPLY requires the exact operator-confirmed backup evidence SHA bound by PLAN", (t) => {
  const fixture = createFixture(t);
  const backup = createCanonicalBackupEvidence(fixture);
  const evidenceSha256 = sha256File(backup.evidencePath);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-backup-confirmation",
    sourceCommitSha: SOURCE_COMMIT_SHA,
    operatorId: "repair-operator",
    changeWindowId: "change-window-backup-confirmation",
    backupEvidencePath: backup.evidencePath,
    expectedBackupEvidenceSha256: evidenceSha256,
  });

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    confirmationOperatorId: "repair-operator",
    confirmationChangeWindowId: "change-window-backup-confirmation",
    backupEvidencePath: backup.evidencePath,
    expectedBackupEvidenceSha256: "f".repeat(64),
    actorId: "repair-operator",
    changeWindowId: "change-window-backup-confirmation",
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "terminal_job_run_repair_backup_evidence_confirmation_mismatch",
    ),
  );
});

test("APPLY rejects canonical-looking backup evidence backed by dummy provenance", (t) => {
  const fixture = createFixture(t);
  const backup = createCanonicalBackupEvidence(fixture);
  fs.writeFileSync(
    backup.evidence.provenance.backup_verification_file,
    "{}\n",
  );
  fs.writeFileSync(
    backup.evidence.provenance.restore_rehearsal_file,
    "{}\n",
  );
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-dummy-provenance",
    sourceCommitSha: SOURCE_COMMIT_SHA,
    operatorId: "repair-operator",
    changeWindowId: "change-window-dummy-provenance",
    backupEvidencePath: backup.evidencePath,
    expectedBackupEvidenceSha256: sha256File(backup.evidencePath),
  });

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    confirmationOperatorId: "repair-operator",
    confirmationChangeWindowId: "change-window-dummy-provenance",
    backupEvidencePath: backup.evidencePath,
    expectedBackupEvidenceSha256: sha256File(backup.evidencePath),
    actorId: "repair-operator",
    changeWindowId: "change-window-dummy-provenance",
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "terminal_job_run_repair_backup_provenance_invalid",
    ),
  );
});

test("PLAN rejects current evidence wrapped around stale backup provenance", (t) => {
  const fixture = createFixture(t);
  const backup = createCanonicalBackupEvidence(fixture);
  const evidence = JSON.parse(fs.readFileSync(backup.evidencePath, "utf8"));
  const evidenceTime = Date.parse(evidence.verified_at);
  const backupProofPath = evidence.provenance.backup_verification_file;
  const restoreProofPath = evidence.provenance.restore_rehearsal_file;
  const backupProof = JSON.parse(fs.readFileSync(backupProofPath, "utf8"));
  backupProof.createdAt = new Date(
    evidenceTime - 26 * 60 * 60_000,
  ).toISOString();
  backupProof.verifiedAt = new Date(
    evidenceTime - 25.5 * 60 * 60_000,
  ).toISOString();
  fs.writeFileSync(backupProofPath, `${JSON.stringify(backupProof, null, 2)}\n`);
  const restoreProof = JSON.parse(fs.readFileSync(restoreProofPath, "utf8"));
  restoreProof.generated_at = new Date(
    evidenceTime - 25 * 60 * 60_000,
  ).toISOString();
  restoreProof.source_backup_verified_at = backupProof.verifiedAt;
  restoreProof.source_backup_verification_sha256 =
    sha256File(backupProofPath);
  fs.writeFileSync(
    restoreProofPath,
    `${JSON.stringify(restoreProof, null, 2)}\n`,
  );
  evidence.provenance.backup_verified_at = backupProof.verifiedAt;
  evidence.provenance.restore_verified_at = restoreProof.generated_at;
  fs.writeFileSync(backup.evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-stale-backup-provenance",
    sourceCommitSha: SOURCE_COMMIT_SHA,
    backupEvidencePath: backup.evidencePath,
  });

  assert.equal(plan.verdict, "HOLD");
  assert.ok(
    plan.blockers.includes(
      "terminal_job_run_repair_backup_provenance_invalid",
    ),
  );
});

test("IDEMPOTENT retry rejects a copied replacement database inode", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-idempotent-replacement",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const backup = createCanonicalBackupEvidence(fixture);
  const request = {
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
    actorId: "repair-operator",
    changeWindowId: "change-window-idempotent-replacement",
  };
  const first = applyTerminalJobRunRepair(request);
  assert.equal(first.verdict, "APPLIED");

  const replacementPath = path.join(fixture.directory, "replacement.db");
  const displacedPath = path.join(fixture.directory, "displaced.db");
  fs.copyFileSync(fixture.databasePath, replacementPath);
  fs.renameSync(fixture.databasePath, displacedPath);
  fs.renameSync(replacementPath, fixture.databasePath);

  const retry = applyTerminalJobRunRepair(request);
  assert.equal(retry.verdict, "HOLD");
  assert.ok(
    retry.blockers.includes(
      "terminal_job_run_repair_idempotent_opened_database_identity_drift",
    ),
  );
});

test("IDEMPOTENT retry rejects replacement between identity capture and database open", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-idempotent-open-race",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const request = {
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: plan.backup_authority.evidence_path,
  };
  assert.equal(applyTerminalJobRunRepair(request).verdict, "APPLIED");

  const displacedPath = path.join(fixture.directory, "open-race-displaced.db");
  const retry = applyTerminalJobRunRepair({
    ...request,
    hooks: {
      beforeDatabaseOpen() {
        fs.renameSync(fixture.databasePath, displacedPath);
        fs.copyFileSync(displacedPath, fixture.databasePath);
      },
    },
  });

  assert.equal(retry.verdict, "HOLD");
  assert.ok(
    retry.blockers.includes(
      "terminal_job_run_repair_idempotent_opened_database_identity_drift",
    ),
  );
});

test("IDEMPOTENT retry rejects a commit after audit and remainder inspection", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-idempotent-post-inspection-race",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const request = {
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: plan.backup_authority.evidence_path,
  };
  assert.equal(applyTerminalJobRunRepair(request).verdict, "APPLIED");

  const retry = applyTerminalJobRunRepair({
    ...request,
    hooks: {
      afterExistingRepairInspection({ existing }) {
        assert.equal(existing.outcome, "IDEMPOTENT");
        const concurrent = new Database(fixture.databasePath);
        concurrent
          .prepare("UPDATE jobs SET kind = 'concurrent-drift' WHERE id = 101")
          .run();
        concurrent.close();
      },
    },
  });

  assert.equal(retry.verdict, "COMMITTED_HOLD");
  assert.ok(
    retry.blockers.includes(
      "terminal_job_run_repair_idempotent_state_drift",
    ),
  );
  assert.deepEqual(retry.committed_state, {
    previously_committed: true,
    this_invocation_mutated: false,
  });
  assert.equal(retry.audit_id, 1);
  assert.equal(retry.prior_mutations.length, 1);
});

test("IDEMPOTENT retry rejects drift committed after its final exact inspection", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-idempotent-final-inspection-race",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const request = {
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: plan.backup_authority.evidence_path,
  };
  assert.equal(applyTerminalJobRunRepair(request).verdict, "APPLIED");

  const retry = applyTerminalJobRunRepair({
    ...request,
    hooks: {
      afterReplayFinalInspection({ existing }) {
        assert.equal(existing.outcome, "IDEMPOTENT");
        const concurrent = new Database(fixture.databasePath);
        concurrent
          .prepare("UPDATE jobs SET kind = 'late-replay-drift' WHERE id = 101")
          .run();
        concurrent.close();
      },
    },
  });

  assert.equal(retry.verdict, "COMMITTED_HOLD");
  assert.ok(
    retry.blockers.includes("terminal_job_run_repair_idempotent_state_drift"),
    JSON.stringify(retry),
  );
  assert.deepEqual(retry.committed_state, {
    previously_committed: true,
    this_invocation_mutated: false,
  });
});

test("IDEMPOTENT retry re-attests executor authority immediately before success", (t) => {
  const fixture = createFixture(t);
  let executorClean = true;
  const executorInspector = ({ expectedCommit }) => ({
    available: true,
    commit: expectedCommit,
    root_match: true,
    tracked_clean: executorClean,
    code_tracked_at_head: true,
  });
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-idempotent-executor-race",
    sourceCommitSha: SOURCE_COMMIT_SHA,
    executorInspector,
  });
  const request = {
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: plan.backup_authority.evidence_path,
    executorInspector,
  };
  assert.equal(applyTerminalJobRunRepair(request).verdict, "APPLIED");

  const retry = applyTerminalJobRunRepair({
    ...request,
    hooks: {
      afterExistingRepairInspection({ existing }) {
        assert.equal(existing.outcome, "IDEMPOTENT");
        executorClean = false;
      },
    },
  });

  assert.equal(retry.verdict, "COMMITTED_HOLD");
  assert.ok(
    retry.blockers.includes(
      "terminal_job_run_repair_idempotent_executor_drift",
    ),
  );
});

test("APPLY holds on an existing repair ID bound to a different plan", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-idempotency-conflict",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const backup = createCanonicalBackupEvidence(fixture);
  const db = new Database(fixture.databasePath);
  db.prepare(
    `INSERT INTO operator_audit_log
       (actor_id, action, target_type, target_id, decision, reason,
        evidence_json, created_at, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "other-operator",
    "governed_terminal_job_run_repair",
    "sqlite_database",
    plan.repair_id,
    "APPLIED",
    "different reviewed repair",
    JSON.stringify({ plan_sha256: "a".repeat(64) }),
    GENERATED_AT,
    `governed-terminal-job-run-repair:${plan.repair_id}`,
  );
  db.close();
  const beforeHash = sha256File(fixture.databasePath);

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
    actorId: "repair-operator",
    changeWindowId: "change-window-conflict",
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("terminal_job_run_repair_idempotency_conflict"),
  );
  assert.equal(result.existing_audit_id, 1);
  assert.equal(sha256File(fixture.databasePath), beforeHash);
  const check = new Database(fixture.databasePath, { readonly: true });
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM job_runs WHERE finished_at IS NULL").get()
      .count,
    1,
  );
  check.close();
});

test("APPLY reports committed-HOLD when post-commit evidence cannot be completed", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-committed-hold",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const backup = createCanonicalBackupEvidence(fixture);
  const request = {
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: backup.evidencePath,
    actorId: "repair-operator",
    changeWindowId: "change-window-committed-hold",
  };

  const result = applyTerminalJobRunRepair({
    ...request,
    hooks: {
      afterCommit() {
        throw new Error("fixture_post_commit_evidence_failure");
      },
    },
  });

  assert.equal(result.verdict, "COMMITTED_HOLD");
  assert.ok(
    result.blockers.includes(
      "terminal_job_run_repair_post_commit_verification_required",
    ),
  );
  assert.equal(result.safety.production_database_mutated, true);
  assert.equal(result.mutations_performed.length, 1);
  assert.equal(result.audit_id, 1);
  assert.equal(
    result.post_commit_checks?.post_close_sidecars,
    "clean",
    JSON.stringify(result),
  );

  const recovery = applyTerminalJobRunRepair(request);
  assert.equal(
    recovery.verdict,
    "IDEMPOTENT_NOOP",
    JSON.stringify(recovery),
  );

  const check = new Database(fixture.databasePath, { readonly: true });
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM job_runs WHERE finished_at IS NULL").get()
      .count,
    0,
  );
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    1,
  );
  check.close();
});

test("APPLY reports committed-HOLD when executor authority drifts after commit", (t) => {
  const fixture = createFixture(t);
  let executorClean = true;
  const executorInspector = ({ expectedCommit }) => ({
    available: true,
    commit: expectedCommit,
    root_match: true,
    tracked_clean: executorClean,
    code_tracked_at_head: true,
  });
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-post-commit-executor-drift",
    sourceCommitSha: SOURCE_COMMIT_SHA,
    executorInspector,
  });

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: plan.backup_authority.evidence_path,
    executorInspector,
    hooks: {
      afterCommit() {
        executorClean = false;
      },
    },
  });

  assert.equal(result.verdict, "COMMITTED_HOLD");
  assert.ok(
    result.blockers.includes(
      "terminal_job_run_repair_post_commit_executor_drift",
    ),
  );
  assert.equal(result.safety.production_database_mutated, true);
});

test("APPLY rejects drift committed after its WAL checkpoint", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-post-checkpoint-race",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: plan.backup_authority.evidence_path,
    hooks: {
      afterPostCommitCheckpoint() {
        const concurrent = new Database(fixture.databasePath);
        concurrent
          .prepare("UPDATE jobs SET kind = 'late-apply-drift' WHERE id = 101")
          .run();
        concurrent.close();
      },
    },
  });

  assert.equal(result.verdict, "COMMITTED_HOLD");
  assert.ok(
    result.blockers.includes(
      "terminal_job_run_repair_post_commit_evidence_incomplete",
    ),
    JSON.stringify(result),
  );
  assert.equal(result.safety.production_database_mutated, true);
});

test("APPLY rejects an unrelated NULL-key audit committed after its WAL checkpoint", (t) => {
  const fixture = createFixture(t);
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
    repairId: "terminal-runs-post-checkpoint-null-audit",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });

  const result = applyTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    plan,
    expectedPlanSha256: plan.plan_sha256,
    confirmationRepairId: plan.repair_id,
    backupEvidencePath: plan.backup_authority.evidence_path,
    hooks: {
      afterPostCommitCheckpoint() {
        const concurrent = new Database(fixture.databasePath);
        concurrent
          .prepare(
            `INSERT INTO operator_audit_log
               (actor_id, action, created_at, idempotency_key)
             VALUES ('unrelated-operator', 'unrelated_audit', ?, NULL)`,
          )
          .run(GENERATED_AT);
        concurrent.close();
      },
    },
  });

  assert.equal(result.verdict, "COMMITTED_HOLD");
  assert.ok(
    result.blockers.includes(
      "terminal_job_run_repair_post_commit_evidence_incomplete",
    ),
    JSON.stringify(result),
  );
  assert.equal(result.safety.production_database_mutated, true);
});

test("CLI defaults to an immutable read-only PLAN with JSON and Markdown evidence", (t) => {
  const fixture = createFixture(t);
  const outDir = path.join(fixture.directory, "plan-proof");
  const cliGeneratedAt = new Date().toISOString();
  createCanonicalBackupEvidence(fixture, {
    referenceTime: cliGeneratedAt,
  });
  const backup = backupAuthorityFromEvidence(
    path.join(fixture.directory, "backup.evidence.json"),
  );
  const beforeHash = sha256File(fixture.databasePath);

  const completed = runTool([
    "--database",
    fixture.databasePath,
    "--repair-id",
    "terminal-runs-cli-plan",
    "--source-commit-sha",
    SOURCE_COMMIT_SHA,
    ...cliPlanAuthorityArgs(backup, "change-window-cli-plan"),
    "--generated-at",
    cliGeneratedAt,
    "--out-dir",
    outDir,
  ]);

  assert.equal(completed.status, 0, completed.stderr);
  const summary = JSON.parse(completed.stdout);
  assert.equal(summary.mode, "PLAN");
  assert.equal(summary.verdict, "READY_TO_APPLY");
  const planPath = path.join(
    outDir,
    "governed_terminal_job_run_repair_plan.json",
  );
  const markdownPath = path.join(
    outDir,
    "governed_terminal_job_run_repair_plan.md",
  );
  assert.equal(fs.existsSync(planPath), true);
  assert.equal(fs.existsSync(markdownPath), true);
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  assert.equal(plan.plan_sha256, summary.plan_sha256);
  assert.equal(plan.database.read_only_inspection, true);
  assert.equal(sha256File(fixture.databasePath), beforeHash);
});

test("CLI APPLY without matching confirmation emits HOLD and performs no mutation", (t) => {
  const fixture = createFixture(t);
  const outDir = path.join(fixture.directory, "apply-hold-proof");
  const cliGeneratedAt = new Date().toISOString();
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: cliGeneratedAt,
    repairId: "terminal-runs-cli-hold",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const planPath = path.join(fixture.directory, "reviewed-plan.json");
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const beforeHash = sha256File(fixture.databasePath);

  const completed = runTool([
    "--apply",
    "--database",
    fixture.databasePath,
    "--plan",
    planPath,
    "--expected-plan-sha256",
    plan.plan_sha256,
    ...cliApplyAuthorityArgs(plan),
    "--out-dir",
    outDir,
  ]);

  assert.equal(completed.status, 2, completed.stderr);
  const summary = JSON.parse(completed.stdout);
  assert.equal(summary.verdict, "HOLD");
  assert.ok(
    summary.blockers.includes(
      "terminal_job_run_repair_matching_confirmation_required",
    ),
  );
  assert.equal(sha256File(fixture.databasePath), beforeHash);
  const result = JSON.parse(
    fs.readFileSync(
      path.join(outDir, "governed_terminal_job_run_repair_result.json"),
      "utf8",
    ),
  );
  assert.equal(result.verdict, "HOLD");
});

test("CLI preflights immutable result paths before any APPLY mutation", (t) => {
  const fixture = createFixture(t);
  const outDir = path.join(fixture.directory, "apply-collision-proof");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "governed_terminal_job_run_repair_result.json"),
    "existing immutable evidence\n",
  );
  const cliGeneratedAt = new Date().toISOString();
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: cliGeneratedAt,
    repairId: "terminal-runs-cli-collision",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const planPath = path.join(fixture.directory, "reviewed-plan.json");
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const beforeHash = sha256File(fixture.databasePath);

  const completed = runTool([
    "--apply",
    "--database",
    fixture.databasePath,
    "--plan",
    planPath,
    "--expected-plan-sha256",
    plan.plan_sha256,
    "--confirm-repair-id",
    plan.repair_id,
    ...cliApplyAuthorityArgs(plan),
    "--out-dir",
    outDir,
  ]);

  assert.equal(completed.status, 1);
  assert.match(completed.stderr, /artifact_already_exists/);
  assert.equal(sha256File(fixture.databasePath), beforeHash);
  const check = new Database(fixture.databasePath, { readonly: true });
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM job_runs WHERE finished_at IS NULL").get()
      .count,
    1,
  );
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    0,
  );
  check.close();
});

test("CLI persists committed-HOLD when the second evidence write fails", (t) => {
  const fixture = createFixture(t);
  const outDir = path.join(fixture.directory, "apply-artifact-fault-proof");
  const cliGeneratedAt = new Date().toISOString();
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: cliGeneratedAt,
    repairId: "terminal-runs-cli-artifact-fault",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const planPath = path.join(fixture.directory, "reviewed-plan.json");
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

  const completed = runTool(
    [
      "--apply",
      "--database",
      fixture.databasePath,
      "--plan",
      planPath,
      "--expected-plan-sha256",
      plan.plan_sha256,
      "--confirm-repair-id",
      plan.repair_id,
      ...cliApplyAuthorityArgs(plan),
      "--out-dir",
      outDir,
    ],
    {
      NODE_ENV: "test",
      PULSE_TERMINAL_REPAIR_TEST_ARTIFACT_FAILURE: "before-json-publish",
    },
  );

  assert.equal(completed.status, 2, completed.stderr);
  const summary = JSON.parse(completed.stdout);
  assert.equal(summary.verdict, "COMMITTED_HOLD");
  assert.ok(
    summary.blockers.includes(
      "terminal_job_run_repair_result_artifact_incomplete",
    ),
  );
  assert.equal(
    fs.existsSync(
      path.join(
        outDir,
        "governed_terminal_job_run_repair_committed_hold.json",
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(outDir, "governed_terminal_job_run_repair_result.json"),
    ),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(outDir, "governed_terminal_job_run_repair_result.md"),
    ),
    false,
  );
  const check = new Database(fixture.databasePath, { readonly: true });
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM job_runs WHERE finished_at IS NULL").get()
      .count,
    0,
  );
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    1,
  );
  check.close();
});

test("CLI preserves committed-state evidence when replay artifact publication fails", (t) => {
  const fixture = createFixture(t);
  const firstOutDir = path.join(fixture.directory, "first-artifact-fault");
  const replayOutDir = path.join(fixture.directory, "replay-artifact-fault");
  const cliGeneratedAt = new Date().toISOString();
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: cliGeneratedAt,
    repairId: "terminal-runs-cli-replay-artifact-fault",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const planPath = path.join(fixture.directory, "reviewed-plan.json");
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const args = (outDir) => [
    "--apply",
    "--database",
    fixture.databasePath,
    "--plan",
    planPath,
    "--expected-plan-sha256",
    plan.plan_sha256,
    "--confirm-repair-id",
    plan.repair_id,
    ...cliApplyAuthorityArgs(plan),
    "--out-dir",
    outDir,
  ];
  const fault = {
    NODE_ENV: "test",
    PULSE_TERMINAL_REPAIR_TEST_ARTIFACT_FAILURE: "before-json-publish",
  };
  const first = runTool(args(firstOutDir), fault);
  assert.equal(first.status, 2, first.stderr);
  assert.equal(JSON.parse(first.stdout).verdict, "COMMITTED_HOLD");

  const replay = runTool(args(replayOutDir), fault);
  assert.equal(replay.status, 2, replay.stderr);
  const summary = JSON.parse(replay.stdout);
  assert.equal(summary.verdict, "COMMITTED_HOLD");
  const emergencyPath = path.join(
    replayOutDir,
    "governed_terminal_job_run_repair_committed_hold.json",
  );
  assert.equal(fs.existsSync(emergencyPath), true);
  assert.equal(
    fs.existsSync(
      path.join(
        replayOutDir,
        "governed_terminal_job_run_repair_result.json",
      ),
    ),
    false,
  );
  const emergency = JSON.parse(fs.readFileSync(emergencyPath, "utf8"));
  assert.equal(emergency.safety.production_database_mutated, false);
  assert.deepEqual(emergency.committed_state, {
    previously_committed: true,
    this_invocation_mutated: false,
  });
  assert.equal(emergency.audit_id, 1);
  assert.equal(emergency.prior_mutations.length, 1);
});

test("CLI never overwrites an artifact target racing after preflight", (t) => {
  const fixture = createFixture(t);
  const outDir = path.join(fixture.directory, "apply-artifact-race");
  const cliGeneratedAt = new Date().toISOString();
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: cliGeneratedAt,
    repairId: "terminal-runs-cli-artifact-race",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const planPath = path.join(fixture.directory, "reviewed-plan.json");
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

  const completed = runTool(
    [
      "--apply",
      "--database",
      fixture.databasePath,
      "--plan",
      planPath,
      "--expected-plan-sha256",
      plan.plan_sha256,
      "--confirm-repair-id",
      plan.repair_id,
      ...cliApplyAuthorityArgs(plan),
      "--out-dir",
      outDir,
    ],
    {
      NODE_ENV: "test",
      PULSE_TERMINAL_REPAIR_TEST_ARTIFACT_RACE: "markdown",
    },
  );

  assert.equal(completed.status, 2, completed.stderr);
  assert.equal(JSON.parse(completed.stdout).verdict, "COMMITTED_HOLD");
  assert.equal(
    fs.readFileSync(
      path.join(outDir, "governed_terminal_job_run_repair_result.md"),
      "utf8",
    ),
    "racing immutable evidence\n",
  );
  assert.equal(
    fs.existsSync(
      path.join(outDir, "governed_terminal_job_run_repair_result.json"),
    ),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        outDir,
        "governed_terminal_job_run_repair_committed_hold.json",
      ),
    ),
    true,
  );
});

test("CLI rejects a staged artifact inode that gains an unexpected hard link", (t) => {
  const fixture = createFixture(t);
  const outDir = path.join(fixture.directory, "apply-artifact-stage-alias");
  const cliGeneratedAt = new Date().toISOString();
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: cliGeneratedAt,
    repairId: "terminal-runs-cli-artifact-stage-alias",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const planPath = path.join(fixture.directory, "reviewed-plan.json");
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

  const completed = runTool(
    [
      "--apply",
      "--database",
      fixture.databasePath,
      "--plan",
      planPath,
      "--expected-plan-sha256",
      plan.plan_sha256,
      "--confirm-repair-id",
      plan.repair_id,
      ...cliApplyAuthorityArgs(plan),
      "--out-dir",
      outDir,
    ],
    {
      NODE_ENV: "test",
      PULSE_TERMINAL_REPAIR_TEST_STAGE_ALIAS: "markdown",
    },
  );

  assert.equal(completed.status, 2, completed.stderr);
  assert.equal(JSON.parse(completed.stdout).verdict, "COMMITTED_HOLD");
  assert.equal(
    fs.existsSync(
      path.join(outDir, "governed_terminal_job_run_repair_result.json"),
    ),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(outDir, "governed_terminal_job_run_repair_result.md"),
    ),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        outDir,
        "governed_terminal_job_run_repair_committed_hold.json",
      ),
    ),
    true,
  );
});

test("CLI never deletes a foreign Markdown replacement during artifact cleanup", (t) => {
  const fixture = createFixture(t);
  const outDir = path.join(fixture.directory, "apply-artifact-replacement");
  const cliGeneratedAt = new Date().toISOString();
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: cliGeneratedAt,
    repairId: "terminal-runs-cli-artifact-replacement",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const planPath = path.join(fixture.directory, "reviewed-plan.json");
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

  const completed = runTool(
    [
      "--apply",
      "--database",
      fixture.databasePath,
      "--plan",
      planPath,
      "--expected-plan-sha256",
      plan.plan_sha256,
      "--confirm-repair-id",
      plan.repair_id,
      ...cliApplyAuthorityArgs(plan),
      "--out-dir",
      outDir,
    ],
    {
      NODE_ENV: "test",
      PULSE_TERMINAL_REPAIR_TEST_ARTIFACT_REPLACEMENT: "markdown",
    },
  );

  assert.equal(completed.status, 2, completed.stderr);
  assert.equal(JSON.parse(completed.stdout).verdict, "COMMITTED_HOLD");
  const markdownPath = path.join(
    outDir,
    "governed_terminal_job_run_repair_result.md",
  );
  assert.equal(fs.existsSync(markdownPath), true);
  assert.equal(
    fs.readFileSync(markdownPath, "utf8"),
    "foreign racing evidence\n",
  );
  assert.equal(
    fs.existsSync(
      path.join(outDir, "governed_terminal_job_run_repair_result.json"),
    ),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        outDir,
        "governed_terminal_job_run_repair_committed_hold.json",
      ),
    ),
    true,
  );
});

for (const [label, environmentVariable] of [
  [
    "while validating a newly staged artifact",
    "PULSE_TERMINAL_REPAIR_TEST_STAGE_PATH_REPLACEMENT",
  ],
  [
    "after linking a staged artifact",
    "PULSE_TERMINAL_REPAIR_TEST_LINKED_STAGE_REPLACEMENT",
  ],
]) {
  test(`CLI preserves a foreign pending-file replacement ${label}`, (t) => {
    const fixture = createFixture(t);
    const outDir = path.join(
      fixture.directory,
      `apply-pending-replacement-${environmentVariable.toLowerCase()}`,
    );
    const cliGeneratedAt = new Date().toISOString();
    const plan = planTerminalJobRunRepair({
      databasePath: fixture.databasePath,
      generatedAt: cliGeneratedAt,
      repairId: `terminal-runs-${environmentVariable.toLowerCase()}`,
      sourceCommitSha: SOURCE_COMMIT_SHA,
    });
    const planPath = path.join(fixture.directory, "reviewed-plan.json");
    fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

    const completed = runTool(
      [
        "--apply",
        "--database",
        fixture.databasePath,
        "--plan",
        planPath,
        "--expected-plan-sha256",
        plan.plan_sha256,
        "--confirm-repair-id",
        plan.repair_id,
        ...cliApplyAuthorityArgs(plan),
        "--out-dir",
        outDir,
      ],
      {
        NODE_ENV: "test",
        [environmentVariable]: "md",
      },
    );

    assert.equal(completed.status, 2, completed.stderr);
    assert.equal(JSON.parse(completed.stdout).verdict, "COMMITTED_HOLD");
    const pending = fs
      .readdirSync(outDir)
      .filter((entry) => entry.endsWith(".pending"));
    assert.equal(pending.length, 1, JSON.stringify(fs.readdirSync(outDir)));
    assert.equal(
      fs.readFileSync(path.join(outDir, pending[0]), "utf8"),
      "foreign pending evidence\n",
    );
    assert.equal(
      fs.existsSync(
        path.join(outDir, "governed_terminal_job_run_repair_result.json"),
      ),
      false,
    );
    assert.equal(
      fs.existsSync(
        path.join(
          outDir,
          "governed_terminal_job_run_repair_committed_hold.json",
        ),
      ),
      true,
    );
  });
}

test("CLI APPLY executes only the exact reviewed and confirmed plan", (t) => {
  const fixture = createFixture(t);
  const outDir = path.join(fixture.directory, "apply-proof");
  const cliGeneratedAt = new Date().toISOString();
  const plan = planTerminalJobRunRepair({
    databasePath: fixture.databasePath,
    generatedAt: cliGeneratedAt,
    repairId: "terminal-runs-cli-apply",
    sourceCommitSha: SOURCE_COMMIT_SHA,
  });
  const planPath = path.join(fixture.directory, "reviewed-plan.json");
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

  const completed = runTool([
    "--apply",
    "--database",
    fixture.databasePath,
    "--plan",
    planPath,
    "--expected-plan-sha256",
    plan.plan_sha256,
    "--confirm-repair-id",
    plan.repair_id,
    ...cliApplyAuthorityArgs(plan),
    "--out-dir",
    outDir,
  ]);

  assert.equal(completed.status, 0, completed.stderr);
  const summary = JSON.parse(completed.stdout);
  assert.equal(summary.mode, "APPLY");
  assert.equal(summary.verdict, "APPLIED");
  const check = new Database(fixture.databasePath, { readonly: true });
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM job_runs WHERE finished_at IS NULL").get()
      .count,
    0,
  );
  assert.equal(
    check.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    1,
  );
  check.close();
});

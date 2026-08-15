"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { runMigrations } = require("../../lib/migrate");
const {
  WORKER_CONTAINMENT_CONFIRMATION,
  executeGovernedWorkerContainment,
} = require("../../lib/ops/governed-worker-containment");

const NOW = "2026-07-27T16:30:00.000Z";

function migrationEnv() {
  return {
    NODE_ENV: "production",
    PULSE_OPERATING_MODE: "HUMAN_REVIEW",
    PULSE_MIGRATION_020_APPROVED: "true",
    PULSE_MIGRATION_020_APPROVAL_ID: "test-migration-020",
    PULSE_MIGRATION_020_APPROVED_BY: "test-operator",
    PULSE_MIGRATION_020_BACKUP_ID: "test-backup",
    PULSE_MIGRATION_020_BACKUP_SHA256: "a".repeat(64),
    PULSE_MIGRATION_020_BACKUP_VERIFIED_AT: "2026-07-27T16:00:00.000Z",
    PULSE_MIGRATION_024_APPROVED: "true",
    PULSE_MIGRATION_024_APPROVAL_ID: "test-migration-024",
    PULSE_MIGRATION_024_APPROVED_BY: "test-operator",
    PULSE_MIGRATION_024_BACKUP_ID: "test-backup-024",
    PULSE_MIGRATION_024_BACKUP_SHA256: "b".repeat(64),
    PULSE_MIGRATION_024_BACKUP_VERIFIED_AT: "2026-07-27T16:15:00.000Z",
    PULSE_MIGRATION_025_APPROVED: "true",
    PULSE_MIGRATION_025_APPROVAL_ID: "test-migration-025",
    PULSE_MIGRATION_025_APPROVED_BY: "test-operator",
    PULSE_MIGRATION_025_BACKUP_ID: "test-backup-025",
    PULSE_MIGRATION_025_BACKUP_SHA256: "c".repeat(64),
    PULSE_MIGRATION_025_BACKUP_VERIFIED_AT: "2026-07-27T16:20:00.000Z",
  };
}

function createFixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-worker-containment-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "pulse.db");
  const db = new Database(databasePath);
  runMigrations(db, {
    env: migrationEnv(),
    now: new Date(NOW),
    log() {},
  });
  db.prepare(
    `INSERT INTO workers
       (id, display_name, status, last_job_id, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("worker-idle", "Idle worker", "idle", 41, NOW);
  db.prepare(
    `INSERT INTO workers
       (id, display_name, status, last_job_id, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("worker-locked", "Locked worker", "locked", 42, NOW);
  db.close();
  return { root, databasePath };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createBackupEvidence(fixture, suffix = "one") {
  const backupPath = path.join(
    fixture.root,
    `pulse-${suffix}.backup.db`,
  );
  const restorePath = path.join(
    fixture.root,
    `pulse-${suffix}.restored.db`,
  );
  fs.copyFileSync(fixture.databasePath, backupPath);
  fs.copyFileSync(backupPath, restorePath);
  const evidencePath = path.join(
    fixture.root,
    `backup-${suffix}.json`,
  );
  fs.writeFileSync(
    evidencePath,
    `${JSON.stringify(
      {
        schema_version: "pulse-cutover-backup-evidence-v1",
        backup_id: `backup-${suffix}`,
        backup_path: path.basename(backupPath),
        backup_sha256: sha256(fs.readFileSync(backupPath)),
        source_database_path: fixture.databasePath,
        source_database_sha256: sha256(
          fs.readFileSync(fixture.databasePath),
        ),
        verified_at: "2026-07-27T16:25:00.000Z",
        verified_by: "backup-verifier",
        restore_test_status: "PASS",
        integrity_check: "ok",
        foreign_key_check: "ok",
        quick_check: "ok",
        restore_path: path.basename(restorePath),
        restore_sha256: sha256(fs.readFileSync(restorePath)),
        backup_restore_hashes_match: true,
        production_database_mutated: false,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return evidencePath;
}

function validApplyOptions(fixture, patch = {}) {
  const reason = "Contain stopped workers for the guarded YouTube cutover";
  return {
    apply: true,
    databasePath: fixture.databasePath,
    confirmDatabasePath: fixture.databasePath,
    backupEvidencePath: createBackupEvidence(fixture),
    generatedAt: NOW,
    now: () => new Date(NOW),
    actorId: "operator:MORR",
    confirmActorId: "operator:MORR",
    reason,
    confirmReason: reason,
    changeWindowId: "pulse-youtube-cutover-2026-07-27",
    confirmChangeWindowId: "pulse-youtube-cutover-2026-07-27",
    confirmSchedulerStopped: true,
    confirmWorkersStopped: true,
    confirmWorkerContainment: WORKER_CONTAINMENT_CONFIRMATION,
    env: {
      PULSE_OPERATING_MODE: "HUMAN_REVIEW",
      AUTO_PUBLISH: "false",
      PULSE_EMERGENCY_KILL_SWITCH: "true",
      PULSE_KILL_SWITCH: "true",
      PULSE_CUTOVER_SCHEDULER_STOPPED: "true",
      PULSE_CUTOVER_WORKERS_STOPPED: "true",
      SQLITE_DB_PATH: fixture.databasePath,
    },
    ...patch,
  };
}

test("inspect is the default and reports the exact containment target without mutating it", async (t) => {
  const fixture = createFixture(t);
  const beforeDb = new Database(fixture.databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  const auditCountBefore = beforeDb
    .prepare("SELECT COUNT(*) AS count FROM operator_audit_log")
    .get().count;
  beforeDb.close();

  const result = await executeGovernedWorkerContainment({
    databasePath: fixture.databasePath,
    generatedAt: NOW,
    now: () => new Date(NOW),
  });

  assert.equal(result.mode, "INSPECT");
  assert.equal(result.verdict, "INSPECTED");
  assert.equal(result.mutated, false);
  assert.deepEqual(result.inspection.target_worker_ids, ["worker-idle"]);
  assert.deepEqual(result.inspection.preserved_locked_worker_ids, [
    "worker-locked",
  ]);
  assert.deepEqual(result.safety.external_calls, []);
  assert.equal(result.safety.oauth_or_tokens_mutated, false);
  assert.equal(result.safety.platform_objects_created, false);

  const db = new Database(fixture.databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  assert.equal(
    db.prepare("SELECT status FROM workers WHERE id = ?").get("worker-idle")
      .status,
    "idle",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    auditCountBefore,
  );
  db.close();
});

test("apply fails closed when the operator, runtime and backup confirmations are absent", async (t) => {
  const fixture = createFixture(t);

  const result = await executeGovernedWorkerContainment({
    apply: true,
    databasePath: fixture.databasePath,
    generatedAt: NOW,
    now: () => new Date(NOW),
    env: {},
  });

  assert.equal(result.mode, "APPLY");
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.mutated, false);
  for (const blocker of [
    "exact_database_path_confirmation_required",
    "runtime_database_path_mismatch",
    "human_review_operating_mode_required",
    "auto_publish_must_be_explicitly_false",
    "emergency_kill_switch_must_be_true",
    "primary_kill_switch_must_be_true",
    "scheduler_must_be_stopped",
    "workers_must_be_stopped",
    "stopped_scheduler_confirmation_required",
    "stopped_workers_confirmation_required",
    "operator_actor_required",
    "operator_reason_required",
    "change_window_id_required",
    "worker_containment_confirmation_required",
    "backup_evidence_file_required",
  ]) {
    assert.ok(result.blockers.includes(blocker), blocker);
  }
  assert.equal(
    WORKER_CONTAINMENT_CONFIRMATION,
    "I CONFIRM PULSE SCHEDULER AND WORKERS ARE STOPPED; SET ACTIVE WORKERS OFFLINE",
  );

  const db = new Database(fixture.databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  assert.equal(
    db.prepare("SELECT status FROM workers WHERE id = ?").get("worker-idle")
      .status,
    "idle",
  );
  db.close();
});

test("apply transactionally sets only eligible workers offline and appends immutable before/after evidence", async (t) => {
  const fixture = createFixture(t);
  const beforeDb = new Database(fixture.databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  const auditCountBefore = beforeDb
    .prepare("SELECT COUNT(*) AS count FROM operator_audit_log")
    .get().count;
  beforeDb.close();

  const result = await executeGovernedWorkerContainment(
    validApplyOptions(fixture),
  );

  assert.equal(result.verdict, "APPLIED");
  assert.equal(result.mutated, true);
  assert.equal(result.idempotent, false);
  assert.deepEqual(result.change.before.active_worker_ids, ["worker-idle"]);
  assert.equal(result.change.before.active_worker_count, 1);
  assert.deepEqual(result.change.after.active_worker_ids, []);
  assert.equal(result.change.after.active_worker_count, 0);
  assert.deepEqual(result.change.transitioned_worker_ids, ["worker-idle"]);
  assert.deepEqual(result.change.cleared_last_job_worker_ids, ["worker-idle"]);
  assert.deepEqual(result.change.preserved_locked_worker_ids, [
    "worker-locked",
  ]);

  const db = new Database(fixture.databasePath, {
    fileMustExist: true,
  });
  const idle = db
    .prepare("SELECT status, last_job_id FROM workers WHERE id = ?")
    .get("worker-idle");
  assert.equal(idle.status, "offline");
  assert.equal(idle.last_job_id, null);
  const locked = db
    .prepare("SELECT status, last_job_id FROM workers WHERE id = ?")
    .get("worker-locked");
  assert.deepEqual(locked, { status: "locked", last_job_id: 42 });
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    auditCountBefore + 1,
  );
  const audit = db
    .prepare(
      `SELECT * FROM operator_audit_log
       WHERE action = 'GOVERNED_WORKER_CONTAINMENT'`,
    )
    .get();
  assert.equal(audit.actor_id, "operator:MORR");
  assert.equal(audit.target_type, "worker_registry");
  assert.equal(audit.target_id, "pulse-youtube-cutover-2026-07-27");
  assert.equal(audit.decision, "SET_ELIGIBLE_WORKERS_OFFLINE");
  const evidence = JSON.parse(audit.evidence_json);
  assert.deepEqual(evidence.before.active_worker_ids, ["worker-idle"]);
  assert.deepEqual(evidence.after.active_worker_ids, []);
  assert.equal(evidence.before.active_runtime_lease_count, 0);
  assert.equal(evidence.after.claimed_or_running_job_count, 0);
  assert.throws(
    () =>
      db
        .prepare("UPDATE operator_audit_log SET reason = 'changed' WHERE id = ?")
        .run(audit.id),
    /immutable_operator_audit_log/,
  );
  assert.throws(
    () =>
      db
        .prepare("DELETE FROM operator_audit_log WHERE id = ?")
        .run(audit.id),
    /immutable_operator_audit_log/,
  );
  db.close();
});

test("apply refuses to relabel workers while any runtime lease or claimed job is active", async (t) => {
  const fixture = createFixture(t);
  const setup = new Database(fixture.databasePath, {
    fileMustExist: true,
  });
  setup
    .prepare(
      `INSERT INTO runtime_leases
         (name, owner_id, acquired_at, heartbeat_at, expires_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "scheduler",
      "runtime-owner",
      NOW,
      NOW,
      "2026-07-27T16:35:00.000Z",
      "{}",
    );
  setup
    .prepare(
      `INSERT INTO jobs
         (kind, status, claimed_by, claimed_at, lease_until)
       VALUES ('publish', 'claimed', 'worker-idle', ?, ?)`,
    )
    .run(NOW, "2026-07-27T16:35:00.000Z");
  const auditCountBefore = setup
    .prepare("SELECT COUNT(*) AS count FROM operator_audit_log")
    .get().count;
  setup.close();

  const result = await executeGovernedWorkerContainment(
    validApplyOptions(fixture),
  );

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.mutated, false);
  assert.ok(result.blockers.includes("active_runtime_leases_present"));
  assert.ok(result.blockers.includes("running_jobs_present"));

  const db = new Database(fixture.databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  assert.equal(
    db.prepare("SELECT status FROM workers WHERE id = ?").get("worker-idle")
      .status,
    "idle",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    auditCountBefore,
  );
  db.close();
});

test("post-state mismatch rolls back every worker change and the audit append", async (t) => {
  const fixture = createFixture(t);
  const setup = new Database(fixture.databasePath, {
    fileMustExist: true,
  });
  setup.exec(`
    CREATE TRIGGER block_worker_idle_containment
    BEFORE UPDATE OF status, last_job_id ON workers
    WHEN OLD.id = 'worker-idle'
    BEGIN
      SELECT RAISE(IGNORE);
    END;
  `);
  const auditCountBefore = setup
    .prepare("SELECT COUNT(*) AS count FROM operator_audit_log")
    .get().count;
  setup.close();

  const result = await executeGovernedWorkerContainment(
    validApplyOptions(fixture),
  );

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.mutated, false);
  assert.ok(
    result.blockers.includes("worker_containment_update_count_mismatch"),
  );

  const db = new Database(fixture.databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  assert.equal(
    db.prepare("SELECT status FROM workers WHERE id = ?").get("worker-idle")
      .status,
    "idle",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    auditCountBefore,
  );
  db.close();
});

test("an exact replay with a new current backup is idempotent and does not duplicate the audit", async (t) => {
  const fixture = createFixture(t);
  const first = await executeGovernedWorkerContainment(
    validApplyOptions(fixture),
  );
  assert.equal(first.verdict, "APPLIED");

  const replay = await executeGovernedWorkerContainment(
    validApplyOptions(fixture),
  );

  assert.equal(replay.verdict, "IDEMPOTENT");
  assert.equal(replay.mutated, false);
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.change.transitioned_worker_ids, ["worker-idle"]);

  const db = new Database(fixture.databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM operator_audit_log
         WHERE action = 'GOVERNED_WORKER_CONTAINMENT'`,
      )
      .get().count,
    1,
  );
  db.close();
});

test("apply requires the complete current cutover backup and restore evidence contract", async (t) => {
  const fixture = createFixture(t);
  const options = validApplyOptions(fixture);
  const evidence = JSON.parse(
    fs.readFileSync(options.backupEvidencePath, "utf8"),
  );
  delete evidence.quick_check;
  delete evidence.restore_path;
  delete evidence.restore_sha256;
  delete evidence.backup_restore_hashes_match;
  delete evidence.production_database_mutated;
  fs.writeFileSync(
    options.backupEvidencePath,
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );

  const result = await executeGovernedWorkerContainment(options);

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.mutated, false);
  assert.ok(
    result.blockers.includes("backup_quick_check_required"),
  );
  assert.ok(
    result.blockers.includes("backup_restore_hash_match_required"),
  );
  assert.ok(
    result.blockers.includes(
      "backup_production_database_unmutated_evidence_required",
    ),
  );
  assert.ok(result.blockers.includes("restored_copy_file_required"));

  const db = new Database(fixture.databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  assert.equal(
    db.prepare("SELECT status FROM workers WHERE id = ?").get("worker-idle")
      .status,
    "idle",
  );
  db.close();
});

test("a lease with an unparseable expiry fails closed instead of being treated as inactive", async (t) => {
  const fixture = createFixture(t);
  const setup = new Database(fixture.databasePath, {
    fileMustExist: true,
  });
  setup
    .prepare(
      `INSERT INTO runtime_leases
         (name, owner_id, acquired_at, heartbeat_at, expires_at)
       VALUES ('scheduler', 'unknown-owner', ?, ?, 'not-a-time')`,
    )
    .run(NOW, NOW);
  setup.close();

  const result = await executeGovernedWorkerContainment(
    validApplyOptions(fixture),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("active_runtime_leases_present"));
  assert.equal(result.inspection.active_runtime_lease_count, 1);
});

test("apply refuses logical database changes committed only to an uncheckpointed WAL", async (t) => {
  const fixture = createFixture(t);
  const setup = new Database(fixture.databasePath, {
    fileMustExist: true,
  });
  setup.pragma("journal_mode = WAL");
  setup.pragma("wal_autocheckpoint = 0");
  setup.pragma("wal_checkpoint(TRUNCATE)");
  setup.close();

  const options = validApplyOptions(fixture);
  const sourceHashAtBackup = sha256(
    fs.readFileSync(fixture.databasePath),
  );
  const writer = new Database(fixture.databasePath, {
    fileMustExist: true,
  });
  try {
    writer.pragma("wal_autocheckpoint = 0");
    writer
      .prepare(
        `INSERT INTO workers
           (id, display_name, status, last_seen_at)
         VALUES ('worker-after-backup', 'Late worker', 'idle', ?)`,
      )
      .run(NOW);

    assert.equal(
      sha256(fs.readFileSync(fixture.databasePath)),
      sourceHashAtBackup,
      "the main database hash does not include the committed WAL frame",
    );
    assert.ok(fs.statSync(`${fixture.databasePath}-wal`).size > 0);

    const result = await executeGovernedWorkerContainment(options);

    assert.equal(result.verdict, "HOLD");
    assert.equal(result.mutated, false);
    assert.ok(
      result.blockers.includes("source_database_wal_not_checkpointed"),
      JSON.stringify(result),
    );
    assert.equal(
      writer
        .prepare(
          "SELECT status FROM workers WHERE id = 'worker-after-backup'",
        )
        .pluck()
        .get(),
      "idle",
    );
    assert.equal(
      writer
        .prepare(
          `SELECT COUNT(*) FROM operator_audit_log
           WHERE action = 'GOVERNED_WORKER_CONTAINMENT'`,
        )
        .pluck()
        .get(),
      0,
    );
  } finally {
    writer.close();
  }
});

test("apply supports a checkpointed WAL database after every handle closes", async (t) => {
  const fixture = createFixture(t);
  const setup = new Database(fixture.databasePath, {
    fileMustExist: true,
  });
  setup.pragma("journal_mode = WAL");
  setup.pragma("wal_autocheckpoint = 0");
  setup.pragma("wal_checkpoint(TRUNCATE)");
  setup.close();

  assert.equal(fs.existsSync(`${fixture.databasePath}-wal`), false);
  assert.equal(fs.existsSync(`${fixture.databasePath}-shm`), false);

  const result = await executeGovernedWorkerContainment(
    validApplyOptions(fixture),
  );

  assert.equal(result.verdict, "APPLIED");
  assert.equal(result.mutated, true);
  assert.equal(fs.existsSync(`${fixture.databasePath}-wal`), false);
  assert.equal(fs.existsSync(`${fixture.databasePath}-shm`), false);
});

test("apply rejects shared memory held by a reader even when the WAL is empty", async (t) => {
  const fixture = createFixture(t);
  const setup = new Database(fixture.databasePath, {
    fileMustExist: true,
  });
  setup.pragma("journal_mode = WAL");
  setup.pragma("wal_autocheckpoint = 0");
  setup.pragma("wal_checkpoint(TRUNCATE)");
  setup.close();

  const options = validApplyOptions(fixture);
  const reader = new Database(fixture.databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    reader.prepare("SELECT COUNT(*) FROM workers").pluck().get();
    assert.equal(fs.statSync(`${fixture.databasePath}-wal`).size, 0);
    assert.ok(fs.statSync(`${fixture.databasePath}-shm`).size > 0);

    const result = await executeGovernedWorkerContainment(options);

    assert.equal(result.verdict, "HOLD");
    assert.equal(result.mutated, false);
    assert.ok(
      result.blockers.includes("source_database_shared_memory_present"),
      JSON.stringify(result),
    );
    assert.equal(
      reader
        .prepare("SELECT status FROM workers WHERE id = 'worker-idle'")
        .pluck()
        .get(),
      "idle",
    );
  } finally {
    reader.close();
  }
});

test("apply rechecks WAL quietness when the database changes after backup verification", async (t) => {
  const fixture = createFixture(t);
  const setup = new Database(fixture.databasePath, {
    fileMustExist: true,
  });
  setup.pragma("journal_mode = WAL");
  setup.pragma("wal_autocheckpoint = 0");
  setup.pragma("wal_checkpoint(TRUNCATE)");
  setup.close();

  const options = validApplyOptions(fixture);
  let racingWriter = null;
  function RacingDatabase(filePath, databaseOptions) {
    const db = new Database(filePath, databaseOptions);
    if (databaseOptions?.readonly !== true) {
      racingWriter = new Database(filePath, { fileMustExist: true });
      racingWriter.pragma("wal_autocheckpoint = 0");
      racingWriter
        .prepare(
          `INSERT INTO workers
             (id, display_name, status, last_seen_at)
           VALUES ('worker-after-gate', 'Racing worker', 'idle', ?)`,
        )
        .run(NOW);
    }
    return db;
  }

  let result;
  try {
    result = await executeGovernedWorkerContainment({
      ...options,
      DatabaseImpl: RacingDatabase,
    });
    assert.equal(result.verdict, "HOLD");
    assert.equal(result.mutated, false);
    assert.ok(
      result.blockers.includes("source_database_wal_not_checkpointed"),
      JSON.stringify(result),
    );
    assert.equal(
      racingWriter
        .prepare(
          "SELECT status FROM workers WHERE id = 'worker-after-gate'",
        )
        .pluck()
        .get(),
      "idle",
    );
  } finally {
    if (racingWriter) racingWriter.close();
  }
});

test("apply returns a structured hold for an invalid operator timestamp", async (t) => {
  const fixture = createFixture(t);
  const options = validApplyOptions(fixture, {
    generatedAt: "not-a-timestamp",
  });

  const result = await executeGovernedWorkerContainment(options);

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.mutated, false);
  assert.ok(
    result.blockers.includes("worker_containment_generated_at_invalid"),
  );
});

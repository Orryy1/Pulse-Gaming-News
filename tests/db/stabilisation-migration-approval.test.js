"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { runMigrations } = require("../../lib/migrate");

const MIGRATION_NOW = new Date("2026-07-27T03:00:00.000Z");

function approvalEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    PULSE_OPERATING_MODE: "HUMAN_REVIEW",
    PULSE_MIGRATION_020_APPROVED: "true",
    PULSE_MIGRATION_020_APPROVAL_ID: "change-window-020",
    PULSE_MIGRATION_020_APPROVED_BY: "operator-1",
    PULSE_MIGRATION_020_BACKUP_ID: "backup-before-020",
    PULSE_MIGRATION_020_BACKUP_SHA256: "a".repeat(64),
    PULSE_MIGRATION_020_BACKUP_VERIFIED_AT: "2026-07-27T02:00:00.000Z",
    ...overrides,
  };
}

test("controlled runtime refuses migration 020 without backup approval evidence", () => {
  const db = new Database(":memory:");
  assert.throws(
    () =>
      runMigrations(db, {
        log() {},
        now: MIGRATION_NOW,
        env: approvalEnv({
          PULSE_MIGRATION_020_APPROVED: "false",
          PULSE_MIGRATION_020_BACKUP_SHA256: "",
        }),
      }),
    /migration 020 requires explicit approval and verified backup evidence/,
  );
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM sqlite_master
         WHERE type = 'table' AND name = 'runtime_leases'`,
      )
      .get().count,
    0,
  );
  assert.equal(
    db
      .prepare(
        "SELECT MAX(CAST(version AS INTEGER)) AS version FROM schema_migrations",
      )
      .get().version,
    19,
  );
  db.close();
});

test("hosted runtime cannot evade the gate by claiming LOCAL_PROOF", () => {
  const db = new Database(":memory:");
  assert.throws(
    () =>
      runMigrations(db, {
        log() {},
        now: MIGRATION_NOW,
        env: {
          RAILWAY_PUBLIC_URL: "https://pulse.example",
          PULSE_OPERATING_MODE: "LOCAL_PROOF",
        },
      }),
    /migration 020 requires explicit approval and verified backup evidence/,
  );
  db.close();
});

test("local controlled operating modes cannot bypass migration approval", () => {
  for (const mode of ["HUMAN_REVIEW", "LIVE_GUARDED"]) {
    const db = new Database(":memory:");
    assert.throws(
      () =>
        runMigrations(db, {
          log() {},
          now: MIGRATION_NOW,
          env: { PULSE_OPERATING_MODE: mode },
        }),
      /migration 020 requires explicit approval and verified backup evidence/,
      mode,
    );
    db.close();
  }
});

test("canonical OPERATING_MODE alias cannot bypass migration approval", () => {
  for (const mode of ["HUMAN_REVIEW", "LIVE_GUARDED"]) {
    const db = new Database(":memory:");
    assert.throws(
      () =>
        runMigrations(db, {
          log() {},
          now: MIGRATION_NOW,
          env: { OPERATING_MODE: mode },
        }),
      /migration 020 requires explicit approval and verified backup evidence/,
      mode,
    );
    db.close();
  }
});

test("future or stale backups cannot authorise migration 020", () => {
  for (const verifiedAt of [
    "2026-07-27T03:00:01.000Z",
    "2026-07-26T02:59:59.000Z",
  ]) {
    const db = new Database(":memory:");
    assert.throws(
      () =>
        runMigrations(db, {
          log() {},
          now: MIGRATION_NOW,
          env: approvalEnv({
            PULSE_MIGRATION_020_BACKUP_VERIFIED_AT: verifiedAt,
          }),
        }),
      /migration 020 requires explicit approval and verified backup evidence/,
      verifiedAt,
    );
    db.close();
  }
});

test("controlled runtime applies migration 020 only with complete evidence", () => {
  const db = new Database(":memory:");
  const result = runMigrations(db, {
    log() {},
    now: MIGRATION_NOW,
    env: approvalEnv(),
  });
  assert.ok(result.applied.includes("020_stabilisation_governance.sql"));
  assert.ok(
    db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'runtime_leases'`,
      )
      .get(),
  );
  const audit = db
    .prepare(
      `SELECT actor_id, action, target_type, target_id, decision,
              reason, evidence_json
       FROM operator_audit_log
       WHERE action = 'apply_schema_migration'`,
    )
    .get();
  assert.deepEqual(
    {
      actor_id: audit.actor_id,
      action: audit.action,
      target_type: audit.target_type,
      target_id: audit.target_id,
      decision: audit.decision,
      reason: audit.reason,
    },
    {
      actor_id: "operator-1",
      action: "apply_schema_migration",
      target_type: "schema_migration",
      target_id: "020",
      decision: "APPROVED_AND_VERIFIED",
      reason: "change-window-020",
    },
  );
  const evidence = JSON.parse(audit.evidence_json);
  assert.equal(evidence.backup_id, "backup-before-020");
  assert.equal(evidence.backup_sha256, "a".repeat(64));
  assert.equal(evidence.backup_verified_at, "2026-07-27T02:00:00.000Z");
  assert.deepEqual(evidence.post_migration_checks, {
    foreign_key_check: "ok",
    integrity_check: "ok",
    quick_check: "ok",
  });
  db.close();
});

test("failed post-migration integrity verification rolls migration 020 back", () => {
  const db = new Database(":memory:");
  assert.throws(
    () =>
      runMigrations(db, {
        log() {},
        now: MIGRATION_NOW,
        env: approvalEnv(),
        governanceIntegrityVerifier() {
          throw new Error("post_migration_integrity_verification_failed");
        },
      }),
    /post_migration_integrity_verification_failed/,
  );
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM sqlite_master
         WHERE type = 'table' AND name = 'runtime_leases'`,
      )
      .get().count,
    0,
  );
  assert.equal(
    db
      .prepare(
        "SELECT MAX(CAST(version AS INTEGER)) AS version FROM schema_migrations",
      )
      .get().version,
    19,
  );
  db.close();
});

test("already-applied migration remains restart-safe after approval is removed", () => {
  const db = new Database(":memory:");
  runMigrations(db, {
    log() {},
    now: MIGRATION_NOW,
    env: approvalEnv(),
  });
  assert.doesNotThrow(() =>
    runMigrations(db, {
      log() {},
      now: MIGRATION_NOW,
      env: approvalEnv({
        PULSE_MIGRATION_020_APPROVED: "false",
        PULSE_MIGRATION_020_BACKUP_SHA256: "",
      }),
    }),
  );
  db.close();
});

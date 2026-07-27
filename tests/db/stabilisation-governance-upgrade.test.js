"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { runMigrations } = require("../../lib/migrate");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");
const SHIPPED_020_CHECKSUM =
  "e2d6c6be2bc96ef6cb1cb5825071714f0280e20c92e2cd960522437d2880343b";
const MIGRATION_NOW = new Date("2026-07-27T03:00:00.000Z");

function migrationFilesThrough(lastVersion) {
  return fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()
    .filter((name) => name.slice(0, 3) <= lastVersion);
}

function checksum(body) {
  return crypto.createHash("sha256").update(body).digest("hex");
}

function createApplied020Fixture(filepath) {
  const db = new Database(filepath);
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE schema_migrations (
      version TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  for (const filename of migrationFilesThrough("020")) {
    const body = fs.readFileSync(path.join(MIGRATIONS, filename));
    db.exec(body.toString("utf8"));
    db.prepare(
      `INSERT INTO schema_migrations (version, filename, checksum)
       VALUES (?, ?, ?)`,
    ).run(filename.slice(0, 3), filename, checksum(body));
  }
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "upgrade-story",
    "Historical upgrade story",
  );
  db.prepare(
    `INSERT INTO operator_audit_log (actor_id, action, reason)
     VALUES (?, ?, ?)`,
  ).run("operator-before-023", "historical_review", "preserve-me");
  db.close();
}

function assertDatabaseIntegrity(db) {
  assert.equal(db.pragma("quick_check", { simple: true }), "ok");
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  assert.deepEqual(db.pragma("foreign_key_check"), []);
}

function assertForwardHardening(db) {
  const auditColumns = db.pragma("table_info(operator_audit_log)");
  assert.ok(auditColumns.some((column) => column.name === "idempotency_key"));

  const insertAudit = db.prepare(
    `INSERT INTO operator_audit_log
       (actor_id, action, idempotency_key)
     VALUES (?, ?, ?)`,
  );
  insertAudit.run("operator-after-023", "review", "audit:upgrade-story");
  assert.throws(
    () =>
      insertAudit.run(
        "operator-after-023",
        "review",
        "audit:upgrade-story",
      ),
    /UNIQUE constraint failed/,
  );

  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO platform_publication_state
             (story_id, platform, lifecycle_state, external_id,
              verification_status, verified_at)
           VALUES (?, ?, 'PUBLISHED', ?, 'confirmed', ?)`,
        )
        .run(
          "upgrade-story",
          "youtube",
          "youtube-upgrade-story",
          "2026-07-27T12:00:00.000Z",
        ),
    /published_state_requires_platform_verification/,
  );
}

function controlledApprovalEnv() {
  return {
    NODE_ENV: "production",
    PULSE_OPERATING_MODE: "HUMAN_REVIEW",
    PULSE_MIGRATION_020_APPROVED: "true",
    PULSE_MIGRATION_020_APPROVAL_ID: "fresh-create-020",
    PULSE_MIGRATION_020_APPROVED_BY: "operator-1",
    PULSE_MIGRATION_020_BACKUP_ID: "fresh-create-backup",
    PULSE_MIGRATION_020_BACKUP_SHA256: "a".repeat(64),
    PULSE_MIGRATION_020_BACKUP_VERIFIED_AT: "2026-07-27T02:00:00.000Z",
  };
}

test("runMigrations creates the hardened schema in a fresh controlled database", (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());

  const result = runMigrations(db, {
    log() {},
    env: controlledApprovalEnv(),
    now: MIGRATION_NOW,
  });
  assert.ok(result.applied.includes("020_stabilisation_governance.sql"));
  assert.ok(
    result.applied.includes("023_stabilisation_governance_hardening.sql"),
  );

  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "upgrade-story",
    "Fresh controlled story",
  );
  assertForwardHardening(db);
  assertDatabaseIntegrity(db);
});

test("runMigrations upgrades an applied shipped-020 database through 023", (t) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-applied-020-upgrade-"),
  );
  const fixturePath = path.join(tempRoot, "pulse.db");
  createApplied020Fixture(fixturePath);

  const db = new Database(fixturePath);
  t.after(() => {
    db.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  const result = runMigrations(db, {
    log() {},
    env: {
      NODE_ENV: "production",
      PULSE_OPERATING_MODE: "HUMAN_REVIEW",
    },
  });

  assert.deepEqual(result.applied, [
    "021_controlled_experiment_analytics.sql",
    "022_youtube_retention_derivation_evidence.sql",
    "023_stabilisation_governance_hardening.sql",
  ]);
  assert.equal(
    db
      .prepare(
        "SELECT checksum FROM schema_migrations WHERE version = '020'",
      )
      .get().checksum,
    SHIPPED_020_CHECKSUM,
  );
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM operator_audit_log
         WHERE reason = 'preserve-me'`,
      )
      .get().count,
    1,
  );
  assertForwardHardening(db);
  assertDatabaseIntegrity(db);
});

test("runMigrations still rejects a migration 020 checksum mismatch", (t) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-mismatched-020-upgrade-"),
  );
  const fixturePath = path.join(tempRoot, "pulse.db");
  createApplied020Fixture(fixturePath);

  const db = new Database(fixturePath);
  t.after(() => {
    db.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  db.prepare(
    "UPDATE schema_migrations SET checksum = ? WHERE version = '020'",
  ).run("0".repeat(64));

  assert.throws(
    () => runMigrations(db, { log() {} }),
    /checksum mismatch for 020_stabilisation_governance\.sql/,
  );
});

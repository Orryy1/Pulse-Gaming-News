"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");

const { backupDatabase } = require("../../lib/db_backup");
const { runMigrations } = require("../../lib/migrate");

const FIXED_NOW = new Date("2026-07-27T12:34:56.789Z");
const SILENT_LOGGER = { log() {} };

function createMigratedDatabase(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(directory, "pulse.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db, {
    env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" },
    log() {},
    now: FIXED_NOW,
  });
  db.prepare(
    `INSERT INTO stories (id, title, url, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
  ).run(
    "verified-backup-story",
    "Verified backup fixture",
    "https://example.com/verified-backup",
  );

  t.after(() => {
    try {
      db.close();
    } catch {
      // The test may already have closed the handle.
    }
    fs.rmSync(directory, { force: true, recursive: true });
  });

  return {
    backupDir: path.join(directory, "backups"),
    db,
    dbPath,
    directory,
  };
}

function sha256(filepath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filepath))
    .digest("hex");
}

test("backupDatabase uses the live handle and writes verified machine-readable evidence", async (t) => {
  const fixture = createMigratedDatabase(t, "pulse-db-backup-");
  let onlineBackupCalls = 0;
  const liveHandle = {
    async backup(target) {
      onlineBackupCalls += 1;
      return fixture.db.backup(target);
    },
  };

  const report = await backupDatabase({
    backupDir: fixture.backupDir,
    dbHandle: liveHandle,
    dbPath: fixture.dbPath,
    env: {},
    logger: SILENT_LOGGER,
    now: () => FIXED_NOW,
  });

  assert.equal(onlineBackupCalls, 1);
  assert.equal(report.schemaVersion, "pulse-sqlite-backup-verification-v1");
  assert.equal(report.method, "better-sqlite3-online-backup");
  assert.equal(report.backup_id, "pulse_2026-07-27T12-34-56-789Z");
  assert.equal(report.verified, true);
  assert.equal(report.verifiedAt, FIXED_NOW.toISOString());
  assert.equal(report.sha256, sha256(report.backupPath));
  assert.match(report.sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.sizeBytes, fs.statSync(report.backupPath).size);
  assert.deepEqual(report.verification, {
    openedReadOnly: true,
    quick_check: "ok",
    integrity_check: "ok",
    foreign_key_check: "ok",
    foreign_key_violation_count: 0,
  });
  assert.deepEqual(report.s3, {
    attempted: false,
    configured: false,
    key: null,
    status: "not_configured",
  });
  assert.equal(
    path.basename(report.backupPath),
    "pulse_2026-07-27T12-34-56-789Z.db",
  );
  assert.equal(report.evidencePath, `${report.backupPath}.verification.json`);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(report.evidencePath, "utf8")),
    report,
  );

  const restored = new Database(report.backupPath, {
    fileMustExist: true,
    readonly: true,
  });
  try {
    assert.deepEqual(
      restored
        .prepare("SELECT id, title FROM stories WHERE id = ?")
        .get("verified-backup-story"),
      {
        id: "verified-backup-story",
        title: "Verified backup fixture",
      },
    );
    assert.throws(
      () =>
        restored
          .prepare(
            "INSERT INTO stories (id, title) VALUES ('write', 'blocked')",
          )
          .run(),
      /readonly/i,
    );
  } finally {
    restored.close();
  }
});

test("backupDatabase fails and removes a backup tampered before verification", async (t) => {
  const fixture = createMigratedDatabase(t, "pulse-db-backup-tamper-");
  const expectedBackupPath = path.join(
    fixture.backupDir,
    "pulse_2026-07-27T12-34-56-789Z.db",
  );
  const tamperingHandle = {
    async backup(target) {
      await fixture.db.backup(target);
      fs.writeFileSync(target, "tampered after online backup", "utf8");
    },
  };

  await assert.rejects(
    backupDatabase({
      backupDir: fixture.backupDir,
      dbHandle: tamperingHandle,
      dbPath: fixture.dbPath,
      env: {},
      logger: SILENT_LOGGER,
      now: FIXED_NOW,
    }),
    (error) => {
      assert.equal(error.code, "SQLITE_BACKUP_VERIFICATION_FAILED");
      assert.equal(error.verificationEvidence.verified, false);
      return true;
    },
  );

  assert.equal(fs.existsSync(expectedBackupPath), false);
  assert.equal(fs.existsSync(`${expectedBackupPath}.verification.json`), false);
});

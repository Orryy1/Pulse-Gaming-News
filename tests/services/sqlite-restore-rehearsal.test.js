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
const {
  rehearseSqliteRestore,
} = require("../../lib/ops/sqlite-restore-rehearsal");

const FIXED_NOW = new Date("2026-07-27T16:30:00.000Z");
const SILENT_LOGGER = { log() {} };

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

async function createVerifiedBackup(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-restore-rehearsal-"),
  );
  const databasePath = path.join(root, "production-fixture.db");
  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  runMigrations(database, {
    env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" },
    log() {},
    now: FIXED_NOW,
  });
  database
    .prepare(
      `INSERT INTO stories (id, title, url, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      "restore-proof-story",
      "Restore proof",
      "https://example.com/restore-proof",
      FIXED_NOW.toISOString(),
    );

  const backup = await backupDatabase({
    backupDir: path.join(root, "backups"),
    dbHandle: database,
    dbPath: databasePath,
    env: {},
    logger: SILENT_LOGGER,
    now: FIXED_NOW,
  });

  t.after(() => {
    database.close();
    fs.rmSync(root, { force: true, recursive: true });
  });
  return { backup, databasePath, root };
}

test("rehearsal copies an exact verified backup and emits read-only restore evidence", async (t) => {
  const fixture = await createVerifiedBackup(t);
  const restorePath = path.join(
    fixture.root,
    "restore-rehearsals",
    "pulse-restored.db",
  );
  const evidencePath = `${restorePath}.rehearsal.json`;
  const sourceDatabaseHashBefore = sha256(fixture.databasePath);
  const backupHashBefore = sha256(fixture.backup.backupPath);

  const result = await rehearseSqliteRestore({
    backupPath: fixture.backup.backupPath,
    backupVerificationPath: fixture.backup.evidencePath,
    evidencePath,
    generatedAt: FIXED_NOW,
    restorePath,
  });

  assert.equal(result.schema_version, "pulse-restore-rehearsal-v1");
  assert.equal(result.generated_at, FIXED_NOW.toISOString());
  assert.equal(result.source_backup, fixture.backup.backupPath);
  assert.equal(result.restored_copy, restorePath);
  assert.equal(result.source_sha256, backupHashBefore);
  assert.equal(result.restored_sha256, backupHashBefore);
  assert.equal(result.hashes_match, true);
  assert.deepEqual(result.verification, {
    openedReadOnly: true,
    query_only: true,
    quick_check: "ok",
    integrity_check: "ok",
    foreign_key_check: "ok",
    foreign_key_violation_count: 0,
  });
  assert.equal(result.latest_migration, "025");
  assert.equal(
    result.latest_migration_filename,
    "025_green_autopilot_runtime_control.sql",
  );
  assert.equal(result.migration_count, 25);
  assert.equal(result.row_counts.stories, 1);
  assert.equal(result.production_database_mutated, false);
  assert.equal(result.restored_copy_opened_read_only, true);
  assert.equal(result.source_backup_opened_as_database, false);
  assert.deepEqual(result.safety, {
    production_database_opened: false,
    production_database_mutated: false,
    source_backup_mutated: false,
    oauth_or_tokens_mutated: false,
    platforms_contacted: false,
    network_contacted: false,
  });
  assert.equal(
    result.source_backup_verification,
    fixture.backup.evidencePath,
  );
  assert.equal(
    result.source_backup_verification_sha256,
    sha256(fixture.backup.evidencePath),
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(evidencePath, "utf8")),
    result,
  );
  assert.equal(sha256(fixture.databasePath), sourceDatabaseHashBefore);
  assert.equal(sha256(fixture.backup.backupPath), backupHashBefore);

  const restored = new Database(restorePath, {
    fileMustExist: true,
    readonly: true,
  });
  try {
    assert.equal(
      restored
        .prepare("SELECT title FROM stories WHERE id = ?")
        .pluck()
        .get("restore-proof-story"),
      "Restore proof",
    );
  } finally {
    restored.close();
  }
});

test("rehearsal rejects backup bytes that no longer match the verification sidecar", async (t) => {
  const fixture = await createVerifiedBackup(t);
  const restorePath = path.join(fixture.root, "tampered-restore.db");
  const evidencePath = `${restorePath}.rehearsal.json`;
  fs.appendFileSync(fixture.backup.backupPath, "tampered", "utf8");
  const productionHashBefore = sha256(fixture.databasePath);

  await assert.rejects(
    rehearseSqliteRestore({
      backupPath: fixture.backup.backupPath,
      backupVerificationPath: fixture.backup.evidencePath,
      evidencePath,
      generatedAt: FIXED_NOW,
      restorePath,
    }),
    (error) => error.code === "backup_size_mismatch",
  );

  assert.equal(fs.existsSync(restorePath), false);
  assert.equal(fs.existsSync(evidencePath), false);
  assert.equal(sha256(fixture.databasePath), productionHashBefore);
});

test("rehearsal requires the verified online-backup identity", async (t) => {
  const fixture = await createVerifiedBackup(t);
  const restorePath = path.join(fixture.root, "missing-backup-id.db");
  const proof = JSON.parse(
    fs.readFileSync(fixture.backup.evidencePath, "utf8"),
  );
  proof.backup_id = "";
  fs.writeFileSync(
    fixture.backup.evidencePath,
    `${JSON.stringify(proof, null, 2)}\n`,
    "utf8",
  );

  await assert.rejects(
    rehearseSqliteRestore({
      backupPath: fixture.backup.backupPath,
      backupVerificationPath: fixture.backup.evidencePath,
      generatedAt: FIXED_NOW,
      restorePath,
    }),
    (error) => error.code === "backup_id_required",
  );
  assert.equal(fs.existsSync(restorePath), false);
  assert.equal(fs.existsSync(`${restorePath}.rehearsal.json`), false);
});

test("rehearsal fails closed if the verification sidecar changes during inspection", async (t) => {
  const fixture = await createVerifiedBackup(t);
  const restorePath = path.join(fixture.root, "sidecar-race.db");
  const evidencePath = `${restorePath}.rehearsal.json`;
  let openedPath = null;

  function MutatingDatabase(filePath, options) {
    openedPath = filePath;
    fs.appendFileSync(fixture.backup.evidencePath, " ", "utf8");
    return new Database(filePath, options);
  }

  await assert.rejects(
    rehearseSqliteRestore({
      backupPath: fixture.backup.backupPath,
      backupVerificationPath: fixture.backup.evidencePath,
      DatabaseImpl: MutatingDatabase,
      evidencePath,
      generatedAt: FIXED_NOW,
      restorePath,
    }),
    (error) =>
      error.code ===
      "backup_verification_changed_during_rehearsal",
  );
  assert.equal(openedPath, restorePath);
  assert.equal(fs.existsSync(restorePath), false);
  assert.equal(fs.existsSync(evidencePath), false);
});

test("rehearsal requires valid backup creation and verification timestamps", async (t) => {
  const fixture = await createVerifiedBackup(t);
  const restorePath = path.join(fixture.root, "missing-proof-time.db");
  const proof = JSON.parse(
    fs.readFileSync(fixture.backup.evidencePath, "utf8"),
  );
  proof.verifiedAt = "not-a-date";
  fs.writeFileSync(
    fixture.backup.evidencePath,
    `${JSON.stringify(proof, null, 2)}\n`,
    "utf8",
  );

  await assert.rejects(
    rehearseSqliteRestore({
      backupPath: fixture.backup.backupPath,
      backupVerificationPath: fixture.backup.evidencePath,
      generatedAt: FIXED_NOW,
      restorePath,
    }),
    (error) => error.code === "backup_verified_at_invalid",
  );
  assert.equal(fs.existsSync(restorePath), false);
});

test("rehearsal timestamp cannot predate the verified backup", async (t) => {
  const fixture = await createVerifiedBackup(t);
  const restorePath = path.join(fixture.root, "time-travel-restore.db");

  await assert.rejects(
    rehearseSqliteRestore({
      backupPath: fixture.backup.backupPath,
      backupVerificationPath: fixture.backup.evidencePath,
      generatedAt: new Date(FIXED_NOW.getTime() - 1),
      restorePath,
    }),
    (error) =>
      error.code === "restore_rehearsal_predates_backup_verification",
  );
  assert.equal(fs.existsSync(restorePath), false);
});

test("rehearsal never overwrites a restore copy or evidence file", async (t) => {
  const fixture = await createVerifiedBackup(t);
  const restorePath = path.join(fixture.root, "existing-restore.db");
  const evidencePath = path.join(fixture.root, "existing-evidence.json");
  fs.writeFileSync(restorePath, "restore sentinel", "utf8");
  fs.writeFileSync(evidencePath, "evidence sentinel", "utf8");

  await assert.rejects(
    rehearseSqliteRestore({
      backupPath: fixture.backup.backupPath,
      backupVerificationPath: fixture.backup.evidencePath,
      evidencePath,
      generatedAt: FIXED_NOW,
      restorePath,
    }),
    (error) => error.code === "restore_path_already_exists",
  );
  assert.equal(fs.readFileSync(restorePath, "utf8"), "restore sentinel");
  assert.equal(
    fs.readFileSync(evidencePath, "utf8"),
    "evidence sentinel",
  );

  fs.rmSync(restorePath);
  await assert.rejects(
    rehearseSqliteRestore({
      backupPath: fixture.backup.backupPath,
      backupVerificationPath: fixture.backup.evidencePath,
      evidencePath,
      generatedAt: FIXED_NOW,
      restorePath,
    }),
    (error) => error.code === "restore_evidence_already_exists",
  );
  assert.equal(fs.existsSync(restorePath), false);
  assert.equal(
    fs.readFileSync(evidencePath, "utf8"),
    "evidence sentinel",
  );
});

test("rehearsal binds the supplied backup and sidecar to their recorded paths", async (t) => {
  const fixture = await createVerifiedBackup(t);
  const restorePath = path.join(fixture.root, "path-mismatch.db");
  const proof = JSON.parse(
    fs.readFileSync(fixture.backup.evidencePath, "utf8"),
  );
  proof.backupPath = path.join(fixture.root, "different-backup.db");
  fs.writeFileSync(
    fixture.backup.evidencePath,
    `${JSON.stringify(proof, null, 2)}\n`,
    "utf8",
  );

  await assert.rejects(
    rehearseSqliteRestore({
      backupPath: fixture.backup.backupPath,
      backupVerificationPath: fixture.backup.evidencePath,
      generatedAt: FIXED_NOW,
      restorePath,
    }),
    (error) => error.code === "backup_path_mismatch",
  );
  assert.equal(fs.existsSync(restorePath), false);
});

test("sidecar claims cannot replace independent restored-copy integrity checks", async (t) => {
  const fixture = await createVerifiedBackup(t);
  const restorePath = path.join(fixture.root, "corrupt-restore.db");
  const evidencePath = `${restorePath}.rehearsal.json`;
  fs.writeFileSync(
    fixture.backup.backupPath,
    "not a SQLite database",
    "utf8",
  );
  const proof = JSON.parse(
    fs.readFileSync(fixture.backup.evidencePath, "utf8"),
  );
  proof.sha256 = sha256(fixture.backup.backupPath);
  proof.sizeBytes = fs.statSync(fixture.backup.backupPath).size;
  fs.writeFileSync(
    fixture.backup.evidencePath,
    `${JSON.stringify(proof, null, 2)}\n`,
    "utf8",
  );

  await assert.rejects(
    rehearseSqliteRestore({
      backupPath: fixture.backup.backupPath,
      backupVerificationPath: fixture.backup.evidencePath,
      evidencePath,
      generatedAt: FIXED_NOW,
      restorePath,
    }),
    (error) => error.code === "restored_database_inspection_failed",
  );
  assert.equal(fs.existsSync(restorePath), false);
  assert.equal(fs.existsSync(evidencePath), false);
});

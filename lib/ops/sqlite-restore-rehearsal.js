"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const RESTORE_REHEARSAL_SCHEMA =
  "pulse-restore-rehearsal-v1";
const BACKUP_VERIFICATION_SCHEMA =
  "pulse-sqlite-backup-verification-v1";
const ONLINE_BACKUP_METHOD = "better-sqlite3-online-backup";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function fail(code, cause) {
  const error = new Error(code);
  error.code = code;
  error.restoreRehearsalError = true;
  if (cause) error.cause = cause;
  throw error;
}

function pathKey(filePath) {
  const normalised = path
    .resolve(String(filePath || ""))
    .replace(/\\/g, "/");
  return process.platform === "win32"
    ? normalised.toLowerCase()
    : normalised;
}

function samePath(left, right) {
  return pathKey(left) === pathKey(right);
}

function existingRegularFile(filePath, code) {
  if (!String(filePath || "").trim()) fail(code);
  const resolved = path.resolve(String(filePath));
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (cause) {
    fail(code, cause);
  }
  if (!stat.isFile()) fail(code);
  return fs.realpathSync.native(resolved);
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
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

function parseBackupVerification(sidecarPath) {
  const bytes = fs.readFileSync(sidecarPath);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (cause) {
    fail("backup_verification_invalid_json", cause);
  }
  return {
    bytes,
    sha256: sha256Buffer(bytes),
    value,
  };
}

function validateBackupVerification({
  backupPath,
  backupVerificationPath,
  parsed,
}) {
  const proof = parsed.value;
  if (proof?.schemaVersion !== BACKUP_VERIFICATION_SCHEMA) {
    fail("backup_verification_schema_invalid");
  }
  if (proof?.method !== ONLINE_BACKUP_METHOD) {
    fail("online_backup_method_required");
  }
  if (proof?.mutationPerformed !== true || proof?.verified !== true) {
    fail("verified_online_backup_required");
  }
  if (!String(proof?.backup_id || "").trim()) {
    fail("backup_id_required");
  }
  const createdAt = Date.parse(String(proof?.createdAt || ""));
  const verifiedAt = Date.parse(String(proof?.verifiedAt || ""));
  if (!Number.isFinite(createdAt)) fail("backup_created_at_invalid");
  if (!Number.isFinite(verifiedAt)) fail("backup_verified_at_invalid");
  if (createdAt > verifiedAt) {
    fail("backup_verified_before_creation");
  }
  if (!proofChecksPass(proof?.verification)) {
    fail("backup_verification_checks_required");
  }
  if (!samePath(proof?.backupPath, backupPath)) {
    fail("backup_path_mismatch");
  }
  if (!samePath(proof?.evidencePath, backupVerificationPath)) {
    fail("backup_verification_path_mismatch");
  }
  if (
    !String(proof?.sourcePath || "").trim() ||
    samePath(proof.sourcePath, backupPath)
  ) {
    fail("backup_source_path_invalid");
  }
  if (
    !SHA256_PATTERN.test(String(proof?.sha256 || "").toLowerCase())
  ) {
    fail("backup_verification_sha256_invalid");
  }
  const sizeBytes = fs.statSync(backupPath).size;
  if (
    !Number.isSafeInteger(proof?.sizeBytes) ||
    proof.sizeBytes !== sizeBytes
  ) {
    fail("backup_size_mismatch");
  }
}

function firstPragmaValue(row) {
  return String(Object.values(row || {})[0] || "")
    .trim()
    .toLowerCase();
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function inspectRestoredDatabase(
  restorePath,
  { DatabaseImpl = Database } = {},
) {
  let database;
  try {
    database = new DatabaseImpl(restorePath, {
      fileMustExist: true,
      readonly: true,
    });
    database.pragma("query_only = ON");
    const queryOnly = Number(
      database.pragma("query_only", { simple: true }),
    );
    const quickRows = database.prepare("PRAGMA quick_check").all();
    const integrityRows = database
      .prepare("PRAGMA integrity_check")
      .all();
    const foreignKeyRows = database
      .prepare("PRAGMA foreign_key_check")
      .all();
    const verification = {
      openedReadOnly: true,
      query_only: queryOnly === 1,
      quick_check:
        quickRows.length === 1 &&
        firstPragmaValue(quickRows[0]) === "ok"
          ? "ok"
          : "failed",
      integrity_check:
        integrityRows.length === 1 &&
        firstPragmaValue(integrityRows[0]) === "ok"
          ? "ok"
          : "failed",
      foreign_key_check:
        foreignKeyRows.length === 0 ? "ok" : "failed",
      foreign_key_violation_count: foreignKeyRows.length,
    };
    if (
      verification.query_only !== true ||
      !proofChecksPass(verification)
    ) {
      fail("restored_database_integrity_checks_failed");
    }

    const migrationsTable = database
      .prepare(
        `SELECT 1
         FROM sqlite_schema
         WHERE type = 'table' AND name = 'schema_migrations'
         LIMIT 1`,
      )
      .get();
    if (!migrationsTable) fail("schema_migrations_table_required");
    const latestMigration = database
      .prepare(
        `SELECT version, filename
         FROM schema_migrations
         ORDER BY CAST(version AS INTEGER) DESC, version DESC
         LIMIT 1`,
      )
      .get();
    if (
      !String(latestMigration?.version || "").trim() ||
      !String(latestMigration?.filename || "").trim()
    ) {
      fail("latest_schema_migration_required");
    }
    const migrationCount = Number(
      database
        .prepare("SELECT COUNT(*) FROM schema_migrations")
        .pluck()
        .get(),
    );
    if (!Number.isSafeInteger(migrationCount) || migrationCount < 1) {
      fail("schema_migration_count_invalid");
    }

    const tables = database
      .prepare(
        `SELECT name
         FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all()
      .map((row) => String(row.name));
    const rowCountEntries = [];
    for (const table of tables) {
      const count = Number(
        database
          .prepare(`SELECT COUNT(*) FROM ${quoteIdentifier(table)}`)
          .pluck()
          .get(),
      );
      if (!Number.isSafeInteger(count) || count < 0) {
        fail("database_row_count_invalid");
      }
      rowCountEntries.push([table, count]);
    }
    const rowCounts = Object.fromEntries(rowCountEntries);

    return {
      latest_migration: String(latestMigration.version),
      latest_migration_filename: String(latestMigration.filename),
      migration_count: migrationCount,
      row_counts: rowCounts,
      verification,
    };
  } catch (error) {
    if (error?.restoreRehearsalError === true) throw error;
    fail("restored_database_inspection_failed", error);
  } finally {
    if (database) database.close();
  }
}

function atomicWriteNewJson(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(
      temporaryPath,
      `${JSON.stringify(value, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    if (fs.existsSync(filePath)) {
      fail("restore_evidence_already_exists");
    }
    try {
      // A hard link publishes the already-complete temporary inode while
      // retaining create-new semantics. Unlike rename on POSIX, it cannot
      // replace a target that appeared between the existence check and the
      // atomic filesystem operation.
      fs.linkSync(temporaryPath, filePath);
    } catch (cause) {
      if (cause?.code === "EEXIST") {
        fail("restore_evidence_already_exists", cause);
      }
      fail("restore_evidence_atomic_publish_failed", cause);
    }
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function validatedGeneratedAt(value) {
  const date = value == null ? new Date() : new Date(value);
  if (Number.isNaN(date.getTime())) fail("generated_at_invalid");
  return date.toISOString();
}

async function rehearseSqliteRestore(options = {}) {
  const backupPath = existingRegularFile(
    options.backupPath,
    "backup_file_required",
  );
  const backupVerificationPath = existingRegularFile(
    options.backupVerificationPath,
    "backup_verification_file_required",
  );
  const restorePath = path.resolve(String(options.restorePath || ""));
  const evidencePath = path.resolve(
    String(
      options.evidencePath ||
        (options.restorePath
          ? `${options.restorePath}.rehearsal.json`
          : ""),
    ),
  );
  if (!String(options.restorePath || "").trim()) {
    fail("restore_path_required");
  }
  if (!String(options.evidencePath || evidencePath).trim()) {
    fail("restore_evidence_path_required");
  }
  const distinctPaths = [
    [restorePath, backupPath],
    [restorePath, backupVerificationPath],
    [evidencePath, backupPath],
    [evidencePath, backupVerificationPath],
    [evidencePath, restorePath],
  ];
  if (distinctPaths.some(([left, right]) => samePath(left, right))) {
    fail("restore_path_collision");
  }
  if (fs.existsSync(restorePath)) fail("restore_path_already_exists");
  if (fs.existsSync(evidencePath)) {
    fail("restore_evidence_already_exists");
  }

  const parsed = parseBackupVerification(backupVerificationPath);
  validateBackupVerification({
    backupPath,
    backupVerificationPath,
    parsed,
  });
  if (
    samePath(restorePath, parsed.value.sourcePath) ||
    samePath(evidencePath, parsed.value.sourcePath)
  ) {
    fail("restore_path_collides_with_production_source");
  }

  const generatedAt = validatedGeneratedAt(options.generatedAt);
  if (
    Date.parse(generatedAt) <
    Date.parse(String(parsed.value.verifiedAt))
  ) {
    fail("restore_rehearsal_predates_backup_verification");
  }
  const sourceSha256Before = sha256File(backupPath);
  if (
    sourceSha256Before !==
    String(parsed.value.sha256).toLowerCase()
  ) {
    fail("backup_sha256_mismatch");
  }

  fs.mkdirSync(path.dirname(restorePath), { recursive: true });
  let restoreCreated = false;
  try {
    fs.copyFileSync(
      backupPath,
      restorePath,
      fs.constants.COPYFILE_EXCL,
    );
    restoreCreated = true;
    const restoreRealPath = fs.realpathSync.native(restorePath);
    if (
      samePath(restoreRealPath, backupPath) ||
      samePath(restoreRealPath, backupVerificationPath) ||
      samePath(restoreRealPath, parsed.value.sourcePath)
    ) {
      fail("restored_copy_not_distinct");
    }

    const restoredSha256 = sha256File(restoreRealPath);
    const sourceSha256After = sha256File(backupPath);
    if (
      sourceSha256After !== sourceSha256Before ||
      restoredSha256 !== sourceSha256Before
    ) {
      fail("backup_restore_hash_mismatch");
    }
    const sidecarBytesAfter = fs.readFileSync(backupVerificationPath);
    if (sha256Buffer(sidecarBytesAfter) !== parsed.sha256) {
      fail("backup_verification_changed_during_rehearsal");
    }

    const inspection = inspectRestoredDatabase(restoreRealPath, {
      DatabaseImpl: options.DatabaseImpl || Database,
    });
    const sourceFinalHash = sha256File(backupPath);
    const restoredFinalHash = sha256File(restoreRealPath);
    if (
      sourceFinalHash !== sourceSha256Before ||
      restoredFinalHash !== sourceSha256Before
    ) {
      fail("database_changed_during_rehearsal");
    }
    if (
      sha256Buffer(fs.readFileSync(backupVerificationPath)) !==
      parsed.sha256
    ) {
      fail("backup_verification_changed_during_rehearsal");
    }

    const result = {
      schema_version: RESTORE_REHEARSAL_SCHEMA,
      generated_at: generatedAt,
      source_backup: backupPath,
      source_backup_verification: backupVerificationPath,
      source_backup_verification_sha256: parsed.sha256,
      source_backup_verification_schema:
        parsed.value.schemaVersion,
      source_backup_verified_at: new Date(
        parsed.value.verifiedAt,
      ).toISOString(),
      source_backup_id: String(parsed.value.backup_id || "").trim(),
      restored_copy: restoreRealPath,
      evidence_path: evidencePath,
      source_sha256: sourceFinalHash,
      restored_sha256: restoredFinalHash,
      source_size_bytes: fs.statSync(backupPath).size,
      restored_size_bytes: fs.statSync(restoreRealPath).size,
      hashes_match: true,
      verification: inspection.verification,
      latest_migration: inspection.latest_migration,
      latest_migration_filename:
        inspection.latest_migration_filename,
      migration_count: inspection.migration_count,
      row_counts: inspection.row_counts,
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
    atomicWriteNewJson(evidencePath, result);
    restoreCreated = false;
    return result;
  } catch (error) {
    if (restoreCreated) {
      fs.rmSync(restorePath, { force: true });
      fs.rmSync(`${restorePath}-shm`, { force: true });
      fs.rmSync(`${restorePath}-wal`, { force: true });
    }
    throw error;
  }
}

module.exports = {
  BACKUP_VERIFICATION_SCHEMA,
  RESTORE_REHEARSAL_SCHEMA,
  inspectRestoredDatabase,
  rehearseSqliteRestore,
};

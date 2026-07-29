"use strict";

/**
 * Verified SQLite database backup.
 *
 * The source database can be in WAL mode and actively serving requests, so a
 * raw filesystem copy is not a safe snapshot. This module uses
 * better-sqlite3's online backup API against the live database handle, hashes
 * the completed snapshot, reopens it read-only and verifies it before the
 * backup is considered successful.
 *
 * Local proof is mandatory. Optional S3 replication happens only after the
 * verified local database and its machine-readable evidence sidecar exist.
 */

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");
const Database = require("better-sqlite3");

const { DB_PATH } = require("./db");

const BACKUP_DIR = path.join(path.dirname(DB_PATH), "backups");
const MAX_LOCAL_BACKUPS = 7;
const VERIFICATION_SCHEMA_VERSION = "pulse-sqlite-backup-verification-v1";
const BACKUP_METHOD = "better-sqlite3-online-backup";

function logWith(logger, message) {
  if (typeof logger === "function") {
    logger(message);
    return;
  }
  if (logger && typeof logger.log === "function") {
    logger.log(message);
  }
}

function clockValue(clock) {
  const value = typeof clock === "function" ? clock() : clock;
  const date = value == null ? new Date() : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("backup clock must return a valid date");
  }
  return date;
}

function backupTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function firstColumnValue(row) {
  if (!row || typeof row !== "object") return "";
  const [value] = Object.values(row);
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function verificationError(message, verification, cause) {
  const error = new Error(message);
  error.code = "SQLITE_BACKUP_VERIFICATION_FAILED";
  error.verification = verification;
  if (cause) error.cause = cause;
  return error;
}

/**
 * Open and inspect a completed SQLite backup without permitting writes.
 *
 * Returns only when all three SQLite checks pass. On failure the thrown error
 * carries a machine-readable `verification` property.
 */
function verifyBackupDatabase(backupPath, { DatabaseImpl = Database } = {}) {
  const verification = {
    openedReadOnly: false,
    quick_check: "not_run",
    integrity_check: "not_run",
    foreign_key_check: "not_run",
    foreign_key_violation_count: null,
  };

  let verifier;
  try {
    verifier = new DatabaseImpl(backupPath, {
      fileMustExist: true,
      readonly: true,
    });
    verification.openedReadOnly = true;
  } catch (cause) {
    throw verificationError(
      "SQLite backup could not be reopened read-only",
      verification,
      cause,
    );
  }

  let firstFailure = null;
  try {
    try {
      const rows = verifier.prepare("PRAGMA quick_check").all();
      verification.quick_check =
        rows.length === 1 && firstColumnValue(rows[0]) === "ok"
          ? "ok"
          : "failed";
    } catch (error) {
      verification.quick_check = "error";
      firstFailure ||= error;
    }

    try {
      const rows = verifier.prepare("PRAGMA integrity_check").all();
      verification.integrity_check =
        rows.length === 1 && firstColumnValue(rows[0]) === "ok"
          ? "ok"
          : "failed";
    } catch (error) {
      verification.integrity_check = "error";
      firstFailure ||= error;
    }

    try {
      const rows = verifier.prepare("PRAGMA foreign_key_check").all();
      verification.foreign_key_violation_count = rows.length;
      verification.foreign_key_check = rows.length === 0 ? "ok" : "failed";
    } catch (error) {
      verification.foreign_key_check = "error";
      firstFailure ||= error;
    }
  } finally {
    verifier.close();
  }

  if (
    verification.quick_check !== "ok" ||
    verification.integrity_check !== "ok" ||
    verification.foreign_key_check !== "ok"
  ) {
    throw verificationError(
      "SQLite backup failed integrity verification",
      verification,
      firstFailure,
    );
  }

  return verification;
}

async function sha256File(filepath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filepath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function writeEvidenceAtomic(evidencePath, evidence) {
  const temporaryPath = `${evidencePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeJson(temporaryPath, evidence, { spaces: 2 });
    await fs.move(temporaryPath, evidencePath, { overwrite: true });
  } finally {
    await fs.remove(temporaryPath);
  }
}

async function removeBackupFiles(backupPath, evidencePath) {
  await Promise.all([
    fs.remove(backupPath),
    fs.remove(`${backupPath}-shm`),
    fs.remove(`${backupPath}-wal`),
    fs.remove(evidencePath),
  ]);
}

async function pruneLocalBackups({
  backupDir,
  currentFilename,
  logger,
  maxLocalBackups,
}) {
  const filenames = (await fs.readdir(backupDir)).filter(
    (filename) => filename.startsWith("pulse_") && filename.endsWith(".db"),
  );
  const backups = await Promise.all(
    filenames.map(async (filename) => {
      const stat = await fs.stat(path.join(backupDir, filename));
      return { filename, mtimeMs: stat.mtimeMs };
    }),
  );

  backups.sort((left, right) => {
    if (left.filename === currentFilename) return -1;
    if (right.filename === currentFilename) return 1;
    return (
      right.mtimeMs - left.mtimeMs ||
      right.filename.localeCompare(left.filename)
    );
  });

  const pruned = [];
  for (const { filename } of backups.slice(maxLocalBackups)) {
    const filepath = path.join(backupDir, filename);
    await removeBackupFiles(filepath, `${filepath}.verification.json`);
    pruned.push(filename);
    logWith(logger, `[db-backup] Pruned old backup: ${filename}`);
  }
  return pruned;
}

function s3Configuration(env) {
  const configured = Boolean(
    env.AWS_S3_BUCKET && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY,
  );
  return {
    attempted: false,
    configured,
    key: null,
    status: configured ? "pending" : "not_configured",
  };
}

async function replicateToS3({ backupFilename, backupPath, env, logger }) {
  const result = s3Configuration(env);
  if (!result.configured) return result;

  const key = `pulse-gaming/backups/${backupFilename}`;
  result.attempted = true;
  result.key = key;
  try {
    const { PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
    const s3 = new S3Client({
      region: env.AWS_REGION || "eu-west-2",
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });
    await s3.send(
      new PutObjectCommand({
        Body: await fs.readFile(backupPath),
        Bucket: env.AWS_S3_BUCKET,
        Key: key,
      }),
    );
    result.status = "uploaded";
    logWith(
      logger,
      `[db-backup] S3 upload complete: s3://${env.AWS_S3_BUCKET}/${key}`,
    );
  } catch (error) {
    result.status = "failed";
    result.error = error.message;
    logWith(
      logger,
      `[db-backup] S3 upload failed (non-fatal): ${error.message}`,
    );
  }
  return result;
}

async function backupDatabase(options = {}) {
  const dbPath = path.resolve(options.dbPath || DB_PATH);
  const backupDir = path.resolve(
    options.backupDir || path.join(path.dirname(dbPath), "backups"),
  );
  const env = options.env || process.env;
  const logger = options.logger || console;
  const maxLocalBackups =
    options.maxLocalBackups == null
      ? MAX_LOCAL_BACKUPS
      : options.maxLocalBackups;
  if (!Number.isInteger(maxLocalBackups) || maxLocalBackups < 1) {
    throw new TypeError("maxLocalBackups must be a positive integer");
  }

  logWith(logger, "[db-backup] Starting verified database backup...");
  if (!(await fs.pathExists(dbPath))) {
    logWith(logger, "[db-backup] No database file found, skipping backup");
    return null;
  }

  const startedAt = clockValue(options.now);
  const backup_id = `pulse_${backupTimestamp(startedAt)}`;
  const backupFilename = `${backup_id}.db`;
  const backupPath = path.join(backupDir, backupFilename);
  const evidencePath = `${backupPath}.verification.json`;
  await fs.ensureDir(backupDir);

  const liveDb = options.dbHandle || options.db || require("./db").getDb();
  if (!liveDb || typeof liveDb.backup !== "function") {
    throw new TypeError(
      "A live better-sqlite3 handle with backup() is required",
    );
  }

  let sizeBytes = null;
  let sha256 = null;
  let verification = null;
  let stage = "online_backup";
  try {
    await liveDb.backup(backupPath);
    stage = "hash";
    sizeBytes = (await fs.stat(backupPath)).size;
    sha256 = await sha256File(backupPath);
    stage = "verification";
    verification = verifyBackupDatabase(backupPath, {
      DatabaseImpl: options.DatabaseImpl || Database,
    });
  } catch (cause) {
    await removeBackupFiles(backupPath, evidencePath);
    if (stage === "verification") {
      const error = verificationError(
        `SQLite local backup verification failed: ${cause.message}`,
        cause.verification,
        cause,
      );
      error.verificationEvidence = {
        backup_id,
        backupPath,
        createdAt: startedAt.toISOString(),
        evidencePath,
        method: BACKUP_METHOD,
        schemaVersion: VERIFICATION_SCHEMA_VERSION,
        sha256,
        sizeBytes,
        sourcePath: dbPath,
        verification: cause.verification,
        verified: false,
        verifiedAt: null,
      };
      throw error;
    }

    const error = new Error(
      `SQLite online backup failed during ${stage}: ${cause.message}`,
    );
    error.code = "SQLITE_BACKUP_FAILED";
    error.cause = cause;
    throw error;
  }

  const report = {
    backup_id,
    backupPath,
    createdAt: startedAt.toISOString(),
    evidencePath,
    method: BACKUP_METHOD,
    mutationPerformed: true,
    prunedBackups: [],
    schemaVersion: VERIFICATION_SCHEMA_VERSION,
    sha256,
    sizeBytes,
    sourcePath: dbPath,
    s3: s3Configuration(env),
    verification,
    verified: true,
    verifiedAt: startedAt.toISOString(),
  };

  stage = "evidence";
  try {
    await writeEvidenceAtomic(evidencePath, report);
  } catch (cause) {
    await removeBackupFiles(backupPath, evidencePath);
    const error = new Error(
      `SQLite backup evidence could not be written: ${cause.message}`,
    );
    error.code = "SQLITE_BACKUP_EVIDENCE_WRITE_FAILED";
    error.cause = cause;
    throw error;
  }

  logWith(
    logger,
    `[db-backup] Verified local backup: ${backupPath} (${Math.round(
      sizeBytes / 1024,
    )}KB, sha256=${sha256})`,
  );

  try {
    report.prunedBackups = await pruneLocalBackups({
      backupDir,
      currentFilename: backupFilename,
      logger,
      maxLocalBackups,
    });
  } catch (error) {
    report.pruneError = error.message;
    logWith(
      logger,
      `[db-backup] Local prune failed (non-fatal): ${error.message}`,
    );
  }

  report.s3 = await replicateToS3({
    backupFilename,
    backupPath,
    env,
    logger,
  });

  // Refresh the sidecar with non-fatal prune/S3 outcomes. If this best-effort
  // refresh fails, the earlier mandatory local verification evidence remains.
  try {
    await writeEvidenceAtomic(evidencePath, report);
  } catch (error) {
    logWith(
      logger,
      `[db-backup] Evidence status refresh failed (non-fatal): ${error.message}`,
    );
  }

  logWith(logger, "[db-backup] Backup complete and locally verified");
  return report;
}

module.exports = {
  BACKUP_DIR,
  MAX_LOCAL_BACKUPS,
  backupDatabase,
  sha256File,
  verifyBackupDatabase,
};

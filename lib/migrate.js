/**
 * Versioned migration runner.
 *
 * Reads every `db/migrations/NNN_*.sql` file in filename order, checks which
 * have already been applied (tracked in the schema_migrations table), and
 * applies the missing ones in a single transaction per migration.
 *
 * Why a versioned runner rather than the old initSchema() approach:
 *  - `initSchema()` in db.js only runs on fresh DBs; adding a column
 *    silently does nothing on existing installs.
 *  - Schema evolution in the V4 brief touches ~10 distinct tables (stories,
 *    jobs, platform_posts, idempotency_keys, workers, audio_packs, roundups,
 *    scoring, repurposing, channels). One "add column then hope" file gets
 *    unmanageable fast.
 *
 * Contract with each migration file:
 *  - Filename is `NNN_description.sql` where NNN is a 3-digit integer.
 *  - File contains one or more SQL statements terminated by `;`.
 *  - The file is applied inside a transaction; if any statement throws, the
 *    whole migration rolls back and the runner aborts.
 *  - Once applied, a row is inserted into schema_migrations with the NNN
 *    version and a SHA-256 checksum of the file contents. If the checksum
 *    of a previously-applied file ever changes, the runner aborts with a
 *    loud error — migrations are immutable once shipped.
 *
 * Usage:
 *   const { runMigrations } = require('./lib/migrate');
 *   runMigrations(db);
 *
 * CLI:
 *   node lib/migrate.js           // applies pending migrations
 *   node lib/migrate.js --status  // prints applied/pending table
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MIGRATIONS_DIR = path.join(__dirname, "..", "db", "migrations");
const GOVERNANCE_BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
}

function fileChecksum(filepath) {
  const body = fs.readFileSync(filepath, "utf8");
  return crypto.createHash("sha256").update(body).digest("hex");
}

function versionOf(filename) {
  return filename.slice(0, 3);
}

function governanceMigrationApproval(
  env = process.env,
  { now = new Date(), migrationVersion = "020" } = {},
) {
  const mode = String(
    env.PULSE_OPERATING_MODE ||
      env.PULSE_RUNTIME_MODE ||
      env.OPERATING_MODE ||
      "LOCAL_PROOF",
  )
    .trim()
    .toUpperCase();
  const controlled =
    String(env.NODE_ENV || "").trim().toLowerCase() === "production" ||
    !!env.RAILWAY_ENVIRONMENT ||
    !!env.RAILWAY_PUBLIC_URL ||
    !!env.RENDER ||
    !!env.RENDER_EXTERNAL_URL ||
    mode !== "LOCAL_PROOF";
  if (!controlled) {
    return {
      approved: true,
      blockers: [],
      controlled: false,
      evidence: null,
      operating_mode: mode,
    };
  }

  const effectiveNow = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(effectiveNow.getTime())) {
    throw new Error("invalid_migration_evaluation_time");
  }
  const evidencePrefix = `PULSE_MIGRATION_${migrationVersion}`;
  const approvalId = String(env[`${evidencePrefix}_APPROVAL_ID`] || "").trim();
  const approvedBy = String(env[`${evidencePrefix}_APPROVED_BY`] || "").trim();
  const backupId = String(env[`${evidencePrefix}_BACKUP_ID`] || "").trim();
  const backupSha256 = String(
    env[`${evidencePrefix}_BACKUP_SHA256`] || "",
  ).trim();
  const backupVerifiedAt = new Date(
    env[`${evidencePrefix}_BACKUP_VERIFIED_AT`] || "",
  );
  const blockers = [];
  if (env[`${evidencePrefix}_APPROVED`] !== "true") {
    blockers.push("explicit_approval_required");
  }
  if (!approvalId) blockers.push("approval_id_required");
  if (!approvedBy) blockers.push("approver_identity_required");
  if (!backupId) blockers.push("backup_id_required");
  if (!/^[a-f0-9]{64}$/i.test(backupSha256)) {
    blockers.push("backup_sha256_required");
  }
  if (Number.isNaN(backupVerifiedAt.getTime())) {
    blockers.push("backup_verification_time_required");
  } else {
    const backupAgeMs =
      effectiveNow.getTime() - backupVerifiedAt.getTime();
    if (backupAgeMs < 0) blockers.push("backup_verification_time_in_future");
    if (backupAgeMs > GOVERNANCE_BACKUP_MAX_AGE_MS) {
      blockers.push("backup_verification_stale");
    }
  }

  return {
    approved: blockers.length === 0,
    blockers,
    controlled: true,
    evidence: {
      approval_id: approvalId,
      approved_by: approvedBy,
      backup_id: backupId,
      backup_sha256: backupSha256,
      backup_verified_at: Number.isNaN(backupVerifiedAt.getTime())
        ? null
        : backupVerifiedAt.toISOString(),
    },
    operating_mode: mode,
  };
}

function governanceMigrationApproved(env = process.env, options = {}) {
  return governanceMigrationApproval(env, options).approved;
}

function pragmaResultValue(row) {
  if (!row || typeof row !== "object") return null;
  const [value] = Object.values(row);
  return String(value || "").trim().toLowerCase();
}

function verifyGovernanceMigrationIntegrity(db) {
  const quickRows = db.prepare("PRAGMA quick_check").all();
  const integrityRows = db.prepare("PRAGMA integrity_check").all();
  const foreignKeyRows = db.prepare("PRAGMA foreign_key_check").all();
  const result = {
    quick_check:
      quickRows.length === 1 && pragmaResultValue(quickRows[0]) === "ok"
        ? "ok"
        : "failed",
    integrity_check:
      integrityRows.length === 1 &&
      pragmaResultValue(integrityRows[0]) === "ok"
        ? "ok"
        : "failed",
    foreign_key_check: foreignKeyRows.length === 0 ? "ok" : "failed",
  };
  if (Object.values(result).some((status) => status !== "ok")) {
    throw new Error("post_migration_integrity_verification_failed");
  }
  return result;
}

/**
 * Apply all pending migrations. Returns { applied: [...], skipped: [...] }.
 */
function runMigrations(
  db,
  {
    log = console.log,
    env = process.env,
    now = new Date(),
    governanceIntegrityVerifier = verifyGovernanceMigrationIntegrity,
  } = {},
) {
  ensureMigrationsTable(db);

  const applied = db
    .prepare("SELECT version, filename, checksum FROM schema_migrations")
    .all();
  const appliedMap = new Map(applied.map((r) => [r.version, r]));

  const files = listMigrationFiles();
  const result = { applied: [], skipped: [] };

  for (const filename of files) {
    const version = versionOf(filename);
    const filepath = path.join(MIGRATIONS_DIR, filename);
    const checksum = fileChecksum(filepath);

    const existing = appliedMap.get(version);
    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(
          `[migrate] checksum mismatch for ${filename}: applied version ` +
            `was ${existing.checksum.slice(0, 12)}..., now ${checksum.slice(0, 12)}.... ` +
            `Migrations are immutable once shipped — create a new NNN file instead.`,
        );
      }
      result.skipped.push(filename);
      continue;
    }

    const governanceApproval = [
      "020_stabilisation_governance.sql",
      "024_publication_authority_audit.sql",
      "025_green_autopilot_runtime_control.sql",
    ].includes(filename)
      ? governanceMigrationApproval(env, {
          now,
          migrationVersion: version,
        })
      : null;
    if (governanceApproval && !governanceApproval.approved) {
      throw new Error(
        `[migrate] migration ${version} requires explicit approval and verified backup evidence`,
      );
    }

    const sql = fs.readFileSync(filepath, "utf8");
    log(`[migrate] applying ${filename}`);

    const apply = db.transaction(() => {
      db.exec(sql);
      if (governanceApproval) {
        const postMigrationChecks = governanceIntegrityVerifier(db);
        if (governanceApproval.controlled) {
          const evidence = governanceApproval.evidence;
          db.prepare(
            `INSERT INTO operator_audit_log
               (actor_id, action, target_type, target_id, decision, reason,
                evidence_json)
             VALUES (?, 'apply_schema_migration', 'schema_migration', ?,
                     'APPROVED_AND_VERIFIED', ?, ?)`,
          ).run(
            evidence.approved_by,
            version,
            evidence.approval_id,
            JSON.stringify({
              approval_id: evidence.approval_id,
              backup_id: evidence.backup_id,
              backup_sha256: evidence.backup_sha256,
              backup_verified_at: evidence.backup_verified_at,
              migration_checksum: checksum,
              migration_filename: filename,
              post_migration_checks: postMigrationChecks,
            }),
          );
        }
      }
      db.prepare(
        `INSERT INTO schema_migrations (version, filename, checksum, applied_at)
         VALUES (?, ?, ?, datetime('now'))`,
      ).run(version, filename, checksum);
    });
    apply();

    result.applied.push(filename);
  }

  return result;
}

/**
 * Print status without applying anything.
 */
function status(db) {
  const migrationTable = db
    .prepare(
      `SELECT 1
       FROM sqlite_master
       WHERE type = 'table' AND name = 'schema_migrations'
       LIMIT 1`,
    )
    .get();
  const applied = migrationTable
    ? new Set(
        db
          .prepare("SELECT version FROM schema_migrations")
          .all()
          .map((r) => r.version),
      )
    : new Set();
  const files = listMigrationFiles();
  return files.map((f) => ({
    filename: f,
    version: versionOf(f),
    status: applied.has(versionOf(f)) ? "applied" : "pending",
  }));
}

function resolveStatusDatabasePath({
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const configured = String(env.SQLITE_DB_PATH || "").trim();
  if (!configured) {
    return path.join(__dirname, "..", "data", "pulse.db");
  }
  if (path.isAbsolute(configured) || path.win32.isAbsolute(configured)) {
    return configured;
  }
  return path.resolve(cwd, configured);
}

function readMigrationStatus({
  databasePath = resolveStatusDatabasePath(),
  DatabaseImpl,
} = {}) {
  const Database = DatabaseImpl || require("better-sqlite3");
  const db = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    db.pragma("query_only = ON");
    return status(db);
  } finally {
    db.close();
  }
}

module.exports = {
  GOVERNANCE_BACKUP_MAX_AGE_MS,
  governanceMigrationApproval,
  governanceMigrationApproved,
  verifyGovernanceMigrationIntegrity,
  runMigrations,
  status,
  readMigrationStatus,
  resolveStatusDatabasePath,
  listMigrationFiles,
};

// CLI entrypoint
if (require.main === module) {
  const arg = process.argv[2];
  if (arg === "--status" || arg === "status") {
    try {
      const rows = readMigrationStatus();
      if (!rows.length) {
        console.log("[migrate] no migration files found");
        process.exit(0);
      }
      console.log("version  status    filename");
      console.log("-------  --------  ----------------------------------------");
      for (const r of rows) {
        console.log(`${r.version}      ${r.status.padEnd(8)}  ${r.filename}`);
      }
      process.exit(0);
    } catch (err) {
      console.error(`[migrate] status failed: ${err.message}`);
      process.exit(1);
    }
  }

  process.env.USE_SQLITE = "true";
  const db = require("./db").getDb();

  try {
    const result = runMigrations(db);
    console.log(
      `[migrate] done. applied=${result.applied.length} skipped=${result.skipped.length}`,
    );
    if (result.applied.length) {
      console.log(`[migrate] applied: ${result.applied.join(", ")}`);
    }
    process.exit(0);
  } catch (err) {
    console.error(`[migrate] FATAL: ${err.message}`);
    process.exit(1);
  }
}

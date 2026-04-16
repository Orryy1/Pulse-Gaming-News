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

/**
 * Apply all pending migrations. Returns { applied: [...], skipped: [...] }.
 */
function runMigrations(db, { log = console.log } = {}) {
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

    const sql = fs.readFileSync(filepath, "utf8");
    log(`[migrate] applying ${filename}`);

    const apply = db.transaction(() => {
      db.exec(sql);
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
  ensureMigrationsTable(db);
  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((r) => r.version),
  );
  const files = listMigrationFiles();
  return files.map((f) => ({
    filename: f,
    version: versionOf(f),
    status: applied.has(versionOf(f)) ? "applied" : "pending",
  }));
}

module.exports = { runMigrations, status, listMigrationFiles };

// CLI entrypoint
if (require.main === module) {
  process.env.USE_SQLITE = "true";
  const db = require("./db").getDb();

  const arg = process.argv[2];
  if (arg === "--status" || arg === "status") {
    const rows = status(db);
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
  }

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

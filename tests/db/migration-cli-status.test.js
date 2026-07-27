"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATE_CLI = path.join(ROOT, "lib", "migrate.js");

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

test("migration status CLI is read-only and cannot apply pending migrations", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-migration-status-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const databasePath = path.join(directory, "pulse.db");
  const setup = new Database(databasePath);
  setup.exec(
    "CREATE TABLE fixture_marker (id INTEGER PRIMARY KEY, value TEXT NOT NULL);",
  );
  setup
    .prepare("INSERT INTO fixture_marker (id, value) VALUES (1, 'untouched')")
    .run();
  setup.close();

  const beforeHash = sha256(databasePath);
  const result = spawnSync(process.execPath, [MIGRATE_CLI, "status"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "",
      RAILWAY_ENVIRONMENT: "",
      RAILWAY_PUBLIC_URL: "",
      RENDER: "",
      RENDER_EXTERNAL_URL: "",
      PULSE_OPERATING_MODE: "LOCAL_PROOF",
      SQLITE_DB_PATH: databasePath,
      USE_SQLITE: "true",
    },
  });

  assert.equal(
    result.status,
    0,
    `status failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(result.stdout, /001\s+pending\s+001_stories_core\.sql/);
  assert.equal(sha256(databasePath), beforeHash);

  const verifier = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const migrationTable = verifier
      .prepare(
        `SELECT COUNT(*) AS count
         FROM sqlite_master
         WHERE type = 'table' AND name = 'schema_migrations'`,
      )
      .get();
    assert.equal(migrationTable.count, 0);
    assert.deepEqual(
      verifier.prepare("SELECT id, value FROM fixture_marker").all(),
      [{ id: 1, value: "untouched" }],
    );
  } finally {
    verifier.close();
  }
});

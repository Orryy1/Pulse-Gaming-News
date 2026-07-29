"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { bindRepositories } = require("../../lib/repositories");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");

function migratedDatabase() {
  const db = new Database(":memory:");
  for (const filename of fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS, filename), "utf8"));
  }
  return db;
}

test("repository registry exposes controlled experiments and read-only analytics snapshots", () => {
  const db = migratedDatabase();

  const repositories = bindRepositories(db);

  assert.equal(
    typeof repositories.controlledExperiments.ensureExperiment,
    "function",
  );
  assert.equal(
    typeof repositories.controlledExperiments.assignNextVideo,
    "function",
  );
  assert.equal(
    typeof repositories.youtubeAnalyticsExperimentSnapshots.recordSnapshot,
    "function",
  );
  assert.equal(
    typeof repositories.youtubeAnalyticsExperimentSnapshots.getSnapshot,
    "function",
  );
  assert.equal(repositories.db, db);
  db.close();
});

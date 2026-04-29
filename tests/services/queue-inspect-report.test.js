"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { inspectQueue, renderQueueInspectMarkdown } = require("../../lib/ops/queue-inspect");

function createQueueInspectDb(scheduleSql) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT,
      status TEXT,
      priority INTEGER,
      attempt_count INTEGER,
      max_attempts INTEGER,
      run_at TEXT,
      claimed_by TEXT,
      claimed_at TEXT,
      lease_until TEXT,
      last_error TEXT,
      updated_at TEXT
    );

    ${scheduleSql}

    CREATE TABLE workers (
      id TEXT PRIMARY KEY,
      status TEXT,
      last_seen_at TEXT,
      last_job_id INTEGER,
      tags TEXT,
      version TEXT
    );
  `);
  return db;
}

test("queue inspect markdown explains USE_SQLITE skip states", () => {
  const md = renderQueueInspectMarkdown({
    generatedAt: "2026-04-28T00:00:00.000Z",
    verdict: "skip",
    reason: "USE_SQLITE_not_enabled",
  });

  assert.match(md, /Reason: USE_SQLITE_not_enabled/);
  assert.match(md, /USE_SQLITE=true/);
  assert.match(md, /SQLITE_DB_PATH/);
  assert.match(md, /- unavailable/);
});

test("queue inspect markdown explains unavailable SQLite skip states", () => {
  const md = renderQueueInspectMarkdown({
    generatedAt: "2026-04-28T00:00:00.000Z",
    verdict: "skip",
    reason: "sqlite_unavailable",
  });

  assert.match(md, /Reason: sqlite_unavailable/);
  assert.match(md, /SQLite queue database is mounted and readable/);
});

test("queue inspect markdown explains missing SQLite files", () => {
  const md = renderQueueInspectMarkdown({
    generatedAt: "2026-04-28T00:00:00.000Z",
    verdict: "skip",
    reason: "sqlite_db_missing",
    dbPath: "C:\\data\\pulse.db",
  });

  assert.match(md, /Reason: sqlite_db_missing/);
  assert.match(md, /DB path: C:\\data\\pulse\.db/);
  assert.match(md, /does not exist on this machine/);
});

test("queue inspect markdown explains Railway volume paths injected into Windows", () => {
  const md = renderQueueInspectMarkdown({
    generatedAt: "2026-04-28T00:00:00.000Z",
    verdict: "skip",
    reason: "railway_volume_path_not_local",
    dbPath: "/data/pulse.db",
  });

  assert.match(md, /Reason: railway_volume_path_not_local/);
  assert.match(md, /DB path: \/data\/pulse\.db/);
  assert.match(md, /only valid inside the Railway container/);
});

test("queue inspect tolerates legacy schedules table without runtime columns", () => {
  const db = createQueueInspectDb(`
    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      cron_expr TEXT NOT NULL,
      enabled INTEGER DEFAULT 1
    );
    INSERT INTO schedules (name, kind, cron_expr, enabled)
      VALUES ('morning_hunt', 'hunt', '0 6 * * *', 1);
  `);

  try {
    const report = inspectQueue({ db });

    assert.equal(report.verdict, "pass");
    assert.equal(report.schedules.length, 1);
    assert.equal(report.schedules[0].last_run_at, null);
    assert.equal(report.schedules[0].last_enqueued_at, null);
    assert.equal(report.schedules[0].next_run_at, null);
    assert.deepEqual(report.green, ["schedules_registered", "no_active_backlog"]);
  } finally {
    db.close();
  }
});

test("queue inspect preserves modern schedule timing columns when present", () => {
  const db = createQueueInspectDb(`
    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      cron_expr TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_enqueued_at TEXT,
      next_run_at TEXT
    );
    INSERT INTO schedules (name, kind, cron_expr, enabled, last_enqueued_at, next_run_at)
      VALUES ('publish_youtube', 'publish', '0 19 * * *', 1, '2026-04-29 01:00:00', '2026-04-29 19:00:00');
  `);

  try {
    const report = inspectQueue({ db });

    assert.equal(report.verdict, "pass");
    assert.equal(report.schedules[0].last_run_at, null);
    assert.equal(report.schedules[0].last_enqueued_at, "2026-04-29 01:00:00");
    assert.equal(report.schedules[0].next_run_at, "2026-04-29 19:00:00");
  } finally {
    db.close();
  }
});

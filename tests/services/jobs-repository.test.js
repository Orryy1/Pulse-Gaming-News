"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { bind } = require("../../lib/repositories/jobs");

function sqliteTimeToMs(value) {
  assert.equal(typeof value, "string");
  return Date.parse(`${value.replace(" ", "T")}Z`);
}

function createJobsDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      channel_id TEXT,
      story_id TEXT,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER DEFAULT 50,
      run_at TEXT NOT NULL DEFAULT (datetime('now')),
      attempt_count INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      last_error TEXT,
      claimed_by TEXT,
      claimed_at TEXT,
      lease_until TEXT,
      requires_gpu INTEGER DEFAULT 0,
      idempotency_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      worker_id TEXT,
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      duration_ms INTEGER,
      error_message TEXT,
      log_excerpt TEXT
    );
  `);
  return db;
}

test("claim writes a real future lease timestamp", () => {
  const db = createJobsDb();
  try {
    const jobs = bind(db);
    jobs.enqueue({ kind: "publish", priority: 20 });

    const before = Date.now();
    const claimed = jobs.claim("worker-lease-test", { leaseMs: 60_000 });

    assert.equal(claimed.status, "claimed");
    assert.equal(claimed.claimed_by, "worker-lease-test");
    assert.ok(claimed.lease_until, "lease_until must not be NULL");
    assert.ok(
      sqliteTimeToMs(claimed.lease_until) >= before + 50_000,
      `lease_until should be roughly one minute in the future: ${claimed.lease_until}`,
    );
  } finally {
    db.close();
  }
});

test("heartbeat extends a claimed job with a real future lease", () => {
  const db = createJobsDb();
  try {
    const jobs = bind(db);
    jobs.enqueue({ kind: "publish", priority: 20 });
    const claimed = jobs.claim("worker-heartbeat-test", { leaseMs: 5_000 });

    assert.equal(jobs.heartbeat(claimed.id, "worker-heartbeat-test", 120_000), true);
    const refreshed = jobs.get(claimed.id);

    assert.ok(refreshed.lease_until, "heartbeat lease_until must not be NULL");
    assert.ok(
      sqliteTimeToMs(refreshed.lease_until) >= Date.now() + 110_000,
      `heartbeat should extend lease by about two minutes: ${refreshed.lease_until}`,
    );
  } finally {
    db.close();
  }
});

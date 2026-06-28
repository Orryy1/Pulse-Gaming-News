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

test("claim skips pending jobs that already exhausted max attempts", () => {
  const db = createJobsDb();
  try {
    const jobs = bind(db);
    const exhausted = jobs.enqueue({
      kind: "publish",
      priority: 1,
      max_attempts: 1,
    });
    db.prepare(`UPDATE jobs SET attempt_count = max_attempts WHERE id = ?`).run(
      exhausted.id,
    );
    const fresh = jobs.enqueue({
      kind: "publish",
      priority: 20,
      max_attempts: 3,
    });

    const claimed = jobs.claim("worker-exhaustion-test", { leaseMs: 60_000 });

    assert.equal(claimed.id, fresh.id);
    assert.equal(claimed.attempt_count, 1);
    assert.equal(jobs.get(exhausted.id).attempt_count, 1);
  } finally {
    db.close();
  }
});

test("reapStaleClaims fails stale claimed jobs that exhausted max attempts", () => {
  const db = createJobsDb();
  try {
    const jobs = bind(db);
    const queued = jobs.enqueue({
      kind: "publish",
      priority: 1,
      max_attempts: 1,
    });
    const claimed = jobs.claim("worker-stale-exhausted-test", {
      leaseMs: 60_000,
    });
    assert.equal(claimed.id, queued.id);
    db.prepare(
      `UPDATE jobs
       SET status = 'running',
           lease_until = datetime('now', '-1 minute')
       WHERE id = ?`,
    ).run(claimed.id);

    const changed = jobs.reapStaleClaims();

    assert.equal(changed, 1);
    const reaped = jobs.get(claimed.id);
    assert.equal(reaped.status, "failed");
    assert.equal(reaped.claimed_by, null);
    assert.equal(reaped.lease_until, null);
    assert.match(reaped.last_error, /exceeded max attempts/);
    assert.ok(reaped.completed_at);

    const run = db
      .prepare(`SELECT * FROM job_runs WHERE job_id = ?`)
      .get(claimed.id);
    assert.equal(run.status, "failed");
    assert.ok(run.finished_at);
    assert.match(run.error_message, /exceeded max attempts/);
  } finally {
    db.close();
  }
});

test("reapStaleClaims recycles retryable stale claims and closes the stale run", () => {
  const db = createJobsDb();
  try {
    const jobs = bind(db);
    const queued = jobs.enqueue({
      kind: "publish",
      priority: 1,
      max_attempts: 2,
    });
    const claimed = jobs.claim("worker-stale-retry-test", {
      leaseMs: 60_000,
    });
    assert.equal(claimed.id, queued.id);
    db.prepare(
      `UPDATE jobs
       SET status = 'running',
           lease_until = datetime('now', '-1 minute')
       WHERE id = ?`,
    ).run(claimed.id);

    const changed = jobs.reapStaleClaims();

    assert.equal(changed, 1);
    const reaped = jobs.get(claimed.id);
    assert.equal(reaped.status, "pending");
    assert.equal(reaped.claimed_by, null);
    assert.equal(reaped.lease_until, null);
    assert.equal(reaped.attempt_count, 1);

    const run = db
      .prepare(`SELECT * FROM job_runs WHERE job_id = ?`)
      .get(claimed.id);
    assert.equal(run.status, "failed");
    assert.ok(run.finished_at);
    assert.match(run.error_message, /stale claim/);
  } finally {
    db.close();
  }
});

test("complete closes superseded open runs for the same job", () => {
  const db = createJobsDb();
  try {
    const jobs = bind(db);
    const queued = jobs.enqueue({
      kind: "publish",
      priority: 1,
      max_attempts: 3,
    });
    const first = jobs.claim("worker-complete-superseded-1", {
      leaseMs: 60_000,
    });
    assert.equal(first.id, queued.id);
    db.prepare(
      `UPDATE jobs
       SET status = 'pending',
           claimed_by = NULL,
           claimed_at = NULL,
           lease_until = NULL
       WHERE id = ?`,
    ).run(first.id);
    const second = jobs.claim("worker-complete-superseded-2", {
      leaseMs: 60_000,
    });
    assert.equal(second.id, queued.id);

    jobs.complete(second.id, { log: "ok" });

    const runs = db
      .prepare(`SELECT * FROM job_runs WHERE job_id = ? ORDER BY id`)
      .all(second.id);
    assert.equal(runs.length, 2);
    assert.equal(runs[0].status, "failed");
    assert.match(runs[0].error_message, /superseded.*completed/);
    assert.ok(runs[0].finished_at);
    assert.equal(runs[1].status, "done");
    assert.equal(runs[1].error_message, null);
    assert.ok(runs[1].finished_at);
  } finally {
    db.close();
  }
});

test("fail closes all open runs for the same job", () => {
  const db = createJobsDb();
  try {
    const jobs = bind(db);
    const queued = jobs.enqueue({
      kind: "publish",
      priority: 1,
      max_attempts: 3,
    });
    const first = jobs.claim("worker-fail-superseded-1", {
      leaseMs: 60_000,
    });
    assert.equal(first.id, queued.id);
    db.prepare(
      `UPDATE jobs
       SET status = 'pending',
           claimed_by = NULL,
           claimed_at = NULL,
           lease_until = NULL
       WHERE id = ?`,
    ).run(first.id);
    const second = jobs.claim("worker-fail-superseded-2", {
      leaseMs: 60_000,
    });
    assert.equal(second.id, queued.id);

    jobs.fail(second.id, new Error("publish exploded"), { log: "stack" });

    const runs = db
      .prepare(`SELECT * FROM job_runs WHERE job_id = ? ORDER BY id`)
      .all(second.id);
    assert.equal(runs.length, 2);
    assert.equal(runs[0].status, "failed");
    assert.match(runs[0].error_message, /superseded.*failed/);
    assert.ok(runs[0].finished_at);
    assert.equal(runs[1].status, "failed");
    assert.match(runs[1].error_message, /publish exploded/);
    assert.ok(runs[1].finished_at);
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM job_runs WHERE job_id = ? AND finished_at IS NULL`,
        )
        .get(second.id).count,
      0,
    );
  } finally {
    db.close();
  }
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

const {
  buildQueueReport,
  inspectQueue,
  redactJobError,
  renderQueueInspectMarkdown,
} = require("../../lib/ops/queue-inspect");

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

test("buildQueueReport returns a structured skip when SQLite is disabled", async () => {
  const report = await buildQueueReport({
    dbModule: {
      useSqlite() {
        return false;
      },
    },
  });

  assert.equal(report.verdict, "skip");
  assert.equal(report.reason, "USE_SQLITE_not_enabled");
});

test("buildQueueReport opens the configured SQLite database read-only", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-queue-inspect-"));
  const dbPath = path.join(dir, "pulse.db");
  const db = new Database(dbPath);
  try {
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

      CREATE TABLE schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        cron_expr TEXT NOT NULL,
        enabled INTEGER DEFAULT 1
      );
      INSERT INTO schedules (name, kind, cron_expr, enabled)
        VALUES ('publish_youtube', 'publish', '0 19 * * *', 1);

      CREATE TABLE workers (
        id TEXT PRIMARY KEY,
        status TEXT,
        last_seen_at TEXT,
        last_job_id INTEGER,
        tags TEXT,
        version TEXT
      );
    `);
  } finally {
    db.close();
  }

  try {
    const report = await buildQueueReport({
      dbModule: {
        DB_PATH: dbPath,
        useSqlite() {
          return true;
        },
      },
    });

    assert.equal(report.verdict, "pass");
    assert.equal(report.readOnly, true);
    assert.equal(report.dbPath, dbPath);
    assert.equal(report.green.includes("schedules_registered"), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("queue inspect redacts token-shaped failed job errors in JSON and Markdown", () => {
  const db = createQueueInspectDb(`
    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      cron_expr TEXT NOT NULL,
      enabled INTEGER DEFAULT 1
    );
    INSERT INTO schedules (name, kind, cron_expr, enabled)
      VALUES ('publish_youtube', 'publish', '0 19 * * *', 1);
  `);

  try {
    const now = Date.parse("2026-04-29T13:00:00.000Z");
    db.prepare(
      `INSERT INTO jobs
        (kind, status, priority, attempt_count, max_attempts, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "publish",
      "failed",
      50,
      3,
      3,
      "Graph failed Bearer abc.def.ghi access_token=supersecret",
      "2026-04-29T12:00:00.000Z",
    );

    const report = inspectQueue({ db, now });
    assert.equal(report.verdict, "review");
    assert.equal(report.recentFailedJobs.length, 1);
    assert.doesNotMatch(report.failedJobs[0].last_error, /abc\.def\.ghi/);
    assert.doesNotMatch(report.failedJobs[0].last_error, /supersecret/);
    assert.match(report.failedJobs[0].last_error, /\[REDACTED\]/);
    assert.doesNotMatch(report.recentJobs[0].last_error, /abc\.def\.ghi/);

    const md = renderQueueInspectMarkdown(report);
    assert.doesNotMatch(md, /abc\.def\.ghi/);
    assert.doesNotMatch(md, /supersecret/);
    assert.match(md, /\[REDACTED\]/);
  } finally {
    db.close();
  }
});

test("queue inspect treats old failed jobs as historical audit noise, not active queue failure", () => {
  const db = createQueueInspectDb(`
    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      cron_expr TEXT NOT NULL,
      enabled INTEGER DEFAULT 1
    );
    INSERT INTO schedules (name, kind, cron_expr, enabled)
      VALUES ('publish_youtube', 'publish', '0 19 * * *', 1);
  `);

  try {
    db.prepare(
      `INSERT INTO jobs
        (kind, status, priority, attempt_count, max_attempts, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "publish",
      "failed",
      50,
      3,
      3,
      "old fixed failure",
      "2026-04-28T12:00:00.000Z",
    );

    const report = inspectQueue({
      db,
      now: Date.parse("2026-04-30T13:00:00.000Z"),
      recentFailedWindowHours: 24,
    });

    assert.equal(report.verdict, "pass");
    assert.equal(report.recentFailedJobs.length, 0);
    assert.equal(report.historicalFailedJobs.length, 1);
    assert.ok(report.green.includes("historical_failed_jobs_tracked"));
    assert.ok(report.green.includes("no_active_backlog"));

    const md = renderQueueInspectMarkdown(report);
    assert.match(md, /Historical Failed Jobs/);
    assert.match(md, /do not make the queue unhealthy unless they are recent/);
  } finally {
    db.close();
  }
});

test("queue inspect warns when content runway jobs are saturated behind busy fresh workers", () => {
  const db = createQueueInspectDb(`
    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      cron_expr TEXT NOT NULL,
      enabled INTEGER DEFAULT 1
    );
    INSERT INTO schedules (name, kind, cron_expr, enabled)
      VALUES ('candidate_supply_monitor', 'candidate_supply_monitor', '5 * * * *', 1);
  `);

  try {
    db.prepare(
      `INSERT INTO jobs
        (kind, status, priority, attempt_count, max_attempts, run_at, claimed_by, claimed_at, lease_until, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "candidate_supply_monitor",
      "running",
      64,
      1,
      3,
      "2026-07-01T03:00:00.000Z",
      "content-worker-1",
      "2026-07-01T03:20:00.000Z",
      "2026-07-01T03:50:00.000Z",
      "2026-07-01T03:20:00.000Z",
    );
    db.prepare(
      `INSERT INTO jobs
        (kind, status, priority, attempt_count, max_attempts, run_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "fresh_production_refill",
      "pending",
      67,
      0,
      3,
      "2026-07-01T03:05:00.000Z",
      "2026-07-01T03:05:00.000Z",
    );
    db.prepare(
      `INSERT INTO workers
        (id, status, last_seen_at, last_job_id, tags, version)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "content-worker-1",
      "busy",
      "2026-07-01T03:24:00.000Z",
      1,
      JSON.stringify(["cpu", "candidate_supply_monitor", "fresh_production_refill"]),
      "dev",
    );

    const report = inspectQueue({
      db,
      now: Date.parse("2026-07-01T03:25:00.000Z"),
    });

    assert.equal(report.verdict, "review");
    assert.equal(report.contentRunway.pending_count, 1);
    assert.equal(report.contentRunway.running_count, 1);
    assert.equal(report.contentRunway.active_fresh_worker_count, 1);
    assert.equal(report.contentRunway.saturated, true);
    assert.ok(report.warnings.includes("content_runway_worker_capacity_saturated"));

    const md = renderQueueInspectMarkdown(report);
    assert.match(md, /Content Runway/);
    assert.match(md, /Saturated: yes/);
  } finally {
    db.close();
  }
});

test("queue inspect treats SQLite UTC heartbeat timestamps as fresh worker evidence", () => {
  const db = createQueueInspectDb(`
    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      cron_expr TEXT NOT NULL,
      enabled INTEGER DEFAULT 1
    );
    INSERT INTO schedules (name, kind, cron_expr, enabled)
      VALUES ('candidate_supply_monitor', 'candidate_supply_monitor', '5 * * * *', 1);
  `);

  try {
    db.prepare(
      `INSERT INTO jobs
        (kind, status, priority, attempt_count, max_attempts, run_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "candidate_supply_monitor",
      "pending",
      64,
      0,
      3,
      "2026-07-01 08:05:00",
      "2026-07-01 08:05:00",
    );
    db.prepare(
      `INSERT INTO workers
        (id, status, last_seen_at, last_job_id, tags, version)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "content-worker-utc",
      "idle",
      "2026-07-01 08:16:59",
      null,
      JSON.stringify(["cpu", "produce", "candidate_supply_monitor", "fresh_production_refill"]),
      "dev",
    );

    const report = inspectQueue({
      db,
      now: Date.parse("2026-07-01T08:17:06.000Z"),
    });

    assert.equal(report.contentRunway.pending_count, 1);
    assert.equal(report.contentRunway.active_fresh_worker_count, 1);
    assert.equal(report.contentRunway.no_active_worker, false);
    assert.ok(!report.warnings.includes("content_runway_jobs_pending_without_active_worker"));
    assert.ok(report.green.includes("content_runway_worker_available"));
  } finally {
    db.close();
  }
});

test("queue inspect reports pending runway jobs behind a busy content worker as saturated", () => {
  const db = createQueueInspectDb(`
    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      cron_expr TEXT NOT NULL,
      enabled INTEGER DEFAULT 1
    );
    INSERT INTO schedules (name, kind, cron_expr, enabled)
      VALUES ('candidate_supply_monitor', 'candidate_supply_monitor', '5 * * * *', 1);
  `);

  try {
    db.prepare(
      `INSERT INTO jobs
        (kind, status, priority, attempt_count, max_attempts, run_at, claimed_by, claimed_at, lease_until, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "produce",
      "running",
      30,
      1,
      3,
      "2026-07-01 08:00:00",
      "content-worker-busy",
      "2026-07-01 08:00:01",
      "2026-07-01 08:25:01",
      "2026-07-01 08:15:00",
    );
    db.prepare(
      `INSERT INTO jobs
        (kind, status, priority, attempt_count, max_attempts, run_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "candidate_supply_monitor",
      "pending",
      64,
      0,
      3,
      "2026-07-01 08:05:00",
      "2026-07-01 08:05:00",
    );
    db.prepare(
      `INSERT INTO workers
        (id, status, last_seen_at, last_job_id, tags, version)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "content-worker-busy",
      "busy",
      "2026-07-01 08:16:59",
      null,
      JSON.stringify(["cpu", "produce", "candidate_supply_monitor", "fresh_production_refill"]),
      "dev",
    );

    const report = inspectQueue({
      db,
      now: Date.parse("2026-07-01T08:17:06.000Z"),
    });

    assert.equal(report.contentRunway.pending_count, 1);
    assert.equal(report.contentRunway.active_fresh_worker_count, 1);
    assert.equal(report.contentRunway.occupied_fresh_worker_count, 1);
    assert.equal(report.contentRunway.saturated, true);
    assert.ok(report.warnings.includes("content_runway_worker_capacity_saturated"));
    assert.ok(!report.green.includes("content_runway_worker_available"));
  } finally {
    db.close();
  }
});

test("queue inspect counts content runway jobs even when they are outside the generic pending sample", () => {
  const db = createQueueInspectDb(`
    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      cron_expr TEXT NOT NULL,
      enabled INTEGER DEFAULT 1
    );
    INSERT INTO schedules (name, kind, cron_expr, enabled)
      VALUES ('candidate_supply_monitor', 'candidate_supply_monitor', '5 * * * *', 1);
  `);

  try {
    const insert = db.prepare(
      `INSERT INTO jobs
        (kind, status, priority, attempt_count, max_attempts, run_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < 25; i += 1) {
      insert.run(
        "engage_first_hour",
        "pending",
        60,
        0,
        3,
        `2026-07-01 08:${String(i).padStart(2, "0")}:00`,
        `2026-07-01 08:${String(i).padStart(2, "0")}:00`,
      );
    }
    insert.run(
      "candidate_supply_monitor",
      "pending",
      64,
      0,
      3,
      "2026-07-01 08:30:00",
      "2026-07-01 08:30:00",
    );

    const report = inspectQueue({
      db,
      now: Date.parse("2026-07-01T08:35:00.000Z"),
    });

    assert.equal(report.pendingJobs.length, 20);
    assert.equal(report.pendingJobs.some((job) => job.kind === "candidate_supply_monitor"), false);
    assert.equal(report.contentRunway.pending_count, 1);
    assert.equal(report.contentRunway.no_active_worker, true);
    assert.ok(report.warnings.includes("content_runway_jobs_pending_without_active_worker"));
  } finally {
    db.close();
  }
});

test("redactJobError tolerates missing and malformed job rows", () => {
  assert.equal(redactJobError(null), null);
  assert.deepEqual(redactJobError({ id: 1 }), { id: 1, last_error: "" });
});

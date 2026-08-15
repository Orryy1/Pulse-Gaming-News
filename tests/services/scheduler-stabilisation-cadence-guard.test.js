"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { runMigrations } = require("../../lib/migrate");
const { bind: bindJobs } = require("../../lib/repositories/jobs");
const { bind: bindRuntimeLeases } = require("../../lib/repositories/runtime_leases");
const {
  LEGACY_SCHEDULER_PROFILE,
  STABILISATION_SCHEDULER_PROFILE,
  evaluateStabilisationPublishCadence,
  seed,
  start,
} = require("../../lib/scheduler");

function fixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE runtime_leases (
      name TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      metadata TEXT,
    fencing_token INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      channel_id TEXT,
      cron_expr TEXT NOT NULL,
      payload TEXT,
      enabled INTEGER DEFAULT 1,
      last_enqueued_at TEXT,
      next_run_at TEXT,
      requires_gpu INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 50
    );
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      channel_id TEXT,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER DEFAULT 50,
      idempotency_key TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE platform_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      external_id TEXT,
      status TEXT NOT NULL,
      published_at TEXT
    );
    CREATE TABLE platform_dispatch_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      event_type TEXT NOT NULL,
      external_id TEXT,
      verification_status TEXT,
      verification_evidence_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
  const enqueued = [];
  const jobs = {
    enqueue(job) {
      const createdAt = new Date().toISOString();
      const info = db
        .prepare(`
          INSERT INTO jobs
            (kind, channel_id, payload, priority, idempotency_key, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          job.kind,
          job.channel_id || null,
          JSON.stringify(job.payload || {}),
          job.priority,
          job.idempotency_key,
          createdAt,
        );
      const row = { id: Number(info.lastInsertRowid), ...job, createdAt };
      enqueued.push(row);
      return row;
    },
  };
  return {
    db,
    enqueued,
    repos: {
      db,
      jobs,
      runtimeLeases: bindRuntimeLeases(db),
    },
  };
}

function insertPublishedPlatformPost(
  db,
  { storyId, externalId, publishedAt },
) {
  db.prepare(`
    INSERT INTO platform_posts
      (story_id, platform, external_id, status, published_at)
    VALUES (?, 'youtube', ?, 'published', ?)
  `).run(storyId, externalId, publishedAt);
}

function insertPublishedLedger(
  db,
  { storyId, externalId, publishedAt, storeExternalId = true },
) {
  db.prepare(`
    INSERT INTO platform_dispatch_ledger
      (
        story_id,
        platform,
        event_type,
        external_id,
        verification_status,
        verification_evidence_json,
        created_at
      )
    VALUES (?, 'youtube', 'PUBLISHED', ?, 'confirmed', ?, ?)
  `).run(
    storyId,
    storeExternalId ? externalId : null,
    JSON.stringify({ external_id: externalId }),
    publishedAt,
  );
}

test("stabilisation cadence refuses a same-time publish catch-up burst", (t) => {
  const f = fixture();
  seed({
    repos: f.repos,
    profile: STABILISATION_SCHEDULER_PROFILE,
    log() {},
  });

  const callbacks = new Map();
  const cronImpl = {
    validate() {
      return true;
    },
    schedule(expression, callback) {
      callbacks.set(expression, callback);
      return { stop() {} };
    },
  };
  const handle = start({
    repos: f.repos,
    ownerId: "scheduler-stabilisation-test",
    monitorIntervalMs: 60_000,
    cronImpl,
    log() {},
  });
  t.after(() => {
    handle.stop();
    f.db.close();
  });

  callbacks.get("0 9 * * *")();
  callbacks.get("0 19 * * *")();

  assert.equal(f.enqueued.length, 1);
  assert.equal(f.enqueued[0].kind, "publish");
});

test("stabilisation publish window enqueues atomically through the real jobs repository", (t) => {
  const db = new Database(":memory:");
  runMigrations(db, {
    log() {},
    env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" },
  });
  const repos = {
    db,
    jobs: bindJobs(db),
    runtimeLeases: bindRuntimeLeases(db),
  };
  seed({
    repos,
    profile: STABILISATION_SCHEDULER_PROFILE,
    log() {},
  });

  const callbacks = new Map();
  const cronImpl = {
    validate() {
      return true;
    },
    schedule(expression, callback) {
      const registered = callbacks.get(expression) || [];
      registered.push(callback);
      callbacks.set(expression, registered);
      return { stop() {} };
    },
  };
  const handle = start({
    repos,
    ownerId: "scheduler-real-repository-test",
    monitorIntervalMs: 60_000,
    nowProvider: () => new Date("2026-07-27T09:00:00.000Z"),
    cronImpl,
    log() {},
  });
  t.after(() => {
    handle.stop();
    db.close();
  });

  const publishMorning = callbacks.get("0 9 * * *");
  assert.equal(publishMorning.length, 1);
  publishMorning[0]();

  const jobs = db
    .prepare(
      `SELECT kind, status, idempotency_key, payload
       FROM jobs
       WHERE kind = 'publish'`,
    )
    .all();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, "pending");
  assert.equal(jobs[0].idempotency_key, "publish:2026-07-27:09");
  assert.deepEqual(JSON.parse(jobs[0].payload), {
    cadence_policy: {
      catch_up: false,
      max_publish_windows: 2,
      minimum_gap_hours: 4,
      rolling_window_hours: 24,
    },
    scheduler_profile: STABILISATION_SCHEDULER_PROFILE,
    target_platform: "youtube",
  });
});

test("an already-running scheduler re-reads the stabilisation profile before every fire", (t) => {
  const f = fixture();
  seed({
    repos: f.repos,
    profile: LEGACY_SCHEDULER_PROFILE,
    log() {},
  });
  const cronImpl = {
    validate() {
      return true;
    },
    schedule(expression, callback) {
      return { expression, fire: callback, stop() {} };
    },
  };
  const handle = start({
    repos: f.repos,
    ownerId: "scheduler-live-profile-cutover-test",
    monitorIntervalMs: 60_000,
    nowProvider: () => new Date("2026-07-27T09:00:00.000Z"),
    cronImpl,
    log() {},
  });
  t.after(() => {
    handle.stop();
    f.db.close();
  });

  seed({
    repos: f.repos,
    profile: STABILISATION_SCHEDULER_PROFILE,
    log() {},
  });

  const oldAfternoon = handle.tasks.find(
    ({ row }) => row.name === "publish_afternoon",
  );
  const retainedMorning = handle.tasks.find(
    ({ row }) => row.name === "publish_morning",
  );
  oldAfternoon.task.fire();
  assert.equal(f.enqueued.length, 0);

  retainedMorning.task.fire();
  assert.equal(f.enqueued.length, 1);
  assert.equal(f.enqueued[0].kind, "publish");
  assert.equal(
    f.enqueued[0].payload.scheduler_profile,
    STABILISATION_SCHEDULER_PROFILE,
  );
  assert.equal(f.enqueued[0].payload.target_platform, "youtube");
});

test("stabilisation cadence uses confirmed publications for the four-hour gap", (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const now = new Date("2026-07-27T19:00:00.000Z");

  insertPublishedPlatformPost(f.db, {
    storyId: "story-too-recent",
    externalId: "yt-too-recent",
    publishedAt: "2026-07-27T16:00:00.000Z",
  });
  let verdict = evaluateStabilisationPublishCadence({ db: f.db, now });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, "stabilisation_minimum_publish_gap");

  f.db.prepare("DELETE FROM platform_posts").run();
  insertPublishedPlatformPost(f.db, {
    storyId: "story-old-enough",
    externalId: "yt-old-enough",
    publishedAt: "2026-07-27T14:59:59.000Z",
  });
  verdict = evaluateStabilisationPublishCadence({ db: f.db, now });
  assert.equal(verdict.allowed, true);

  f.db
    .prepare(`
      UPDATE platform_posts
      SET published_at = '2026-07-27T15:00:00.001Z'
      WHERE story_id = 'story-old-enough'
    `)
    .run();
  verdict = evaluateStabilisationPublishCadence({ db: f.db, now });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, "stabilisation_minimum_publish_gap");
});

test("stabilisation cadence is rolling across midnight and excludes the exact 24-hour boundary", (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const now = new Date("2026-07-28T01:00:00.000Z");

  insertPublishedPlatformPost(f.db, {
    storyId: "story-latest",
    externalId: "yt-latest",
    publishedAt: "2026-07-27T20:59:59.000Z",
  });
  insertPublishedPlatformPost(f.db, {
    storyId: "story-inside-window",
    externalId: "yt-inside-window",
    publishedAt: "2026-07-27T01:00:01.000Z",
  });
  let verdict = evaluateStabilisationPublishCadence({ db: f.db, now });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, "stabilisation_rolling_publish_limit");

  f.db
    .prepare(`
      UPDATE platform_posts
      SET published_at = '2026-07-27T01:00:00.000Z'
      WHERE story_id = 'story-inside-window'
    `)
    .run();
  verdict = evaluateStabilisationPublishCadence({ db: f.db, now });
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.recent_count, 1);
});

test("failed publish jobs do not consume cadence, while in-flight jobs block a duplicate enqueue", (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const insert = f.db.prepare(`
    INSERT INTO jobs (kind, status, created_at)
    VALUES ('publish', ?, ?)
  `);
  const now = new Date("2026-07-27T19:00:00.000Z");

  insert.run("failed", "2026-07-27T18:59:00.000Z");
  insert.run("done", "2026-07-27T18:58:00.000Z");
  let verdict = evaluateStabilisationPublishCadence({ db: f.db, now });
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.recent_count, 0);

  insert.run("claimed", "2026-07-27T18:59:30.000Z");
  verdict = evaluateStabilisationPublishCadence({ db: f.db, now });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, "stabilisation_publish_job_already_active");
  assert.equal(verdict.active_job_count, 1);
});

test("confirmed ledger-only publications count and duplicate evidence is counted once", (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const now = new Date("2026-07-27T19:00:00.000Z");

  insertPublishedLedger(f.db, {
    storyId: "story-ledger-only",
    externalId: "yt-ledger-only",
    publishedAt: "2026-07-27T16:30:00.000Z",
    storeExternalId: false,
  });
  let verdict = evaluateStabilisationPublishCadence({ db: f.db, now });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, "stabilisation_minimum_publish_gap");

  f.db.prepare("DELETE FROM platform_dispatch_ledger").run();
  insertPublishedPlatformPost(f.db, {
    storyId: "story-deduped",
    externalId: "yt-deduped",
    publishedAt: "2026-07-27T14:00:00.000Z",
  });
  insertPublishedLedger(f.db, {
    storyId: "story-deduped-reconciliation-alias",
    externalId: "yt-deduped",
    publishedAt: "2026-07-27T14:00:02.000Z",
  });
  verdict = evaluateStabilisationPublishCadence({ db: f.db, now });
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.recent_count, 1);
});

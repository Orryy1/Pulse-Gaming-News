"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { handlers } = require("../../lib/job-handlers");
const { bind: bindRuntimeLeases } = require(
  "../../lib/repositories/runtime_leases",
);
const {
  MULTI_LANE_SCHEDULER_PROFILE,
  schedulesForProfile,
  start: startScheduler,
} = require("../../lib/scheduler");

function schedulerFixture() {
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
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      channel_id TEXT,
      cron_expr TEXT NOT NULL,
      payload TEXT,
      requires_gpu INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 50,
      enabled INTEGER DEFAULT 1,
      last_enqueued_at TEXT
    );
  `);
  const enqueued = [];
  return {
    db,
    enqueued,
    repos: {
      db,
      runtimeLeases: bindRuntimeLeases(db),
      jobs: {
        enqueue(request) {
          enqueued.push(structuredClone(request));
          return { id: enqueued.length, ...request };
        },
      },
    },
  };
}

test("the real T-94 schedule fire binds its UTC window and enters the pre-T90 handler on time", async () => {
  const fixture = schedulerFixture();
  const schedule = schedulesForProfile(
    MULTI_LANE_SCHEDULER_PROFILE,
  ).find(
    (entry) =>
      entry.name ===
      "prepare_governed_autonomous_pre_t90_window_evening",
  );
  assert.ok(schedule);
  fixture.db
    .prepare(
      `INSERT INTO schedules
         (name, kind, channel_id, cron_expr, payload,
          requires_gpu, priority, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      schedule.name,
      schedule.kind,
      schedule.channel_id || null,
      schedule.cron_expr,
      JSON.stringify({
        ...schedule.payload,
        idempotencyTemplate: schedule.idempotencyTemplate,
      }),
      schedule.requires_gpu ? 1 : 0,
      schedule.priority,
    );

  const callbacks = [];
  const now = "2026-07-28T17:26:00.000Z";
  const scheduler = startScheduler({
    repos: fixture.repos,
    ownerId: "scheduler-pre-t90-integration",
    monitorIntervalMs: 60_000,
    cronImpl: {
      validate() {
        return true;
      },
      schedule(_expression, callback) {
        callbacks.push(callback);
        return { stop() {} };
      },
    },
    nowProvider: () => new Date(now),
    log() {},
  });

  try {
    assert.equal(callbacks.length, 1);
    callbacks[0]();
    assert.equal(fixture.enqueued.length, 1);

    const preparedRequests = [];
    const result = await handlers[
      "prepare_governed_autonomous_pre_t90_window"
    ](
      {
        ...fixture.enqueued[0],
        id: 401,
        run_at: now,
      },
      {
        now: () => now,
        repos: {},
        assertLeaseHealthy() {},
        runGovernedAutonomousPreT90WindowPreparation: async (
          request,
        ) => {
          preparedRequests.push(request);
          return {
            verdict: "GREEN",
            blockers: [],
            publish_authority_created: false,
            external_posting: false,
          };
        },
      },
    );

    assert.equal(
      fixture.enqueued[0].payload.scheduled_for,
      "2026-07-28T19:00:00.000Z",
    );
    assert.equal(result.status, "pre_t90_window_prepared");
    assert.equal(result.verdict, "GREEN");
    assert.equal(preparedRequests.length, 1);
    assert.equal(
      preparedRequests[0].scheduled_for,
      "2026-07-28T19:00:00.000Z",
    );
    assert.equal(preparedRequests[0].catch_up_allowed, false);
    assert.equal(preparedRequests[0].publish_authority, false);
    assert.equal(preparedRequests[0].external_posting, false);
  } finally {
    scheduler.stop();
    fixture.db.close();
  }
});

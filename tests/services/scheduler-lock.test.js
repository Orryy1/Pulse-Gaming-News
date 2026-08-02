"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { bind } = require("../../lib/repositories/runtime_leases");
const {
  acquireSchedulerLease,
  defaultSchedulerOwnerId,
  releaseSchedulerLease,
} = require("../../lib/services/scheduler-lock");
const { start: startScheduler } = require("../../lib/scheduler");

function fixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE runtime_leases (
      name TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      metadata TEXT
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
  const runtimeLeases = bind(db);
  const enqueued = [];
  return {
    db,
    enqueued,
    runtimeLeases,
    repos: {
      jobs: {
        enqueue(job) {
          enqueued.push(job);
          return { id: enqueued.length, ...job };
        },
      },
      runtimeLeases,
      db,
    },
  };
}

test("scheduler owner identity is unique for every start session", () => {
  const first = defaultSchedulerOwnerId();
  const second = defaultSchedulerOwnerId();
  assert.notEqual(first, second);
  assert.match(first, /^scheduler:.+:\d+:[0-9a-f-]{36}$/i);
});

test("scheduler ownership allows exactly one same-process start", () => {
  const f = fixture();
  const first = startScheduler({ repos: f.repos, log() {} });
  const second = startScheduler({ repos: f.repos, log() {} });
  assert.equal(first.active, true);
  assert.equal(second.active, false);
  assert.equal(second.blocked_reason, "scheduler_lease_unavailable");
  assert.notEqual(first.lease.owner_id, second.lease.owner_id);
  assert.equal(second.lease.current_owner_id, first.lease.owner_id);
  first.stop();
  second.stop();
  f.db.close();
});

test("scheduler lease metadata is truthful and does not claim a later profile", () => {
  const f = fixture();
  const lease = acquireSchedulerLease({
    leases: f.runtimeLeases,
    ownerId: "scheduler-session-1",
    metadata: { process_id: 123 },
  });
  const metadata = JSON.parse(lease.metadata);
  assert.equal(metadata.purpose, "single_owner_scheduler_dispatch");
  assert.equal(metadata.process_id, 123);
  assert.equal(Object.hasOwn(metadata, "profile"), false);
  releaseSchedulerLease({
    leases: f.runtimeLeases,
    ownerId: "scheduler-session-1",
  });
  f.db.close();
});

test("scheduler lease metadata is versioned and bound to one runtime generation", () => {
  const f = fixture();
  const lease = acquireSchedulerLease({
    leases: f.runtimeLeases,
    ownerId: "scheduler-runtime-generation-private-owner",
    runtimeAuthority: {
      runtime_instance_id: "ri-11111111-2222-4333-8444-555555555555",
      child_pid: 4200,
      child_started_at: "2026-08-02T10:00:00.000Z",
      authority_fingerprint: "a".repeat(64),
    },
  });

  assert.deepEqual(JSON.parse(lease.metadata), {
    schema_version: "pulse-runtime-generation-lease-v1",
    runtime_instance_id: "ri-11111111-2222-4333-8444-555555555555",
    process_id: 4200,
    process_started_at: "2026-08-02T10:00:00.000Z",
    authority_fingerprint: "a".repeat(64),
    purpose: "single_owner_scheduler_dispatch",
  });

  releaseSchedulerLease({
    leases: f.runtimeLeases,
    ownerId: "scheduler-runtime-generation-private-owner",
  });
  f.db.close();
});

test("live-guarded scheduler refuses to acquire an unbound lease", () => {
  const f = fixture();

  assert.throws(
    () =>
      acquireSchedulerLease({
        leases: f.runtimeLeases,
        ownerId: "unbound-live-scheduler-owner",
        env: { PULSE_OPERATING_MODE: "LIVE_GUARDED" },
      }),
    /runtime_generation_authority_required/,
  );
  assert.equal(f.runtimeLeases.get("scheduler:primary"), null);
  f.db.close();
});

test("scheduler startup carries the injected runtime generation into its durable lease", () => {
  const f = fixture();
  const runtimeAuthority = {
    runtime_instance_id: "ri-11111111-2222-4333-8444-555555555555",
    child_pid: 4200,
    child_started_at: "2026-08-02T10:00:00.000Z",
    authority_fingerprint: "a".repeat(64),
  };
  const handle = startScheduler({
    repos: f.repos,
    ownerId: "scheduler-runtime-generation-private-owner",
    runtimeAuthority,
    log() {},
  });

  assert.deepEqual(
    JSON.parse(f.runtimeLeases.get("scheduler:primary").metadata),
    {
      schema_version: "pulse-runtime-generation-lease-v1",
      runtime_instance_id: "ri-11111111-2222-4333-8444-555555555555",
      process_id: 4200,
      process_started_at: "2026-08-02T10:00:00.000Z",
      authority_fingerprint: "a".repeat(64),
      purpose: "single_owner_scheduler_dispatch",
    },
  );

  handle.stop();
  f.db.close();
});

test("lease loss changes the live scheduler handle to inactive", () => {
  const f = fixture();
  const handle = startScheduler({
    repos: f.repos,
    ownerId: "scheduler-session-1",
    log() {},
  });
  assert.equal(handle.active, true);
  f.runtimeLeases.release("scheduler:primary", "scheduler-session-1");
  assert.equal(handle.heartbeatNow(), false);
  assert.equal(handle.active, false);
  handle.stop();
  f.db.close();
});

test("scheduler startup releases its lease when registration fails", () => {
  const calls = [];
  const runtimeLeases = {
    acquire({ ownerId }) {
      calls.push(["acquire", ownerId]);
      return {
        acquired: true,
        owner_id: ownerId,
        expires_at: "2026-07-27T22:10:00.000Z",
      };
    },
    release(name, ownerId) {
      calls.push(["release", name, ownerId]);
      return true;
    },
  };
  assert.throws(
    () =>
      startScheduler({
        repos: {
          jobs: {},
          runtimeLeases,
          db: {
            prepare() {
              throw new Error("schedule_read_failed");
            },
          },
        },
        ownerId: "scheduler-fixture",
        log() {},
      }),
    /schedule_read_failed/,
  );
  assert.deepEqual(calls, [
    ["acquire", "scheduler-fixture"],
    ["release", "scheduler:primary", "scheduler-fixture"],
  ]);
});

test("standby scheduler can acquire ownership after the active owner stops", () => {
  const f = fixture();
  const active = startScheduler({
    repos: f.repos,
    ownerId: "scheduler-active",
    monitorIntervalMs: 60_000,
    log() {},
  });
  const standby = startScheduler({
    repos: f.repos,
    ownerId: "scheduler-standby",
    monitorIntervalMs: 60_000,
    log() {},
  });
  try {
    assert.equal(active.active, true);
    assert.equal(standby.active, false);
    assert.equal(typeof standby.retryNow, "function");

    active.stop();
    assert.equal(standby.retryNow(), true);
    assert.equal(standby.active, true);
    assert.equal(standby.lease.owner_id, "scheduler-standby");
  } finally {
    active.stop();
    standby.stop();
    f.db.close();
  }
});

test("cron fire revalidates ownership in the enqueue transaction", () => {
  const f = fixture();
  f.db
    .prepare(
      `INSERT INTO schedules
         (name, kind, cron_expr, payload, priority, enabled)
       VALUES (?, ?, ?, ?, ?, 1)`,
    )
    .run(
      "publish_test",
      "publish",
      "* * * * *",
      JSON.stringify({ idempotencyTemplate: "publish:{date}:{minute}" }),
      20,
    );
  const callbacks = [];
  const cronImpl = {
    validate() {
      return true;
    },
    schedule(expression, callback) {
      callbacks.push(callback);
      return { stop() {} };
    },
  };
  const handle = startScheduler({
    repos: f.repos,
    ownerId: "scheduler-original",
    monitorIntervalMs: 60_000,
    cronImpl,
    log() {},
  });
  try {
    assert.equal(callbacks.length, 1);
    f.runtimeLeases.release("scheduler:primary", "scheduler-original");
    f.runtimeLeases.acquire({
      name: "scheduler:primary",
      ownerId: "scheduler-takeover",
      leaseMs: 90_000,
    });

    callbacks[0]();
    assert.equal(f.enqueued.length, 0);
    assert.equal(handle.active, false);
  } finally {
    handle.stop();
    f.runtimeLeases.release("scheduler:primary", "scheduler-takeover");
    f.db.close();
  }
});

test("autonomous planner and T-94 cron fires bind the exact UTC publish window without catch-up across UK DST boundaries", () => {
  for (const scenario of [
    {
      kind: "plan_governed_autonomous_window_production",
      name: "plan_governed_autonomous_window_production_morning",
      cron: "35 6 * * *",
      now: "2026-03-29T06:35:00.000Z",
      publishHour: 9,
      scheduledFor: "2026-03-29T09:00:00.000Z",
      jobMaxAttempts: 8,
    },
    {
      kind: "prepare_governed_autonomous_pre_t90_window",
      name: "prepare_governed_autonomous_pre_t90_window_evening",
      cron: "26 17 * * *",
      now: "2026-10-25T17:26:00.000Z",
      publishHour: 19,
      scheduledFor: "2026-10-25T19:00:00.000Z",
    },
  ]) {
    const f = fixture();
    f.db
      .prepare(
        `INSERT INTO schedules
           (name, kind, cron_expr, payload, priority, enabled)
         VALUES (?, ?, ?, ?, 3, 1)`,
      )
      .run(
        scenario.name,
        scenario.kind,
        scenario.cron,
        JSON.stringify({
          publish_hour_utc: scenario.publishHour,
          scheduler_profile: "governed_multi_lane",
          catch_up_allowed: false,
          publish_authority: false,
          external_posting: false,
          ...(scenario.jobMaxAttempts
            ? {
                job_max_attempts:
                  scenario.jobMaxAttempts,
              }
            : {}),
          idempotencyTemplate: `${scenario.kind}:{date}:${String(
            scenario.publishHour,
          ).padStart(2, "0")}`,
        }),
      );
    const callbacks = [];
    const handle = startScheduler({
      repos: f.repos,
      ownerId: `scheduler-${scenario.kind}`,
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
      nowProvider: () => new Date(scenario.now),
      log() {},
    });
    try {
      assert.equal(callbacks.length, 1);
      callbacks[0]();
      assert.equal(f.enqueued.length, 1);
      assert.equal(
        f.enqueued[0].payload.scheduled_for,
        scenario.scheduledFor,
      );
      assert.equal(
        f.enqueued[0].payload.scheduler_profile,
        "governed_multi_lane",
      );
      assert.equal(
        f.enqueued[0].payload.catch_up_allowed,
        false,
      );
      assert.equal(
        f.enqueued[0].payload.publish_authority,
        false,
      );
      assert.equal(
        f.enqueued[0].payload.external_posting,
        false,
      );
      assert.equal(
        f.enqueued[0].max_attempts,
        scenario.jobMaxAttempts,
      );
      assert.equal(
        Object.hasOwn(
          f.enqueued[0].payload,
          "job_max_attempts",
        ),
        false,
      );
    } finally {
      handle.stop();
      f.db.close();
    }
  }
});

test("scheduled_for derivation is not injected into unrelated runway rows", () => {
  const f = fixture();
  f.db
    .prepare(
      `INSERT INTO schedules
         (name, kind, cron_expr, payload, priority, enabled)
       VALUES (?, ?, ?, ?, 4, 1)`,
    )
    .run(
      "governed_youtube_runway_t90_morning",
      "governed_youtube_runway_t90",
      "30 7 * * *",
      JSON.stringify({
        publish_hour_utc: 9,
        catch_up_allowed: false,
        publish_authority: false,
        external_posting: false,
        idempotencyTemplate:
          "governed_youtube_runway_t90:{date}:09",
      }),
    );
  const callbacks = [];
  const handle = startScheduler({
    repos: f.repos,
    ownerId: "scheduler-unrelated-row",
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
    nowProvider: () =>
      new Date("2026-03-29T07:30:00.000Z"),
    log() {},
  });
  try {
    callbacks[0]();
    assert.equal(f.enqueued.length, 1);
    assert.equal(
      Object.hasOwn(f.enqueued[0].payload, "scheduled_for"),
      false,
    );
  } finally {
    handle.stop();
    f.db.close();
  }
});

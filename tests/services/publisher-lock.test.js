"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { bind } = require("../../lib/repositories/runtime_leases");
const {
  acquirePublisherLease,
  defaultPublisherOwnerId,
  runWithPublisherLease,
} = require("../../lib/services/publisher-lock");
const { handlers, renderPublishSummary } = require("../../lib/job-handlers");

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
    )
  `);
  return { db, leases: bind(db) };
}

function boundPublisherFixture() {
  const state = fixture();
  state.db.exec(`
    CREATE TABLE publication_lifecycle_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id TEXT NOT NULL,
      platform TEXT,
      from_state TEXT,
      to_state TEXT NOT NULL,
      evidence_json TEXT,
      idempotency_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE platform_publication_state (
      story_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL,
      PRIMARY KEY (story_id, platform)
    );
  `);
  const admission = {
    story_id: "story-73",
    platform: "youtube",
    scheduled_for: "2026-08-02T19:00:00.000Z",
    dispatch_idempotency_key: "publish:2026-08-02:19",
    request_fingerprint: "b".repeat(64),
    runway_lock_sha256: "c".repeat(64),
  };
  const inserted = state.db
    .prepare(
      `INSERT INTO publication_lifecycle_events
         (story_id, platform, from_state, to_state, evidence_json,
          idempotency_key, created_at)
       VALUES (?, 'youtube', 'READY', 'SCHEDULED', ?, ?, ?)`,
    )
    .run(
      admission.story_id,
      JSON.stringify({
        schedule_verified: true,
        control_tower_verdict: "GREEN",
        control_tower_checked_at: "2026-08-02T18:55:00.000Z",
        scheduled_for: admission.scheduled_for,
        kill_switch_healthy: true,
        operating_contract_valid: true,
        dispatch_idempotency_key: admission.dispatch_idempotency_key,
        request_fingerprint: admission.request_fingerprint,
        runway_lock_sha256: admission.runway_lock_sha256,
      }),
      `${admission.dispatch_idempotency_key}:lifecycle:SCHEDULED`,
      "2026-08-02T18:55:00.000Z",
    );
  admission.scheduled_event_id = Number(inserted.lastInsertRowid);
  state.db
    .prepare(
      `INSERT INTO platform_publication_state
         (story_id, platform, lifecycle_state)
       VALUES (?, 'youtube', 'SCHEDULED')`,
    )
    .run(admission.story_id);
  return { ...state, admission };
}

function scheduledDispatchFixture({
  storyId = "publisher-lock-story",
  scheduledFor = "2026-07-27T09:00:00.000Z",
} = {}) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE publication_lifecycle_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id TEXT NOT NULL,
      platform TEXT,
      to_state TEXT NOT NULL,
      evidence_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE platform_publication_state (
      story_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL,
      PRIMARY KEY (story_id, platform)
    );
  `);
  db.prepare(
    `
    INSERT INTO publication_lifecycle_events
      (story_id, platform, to_state, evidence_json, created_at)
    VALUES (?, 'youtube', 'SCHEDULED', ?, ?)
  `,
  ).run(
    storyId,
    JSON.stringify({
      schedule_verified: true,
      control_tower_verdict: "GREEN",
      control_tower_checked_at: "2026-07-27T08:55:00.000Z",
      scheduled_for: scheduledFor,
      kill_switch_healthy: true,
      operating_contract_valid: true,
      dispatch_idempotency_key: `youtube:${storyId}:${scheduledFor}`,
      request_fingerprint: "a".repeat(64),
    }),
    "2026-07-27T08:55:00.000Z",
  );
  db.prepare(
    `
    INSERT INTO platform_publication_state
      (story_id, platform, lifecycle_state)
    VALUES (?, 'youtube', 'SCHEDULED')
  `,
  ).run(storyId);
  return db;
}

test("publisher owner identity is unique for every operation session", () => {
  const first = defaultPublisherOwnerId();
  const second = defaultPublisherOwnerId();
  assert.notEqual(first, second);
  assert.match(first, /^publisher:.+:\d+:[0-9a-f-]{36}$/i);
});

test("concurrent publish operations are excluded by the durable lease", async () => {
  const { db, leases } = fixture();
  let releaseFirst;
  const firstCanFinish = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const first = runWithPublisherLease({
    leases,
    channelId: "pulse-gaming",
    operation: "publish_next_story",
    task: async ({ assertHealthy }) => {
      assertHealthy();
      await firstCanFinish;
      return { completed: true };
    },
  });
  const second = await runWithPublisherLease({
    leases,
    channelId: "pulse-gaming",
    operation: "publish_batch",
    task: async () => {
      throw new Error("second_task_must_not_run");
    },
  });
  assert.equal(second.publish_dispatch_blocked, true);
  assert.equal(second.top_reason, "durable_publish_lock_unavailable");
  releaseFirst();
  assert.deepEqual(await first, { completed: true });
  db.close();
});

test("lease loss blocks subsequent irreversible work and releases cleanly", async () => {
  const { db, leases } = fixture();
  let effects = 0;
  const result = await runWithPublisherLease({
    leases,
    channelId: "pulse-gaming",
    operation: "publish_next_story",
    task: async ({ assertHealthy, lease }) => {
      assertHealthy();
      effects += 1;
      leases.release(lease.lease_name, lease.owner_id);
      assertHealthy();
      effects += 1;
    },
  });
  assert.equal(effects, 1);
  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.top_reason, "durable_publish_lease_lost");
  db.close();
});

test("lease-loss blocking preserves only the compensation metadata needed after an irreversible boundary", async () => {
  const { db, leases } = fixture();
  const result = await runWithPublisherLease({
    leases,
    channelId: "pulse-gaming",
    operation: "arm_governed_youtube_scheduled_release",
    task: async ({ assertHealthy, lease }) => {
      leases.release(lease.lease_name, lease.owner_id);
      try {
        assertHealthy();
      } catch (error) {
        error.updateAttemptStarted = true;
        error.remoteDisarmRequired = true;
        error.platformContacted = true;
        error.externalId = "yt-orphaned-arm";
        error.secret = "must-not-cross-lock-boundary";
        throw error;
      }
    },
  });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.top_reason, "durable_publish_lease_lost");
  assert.equal(result.updateAttemptStarted, true);
  assert.equal(result.remoteDisarmRequired, true);
  assert.equal(result.platformContacted, true);
  assert.equal(result.externalId, "yt-orphaned-arm");
  assert.equal(Object.hasOwn(result, "secret"), false);
  db.close();
});

test("publisher lease metadata describes the real operation only", async () => {
  const { db, leases } = fixture();
  await runWithPublisherLease({
    leases,
    channelId: "pulse-gaming",
    operation: "publish_batch",
    task: async ({ lease }) => {
      const metadata = JSON.parse(lease.metadata);
      assert.equal(metadata.operation, "publish_batch");
      assert.equal(metadata.purpose, "single_flight_platform_dispatch");
      assert.equal(Object.hasOwn(metadata, "profile"), false);
    },
  });
  db.close();
});

test("publisher lease metadata binds one runtime generation to one admitted operation", () => {
  const { db, leases, admission } = boundPublisherFixture();
  const lease = acquirePublisherLease({
    db,
    leases,
    ownerId: "publisher-runtime-private-owner",
    operation: "publish_next_story",
    runtimeAuthority: {
      runtime_instance_id: "ri-11111111-2222-4333-8444-555555555555",
      child_pid: process.pid,
      child_started_at: "2026-08-02T10:00:00.000Z",
      authority_fingerprint: "a".repeat(64),
    },
    admissionContext: admission,
    metadata: {
      operation: "publish_batch",
      process_id: 1,
      purpose: "caller_override",
      schema_version: "caller-schema",
      runtime_instance_id: "ri-99999999-9999-4999-8999-999999999999",
      admitted_operation: { caller: "forged" },
    },
  });

  const metadata = JSON.parse(lease.metadata);
  assert.deepEqual(
    {
      ...metadata,
      admitted_operation_sha256: undefined,
      start_lifecycle_sha256: undefined,
    },
    {
      channel_id: "pulse-gaming",
      operation: "publish_next_story",
      process_id: process.pid,
      purpose: "single_flight_platform_dispatch",
      schema_version: "pulse-runtime-generation-publisher-lease-v1",
      runtime_instance_id: "ri-11111111-2222-4333-8444-555555555555",
      process_started_at: "2026-08-02T10:00:00.000Z",
      authority_fingerprint: "a".repeat(64),
      admitted_operation: {
        schema_version: "pulse-admitted-publication-operation-v1",
        story_id: "story-73",
        platform: "youtube",
        scheduled_event_id: 1,
        scheduled_for: "2026-08-02T19:00:00.000Z",
        dispatch_idempotency_key: "publish:2026-08-02:19",
        request_fingerprint: "b".repeat(64),
        runway_lock_sha256: "c".repeat(64),
      },
      publisher_operation_set_sha256:
        "10fad4b25680b3a3f536332c5a09926406f6d863db98c47c393c6b1d21559460",
      publisher_phase: "FRESH_DISPATCH",
      start_lifecycle_event_id: 1,
      start_lifecycle_state: "SCHEDULED",
      start_lifecycle_sha256: undefined,
      admitted_operation_sha256: undefined,
    },
  );
  assert.match(metadata.admitted_operation_sha256, /^[a-f0-9]{64}$/);
  assert.match(metadata.start_lifecycle_sha256, /^[a-f0-9]{64}$/);

  leases.release(lease.lease_name, lease.owner_id);
  db.close();
});

test("live-guarded publisher fails closed before acquiring an unbound lease", async () => {
  const { db, leases } = fixture();
  let taskCalls = 0;

  const result = await runWithPublisherLease({
    leases,
    env: { PULSE_OPERATING_MODE: "LIVE_GUARDED" },
    task: async () => {
      taskCalls += 1;
    },
  });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.top_reason, "durable_publish_lock_unavailable");
  assert.equal(taskCalls, 0);
  assert.equal(leases.get("publisher:global"), null);
  db.close();
});

test("publisher lock hashes a competing private owner instead of exposing it", async () => {
  const { db, leases } = fixture();
  const first = acquirePublisherLease({
    leases,
    ownerId: "publisher-private-first-owner",
  });

  const blocked = await runWithPublisherLease({
    leases,
    ownerId: "publisher-private-second-owner",
    task: async () => {
      throw new Error("blocked_publisher_task_must_not_run");
    },
  });

  assert.equal(blocked.publish_dispatch_blocked, true);
  assert.equal(
    blocked.current_lock_owner_sha256,
    "62821acd839cc593a24b3d6033ef6b9ece9911e8a9750baf9b08f7d5e54098f3",
  );
  assert.equal(Object.hasOwn(blocked, "current_lock_owner"), false);
  assert.equal(
    JSON.stringify(blocked).includes("publisher-private-first-owner"),
    false,
  );

  leases.release(first.lease_name, first.owner_id);
  db.close();
});

test("publisher ownership is global even when callers name different channels", async () => {
  const { db, leases } = fixture();
  let releaseFirst;
  const gate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let firstLease;
  const first = runWithPublisherLease({
    leases,
    channelId: "pulse-gaming",
    task: async ({ lease }) => {
      firstLease = lease;
      await gate;
    },
  });
  const second = await runWithPublisherLease({
    leases,
    channelId: "stacked",
    task: async () => {
      throw new Error("cross_channel_task_must_not_run");
    },
  });
  assert.equal(firstLease.lease_name, "publisher:global");
  assert.equal(second.publish_dispatch_blocked, true);
  releaseFirst();
  await first;
  db.close();
});

test("blocked publisher results are held without an off-window job retry", async (t) => {
  const db = scheduledDispatchFixture();
  t.after(() => db.close());
  let receivedBinding = null;
  const result = await handlers.publish(
    {
      id: 73,
      channel_id: "pulse-gaming",
      idempotency_key: "publish:2026-07-27:09",
      payload: {
        scheduler_profile: "stabilisation_30d",
        target_platform: "youtube",
      },
    },
    {
      repos: { db },
      now: () => new Date("2026-07-27T09:00:00.000Z"),
      assertLeaseHealthy() {
        return true;
      },
      async publishNextStory({ exactDispatchBinding }) {
        receivedBinding = exactDispatchBinding;
        return {
          publish_dispatch_blocked: true,
          top_reason: "durable_publish_lock_unavailable",
        };
      },
      log() {},
    },
  );
  assert.equal(receivedBinding.storyId, "publisher-lock-story");
  assert.deepEqual(result, {
    deferred: true,
    status: "held",
    reason: "durable_publish_lock_unavailable",
    cadence: null,
  });
  const summary = renderPublishSummary({
    publish_dispatch_blocked: true,
    top_reason: "durable_publish_lock_unavailable",
  });
  assert.equal(summary.status, "deferred");
  assert.doesNotMatch(summary.message, /Published/);
});

test("legacy or off-window publish jobs are discarded before publisher execution", async () => {
  for (const job of [
    {
      id: 81,
      idempotency_key: "publish:2026-07-27:14",
      payload: {
        scheduler_profile: "legacy",
        target_platform: "youtube",
      },
    },
    {
      id: 82,
      idempotency_key: "publish:2026-07-27:14",
      payload: {
        scheduler_profile: "stabilisation_30d",
        target_platform: "youtube",
      },
    },
  ]) {
    let called = false;
    const result = await handlers.publish(job, {
      async publishNextStory() {
        called = true;
      },
    });
    assert.equal(called, false);
    assert.equal(result.skipped, true);
    assert.equal(result.status, "held");
  }
});

test("every live publisher entrypoint uses one durable coordinator", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "publisher.js"),
    "utf8",
  );
  assert.match(
    source,
    /async function publishToAllPlatforms\(options = \{\}\)[\s\S]*runWithPublisherLease/,
  );
  assert.match(
    source,
    /async function publishNextStory\(options = \{\}\)[\s\S]*runWithPublisherLease/,
  );
  assert.match(source, /_publishToAllPlatformsUnlocked\(assertLeaseHealthy\)/);
  assert.match(
    source,
    /_publishNextStoryInner\(assertLeaseHealthy,\s*runtime\)/,
  );
  assert.ok(
    (source.match(/assertLeaseHealthy\(\)/g) || []).length >= 10,
    "platform and fallback side effects must re-check lease ownership",
  );
  assert.match(
    source,
    /const\s+dispatchResult\s*=\s*await\s+governedDispatch\([\s\S]{0,2500}?\);\s*assertLeaseHealthy\(\)/,
    "YouTube result handling must re-check ownership after governed dispatch",
  );
  assert.doesNotMatch(
    source,
    /setTimeout\([\s\S]{0,500}?engageFirstHour/,
    "engagement must run through its separately leased scheduler job",
  );
  const batchStart = source.indexOf(
    "async function _publishToAllPlatformsUnlocked",
  );
  const batchEnd = source.indexOf(
    "async function publishToAllPlatforms",
    batchStart,
  );
  const batchSource = source.slice(batchStart, batchEnd);
  assert.match(
    batchSource,
    /legacy_batch_publish_disabled_use_durable_single_story_queue/,
  );
  assert.doesNotMatch(
    batchSource,
    /uploadAll/,
    "legacy batch uploaders cannot perform unfenced multi-item effects",
  );
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { bind } = require("../../lib/repositories/runtime_leases");
const {
  defaultPublisherOwnerId,
  runWithPublisherLease,
} = require("../../lib/services/publisher-lock");
const {
  handlers,
  renderPublishSummary,
} = require("../../lib/job-handlers");

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

test("blocked publisher results are held without an off-window job retry", async () => {
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
      repos: { db: {} },
      assertLeaseHealthy() {
        return true;
      },
      async publishNextStory() {
        return {
          publish_dispatch_blocked: true,
          top_reason: "durable_publish_lock_unavailable",
        };
      },
      log() {},
    },
  );
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
  assert.match(
    source,
    /_publishToAllPlatformsUnlocked\(assertLeaseHealthy\)/,
  );
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
    "// --- Full autonomous cycle",
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

"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { handlers } = require("../../lib/job-handlers");

function fixture() {
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
  return db;
}

test("scheduled publish bridges the one exact fresh governed ticket into the publisher", async (t) => {
  const db = fixture();
  t.after(() => db.close());

  const scheduledFor = "2026-07-28T19:00:00.000Z";
  const dispatchIdempotencyKey =
    "youtube:evergreen-001:2026-07-28T19:00:00.000Z";
  const requestFingerprint = "a".repeat(64);
  const event = db
    .prepare(`
      INSERT INTO publication_lifecycle_events
        (story_id, platform, to_state, evidence_json, created_at)
      VALUES (?, 'youtube', 'SCHEDULED', ?, ?)
    `)
    .run(
      "evergreen-001",
      JSON.stringify({
        schedule_verified: true,
        control_tower_verdict: "GREEN",
        control_tower_checked_at: "2026-07-28T18:55:00.000Z",
        scheduled_for: scheduledFor,
        kill_switch_healthy: true,
        operating_contract_valid: true,
        dispatch_idempotency_key: dispatchIdempotencyKey,
        request_fingerprint: requestFingerprint,
      }),
      "2026-07-28T18:55:00.000Z",
    );
  db.prepare(`
    INSERT INTO platform_publication_state
      (story_id, platform, lifecycle_state)
    VALUES (?, 'youtube', 'SCHEDULED')
  `).run("evergreen-001");

  let received = null;
  const result = await handlers.publish(
    {
      id: 44,
      channel_id: "pulse-gaming",
      idempotency_key: "publish:2026-07-28:19",
      payload: {
        scheduler_profile: "stabilisation_30d",
        target_platform: "youtube",
      },
    },
    {
      repos: { db },
      now: () => new Date("2026-07-28T19:00:00.000Z"),
      publishNextStory: async (options) => {
        received = options;
        return { no_safe_candidate: true, candidates_tried: 0 };
      },
      assertLeaseHealthy() {},
      log() {},
    },
  );

  assert.equal(result.no_safe_candidate, true);
  assert.deepEqual(
    {
      storyId: received.exactDispatchBinding.storyId,
      platform: received.exactDispatchBinding.platform,
      scheduledFor: received.exactDispatchBinding.scheduledFor,
      scheduledEventId: received.exactDispatchBinding.scheduledEventId,
      dispatchIdempotencyKey:
        received.exactDispatchBinding.dispatchIdempotencyKey,
      requestFingerprint:
        received.exactDispatchBinding.requestFingerprint,
    },
    {
      storyId: "evergreen-001",
      platform: "youtube",
      scheduledFor,
      scheduledEventId: Number(event.lastInsertRowid),
      dispatchIdempotencyKey,
      requestFingerprint,
    },
  );
  assert.equal(
    Number.isInteger(received.exactDispatchBinding.databaseDataVersion),
    true,
  );
});

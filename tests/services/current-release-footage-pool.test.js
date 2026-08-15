"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  assignCurrentReleaseFootage,
  isCandidateEligible,
  isPoolSnapshotFresh,
  scoreCandidate,
  selectCurrentReleaseFootage,
  validatePool,
} = require("../../lib/services/current-release-footage-pool");

function makePool() {
  return {
    schema_version: "pulse-current-release-footage-pool-v1",
    generated_at: "2026-08-14T00:00:00.000Z",
    selection_policy: {
      minimum_views: 500000,
      recent_upload_days: 45,
      recent_minimum_views: 20000,
      cooldown_slots: 2,
      top_band_size: 1,
      max_snapshot_age_hours: 24,
    },
    official_channel_allowlist: ["official-a", "official-b", "official-c"],
    candidates: [
      {
        id: "alpha",
        game: "Alpha",
        youtube_video_id: "video-a",
        official_channel_id: "official-a",
        current_until: "2026-12-31T23:59:59.000Z",
        published_at: "2026-08-01T00:00:00.000Z",
        topic_tags: ["audio"],
        snapshot: { views: 900000 },
        rights_class: "official-source-editorial-private-review",
      },
      {
        id: "beta",
        game: "Beta",
        youtube_video_id: "video-b",
        official_channel_id: "official-b",
        current_until: "2026-12-31T23:59:59.000Z",
        published_at: "2026-07-01T00:00:00.000Z",
        topic_tags: ["latency"],
        snapshot: { views: 6000000 },
        rights_class: "official-source-editorial-private-review",
      },
      {
        id: "gamma",
        game: "Gamma",
        youtube_video_id: "video-c",
        official_channel_id: "official-c",
        current_until: "2026-12-31T23:59:59.000Z",
        published_at: "2026-08-10T00:00:00.000Z",
        topic_tags: ["audio", "latency"],
        snapshot: { views: 800000 },
        rights_class: "official-source-editorial-private-review",
      },
    ],
  };
}

test("validatePool rejects a non-allowlisted source", () => {
  const pool = makePool();
  pool.candidates[0].official_channel_id = "untrusted";
  assert.throws(() => validatePool(pool), /non-allowlisted/);
});

test("expired footage cannot become eligible", () => {
  const pool = makePool();
  pool.candidates[0].current_until = "2026-07-31T23:59:59.000Z";
  const result = isCandidateEligible(pool.candidates[0], pool, { now: "2026-08-14T00:00:00.000Z" });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "market_window_expired");
});

test("remote channel drift fails closed", () => {
  const pool = makePool();
  const result = isCandidateEligible(pool.candidates[0], pool, {
    now: "2026-08-14T00:00:00.000Z",
    statsByVideoId: { "video-a": { views: 10000000, channelId: "attacker", privacyStatus: "public" } },
  });
  assert.deepEqual(result, { eligible: false, reason: "remote_channel_mismatch" });
});

test("topic affinity can outrank a larger but irrelevant title", () => {
  const pool = makePool();
  const audio = scoreCandidate(pool.candidates[0], pool, { now: "2026-08-14T00:00:00.000Z", topicTags: ["audio"], seed: "x" });
  const irrelevant = scoreCandidate(pool.candidates[1], pool, { now: "2026-08-14T00:00:00.000Z", topicTags: ["audio"], seed: "x" });
  assert.ok(audio.score > irrelevant.score);
});

test("selection is deterministic for the same story and seed", () => {
  const pool = makePool();
  pool.selection_policy.top_band_size = 3;
  const first = selectCurrentReleaseFootage(pool, { now: "2026-08-14T00:00:00.000Z", storyId: "story", topicTags: ["audio"], seed: "fixed" });
  const second = selectCurrentReleaseFootage(pool, { now: "2026-08-14T00:00:00.000Z", storyId: "story", topicTags: ["audio"], seed: "fixed" });
  assert.equal(first.selected.id, second.selected.id);
});

test("assignment enforces the configured cooldown", () => {
  const pool = makePool();
  pool.selection_policy.top_band_size = 1;
  const stories = [
    { story_id: "one", topic_tags: ["audio"] },
    { story_id: "two", topic_tags: ["audio"] },
    { story_id: "three", topic_tags: ["audio"] },
  ];
  const assignments = assignCurrentReleaseFootage(pool, stories, { now: "2026-08-14T00:00:00.000Z", seed: "cooldown" });
  assert.equal(new Set(assignments.map((row) => row.selected.id)).size, 3);
});


test("current-release snapshots expire at the configured age", () => {
  const pool = makePool();
  assert.deepEqual(
    isPoolSnapshotFresh(pool, { now: "2026-08-14T23:59:59.000Z" }),
    { fresh: true, ageHours: 23.999722, maxAgeHours: 24 },
  );
  assert.deepEqual(
    isPoolSnapshotFresh(pool, { now: "2026-08-15T00:00:01.000Z" }),
    { fresh: false, ageHours: 24.000278, maxAgeHours: 24 },
  );
});

test("validatePool rejects a pool without a bounded freshness contract", () => {
  const pool = makePool();
  delete pool.selection_policy.max_snapshot_age_hours;
  assert.throws(() => validatePool(pool), /max_snapshot_age_hours/);
});

test("a refreshed snapshot with the wrong official channel fails closed", () => {
  const pool = makePool();
  pool.candidates[0].snapshot.channel_id = "unexpected-channel";
  pool.candidates[0].snapshot.privacy_status = "public";
  const result = isCandidateEligible(pool.candidates[0], pool, {
    now: "2026-08-14T00:00:00.000Z",
  });
  assert.deepEqual(result, {
    eligible: false,
    reason: "snapshot_channel_mismatch",
  });
});

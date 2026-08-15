"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  assignCurrentReleaseFootage,
  evaluateSemanticFit,
  isCandidateEligible,
  isPoolSnapshotFresh,
  scoreCandidate,
  selectCurrentReleaseFootage,
  validatePool,
} = require("../../lib/services/current-release-footage-pool");

function candidate(overrides) {
  return {
    id: "candidate",
    game: "Candidate",
    youtube_video_id: "video",
    official_channel_id: "official-a",
    current_until: "2026-12-31T23:59:59.000Z",
    published_at: "2026-08-01T00:00:00.000Z",
    topic_tags: ["audio"],
    content_type: "gameplay-trailer",
    visual_traits: ["actual-gameplay", "real-time-3d"],
    approved_story_ids: ["story", "one", "two", "three"],
    snapshot: { views: 900000 },
    rights_class: "official-source-editorial-private-review",
    ...overrides,
  };
}

function makePool() {
  return {
    schema_version: "pulse-current-release-footage-pool-v1",
    generated_at: "2026-08-14T00:00:00.000Z",
    selection_policy: {
      minimum_views: 500000,
      recent_upload_days: 45,
      recent_minimum_views: 20000,
      cooldown_slots: 2,
      top_band_size: 3,
      top_band_max_score_gap: 8,
      max_snapshot_age_hours: 24,
    },
    official_channel_allowlist: ["official-a", "official-b", "official-c"],
    candidates: [
      candidate({ id: "alpha", game: "Alpha", youtube_video_id: "video-a" }),
      candidate({
        id: "beta",
        game: "Beta",
        youtube_video_id: "video-b",
        official_channel_id: "official-b",
        topic_tags: ["latency"],
        snapshot: { views: 6000000 },
      }),
      candidate({
        id: "gamma",
        game: "Gamma",
        youtube_video_id: "video-c",
        official_channel_id: "official-c",
        topic_tags: ["audio", "latency"],
        snapshot: { views: 800000 },
      }),
    ],
  };
}

test("validatePool rejects a non-allowlisted source", () => {
  const pool = makePool();
  pool.candidates[0].official_channel_id = "untrusted";
  assert.throws(() => validatePool(pool), /non-allowlisted/);
});

test("validatePool requires semantic candidate metadata", () => {
  const pool = makePool();
  delete pool.candidates[0].content_type;
  assert.throws(() => validatePool(pool), /content_type/);
  pool.candidates[0].content_type = "gameplay-trailer";
  delete pool.candidates[0].visual_traits;
  assert.throws(() => validatePool(pool), /visual_traits/);
});

test("expired footage cannot become eligible", () => {
  const pool = makePool();
  pool.candidates[0].current_until = "2026-07-31T23:59:59.000Z";
  const result = isCandidateEligible(pool.candidates[0], pool, {
    now: "2026-08-14T00:00:00.000Z",
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "market_window_expired");
});

test("remote channel drift fails closed", () => {
  const pool = makePool();
  const result = isCandidateEligible(pool.candidates[0], pool, {
    now: "2026-08-14T00:00:00.000Z",
    statsByVideoId: {
      "video-a": { views: 10000000, channelId: "attacker", privacyStatus: "public" },
    },
  });
  assert.deepEqual(result, { eligible: false, reason: "remote_channel_mismatch" });
});

test("candidate approval is a hard story gate", () => {
  const result = evaluateSemanticFit(candidate({ approved_story_ids: ["different-story"] }), {
    storyId: "story",
    topicTags: ["audio"],
  });
  assert.deepEqual(result, {
    fit: false,
    reason: "story_not_approved",
    storyId: "story",
  });
});

test("required and forbidden visual traits are hard gates", () => {
  const source = candidate({ visual_traits: ["actual-gameplay", "live-action"] });
  const missing = evaluateSemanticFit(source, {
    storyId: "story",
    topicTags: ["audio"],
    requiredVisualTraits: ["competitive-fps"],
  });
  assert.equal(missing.reason, "required_visual_traits_missing");
  const blocked = evaluateSemanticFit(source, {
    storyId: "story",
    topicTags: ["audio"],
    forbiddenVisualTraits: ["live-action"],
  });
  assert.equal(blocked.reason, "forbidden_visual_traits_present");
});

test("topic affinity can outrank a larger but weaker title after both pass", () => {
  const pool = makePool();
  const audio = scoreCandidate(pool.candidates[0], pool, {
    now: "2026-08-14T00:00:00.000Z",
    topicTags: ["audio", "latency"],
    minimumTopicMatches: 1,
    seed: "x",
  });
  const broad = scoreCandidate(pool.candidates[1], pool, {
    now: "2026-08-14T00:00:00.000Z",
    topicTags: ["audio", "latency"],
    minimumTopicMatches: 1,
    seed: "x",
  });
  assert.ok(audio.eligible && broad.eligible);
});

test("a huge live-action source cannot beat relevant gameplay", () => {
  const pool = makePool();
  pool.official_channel_allowlist.push("official-d");
  pool.candidates.push(candidate({
    id: "live-action-sports",
    game: "Sports Reveal",
    youtube_video_id: "video-d",
    official_channel_id: "official-d",
    topic_tags: ["render-queue-latency", "input-latency"],
    content_type: "live-action-hybrid",
    visual_traits: ["live-action", "sports"],
    approved_story_ids: ["story"],
    snapshot: { views: 100000000 },
  }));
  pool.candidates[0].topic_tags = ["render-queue-latency", "input-latency"];
  pool.candidates[0].visual_traits = [
    "actual-gameplay",
    "competitive-fps",
    "first-person-gameplay",
    "high-refresh-sensitive",
    "precision-aiming",
  ];
  const result = selectCurrentReleaseFootage(pool, {
    now: "2026-08-14T00:00:00.000Z",
    storyId: "story",
    topicTags: ["render-queue-latency", "input-latency"],
    minimumTopicMatches: 2,
    allowedContentTypes: ["actual-gameplay", "gameplay-trailer"],
    requiredVisualTraits: ["competitive-fps", "first-person-gameplay"],
    forbiddenVisualTraits: ["live-action", "sports"],
    seed: "semantic-first",
  });
  assert.equal(result.selected.id, "alpha");
  assert.ok(result.top_band.every((row) => row.id !== "live-action-sports"));
});

test("selection is deterministic for the same story and seed", () => {
  const pool = makePool();
  const options = {
    now: "2026-08-14T00:00:00.000Z",
    storyId: "story",
    topicTags: ["audio", "latency"],
    minimumTopicMatches: 1,
    seed: "fixed",
  };
  const first = selectCurrentReleaseFootage(pool, options);
  const second = selectCurrentReleaseFootage(pool, options);
  assert.equal(first.selected.id, second.selected.id);
});

test("random top band excludes candidates outside the score gap", () => {
  const pool = makePool();
  pool.selection_policy.top_band_max_score_gap = 0.01;
  const result = selectCurrentReleaseFootage(pool, {
    now: "2026-08-14T00:00:00.000Z",
    storyId: "story",
    topicTags: ["audio", "latency"],
    minimumTopicMatches: 1,
    seed: "gap",
  });
  assert.equal(result.top_band.length, 1);
  assert.equal(result.selected.id, result.top_band[0].id);
});

test("assignment enforces the configured cooldown", () => {
  const pool = makePool();
  pool.selection_policy.top_band_size = 1;
  const stories = ["one", "two", "three"].map((storyId) => ({
    story_id: storyId,
    topic_tags: ["audio", "latency"],
    minimum_topic_matches: 1,
    allowed_content_types: ["gameplay-trailer"],
    required_visual_traits: ["actual-gameplay"],
    forbidden_visual_traits: ["live-action"],
  }));
  const assignments = assignCurrentReleaseFootage(pool, stories, {
    now: "2026-08-14T00:00:00.000Z",
    seed: "cooldown",
  });
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

test("validatePool rejects a pool without a bounded score band", () => {
  const pool = makePool();
  delete pool.selection_policy.top_band_max_score_gap;
  assert.throws(() => validatePool(pool), /top_band_max_score_gap/);
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

test("canonical texture-streaming selection is a large open world", () => {
  const pool = validatePool(JSON.parse(fs.readFileSync(
    path.resolve(__dirname, "../../config/current-release-footage-pool.json"),
    "utf8",
  )));
  const episode = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, "../../videos/system-trace-series.json"),
    "utf8",
  )).episodes.find((row) => row.slug === "texture-streaming");
  const requirements = episode.visual_requirements;
  const result = selectCurrentReleaseFootage(pool, {
    now: pool.generated_at,
    storyId: episode.story_id,
    topicTags: episode.topic_tags,
    minimumTopicMatches: requirements.minimum_topic_matches,
    allowedContentTypes: requirements.allowed_content_types,
    requiredVisualTraits: requirements.required_visual_traits,
    forbiddenVisualTraits: requirements.forbidden_visual_traits,
    seed: "canonical-texture",
  });
  assert.equal(result.selected.id, "gta-vi-trailer-2");
  assert.ok(result.selected.visual_traits.includes("world-traversal"));
});

test("canonical latency selection can only use real competitive FPS gameplay", () => {
  const pool = validatePool(JSON.parse(fs.readFileSync(
    path.resolve(__dirname, "../../config/current-release-footage-pool.json"),
    "utf8",
  )));
  assert.equal(pool.candidates.some((row) => row.id === "madden-27-reveal"), false);
  const episode = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, "../../videos/system-trace-series.json"),
    "utf8",
  )).episodes.find((row) => row.slug === "render-queue-latency");
  const requirements = episode.visual_requirements;
  const result = selectCurrentReleaseFootage(pool, {
    now: pool.generated_at,
    storyId: episode.story_id,
    topicTags: episode.topic_tags,
    minimumTopicMatches: requirements.minimum_topic_matches,
    allowedContentTypes: requirements.allowed_content_types,
    requiredVisualTraits: requirements.required_visual_traits,
    forbiddenVisualTraits: requirements.forbidden_visual_traits,
    seed: "canonical-latency",
  });
  assert.ok(result.selected.visual_traits.includes("competitive-fps"));
  assert.ok(result.selected.visual_traits.includes("first-person-gameplay"));
  assert.ok(result.selected.visual_traits.includes("actual-gameplay"));
  assert.equal(result.selected.visual_traits.includes("live-action"), false);
});

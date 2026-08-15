"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  chooseClipWindow,
  deriveCurrentReleaseTopicTags,
  deriveCurrentReleaseVisualRequirements,
  fetchFallbackBroll,
  fetchCurrentReleaseIllustrativeBroll,
  requiresCurrentReleaseIllustrativeBroll,
} = require("../../fetch_broll");

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
      top_band_max_score_gap: 8,
      max_snapshot_age_hours: 24,
    },
    official_channel_allowlist: ["official-a", "official-b"],
    candidates: [
      {
        id: "alpha",
        game: "Alpha Release",
        youtube_video_id: "video-a",
        youtube_url: "https://youtube.test/watch?v=video-a",
        official_channel: "Official A",
        official_channel_id: "official-a",
        source_title: "Alpha official gameplay",
        current_until: "2026-12-31T23:59:59.000Z",
        published_at: "2026-08-01T00:00:00.000Z",
        topic_tags: ["spatial-audio"],
        content_type: "gameplay-trailer",
        visual_traits: ["actual-gameplay", "real-time-3d"],
        approved_story_ids: [
          "system-trace-audio",
          "system-trace-expired",
          "system-trace-live",
          "system-trace-stale",
        ],
        start_offset_s: 8,
        snapshot: { views: 1000000 },
        rights_class: "official-source-editorial-private-review",
      },
      {
        id: "beta",
        game: "Beta Release",
        youtube_video_id: "video-b",
        youtube_url: "https://youtube.test/watch?v=video-b",
        official_channel: "Official B",
        official_channel_id: "official-b",
        source_title: "Beta official gameplay",
        current_until: "2026-12-31T23:59:59.000Z",
        published_at: "2026-08-02T00:00:00.000Z",
        topic_tags: ["spatial-audio", "combat"],
        content_type: "gameplay-trailer",
        visual_traits: ["actual-gameplay", "real-time-3d"],
        approved_story_ids: [
          "system-trace-audio",
          "system-trace-expired",
          "system-trace-live",
          "system-trace-stale",
        ],
        start_offset_s: 12,
        snapshot: { views: 900000 },
        rights_class: "official-source-editorial-private-review",
      },
    ],
  };
}

test("System Trace and explicit policy require current-release illustrative footage", () => {
  assert.equal(
    requiresCurrentReleaseIllustrativeBroll({ series: "SYSTEM TRACE" }),
    true,
  );
  assert.equal(
    requiresCurrentReleaseIllustrativeBroll({
      visual_policy: { mode: "current-release-illustrative" },
    }),
    true,
  );
  assert.equal(requiresCurrentReleaseIllustrativeBroll({ title: "Ordinary news" }), false);
});

test("topic tags are derived from the technical subject rather than the headline game", () => {
  assert.deepEqual(
    deriveCurrentReleaseTopicTags({
      title: "How Headphones Put Sounds Behind You",
      full_script: "Spatial audio uses HRTF filters and left-right timing.",
    }),
    ["spatial-audio"],
  );
  assert.deepEqual(
    deriveCurrentReleaseTopicTags({
      title: "Why More FPS Does Not Always Mean Faster Input",
      full_script: "Input latency can grow inside a render queue.",
    }),
    ["render-queue-latency", "input-latency"],
  );
});

test("current-release selection returns distinct official sources with bounded windows", async () => {
  const calls = [];
  const downloader = async (youtubeId, filename, source, options) => {
    calls.push({ youtubeId, filename, source, options });
    return { path: `output/video_cache/${filename}`, source };
  };
  const clips = await fetchCurrentReleaseIllustrativeBroll(
    {
      id: "system-trace-audio",
      series: "SYSTEM TRACE",
      title: "How Headphones Put Sounds Behind You",
      full_script: "Spatial audio uses HRTF filters.",
    },
    {
      pool: makePool(),
      downloader,
      now: "2026-08-14T00:00:00.000Z",
      maxClips: 2,
      seed: "fixed",
    },
  );
  assert.equal(clips.length, 2);
  assert.equal(new Set(clips.map((clip) => clip.current_release_candidate_id)).size, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.maxSeconds, 12);
  assert.equal(calls[0].options.muteSourceAudio, true);
  assert.ok([8, 12].includes(calls[0].options.preferredStart));
  assert.match(calls[0].filename, /_s(?:8|12)_muted\.mp4$/);
  assert.match(clips[0].source_label, /^ILLUSTRATIVE GAMEPLAY: /);
  assert.equal(clips[0].public_rights_review_required, true);
  assert.equal(clips[0].source_audio, "muted");
});

test("current-release mode fails closed instead of using a generic fallback", async () => {
  const pool = makePool();
  pool.candidates.forEach((candidate) => {
    candidate.current_until = "2026-08-01T00:00:00.000Z";
  });
  await assert.rejects(
    fetchFallbackBroll(
      {
        id: "system-trace-expired",
        series: "SYSTEM TRACE",
        title: "How Games Work",
        full_script: "A technical explainer.",
      },
      {
        pool,
        downloader: async () => {
          throw new Error("downloader must never run");
        },
        now: "2026-08-14T00:00:00.000Z",
      },
    ),
    /no eligible current-release footage candidate/i,
  );
});

test("preferred current-release windows remain inside source duration", () => {
  assert.deepEqual(
    chooseClipWindow(90, { maxSeconds: 12, preferredStart: 30 }),
    { start: 30, end: 42 },
  );
  assert.deepEqual(
    chooseClipWindow(35, { maxSeconds: 12, preferredStart: 30 }),
    { start: 23, end: 35 },
  );
});

test("ordinary named-game stories retain the legacy fallback mode", () => {
  assert.equal(
    requiresCurrentReleaseIllustrativeBroll({
      id: "news-1",
      title: "Resident Evil Requiem gets a new trailer",
      full_script: "Resident Evil Requiem has a new trailer.",
    }),
    false,
  );
});

test("System Trace manifest permanently requires the governed current-release policy", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const manifest = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../../videos/system-trace-series.json"),
      "utf8",
    ),
  );
  assert.equal(manifest.series_id, "system-trace");
  assert.equal(manifest.channel_id, "pulse-gaming");
  assert.equal(manifest.visual_policy.mode, "current-release-illustrative");
  assert.equal(manifest.visual_policy.official_sources_only, true);
  assert.equal(manifest.visual_policy.fail_closed_if_no_eligible_source, true);
  assert.equal(manifest.visual_policy.semantic_fit_hard_gate, true);
  assert.equal(manifest.visual_policy.popularity_applied_after_semantic_fit, true);
  assert.equal(manifest.visual_policy.candidate_story_approval_required, true);
  assert.equal(manifest.visual_policy.content_type_validation_required, true);
  assert.equal(manifest.visual_policy.visual_trait_validation_required, true);
  assert.equal(manifest.visual_policy.live_action_blocked_unless_topic_requires_it, true);
  assert.equal(manifest.visual_policy.top_band_max_score_gap, 8);
  assert.equal(manifest.episodes.length, 7);
  for (const episode of manifest.episodes) {
    assert.equal(episode.series_id, "system-trace");
    assert.equal(episode.visual_mode, "current-release-illustrative");
    assert.ok(Array.isArray(episode.topic_tags) && episode.topic_tags.length > 0);
    assert.equal(episode.story_id, `system-trace-${episode.slug}`);
    assert.ok(episode.visual_requirements);
    assert.ok(Array.isArray(episode.visual_requirements.allowed_content_types));
    assert.ok(Array.isArray(episode.visual_requirements.required_visual_traits));
    assert.ok(Array.isArray(episode.visual_requirements.forbidden_visual_traits));
  }
});

test("stale current-release snapshots HOLD when live refresh is unavailable", async () => {
  const pool = makePool();
  pool.generated_at = "2026-08-10T00:00:00.000Z";
  await assert.rejects(
    fetchCurrentReleaseIllustrativeBroll(
      {
        id: "system-trace-stale",
        series: "SYSTEM TRACE",
        title: "How Headphones Put Sounds Behind You",
        full_script: "Spatial audio uses HRTF filters.",
      },
      {
        pool,
        downloader: async () => ({ path: "must-not-run.mp4" }),
        now: "2026-08-14T00:00:00.000Z",
        disableLiveStats: true,
      },
    ),
    /pool snapshot is stale/i,
  );
});

test("live source identity and views can refresh a stale pool safely", async () => {
  const pool = makePool();
  pool.generated_at = "2026-08-10T00:00:00.000Z";
  const statsByVideoId = Object.fromEntries(
    pool.candidates.map((candidate) => [
      candidate.youtube_video_id,
      {
        views: candidate.snapshot.views + 1000,
        channelId: candidate.official_channel_id,
        privacyStatus: "public",
      },
    ]),
  );
  const clips = await fetchCurrentReleaseIllustrativeBroll(
    {
      id: "system-trace-live",
      series: "SYSTEM TRACE",
      title: "How Headphones Put Sounds Behind You",
      full_script: "Spatial audio uses HRTF filters.",
    },
    {
      pool,
      statsByVideoId,
      downloader: async (_id, filename, source) => ({ path: filename, source }),
      now: "2026-08-14T00:00:00.000Z",
      maxClips: 1,
    },
  );
  assert.equal(clips.length, 1);
  assert.equal(clips[0].selection_stats_source, "live_or_injected");
  assert.equal(clips[0].pool_snapshot_age_hours, 96);
});

test("visual requirements are normalised from the System Trace manifest shape", () => {
  assert.deepEqual(
    deriveCurrentReleaseVisualRequirements({
      visual_requirements: {
        minimum_topic_matches: 2,
        allowed_content_types: ["gameplay-trailer"],
        required_visual_traits: ["competitive-fps"],
        forbidden_visual_traits: ["live-action"],
      },
    }),
    {
      minimumTopicMatches: 2,
      allowedContentTypes: ["gameplay-trailer"],
      requiredVisualTraits: ["competitive-fps"],
      forbiddenVisualTraits: ["live-action"],
    },
  );
});

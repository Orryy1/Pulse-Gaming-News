"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  GOAL11_REQUIRED_METRICS,
  buildGoal11RetentionIntelligenceLoop,
  writeGoal11RetentionIntelligenceLoop,
} = require("../../lib/goal11-retention-intelligence-loop");

async function makeStoryPackage(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: overrides.title || "This gaming story",
    title: overrides.title || "This gaming story",
    canonical_subject: overrides.subject || "The Expanse: Osiris Reborn",
    canonical_angle: "Confirmed Drop",
    first_spoken_line:
      overrides.first_spoken_line ||
      "The Expanse: Osiris Reborn finally showed real gameplay.",
    narration_script:
      overrides.narration_script ||
      "The Expanse: Osiris Reborn finally showed real gameplay. Follow Pulse Gaming for the gaming stories behind the headline.",
    primary_source: overrides.primary_source || "",
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    shot_plan: [
      {
        id: "opener",
        kind: "opener",
        type: "opener",
        startS: 0,
        durationS: 3.6,
        source: "expanse-trailer.mp4",
        mediaStartS: 12.5,
        text: overrides.first_frame_text || "THE EXPANSE GAMEPLAY CLAIM NEEDS PROOF",
      },
      {
        id: "repeat",
        kind: "clip",
        type: "clip",
        startS: 3.6,
        durationS: 4,
        source: "expanse-trailer.mp4",
        mediaStartS: 12.5,
      },
      {
        id: "source",
        kind: "source_lock",
        type: "card.source",
        startS: 7.6,
        durationS: 5.8,
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    rendered_duration_s: overrides.durationS || 40,
    final_publish_render: true,
    clips: 4,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    operating_mode: "DRY_RUN_PUBLISH",
    outputs: overrides.platform_outputs || {
      youtube_shorts: { cta_style: "identity_follow" },
      instagram_reels: { cta_style: "" },
    },
    platform_native_evidence: { verdict: overrides.platform_verdict || "pass" },
  });
  await fs.outputJson(path.join(artifactDir, "benchmark_report.json"), {
    result: overrides.benchmark_result || "pass",
  });
  await fs.outputJson(path.join(artifactDir, "visual_quality_report.json"), {
    result: "pass",
    scores: {
      motion_density_score: overrides.motionDensityScore ?? 82,
      first_3_seconds_hook_score: overrides.firstThreeScore ?? 84,
      source_lock_quality_score: overrides.sourceLockScore ?? 72,
    },
    thresholds: {
      motion_density_score: 75,
      first_3_seconds_hook_score: 75,
      source_lock_quality_score: 65,
    },
  });
  await fs.outputJson(path.join(artifactDir, "analytics_ingest_plan.json"), {
    status: "planned_only",
    read_only: true,
  });
  return {
    story_id: storyId,
    title: overrides.title || "This gaming story",
    artifact_dir: artifactDir,
  };
}

function completeMetrics(storyId, overrides = {}) {
  return {
    story_id: storyId,
    video_id: `yt-${storyId}`,
    public_post_id: overrides.public_post_id || `yt-${storyId}`,
    platform: "youtube_shorts",
    observed_at: overrides.observed_at || "2026-05-25T12:00:00.000Z",
    views: overrides.views ?? 1200,
    impressions: overrides.impressions ?? 5100,
    average_view_duration_seconds: overrides.average_view_duration_seconds ?? 12.4,
    retention_curve:
      overrides.retention_curve ||
      [
        { elapsed_video_time_ratio: 0, audience_watch_ratio: 1 },
        { elapsed_video_time_ratio: 0.075, audience_watch_ratio: 0.61 },
        { elapsed_video_time_ratio: 0.15, audience_watch_ratio: 0.52 },
        { elapsed_video_time_ratio: 0.35, audience_watch_ratio: 0.36 },
      ],
    first_3_second_drop_off: overrides.first_3_second_drop_off ?? 0.39,
    stayed_to_watch: overrides.stayed_to_watch ?? 37,
    swipe_away: overrides.swipe_away ?? 63,
    replays: overrides.replays ?? 21,
    likes: overrides.likes ?? 22,
    comments: overrides.comments ?? 3,
    shares: overrides.shares ?? 4,
    saves: overrides.saves ?? 1,
    follows: overrides.follows ?? 0,
    clicks: overrides.clicks ?? 6,
    landing_visits: overrides.landing_visits ?? 2,
    revenue: overrides.revenue ?? 0.18,
    traffic_rows:
      overrides.traffic_rows ||
      [
        {
          traffic_source_type: "SHORTS",
          views: overrides.views ?? 1200,
          average_view_duration_seconds: overrides.average_view_duration_seconds ?? 12.4,
          average_percentage_viewed: 54,
        },
      ],
  };
}

function markStoryPublished(story, overrides = {}) {
  story.youtube_post_id = overrides.public_post_id || `yt-${story.story_id}`;
  story.youtube_published_at = overrides.published_at || "2026-05-20T12:00:00.000Z";
  return story;
}

test("Goal 11 keeps an upstream-blocked verified draft pending until performance is observable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal11-missing-"));
  const story = await makeStoryPackage(root, "story-upstream", {
    title: "The Expanse Shows Real Gameplay",
    primary_source: "Xbox",
    first_frame_text: "EXPANSE GAMEPLAY",
    platform_outputs: {
      youtube_shorts: { cta_style: "identity_follow" },
      instagram_reels: { cta_style: "bio_link" },
      facebook_reels: { cta_style: "follow_page" },
    },
  });
  await fs.outputJson(path.join(story.artifact_dir, "director_beat_map.json"), {
    shot_plan: [
      {
        id: "opener",
        kind: "opener",
        type: "opener",
        startS: 0,
        durationS: 2.4,
        source: "expanse-trailer-a.mp4",
        mediaStartS: 12.5,
        text: "EXPANSE GAMEPLAY",
      },
      {
        id: "clip-b",
        kind: "clip",
        type: "clip",
        startS: 2.4,
        durationS: 3,
        source: "expanse-trailer-b.mp4",
        mediaStartS: 31,
      },
      {
        id: "source",
        kind: "source_lock",
        type: "card.source",
        startS: 5.4,
        durationS: 2.2,
      },
    ],
  });

  const report = await buildGoal11RetentionIntelligenceLoop({
    storyPackages: [story],
    upstreamBenchmarkReport: {
      stories: [
        {
          story_id: "story-upstream",
          status: "blocked",
          blockers: ["benchmark_pack:commercial_and_affiliate_mechanics_missing"],
        },
      ],
    },
    metricsManifest: { stories: [] },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T00:05:54.376Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.retention_ready_story_count, 0);
  assert.equal(report.summary.metrics_ready_story_count, 0);
  assert.equal(report.summary.analytics_missing_story_count, 0);
  assert.equal(report.summary.analytics_pending_story_count, 1);
  assert.equal(report.summary.upstream_blocked_story_count, 1);
  assert.equal(report.summary.static_diagnosis_story_count, 1);
  assert.equal(report.stories[0].direct_retention_status, "pass");
  assert.equal(report.stories[0].publication_phase, "prepublication");
  assert.equal(
    report.stories[0].performance_evidence_status,
    "pending_not_yet_observable",
  );
  assert.ok(report.stories[0].blockers.includes("upstream:goal10_gold_standard_forensics_blocked"));
  assert.ok(!report.stories[0].blockers.includes("retention:analytics_missing"));
  assert.equal(report.stories[0].missing_metrics.length, GOAL11_REQUIRED_METRICS.length);
  assert.equal(report.learning_rules.status, "blocked_pending_analytics");
  assert.equal(report.experiment_results.status, "not_started");
  assert.equal(report.safety.no_external_posting, true);
  assert.equal(report.safety.no_oauth_or_token_change, true);
});

test("Goal 11 turns complete local retention metrics into diagnoses, rules and recommendations", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal11-metrics-"));
  const story = await makeStoryPackage(root, "story-metrics", {
    title: "This gaming story",
    primary_source: "",
    motionDensityScore: 60,
    sourceLockScore: 52,
  });
  markStoryPublished(story);

  const report = await buildGoal11RetentionIntelligenceLoop({
    storyPackages: [story],
    upstreamBenchmarkReport: {
      stories: [{ story_id: "story-metrics", status: "ready", blockers: [] }],
    },
    metricsManifest: { stories: [completeMetrics("story-metrics")] },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T00:05:54.376Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.metrics_ready_story_count, 1);
  assert.equal(report.summary.analytics_missing_story_count, 0);
  assert.equal(report.summary.upstream_blocked_story_count, 0);
  assert.equal(report.stories[0].direct_retention_status, "blocked");
  assert.ok(report.stories[0].diagnoses.some((item) => item.dimension === "weak_hooks"));
  assert.ok(report.stories[0].diagnoses.some((item) => item.dimension === "title"));
  assert.ok(report.stories[0].diagnoses.some((item) => item.dimension === "pacing"));
  assert.ok(report.stories[0].diagnoses.some((item) => item.dimension === "source_clarity"));
  assert.ok(report.stories[0].diagnoses.some((item) => item.dimension === "repeated_structure"));
  assert.ok(
    report.learning_rules.rules.some(
      (rule) => rule.id === "tighten_first_three_seconds",
    ),
  );
  assert.ok(
    report.future_render_recommendations.stories[0].recommendations.some(
      (recommendation) => recommendation.id === "replace_repeated_clip_windows",
    ),
  );
  assert.equal(report.retention_report.stories[0].required_metrics_present, true);
  assert.equal(report.experiment_results.status, "planned_only");
});

test("Goal 11 treats clean pre-publish candidates without live metrics as analytics-pending, not blocked", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal11-prepublish-"));
  const readyStory = await makeStoryPackage(root, "story-ready", {
    title: "The Expanse Shows Real Gameplay",
    primary_source: "Xbox",
    first_frame_text: "EXPANSE GAMEPLAY",
    platform_outputs: {
      youtube_shorts: { cta_style: "identity_follow" },
      instagram_reels: { cta_style: "bio_link" },
      facebook_reels: { cta_style: "follow_page" },
    },
  });
  const skippedStory = await makeStoryPackage(root, "story-skipped", {
    motionDensityScore: 44,
  });
  await fs.outputJson(path.join(readyStory.artifact_dir, "director_beat_map.json"), {
    shot_plan: [
      {
        id: "opener",
        kind: "opener",
        type: "opener",
        startS: 0,
        durationS: 2.4,
        source: "expanse-trailer-a.mp4",
        mediaStartS: 12.5,
        text: "EXPANSE GAMEPLAY",
      },
      {
        id: "clip-b",
        kind: "clip",
        type: "clip",
        startS: 2.4,
        durationS: 3,
        source: "expanse-trailer-b.mp4",
        mediaStartS: 31,
      },
      {
        id: "source",
        kind: "source_lock",
        type: "card.source",
        startS: 5.4,
        durationS: 2.2,
      },
    ],
  });

  const report = await buildGoal11RetentionIntelligenceLoop({
    storyPackages: [readyStory, skippedStory],
    upstreamBenchmarkReport: {
      stories: [
        { story_id: "story-ready", status: "ready", blockers: [] },
        {
          story_id: "story-skipped",
          status: "skipped",
          skipped_status: "visual_source_deferred",
          skipped_reason: "defer_until_rights_backed_media_available",
          blockers: [],
        },
      ],
    },
    metricsManifest: { stories: [] },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-28T23:58:00.000Z",
  });

  const ready = report.stories.find((story) => story.story_id === "story-ready");
  const skipped = report.stories.find((story) => story.story_id === "story-skipped");

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.story_count, 2);
  assert.equal(report.summary.active_story_count, 1);
  assert.equal(report.summary.skipped_story_count, 1);
  assert.equal(report.summary.retention_ready_story_count, 1);
  assert.equal(report.summary.analytics_pending_story_count, 1);
  assert.equal(report.summary.blocked_story_count, 0);
  assert.equal(ready.status, "ready");
  assert.equal(ready.direct_retention_status, "pass");
  assert.equal(ready.publication_phase, "prepublication");
  assert.equal(ready.performance_evidence_status, "pending_not_yet_observable");
  assert.equal(ready.metrics_status, "pending");
  assert.ok(!ready.blockers.includes("retention:analytics_missing"));
  assert.equal(skipped.status, "skipped");
  assert.deepEqual(report.blocker_counts, {});
  assert.equal(report.learning_rules.status, "pending_live_metrics_static_guidance_ready");
  assert.equal(report.future_render_recommendations.status, "ready_for_future_render_rules");
  assert.ok(
    report.future_render_recommendations.stories
      .find((story) => story.story_id === "story-ready")
      .recommendations.some((recommendation) => recommendation.id === "preserve_current_benchmark_profile_until_live_metrics_arrive"),
  );
});

test("Goal 11 blocks a published story when performance metrics are missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal11-published-missing-"));
  const story = await makeStoryPackage(root, "story-published", {
    title: "The Expanse Shows Real Gameplay",
    primary_source: "Xbox",
    first_frame_text: "EXPANSE GAMEPLAY",
    platform_outputs: {
      youtube_shorts: { cta_style: "identity_follow" },
      instagram_reels: { cta_style: "bio_link" },
      facebook_reels: { cta_style: "follow_page" },
    },
  });
  story.youtube_post_id = "yt-story-published";
  story.youtube_published_at = "2026-05-28T12:00:00.000Z";
  await fs.outputJson(path.join(story.artifact_dir, "director_beat_map.json"), {
    shot_plan: [
      {
        id: "opener",
        kind: "opener",
        type: "opener",
        startS: 0,
        durationS: 2.4,
        source: "expanse-trailer-a.mp4",
        mediaStartS: 12.5,
        text: "EXPANSE GAMEPLAY",
      },
      {
        id: "clip-b",
        kind: "clip",
        type: "clip",
        startS: 2.4,
        durationS: 3,
        source: "expanse-trailer-b.mp4",
        mediaStartS: 31,
      },
      {
        id: "source",
        kind: "source_lock",
        type: "card.source",
        startS: 5.4,
        durationS: 2.2,
      },
    ],
  });

  const report = await buildGoal11RetentionIntelligenceLoop({
    storyPackages: [story],
    upstreamBenchmarkReport: {
      stories: [{ story_id: "story-published", status: "ready", blockers: [] }],
    },
    metricsManifest: { stories: [] },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-30T12:00:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.retention_ready_story_count, 0);
  assert.equal(report.summary.analytics_missing_story_count, 1);
  assert.equal(report.summary.analytics_pending_story_count, 0);
  assert.equal(report.stories[0].publication_phase, "published");
  assert.equal(report.stories[0].performance_evidence_status, "missing_after_publication");
  assert.equal(report.stories[0].direct_retention_status, "blocked");
  assert.ok(report.stories[0].blockers.includes("retention:published_metrics_missing"));
});

test("Goal 11 blocks conflicting publication lifecycle evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal11-lifecycle-conflict-"));
  const story = await makeStoryPackage(root, "story-conflicted", {
    title: "The Expanse Shows Real Gameplay",
    primary_source: "Xbox",
    first_frame_text: "EXPANSE GAMEPLAY",
    platform_outputs: {
      youtube_shorts: { cta_style: "identity_follow" },
      instagram_reels: { cta_style: "bio_link" },
      facebook_reels: { cta_style: "follow_page" },
    },
  });
  story.publication_phase = "prepublication";
  story.youtube_post_id = "yt-story-conflicted";
  story.youtube_published_at = "2026-05-28T12:00:00.000Z";

  const report = await buildGoal11RetentionIntelligenceLoop({
    storyPackages: [story],
    upstreamBenchmarkReport: {
      stories: [{ story_id: "story-conflicted", status: "ready", blockers: [] }],
    },
    metricsManifest: { stories: [] },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-30T12:00:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.stories[0].publication_phase, "conflicted");
  assert.equal(
    report.stories[0].performance_evidence_status,
    "blocked_lifecycle_conflict",
  );
  assert.equal(report.stories[0].direct_retention_status, "blocked");
  assert.ok(
    report.stories[0].blockers.includes("retention:publication_lifecycle_conflict"),
  );
});

test("Goal 11 blocks complete published metrics that are unlinked from the public post", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal11-unlinked-metrics-"));
  const story = await makeStoryPackage(root, "story-unlinked", {
    title: "The Expanse Shows Real Gameplay",
    primary_source: "Xbox",
    first_frame_text: "EXPANSE GAMEPLAY",
    platform_outputs: {
      youtube_shorts: { cta_style: "identity_follow" },
      instagram_reels: { cta_style: "bio_link" },
      facebook_reels: { cta_style: "follow_page" },
    },
  });
  markStoryPublished(story);

  const report = await buildGoal11RetentionIntelligenceLoop({
    storyPackages: [story],
    upstreamBenchmarkReport: {
      stories: [{ story_id: "story-unlinked", status: "ready", blockers: [] }],
    },
    metricsManifest: {
      stories: [
        completeMetrics("story-unlinked", {
          public_post_id: "yt-a-different-public-post",
        }),
      ],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-30T12:00:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.metrics_ready_story_count, 0);
  assert.equal(report.stories[0].metrics_status, "invalid");
  assert.equal(
    report.stories[0].performance_evidence_status,
    "unlinked_after_publication",
  );
  assert.ok(
    report.stories[0].blockers.includes("retention:published_metrics_unlinked"),
  );
  assert.equal(report.experiment_results.experiments.length, 0);
});

test("Goal 11 blocks complete published metrics observed before publication", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal11-stale-metrics-"));
  const story = await makeStoryPackage(root, "story-stale", {
    title: "The Expanse Shows Real Gameplay",
    primary_source: "Xbox",
    first_frame_text: "EXPANSE GAMEPLAY",
    platform_outputs: {
      youtube_shorts: { cta_style: "identity_follow" },
      instagram_reels: { cta_style: "bio_link" },
      facebook_reels: { cta_style: "follow_page" },
    },
  });
  markStoryPublished(story, { published_at: "2026-05-20T12:00:00.000Z" });

  const report = await buildGoal11RetentionIntelligenceLoop({
    storyPackages: [story],
    upstreamBenchmarkReport: {
      stories: [{ story_id: "story-stale", status: "ready", blockers: [] }],
    },
    metricsManifest: {
      stories: [
        completeMetrics("story-stale", {
          observed_at: "2026-05-19T12:00:00.000Z",
        }),
      ],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-30T12:00:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.metrics_ready_story_count, 0);
  assert.equal(report.stories[0].metrics_status, "invalid");
  assert.equal(
    report.stories[0].performance_evidence_status,
    "stale_after_publication",
  );
  assert.ok(
    report.stories[0].blockers.includes("retention:published_metrics_stale"),
  );
  assert.equal(report.experiment_results.experiments.length, 0);
});

test("Goal 11 reports shallow platform snapshots without treating them as retention proof", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal11-shallow-"));
  const story = await makeStoryPackage(root, "story-shallow", {
    title: "Halo Campaign Evolved Makes PS5 Real",
    primary_source: "YouTube",
    first_frame_text: "HALO PS5",
    platform_outputs: {
      youtube_shorts: { cta_style: "identity_follow" },
      instagram_reels: { cta_style: "bio_link" },
      facebook_reels: { cta_style: "follow_page" },
    },
  });
  markStoryPublished(story);
  await fs.outputJson(path.join(story.artifact_dir, "director_beat_map.json"), {
    shot_plan: [
      {
        id: "opener",
        kind: "opener",
        type: "opener",
        startS: 0,
        durationS: 2.4,
        source: "halo-campaign-a.mp4",
        mediaStartS: 12.5,
        text: "HALO PS5",
      },
      {
        id: "clip-b",
        kind: "clip",
        type: "clip",
        startS: 2.4,
        durationS: 3,
        source: "halo-campaign-b.mp4",
        mediaStartS: 31,
      },
      {
        id: "source",
        kind: "source_lock",
        type: "card.source",
        startS: 5.4,
        durationS: 2.2,
      },
    ],
  });

  const report = await buildGoal11RetentionIntelligenceLoop({
    storyPackages: [story],
    upstreamBenchmarkReport: {
      stories: [{ story_id: "story-shallow", status: "ready", blockers: [] }],
    },
    metricsManifest: {
      source: "sqlite_platform_metric_snapshots_read_only",
      stories: [
        {
          story_id: "story-shallow",
          platform: "youtube",
          video_id: "yt-story-shallow",
          snapshot_at: "2026-06-11T11:00:00.000Z",
          views: 807,
          likes: 4,
          comments: 0,
          shares: null,
          partial_metrics_only: true,
          analytics_depth: "shallow_platform_snapshot",
        },
      ],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-06-11T12:15:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.stories[0].metrics_status, "shallow");
  assert.equal(report.stories[0].performance_evidence_status, "incomplete_after_publication");
  assert.ok(
    report.stories[0].direct_retention_blockers.includes(
      "retention:published_metrics_incomplete",
    ),
  );
  assert.equal(report.daily_retention_report.summary.analytics_observed_story_count, 1);
  assert.equal(report.daily_retention_report.platforms[0].platform, "youtube");
  assert.equal(report.daily_retention_report.platforms[0].total_views, 807);
  assert.equal(report.title_pattern_winners.patterns.length, 0);
  assert.equal(report.hook_pattern_winners.patterns.length, 0);
});

test("Goal 11 writes required retention loop artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal11-write-"));
  const story = await makeStoryPackage(root, "story-write");
  markStoryPublished(story);
  const outputDir = path.join(root, "out");
  const report = await buildGoal11RetentionIntelligenceLoop({
    storyPackages: [story],
    upstreamBenchmarkReport: {
      stories: [{ story_id: "story-write", status: "ready", blockers: [] }],
    },
    metricsManifest: { stories: [completeMetrics("story-write")] },
    workspaceRoot: root,
    outputDir,
    generatedAt: "2026-05-26T00:05:54.376Z",
  });

  const written = await writeGoal11RetentionIntelligenceLoop(report, { outputDir });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.retentionReport), true);
  assert.equal(await fs.pathExists(written.learningRules), true);
  assert.equal(await fs.pathExists(written.futureRenderRecommendations), true);
  assert.equal(await fs.pathExists(written.experimentResults), true);
  const retentionReport = await fs.readJson(written.retentionReport);
  assert.equal(retentionReport.stories[0].story_id, "story-write");
});

test("Goal 11 writes v2 daily learning artefacts for winners, recommendations and kill-list", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal11-v2-"));
  const strongStory = await makeStoryPackage(root, "story-winner", {
    title: "Forza Horizon 6 Just Broke Steam",
    primary_source: "Steam",
    first_frame_text: "FORZA STEAM",
    platform_outputs: {
      youtube_shorts: { cta_style: "identity_follow" },
      instagram_reels: { cta_style: "bio_link" },
      facebook_reels: { cta_style: "follow_page" },
    },
  });
  markStoryPublished(strongStory);
  await fs.outputJson(path.join(strongStory.artifact_dir, "director_beat_map.json"), {
    shot_plan: [
      { id: "opener", kind: "opener", type: "opener", startS: 0, durationS: 2.2, source: "forza-a.mp4", mediaStartS: 10, text: "FORZA STEAM" },
      { id: "proof", kind: "clip", type: "clip", startS: 2.2, durationS: 2.5, source: "forza-b.mp4", mediaStartS: 25 },
      { id: "source", kind: "source_lock", type: "card.source", startS: 4.7, durationS: 2 },
    ],
  });
  const weakStory = await makeStoryPackage(root, "story-kill", {
    title: "This gaming story",
    primary_source: "",
    first_frame_text: "THIS GAMING STORY HAS A LOT OF TEXT",
    motionDensityScore: 48,
    sourceLockScore: 40,
  });
  markStoryPublished(weakStory);
  const outputDir = path.join(root, "out");
  const report = await buildGoal11RetentionIntelligenceLoop({
    storyPackages: [strongStory, weakStory],
    upstreamBenchmarkReport: {
      stories: [
        { story_id: "story-winner", status: "ready", blockers: [] },
        { story_id: "story-kill", status: "ready", blockers: [] },
      ],
    },
    metricsManifest: {
      stories: [
        completeMetrics("story-winner", {
          views: 4200,
          impressions: 7300,
          average_view_duration_seconds: 26,
          first_3_second_drop_off: 0.08,
          stayed_to_watch: 62,
          swipe_away: 38,
          likes: 190,
          comments: 22,
          shares: 30,
          saves: 11,
          follows: 4,
          retention_curve: [
            { elapsed_video_time_ratio: 0, audience_watch_ratio: 1 },
            { elapsed_video_time_ratio: 0.075, audience_watch_ratio: 0.91 },
            { elapsed_video_time_ratio: 0.15, audience_watch_ratio: 0.84 },
            { elapsed_video_time_ratio: 0.35, audience_watch_ratio: 0.71 },
          ],
        }),
        completeMetrics("story-kill", {
          views: 180,
          impressions: 4400,
          average_view_duration_seconds: 8,
          first_3_second_drop_off: 0.51,
          stayed_to_watch: 26,
          swipe_away: 74,
          likes: 1,
          comments: 0,
          shares: 0,
          saves: 0,
          follows: 0,
        }),
      ],
    },
    workspaceRoot: root,
    outputDir,
    generatedAt: "2026-06-11T12:00:00.000Z",
  });

  const written = await writeGoal11RetentionIntelligenceLoop(report, { outputDir });
  const daily = await fs.readJson(written.dailyRetentionReport);
  const titleWinners = await fs.readJson(written.titlePatternWinners);
  const hookWinners = await fs.readJson(written.hookPatternWinners);
  const killList = await fs.readJson(written.formatKillList);
  const nextUpload = await fs.readFile(written.nextUploadRecommendations, "utf8");

  assert.equal(await fs.pathExists(written.dailyRetentionReport), true);
  assert.equal(await fs.pathExists(written.nextUploadRecommendations), true);
  assert.equal(daily.summary.metrics_ready_story_count, 2);
  assert.ok(titleWinners.patterns.some((pattern) => pattern.pattern === "named_entity_consequence"));
  assert.ok(hookWinners.patterns.some((pattern) => pattern.pattern === "named_subject_source_or_number"));
  assert.ok(killList.formats.some((format) => format.id === "generic_or_missing_title"));
  assert.match(nextUpload, /^# Next Upload Recommendations/m);
  assert.match(nextUpload, /story-winner/);
});

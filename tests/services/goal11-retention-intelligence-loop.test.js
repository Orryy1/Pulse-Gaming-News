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
    platform: "youtube_shorts",
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

test("Goal 11 blocks readiness when analytics are missing and Goal 10 is blocked upstream", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal11-missing-"));
  const story = await makeStoryPackage(root, "story-upstream");

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
  assert.equal(report.summary.analytics_missing_story_count, 1);
  assert.equal(report.summary.upstream_blocked_story_count, 1);
  assert.equal(report.summary.static_diagnosis_story_count, 1);
  assert.equal(report.stories[0].direct_retention_status, "blocked");
  assert.ok(report.stories[0].blockers.includes("upstream:goal10_gold_standard_forensics_blocked"));
  assert.ok(report.stories[0].blockers.includes("retention:analytics_missing"));
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

test("Goal 11 writes required retention loop artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal11-write-"));
  const story = await makeStoryPackage(root, "story-write");
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

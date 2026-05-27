"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  EXPERIMENT_AXES,
  buildGoal12ExperimentationEngine,
  writeGoal12ExperimentationEngine,
} = require("../../lib/goal12-experimentation-engine");

async function makeStoryPackage(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: overrides.title || "The Expanse Shows Real Gameplay",
    canonical_subject: overrides.subject || "The Expanse: Osiris Reborn",
    first_spoken_line:
      overrides.hook ||
      "The Expanse: Osiris Reborn finally showed real gameplay.",
    narration_script:
      overrides.script ||
      "The Expanse: Osiris Reborn finally showed real gameplay. Xbox showed the proof first.",
    suggested_thumbnail_text: overrides.thumbnail || "EXPANSE GAMEPLAY",
    primary_source: "Xbox Wire",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    rendered_duration_s: overrides.durationS || 39,
    final_publish_render: true,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: storyId,
    operating_mode: "DRY_RUN_PUBLISH",
    outputs: {
      youtube_shorts: {
        title: overrides.title || "The Expanse Shows Real Gameplay",
        cta_style: "identity_follow",
        description: "Source-first YouTube Shorts package.",
      },
      instagram_reels: {
        title: overrides.title || "The Expanse Shows Real Gameplay",
        cta_style: "bio_link",
      },
    },
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  });
  return {
    story_id: storyId,
    title: overrides.title || "The Expanse Shows Real Gameplay",
    artifact_dir: artifactDir,
  };
}

function readyRetentionReport(storyId) {
  return {
    stories: [
      {
        story_id: storyId,
        status: "ready",
        blockers: [],
        metrics_status: "complete",
        metrics_summary: {
          views: 1200,
          impressions: 4000,
          average_view_duration_seconds: 31,
          stayed_to_watch: 61,
          swipe_away: 39,
        },
      },
    ],
  };
}

function blockedRetentionReport(storyId) {
  return {
    stories: [
      {
        story_id: storyId,
        status: "blocked",
        blockers: ["retention:analytics_missing"],
        metrics_status: "missing",
      },
    ],
  };
}

function variantMetrics(storyId, variantId) {
  return {
    stories: [
      {
        story_id: storyId,
        variant_id: `${storyId}_control`,
        sample_size: 1500,
        observation_window_hours: 48,
        impressions: 5000,
        views: 1300,
        average_view_duration_seconds: 24,
        stayed_to_watch: 54,
        swipe_away: 46,
        clicks: 10,
        revenue: 0.3,
      },
      {
        story_id: storyId,
        variant_id: variantId,
        sample_size: 1700,
        observation_window_hours: 48,
        impressions: 5200,
        views: 1800,
        average_view_duration_seconds: 31,
        stayed_to_watch: 64,
        swipe_away: 36,
        clicks: 18,
        revenue: 0.62,
      },
    ],
  };
}

test("Goal 12 blocks winners but still creates controlled variant plans when Goal 11 is blocked", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal12-blocked-"));
  const story = await makeStoryPackage(root, "story-blocked");

  const report = await buildGoal12ExperimentationEngine({
    storyPackages: [story],
    upstreamRetentionReport: blockedRetentionReport("story-blocked"),
    futureRenderRecommendations: {
      stories: [
        {
          story_id: "story-blocked",
          recommendations: [
            { id: "tighten_first_three_seconds", action: "Move proof earlier." },
          ],
        },
      ],
    },
    variantMetricsManifest: { stories: [] },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T00:36:06.701Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.experiment_ready_story_count, 0);
  assert.equal(report.summary.controlled_variant_plan_story_count, 1);
  assert.equal(report.summary.winner_ready_story_count, 0);
  assert.equal(report.stories[0].status, "blocked");
  assert.ok(report.stories[0].blockers.includes("upstream:goal11_retention_intelligence_blocked"));
  assert.ok(report.stories[0].blockers.includes("experiment:variant_metrics_missing"));
  assert.deepEqual(
    report.stories[0].experiment_axes.map((axis) => axis.axis),
    EXPERIMENT_AXES,
  );
  for (const variant of report.stories[0].variants) {
    assert.equal(variant.uncontrolled_random_variation, false);
    assert.equal(variant.status, "blocked_planning_only");
    assert.equal(variant.changed_fields.length, 1);
    assert.ok(variant.locked_fields.length >= EXPERIMENT_AXES.length - 1);
  }
  assert.equal(report.winner_report.status, "blocked_pending_variant_metrics");
  assert.equal(report.rule_update_recommendations.status, "blocked_pending_winners");
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
});

test("Goal 12 scores complete local variant metrics and records a winner without mutating production state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal12-winner-"));
  const story = await makeStoryPackage(root, "story-winner");
  const winningVariantId = "story-winner_hook_v1";

  const report = await buildGoal12ExperimentationEngine({
    storyPackages: [story],
    upstreamRetentionReport: readyRetentionReport("story-winner"),
    variantMetricsManifest: variantMetrics("story-winner", winningVariantId),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T00:36:06.701Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.experiment_ready_story_count, 1);
  assert.equal(report.summary.winner_ready_story_count, 1);
  assert.equal(report.stories[0].status, "ready");
  assert.equal(report.winner_report.winners[0].variant_id, winningVariantId);
  assert.ok(report.winner_report.winners[0].score > 0);
  assert.equal(report.rule_update_recommendations.recommendations[0].requires_human_approval, true);
  assert.equal(report.rule_update_recommendations.recommendations[0].applies_to_future_renders_only, true);
  assert.equal(report.safety.no_external_posting, true);
});

test("Goal 12 writes required experimentation artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal12-write-"));
  const story = await makeStoryPackage(root, "story-write");
  const outputDir = path.join(root, "out");
  const report = await buildGoal12ExperimentationEngine({
    storyPackages: [story],
    upstreamRetentionReport: blockedRetentionReport("story-write"),
    variantMetricsManifest: { stories: [] },
    workspaceRoot: root,
    outputDir,
    generatedAt: "2026-05-26T00:36:06.701Z",
  });

  const written = await writeGoal12ExperimentationEngine(report, { outputDir });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.experimentManifest), true);
  assert.equal(await fs.pathExists(written.variantScorecard), true);
  assert.equal(await fs.pathExists(written.winnerReport), true);
  assert.equal(await fs.pathExists(written.ruleUpdateRecommendations), true);
  const manifest = await fs.readJson(written.experimentManifest);
  assert.equal(manifest.stories[0].story_id, "story-write");
});

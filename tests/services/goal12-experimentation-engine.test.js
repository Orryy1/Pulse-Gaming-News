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

function readyRetentionReport(storyId, overrides = {}) {
  return {
    stories: [
      {
        story_id: storyId,
        status: "ready",
        blockers: [],
        publication_phase: "published",
        performance_evidence_status: "observed_complete",
        metrics_status: "complete",
        metrics_summary: {
          views: 1200,
          impressions: 4000,
          average_view_duration_seconds: 31,
          stayed_to_watch: 61,
          swipe_away: 39,
        },
        ...overrides,
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
  const observationWindow = {
    observation_window_start: "2026-05-21T12:00:00.000Z",
    observation_window_end: "2026-05-23T12:00:00.000Z",
  };
  return {
    stories: [
      {
        story_id: storyId,
        variant_id: `${storyId}_control`,
        public_post_id: `yt-${storyId}-control`,
        platform: "youtube_shorts",
        ...observationWindow,
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
        public_post_id: `yt-${variantId}`,
        platform: "youtube_shorts",
        ...observationWindow,
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

function markPublishedExperiment(story, variantIds = []) {
  const controlId = `${story.story_id}_control`;
  story.youtube_post_id = `yt-${story.story_id}-control`;
  story.youtube_published_at = "2026-05-20T12:00:00.000Z";
  story.variant_public_post_ids = {
    [controlId]: {
      platform: "youtube_shorts",
      public_post_id: `yt-${story.story_id}-control`,
    },
    ...Object.fromEntries(
      variantIds.map((variantId) => [
        variantId,
        {
          platform: "youtube_shorts",
          public_post_id: `yt-${variantId}`,
        },
      ]),
    ),
  };
  return story;
}

test("Goal 12 keeps draft metrics pending while Goal 11 blocks winner planning", async () => {
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
  assert.equal(report.stories[0].publication_phase, "prepublication");
  assert.equal(
    report.stories[0].performance_evidence_status,
    "pending_not_yet_observable",
  );
  assert.ok(report.stories[0].blockers.includes("upstream:goal11_retention_intelligence_blocked"));
  assert.ok(!report.stories[0].blockers.includes("experiment:variant_metrics_missing"));
  assert.deepEqual(report.stories[0].direct_experiment_blockers, []);
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
  markPublishedExperiment(story, [winningVariantId]);

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
  assert.equal(
    report.stories[0].performance_evidence_status,
    "observed_complete_control_and_candidate",
  );
  assert.equal(report.winner_report.winners[0].variant_id, winningVariantId);
  assert.equal(
    report.winner_report.winners[0].control_variant_id,
    "story-winner_control",
  );
  assert.equal(
    report.winner_report.winners[0].control_public_post_provenance.linked,
    true,
  );
  assert.equal(
    report.winner_report.winners[0].candidate_public_post_provenance.linked,
    true,
  );
  assert.deepEqual(report.winner_report.winners[0].observation_window, {
    start: "2026-05-21T12:00:00.000Z",
    end: "2026-05-23T12:00:00.000Z",
    hours: 48,
    valid: true,
    key: "2026-05-21T12:00:00.000Z|2026-05-23T12:00:00.000Z|48",
  });
  assert.ok(report.winner_report.winners[0].score > 0);
  assert.equal(report.rule_update_recommendations.recommendations[0].requires_human_approval, true);
  assert.equal(report.rule_update_recommendations.recommendations[0].applies_to_future_renders_only, true);
  assert.equal(report.safety.no_external_posting, true);
});

test("Goal 12 does not claim a winner from candidate-only metrics", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal12-candidate-only-"));
  const story = await makeStoryPackage(root, "story-candidate-only");
  const candidateId = "story-candidate-only_hook_v1";
  markPublishedExperiment(story, [candidateId]);
  const metrics = variantMetrics("story-candidate-only", candidateId);
  metrics.stories = metrics.stories.filter((row) => row.variant_id === candidateId);

  const report = await buildGoal12ExperimentationEngine({
    storyPackages: [story],
    upstreamRetentionReport: readyRetentionReport("story-candidate-only"),
    variantMetricsManifest: metrics,
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T00:36:06.701Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.winner_ready_story_count, 0);
  assert.equal(report.stories[0].winner, null);
  assert.ok(
    report.stories[0].direct_experiment_blockers.includes(
      "experiment:control_metrics_missing",
    ),
  );
  assert.equal(report.winner_report.winners.length, 0);
  assert.equal(report.rule_update_recommendations.recommendations.length, 0);
});

test("Goal 12 rejects winner metrics with mismatched public-post provenance", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal12-provenance-"));
  const story = await makeStoryPackage(root, "story-provenance");
  const candidateId = "story-provenance_hook_v1";
  markPublishedExperiment(story, [candidateId]);
  const metrics = variantMetrics("story-provenance", candidateId);
  metrics.stories.find((row) => row.variant_id === candidateId).public_post_id =
    "yt-unrelated-candidate-post";

  const report = await buildGoal12ExperimentationEngine({
    storyPackages: [story],
    upstreamRetentionReport: readyRetentionReport("story-provenance"),
    variantMetricsManifest: metrics,
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T00:36:06.701Z",
  });

  const candidate = report.stories[0].variant_scorecard.find(
    (row) => row.variant_id === candidateId,
  );
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.winner_ready_story_count, 0);
  assert.equal(report.stories[0].winner, null);
  assert.equal(candidate.metrics_status, "public_post_provenance_invalid");
  assert.ok(
    report.stories[0].direct_experiment_blockers.includes(
      "experiment:variant_metrics_provenance_invalid",
    ),
  );
  assert.equal(report.winner_report.winners.length, 0);
});

test("Goal 12 rejects control and candidate metrics from different observation windows", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal12-window-"));
  const story = await makeStoryPackage(root, "story-window");
  const candidateId = "story-window_hook_v1";
  markPublishedExperiment(story, [candidateId]);
  const metrics = variantMetrics("story-window", candidateId);
  const candidateMetrics = metrics.stories.find((row) => row.variant_id === candidateId);
  candidateMetrics.observation_window_start = "2026-05-22T12:00:00.000Z";
  candidateMetrics.observation_window_end = "2026-05-24T12:00:00.000Z";

  const report = await buildGoal12ExperimentationEngine({
    storyPackages: [story],
    upstreamRetentionReport: readyRetentionReport("story-window"),
    variantMetricsManifest: metrics,
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T00:36:06.701Z",
  });

  const candidate = report.stories[0].variant_scorecard.find(
    (row) => row.variant_id === candidateId,
  );
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.winner_ready_story_count, 0);
  assert.equal(report.stories[0].winner, null);
  assert.equal(candidate.metrics_status, "observation_window_mismatch");
  assert.ok(
    report.stories[0].direct_experiment_blockers.includes(
      "experiment:observation_window_invalid_or_mismatched",
    ),
  );
  assert.equal(report.winner_report.winners.length, 0);
});

test("Goal 12 blocks winner claims when published Goal 11 evidence is stale", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal12-stale-upstream-"));
  const story = await makeStoryPackage(root, "story-stale-upstream");
  const candidateId = "story-stale-upstream_hook_v1";
  markPublishedExperiment(story, [candidateId]);

  const report = await buildGoal12ExperimentationEngine({
    storyPackages: [story],
    upstreamRetentionReport: readyRetentionReport("story-stale-upstream", {
      metrics_status: "invalid",
      performance_evidence_status: "stale_after_publication",
    }),
    variantMetricsManifest: variantMetrics("story-stale-upstream", candidateId),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T00:36:06.701Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.winner_ready_story_count, 0);
  assert.equal(report.stories[0].winner, null);
  assert.ok(
    report.stories[0].upstream_blockers.includes(
      "upstream:goal11_performance_evidence_not_ready",
    ),
  );
  assert.equal(report.winner_report.winners.length, 0);
  assert.equal(report.rule_update_recommendations.recommendations.length, 0);
});

test("Goal 12 treats clean planned variants without live experiment metrics as pending, not blocked", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal12-pending-"));
  const readyStory = await makeStoryPackage(root, "story-ready");
  const skippedStory = await makeStoryPackage(root, "story-skipped");

  const report = await buildGoal12ExperimentationEngine({
    storyPackages: [readyStory, skippedStory],
    upstreamRetentionReport: {
      stories: [
        { story_id: "story-ready", status: "ready", blockers: [], metrics_status: "pending" },
        {
          story_id: "story-skipped",
          status: "skipped",
          skipped_status: "visual_source_deferred",
          skipped_reason: "defer_until_rights_backed_media_available",
          blockers: [],
        },
      ],
    },
    futureRenderRecommendations: {
      stories: [
        {
          story_id: "story-ready",
          status: "ready_for_next_render",
          recommendations: [
            {
              id: "preserve_current_benchmark_profile_until_live_metrics_arrive",
              action: "Keep the current benchmark-approved profile until live metrics arrive.",
            },
          ],
        },
      ],
    },
    variantMetricsManifest: { stories: [] },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-29T00:04:00.000Z",
  });

  const ready = report.stories.find((story) => story.story_id === "story-ready");
  const skipped = report.stories.find((story) => story.story_id === "story-skipped");

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.story_count, 2);
  assert.equal(report.summary.active_story_count, 1);
  assert.equal(report.summary.skipped_story_count, 1);
  assert.equal(report.summary.experiment_ready_story_count, 1);
  assert.equal(report.summary.planned_pending_metrics_story_count, 1);
  assert.equal(report.summary.winner_ready_story_count, 0);
  assert.equal(ready.status, "ready");
  assert.equal(ready.experiment_status, "planned_pending_metrics");
  assert.equal(ready.publication_phase, "prepublication");
  assert.equal(ready.performance_evidence_status, "pending_not_yet_observable");
  assert.deepEqual(ready.direct_experiment_blockers, []);
  assert.equal(skipped.status, "skipped");
  assert.deepEqual(report.blocker_counts, {});
  assert.equal(report.winner_report.status, "pending_variant_metrics_no_winner_yet");
  assert.equal(report.rule_update_recommendations.status, "pending_winners");
});

test("Goal 12 fallback hook copy avoids banned source-backed phrasing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal12-copy-"));
  const story = await makeStoryPackage(root, "story-copy");
  await fs.outputJson(path.join(story.artifact_dir, "canonical_story_manifest.json"), {
    story_id: "story-copy",
    selected_title: "",
    canonical_subject: "Hades II",
    primary_source: "PlayStation Blog",
  });

  const report = await buildGoal12ExperimentationEngine({
    storyPackages: [story],
    upstreamRetentionReport: blockedRetentionReport("story-copy"),
    variantMetricsManifest: { stories: [] },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T00:36:06.701Z",
  });

  const combined = JSON.stringify(report.experiment_manifest);
  assert.doesNotMatch(combined, /source-backed update|pulse gaming source update/i);
  assert.match(report.stories[0].base.hook, /Hades II/i);
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

"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
process.env.PULSE_SKIP_DOTENV = "true";
const { main, parseArgs } = require("../../tools/goal11-retention-intelligence-loop");

async function makeStory(root, storyId) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "The Expanse Shows Real Gameplay",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
    narration_script:
      "The Expanse: Osiris Reborn finally showed real gameplay. Follow Pulse Gaming for the gaming stories behind the headline.",
    primary_source: "Xbox Wire",
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    shot_plan: [
      {
        id: "opener",
        type: "opener",
        startS: 0,
        durationS: 2.4,
        source: "expanse-trailer.mp4",
        mediaStartS: 2,
        text: "EXPANSE GAMEPLAY",
      },
      { id: "source", type: "card.source", startS: 2.4, durationS: 2 },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    rendered_duration_s: 38,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    operating_mode: "DRY_RUN_PUBLISH",
    outputs: {
      youtube_shorts: { cta_style: "identity_follow" },
      instagram_reels: { cta_style: "bio_link" },
    },
    platform_native_evidence: { verdict: "pass" },
  });
  await fs.outputJson(path.join(artifactDir, "visual_quality_report.json"), {
    result: "pass",
    scores: {
      motion_density_score: 84,
      first_3_seconds_hook_score: 82,
      source_lock_quality_score: 80,
    },
    thresholds: {
      motion_density_score: 75,
      first_3_seconds_hook_score: 75,
      source_lock_quality_score: 65,
    },
  });
  return { story_id: storyId, artifact_dir: artifactDir };
}

function metrics(storyId) {
  return {
    stories: [
      {
        story_id: storyId,
        video_id: `yt-${storyId}`,
        views: 2000,
        impressions: 6000,
        average_view_duration_seconds: 31,
        retention_curve: [
          { elapsed_video_time_ratio: 0, audience_watch_ratio: 1 },
          { elapsed_video_time_ratio: 0.08, audience_watch_ratio: 0.93 },
          { elapsed_video_time_ratio: 0.16, audience_watch_ratio: 0.9 },
          { elapsed_video_time_ratio: 0.55, audience_watch_ratio: 0.86 },
        ],
        first_3_second_drop_off: 0.12,
        stayed_to_watch: 62,
        swipe_away: 38,
        replays: 120,
        likes: 180,
        comments: 18,
        shares: 20,
        saves: 12,
        follows: 5,
        clicks: 24,
        landing_visits: 11,
        revenue: 2.4,
      },
    ],
  };
}

test("Goal 11 CLI parses local-proof inputs", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-benchmark-report",
    "output/goal-10/goal10_readiness_report.json",
    "--metrics",
    "output/analytics/retention_metrics.json",
    "--out-dir",
    "output/goal-11",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-26T00:05:54.376Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamBenchmarkReportPath, "output/goal-10/goal10_readiness_report.json");
  assert.equal(args.metricsPath, "output/analytics/retention_metrics.json");
  assert.equal(args.outDir, "output/goal-11");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-26T00:05:54.376Z");
  assert.equal(args.json, true);
});

test("Goal 11 CLI writes retention intelligence loop artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal11-cli-"));
  const story = await makeStory(root, "story-cli");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal10.json");
  const metricsPath = path.join(root, "metrics.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(storyPackagesPath, [story]);
  await fs.outputJson(upstreamPath, {
    stories: [{ story_id: "story-cli", status: "ready", blockers: [] }],
  });
  await fs.outputJson(metricsPath, metrics("story-cli"));

  const result = await main([
    "--story-packages",
    storyPackagesPath,
    "--upstream-benchmark-report",
    upstreamPath,
    "--metrics",
    metricsPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-26T00:05:54.376Z",
  ]);

  assert.equal(result.report.verdict, "PASS");
  assert.equal(await fs.pathExists(path.join(outDir, "goal11_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "retention_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "learning_rules.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "future_render_recommendations.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "experiment_results.json")), true);
});

test("Goal 11 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal11-retention-intelligence"],
    "node tools/goal11-retention-intelligence-loop.js",
  );
});

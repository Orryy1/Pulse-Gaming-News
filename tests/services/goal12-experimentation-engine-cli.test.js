"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
process.env.PULSE_SKIP_DOTENV = "true";
const { main, parseArgs } = require("../../tools/goal12-experimentation-engine");

async function makeStory(root, storyId) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "The Expanse Shows Real Gameplay",
    canonical_subject: "The Expanse: Osiris Reborn",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
    suggested_thumbnail_text: "EXPANSE GAMEPLAY",
    narration_script: "The Expanse: Osiris Reborn finally showed real gameplay.",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    rendered_duration_s: 38,
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    operating_mode: "DRY_RUN_PUBLISH",
    outputs: {
      youtube_shorts: { cta_style: "identity_follow" },
      instagram_reels: { cta_style: "bio_link" },
    },
  });
  return { story_id: storyId, artifact_dir: artifactDir };
}

test("Goal 12 CLI parses local-proof inputs", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-retention-report",
    "output/goal-11/goal11_readiness_report.json",
    "--future-render-recommendations",
    "output/goal-11/future_render_recommendations.json",
    "--variant-metrics",
    "output/analytics/experiment_variant_metrics.json",
    "--out-dir",
    "output/goal-12",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-26T00:36:06.701Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamRetentionReportPath, "output/goal-11/goal11_readiness_report.json");
  assert.equal(args.futureRenderRecommendationsPath, "output/goal-11/future_render_recommendations.json");
  assert.equal(args.variantMetricsPath, "output/analytics/experiment_variant_metrics.json");
  assert.equal(args.outDir, "output/goal-12");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-26T00:36:06.701Z");
  assert.equal(args.json, true);
});

test("Goal 12 CLI writes experimentation artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal12-cli-"));
  const story = await makeStory(root, "story-cli");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal11.json");
  const recommendationsPath = path.join(root, "future.json");
  const metricsPath = path.join(root, "metrics.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(storyPackagesPath, [story]);
  await fs.outputJson(upstreamPath, {
    stories: [{ story_id: "story-cli", status: "blocked", blockers: ["retention:analytics_missing"] }],
  });
  await fs.outputJson(recommendationsPath, { stories: [] });
  await fs.outputJson(metricsPath, { stories: [] });

  const result = await main([
    "--story-packages",
    storyPackagesPath,
    "--upstream-retention-report",
    upstreamPath,
    "--future-render-recommendations",
    recommendationsPath,
    "--variant-metrics",
    metricsPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-26T00:36:06.701Z",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(await fs.pathExists(path.join(outDir, "goal12_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "experiment_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "variant_scorecard.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "winner_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "rule_update_recommendations.json")), true);
});

test("Goal 12 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal12-experimentation-engine"],
    "node tools/goal12-experimentation-engine.js",
  );
});

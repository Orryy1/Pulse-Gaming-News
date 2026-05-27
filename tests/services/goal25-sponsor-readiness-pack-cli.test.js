"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
const { main, parseArgs } = require("../../tools/goal25-sponsor-readiness-pack");

test("Goal 25 CLI parses sponsor proof inputs", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-corrections-report",
    "output/goal-24/goal24_readiness_report.json",
    "--performance-snapshot",
    "output/goal-25/sponsor_performance_snapshot.json",
    "--out-dir",
    "output/goal-25",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-26T07:08:16.908Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamCorrectionsReportPath, "output/goal-24/goal24_readiness_report.json");
  assert.equal(args.performanceSnapshotPath, "output/goal-25/sponsor_performance_snapshot.json");
  assert.equal(args.outDir, "output/goal-25");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-26T07:08:16.908Z");
  assert.equal(args.json, true);
});

test("Goal 25 CLI writes sponsor readiness artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal25-cli-"));
  const storyDir = path.join(root, "story-cli");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal24.json");
  const performancePath = path.join(root, "performance.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(path.join(storyDir, "canonical_story_manifest.json"), {
    story_id: "story-cli",
    selected_title: "Mixtape Release Date Changed",
    canonical_subject: "Mixtape",
    content_pillar: "gaming_news",
  });
  await fs.outputJson(path.join(storyDir, "platform_policy_report.json"), {
    verdict: "pass",
    publish_blockers: [],
  });
  await fs.outputJson(path.join(storyDir, "finance_crypto_risk_report.json"), {
    verdict: "pass",
    blockers: [],
  });
  await fs.outputJson(path.join(storyDir, "publish_verdict.json"), { verdict: "GREEN" });
  await fs.outputJson(storyPackagesPath, [{ story_id: "story-cli", artifact_dir: storyDir }]);
  await fs.outputJson(upstreamPath, {
    verdict: "BLOCKED",
    stories: [{ story_id: "story-cli", status: "blocked", blockers: ["corrections:source_status_signal_missing"] }],
  });
  await fs.outputJson(performancePath, {
    subscribers: 7200,
    shorts_views_90d: 2200000,
    average_views: 84000,
    average_view_duration_seconds: 31,
    average_view_percentage: 72,
    comments_per_view: 0.018,
    platform_reach: { youtube_shorts: 1800000 },
    vertical_breakdown: { gaming_news: 1 },
    audience_summary: { core: "adult gaming news viewers" },
    story_metrics: {
      "story-cli": { views: 91000, average_view_duration_seconds: 32, platform: "youtube_shorts" },
    },
    pricing_basis: { currency: "GBP", floor_cpm: 8, ceiling_cpm: 18 },
  });

  const result = await main([
    "--story-packages",
    storyPackagesPath,
    "--upstream-corrections-report",
    upstreamPath,
    "--performance-snapshot",
    performancePath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-26T07:08:16.908Z",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(result.report.direct_sponsor_verdict, "PASS");
  assert.equal(await fs.pathExists(path.join(outDir, "goal25_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "goal25_readiness_report.md")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "sponsor_media_kit.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "sponsor_pitch_pack.md")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "brand_safety_report.json")), true);
});

test("Goal 25 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal25-sponsor-readiness-pack"],
    "node tools/goal25-sponsor-readiness-pack.js",
  );
});

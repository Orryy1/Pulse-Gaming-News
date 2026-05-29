"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
process.env.PULSE_SKIP_DOTENV = "true";
const { main, parseArgs } = require("../../tools/goal21-observability-dashboard");

async function makeStory(root, storyId) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Forza Adds A Fresh Weather Detail",
    primary_source: "Xbox",
    source_confidence_score: 0.92,
  });
  await fs.outputJson(path.join(artifactDir, "script_scorecard.json"), {
    story_id: storyId,
    verdict: "pass",
    scores: { hook_strength: 89, retention_pacing: 84 },
    blockers: [],
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    final_publish_render: true,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    render_time_ms: 13100,
    rendered_duration_s: 44.8,
  });
  await fs.outputJson(path.join(artifactDir, "visual_quality_report.json"), {
    result: "pass",
    scores: { media_house_polish_score: 91 },
    failures: [],
  });
  await fs.outputJson(path.join(artifactDir, "benchmark_report.json"), {
    result: "pass",
    scores: { first_3_seconds_hook_score: 86 },
    failures: [],
  });
  await fs.outputJson(path.join(artifactDir, "platform_policy_report.json"), { verdict: "pass", failures: [] });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), { verdict: "pass", failures: [], rights_risk_score: 10 });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    verdict: "pass",
    failures: [],
    affiliate_risk_score: 4,
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    operating_mode: "DRY_RUN_PUBLISH",
    publish_status: "GREEN",
    outputs: { youtube_shorts: { title: "Forza Adds A Fresh Weather Detail" } },
  });
  await fs.outputJson(path.join(artifactDir, "analytics_performance_report.json"), {
    platform_performance: { youtube_shorts: { views: 500, comments: 3, shares: 9 } },
    retention: { average_view_duration_seconds: 31, retention_curve: [1, 0.8, 0.6] },
    views: 500,
    followers: 8,
    comments: 3,
    shares: 9,
    clicks: 17,
  });
  await fs.outputJson(path.join(artifactDir, "revenue_attribution_report.json"), {
    currency: "GBP",
    cost: { amount: 2.5 },
    revenue: { amount: 6 },
    profit: { amount: 3.5 },
  });
  return { story_id: storyId, artifact_dir: artifactDir };
}

test("Goal 21 CLI parses observability inputs", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-anti-spam-report",
    "output/goal-20/goal20_readiness_report.json",
    "--upstream-platform-policy-report",
    "output/goal-17/platform_policy_report.json",
    "--out-dir",
    "output/goal-21",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-26T05:07:35.093Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamAntiSpamReportPath, "output/goal-20/goal20_readiness_report.json");
  assert.equal(args.upstreamPlatformPolicyReportPath, "output/goal-17/platform_policy_report.json");
  assert.equal(args.outDir, "output/goal-21");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-26T05:07:35.093Z");
  assert.equal(args.json, true);
});

test("Goal 21 CLI writes observability artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal21-cli-"));
  const story = await makeStory(root, "story-cli");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal20.json");
  const policyPath = path.join(root, "goal17.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(storyPackagesPath, [story]);
  await fs.outputJson(upstreamPath, {
    verdict: "BLOCKED",
    stories: [{ story_id: "story-cli", status: "blocked", blockers: ["anti_spam:repeated_title_structure"] }],
  });
  await fs.outputJson(policyPath, { stories: [{ story_id: "story-cli", status: "pass", blockers: [] }] });

  const result = await main([
    "--story-packages",
    storyPackagesPath,
    "--upstream-anti-spam-report",
    upstreamPath,
    "--upstream-platform-policy-report",
    policyPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-26T05:07:35.093Z",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(result.report.direct_observability_verdict, "PASS");
  assert.equal(await fs.pathExists(path.join(outDir, "goal21_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "dashboard_model.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "reporting_endpoints.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "daily_studio_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "weekly_performance_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "blocked_content_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "revenue_report.json")), true);
});

test("Goal 21 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal21-observability-dashboard"],
    "node tools/goal21-observability-dashboard.js",
  );
});

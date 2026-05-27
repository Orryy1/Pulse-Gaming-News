"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
const { main, parseArgs } = require("../../tools/goal26-creator-studio-brand-system");

test("Goal 26 CLI parses brand proof inputs", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-sponsor-report",
    "output/goal-25/goal25_readiness_report.json",
    "--brand-snapshot",
    "output/goal-26/brand_snapshot.json",
    "--out-dir",
    "output/goal-26",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-26T07:38:30.333Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamSponsorReportPath, "output/goal-25/goal25_readiness_report.json");
  assert.equal(args.brandSnapshotPath, "output/goal-26/brand_snapshot.json");
  assert.equal(args.outDir, "output/goal-26");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-26T07:38:30.333Z");
  assert.equal(args.json, true);
});

test("Goal 26 CLI writes brand-system artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal26-cli-"));
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal25.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(storyPackagesPath, [{ story_id: "story-cli", artifact_dir: path.join(root, "story-cli") }]);
  await fs.outputJson(upstreamPath, {
    verdict: "BLOCKED",
    stories: [{ story_id: "story-cli", status: "blocked", blockers: ["sponsor:required_metrics_missing"] }],
  });

  const result = await main([
    "--story-packages",
    storyPackagesPath,
    "--upstream-sponsor-report",
    upstreamPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-26T07:38:30.333Z",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(result.report.direct_brand_verdict, "PASS");
  assert.equal(await fs.pathExists(path.join(outDir, "goal26_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "goal26_readiness_report.md")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "brand_system_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "visual_style_guide.md")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "editorial_style_guide.md")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "recurring_format_registry.json")), true);
});

test("Goal 26 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal26-creator-studio-brand-system"],
    "node tools/goal26-creator-studio-brand-system.js",
  );
});

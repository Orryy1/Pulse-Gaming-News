"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
const { main, parseArgs } = require("../../tools/goal24-corrections-retractions-takedowns");

test("Goal 24 CLI parses correction proof inputs", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-security-report",
    "output/goal-23/goal23_readiness_report.json",
    "--source-status-report",
    "output/goal-24/source_status_report.json",
    "--out-dir",
    "output/goal-24",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-26T06:38:01.097Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamSecurityReportPath, "output/goal-23/goal23_readiness_report.json");
  assert.equal(args.sourceStatusReportPath, "output/goal-24/source_status_report.json");
  assert.equal(args.outDir, "output/goal-24");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-26T06:38:01.097Z");
  assert.equal(args.json, true);
});

test("Goal 24 CLI writes correction and takedown artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal24-cli-"));
  const storyDir = path.join(root, "story-cli");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal23.json");
  const sourceStatusPath = path.join(root, "source-status.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(path.join(storyDir, "canonical_story_manifest.json"), {
    story_id: "story-cli",
    selected_title: "Mixtape Release Date Changed",
    canonical_subject: "Mixtape",
    primary_source_url: "https://example.com/story-cli",
  });
  await fs.outputJson(path.join(storyDir, "source_manifest.json"), {
    story_id: "story-cli",
    primary_source_url: "https://example.com/story-cli",
  });
  await fs.outputJson(storyPackagesPath, [{ story_id: "story-cli", artifact_dir: storyDir }]);
  await fs.outputJson(upstreamPath, {
    verdict: "BLOCKED",
    stories: [{ story_id: "story-cli", status: "blocked", blockers: ["security:token_rotation_plan_missing"] }],
  });
  await fs.outputJson(sourceStatusPath, {
    generated_at: "2026-05-26T06:38:01.097Z",
    stories: [{ story_id: "story-cli", source_status: "unchanged" }],
  });

  const result = await main([
    "--story-packages",
    storyPackagesPath,
    "--upstream-security-report",
    upstreamPath,
    "--source-status-report",
    sourceStatusPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-26T06:38:01.097Z",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(result.report.direct_corrections_verdict, "PASS");
  assert.equal(await fs.pathExists(path.join(outDir, "goal24_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "goal24_readiness_report.md")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "correction_queue.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "affected_content_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "correction_plan.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "takedown_response_log.json")), true);
});

test("Goal 24 CLI generates a locked-source status report when none exists", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal24-cli-source-status-"));
  const storyDir = path.join(root, "story-cli");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal23.json");
  const sourceStatusPath = path.join(root, "out", "source_status_report.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(path.join(storyDir, "canonical_story_manifest.json"), {
    story_id: "story-cli",
    selected_title: "Mixtape Release Date Changed",
    canonical_subject: "Mixtape",
    primary_source: "Example News",
    primary_source_url: "https://example.com/story-cli",
  });
  await fs.outputJson(path.join(storyDir, "platform_publish_manifest.json"), {
    story_id: "story-cli",
    operating_mode: "DRY_RUN_PUBLISH",
    outputs: {
      youtube_shorts: { title: "Mixtape Release Date Changed" },
    },
  });
  await fs.outputJson(storyPackagesPath, [{ story_id: "story-cli", artifact_dir: storyDir }]);
  await fs.outputJson(upstreamPath, {
    verdict: "PASS",
    stories: [{ story_id: "story-cli", status: "ready", blockers: [] }],
  });

  const result = await main([
    "--story-packages",
    storyPackagesPath,
    "--upstream-security-report",
    upstreamPath,
    "--source-status-report",
    sourceStatusPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-26T06:38:01.097Z",
  ]);

  assert.equal(result.report.verdict, "PASS");
  assert.equal(await fs.pathExists(sourceStatusPath), true);
  const sourceStatus = await fs.readJson(sourceStatusPath);
  assert.equal(sourceStatus.stories[0].source_status, "current");
  assert.equal(sourceStatus.stories[0].monitor_status, "baseline_from_locked_source");
});

test("Goal 24 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal24-corrections-retractions-takedowns"],
    "node tools/goal24-corrections-retractions-takedowns.js",
  );
});

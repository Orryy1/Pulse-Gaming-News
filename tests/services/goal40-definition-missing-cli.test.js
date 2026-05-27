"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
const { main, parseArgs } = require("../../tools/goal40-definition-missing");

test("Goal 40 CLI parses definition-gap inputs", () => {
  const args = parseArgs([
    "--campaign-doc",
    "docs/codex-main-goal.md",
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-goal39-report",
    "output/goal-39/goal39_readiness_report.json",
    "--out-dir",
    "output/goal-40",
    "--generated-at",
    "2026-05-26T14:40:21.747Z",
    "--json",
  ]);

  assert.equal(args.campaignDocPath, "docs/codex-main-goal.md");
  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamGoal39ReportPath, "output/goal-39/goal39_readiness_report.json");
  assert.equal(args.outDir, "output/goal-40");
  assert.equal(args.generatedAt, "2026-05-26T14:40:21.747Z");
  assert.equal(args.json, true);
});

test("Goal 40 CLI writes blocked definition-gap artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal40-cli-"));
  const docPath = path.join(root, "codex-main-goal.md");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal39.json");
  const outDir = path.join(root, "out");
  await fs.outputFile(docPath, "# Campaign\n\n### 39. Definition Missing Gate\n");
  await fs.outputJson(storyPackagesPath, [{ story_id: "story-cli" }]);
  await fs.outputJson(upstreamPath, { verdict: "BLOCKED" });

  const result = await main([
    "--campaign-doc",
    docPath,
    "--story-packages",
    storyPackagesPath,
    "--upstream-goal39-report",
    upstreamPath,
    "--out-dir",
    outDir,
    "--generated-at",
    "2026-05-26T14:40:21.747Z",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(result.report.direct_definition_verdict, "BLOCKED");
  assert.equal(await fs.pathExists(path.join(outDir, "goal40_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "goal40_readiness_report.md")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "goal40_contract_gap_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "goal40_operator_request.md")), true);
});

test("Goal 40 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal40-definition-missing"],
    "node tools/goal40-definition-missing.js",
  );
});

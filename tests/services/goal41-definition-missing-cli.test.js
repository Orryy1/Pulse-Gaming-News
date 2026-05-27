"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
const { main, parseArgs } = require("../../tools/goal41-definition-missing");

test("Goal 41 CLI parses definition-gap inputs", () => {
  const args = parseArgs([
    "--campaign-doc",
    "docs/codex-main-goal.md",
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-goal40-report",
    "output/goal-40/goal40_readiness_report.json",
    "--out-dir",
    "output/goal-41",
    "--generated-at",
    "2026-05-26T15:10:26.079Z",
    "--json",
  ]);

  assert.equal(args.campaignDocPath, "docs/codex-main-goal.md");
  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamGoal40ReportPath, "output/goal-40/goal40_readiness_report.json");
  assert.equal(args.outDir, "output/goal-41");
  assert.equal(args.generatedAt, "2026-05-26T15:10:26.079Z");
  assert.equal(args.json, true);
});

test("Goal 41 CLI writes blocked definition-gap artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal41-cli-"));
  const docPath = path.join(root, "codex-main-goal.md");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal40.json");
  const outDir = path.join(root, "out");
  await fs.outputFile(docPath, "# Campaign\n\n### 40. Definition Missing Gate\n");
  await fs.outputJson(storyPackagesPath, [{ story_id: "story-cli" }]);
  await fs.outputJson(upstreamPath, { verdict: "BLOCKED" });

  const result = await main([
    "--campaign-doc",
    docPath,
    "--story-packages",
    storyPackagesPath,
    "--upstream-goal40-report",
    upstreamPath,
    "--out-dir",
    outDir,
    "--generated-at",
    "2026-05-26T15:10:26.079Z",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(result.report.direct_definition_verdict, "BLOCKED");
  assert.equal(await fs.pathExists(path.join(outDir, "goal41_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "goal41_readiness_report.md")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "goal41_contract_gap_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "goal41_operator_request.md")), true);
});

test("Goal 41 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal41-definition-missing"],
    "node tools/goal41-definition-missing.js",
  );
});

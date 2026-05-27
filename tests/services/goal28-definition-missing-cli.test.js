"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
const { main, parseArgs } = require("../../tools/goal28-definition-missing");

test("Goal 28 CLI parses definition-gap inputs", () => {
  const args = parseArgs([
    "--campaign-doc",
    "docs/codex-main-goal.md",
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-goal27-report",
    "output/goal-27/goal27_readiness_report.json",
    "--out-dir",
    "output/goal-28",
    "--generated-at",
    "2026-05-26T08:38:48.345Z",
    "--json",
  ]);

  assert.equal(args.campaignDocPath, "docs/codex-main-goal.md");
  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamGoal27ReportPath, "output/goal-27/goal27_readiness_report.json");
  assert.equal(args.outDir, "output/goal-28");
  assert.equal(args.generatedAt, "2026-05-26T08:38:48.345Z");
  assert.equal(args.json, true);
});

test("Goal 28 CLI writes blocked definition-gap artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal28-cli-"));
  const docPath = path.join(root, "codex-main-goal.md");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal27.json");
  const outDir = path.join(root, "out");
  await fs.outputFile(docPath, "# Campaign\n\n### 27. Definition Missing Gate\n");
  await fs.outputJson(storyPackagesPath, [{ story_id: "story-cli" }]);
  await fs.outputJson(upstreamPath, { verdict: "BLOCKED" });

  const result = await main([
    "--campaign-doc",
    docPath,
    "--story-packages",
    storyPackagesPath,
    "--upstream-goal27-report",
    upstreamPath,
    "--out-dir",
    outDir,
    "--generated-at",
    "2026-05-26T08:38:48.345Z",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(result.report.direct_definition_verdict, "BLOCKED");
  assert.equal(await fs.pathExists(path.join(outDir, "goal28_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "goal28_readiness_report.md")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "goal28_contract_gap_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "goal28_operator_request.md")), true);
});

test("Goal 28 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal28-definition-missing"],
    "node tools/goal28-definition-missing.js",
  );
});

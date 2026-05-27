"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
const { main, parseArgs } = require("../../tools/goal31-definition-missing");

test("Goal 31 CLI parses definition-gap inputs", () => {
  const args = parseArgs([
    "--campaign-doc",
    "docs/codex-main-goal.md",
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-goal30-report",
    "output/goal-30/goal30_readiness_report.json",
    "--out-dir",
    "output/goal-31",
    "--generated-at",
    "2026-05-26T10:09:14.183Z",
    "--json",
  ]);

  assert.equal(args.campaignDocPath, "docs/codex-main-goal.md");
  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamGoal30ReportPath, "output/goal-30/goal30_readiness_report.json");
  assert.equal(args.outDir, "output/goal-31");
  assert.equal(args.generatedAt, "2026-05-26T10:09:14.183Z");
  assert.equal(args.json, true);
});

test("Goal 31 CLI writes blocked definition-gap artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal31-cli-"));
  const docPath = path.join(root, "codex-main-goal.md");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal30.json");
  const outDir = path.join(root, "out");
  await fs.outputFile(docPath, "# Campaign\n\n### 30. Definition Missing Gate\n");
  await fs.outputJson(storyPackagesPath, [{ story_id: "story-cli" }]);
  await fs.outputJson(upstreamPath, { verdict: "BLOCKED" });

  const result = await main([
    "--campaign-doc",
    docPath,
    "--story-packages",
    storyPackagesPath,
    "--upstream-goal30-report",
    upstreamPath,
    "--out-dir",
    outDir,
    "--generated-at",
    "2026-05-26T10:09:14.183Z",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(result.report.direct_definition_verdict, "BLOCKED");
  assert.equal(await fs.pathExists(path.join(outDir, "goal31_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "goal31_readiness_report.md")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "goal31_contract_gap_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "goal31_operator_request.md")), true);
});

test("Goal 31 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal31-definition-missing"],
    "node tools/goal31-definition-missing.js",
  );
});

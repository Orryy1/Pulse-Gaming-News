"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoal31DefinitionMissing,
  writeGoal31DefinitionMissing,
} = require("../../lib/goal31-definition-missing");

test("Goal 31 records a missing campaign definition without inventing requirements", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal31-missing-"));
  const docPath = path.join(root, "docs", "codex-main-goal.md");
  await fs.outputFile(docPath, [
    "# Campaign",
    "",
    "### 30. Definition Missing Gate",
    "",
    "Outputs: `goal30_readiness_report.json`.",
    "",
    "## Acceptance criteria",
    "",
  ].join("\n"));

  const report = await buildGoal31DefinitionMissing({
    campaignDocPath: docPath,
    upstreamGoal30Report: { verdict: "BLOCKED" },
    storyPackages: [{ story_id: "story-a" }, { story_id: "story-b" }],
    generatedAt: "2026-05-26T10:09:14.183Z",
  });

  assert.equal(report.goal, "31_goal_definition_missing");
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_definition_verdict, "BLOCKED");
  assert.equal(report.summary.goal_number, 31);
  assert.equal(report.summary.story_count, 2);
  assert.equal(report.summary.publish_now_count, 0);
  assert.ok(report.blockers.includes("campaign:goal31_definition_missing"));
  assert.ok(report.blockers.includes("campaign:goal31_outputs_missing"));
  assert.ok(report.blockers.includes("campaign:goal31_acceptance_criteria_missing"));
  assert.ok(report.blockers.includes("upstream:goal30_goal_definition_missing_blocked"));
  assert.equal(report.goal_definition.found, false);
  assert.equal(report.operator_request.required, true);
  assert.equal(report.safety.no_external_posting, true);
});

test("Goal 31 recognises a defined section while carrying upstream blockers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal31-defined-"));
  const docPath = path.join(root, "docs", "codex-main-goal.md");
  await fs.outputFile(docPath, [
    "# Campaign",
    "",
    "### 31. Archive Retention Policy",
    "",
    "Define archive retention for proof bundles.",
    "",
    "Outputs: `retention_policy.json`, `retention_readiness.md`.",
    "",
    "Acceptance: no live publishing and no token mutation.",
    "",
    "### 32. Next Gate",
    "",
  ].join("\n"));

  const report = await buildGoal31DefinitionMissing({
    campaignDocPath: docPath,
    upstreamGoal30Report: { verdict: "BLOCKED" },
    storyPackages: [{ story_id: "story-c" }],
    generatedAt: "2026-05-26T10:09:14.183Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_definition_verdict, "PASS");
  assert.equal(report.goal_definition.found, true);
  assert.equal(report.goal_definition.title, "Archive Retention Policy");
  assert.deepEqual(report.goal_definition.outputs, ["retention_policy.json", "retention_readiness.md"]);
  assert.deepEqual(report.direct_blockers, []);
  assert.ok(report.blockers.includes("upstream:goal30_goal_definition_missing_blocked"));
});

test("Goal 31 writes machine-readable and human-readable definition-gap artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal31-write-"));
  const docPath = path.join(root, "docs", "codex-main-goal.md");
  await fs.outputFile(docPath, "# Campaign\n\n### 30. Definition Missing Gate\n");
  const report = await buildGoal31DefinitionMissing({
    campaignDocPath: docPath,
    upstreamGoal30Report: { verdict: "BLOCKED" },
    storyPackages: [],
    generatedAt: "2026-05-26T10:09:14.183Z",
  });
  const outDir = path.join(root, "out");

  const written = await writeGoal31DefinitionMissing(report, { outputDir: outDir });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.contractGapReport), true);
  assert.equal(await fs.pathExists(written.operatorRequest), true);
});

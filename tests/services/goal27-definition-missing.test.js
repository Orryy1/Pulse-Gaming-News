"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoal27DefinitionMissing,
  writeGoal27DefinitionMissing,
} = require("../../lib/goal27-definition-missing");

test("Goal 27 records a missing campaign definition instead of inventing a contract", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal27-missing-"));
  const docPath = path.join(root, "docs", "codex-main-goal.md");
  await fs.outputFile(docPath, [
    "# Campaign",
    "",
    "### 26. Creator Studio Brand System",
    "",
    "Outputs: `brand_system_manifest.json`.",
    "",
    "## Acceptance criteria",
    "",
  ].join("\n"));

  const report = await buildGoal27DefinitionMissing({
    campaignDocPath: docPath,
    upstreamGoal26Report: { verdict: "BLOCKED" },
    storyPackages: [{ story_id: "story-a" }, { story_id: "story-b" }],
    generatedAt: "2026-05-26T08:08:37.688Z",
  });

  assert.equal(report.goal, "27_goal_definition_missing");
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_definition_verdict, "BLOCKED");
  assert.equal(report.summary.story_count, 2);
  assert.equal(report.summary.publish_now_count, 0);
  assert.ok(report.blockers.includes("campaign:goal27_definition_missing"));
  assert.ok(report.blockers.includes("campaign:goal27_outputs_missing"));
  assert.ok(report.blockers.includes("campaign:goal27_acceptance_criteria_missing"));
  assert.ok(report.blockers.includes("upstream:goal26_creator_studio_brand_system_blocked"));
  assert.equal(report.goal_definition.found, false);
  assert.equal(report.operator_request.required, true);
  assert.equal(report.safety.no_external_posting, true);
});

test("Goal 27 recognises a defined section while preserving upstream blockers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal27-defined-"));
  const docPath = path.join(root, "docs", "codex-main-goal.md");
  await fs.outputFile(docPath, [
    "# Campaign",
    "",
    "### 27. Voice Identity and Audio Branding",
    "",
    "Define sonic logo, voice rules and audio brand controls.",
    "",
    "Outputs: `voice_identity_manifest.json`, `audio_branding_guide.md`.",
    "",
    "Acceptance: no live publishing and no token mutation.",
    "",
    "### 28. Next Gate",
    "",
  ].join("\n"));

  const report = await buildGoal27DefinitionMissing({
    campaignDocPath: docPath,
    upstreamGoal26Report: { verdict: "BLOCKED" },
    storyPackages: [{ story_id: "story-c" }],
    generatedAt: "2026-05-26T08:08:37.688Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_definition_verdict, "PASS");
  assert.equal(report.goal_definition.found, true);
  assert.equal(report.goal_definition.title, "Voice Identity and Audio Branding");
  assert.deepEqual(report.goal_definition.outputs, ["voice_identity_manifest.json", "audio_branding_guide.md"]);
  assert.deepEqual(report.direct_blockers, []);
  assert.ok(report.blockers.includes("upstream:goal26_creator_studio_brand_system_blocked"));
});

test("Goal 27 writes machine-readable and human-readable definition-gap artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal27-write-"));
  const docPath = path.join(root, "docs", "codex-main-goal.md");
  await fs.outputFile(docPath, "# Campaign\n\n### 26. Creator Studio Brand System\n");
  const report = await buildGoal27DefinitionMissing({
    campaignDocPath: docPath,
    upstreamGoal26Report: { verdict: "BLOCKED" },
    storyPackages: [],
    generatedAt: "2026-05-26T08:08:37.688Z",
  });
  const outDir = path.join(root, "out");

  const written = await writeGoal27DefinitionMissing(report, { outputDir: outDir });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.contractGapReport), true);
  assert.equal(await fs.pathExists(written.operatorRequest), true);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildAgentOperatingRulesReport,
  renderAgentOperatingRulesMarkdown,
  writeAgentOperatingRulesArtifacts,
} = require("../../lib/ops/agent-operating-rules");

test("Goal 00: repo AGENTS.md contains the production safety operating rules", async () => {
  const rootDir = path.resolve(__dirname, "..", "..");
  const report = await buildAgentOperatingRulesReport({ rootDir });

  assert.equal(report.goal_id, "goal_00_repo_operating_rules");
  assert.equal(report.agents_md.exists, true);
  assert.equal(report.status, "PASS");
  assert.equal(report.summary.missing_critical_rules, 0);
  assert.equal(report.summary.missing_required_sections, 0);
  assert.equal(report.safety.live_publish_allowed_by_default, false);
  assert.equal(report.safety.production_db_mutation_allowed_by_default, false);
  assert.equal(report.safety.oauth_token_mutation_allowed_by_default, false);
  assert.equal(report.safety.external_posting_allowed_by_default, false);
});

test("Goal 00: missing safety language fails with clear rejection reasons", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-agent-rules-"));
  try {
    await fs.writeFile(
      path.join(tmp, "AGENTS.md"),
      "# Thin rules\n\nRun fast and publish when rendered.\n",
      "utf8",
    );

    const report = await buildAgentOperatingRulesReport({ rootDir: tmp });

    assert.equal(report.status, "FAIL");
    assert.ok(report.summary.missing_critical_rules > 0);
    assert.ok(report.rejection_reasons.includes("critical_safety_language_missing"));
  } finally {
    await fs.remove(tmp);
  }
});

test("Goal 00: validation writes JSON and human-readable artefacts", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-agent-artifacts-"));
  try {
    await fs.writeFile(
      path.join(tmp, "AGENTS.md"),
      [
        "# Pulse Gaming agent rules",
        "",
        "## Repo layout",
        "## Key directories",
        "## Build commands",
        "## Test commands",
        "## Render commands",
        "## Dry-run publish commands",
        "## Safety modes",
        "LOCAL_PROOF is the default mode.",
        "DRY_RUN_PUBLISH is the default publish mode.",
        "## Banned behaviours",
        "No live publishing by default.",
        "No OAuth/token mutation by default.",
        "No production DB mutation by default.",
        "Do not weaken gates.",
        "TDD is required.",
        "Focused tests are required.",
        "Machine-readable artefacts are required.",
        "Proof reporting is required.",
        "## Current production-cutover context",
        "## Definition of done",
        "## Focused tests",
        "## Full tests",
        "## Preflight",
        "## Render health",
        "## Repair backlog",
        "## Platform packs",
        "## Pulse Gaming production law",
        "Rendered does not mean publishable.",
        "Dry-run package does not mean scheduler-ready.",
        "Scheduler-ready does not mean platform-ready.",
        "Platform-ready does not mean safe to auto-publish.",
        "Only GREEN control tower verdict can publish.",
        "Placeholder titles are production incidents.",
        "Internal QA language in public narration is a production incident.",
        "Missing narration, timestamps, materialised motion or rights records blocks publishing.",
        "All readiness claims must be backed by artefacts.",
      ].join("\n"),
      "utf8",
    );

    const report = await buildAgentOperatingRulesReport({ rootDir: tmp });
    const paths = await writeAgentOperatingRulesArtifacts(report, {
      outputDir: path.join(tmp, "out"),
    });
    const markdown = renderAgentOperatingRulesMarkdown(report);

    assert.equal(await fs.pathExists(paths.jsonPath), true);
    assert.equal(await fs.pathExists(paths.markdownPath), true);
    assert.match(markdown, /Goal 00 Agent Operating Rules/);
    assert.match(markdown, /Status: PASS/);
  } finally {
    await fs.remove(tmp);
  }
});

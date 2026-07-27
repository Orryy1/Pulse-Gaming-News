#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  buildGoalDryRunPublishReport,
  loadReadOnlySnapshot,
  parseCliArgs,
  renderGoalDryRunPublishMarkdown,
  resolvePreflightProvenance,
  writeProofArtifacts,
} = require("../lib/ops/stabilisation-preflight");

const ROOT = path.resolve(__dirname, "..");

function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  const snapshot = loadReadOnlySnapshot({
    snapshotPath: args.snapshot,
    stateRoot: args["state-root"] || ROOT,
    env: process.env,
  });
  const provenance = resolvePreflightProvenance({
    cwd: ROOT,
    env: process.env,
    sourceCommitSha: args["source-commit-sha"],
    runtimeCommitSha: args["runtime-commit-sha"],
  });
  const report = buildGoalDryRunPublishReport({
    snapshot,
    env: process.env,
    generatedAt: args["generated-at"],
    sourceCommitSha: provenance.sourceCommitSha,
    runtimeCommitSha: provenance.runtimeCommitSha,
  });
  const files = writeProofArtifacts({
    outDir: args["out-dir"] || path.join(ROOT, "output", "preflight"),
    stem: "goal_dry_run_publish",
    report,
    markdown: renderGoalDryRunPublishMarkdown(report),
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      report: "goal_dry_run_publish",
      verdict: report.verdict,
      package_ready: report.package_ready,
      publish_authorised: false,
      files,
    })}\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[goal-dry-run-publish] ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };

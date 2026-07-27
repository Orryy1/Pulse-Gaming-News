#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  buildNextPublishCandidatesReport,
  loadReadOnlySnapshot,
  parseCliArgs,
  renderNextPublishCandidatesMarkdown,
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
  const report = buildNextPublishCandidatesReport({
    snapshot,
    env: process.env,
    generatedAt: args["generated-at"],
    sourceCommitSha: provenance.sourceCommitSha,
    runtimeCommitSha: provenance.runtimeCommitSha,
  });
  const files = writeProofArtifacts({
    outDir: args["out-dir"] || path.join(ROOT, "output", "preflight"),
    stem: "next_publish_candidates",
    report,
    markdown: renderNextPublishCandidatesMarkdown(report),
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      report: "next_publish_candidates",
      verdict: report.verdict,
      scheduler_ready: report.scheduler_ready,
      files,
    })}\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[next-publish-candidates] ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };

#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  buildPlatformDoctorReport,
  loadReadOnlySnapshot,
  parseCliArgs,
  renderPlatformDoctorMarkdown,
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
  const report = buildPlatformDoctorReport({
    snapshot,
    env: process.env,
    generatedAt: args["generated-at"],
    sourceCommitSha: provenance.sourceCommitSha,
    runtimeCommitSha: provenance.runtimeCommitSha,
  });
  const files = writeProofArtifacts({
    outDir: args["out-dir"] || path.join(ROOT, "output", "preflight"),
    stem: "platform_doctor",
    report,
    markdown: renderPlatformDoctorMarkdown(report),
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      report: "platform_doctor",
      verdict: report.verdict,
      publish_authorised: false,
      files,
    })}\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[platform-doctor] ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };

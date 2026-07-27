#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  composeCutoverBackupEvidence,
  parseCliArgs,
  writeArtifacts,
} = require("../lib/ops/cutover-backup-evidence");

async function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  const result = await composeCutoverBackupEvidence({
    databasePath: args.database,
    backupVerificationPath: args["backup-verification"],
    restoreRehearsalPath: args["restore-rehearsal"],
    generatedAt: args["generated-at"] || new Date(),
    verifiedBy: args["verified-by"],
  });
  const files = writeArtifacts({
    outDir:
      args["out-dir"] ||
      path.resolve(process.cwd(), "output", "cutover-backup-evidence"),
    result,
    protectedPaths: [
      args.database,
      args["backup-verification"],
      args["restore-rehearsal"],
    ],
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: result.verdict === "PASS",
      verdict: result.verdict,
      blockers: result.blockers,
      files,
    })}\n`,
  );
  if (result.verdict !== "PASS") process.exitCode = 2;
  return { result, files };
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `[cutover-backup-evidence] ${String(error?.message || error)}\n`,
    );
    process.exitCode = 1;
  });
}

module.exports = { main };

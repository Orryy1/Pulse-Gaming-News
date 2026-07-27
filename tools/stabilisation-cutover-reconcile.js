#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  buildCutoverPlan,
  dryRunResult,
  executeCutoverApply,
  failedApplyResult,
  hashFile,
  inspectDatabase,
  parseCliArgs,
  readExistingCutoverAudit,
  verifyBackupEvidence,
  writeCutoverArtifacts,
} = require("../lib/ops/stabilisation-cutover-reconcile");

function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  const generatedAt = new Date(
    args["generated-at"] || new Date(),
  ).toISOString();
  const inspection = inspectDatabase({
    databasePath: args.database,
    generatedAt,
  });
  const existingAudit = readExistingCutoverAudit({
    databasePath: inspection.database_path,
    cutoverId: args["cutover-id"],
  });
  const backupVerification = verifyBackupEvidence({
    evidencePath: args["backup-evidence"],
    databasePath: inspection.database_path,
    generatedAt,
    allowSourceMismatch: Boolean(existingAudit),
  });
  const plan = buildCutoverPlan({
    inspection,
    applyRequested: args.apply,
    cutoverId: args["cutover-id"],
    sourceCommitSha: args["source-commit-sha"],
    runtimeCommitSha: args["runtime-commit-sha"],
    orphanGraceMin: args["orphan-grace-min"] || 10,
    confirmationId: args["confirm-cutover-id"],
    backupVerification,
    env: process.env,
  });
  const beforeApplyHash = hashFile(inspection.database_path);
  let executionError = null;
  let result;
  if (plan.apply_authorised) {
    try {
      result = executeCutoverApply({
        databasePath: inspection.database_path,
        plan,
        env: process.env,
        allowSourceMismatch: Boolean(existingAudit),
      });
    } catch (error) {
      executionError = error;
      result = failedApplyResult({
        plan,
        error,
        rollbackVerified:
          hashFile(inspection.database_path) === beforeApplyHash,
      });
    }
  } else {
    result = dryRunResult(plan);
  }
  const files = writeCutoverArtifacts({
    outDir:
      args["out-dir"] ||
      path.resolve(process.cwd(), "output", "stabilisation-cutover"),
    plan,
    result,
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      verdict: result.verdict,
      mode: result.mode,
      apply_authorised: result.apply_authorised,
      files,
    })}\n`,
  );
  if (executionError) {
    process.stderr.write(
      `[stabilisation-cutover-reconcile] apply rolled back: ${executionError.message}\n`,
    );
    process.exitCode = 1;
  }
  return { plan, result, files };
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `[stabilisation-cutover-reconcile] ${error.message}\n`,
    );
    process.exitCode = 1;
  }
}

module.exports = { main };

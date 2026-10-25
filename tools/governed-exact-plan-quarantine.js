#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

const {
  QUARANTINE_REQUEST_SCHEMA_VERSION,
  quarantineExactGovernedProductionPlan,
  safeBlocker,
} = require("../lib/ops/governed-exact-plan-quarantine");

const VALUE_FLAGS = new Set([
  "--mode",
  "--maintenance-mode",
  "--change-id",
  "--confirm",
  "--operator",
  "--plan",
  "--plan-file-sha256",
  "--plan-sha256",
  "--plan-workspace-root",
  "--expected-plan-commit",
  "--executor-workspace-root",
  "--expected-executor-commit",
  "--database",
  "--runtime-profile",
  "--runtime-profile-file-sha256",
  "--reservation-file-sha256",
  "--reservation-set-sha256",
  "--primary-job-id",
  "--standby-job-id",
  "--database-sha256",
  "--backup-evidence",
  "--backup-evidence-file-sha256",
  "--out-dir",
]);
const REQUIRED_FLAGS = [...VALUE_FLAGS];
const APPLY_FLAG = "--apply";
const PUBLIC_RESULT_BLOCKERS = new Set([
  "quarantine_evidence_pending",
  "quarantine_lease_release_failed",
  "quarantine_transition_lease_present",
]);

function requiredValue(argv, index, flag) {
  const value = argv[index + 1];
  if (
    value === undefined ||
    String(value).trim() === "" ||
    String(value).startsWith("--")
  ) {
    throw new Error(`value_required:${flag}`);
  }
  return String(value).trim();
}

function positiveInteger(value, flag) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1) {
    throw new Error(`positive_integer_required:${flag}`);
  }
  return Number(value);
}

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      if (argv.length !== 1) throw new Error("help_must_be_used_alone");
      return { help: true };
    }
    if (flag === APPLY_FLAG) {
      if (parsed[flag] !== undefined) {
        throw new Error(`duplicate_argument:${flag}`);
      }
      parsed[flag] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) throw new Error(`unknown_argument:${flag}`);
    if (parsed[flag] !== undefined) {
      throw new Error(`duplicate_argument:${flag}`);
    }
    parsed[flag] = requiredValue(argv, index, flag);
    index += 1;
  }
  for (const flag of [...REQUIRED_FLAGS, APPLY_FLAG]) {
    if (parsed[flag] === undefined) {
      throw new Error(`required_argument_missing:${flag}`);
    }
  }
  if (parsed["--mode"] !== "LOCAL_PROOF") {
    throw new Error("quarantine_local_proof_only");
  }
  if (parsed["--maintenance-mode"] !== "HUMAN_REVIEW") {
    throw new Error("quarantine_human_review_only");
  }
  if (parsed["--confirm"] !== parsed["--change-id"]) {
    throw new Error("quarantine_confirmation_mismatch");
  }
  return {
    help: false,
    mode: "LOCAL_PROOF",
    maintenanceMode: "HUMAN_REVIEW",
    apply: true,
    changeId: parsed["--change-id"],
    confirmationId: parsed["--confirm"],
    operatorId: parsed["--operator"],
    planPath: path.resolve(parsed["--plan"]),
    planFileSha256: parsed["--plan-file-sha256"].toLowerCase(),
    planSha256: parsed["--plan-sha256"].toLowerCase(),
    workspaceRoot: path.resolve(parsed["--plan-workspace-root"]),
    expectedCheckoutCommit: parsed["--expected-plan-commit"].toLowerCase(),
    executorWorkspaceRoot: path.resolve(parsed["--executor-workspace-root"]),
    expectedExecutorCheckoutCommit:
      parsed["--expected-executor-commit"].toLowerCase(),
    databasePath: path.resolve(parsed["--database"]),
    runtimeProfilePath: path.resolve(parsed["--runtime-profile"]),
    runtimeProfileFileSha256:
      parsed["--runtime-profile-file-sha256"].toLowerCase(),
    reservationFileSha256: parsed["--reservation-file-sha256"].toLowerCase(),
    reservationSetSha256: parsed["--reservation-set-sha256"].toLowerCase(),
    primaryJobId: positiveInteger(
      parsed["--primary-job-id"],
      "--primary-job-id",
    ),
    standbyJobId: positiveInteger(
      parsed["--standby-job-id"],
      "--standby-job-id",
    ),
    databaseSha256: parsed["--database-sha256"].toLowerCase(),
    backupEvidencePath: path.resolve(parsed["--backup-evidence"]),
    backupEvidenceFileSha256:
      parsed["--backup-evidence-file-sha256"].toLowerCase(),
    outputDir: path.resolve(parsed["--out-dir"]),
  };
}

function sealedAuthorityEnvironment() {
  return Object.freeze({
    PULSE_OPERATING_MODE: "LOCAL_PROOF",
    OPERATING_MODE: "LOCAL_PROOF",
    AUTO_PUBLISH: "false",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
    PULSE_PRIMARY_INSTANCE: "false",
    PULSE_KILL_SWITCH: "true",
  });
}

function requestFromParsed(parsed, generatedAt) {
  return {
    schema_version: QUARANTINE_REQUEST_SCHEMA_VERSION,
    mode: parsed.mode,
    maintenance_mode: parsed.maintenanceMode,
    generated_at: generatedAt.toISOString(),
    apply: parsed.apply,
    confirmation_id: parsed.confirmationId,
    change_id: parsed.changeId,
    operator_id: parsed.operatorId,
    plan_path: parsed.planPath,
    expected_plan_file_sha256: parsed.planFileSha256,
    expected_plan_sha256: parsed.planSha256,
    workspace_root: parsed.workspaceRoot,
    database_path: parsed.databasePath,
    runtime_profile_path: parsed.runtimeProfilePath,
    expected_runtime_profile_file_sha256: parsed.runtimeProfileFileSha256,
    expected_checkout_commit: parsed.expectedCheckoutCommit,
    executor_workspace_root: parsed.executorWorkspaceRoot,
    expected_executor_checkout_commit: parsed.expectedExecutorCheckoutCommit,
    expected_reservation_file_sha256: parsed.reservationFileSha256,
    expected_reservation_set_sha256: parsed.reservationSetSha256,
    expected_primary_job_id: parsed.primaryJobId,
    expected_standby_job_id: parsed.standbyJobId,
    expected_database_sha256: parsed.databaseSha256,
    backup_evidence_path: parsed.backupEvidencePath,
    expected_backup_evidence_file_sha256: parsed.backupEvidenceFileSha256,
    output_dir: parsed.outputDir,
  };
}

function safeFailureBlocker(error, safeBlockerImpl = safeBlocker) {
  const moduleBlocker = safeBlockerImpl(error);
  if (
    moduleBlocker !== "quarantine_apply_failed" ||
    String(error?.code || "") === "quarantine_apply_failed" ||
    String(error?.message || "") === "quarantine_apply_failed"
  ) {
    return moduleBlocker;
  }
  return `quarantine_unexpected_error:${crypto
    .createHash("sha256")
    .update(
      `${String(error?.name || "Error")}:${String(
        error?.message || "quarantine_cli_failed",
      )}`,
    )
    .digest("hex")}`;
}

function sanitiseResult(result) {
  const output = {};
  for (const key of [
    "verdict",
    "status",
    "operation_fingerprint",
    "request_fingerprint",
    "plan_sha256",
    "plan_file_sha256",
    "reservation_file_sha256",
    "reservation_set_sha256",
    "database_sha256",
    "plan_checkout_commit",
    "executor_checkout_commit",
    "backup_evidence_file_sha256",
    "change_id",
    "primary_job_id",
    "standby_job_id",
    "disposition",
    "completion_receipt_created",
    "publication_authority_created",
    "audit_id",
  ]) {
    if (Object.prototype.hasOwnProperty.call(result || {}, key)) {
      output[key] = result[key];
    }
  }
  if (Object.prototype.hasOwnProperty.call(result || {}, "blocker")) {
    output.blocker = PUBLIC_RESULT_BLOCKERS.has(result.blocker)
      ? result.blocker
      : "quarantine_apply_failed";
  }
  if (result?.evidence && typeof result.evidence === "object") {
    output.evidence = {};
    for (const key of [
      "json_path",
      "markdown_path",
      "commit_path",
      "json_status",
      "markdown_status",
      "commit_status",
      "json_fsync_status",
      "markdown_fsync_status",
      "commit_fsync_status",
      "directory_fsync_status",
      "body_directory_fsync_status",
      "commit_directory_fsync_status",
    ]) {
      if (Object.prototype.hasOwnProperty.call(result.evidence, key)) {
        output.evidence[key] = result.evidence[key];
      }
    }
  }
  return output;
}

function usage() {
  return [
    "Usage:",
    "  node tools/governed-exact-plan-quarantine.js \\",
    "    --mode LOCAL_PROOF --maintenance-mode HUMAN_REVIEW --apply \\",
    "    --change-id <change-id> --confirm <same-change-id> --operator <operator> \\",
    "    --plan <plan> --plan-workspace-root <old-plan-workspace> \\",
    "    --expected-plan-commit <old-plan-commit> \\",
    "    --executor-workspace-root <executor-workspace> \\",
    "    --expected-executor-commit <executor-commit> \\",
    "    --database <database> --runtime-profile <profile-in-plan-workspace> \\",
    "    --out-dir <evidence-output-inside-plan-workspace> <all required exact hashes and job IDs>",
    "",
    "Requires LOCAL_PROOF, HUMAN_REVIEW, --apply, and matching --change-id/--confirm.",
    "The plan workspace/commit and executor workspace/commit are separate immutable bindings.",
    "Mutates only the exact pending standby job after all quarantine gates pass.",
    "Creates no publish, OAuth, token, or platform authority.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const stdout = dependencies.stdout || ((text) => process.stdout.write(text));
  const parsed = parseArgs(argv);
  if (parsed.help) {
    stdout(`${usage()}\n`);
    return 0;
  }
  const now = dependencies.now || (() => new Date());
  const generatedAt = now();
  if (!(generatedAt instanceof Date) || Number.isNaN(generatedAt.getTime())) {
    throw new Error("quarantine_clock_invalid");
  }
  const runQuarantine =
    dependencies.runQuarantine || quarantineExactGovernedProductionPlan;
  const result = await runQuarantine(requestFromParsed(parsed, generatedAt), {
    env: sealedAuthorityEnvironment(),
  });
  stdout(`${JSON.stringify(sanitiseResult(result), null, 2)}\n`);
  return result?.verdict === "QUARANTINED" ? 0 : 1;
}

if (require.main === module) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error) => {
      process.stderr.write(
        `${JSON.stringify({
          verdict: "HOLD",
          blocker: safeFailureBlocker(error),
        })}\n`,
      );
      process.exitCode = 1;
    },
  );
}

module.exports = {
  main,
  parseArgs,
  requestFromParsed,
  safeFailureBlocker,
  sealedAuthorityEnvironment,
  sanitiseResult,
  usage,
};

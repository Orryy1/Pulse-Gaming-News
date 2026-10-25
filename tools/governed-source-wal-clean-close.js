#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  cleanCloseGovernedSourceWal,
  REQUEST_SCHEMA,
} = require("../lib/ops/governed-source-wal-clean-close");

const VALUE_FLAGS = new Set([
  "--mode",
  "--maintenance-mode",
  "--generated-at",
  "--expires-at",
  "--change-id",
  "--confirm",
  "--operator",
  "--database",
  "--database-sha256",
  "--runtime-profile",
  "--runtime-profile-file-sha256",
  "--activation-receipt",
  "--executor-workspace-root",
  "--expected-executor-commit",
  "--out-dir",
]);
const REQUIRED_FLAGS = [...VALUE_FLAGS];
const APPLY_FLAG = "--apply";

function requiredValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || String(value).startsWith("--")) {
    throw new Error(`value_required:${flag}`);
  }
  return String(value).trim();
}

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === APPLY_FLAG) {
      if (parsed[flag]) throw new Error(`duplicate_argument:${flag}`);
      parsed[flag] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) throw new Error(`invalid_argument:${flag}`);
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
  if (
    parsed["--mode"] !== "LOCAL_PROOF" ||
    parsed["--maintenance-mode"] !== "HUMAN_REVIEW"
  ) {
    throw new Error("source_wal_mode_invalid");
  }
  if (parsed["--confirm"] !== parsed["--change-id"]) {
    throw new Error("source_wal_confirmation_invalid");
  }
  return {
    schema_version: REQUEST_SCHEMA,
    mode: "LOCAL_PROOF",
    maintenance_mode: "HUMAN_REVIEW",
    apply: true,
    generated_at: parsed["--generated-at"],
    expires_at: parsed["--expires-at"],
    confirmation_id: parsed["--confirm"],
    change_id: parsed["--change-id"],
    operator_id: parsed["--operator"],
    database_path: path.resolve(parsed["--database"]),
    expected_database_sha256: parsed["--database-sha256"].toLowerCase(),
    runtime_profile_path: path.resolve(parsed["--runtime-profile"]),
    expected_runtime_profile_file_sha256:
      parsed["--runtime-profile-file-sha256"].toLowerCase(),
    activation_receipt_path: path.resolve(parsed["--activation-receipt"]),
    executor_workspace_root: path.resolve(parsed["--executor-workspace-root"]),
    expected_executor_checkout_commit:
      parsed["--expected-executor-commit"].toLowerCase(),
    output_dir: path.resolve(parsed["--out-dir"]),
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

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const execute = dependencies.cleanClose || cleanCloseGovernedSourceWal;
  const result = await execute(parseArgs(argv), {
    env: sealedAuthorityEnvironment(),
  });
  const publicResult = {
    verdict: result.verdict,
    blockers: result.blockers,
    status: result.status,
    evidence_json: result.evidence_json,
    evidence_markdown: result.evidence_markdown,
    evidence_commit: result.evidence_commit,
    backup_evidence_json: result.backup_evidence_json,
    phase_journals: result.phase_journals,
    protected_validation: result.protected_validation,
    canonical_artifacts: result.canonical_artifacts,
    final_completion_authority: result.final_completion_authority,
    transition_lease_boundary: result.transition_lease_boundary,
    no_clobber_crash_recovery: result.no_clobber_crash_recovery,
    source_maintenance_performed: result.source_maintenance_performed,
    external_authority: result.external_authority,
    lease_released_before_post_release_evidence:
      result.lease_released_before_post_release_evidence,
    continuous_transition_lease_coverage_claimed:
      result.continuous_transition_lease_coverage_claimed,
    post_release_maintenance_window: result.post_release_maintenance_window,
    post_release_compensating_fences: result.post_release_compensating_fences,
  };
  const stdout =
    dependencies.stdout || ((value) => process.stdout.write(value));
  stdout(`${JSON.stringify(publicResult)}\n`);
  return result.verdict === "PASS" ? 0 : 2;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.stderr.write(
        "governed source WAL clean-close refused; no details emitted\n",
      );
      process.exitCode = 1;
    });
}

module.exports = {
  main,
  parseArgs,
  sealedAuthorityEnvironment,
};

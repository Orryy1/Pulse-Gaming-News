"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const SHA = "a".repeat(64);
const COMMIT = "b".repeat(40);

function loadCli() {
  try {
    return require("../../tools/governed-exact-plan-quarantine");
  } catch (error) {
    assert.fail(
      `quarantine CLI must be available: ${error.code || error.name}`,
    );
  }
}

function argv(overrides = []) {
  return [
    "--mode",
    "LOCAL_PROOF",
    "--maintenance-mode",
    "HUMAN_REVIEW",
    "--apply",
    "--change-id",
    "chg-42",
    "--confirm",
    "chg-42",
    "--operator",
    "operator-1",
    "--plan",
    "C:\\Pulse\\old-plan\\production-plan.json",
    "--plan-file-sha256",
    SHA,
    "--plan-sha256",
    SHA,
    "--plan-workspace-root",
    "C:\\Pulse\\old-plan",
    "--expected-plan-commit",
    COMMIT,
    "--executor-workspace-root",
    "D:\\Pulse\\release",
    "--expected-executor-commit",
    COMMIT,
    "--database",
    "D:\\pulse-data\\pulse.db",
    "--runtime-profile",
    "C:\\Pulse\\old-plan\\config\\runtime.json",
    "--runtime-profile-file-sha256",
    SHA,
    "--reservation-file-sha256",
    SHA,
    "--reservation-set-sha256",
    SHA,
    "--primary-job-id",
    "135780",
    "--standby-job-id",
    "135781",
    "--database-sha256",
    SHA,
    "--backup-evidence",
    "D:\\pulse-data\\cutover-backup.json",
    "--backup-evidence-file-sha256",
    SHA,
    "--out-dir",
    "C:\\Pulse\\old-plan\\output\\quarantine",
    ...overrides,
  ];
}

test("parseArgs admits only the complete explicit LOCAL_PROOF quarantine request", () => {
  const { parseArgs } = loadCli();
  const parsed = parseArgs(argv());

  assert.equal(parsed.mode, "LOCAL_PROOF");
  assert.equal(parsed.maintenanceMode, "HUMAN_REVIEW");
  assert.equal(parsed.apply, true);
  assert.equal(parsed.changeId, "chg-42");
  assert.equal(parsed.confirmationId, "chg-42");
  assert.equal(parsed.workspaceRoot, path.resolve("C:\\Pulse\\old-plan"));
  assert.equal(parsed.expectedCheckoutCommit, COMMIT);
  assert.equal(
    parsed.executorWorkspaceRoot,
    path.resolve("D:\\Pulse\\release"),
  );
  assert.equal(parsed.expectedExecutorCheckoutCommit, COMMIT);
  assert.equal(parsed.primaryJobId, 135780);
  assert.equal(parsed.standbyJobId, 135781);
  assert.throws(
    () => parseArgs(argv(["--apply"])),
    /duplicate_argument:--apply/,
  );
  assert.throws(
    () => parseArgs(argv(["--publish", "true"])),
    /unknown_argument:--publish/,
  );
  const missingOperator = argv();
  missingOperator.splice(missingOperator.indexOf("--operator"), 2);
  assert.throws(
    () => parseArgs(missingOperator),
    /required_argument_missing:--operator/,
  );
  const mismatchedConfirmation = argv();
  mismatchedConfirmation[mismatchedConfirmation.indexOf("--confirm") + 1] =
    "another-change";
  assert.throws(
    () => parseArgs(mismatchedConfirmation),
    /quarantine_confirmation_mismatch/,
  );
});

test("main delegates a timestamped exact request with a sealed no-publish authority environment", async () => {
  const { main } = loadCli();
  const calls = [];
  let stdout = "";
  const exitCode = await main(argv(), {
    now: () => new Date("2026-08-01T12:00:00.000Z"),
    async runQuarantine(request, dependencies) {
      calls.push({ request, dependencies });
      return {
        verdict: "QUARANTINED",
        status: "APPLIED",
        operation_fingerprint: SHA,
        primary_job_id: 135780,
        standby_job_id: 135781,
        completion_receipt_created: false,
        publication_authority_created: false,
        internal_error: "secret-must-not-appear",
      };
    },
    stdout(text) {
      stdout += text;
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.generated_at, "2026-08-01T12:00:00.000Z");
  assert.equal(
    calls[0].request.workspace_root,
    path.resolve("C:\\Pulse\\old-plan"),
  );
  assert.equal(calls[0].request.expected_checkout_commit, COMMIT);
  assert.equal(
    calls[0].request.executor_workspace_root,
    path.resolve("D:\\Pulse\\release"),
  );
  assert.equal(calls[0].request.expected_executor_checkout_commit, COMMIT);
  assert.deepEqual(calls[0].dependencies.env, {
    PULSE_OPERATING_MODE: "LOCAL_PROOF",
    OPERATING_MODE: "LOCAL_PROOF",
    AUTO_PUBLISH: "false",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
    PULSE_PRIMARY_INSTANCE: "false",
    PULSE_KILL_SWITCH: "true",
  });
  const output = JSON.parse(stdout);
  assert.equal(output.verdict, "QUARANTINED");
  assert.equal(output.internal_error, undefined);
  assert.equal(stdout.includes("secret-must-not-appear"), false);
});

test("unexpected errors become a stable redacted fingerprint", () => {
  const { safeFailureBlocker } = loadCli();
  const blocker = safeFailureBlocker(new Error("oauth-secret-must-not-appear"));
  assert.match(blocker, /^quarantine_unexpected_error:[a-f0-9]{64}$/);
  assert.equal(blocker.includes("oauth-secret-must-not-appear"), false);
});

test("recovery HOLD output preserves only the safe blocker and durability attestations", async () => {
  const { main } = loadCli();
  let stdout = "";
  const exitCode = await main(argv(), {
    now: () => new Date("2026-08-01T12:00:00.000Z"),
    async runQuarantine() {
      return {
        verdict: "HOLD",
        status: "EVIDENCE_PENDING",
        blocker: "quarantine_evidence_pending",
        operation_fingerprint: SHA,
        evidence: {
          json_path: "D:\\proof\\quarantine.json",
          json_status: "RECOVERABLE",
          json_fsync_status: "PASS",
          markdown_fsync_status: "PASS",
          commit_fsync_status: "PASS",
          directory_fsync_status: "UNSUPPORTED_WINDOWS_EPERM",
          body_directory_fsync_status: "UNSUPPORTED_WINDOWS_EPERM",
          commit_directory_fsync_status: "UNSUPPORTED_WINDOWS_EPERM",
          internal_error: "secret-must-not-appear",
        },
        internal_error: "secret-must-not-appear",
      };
    },
    stdout(text) {
      stdout += text;
    },
  });

  assert.equal(exitCode, 1);
  const output = JSON.parse(stdout);
  assert.equal(output.verdict, "HOLD");
  assert.equal(output.status, "EVIDENCE_PENDING");
  assert.equal(output.blocker, "quarantine_evidence_pending");
  assert.deepEqual(output.evidence, {
    json_path: "D:\\proof\\quarantine.json",
    json_status: "RECOVERABLE",
    json_fsync_status: "PASS",
    markdown_fsync_status: "PASS",
    commit_fsync_status: "PASS",
    directory_fsync_status: "UNSUPPORTED_WINDOWS_EPERM",
    body_directory_fsync_status: "UNSUPPORTED_WINDOWS_EPERM",
    commit_directory_fsync_status: "UNSUPPORTED_WINDOWS_EPERM",
  });
  assert.equal(stdout.includes("secret-must-not-appear"), false);
});

test("recovery HOLD output redacts an unowned blocker", async () => {
  const { main } = loadCli();
  let stdout = "";
  const exitCode = await main(argv(), {
    now: () => new Date("2026-08-01T12:00:00.000Z"),
    async runQuarantine() {
      return {
        verdict: "HOLD",
        status: "RECOVERY_REQUIRED",
        blocker: "secret-must-not-appear",
      };
    },
    stdout(text) {
      stdout += text;
    },
  });

  assert.equal(exitCode, 1);
  const output = JSON.parse(stdout);
  assert.equal(output.blocker, "quarantine_apply_failed");
  assert.equal(stdout.includes("secret-must-not-appear"), false);
});

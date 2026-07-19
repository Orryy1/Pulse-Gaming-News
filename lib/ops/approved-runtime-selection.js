"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function resolveNormalDirectory(value, code) {
  if (!value || !path.isAbsolute(value)) {
    fail(`${code}_must_be_absolute`);
  }

  let inputStat;
  let resolved;
  try {
    inputStat = fs.lstatSync(value);
    resolved = fs.realpathSync(value);
  } catch {
    fail(`${code}_missing`);
  }

  if (!inputStat.isDirectory() || inputStat.isSymbolicLink()) {
    fail(`${code}_not_normal_directory`);
  }
  return resolved;
}

function runGit(gitExecutable, repositoryRoot, args) {
  try {
    return childProcess
      .execFileSync(gitExecutable, ["-C", repositoryRoot, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      })
      .trim();
  } catch {
    fail("approved_runtime_selection_git_probe_failed");
  }
}

function readSelection(selectionPath) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(selectionPath, "utf8"));
  } catch {
    fail("approved_runtime_selection_invalid_json");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("approved_runtime_selection_invalid_shape");
  }
  return value;
}

function resolveApprovedRuntimeSelection({
  supervisorRoot,
  defaultEvidenceRoot,
  gitExecutable = process.env.GIT_EXECUTABLE || "git",
} = {}) {
  const resolvedSupervisorRoot = resolveNormalDirectory(
    supervisorRoot,
    "approved_runtime_selection_supervisor_root",
  );
  const selectionPath = path.join(
    resolvedSupervisorRoot,
    "output",
    "runtime",
    "pulse-approved-runtime-selection.json",
  );

  if (!fs.existsSync(selectionPath)) {
    return {
      schema_version: 1,
      configured: false,
      selection_path: selectionPath,
    };
  }

  const selection = readSelection(selectionPath);
  if (Number(selection.schema_version) !== 1) {
    fail("approved_runtime_selection_unsupported_schema");
  }
  if (selection.operator_confirmed !== true) {
    fail("approved_runtime_selection_operator_confirmation_missing");
  }
  if (!String(selection.reason || "").trim()) {
    fail("approved_runtime_selection_reason_missing");
  }

  const expectedCommit = String(selection.expected_commit_sha || "").trim();
  const expectedBranch = String(selection.expected_branch || "").trim();
  if (!/^[a-f0-9]{40}$/i.test(expectedCommit)) {
    fail("approved_runtime_selection_expected_commit_invalid");
  }
  if (!expectedBranch || expectedBranch === "HEAD") {
    fail("approved_runtime_selection_expected_branch_invalid");
  }

  const runtimeRoot = resolveNormalDirectory(
    String(selection.runtime_repo_root || ""),
    "approved_runtime_selection_runtime_root",
  );
  const evidenceRoot = resolveNormalDirectory(
    String(selection.evidence_root || defaultEvidenceRoot || ""),
    "approved_runtime_selection_evidence_root",
  );
  const runtimeEntrypoint = path.join(
    runtimeRoot,
    "tools",
    "local-live-primary-runtime.ps1",
  );

  if (!fs.existsSync(runtimeEntrypoint) || !fs.statSync(runtimeEntrypoint).isFile()) {
    fail("approved_runtime_selection_entrypoint_missing");
  }
  if (!fs.existsSync(path.join(runtimeRoot, ".env"))) {
    fail("approved_runtime_selection_env_missing");
  }
  for (const directory of ["tokens", "node_modules"]) {
    const requiredPath = path.join(runtimeRoot, directory);
    if (!fs.existsSync(requiredPath) || !fs.statSync(requiredPath).isDirectory()) {
      fail(`approved_runtime_selection_${directory}_missing`);
    }
  }

  const actualCommit = runGit(gitExecutable, runtimeRoot, ["rev-parse", "HEAD"]);
  const actualBranch = runGit(gitExecutable, runtimeRoot, [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  const trackedStatus = runGit(gitExecutable, runtimeRoot, [
    "status",
    "--porcelain",
    "--untracked-files=no",
  ]);

  if (actualCommit.toLowerCase() !== expectedCommit.toLowerCase()) {
    fail("approved_runtime_selection_commit_mismatch");
  }
  if (actualBranch !== expectedBranch) {
    fail("approved_runtime_selection_branch_mismatch");
  }
  if (trackedStatus) {
    fail("approved_runtime_selection_target_tracked_dirty");
  }

  let runtimeOutput;
  let evidenceOutput;
  try {
    runtimeOutput = fs.realpathSync(path.join(runtimeRoot, "output"));
    evidenceOutput = fs.realpathSync(path.join(evidenceRoot, "output"));
  } catch {
    fail("approved_runtime_selection_shared_output_missing");
  }
  if (runtimeOutput.toLowerCase() !== evidenceOutput.toLowerCase()) {
    fail("approved_runtime_selection_shared_output_mismatch");
  }

  return {
    schema_version: 1,
    configured: true,
    selection_path: selectionPath,
    runtime_repo_root: runtimeRoot,
    evidence_root: evidenceRoot,
    runtime_entrypoint: runtimeEntrypoint,
    commit_sha: actualCommit,
    branch: actualBranch,
    tracked_worktree_clean: true,
    shared_output_verified: true,
    reason: String(selection.reason).trim(),
  };
}

module.exports = {
  resolveApprovedRuntimeSelection,
};

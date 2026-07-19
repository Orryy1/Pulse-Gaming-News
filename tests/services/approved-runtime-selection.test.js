"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildGitArgs,
  resolveApprovedRuntimeSelection,
} = require("../../lib/ops/approved-runtime-selection");

function runGit(cwd, args) {
  return childProcess.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-runtime-selection-"));
  const supervisorRoot = path.join(root, "supervisor");
  const runtimeRoot = path.join(root, "runtime");
  const outputRoot = path.join(supervisorRoot, "output");
  const branch = "codex/runtime-selection-test";

  fs.mkdirSync(path.join(outputRoot, "runtime"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "tools"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "tokens"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "node_modules"), { recursive: true });
  fs.writeFileSync(
    path.join(runtimeRoot, "tools", "local-live-primary-runtime.ps1"),
    "Write-Output 'fixture'\n",
  );
  fs.writeFileSync(path.join(runtimeRoot, ".env"), "FIXTURE_ONLY=true\n");
  fs.symlinkSync(
    outputRoot,
    path.join(runtimeRoot, "output"),
    process.platform === "win32" ? "junction" : "dir",
  );

  runGit(runtimeRoot, ["init", "-b", branch]);
  runGit(runtimeRoot, ["config", "user.email", "pulse-runtime-test@example.invalid"]);
  runGit(runtimeRoot, ["config", "user.name", "Pulse Runtime Test"]);
  runGit(runtimeRoot, ["add", "tools/local-live-primary-runtime.ps1"]);
  runGit(runtimeRoot, ["commit", "-m", "test: add runtime entrypoint"]);
  const commit = runGit(runtimeRoot, ["rev-parse", "HEAD"]);

  const selectionPath = path.join(
    outputRoot,
    "runtime",
    "pulse-approved-runtime-selection.json",
  );
  const selection = {
    schema_version: 1,
    operator_confirmed: true,
    runtime_repo_root: runtimeRoot,
    evidence_root: supervisorRoot,
    expected_commit_sha: commit,
    expected_branch: branch,
    reason: "test_clean_runtime_handover",
  };
  fs.writeFileSync(selectionPath, `${JSON.stringify(selection, null, 2)}\n`);

  return {
    supervisorRoot,
    runtimeRoot,
    branch,
    commit,
    selectionPath,
  };
}

test("approved runtime selection accepts only a clean exact-commit checkout sharing evidence", () => {
  const fixture = createFixture();
  const result = resolveApprovedRuntimeSelection({
    supervisorRoot: fixture.supervisorRoot,
    defaultEvidenceRoot: fixture.supervisorRoot,
  });

  assert.equal(result.configured, true);
  assert.equal(result.runtime_repo_root, fs.realpathSync(fixture.runtimeRoot));
  assert.equal(result.evidence_root, fs.realpathSync(fixture.supervisorRoot));
  assert.equal(result.commit_sha, fixture.commit);
  assert.equal(result.branch, fixture.branch);
  assert.equal(result.tracked_worktree_clean, true);
  assert.equal(result.shared_output_verified, true);
});

test("approved runtime selection scopes SYSTEM Git trust to the selected checkout", () => {
  const runtimeRoot = path.resolve("C:/pulse-runtime-fixture");
  assert.deepEqual(buildGitArgs(runtimeRoot, ["rev-parse", "HEAD"]), [
    "-c",
    `safe.directory=${runtimeRoot}`,
    "-C",
    runtimeRoot,
    "rev-parse",
    "HEAD",
  ]);
});

test("approved runtime selection fails closed when tracked runtime code is dirty", () => {
  const fixture = createFixture();
  fs.appendFileSync(
    path.join(fixture.runtimeRoot, "tools", "local-live-primary-runtime.ps1"),
    "# dirty\n",
  );

  assert.throws(
    () =>
      resolveApprovedRuntimeSelection({
        supervisorRoot: fixture.supervisorRoot,
        defaultEvidenceRoot: fixture.supervisorRoot,
      }),
    /approved_runtime_selection_target_tracked_dirty/,
  );
});

test("approved runtime selection fails closed on commit drift or unconfirmed input", () => {
  const fixture = createFixture();
  const selection = JSON.parse(fs.readFileSync(fixture.selectionPath, "utf8"));
  selection.expected_commit_sha = "0".repeat(40);
  fs.writeFileSync(
    fixture.selectionPath,
    `${JSON.stringify(selection, null, 2)}\n`,
  );

  assert.throws(
    () =>
      resolveApprovedRuntimeSelection({
        supervisorRoot: fixture.supervisorRoot,
        defaultEvidenceRoot: fixture.supervisorRoot,
      }),
    /approved_runtime_selection_commit_mismatch/,
  );

  selection.expected_commit_sha = fixture.commit;
  selection.operator_confirmed = false;
  fs.writeFileSync(
    fixture.selectionPath,
    `${JSON.stringify(selection, null, 2)}\n`,
  );
  assert.throws(
    () =>
      resolveApprovedRuntimeSelection({
        supervisorRoot: fixture.supervisorRoot,
        defaultEvidenceRoot: fixture.supervisorRoot,
      }),
    /approved_runtime_selection_operator_confirmation_missing/,
  );
});

test("approved runtime selection reports an absent contract without redirecting", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-runtime-selection-none-"));
  fs.mkdirSync(path.join(root, "output", "runtime"), { recursive: true });

  const result = resolveApprovedRuntimeSelection({
    supervisorRoot: root,
    defaultEvidenceRoot: root,
  });

  assert.deepEqual(result, {
    schema_version: 1,
    configured: false,
    selection_path: path.join(
      fs.realpathSync(root),
      "output",
      "runtime",
      "pulse-approved-runtime-selection.json",
    ),
  });
});

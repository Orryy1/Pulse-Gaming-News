"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  parseArgs,
  main,
  usage,
} = require("../../tools/governed-exact-production-plan-drain");

const SHA = "a".repeat(64);
const COMMIT = "b".repeat(40);

function argv(overrides = []) {
  return [
    "--mode",
    "LOCAL_PROOF",
    "--plan",
    "C:\\Pulse\\production-plan.json",
    "--plan-file-sha256",
    SHA,
    "--plan-sha256",
    SHA,
    "--workspace-root",
    "C:\\Pulse",
    "--database",
    "D:\\pulse-data\\pulse.db",
    "--runtime-profile",
    "C:\\Pulse\\config\\windows-local-runtime.live-guarded-youtube.json",
    "--runtime-profile-file-sha256",
    SHA,
    "--expected-commit",
    COMMIT,
    "--out-dir",
    "C:\\Pulse\\output\\exact-plan-drain",
    ...overrides,
  ];
}

test("parseArgs exposes one closed LOCAL_PROOF exact-plan command surface", () => {
  const parsed = parseArgs(argv());
  assert.equal(parsed.mode, "LOCAL_PROOF");
  assert.equal(parsed.plan, "C:\\Pulse\\production-plan.json");
  assert.equal(parsed.planFileSha256, SHA);
  assert.equal(parsed.planSha256, SHA);
  assert.equal(parsed.expectedCommit, COMMIT);
  assert.equal(parsed.workerId, "pulse-exact-plan-sequential-drain");
  assert.equal(parsed.timeoutMs, 2 * 60 * 60 * 1000);
  assert.equal(parsed.pollIntervalMs, 250);
  assert.throws(
    () => parseArgs(argv(["--publish", "true"])),
    /unknown_argument:--publish/,
  );
  assert.throws(
    () => {
      const unsafe = argv();
      unsafe[1] = "LIVE_GUARDED";
      parseArgs(unsafe);
    },
    /local_proof_only/,
  );
});

test("main opens one exact DB, delegates the closed request and closes the handle", async () => {
  const calls = [];
  const database = {
    close() {
      calls.push(["close"]);
    },
  };
  const repos = {
    db: database,
    jobs: {},
    workers: {},
  };
  let output = "";
  const exitCode = await main(argv(), {
    now: () => new Date("2026-07-30T20:30:00.000Z"),
    loadEnvironment(workspaceRoot) {
      calls.push(["load-env", workspaceRoot]);
    },
    openDatabase(databasePath) {
      calls.push(["open", databasePath]);
      return database;
    },
    bindRepositories(handle) {
      assert.equal(handle, database);
      calls.push(["bind"]);
      return repos;
    },
    async runDrain(request, dependencies) {
      calls.push(["drain", request]);
      assert.equal(dependencies.db, database);
      assert.equal(dependencies.repos, repos);
      assert.equal(request.mode, "LOCAL_PROOF");
      assert.equal(request.generated_at, "2026-07-30T20:30:00.000Z");
      assert.equal(request.expected_plan_file_sha256, SHA);
      assert.equal(request.expected_plan_sha256, SHA);
      assert.equal(request.expected_runtime_profile_file_sha256, SHA);
      assert.equal(request.expected_checkout_commit, COMMIT);
      return {
        verdict: "GREEN",
        status: "EXACT_PLAN_DRAIN_COMPLETED",
        evidence: {
          json_path: "proof.json",
          markdown_path: "proof.md",
        },
      };
    },
    stdout(text) {
      output += text;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(
    calls.map((call) => call[0]),
    ["load-env", "open", "bind", "drain", "close"],
  );
  assert.match(output, /EXACT_PLAN_DRAIN_COMPLETED/);
});

test("main returns non-zero for HOLD and always closes the database", async () => {
  let closed = 0;
  const database = { close: () => (closed += 1) };
  const exitCode = await main(argv(), {
    loadEnvironment() {},
    openDatabase: () => database,
    bindRepositories: () => ({
      db: database,
      jobs: {},
      workers: {},
    }),
    runDrain: async () => ({
      verdict: "HOLD",
      status: "EXACT_PLAN_DRAIN_HELD",
      blockers: ["exact_plan_live_runtime_not_quiescent"],
    }),
    stdout() {},
  });
  assert.equal(exitCode, 1);
  assert.equal(closed, 1);
});

test("usage names the forbidden authority and the exact sequential scope", () => {
  const text = usage();
  assert.match(text, /LOCAL_PROOF/);
  assert.match(text, /PRIMARY then STANDBY/);
  assert.match(text, /No publish, OAuth, token, scheduler or watcher authority/);
});

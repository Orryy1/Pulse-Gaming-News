"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Database = require("better-sqlite3");

const {
  assertOpenedExactDatabaseIdentity,
} = require("../../lib/ops/governed-exact-production-plan-drain");

const {
  parseArgs,
  main,
  safeFailureBlocker,
  usage,
} = require("../../tools/governed-exact-production-plan-drain");

const SHA = "a".repeat(64);
const COMMIT = "b".repeat(40);
const DATABASE_BINDING = Object.freeze({
  path: "D:\\pulse-data\\pulse.db",
  real_path: "D:\\pulse-data\\pulse.db",
  size: 4096,
  identity: Object.freeze({
    device: "12345678901234567890",
    inode: "98765432109876543210",
    key: "12345678901234567890:98765432109876543210",
    link_count: "1",
  }),
});

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
  assert.throws(() => {
    const unsafe = argv();
    unsafe[1] = "LIVE_GUARDED";
    parseArgs(unsafe);
  }, /local_proof_only/);
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
    async inspectDatabaseFile(databasePath) {
      calls.push(["inspect-db", databasePath]);
      return DATABASE_BINDING;
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
      assert.equal(dependencies.databaseFileBinding, DATABASE_BINDING);
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
    ["load-env", "inspect-db", "open", "bind", "drain", "close"],
  );
  assert.match(output, /EXACT_PLAN_DRAIN_COMPLETED/);
});

test("main returns non-zero for HOLD and always closes the database", async () => {
  let closed = 0;
  const database = { close: () => (closed += 1) };
  const exitCode = await main(argv(), {
    loadEnvironment() {},
    inspectDatabaseFile: async () => DATABASE_BINDING,
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

test("main rejects a database file swapped after pre-open inspection", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-exact-drain-cli-swap-"),
  );
  const databasePath = path.join(root, "pulse.db");
  const replacementPath = path.join(root, "replacement.db");
  const displacedPath = path.join(root, "displaced.db");
  for (const [filePath, table] of [
    [databasePath, "original_probe"],
    [replacementPath, "replacement_probe"],
  ]) {
    const handle = new Database(filePath);
    handle.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY)`);
    handle.close();
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const args = argv();
  args[args.indexOf("--database") + 1] = databasePath;

  await assert.rejects(
    main(args, {
      loadEnvironment() {},
      openDatabase(requestedPath) {
        fs.renameSync(requestedPath, displacedPath);
        fs.renameSync(replacementPath, requestedPath);
        return new Database(requestedPath, { fileMustExist: true });
      },
      bindRepositories: (database) => ({
        db: database,
        jobs: {},
        workers: {},
      }),
      async runDrain(request, dependencies) {
        await assertOpenedExactDatabaseIdentity({
          db: dependencies.db,
          databasePath: request.database_path,
          preopenFile: dependencies.databaseFileBinding,
        });
        throw new Error("unreachable");
      },
      stdout() {},
    }),
    /exact_plan_open_database_identity_mismatch/,
  );
});

test("usage names the forbidden authority and the exact sequential scope", () => {
  const text = usage();
  assert.match(text, /LOCAL_PROOF/);
  assert.match(text, /PRIMARY then STANDBY/);
  assert.match(
    text,
    /No publish, OAuth, token, scheduler or watcher authority/,
  );
  assert.match(text, /bounds the work window/);
  assert.match(text, /until the active handler has truly exited/);
});

test("CLI failure reporting redacts unexpected exception text", () => {
  const secret = "sk_live_cli_secret_must_not_escape";
  const blocker = safeFailureBlocker(
    new Error(`provider failed with ${secret}`),
  );
  assert.match(blocker, /^exact_plan_unexpected_error:[a-f0-9]{64}$/);
  assert.equal(blocker.includes(secret), false);
});

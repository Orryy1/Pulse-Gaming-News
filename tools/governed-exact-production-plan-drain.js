#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  DRAIN_REQUEST_SCHEMA_VERSION,
  drainExactGovernedProductionPlan,
} = require(
  "../lib/ops/governed-exact-production-plan-drain"
);

const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_WORKER_ID = "pulse-exact-plan-sequential-drain";
const VALUE_FLAGS = new Set([
  "--mode",
  "--plan",
  "--plan-file-sha256",
  "--plan-sha256",
  "--workspace-root",
  "--database",
  "--runtime-profile",
  "--runtime-profile-file-sha256",
  "--expected-commit",
  "--out-dir",
  "--worker-id",
  "--timeout-ms",
  "--poll-interval-ms",
]);

function usage() {
  return [
    "Usage:",
    "  node tools/governed-exact-production-plan-drain.js \\",
    "    --mode LOCAL_PROOF \\",
    "    --plan <exact production-plan.json> \\",
    "    --plan-file-sha256 <64 hex> \\",
    "    --plan-sha256 <64 hex> \\",
    "    --workspace-root <exact clean checkout> \\",
    "    --database <exact SQLite database> \\",
    "    --runtime-profile <exact live-guarded profile> \\",
    "    --runtime-profile-file-sha256 <64 hex> \\",
    "    --expected-commit <40 hex> \\",
    "    --out-dir <evidence directory inside workspace>",
    "",
    "Runs one exact governed plan's PRIMARY then STANDBY production jobs",
    "through one lease-fenced JobsRunner. LOCAL_PROOF only.",
    "No publish, OAuth, token, scheduler or watcher authority.",
  ].join("\n");
}

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

function parseInteger(value, flag) {
  if (!/^\d+$/.test(String(value))) {
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
    if (!VALUE_FLAGS.has(flag)) {
      throw new Error(`unknown_argument:${flag}`);
    }
    const value = requiredValue(argv, index, flag);
    index += 1;
    if (Object.prototype.hasOwnProperty.call(parsed, flag)) {
      throw new Error(`duplicate_argument:${flag}`);
    }
    parsed[flag] = value;
  }
  const required = [
    "--mode",
    "--plan",
    "--plan-file-sha256",
    "--plan-sha256",
    "--workspace-root",
    "--database",
    "--runtime-profile",
    "--runtime-profile-file-sha256",
    "--expected-commit",
    "--out-dir",
  ];
  for (const flag of required) {
    if (!parsed[flag]) throw new Error(`required_argument_missing:${flag}`);
  }
  if (parsed["--mode"] !== "LOCAL_PROOF") {
    throw new Error("exact_plan_drain_local_proof_only");
  }
  return {
    help: false,
    mode: "LOCAL_PROOF",
    plan: path.resolve(parsed["--plan"]),
    planFileSha256: parsed["--plan-file-sha256"].toLowerCase(),
    planSha256: parsed["--plan-sha256"].toLowerCase(),
    workspaceRoot: path.resolve(parsed["--workspace-root"]),
    database: path.resolve(parsed["--database"]),
    runtimeProfile: path.resolve(parsed["--runtime-profile"]),
    runtimeProfileFileSha256:
      parsed["--runtime-profile-file-sha256"].toLowerCase(),
    expectedCommit: parsed["--expected-commit"].toLowerCase(),
    outDir: path.resolve(parsed["--out-dir"]),
    workerId: parsed["--worker-id"] || DEFAULT_WORKER_ID,
    timeoutMs: parsed["--timeout-ms"]
      ? parseInteger(parsed["--timeout-ms"], "--timeout-ms")
      : DEFAULT_TIMEOUT_MS,
    pollIntervalMs: parsed["--poll-interval-ms"]
      ? parseInteger(
          parsed["--poll-interval-ms"],
          "--poll-interval-ms",
        )
      : DEFAULT_POLL_INTERVAL_MS,
  };
}

function defaultOpenDatabase(databasePath) {
  const Database = require("better-sqlite3");
  const database = new Database(databasePath, {
    fileMustExist: true,
    timeout: 5000,
  });
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  return database;
}

function defaultLoadEnvironment(workspaceRoot) {
  require("dotenv").config({
    path: path.join(workspaceRoot, ".env"),
    override: false,
    quiet: true,
  });
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const stdout =
    dependencies.stdout || ((text) => process.stdout.write(text));
  const parsed = parseArgs(argv);
  if (parsed.help) {
    stdout(`${usage()}\n`);
    return 0;
  }
  const openDatabase =
    dependencies.openDatabase || defaultOpenDatabase;
  const loadEnvironment =
    dependencies.loadEnvironment || defaultLoadEnvironment;
  const bindRepositories =
    dependencies.bindRepositories ||
    require("../lib/repositories").bindRepositories;
  const runDrain =
    dependencies.runDrain || drainExactGovernedProductionPlan;
  const now = dependencies.now || (() => new Date());
  let database = null;
  try {
    loadEnvironment(parsed.workspaceRoot);
    database = openDatabase(parsed.database);
    const repos = bindRepositories(database);
    const result = await runDrain(
      {
        schema_version: DRAIN_REQUEST_SCHEMA_VERSION,
        mode: "LOCAL_PROOF",
        generated_at: now().toISOString(),
        plan_path: parsed.plan,
        expected_plan_file_sha256: parsed.planFileSha256,
        expected_plan_sha256: parsed.planSha256,
        workspace_root: parsed.workspaceRoot,
        database_path: parsed.database,
        runtime_profile_path: parsed.runtimeProfile,
        expected_runtime_profile_file_sha256:
          parsed.runtimeProfileFileSha256,
        expected_checkout_commit: parsed.expectedCommit,
        output_dir: parsed.outDir,
        worker_id: parsed.workerId,
        timeout_ms: parsed.timeoutMs,
        poll_interval_ms: parsed.pollIntervalMs,
      },
      { db: database, repos },
    );
    stdout(`${JSON.stringify(result, null, 2)}\n`);
    return result.verdict === "GREEN" ? 0 : 1;
  } finally {
    database?.close?.();
  }
}

if (require.main === module) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify(
          {
            verdict: "HOLD",
            blocker: String(
              error?.code || error?.message || "exact_plan_drain_failed",
            )
              .replace(/[^a-zA-Z0-9_:.-]/g, "_")
              .slice(0, 240),
          },
          null,
          2,
        )}\n`,
      );
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  defaultLoadEnvironment,
  main,
  parseArgs,
  usage,
};

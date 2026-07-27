#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  WORKER_CONTAINMENT_CONFIRMATION,
  executeGovernedWorkerContainment,
} = require("../lib/ops/governed-worker-containment");

const VALUE_FLAGS = new Map([
  ["--database", "databasePath"],
  ["--confirm-database-path", "confirmDatabasePath"],
  ["--backup-evidence", "backupEvidencePath"],
  ["--actor-id", "actorId"],
  ["--confirm-actor-id", "confirmActorId"],
  ["--reason", "reason"],
  ["--confirm-reason", "confirmReason"],
  ["--change-window-id", "changeWindowId"],
  ["--confirm-change-window-id", "confirmChangeWindowId"],
  ["--confirm-worker-containment", "confirmWorkerContainment"],
  ["--generated-at", "generatedAt"],
  ["--out-dir", "outDir"],
]);

const BOOLEAN_FLAGS = new Map([
  ["--apply", "apply"],
  ["--inspect", "inspect"],
  ["--confirm-scheduler-stopped", "confirmSchedulerStopped"],
  ["--confirm-workers-stopped", "confirmWorkersStopped"],
  ["--help", "help"],
]);

function usage() {
  return [
    "Governed Pulse Gaming worker containment",
    "",
    "Usage:",
    "  node tools/governed-worker-containment.js --database <absolute-db> [options]",
    "",
    "Inspect is the default. It opens SQLite read-only, reports active worker",
    "rows, leases and claimed/running jobs, and performs no mutation.",
    "",
    "A transactional apply additionally requires:",
    "  --apply",
    "  --confirm-database-path <same-absolute-db>",
    "  --backup-evidence <pulse-cutover-backup-evidence-v1.json>",
    "  --actor-id <id> --confirm-actor-id <same-id>",
    "  --reason <text> --confirm-reason <same-text>",
    "  --change-window-id <id> --confirm-change-window-id <same-id>",
    "  --confirm-scheduler-stopped --confirm-workers-stopped",
    "  --confirm-worker-containment <exact-phrase>",
    "",
    `Exact phrase: ${WORKER_CONTAINMENT_CONFIRMATION}`,
    "",
    "The runtime must independently declare HUMAN_REVIEW, AUTO_PUBLISH=false,",
    "both kill switches true, both cutover stop flags true and SQLITE_DB_PATH",
    "equal to --database. Apply refuses active leases or claimed/running jobs.",
    "",
    "This tool never starts a scheduler or worker, changes jobs or leases,",
    "loads platform/OAuth code, makes a network request or creates a post.",
  ].join("\n");
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const args = {};
  const errors = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (BOOLEAN_FLAGS.has(token)) {
      args[BOOLEAN_FLAGS.get(token)] = true;
      continue;
    }
    if (VALUE_FLAGS.has(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        errors.push(`missing_value:${token}`);
      } else {
        args[VALUE_FLAGS.get(token)] = value;
        index += 1;
      }
      continue;
    }
    if (token.startsWith("-")) {
      errors.push(`unknown_flag:${token}`);
    } else {
      errors.push(`unexpected_argument:${token}`);
    }
  }
  if (args.apply && args.inspect) {
    errors.push("apply_and_inspect_are_mutually_exclusive");
  }
  if (errors.length) {
    const error = new Error(
      "governed_worker_containment_cli_arguments_invalid",
    );
    error.codes = errors;
    throw error;
  }
  return args;
}

function renderMarkdown(result) {
  const targetCount =
    result.inspection?.target_worker_ids?.length ?? "unknown";
  const blockers = result.blockers?.length
    ? result.blockers.map((blocker) => `- ${blocker}`).join("\n")
    : "- None";
  return [
    "# Governed worker containment",
    "",
    `- Generated: ${result.generated_at}`,
    `- Mode: ${result.mode}`,
    `- Verdict: ${result.verdict}`,
    `- Database: ${result.database_path || "not resolved"}`,
    `- Mutated: ${result.mutated ? "yes" : "no"}`,
    `- Idempotent replay: ${result.idempotent ? "yes" : "no"}`,
    `- Target workers: ${targetCount}`,
    `- Active runtime leases: ${
      result.inspection?.active_runtime_lease_count ?? "unknown"
    }`,
    `- Claimed/running jobs: ${
      result.inspection?.claimed_or_running_job_count ?? "unknown"
    }`,
    "- External calls: none",
    "- OAuth or token changes: none",
    "- Platform objects created: none",
    "- Jobs or runtime leases changed: no",
    "",
    "## Blockers",
    "",
    blockers,
    "",
  ].join("\n");
}

function safeSegment(value) {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .slice(0, 100);
}

function writeArtifacts(result, outDir) {
  const resolvedOutDir = path.resolve(
    outDir ||
      path.join("output", "governed-worker-containment"),
  );
  fs.mkdirSync(resolvedOutDir, { recursive: true });
  const stamp = safeSegment(
    String(result.generated_at || "").replace(/:/g, "-"),
  );
  const stem = `worker-containment-${stamp}`;
  const jsonPath = path.join(resolvedOutDir, `${stem}.json`);
  const markdownPath = path.join(resolvedOutDir, `${stem}.md`);
  fs.writeFileSync(
    jsonPath,
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(markdownPath, renderMarkdown(result), "utf8");
  return { json: jsonPath, markdown: markdownPath };
}

async function run(
  argv = process.argv.slice(2),
  env = process.env,
  dependencies = {},
) {
  const args = parseCliArgs(argv);
  if (args.help) {
    return { help: true, text: usage(), exitCode: 0 };
  }
  const execute =
    dependencies.execute || executeGovernedWorkerContainment;
  const result = await execute({
    ...args,
    apply: args.apply === true,
    env,
  });
  const artifacts = writeArtifacts(result, args.outDir);
  return {
    result: { ...result, artifacts },
    exitCode: result.verdict === "HOLD" ? 2 : 0,
  };
}

async function main() {
  try {
    const outcome = await run();
    if (outcome.help) {
      process.stdout.write(`${outcome.text}\n`);
    } else {
      process.stdout.write(
        `${JSON.stringify(outcome.result, null, 2)}\n`,
      );
    }
    process.exitCode = outcome.exitCode;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(
        {
          schema_version:
            "pulse-governed-worker-containment-cli-error-v1",
          verdict: "ERROR",
          errors: Array.isArray(error.codes)
            ? error.codes
            : [String(error?.message || "worker_containment_failed")],
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  BOOLEAN_FLAGS,
  VALUE_FLAGS,
  parseCliArgs,
  renderMarkdown,
  run,
  usage,
  writeArtifacts,
};

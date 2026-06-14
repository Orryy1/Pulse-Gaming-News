#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ quiet: true });

const {
  buildRuntimeOwnershipSentinelFromEnvironment,
  formatRuntimeOwnershipSentinelMarkdown,
} = require("../lib/ops/runtime-ownership-sentinel");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "runtime-ownership");
const GOAL_CONTRACT_OUT = path.join(ROOT, "output", "goal-contract");

async function readOptionalJson(filePath) {
  try {
    if (!await fs.pathExists(filePath)) return null;
    return fs.readJson(filePath);
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = { json: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    "Usage: node tools/runtime-ownership-sentinel.js [--json]\n" +
      "Read-only runtime ownership, PID, tunnel and scheduler guard.\n",
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const report = await buildRuntimeOwnershipSentinelFromEnvironment({
    cwd: ROOT,
    env: process.env,
    schedulerProof: {
      dryRunPlan: await readOptionalJson(path.join(GOAL_CONTRACT_OUT, "dry_run_publish_plan.json")),
      guardedDispatchPlan: await readOptionalJson(path.join(GOAL_CONTRACT_OUT, "guarded_dispatch_plan.json")),
      executorPlan: await readOptionalJson(path.join(GOAL_CONTRACT_OUT, "guarded_dispatch_executor_plan.json")),
    },
  });
  const markdown = formatRuntimeOwnershipSentinelMarkdown(report);

  await fs.ensureDir(OUT);
  await fs.writeJson(path.join(OUT, "runtime_ownership_status.json"), report, {
    spaces: 2,
  });
  await fs.writeFile(
    path.join(OUT, "runtime_ownership_status.md"),
    markdown,
    "utf8",
  );
  await fs.writeJson(
    path.join(OUT, "scheduler_window_readiness.json"),
    report.scheduler_window_readiness || {},
    { spaces: 2 },
  );

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${markdown}\n`);
    process.stderr.write(
      `[runtime-ownership-sentinel] json=${path.join(OUT, "runtime_ownership_status.json")}\n`,
    );
    process.stderr.write(
      `[runtime-ownership-sentinel] scheduler=${path.join(OUT, "scheduler_window_readiness.json")}\n`,
    );
  }

  if (report.verdict === "red") process.exitCode = 2;
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[runtime-ownership-sentinel] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs };

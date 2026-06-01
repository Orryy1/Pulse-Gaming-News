#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ quiet: true });

const {
  applyWindowsSchedulerHiddenLauncherRepair,
  buildElevatedRepairPacket,
  buildWindowsSchedulerHiddenLauncherRepairPlan,
  formatWindowsSchedulerHiddenLauncherRepairMarkdown,
} = require("../lib/ops/windows-scheduler-hidden-launcher-repair");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv = process.argv) {
  const args = {
    json: false,
    help: false,
    apply: false,
    operatorConfirmed: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--operator-confirmed") args.operatorConfirmed = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    "Usage: node tools/windows-scheduler-hidden-launcher-repair.js [--json] [--apply --operator-confirmed]\n" +
      "  --json                Print JSON instead of markdown\n" +
      "  --apply               Repair visible-console Pulse/Orryy scheduled tasks\n" +
      "  --operator-confirmed  Required with --apply; backs up each task first\n",
  );
}

function validateApplyArgs(args) {
  if (!args.apply) return;
  if (args.operatorConfirmed !== true) {
    throw new Error("windows_scheduler_repair_apply_requires_operator_confirmed_flag");
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  validateApplyArgs(args);

  const plan = buildWindowsSchedulerHiddenLauncherRepairPlan({
    cwd: ROOT,
    outDir: OUT,
  });
  const elevatedPacket = buildElevatedRepairPacket(plan, {
    cwd: ROOT,
    outDir: OUT,
  });
  if (elevatedPacket.work_order_count > 0) {
    const { script, ...packetSummary } = elevatedPacket;
    plan.elevated_repair_packet = packetSummary;
    await fs.ensureDir(path.dirname(elevatedPacket.script_path));
    await fs.writeFile(elevatedPacket.script_path, script, "utf8");
  }
  if (args.apply) {
    plan.mode = "apply_os_task_scheduler_mutation";
    plan.apply_result = applyWindowsSchedulerHiddenLauncherRepair({
      plan,
      operatorConfirmed: args.operatorConfirmed,
    });
    plan.verdict =
      plan.apply_result.counts.blocked > 0
        ? "red"
        : plan.apply_result.counts.applied > 0
          ? "amber"
          : plan.verdict;
  }

  const markdown = formatWindowsSchedulerHiddenLauncherRepairMarkdown(plan);
  await fs.ensureDir(OUT);
  await fs.writeJson(
    path.join(OUT, "windows_scheduler_hidden_launcher_repair.json"),
    plan,
    { spaces: 2 },
  );
  await fs.writeFile(
    path.join(OUT, "windows_scheduler_hidden_launcher_repair.md"),
    markdown,
    "utf8",
  );

  if (args.json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else {
    process.stdout.write(`${markdown}\n`);
  }

  if (plan.verdict === "red") process.exitCode = 2;
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[windows-scheduler-repair] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  validateApplyArgs,
};

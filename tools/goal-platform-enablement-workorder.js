#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildGoalPlatformEnablementWorkOrder,
  renderGoalPlatformEnablementWorkOrderMarkdown,
  writeGoalPlatformEnablementWorkOrder,
} = require("../lib/goal-platform-enablement-workorder");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    dryRunPlanPath: null,
    platformDoctorPath: null,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--dry-run-plan") args.dryRunPlanPath = argv[++i] || "";
    else if (arg === "--platform-doctor") args.platformDoctorPath = argv[++i] || "";
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-platform-enablement -- [options]",
    "",
    "Options:",
    "  --root <dir>              Workspace root",
    "  --dry-run-plan <path>     Strict dry-run publish plan",
    "  --platform-doctor <path>  Read-only platform doctor report",
    "  --out-dir <dir>           Output directory",
    "  --generated-at <iso>      Fixed timestamp",
    "  --json                    Print JSON",
    "",
    "Builds a read-only platform enablement work order. It does not publish, mutate tokens or touch OAuth.",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }

  const root = path.resolve(args.root);
  const dryRunPlanPath = args.dryRunPlanPath
    ? path.resolve(root, args.dryRunPlanPath)
    : path.join(root, "output", "goal-contract", "dry_run_publish_plan.json");
  const platformDoctorPath = args.platformDoctorPath
    ? path.resolve(root, args.platformDoctorPath)
    : path.join(root, "test", "output", "platform_readiness_doctor.json");

  const dryRunPlan = await fs.readJson(dryRunPlanPath);
  const platformDoctor = await readJsonIfPresent(platformDoctorPath, {});
  const report = buildGoalPlatformEnablementWorkOrder({
    dryRunPlan,
    platformDoctor,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });

  const artefacts = await writeGoalPlatformEnablementWorkOrder(report, {
    outputDir: path.resolve(root, args.outDir),
  });

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoalPlatformEnablementWorkOrderMarkdown(report).trimEnd());
  return { report, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-platform-enablement-workorder] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};

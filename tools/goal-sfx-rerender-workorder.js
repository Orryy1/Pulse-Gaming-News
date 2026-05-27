#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildGoalSfxRerenderWorkOrder,
  renderGoalSfxRerenderWorkOrderMarkdown,
  writeGoalSfxRerenderWorkOrder,
} = require("../lib/goal-sfx-rerender-workorder");

const ROOT = path.resolve(__dirname, "..");

function loadDotenvForCli() {
  try {
    if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
      require("dotenv").config({ override: true });
    }
  } catch {}
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: ROOT,
    bridgeCandidatesPath: path.join(ROOT, "output", "goal-contract", "scheduler_bridge_candidates.json"),
    dryRunPlanPath: path.join(ROOT, "output", "goal-contract", "dry_run_publish_plan.json"),
    outDir: path.join(ROOT, "output", "goal-contract"),
    generatedAt: null,
    includeAllBridgeCandidates: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--bridge-candidates") args.bridgeCandidatesPath = argv[++i] || args.bridgeCandidatesPath;
    else if (arg === "--dry-run-plan") args.dryRunPlanPath = argv[++i] || args.dryRunPlanPath;
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--include-all-bridge-candidates") args.includeAllBridgeCandidates = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-sfx-rerender-workorder -- [options]",
    "",
    "Options:",
    "  --bridge-candidates <path>          Scheduler bridge candidates JSON",
    "  --dry-run-plan <path>               Strict dry-run plan JSON",
    "  --include-all-bridge-candidates     Consider skipped bridge candidates as local rerender targets too",
    "  --out-dir <dir>                     Output directory for the work order",
    "  --generated-at <iso>                Fixed timestamp for deterministic reports",
    "  --json                              Print JSON work order",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

async function main(argv = process.argv.slice(2)) {
  loadDotenvForCli();
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const root = path.resolve(args.root);
  const bridgeCandidates = await readJsonIfPresent(path.resolve(args.bridgeCandidatesPath), []);
  const dryRunPlan = await readJsonIfPresent(path.resolve(args.dryRunPlanPath), null);
  const workOrder = await buildGoalSfxRerenderWorkOrder({
    bridgeCandidates,
    dryRunPlan,
    workspaceRoot: root,
    generatedAt: args.generatedAt || new Date().toISOString(),
    includeAllBridgeCandidates: args.includeAllBridgeCandidates,
  });
  const written = await writeGoalSfxRerenderWorkOrder(workOrder, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(workOrder, null, 2));
  else console.log(renderGoalSfxRerenderWorkOrderMarkdown(workOrder).trimEnd());
  return { args, workOrder, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal-sfx-rerender-workorder] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  loadDotenvForCli,
  main,
  parseArgs,
  usage,
};

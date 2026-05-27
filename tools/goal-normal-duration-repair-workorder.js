#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildNormalDurationRepairWorkOrder,
  renderNormalDurationRepairWorkOrderMarkdown,
  writeNormalDurationRepairWorkOrder,
} = require("../lib/goal-normal-duration-repair-workorder");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    dryRunPlanPath: path.join(ROOT, "output", "goal-contract", "dry_run_publish_plan.json"),
    cutoverPlanPath: path.join(ROOT, "output", "goal-contract", "production_render_cutover_plan.json"),
    outDir: path.join(ROOT, "output", "goal-contract"),
    generatedAt: new Date().toISOString(),
    minSeconds: 35,
    maxSeconds: 59,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run-plan") args.dryRunPlanPath = argv[++index] || args.dryRunPlanPath;
    else if (arg === "--cutover-plan") args.cutoverPlanPath = argv[++index] || args.cutoverPlanPath;
    else if (arg === "--out-dir" || arg === "--output-dir") args.outDir = argv[++index] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || args.generatedAt;
    else if (arg === "--min-seconds") args.minSeconds = Number(argv[++index] || args.minSeconds);
    else if (arg === "--max-seconds") args.maxSeconds = Number(argv[++index] || args.maxSeconds);
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/goal-normal-duration-repair-workorder.js [options]",
    "",
    "Builds a local repair work order for stories blocked by the normal production duration floor.",
    "No publishing, database mutation, OAuth or token changes are performed.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true, args };
  }
  const dryRunPlan = await fs.readJson(path.resolve(args.dryRunPlanPath));
  const cutoverPlanPath = path.resolve(args.cutoverPlanPath);
  const cutoverPlan = await fs.pathExists(cutoverPlanPath)
    ? await fs.readJson(cutoverPlanPath)
    : {};
  const workOrder = await buildNormalDurationRepairWorkOrder({
    dryRunPlan,
    cutoverPlan,
    generatedAt: args.generatedAt,
    targetDurationSeconds: { min: args.minSeconds, max: args.maxSeconds },
  });
  const written = await writeNormalDurationRepairWorkOrder(workOrder, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(workOrder, null, 2));
  else console.log(renderNormalDurationRepairWorkOrderMarkdown(workOrder).trimEnd());
  return { args, workOrder, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal-normal-duration-repair-workorder] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

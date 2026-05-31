#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildAutoRepairRunPlan,
  executeAutoRepairRunPlan,
  renderAutoRepairRunMarkdown,
} = require("../lib/ops/auto-repair-runner");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    planPath: path.join("output", "goal-contract", "auto_repair_plan.json"),
    outDir: path.join("output", "goal-contract", "auto-repair-runner"),
    lane: "",
    storyIds: [],
    limit: 0,
    generatedAt: null,
    execute: false,
    localMediaApply: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--plan" || arg === "--auto-repair-plan") args.planPath = argv[++i] || args.planPath;
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--lane") args.lane = argv[++i] || "";
    else if (arg === "--story-id" || arg === "--story") args.storyIds.push(argv[++i] || "");
    else if (arg === "--story-ids" || arg === "--stories") {
      args.storyIds.push(...String(argv[++i] || "").split(","));
    }
    else if (arg === "--limit") args.limit = Number(argv[++i] || 0);
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--execute") args.execute = true;
    else if (arg === "--dry-run") args.execute = false;
    else if (arg === "--apply-local-media") args.localMediaApply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  args.storyIds = args.storyIds.map((value) => String(value || "").trim()).filter(Boolean);
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:auto-repair-runner -- [options]",
    "",
    "Builds and optionally executes a guarded local repair batch from output/goal-contract/auto_repair_plan.json.",
    "Dry-run is the default. Execute mode refuses shell chaining, publish/upload commands, OAuth/token work and DB apply flags.",
    "Use --apply-local-media only for controlled local media repairs that write backups and do not touch the DB.",
    "",
    "Options:",
    "  --plan <path>          Auto repair plan JSON",
    "  --out-dir <dir>        Output directory",
    "  --lane <lane>          Run one repair lane",
    "  --story-id <id>        Run one story; repeatable",
    "  --story-ids <ids>      Comma-separated story ids",
    "  --limit <n>            Limit selected items",
    "  --execute              Execute safe local commands",
    "  --dry-run              Plan only; default",
    "  --apply-local-media    Allow local media writes for voice mastering repairs only",
    "  --json                 Print JSON result",
  ].join("\n");
}

async function writeReports({ outDir, runPlan, executionReport }) {
  const dir = path.resolve(ROOT, outDir);
  await fs.ensureDir(dir);
  const runPlanPath = path.join(dir, "auto_repair_run_plan.json");
  const resultPath = path.join(dir, "auto_repair_run_results.json");
  const markdownPath = path.join(dir, "auto_repair_run_plan.md");
  await fs.writeJson(runPlanPath, runPlan, { spaces: 2 });
  await fs.writeJson(resultPath, executionReport, { spaces: 2 });
  await fs.writeFile(markdownPath, renderAutoRepairRunMarkdown(runPlan, executionReport), "utf8");
  return { runPlanPath, resultPath, markdownPath };
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  const stdout = deps.stdout || process.stdout;
  if (args.help) {
    stdout.write(`${usage()}\n`);
    return { help: true, args };
  }
  const planPath = path.resolve(ROOT, args.planPath);
  const autoRepairPlan = deps.autoRepairPlan || (await fs.readJson(planPath));
  const generatedAt = args.generatedAt || new Date().toISOString();
  const runPlan = buildAutoRepairRunPlan(autoRepairPlan, {
    lane: args.lane,
    storyIds: args.storyIds,
    limit: args.limit,
    generatedAt,
    localMediaApply: args.localMediaApply,
  });
  const executionReport = await executeAutoRepairRunPlan(runPlan, {
    execute: args.execute,
    runCommand: deps.runCommand,
    generatedAt: new Date().toISOString(),
  });
  const written = await writeReports({
    outDir: args.outDir,
    runPlan,
    executionReport,
  });
  const payload = { run_plan: runPlan, execution_report: executionReport, written };
  if (args.json) stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else stdout.write(renderAutoRepairRunMarkdown(runPlan, executionReport));
  return { args, ...payload };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[auto-repair-runner] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
  writeReports,
};

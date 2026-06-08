#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true, quiet: true });
}

const {
  runGuardedLiveDispatchExecutor,
  renderGuardedLiveDispatchExecutorMarkdown,
  writeGuardedLiveDispatchExecutorReport,
} = require("../lib/goal-guarded-live-dispatch-executor");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    executorPlanPath: null,
    storiesPath: null,
    actionIds: [],
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    apply: false,
    maxActions: null,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--executor-plan") args.executorPlanPath = argv[++i] || "";
    else if (arg === "--stories") args.storiesPath = argv[++i] || "";
    else if (arg === "--action-id") args.actionIds.push(argv[++i] || "");
    else if (arg === "--action-ids") args.actionIds.push(...String(argv[++i] || "").split(","));
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--max-actions") args.maxActions = Number(argv[++i] || "");
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  args.actionIds = args.actionIds.map((item) => String(item || "").trim()).filter(Boolean);
  if (args.maxActions !== null && (!Number.isFinite(args.maxActions) || args.maxActions < 1)) {
    throw new Error("--max-actions must be a positive number");
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-guarded-live-dispatch -- [options]",
    "",
    "Options:",
    "  --root <dir>                 Workspace root",
    "  --executor-plan <path>       guarded_dispatch_executor_plan.json",
    "  --stories <path>             Story JSON fixture for dry-run/testing",
    "  --action-id <story:platform> Explicit action to dispatch; repeatable",
    "  --action-ids <csv>           Explicit action IDs as comma-separated values",
    "  --out-dir <dir>              Output directory",
    "  --generated-at <iso>         Fixed timestamp",
    "  --max-actions <n>            Max selected actions when --apply is used; default 1",
    "  --apply                      Perform live upload + DB persistence for selected actions",
    "  --json                       Print JSON",
    "",
    "Dry-run is the default. Live apply also requires:",
    "  PULSE_GUARDED_LIVE_DISPATCH_ENABLED=true",
    "  PULSE_EMERGENCY_KILL_SWITCH=clear",
    "",
    "This executor supports youtube_shorts, instagram_reels, facebook_reels, instagram_story and facebook_story handoff actions.",
  ].join("\n");
}

async function readJson(filePath, label) {
  if (!await fs.pathExists(filePath)) throw new Error(`${label} not found: ${filePath}`);
  return fs.readJson(filePath);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }

  const root = path.resolve(args.root);
  const executorPlanPath = args.executorPlanPath
    ? path.resolve(root, args.executorPlanPath)
    : path.join(root, "output", "goal-contract", "guarded_dispatch_executor_plan.json");
  const stories = args.storiesPath
    ? await readJson(path.resolve(root, args.storiesPath), "stories")
    : null;

  const runOptions = {
    executorPlan: await readJson(executorPlanPath, "guarded dispatch executor plan"),
    stories,
    actionIds: args.actionIds,
    apply: args.apply,
    env: process.env,
    generatedAt: args.generatedAt || new Date().toISOString(),
  };
  if (args.maxActions !== null) runOptions.maxActions = args.maxActions;

  const originalLog = console.log;
  if (args.json) {
    console.log = (...items) => {
      process.stderr.write(`${items.map((item) => String(item)).join(" ")}\n`);
    };
  }

  let report;
  let artefacts;
  try {
    report = await runGuardedLiveDispatchExecutor(runOptions);
    artefacts = await writeGuardedLiveDispatchExecutorReport(report, {
      outputDir: path.resolve(root, args.outDir),
    });
  } finally {
    if (args.json) console.log = originalLog;
  }

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGuardedLiveDispatchExecutorMarkdown(report).trimEnd());
  return { report, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-guarded-live-dispatch-executor] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};

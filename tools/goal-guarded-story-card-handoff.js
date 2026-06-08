#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true, quiet: true });
}

const {
  buildGuardedStoryCardHandoff,
  renderGuardedStoryCardHandoffMarkdown,
  writeGuardedStoryCardHandoff,
} = require("../lib/goal-guarded-story-card-handoff");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    executorPlanPath: null,
    storiesPath: null,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    materializeCards: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--executor-plan") args.executorPlanPath = argv[++i] || "";
    else if (arg === "--stories") args.storiesPath = argv[++i] || "";
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--materialize-cards") args.materializeCards = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-guarded-story-card-handoff -- [options]",
    "",
    "Options:",
    "  --root <dir>                Workspace root",
    "  --executor-plan <path>      guarded_dispatch_executor_plan.json",
    "  --stories <path>            Optional story JSON fixture",
    "  --out-dir <dir>             Output directory",
    "  --generated-at <iso>        Fixed timestamp",
    "  --materialize-cards         Generate missing output/stories/*_story.png cards locally",
    "  --json                      Print JSON",
    "",
    "Appends Instagram/Facebook Story image actions derived from the guarded video handoff.",
    "This command never publishes, mutates DB rows or touches OAuth/token settings.",
  ].join("\n");
}

async function readJson(filePath, label) {
  if (!await fs.pathExists(filePath)) throw new Error(`${label} not found: ${filePath}`);
  return fs.readJson(filePath);
}

async function loadStories(storiesPath) {
  if (storiesPath) return readJson(storiesPath, "stories");
  const db = require("../lib/db");
  return db.getStories();
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
  const storiesPath = args.storiesPath ? path.resolve(root, args.storiesPath) : null;

  const report = await buildGuardedStoryCardHandoff({
    root,
    executorPlan: await readJson(executorPlanPath, "guarded dispatch executor plan"),
    stories: await loadStories(storiesPath),
    materializeCards: args.materializeCards,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const artefacts = await writeGuardedStoryCardHandoff(report, {
    outputDir: path.resolve(root, args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGuardedStoryCardHandoffMarkdown(report).trimEnd());
  return { report, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-guarded-story-card-handoff] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};

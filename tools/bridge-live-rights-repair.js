#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  applyBridgeLiveRightsRepairPlan,
  buildBridgeLiveRightsRepairPlan,
  renderBridgeLiveRightsRepairMarkdown,
  writeBridgeLiveRightsRepairReport,
} = require("../lib/bridge-live-rights-repair");

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
    outDir: path.join(ROOT, "output", "goal-contract"),
    generatedAt: new Date().toISOString(),
    storyId: "",
    limit: 0,
    apply: false,
    operatorConfirmed: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out-dir" || arg === "--output-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || args.generatedAt;
    else if (arg === "--story-id") args.storyId = argv[++i] || "";
    else if (arg === "--limit") args.limit = Number(argv[++i] || 0);
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--operator-confirmed") args.operatorConfirmed = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:bridge-live-rights-repair -- [options]",
    "",
    "Repairs promoted Visual V4 bridge live rows so governance sees only the final V4 asset set and explicit rights records.",
    "Dry-run by default. Applying mutates the configured SQLite DB only after --apply --operator-confirmed.",
    "",
    "Options:",
    "  --out-dir <dir>          Output directory for reports",
    "  --generated-at <iso>     Fixed timestamp for deterministic reports",
    "  --story-id <id>          Repair one story id",
    "  --limit <n>              Inspect at most n candidates; 0 means all",
    "  --apply                  Apply eligible repairs to SQLite",
    "  --operator-confirmed     Required with --apply",
    "  --json                   Print JSON report",
  ].join("\n");
}

async function main(argv = process.argv.slice(2), deps = {}) {
  loadDotenvForCli();
  const args = parseArgs(argv);
  const stdout = deps.stdout || process.stdout;
  if (args.help) {
    stdout.write(`${usage()}\n`);
    return { help: true, args };
  }
  const db = deps.db || require("../lib/db");
  const stories = deps.stories || (await db.getStories());
  const plan = buildBridgeLiveRightsRepairPlan({
    stories,
    generatedAt: args.generatedAt,
    storyId: args.storyId,
    limit: args.limit > 0 ? args.limit : Infinity,
  });
  let applyResult = null;
  if (args.apply) {
    applyResult = await applyBridgeLiveRightsRepairPlan(plan, {
      db,
      operatorConfirmed: args.operatorConfirmed,
    });
    plan.summary.applied_count = applyResult.applied_count;
  }
  const written = await writeBridgeLiveRightsRepairReport(plan, {
    outputDir: path.resolve(args.outDir),
    applyResult,
  });
  if (args.json) stdout.write(`${JSON.stringify({ ...plan, apply_result: applyResult }, null, 2)}\n`);
  else stdout.write(renderBridgeLiveRightsRepairMarkdown(plan, applyResult));
  return { args, plan, applyResult, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[bridge-live-rights-repair] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  loadDotenvForCli,
  main,
  parseArgs,
  usage,
};

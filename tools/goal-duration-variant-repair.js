#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  materializeDurationVariantRepairs,
  renderDurationVariantRepairMarkdown,
  writeDurationVariantRepairReport,
} = require("../lib/goal-duration-variant-repair");
const {
  configureGoalTtsBatchEnv,
} = require("./goal-audio-timestamp-materializer");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    workOrderPath: path.join(ROOT, "output", "goal-contract", "duration_variant_rerender_work_order.json"),
    outDir: path.join(ROOT, "output", "goal-contract"),
    workspaceRoot: ROOT,
    generatedAt: null,
    limit: 0,
    provider: "auto",
    alignmentMode: "whisper",
    storyIds: [],
    inspectOnly: false,
    normalProduction: false,
    workOrderExplicit: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--work-order") {
      args.workOrderPath = argv[++i] || args.workOrderPath;
      args.workOrderExplicit = true;
    }
    else if (arg === "--normal-production") {
      args.normalProduction = true;
      if (!args.workOrderExplicit) {
        args.workOrderPath = path.join(ROOT, "output", "goal-contract", "normal_duration_repair_work_order.json");
      }
    }
    else if (arg === "--out-dir" || arg === "--output-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--workspace") args.workspaceRoot = argv[++i] || args.workspaceRoot;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--limit") args.limit = Number(argv[++i] || 0);
    else if (arg === "--provider") args.provider = argv[++i] || args.provider;
    else if (arg === "--alignment") args.alignmentMode = argv[++i] || args.alignmentMode;
    else if (arg === "--story-id") {
      const storyId = argv[++i];
      if (storyId) args.storyIds.push(storyId);
    }
    else if (arg === "--inspect-only") args.inspectOnly = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-duration-variant-repair -- [options]",
    "",
    "Repairs sub-target Visual V4 duration variants by extending source-safe public scripts, regenerating local audio and rerendering V4.",
    "No publishing, database mutation, OAuth or token changes are performed.",
    "",
    "Options:",
    "  --work-order <path>    Duration variant rerender work order JSON",
    "  --out-dir <dir>        Output directory for reports",
    "  --workspace <dir>      Workspace root",
    "  --generated-at <iso>   Fixed timestamp for deterministic reports",
    "  --limit <n>            Repair at most n stories; 0 means all candidates",
    "  --story-id <id>        Repair only this story; repeatable",
    "  --provider <auto|local|elevenlabs>  Narration provider preference for regenerated audio",
    "  --alignment <whisper|silence|auto|off>  Word timestamp alignment mode; default whisper for CLI repairs",
    "  --normal-production    Use the 35-59s normal production repair work order",
    "  --inspect-only         Do not regenerate audio or render; write a pending report",
    "  --json                 Print JSON report",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true, args };
  }
  configureGoalTtsBatchEnv(process.env, { provider: args.provider });
  const workOrder = await fs.readJson(path.resolve(args.workOrderPath));
  const report = await materializeDurationVariantRepairs({
    workOrder,
    workspaceRoot: path.resolve(args.workspaceRoot),
    generatedAt: args.generatedAt || new Date().toISOString(),
    limit: args.limit,
    storyIds: args.storyIds,
    provider: args.provider,
    alignmentMode: args.alignmentMode,
    inspectOnly: args.inspectOnly,
  });
  const written = await writeDurationVariantRepairReport(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderDurationVariantRepairMarkdown(report).trimEnd());
  return { args, report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal-duration-variant-repair] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

try {
  require("dotenv").config({ override: true, quiet: true });
} catch {}

const {
  repairGoalStorefrontVisuals,
  renderGoalStorefrontVisualRepairMarkdown,
  writeGoalStorefrontVisualRepairReport,
} = require("../lib/goal-storefront-visual-repair");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    workOrderPath: path.join(ROOT, "output", "goal-contract", "render_input_work_order.json"),
    outDir: path.join(ROOT, "output", "goal-contract"),
    root: ROOT,
    generatedAt: null,
    limit: 0,
    minAssets: 5,
    maxDownloadsPerStory: 6,
    maxStoreAssetsPerEntity: 8,
    maxGameplayStillsPerEntity: 6,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--work-order") args.workOrderPath = argv[++i] || args.workOrderPath;
    else if (arg === "--out-dir" || arg === "--output-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--limit") args.limit = Number(argv[++i] || 0);
    else if (arg === "--min-assets") args.minAssets = Number(argv[++i] || args.minAssets);
    else if (arg === "--max-downloads-per-story") {
      args.maxDownloadsPerStory = Number(argv[++i] || args.maxDownloadsPerStory);
    } else if (arg === "--max-store-assets-per-entity") {
      args.maxStoreAssetsPerEntity = Number(argv[++i] || args.maxStoreAssetsPerEntity);
    } else if (arg === "--max-gameplay-stills-per-entity") {
      args.maxGameplayStillsPerEntity = Number(argv[++i] || args.maxGameplayStillsPerEntity);
    } else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-storefront-visuals -- [options]",
    "",
    "Downloads official/storefront stills for motion-blocked goal packages and writes rights evidence.",
    "No publishing, DB mutation, OAuth or token changes are performed.",
    "",
    "Options:",
    "  --work-order <path>             Render input work-order JSON",
    "  --out-dir <dir>                 Output report directory",
    "  --root <dir>                    Workspace root",
    "  --limit <n>                     Process at most n stories",
    "  --min-assets <n>                Required accepted storefront stills per story",
    "  --max-downloads-per-story <n>   Cap local still downloads per story",
    "  --max-store-assets-per-entity <n>    Cap storefront assets considered per entity",
    "  --max-gameplay-stills-per-entity <n> Cap gameplay stills considered per entity",
    "  --json                          Print JSON",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true, args };
  }
  const workOrder = await fs.readJson(path.resolve(args.workOrderPath));
  const report = await repairGoalStorefrontVisuals({
    root: path.resolve(args.root),
    workOrder,
    generatedAt: args.generatedAt || new Date().toISOString(),
    limit: args.limit,
    minAssets: args.minAssets,
    maxDownloadsPerStory: args.maxDownloadsPerStory,
    maxStoreAssetsPerEntity: args.maxStoreAssetsPerEntity,
    maxGameplayStillsPerEntity: args.maxGameplayStillsPerEntity,
  });
  const written = await writeGoalStorefrontVisualRepairReport(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoalStorefrontVisualRepairMarkdown(report).trimEnd());
  return { args, report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal-storefront-visual-repair] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

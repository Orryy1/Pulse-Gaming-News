#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  materializeGoalPlatformVariants,
  renderGoalPlatformVariantMaterializationMarkdown,
  writeGoalPlatformVariantMaterializationReport,
} = require("../lib/goal-platform-variant-materializer");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    outDir: path.join(ROOT, "output", "goal-contract"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++i] || args.storyPackagesPath;
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
    "Usage: npm run ops:goal-platform-variants -- [options]",
    "",
    "Options:",
    "  --story-packages <path>  Story package list JSON",
    "  --out-dir <dir>          Output directory for the materialization report",
    "  --generated-at <iso>     Fixed timestamp for deterministic reports",
    "  --json                   Print JSON report",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback = []) {
  const resolved = path.resolve(filePath);
  if (!(await fs.pathExists(resolved))) return fallback;
  return fs.readJson(resolved);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const storyPackages = await readJsonIfPresent(args.storyPackagesPath, []);
  const report = await materializeGoalPlatformVariants({
    storyPackages,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeGoalPlatformVariantMaterializationReport(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoalPlatformVariantMaterializationMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal-platform-variant-materializer] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  repairGoalPlatformDurationContracts,
  renderGoalPlatformDurationContractMarkdown,
  writeGoalPlatformDurationContractReport,
} = require("../lib/goal-platform-duration-contract");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    storyPackagesPath: null,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--story-packages") args.storyPackagesPath = argv[++i] || "";
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
    "Usage: npm run ops:goal-platform-duration-contract -- [options]",
    "",
    "Options:",
    "  --root <dir>              Workspace root",
    "  --story-packages <path>   Story package manifest",
    "  --out-dir <dir>           Output directory",
    "  --generated-at <iso>      Fixed timestamp",
    "  --json                    Print JSON",
    "",
    "Repairs platform duration contracts only. Does not publish, mutate DB rows or touch OAuth/token settings.",
  ].join("\n");
}

async function readStoryPackages(root, explicitPath = null) {
  const filePath = explicitPath
    ? path.resolve(root, explicitPath)
    : path.join(root, "output", "goal-contract", "story-packages.json");
  const value = await fs.readJson(filePath);
  if (!Array.isArray(value)) throw new Error(`story package file is not an array: ${filePath}`);
  return value;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const root = path.resolve(args.root);
  const storyPackages = await readStoryPackages(root, args.storyPackagesPath);
  const report = await repairGoalPlatformDurationContracts({
    storyPackages,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const artefacts = await writeGoalPlatformDurationContractReport(report, {
    outputDir: path.resolve(root, args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoalPlatformDurationContractMarkdown(report).trimEnd());
  return { report, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-platform-duration-contract] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  readStoryPackages,
  main,
};

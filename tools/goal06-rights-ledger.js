#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true });
}

const {
  DEFAULT_PLATFORMS,
  buildGoal06RightsLedger,
  renderGoal06RightsLedgerMarkdown,
  writeGoal06RightsLedger,
} = require("../lib/goal06-rights-ledger");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    outDir: path.join(ROOT, "output", "goal-06"),
    workspaceRoot: ROOT,
    generatedAt: null,
    platforms: DEFAULT_PLATFORMS,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++i] || args.storyPackagesPath;
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--workspace") args.workspaceRoot = argv[++i] || args.workspaceRoot;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--platforms") {
      args.platforms = String(argv[++i] || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal06-rights-ledger -- [options]",
    "",
    "Options:",
    "  --story-packages <path>   Story package manifest",
    "  --out-dir <dir>           Output directory for Goal 06 proof",
    "  --workspace <dir>         Workspace root for relative package paths",
    "  --platforms <csv>         Target platforms for rights scope",
    "  --generated-at <iso>      Fixed timestamp for deterministic reports",
    "  --json                    Print JSON summary",
    "",
    "LOCAL_PROOF only. This command reads package ledgers and writes proof reports. It does not publish, post, mutate DB rows or touch OAuth/token settings.",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback = []) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const storyPackages = await readJsonIfPresent(path.resolve(args.storyPackagesPath), []);
  const report = await buildGoal06RightsLedger({
    storyPackages,
    workspaceRoot: path.resolve(args.workspaceRoot),
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
    platforms: args.platforms,
  });
  const written = await writeGoal06RightsLedger(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoal06RightsLedgerMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal06-rights-ledger] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

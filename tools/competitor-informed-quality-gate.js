#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildCompetitorInformedQualityGate,
  renderCompetitorInformedQualityGateMarkdown,
  writeCompetitorInformedQualityGate,
} = require("../lib/competitor-informed-quality-gate");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    rulebookPath: path.join(ROOT, "output", "competitor-forensics-lab", "pulse_upgrade_rulebook.json"),
    outDir: path.join(ROOT, "output", "competitor-quality-gate"),
    workspaceRoot: ROOT,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--rulebook") args.rulebookPath = argv[++index] || args.rulebookPath;
    else if (arg === "--out-dir") args.outDir = argv[++index] || args.outDir;
    else if (arg === "--workspace") args.workspaceRoot = argv[++index] || args.workspaceRoot;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:competitor-informed-quality-gate -- [options]",
    "",
    "Options:",
    "  --story-packages <path>   Story package manifest",
    "  --rulebook <path>         Pulse upgrade rulebook from competitor lab",
    "  --out-dir <dir>           Output directory",
    "  --workspace <dir>         Workspace root for relative artefact dirs",
    "  --generated-at <iso>      Fixed timestamp",
    "  --json                    Print JSON report",
    "",
    "LOCAL_PROOF only. This command writes Pulse Media-House Score artefacts, does not publish, does not weaken gates, does not copy competitor assets, does not mutate DB rows and does not touch OAuth or token settings.",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback) {
  if (!filePath) return fallback;
  const resolved = path.resolve(filePath);
  if (!(await fs.pathExists(resolved))) return fallback;
  const value = await fs.readJson(resolved);
  if (Array.isArray(fallback) && !Array.isArray(value)) return fallback;
  return value;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const storyPackages = await readJsonIfPresent(args.storyPackagesPath, []);
  const rulebook = await readJsonIfPresent(args.rulebookPath, {});
  const report = await buildCompetitorInformedQualityGate({
    storyPackages,
    rulebook,
    workspaceRoot: path.resolve(args.workspaceRoot),
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeCompetitorInformedQualityGate(report, { outputDir: path.resolve(args.outDir) });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderCompetitorInformedQualityGateMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[competitor-informed-quality-gate] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

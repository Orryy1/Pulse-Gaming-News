#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildGoal26CreatorStudioBrandSystem,
  renderGoal26CreatorStudioBrandSystemMarkdown,
  writeGoal26CreatorStudioBrandSystem,
} = require("../lib/goal26-creator-studio-brand-system");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    upstreamSponsorReportPath: path.join(ROOT, "output", "goal-25", "goal25_readiness_report.json"),
    brandSnapshotPath: path.join(ROOT, "output", "goal-26", "brand_snapshot.json"),
    outDir: path.join(ROOT, "output", "goal-26"),
    workspaceRoot: ROOT,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--upstream-sponsor-report") args.upstreamSponsorReportPath = argv[++index] || args.upstreamSponsorReportPath;
    else if (arg === "--brand-snapshot") args.brandSnapshotPath = argv[++index] || args.brandSnapshotPath;
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
    "Usage: npm run ops:goal26-creator-studio-brand-system -- [options]",
    "",
    "Options:",
    "  --story-packages <path>             Story package manifest",
    "  --upstream-sponsor-report <path>    Goal 25 readiness report",
    "  --brand-snapshot <path>             Optional brand snapshot override",
    "  --out-dir <dir>                     Output directory for Goal 26 proof",
    "  --workspace <dir>                   Workspace root for relative package paths",
    "  --generated-at <iso>                Fixed timestamp for deterministic reports",
    "  --json                              Print JSON report",
    "",
    "LOCAL_PROOF only. This command compiles the brand system manifest, visual guide, editorial guide and recurring format registry. It does not render, publish, post externally, mutate production rows or change OAuth/token state.",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

function loadChannelConfig() {
  return require("../channels/pulse-gaming");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const storyPackages = await readJsonIfPresent(path.resolve(args.storyPackagesPath), []);
  const upstreamSponsorReport = await readJsonIfPresent(path.resolve(args.upstreamSponsorReportPath), {});
  const brandSnapshot = await readJsonIfPresent(path.resolve(args.brandSnapshotPath), null);
  const report = await buildGoal26CreatorStudioBrandSystem({
    storyPackages,
    upstreamSponsorReport,
    brandSnapshot,
    channelConfig: loadChannelConfig(),
    workspaceRoot: path.resolve(args.workspaceRoot),
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeGoal26CreatorStudioBrandSystem(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoal26CreatorStudioBrandSystemMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal26-creator-studio-brand-system] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true });
}

const {
  buildGoal13MultiPlatformPublisherEngine,
  renderGoal13MultiPlatformPublisherEngineMarkdown,
  writeGoal13MultiPlatformPublisherEngine,
} = require("../lib/goal13-multi-platform-publisher-engine");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    upstreamExperimentReportPath: path.join(ROOT, "output", "goal-12", "goal12_readiness_report.json"),
    outDir: path.join(ROOT, "output", "goal-13"),
    workspaceRoot: ROOT,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--upstream-experiment-report") args.upstreamExperimentReportPath = argv[++index] || args.upstreamExperimentReportPath;
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
    "Usage: npm run ops:goal13-multi-platform-publisher -- [options]",
    "",
    "Options:",
    "  --story-packages <path>               Story package manifest",
    "  --upstream-experiment-report <path>  Goal 12 readiness report",
    "  --out-dir <dir>                       Output directory for Goal 13 proof",
    "  --workspace <dir>                     Workspace root for relative package paths",
    "  --generated-at <iso>                  Fixed timestamp for deterministic reports",
    "  --json                                Print JSON report",
    "",
    "DRY_RUN_PUBLISH only. This command validates platform-native packages, creates dry-run schedule evidence and prepares an analytics ingest plan. It does not publish, upload, post externally, mutate DB rows, inspect secrets or touch OAuth/token settings.",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback) {
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
  const upstreamExperimentReport = await readJsonIfPresent(path.resolve(args.upstreamExperimentReportPath), {});
  const report = await buildGoal13MultiPlatformPublisherEngine({
    storyPackages,
    upstreamExperimentReport,
    workspaceRoot: path.resolve(args.workspaceRoot),
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeGoal13MultiPlatformPublisherEngine(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoal13MultiPlatformPublisherEngineMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal13-multi-platform-publisher-engine] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

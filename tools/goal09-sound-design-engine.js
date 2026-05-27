#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true });
}

const {
  buildGoal09SoundDesignEngine,
  renderGoal09SoundDesignEngineMarkdown,
  writeGoal09SoundDesignEngine,
} = require("../lib/goal09-sound-design-engine");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    upstreamVisualReportPath: path.join(ROOT, "output", "goal-08", "goal08_readiness_report.json"),
    outDir: path.join(ROOT, "output", "goal-09"),
    workspaceRoot: ROOT,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--upstream-visual-report") args.upstreamVisualReportPath = argv[++index] || args.upstreamVisualReportPath;
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
    "Usage: npm run ops:goal09-sound-design-engine -- [options]",
    "",
    "Options:",
    "  --story-packages <path>          Story package manifest",
    "  --upstream-visual-report <path>  Goal 08 readiness report",
    "  --out-dir <dir>                  Output directory for Goal 09 proof",
    "  --workspace <dir>                Workspace root for relative package paths",
    "  --generated-at <iso>             Fixed timestamp for deterministic reports",
    "  --json                           Print JSON report",
    "",
    "LOCAL_PROOF only. This command validates existing audio, SFX and loudness evidence and writes proof reports. It does not mix, render, publish, post, mutate DB rows or touch OAuth/token settings.",
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
  const upstreamVisualReport = await readJsonIfPresent(path.resolve(args.upstreamVisualReportPath), {});
  const report = await buildGoal09SoundDesignEngine({
    storyPackages,
    upstreamVisualReport,
    workspaceRoot: path.resolve(args.workspaceRoot),
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeGoal09SoundDesignEngine(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoal09SoundDesignEngineMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal09-sound-design-engine] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

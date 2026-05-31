#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true, quiet: true });
}

const {
  buildHumanReviewVisualStripPlan,
  extractHumanReviewVisualStrips,
  writeHumanReviewVisualStripReport,
} = require("../lib/goal-human-review-visual-strip");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    consolePath: null,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
    planOnly: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--console") args.consolePath = argv[++i] || "";
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--ffmpeg") args.ffmpegPath = argv[++i] || args.ffmpegPath;
    else if (arg === "--plan-only") args.planOnly = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-human-review-visual-strip -- [options]",
    "",
    "Options:",
    "  --root <dir>          Workspace root",
    "  --console <path>      human_review_console.json",
    "  --out-dir <dir>       Output directory",
    "  --generated-at <iso>  Fixed timestamp",
    "  --ffmpeg <path>       ffmpeg executable",
    "  --plan-only           Write report without extracting frames",
    "  --json                Print JSON",
    "",
    "Builds local first-three-second visual strips for human review. It cannot approve, publish, mutate DB rows or touch OAuth/token settings.",
  ].join("\n");
}

async function readJson(filePath, label) {
  if (!await fs.pathExists(filePath)) throw new Error(`${label} not found: ${filePath}`);
  return fs.readJson(filePath);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }

  const root = path.resolve(args.root);
  const consolePath = args.consolePath
    ? path.resolve(root, args.consolePath)
    : path.join(root, "output", "goal-contract", "human_review_console.json");
  const outDir = path.resolve(root, args.outDir);
  const plan = buildHumanReviewVisualStripPlan({
    consoleBundle: await readJson(consolePath, "human review console"),
    outputDir: outDir,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const report = args.planOnly
    ? plan
    : await extractHumanReviewVisualStrips(plan, { ffmpegPath: args.ffmpegPath });
  const artefacts = await writeHumanReviewVisualStripReport(report, { outputDir: outDir });

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log("Human review visual strip report written.");
    console.log(`JSON: ${artefacts.jsonPath}`);
    console.log(`HTML: ${artefacts.htmlPath}`);
    console.log("This tool does not approve, publish, mutate DB rows or touch OAuth/token settings.");
  }
  return { report, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-human-review-visual-strip] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};

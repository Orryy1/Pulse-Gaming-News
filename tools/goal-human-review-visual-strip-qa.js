#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true, quiet: true });
}

const {
  buildHumanReviewVisualStripQaReport,
  writeHumanReviewVisualStripQaReport,
} = require("../lib/goal-human-review-visual-strip-qa");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    visualStripPath: null,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--visual-strip") args.visualStripPath = argv[++i] || "";
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
    "Usage: npm run ops:goal-human-review-visual-strip-qa -- [options]",
    "",
    "Options:",
    "  --root <dir>              Workspace root",
    "  --visual-strip <path>     human_review_visual_strip_report.json",
    "  --out-dir <dir>           Output directory",
    "  --generated-at <iso>      Fixed timestamp",
    "  --json                    Print JSON",
    "",
    "Analyses local first-three-second review frames for weak openings, possible text cutoff and mobile headline risk. It cannot approve, publish, mutate DB rows or touch OAuth/token settings.",
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
  const visualStripPath = args.visualStripPath
    ? path.resolve(root, args.visualStripPath)
    : path.join(root, "output", "goal-contract", "human_review_visual_strip_report.json");
  const outDir = path.resolve(root, args.outDir);
  const report = await buildHumanReviewVisualStripQaReport({
    visualStripReport: await readJson(visualStripPath, "human review visual strip report"),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const artefacts = await writeHumanReviewVisualStripQaReport(report, { outputDir: outDir });

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log("Human review visual strip QA report written.");
    console.log(`JSON: ${artefacts.jsonPath}`);
    console.log(`HTML: ${artefacts.htmlPath}`);
    console.log("This tool does not approve, publish, mutate DB rows or touch OAuth/token settings.");
  }
  return { report, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-human-review-visual-strip-qa] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};

#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true, quiet: true });
}

const {
  buildHumanReviewOperatorIndex,
  renderHumanReviewOperatorIndexMarkdown,
  writeHumanReviewOperatorIndex,
} = require("../lib/goal-human-review-operator-index");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    decisionSheetPath: null,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--decision-sheet") args.decisionSheetPath = argv[++i] || "";
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
    "Usage: npm run ops:goal-human-review-index -- [options]",
    "",
    "Options:",
    "  --root <dir>             Workspace root",
    "  --decision-sheet <path>  human_review_decision_sheet.json",
    "  --out-dir <dir>          Output directory",
    "  --generated-at <iso>     Fixed timestamp",
    "  --json                   Print JSON",
    "",
    "Builds a HUMAN_REVIEW operator index from the decision sheet. It never publishes, mutates DB rows or touches OAuth/token settings.",
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
  const decisionSheetPath = args.decisionSheetPath
    ? path.resolve(root, args.decisionSheetPath)
    : path.join(root, "output", "goal-contract", "human_review_decision_sheet.json");
  const index = buildHumanReviewOperatorIndex({
    decisionSheet: await readJson(decisionSheetPath, "human review decision sheet"),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const artefacts = await writeHumanReviewOperatorIndex(index, {
    outputDir: path.resolve(root, args.outDir),
  });
  if (args.json) console.log(JSON.stringify(index, null, 2));
  else console.log(renderHumanReviewOperatorIndexMarkdown(index).trimEnd());
  return { index, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-human-review-operator-index] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};

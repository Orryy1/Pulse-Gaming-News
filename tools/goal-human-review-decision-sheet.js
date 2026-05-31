#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true, quiet: true });
}

const {
  buildHumanReviewDecisionSheet,
  renderHumanReviewDecisionSheetMarkdown,
  writeHumanReviewDecisionSheet,
} = require("../lib/goal-human-review-decision-sheet");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    reviewPacketManifestPath: null,
    operatorDecisionLogPath: null,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--review-packet-manifest") args.reviewPacketManifestPath = argv[++i] || "";
    else if (arg === "--operator-decision-log") args.operatorDecisionLogPath = argv[++i] || "";
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
    "Usage: npm run ops:goal-human-review-decisions -- [options]",
    "",
    "Options:",
    "  --root <dir>                     Workspace root",
    "  --review-packet-manifest <path>  review_packet_manifest.json",
    "  --operator-decision-log <path>   operator_decision_log.json",
    "  --out-dir <dir>                  Output directory",
    "  --generated-at <iso>             Fixed timestamp",
    "  --json                           Print JSON",
    "",
    "Builds a fillable HUMAN_REVIEW decision sheet. It never publishes, mutates DB rows or touches OAuth/token settings.",
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
  const reviewPacketManifestPath = args.reviewPacketManifestPath
    ? path.resolve(root, args.reviewPacketManifestPath)
    : path.join(root, "output", "goal-contract", "review_packet_manifest.json");
  const operatorDecisionLogPath = args.operatorDecisionLogPath
    ? path.resolve(root, args.operatorDecisionLogPath)
    : path.join(root, "output", "goal-contract", "operator_decision_log.json");

  const sheet = buildHumanReviewDecisionSheet({
    reviewPacketManifest: await readJson(reviewPacketManifestPath, "review packet manifest"),
    operatorDecisionLog: await readJson(operatorDecisionLogPath, "operator decision log"),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const artefacts = await writeHumanReviewDecisionSheet(sheet, {
    outputDir: path.resolve(root, args.outDir),
  });
  if (args.json) console.log(JSON.stringify(sheet, null, 2));
  else console.log(renderHumanReviewDecisionSheetMarkdown(sheet).trimEnd());
  return { sheet, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-human-review-decision-sheet] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};

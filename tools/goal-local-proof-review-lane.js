#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true, quiet: true });
}

const {
  buildGoalLocalProofReviewLane,
  renderGoalLocalProofReviewLaneMarkdown,
  writeGoalLocalProofReviewLane,
} = require("../lib/goal-local-proof-review-lane");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    humanReviewQueuePath: null,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    maxItems: 30,
    buildVisualReviewSheet: false,
    visualReviewDir: null,
    frameTimesS: [0, 1.5, 3],
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--human-review-queue") args.humanReviewQueuePath = argv[++i] || "";
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--max-items") args.maxItems = Number(argv[++i] || args.maxItems);
    else if (arg === "--build-visual-review-sheet") args.buildVisualReviewSheet = true;
    else if (arg === "--visual-review-dir") args.visualReviewDir = argv[++i] || "";
    else if (arg === "--frame-times") {
      args.frameTimesS = String(argv[++i] || "")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value >= 0);
    }
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-local-proof-review -- [options]",
    "",
    "Options:",
    "  --root <dir>                    Workspace root",
    "  --human-review-queue <path>      Human review queue JSON",
    "  --out-dir <dir>                  Output directory",
    "  --generated-at <iso>             Fixed timestamp",
    "  --max-items <n>                  Maximum review videos",
    "  --build-visual-review-sheet      Extract first-seconds frames and contact sheet",
    "  --visual-review-dir <dir>        Output directory for review frames/contact sheet",
    "  --frame-times <csv>              Frame timestamps in seconds, default 0,1.5,3",
    "  --json                           Print JSON",
    "",
    "Local-proof review only. Does not publish, mutate DB rows or touch OAuth/token settings.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const root = path.resolve(args.root);
  const queuePath = args.humanReviewQueuePath
    ? path.resolve(root, args.humanReviewQueuePath)
    : path.join(root, "output", "goal-contract", "human_review_queue.json");
  const humanReviewQueue = await fs.readJson(queuePath);
  const report = await buildGoalLocalProofReviewLane({
    humanReviewQueue,
    generatedAt: args.generatedAt || new Date().toISOString(),
    maxItems: args.maxItems,
    buildVisualReviewSheet: args.buildVisualReviewSheet,
    visualReviewDir: args.visualReviewDir ? path.resolve(root, args.visualReviewDir) : null,
    frameTimesS: args.frameTimesS,
  });
  const artefacts = await writeGoalLocalProofReviewLane(report, {
    outputDir: path.resolve(root, args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoalLocalProofReviewLaneMarkdown(report).trimEnd());
  return { report, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-local-proof-review-lane] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};

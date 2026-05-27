#!/usr/bin/env node
"use strict";

const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const ROOT = path.resolve(__dirname, "..");
const db = require("../lib/db");
const {
  runCommercialLearningLoop,
} = require("../lib/intelligence/commercial-learning-loop");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    clickLogPath: path.join(ROOT, "data", "commercial_clicks.jsonl"),
    manifestDir: path.join(ROOT, "output", "commercial"),
    outputDir: path.join(ROOT, "data", "learning", "commercial"),
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--click-log" && argv[i + 1]) args.clickLogPath = argv[++i];
    else if (arg.startsWith("--click-log=")) args.clickLogPath = arg.slice(12);
    else if (arg === "--manifest-dir" && argv[i + 1]) args.manifestDir = argv[++i];
    else if (arg.startsWith("--manifest-dir=")) args.manifestDir = arg.slice(15);
    else if (arg === "--out-dir" && argv[i + 1]) args.outputDir = argv[++i];
    else if (arg.startsWith("--out-dir=")) args.outputDir = arg.slice(10);
  }
  for (const key of ["clickLogPath", "manifestDir", "outputDir"]) {
    if (!path.isAbsolute(args[key])) args[key] = path.resolve(ROOT, args[key]);
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const stories = await db.getStories();
  const result = await runCommercialLearningLoop({
    clickLogPath: args.clickLogPath,
    manifestDirs: [args.manifestDir],
    outputDir: args.outputDir,
    stories,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result.digest, null, 2)}\n`);
  } else {
    console.log(`[commercial-learning] status=${result.digest.status}`);
    console.log(`[commercial-learning] clicks=${result.digest.totals.clicks}`);
    console.log(`[commercial-learning] stories=${result.digest.totals.clicked_stories}`);
    console.log(`[commercial-learning] md=${path.relative(ROOT, result.artefacts.mdPath)}`);
    console.log(`[commercial-learning] json=${path.relative(ROOT, result.artefacts.jsonPath)}`);
  }
  return result;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[commercial-learning] FAILED: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};

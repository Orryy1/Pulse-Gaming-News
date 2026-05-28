#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true, quiet: true });
}

const {
  buildGoalDailyCadencePlan,
  renderGoalDailyCadenceMarkdown,
  writeGoalDailyCadencePlan,
} = require("../lib/goal-daily-cadence");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    humanReviewQueuePath: null,
    upstreamBenchmarkReportPath: null,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    targetDailyShorts: 3,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--human-review-queue") args.humanReviewQueuePath = argv[++i] || "";
    else if (arg === "--upstream-benchmark-report") args.upstreamBenchmarkReportPath = argv[++i] || "";
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--target-daily-shorts") args.targetDailyShorts = Number(argv[++i] || args.targetDailyShorts);
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-daily-cadence -- [options]",
    "",
    "Options:",
    "  --root <dir>                  Workspace root",
    "  --human-review-queue <path>   Human review queue JSON",
    "  --upstream-benchmark-report <path> Optional Goal 10 readiness report",
    "  --out-dir <dir>               Output directory",
    "  --generated-at <iso>          Fixed timestamp",
    "  --target-daily-shorts <n>     Number of Shorts to plan, 1-8",
    "  --json                        Print JSON",
    "",
    "Planning only. Does not publish, mutate DB rows or touch OAuth/token settings.",
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
  const upstreamBenchmarkPath = args.upstreamBenchmarkReportPath
    ? path.resolve(root, args.upstreamBenchmarkReportPath)
    : null;
  const upstreamBenchmarkReport = upstreamBenchmarkPath && await fs.pathExists(upstreamBenchmarkPath)
    ? await fs.readJson(upstreamBenchmarkPath)
    : {};
  const plan = await buildGoalDailyCadencePlan({
    humanReviewQueue,
    upstreamBenchmarkReport,
    generatedAt: args.generatedAt || new Date().toISOString(),
    targetDailyShorts: args.targetDailyShorts,
  });
  const artefacts = await writeGoalDailyCadencePlan(plan, {
    outputDir: path.resolve(root, args.outDir),
  });
  if (args.json) console.log(JSON.stringify(plan, null, 2));
  else console.log(renderGoalDailyCadenceMarkdown(plan).trimEnd());
  return { plan, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-daily-cadence] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};

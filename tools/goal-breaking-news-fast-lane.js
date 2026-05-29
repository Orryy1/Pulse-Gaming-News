#!/usr/bin/env node
"use strict";

require("dotenv").config({ quiet: true });

const path = require("node:path");
const fs = require("fs-extra");
const {
  buildBreakingNewsFastLaneOverview,
  buildGoalBreakingNewsFastLanePlan,
  writeBreakingNewsFastLaneOverview,
  writeGoalBreakingNewsFastLanePlan,
} = require("../lib/goal-breaking-news-fast-lane");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPath: "",
    platformStatePath: "",
    outDir: path.join("output", "goal-contract", "breaking-news-fast-lane"),
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--story") args.storyPath = argv[++i] || "";
    else if (arg === "--platform-state") args.platformStatePath = argv[++i] || "";
    else if (arg === "--out-dir") args.outDir = argv[++i] || "";
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-breaking-news -- [options]",
    "",
    "Options:",
    "  --story <path>             Canonical story manifest or story JSON",
    "  --platform-state <path>    Platform status matrix JSON",
    "  --out-dir <path>           Output directory",
    "  --json                     Print JSON plan",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath) return fallback;
  if (!(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return null;
  }
  const platformStatePath = args.platformStatePath ||
    (await fs.pathExists(path.join("output", "goal-contract", "platform_status_matrix.json"))
      ? path.join("output", "goal-contract", "platform_status_matrix.json")
      : "");
  const platformState = await readJsonIfPresent(platformStatePath, {});
  if (!args.storyPath) {
    const overview = buildBreakingNewsFastLaneOverview({ platformState });
    await writeBreakingNewsFastLaneOverview(overview, { outputDir: args.outDir });
    if (args.json) process.stdout.write(`${JSON.stringify(overview, null, 2)}\n`);
    else console.log(`Breaking fast-lane overview: ${overview.verdict} (${overview.required_input} required)`);
    return overview;
  }
  const story = await fs.readJson(path.resolve(args.storyPath));
  const plan = await buildGoalBreakingNewsFastLanePlan({ story, platformState });
  await writeGoalBreakingNewsFastLanePlan(plan, { outputDir: args.outDir });
  if (args.json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  else console.log(`Breaking fast-lane verdict: ${plan.breaking_news_manifest.verdict}`);
  return plan;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-breaking-news-fast-lane] FAILED: ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
};

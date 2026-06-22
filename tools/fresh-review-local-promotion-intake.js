#!/usr/bin/env node
"use strict";

const path = require("node:path");
require("dotenv").config({ quiet: true, override: true });

const {
  buildFreshReviewLocalPromotionIntake,
  writeFreshReviewLocalPromotionIntake,
} = require("../lib/fresh-review-local-promotion-intake");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "goal-contract", "fresh-review-local-promotion-intake");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    json: false,
    limit: 6,
    maxAgeHours: 7 * 24,
    minScore: 65,
    outDir: OUT,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--limit") args.limit = Number(argv[++i] || args.limit);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--max-age-hours") args.maxAgeHours = Number(argv[++i] || args.maxAgeHours);
    else if (arg.startsWith("--max-age-hours=")) args.maxAgeHours = Number(arg.slice("--max-age-hours=".length));
    else if (arg === "--min-score") args.minScore = Number(argv[++i] || args.minScore);
    else if (arg.startsWith("--min-score=")) args.minScore = Number(arg.slice("--min-score=".length));
    else if (arg === "--out-dir") args.outDir = path.resolve(ROOT, argv[++i] || args.outDir);
    else if (arg.startsWith("--out-dir=")) args.outDir = path.resolve(ROOT, arg.slice("--out-dir=".length));
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = 6;
  if (!Number.isFinite(args.maxAgeHours) || args.maxAgeHours <= 0) args.maxAgeHours = 7 * 24;
  if (!Number.isFinite(args.minScore) || args.minScore <= 0) args.minScore = 65;
  return args;
}

function usage() {
  return [
    "Usage: node tools/fresh-review-local-promotion-intake.js [options]",
    "",
    "Builds fresh_source_intake_stories.json from source-backed review rows using dry-run script repair.",
    "It does not publish, mutate the production DB, touch OAuth/tokens or enable disabled platforms.",
    "",
    "Options:",
    "  --limit <n>",
    "  --max-age-hours <n>",
    "  --min-score <n>",
    "  --out-dir <path>",
    "  --json",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return { args, report: null, written: null };
  }
  const report = await buildFreshReviewLocalPromotionIntake(args);
  const written = await writeFreshReviewLocalPromotionIntake(report, { outputDir: args.outDir });
  if (args.json) process.stdout.write(`${JSON.stringify({ report, written }, null, 2)}\n`);
  else {
    process.stdout.write(
      [
        "# Fresh Review Local Promotion Intake",
        "",
        `Stories: ${report.summary.local_promotion_story_count}`,
        `DB mutation required: ${report.summary.production_db_mutation_required ? "yes" : "no"}`,
        `Output: ${path.relative(ROOT, written.storiesPath)}`,
        "",
      ].join("\n"),
    );
  }
  return { args, report, written };
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[fresh-review-local-promotion-intake] ${error.stack || error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

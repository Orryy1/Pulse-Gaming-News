#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

try {
  require("dotenv").config({ override: true, quiet: true });
} catch {}

const {
  repairGoalOfficialStillVisuals,
  renderGoalOfficialStillVisualRepairMarkdown,
  writeGoalOfficialStillVisualRepairReport,
} = require("../lib/goal-official-still-visual-repair");

const ROOT = path.resolve(__dirname, "..");

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseStoryIds(value) {
  return cleanText(value)
    .split(",")
    .map(cleanText)
    .filter(Boolean);
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    intakeReportPath: path.join(ROOT, "output", "goal-contract", "official_source_intake_report.json"),
    outDir: path.join(ROOT, "output", "goal-contract"),
    root: ROOT,
    storyIds: [],
    generatedAt: null,
    minAssets: 5,
    maxDownloadsPerStory: 6,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--intake-report" || arg === "--input") args.intakeReportPath = argv[++i] || args.intakeReportPath;
    else if (arg === "--out-dir" || arg === "--output-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--story-id" || arg === "--story") args.storyIds.push(...parseStoryIds(argv[++i]));
    else if (arg === "--story-ids") args.storyIds.push(...parseStoryIds(argv[++i]));
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--min-assets") args.minAssets = Number(argv[++i] || args.minAssets);
    else if (arg === "--max-downloads-per-story") args.maxDownloadsPerStory = Number(argv[++i] || args.maxDownloadsPerStory);
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-official-stills -- [options]",
    "",
    "Downloads official press-kit/page stills from an accepted official-source intake report and writes rights evidence.",
    "No publishing, DB mutation, OAuth or token changes are performed.",
    "",
    "Options:",
    "  --intake-report <path>         Official-source intake report JSON",
    "  --story-id <id>                Optional story id filter; repeatable",
    "  --story-ids <ids>              Comma-separated story id filters",
    "  --out-dir <dir>                Output report directory",
    "  --root <dir>                   Workspace root",
    "  --min-assets <n>               Required accepted official stills per story",
    "  --max-downloads-per-story <n>  Cap local still downloads per story",
    "  --json                         Print JSON",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true, args };
  }
  const intakeReport = await fs.readJson(path.resolve(args.intakeReportPath));
  const report = await repairGoalOfficialStillVisuals({
    root: path.resolve(args.root),
    intakeReport,
    storyIds: args.storyIds,
    generatedAt: args.generatedAt || new Date().toISOString(),
    minAssets: args.minAssets,
    maxDownloadsPerStory: args.maxDownloadsPerStory,
  });
  const written = await writeGoalOfficialStillVisualRepairReport(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoalOfficialStillVisualRepairMarkdown(report).trimEnd());
  return { args, report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal-official-still-visual-repair] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

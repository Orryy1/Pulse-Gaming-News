#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  materializeGoalRealMotion,
  renderGoalRealMotionMarkdown,
  writeGoalRealMotionReport,
} = require("../lib/goal-real-motion-materializer");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    workOrderPath: path.join(ROOT, "output", "goal-contract", "render_input_work_order.json"),
    outDir: path.join(ROOT, "output", "goal-contract"),
    root: ROOT,
    segmentReportPath: null,
    generatedAt: null,
    limit: 0,
    storyIds: [],
    minClips: 5,
    minFamilies: 4,
    maxClips: 8,
    refreshReady: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--work-order") args.workOrderPath = argv[++i] || args.workOrderPath;
    else if (arg === "--out-dir" || arg === "--output-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--segment-report" || arg === "--segment-validation-report") {
      args.segmentReportPath = argv[++i] || null;
    }
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--limit") args.limit = Number(argv[++i] || 0);
    else if (arg === "--story-id" || arg === "--story") args.storyIds.push(argv[++i] || "");
    else if (arg === "--min-clips") args.minClips = Number(argv[++i] || args.minClips);
    else if (arg === "--min-families") args.minFamilies = Number(argv[++i] || args.minFamilies);
    else if (arg === "--max-clips") args.maxClips = Number(argv[++i] || args.maxClips);
    else if (arg === "--refresh-ready") args.refreshReady = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-real-motion -- [options]",
    "",
    "Materialises validated direct gameplay/trailer media into local V4 motion clips.",
    "No publishing, DB mutation, OAuth or token changes are performed.",
    "",
    "Options:",
    "  --work-order <path>     Render input work-order JSON",
    "  --out-dir <dir>         Output report directory",
    "  --root <dir>            Workspace root",
    "  --segment-report <path> Read validated direct-video segments as repair candidates",
    "  --limit <n>             Process at most n stories",
    "  --story-id <id>         Process only the matching story; repeatable",
    "  --min-clips <n>         Required successful clips per story",
    "  --min-families <n>      Required distinct source families",
    "  --max-clips <n>         Maximum clips to materialise per story",
    "  --refresh-ready         Refresh requested ready stories from the current motion pack",
    "  --json                  Print JSON",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true, args };
  }
  const workOrder = await fs.readJson(path.resolve(args.workOrderPath));
  const segmentValidationReport = args.segmentReportPath
    ? await fs.readJson(path.resolve(args.segmentReportPath))
    : {};
  const report = await materializeGoalRealMotion({
    root: path.resolve(args.root),
    workOrder,
    generatedAt: args.generatedAt || new Date().toISOString(),
    limit: args.limit,
    storyIds: args.storyIds,
    minClips: args.minClips,
    minFamilies: args.minFamilies,
    maxClips: args.maxClips,
    segmentValidationReport,
    includeReadyStories: args.refreshReady,
  });
  const written = await writeGoalRealMotionReport(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoalRealMotionMarkdown(report).trimEnd());
  return { args, report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal-real-motion-materializer] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

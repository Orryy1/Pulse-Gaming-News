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
    artifactRoot: "",
    segmentReportPath: null,
    generatedAt: null,
    limit: 0,
    storyIds: [],
    minClips: 5,
    minFamilies: 4,
    maxClips: 8,
    maxDirectClipsPerBaseSource: null,
    minBaseSources: 0,
    strictBaseSourceDiversity: false,
    refreshReady: false,
    refreshWindowPlanPath: null,
    excludedClipIds: [],
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--work-order") args.workOrderPath = argv[++i] || args.workOrderPath;
    else if (arg === "--out-dir" || arg === "--output-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--artifact-root") args.artifactRoot = argv[++i] || args.artifactRoot;
    else if (arg === "--segment-report" || arg === "--segment-validation-report") {
      args.segmentReportPath = argv[++i] || null;
    }
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--limit") args.limit = Number(argv[++i] || 0);
    else if (arg === "--story-id" || arg === "--story") args.storyIds.push(argv[++i] || "");
    else if (arg === "--min-clips") args.minClips = Number(argv[++i] || args.minClips);
    else if (arg === "--min-families") args.minFamilies = Number(argv[++i] || args.minFamilies);
    else if (arg === "--max-clips") args.maxClips = Number(argv[++i] || args.maxClips);
    else if (arg === "--max-direct-clips-per-base-source") {
      args.maxDirectClipsPerBaseSource = Number(argv[++i] || 0) || null;
    }
    else if (arg === "--min-base-sources") args.minBaseSources = Number(argv[++i] || 0);
    else if (arg === "--strict-base-source-diversity") args.strictBaseSourceDiversity = true;
    else if (arg === "--refresh-ready") args.refreshReady = true;
    else if (arg === "--refresh-window-plan") args.refreshWindowPlanPath = argv[++i] || null;
    else if (arg === "--exclude-clip-id") args.excludedClipIds.push(argv[++i] || "");
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
    "  --artifact-root <dir>   Artifact root for segment-report-only fresh packages",
    "  --segment-report <path> Read validated direct-video segments as repair candidates",
    "  --limit <n>             Process at most n stories",
    "  --story-id <id>         Process only the matching story; repeatable",
    "  --min-clips <n>         Required successful clips per story",
    "  --min-families <n>      Required distinct source families",
    "  --max-clips <n>         Maximum clips to materialise per story",
    "  --max-direct-clips-per-base-source <n>  Maximum clips from the same direct-video base source",
    "  --min-base-sources <n>  Required genuine immutable base-source identities",
    "  --strict-base-source-diversity  Enforce the ultimate professional identity tier",
    "  --refresh-ready         Refresh requested ready stories from the current motion pack",
    "  --refresh-window-plan <path>  Materialise exact governed replacement windows from JSON",
    "  --exclude-clip-id <id>  Exclude a known-bad package clip during refresh; repeatable",
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
  const refreshWindowPlan = args.refreshWindowPlanPath
    ? await fs.readJson(path.resolve(args.refreshWindowPlanPath))
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
    maxDirectClipsPerBaseSource: args.maxDirectClipsPerBaseSource,
    minBaseSources: args.minBaseSources,
    strictBaseSourceDiversity: args.strictBaseSourceDiversity,
    segmentValidationReport,
    artifactRoot: args.artifactRoot,
    includeReadyStories: args.refreshReady,
    refreshWindowPlan,
    excludedClipIds: args.excludedClipIds,
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

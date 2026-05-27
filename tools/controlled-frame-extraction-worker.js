#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

try {
  require("dotenv").config({ override: true });
} catch {}

const {
  DEFAULT_OUTPUT_ROOT,
  mergeControlledFrameExtractionReports,
  renderControlledFrameExtractionWorkerMarkdown,
  runControlledFrameExtraction,
} = require("../lib/controlled-frame-extraction-worker");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_FRAME_PLAN_REPORT = path.join(OUT, "controlled_frame_extraction_v1.json");

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    storyId: null,
    limit: null,
    framePlan: null,
    dryRun: true,
    applyLocal: false,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    maxFramesPerStory: 8,
    mergePrevious: false,
    previousFrameReport: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--story-id" || arg === "--story") args.storyId = argv[++i] || null;
    else if (arg === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 1);
    else if (arg === "--frame-plan") args.framePlan = argv[++i] || null;
    else if (arg === "--dry-run") {
      args.dryRun = true;
      args.applyLocal = false;
    } else if (arg === "--apply-local") {
      args.dryRun = false;
      args.applyLocal = true;
    } else if (arg === "--output-root") {
      args.outputRoot = argv[++i] || DEFAULT_OUTPUT_ROOT;
    } else if (arg === "--max-frames-per-story") {
      args.maxFramesPerStory = Math.max(1, Number(argv[++i]) || 8);
    } else if (arg === "--merge-previous") {
      args.mergePrevious = true;
    } else if (arg === "--previous-frame-report") {
      args.previousFrameReport = argv[++i] || null;
    } else if (arg === "--help" || arg === "-?") args.help = true;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/controlled-frame-extraction-worker.js [options]",
      "",
      "Options:",
      "  --frame-plan <p>       Read a controlled frame-plan report",
      "  --story-id <id>        Extract one story from the frame-plan report",
      "  --limit <n>            Limit plans from the frame-plan report",
      "  --dry-run              Default. No video fetch or frame writes",
      "  --apply-local          Extract planned frames to test/output only",
      "  --output-root <path>   Apply-local output root, must be under test/output",
      "  --max-frames-per-story <n>",
      "                        Cap extracted frames per story",
      "  --merge-previous       Merge existing canonical frame-worker report by story id",
      "  --previous-frame-report <p>",
      "                        Merge this previous frame-worker report instead of the canonical one",
      "  --json                Print JSON instead of Markdown",
      "",
      "This command is local-only. It never mutates DB rows, Railway, OAuth, scheduler settings, render defaults or platform posts.",
    ].join("\n") + "\n",
  );
}

async function loadFramePlans(args) {
  const filePath = args.framePlan ? path.resolve(ROOT, args.framePlan) : DEFAULT_FRAME_PLAN_REPORT;
  if (!(await fs.pathExists(filePath))) {
    throw new Error(`frame plan report not found: ${filePath}`);
  }
  const report = await fs.readJson(filePath);
  let plans = Array.isArray(report.plans) ? report.plans : [];
  if (args.storyId) plans = plans.filter((plan) => plan.story_id === args.storyId);
  if (args.limit) plans = plans.slice(0, args.limit);
  return { plans, source: filePath };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  if (args.applyLocal && process.env.RAILWAY_ENVIRONMENT) {
    throw new Error("apply-local frame extraction is disabled in Railway environments");
  }

  const loaded = await loadFramePlans(args);
  let report = await runControlledFrameExtraction(loaded.plans, {
    applyLocal: args.applyLocal,
    outputRoot: args.outputRoot,
    maxFramesPerStory: args.maxFramesPerStory,
  });
  report.frame_plan_source = loaded.source;

  const stem = args.applyLocal
    ? "controlled_frame_extraction_worker_apply_local"
    : "controlled_frame_extraction_worker_dry_run";
  if (args.mergePrevious) {
    const previousPath = args.previousFrameReport
      ? path.resolve(ROOT, args.previousFrameReport)
      : path.join(OUT, `${stem}.json`);
    if (await fs.pathExists(previousPath)) {
      const previousReport = await fs.readJson(previousPath);
      report = mergeControlledFrameExtractionReports(previousReport, report);
      report.previous_frame_report_source = previousPath;
      report.frame_plan_source = loaded.source;
    }
  }

  const markdown = renderControlledFrameExtractionWorkerMarkdown(report);
  await fs.ensureDir(OUT);
  await fs.writeJson(path.join(OUT, `${stem}.json`), report, { spaces: 2 });
  await fs.writeFile(path.join(OUT, `${stem}.md`), markdown, "utf8");
  await fs.writeJson(path.join(OUT, "controlled_frame_extraction_worker_v1.json"), report, {
    spaces: 2,
  });
  await fs.writeFile(path.join(OUT, "controlled_frame_extraction_worker_v1.md"), markdown, "utf8");

  process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : markdown);
  process.stderr.write(`[frame-worker] wrote test/output/${stem}.{json,md}\n`);
}

main().catch((err) => {
  process.stderr.write(`[frame-worker] ${err.stack || err.message}\n`);
  process.exit(1);
});

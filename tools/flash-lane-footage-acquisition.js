#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildFlashLaneFootageAcquisitionPlan,
  renderFlashLaneFootageAcquisitionMarkdown,
} = require("../lib/studio/v2/flash-lane-footage-acquisition");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_FRAME_REPORT = path.join(OUT, "controlled_frame_extraction_worker_apply_local.json");
const DEFAULT_SEGMENT_REPORT = path.join(OUT, "official_trailer_segment_validation_v1.json");

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    storyId: null,
    frameReport: DEFAULT_FRAME_REPORT,
    segmentReport: DEFAULT_SEGMENT_REPORT,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--story" || arg === "--story-id") args.storyId = argv[++i] || null;
    else if (arg === "--frame-report") args.frameReport = argv[++i] || DEFAULT_FRAME_REPORT;
    else if (arg === "--segment-report") args.segmentReport = argv[++i] || DEFAULT_SEGMENT_REPORT;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/flash-lane-footage-acquisition.js [options]",
      "",
      "Options:",
      "  --story-id <id>       Story id to inspect",
      "  --frame-report <p>    Controlled frame extraction worker report",
      "  --segment-report <p>  Official trailer segment validation report",
      "  --json                Print JSON instead of Markdown",
      "",
      "This command is report-only. It creates a shopping list for missing validated footage windows.",
    ].join("\n") + "\n",
  );
}

async function readJson(filePath, label) {
  const resolved = path.resolve(ROOT, filePath);
  if (!(await fs.pathExists(resolved))) throw new Error(`${label} not found: ${resolved}`);
  return { path: resolved, data: await fs.readJson(resolved) };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  const frame = await readJson(args.frameReport, "frame report");
  const segment = await readJson(args.segmentReport, "segment report");
  const plan = buildFlashLaneFootageAcquisitionPlan({
    storyId: args.storyId,
    frameReport: frame.data,
    segmentValidationReport: segment.data,
  });
  plan.frame_report_source = frame.path;
  plan.segment_report_source = segment.path;
  const markdown = renderFlashLaneFootageAcquisitionMarkdown(plan);

  await fs.ensureDir(OUT);
  await fs.writeJson(path.join(OUT, "flash_lane_footage_acquisition_v1.json"), plan, {
    spaces: 2,
  });
  await fs.writeFile(path.join(OUT, "flash_lane_footage_acquisition_v1.md"), markdown, "utf8");
  process.stdout.write(args.json ? JSON.stringify(plan, null, 2) + "\n" : markdown);
  process.stderr.write("[flash-footage-acquisition] wrote test/output/flash_lane_footage_acquisition_v1.{json,md}\n");
}

main().catch((err) => {
  process.stderr.write(`[flash-footage-acquisition] ${err.stack || err.message}\n`);
  process.exit(1);
});

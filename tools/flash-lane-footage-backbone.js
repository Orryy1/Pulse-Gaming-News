#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

try {
  require("dotenv").config({ override: false });
} catch {}

const {
  buildFlashLaneFootageBackboneReport,
  renderFlashLaneFootageBackboneMarkdown,
} = require("../lib/studio/v2/flash-lane-footage-backbone");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_FRAME_REPORT = path.join(OUT, "controlled_frame_extraction_worker_apply_local.json");
const DEFAULT_SEGMENT_REPORT = path.join(OUT, "official_trailer_segment_validation_v1.json");

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    storyId: null,
    storyManifest: null,
    frameReport: DEFAULT_FRAME_REPORT,
    segmentReport: DEFAULT_SEGMENT_REPORT,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--story" || arg === "--story-id") args.storyId = argv[++i] || null;
    else if (arg === "--story-manifest") args.storyManifest = argv[++i] || null;
    else if (arg === "--frame-report") args.frameReport = argv[++i] || DEFAULT_FRAME_REPORT;
    else if (arg === "--segment-report") args.segmentReport = argv[++i] || DEFAULT_SEGMENT_REPORT;
    else if (arg === "--target-runtime") {
      throw new Error("--target-runtime is retired; provide --story-manifest with editorial metadata");
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/flash-lane-footage-backbone.js [options]",
      "",
      "Options:",
      "  --story-id <id>       Story id to inspect",
      "  --story-manifest <p>  Story JSON containing the editorial contract metadata",
      "  --frame-report <p>    Controlled frame extraction worker report",
      "  --segment-report <p>  Official trailer segment validation report",
      "  --json                Print JSON instead of Markdown",
      "",
      "This command is report-only. It decides whether a story has enough validated footage for a Flash Lane proof.",
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
  const storyManifest = args.storyManifest
    ? await readJson(args.storyManifest, "story manifest")
    : { path: null, data: { id: args.storyId } };
  const report = buildFlashLaneFootageBackboneReport({
    story: storyManifest.data,
    storyId: args.storyId,
    frameReport: frame.data,
    segmentValidationReport: segment.data,
  });
  report.frame_report_source = frame.path;
  report.segment_report_source = segment.path;
  report.story_manifest_source = storyManifest.path;

  const markdown = renderFlashLaneFootageBackboneMarkdown(report);
  await fs.ensureDir(OUT);
  await fs.writeJson(path.join(OUT, "flash_lane_footage_backbone_v1.json"), report, {
    spaces: 2,
  });
  await fs.writeFile(path.join(OUT, "flash_lane_footage_backbone_v1.md"), markdown, "utf8");
  process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : markdown);
  process.stderr.write("[footage-backbone] wrote test/output/flash_lane_footage_backbone_v1.{json,md}\n");
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[footage-backbone] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};

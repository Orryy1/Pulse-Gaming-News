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
const DEFAULT_PROOF_CANDIDATES = path.join(OUT, "studio_v2_proof_candidates.json");
const DEFAULT_LIMIT = 20;

function parsePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    storyId: null,
    frameReport: DEFAULT_FRAME_REPORT,
    segmentReport: DEFAULT_SEGMENT_REPORT,
    proofCandidates: DEFAULT_PROOF_CANDIDATES,
    limit: DEFAULT_LIMIT,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--story" || arg === "--story-id") args.storyId = argv[++i] || null;
    else if (arg === "--frame-report") args.frameReport = argv[++i] || DEFAULT_FRAME_REPORT;
    else if (arg === "--segment-report") args.segmentReport = argv[++i] || DEFAULT_SEGMENT_REPORT;
    else if (arg === "--proof-candidates") args.proofCandidates = argv[++i] || DEFAULT_PROOF_CANDIDATES;
    else if (arg === "--no-proof-candidates") args.proofCandidates = null;
    else if (arg === "--limit") args.limit = parsePositiveInteger(argv[++i], DEFAULT_LIMIT);
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
      "  --proof-candidates <p> Studio V2 proof candidate report for exact subject fallback",
      "  --no-proof-candidates Disable proof-candidate fallback",
      "  --limit <n>           Maximum proof-candidate stories to queue when --story-id is omitted",
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

async function readJsonIfExists(filePath, label) {
  if (!filePath) return null;
  const resolved = path.resolve(ROOT, filePath);
  if (!(await fs.pathExists(resolved))) {
    process.stderr.write(`[flash-footage-acquisition] optional ${label} not found: ${resolved}\n`);
    return null;
  }
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
  const proofCandidates = await readJsonIfExists(args.proofCandidates, "proof candidate report");
  const plan = buildFlashLaneFootageAcquisitionPlan({
    storyId: args.storyId,
    frameReport: frame.data,
    segmentValidationReport: segment.data,
    proofCandidateReport: proofCandidates?.data || null,
    limit: args.limit,
  });
  plan.frame_report_source = frame.path;
  plan.segment_report_source = segment.path;
  plan.proof_candidate_report_source = proofCandidates?.path || null;
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

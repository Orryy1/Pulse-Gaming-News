#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildFlashLaneCurrentStateReport,
  renderFlashLaneCurrentStateMarkdown,
} = require("../lib/ops/flash-lane-current-state");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

const DEFAULT_PROOF_CANDIDATES = path.join(OUT, "studio_v2_proof_candidates.json");
const DEFAULT_MOTION_GAP = path.join(OUT, "studio_v2_motion_gap.json");
const DEFAULT_FOOTAGE_ACQUISITION = path.join(OUT, "flash_lane_footage_acquisition_v1.json");
const DEFAULT_ALTERNATE_SOURCES = path.join(OUT, "alternate_official_source_handoff.json");
const DEFAULT_ROOT_REPORT = path.join(ROOT, "FLASH_LANE_CURRENT_STATE_REPORT.md");

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    storyId: null,
    limit: 20,
    proofCandidates: DEFAULT_PROOF_CANDIDATES,
    motionGap: DEFAULT_MOTION_GAP,
    footageAcquisition: DEFAULT_FOOTAGE_ACQUISITION,
    alternateSources: DEFAULT_ALTERNATE_SOURCES,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--story" || arg === "--story-id") args.storyId = argv[++i] || null;
    else if (arg === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 20);
    else if (arg === "--proof-candidates") args.proofCandidates = path.resolve(ROOT, argv[++i] || "");
    else if (arg === "--motion-gap") args.motionGap = path.resolve(ROOT, argv[++i] || "");
    else if (arg === "--footage-acquisition") args.footageAcquisition = path.resolve(ROOT, argv[++i] || "");
    else if (arg === "--alternate-sources") args.alternateSources = path.resolve(ROOT, argv[++i] || "");
    else if (arg === "--no-motion-gap") args.motionGap = null;
    else if (arg === "--no-footage-acquisition") args.footageAcquisition = null;
    else if (arg === "--no-alternate-sources") args.alternateSources = null;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/flash-lane-current-state.js [options]",
      "",
      "Options:",
      "  --story <id>                  Focus one story id",
      "  --limit <n>                   Limit inspected candidates",
      "  --proof-candidates <path>     Studio V2 proof candidate report",
      "  --motion-gap <path>           Studio V2 motion gap report",
      "  --footage-acquisition <path>  Flash Lane footage acquisition report",
      "  --alternate-sources <path>    Alternate official source handoff report",
      "  --no-motion-gap               Run without motion gap input",
      "  --no-footage-acquisition      Run without footage acquisition input",
      "  --no-alternate-sources        Run without alternate-source handoff input",
      "  --json                        Print JSON instead of Markdown",
      "",
      "Read-only/report-only. Does not download, render, call TTS, post, mutate DB, touch Railway or trigger OAuth.",
    ].join("\n") + "\n",
  );
}

async function readJsonIfExists(filePath, label, required = false) {
  if (!filePath) return {};
  const resolved = path.resolve(ROOT, filePath);
  if (!(await fs.pathExists(resolved))) {
    if (required) throw new Error(`${label} not found: ${resolved}`);
    process.stderr.write(`[flash-state] optional ${label} not found: ${resolved}\n`);
    return {};
  }
  return fs.readJson(resolved);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const proofCandidateReport = await readJsonIfExists(args.proofCandidates, "proof candidate report", true);
  const motionGapReport = await readJsonIfExists(args.motionGap, "motion gap report");
  const footageAcquisitionReport = await readJsonIfExists(args.footageAcquisition, "footage acquisition report");
  const alternateSourceReport = await readJsonIfExists(args.alternateSources, "alternate source report");

  const report = buildFlashLaneCurrentStateReport({
    proofCandidateReport,
    motionGapReport,
    footageAcquisitionReport,
    alternateSourceReport,
    storyId: args.storyId,
    limit: args.limit,
  });
  const markdown = renderFlashLaneCurrentStateMarkdown(report);

  await fs.ensureDir(OUT);
  const jsonPath = path.join(OUT, "flash_lane_current_state.json");
  const mdPath = path.join(OUT, "flash_lane_current_state.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");
  await fs.writeFile(DEFAULT_ROOT_REPORT, markdown, "utf8");

  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : markdown);
  process.stderr.write(
    `[flash-state] wrote ${path.relative(ROOT, jsonPath).replace(/\\/g, "/")}, ${path.relative(
      ROOT,
      mdPath,
    ).replace(/\\/g, "/")} and ${path.relative(ROOT, DEFAULT_ROOT_REPORT).replace(/\\/g, "/")}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[flash-state] ${err.stack || err.message}\n`);
  process.exit(1);
});

#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildStudioV2MotionGapReport,
  renderStudioV2MotionGapMarkdown,
} = require("../lib/ops/studio-v2-motion-gap");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

const DEFAULT_PROOF_CANDIDATES = path.join(OUT, "studio_v2_proof_candidates.json");
const DEFAULT_SEGMENT_REPORT = path.join(OUT, "official_trailer_segment_validation_apply_local.json");
const DEFAULT_ROOT_REPORT = path.join(ROOT, "MOTION_ACQUISITION_OVERNIGHT_REPORT.md");

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    storyId: null,
    limit: 10,
    proofCandidates: DEFAULT_PROOF_CANDIDATES,
    segmentReport: DEFAULT_SEGMENT_REPORT,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--story" || arg === "--story-id") args.storyId = argv[++i] || null;
    else if (arg === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 10);
    else if (arg === "--proof-candidates") args.proofCandidates = path.resolve(ROOT, argv[++i] || "");
    else if (arg === "--segment-report") args.segmentReport = path.resolve(ROOT, argv[++i] || "");
    else if (arg === "--no-segment-report") args.segmentReport = null;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/studio-v2-motion-gap.js [options]",
      "",
      "Options:",
      "  --story <id>                 Focus one story id",
      "  --limit <n>                  Limit inspected candidates",
      "  --proof-candidates <path>    studio_v2_proof_candidates.json path",
      "  --segment-report <path>      trailer segment validation report path",
      "  --no-segment-report          Run without segment rejection detail",
      "  --json                       Print JSON instead of Markdown",
      "",
      "Read-only/report-only. Does not render, call TTS, post, mutate the DB or touch Railway.",
    ].join("\n") + "\n",
  );
}

async function readJsonIfExists(filePath, label, required = false) {
  if (!filePath) return null;
  const resolved = path.resolve(ROOT, filePath);
  if (!(await fs.pathExists(resolved))) {
    if (required) throw new Error(`${label} not found: ${resolved}`);
    return null;
  }
  return fs.readJson(resolved);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const proofCandidateReport = await readJsonIfExists(
    args.proofCandidates,
    "proof candidate report",
    true,
  );
  const segmentValidationReport = await readJsonIfExists(args.segmentReport, "segment report", false);
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport,
    segmentValidationReport,
    storyId: args.storyId,
    limit: args.limit,
  });
  const markdown = renderStudioV2MotionGapMarkdown(report);

  await fs.ensureDir(OUT);
  const jsonPath = path.join(OUT, "studio_v2_motion_gap.json");
  const mdPath = path.join(OUT, "studio_v2_motion_gap.md");
  const aliasJsonPath = path.join(OUT, "motion_gap_report.json");
  const aliasMdPath = path.join(OUT, "motion_gap_report.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");
  await fs.writeJson(aliasJsonPath, report, { spaces: 2 });
  await fs.writeFile(aliasMdPath, markdown, "utf8");
  await fs.writeFile(DEFAULT_ROOT_REPORT, markdown, "utf8");

  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : markdown);
  process.stderr.write(
    `[motion-gap] wrote ${path.relative(ROOT, jsonPath).replace(/\\/g, "/")} and ${path.relative(ROOT, mdPath).replace(/\\/g, "/")}\n`,
  );
  process.stderr.write(
    `[motion-gap] wrote ${path.relative(ROOT, aliasJsonPath).replace(/\\/g, "/")}, ${path.relative(ROOT, aliasMdPath).replace(/\\/g, "/")} and ${path.relative(ROOT, DEFAULT_ROOT_REPORT).replace(/\\/g, "/")}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[motion-gap] ${err.stack || err.message}\n`);
  process.exit(1);
});

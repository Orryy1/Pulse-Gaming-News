#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildVisualEvidenceRepairPlan,
  renderVisualEvidenceRepairMarkdown,
} = require("../lib/ops/visual-evidence-repair-planner");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_FLASH_STATE = path.join(OUT, "flash_lane_current_state.json");
const DEFAULT_PROOF_CANDIDATES = path.join(OUT, "studio_v2_proof_candidates.json");
const DEFAULT_MOTION_GAP = path.join(OUT, "studio_v2_motion_gap.json");
const DEFAULT_ROOT_REPORT = path.join(ROOT, "VISUAL_EVIDENCE_REPAIR_PLAN.md");
const DEFAULT_MEDIA_ROOT_REPORT = path.join(ROOT, "STUDIO_V2_MEDIA_REPAIR_ACTION_PLAN.md");

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    limit: 20,
    testOutputOnly: false,
    flashState: DEFAULT_FLASH_STATE,
    proofCandidates: DEFAULT_PROOF_CANDIDATES,
    motionGapReport: DEFAULT_MOTION_GAP,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--test-output-only") args.testOutputOnly = true;
    else if (arg === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 20);
    else if (arg === "--flash-state") args.flashState = path.resolve(ROOT, argv[++i] || "");
    else if (arg === "--no-flash-state") args.flashState = null;
    else if (arg === "--proof-candidates") args.proofCandidates = path.resolve(ROOT, argv[++i] || "");
    else if (arg === "--no-proof-candidates") args.proofCandidates = null;
    else if (arg === "--motion-gap-report") args.motionGapReport = path.resolve(ROOT, argv[++i] || "");
    else if (arg === "--no-motion-gap") args.motionGapReport = null;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/visual-evidence-repair-planner.js [options]",
      "",
      "Options:",
      "  --flash-state <path>     Flash Lane current-state report",
      "  --proof-candidates <p>   Studio V2 proof-candidate report",
      "  --motion-gap-report <p>  Studio V2 motion-gap report",
      "  --no-flash-state         Run without Flash Lane current-state input",
      "  --no-proof-candidates    Run without proof-candidate input",
      "  --no-motion-gap          Run without motion-gap input",
      "  --limit <n>              Limit inspected rows",
      "  --json                   Print JSON instead of Markdown",
      "  --test-output-only       Write only under test/output; skip root Markdown reports",
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

  const currentStateReport = await readJsonIfExists(args.flashState, "Flash Lane current-state report", false);
  const proofCandidateReport = await readJsonIfExists(args.proofCandidates, "Studio V2 proof-candidate report", false);
  const motionGapReport = await readJsonIfExists(args.motionGapReport, "Studio V2 motion-gap report", false);
  if (!currentStateReport.rows && !proofCandidateReport.candidates) {
    throw new Error("No planner input found; provide --flash-state or --proof-candidates");
  }
  const report = buildVisualEvidenceRepairPlan({
    currentStateReport,
    proofCandidateReport,
    motionGapReport,
    limit: args.limit,
  });
  const markdown = renderVisualEvidenceRepairMarkdown(report);

  await fs.ensureDir(OUT);
  const jsonPath = path.join(OUT, "visual_evidence_repair_plan.json");
  const mdPath = path.join(OUT, "visual_evidence_repair_plan.md");
  const mediaJsonPath = path.join(OUT, "studio_v2_media_repair_action_plan.json");
  const mediaMdPath = path.join(OUT, "studio_v2_media_repair_action_plan.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");
  await fs.writeJson(mediaJsonPath, report, { spaces: 2 });
  await fs.writeFile(mediaMdPath, markdown, "utf8");
  if (!args.testOutputOnly) {
    await fs.writeFile(DEFAULT_ROOT_REPORT, markdown, "utf8");
    await fs.writeFile(DEFAULT_MEDIA_ROOT_REPORT, markdown, "utf8");
  }

  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : markdown);
  const written = [jsonPath, mdPath, mediaJsonPath, mediaMdPath];
  if (!args.testOutputOnly) written.push(DEFAULT_ROOT_REPORT, DEFAULT_MEDIA_ROOT_REPORT);
  process.stderr.write(
    `[visual-repair] wrote ${written.map((item) => path.relative(ROOT, item).replace(/\\/g, "/")).join(", ")}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[visual-repair] ${err.stack || err.message}\n`);
  process.exit(1);
});

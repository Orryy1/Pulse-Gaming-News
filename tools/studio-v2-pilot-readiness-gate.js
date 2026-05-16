#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildStudioV2PilotReadinessGate,
  renderStudioV2PilotReadinessMarkdown,
} = require("../lib/ops/studio-v2-pilot-readiness-gate");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_PROOF_CANDIDATES = path.join(OUT, "studio_v2_proof_candidates.json");
const DEFAULT_PROMOTION_PACKET = path.join(
  OUT,
  "studio-v2-promotion",
  "studio_v2_overnight_promotion_packet.json",
);
const DEFAULT_MOTION_GAP = path.join(OUT, "studio_v2_motion_gap.json");
const DEFAULT_VISUAL_REPAIR = path.join(OUT, "studio_v2_media_repair_action_plan.json");
const DEFAULT_ROOT_REPORT = path.join(ROOT, "STUDIO_V2_PILOT_READINESS_GATE.md");

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    stdoutOnly: false,
    testOutputOnly: false,
    outputDir: OUT,
    proofCandidates: DEFAULT_PROOF_CANDIDATES,
    promotionPacket: DEFAULT_PROMOTION_PACKET,
    motionGap: DEFAULT_MOTION_GAP,
    visualRepair: DEFAULT_VISUAL_REPAIR,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--stdout-only") args.stdoutOnly = true;
    else if (arg === "--test-output-only") args.testOutputOnly = true;
    else if (arg === "--output-dir") args.outputDir = path.resolve(ROOT, argv[++i] || "");
    else if (arg === "--proof-candidates") args.proofCandidates = path.resolve(ROOT, argv[++i] || "");
    else if (arg === "--no-proof-candidates") args.proofCandidates = null;
    else if (arg === "--promotion-packet") args.promotionPacket = path.resolve(ROOT, argv[++i] || "");
    else if (arg === "--no-promotion-packet") args.promotionPacket = null;
    else if (arg === "--motion-gap") args.motionGap = path.resolve(ROOT, argv[++i] || "");
    else if (arg === "--no-motion-gap") args.motionGap = null;
    else if (arg === "--visual-repair") args.visualRepair = path.resolve(ROOT, argv[++i] || "");
    else if (arg === "--no-visual-repair") args.visualRepair = null;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/studio-v2-pilot-readiness-gate.js [options]",
      "",
      "Options:",
      "  --proof-candidates <path>  Studio V2 proof-candidate report",
      "  --promotion-packet <path>  Studio V2 promotion packet JSON",
      "  --motion-gap <path>        Studio V2 motion-gap report",
      "  --visual-repair <path>     Studio V2 visual repair report",
      "  --output-dir <path>        Output directory, default test/output",
      "  --test-output-only         Skip root Markdown report",
      "  --stdout-only              Print only; do not write reports",
      "  --json                     Print JSON instead of Markdown",
      "",
      "read-only/report-only. Does not render, call TTS, post, deploy, mutate DB, touch Railway, trigger OAuth or switch renderer defaults.",
    ].join("\n") + "\n",
  );
}

async function readJsonIfExists(filePath, label) {
  if (!filePath) return {};
  const resolved = path.resolve(ROOT, filePath);
  if (!(await fs.pathExists(resolved))) return {};
  try {
    return await fs.readJson(resolved);
  } catch (err) {
    process.stderr.write(`[pilot-readiness] skipped unreadable ${label}: ${err.message}\n`);
    return {};
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const [proofCandidateReport, promotionPacket, motionGapReport, visualRepairReport] =
    await Promise.all([
      readJsonIfExists(args.proofCandidates, "proof candidates"),
      readJsonIfExists(args.promotionPacket, "promotion packet"),
      readJsonIfExists(args.motionGap, "motion gap"),
      readJsonIfExists(args.visualRepair, "visual repair"),
    ]);

  const report = buildStudioV2PilotReadinessGate({
    promotionPacket,
    proofCandidateReport,
    motionGapReport,
    visualRepairReport,
  });
  const markdown = renderStudioV2PilotReadinessMarkdown(report);

  const jsonPath = path.join(args.outputDir, "studio_v2_pilot_readiness_gate.json");
  const mdPath = path.join(args.outputDir, "studio_v2_pilot_readiness_gate.md");
  if (!args.stdoutOnly) {
    await fs.ensureDir(args.outputDir);
    await fs.writeJson(jsonPath, report, { spaces: 2 });
    await fs.writeFile(mdPath, markdown, "utf8");
    if (!args.testOutputOnly) await fs.writeFile(DEFAULT_ROOT_REPORT, markdown, "utf8");
  }

  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : markdown);
  if (args.stdoutOnly) {
    process.stderr.write("[pilot-readiness] stdout-only; no files written\n");
  } else {
    const written = [jsonPath, mdPath];
    if (!args.testOutputOnly) written.push(DEFAULT_ROOT_REPORT);
    process.stderr.write(
      `[pilot-readiness] wrote ${written.map((item) => path.relative(ROOT, item).replace(/\\/g, "/")).join(", ")}\n`,
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[pilot-readiness] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
};

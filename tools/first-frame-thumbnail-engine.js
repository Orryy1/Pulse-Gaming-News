#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ quiet: true });

const {
  buildFirstFrameThumbnailReport,
  formatFirstFrameThumbnailMarkdown,
} = require("../lib/ops/first-frame-thumbnail-engine");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "output", "first-frame-thumbnail");

function parseArgs(argv) {
  const args = {
    json: false,
    help: false,
    outDir: DEFAULT_OUT,
    storyId: null,
    candidateReportPath: path.join(ROOT, "output", "normal-operations", "fresh_candidate_queue.json"),
    dryRunPlanPath: path.join(ROOT, "output", "goal-contract", "dry_run_publish_plan.json"),
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--story-id") args.storyId = argv[++i] || null;
    else if (arg.startsWith("--story-id=")) args.storyId = arg.slice("--story-id=".length) || null;
    else if (arg === "--out-dir") args.outDir = path.resolve(ROOT, argv[++i] || args.outDir);
    else if (arg.startsWith("--out-dir=")) args.outDir = path.resolve(ROOT, arg.slice("--out-dir=".length));
    else if (arg === "--candidate-report") args.candidateReportPath = path.resolve(ROOT, argv[++i] || args.candidateReportPath);
    else if (arg.startsWith("--candidate-report=")) args.candidateReportPath = path.resolve(ROOT, arg.slice("--candidate-report=".length));
    else if (arg === "--dry-run-plan") args.dryRunPlanPath = path.resolve(ROOT, argv[++i] || args.dryRunPlanPath);
    else if (arg.startsWith("--dry-run-plan=")) args.dryRunPlanPath = path.resolve(ROOT, arg.slice("--dry-run-plan=".length));
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    "Usage: node tools/first-frame-thumbnail-engine.js [--json] [--story-id ID]\n" +
      "Read-only first-frame, cover and mobile readability report.\n",
  );
}

async function readJsonIfExists(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

async function readCanonicalManifest(storyId) {
  const filePath = path.join(
    ROOT,
    "output",
    "goal-proof",
    "batch",
    storyId,
    "canonical_story_manifest.json",
  );
  return readJsonIfExists(filePath, {});
}

async function loadInputs(args) {
  const candidateReport = await readJsonIfExists(args.candidateReportPath, {});
  const dryRunPlan = await readJsonIfExists(args.dryRunPlanPath, {});
  const rawCandidates = Array.isArray(candidateReport.candidates)
    ? candidateReport.candidates
    : [];
  const candidates = args.storyId
    ? rawCandidates.filter((candidate) => candidate.id === args.storyId)
    : rawCandidates;
  const actions = Array.isArray(dryRunPlan.actions)
    ? dryRunPlan.actions.filter((action) => {
        if (!args.storyId) return true;
        return action.story_id === args.storyId;
      })
    : [];
  const canonicalManifests = {};
  for (const candidate of candidates) {
    if (!candidate?.id) continue;
    canonicalManifests[candidate.id] = await readCanonicalManifest(candidate.id);
  }
  return { candidates, actions, canonicalManifests };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const inputs = await loadInputs(args);
  const report = buildFirstFrameThumbnailReport(inputs);
  const markdown = formatFirstFrameThumbnailMarkdown(report);

  await fs.ensureDir(args.outDir);
  await Promise.all([
    fs.writeJson(path.join(args.outDir, "first_frame_thumbnail_report.json"), report, { spaces: 2 }),
    fs.writeFile(path.join(args.outDir, "first_frame_thumbnail_report.md"), markdown, "utf8"),
    fs.writeJson(path.join(args.outDir, "platform_cover_matrix.json"), report.platform_cover_matrix, { spaces: 2 }),
    fs.writeJson(path.join(args.outDir, "first_frame_repair_backlog.json"), report.repair_backlog, { spaces: 2 }),
  ]);

  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(markdown);
    process.stderr.write(`[first-frame-thumbnail] out=${path.relative(ROOT, args.outDir)}\n`);
  }

  if (report.verdict === "red") process.exitCode = 2;
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[first-frame-thumbnail] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  loadInputs,
  parseArgs,
};

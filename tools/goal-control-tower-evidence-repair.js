#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  repairGoalControlTowerEvidence,
} = require("../lib/goal-control-tower-evidence-repair");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    goal16ReportPath: "",
    landingManifestPath: "",
    goal17ReportPath: "",
    platformPolicyReportPath: "",
    outDir: path.join(ROOT, "output", "goal-contract"),
    backupRoot: path.join(ROOT, "output", "goal-contract", "control-tower-evidence-repair-backups"),
    storyIds: [],
    generatedAt: null,
    apply: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++i] || args.storyPackagesPath;
    else if (arg === "--goal16-report") args.goal16ReportPath = argv[++i] || "";
    else if (arg === "--landing-manifest") args.landingManifestPath = argv[++i] || "";
    else if (arg === "--goal17-report") args.goal17ReportPath = argv[++i] || "";
    else if (arg === "--platform-policy-report") args.platformPolicyReportPath = argv[++i] || "";
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--backup-root") args.backupRoot = argv[++i] || args.backupRoot;
    else if (arg === "--story-id") args.storyIds.push(argv[++i] || "");
    else if (arg === "--story-ids") args.storyIds.push(...String(argv[++i] || "").split(","));
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  args.storyIds = args.storyIds.map((id) => String(id || "").trim()).filter(Boolean);
  return args;
}

function usage() {
  return [
    "Usage: node tools/goal-control-tower-evidence-repair.js [options]",
    "",
    "Promotes passed local Goal16/17 proof into per-package control-tower artefacts.",
    "Default mode is dry-run. Use --apply to rewrite local artefact files with backups.",
    "",
    "Options:",
    "  --story-packages <path>",
    "  --story-id <id>                 Limit repair to a single story; repeatable",
    "  --story-ids <csv>               Limit repair to a comma-separated story list",
    "  --goal16-report <path>",
    "  --landing-manifest <path>",
    "  --goal17-report <path>",
    "  --platform-policy-report <path>",
    "  --out-dir <dir>",
    "  --backup-root <dir>",
    "  --generated-at <iso>",
    "  --apply",
    "  --json",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback = {}) {
  const resolved = filePath ? path.resolve(filePath) : "";
  if (!resolved || !(await fs.pathExists(resolved))) return fallback;
  return fs.readJson(resolved);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const storyPackagesPath = path.resolve(args.storyPackagesPath);
  let storyPackages = await fs.readJson(storyPackagesPath);
  if (!Array.isArray(storyPackages)) throw new Error(`story package file is not an array: ${storyPackagesPath}`);
  const requestedStoryIds = new Set(args.storyIds);
  if (requestedStoryIds.size) {
    storyPackages = storyPackages.filter((entry) =>
      requestedStoryIds.has(String(entry?.story_id || entry?.id || "").trim()),
    );
    if (!storyPackages.length) {
      throw new Error(`requested story id not found in story package file: ${Array.from(requestedStoryIds).join(",")}`);
    }
  }

  const generatedAt = args.generatedAt || new Date().toISOString();
  const [goal16Report, landingManifestReport, goal17Report, platformPolicyReport] = await Promise.all([
    readJsonIfPresent(args.goal16ReportPath, {}),
    readJsonIfPresent(args.landingManifestPath, {}),
    readJsonIfPresent(args.goal17ReportPath, {}),
    readJsonIfPresent(args.platformPolicyReportPath, {}),
  ]);
  const report = await repairGoalControlTowerEvidence({
    storyPackages,
    goal16Report,
    landingManifestReport,
    goal17Report,
    platformPolicyReport,
    generatedAt,
    apply: args.apply,
    backupRoot: args.backupRoot,
  });
  const outDir = path.resolve(args.outDir);
  await fs.ensureDir(outDir);
  const reportPath = path.join(outDir, args.apply
    ? "control_tower_evidence_repair_report.json"
    : "control_tower_evidence_repair_dry_run.json");
  await fs.writeJson(reportPath, report, { spaces: 2 });
  if (args.json) console.log(JSON.stringify({ report, reportPath }, null, 2));
  else {
    console.log(`Control-tower evidence repair: ${report.summary.repaired_count}/${report.summary.repairable_count} repaired`);
    console.log(`Report: ${reportPath}`);
    console.log("Safety: local artefacts only; no publish, DB mutation, OAuth/token changes, or gate weakening.");
  }
  return { report, reportPath };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal-control-tower-evidence-repair] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};

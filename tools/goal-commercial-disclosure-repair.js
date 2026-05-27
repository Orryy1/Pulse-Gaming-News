#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  repairGoalCommercialDisclosure,
  renderGoalCommercialDisclosureRepairMarkdown,
  writeGoalCommercialDisclosureRepairReport,
} = require("../lib/goal-commercial-disclosure-repair");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    workOrderPath: "",
    outDir: path.join(ROOT, "output", "goal-contract"),
    generatedAt: null,
    backupRoot: "",
    apply: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++i] || args.storyPackagesPath;
    else if (arg === "--work-order") args.workOrderPath = argv[++i] || "";
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--backup-root") args.backupRoot = argv[++i] || "";
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-commercial-disclosure-repair -- [options]",
    "",
    "Options:",
    "  --story-packages <path>  Story package list JSON",
    "  --work-order <path>      Optional render input work order JSON to scope repair jobs",
    "  --out-dir <dir>          Output directory for the repair report",
    "  --generated-at <iso>     Fixed timestamp for deterministic reports",
    "  --backup-root <dir>      Backup root used in apply mode",
    "  --apply                  Edit local artefacts with backups",
    "  --json                   Print JSON report",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback = null) {
  if (!filePath) return fallback;
  const resolved = path.resolve(filePath);
  if (!(await fs.pathExists(resolved))) return fallback;
  return fs.readJson(resolved);
}

function packagesFromWorkOrder(workOrder = {}) {
  return (Array.isArray(workOrder?.jobs) ? workOrder.jobs : [])
    .filter((job) =>
      (Array.isArray(job.actions) ? job.actions : []).some(
        (action) => action.action_id === "repair_commercial_disclosure_evidence",
      ),
    )
    .map((job) => ({
      story_id: job.story_id,
      artifact_dir: job.artifact_dir,
    }))
    .filter((item) => item.story_id && item.artifact_dir);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const storyPackages = await readJsonIfPresent(args.storyPackagesPath, []);
  const workOrder = await readJsonIfPresent(args.workOrderPath, null);
  const scopedPackages = workOrder ? packagesFromWorkOrder(workOrder) : storyPackages;
  const report = await repairGoalCommercialDisclosure({
    storyPackages: scopedPackages,
    generatedAt: args.generatedAt || new Date().toISOString(),
    apply: args.apply,
    backupRoot: args.backupRoot,
  });
  const written = await writeGoalCommercialDisclosureRepairReport(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoalCommercialDisclosureRepairMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal-commercial-disclosure-repair] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

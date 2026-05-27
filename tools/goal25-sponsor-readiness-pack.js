#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildGoal25SponsorReadinessPack,
  renderGoal25SponsorReadinessMarkdown,
  writeGoal25SponsorReadinessPack,
} = require("../lib/goal25-sponsor-readiness-pack");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    upstreamCorrectionsReportPath: path.join(ROOT, "output", "goal-24", "goal24_readiness_report.json"),
    performanceSnapshotPath: path.join(ROOT, "output", "goal-25", "sponsor_performance_snapshot.json"),
    outDir: path.join(ROOT, "output", "goal-25"),
    workspaceRoot: ROOT,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--upstream-corrections-report") args.upstreamCorrectionsReportPath = argv[++index] || args.upstreamCorrectionsReportPath;
    else if (arg === "--performance-snapshot") args.performanceSnapshotPath = argv[++index] || args.performanceSnapshotPath;
    else if (arg === "--out-dir") args.outDir = argv[++index] || args.outDir;
    else if (arg === "--workspace") args.workspaceRoot = argv[++index] || args.workspaceRoot;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal25-sponsor-readiness-pack -- [options]",
    "",
    "Options:",
    "  --story-packages <path>              Story package manifest",
    "  --upstream-corrections-report <path> Goal 24 readiness report",
    "  --performance-snapshot <path>        Verified sponsor performance metrics",
    "  --out-dir <dir>                      Output directory for Goal 25 proof",
    "  --workspace <dir>                    Workspace root for relative package paths",
    "  --generated-at <iso>                 Fixed timestamp for deterministic reports",
    "  --json                               Print JSON report",
    "",
    "LOCAL_PROOF only. This command compiles media kit, pitch pack and brand-safety draft artefacts. It does not contact sponsors, quote public pricing, post externally, mutate production rows or change OAuth/token state.",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const storyPackages = await readJsonIfPresent(path.resolve(args.storyPackagesPath), []);
  const upstreamCorrectionsReport = await readJsonIfPresent(path.resolve(args.upstreamCorrectionsReportPath), {});
  const performanceSnapshot = await readJsonIfPresent(path.resolve(args.performanceSnapshotPath), {});
  const report = await buildGoal25SponsorReadinessPack({
    storyPackages,
    upstreamCorrectionsReport,
    performanceSnapshot,
    workspaceRoot: path.resolve(args.workspaceRoot),
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeGoal25SponsorReadinessPack(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoal25SponsorReadinessMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal25-sponsor-readiness-pack] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

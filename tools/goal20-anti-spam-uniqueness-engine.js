#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true });
}

const {
  buildGoal20AntiSpamUniquenessEngine,
  renderGoal20AntiSpamUniquenessMarkdown,
  writeGoal20AntiSpamUniquenessEngine,
} = require("../lib/goal20-anti-spam-uniqueness-engine");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    upstreamControlTowerReportPath: path.join(ROOT, "output", "goal-19", "goal19_readiness_report.json"),
    upstreamSocialDerivativesReportPath: path.join(ROOT, "output", "goal-14", "goal14_readiness_report.json"),
    outDir: path.join(ROOT, "output", "goal-20"),
    workspaceRoot: ROOT,
    generatedAt: null,
    deferDuplicateCandidates: true,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--upstream-control-tower-report") args.upstreamControlTowerReportPath = argv[++index] || args.upstreamControlTowerReportPath;
    else if (arg === "--upstream-social-derivatives-report") args.upstreamSocialDerivativesReportPath = argv[++index] || args.upstreamSocialDerivativesReportPath;
    else if (arg === "--out-dir") args.outDir = argv[++index] || args.outDir;
    else if (arg === "--workspace") args.workspaceRoot = argv[++index] || args.workspaceRoot;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg === "--defer-duplicate-candidates") args.deferDuplicateCandidates = true;
    else if (arg === "--no-defer-duplicate-candidates") args.deferDuplicateCandidates = false;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal20-anti-spam-uniqueness -- [options]",
    "",
    "Options:",
    "  --story-packages <path>                 Story package manifest",
    "  --upstream-control-tower-report <path>  Goal 19 readiness report",
    "  --upstream-social-derivatives-report <path>  Goal 14 social derivative report",
    "  --out-dir <dir>                         Output directory for Goal 20 proof",
    "  --workspace <dir>                       Workspace root for relative package paths",
    "  --generated-at <iso>                    Fixed timestamp for deterministic reports",
    "  --defer-duplicate-candidates            Defer duplicate candidates out of the active publish set (default)",
    "  --no-defer-duplicate-candidates         Report duplicate candidates as active blockers",
    "  --json                                  Print JSON report",
    "",
    "LOCAL_PROOF only. This command checks repeated titles, thumbnails, openers, CTAs, footage, layouts, transitions, SFX, affiliate offers, post structures, X/Threads copy and Instagram carousel formats. It does not publish, post externally, mutate production rows, touch OAuth/token settings or inspect secrets.",
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
  const upstreamControlTowerReport = await readJsonIfPresent(path.resolve(args.upstreamControlTowerReportPath), {});
  const upstreamSocialDerivativesReport = await readJsonIfPresent(path.resolve(args.upstreamSocialDerivativesReportPath), {});
  const report = await buildGoal20AntiSpamUniquenessEngine({
    storyPackages,
    upstreamControlTowerReport,
    upstreamSocialDerivativesReport,
    deferDuplicateCandidates: args.deferDuplicateCandidates,
    workspaceRoot: path.resolve(args.workspaceRoot),
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeGoal20AntiSpamUniquenessEngine(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoal20AntiSpamUniquenessMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal20-anti-spam-uniqueness-engine] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

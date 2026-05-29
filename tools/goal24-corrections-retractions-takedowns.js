#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildSourceStatusReportFromStoryPackages,
  buildGoal24CorrectionsRetractionsTakedowns,
  renderGoal24CorrectionsRetractionsTakedownsMarkdown,
  writeGoal24CorrectionsRetractionsTakedowns,
} = require("../lib/goal24-corrections-retractions-takedowns");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    upstreamSecurityReportPath: path.join(ROOT, "output", "goal-23", "goal23_readiness_report.json"),
    sourceStatusReportPath: path.join(ROOT, "output", "goal-24", "source_status_report.json"),
    outDir: path.join(ROOT, "output", "goal-24"),
    workspaceRoot: ROOT,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--upstream-security-report") args.upstreamSecurityReportPath = argv[++index] || args.upstreamSecurityReportPath;
    else if (arg === "--source-status-report") args.sourceStatusReportPath = argv[++index] || args.sourceStatusReportPath;
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
    "Usage: npm run ops:goal24-corrections-retractions-takedowns -- [options]",
    "",
    "Options:",
    "  --story-packages <path>            Story package manifest",
    "  --upstream-security-report <path>  Goal 23 readiness report",
    "  --source-status-report <path>      Current source status signal report",
    "  --out-dir <dir>                    Output directory for Goal 24 proof",
    "  --workspace <dir>                  Workspace root for relative package paths",
    "  --generated-at <iso>               Fixed timestamp for deterministic reports",
    "  --json                             Print JSON report",
    "",
    "LOCAL_PROOF only. This command compiles draft correction, affected-content and takedown response artefacts. It does not edit descriptions, post pinned comments, unlist, delete, disable affiliate links, mutate production rows or call platform APIs.",
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
  const upstreamSecurityReport = await readJsonIfPresent(path.resolve(args.upstreamSecurityReportPath), {});
  const resolvedSourceStatusPath = path.resolve(args.sourceStatusReportPath);
  const sourceStatusReport = await fs.pathExists(resolvedSourceStatusPath)
    ? await readJsonIfPresent(resolvedSourceStatusPath, {})
    : await buildSourceStatusReportFromStoryPackages({
      storyPackages,
      upstreamSecurityReport,
      workspaceRoot: path.resolve(args.workspaceRoot),
      generatedAt: args.generatedAt || new Date().toISOString(),
    });
  if (!(await fs.pathExists(resolvedSourceStatusPath))) {
    await fs.outputJson(resolvedSourceStatusPath, sourceStatusReport, { spaces: 2 });
  }
  const report = await buildGoal24CorrectionsRetractionsTakedowns({
    storyPackages,
    upstreamSecurityReport,
    sourceStatusReport,
    workspaceRoot: path.resolve(args.workspaceRoot),
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeGoal24CorrectionsRetractionsTakedowns(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoal24CorrectionsRetractionsTakedownsMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal24-corrections-retractions-takedowns] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

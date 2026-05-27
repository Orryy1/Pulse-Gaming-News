#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true });
}

const {
  buildGoal12ExperimentationEngine,
  renderGoal12ExperimentationEngineMarkdown,
  writeGoal12ExperimentationEngine,
} = require("../lib/goal12-experimentation-engine");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    upstreamRetentionReportPath: path.join(ROOT, "output", "goal-11", "goal11_readiness_report.json"),
    futureRenderRecommendationsPath: path.join(ROOT, "output", "goal-11", "future_render_recommendations.json"),
    variantMetricsPath: path.join(ROOT, "output", "analytics", "experiment_variant_metrics.json"),
    outDir: path.join(ROOT, "output", "goal-12"),
    workspaceRoot: ROOT,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--upstream-retention-report") args.upstreamRetentionReportPath = argv[++index] || args.upstreamRetentionReportPath;
    else if (arg === "--future-render-recommendations") args.futureRenderRecommendationsPath = argv[++index] || args.futureRenderRecommendationsPath;
    else if (arg === "--variant-metrics") args.variantMetricsPath = argv[++index] || args.variantMetricsPath;
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
    "Usage: npm run ops:goal12-experimentation-engine -- [options]",
    "",
    "Options:",
    "  --story-packages <path>                 Story package manifest",
    "  --upstream-retention-report <path>      Goal 11 readiness report",
    "  --future-render-recommendations <path>  Goal 11 future render recommendations",
    "  --variant-metrics <path>                Local read-only variant metrics manifest",
    "  --out-dir <dir>                         Output directory for Goal 12 proof",
    "  --workspace <dir>                       Workspace root for relative package paths",
    "  --generated-at <iso>                    Fixed timestamp for deterministic reports",
    "  --json                                  Print JSON report",
    "",
    "LOCAL_PROOF only. This command creates deterministic experiment plans and scores local metrics. It does not randomise audiences, publish, swap titles, mutate DB rows or touch OAuth/token settings.",
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
  const upstreamRetentionReport = await readJsonIfPresent(path.resolve(args.upstreamRetentionReportPath), {});
  const futureRenderRecommendations = await readJsonIfPresent(path.resolve(args.futureRenderRecommendationsPath), {});
  const variantMetricsManifest = await readJsonIfPresent(path.resolve(args.variantMetricsPath), { stories: [] });
  const report = await buildGoal12ExperimentationEngine({
    storyPackages,
    upstreamRetentionReport,
    futureRenderRecommendations,
    variantMetricsManifest,
    workspaceRoot: path.resolve(args.workspaceRoot),
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeGoal12ExperimentationEngine(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoal12ExperimentationEngineMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal12-experimentation-engine] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

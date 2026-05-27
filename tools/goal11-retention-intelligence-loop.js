#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true });
}

const {
  buildGoal11RetentionIntelligenceLoop,
  renderGoal11RetentionIntelligenceLoopMarkdown,
  writeGoal11RetentionIntelligenceLoop,
} = require("../lib/goal11-retention-intelligence-loop");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    upstreamBenchmarkReportPath: path.join(ROOT, "output", "goal-10", "goal10_readiness_report.json"),
    metricsPath: path.join(ROOT, "output", "analytics", "retention_metrics.json"),
    outDir: path.join(ROOT, "output", "goal-11"),
    workspaceRoot: ROOT,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--upstream-benchmark-report") args.upstreamBenchmarkReportPath = argv[++index] || args.upstreamBenchmarkReportPath;
    else if (arg === "--metrics") args.metricsPath = argv[++index] || args.metricsPath;
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
    "Usage: npm run ops:goal11-retention-intelligence -- [options]",
    "",
    "Options:",
    "  --story-packages <path>             Story package manifest",
    "  --upstream-benchmark-report <path>  Goal 10 readiness report",
    "  --metrics <path>                    Local read-only retention metrics manifest",
    "  --out-dir <dir>                     Output directory for Goal 11 proof",
    "  --workspace <dir>                   Workspace root for relative package paths",
    "  --generated-at <iso>                Fixed timestamp for deterministic reports",
    "  --json                              Print JSON report",
    "",
    "LOCAL_PROOF only. This command reads local package evidence and an optional local metrics manifest. It does not call analytics APIs, publish, post, mutate DB rows or touch OAuth/token settings.",
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
  const upstreamBenchmarkReport = await readJsonIfPresent(path.resolve(args.upstreamBenchmarkReportPath), {});
  const metricsManifest = await readJsonIfPresent(path.resolve(args.metricsPath), { stories: [] });
  const report = await buildGoal11RetentionIntelligenceLoop({
    storyPackages,
    upstreamBenchmarkReport,
    metricsManifest,
    workspaceRoot: path.resolve(args.workspaceRoot),
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeGoal11RetentionIntelligenceLoop(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoal11RetentionIntelligenceLoopMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal11-retention-intelligence-loop] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

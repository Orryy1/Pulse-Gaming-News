#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true });
}

const {
  buildGoal21ObservabilityDashboard,
  renderGoal21ObservabilityDashboardMarkdown,
  writeGoal21ObservabilityDashboard,
} = require("../lib/goal21-observability-dashboard");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    upstreamAntiSpamReportPath: path.join(ROOT, "output", "goal-20", "goal20_readiness_report.json"),
    upstreamPlatformPolicyReportPath: path.join(ROOT, "output", "goal-17", "platform_policy_report.json"),
    outDir: path.join(ROOT, "output", "goal-21"),
    workspaceRoot: ROOT,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--upstream-anti-spam-report") args.upstreamAntiSpamReportPath = argv[++index] || args.upstreamAntiSpamReportPath;
    else if (arg === "--upstream-platform-policy-report") args.upstreamPlatformPolicyReportPath = argv[++index] || args.upstreamPlatformPolicyReportPath;
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
    "Usage: npm run ops:goal21-observability-dashboard -- [options]",
    "",
    "Options:",
    "  --story-packages <path>             Story package manifest",
    "  --upstream-anti-spam-report <path>  Goal 20 readiness report",
    "  --upstream-platform-policy-report <path>  Goal 17 aggregate platform policy report",
    "  --out-dir <dir>                     Output directory for Goal 21 proof",
    "  --workspace <dir>                   Workspace root for relative package paths",
    "  --generated-at <iso>                Fixed timestamp for deterministic reports",
    "  --json                              Print JSON report",
    "",
    "LOCAL_PROOF only. This command compiles dashboard, daily, weekly, blocked-content and revenue reports from existing proof artefacts. It does not publish, post externally, mutate production rows, touch OAuth/token settings or inspect secrets.",
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
  const upstreamAntiSpamReport = await readJsonIfPresent(path.resolve(args.upstreamAntiSpamReportPath), {});
  const upstreamPlatformPolicyReport = await readJsonIfPresent(path.resolve(args.upstreamPlatformPolicyReportPath), {});
  const report = await buildGoal21ObservabilityDashboard({
    storyPackages,
    upstreamAntiSpamReport,
    upstreamPlatformPolicyReport,
    workspaceRoot: path.resolve(args.workspaceRoot),
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeGoal21ObservabilityDashboard(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoal21ObservabilityDashboardMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal21-observability-dashboard] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true });
}

const {
  buildGoal17PlatformPolicyEngine,
  renderGoal17PlatformPolicyEngineMarkdown,
  writeGoal17PlatformPolicyEngine,
} = require("../lib/goal17-platform-policy-engine");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    upstreamLandingReportPath: path.join(ROOT, "output", "goal-16", "goal16_readiness_report.json"),
    outDir: path.join(ROOT, "output", "goal-17"),
    workspaceRoot: ROOT,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--upstream-landing-report") args.upstreamLandingReportPath = argv[++index] || args.upstreamLandingReportPath;
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
    "Usage: npm run ops:goal17-platform-policy -- [options]",
    "",
    "Options:",
    "  --story-packages <path>             Story package manifest",
    "  --upstream-landing-report <path>    Goal 16 readiness report",
    "  --out-dir <dir>                     Output directory for Goal 17 proof",
    "  --workspace <dir>                   Workspace root for relative package paths",
    "  --generated-at <iso>                Fixed timestamp for deterministic reports",
    "  --json                              Print JSON report",
    "",
    "LOCAL_PROOF only. This command checks platform policy, disclosure requirements and publish blockers. It does not publish, upload, post externally, mutate production rows, touch OAuth/token settings or inspect secrets.",
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
  const upstreamLandingReport = await readJsonIfPresent(path.resolve(args.upstreamLandingReportPath), {});
  const report = await buildGoal17PlatformPolicyEngine({
    storyPackages,
    upstreamLandingReport,
    workspaceRoot: path.resolve(args.workspaceRoot),
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeGoal17PlatformPolicyEngine(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoal17PlatformPolicyEngineMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal17-platform-policy-engine] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

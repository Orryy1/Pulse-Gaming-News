#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true });
}

const {
  buildGoal19AutonomyControlTower,
  renderGoal19AutonomyControlTowerMarkdown,
  writeGoal19AutonomyControlTower,
} = require("../lib/goal19-autonomy-control-tower");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    upstreamFirewallReportPath: path.join(ROOT, "output", "goal-18", "goal18_readiness_report.json"),
    outDir: path.join(ROOT, "output", "goal-19"),
    workspaceRoot: ROOT,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--upstream-firewall-report") args.upstreamFirewallReportPath = argv[++index] || args.upstreamFirewallReportPath;
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
    "Usage: npm run ops:goal19-autonomy-control-tower -- [options]",
    "",
    "Options:",
    "  --story-packages <path>              Story package manifest",
    "  --upstream-firewall-report <path>    Goal 18 readiness report",
    "  --out-dir <dir>                      Output directory for Goal 19 proof",
    "  --workspace <dir>                    Workspace root for relative package paths",
    "  --generated-at <iso>                 Fixed timestamp for deterministic reports",
    "  --json                               Print JSON report",
    "",
    "LOCAL_PROOF and DRY_RUN_PUBLISH only. This command produces final GREEN/AMBER/RED verdict evidence, risk, rejection and approval artefacts. It does not publish, post externally, mutate production rows, touch OAuth/token settings or inspect secrets.",
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
  const upstreamFirewallReport = await readJsonIfPresent(path.resolve(args.upstreamFirewallReportPath), {});
  const report = await buildGoal19AutonomyControlTower({
    storyPackages,
    upstreamFirewallReport,
    workspaceRoot: path.resolve(args.workspaceRoot),
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeGoal19AutonomyControlTower(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoal19AutonomyControlTowerMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal19-autonomy-control-tower] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

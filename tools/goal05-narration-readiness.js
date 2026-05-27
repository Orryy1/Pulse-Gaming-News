#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true });
}

const {
  buildGoal05NarrationReadiness,
  renderGoal05NarrationReadinessMarkdown,
  writeGoal05NarrationReadiness,
} = require("../lib/goal05-narration-readiness");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    workbenchPath: path.join(ROOT, "output", "goal-contract", "audio_timestamp_workbench.json"),
    materializationPath: "",
    outDir: path.join(ROOT, "output", "goal-05"),
    workspaceRoot: ROOT,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workbench") args.workbenchPath = argv[++i] || args.workbenchPath;
    else if (arg === "--materialization") args.materializationPath = argv[++i] || "";
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--workspace") args.workspaceRoot = argv[++i] || args.workspaceRoot;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal05-narration-readiness -- [options]",
    "",
    "Options:",
    "  --workbench <path>         Audio timestamp workbench JSON",
    "  --materialization <path>   Optional audio materialization report JSON",
    "  --out-dir <dir>            Output directory for Goal 05 proof",
    "  --workspace <dir>          Workspace root for relative media paths",
    "  --generated-at <iso>       Fixed timestamp for deterministic reports",
    "  --json                     Print JSON summary",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const workbenchReport = await readJsonIfPresent(path.resolve(args.workbenchPath));
  const materializationReport = args.materializationPath
    ? await readJsonIfPresent(path.resolve(args.materializationPath), null)
    : null;
  const report = await buildGoal05NarrationReadiness({
    workbenchReport,
    materializationReport,
    workspaceRoot: path.resolve(args.workspaceRoot),
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeGoal05NarrationReadiness(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoal05NarrationReadinessMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal05-narration-readiness] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

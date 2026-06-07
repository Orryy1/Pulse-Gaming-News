#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildCompetitorUpgradeBakeoff,
  renderCompetitorUpgradeBakeoffMarkdown,
  writeCompetitorUpgradeBakeoff,
} = require("../lib/competitor-upgrade-bakeoff");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    candidatesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    rulebookPath: path.join(ROOT, "output", "competitor-forensics-lab", "pulse_upgrade_rulebook.json"),
    outDir: path.join(ROOT, "output", "competitor-upgrade-bakeoff"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--candidates") args.candidatesPath = argv[++index] || args.candidatesPath;
    else if (arg === "--rulebook") args.rulebookPath = argv[++index] || args.rulebookPath;
    else if (arg === "--out-dir") args.outDir = argv[++index] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:competitor-upgrade-bakeoff -- [options]",
    "",
    "Options:",
    "  --candidates <path>       Optional 30-story candidate JSON",
    "  --rulebook <path>         Pulse upgrade rulebook path, recorded for audit compatibility",
    "  --out-dir <dir>           Output directory",
    "  --generated-at <iso>      Fixed timestamp",
    "  --json                    Print JSON report",
    "",
    "Do not live-publish. LOCAL_PROOF only. This command does not mutate DB rows, does not touch OAuth or tokens, does not change platform settings and does not copy competitor assets.",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback) {
  if (!filePath) return fallback;
  const resolved = path.resolve(filePath);
  if (!(await fs.pathExists(resolved))) return fallback;
  const value = await fs.readJson(resolved);
  return Array.isArray(value) ? value : fallback;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const candidates = await readJsonIfPresent(args.candidatesPath, null);
  const report = await buildCompetitorUpgradeBakeoff({
    candidates,
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  report.rulebook_path = args.rulebookPath ? path.resolve(args.rulebookPath) : null;
  const written = await writeCompetitorUpgradeBakeoff(report, { outputDir: path.resolve(args.outDir) });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderCompetitorUpgradeBakeoffMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[competitor-upgrade-bakeoff] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

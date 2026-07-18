#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const {
  buildWeeklyCommercialScorecard,
  writeWeeklyCommercialScorecard,
} = require("../lib/weekly-commercial-scorecard");

const ROOT = path.resolve(__dirname, "..");

function currentUtcWeek(now = new Date()) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - day + 1);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return {
    week_start: start.toISOString().slice(0, 10),
    week_end: end.toISOString().slice(0, 10),
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const week = currentUtcWeek();
  const args = {
    inputPath: null,
    evidenceRoot: null,
    outputDir: path.join(ROOT, "output", "commercial-scorecard"),
    weekStart: week.week_start,
    weekEnd: week.week_end,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") args.inputPath = argv[++index] || null;
    else if (arg === "--evidence-root") args.evidenceRoot = argv[++index] || null;
    else if (arg === "--out-dir") args.outputDir = argv[++index] || args.outputDir;
    else if (arg === "--week-start") args.weekStart = argv[++index] || args.weekStart;
    else if (arg === "--week-end") args.weekEnd = argv[++index] || args.weekEnd;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/weekly-commercial-scorecard.js [options]",
    "",
    "Options:",
    "  --input <path>       Local JSON ledger; omitted means a zero-evidence baseline",
    "  --evidence-root <dir> Root containing every primary evidence file",
    "  --out-dir <dir>      Proof output directory",
    "  --week-start <date>  Reporting week start (YYYY-MM-DD)",
    "  --week-end <date>    Reporting week end (YYYY-MM-DD)",
    "  --generated-at <iso> Fixed proof timestamp",
    "  --json               Print canonical JSON instead of Markdown",
    "  --help               Show this help",
    "",
    "LOCAL_PROOF only. This command reads an explicit local ledger and writes proof files. It does not contact anyone, spend money, use credentials, publish or mutate a database.",
  ].join("\n");
}

async function readInput(inputPath) {
  if (!inputPath) return {};
  return fs.readJson(path.resolve(inputPath));
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const input = await readInput(args.inputPath);
  const inputLedgerPath = args.inputPath ? path.resolve(args.inputPath) : null;
  const evidenceRoot = args.evidenceRoot
    ? path.resolve(args.evidenceRoot)
    : inputLedgerPath
      ? path.dirname(inputLedgerPath)
      : null;
  const report = buildWeeklyCommercialScorecard({
    period: {
      week_start: args.weekStart || input.period?.week_start,
      week_end: args.weekEnd || input.period?.week_end,
    },
    revenueEntries: input.revenue_entries || input.revenueEntries || [],
    costEntries: input.cost_entries || input.costEntries || [],
    planningScenarios: input.planning_scenarios || input.planningScenarios || [],
    sourceContext: input.source_context || input.sourceContext || [],
    evidenceRoot,
    inputLedgerPath,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeWeeklyCommercialScorecard(report, {
    outputDir: path.resolve(args.outputDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log((await fs.readFile(written.markdown, "utf8")).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[weekly-commercial-scorecard] FAILED: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  currentUtcWeek,
  main,
  parseArgs,
  usage,
};

#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const {
  buildWeeklyCommercialScorecard,
  writeWeeklyCommercialScorecard,
} = require("../lib/weekly-commercial-scorecard");
const {
  allocateCommercialEvidenceLedger,
  writeCommercialEvidenceAllocation,
} = require("../lib/intelligence/commercial-evidence-ledger-bridge");

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
    allocationInputPath: null,
    publishedSnapshotPath: null,
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
    else if (arg === "--allocation-input") args.allocationInputPath = argv[++index] || null;
    else if (arg === "--published-snapshot") {
      args.publishedSnapshotPath = argv[++index] || null;
    }
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
    "  --allocation-input <path>",
    "                       Raw local evidence ledger to allocate before scoring",
    "  --published-snapshot <path>",
    "                       Local platform_posts snapshot or published reconciliation report",
    "  --evidence-root <dir> Root containing every primary evidence file",
    "  --out-dir <dir>      Proof output directory",
    "  --week-start <date>  Reporting week start (YYYY-MM-DD)",
    "  --week-end <date>    Reporting week end (YYYY-MM-DD)",
    "  --generated-at <iso> Fixed proof timestamp",
    "  --json               Print canonical JSON instead of Markdown",
    "  --help               Show this help",
    "",
    "Allocation record types: platform_earnings, platform_payout, affiliate_approved_commission, affiliate_payment, sponsor_invoice, sponsor_remittance, provider_invoice, provider_usage, operator_time.",
    "amount_status=verified requires numeric record and allocation amounts. unknown/not_provided remains unavailable and is never coerced to zero.",
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
  if (args.inputPath && args.allocationInputPath) {
    throw new Error("--input and --allocation-input are mutually exclusive");
  }
  if (args.allocationInputPath && !args.publishedSnapshotPath) {
    throw new Error("--published-snapshot is required with --allocation-input");
  }
  if (args.publishedSnapshotPath && !args.allocationInputPath) {
    throw new Error("--allocation-input is required with --published-snapshot");
  }
  const generatedAt = args.generatedAt || new Date().toISOString();
  let input;
  let inputLedgerPath;
  let allocationBridge = null;
  let allocationWritten = null;
  if (args.allocationInputPath) {
    const allocationResult = allocateCommercialEvidenceLedger({
      sourceLedgerPath: path.resolve(args.allocationInputPath),
      publicationSnapshotPath: path.resolve(args.publishedSnapshotPath),
      evidenceRoot: args.evidenceRoot
        ? path.resolve(args.evidenceRoot)
        : path.dirname(path.resolve(args.allocationInputPath)),
      generatedAt,
    });
    allocationWritten = await writeCommercialEvidenceAllocation(allocationResult, {
      outputDir: path.resolve(args.outputDir),
    });
    input = await fs.readJson(allocationWritten.ledger_path);
    inputLedgerPath = allocationWritten.ledger_path;
    allocationBridge = allocationWritten.report;
  } else {
    input = await readInput(args.inputPath);
    inputLedgerPath = args.inputPath ? path.resolve(args.inputPath) : null;
  }
  const evidenceRoot = args.evidenceRoot
    ? path.resolve(args.evidenceRoot)
    : args.allocationInputPath
      ? path.dirname(path.resolve(args.allocationInputPath))
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
    allocationBridge,
    generatedAt,
  });
  const written = await writeWeeklyCommercialScorecard(report, {
    outputDir: path.resolve(args.outputDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log((await fs.readFile(written.markdown, "utf8")).trimEnd());
  return { report, written, allocationWritten };
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

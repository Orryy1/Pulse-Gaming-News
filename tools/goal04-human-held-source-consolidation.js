#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildGoal04HumanHeldSourceConsolidation,
  renderGoal04HumanHeldSourceConsolidationMarkdown,
} = require("../lib/goal04-human-held-source-consolidation");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    ownedSourceWorkOrders: [],
    publicSourceWorkOrders: [],
    sourceFamilyReports: [],
    sourceDeficitReports: [],
    outputJson: path.join(process.cwd(), "output", "goal-04", "goal04_human_held_source_consolidation.json"),
    outputMd: path.join(process.cwd(), "output", "goal-04", "goal04_human_held_source_consolidation.md"),
    generatedAt: null,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--owned-source-work-order") args.ownedSourceWorkOrders.push(argv[++i] || "");
    else if (arg === "--public-source-work-order") args.publicSourceWorkOrders.push(argv[++i] || "");
    else if (arg === "--source-family-report") args.sourceFamilyReports.push(argv[++i] || "");
    else if (arg === "--source-deficit-report") args.sourceDeficitReports.push(argv[++i] || "");
    else if (arg === "--output-json") args.outputJson = argv[++i] || args.outputJson;
    else if (arg === "--output-md") args.outputMd = argv[++i] || args.outputMd;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  args.ownedSourceWorkOrders = args.ownedSourceWorkOrders.filter(Boolean);
  args.publicSourceWorkOrders = args.publicSourceWorkOrders.filter(Boolean);
  args.sourceFamilyReports = args.sourceFamilyReports.filter(Boolean);
  args.sourceDeficitReports = args.sourceDeficitReports.filter(Boolean);
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal04-source-holds -- [options]",
    "",
    "Options:",
    "  --owned-source-work-order <path>   Owned motion source-safety work order; repeatable",
    "  --public-source-work-order <path>  Public source-attribution work order; repeatable",
    "  --source-family-report <path>      Source-family acquisition report; repeatable",
    "  --source-deficit-report <path>     Source deficit report; repeatable",
    "  --output-json <path>               Consolidated JSON report",
    "  --output-md <path>                 Consolidated Markdown report",
    "  --generated-at <iso>               Fixed timestamp",
    "  --json                             Print compact JSON summary",
    "",
    "This tool only consolidates existing LOCAL_PROOF artefacts. It does not publish, upload, mutate production DB rows or touch OAuth tokens.",
  ].join("\n");
}

function resolvePath(root, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
}

async function readJsonReports(root, paths) {
  const reports = [];
  for (const filePath of paths) {
    const resolved = resolvePath(root, filePath);
    const value = await fs.readJson(resolved);
    reports.push(value);
  }
  return reports;
}

async function writeReports({ report, outputJson, outputMd }) {
  const markdown = renderGoal04HumanHeldSourceConsolidationMarkdown(report);
  await fs.ensureDir(path.dirname(outputJson));
  await fs.ensureDir(path.dirname(outputMd));
  await fs.writeJson(outputJson, report, { spaces: 2 });
  await fs.writeFile(outputMd, markdown, "utf8");
  return { outputJson, outputMd };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }

  const root = path.resolve(args.root);
  const report = buildGoal04HumanHeldSourceConsolidation({
    generatedAt: args.generatedAt || new Date().toISOString(),
    ownedSourceSafetyWorkOrders: await readJsonReports(root, args.ownedSourceWorkOrders),
    publicSourceAttributionWorkOrders: await readJsonReports(root, args.publicSourceWorkOrders),
    sourceFamilyReports: await readJsonReports(root, args.sourceFamilyReports),
    sourceDeficitReports: await readJsonReports(root, args.sourceDeficitReports),
  });

  const artefacts = await writeReports({
    report,
    outputJson: resolvePath(root, args.outputJson),
    outputMd: resolvePath(root, args.outputMd),
  });

  const result = { report, artefacts };
  if (args.json) {
    console.log(JSON.stringify({
      verdict: report.summary.goal_verdict,
      safe_to_advance: report.safe_to_advance,
      story_count: report.summary.story_count,
      human_held_story_count: report.summary.human_held_story_count,
      artefacts,
    }, null, 2));
  }
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs };

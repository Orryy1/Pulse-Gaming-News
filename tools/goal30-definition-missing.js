#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildGoal30DefinitionMissing,
  renderGoal30DefinitionMissingMarkdown,
  writeGoal30DefinitionMissing,
} = require("../lib/goal30-definition-missing");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    campaignDocPath: path.join(ROOT, "docs", "codex-main-goal.md"),
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    upstreamGoal29ReportPath: path.join(ROOT, "output", "goal-29", "goal29_readiness_report.json"),
    outDir: path.join(ROOT, "output", "goal-30"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--campaign-doc") args.campaignDocPath = argv[++index] || args.campaignDocPath;
    else if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--upstream-goal29-report") args.upstreamGoal29ReportPath = argv[++index] || args.upstreamGoal29ReportPath;
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
    "Usage: npm run ops:goal30-definition-missing -- [options]",
    "",
    "Options:",
    "  --campaign-doc <path>              Campaign goal document",
    "  --story-packages <path>            Story package manifest for carry-forward context",
    "  --upstream-goal29-report <path>    Goal 29 readiness report",
    "  --out-dir <dir>                    Output directory for Goal 30 proof",
    "  --generated-at <iso>               Fixed timestamp for deterministic reports",
    "  --json                             Print JSON report",
    "",
    "LOCAL_PROOF only. This command records missing Goal 30 contract blockers and an operator request. It does not invent requirements, publish, post externally, mutate production rows or change OAuth/token state.",
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
  const upstreamGoal29Report = await readJsonIfPresent(path.resolve(args.upstreamGoal29ReportPath), {});
  const report = await buildGoal30DefinitionMissing({
    campaignDocPath: path.resolve(args.campaignDocPath),
    storyPackages,
    upstreamGoal29Report,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeGoal30DefinitionMissing(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoal30DefinitionMissingMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal30-definition-missing] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

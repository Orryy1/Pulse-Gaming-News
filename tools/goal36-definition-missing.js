#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildGoal36DefinitionMissing,
  renderGoal36DefinitionMissingMarkdown,
  writeGoal36DefinitionMissing,
} = require("../lib/goal36-definition-missing");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    campaignDocPath: path.join(ROOT, "docs", "codex-main-goal.md"),
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    upstreamGoal35ReportPath: path.join(ROOT, "output", "goal-35", "goal35_readiness_report.json"),
    outDir: path.join(ROOT, "output", "goal-36"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--campaign-doc") args.campaignDocPath = argv[++index] || args.campaignDocPath;
    else if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--upstream-goal35-report") args.upstreamGoal35ReportPath = argv[++index] || args.upstreamGoal35ReportPath;
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
    "Usage: npm run ops:goal36-definition-missing -- [options]",
    "",
    "Options:",
    "  --campaign-doc <path>              Campaign goal document",
    "  --story-packages <path>            Story package manifest for carry-forward context",
    "  --upstream-goal35-report <path>    Goal 35 readiness report",
    "  --out-dir <dir>                    Output directory for Goal 36 proof",
    "  --generated-at <iso>               Fixed timestamp for deterministic reports",
    "  --json                             Print JSON report",
    "",
    "LOCAL_PROOF only. This command records missing Goal 36 contract blockers and an operator request. It does not invent requirements, publish, post externally, mutate production rows or change OAuth/token state.",
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
  const upstreamGoal35Report = await readJsonIfPresent(path.resolve(args.upstreamGoal35ReportPath), {});
  const report = await buildGoal36DefinitionMissing({
    campaignDocPath: path.resolve(args.campaignDocPath),
    storyPackages,
    upstreamGoal35Report,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeGoal36DefinitionMissing(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoal36DefinitionMissingMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal36-definition-missing] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

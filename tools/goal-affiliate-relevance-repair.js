#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  repairGoalAffiliateRelevance,
  renderGoalAffiliateRelevanceRepairMarkdown,
  writeGoalAffiliateRelevanceRepairReport,
} = require("../lib/goal-affiliate-relevance-repair");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "production_cutover_story_packages.json"),
    outDir: path.join(ROOT, "output", "goal-contract"),
    generatedAt: null,
    backupRoot: "",
    apply: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--out-dir") args.outDir = argv[++index] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg === "--backup-root") args.backupRoot = argv[++index] || "";
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-affiliate-relevance-repair -- [options]",
    "",
    "Repairs stale affiliate manifests when the product category no longer matches the canonical story subject.",
    "No publishing, DB mutation, OAuth or token changes are performed.",
    "",
    "Options:",
    "  --story-packages <path>  Story package list JSON",
    "  --out-dir <dir>          Output directory for repair report",
    "  --generated-at <iso>     Fixed timestamp",
    "  --backup-root <dir>      Backup root used in apply mode",
    "  --apply                  Rewrite local artefacts with backups",
    "  --json                   Print JSON report",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const storyPackages = await fs.readJson(path.resolve(args.storyPackagesPath));
  const report = await repairGoalAffiliateRelevance({
    storyPackages,
    generatedAt: args.generatedAt || new Date().toISOString(),
    apply: args.apply,
    backupRoot: args.backupRoot,
  });
  const written = await writeGoalAffiliateRelevanceRepairReport(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoalAffiliateRelevanceRepairMarkdown(report).trimEnd());
  return { args, report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal-affiliate-relevance-repair] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

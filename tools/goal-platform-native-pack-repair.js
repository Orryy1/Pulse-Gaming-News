#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  repairPlatformNativePacks,
} = require("../lib/goal-platform-native-pack-repair");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    outDir: path.join(ROOT, "output", "goal-contract"),
    backupRoot: path.join(ROOT, "output", "goal-contract", "native-pack-repair-backups"),
    generatedAt: null,
    apply: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++i] || args.storyPackagesPath;
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--backup-root") args.backupRoot = argv[++i] || args.backupRoot;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/goal-platform-native-pack-repair.js [options]",
    "",
    "Repairs local goal package platform packs so each candidate has platform-native evidence.",
    "Default mode is dry-run. Use --apply to rewrite local artefact files with backups.",
    "",
    "Options:",
    "  --story-packages <path>",
    "  --out-dir <dir>",
    "  --backup-root <dir>",
    "  --generated-at <iso>",
    "  --apply",
    "  --json",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const storyPackagesPath = path.resolve(args.storyPackagesPath);
  const storyPackages = await fs.readJson(storyPackagesPath);
  if (!Array.isArray(storyPackages)) {
    throw new Error(`story package file is not an array: ${storyPackagesPath}`);
  }
  const generatedAt = args.generatedAt || new Date().toISOString();
  const report = await repairPlatformNativePacks({
    storyPackages,
    generatedAt,
    apply: args.apply,
    backupRoot: args.backupRoot,
  });
  const outDir = path.resolve(args.outDir);
  await fs.ensureDir(outDir);
  const reportPath = path.join(outDir, args.apply
    ? "platform_native_pack_repair_report.json"
    : "platform_native_pack_repair_dry_run.json");
  await fs.writeJson(reportPath, report, { spaces: 2 });
  if (args.json) console.log(JSON.stringify({ report, reportPath }, null, 2));
  else {
    console.log(`Platform-native pack repair: ${report.summary.repaired_count}/${report.summary.repairable_count} repaired`);
    console.log(`Report: ${reportPath}`);
    console.log("Safety: no publish, no DB mutation, no OAuth changes.");
  }
  return { report, reportPath };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal-platform-native-pack-repair] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};

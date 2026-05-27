#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  repairGoalSfxEvidence,
  writeGoalSfxEvidenceRepairReport,
} = require("../lib/goal-sfx-evidence-repair");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    storyPackagesPath: null,
    packageRoot: null,
    sfxSourcePlanPath: null,
    sfxRightsLedgerPath: null,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    dryRun: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--story-packages") args.storyPackagesPath = argv[++i] || "";
    else if (arg === "--package-root") args.packageRoot = argv[++i] || "";
    else if (arg === "--sfx-source-plan") args.sfxSourcePlanPath = argv[++i] || "";
    else if (arg === "--sfx-rights-ledger") args.sfxRightsLedgerPath = argv[++i] || "";
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-sfx-evidence-repair -- [options]",
    "",
    "Stamps licensed Visual V4 SFX source evidence into existing goal-proof story packages.",
    "This only mutates local artefacts. It does not publish, mutate DB rows or touch OAuth/token settings.",
    "",
    "Options:",
    "  --root <dir>",
    "  --story-packages <path>",
    "  --package-root <dir>",
    "  --sfx-source-plan <path>",
    "  --sfx-rights-ledger <path>",
    "  --out-dir <dir>",
    "  --generated-at <iso>",
    "  --dry-run",
    "  --json",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const report = await repairGoalSfxEvidence({
    root: args.root,
    storyPackagesPath: args.storyPackagesPath,
    packageRoot: args.packageRoot,
    sfxSourcePlanPath: args.sfxSourcePlanPath,
    sfxRightsLedgerPath: args.sfxRightsLedgerPath,
    generatedAt: args.generatedAt || new Date().toISOString(),
    dryRun: args.dryRun,
  });
  const outputs = await writeGoalSfxEvidenceRepairReport(report, { outputDir: path.resolve(args.root, args.outDir) });
  if (args.json) console.log(JSON.stringify({ report, outputs }, null, 2));
  else {
    console.log(`SFX evidence repair: ${report.readiness.status}`);
    console.log(`Packages: ${report.summary.package_count}`);
    console.log(`Repaired: ${report.summary.repaired_count}`);
    console.log(`Unchanged: ${report.summary.unchanged_count}`);
    console.log(`Report: ${outputs.jsonPath}`);
  }
  return { report, outputs };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-sfx-evidence-repair] FAILED: ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};

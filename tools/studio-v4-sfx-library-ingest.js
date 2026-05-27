#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildSfxLibraryIngestReport,
  defaultRoots,
} = require("../lib/studio/v4/sfx-library-ingest");

function parseArgs(argv = process.argv) {
  const args = {
    roots: [],
    outputDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: new Date().toISOString(),
    json: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.roots.push(argv[++index]);
    else if (arg === "--out-dir") args.outputDir = argv[++index];
    else if (arg === "--generated-at") args.generatedAt = argv[++index];
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/studio-v4-sfx-library-ingest.js [--root DIR ...] [--out-dir DIR] [--generated-at ISO] [--json]",
    "",
    "Scans local licensed SFX folders and writes Visual V4 SFX inventory, rights ledger and source-plan artefacts.",
    "This tool is local-only: no downloads, no DB mutation, no OAuth/token mutation and no posting.",
  ].join("\n");
}

async function writeReport(report, { outputDir } = {}) {
  const outDir = path.resolve(outputDir || path.join(process.cwd(), "output", "goal-contract"));
  await fs.ensureDir(outDir);
  const paths = {
    reportPath: path.join(outDir, "sfx_library_ingest_report.json"),
    inventoryPath: path.join(outDir, "sfx_asset_inventory.json"),
    rightsPath: path.join(outDir, "sfx_rights_ledger.json"),
    sourcePlanPath: path.join(outDir, "sfx_source_plan.json"),
  };
  await fs.writeJson(paths.reportPath, report, { spaces: 2 });
  await fs.writeJson(paths.inventoryPath, report.asset_inventory, { spaces: 2 });
  await fs.writeJson(paths.rightsPath, report.rights_ledger, { spaces: 2 });
  await fs.writeJson(paths.sourcePlanPath, report.source_plan, { spaces: 2 });
  return paths;
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { args };
  }
  const roots = args.roots.length ? args.roots : defaultRoots(process.cwd());
  const report = buildSfxLibraryIngestReport({
    workspaceRoot: process.cwd(),
    roots,
    generatedAt: args.generatedAt,
  });
  const outputs = await writeReport(report, { outputDir: args.outputDir });
  if (args.json) {
    console.log(JSON.stringify({ report, outputs }, null, 2));
  } else {
    console.log(`SFX library ingest: ${report.summary.readiness}`);
    console.log(`Accepted assets: ${report.summary.accepted_assets}`);
    console.log(`Missing roles: ${report.summary.missing_roles.join(", ") || "none"}`);
    console.log(`Report: ${outputs.reportPath}`);
  }
  return { report, outputs };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
  writeReport,
};

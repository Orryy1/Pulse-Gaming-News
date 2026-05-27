#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildGoalProofPackage,
  writeGoalProofPackageArtifacts,
} = require("../lib/goal-proof-package");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyFile: path.join(ROOT, "test", "fixtures", "goal", "mixtape-governance-story.json"),
    rightsLedger: path.join(ROOT, "test", "fixtures", "goal", "mixtape-rights-ledger.json"),
    outDir: path.join(ROOT, "output", "goal-proof", "mixtape-governance-proof"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--story-file") args.storyFile = argv[++i] || args.storyFile;
    else if (arg === "--rights-ledger") args.rightsLedger = argv[++i] || args.rightsLedger;
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/goal-proof-package.js [options]",
    "",
    "Builds a local-only governed proof package. It never publishes, mutates DB rows or touches OAuth.",
    "",
    "Options:",
    "  --story-file <path>",
    "  --rights-ledger <path>",
    "  --out-dir <dir>",
    "  --generated-at <iso>",
    "  --json",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const story = await fs.readJson(path.resolve(args.storyFile));
  const rightsLedger = await fs.readJson(path.resolve(args.rightsLedger));
  const pack = buildGoalProofPackage({
    story,
    rightsLedger,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const outputs = await writeGoalProofPackageArtifacts(pack, { outputDir: args.outDir });
  if (args.json) console.log(JSON.stringify({ pack, outputs }, null, 2));
  else {
    console.log(`Goal proof package: ${pack.story_id}`);
    console.log(`Output: ${path.resolve(args.outDir)}`);
    console.log("Safety: local-only, no publish, no DB mutation, no OAuth changes.");
  }
  return { pack, outputs };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-proof-package] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  main,
};

#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  buildGoalControlPack,
  writeGoalControlPack,
} = require("../lib/goal-control-pack");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
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
    "Usage: npm run ops:goal-control-pack -- [options]",
    "",
    "Options:",
    "  --root <dir>         Workspace root",
    "  --out-dir <dir>      Goal-contract output directory",
    "  --generated-at <iso> Fixed timestamp",
    "  --json               Print JSON",
    "",
    "Builds current_readiness_report.*, executor_arm_status.json,",
    "operator_approval_pack.* and next_actions.md from existing guarded",
    "dispatch artefacts. This command never publishes, mutates DB rows or",
    "touches OAuth/token/platform settings.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const root = path.resolve(args.root);
  const outDir = path.resolve(root, args.outDir);
  const pack = await buildGoalControlPack({
    root,
    outDir,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const files = await writeGoalControlPack(pack, { outDir });
  if (args.json) {
    console.log(JSON.stringify({ ...pack, files }, null, 2));
  } else {
    console.log(pack.markdown.operator_approval_pack.trimEnd());
  }
  return { pack, files };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-control-pack] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};

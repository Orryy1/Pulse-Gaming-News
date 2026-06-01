#!/usr/bin/env node
"use strict";

const path = require("node:path");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true, quiet: true });
}

const {
  buildControlledRestartPackFromWorkspace,
} = require("../lib/ops/controlled-restart-pack");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    outDir: path.join(process.cwd(), "output", "controlled-restart"),
    generatedAt: null,
    candidateLimit: 3,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--limit") args.candidateLimit = Number(argv[++i] || 3);
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:controlled-restart-pack -- [options]",
    "",
    "Options:",
    "  --root <dir>          Workspace root",
    "  --out-dir <dir>       Output directory",
    "  --limit <n>           Candidate count, default 3",
    "  --generated-at <iso>  Fixed timestamp",
    "  --json                Print JSON",
    "",
    "Builds a release-management restart pack only. It does not publish, mutate OAuth/tokens or touch production DB rows.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const { report, artefacts } = await buildControlledRestartPackFromWorkspace({
    root: args.root,
    outDir: args.outDir,
    generatedAt: args.generatedAt || new Date().toISOString(),
    candidateLimit: args.candidateLimit,
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(report.controlled_restart_pack_markdown.trimEnd());
    for (const filePath of Object.values(artefacts)) {
      process.stderr.write(`[controlled-restart-pack] wrote ${filePath}\n`);
    }
  }
  if (report.verdict === "RED") process.exitCode = 2;
  return { report, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[controlled-restart-pack] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};

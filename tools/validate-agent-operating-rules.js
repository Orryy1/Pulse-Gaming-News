#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  buildAgentOperatingRulesReport,
  renderAgentOperatingRulesMarkdown,
  writeAgentOperatingRulesArtifacts,
} = require("../lib/ops/agent-operating-rules");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    outDir: path.join(process.cwd(), "output", "goal-00"),
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function usage() {
  return [
    "Usage: node tools/validate-agent-operating-rules.js [options]",
    "",
    "Options:",
    "  --root <dir>      Workspace root to validate",
    "  --out-dir <dir>   Directory for JSON and Markdown artefacts",
    "  --json            Print JSON instead of Markdown",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return { help: true };
  }

  const report = await buildAgentOperatingRulesReport({
    rootDir: path.resolve(args.root),
  });
  const artefacts = await writeAgentOperatingRulesArtifacts(report, {
    outputDir: path.resolve(args.outDir),
  });

  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(renderAgentOperatingRulesMarkdown(report));

  if (report.status !== "PASS") process.exitCode = 2;
  return { report, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[agent-operating-rules] FAILED: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  main,
};

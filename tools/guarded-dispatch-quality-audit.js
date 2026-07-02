#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildGuardedDispatchQualityAudit,
  renderGuardedDispatchQualityAuditMarkdown,
  writeGuardedDispatchQualityAudit,
} = require("../lib/guarded-dispatch-quality-audit");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    executorPreflightPath: path.join("output", "goal-contract", "guarded_dispatch_executor_preflight_report.json"),
    outDir: path.join("output", "goal-contract"),
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--executor-preflight") args.executorPreflightPath = argv[++i] || args.executorPreflightPath;
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:guarded-dispatch-quality-audit -- [options]",
    "",
    "Options:",
    "  --executor-preflight <path>  guarded_dispatch_executor_preflight_report.json",
    "  --out-dir <path>             Output directory",
    "  --json                       Print JSON",
    "",
    "Read-only quality audit for the current guarded dispatch handoff.",
    "No publish, upload, DB, OAuth or token changes are made.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const root = path.resolve(args.root);
  const executorPreflightPath = path.resolve(root, args.executorPreflightPath);
  const outDir = path.resolve(root, args.outDir);
  const guardedDispatchExecutorPreflight = await fs.readJson(executorPreflightPath);
  const report = await buildGuardedDispatchQualityAudit({
    guardedDispatchExecutorPreflight,
  });
  await writeGuardedDispatchQualityAudit(report, { outputDir: outDir });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGuardedDispatchQualityAuditMarkdown(report).trimEnd());
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[guarded-dispatch-quality-audit] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};

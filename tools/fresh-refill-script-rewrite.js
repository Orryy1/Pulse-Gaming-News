#!/usr/bin/env node
"use strict";

const path = require("node:path");
require("dotenv").config({ quiet: true, override: true });

const {
  runFreshRefillScriptRewrite,
} = require("../lib/ops/fresh-refill-script-rewrite");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_WORK_ORDER = path.join(
  ROOT,
  "output",
  "fresh-green-refill",
  "2026-06-30-0124",
  "goal-contract",
  "fresh_production_refill_repair",
  "fresh_refill_script_rewrite_work_order.json",
);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    json: false,
    applyLocal: false,
    workOrderPath: DEFAULT_WORK_ORDER,
    outDir: null,
    limit: Infinity,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") args.json = true;
    else if (arg === "--apply-local") args.applyLocal = true;
    else if (arg === "--dry-run") args.applyLocal = false;
    else if (arg === "--work-order") args.workOrderPath = path.resolve(ROOT, argv[++index] || args.workOrderPath);
    else if (arg.startsWith("--work-order=")) args.workOrderPath = path.resolve(ROOT, arg.slice("--work-order=".length));
    else if (arg === "--out-dir") args.outDir = path.resolve(ROOT, argv[++index] || "");
    else if (arg.startsWith("--out-dir=")) args.outDir = path.resolve(ROOT, arg.slice("--out-dir=".length));
    else if (arg === "--limit") args.limit = Number(argv[++index] || args.limit);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = Infinity;
  return args;
}

async function main(argv = process.argv) {
  const args = parseArgs(argv.slice(2));
  const report = await runFreshRefillScriptRewrite({
    root: ROOT,
    workOrderPath: args.workOrderPath,
    outDir: args.outDir,
    applyLocal: args.applyLocal,
    limit: args.limit,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify({
      status: "completed",
      apply_local: report.apply_local,
      summary: report.summary,
      output: report.output_dir || null,
      safety: report.safety,
    }, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        "# Fresh Refill Script Rewrite",
        "",
        `Mode: ${report.apply_local ? "apply-local" : "dry-run"}`,
        `Jobs: ${report.summary.job_count}`,
        `Passed: ${report.summary.pass_count}`,
        `Would apply: ${report.summary.would_apply_count}`,
        `Applied: ${report.summary.applied_count}`,
        `Blocked: ${report.summary.blocked_count}`,
        "",
      ].join("\n"),
    );
  }
  return { exitCode: 0, report };
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[fresh-refill-script-rewrite] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  main,
};

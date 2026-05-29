"use strict";

const fs = require("fs-extra");
const {
  DEFAULT_DECISION,
  writeStaleTemporalReviewReport,
} = require("../lib/goal-stale-temporal-review");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    dryRunPlan: "output/goal-contract/dry_run_publish_plan.json",
    outDir: "output/goal-contract",
    decision: DEFAULT_DECISION,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run-plan") args.dryRunPlan = argv[++i];
    else if (arg === "--out-dir") args.outDir = argv[++i];
    else if (arg === "--decision") args.decision = argv[++i];
    else if (arg === "--json") args.json = true;
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const dryRunPlan = await fs.readJson(args.dryRunPlan);
  const result = await writeStaleTemporalReviewReport({
    dryRunPlan,
    outputDir: args.outDir,
    decision: args.decision,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  } else {
    process.stdout.write(`Stale temporal reviews written: ${result.report.summary.stale_temporal_review_count}\n`);
    process.stdout.write(`Report: ${result.markdownPath}\n`);
  }
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  main,
};

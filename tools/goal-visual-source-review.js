"use strict";

const fs = require("fs-extra");
const { writeVisualSourceReviewReport } = require("../lib/goal-visual-source-review");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    workOrder: "output/goal-contract/render_input_work_order.json",
    outDir: "output/goal-contract",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--work-order") args.workOrder = argv[++i];
    else if (arg === "--out-dir") args.outDir = argv[++i];
    else if (arg === "--json") args.json = true;
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const workOrder = await fs.readJson(args.workOrder);
  const result = await writeVisualSourceReviewReport({
    workOrder,
    outputDir: args.outDir,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  } else {
    process.stdout.write(`Visual source reviews written: ${result.report.summary.visual_source_review_count}\n`);
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

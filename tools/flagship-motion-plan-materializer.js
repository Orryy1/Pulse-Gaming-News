#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  materializeFlagshipMotionPlan,
} = require("../lib/flagship-motion-plan-materializer");

function valueFor(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || "" : "";
}

async function main(argv = process.argv.slice(2)) {
  const cwd = process.cwd();
  const motionManifest = valueFor(argv, "--motion-manifest");
  const result = await materializeFlagshipMotionPlan({
    sourceStoryPath: path.resolve(cwd, valueFor(argv, "--source-story")),
    selectionPath: path.resolve(cwd, valueFor(argv, "--selection")),
    outputStoryPath: path.resolve(cwd, valueFor(argv, "--output-story")),
    reportPath: path.resolve(cwd, valueFor(argv, "--report")),
    motionManifestPath: motionManifest ? path.resolve(cwd, motionManifest) : "",
    qaDir: path.resolve(cwd, valueFor(argv, "--qa-dir")),
    generatedAt: valueFor(argv, "--generated-at") || new Date().toISOString(),
  });
  if (argv.includes("--json")) process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  else process.stdout.write(`[flagship-motion-plan] ${result.report.status} ${result.report.story_id}\n`);
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[flagship-motion-plan] ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };

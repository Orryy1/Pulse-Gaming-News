#!/usr/bin/env node
"use strict";

const path = require("node:path");
require("dotenv").config({ quiet: true, override: false });

const {
  formatAutonomousFeedbackMarkdown,
  runAutonomousFeedbackMonitor,
} = require("../lib/ops/autonomous-feedback-monitor");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = {
    json: false,
    discord: false,
    outDir: path.join(ROOT, "output", "autonomous-feedback-monitor"),
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--discord") args.discord = true;
    else if (arg === "--out-dir") args.outDir = path.resolve(ROOT, argv[++i] || args.outDir);
    else if (arg.startsWith("--out-dir=")) args.outDir = path.resolve(ROOT, arg.slice("--out-dir=".length));
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const report = await runAutonomousFeedbackMonitor({
    outDir: args.outDir,
    postDiscord: args.discord,
  });
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${formatAutonomousFeedbackMarkdown(report)}\n`);
  if (report.verdict === "red") process.exitCode = 2;
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[autonomous-feedback-monitor] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs };

#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  runDiscordFeedbackIngestion,
} = require("../lib/ops/discord-feedback-ingestion");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    json: false,
    limit: 50,
    outDir: path.join(process.cwd(), "output", "discord-feedback-ingestion"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--limit") args.limit = Number(argv[++i] || args.limit);
    else if (arg === "--out-dir") args.outDir = path.resolve(argv[++i] || args.outDir);
  }
  return args;
}

async function main() {
  require("dotenv").config({ override: false, quiet: true });
  const args = parseArgs();
  const report = await runDiscordFeedbackIngestion({
    limit: args.limit,
    outDir: args.outDir,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `[discord-feedback-ingestion] capability=${report.capability?.status || "unknown"} actionable=${report.summary?.actionable_count || 0} blocking=${report.summary?.blocking_count || 0}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[discord-feedback-ingestion] FAILED: ${err.stack || err.message}\n`);
  process.exitCode = 1;
});

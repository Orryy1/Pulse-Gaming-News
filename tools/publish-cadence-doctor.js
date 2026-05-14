#!/usr/bin/env node
"use strict";

/**
 * Read-only publish cadence doctor.
 *
 * This does not mutate schedules, jobs, stories, platform accounts or env vars.
 * It explains whether recent public posts matched the intended cadence.
 */

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ quiet: true });

const {
  buildPublishCadenceReportFromDb,
  formatPublishCadenceMarkdown,
} = require("../lib/ops/publish-cadence");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv) {
  const args = { json: false, hours: 24, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--hours" || a === "-h") {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) args.hours = n;
    } else if (a.startsWith("--hours=")) {
      const n = Number(a.slice("--hours=".length));
      if (Number.isFinite(n) && n > 0) args.hours = n;
    } else if (a === "--help" || a === "-?") {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    "Usage: node tools/publish-cadence-doctor.js [--hours N] [--json]\n" +
      "  --hours N   Look-back window in hours (default 24)\n" +
      "  --json      Print JSON instead of markdown\n",
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const report = await buildPublishCadenceReportFromDb({
    windowHours: args.hours,
  });
  const markdown = formatPublishCadenceMarkdown(report);

  await fs.ensureDir(OUT);
  await fs.writeJson(path.join(OUT, "publish_cadence.json"), report, {
    spaces: 2,
  });
  await fs.writeFile(path.join(OUT, "publish_cadence.md"), markdown, "utf-8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${markdown}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`[publish-cadence] ${err.stack || err.message}\n`);
  process.exit(1);
});

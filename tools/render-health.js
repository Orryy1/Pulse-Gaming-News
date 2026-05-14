#!/usr/bin/env node
"use strict";

require("dotenv").config({ quiet: true });

/**
 * tools/render-health.js — print the render-health digest on demand.
 *
 * Same digest the daily 09:30 UTC scheduler posts to Discord. Useful
 * when an operator wants to inspect render quality after a produce
 * cycle without waiting for tomorrow morning.
 *
 * Usage:
 *   node tools/render-health.js              # last 24h, markdown to stdout
 *   node tools/render-health.js --hours 72   # custom window
 *   node tools/render-health.js --json       # machine-readable summary
 *
 * Reads the same canonical store the production cron job uses
 * (lib/db.getStories) so local dev and Railway both work.
 */

const {
  runRenderHealthDigest,
} = require("../lib/intelligence/render-health-digest");

function parseArgs(argv) {
  const args = { hours: 24, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") {
      args.json = true;
    } else if (a === "--hours" || a === "-h") {
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
    "Usage: node tools/render-health.js [--hours N] [--json]\n" +
      "  --hours N   Look-back window in hours (default 24)\n" +
      "  --json      Print the summary as JSON instead of markdown\n",
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  const originalLog = console.log;
  console.log = (...items) => {
    process.stderr.write(`${items.join(" ")}\n`);
  };
  let result;
  try {
    result = await runRenderHealthDigest({
      windowHours: args.hours,
    });
  } finally {
    console.log = originalLog;
  }
  const { summary, markdown } = result;
  if (args.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  } else {
    process.stdout.write(markdown + "\n");
  }
}

main().catch((err) => {
  // Stay non-zero on hard failures so callers (cron, ad-hoc shell
  // scripts) can detect a broken digest.
  process.stderr.write(`[render-health] ${err.stack || err.message}\n`);
  process.exit(1);
});

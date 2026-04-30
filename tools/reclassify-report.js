#!/usr/bin/env node
"use strict";

/**
 * tools/reclassify-report.js — read-only quarantine candidate report.
 *
 * Re-runs topicality + text-hygiene + visual-count gates over every
 * story in the canonical store and lists which ones a careful
 * operator would want to quarantine. NEVER mutates the DB.
 *
 * Usage:
 *   node tools/reclassify-report.js              # markdown to stdout
 *   node tools/reclassify-report.js --json       # JSON
 *   node tools/reclassify-report.js --discord    # also post markdown
 */

const fs = require("fs-extra");
const path = require("node:path");
const {
  buildReclassifyReport,
  formatReclassifyMarkdown,
} = require("../lib/ops/reclassify-report");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv) {
  const args = { json: false, discord: false, help: false };
  for (const a of argv.slice(2)) {
    if (a === "--json") args.json = true;
    else if (a === "--discord") args.discord = true;
    else if (a === "--help" || a === "-?") args.help = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(
      "Usage: node tools/reclassify-report.js [--json] [--discord]\n",
    );
    return;
  }
  const report = await buildReclassifyReport();
  const markdown = formatReclassifyMarkdown(report);
  try {
    await fs.ensureDir(OUT);
    await fs.writeJson(path.join(OUT, "reclassify_report.json"), report, {
      spaces: 2,
    });
    await fs.writeFile(
      path.join(OUT, "reclassify_report.md"),
      markdown,
      "utf-8",
    );
  } catch (err) {
    process.stderr.write(`[reclassify] persist failed: ${err.message}\n`);
  }
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(markdown + "\n");
  }
  if (args.discord) {
    try {
      const sendDiscord = require("../notify");
      await sendDiscord(markdown);
    } catch (err) {
      process.stderr.write(
        `[reclassify] discord post failed: ${err.message}\n`,
      );
    }
  }
}

main().catch((err) => {
  process.stderr.write(`[reclassify] ${err.stack || err.message}\n`);
  process.exit(1);
});

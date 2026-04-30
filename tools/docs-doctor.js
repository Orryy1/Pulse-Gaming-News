#!/usr/bin/env node
"use strict";

/**
 * tools/docs-doctor.js — read-only docs drift scanner.
 *
 * Looks for the stale phrases the 2026-04-29 forensic audit flagged
 * (e.g. "ready + complete" treated as Facebook Reel success when the
 * code already disagrees, "live proof pending" after definitive
 * findings, etc.) and reports them.
 *
 * Usage:
 *   node tools/docs-doctor.js              # markdown to stdout
 *   node tools/docs-doctor.js --json       # JSON
 *   node tools/docs-doctor.js --discord    # also post markdown
 */

const fs = require("fs-extra");
const path = require("node:path");
const {
  buildDocsDoctorReport,
  formatDocsDoctorMarkdown,
} = require("../lib/ops/docs-doctor");

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
      "Usage: node tools/docs-doctor.js [--json] [--discord]\n",
    );
    return;
  }
  const report = await buildDocsDoctorReport({ rootDir: ROOT });
  const markdown = formatDocsDoctorMarkdown(report);
  try {
    await fs.ensureDir(OUT);
    await fs.writeJson(path.join(OUT, "docs_doctor.json"), report, {
      spaces: 2,
    });
    await fs.writeFile(path.join(OUT, "docs_doctor.md"), markdown, "utf-8");
  } catch (err) {
    process.stderr.write(`[docs-doctor] persist failed: ${err.message}\n`);
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
        `[docs-doctor] discord post failed: ${err.message}\n`,
      );
    }
  }
  if ((report.summary.high || 0) > 0) process.exit(2);
}

main().catch((err) => {
  process.stderr.write(`[docs-doctor] ${err.stack || err.message}\n`);
  process.exit(1);
});

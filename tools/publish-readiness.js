#!/usr/bin/env node
"use strict";

/**
 * tools/publish-readiness.js — single operator command that gives
 * one GREEN/AMBER/RED verdict for "is it safe to publish right now?"
 *
 * Per the 2026-04-30 mission brief — extends the earlier
 * ops:control-room with the full 20-input pillar set.
 *
 * Usage:
 *   node tools/publish-readiness.js              # markdown
 *   node tools/publish-readiness.js --json
 *   node tools/publish-readiness.js --discord
 *
 * Read-only. Never mutates production. Exits non-zero (2) when
 * verdict is RED, so this can be wired into a pre-deploy preflight
 * chain.
 */

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ override: true });
const {
  buildPublishReadinessReport,
  formatPublishReadinessMarkdown,
} = require("../lib/ops/publish-readiness");

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
      "Usage: node tools/publish-readiness.js [--json] [--discord]\n" +
        "  --json     Emit the full JSON report to stdout\n" +
        "  --discord  Also post the markdown verdict to Discord\n",
    );
    return;
  }

  const report = await buildPublishReadinessReport();
  const markdown = formatPublishReadinessMarkdown(report);

  try {
    await fs.ensureDir(OUT);
    await fs.writeJson(path.join(OUT, "publish_readiness.json"), report, {
      spaces: 2,
    });
    await fs.writeFile(
      path.join(OUT, "publish_readiness.md"),
      markdown,
      "utf-8",
    );
  } catch (err) {
    process.stderr.write(
      `[publish-readiness] persist failed: ${err.message}\n`,
    );
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
        `[publish-readiness] discord post failed: ${err.message}\n`,
      );
    }
  }

  if (report.overall_verdict === "red") process.exit(2);
}

main().catch((err) => {
  process.stderr.write(`[publish-readiness] ${err.stack || err.message}\n`);
  process.exit(1);
});

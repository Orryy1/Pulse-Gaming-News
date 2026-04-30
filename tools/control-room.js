#!/usr/bin/env node
"use strict";

/**
 * tools/control-room.js — single-command operator publish-readiness check.
 *
 * Usage:
 *   node tools/control-room.js              # markdown to stdout
 *   node tools/control-room.js --json       # machine-readable output
 *   node tools/control-room.js --discord    # also post to Discord
 *
 * Per the 2026-04-29 forensic audit, this gives the operator a single
 * green/amber/red verdict with reasoning in under 2 minutes — no need
 * to run system-doctor + platform-status + media-verify + render-health
 * separately and squint at five reports.
 */

const fs = require("fs-extra");
const path = require("node:path");
const {
  buildControlRoomReport,
  formatControlRoomMarkdown,
} = require("../lib/ops/control-room");

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

function printHelp() {
  process.stdout.write(
    "Usage: node tools/control-room.js [--json] [--discord]\n" +
      "  --json     Emit JSON report\n" +
      "  --discord  Also post the markdown verdict to Discord (uses notify.js)\n",
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const report = await buildControlRoomReport();
  const markdown = formatControlRoomMarkdown(report);

  // Persist artefacts for the audit / handoff trail
  try {
    await fs.ensureDir(OUT);
    await fs.writeJson(path.join(OUT, "control_room.json"), report, {
      spaces: 2,
    });
    await fs.writeFile(path.join(OUT, "control_room.md"), markdown, "utf-8");
  } catch (err) {
    process.stderr.write(`[control-room] persist failed: ${err.message}\n`);
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
        `[control-room] discord post failed: ${err.message}\n`,
      );
    }
  }

  // Non-zero exit when red so CI / cron treats it as a hard fail.
  if (report.verdict === "red") process.exit(2);
}

main().catch((err) => {
  process.stderr.write(`[control-room] ${err.stack || err.message}\n`);
  process.exit(1);
});

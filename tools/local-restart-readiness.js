#!/usr/bin/env node
"use strict";

/**
 * Read-only local primary restart readiness check.
 *
 * This deliberately does not restart anything. It compares the running
 * /api/health build metadata with the checked-out git commit and highlights
 * cadence/repair blockers before a controlled restart.
 */

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ quiet: true });

const {
  buildLocalRestartReadiness,
  formatLocalRestartReadinessMarkdown,
} = require("../lib/ops/local-restart-readiness");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv) {
  const args = { json: false, help: false, writeRootReport: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--write-root-report") args.writeRootReport = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    "Usage: node tools/local-restart-readiness.js [--json] [--write-root-report]\n" +
      "  --json               Print JSON instead of markdown\n" +
      "  --write-root-report  Also update tracked LOCAL_RESTART_READINESS.md\n",
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const report = await buildLocalRestartReadiness({ cwd: ROOT });
  const markdown = formatLocalRestartReadinessMarkdown(report);

  await fs.ensureDir(OUT);
  await fs.writeJson(path.join(OUT, "local_restart_readiness.json"), report, {
    spaces: 2,
  });
  await fs.writeFile(
    path.join(OUT, "local_restart_readiness.md"),
    markdown,
    "utf8",
  );
  if (args.writeRootReport) {
    await fs.writeFile(
      path.join(ROOT, "LOCAL_RESTART_READINESS.md"),
      markdown,
      "utf8",
    );
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${markdown}\n`);
    process.stderr.write(
      `[local-restart-readiness] json=${path.join(OUT, "local_restart_readiness.json")}\n`,
    );
    process.stderr.write(
      `[local-restart-readiness] md=${path.join(OUT, "local_restart_readiness.md")}\n`,
    );
    if (args.writeRootReport) {
      process.stderr.write(
        `[local-restart-readiness] report=${path.join(ROOT, "LOCAL_RESTART_READINESS.md")}\n`,
      );
    }
  }

  if (report.verdict === "red") process.exitCode = 2;
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[local-restart-readiness] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs };

#!/usr/bin/env node
"use strict";

/**
 * Dry-run publish row repair planner.
 *
 * This deliberately does not mutate the production DB. It produces the
 * operator queue for rows whose public/platform state no longer matches
 * their QA/publish state.
 */

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ quiet: true });

const {
  buildPublishRowRepairPlanFromDb,
  formatPublishRowRepairMarkdown,
} = require("../lib/ops/publish-row-repair");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv) {
  const args = { json: false, limit: 50, help: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--limit") {
      const value = Number(argv[++i]);
      if (Number.isFinite(value) && value > 0) args.limit = value;
    } else if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (Number.isFinite(value) && value > 0) args.limit = value;
    } else if (arg === "--help" || arg === "-?") {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    "Usage: node tools/publish-row-repair-plan.js [--limit N] [--json]\n" +
      "  --limit N   Maximum candidate rows to include (default 50)\n" +
      "  --json      Print JSON instead of markdown\n",
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const plan = await buildPublishRowRepairPlanFromDb({ limit: args.limit });
  const markdown = formatPublishRowRepairMarkdown(plan);

  await fs.ensureDir(OUT);
  await fs.writeJson(path.join(OUT, "publish_row_repair_plan.json"), plan, {
    spaces: 2,
  });
  await fs.writeFile(
    path.join(OUT, "publish_row_repair_plan.md"),
    markdown,
    "utf-8",
  );

  if (args.json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else {
    process.stdout.write(`${markdown}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`[publish-row-repair] ${err.stack || err.message}\n`);
  process.exit(1);
});

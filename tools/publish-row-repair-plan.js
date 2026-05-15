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
  applyPublishRowRepairPlan,
  buildPublishRowRepairPlan,
  formatPublishRowRepairMarkdown,
} = require("../lib/ops/publish-row-repair");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv) {
  const args = {
    json: false,
    limit: 50,
    help: false,
    apply: false,
    operatorConfirmed: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--operator-confirmed") args.operatorConfirmed = true;
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
    "Usage: node tools/publish-row-repair-plan.js [--limit N] [--json] [--apply --operator-confirmed]\n" +
      "  --limit N   Maximum candidate rows to include (default 50)\n" +
      "  --json      Print JSON instead of markdown\n" +
      "  --apply     Apply targeted script-validation fallback repair only\n" +
      "  --operator-confirmed  Required with --apply; creates a DB backup first\n",
  );
}

function backupFileName(now = new Date()) {
  return `pulse-pre-publish-row-repair-${now.toISOString().replace(/[:.]/g, "-")}.db`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const db = require("../lib/db");
  const stories =
    typeof db.getStoriesSync === "function" ? db.getStoriesSync() : await db.getStories();
  const plan = buildPublishRowRepairPlan({ stories, limit: args.limit });
  if (args.apply) {
    if (args.operatorConfirmed !== true) {
      throw new Error(
        "publish_row_repair_apply_requires_operator_confirmed_flag",
      );
    }
    const backupDir = path.join(path.dirname(db.DB_PATH), "backups");
    await fs.ensureDir(backupDir);
    const backupPath = path.join(backupDir, backupFileName(new Date(plan.generated_at)));
    await db.getDb().backup(backupPath);
    const applyResult = await applyPublishRowRepairPlan({
      plan,
      stories,
      persistStory: db.upsertStory,
      now: plan.generated_at,
    });
    applyResult.backup_path = backupPath;
    plan.mode = "apply_targeted_db_mutation";
    plan.apply_result = applyResult;
  }
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
  if (plan.repair_sql_preview) {
    await fs.writeFile(
      path.join(OUT, "publish_row_repair_preview.sql"),
      `${plan.repair_sql_preview}\n`,
      "utf-8",
    );
  }

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

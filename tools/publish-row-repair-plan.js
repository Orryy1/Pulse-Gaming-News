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
    storyIds: [],
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--operator-confirmed") args.operatorConfirmed = true;
    else if (arg === "--story-id") {
      const value = String(argv[++i] || "").trim();
      if (value) args.storyIds.push(value);
    } else if (arg.startsWith("--story-id=")) {
      const value = String(arg.slice("--story-id=".length)).trim();
      if (value) args.storyIds.push(value);
    } else if (arg === "--story-ids") {
      const value = String(argv[++i] || "");
      args.storyIds.push(
        ...value.split(",").map((id) => id.trim()).filter(Boolean),
      );
    } else if (arg.startsWith("--story-ids=")) {
      const value = String(arg.slice("--story-ids=".length));
      args.storyIds.push(
        ...value.split(",").map((id) => id.trim()).filter(Boolean),
      );
    } else if (arg === "--limit") {
      const value = Number(argv[++i]);
      if (Number.isFinite(value) && value > 0) args.limit = value;
    } else if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (Number.isFinite(value) && value > 0) args.limit = value;
    } else if (arg === "--help" || arg === "-?") {
      args.help = true;
    }
  }
  args.storyIds = [...new Set(args.storyIds)];
  return args;
}

function printHelp() {
  process.stdout.write(
    "Usage: node tools/publish-row-repair-plan.js [--limit N] [--story-id ID] [--json] [--apply --operator-confirmed]\n" +
      "  --limit N   Maximum candidate rows to include (default 50)\n" +
      "  --story-id ID  Limit the plan/apply path to one story ID; repeatable\n" +
      "  --story-ids A,B  Limit the plan/apply path to a comma-separated set\n" +
      "  --json      Print JSON instead of markdown\n" +
      "  --apply     Apply targeted script-validation fallback repair only\n" +
      "  --operator-confirmed  Required with --apply; creates a DB backup first\n",
  );
}

function backupFileName(now = new Date()) {
  return `pulse-pre-publish-row-repair-${now.toISOString().replace(/[:.]/g, "-")}.db`;
}

function validateApplyArgs(args) {
  if (!args.apply) return;
  if (args.operatorConfirmed !== true) {
    throw new Error(
      "publish_row_repair_apply_requires_operator_confirmed_flag",
    );
  }
  if (!args.storyIds?.length) {
    throw new Error("publish_row_repair_apply_requires_story_id");
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  validateApplyArgs(args);

  const db = require("../lib/db");
  const stories =
    typeof db.getStoriesSync === "function" ? db.getStoriesSync() : await db.getStories();
  const plan = buildPublishRowRepairPlan({
    stories,
    limit: args.limit,
    storyIds: args.storyIds,
  });
  if (args.apply) {
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

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[publish-row-repair] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  backupFileName,
  main,
  parseArgs,
  validateApplyArgs,
};

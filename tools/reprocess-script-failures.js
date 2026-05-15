#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ override: true });

const processStories = require("../processor");
const db = require("../lib/db");
const {
  buildScriptFailureReprocessReport,
  formatScriptFailureReprocessMarkdown,
  selectLocalLlmFetchFailureStories,
} = require("../lib/ops/script-failure-reprocess");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function backupFileName(now = new Date()) {
  return `pulse-pre-script-failure-reprocess-${now.toISOString().replace(/[:.]/g, "-")}.db`;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    applyLocal: false,
    json: false,
    limit: 10,
    storyIds: [],
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply-local") args.applyLocal = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--story" || arg === "--story-id") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a story id`);
      }
      args.storyIds.push(value);
    } else if (arg.startsWith("--story=")) {
      args.storyIds.push(arg.slice("--story=".length));
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
  return args;
}

function printHelp() {
  process.stdout.write(
    "Usage: node tools/reprocess-script-failures.js [--limit N] [--story ID] [--apply-local] [--json]\n" +
      "  Default is dry-run: generates scripts and reports, but does not write DB rows.\n" +
      "  --apply-local persists only selected stale local-LLM failure rows and never posts to Discord/social.\n",
  );
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const stories =
    typeof db.getStoriesSync === "function"
      ? db.getStoriesSync()
      : await db.getStories();
  const candidates = selectLocalLlmFetchFailureStories({
    stories,
    limit: args.limit,
    storyIds: args.storyIds,
  });

  let results = [];
  let backupPath = null;
  if (args.applyLocal && candidates.length > 0) {
    const backupDir = path.join(path.dirname(db.DB_PATH), "backups");
    await fs.ensureDir(backupDir);
    backupPath = path.join(backupDir, backupFileName());
    await db.getDb().backup(backupPath);
  }

  if (candidates.length > 0) {
    results = await processStories({
      storiesOverride: candidates,
      skipDedupIds: candidates.map((story) => story.id),
      postDiscord: false,
      persist: args.applyLocal,
    });
  }

  const report = buildScriptFailureReprocessReport({
    mode: args.applyLocal ? "apply_local" : "dry_run",
    candidates,
    results,
  });
  if (backupPath) {
    report.backup_path = backupPath;
  }
  const markdown = formatScriptFailureReprocessMarkdown(report);

  await fs.ensureDir(OUT);
  await fs.writeJson(path.join(OUT, "script_failure_reprocess.json"), report, {
    spaces: 2,
  });
  await fs.writeFile(
    path.join(OUT, "script_failure_reprocess.md"),
    markdown,
    "utf-8",
  );

  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : markdown);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[script-failure-reprocess] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
};

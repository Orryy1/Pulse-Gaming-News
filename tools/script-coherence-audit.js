#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
require("dotenv").config({ override: true });

const db = require("../lib/db");
const {
  auditScriptCoherenceStories,
  buildScriptCoherenceAuditReport,
  formatScriptCoherenceAuditMarkdown,
  markStoryForScriptReview,
} = require("../lib/ops/script-coherence-audit");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    applyLocal: false,
    includePublished: false,
    storyIds: [],
    limit: 50,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply-local") args.applyLocal = true;
    else if (arg === "--include-published") args.includePublished = true;
    else if (arg === "--story-id" || arg === "--story") {
      args.storyIds.push(
        ...String(argv[++i] || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      );
    } else if (arg.startsWith("--story-id=")) {
      args.storyIds.push(
        ...arg
          .slice("--story-id=".length)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      );
    } else if (arg.startsWith("--story=")) {
      args.storyIds.push(
        ...arg
          .slice("--story=".length)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
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

function validateArgs(args = {}) {
  if (args.applyLocal && args.includePublished) {
    throw new Error(
      "--apply-local cannot be combined with --include-published; published/social-posted rows are read-only",
    );
  }
}

function printHelp() {
  process.stdout.write(
    "Usage: node tools/script-coherence-audit.js [--story-id ID[,ID]] [--limit N] [--apply-local] [--include-published]\n" +
      "  Default is dry-run. --include-published is for inspection only and cannot be combined with --apply-local.\n",
  );
}

function backupFileName(now = new Date()) {
  return `pulse-pre-script-coherence-audit-${now.toISOString().replace(/[:.]/g, "-")}.db`;
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }
  validateArgs(args);

  const stories = typeof db.getStoriesSync === "function" ? db.getStoriesSync() : await db.getStories();
  const rows = auditScriptCoherenceStories(stories, {
    includePublished: args.includePublished,
    storyIds: args.storyIds,
    limit: args.limit,
  });

  let backupPath = null;
  if (args.applyLocal && rows.length > 0) {
    const backupDir = path.join(path.dirname(db.DB_PATH), "backups");
    await fs.ensureDir(backupDir);
    backupPath = path.join(backupDir, backupFileName());
    await db.getDb().backup(backupPath);

    const storyById = new Map(stories.map((story) => [story.id, story]));
    for (const row of rows) {
      const story = storyById.get(row.story_id);
      if (!story) continue;
      await db.upsertStory(markStoryForScriptReview(story, row.failures));
    }
  }

  const report = buildScriptCoherenceAuditReport({
    mode: args.applyLocal ? "apply_local" : "dry_run",
    rows,
    backupPath,
  });
  const markdown = formatScriptCoherenceAuditMarkdown(report);

  await fs.ensureDir(OUT);
  await fs.writeJson(path.join(OUT, "script_coherence_audit.json"), report, { spaces: 2 });
  await fs.writeFile(path.join(OUT, "script_coherence_audit.md"), markdown, "utf8");
  process.stdout.write(markdown);
}

if (require.main === module) {
  main()
    .catch((err) => {
      process.stderr.write(`[script-coherence-audit] ${err.stack || err.message}\n`);
      process.exit(1);
    })
    .finally(() => {
      if (typeof db.closeDb === "function") db.closeDb();
    });
}

module.exports = {
  parseArgs,
  validateArgs,
};

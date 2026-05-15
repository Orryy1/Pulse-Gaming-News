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
  selectReprocessableScriptFailureStories,
} = require("../lib/ops/script-failure-reprocess");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_REPROCESS_LLM_TIMEOUT_MS = 30_000;

function backupFileName(now = new Date()) {
  return `pulse-pre-script-failure-reprocess-${now.toISOString().replace(/[:.]/g, "-")}.db`;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    applyLocal: false,
    json: false,
    limit: 10,
    llmTimeoutMs: DEFAULT_REPROCESS_LLM_TIMEOUT_MS,
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
    } else if (arg === "--llm-timeout-ms") {
      const value = Number(argv[++i]);
      if (Number.isFinite(value) && value > 0) args.llmTimeoutMs = Math.floor(value);
    } else if (arg.startsWith("--llm-timeout-ms=")) {
      const value = Number(arg.slice("--llm-timeout-ms=".length));
      if (Number.isFinite(value) && value > 0) args.llmTimeoutMs = Math.floor(value);
    } else if (arg === "--help" || arg === "-?") {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    "Usage: node tools/reprocess-script-failures.js [--limit N] [--story ID] [--llm-timeout-ms N] [--apply-local] [--json]\n" +
      "  Default is dry-run: generates scripts and reports, but does not write DB rows.\n" +
      `  Local LLM calls are bounded by --llm-timeout-ms (default ${DEFAULT_REPROCESS_LLM_TIMEOUT_MS}ms).\n` +
      "  --apply-local persists only selected script-review failure rows and never posts to Discord/social.\n",
  );
}

async function reprocessCandidate(candidate, args) {
  try {
    const rows = await processStories({
      storiesOverride: [candidate],
      skipDedupIds: [candidate.id],
      postDiscord: false,
      persist: args.applyLocal,
    });
    return Array.isArray(rows) && rows.length > 0
      ? rows
      : [
          {
            ...candidate,
            script_generation_status: "review_required",
            script_review_reason: "reprocess_returned_no_rows",
            script_validation_errors: ["reprocess_returned_no_rows"],
          },
        ];
  } catch (err) {
    return [
      {
        ...candidate,
        script_generation_status: "review_required",
        script_review_reason: `reprocess_exception:${String(
          err.message || err,
        ).slice(0, 180)}`,
        script_validation_errors: [
          `reprocess_exception:${String(err.message || err).slice(0, 180)}`,
        ],
      },
    ];
  }
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }
  if (!process.env.LLM_REQUEST_TIMEOUT_MS) {
    process.env.LLM_REQUEST_TIMEOUT_MS = String(args.llmTimeoutMs);
  }

  const stories =
    typeof db.getStoriesSync === "function"
      ? db.getStoriesSync()
      : await db.getStories();
  const candidates = selectReprocessableScriptFailureStories({
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
    for (const candidate of candidates) {
      const rows = await reprocessCandidate(candidate, args);
      results.push(...rows);
    }
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
  DEFAULT_REPROCESS_LLM_TIMEOUT_MS,
  parseArgs,
  reprocessCandidate,
};

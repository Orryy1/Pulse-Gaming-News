#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: false });
}

const {
  reconcilePublishedCommercialEvidence,
  renderMarkdown,
} = require("../lib/intelligence/published-commercial-reconciliation");

const ROOT = path.resolve(__dirname, "..");

function resolveFromRoot(value) {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    snapshotPath: null,
    dbPath: process.env.SQLITE_DB_PATH
      ? resolveFromRoot(process.env.SQLITE_DB_PATH)
      : path.join(ROOT, "data", "pulse.db"),
    outputDir: path.join(ROOT, "output", "published-commercial-reconciliation"),
    clickLogPath: path.join(ROOT, "data", "commercial_clicks.jsonl"),
    storyId: null,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--snapshot") args.snapshotPath = resolveFromRoot(argv[++index]);
    else if (arg === "--db") args.dbPath = resolveFromRoot(argv[++index]);
    else if (arg === "--out-dir") args.outputDir = resolveFromRoot(argv[++index]);
    else if (arg === "--click-log") args.clickLogPath = resolveFromRoot(argv[++index]);
    else if (arg === "--story-id") args.storyId = String(argv[++index] || "").trim() || null;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:published-commercial-reconcile -- [options]",
    "",
    "Options:",
    "  --snapshot <path>      JSON fixture with stories and platform_posts",
    "  --db <path>            SQLite source opened in strict read-only mode",
    "  --out-dir <dir>        Isolated proof output directory",
    "  --click-log <path>      Privacy-safe commercial click log",
    "  --story-id <id>         Limit reconciliation to one published story",
    "  --generated-at <iso>    Fixed timestamp for deterministic proof",
    "  --json                  Print the machine-readable report",
    "  --help                  Show this help",
    "",
    "LOCAL_PROOF only. This command reads publication evidence and writes commercial proof artefacts. It does not mutate database rows, publish, call platform APIs or change credentials.",
  ].join("\n");
}

async function readSnapshot(snapshotPath) {
  const snapshot = await fs.readJson(snapshotPath);
  return {
    stories: Array.isArray(snapshot.stories) ? snapshot.stories : [],
    platformPosts: Array.isArray(snapshot.platform_posts)
      ? snapshot.platform_posts
      : Array.isArray(snapshot.platformPosts)
        ? snapshot.platformPosts
        : [],
  };
}

function readSqliteSnapshot(dbPath, { storyId = null } = {}) {
  const Database = require("better-sqlite3");
  const sqlite = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const platformPosts = storyId
      ? sqlite
          .prepare(
            "SELECT * FROM platform_posts WHERE status = 'published' AND story_id = ? ORDER BY story_id, platform, id",
          )
          .all(storyId)
      : sqlite
          .prepare(
            "SELECT * FROM platform_posts WHERE status = 'published' ORDER BY story_id, platform, id",
          )
          .all();
    const storyIds = [...new Set(platformPosts.map((row) => String(row.story_id || "")).filter(Boolean))];
    const stories = storyIds.length
      ? sqlite
          .prepare(
            `SELECT * FROM stories WHERE id IN (${storyIds.map(() => "?").join(",")}) ORDER BY id`,
          )
          .all(...storyIds)
      : [];
    return { stories, platformPosts };
  } finally {
    sqlite.close();
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const snapshot = args.snapshotPath
    ? await readSnapshot(args.snapshotPath)
    : readSqliteSnapshot(args.dbPath, { storyId: args.storyId });
  const stories = args.storyId
    ? snapshot.stories.filter(
        (story) => String(story?.id || story?.story_id || "") === args.storyId,
      )
    : snapshot.stories;
  const platformPosts = args.storyId
    ? snapshot.platformPosts.filter((row) => String(row?.story_id || "") === args.storyId)
    : snapshot.platformPosts;
  const result = await reconcilePublishedCommercialEvidence({
    generatedAt: args.generatedAt || new Date().toISOString(),
    outputDir: args.outputDir,
    affiliateTag: process.env.AMAZON_AFFILIATE_TAG || "placeholder",
    stories,
    platformPosts,
    clickLogPath: args.clickLogPath,
  });
  if (args.json) console.log(JSON.stringify(result.report, null, 2));
  else console.log(renderMarkdown(result.report).trimEnd());
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[published-commercial-reconciliation] FAILED: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
  readSnapshot,
  readSqliteSnapshot,
  usage,
};

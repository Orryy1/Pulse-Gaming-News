"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..", "..");
const TOOL = path.join(ROOT, "tools", "youtube-analytics-cutover-audit.js");

function temporaryDirectory() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-youtube-analytics-cutover-"),
  );
}

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function createProductionShapeDatabase(
  filePath,
  {
    publishedCount = 6,
    tokenScope = [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ].join(" "),
  } = {},
) {
  const database = new Database(filePath);
  database.exec(`
    CREATE TABLE stories (
      id TEXT PRIMARY KEY,
      channel_id TEXT,
      title TEXT,
      youtube_post_id TEXT,
      youtube_published_at TEXT
    );
    CREATE TABLE platform_posts (
      id INTEGER PRIMARY KEY,
      story_id TEXT NOT NULL,
      channel_id TEXT,
      platform TEXT NOT NULL,
      external_id TEXT,
      external_url TEXT,
      status TEXT NOT NULL,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      stats_fetched_at TEXT,
      published_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE platform_accounts (
      id INTEGER PRIMARY KEY,
      platform TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      external_account_id TEXT,
      handle TEXT,
      token_ref TEXT,
      token_scope TEXT,
      enabled INTEGER DEFAULT 1
    );
  `);
  database
    .prepare(
      `INSERT INTO platform_accounts (
        platform, channel_id, external_account_id, handle, token_ref,
        token_scope, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "youtube",
      "pulse-gaming",
      "UCpulse",
      "private-handle",
      "SUPER_SECRET_TOKEN_REFERENCE",
      tokenScope,
      1,
    );
  const insertStory = database.prepare(
    `INSERT INTO stories (
      id, channel_id, title, youtube_post_id, youtube_published_at
    ) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertPost = database.prepare(
    `INSERT INTO platform_posts (
      story_id, channel_id, platform, external_id, external_url, status,
      views, likes, comments, shares, stats_fetched_at, published_at,
      created_at, updated_at
    ) VALUES (?, ?, 'youtube', ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let index = 1; index <= publishedCount; index += 1) {
    const storyId = `story-${index}`;
    const videoId = `video-${index}`;
    const publishedAt = `2026-07-${String(index).padStart(2, "0")}T19:00:00.000Z`;
    insertStory.run(
      storyId,
      "pulse-gaming",
      `Story ${index}`,
      videoId,
      publishedAt,
    );
    insertPost.run(
      storyId,
      "pulse-gaming",
      videoId,
      `https://youtube.com/shorts/${videoId}`,
      index * 100,
      index * 10,
      index,
      index - 1,
      `2026-07-${String(index + 1).padStart(2, "0")}T08:00:00.000Z`,
      publishedAt,
      publishedAt,
      publishedAt,
    );
  }
  database.close();
}

function runAudit(dbPath, outDir) {
  return execFileSync(
    process.execPath,
    [
      TOOL,
      "--db",
      dbPath,
      "--out",
      outDir,
      "--channel-id",
      "pulse-gaming",
      "--now",
      "2026-07-27T10:00:00.000Z",
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PULSE_OPERATING_MODE: "LOCAL_PROOF",
      },
      encoding: "utf8",
    },
  );
}

test("the offline cutover audit maps exactly five published videos without changing or exposing the database", () => {
  const workspace = temporaryDirectory();
  const dbPath = path.join(workspace, "pulse.db");
  const outDir = path.join(workspace, "proof");
  createProductionShapeDatabase(dbPath);
  const hashBefore = sha256(dbPath);

  runAudit(dbPath, outDir);

  const reportPath = path.join(outDir, "youtube-analytics-cutover-audit.json");
  const markdownPath = path.join(outDir, "youtube-analytics-cutover-audit.md");
  const reportText = fs.readFileSync(reportPath, "utf8");
  const report = JSON.parse(reportText);
  assert.equal(report.video_mappings.length, 5);
  assert.deepEqual(
    report.video_mappings.map((mapping) => mapping.video_id),
    ["video-6", "video-5", "video-4", "video-3", "video-2"],
  );
  assert.equal(report.scope_diagnosis.analytics_readonly, "declared");
  assert.equal(report.safety.database_open_mode, "readonly_query_only");
  assert.equal(report.safety.external_api_calls, 0);
  assert.equal(report.safety.oauth_mutated, false);
  assert.equal(report.safety.database_mutated, false);
  assert.equal(sha256(dbPath), hashBefore);
  assert.equal(reportText.includes("SUPER_SECRET_TOKEN_REFERENCE"), false);
  assert.equal(reportText.includes("private-handle"), false);
  assert.equal(fs.existsSync(markdownPath), true);
});

test("missing Analytics scope metadata stays HOLD and requires reauthorisation", () => {
  const workspace = temporaryDirectory();
  const dbPath = path.join(workspace, "pulse.db");
  const outDir = path.join(workspace, "proof");
  createProductionShapeDatabase(dbPath, {
    tokenScope: "https://www.googleapis.com/auth/youtube.readonly",
  });

  runAudit(dbPath, outDir);

  const report = JSON.parse(
    fs.readFileSync(
      path.join(outDir, "youtube-analytics-cutover-audit.json"),
      "utf8",
    ),
  );
  assert.equal(report.verdict, "HOLD");
  assert.equal(
    report.scope_diagnosis.analytics_readonly,
    "missing_or_unrecorded",
  );
  assert.equal(report.scope_diagnosis.reauthorisation_required, true);
  assert.ok(
    report.blockers.includes(
      "yt_analytics_readonly_scope_missing_or_unrecorded",
    ),
  );
});

test("fewer than five published identities fail the mapping gate explicitly", () => {
  const workspace = temporaryDirectory();
  const dbPath = path.join(workspace, "pulse.db");
  const outDir = path.join(workspace, "proof");
  createProductionShapeDatabase(dbPath, { publishedCount: 4 });

  runAudit(dbPath, outDir);

  const report = JSON.parse(
    fs.readFileSync(
      path.join(outDir, "youtube-analytics-cutover-audit.json"),
      "utf8",
    ),
  );
  assert.equal(report.mapping_status, "blocked");
  assert.equal(report.video_mappings.length, 4);
  assert.ok(
    report.blockers.includes("exactly_five_published_videos_required:found_4"),
  );
});

test("unexpected credential-like values in scope metadata are redacted", () => {
  const workspace = temporaryDirectory();
  const dbPath = path.join(workspace, "pulse.db");
  const outDir = path.join(workspace, "proof");
  createProductionShapeDatabase(dbPath, {
    tokenScope: [
      "https://www.googleapis.com/auth/yt-analytics.readonly",
      "ya29.SUPER_SECRET_ACCESS_TOKEN",
    ].join(" "),
  });

  runAudit(dbPath, outDir);

  const reportText = fs.readFileSync(
    path.join(outDir, "youtube-analytics-cutover-audit.json"),
    "utf8",
  );
  const report = JSON.parse(reportText);
  assert.equal(reportText.includes("SUPER_SECRET_ACCESS_TOKEN"), false);
  assert.equal(report.scope_diagnosis.redacted_scope_entry_count, 1);
  assert.deepEqual(report.scope_diagnosis.recorded_scopes, [
    "https://www.googleapis.com/auth/yt-analytics.readonly",
  ]);
});

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("fs-extra");
const Database = require("better-sqlite3");

const analyticsLoop = require("../../tools/studio-v2-analytics-loop");

function withEnv(key, value, fn) {
  const previous = process.env[key];
  const restore = () => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  };
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
}

function createStoriesDb(dbPath) {
  fs.ensureDirSync(path.dirname(dbPath));
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE stories (
        id TEXT PRIMARY KEY,
        title TEXT,
        hook TEXT,
        classification TEXT,
        flair TEXT,
        breaking_score REAL,
        score REAL,
        youtube_post_id TEXT,
        youtube_url TEXT,
        youtube_published_at TEXT,
        youtube_views INTEGER,
        youtube_likes INTEGER,
        youtube_comments INTEGER,
        tiktok_views INTEGER,
        instagram_views INTEGER,
        virality_score REAL,
        stats_fetched_at TEXT
      );
    `);
    db.prepare(
      `INSERT INTO stories (
        id, title, hook, flair, breaking_score, youtube_post_id,
        youtube_url, youtube_published_at, youtube_views, youtube_likes,
        youtube_comments, virality_score, stats_fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "story1",
      "Metro 2039 reveal",
      "Metro 2039 is real.",
      "Verified",
      84,
      "yt_123",
      "https://youtu.be/yt_123",
      new Date().toISOString(),
      1200,
      80,
      12,
      91,
      new Date().toISOString(),
    );
  } finally {
    db.close();
  }
}

test("studio analytics loop reads stories from canonical SQLITE_DB_PATH", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-analytics-"));
  const dbPath = path.join(tmp, "persistent", "pulse.db");
  try {
    createStoriesDb(dbPath);
    withEnv("SQLITE_DB_PATH", dbPath, () => {
      assert.equal(analyticsLoop.getAnalyticsDbPath(), dbPath);
      const rows = analyticsLoop.loadStories(14);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, "story1");
      assert.equal(rows[0].youtube_post_id, "yt_123");
    });
  } finally {
    fs.removeSync(tmp);
  }
});

test("studio analytics findings default beside the canonical SQLite database", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-findings-"));
  const dbPath = path.join(tmp, "persistent", "pulse.db");
  const expectedFindings = path.join(tmp, "persistent", "analytics_findings.md");
  try {
    fs.ensureDirSync(path.dirname(dbPath));
    await withEnv("SQLITE_DB_PATH", dbPath, () =>
      withEnv("STUDIO_ANALYTICS_FINDINGS_PATH", undefined, async () => {
        assert.equal(analyticsLoop.getFindingsPath(), expectedFindings);
        const out = await analyticsLoop.appendFindings(
          "## Tomorrow's recommendation\nTest sharper source-led hooks.",
          [{ id: "story1" }],
          14,
        );
        assert.equal(out, expectedFindings);
        const text = await fs.readFile(expectedFindings, "utf8");
        assert.match(text, /14-day window, 1 stories/);
        assert.match(text, /Test sharper source-led hooks/);
      }),
    );
  } finally {
    fs.removeSync(tmp);
  }
});

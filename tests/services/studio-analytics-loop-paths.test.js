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

test("studio analytics loop builds deterministic findings when the LLM is unavailable", () => {
  const payload = [
    {
      id: "forza",
      title: "Forza Horizon 6 release timing",
      hook: "Forza Horizon 6 finally has the launch detail players needed.",
      flair: "Verified",
      breakingScore: 84,
      views: 2400,
      likes: 180,
      comments: 30,
      likeToViewRatio: 0.075,
      commentToViewRatio: 0.0125,
      viralityScore: 91,
    },
    {
      id: "playstation",
      title: "State of Play returns Tuesday",
      hook: "State of Play returns Tuesday with a very specific window.",
      flair: "Verified",
      breakingScore: 82,
      views: 1800,
      likes: 100,
      comments: 22,
      likeToViewRatio: 0.0556,
      commentToViewRatio: 0.0122,
      viralityScore: 84,
    },
    {
      id: "reddit-thread",
      title: "What weird mechanics never returned",
      hook: "Players are arguing about a strange design habit.",
      flair: "Discussion",
      breakingScore: 50,
      views: 220,
      likes: 4,
      comments: 1,
      likeToViewRatio: 0.0182,
      commentToViewRatio: 0.0045,
      viralityScore: 12,
    },
    {
      id: "subnautica",
      title: "Subnautica 2 predator balance",
      hook: "Subnautica 2 just clarified a creature balance change.",
      flair: "Verified",
      breakingScore: 77,
      views: 1500,
      likes: 88,
      comments: 15,
      likeToViewRatio: 0.0587,
      commentToViewRatio: 0.01,
      viralityScore: 78,
    },
    {
      id: "lotr",
      title: "Warhorse Lord of the Rings project",
      hook: "Warhorse is working on Lord of the Rings.",
      flair: "Verified",
      breakingScore: 81,
      views: 1700,
      likes: 95,
      comments: 20,
      likeToViewRatio: 0.0559,
      commentToViewRatio: 0.0118,
      viralityScore: 83,
    },
  ];

  const findings = analyticsLoop.buildDeterministicFindings(payload, {
    reason: "Local LLM request failed: paging file too small",
  });

  assert.match(findings, /## Top patterns \(this window\)/);
  assert.match(findings, /forza/);
  assert.match(findings, /## Tomorrow's recommendation/);
  assert.doesNotMatch(findings, /no actionable recommendation produced/i);
  assert.match(findings, /local analysis fallback/i);
  assert.ok(analyticsLoop.extractTomorrowRecommendation(findings).length > 0);
});

test("studio analytics loop falls back instead of throwing when the LLM fails", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-analytics-fallback-"));
  const findingsPath = path.join(tmp, "analytics_findings.md");
  try {
    const payload = [
      {
        id: "forza",
        title: "Forza Horizon 6 release timing",
        hook: "Forza Horizon 6 finally has the launch detail players needed.",
        flair: "Verified",
        breakingScore: 84,
        views: 2400,
        likes: 180,
        comments: 30,
        likeToViewRatio: 0.075,
        commentToViewRatio: 0.0125,
        viralityScore: 91,
      },
      {
        id: "subnautica",
        title: "Subnautica 2 balance update",
        hook: "Subnautica 2 just clarified a creature balance change.",
        flair: "Verified",
        breakingScore: 77,
        views: 1500,
        likes: 88,
        comments: 15,
        likeToViewRatio: 0.0587,
        commentToViewRatio: 0.01,
        viralityScore: 78,
      },
      {
        id: "lotr",
        title: "Warhorse Lord of the Rings project",
        hook: "Warhorse is working on Lord of the Rings.",
        flair: "Verified",
        breakingScore: 81,
        views: 1700,
        likes: 95,
        comments: 20,
        likeToViewRatio: 0.0559,
        commentToViewRatio: 0.0118,
        viralityScore: 83,
      },
      {
        id: "state",
        title: "State of Play returns Tuesday",
        hook: "State of Play returns Tuesday with a specific window.",
        flair: "Verified",
        breakingScore: 82,
        views: 1800,
        likes: 100,
        comments: 22,
        likeToViewRatio: 0.0556,
        commentToViewRatio: 0.0122,
        viralityScore: 84,
      },
      {
        id: "discussion",
        title: "What weird mechanics never returned",
        hook: "Players are arguing about a strange design habit.",
        flair: "Discussion",
        breakingScore: 50,
        views: 220,
        likes: 4,
        comments: 1,
        likeToViewRatio: 0.0182,
        commentToViewRatio: 0.0045,
        viralityScore: 12,
      },
    ];
    const posts = [];

    const result = await analyticsLoop.runAnalyticsLoop({
      args: { days: 14, dry: false },
      loadStoriesFn: () =>
        payload.map((item) => ({
          id: item.id,
          title: item.title,
          hook: item.hook,
          flair: item.flair,
          breaking_score: item.breakingScore,
          youtube_views: item.views,
          youtube_likes: item.likes,
          youtube_comments: item.comments,
          virality_score: item.viralityScore,
          youtube_post_id: `yt_${item.id}`,
          youtube_published_at: new Date().toISOString(),
        })),
      callLlmFn: async () => {
        throw new Error("Local LLM request failed: paging file too small");
      },
      postDiscordFn: async (text) => {
        posts.push(text);
      },
      appendFindingsFn: (findings, rows, days) =>
        analyticsLoop.appendFindings(findings, rows, days, { findingsPath }),
      log: () => {},
    });

    assert.equal(result.usedFallback, true);
    assert.equal(result.payload.length, 5);
    assert.equal(await fs.pathExists(findingsPath), true);
    assert.match(await fs.readFile(findingsPath, "utf8"), /local analysis fallback/i);
    assert.equal(posts.length, 1);
    assert.doesNotMatch(posts[0], /no actionable recommendation produced/i);
    assert.match(posts[0], /Tomorrow:/);
  } finally {
    fs.removeSync(tmp);
  }
});

test("studio analytics loop rejects malformed LLM findings and uses deterministic fallback", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-analytics-malformed-"));
  const findingsPath = path.join(tmp, "analytics_findings.md");
  try {
    const rows = [
      ["forza", "Forza Horizon 6 release timing", "Forza Horizon 6 finally has the launch detail players needed.", "Verified", 2400, 180, 30, 91],
      ["subnautica", "Subnautica 2 balance update", "Subnautica 2 just clarified a creature balance change.", "Verified", 1500, 88, 15, 78],
      ["lotr", "Warhorse Lord of the Rings project", "Warhorse is working on Lord of the Rings.", "Verified", 1700, 95, 20, 83],
      ["state", "State of Play returns Tuesday", "State of Play returns Tuesday with a specific window.", "Verified", 1800, 100, 22, 84],
      ["discussion", "What weird mechanics never returned", "Players are arguing about a strange design habit.", "Discussion", 220, 4, 1, 12],
    ].map(([id, title, hook, flair, views, likes, comments, viralityScore]) => ({
      id,
      title,
      hook,
      flair,
      breaking_score: 80,
      youtube_views: views,
      youtube_likes: likes,
      youtube_comments: comments,
      virality_score: viralityScore,
      youtube_post_id: `yt_${id}`,
      youtube_published_at: new Date().toISOString(),
    }));
    const posts = [];

    const result = await analyticsLoop.runAnalyticsLoop({
      args: { days: 14, dry: false },
      loadStoriesFn: () => rows,
      callLlmFn: async () => [
        "## Top patterns (this window)",
        "The data is mixed.",
        "",
        "## Underperforming patterns",
        "Nothing clear.",
      ].join("\n"),
      postDiscordFn: async (text) => {
        posts.push(text);
      },
      appendFindingsFn: (findings, payload, days) =>
        analyticsLoop.appendFindings(findings, payload, days, { findingsPath }),
      log: () => {},
    });

    assert.equal(result.usedFallback, true);
    assert.match(result.fallbackReason, /missing_actionable_recommendation/);
    assert.match(result.findings, /## Tomorrow's recommendation/);
    assert.doesNotMatch(result.findings, /Nothing clear/);
    assert.equal(posts.length, 1);
    assert.match(posts[0], /Fallback:/);
    assert.doesNotMatch(posts[0], /no actionable recommendation produced/i);
    assert.match(await fs.readFile(findingsPath, "utf8"), /local analysis fallback/i);
  } finally {
    fs.removeSync(tmp);
  }
});

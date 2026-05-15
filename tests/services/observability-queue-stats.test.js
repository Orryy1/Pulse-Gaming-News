"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const {
  getQueueStats,
  getScoringDigest,
  redactQueueError,
} = require("../../lib/observability");

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT,
      story_id TEXT,
      status TEXT,
      requires_gpu INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 50,
      run_at TEXT,
      attempt_count INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      last_error TEXT,
      lease_until TEXT,
      updated_at TEXT
    );

    CREATE TABLE derivatives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT,
      status TEXT
    );

    CREATE TABLE stories (
      id TEXT PRIMARY KEY,
      title TEXT,
      channel_id TEXT
    );

    CREATE TABLE story_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id TEXT,
      channel_id TEXT,
      total INTEGER,
      decision TEXT,
      hard_stops TEXT,
      inputs TEXT,
      scored_at TEXT
    );
  `);
  return db;
}

test("getQueueStats includes redacted recent failed job samples", () => {
  const db = createDb();
  try {
    db.prepare(
      `INSERT INTO jobs
        (kind, story_id, status, attempt_count, max_attempts, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "engage_first_hour",
      "story1",
      "failed",
      3,
      3,
      "Request failed Bearer abc.def.ghi access_token=supersecret",
      "2026-04-29T10:00:00.000Z",
    );
    db.prepare(
      `INSERT INTO jobs (kind, status, run_at, updated_at)
       VALUES ('hunt', 'done', datetime('now'), datetime('now'))`,
    ).run();

    const stats = getQueueStats({ repos: { db } });
    assert.equal(stats.jobs.total, 2);
    assert.equal(stats.jobs.by_status.failed, 1);
    assert.equal(stats.jobs.recent_failed.length, 1);
    assert.equal(stats.jobs.recent_failed[0].kind, "engage_first_hour");
    assert.doesNotMatch(stats.jobs.recent_failed[0].last_error, /abc\.def\.ghi/);
    assert.doesNotMatch(stats.jobs.recent_failed[0].last_error, /supersecret/);
    assert.match(stats.jobs.recent_failed[0].last_error, /\[REDACTED\]/);
  } finally {
    db.close();
  }
});

test("redactQueueError truncates long failures", () => {
  const out = redactQueueError("x".repeat(800));
  assert.equal(out.length, 500);
  assert.match(out, /\.\.\.$/);
});

test("getScoringDigest channel filter falls back from NULL score channel to story channel", () => {
  const db = createDb();
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-05-13T12:00:00.000Z");
    db.prepare(`INSERT INTO stories (id, title, channel_id) VALUES (?, ?, ?)`).run(
      "story-null-score-channel",
      "Xbox CEO responds to player revenue growth",
      "pulse-gaming",
    );
    db.prepare(
      `INSERT INTO story_scores
        (story_id, channel_id, total, decision, hard_stops, inputs, scored_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "story-null-score-channel",
      null,
      72,
      "review",
      "[]",
      null,
      "2026-05-13 10:03:19",
    );

    const digest = getScoringDigest({
      repos: { db },
      sinceHours: 4,
      channelId: "pulse-gaming",
    });

    assert.equal(digest.scored, 1);
    assert.equal(digest.by_decision.review, 1);
    assert.equal(digest.top[0].story_id, "story-null-score-channel");
    assert.equal(digest.near_miss[0].story_id, "story-null-score-channel");
  } finally {
    Date.now = originalNow;
    db.close();
  }
});

test("getScoringDigest counts SQLite timestamps against ISO window values", () => {
  const db = createDb();
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-05-13T12:00:00.000Z");
    db.prepare(`INSERT INTO stories (id, title) VALUES (?, ?)`).run(
      "story1",
      "Reggie says Nintendo stopped selling products on Amazon",
    );
    db.prepare(
      `INSERT INTO story_scores
        (story_id, channel_id, total, decision, hard_stops, inputs, scored_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "story1",
      "pulse-gaming",
      82,
      "auto",
      "[]",
      null,
      "2026-05-13 10:03:19",
    );

    const digest = getScoringDigest({
      repos: { db },
      sinceHours: 4,
      channelId: "pulse-gaming",
    });

    assert.equal(digest.scored, 1);
    assert.equal(digest.by_decision.auto, 1);
    assert.equal(digest.top[0].story_id, "story1");
  } finally {
    Date.now = originalNow;
    db.close();
  }
});

test("getScoringDigest uses latest score per story and hides community near-misses", () => {
  const db = createDb();
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-05-13T12:00:00.000Z");
    db.prepare(`INSERT INTO stories (id, title, channel_id) VALUES (?, ?, ?)`).run(
      "community",
      "What's the best obscure video game you've ever played?",
      "pulse-gaming",
    );
    db.prepare(`INSERT INTO stories (id, title, channel_id) VALUES (?, ?, ?)`).run(
      "real-near-miss",
      "Xbox confirms a dashboard fix for broken graphics drivers",
      "pulse-gaming",
    );
    const insert = db.prepare(
      `INSERT INTO story_scores
        (story_id, channel_id, total, decision, hard_stops, inputs, scored_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      "community",
      "pulse-gaming",
      80,
      "auto",
      "[]",
      null,
      "2026-05-13 09:00:00",
    );
    insert.run(
      "community",
      "pulse-gaming",
      79,
      "review",
      "[]",
      JSON.stringify({ community_discussion_auto_block: "community_discussion_prompt" }),
      "2026-05-13 10:00:00",
    );
    insert.run(
      "real-near-miss",
      "pulse-gaming",
      74,
      "review",
      "[]",
      null,
      "2026-05-13 10:05:00",
    );

    const digest = getScoringDigest({
      repos: { db },
      sinceHours: 4,
      channelId: "pulse-gaming",
    });

    assert.equal(digest.scored, 2);
    assert.equal(digest.by_decision.review, 2);
    assert.deepEqual(
      digest.near_miss.map((row) => row.story_id),
      ["real-near-miss"],
    );
    assert.deepEqual(
      digest.top.map((row) => row.story_id),
      ["community", "real-near-miss"],
    );
  } finally {
    Date.now = originalNow;
    db.close();
  }
});

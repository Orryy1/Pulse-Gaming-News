"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { getQueueStats, redactQueueError } = require("../../lib/observability");

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

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { bind } = require("../../lib/repositories/platform_posts");

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE platform_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id TEXT NOT NULL,
      channel_id TEXT,
      platform TEXT NOT NULL,
      external_id TEXT,
      external_url TEXT,
      status TEXT NOT NULL,
      block_reason TEXT,
      error_message TEXT,
      idempotency_key TEXT,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      stats_fetched_at TEXT,
      published_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX ux_platform_posts_idempotency
      ON platform_posts(idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);
  return db;
}

test("publishing clears stale failure and block evidence from the platform row", () => {
  const db = createDb();
  const posts = bind(db);
  try {
    const row = posts.ensurePending("story-one", "instagram_reel");
    posts.markFailed(row.id, new Error("old upload failed"));
    posts.markPublished(row.id, {
      externalId: "ig-media-one",
      externalUrl: null,
    });

    const published = posts.getByStoryPlatform(
      "story-one",
      "instagram_reel",
    );
    assert.equal(published.status, "published");
    assert.equal(published.external_id, "ig-media-one");
    assert.equal(published.error_message, null);
    assert.equal(published.block_reason, null);
  } finally {
    db.close();
  }
});

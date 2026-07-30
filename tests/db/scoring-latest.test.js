"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Database = require("better-sqlite3");

const {
  bind,
} = require("../../lib/repositories/scoring");

test("latest governed score deterministically returns the last row when timestamps tie", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`
      CREATE TABLE story_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        story_id TEXT NOT NULL,
        channel_id TEXT,
        total INTEGER NOT NULL,
        decision TEXT NOT NULL,
        decision_reason TEXT,
        source_confidence INTEGER,
        story_importance INTEGER,
        freshness INTEGER,
        search_demand INTEGER,
        visual_viability INTEGER,
        originality INTEGER,
        duplicate_safety INTEGER,
        advertiser_safety INTEGER,
        roundup_suitability INTEGER,
        hook_bonus INTEGER,
        diversity_bonus INTEGER,
        repetition_penalty INTEGER,
        hard_stops TEXT,
        inputs TEXT,
        scorer_version TEXT,
        scored_at TEXT NOT NULL
      );
      INSERT INTO story_scores (
        story_id, total, decision, hard_stops, scored_at
      ) VALUES
        ('same-second', 90, 'auto', '[]', '2026-07-30 03:00:00'),
        ('same-second', 90, 'review', '["manual_review"]', '2026-07-30 03:00:00');
    `);

    const latest = bind(db).latest("same-second");

    assert.equal(latest.decision, "review");
    assert.deepEqual(latest.hard_stops, ["manual_review"]);
  } finally {
    db.close();
  }
});

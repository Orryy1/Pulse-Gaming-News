-- 006_scoring.sql
-- Editorial decision engine (Phase 6).
--
-- Each hunted story gets scored against the 100-point rubric from the V4
-- brief. The score breakdown is persisted so later reads can audit
-- *why* a story got AUTO-approved, REVIEWed, REJECTed, or DEFERred.
--
-- One row per (story, scored_at). The most-recent row is the live
-- decision; we keep history so we can retrain weights later.

CREATE TABLE IF NOT EXISTS story_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id TEXT NOT NULL,
  channel_id TEXT,
  total INTEGER NOT NULL,              -- 0..100
  decision TEXT NOT NULL,              -- auto | review | reject | defer
  decision_reason TEXT,                -- short human text
  -- Per-dimension breakdown (rubric from V4 brief)
  source_confidence INTEGER,           -- /25
  story_importance INTEGER,            -- /15
  freshness INTEGER,                   -- /10
  search_demand INTEGER,               -- /10
  visual_viability INTEGER,            -- /10
  originality INTEGER,                 -- /10
  duplicate_safety INTEGER,            -- /10
  advertiser_safety INTEGER,           -- /5
  roundup_suitability INTEGER,         -- /5
  -- Modifiers
  hook_bonus INTEGER DEFAULT 0,
  diversity_bonus INTEGER DEFAULT 0,
  repetition_penalty INTEGER DEFAULT 0,
  -- Hard-stop flags that force REJECT regardless of total
  hard_stops TEXT,                     -- JSON array of flag names
  -- Raw inputs for reproducibility
  inputs TEXT,                         -- JSON snapshot of what went in
  scored_at TEXT NOT NULL DEFAULT (datetime('now')),
  scorer_version TEXT,                 -- e.g. "v1.0"
  FOREIGN KEY (story_id) REFERENCES stories(id),
  FOREIGN KEY (channel_id) REFERENCES channels(id)
);
CREATE INDEX IF NOT EXISTS idx_story_scores_story ON story_scores(story_id);
CREATE INDEX IF NOT EXISTS idx_story_scores_decision ON story_scores(decision);
CREATE INDEX IF NOT EXISTS idx_story_scores_scored ON story_scores(scored_at);

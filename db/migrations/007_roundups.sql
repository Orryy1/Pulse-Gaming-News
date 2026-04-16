-- 007_roundups.sql
-- Weekly longform flagship (Phase 6b).
--
-- A roundup aggregates 6 main_stories + 3 quickfire picks from the week,
-- produces a 10-12 minute narrated video, and publishes it to YouTube
-- long-form (not Shorts). The roundup is the anchor asset for Phase 7
-- repurposing — the same content gets chopped into a teaser short,
-- a community post, and a blog entry.

CREATE TABLE IF NOT EXISTS roundups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  week_start TEXT NOT NULL,            -- ISO date, Monday of the week
  week_end TEXT NOT NULL,              -- ISO date, Sunday
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | scripted | assets_ready | rendered | published
  title TEXT,
  slug TEXT,
  description TEXT,
  thumbnail_prompt TEXT,
  chapters TEXT,                       -- JSON array: [{ title, start_s }]
  script TEXT,                         -- full narration
  cold_open TEXT,
  closing TEXT,
  audio_path TEXT,
  video_path TEXT,
  youtube_video_id TEXT,
  youtube_url TEXT,
  view_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT,
  UNIQUE(channel_id, week_start),
  FOREIGN KEY (channel_id) REFERENCES channels(id)
);

-- Stories included in a roundup, with their slot (main-1..6, quickfire-1..3)
-- and the per-slot script fragment they contributed. One story can appear
-- in at most one roundup per channel (enforced by the UNIQUE index).
CREATE TABLE IF NOT EXISTS roundup_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roundup_id INTEGER NOT NULL,
  story_id TEXT NOT NULL,
  slot TEXT NOT NULL,                  -- main-1..main-6 | quickfire-1..quickfire-3
  chapter_title TEXT,
  chapter_start_s INTEGER,
  segment_script TEXT,
  FOREIGN KEY (roundup_id) REFERENCES roundups(id),
  FOREIGN KEY (story_id) REFERENCES stories(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_roundup_items_slot
  ON roundup_items(roundup_id, slot);
CREATE UNIQUE INDEX IF NOT EXISTS ux_roundup_items_story_channel
  ON roundup_items(roundup_id, story_id);

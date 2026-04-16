-- 008_audio_packs.sql
-- Owned audio identity system (Phase 9).
--
-- A channel's audio identity is a pack of stems: intro sting, outro sting,
-- lower-third transitions, flair chimes, breaking-news bed, bumper bed.
-- Each pack row catalogs the files (relative to the pack's root directory)
-- and the renderer pulls them by role rather than hard-coding paths.
-- This is what lets Sleepy Stories and Pulse Gaming swap audio identities
-- without touching assemble.js.

CREATE TABLE IF NOT EXISTS audio_packs (
  id TEXT PRIMARY KEY,                 -- e.g. "pulse-v1"
  channel_id TEXT NOT NULL,
  name TEXT,
  root_path TEXT NOT NULL,             -- filesystem root, relative to repo
  bpm INTEGER,
  key_signature TEXT,
  license TEXT,                        -- "owned" | cc-by | commercial | etc.
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (channel_id) REFERENCES channels(id)
);

CREATE TABLE IF NOT EXISTS audio_pack_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pack_id TEXT NOT NULL,
  role TEXT NOT NULL,                  -- intro | outro | bed | sting_verified | sting_rumour | sting_breaking | transition | bumper
  filename TEXT NOT NULL,              -- relative to audio_packs.root_path
  duration_ms INTEGER,
  loudness_lufs REAL,
  notes TEXT,
  FOREIGN KEY (pack_id) REFERENCES audio_packs(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_audio_pack_role
  ON audio_pack_assets(pack_id, role);

-- Close the loop from 002: channels can now point at an audio_pack.
-- Can't ALTER to add FK with references in SQLite, so we enforce in code.

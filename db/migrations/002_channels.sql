-- 002_channels.sql
-- Persist channel config (pulse-gaming, stacked, the-signal, ...)
-- Previously lived only as JS files in channels/. Moving the runtime
-- identity of each channel into the DB lets us flip voice/palette/cadence
-- per channel without a deploy, and lets the worker bridge tell a remote
-- machine which channel it is servicing.
--
-- NOTE: the .js files stay in channels/ as the static default. Rows in
-- this table override those defaults if present. A row is created for
-- each channel the first time lib/channels.js sees it.

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,              -- pulse-gaming | stacked | the-signal
  name TEXT NOT NULL,
  niche TEXT,
  tagline TEXT,
  palette_hex TEXT,                 -- e.g. #FF6B1A
  voice_id TEXT,                    -- ElevenLabs voice id (mapped in tts_server/voices.json too)
  voice_alias TEXT,                 -- friendly name: liam, christopher, etc.
  audio_pack_id TEXT,               -- FK to audio_packs.id (see 008)
  publish_cadence TEXT,             -- JSON: { hunt_times_utc:[...], produce_utc, publish_utc }
  sla_minutes INTEGER DEFAULT 1440, -- how old can a hunt be before we skip it
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Channels attach to stories so we can run multiple brands from one DB.
-- Nullable on stories today; populated by the processor going forward.
ALTER TABLE stories ADD COLUMN channel_id TEXT REFERENCES channels(id);
CREATE INDEX IF NOT EXISTS idx_stories_channel ON stories(channel_id);

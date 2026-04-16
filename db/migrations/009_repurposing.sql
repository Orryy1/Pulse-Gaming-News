-- 009_repurposing.sql
-- Repurposing loop (Phase 7).
--
-- Every roundup spawns derivatives: a ~45s teaser short, a community
-- post image+text, a blog post, and (optionally) individual
-- per-main-story shorts. The table tracks each derivative's lifecycle
-- independently so one failed blog build doesn't block teaser publication.

CREATE TABLE IF NOT EXISTS derivatives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_kind TEXT NOT NULL,           -- roundup | story
  source_id INTEGER NOT NULL,          -- roundups.id or stories.id (stories.id is TEXT — stored as INT rowid via external join)
  source_story_id TEXT,                -- set when source_kind='story'
  kind TEXT NOT NULL,                  -- teaser_short | community_post | blog_post | story_short
  channel_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | generated | rendered | published | failed
  script TEXT,
  asset_path TEXT,
  external_id TEXT,                    -- youtube id, blog slug, community post id
  external_url TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  error_message TEXT,
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  FOREIGN KEY (source_story_id) REFERENCES stories(id)
);
CREATE INDEX IF NOT EXISTS idx_derivatives_source
  ON derivatives(source_kind, source_id);
CREATE INDEX IF NOT EXISTS idx_derivatives_status ON derivatives(status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_derivatives_source_kind
  ON derivatives(source_kind, source_id, kind, channel_id);

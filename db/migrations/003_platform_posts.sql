-- 003_platform_posts.sql
-- Normalise per-platform publication records so we stop cramming
-- five `<platform>_post_id` columns + their stats onto the stories table.
--
-- The denormalised columns on stories stay for backwards-compat readers,
-- but new code should write through lib/repositories/platform_posts.js.
-- An idempotency-key uniqueness guard here is the single enforceable
-- barrier against duplicate Reels/Stories (the publisher.js bug we just
-- fixed did its own in-process check; the DB now backstops it).

CREATE TABLE IF NOT EXISTS platform_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id TEXT NOT NULL,
  channel_id TEXT,
  platform TEXT NOT NULL,      -- youtube | tiktok | instagram_reel | instagram_story | facebook_reel | facebook_story | twitter_video | twitter_image
  external_id TEXT,            -- the real platform id. MUST NOT be a marker string like "DUPE_BLOCKED".
  external_url TEXT,
  status TEXT NOT NULL,        -- pending | uploading | published | blocked | failed
  block_reason TEXT,           -- populated when status=blocked (e.g. "dupe-title")
  error_message TEXT,          -- populated when status=failed
  idempotency_key TEXT,        -- client-generated hash of (story_id,platform,channel_id)
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  stats_fetched_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (story_id) REFERENCES stories(id),
  FOREIGN KEY (channel_id) REFERENCES channels(id)
);

-- One successful post per (story, platform) — hard guard against doubles.
CREATE UNIQUE INDEX IF NOT EXISTS ux_platform_posts_story_platform_published
  ON platform_posts(story_id, platform)
  WHERE status = 'published';

-- Idempotency keys are unique across the whole table when set.
CREATE UNIQUE INDEX IF NOT EXISTS ux_platform_posts_idempotency
  ON platform_posts(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_platform_posts_story ON platform_posts(story_id);
CREATE INDEX IF NOT EXISTS idx_platform_posts_status ON platform_posts(status);

-- Platform account credentials / tokens keyed to (platform, channel_id).
-- Tokens themselves live in the existing tokens/ directory — this table
-- only tracks metadata (last-refresh, next-refresh, token scope).
CREATE TABLE IF NOT EXISTS platform_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  external_account_id TEXT,      -- IG business id, FB page id, YT channel id, etc.
  handle TEXT,                    -- display handle (for logs)
  token_ref TEXT,                 -- filesystem path or env var name — NOT the token itself
  token_scope TEXT,
  token_refreshed_at TEXT,
  token_expires_at TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(platform, channel_id)
);

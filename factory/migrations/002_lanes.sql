-- Lanes and cadence: news Shorts fill fixed daily slots, a reserved breaking
-- lane fires on huge official stories, discovery runs on its own clock and
-- YouTube API quota is metered per Pacific day.

ALTER TABLE episodes ADD COLUMN IF NOT EXISTS lane TEXT NOT NULL DEFAULT 'news';
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 50;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS slot_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS episodes_lane_idx ON episodes (lane, created_at);

-- Every story cluster the discovery poll has seen, with when it was first seen,
-- so "breaking" can mean "first appeared minutes ago" rather than "newest item".
CREATE TABLE IF NOT EXISTS cluster_sightings (
  hash         TEXT PRIMARY KEY,
  headline     TEXT NOT NULL,
  first_seen   TIMESTAMPTZ NOT NULL,
  last_seen    TIMESTAMPTZ NOT NULL,
  item_count   INTEGER NOT NULL,
  has_official BOOLEAN NOT NULL,
  max_score    INTEGER NOT NULL,
  cluster_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS cluster_sightings_seen_idx ON cluster_sightings (last_seen);

-- Breaking Shorts fired, for the per-franchise cooldown.
CREATE TABLE IF NOT EXISTS breaking_log (
  story_hash TEXT PRIMARY KEY,
  franchise  TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  fired_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- YouTube Data API units spent per Pacific calendar day (the quota resets at midnight Pacific).
CREATE TABLE IF NOT EXISTS quota_ledger (
  day        TEXT PRIMARY KEY,
  units      INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

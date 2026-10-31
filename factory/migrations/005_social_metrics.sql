-- Every other platform's numbers for the Shorts we post there, so the channel learns from them too.
-- Per post: one row per age (1h, 24h, 72h, 7d after it went out on that platform). Per account: one
-- row a day under post_id 'account' with the day (YYYY-MM-DD, local) as its label. Instagram, Facebook
-- and Threads are read through their APIs; TikTok arrives from the TikTok Studio browser routine.

CREATE TABLE IF NOT EXISTS social_metrics (
  platform            TEXT NOT NULL,            -- instagram | facebook | threads | tiktok
  post_id             TEXT NOT NULL,            -- the platform's id for the post, or 'account'
  episode_id          TEXT,
  youtube_video_id    TEXT,
  label               TEXT NOT NULL,            -- 1h, 24h, 72h, 7d; a day for account rows
  captured_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  views               INTEGER,                  -- plays or views, as the platform counts them
  reach               INTEGER,
  likes               INTEGER,
  comments            INTEGER,
  shares              INTEGER,
  saves               INTEGER,
  avg_watch_seconds   REAL,
  total_watch_seconds REAL,
  follows             INTEGER,                  -- followers gained from the post (account rows: net growth)
  extra               JSONB,                    -- anything else the platform gave (traffic sources, hours, countries)
  PRIMARY KEY (platform, post_id, label)
);
CREATE INDEX IF NOT EXISTS social_metrics_episode_idx ON social_metrics (episode_id);
CREATE INDEX IF NOT EXISTS social_metrics_platform_idx ON social_metrics (platform, label, captured_at);

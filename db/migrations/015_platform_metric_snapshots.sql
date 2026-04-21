-- 015_platform_metric_snapshots.sql
-- Canonical time-series table for per-platform, per-story engagement
-- metrics. Complements the existing analytics_snapshots table, which
-- stored one row per story and was overwritten each poll (so historical
-- deltas were lost). This table appends a new row per snapshot so the
-- feedback-loop work in docs/analytics-feedback-loop.md has proper
-- time-series data to work from.
--
-- Intentionally minimal: every field above raw_json is optional. Not
-- every platform exposes every signal (TikTok has shares, YouTube
-- has watch-through, Instagram has reach). Callers that have a
-- metric store it; the rest stays NULL.
--
-- channel_id defaults to 'pulse-gaming' so rows written before the
-- multi-channel rollout (docs/channel-isolation-audit.md) still
-- carry a tag — same approach as migration 014 took for stories.

CREATE TABLE IF NOT EXISTS platform_metric_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id      TEXT    NOT NULL,
  platform      TEXT    NOT NULL,       -- youtube | tiktok | instagram | facebook | twitter
  external_id   TEXT,                   -- platform-native post id (not FK, platforms may overlap)
  snapshot_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  channel_id    TEXT    NOT NULL DEFAULT 'pulse-gaming',
  views         INTEGER,
  likes         INTEGER,
  comments      INTEGER,
  shares        INTEGER,
  watch_time_seconds   REAL,            -- e.g. YouTube analytics avg view duration
  retention_percent    REAL,            -- averageViewPercentage / full_video_watched_rate
  raw_json      TEXT                    -- full source response for forensic/debug
);

CREATE INDEX IF NOT EXISTS idx_pms_story  ON platform_metric_snapshots(story_id);
CREATE INDEX IF NOT EXISTS idx_pms_time   ON platform_metric_snapshots(snapshot_at);
CREATE INDEX IF NOT EXISTS idx_pms_chan   ON platform_metric_snapshots(channel_id, snapshot_at);
CREATE INDEX IF NOT EXISTS idx_pms_platform ON platform_metric_snapshots(platform, snapshot_at);

-- Performance Intelligence Loop v1
-- Local-only schema for conservative analysis and recommendations.
-- These tables are intentionally append-only where possible.

CREATE TABLE IF NOT EXISTS video_performance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL,
  story_id TEXT,
  channel_id TEXT NOT NULL DEFAULT 'pulse-gaming',
  platform TEXT NOT NULL DEFAULT 'youtube',
  title TEXT,
  publish_time TEXT,
  snapshot_label TEXT NOT NULL,
  snapshot_at TEXT NOT NULL DEFAULT (datetime('now')),
  views INTEGER,
  watch_time_seconds REAL,
  average_view_duration_seconds REAL,
  average_percentage_viewed REAL,
  likes INTEGER,
  comments INTEGER,
  subscribers_gained INTEGER,
  traffic_source TEXT,
  shorts_feed_views INTEGER,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_perf_snapshots_video
  ON video_performance_snapshots(video_id, snapshot_at);

CREATE TABLE IF NOT EXISTS video_features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL,
  story_id TEXT,
  channel_id TEXT NOT NULL DEFAULT 'pulse-gaming',
  topic TEXT,
  franchise TEXT,
  story_type TEXT,
  hook_type TEXT,
  title_pattern TEXT,
  runtime_seconds REAL,
  render_version TEXT,
  source_mix_json TEXT,
  clip_ratio REAL,
  still_ratio REAL,
  card_ratio REAL,
  hero_moment_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_video_features_video
  ON video_features(video_id);

CREATE TABLE IF NOT EXISTS comment_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT,
  story_id TEXT,
  comment_id TEXT,
  channel_id TEXT NOT NULL DEFAULT 'pulse-gaming',
  category TEXT NOT NULL,
  decision TEXT NOT NULL,
  sentiment TEXT,
  useful_signal TEXT,
  reply_draft TEXT,
  needs_manual_review INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hook_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hook_type TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  average_score REAL,
  average_retention REAL,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS topic_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  average_score REAL,
  average_retention REAL,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS render_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  render_version TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  average_score REAL,
  average_retention REAL,
  average_clip_ratio REAL,
  average_hero_moments REAL,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS learning_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recommendation_type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'review',
  recommendation TEXT NOT NULL,
  evidence_json TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS experiment_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_key TEXT NOT NULL,
  video_id TEXT,
  story_id TEXT,
  channel_id TEXT NOT NULL DEFAULT 'pulse-gaming',
  hypothesis TEXT NOT NULL,
  variant TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

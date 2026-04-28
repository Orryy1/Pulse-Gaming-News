-- 017_intelligence_layer.sql
-- Session 3 — local intelligence/analytics/monetisation schema.
--
-- Promotes the previously-stand-alone `lib/performance/schema.sql`
-- into a versioned migration and adds the three tables Session 3
-- demands that were missing: format_performance_summary,
-- topic_performance_summary, comment_signal_summary.
--
-- All tables are append-only or upsert-on-aggregate. Nothing here
-- runs against the production DB until the operator explicitly
-- applies the migrations on a Railway deploy. The fixture-mode
-- analytics client populates these tables locally for prototype
-- digests; the real-mode client requires an OAuth re-auth with
-- yt-analytics.readonly added (see PULSE_INTELLIGENCE_MONETISATION_PASS.md
-- for the scope list).
--
-- Snapshot labels supported: +1h, +3h, +24h, +72h, +7d, +28d.

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
CREATE INDEX IF NOT EXISTS idx_perf_snapshots_label
  ON video_performance_snapshots(snapshot_label, snapshot_at);

CREATE TABLE IF NOT EXISTS video_features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL,
  story_id TEXT,
  channel_id TEXT NOT NULL DEFAULT 'pulse-gaming',
  topic TEXT,
  franchise TEXT,
  story_type TEXT,
  format_type TEXT,
  hook_type TEXT,
  title_pattern TEXT,
  runtime_seconds REAL,
  render_version TEXT,
  source_mix_json TEXT,
  clip_ratio REAL,
  still_ratio REAL,
  card_ratio REAL,
  hero_moment_count INTEGER DEFAULT 0,
  media_inventory_class TEXT,
  source_diversity INTEGER,
  thumbnail_safety_status TEXT,
  visual_qa_class TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_video_features_video
  ON video_features(video_id);
CREATE INDEX IF NOT EXISTS idx_video_features_format
  ON video_features(format_type, channel_id);

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

CREATE INDEX IF NOT EXISTS idx_comment_insights_video
  ON comment_insights(video_id, decision);

CREATE TABLE IF NOT EXISTS comment_signal_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL DEFAULT 'pulse-gaming',
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  total_comments INTEGER DEFAULT 0,
  hype_count INTEGER DEFAULT 0,
  support_count INTEGER DEFAULT 0,
  correction_count INTEGER DEFAULT 0,
  disagreement_count INTEGER DEFAULT 0,
  useful_criticism_count INTEGER DEFAULT 0,
  topic_suggestion_count INTEGER DEFAULT 0,
  question_count INTEGER DEFAULT 0,
  joke_meme_count INTEGER DEFAULT 0,
  hostile_useful_count INTEGER DEFAULT 0,
  abuse_spam_count INTEGER DEFAULT 0,
  noise_count INTEGER DEFAULT 0,
  draft_reply_candidates INTEGER DEFAULT 0,
  needs_review_count INTEGER DEFAULT 0,
  moderation_review_count INTEGER DEFAULT 0,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(channel_id, window_start, window_end)
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

CREATE TABLE IF NOT EXISTS format_performance_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  format_id TEXT NOT NULL,
  channel_id TEXT NOT NULL DEFAULT 'pulse-gaming',
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  median_views INTEGER,
  median_avp REAL,
  median_avd_seconds REAL,
  median_subscribers_gained INTEGER,
  best_video_id TEXT,
  worst_video_id TEXT,
  notes TEXT,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(format_id, channel_id, window_start, window_end)
);

CREATE TABLE IF NOT EXISTS topic_performance_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  channel_id TEXT NOT NULL DEFAULT 'pulse-gaming',
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  median_views INTEGER,
  median_avp REAL,
  median_subscribers_gained INTEGER,
  notes TEXT,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(topic, channel_id, window_start, window_end)
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

CREATE TABLE IF NOT EXISTS experiment_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_key TEXT NOT NULL,
  video_id TEXT,
  story_id TEXT,
  channel_id TEXT NOT NULL DEFAULT 'pulse-gaming',
  hypothesis TEXT NOT NULL,
  variant TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  result_summary TEXT,
  result_evidence_json TEXT,
  concluded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_experiment_results_key
  ON experiment_results(experiment_key, status);

CREATE TABLE IF NOT EXISTS monetisation_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL DEFAULT 'pulse-gaming',
  milestone_key TEXT NOT NULL,
  milestone_label TEXT NOT NULL,
  threshold_kind TEXT NOT NULL,
  current_value REAL,
  threshold_value REAL,
  unlock_path TEXT,
  notes TEXT,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(channel_id, milestone_key, generated_at)
);

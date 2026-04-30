-- 018_live_performance_model.sql
-- Live continuous-analysis model state + signals.
--
-- Two new tables:
--
-- live_performance_signals — append-only stream of outlier / inflection
--   events detected by lib/intelligence/live-performance-analyst.js.
--   Each row is one event ("story X is performing 2.4σ above predicted
--   at +1h", "story Y views are flatlining at +3h", etc). The dashboard
--   reads from this for the live "what's working right now" view; the
--   morning digest summarises the last 24h of signals.
--
-- live_model_state — single-row-per-feature persistent state for the
--   incremental regression. Storing the coefficients lets the model
--   carry learning across container restarts on Railway. Each row is
--   one (feature_kind, feature_value) pair (e.g. hook_type=question)
--   with a running mean / variance / sample count.
--
-- Both are append-or-upsert with no foreign keys so a hot DB doesn't
-- get blocked by referential integrity churn during the 30-min
-- analyst tick. Stories table is the source of truth; these tables
-- are derived signal.

CREATE TABLE IF NOT EXISTS live_performance_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id TEXT NOT NULL,
  channel_id TEXT NOT NULL DEFAULT 'pulse-gaming',
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  signal_kind TEXT NOT NULL,
  -- e.g. 'outlier_overperform' / 'outlier_underperform' /
  -- 'engagement_inflection' / 'retention_drop' / 'first_hour_breakout'
  severity REAL NOT NULL DEFAULT 0,
  -- positive = good (overperforming); negative = bad (underperforming).
  -- Magnitude = number of standard deviations from predicted.
  metric TEXT NOT NULL,
  -- e.g. 'views' / 'comments_per_view' / 'avg_view_pct'
  observed_value REAL,
  predicted_value REAL,
  features_json TEXT,
  -- snapshot of (hook_type, topic, content_pillar, source_type, etc.)
  -- at detection time so the morning digest can attribute the signal
  -- back to the originating feature combination.
  notified_at TEXT,
  -- nullable. Set by the discord poster when the signal is sent.
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_live_signals_story
  ON live_performance_signals (story_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_signals_kind
  ON live_performance_signals (signal_kind, detected_at DESC);

CREATE TABLE IF NOT EXISTS live_model_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_kind TEXT NOT NULL,
  -- 'hook_type' / 'topic' / 'content_pillar' / 'source_type' /
  -- 'publish_hour_utc' / 'render_quality_class' / 'comment_source_type'
  feature_value TEXT NOT NULL,
  metric TEXT NOT NULL,
  -- which dependent variable this state is tracking
  -- ('views_at_24h' / 'avg_view_pct' / 'comments_per_view' / etc.)
  sample_count INTEGER NOT NULL DEFAULT 0,
  running_mean REAL NOT NULL DEFAULT 0,
  running_m2 REAL NOT NULL DEFAULT 0,
  -- Welford's online variance accumulator. Variance =
  -- running_m2 / sample_count (for population). Lets the analyst
  -- compute σ for outlier detection without re-reading every snapshot.
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (feature_kind, feature_value, metric)
);

CREATE INDEX IF NOT EXISTS idx_live_model_state_kind
  ON live_model_state (feature_kind, metric);

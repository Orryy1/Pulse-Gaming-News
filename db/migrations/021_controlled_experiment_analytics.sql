-- 021_controlled_experiment_analytics.sql
-- Immutable experiment design and evidence-backed YouTube analytics snapshots.
-- This migration only creates local persistence. It performs no OAuth, network
-- or platform operation.

CREATE TABLE IF NOT EXISTS controlled_video_experiments (
  experiment_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  matrix_version TEXT NOT NULL,
  assignment_policy TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (channel_id) REFERENCES channels(id)
);

CREATE TABLE IF NOT EXISTS controlled_video_experiment_cells (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 12),
  cell_key TEXT NOT NULL,
  editorial_lane TEXT NOT NULL CHECK (
    editorial_lane IN (
      'what_changes_for_players',
      'trailer_truth_check',
      'platform_pulse'
    )
  ),
  hook_type TEXT NOT NULL CHECK (hook_type IN ('direct', 'open_loop')),
  duration_band TEXT NOT NULL CHECK (duration_band IN ('short', 'standard')),
  runtime_min_seconds INTEGER NOT NULL CHECK (runtime_min_seconds > 0),
  runtime_max_seconds INTEGER NOT NULL CHECK (
    runtime_max_seconds >= runtime_min_seconds
  ),
  story_id TEXT,
  video_id TEXT,
  assigned_at TEXT,
  creative_manifest_json TEXT,
  creative_manifest_sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (experiment_id)
    REFERENCES controlled_video_experiments(experiment_id),
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  FOREIGN KEY (story_id) REFERENCES stories(id),
  CHECK (
    (
      story_id IS NULL
      AND video_id IS NULL
      AND assigned_at IS NULL
      AND creative_manifest_json IS NULL
      AND creative_manifest_sha256 IS NULL
    )
    OR
    (
      story_id IS NOT NULL
      AND video_id IS NOT NULL
      AND assigned_at IS NOT NULL
      AND creative_manifest_json IS NOT NULL
      AND creative_manifest_sha256 IS NOT NULL
      AND length(creative_manifest_sha256) = 64
      AND creative_manifest_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  UNIQUE (experiment_id, ordinal),
  UNIQUE (experiment_id, cell_key),
  UNIQUE (
    experiment_id,
    editorial_lane,
    hook_type,
    duration_band
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_controlled_experiment_video
  ON controlled_video_experiment_cells(channel_id, video_id)
  WHERE video_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_controlled_video_experiments_immutable_update
BEFORE UPDATE ON controlled_video_experiments
BEGIN
  SELECT RAISE(ABORT, 'immutable_controlled_video_experiments');
END;

CREATE TRIGGER IF NOT EXISTS trg_controlled_video_experiments_immutable_delete
BEFORE DELETE ON controlled_video_experiments
BEGIN
  SELECT RAISE(ABORT, 'immutable_controlled_video_experiments');
END;

CREATE TRIGGER IF NOT EXISTS trg_controlled_experiment_cells_no_delete
BEFORE DELETE ON controlled_video_experiment_cells
BEGIN
  SELECT RAISE(ABORT, 'immutable_controlled_experiment_cells');
END;

CREATE TRIGGER IF NOT EXISTS trg_controlled_experiment_cells_assignment_once
BEFORE UPDATE ON controlled_video_experiment_cells
WHEN OLD.video_id IS NOT NULL
  OR OLD.story_id IS NOT NULL
  OR OLD.assigned_at IS NOT NULL
  OR OLD.creative_manifest_json IS NOT NULL
  OR OLD.creative_manifest_sha256 IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'immutable_controlled_experiment_assignment');
END;

CREATE TRIGGER IF NOT EXISTS trg_controlled_experiment_cell_design_immutable
BEFORE UPDATE ON controlled_video_experiment_cells
WHEN NEW.experiment_id <> OLD.experiment_id
  OR NEW.channel_id <> OLD.channel_id
  OR NEW.ordinal <> OLD.ordinal
  OR NEW.cell_key <> OLD.cell_key
  OR NEW.editorial_lane <> OLD.editorial_lane
  OR NEW.hook_type <> OLD.hook_type
  OR NEW.duration_band <> OLD.duration_band
  OR NEW.runtime_min_seconds <> OLD.runtime_min_seconds
  OR NEW.runtime_max_seconds <> OLD.runtime_max_seconds
BEGIN
  SELECT RAISE(ABORT, 'immutable_controlled_experiment_cell_design');
END;

CREATE TABLE IF NOT EXISTS youtube_analytics_experiment_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id TEXT NOT NULL,
  experiment_cell_id INTEGER NOT NULL,
  channel_id TEXT NOT NULL,
  youtube_channel_id TEXT NOT NULL,
  story_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  snapshot_window TEXT NOT NULL CHECK (
    snapshot_window IN ('24h', '48h', '7d')
  ),
  published_at TEXT NOT NULL,
  snapshot_due_at TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  source_system TEXT NOT NULL DEFAULT 'youtube_analytics_api_readonly',
  source_fingerprint TEXT NOT NULL,
  observed_metrics_json TEXT NOT NULL,
  source_request_json TEXT NOT NULL,
  source_payload_json TEXT NOT NULL,
  views INTEGER,
  engaged_views INTEGER,
  shown_in_feed INTEGER,
  stayed_to_watch_percent REAL,
  swiped_away_percent REAL,
  retention_1_second_percent REAL,
  retention_3_second_percent REAL,
  retention_10_second_percent REAL,
  retention_25_percent REAL,
  retention_50_percent REAL,
  retention_75_percent REAL,
  retention_90_percent REAL,
  completion_percent REAL,
  average_view_duration_seconds REAL,
  average_percentage_viewed REAL,
  watch_hours REAL,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  saves INTEGER,
  subscribers_gained INTEGER,
  subscribers_lost INTEGER,
  new_viewers INTEGER,
  returning_viewers INTEGER,
  traffic_sources_json TEXT,
  retention_curve_json TEXT,
  country_breakdown_json TEXT,
  age_breakdown_json TEXT,
  device_breakdown_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (experiment_id)
    REFERENCES controlled_video_experiments(experiment_id),
  FOREIGN KEY (experiment_cell_id)
    REFERENCES controlled_video_experiment_cells(id),
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  FOREIGN KEY (story_id) REFERENCES stories(id),
  UNIQUE (
    experiment_id,
    channel_id,
    youtube_channel_id,
    video_id,
    snapshot_window
  )
);

CREATE INDEX IF NOT EXISTS idx_youtube_experiment_snapshots_cell
  ON youtube_analytics_experiment_snapshots(experiment_cell_id, collected_at);

CREATE INDEX IF NOT EXISTS idx_youtube_experiment_snapshots_window
  ON youtube_analytics_experiment_snapshots(
    experiment_id,
    snapshot_window,
    collected_at
  );

CREATE TRIGGER IF NOT EXISTS trg_youtube_experiment_snapshots_immutable_update
BEFORE UPDATE ON youtube_analytics_experiment_snapshots
BEGIN
  SELECT RAISE(ABORT, 'immutable_youtube_experiment_snapshots');
END;

CREATE TRIGGER IF NOT EXISTS trg_youtube_experiment_snapshots_immutable_delete
BEFORE DELETE ON youtube_analytics_experiment_snapshots
BEGIN
  SELECT RAISE(ABORT, 'immutable_youtube_experiment_snapshots');
END;

-- Public performance of every published Short, captured at fixed ages after
-- it went live (videos.list: one quota unit per fifty videos). The retention
-- curve and engaged views need the analytics scope and come later.

CREATE TABLE IF NOT EXISTS video_metrics (
  episode_id  TEXT NOT NULL,
  label       TEXT NOT NULL,            -- 1h, 3h, 24h, 72h, 7d, 28d after publish
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  views       INTEGER NOT NULL DEFAULT 0,
  likes       INTEGER NOT NULL DEFAULT 0,
  comments    INTEGER NOT NULL DEFAULT 0,
  raw         JSONB,
  PRIMARY KEY (episode_id, label)
);
CREATE INDEX IF NOT EXISTS video_metrics_label_idx ON video_metrics (label, captured_at);

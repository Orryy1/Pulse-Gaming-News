-- Pulse cloud factory: one episodes state machine plus a small settings store.

CREATE TABLE IF NOT EXISTS episodes (
  id                 TEXT PRIMARY KEY,
  story_hash         TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL,
  story_json         JSONB NOT NULL,
  script_json        JSONB,
  factcheck_json     JSONB,
  assets_json        JSONB,
  qa_json            JSONB,
  approval_mode      TEXT,
  approved_by        TEXT,
  approval_requested_at TIMESTAMPTZ,
  upload_session_uri TEXT,
  youtube_video_id   TEXT UNIQUE,
  youtube_status     TEXT,
  publish_at         TIMESTAMPTZ,
  attempts           INTEGER NOT NULL DEFAULT 0,
  last_error         TEXT,
  next_attempt_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS episodes_status_idx ON episodes (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS episodes_created_idx ON episodes (created_at);

-- Every story the selector has looked at, so a rejected story is never re-picked.
CREATE TABLE IF NOT EXISTS seen_stories (
  story_hash TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  decision   TEXT NOT NULL,
  reason     TEXT,
  seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id         BIGSERIAL PRIMARY KEY,
  episode_id TEXT,
  kind       TEXT NOT NULL,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lease-based mutex (works across pooled connections and replicas).
CREATE TABLE IF NOT EXISTS leases (
  name       TEXT PRIMARY KEY,
  holder     TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

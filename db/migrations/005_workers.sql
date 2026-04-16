-- 005_workers.sql
-- Worker registry for the hybrid cloud/local bridge (Phase 4/5 of the V4 brief).
--
-- Each physical host that processes jobs registers itself here. The cloud
-- API (cloud.js) surfaces /api/jobs/claim and /api/jobs/heartbeat endpoints;
-- the local worker daemon polls them. The cloud never pushes to the local
-- box — the local worker owns outbound connectivity so the user can keep
-- firewalls locked down.
--
-- Capabilities are a comma-separated tag list — the cloud filters the
-- job pool by matching job.requires_gpu + job.kind against worker tags
-- before it hands over a row.

CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,               -- e.g. "pc-orry-rtx4090"
  display_name TEXT,
  host_os TEXT,                      -- windows | linux | macos
  tags TEXT,                         -- JSON array: ["gpu:rtx4090","tts:voxcpm","video:ffmpeg-nvenc"]
  max_concurrent_jobs INTEGER DEFAULT 1,
  last_seen_at TEXT,
  last_job_id INTEGER,
  status TEXT DEFAULT 'offline',     -- offline | idle | busy | draining | locked
  version TEXT,                      -- worker package version
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);

-- Power / presence events — used by the power-aware worker (Phase 5).
-- The worker logs wake/sleep/idle-enter/idle-exit/protected-app-seen so
-- the operator can audit whether overnight jobs actually ran.
CREATE TABLE IF NOT EXISTS worker_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id TEXT NOT NULL,
  kind TEXT NOT NULL,                -- wake | sleep | idle | busy | protected_app | gpu_claimed | gpu_released | error
  payload TEXT,                      -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (worker_id) REFERENCES workers(id)
);
CREATE INDEX IF NOT EXISTS idx_worker_events_worker ON worker_events(worker_id);
CREATE INDEX IF NOT EXISTS idx_worker_events_created ON worker_events(created_at);

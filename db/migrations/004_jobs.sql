-- 004_jobs.sql
-- Durable job queue. Replaces the scatter of node-cron handlers + setTimeout
-- chains that currently drive the hunt/produce/publish pipeline.
--
-- Producers call jobs_repo.enqueue({ kind, payload, run_at, ... }).
-- Workers claim rows via an atomic UPDATE ... RETURNING pattern (see
-- lib/repositories/jobs.js). Every claim increments attempt_count and
-- refreshes claimed_at; the heartbeat reaper in lib/jobs.js returns any
-- job whose claimed_at drifted past lease_until back to status=pending.
--
-- Why a rows-as-jobs queue rather than cron-as-jobs:
--   * Cron forgets: if the host was asleep at 06:00 the hunt never happens.
--     Jobs persist; the worker picks them up late.
--   * Cron has no visibility: we currently have no "which jobs failed yesterday?"
--     answer. job_runs retains the full history.
--   * Cron can't coordinate across cloud + local worker — a job row can be
--     claimed by whichever worker pulls first.

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                -- hunt | process | image | audio | assemble | publish | roundup | repurpose | analytics | engage
  channel_id TEXT,                   -- optional: jobs may be channel-scoped
  story_id TEXT,                     -- optional: jobs may be story-scoped
  payload TEXT,                      -- JSON. job-kind-specific input.
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | claimed | running | done | failed | cancelled
  priority INTEGER DEFAULT 50,       -- lower runs first
  run_at TEXT NOT NULL DEFAULT (datetime('now')),  -- earliest eligible run time (UTC)
  attempt_count INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_error TEXT,
  claimed_by TEXT,                   -- worker id that last claimed this job
  claimed_at TEXT,
  lease_until TEXT,                  -- claim expires if not heartbeated by this time
  requires_gpu INTEGER DEFAULT 0,    -- 1 = only a GPU-capable worker may claim
  idempotency_key TEXT,              -- deduplicate enqueues
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  FOREIGN KEY (story_id) REFERENCES stories(id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_claimable
  ON jobs(status, run_at, priority);
CREATE INDEX IF NOT EXISTS idx_jobs_kind_status ON jobs(kind, status);
CREATE INDEX IF NOT EXISTS idx_jobs_story ON jobs(story_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_jobs_idempotency
  ON jobs(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Full execution history (append-only). Lets us ask "what did the worker
-- actually do yesterday between 05:30 and 06:00?" without the current
-- grep-through-stdout ritual.
CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  worker_id TEXT,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL,              -- running | done | failed | timed_out
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  duration_ms INTEGER,
  error_message TEXT,
  log_excerpt TEXT,                  -- last ~4KB of stderr on failure
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job_id);
CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs(started_at);

-- Scheduler templates. A "schedule" row describes a recurring job (what
-- kind, what payload, when) and the scheduler tick enqueues concrete job
-- rows from these. Replaces the three overlapping cron registries.
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  channel_id TEXT,
  cron_expr TEXT NOT NULL,           -- standard 5-field cron
  payload TEXT,                      -- JSON template
  enabled INTEGER DEFAULT 1,
  last_enqueued_at TEXT,
  next_run_at TEXT,
  requires_gpu INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 50,
  FOREIGN KEY (channel_id) REFERENCES channels(id)
);

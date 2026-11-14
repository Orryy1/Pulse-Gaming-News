-- The shared learning core (src/learn, 14 Nov 2026): what made each video, what changed and when, what the judges said,
-- which lessons the writer saw, which test arms each Short drew and which hook candidates it chose from. Every table
-- is written only when its LEARN_* setting is on; with them off nothing here is touched.

-- Version stamps: per episode, the code and settings each step ran with (steps: { status: { commit, settings, at } }),
-- and whether it was made on the pinned baseline (the holdout).
CREATE TABLE IF NOT EXISTS episode_stamps (
  episode_id    TEXT PRIMARY KEY,
  code_commit   TEXT,                       -- the commit its script was written with (the first stamped step)
  settings_hash TEXT,                       -- the settings snapshot its script was written with
  profile       TEXT NOT NULL DEFAULT 'live', -- live | holdout
  profile_hash  TEXT,                       -- the pinned baseline's hash, for a holdout episode
  steps         JSONB NOT NULL DEFAULT '{}'::jsonb,
  source        TEXT NOT NULL DEFAULT 'live', -- live | backfill
  confidence    TEXT NOT NULL DEFAULT 'exact', -- exact | reconstructed | partial
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS episode_stamps_commit_idx ON episode_stamps (code_commit);
CREATE INDEX IF NOT EXISTS episode_stamps_profile_idx ON episode_stamps (profile, created_at);

-- Each distinct settings snapshot once (non-secret keys only: never the value of a key, token, id, address or path).
CREATE TABLE IF NOT EXISTS settings_snapshots (
  hash       TEXT PRIMARY KEY,
  snapshot   JSONB NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every model call an episode's steps made, folded by prompt and model: which writer and judge prompts made it.
CREATE TABLE IF NOT EXISTS episode_prompts (
  episode_id  TEXT NOT NULL,
  site        TEXT NOT NULL,                -- the step's call site ("clarity.judge", "editorial")
  prompt_hash TEXT NOT NULL,                -- sha256 of the system prompt, first 16 hex
  model       TEXT NOT NULL,                -- the model that answered ("claude-opus-5-5", "codex:text")
  role        TEXT NOT NULL,                -- writer | judge | other
  step        TEXT NOT NULL,                -- the episode status the step ran from
  job         TEXT,
  calls       INTEGER NOT NULL DEFAULT 1,
  first_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (episode_id, site, prompt_hash, model)
);
CREATE INDEX IF NOT EXISTS episode_prompts_hash_idx ON episode_prompts (prompt_hash);

-- The prompt texts behind the hashes (system prompts are fixed instructions, never secrets), kept once each.
CREATE TABLE IF NOT EXISTS prompt_texts (
  prompt_hash TEXT PRIMARY KEY,
  site        TEXT NOT NULL,
  chars       INTEGER NOT NULL,
  text        TEXT NOT NULL,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The change ledger: every shipped change with the time it went live. kind: baseline | deploy | commit | setting |
-- override | intent | pin | rollback | note. A setting's before/after are non-secret values (secrets never get here).
CREATE TABLE IF NOT EXISTS change_ledger (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL,
  kind        TEXT NOT NULL,
  key         TEXT,
  before      TEXT,
  after       TEXT,
  code_commit TEXT,
  summary     TEXT NOT NULL,
  source      TEXT NOT NULL,                -- observed | intent | backfill | holdout | flightsim | manual
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS change_ledger_at_idx ON change_ledger (at);
CREATE INDEX IF NOT EXISTS change_ledger_kind_idx ON change_ledger (kind, at);

-- The judge calibration ledger: every judge score per episode, the first (pre-rewrite) and the final one.
CREATE TABLE IF NOT EXISTS judge_scores (
  id          BIGSERIAL PRIMARY KEY,
  episode_id  TEXT NOT NULL,
  judge       TEXT NOT NULL,                -- clarity | rubric | rubric_ambers | release_gate | gfx_audit | fact_check ...
  stage       TEXT NOT NULL,                -- first | final
  version     TEXT,                         -- the judge prompt's hash when known, else the code commit
  score       REAL,
  scale_max   REAL,
  pass        BOOLEAN,
  detail      JSONB,
  source_id   TEXT NOT NULL,                -- what it was read from ("event:123"), so ingesting twice changes nothing
  scored_at   TIMESTAMPTZ NOT NULL,
  UNIQUE (source_id, judge, stage)
);
CREATE INDEX IF NOT EXISTS judge_scores_episode_idx ON judge_scores (episode_id);
CREATE INDEX IF NOT EXISTS judge_scores_judge_idx ON judge_scores (judge, scored_at);

-- The frozen anchor set (past scripts with known outcomes) and their weekly re-scores, for drift.
CREATE TABLE IF NOT EXISTS judge_anchors (
  anchor_id   TEXT PRIMARY KEY,
  episode_id  TEXT NOT NULL,
  judge       TEXT NOT NULL,
  payload     JSONB NOT NULL,
  frozen_score REAL,
  frozen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS judge_anchor_scores (
  anchor_id   TEXT NOT NULL,
  run_id      TEXT NOT NULL,
  version     TEXT,
  score       REAL,
  scored_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (anchor_id, run_id)
);

-- The lesson playbook (ACE style): items with evidence and helpful/harmful tallies. A lesson's text never changes
-- once written; only its status, counters and evidence do.
CREATE TABLE IF NOT EXISTS lessons (
  id             TEXT PRIMARY KEY,
  key            TEXT NOT NULL UNIQUE,      -- the normalised text, so a lesson seen again is confirmed, not duplicated
  text           TEXT NOT NULL,
  scope          TEXT NOT NULL,             -- news | long | all
  source         TEXT NOT NULL,             -- analytics_loop | retention_learn | retention_model | growth | manual
  evidence       JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_confirmed TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmations  INTEGER NOT NULL DEFAULT 1,
  helpful        INTEGER NOT NULL DEFAULT 0,
  harmful        INTEGER NOT NULL DEFAULT 0,
  neutral        INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active', -- active | retired
  retired_at     TIMESTAMPTZ,
  retired_reason TEXT
);
CREATE INDEX IF NOT EXISTS lessons_status_idx ON lessons (status, scope);
CREATE TABLE IF NOT EXISTS lesson_exposures (
  episode_id TEXT NOT NULL,
  lesson_id  TEXT NOT NULL,
  shown_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (episode_id, lesson_id)
);

-- The bandit: each Short's arm per factor, with the probability it had of drawing that arm (for unbiased estimates).
CREATE TABLE IF NOT EXISTS bandit_assignments (
  episode_id  TEXT NOT NULL,
  factor      TEXT NOT NULL,
  arm         TEXT NOT NULL,
  format      TEXT NOT NULL,
  stratum     TEXT,
  propensity  REAL NOT NULL,
  mode        TEXT NOT NULL,                -- shadow | on
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (episode_id, factor)
);
CREATE TABLE IF NOT EXISTS bandit_arms (
  factor     TEXT NOT NULL,
  arm        TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active', -- active | retired | winner
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason     TEXT,
  PRIMARY KEY (factor, arm)
);

-- Breadth then selection: every hook candidate a Short was chosen from, its scores and why any was refused.
CREATE TABLE IF NOT EXISTS hook_candidates (
  episode_id TEXT NOT NULL,
  idx        INTEGER NOT NULL,
  angle      TEXT NOT NULL,
  hook       TEXT NOT NULL,
  title      TEXT,
  score      REAL,
  scores     JSONB,
  chosen     BOOLEAN NOT NULL DEFAULT false,
  refused    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (episode_id, idx)
);

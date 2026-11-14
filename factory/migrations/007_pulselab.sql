-- The Pulse Lab (PULSE_LAB, src/pulselab): the Receipts claims ledger and the running season tallies.
-- Both live in the database so a restart, a redeploy or a retried step never loses a grade or recounts a tally.

CREATE TABLE IF NOT EXISTS lab_claims (
  id          TEXT PRIMARY KEY,
  game        TEXT NOT NULL,
  question    TEXT NOT NULL,
  claim       TEXT NOT NULL,
  kind        TEXT NOT NULL,             -- leak | datamine | insider | rumour | reported | myth | preview | official | viewer
  source      JSONB NOT NULL,            -- { name, url?, at? }: shown on screen with the claim
  origin      TEXT NOT NULL,             -- stream_ask | seed | gta_file | rumour_episode
  ask_id      TEXT,
  topic       TEXT,
  status      TEXT NOT NULL DEFAULT 'open', -- open | graded | held
  grade       JSONB,                     -- { grade: TRUE|FALSE|PARTLY, confidence, vodId, at, reason, episodeId? }
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lab_claims_game_idx ON lab_claims (game, status);

-- One row per series Short that counts towards a tally: the episode and what it added (graded TRUE, a myth busted...).
-- A tally is the count of rows whose episode is still on its way or out, so a rejected or failed Short drops out.
CREATE TABLE IF NOT EXISTS lab_tally (
  series      TEXT NOT NULL,             -- receipts | myths | measured | asked | versus | why | gta_file | verdict
  season      TEXT NOT NULL,
  episode_id  TEXT NOT NULL,
  outcome     TEXT NOT NULL,             -- TRUE | FALSE | PARTLY | proved | busted | buy | wait | skip | counted
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (series, season, episode_id)
);
CREATE INDEX IF NOT EXISTS lab_tally_series_idx ON lab_tally (series, season, created_at);

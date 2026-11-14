-- The Pulse Fact Vault (FACT_VAULT, src/factvault): verified game facts, each with its primary source.
-- Wikipedia is never a source here; it is only the map that leads to one (src/factvault/store.ts refuses it).

-- What a fact is about: a game, studio, publisher, person, series, platform or outlet.
CREATE TABLE IF NOT EXISTS fact_entities (
  id         TEXT PRIMARY KEY,               -- "game:fallout-new-vegas"
  kind       TEXT NOT NULL,
  name       TEXT NOT NULL,
  aliases    JSONB NOT NULL DEFAULT '[]',    -- normalised keys the entity is also known by
  external   JSONB NOT NULL DEFAULT '{}',    -- { steam_appid, wikipedia_title, ... }
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fact_entities_kind_idx ON fact_entities (kind);

-- One verified fact: the claim, its value and where it is written down.
CREATE TABLE IF NOT EXISTS fact_vault (
  id              BIGSERIAL PRIMARY KEY,
  entity_id       TEXT NOT NULL REFERENCES fact_entities(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,              -- release_date, platform, developer, publisher, price, review_score, review_quote, sales, players, award, engine, series, person
  claim           TEXT NOT NULL,              -- a plain sentence a writer can use
  value           TEXT NOT NULL,              -- the value as written ("1997-09-30", "$19.99", "29.62 million")
  value_json      JSONB NOT NULL DEFAULT '{}',-- the structured value ({ "year": 1997 }, { "amount": 19.99, "currency": "USD" })
  region          TEXT,                       -- NA, EU, JP, US, WW
  quote           TEXT,                       -- a review quote's exact words (review_quote only)
  outlet          TEXT,                       -- who published the source ("GameSpot", "Nintendo")
  source_url      TEXT NOT NULL,
  source_type     TEXT NOT NULL,              -- publisher_post, earnings_call, interview, review, review_aggregate, store_page, press_kit, official_site, news_report, database
  discovered_via  TEXT,                       -- how we found the source (a Wikipedia page, a story, a fact check); never the source itself
  origin          TEXT NOT NULL,              -- seed, steam, article, research, factcheck
  published_at    DATE,
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence      REAL NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active', -- active, stale, retracted, superseded
  check_failures  INTEGER NOT NULL DEFAULT 0,
  fingerprint     TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fact_vault_entity_idx ON fact_vault (entity_id, kind) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS fact_vault_recheck_idx ON fact_vault (checked_at, confidence) WHERE status IN ('active','stale');

-- Claims a fact check rejected: the writer is told not to repeat them, and a repeat is caught before the check.
CREATE TABLE IF NOT EXISTS fact_vault_disputes (
  id          BIGSERIAL PRIMARY KEY,
  entity_id   TEXT,
  claim       TEXT NOT NULL,
  reason      TEXT NOT NULL,
  episode_id  TEXT,
  times       INTEGER NOT NULL DEFAULT 1,
  fingerprint TEXT NOT NULL UNIQUE,
  first_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fact_vault_disputes_entity_idx ON fact_vault_disputes (entity_id);

-- Every re-check of a fact (the nightly integrity job, a fact check that leaned on it).
CREATE TABLE IF NOT EXISTS fact_vault_checks (
  id         BIGSERIAL PRIMARY KEY,
  fact_id    BIGINT NOT NULL REFERENCES fact_vault(id) ON DELETE CASCADE,
  ok         BOOLEAN NOT NULL,
  note       TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fact_vault_checks_fact_idx ON fact_vault_checks (fact_id, checked_at);

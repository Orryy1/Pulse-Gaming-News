-- 011_stories_source_url_hash.sql
-- Phase 2B of the hardening/cutover: canonical-URL dedup for publish.
--
-- Adds source_url_hash to stories so lib/services/publish-dedupe.js can
-- do a proper cross-story duplicate lookup keyed on the article's
-- canonical URL rather than fuzzy title overlap. The 17 April 2026
-- Pragmata incident is the concrete regression case this unlocks:
-- re-hunted article with a tweaked title + new story_id used to slip
-- past the legacy Jaccard 0.5 threshold; now it will hit a hash match
-- first.
--
-- The hash itself is a 12-char sha1 prefix of the canonicalised URL
-- (see lib/services/url-canonical.js). SQLite cannot compute it from
-- SQL, so:
--   * New stories: populated at insert-time by the hunter/processor
--     (Phase 2C wires this in).
--   * Existing rows: stay NULL until a separate backfill script runs
--     (scripts/backfill-source-url-hash.js, Phase 2C).
--
-- publish-dedupe.js already handles NULL hash gracefully (falls through
-- to the title-jaccard layer), so rolling this migration is safe even
-- before the backfill runs.

ALTER TABLE stories ADD COLUMN source_url_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_stories_source_url_hash
  ON stories(source_url_hash)
  WHERE source_url_hash IS NOT NULL;

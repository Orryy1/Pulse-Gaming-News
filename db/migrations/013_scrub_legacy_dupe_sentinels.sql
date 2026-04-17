-- 013_scrub_legacy_dupe_sentinels.sql
-- Clean historical "DUPE_BLOCKED" / "DUPE_SKIPPED" / "DUPE_*" values
-- from canonical external-id fields, preserving the blocked-state
-- meaning via structured platform_posts rows.
--
-- Why this exists
-- ---------------
-- Migration 010 backfilled the denormalised stories.<platform>_post_id
-- columns into platform_posts, but it copied the sentinel string into
-- platform_posts.external_id despite migration 003's schema comment
-- explicitly forbidding that ("external_id MUST NOT be a marker string
-- like DUPE_BLOCKED"). Live writers (publisher.js, upload_youtube.js)
-- were also still stamping sentinels into stories.<col> at that time.
--
-- The overnight sentinel-cleanup batch (commits eded327 → 2c5fdb6)
-- removed every production-reachable sentinel writer. This migration
-- now cleans the historical pollution those writers left behind so the
-- read-side tolerance filters (Cat C per docs/sentinel-cleanup-inventory.md)
-- can be retired safely in Task 3.
--
-- Cleanup strategy — conservative, idempotent, reviewable
-- -------------------------------------------------------
-- Step 1: scrub platform_posts.external_id where it carries a DUPE_* value.
--   The row keeps status='blocked' (or whatever migration 010 assigned),
--   external_id becomes NULL, and block_reason captures the legacy
--   sentinel form so operators can grep the audit trail.
--
-- Step 2: NULL the stories.<platform>_post_id denormalised columns
--   where they contain a DUPE_* value. The structured platform_posts
--   row from migration 010 preserves the blocked-state meaning — this
--   is the critical pre-condition for retiring read-side filters.
--
-- Safety / reversibility
-- ----------------------
-- * Step 1: safe. Only touches rows the schema already marks blocked.
-- * Step 2: safe. Every NULLed column has a structured row from
--   migration 010 (INSERT OR IGNORE ran for every non-null source
--   column), so "already attempted" meaning is preserved via
--   platform_posts.status = 'blocked'.
-- * Idempotent: all UPDATEs have WHERE clauses that guard against
--   re-applying to already-scrubbed data.
-- * Not strictly reversible from SQL alone — the original sentinel
--   string is not preserved, only the semantic meaning via
--   block_reason. That's the deliberate trade-off: the sentinel was
--   never useful information, the "attempted + refused" fact is.

-- --- Step 1: scrub platform_posts.external_id ---------------------

UPDATE platform_posts
SET external_id = NULL,
    block_reason = COALESCE(
      block_reason,
      CASE
        WHEN external_id LIKE 'DUPE_BLOCKED%' THEN 'legacy-remote-dupe'
        WHEN external_id LIKE 'DUPE_SKIPPED%' THEN 'legacy-title-skip'
        ELSE 'legacy-dupe-sentinel'
      END
    ),
    updated_at = datetime('now')
WHERE external_id IS NOT NULL
  AND external_id LIKE 'DUPE_%';

-- --- Step 2: NULL legacy denormalised columns on stories ----------

UPDATE stories
SET youtube_post_id = NULL,
    updated_at = datetime('now')
WHERE youtube_post_id LIKE 'DUPE_%';

UPDATE stories
SET tiktok_post_id = NULL,
    updated_at = datetime('now')
WHERE tiktok_post_id LIKE 'DUPE_%';

UPDATE stories
SET instagram_media_id = NULL,
    updated_at = datetime('now')
WHERE instagram_media_id LIKE 'DUPE_%';

UPDATE stories
SET facebook_post_id = NULL,
    updated_at = datetime('now')
WHERE facebook_post_id LIKE 'DUPE_%';

UPDATE stories
SET twitter_post_id = NULL,
    updated_at = datetime('now')
WHERE twitter_post_id LIKE 'DUPE_%';

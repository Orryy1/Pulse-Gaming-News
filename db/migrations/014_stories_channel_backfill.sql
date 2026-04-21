-- 014_stories_channel_backfill.sql
-- Backfill stories.channel_id for legacy rows that predate migration 002.
--
-- Migration 002 added `stories.channel_id` as a nullable FK to channels.id
-- but without a default — every pre-migration-002 story and every story
-- written by the JS-era pipeline (before storyToRow learned about the
-- column) is NULL. Pulse-Gaming is the only channel that has ever
-- operated against this database, so the safe backfill is 'pulse-gaming'.
--
-- This migration is idempotent: rows already tagged with a channel_id
-- are left alone. The schema_migrations row prevents re-runs, but even
-- if someone force-ran it, the IS NULL predicate keeps the operation a
-- no-op on subsequent executions.

UPDATE stories
   SET channel_id = 'pulse-gaming'
 WHERE channel_id IS NULL;

-- Belt-and-braces index — idx_stories_channel already exists from
-- migration 002, but CREATE INDEX IF NOT EXISTS is cheap and
-- confirms the index is in place on older deployments that may have
-- missed it for any reason.
CREATE INDEX IF NOT EXISTS idx_stories_channel ON stories(channel_id);

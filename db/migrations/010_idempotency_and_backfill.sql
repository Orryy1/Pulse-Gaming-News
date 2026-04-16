-- 010_idempotency_and_backfill.sql
-- Closing touches: general-purpose idempotency keys table + backfill of
-- platform_posts from legacy stories columns.
--
-- The idempotency_keys table backs lib/idempotency.js: any outbound
-- operation (enqueue, upload, post) can first-write a key with the
-- intended action, then commit. A second attempt sees the row and either
-- returns the original result or waits for the in-flight call.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,                 -- job_enqueue | upload_youtube | upload_tiktok | ...
  result TEXT,                         -- JSON result of the first attempt
  status TEXT NOT NULL,                -- in_flight | ok | error
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_idempotency_scope ON idempotency_keys(scope);
CREATE INDEX IF NOT EXISTS idx_idempotency_status ON idempotency_keys(status);

-- Backfill: pull legacy denormalised platform ids from stories into
-- platform_posts so the new repository surface sees everything.
-- Insert-or-ignore on the unique idx so re-running is safe.
INSERT OR IGNORE INTO platform_posts
  (story_id, platform, external_id, status, published_at,
   views, likes, comments, created_at, updated_at)
SELECT id, 'youtube', youtube_post_id,
       CASE WHEN youtube_post_id LIKE 'DUPE_%' THEN 'blocked' ELSE 'published' END,
       youtube_published_at,
       COALESCE(youtube_views, 0), COALESCE(youtube_likes, 0), COALESCE(youtube_comments, 0),
       COALESCE(created_at, datetime('now')), datetime('now')
FROM stories
WHERE youtube_post_id IS NOT NULL;

INSERT OR IGNORE INTO platform_posts
  (story_id, platform, external_id, status, published_at,
   views, likes, comments, shares, created_at, updated_at)
SELECT id, 'tiktok', tiktok_post_id,
       CASE WHEN tiktok_post_id LIKE 'DUPE_%' THEN 'blocked' ELSE 'published' END,
       published_at,
       COALESCE(tiktok_views, 0), COALESCE(tiktok_likes, 0), COALESCE(tiktok_comments, 0),
       COALESCE(tiktok_shares, 0),
       COALESCE(created_at, datetime('now')), datetime('now')
FROM stories
WHERE tiktok_post_id IS NOT NULL;

INSERT OR IGNORE INTO platform_posts
  (story_id, platform, external_id, status, published_at,
   views, likes, comments, created_at, updated_at)
SELECT id, 'instagram_reel', instagram_media_id,
       CASE WHEN instagram_media_id LIKE 'DUPE_%' THEN 'blocked' ELSE 'published' END,
       published_at,
       COALESCE(instagram_views, 0), COALESCE(instagram_likes, 0), COALESCE(instagram_comments, 0),
       COALESCE(created_at, datetime('now')), datetime('now')
FROM stories
WHERE instagram_media_id IS NOT NULL;

INSERT OR IGNORE INTO platform_posts
  (story_id, platform, external_id, status, published_at, created_at, updated_at)
SELECT id, 'facebook_reel', facebook_post_id,
       CASE WHEN facebook_post_id LIKE 'DUPE_%' THEN 'blocked' ELSE 'published' END,
       published_at,
       COALESCE(created_at, datetime('now')), datetime('now')
FROM stories
WHERE facebook_post_id IS NOT NULL;

INSERT OR IGNORE INTO platform_posts
  (story_id, platform, external_id, status, published_at, created_at, updated_at)
SELECT id, 'twitter_video', twitter_post_id,
       CASE WHEN twitter_post_id LIKE 'DUPE_%' THEN 'blocked' ELSE 'published' END,
       published_at,
       COALESCE(created_at, datetime('now')), datetime('now')
FROM stories
WHERE twitter_post_id IS NOT NULL;

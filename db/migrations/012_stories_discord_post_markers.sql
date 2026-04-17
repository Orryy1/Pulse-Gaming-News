-- 012_stories_discord_post_markers.sql
-- Durable Discord post-once markers for #video-drops and #polls.
--
-- Why this exists: the old publisher.js guard derived "already posted
-- to Discord?" from story.youtube_post_id / tiktok_post_id /
-- instagram_media_id being non-null. Those ids are cleared when
-- assemble.js re-renders a video, which flipped the guard back to
-- false and re-triggered the Discord announcement. The 17 April 2026
-- Pragmata incident posted the same video to #video-drops three
-- times across 16-17 April because of this.
--
-- The fix is tracked state instead of derived state: two TEXT columns
-- that are only ever set on successful Discord post and never cleared
-- by re-renders or retries.
--
-- Backfill predicate is deliberately narrow. We only set the markers
-- for rows that clearly had a real public announcement:
--   * video_drop marker: youtube_url set (populated on a successful
--     YouTube upload) OR a non-DUPE tiktok_post_id OR instagram_media_id.
--     Mirrors the exact fire condition of postVideoUpload() at the
--     time the Pragmata incident happened.
--   * story_poll marker: any non-DUPE platform id set — postStoryPoll
--     used to fire on every !isRetry publish regardless of URL state.
--
-- Stories with only DUPE_* sentinels are NOT backfilled. In those
-- cases Discord was never posted (isRetry was true because the id was
-- set, but the publish was a dedupe block). Leaving the marker NULL
-- means a legitimate later publish could still announce once. This is
-- the conservative trade-off the task brief asked for.
--
-- Timestamp choice: COALESCE(youtube_published_at, published_at,
-- updated_at). Gives post-mortem grep something usable when walking
-- the history. Never uses datetime('now') during backfill — a boot-
-- time timestamp would be indistinguishable from a real post.

ALTER TABLE stories ADD COLUMN discord_video_drop_posted_at TEXT;
ALTER TABLE stories ADD COLUMN discord_story_poll_posted_at TEXT;

-- Backfill: video-drop marker.
-- Predicate mirrors the live fire condition in publisher.js ca. 17 Apr:
--   !isRetry && (youtube_url || tiktok_post_id || instagram_media_id)
-- For backfill we treat "the platform side of the OR was satisfied AND
-- a non-DUPE platform id is present (i.e. a real upload landed)" as
-- evidence the Discord post already fired at least once.
UPDATE stories
SET discord_video_drop_posted_at = COALESCE(
      youtube_published_at,
      published_at,
      updated_at
    )
WHERE discord_video_drop_posted_at IS NULL
  AND (
    (youtube_url IS NOT NULL AND youtube_url != '')
    OR (tiktok_post_id IS NOT NULL
        AND tiktok_post_id != ''
        AND tiktok_post_id NOT LIKE 'DUPE_%')
    OR (instagram_media_id IS NOT NULL
        AND instagram_media_id != ''
        AND instagram_media_id NOT LIKE 'DUPE_%')
  );

-- Backfill: story-poll marker.
-- postStoryPoll fired on every !isRetry publish attempt, independent
-- of URL state, so the predicate is broader: any real platform id.
UPDATE stories
SET discord_story_poll_posted_at = COALESCE(
      youtube_published_at,
      published_at,
      updated_at
    )
WHERE discord_story_poll_posted_at IS NULL
  AND (
    (youtube_post_id IS NOT NULL
     AND youtube_post_id != ''
     AND youtube_post_id NOT LIKE 'DUPE_%')
    OR (tiktok_post_id IS NOT NULL
        AND tiktok_post_id != ''
        AND tiktok_post_id NOT LIKE 'DUPE_%')
    OR (instagram_media_id IS NOT NULL
        AND instagram_media_id != ''
        AND instagram_media_id NOT LIKE 'DUPE_%')
    OR (facebook_post_id IS NOT NULL
        AND facebook_post_id != ''
        AND facebook_post_id NOT LIKE 'DUPE_%')
    OR (twitter_post_id IS NOT NULL
        AND twitter_post_id != ''
        AND twitter_post_id NOT LIKE 'DUPE_%')
  );

-- Partial indexes — the guard queries only ever care about "marker set"
-- vs "marker null", and the vast majority of rows are pre-Discord, so
-- a predicate index keeps this cheap.
CREATE INDEX IF NOT EXISTS idx_stories_discord_video_drop
  ON stories(discord_video_drop_posted_at)
  WHERE discord_video_drop_posted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stories_discord_story_poll
  ON stories(discord_story_poll_posted_at)
  WHERE discord_story_poll_posted_at IS NOT NULL;

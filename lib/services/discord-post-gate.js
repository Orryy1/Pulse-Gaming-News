/**
 * lib/services/discord-post-gate.js
 *
 * Pure predicates that decide whether a story is eligible for a Discord
 * #video-drops announcement or a #polls story-poll. Factored out of
 * publisher.js so the 17 April 2026 Pragmata dedupe fix has a tested
 * regression surface.
 *
 * The guard is deliberately tracked-state, not derived-state. The old
 * version derived eligibility from whether any of youtube_post_id,
 * tiktok_post_id, instagram_media_id, facebook_post_id or twitter_post_id
 * was non-null ("isRetry"). That failed because assemble.js clears those
 * ids when a video is re-rendered, which flipped the guard back to
 * "not yet posted" and triggered duplicate #video-drops announcements.
 *
 * Migration 012 added two persistent TEXT markers on `stories`:
 *   - discord_video_drop_posted_at
 *   - discord_story_poll_posted_at
 *
 * These are ONLY ever set by the publisher after a successful Discord
 * post, and NEVER cleared by re-renders, platform id resets, or retries.
 */

"use strict";

/** Predicate: should we attempt postVideoUpload for this story now? */
function shouldPostVideoDrop(story) {
  if (!story || typeof story !== "object") return false;
  // Durable marker wins over every other signal.
  if (story.discord_video_drop_posted_at) return false;
  // Video drop requires SOME public URL / id to point viewers at.
  // Matches the live fire condition in publisher.js: youtube_url is set
  // after a successful YouTube upload; tiktok_post_id / instagram_media_id
  // after those uploads succeed.
  return !!(
    story.youtube_url ||
    story.tiktok_post_id ||
    story.instagram_media_id
  );
}

/** Predicate: should we attempt postStoryPoll for this story now?
 *
 * Story polls don't need a URL — they ask the community about the story
 * itself — so there is no "qualifies" check beyond the marker.
 */
function shouldPostStoryPoll(story) {
  if (!story || typeof story !== "object") return false;
  return !story.discord_story_poll_posted_at;
}

/** Stamp a successful video-drop post onto the story. Returns the ISO
 * timestamp that was written so callers can log it. */
function markVideoDropPosted(story, now = new Date()) {
  const ts = (now instanceof Date ? now : new Date(now)).toISOString();
  story.discord_video_drop_posted_at = ts;
  return ts;
}

/** Stamp a successful story-poll post onto the story. */
function markStoryPollPosted(story, now = new Date()) {
  const ts = (now instanceof Date ? now : new Date(now)).toISOString();
  story.discord_story_poll_posted_at = ts;
  return ts;
}

module.exports = {
  shouldPostVideoDrop,
  shouldPostStoryPoll,
  markVideoDropPosted,
  markStoryPollPosted,
};

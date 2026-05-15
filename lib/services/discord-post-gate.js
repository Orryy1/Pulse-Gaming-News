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

const SCRIPT_VALIDATION_FAILURE_RE =
  /script validation failed|manual review required before production/i;

function truthyFailureFlag(value) {
  return value === true || value === 1 || String(value).toLowerCase() === "true";
}

function hasScriptValidationFailure(story) {
  if (!story || typeof story !== "object") return false;
  if (story.script_generation_status === "review_required") return true;
  const fields = [
    story.hook,
    story.body,
    story.full_script,
    story.tts_script,
    story.script_review_reason,
  ];
  return fields.some((field) =>
    SCRIPT_VALIDATION_FAILURE_RE.test(String(field || "")),
  );
}

function isPublishFailureOrReviewBlocked(story) {
  if (!story || typeof story !== "object") return true;
  const publishStatus = String(story.publish_status || "").toLowerCase();
  const qaStatus = String(story.qa_status || "").toLowerCase();
  if (truthyFailureFlag(story.qa_failed)) return true;
  if (publishStatus === "failed" || publishStatus === "qa_failed") return true;
  if (qaStatus === "failed" || qaStatus === "qa_failed") return true;
  if (hasScriptValidationFailure(story)) return true;
  return false;
}

function isRealPlatformValue(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^DUPE_/i.test(text)) return false;
  return true;
}

function hasCleanPublishState(story) {
  if (!story || typeof story !== "object") return false;
  if (story.publish_status === "published" || story.publish_status === "partial") {
    return true;
  }
  return !!(
    story.published_at ||
    story.youtube_published_at ||
    story.instagram_published_at ||
    story.facebook_published_at
  );
}

function hasPublicVideoTarget(story) {
  return !!(
    isRealPlatformValue(story?.youtube_url) ||
    isRealPlatformValue(story?.tiktok_post_id) ||
    isRealPlatformValue(story?.instagram_media_id)
  );
}

/** Predicate: should we attempt postVideoUpload for this story now? */
function shouldPostVideoDrop(story) {
  if (!story || typeof story !== "object") return false;
  // Durable marker wins over every other signal.
  if (story.discord_video_drop_posted_at) return false;
  if (isPublishFailureOrReviewBlocked(story)) return false;
  if (!hasCleanPublishState(story)) return false;
  // Video drop requires SOME public URL / id to point viewers at.
  // Matches the live fire condition in publisher.js: youtube_url is set
  // after a successful YouTube upload; tiktok_post_id / instagram_media_id
  // after those uploads succeed.
  return hasPublicVideoTarget(story);
}

/** Predicate: should we post a newly discovered/enriched story to public
 * Discord news channels?
 *
 * This is intentionally looser than video-drop eligibility because story
 * discovery can happen before a platform upload exists. It is still strict
 * about failed/script-review rows so internal fallback text never appears as
 * public news.
 */
function shouldPostNewStory(story) {
  if (!story || typeof story !== "object") return false;
  if (isPublishFailureOrReviewBlocked(story)) return false;
  if (String(story.content_pillar || "").toLowerCase() === "manual review") {
    return false;
  }
  return true;
}

/** Predicate: should we attempt postStoryPoll for this story now?
 *
 * Story polls don't need a URL — they ask the community about the story
 * itself — so there is no "qualifies" check beyond the marker.
 */
function shouldPostStoryPoll(story) {
  if (!story || typeof story !== "object") return false;
  if (story.discord_story_poll_posted_at) return false;
  if (isPublishFailureOrReviewBlocked(story)) return false;
  return hasCleanPublishState(story);
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
  shouldPostNewStory,
  shouldPostVideoDrop,
  shouldPostStoryPoll,
  markVideoDropPosted,
  markStoryPollPosted,
  hasScriptValidationFailure,
  isPublishFailureOrReviewBlocked,
  hasCleanPublishState,
  hasPublicVideoTarget,
  isRealPlatformValue,
};

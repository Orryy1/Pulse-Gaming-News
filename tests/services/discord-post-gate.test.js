/**
 * tests/services/discord-post-gate.test.js
 *
 * Regression pack for the 17 April 2026 #video-drops duplicate-post
 * incident. Pins the behaviour of lib/services/discord-post-gate so
 * re-renders, retries and multi-entrypoint publish cycles can never
 * re-announce a story to Discord once its marker is set.
 *
 * Run: node --test tests/services/discord-post-gate.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldPostVideoDrop,
  shouldPostStoryPoll,
  markVideoDropPosted,
  markStoryPollPosted,
  hasCleanPublishState,
  hasPublicVideoTarget,
} = require("../../lib/services/discord-post-gate");

test("shouldPostVideoDrop: fresh story with a YouTube URL qualifies", () => {
  const story = { id: "s1", youtube_url: "https://youtu.be/abc", publish_status: "partial" };
  assert.equal(shouldPostVideoDrop(story), true);
});

test("shouldPostVideoDrop: no URL + no platform ids -> false", () => {
  const story = { id: "s1" };
  assert.equal(shouldPostVideoDrop(story), false);
});

test("shouldPostVideoDrop: tiktok_post_id alone qualifies", () => {
  const story = { id: "s1", tiktok_post_id: "tt-123", publish_status: "partial" };
  assert.equal(shouldPostVideoDrop(story), true);
});

test("shouldPostVideoDrop: instagram_media_id alone qualifies", () => {
  const story = { id: "s1", instagram_media_id: "ig-456", publish_status: "partial" };
  assert.equal(shouldPostVideoDrop(story), true);
});

test("shouldPostVideoDrop: QA-failed story never qualifies even with a public URL", () => {
  const story = {
    id: "qa-failed",
    youtube_url: "https://youtu.be/abc",
    qa_failed: true,
  };
  assert.equal(shouldPostVideoDrop(story), false);
});

test("shouldPostVideoDrop: failed publish status never qualifies even with platform ids", () => {
  const story = {
    id: "publish-failed",
    instagram_media_id: "ig-456",
    publish_status: "failed",
  };
  assert.equal(shouldPostVideoDrop(story), false);
});

test("shouldPostVideoDrop: script-validation fallback text never posts as a video drop", () => {
  const story = {
    id: "script-review",
    youtube_url: "https://youtu.be/abc",
    hook: "",
    body: "Script validation failed. Manual review required before production.",
  };
  assert.equal(shouldPostVideoDrop(story), false);
});

test("shouldPostVideoDrop: manual-review full script never qualifies even if body was changed", () => {
  const story = {
    id: "script-review-full",
    tiktok_post_id: "tt-123",
    body: "Clean-looking body",
    full_script: "Manual review required before production.",
  };
  assert.equal(shouldPostVideoDrop(story), false);
});

test("shouldPostVideoDrop: once marker is set, never posts again (even with fresh URLs)", () => {
  const story = {
    id: "s1",
    youtube_url: "https://youtu.be/abc",
    tiktok_post_id: "tt-123",
    instagram_media_id: "ig-456",
    publish_status: "published",
    discord_video_drop_posted_at: "2026-04-16T20:05:00Z",
  };
  assert.equal(shouldPostVideoDrop(story), false);
});

test("Pragmata regression: re-render clears platform ids; marker still blocks", () => {
  // This is the exact failure the migration fixes. A story that was
  // already announced to #video-drops gets re-rendered; assemble.js
  // clears youtube_post_id etc so the old `!isRetry` guard flipped
  // back to false. With the marker, qualification can be true again,
  // but the gate must still say "no".
  const story = {
    id: "pragmata",
    youtube_url: "https://youtu.be/pragmata-20min",
    publish_status: "partial",
    // Platform ids cleared by re-render (the bug scenario):
    youtube_post_id: null,
    tiktok_post_id: null,
    instagram_media_id: null,
    facebook_post_id: null,
    twitter_post_id: null,
    // But the durable marker survives:
    discord_video_drop_posted_at: "2026-04-16T20:05:00Z",
  };
  assert.equal(
    shouldPostVideoDrop(story),
    false,
    "Pragmata must not re-post after its marker is set, even when platform ids are cleared",
  );
});

test("multi-entrypoint: two sequential publish cycles on the same story never double-post", () => {
  // Simulates the breaking_queue.js / server.js / job-handlers.js
  // entrypoints each calling publishNextStory() on the same row. The
  // first pass sets the marker; subsequent passes must see it and bail.
  const story = { id: "s1", youtube_url: "https://youtu.be/abc" };
  story.publish_status = "partial";

  // Entry 1: gate allows.
  assert.equal(shouldPostVideoDrop(story), true);
  markVideoDropPosted(story, new Date("2026-04-17T08:05:00Z"));

  // Entry 2 (say server.js cron fires 6 hours later).
  assert.equal(shouldPostVideoDrop(story), false);

  // Entry 3 (breaking_queue.js after a re-hunt). Even if a platform id
  // is cleared and re-set in between, the marker survives the round trip.
  story.youtube_post_id = null;
  story.instagram_media_id = "ig-new-after-rerender";
  assert.equal(shouldPostVideoDrop(story), false);
});

test("shouldPostStoryPoll: fresh published story -> true, after mark -> false", () => {
  const story = { id: "s1", publish_status: "partial" };
  assert.equal(shouldPostStoryPoll(story), true);
  markStoryPollPosted(story);
  assert.equal(shouldPostStoryPoll(story), false);
});

test("shouldPostStoryPoll: story-poll needs clean publish state but no URL", () => {
  // Polls are broader than video drops because they do not need a direct
  // platform link, but they still require a clean published/partial state.
  const story = { id: "s1", publish_status: "published" };
  assert.equal(shouldPostStoryPoll(story), true);
});

test("shouldPostStoryPoll: failed or script-review rows never qualify", () => {
  assert.equal(
    shouldPostStoryPoll({
      id: "failed",
      publish_status: "failed",
    }),
    false,
  );
  assert.equal(
    shouldPostStoryPoll({
      id: "script-review",
      publish_status: "partial",
      body: "Script validation failed. Manual review required before production.",
    }),
    false,
  );
});

test("marker writers: set ISO timestamps and are idempotent at the value level", () => {
  const story = { id: "s1" };
  const ts1 = markVideoDropPosted(story, new Date("2026-04-17T08:05:00Z"));
  assert.equal(story.discord_video_drop_posted_at, ts1);
  assert.ok(/^2026-04-17T08:05:00/.test(ts1));

  const ts2 = markStoryPollPosted(story, new Date("2026-04-17T08:05:01Z"));
  assert.equal(story.discord_story_poll_posted_at, ts2);
  assert.notEqual(ts1, ts2);
});

test("shouldPostVideoDrop: null/undefined/bad input returns false without throwing", () => {
  assert.equal(shouldPostVideoDrop(null), false);
  assert.equal(shouldPostVideoDrop(undefined), false);
  assert.equal(shouldPostVideoDrop("nope"), false);
  assert.equal(shouldPostVideoDrop(42), false);
});

test("marker-set wins over every URL field — empty string marker still blocks? (deliberately: no)", () => {
  // We gate on truthiness of the marker, so an accidental '' would NOT
  // block. Document the choice so a future reader doesn't "fix" it into
  // a null-check and break backfill (where the marker is a real ISO).
  const story = {
    id: "s1",
    youtube_url: "https://youtu.be/abc",
    publish_status: "partial",
    discord_video_drop_posted_at: "",
  };
  assert.equal(
    shouldPostVideoDrop(story),
    true,
    "empty-string marker is treated as 'not posted' — only a real timestamp blocks",
  );
});

test("shouldPostVideoDrop: stale platform id without clean publish state does not qualify", () => {
  const story = {
    id: "stale",
    youtube_url: "https://youtu.be/abc",
    publish_status: null,
  };
  assert.equal(shouldPostVideoDrop(story), false);
});

test("shouldPostVideoDrop: DUPE sentinel platform ids are not public targets", () => {
  const story = {
    id: "dupe",
    tiktok_post_id: "DUPE_TIKTOK_403",
    instagram_media_id: "DUPE_IG",
    publish_status: "partial",
  };
  assert.equal(hasPublicVideoTarget(story), false);
  assert.equal(shouldPostVideoDrop(story), false);
});

test("hasCleanPublishState: published timestamp preserves legacy rows without status", () => {
  assert.equal(
    hasCleanPublishState({
      id: "legacy",
      youtube_url: "https://youtu.be/legacy",
      published_at: "2026-05-14T19:03:00.000Z",
    }),
    true,
  );
});

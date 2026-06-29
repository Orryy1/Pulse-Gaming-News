"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  corePlatformIdFields,
  derivePublishStatusFromPlatformEvidence,
  hasPublicPlatformEvidence,
  isRealPlatformPostId,
} = require("../../lib/services/platform-evidence-status");

test("platform evidence status ignores duplicate sentinels", () => {
  assert.equal(isRealPlatformPostId("yt_real"), true);
  assert.equal(isRealPlatformPostId("DUPE_BLOCKED"), false);
  assert.equal(isRealPlatformPostId(""), false);
});

test("platform evidence status treats enabled-platform complete local rows as published", () => {
  const env = { TIKTOK_ENABLED: "false" };
  const story = {
    youtube_post_id: "yt_real",
    instagram_media_id: "ig_real",
    facebook_post_id: "fb_real",
  };

  assert.deepEqual(corePlatformIdFields({ env }), [
    "youtube_post_id",
    "instagram_media_id",
    "facebook_post_id",
  ]);
  assert.equal(derivePublishStatusFromPlatformEvidence(story, { env }), "published");
  assert.equal(hasPublicPlatformEvidence(story, { env }), true);
});

test("platform evidence status marks missing enabled platforms as partial", () => {
  assert.equal(
    derivePublishStatusFromPlatformEvidence(
      {
        youtube_post_id: "yt_real",
        instagram_media_id: "ig_real",
      },
      { env: { TIKTOK_ENABLED: "false" } },
    ),
    "partial",
  );
});


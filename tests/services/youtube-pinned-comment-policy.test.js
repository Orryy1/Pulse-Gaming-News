"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const {
  resolveApprovedPinnedCommentForUpload,
} = require("../../upload_youtube");
const {
  hashPinnedComment,
} = require("../../lib/services/post-publish-mutation-policy");

function approvedStory() {
  const story = {
    id: "story-xbox-classics",
    pinned_comment: "Which of the four are you installing first?",
  };
  story.pinned_comment_approval = {
    decision: "APPROVED",
    story_id: story.id,
    text_sha256: hashPinnedComment(story.pinned_comment),
    contextual_rationale:
      "The video presents four named games and gives viewers a legitimate choice.",
    reviewed_at: "2026-07-27T12:00:00.000Z",
    reviewer: "operator",
  };
  return story;
}

test("YouTube receives only a hash-bound, operator-approved pinned comment", () => {
  assert.equal(
    resolveApprovedPinnedCommentForUpload(approvedStory()),
    "Which of the four are you installing first?",
  );
  assert.equal(resolveApprovedPinnedCommentForUpload({ id: "story-2" }), null);

  assert.equal(
    resolveApprovedPinnedCommentForUpload({
      id: "story-3",
      pinned_comment: "What do you think? Subscribe for more!",
    }),
    null,
  );
});

test("YouTube playlist descriptions do not retain the fixed generic follow CTA", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "upload_youtube.js"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /Follow Pulse Gaming so you never miss a beat/i,
  );
});

test("comment approval is resolved before the YouTube create boundary", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "upload_youtube.js"),
    "utf8",
  );
  const uploadStart = source.indexOf("async function uploadShort(");
  const uploadBody = source.slice(
    uploadStart,
    source.indexOf("// --- Batch upload all ready stories ---", uploadStart),
  );
  const approval = uploadBody.indexOf(
    "resolveApprovedPinnedCommentForUpload(story)",
  );
  const create = uploadBody.indexOf("insertYoutubeVideoOnce(youtube");

  assert.ok(approval >= 0, "comment approval preflight must be called");
  assert.ok(create >= 0, "YouTube create boundary must be present");
  assert.ok(approval < create, "comment approval must precede object creation");
});

"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  assessPinnedComment,
  assessPostPublishMutation,
  hashPinnedComment,
} = require("../../lib/services/post-publish-mutation-policy");

function approvedStory(overrides = {}) {
  const story = {
    id: "story-xbox-classics",
    pinned_comment: "Which of the four are you installing first?",
    ...overrides,
  };
  story.pinned_comment_approval = {
    decision: "APPROVED",
    story_id: story.id,
    text_sha256: hashPinnedComment(story.pinned_comment),
    contextual_rationale:
      "The video presents four named games and gives viewers a legitimate choice.",
    reviewed_at: "2026-07-27T12:00:00.000Z",
    reviewer: "operator",
    ...(overrides.pinned_comment_approval || {}),
  };
  return story;
}

test("a story-specific pinned comment requires hash-bound operator approval", () => {
  const assessed = assessPinnedComment(approvedStory());

  assert.equal(assessed.allowed, true);
  assert.equal(assessed.text, "Which of the four are you installing first?");
  assert.deepEqual(assessed.blockers, []);

  const changedAfterReview = approvedStory({
    pinned_comment: "Which game are you installing first?",
  });
  changedAfterReview.pinned_comment_approval.text_sha256 = hashPinnedComment(
    "Which of the four are you installing first?",
  );
  assert.ok(
    assessPinnedComment(changedAfterReview).blockers.includes(
      "pinned_comment_approval_hash_mismatch",
    ),
  );
});

test("missing approval and generic engagement bait fail closed", () => {
  const missingApproval = {
    id: "story-1",
    pinned_comment: "Which game are you installing first?",
  };
  assert.ok(
    assessPinnedComment(missingApproval).blockers.includes(
      "pinned_comment_human_approval_required",
    ),
  );

  const generic = approvedStory({
    pinned_comment: "Like, subscribe and comment below!",
  });
  generic.pinned_comment_approval.text_sha256 = hashPinnedComment(
    generic.pinned_comment,
  );
  assert.ok(
    assessPinnedComment(generic).blockers.includes(
      "pinned_comment_generic_engagement_bait",
    ),
  );
});

test("an approved, story-specific question may use ordinary conversational language", () => {
  const contextual = approvedStory({
    pinned_comment:
      "Which of these art styles do you like more: the original or the remake?",
  });
  contextual.pinned_comment_approval.text_sha256 = hashPinnedComment(
    contextual.pinned_comment,
  );

  assert.equal(assessPinnedComment(contextual).allowed, true);
});

test("absence of a pinned comment is a valid no-op", () => {
  assert.deepEqual(assessPinnedComment({ id: "story-1" }), {
    allowed: false,
    blockers: [],
    decision: "OMITTED",
    text: null,
  });
});

test("autonomous replies, reactions, rotations and blog generation are disabled", () => {
  for (const action of [
    "youtube_auto_reply",
    "youtube_auto_reaction",
    "youtube_pinned_comment_rotation",
    "youtube_generated_poll_comment",
    "post_publish_blog_generation",
  ]) {
    const assessed = assessPostPublishMutation(action, {
      automatic: true,
      story: approvedStory(),
    });
    assert.equal(assessed.allowed, false, action);
    assert.ok(
      assessed.blockers.includes("autonomous_post_publish_action_disabled"),
      action,
    );
  }
});

test("the upload path may post only the explicitly approved pinned comment", () => {
  const allowed = assessPostPublishMutation("youtube_pinned_comment", {
    automatic: false,
    story: approvedStory(),
  });
  assert.equal(allowed.allowed, true);
  assert.equal(
    allowed.payload.text,
    "Which of the four are you installing first?",
  );

  const automatic = assessPostPublishMutation("youtube_pinned_comment", {
    automatic: true,
    story: approvedStory(),
  });
  assert.equal(automatic.allowed, false);
  assert.ok(
    automatic.blockers.includes("pinned_comment_operator_action_required"),
  );
});

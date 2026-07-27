"use strict";

const crypto = require("node:crypto");

const DISABLED_AUTONOMOUS_ACTIONS = new Set([
  "youtube_auto_reply",
  "youtube_auto_reaction",
  "youtube_pinned_comment_rotation",
  "youtube_generated_poll_comment",
  "post_publish_blog_generation",
]);

const GENERIC_ENGAGEMENT_PATTERNS = [
  /\b(?:please\s+)?like\s+(?:this|the video)\b/i,
  /\blike\s*(?:,|&|\band\b)\s*subscribe\b/i,
  /\bsubscribe\b/i,
  /\bfollow(?:\s+(?:us|pulse))?\b/i,
  /\bcomment below\b/i,
  /\bdon['’]?t forget to\b/i,
  /\bsmash (?:that|the)\b/i,
  /\bturn on notifications\b/i,
];

function text(value) {
  return String(value || "").trim();
}

function hashPinnedComment(value) {
  return crypto
    .createHash("sha256")
    .update(text(value).replace(/\r\n/g, "\n"))
    .digest("hex");
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(text(value));
}

function validReviewedAt(value) {
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function assessPinnedComment(story = {}) {
  const comment = text(story?.pinned_comment);
  if (!comment) {
    return {
      allowed: false,
      blockers: [],
      decision: "OMITTED",
      text: null,
    };
  }

  const approval =
    story?.pinned_comment_approval &&
    typeof story.pinned_comment_approval === "object" &&
    !Array.isArray(story.pinned_comment_approval)
      ? story.pinned_comment_approval
      : {};
  const decision = text(approval.decision).toUpperCase();
  const blockers = [];

  if (decision !== "APPROVED") {
    blockers.push("pinned_comment_human_approval_required");
  }
  if (!text(story?.id) || text(approval.story_id) !== text(story?.id)) {
    blockers.push("pinned_comment_approval_story_mismatch");
  }
  if (!isSha256(approval.text_sha256)) {
    blockers.push("pinned_comment_approval_hash_required");
  } else if (
    text(approval.text_sha256).toLowerCase() !== hashPinnedComment(comment)
  ) {
    blockers.push("pinned_comment_approval_hash_mismatch");
  }
  if (!text(approval.contextual_rationale)) {
    blockers.push("pinned_comment_contextual_rationale_required");
  }
  if (!validReviewedAt(approval.reviewed_at)) {
    blockers.push("pinned_comment_review_time_required");
  }
  if (!text(approval.reviewer)) {
    blockers.push("pinned_comment_reviewer_required");
  }
  if (GENERIC_ENGAGEMENT_PATTERNS.some((pattern) => pattern.test(comment))) {
    blockers.push("pinned_comment_generic_engagement_bait");
  }

  return {
    allowed: blockers.length === 0,
    blockers: [...new Set(blockers)],
    decision: decision || "UNREVIEWED",
    text: comment,
  };
}

function assessPostPublishMutation(
  action,
  { automatic = true, story = {} } = {},
) {
  const normalisedAction = text(action).toLowerCase();
  const blockers = [];

  if (DISABLED_AUTONOMOUS_ACTIONS.has(normalisedAction)) {
    blockers.push("autonomous_post_publish_action_disabled");
  } else if (normalisedAction === "youtube_pinned_comment") {
    const comment = assessPinnedComment(story);
    blockers.push(...comment.blockers);
    if (automatic) {
      blockers.push("pinned_comment_operator_action_required");
    }
    return {
      action: normalisedAction,
      allowed: comment.text !== null && blockers.length === 0,
      blockers: [...new Set(blockers)],
      payload: comment.text === null ? null : { text: comment.text },
    };
  } else {
    blockers.push("post_publish_action_not_allowlisted");
  }

  return {
    action: normalisedAction,
    allowed: false,
    blockers: [...new Set(blockers)],
    payload: null,
  };
}

module.exports = {
  DISABLED_AUTONOMOUS_ACTIONS,
  assessPinnedComment,
  assessPostPublishMutation,
  hashPinnedComment,
};

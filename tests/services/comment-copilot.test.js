"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  analyseComment,
  buildCommentDigest,
  classifyComment,
  decideOutcome,
  renderCommentDigestMarkdown,
} = require("../../lib/comments/comment-copilot");

test("comment classifier separates safe praise from review-worthy comments", () => {
  assert.equal(classifyComment("🔥🔥🔥"), "hype_positive");
  assert.equal(classifyComment("good video"), "simple_support");
  assert.equal(classifyComment("when is it out?"), "question");
  assert.equal(classifyComment("this isn't new"), "correction");
  assert.equal(classifyComment("please do a video on Nintendo Direct"), "topic_suggestion");
  assert.equal(classifyComment("captions are too fast"), "useful_criticism");
});

test("decision policy only allows safe auto reply candidates", () => {
  assert.equal(decideOutcome("hype_positive"), "auto_reply_candidate");
  assert.equal(decideOutcome("simple_support"), "auto_reply_candidate");
  assert.equal(decideOutcome("question", { answerKnown: false }), "needs_review");
  assert.equal(decideOutcome("question", { answerKnown: true }), "auto_reply_candidate");
  assert.equal(decideOutcome("correction"), "needs_review");
  assert.equal(decideOutcome("abuse_spam"), "moderation_review");
});

test("analyseComment drafts replies only when policy allows it", () => {
  const hype = analyseComment({ id: "c1", text: "good video" });
  assert.equal(hype.decision, "auto_reply_candidate");
  assert.ok(hype.reply_draft);

  const correction = analyseComment({ id: "c2", text: "this is wrong" });
  assert.equal(correction.decision, "needs_review");
  assert.equal(correction.reply_draft, null);
});

test("comment digest writes draft-only queue and safety flags", () => {
  const digest = buildCommentDigest({
    comments: [
      { id: "a", text: "🔥🔥🔥" },
      { id: "b", text: "when is it out?" },
      { id: "c", text: "close your channel" },
    ],
    optionsByCommentId: {
      b: {
        answerKnown: true,
        knownAnswer: "No release date has been confirmed yet.",
      },
    },
  });
  assert.equal(digest.replyQueue.length, 2);
  assert.equal(digest.safety.sendsReplies, false);
  assert.equal(digest.categoryCounts.hostile_but_useful, 1);
  const md = renderCommentDigestMarkdown(digest);
  assert.match(md, /Draft-only/);
});

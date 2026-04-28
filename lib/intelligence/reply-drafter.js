"use strict";

/**
 * lib/intelligence/reply-drafter.js — Session 3 (intelligence pass).
 *
 * Generates a DRAFT reply for a classified comment. Every output is
 * tagged `is_draft: true` and `auto_send: false`. This module never
 * sends, never likes, never hearts, never moderates. It produces a
 * suggestion an operator can copy/paste or edit.
 *
 * Templates intentionally do not use ChatGPT-tells (em-dashes,
 * over-formal "Thanks for watching!" boilerplate, exclamation
 * stacks). British English. No serial commas.
 */

const TEMPLATES = {
  question: (c) =>
    `Good question. The honest answer is what's actually verified is ${cuePoint(c)}. If anything firmer drops we'll cover it.`,
  topic_suggestion: () =>
    `Logged. If two more viewers ask for it I'll bump it up the queue.`,
  correction: () =>
    `Thanks for the correction. We'll re-check the source and flag it on the channel if it changes anything.`,
  useful_criticism: () =>
    `Noted on the production side. We track every comment of this kind and you'll see the change in a future video, not in a reply.`,
  hostile_useful: () =>
    `Disagree on the framing but the underlying point is fair. Keeping it on the list of things to address.`,
};

function cuePoint(comment) {
  const text = String(
    comment?.textOriginal || comment?.text || "",
  ).toLowerCase();
  if (/release|date|launch/.test(text))
    return "the release window the publisher has officially stated";
  if (/platform|console|pc/.test(text))
    return "the platforms that are listed on the official store page";
  if (/price|cost/.test(text))
    return "the price the publisher has confirmed in their press kit";
  return "what the publisher or store page actually states";
}

function draftReply({ comment, verdict }) {
  if (!verdict) return null;
  const tpl = TEMPLATES[verdict.category];
  if (!tpl) return null;
  if (
    verdict.decision !== "draft_reply_candidate" &&
    verdict.decision !== "needs_review"
  ) {
    // Still produce a draft for needs_review categories so the
    // operator can review the suggested wording — but mark it as
    // draft only.
    if (
      verdict.decision === "no_reply_needed" ||
      verdict.decision === "ignore" ||
      verdict.decision === "moderation_review"
    ) {
      return null;
    }
  }
  return {
    is_draft: true,
    auto_send: false,
    requires_operator_review: true,
    text: tpl(comment),
    sources_referenced: ["story.full_script", "story.suggested_title"],
    safety_notes: [
      "never sent automatically",
      "never used as a like/heart/moderation action",
      "operator must review before posting",
    ],
  };
}

function buildReplyQueue(classified = []) {
  const out = [];
  for (const entry of classified) {
    const draft = draftReply(entry);
    if (!draft) continue;
    out.push({
      comment_id: entry.comment?.id || entry.comment?.commentId || null,
      video_id: entry.comment?.videoId || null,
      author: entry.comment?.authorDisplayName || null,
      original_text: entry.comment?.textOriginal || entry.comment?.text || null,
      verdict: entry.verdict,
      draft,
    });
  }
  return out;
}

module.exports = {
  draftReply,
  buildReplyQueue,
  TEMPLATES,
};

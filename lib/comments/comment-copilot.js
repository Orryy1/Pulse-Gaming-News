"use strict";

const CATEGORY_VALUES = Object.freeze([
  "hype_positive",
  "simple_support",
  "correction",
  "disagreement",
  "useful_criticism",
  "topic_suggestion",
  "question",
  "joke_meme",
  "hostile_but_useful",
  "abuse_spam",
  "low_value_noise",
]);

const DECISION_VALUES = Object.freeze([
  "auto_reply_candidate",
  "needs_review",
  "no_reply_needed",
  "moderation_review",
  "ignore",
]);

function normaliseText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function classifyComment(text) {
  const raw = normaliseText(text);
  const lower = raw.toLowerCase();
  if (!raw) return "low_value_noise";
  if (/https?:\/\/|free\s+followers|promo|telegram|whatsapp|crypto\s+airdrop/i.test(raw)) return "abuse_spam";
  if (/(kill yourself|kys|slur|hate speech|nazi)/i.test(raw)) return "abuse_spam";
  if (/close your channel|trash channel|delete this/i.test(lower)) return "hostile_but_useful";
  if (/(actually|wrong|not true|incorrect|isn't new|is not new|this is old|already announced|fake)/i.test(lower)) return "correction";
  if (/(i disagree|nah|no way|bad take|greedy|overhyped)/i.test(lower)) return "disagreement";
  if (/(too fast|too slow|caption|audio|voice|edit|quality|source|where is the source)/i.test(lower)) return "useful_criticism";
  if (/(cover|do a video|talk about|next do|what about|please do)/i.test(lower)) return "topic_suggestion";
  if (/\?$|when is|release date|what platform|is it on|where can/i.test(lower)) return "question";
  if (/lol|lmao|meme|skull|💀|😂/i.test(raw)) return "joke_meme";
  if (/^(🔥|fire|hype|lets go|let's go|goated|peak|massive|wild)+[!\s🔥]*$/i.test(raw)) return "hype_positive";
  if (/good video|nice video|love this|great short|thanks|thank you|subbed|keep it up/i.test(lower)) return "simple_support";
  if (/^[🔥💯❤️👍👏\s!]+$/u.test(raw)) return "hype_positive";
  if (raw.length <= 3) return "low_value_noise";
  return "low_value_noise";
}

function decideOutcome(category, { answerKnown = false } = {}) {
  if (category === "abuse_spam") return "moderation_review";
  if (category === "hype_positive" || category === "simple_support") return "auto_reply_candidate";
  if (category === "question") return answerKnown ? "auto_reply_candidate" : "needs_review";
  if (category === "correction" || category === "disagreement" || category === "useful_criticism" || category === "topic_suggestion" || category === "hostile_but_useful") return "needs_review";
  if (category === "joke_meme") return "no_reply_needed";
  return "ignore";
}

function draftReply(comment, { category, answerKnown = false, knownAnswer = "" } = {}) {
  if (category === "hype_positive") return "Appreciate it. This reveal is darker than I expected.";
  if (category === "simple_support") return "Thanks for watching. More verified gaming updates are coming.";
  if (category === "question" && answerKnown && knownAnswer) return knownAnswer;
  return null;
}

function usefulSignalFor(comment, category) {
  const text = normaliseText(comment.text || comment.commentText || comment.body);
  if (category === "topic_suggestion") return `Topic request: ${text}`;
  if (category === "correction") return `Correction to review: ${text}`;
  if (category === "useful_criticism") return `Production feedback: ${text}`;
  if (category === "question") return `Viewer question: ${text}`;
  if (category === "hostile_but_useful") return `Hostile feedback to inspect manually: ${text}`;
  return null;
}

function analyseComment(comment = {}, options = {}) {
  const text = normaliseText(comment.text || comment.commentText || comment.body);
  const category = classifyComment(text);
  const outcome = decideOutcome(category, options);
  const reply = outcome === "auto_reply_candidate" ? draftReply(comment, { category, ...options }) : null;
  return {
    comment_id: comment.id || comment.comment_id || null,
    video_id: comment.video_id || options.video_id || null,
    text,
    category,
    decision: outcome,
    reply_draft: reply,
    useful_signal: usefulSignalFor({ text }, category),
    needs_manual_review: outcome === "needs_review" || outcome === "moderation_review",
  };
}

function countsBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] || "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function buildCommentDigest({ comments = [], optionsByCommentId = {}, defaultOptions = {} } = {}) {
  const analysed = comments.map((comment) => {
    const id = comment.id || comment.comment_id;
    return analyseComment(comment, { ...defaultOptions, ...(optionsByCommentId[id] || {}) });
  });
  const replyQueue = analysed
    .filter((row) => row.decision === "auto_reply_candidate" && row.reply_draft)
    .map((row) => ({
      comment_id: row.comment_id,
      video_id: row.video_id,
      category: row.category,
      reply_draft: row.reply_draft,
      send_status: "draft_only",
    }));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dataSource: "fixture",
    newCommentCount: analysed.length,
    categoryCounts: countsBy(analysed, "category"),
    decisionCounts: countsBy(analysed, "decision"),
    comments: analysed,
    replyQueue,
    usefulViewerSignals: analysed.filter((row) => row.useful_signal).map((row) => row.useful_signal),
    safety: {
      sendsReplies: false,
      likesComments: false,
      heartsComments: false,
      moderatesComments: false,
    },
  };
}

function renderCommentDigestMarkdown(digest) {
  const lines = [];
  lines.push("# Comment Copilot v1");
  lines.push("");
  lines.push(`Generated: ${digest.generatedAt}`);
  lines.push(`Data source: ${digest.dataSource}`);
  lines.push(`New comments: ${digest.newCommentCount}`);
  lines.push("");
  lines.push("## Classification counts");
  for (const [key, value] of Object.entries(digest.categoryCounts)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Decision counts");
  for (const [key, value] of Object.entries(digest.decisionCounts)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Draft replies");
  if (!digest.replyQueue.length) {
    lines.push("- None");
  } else {
    for (const item of digest.replyQueue) {
      lines.push(`- ${item.comment_id || "unknown"}: ${item.reply_draft}`);
    }
  }
  lines.push("");
  lines.push("## Useful viewer signals");
  if (!digest.usefulViewerSignals.length) {
    lines.push("- None");
  } else {
    for (const signal of digest.usefulViewerSignals) lines.push(`- ${signal}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- Draft-only. No replies, likes, hearts or moderation actions were sent.");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  CATEGORY_VALUES,
  DECISION_VALUES,
  analyseComment,
  buildCommentDigest,
  classifyComment,
  decideOutcome,
  draftReply,
  renderCommentDigestMarkdown,
};

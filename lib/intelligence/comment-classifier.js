"use strict";

/**
 * lib/intelligence/comment-classifier.js — Session 3 (intelligence pass).
 *
 * Pure / sync classifier for incoming YouTube comments. No LLM call,
 * no network, no DB. Operates on text-only heuristics so the same
 * input always produces the same verdict — important for tests, for
 * audit trails, and for not paying for inference on noise comments.
 *
 * 11 categories (matching Session 3 §6.7):
 *   hype | support | correction | disagreement | useful_criticism
 *   topic_suggestion | question | joke_meme | hostile_useful
 *   abuse_spam | noise
 *
 * 5 decisions:
 *   draft_reply_candidate | needs_review | no_reply_needed
 *   moderation_review     | ignore
 *
 * The classifier never produces an action — it only labels. The
 * draft-reply generator runs separately and ALWAYS marks output as
 * draft. Replies, likes, hearts and moderation actions are never
 * triggered from this module.
 */

const ABUSE_RE =
  /\b(idiot|stupid|moron|retard|fag|kys|kill\s+yourself|nazi|cunt|n[\W_]*[i!1][\W_]*g[\W_]*g|wh[i1]te[\W_]*power)\b/i;
const SPAM_RE =
  /(https?:\/\/[^\s]+(\.ly|\.gg|t\.me|telegram\.me|discord\.gg|free[\W_]*nitro|onlyfans|join[\W_]*my))|\b(whatsapp\s*\+?\d|cashapp|venmo|crypto[\W_]*(?:airdrop|giveaway))\b/i;
const HYPE_RE =
  /\b(hyped|hyping|day[\W_]*1|day[\W_]*one|launch[\W_]*day|cant[\W_]*wait|so[\W_]*excited|pre[\W_]*order(?:ed)?|goat|peak|fire|fr[\W_]*fr|stoked)\b/i;
const SIMPLE_SUPPORT_RE =
  /^(?:\s*(?:nice|great|amazing|awesome|love(?:d|ly)?|good|cool|legend|w|gw|👍|❤️|🔥|🎮|💯)\s*[!.]*\s*)+$/i;
const QUESTION_RE = /\?\s*$/;
const SUGGESTION_RE =
  /\b(can\s+you\s+(?:cover|do|make|talk\s+about))|please\s+(?:cover|do|review)|(?:do|cover)\s+(?:a|an)\s+(?:video|short|breakdown)\s+on\b|next[\W_]*video[\W_]*(?:should|could)\b|topic[\W_]*idea|video[\W_]*idea/i;
const CORRECTION_RE =
  /\b(actually|fyi|to\s+clarify|small\s+correction|that\'?s\s+(?:not|wrong|incorrect)|incorrect\s+at|wrong[\W_]+at|got\s+it\s+wrong|misread|misquoted|the\s+actual)\b/i;
const DISAGREE_RE =
  /\b(?:disagree|don\'?t\s+agree|hard\s+disagree|nope[!\.]|that\'?s\s+wrong|completely\s+wrong|terrible\s+take|bad\s+take|cope|cap)\b/i;
const USEFUL_CRITICISM_RE =
  /\b(audio\b[^.\n]{0,30}\b(?:low|loud|quiet|muddy|peaking|too\s+(?:low|loud|quiet))|music\s+too\s+loud|captions?\b[^.\n]{0,30}\b(?:wrong|off|missing|mistimed|out\s+of\s+sync|delayed)|thumbnail\b[^.\n]{0,30}\b(?:misleading|clickbait|wrong|broken)|video\s+too\s+(?:long|short)|pacing\s+(?:slow|fast)|too\s+much\s+filler|hook\s+too\s+long|outro\s+too\s+long)\b/i;
const HOSTILE_USEFUL_HEDGE_RE =
  /\b(but\s+honestly|but\s+i\s+still|i\s+still\s+watched|still\s+a\s+good\s+point|that\s+said)\b/i;
const JOKE_MEME_RE =
  /\b(lol|lmao|rofl|😂|🗿|skill\s+issue|bonk|sus|gigachad|based|cope|ratio\b)\b/i;

function normaliseText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyComment(comment = {}) {
  const text = normaliseText(
    comment.textOriginal || comment.text || comment.comment || "",
  );
  if (!text) {
    return {
      category: "noise",
      decision: "ignore",
      reasons: ["empty_text"],
      confidence: "low",
    };
  }

  const reasons = [];

  // Abuse / spam fire first — they are terminal.
  if (ABUSE_RE.test(text)) {
    reasons.push("matched_abuse_term");
    return {
      category: "abuse_spam",
      decision: "moderation_review",
      reasons,
      confidence: "high",
    };
  }
  if (SPAM_RE.test(text)) {
    reasons.push("matched_spam_pattern");
    return {
      category: "abuse_spam",
      decision: "moderation_review",
      reasons,
      confidence: "high",
    };
  }

  // Useful criticism (technical fault) — high signal.
  if (USEFUL_CRITICISM_RE.test(text)) {
    reasons.push("matched_useful_criticism");
    return {
      category: "useful_criticism",
      decision: "needs_review",
      reasons,
      confidence: "high",
    };
  }

  // Correction (factual fix) — surface but do not argue.
  if (CORRECTION_RE.test(text)) {
    reasons.push("matched_correction");
    return {
      category: "correction",
      decision: "needs_review",
      reasons,
      confidence: "medium",
    };
  }

  // Topic suggestion — feed the learning digest.
  if (SUGGESTION_RE.test(text)) {
    reasons.push("matched_topic_suggestion");
    return {
      category: "topic_suggestion",
      decision: "needs_review",
      reasons,
      confidence: "medium",
    };
  }

  // Hostile-but-useful — disagreement with a hedge or a useful nub.
  if (DISAGREE_RE.test(text) && HOSTILE_USEFUL_HEDGE_RE.test(text)) {
    reasons.push("matched_disagree_with_hedge");
    return {
      category: "hostile_useful",
      decision: "needs_review",
      reasons,
      confidence: "medium",
    };
  }
  if (DISAGREE_RE.test(text)) {
    reasons.push("matched_disagree");
    return {
      category: "disagreement",
      decision: "no_reply_needed",
      reasons,
      confidence: "medium",
    };
  }

  // Question — needs a draft reply candidate (still not auto-sent).
  if (QUESTION_RE.test(text)) {
    reasons.push("matched_question");
    return {
      category: "question",
      decision: "draft_reply_candidate",
      reasons,
      confidence: "medium",
    };
  }

  // Hype — most common positive comment, no reply needed.
  if (HYPE_RE.test(text)) {
    reasons.push("matched_hype");
    return {
      category: "hype",
      decision: "no_reply_needed",
      reasons,
      confidence: "medium",
    };
  }
  if (SIMPLE_SUPPORT_RE.test(text)) {
    reasons.push("matched_simple_support");
    return {
      category: "support",
      decision: "no_reply_needed",
      reasons,
      confidence: "medium",
    };
  }

  // Joke / meme — surface in summary but ignore for replies.
  if (JOKE_MEME_RE.test(text)) {
    reasons.push("matched_joke_meme");
    return {
      category: "joke_meme",
      decision: "ignore",
      reasons,
      confidence: "low",
    };
  }

  // Default: noise.
  reasons.push("no_pattern_matched");
  return { category: "noise", decision: "ignore", reasons, confidence: "low" };
}

function classifyMany(comments = []) {
  return (Array.isArray(comments) ? comments : []).map((c) => ({
    comment: c,
    verdict: classifyComment(c),
  }));
}

function summariseVerdicts(verdicts = []) {
  const counts = {
    hype: 0,
    support: 0,
    correction: 0,
    disagreement: 0,
    useful_criticism: 0,
    topic_suggestion: 0,
    question: 0,
    joke_meme: 0,
    hostile_useful: 0,
    abuse_spam: 0,
    noise: 0,
  };
  const decisions = {
    draft_reply_candidate: 0,
    needs_review: 0,
    no_reply_needed: 0,
    moderation_review: 0,
    ignore: 0,
  };
  let total = 0;
  for (const entry of verdicts) {
    const v = entry.verdict || entry;
    if (!v || !v.category) continue;
    total++;
    counts[v.category] = (counts[v.category] || 0) + 1;
    decisions[v.decision] = (decisions[v.decision] || 0) + 1;
  }
  return { total, counts, decisions };
}

module.exports = {
  classifyComment,
  classifyMany,
  summariseVerdicts,
};

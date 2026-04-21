/**
 * lib/services/script-lint.js — post-generation script linter.
 *
 * Pulse's existing content-qa.js runs JUST before publish and
 * catches render-breaking artefacts (missing MP4, glued sentence
 * tokens, etc). This module runs JUST after Claude produces a
 * script draft, before TTS spends dollars on audio. Catches the
 * stylistic issues that would make a script "publishable but bad".
 *
 * Shape mirrors content-qa.js so integration callers can use the
 * same { result: pass|warn|fail, failures[], warnings[] } branch.
 *
 * Intentionally narrow: this is not a general-purpose English
 * linter. Every rule here is a specific "AI-generated script
 * tell" that Pulse has seen in the wild AND that a human writer
 * wouldn't accidentally trip. Adding rules is cheap; adding false
 * positives is expensive (retry loop in processor.js burns Claude
 * tokens), so err conservative.
 */

// ---------- rule definitions ----------

// Banned stock phrases. Same list as content-qa but keyed on
// script-time so we catch them BEFORE the video renders. Kept as
// a separate constant rather than imported so each module's rule
// set can diverge over time (script-time wants to catch "So, in
// this video I'll"; content-time wants to catch clickbait closers).
const BANNED_PHRASES = [
  {
    re: /let me know in the comments/i,
    reason: "generic_comments_cta",
  },
  {
    re: /don'?t forget to (?:smash|hit|click) (?:the|that) like/i,
    reason: "smash_that_like",
  },
  {
    re: /(?:hey|hi),?\s+guys,?\s+welcome back/i,
    reason: "generic_youtube_opener",
  },
  {
    re: /in this video,? i('ll| will)/i,
    reason: "generic_video_intro",
  },
  {
    re: /buckle up,? folks/i,
    reason: "filler_phrase",
  },
  {
    re: /today,? we('re| are) going to/i,
    reason: "filler_phrase",
  },
];

// Glued sentence boundary: lowercase then period then uppercase
// without a space. e.g. "the game.Players rushed in". A common
// TTS / concat artefact in early Pulse scripts.
const GLUED_SENTENCE_RE = /[a-z]\.[A-Z]/;

// American time format ("12:15 PM"). Pulse house style is
// British-English 24h. Warn, not fail.
const AMERICAN_TIME_RE = /\b\d{1,2}:\d{2}\s?(?:AM|PM|am|pm)\b/;

// Generic first-words — any of these as the LITERAL first 1-3
// tokens suggests Claude fell back to a stock opener rather than
// the curiosity-gap hook the system prompt asks for.
const GENERIC_OPENERS = new Set([
  "So",
  "Today",
  "Hey",
  "Hi",
  "Welcome",
  "Hello",
  "Alright",
  "Okay",
  "In",
]);

// Filler phrases that survive the system prompt and end up in the
// body. Too many of these signals the script is padding rather
// than delivering facts.
const FILLER_PHRASES = [
  "as you can see",
  "without further ado",
  "at the end of the day",
  "to be honest",
  "at this point in time",
  "needless to say",
];

// Word count bounds — tighter than content-qa's 80-220 because
// Pulse shorts target 120-150 words (130-140 sweet spot) and we
// want the linter to catch drift early.
const DEFAULT_MIN_WORDS = 110;
const DEFAULT_MAX_WORDS = 170;

// Max times the same significant phrase can appear before we flag
// it as mid-roll repetition. 3-or-more-word phrases only — trying
// to catch "Here's what's strange..." repeating in hook + loop.
const REPETITION_WINDOW_WORDS = 4;
const REPETITION_MAX_OCCURRENCES = 2;

// Minimum number of curiosity-gap markers. These signals are what
// the system prompt asks for in the hook + loop sections.
const CURIOSITY_MARKERS = [
  /here'?s why/i,
  /here'?s what/i,
  /nobody (?:saw|realised|predicted)/i,
  /turns out/i,
  /reportedly/i,
  /sources? (?:say|suggest|have)/i,
  /it wasn'?t/i,
  /what (?:nobody|no one)/i,
  /the (?:reason|catch|twist)/i,
  /the kicker/i,
];

// ---------- helpers ----------

function countWords(text) {
  if (typeof text !== "string") return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function firstNWords(text, n) {
  if (typeof text !== "string") return [];
  return text.trim().split(/\s+/).filter(Boolean).slice(0, n);
}

function countFillerPhrases(text) {
  if (typeof text !== "string") return 0;
  const lower = text.toLowerCase();
  let total = 0;
  for (const phrase of FILLER_PHRASES) {
    const hay = lower;
    let idx = hay.indexOf(phrase);
    while (idx !== -1) {
      total++;
      idx = hay.indexOf(phrase, idx + phrase.length);
    }
  }
  return total;
}

function findRepeatedNGrams(text) {
  if (typeof text !== "string") return [];
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const counts = new Map();
  const n = REPETITION_WINDOW_WORDS;
  for (let i = 0; i + n <= words.length; i++) {
    const ngram = words.slice(i, i + n).join(" ");
    counts.set(ngram, (counts.get(ngram) || 0) + 1);
  }
  const out = [];
  for (const [ngram, c] of counts.entries()) {
    if (c > REPETITION_MAX_OCCURRENCES) {
      out.push({ ngram, count: c });
    }
  }
  return out;
}

// ---------- main entry point ----------

/**
 * Lint a freshly-generated script. Returns:
 *   { result: "pass"|"warn"|"fail",
 *     failures: string[], warnings: string[] }
 *
 * failures hard-block the script (caller should retry with feedback
 * or defer to review). warnings are logged but do not block.
 *
 * @param {string} script — the full_script / tts_script text
 * @param {{ minWords?: number, maxWords?: number }} [opts]
 */
function lintScript(script, opts = {}) {
  const failures = [];
  const warnings = [];
  const minWords =
    typeof opts.minWords === "number" ? opts.minWords : DEFAULT_MIN_WORDS;
  const maxWords =
    typeof opts.maxWords === "number" ? opts.maxWords : DEFAULT_MAX_WORDS;

  if (typeof script !== "string" || script.trim().length === 0) {
    return { result: "fail", failures: ["script_missing"], warnings: [] };
  }

  // 1. Word count
  const words = countWords(script);
  if (words < minWords) {
    failures.push(`script_too_short (${words} words, min ${minWords})`);
  } else if (words > maxWords) {
    warnings.push(`script_too_long (${words} words, max ${maxWords})`);
  }

  // 2. Banned stock phrases (hard fail)
  for (const { re, reason } of BANNED_PHRASES) {
    if (re.test(script)) failures.push(`banned_phrase:${reason}`);
  }

  // 3. Glued sentence token (hard fail — caption-breaking)
  if (GLUED_SENTENCE_RE.test(script)) failures.push("glued_sentence");

  // 4. American time format (warn)
  if (AMERICAN_TIME_RE.test(script)) warnings.push("american_time_format");

  // 5. Generic opener (hard fail — ruins the first 2 seconds)
  const first = firstNWords(script, 1);
  if (first.length > 0) {
    const cleaned = first[0].replace(/[^a-zA-Z]/g, "");
    if (GENERIC_OPENERS.has(cleaned)) {
      failures.push(`generic_opener:${cleaned}`);
    }
  }

  // 6. Repeated phrase (warn — Pulse's loop back-reference
  // sometimes repeats the hook's first 4 words; a few are fine)
  const repeats = findRepeatedNGrams(script);
  if (repeats.length > 0) {
    warnings.push(
      `repeated_phrase:${repeats.map((r) => `${r.count}×"${r.ngram}"`).join(",")}`,
    );
  }

  // 7. Filler phrase density (warn at >= 2 filler phrases)
  const filler = countFillerPhrases(script);
  if (filler >= 2) {
    warnings.push(`filler_dense:${filler}`);
  }

  // 8. Curiosity-gap markers. If we see ZERO, the hook/loop is
  // almost certainly generic. Warn, not fail — some well-written
  // scripts deliver the gap without any of the standard markers.
  const anyMarker = CURIOSITY_MARKERS.some((re) => re.test(script));
  if (!anyMarker) {
    warnings.push("no_curiosity_marker");
  }

  let result;
  if (failures.length > 0) result = "fail";
  else if (warnings.length > 0) result = "warn";
  else result = "pass";

  return { result, failures, warnings };
}

/**
 * Build a feedback block suitable for inclusion in a retry prompt.
 * Never echoes the original script body (the caller already has
 * it) and never includes secret-shaped fields — every line is
 * one of the enum tags we emit.
 */
function buildRetryFeedback(lintResult) {
  if (!lintResult || !Array.isArray(lintResult.failures)) return "";
  if (lintResult.failures.length === 0) return "";
  const lines = [
    "PREVIOUS DRAFT WAS REJECTED BY SCRIPT LINT. Rewrite the script.",
    "Failures to fix:",
    ...lintResult.failures.map((f) => `  - ${f}`),
  ];
  if (lintResult.warnings.length > 0) {
    lines.push("Also worth addressing:");
    for (const w of lintResult.warnings) lines.push(`  - ${w}`);
  }
  return lines.join("\n");
}

module.exports = {
  lintScript,
  buildRetryFeedback,
  countWords,
  findRepeatedNGrams,
  countFillerPhrases,
  BANNED_PHRASES,
  GLUED_SENTENCE_RE,
  AMERICAN_TIME_RE,
  GENERIC_OPENERS,
  FILLER_PHRASES,
  CURIOSITY_MARKERS,
  DEFAULT_MIN_WORDS,
  DEFAULT_MAX_WORDS,
};

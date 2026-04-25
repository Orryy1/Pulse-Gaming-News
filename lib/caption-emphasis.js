/**
 * lib/caption-emphasis.js — keyword-aware ASS caption generation.
 *
 * Replaces the legacy single-style ASS output that drew every
 * caption phrase in the same 90pt Impact white text. The
 * redesigned generator:
 *
 *   - Uses ElevenLabs word-level timestamps when present (the
 *     existing `<id>_timestamps.json` payload). NO silent fall-
 *     through to even-spacing for fresh stories — drift was the
 *     biggest single complaint on the GTA 6 video.
 *
 *   - Splits each phrase into word spans. Words matching any of
 *     the EMPHASIS_PATTERNS (proper nouns derived from the story
 *     title, money, percentages, dates, all-caps tokens) get
 *     wrapped in `{\rEmphasis}` — a SECOND ASS style with a 1.15×
 *     scale and a brand-orange primary colour.
 *
 *   - Caps the on-screen time per phrase at 2.2s so a slow line
 *     doesn't camp on screen.
 *
 *   - Always anchors phrase START times to the actual word
 *     timestamps. The legacy code anchored the FIRST word and then
 *     paced internally — which drifted on long stories. The new
 *     anchor is per-phrase boundary.
 *
 * The output is a complete ASS file string. The caller writes it to
 * disk and feeds the path to `ass=` in the filter graph.
 */

"use strict";

const PHRASE_MAX_DURATION_S = 2.2;
const PHRASE_MIN_DURATION_S = 0.7;
const WORDS_PER_PHRASE = 4; // 3-4 word phrases read fastest

// Emphasis patterns. Order matters — more specific first.
const EMPHASIS_PATTERNS = [
  /^\$[\d.,]+[bm]?$/i, // $5, $1.2B, $400m
  /^[\d.,]+%$/, // 47%
  /^\d{4}$/, // years
  /^\d+(\.\d+)?$/, // bare numbers (3, 2.5)
  /^[A-Z]{2,}$/, // ALL CAPS abbreviations (GTA, EA)
];

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "then",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "for",
  "with",
  "from",
  "as",
  "that",
  "this",
  "these",
  "those",
  "it",
  "its",
  "they",
  "their",
  "them",
  "he",
  "she",
  "his",
  "her",
  "you",
  "your",
  "we",
  "our",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "can",
  "may",
  "just",
  "only",
  "also",
  "very",
  "really",
  "more",
  "most",
  "some",
  "all",
  "any",
  "not",
  "no",
]);

const ASS_HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Impact,84,&H00FFFFFF,&H00FFFFFF,&H00000000,&HC8000000,-1,0,0,0,100,100,2,0,1,5,3,2,40,40,260,1
Style: Emphasis,Impact,96,&H001A6BFF,&H001A6BFF,&H00000000,&HC8000000,-1,0,0,0,115,115,2,0,1,5,3,2,40,40,260,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

/**
 * Extract proper nouns from the story title. These become per-story
 * emphasis tokens. e.g. for "GTA 6 release date confirmed" we
 * emphasise "GTA" and "6".
 */
function extractStoryEmphasisTokens(story) {
  const title = story.title || "";
  const tokens = title
    .split(/\s+/)
    .map((w) => w.replace(/[.,;:!?"'()[\]]/g, ""))
    .filter(Boolean);
  const result = new Set();
  for (const t of tokens) {
    // Single-digit numbers are meaningful ("GTA 6", "PS5"), single
    // letters are not — keep numerics, drop one-char words.
    if (t.length < 1) continue;
    if (t.length < 2 && !/^\d$/.test(t)) continue;
    if (STOPWORDS.has(t.toLowerCase())) continue;
    // Proper noun (capitalised) OR pure number OR all-caps
    if (/^[A-Z]/.test(t) || /^\d/.test(t)) {
      result.add(t.toUpperCase());
    }
  }
  return result;
}

function isEmphasisWord(word, storyTokens) {
  const stripped = word.replace(/[.,;:!?"'()[\]]/g, "");
  if (!stripped) return false;
  if (storyTokens.has(stripped.toUpperCase())) return true;
  for (const re of EMPHASIS_PATTERNS) {
    if (re.test(stripped)) return true;
  }
  return false;
}

/**
 * Group word-level timestamps into phrases. Each phrase is roughly
 * `WORDS_PER_PHRASE` words but breaks early on punctuation so the
 * reading rhythm matches the speech.
 *
 * @param {Array<{word, start, end}>} words
 * @returns {Array<{words, start, end}>}
 */
function groupIntoPhrases(words) {
  const out = [];
  let buffer = [];
  let phraseStart = null;
  for (const w of words) {
    if (!w || typeof w.word !== "string") continue;
    if (phraseStart === null) phraseStart = w.start;
    buffer.push(w);
    // Only break on SENTENCE-ENDING punctuation (.!?). Commas,
    // colons and semicolons mid-sentence used to force a break, which
    // shattered game titles like "Clair Obscur: Expedition 33"
    // across two lines with a visible gap. Keep them on one phrase.
    const endsSentence = /[.!?]$/.test(w.word);
    if (buffer.length >= WORDS_PER_PHRASE || endsSentence) {
      out.push({ words: buffer, start: phraseStart, end: w.end });
      buffer = [];
      phraseStart = null;
    }
  }
  if (buffer.length) {
    out.push({
      words: buffer,
      start: phraseStart,
      end: buffer[buffer.length - 1].end,
    });
  }
  return out;
}

/**
 * Format seconds as ASS timestamp h:mm:ss.cc
 */
function fmtAss(seconds) {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const wholeS = Math.floor(sec);
  const cs = Math.round((sec - wholeS) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(wholeS).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/**
 * Render a phrase's text with per-word style switches.
 * Format example: "Witcher {\rEmphasis}3{\rCaption} director just"
 */
function renderPhraseText(phrase, storyTokens) {
  const parts = [];
  let currentStyle = "Caption";
  for (const w of phrase.words) {
    const wantStyle = isEmphasisWord(w.word, storyTokens)
      ? "Emphasis"
      : "Caption";
    if (wantStyle !== currentStyle) {
      parts.push(`{\\r${wantStyle}}`);
      currentStyle = wantStyle;
    }
    parts.push(w.word);
    parts.push(" ");
  }
  return parts.join("").trim();
}

/**
 * Build the full ASS file string from word-level timestamps.
 *
 * @param {object} args
 * @param {object} args.story
 * @param {Array<{word, start, end}>} args.words
 * @param {number} args.duration  total clamp — captions never run
 *                                 past this (in seconds)
 * @returns {string}  the .ass file contents
 */
function buildAss({ story, words, duration }) {
  const storyTokens = extractStoryEmphasisTokens(story || {});
  const phrases = groupIntoPhrases(words || []);

  const events = [];
  for (const p of phrases) {
    let start = p.start;
    let end = p.end;

    // Clamp duration: snap-out earlier than next phrase if the
    // phrase ran long.
    if (end - start > PHRASE_MAX_DURATION_S) {
      end = start + PHRASE_MAX_DURATION_S;
    }
    // Pad short phrases to the minimum readable hold.
    if (end - start < PHRASE_MIN_DURATION_S) {
      end = start + PHRASE_MIN_DURATION_S;
    }
    // Never run past the duration cap.
    if (duration && end > duration) end = duration;
    if (start >= end) continue;

    const text = renderPhraseText(p, storyTokens);
    if (!text) continue;

    events.push(
      `Dialogue: 0,${fmtAss(start)},${fmtAss(end)},Caption,,0,0,0,,${text}`,
    );
  }

  return `${ASS_HEADER}\n${events.join("\n")}\n`;
}

/**
 * Convenience: load timestamps from disk + build the .ass.
 * Throws if the timestamps file is missing — callers must decide
 * how to handle that. The whole point of the redesign is to refuse
 * silent fall-through.
 */
async function buildAssFromTimestampsFile({ story, timestampsPath, duration }) {
  const fs = require("fs-extra");
  if (!timestampsPath || !(await fs.pathExists(timestampsPath))) {
    throw new Error(
      `[caption-emphasis] missing word-level timestamps for ${story?.id || "?"} at ${timestampsPath}`,
    );
  }
  const data = await fs.readJson(timestampsPath);
  // ElevenLabs returns either { alignment: { characters, ... } } or
  // a `words` array depending on endpoint version. Normalise.
  let words = [];
  if (Array.isArray(data?.words)) {
    words = data.words;
  } else if (Array.isArray(data?.alignment?.words)) {
    words = data.alignment.words;
  } else if (Array.isArray(data?.characters)) {
    // Character-level → reassemble into words at whitespace.
    words = charsToWords(data);
  } else if (Array.isArray(data?.alignment?.characters)) {
    words = charsToWords(data.alignment);
  } else {
    throw new Error(
      `[caption-emphasis] unrecognised timestamps schema for ${story?.id}`,
    );
  }
  return buildAss({ story, words, duration });
}

/**
 * Convert character-level alignment {characters, character_start_times_seconds, character_end_times_seconds}
 * into word-level entries.
 */
function charsToWords(data) {
  const chars = data.characters;
  const starts =
    data.character_start_times_seconds || data.characterStartTimesSeconds || [];
  const ends =
    data.character_end_times_seconds || data.characterEndTimesSeconds || [];
  const words = [];
  let buffer = "";
  let bufStart = null;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === " " || ch === "\n" || ch === "\t") {
      if (buffer) {
        words.push({
          word: buffer,
          start: bufStart,
          end: ends[i - 1] ?? bufStart,
        });
        buffer = "";
        bufStart = null;
      }
    } else {
      if (bufStart === null) bufStart = starts[i] ?? 0;
      buffer += ch;
    }
  }
  if (buffer && bufStart !== null) {
    words.push({
      word: buffer,
      start: bufStart,
      end: ends[ends.length - 1] ?? bufStart,
    });
  }
  return words;
}

module.exports = {
  buildAss,
  buildAssFromTimestampsFile,
  groupIntoPhrases,
  isEmphasisWord,
  extractStoryEmphasisTokens,
  renderPhraseText,
  PHRASE_MAX_DURATION_S,
  PHRASE_MIN_DURATION_S,
  WORDS_PER_PHRASE,
};

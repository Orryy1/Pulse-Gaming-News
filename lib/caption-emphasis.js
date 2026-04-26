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

// =================================================================
// Script-realignment for TTS digit expansions.
//
// ElevenLabs / VoxCPM expand digit sequences when speaking. When
// the script contains "Metro 2039", the spoken (and timestamp)
// form is "Metro twenty 39" or "Metro twenty thirty-nine". The
// caption stream is built from the spoken form, so the viewer
// sees "Metro twenty 39" — clearly wrong.
//
// realignTimestampsToScript walks the script tokens and the spoken
// timestamp tokens together; whenever a digit-bearing script token
// matches a spoken multi-token expansion, it merges those spoken
// tokens into one with the script's original digit form, summing
// their timing.
//
// Handles:
//   - 4-digit years 1900-2099  ("twenty thirty-nine"  → "2039")
//                               ("twenty 39"          → "2039")
//                               ("nineteen ninety-five" → "1995")
//   - 1-2 digit numbers ≤19    ("six"                → "6")
//   - GTA-6 style spaced ("GTA six" → "GTA 6") only when both
//     tokens land adjacent
//
// When no realignment applies, returns the input unchanged.
// =================================================================

const DIGIT_WORD = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS_WORD = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function normWord(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\w]/g, "");
}

/**
 * Try to consume a 4-digit year like "twenty 39" / "twenty thirty
 * nine" / "nineteen ninety five" starting at `tsIdx` in `tokens`.
 * Returns { matched: bool, lastIdx, year } if matched, else null.
 *
 * `expectYear` is the script's literal 4-digit number (e.g. 2039).
 */
function tryMatchYearExpansion(tokens, tsIdx, expectYear) {
  if (tsIdx >= tokens.length) return null;
  const decade = Math.floor(expectYear / 100);
  const last2 = expectYear % 100;
  const decadeWord =
    decade === 19 ? "nineteen" : decade === 20 ? "twenty" : null;
  if (!decadeWord) return null;

  const t0 = normWord(tokens[tsIdx].word);
  if (t0 !== decadeWord) return null;

  if (tsIdx + 1 >= tokens.length) return null;
  const t1 = normWord(tokens[tsIdx + 1].word);

  // Pattern A: "twenty 39"   → tokens[1] = "39" (literal 2-digit number)
  if (t1 === String(last2) || t1 === String(last2).padStart(2, "0")) {
    return { lastIdx: tsIdx + 1 };
  }
  // Pattern B: "twenty thirty nine" → tokens[1]=tens, tokens[2]=digit
  // Pattern C: "twenty thirty-nine" → single token "thirty-nine" (rare)
  if (TENS_WORD[t1] !== undefined) {
    const tensVal = TENS_WORD[t1];
    if (tensVal + 0 === last2) {
      // exact tens (e.g. "twenty thirty" → 2030)
      return { lastIdx: tsIdx + 1 };
    }
    if (tsIdx + 2 < tokens.length) {
      const t2 = normWord(tokens[tsIdx + 2].word);
      if (DIGIT_WORD[t2] !== undefined && tensVal + DIGIT_WORD[t2] === last2) {
        return { lastIdx: tsIdx + 2 };
      }
    }
  }
  if (DIGIT_WORD[t1] !== undefined && DIGIT_WORD[t1] === last2 && last2 < 20) {
    return { lastIdx: tsIdx + 1 };
  }
  return null;
}

/**
 * Try to consume a single spoken digit-word matching a 1-digit
 * script token. e.g. script "6" + spoken "six" → match.
 */
function tryMatchSingleDigit(tokens, tsIdx, expectNum) {
  if (tsIdx >= tokens.length) return null;
  const t0 = normWord(tokens[tsIdx].word);
  if (DIGIT_WORD[t0] === expectNum) return { lastIdx: tsIdx };
  return null;
}

/**
 * Walk the script tokens and the spoken timestamp tokens together.
 * Whenever a digit-bearing script token matches a spoken
 * multi-token expansion, merge those spoken tokens into one with
 * the script's original digit form.
 *
 * Returns a NEW array of word objects with realigned text. Tokens
 * that don't match any pattern pass through unchanged.
 *
 * @param {string} scriptText  original script (with digits as digits)
 * @param {Array<{word, start, end}>} timestamps  spoken-form word stream
 * @returns {Array<{word, start, end}>}
 */
function realignTimestampsToScript(scriptText, timestamps) {
  if (!Array.isArray(timestamps) || timestamps.length === 0)
    return timestamps || [];
  if (!scriptText || typeof scriptText !== "string") return timestamps;

  const scriptTokens = scriptText.match(/\S+/g) || [];
  if (scriptTokens.length === 0) return timestamps;

  const out = [];
  let ti = 0;
  for (const scriptToken of scriptTokens) {
    if (ti >= timestamps.length) break;
    const cleanScript = scriptToken.replace(/[^\w]/g, "");
    const lcScript = cleanScript.toLowerCase();

    const t = timestamps[ti];
    const tWord = normWord(t.word);

    // 1) Direct lowercase match — keep the SCRIPT's casing/punctuation.
    if (tWord === lcScript) {
      out.push({ ...t, word: scriptToken });
      ti++;
      continue;
    }

    // 2) 4-digit year expansion? Includes a 1-token backward-lookback:
    //    when an earlier mismatch ("in" vs "twenty") has already
    //    consumed the year-anchor token into out[], rewind one
    //    step before trying the match — otherwise "in 2019" lands
    //    as out=[..., 'twenty'] then scriptToken='2019' starts at
    //    ts='19' which fails the decade-word probe.
    if (/^\d{4}$/.test(cleanScript)) {
      const year = parseInt(cleanScript, 10);
      let m = tryMatchYearExpansion(timestamps, ti, year);
      let probeIdx = ti;
      if (!m && out.length > 0) {
        const lastEmitted = normWord(out[out.length - 1].word);
        if (lastEmitted === "twenty" || lastEmitted === "nineteen") {
          // Rewind: drop the orphan decade word from out, retry
          // year match at probeIdx-1.
          probeIdx = ti - 1;
          m = tryMatchYearExpansion(timestamps, probeIdx, year);
          if (m) {
            out.pop();
          }
        }
      }
      if (m) {
        out.push({
          word: scriptToken,
          start: timestamps[probeIdx].start,
          end: timestamps[m.lastIdx].end,
        });
        ti = m.lastIdx + 1;
        continue;
      }
    }

    // 3) 1-2 digit number expansion ("6" → "six")?
    if (/^\d{1,2}$/.test(cleanScript)) {
      const n = parseInt(cleanScript, 10);
      const m = tryMatchSingleDigit(timestamps, ti, n);
      if (m) {
        out.push({
          word: scriptToken,
          start: timestamps[ti].start,
          end: timestamps[m.lastIdx].end,
        });
        ti = m.lastIdx + 1;
        continue;
      }
    }

    // 4) No match — emit timestamp token as-is and advance one.
    //    The script and spoken streams may still resync at the
    //    next regular word.
    out.push(t);
    ti++;
  }
  // Append any remaining spoken tokens (script ran out before
  // timestamps did).
  while (ti < timestamps.length) {
    out.push(timestamps[ti]);
    ti++;
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
    // The TTS char stream sometimes loses the space between
    // sentence-end + next-sentence-start (so a single token comes
    // out as "life.But"). Normalise: insert a space after sentence
    // punctuation if a capital follows immediately.
    const normalised = w.word.replace(/([.!?])([A-Z])/g, "$1 $2");
    parts.push(normalised);
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
function buildAss({ story, words, duration, scriptText }) {
  const storyTokens = extractStoryEmphasisTokens(story || {});
  // Realign spoken-form digit expansions back to the script form
  // (e.g. "twenty 39" → "2039"). Only applies when the original
  // script text is provided AND contains digit-bearing tokens
  // that the TTS likely expanded.
  const realigned = realignTimestampsToScript(
    scriptText || story?.full_script || story?.body || story?.hook || "",
    words || [],
  );
  const phrases = groupIntoPhrases(realigned);

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
  realignTimestampsToScript,
  PHRASE_MAX_DURATION_S,
  PHRASE_MIN_DURATION_S,
  WORDS_PER_PHRASE,
};

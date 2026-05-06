/**
 * lib/studio/v2/subtitle-layer-v2.js — kinetic word-pop subtitles.
 *
 * Where v1 emits Dialogue lines per phrase (2–3 words at a time)
 * with a single emphasis style, v2 emits one Dialogue per WORD,
 * each with a fast pop-in animation. The result on screen reads
 * as words appearing one-by-one, scaling up briefly as they land
 * — the TikTok-creator-studio look.
 *
 * Key implementation choices:
 *
 *   - Use ASS karaoke-style \t() transforms for the scale pop:
 *       \fscx80\fscy80  → \fscx100\fscy100  over 80ms
 *       \fscx100        → \fscx115\fscy115  over 80ms
 *       \fscx115        → \fscx100\fscy100  over 100ms
 *     Net effect: word appears at 80%, scales to 115% mid-pop,
 *     settles at 100%. Reads as a deliberate landing.
 *
 *   - Per-word colour switching for emphasis tokens (proper nouns,
 *     years, money, percentages). Default white → emphasis amber.
 *
 *   - Words stay on screen for the full speaking duration of the
 *     phrase they belong to (so two adjacent words don't both
 *     vanish abruptly). Each Dialogue's End time is the END of
 *     the phrase, not the end of that word.
 *
 *   - Phrases are still grouped (2–3 words each) but visually
 *     they appear sequentially within the phrase window.
 *
 *   - PRESERVES the realignment + safety-reset logic from v1:
 *     digit-bearing script tokens get matched to spoken
 *     expansions, and we abort to raw timestamps after 8
 *     consecutive misses.
 *
 *   - Caption position: 75% down the frame (y=1440 of 1920) to
 *     stay above the lower-third brand block but below the
 *     centre area used by cards.
 */

"use strict";

const PHRASE_MAX_DURATION_S = 2.6;
const PHRASE_MIN_DURATION_S = 0.5;
const WORDS_PER_PHRASE = 3;
const PHRASE_MAX_CHARS = 16;
const MAX_WORD_GAP_S = 2.2;

const EMPHASIS_PATTERNS = [
  /^\$[\d.,]+[bm]?$/i,
  /^[\d.,]+%$/,
  /^\d{4}$/,
  /^\d+(\.\d+)?$/,
  /^[A-Z]{2,}$/,
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

// Default emphasis colour: Pulse Gaming amber (#FF6B1A → BGR
// &H001A6BFF). Channel themes override this via buildAssHeader().
const DEFAULT_EMPHASIS_BGR = "&H001A6BFF";

/**
 * Convert "#RRGGBB" hex to ASS-format BGR (&HxxBBGGRR with alpha 00).
 * ASS PrimaryColour is little-endian: alpha + blue + green + red.
 */
function hexToAssBgr(hex) {
  const clean = String(hex || "").replace(/^#/, "");
  if (clean.length !== 6) return DEFAULT_EMPHASIS_BGR;
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

function buildAssHeader(emphasisHex) {
  const bgr = emphasisHex ? hexToAssBgr(emphasisHex) : DEFAULT_EMPHASIS_BGR;
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Pop,Impact,96,&H00FFFFFF,&H00FFFFFF,&H00000000,&HC8000000,-1,0,0,0,100,100,2,0,1,6,4,2,40,40,250,1
Style: PopEmphasis,Impact,108,${bgr},${bgr},&H00000000,&HC8000000,-1,0,0,0,100,100,2,0,1,6,4,2,40,40,250,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
}

const ASS_HEADER = buildAssHeader();

function fmtAss(seconds) {
  const centis = Math.max(0, Math.round(Number(seconds || 0) * 100));
  const h = Math.floor(centis / 360000);
  const remH = centis % 360000;
  const m = Math.floor(remH / 6000);
  const remM = remH % 6000;
  const wholeS = Math.floor(remM / 100);
  const cs = remM % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(wholeS).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function normWord(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\w]/g, "");
}

// ---- Realignment (carried over from v1, with safety reset) ----

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

function tryMatchYearExpansion(tokens, ti, expectYear) {
  if (ti >= tokens.length) return null;
  const decade = Math.floor(expectYear / 100);
  const last2 = expectYear % 100;
  const decadeWord =
    decade === 19 ? "nineteen" : decade === 20 ? "twenty" : null;
  if (!decadeWord) return null;
  const t0 = normWord(tokens[ti].word);
  if (t0 !== decadeWord) return null;
  if (ti + 1 >= tokens.length) return null;
  const t1 = normWord(tokens[ti + 1].word);
  if (t1 === String(last2) || t1 === String(last2).padStart(2, "0")) {
    return { lastIdx: ti + 1 };
  }
  if (TENS_WORD[t1] !== undefined) {
    const tensVal = TENS_WORD[t1];
    if (tensVal === last2) return { lastIdx: ti + 1 };
    if (ti + 2 < tokens.length) {
      const t2 = normWord(tokens[ti + 2].word);
      if (DIGIT_WORD[t2] !== undefined && tensVal + DIGIT_WORD[t2] === last2) {
        return { lastIdx: ti + 2 };
      }
    }
  }
  if (DIGIT_WORD[t1] !== undefined && DIGIT_WORD[t1] === last2 && last2 < 20) {
    return { lastIdx: ti + 1 };
  }
  return null;
}

function realignTimestampsToScript(scriptText, timestamps) {
  if (!Array.isArray(timestamps) || timestamps.length === 0)
    return timestamps || [];
  if (!scriptText || typeof scriptText !== "string") return timestamps;
  const scriptTokens = scriptText.match(/\S+/g) || [];
  if (scriptTokens.length === 0) return timestamps;

  const out = [];
  let ti = 0;
  let consecutiveMisses = 0;
  const MISS_THRESHOLD = 8;
  let aborted = false;

  for (const scriptToken of scriptTokens) {
    if (ti >= timestamps.length) break;
    if (aborted) break;
    const cleanScript = scriptToken.replace(/[^\w]/g, "");
    const lcScript = cleanScript.toLowerCase();
    const t = timestamps[ti];
    const tWord = normWord(t.word);

    if (tWord === lcScript) {
      out.push({ ...t, word: scriptToken });
      ti++;
      consecutiveMisses = 0;
      continue;
    }

    if (/^\d{4}$/.test(cleanScript)) {
      const year = parseInt(cleanScript, 10);
      let m = tryMatchYearExpansion(timestamps, ti, year);
      let probeIdx = ti;
      if (!m && out.length > 0) {
        const lastEmitted = normWord(out[out.length - 1].word);
        if (lastEmitted === "twenty" || lastEmitted === "nineteen") {
          probeIdx = ti - 1;
          m = tryMatchYearExpansion(timestamps, probeIdx, year);
          if (m) out.pop();
        }
      }
      if (m) {
        out.push({
          word: scriptToken,
          start: timestamps[probeIdx].start,
          end: timestamps[m.lastIdx].end,
        });
        ti = m.lastIdx + 1;
        consecutiveMisses = 0;
        continue;
      }
    }

    out.push(t);
    ti++;
    consecutiveMisses++;
    if (consecutiveMisses >= MISS_THRESHOLD) aborted = true;
  }

  while (ti < timestamps.length) {
    out.push(timestamps[ti]);
    ti++;
  }
  return out;
}

// ---- Phrase grouping ----

function groupIntoPhrases(words, opts = {}) {
  const wordsPerPhrase = Math.max(1, Number(opts.maxWordsPerPhrase) || WORDS_PER_PHRASE);
  const phraseMaxChars = Math.max(8, Number(opts.maxPhraseChars) || PHRASE_MAX_CHARS);
  const out = [];
  let buffer = [];
  let phraseStart = null;
  let previousEnd = null;
  const flush = () => {
    if (!buffer.length) return;
    out.push({
      words: buffer,
      start: phraseStart,
      end: buffer[buffer.length - 1].end,
    });
    buffer = [];
    phraseStart = null;
  };
  for (const w of words) {
    if (!w || typeof w.word !== "string") continue;
    if (
      buffer.length > 0 &&
      previousEnd !== null &&
      Number.isFinite(w.start) &&
      w.start - previousEnd > MAX_WORD_GAP_S
    ) {
      flush();
    }
    const nextText = [...buffer.map((item) => item.word), w.word].join(" ");
    if (buffer.length > 0 && nextText.length > phraseMaxChars) {
      flush();
    }
    if (phraseStart === null) phraseStart = w.start;
    buffer.push(w);
    const endsSentence = /[.!?]$/.test(w.word);
    previousEnd = w.end;
    if (buffer.length >= wordsPerPhrase || endsSentence) {
      flush();
    }
  }
  flush();
  if (!opts.avoidDanglingWords) return out;
  const danglingMergeMaxWords = Math.max(
    wordsPerPhrase,
    Number(opts.danglingMergeMaxWords) || wordsPerPhrase,
  );
  return mergeDanglingPhrases(out, { wordsPerPhrase, phraseMaxChars, danglingMergeMaxWords });
}

function phraseText(phrase) {
  return (phrase?.words || []).map((word) => word.word).join(" ");
}

function phraseEndsSentence(phrase) {
  const last = phrase?.words?.[phrase.words.length - 1]?.word || "";
  return /[.!?]$/.test(last);
}

function canMergePhrases(left, right, opts) {
  if (!left || !right) return false;
  const words = [...(left.words || []), ...(right.words || [])];
  if (words.length > (opts.danglingMergeMaxWords || opts.wordsPerPhrase)) return false;
  if (words.map((word) => word.word).join(" ").length > opts.phraseMaxChars) return false;
  const gap = Number(right.start) - Number(left.end);
  return !Number.isFinite(gap) || gap <= MAX_WORD_GAP_S;
}

function mergePair(left, right) {
  return {
    words: [...(left.words || []), ...(right.words || [])],
    start: left.start,
    end: right.end,
  };
}

function mergeDanglingPhrases(phrases, opts) {
  const out = [];
  for (let i = 0; i < phrases.length; i++) {
    const current = phrases[i];
    const isDangling =
      current?.words?.length === 1 &&
      !phraseEndsSentence(current) &&
      phraseText(current).length <= 12;
    if (!isDangling) {
      out.push(current);
      continue;
    }

    const next = phrases[i + 1];
    if (canMergePhrases(current, next, opts)) {
      out.push(mergePair(current, next));
      i++;
      continue;
    }

    const previous = out[out.length - 1];
    if (canMergePhrases(previous, current, opts)) {
      out[out.length - 1] = mergePair(previous, current);
    } else {
      out.push(current);
    }
  }
  return out;
}

function wordsFromScriptText(scriptText, duration) {
  const tokens = String(scriptText || "")
    .replace(/\[(?:pause|beat|breath)\]/gi, " ")
    .match(/\S+/g) || [];
  if (tokens.length === 0) return [];
  const startPad = Math.min(0.2, Math.max(0, duration * 0.02));
  const endPad = Math.min(0.3, Math.max(0, duration * 0.03));
  const usable = Math.max(1, Number(duration || 0) - startPad - endPad);
  const step = usable / tokens.length;
  return tokens.map((word, index) => {
    const start = startPad + index * step;
    const end = Math.min(
      Number(duration || 0),
      start + Math.max(0.12, Math.min(0.42, step * 0.82)),
    );
    return { word, start, end };
  });
}

function hasCorruptTimings(words, duration) {
  if (!Array.isArray(words) || words.length < 4) return true;
  let previousStart = -Infinity;
  let previousEnd = null;
  let hugeGaps = 0;
  let invalid = 0;
  let clampedAtEnd = 0;
  const dur = Number(duration || 0);

  for (const word of words) {
    const start = Number(word?.start);
    const end = Number(word?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      invalid++;
      continue;
    }
    if (start + 0.001 < previousStart) invalid++;
    if (previousEnd !== null && start - previousEnd > MAX_WORD_GAP_S) hugeGaps++;
    if (dur > 0 && Math.abs(start - dur) < 0.02 && Math.abs(end - dur) < 0.02) {
      clampedAtEnd++;
    }
    previousStart = start;
    previousEnd = end;
  }

  const clampRatio = clampedAtEnd / words.length;
  return invalid > 0 || hugeGaps > 1 || clampRatio > 0.2;
}

function prepareSubtitleWords({ words, duration, scriptText }) {
  const cleanWords = (Array.isArray(words) ? words : [])
    .map((word) => ({
      word: String(word?.word || "").trim(),
      start: Number(word?.start),
      end: Number(word?.end),
    }))
    .filter(
      (word) =>
        word.word &&
        !/^\[(?:pause|beat|breath)\]$/i.test(word.word) &&
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.end >= word.start,
    );

  if (hasCorruptTimings(cleanWords, duration)) {
    const fallback = wordsFromScriptText(scriptText, duration);
    if (fallback.length > 0) return fallback;
  }
  return cleanWords;
}

function extractStoryEmphasisTokens(story) {
  const title = story?.title || "";
  const tokens = title
    .split(/\s+/)
    .map((w) => w.replace(/[.,;:!?"'()[\]]/g, ""))
    .filter(Boolean);
  const result = new Set();
  for (const t of tokens) {
    if (t.length < 1) continue;
    if (t.length < 2 && !/^\d$/.test(t)) continue;
    if (STOPWORDS.has(t.toLowerCase())) continue;
    if (/^[A-Z]/.test(t) || /^\d/.test(t)) result.add(t.toUpperCase());
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

// ---- Word-pop event emission ----

/**
 * Build the per-WORD Dialogue events. For each phrase:
 *   - Each word gets ONE Dialogue line.
 *   - Word i appears at word.start with the pop animation.
 *   - Word i's End time is min(phrase.end, word.end + 0.6).
 *   - Words within the same phrase visually stack: word 1 stays
 *     on screen as words 2, 3, 4 appear next to it.
 *
 * To stack words horizontally we use ASS \pos with manually
 * computed x offsets per word. ffmpeg's libass supports this.
 *
 * Simpler approach for v2: one phrase = one Dialogue line that
 * uses the karaoke-pop syntax. ASS supports \k (karaoke) and
 * inline \t() transforms per glyph run, so we can build a single
 * Dialogue containing all 4 words with staggered \t pops.
 *
 * Format per Dialogue text (one phrase, up to 3 words):
 *   {\an2\fs88\bord3\shad3\fscx100\fscy100}
 *   {\t(0,80,\fscx115\fscy115)}{\t(80,180,\fscx100\fscy100)}word1
 *   {\t(280,360,\fscx115\fscy115)}{\t(360,460,\fscx100\fscy100)}\h\hword2
 *   ... etc.
 *
 * The \t timings are RELATIVE to the Dialogue's start time, in ms.
 * So we offset each word's pop to (word.start - phrase.start) * 1000.
 */
function formatCaptionWord(word, options = {}) {
  const text = String(word || "");
  return options.captionCase === "upper" ? text.toLocaleUpperCase("en-GB") : text;
}

function buildWordPopDialogues(phrases, storyTokens, options = {}) {
  const events = [];
  const revealMode = options.revealMode || "word";
  const motionStyle = options.motionStyle || "default";

  for (const phrase of phrases) {
    let dStart = phrase.start;
    let dEnd = phrase.end;

    if (dEnd - dStart > PHRASE_MAX_DURATION_S) {
      dEnd = dStart + PHRASE_MAX_DURATION_S;
    }
    if (dEnd - dStart < PHRASE_MIN_DURATION_S) {
      dEnd = dStart + PHRASE_MIN_DURATION_S;
    }
    if (dStart >= dEnd) continue;

    // Default phrase style is Pop. Per-word emphasis switches
    // mid-string via the \r (reset to style) tag.
    const segments =
      motionStyle === "flash"
        ? [
            "{\\an2\\move(540,1484,540,1450,0,130)\\fad(35,70)\\bord8\\shad5\\t(0,130,\\fscx106\\fscy106)\\t(130,260,\\fscx100\\fscy100)}",
          ]
        : [];
    let lastEmphasis = false;
    for (let index = 0; index < phrase.words.length; index++) {
      const w = phrase.words[index];
      const captionWord = formatCaptionWord(w.word, options);
      const isEmph = isEmphasisWord(w.word, storyTokens);
      const offsetMs = Math.max(0, Math.round((w.start - dStart) * 1000));
      // Pop animation: 0.85 → 1.15 → 1.0 over 220ms total
      const popIn = `{\\fscx85\\fscy85\\t(${offsetMs},${offsetMs + 100},\\fscx115\\fscy115)\\t(${offsetMs + 100},${offsetMs + 220},\\fscx100\\fscy100)}`;

      // Style switch (Pop ↔ PopEmphasis)
      if (isEmph !== lastEmphasis) {
        segments.push(`{\\r${isEmph ? "PopEmphasis" : "Pop"}}`);
        lastEmphasis = isEmph;
      }
      // Default v2 captions reveal word-by-word. Flash Lane can keep
      // the full one/two-word punch visible from the first frame while
      // still popping the spoken word, which avoids awkward single-word
      // screenshots like "TAKE" hanging by itself.
      const alphaTag =
        revealMode === "phrase"
          ? ""
          : `{\\alpha&HFF&\\t(${Math.max(0, offsetMs - 1)},${offsetMs + 30},\\alpha&H00&)}`;

      const joiner = index < phrase.words.length - 1 ? "\\h" : "";
      segments.push(`${alphaTag}${popIn}${captionWord}${joiner}`);
    }

    const text = segments.join("").trimEnd();
    events.push(
      `Dialogue: 0,${fmtAss(dStart)},${fmtAss(dEnd)},Pop,,0,0,0,,${text}`,
    );
  }

  return events;
}

/**
 * Build the full ASS file string with kinetic word-pop styling.
 *
 * @param {object} args
 * @param {object} args.story
 * @param {Array<{word, start, end}>} args.words
 * @param {number} args.duration
 * @param {string} [args.scriptText]  optional realignment source
 * @param {boolean} [args.realign]    set false when cached audio does not
 *                                    match the editorial script
 * @returns {string} ass file content
 */
function buildKineticAss({
  story,
  words,
  duration,
  scriptText,
  emphasisHex,
  realign = true,
  maxWordsPerPhrase = WORDS_PER_PHRASE,
  maxPhraseChars = PHRASE_MAX_CHARS,
  captionCase = "original",
  revealMode = "word",
  motionStyle = "default",
  avoidDanglingWords = false,
}) {
  const storyTokens = extractStoryEmphasisTokens(story || {});
  const realigned =
    realign === false
      ? words || []
      : realignTimestampsToScript(
          scriptText ||
            story?.scriptForCaption ||
            story?.full_script ||
            story?.body ||
            story?.hook ||
            "",
          words || [],
        );
  const captionWords = prepareSubtitleWords({
    words: realigned,
    duration,
    scriptText:
      scriptText ||
      story?.scriptForCaption ||
      story?.full_script ||
      story?.body ||
      story?.hook ||
      "",
  });
  const phrases = groupIntoPhrases(captionWords, {
    maxWordsPerPhrase,
    maxPhraseChars,
    avoidDanglingWords,
  });
  const events = buildWordPopDialogues(phrases, storyTokens, {
    captionCase,
    revealMode,
    motionStyle,
  });
  // Cap any event past the duration cap
  const safeEvents = events.filter((line) => {
    const m = line.match(/Dialogue:\s*\d+,([^,]+),([^,]+),/);
    if (!m) return true;
    const parts = m[2].split(":").map(parseFloat);
    const end = parts[0] * 3600 + parts[1] * 60 + parts[2];
    return !duration || end <= duration + 0.5;
  });
  const header = emphasisHex ? buildAssHeader(emphasisHex) : ASS_HEADER;
  return `${header}\n${safeEvents.join("\n")}\n`;
}

function stripAssTags(text) {
  return String(text || "")
    .replace(/\{[^}]*\}/g, "")
    .trim();
}

function extractAssDialogueText(ass) {
  return String(ass || "")
    .split("\n")
    .filter((line) => line.startsWith("Dialogue:"))
    .map((line) => stripAssTags(line.split(",").slice(9).join(",") || ""))
    .filter(Boolean);
}

module.exports = {
  buildKineticAss,
  buildWordPopDialogues,
  formatCaptionWord,
  groupIntoPhrases,
  extractAssDialogueText,
  realignTimestampsToScript,
  isEmphasisWord,
  extractStoryEmphasisTokens,
  prepareSubtitleWords,
  wordsFromScriptText,
  PHRASE_MAX_DURATION_S,
  WORDS_PER_PHRASE,
};

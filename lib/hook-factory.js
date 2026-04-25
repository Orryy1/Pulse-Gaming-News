/**
 * lib/hook-factory.js — punchy 0–3s opener composition.
 *
 * The legacy pipeline had no dedicated hook overlay. The first 3
 * seconds were a silent visual loop with the narration audio
 * playing — fine for sleep content, fatal for vertical Shorts where
 * the algorithm decides retention by the 3-second mark.
 *
 * This module produces a SHORT, UPPERCASE headline that:
 *   - lands on screen at t=0 with a 0.20s fade-in
 *   - holds until t=2.6s
 *   - fades out by t=3.0s
 *   - has one accent word in the brand-orange highlight colour
 *
 * It does NOT replace the existing flair badge / source badge /
 * subtitle stream — those continue to render via the regular caption
 * + drawtext stack. The opener is an ADDITIVE overlay sitting above
 * the first segment.
 *
 * The headline is derived from the script with a deterministic
 * ruthless-editor pass:
 *   1. Try `story.hook` (the LLM's own crafted opener)
 *   2. Else fall back to the first sentence of `full_script`
 *   3. Strip filler ("So", "Today", "Hey", "Right", "Look")
 *   4. Cap at 7 words
 *   5. Uppercase
 *   6. Pick the word most likely to grab attention as the accent
 *      (proper nouns, money, percentages — see ACCENT_PATTERNS)
 */

"use strict";

const FILLER_PREFIXES = [
  /^so[,\s]+/i,
  /^today[,\s]+/i,
  /^hey[,\s]+/i,
  /^welcome[,\s]+/i,
  /^right[,\s]+/i,
  /^look[,\s]+/i,
  /^okay[,\s]+/i,
  /^alright[,\s]+/i,
];

// Regexes that mark a word as eye-catching. Order = priority.
const ACCENT_PATTERNS = [
  /^\$[\d.,]+[bm]?$/i, // money: $5, $1.2B, $400m
  /^[\d.,]+%$/, // 47%
  /^\d{4}$/, // years 2026
  /^[A-Z][A-Z0-9]+$/, // ALL-CAPS like GTA, NPC, EA
];

const MAX_WORDS = 7;
const MIN_WORDS = 3;

const HEADLINE_HOLD_END_S = 2.6;
const HEADLINE_FADE_OUT_END_S = 3.0;
const HEADLINE_FADE_IN_END_S = 0.2;

/**
 * Strip leading filler from a sentence.
 */
function stripFillers(s) {
  let out = (s || "").trim();
  for (const re of FILLER_PREFIXES) {
    out = out.replace(re, "");
  }
  return out.trim();
}

/**
 * Take a sentence-or-paragraph string and return up to MAX_WORDS
 * words from the start. Drops trailing punctuation on the last word.
 */
function tighten(text) {
  const stripped = stripFillers(text);
  // Take only up to the first sentence terminator.
  const firstSentence = stripped.split(/(?<=[.!?])\s/)[0] || stripped;
  const words = firstSentence
    .replace(/["""]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_WORDS);
  // Drop trailing punctuation on the last word so the headline
  // doesn't end in a stray comma / colon.
  if (words.length) {
    words[words.length - 1] = words[words.length - 1].replace(/[.,;:!?]+$/, "");
  }
  return words;
}

/**
 * Pick the index of the most eye-catching word. Returns -1 if no
 * word matches an accent pattern.
 */
function pickAccentIndex(words) {
  // First pass: exact accent patterns.
  for (let i = 0; i < words.length; i++) {
    for (const re of ACCENT_PATTERNS) {
      if (re.test(words[i])) return i;
    }
  }
  // Second pass: longest word that starts with a capital (likely a
  // proper noun even after our uppercase normalisation — we run
  // accent detection BEFORE uppercase).
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^[A-Z]/.test(w) && w.length > bestLen) {
      best = i;
      bestLen = w.length;
    }
  }
  return best;
}

/**
 * Compose the opener overlay spec.
 *
 * @param {object} story
 * @returns {{
 *   text: string,
 *   accentText: string|null,
 *   accentBefore: string,
 *   accentAfter: string,
 *   fadeInEnd: number,
 *   holdEnd: number,
 *   fadeOutEnd: number,
 * } | null}   null when the story has no usable text.
 */
function composeOpenerOverlay(story) {
  const source = story.hook || story.full_script || story.title || "";
  const words = tighten(source);
  if (words.length < MIN_WORDS) return null;

  const accentIdx = pickAccentIndex(words);
  const text = words.join(" ").toUpperCase();

  let accentText = null;
  let accentBefore = text;
  let accentAfter = "";
  if (accentIdx >= 0) {
    accentText = words[accentIdx].toUpperCase();
    accentBefore = words.slice(0, accentIdx).join(" ").toUpperCase();
    accentAfter = words
      .slice(accentIdx + 1)
      .join(" ")
      .toUpperCase();
  }

  return {
    text,
    accentText,
    accentBefore,
    accentAfter,
    fadeInEnd: HEADLINE_FADE_IN_END_S,
    holdEnd: HEADLINE_HOLD_END_S,
    fadeOutEnd: HEADLINE_FADE_OUT_END_S,
  };
}

/**
 * Render the opener as ffmpeg drawtext filter fragments.
 * Returns an array of drawtext expressions to chain (comma-joined)
 * onto an existing video label. Empty array if no opener applies.
 *
 * `fontOpt` is the platform-aware font directive (e.g. "font='DejaVu Sans'").
 * `accentColor` and `whiteColor` are 0xRRGGBB strings for ffmpeg.
 */
function buildOpenerDrawtext(opener, { fontOpt, accentColor }) {
  if (!opener) return [];
  const fade = `alpha='if(lt(t\\,${opener.fadeInEnd})\\,t/${opener.fadeInEnd}\\,if(gt(t\\,${opener.holdEnd})\\,1-(t-${opener.holdEnd})/(${opener.fadeOutEnd}-${opener.holdEnd})\\,1))'`;
  const enable = `enable='between(t\\,0\\,${opener.fadeOutEnd})'`;

  // Background bar — a translucent rounded box behind the headline
  // gives it weight and ensures legibility against busy images.
  const bg = `drawbox=x=0:y=h/2-100:w=iw:h=200:color=black@0.55:t=fill:enable='between(t\\,0\\,${opener.fadeOutEnd})'`;

  // Main text: ALL CAPS, big, centred.
  const main = `drawtext=text='${ffEscape(opener.text)}':${fontOpt}:fontcolor=white:fontsize=72:x=(w-tw)/2:y=h/2-36:box=0:${fade}:${enable}`;

  // Accent text repainted on top of the matching word (only if the
  // accent token exists and is different from the whole text).
  // Implementation: we draw the accent word in colour at the same
  // coords but only over its character range. ffmpeg drawtext can't
  // colour a sub-string, so we draw a SECOND drawtext layered on
  // top with the same alignment but only the accent. Position is
  // approximated via measured-width math through `w` reference.
  // For simplicity we skip the accent overlay and rely on the
  // animated background to keep the headline readable. The
  // accent colour is wired into the underline bar instead.
  const underline = opener.accentText
    ? `drawbox=x=(w-${Math.max(opener.accentText.length, 4) * 28})/2:y=h/2+44:w=${Math.max(opener.accentText.length, 4) * 28}:h=4:color=${accentColor}@0.95:t=fill:enable='between(t\\,${opener.fadeInEnd}\\,${opener.holdEnd})'`
    : null;

  return [bg, main, underline].filter(Boolean);
}

/**
 * Escape a string for ffmpeg drawtext text='...'. Mirror of
 * sanitizeDrawtext in assemble.js but local so this module has no
 * side imports.
 */
function ffEscape(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "’")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/=/g, "\\=")
    .replace(/%/g, "\\%");
}

module.exports = {
  composeOpenerOverlay,
  buildOpenerDrawtext,
  // exported for tests
  tighten,
  pickAccentIndex,
  stripFillers,
  HEADLINE_HOLD_END_S,
  HEADLINE_FADE_OUT_END_S,
};

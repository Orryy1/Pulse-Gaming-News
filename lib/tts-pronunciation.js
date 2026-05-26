"use strict";

/**
 * lib/tts-pronunciation.js — gaming-specific TTS pronunciation fixes.
 *
 * Reported via the 2026-04-30 Discord output: the narrator pronounced
 * "AAA" as the letters "A. A. A." rather than the industry-standard
 * "Triple A". This module is the single normalisation surface for
 * gaming-vocab pronunciation issues that ElevenLabs gets wrong.
 *
 * Each rule is a `{ name, pattern, replacement }` triple. Patterns are
 * word-boundary anchored so we don't accidentally rewrite "AAA Battery"
 * mid-word — though gaming context almost never says "AAA battery".
 *
 * IMPORTANT: this module runs BEFORE other text transforms in
 * audio.js cleanForTTS. The order matters because:
 *   - we want "AAA" to become "Triple A" before any case-flattening
 *   - we want "GTA" to stay as the existing audio.js "G T A" rule
 *     because that rule has the special "GTA VI" / "GTA 6" → "G T A
 *     six" handling that this module shouldn't touch
 *
 * Rules deliberately conservative — better to miss than misfire. Any
 * rule added here has to clear three bars:
 *   1. The native (letter-by-letter) pronunciation is wrong AND
 *      consistently jarring to a gaming-audience listener.
 *   2. The replacement is unambiguous in every gaming context we
 *      care about.
 *   3. The pattern can't accidentally match a different word.
 */

// "AAA" → "Triple A". Gaming-industry universal. Case-insensitive but
// only on full-word matches — avoid catching "AAAA" / "AAAAH" etc.
const AAA_RE = /\b(?:AAA|Triple-A|Triple\s+A)\b/gi;

// "indie" + "AAA" comparisons sometimes write "indie/AAA" with a slash.
const SLASH_AAA_RE = /([\/])(AAA)\b/gi;

const RULES = [
  {
    name: "triple_a",
    apply(text) {
      return text
        .replace(AAA_RE, "Triple A")
        .replace(SLASH_AAA_RE, (_, sep) => `${sep} Triple A`);
    },
    description: "AAA → Triple A (gaming industry standard pronunciation)",
  },

  // Common gaming abbreviations TTS tends to mangle. All conservative
  // — letter-spell when the natural reading is wrong AND there's no
  // ambiguity.
  {
    name: "esports",
    apply(text) {
      // "eSports" / "e-sports" / "esports" — TTS sometimes reads as
      // "ee-sports" with a long e. Normalise to "esports" (already
      // pronounced fine) but kill the hyphenation that triggers a
      // mid-word pause.
      return text.replace(/\be[-\s]?sports\b/gi, "esports");
    },
    description: "e-sports / eSports → esports (no mid-word pause)",
  },

  // Roman numeral III in game titles like "Diablo III" — TTS often
  // reads as "I-I-I" which is unintelligible. Game-context-bounded so
  // we don't hit "Henry VIII" or other non-gaming numerals.
  {
    name: "diablo_iii",
    apply(text) {
      return text
        .replace(/\bDiablo III\b/g, "Diablo three")
        .replace(/\bDiablo IV\b/g, "Diablo four")
        .replace(/\bDiablo II\b/g, "Diablo two")
        .replace(/\bHades (II|2)\b/g, "Hades number two")
        .replace(/\bSilent Hill (II|2)\b/g, "Silent Hill two")
        .replace(/\bResident Evil III\b/g, "Resident Evil three")
        .replace(/\bResident Evil II\b/g, "Resident Evil two")
        .replace(/\bResident Evil IV\b/g, "Resident Evil four");
    },
    description: "Roman numerals in canonical sequel titles → spoken numbers",
  },

  // "MMORPG" — many readers handle this OK letter-by-letter but the
  // mouthful kills hook pacing. "M M O R P G" is 6 syllables.
  // Soften to "online RPG".
  {
    name: "mmorpg",
    apply(text) {
      return text.replace(/\bMMORPGs?\b/g, (m) =>
        m.endsWith("s") ? "online RPGs" : "online RPG",
      );
    },
    description: "MMORPG → online RPG (single-word, fewer syllables)",
  },
];

/**
 * Apply every gaming pronunciation rule in order. Pure / synchronous.
 * Returns the rewritten string.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {Set<string>} [opts.disabled] — rule names to skip
 * @returns {string}
 */
function applyGamingPronunciation(text, opts = {}) {
  if (typeof text !== "string") return "";
  if (text.length === 0) return "";
  const disabled = opts.disabled instanceof Set ? opts.disabled : new Set();
  let out = text;
  for (const rule of RULES) {
    if (disabled.has(rule.name)) continue;
    out = rule.apply(out);
  }
  return out;
}

module.exports = {
  applyGamingPronunciation,
  RULES,
  AAA_RE,
};

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
 *   - GTA title handling stays centralised here so roman-numeral game
 *     titles stay stable across TTS, captions and stale-artifact gates
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
const TTS_PRONUNCIATION_PROFILE_VERSION = "gta-clean-six-title-v5";

const TITLE_CONNECTOR_RE = /^(?:a|an|and|of|on|or|the|to|vs|versus|with)$/i;
const TITLE_ROMAN_RE = /^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$/;
const TITLE_COLON_RE =
  /\b([A-Z][A-Za-z0-9'&-]*(?:\s+(?:[A-Z][A-Za-z0-9'&-]*|\d+|I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|a|an|and|of|on|or|the|to|vs|versus|with)){0,5}):\s+([A-Z0-9][A-Za-z0-9'&-]*(?:\s+(?:[A-Z][A-Za-z0-9'&-]*|\d+|I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|a|an|and|of|on|or|the|to|vs|versus|with)){0,6})\b/g;
const GEARS_E_DAY_TITLE_RE = /\bGears\s+of\s+War\s*(?:[:.,;!?]\s*)?E[\s-]?Day\b/gi;
const GTA_TITLE_RE = /\bG\.?\s*T\.?\s*A\.?\s+(V\s*I|VI|6|six|V|5|five)\b/gi;
const GRAND_THEFT_AUTO_TITLE_RE =
  /\bGrand\s+Theft\s+Auto\s+(V\s*I|VI|6|six|V|5|five)\b/gi;
const GTA_SIX_STUTTER_RE =
  /\b(?:G\.?\s*T\.?\s*A\.?|Grand\s+Theft\s+Auto)\s+s(?:i|y|igh)?[-\s]*six\b/gi;

function gtaSpokenVersion(version) {
  const lower = String(version || "").toLowerCase().replace(/\s+/g, "");
  return lower === "vi" || lower === "6" || lower === "six" ? "Six" : "five";
}

function titleWords(value) {
  return String(value || "").split(/\s+/).filter(Boolean);
}

function strongTitleWordCount(value) {
  return titleWords(value).filter((word) => {
    const clean = word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (!clean || TITLE_CONNECTOR_RE.test(clean)) return false;
    return (
      /^\d+$/.test(clean) ||
      TITLE_ROMAN_RE.test(clean) ||
      /^[A-Z0-9]{2,}$/.test(clean) ||
      /^[A-Z][A-Za-z0-9'&-]*$/.test(clean)
    );
  }).length;
}

function normaliseTitleColonPauses(text) {
  return String(text || "").replace(TITLE_COLON_RE, (match, left, right) => {
    const leftWords = titleWords(left);
    const rightWords = titleWords(right);
    const strong = strongTitleWordCount(left) + strongTitleWordCount(right);
    const titleLike =
      strong >= 3 &&
      (leftWords.length > 1 ||
        rightWords.length > 1 ||
        /[A-Z]{2,}|\d/.test(`${left} ${right}`));
    return titleLike ? `${left} ${right}` : match;
  });
}

function requiresTitleColonPauseProfile(text) {
  const source = String(text || "");
  return source !== normaliseTitleColonPauses(source);
}

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
        .replace(/\bHades\s+(II|2)\b/g, "Hades two")
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
    name: "gta_title",
    apply(text) {
      return text
        .replace(GTA_SIX_STUTTER_RE, "Grand Theft Auto Six")
        .replace(GRAND_THEFT_AUTO_TITLE_RE, (_match, version) => {
          return `Grand Theft Auto ${gtaSpokenVersion(version)}`;
        })
        .replace(GTA_TITLE_RE, (_match, version) => {
          return `Grand Theft Auto ${gtaSpokenVersion(version)}`;
        });
    },
    description: "GTA V/VI title forms and six-stutters -> stable Grand Theft Auto five/Six local narration",
  },
  {
    name: "stranger_than_heaven_five_eras",
    apply(text) {
      return text
        .replace(/\b(?:STRANGER THAN HEAVEN|Stranger Than Heaven)\s+Five\s+Eras\b/g, "Stranger Than Heaven five era setup")
        .replace(/\b(?:STRANGER THAN HEAVEN|Stranger Than Heaven)'s\s+Five\s+Eras\b/g, "Stranger Than Heaven's five era")
        .replace(/\bFive\s+Eras\s+reveal\b/gi, "five era reveal")
        .replace(/\bFive\s+eras\s+is\b/gi, "Five time periods are")
        .replace(/\bfive\s+eras\s+change\b/gi, "five time periods change");
    },
    description: "Stranger Than Heaven Five Eras -> five era/time periods to avoid Eris/heiress ASR drift",
  },
  {
    name: "beastro_title",
    apply(text) {
      return text.replace(/\bBeastro\b/g, "Beastrow");
    },
    description: "Beastro -> Beastrow for local TTS/Whisper alignment while captions preserve official title",
  },
  {
    name: "gears_of_war_e_day",
    apply(text) {
      return text.replace(GEARS_E_DAY_TITLE_RE, "Gears of War E-Day");
    },
    description: "Gears of War E-Day title variants -> one connected title phrase",
  },
  {
    name: "title_colon_pause",
    apply(text) {
      return normaliseTitleColonPauses(text);
    },
    description: "Canonical game title colons -> spaces so TTS does not insert a title pause",
  },
  {
    name: "mmorpg",
    apply(text) {
      return text.replace(/\bMMORPGs?\b/g, (m) =>
        m.endsWith("s") ? "online RPGs" : "online RPG",
      );
    },
    description: "MMORPG → online RPG (single-word, fewer syllables)",
  },
  {
    name: "playstation_hardware",
    apply(text) {
      return text
        .replace(/\bPS5\b/g, "PlayStation five")
        .replace(/\bPS4\b/g, "PlayStation four");
    },
    description: "PS5 / PS4 -> PlayStation five / four for clearer local narration",
  },
  {
    name: "source_brand_names",
    apply(text) {
      return text
        .replace(/\bSTRANGER THAN HEAVEN\b/g, "Stranger Than Heaven")
        .replace(/\bRespawn\s*first\b/gi, "Respawn First")
        .replace(/\bGame\s*Spot\b/gi, "Game Spot")
        .replace(/\bGame\s*Stop\b/gi, "Game Stop");
    },
    description: "Merged source/storefront brand names -> clear spoken words",
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
  GEARS_E_DAY_TITLE_RE,
  normaliseTitleColonPauses,
  requiresTitleColonPauseProfile,
  TTS_PRONUNCIATION_PROFILE_VERSION,
};

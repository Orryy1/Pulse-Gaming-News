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
const TTS_PRONUNCIATION_PROFILE_VERSION = "canonical-title-continuity-v21";

const TITLE_CONNECTOR_RE = /^(?:a|an|and|for|of|on|or|the|to|vs|versus|with|&)$/i;
const TITLE_LABEL_LEFT_RE =
  /^(?:action|blocker|blockers|category|claim|coverage|date|description|evidence|external|issue|label|next|outcome|platform|reason|safe|source|status|summary|title|type|verdict)$/i;
const TITLE_ROMAN_RE = /^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$/;
const TITLE_WORD_SOURCE = String.raw`(?:[\p{L}\p{N}][\p{L}\p{M}\p{N}'&-]*|I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)`;
const TITLE_CONNECTOR_SOURCE = String.raw`(?:a|an|and|for|of|on|or|the|to|vs|versus|with|&)`;
const TITLE_TOKEN_SOURCE = String.raw`(?:${TITLE_WORD_SOURCE}|${TITLE_CONNECTOR_SOURCE})`;
const TITLE_PHRASE_SOURCE = String.raw`${TITLE_TOKEN_SOURCE}(?:\s+${TITLE_TOKEN_SOURCE}){0,6}`;
const TITLE_PAUSE_PUNCT_RE = new RegExp(
  String.raw`(^|[^\p{L}\p{N}])(${TITLE_PHRASE_SOURCE})\s*(:|;|,|\/|\uFF1A|\uFE55|[-\u2013\u2014]|[.?!])(\s*)(${TITLE_PHRASE_SOURCE})(?=$|[^\p{L}\p{N}])`,
  "gu",
);
const GEARS_E_DAY_TITLE_RE = /\bGears\s+of\s+War\s*(?:[:.,;!?]\s*)?E[\s-]?Day\b/gi;
const STALKER_TITLE_RE =
  /\bS\.?\s*T\.?\s*A\.?\s*L\.?\s*K\.?\s*E\.?\s*R\.?\s*(?:2|II)\s*(?:[:;,.!?-]\s*)?(?:Heart\s+of\s+Chornobyl)?\b/gi;
const GTA_TITLE_RE = /\b(?:(the)\s+)?G\.?\s*T\.?\s*A\.?\s+(V\s*I|VI|6|six|V|5|five)\b/gi;
const GTA_COMPACT_VI_TITLE_RE = /\b(?:(the)\s+)?GTA[-\s]*V\.?\s*I\.?(['â€™]s)?(?=\W|$)/gi;
const GRAND_THEFT_AUTO_TITLE_RE =
  /\b(?:(the)\s+)?Grand\s+Theft\s+Auto\s+(V\.?\s*I\.?|VI|6|six|V|5|five)(['’]s)?(?=\W|$)/gi;
const GTA_TITLE_WITH_POSSESSIVE_RE =
  /\b(?:(the)\s+)?G\.?\s*T\.?\s*A\.?\s+(V\.?\s*I\.?|VI|6|six|V|5|five)(['’]s)?(?=\W|$)/gi;
const GTA_SIX_STUTTER_RE =
  /\b(?:(the)\s+)?(?:G\.?\s*T\.?\s*A\.?|Grand\s+Theft\s+Auto)\s+(?:(?:s\s*i|s(?:i|y|igh)?|see(?:[-\s,./:;!?…]+see)?|sea|c|size|sice|sic|sick|sig|sixty)[-\s,./:;!?…]*(?:six|6)|(?:see|sea|c|s|si|suh|sir|size|sice|sic|sick|sig)[-\s,./:;!?…]+a[-\s,./:;!?…]+(?:six|6)|(?:suh|sir|size|sice|sic|sick|sig)[-\s,./:;!?…]+(?:six|6)|six[-\s,./:;!?…]+(?:six|6)|siix)\b/gi;
const GTA_STANDALONE_RE = /\bG\.?\s*T\.?\s*A\.?\b/gi;
const DUPLICATE_ROCKSTAR_GTA_SAFE_PHRASE_RE =
  /\bRockstar((?:(?![.!?]).){0,80}?)\s+Rockstar's\s+next\s+Grand\s+Theft\s+Auto\b/gi;

function gtaSpokenVersion(version, article, possessive = "") {
  const lower = String(version || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (lower === "vi" || lower === "6" || lower === "six") {
    const base = article ? `${article} next Grand Theft Auto` : "Rockstar's next Grand Theft Auto";
    return possessive ? `${base}'s` : base;
  }
  const suffix = possessive ? "'s" : "";
  return article ? `${article} Grand Theft Auto five${suffix}` : `Grand Theft Auto five${suffix}`;
}

function gtaAbbreviatedSpokenVersion(version, article, possessive = "") {
  const lower = String(version || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (lower === "vi" || lower === "6" || lower === "six") {
    return article ? `${article} next Grand Theft Auto` : "Rockstar's next Grand Theft Auto";
  }
  return gtaSpokenVersion(version, article, possessive);
}

function titleWords(value) {
  return String(value || "").split(/\s+/).filter(Boolean);
}

function strongTitleWordCount(value) {
  return titleWords(value).filter((word) => {
    const clean = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!clean || TITLE_CONNECTOR_RE.test(clean)) return false;
    return (
      /^\d+$/.test(clean) ||
      TITLE_ROMAN_RE.test(clean) ||
      /^[A-Z0-9]{2,}$/.test(clean) ||
      /^[\p{Lu}0-9][\p{L}\p{M}\p{N}'&-]*$/u.test(clean)
    );
  }).length;
}

function normaliseTitleColonPauses(text) {
  let out = String(text || "");
  for (let pass = 0; pass < 4; pass += 1) {
    const next = out.replace(TITLE_PAUSE_PUNCT_RE, (match, prefix, left, punct, separatorSpace, right) => {
      const colonLikeSeparator = /^(?::|\uFF1A|\uFE55)$/.test(punct);
      if (!separatorSpace && !colonLikeSeparator) return match;
      const leftWords = titleWords(left);
      const rightWords = titleWords(right);
      const leftClean = left.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (colonLikeSeparator && TITLE_LABEL_LEFT_RE.test(leftClean)) return match;
      const strong = strongTitleWordCount(left) + strongTitleWordCount(right);
      const joined = `${left} ${right}`.replace(/\s+/g, " ").trim();
      const sentencePunctuationNeedsKnownTitle = /^[,.?!]$/.test(punct);
      const knownJoinedTitle =
        /^(?:Halo Campaign Evolved|The Expanse Osiris Reborn|Doom The Dark Ages(?: Revelations)?|Marvel Tokon Fighting Souls|Gears of War E-Day)(?:\b|$)/i.test(joined);
      const titleLike =
        strong >= (colonLikeSeparator ? 2 : 3) &&
        (colonLikeSeparator ||
          leftWords.length > 1 ||
          rightWords.length > 1 ||
          /[\p{Lu}]{2,}|\d/u.test(`${left} ${right}`));
      if (!titleLike) return match;
      if (sentencePunctuationNeedsKnownTitle && !knownJoinedTitle) return match;
      return `${prefix || ""}${joined}`;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function continuousSpokenTitle(value) {
  return String(value || "")
    .replace(/\.(?=\p{L})/gu, "")
    .replace(/\s*[:;,/|\uFF1A\uFE55\u2013\u2014-]+\s*/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function protectedTitlePattern(value) {
  const title = String(value || "").trim();
  if (!title) return null;
  const source = escapeRegex(title)
    .replace(/\\\s\+/g, "\\s+")
    .replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${source})(?=$|[^\\p{L}\\p{N}])`, "giu");
}

function normaliseProtectedTitlePauses(text, protectedTitles = []) {
  let out = String(text || "");
  const titles = Array.from(
    new Set((Array.isArray(protectedTitles) ? protectedTitles : []).map((title) => String(title || "").trim()).filter(Boolean)),
  ).sort((a, b) => b.length - a.length);
  for (const title of titles) {
    const pattern = protectedTitlePattern(title);
    const spokenTitle = continuousSpokenTitle(title);
    if (!pattern || !spokenTitle) continue;
    out = out.replace(pattern, (_match, prefix) => `${prefix || ""}${spokenTitle}`);
  }
  return out;
}

function requiresTitleColonPauseProfile(text, protectedTitles = []) {
  const source = String(text || "");
  return (
    source !== normaliseProtectedTitlePauses(source, protectedTitles) ||
    source !== normaliseTitleColonPauses(source)
  );
}

function normaliseDuplicateRockstarGtaSafePhrase(text) {
  return String(text || "").replace(
    DUPLICATE_ROCKSTAR_GTA_SAFE_PHRASE_RE,
    (_match, middle) => `Rockstar${middle} the next Grand Theft Auto`,
  );
}

function normaliseAwkwardGtaNextPhrase(text) {
  return String(text || "")
    .replace(
      /\b([Tt]he)\s+next\s+Rockstar's\s+next\s+Grand\s+Theft\s+Auto\b/g,
      "$1 next Grand Theft Auto",
    )
    .replace(/\bnext\s+Rockstar's\s+next\s+Grand\s+Theft\s+Auto\b/g, "next Grand Theft Auto");
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
      return normaliseAwkwardGtaNextPhrase(text
        .replace(GTA_SIX_STUTTER_RE, (_match, article) => {
          return gtaSpokenVersion("six", article);
        })
        .replace(GTA_COMPACT_VI_TITLE_RE, (_match, article, possessive) => {
          return gtaAbbreviatedSpokenVersion("VI", article, possessive);
        })
        .replace(GRAND_THEFT_AUTO_TITLE_RE, (_match, article, version, possessive) => {
          return gtaSpokenVersion(version, article, possessive);
        })
        .replace(GTA_TITLE_WITH_POSSESSIVE_RE, (_match, article, version, possessive) => {
          return gtaAbbreviatedSpokenVersion(version, article, possessive);
        })
        .replace(GTA_STANDALONE_RE, "Grand Theft Auto")
        .replace(DUPLICATE_ROCKSTAR_GTA_SAFE_PHRASE_RE, (_match, middle) => {
          return `Rockstar${middle} the next Grand Theft Auto`;
        }));
    },
    description: "GTA V/VI title forms and six-stutters -> stable Grand Theft Auto five / safe next-title narration",
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
    name: "pliszka_name",
    apply(text) {
      return text.replace(/\bPliszka\b/g, "Pliska");
    },
    description: "Pliszka -> Pliska for stable local TTS/Whisper alignment while captions preserve the official name",
  },
  {
    name: "denshattack_title",
    apply(text) {
      return text.replace(/\bDenshattack\b!?/gi, "Densha Attack");
    },
    description: "Denshattack -> Densha Attack for stable TTS/Whisper alignment while captions preserve the official title",
  },
  {
    name: "gears_of_war_e_day",
    apply(text) {
      return text.replace(GEARS_E_DAY_TITLE_RE, "Gears of War E-Day");
    },
    description: "Gears of War E-Day title variants -> one connected title phrase",
  },
  {
    name: "stalker_2_title",
    apply(text) {
      return text.replace(STALKER_TITLE_RE, (match) => {
        return /Heart\s+of\s+Chornobyl/i.test(match)
          ? "Stalker 2 Heart of Chornobyl"
          : "Stalker 2";
      });
    },
    description: "S.T.A.L.K.E.R. 2 title variants -> one connected title phrase",
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
  let out = normaliseProtectedTitlePauses(text, opts.protectedTitles);
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
  normaliseProtectedTitlePauses,
  normaliseDuplicateRockstarGtaSafePhrase,
  requiresTitleColonPauseProfile,
  TTS_PRONUNCIATION_PROFILE_VERSION,
};

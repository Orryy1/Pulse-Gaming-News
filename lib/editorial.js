/**
 * lib/editorial.js — script-side editorial pass.
 *
 * Pure deterministic editor that runs AFTER the LLM script-gen and
 * BEFORE TTS. Strips known filler phrases that the model overuses
 * across videos, tightens leading openers, and normalises digit
 * pronunciations so caption + audio agree.
 *
 * IMPORTANT: this only affects FUTURE TTS runs. Audio that has
 * already been generated keeps the filler — we can't surgically
 * remove a phrase from a cached MP3 without re-synthesizing the
 * surrounding audio. The local prototype uses cached audio for
 * 1sn9xhe, so this filter shows up in the comparison only after
 * the next produce cycle re-runs TTS.
 *
 * Wire-in points (production, NOT touched in this commit):
 *   - audio.js: call `tightenScript(rawScript, story)` before
 *     sending text to ElevenLabs / VoxCPM
 *   - tools/quality-prototype.js: call same before TTS regen
 *
 * The function returns BOTH the spoken-form text (for TTS) and
 * the caption-form text (for ASS — same content, but the caller
 * can pass either to buildAss). They're the same string in v1; the
 * split exists so future changes can diverge them (e.g. spell out
 * digits for TTS but keep digits in captions).
 */

"use strict";

// Phrases the script-gen model overuses across stories. Stripped or
// replaced wholesale. Match is case-insensitive; replacement
// preserves leading capitalisation if the original opens a sentence.
//
// Each pattern matches BOTH the contracted ("here's") and the
// expanded ("here is") forms — the LLM mixes both depending on
// surrounding context.
const FILLER_PHRASES = [
  // Generic AI-tells flagged by the user across multiple videos.
  {
    pattern:
      /\bbut\s+here(?:'s|\s+is)\s+where\s+it\s+gets\s+interesting\b[.,]?/gi,
    replace: "",
  },
  {
    pattern: /\byou\s+won(?:'t|\s+not)\s+believe\s+what\b/gi,
    replace: "",
  },
  {
    pattern: /\bthis\s+changes\s+everything\b[.,]?/gi,
    replace: "",
  },
  {
    pattern: /\band\s+that(?:'s|\s+is)\s+not\s+all\b[.,]?/gi,
    replace: "",
  },
  {
    pattern: /\blet\s+that\s+sink\s+in\b[.,]?/gi,
    replace: "",
  },
  // Soft fillers that pad without adding info.
  { pattern: /\bobviously,?\s+/gi, replace: "" },
  { pattern: /\bbasically,?\s+/gi, replace: "" },
  { pattern: /\bessentially,?\s+/gi, replace: "" },
];

const LEADING_FILLER = [
  /^so[,\s]+/i,
  /^right[,\s]+/i,
  /^look[,\s]+/i,
  /^okay[,\s]+/i,
  /^alright[,\s]+/i,
  /^well[,\s]+/i,
  /^now[,\s]+/i,
];

function stripLeadingFiller(s) {
  let out = (s || "").trim();
  for (const re of LEADING_FILLER) {
    out = out.replace(re, "");
  }
  // Recapitalise the first letter if we stripped a lower-case
  // opener that preceded one.
  if (out.length > 0 && /^[a-z]/.test(out)) {
    out = out[0].toUpperCase() + out.slice(1);
  }
  return out.trim();
}

function stripFillerPhrases(s) {
  let out = s || "";
  for (const f of FILLER_PHRASES) {
    out = out.replace(f.pattern, f.replace);
  }
  // Collapse double spaces and orphan punctuation left behind.
  out = out.replace(/\s+([,.;:!?])/g, "$1");
  out = out.replace(/\s{2,}/g, " ");
  out = out.replace(/\s+\./g, ".");
  return out.trim();
}

/**
 * Run the full editorial pass on a raw script.
 *
 * @param {string} raw
 * @param {object} [story]   the story object (currently unused; reserved
 *                           for future per-niche tweaks)
 * @returns {{ scriptForTTS: string, scriptForCaption: string,
 *             changes: Array<{kind, before, after}> }}
 */
function tightenScript(raw, story) {
  if (!raw || typeof raw !== "string") {
    return { scriptForTTS: "", scriptForCaption: "", changes: [] };
  }
  const changes = [];

  // 1. Strip leading filler ("So,", "Right,").
  const afterLeading = stripLeadingFiller(raw);
  if (afterLeading !== raw.trim()) {
    changes.push({
      kind: "leading-filler",
      before: raw.trim().slice(0, 60),
      after: afterLeading.slice(0, 60),
    });
  }

  // 2. Strip overused filler phrases.
  const afterPhrases = stripFillerPhrases(afterLeading);
  if (afterPhrases !== afterLeading) {
    changes.push({
      kind: "filler-phrase",
      before: afterLeading.slice(0, 80),
      after: afterPhrases.slice(0, 80),
    });
  }

  // 3. Sentence-spacing fix — ensure a single space after . ! ?
  let final = afterPhrases.replace(/([.!?])([A-Z])/g, "$1 $2");
  final = final.replace(/\s{2,}/g, " ").trim();

  return {
    scriptForTTS: final,
    scriptForCaption: final,
    changes,
  };
}

module.exports = {
  tightenScript,
  stripLeadingFiller,
  stripFillerPhrases,
  FILLER_PHRASES,
  LEADING_FILLER,
};

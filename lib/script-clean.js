/**
 * lib/script-clean.js
 *
 * Shared script-normalisation helpers. Used by:
 *   - subtitles.js     (normalise full_script before ElevenLabs alignment)
 *   - audio.js         (imported by the runtime cleanForTTS when possible)
 *   - processor.js     (initial tts_script generation)
 *
 * The motivating incident (2026-04-19 Black Flag publish):
 *
 *   subtitles.js sent `story.full_script` directly to ElevenLabs. The
 *   LLM had emitted paragraph breaks as U+2028 / U+2029 (paragraph
 *   separator characters) which audio.js::cleanForTTS was stripping
 *   without replacement. ElevenLabs then produced a character stream
 *   where "rollout." and "Journalists" had no separator at all, and
 *   the word splitter in subtitles.js (which only breaks on " " / "\n")
 *   merged them into a single subtitle token "ROLLOUT.JOURNALISTS".
 *
 * `cleanScriptForAlignment` normalises paragraph separators to a real
 * space, inserts a space after any sentence-ending period directly
 * followed by a capital letter, collapses whitespace, and normalises
 * the "12:15 PM" / "12:15 AM" shape to "12:15PM" / "12:15AM" for display
 * compactness (requested by the channel owner).
 *
 * All transforms are display-safe — they don't change TTS pronunciation,
 * because the target characters (U+2028/U+2029) are already inaudible
 * and the PM/AM collapse doesn't change how ElevenLabs speaks the time.
 */

"use strict";

// Unicode paragraph / line separators that some LLMs emit instead of
// \n\n. These are invisible to readers but carry line-break semantics.
// We replace them with a real ASCII space so later \s+ collapses
// produce exactly one space between sentences, instead of zero.
const PARAGRAPH_SEPARATORS_RE = /[\u2028\u2029]/g;

// Zero-width / invisible unicode that should just vanish — these never
// carry useful semantics in a narration script.
const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202F\uFEFF]/g;

/**
 * Insert a space after a period when the LLM (or paragraph-separator
 * stripping) has produced "rollout.Journalists" style run-together.
 * Matches `.` directly followed by an uppercase letter, inserts a
 * space between them.
 */
function fixMissingSpaceAfterPeriod(text) {
  return text.replace(/\.([A-Z])/g, ". $1");
}

/**
 * Collapse "12:15 PM" → "12:15PM" (and the AM variant). Keeps the
 * am/pm merged for display compactness; ElevenLabs pronounces both
 * shapes the same way so TTS is unaffected.
 *
 * Preserves the user's original casing of the meridiem (PM vs pm).
 */
function normaliseMeridiemTime(text) {
  return text.replace(/\b(\d{1,2}:\d{2})\s+([AaPp][Mm])\b/g, "$1$2");
}

/**
 * Clean a script for ElevenLabs alignment / on-screen rendering.
 *
 * Order matters:
 *   1. Replace paragraph separators with a space so later collapse
 *      leaves exactly one space between the paragraphs.
 *   2. Drop remaining invisible unicode.
 *   3. Strip [PAUSE] / [VISUAL: ...] authoring markers.
 *   4. Insert space after run-together periods ("rollout.Journalists"
 *      → "rollout. Journalists") — defensive, covers cases where the
 *      LLM skipped the space entirely.
 *   5. Collapse any whitespace run to a single space.
 *   6. Merge meridiem "12:15 PM" → "12:15PM".
 *   7. Trim.
 */
function cleanScriptForAlignment(raw) {
  // Only accept strings. Anything else (null, undefined, number, array,
  // object) returns "" — callers shouldn't accidentally stringify a
  // structured payload into the alignment text.
  if (typeof raw !== "string" || raw.length === 0) return "";
  let out = raw
    .replace(PARAGRAPH_SEPARATORS_RE, " ")
    .replace(INVISIBLE_RE, "")
    .replace(/\[PAUSE\]/gi, ", ")
    .replace(/\[VISUAL:[^\]]*\]/gi, "");
  out = fixMissingSpaceAfterPeriod(out);
  out = out.replace(/\s+/g, " ");
  out = normaliseMeridiemTime(out);
  return out.trim();
}

module.exports = {
  cleanScriptForAlignment,
  fixMissingSpaceAfterPeriod,
  normaliseMeridiemTime,
  PARAGRAPH_SEPARATORS_RE,
};

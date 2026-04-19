/**
 * tests/services/script-clean.test.js
 *
 * Pins the subtitle + TTS text-normalisation helpers added 2026-04-19
 * after the Black Flag publish shipped with:
 *   - "ROLLOUT.JOURNALISTS" joined across a paragraph break (ElevenLabs
 *     alignment couldn't separate them because audio.js was stripping
 *     U+2028/U+2029 silently, and subtitles.js wasn't cleaning at all)
 *   - "12:15 PM" in subtitles where the channel owner wants "12:15PM"
 *
 * Covers:
 *   - paragraph separators (\n\n, U+2028, U+2029) collapse to a single
 *     space (so "rollout." and "Journalists" stay separable)
 *   - run-together "rollout.Journalists" gets a space inserted
 *   - meridiem "12:15 PM" collapses to "12:15PM" (case-preserving)
 *   - [PAUSE] / [VISUAL: ...] markers are stripped
 *   - invisible unicode (zero-width) is dropped without eating real
 *     punctuation
 *   - empty / null input returns empty string (no throw)
 *
 * Run: node --test tests/services/script-clean.test.js
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cleanScriptForAlignment,
  fixMissingSpaceAfterPeriod,
  normaliseMeridiemTime,
} = require("../../lib/script-clean");

// ---------- Paragraph separators ----------

test("\\n\\n between paragraphs collapses to a single space", () => {
  const out = cleanScriptForAlignment(
    "staggered rollout.\n\nJournalists who've already seen",
  );
  // The critical assertion: "rollout." and "Journalists" must be
  // separable by a space so the ElevenLabs character stream can split
  // them into two on-screen words.
  assert.match(out, /rollout\. Journalists/);
});

test("U+2028 LINE SEPARATOR collapses to a single space", () => {
  const out = cleanScriptForAlignment(
    "staggered rollout.\u2028Journalists who've already seen",
  );
  assert.match(out, /rollout\. Journalists/);
  assert.ok(!out.includes("\u2028"));
});

test("U+2029 PARAGRAPH SEPARATOR collapses to a single space", () => {
  const out = cleanScriptForAlignment(
    "staggered rollout.\u2029Journalists who've already seen",
  );
  assert.match(out, /rollout\. Journalists/);
  assert.ok(!out.includes("\u2029"));
});

test("the exact Black Flag paragraph from 1sojcmy emits a space, not a joined token", () => {
  // Copied verbatim from the shipped full_script (1sojcmy) where the
  // tts_script ended up as "rollout.Journalists" on disk.
  const input =
    "...a casual staggered rollout.\n\nJournalists who've already seen the game...";
  const out = cleanScriptForAlignment(input);
  assert.doesNotMatch(
    out,
    /rollout\.Journalists/,
    "words must not be glued across the paragraph break",
  );
  assert.match(out, /rollout\. Journalists/);
});

// ---------- Missing-space-after-period ----------

test("fixMissingSpaceAfterPeriod inserts a space before a capital", () => {
  assert.equal(fixMissingSpaceAfterPeriod("2026.The"), "2026. The");
  assert.equal(
    fixMissingSpaceAfterPeriod("rollout.Journalists"),
    "rollout. Journalists",
  );
});

test("fixMissingSpaceAfterPeriod leaves lowercase-after-period alone", () => {
  // "e.g. something" must not become "e. g. something".
  // The regex only matches capital letters after a period.
  assert.equal(fixMissingSpaceAfterPeriod("e.g. something"), "e.g. something");
});

// ---------- Meridiem time normalisation ----------

test("12:15 PM becomes 12:15PM (preserves original casing)", () => {
  assert.equal(
    normaliseMeridiemTime("embargo lifts 12:15 PM ET"),
    "embargo lifts 12:15PM ET",
  );
});

test("lowercase 12:15 pm becomes 12:15pm", () => {
  assert.equal(normaliseMeridiemTime("lifts 12:15 pm ET"), "lifts 12:15pm ET");
});

test("9:30 AM collapses too (AM variant)", () => {
  assert.equal(normaliseMeridiemTime("drops 9:30 AM GMT"), "drops 9:30AM GMT");
});

test("cleanScriptForAlignment applies meridiem normalisation end-to-end", () => {
  const out = cleanScriptForAlignment(
    "Embargo lifts 12:15 PM ET. That's oddly specific.",
  );
  assert.match(out, /12:15PM ET/);
});

// ---------- Markers + invisible unicode ----------

test("[PAUSE] markers become a comma-space", () => {
  const out = cleanScriptForAlignment(
    "first sentence. [PAUSE] Second sentence.",
  );
  // PAUSE becomes ", " and then collapse leaves "first sentence. , Second"
  // — which ElevenLabs reads as a brief beat. The critical assertion is
  // that the [PAUSE] token itself is gone.
  assert.doesNotMatch(out, /\[PAUSE\]/);
});

test("[VISUAL: ...] markers are stripped", () => {
  const out = cleanScriptForAlignment(
    "Opening line [VISUAL: cut to gameplay] continues.",
  );
  assert.doesNotMatch(out, /\[VISUAL/);
  assert.match(out, /Opening line\s+continues\./);
});

test("zero-width joiners are silently dropped without gluing words", () => {
  // Zero-width joiner (U+200D) between two words — should be removed,
  // but the surrounding space should remain so words stay split.
  const out = cleanScriptForAlignment("hello\u200D world");
  assert.equal(out, "hello world");
});

// ---------- Defensive input handling ----------

test("empty / null / undefined input returns empty string", () => {
  assert.equal(cleanScriptForAlignment(""), "");
  assert.equal(cleanScriptForAlignment(null), "");
  assert.equal(cleanScriptForAlignment(undefined), "");
});

test("non-string input returns empty string", () => {
  assert.equal(cleanScriptForAlignment(42), "");
});

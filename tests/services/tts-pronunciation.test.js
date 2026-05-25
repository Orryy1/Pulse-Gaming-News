"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  applyGamingPronunciation,
  RULES,
} = require("../../lib/tts-pronunciation");

// 2026-04-30 production report: narrator pronounced "AAA" as the
// letters "A. A. A." rather than industry-standard "Triple A".
// These tests pin every gaming-vocab pronunciation rule. Each rule
// must clear three bars: native pronunciation is wrong, replacement
// is unambiguous, pattern can't accidentally match a different word.

// ── triple_a rule ────────────────────────────────────────────────

test("AAA → Triple A: standalone word", () => {
  assert.equal(
    applyGamingPronunciation("AAA games cost more"),
    "Triple A games cost more",
  );
});

test("AAA → Triple A: case-insensitive", () => {
  assert.equal(
    applyGamingPronunciation("aaa game launches"),
    "Triple A game launches",
  );
});

test("AAA → Triple A: handles 'Triple-A' and 'triple A' forms", () => {
  assert.equal(applyGamingPronunciation("Triple-A title"), "Triple A title");
  assert.equal(
    applyGamingPronunciation("triple-A blockbuster"),
    "Triple A blockbuster",
  );
  assert.equal(applyGamingPronunciation("Triple A studio"), "Triple A studio");
});

test("AAA → Triple A: does NOT match AAAA / AAAAH / longer A-runs", () => {
  assert.equal(
    applyGamingPronunciation("AAAA battery sizes"),
    "AAAA battery sizes",
  );
  assert.equal(
    applyGamingPronunciation("AAAAH said the gamer"),
    "AAAAH said the gamer",
  );
});

test("AAA → Triple A: handles slash composition (indie/AAA)", () => {
  // Word boundary at "/" lets the primary rule fire — natural reading
  // for "indie/AAA" is "indie slash Triple A" so leaving the slash
  // adjacent ("indie/Triple A") keeps the typography readable in
  // captions while ElevenLabs still pronounces "Triple A".
  assert.equal(
    applyGamingPronunciation("indie/AAA comparison"),
    "indie/Triple A comparison",
  );
});

test("AAA → Triple A: leaves middle-of-word matches alone", () => {
  // Word boundary should prevent rewriting things like "PAAAH"
  assert.equal(applyGamingPronunciation("PAAAH"), "PAAAH");
});

// ── esports rule ─────────────────────────────────────────────────

test("e-sports → esports", () => {
  assert.equal(
    applyGamingPronunciation("e-sports league launches"),
    "esports league launches",
  );
});

test("eSports → esports (case mash)", () => {
  assert.equal(applyGamingPronunciation("eSports event"), "esports event");
});

test("esports stays as-is when already correct", () => {
  assert.equal(
    applyGamingPronunciation("esports tournament"),
    "esports tournament",
  );
});

// ── diablo / sequel-numerals rule ────────────────────────────────

test("Diablo III → Diablo three", () => {
  assert.equal(
    applyGamingPronunciation("Diablo III is back"),
    "Diablo three is back",
  );
});

test("Resident Evil III/II/IV → spoken numbers", () => {
  assert.equal(
    applyGamingPronunciation("Resident Evil II remake"),
    "Resident Evil two remake",
  );
  assert.equal(
    applyGamingPronunciation("Resident Evil IV remake"),
    "Resident Evil four remake",
  );
});

test("Silent Hill 2 / II → Silent Hill two", () => {
  assert.equal(
    applyGamingPronunciation("Silent Hill 2 launches"),
    "Silent Hill two launches",
  );
  assert.equal(
    applyGamingPronunciation("Silent Hill II launches"),
    "Silent Hill two launches",
  );
});

test("Hades II / 2 → Hades two", () => {
  assert.equal(
    applyGamingPronunciation("Hades II finally has a console date"),
    "Hades two finally has a console date",
  );
  assert.equal(
    applyGamingPronunciation("Hades 2 finally has a console date"),
    "Hades two finally has a console date",
  );
});

test("Roman numerals OUTSIDE canonical game titles are left alone", () => {
  assert.equal(
    applyGamingPronunciation("Henry VIII reigned 1509"),
    "Henry VIII reigned 1509",
  );
  assert.equal(
    applyGamingPronunciation("Star Wars II review"),
    "Star Wars II review",
  );
});

// ── MMORPG rule ─────────────────────────────────────────────────

test("MMORPG → online RPG", () => {
  assert.equal(
    applyGamingPronunciation("a new MMORPG launches"),
    "a new online RPG launches",
  );
});

test("MMORPGs → online RPGs (plural preserved)", () => {
  assert.equal(
    applyGamingPronunciation("two MMORPGs ship next month"),
    "two online RPGs ship next month",
  );
});

// ── compositional safety ────────────────────────────────────────

test("applyGamingPronunciation: empty string returns empty", () => {
  assert.equal(applyGamingPronunciation(""), "");
});

test("applyGamingPronunciation: null/undefined returns empty string", () => {
  assert.equal(applyGamingPronunciation(null), "");
  assert.equal(applyGamingPronunciation(undefined), "");
});

test("applyGamingPronunciation: non-string returns empty string", () => {
  assert.equal(applyGamingPronunciation(42), "");
  assert.equal(applyGamingPronunciation({}), "");
});

test("applyGamingPronunciation: clean script passes through unchanged", () => {
  const clean = "The next big game launches next week.";
  assert.equal(applyGamingPronunciation(clean), clean);
});

test("applyGamingPronunciation: combinations apply in order", () => {
  const input = "AAA Diablo III MMORPG";
  const out = applyGamingPronunciation(input);
  assert.equal(out, "Triple A Diablo three online RPG");
});

test("applyGamingPronunciation: disabled rule skipped", () => {
  const out = applyGamingPronunciation("AAA Diablo III", {
    disabled: new Set(["triple_a"]),
  });
  assert.equal(out, "AAA Diablo three");
});

// ── Rule registry sanity ────────────────────────────────────────

test("RULES registry: each rule has name + apply + description", () => {
  for (const r of RULES) {
    assert.equal(typeof r.name, "string");
    assert.ok(r.name.length > 0);
    assert.equal(typeof r.apply, "function");
    assert.equal(typeof r.description, "string");
  }
});

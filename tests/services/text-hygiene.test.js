"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const t = require("../../lib/text-hygiene");

// 2026-04-29 forensic audit: reports contain mojibake (â€", PokÃ©mon),
// stray HTML entities (&amp;, &pound;), and risk control chars in
// strings that go to public-facing renders. This module is the single
// normalisation surface — these tests pin its behaviour.

// ── decodeHtmlEntities ────────────────────────────────────────────

test("decodeHtmlEntities: named entities", () => {
  assert.equal(t.decodeHtmlEntities("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(t.decodeHtmlEntities("&pound;22.99"), "£22.99");
  assert.equal(t.decodeHtmlEntities("&copy; 2026"), "© 2026");
});

test("decodeHtmlEntities: numeric (decimal) entity", () => {
  assert.equal(t.decodeHtmlEntities("A &#8212; B"), "A — B"); // em dash
  assert.equal(t.decodeHtmlEntities("&#39;quoted&#39;"), "'quoted'");
});

test("decodeHtmlEntities: numeric (hex) entity", () => {
  assert.equal(t.decodeHtmlEntities("&#x2014;"), "—");
  assert.equal(t.decodeHtmlEntities("&#xA9;"), "©");
});

test("decodeHtmlEntities: unknown named entity left intact", () => {
  assert.equal(t.decodeHtmlEntities("&zwnj;X"), "&zwnj;X");
});

test("decodeHtmlEntities: graceful on null/empty/non-string", () => {
  assert.equal(t.decodeHtmlEntities(null), null);
  assert.equal(t.decodeHtmlEntities(undefined), undefined);
  assert.equal(t.decodeHtmlEntities(""), "");
});

// ── repairMojibake ────────────────────────────────────────────────

test("repairMojibake: fixes common UTF-8-as-Latin1 patterns", () => {
  assert.equal(t.repairMojibake("PokÃ©mon"), "Pokémon");
  assert.equal(t.repairMojibake("Â£22.99"), "£22.99");
  assert.equal(t.repairMojibake("itâ€™s"), "it’s");
});

test("repairMojibake: leaves clean text alone", () => {
  assert.equal(t.repairMojibake("Pokémon — €22"), "Pokémon — €22");
});

// ── normaliseText (full pipeline) ─────────────────────────────────

test("normaliseText: composite case (entity + mojibake + whitespace)", () => {
  assert.equal(
    t.normaliseText("  Price: &pound;22  PokÃ©mon  &#x2014;  done  "),
    "Price: £22 Pokémon — done",
  );
});

test("normaliseText: collapses runs of whitespace, preserves newlines", () => {
  assert.equal(t.normaliseText("a   b\n\nc"), "a b\n\nc");
});

test("normaliseText: idempotent on clean strings", () => {
  const s = "A clean line. Pokémon — €22.";
  assert.equal(t.normaliseText(s), s);
});

test("normaliseText: handles null/undefined gracefully", () => {
  assert.equal(t.normaliseText(null), "");
  assert.equal(t.normaliseText(undefined), "");
});

// ── classifyTextHygiene verdict ladder ────────────────────────────

test("classifyTextHygiene: clean string → severity=clean", () => {
  const r = t.classifyTextHygiene("Pokémon launches in October.");
  assert.equal(r.severity, "clean");
  assert.deepEqual(r.issues, []);
  assert.equal(r.ok, true);
});

test("classifyTextHygiene: html entity → warn (auto-repairable)", () => {
  const r = t.classifyTextHygiene("Price: &pound;22.99");
  assert.equal(r.severity, "warn");
  assert.ok(r.issues.includes("raw_html_entity"));
  assert.equal(r.normalised, "Price: £22.99");
  assert.equal(r.ok, true);
});

test("classifyTextHygiene: mojibake → warn (auto-repairable)", () => {
  const r = t.classifyTextHygiene("PokÃ©mon");
  assert.equal(r.severity, "warn");
  assert.ok(r.issues.includes("mojibake_detected"));
  assert.equal(r.normalised, "Pokémon");
});

test("classifyTextHygiene: control char in input → fail (cannot repair)", () => {
  const r = t.classifyTextHygiene("helloworld");
  assert.equal(r.severity, "fail");
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /control_char/.test(i)));
});

test("classifyTextHygiene: empty input is clean", () => {
  const r = t.classifyTextHygiene("");
  assert.equal(r.severity, "clean");
  assert.equal(r.ok, true);
});

test("classifyTextHygiene: stray entity that doesn't decode → fail", () => {
  // &fakebadcoded; stays as a raw entity after normalisation since the
  // named-entity table does not include it.
  const r = t.classifyTextHygiene("Test &fakebadcoded; here");
  // Note: the unknown entity stays in the output, so the post-normalise
  // raw_html_entity check fires → fail.
  assert.equal(r.severity, "fail");
  assert.ok(r.issues.includes("raw_html_entity_after_normalise"));
});

test("classifyTextHygiene: NFC normalisation merges combining marks", () => {
  // "e" + combining acute accent (U+0301) should become "é" (single
  // code point) after NFC normalise.
  const denormalised = "Pokémon"; // e + combining acute
  const r = t.classifyTextHygiene(denormalised);
  assert.equal(r.normalised, "Pokémon");
});

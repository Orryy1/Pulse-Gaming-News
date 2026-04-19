/**
 * tests/services/detect-company.test.js
 *
 * Pins the word-boundary fix for detectCompany added 2026-04-19.
 *
 * Incident: the 18:00 UTC Black Flag publish (1sojcmy) went out with
 * an Electronic Arts logo because detectCompany used `lower.includes("ea")`
 * and the title contained "reveal" ("r**ea**veal") which matched "ea".
 *
 * The fix uses word-boundary regex matching and also scans the body /
 * top_comment so stories whose title doesn't name the publisher can
 * still match on supporting context.
 *
 * Covers:
 *   - the exact 1sojcmy title no longer returns EA
 *   - a body that mentions Ubisoft surfaces Ubisoft even when the
 *     title doesn't
 *   - the string-only legacy signature still works (backwards compat)
 *   - genuine "EA" in a title (e.g. "EA confirms...") still matches EA
 *   - key with underscore ("cd_projekt") matches "CD Projekt" in text
 *   - no false-positive from substring matches ("ea" in "reveal")
 *   - null / undefined / missing fields handled safely
 *
 * Run: node --test tests/services/detect-company.test.js
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { detectCompany } = require("../../hunter");

test("1sojcmy: Tom Henderson Black Flag title no longer mis-matches EA", () => {
  const title =
    "Tom Henderson on Black Flag remake: reveal set for April 23rd, " +
    "Embargo lifts 12:15 PM ET, media are impressed with the game";
  const result = detectCompany({ title });
  // Before the fix, "reveal" triggered the "ea" substring match and
  // returned Electronic Arts. After the fix, the only thing that can
  // match this title is if it actually contains a company name. It
  // doesn't, so result should be null.
  assert.equal(
    result,
    null,
    `expected null for title without a company name, got ${JSON.stringify(result)}`,
  );
});

test("body-level match: title silent, body says 'Ubisoft' → returns ubisoft", () => {
  const story = {
    title: "Black Flag remake reveal set for April 23rd",
    body: "Ubisoft has set an oddly specific embargo time.",
  };
  const result = detectCompany(story);
  assert.ok(result, "expected a match");
  assert.equal(result.name, "ubisoft");
});

test("legacy string signature still works", () => {
  // Old callers passed just the title string. Stay backwards compatible.
  const result = detectCompany("Ubisoft confirms Black Flag remake");
  assert.ok(result);
  assert.equal(result.name, "ubisoft");
});

test("genuine EA mention still returns EA", () => {
  // "EA announces FC 26" — should legitimately match EA.
  const result = detectCompany({ title: "EA announces FC 26 release date" });
  assert.ok(result);
  assert.equal(result.name, "ea");
});

test("no false-positive from 'reveal' / 'real' / 'deal' / 'idea'", () => {
  const badCases = [
    "Reveal event scheduled for next week",
    "A real banger of a trailer",
    "Deal of the week: 70% off",
    "An idea worth exploring",
    "Leaked screenshots from the test build",
  ];
  for (const title of badCases) {
    const r = detectCompany({ title });
    assert.ok(
      !r || r.name !== "ea",
      `'${title}' should not match EA; got ${JSON.stringify(r)}`,
    );
  }
});

test("underscore key 'cd_projekt' matches the two-word phrase in text", () => {
  const r = detectCompany({
    title: "CD Projekt Red has a new Witcher in development",
  });
  assert.ok(r);
  assert.equal(r.name, "cd_projekt");
});

test("'Nintendo' matches Nintendo regardless of word neighbours", () => {
  const r = detectCompany({ title: "Nintendo Direct confirmed for next week" });
  assert.ok(r);
  assert.equal(r.name, "nintendo");
});

test("empty / undefined / missing fields return null without throwing", () => {
  assert.equal(detectCompany({ title: "" }), null);
  assert.equal(detectCompany({}), null);
  assert.equal(detectCompany(null), null);
  assert.equal(detectCompany(undefined), null);
  assert.equal(detectCompany(""), null);
});

test("iteration order still respected when two companies could match", () => {
  // If both "sony" and "playstation" are in the COMPANY_LOGOS map (they
  // are), the first-inserted one wins. Document current behaviour.
  const r = detectCompany({ title: "Sony's PlayStation plan for 2026" });
  assert.ok(r);
  // sony is listed first in the map, so should be returned first.
  assert.equal(r.name, "sony");
});

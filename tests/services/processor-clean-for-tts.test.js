"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { cleanForTTS } = require("../../processor");

test("processor cleanForTTS uses central title pronunciation for cached narration", () => {
  assert.equal(
    cleanForTTS("Halo: Campaign Evolved should sound like one game title."),
    "Halo Campaign Evolved should sound like one game title.",
  );
  assert.equal(
    cleanForTTS("S.T.A.L.K.E.R. 2: Heart of Chornobyl should not pause at the subtitle."),
    "Stalker 2 Heart of Chornobyl should not pause at the subtitle.",
  );
});

test("processor cleanForTTS does not regenerate old risky acronym speech", () => {
  assert.equal(
    cleanForTTS("GTA VI and PS5 should not become spaced-letter narration."),
    "Rockstar's next Grand Theft Auto and PlayStation five should not become spaced letter narration.",
  );
  assert.doesNotMatch(cleanForTTS("GTA VI"), /\bG\s*T\s*A\s*six\b/i);
  assert.doesNotMatch(cleanForTTS("PS5"), /\bP\s*S\s*5\b/i);
});

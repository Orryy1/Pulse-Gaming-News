"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { cleanForTTS } = require("../../audio");

test("cleanForTTS preserves accented game names for narration and timestamp subtitles", () => {
  assert.equal(cleanForTTS("Pok\u00e9mon Legends returns"), "Pok\u00e9mon Legends returns");
});

test("cleanForTTS repairs common mojibake before TTS cleanup", () => {
  assert.equal(cleanForTTS("Pok\u00c3\u00a9mon news"), "Pok\u00e9mon news");
});

test("cleanForTTS normalises combining accents before TTS cleanup", () => {
  assert.equal(cleanForTTS("Poke\u0301mon update"), "Pok\u00e9mon update");
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { ffEscape } = require("../../lib/studio/ffmpeg-scene-renderer");

test("ffmpeg scene renderer converts percent signs before drawtext", () => {
  const escaped = ffEscape("Super Mario RPG - $15 (70% off)");

  assert.equal(escaped.includes("%"), false);
  assert.match(escaped, /70 percent off/);
});

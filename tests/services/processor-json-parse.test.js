"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { parseLlmJsonObject } = require("../../processor");

test("parseLlmJsonObject parses plain JSON", () => {
  const parsed = parseLlmJsonObject('{"score":8,"reason":"clean"}');

  assert.equal(parsed.score, 8);
  assert.equal(parsed.reason, "clean");
});

test("parseLlmJsonObject strips fenced JSON", () => {
  const parsed = parseLlmJsonObject('```json\n{"score":9,"reason":"clean"}\n```');

  assert.equal(parsed.score, 9);
});

test("parseLlmJsonObject extracts JSON from surrounding text", () => {
  const parsed = parseLlmJsonObject('Here is the object:\n{"score":7,"reason":"ok"}');

  assert.equal(parsed.reason, "ok");
});

test("parseLlmJsonObject repairs literal control characters inside strings", () => {
  const parsed = parseLlmJsonObject(
    '{"hook":"Subnautica just exploded","full_script":"Line one\nLine two"}',
  );

  assert.equal(parsed.full_script, "Line one\nLine two");
});

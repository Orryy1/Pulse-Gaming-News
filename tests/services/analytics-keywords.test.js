const { test } = require("node:test");
const assert = require("node:assert");

const { extractKeywords } = require("../../analytics");

test("extractKeywords is exported for weekly/monthly roundup jobs", () => {
  assert.strictEqual(typeof extractKeywords, "function");
});

test("extractKeywords keeps gaming terms and removes common filler", () => {
  const keywords = extractKeywords(
    "Subnautica 2 Release Times For PC And Xbox Series X|S Revealed",
  );

  assert.ok(keywords.includes("subnautica"));
  assert.ok(keywords.includes("release"));
  assert.ok(keywords.includes("xbox"));
  assert.strictEqual(keywords.includes("for"), false);
  assert.strictEqual(keywords.includes("and"), false);
});

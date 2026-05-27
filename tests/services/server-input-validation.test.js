const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SERVER_PATH = path.join(__dirname, "..", "..", "server.js");
const src = fs.readFileSync(SERVER_PATH, "utf8");

test("server.js defines a bounded story-id validator for mutating routes", () => {
  assert.match(src, /function\s+isSafeStoryId\s*\(/);
  assert.match(src, /\^\[A-Za-z0-9_-\]\{1,96\}\$/);
  assert.match(src, /function\s+readRequiredStoryId\s*\(/);
});

test("mutating routes read story ids through the shared validator", () => {
  const occurrences = (src.match(/readRequiredStoryId\(req,\s*res\)/g) || [])
    .length;
  assert.ok(
    occurrences >= 6,
    `expected at least six story-id body reads to use readRequiredStoryId, got ${occurrences}`,
  );
});

test("stats update sanitises numeric counters before writing story state", () => {
  assert.match(src, /function\s+normaliseMetricCount\s*\(/);
  assert.match(src, /Number\.isSafeInteger\(n\)/);
  assert.match(src, /youtube_views !== undefined/);
  assert.match(src, /invalid youtube_views/);
  assert.match(src, /invalid tiktok_views/);
});

test("schedule route validates date-shaped values before writing story state", () => {
  assert.match(src, /function\s+normaliseScheduleTime\s*\(/);
  assert.match(src, /Number\.isNaN\(Date\.parse\(trimmed\)\)/);
  assert.match(src, /invalid scheduleTime/);
});

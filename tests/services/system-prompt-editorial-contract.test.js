"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("static processor fallback prompt defers runtime and CTA to the per-story contract", () => {
  const prompt = fs.readFileSync(
    path.join(__dirname, "..", "..", "system_prompt.txt"),
    "utf8",
  );

  assert.match(prompt, /Pulse Gaming News/);
  assert.match(prompt, /per-story editorial contract/i);
  assert.match(prompt, /duration_band_id/);
  assert.match(prompt, /hook_type/);
  assert.doesNotMatch(prompt, /61.?75|90.?110/i);
  assert.doesNotMatch(prompt, /never miss a beat|follow for more/i);
});

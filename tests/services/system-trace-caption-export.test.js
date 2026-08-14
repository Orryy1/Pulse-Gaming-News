"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  renderSrt,
  validateCaptionGroups,
} = require("../../tools/system-trace-caption-export");

test("renders deterministic UTF-8 SRT from aligned caption groups", () => {
  const document = {
    total_duration_s: 3.5,
    groups: [
      { id: "a", start: 0, end: 1.234, text: "First cue" },
      { id: "b", start: 1.4, end: 3.5, text: "Second cue" },
    ],
  };
  validateCaptionGroups(document);
  assert.equal(
    renderSrt(document),
    "1\n00:00:00,000 --> 00:00:01,234\nFirst cue\n\n" +
      "2\n00:00:01,400 --> 00:00:03,500\nSecond cue\n",
  );
});

test("rejects gaps outside the declared programme and overlapping cues", () => {
  assert.throws(
    () =>
      validateCaptionGroups({
        total_duration_s: 2,
        groups: [
          { start: 0, end: 1.2, text: "A" },
          { start: 1.1, end: 2, text: "B" },
        ],
      }),
    /caption_groups_overlap/,
  );
  assert.throws(
    () =>
      validateCaptionGroups({
        total_duration_s: 2,
        groups: [{ start: 0, end: 2.1, text: "A" }],
      }),
    /caption_group_outside_programme/,
  );
});

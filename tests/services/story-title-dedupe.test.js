"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isStoryTitleDuplicate,
} = require("../../lib/services/story-title-dedupe");

test("near-identical reports about the same edition remain duplicates", () => {
  assert.equal(
    isStoryTitleDuplicate(
      "PlayStation Plus Monthly Games for August 2026 announced",
      "Sony reveals the PlayStation Plus monthly games for August 2026",
    ),
    true,
  );
});

test("different named monthly catalogue editions are never collapsed", () => {
  assert.equal(
    isStoryTitleDuplicate(
      "PlayStation Plus Monthly Games for May 2026 announced",
      "PlayStation Plus Monthly Games for August 2026 announced",
    ),
    false,
  );
});

test("different numbered waves are never collapsed", () => {
  assert.equal(
    isStoryTitleDuplicate(
      "Xbox Game Pass July 2026 Wave 1 games confirmed",
      "Xbox Game Pass July 2026 Wave 2 games confirmed",
    ),
    false,
  );
});

test("ordinary high-overlap reports still deduplicate", () => {
  assert.equal(
    isStoryTitleDuplicate(
      "Bethesda confirms Elder Scrolls VI launch date",
      "Bethesda confirms Elder Scrolls six launch date today",
    ),
    true,
  );
});

test("unrelated titles do not deduplicate", () => {
  assert.equal(
    isStoryTitleDuplicate(
      "Halo Campaign Evolved is out now",
      "Ball x Pit final update arrives in August",
    ),
    false,
  );
});

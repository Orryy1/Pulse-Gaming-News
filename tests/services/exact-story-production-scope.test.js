"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  filterStoriesToExactScope,
  normaliseExactStoryIds,
  requireOneExactStory,
} = require("../../lib/services/exact-story-production-scope");

test("exact production scope normalises stable unique story ids", () => {
  assert.deepEqual(
    normaliseExactStoryIds([" story-b ", "story-a", "story-b", ""]),
    ["story-a", "story-b"],
  );
});

test("exact production scope never falls back to the full backlog", () => {
  const stories = [
    { id: "story-a" },
    { id: "story-b" },
    { id: "story-c" },
  ];
  assert.deepEqual(
    filterStoriesToExactScope(stories, { storyIds: ["story-b"] }),
    [{ id: "story-b" }],
  );
  assert.deepEqual(
    filterStoriesToExactScope(stories, { storyIds: [] }),
    [],
  );
});

test("one-story lane jobs fail closed on missing or ambiguous scope", () => {
  assert.equal(
    requireOneExactStory({ storyIds: ["story-a"] }),
    "story-a",
  );
  assert.throws(
    () => requireOneExactStory({ storyIds: [] }),
    /exactly_one_story_id_required/,
  );
  assert.throws(
    () => requireOneExactStory({ storyIds: ["story-a", "story-b"] }),
    /exactly_one_story_id_required/,
  );
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyProduceSelection,
  describeProduceSelection,
  parseStoryIds,
  parseStoryLimit,
} = require("../../lib/produce-selection");

const stories = [{ id: "a" }, { id: "b" }, { id: "c" }];

test("parseStoryIds: accepts comma and whitespace separated ids", () => {
  assert.deepEqual(
    [...parseStoryIds({ PRODUCE_STORY_IDS: "a, b c" })],
    ["a", "b", "c"],
  );
  assert.equal(parseStoryIds({ PRODUCE_STORY_IDS: " " }), null);
});

test("parseStoryLimit: accepts positive integer-ish limits only", () => {
  assert.equal(parseStoryLimit({ PRODUCE_STORY_LIMIT: "2" }), 2);
  assert.equal(parseStoryLimit({ PRODUCE_STORY_LIMIT: "2.9" }), 2);
  assert.equal(parseStoryLimit({ PRODUCE_STORY_LIMIT: "0" }), null);
  assert.equal(parseStoryLimit({ PRODUCE_STORY_LIMIT: "nope" }), null);
});

test("describeProduceSelection: inactive when neither knob is set", () => {
  const selection = describeProduceSelection({});
  assert.equal(selection.active, false);
  assert.equal(selection.ids, null);
  assert.equal(selection.limit, null);
});

test("applyProduceSelection: defaults to original story list", () => {
  assert.equal(applyProduceSelection(stories, { env: {} }), stories);
});

test("applyProduceSelection: filters by explicit story ids", () => {
  assert.deepEqual(
    applyProduceSelection(stories, {
      env: { PRODUCE_STORY_IDS: "c,a" },
    }).map((story) => story.id),
    ["a", "c"],
  );
});

test("applyProduceSelection: applies limit after id filtering", () => {
  assert.deepEqual(
    applyProduceSelection(stories, {
      env: { PRODUCE_STORY_IDS: "a,b,c", PRODUCE_STORY_LIMIT: "2" },
    }).map((story) => story.id),
    ["a", "b"],
  );
});

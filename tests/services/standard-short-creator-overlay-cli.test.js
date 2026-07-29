"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  fixtureStory,
  parseArgs,
} = require("../../tools/standard-short-creator-overlay");

test("standard-overlay CLI has no fixed runtime default", () => {
  const args = parseArgs(["node", "tool", "--fixture"]);
  assert.equal(args.durationS, null);
});

test("standard-overlay fixture declares the governed editorial band", () => {
  const story = fixtureStory();
  assert.equal(story.editorial_lane_id, "what_changes_for_players");
  assert.equal(story.hook_type, "direct");
  assert.equal(story.duration_band_id, "what_changes_standard_35_42");
  assert.equal(story.duration_s, 38.5);
});

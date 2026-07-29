"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
} = require("../../tools/flash-lane-footage-backbone");

test("footage-backbone CLI accepts a governed story manifest", () => {
  const args = parseArgs([
    "node",
    "tool",
    "--story-id",
    "story-1",
    "--story-manifest",
    "story.json",
  ]);

  assert.equal(args.storyId, "story-1");
  assert.equal(args.storyManifest, "story.json");
});

test("footage-backbone CLI rejects retired arbitrary runtime overrides", () => {
  assert.throws(
    () => parseArgs(["node", "tool", "--target-runtime", "66"]),
    /target-runtime is retired/,
  );
});

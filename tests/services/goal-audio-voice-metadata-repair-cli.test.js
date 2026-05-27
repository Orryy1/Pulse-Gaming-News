"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  parseArgs,
} = require("../../tools/goal-audio-voice-metadata-repair");

test("goal audio voice metadata repair CLI parses scoped local apply args", () => {
  const args = parseArgs([
    "--story-id",
    "rss_voice_meta",
    "--workspace",
    "workspace",
    "--out-dir",
    "out",
    "--apply-local",
    "--json",
  ]);

  assert.deepEqual(args.storyIds, ["rss_voice_meta"]);
  assert.equal(args.workspaceRoot, "workspace");
  assert.equal(args.outDir, "out");
  assert.equal(args.applyLocal, true);
  assert.equal(args.json, true);
});

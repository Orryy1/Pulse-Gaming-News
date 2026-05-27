"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { parseArgs } = require("../../tools/goal-platform-duration-contract");

test("goal platform duration contract CLI stays dry-run safe by default", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--out-dir",
    "output/goal-contract",
    "--generated-at",
    "2026-05-22T02:30:00.000Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.outDir, "output/goal-contract");
  assert.equal(args.generatedAt, "2026-05-22T02:30:00.000Z");
  assert.equal(args.json, true);
  assert.equal(args.help, false);
});

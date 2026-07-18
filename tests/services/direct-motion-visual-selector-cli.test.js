"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  parseArgs,
} = require("../../tools/direct-motion-visual-selector");

test("CLI accepts an exact motion manifest and repeatable clip IDs", () => {
  const args = parseArgs([
    "--motion-manifest",
    "motion.json",
    "--clip-id",
    "clip-1",
    "--clip-id",
    "clip-2",
    "--output",
    "selector.json",
    "--output-dir",
    "frames",
    "--policy-tier",
    "ultimate_professional",
    "--min-base-sources",
    "2",
    "--json",
  ]);

  assert.equal(args.motionManifestPath, "motion.json");
  assert.deepEqual(args.clipIds, ["clip-1", "clip-2"]);
  assert.equal(args.outputPath, "selector.json");
  assert.equal(args.outputDir, "frames");
  assert.equal(args.policyTier, "ultimate_professional");
  assert.equal(args.minBaseSources, 2);
  assert.equal(args.json, true);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  parseArgs,
} = require("../../tools/governed-motion-segment-composer");

test("governed motion composer has a canonical operator command", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "..", "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["ops:governed-motion-segments"],
    "node tools/governed-motion-segment-composer.js",
  );
});

test("CLI groups exact clip selections under their evidence bundle", () => {
  const args = parseArgs([
    "--story-id",
    "story-1",
    "--title",
    "Fixture Game",
    "--narration-duration",
    "54.4",
    "--min-clips",
    "14",
    "--min-base-sources",
    "7",
    "--motion-manifest",
    "first-motion.json",
    "--rights-ledger",
    "first-rights.json",
    "--selector-report",
    "first-selector.json",
    "--clip-id",
    "clip-1",
    "--clip-id",
    "clip-2",
    "--motion-manifest",
    "second-motion.json",
    "--rights-ledger",
    "second-rights.json",
    "--selector-report",
    "second-selector.json",
    "--clip-id",
    "clip-3",
    "--output",
    "balanced-segments.json",
    "--materializer-root",
    "isolated-materializer",
    "--json",
  ]);

  assert.equal(args.storyId, "story-1");
  assert.equal(args.narrationDurationSeconds, 54.4);
  assert.equal(args.minClips, 14);
  assert.equal(args.minBaseSources, 7);
  assert.equal(args.bundles.length, 2);
  assert.deepEqual(args.bundles[0].clipIds, ["clip-1", "clip-2"]);
  assert.deepEqual(args.bundles[1].clipIds, ["clip-3"]);
  assert.equal(args.outputPath, "balanced-segments.json");
  assert.equal(args.materializerRoot, "isolated-materializer");
  assert.equal(args.json, true);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  rowsFromPayload,
} = require("../../tools/official-youtube-motion-materializer");
const packageJson = require("../../package.json");

test("official YouTube motion materializer CLI exposes bounded local-only inputs", () => {
  const args = parseArgs([
    "node",
    "tools/official-youtube-motion-materializer.js",
    "--input",
    "test/output/official_search_intake_autofill.json",
    "--story-id",
    "arknights-endfield-gap",
    "--output-dir",
    "test/output/official-youtube-motion",
    "--output-json",
    "test/output/official-youtube-motion/report.json",
    "--output-template",
    "test/output/official-youtube-motion/intake.json",
    "--start-seconds",
    "5",
    "--end-seconds",
    "75",
    "--json",
  ]);

  assert.equal(args.storyId, "arknights-endfield-gap");
  assert.equal(args.startSeconds, 5);
  assert.equal(args.endSeconds, 75);
  assert.equal(args.json, true);
  assert.deepEqual(
    rowsFromPayload({
      output_template: { entries: [{ story_id: "arknights-endfield-gap" }] },
    }),
    [{ story_id: "arknights-endfield-gap" }],
  );
  assert.match(
    packageJson.scripts["media:materialize-official-youtube-motion"],
    /official-youtube-motion-materializer\.js/,
  );
});

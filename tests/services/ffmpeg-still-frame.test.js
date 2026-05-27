"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildStillFrameExtractionArgs } = require("../../lib/ffmpeg-still-frame");

test("still-frame ffmpeg args normalise remote video frames into JPEG-safe output", () => {
  const args = buildStillFrameExtractionArgs({
    source: "https://cdn.example/gameplay.webm",
    outputPath: "test/output/frame.jpg",
    seekSeconds: 4.2,
  });

  assert.deepEqual(args.slice(0, 8), [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    "4.2",
    "-i",
    "https://cdn.example/gameplay.webm",
  ]);
  assert.ok(args.includes("scale=1080:-2:flags=lanczos,format=yuvj420p"));
  assert.ok(args.includes("-strict"));
  assert.ok(args.includes("unofficial"));
  assert.equal(args.at(-1), "test/output/frame.jpg");
});

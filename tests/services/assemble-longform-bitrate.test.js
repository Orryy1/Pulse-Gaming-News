"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  longformSegmentDuration,
  longformVideoCodecArgs,
} = require("../../assemble_longform");

test("longform assembler targets enough video bitrate for the longform quality gate", () => {
  const args = longformVideoCodecArgs();

  assert.match(args, /-c:v libx264/);
  assert.match(args, /-b:v 3500k/);
  assert.match(args, /-maxrate 5000k/);
  assert.match(args, /-bufsize 7000k/);
});

test("longform assembler fits all story segments into the actual audio duration", () => {
  const segmentDuration = longformSegmentDuration({
    duration: 653.083991,
    segmentCount: 10,
  });

  assert.equal(segmentDuration, 65.308);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const { existingMotionClipPaths } = require("../../assemble_longform");

test("longform assembler prefers existing motion clips from segment and story evidence", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-longform-motion-"));
  const segmentClip = path.join(tmp, "segment.mp4");
  const storyClip = path.join(tmp, "story.mp4");
  const missingClip = path.join(tmp, "missing.mp4");
  await fs.writeFile(segmentClip, "fake");
  await fs.writeFile(storyClip, "fake");

  const clips = await existingMotionClipPaths(
    {
      motion_clips: [{ path: segmentClip }, { path: missingClip }],
    },
    {
      motion_clips: [storyClip],
      visual_v4_local_motion_clips: [{ path: segmentClip }],
    },
  );

  assert.deepEqual(clips.sort(), [segmentClip, storyClip].sort());
});


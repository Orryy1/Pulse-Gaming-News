"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { planLegacyVisualSequence } = require("../../assemble");

test("legacy visual planner keeps slot 0 as still image by default", () => {
  const plan = planLegacyVisualSequence(
    ["img0.png", "img1.png", "img2.png", "img3.png", "img4.png"],
    ["clip0.mp4", "clip1.mp4"],
  );

  assert.equal(plan.visualPaths[0], "img0.png");
  assert.equal(plan.isVideoSlot[0], false);
  assert.equal(plan.visualPaths[2], "clip0.mp4");
  assert.equal(plan.visualPaths[4], "clip1.mp4");
  assert.deepEqual(
    plan.placements.map((p) => p.slot),
    [2, 4],
  );
});

test("legacy visual planner uses the second slot when only two visuals exist", () => {
  const plan = planLegacyVisualSequence(
    ["img0.png", "img1.png"],
    ["clip0.mp4"],
  );

  assert.equal(plan.visualPaths[0], "img0.png");
  assert.equal(plan.visualPaths[1], "clip0.mp4");
  assert.deepEqual(plan.isVideoSlot, [false, true]);
});

test("legacy visual planner can still opt into hook video placement explicitly", () => {
  const plan = planLegacyVisualSequence(
    ["img0.png", "img1.png", "img2.png"],
    ["clip0.mp4"],
    { allowHookVideoSlot: true },
  );

  assert.equal(plan.visualPaths[0], "clip0.mp4");
  assert.equal(plan.isVideoSlot[0], true);
  assert.equal(plan.placements[0].reason, "hook_video_slot");
});

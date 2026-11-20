import { test } from "node:test";
import assert from "node:assert/strict";
import { offendingMedia, dropOffending } from "../src/qa/retry.ts";

const plan = {
  fps: 30,
  shots: [
    { start: 0, end: 12, media: { type: "image", index: 0 } },
    { start: 12, end: 84, media: { type: "clip", index: 0 } },
    { start: 84, end: 180, media: { type: "image", index: 1 } },
    { start: 180, end: 260, media: { type: "clip", index: 1 } },
    { start: 260, end: 400, media: { type: "clip", index: 2 } },
  ],
};
const times = [0.8, 4.0, 7.2, 10.0];

test("a frame faulted for text maps to the clip on screen; a layout fault drops nothing", () => {
  const off = offendingMedia(
    [
      "Frame 1: large trailer text sits behind the headline.",
      "Frame 3: the card label is clipped at the edge.",
    ],
    times,
    plan,
  );
  assert.deepEqual([...off.clips], [0]);
  assert.equal(off.images.size, 0);
  assert.equal(off.allClips, false);
  const both = offendingMedia(
    ["Frames 2 and 4: a logo and a watermark show through."],
    times,
    plan,
  );
  assert.deepEqual([...both.images], [1]);
  assert.deepEqual([...both.clips], [2]);
  const vague = offendingMedia(
    ["Burned-in subtitles are visible under the overlays."],
    times,
    plan,
  );
  assert.equal(vague.allClips, true);
});

test("dropping removes only the faulted media and never leaves the episode without art", () => {
  const assets = {
    clips: [{ f: "a" }, { f: "b" }, { f: "c" }],
    images: [{ f: "x" }, { f: "y" }],
  };
  const dropped = dropOffending(assets, {
    clips: new Set([0, 2]),
    images: new Set([1]),
    allClips: false,
  });
  assert.deepEqual(dropped, { clips: 2, images: 1 });
  assert.deepEqual(assets.clips, [{ f: "b" }]);
  assert.deepEqual(assets.images, [{ f: "x" }]);
  const only = { clips: [{ f: "a" }], images: [{ f: "x" }] };
  const d2 = dropOffending(only, {
    clips: new Set(),
    images: new Set([0]),
    allClips: true,
  });
  assert.deepEqual(d2, { clips: 1, images: 0 });
  assert.deepEqual(only.images, [{ f: "x" }], "the last still stays");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEPTH_EDGE_FAULT,
  flattenDepthFaults,
  offendingMedia,
} from "../src/qa/retry.ts";
import { loadConfig } from "../src/config.ts";

// Eight samples, as the Shorts' final check takes them; shots alternate stills and clips.
const plan = {
  fps: 30,
  shots: [
    { start: 0, end: 90, media: { type: "image", index: 0 } }, // frames 1-2 (0.5 s, 2.5 s)
    { start: 90, end: 180, media: { type: "clip", index: 0 } }, // frames 3-4
    { start: 180, end: 270, media: { type: "image", index: 1 } }, // frames 5-6
    { start: 270, end: 400, media: { type: "image", index: 2 } }, // frames 7-8
  ],
};
const times = [0.5, 2.5, 3.5, 5.5, 6.5, 8.5, 9.5, 12.5];
const layered = () => [
  { file: "a.jpg", layers: { bg: "a_bg", mid: "a_mid", fg: "a_fg" } } as {
    file: string;
    layers?: unknown;
    depthFault?: boolean;
  },
  { file: "b.jpg", layers: { bg: "b_bg", mid: "b_mid", fg: "b_fg" } } as {
    file: string;
    layers?: unknown;
    depthFault?: boolean;
  },
  { file: "c.jpg" } as { file: string; layers?: unknown; depthFault?: boolean },
];

test("the depth-edge words of the 26 Nov final checks match; ordinary faults and the Halo name do not", () => {
  for (const p of [
    "Last frame (8): the character has conspicuous jagged cutout edges around the shoulder and back, while the head is blurred into the background.",
    "Frame 6 (last): jagged, duplicated image strips along the bottom-left edge create an obvious rendering artefact.",
    "Frame 6 has obvious rendering artefacts: blocky, jagged edges around the character's horns and cloak, plus stray lines across the background.",
    "Frame 2 has conspicuous jagged, blocky image corruption across the lower third.",
  ])
    assert.ok(DEPTH_EDGE_FAULT.test(p), p);
  for (const p of [
    "Frame 2 retains large blurred HALO title lettering behind the Short's graphics.",
    "Frame 3: the card label is clipped at the edge.",
    "Frame 1 shows only text and branding on a black background with no picture.",
    "Frames 1-2: source subtitles are visibly cut off along the bottom edge.",
  ])
    assert.equal(DEPTH_EDGE_FAULT.test(p), false, p);
});

test("a jagged cut-out on a layered still renders it flat on the retry (it used to render the same tear again)", () => {
  const images = layered();
  const problems = [
    "Last frame (8): the character has conspicuous jagged cutout edges around the shoulder and back, while the head is blurred into the background.",
  ];
  // Images 1 and 2 are both layered for this case.
  images[2]!.layers = { bg: "c_bg", mid: "c_mid", fg: "c_fg" };
  const off = offendingMedia(problems, times, plan);
  assert.equal(
    off.images.size,
    0,
    "no media fault word, so nothing was dropped before either",
  );
  const flat = flattenDepthFaults(problems, times, plan, images, off);
  assert.deepEqual(flat, [2]);
  assert.equal(images[2]!.layers, undefined);
  assert.equal(images[2]!.depthFault, true);
  assert.ok(images[0]!.layers, "other stills keep their depth");
  assert.ok(images[1]!.layers);
});

test("a rendering artefact on a layered still keeps the picture, flat, instead of dropping it", () => {
  const images = layered();
  const problems = [
    "Frame 6 (last): jagged, duplicated image strips along the bottom-left edge create an obvious rendering artefact.",
  ];
  const off = offendingMedia(problems, times, plan);
  assert.deepEqual([...off.images], [1], "the old retry dropped the still");
  const flat = flattenDepthFaults(problems, times, plan, images, off);
  assert.deepEqual(flat, [1]);
  assert.equal(off.images.size, 0, "now it stays");
  assert.equal(images[1]!.layers, undefined);
  assert.equal(images[1]!.depthFault, true);
});

test("a still with another media fault on its frame is still dropped; an unlayered still is untouched", () => {
  const images = layered();
  const problems = [
    "Frame 2 has conspicuous jagged, blocky image corruption across the lower third.",
    "Frame 2: large burned-in 'HALO / CAMPAIGN EVOLVED' lettering is cropped by the frame.",
    "Frame 7: blocky rendering artefacts in the corner.",
  ];
  const off = offendingMedia(problems, times, plan);
  assert.deepEqual([...off.images].sort(), [0, 2]);
  const flat = flattenDepthFaults(problems, times, plan, images, off);
  assert.deepEqual(flat, [0], "only a layered still is flattened");
  assert.deepEqual(
    [...off.images].sort(),
    [0, 2],
    "the lettering still drops still 0; still 2 had no layers to blame",
  );
  assert.equal(images[2]!.depthFault, undefined);
});

test("one problem naming both an edge and a logo on the same frame still drops the picture", () => {
  const images = layered();
  const problems = [
    "Frame 5: jagged cut-out edges and a visible watermark in the corner.",
  ];
  const off = offendingMedia(problems, times, plan);
  flattenDepthFaults(problems, times, plan, images, off);
  assert.deepEqual([...off.images], [1]);
});

test("edge faults on a clip or naming no frame flatten nothing", () => {
  const images = layered();
  const problems = [
    "Frame 3: blocky compression artefacts in the footage.",
    "Jagged edges are visible around the character.",
  ];
  const off = offendingMedia(problems, times, plan);
  const flat = flattenDepthFaults(problems, times, plan, images, off);
  assert.deepEqual(flat, []);
  assert.ok(images[0]!.layers && images[1]!.layers);
  assert.deepEqual([...off.clips], [0], "the clip is handled as before");
});

test("QA_FLATTEN_DEPTH is on by default and can be switched off", () => {
  const before = process.env.QA_FLATTEN_DEPTH;
  try {
    delete process.env.QA_FLATTEN_DEPTH;
    assert.equal(loadConfig().qaFlattenDepth, true);
    process.env.QA_FLATTEN_DEPTH = "false";
    assert.equal(loadConfig().qaFlattenDepth, false);
  } finally {
    if (before === undefined) delete process.env.QA_FLATTEN_DEPTH;
    else process.env.QA_FLATTEN_DEPTH = before;
  }
});

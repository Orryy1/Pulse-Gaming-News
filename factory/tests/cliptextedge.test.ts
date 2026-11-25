// SHORT_CLIP_EDGE_TEXT: words a Short clip's zoom would cut in half at its top or bottom edge count as a fault, so a
// clip with source subtitles on the crop line is trimmed or dropped before the render (19 Nov 2026: final QA failed
// ep_20261119_3fac5cb6 twice for "a source-video subtitle cut off along the bottom edge").

import test from "node:test";
import assert from "node:assert/strict";
import {
  SHORT_CLIP_PUNCH,
  SHORT_CLIP_ZOOM,
  clipFrameWords,
  edgeCutWords,
  edgeTextOn,
  stripToPage,
} from "../src/assets/cliptext.ts";
import { CLIP_ZOOM } from "../src/render/smartcrop.ts";
import { cutPunch } from "../src/render/motion.ts";

// A 16:9 frame at the size the clip screen reads (960 wide). The zoomed crop shows rows 52 to 488 at the base zoom and
// rows 59 to 481 at the top of the cut punch.
const page = (
  words: Array<[string, number, number, number, number]>,
  width = 960,
  height = 540,
) => ({
  width,
  height,
  words: words.map(([text, x, y, w, h]) => ({ text, x, y, w, h })),
});

test("the zoom and punch the screen assumes are the ones the Short renders with", () => {
  assert.equal(SHORT_CLIP_ZOOM, CLIP_ZOOM);
  assert.ok(Math.abs(SHORT_CLIP_PUNCH - cutPunch(0)) < 1e-9);
});

test("a subtitle sitting on the crop's bottom line is cut", () => {
  // The 3fac5cb6 case: a subtitle line, too small to be "big lettering", half below the crop line.
  assert.deepEqual(edgeCutWords(page([["surgery", 440, 475, 80, 20]])), [
    "surgery",
  ]);
  // The same at the top edge.
  assert.deepEqual(edgeCutWords(page([["LIVE", 460, 45, 40, 20]])), ["LIVE"]);
});

test("a subtitle whole at the base zoom but cut during the cut punch counts", () => {
  assert.deepEqual(edgeCutWords(page([["dream", 450, 465, 60, 20]])), [
    "dream",
  ]);
});

test("words wholly shown or wholly hidden are fine", () => {
  // Fully below the crop: the zoom hides it, as it was meant to.
  assert.deepEqual(edgeCutWords(page([["hidden", 440, 495, 80, 20]])), []);
  // Well inside the picture: a sign or a HUD line the viewer reads whole.
  assert.deepEqual(edgeCutWords(page([["Vinewood", 440, 300, 80, 20]])), []);
});

test("noise, single letters and words outside the vertical crop are ignored", () => {
  // Too small to read (under 1.8% of the height).
  assert.deepEqual(edgeCutWords(page([["xx", 470, 480, 20, 8]])), []);
  // One letter.
  assert.deepEqual(edgeCutWords(page([["A", 470, 475, 20, 20]])), []);
  // On the crop line but at the far left, outside what the 9:16 crop keeps.
  assert.deepEqual(edgeCutWords(page([["corner", 10, 475, 80, 20]])), []);
});

test("a portrait clip is judged the same way; one narrower than 9:16 is not judged", () => {
  // 540 x 960: the crop shows rows 93 to 867 at the base zoom.
  assert.deepEqual(
    edgeCutWords(page([["caption", 200, 855, 120, 30]], 540, 960)),
    ["caption"],
  );
  assert.deepEqual(
    edgeCutWords(page([["caption", 150, 855, 120, 30]], 400, 960)),
    [],
  );
});

test("the frame's fault words: big lettering plus edge-cut words, each once, and the setting turns the edge part off", () => {
  const p = page([
    ["ULTIMATE", 350, 200, 300, 60],
    ["surgery", 440, 475, 80, 20],
  ]);
  assert.deepEqual(clipFrameWords(p, true), ["ULTIMATE", "surgery"]);
  assert.deepEqual(clipFrameWords(p, false), ["ULTIMATE"]);
  // A big word that also crosses the edge is listed once.
  assert.deepEqual(
    clipFrameWords(page([["TRAILER", 400, 470, 160, 40]]), true),
    ["TRAILER"],
  );
});

test("SHORT_CLIP_EDGE_TEXT is on unless set to false", () => {
  assert.equal(edgeTextOn({}), true);
  assert.equal(edgeTextOn({ SHORT_CLIP_EDGE_TEXT: "true" }), true);
  assert.equal(edgeTextOn({ SHORT_CLIP_EDGE_TEXT: " FALSE " }), false);
  assert.equal(edgeTextOn({ SHORT_CLIP_EDGE_TEXT: "false" }), false);
});

test("an edge strip read at full size maps back onto the whole picture", () => {
  // A 2160 x 1080 clip: each strip is 216 rows, stacked top over bottom into 2160 x 432.
  const strip = {
    width: 2160,
    height: 432,
    words: [
      { text: "Someone", x: 1000, y: 297, w: 160, h: 37 }, // bottom strip (from row 864): rows 945 to 982
      { text: "LIVE", x: 1040, y: 20, w: 80, h: 30 }, // top strip: rows 20 to 50
      { text: "seam", x: 1040, y: 200, w: 80, h: 30 }, // across the join: dropped
    ],
  };
  const page = stripToPage(strip);
  assert.equal(page.height, 1080);
  assert.deepEqual(
    page.words.map((w) => [w.text, w.y]),
    [
      ["Someone", 945],
      ["LIVE", 20],
    ],
  );
  // The bottom word sits on the crop line (row 975 at the base zoom, 963 at the punch), so it is cut; the top one is hidden.
  assert.deepEqual(edgeCutWords(page), ["Someone"]);
});

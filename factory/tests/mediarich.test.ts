import { test } from "node:test";
import assert from "node:assert/strict";
import type { Segment } from "../src/render/timeline.ts";
import type { Shot } from "../src/render/plan.ts";
import { mediaRichNotice, shortMediaRichness } from "../src/qa/mediarich.ts";

// A news Short's spine: hook, two card beats, the take (a title card), the loop. Ten seconds each at 30 fps.
const segments: Segment[] = [
  { kind: "hook", text: "h", start: 0, end: 10 },
  {
    kind: "beat",
    text: "b0",
    start: 10,
    end: 20,
    visual: { kind: "price", primary: "$80", secondary: "" },
  },
  {
    kind: "beat",
    text: "b1",
    start: 20,
    end: 30,
    visual: { kind: "none", primary: "", secondary: "" },
  },
  {
    kind: "take",
    text: "t",
    start: 30,
    end: 40,
    visual: { kind: "title", primary: "Our read", secondary: "" },
    label: "OUR READ",
  },
  { kind: "loop", text: "l", start: 40, end: 50 },
];
const shot = (
  segment: number,
  start: number,
  end: number,
  media: Shot["media"],
): Shot => ({
  start,
  end,
  segment,
  media,
  move: "settle",
  framed: false,
  luma: 128,
});
const images = [{}, { beatIndex: 1 }]; // 0: the hero (untagged), 1: a picture chosen for the second beat
const clips = [{ role: "hook" }, { beatIndex: 0 }, {}]; // 0: the hook's moment, 1: the first beat's, 2: untagged

test("coverage is the time under a line's own footage or picture, or a card, over the narration", () => {
  const plan = {
    fps: 30,
    shots: [
      shot(0, 0, 150, { type: "clip", index: 0 }), // hook on its own moment: own
      shot(0, 150, 300, { type: "image", index: 0 }), // hook on the hero: nothing
      shot(1, 300, 600, { type: "clip", index: 2 }), // beat 0 under a card, borrowed clip: card
      shot(2, 600, 750, { type: "image", index: 1 }), // beat 1 (no card) on its own picture: own
      shot(2, 750, 900, { type: "clip", index: 2 }), // beat 1 on a borrowed clip: nothing
      shot(3, 900, 1200, { type: "image", index: 0 }), // take under its title card: card
      shot(4, 1200, 1500, { type: "image", index: 0 }), // loop on the hero: nothing
    ],
  };
  const m = shortMediaRichness(segments, plan, images, clips);
  assert.equal(m.seconds, 50);
  // Own: 5 (hook) + 5 (beat 1) = 10 s. Cards: 10 (beat 0) + 10 (take). Covered 30 of 50.
  assert.equal(m.own, 0.2);
  assert.equal(m.covered, 0.6);
  assert.equal(m.graphicOnly, 0.4);
  assert.deepEqual(
    m.segments.map((s) => [s.kind, s.seconds, s.own, s.graphic]),
    [
      ["hook", 10, 5, false],
      ["beat", 10, 0, true],
      ["beat", 10, 5, false],
      ["take", 10, 0, true],
      ["loop", 10, 0, false],
    ],
  );
});

test("a clip tagged for one beat is not that beat's neighbour's; the first beat's clip under the hook counts for nothing", () => {
  const plan = {
    fps: 30,
    shots: [
      shot(0, 0, 300, { type: "clip", index: 1 }), // the first beat's moment played under the hook
      shot(2, 300, 600, { type: "clip", index: 1 }), // and under the second beat
      shot(4, 600, 900, { type: "plate", index: 0 }),
    ],
  };
  const m = shortMediaRichness(segments, plan, images, clips);
  assert.equal(m.own, 0);
  assert.equal(m.covered, 0);
  assert.equal(
    shortMediaRichness(segments, { fps: 30, shots: [] }, images, clips).covered,
    1,
    "nothing planned reads as covered",
  );
});

test("the notice says the share, what made it up and that nothing changes", () => {
  const line = mediaRichNotice(
    "Switch 2 Games Now Cost $80",
    { covered: 0.6, own: 0.2, graphicOnly: 0.4, seconds: 50, segments: [] },
    0.85,
  );
  assert.equal(
    line,
    '🎞️ "Switch 2 Games Now Cost $80": 60% of its narration has something chosen for its own words on screen (20% a trailer moment or picture matched to the line, 40% a card), under the 85% target. It renders as it is; this is measured only for now.',
  );
  assert.ok(!line.includes("—") && !line.includes("–"));
});

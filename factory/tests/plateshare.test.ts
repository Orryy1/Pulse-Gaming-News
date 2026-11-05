import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePlan } from "../src/qa/rubric.ts";

const planWith = (plateFrames: number) =>
  ({
    fps: 30,
    totalFrames: 1000,
    shots: [
      { start: 0, end: 1000 - plateFrames, media: { type: "clip", index: 0 } },
      { start: 1000 - plateFrames, end: 1000, media: { type: "plate", index: 0 } },
    ],
    cues: [],
    sfx: [],
    shelf: [],
    events: [],
  }) as never;
const plate = (frames: number) =>
  scorePlan({
    plan: planWith(frames),
    segments: [],
    words: [],
    footageSeconds: 30,
    footageBudgetSeconds: 30,
    hookWords: 8,
    plateShareMax: 0.15,
  }).metrics.find((m) => m.name === "plate_share")!;

test("a Short mostly on the empty panel is red, a moment of it is fine", () => {
  assert.equal(plate(650).grade, "red"); // the Elder Scrolls Short of 4 Nov 2026
  assert.equal(plate(100).grade, "amber");
  assert.equal(plate(30).grade, "green");
});

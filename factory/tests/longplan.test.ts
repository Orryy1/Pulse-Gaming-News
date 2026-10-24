import { test } from "node:test";
import assert from "node:assert/strict";

import { usefulGraphic, usefulEmphasis } from "../src/render/longplan.ts";

test("rank graphics and fragment captions are left out", () => {
  assert.equal(usefulGraphic({ kind: "stat", primary: "FIVE", secondary: "where it lands on the list" }), false);
  assert.equal(usefulGraphic({ kind: "stat", primary: "7", secondary: "ranking position" }), false);
  assert.equal(usefulGraphic({ kind: "date", primary: "November 2009", secondary: "Modern Warfare 2 release" }), true);
  assert.equal(usefulGraphic({ kind: "score", primary: "94", secondary: "Metacritic" }), true);
  assert.equal(usefulEmphasis("SERIES AT"), false);
  assert.equal(usefulEmphasis("Captain Price"), true);
  assert.equal(usefulEmphasis("the Numbers"), false);
});

import { flashRuns } from "../src/qa/media.ts";

test("brief dips to black at cuts are caught, dark scenes and the fade-in are not", () => {
  const f = (time: number, luma: number) => ({ time, luma });
  const frames = [f(0.1, 5), f(1, 80), f(1.033, 6), f(1.066, 7), f(1.1, 80), f(5, 10), f(5.5, 80), ...Array.from({ length: 40 }, (_, i) => f(6 + i / 30, 8)), f(9, 80)];
  assert.deepEqual(flashRuns(frames, 20), [{ start: 1.033, end: 1.066, frames: 2 }, { start: 5, end: 5, frames: 1 }]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { fitCutsToAudio, pauseCuts } from "../src/voice/pauses.ts";

// Loudness per 10 ms window: speech at -20 dB, silence at -70 dB.
const audio = (spans: Array<[number, number]>, seconds: number) => {
  const db = new Array(Math.round(seconds * 100)).fill(-70);
  for (const [a, b] of spans) for (let k = Math.round(a * 100); k < Math.round(b * 100); k++) db[k] = -20;
  return db;
};

test("a cut lands on the real silence when the timings run late", () => {
  // Real speech: 0-2 s, then 3.2-5 s. The timings say the pause is 0.8 s later than it is (2.8-4.0).
  const db = audio([[0, 2], [3.2, 5]], 5);
  const words = [
    { text: "minute.", start: 1.5, end: 2.8 },
    { text: "Two", start: 4.0, end: 4.3 },
  ];
  const planned = pauseCuts(words);
  assert.equal(planned.length, 1);
  assert.ok(planned[0]!.to > 3.2, "the planned cut runs into the next word");
  const [c] = fitCutsToAudio(planned, db);
  assert.ok(c, "a fitted cut");
  assert.ok(c!.from >= 2 + 0.29 && c!.to <= 3.2 - 0.29, `the cut ${c!.from}-${c!.to} stays inside the silence with its margins`);
});

test("no real pause means no cut", () => {
  const db = audio([[0, 5]], 5);
  assert.deepEqual(fitCutsToAudio([{ from: 2, to: 3, keep: 0.6 }], db), []);
});

test("a cut never removes more than planned", () => {
  const db = audio([[0, 1], [4, 5]], 5);
  const [c] = fitCutsToAudio([{ from: 2.3, to: 2.7, keep: 0.6 }], db);
  assert.ok(Math.abs(c!.to - c!.from - 0.4) < 0.011);
});

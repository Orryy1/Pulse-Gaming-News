import { test } from "node:test";
import assert from "node:assert/strict";
import { clearOfEntrances, ENTRANCE_SECONDS } from "../src/qa/graphicscheck.ts";

const w = (start: number, at: number, end: number) => ({ entry: 4, segment: 0, moment: 10, start, end, at });

test("a sample caught while a card fades in moves to the moment it settles", () => {
  const windows = [w(100, 101, 106)];
  const [t] = clearOfEntrances([101.2], windows);
  assert.equal(t, 101 - 0.15 + ENTRANCE_SECONDS);
});

test("samples clear of every entrance stay where they are", () => {
  const windows = [w(100, 101, 106)];
  assert.deepEqual(clearOfEntrances([50, 104], windows), [50, 104]);
});

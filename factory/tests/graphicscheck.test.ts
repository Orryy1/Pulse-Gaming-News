import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkFrame,
  graphicChecks,
  graphicsNotice,
  judgeGraphics,
  muteFaults,
  passDecision,
} from "../src/qa/graphicscheck.ts";
import type { MomentWindow } from "../src/render/longplan.ts";

const w = (
  entry: number,
  moment: number,
  start: number,
  at = start,
): MomentWindow => ({
  entry,
  segment: 0,
  moment,
  start,
  end: start + 5,
  at,
});
const stat = { kind: "stat", primary: "17 million", secondary: "" };
const none = { kind: "none", primary: "", secondary: "" };

test("the check list has every useful graphic and breather, skips muted ones and the end, and is capped", () => {
  const windows = [
    w(0, 0, 10),
    w(0, 1, 20, 21),
    w(0, 2, 30),
    w(1, 0, 40),
    w(1, 1, 2000),
  ];
  const graphics: Record<
    string,
    { kind: string; primary: string; secondary: string }
  > = {
    "0:0": stat,
    "0:1": stat,
    "0:2": none,
    "1:0": stat,
    "1:1": stat,
  };
  const input = {
    windows,
    graphicOf: (e: number, m: number) => graphics[`${e}:${m}`],
    breaks: [
      { start: 100, end: 108 },
      { start: 200, end: 208 },
    ],
    durationSeconds: 1000,
  };
  const all = graphicChecks(input, {}, 200);
  assert.deepEqual(
    all.map((c) => c.what),
    ["0:0", "0:1", "1:0", "break:0", "break:1"],
  );
  // 2.2 s after the sentence lands (0.15 s before its key word), 2.5 s into a breather.
  assert.equal(all[1]!.t, 21 - 0.15 + 2.2);
  assert.equal(all[3]!.t, 102.5);
  assert.equal(checkFrame(all[3]!, 30), 3075);
  const muted = graphicChecks(
    input,
    { quietMoments: ["0:1"], quietBreaks: [1] },
    200,
  );
  assert.deepEqual(
    muted.map((c) => c.what),
    ["0:0", "1:0", "break:0"],
  );
  assert.equal(graphicChecks(input, {}, 2).length, 2);
  assert.equal(graphicChecks(input, {}, 0).length, 0);
});

test("the checker's frame numbers map back to the right keys across batches, and an outage faults nothing", async () => {
  const items = Array.from({ length: 11 }, (_, i) => ({
    t: i,
    what: `0:${i}`,
    file: `f${i}.jpg`,
  }));
  const seen: string[][] = [];
  const r = await judgeGraphics(items, async (frames) => {
    seen.push(frames);
    if (frames.length === 8)
      return {
        verdict: "fail" as const,
        problems: ["Frame 2: text cut off", "Frames 5 and 8: overlap"],
        notes: "",
      };
    throw new Error("vision down");
  });
  assert.deepEqual(
    seen.map((b) => b.length),
    [8, 3],
  );
  assert.deepEqual(r.faulted, ["0:1", "0:4", "0:7"]);
  assert.equal(r.problems.length, 1);
  assert.deepEqual(
    r.problems[0]!.at,
    items.slice(0, 8).map((i) => i.what),
  );
});

test("muting adds faults to the lists the renderer reads, once each", () => {
  const m = muteFaults({ quietMoments: ["0:1"], quietBreaks: [0] }, [
    "0:1",
    "2:3",
    "break:0",
    "break:4",
    "2:3",
  ]);
  assert.deepEqual(m.quietMoments, ["0:1", "2:3"]);
  assert.deepEqual(m.quietBreaks, [0, 4]);
  assert.equal(m.newMoments, 1);
  assert.equal(m.newBreaks, 1);
});

test("the post-render check re-renders only while passes remain", () => {
  assert.equal(passDecision(0, 1), "rerender");
  assert.equal(passDecision(1, 1), "accept");
  assert.equal(passDecision(0, 0), "accept");
  assert.equal(passDecision(2, 3), "rerender");
});

test("the owner's notice says how many were muted, why and what happens next", () => {
  const pre = graphicsNotice(
    "Vice City",
    "prepass",
    143,
    ["0:4", "break:1"],
    ["Frame 2: text cut off at the edge"],
  );
  assert.match(pre, /143 graphics before the render/);
  assert.match(pre, /muted 1 graphic and 1 chapter breather/);
  assert.match(pre, /text cut off at the edge/);
  assert.match(pre, /renders once/);
  assert.match(
    graphicsNotice("Vice City", "prepass", 143, [], []),
    /found nothing wrong/,
  );
  assert.match(
    graphicsNotice("Vice City", "rerender", 32, ["0:4"], ["Frame 1: overlap"]),
    /renders again, once/,
  );
  const acc = graphicsNotice(
    "Vice City",
    "accept",
    32,
    ["0:4", "0:5"],
    ["Frame 1: overlap"],
  );
  assert.match(acc, /No more re-renders/);
  assert.match(acc, /2 graphics/);
  assert.doesNotMatch(pre + acc, /—/);
});

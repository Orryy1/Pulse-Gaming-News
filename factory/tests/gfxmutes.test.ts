// The 1 Nov 2026 fixes for the graphics the Vice City documentary muted (51 of 200 before its render): the
// corner furniture gives way to graphics, one shared span for the renderer and the check, graphics too short
// to read left out, captions that would land on a full-screen graphic left out, the check skipping graphics
// that draw nothing, critics' words set in the body face and compares keeping their heading off the pictures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hudYield } from "../src/render/hudyield.ts";
import {
  captionHeld,
  MIN_READ_SECONDS,
  sentenceSpan,
  type SpanLook,
} from "../src/render/momentspan.ts";
import { graphicChecks, settledFrame } from "../src/qa/graphicscheck.ts";
import {
  verdictLook,
  headBand,
} from "../src/render/components/DocGraphics.tsx";
import { graphicDrawsFor } from "../src/render/gfxdraws.ts";
import type { MomentWindow } from "../src/render/longplan.ts";
import { motifPictureOrder } from "../src/render/motifpictures.ts";
import { repairPictures, thumbOutcome } from "../src/qa/thumbrepair.ts";

const FPS = 30;
const w = (
  entry: number,
  moment: number,
  start: number,
  end = start + 5,
): MomentWindow => ({ entry, segment: 0, moment, start, end, at: start });
const stat = { kind: "stat", primary: "17 million", secondary: "copies" };
const versus = { kind: "versus", primary: "Map size", secondary: "" };
const none = { kind: "none", primary: "", secondary: "" };
type M = { graphic: typeof stat; emphasis?: string };
const lookOf = (
  moments: Record<string, M>,
  extra: Partial<SpanLook> = {},
): SpanLook => ({
  moment: (e, m) => moments[`${e}:${m}`],
  fillerStart: () => undefined,
  ...extra,
});

test("the corner furniture fades out over a graphic and comes back after it", () => {
  const spans = [{ from: 100, to: 200 }];
  assert.equal(hudYield(50, spans), 1);
  assert.equal(hudYield(100, spans), 0);
  assert.equal(hudYield(199, spans), 0);
  assert.equal(hudYield(96, spans), 0.5);
  assert.equal(hudYield(203, spans), 0.5);
  assert.equal(hudYield(250, spans), 1);
  // Overlapping and unordered spans, and an empty one, are fine.
  assert.equal(
    hudYield(150, [
      { from: 300, to: 400 },
      { from: 120, to: 160 },
    ]),
    0,
  );
  assert.equal(hudYield(150, [{ from: 150, to: 150 }]), 1);
});

test("a graphic never runs into the next graphic of its entry (the stat under the milestone banner)", () => {
  // Vice City 5:4 and 5:5: a stat at 1240.5 s and a milestone 2.5 s later. The old 2.5 s floor ran into it.
  const windows = [w(0, 0, 10, 12.5), w(0, 1, 12.5)];
  const look = lookOf({ "0:0": { graphic: stat }, "0:1": { graphic: versus } });
  const a = sentenceSpan(windows, 0, FPS, look);
  const b = sentenceSpan(windows, 1, FPS, look);
  assert.ok(
    a.from + a.len <= b.from,
    "the first is gone before the second lands",
  );
  assert.equal(a.short, false);
});

test("a graphic with under two seconds before the next graphic is left out, and the check skips it", () => {
  // Vice City 4:4: a stat on screen for one second before a bar chart.
  const windows = [w(0, 0, 10, 11), w(0, 1, 11)];
  const moments = { "0:0": { graphic: stat }, "0:1": { graphic: versus } };
  const sp = sentenceSpan(windows, 0, FPS, lookOf(moments));
  assert.equal(sp.short, true);
  assert.ok(MIN_READ_SECONDS >= 2);
  const checks = graphicChecks(
    {
      windows,
      graphicOf: (e, m) => moments[`${e}:${m}` as "0:0"]?.graphic,
      durationSeconds: 100,
      momentOf: (e, m) => moments[`${e}:${m}` as "0:0"],
    },
    {},
    10,
  );
  assert.deepEqual(
    checks.map((c) => c.what),
    ["0:1"],
  );
});

test("a full-screen graphic gives way to a caption, unless that would cut it to a flash; then the caption is left out", () => {
  // The caption lands 3 s in: the compare ends there and the caption is drawn.
  const late = [w(0, 0, 10, 13), w(0, 1, 13)];
  const moments = {
    "0:0": { graphic: versus },
    "0:1": { graphic: none, emphasis: "verticality and density" },
  };
  const sp = sentenceSpan(late, 0, FPS, lookOf(moments));
  assert.equal(sp.from + sp.len, Math.round((13 - 0.3) * FPS));
  assert.equal(captionHeld(late, 1, FPS, lookOf(moments)), false);
  // Vice City 4:19: the caption landed one second in, on the compare's heading. Now the compare keeps its
  // 2.5 s and the caption is left out.
  const early = [w(0, 0, 10, 11), w(0, 1, 11)];
  const held = sentenceSpan(early, 0, FPS, lookOf(moments));
  assert.equal(held.short, false);
  assert.equal(held.len, Math.round(2.5 * FPS));
  assert.equal(captionHeld(early, 1, FPS, lookOf(moments)), true);
  // A small corner card shares the frame: the caption lands under it as before.
  const shares = lookOf(moments, { shares: () => true });
  assert.equal(captionHeld(early, 1, FPS, shares), false);
});

test("the check times a graphic on the renderer's span and skips what draws nothing", () => {
  // Vice City 4:11: a map whose still landed on the next sentence's full-screen document.
  const windows = [w(0, 0, 10, 15), w(0, 1, 13)];
  const map = {
    kind: "map",
    primary: "Where the research happened",
    secondary: "",
  };
  const moments: Record<string, M> = {
    "0:0": { graphic: map },
    "0:1": { graphic: none },
  };
  const shots = [
    {
      start: 13 * FPS,
      end: 18 * FPS,
      media: { type: "filler" as const, index: 1, entry: 0 },
    },
  ];
  const input = {
    windows,
    graphicOf: (e: number, m: number) => moments[`${e}:${m}`]?.graphic,
    durationSeconds: 100,
    shots,
    momentOf: (e: number, m: number) => moments[`${e}:${m}`],
  };
  const checks = graphicChecks(input, {}, 10);
  const mapCheck = checks.find((c) => c.what === "0:0")!;
  assert.ok(
    mapCheck.t < 13 - 0.3,
    `the map's still (${mapCheck.t}) is before the document`,
  );
  // A graphic the renderer does not draw (no style fits) is not checked: Vice City 2:8 showed only gameplay.
  const skipped = graphicChecks({ ...input, draws: () => false }, {}, 10);
  assert.equal(
    skipped.some((c) => c.what === "0:0"),
    false,
  );
});

test("the still is taken before a short moment ends and fades", () => {
  for (const len of [30, 45, 60, 90])
    assert.ok(settledFrame(len) <= len - 24, `moment of ${len} frames`);
});

test("critics' words go in quotes in the body face, scores stay in the display face", () => {
  assert.deepEqual(verdictLook("really quite shoddy"), {
    text: "“really quite shoddy”",
    face: "inter",
    sizes: [54, 46, 40, 34, 30],
    maxLines: 3,
  });
  assert.equal(verdictLook("4 out of 5").face, "anton");
  assert.equal(verdictLook("9/10").text, "9/10");
  assert.equal(verdictLook('"disastrous"').text, "“disastrous”");
});

test("a compare keeps a band for its heading so the pictures start below it", () => {
  assert.equal(headBand("", 72), 0);
  assert.ok(headBand("Map size", 72) >= 72 + 60);
});

test("a suite graphic with no style that fits is not drawn; the house kinds always are", () => {
  const draws = graphicDrawsFor([], "Grand Theft Auto");
  assert.equal(
    draws(0, { kind: "stat", primary: "17 million", secondary: "", items: [] }),
    true,
  );
  assert.equal(
    draws(0, { kind: "quote", primary: "a line", secondary: "Sam", items: [] }),
    true,
  );
  // A map with no places has nothing to draw.
  assert.equal(
    draws(0, { kind: "map", primary: "Where", secondary: "", items: [] }),
    false,
  );
});

test("the series grid takes panel-shaped gameplay pictures, one per chapter, before logo banners and key art", () => {
  const pics = [
    { file: "banner", kind: "hero", aspect: 3.1 },
    { file: "trailer", kind: "hero", aspect: 1.78 },
    { file: "e0-banner", kind: "hero", aspect: 3.1, beatIndex: 0 },
    { file: "e0-shot", kind: "screenshot", aspect: 1.78, beatIndex: 0 },
    { file: "e0-shot2", kind: "screenshot", aspect: 1.78, beatIndex: 0 },
    { file: "e1-art", kind: "hero", aspect: 1.6, beatIndex: 1 },
    { file: "e1-shot", kind: "screenshot", aspect: 1.78, beatIndex: 1 },
    { file: "e1-capsule", kind: "capsule", aspect: 0.6, beatIndex: 1 },
  ];
  // Before 1 Nov 2026 the first six wide pictures led with the two logo banners (Vice City's thumbnail).
  assert.deepEqual(
    motifPictureOrder(pics).map((p) => p.file),
    ["e0-shot", "e1-shot", "trailer", "e0-shot2", "e1-art", "e0-banner"],
  );
  assert.equal(motifPictureOrder(pics, 2).length, 2);
  assert.deepEqual(motifPictureOrder([]), []);
});

test("a failed series grid is replaced by its own repair before another design; A/B variants are kept", () => {
  const variants = ["thumb_b.jpg", "thumb_c.jpg"];
  // The grid fails, its repair passes: the repair becomes the thumbnail and both test designs stay.
  assert.deepEqual(
    thumbOutcome({
      main: "thumb.jpg",
      variants,
      repair: "thumb_grid_b.jpg",
      bad: new Set(["thumb.jpg"]),
    }),
    { mainFrom: "thumb_grid_b.jpg", variants, repaired: true },
  );
  // Both fail: the first passing test design takes its place, as before.
  assert.deepEqual(
    thumbOutcome({
      main: "thumb.jpg",
      variants,
      repair: "thumb_grid_b.jpg",
      bad: new Set(["thumb.jpg", "thumb_grid_b.jpg"]),
    }),
    { mainFrom: "thumb_b.jpg", variants: ["thumb_c.jpg"], repaired: false },
  );
  // The grid passes: nothing moves, a failed test design is dropped.
  assert.deepEqual(
    thumbOutcome({ main: "thumb.jpg", variants, bad: new Set(["thumb_c.jpg"]) }),
    { variants: ["thumb_b.jpg"], repaired: false },
  );
  // Nothing passes: the main thumbnail stays.
  assert.deepEqual(
    thumbOutcome({ main: "thumb.jpg", variants: [], bad: new Set(["thumb.jpg"]) }),
    { variants: [], repaired: false },
  );
  assert.deepEqual(repairPictures(["a", "b", "c"]), ["b", "c", "a"]);
  assert.deepEqual(repairPictures(["a"]), ["a"]);
});

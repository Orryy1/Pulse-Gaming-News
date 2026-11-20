import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOARD_H,
  BOARD_W,
  NEIGHBOUR_FRAMES,
  corkLayout,
  crumpleSeed,
  drawFrames,
  letterJitter,
  peelAngle,
  peelDistance,
  peelRegion,
  planSketchShots,
  polygonArea,
  polygonCss,
  sketchTreatment,
  stepJitter,
  stepOf,
  sweepBands,
  sweepFront,
  tornTopPolygon,
  washFrames,
} from "../src/render/sketchplan.ts";
import type { LongShot } from "../src/render/longplan.ts";

const solo = { run: { index: 0, length: 1 } };

test("a run of three or more sketches in a chapter pins up on the cork board", () => {
  assert.equal(
    sketchTreatment(1, 180, { run: { index: 0, length: 3 } }),
    "corkBoard",
  );
  assert.equal(
    sketchTreatment(1, 180, {
      run: { index: 2, length: 4 },
      nextKind: "photo",
    }),
    "corkBoard",
  );
});

test("the second of a close pair flips in as a flipbook page", () => {
  assert.equal(
    sketchTreatment(1, 180, { run: { index: 1, length: 2 } }),
    "flipbook",
  );
  assert.notEqual(
    sketchTreatment(1, 180, { run: { index: 0, length: 2 } }),
    "flipbook",
  );
});

test("a sketch a real picture of the same chapter follows becomes it on the light table", () => {
  assert.equal(
    sketchTreatment(1, 180, { ...solo, nextKind: "photo" }),
    "lightTable",
  );
  assert.equal(
    sketchTreatment(1, 180, {
      ...solo,
      nextKind: "screenshot",
      nextSameChapter: true,
    }),
    "lightTable",
  );
  // A clip, another sketch, a plate or the next chapter's picture: no.
  assert.notEqual(
    sketchTreatment(1, 180, { ...solo, nextKind: "clip" }),
    "lightTable",
  );
  assert.notEqual(
    sketchTreatment(1, 180, { ...solo, nextKind: "sketch" }),
    "lightTable",
  );
  assert.notEqual(sketchTreatment(1, 180, { ...solo }), "lightTable");
  assert.notEqual(
    sketchTreatment(1, 180, {
      ...solo,
      nextKind: "photo",
      nextSameChapter: false,
    }),
    "lightTable",
  );
});

test("a solo sketch is drawn on or lands as stop motion, by seed, never twice the same in a row", () => {
  const picks = new Set<string>();
  for (let seed = 1; seed < 40; seed++) {
    const t = sketchTreatment(seed, 180, solo);
    assert.ok(t === "drawOn" || t === "stopMotion");
    picks.add(t);
    assert.equal(sketchTreatment(seed, 180, solo), t, "deterministic");
    assert.notEqual(sketchTreatment(seed, 180, { ...solo, previous: t }), t);
  }
  assert.equal(picks.size, 2, "both treatments come up across seeds");
  // Too short to draw in: stop motion.
  assert.equal(sketchTreatment(1, 40, solo), "stopMotion");
});

test("the lines draw for about 60% of the shot, between 1.2 and 4 seconds, then a second of wash", () => {
  assert.equal(drawFrames(180), 108);
  assert.equal(drawFrames(30), 36);
  assert.equal(drawFrames(900), 120);
  assert.equal(washFrames(180, 108), 30);
  assert.equal(washFrames(60, 36), 24);
  assert.equal(washFrames(40, 36), 6);
});

const shot = (
  start: number,
  end: number,
  segment: number,
  media: LongShot["media"],
): LongShot => ({
  start,
  end,
  segment,
  media,
  move: "pushIn",
});
const img = (index: number) => ({ type: "image" as const, index });

test("the plan groups sketch shots into runs by chapter and the 20 s rule, and knows the picture after", () => {
  const images = [
    { kind: "sketch" }, // 0
    { kind: "photo" }, // 1
    { kind: "sketch" }, // 2
    { kind: "sketch" }, // 3
    { kind: "sketch" }, // 4
    { kind: "sketch" }, // 5
    { kind: "screenshot" }, // 6
  ];
  const shots: LongShot[] = [
    shot(0, 180, 0, img(0)), // solo, then a photo of the same chapter: light table
    shot(180, 360, 0, img(1)),
    shot(360, 540, 1, img(2)), // chapter 1: a run of three (cork board)
    shot(540, 720, 1, { type: "clip", index: 0 }),
    shot(720, 900, 1, img(3)),
    shot(900, 1080, 1, img(4)),
    shot(1080 + NEIGHBOUR_FRAMES + 1, 1080 + NEIGHBOUR_FRAMES + 181, 1, img(5)), // too far: a new run
    shot(
      1080 + NEIGHBOUR_FRAMES + 181,
      1080 + NEIGHBOUR_FRAMES + 361,
      2,
      img(6),
    ), // next chapter's picture
  ];
  const chapterOf = (segment: number) => segment;
  const plan = planSketchShots(shots, images, chapterOf, 5);
  assert.deepEqual([...plan.keys()], [0, 2, 4, 5, 6]);
  assert.equal(plan.get(0)!.treatment, "lightTable");
  assert.deepEqual(plan.get(0)!.next, { image: 1, kind: "photo" });
  assert.equal(plan.get(0)!.page, 1);
  for (const i of [2, 4, 5]) assert.equal(plan.get(i)!.treatment, "corkBoard");
  assert.deepEqual(plan.get(5)!.earlier, [2, 3]);
  assert.equal(plan.get(5)!.page, 3);
  // The last sketch: a new run (too long after), and the screenshot after it is the next chapter's.
  const last = plan.get(6)!;
  assert.equal(last.page, 1);
  assert.deepEqual(last.earlier, []);
  assert.ok(last.treatment === "drawOn" || last.treatment === "stopMotion");
  // Deterministic, and another base seed may differ but still plans the same shots.
  assert.deepEqual(planSketchShots(shots, images, chapterOf, 5), plan);
  assert.deepEqual(
    [...planSketchShots(shots, images, chapterOf, 9).keys()],
    [0, 2, 4, 5, 6],
  );
});

test("a pair twenty seconds apart in one chapter makes the second a flipbook page", () => {
  const images = [{ kind: "sketch" }, { kind: "sketch" }, { kind: "sketch" }];
  const shots = [
    shot(0, 150, 0, img(0)),
    shot(150, 150 + NEIGHBOUR_FRAMES, 0, { type: "clip", index: 0 }),
    shot(150 + NEIGHBOUR_FRAMES, 300 + NEIGHBOUR_FRAMES, 0, img(1)),
    // The same gap, but a chapter boundary between: a solo again.
    shot(300 + NEIGHBOUR_FRAMES, 450 + NEIGHBOUR_FRAMES, 1, img(2)),
  ];
  const plan = planSketchShots(shots, images, (s) => s);
  assert.equal(plan.get(2)!.treatment, "flipbook");
  assert.deepEqual(plan.get(2)!.earlier, [0]);
  assert.equal(plan.get(2)!.page, 2);
  assert.notEqual(plan.get(3)!.treatment, "flipbook");
});

test("stop motion steps at 12 pictures a second with a small repeatable nudge and a boiling crumple", () => {
  assert.equal(stepOf(0), 0);
  assert.equal(stepOf(2), 0);
  assert.equal(stepOf(3), 1);
  assert.equal(stepOf(30), 12);
  const j = stepJitter(4, 3);
  assert.deepEqual(stepJitter(4, 3), j);
  assert.ok(Math.abs(j.x) <= 5 && Math.abs(j.y) <= 4 && Math.abs(j.rot) <= 0.9);
  assert.notDeepEqual(stepJitter(4, 4), j);
  // Four crumple variants per sketch, changing every two steps, never another sketch's.
  const seeds = new Set<number>();
  for (let f = 0; f < 60; f++) seeds.add(crumpleSeed(7, f));
  assert.equal(seeds.size, 4);
  assert.equal(crumpleSeed(7, 0), crumpleSeed(7, 4));
  assert.notEqual(crumpleSeed(7, 0), crumpleSeed(7, 5));
  assert.ok(!seeds.has(crumpleSeed(8, 0)));
});

test("the draw-on sweep reveals band after band, alternating direction, and the pencil rides its front", () => {
  assert.deepEqual(sweepBands(0, 4), [0, 0, 0, 0]);
  assert.deepEqual(sweepBands(1, 4), [1, 1, 1, 1]);
  assert.deepEqual(sweepBands(0.375, 4), [1, 0.5, 0, 0]);
  let prev = sweepBands(0, 4);
  for (let p = 0.05; p <= 1; p += 0.05) {
    const cur = sweepBands(p, 4);
    cur.forEach((v, k) => assert.ok(v >= prev[k]!, "monotonic"));
    prev = cur;
  }
  assert.deepEqual(sweepFront(0.125, 4), { band: 0, x: 0.5, dir: 1 });
  assert.deepEqual(sweepFront(0.375, 4), { band: 1, x: 0.5, dir: -1 });
  assert.equal(sweepFront(1, 4).band, 3);
});

test("the page peel from the bottom-right corner shrinks the page to nothing along the diagonal", () => {
  const w = 1240;
  const h = 698;
  const L = Math.hypot(w, h);
  const whole = peelRegion(w, h, 0, Infinity);
  assert.equal(whole.length, 4);
  assert.ok(Math.abs(polygonArea(whole) - w * h) < 1e-6);
  let prevArea = w * h;
  for (let d = 50; d < L; d += 50) {
    const a = polygonArea(peelRegion(w, h, d, Infinity));
    assert.ok(a < prevArea, `area shrinks at ${d}`);
    prevArea = a;
  }
  assert.equal(peelRegion(w, h, L + 1, Infinity).length, 0);
  // A band is the difference of two peels.
  const band = polygonArea(peelRegion(w, h, 200, 300));
  const outer = polygonArea(peelRegion(w, h, 200, Infinity));
  const inner = polygonArea(peelRegion(w, h, 300, Infinity));
  assert.ok(Math.abs(band - (outer - inner)) < 1e-6);
  assert.match(polygonCss(whole), /^polygon\(0\.0px 0\.0px, 1240\.0px 0\.0px/);
  assert.equal(polygonCss([]), "polygon(0 0, 0 0, 0 0)");
  // The gradient that runs along the same diagonal points up and to the left.
  assert.ok(peelAngle(w, h) < -45 && peelAngle(w, h) > -90);
  // The peel reaches past the far corner by the last step and never runs backwards far.
  assert.ok(peelDistance(w, h, 9, 9, 1) > L);
  assert.equal(peelDistance(w, h, 0, 9, 1), 0);
  assert.equal(peelDistance(w, h, 4, 9, 1), peelDistance(w, h, 4, 9, 1));
});

test("the cork board keeps the earlier sketches clear of the newest and inside the board", () => {
  const rect = (p: { x: number; y: number; w: number }) => {
    const h = p.w / (1280 / 720);
    return {
      x1: p.x - p.w / 2,
      x2: p.x + p.w / 2,
      y1: p.y - h / 2,
      y2: p.y + h / 2,
    };
  };
  const overlaps = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) =>
    a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
  for (let seed = 1; seed < 30; seed++) {
    const { newest, earlier } = corkLayout(seed, 8);
    assert.equal(earlier.length, 6, "six slots at most");
    const n = rect(newest);
    assert.ok(n.x1 > 0 && n.x2 < BOARD_W && n.y1 > 0 && n.y2 < BOARD_H);
    for (const e of earlier) {
      const r = rect(e);
      assert.ok(
        !overlaps(n, r),
        `seed ${seed}: an earlier sketch sits under the newest`,
      );
      assert.ok(
        r.x1 >= -10 &&
          r.x2 <= BOARD_W + 10 &&
          r.y1 >= -10 &&
          r.y2 <= BOARD_H + 10,
      );
      assert.ok(Math.abs(e.rot) <= 5);
    }
    for (let i = 0; i < earlier.length; i++)
      for (let j = i + 1; j < earlier.length; j++)
        assert.ok(
          !overlaps(rect(earlier[i]!), rect(earlier[j]!)),
          "earlier ones clear of each other",
        );
  }
  assert.deepEqual(corkLayout(3, 2), corkLayout(3, 2));
  assert.notDeepEqual(corkLayout(3, 2).newest, corkLayout(4, 2).newest);
  assert.equal(corkLayout(3, 0).earlier.length, 0);
});

test("hand lettering and torn edges are seeded and bounded", () => {
  const j = letterJitter(2, 5);
  assert.deepEqual(letterJitter(2, 5), j);
  assert.ok(Math.abs(j.rot) <= 4.5 && Math.abs(j.dy) <= 2);
  assert.notDeepEqual(letterJitter(2, 6), j);
  const torn = tornTopPolygon(3, 720, 420);
  assert.deepEqual(torn[0], [0, 420]);
  assert.deepEqual(torn[torn.length - 1], [720, 420]);
  assert.deepEqual(torn[1], [0, 0]);
  assert.ok(torn.length > 10);
  for (const [x, y] of torn.slice(1, -1))
    assert.ok(x >= 0 && x <= 720 && y >= 0 && y <= 14 * 1.3);
  assert.notDeepEqual(tornTopPolygon(4, 720, 420), torn);
});

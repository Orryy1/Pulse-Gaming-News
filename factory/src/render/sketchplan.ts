// How a concept sketch (src/assets/illustrate.ts) arrives on screen in a documentary. A static framed
// print read as a stock picture; the owner asked for the sketches to feel made (30 Oct 2026: "animated
// showing them being sketched out on paper, stop motion animation on constantly different crumpled paper,
// flipbook animations"). This module is the pure half: which treatment each sketch shot gets, from the
// shots around it and a seed, and the geometry the treatments share (the draw-on sweep, the page peel,
// the cork board layout, the 12 fps stepping). The components live in components/SketchShot.tsx.
// Everything here is a pure function of its inputs, so a render repeats exactly.

import { rand } from "./components/packs/screen/common.ts";
import type { LongShot } from "./longplan.ts";

export type SketchTreatment =
  | "drawOn"
  | "stopMotion"
  | "flipbook"
  | "lightTable"
  | "corkBoard";

export const SKETCH_TREATMENTS: readonly SketchTreatment[] = [
  "drawOn",
  "stopMotion",
  "flipbook",
  "lightTable",
  "corkBoard",
];

/** Two sketch shots of one chapter this close (frames, 20 s at 30 fps) belong to one run. */
export const NEIGHBOUR_FRAMES = 600;
/** Picture kinds that are a real thing photographed or captured, never drawn. */
export const REAL_KINDS: ReadonlySet<string> = new Set([
  "photo",
  "screenshot",
  "hero",
  "header",
  "capsule",
  "article",
]);
/** The sketch image's own size (src/assets/illustrate.ts): 16:9. */
export const SKETCH_ASPECT = 1280 / 720;

/** What a sketch shot knows about its neighbours. */
export interface SketchContext {
  /** Sketch shots of one chapter within NEIGHBOUR_FRAMES of each other: this one's place in that run. */
  run: { index: number; length: number };
  /** The shot straight after: an image's kind, "clip" for footage, undefined for a plate or the end. */
  nextKind?: string;
  /** Whether that next shot is still this chapter's (a chapter card between them breaks the link). */
  nextSameChapter?: boolean;
  /** The treatment of the sketch before this one in the video, however far back. */
  previous?: SketchTreatment;
}

/**
 * The treatment for one sketch. A run of three or more in a chapter pins up on the cork board; the second
 * and later of a pair flip in as flipbook pages; a sketch that a real picture of the same chapter follows
 * dissolves into it on the light table; everything else is drawn on or lands as stop-motion paper, a seeded
 * pick that never repeats the sketch before it. A shot too short to draw in (under 1.5 s) takes stop motion.
 */
export function sketchTreatment(
  seed: number,
  lenFrames: number,
  ctx: SketchContext,
): SketchTreatment {
  if (ctx.run.length >= 3) return "corkBoard";
  if (ctx.run.index >= 1) return "flipbook";
  if (
    ctx.nextKind &&
    REAL_KINDS.has(ctx.nextKind) &&
    ctx.nextSameChapter !== false
  )
    return "lightTable";
  if (lenFrames < 45) return "stopMotion";
  const solo: SketchTreatment[] = ["drawOn", "stopMotion"];
  const pick = solo[Math.floor(rand(seed) * solo.length) % solo.length]!;
  if (pick === ctx.previous) return solo.find((t) => t !== pick)!;
  return pick;
}

/** Frames the lines take to draw on: about 60% of the shot, 1.2 s at least, 4 s at most. */
export function drawFrames(lenFrames: number): number {
  return Math.round(Math.max(36, Math.min(120, 0.6 * lenFrames)));
}

/** Frames the shading and wash fade in under the lines once drawn: a second, or what is left. */
export function washFrames(lenFrames: number, draw: number): number {
  return Math.max(6, Math.min(30, lenFrames - draw));
}

/** A sketch shot's plan: its treatment and the pictures the treatment needs. */
export interface SketchDecision {
  treatment: SketchTreatment;
  seed: number;
  /** This sketch's place in its run, from 1 (the flipbook's page number). */
  page: number;
  /** The run's earlier sketches (image indices), oldest first: under the flipbook page, pinned on the board. */
  earlier: number[];
  /** The light table: the real picture of the same chapter the sketch becomes. */
  next?: { image: number; kind: string };
}

/**
 * Every sketch shot of a plan with its treatment. Runs are sketch shots of one chapter that start within
 * NEIGHBOUR_FRAMES of the previous sketch's end; the solo pick alternates through the whole video.
 */
export function planSketchShots(
  shots: readonly LongShot[],
  images: ReadonlyArray<{ kind: string }>,
  chapterOf: (segment: number) => number,
  baseSeed = 0,
): Map<number, SketchDecision> {
  const out = new Map<number, SketchDecision>();
  // Runs: arrays of shot indices.
  const runs: number[][] = [];
  let last: { end: number; chapter: number } | undefined;
  shots.forEach((s, i) => {
    if (s.media.type !== "image" || images[s.media.index]?.kind !== "sketch")
      return;
    const chapter = chapterOf(s.segment);
    if (
      last &&
      last.chapter === chapter &&
      s.start - last.end <= NEIGHBOUR_FRAMES
    )
      runs[runs.length - 1]!.push(i);
    else runs.push([i]);
    last = { end: s.end, chapter };
  });
  let previous: SketchTreatment | undefined;
  for (const run of runs) {
    run.forEach((i, k) => {
      const s = shots[i]!;
      const after = shots[i + 1];
      const nextImage =
        after && after.media.type === "image"
          ? images[after.media.index]
          : undefined;
      const nextKind = after?.media.type === "clip" ? "clip" : nextImage?.kind;
      const seed = (baseSeed * 7919 + s.media.index * 131 + s.start) | 0;
      const treatment = sketchTreatment(seed, s.end - s.start, {
        run: { index: k, length: run.length },
        nextKind,
        nextSameChapter: after
          ? chapterOf(after.segment) === chapterOf(s.segment)
          : undefined,
        previous,
      });
      previous = treatment;
      out.set(i, {
        treatment,
        seed,
        page: k + 1,
        earlier: run.slice(0, k).map((j) => shots[j]!.media.index),
        next:
          treatment === "lightTable" && after && nextImage
            ? { image: after.media.index, kind: nextImage.kind }
            : undefined,
      });
    });
  }
  return out;
}

/** Frames between steps: 12 pictures a second at 30 fps, the stop-motion cadence. */
export const STEP_FRAMES = 2.5;
/** Which stop-motion step a frame falls in. */
export const stepOf = (frame: number) => Math.floor(frame / STEP_FRAMES);

/** The small seeded nudge a sheet gets at a step: a few pixels and under a degree, as hands reposition it. */
export function stepJitter(
  seed: number,
  step: number,
): { x: number; y: number; rot: number } {
  const r = (i: number) => rand(seed * 97 + step * 7 + i) * 2 - 1;
  return { x: r(1) * 5, y: r(2) * 4, rot: r(3) * 0.9 };
}

/** The crumple texture's seed at a frame: one of four per sketch, re-rolled every two steps so the paper boils. */
export function crumpleSeed(seed: number, frame: number): number {
  return (Math.abs(seed) % 1000) * 4 + (Math.floor(stepOf(frame) / 2) % 4);
}

/**
 * The draw-on sweep: `bands` horizontal bands revealed in turn, each swept across (left to right, then
 * right to left, as a hand hatches a page). For progress 0..1, each band's revealed share 0..1.
 */
export function sweepBands(progress: number, bands: number): number[] {
  const p = Math.max(0, Math.min(1, progress)) * bands;
  return Array.from({ length: bands }, (_, k) =>
    Math.max(0, Math.min(1, p - k)),
  );
}

/** Where the pencil is at a progress: the band being drawn and the front's x (0..1 of the width, by direction). */
export function sweepFront(
  progress: number,
  bands: number,
): { band: number; x: number; dir: 1 | -1 } {
  const shares = sweepBands(progress, bands);
  let band = shares.findIndex((s) => s < 1);
  if (band < 0) band = bands - 1;
  const dir: 1 | -1 = band % 2 ? -1 : 1;
  const share = shares[band]!;
  return { band, x: dir > 0 ? share : 1 - share, dir };
}

export type Pt = [number, number];

/**
 * A page peel from the bottom-right corner: the part of a w by h rectangle whose distance along the diagonal
 * (from that corner towards the top-left) lies in [lo, hi], as a polygon. Clockwise from the top-left.
 */
export function peelRegion(w: number, h: number, lo: number, hi: number): Pt[] {
  const L = Math.hypot(w, h);
  const t = (p: Pt) => ((w - p[0]) * w + (h - p[1]) * h) / L;
  const clip = (
    poly: Pt[],
    inside: (p: Pt) => boolean,
    edge: (a: Pt, b: Pt) => Pt,
  ) => {
    const out: Pt[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const ia = inside(a);
      const ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(edge(a, b));
    }
    return out;
  };
  // Where the segment a-b crosses distance d along the diagonal.
  const cross =
    (d: number) =>
    (a: Pt, b: Pt): Pt => {
      const ta = t(a);
      const tb = t(b);
      const f = tb === ta ? 0 : (d - ta) / (tb - ta);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    };
  let poly: Pt[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  poly = clip(poly, (p) => t(p) >= lo, cross(lo));
  if (!poly.length) return poly;
  poly = clip(poly, (p) => t(p) <= hi, cross(hi));
  return poly;
}

/** Shoelace area of a polygon. */
export function polygonArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/** A polygon as a CSS clip-path; an empty one hides everything. */
export function polygonCss(poly: readonly Pt[]): string {
  if (poly.length < 3) return "polygon(0 0, 0 0, 0 0)";
  return `polygon(${poly.map((p) => `${p[0].toFixed(1)}px ${p[1].toFixed(1)}px`).join(", ")})`;
}

/** The CSS gradient angle (deg) that runs from a w by h box's bottom-right corner to its top-left. */
export function peelAngle(w: number, h: number): number {
  return (Math.atan2(-w, h) * 180) / Math.PI;
}

/** A page's peel progress at a stepped time: eased, with a hand's unevenness, never past the diagonal. */
export function peelDistance(
  w: number,
  h: number,
  step: number,
  steps: number,
  seed: number,
): number {
  const L = Math.hypot(w, h);
  if (step <= 0) return 0;
  if (step >= steps) return L * 1.2;
  const x = Math.max(0, step) / steps;
  const eased = x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
  const uneven = (rand(seed * 31 + step) - 0.5) * 0.06;
  return L * 1.2 * Math.max(0, Math.min(1, eased + uneven * (1 - x)));
}

export interface BoardPlace {
  x: number; // centre
  y: number;
  w: number;
  rot: number; // degrees
}

export const BOARD_W = 1920;
export const BOARD_H = 1080;
/** The newest sketch on the board: this wide before the camera pushes in on it. */
export const BOARD_NEWEST_W = 940;
/** Earlier sketches on the board, small against the sides. */
export const BOARD_EARLIER_W = 440;
const BOARD_SLOTS: Array<[number, number]> = [
  [220, 200],
  [1700, 200],
  [220, 540],
  [1700, 540],
  [220, 880],
  [1700, 880],
];

/**
 * Where the sketches sit on the cork board: the newest near the middle with a seeded nudge and tilt, the
 * earlier ones (the last six at most, oldest first) in seeded order along the sides, each with its own tilt.
 */
export function corkLayout(
  seed: number,
  earlierCount: number,
): { newest: BoardPlace; earlier: BoardPlace[] } {
  const r = (i: number) => rand(seed * 53 + i);
  const newest: BoardPlace = {
    x: BOARD_W / 2 + (r(1) - 0.5) * 60,
    y: BOARD_H / 2 + (r(2) - 0.5) * 40,
    w: BOARD_NEWEST_W,
    rot: (r(3) - 0.5) * 4,
  };
  // A seeded order of the six slots: the earlier sketches take them in turn.
  const order = BOARD_SLOTS.map((s, i) => ({ s, k: r(10 + i) })).sort(
    (a, b) => a.k - b.k,
  );
  const n = Math.min(earlierCount, BOARD_SLOTS.length);
  const earlier = Array.from({ length: n }, (_, i) => {
    const [x, y] = order[i]!.s;
    return {
      x: x + (r(20 + i) - 0.5) * 20,
      y: y + (r(30 + i) - 0.5) * 20,
      w: BOARD_EARLIER_W,
      rot: (r(40 + i) - 0.5) * 10,
    };
  });
  return { newest, earlier };
}

/** The per-letter wobble of hand lettering: a tilt and a lift, seeded so a word always sits the same way. */
export function letterJitter(
  seed: number,
  i: number,
): { rot: number; dy: number } {
  return {
    rot: (rand(seed * 17 + i * 3) - 0.5) * 9,
    dy: (rand(seed * 17 + i * 3 + 1) - 0.5) * 4,
  };
}

/**
 * A sheet torn off a pad: a clip-path polygon whose top edge is ragged (points every `pitch` px, nicked
 * down by up to `depth` px) and whose other three edges are straight. px, for a w by h sheet.
 */
export function tornTopPolygon(
  seed: number,
  w: number,
  h: number,
  depth = 14,
  pitch = 36,
): Pt[] {
  const pts: Pt[] = [[0, h]];
  const n = Math.max(2, Math.round(w / pitch));
  for (let k = 0; k <= n; k++) {
    const x = (k / n) * w;
    const nick = k === 0 || k === n ? 0 : rand(seed * 11 + k) * depth;
    pts.push([x, nick + (k % 2 ? depth * 0.3 : 0)]);
  }
  pts.push([w, h]);
  return pts;
}

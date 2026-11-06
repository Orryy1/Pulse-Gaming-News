// Shared bits for the Game pack: seeded randomness, text clean-up, type sizing by length and the
// geometry helpers the node-and-path styles use. Everything is a pure function of its inputs.
import type React from "react";
import { Easing } from "remotion";
import { displayText } from "../../../timeline.ts";

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;
export const easeOut = Easing.out(Easing.cubic);
export const easeInOut = Easing.inOut(Easing.cubic);
export const easeOutBack = Easing.out(Easing.back(1.6));

/** Seeded random numbers (mulberry32): the same variant always draws the same scatter. */
export function seeded(seed: number): () => number {
  let a = (Math.floor(Math.abs(seed)) * 2654435761 + 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A line from the graphic, tidied for the screen: single spaces, "percent" as %, nothing undefined. */
export const clean = (t: string | undefined): string =>
  displayText((t ?? "").replace(/\s+/g, " ").trim());

export const wordCount = (t: string): number =>
  t.split(/\s+/).filter(Boolean).length;

/** The size of the first step whose length limit the text is within, else the last step's size. */
export function bySize(text: string, steps: Array<[number, number]>): number {
  for (const [max, size] of steps) if (text.length <= max) return size;
  return steps[steps.length - 1]?.[1] ?? 32;
}

/** Clamp a block of text to n lines (Chromium's line clamp), a last guard against overflow. */
export const clampLines = (n: number): React.CSSProperties => ({
  display: "-webkit-box",
  WebkitLineClamp: n,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
});

/**
 * Lines a text needs at a width, by greedy word wrap on an estimated glyph width (em is the average
 * advance as a share of the font size: about 0.58 for Inter 900 mixed case, 0.7 upper case).
 */
export function linesNeeded(
  text: string,
  width: number,
  size: number,
  em = 0.6,
): number {
  const perLine = Math.max(1, Math.floor(width / (size * em)));
  let lines = 1;
  let used = 0;
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (w.length > perLine) return 99; // one word wider than the box: never fits
    if (used === 0) used = w.length;
    else if (used + 1 + w.length <= perLine) used += 1 + w.length;
    else {
      lines += 1;
      used = w.length;
    }
  }
  return lines;
}

/** The longest single word, for type that must not break a word. */
export const longestWord = (t: string): number =>
  t.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0);

export type Pt = { x: number; y: number };

/** Length of a polyline. */
export function polyLength(pts: Pt[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    L += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return L;
}

/** The point a distance d along a polyline. */
export function pointAt(pts: Pt[], d: number): Pt {
  let left = Math.max(0, d);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= seg || i === pts.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, left / seg);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= seg;
  }
  return pts[0] ?? { x: 0, y: 0 };
}

export const svgPath = (pts: Pt[]): string =>
  pts
    .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

/** A polygon with its corners cut (a chamfer), as an SVG points string. */
export function chamferPoints(
  x: number,
  y: number,
  w: number,
  h: number,
  c: number,
): string {
  const p: Array<[number, number]> = [
    [x + c, y],
    [x + w - c, y],
    [x + w, y + c],
    [x + w, y + h - c],
    [x + w - c, y + h],
    [x + c, y + h],
    [x, y + h - c],
    [x, y + c],
  ];
  return p.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ");
}

/** A CSS clip-path with cut corners, for plates and tabs. */
export const chamferClip = (c: number): string =>
  `polygon(${c}px 0, calc(100% - ${c}px) 0, 100% ${c}px, 100% calc(100% - ${c}px), calc(100% - ${c}px) 100%, ${c}px 100%, 0 calc(100% - ${c}px), 0 ${c}px)`;

/** A smooth closed blob through points around a centre (Catmull-Rom turned into cubic Beziers). */
export function blobPath(
  cx: number,
  cy: number,
  r: number,
  rand: () => number,
  points = 9,
  wobble = 0.28,
): string {
  const pts: Pt[] = Array.from({ length: points }, (_, i) => {
    const a = (i / points) * Math.PI * 2 + rand() * 0.25;
    const rr = r * (1 - wobble / 2 + rand() * wobble);
    return { x: cx + Math.cos(a) * rr * 1.25, y: cy + Math.sin(a) * rr * 0.85 };
  });
  const at = (i: number) => pts[((i % points) + points) % points]!;
  let d = `M${at(0).x.toFixed(1)} ${at(0).y.toFixed(1)}`;
  for (let i = 0; i < points; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return `${d} Z`;
}

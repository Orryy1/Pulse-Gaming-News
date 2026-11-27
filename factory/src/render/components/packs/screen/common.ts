// Shared helpers for the Screen pack (../GfxScreen.tsx): text clean-up, row parsing, seeded randomness
// and a few easings. Everything is a pure function of its inputs, so renders repeat exactly.
import { displayText } from "../../../timeline.ts";

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

/** System monospace faces (no mono font ships in public/fonts): Consolas on Windows, Menlo on a Mac. */
export const MONO =
  "Consolas, 'Lucida Console', Menlo, Monaco, 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New', monospace";

/** Text from the graphic as it goes on screen: percent as %, no long dashes, tidy spaces. */
export function txt(t: string | undefined): string {
  return displayText(t ?? "")
    .replace(new RegExp("\\s*[\\u2014\\u2015]\\s*", "g"), ", ")
    .replace(/\s+/g, " ")
    .trim();
}

export const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;

/** A repeatable 0..1 number from an integer seed (one mulberry32 step). */
export function rand(seed: number): number {
  let t = (Math.floor(seed) + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const easeOut = (x: number) => 1 - (1 - x) ** 3;
export const easeInOut = (x: number) =>
  x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;

/** The first size whose length limit the text fits under; the last size for anything longer. */
export function sizeByLength(
  length: number,
  steps: Array<[maxLength: number, size: number]>,
): number {
  for (const [max, size] of steps) if (length <= max) return size;
  return steps[steps.length - 1]![1];
}

/** "label: value" rows, cleaned; undefined when any item has no label or no value. */
export function specRows(
  items: string[],
): Array<{ a: string; b: string }> | undefined {
  const rows: Array<{ a: string; b: string }> = [];
  for (const x of items) {
    const i = x.indexOf(":");
    if (i <= 0) return undefined;
    const a = txt(x.slice(0, i));
    const b = txt(x.slice(i + 1));
    if (!a || !b) return undefined;
    rows.push({ a, b });
  }
  return rows;
}

/** "2013: GTA V launches" rows; undefined when any item lacks a four-digit year or an event. */
export function yearRows(
  items: string[],
): Array<{ year: string; what: string }> | undefined {
  const rows: Array<{ year: string; what: string }> = [];
  for (const x of items) {
    const i = x.indexOf(":");
    if (i <= 0) return undefined;
    const year = x.slice(0, i).trim();
    const what = txt(x.slice(i + 1));
    if (!/^\d{4}$/.test(year) || !what) return undefined;
    rows.push({ year, what });
  }
  return rows;
}

/**
 * How fast a build plays: 1 at a full hold (about 200 frames), down to 0.5 for a short moment, so the
 * flipping, typing or drawing still finishes with time left to read.
 */
export const paceFor = (showFor: number) =>
  Math.min(1, Math.max(0.5, (showFor - 50) / 140));

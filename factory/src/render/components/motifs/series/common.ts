// Shared helpers for the Series motifs (../Series.tsx): text clean-up, row parsing, seeded randomness
// and the card's in and out. Everything is a pure function of its inputs, so renders repeat exactly.
import { interpolate } from "remotion";
import { displayText } from "../../../timeline.ts";

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

/** System monospace faces (no mono font ships in public/fonts). */
export const MONO =
  "Consolas, 'Lucida Console', Menlo, Monaco, 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New', monospace";
/** A typewriter face from the system. */
export const TYPEWRITER = "'Courier New', Courier, 'Nimbus Mono PS', monospace";
/** A book serif from the system, for the old-world looks. */
export const SERIF = "Georgia, 'Times New Roman', Times, serif";
/** A book serif with lining figures, for capitals and years (Georgia's figures are old-style). */
export const SERIF_CAPS = "'Times New Roman', Times, 'Liberation Serif', serif";

/** Long dashes (U+2014, U+2015), built from char codes so no source file carries one. */
const LONG_DASH = new RegExp(
  `\\s*[${String.fromCharCode(0x2014, 0x2015)}]\\s*`,
  "g",
);

/** Text from props as it goes on screen: percent as %, no long dashes, tidy spaces. */
export function txt(t: string | undefined): string {
  return displayText(t ?? "")
    .replace(LONG_DASH, ", ")
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
    if (!/^\d{4}s?$/.test(year) || !what) return undefined;
    rows.push({ year, what });
  }
  return rows;
}

/** A card's in and out: up within `inFrames`, down over the last `outFrames` of `frames`. */
export function cardFade(
  frame: number,
  frames: number,
  inFrames = 8,
  outFrames = 10,
): number {
  const total = Math.max(frames, inFrames + outFrames + 2);
  return interpolate(
    frame,
    [0, inFrames, total - outFrames, total],
    [0, 1, 1, 0],
    clamp,
  );
}

/** Initials of a name, at most two letters. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** The speaker of a quote ("Dan Houser, Rockstar co-founder"): the name, and the role after the comma. */
export function speaker(secondary: string): { name: string; role: string } {
  const who = txt(secondary);
  const i = who.indexOf(",");
  return i > 0
    ? { name: who.slice(0, i).trim(), role: who.slice(i + 1).trim() }
    : { name: who, role: "" };
}

/** Characters of `text` shown at `frame` when typing starts at `from` and runs `rate` characters a frame. */
export const typed = (
  text: string,
  frame: number,
  from: number,
  rate: number,
) =>
  text.slice(
    0,
    Math.max(0, Math.min(text.length, Math.floor((frame - from) * rate))),
  );

/** Does any of the game's names match? Title and theme both count. */
export const named = (re: RegExp, g: { title: string; theme?: string }) =>
  re.test(g.title ?? "") || re.test(g.theme ?? "");

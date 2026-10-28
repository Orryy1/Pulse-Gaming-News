// Shared helpers for the vertical Words styles (../VWords.tsx): text clean-up, the beat's rows, width
// estimates for the channel's faces (so every layout is decided before drawing and fits can refuse what
// will not draw well), seeded randomness and the Short's build and exit timing. All pure functions.
import { interpolate, Easing } from "remotion";
import { displayText } from "../../../timeline.ts";
import type { VGfxProps } from "../types.ts";

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Long dashes, written as escapes so no dash character sits in the source. */
const LONG_DASH = new RegExp(" *[\\u2013\\u2014\\u2015] *", "g");

/** Text from the beat as it goes on screen: percent as %, long dashes as commas, single spaces. */
export function txt(t: string | undefined): string {
  return displayText(t ?? "")
    .replace(LONG_DASH, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The quote without the quote marks the writer may have put round it. */
export const quoteText = (t: string) =>
  txt(t)
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .trim();

export const words = (t: string) => t.split(" ").filter(Boolean);

/**
 * A list beat's heading and items. The vertical contract carries rows in `items` with the heading in
 * `primary`; the Short's older list beat packs them into `primary` as "a | b | c" with the label in
 * `secondary`. Both read the same here.
 */
export function listOf(v: VGfxProps["v"]): {
  head: string;
  items: string[];
  raw: number;
} {
  const own = (v.items ?? []).filter((x) => x.trim());
  if (own.length)
    return {
      head: txt(v.primary),
      items: own.map(txt).filter(Boolean),
      raw: own.length,
    };
  if (v.primary.includes("|")) {
    const parts = v.primary.split("|").filter((x) => x.trim());
    return {
      head: txt(v.secondary),
      items: parts.map(txt).filter(Boolean),
      raw: parts.length,
    };
  }
  return { head: "", items: [], raw: 0 };
}

/** "2013: GTA V launches" rows (an ISO date such as 2023-12 gives its year); null if any row is not one. */
export function yearRows(
  items: string[],
): Array<{ year: string; what: string }> | null {
  const rows: Array<{ year: string; what: string }> = [];
  for (const x of items) {
    const m = x.trim().match(/^(\d{4})(?:-\d{2}){0,2}\s*[:|]\s*(.+)$/);
    if (!m) return null;
    const what = txt(m[2]);
    if (!what) return null;
    rows.push({ year: m[1]!, what });
  }
  return rows;
}

/** A stable 0..1 number for (seed, i): every "random" choice comes from here, never Math.random. */
export function rnd(seed: number, i: number): number {
  let h =
    (Math.imul(seed | 0, 0x9e3779b1) ^
      Math.imul((i | 0) + 0x632be5ab, 0x85ebca6b)) >>>
    0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** -1..1 */
export const jit = (seed: number, i: number) => rnd(seed, i) * 2 - 1;

// Width estimates in em, by character class, a little generous so a line never runs past its box.
type Face = "inter800" | "inter900" | "anton" | "marker" | "mono";
const NARROW = new Set("iljI.,:;!|'`");
const SEMI = new Set("frt()[]-/1");
const WIDE_LOWER = new Set("mw");
const WIDE_UPPER = new Set("MW@%&");

function charEm(ch: string, face: Face): number {
  if (face === "mono") return 0.6;
  const up = ch >= "A" && ch <= "Z";
  const digit = ch >= "0" && ch <= "9";
  if (face === "anton") {
    if (ch === " ") return 0.22;
    if (NARROW.has(ch)) return 0.24;
    if (WIDE_UPPER.has(ch) || WIDE_LOWER.has(ch)) return 0.66;
    if (up || digit) return 0.5;
    return 0.46;
  }
  if (face === "marker") {
    if (ch === " ") return 0.3;
    if (NARROW.has(ch)) return 0.32;
    if (WIDE_UPPER.has(ch) || WIDE_LOWER.has(ch)) return 0.86;
    if (up) return 0.7;
    if (digit) return 0.62;
    return 0.6;
  }
  const k = face === "inter900" ? 1.03 : 1;
  if (ch === " ") return 0.26 * k;
  if (NARROW.has(ch)) return 0.3 * k;
  if (SEMI.has(ch)) return 0.42 * k;
  if (WIDE_UPPER.has(ch)) return 0.98 * k;
  if (WIDE_LOWER.has(ch)) return 0.9 * k;
  if (up) return 0.73 * k;
  if (digit) return 0.64 * k;
  return 0.6 * k;
}

/** Estimated width in px of `t` in `face` at `size`, with letter spacing in px. */
export function textW(
  t: string,
  face: Face,
  size: number,
  spacing = 0,
): number {
  let em = 0;
  for (const ch of t) em += charEm(ch, face);
  return em * size * 1.04 + spacing * t.length;
}

/** Greedy word wrap to `width` px; null when a single word is wider than a line. */
export function wrap(
  t: string,
  face: Face,
  size: number,
  width: number,
  spacing = 0,
): string[] | null {
  const out: string[] = [];
  let cur = "";
  for (const w of words(t)) {
    if (textW(w, face, size, spacing) > width) return null;
    const next = cur ? `${cur} ${w}` : w;
    if (cur && textW(next, face, size, spacing) > width) {
      out.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Like wrap, but evens the lines out (no lonely last word): tries narrower widths while the line count
 * holds, and keeps the narrowest that still gives the same number of lines.
 */
export function wrapEven(
  t: string,
  face: Face,
  size: number,
  width: number,
  spacing = 0,
): string[] | null {
  const base = wrap(t, face, size, width, spacing);
  if (!base || base.length < 2) return base;
  let best = base;
  for (let w = width - 20; w > width * 0.55; w -= 20) {
    const l = wrap(t, face, size, w, spacing);
    if (!l || l.length !== base.length) break;
    best = l;
  }
  return best;
}

/** 1 until the last `n` frames of the beat, then down to 0 (ease in). */
export function exitOf(frame: number, len: number, n = 10): number {
  if (!Number.isFinite(len) || len <= n * 2) return 1;
  return interpolate(frame, [len - n, len], [1, 0], {
    ...clamp,
    easing: Easing.in(Easing.quad),
  });
}

export const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
export const easeOutQuint = (x: number) => 1 - (1 - clamp01(x)) ** 5;

/** 0..1 over [a, b] with a cubic ease out. */
export const ramp = (frame: number, a: number, b: number) =>
  easeOut((frame - a) / Math.max(1, b - a));

/** Hex accent to rgba. */
export function rgba(hex: string, a: number): string {
  const m = hex
    .replace("#", "")
    .match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return `rgba(255,107,26,${a})`;
  return `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},${a})`;
}

/** Ink or paper, whichever reads on the accent. */
export function onAccent(hex: string): string {
  const m = hex
    .replace("#", "")
    .match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "#0B0B0E";
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x!, 16) / 255) as [
    number,
    number,
    number,
  ];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.38 ? "#0B0B0E" : "#F5F5F2";
}

/** Fine paper fibres, fainter than the long-form pack's grain: a phone screen shows grain coarse. */
export const SOFT_GRAIN = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='g' x='0' y='0' width='100%' height='100%'>" +
    "<feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' seed='7' stitchTiles='stitch'/>" +
    "<feColorMatrix values='0 0 0 0 0.16  0 0 0 0 0.12  0 0 0 0 0.07  0.8 0 0 0 -0.4'/></filter>" +
    "<rect width='240' height='240' filter='url(#g)'/></svg>",
)}")`;

// Shared helpers for the vertical Words styles (../VWords.tsx): text clean-up, the beat's rows, width
// estimates for the channel's faces (so every layout is decided before drawing and fits can refuse what
// will not draw well), seeded randomness and the Short's build and exit timing. All pure functions. The
// pieces every pack shares (timing, paper, grain, ink, shadows, colour, seeded numbers) live in ../kit.ts
// and are re-exported here.
import type { VGfxProps } from "../types.ts";
import {
  INK,
  PAPER,
  PAPER_GRADIENT,
  SOFT_GRAIN,
  alpha,
  clamp,
  clamp01,
  clean,
  easeOutFn,
  easeOutQuintFn,
  exitOf,
  jit,
  onAccent,
  rgba,
  rnd,
  shadow,
} from "../kit.ts";

export {
  INK,
  PAPER,
  PAPER_GRADIENT,
  SOFT_GRAIN,
  alpha,
  clamp,
  clamp01,
  exitOf,
  jit,
  onAccent,
  rgba,
  rnd,
  shadow,
};
export const easeOut = easeOutFn;
export const easeOutQuint = easeOutQuintFn;

/** Text from the beat as it goes on screen: percent as %, long dashes as commas, single spaces. */
export const txt = (t: string | undefined) => clean(t, ", ");

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

/**
 * The words of `t` as wrap units: a hyphenated word wider than a line breaks after its hyphen
 * ("Cross-" / "play"), so one long compound never refuses a whole style.
 */
function units(
  t: string,
  face: Face,
  size: number,
  width: number,
  spacing: number,
): string[] {
  const out: string[] = [];
  for (const w of words(t)) {
    if (textW(w, face, size, spacing) <= width || !w.includes("-")) {
      out.push(w);
      continue;
    }
    const parts = w.split("-");
    parts.forEach((p, i) => out.push(i < parts.length - 1 ? `${p}-` : p));
  }
  return out.filter(Boolean);
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
  for (const w of units(t, face, size, width, spacing)) {
    if (textW(w, face, size, spacing) > width) return null;
    const joined = cur.endsWith("-") ? `${cur}${w}` : `${cur} ${w}`;
    const next = cur ? joined : w;
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

/** 0..1 over [a, b] with a cubic ease out. */
export const ramp = (frame: number, a: number, b: number) =>
  easeOut((frame - a) / Math.max(1, b - a));

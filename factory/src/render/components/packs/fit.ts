// The fidelity rules every long-video graphic shares (packs, house looks, motif styles), after the first
// run of the graphics pre-check (30 Oct 2026) muted cards for text that ran past its tape, a date card that
// ran to the frame edge, white titles over a bright sky and a timeline panel sitting on the chapter tag:
//   - a text's width is estimated per face before it is drawn, so sizes come from a measured ladder
//     (fitSize / fitBlock) and never from a character count alone;
//   - nothing important sits within SAFE_EDGE of the frame edge, and full-frame looks keep their text
//     above LOWER_THIRD, where the chapter tag, title bar and footage credit live;
//   - a label drawn over footage takes a plate or a shadow strong enough for a bright sky (plate(),
//     LEGIBLE_SHADOW);
//   - every build is fully drawn by DRAWN_BY frames, which is where the pre-check (src/qa/graphicscheck.ts)
//     looks, and where a style's own fits() may assume the viewer reads it.
// All pure functions, so tests can reproduce the exact strings the check faulted.

import type React from "react";

export const FRAME_W = 1920;
export const FRAME_H = 1080;
/** Nothing important nearer the frame edge than this (px). */
export const SAFE_EDGE = 60;
/** The band above the bottom edge where the chapter tag, title bar and footage credit sit (px). */
export const LOWER_THIRD = 150;
/** The widest a full-frame look's content may be. */
export const CONTENT_W = FRAME_W - 2 * SAFE_EDGE;
/**
 * Every style is fully drawn and readable by this frame of its moment (and its pre-check still is taken
 * at or after it, never before frame 60). Builds that take longer pace themselves to finish here.
 */
export const DRAWN_BY = 100;

/** A text shadow that keeps pale type readable over a bright sky or busy footage. */
export const LEGIBLE_SHADOW =
  "0 2px 4px rgba(0,0,0,0.9), 0 6px 18px rgba(0,0,0,0.8), 0 12px 40px rgba(0,0,0,0.7)";

/** A dark plate behind text that sits over footage; `inline` for a plate the text's own width. */
export function plate(
  opts: { inline?: boolean; pad?: string; radius?: number } = {},
): React.CSSProperties {
  return {
    display: opts.inline === false ? undefined : "inline-block",
    padding: opts.pad ?? "12px 26px",
    background: "rgba(11,11,14,0.86)",
    borderRadius: opts.radius ?? 12,
    boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
    textShadow: "0 2px 8px rgba(0,0,0,0.6)",
  };
}

/** The faces the long video sets text in (src/render/components/fonts.ts, plus the paper and screen kits). */
export type Face = "anton" | "inter" | "marker" | "mono" | "serif";

// Width estimates in em, by character class, a little generous so an estimate never says a line fits
// when it will not. Anton is the display face (capitals), Inter the read face at 800-900, Permanent
// Marker the handwriting, mono any monospace (Courier, Consolas), serif Georgia.
const NARROW = new Set("iljI.,:;!|'`");
const SEMI = new Set("frt()[]-/1");
const WIDE_LOWER = new Set("mw");
const WIDE_UPPER = new Set("MW@%&");

function charEm(ch: string, face: Face): number {
  if (face === "mono") return 0.62;
  const up = ch >= "A" && ch <= "Z";
  const digit = ch >= "0" && ch <= "9";
  if (face === "anton") {
    if (ch === " ") return 0.24;
    if (NARROW.has(ch)) return 0.26;
    if (WIDE_UPPER.has(ch) || WIDE_LOWER.has(ch)) return 0.76;
    if (up || digit) return 0.5;
    return 0.47;
  }
  if (face === "marker") {
    if (ch === " ") return 0.32;
    if (NARROW.has(ch)) return 0.34;
    if (WIDE_UPPER.has(ch) || WIDE_LOWER.has(ch)) return 0.9;
    if (up) return 0.72;
    if (digit) return 0.64;
    return 0.62;
  }
  if (face === "serif") {
    if (ch === " ") return 0.28;
    if (NARROW.has(ch)) return 0.32;
    if (WIDE_UPPER.has(ch)) return 0.98;
    if (WIDE_LOWER.has(ch)) return 0.82;
    if (up) return 0.74;
    if (digit) return 0.56;
    return 0.54;
  }
  if (ch === " ") return 0.27;
  if (NARROW.has(ch)) return 0.31;
  if (SEMI.has(ch)) return 0.43;
  if (WIDE_UPPER.has(ch)) return 1.0;
  if (WIDE_LOWER.has(ch)) return 0.92;
  if (up) return 0.74;
  if (digit) return 0.65;
  return 0.61;
}

/** Estimated width in px of `text` set in `face` at `size`, with letter spacing in px. */
export function textWidth(
  text: string,
  face: Face,
  size: number,
  spacing = 0,
): number {
  let em = 0;
  for (const ch of text) em += charEm(ch, face);
  return em * size * 1.04 + spacing * Math.max(0, text.length - 1);
}

/** Whether `text` on one line stays inside `maxWidth` px at `size`. */
export function fits(
  text: string,
  face: Face,
  size: number,
  maxWidth: number,
  spacing = 0,
): boolean {
  return textWidth(text, face, size, spacing) <= maxWidth;
}

/**
 * The first size of the ladder at which the text fits one line in `maxWidth`; the ladder's last size
 * otherwise (then the caller wraps or clips, and `fits` says so).
 */
export function fitSize(
  text: string,
  face: Face,
  maxWidth: number,
  sizes: number[],
  spacing = 0,
): { size: number; fits: boolean } {
  for (const size of sizes)
    if (fits(text, face, size, maxWidth, spacing)) return { size, fits: true };
  const last = sizes[sizes.length - 1] ?? 12;
  return { size: last, fits: fits(text, face, last, maxWidth, spacing) };
}

/** Greedy word wrap to `maxWidth` px; null when one word alone is wider than a line. */
export function wrapText(
  text: string,
  face: Face,
  size: number,
  maxWidth: number,
  spacing = 0,
): string[] | null {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (!fits(w, face, size, maxWidth, spacing)) return null;
    const next = cur ? `${cur} ${w}` : w;
    if (cur && !fits(next, face, size, maxWidth, spacing)) {
      out.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * The largest size of the ladder whose wrapped lines fit the box (at most `maxLines`, and within
 * `maxHeight` when given); the last size and its best wrap otherwise, with `fits` false.
 */
export function fitBlock(
  text: string,
  face: Face,
  o: {
    maxWidth: number;
    sizes: number[];
    maxLines?: number;
    maxHeight?: number;
    lineHeight?: number;
    spacing?: number;
  },
): { size: number; lines: string[]; fits: boolean } {
  const maxLines = o.maxLines ?? 2;
  const lh = o.lineHeight ?? 1.1;
  for (const size of o.sizes) {
    const lines = wrapText(text, face, size, o.maxWidth, o.spacing);
    if (!lines) continue;
    if (
      lines.length <= maxLines &&
      (o.maxHeight === undefined || lines.length * size * lh <= o.maxHeight)
    )
      return { size, lines, fits: true };
  }
  const last = o.sizes[o.sizes.length - 1] ?? 12;
  return {
    size: last,
    lines: wrapText(text, face, last, o.maxWidth, o.spacing) ?? [text],
    fits: false,
  };
}

/** A box (left, top, width, height) kept off the frame edges and above the lower third. */
export function insideSafe(box: {
  left: number;
  top: number;
  width: number;
  height: number;
}): boolean {
  return (
    box.left >= SAFE_EDGE &&
    box.top >= SAFE_EDGE &&
    box.left + box.width <= FRAME_W - SAFE_EDGE &&
    box.top + box.height <= FRAME_H - LOWER_THIRD
  );
}

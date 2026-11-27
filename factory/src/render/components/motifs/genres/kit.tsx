// Shared bits for the genre motifs (../Genres.tsx): the card's fade, text fitting, seeded randomness,
// pictures (plain or turned into chunky pixels on a tiny canvas), pixel letters from rectangles and a
// matcher helper. Everything is a pure function of the frame, the props and the variant.
import React, { useEffect, useRef, useState } from "react";
import {
  Easing,
  Img,
  continueRender,
  delayRender,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { displayText } from "../../../timeline.ts";
import {
  pixelNormal,
  pixelPath,
  pixelReady,
} from "../../packs/data/pixelFont.ts";
import type { MotifGame } from "../types.ts";

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;
export const easeOut = Easing.out(Easing.cubic);
export const easeIn = Easing.in(Easing.quad);
export const easeOutBack = Easing.out(Easing.back(1.7));
export const easeOutQuint = Easing.out(Easing.poly(5));

// Long and medium dashes, built from char codes so no such character sits in this file.
const LONG_DASHES = new RegExp(
  `\\s*[${String.fromCharCode(0x2014, 0x2013)}]\\s*`,
  "g",
);

/** Text from props made safe for screen: "percent" as %, long dashes as a spaced hyphen, single spaces. */
export function clean(t: string | undefined | null): string {
  return displayText(String(t ?? ""))
    .replace(LONG_DASHES, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

export const words = (t: string) => t.split(/\s+/).filter(Boolean);

/** Seeded random numbers (mulberry32): the same seed always gives the same sequence. */
export function rng(seed: number): () => number {
  let a = (Math.floor(Math.abs(seed)) * 2654435761 + 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 0..1 for a slot (frame-based noise that renders the same every time). */
export function hash(a: number, b = 0): number {
  const x = Math.sin((a + 1) * 12.9898 + (b + 1) * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** The card's frame, fps and its fade: in over `inFrames`, out over the last 10 frames. */
export function useCard(frames: number, inFrames = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const len = Math.max(30, frames || 120);
  const out = interpolate(frame, [len - 10, len], [1, 0], {
    ...clamp,
    easing: easeIn,
  });
  const fadeIn =
    inFrames > 0 ? interpolate(frame, [0, inFrames], [0, 1], clamp) : 1;
  return { frame, fps, len, opacity: out * fadeIn };
}

/** Greedy word wrap at `perLine` characters; a word longer than a line is cut across lines. */
export function wrap(text: string, perLine: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (let w of words(text)) {
    while (w.length > perLine) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      lines.push(w.slice(0, perLine));
      w = w.slice(perLine);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= perLine) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Lines a text needs at a width, by word wrap on an estimated glyph width (em: average advance / size). */
export function linesAt(
  text: string,
  width: number,
  size: number,
  em: number,
): number {
  const per = Math.max(1, Math.floor(width / (size * em)));
  if (words(text).some((w) => w.length > per)) return 99;
  return wrap(text, per).length;
}

/** The largest size in `sizes` (largest first) at which the text fits `maxLines` lines; else the last. */
export function fitSize(
  text: string,
  width: number,
  maxLines: number,
  sizes: number[],
  em: number,
): number {
  for (const s of sizes) if (linesAt(text, width, s, em) <= maxLines) return s;
  return sizes[sizes.length - 1] ?? 40;
}

/** A chapter number from the kicker ("CHAPTER 3" gives "3"), for a ROUND / LAP / LEVEL counter. */
export function chapterNumber(kicker: string | undefined): string | undefined {
  const m = clean(kicker).match(
    /\b(?:chapter|part|episode|round|lap|level|stage|act)\s*#?\s*(\d{1,2})\b/i,
  );
  return m?.[1];
}

/** A four-digit year from the props, or undefined. */
export function yearOf(year: string | undefined): string | undefined {
  const m = clean(year).match(/\b(19|20)\d\d\b/);
  return m?.[0];
}

/** Does the game's title or theme match? Titles and themes are tested apart so no match spans both. */
export function hits(game: MotifGame, ...res: RegExp[]): boolean {
  const fields = [game.title ?? "", game.theme ?? ""].map((t) =>
    t.normalize("NFD").replace(/[̀-ͯ]/g, ""),
  );
  return res.some((re) => fields.some((f) => re.test(f)));
}

/** A picture filling its box. */
export const Pic: React.FC<{
  src: string;
  style?: React.CSSProperties;
  position?: string;
}> = ({ src, style, position }) => (
  <Img
    src={src}
    style={{
      width: "100%",
      height: "100%",
      objectFit: "cover",
      objectPosition: position ?? "center",
      display: "block",
      ...style,
    }}
  />
);

/**
 * A picture as chunky pixels: drawn once onto a tiny canvas (cols x rows, cropped to cover) and shown
 * scaled up with nearest-neighbour sampling. The render waits for the draw.
 */
export const PixelPic: React.FC<{
  src: string;
  cols: number;
  rows: number;
  style?: React.CSSProperties;
}> = ({ src, cols, rows, style }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [handle] = useState(() => delayRender(`pixel picture ${src}`));
  useEffect(() => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        continueRender(handle);
      }
    };
    const img = new Image();
    img.onload = () => {
      const c = ref.current;
      const ctx = c?.getContext("2d");
      if (c && ctx && img.naturalWidth > 0) {
        const want = cols / rows;
        const have = img.naturalWidth / img.naturalHeight;
        let sw = img.naturalWidth;
        let sh = img.naturalHeight;
        if (have > want) sw = sh * want;
        else sh = sw / want;
        const sx = (img.naturalWidth - sw) / 2;
        const sy = (img.naturalHeight - sh) / 2;
        // Two steps down so the tiny picture averages its area rather than sampling single pixels.
        const mid = document.createElement("canvas");
        mid.width = cols * 4;
        mid.height = rows * 4;
        const m = mid.getContext("2d");
        if (m) {
          m.imageSmoothingEnabled = true;
          m.imageSmoothingQuality = "high";
          m.drawImage(img, sx, sy, sw, sh, 0, 0, mid.width, mid.height);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(mid, 0, 0, cols, rows);
        }
      }
      finish();
    };
    img.onerror = finish;
    img.src = src;
    return finish;
  }, [src, cols, rows, handle]);
  return (
    <canvas
      ref={ref}
      width={cols}
      height={rows}
      style={{
        width: "100%",
        height: "100%",
        imageRendering: "pixelated",
        display: "block",
        ...style,
      }}
    />
  );
};

// A 5x7 bitmap for pixel letters drawn as rectangles (the same alphabet as packs/data/pixelFont.ts,
// read through it so both stay in step). Each glyph is a list of lit cells.

const cellCache = new Map<string, Array<[number, number]>>();
/** The lit cells of one character (x 0..4, y 0..6). */
export function glyphCells(ch: string): Array<[number, number]> {
  const c = pixelNormal(ch);
  const hit = cellCache.get(c);
  if (hit) return hit;
  const d = pixelPath(c).d;
  const cells: Array<[number, number]> = [];
  const re = /M([\d.]+) ([\d.]+)h/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)))
    cells.push([Math.floor(Number(m[1])), Math.floor(Number(m[2]))]);
  cellCache.set(c, cells);
  return cells;
}

/** Can every character be drawn in pixel letters? */
export const pixelOk = (t: string) => pixelReady(t);
export { pixelNormal };

/**
 * Pixel text as one SVG path per line: cells of `cell` px, `gap` px between cells (0 for solid blocks).
 * Returns the path, the width and the height in px.
 */
export function pixelLine(
  t: string,
  cell: number,
  gap = 0,
): { d: string; w: number; h: number } {
  const s = pixelNormal(t);
  let d = "";
  const k = cell - gap;
  [...s].forEach((ch, i) => {
    for (const [x, y] of glyphCells(ch)) {
      const px = (i * 6 + x) * cell + gap / 2;
      const py = y * cell + gap / 2;
      d += `M${px} ${py}h${k}v${k}h-${k}z`;
    }
  });
  return { d, w: Math.max(0, s.length * 6 - 1) * cell, h: 7 * cell };
}

/** Pixel text wrapped to fit a box: the largest cell size (from `cells`) that fits `maxLines`. */
export function pixelFit(
  text: string,
  width: number,
  maxLines: number,
  cells: number[],
): { cell: number; lines: string[] } | undefined {
  const t = pixelNormal(clean(text));
  for (const cell of cells) {
    const per = Math.floor((width + cell) / (6 * cell));
    if (per < 1 || words(t).some((w) => w.length > per)) continue;
    const lines = wrap(t, per);
    if (lines.length <= maxLines) return { cell, lines };
  }
  return undefined;
}

/**
 * Pixel text fitted in tiers, fewest lines first: each tier is [max lines, cell sizes largest first],
 * so a heading stays on one line while its cells are still big, and wraps only when it must.
 */
export function pixelFitTiers(
  text: string,
  width: number,
  tiers: Array<[number, number[]]>,
  ok: (f: { cell: number; lines: string[] }) => boolean = () => true,
): { cell: number; lines: string[] } | undefined {
  for (const [maxLines, cells] of tiers)
    for (const c of cells) {
      const f = pixelFit(text, width, maxLines, [c]);
      if (f && ok(f)) return f;
    }
  return undefined;
}

/**
 * A stepped hill line as one SVG path `w` wide: a few seeded peaks with straight slopes, every column
 * snapped to the block size, closed down to `base`.
 */
export function steppedHills(
  step: number,
  base: number,
  lo: number,
  hi: number,
  seed: number,
  w = 1920,
): string {
  const peaks = Array.from({ length: 4 }, (_, i) => ({
    x: hash(seed, i) * w,
    h: lo + hash(seed, i + 9) * (hi - lo),
    s: 0.3 + hash(seed, i + 19) * 0.45,
  }));
  let d = `M0 ${base}`;
  for (let x = 0; x < w; x += step) {
    const cx = x + step / 2;
    // Distance measured round the tile, so the line joins itself when it scrolls.
    const h = Math.max(
      lo * 0.35,
      ...peaks.map(
        (p) => p.h - Math.min(Math.abs(cx - p.x), w - Math.abs(cx - p.x)) * p.s,
      ),
    );
    d += `V${base - Math.round(h / step) * step}H${Math.min(w, x + step)}`;
  }
  return `${d}V${base}Z`;
}

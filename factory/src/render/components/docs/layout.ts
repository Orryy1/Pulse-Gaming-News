// Pure geometry for the archive documents (./DocumentShot.tsx): where each page's key line sits, which
// characters the pen marks, where the camera pushes in and when the mark lands on the narrator's words. No
// React, so the tests check every page's layout without a renderer.
//
// Typed lines are set in a monospaced face (Courier New: every glyph 0.6 em wide), so a mark's position is
// exact in `ch` units and the camera's focus is exact in pixels: no measuring in the browser, every frame the
// same on every render.

import { fitBlock } from "../packs/fit.ts";
import { phraseAt, type DocKind, type DocScene } from "./choose.ts";

export const FPS = 30;
/** Courier's advance width in em. */
export const CH = 0.6;

export type Rect = { left: number; top: number; width: number; height: number };

export interface TypedLine {
  text: string;
  /** Offset of the line's first character in the whole text. */
  start: number;
}

/** A block of typed text with the marked phrase found on its lines. */
export interface TypedBlock {
  x: number;
  y: number;
  size: number;
  lineH: number;
  lines: TypedLine[];
  /** The marked characters per line: [line, from, to) in characters. */
  segs: Array<{ line: number; a: number; b: number }>;
  /** The block's box and the marked phrase's box, in page px. */
  box: Rect;
  markBox: Rect;
}

/** Greedy word wrap at `maxChars`, keeping each line's offset; null when one word is longer than a line. */
export function wrapChars(text: string, maxChars: number): TypedLine[] | null {
  const lines: TypedLine[] = [];
  let cur = "";
  let start = 0;
  let pos = 0;
  for (const w of text.split(" ")) {
    if (w.length > maxChars) return null;
    if (!cur) {
      cur = w;
      start = pos;
    } else if (cur.length + 1 + w.length <= maxChars) cur += ` ${w}`;
    else {
      lines.push({ text: cur, start });
      cur = w;
      start = pos;
    }
    pos += w.length + 1;
  }
  if (cur) lines.push({ text: cur, start });
  return lines;
}

/** The union of rects. */
export function union(rs: Rect[]): Rect {
  const l = Math.min(...rs.map((r) => r.left));
  const t = Math.min(...rs.map((r) => r.top));
  const r = Math.max(...rs.map((x) => x.left + x.width));
  const b = Math.max(...rs.map((x) => x.top + x.height));
  return { left: l, top: t, width: r - l, height: b - t };
}

/**
 * The text typed at (x, y) in the biggest size of the ladder that fits `maxW` by `maxH`, with the characters of
 * `mark` found on its lines. Null when nothing fits.
 */
export function typedBlock(
  text: string,
  mark: string,
  o: {
    x: number;
    y: number;
    maxW: number;
    maxH: number;
    sizes: number[];
    lineH?: number;
  },
): TypedBlock | null {
  const lh = o.lineH ?? 1.42;
  for (const size of o.sizes) {
    const lines = wrapChars(text, Math.floor(o.maxW / (size * CH)));
    const lineH = Math.round(size * lh);
    if (!lines || lines.length * lineH > o.maxH) continue;
    const at = phraseAt(text, mark) ?? [0, text.length];
    const segs: TypedBlock["segs"] = [];
    lines.forEach((ln, i) => {
      const a = Math.max(at[0], ln.start);
      const b = Math.min(at[1], ln.start + ln.text.length);
      if (b > a) segs.push({ line: i, a: a - ln.start, b: b - ln.start });
    });
    const w = Math.max(...lines.map((l) => l.text.length)) * size * CH;
    const box = { left: o.x, top: o.y, width: w, height: lines.length * lineH };
    const markBox = union(
      segs.map((s) => ({
        left: o.x + s.a * size * CH,
        top: o.y + s.line * lineH,
        width: (s.b - s.a) * size * CH,
        height: lineH,
      })),
    );
    return { x: o.x, y: o.y, size, lineH, lines, segs, box, markBox };
  }
  return null;
}

/** A proportional block (the idea wall's marker note, a clipping's headline): sized, wrapped, no char marks. */
export interface FreeBlock {
  size: number;
  lines: string[];
  box: Rect;
}

export function freeBlock(
  text: string,
  face: "marker" | "serif",
  o: {
    x: number;
    y: number;
    maxW: number;
    maxH: number;
    sizes: number[];
    lineH: number;
  },
): FreeBlock | null {
  const f = fitBlock(text, face, {
    maxWidth: o.maxW,
    sizes: o.sizes,
    maxLines: 8,
    maxHeight: o.maxH,
    lineHeight: o.lineH,
  });
  if (!f.fits) return null;
  return {
    size: f.size,
    lines: f.lines,
    box: {
      left: o.x,
      top: o.y,
      width: o.maxW,
      height: f.lines.length * f.size * o.lineH,
    },
  };
}

/**
 * When the pen marks the phrase, in frames from the shot's start: from the narrator's first word of the phrase
 * to the end of its last (word timings in seconds from the shot's start). The page has landed and the camera
 * has pushed in by frame 40, and everything is still by DRAWN_BY (100), where the graphics check looks: a
 * phrase said later is marked from frame 70 at the latest. Without timings, the mark lands at frame 48.
 */
export function markTiming(
  words: Array<{ text: string; start: number; end: number }> | undefined,
  phrase: string,
): { from: number; to: number; matched: boolean } {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9$£€%]+/g, "");
  const want = phrase.split(/\s+/).map(norm).filter(Boolean);
  let from = 48;
  let dur = 18;
  let matched = false;
  if (words?.length && want.length) {
    const ws = words.map((w) => norm(w.text));
    for (let i = 0; i + want.length <= ws.length; i++) {
      // Narrated numbers are spelt out ("nineteen ninety-five"), so a phrase matches on its first and last
      // words when the middle differs.
      const first = ws[i] === want[0];
      if (!first) continue;
      let j = i + want.length - 1;
      if (ws[j] !== want[want.length - 1]) {
        j = ws.indexOf(want[want.length - 1]!, i);
        if (j < 0 || j - i > want.length + 4) continue;
      }
      from = Math.round(words[i]!.start * FPS);
      dur = Math.round((words[j]!.end - words[i]!.start) * FPS);
      matched = true;
      break;
    }
    // The last word was said differently ("two thousand four" for 2004): a distinctive first word still
    // places the mark, about a third of a second a word.
    const i = ws.indexOf(want[0]!);
    if (!matched && i >= 0 && want[0]!.length >= 4) {
      from = Math.round(words[i]!.start * FPS);
      dur = want.length * 10;
      matched = true;
    }
  }
  const a = Math.max(40, Math.min(70, from));
  const d = Math.max(12, Math.min(22, dur));
  return { from: a, to: a + d, matched };
}

/**
 * The mark's window for this page: a contract still has its signature to write after the clause, so its
 * underline comes in earlier and quicker (done by frame 62) and the signature ends by SETTLED - 8.
 */
export function shotTiming(
  t: { from: number; to: number; matched: boolean },
  signature: boolean,
): { from: number; to: number; matched: boolean } {
  if (!signature) return t;
  const from = Math.min(t.from, 46);
  return { ...t, from, to: from + Math.min(16, Math.max(10, t.to - t.from)) };
}

/** The frame the whole move settles by: pen gone, signature done. */
export const SETTLED = 98;

/** The camera: the whole page in view as it lands, then pushed in on the line that matters. */
export interface Camera {
  /** Scale and page point at the frame centre, at rest and pushed in. */
  s0: number;
  c0: { x: number; y: number };
  s1: number;
  c1: { x: number; y: number };
}

export const FRAME_W = 1920;
export const FRAME_H = 1080;

/**
 * The overview fits the page inside the frame with room to breathe; the push-in fills about three quarters of
 * the frame's width with the focus, never more than 1.6x and always at least 1.3x the overview, and the page
 * point under the frame centre moves from the page's centre to the focus's, kept so the page still covers the
 * frame edge it is pushed toward when it can.
 */
export function camera(w: number, h: number, focus: Rect): Camera {
  const s0 = Math.min(1700 / w, 1000 / h);
  const s1 = Math.max(
    s0 * 1.3,
    Math.min(
      1.45,
      1400 / Math.max(1, focus.width),
      560 / Math.max(1, focus.height),
    ),
  );
  const fx = focus.left + focus.width / 2;
  const fy = focus.top + focus.height / 2;
  // Keep the view inside the page where it can be (a focus near an edge leaves less desk in shot).
  const halfW = FRAME_W / 2 / s1;
  const halfH = FRAME_H / 2 / s1;
  const cx = halfW * 2 >= w ? w / 2 : Math.max(halfW, Math.min(w - halfW, fx));
  const cy = halfH * 2 >= h ? h / 2 : Math.max(halfH, Math.min(h - halfH, fy));
  return { s0, c0: { x: w / 2, y: h / 2 }, s1, c1: { x: cx, y: cy } };
}

/** Which of the pen's marks a document uses. */
export type MarkStyle = "highlight" | "underline" | "ring";

export const MARK_STYLE: Record<DocKind, MarkStyle> = {
  memo: "highlight",
  design: "highlight",
  budget: "highlight",
  rota: "highlight",
  contract: "underline",
  press: "underline",
  schedule: "ring",
  manifest: "ring",
  ideas: "ring",
  reviews: "ring",
};

/** Portrait sheets for letters and pages, landscape for tables, boards for walls. */
export const PAGE_SIZE: Record<DocKind, { w: number; h: number }> = {
  memo: { w: 1100, h: 1420 },
  design: { w: 1100, h: 1420 },
  contract: { w: 1100, h: 1420 },
  press: { w: 1100, h: 1420 },
  schedule: { w: 1640, h: 1040 },
  rota: { w: 1640, h: 1040 },
  budget: { w: 1500, h: 1060 },
  manifest: { w: 1500, h: 1060 },
  ideas: { w: 1760, h: 1020 },
  reviews: { w: 1760, h: 1020 },
};

const MONO_SIZES = [60, 56, 52, 48, 45, 42, 39, 36];
const MONTH_ABBR = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
export { MONTH_ABBR };

/** Everything a page needs placed: its key line, any extras, and what the camera and pen aim at. */
export interface PageLayout {
  kind: DocKind;
  w: number;
  h: number;
  /** The typed key line (absent on the boards, which use `free`). */
  key?: TypedBlock;
  free?: FreeBlock;
  /** What the pen marks (in page px). */
  mark: Rect;
  /** What the camera pushes in on. */
  focus: Rect;
  style: MarkStyle;
  /** The schedule's milestone: its month column (0-11) and the diamond's centre. */
  milestone?: { col: number; x: number; y: number; dateLeft: boolean };
  /** The contract's signature line. */
  signature?: Rect;
  /** The design page's margin sketch. */
  sketch?: Rect;
  /** The shipping header ("SHIPPING MANIFEST") or the order's ("PURCHASE ORDER"). */
  title?: string;
}

/** The manifest's header: a shipment when the line is about discs going out, an order otherwise. */
export function manifestTitle(line: string): string {
  return /\b(ship\w*|manufactur\w*|pressed|pressing|discs?|cartridges?|pallets?|deliver\w*|went gold|gold master|warehouses?)\b/i.test(
    line,
  )
    ? "SHIPPING MANIFEST"
    : "PURCHASE ORDER";
}

const pad = (r: Rect, p: number): Rect => ({
  left: r.left - p,
  top: r.top - p,
  width: r.width + 2 * p,
  height: r.height + 2 * p,
});

/** The page's layout, or null when the line cannot be set legibly on it. */
export function layoutPage(scene: DocScene): PageLayout | null {
  const { w, h } = PAGE_SIZE[scene.kind];
  const style = MARK_STYLE[scene.kind];
  const base = { kind: scene.kind, w, h, style };
  const typed = (
    x: number,
    y: number,
    maxW: number,
    maxH: number,
    sizes = MONO_SIZES,
  ) => typedBlock(scene.line, scene.mark, { x, y, maxW, maxH, sizes });
  switch (scene.kind) {
    case "memo":
    case "press": {
      // Under the letterhead and fields (memo) or the release header (press), with placeholder text either side.
      const key = typed(96, scene.kind === "memo" ? 640 : 560, w - 192, 420);
      if (!key) return null;
      return { ...base, key, mark: key.markBox, focus: pad(key.box, 30) };
    }
    case "design": {
      const colW = scene.sketch ? 640 : w - 192;
      const key = typed(96, 560, colW, 470, [56, 52, 48, 45, 42, 39, 36, 33]);
      if (!key) return null;
      const sketch = scene.sketch
        ? { left: 780, top: 520, width: 240, height: 420 }
        : undefined;
      const focus = sketch
        ? union([pad(key.box, 24), sketch])
        : pad(key.box, 30);
      return { ...base, key, sketch, mark: key.markBox, focus };
    }
    case "contract": {
      const key = typed(150, 560, w - 246, 380, [52, 48, 45, 42, 39, 36, 33]);
      if (!key) return null;
      // The signature sits close under the clause, so the push-in holds both with the type still large.
      const sigTop = key.box.top + key.box.height + 110;
      const signature = { left: 150, top: sigTop, width: 470, height: 90 };
      return {
        ...base,
        key,
        signature,
        mark: key.markBox,
        focus: union([pad(key.box, 24), signature]),
      };
    }
    case "schedule": {
      // A month grid; the line in a callout under it, tied to the milestone's diamond.
      const col = scene.month ?? 8;
      const gridL = 300;
      const colW = (w - gridL - 70) / 12;
      // The date reads beside the diamond, on its left in the year's second half so it stays on the page.
      const dateLeft = col >= 6;
      const milestone = { col, x: gridL + colW * (col + 0.5), y: 591, dateLeft };
      const key = typed(110, 690, w - 220, 300, [52, 48, 45, 42, 39, 36]);
      if (!key) return null;
      const dateW = scene.date ? scene.date.length * 36 * CH : 0;
      const span = 40 + (dateW ? 24 + dateW : 40);
      const ringBox = {
        left: dateLeft ? milestone.x + 40 - span : milestone.x - 40,
        top: milestone.y - 50,
        width: span,
        height: 100,
      };
      return {
        ...base,
        key,
        milestone,
        mark: ringBox,
        focus: union([ringBox, pad(key.box, 20)]),
      };
    }
    case "rota": {
      const key = typed(130, 200, w - 260, 230, [50, 46, 42, 39, 36, 33]);
      if (!key) return null;
      return { ...base, key, mark: key.markBox, focus: pad(key.box, 40) };
    }
    case "budget":
    case "manifest": {
      // A table: the key row's description column takes the line.
      const descL = scene.kind === "budget" ? 110 : 330;
      const descW = scene.kind === "budget" ? 880 : 760;
      const key = typed(descL, 470, descW, 300, [48, 45, 42, 39, 36, 33]);
      if (!key) return null;
      return {
        ...base,
        key,
        title:
          scene.kind === "manifest" ? manifestTitle(scene.line) : undefined,
        mark: style === "ring" ? pad(key.markBox, 8) : key.markBox,
        // The title and the table's head stay in view as the camera pushes in on the row.
        focus: pad(union([key.box, { left: descL, top: 60, width: w - descL - 90, height: 60 }]), 20),
      };
    }
    case "ideas": {
      const note = { left: 640, top: 300, width: 520, height: 520 };
      const free = freeBlock(scene.line, "marker", {
        x: note.left + 46,
        y: note.top + 70,
        maxW: note.width - 92,
        maxH: note.height - 130,
        sizes: [64, 58, 52, 48, 44, 40, 36],
        lineH: 1.16,
      });
      if (!free) return null;
      return { ...base, free, mark: pad(note, 26), focus: pad(note, 60) };
    }
    case "reviews": {
      const clip = { left: 560, top: 250, width: 660, height: 560 };
      const free = freeBlock(scene.line, "serif", {
        x: clip.left + 50,
        y: clip.top + 92,
        maxW: clip.width - 100,
        maxH: 290,
        sizes: [74, 66, 60, 54, 48, 44, 40],
        lineH: 1.12,
      });
      if (!free) return null;
      const head = {
        ...free.box,
        height: free.lines.length * free.size * 1.12,
      };
      return { ...base, free, mark: pad(head, 22), focus: pad(clip, 50) };
    }
  }
}

/** A stable 0..1 number for (seed, i). */
export function rnd(seed: number, i: number): number {
  let h =
    (Math.imul(seed | 0, 0x9e3779b1) ^
      Math.imul((i | 0) + 0x632be5ab, 0x85ebca6b)) >>>
    0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Placeholder line widths (fractions of a column): varied, stable, never words. */
export function placeholderWidths(
  n: number,
  seed: number,
  last = true,
): number[] {
  return Array.from({ length: n }, (_, i) =>
    last && i === n - 1
      ? 0.35 + 0.25 * rnd(seed, i)
      : 0.72 + 0.27 * rnd(seed, i),
  );
}

/**
 * A figure set in a table's narrow column (QTY, AMOUNT): the biggest size up to `max` that fits `width`, or
 * undefined below 22 px, when the column takes a placeholder bar (the figure is in the key line anyway).
 */
export function columnFigure(
  figure: string | undefined,
  width: number,
  max: number,
): { text: string; size: number } | undefined {
  if (!figure) return undefined;
  const size = Math.min(max, Math.floor(width / (figure.length * CH)));
  return size >= 22 ? { text: figure, size } : undefined;
}

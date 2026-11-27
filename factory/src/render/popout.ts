// The subject pop-out (components/PopOut.tsx; owner's perfection programme, 1 Nov 2026): the trick of the big
// video essays where a character steps in front of the chapter title. The title lands over the picture, then
// the depth model's cut-out of the subject (the existing foreground layer) rises over the words for a moment
// and settles back. It only works when the subject reaches the words without burying them, so the layout is
// chosen from the subject's footprint (the 32 x 18 grid parallax.py writes): the title goes on the side where
// the subject overlaps it a little, never where it would hide most of it.
//
// Pure: the same footprint always gives the same layout.

import { ANTON, fitText, fitsAt } from "./components/motifs/franchises/shared.ts";
import { displayText } from "./timeline.ts";

export const GRID_W = 32;
export const GRID_H = 18;
/** The subject must cover between these shares of the picture: a speck does not pop, a wall hides everything. */
export const SUBJECT_MIN = 0.05;
export const SUBJECT_MAX = 0.5;
/** It must overlap the title's box by at least this share (else nothing visibly steps in front)... */
export const OVERLAP_MIN = 0.03;
/** ...and at most this share, so most of the words stay readable while it is in front. */
export const OVERLAP_MAX = 0.28;
/** The overlap the layout aims for. */
const OVERLAP_AIM = 0.12;

/** A box in shares of the frame (0 to 1). */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type PopAlign = "left" | "centre" | "right";

/** The title's box for each placement (shares of a 16:9 frame), matching PopOut.tsx's text block. */
export const POP_BOXES: Record<PopAlign, Box> = {
  left: { x0: 0.06, y0: 0.34, x1: 0.56, y1: 0.66 },
  centre: { x0: 0.2, y0: 0.36, x1: 0.8, y1: 0.64 },
  right: { x0: 0.44, y0: 0.34, x1: 0.94, y1: 0.66 },
};

/** The grid's cells as shares (0-1), row by row; undefined when it is not a full grid. */
export function parseGrid(grid: string | undefined): number[] | undefined {
  if (!grid || grid.length !== GRID_W * GRID_H || /[^0-9]/.test(grid))
    return undefined;
  return [...grid].map((c) => Number(c) / 9);
}

/** The share of the picture the subject covers. */
export const subjectShare = (cells: number[]) =>
  cells.reduce((a, b) => a + b, 0) / cells.length;

/**
 * A frame box in the picture's own shares, for a picture of `aspect` cover-cropped into a frame of
 * `frameAspect` (the way the stills are shown: centred, the overflow cropped).
 */
export function frameToPicture(
  box: Box,
  aspect: number,
  frameAspect = 16 / 9,
): Box {
  if (aspect >= frameAspect) {
    const k = frameAspect / aspect; // the frame's width as a share of the picture's
    const off = (1 - k) / 2;
    return {
      x0: off + box.x0 * k,
      x1: off + box.x1 * k,
      y0: box.y0,
      y1: box.y1,
    };
  }
  const k = aspect / frameAspect;
  const off = (1 - k) / 2;
  return { x0: box.x0, x1: box.x1, y0: off + box.y0 * k, y1: off + box.y1 * k };
}

/** The share of a box (picture shares) the subject covers, from the grid's cells it touches, area-weighted. */
export function overlap(cells: number[], box: Box): number {
  let covered = 0;
  let area = 0;
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) {
      const cx0 = x / GRID_W;
      const cy0 = y / GRID_H;
      const w = Math.max(
        0,
        Math.min(box.x1, cx0 + 1 / GRID_W) - Math.max(box.x0, cx0),
      );
      const h = Math.max(
        0,
        Math.min(box.y1, cy0 + 1 / GRID_H) - Math.max(box.y0, cy0),
      );
      const a = w * h;
      if (!a) continue;
      area += a;
      covered += a * cells[y * GRID_W + x]!;
    }
  return area ? covered / area : 0;
}

export interface PopLayout {
  align: PopAlign;
  /** The share of the title's box the subject covers when it is in front. */
  overlap: number;
  subject: number;
}

/**
 * Where the title goes for this picture so its subject can step in front of it (pure); undefined when no
 * placement keeps the overlap between OVERLAP_MIN and OVERLAP_MAX, or the subject is too small or too big.
 */
export function popLayout(
  grid: string | undefined,
  aspect: number,
  frameAspect = 16 / 9,
): PopLayout | undefined {
  const cells = parseGrid(grid);
  if (!cells) return undefined;
  const subject = subjectShare(cells);
  if (subject < SUBJECT_MIN || subject > SUBJECT_MAX) return undefined;
  const fits = (["centre", "left", "right"] as const)
    .map((align) => ({
      align,
      overlap: overlap(
        cells,
        frameToPicture(POP_BOXES[align], aspect, frameAspect),
      ),
      subject,
    }))
    .filter((l) => l.overlap >= OVERLAP_MIN && l.overlap <= OVERLAP_MAX);
  if (!fits.length) return undefined;
  return fits.sort(
    (a, b) =>
      Math.abs(a.overlap - OVERLAP_AIM) - Math.abs(b.overlap - OVERLAP_AIM),
  )[0];
}

/** Frames into the card the subject starts to step forward, holds in front and steps back. */
export const POP_RISE = 10;
export const POP_HOLD = 45;
export const POP_FALL = 14;
/** How much the subject grows as it steps forward. */
export const POP_SCALE = 0.035;

/**
 * The pop at frame f of a card whose subject steps forward at `at` (pure): 0 behind the words, 1 fully in
 * front. A card too short for the whole pop holds the subject in front to its end instead of snapping back.
 */
export function popAmount(f: number, at: number, len: number): number {
  const ease = (t: number) => {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
  };
  const up = ease((f - at) / POP_RISE);
  const fallAt = at + POP_RISE + POP_HOLD;
  if (fallAt + POP_FALL > len) return up;
  return up * (1 - ease((f - fallAt) / POP_FALL));
}

/** The text block's band (shares of the frame height): the kicker, the title, the rule and the line under it. */
export const POP_TEXT_Y: [number, number] = [0.18, 0.82];
/** Frame pixels the kicker, the rule and the line under the title take from that band. */
const POP_CHROME_PX = 130;
/** The title is never set smaller than this; a title that needs less room than that gets no pop-out card. */
export const POP_TITLE_MIN = 60;
export const POP_TITLE_MAX = 128;

export interface PopTitleFit {
  /** The text block's horizontal room, shares of the frame width: its box, stopping short of the subject. */
  x0: number;
  x1: number;
  size: number;
  lines: string[];
}

/**
 * Where the title may sit and at what size so no word is clipped or hidden under the subject (pure). The room is the
 * placement's box narrowed to stop short of the subject's footprint (with margin for the step forward), and the title
 * is fitted into it, at most four lines, between POP_TITLE_MIN and POP_TITLE_MAX px. Undefined when it can't fit:
 * the card is then not used (27 Nov guide proof: "DON'T BUY THE WRONG GTA 6 EDITION: 7 DIFFERENCES (FULL GUIDE)" ran
 * under the key art at a fixed 104 px).
 */
export function popTitleFit(
  title: string,
  align: PopAlign,
  grid: string | undefined,
  aspect: number,
  frameAspect = 16 / 9,
): PopTitleFit | undefined {
  const text = displayText(title).toUpperCase().trim();
  if (!text) return undefined;
  const cells = parseGrid(grid);
  const box = POP_BOXES[align];
  const STEP = 1 / 64;
  const MARGIN = 0.03;
  const busy = (x: number) =>
    Boolean(
      cells &&
        overlap(cells, frameToPicture({ x0: x, x1: x + STEP, y0: 0.26, y1: 0.74 }, aspect, frameAspect)) > 0.12,
    );
  let x0 = box.x0;
  let x1 = box.x1;
  if (align === "left") {
    // A subject just past the box still needs the margin: it grows a little as it steps forward.
    for (let x = box.x0; x < box.x1 + MARGIN; x += STEP)
      if (busy(x)) {
        x1 = Math.max(box.x0, Math.min(box.x1, x - MARGIN));
        break;
      }
  } else if (align === "right") {
    for (let x = box.x1 - STEP; x >= box.x0 - MARGIN - STEP; x -= STEP)
      if (busy(x)) {
        x0 = Math.min(box.x1, Math.max(box.x0, x + STEP + MARGIN));
        break;
      }
  } else {
    // Centred: the widest clear run inside the box.
    let best: [number, number] = [box.x0, box.x0];
    let start = box.x0;
    for (let x = box.x0; x < box.x1; x += STEP)
      if (busy(x)) {
        const b = x - MARGIN;
        if (b - start > best[1] - best[0]) best = [start, b];
        start = x + STEP + MARGIN;
      }
    // The run still open at the box's right edge.
    if (box.x1 - start > best[1] - best[0]) best = [start, box.x1];
    [x0, x1] = best;
  }
  const o = {
    width: Math.max(0, (x1 - x0) * 1920),
    height: (POP_TEXT_Y[1] - POP_TEXT_Y[0]) * 1080 - POP_CHROME_PX,
    lineHeight: 0.98,
    maxLines: 4,
    maxSize: POP_TITLE_MAX,
    minSize: POP_TITLE_MIN,
    padEm: 0.15,
    // PopOut sets the title with 0.01em letter spacing.
    tracking: 0.01,
  };
  if (o.width < 300 || !fitsAt(text, ANTON, o)) return undefined;
  const fit = fitText(text, ANTON, o);
  return { x0, x1, size: Math.floor(fit.size), lines: fit.lines };
}

export interface PopPicture {
  kind: string;
  aspect: number;
  beatIndex?: number;
  layers?: { mesh?: { grid: string } };
}

/**
 * The picture a chapter opener (or, with beat undefined and `any`, the title drop) pops its subject from:
 * the chapter's first key art or wide screenshot with mesh maps whose subject fits a layout.
 */
export function popPicture(
  images: readonly PopPicture[],
  beat: number | undefined,
  any = false,
  /** The card's title: a picture whose subject leaves it no room to fit unclipped is passed over. */
  title?: string,
): { index: number; layout: PopLayout; fit?: PopTitleFit } | undefined {
  const kinds = ["hero", "header", "article", "screenshot"];
  const order = images
    .map((im, index) => ({ im, index }))
    .filter(
      ({ im }) =>
        (any || im.beatIndex === beat) &&
        im.aspect >= 1.2 &&
        kinds.includes(im.kind) &&
        im.layers?.mesh,
    )
    .sort(
      (a, b) =>
        kinds.indexOf(a.im.kind) - kinds.indexOf(b.im.kind) ||
        a.index - b.index,
    );
  for (const { im, index } of order) {
    const layout = popLayout(im.layers!.mesh!.grid, im.aspect);
    if (!layout) continue;
    // No title (or an empty one): nothing to clip, the old card.
    if (title === undefined || !title.trim()) return { index, layout };
    const fit = popTitleFit(title, layout.align, im.layers!.mesh!.grid, im.aspect);
    if (fit) return { index, layout, fit };
  }
  return undefined;
}

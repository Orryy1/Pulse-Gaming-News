// The subject pop-out (components/PopOut.tsx; owner's perfection programme, 1 Nov 2026): the trick of the big
// video essays where a character steps in front of the chapter title. The title lands over the picture, then
// the depth model's cut-out of the subject (the existing foreground layer) rises over the words for a moment
// and settles back. It only works when the subject reaches the words without burying them, so the layout is
// chosen from the subject's footprint (the 32 x 18 grid parallax.py writes): the title goes on the side where
// the subject overlaps it a little, never where it would hide most of it.
//
// Pure: the same footprint always gives the same layout.

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
): { index: number; layout: PopLayout } | undefined {
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
    if (layout) return { index, layout };
  }
  return undefined;
}

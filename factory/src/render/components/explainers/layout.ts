// Where an explainer draws and how big its words may be, on the upright Short (1080x1920) and the wide long video
// (1920x1080). One pure module so the components and the grounding (./ground.ts) agree: a label the layout cannot
// set on at most two lines inside its slot is dropped before anything renders, rather than shrunk until it is
// unreadable or clipped at the edge.

import { fitBlock, fits, textWidth, type Face } from "../packs/fit.ts";
import type { Explainer, ExplainerType } from "./types.ts";

export type Orientation = "tall" | "wide";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The board an explainer fills. Tall: inside the Short's safe column, from under the brand band to above the
 * caption block (layout.ts BANDS: hero and shelf, y 330-1160), clear of the right-hand rail. Wide: inside the
 * 60 px safe edge and above the lower third, where the chapter tag and credits live.
 */
export function boardBox(o: Orientation): Box {
  return o === "tall"
    ? { left: 64, top: 330, width: 952, height: 830 }
    : { left: 120, top: 96, width: 1680, height: 790 };
}

/** The heading band at the top of the board. */
export const TITLE_BAND = { tall: 118, wide: 104 } as const;
export const TITLE_SIZES = { tall: [64, 56, 48], wide: [60, 52, 46] } as const;

/** Label sizes, largest first; the smallest is still well above the house micro size (brand.ts TYPE.micro 26). */
export const LABEL_SIZES = {
  tall: [52, 46, 40, 36],
  wide: [44, 40, 36, 32],
} as const;
export const VALUE_SIZES = {
  tall: [76, 64, 54, 46],
  wide: [64, 56, 48, 42],
} as const;
export const LABEL_FACE: Face = "inter";
export const VALUE_FACE: Face = "anton";
export const LINE_HEIGHT = 1.08;

/** How wide one item's label may be, by shape and item count. */
export function labelWidth(
  type: ExplainerType,
  o: Orientation,
  n: number,
): number {
  const box = boardBox(o);
  const tall = o === "tall";
  switch (type) {
    case "steps":
    case "chain":
      // Tall: stacked rows with the icon disc on the left; wide: columns with arrows between.
      return tall
        ? box.width - 250
        : Math.floor((box.width - (n - 1) * 96) / n) - 48;
    case "timeline":
      return tall ? box.width - 330 : Math.floor(box.width / n) - 56;
    case "cycle":
      return tall ? 330 : 400;
    case "versus":
      return Math.floor((box.width - 120) / 2) - 60;
    case "howmuch":
      return tall ? 430 : 420;
    case "anatomy":
      return tall ? 330 : 430;
    case "object3d":
      return tall ? 360 : 460;
  }
}

/** How wide a value may be: one line of display type. */
export function valueWidth(
  type: ExplainerType,
  o: Orientation,
  n: number,
): number {
  if (type === "versus") return Math.floor((boardBox(o).width - 120) / 2) - 60;
  if (type === "howmuch") return o === "tall" ? 430 : 420;
  return labelWidth(type, o, n);
}

/** A label set to fit its slot: at most two lines at the largest size that fits. */
export function fitLabel(
  text: string,
  type: ExplainerType,
  o: Orientation,
  n: number,
  title = "",
) {
  const h = flowCardHeight(type, o, n, title);
  return fitBlock(text, LABEL_FACE, {
    maxWidth: labelWidth(type, o, n),
    sizes: [...LABEL_SIZES[o]],
    maxLines: 2,
    lineHeight: LINE_HEIGHT,
    ...(h === undefined ? {} : { maxHeight: h - 28 }),
  });
}

/** The board's height under its heading (one or two lines of title). */
export function contentHeight(o: Orientation, title: string): number {
  const head = title ? fitTitle(title, o) : undefined;
  return boardBox(o).height - TITLE_BAND[o] - (head && head.lines.length > 1 ? head.size : 0);
}

/** The gap between stacked cards of a step flow (numbered) or a chain on the tall board. */
export const flowGap = (type: ExplainerType) => (type === "steps" ? 76 : 84);

/** A tall step or chain card's height (Flow.tsx draws exactly this); undefined for every other shape and the wide board. */
export function flowCardHeight(type: ExplainerType, o: Orientation, n: number, title: string): number | undefined {
  if (o !== "tall" || (type !== "steps" && type !== "chain")) return undefined;
  return Math.min(200, (contentHeight(o, title) - 30 - (n - 1) * flowGap(type)) / n);
}

/** A value's size: the largest of the ladder that fits one line. */
export function fitValue(
  text: string,
  type: ExplainerType,
  o: Orientation,
  n: number,
) {
  const w = valueWidth(type, o, n);
  for (const size of VALUE_SIZES[o])
    if (fits(text, VALUE_FACE, size, w)) return { size, fits: true };
  const last = VALUE_SIZES[o][VALUE_SIZES[o].length - 1]!;
  return { size: last, fits: fits(text, VALUE_FACE, last, w) };
}

/** The heading, at most two lines across the board. */
export function fitTitle(text: string, o: Orientation) {
  return fitBlock(text.toUpperCase(), "anton", {
    maxWidth: boardBox(o).width - 40,
    sizes: [...TITLE_SIZES[o]],
    maxLines: 2,
    lineHeight: 1.0,
  });
}

/** What would not fit, one note per problem; empty when every word on the board fits its slot. */
export function layoutProblems(e: Explainer, o: Orientation): string[] {
  const n = e.items.length;
  const out: string[] = [];
  if (e.title && !fitTitle(e.title, o).fits)
    out.push(`title "${e.title}" runs past two lines`);
  e.items.forEach((it, i) => {
    if (!fitLabel(it.label, e.type, o, n, e.title).fits)
      out.push(`item ${i + 1} label "${it.label}" runs past two lines`);
    if (it.value && !fitValue(it.value, e.type, o, n).fits)
      out.push(`item ${i + 1} value "${it.value}" does not fit one line`);
  });
  return out;
}

/** The width of a callout's plate round its fitted label (text plus 20 px padding a side), so a leader line meets its edge. */
export function plateWidth(text: string, type: ExplainerType, o: Orientation, n: number): number {
  const f = fitLabel(text, type, o, n);
  return Math.ceil(Math.max(...f.lines.map((l) => textWidth(l, LABEL_FACE, f.size, -0.3)))) + 40;
}

/** The anatomy picture box: the board under a one-line heading, less its 10 px inset top and bottom. */
export function pictureBox(o: Orientation): Box {
  const b = boardBox(o);
  const band = TITLE_BAND[o];
  return { left: b.left, top: b.top + band + 10, width: b.width, height: b.height - band - 20 };
}

/**
 * What part of a picture (0-1 across and down) the anatomy board shows when it cover-crops the picture into its box,
 * kept 4% inside the edge: a callout outside it would point at the empty board.
 */
export function visibleCrop(pictureAspect: number, o: Orientation): { x0: number; x1: number; y0: number; y1: number } {
  const box = pictureBox(o);
  const boxAspect = box.width / box.height;
  const m = 0.04;
  if (pictureAspect > boxAspect) {
    const half = boxAspect / pictureAspect / 2;
    return { x0: 0.5 - half + m, x1: 0.5 + half - m, y0: m, y1: 1 - m };
  }
  const half = pictureAspect / boxAspect / 2;
  return { x0: m, x1: 1 - m, y0: 0.5 - half + m, y1: 0.5 + half - m };
}

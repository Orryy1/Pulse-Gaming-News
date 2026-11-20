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
export const TITLE_BAND = { tall: 128, wide: 104 } as const;
export const TITLE_SIZES = { tall: [72, 62, 52], wide: [60, 52, 46] } as const;

/** Label sizes, largest first; the smallest is still well above the house micro size (brand.ts TYPE.micro 26). */
export const LABEL_SIZES = {
  tall: [52, 46, 40, 36],
  wide: [44, 40, 36, 32],
} as const;
export const VALUE_SIZES = {
  tall: [76, 64, 54, 46],
  wide: [64, 56, 48, 42],
} as const;
/**
 * The tall boards whose items are big cards or one column (steps, chain, versus, how much) read at phone size with
 * larger type: the ladder starts higher and ends where the general one does, so nothing that fitted stops fitting.
 */
const BIG_TALL: readonly ExplainerType[] = ["steps", "chain", "versus", "howmuch"];
const BIG_LABEL_SIZES = [66, 60, 54, 48, 42, 36] as const;
const BIG_VALUE_SIZES = [104, 92, 80, 68, 58, 46] as const;

/** The label sizes a shape's labels try, largest first. */
export function labelSizes(type: ExplainerType, o: Orientation): readonly number[] {
  return o === "tall" && BIG_TALL.includes(type) ? BIG_LABEL_SIZES : LABEL_SIZES[o];
}

/** The value sizes a shape's values try, largest first. */
export function valueSizes(type: ExplainerType, o: Orientation): readonly number[] {
  return o === "tall" && BIG_TALL.includes(type) ? BIG_VALUE_SIZES : VALUE_SIZES[o];
}
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
      // Tall: stacked rows with the icon disc on the left (FLOW_DISC and its padding); wide: columns with arrows between.
      return tall
        ? box.width - FLOW_DISC - 130
        : Math.floor((box.width - (n - 1) * 96) / n) - 48;
    case "timeline":
      return tall ? box.width - 330 : Math.floor(box.width / n) - 56;
    case "cycle":
      return tall ? 330 : 400;
    case "versus":
      return Math.floor((box.width - versusGap(o)) / 2) - 60;
    case "howmuch":
      // Tall: from the right of the column to the right-hand rail of buttons (x 920).
      return tall ? 450 : 420;
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
  if (type === "versus") return Math.floor((boardBox(o).width - versusGap(o)) / 2) - 60;
  if (type === "howmuch") return o === "tall" ? 450 : 420;
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
  const fit = (maxLines: number, sizes: readonly number[]) =>
    fitBlock(text, LABEL_FACE, {
      maxWidth: labelWidth(type, o, n),
      sizes: [...sizes],
      maxLines,
      lineHeight: LINE_HEIGHT,
      ...(h === undefined ? {} : { maxHeight: h - 28 }),
    });
  const sizes = labelSizes(type, o);
  // The big tall boards keep a label on one line while it can stay at least the general ladder's largest size (no
  // "you" left alone on a second line); the price build, whose labels stack beside one column, at any size.
  if (o === "tall" && sizes !== LABEL_SIZES[o]) {
    const floor = type === "howmuch" ? 0 : LABEL_SIZES[o][0];
    const one = fit(1, sizes.filter((x) => x >= floor));
    if (one.fits) return one;
  }
  return fit(2, sizes);
}

/** The board's height under its heading (one or two lines of title). */
export function contentHeight(o: Orientation, title: string): number {
  const head = title ? fitTitle(title, o) : undefined;
  return boardBox(o).height - TITLE_BAND[o] - (head && head.lines.length > 1 ? head.size : 0);
}

/** The gap between stacked cards of a step flow (numbered) or a chain on the tall board. */
export const flowGap = (type: ExplainerType) => (type === "steps" ? 64 : 72);

/** The largest icon disc on a tall step or chain card, and the tallest card. */
export const FLOW_DISC = 150;
const FLOW_CARD_MAX = 250;

/** The gap between the two cards of a versus board. */
export const versusGap = (o: Orientation) => (o === "tall" ? 96 : 120);

/** A tall step or chain card's height (Flow.tsx draws exactly this); undefined for every other shape and the wide board. */
export function flowCardHeight(type: ExplainerType, o: Orientation, n: number, title: string): number | undefined {
  if (o !== "tall" || (type !== "steps" && type !== "chain")) return undefined;
  return Math.min(FLOW_CARD_MAX, (contentHeight(o, title) - 30 - (n - 1) * flowGap(type)) / n);
}

/**
 * How much of the tall board's content area a shape really uses, when it uses less than all of it (a short step
 * flow); the board then centres its heading and content together between the brand band and the caption band
 * instead of leaving the space under them empty. Undefined: the shape fills its content area.
 */
export function tallContentUsed(type: ExplainerType, o: Orientation, n: number, title: string): number | undefined {
  const h = flowCardHeight(type, o, n, title);
  if (h === undefined) return undefined;
  const used = 30 + n * h + (n - 1) * flowGap(type);
  return used < contentHeight(o, title) - 1 ? used : undefined;
}

/** A value's size: the largest of the ladder that fits one line. */
export function fitValue(
  text: string,
  type: ExplainerType,
  o: Orientation,
  n: number,
) {
  const w = valueWidth(type, o, n);
  const sizes = valueSizes(type, o);
  for (const size of sizes)
    if (fits(text, VALUE_FACE, size, w)) return { size, fits: true };
  const last = sizes[sizes.length - 1]!;
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

// The clean Short (owner, 31 Oct 2026: "are our Shorts too visually crowded?"). The breakout gaming-news Shorts
// show full-bleed footage, one caption line and at most one card at a time, with no header bar, source line,
// progress rule or footer credit; ours often carried five to seven elements at once (logo, flair, source line,
// rule, footage in an inset box, game chip, CONFIRMED strip, fact card, caption, footer credit). With
// SHORTS_CLEAN (default on, and an A/B arm in src/growth.ts so retention decides):
//
// - footage and pictures are full-bleed; nothing sits in an inset box over black;
// - besides the caption, one overlay at a time: the hook's headline, a word moment, a freeze label, a filler,
//   a card, the motif sting, or one shelf device (the game chip, the CONFIRMED strip, a stat), in that order
//   of priority; a lower one is cut to the longest stretch the higher ones leave free, or dropped;
// - the header is the small Pulse mark; the flair and source line show for the first 3 s (the honesty label
//   readable while a viewer decides) and again in the loop's last 2 s (which must match frame 0); the progress
//   rule is gone;
// - on screen, a credit only where a licence asks for one (a CC BY photo or gameplay clip), small, while that
//   picture or clip shows, and the stock-footage label; the trailer credit stays in the description.
//
// Captions are unchanged. Everything here is pure, so the composition and the checks agree frame for frame.

import type { RenderPlan } from "./plan.ts";
import type { Segment } from "./timeline.ts";
import { cardWindow } from "./shortcraft.ts";

export type OverlayKind =
  | "hook"
  | "stamp"
  | "freeze"
  | "filler"
  | "card"
  | "sting"
  | "shelf";

/** Higher wins. */
export const PRIORITY: Record<OverlayKind, number> = {
  stamp: 7,
  hook: 6,
  freeze: 5,
  filler: 4,
  card: 3,
  sting: 2,
  shelf: 1,
};

/** The shortest stretch a cut-down overlay keeps; shorter and it is dropped. */
export const MIN_KEEP: Record<OverlayKind, number> = {
  hook: 1,
  stamp: 1,
  freeze: 20,
  filler: 30,
  card: 24,
  sting: 20,
  shelf: 30,
};

/** Frames the opening honesty label (flair and source line) stays up: 3 s. */
export const OPENING_LABEL_FRAMES = 90;

export interface Span {
  key: string;
  kind: OverlayKind;
  from: number;
  /** Exclusive. */
  to: number;
}

/** The free stretches of [from, to) once the taken spans are cut out. */
function freePieces(
  from: number,
  to: number,
  taken: Span[],
): Array<[number, number]> {
  let pieces: Array<[number, number]> = [[from, to]];
  for (const t of taken) {
    const next: Array<[number, number]> = [];
    for (const [a, b] of pieces) {
      if (t.to <= a || t.from >= b) next.push([a, b]);
      else {
        if (t.from > a) next.push([a, t.from]);
        if (t.to < b) next.push([t.to, b]);
      }
    }
    pieces = next;
  }
  return pieces;
}

/**
 * One overlay at a time: spans are placed by priority (then by start), each cut to the longest stretch the
 * ones already placed leave free, and dropped when that is under its kind's MIN_KEEP. Returns the kept spans.
 */
/** The opening frames that always show the hook's headline: frame 0 is the thumbnail. */
export const THUMB_FRAMES = 12;

export function arbitrate(input: Span[]): Span[] {
  // A word moment never covers the thumbnail: one that would land in the first frames waits for them to pass.
  const spans = input.map((s) =>
    s.kind === "stamp" && s.from < THUMB_FRAMES ? { ...s, from: THUMB_FRAMES, to: s.to + (THUMB_FRAMES - s.from) } : s,
  );
  const order = [...spans].sort(
    (a, b) =>
      PRIORITY[b.kind] - PRIORITY[a.kind] ||
      a.from - b.from ||
      (a.key < b.key ? -1 : 1),
  );
  const kept: Span[] = [];
  for (const s of order) {
    if (s.to <= s.from) continue;
    const pieces = freePieces(s.from, s.to, kept);
    // The hook's headline steps aside for a word moment and comes back: every piece is kept, keyed in order.
    if (s.kind === "hook") {
      pieces.forEach(([a, b], k) => kept.push({ ...s, key: k ? `${s.key}#${k}` : s.key, from: a, to: b }));
      continue;
    }
    // The longest piece, the earliest on a tie, so a card still lands as near its word as it can.
    const best = pieces.sort(
      (x, y) => y[1] - y[0] - (x[1] - x[0]) || x[0] - y[0],
    )[0];
    if (!best || best[1] - best[0] < MIN_KEEP[s.kind]) continue;
    kept.push({ ...s, from: best[0], to: best[1] });
  }
  return kept.sort((a, b) => a.from - b.from);
}

/** The kept span for a key, if any. */
export const keptSpan = (kept: Span[], key: string): Span | undefined =>
  kept.find((s) => s.key === key);

/** On a clean Short, whether the flair and source line show: the opening 3 s and the loop's return to frame 0. */
export function labelShows(frame: number, loopFrom: number): boolean {
  return frame < OPENING_LABEL_FRAMES || frame >= loopFrom;
}

/** The on-screen credit a licence asks for, from a clip's provenance: CC BY gameplay names its creator. */
export function ccCredit(provenance: string | undefined): string | undefined {
  const m = String(provenance ?? "").match(
    /^Gameplay "[^"]*" by (.+?), Creative Commons Attribution licence \(CC BY\)/,
  );
  return m ? `Gameplay: ${m[1]!.slice(0, 40)} · CC BY` : undefined;
}

/**
 * Whether a Short is clean: off when SHORTS_CLEAN is off; on a Short in the clean-frame retention test its arm
 * decides (A clean, B the full chrome); after the test, its winner; until then, clean.
 */
export function shortsCleanFor(
  enabled: boolean,
  test: { key: string; variant: "A" | "B" } | undefined,
  winner: "A" | "B" | undefined,
): boolean {
  if (!enabled) return false;
  if (test?.key === "shorts_clean") return test.variant === "A";
  if (winner) return winner === "A";
  return true;
}

// ---- The element count ------------------------------------------------------------------------------

/** Everything that can be on a Short's frame, as spans, for the per-frame element count. */
export interface FrameModel {
  totalFrames: number;
  /** Frames the caption is up. */
  caption: Array<[number, number]>;
  /** The overlays as drawn (arbitrated on a clean Short, as planned on the old one). */
  overlays: Span[];
  /** The flair and source line (and, on the old Short, its rule): frames shown. */
  label: Array<[number, number]>;
  /** The progress rule along the top. */
  rail: Array<[number, number]>;
  /** A credit or stock label in the footer. */
  credit: Array<[number, number]>;
  /** Footage or a picture in an inset box over a dark plate. */
  inset: Array<[number, number]>;
}

const within = (f: number, list: Array<[number, number]>) =>
  list.some(([a, b]) => f >= a && f < b);

/** The elements on frame f, the logo excepted: caption, overlays, label, rule, credit and inset box, each counted once. */
export function elementsAt(m: FrameModel, f: number): string[] {
  const out: string[] = [];
  if (within(f, m.caption)) out.push("caption");
  for (const o of m.overlays) if (f >= o.from && f < o.to) out.push(o.kind);
  if (within(f, m.label)) out.push("label");
  if (within(f, m.rail)) out.push("rail");
  if (within(f, m.credit)) out.push("credit");
  if (within(f, m.inset)) out.push("inset");
  return out;
}

/** The count over a whole Short: the most on any frame, the mean, and the share of frames over two. */
export function elementStats(
  m: FrameModel,
  skip: (f: number) => boolean = () => false,
): {
  max: number;
  mean: number;
  overTwo: number;
  worst: number;
  worstAt: string[];
} {
  let max = 0;
  let sum = 0;
  let n = 0;
  let over = 0;
  let worst = 0;
  let worstAt: string[] = [];
  for (let f = 0; f < m.totalFrames; f++) {
    if (skip(f)) continue;
    const e = elementsAt(m, f);
    n++;
    sum += e.length;
    if (e.length > 2) over++;
    if (e.length > max) {
      max = e.length;
      worst = f;
      worstAt = e;
    }
  }
  return {
    max,
    mean: n ? Math.round((sum / n) * 100) / 100 : 0,
    overTwo: n ? Math.round((over / n) * 1000) / 1000 : 0,
    worst,
    worstAt,
  };
}

// ---- The spans of a Short ---------------------------------------------------------------------------


/** Frames the word moment holds (components/Stamp.tsx STAMP_FRAMES). */
const STAMP_HOLD = 51;
/** Frames the motif sting holds after the hook (Short.tsx MOTIF_STING). */
const STING_FRAMES = 30;

export interface ShortLayout {
  /** The hook's end and where the loop's return to frame 0 starts (frames). */
  hookEnd: number;
  loopFrom: number;
  totalFrames: number;
}

/** Where the hook ends and the loop's closing poster starts, as Short.tsx places them. */
export function shortLayout(segments: Segment[], fps: number, totalFrames: number, tailFrames: number): ShortLayout {
  const starts = segments.map((s, i) => (i === 0 ? 0 : Math.round(s.start * fps)));
  const ends = segments.map((_, i) => (i === segments.length - 1 ? totalFrames : starts[i + 1]!));
  const hook = segments.findIndex((s) => s.kind === "hook");
  const loop = segments.findIndex((s) => s.kind === "loop");
  const hookEnd = hook >= 0 ? ends[hook]! : Math.round(3 * fps);
  const loopStart = loop >= 0 ? starts[loop]! : totalFrames - tailFrames;
  const loopFrom = loopStart < totalFrames ? Math.max(loopStart, totalFrames - 2 * fps) : totalFrames;
  return { hookEnd, loopFrom, totalFrames };
}

/** Every overlay a Short plans, before the one-at-a-time rule: keyed as Short.tsx draws them. */
export function overlaySpans(input: {
  segments: Segment[];
  words: Array<{ text?: string; start: number }>;
  plan: Pick<RenderPlan, "fps" | "totalFrames" | "shelf" | "craft">;
  layout: ShortLayout;
  stamps: Array<{ at: number }>;
  sting: boolean;
}): Span[] {
  const { segments, words, plan, layout, stamps } = input;
  const fps = plan.fps;
  const out: Span[] = [{ key: "hook", kind: "hook", from: 0, to: layout.hookEnd }];
  if (layout.loopFrom < layout.totalFrames) out.push({ key: "loop", kind: "hook", from: layout.loopFrom, to: layout.totalFrames });
  stamps.forEach((st, i) => {
    const a = Math.round(st.at * fps);
    out.push({ key: `stamp${i}`, kind: "stamp", from: a, to: a + STAMP_HOLD });
  });
  (plan.craft?.moves ?? []).forEach((m, i) => {
    if (m.kind === "freeze") out.push({ key: `freeze${i}`, kind: "freeze", from: m.at, to: m.at + m.hold + 8 });
  });
  (plan.craft?.fillers ?? []).forEach((f, i) => out.push({ key: `fill${i}`, kind: "filler", from: f.from, to: f.from + f.len }));
  segments.forEach((s, i) => {
    if (s.kind !== "beat" && s.kind !== "take") return;
    if (!s.visual || s.visual.kind === "none" || !s.visual.primary.trim()) return;
    const w = cardWindow(segments, words, i, fps, plan.totalFrames);
    out.push({ key: `card${i}`, kind: "card", from: w.from, to: w.from + w.len });
  });
  if (input.sting) out.push({ key: "sting", kind: "sting", from: layout.hookEnd, to: layout.hookEnd + STING_FRAMES });
  plan.shelf.forEach((it, i) => {
    if (it.device === "rail" || it.to <= it.from) return;
    out.push({ key: `shelf${i}`, kind: "shelf", from: it.from, to: it.to });
  });
  return out;
}

/** The frames the caption is up: from each word's start to its end plus a beat, joined across short gaps. */
export function captionSpans(words: Array<{ start: number; end: number }>, fps: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const w of words) {
    const a = Math.round(w.start * fps);
    const b = Math.round((w.end + 0.4) * fps);
    const last = out[out.length - 1];
    if (last && a - last[1] <= fps) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** The frame model of a Short, old or clean, for the element count. */
export function frameModel(input: {
  clean: boolean;
  spans: Span[];
  layout: ShortLayout;
  plan: Pick<RenderPlan, "shots">;
  words: Array<{ start: number; end: number }>;
  fps: number;
  /** Per shot: whether a footer credit or label shows on it (old: every clip with a trailer credit; clean: only licensed media and stock). */
  credited: (shotIndex: number) => boolean;
}): FrameModel {
  const { clean, layout, plan } = input;
  const total = layout.totalFrames;
  return {
    totalFrames: total,
    caption: captionSpans(input.words, input.fps),
    overlays: clean ? arbitrate(input.spans) : input.spans,
    label: clean ? [[0, Math.min(total, OPENING_LABEL_FRAMES)], [layout.loopFrom, total]] : [[0, total]],
    rail: clean ? [] : [[0, total]],
    credit: plan.shots.map((s, i) => (input.credited(i) ? ([s.start, s.end] as [number, number]) : undefined)).filter((x): x is [number, number] => !!x),
    inset: clean ? [] : plan.shots.filter((s) => s.framed).map((s) => [s.start, s.end] as [number, number]),
  };
}

// When a sentence's graphic is on screen, in frames, shared by the renderer (src/render/Long.tsx) and the
// graphics check (src/qa/graphicscheck.ts). Until 1 Nov 2026 the two worked it out separately: the check
// assumed a graphic lasts until the next sentence (at least 2.5 s), the renderer let it run for its reading
// time and never less than 2.5 s, whatever came next. On Vice City (31 Oct 2026) that cost graphics twice:
// - the check's still for a map card landed after the next sentence's full-screen document had taken the
//   frame, so the map was muted for the document's fault (4:11);
// - the 2.5 s floor kept a graphic up under the next sentence's graphic or caption (a stat card under a
//   milestone banner, a compare's heading under "VERTICALITY AND DENSITY"), and the check muted both.
// Now one function decides: a graphic never runs into the next graphic or filler of its entry; a full-screen
// graphic never runs under a caption either, unless that would cut it to a flash, in which case the caption
// is left out; and a graphic with under MIN_READ_SECONDS before the next graphic is left out.

import type { MomentWindow } from "./longplan.ts";
import { usefulEmphasis, usefulGraphic } from "./longplan.ts";

/** What the span needs to know about a sentence: its graphic and its caption. */
export interface SpanMoment {
  graphic: {
    kind: string;
    primary: string;
    secondary: string;
    items?: string[];
  };
  emphasis?: string;
}

/** The shortest a graphic stays up when nothing else is drawn after it, in seconds. */
export const MIN_SPAN_SECONDS = 2.5;
/** The gap left before the next thing drawn for the same entry, in seconds. */
export const CLEAR_SECONDS = 0.3;
/** A graphic with less room than this before the next graphic is too short to read, and is left out. */
export const MIN_READ_SECONDS = 2;

/**
 * How long a sentence's graphic takes to read, in seconds (owner, 30 Oct 2026: cards and captions vanished
 * before they could be taken in): 2.5 s, 1.5 s more for a graphic's build (typewriter, flip board, counter),
 * 0.3 s a word and 0.5 s a row, at most 8 s.
 */
export function readSeconds(r: SpanMoment | undefined): number {
  if (!r) return 2.5;
  const g = usefulGraphic(r.graphic) ? r.graphic : undefined;
  const text = [g?.primary, g?.secondary, ...(g?.items ?? []), r.emphasis]
    .filter(Boolean)
    .join(" ");
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.min(
    8,
    2.5 + (g ? 1.5 : 0) + 0.3 * words + 0.5 * (g?.items?.length ?? 0),
  );
}

/** Whether a sentence draws anything of its own: a graphic, a caption worth landing or a filler shot. */
export function drawsSomething(
  r: SpanMoment | undefined,
  hasFiller: boolean,
): boolean {
  return (
    !!r &&
    (usefulGraphic(r.graphic) ||
      (!!r.emphasis && usefulEmphasis(r.emphasis)) ||
      hasFiller)
  );
}

/** How the span reads the video. */
export interface SpanLook {
  moment: (entry: number, moment: number) => SpanMoment | undefined;
  /** The first frame of the sentence's filler shot, when the plan gives it one. */
  fillerStart: (entry: number, moment: number) => number | undefined;
  /**
   * The sentence's graphic shares the frame with a caption (the small corner card): a caption may land
   * while it is up. Absent: every graphic is treated as filling the frame.
   */
  shares?: (entry: number, moment: number) => boolean;
}

/** What `sentenceSpan` says about a sentence. */
export interface SentenceSpan {
  /** First frame. */
  from: number;
  /** Frames on screen. */
  len: number;
  /** The sentence has a key word later than its first word. */
  anchored: boolean;
  /**
   * Its graphic would be on screen for less than MIN_READ_SECONDS before the next graphic takes over: it is
   * left out (the sentence keeps its picture). Vice City had six, among them a reviews card for 1.5 s before
   * the next reviews card and a stat for 1 s before a bar chart, each drawn under the next one, where the
   * graphics check muted both (31 Oct 2026).
   */
  short: boolean;
}

const fromOf = (w: MomentWindow, fps: number) =>
  Math.max(Math.round(w.start * fps), Math.round((w.at - 0.15) * fps));

/**
 * The frames sentence `k` holds the screen: from 0.15 s before its key word (never before the sentence) for
 * as long as it takes to read, at least until the next sentence and at least MIN_SPAN_SECONDS, but never into
 * the next graphic or filler of the same entry (that thing's key word less CLEAR_SECONDS, or a filler shot's
 * first frame less CLEAR_SECONDS). A full-screen graphic also ends where the next caption lands, unless that
 * leaves it under MIN_READ_SECONDS: then it keeps its time and the caption is left out (`captionHeld`).
 * A caption gives way to anything drawn after it.
 */
export function sentenceSpan(
  windows: MomentWindow[],
  k: number,
  fps: number,
  look: SpanLook,
): SentenceSpan {
  const w = windows[k]!;
  const next = windows[k + 1];
  const anchored = w.at > w.start;
  const self = look.moment(w.entry, w.moment);
  const isGraphic = !!self && usefulGraphic(self.graphic);
  const from = fromOf(w, fps);
  const until =
    next && next.entry === w.entry
      ? Math.round((next.at - 0.15) * fps)
      : Math.round(w.end * fps);
  // Where the next thing drawn for this entry starts: anything, or only a graphic or filler.
  const findStop = (graphicsOnly: boolean) => {
    let stop = Math.round(w.end * fps);
    for (let j = k + 1; windows[j] && windows[j]!.entry === w.entry; j++) {
      const o = windows[j]!;
      const filler = look.fillerStart(o.entry, o.moment);
      const r = look.moment(o.entry, o.moment);
      const blocks = graphicsOnly
        ? filler !== undefined || (!!r && usefulGraphic(r.graphic))
        : drawsSomething(r, filler !== undefined);
      // A filler shot opens with its sentence's first word: the card before it is gone by then.
      if (blocks)
        return {
          stop:
            filler !== undefined
              ? filler - Math.round(CLEAR_SECONDS * fps)
              : Math.round((o.at - CLEAR_SECONDS) * fps),
          blocked: true,
        };
      stop = Math.round(o.end * fps);
    }
    return { stop, blocked: false };
  };
  const any = findStop(false);
  const gfx = findStop(true);
  const minRead = Math.round(MIN_READ_SECONDS * fps);
  // The reading time may run past the next sentence, but never into the next thing drawn for this entry.
  const read = Math.min(any.stop, from + Math.round(readSeconds(self) * fps));
  const endAt = Math.max(
    until,
    read,
    from + Math.round(MIN_SPAN_SECONDS * fps),
  );
  const cap = (stop: number) => Math.max(from + fps, Math.min(endAt, stop));
  let end: number;
  if (!isGraphic) end = any.blocked ? cap(any.stop) : endAt;
  else {
    // Never into the next graphic or filler.
    end = gfx.blocked ? cap(gfx.stop) : endAt;
    // A full-screen graphic never under a caption, unless giving way would cut it to a flash.
    const shares = look.shares?.(w.entry, w.moment) ?? false;
    if (!shares && any.blocked && any.stop < end && any.stop - from >= minRead)
      end = any.stop;
  }
  return {
    from,
    len: Math.max(1, end - from),
    anchored,
    short: isGraphic && gfx.blocked && gfx.stop - from < minRead,
  };
}

/**
 * Whether sentence `k`'s caption is left out because an earlier full-screen graphic of the same entry is
 * still on screen when it would land (see sentenceSpan). On Vice City the caption "verticality and density"
 * landed on a compare's heading one second in (4:19, 31 Oct 2026).
 */
export function captionHeld(
  windows: MomentWindow[],
  k: number,
  fps: number,
  look: SpanLook,
): boolean {
  const w = windows[k]!;
  const r = look.moment(w.entry, w.moment);
  if (
    !r ||
    !r.emphasis ||
    !usefulEmphasis(r.emphasis) ||
    usefulGraphic(r.graphic) ||
    look.fillerStart(w.entry, w.moment) !== undefined
  )
    return false;
  return underFullScreen(windows, k, fps, look);
}

/**
 * Whether an earlier full-screen graphic of the same entry is still on screen when sentence `k` starts. A name
 * tag waits for it like a caption does: "NAOKI YOSHIDA" landed across the recreated file of the sentence
 * before (FFXIV 3:2, 4 Nov 2026), and the graphics check muted the file for it.
 */
export function underFullScreen(
  windows: MomentWindow[],
  k: number,
  fps: number,
  look: SpanLook,
): boolean {
  const w = windows[k]!;
  const from = fromOf(w, fps);
  for (let j = k - 1; j >= 0 && windows[j]!.entry === w.entry; j--) {
    const o = windows[j]!;
    if (look.fillerStart(o.entry, o.moment) !== undefined) return false;
    const prev = look.moment(o.entry, o.moment);
    if (!prev || !usefulGraphic(prev.graphic)) continue;
    if (look.shares?.(o.entry, o.moment)) return false;
    const sp = sentenceSpan(windows, j, fps, look);
    return !sp.short && sp.from + sp.len > from;
  }
  return false;
}

// The graphics check of a long video, without the re-render loop. Until 30 Oct 2026 the check ran only on
// the finished MP4: a frame from every full-screen graphic went to the vision checker, any faulted one was
// muted and the whole 34-minute documentary rendered again (80 minutes of the PC), sometimes several times
// over. Now the same frames are rendered as stills from the same composition and props before the full
// render (seconds each), the faults are muted first and the render runs once. A check on the finished video
// stays as a safety net, but it may ask for at most GRAPHICS_RERENDER_PASSES more renders; after that the
// video is accepted with the faults muted for any later render, and the owner hears what was muted and why.
// The quietMoments / quietBreaks lists are the same ones Long.tsx already reads, so the renderer is unchanged.

import type { VisionQa } from "../editorial/schema.ts";
import type { MomentWindow } from "../render/longplan.ts";
import { usefulGraphic } from "../render/longplan.ts";
import { framesNamed } from "./vision.ts";

/** One graphic to look at: the second it should be fully drawn and its key ("entry:moment" or "break:i"). */
export interface GraphicCheck {
  t: number;
  what: string;
}

/** The graphic a shot-list sentence carries, as the writers describe it. */
export interface GraphicRef {
  kind: string;
  primary: string;
  secondary: string;
}

/** The mute lists the renderer reads (src/render/Long.tsx): graphics and breathers left out. */
export interface QuietLists {
  quietMoments?: string[];
  quietBreaks?: number[];
}

/** How many graphics the checker sees in one call. */
export const GRAPHICS_BATCH = 8;

/**
 * Every graphic and breather worth checking, in time order: a useful graphic 2.2 s after its sentence lands
 * (fully drawn by then), a breather 2.5 s in. Muted ones and anything past the end are left out. `max` caps
 * the list (the stills pre-pass takes them all up to GRAPHICS_PREPASS_MAX; the post-render sample fewer).
 */
export function graphicChecks(
  input: {
    windows: MomentWindow[];
    graphicOf: (entry: number, moment: number) => GraphicRef | undefined;
    breaks?: Array<{ start: number; end: number }>;
    durationSeconds: number;
  },
  quiet: QuietLists,
  max: number,
): GraphicCheck[] {
  const out: GraphicCheck[] = [];
  const mutedMoments = new Set(quiet.quietMoments ?? []);
  const mutedBreaks = new Set(quiet.quietBreaks ?? []);
  for (const w of input.windows) {
    const key = `${w.entry}:${w.moment}`;
    const g = input.graphicOf(w.entry, w.moment);
    if (!g || !usefulGraphic(g) || mutedMoments.has(key)) continue;
    const t = Math.max(w.start, w.at - 0.15) + 2.2;
    if (t < input.durationSeconds - 1) out.push({ t, what: key });
  }
  (input.breaks ?? []).forEach((b, i) => {
    if (!mutedBreaks.has(i) && b.start + 2.5 < input.durationSeconds - 1)
      out.push({ t: b.start + 2.5, what: `break:${i}` });
  });
  out.sort((a, b) => a.t - b.t);
  return out.slice(0, Math.max(0, max));
}

/** The frame number of a check in a video at `fps`. */
export const checkFrame = (c: GraphicCheck, fps: number): number =>
  Math.max(0, Math.round(c.t * fps));

/**
 * Judges the frames in batches of GRAPHICS_BATCH. `visionQa` is the usual checker in "graphics" mode; a batch
 * whose call fails is passed (never a fault invented from an outage). Returns the keys faulted and every
 * problem the checker wrote, with the keys each batch covered, for the event log.
 */
export async function judgeGraphics(
  items: Array<GraphicCheck & { file: string }>,
  visionQa: (frames: string[]) => Promise<VisionQa>,
): Promise<{
  faulted: string[];
  problems: Array<{ at: string[]; problems: string[] }>;
}> {
  const faulted: string[] = [];
  const problems: Array<{ at: string[]; problems: string[] }> = [];
  for (let k = 0; k < items.length; k += GRAPHICS_BATCH) {
    const batch = items.slice(k, k + GRAPHICS_BATCH);
    const v = await visionQa(batch.map((b) => b.file)).catch(() => undefined);
    if (!v) continue;
    if (v.verdict === "fail")
      for (const n of framesNamed(v.problems))
        if (batch[n - 1] && !faulted.includes(batch[n - 1]!.what))
          faulted.push(batch[n - 1]!.what);
    if (v.problems.length)
      problems.push({ at: batch.map((b) => b.what), problems: v.problems });
  }
  return { faulted, problems };
}

/** The mute lists with the faulted keys added (no duplicates), and how many were new. */
export function muteFaults(
  quiet: QuietLists,
  faulted: string[],
): QuietLists & { newMoments: number; newBreaks: number } {
  const quietMoments = [...(quiet.quietMoments ?? [])];
  const quietBreaks = [...(quiet.quietBreaks ?? [])];
  let newMoments = 0;
  let newBreaks = 0;
  for (const f of faulted) {
    if (f.startsWith("break:")) {
      const i = Number(f.slice(6));
      if (Number.isInteger(i) && !quietBreaks.includes(i)) {
        quietBreaks.push(i);
        newBreaks++;
      }
    } else if (!quietMoments.includes(f)) {
      quietMoments.push(f);
      newMoments++;
    }
  }
  return { quietMoments, quietBreaks, newMoments, newBreaks };
}

/**
 * What the post-render check does with faults: another full render while passes remain, else the video is
 * accepted as it is (the faults stay muted for any later render). `passes` is how many re-renders this
 * episode has already had from the check.
 */
export function passDecision(
  passes: number,
  maxPasses: number,
): "rerender" | "accept" {
  return passes < Math.max(0, maxPasses) ? "rerender" : "accept";
}

/** The owner's one-line notice for a pass of the check, in plain English. */
export function graphicsNotice(
  headline: string,
  stage: "prepass" | "rerender" | "accept",
  checked: number,
  faulted: string[],
  problems: string[],
): string {
  const n = faulted.length;
  const what = faulted.filter((f) => !f.startsWith("break:")).length;
  const breaks = n - what;
  const parts = [
    what ? `${what} graphic${what === 1 ? "" : "s"}` : "",
    breaks ? `${breaks} chapter breather${breaks === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(" and ");
  const why = problems
    .slice(0, 3)
    .map((p) => p.replace(/^frames?\s+\d+[^:]*:\s*/i, ""))
    .join("; ");
  if (stage === "prepass")
    return n
      ? `🎨 "${headline}": the graphics check looked at ${checked} graphics before the render and muted ${parts} (${why}). The video renders once, without them.`
      : `🎨 "${headline}": the graphics check looked at ${checked} graphics before the render and found nothing wrong.`;
  if (stage === "rerender")
    return `🎨 "${headline}": the check of the finished video faulted ${parts} (${why}). They are muted and the video renders again, once.`;
  return `🎨 "${headline}": the check of the finished video faulted ${parts} (${why}). No more re-renders are allowed for it, so it goes out as rendered; they stay muted for any later render.`;
}

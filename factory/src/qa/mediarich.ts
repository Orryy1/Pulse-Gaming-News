// How media rich a Short is (owner, 30 Oct 2026: every video must be fully media rich all the way through).
// The documentaries measure the share of sentences with something chosen for their own words (src/assets/fill.ts
// coverageShare); the Shorts had no such measure, only the rubric's footage share. This reads it off the render
// plan: for every shot, whether what is on screen was chosen for that line (a trailer moment tagged to the beat
// or the hook, a picture tagged to the beat) or the line carries a card (a beat's visual, the take's title card),
// weighted by how long the shot runs. Hook, desk and loop lines have no card, so they count only on matched
// footage. Measured and stored (qa_json.media_rich). Since 31 Oct 2026 the craft planner (src/render/shortcraft.ts)
// reads it to find the bare lines and fills them; the "after" reading counts the fillers' seconds as covered.

import type { RenderPlan } from "../render/plan.ts";
import type { Segment } from "../render/timeline.ts";

export interface MediaRichSegment {
  kind: string;
  seconds: number;
  /** Seconds under footage or a picture chosen for this line. */
  own: number;
  /** The line has a card on screen. */
  graphic: boolean;
}

export interface MediaRichness {
  /** Share of the narration (by time) with its own picture or clip, or a card. */
  covered: number;
  /** Share with a picture or clip chosen for the line. */
  own: number;
  /** Share with a card but nothing chosen for the line. */
  graphicOnly: number;
  seconds: number;
  segments: MediaRichSegment[];
}

/** The measure, from the plan the Short renders with. Shares are 0-1; an empty plan reads as fully covered. */
export function shortMediaRichness(
  segments: Segment[],
  plan: Pick<RenderPlan, "shots" | "fps">,
  images: Array<{ beatIndex?: number }>,
  clips: Array<{ beatIndex?: number; role?: string }>,
  /** Seconds per segment under a filler made for the line's own words (src/render/shortcraft.ts fillSeconds). */
  fills?: Map<number, number>,
): MediaRichness {
  // Which beat (0, 1, 2...) each segment is, so a tag on a clip or picture can be matched to it.
  const beatOf = segments.map((s, i) =>
    s.kind === "beat"
      ? segments.slice(0, i).filter((x) => x.kind === "beat").length
      : undefined,
  );
  const per: MediaRichSegment[] = segments.map((s) => ({
    kind: s.kind,
    seconds: 0,
    own: 0,
    graphic: !!s.visual && s.visual.kind !== "none",
  }));
  for (const shot of plan.shots) {
    const seg = per[shot.segment];
    const s = segments[shot.segment];
    if (!seg || !s) continue;
    const secs = Math.max(0, shot.end - shot.start) / plan.fps;
    seg.seconds += secs;
    const beat = beatOf[shot.segment];
    const m = shot.media;
    const own =
      m.type === "clip"
        ? (s.kind === "hook" && clips[m.index]?.role === "hook") ||
          (beat !== undefined && clips[m.index]?.beatIndex === beat)
        : m.type === "image"
          ? beat !== undefined &&
            images[m.index]?.beatIndex !== undefined &&
            images[m.index]?.beatIndex === beat
          : false;
    if (own) seg.own += secs;
  }
  let total = 0;
  let own = 0;
  let covered = 0;
  per.forEach((seg, i) => {
    total += seg.seconds;
    own += seg.own;
    // A filler covers the stretch it runs over, on top of whatever own footage the line already had.
    const fill = Math.max(0, fills?.get(i) ?? 0);
    covered += seg.graphic
      ? seg.seconds
      : Math.min(seg.seconds, seg.own + fill);
  });
  const share = (x: number) =>
    total > 0 ? Math.round((x / total) * 1000) / 1000 : 1;
  return {
    covered: share(covered),
    own: share(own),
    graphicOnly: share(covered - own),
    seconds: Math.round(total * 10) / 10,
    segments: per.map((p) => ({
      ...p,
      seconds: Math.round(p.seconds * 10) / 10,
      own: Math.round(p.own * 10) / 10,
    })),
  };
}

/** The evening-summary line when a Short is under the target. */
export function mediaRichNotice(
  headline: string,
  m: MediaRichness,
  target: number,
): string {
  const pc = (x: number) => `${Math.round(x * 100)}%`;
  return `🎞️ "${headline}": ${pc(m.covered)} of its narration has something chosen for its own words on screen (${pc(m.own)} a trailer moment or picture matched to the line, ${pc(m.graphicOnly)} a card), under the ${pc(target)} target. It renders as it is; this is measured only for now.`;
}

/** Per segment: a bare line, with no card and under half its time on footage or a picture chosen for it. */
export function bareLines(m: MediaRichness): boolean[] {
  return m.segments.map((s) => s.seconds > 0 && !s.graphic && s.own < s.seconds * 0.5);
}

// The render step's footage-first pass and footage measure (src/pipeline.ts stepRenderLong calls both): once
// per long video, before the per-sentence picture top-up, every released game's chapter gathers Creative
// Commons gameplay (./footagefirst.ts) and the new clips join assets.clips; after the plan is made, the share of
// narrated game-chapter time on moving game footage is logged and told to the owner against
// FOOTAGE_SHARE_TARGET. Behind FOOTAGE_FIRST (default on); assets.footageFirst records the run so a retried
// render does not gather twice.

import {
  footageNotice,
  footageShare,
  gatherFootageFirst,
  WORDS_PER_SECOND,
  type FootageChapter,
  type FootageFirstDeps,
  type FootageFirstOptions,
  type FootageReport,
  type ShareShot,
} from "./footagefirst.ts";

type Clip = {
  file: string;
  sourceUrl: string;
  provenance: string;
  durationSeconds: number;
  beatIndex?: number;
  moment?: number;
  stock?: boolean;
  credit?: string;
  label?: string;
  startSeconds?: number;
  motion?: number;
  span?: { source: string; from: number; to: number };
};

/** Seconds a chapter's narration runs, from its words (WORDS_PER_SECOND), before the words are timed. */
export function chapterSeconds(sentences: string[]): number {
  const words = sentences.join(" ").split(/\s+/).filter(Boolean).length;
  return words / WORDS_PER_SECOND;
}

/**
 * Gathers and appends the footage; returns the report (also for assets.footageFirst). The chapters come in
 * on-screen order (entry = the clips' beatIndex), with the franchise for the title checks.
 */
export async function runFootageFirst(args: {
  deps: FootageFirstDeps;
  chapters: FootageChapter[];
  clips: Clip[];
  dir: string;
  options: FootageFirstOptions;
  headline: string;
  logEvent: (kind: string, detail: Record<string, unknown>) => Promise<void>;
  notify: (m: { level: "info"; content: string }) => Promise<unknown>;
  /** Proof runs keep each refused segment's frame here for a contact sheet. */
  keepFrames?: string;
}): Promise<FootageReport> {
  const { clips: added, report } = await gatherFootageFirst(
    args.deps,
    args.chapters.map((c) => ({ ...c, seconds: chapterSeconds(c.sentences) })),
    args.clips,
    args.dir,
    args.options,
    args.keepFrames,
  );
  for (const c of added)
    args.clips.push({
      file: c.file,
      sourceUrl: c.sourceUrl,
      provenance: c.provenance,
      durationSeconds: c.durationSeconds,
      beatIndex: c.beatIndex,
      moment: c.moment,
      credit: c.credit,
      label: c.label,
      startSeconds: c.startSeconds,
      motion: c.motion,
      span: c.span,
    });
  await args.logEvent("footage_first", {
    ...report,
    // The event keeps counts and reasons, not every refused title.
    sourcesRejected: reasons(report.sourcesRejected),
    segmentsRejected: reasons(report.segmentsRejected),
  });
  if (report.chapters || report.skipped.length)
    await args.notify({
      level: "info",
      content: footageNotice(args.headline, report),
    });
  return report;
}

function reasons(xs: Array<{ why: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x.why] = (out[x.why] ?? 0) + 1;
  return out;
}

/** The plan's footage share in game chapters, per chapter as well (entries named by game). */
export function measureFootage(args: {
  shots: ShareShot[];
  fps: number;
  segments: Array<{ kind: string }>;
  entryOf: (segment: number) => number | undefined;
  clips: Array<{ stock?: boolean }>;
}): ReturnType<typeof footageShare> {
  return footageShare(
    args.shots,
    args.fps,
    (seg) =>
      args.segments[seg]?.kind === "beat" ? args.entryOf(seg) : undefined,
    (k) => Boolean(args.clips[k]?.stock),
  );
}

/** The owner's one line about the plan's footage, and whether it met the target. */
export function footageShareNotice(
  headline: string,
  m: ReturnType<typeof footageShare>,
  target: number,
  games: string[],
): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const low = [...m.perChapter]
    .filter(([, s]) => s * 100 < target)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([c, s]) => `${games[c] ?? `chapter ${c + 1}`} ${pct(s)}`);
  return `🎞️ "${headline}": moving game footage fills ${pct(m.share)} of the narrated game chapters (target ${target}%, FOOTAGE_SHARE_TARGET)${m.stock ? `, stock clips another ${pct(m.stock / Math.max(1, m.seconds))}` : ""}.${low.length ? ` Lowest: ${low.join(", ")}: the rest is stills, graphics and filler visuals.` : ""}`;
}


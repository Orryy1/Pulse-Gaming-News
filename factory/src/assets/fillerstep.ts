// The render step's filler pass (src/pipeline.ts stepRenderLong calls it once per long video, after the
// sentence top-up and the graphics for bare lines): the reconstructions are chosen and frame-checked for the
// whole video, every family is asked about every bare or stock-only sentence (./fillers.ts), the picks are
// written on the shot list (moment.filler), and the owner hears the outcome in one plain line. Behind
// FILLERS_ENABLED (default on); the decision is recorded as assets.fillersChosen so a retried render keeps it.

import path from "node:path";
import { log } from "../lib/util.ts";
import { checkReconClip } from "./reconcheck.ts";
import type { ReconClipCheck } from "./recon.ts";
import {
  applyFillers,
  chooseFillers,
  fillersEvent,
  fillersNotice,
  reconPicks,
  type FillerClip,
  type FillerImage,
  type FillersChapter,
} from "./fillers.ts";
import { isLocalVideo } from "../render/components/localvideo/plan.ts";
import {
  createLocalVideoRun,
  localVideoNotice,
  orchGpuLease,
  type LocalVideoClip,
  type LocalVideoItem,
  type LocalVideoSummary,
} from "./localvideo.ts";

/**
 * AI motion for a few kept concept sketches (ILLUSTRATE_VIDEO_ENABLED, off by default; ./localvideo.ts): the
 * sketch pass's pinned sketches of lines with movement, animated on this PC's own video model in one GPU
 * turn from the orchestrator, each clip pinned to its sentence (assets.clips) for the render to tape to the
 * desk as its print. Returns the run's summary, or undefined when there was nothing to animate.
 */
export async function animateSketches(args: {
  chapters: Array<FillersChapter & { place?: string }>;
  images: FillerImage[];
  clips: LocalVideoClip[];
  dir: string;
  episodeId: string;
  url: string;
  max: number;
  stub: boolean;
  timeoutMs: number;
  headline: string;
  logEvent: (kind: string, detail: Record<string, unknown>) => Promise<void>;
  notify: (m: { level: "info"; content: string }) => Promise<unknown>;
}): Promise<LocalVideoSummary | undefined> {
  const items: LocalVideoItem[] = [];
  for (const im of args.images) {
    if (im.kind !== "sketch" || im.moment === undefined) continue;
    const ch = args.chapters.find((c) => c.entry === im.beatIndex);
    const m = ch?.moments[im.moment];
    if (!ch || !m) continue;
    items.push({
      entry: ch.entry,
      moment: im.moment,
      sentence: ch.sentences[im.moment] ?? "",
      shot: {
        show: m.show ?? "",
        person: m.person,
        broll: m.broll,
        graphic: m.graphic,
      },
      chapter: { game: ch.game, year: ch.year },
      sketch: im.file,
    });
  }
  if (!items.length) return undefined;
  const run = createLocalVideoRun({
    dir: args.dir,
    episodeId: args.episodeId,
    url: args.url,
    max: args.max,
    stub: args.stub,
    timeoutMs: args.timeoutMs,
    lease: args.stub ? undefined : orchGpuLease(),
  });
  try {
    await run.animateAll(items, args.clips);
  } catch (err) {
    log("warn", "AI motion clips skipped", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  const sum = run.summary();
  await args.logEvent("localvideo", { ...sum });
  const line = localVideoNotice(args.headline, sum);
  if (line) await args.notify({ level: "info", content: line });
  return sum;
}

export interface FillerStepResult {
  chosen: number;
  counts: Record<string, number>;
  at: string;
}

/** A clip's three-frame picture check, read only, from the episode's folder. */
export function episodeClipCheck(dir: string): ReconClipCheck {
  return async (clip) => {
    const v = await checkReconClip(
      path.join(dir, clip.file),
      clip.durationSeconds ?? 0,
    );
    return { ok: v.ok, reason: v.reason };
  };
}

/**
 * Chooses and stores the documentary's fillers. Writes moment.filler on `chapters` (the script's own moment
 * objects) and returns what assets.fillersChosen records. Never throws: a failed pass leaves the lines as
 * they were and says so in the log.
 */
export async function chooseEpisodeFillers(args: {
  chapters: FillersChapter[];
  images: FillerImage[];
  clips: FillerClip[];
  variant: number;
  sketches: boolean;
  check: ReconClipCheck;
  now: Date;
  headline: string;
  /** The owner's word for the format in the notice (src/longformat.ts longKindLabel); default Documentary. */
  kind?: string;
  logEvent: (kind: string, detail: Record<string, unknown>) => Promise<void>;
  notify: (m: { level: "info"; content: string }) => Promise<unknown>;
}): Promise<FillerStepResult | undefined> {
  try {
    const recon = await reconPicks(
      args.chapters,
      args.images,
      args.clips,
      args.check,
    );
    const choice = chooseFillers(args.chapters, {
      images: args.images,
      clips: args.clips,
      seed: args.variant,
      recon: recon.picks,
      sketches: args.sketches,
    });
    applyFillers(args.chapters, choice);
    const sketches = args.images.filter(
      (i) => i.kind === "sketch" && i.moment !== undefined,
    ).length;
    const localvideo = args.clips.filter(
      (c) => isLocalVideo(c) && c.moment !== undefined,
    ).length;
    await args.logEvent(
      "fillers",
      fillersEvent(choice, {
        sketches,
        localvideo,
        reconRefused: recon.refused.size,
      }),
    );
    log("info", "filler visuals chosen", {
      chosen: choice.picks.length,
      counts: choice.counts,
      left: choice.left.length,
    });
    await args.notify({
      level: "info",
      content: fillersNotice(args.headline, choice, args.kind),
    });
    return {
      chosen: choice.picks.length,
      counts: choice.counts as Record<string, number>,
      at: args.now.toISOString(),
    };
  } catch (err) {
    log("warn", "filler visuals skipped", {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

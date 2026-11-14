// "GTA 6 vs GTA 5" (PULSE_LAB_VERSUS; research 14 Nov section A: "What happens if... in every GTA game" is the
// strongest pattern found, The GTA Scientist's 99.8M views in five months). One test, the same test in both games,
// shown as a split screen: GTA 6 on top, GTA 5 below, each with its own outcome, the verdict on the seam.
//
// It only runs when both games' footage of the same test exists. The GTA 6 side is the gameplay Short's own clip. The
// GTA 5 side comes from the owner's library: his stream index (src/vodindex, every recording searched with the same
// cues the miner uses for the ask) and the gameplay inbox's clips the reviewer saw were GTA V. No GTA 5 footage of the
// same test: the format skips itself, and the Short goes out as it would have.

import path from "node:path";
import { tokens } from "../sceneindex/lookup.ts";
import { findMoments } from "../streamasks/miner.ts";
import type { AskCues } from "../streamasks/asks.ts";
import { overlap, topicOf } from "../streamasks/asks.ts";
import type { VodIndex } from "../vodindex/schema.ts";

export interface LibraryClip {
  /** The inbox clip's folder id ("gp_..."). */
  id: string;
  /** The clip file, absolute. */
  file: string;
  game: string;
  seconds: number;
  /** Where the clip's peak is (meta.clip.peak_in_clip), when known. */
  peak?: number;
  /** What the reviewer said of it, and its question when it was kept. */
  text: string;
}

export interface VersusSource {
  kind: "inbox" | "vod";
  file: string;
  /** The second of the source the outcome lands at. */
  peak: number;
  /** The source's length. */
  duration: number;
  /** Why it was matched, for the plan and the Discord card. */
  why: string;
  ref: string;
}

/** True for the compare game's own name (GTA V, never GTA VI or IV). */
export function isCompareGame(game: string, compare: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/grand theft auto/g, "gta")
      .replace(/\s+/g, " ")
      .trim();
  const g = norm(game);
  const c = norm(compare);
  if (g === c) return true;
  // "GTA V" and "GTA 5" are the same game; "GTA VI", "GTA IV" and "GTA 6" are not.
  const five = /^gta (v|5)$/;
  return five.test(c) && five.test(g);
}

/**
 * The compare game's footage of the same test (pure, given what the library holds): the stream index first (a moment
 * the ask's cues find with two kinds of evidence), then an inbox clip about the same topic or most of the same words.
 * Undefined when there is none: the format skips itself.
 */
export function findCounterpart(
  ask: { id: string; question: string; cues: AskCues; topic?: string },
  compareGame: string,
  lib: { vods: VodIndex[]; clips: LibraryClip[] },
): VersusSource | undefined {
  for (const vod of lib.vods.filter((v) =>
    isCompareGame(v.game, compareGame),
  )) {
    const best = findMoments(vod, ask, { minCue: 0.5, max: 1 })[0];
    if (best && best.signals.length >= 2)
      return {
        kind: "vod",
        file: vod.file,
        peak: best.peak,
        duration: vod.duration,
        why: `stream ${vod.vodId} at ${Math.round(best.peak)} s (${best.signals.join(", ")})`,
        ref: vod.vodId,
      };
  }
  const topic = ask.topic ?? topicOf(ask.question, "Grand Theft Auto")?.id;
  const scored = lib.clips
    .filter((c) => isCompareGame(c.game, compareGame))
    .map((c) => ({
      c,
      topic: !!topic && topicOf(c.text, "Grand Theft Auto")?.id === topic,
      o: overlap(c.text, ask.question),
    }))
    .filter((x) => x.topic || x.o >= 0.5)
    .sort((a, b) => Number(b.topic) - Number(a.topic) || b.o - a.o);
  const hit = scored[0];
  if (!hit) return undefined;
  return {
    kind: "inbox",
    file: hit.c.file,
    peak: hit.c.peak ?? hit.c.seconds / 2,
    duration: hit.c.seconds,
    why: hit.topic
      ? `inbox clip ${hit.c.id}, same test (${topic})`
      : `inbox clip ${hit.c.id}, ${Math.round(hit.o * 100)}% the same words`,
    ref: hit.c.id,
  };
}

/** Why the format skips, for the plan (pure). */
export function versusSkip(o: {
  compareGame: string;
  question: string;
}): string {
  return `no ${o.compareGame} footage of "${o.question}" in the stream index or the inbox yet`;
}

/**
 * The compare side's window (pure): its outcome lands on the same second as the GTA 6 side's, for the whole Short.
 * When the source has too little before its outcome, the window starts at 0 and the first frame is held (padStart).
 */
export function counterpartWindow(
  src: Pick<VersusSource, "peak" | "duration">,
  payoffAt: number,
  seconds: number,
): { start: number; length: number; padStart: number; padEnd: number } {
  const start = src.peak - payoffAt;
  const padStart = start < 0 ? round(-start) : 0;
  const from = Math.max(0, start);
  const length = Math.max(
    0.5,
    Math.min(seconds - padStart, src.duration - from),
  );
  const padEnd = Math.max(0, round(seconds - padStart - length));
  return { start: round(from), length: round(length), padStart, padEnd };
}

/** The pane's size on the 1080x1920 Short: two 16:9 panes stacked. */
export const PANE = { width: 1080, height: 608 } as const;

/** ffmpeg arguments for the GTA 6 pane (pure): the Short's own segments joined, whole 16:9 frame, game sound kept. */
export function versusPrimaryArgs(
  source: string,
  segments: Array<{ start: number; end: number }>,
  out: string,
  tone = "",
): string[] {
  const parts: string[] = [];
  const labels: string[] = [];
  segments.forEach((s, i) => {
    parts.push(
      `[0:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS[v${i}]`,
      `[0:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS[a${i}]`,
    );
    labels.push(`[v${i}][a${i}]`);
  });
  parts.push(`${labels.join("")}concat=n=${segments.length}:v=1:a=1[jv][ja]`);
  parts.push(
    `[jv]${tone}scale=${PANE.width}:${PANE.height}:force_original_aspect_ratio=increase,crop=${PANE.width}:${PANE.height},tpad=stop_mode=clone:stop_duration=4,fps=30,format=yuv420p[vout]`,
  );
  return [
    "-v",
    "error",
    "-y",
    "-i",
    source,
    "-filter_complex",
    parts.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[ja]",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    out,
  ];
}

/** ffmpeg arguments for the compare pane (pure): the aligned window, held frames at either end, no sound. */
export function versusCounterpartArgs(
  source: string,
  w: ReturnType<typeof counterpartWindow>,
  out: string,
): string[] {
  const pad =
    w.padStart > 0 || w.padEnd > 0
      ? `,tpad=start_mode=clone:start_duration=${w.padStart}:stop_mode=clone:stop_duration=${w.padEnd}`
      : "";
  return [
    "-v",
    "error",
    "-y",
    "-ss",
    w.start.toFixed(2),
    "-t",
    w.length.toFixed(2),
    "-i",
    source,
    "-an",
    "-vf",
    `scale=${PANE.width}:${PANE.height}:force_original_aspect_ratio=increase,crop=${PANE.width}:${PANE.height}${pad},fps=30,format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "20",
    out,
  ];
}

/** The two panes' file names in the episode folder. */
export const VERSUS_FILES = {
  primary: "versus-a.mp4",
  counterpart: "versus-b.mp4",
} as const;

/** Inbox clips as library clips (pure), from each clip folder's meta. */
export function libraryClips(
  root: string,
  metas: Array<{
    id: string;
    clip: { file: string; seconds: number; peak_in_clip?: number };
    review?: { game?: string; reason?: string };
  }>,
): LibraryClip[] {
  return metas
    .filter((m) => m.review?.game)
    .map((m) => ({
      id: m.id,
      file: path.join(root, "inbox", m.id, m.clip.file || "clip.mp4"),
      game: m.review!.game!,
      seconds: m.clip.seconds,
      ...(m.clip.peak_in_clip !== undefined
        ? { peak: m.clip.peak_in_clip }
        : {}),
      text: m.review!.reason ?? "",
    }));
}

/** Words a split-screen caption may use for each side's outcome (pure): short, capitals. */
export function sideResult(text: string): string {
  const t = tokens(text).length ? text : "";
  return t.replace(/\s+/g, " ").trim().slice(0, 28).toUpperCase();
}

const round = (n: number) => Math.round(n * 100) / 100;

// How much of a long video sits on the empty slate: the dark card with the game's name behind the chapter strip,
// which the plan falls back to when it has nothing to show. The Final Fantasy XIV documentary of 4 Nov 2026 spent a
// large part of its 25 minutes there and passed the release gate at 2.13, because the gate scored one frame per shot
// and a slate under a line about "the backlash" still reads as "the right game". Measured two ways: from the plan
// before the render (src/pipeline.ts stops a video that would sit there), and from the finished picture at release.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";

const run = promisify(execFile);

/** Graphic kinds that are a small corner card on the house design: the slate around them is still empty. */
export const CORNER_KINDS = new Set([
  "stat",
  "date",
  "list",
  "compare",
  "score",
]);

export interface SlateInput {
  plan: {
    fps: number;
    totalFrames?: number;
    tailFrames?: number;
    shots: ReadonlyArray<{
      start: number;
      end: number;
      media: { type: string; index: number };
    }>;
  };
  /** When each sentence is on screen (src/render/longplan.ts momentWindows), in seconds. */
  windows: ReadonlyArray<{
    entry: number;
    moment: number;
    start: number;
    end: number;
  }>;
  /** The shot list in on-screen order. */
  moments: ReadonlyArray<
    ReadonlyArray<{ graphic?: { kind?: string } | null; filler?: unknown }>
  >;
  /** Graphics the check left out ("entry:moment"): nothing is drawn for them. */
  quiet?: readonly string[];
  /** The clips, for telling real footage from stock. */
  clips?: ReadonlyArray<{ stock?: boolean; beatIndex?: number }>;
}

export interface SlateReading {
  /** Seconds of video the plan covers. */
  seconds: number;
  /** Seconds on the slate with nothing but a corner card over it. */
  slateSeconds: number;
  /** Their share of the video, 0-1. */
  share: number;
  /** Share of the video on game footage (clips other than stock), 0-1. */
  footageShare: number;
  /** Share of the video on the slate at all, under a full-screen graphic or not, 0-1. */
  plateShare: number;
}

/** Reads a plan. Slate under a full-screen graphic or filler has something on screen; under a corner card it hasn't. */
export function planSlate(input: SlateInput): SlateReading {
  const { plan } = input;
  const quiet = new Set(input.quiet ?? []);
  const covers = input.windows
    .filter((w) => {
      const m = input.moments[w.entry]?.[w.moment];
      if (!m || quiet.has(`${w.entry}:${w.moment}`)) return false;
      if (m.filler) return true;
      const kind = m.graphic?.kind;
      return !!kind && kind !== "none" && !CORNER_KINDS.has(kind);
    })
    .map((w) => [w.start, w.end] as const)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let plate = 0;
  let slate = 0;
  let footage = 0;
  for (const shot of plan.shots) {
    const from = shot.start / plan.fps;
    const to = shot.end / plan.fps;
    const len = Math.max(0, to - from);
    total += len;
    if (shot.media.type === "clip" && !input.clips?.[shot.media.index]?.stock)
      footage += len;
    if (shot.media.type !== "plate") continue;
    plate += len;
    // What is left of this slate shot once the graphics over it are taken away.
    let at = from;
    let bare = 0;
    for (const [a, b] of covers) {
      if (b <= at) continue;
      if (a >= to) break;
      if (a > at) bare += a - at;
      at = Math.max(at, b);
      if (at >= to) break;
    }
    if (at < to) bare += to - at;
    slate += bare;
  }
  const of = (x: number) => (total > 0 ? x / total : 0);
  return {
    seconds: total,
    slateSeconds: slate,
    share: of(slate),
    footageShare: of(footage),
    plateShare: of(plate),
  };
}

/** Small frames for the picture test: wide enough to see a card, narrow enough to read a whole video in seconds. */
export const SCAN_W = 96;
export const SCAN_H = 54;

/**
 * Whether a small grey frame shows nothing: dark throughout apart from the furniture at the top and bottom. The
 * slate's faint title is far under the brightness test; a corner card or a dark game scene with any light in it is
 * over the share. Text alone at the very edge is the chapter strip and the logo.
 */
export function emptyFrame(
  gray: Uint8Array | number[],
  w = SCAN_W,
  h = SCAN_H,
): boolean {
  const top = Math.floor(h * 0.14);
  const bottom = Math.floor(h * 0.84);
  let n = 0;
  let lit = 0;
  let sum = 0;
  for (let y = top; y < bottom; y++)
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x]!;
      sum += v;
      n++;
      if (v > 62) lit++;
    }
  return n > 0 && sum / n < 34 && lit / n < 0.012;
}

export interface FrameScan {
  frames: number;
  empty: number;
  /** Share of the sampled frames that show nothing, 0-1. */
  share: number;
  /** The seconds they sit at, to look at by eye. */
  at: number[];
}

/**
 * Reads the finished picture: the video's keyframes only, so a 25-minute 4K film takes seconds rather than a full
 * decode. Keyframes come at cuts as well as on a schedule, so frames are weighted by how long each one stands for.
 */
export async function scanVideo(video: string): Promise<FrameScan> {
  const { stdout } = await run(
    FFMPEG,
    [
      "-loglevel",
      "error",
      "-skip_frame",
      "nokey",
      "-i",
      video,
      "-fps_mode",
      "vfr",
      "-vf",
      `scale=${SCAN_W}:${SCAN_H},format=gray,showinfo`,
      "-f",
      "rawvideo",
      "-",
    ],
    { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 },
  ).catch((err) => {
    throw new Error(`could not read frames: ${String(err).slice(0, 200)}`);
  });
  const size = SCAN_W * SCAN_H;
  const count = Math.floor(stdout.length / size);
  const times = await keyframeTimes(video).catch(() => [] as number[]);
  let weight = 0;
  let emptyWeight = 0;
  let empty = 0;
  const at: number[] = [];
  for (let i = 0; i < count; i++) {
    const frame = stdout.subarray(i * size, (i + 1) * size);
    const t = times[i] ?? i;
    const next = times[i + 1] ?? t + 1;
    const w = Math.max(0.04, next - t);
    weight += w;
    if (emptyFrame(frame)) {
      empty++;
      emptyWeight += w;
      at.push(Math.round(t));
    }
  }
  return { frames: count, empty, share: weight ? emptyWeight / weight : 0, at };
}

async function keyframeTimes(video: string): Promise<number[]> {
  const { stdout } = await run(
    FFMPEG.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1"),
    [
      "-v",
      "error",
      "-skip_frame",
      "nokey",
      "-select_streams",
      "v:0",
      "-show_entries",
      "frame=pts_time",
      "-of",
      "csv=p=0",
      video,
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout
    .split(/\r?\n/)
    .map((l) => Number(l.split(",")[0]))
    .filter((n) => Number.isFinite(n));
}

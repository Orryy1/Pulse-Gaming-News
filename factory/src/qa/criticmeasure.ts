// The critic's measurements of the finished MP4 at its full frame rate (CRITIC, src/qa/criticcore.ts): one decode of
// the picture into small grey frames, read as a stream so a 30-minute 4K film never sits in memory, gives black and
// white flashes, frozen stretches and the cuts; one pass over the sound gives true silence. Frames for the judges are
// pulled at exact times, a few at once. The analysis of the frame numbers is pure and unit tested; only the ffmpeg
// calls touch the disk.

import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FFMPEG, FFPROBE } from "../lib/bin.ts";
import type { Measurements, Span } from "./criticcore.ts";

const run = promisify(execFile);

/** The grey frames' size: enough detail to see a camera push, small enough to stream 50,000 frames quickly. */
export const MEASURE_W = 160;
export const MEASURE_H = 90;

/** One frame's numbers: its mean brightness, its darkest-to-brightest spread and how much it changed from the last. */
export interface FrameStat {
  mean: number;
  max: number;
  /** Mean absolute difference from the previous frame (0-255); 0 for the first. */
  diff: number;
}

/** A frame's numbers from its grey bytes and the previous frame's (pure). */
export function frameStat(
  gray: Uint8Array,
  prev: Uint8Array | undefined,
): FrameStat {
  let sum = 0;
  let max = 0;
  let diff = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i]!;
    sum += v;
    if (v > max) max = v;
    if (prev) diff += Math.abs(v - prev[i]!);
  }
  const n = gray.length || 1;
  return { mean: sum / n, max, diff: prev ? diff / n : 0 };
}

export interface AnalyseOpts {
  fps: number;
  /** A frame this dark throughout is black (mean and brightest pixel, 0-255). */
  blackMean?: number;
  blackMax?: number;
  /** A frame this bright on average is a white flash. */
  whiteMean?: number;
  /** Under this change a frame counts as unchanged (0-255 mean difference). */
  stillDiff?: number;
  /** Shortest frozen stretch reported (seconds). */
  minFrozen?: number;
  /** A change this big, and this many times the frame before's, is a cut. */
  cutDiff?: number;
  cutRatio?: number;
}

/** Black, white and frozen stretches and the cuts, from every frame's numbers (pure). */
export function analyseFrames(
  stats: readonly FrameStat[],
  o: AnalyseOpts,
): Omit<Measurements, "silence"> {
  const fps = o.fps;
  const blackMean = o.blackMean ?? 18;
  const blackMax = o.blackMax ?? 40;
  const whiteMean = o.whiteMean ?? 235;
  const stillDiff = o.stillDiff ?? 0.12;
  const minFrozen = o.minFrozen ?? 1.0;
  const cutDiff = o.cutDiff ?? 22;
  const cutRatio = o.cutRatio ?? 3;
  const black: Span[] = [];
  const white: Span[] = [];
  const frozen: Span[] = [];
  const cuts: number[] = [];
  const t = (i: number) => Math.round((i / fps) * 1000) / 1000;
  const runs = (
    test: (s: FrameStat, i: number) => boolean,
    out: Span[],
    minFrames: number,
  ) => {
    let from = -1;
    for (let i = 0; i <= stats.length; i++) {
      const on = i < stats.length && test(stats[i]!, i);
      if (on && from < 0) from = i;
      if (!on && from >= 0) {
        if (i - from >= minFrames) out.push({ start: t(from), end: t(i) });
        from = -1;
      }
    }
  };
  runs((s) => s.mean <= blackMean && s.max <= blackMax, black, 1);
  // The bottom of a fade: the picture dims over the frames before and brightens over the frames after.
  for (const b of black) {
    const first = Math.round(b.start * fps);
    const last = Math.round(b.end * fps);
    const at = (i: number) => stats[Math.max(0, Math.min(stats.length - 1, i))]!.mean;
    const k = Math.max(3, Math.round(fps / 6));
    const dimming = at(first - 1) < at(first - k) * 0.8 && at(first - 1) <= at(first - 2) + 0.5;
    const brightening = last >= stats.length || (at(last) < at(last + k - 1) * 0.8 && at(last) <= at(last + 1) + 0.5);
    if (first > 0 && dimming && brightening) b.dip = true;
  }
  runs((s) => s.mean >= whiteMean, white, 1);
  // A frozen stretch: frames that barely change from the one before. The first frame of the run is the last change.
  runs(
    (s, i) =>
      i > 0 &&
      s.diff < stillDiff &&
      !(s.mean <= blackMean && s.max <= blackMax),
    frozen,
    Math.round(minFrozen * fps),
  );
  for (let i = 1; i < stats.length; i++) {
    const d = stats[i]!.diff;
    const before = stats[i - 1]!.diff;
    if (d >= cutDiff && d >= cutRatio * Math.max(1, before)) cuts.push(t(i));
  }
  return { black, white, frozen, cuts };
}

/** Silence spans from ffmpeg's silencedetect lines (pure). */
export function parseSilence(stderr: string, duration: number): Span[] {
  const out: Span[] = [];
  let start: number | undefined;
  for (const line of stderr.split(/\r?\n/)) {
    const a = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (a) start = Math.max(0, Number(a[1]));
    const b = line.match(/silence_end:\s*([\d.]+)/);
    if (b && start !== undefined) {
      out.push({ start, end: Number(b[1]) });
      start = undefined;
    }
  }
  if (start !== undefined) out.push({ start, end: duration });
  return out;
}

/** The video's length and frame rate (ffprobe). */
export async function probeVideo(
  file: string,
): Promise<{ duration: number; fps: number }> {
  const { stdout } = await run(
    FFPROBE,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=r_frame_rate:format=duration",
      "-of",
      "json",
      file,
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  const j = JSON.parse(stdout) as {
    streams?: Array<{ r_frame_rate?: string }>;
    format?: { duration?: string };
  };
  const [n, d] = String(j.streams?.[0]?.r_frame_rate ?? "30/1")
    .split("/")
    .map(Number);
  const fps = n && d ? n / d : 30;
  return { duration: Number(j.format?.duration ?? 0), fps };
}

/** Every frame's numbers, streamed out of one ffmpeg decode. */
export async function frameStats(file: string): Promise<FrameStat[]> {
  const size = MEASURE_W * MEASURE_H;
  return new Promise((resolve, reject) => {
    const child = spawn(
      FFMPEG,
      [
        "-loglevel",
        "error",
        "-i",
        file,
        "-an",
        "-vf",
        `scale=${MEASURE_W}:${MEASURE_H}:flags=area,format=gray`,
        "-f",
        "rawvideo",
        "-",
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    const stats: FrameStat[] = [];
    let prev: Uint8Array | undefined;
    let pending: Buffer = Buffer.alloc(0);
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let off = 0;
      while (pending.length - off >= size) {
        const frame = new Uint8Array(pending.subarray(off, off + size));
        stats.push(frameStat(frame, prev));
        prev = frame;
        off += size;
      }
      pending = pending.subarray(off);
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(stats)
        : reject(
            new Error(
              `ffmpeg could not read the frames (${code}): ${err.slice(0, 300)}`,
            ),
          ),
    );
  });
}

/** True silence in the mix: under -50 dB for at least half a second. */
export async function silenceSpans(
  file: string,
  duration: number,
): Promise<Span[]> {
  const { stderr } = await run(
    FFMPEG,
    [
      "-hide_banner",
      "-nostats",
      "-i",
      file,
      "-vn",
      "-af",
      "silencedetect=noise=-50dB:d=0.5",
      "-f",
      "null",
      "-",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return parseSilence(String(stderr), duration);
}

/** All the measurements of one finished video. */
export async function measureVideo(
  file: string,
  o: Partial<AnalyseOpts> = {},
): Promise<Measurements & { duration: number; fps: number }> {
  const { duration, fps } = await probeVideo(file);
  const [stats, silence] = await Promise.all([
    frameStats(file),
    silenceSpans(file, duration).catch(() => [] as Span[]),
  ]);
  return { ...analyseFrames(stats, { ...o, fps }), silence, duration, fps };
}

/**
 * Frames at these times as JPEGs in `dir` (`prefix_0001.jpg`...), `width` pixels wide, `parallel` ffmpeg runs at a
 * time. Accurate seeking (the seek after the input is not used: before it, ffmpeg still decodes to the exact frame).
 */
export async function framesAt(
  file: string,
  dir: string,
  times: readonly number[],
  o: { prefix?: string; width?: number; parallel?: number } = {},
): Promise<string[]> {
  await fs.mkdir(dir, { recursive: true });
  const prefix = o.prefix ?? "f";
  const width = o.width ?? 512;
  const out = times.map((_, i) =>
    path.join(dir, `${prefix}_${String(i).padStart(4, "0")}.jpg`),
  );
  let next = 0;
  const worker = async () => {
    while (next < times.length) {
      const i = next++;
      await run(FFMPEG, [
        "-loglevel",
        "error",
        "-y",
        "-ss",
        times[i]!.toFixed(3),
        "-i",
        file,
        "-frames:v",
        "1",
        "-vf",
        `scale=${width}:-2`,
        "-q:v",
        "3",
        out[i]!,
      ]).catch(() => undefined);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(o.parallel ?? 4, times.length)) },
      worker,
    ),
  );
  const ok = await Promise.all(
    out.map((f) =>
      fs.access(f).then(
        () => f,
        () => "",
      ),
    ),
  );
  return ok;
}

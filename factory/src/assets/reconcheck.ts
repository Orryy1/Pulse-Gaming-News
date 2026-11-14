// Checks a clip's pictures before it may serve as an in-game reconstruction (src/assets/recon.ts). The clip
// labeller describes one frame, and the 31 Oct 2026 contact sheet showed what that misses: a clip labelled
// "Helicopter flying over building" was a close-up of the helicopter's underside, a "car on a dark highway"
// was nearly black, and an "empty highway from above" was a flat grey wash. No model is called here: three
// frames across the clip are sampled with ffmpeg as small greyscale pictures and measured. A frame passes when
// it is bright enough to read (mean luma, the YAVG ffmpeg's signalstats reports, at least 18%, unless a
// tenth of the picture is bright: a dark dusk street under a lit sky reads), not mostly one flat tone,
// and has enough edges to show a place (a Laplacian edge density); the clip passes when at least two of its
// three frames do. Thresholds were set on that sheet: every good pick passes and those three fail.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";

const run = promisify(execFile);

/** Frames are measured at this size (greyscale), small enough to be quick, big enough for edges. */
export const CHECK_W = 192;
export const CHECK_H = 108;
/** Where in the clip the three frames are taken, as shares of its length. */
export const SAMPLE_AT = [0.2, 0.5, 0.8] as const;

/** Below this mean luma (0-255, 18%) a frame is too dark to read. */
export const MIN_LUMA = 0.18 * 255;
/** A dark frame still reads when its brightest tenth reaches this (a lit sky, a neon sign). */
export const BRIGHT_P90 = 90;
/** Above this share of pixels within a few levels of the median, a frame is one flat tone. */
export const MAX_FLAT = 0.6;
/** Below this share of pixels on an edge, a frame has no detail to show a place. */
export const MIN_EDGES = 0.06;
/** A pixel counts as an edge when its 4-neighbour Laplacian is at least this strong. */
const EDGE_LEVEL = 24;
/** Pixels this close to the median luma count as the flat tone. */
const FLAT_LEVELS = 6;

export interface FrameStats {
  luma: number; // mean, 0-255
  p90: number; // 90th percentile luma
  flat: number; // share of pixels within FLAT_LEVELS of the median
  edges: number; // share of pixels with a strong Laplacian
}

/** Luma, flatness and edge density of a greyscale picture (one byte per pixel, row by row). */
export function frameStats(gray: Uint8Array, w: number, h: number): FrameStats {
  const n = w * h;
  if (!n || gray.length < n) return { luma: 0, p90: 0, flat: 1, edges: 0 };
  let sum = 0;
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < n; i++) {
    sum += gray[i]!;
    hist[gray[i]!]!++;
  }
  let p90 = 0;
  for (let acc = 0; p90 < 256; p90++) {
    acc += hist[p90]!;
    if (acc >= n * 0.9) break;
  }
  let median = 0;
  for (let acc = 0; median < 256; median++) {
    acc += hist[median]!;
    if (acc >= n / 2) break;
  }
  let flat = 0;
  for (
    let v = Math.max(0, median - FLAT_LEVELS);
    v <= Math.min(255, median + FLAT_LEVELS);
    v++
  )
    flat += hist[v]!;
  let edges = 0;
  let inner = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap =
        4 * gray[i]! -
        gray[i - 1]! -
        gray[i + 1]! -
        gray[i - w]! -
        gray[i + w]!;
      inner++;
      if (Math.abs(lap) >= EDGE_LEVEL) edges++;
    }
  return {
    luma: Math.round((sum / n) * 10) / 10,
    p90,
    flat: Math.round((flat / n) * 1000) / 1000,
    edges: inner ? Math.round((edges / inner) * 1000) / 1000 : 0,
  };
}

/** Why a frame fails, or undefined when it reads. */
export function frameFault(s: FrameStats): string | undefined {
  if (s.luma < MIN_LUMA && s.p90 < BRIGHT_P90) return `too dark (luma ${Math.round(s.luma)})`;
  if (s.flat > MAX_FLAT) return `one flat tone (${Math.round(s.flat * 100)}%)`;
  if (s.edges < MIN_EDGES)
    return `no detail (edges ${Math.round(s.edges * 1000) / 10}%)`;
  return undefined;
}

export interface ClipCheck {
  ok: boolean;
  frames: FrameStats[];
  reason: string;
}

/** A clip passes when at least two of its sampled frames read. */
export function clipVerdict(frames: FrameStats[]): ClipCheck {
  const faults = frames.map(frameFault);
  const good = faults.filter((f) => !f).length;
  const need = Math.min(2, frames.length);
  const ok = frames.length > 0 && good >= need;
  return {
    ok,
    frames,
    reason: ok
      ? `${good} of ${frames.length} frames read`
      : frames.length
        ? `${frames.length - good} of ${frames.length} frames fail: ${faults.filter(Boolean).join(", ")}`
        : "no frame could be read",
  };
}

/** One greyscale frame of a video at `seconds`, CHECK_W x CHECK_H. */
async function grabGray(file: string, seconds: number): Promise<Uint8Array> {
  const { stdout } = await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-ss",
      seconds.toFixed(2),
      "-i",
      file,
      "-frames:v",
      "1",
      "-vf",
      `scale=${CHECK_W}:${CHECK_H}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "-",
    ],
    { encoding: "buffer", maxBuffer: 1 << 20, windowsHide: true },
  );
  return new Uint8Array(stdout as unknown as Buffer);
}

/** Samples three frames across a clip (read only) and judges them. */
export async function checkReconClip(
  file: string,
  durationSeconds: number,
): Promise<ClipCheck> {
  const frames: FrameStats[] = [];
  for (const at of SAMPLE_AT)
    try {
      const g = await grabGray(file, Math.max(0, durationSeconds * at));
      if (g.length >= CHECK_W * CHECK_H)
        frames.push(frameStats(g, CHECK_W, CHECK_H));
    } catch {
      // an unreadable frame simply does not count
    }
  return clipVerdict(frames);
}

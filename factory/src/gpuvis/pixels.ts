// Measurements on a picture's raw pixels for the GPU picture tools, through ffmpeg (no image library in the factory):
// its size, whether it is pixel art (which must be scaled by whole pixels, never through an AI upscaler that smears
// the blocks into blobs), how visible an outpainting seam is and how much an upscale sharpened it.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG, FFPROBE } from "../lib/bin.ts";

const run = promisify(execFile);

export async function probeSize(
  file: string,
): Promise<{ width: number; height: number }> {
  const { stdout } = await run(FFPROBE, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    file,
  ]);
  const [width, height] = stdout.trim().split(",").map(Number);
  if (!width || !height) throw new Error(`no picture size for ${file}`);
  return { width, height };
}

/** The picture as raw RGB at its own size (or w x h when given), for the measures below. */
export async function rawRgb(
  file: string,
  size?: { width: number; height: number },
): Promise<{ data: Buffer; width: number; height: number }> {
  const s = size ?? (await probeSize(file));
  const { stdout } = await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-i",
      file,
      "-frames:v",
      "1",
      "-vf",
      `scale=${s.width}:${s.height}:flags=neighbor`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
  );
  return {
    data: stdout as unknown as Buffer,
    width: s.width,
    height: s.height,
  };
}

export interface PixelArtStats {
  /** Share of side-by-side pixel pairs that are the same colour (within JPEG noise). */
  flat: number;
  /** Of the pairs that differ, the share that jump hard (a drawn edge, not a gradient). */
  hard: number;
  /** Distinct colours after rounding each channel to 16 levels, per 1,000 pixels. */
  palette: number;
}

/** Pixel statistics that tell drawn pixel art from photographs, renders and 3D screenshots (pure). */
export function pixelArtStats(
  data: Buffer,
  width: number,
  height: number,
): PixelArtStats {
  let same = 0;
  let pairs = 0;
  let differ = 0;
  let hard = 0;
  const colours = new Set<number>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      colours.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      if (x + 1 < width) {
        const d = Math.max(
          Math.abs(r - data[i + 3]!),
          Math.abs(g - data[i + 4]!),
          Math.abs(b - data[i + 5]!),
        );
        pairs++;
        if (d <= 6) same++;
        else {
          differ++;
          if (d >= 48) hard++;
        }
      }
    }
  }
  return {
    flat: pairs ? same / pairs : 0,
    hard: differ ? hard / differ : 0,
    palette: (colours.size / Math.max(1, width * height)) * 1000,
  };
}

/**
 * Pixel art: mostly flat runs and edges that jump rather than blend (pure). Calibrated 20 Nov 2026 on 24 real
 * Pulse pictures: every Undertale screen and banner scored flat 0.89-1.00 and hard 0.29-0.64; every photo, render,
 * key art and 3D screenshot (GTA VI, GTA V, Wukong, Isaac's hi-res sprites, box art) scored hard 0.00-0.22.
 */
export function isPixelArt(s: PixelArtStats): boolean {
  return s.flat >= 0.85 && s.hard >= 0.25;
}

/**
 * How visible a pasted rectangle's border is (pure): the mean colour jump across the rectangle's edge divided by the
 * mean jump between neighbouring rows or columns just outside it. About 1 is seamless; 2 or more is a visible line.
 */
export function seamScore(
  data: Buffer,
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number },
): number {
  const px = (x: number, y: number) => {
    const i =
      (Math.min(height - 1, Math.max(0, y)) * width +
        Math.min(width - 1, Math.max(0, x))) *
      3;
    return [data[i]!, data[i + 1]!, data[i + 2]!] as const;
  };
  const diff = (a: readonly number[], b: readonly number[]) =>
    (Math.abs(a[0]! - b[0]!) +
      Math.abs(a[1]! - b[1]!) +
      Math.abs(a[2]! - b[2]!)) /
    3;
  let across = 0;
  let acrossN = 0;
  let beside = 0;
  let besideN = 0;
  const edges: Array<[number, number, number, number, boolean]> = [];
  if (rect.y > 2) edges.push([rect.x, rect.y, rect.w, -1, true]);
  if (rect.y + rect.h < height - 2)
    edges.push([rect.x, rect.y + rect.h - 1, rect.w, 1, true]);
  if (rect.x > 2) edges.push([rect.x, rect.y, rect.h, -1, false]);
  if (rect.x + rect.w < width - 2)
    edges.push([rect.x + rect.w - 1, rect.y, rect.h, 1, false]);
  for (const [x0, y0, len, dir, horizontal] of edges) {
    for (let k = 0; k < len; k += 2) {
      const x = horizontal ? x0 + k : x0;
      const y = horizontal ? y0 : y0 + k;
      const inside = px(x, y);
      const out1 = horizontal ? px(x, y + dir) : px(x + dir, y);
      const out2 = horizontal ? px(x, y + 2 * dir) : px(x + 2 * dir, y);
      const out3 = horizontal ? px(x, y + 3 * dir) : px(x + 3 * dir, y);
      across += diff(inside, out1);
      acrossN++;
      beside += (diff(out1, out2) + diff(out2, out3)) / 2;
      besideN++;
    }
  }
  if (!acrossN) return 1;
  return across / acrossN / Math.max(1, beside / besideN);
}

/** Mean absolute Laplacian (pure): the high-frequency energy, a sharpness and ringing measure. */
export function laplacianEnergy(
  data: Buffer,
  width: number,
  height: number,
): number {
  let sum = 0;
  let n = 0;
  const lum = (x: number, y: number) => {
    const i = (y * width + x) * 3;
    return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
  };
  for (let y = 1; y < height - 1; y += 1)
    for (let x = 1; x < width - 1; x += 1) {
      sum += Math.abs(
        4 * lum(x, y) -
          lum(x - 1, y) -
          lum(x + 1, y) -
          lum(x, y - 1) -
          lum(x, y + 1),
      );
      n++;
    }
  return n ? sum / n : 0;
}

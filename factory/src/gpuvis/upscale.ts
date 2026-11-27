// UPSCALE_STILLS: low-resolution stills and old games' screenshots are brought up to the frame's size before they are
// shown, so a 640x480 PS2 screen or a 960x540 store shot reads crisp at 1080p instead of soft. Real-ESRGAN x4plus
// (BSD 3-Clause) runs through the PC's ComfyUI; pixel art never goes through it (the network smears drawn pixels into
// blobs), it is scaled by whole pixels with nearest-neighbour instead, which is how pixel art is meant to look big.
// The upscale is checked for over-sharpening: when the network's high-frequency energy is far above a plain Lanczos
// resize of the same picture (halos on faces and text), the Lanczos picture is kept instead.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import {
  DEFAULT_COMFY_URL,
  downloadImage,
  removeUpload,
  runWorkflow,
  uploadImage,
} from "./comfy.ts";
import {
  isPixelArt,
  laplacianEnergy,
  pixelArtStats,
  probeSize,
  rawRgb,
} from "./pixels.ts";
import { ESRGAN_MODELS, upscaleWorkflow } from "./workflows.ts";

const run = promisify(execFile);

/** Games released before this year count as old: their screenshots are upscaled whatever their size. */
export const OLD_GAME_BEFORE = 2010;
/** The network is used only when it must enlarge by at least this much; below it Lanczos is as good. */
export const MIN_GAIN = 1.25;
/** ESRGAN's Laplacian energy over Lanczos's above which the result counts as over-sharpened. */
export const OVERSHARP_RATIO = 2.6;

export type UpscaleMethod = "esrgan" | "pixel" | "lanczos" | "none";

/**
 * How a still should be enlarged for a frame of frameW x frameH (pure): "none" when it already covers the frame
 * (and its game is not old), "pixel" for pixel art, "esrgan" when it must grow by MIN_GAIN or more, else "lanczos".
 */
export function upscalePlan(opts: {
  width: number;
  height: number;
  frameW: number;
  frameH: number;
  year?: number;
  pixel: boolean;
}): { method: UpscaleMethod; scale: number } {
  // Never beyond the frame's cover size; an old game's screenshot takes the network for any growth at all (its soft
  // textures gain most), everything else only from MIN_GAIN.
  const cover = Math.max(opts.frameW / opts.width, opts.frameH / opts.height);
  const old = opts.year !== undefined && opts.year < OLD_GAME_BEFORE;
  if (cover <= 1) return { method: "none", scale: 1 };
  if (opts.pixel) return { method: "pixel", scale: Math.ceil(cover) };
  if (cover >= MIN_GAIN || old) return { method: "esrgan", scale: cover };
  return { method: "lanczos", scale: cover };
}

export interface UpscaleResult {
  file: string;
  method: UpscaleMethod;
  width: number;
  height: number;
  seconds: number;
  /** ESRGAN's high-frequency energy over a Lanczos resize's (1 = no sharper). */
  sharpRatio?: number;
  /** True when ESRGAN was rejected as over-sharpened and the Lanczos picture kept. */
  fellBack?: boolean;
}

async function ff(args: string[]): Promise<void> {
  await run(FFMPEG, ["-v", "error", "-y", ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Enlarges src for a frameW x frameH frame into dest (PNG for pixel art, JPEG otherwise). Returns undefined when it
 * needs nothing. year is the game's release year when known.
 */
export async function upscaleStill(
  src: string,
  dest: string,
  opts: {
    frameW: number;
    frameH: number;
    year?: number;
    url?: string;
    model?: string;
    timeoutMs?: number;
    /** Runs the Real-ESRGAN part inside a GPU turn (the service's queue); the plan and the CPU paths never wait. */
    gpu?: <T>(fn: () => Promise<T>) => Promise<T>;
  },
): Promise<UpscaleResult | undefined> {
  const started = Date.now();
  const size = await probeSize(src);
  const sample = await rawRgb(src, {
    width: Math.min(size.width, 640),
    height: Math.round((Math.min(size.width, 640) * size.height) / size.width),
  });
  const pixel = isPixelArt(
    pixelArtStats(sample.data, sample.width, sample.height),
  );
  const plan = upscalePlan({
    ...size,
    frameW: opts.frameW,
    frameH: opts.frameH,
    year: opts.year,
    pixel,
  });
  if (plan.method === "none") return undefined;
  const width = Math.round(size.width * plan.scale);
  const height = Math.round(size.height * plan.scale);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (plan.method === "pixel" || plan.method === "lanczos") {
    await ff([
      "-i",
      src,
      "-vf",
      `scale=${width}:${height}:flags=${plan.method === "pixel" ? "neighbor" : "lanczos"}`,
      "-frames:v",
      "1",
      ...(dest.endsWith(".png") ? [] : ["-q:v", "2"]),
      dest,
    ]);
    return {
      file: dest,
      method: plan.method,
      width,
      height,
      seconds: (Date.now() - started) / 1000,
    };
  }
  const url = (opts.url ?? DEFAULT_COMFY_URL).replace(/\/$/, "");
  const tmp = `${dest}.esrgan.png`;
  const gpu = opts.gpu ?? (<T>(fn: () => Promise<T>) => fn());
  await gpu(async () => {
    const up = await uploadImage(url, src);
    try {
      const imgs = await runWorkflow(
        url,
        upscaleWorkflow({
          image: up,
          width,
          height,
          model: opts.model ?? ESRGAN_MODELS.photo,
        }),
        opts.timeoutMs ?? 120_000,
      );
      await downloadImage(url, imgs[0]!, tmp);
    } finally {
      await removeUpload(up);
    }
  });
  // The over-sharpening check: high-frequency energy against a Lanczos resize, both on the same 960 px wide view.
  const lanczos = `${dest}.lanczos.png`;
  await ff([
    "-i",
    src,
    "-vf",
    `scale=${width}:${height}:flags=lanczos`,
    "-frames:v",
    "1",
    lanczos,
  ]);
  const view = { width: 960, height: Math.round((960 * height) / width) };
  const [a, b] = await Promise.all([rawRgb(tmp, view), rawRgb(lanczos, view)]);
  const sharpRatio =
    laplacianEnergy(a.data, a.width, a.height) /
    Math.max(0.01, laplacianEnergy(b.data, b.width, b.height));
  const fellBack = sharpRatio > OVERSHARP_RATIO;
  await ff([
    "-i",
    fellBack ? lanczos : tmp,
    "-frames:v",
    "1",
    ...(dest.endsWith(".png") ? [] : ["-q:v", "2"]),
    dest,
  ]);
  await fs.rm(tmp, { force: true });
  await fs.rm(lanczos, { force: true });
  return {
    file: dest,
    method: fellBack ? "lanczos" : "esrgan",
    width,
    height,
    seconds: (Date.now() - started) / 1000,
    sharpRatio,
    fellBack,
  };
}

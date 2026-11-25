// FILL_FRAME: a picture whose shape does not match the frame is extended to fill it, instead of sitting in a panel
// over its own blurred copy. A 16:9 still (or a 4:3 retro screen) in a 1080x1920 Short gets the scene continued above
// and below; a portrait cover in a 1920x1080 long video gets it continued left and right. The model is FLUX.2 [klein]
// 4B (Apache 2.0) through the PC's ComfyUI, prompted from the local vision model's description of the scene. The
// original's own pixels are pasted back over the middle, so nothing the source showed is altered; only the margins
// are new. Every extension is checked by the vision model with the original blacked out: any person, character,
// creature, face, writing or logo in the new margins and it is drawn again with another seed, then given up (the
// blurred plate stays). The render labels a filled picture "EDGES EXTENDED BY AI" (src/render/components/Background.tsx).

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import { log } from "../lib/util.ts";
import {
  DEFAULT_COMFY_URL,
  downloadImage,
  runWorkflow,
  removeUpload,
  uploadImage,
} from "./comfy.ts";
import {
  isPixelArt,
  pixelArtStats,
  probeSize,
  rawRgb,
  seamScore,
} from "./pixels.ts";
import { askVision, type Ask } from "./vision.ts";
import { fillWorkflow } from "./workflows.ts";

const run = promisify(execFile);

export { FILL_LABEL } from "./label.ts";

/**
 * Where the original goes: "hero" (a wide picture in a tall frame, at the Short's hero band), "centre", or for a
 * picture extended sideways "left" / "right" (the original at that edge, all the new picture on the other side).
 */
export type FillPlace = "centre" | "hero" | "left" | "right";

export interface FillGeometry {
  outW: number;
  outH: number;
  /** Where the original sits in the output, in output pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The model's canvas (about a megapixel, sides multiples of 16) and the original's place on it. */
  genW: number;
  genH: number;
  gx: number;
  gy: number;
  gw: number;
  gh: number;
}

/** How far a picture's shape must differ from the frame's before filling is worth it (8%). */
export const FILL_MIN_MISMATCH = 1.08;
/** The model's canvas size in pixels: klein is trained around a megapixel. */
export const FILL_GEN_PIXELS = 1_100_000;
/** The Short's hero band starts here (src/render/layout.ts BANDS.hero), where the framed panel used to sit. */
export const HERO_TOP_SHARE = 360 / 1920;

/** Even pixel counts: an odd width came back one pixel narrower from the scaler and broke the paste (20 Nov 2026). */
const ev = (v: number) => Math.round(v / 2) * 2;
const even16 = (v: number) => Math.max(16, Math.round(v / 16) * 16);

/**
 * Where a srcW x srcH picture goes in an outW x outH frame, or undefined when its shape already fits (pure). A wide
 * picture spans the frame's width (placed at the hero band or centred); a tall one spans its height, centred.
 */
export function fillGeometry(
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
  place: FillPlace = "hero",
): FillGeometry | undefined {
  const a = srcW / srcH;
  const frame = outW / outH;
  let x = 0;
  let y = 0;
  let w = outW;
  let h = outH;
  if (a > frame * FILL_MIN_MISMATCH) {
    h = ev(outW / a);
    const centred = ev((outH - h) / 2);
    y =
      place === "hero"
        ? Math.min(ev(outH * HERO_TOP_SHARE), outH - h)
        : centred;
  } else if (a < frame / FILL_MIN_MISMATCH) {
    w = ev(outH * a);
    x =
      place === "left" ? 0 : place === "right" ? outW - w : ev((outW - w) / 2);
  } else return undefined;
  const k = Math.sqrt(FILL_GEN_PIXELS / (outW * outH));
  const genW = even16(outW * k);
  const genH = even16(outH * k);
  const sx = genW / outW;
  const sy = genH / outH;
  return {
    outW,
    outH,
    x,
    y,
    w,
    h,
    genW,
    genH,
    gx: Math.round(x * sx),
    gy: Math.round(y * sy),
    gw: Math.round(w * sx),
    gh: Math.round(h * sy),
  };
}

/**
 * The box to keep inside a W x H canvas (pure): rect pulled in by `inset` on each side that meets a new margin, and
 * run out to the canvas edge on each side that does not. By default a side meets a margin when rect does not touch
 * the canvas edge there.
 */
export function keptBox(
  rect: { x: number; y: number; w: number; h: number },
  W: number,
  H: number,
  inset: number,
  sides?: { left: boolean; right: boolean; top: boolean; bottom: boolean },
): { x: number; y: number; w: number; h: number } {
  const s = sides ?? {
    left: rect.x > 0,
    right: rect.x + rect.w < W,
    top: rect.y > 0,
    bottom: rect.y + rect.h < H,
  };
  const x0 = s.left ? rect.x + inset : 0;
  const y0 = s.top ? rect.y + inset : 0;
  const x1 = s.right ? rect.x + rect.w - inset : W;
  const y1 = s.bottom ? rect.y + rect.h - inset : H;
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/** The extension prompt from the vision model's description of the scene (pure). */
export function fillPrompt(scene: string, pixel: boolean): string {
  const look = pixel
    ? "the same retro pixel-art style, same palette and pixel size"
    : "the same lighting, colours, camera and art style";
  return `${scene.trim().replace(/\.$/, "")}. The picture continues seamlessly beyond its edges with more of the same empty surroundings: background, sky, ground, floor, walls, scenery and textures, in ${look}. Quiet uncluttered margins with no figures, no lettering and no signs.`;
}

export const SCENE_PROMPT =
  "Describe only the setting and background of this video game picture in one sentence of at most 25 words: the place, the surfaces, the sky or ceiling, the light and the art style (photoreal 3D, painted key art, pixel art, flat cartoon). Do not describe any person or character and do not quote any writing.";

export const MARGIN_CHECK_PROMPT =
  "This picture has a black box in the middle; look only at the parts around it. Answer true or false. figures: any person, character, face, body, hand, animal or creature, even small or partial. writing: any readable or pseudo letters, words, numbers, logos, signs or watermarks. broken: obvious smears, melted shapes, repeated tiles, hard straight seams or areas that do not belong to the same scene.";

export interface FillResult {
  file: string;
  geometry: FillGeometry;
  seam: number;
  seed: number;
  attempts: number;
  seconds: number;
  scene: string;
  pixel: boolean;
}

export interface FillOptions {
  outW: number;
  outH: number;
  place?: FillPlace;
  url?: string;
  seed?: number;
  /** Seeds tried before giving up (default 2). */
  attempts?: number;
  ask?: Ask;
  /** Skip the margin check (benchmarks only). */
  noCheck?: boolean;
  timeoutMs?: number;
}

async function ff(args: string[]): Promise<void> {
  await run(FFMPEG, ["-v", "error", "-y", ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** The margin check's verdict from the vision model's answer (pure): a list of problems, empty when clean. */
export function marginProblems(answer: any): string[] {
  const out: string[] = [];
  // No answer is not a pass: an unread check rejects the fill (the blurred plate stays).
  if (
    ["figures", "writing", "broken"].some(
      (k) => typeof answer?.[k] !== "boolean",
    )
  )
    return ["the margin check gave no answer"];
  if (answer?.figures === true) out.push("a figure in the new margins");
  if (answer?.writing === true) out.push("writing in the new margins");
  if (answer?.broken === true) out.push("broken texture in the new margins");
  return out;
}

/**
 * Extends src to outW x outH and writes dest (JPEG). Returns undefined when the shape already fits; throws when
 * the model fails or every attempt is rejected by the margin check, so callers keep their blurred plate.
 */
export async function fillFrame(
  src: string,
  dest: string,
  opts: FillOptions,
): Promise<FillResult | undefined> {
  const started = Date.now();
  const url = (opts.url ?? DEFAULT_COMFY_URL).replace(/\/$/, "");
  const ask = opts.ask ?? askVision;
  const size = await probeSize(src);
  const g = fillGeometry(
    size.width,
    size.height,
    opts.outW,
    opts.outH,
    opts.place,
  );
  if (!g) return undefined;
  const raw = await rawRgb(src, {
    width: Math.min(size.width, 640),
    height: Math.round((Math.min(size.width, 640) * size.height) / size.width),
  });
  const pixel = isPixelArt(pixelArtStats(raw.data, raw.width, raw.height));
  const work = `${dest}.work`;
  await fs.mkdir(work, { recursive: true });
  const scale = pixel ? "neighbor" : "lanczos";
  const uploads: string[] = [];
  try {
    const sceneAns = await ask([src], SCENE_PROMPT, {
      properties: { setting: { type: "string" } },
      required: ["setting"],
    }).catch(() => ({}));
    const scene = String(sceneAns?.setting || "a video game scene").slice(
      0,
      220,
    );
    const prompt = fillPrompt(scene, pixel);
    const canvas = path.join(work, "canvas.png");
    const mask = path.join(work, "mask.png");
    // The canvas: the original on its own stretched, blurred copy (a starting point the model mostly replaces).
    await ff([
      "-i",
      src,
      "-filter_complex",
      `[0]scale=${g.genW}:${g.genH}:force_original_aspect_ratio=increase,crop=${g.genW}:${g.genH},gblur=sigma=24[bg];[0]scale=${g.gw}:${g.gh}:flags=${scale}[fg];[bg][fg]overlay=${g.gx}:${g.gy}`,
      "-frames:v",
      "1",
      canvas,
    ]);
    // The mask: white is drawn, black is kept. The kept box is the original inset by 8 px on the sides that meet a new
    // margin, so the model also redraws a thin band of the original's edge and blends into it; the paste below covers
    // that band again. Sides on the frame's own edge are not inset.
    const k = keptBox(
      { x: g.gx, y: g.gy, w: g.gw, h: g.gh },
      g.genW,
      g.genH,
      8,
    );
    await ff([
      "-f",
      "lavfi",
      "-i",
      `color=white:s=${g.genW}x${g.genH}`,
      "-vf",
      `drawbox=x=${k.x}:y=${k.y}:w=${k.w}:h=${k.h}:color=black:t=fill,format=gray`,
      "-frames:v",
      "1",
      mask,
    ]);
    const upCanvas = await uploadImage(url, canvas);
    uploads.push(upCanvas);
    const upMask = await uploadImage(url, mask);
    uploads.push(upMask);
    const tries = Math.max(1, opts.attempts ?? 2);
    const baseSeed = opts.seed ?? 20261120;
    let lastProblems: string[] = [];
    for (let t = 0; t < tries; t++) {
      const seed = baseSeed + t * 7919;
      const imgs = await runWorkflow(
        url,
        fillWorkflow({
          canvas: upCanvas,
          mask: upMask,
          prompt,
          seed,
          width: g.genW,
          height: g.genH,
        }),
        opts.timeoutMs ?? 240_000,
      );
      const gen = await downloadImage(
        url,
        imgs[0]!,
        path.join(work, `gen_${t}.png`),
      );
      // The output: the model's picture at full size, the original pasted over the middle with a 10 px feathered edge
      // on the sides that meet a new margin. The alpha is drawn on a canvas padded by P on every side (white running
      // into the padding on the frame-edge sides) so the blur never darkens a frame edge, then cropped back.
      const f = 10;
      const P = 4 * f;
      const a = keptBox(
        { x: P, y: P, w: g.w, h: g.h },
        g.w + 2 * P,
        g.h + 2 * P,
        f,
        {
          left: g.x > 0,
          right: g.x + g.w < g.outW,
          top: g.y > 0,
          bottom: g.y + g.h < g.outH,
        },
      );
      const out = path.join(work, `out_${t}.jpg`);
      await ff([
        "-i",
        gen,
        "-i",
        src,
        "-f",
        "lavfi",
        "-i",
        `color=black:s=${g.w + 2 * P}x${g.h + 2 * P}`,
        "-filter_complex",
        `[0]scale=${g.outW}:${g.outH}:flags=lanczos,format=rgb24[bg];[2]drawbox=x=${a.x}:y=${a.y}:w=${a.w}:h=${a.h}:color=white:t=fill,gblur=sigma=${f / 2},crop=${g.w}:${g.h}:${P}:${P},format=gray[a];[1]scale=${g.w}:${g.h}:flags=${scale},format=rgb24[fg0];[fg0][a]alphamerge[fg];[bg][fg]overlay=${g.x}:${g.y}:format=auto`,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        out,
      ]);
      if (!opts.noCheck) {
        const blanked = path.join(work, `margins_${t}.jpg`);
        await ff([
          "-i",
          out,
          "-vf",
          `drawbox=x=${g.x}:y=${g.y}:w=${g.w}:h=${g.h}:color=black:t=fill,scale=${Math.round(g.outW / 2)}:-2`,
          "-frames:v",
          "1",
          blanked,
        ]);
        const verdict = await ask([blanked], MARGIN_CHECK_PROMPT, {
          properties: {
            figures: { type: "boolean" },
            writing: { type: "boolean" },
            broken: { type: "boolean" },
          },
          required: ["figures", "writing", "broken"],
        });
        lastProblems = marginProblems(verdict);
        if (lastProblems.length) {
          log("info", "fill rejected by the margin check", {
            src: path.basename(src),
            seed,
            problems: lastProblems,
          });
          continue;
        }
      }
      const px = await rawRgb(out);
      const seam = seamScore(px.data, px.width, px.height, {
        x: g.x,
        y: g.y,
        w: g.w,
        h: g.h,
      });
      await fs.copyFile(out, dest);
      return {
        file: dest,
        geometry: g,
        seam,
        seed,
        attempts: t + 1,
        seconds: (Date.now() - started) / 1000,
        scene,
        pixel,
      };
    }
    throw new Error(
      `fill rejected after ${tries} attempts: ${lastProblems.join(", ")}`,
    );
  } finally {
    for (const u of uploads) await removeUpload(u);
    if (!process.env.GPUVIS_KEEP_WORK)
      await fs
        .rm(work, { recursive: true, force: true })
        .catch(() => undefined);
  }
}

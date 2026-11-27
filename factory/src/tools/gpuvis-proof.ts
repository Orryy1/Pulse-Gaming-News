// Proofs and benchmarks for the GPU picture tools (src/gpuvis), run on the PC through the orchestrator:
//   C:\Claude\orchestrator\orch.cmd run --class gpu --project pulse --job "gpuvis proof" --priority 20 --est 15 -- node --import tsx src/tools/gpuvis-proof.ts <cmd> ...
//
//   fill <pictures dir> <out dir>       each picture as today (framed panel over its blurred plate) and filled by klein,
//                                       side by side in sheet.jpg, with seam scores, timings, the margin check and a
//                                       blind A/B by the local vision model in report.json
//   upscale <pictures dir> <out dir>    Lanczos against the chosen upscale (Real-ESRGAN or whole-pixel), crops of the
//                                       detail at 100%, timings and the over-sharpening ratio in report.json
// Starts the PC's ComfyUI when it is down and stops it again afterwards (only the one it started).

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import {
  DEFAULT_COMFY_URL,
  ensureComfy,
  freeComfy,
  stopComfy,
} from "../gpuvis/comfy.ts";
import { fillFrame, type FillResult } from "../gpuvis/fill.ts";
import { probeSize } from "../gpuvis/pixels.ts";
import { stack } from "../gpuvis/sheet.ts";
import { upscaleStill, type UpscaleResult } from "../gpuvis/upscale.ts";
import { askVision } from "../gpuvis/vision.ts";

const run = promisify(execFile);
const ff = (args: string[]) =>
  run(FFMPEG, ["-v", "error", "-y", ...args], { maxBuffer: 64 * 1024 * 1024 });
const pictures = async (dir: string) =>
  (await fs.readdir(dir))
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && !/\.(blur|fill)\./.test(f))
    .sort();

/** Today's look for a picture of the wrong shape: the Short's framed panel over its blurred plate (plates.ts + FramedFootage). */
async function blurLook(
  src: string,
  dest: string,
  outW: number,
  outH: number,
): Promise<void> {
  if (outW < outH) {
    await ff([
      "-i",
      src,
      "-filter_complex",
      `[0]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},gblur=sigma=28,eq=brightness=-0.22:saturation=0.75[bg];[0]scale=1016:572:force_original_aspect_ratio=increase,crop=1016:572[fg];[bg][fg]overlay=32:360`,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      dest,
    ]);
  } else {
    // The long video's portrait poster (Long.tsx Still, aspect < 0.9): blurred copy behind, poster 760 px tall.
    await ff([
      "-i",
      src,
      "-filter_complex",
      `[0]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},gblur=sigma=40,eq=brightness=-0.55:saturation=1.2[bg];[0]scale=-2:760[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      dest,
    ]);
  }
}

async function fillProof(dir: string, out: string): Promise<void> {
  await fs.mkdir(out, { recursive: true });
  const url = DEFAULT_COMFY_URL;
  await ensureComfy(url);
  const rows: Array<Record<string, unknown>> = [];
  const pairs: string[] = [];
  try {
    for (const f of await pictures(dir)) {
      const src = path.join(dir, f);
      const size = await probeSize(src);
      const tall = size.width / size.height < 1;
      const [outW, outH] = tall ? [1920, 1080] : [1080, 1920];
      const stem = f.replace(/\.[a-z]+$/i, "");
      const blur = path.join(out, `${stem}.blur.jpg`);
      const fill = path.join(out, `${stem}.fill.jpg`);
      await blurLook(src, blur, outW, outH);
      let res: FillResult | undefined;
      let error: string | undefined;
      try {
        res = await fillFrame(src, fill, { outW, outH, url });
      } catch (e) {
        error = (e as Error).message;
      }
      let ab: Record<string, unknown> | undefined;
      if (res) {
        // Blind A/B: which order the two are shown in alternates by picture, and the answer is mapped back.
        const fillFirst = rows.length % 2 === 0;
        const pair = path.join(out, `${stem}.ab.jpg`);
        const [a, b] = fillFirst ? [fill, blur] : [blur, fill];
        const sw = tall ? 960 : 540;
        const sh = tall ? 540 : 960;
        await ff([
          "-i",
          a,
          "-i",
          b,
          "-filter_complex",
          stack(2, tall ? "v" : "h", `scale=${sw}:${sh}`),
          "-frames:v",
          "1",
          "-q:v",
          "3",
          pair,
        ]);
        const ans = await askVision(
          [pair],
          `Two versions of the same ${tall ? "widescreen video frame" : "vertical phone video frame"} are shown ${tall ? "top (A) and bottom (B)" : "left (A) and right (B)"}. Judge which looks more like one complete, premium, natural full-frame picture a top YouTube channel would show, rather than a picture pasted over a blurred copy of itself. Penalise invented people, writing, smears or visible seams. Score each from 1 to 10 and pick the better.`,
          {
            properties: {
              a: { type: "number" },
              b: { type: "number" },
              better: { type: "string", enum: ["A", "B"] },
            },
            required: ["a", "b", "better"],
          },
        ).catch(() => ({}));
        const fillScore = fillFirst ? ans.a : ans.b;
        const blurScore = fillFirst ? ans.b : ans.a;
        ab = {
          fillScore,
          blurScore,
          winner: ans.better
            ? (ans.better === "A") === fillFirst
              ? "fill"
              : "blur"
            : undefined,
        };
      }
      rows.push({
        picture: f,
        size: `${size.width}x${size.height}`,
        frame: `${outW}x${outH}`,
        error,
        ...res,
        ab,
      });
      console.log(JSON.stringify(rows.at(-1)));
      const tile = path.join(out, `${stem}.tile.jpg`);
      const tw = tall ? 640 : 360;
      const th = tall ? 360 : 640;
      await ff([
        "-i",
        blur,
        "-i",
        res ? fill : blur,
        "-filter_complex",
        `${stack(2, tall ? "v" : "h", `scale=${tw}:${th}`)},pad=iw+8:ih+8:4:4:color=0x111111`,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        tile,
      ]);
      if (!tall) pairs.push(tile);
    }
  } finally {
    await freeComfy(url);
    stopComfy();
  }
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(rows, null, 1),
  );
  // The sheet: each pair is today (left) then filled (right), five pairs a row.
  if (pairs.length) {
    const per = 5;
    const rowsOut: string[] = [];
    for (let i = 0; i < pairs.length; i += per) {
      const chunk = pairs.slice(i, i + per);
      while (chunk.length < per) chunk.push(chunk[chunk.length - 1]!);
      const r = path.join(out, `row_${i / per}.jpg`);
      await ff([
        ...chunk.flatMap((c) => ["-i", c]),
        "-filter_complex",
        stack(per, "h"),
        "-frames:v",
        "1",
        "-q:v",
        "3",
        r,
      ]);
      rowsOut.push(r);
    }
    await ff([
      ...rowsOut.flatMap((r) => ["-i", r]),
      "-filter_complex",
      stack(rowsOut.length, "v"),
      "-frames:v",
      "1",
      "-q:v",
      "3",
      path.join(out, "sheet.jpg"),
    ]);
  }
}

async function upscaleProof(
  dir: string,
  out: string,
  yearArg?: string,
): Promise<void> {
  await fs.mkdir(out, { recursive: true });
  const url = DEFAULT_COMFY_URL;
  await ensureComfy(url);
  const rows: Array<Record<string, unknown>> = [];
  try {
    for (const f of await pictures(dir)) {
      const src = path.join(dir, f);
      const stem = f.replace(/\.[a-z]+$/i, "");
      const year = yearArg ? Number(yearArg) : undefined;
      const res: UpscaleResult | undefined = await upscaleStill(
        src,
        path.join(out, `${stem}.up.jpg`),
        {
          frameW: 1920,
          frameH: 1080,
          year,
          url,
        },
      ).catch((e) => {
        console.log(f, (e as Error).message);
        return undefined;
      });
      rows.push({ picture: f, ...(await probeSize(src)), ...res });
      console.log(JSON.stringify(rows.at(-1)));
      if (!res) continue;
      // A 100% crop from the middle of each: plain Lanczos against the chosen upscale.
      const lz = path.join(out, `${stem}.lanczos.jpg`);
      await ff([
        "-i",
        src,
        "-vf",
        `scale=${res.width}:${res.height}:flags=lanczos`,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        lz,
      ]);
      await ff([
        "-i",
        lz,
        "-i",
        res.file,
        "-filter_complex",
        `${stack(2, "h", "crop=640:640:(iw-640)/2:(ih-640)/3")},pad=iw+8:ih+8:4:4:color=0x111111`,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        path.join(out, `${stem}.crop.jpg`),
      ]);
    }
  } finally {
    await freeComfy(url);
    stopComfy();
  }
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(rows, null, 1),
  );
}

/** PSNR and SSIM of a picture against its ground truth (both scaled to the truth's size), from ffmpeg. */
async function fidelity(
  file: string,
  truth: string,
): Promise<{ psnr: number; ssim: number }> {
  const t = await probeSize(truth);
  const one = async (filter: string, re: RegExp) => {
    const { stderr } = await run(
      FFMPEG,
      [
        "-hide_banner",
        "-i",
        file,
        "-i",
        truth,
        "-lavfi",
        `[0]scale=${t.width}:${t.height}[a];[a][1]${filter}`,
        "-f",
        "null",
        "-",
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    return Number(stderr.match(re)?.[1] ?? NaN);
  };
  return {
    psnr: await one("psnr", /average:([\d.]+)/),
    ssim: await one("ssim", /All:([\d.]+)/),
  };
}

/** Ground truth: 1080p pictures shrunk to 360p, brought back by Lanczos and by the upscaler, scored against the original. */
async function upscaleTruth(
  lowDir: string,
  truthDir: string,
  out: string,
): Promise<void> {
  await upscaleProof(lowDir, out);
  const rows = JSON.parse(
    await fs.readFile(path.join(out, "report.json"), "utf8"),
  ) as Array<Record<string, any>>;
  for (const r of rows) {
    const stem = String(r.picture).replace(/\.[a-z]+$/i, "");
    const truth = path.join(truthDir, r.picture);
    if (!r.file) continue;
    r.truth = {
      lanczos: await fidelity(path.join(out, `${stem}.lanczos.jpg`), truth),
      upscaled: await fidelity(r.file, truth),
    };
    console.log(r.picture, JSON.stringify(r.truth));
  }
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(rows, null, 1),
  );
}

const [cmd, a, b, c] = process.argv.slice(2);
if (cmd === "fill" && a && b) await fillProof(a, b);
else if (cmd === "upscale" && a && b) await upscaleProof(a, b, c);
else if (cmd === "upscale-truth" && a && b && c) await upscaleTruth(a, b, c);
else
  throw new Error(
    "usage: gpuvis-proof.ts fill|upscale <pictures dir> <out dir> [year]",
  );

// Real renders for the GPU picture proofs: the Short and the long video rendered by Remotion with and without
// FILL_FRAME and UPSCALE_STILLS, on the same frames, so the before and the after are the factory's own pixels and not a
// mock-up. Run it after gpuvis-proof.ts has made the fills and upscales, through the orchestrator:
//   C:\Claude\orchestrator\orch.cmd run --class heavy --project pulse --job "gpuvis render proof" --priority 20 --est 15 --
//     node --import tsx src/tools/gpuvis-render-proof.ts <pictures dir> <fill proof dir> <upscale proof dir> <out dir>
//
// Writes, under <out dir>: short_<picture>.jpg (each line's middle frame, today's look above, filled below),
// long_fill.jpg (a portrait cover in the long video, poster above, filled below), long_upscale.jpg (100% crops of a
// small still in the long video, original above, upscaled below), short_fill.mp4 and short_today.mp4 (a whole sample
// Short each way, for frame-by-frame checks) and report.json.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer";
import { FFMPEG } from "../lib/bin.ts";
import { blurPlate } from "../assets/plates.ts";
import { probeSize } from "../gpuvis/pixels.ts";
import { stack } from "../gpuvis/sheet.ts";
import { getBundle, serveDir } from "../render/render.ts";
import { FPS, SAMPLE_PROPS } from "../render/props.ts";
import { SAMPLE_LONG_PROPS } from "../render/Long.tsx";
import { LONG_FPS } from "../render/longplan.ts";

const run = promisify(execFile);
const ff = (args: string[]) =>
  run(FFMPEG, ["-v", "error", "-y", ...args], { maxBuffer: 64 * 1024 * 1024 });
const stem = (f: string) => f.replace(/\.[a-z0-9]+$/i, "");
const exists = (f: string) =>
  fs.access(f).then(
    () => true,
    () => false,
  );

async function stills(
  id: string,
  props: Record<string, unknown>,
  frames: number[],
  dest: (f: number) => string,
): Promise<void> {
  const serveUrl = await getBundle();
  const composition = await selectComposition({
    serveUrl,
    id,
    inputProps: props,
  });
  for (const frame of frames)
    await renderStill({
      composition,
      serveUrl,
      frame: Math.min(frame, composition.durationInFrames - 1),
      output: dest(frame),
      inputProps: props,
      imageFormat: "jpeg",
      jpegQuality: 92,
      chromiumOptions: { gl: "angle" },
    });
}

async function video(
  id: string,
  props: Record<string, unknown>,
  out: string,
): Promise<void> {
  const serveUrl = await getBundle();
  const composition = await selectComposition({
    serveUrl,
    id,
    inputProps: props,
  });
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: out,
    inputProps: props,
    muted: true,
    chromiumOptions: { gl: "angle" },
  });
}

/** Two rows of frames, the first above the second, scaled to a common height. */
async function sheet(
  top: string[],
  bottom: string[],
  out: string,
  h: number,
): Promise<void> {
  const rows: string[] = [];
  for (const [k, row] of [top, bottom].entries()) {
    const f = `${out}.row${k}.jpg`;
    await ff([
      ...row.flatMap((x) => ["-i", x]),
      "-filter_complex",
      stack(row.length, "h", `scale=-2:${h}`),
      "-q:v",
      "3",
      f,
    ]);
    rows.push(f);
  }
  await ff([
    "-i",
    rows[0]!,
    "-i",
    rows[1]!,
    "-filter_complex",
    stack(2, "v"),
    "-q:v",
    "3",
    out,
  ]);
  for (const r of rows) await fs.rm(r, { force: true });
}

async function main(
  picDir: string,
  fillDir: string,
  upDir: string,
  out: string,
): Promise<void> {
  const serve = path.join(out, "serve");
  await fs.mkdir(serve, { recursive: true });
  const files = await serveDir(serve);
  const url = (f: string) => `${files.url}/${encodeURIComponent(f)}`;
  const report: Record<string, unknown>[] = [];
  try {
    const pics = (await fs.readdir(picDir))
      .filter((f) => /\.(jpe?g|png)$/i.test(f))
      .sort();
    // The Short: every wide picture the fill proof extended, each line's middle frame, today's look and filled.
    const mids = SAMPLE_PROPS.segments.map((g) =>
      Math.round(((g.start + g.end) / 2) * FPS),
    );
    let firstWide:
      | { pic: string; aspect: number; blur: string; fill: string }
      | undefined;
    for (const pic of pics) {
      const fill = path.join(fillDir, `${stem(pic)}.fill.jpg`);
      if (!(await exists(fill))) continue;
      const size = await probeSize(path.join(picDir, pic));
      const aspect = size.width / size.height;
      const fillSize = await probeSize(fill);
      await fs.copyFile(path.join(picDir, pic), path.join(serve, pic));
      if (fillSize.height > fillSize.width) {
        await fs.copyFile(fill, path.join(serve, `${stem(pic)}.fill.jpg`));
        const blur = await blurPlate(serve, pic);
        firstWide ??= { pic, aspect, blur, fill: `${stem(pic)}.fill.jpg` };
        const base = {
          file: pic,
          kind: "screenshot",
          aspect,
          blurSrc: url(blur),
        };
        const rows: string[][] = [[], []];
        for (const [k, withFill] of [false, true].entries()) {
          const props = {
            ...SAMPLE_PROPS,
            audioSrc: null,
            musicSrc: null,
            images: [
              {
                ...base,
                src: url(pic),
                ...(withFill ? { fillSrc: url(`${stem(pic)}.fill.jpg`) } : {}),
              },
            ],
          };
          await stills("PulseShort", props, mids, (f) => {
            const p = path.join(
              out,
              "frames",
              `short_${stem(pic)}_${withFill ? "fill" : "today"}_${f}.jpg`,
            );
            rows[k]!.push(p);
            return p;
          });
        }
        const s = path.join(out, `short_${stem(pic)}.jpg`);
        await sheet(rows[0]!, rows[1]!, s, 480);
        report.push({
          lane: "short",
          picture: pic,
          size: `${size.width}x${size.height}`,
          frames: mids,
          sheet: s,
        });
        console.log("short", pic);
      } else if (aspect < 0.9) {
        // The long video: a portrait cover, poster over its blurred copy today, extended to 16:9 with the switch on.
        const fillName = `${stem(pic)}.longfill.jpg`;
        await fs.copyFile(fill, path.join(serve, fillName));
        const lmids = SAMPLE_LONG_PROPS.segments
          .slice(0, 4)
          .map((g) => Math.round(((g.start + g.end) / 2) * LONG_FPS));
        const rows: string[][] = [[], []];
        for (const [k, withFill] of [false, true].entries()) {
          const props = {
            ...SAMPLE_LONG_PROPS,
            audioSrc: null,
            musicSrc: null,
            images: [
              {
                src: url(pic),
                kind: "cover",
                aspect,
                ...(withFill ? { fillSrc: url(fillName) } : {}),
              },
            ],
          };
          await stills("PulseLong", props, lmids, (f) => {
            const p = path.join(
              out,
              "frames",
              `long_${stem(pic)}_${withFill ? "fill" : "today"}_${f}.jpg`,
            );
            rows[k]!.push(p);
            return p;
          });
        }
        const s = path.join(out, "long_fill.jpg");
        await sheet(rows[0]!, rows[1]!, s, 360);
        report.push({
          lane: "long",
          picture: pic,
          size: `${size.width}x${size.height}`,
          frames: lmids,
          sheet: s,
        });
        console.log("long", pic);
      }
    }
    // UPSCALE_STILLS in the long video: a small still as today (stretched by the browser) and upscaled, 100% crops.
    const ups: string[][] = [[], []];
    for (const pic of pics) {
      const up = path.join(upDir, `${stem(pic)}.up.jpg`);
      if (!(await exists(up))) continue;
      const size = await probeSize(path.join(picDir, pic));
      const aspect = size.width / size.height;
      if (aspect < 1.2) continue;
      await fs.copyFile(path.join(picDir, pic), path.join(serve, pic));
      await fs.copyFile(up, path.join(serve, `${stem(pic)}.up.jpg`));
      const frame = Math.round(3.5 * LONG_FPS);
      for (const [k, withUp] of [false, true].entries()) {
        const props = {
          ...SAMPLE_LONG_PROPS,
          audioSrc: null,
          musicSrc: null,
          images: [
            {
              src: url(withUp ? `${stem(pic)}.up.jpg` : pic),
              kind: "screenshot",
              aspect,
            },
          ],
        };
        const full = path.join(
          out,
          "frames",
          `long_${stem(pic)}_${withUp ? "up" : "today"}.jpg`,
        );
        await stills("PulseLong", props, [frame], () => full);
        const crop = full.replace(/\.jpg$/, ".crop.jpg");
        await ff([
          "-i",
          full,
          "-vf",
          "crop=640:540:640:270",
          "-q:v",
          "2",
          crop,
        ]);
        ups[k]!.push(crop);
      }
      report.push({
        lane: "long-upscale",
        picture: pic,
        size: `${size.width}x${size.height}`,
        frame,
      });
      console.log("upscale", pic);
    }
    if (ups[0]!.length)
      await sheet(ups[0]!, ups[1]!, path.join(out, "long_upscale.jpg"), 540);
    // A whole sample Short each way, for the frame-by-frame scan (black frames, jumps, the label).
    if (firstWide) {
      const base = {
        file: firstWide.pic,
        kind: "screenshot",
        aspect: firstWide.aspect,
        blurSrc: url(firstWide.blur),
        src: url(firstWide.pic),
      };
      for (const withFill of [false, true]) {
        const o = path.join(
          out,
          withFill ? "short_fill.mp4" : "short_today.mp4",
        );
        await video(
          "PulseShort",
          {
            ...SAMPLE_PROPS,
            audioSrc: null,
            musicSrc: null,
            images: [
              {
                ...base,
                ...(withFill ? { fillSrc: url(firstWide.fill) } : {}),
              },
            ],
          },
          o,
        );
        report.push({
          lane: "short-video",
          picture: firstWide.pic,
          fill: withFill,
          file: o,
        });
        console.log("video", o);
      }
    }
  } finally {
    await files.close();
    await fs.writeFile(
      path.join(out, "report.json"),
      JSON.stringify(report, null, 1),
    );
  }
}

const [a, b, c, d] = process.argv.slice(2);
if (!a || !b || !c || !d)
  throw new Error(
    "usage: gpuvis-render-proof.ts <pictures dir> <fill proof dir> <upscale proof dir> <out dir>",
  );
await fs.mkdir(path.join(d, "frames"), { recursive: true });
await main(a, b, c, d);
process.exit(0);

// THUMB_CANDIDATES proof: several GPU-made thumbnail candidates per long video, ranked by the local vision model,
// beside the video's old thumbnails, in one contact sheet. Changes nothing anywhere (no upload).
//
//   node --import tsx src/tools/thumb-candidates.ts <manifest.json> <out dir>
//
// manifest: { "videos": [ { "videoId", "title", "game", "words": ["..."], "old": ["<file>", ...],
//             "arts": [ { "file", "provenance", "subjectX", "subjectY" } ] } ] }
// Run on the PC through the orchestrator (it uses ComfyUI, Remotion and Ollama in turn):
//   C:\Claude\orchestrator\orch.cmd run --class heavy --project pulse --job "thumb candidates" --priority 20 --est 25 -- node --import tsx src/tools/thumb-candidates.ts <manifest> <out>

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import { designProblems, posterProblems } from "../qa/thumbrule.ts";
import {
  DEFAULT_COMFY_URL,
  ensureComfy,
  freeComfy,
  stopComfy,
} from "../gpuvis/comfy.ts";
import { fillFrame } from "../gpuvis/fill.ts";
import { probeSize } from "../gpuvis/pixels.ts";
import { stack } from "../gpuvis/sheet.ts";
import {
  drawPlate,
  extendWidth,
  rankScored,
  relight,
  scoreThumbs,
  type Scored,
} from "../gpuvis/thumbs.ts";
import { upscaleStill } from "../gpuvis/upscale.ts";
import { askVision } from "../gpuvis/vision.ts";

const run = promisify(execFile);
const ff = (args: string[]) =>
  run(FFMPEG, ["-v", "error", "-y", ...args], { maxBuffer: 64 * 1024 * 1024 });

interface Art {
  file: string;
  provenance?: string;
  subjectX?: number;
  subjectY?: number;
}
interface Video {
  videoId: string;
  title: string;
  game: string;
  words: string[];
  old?: string[];
  arts: Art[];
}
interface Variant {
  art: string; // file name inside the video's work folder
  label: string;
  subjectX: number;
  subjectY: number;
}
interface Candidate extends Scored {
  words: string;
  old?: boolean;
}

const FONT = "C\\:/Windows/Fonts/arialbd.ttf";
const esc = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");

async function labelTile(
  src: string,
  dest: string,
  top: string,
  bottom: string,
  gold: boolean,
): Promise<void> {
  await ff([
    "-i",
    src,
    "-vf",
    [
      "scale=480:270",
      `pad=488:318:4:4:color=${gold ? "0xFF6B1A" : "0x222222"}`,
      `drawtext=fontfile='${FONT}':text='${esc(top)}':x=10:y=278:fontsize=17:fontcolor=white`,
      `drawtext=fontfile='${FONT}':text='${esc(bottom)}':x=10:y=298:fontsize=15:fontcolor=0xcccccc`,
    ].join(","),
    "-frames:v",
    "1",
    "-q:v",
    "3",
    dest,
  ]);
}

async function grid(tiles: string[], per: number, dest: string): Promise<void> {
  const rows: string[] = [];
  for (let i = 0; i < tiles.length; i += per) {
    const chunk = tiles.slice(i, i + per);
    const r = `${dest}.row${i}.jpg`;
    const inputs = chunk.flatMap((c) => ["-i", c]);
    const filter = `${stack(chunk.length, "h")},pad=${488 * per}:318:0:0:color=0x111111`;
    await ff([
      ...inputs,
      "-filter_complex",
      filter,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      r,
    ]);
    rows.push(r);
  }
  await ff([
    ...rows.flatMap((r) => ["-i", r]),
    "-filter_complex",
    stack(rows.length, "v"),
    "-frames:v",
    "1",
    "-q:v",
    "3",
    dest,
  ]);
  for (const r of rows) await fs.rm(r, { force: true });
}

async function main(manifestFile: string, outDir: string): Promise<void> {
  const { renderLongThumbs } = await import("../render/render.ts");
  const videos = JSON.parse(await fs.readFile(manifestFile, "utf8"))
    .videos as Video[];
  const out = path.resolve(outDir);
  await fs.mkdir(out, { recursive: true });
  const timings: Record<string, number[]> = {
    extend: [],
    relight: [],
    crisp: [],
    render: [],
    score: [],
  };
  const variantsBy = new Map<string, Variant[]>();

  // 1. Art variants on the GPU (ComfyUI), all videos first so the model loads once.
  await ensureComfy(DEFAULT_COMFY_URL);
  try {
    for (const v of videos) {
      const home = path.join(out, v.videoId, "art");
      await fs.mkdir(home, { recursive: true });
      const variants: Variant[] = [];
      for (const [ai, a] of v.arts.entries()) {
        const base = `a${ai}${path.extname(a.file)}`;
        await fs.copyFile(a.file, path.join(home, base));
        const sx = a.subjectX ?? 0.65;
        const sy = a.subjectY ?? 0.4;
        variants.push({
          art: base,
          label: `art ${ai + 1}`,
          subjectX: sx,
          subjectY: sy,
        });
        let work = base;
        const size = await probeSize(path.join(home, base));
        if (size.width < 1600) {
          const t = Date.now();
          const up = await upscaleStill(
            path.join(home, base),
            path.join(home, `a${ai}_crisp.jpg`),
            {
              frameW: 1920,
              frameH: 1080,
            },
          ).catch(() => undefined);
          timings.crisp!.push((Date.now() - t) / 1000);
          if (up) {
            work = path.basename(up.file);
            variants.push({
              art: work,
              label: `art ${ai + 1} crisp (${up.method})`,
              subjectX: sx,
              subjectY: sy,
            });
          }
        }
        let relitBase = work;
        let relitX = sx;
        const ext = extendWidth(
          (await probeSize(path.join(home, work))).width,
          sx,
        );
        if (ext) {
          const ws = await probeSize(path.join(home, work));
          const scale = 1080 / ws.height;
          const t = Date.now();
          const res = await fillFrame(
            path.join(home, work),
            path.join(home, `a${ai}_ext.jpg`),
            {
              outW: Math.round(ext.outW * scale),
              outH: 1080,
              place: ext.place,
            },
          ).catch((e) => {
            console.log(
              `${v.videoId} art ${ai + 1}: extension failed: ${(e as Error).message}`,
            );
            return undefined;
          });
          timings.extend!.push((Date.now() - t) / 1000);
          if (res) {
            const g = res.geometry;
            const nx = (g.x + sx * g.w) / g.outW;
            variants.push({
              art: `a${ai}_ext.jpg`,
              label: `art ${ai + 1} extended`,
              subjectX: nx,
              subjectY: sy,
            });
            relitBase = `a${ai}_ext.jpg`;
            relitX = nx;
          }
        }
        const t = Date.now();
        const plate = await drawPlate(
          path.join(home, `plate_${ai}.png`),
          1100 + ai,
          ai,
        ).catch(() => undefined);
        if (plate) {
          await relight(
            path.join(home, relitBase),
            plate,
            path.join(home, `a${ai}_relit.jpg`),
            relitX,
          );
          variants.push({
            art: `a${ai}_relit.jpg`,
            label: `art ${ai + 1} ${relitBase.includes("_ext") ? "extended + relit" : "relit"}`,
            subjectX: relitX,
            subjectY: sy,
          });
        }
        timings.relight!.push((Date.now() - t) / 1000);
      }
      variantsBy.set(v.videoId, variants);
    }
  } finally {
    await freeComfy(DEFAULT_COMFY_URL);
    stopComfy();
  }

  // 2. Posters (Remotion), the factory's own design, checked by the factory's own rule.
  const report: Record<string, unknown>[] = [];
  const all = new Map<string, Candidate[]>();
  for (const v of videos) {
    const home = path.join(out, v.videoId, "art");
    const cands: Candidate[] = [];
    for (const [k, file] of (v.old ?? []).entries()) {
      const dest = path.join(out, v.videoId, `old_${k}.jpg`);
      await fs.copyFile(file, dest);
      cands.push({
        file: dest,
        label: k === 0 ? "old: before 19 Nov" : "old: live hero (19 Nov)",
        words: "",
        old: true,
      });
    }
    let n = 0;
    for (const words of v.words)
      for (const va of variantsBy.get(v.videoId) ?? []) {
        const file = path.join(out, v.videoId, `cand_${n++}.jpg`);
        const thumb = {
          headline: words.toUpperCase(),
          kicker: "",
          game: "",
          accent: "#FF6B1A",
          layout: "poster" as const,
          imageFile: va.art,
          imageAspect:
            (await probeSize(path.join(home, va.art))).width /
            (await probeSize(path.join(home, va.art))).height,
          subjectX: va.subjectX,
          subjectY: va.subjectY,
        };
        const t = Date.now();
        await renderLongThumbs({
          episodeDir: home,
          thumbs: [{ file, thumb: thumb as never }],
        });
        timings.render!.push((Date.now() - t) / 1000);
        const problems = [
          ...designProblems(thumb, {
            headline: v.title,
            youtube: { title: v.title },
          }),
          ...(await posterProblems(file, thumb)),
        ];
        cands.push({ file, label: `${va.label} | ${words}`, words, problems });
      }
    all.set(v.videoId, cands);
  }

  // 3. The vision model's ranking (Ollama), old thumbnails scored too as the bar to beat.
  for (const v of videos) {
    const cands = all.get(v.videoId)!;
    const t = Date.now();
    await scoreThumbs(cands, askVision, path.join(out, v.videoId, "score"));
    timings.score!.push((Date.now() - t) / 1000 / Math.max(1, cands.length));
    const ranked = rankScored(cands.filter((c) => !c.old));
    const top = ranked.slice(0, 3);
    const tiles: string[] = [];
    for (const c of [...cands.filter((c) => c.old), ...ranked]) {
      const tile = `${c.file}.tile.jpg`;
      const rank = top.indexOf(c);
      const head = c.old
        ? c.label.toUpperCase()
        : `${rank >= 0 ? `TOP ${rank + 1}  ` : ""}${c.label}`;
      const tail = `score ${c.score?.toFixed(2) ?? "n/a"}${c.problems?.length ? `  rule: ${c.problems[0]}` : ""}`;
      await labelTile(
        c.file,
        tile,
        head.slice(0, 52),
        tail.slice(0, 60),
        rank >= 0,
      );
      tiles.push(tile);
    }
    await grid(tiles, 4, path.join(out, `${v.videoId}_sheet.jpg`));
    for (const t2 of tiles) await fs.rm(t2, { force: true });
    report.push({
      videoId: v.videoId,
      title: v.title,
      old: cands
        .filter((c) => c.old)
        .map((c) => ({ label: c.label, score: c.score, parts: c.parts })),
      ranked: ranked.map((c) => ({
        file: path.basename(c.file),
        label: c.label,
        score: c.score,
        parts: c.parts,
        problems: c.problems,
      })),
      testAndCompare: top.map((c) => path.basename(c.file)),
    });
  }
  const mean = (a: number[]) =>
    a.length
      ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10
      : null;
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        timingsSeconds: Object.fromEntries(
          Object.entries(timings).map(([k, a]) => [k, mean(a)]),
        ),
        videos: report,
      },
      null,
      1,
    ),
  );
  console.log(
    JSON.stringify(
      Object.fromEntries(Object.entries(timings).map(([k, a]) => [k, mean(a)])),
    ),
  );
}

const [m, o] = process.argv.slice(2);
if (!m || !o)
  throw new Error("usage: thumb-candidates.ts <manifest.json> <out dir>");
await main(m, o);

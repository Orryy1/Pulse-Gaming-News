// Preview stills of the AI motion clip shot (src/render/components/localvideo/LocalVideoShot.tsx) on the
// PulseLocalVideo composition, and a contact sheet of them. Light CPU (a few stills, no video render):
//   node --import tsx data/smoke/localvideo_stills.mts <clip dir> <out dir>
// <clip dir> holds localvideo_*.mp4 clips (data/smoke/localvideo_trial.mts --run, with --stub or the model).
import { selectComposition, renderStill } from "@remotion/renderer";
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getBundle, serveDir } from "../../src/render/render.ts";
import { FFMPEG } from "../../src/lib/bin.ts";

const [clipDir, out] = process.argv.slice(2);
if (!clipDir || !out) throw new Error("usage: localvideo_stills.mts <clip dir> <out dir>");
fs.mkdirSync(out, { recursive: true });
const clips = fs.readdirSync(clipDir).filter((f) => /^localvideo_.*\.mp4$/.test(f)).sort();
if (!clips.length) throw new Error(`no localvideo_*.mp4 in ${clipDir}`);
const served = await serveDir(path.resolve(clipDir));
const serveUrl = await getBundle();
// Each case: a clip, a treatment and a shot length; frames early (landing), mid-play and, for a long shot, held.
const cases = [
  { name: "print_exact", clip: clips[0]!, treatment: "print", seconds: 5, frames: [6, 60, 140] },
  { name: "print_long", clip: clips[1 % clips.length]!, treatment: "print", seconds: 12, frames: [100, 330] },
  { name: "bleed", clip: clips[0]!, treatment: "bleed", seconds: 6, frames: [12, 100] },
] as const;
const stills: string[] = [];
for (const c of cases) {
  const props = { src: `${served.url}/${c.clip}`, treatment: c.treatment, seed: 3, durationSeconds: c.seconds };
  const composition = await selectComposition({ serveUrl, id: "PulseLocalVideo", inputProps: props });
  for (const f of c.frames) {
    const file = path.join(out, `${c.name}_${f}.png`);
    await renderStill({ composition, serveUrl, output: file, inputProps: props, frame: f, chromiumOptions: { gl: "angle" } });
    stills.push(file);
    console.log("still", path.basename(file));
  }
}
const run = promisify(execFile);
const cols = 3;
const w = 640;
const h = 360;
const filter = `${stills.map((_, i) => `[${i}:v]scale=${w}:${h}[s${i}]`).join(";")};${stills.map((_, i) => `[s${i}]`).join("")}xstack=inputs=${stills.length}:layout=${stills.map((_, i) => `${(i % cols) * w}_${Math.floor(i / cols) * h}`).join("|")}:fill=black[v]`;
await run(FFMPEG, ["-v", "error", "-y", ...stills.flatMap((s) => ["-i", s]), "-filter_complex", filter, "-map", "[v]", "-frames:v", "1", "-q:v", "3", path.join(out, "stills_sheet.jpg")]);
console.log(`sheet: ${path.join(out, "stills_sheet.jpg")}`);
await served.close();

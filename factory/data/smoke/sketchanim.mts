// Previews the concept-sketch treatments (src/render/components/SketchShot.tsx) on the PulseSketch composition.
// node --import tsx data/smoke/sketchanim.mts <cases.json> <out dir> [--video]
// cases.json: [{ "name": "drawon", "treatment": "drawOn" (optional: absent, the plan's pick from the context),
//   "src": "sketch_1.jpg" (under data/smoke) or "ep:entry_0/assets/photo_0.jpg" (the sample episode),
//   "frames": [40, 150], "len": 180, "seed": 3, "nextKind": "photo", "nextSrc": "ep:...", "nextAspect": 1.65,
//   "earlier": ["sketch_2.jpg"], "page": 2, "runLength": 3, "previous": "drawOn", "tail": 30 (frames after the
//   shot, for the hand-off to the next picture) }]
// The sketch JPEGs beside this file are game screenshots pushed to pencil lines by ffmpeg, stand-ins for the
// drawn sketches of src/assets/illustrate.ts.
import { selectComposition, renderMedia, renderStill } from "@remotion/renderer";
import path from "node:path";
import fs from "node:fs";
import { getBundle, serveDir } from "../../src/render/render.ts";

const [casesFile, out] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const video = process.argv.includes("--video");
const EP = "C:/PulseFactory/factory/data/episodes/ep_20261026_52575f18";
const cases = JSON.parse(fs.readFileSync(casesFile!, "utf8")) as Array<Record<string, any>>;
fs.mkdirSync(out!, { recursive: true });
const smoke = await serveDir(path.resolve("data/smoke"));
const ep = await serveDir(EP);
const url = (p: string | undefined) =>
  p === undefined ? undefined : p.startsWith("ep:") ? `${ep.url}/${p.slice(3)}` : `${smoke.url}/${p}`;
const serveUrl = await getBundle();
for (const c of cases) {
  const len = c.len ?? 180;
  const props = {
    src: url(c.src),
    aspect: c.aspect,
    treatment: c.treatment,
    seed: c.seed ?? 1,
    len,
    nextKind: c.nextKind,
    nextSrc: url(c.nextSrc),
    nextAspect: c.nextAspect,
    earlier: (c.earlier ?? []).map((p: string) => url(p)),
    page: c.page,
    runLength: c.runLength,
    previous: c.previous,
    durationSeconds: (len + (c.tail ?? 0)) / 30,
  };
  const composition = await selectComposition({ serveUrl, id: "PulseSketch", inputProps: props });
  for (const f of c.frames ?? [20, Math.round(len / 2)])
    await renderStill({ composition, serveUrl, output: `${out}/${c.name}_${f}.png`, inputProps: props, frame: f, chromiumOptions: { gl: "angle" } });
  if (video)
    await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: `${out}/${c.name}.mp4`, inputProps: props, muted: true, chromiumOptions: { gl: "angle" }, concurrency: 4 });
  console.log("rendered", c.name);
}
await smoke.close();
await ep.close();

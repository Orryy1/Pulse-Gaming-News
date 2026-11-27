// Previews the photo treatments and screenshot displays (src/render/components/PhotoShot.tsx) on the
// PulsePhoto composition.
// node --import tsx data/smoke/photoanim.mts <cases.json> <out dir> [--video]
// cases.json: [{ "name": "instant", "treatment": "instantDrop" (optional: absent, the plan's pick from the
//   context), "kind": "photo" | "portrait" | "screenshot", "display": "crt" (screenshots; absent, by year),
//   "src": "ep:entry_0/assets/photo_0.jpg" (the sample episode, read only), "aspect": 1.65,
//   "frames": [20, 120], "len": 180, "seed": 3, "year": 1998, "platforms": "PC", "credit": "...",
//   "earlier": ["ep:..."], "earlierAspect": 1.5, "index": 1, "runLength": 2, "previous": "ductTape" }]
import { selectComposition, renderMedia, renderStill } from "@remotion/renderer";
import path from "node:path";
import fs from "node:fs";
import { getBundle, serveDir } from "../../src/render/render.ts";

const [casesFile, out] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const video = process.argv.includes("--video");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const EP = "C:/PulseFactory/factory/data/episodes/ep_20261026_52575f18";
const cases = JSON.parse(fs.readFileSync(casesFile!, "utf8")) as Array<Record<string, any>>;
fs.mkdirSync(out!, { recursive: true });
const smoke = await serveDir(path.resolve("data/smoke"));
const ep = await serveDir(EP);
const url = (p: string | undefined) =>
  p === undefined ? undefined : p.startsWith("ep:") ? `${ep.url}/${p.slice(3)}` : `${smoke.url}/${p}`;
const serveUrl = await getBundle();
for (const c of cases) {
  if (only && !c.name.includes(only)) continue;
  const len = c.len ?? 180;
  const props = {
    src: url(c.src),
    aspect: c.aspect,
    kind: c.kind,
    treatment: c.treatment,
    display: c.display,
    seed: c.seed ?? 1,
    len,
    year: c.year,
    platforms: c.platforms,
    credit: c.credit,
    earlier: (c.earlier ?? []).map((p: string) => url(p)),
    earlierAspect: c.earlierAspect,
    index: c.index,
    runLength: c.runLength,
    previous: c.previous,
    durationSeconds: len / 30,
  };
  const composition = await selectComposition({ serveUrl, id: "PulsePhoto", inputProps: props });
  for (const f of c.frames ?? [20, Math.round(len / 2)])
    await renderStill({ composition, serveUrl, output: `${out}/${c.name}_${f}.png`, inputProps: props, frame: f, chromiumOptions: { gl: "angle" } });
  if (video)
    await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: `${out}/${c.name}.mp4`, inputProps: props, muted: true, chromiumOptions: { gl: "angle" }, concurrency: 4 });
  console.log("rendered", c.name);
}
await smoke.close();
await ep.close();

// Renders explainer excerpts (src/render/components/explainers) from a cases file, each as a short MP4 with the
// narrator's voice under it and, on the tall frame, the caption line the Short would draw:
//   node --import tsx data/smoke/explainers.mts <cases.json> <out dir> [--assets <dir>] [--only name,name] [--scale 0.5]
// cases.json: [{ "name": "scooter_steps", "type": "steps", "tall": true, "e": { type, title, items },
//   "len": 150, "words": [{ text, start, end }] (seconds from the window's start), "backdrop": "ep/assets/x.jpg",
//   "audio": "ep/voice.mp3", "audioFrom": 8.1, "stills": [40, 120] }]
// Paths are served from --assets. Each case writes <out>/<type>/<name>.mp4 and any stills as <name>_<frame>.png.
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import path from "node:path";
import { serveDir } from "../../src/render/render.ts";

const args = process.argv.slice(2);
const flag = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const [casesFile, out] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const only = flag("--only")?.split(",");
const scale = Number(flag("--scale") ?? 0.5);
const gl = (flag("--gl") ?? "angle") as "angle" | "swangle";
const cases = JSON.parse(fs.readFileSync(casesFile!, "utf8")) as Array<Record<string, any>>;
const srv = await serveDir(path.resolve(flag("--assets") ?? "."));
const url = (p?: string) => (p ? `${srv.url}/${p}` : undefined);
const serveUrl = await bundle({
  entryPoint: path.resolve("src/render/components/explainers/preview/Root.tsx"),
  publicDir: path.resolve(flag("--public") ?? "public"),
  onProgress: () => undefined,
});
for (const c of cases) {
  if (only && !only.includes(c.name)) continue;
  const dir = path.join(out!, c.type ?? c.e.type);
  fs.mkdirSync(dir, { recursive: true });
  const props = {
    e: { ...c.e, picture: url(c.e.picture) ?? c.e.picture },
    len: c.len ?? 150,
    words: c.words ?? [],
    accent: c.accent ?? "#FF6B1A",
    backdrop: url(c.backdrop),
    audio: url(c.audio),
    audioFrom: c.audioFrom ?? 0,
    caption: c.caption ?? true,
    guides: false,
  };
  const id = c.tall === false ? "ExplainerWide" : "ExplainerTall";
  const composition = await selectComposition({ serveUrl, id, inputProps: props });
  const t0 = Date.now();
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: path.join(dir, `${c.name}.mp4`),
    inputProps: props,
    scale,
    concurrency: Number(flag("--concurrency") ?? 2),
    chromiumOptions: { gl },
    muted: !props.audio,
  });
  for (const f of c.stills ?? [])
    await renderStill({ composition, serveUrl, output: path.join(dir, `${c.name}_${f}.png`), inputProps: props, frame: f, scale: 1, chromiumOptions: { gl } });
  console.log("rendered", c.name, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
await srv.close();

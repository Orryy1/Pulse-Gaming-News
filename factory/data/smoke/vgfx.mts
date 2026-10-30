// Previews vertical Shorts styles (src/render/components/vertical) on a 1080x1920 frame.
// node --import tsx data/smoke/vgfx.mts <cases.json> <out dir> --pack Numbers|Words
// cases.json: [{ "name": "mask", "style": "Numbers/Mask", "v": { kind, primary, secondary, items },
//   "frames": [6, 30, 90], "len": 150, "picture": "entry_0/assets/screenshot_4.jpg", "src": "...", "year": 2004 }]
import { selectComposition, renderStill } from "@remotion/renderer";
import { bundle } from "@remotion/bundler";
import path from "node:path";
import fs from "node:fs";
import { serveDir } from "../../src/render/render.ts";

const args = process.argv.slice(2);
const pack = args[args.indexOf("--pack") + 1]!;
const [casesFile, out] = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--pack");
const EP = "C:/PulseFactory/factory/data/episodes/ep_20261026_52575f18";
const cases = JSON.parse(fs.readFileSync(casesFile!, "utf8")) as Array<Record<string, any>>;
fs.mkdirSync(out!, { recursive: true });
const srv = await serveDir(EP);
const url = (p?: string) => (p ? `${srv.url}/${p}` : undefined);
const serveUrl = await bundle({ entryPoint: path.resolve(`src/render/components/vertical/preview/${pack}.tsx`), publicDir: path.resolve("public"), onProgress: () => undefined });
for (const c of cases) {
  if (!String(c.style).startsWith(`${pack}/`)) continue; // the other pack's cases would render blank
  const len = c.len ?? 150;
  const props = { style: c.style, v: { secondary: "", items: [], ...c.v }, len, accent: c.accent ?? "#FF6B1A", variant: c.variant ?? 0, year: c.year, src: url(c.src), picture: url(c.picture), guides: c.guides ?? true, durationSeconds: len / 30 };
  const composition = await selectComposition({ serveUrl, id: "VGfx", inputProps: props });
  for (const f of c.frames ?? [8, 40, 100])
    await renderStill({ composition, serveUrl, output: `${out}/${c.name}_${f}.png`, inputProps: props, frame: f, scale: 0.5, chromiumOptions: { gl: "angle" } });
  console.log("rendered", c.name);
}
await srv.close();

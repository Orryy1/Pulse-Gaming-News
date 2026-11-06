// Stills, clips and a speed reading of the code scenes (src/render/components/codescene).
// node --import tsx data/smoke/codescene.mts <cases.json> <out dir> [--clips] [--speed]
// cases.json: [{ "name": "laufey", "scene": {...}, "landAt": 90, "len": 180, "frames": [20, 90, 170], "src": "http or file url" }]
// Each case renders on the Short's frame (_v) and the long video's (_h). --speed times plain ink and each case over the
// same frames at the same concurrency, for the cost per frame.
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const [casesFile, out] = args.filter((a) => !a.startsWith("--"));
const clips = args.includes("--clips");
const speed = args.includes("--speed");
const only = process.env.SCENE_ONLY?.split(",");
const cases = (JSON.parse(fs.readFileSync(casesFile!, "utf8")) as Array<Record<string, any>>).filter((c) => !only || only.includes(c.name));
fs.mkdirSync(out!, { recursive: true });
const serveUrl = await bundle({
  entryPoint: path.resolve("src/render/components/codescene/Preview.tsx"),
  publicDir: path.resolve("public"),
  onProgress: () => undefined,
});
const chromiumOptions = { gl: "angle" } as const;
const pick = async (id: string, inputProps: Record<string, unknown>) => selectComposition({ serveUrl, id, inputProps });
for (const c of cases) {
  const inputProps = { scene: c.scene, landAt: c.landAt ?? 90, len: c.len ?? 180, accent: c.accent ?? "#FF6B1A", src: c.src };
  for (const [id, tag] of [["SceneV", "v"], ["SceneH", "h"]] as const) {
    const composition = await pick(id, inputProps);
    for (const f of c.frames ?? [20, inputProps.landAt, inputProps.len - 10])
      await renderStill({ composition, serveUrl, output: `${out}/${c.name}_${tag}_${f}.png`, inputProps, frame: f, chromiumOptions });
    if (clips)
      await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: `${out}/${c.name}_${tag}.mp4`, inputProps, chromiumOptions, concurrency: 4 });
  }
  console.log("rendered", c.name);
}
// The long video's own route: the PulseGfx composition drawing a Scene/ style from a real graphic.
if (args.includes("--gfx")) {
  const url = await bundle({ entryPoint: path.resolve("src/render/index.ts"), publicDir: path.resolve("public"), onProgress: () => undefined });
  const graphics = [
    { style: "Scene/Delay", g: { kind: "delay", primary: "God of War Laufey", secondary: "", items: ["February 16, 2027", "May 20, 2027"] } },
    { style: "Scene/Reviews", g: { kind: "reviews", primary: "The critics", secondary: "", items: ["IGN: 9", "GameSpot: 8", "VGC: 10"] } },
    { style: "Scene/Share", g: { kind: "share", primary: "25%", secondary: "of Microsoft's workforce", items: [] } },
  ];
  for (const x of graphics) {
    const inputProps = { ...x, len: 150, durationSeconds: 5 };
    const composition = await selectComposition({ serveUrl: url, id: "PulseGfx", inputProps });
    await renderStill({ composition, serveUrl: url, output: `${out}/gfx_${x.style.split("/")[1]}.png`, inputProps, frame: 110, chromiumOptions });
    console.log("gfx", x.style);
  }
}
if (speed) {
  const time = async (label: string, inputProps: Record<string, unknown>) => {
    const composition = await pick("SceneV", inputProps);
    const t0 = Date.now();
    await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: `${out}/_speed.mp4`, inputProps, chromiumOptions, concurrency: 4, frameRange: [0, 119] });
    console.log(`SPEED ${label}: ${((Date.now() - t0) / 120).toFixed(1)} ms per frame`);
  };
  await time("plain ink", { landAt: 60, len: 120, accent: "#FF6B1A", plain: true });
  await time("plain ink again", { landAt: 60, len: 120, accent: "#FF6B1A", plain: true });
  for (const c of cases) await time(c.name, { scene: c.scene, landAt: 60, len: 120, accent: "#FF6B1A", src: c.src });
  fs.rmSync(`${out}/_speed.mp4`, { force: true });
}

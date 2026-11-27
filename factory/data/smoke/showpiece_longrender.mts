// Renders a frame range of a captured long-video render (showpiece_doc.mts with SHOW_NO_RENDER) from a copied episode
// folder, on either machine. No API calls. node --import tsx data/smoke/showpiece_longrender.mts <input json> <ep dir> <from s> <to s> <out.mp4>
import fs from "node:fs";
const [INPUT, EP, FROM, TO, OUT] = process.argv.slice(2) as [string, string, string, string, string];
process.env.ORCH_CLIENT = "file:///nonexistent/orch.mjs";
process.env.REMOTION_GPU_RASTER ??= "true";
const { renderLong } = await import("../../src/render/render.ts");
const input = JSON.parse(fs.readFileSync(INPUT, "utf8"));
const t0 = Date.now();
await renderLong({
  ...input,
  episodeDir: EP,
  browserExecutable: undefined,
  outFile: OUT,
  posterFile: OUT.replace(/\.mp4$/, "_poster.jpg"),
  thumbFile: OUT.replace(/\.mp4$/, "_thumb.jpg"),
  thumbVariants: (input.thumbVariants ?? []).map((v: any, i: number) => ({ ...v, file: OUT.replace(/\.mp4$/, `_thumb${i}.jpg`) })),
  frameRange: [Math.round(Number(FROM) * 30), Math.round(Number(TO) * 30) - 1],
  gl: "angle",
});
console.log(`rendered ${Number(TO) - Number(FROM)} s in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(0);

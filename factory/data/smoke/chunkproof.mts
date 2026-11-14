// Resume proof for RENDER_CHUNKED (14 Nov 2026): renders a frame range of a captured long-video render through the
// real renderLong, single-pass or chunked. Kill it part-way and run it again with the same arguments: the second
// run reuses the finished chunks. No API calls, no thumbnails.
//   node --import tsx data/smoke/chunkproof.mts <input json> <ep dir> <from s> <to s> <out.mp4> <chunk seconds|0>
import fs from "node:fs";
process.env.ORCH_CLIENT = "file:///nonexistent/orch.mjs";
const [INPUT, EP, FROM, TO, OUT, CHUNK] = process.argv.slice(2) as [string, string, string, string, string, string];
const { renderLong } = await import("../../src/render/render.ts");
const { renderSpeedFrom } = await import("../../src/render/renderspeed.ts");
const input = JSON.parse(fs.readFileSync(INPUT, "utf8"));
const chunk = Number(CHUNK);
const speed = renderSpeedFrom({
  RENDER_CHUNKED: chunk > 0 ? "1" : "",
  RENDER_CHUNK_SECONDS: String(chunk),
  RENDER_KEEP_CHUNKS: "1",
});
const t0 = Date.now();
await renderLong({
  ...input,
  episodeDir: EP,
  browserExecutable: undefined,
  outFile: OUT,
  posterFile: OUT.replace(/\.mp4$/, "_poster.jpg"),
  thumbFile: OUT.replace(/\.mp4$/, "_thumb.jpg"),
  thumbVariants: [],
  thumbRenderer: async () => undefined,
  frameRange: [Math.round(Number(FROM) * 30), Math.round(Number(TO) * 30) - 1],
  concurrency: Number(process.env.BENCH_CONCURRENCY || 6),
  gl: (process.env.BENCH_GL || "angle") as "angle",
  speed,
});
console.log(`PROOF rendered ${OUT} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(0);

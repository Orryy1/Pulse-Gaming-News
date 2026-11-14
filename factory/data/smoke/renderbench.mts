// Render-speed benchmark (14 Nov 2026): one frame range of a captured long-video render (showpiece_doc.mts with
// SHOW_NO_RENDER) under chosen Remotion settings, straight through renderMedia so settings the factory does not
// expose yet can be tried. No API calls, no PC turn. Prints one JSON line with the timing.
//   node --import tsx data/smoke/renderbench.mts <input json> <ep dir> <from s> <to s> <out.mp4>
// Settings from the environment: BENCH_CONCURRENCY (6), BENCH_GL (angle), BENCH_HW ("" or a bitrate such as
// "16M": VideoToolbox through Remotion's hardwareAcceleration), BENCH_PRESET (x264 preset, Remotion's default
// "medium"), BENCH_CRF (20, as renderLong), BENCH_JPEG (Remotion's default 80).
import fs from "node:fs";
import os from "node:os";
process.env.ORCH_CLIENT = "file:///nonexistent/orch.mjs";
const [INPUT, EP, FROM, TO, OUT] = process.argv.slice(2) as [string, string, string, string, string];
const { getBundle, serveDir, longProps } = await import("../../src/render/render.ts");
const { renderMedia, selectComposition } = await import("@remotion/renderer");
const input = JSON.parse(fs.readFileSync(INPUT, "utf8"));
const conc = Number(process.env.BENCH_CONCURRENCY || 6);
const gl = (process.env.BENCH_GL || "angle") as "angle" | "swangle";
const hw = process.env.BENCH_HW || "";
const preset = process.env.BENCH_PRESET || undefined;
const crf = Number(process.env.BENCH_CRF || 20);
const jpeg = process.env.BENCH_JPEG ? Number(process.env.BENCH_JPEG) : undefined;
const serveUrl = await getBundle();
const files = await serveDir(EP);
const props = longProps(files.url, serveUrl, input.props);
const composition = await selectComposition({ serveUrl, id: "PulseLong", inputProps: props, chromiumOptions: { gl } });
const frameRange: [number, number] = [Math.round(Number(FROM) * 30), Math.min(composition.durationInFrames, Math.round(Number(TO) * 30)) - 1];
const t0 = Date.now();
let peakFree = os.freemem();
const memTimer = setInterval(() => (peakFree = Math.min(peakFree, os.freemem())), 2000);
await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  ...(hw ? { hardwareAcceleration: "required" as const, videoBitrate: hw } : { crf, ...(preset ? { x264Preset: preset as "medium" } : {}) }),
  pixelFormat: "yuv420p",
  audioCodec: "aac",
  audioBitrate: "192k",
  outputLocation: OUT,
  inputProps: props,
  concurrency: conc,
  chromiumOptions: { gl },
  frameRange,
  ...(jpeg ? { jpegQuality: jpeg } : {}),
  offthreadVideoCacheSizeInBytes: Math.round(Math.min(12 * 1024 ** 3, Math.max(3 * 1024 ** 3, os.freemem() * 0.6))),
  timeoutInMilliseconds: 180_000,
});
clearInterval(memTimer);
const secs = (Date.now() - t0) / 1000;
const frames = frameRange[1] - frameRange[0] + 1;
console.log(
  "BENCH " +
    JSON.stringify({ conc, gl, hw: hw || null, preset: preset ?? "medium", crf: hw ? null : crf, jpeg: jpeg ?? 80, frames, secs: Math.round(secs * 10) / 10, fps: Math.round((frames / secs) * 100) / 100, minFreeGB: Math.round((peakFree / 1024 ** 3) * 10) / 10, bytes: fs.statSync(OUT).size }),
);
await files.close();
process.exit(0);

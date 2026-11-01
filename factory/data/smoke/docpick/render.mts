// The doc-breakout proof's stills, run through the orchestrator (C:\Claude\orchestrator\orch.cmd run --class heavy
// --priority 20 --est 10 -- ...): the evidence pages (data/smoke/docpick/out/evidence_cases.json) on the PulseGfx
// preview and the back catalogue's new Test & compare thumbnails (out/thumb_cases.json) on PulseThumb, then a
// contact sheet of each. Reads episode art from the live install read-only (served by a local file server).
// node --import tsx data/smoke/docpick/render.mts
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getBundle, serveDir, webPath } from "../../../src/render/render.ts";

const OUT = path.resolve("data/smoke/docpick/out");
const sheet = (files: string[], cols: number, out: string) => {
  const list = path.join(OUT, `${path.basename(out)}.txt`);
  fs.writeFileSync(list, files.map((f) => `file '${f.split(path.sep).join("/")}'`).join("\n"));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", `scale=640:-1,tile=${cols}x${Math.ceil(files.length / cols)}:padding=6:color=black`, "-frames:v", "1", out]);
};

// Evidence pages.
const cases = JSON.parse(fs.readFileSync(path.join(OUT, "evidence_cases.json"), "utf8")) as Array<{ name: string; g: any; picture: string; dir: string }>;
const ev = await bundle({ entryPoint: path.resolve("src/render/components/packs/preview/PulseEvidence.tsx"), publicDir: path.resolve("public"), onProgress: () => undefined });
const evStills: string[] = [];
for (const c of cases) {
  const srv = await serveDir(c.dir);
  const style = c.g.kind === "quote" ? "Pulse/EvidenceQuote" : c.g.kind === "reviews" ? "Pulse/EvidenceAggregate" : "Pulse/EvidenceRecord";
  const props = { style, g: c.g, len: 240, durationSeconds: 8, picture: `${srv.url}/${c.picture}`, variant: 0 };
  const composition = await selectComposition({ serveUrl: ev, id: "PulseGfx", inputProps: props });
  for (const f of [14, 120]) {
    const file = path.join(OUT, `${c.name}_${f}.png`);
    await renderStill({ composition, serveUrl: ev, output: file, inputProps: props, frame: f, chromiumOptions: { gl: "angle" } });
    evStills.push(file);
  }
  await srv.close();
  console.log("evidence", c.name);
}
sheet(evStills, 2, path.join(OUT, "evidence_sheet.jpg"));

// Back-catalogue thumbnails.
const thumbs = JSON.parse(fs.readFileSync(path.join(OUT, "thumb_cases.json"), "utf8")) as Array<{ file: string; dir: string; thumb: any }>;
const root = await getBundle();
const made: string[] = [];
for (const t of thumbs) {
  fs.mkdirSync(path.dirname(t.file), { recursive: true });
  const srv = await serveDir(t.dir);
  const { imageFile, ...rest } = t.thumb;
  const props = { ...rest, imageSrc: imageFile ? `${srv.url}/${webPath(imageFile)}` : null };
  const composition = await selectComposition({ serveUrl: root, id: "PulseThumb", inputProps: props });
  await renderStill({ composition, serveUrl: root, output: t.file, inputProps: props, imageFormat: "jpeg", jpegQuality: 90, chromiumOptions: { gl: "angle" } });
  await srv.close();
  made.push(t.file);
  console.log("thumb", t.file);
}
sheet(made, 2, path.join(OUT, "thumbs_sheet.jpg"));
console.log("sheets", path.join(OUT, "evidence_sheet.jpg"), path.join(OUT, "thumbs_sheet.jpg"));

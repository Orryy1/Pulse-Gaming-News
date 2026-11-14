// 31 Oct 2026: preview stills of the drawn scenes (src/render/components/objects) for a documentary's real bare
// sentences, plus one of every scene in each era, and a contact sheet. Light CPU: stills only, no video.
// node --import tsx data/smoke/objects.mts <bare.json from objects_bare.mts> <out dir>
// Writes <out>/<n>_<style>_<frame>.png, <out>/sheet.png (frame 110 of each case) and <out>/sheet.txt.
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { serveDir } from "../../src/render/render.ts";
import {
  OBJECT_SCENES,
  SILHOUETTE_SCENES,
  objectsDecision,
  silhouetteDecision,
  type SceneCandidate,
} from "../../src/render/components/objects/choose.ts";

const [bareFile, out] = process.argv.slice(2) as [string, string];
fs.mkdirSync(out, { recursive: true });
const rows = JSON.parse(fs.readFileSync(bareFile, "utf8")) as any[];

type Case = { name: string; c: SceneCandidate; label: string };
const cases: Case[] = [];
const best = (r: any) => {
  const ch = { game: r.game, year: r.year };
  return [objectsDecision(r.sentence, r.moment, ch).candidate, silhouetteDecision(r.sentence, r.moment, ch).candidate]
    .filter((x): x is SceneCandidate => Boolean(x))
    .sort((a, b) => b.confidence - a.confidence);
};
// 1. Every bare sentence a chooser takes (stock-only counts as bare: a drawn scene may replace stock).
for (const r of rows.filter((x) => x.bare)) {
  const got = best(r);
  for (const c of got.slice(0, 2))
    cases.push({ name: `${cases.length}`.padStart(2, "0"), c, label: `bare ${r.entry}:${r.k} (${r.year}) ${r.sentence}` });
}
// 2. Every scene the bare lines never asked for, from the documentary's other sentences, then by era.
const shown = new Set(cases.map((x) => x.c.style));
for (const r of rows.filter((x) => !x.bare)) {
  const mo = { ...r.moment, graphic: undefined };
  const ch = { game: r.game, year: r.year };
  for (const c of [objectsDecision(r.sentence, mo, ch).candidate, silhouetteDecision(r.sentence, mo, ch).candidate])
    if (c && !shown.has(c.style)) {
      shown.add(c.style);
      cases.push({ name: `${cases.length}`.padStart(2, "0"), c, label: `not bare ${r.entry}:${r.k} (${r.year}) ${r.sentence}` });
    }
}
const eras = [1996, 2003, 2013];
for (const scene of [...OBJECT_SCENES, ...SILHOUETTE_SCENES]) {
  const area = (OBJECT_SCENES as readonly string[]).includes(scene) ? "objects" : "silhouettes";
  const style = `${area === "objects" ? "Objects" : "Silhouettes"}/${scene}`;
  for (const year of eras) {
    if (scene === "fax" && year > 2009) continue;
    cases.push({
      name: `${cases.length}`.padStart(2, "0"),
      c: { area, scene: scene as any, style, confidence: 1, reason: "era sample", year, era: year <= 2005 ? "crt" : "flat", month: scene === "calendar" ? "October" : undefined, tag: "ILLUSTRATION" },
      label: `era sample ${style} ${year}`,
    });
  }
}

const smoke = await serveDir(path.resolve("data/smoke"));
const serveUrl = await bundle({
  entryPoint: path.resolve("src/render/components/objects/Preview.tsx"),
  publicDir: path.resolve("public"),
  onProgress: () => undefined,
});
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const frames = [30, 110];
const lines: string[] = [];
const sheet: string[] = [];
for (const k of cases) {
  if (only && !k.c.style.includes(only) && !k.label.includes(only)) continue;
  const len = 150;
  const props = {
    style: k.c.style,
    len,
    year: k.c.year,
    month: k.c.month,
    variant: Number(k.name) % 3,
    src: k.c.scene === "discs" ? `${smoke.url}/sketch_1.jpg` : undefined,
    durationSeconds: len / 30,
  };
  const composition = await selectComposition({ serveUrl, id: "PulseObjects", inputProps: props });
  const base = `${k.name}_${k.c.style.replace("/", "-")}`;
  for (const f of frames)
    await renderStill({ composition, serveUrl, output: path.join(out, `${base}_${f}.png`), inputProps: props, frame: f, chromiumOptions: { gl: "angle" } });
  sheet.push(path.join(out, `${base}_110.png`));
  lines.push(`${k.name}  ${k.c.style}  ${k.c.confidence}  ${k.label}\n      ${k.c.reason}`);
  console.log("rendered", base);
}
await smoke.close();
fs.writeFileSync(path.join(out, "sheet.txt"), lines.join("\n") + "\n");

// The contact sheet: every case at frame 110, four across, numbered as in sheet.txt.
const tiles = sheet.map((f, i) => ({ f, i }));
const list = path.join(out, "sheet_inputs.txt");
const labelled = tiles.map(({ f }) => {
  const dest = f.replace(/\.png$/, "_tile.png");
  const name = path.basename(f).split("_").slice(0, 2).join(" ");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", f, "-vf", `scale=640:360,drawbox=x=0:y=0:w=640:h=40:color=black@0.7:t=fill,drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='${name}':x=10:y=10:fontsize=22:fontcolor=white`, dest]);
  return dest;
});
fs.writeFileSync(list, labelled.map((f) => `file '${path.resolve(f).replace(/\\/g, "/")}'`).join("\n"));
const cols = 4;
const rowsN = Math.ceil(labelled.length / cols);
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-vf", `tile=${cols}x${rowsN}`, "-frames:v", "1", path.join(out, "sheet.png")]);
for (const f of labelled) fs.rmSync(f);
fs.rmSync(list);
console.log("sheet", path.join(out, "sheet.png"), labelled.length, "tiles");

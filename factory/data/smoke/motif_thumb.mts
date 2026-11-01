// Renders a long video's series-grid (motif) thumbnail from a database COPY, the way the render step builds it,
// in three versions: the pictures as chosen before 1 Nov 2026 (the first six wide ones), as chosen now
// (src/render/motifpictures.ts) and the repair the check falls back to (src/qa/thumbrepair.ts). With --judge
// the three go to the thumbnail check (visionQa format "thumbs") in one call, as the render step sends them.
//
// node --import tsx data/smoke/motif_thumb.mts <episode id> [--db data/smoke/dbcopy/db] [--out <dir>] [--judge]
// --judge reads only the Claude key from the live factory/.env (never written). The episode folder is only read.
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { renderStill, selectComposition } from "@remotion/renderer";
import { getBundle, serveDir } from "../../src/render/render.ts";
import { motifsFor } from "../../src/render/components/motifs/index.ts";
import { motifPictureOrder } from "../../src/render/motifpictures.ts";
import { repairPictures } from "../../src/qa/thumbrepair.ts";
import { thumbTitle } from "../../src/editorial/seo.ts";

const args = process.argv.slice(2);
const flag = (name: string, fallback = "") => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--")
    ? args[i + 1]!
    : fallback;
};
const EP = args.find((a) => a.startsWith("ep_"))!;
const DB = path.resolve(flag("db", "data/smoke/dbcopy/db"));
if (
  DB.toLowerCase().startsWith(
    path.resolve("C:/PulseFactory/factory/data/db").toLowerCase(),
  )
)
  throw new Error("that is the live database; copy it first");
const OUT = path.resolve(flag("out", "data/smoke/motif_thumb_out"));
const DIR = `C:/PulseFactory/factory/data/episodes/${EP}`;
fs.mkdirSync(OUT, { recursive: true });
process.env.DATA_DIR = path.dirname(DB);

const db = new PGlite(DB);
const row = (
  await db.query<any>(
    `SELECT script_json, assets_json FROM episodes WHERE id = $1`,
    [EP],
  )
).rows[0];
await db.close();
const script = row.script_json;
const images: Array<{
  file: string;
  kind: string;
  aspect: number;
  beatIndex?: number;
  layers?: { fg?: string };
}> = row.assets_json.images ?? [];
const doc = script.evergreen_format === "documentary";
const motif = motifsFor({
  title: script.headline,
  platforms: "",
  theme: script.recap ? script.headline : script.game_title,
})[0];
if (!motif?.card) throw new Error(`no motif card for ${script.game_title}`);
const winnerBeat = (script.entries?.length ?? 0) - 1;
const thumbArt =
  images.find((i) => i.beatIndex === winnerBeat && i.kind === "hero") ??
  images.find((i) => i.beatIndex === winnerBeat && i.aspect >= 1.2) ??
  images.find((i) => i.beatIndex === undefined && i.aspect >= 1.2) ??
  images[0];
const before = images
  .filter(
    (i) =>
      i.aspect >= 1.3 &&
      ["hero", "screenshot", "article", "header"].includes(i.kind),
  )
  .map((i) => i.file)
  .slice(0, 6);
const now = motifPictureOrder(images).map((i) => i.file);
const versions = [
  { name: "before", pictures: before, variant: 0 },
  { name: "now", pictures: now, variant: 0 },
  { name: "repair", pictures: repairPictures(now), variant: 1 },
];
console.log(motif.id, "\n before:", before.join(" "), "\n now:", now.join(" "));

const serveUrl = await getBundle();
const files = await serveDir(DIR);
const web = (f: string) =>
  `${files.url}/${f.split(path.sep).join("/").replace(/\\/g, "/")}`;
const outFiles: string[] = [];
for (const v of versions) {
  const props = {
    headline: thumbTitle(script),
    kicker: script.recap ? "THIS WEEK" : doc ? "DOC" : "RANKED",
    game: script.recap ? "" : script.game_title,
    accent: "#FF6B1A",
    layout: "motif",
    motif: motif.id,
    imageSrc: thumbArt ? web(thumbArt.file) : null,
    pictureSrcs: v.pictures.map(web),
    variant: v.variant,
  };
  const composition = await selectComposition({
    serveUrl,
    id: "PulseThumb",
    inputProps: props,
  });
  const file = path.join(OUT, `${EP}_${v.name}.jpg`);
  await renderStill({
    composition,
    serveUrl,
    output: file,
    inputProps: props,
    imageFormat: "jpeg",
    jpegQuality: 90,
  });
  outFiles.push(file);
  console.log("rendered", file);
}
await files.close();

if (args.includes("--judge")) {
  for (const line of fs
    .readFileSync("C:/PulseFactory/factory/.env", "utf8")
    .split(/\r?\n/)) {
    const m = line.match(/^(ANTHROPIC_API_KEY|ANTHROPIC_WORKSPACE_ID)=(.*)$/);
    if (m) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
  const { createClaude } = await import("../../src/editorial/llm.ts");
  const { visionQa } = await import("../../src/qa/vision.ts");
  const llm = createClaude({
    top: "claude-opus-5-5",
    mid: "claude-sonnet-5-5",
    low: "claude-haiku-5-5",
  });
  const v = await visionQa(llm, outFiles, {
    headline: script.headline,
    gameTitle: script.game_title,
    format: "thumbs",
  });
  fs.writeFileSync(
    path.join(OUT, `${EP}_verdict.json`),
    JSON.stringify(
      { files: outFiles.map((f) => path.basename(f)), ...v },
      null,
      1,
    ),
  );
  console.log("verdict", v.verdict, "(frames: 1 before, 2 now, 3 repair)");
  for (const p of v.problems) console.log(" ", p);
  if (v.notes) console.log(" notes:", v.notes);
}

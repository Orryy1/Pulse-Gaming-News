// Proves the depth craft (src/render/orbit.ts, popout.ts, boxart.ts) on a real episode from a database COPY,
// writing nothing into the episode or the database: the episode folder is reached through a junction inside
// data/smoke/depth_out/<ep>/ and served read-only; the 3D photo maps go to data/smoke/depth_out/<ep>/gen.
//
//   node --import tsx data/smoke/depth3d.mts --stage maps   --ep ep_20261027_865858f8   (GPU: wrap in orch gpu)
//   node --import tsx data/smoke/depth3d.mts --stage plan   --ep ...                    (a frame-0 probe)
//   node --import tsx data/smoke/depth3d.mts --stage render --ep ... --what orbit,drop,pop,box,rank [--max 2]
//                                                                                        (wrap in orch heavy)
// Stage render writes excerpt MP4s of 5-10 s (orbit_<shot>.mp4, drop.mp4, pop_<chapter>.mp4, box_<entry>.mp4,
// rank_<n>.mp4) and times each.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { openBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { getBundle, longProps, serveDir } from "../../src/render/render.ts";
import { buildSegments } from "../../src/render/timeline.ts";
import { openChaptersAtBreaks } from "../../src/render/longplan.ts";
import { photoCredit, segmentInputs, variantOf } from "../../src/pipeline.ts";
import { bedFor } from "../../src/render/soundscape.ts";
import { coldOpenLine } from "../../src/render/bookends.ts";
import { parseCameraSetting } from "../../src/render/camera.ts";
import { orbitCandidates } from "../../src/render/orbit.ts";
import { makeMeshes } from "../../src/render/parallax.ts";

const args = process.argv.slice(2);
const flag = (name: string, fallback = "") => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1]! : fallback;
};
const DB = flag("db", "data/smoke/dbcopy/db");
const EP = flag("ep", "ep_20261027_865858f8");
const STAGE = flag("stage", "plan");
const LIVE = `C:/PulseFactory/factory/data/episodes/${EP}`;
const ROOT = path.resolve("data/smoke/depth_out", EP);
const LINK = path.join(ROOT, "ep");
fs.mkdirSync(ROOT, { recursive: true });
if (!fs.existsSync(LINK)) execFileSync("cmd", ["/c", "mklink", "/J", LINK, LIVE.replace(/\//g, "\\")]);

const db = new PGlite(DB);
const row = (await db.query<any>(`SELECT script_json, assets_json FROM episodes WHERE id = $1`, [EP])).rows[0];
await db.close();
const script = row.script_json;
const assets = row.assets_json;
const pre = (f: string) => `ep/${f.split(path.sep).join("/").replace(/\\/g, "/")}`;
const mapsFile = path.join(ROOT, "maps.json");

if (STAGE === "maps") {
  const python = flag("python", "D:/pulse-tools/parallax-venv/Scripts/python.exe");
  const picks = orbitCandidates(assets.images ?? [], 16);
  const files = picks.map((k: number) => pre(assets.images[k].file));
  const t = Date.now();
  const made = await makeMeshes(python, ROOT, files, path.join(ROOT, "gen"));
  const seconds = (Date.now() - t) / 1000;
  fs.writeFileSync(mapsFile, JSON.stringify(Object.fromEntries(made), null, 1));
  console.log(`maps: ${made.size}/${files.length} in ${seconds.toFixed(1)} s (includes the model load)`);
  process.exit(0);
}

const maps: Record<string, any> = fs.existsSync(mapsFile) ? JSON.parse(fs.readFileSync(mapsFile, "utf8")) : {};
const LONG_FPS = 30;
const duration = (assets.durationSeconds ?? 300) + 6;
const words = assets.words ?? [];
const segments = openChaptersAtBreaks(buildSegments(segmentInputs(script, Boolean(assets.desk)), words, duration), assets.breaks);
const variant = variantOf(EP);
const images = (assets.images ?? []).map((i: any) => {
  const mesh = maps[pre(i.file)];
  return {
    file: pre(i.file),
    kind: i.kind,
    aspect: i.aspect,
    beatIndex: i.beatIndex,
    credit: photoCredit(i),
    moment: i.moment,
    label: i.label,
    layers: i.layers
      ? { bg: pre(i.layers.bg), mid: pre(i.layers.mid), fg: pre(i.layers.fg), ...(mesh ? { mesh } : {}) }
      : undefined,
  };
});
const moments = [...(script.entries ?? [])].sort((a: any, b: any) => b.rank - a.rank).map((e: any) => e.moments ?? []);
const clips = (assets.clips ?? []).map((c: any) => ({
  file: pre(c.file),
  durationSeconds: c.durationSeconds,
  beatIndex: c.beatIndex,
  role: c.role,
  moment: c.moment,
  credit: c.credit,
  audio: c.audio,
  label: c.label,
}));
const doc = segments.some((s: any) => s.visual?.kind === "chapter");
const props = {
  title: script.headline,
  kicker: script.kicker ?? "",
  criterion: script.criterion ?? "",
  spoilers: false,
  recap: false,
  theme: script.game_title,
  footageCredit: "FOOTAGE: OFFICIAL TRAILERS · STEAM",
  endLine: "A new documentary every month · Shorts every day",
  moments: moments.map((ms: any[], ei: number) =>
    ms.map((m: any, mi: number) => ({
      show: m.show,
      graphic: (assets.quietMoments ?? []).includes(`${ei}:${mi}`) ? { kind: "none", primary: "", secondary: "", items: [] } : m.graphic,
      emphasis: m.emphasis,
      person: m.person || undefined,
      beat: m.beat,
    })),
  ),
  segments,
  words,
  durationSeconds: duration + 20,
  coldOpenLine: doc ? coldOpenLine(script.hook) : undefined,
  next: null,
  variant,
  audioFile: assets.audio ? pre(assets.audio) : null,
  musicFile: bedFor(variant),
  imageFiles: images,
  clipFiles: clips,
  plan: assets.longPlan,
  renderDate: "2026-11-01",
  breaks: assets.breaks,
  quietBreaks: assets.quietBreaks,
  palette: assets.palette,
  annotations: [...(assets.annotations ?? []), ...(assets.textDetails ?? [])],
  eraBeds: true,
  sketchAnimation: true,
  photoTreatments: true,
  titleDrop: doc,
  camera: parseCameraSetting(flag("camera", "all")),
  subjectPop: !args.includes("--no-pop"),
  box3d: !args.includes("--no-box"),
  debugCamera: true,
};
const serveUrl = await getBundle();
const files = await serveDir(ROOT);
const inputProps = longProps(files.url, serveUrl, props as never);
const gl = (flag("gl", "swangle") as "swangle" | "angle");
const browser = await openBrowser("chrome", { chromiumOptions: { gl } });
const composition = await selectComposition({ serveUrl, id: "PulseLong", inputProps, puppeteerInstance: browser });
const planFile = path.join(ROOT, "plan.json");

if (STAGE === "plan") {
  const depth: any[] = [];
  let events: any[] = [];
  await renderStill({
    composition,
    serveUrl,
    output: path.join(ROOT, "_probe.jpg"),
    inputProps,
    frame: 0,
    imageFormat: "jpeg",
    scale: 0.1,
    puppeteerInstance: browser,
    onBrowserLog: (l) => {
      const c = l.text.match(/^CAMERA (.*)$/);
      if (c) events = JSON.parse(c[1]!).events;
      const d = l.text.match(/^DEPTH (.*)$/);
      if (d) depth.push(JSON.parse(d[1]!));
    },
  });
  fs.rmSync(path.join(ROOT, "_probe.jpg"), { force: true });
  const shots = assets.longPlan?.shots ?? [];
  const orbits = events.filter((e) => e.kind === "orbit").map((e) => ({ ...e, start: shots[e.shot]?.start, end: shots[e.shot]?.end, image: shots[e.shot]?.media.index }));
  const seen = new Set<string>();
  const uniq = depth.filter((d) => {
    const k = JSON.stringify(d);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  fs.writeFileSync(planFile, JSON.stringify({ orbits, depth: uniq }, null, 1));
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  console.log("camera moves", events.length, JSON.stringify(counts));
  console.log("orbits", JSON.stringify(orbits.map((o) => [o.shot, o.start, o.end, images[o.image]?.file])));
  console.log("depth", JSON.stringify(uniq));
} else if (STAGE === "render") {
  const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
  const what = new Set(flag("what", "orbit,drop,pop,box,rank").split(","));
  const max = Number(flag("max", "2"));
  const jobs: Array<{ name: string; from: number; to: number }> = [];
  if (what.has("orbit"))
    for (const o of plan.orbits.slice(0, max)) jobs.push({ name: `orbit_${o.shot}`, from: o.start, to: Math.min(o.end, o.start + 300) });
  for (const d of plan.depth) {
    if (what.has("drop") && d.drop && d.pop) jobs.push({ name: "drop", from: d.drop.from, to: d.drop.from + Math.min(300, d.drop.len) });
    if (what.has("pop") && d.look === "pop" && jobs.filter((j) => j.name.startsWith("pop")).length < max)
      jobs.push({ name: `pop_${d.chapter}`, from: d.from, to: d.from + Math.min(300, d.pause) });
    if (what.has("box") && d.boxBeats)
      for (const b of d.boxBeats.slice(0, max)) jobs.push({ name: `box_${b.entry}`, from: b.from - 15, to: b.from + b.len + 15 });
    if (what.has("rank") && d.rank !== undefined && d.box && jobs.filter((j) => j.name.startsWith("rank")).length < max)
      jobs.push({ name: `rank_${d.rank}`, from: d.from, to: d.from + Math.min(d.len, 240) });
  }
  const only = flag("only");
  for (const j of jobs.filter((j) => !only || only.split(",").includes(j.name))) {
    const t = Date.now();
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      crf: 18,
      outputLocation: path.join(ROOT, `${j.name}.mp4`),
      inputProps,
      frameRange: [j.from, j.to - 1],
      concurrency: Number(flag("concurrency", "6")),
      chromiumOptions: { gl },
      timeoutInMilliseconds: 240_000,
      muted: true,
    });
    const s = (Date.now() - t) / 1000;
    console.log(`${j.name}: frames ${j.from}-${j.to} (${((j.to - j.from) / 30).toFixed(1)} s) rendered in ${s.toFixed(1)} s, ${(s / ((j.to - j.from) / 30)).toFixed(2)} s per second of video`);
  }
}
await browser.close({ silent: true });
await files.close();

// Previews the documentary's camera (src/render/camera.ts, components/CameraMoves.tsx) on a real episode from a
// database COPY: rebuilds the PulseLong props the render step would build, prints the camera's chosen moves
// and renders stills of each (and, with --video, an MP4 excerpt) into data/smoke/camera_out/.
//
// node --import tsx data/smoke/camera.mts [--db data/smoke/dbcopy/db] [--ep ep_20261027_865858f8]
//   [--camera all] [--beats] [--ocr] [--frames 1200,1500] [--video 1800-3600] [--plan-only]
// --beats marks a few sentences as the writer would (this episode was written before beats existed), so the
// emotion pushes and pulls show; --ocr reads the pictures' text for named details (Windows OCR, read only).
// The episode folder is only read (served over loopback); nothing is written to it or to the database.
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  openBrowser,
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer";
import { getBundle, longProps, serveDir } from "../../src/render/render.ts";
import { buildSegments } from "../../src/render/timeline.ts";
import {
  momentKeys,
  momentWindows,
  openChaptersAtBreaks,
} from "../../src/render/longplan.ts";
import {
  photoCredit,
  segmentInputs,
  variantOf,
} from "../../src/pipeline.ts";
import { bedFor } from "../../src/render/soundscape.ts";
import { coldOpenLine } from "../../src/render/bookends.ts";
import { parseCameraSetting } from "../../src/render/camera.ts";
import { findTextDetails, readText, textBox } from "../../src/assets/ocr.ts";

const args = process.argv.slice(2);
const flag = (name: string, fallback = "") => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1]! : fallback;
};
const DB = flag("db", "data/smoke/dbcopy/db");
const EP = flag("ep", "ep_20261027_865858f8");
const OUT = path.resolve("data/smoke/camera_out");
const DIR = `C:/PulseFactory/factory/data/episodes/${EP}`;
fs.mkdirSync(OUT, { recursive: true });

const db = new PGlite(DB);
const row = (
  await db.query<any>(`SELECT script_json, assets_json FROM episodes WHERE id = $1`, [EP])
).rows[0];
await db.close();
const script = row.script_json;
const assets = row.assets_json;
const LONG_FPS = 30;
const duration = (assets.durationSeconds ?? 300) + 6;
const words = assets.words ?? [];
const segments = openChaptersAtBreaks(
  buildSegments(segmentInputs(script, Boolean(assets.desk)), words, duration),
  assets.breaks,
);
const variant = variantOf(EP);
const images = (assets.images ?? []).map((i: any) => ({
  file: i.file,
  kind: i.kind,
  aspect: i.aspect,
  beatIndex: i.beatIndex,
  credit: photoCredit(i),
  moment: i.moment,
  label: i.label,
  layers: i.layers,
}));
const moments = [...(script.entries ?? [])]
  .sort((a: any, b: any) => b.rank - a.rank)
  .map((e: any) => e.moments ?? []);
// The writer's beats, as the documentary writer would mark them: a reveal, a key line and a quiet line a chapter.
if (args.includes("--beats"))
  moments.forEach((ms: any[], e: number) => {
    const n = ms.length;
    if (n < 12) return;
    ms[Math.round(n * 0.3)]!.beat = "reveal";
    ms[Math.round(n * 0.55)]!.beat = "quiet";
    ms[Math.round(n * 0.8)]!.beat = e % 2 ? "key" : "turn";
  });
const clips = (assets.clips ?? []).map((c: any) => ({
  file: c.file,
  durationSeconds: c.durationSeconds,
  beatIndex: c.beatIndex,
  role: c.role,
  moment: c.moment,
  credit: c.credit,
  audio: c.audio,
}));
const plan = assets.longPlan;
const camera = parseCameraSetting(flag("camera", "all"));
let textDetails = assets.textDetails ?? [];
if (args.includes("--ocr") && camera.includes("detail")) {
  const ws = momentWindows(
    segments,
    words,
    moments.map((m: any[]) => m.length),
    moments.map((e: any[]) => e.map(momentKeys)),
  );
  textDetails = await findTextDetails({
    dir: DIR,
    fps: LONG_FPS,
    windows: ws,
    moments,
    keys: (e, m) => (moments[e]?.[m] ? momentKeys(moments[e][m]) : []),
    shots: plan.shots,
    images,
    brands: [script.game_title, ...script.entries.map((x: any) => x.game_title), "Rockstar", "Take-Two"],
  });
  console.log("text details", JSON.stringify(textDetails));
}
// --demo-detail: this episode's narration never names text that is on screen at the time (every picture with
// readable text sits under a full-screen graphic), so for the proof a picture with readable text is put on the
// first free still shot of a sentence with no graphic after 20:00, and a detail is made on its text. The label is
// that text, not a spoken word, so the mark draws as the push settles.
if (args.includes("--demo-detail")) {
  const ws = momentWindows(
    segments,
    words,
    moments.map((m: any[]) => m.length),
    moments.map((e: any[]) => e.map(momentKeys)),
  );
  const wide = new Set(["hero", "screenshot", "article", "header"]);
  const files = images.map((im: any, k: number) => ({ k, file: path.join(DIR, im.file) })).filter((x: any) => wide.has(images[x.k].kind) && images[x.k].aspect >= 1.6);
  const pages = await readText(files.map((x: any) => x.file));
  const withText = files
    .map((x: any) => {
      const page = pages.get(x.file);
      const word = page?.words.map((w) => w.text).find((t) => /^[A-Z][a-z]{4,}$/.test(t) || /^[A-Z]{5,}$/.test(t));
      const box = page && word ? textBox(page, word) : undefined;
      return box && word ? { ...x, word, box } : undefined;
    })
    .filter(Boolean) as Array<{ k: number; word: string; box: [number, number, number, number] }>;
  console.log("demo: pictures with a readable word", withText.map((x) => x.word).join(", "));
  const pic = withText.find((x) => x.word === "Nagasaki") ?? withText[0];
  for (const w of ws) {
    if (!pic || w.at < 1200 || w.moment === 0) continue;
    const m = moments[w.entry]?.[w.moment];
    if (m?.graphic?.kind !== "none" || m.person) continue;
    const from = Math.round(Math.max(w.start, w.at - 0.15) * 30);
    const shot = plan.shots.find((x: any) => from >= x.start && from < x.end);
    if (!shot || shot.media.type !== "image" || !wide.has(images[shot.media.index].kind) || shot.end - from < 150) continue;
    shot.media.index = pic.k;
    textDetails.push({ entry: w.entry, moment: w.moment, image: pic.k, box: pic.box, label: pic.word });
    console.log("demo detail", pic.word, "at frame", from);
    break;
  }
}
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
      graphic: (assets.quietMoments ?? []).includes(`${ei}:${mi}`)
        ? { kind: "none", primary: "", secondary: "", items: [] }
        : m.graphic,
      emphasis: m.emphasis,
      person: m.person || undefined,
      beat: m.beat,
    })),
  ),
  segments,
  words,
  durationSeconds: duration + 20,
  coldOpenLine: coldOpenLine(script.hook),
  next: null,
  variant,
  audioFile: assets.audio ?? null,
  musicFile: bedFor(variant),
  imageFiles: images,
  clipFiles: clips,
  plan,
  renderDate: "2026-10-31",
  breaks: assets.breaks,
  quietBreaks: assets.quietBreaks,
  palette: assets.palette,
  annotations: [...(assets.annotations ?? []), ...textDetails],
  eraBeds: true,
  sketchAnimation: true,
  photoTreatments: true,
  camera,
  debugCamera: true,
};
const serveUrl = await getBundle();
const files = await serveDir(DIR);
const inputProps = longProps(files.url, serveUrl, props as never);
const browser = await openBrowser("chrome", { chromiumOptions: { gl: "angle" } });
let events: Array<{ kind: string; frame: number; shot: number }> = [];
const composition = await selectComposition({
  serveUrl,
  id: "PulseLong",
  inputProps,
  puppeteerInstance: browser,
});
// One small frame draws the composition, which prints the camera's plan.
await renderStill({
  composition,
  serveUrl,
  output: path.join(OUT, "_probe.jpg"),
  inputProps,
  frame: 0,
  imageFormat: "jpeg",
  scale: 0.1,
  puppeteerInstance: browser,
  onBrowserLog: (l) => {
    const m = l.text.match(/^CAMERA (.*)$/);
    if (m) {
      const d = JSON.parse(m[1]!);
      events = d.events;
      fs.writeFileSync(path.join(OUT, "camera_input.json"), JSON.stringify(d.input));
      console.log("freeze cues", d.input.freezeCues.length, "beats", d.input.beats.length, "details", JSON.stringify(d.input.details));
    }
  },
});
fs.rmSync(path.join(OUT, "_probe.jpg"), { force: true });
const counts: Record<string, number> = {};
for (const e of events) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
console.log("camera moves", events.length, JSON.stringify(counts));
console.log("first 3 min", events.filter((e) => e.frame < 180 * 30).length);
fs.writeFileSync(path.join(OUT, "events.json"), JSON.stringify(events, null, 1));
if (!args.includes("--plan-only")) {
  const asked = flag("frames");
  const stills: Array<{ frame: number; name: string }> = asked
    ? asked.split(",").map((f) => ({ frame: Number(f), name: `${flag("tag", "")}f${f}` }))
    : [];
  for (const s of stills) {
    await renderStill({
      composition,
      serveUrl,
      output: path.join(OUT, `${s.name}.jpg`),
      inputProps,
      frame: s.frame,
      imageFormat: "jpeg",
      jpegQuality: 85,
      scale: 0.5,
      puppeteerInstance: browser,
      chromiumOptions: { gl: "angle" },
      timeoutInMilliseconds: 180_000,
    });
    console.log("still", s.name);
  }
  const video = flag("video");
  if (video) {
    const [a, b] = video.split("-").map(Number) as [number, number];
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      crf: 22,
      outputLocation: path.join(OUT, `excerpt_${a}_${b}.mp4`),
      inputProps,
      frameRange: [a, b - 1],
      concurrency: Number(flag("concurrency", "4")),
      chromiumOptions: { gl: "angle" },
      timeoutInMilliseconds: 180_000,
      onProgress: ({ progress }) => {
        if (Math.round(progress * 100) % 10 === 0) process.stdout.write(`\r${Math.round(progress * 100)}%`);
      },
    });
    console.log("\nvideo done");
  }
}
await browser.close({ silent: true });
await files.close();

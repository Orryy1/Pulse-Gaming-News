// Proof runner for the filler families (src/render/components/kinetic, src/render/components/diagram): reads a
// documentary from a database copy, finds its bare sentences (no pinned picture or clip of their own and graphic
// "none"), asks kineticFor and diagramFor about each, times every kinetic line from the episode's own voice
// timings and renders preview stills of the takes on the PulseFiller composition, then a contact sheet.
// node --import tsx data/smoke/filler.mts <db dir> <episode id> <episode media dir> <out dir> [--all] [--max N]
// --all also asks diagramFor about every sentence with graphic "none" (the shot list before the fill pass), so the
// diagram styles get real data to draw. Light CPU: stills only, no video, no orchestrator.
import { PGlite } from "@electric-sql/pglite";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { serveDir } from "../../src/render/render.ts";
import { splitSentences } from "../../src/render/longplan.ts";
import { speakable } from "../../src/voice/speakable.ts";
import { fittingStyles, kineticVerdict } from "../../src/render/components/kinetic/choose.ts";
import { diagramVerdict } from "../../src/render/components/diagram/choose.ts";
import { kineticSettle } from "../../src/render/components/kinetic/kit.tsx";
import { norm, wordTimes, type SpokenWord } from "../../src/render/components/kinetic/words.ts";
import { DIAGRAMS } from "../../src/render/components/diagram/index.ts";
import { backdropFor } from "../../src/render/components/kinetic/backdrop.ts";
import type { FillerChapter } from "../../src/render/components/kinetic/types.ts";

const args = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--max");
const [dbDir, epId, mediaDir, out] = args as [string, string, string, string];
const all = process.argv.includes("--all");
const max = process.argv.includes("--max") ? Number(process.argv[process.argv.indexOf("--max") + 1]) : 40;
fs.mkdirSync(out, { recursive: true });

const db = new PGlite(dbDir);
const row = (await db.query<any>(`SELECT script_json, assets_json FROM episodes WHERE id=$1`, [epId])).rows[0];
await db.close();
if (!row) throw new Error(`no episode ${epId}`);
const script = row.script_json;
const assets = row.assets_json;
const words: SpokenWord[] = assets.words ?? [];
const starts: number[] = assets.entryStarts ?? [];

// Chapters as the pipeline builds them (src/pipeline.ts: entries by rank, sentences per chapter beat).
const chSentences: string[][] = [];
let c = -1;
for (const b of script.beats) {
  if (b.visual?.kind === "chapter") c++;
  if (c >= 0) (chSentences[c] ??= []).push(...splitSentences(b.narration));
}
const entries = [...script.entries].sort((a: any, b: any) => b.rank - a.rank);
const chapters: FillerChapter[] = entries.map((e: any, i: number) => ({
  game: e.game_title,
  year: e.year,
  sentences: chSentences[i] ?? [],
  moments: e.moments ?? [],
}));

// Each sentence's start in the voice: walk the chapter's words, resyncing on the sentence's first words.
const expand = (s: string) =>
  speakable(s)
    .split(/[\s-]+/)
    .map(norm)
    .filter(Boolean);
const spokenParts = (w: SpokenWord) => w.text.split(/[\s-]+/).map(norm).filter(Boolean);
function windows(ci: number): Array<{ start: number; end: number; words: SpokenWord[] }> {
  const lo = starts[ci] ?? 0;
  const hi = starts[ci + 1] ?? Infinity;
  const ws = words.filter((w) => w.start >= lo - 0.05 && w.start < hi);
  const outW: Array<{ start: number; end: number; words: SpokenWord[] }> = [];
  let cur = 0;
  for (const s of chapters[ci]!.sentences) {
    const exp = expand(s);
    let best = cur;
    for (let d = -6; d <= 10; d++) {
      const j = cur + d;
      if (j < 0 || j >= ws.length) continue;
      if (spokenParts(ws[j]!)[0] === exp[0] && spokenParts(ws[j + 1] ?? ws[j]!)[0] === exp[1]) {
        best = j;
        break;
      }
    }
    let n = 0;
    let k = best;
    while (k < ws.length && n < exp.length) n += spokenParts(ws[k++]!).length;
    const sw = ws.slice(best, k);
    outW.push({ start: sw[0]?.start ?? lo, end: ws[k]?.start ?? sw[sw.length - 1]?.end ?? lo, words: sw });
    cur = k;
  }
  return outW;
}

const covered = (ci: number) => {
  const set = new Set<number>();
  for (const x of [...(assets.images ?? []), ...(assets.clips ?? [])])
    if (x.beatIndex === ci && x.moment !== undefined) set.add(x.moment);
  return set;
};
// The backdrop as the integrator will pick it (backdropFor): the chapter's scenery first, rotating per card.
const usedBackdrops: string[] = [];
const pictureOf = (ci: number): string | undefined => {
  const pick = backdropFor(
    (assets.images ?? []).filter((x: any) => x.beatIndex === ci),
    ci,
    usedBackdrops,
  );
  if (pick) usedBackdrops.push(pick);
  return pick?.replace(/\\/g, "/");
};

type Row = {
  chapter: number;
  index: number;
  sentence: string;
  bare: boolean;
  kinetic: { style: string; confidence: number; reason: string } | { declined: string };
  diagram: { style: string; confidence: number; reason: string } | { declined: string };
};
const rows: Row[] = [];
const takes: Array<{ name: string; family: "kinetic" | "diagram"; style: string; data: unknown; times?: number[]; len: number; src?: string; seed: number; frames: number[]; label: string }> = [];
let prevK: string | undefined;
chapters.forEach((ch, ci) => {
  const cov = covered(ci);
  const win = windows(ci);
  ch.sentences.forEach((s, k) => {
    const m = ch.moments![k] ?? { show: "" };
    const bare = (m.graphic?.kind ?? "none") === "none" && !cov.has(k);
    if (!bare && !(all && (m.graphic?.kind ?? "none") === "none")) return;
    const kv = bare ? kineticVerdict(s, m, ch, { index: k, seed: ci, previous: prevK }) : { declined: "not bare (diagram-only pass)" };
    const dv = diagramVerdict(s, m, ch, { index: k });
    rows.push({
      chapter: ci,
      index: k,
      sentence: s,
      bare,
      kinetic: "candidate" in kv ? { style: kv.candidate.style, confidence: kv.candidate.confidence, reason: kv.candidate.reason } : kv,
      diagram: "candidate" in dv ? { style: dv.candidate.style, confidence: dv.candidate.confidence, reason: dv.candidate.reason } : dv,
    });
    const w = win[k]!;
    const len = Math.max(150, Math.min(300, Math.round((w.end - w.start) * 30) + 24));
    const src = pictureOf(ci);
    if ("candidate" in kv) {
      prevK = kv.candidate.style;
      const times = wordTimes(kv.candidate.data.tokens, w.words, w.start);
      const settle = kineticSettle(kv.candidate.data, times, 30, len);
      takes.push({
        name: `k_${ci}_${k}`,
        family: "kinetic",
        style: kv.candidate.style,
        data: kv.candidate.data,
        times,
        len,
        src,
        seed: ci + k,
        frames: [Math.round(settle * 0.45), settle],
        label: `K ${kv.candidate.style} ${kv.candidate.confidence} | ${s.slice(0, 70)}`,
      });
    }
    if ("candidate" in dv) {
      takes.push({
        name: `d_${ci}_${k}`,
        family: "diagram",
        style: dv.candidate.style,
        data: dv.candidate.data,
        len,
        src,
        seed: ci + k,
        frames: [36, Math.max(100, DIAGRAMS[dv.candidate.style].settled + 6)],
        label: `D ${dv.candidate.style} ${dv.candidate.confidence} | ${s.slice(0, 70)}`,
      });
    }
  });
});
// --showcase ci:k[,ci:k] renders every fitting kinetic style for those sentences, so all six get looked at.
const show = process.argv.includes("--showcase") ? process.argv[process.argv.indexOf("--showcase") + 1]! : "";
for (const spec of show.split(",").filter(Boolean)) {
  const [ci, k] = spec.split(":").map(Number) as [number, number];
  const ch = chapters[ci]!;
  const s = ch.sentences[k]!;
  const v = kineticVerdict(s, { ...(ch.moments![k] ?? {}), graphic: { kind: "none" } }, ch, { index: k });
  if (!("candidate" in v)) {
    console.log("showcase declined", spec, v.declined);
    continue;
  }
  const w = windows(ci)[k]!;
  const len = Math.max(150, Math.min(300, Math.round((w.end - w.start) * 30) + 24));
  const times = wordTimes(v.candidate.data.tokens, w.words, w.start);
  const settle = kineticSettle(v.candidate.data, times, 30, len);
  for (const style of fittingStyles(v.candidate.data))
    takes.unshift({
      name: `s_${ci}_${k}_${style}`,
      family: "kinetic",
      style,
      data: v.candidate.data,
      times,
      len,
      src: pictureOf(ci),
      seed: ci + k,
      frames: [settle],
      label: `SHOWCASE ${style} | ${s.slice(0, 70)}`,
    });
}
fs.writeFileSync(path.join(out, "verdicts.json"), JSON.stringify(rows, null, 1));
const bareRows = rows.filter((r) => r.bare);
const kTake = bareRows.filter((r) => "style" in r.kinetic).length;
const dTake = bareRows.filter((r) => "style" in r.diagram).length;
const either = bareRows.filter((r) => "style" in r.kinetic || "style" in r.diagram).length;
console.log(`bare ${bareRows.length}: kinetic ${kTake}, diagram ${dTake}, either ${either}`);
if (all) console.log(`graphic-none sentences ${rows.length}: diagram ${rows.filter((r) => "style" in r.diagram).length}`);

const media = await serveDir(path.resolve(mediaDir));
const serveUrl = await bundle({
  entryPoint: path.resolve("src/render/components/kinetic/preview/Root.tsx"),
  publicDir: path.resolve("public"),
  onProgress: () => undefined,
});
const shots: Array<{ file: string; label: string }> = [];
for (const t of takes.slice(0, max)) {
  const props = { ...t, src: t.src ? `${media.url}/${t.src}` : undefined, durationSeconds: t.len / 30 };
  const composition = await selectComposition({ serveUrl, id: "PulseFiller", inputProps: props });
  for (const f of t.frames) {
    const file = path.join(out, `${t.name}_${f}.png`);
    await renderStill({ composition, serveUrl, output: file, inputProps: props, frame: Math.min(f, t.len - 1), chromiumOptions: { gl: "angle" } });
    shots.push({ file, label: `${t.label} @${f}` });
  }
  console.log("rendered", t.name, t.style);
}
await media.close();

// Contact sheet: every still at 640x360 with its label, four across.
const thumbs = path.join(out, "thumbs");
fs.mkdirSync(thumbs, { recursive: true });
shots.forEach((s, i) => {
  const txt = path.join(thumbs, `${i}.txt`);
  fs.writeFileSync(txt, s.label.replace(/%/g, " pct"));
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-i", s.file,
    "-vf", `scale=640:360,drawbox=y=330:w=640:h=30:color=black@0.75:t=fill,drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':textfile='${txt.replace(/\\/g, "/").replace(/:/g, "\\:")}':x=8:y=338:fontsize=14:fontcolor=white`,
    path.join(thumbs, `t_${String(i).padStart(3, "0")}.png`),
  ]);
});
const cols = 4;
const rowsN = Math.ceil(shots.length / cols);
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", "-framerate", "1", "-i", path.join(thumbs, "t_%03d.png"),
  "-vf", `tile=${cols}x${rowsN}:padding=6:margin=6`, "-frames:v", "1", path.join(out, "contact_sheet.jpg"),
]);
console.log("sheet", path.join(out, "contact_sheet.jpg"));

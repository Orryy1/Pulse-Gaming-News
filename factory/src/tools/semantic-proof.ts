// Before and after contact sheets for meaning-based matching (MATCH_SEMANTIC), one row a sentence, from a sandbox copy
// of the data (never the live folder: on the Mac, APFS clones under ~/PulseFactory/scratch):
//   npx tsx src/tools/semantic-proof.ts short <episode> --db <cloned db> --data <data copy> --episodes <episodes dir> --out <dir>
//   npx tsx src/tools/semantic-proof.ts doc <episode> --chapter <n> --db ... --data ... --episodes ... --out <dir>
// A Short's row: the picture the published video showed under the sentence (a frame of short.mp4), the scene index's
// word-only pick (what the lookup chose before), the pick with meaning blended in, and the still the meaning pass pins
// to the line. Every pick keeps the spoiler window (a Short may use only the opening of GTA VI's story until 17 Dec).
// A documentary chapter's row: the picture or clip pinned to the sentence before, and what the meaning pass pins.
// Writes <out>/<episode>/index.html with its pictures beside it. Nothing is changed in the episode or the database.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadConfig } from "../config.ts";
import { createEmbeddedDb } from "../db.ts";
import { FFMPEG } from "../lib/bin.ts";
import { Embedder } from "../semantic/embed.ts";
import { backgroundFor } from "../semantic/hook.ts";
import { lineQuery, meanVector, cosine } from "../semantic/match.ts";
import { loadShotVectors, shotMeaning, vectorFile } from "../semantic/shots.ts";
import {
  pinChapterMoments,
  pinShortStills,
  freeStills,
} from "../semantic/stills.ts";
import { findShots, type ShotHit } from "../sceneindex/lookup.ts";
import {
  loadSceneIndex,
  sceneIndexDir,
  type SceneIndex,
} from "../sceneindex/schema.ts";
import {
  footageAllowed,
  spoilerWindow,
  type SpoilerWindow,
} from "../sceneindex/spoilers.ts";
import { chapterSentences } from "../pipeline.ts";
import { recordingsOf } from "../semantic/hook.ts";
import { listVodIndexes } from "../vodindex/schema.ts";
import { findVodMoments } from "../vodindex/tags.ts";

const exec = promisify(execFile);
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const plain = args.filter(
  (a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"),
);
const [mode, episode] = plain;
if (
  !mode ||
  !episode ||
  !flag("db") ||
  !flag("data") ||
  !flag("episodes") ||
  !flag("out")
) {
  console.error(
    "usage: semantic-proof.ts short|doc <episode> [--chapter n] --db <dir> --data <dir> --episodes <dir> --out <dir>",
  );
  process.exit(2);
}
const cfg = loadConfig();
const s = cfg.semantic;
const dataDir = path.resolve(flag("data")!);
const epDir = path.join(path.resolve(flag("episodes")!), episode);
const out = path.join(path.resolve(flag("out")!), episode);
await fs.mkdir(out, { recursive: true });
const embedder = new Embedder({
  python: s.python,
  model: s.model,
  device: s.device,
  cacheDir: path.join(dataDir, "semantic"),
  idleSeconds: 30,
  priority: 20,
});
const NOW = new Date(flag("now") ?? "2026-11-20T12:00:00Z");
const MIN_CONFIDENCE = cfg.sceneIndexMinConfidence;

const esc = (t: string) =>
  t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
let n = 0;
async function grab(video: string, at: number): Promise<string> {
  const name = `f${n++}.jpg`;
  await exec(
    FFMPEG,
    [
      "-loglevel",
      "error",
      "-y",
      "-ss",
      Math.max(0, at).toFixed(2),
      "-i",
      video,
      "-frames:v",
      "1",
      "-vf",
      "scale=360:-2",
      "-q:v",
      "4",
      path.join(out, name),
    ],
    {
      timeout: 60_000,
    },
  );
  return name;
}
async function still(file: string): Promise<string> {
  const name = `s${n++}.jpg`;
  await exec(
    FFMPEG,
    [
      "-loglevel",
      "error",
      "-y",
      "-i",
      file,
      "-frames:v",
      "1",
      "-vf",
      "scale=360:-2",
      "-q:v",
      "4",
      path.join(out, name),
    ],
    { timeout: 60_000 },
  );
  return name;
}
const cell = (img: string | undefined, caption: string) =>
  `<td>${img ? `<img src="${img}">` : `<div class="none">nothing of its own</div>`}<div class="cap">${esc(caption)}</div></td>`;

const db = await createEmbeddedDb(path.resolve(flag("db")!));
const [row] = await db.query<{ script_json: any; assets_json: any }>(
  "SELECT script_json, assets_json FROM episodes WHERE id = $1",
  [episode],
);
await db.close();
if (!row) throw new Error(`no episode ${episode}`);
const script = row.script_json;
const assets = row.assets_json;
const game: string = script.game_title || "";

// The game's scene index, its vectors and its spoiler window (GTA VI: from 18 Nov to 17 Dec 2026, opening 10%).
const index: SceneIndex | undefined = game
  ? await loadSceneIndex(dataDir, game)
  : undefined;
const vecs = index
  ? await loadShotVectors(
      vectorFile(sceneIndexDir(dataDir, index.game), s.model),
    )
  : new Map();
const w: SpoilerWindow | undefined =
  index && /grand theft auto vi$/i.test(index.game)
    ? spoilerWindow(index.game, "2026-11-19", {
        days: cfg.spoilerWindowDays,
        openingShare: cfg.spoilerOpeningShare,
        until: "2026-12-17",
      })
    : undefined;
const allowed = (h: ShotHit, use: "short" | "long") =>
  !index ||
  (footageAllowed(w, index, h.start, use, NOW).ok &&
    footageAllowed(w, index, Math.max(h.start, h.end - 0.05), use, NOW).ok);

const allowedShot = (sh: { start: number; end: number }, use: "short" | "long") =>
  !index || (footageAllowed(w, index, sh.start, use, NOW).ok && footageAllowed(w, index, Math.max(sh.start, sh.end - 0.05), use, NOW).ok);
async function indexPicks(text: string, note: string, use: "short" | "long") {
  if (!index) return { old: undefined, now: undefined };
  const target = { text, keywords: note ? note.split(/,\s*/) : [] };
  const old = findShots(index, target, {
    max: 8,
    minConfidence: MIN_CONFIDENCE,
    minSeconds: 1.3, allow: (sh) => allowedShot(sh, use),
  }).find((h) => allowed(h, use));
  let fresh: ShotHit | undefined;
  if (vecs.size) {
    const q = meanVector((await embedder.texts(lineQuery(text, note))) ?? []);
    if (q) {
      const semantic = shotMeaning(index.shots, vecs, q);
      fresh = findShots(index, target, {
        max: 8,
        minConfidence: MIN_CONFIDENCE,
        minSeconds: 1.3, allow: (sh) => allowedShot(sh, use),
        semantic,
      }).find((h) => allowed(h, use));
    }
  }
  return { old, now: fresh };
}
const background = await backgroundFor(dataDir, s, game);
const proxy = index
  ? path.join(
      sceneIndexDir(dataDir, index.game),
      index.proxy?.file || "proxy.mp4",
    )
  : "";
const shotCell = async (h: ShotHit | undefined, label: string) =>
  h
    ? cell(
        await grab(proxy, (h.start + h.end) / 2),
        `${label}: ${h.desc} (confidence ${h.confidence}${h.meaning !== undefined ? `, meaning ${h.meaning}` : ""}; ${h.start.toFixed(0)} s into the story)`,
      )
    : cell(
        undefined,
        `${label}: nothing passed the bar (${MIN_CONFIDENCE}) and the spoiler window`,
      );

// VOD_TAGS: the owner's tagged recordings of the game, searched first in production (src/semantic/hook.ts).
const vods = recordingsOf(await listVodIndexes(dataDir), game);
const vodNote = vods.some((v) => /stand-in/i.test(v.title)) ? "stand-in: a stretch of the scene index proxy, as no real stream has gameplay yet" : vods.length ? `${vods.length} recordings` : "none";
async function ownCell(text: string, note: string): Promise<string> {
  if (!vods.length) return cell(undefined, "no tagged recording of this game");
  const hits = await findVodMoments(vods, { key: "proof", text, keywords: note ? note.split(/,s*/) : [] }, { dataDir, embedder, model: s.model, now: NOW, windows: w ? [w] : [], max: 6, minConfidence: MIN_CONFIDENCE });
  const use = hits.find((h) => !h.held);
  const held = hits.filter((h) => h.held).length;
  const extra = held ? ` (${held} better story moment${held === 1 ? "" : "s"} held by the spoiler guard)` : "";
  return use
    ? cell(await grab(use.file, (use.start + use.end) / 2), `own stream: ${use.label} (confidence ${use.score}, ${use.vodId} at ${use.start.toFixed(0)} s)${extra}`)
    : cell(undefined, `no moment passed the bar${extra}`);
}
const rows: string[] = [];
let title = "";
const stats = { lines: 0, changedIndex: 0, pinned: 0, publishedOwn: 0, offTopic: [] as string[] };
let offCells = "";

if (mode === "short") {
  title = `Short ${episode}: ${script.headline}`;
  const plan = assets.plan;
  const fps = plan.fps ?? 30;
  const words: Array<{ text: string; start: number; end: number }> =
    assets.words ?? [];
  // Each segment's time span from the published plan, and its words.
  const spans = new Map<number, { from: number; to: number }>();
  for (const sh of plan.shots) {
    const sp = spans.get(sh.segment) ?? {
      from: sh.start / fps,
      to: sh.end / fps,
    };
    sp.from = Math.min(sp.from, sh.start / fps);
    sp.to = Math.max(sp.to, sh.end / fps);
    spans.set(sh.segment, sp);
  }
  const beats: Array<{
    narration: string;
    footage?: { want?: string; keywords?: string[] };
  }> = script.beats ?? [];
  const images = (assets.images ?? []).map((i: any) => ({ ...i }));
  const { pins, offTopic: off } = await pinShortStills(
    embedder,
    epDir,
    images,
    beats.map((b) => ({
      text: b.narration,
      note: [b.footage?.want, ...(b.footage?.keywords ?? [])]
        .filter(Boolean)
        .join(", "),
    })),
    { minScore: s.minScore, margin: s.margin, heroIndex: plan.heroIndex, background },
  );
  // The meaning scores of every free still for every beat, for the sheet's caption.
  const free = freeStills(assets.images ?? [], plan.heroIndex);
  const lineVecs = await embedder.texts(beats.map((b) => b.narration));
  const stillVecs = await embedder.images(
    free.map((i) => path.join(epDir, assets.images[i].file)),
  );
  const video = path.join(epDir, "short.mp4");
  for (const i of off) {
    stats.offTopic.push(assets.images[i].file);
    offCells += cell(await still(path.join(epDir, assets.images[i].file)), `would be dropped as off topic: ${assets.images[i].file}`);
  }
  for (const [seg, sp] of [...spans.entries()].sort((a, b) => a[0] - b[0])) {
    const text = words
      .filter((x) => x.start >= sp.from - 0.05 && x.start < sp.to - 0.05)
      .map((x) => x.text)
      .join(" ")
      .trim();
    if (!text) continue;
    // Which beat this segment is: the beat whose narration shares the most words with it.
    const lw = (t: string) =>
      new Set(
        t
          .toLowerCase()
          .replace(/[^a-z0-9 ]/g, "")
          .split(/\s+/)
          .filter((x) => x.length > 2),
      );
    const mine = lw(text);
    let beat = -1;
    let best = 0;
    beats.forEach((b, k) => {
      const o =
        [...lw(b.narration)].filter((x) => mine.has(x)).length /
        Math.max(1, mine.size);
      if (o > best) {
        best = o;
        beat = k;
      }
    });
    if (best < 0.5) beat = -1;
    const note =
      beat >= 0
        ? [
            beats[beat]!.footage?.want,
            ...(beats[beat]!.footage?.keywords ?? []),
          ]
            .filter(Boolean)
            .join(", ")
        : "";
    stats.lines++;
    const published = await grab(video, (sp.from + sp.to) / 2);
    const media = plan.shots.find((x: any) => x.segment === seg)?.media;
    const pubWhat =
      media?.type === "image"
        ? `still: ${assets.images[media.index]?.file ?? "?"}`
        : media?.type === "clip"
          ? `clip: ${assets.clips[media.index]?.label ?? assets.clips[media.index]?.file ?? "?"}`
          : "a card";
    const { old, now } = await indexPicks(text, note, "short");
    if ((old?.shot ?? -1) !== (now?.shot ?? -1)) stats.changedIndex++;
    const pin = beat >= 0 ? pins.find((p) => p.beat === beat) : undefined;
    let pinCell = cell(
      undefined,
      beat >= 0
        ? "no still clearly shows this line: left in turn"
        : "not a beat line (hook, take or loop)",
    );
    if (pin) {
      stats.pinned++;
      pinCell = cell(
        await still(path.join(epDir, images[pin.image].file)),
        `pinned still: ${images[pin.image].file} (meaning ${pin.score})`,
      );
    } else if (beat >= 0 && lineVecs && lineVecs[beat]) {
      const sc = free
        .map((i, k) => ({
          i,
          c: stillVecs[k] ? cosine(lineVecs[beat]!, stillVecs[k]!) : 0,
        }))
        .sort((a, b) => b.c - a.c)[0];
      if (sc)
        pinCell = cell(
          undefined,
          `no clear winner: best was ${assets.images[sc.i].file} at cosine ${sc.c.toFixed(3)}; left in turn`,
        );
    }
    rows.push(
      `<tr><td class="line"><b>${seg}</b> ${esc(text)}${note ? `<div class="note">shot note: ${esc(note)}</div>` : ""}</td>${cell(published, `published: ${pubWhat}`)}${await shotCell(old, "words only")}${await shotCell(now, "words + meaning")}${pinCell}${await ownCell(text, note)}</tr>`,
    );
  }
} else {
  const chapter = Number(flag("chapter") ?? 0);
  const entries = [...(script.entries ?? [])].sort(
    (a: any, b: any) => b.rank - a.rank,
  );
  const e = entries[chapter];
  if (!e) throw new Error(`no chapter ${chapter}`);
  title = `Documentary ${episode}: ${script.headline}, chapter ${chapter} (${e.game_title})`;
  const sentences = chapterSentences(script, chapter);
  const images = (assets.images ?? []).map((i: any) => ({ ...i }));
  const clips = (assets.clips ?? []).map((c: any) => ({ ...c }));
  const own = (k: number) =>
    images.find((i: any) => i.beatIndex === chapter && i.moment === k) ??
    clips.find((c: any) => c.beatIndex === chapter && c.moment === k);
  const open = sentences.map((_, k) => k).filter((k) => !own(k));
  const work = path.join(out, "work");
  await fs.mkdir(work, { recursive: true });
  const pins = await pinChapterMoments(
    embedder,
    epDir,
    work,
    { entry: chapter, moments: e.moments ?? [], sentences },
    open,
    images,
    clips,
    { minScore: s.minScore, margin: s.margin, background });
  for (const [k, sentence] of sentences.entries()) {
    stats.lines++;
    const note = e.moments?.[k]?.show ?? "";
    const before =
      (assets.images ?? []).find(
        (i: any) => i.beatIndex === chapter && i.moment === k,
      ) ??
      (assets.clips ?? []).find(
        (c: any) => c.beatIndex === chapter && c.moment === k,
      );
    if (before) stats.publishedOwn++;
    const pic = async (x: any) =>
      x
        ? /\.mp4$/i.test(x.file)
          ? grab(path.join(epDir, x.file), Number(x.durationSeconds ?? 4) / 2)
          : still(path.join(epDir, x.file))
        : undefined;
    const pin = pins.find((p) => p.line === k);
    const after = pin
      ? (images.find((i: any) => i.beatIndex === chapter && i.moment === k) ??
        clips.find((c: any) => c.beatIndex === chapter && c.moment === k))
      : undefined;
    if (pin) stats.pinned++;
    const { old, now } = await indexPicks(sentence, note, "long");
    if ((old?.shot ?? -1) !== (now?.shot ?? -1)) stats.changedIndex++;
    rows.push(
      `<tr><td class="line"><b>${k}</b> ${esc(sentence)}${note ? `<div class="note">shot note: ${esc(note)}</div>` : ""}</td>${cell(await pic(before), before ? `before: ${before.label ?? before.file}` : "before: chapter footage")}${await shotCell(old, "words only")}${await shotCell(now, "words + meaning")}${cell(await pic(after), pin ? `meaning pin: ${after?.label ?? after?.file} (meaning ${pin.score})` : before ? "kept: it already had its own" : "no clear winner: left to the editor")}${await ownCell(sentence, note)}</tr>`,
    );
  }
  await fs.rm(work, { recursive: true, force: true });
}
embedder.close();

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{font:14px system-ui,sans-serif;background:#111;color:#eee;margin:12px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #333;padding:6px;vertical-align:top}
th{background:#222;position:sticky;top:0}img{width:100%;max-width:360px;display:block}.cap{font-size:12px;color:#bbb;margin-top:4px}.note{font-size:12px;color:#8ab;margin-top:4px}
.none{height:120px;display:flex;align-items:center;justify-content:center;background:#1c1c1c;color:#777;max-width:360px}td.line{width:22%}</style></head><body>
<h2>${esc(title)}</h2>${offCells ? `<p>Stills that fit none of the lines (on average clearly under the game's typical picture), dropped while four others are left:</p><table><tr>${offCells}</tr></table>` : ""}<p>${stats.lines} sentences; the scene index pick changed for ${stats.changedIndex}; the meaning pass pinned a picture of the video's own to ${stats.pinned}.
Model ${esc(s.model)} on this machine; every pick keeps the spoiler window${w ? " (GTA VI: opening 10% of the story only, until 17 Dec)" : ""}.</p>
<table><tr><th>Sentence</th><th>${mode === "short" ? "Published" : "Before"}</th><th>Scene index, words only</th><th>Scene index, words + meaning</th><th>Meaning pin among the video's own pictures</th><th>Owner's stream, tagged (${esc(vodNote)})</th></tr>
${rows.join("\n")}</table></body></html>`;
await fs.writeFile(path.join(out, "index.html"), html);
console.log(
  JSON.stringify({ episode, out: path.join(out, "index.html"), ...stats }),
);

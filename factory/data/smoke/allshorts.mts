// Proves the Shorts craft (src/render/shortcraft.ts) on real published Shorts from a database COPY: rebuilds each
// Short's render props from its stored plan, plans the craft with a memory carried from one Short to the next (as
// the channel would), prints the media richness before and after and the looks each gets, and with --stills
// renders a still of every new look at its settled frame into data/smoke/allshorts_out/ (and a contact sheet).
// With --time it renders one whole Short twice, without and with the craft, and prints both times.
//
// node --import tsx data/smoke/allshorts.mts [--db data/smoke/dbcopy/db] --eps a,b,c,d [--stills] [--time ep]
// Every episode folder is only read (served over loopback); nothing is written to it or to the database.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { openBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { getBundle, serveDir, webPath } from "../../src/render/render.ts";
import { buildSegments } from "../../src/render/timeline.ts";
import { TAIL_SECONDS } from "../../src/render/plan.ts";
import { emphasisWords, photoCredit, segmentInputs, stampsFor, variantOf } from "../../src/pipeline.ts";
import { bareLines, shortMediaRichness } from "../../src/qa/mediarich.ts";
import { ALL_ON, cardWindow, craftSummary, fillSeconds, HOUSE, planShortCraft, rememberCraft, type RecentCraft } from "../../src/render/shortcraft.ts";

const args = process.argv.slice(2);
const flag = (name: string, fallback = "") => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1]! : fallback;
};
const DB = flag("db", "data/smoke/dbcopy/db");
const EPS = flag("eps").split(",").filter(Boolean);
const TIME = flag("time");
const OUT = path.resolve("data/smoke/allshorts_out");
fs.mkdirSync(OUT, { recursive: true });
const ROOT = "C:/PulseFactory/factory/data/episodes";

const db = new PGlite(DB);
const rows = new Map<string, any>();
for (const id of [...EPS, TIME].filter(Boolean)) {
  const r = (await db.query<any>(`SELECT id, script_json, assets_json, created_at FROM episodes WHERE id = $1`, [id])).rows[0];
  if (r) rows.set(id, r);
}
await db.close();

type Built = { id: string; props: any; craftPlan: any; plainPlan: any; dir: string; stills: Array<{ frame: number; name: string }> };
let recent: RecentCraft[] = [];
const built: Built[] = [];
// Oldest first, so each Short's memory holds the ones before it.
const order = [...EPS].sort((a, b) => String(rows.get(a)?.created_at).localeCompare(String(rows.get(b)?.created_at)));
for (const id of order) {
  const row = rows.get(id);
  if (!row) {
    console.log("missing", id);
    continue;
  }
  const script = row.script_json;
  const assets = row.assets_json;
  const duration = (assets.durationSeconds ?? 30) + TAIL_SECONDS;
  const words = assets.words ?? [];
  const segments = buildSegments(segmentInputs(script, Boolean(assets.desk)), words, duration);
  const variant = variantOf(id);
  const plain = structuredClone(assets.plan);
  delete plain.craft;
  // --demo-photo: none of the sample Shorts' published plans put its real photo on screen, so for the proof the
  // first beat shot of the photo's own beat after the first is given that photo (the photo's tag is its beat).
  if (args.includes("--demo-photo")) {
    const k = (assets.images ?? []).findIndex((i: any) => i.kind === "photo" && i.beatIndex !== undefined);
    if (k >= 0) {
      const beatSeg = segments.findIndex((s, j) => s.kind === "beat" && segments.slice(0, j).filter((x) => x.kind === "beat").length === assets.images[k].beatIndex);
      const shots = plain.shots.map((s: any, j: number) => ({ s, j })).filter(({ s }: any) => s.segment === beatSeg);
      const pick = shots[shots.length - 1];
      if (pick) {
        pick.s.media = { type: "image", index: k };
        console.log(`demo: shot ${pick.j} shows the photo ${assets.images[k].file}`);
      }
    }
  }
  const images = (assets.images ?? []).map((i: any) => ({ ...i, credit: photoCredit(i) }));
  const clips = assets.clips ?? [];
  const stamps = stampsFor(script, words);
  const before = shortMediaRichness(segments, plain, images, clips);
  const day = String(row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at).slice(0, 10);
  const gameYear = Number(assets.steam?.facts?.releaseDate?.match(/\b(19|20)\d\d\b/)?.[0]) || undefined;
  const craft = planShortCraft(
    { segments, words, plan: plain, images, clips, stamps, bare: bareLines(before), game: script.game_title, gameYear, madeYear: Number(day.slice(0, 4)), seed: variant },
    ALL_ON,
    recent,
  );
  recent = rememberCraft(recent, craft, day);
  const after = shortMediaRichness(segments, plain, images, clips, fillSeconds(craft, plain.fps));
  const pc = (x: number) => `${Math.round(x * 100)}%`;
  console.log(`\n=== ${id} "${script.headline}" (${segments.map((s) => s.visual?.kind ?? s.kind).join(", ")})`);
  console.log(`media richness: before ${pc(before.covered)} covered (${pc(before.own)} own), after ${pc(after.covered)}`);
  console.log(`bare lines: ${segments.map((s, i) => (bareLines(before)[i] ? `${s.kind} "${s.text.slice(0, 50)}"` : "")).filter(Boolean).join(" | ") || "none"}`);
  console.log(`craft: ${craftSummary(craft)}`);
  console.log(`cards: ${craft.cards.map((c) => `${segments[c.segment]!.visual!.kind}->${c.look}`).join(", ")}`);
  const craftPlan = { ...plain, craft };
  const stills: Array<{ frame: number; name: string }> = [];
  for (const c of craft.cards) {
    if (c.look === HOUSE) continue;
    const w = cardWindow(segments, words, c.segment, plain.fps, plain.totalFrames);
    stills.push({ frame: w.from + Math.min(24, w.len - 12), name: `card_${c.look.replace("/", "-")}` });
  }
  for (const f of craft.fillers) stills.push({ frame: f.from + Math.min(54, f.len - 14), name: `filler_${f.family}-${f.style}` });
  for (const p of craft.photos) {
    const s = plain.shots[p.shot];
    stills.push({ frame: s.start + Math.min(50, s.end - s.start - 4), name: `photo_${p.treatment}` });
  }
  for (const m of craft.moves) stills.push({ frame: m.kind === "freeze" ? m.at + 14 : m.at + 1, name: `camera_${m.kind}` });
  const dir = `${ROOT}/${id}`;
  const props = {
    headline: script.headline,
    storyType: script.is_rumour ? "rumour" : script.story_type,
    gameTitle: script.game_title,
    isRumour: script.is_rumour,
    attribution: script.attribution,
    gameSubtitle: gameYear ? String(gameYear) : "",
    footageCredit: clips.length ? `Footage: ${script.game_title} · official trailer` : "",
    segments,
    words,
    durationSeconds: duration,
    variant,
    steam: assets.steam?.facts ?? null,
    emphasis: emphasisWords(script),
    deskName: assets.desk?.voice?.name,
    stamps,
    suite: true,
    renderDate: day,
    _images: images,
    _clips: clips,
    _audio: assets.audio,
    _music: assets.musicFile,
  };
  built.push({ id, props, craftPlan, plainPlan: plain, dir, stills });
}

if (!args.includes("--stills") && !TIME) process.exit(0);
const serveUrl = await getBundle();
const browser = await openBrowser("chrome", { chromiumOptions: { gl: "angle" } });
const propsFor = (b: Built, url: string, plan: any) => {
  const { _images, _clips, _audio, _music, ...rest } = b.props;
  return {
    ...rest,
    plan,
    images: _images.map((i: any) => ({ src: `${url}/${webPath(i.file)}`, kind: i.kind, aspect: i.aspect, blurSrc: i.blurFile ? `${url}/${webPath(i.blurFile)}` : null, beatIndex: i.beatIndex })),
    clips: _clips.map((c: any) => ({ src: `${url}/${webPath(c.file)}`, durationSeconds: c.durationSeconds, blurSrc: c.blurFile ? `${url}/${webPath(c.blurFile)}` : null, beatIndex: c.beatIndex, role: c.role, motion: c.motion, luma: c.luma, stock: c.stock })),
    audioSrc: _audio ? `${url}/${webPath(_audio)}` : null,
    musicSrc: _music ?? null,
    logoSrc: "logo.png",
  };
};

if (args.includes("--stills")) {
  const made: string[] = [];
  for (const b of built) {
    const files = await serveDir(b.dir);
    try {
      const inputProps = propsFor(b, files.url, b.craftPlan);
      const composition = await selectComposition({ serveUrl, id: "PulseShort", inputProps, puppeteerInstance: browser });
      for (const s of b.stills) {
        const out = path.join(OUT, `${b.id.slice(-8)}_${s.name}_f${s.frame}.jpg`);
        await renderStill({ composition, serveUrl, output: out, inputProps, frame: s.frame, imageFormat: "jpeg", jpegQuality: 85, scale: 0.5, puppeteerInstance: browser, timeoutInMilliseconds: 180_000 });
        made.push(out);
        console.log("still", path.basename(out));
      }
    } finally {
      await files.close();
    }
  }
  // The contact sheet: every still, six to a row.
  if (made.length) {
    const list = path.join(OUT, "_list.txt");
    fs.writeFileSync(list, made.map((m) => `file '${m.replace(/\\/g, "/")}'`).join("\n"));
    const cols = Math.min(6, made.length);
    const rowsN = Math.ceil(made.length / cols);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", `scale=270:480,tile=${cols}x${rowsN}:padding=6:color=0x202020`, "-frames:v", "1", path.join(OUT, "contact_sheet.jpg")]);
    fs.rmSync(list, { force: true });
    console.log("contact sheet", path.join(OUT, "contact_sheet.jpg"));
  }
}

if (TIME) {
  const b = built.find((x) => x.id === TIME);
  if (!b) throw new Error(`--time ${TIME} must be one of --eps`);
  const files = await serveDir(b.dir);
  try {
    for (const [label, plan] of [["without craft", b.plainPlan], ["with craft", b.craftPlan], ["without craft (again)", b.plainPlan], ["with craft (again)", b.craftPlan]] as const) {
      const inputProps = propsFor(b, files.url, plan);
      const composition = await selectComposition({ serveUrl, id: "PulseShort", inputProps, puppeteerInstance: browser });
      const t0 = Date.now();
      await renderMedia({ composition, serveUrl, codec: "h264", crf: 21, outputLocation: path.join(OUT, `_time_${label.replace(/\W+/g, "_")}.mp4`), inputProps, puppeteerInstance: browser, chromiumOptions: { gl: "angle" }, timeoutInMilliseconds: 300_000 });
      console.log(`render ${label}: ${((Date.now() - t0) / 1000).toFixed(1)} s for ${composition.durationInFrames} frames`);
    }
  } finally {
    await files.close();
  }
}
await browser.close({ silent: true });

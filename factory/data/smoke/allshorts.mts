// Proves the Shorts craft (src/render/shortcraft.ts) on real published Shorts from a database COPY: rebuilds each
// Short's render props from its stored plan, plans the craft with a memory carried from one Short to the next (as
// the channel would), prints the media richness before and after and the looks each gets, and with --stills
// renders a still of every new look at its settled frame into data/smoke/allshorts_out/ (and a contact sheet).
// With --time it renders one whole Short twice, without and with the craft, and prints both times.
//
// With --clean it compares each Short as published (frames pulled from its short.mp4) with the clean frame
// (src/render/cleanframe.ts) rendered at the same moments, prints the per-frame element counts of both and writes
// before/after contact sheets (clean_<ep>.jpg); --only-before <ep,...> does the published half for a Short the
// database copy does not hold.
// node --import tsx data/smoke/allshorts.mts [--db data/smoke/dbcopy/db] --eps a,b,c,d [--stills] [--time ep]
//   [--clean] [--only-before ep]
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
import { elementsAt, ccCredit, elementStats, frameModel, overlaySpans, shortLayout, OPENING_LABEL_FRAMES, type FrameModel } from "../../src/render/cleanframe.ts";
import { motifsFor } from "../../src/render/components/motifs/index.ts";
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

type Built = { id: string; props: any; craftPlan: any; plainPlan: any; dir: string; stills: Array<{ frame: number; name: string }>; suite: boolean; before?: FrameModel; after?: FrameModel; loopFrom?: number };
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
    suite: args.includes("--clean") ? Boolean(assets.suite) : true,
    renderDate: day,
    _images: images,
    _clips: clips,
    _audio: assets.audio,
    _music: assets.musicFile,
  };
  // The element count, as published and as the clean frame draws it (the craft only on a new-look Short, as in the pipeline).
  const suite = Boolean(assets.suite);
  const fps = plain.fps;
  const layout = shortLayout(segments, fps, plain.totalFrames, plain.tailFrames);
  const sting = suite && Boolean(motifsFor({ title: script.game_title, platforms: "", year: gameYear, theme: script.game_title })[0]?.card) && images.length > 0 && layout.hookEnd < plain.totalFrames - 120;
  const footageCredit = clips.length > 0;
  const beforeM = frameModel({
    clean: false,
    spans: overlaySpans({ segments, words, plan: assets.plan, layout, stamps, sting }),
    layout,
    plan: assets.plan,
    words,
    fps,
    credited: (i) => {
      const m = assets.plan.shots[i]?.media;
      return m?.type === "clip" && (footageCredit || clips[m.index]?.stock);
    },
  });
  const afterPlan = suite ? craftPlan : plain;
  const afterM = frameModel({
    clean: true,
    spans: overlaySpans({ segments, words, plan: afterPlan, layout, stamps, sting }),
    layout,
    plan: afterPlan,
    words,
    fps,
    credited: (i) => {
      const m = afterPlan.shots[i]?.media;
      if (m?.type === "clip") return Boolean(clips[m.index]?.stock || ccCredit(clips[m.index]?.provenance));
      if (m?.type === "image") return Boolean(images[m.index]?.credit);
      return false;
    },
  });
  if (args.includes("--clean")) {
    const middle = (f: number) => f < OPENING_LABEL_FRAMES || f >= layout.loopFrom;
    for (const [name, m] of [["published", beforeM], ["clean", afterM]] as const) {
      const all = elementStats(m);
      const mid = elementStats(m, middle);
      console.log(`elements ${name}: most ${all.max} on any frame (frame ${all.worst}: ${all.worstAt.join(" + ")}), mean ${all.mean}, ${Math.round(all.overTwo * 100)}% of frames over 2; after the opening 3 s and before the loop: most ${mid.max}, mean ${mid.mean}, ${Math.round(mid.overTwo * 100)}% over 2`);
    }
  }
  built.push({ id, props, craftPlan: afterPlan, plainPlan: plain, dir, stills, suite, before: beforeM, after: afterM, loopFrom: layout.loopFrom });
}

const ONLY_BEFORE = flag("only-before").split(",").filter(Boolean);
if (args.includes("--plan-only") || (!args.includes("--stills") && !TIME && !args.includes("--clean") && !ONLY_BEFORE.length)) process.exit(0);

const elementsCount = (m: FrameModel, f: number) => elementsAt(m, f).length;
/** Frames for the before/after sheets: eight moments spread over the Short. */
const sheetFrames = (total: number) => [0.02, 0.1, 0.22, 0.35, 0.48, 0.62, 0.76, 0.9].map((x) => Math.round(x * total));
/** A frame of the published Short, pulled from its MP4 (read only), at half size. */
function publishedFrame(dir: string, frame: number, out: string) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", (frame / 30).toFixed(3), "-i", `${dir}/short.mp4`, "-frames:v", "1", "-vf", "scale=540:960", out]);
}
/** A row of stills side by side. */
function row(files: string[], out: string) {
  const list = path.join(OUT, "_row.txt");
  fs.writeFileSync(list, files.map((m) => `file '${m.replace(/\\/g, "/")}'`).join("\n"));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", `scale=270:480,tile=${files.length}x1:padding=4:color=0x202020`, "-frames:v", "1", out]);
  fs.rmSync(list, { force: true });
}
for (const id of ONLY_BEFORE) {
  const dir = `${ROOT}/${id}`;
  const secs = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `${dir}/short.mp4`]).toString().trim());
  const files = sheetFrames(Math.round(secs * 30)).map((f) => {
    const out = path.join(OUT, `_b_${id.slice(-8)}_${f}.jpg`);
    publishedFrame(dir, f, out);
    return out;
  });
  row(files, path.join(OUT, `clean_${id.slice(-8)}_published.jpg`));
  files.forEach((f) => fs.rmSync(f, { force: true }));
  console.log("published sheet", id);
}
const serveUrl = await getBundle();
const browser = await openBrowser("chrome", { chromiumOptions: { gl: "angle" } });
const propsFor = (b: Built, url: string, plan: any) => {
  const { _images, _clips, _audio, _music, ...rest } = b.props;
  return {
    ...rest,
    plan,
    images: _images.map((i: any) => ({ src: `${url}/${webPath(i.file)}`, kind: i.kind, aspect: i.aspect, blurSrc: i.blurFile ? `${url}/${webPath(i.blurFile)}` : null, beatIndex: i.beatIndex, credit: i.credit })),
    clips: _clips.map((c: any) => ({ src: `${url}/${webPath(c.file)}`, durationSeconds: c.durationSeconds, blurSrc: c.blurFile ? `${url}/${webPath(c.blurFile)}` : null, beatIndex: c.beatIndex, role: c.role, motion: c.motion, luma: c.luma, stock: c.stock, credit: ccCredit(c.provenance) })),
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
      const inputProps = { ...propsFor(b, files.url, b.craftPlan), clean: !args.includes("--no-clean") };
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

if (args.includes("--clean")) {
  for (const b of built) {
    const files = await serveDir(b.dir);
    try {
      const inputProps = { ...propsFor(b, files.url, b.craftPlan), clean: true };
      const composition = await selectComposition({ serveUrl, id: "PulseShort", inputProps, puppeteerInstance: browser });
      const frames = sheetFrames(composition.durationInFrames);
      const pub: string[] = [];
      const cln: string[] = [];
      for (const f of frames) {
        const a = path.join(OUT, `_b_${f}.jpg`);
        publishedFrame(b.dir, f, a);
        pub.push(a);
        const c = path.join(OUT, `_a_${f}.jpg`);
        await renderStill({ composition, serveUrl, output: c, inputProps, frame: f, imageFormat: "jpeg", jpegQuality: 85, scale: 0.5, puppeteerInstance: browser, timeoutInMilliseconds: 180_000 });
        cln.push(c);
      }
      const top = path.join(OUT, "_top.jpg");
      const bottom = path.join(OUT, "_bottom.jpg");
      row(pub, top);
      row(cln, bottom);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", top, "-i", bottom, "-filter_complex", "vstack=inputs=2", path.join(OUT, `clean_${b.id.slice(-8)}.jpg`)]);
      for (const f of [...pub, ...cln, top, bottom]) fs.rmSync(f, { force: true });
      const counts = (m: FrameModel) => frames.map((f) => (m ? elementsCount(m, f) : 0)).join(" ");
      console.log(`clean sheet ${b.id}: frames ${frames.join(" ")}; elements published ${counts(b.before!)}; clean ${counts(b.after!)}`);
    } finally {
      await files.close();
    }
  }
}

if (TIME) {
  const b = built.find((x) => x.id === TIME);
  if (!b) throw new Error(`--time ${TIME} must be one of --eps`);
  const files = await serveDir(b.dir);
  try {
    for (const [label, plan, clean] of [["as published (no craft, old frame)", b.plainPlan, false], ["craft, old frame", b.craftPlan, false], ["craft, clean frame", b.craftPlan, true], ["as published (again)", b.plainPlan, false], ["craft, old frame (again)", b.craftPlan, false], ["craft, clean frame (again)", b.craftPlan, true]] as const) {
      const inputProps = { ...propsFor(b, files.url, plan), clean };
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

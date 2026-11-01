// 1 Nov 2026: proof of the newer picture libraries (src/assets/libraries.ts, press.ts, stock.ts) on a COPY of
// the database, offline: nothing is written to the database, nothing is uploaded or rendered.
//   gather: for the documentary, every sentence without a picture of its own asks the new libraries the way the
//     sentence top-up does (Openverse/Flickr and Pixabay photos for real-world lines and named people, press
//     pictures for announcement lines, Internet Archive films for B-roll lines); the picture editor (rankStills,
//     the production screen, mid tier) then pins what truly shows a sentence. For each news Short the press sites
//     are asked for its game. Writes <out>/report.json.
//   screen: the local frame screen (Ollama, through the PC orchestrator) over the Shorts' press pictures.
//   sheet: a contact sheet of what was kept, each with its on-screen credit (<out>/contact_sheet.jpg).
// Usage: node --import tsx data/smoke/libraries_proof.mts <gather|screen|sheet> <db copy dir> <out dir> [--judge] [--max-stock=4]
// --judge reads only the Claude key from the live factory/.env (never written).
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";

const run = promisify(execFile);
const [mode, dbDir, out] = process.argv.slice(2) as [string, string, string];
const judge = process.argv.includes("--judge");
const maxStock = Number(process.argv.find((x) => x.startsWith("--max-stock="))?.split("=")[1] ?? 4);
const DOC = "ep_20261027_865858f8";
const SHORTS = ["ep_20261101_fccb2c0a", "ep_20261031_5e0b8842", "ep_20261029_d715f49a"];
fs.mkdirSync(out, { recursive: true });
const reportFile = path.join(out, "report.json");

const { searchOpenverse, searchPixabayImages, photoProvenance, photoCreditOf, searchLicensedPhotos } = await import("../../src/assets/libraries.ts");
const { searchPress } = await import("../../src/assets/press.ts");
const { archiveLibrary, libraryStockClips, stockCredit } = await import("../../src/assets/stock.ts");
const { downloadCommons } = await import("../../src/assets/commons.ts");
const { pressForShort } = await import("../../src/assets/librarystep.ts");
const { photoMatches, titleWords, realWorld, announcementLines } = await import("../../src/assets/fill.ts");
const { rankStills, uncoveredTargets } = await import("../../src/assets/stillscore.ts");
const { shortHash } = await import("../../src/assets/repeats.ts");
const { FFMPEG } = await import("../../src/lib/bin.ts");

if (mode === "gather") {
  let llm: any;
  if (judge) {
    for (const line of fs.readFileSync("C:/PulseFactory/factory/.env", "utf8").split(/\r?\n/)) {
      const m = line.match(/^(ANTHROPIC_API_KEY|ANTHROPIC_WORKSPACE_ID)=(.*)$/);
      if (m) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
    const { createClaude } = await import("../../src/editorial/llm.ts");
    llm = createClaude({ top: "claude-opus-5-5", mid: "claude-sonnet-5-5", low: "claude-haiku-5-5" });
  }
  const db = new PGlite(dbDir);
  const rows = (await db.query<any>(`SELECT id, script_json s, assets_json a FROM episodes WHERE id = ANY($1)`, [[DOC, ...SHORTS]])).rows;
  await db.close();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const { chapterSentences } = await import("../../src/pipeline.ts");
  const pixKey = process.env.PIXABAY_API_KEY ?? "";
  // The new photo libraries only (Commons is what the video already had).
  const newPhotos = (q: string) =>
    searchLicensedPhotos(
      {
        commons: async () => [],
        openverse: (x) => searchOpenverse(x),
        pixabay: pixKey ? (x) => searchPixabayImages(pixKey, x) : undefined,
      },
      q,
    );
  const report: any = { when: new Date().toISOString(), pixabay: pixKey ? "key present" : "no PIXABAY_API_KEY: skipped", shorts: [], doc: { chapters: [] } };

  // News Shorts: the press sites for each Short's game.
  for (const id of SHORTS) {
    const ep = byId.get(id)!;
    const dir = path.join(out, id);
    const t0 = Date.now();
    const found = await searchPress(ep.s.game_title);
    const kept = await pressForShort({ searchPress: async () => found, downloadPhoto: (i, d) => downloadCommons(i, d) }, dir, ep.s.game_title, new Set((ep.a.images ?? []).map((i: any) => i.sourceUrl)), 3);
    report.shorts.push({
      id,
      headline: ep.s.headline,
      game: ep.s.game_title,
      seconds: Math.round((Date.now() - t0) / 1000),
      returned: found.map((f) => ({ site: f.via, post: f.title, url: f.url })),
      downloaded: kept.map((k) => ({ file: path.join(id, k.file), size: `${k.width}x${k.height}`, credit: photoCreditOf(k), provenance: k.provenance })),
    });
    console.log(`Short ${id}: press returned ${found.length}, kept ${kept.length} after size check`);
  }

  // The documentary: sentences without a picture of their own.
  const ep = byId.get(DOC)!;
  const entries = [...ep.s.entries].sort((a: any, b: any) => b.rank - a.rank);
  let stockLeft = maxStock;
  let totalBare = 0;
  let filled = 0;
  for (const [i, e] of entries.entries()) {
    const moments = e.moments ?? [];
    const sentences = chapterSentences(ep.s, i);
    const own = new Set<number>();
    for (const x of [...ep.a.images, ...ep.a.clips]) if (x.beatIndex === i && x.moment !== undefined) own.add(x.moment);
    const bare = moments.map((_: any, k: number) => k).filter((k: number) => !own.has(k));
    totalBare += bare.length;
    const ch = { entry: i, game: e.game_title, year: e.year, moments, sentences };
    const dir = path.join(out, DOC, `entry_${i}`);
    const chap: any = { entry: i, game: e.game_title, sentences: moments.length, bare: bare.length, photos: [], press: [], stock: [], kept: [] };
    const candidates: any[] = [];
    // Photos: the sentence top-up's queries (named people, real-world lines), new libraries only.
    const queries = new Map<string, { person?: string; words: string[] }>();
    for (const k of bare) {
      const m = moments[k];
      if (m.person && m.person.trim().split(/\s+/).length >= 2) queries.set(m.person.trim(), { person: m.person.trim(), words: [] });
      else if (realWorld(m)) {
        const words = titleWords(m.show);
        if (words.length) queries.set(m.show.split(/\s+/).slice(0, 6).join(" "), { words });
      }
    }
    for (const [q, want] of [...queries].slice(0, 4)) {
      const got = await newPhotos(q).catch(() => []);
      const match = got.filter((g) => photoMatches(g.title, want)).slice(0, 3);
      chap.photos.push({ query: q, returned: got.length, titleMatches: match.length, sample: got.slice(0, 3).map((g) => `${g.via}: ${g.title} (${g.license})`) });
      for (const img of match) {
        const file = path.join(dir, "photos", `p-${shortHash(img.pageUrl)}.jpg`);
        if (await downloadCommons(img, file)) candidates.push({ kind: "photo", file, provenance: photoProvenance(img) });
      }
    }
    // Press pictures for announcement lines.
    const ann = announcementLines(ch, bare);
    if (ann.length) {
      const got = await searchPress(e.game_title, { max: 4 });
      chap.press = got.map((g) => ({ site: g.via, post: g.title, url: g.url }));
      for (const img of got) {
        const file = path.join(dir, "press", `p-${shortHash(img.url)}.jpg`);
        if (await downloadCommons(img, file)) candidates.push({ kind: "article", file, provenance: photoProvenance(img) });
      }
    }
    // Archive films for B-roll lines, judged by the stock picker.
    const brollLines = bare.filter((k: number) => moments[k].broll?.trim()).slice(0, Math.max(0, stockLeft));
    if (brollLines.length && judge) {
      const targets = brollLines.map((k: number) => ({ key: `beat:${i}#m${k}`, text: `${sentences[k] ?? ""} (show: ${moments[k].broll})`, want: "cinematic" as const, energy: "medium" as const, keywords: [moments[k].broll] }));
      const clips = await libraryStockClips([archiveLibrary()], dir, targets, ["Grand", "Theft", "Auto", "GTA"], targets.length, async (t, previews) => {
        const r = await rankStills(llm, [{ key: "m0", show: t.keywords.join(", "), sentence: t.text }], previews.map((file) => ({ file })), path.join(dir, "stockpick"), undefined, "stock");
        chap.stock.push({ line: t.text.slice(0, 140), previews: previews.length, picked: r.picks[0]?.image ?? null, labels: [...r.labels.values()] });
        return r.picks[0]?.image;
      });
      stockLeft -= targets.length;
      for (const c of clips) chap.kept.push({ sentence: c.moment, text: sentences[c.moment!] ?? "", file: path.join(dir, c.file), clip: true, credit: stockCredit(c.provenance), provenance: c.provenance, why: c.reason });
    }
    // The picture editor over the new pictures, against this chapter's sentences without a picture.
    if (candidates.length && judge) {
      const want = uncoveredTargets(moments, sentences, own);
      const ranked = await rankStills(llm, want, candidates.slice(0, 24), path.join(dir, "score"), undefined, "documentary");
      chap.screened = candidates.slice(0, 24).map((c, n) => ({ file: c.file, label: ranked.labels.get(n), refused: ranked.withText.has(n) ? "text, logo or gore on it" : undefined, credit: photoCreditOf(c) }));
      for (const p of ranked.picks) {
        const c = candidates[p.image];
        const k = Number(p.key.slice(1));
        chap.kept.push({ sentence: k, text: sentences[k] ?? "", show: moments[k]?.show, file: c.file, credit: photoCreditOf(c), label: p.label, provenance: c.provenance, why: `picture editor: shows "${moments[k]?.show}" (confidence 0.5 or more)` });
      }
    }
    chap.filled = new Set(chap.kept.map((k: any) => k.sentence)).size;
    filled += chap.filled;
    report.doc.chapters.push(chap);
    console.log(`Doc chapter ${i} ${e.game_title}: ${bare.length} without a picture, ${candidates.length} new pictures, ${chap.filled} pinned`);
  }
  report.doc.totalSentences = entries.reduce((n: number, e: any) => n + (e.moments?.length ?? 0), 0);
  report.doc.withoutOwnPicture = totalBare;
  report.doc.filledByNewLibraries = filled;
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`documentary: ${filled} of ${totalBare} sentences without a picture of their own now have one from the new libraries`);
}

if (mode === "screen") {
  const { screenFrames, rejectReason, unloadLocalVision } = await import("../../src/assets/localvision.ts");
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  for (const s of report.shorts) {
    const files = s.downloaded.map((d: any) => path.join(out, d.file));
    const flags = await screenFrames(files);
    s.downloaded.forEach((d: any, n: number) => {
      const f = flags[n];
      d.screen = f ? { ...f, verdict: f.webcam || f.gore ? `dropped: ${rejectReason(f)}` : f.text ? "kept, used after the clean pictures (text on it)" : "kept, clean" } : { verdict: "local model did not answer: kept for Claude's checks" };
    });
  }
  await unloadLocalVision();
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.shorts.map((s: any) => s.downloaded.map((d: any) => d.screen.verdict)), null, 1));
}

if (mode === "sheet") {
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  const items: Array<{ file: string; clip?: boolean; top: string; bottom: string }> = [];
  for (const s of report.shorts)
    for (const d of s.downloaded)
      if (!/dropped/.test(d.screen?.verdict ?? "")) items.push({ file: path.join(out, d.file), top: `Short: ${s.game}`, bottom: d.credit });
  for (const c of report.doc.chapters) for (const k of c.kept) items.push({ file: k.file, clip: k.clip, top: `Doc ch${c.entry} s${k.sentence}: ${String(k.show ?? k.text).slice(0, 48)}`, bottom: k.credit });
  const tdir = path.join(out, "sheet");
  await fsp.rm(tdir, { recursive: true, force: true });
  fs.mkdirSync(tdir, { recursive: true });
  const esc = (t: string) => t.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%");
  const font = "C\\:/Windows/Fonts/arial.ttf";
  let n = 0;
  for (const it of items) {
    const dest = path.join(tdir, `t_${String(n).padStart(3, "0")}.jpg`);
    const vf = `scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2:color=0x111111,drawbox=y=0:w=iw:h=24:color=black@0.7:t=fill,drawbox=y=ih-24:w=iw:h=24:color=black@0.7:t=fill,drawtext=fontfile='${font}':text='${esc(it.top)}':x=6:y=5:fontsize=14:fontcolor=white,drawtext=fontfile='${font}':text='${esc(it.bottom ?? "")}':x=6:y=h-19:fontsize=13:fontcolor=0xffd27a,format=yuvj420p`;
    const input = it.clip ? ["-ss", "2", "-i", it.file] : ["-i", it.file];
    try {
      await run(FFMPEG, ["-loglevel", "error", "-y", ...input, "-frames:v", "1", "-vf", vf, "-q:v", "3", dest]);
      n++;
    } catch (err) {
      console.log("skipped", it.file, String(err).slice(0, 200));
    }
  }
  const cols = 4;
  const rowsN = Math.ceil(n / cols);
  await run(FFMPEG, ["-loglevel", "error", "-y", "-framerate", "1", "-i", path.join(tdir, "t_%03d.jpg"), "-vf", `tile=${cols}x${rowsN}:padding=4:color=0x000000`, "-frames:v", "1", "-q:v", "3", path.join(out, "contact_sheet.jpg")]);
  console.log(`contact sheet: ${n} pictures and clips -> ${path.join(out, "contact_sheet.jpg")}`);
}

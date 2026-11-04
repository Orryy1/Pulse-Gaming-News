// The Final Fantasy XIV documentary's repair, in a sandbox copy (DATA_DIR): the two rewritten chapters go into the
// script, their voice is stitched in with everything else kept, their shot lists and media are made again, and the
// video renders without touching the live factory, YouTube or Discord. Stages, run in this order:
//   stitch  puts the new words and voice in place (no credit: the voice is already made by ffxiv_voice.mts)
//   plan    the shot list for the two chapters (one mid-tier call a chapter)
//   media   their pictures and footage, the top-up and fillers for them, plus extra <entries> asked for
//   render  the normal render step, then the normal release step
//   check   prints where it stands
// Usage: DATA_DIR=<sandbox> node --import tsx data/smoke/ffxiv_repair.mts <stage> <new_chapters.json> <voice dir> [extra entries]
process.env.PULSE_ENV_FILE = "C:/PulseFactory/factory/.env";
Object.assign(process.env, {
  CODEX_LLM: "false",
  SHORT_RUN_FILE: "",
  DRY_RUN: "true",
  LONGFORM_ENABLED: "true",
  KEEP_FREE_WINDOWS: "",
});
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const ID = "ep_20261104_eb2f1d77";
const A = 693.35; // where chapter 5's narration opens, after its breather
const B = 995.34; // where chapter 7's breather opens
const [stage, chaptersFile, voiceDir, ...extra] = process.argv.slice(2);
const { loadConfig } = await import("../../src/config.ts");
const { openDb, migrate } = await import("../../src/db.ts");
const { createServices } = await import("../../src/services.ts");
const pipe = await import("../../src/pipeline.ts");
const { getEpisode, logEvent } = await import("../../src/episodes.ts");
const { srtFromWords, buildSegments } = await import("../../src/render/timeline.ts");
const { scriptWriterNotes, releaseWriterNotes } = await import("../../src/editorial/writernotes.ts");
const { sentencesOf } = await import("../../src/editorial/longform.ts");
const { writeDocMoments, groundDocMoments } = await import("../../src/editorial/documentary.ts");
const { markEvidence } = await import("../../src/editorial/evidence.ts");
const { fillSentencePictures, coverageShare, coveredMoments } = await import("../../src/assets/fill.ts");
const { chooseEpisodeFillers, episodeClipCheck } = await import("../../src/assets/fillerstep.ts");
const { runFootageFirst, footageOptions } = await import("../../src/assets/footagestep.ts");
const cfg = loadConfig();
// A sandbox has no slots to keep clear; the orchestrator keeps it out of the real ones (--est on the outer lease).
Object.assign(cfg, { newsSlots: [], whyEnabled: false, evergreenEnabled: false, weeklyEnabled: false, dealsDays: [], shortRunFile: "" });
const db = await openDb(cfg.databaseUrl, cfg.dataDir);
await migrate(db);
await db.query("DELETE FROM leases");
const s: any = createServices(db, cfg);
const notes: string[] = [];
s.notify = async (m: any) => {
  const line = m.content ?? m.embeds?.[0]?.title ?? "";
  notes.push(line);
  console.log("ALERT:", line.slice(0, 600));
  return true;
};
const fresh = chaptersFile && fs.existsSync(chaptersFile) ? JSON.parse(fs.readFileSync(chaptersFile, "utf8")) : {};
const dir = path.join(cfg.dataDir, "episodes", ID);
const save = (script: any, assets: any) =>
  db.query(`UPDATE episodes SET script_json = $2, assets_json = $3 WHERE id = $1`, [ID, JSON.stringify(script), JSON.stringify(assets)]);
const ep: any = await getEpisode(db, ID);
const script: any = ep.script_json;
const assets: any = ep.assets_json;

if (stage === "stitch") {
  if (ep.status === "voiced" && assets.repairedChapters) throw new Error("already stitched");
  // The new narration, in place of beats 19-26.
  const beats: any[] = [];
  for (const c of [4, 5]) {
    const ch = fresh[String(c)];
    const entry = script.entries.find((_: any, i: number) => i === c);
    entry.year = ch.year;
    ch.paragraphs.forEach((p: any, pi: number) => {
      beats.push({
        narration: p.narration,
        footage: p.footage,
        visual:
          pi === 0
            ? { kind: "chapter", primary: ch.chapter_title, secondary: entry.game_title, value_a: c + 1, items: [String(ch.year), "PC"] }
            : p.callout.kind === "none"
              ? { kind: "none", primary: "", secondary: "" }
              : { kind: p.callout.kind, primary: p.callout.primary, secondary: p.callout.secondary },
      });
    });
  }
  const starts = script.beats.flatMap((b: any, i: number) => (b.visual?.kind === "chapter" ? [i] : []));
  if (starts[4] !== 19 || starts[6] !== 27) throw new Error(`unexpected chapter layout ${starts}`);
  script.beats.splice(19, 8, ...beats);
  script.entries[4].photos = ["Tokyo Game Show 2011 Makuhari Messe", "Shinjuku Bunka Quint Building"];
  script.entries[5].photos = ["Maya calendar stone", "Tokyo Game Show 2012"];
  const had = script.claims.length;
  script.claims = script.claims.filter((c: any) => !/excerpt|supplied|\bSOURCE\b|rejected|the brief|omitted|your instruction/i.test(c.claim));
  script.claims.push(...fresh["4"].claims, ...fresh["5"].claims);
  console.log("claims", had, "->", script.claims.length);
  // The voice: head and tail kept to the sample, the new chapters and a breather between them in the middle.
  const c4 = JSON.parse(fs.readFileSync(path.join(voiceDir!, "ch4.json"), "utf8"));
  const c5 = JSON.parse(fs.readFileSync(path.join(voiceDir!, "ch5.json"), "utf8"));
  const voice = path.join(dir, "voice.mp3");
  fs.copyFileSync(voice, path.join(dir, "voice_before_repair.mp3"));
  const BREAK = 4;
  const graph = [
    `[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono,asplit=2[h0][t0]`,
    `[h0]atrim=end=${A},asetpts=PTS-STARTPTS[h]`,
    `[t0]atrim=start=${B},asetpts=PTS-STARTPTS[t]`,
    `[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono[a]`,
    `[2:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono[b]`,
    `anullsrc=r=44100:cl=mono,atrim=0:${BREAK},aformat=sample_fmts=fltp[z]`,
    `[h][a][z][b][t]concat=n=5:v=0:a=1[out]`,
  ].join(";");
  const tmp = path.join(dir, "voice.stitched.mp3");
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", path.join(dir, "voice_before_repair.mp3"), "-i", path.join(voiceDir!, "ch4.mp3"), "-i", path.join(voiceDir!, "ch5.mp3"), "-filter_complex", graph, "-map", "[out]", "-c:a", "libmp3lame", "-q:a", "2", tmp]);
  fs.renameSync(tmp, voice);
  const shift = (w: any[], by: number) => w.map((x) => ({ ...x, start: x.start + by, end: x.end + by }));
  const probe = (f: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f], { encoding: "utf8" }).trim());
  const at4 = A;
  const brk = at4 + probe(path.join(voiceDir!, "ch4.mp3"));
  const at5 = brk + BREAK;
  const tailAt = at5 + probe(path.join(voiceDir!, "ch5.mp3"));
  const delta = tailAt - B;
  const head = assets.words.filter((w: any) => w.start < A);
  const tail = assets.words.filter((w: any) => w.start >= B);
  assets.words = [...head, ...shift(c4.words, at4), ...shift(c5.words, at5), ...shift(tail, delta)];
  assets.breaks = assets.breaks.flatMap((b: any) =>
    b.end <= A ? [b] : b.start < B ? [] : [{ start: b.start + delta, end: b.end + delta }],
  );
  assets.breaks.splice(5, 0, { start: brk, end: at5 });
  assets.durationSeconds += delta;
  fs.writeFileSync(path.join(dir, "captions.srt"), srtFromWords(assets.words), "utf8");
  // Media tied to the old words goes; the plan, the graphics check's mutes and notes on those chapters with it.
  const gone = (x: any) => x.beatIndex === 4 || x.beatIndex === 5;
  console.log("media dropped", (assets.clips ?? []).filter(gone).length, "clips", (assets.images ?? []).filter(gone).length, "images");
  assets.clips = assets.clips.filter((x: any) => !gone(x));
  assets.images = assets.images.filter((x: any) => !gone(x));
  assets.quietMoments = (assets.quietMoments ?? []).filter((k: string) => !/^[45]:/.test(k));
  delete assets.longPlan;
  delete assets.video;
  delete assets.graphicsPrepass;
  assets.repairedChapters = [4, 5];
  script.entries[4].moments = [];
  script.entries[5].moments = [];
  await db.query(
    `UPDATE episodes SET status = 'voiced', youtube_video_id = NULL, youtube_status = NULL, upload_session_uri = NULL, publish_at = NULL, slot_at = NULL, qa_json = NULL, attempts = 0, last_error = NULL, next_attempt_at = NULL WHERE id = $1`,
    [ID],
  );
  await db.query(`DELETE FROM episodes WHERE id <> $1`, [ID]);
  await save(script, assets);
  const segs = buildSegments(pipe.segmentInputs(script), assets.words, assets.durationSeconds);
  const ch = segs.filter((g: any) => g.kind === "beat" && g.visual?.kind === "chapter").map((g: any) => g.start.toFixed(1));
  console.log("chapter starts", ch.join(" "), "| breaks", assets.breaks.map((b: any) => b.end.toFixed(1)).join(" "));
  console.log("duration", assets.durationSeconds.toFixed(1), "delta", delta.toFixed(1));
  console.log("writer's notes left, script (beats only):", scriptWriterNotes({ hook: script.hook, beats: script.beats }).length);
}

if (stage === "fixdelay") {
  // The first stitch used the narrator's reported lengths, 0.15 s longer each than the files: word timings only.
  const by = (a: number, b: number, d: number) => assets.words.forEach((w: any) => { if (w.start >= a && w.start < b) { w.start += d; w.end += d; } });
  const tailStart = assets.breaks[6].end - 0.2; // inside the breather before chapter 7
  by(tailStart, 1e9, -0.3);
  by(assets.breaks[5].start + 1, tailStart, -0.15);
  assets.breaks[5] = { start: assets.breaks[5].start - 0.15, end: assets.breaks[5].end - 0.15 };
  assets.breaks = assets.breaks.map((b: any, i: number) => (i > 5 ? { start: b.start - 0.3, end: b.end - 0.3 } : b));
  assets.durationSeconds -= 0.3;
  fs.writeFileSync(path.join(dir, "captions.srt"), srtFromWords(assets.words), "utf8");
  await save(script, assets);
  console.log(JSON.stringify(assets.breaks.slice(4, 8)), assets.durationSeconds, JSON.stringify(assets.words.filter((w: any) => w.start > 965 && w.start < 971)));
}

if (stage === "plan") {
  const games = script.entries.map((e: any) => e.game_title);
  for (const c of [4, 5]) {
    const entry = script.entries[c];
    const ch = fresh[String(c)];
    const focus = ch.paragraphs.map((p: any) => p.narration).join(" ").slice(0, 600);
    const source = await pipe.widerDocSource(
      s,
      { wiki_title: "Final Fantasy XIV (2010 video game)", game_title: entry.game_title, year: 2010, chapter_title: ch.chapter_title, focus },
      "Final Fantasy XIV",
      [],
    );
    const sentences = ch.paragraphs.flatMap((p: any) => sentencesOf(p.narration));
    const shot = groundDocMoments(
      await writeDocMoments(s.llm, { game: entry.game_title, chapterTitle: ch.chapter_title, sentences, source: source!, games, lessons: "", evidence: cfg.docEvidence }),
      source!,
      games,
      sentences,
    );
    let moments = shot.moments;
    if (cfg.docEvidence) moments = markEvidence(moments, sentences, source!).moments;
    entry.moments = moments;
    console.log(`chapter ${c}: ${sentences.length} sentences, ${moments.length} moments; removed: ${shot.removed.length}`);
    moments.forEach((m: any, i: number) => console.log(`  ${i}. [${m.graphic?.kind}] ${(m.graphic?.primary ?? "").slice(0, 50)} | ${m.show.slice(0, 70)} | ${sentences[i]!.slice(0, 50)}`));
  }
  // The question planted in chapter 3 is answered here now.
  const said = fresh["5"].paragraphs.flatMap((p: any) => sentencesOf(p.narration));
  const answer = said.findIndex((x: string) => /closing server got into the plot/.test(x));
  for (const l of script.open_loops ?? [])
    if (/server shutdown/i.test(l.question)) {
      console.log("loop", JSON.stringify(l), "payoff moment ->", answer);
      if (l.payoff?.entry === 5) l.payoff.moment = answer;
      if (l.plant?.entry === 5 || l.plant?.entry === 4) throw new Error("a plant in a rewritten chapter");
    }
  await save(script, assets);
}

if (stage === "media") {
  // The one graphic outside the rewritten chapters that talks about the source.
  const m25 = script.entries[8].moments[25];
  if (/What the count establishes/.test(m25?.graphic?.primary ?? "")) {
    m25.graphic.primary = "Registered, not active";
    m25.graphic.items = ["Registered players: over 24 million", "Active at the same time: a smaller number"];
  }
  const entries = extra.length ? extra.map(Number) : [0, 1, 2, 3, 4, 5, 6, 7, 8];
  for (const c of entries) {
    const t0 = Date.now();
    const before = [assets.images.length, assets.clips.length];
    await pipe.gatherChapterMedia(s, script, script.entries[c], c, dir, assets.images, assets.clips);
    console.log(`gathered chapter ${c}: ${assets.images.length - before[0]} stills, ${assets.clips.length - before[1]} clips, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    await save(script, assets);
  }
  // The cinematic the chapter is about, from the publisher.
  const entry = script.entries[5];
  const sentences = pipe.chapterSentences(script, 5);
  const wanted = pipe.docShotTargets(entry, sentences, 5).filter((x: any) => Number(x.key.match(/#m(d+)$/)?.[1]) >= 20);
  const om = await s.fetchOfficialMedia("Final Fantasy XIV End of an Era", path.join(dir, "entry_5"), wanted, Math.max(4, wanted.length), "").catch((e: any) => { console.log("official media failed", String(e).slice(0, 200)); return { clips: [], stills: [] }; });
  console.log("official:", om.trailer?.title ?? "none", om.clips.length);
  for (const c of om.clips)
    assets.clips.push({ file: path.join("entry_5", c.file), sourceUrl: c.sourceUrl, provenance: c.provenance, durationSeconds: Math.min(c.durationSeconds ?? 4, 4.8), beatIndex: 5, moment: c.moment, motion: c.motion, luma: c.luma, label: c.label, reason: c.reason, startSeconds: c.startSeconds });
  await save(script, assets);
  // The same trailer second or picture fetched for two chapters plays once: the first keeps it, the rest can borrow.
  const seen = new Set<string>();
  const keyOf = (x: any) => (x.sourceUrl ? `${x.sourceUrl}@${Math.round(x.startSeconds ?? 0)}` : x.file);
  const beforeDedupe = assets.clips.length;
  assets.clips = assets.clips.filter((x: any) => { const k = keyOf(x); if (seen.has(k)) return false; seen.add(k); return true; });
  const stillSeen = new Set<string>();
  const stillsBefore = assets.images.length;
  assets.images = assets.images.filter((x: any) => { if (!x.sourceUrl || x.moment !== undefined) return true; if (stillSeen.has(x.sourceUrl)) return false; stillSeen.add(x.sourceUrl); return true; });
  console.log("deduped", beforeDedupe - assets.clips.length, "clips", stillsBefore - assets.images.length, "stills");
  const all = entries.map((c: number) => ({ entry: c, game: script.entries[c].game_title, year: script.entries[c].year, moments: script.entries[c].moments ?? [], sentences: pipe.chapterSentences(script, c) }));
  const r = await fillSentencePictures(s, dir, all, assets.images, assets.clips, script.game_title || script.headline, pipe.scopeOf(script), undefined, { stockThemeMax: cfg.stockThemeMax });
  console.log("fill", JSON.stringify(r));
  await save(script, assets);
  const done = await chooseEpisodeFillers({ chapters: all as never, images: assets.images, clips: assets.clips, variant: pipe.variantOf(ID), sketches: cfg.illustrate, check: episodeClipCheck(dir), now: new Date(), headline: script.headline, logEvent: (kind: string, detail: any) => logEvent(db, ID, kind, detail), notify: s.notify });
  if (done) assets.fillersChosen = { ...done, checked: false };
  console.log("fillers", JSON.stringify(done ?? null));
  await save(script, assets);
}

if (stage === "footage") {
  assets.clips ??= [];
  const prior = assets.footageFirst;
  assets.footageFirst = await runFootageFirst({
    deps: s.footageFirstDeps(),
    chapters: [...script.entries].sort((a: any, b: any) => b.rank - a.rank).map((e: any, i: number) => ({ entry: i, game: e.game_title, franchise: script.game_title || e.game_title, year: e.year, moments: e.moments ?? [], sentences: pipe.chapterSentences(script, i) })),
    clips: assets.clips,
    dir,
    options: footageOptions(cfg),
    headline: script.headline,
    logEvent: (kind: string, detail: any) => logEvent(db, ID, kind, detail),
    notify: s.notify,
  });
  assets.footageFirst.sourcesSeen = (assets.footageFirst.sourcesSeen ?? 0) + (prior?.sourcesSeen ?? 0);
  console.log("footage first", JSON.stringify({ kept: assets.footageFirst.kept, seconds: assets.footageFirst.keptSeconds, perChapter: assets.footageFirst.perChapter, minutes: assets.footageFirst.minutes }));
  await save(script, assets);
}

if (stage === "render") {
  const again: any = await getEpisode(db, ID);
  await pipe.advance(s, again);
  const after: any = await getEpisode(db, ID);
  console.log("status", after.status, "|", after.last_error ?? "");
  if (after.status === "rendered") {
    await pipe.advance(s, after);
    const done: any = await getEpisode(db, ID);
    console.log("after release", done.status, "|", done.last_error ?? "", JSON.stringify(done.qa_json?.release?.stats ?? {}), JSON.stringify(done.qa_json?.release?.reasons ?? []));
  }
}

const now: any = await getEpisode(db, ID);
const srt = fs.existsSync(path.join(dir, "captions.srt")) ? fs.readFileSync(path.join(dir, "captions.srt"), "utf8") : undefined;
const left = releaseWriterNotes({ script: now.script_json, words: now.assets_json?.words, srt });
console.log("STATE", now.status, "| writer's notes anywhere:", left.length, left.slice(0, 3).map((x: any) => x.where + ": " + x.sentence.slice(0, 100)));
const a = now.assets_json;
const onScreen = (now.script_json.entries ?? []).map((e: any, i: number) => ({ entry: i, game: e.game_title, sentences: [], moments: (e.moments ?? []) }));
const cov = { all: coverageShare(onScreen, a.images ?? [], a.clips ?? []), perChapter: onScreen.map((c: any) => `${c.entry}: ${coveredMoments(c.entry, c.moments, a.images ?? [], a.clips ?? []).size}/${c.moments.length}`), stills: (a.images ?? []).length, clips: (a.clips ?? []).length, muted: (a.quietMoments ?? []).length };
console.log("coverage", JSON.stringify(cov));
console.log("windows", JSON.stringify((await import("../../src/pcschedule.ts")).pcWindows(cfg, new Date(), []).slice(0, 3)));
await logEvent(db, ID, "repair_stage", { stage });
await db.close();

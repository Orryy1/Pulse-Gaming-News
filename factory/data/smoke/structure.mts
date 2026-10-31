// The documentary structure devices (src/render/structure.ts, src/editorial/openloops.ts) run offline on a
// real documentary from a COPY of the database: the open loops its own text makes, what the writer would be
// told chapter by chapter, where the title drops, the chapter index and years, the callbacks, the cut rhythm
// and the bookend ending, and (with "stills") a few frames of the PulseLong composition on a cut-down
// version of it. No model call, no GPU job, nothing written to the database.
//
//   node --import tsx data/smoke/structure.mts plan   <db dir> <episode id> <out dir>
//   node --import tsx data/smoke/structure.mts stills <db dir> <episode id> <out dir> <episode folder (read only)>
import fs from "node:fs";
import path from "node:path";

const [mode, dbDir, id, out, epDir] = process.argv.slice(2);
if (!mode || !dbDir || !id || !out) {
  console.error("usage: structure.mts plan|stills <db dir> <episode id> <out dir> [episode folder]");
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });

const { createEmbeddedDb } = await import("../../src/db.ts");
const { segmentInputs } = await import("../../src/pipeline.ts");
const { buildSegments } = await import("../../src/render/timeline.ts");
const { buildLongPlan, openChaptersAtBreaks, momentWindows, momentKeys, LONG_FPS } = await import(
  "../../src/render/longplan.ts"
);
const { loopsOfScript } = await import("../../src/editorial/documentary.ts");
const { groundOpenLoops, loopBrief, loopProblems, findPayoff } = await import("../../src/editorial/openloops.ts");
const { sentencesOf } = await import("../../src/editorial/longform.ts");
const S = await import("../../src/render/structure.ts");
const { coldOpenTiming } = await import("../../src/render/bookends.ts");

const db = await createEmbeddedDb(dbDir);
const [row] = await db.query<{ script_json: any; assets_json: any }>(
  "SELECT script_json, assets_json FROM episodes WHERE id = $1",
  [id],
);
await db.close();
if (!row) throw new Error(`no episode ${id} in ${dbDir}`);
const script = row.script_json;
const assets = row.assets_json;
const fps = LONG_FPS;
const words = assets.words ?? [];
const duration = (assets.durationSeconds ?? 300) + 6;
const segments = openChaptersAtBreaks(buildSegments(segmentInputs(script), words, duration), assets.breaks);
const breaks = (assets.breaks ?? []).map((b: { start: number; end: number }) => ({
  from: Math.round(b.start * fps),
  to: Math.round(b.end * fps),
}));
const moments = [...(script.entries ?? [])].sort((a: any, b: any) => b.rank - a.rank).map((e: any) => e.moments ?? []);
const windows = momentWindows(segments, words, moments.map((m: any[]) => m.length), moments.map((e: any[]) => e.map(momentKeys)));
const mmss = (f: number) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const lines: string[] = [];
const say = (t = "") => {
  lines.push(t);
  console.log(t);
};

// ---- open loops
const hook = sentencesOf(script.hook);
const chapters: string[][] = [];
for (const b of script.beats) {
  if (b.visual?.kind === "chapter" || !chapters.length) chapters.push([]);
  chapters[chapters.length - 1]!.push(...sentencesOf(b.narration));
}
const titles = script.beats.filter((b: any) => b.visual?.kind === "chapter").map((b: any) => b.visual.primary);
const loops = loopsOfScript(script);
const where = (e: number) => (e < 0 ? "cold open" : `ch ${e + 1} "${titles[e]}"`);
const sentence = (p: { entry: number; moment: number }) => (p.entry < 0 ? hook : chapters[p.entry]!)[p.moment];
say(`# ${script.headline} (${id})`);
say(script.open_loops ? "Open loops planted by the outline:" : "Open loops its own text makes (deriveOpenLoops; the script predates the outline's list):");
for (const [k, l] of loops.entries()) {
  say(`${k + 1}. Q: ${l.question}`);
  say(`   raised: ${where(l.plant.entry)}, sentence ${l.plant.moment + 1}`);
  say(`   answered: ${where(l.payoff.entry)}, sentence ${l.payoff.moment + 1}: "${sentence(l.payoff)}"`);
}
// Every line that raises something, and whether a later sentence answers it (so the list above can be judged).
say("");
say("Lines that raise a question, and the answer the rules found:");
const raisers: Array<{ entry: number; k: number; text: string }> = [
  ...hook.map((text, k) => ({ entry: -1, k, text })).filter((x) => /\?\s*$/.test(x.text) || /\b(story of (how|why)|(how|why) (it|they|he|she|a|an|the)\b)/i.test(x.text)),
  ...chapters.flatMap((c, e) => c.map((text, k) => ({ entry: e, k, text }))).filter((x) => /\?\s*$/.test(x.text)),
];
for (const r of raisers) {
  const hits = chapters
    .map((c, e) => ({ e, m: e >= Math.max(1, r.entry + 1) ? findPayoff(r.text, c) : -1 }))
    .filter((h) => h.m >= 0);
  say(`- ${where(r.entry)}: "${r.text}" -> ${hits.length ? hits.map((h) => `ch ${h.e + 1} s${h.m + 1}`).join(", ") : "no later sentence answers it in its own words"}`);
}
// The same loops as an outline would list them (a question mark on a cold open's promise), through the writer's rules.
const asOutline = loops.map((l) => ({
  question: /\?$/.test(l.question) ? l.question : `${l.question}?`,
  plant_chapter: l.plant.entry + 1,
  payoff_chapter: l.payoff.entry + 1,
}));
const grounded = groundOpenLoops(asOutline, chapters.length);
say("");
say(`Through the outline's rules (groundOpenLoops): ${grounded.loops.length} kept${grounded.removed.length ? `, removed: ${grounded.removed.join("; ")}` : ""}`);
say("What the writer would be told:");
const intro = loopBrief(grounded.loops, 0);
if (intro) say(`  cold open (bookends call):\n${intro.replace(/^/gm, "    ")}`);
for (let c = 1; c <= chapters.length; c++) {
  const brief = loopBrief(grounded.loops, c);
  if (!brief) continue;
  const problems = loopProblems(chapters[c - 1]!, grounded.loops, c);
  say(`  chapter ${c}:\n${brief.replace(/^/gm, "    ")}\n    check on the written chapter: ${problems.length ? problems.join(" ") : "plant and payoff found"}`);
}

// ---- the render's structure
const drop = S.titleDropWindow(segments, words, fps, breaks);
say("");
say(`Title drop: ${drop ? `${mmss(drop.from)} for ${(drop.len / fps).toFixed(1)} s, title lands at ${mmss(drop.from + drop.landAt)}${drop.breakSegment !== undefined ? " (fills the first chapter's breather)" : ""}` : "none"}`);
const starts = segments.map((s: any, i: number) => (i === 0 ? 0 : Math.round(s.start * fps)));
const marks = S.chapterMarks(segments, starts, Math.ceil(duration * fps), breaks);
say(`Chapter index: ${marks.map((m) => `${String(m.number).padStart(2, "0")} ${mmss(m.shownFrom)}${m.year ? ` (${m.year})` : ""}`).join(" | ")}`);
const cues = S.callbackCues(loops, segments, words, windows, fps);
say(`Callbacks: ${cues.length ? cues.map((c) => `${mmss(c.from)} recalls ${mmss(c.plantFrame)} "${c.text}"`).join("; ") : "none"}`);
const base = {
  segments,
  words,
  durationSeconds: duration,
  images: (assets.images ?? []).map((i: any) => ({ kind: i.kind, aspect: i.aspect ?? 1.6, beatIndex: i.beatIndex, moment: i.moment })),
  clips: (assets.clips ?? []).map((c: any) => ({ durationSeconds: c.durationSeconds, beatIndex: c.beatIndex, role: c.role, moment: c.moment })),
  variant: 0,
  momentCounts: moments.map((m: any[]) => m.length),
  momentKeys: moments.map((e: any[]) => e.map(momentKeys)),
};
const plain = buildLongPlan(base);
const tuned = buildLongPlan({ ...base, rhythm: true, bookend: true, coldOpenFrames: coldOpenTiming(fps).frames });
const cutsIn = (p: typeof plain, a: number, b: number) => p.shots.filter((s) => s.start >= a * fps && s.start < b * fps).length;
const bursts = S.burstWindows(plain.totalFrames, fps, marks.map((m) => m.from).slice(1));
say(`Cut rhythm, first 3 minutes: ${cutsIn(plain, 0, 180)} cuts without, ${cutsIn(tuned, 0, 180)} with (average shot ${(180 / cutsIn(plain, 0, 180)).toFixed(1)} s against ${(180 / cutsIn(tuned, 0, 180)).toFixed(1)} s)`);
say(`Bursts: ${bursts.map((b) => `${mmss(b.from)} (${cutsIn(plain, b.from / fps, b.to / fps)} cuts without, ${cutsIn(tuned, b.from / fps, b.to / fps)} with)`).join(", ")}`);
const last = tuned.shots.at(-1)!;
const first = tuned.shots.find((s) => s.end > coldOpenTiming(fps).frames)!;
say(`Bookend: the last shot (${mmss(last.start)}-${mmss(last.end)}) shows ${last.media.type} ${last.media.index} with "${last.move}"; the cold open's first picture is ${first.media.type} ${first.media.index} with "${first.move}"`);
fs.writeFileSync(path.join(out, "plan.txt"), `${lines.join("\n")}\n`, "utf8");

if (mode === "stills") {
  if (!epDir) throw new Error("stills needs the episode folder");
  const { selectComposition, renderStill } = await import("@remotion/renderer");
  const { getBundle, serveDir } = await import("../../src/render/render.ts");
  const srv = await serveDir(epDir);
  // A cut-down documentary: the real title, kicker, chapters, years and pictures, on a short synthetic timeline
  // (a 24 s cold open, a 4 s breather, then three 30 s chapters and a 12 s outro), so a still renders in seconds.
  const pic = (entry: number, n = 0) =>
    (assets.images ?? []).filter((i: any) => i.beatIndex === entry && (i.aspect ?? 1.6) >= 1.3 && i.kind !== "capsule")[n];
  const chapterBeats = script.beats.filter((b: any) => b.visual?.kind === "chapter").slice(0, 3);
  const segs: any[] = [{ kind: "hook", text: hook.slice(-4).join(" "), start: 0, end: 24 }];
  let t = 24;
  for (const [k, b] of chapterBeats.entries()) {
    const begin = k === 0 ? 28 : t;
    segs.push({ kind: "beat", text: chapters[k]!.slice(0, 4).join(" "), start: begin, end: begin + 30, visual: b.visual });
    t = begin + 30;
  }
  segs.push({ kind: "take", text: "Race'n'Chase was supposed to wrap by July 1, 1996.", start: t, end: t + 12, label: "THE LEGACY", visual: { kind: "title", primary: "", secondary: "" } });
  const images = [
    { ...pic(0, 0), beatIndex: undefined },
    ...[0, 1, 2].flatMap((e) => [pic(e, 0), pic(e, 1)].filter(Boolean)),
  ].map((i: any) => ({ src: `${srv.url}/${i.file.split(path.sep).join("/")}`, kind: i.kind, aspect: i.aspect ?? 1.6, beatIndex: i.beatIndex }));
  const sampleLoops = [{ question: "Why did a cop game end up as a crime game?", plant: { entry: -1, moment: 0 }, payoff: { entry: 2, moment: 1 } }];
  const props = {
    title: script.headline,
    kicker: script.kicker ?? "",
    criterion: "",
    theme: script.game_title,
    footageCredit: "",
    coldOpenLine: "On April 4, 1995, a small team at DMA Design in Dundee started work",
    segments: segs,
    words: [],
    images,
    clips: [],
    plan: null,
    logoSrc: "logo.png",
    audioSrc: null,
    musicSrc: null,
    breaks: [{ start: 24, end: 28 }],
    // Four plain sentences a chapter, so the composition times them (its moment windows) as a real one would.
    moments: [0, 1, 2].map(() =>
      Array.from({ length: 4 }, () => ({ show: "", graphic: { kind: "none", primary: "", secondary: "", items: [] }, emphasis: "" })),
    ),
    titleDrop: true,
    chapterIndex: true,
    loops: sampleLoops,
    cutRhythm: true,
    bookendEnding: true,
    durationSeconds: t + 12,
    variant: 0,
    renderDate: "2026-10-31",
  };
  const serveUrl = await getBundle();
  const composition = await selectComposition({ serveUrl, id: "PulseLong", inputProps: props });
  const frames: Array<[string, number]> = [
    ["title_drop_landing", Math.round(24.2 * fps)],
    ["title_drop_held", Math.round(26.5 * fps)],
    ["chapter_index_ch1", Math.round(40 * fps)],
    ["year_counter_rolling", Math.round(58 * fps) + 8],
    ["chapter_index_ch2_year", Math.round(66 * fps)],
  ];
  // The composition spreads each segment's words evenly when it has no voice (Long.tsx synthWords); so here.
  const synth = segs.flatMap((s: any) => {
    const ws = s.text.split(/\s+/).filter(Boolean);
    const step = (s.end - s.start) / Math.max(1, ws.length);
    return ws.map((w: string, i: number) => ({ text: w, start: s.start + i * step, end: s.start + (i + 0.85) * step }));
  });
  const cue = S.callbackCues(sampleLoops, segs, synth, momentWindows(segs, synth, [4, 4, 4]), fps)[0];
  if (cue) frames.push(["callback_cue", cue.from + 40]);
  for (const [name, f] of frames) {
    await renderStill({ composition, serveUrl, output: path.join(out, `${name}.png`), inputProps: props, frame: f, chromiumOptions: { gl: "angle" } });
    console.log("rendered", name, f);
  }
  await srv.close();
}

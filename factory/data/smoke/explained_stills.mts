// Stills of the explainer written by data/smoke/explained.mts (1 Nov 2026), on the real PulseLong composition with
// the documentary's craft. There is no voice (the stub writer's words are placeholders): word timings are spread at
// 150 words a minute, and the pictures are the picked story's own Short's checked media, copied into a scratch
// episode folder beforehand. Picks the cold open, the title drop, a chapter card, two evidence moments (a source
// passage and a recreated headline) and the close, renders them through one browser and tiles a contact sheet.
// Run it through the PC orchestrator. Nothing is written to any database.
// Usage: node --import tsx data/smoke/explained_stills.mts <explained_out.json> <db copy dir> <short id> <episode dir> <out dir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
const P = await import("../../src/pipeline.ts");
const { buildSegments } = await import("../../src/render/timeline.ts");
const L = await import("../../src/render/longplan.ts");
const { chooseFillers } = await import("../../src/assets/fillers.ts");
const { longCraft } = await import("../../src/longformat.ts");
const { CAMERA_TECHNIQUES } = await import("../../src/render/camera.ts");
const S = await import("../../src/render/structure.ts");
const { loopsOfScript } = await import("../../src/editorial/documentary.ts");
const { coldOpenTiming, coldOpenLine } = await import("../../src/render/bookends.ts");
const { renderLongStills } = await import("../../src/render/render.ts");
const { FFMPEG } = await import("../../src/lib/bin.ts");

const [jsonFile, dbDir, shortId, epDir, out] = process.argv.slice(2) as [string, string, string, string, string];
fs.mkdirSync(out, { recursive: true });
const { id, script } = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
const db = new PGlite(dbDir);
const [short] = (await db.query<any>(`SELECT assets_json FROM episodes WHERE id = $1`, [shortId])).rows;
await db.close();
const entries = (script.entries ?? []).length;
// The Short's stills and clips, spread over the four chapters (entry i is chapter i).
const images = (short.assets_json.images ?? []).flatMap((im: any, k: number) =>
  Array.from({ length: entries }, (_, e) => ({ ...im, beatIndex: (e + k) % entries })).slice(0, 2),
);
const clips = (short.assets_json.clips ?? []).map((c: any, k: number) => ({ ...c, beatIndex: k % entries }));
const DEFAULTS = {
  fillers: true,
  longCamera: [...CAMERA_TECHNIQUES],
  docTitleDrop: true,
  docChapterIndex: true,
  docOpenLoops: true,
  docCutRhythm: true,
  docBookendEnding: true,
  docColdOpen: true,
  docSoundBeats: true,
  releaseGate: true,
  longEntryPace: true,
};
const craft = longCraft(script, DEFAULTS);
// 150 words a minute, a two-second breath between segments.
const words: Array<{ text: string; start: number; end: number }> = [];
let t = 0.3;
for (const seg of P.segmentInputs(script)) {
  for (const w of String(seg.narration ?? "").split(/\s+/).filter(Boolean)) {
    words.push({ text: w, start: t, end: t + 0.36 });
    t += 0.4;
  }
  t += 2;
}
const duration = t + L.LONG_TAIL_SECONDS;
const segments = buildSegments(P.segmentInputs(script), words, duration);
const ranked = [...script.entries].sort((x: any, y: any) => y.rank - x.rank);
const moments: any[][] = ranked.map((e: any) => structuredClone(e.moments ?? []));
const chapters = ranked.map((e: any, i: number) => ({ entry: i, game: e.game_title, year: e.year, moments: moments[i]!, sentences: P.chapterSentences(script, i) }));
if (craft.fillers) {
  const ch = chooseFillers(chapters as never, { images, clips, seed: P.variantOf(id) });
  for (const p of ch.picks) moments[p.entry]![p.moment].filler = p.filler;
}
const variant = P.variantOf(id);
const plan = L.buildLongPlan({
  segments,
  words,
  durationSeconds: duration,
  images: images.map((i: any) => ({ kind: i.kind, aspect: i.aspect, beatIndex: i.beatIndex, moment: i.moment, file: i.file })),
  clips: clips.map((c: any) => ({ durationSeconds: c.durationSeconds, beatIndex: c.beatIndex, role: c.role, moment: c.moment })),
  variant,
  realPinnedOnly: true,
  momentCounts: moments.map((m) => m.length),
  momentKeys: moments.map((e) => e.map(L.momentKeys)),
  momentFillers: moments.map((e) => e.map((m: any) => m.filler)),
  momentShows: moments.map((e, i) => {
    const said = P.chapterSentences(script, i);
    return e.map((m: any, k: number) => `${said[k] ?? ""} ${m.show} ${m.person ?? ""} ${m.keywords?.join(" ") ?? ""}`);
  }),
  takeEntry: script.take_entry,
  rhythm: craft.rhythm,
  entryPace: craft.entryPace,
  bookend: craft.bookend,
  coldOpenFrames: craft.coldOpen ? coldOpenTiming(L.LONG_FPS).frames : 0,
});
const fps = plan.fps;
const props: any = {
  title: script.headline,
  kicker: script.kicker ?? "",
  criterion: "",
  spoilers: false,
  recap: false,
  theme: script.game_title,
  footageCredit: clips.length ? "FOOTAGE: OFFICIAL TRAILERS · STEAM" : "",
  endLine: "The biggest gaming story, explained · Shorts every day",
  moments: moments.map((ms) =>
    ms.map((m: any) => ({ show: m.show, graphic: m.graphic, emphasis: m.emphasis, person: m.person || undefined, beat: craft.soundBeats ? m.beat : undefined, filler: m.filler })),
  ),
  segments,
  words,
  durationSeconds: duration,
  coldOpenLine: craft.coldOpen ? coldOpenLine(script.hook) : undefined,
  titleDrop: craft.titleDrop,
  chapterIndex: craft.chapterIndex,
  loops: craft.loops === "off" ? undefined : craft.loops === "placed" ? script.open_loops : loopsOfScript(script),
  cutRhythm: craft.rhythm,
  entryPace: craft.entryPace,
  bookendEnding: craft.bookend,
  variant,
  audioFile: null,
  musicFile: null,
  imageFiles: images.map((i: any) => ({ file: i.file, kind: i.kind, aspect: i.aspect, beatIndex: i.beatIndex, credit: P.photoCredit(i), moment: i.moment, label: i.label, layers: i.layers })),
  clipFiles: clips.map((c: any) => ({ file: c.file, durationSeconds: c.durationSeconds, beatIndex: c.beatIndex, role: c.role, moment: c.moment, credit: c.credit, audio: c.audio, label: c.label })),
  plan,
  renderDate: "2026-11-01",
  camera: craft.camera,
  eraBeds: craft.eraBeds,
  sketchAnimation: true,
  photoTreatments: true,
};
// The frames that show each device.
const starts = segments.map((sg: any, i: number) => (i === 0 ? 0 : Math.round(sg.start * fps)));
const drop = S.titleDropWindow(segments, words, fps, []);
const marks = S.chapterMarks(segments, starts, plan.totalFrames, []);
const picks: Array<[string, number]> = [["cold_open", Math.round(1.6 * fps)]];
if (drop) picks.push(["title_drop", drop.from + drop.landAt + 24]);
const card = marks[1] ?? marks[0];
if (card) picks.push([`chapter_${card.number}`, card.shownFrom + Math.round(1.2 * fps)]);
// The evidence moments: the frame halfway through the sentence that carries a source passage or a headline.
const sentenceFrames: Array<{ kind: string; frame: number }> = [];
const beatSegs = segments.filter((sg: any) => sg.kind === "beat");
let chapter = -1;
let k = 0;
for (const sg of beatSegs) {
  if (sg.visual?.kind === "chapter") {
    chapter++;
    k = 0;
  }
  const said = String(sg.narration ?? "").split(/(?<=[.!?])\s+/).filter(Boolean);
  let at = sg.start;
  for (const sentence of said) {
    const n = sentence.split(/\s+/).length;
    const m = moments[chapter]?.[k];
    if (m && m.graphic?.kind !== "none") sentenceFrames.push({ kind: m.graphic.kind, frame: Math.round((at + n * 0.2) * fps) });
    at += n * 0.4;
    k++;
  }
}
for (const kind of ["source", "headline"]) {
  const f = sentenceFrames.find((x) => x.kind === kind);
  if (f) picks.push([`evidence_${kind}`, f.frame]);
}
picks.push(["close", plan.totalFrames - Math.round(2.5 * fps)]);
const stills = picks.slice(0, 6).map(([name, frame]) => ({ frame, file: path.join(out, `${id}_${name}_${frame}.jpg`) }));
await renderLongStills({ episodeDir: epDir, props, stills, scale: 960 / 1920, gl: "angle" });
const notes = stills.map((s, i) => `${path.basename(s.file)}  frame ${s.frame} (${(s.frame / fps).toFixed(1)} s)  ${picks[i]![0]}`);
fs.writeFileSync(path.join(out, "stills.txt"), notes.join("\n") + "\n");
const files = stills.map((s) => s.file);
const inputs = files.flatMap((f) => ["-i", f]);
const filter =
  files.map((_, i) => `[${i}:v]scale=960:540[v${i}]`).join(";") +
  `;${files.map((_, i) => `[v${i}]`).join("")}xstack=inputs=${files.length}:layout=${files.map((_, i) => `${(i % 2) * 960}_${Math.floor(i / 2) * 540}`).join("|")}:fill=black[out]`;
execFileSync(FFMPEG, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filter, "-map", "[out]", "-frames:v", "1", path.join(out, "contact_sheet.jpg")]);
console.log(notes.join("\n"));
console.log(`plan: ${plan.shots.length} shots over ${(plan.totalFrames / fps / 60).toFixed(1)} min; contact sheet: ${path.join(out, "contact_sheet.jpg")}`);

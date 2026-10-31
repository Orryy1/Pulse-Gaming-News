// 31 Oct 2026: stills of the real PulseLong composition for long formats other than the documentary, with the
// craft they now get (src/longformat.ts): the plan made afresh as the render step would (fillers chosen
// offline, no reconstructions), the props as stepRenderLong builds them, the media served read only from the
// episode's own folder. Picks frames that show each device (cold open, title drop, chapter index and counter,
// a burst inside an entry, a filler, the bookend), renders them through one browser and tiles a contact sheet.
// Run it through the PC orchestrator. Nothing is written to the database or the episode folder.
// Usage: node --import tsx data/smoke/allong_stills.mts <db copy dir> <out dir> <episodes dir> <id>[:name,name]...
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

const [dbDir, out, episodes, ...wanted] = process.argv.slice(2) as [string, string, string, ...string[]];
fs.mkdirSync(out, { recursive: true });
const db = new PGlite(dbDir);
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
const files: string[] = [];
const notes: string[] = [];
for (const want of wanted) {
  const [id, n] = want.split(":") as [string, string?];
  const [ep] = (await db.query<any>(`SELECT script_json, assets_json FROM episodes WHERE id = $1`, [id])).rows;
  const script = ep.script_json;
  const a = ep.assets_json;
  const craft = longCraft(script, DEFAULTS);
  const words = a.words ?? [];
  const duration = (a.durationSeconds ?? 300) + L.LONG_TAIL_SECONDS;
  const segments = L.openChaptersAtBreaks(buildSegments(P.segmentInputs(script, Boolean(a.desk)), words, duration), a.breaks);
  const ranked = [...(script.entries ?? [])].sort((x: any, y: any) => y.rank - x.rank);
  const moments: any[][] = ranked.map((e: any) => structuredClone(e.moments ?? []));
  const chapters = ranked.map((e: any, i: number) => ({ entry: i, game: e.game_title, year: e.year, moments: moments[i]!, sentences: P.chapterSentences(script, i) }));
  if (craft.fillers) {
    for (const m of moments.flat()) delete m.filler;
    const ch = chooseFillers(chapters as never, { images: a.images, clips: a.clips ?? [], seed: P.variantOf(id) });
    for (const p of ch.picks) moments[p.entry]![p.moment].filler = p.filler;
  }
  const variant = P.variantOf(id);
  const plan = L.buildLongPlan({
    segments,
    words,
    durationSeconds: duration,
    images: a.images.map((i: any) => ({ kind: i.kind, aspect: i.aspect, beatIndex: i.beatIndex, moment: i.moment, file: i.file })),
    clips: (a.clips ?? []).map((c: any) => ({ durationSeconds: c.durationSeconds, beatIndex: c.beatIndex, role: c.role, moment: c.moment })),
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
  const doc = script.evergreen_format === "documentary";
  const props: any = {
    title: script.headline,
    kicker: script.kicker ?? "",
    criterion: script.criterion ?? "",
    spoilers: P.scopeOf(script) === "campaign",
    recap: !!script.recap,
    theme: script.recap ? script.headline : script.game_title,
    footageCredit: a.clips?.length ? "FOOTAGE: OFFICIAL TRAILERS · STEAM" : "",
    endLine: script.recap
      ? "The week's biggest stories every Friday · Shorts every day"
      : doc
        ? "A new documentary every month · Shorts every day"
        : "A new ranking every week · Shorts every day",
    moments: moments.map((ms, ei) =>
      ms.map((m: any, mi: number) => ({
        show: m.show,
        graphic: (a.quietMoments ?? []).includes(`${ei}:${mi}`) ? { kind: "none", primary: "", secondary: "", items: [] } : m.graphic,
        emphasis: m.emphasis,
        person: m.person || undefined,
        beat: craft.soundBeats ? m.beat : undefined,
        filler: m.filler,
      })),
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
    imageFiles: a.images.map((i: any) => ({ file: i.file, kind: i.kind, aspect: i.aspect, beatIndex: i.beatIndex, credit: P.photoCredit(i), moment: i.moment, label: i.label, layers: i.layers })),
    clipFiles: (a.clips ?? []).map((c: any) => ({ file: c.file, durationSeconds: c.durationSeconds, beatIndex: c.beatIndex, role: c.role, moment: c.moment, credit: c.credit, audio: c.audio, label: c.label })),
    plan,
    renderDate: "2026-10-31",
    breaks: a.breaks,
    quietBreaks: a.quietBreaks,
    palette: a.palette,
    annotations: [...(a.annotations ?? []), ...(a.textDetails ?? [])],
    camera: craft.camera,
    eraBeds: craft.eraBeds,
    sketchAnimation: true,
    photoTreatments: true,
  };
  // The frames that show each device.
  const starts = segments.map((s: any, i: number) => (i === 0 ? 0 : Math.round(s.start * fps)));
  const breakFrames = (a.breaks ?? []).map((b: any) => ({ from: Math.round(b.start * fps), to: Math.round(b.end * fps) }));
  const drop = S.titleDropWindow(segments, words, fps, breakFrames);
  const marks = S.chapterMarks(segments, starts, plan.totalFrames, breakFrames);
  const bursts = S.rhythmBursts(segments, plan.totalFrames, fps, craft.entryPace).all;
  const fillerShots = plan.shots.filter((s: any) => s.media.type === "filler");
  const picks: Array<[string, number]> = [];
  picks.push(["cold_open", Math.round(1.6 * fps)]);
  if (drop) picks.push(["title_drop", drop.from + drop.landAt + 24]);
  const mid = marks[Math.floor(marks.length / 2)];
  if (mid) picks.push([`index_${mid.number}`, mid.shownFrom + 8 * fps]);
  const late = bursts.filter((b: any) => b.from > 200 * fps)[0];
  if (late) picks.push(["burst", late.from + Math.round(fps * 3)]);
  for (const f of fillerShots.slice(0, 2)) picks.push([`filler_${moments[f.media.entry]?.[f.media.index]?.filler?.family ?? "x"}`, Math.round((f.start + f.end) / 2)]);
  picks.push(["bookend", plan.totalFrames - Math.round(2.5 * fps)]);
  // id:name,name picks devices by name prefix (cold_open, title_drop, index, burst, filler, bookend).
  const names = n ? n.split(",") : undefined;
  const chosen = names
    ? names.flatMap((nm) => { const k = picks.findIndex((p) => p[0].startsWith(nm)); return k >= 0 ? picks.splice(k, 1) : []; })
    : picks;
  const stills = chosen.map(([name, frame]) => ({ frame, file: path.join(out, `${id}_${name}.jpg`) }));
  await renderLongStills({ episodeDir: path.join(episodes, id), props, stills, scale: 960 / 1920, gl: "angle" });
  for (const [k, s] of stills.entries()) {
    files.push(s.file);
    notes.push(`${path.basename(s.file)}  frame ${s.frame} (${(s.frame / fps).toFixed(1)} s)  ${chosen[k]![0]}`);
  }
}
await db.close();
fs.writeFileSync(path.join(out, "stills.txt"), notes.join("\n") + "\n");
// The contact sheet: two columns in the order of stills.txt.
const inputs = files.flatMap((f) => ["-i", f]);
const cols = 2;
const rows = Math.ceil(files.length / cols);
const filter =
  files.map((_, i) => `[${i}:v]scale=960:540[v${i}]`).join(";") +
  `;${files.map((_, i) => `[v${i}]`).join("")}xstack=inputs=${files.length}:layout=${files.map((_, i) => `${(i % cols) * 960}_${Math.floor(i / cols) * 540}`).join("|")}:fill=black[out]`;
execFileSync(FFMPEG, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filter, "-map", "[out]", "-frames:v", "1", path.join(out, "contact_sheet.jpg")]);
console.log(notes.join("\n"));
console.log(`contact sheet: ${path.join(out, "contact_sheet.jpg")} (${rows} rows)`);

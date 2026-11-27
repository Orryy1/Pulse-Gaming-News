// 31 Oct 2026: before and after the long-video craft reached every long format (src/longformat.ts). For one
// long episode on a COPY of the database it builds the plan twice, offline and with no model call: "before"
// with the gates as they were (every device only for evergreen_format "documentary"), "after" with
// longCraft and the settings' defaults. For each it prints the share of narrated time on generic pool
// footage, the filler visuals chosen per family (no reconstructions: their clip check reads the media), the
// camera moves (planned from the plan's own shots; the render also keeps moves off shots another treatment
// dresses, so it makes a few fewer) and the structure devices placed. Writes <out>/<id>.json.
// Usage: node --import tsx data/smoke/allong_audit.mts <db copy dir> <out dir> <episode id>...
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
const { segmentInputs, variantOf, chapterSentences } = await import("../../src/pipeline.ts");
const { buildSegments } = await import("../../src/render/timeline.ts");
const { openChaptersAtBreaks, momentWindows, momentKeys, LONG_TAIL_SECONDS, LONG_FPS, buildLongPlan, entryOf } = await import("../../src/render/longplan.ts");
const { chooseFillers } = await import("../../src/assets/fillers.ts");
const { longCraft } = await import("../../src/longformat.ts");
const { CAMERA_TECHNIQUES, cameraInputs, planCamera } = await import("../../src/render/camera.ts");
const { structureSummary } = await import("../../src/render/structure.ts");
const { loopsOfScript } = await import("../../src/editorial/documentary.ts");
const { coldOpenTiming } = await import("../../src/render/bookends.ts");
const { beatCuesFrom } = await import("../../src/render/musicplan.ts");

const [dbDir, out, ...ids] = process.argv.slice(2) as [string, string, ...string[]];
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
fs.mkdirSync(out, { recursive: true });
for (const id of ids) {
  const [ep] = (await db.query<any>(`SELECT script_json, assets_json FROM episodes WHERE id = $1`, [id])).rows;
  const script = ep.script_json;
  const a = ep.assets_json;
  const words = a.words ?? [];
  const duration = (a.durationSeconds ?? 300) + LONG_TAIL_SECONDS;
  const segments = openChaptersAtBreaks(buildSegments(segmentInputs(script, Boolean(a.desk)), words, duration), a.breaks);
  const ranked = [...(script.entries ?? [])].sort((x: any, y: any) => y.rank - x.rank);
  const variant = variantOf(id);
  const isDoc = script.evergreen_format === "documentary";
  const after = longCraft(script, DEFAULTS);
  // "before": the old gates, the same settings.
  const before = {
    fillers: isDoc,
    camera: isDoc ? [...CAMERA_TECHNIQUES] : [],
    titleDrop: isDoc,
    chapterIndex: isDoc,
    loops: isDoc ? "derive" : "off",
    rhythm: isDoc,
    entryPace: false,
    bookend: isDoc,
    coldOpen: isDoc,
    soundBeats: isDoc,
  };
  const report: any = { id, headline: script.headline, format: after.format };
  for (const [name, c] of [["before", before], ["after", after]] as const) {
    // A fresh copy of the shot list each time: the filler pass writes on it.
    const moments: any[][] = ranked.map((e: any) => structuredClone(e.moments ?? []).map((m: any) => ({ ...m, filler: undefined })));
    const chapters = ranked.map((e: any, i: number) => ({
      entry: i,
      game: e.game_title,
      year: e.year,
      moments: moments[i]!,
      // The old chapterSentences gave a ranking nothing; the new one gives its entries' sentences.
      sentences: name === "before" && !isDoc ? [] : chapterSentences(script, i),
    }));
    let fillers: any = { picks: [], counts: {}, eligible: { bare: 0, stock: 0 } };
    if (c.fillers) {
      fillers = chooseFillers(chapters as never, { images: a.images, clips: a.clips ?? [], seed: variant });
      for (const p of fillers.picks) moments[p.entry]![p.moment].filler = p.filler;
    }
    const plan = buildLongPlan({
      segments,
      words,
      durationSeconds: duration,
      images: a.images.map((i: any) => ({ kind: i.kind, aspect: i.aspect, beatIndex: i.beatIndex, moment: i.moment, file: i.file })),
      clips: (a.clips ?? []).map((x: any) => ({ durationSeconds: x.durationSeconds, beatIndex: x.beatIndex, role: x.role, moment: x.moment })),
      variant,
      realPinnedOnly: true,
      momentCounts: moments.map((m) => m.length),
      momentKeys: moments.map((e) => e.map(momentKeys)),
      momentFillers: moments.map((e) => e.map((m: any) => m.filler)),
      momentShows: moments.map((e, i) => {
        const said = chapterSentences(script, i);
        return e.map((m: any, k: number) => `${said[k] ?? ""} ${m.show} ${m.person ?? ""} ${m.keywords?.join(" ") ?? ""}`);
      }),
      takeEntry: script.take_entry,
      rhythm: c.rhythm,
      entryPace: c.entryPace,
      bookend: c.bookend,
      coldOpenFrames: c.coldOpen ? coldOpenTiming(LONG_FPS).frames : 0,
    });
    const windows = momentWindows(segments, words, moments.map((m) => m.length), moments.map((e) => e.map(momentKeys)));
    // Screen time: a shot on media pinned to no sentence while a sentence without a graphic is spoken is "pool".
    const fps = plan.fps;
    let narrated = 0, pool = 0, filler = 0;
    for (const s of plan.shots) {
      const t0 = s.start / fps, t1 = s.end / fps;
      const sp = windows
        .map((w: any) => ({ w, o: Math.max(0, Math.min(t1, w.end) - Math.max(t0, w.start)) }))
        .filter((x: any) => x.o > 0.05)
        .sort((x: any, y: any) => y.o - x.o)[0]?.w;
      if (!sp) continue;
      narrated += t1 - t0;
      if (s.media.type === "filler") { filler += t1 - t0; continue; }
      const m = s.media.type === "clip" ? a.clips[s.media.index] : s.media.type === "image" ? a.images[s.media.index] : undefined;
      const g = moments[sp.entry]?.[sp.moment]?.graphic?.kind;
      if (m && m.moment === undefined && (!g || g === "none")) pool += t1 - t0;
    }
    // The camera, from the plan's shots (no dressing known offline).
    const entryFrames = segments.map((sg: any, i: number) => (i > 0 && sg.kind === "beat" && (sg.visual?.kind === "chapter" || sg.visual?.kind === "rank") ? Math.round(sg.start * fps) : -1)).filter((f: number) => f > 0);
    const breakFrames = (a.breaks ?? []).map((b: any) => ({ from: Math.round(b.start * fps), to: Math.round(b.end * fps) }));
    let camera: any = { moves: 0, byKind: {} };
    if (c.camera.length) {
      const input = cameraInputs({
        shots: plan.shots,
        images: a.images,
        clips: a.clips ?? [],
        chapterOf: (seg: number) => entryOf(segments, seg) ?? -1,
        fps,
        enabled: c.camera,
        variant,
        quiet: [
          { from: 0, to: 12 * fps },
          { from: plan.totalFrames - 20 * fps, to: plan.totalFrames },
          ...entryFrames.map((f: number) => ({ from: f - 30, to: f + 3 * fps })),
          ...breakFrames.map((b: any) => ({ from: b.from - 20, to: b.to + 30 })),
        ],
        explainers: [],
        beats: c.soundBeats ? beatCuesFrom(windows, moments, fps, breakFrames) : [],
        windows,
        moments,
        words,
        details: [],
      });
      const cp = planCamera(input);
      const byKind: Record<string, number> = {};
      for (const e of cp.events) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
      camera = { moves: cp.events.length, byKind, lens: cp.lens, boil: cp.boil };
    }
    const loops = c.loops === "off" ? undefined : c.loops === "placed" ? script.open_loops : loopsOfScript(script);
    const structure = structureSummary({
      segments,
      words,
      windows,
      fps,
      breaks: breakFrames,
      loops,
      plan,
      on: { titleDrop: c.titleDrop, chapterIndex: c.chapterIndex, loops: c.loops !== "off", rhythm: c.rhythm, bookend: c.bookend, entryPace: c.entryPace },
    });
    const emptySentences = chapters.filter((ch) => !ch.sentences.length && ch.moments.length).length;
    report[name] = {
      shots: plan.shots.length,
      narratedSeconds: Math.round(narrated),
      poolShare: Math.round((1000 * pool) / Math.max(1, narrated)) / 10,
      fillerShare: Math.round((1000 * filler) / Math.max(1, narrated)) / 10,
      fillers: { chosen: fillers.picks.length, eligible: fillers.eligible, counts: fillers.counts },
      camera,
      structure,
      coldOpen: c.coldOpen,
      soundBeats: (c.soundBeats ? moments.flat().filter((m: any) => m.beat && m.beat !== "none").length : 0),
      chaptersWithoutSentences: emptySentences,
    };
  }
  fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
}
await db.close();

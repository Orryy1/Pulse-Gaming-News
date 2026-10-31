// 31 Oct 2026: the footage-first gather (src/assets/footagefirst.ts) proved on a COPY of the database, offline
// from the factory. For the chosen chapters of one long video it searches, refuses junk, downloads, cuts and
// looks at real Creative Commons gameplay into a scratch folder, then makes the plan again with the new clips
// (as the render step would, noRepeats on) and prints the footage share before and after, per chapter.
// Nothing is written to the database or the live episode folder (read only, for the existing media).
// Run it through the PC orchestrator (it downloads and uses the GPU): orch run --class gpu ... -- node ...
//
// Usage (from the factory folder):
//   node --import tsx data/smoke/footage_first.mts gather <db copy dir> <out dir> <episode id> <entries, e.g. 2,3> [--all-chapters-before]
//   node --import tsx data/smoke/footage_first.mts stills <db copy dir> <out dir> <live episodes dir> <episode id>
// gather writes <out>/ep/entry_N/assets/ff_*.mp4, <out>/rejects/*.jpg, <out>/added.json and <out>/report.json.
// stills renders 12 frames of the new plan's footage shots (a scratch episode folder of read-only links to the
// live media plus the new clips) and tiles <out>/stills_sheet.jpg.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
const P = await import("../../src/pipeline.ts");
const L = await import("../../src/render/longplan.ts");
const { buildSegments } = await import("../../src/render/timeline.ts");
const F = await import("../../src/assets/footagefirst.ts");
const { footageFirstDeps } = await import("../../src/assets/footagedeps.ts");
const { measureFootage, chapterSeconds } =
  await import("../../src/assets/footagestep.ts");

const [mode, dbDir, out, ...rest] = process.argv.slice(2) as [
  string,
  string,
  string,
  ...string[],
];
fs.mkdirSync(out, { recursive: true });
const db = new PGlite(dbDir);
const id = mode === "gather" ? rest[0]! : rest[1]!;
const [ep] = (
  await db.query<any>(
    `SELECT script_json, assets_json FROM episodes WHERE id = $1`,
    [id],
  )
).rows;
await db.close();
const script = ep.script_json;
const a = ep.assets_json;
const words = a.words ?? [];
const duration = (a.durationSeconds ?? 300) + L.LONG_TAIL_SECONDS;
const segments = L.openChaptersAtBreaks(
  buildSegments(P.segmentInputs(script, Boolean(a.desk)), words, duration),
  a.breaks,
);
const ranked = [...(script.entries ?? [])].sort(
  (x: any, y: any) => y.rank - x.rank,
);
const moments: any[][] = ranked.map((e: any) => e.moments ?? []);
const games = ranked.map((e: any) => e.game_title);

/** The plan as the render step makes it, with these clips. */
function plan(clips: any[], noRepeats: boolean) {
  return L.buildLongPlan({
    segments,
    words,
    durationSeconds: duration,
    images: a.images.map((i: any) => ({
      kind: i.kind,
      aspect: i.aspect,
      beatIndex: i.beatIndex,
      moment: i.moment,
      file: i.file,
    })),
    clips: clips.map((c: any) => ({
      durationSeconds: c.durationSeconds,
      beatIndex: c.beatIndex,
      role: c.role,
      moment: c.moment,
      span: c.span,
    })),
    noRepeats,
    variant: P.variantOf(id),
    realPinnedOnly: true,
    momentCounts: moments.map((m) => m.length),
    momentKeys: moments.map((e) => e.map(L.momentKeys)),
    momentFillers: moments.map((e, ei) =>
      e.map((m: any, mi: number) =>
        (a.quietMoments ?? []).includes(`${ei}:${mi}`) ? undefined : m.filler,
      ),
    ),
    momentShows: moments.map((e, i) => {
      const said = P.chapterSentences(script, i);
      return e.map(
        (m: any, k: number) =>
          `${said[k] ?? ""} ${m.show} ${m.person ?? ""} ${m.keywords?.join(" ") ?? ""}`,
      );
    }),
    takeEntry: script.take_entry,
    rhythm: true,
    entryPace: false,
    bookend: true,
    coldOpenFrames: 0,
  });
}
const measure = (p: any, clips: any[]) =>
  measureFootage({
    shots: p.shots,
    fps: p.fps,
    segments,
    entryOf: (i: number) => L.entryOf(segments, i, script.take_entry),
    clips,
  });
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const show = (
  label: string,
  m: ReturnType<typeof measure>,
  only?: number[],
) => {
  console.log(
    `${label}: whole video ${pct(m.share)} footage (stock ${pct(m.stock / m.seconds)})`,
  );
  for (const [c, s] of [...m.perChapter].sort((x, y) => x[0] - y[0]))
    if (!only || only.includes(c))
      console.log(`  chapter ${c} ${games[c]}: ${pct(s)}`);
};

if (mode === "gather") {
  const entries = rest[1]!.split(",").map(Number);
  const stored = a.longPlan;
  const before = plan(a.clips, false);
  if (stored)
    show(
      "BEFORE (the stored plan, as rendered)",
      measure(stored, a.clips),
      entries,
    );
  show(
    "BEFORE (replanned, today's planner, no new clips)",
    measure(before, a.clips),
    entries,
  );
  const deps = footageFirstDeps({
    ytdlp: process.env.YTDLP_PATH || "yt-dlp",
    lease: false,
  });
  const t0 = Date.now();
  const chapters = entries.map((e) => ({
    entry: e,
    game: ranked[e].game_title,
    franchise: script.game_title || ranked[e].game_title,
    year: ranked[e].year,
    moments: moments[e]!,
    sentences: P.chapterSentences(script, e),
    seconds: chapterSeconds(P.chapterSentences(script, e)),
  }));
  const r = await F.gatherFootageFirst(
    deps,
    chapters,
    a.clips,
    path.join(out, "ep"),
    { ...F.FOOTAGE_FIRST_DEFAULTS, maxMinutes: Number(process.argv.find((x) => x.startsWith("--max="))?.split("=")[1] ?? 0) },
    path.join(out, "rejects"),
  );
  const clips = [...a.clips, ...r.clips];
  const after = plan(clips, true);
  show(
    "AFTER (with the footage-first clips, noRepeats)",
    measure(after, clips),
    entries,
  );
  fs.writeFileSync(
    path.join(out, "added.json"),
    JSON.stringify(r.clips, null, 1),
  );
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        minutes: (Date.now() - t0) / 60000,
        report: r.report,
        before: Object.fromEntries(measure(before, a.clips).perChapter),
        stored: stored
          ? Object.fromEntries(measure(stored, a.clips).perChapter)
          : undefined,
        after: Object.fromEntries(measure(after, clips).perChapter),
        share: {
          stored: stored ? measure(stored, a.clips).share : undefined,
          before: measure(before, a.clips).share,
          after: measure(after, clips).share,
        },
      },
      null,
      1,
    ),
  );
  const rep = r.report;
  console.log(
    `searches ${rep.searches}, videos seen ${rep.sourcesSeen}, refused ${rep.sourcesRejected.length}, downloaded ${rep.downloads} (${rep.downloadedMb} MB), segments ${rep.segments}, looked at ${rep.looked}, refused ${rep.segmentsRejected.length}, kept ${rep.kept} (${rep.keptSeconds} s, ${rep.keptMb} MB, ${rep.pinned} pinned), model calls ${rep.modelCalls}, ${rep.minutes} min`,
  );
  const why = (xs: Array<{ why: string }>) =>
    Object.entries(
      xs.reduce(
        (m: Record<string, number>, x) => ((m[x.why] = (m[x.why] ?? 0) + 1), m),
        {},
      ),
    );
  console.log("videos refused:", why(rep.sourcesRejected));
  for (const s of rep.sourcesRejected)
    console.log(`  [${s.why}] ${s.title} (${s.channel})`);
  console.log("segments refused:", why(rep.segmentsRejected));
  console.log("skipped chapters:", rep.skipped);
  console.log("per chapter:", JSON.stringify(rep.perChapter), rep.stoppedEarly ?? "");
} else if (mode === "stills") {
  const live = rest[0]!;
  const added: any[] = JSON.parse(
    fs.readFileSync(path.join(out, "added.json"), "utf8"),
  );
  const clips = [...a.clips, ...added];
  const p = plan(clips, true);
  // A scratch episode folder: read-only links to the live media, the new clips beside them.
  const ep = path.join(out, "ep");
  const link = (from: string, to: string) => {
    if (fs.existsSync(to)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    execFileSync("cmd", [
      "/c",
      "mklink",
      "/J",
      to.replace(/\//g, "\\"),
      from.replace(/\//g, "\\"),
    ]);
  };
  const src = path.join(live, id);
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    if (!fs.statSync(from).isDirectory()) continue;
    if (!name.startsWith("entry_")) link(from, path.join(ep, name));
    else
      for (const sub of fs.readdirSync(from)) {
        const f2 = path.join(from, sub);
        if (!fs.statSync(f2).isDirectory()) continue;
        // The entry's assets folder is shared with the new clips: link each live file's folder, copy nothing.
        if (sub === "assets" && fs.existsSync(path.join(ep, name, "assets"))) {
          for (const file of fs.readdirSync(f2)) {
            const t = path.join(ep, name, "assets", file);
            if (!fs.existsSync(t)) fs.linkSync(path.join(f2, file), t);
          }
        } else link(f2, path.join(ep, name, sub));
      }
  }
  // Twelve frames: the middle of new footage shots across the two chapters, in time order.
  const fresh = new Set(added.map((c) => c.file));
  const shots = p.shots.filter(
    (s: any) => s.media.type === "clip" && fresh.has(clips[s.media.index].file),
  );
  const pick = F.spread(shots, 12);
  const { renderLongStills } = await import("../../src/render/render.ts");
  const { longCraft } = await import("../../src/longformat.ts");
  const { CAMERA_TECHNIQUES } = await import("../../src/render/camera.ts");
  const { loopsOfScript } = await import("../../src/editorial/documentary.ts");
  const craft = longCraft(script, {
    fillers: true,
    longCamera: [...CAMERA_TECHNIQUES],
    docTitleDrop: true,
    docChapterIndex: true,
    docOpenLoops: true,
    docCutRhythm: true,
    docBookendEnding: true,
    docColdOpen: false,
    docSoundBeats: true,
    releaseGate: true,
    longEntryPace: true,
  } as never);
  const props: any = {
    title: script.headline,
    kicker: script.kicker ?? "",
    criterion: script.criterion ?? "",
    spoilers: P.scopeOf(script) === "campaign",
    recap: false,
    theme: script.game_title,
    footageCredit: "FOOTAGE: OFFICIAL TRAILERS · STEAM",
    endLine: "A new documentary every month · Shorts every day",
    moments: moments.map((ms, ei) =>
      ms.map((m: any, mi: number) => ({
        show: m.show,
        graphic: (a.quietMoments ?? []).includes(`${ei}:${mi}`)
          ? { kind: "none", primary: "", secondary: "", items: [] }
          : m.graphic,
        emphasis: m.emphasis,
        person: m.person || undefined,
        beat: m.beat,
        filler: (a.quietMoments ?? []).includes(`${ei}:${mi}`)
          ? undefined
          : m.filler,
      })),
    ),
    segments,
    words,
    durationSeconds: duration,
    titleDrop: craft.titleDrop,
    chapterIndex: craft.chapterIndex,
    loops:
      craft.loops === "off"
        ? undefined
        : craft.loops === "placed"
          ? script.open_loops
          : loopsOfScript(script),
    cutRhythm: true,
    entryPace: false,
    bookendEnding: true,
    variant: P.variantOf(id),
    audioFile: null,
    musicFile: null,
    imageFiles: a.images.map((i: any) => ({
      file: i.file,
      kind: i.kind,
      aspect: i.aspect,
      beatIndex: i.beatIndex,
      credit: P.photoCredit(i),
      moment: i.moment,
      label: i.label,
      layers: i.layers,
    })),
    clipFiles: clips.map((c: any) => ({
      file: c.file,
      durationSeconds: c.durationSeconds,
      beatIndex: c.beatIndex,
      role: c.role,
      moment: c.moment,
      credit: c.credit,
      audio: c.audio,
      label: c.label,
    })),
    plan: p,
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
  const stills = pick.map((s: any) => {
    const frame = Math.round((s.start + s.end) / 2);
    return {
      frame,
      file: path.join(out, "stills", `still_${frame}.jpg`),
      clip: clips[s.media.index],
    };
  });
  await renderLongStills({
    episodeDir: ep,
    props,
    stills,
    scale: 960 / 1920,
    gl: "angle",
  });
  const said = (t0: number, t1: number) =>
    words
      .filter((w: any) => w.end > t0 && w.start < t1)
      .map((w: any) => w.text)
      .join(" ");
  const notes = stills.map((s: any) => {
    const t = s.frame / p.fps;
    return `${path.basename(s.file)}  ${t.toFixed(1)} s  chapter ${s.clip.beatIndex} ${s.clip.moment === undefined ? "loose" : `pinned to sentence ${s.clip.moment}`}  [${s.clip.label}]  ${s.clip.credit}  says: "${said(t - 2, t + 2).slice(0, 120)}"`;
  });
  fs.writeFileSync(path.join(out, "stills.txt"), notes.join("\n") + "\n");
  console.log(notes.join("\n"));
}

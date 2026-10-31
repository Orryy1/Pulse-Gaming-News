// 31 Oct 2026: proof runner for the filler integration (src/assets/fillers.ts, src/render/fillerplan.ts): reads a
// documentary from a database COPY, chooses its fillers as the render step would (reconstructions frame-checked
// read only from the episode's media folder), plans it with them, and renders stills of the real PulseLong
// composition at each picked filler shot's settle frame, then a contact sheet. Nothing is written to the copy.
// Run it through the PC orchestrator (it opens a headless browser):
//   node --import tsx data/smoke/integrate.mts <db copy dir> <episode id> <episode media dir> <out dir> [--max N]
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
const { segmentInputs, variantOf, chapterSentences, photoCredit } = await import("../../src/pipeline.ts");
const { buildSegments } = await import("../../src/render/timeline.ts");
const { openChaptersAtBreaks, buildLongPlan, momentKeys, LONG_TAIL_SECONDS, LONG_FPS } = await import("../../src/render/longplan.ts");
const { coldOpenTiming, coldOpenLine } = await import("../../src/render/bookends.ts");
const { chooseFillers, applyFillers, reconPicks } = await import("../../src/assets/fillers.ts");
const { episodeClipCheck } = await import("../../src/assets/fillerstep.ts");
const { renderLongStills } = await import("../../src/render/render.ts");

const args = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--max");
const [dbDir, id, media, out] = args as [string, string, string, string];
const max = process.argv.includes("--max") ? Number(process.argv[process.argv.indexOf("--max") + 1]) : 15;
fs.mkdirSync(out, { recursive: true });
const db = new PGlite(dbDir);
const [ep] = (await db.query<any>(`SELECT script_json, assets_json FROM episodes WHERE id = $1`, [id])).rows;
await db.close();
const script = ep.script_json, a = ep.assets_json;
const variant = variantOf(id);

// The fillers, as stepRenderLong chooses them.
const chapters = [...script.entries]
  .sort((x: any, y: any) => y.rank - x.rank)
  .map((e: any, i: number) => ({ entry: i, game: e.game_title, year: e.year, moments: e.moments ?? [], sentences: chapterSentences(script, i) }));
const recon = await reconPicks(chapters, a.images, a.clips, episodeClipCheck(media));
const choice = chooseFillers(chapters, { images: a.images, clips: a.clips, seed: variant, recon: recon.picks });
applyFillers(chapters, choice);

// The plan and the props, as stepRenderLong builds them (documentary settings at their defaults).
const words = a.words ?? [];
const duration = (a.durationSeconds ?? 300) + LONG_TAIL_SECONDS;
const segments = openChaptersAtBreaks(buildSegments(segmentInputs(script, Boolean(a.desk)), words, duration), a.breaks);
const moments = chapters.map((c) => c.moments);
const images = a.images.map((i: any) => ({ file: i.file, kind: i.kind, aspect: i.aspect, beatIndex: i.beatIndex, credit: photoCredit(i), moment: i.moment, label: i.label, layers: i.layers }));
const clips = a.clips.map((c: any) => ({ file: c.file, durationSeconds: c.durationSeconds, beatIndex: c.beatIndex, role: c.role, moment: c.moment, credit: c.credit, audio: c.audio }));
const plan = buildLongPlan({
  segments,
  words,
  durationSeconds: duration,
  images: images.map((i: any) => ({ kind: i.kind, aspect: i.aspect, beatIndex: i.beatIndex, moment: i.moment, file: i.file })),
  clips: clips.map((c: any) => ({ durationSeconds: c.durationSeconds, beatIndex: c.beatIndex, role: c.role, moment: c.moment })),
  variant,
  realPinnedOnly: true,
  momentCounts: moments.map((m: any[]) => m.length),
  momentKeys: moments.map((e: any[]) => e.map(momentKeys)),
  momentFillers: moments.map((e: any[]) => e.map((m: any) => m.filler)),
  momentShows: moments.map((e: any[], i: number) => {
    const said = chapterSentences(script, i);
    return e.map((m: any, k: number) => `${said[k] ?? ""} ${m.show} ${m.person ?? ""} ${m.keywords?.join(" ") ?? ""}`);
  }),
  takeEntry: script.take_entry,
  rhythm: true,
  bookend: true,
  coldOpenFrames: coldOpenTiming(LONG_FPS).frames,
});
const props = {
  title: script.headline,
  kicker: script.kicker ?? "",
  criterion: script.criterion ?? "",
  spoilers: false,
  recap: false,
  theme: script.game_title,
  footageCredit: clips.length ? "FOOTAGE: OFFICIAL TRAILERS · STEAM" : "",
  endLine: "A new documentary every month · Shorts every day",
  moments: moments.map((ms: any[], ei: number) =>
    ms.map((m: any, mi: number) => ({
      show: m.show,
      graphic: (a.quietMoments ?? []).includes(`${ei}:${mi}`) ? { kind: "none", primary: "", secondary: "", items: [] } : m.graphic,
      emphasis: m.emphasis,
      person: m.person || undefined,
      beat: m.beat,
      filler: m.filler,
    })),
  ),
  segments,
  words,
  durationSeconds: duration,
  coldOpenLine: coldOpenLine(script.hook),
  titleDrop: true,
  chapterIndex: true,
  cutRhythm: true,
  bookendEnding: true,
  variant,
  audioFile: null,
  musicFile: null,
  imageFiles: images,
  clipFiles: clips,
  plan,
  renderDate: "2026-10-31",
  breaks: a.breaks,
  quietBreaks: a.quietBreaks,
  palette: a.palette,
  annotations: a.annotations,
  eraBeds: true,
  sketchAnimation: true,
  photoTreatments: true,
} as any;

// Up to `max` filler shots, spread across the families (round robin), each at its settle frame.
const fillerShots = plan.shots.filter((s: any) => s.media.type === "filler");
const byFamily = new Map<string, any[]>();
for (const s of fillerShots) {
  const f = moments[s.media.entry][s.media.index].filler;
  (byFamily.get(f.family) ?? byFamily.set(f.family, []).get(f.family)!).push(s);
}
const picked: any[] = [];
for (let round = 0; picked.length < max && round < 50; round++)
  for (const list of byFamily.values()) if (list[round] && picked.length < max) picked.push(list[round]);
picked.sort((x, y) => x.start - y.start);
const stills = picked.map((s, n) => ({ frame: Math.min(s.end - 1, s.start + (s.settle ?? 60)), file: path.join(out, `f${String(n).padStart(2, "0")}.jpg`) }));
const notes = picked.map((s, n) => {
  const f = moments[s.media.entry][s.media.index].filler;
  return {
    n,
    at: `${s.media.entry}:${s.media.index}`,
    family: f.family,
    style: f.style,
    confidence: f.confidence,
    frame: stills[n]!.frame,
    seconds: ((s.end - s.start) / LONG_FPS).toFixed(1),
    sentence: chapters[s.media.entry]!.sentences[s.media.index],
  };
});
fs.writeFileSync(path.join(out, "stills.json"), JSON.stringify({ counts: choice.counts, eligible: choice.eligible, refused: [...recon.refused], notes }, null, 1));
console.log(`fillers ${JSON.stringify(choice.counts)}; ${fillerShots.length} filler shots in the plan; rendering ${stills.length} stills`);
await renderLongStills({ episodeDir: media, props, stills, scale: 0.5 });

// The contact sheet: three across, each still with its family, style and sentence under it.
const W = 960, H = 540, CAP = 70, COLS = 3;
const rows = Math.ceil(stills.length / COLS);
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tiles = await Promise.all(
  stills.map(async (st, n) => {
    const nt = notes[n]!;
    const label = Buffer.from(
      `<svg width="${W}" height="${CAP}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="12" y="26" font-family="Arial" font-size="20" fill="#ff8a3d">${esc(`#${n} ${nt.at} ${nt.family} / ${nt.style} (${nt.confidence}) frame ${nt.frame}, ${nt.seconds}s`)}</text><text x="12" y="54" font-family="Arial" font-size="17" fill="#ddd">${esc(String(nt.sentence).slice(0, 100))}</text></svg>`,
    );
    return [
      { input: await sharp(st.file).resize(W, H).toBuffer(), left: (n % COLS) * W, top: Math.floor(n / COLS) * (H + CAP) },
      { input: label, left: (n % COLS) * W, top: Math.floor(n / COLS) * (H + CAP) + H },
    ];
  }),
);
await sharp({ create: { width: COLS * W, height: rows * (H + CAP), channels: 3, background: "#000" } })
  .composite(tiles.flat())
  .jpeg({ quality: 80 })
  .toFile(path.join(out, "contact_sheet.jpg"));
console.log(`contact sheet: ${path.join(out, "contact_sheet.jpg")}`);

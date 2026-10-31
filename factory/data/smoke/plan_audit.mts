// 30 Oct 2026: shot-by-shot audit of a long video's plan against its narration, over every frame. For each shot:
// its time, what it shows, the sentence it was chosen for, and the sentence(s) actually spoken while it is on
// screen. Reads a COPY of the database. Writes <out>/shots.tsv and prints the screen-time breakdown.
// Usage: node --import tsx data/smoke/plan_audit.mts <db copy dir> <episode id> <out dir> [--replan] [--dedupe] [--cap-stock=N] [--old-photos]
// 31 Oct 2026: also prints, per chapter, the shots on a real-world photo pinned to no sentence, and the stock shots
// per theme. --dedupe drops clips listed twice for one file (keeping the later, as data/smoke/vc_dedupe.mts does);
// --cap-stock=N keeps the first N stock clips of each theme (what STOCK_THEME_MAX would have gathered);
// --old-photos replans with real-world photos still poolable (REAL_PHOTOS_PINNED_ONLY=false).
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
const { segmentInputs } = await import("../../src/pipeline.ts");
const { buildSegments } = await import("../../src/render/timeline.ts");
const { openChaptersAtBreaks, momentWindows, momentKeys, LONG_TAIL_SECONDS, buildLongPlan, entryOf, realWorldImage } = await import("../../src/render/longplan.ts");
const { variantOf, chapterSentences } = await import("../../src/pipeline.ts");
const { capStockClips, keepLatestPerFile, sameStockTheme } = await import("../../src/assets/repeats.ts");
// --replan: build the plan afresh with the current planner code (what the next render would show).
const replan = process.argv.includes("--replan");
const cap = Number(process.argv.find((x) => x.startsWith("--cap-stock="))?.split("=")[1] ?? 0);
const [dbDir, id, out] = process.argv.slice(2) as [string, string, string];
const db = new PGlite(dbDir);
const [ep] = (await db.query<any>(`SELECT script_json, assets_json FROM episodes WHERE id = $1`, [id])).rows;
await db.close();
const script = ep.script_json, a = ep.assets_json;
if (process.argv.includes("--dedupe")) a.clips = keepLatestPerFile(a.clips);
if (cap > 0) a.clips = capStockClips(a.clips, cap);
const words: Array<{ text: string; start: number; end: number }> = a.words ?? [];
const duration = (a.durationSeconds ?? 300) + LONG_TAIL_SECONDS;
const segments = openChaptersAtBreaks(buildSegments(segmentInputs(script, Boolean(a.desk)), words, duration), a.breaks);
const moments = [...(script.entries ?? [])].sort((x: any, y: any) => y.rank - x.rank).map((e: any) => e.moments ?? []);
const windows = momentWindows(segments, words, moments.map((m: any[]) => m.length), moments.map((e: any[]) => e.map(momentKeys)));
const plan = replan
  ? buildLongPlan({
      segments,
      words,
      durationSeconds: duration,
      images: a.images.map((i: any) => ({ kind: i.kind, aspect: i.aspect, beatIndex: i.beatIndex, moment: i.moment, file: i.file })),
      realPinnedOnly: !process.argv.includes("--old-photos"),
      clips: a.clips.map((c: any) => ({ durationSeconds: c.durationSeconds, beatIndex: c.beatIndex, role: c.role, moment: c.moment })),
      variant: variantOf(id),
      momentCounts: moments.map((m: any[]) => m.length),
      momentKeys: moments.map((e: any[]) => e.map(momentKeys)),
      momentShows: moments.map((e: any[], i: number) => {
        const said = chapterSentences(script, i);
        return e.map((m: any, k: number) => `${said[k] ?? ""} ${m.show} ${m.person ?? ""} ${m.keywords?.join(" ") ?? ""}`);
      }),
      takeEntry: script.take_entry,
    })
  : a.longPlan;
if (!plan) throw new Error("no plan in this copy");
const fps = plan.fps;
const spokenIn = (t0: number, t1: number) =>
  windows
    .map((w) => ({ w, o: Math.max(0, Math.min(t1, w.end) - Math.max(t0, w.start)) }))
    .filter((x) => x.o > 0.05)
    .sort((x, y) => y.o - x.o);
const said = (t0: number, t1: number) => words.filter((w) => w.end > t0 && w.start < t1).map((w) => w.text).join(" ");
const secs: Record<string, number> = {};
const rows: string[] = ["start\tend\tclass\tmedia\tfor\tspoken\tgraphic\tlabel\twords"];
for (const s of plan.shots) {
  const t0 = s.start / fps, t1 = s.end / fps, len = t1 - t0;
  const m = s.media.type === "clip" ? a.clips[s.media.index] : s.media.type === "image" ? a.images[s.media.index] : undefined;
  const sp = spokenIn(t0, t1);
  const top = sp[0]?.w;
  const g = top ? moments[top.entry]?.[top.moment]?.graphic?.kind : undefined;
  let cls: string;
  if (!m) cls = "plate";
  else if (!top) cls = "no-narration";
  else if (m.moment === undefined) cls = g && g !== "none" ? "pool-under-graphic" : "pool";
  else if (m.beatIndex === top.entry && m.moment === top.moment) cls = "own-on-time";
  else if (sp.some((x) => x.w.entry === m.beatIndex && x.w.moment === m.moment)) cls = "own-partly";
  else cls = m.beatIndex === top.entry ? `own-off-by-${top.moment - m.moment}` : "own-wrong-chapter";
  const bucket = cls.startsWith("own-off-by") ? (Math.abs(Number(cls.slice(11))) === 1 ? "own-off-by-1" : "own-off-by-2+") : cls;
  secs[bucket] = (secs[bucket] ?? 0) + len;
  rows.push([t0.toFixed(2), t1.toFixed(2), cls, m ? String(m.file).replace(/\\/g, "/") : "-", m?.moment === undefined ? "-" : `${m.beatIndex}.${m.moment}`, top ? `${top.entry}.${top.moment}` : "-", g && g !== "none" ? g : "", m?.label ?? "", said(t0, t1).slice(0, 220)].join("\t"));
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "shots.tsv"), rows.join("\n"));
const total = Object.values(secs).reduce((x, y) => x + y, 0);
console.log(`${plan.shots.length} shots, ${Math.round(total)} s`);
for (const [k, v] of Object.entries(secs).sort((x, y) => y[1] - x[1])) console.log(`${k.padEnd(18)} ${Math.round(v).toString().padStart(5)} s  ${((100 * v) / total).toFixed(1)}%`);
// Sentence-level: of the sentences with a picture of their own, how many get to show it while they are spoken.
let pinned = 0, shown = 0;
for (const w of windows) {
  const own = [...a.images, ...a.clips].some((x: any) => x.beatIndex === w.entry && x.moment === w.moment);
  if (!own) continue;
  pinned++;
  const ok = plan.shots.some((s: any) => {
    const m = s.media.type === "clip" ? a.clips[s.media.index] : s.media.type === "image" ? a.images[s.media.index] : undefined;
    return m && m.beatIndex === w.entry && m.moment === w.moment && s.end / fps > w.start && s.start / fps < w.end;
  });
  shown += +ok;
}
console.log(`sentences with own media: ${pinned}; shown while spoken: ${shown}`);
// The sentences whose own media never plays while they are spoken, and why.
for (const w of windows) {
  const mine = [...a.images.map((x: any, i: number) => ({ x, t: "image", i })), ...a.clips.map((x: any, i: number) => ({ x, t: "clip", i }))].filter((o) => o.x.beatIndex === w.entry && o.x.moment === w.moment);
  if (!mine.length) continue;
  const shownAt = plan.shots.filter((s: any) => mine.some((o) => o.t === s.media.type && o.i === s.media.index));
  const during = shownAt.some((s: any) => s.end / fps > w.start && s.start / fps < w.end);
  if (!during && process.argv.includes("--missed"))
    console.log(`missed ${w.entry}.${w.moment} ${(w.end - w.start).toFixed(1)}s at ${w.start.toFixed(1)}: ${mine.map((o) => o.t).join(",")} shown at [${shownAt.map((s: any) => (s.start / fps).toFixed(0)).join(",")}]`);
}
// Real-world photos per chapter: shots on one pinned to no sentence, and shots on one away from its sentence
// (neither its own nor the one after it, which fillerFor allows).
const realRows = new Map<string, { unpinned: number; away: number; files: Set<string> }>();
for (const s of plan.shots) {
  if (s.media.type !== "image") continue;
  const im = a.images[s.media.index];
  if (!im || !realWorldImage(im)) continue;
  const e = entryOf(segments, s.segment, script.take_entry);
  const key = segments[s.segment]?.kind === "beat" ? `chapter ${e}` : String(segments[s.segment]?.kind);
  const r = realRows.get(key) ?? realRows.set(key, { unpinned: 0, away: 0, files: new Set() }).get(key)!;
  const sp = spokenIn(s.start / fps, s.end / fps)[0]?.w;
  if (im.moment === undefined) {
    r.unpinned++;
    r.files.add(im.label ?? im.file);
  } else if (!sp || sp.entry !== im.beatIndex || (sp.moment !== im.moment && sp.moment !== im.moment + 1)) r.away++;
}
console.log("\nreal-world photo shots: unpinned / away from their sentence");
for (const [k, r] of [...realRows].sort()) console.log(`  ${k.padEnd(12)} ${String(r.unpinned).padStart(3)} / ${String(r.away).padStart(3)}  ${[...r.files].join("; ")}`);
// Stock shots per theme (themes merged by sameStockTheme, named by their first search).
const themes: Array<{ name: string; shots: number; clips: Set<number> }> = [];
for (const s of plan.shots) {
  if (s.media.type !== "clip") continue;
  const c = a.clips[s.media.index];
  if (!c?.stock) continue;
  const t = themes.find((x) => sameStockTheme(x.name, String(c.label ?? ""))) ?? (themes.push({ name: String(c.label ?? ""), shots: 0, clips: new Set() }), themes.at(-1)!);
  t.shots++;
  t.clips.add(s.media.index);
}
console.log(`\nstock shots per theme (${a.clips.filter((c: any) => c.stock).length} stock clips in the episode)`);
for (const t of themes.sort((x, y) => y.shots - x.shots)) console.log(`  ${String(t.shots).padStart(3)} shots, ${t.clips.size} clips  ${t.name}`);

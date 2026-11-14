// The authenticity audit (src/authenticity.ts) on a database COPY: for every upload of the last 30 days it
// rebuilds the YouTube metadata the factory sends (videoMetadata) and checks the synthetic-media flag and the
// AI disclosure line; it measures how much the titles, hooks, loop lines, take openers, story structures and
// thumbnails repeat; it lists lines that recur word for word; and it replays the new repetition rule over the
// same Shorts in order (as the writer would have met it) to show how many drafts it would have sent back.
// node --import tsx data/smoke/authenticity.mts [--db data/smoke/dbcopy/db] [--episodes C:/PulseFactory/factory/data/episodes] [--max 3]
// Only reads: nothing is written to the database copy or the episode folders.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createEmbeddedDb } from "../../src/db.ts";
import { videoMetadata } from "../../src/pipeline.ts";
import { auditLines, verbatimLines, repetitionProblems, type ShortText } from "../../src/authenticity.ts";
import { dHash, hamming } from "../../src/assets/footagefirst.ts";
import { hookShape } from "../../src/editorial/why.ts";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1]! : d;
};
const dbDir = arg("--db", "data/smoke/dbcopy/db");
const epRoot = arg("--episodes", "C:/PulseFactory/factory/data/episodes");
const max = Number(arg("--max", "3"));
const db = await createEmbeddedDb(dbDir);

const rows = await db.query<any>(
  `SELECT id, lane, story_hash, status, story_json, script_json, assets_json, publish_at, created_at, youtube_video_id
     FROM episodes WHERE status = 'published' AND youtube_video_id IS NOT NULL
      AND created_at > now() - interval '30 days' ORDER BY created_at`,
);
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");
console.log(`Uploads in the last 30 days: ${rows.length}`);

// 1. The flag and the disclosure, as the upload step builds them (SYNTHETIC_MEDIA_DISCLOSURE is unset live: true).
let flagged = 0;
let disclosed = 0;
const gaps: string[] = [];
for (const ep of rows) {
  const meta = videoMetadata(ep, "public", ep.lane === "gameplay" ? false : true);
  const voiced = !ep.script_json?.gameplay;
  if (meta.containsSyntheticMedia) flagged++;
  const says = /AI-generated synthetic voice|AI voice/i.test(meta.description);
  if (says) disclosed++;
  if (voiced && (!meta.containsSyntheticMedia || !says)) gaps.push(`${ep.id} ${ep.lane}: flag ${meta.containsSyntheticMedia}, disclosure ${says}`);
}
console.log(`Synthetic-media flag set: ${flagged}/${rows.length}; AI disclosure in the description: ${disclosed}/${rows.length}`);
console.log(gaps.length ? `  Narrated uploads missing either: ${gaps.join("; ")}` : "  Every narrated upload carries both.");

// 2. Variety of the Shorts' words and structures.
const shorts = rows.filter((r) => (r.script_json?.runtime ?? "short") === "short" && r.lane !== "twin");
const at = (r: any) => new Date(r.created_at);
const game = (r: any) => r.script_json?.game_title ?? "";
for (const [label, get] of [
  ["Titles", (r: any) => r.script_json?.youtube?.title ?? ""],
  ["Hooks", (r: any) => r.script_json?.hook ?? ""],
  ["Loop lines", (r: any) => r.script_json?.loop_line ?? ""],
] as const) {
  const a = auditLines(shorts.map((r) => ({ line: get(r), game: game(r), at: at(r) })), max);
  console.log(`\n${label}: ${a.items} Shorts; ${pct(Math.round(a.repeatShare * a.items), a.items)} carry a phrase ${max}+ earlier Shorts in 30 days used.`);
  console.log(`  Most used phrases: ${a.top.map((t) => `"${t.phrase}" x${t.count}`).join(", ")}`);
}
const colon = shorts.filter((r) => /^[^:]{2,40}:\s/.test(r.script_json?.youtube?.title ?? "")).length;
console.log(`\nTitles in the "Game: fact" colon template: ${colon}/${shorts.length} (${pct(colon, shorts.length)})`);
const count = (xs: string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ");
};
console.log(`Hook shapes: ${count(shorts.map((r) => hookShape(r.script_json?.hook ?? "")))}`);
console.log(`Loop lines that are an "X, or Y?" fork: ${shorts.filter((r) => /,? or [^?]+\?\s*$/i.test(r.script_json?.loop_line ?? "")).length}/${shorts.length}`);
console.log(`Story types: ${count(shorts.map((r) => r.script_json?.story_type ?? r.script_json?.evergreen_format ?? "?"))}`);
console.log(`Beats per Short: ${count(shorts.map((r) => String((r.script_json?.beats ?? r.script_json?.entries ?? []).length)))}`);
const takes = shorts.map((r) => (r.script_json?.pulse_take?.narration ?? "").trim().split(/\s+/).slice(0, 2).join(" ").toLowerCase()).filter(Boolean);
console.log(`Take openers used 3+ times: ${count(takes).split(", ").filter((x) => Number(x.split(" ").pop()) >= 3).join(", ") || "none"}`);

// 3. Thumbnails: the posters' perceptual hashes; near-identical pairs (Hamming <= 6 of 64) inside 30 days.
const hashes: Array<{ id: string; h: string }> = [];
for (const r of shorts) {
  const f = path.join(epRoot, r.id, r.assets_json?.poster ?? "poster.jpg");
  if (!fs.existsSync(f)) continue;
  try {
    const raw = execFileSync("ffmpeg", ["-v", "error", "-i", f, "-vf", "scale=9:8,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1024 });
    hashes.push({ id: r.id, h: dHash(new Uint8Array(raw)) });
  } catch {}
}
let near = 0;
for (let i = 0; i < hashes.length; i++)
  for (let j = i + 1; j < hashes.length; j++) if (hamming(hashes[i]!.h, hashes[j]!.h) <= 6) near++;
const pairs = (hashes.length * (hashes.length - 1)) / 2;
console.log(`\nThumbnails (posters) hashed: ${hashes.length}; near-identical pairs: ${near}/${pairs} (${pairs ? ((100 * near) / pairs).toFixed(1) : "-"}%)`);

// 4. Lines that repeat word for word: description sentences outside the fixed footer, loop lines, pinned comments.
const footer = /^(Narration: AI|Pulse Gaming|Sources:|•|#|Chapters:|Game footage|Photos:|This story is unconfirmed)/;
const sentences = rows.flatMap((r) =>
  videoMetadata(r, "public", true)
    .description.split(/\n|(?<=[.!?])\s+/)
    .map((s: string) => s.trim())
    .filter((s: string) => s && !footer.test(s) && !/https?:\/\//.test(s)),
);
const vd = verbatimLines(sentences, 3);
console.log(`\nDescription sentences repeated word for word in 3+ uploads: ${vd.length}${vd.length ? `: ${vd.slice(0, 6).map((v) => `"${v.line.slice(0, 80)}" x${v.count}`).join("; ")}` : ""}`);
const vl = verbatimLines(shorts.map((r) => r.script_json?.loop_line ?? ""));
console.log(`Loop lines repeated word for word: ${vl.length}`);
const pins = await db.query<{ text: string }>(
  `SELECT detail->>'text' AS text FROM events WHERE kind = 'comment_posted' AND created_at > now() - interval '30 days'`,
);
const pinShapes = pins.map((p) => (p.text ?? "").replace(/^Our pick: .*?\.\s*/, "Our pick: <take>. "));
const vp = verbatimLines(pinShapes, 3);
console.log(`Pinned comments posted: ${pins.length}; templated in 3+ (the take swapped out): ${vp.length}${vp.length ? `: ${vp.slice(0, 4).map((v) => `"${v.line.slice(0, 90)}" x${v.count}`).join("; ")}` : ""}`);

// 5. The rule replayed: how many of these Shorts' drafts the writer would have had sent back.
let back = 0;
const shown: string[] = [];
shorts.forEach((r, i) => {
  const before: ShortText[] = shorts
    .slice(0, i)
    .filter((b) => at(r).getTime() - at(b).getTime() <= 30 * 86400_000)
    .map((b) => ({ title: b.script_json?.youtube?.title ?? "", hook: b.script_json?.hook ?? "", game: game(b) }));
  const p = repetitionProblems({ title: r.script_json?.youtube?.title ?? "", hook: r.script_json?.hook ?? "", game: game(r) }, before, max);
  if (p.length) {
    back++;
    if (shown.length < 8) shown.push(`${r.script_json?.youtube?.title}: ${p[0]!.match(/"([^"]+)"/)?.[1]}`);
  }
});
console.log(`\nRepetition rule (REPEAT_MAX=${max}) replayed: ${back}/${shorts.length} drafts (${pct(back, shorts.length)}) would have been sent back once.`);
for (const s of shown) console.log(`  ${s}`);
await db.close();
process.exit(0);

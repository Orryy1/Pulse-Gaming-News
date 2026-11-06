// The sound craft's measurement (31 Oct 2026), after data/smoke/soundfx_proof.mts: for every sentence of the
// rendered stretch, the narration's loudness against everything else in the mix (music, era bed, game sound,
// every effect), with ffmpeg's ebur128, before (the old mix) and after (the sound craft on). Speech on top
// means a positive margin, and the craft must not take any sentence's margin under MIN_MARGIN_DB. Also each
// full mix's integrated loudness, and every sound event the composition placed (events.json). No render.
//   node --import tsx data/smoke/soundfx_measure.mts <dbcopy> <episode> <fromSeconds> <toSeconds>
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const [dbDir, id, fromS, toS] = process.argv.slice(2) as [string, string, string, string];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "data", "smoke", "soundfx_out");
const from = Number(fromS);
const to = Number(toS);
/** The voice must stay at least this far over everything else in every sentence. */
const MIN_MARGIN_DB = 10;

const db = new PGlite(dbDir);
const [ep] = (await db.query<any>(`SELECT assets_json FROM episodes WHERE id = $1`, [id])).rows;
await db.close();
const words: Array<{ text: string; start: number; end: number }> = ep.assets_json.words;

function lufs(file: string, ss?: number, t?: number): number {
  const args = ["-hide_banner", "-nostats", ...(ss !== undefined ? ["-ss", ss.toFixed(3), "-t", t!.toFixed(3)] : []), "-i", file, "-af", "ebur128", "-f", "null", "-"];
  const r = spawnSync("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024 });
  const m = String(r.stderr ?? "").match(/Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/);
  return m ? Number(m[1]) : Number.NaN;
}

// The after mix: Remotion's mix is a plain sum (the before render equals before_rest plus the narration to
// -75 dB), so after.wav is after_rest.wav plus the same narration, summed without normalising.
const voiceFile = path.join(OUT, "ep", "voice.mp3");
if (!fs.existsSync(path.join(OUT, "after.wav")))
  spawnSync("ffmpeg", [
    "-v", "error", "-y", "-i", path.join(OUT, "after_rest.wav"), "-ss", String(from), "-t", String(to - from), "-i", voiceFile,
    "-filter_complex", "[1:a]aresample=48000,aformat=channel_layouts=stereo[v];[0:a][v]amix=inputs=2:normalize=0:duration=first",
    "-c:a", "pcm_s16le", path.join(OUT, "after.wav"),
  ]);
// Sentences of the stretch, from the word timings.
const sentences: Array<{ from: number; to: number; text: string }> = [];
let cur: typeof words = [];
for (const w of words) {
  if (w.start < from || w.end > to) continue;
  cur.push(w);
  if (/[.!?]["”']?$/.test(w.text)) {
    sentences.push({ from: cur[0]!.start, to: cur.at(-1)!.end, text: cur.map((x) => x.text).join(" ") });
    cur = [];
  }
}
const voice = path.join(OUT, "ep", "voice.mp3");
const rows: string[] = [];
const margins = { before: [] as number[], after: [] as number[] };
for (const s of sentences) {
  const len = s.to - s.from;
  if (len < 1) continue;
  const v = lufs(voice, s.from, len);
  const b = lufs(path.join(OUT, "before_rest.wav"), s.from - from, len);
  const a = lufs(path.join(OUT, "after_rest.wav"), s.from - from, len);
  margins.before.push(v - b);
  margins.after.push(v - a);
  rows.push(
    `${s.from.toFixed(1).padStart(6)}-${s.to.toFixed(1).padEnd(6)} voice ${v.toFixed(1)} LUFS | rest before ${b.toFixed(1)} (${(v - b).toFixed(1)} dB under) | after ${a.toFixed(1)} (${(v - a).toFixed(1)} dB under) | ${s.text.slice(0, 60)}`,
  );
}
const stat = (x: number[]) =>
  `min ${Math.min(...x).toFixed(1)} dB, median ${[...x].sort((p, q) => p - q)[Math.floor(x.length / 2)]!.toFixed(1)} dB`;
const lines = [
  `Voice over everything else, per sentence (${rows.length} sentences, ${from}-${to} s of ${id}):`,
  ...rows,
  "",
  `before: ${stat(margins.before)}`,
  `after:  ${stat(margins.after)}`,
  `whole mix integrated: before ${lufs(path.join(OUT, "before.wav")).toFixed(1)} LUFS, after ${lufs(path.join(OUT, "after.wav")).toFixed(1)} LUFS, demo ${lufs(path.join(OUT, "after_demo.wav")).toFixed(1)} LUFS`,
  `everything but the voice: before ${lufs(path.join(OUT, "before_rest.wav")).toFixed(1)} LUFS, after ${lufs(path.join(OUT, "after_rest.wav")).toFixed(1)} LUFS`,
  Math.min(...margins.after) >= MIN_MARGIN_DB ? `PASS: speech stays on top by at least ${MIN_MARGIN_DB} dB in every sentence` : `CHECK: a sentence's margin is under ${MIN_MARGIN_DB} dB`,
];
// Each render's own event log (events_<name>.json); the after mix's sounds are the after_rest render's (the
// narration is the only difference). Only the stretch's events are listed.
const fps = 30;
const load = (name: string) =>
  (JSON.parse(fs.readFileSync(path.join(OUT, `events_${name}.json`), "utf8")) as Array<{ frame: number; sound: string }>).filter(
    (e) => e.frame >= from * fps - 60 && e.frame < to * fps,
  );
const ev = { before: load("before"), after: load("after_rest"), after_demo: load("after_demo") };
const fmt = (list: Array<{ frame: number; sound: string }>) =>
  list.map((e) => `  ${(e.frame / fps).toFixed(2).padStart(7)} s  ${e.sound}`);
lines.push("", `Sound events, before (${ev.before.length}):`, ...fmt(ev.before));
lines.push("", `Sound events, after (${ev.after.length}):`, ...fmt(ev.after));
lines.push("", `Sound events, after_demo (${ev.after_demo.length}; two reveals and one message quote marked for the demo only):`, ...fmt(ev.after_demo));
fs.writeFileSync(path.join(OUT, "report.txt"), `${lines.join("\n")}\n`, "utf8");
console.log(lines.slice(0, rows.length + 8).join("\n"));

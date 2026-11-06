// 31 Oct 2026: loudness and brightness of every sentence of a narration, from a database COPY's word timings,
// to find the sentences that sound different. Usage: node --import tsx data/smoke/sentence_levels.mts <db> <episode>
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";

const [dbDir, id] = process.argv.slice(2) as [string, string];
const db = new PGlite(dbDir);
const [ep] = (
  await db.query<any>(`SELECT assets_json FROM episodes WHERE id = $1`, [id])
).rows;
await db.close();
const words: Array<{ text: string; start: number; end: number }> =
  ep.assets_json.words;
const file = `C:/PulseFactory/factory/data/episodes/${id}/voice.mp3`;
const RATE = 16000;
const raw = execFileSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-i",
    file,
    "-ac",
    "1",
    "-ar",
    String(RATE),
    "-f",
    "s16le",
    "-",
  ],
  { maxBuffer: 1 << 30 },
);
const pcm = new Int16Array(
  raw.buffer,
  raw.byteOffset,
  Math.floor(raw.byteLength / 2),
);
const sentences: Array<{ from: number; to: number; text: string }> = [];
let cur: typeof words = [];
for (const w of words) {
  cur.push(w);
  if (/[.!?]["')]*$/.test(w.text)) {
    sentences.push({
      from: cur[0]!.start,
      to: cur.at(-1)!.end,
      text: cur.map((x) => x.text).join(" "),
    });
    cur = [];
  }
}
const rows = sentences.map((s) => {
  const a = Math.floor(s.from * RATE),
    b = Math.floor(s.to * RATE);
  // Loudness of voiced 20 ms windows only (pauses inside the sentence would drag the mean down).
  const vals: number[] = [];
  let zc = 0,
    n = 0;
  for (let i = a; i + 320 <= b; i += 320) {
    let sum = 0;
    for (let k = i; k < i + 320; k++) {
      sum += pcm[k]! * pcm[k]!;
      if (k > i && pcm[k]! >= 0 !== pcm[k - 1]! >= 0) zc++;
      n++;
    }
    const d = 20 * Math.log10(Math.sqrt(sum / 320) / 32768 + 1e-9);
    if (d > -40) vals.push(d);
  }
  vals.sort((x, y) => x - y);
  const level = vals.length ? vals[Math.floor(vals.length * 0.7)]! : -99;
  return {
    ...s,
    level,
    zcr: zc / Math.max(1, n),
    wps: s.text.split(" ").length / Math.max(0.1, s.to - s.from),
  };
});
const levels = rows.map((r) => r.level).sort((x, y) => x - y);
const med = levels[Math.floor(levels.length / 2)]!;
const zs = rows.map((r) => r.zcr).sort((x, y) => x - y);
const zmed = zs[Math.floor(zs.length / 2)]!;
console.log(`sentences ${rows.length}, median level ${med.toFixed(1)} dBFS`);
const odd = rows.filter(
  (r) =>
    Math.abs(r.level - med) >= 2.5 || Math.abs(r.zcr - zmed) / zmed >= 0.25,
);
for (const r of odd)
  console.log(
    `${r.from.toFixed(1).padStart(7)}s  level ${r.level - med >= 0 ? "+" : ""}${(r.level - med).toFixed(1)} dB  brightness ${(((r.zcr - zmed) / zmed) * 100).toFixed(0)}%  ${r.wps.toFixed(1)} w/s  ${r.text.slice(0, 70)}`,
  );
console.log(`odd sentences: ${odd.length} of ${rows.length}`);

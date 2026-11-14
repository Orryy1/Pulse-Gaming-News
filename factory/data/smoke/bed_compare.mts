// 31 Oct 2026: the bed's level under a real narration, old rule (5-frame talk average) against bedEnvelope.
import { PGlite } from "@electric-sql/pglite";
import { bedEnvelope } from "../../src/render/musicplan.ts";
const [dbDir, id] = process.argv.slice(2) as [string, string];
const db = new PGlite(dbDir);
const [ep] = (await db.query<any>(`SELECT assets_json FROM episodes WHERE id = $1`, [id])).rows;
await db.close();
const fps = 30, words = ep.assets_json.words as Array<{ start: number; end: number }>;
const n = Math.ceil((words.at(-1)!.end + 3) * fps);
const on = new Uint8Array(n + 1);
for (const w of words) for (let f = Math.max(0, Math.floor((w.start - 0.06) * fps)); f <= Math.min(n, Math.ceil((w.end + 0.3) * fps)); f++) on[f] = 1;
const old = Array.from({ length: n + 1 }, (_, f) => { let t = 0; for (let k = -2; k <= 2; k++) t += on[Math.min(n, Math.max(0, f + k))]!; return 0.22 + (0.07 - 0.22) * (t / 5); });
const neu = bedEnvelope(on, fps, 0.07, 0.11);
const stat = (a: ArrayLike<number>) => {
  let jumps = 0, swings = 0, prev = a[fps * 3]!;
  for (let f = fps * 3; f < a.length - fps * 3; f++) {
    const d = 20 * Math.log10(a[f]! / a[f - 1]!);
    if (Math.abs(d) > 0.5) jumps++;
    if (a[f]! > prev * 1.25 && a[f - 1]! <= prev * 1.25) swings++;
    if (on[f]) prev = a[f]!;
  }
  const db = Array.from(a).slice(fps * 3, -fps * 3).map((x) => 20 * Math.log10(x));
  return `range ${Math.min(...db).toFixed(1)} to ${Math.max(...db).toFixed(1)} dB, rises over 2 dB: ${swings}, frames moving faster than 0.5 dB: ${jumps}`;
};
console.log("old:", stat(old));
console.log("new:", stat(neu));

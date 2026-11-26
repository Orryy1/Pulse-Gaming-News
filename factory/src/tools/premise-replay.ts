// STORY_PREMISE_GATE replay: which published news Shorts the gate would have dropped, with their numbers.
// Usage: node --import tsx src/tools/premise-replay.ts <latest.json from the analytics pull>
import { readFileSync } from "node:fs";
import { premiseFlag } from "../editorial/premisegate.ts";

const file = process.argv[2] ?? "C:/Claude/analytics/pulse/latest.json";
const d = JSON.parse(readFileSync(file, "utf8")) as {
  episodes: Record<string, { title: string; headline: string; lane: string; format: string; long: boolean }>;
  posts: Array<{ platform: string; episode_id?: string; views?: number; viewed_pct?: number; subs?: number; likes?: number; comments?: number }>;
};
const yt = new Map(d.posts.filter((p) => p.platform === "youtube" && p.episode_id).map((p) => [p.episode_id!, p]));
type Row = { title: string; views: number; viewed: number; subs: number; flag?: string };
const rows: Row[] = [];
for (const [id, e] of Object.entries(d.episodes)) {
  if (e.long || e.lane !== "news") continue;
  const p = yt.get(id);
  if (!p) continue;
  // The live gate reads the story's headline only.
  const f = premiseFlag(e.headline);
  rows.push({ title: e.title, views: p.views ?? 0, viewed: p.viewed_pct ?? 0, subs: p.subs ?? 0, flag: f ? `${f.kind} ("${f.matched}")` : undefined });
}
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const flagged = rows.filter((r) => r.flag);
const kept = rows.filter((r) => !r.flag);
for (const r of flagged.sort((a, b) => a.views - b.views))
  console.log(`DROP  ${String(r.views).padStart(6)} views  ${r.viewed.toFixed(0).padStart(3)}% viewed  ${r.title}  <- ${r.flag}`);
const sum = (label: string, xs: Row[]) =>
  console.log(
    `${label}: ${xs.length} Shorts, median views ${median(xs.map((r) => r.views))}, mean views ${mean(xs.map((r) => r.views)).toFixed(0)}, ` +
      `mean viewed ${mean(xs.map((r) => r.viewed)).toFixed(1)}%, subs per 1,000 views ${((1000 * xs.reduce((a, r) => a + r.subs, 0)) / Math.max(1, xs.reduce((a, r) => a + r.views, 0))).toFixed(2)}`,
  );
sum("would drop", flagged);
sum("would keep", kept);

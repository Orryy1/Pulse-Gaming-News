// The story-first mix proved on a database COPY, offline (no model calls, no uploads):
// 1. the day's plan before and after (slots, the news cap with Why slots ahead, the PC orchestrator windows),
//    and the last 30 days' breaking Shorts replayed under one-a-day plus BREAKING_BIG_SCORE;
// 2. what the Why editor is now offered, with the freshness rule applied to the copy's own Why Shorts;
// 3. every published Why Short's reason to follow (our long video on the same game, or the series) and the
//    pinned-comment line it gets, and whether its actual loop line would have passed the new check;
// 4. with --demand, the YouTube demand check run for real on today's Why candidates (yt-dlp, no API quota, at
//    most DEMAND_LOOKUPS pages, cached for 24 h in the copy's settings table).
// node --import tsx data/smoke/storymix.mts [--db data/smoke/dbcopy/db] [--demand]
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createEmbeddedDb } from "../../src/db.ts";
import { testConfig } from "../../tests/helpers.ts";
import { plannedSlots } from "../../src/pcschedule.ts";
import { breakingAllowance, whySlotsAhead } from "../../src/storymix.ts";
import { newsCapReached } from "../../src/cadence.ts";
import { dayKey, localTime } from "../../src/lanes.ts";
import { evergreenCandidates } from "../../src/discovery/evergreen.ts";
import { whyCandidates, whyFollowProblems, whyHookProblems, whyPinnedLine, sameGame } from "../../src/editorial/why.ts";
import { followFor } from "../../src/youtube/longlink.ts";
import { dbDemandCache, demandFor, demandLine, parseDemandRows, rankByDemand, viewsLabel } from "../../src/discovery/searchdemand.ts";
import { YTDLP_TEXT } from "../../src/lib/bin.ts";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1]! : d;
};
const db = await createEmbeddedDb(arg("--db", "data/smoke/dbcopy/db"));
const now = new Date("2026-11-02T06:00:00Z"); // Monday 2 Nov, 06:00 London
const tz = "Europe/London";
// The live settings that matter (factory .env, 1 Nov 2026), before and after.
const live = {
  newsSlots: ["17:00", "22:00"],
  dealsDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
  dealsSlot: "16:30",
  evergreenDays: ["mon", "tue", "thu", "sat"],
  longformDays: ["sat"],
  longformSlot: "17:00",
  whyEnabled: true,
  whyDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  timezone: tz,
};
const before = testConfig("/tmp", { ...live, whySlots: ["18:30"], whySlot: "18:30", shortsPerDayMax: 3, breakingPerDay: 2, breakingBigScore: 0, evergreenEnabled: true, weeklyEnabled: true, longformEnabled: true, docEnabled: false, cutdownsEnabled: false });
const after = testConfig("/tmp", { ...before, whySlots: ["12:00", "18:30"], whySlot: "12:00", shortsPerDayMax: 4, breakingPerDay: 1, breakingBigScore: 95 });

console.log("1. The day's plan (Monday 2 Nov), as published to the PC orchestrator:");
for (const [label, cfg] of [["before", before], ["after", after]] as const) {
  const w = plannedSlots(cfg, now, 20).map((x) => `${x.lane} ${x.at.toISOString().slice(11, 16)} (PC kept free from ${new Date(x.at.getTime() - Math.min(x.lead, x.keep) * 60_000).toISOString().slice(11, 16)})`);
  console.log(`   ${label}: ${w.join(", ")}`);
}
// The news-lane cap through a day with no breaking story: each slot in time order, Why slots ahead counted.
for (const [label, cfg] of [["before", before], ["after (SHORTS_PER_DAY_MAX=4)", after], ["after with the cap left at 3", { ...after, shortsPerDayMax: 3 }]] as const) {
  const day = dayKey(now, tz);
  const slots = [
    ...cfg.newsSlots.map((s) => ({ lane: "news", s })),
    ...cfg.whySlots.map((s) => ({ lane: "why", s })),
  ].sort((a, b) => a.s.localeCompare(b.s));
  let made = 0;
  const taken: Date[] = [];
  const out: string[] = [];
  for (const sl of slots) {
    const at = localTime(day, sl.s, tz);
    const lead = new Date(at.getTime() - 75 * 60_000);
    const ahead = sl.lane === "news" ? whySlotsAhead(cfg, lead, taken) : 0;
    const held = newsCapReached(cfg.shortsPerDayMax, made + ahead);
    out.push(`${sl.lane} ${sl.s} ${held ? "held" : "made"}`);
    if (!held) {
      made++;
      taken.push(at);
    }
  }
  console.log(`   news lane, ${label}: ${out.join(", ")} (${made} Shorts)`);
}
const breaking = await db.query<{ d: string; score: number; h: string }>(
  `SELECT to_char(created_at AT TIME ZONE 'Europe/London','YYYY-MM-DD') d, GREATEST((story_json->>'score')::numeric, 0)::int score, story_json->>'headline' h
     FROM episodes WHERE lane = 'news_breaking' AND status NOT IN ('failed','rejected') AND created_at > now() - interval '30 days' ORDER BY created_at`,
);
const byDay = new Map<string, number[]>();
for (const b of breaking) byDay.set(b.d, [...(byDay.get(b.d) ?? []), b.score]);
let oldN = 0;
let newN = 0;
for (const [, scores] of byDay) {
  oldN += Math.min(scores.length, 2);
  let n = 0;
  for (const sc of scores) {
    const a = breakingAllowance(n, 1, 95);
    if (a.open && sc >= a.minScore) n++;
  }
  newN += n;
}
console.log(`   Breaking Shorts made in the last 30 days: ${breaking.length} on ${byDay.size} days; under one a day plus 95+ for a second: ${newN} (${breaking.length - newN} would have waited for a news slot).`);
console.log(`   Days with more than one: ${[...byDay].filter(([, s]) => s.length > 1).map(([d, s]) => `${d} (${s.join(", ")})`).join("; ")}`);

console.log("\n2. What the Why editor is offered today, and the freshness rule on this copy:");
const why = await db.query<{ game: string | null; created: string; hook: string | null; loop: string | null; status: string; id: string; title: string | null }>(
  `SELECT id, status, story_json->>'gameHint' game, created_at::text created, script_json->>'hook' hook, script_json->>'loop_line' loop, script_json->'youtube'->>'title' title
     FROM episodes WHERE story_hash LIKE 'why:%' ORDER BY created_at`,
);
const fresh = why.filter((w) => !["failed", "rejected"].includes(w.status) && Date.parse(w.created) > now.getTime() - 14 * 86400_000);
const games = fresh.map((w) => w.game ?? "");
console.log(`   Why Shorts in the last 14 days: ${fresh.length} (${games.join(", ")})`);
const base = await evergreenCandidates(dayKey(now, tz)).catch(() => []);
const offered = whyCandidates(base, dayKey(now, tz)).filter((c) => !games.some((g) => sameGame(g, c.name)));
console.log(`   Before: ${base.length} candidates, ${base.filter((c) => c.source === "steam top sellers").length} of them this week's Steam top sellers, the rest franchise names.`);
console.log(`   After: ${offered.length} candidates, the first 12 well-loved games with a turning point: ${offered.slice(0, 12).map((c) => c.name).join(", ")}`);
// The hook rule replayed in order over the copy's own Why Shorts.
const hooks: string[] = [];
let sent = 0;
for (const w of why.filter((w) => w.hook)) {
  const p = whyHookProblems(w.hook!, hooks);
  if (p.length) sent++;
  hooks.unshift(w.hook!);
}
console.log(`   Hook rule replayed over ${hooks.length} Why drafts: ${sent} would have been sent back for a repeated opening or a third shape in a row.`);

console.log("\n3. The reason to follow on each published Why Short:");
let missed = 0;
const published = why.filter((w) => w.status === "published");
for (const w of published) {
  const f = await followFor(db, w.game ?? "", now);
  const p = whyFollowProblems(w.loop ?? "", f);
  if (p.length) missed++;
  console.log(`   "${w.title}": ${f.kind}${f.title ? ` "${f.title}"` : ""}; loop line "${w.loop}" ${p.length ? "has no reason to follow" : "passes"}`);
  console.log(`      pinned comment ends:${whyPinnedLine(f)}`);
}
console.log(`   Before: ${published.length - missed}/${published.length} loop lines gave a reason to follow; after, the writer is sent back until it does.`);

if (process.argv.includes("--demand")) {
  console.log("\n4. The demand check, live, on today's Why candidates:");
  const run = promisify(execFile);
  const search = async (url: string) =>
    parseDemandRows(
      (
        await run("yt-dlp", [...YTDLP_TEXT.args, "--no-warnings", "--flat-playlist", "--playlist-end", "20", "--print", "%(id)s\t%(view_count)s\t%(channel)s\t%(title)s", url], {
          timeout: 60_000,
          maxBuffer: 4 * 1024 * 1024,
          env: YTDLP_TEXT.env,
        })
      ).stdout,
    );
  const t0 = Date.now();
  const demand = await demandFor(offered, { search, cache: dbDemandCache(db, () => new Date()), lookups: 12, minViews: 20000, now: new Date() });
  const { kept, skipped } = rankByDemand(offered, demand, 20000);
  console.log(`   ${demand.size} topics checked in ${Math.round((Date.now() - t0) / 1000)} s:`);
  for (const [name, d] of [...demand].sort((a, b) => b[1].views - a[1].views))
    console.log(`   ${d.level.padEnd(6)} ${viewsLabel(d.views).padStart(6)}  ${name}${d.top ? `  (top: "${d.top.title.slice(0, 60)}", ${viewsLabel(d.top.views)})` : ""}`);
  console.log(`   Skipped for no demand: ${skipped.map((c) => c.name).join(", ") || "none"}`);
  console.log(`   The editor's list now opens: ${kept.slice(0, 5).map((c) => c.name).join(", ")}`);
  console.log(`   The Discord line for a pick of the first: ${demandLine("Why Short at 12:00", kept[0]!.name, demand.get(kept[0]!.name), skipped.length)}`);
}
await db.close();
process.exit(0);

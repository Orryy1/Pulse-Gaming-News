// Offline proof of the doc-breakout work on a copy of the live database (read-only; the only network reads are
// Steam's store API, Wikipedia and YouTube's public search and channel pages):
//   1. the top 10 breakout documentary candidates with their score breakdowns;
//   2. sample titles before and after the shape rule;
//   3. the back-catalogue Test & compare entries, in a copy of the live queue;
//   4. the pre-review originality audit (markdown for the owner);
//   5. the cases for the render step (render.mts, run through the orchestrator).
// node --import tsx data/smoke/docpick/proof.mts [--demand]
import { PGlite } from "@electric-sql/pglite";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../../../src/db.ts";
import { rankBreakoutDocs, docPickLine } from "../../../src/docpick.ts";
import { demandOf, type SearchRow } from "../../../src/docdemand.ts";
import { findSteamApp, steamFacts } from "../../../src/assets/steam.ts";
import { researchGame } from "../../../src/discovery/wikipedia.ts";
import { titleAngle, titleShapeProblems } from "../../../src/editorial/titleshape.ts";
import { backCatalogueEntry, newAngles, upsertAbQueue, type AbQueueEntry } from "../../../src/backcatalogue.ts";
import { auditMarkdown, originalityRisks, trailerSecondsOf, type FactoryFacts, type Upload } from "../../../src/originality.ts";
import { markEvidence } from "../../../src/editorial/evidence.ts";
import { sentencesOf } from "../../../src/editorial/longform.ts";

const OUT = "data/smoke/docpick/out";
fs.mkdirSync(OUT, { recursive: true });
const now = new Date();
const open = (dir: string): Db & { pg: PGlite } => {
  const pg = new PGlite(dir);
  return {
    pg,
    query: async <T,>(sql: string, params: unknown[] = []) => (await pg.query(sql, params)).rows as T[],
    exec: async (sql: string) => void (await pg.exec(sql)),
    close: () => pg.close(),
  };
};
const db = open("data/smoke/dbcopy/db");
const longdry = open("data/smoke/dbcopy/longdry");

// ---------------------------------------------------------------- 1. top 10
const ytSearch = (url: string): SearchRow[] => {
  const out = execFileSync(
    "yt-dlp",
    ["--no-warnings", "--flat-playlist", "--playlist-end", "20", "--print", "%(id)s|%(view_count)s|%(channel)s|%(title)s", url],
    { timeout: 90_000, maxBuffer: 8 << 20 },
  ).toString();
  return out
    .split(/\r?\n/)
    .map((l) => l.split("|"))
    .filter((r) => r.length >= 4 && /^[\w-]{11}$/.test(r[0]!))
    .map(([videoId, views, channel, ...t]) => ({ videoId: videoId!, views: Number(views) || 0, channel: channel!, title: t.join("|") }));
};
const withDemand = process.argv.includes("--demand");
const ranked = await rankBreakoutDocs(
  {
    db,
    findGame: findSteamApp,
    gameFacts: steamFacts,
    research: (t, q, n) => researchGame(t, q, n),
  },
  {
    now,
    lookups: 12,
    demand: withDemand
      ? async (topic) => {
          const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(topic)}&sp=CAMSAggD`;
          return demandOf(topic, ytSearch(url), now);
        }
      : undefined,
  },
);
const top = ranked.filter((r) => !r.excluded).slice(0, 10);
fs.writeFileSync(`${OUT}/top10.json`, JSON.stringify(ranked.slice(0, 14), null, 1));
const top10md = [
  `# Breakout documentary candidates, ${now.toISOString().slice(0, 16)} UTC (database copy, read-only)`,
  "",
  `Demand: ${withDemand ? "YouTube search page this week, sorted by views (the proof's own yt-dlp lookup through the src/docdemand.ts interface)" : "stub, unknown (0.5) for every candidate"}. Weights: fame 0.25, arc 0.25, peg 0.2, demand 0.15, freshness 0.15.`,
  "",
  "| # | Candidate | Total | Fame | Arc | Peg | Demand | Fresh | Why |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...top.map(
    (r, i) =>
      `| ${i + 1} | ${r.candidate.subject} (${r.candidate.kind}) | ${r.total} | ${r.parts.fame} | ${r.parts.arc} | ${r.parts.peg} | ${r.parts.demand} | ${r.parts.freshness} | ${r.notes.join("; ").replace(/\|/g, "/")} |`,
  ),
  "",
  "Excluded: " + ranked.filter((r) => r.excluded).map((r) => `${r.candidate.subject} (${r.excluded})`).join("; "),
  "",
  "Discord line the pick would post:",
  "",
  `> ${docPickLine(top[0]!, top[1])}`,
].join("\n");
fs.writeFileSync(`${OUT}/top10.md`, top10md);
console.log(top10md);

// ---------------------------------------------------------------- 2. titles before and after
const before = [
  ...(await db.query<{ t: string; lane: string }>(
    `SELECT script_json->'youtube'->>'title' AS t, lane FROM episodes WHERE lane IN ('longform','evergreen') AND script_json IS NOT NULL ORDER BY created_at DESC LIMIT 40`,
  )),
].filter((r) => r.t);
const angles = JSON.parse(fs.readFileSync("data/smoke/docpick/angles.json", "utf8")) as Record<string, Array<{ title: string; angle?: string; thumb?: string }>>;
const titleLines = [
  "# Titles before and after the shape rule",
  "",
  "## Before: the factory's recent long and evergreen titles, as the rule reads them",
  "",
  "| Lane | Title | Angle | Rule says |",
  "| --- | --- | --- | --- |",
  ...before.map((r) => `| ${r.lane} | ${r.t} | ${titleAngle(r.t)} | ${titleShapeProblems(r.t).map((p) => p.split(";")[0]).join(" / ") || "passes"} |`),
];

// ---------------------------------------------------------------- 3. back catalogue
const listing = (file: string) =>
  fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l, order) => {
      const [videoId, views, duration, ...t] = l.split("|");
      return { videoId: videoId!, views: Number(views) || 0, duration: Number(duration) || undefined, title: t.join("|"), order };
    });
const longs = listing("data/smoke/docpick/channel_videos.psv");
const shorts = listing("data/smoke/docpick/channel_shorts.psv");
const LIVE = "C:/PulseFactory/factory/data";
// Each public long video's episode, by its video id, else by its title (re-uploads keep the script).
const eps = [
  ...(await db.query<any>(`SELECT id, youtube_video_id, publish_at, script_json->'youtube'->>'title' AS title, assets_json AS a FROM episodes WHERE lane = 'longform' AND script_json IS NOT NULL`)).map((e) => ({ ...e, dir: `${LIVE}/episodes/${e.id}` })),
  ...(await longdry.query<any>(`SELECT id, youtube_video_id, publish_at, script_json->'youtube'->>'title' AS title, assets_json AS a FROM episodes WHERE lane = 'longform' AND script_json IS NOT NULL`)).map((e) => ({ ...e, dir: `${LIVE}/smoke/longdry/episodes/${e.id}` })),
];
const pendingLive = JSON.parse(fs.readFileSync(`${LIVE}/abtests/pending.json`, "utf8")) as AbQueueEntry[];
const doneLive = new Set<string>(fs.existsSync(`${LIVE}/abtests/done.json`) ? JSON.parse(fs.readFileSync(`${LIVE}/abtests/done.json`, "utf8")) : []);
let queue = pendingLive;
const thumbCases: Array<Record<string, unknown>> = [];
titleLines.push("", "## After: the back catalogue's new angles (the first two go to the test)", "", "| Video | Live title (angle) | New angles |", "| --- | --- | --- |");
const actions: string[] = [];
for (const v of longs) {
  const ep =
    eps.find((e) => e.youtube_video_id === v.videoId) ??
    pendingLive.map((p) => eps.find((e) => e.id === p.episode && p.videoId === v.videoId)).find(Boolean) ??
    eps.find((e) => e.title === v.title);
  if (!ep) {
    actions.push(`${v.videoId}: no episode found, skipped`);
    continue;
  }
  const picked = newAngles(v.title, (angles[v.videoId] ?? []) as never);
  const doc = /documentary|why gta 6 had/i.test(v.title);
  // The art each angle is about: the topic's own key art for the first, the winner's (the last entry, number
  // one) for the second, so a "Why X Still Beats..." thumbnail shows X and not a random entry.
  const wide = ((ep.a?.images ?? []) as Array<{ file: string; kind: string; aspect: number; beatIndex?: number }>).filter(
    (i) => i.aspect >= 1.3 && ["hero", "screenshot", "header"].includes(i.kind),
  );
  const lastBeat = Math.max(-1, ...wide.map((i) => i.beatIndex ?? -1));
  const topicArt = wide.find((i) => i.beatIndex === undefined && i.kind === "hero") ?? wide[0];
  const winnerArt = wide.find((i) => i.beatIndex === lastBeat && i.kind === "hero") ?? wide.find((i) => i.beatIndex === lastBeat);
  const art = [topicArt?.file, (winnerArt ?? wide[1])?.file].filter((f): f is string => !!f);
  const outDir = path.resolve(`${OUT}/backcat/${ep.id}`);
  const thumbs = [`${ep.dir}/thumb.jpg`.replace(/\//g, "\\")];
  picked.slice(0, 2).forEach((a, k) => {
    const file = path.join(outDir, `thumb_ab_${k === 0 ? "b" : "c"}.jpg`);
    thumbs.push(file);
    thumbCases.push({
      file,
      dir: ep.dir,
      thumb: {
        headline: a.thumb,
        kicker: doc ? "DOCUMENTARY" : "RANKED",
        game: "",
        accent: "#FF6B1A",
        layout: k === 0 ? "full" : "split",
        imageFile: art[k] ?? art[0] ?? null,
      },
    });
  });
  const entry = backCatalogueEntry({ videoId: v.videoId, episode: ep.id, liveTitle: v.title, angles: picked, thumbs, publishAt: ep.publish_at ? new Date(ep.publish_at).toISOString() : now.toISOString(), now });
  const r = upsertAbQueue(queue, entry, doneLive);
  queue = r.list;
  actions.push(`${v.videoId} (${v.title}): ${r.action}`);
  titleLines.push(`| ${v.videoId} | ${v.title} (${titleAngle(v.title)}) | ${picked.map((a) => `${a.title} (${a.angle}; thumb "${a.thumb}")`).join("<br>")} |`);
}
fs.mkdirSync(`${OUT}/abtests`, { recursive: true });
fs.writeFileSync(`${OUT}/abtests/pending.json`, JSON.stringify(queue, null, 2));
fs.writeFileSync(`${OUT}/thumb_cases.json`, JSON.stringify(thumbCases, null, 1));
fs.writeFileSync(`${OUT}/titles.md`, titleLines.join("\n"));
console.log(titleLines.join("\n"));
console.log("\nA/B queue (copy):", actions.join("\n  "));

// ---------------------------------------------------------------- 4. audit
const all: Upload[] = [...shorts, ...longs.map((l) => ({ ...l, order: l.order + 0.5 }))];
const facts = new Map<string, FactoryFacts>();
for (const e of await db.query<any>(`SELECT youtube_video_id AS v, lane, assets_json->'clips' AS c, assets_json->>'durationSeconds' AS d, script_json->>'hook' AS h FROM episodes WHERE youtube_video_id IS NOT NULL`))
  facts.set(e.v, { trailerSeconds: trailerSecondsOf(e.c ?? []), durationSeconds: Number(e.d) || 0, hook: e.h ?? undefined, lane: e.lane });
const risks = originalityRisks(all, facts);
const md = auditMarkdown(risks, all, now, 20);
fs.writeFileSync(`${OUT}/audit.md`, md);
console.log(`\naudit: ${OUT}/audit.md, ${all.length} uploads, ${facts.size} with factory facts`);

// ---------------------------------------------------------------- 5. evidence demo cases
const wiki = await researchGame("Cyberpunk 2077", "Cyberpunk 2077 video game", 40000);
const narration = [
  "By the end of 2020 Cyberpunk 2077 was the most anticipated game in the world.",
  "At E3 2019 CD Projekt announced an initial release date of April 16, 2020.",
  "Night City was finally almost ready.",
  "Then came the delays, first to September and then to November and December.",
  "The streets of Night City filled with neon.",
  "On PC, critics were kind, and the review aggregators said so.",
];
const ev = markEvidence(
  narration.map((n) => ({ show: n, keywords: [], broll: "", graphic: { kind: "none", primary: "", secondary: "", items: [] }, emphasis: "", person: "" })),
  narration,
  wiki!,
  { max: 3 },
);
fs.writeFileSync(`${OUT}/evidence_cases.json`, JSON.stringify(ev.moments.filter((m) => m.graphic.evidence).map((m, i) => ({ name: `evidence_${i + 1}_${m.graphic.evidence!.kind}`, g: m.graphic, picture: "screenshot_4.jpg", dir: `${LIVE}/episodes/ep_20261019_5097ad8d/assets` })), null, 1));
console.log("\nevidence:", ev.added);
await db.close();
await longdry.close();
void sentencesOf;

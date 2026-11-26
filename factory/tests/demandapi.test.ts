// Demand lookups on the YouTube Data API (26 Nov 2026): the anonymous yt-dlp lane is retired, so the demand check asks
// the Data API directly, caches each topic for a week, de-duplicates and batches, rations new topics a day and falls
// back to older readings before "unknown". Fixed clocks, faked fetch, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { testDb } from "./helpers.ts";
import { demandApiSearch, type DemandGet } from "../src/discovery/demandapi.ts";
import {
  CACHE_HOURS,
  dbDemandBudget,
  dbDemandCache,
  demandFor,
  demandSearchers,
  scoreDemand,
  type SearchRow,
} from "../src/discovery/searchdemand.ts";
import { demandSearcher } from "../src/services.ts";
import { docDemandLookup } from "../src/docdemand.ts";
import { emptySignals, scoreCandidate } from "../src/docpick.ts";
import { loadConfig } from "../src/config.ts";

const day = 86_400_000;
// 26 Nov 2026 12:00 UTC is 04:00 Pacific on 26 Nov.
const t0 = new Date("2026-11-26T12:00:00Z");

/** A fake Data API: search answers from `results` (query -> [id, title][]), videos answers views from `views`. */
function fakeApi(o: {
  results: Record<string, [string, string][]>;
  views?: Record<string, number>;
  failSearch?: Record<string, { status: number; reason: string }>;
  failVideos?: boolean;
}) {
  const calls: string[] = [];
  const get: DemandGet = async (p) => {
    calls.push(p);
    const [method, qs] = p.split("?");
    const params = new URLSearchParams(qs);
    const json = (status: number, body: unknown) => ({
      ok: status < 400,
      status,
      json: async () => body,
    });
    if (method === "search") {
      const q = params.get("q")!;
      const fail = o.failSearch?.[q];
      if (fail)
        return json(fail.status, {
          error: { errors: [{ reason: fail.reason }] },
        });
      return json(200, {
        items: (o.results[q] ?? []).map(([id, title]) => ({
          id: { kind: "youtube#video", videoId: id },
          snippet: { title, channelTitle: "Chan &amp; Co" },
        })),
      });
    }
    if (method === "videos") {
      if (o.failVideos)
        return json(403, { error: { errors: [{ reason: "forbidden" }] } });
      return json(200, {
        items: params
          .get("id")!
          .split(",")
          .map((id) => ({
            id,
            statistics: { viewCount: String(o.views?.[id] ?? 0) },
          })),
      });
    }
    throw new Error(`unexpected ${method}`);
  };
  return { get, calls };
}

const vid = (n: number) => `vid${String(n).padStart(8, "0")}`;

test("one search.list a topic for this week's uploads by views, view counts batched across topics", async () => {
  const api = fakeApi({
    results: {
      Halo: [
        [vid(1), "Halo 3 is back"],
        [vid(2), "Halo &quot;Infinite&quot; news"],
      ],
      Skyrim: [[vid(3), "Skyrim in 2026"]],
    },
    views: { [vid(1)]: 400_000, [vid(2)]: 100_000, [vid(3)]: 900_000 },
  });
  const got = await demandApiSearch(["Halo", "Skyrim", "Halo"], {
    get: api.get,
    now: t0,
  });
  const searches = api.calls.filter((c) => c.startsWith("search?"));
  assert.equal(searches.length, 2, "a repeated topic is searched once");
  const p = new URLSearchParams(searches[0]!.split("?")[1]);
  assert.equal(p.get("order"), "viewCount");
  assert.equal(p.get("type"), "video");
  assert.equal(p.get("maxResults"), "20");
  assert.equal(
    p.get("publishedAfter"),
    "2026-11-19T12:00:00Z",
    "this week's uploads",
  );
  assert.equal(
    api.calls.filter((c) => c.startsWith("videos?")).length,
    1,
    "one videos.list for both topics",
  );
  assert.deepEqual(got.get("Halo"), [
    {
      videoId: vid(1),
      views: 400_000,
      channel: "Chan & Co",
      title: "Halo 3 is back",
    },
    {
      videoId: vid(2),
      views: 100_000,
      channel: "Chan & Co",
      title: 'Halo "Infinite" news',
    },
  ]);
  assert.equal(
    scoreDemand("Skyrim", got.get("Skyrim") as SearchRow[], 20_000, t0).views,
    900_000,
  );
});

test("more than 50 videos split into 50-video videos.list calls, each charged one unit", async () => {
  const results: Record<string, [string, string][]> = {};
  for (let t = 0; t < 3; t++)
    results[`Game ${t}`] = Array.from({ length: 20 }, (_, i) => [
      vid(t * 100 + i),
      `Game ${t} clip`,
    ]);
  const api = fakeApi({ results });
  const charged: number[] = [];
  await demandApiSearch(Object.keys(results), {
    get: api.get,
    now: t0,
    charge: async (u) => void charged.push(u),
  });
  const videos = api.calls.filter((c) => c.startsWith("videos?"));
  assert.equal(videos.length, 2, "60 videos: two calls");
  assert.deepEqual(charged, [1, 1]);
});

test("a quota answer stops the run's searches; a failed search is an Error, never an empty list; the key is never in it", async () => {
  const api = fakeApi({
    results: { B: [[vid(1), "B"]] },
    failSearch: { A: { status: 403, reason: "quotaExceeded" } },
  });
  const got = await demandApiSearch(["A", "B"], { get: api.get, now: t0 });
  assert.equal(api.calls.length, 1, "nothing asked after the quota answer");
  assert.ok(got.get("A") instanceof Error);
  assert.ok(got.get("B") instanceof Error);
  assert.match(
    (got.get("A") as Error).message,
    /search HTTP 403 quotaExceeded/,
  );
  assert.doesNotMatch((got.get("A") as Error).message, /key=/);

  const refused = fakeApi({ results: { A: [[vid(1), "A"]] } });
  const none = await demandApiSearch(["A"], {
    get: refused.get,
    now: t0,
    allowSearch: async () => false,
  });
  assert.equal(
    refused.calls.length,
    0,
    "the search bucket said no: no request",
  );
  assert.ok(none.get("A") instanceof Error);

  const noViews = fakeApi({
    results: { A: [[vid(1), "A"]] },
    failVideos: true,
  });
  const lost = await demandApiSearch(["A"], { get: noViews.get, now: t0 });
  assert.ok(
    lost.get("A") instanceof Error,
    "without view counts the reading is unknown, not zero",
  );
});

test("the day's allowance: 8 new topics, de-duplicated, cached a week, older readings before unknown, one log line a run", async (t) => {
  const db = await testDb();
  let clock = t0;
  const cache = dbDemandCache(db, () => clock);
  // The whole day's 8 in one run here (perRun 8); the default half-a-run share has its own test below.
  const budget = dbDemandBudget(db, 8, () => clock, 8);
  const names = Array.from({ length: 12 }, (_, i) => `Game ${i}`);
  const batches: string[][] = [];
  const searchMany = async (queries: string[]) => {
    batches.push(queries);
    return new Map<string, SearchRow[] | Error>(
      queries.map((q) => [
        q,
        [
          {
            videoId: vid(1),
            views: 300_000,
            channel: "c",
            title: `${q} review`,
          },
        ],
      ]),
    );
  };
  // An older reading of Game 11 from 9 days ago (past the week's cache, within DEMAND_STALE_DAYS).
  await cache.set("Game 11", {
    ...scoreDemand("Game 11", [], 20_000, new Date(t0.getTime() - 9 * day)),
  });
  const lines: string[] = [];
  t.mock.method(
    console,
    "log",
    (line: string) => void lines.push(String(line)),
  );
  const cands = [...names, "game 0 ", "Game 3"].map((name) => ({
    name,
    source: "seed",
  }));
  const o = {
    searchMany,
    budget,
    cache,
    lookups: 12,
    minViews: 20_000,
    staleDays: 10,
  };

  const first = await demandFor(cands, { ...o, now: clock });
  assert.deepEqual(
    batches,
    [names.slice(0, 8)],
    "one batch of the first 8 unique topics",
  );
  assert.equal(
    first.get("game 0 ")?.views,
    300_000,
    "a duplicate spelling shares its topic's reading",
  );
  assert.equal(
    first.get("Game 11")?.stale,
    true,
    "over the allowance: the older reading stands in",
  );
  assert.equal(
    first.has("Game 9"),
    false,
    "over the allowance with nothing older: unknown",
  );
  const summary = lines
    .map((l) => JSON.parse(l))
    .filter((l) => l.msg === "demand lookups");
  assert.equal(summary.length, 1, "one line a run, not one a topic");
  assert.deepEqual(
    { ...summary[0], t: undefined },
    {
      t: undefined,
      level: "info",
      msg: "demand lookups",
      topics: 12,
      cache: 0,
      api: 8,
      failed: 0,
      skipped: 4,
      stale: 1,
      unknown: 3,
    },
  );

  // Later the same Pacific day: the 8 come from the cache, the allowance is spent, nothing is asked.
  clock = new Date(t0.getTime() + 10 * 3600_000);
  await demandFor(cands, { ...o, now: clock });
  assert.equal(batches.length, 1, "no lookups over the day's allowance");
  // The next Pacific day: the 4 left are looked up; the 8 are still cached.
  clock = new Date(t0.getTime() + 1 * day);
  const third = await demandFor(cands, { ...o, now: clock });
  assert.deepEqual(batches[1], names.slice(8));
  assert.equal(third.get("Game 11")?.stale, undefined);
  // Six days on the readings are still fresh; eight days on they are looked up again.
  clock = new Date(t0.getTime() + 6 * day);
  await demandFor(cands, { ...o, now: clock });
  assert.equal(batches.length, 2, "a week's cache");
  clock = new Date(t0.getTime() + 8 * day);
  await demandFor(cands, { ...o, now: clock });
  assert.equal(batches[2]!.length, 8);
  assert.equal(CACHE_HOURS, 7 * 24);
  await db.close();
});

test("a failed batch counts as unknown or older, logs one warning, and nothing else is tried", async (t) => {
  const db = await testDb();
  const cache = dbDemandCache(db, () => t0);
  await cache.set(
    "Halo",
    scoreDemand("Halo", [], 20_000, new Date(t0.getTime() - 8 * day)),
  );
  let pages = 0;
  const lines: string[] = [];
  t.mock.method(
    console,
    "log",
    (line: string) => void lines.push(String(line)),
  );
  const got = await demandFor(
    [{ name: "Halo" }, { name: "Skyrim" }].map((c) => ({
      ...c,
      source: "seed",
    })),
    {
      ...demandSearchers({
        searchDemand: async () => {
          pages++;
          return [];
        },
        searchDemandMany: async () => {
          throw new Error("YouTube Data API search HTTP 403 quotaExceeded");
        },
      }),
      budget: dbDemandBudget(db, 8, () => t0),
      cache,
      lookups: 12,
      minViews: 20_000,
      now: t0,
      staleDays: 10,
    },
  );
  assert.equal(pages, 0, "the batched API search is preferred; no page search");
  assert.equal(got.get("Halo")?.stale, true);
  assert.equal(got.has("Skyrim"), false);
  const summary = lines
    .map((l) => JSON.parse(l))
    .filter((l) => l.msg === "demand lookups");
  assert.equal(summary.length, 1);
  assert.equal(summary[0].level, "warn");
  assert.equal(summary[0].failed, 2);
  assert.match(summary[0].error, /quotaExceeded/);
  await db.close();
});

test("one run takes at most half the day's allowance, so the first picker leaves some for the rest", async () => {
  const db = await testDb();
  const budget = dbDemandBudget(db, 8, () => t0);
  assert.equal(await budget.take(12), 4);
  assert.equal(await budget.take(12), 4);
  assert.equal(await budget.take(12), 0);
  await db.close();
});

test("lookups refused before their search was sent are given back to the day", async () => {
  const db = await testDb();
  const budget = dbDemandBudget(db, 8, () => t0, 8);
  const cache = dbDemandCache(db, () => t0);
  const api = fakeApi({ results: { Alpha: [[vid(1), "Alpha clip"]], Beta: [[vid(2), "Beta clip"]] }, views: { [vid(1)]: 50_000 } });
  let allowed = 1;
  const searchMany = (queries: string[]) =>
    demandApiSearch(queries, { get: api.get, now: t0, allowSearch: async () => allowed-- > 0 });
  const cands = ["Alpha", "Beta", "Gamma"].map((name) => ({ name, source: "seed" }));
  const got = await demandFor(cands, { searchMany, budget, cache, lookups: 12, minViews: 20_000, now: t0 });
  assert.equal(got.get("Alpha")?.views, 50_000);
  assert.equal(got.has("Beta"), false);
  assert.equal(api.calls.filter((c) => c.startsWith("search?")).length, 1, "only the allowed search was sent");
  assert.equal(await budget.take(8), 7, "Beta and Gamma went back: one of the 8 is spent");
  // A batch that throws before asking spends nothing either.
  const db2 = await testDb();
  const budget2 = dbDemandBudget(db2, 8, () => t0, 8);
  await demandFor(cands, {
    searchMany: async () => {
      throw new Error("no login");
    },
    budget: budget2,
    cache: dbDemandCache(db2, () => t0),
    lookups: 12,
    minViews: 20_000,
    now: t0,
  });
  assert.equal(await budget2.take(8), 8);
  await db.close();
  await db2.close();
});

test("a doc pick prefetches its candidates in one batch and one log line; an older reading counts as unknown", async (t) => {
  const db = await testDb();
  const batches: string[][] = [];
  const services = {
    db,
    cfg: { demandApiPerDay: 8, demandCacheDays: 7, demandStaleDays: 21 },
    searchDemand: async () => {
      throw new Error("the batched search should be used");
    },
    searchDemandMany: async (queries: string[]) => {
      batches.push(queries);
      return new Map<string, SearchRow[] | Error>(
        queries.map((q) => [q, [{ videoId: vid(1), views: 500_000, channel: "c", title: `${q} documentary` }]]),
      );
    },
  };
  const lines: string[] = [];
  t.mock.method(console, "log", (line: string) => void lines.push(String(line)));
  const lookup = docDemandLookup(services, () => t0)!;
  await lookup.prefetch!(["Half-Life", "Fallout 76", "Half-Life"]);
  assert.deepEqual(batches, [["Half-Life", "Fallout 76"]]);
  assert.equal((await lookup("Fallout 76"))?.views, 500_000);
  assert.equal(batches.length, 1, "read from the prefetch");
  assert.equal(lines.filter((l) => JSON.parse(l).msg === "demand lookups").length, 1);
  const cand = { subject: "Okami", angle: "" } as Parameters<typeof scoreCandidate>[0];
  const none = { query: "Okami", views: 0, hits: 0, level: "none" as const, at: "2026-11-10T00:00:00.000Z" };
  const score = (demand?: typeof none & { stale?: boolean }) => scoreCandidate(cand, { ...emptySignals(cand), demand }, t0).parts.demand;
  assert.equal(score({ ...none, stale: true }), score(undefined), "an older none reads as unknown");
  assert.ok(score(none) < score(undefined), "a fresh none still counts against");
  await db.close();
});

test("the allowance is per Pacific day and never grants past the cap", async () => {
  const db = await testDb();
  let clock = new Date("2026-11-26T07:30:00Z"); // 25 Nov, 23:30 Pacific
  const budget = dbDemandBudget(db, 8, () => clock, 8);
  assert.equal(await budget.take(5), 5);
  assert.equal(await budget.take(5), 3);
  assert.equal(await budget.take(1), 0);
  clock = new Date("2026-11-26T08:30:00Z"); // 26 Nov, 00:30 Pacific
  assert.equal(await budget.take(10), 8);
  assert.equal(
    await dbDemandBudget(db, 0, () => clock).take(3),
    0,
    "0 turns new lookups off",
  );
  await db.close();
});

test("the services' demand search never runs yt-dlp and makes no network call in tests", async () => {
  await assert.rejects(
    demandSearcher(await testDb(), loadConfig())(["Halo"]),
    /no YouTube Data API calls in tests/,
  );
  const src = fs.readFileSync(
    new URL("../src/services.ts", import.meta.url),
    "utf8",
  );
  const block = src.slice(
    src.indexOf("searchDemandMany:"),
    src.indexOf("searchDemandMany:") + 600,
  );
  assert.doesNotMatch(block, /runCapped|yt-dlp|ytdlpPath/);
  const cfg = loadConfig();
  assert.equal(cfg.demandApiPerDay, 8);
  assert.equal(cfg.demandCacheDays, 7);
});

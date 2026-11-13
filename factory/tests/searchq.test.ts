import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { goodScript, testConfig, testDb, tmpDir } from "./helpers.ts";
import {
  parseSearchFacts,
  parseSearchGames,
  searchCapFor,
  searchShortsSettings,
  searchShortsSummary,
} from "../src/searchq/settings.ts";
import {
  harvest,
  parseSuggestions,
  seedPhrases,
  suggestUrl,
  type Observation,
} from "../src/searchq/harvest.ts";
import {
  askPlayNotes,
  guidePlayNotes,
  parseFacts,
} from "../src/searchq/facts.ts";
import {
  answerability,
  coveredBy,
  distinctAsks,
  freshnessOf,
  intentOf,
  makeable,
  nameForms,
  queryKey,
  rankQueries,
  refusal,
  searchSlug,
  searchTitle,
  searchTitleProblems,
  updateHistory,
  withPlaceholder,
} from "../src/searchq/rank.ts";
import { searchBrief, searchTitleFor } from "../src/searchq/brief.ts";
import {
  maybeSelectSearch,
  searchCluster,
  searchSlotDue,
  writeSearchSample,
} from "../src/searchq/step.ts";
import { searchShareLine } from "../src/searchq/report.ts";
import { queriesHtml, writeQueries } from "../src/searchq/store.ts";
import { newsMadeToday, slotLabel } from "../src/cadence.ts";
import { dayKey } from "../src/lanes.ts";
import type { Llm } from "../src/editorial/llm.ts";

const GTA = "Grand Theft Auto VI";
const FACTS_MD = fs.readFileSync(
  path.join(import.meta.dirname, "..", "guide_facts_gta6.md"),
  "utf8",
);
const facts = parseFacts(FACTS_MD);

const obs = (
  query: string,
  rank = 0,
  source: Observation["source"] = "youtube",
  seed = "gta 6",
  game = GTA,
): Observation => ({
  game,
  query,
  rank,
  source,
  seed,
  at: "2026-11-12T20:00:00.000Z",
});

test("settings: off by default, games with their unlock, facts beside the factory, the launch week's allowance", () => {
  const s = searchShortsSettings({}, "/f");
  assert.equal(s.enabled, false);
  assert.deepEqual(s.games, [
    { name: GTA, release: "2026-11-18T11:00:00.000Z" },
  ]);
  assert.equal(s.facts[GTA], path.resolve("/f", "guide_facts_gta6.md"));
  assert.deepEqual(s.slots, ["15:00", "20:00"]);
  assert.equal(searchShortsSummary(s), "off");
  assert.deepEqual(parseSearchGames("Battlefield 6; GTA 6@nonsense ;x"), [
    { name: "Battlefield 6", release: "" },
    { name: "GTA 6", release: "" },
  ]);
  assert.deepEqual(parseSearchFacts("A=a.md;bad;B=/abs/b.md", "/f"), {
    A: path.resolve("/f", "a.md"),
    B: "/abs/b.md",
  });
  assert.equal(searchCapFor(s, "2026-11-17"), 1);
  assert.equal(searchCapFor(s, "2026-11-18"), 2);
  assert.equal(searchCapFor(s, "2026-11-25"), 2);
  assert.equal(searchCapFor(s, "2026-11-26"), 1);
  const on = searchShortsSettings({
    SEARCH_SHORTS: "true",
    SEARCH_SLOTS: "20:00,bad,14:30",
    SEARCH_PER_DAY: "9",
  });
  assert.deepEqual(on.slots, ["14:30", "20:00"]);
  assert.equal(on.perDay, 6, "clamped");
  assert.match(searchShortsSummary(on), /^on \(Grand Theft Auto VI/);
});

test("seeds: the search names and question stems, each phrase with its own sites, no run of initials", () => {
  const gta = seedPhrases(GTA);
  assert.ok(gta.some((p) => p.phrase === "gta 6"));
  assert.ok(gta.some((p) => p.phrase === "is gta 6 worth it"));
  assert.ok(gta.some((p) => p.phrase === "gta 6 can you"));
  const ddgOnly = gta.find((p) => p.phrase === "what is gta 6");
  assert.deepEqual(ddgOnly?.sources, ["ddg"]);
  // One phrase gaining DuckDuckGo never gives it to the others (a shared list once sent everything everywhere).
  assert.deepEqual(gta.find((p) => p.phrase === "gta 6 best")?.sources, [
    "youtube",
    "google",
  ]);
  assert.deepEqual(gta.find((p) => p.phrase === "is gta 6")?.sources, [
    "youtube",
    "google",
    "ddg",
  ]);
  assert.ok(!seedPhrases(GTA, false).some((p) => p.sources.includes("ddg")));
  const mw = seedPhrases("Call of Duty: Modern Warfare 4").map((p) => p.phrase);
  assert.ok(mw.includes("modern warfare 4 how to"));
  assert.ok(
    !mw.some((p) => p.includes("codmw")),
    "five initials are nobody's search",
  );
  assert.match(suggestUrl("youtube", "gta 6"), /ds=yt&.*q=gta%206$/);
  assert.doesNotMatch(suggestUrl("google", "gta 6"), /ds=yt/);
  assert.match(
    suggestUrl("ddg", "is gta 6"),
    /^https:\/\/duckduckgo\.com\/ac\/\?q=is%20gta%206/,
  );
});

test("suggestions: both answer shapes, anything else is nothing", () => {
  assert.deepEqual(parseSuggestions('["gta 6",["gta 6 map","gta 6 price"]]'), [
    "gta 6 map",
    "gta 6 price",
  ]);
  assert.deepEqual(
    parseSuggestions(
      '[{"phrase":"is gta 6 out"},{"phrase":"is gta 6 worth it"}]',
    ),
    ["is gta 6 out", "is gta 6 worth it"],
  );
  assert.deepEqual(parseSuggestions("<html>"), []);
});

test("harvest: one request at a time per site with a pause, a refusing site left alone, the cap shared between games", async () => {
  const urls: string[] = [];
  const sleeps: number[] = [];
  const fetchFn = async (url: string) => {
    urls.push(url);
    if (url.includes("duckduckgo"))
      return new Response("busy", { status: 429 });
    const q = decodeURIComponent(url.split("q=")[1]!);
    return new Response(JSON.stringify([q, [`${q} map`, `${q} price`]]), {
      status: 200,
    });
  };
  const r = await harvest([GTA, "Battlefield 6"], {
    fetchFn,
    rateMs: 1000,
    maxRequests: 60,
    sleep: async (ms) => void sleeps.push(ms),
    now: () => new Date("2026-11-12T20:00:00Z"),
  });
  assert.equal(r.requests, 60);
  assert.deepEqual(r.refused, ["ddg"]);
  assert.equal(
    urls.filter((u) => u.includes("duckduckgo")).length,
    1,
    "asked once, then left alone",
  );
  assert.ok(sleeps.length > 0 && sleeps.every((ms) => ms <= 1000));
  const games = new Set(r.observations.map((o) => o.game));
  assert.deepEqual(
    [...games].sort(),
    ["Battlefield 6", GTA],
    "both games got their turn under the cap",
  );
  assert.ok(
    r.observations.some(
      (o) => o.query === "gta 6 map" && o.rank === 0 && o.source === "youtube",
    ),
  );
});

test("facts: confirmed lines with their links, the reported section as rumour, the same post's link borrowed", () => {
  assert.ok(facts.length >= 10);
  const release = facts.find((f) => /^Release/.test(f.text))!;
  assert.equal(release.rumour, false);
  assert.equal(release.source, "Rockstar Support");
  assert.match(release.urls[0]!, /^https:\/\/support\.rockstargames\.com/);
  assert.doesNotMatch(release.text, /https?:/);
  const pc = facts.find((f) => /^PC/.test(f.text))!;
  assert.equal(pc.rumour, true);
  const boxed = facts.find((f) => /^Boxed/.test(f.text))!;
  assert.equal(
    boxed.urls[0],
    facts.find((f) => /^Pre-load/.test(f.text))!.urls[0],
    "the post on the line above",
  );
  assert.ok(boxed.urls.some((u) => u.includes("store.rockstargames.com")));
  const gi = facts.find((f) => /Game Informer/.test(f.text))!;
  assert.deepEqual(gi.urls, []);
  assert.match(gi.source, /press/i);
});

test("play notes: the guide plan's lines and the asks the owner's streams settled, for that game only", () => {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const plan = {
    game: GTA,
    guides: [
      {
        key: "early-money",
        play_notes: ["The Vice Beach car wash pays $300 a run (19 Nov stream)"],
      },
    ],
  };
  assert.equal(guidePlayNotes(plan, GTA, same).length, 1);
  assert.equal(guidePlayNotes(plan, "Battlefield 6", same).length, 0);
  const store = {
    asks: [
      {
        game: GTA,
        question: "Can you swim?",
        status: "proved",
        verdict: {
          result: "proved",
          reason: "swam to the island",
          recordedOn: "2026-11-19",
          at: 812.4,
        },
      },
      { game: GTA, question: "Can you fly a jet?", status: "open" },
    ],
  };
  const notes = askPlayNotes(store, GTA, same);
  assert.equal(notes.length, 1);
  assert.match(notes[0]!.text, /^Can you swim\? Yes: swam to the island/);
  assert.match(notes[0]!.from, /2026-11-19 at 812 s/);
});

test("clustering: the game's spellings and the same ask's phrasings are one query", () => {
  const forms = nameForms(GTA);
  assert.ok(
    forms.includes("gta 6") &&
      forms.includes("gta vi") &&
      forms.includes("gta6"),
  );
  assert.equal(
    withPlaceholder("Is GTA VI worth it?", forms),
    "is {g} worth it",
  );
  assert.equal(withPlaceholder("red dead 2 map", forms), undefined);
  const key = (q: string) => queryKey(withPlaceholder(q, forms)!);
  assert.equal(key("when does gta 6 come out"), key("gta 6 release date"));
  assert.equal(key("how long until gta 6 comes out"), key("gta vi release"));
  assert.equal(key("gta 6 preload"), key("gta 6 pre load"));
  assert.equal(key("can you play gta 6 on ps4"), key("can you gta 6 on ps4"));
  assert.notEqual(key("gta 6 price"), key("gta 6 ps5 price"));
  assert.equal(
    intentOf("{g} how much gb", key("gta 6 how much gb"))?.id,
    "size",
  );
  assert.equal(
    intentOf("{g} how much fps", key("gta 6 how much fps"))?.id,
    "performance",
  );
  assert.equal(
    intentOf("why is {g} delayed", key("why is gta 6 delayed"))?.id,
    "why delayed",
  );
  assert.equal(
    intentOf("is {g} cross platform", key("is gta 6 cross platform"))?.id,
    "crossplay",
  );
});

test("refusals: leaks, cheats and piracy never; story spoilers never", () => {
  assert.match(refusal("gta 6 leaked map")!, /never courted/);
  assert.match(refusal("gta 6 cheats ps5")!, /never courted/);
  assert.match(refusal("gta 6 ending explained")!, /spoiler/);
  assert.match(refusal("does lucia die in gta 6")!, /spoiler/);
  assert.equal(refusal("gta 6 pre order"), undefined);
});

test("answerable: a confirmed line answers, a reported one only labelled, play only after launch", () => {
  const forms = nameForms(GTA);
  const q = (s: string) => {
    const held = withPlaceholder(s, forms)!;
    const key = queryKey(held);
    return { intent: intentOf(held, key), key };
  };
  const price = q("how much is gta 6");
  const a = answerability(price.intent, price.key, facts, [], false);
  assert.equal(a.kind, "facts");
  assert.equal(a.answerable, 1);
  assert.ok(a.facts.some((f) => f.text.includes("$79.99")));
  const pc = q("is gta 6 on pc");
  const b = answerability(pc.intent, pc.key, facts, [], false);
  assert.equal(b.rumour, true);
  assert.equal(b.answerable, 0.6);
  const swim = q("can you swim in gta 6");
  assert.equal(
    answerability(swim.intent, swim.key, facts, [], false).answerable,
    0,
  );
  const note = [
    {
      game: GTA,
      text: "Can you swim? Yes: swam to the island",
      from: "stream",
    },
  ];
  const after = answerability(swim.intent, swim.key, facts, note, true);
  assert.equal(after.kind, "play");
  assert.equal(after.playNotes.length, 1);
  const worth = q("is gta 6 worth it");
  assert.equal(
    answerability(worth.intent, worth.key, facts, [], false).kind,
    "press",
  );
});

test("titles: the searcher's words, the game as people type it, inside the house rules", () => {
  assert.equal(
    searchTitle("how much is gta 6 pre order", GTA),
    "How Much Is GTA 6 Pre-Order?",
  );
  assert.equal(searchTitle("gta vi release date", GTA), "GTA 6 Release Date");
  assert.equal(
    searchTitle("does gta 6 have a disc", GTA),
    "Does GTA 6 Have a Disc?",
  );
  assert.deepEqual(
    searchTitleProblems(
      "Does GTA 6 Have a Disc? No, Here's Why",
      "does gta 6 have a disc",
      GTA,
    ),
    [],
  );
  const p = searchTitleProblems(
    "Rockstar Confirms No Disc",
    "does gta 6 have a disc",
    GTA,
  );
  assert.ok(p.some((x) => /searcher's own words/.test(x)));
  assert.ok(p.some((x) => /name the game/.test(x)));
  assert.ok(
    searchTitleProblems("GTA 6: Disc Details!", "gta 6 disc", GTA).some((x) =>
      /colon/.test(x),
    ),
  );
  assert.ok(
    searchTitleProblems(
      "GTA 6 Disc: Everything You Need, the Complete Story",
      "gta 6 disc",
      GTA,
    ).some((x) => /complete/i.test(x)),
  );
  assert.deepEqual(
    searchTitleProblems(
      "Is GTA 6 Ultimate Edition Worth It?",
      "is gta 6 ultimate edition worth it",
      GTA,
    ),
    [],
  );
});

test("covered: a Pulse title or planned topic that answers the query covers it", () => {
  const covered = [
    "Why does GTA 6's box have no disc inside?",
    "Will GTA 6 fit on your console?",
  ];
  assert.equal(coveredBy("why is gta 6 not on disc", GTA, covered), covered[0]);
  assert.equal(coveredBy("gta 6 pre order", GTA, covered), undefined);
  assert.equal(
    coveredBy("battlefield 6 disc", "Battlefield 6", covered),
    undefined,
    "another game's title",
  );
});

test("freshness: the baseline is neutral, a query new since the first harvest is fresh, a launch days away adds", () => {
  const now = new Date("2026-11-12T20:00:00Z");
  assert.equal(freshnessOf(undefined, undefined, now, false), 0.5);
  assert.equal(
    freshnessOf("2026-11-10T00:00:00Z", "2026-11-10T00:00:00Z", now, false),
    0.5,
    "seen in the first harvest",
  );
  assert.equal(
    freshnessOf("2026-11-12T08:00:00Z", "2026-11-10T00:00:00Z", now, false),
    1,
  );
  assert.ok(
    freshnessOf("2026-10-20T08:00:00Z", "2026-10-01T00:00:00Z", now, false) <
      0.4,
  );
  assert.equal(freshnessOf(undefined, undefined, now, true), 0.8);
});

test("ranking: demand, freshness and answerable; duplicates merged; refused, covered and unanswerable left out", () => {
  const now = new Date("2026-11-12T20:00:00Z");
  const observations = [
    obs("gta 6 pre order", 0),
    obs("gta 6 pre order", 1, "google"),
    obs("gta 6 preorder", 3, "google", "gta 6 p"),
    obs("does gta 6 have a disc", 2),
    obs("can you swim in gta 6", 0),
    obs("gta 6 leaked map", 0),
    obs("gta 6 ending", 0),
    obs("is gta 6 on pc", 4),
    obs("will gta 6 fit on your console", 1),
    obs("red dead redemption 2", 0),
    obs("gta 6", 0),
  ];
  const ranked = rankQueries(observations, {
    now,
    facts: { [GTA]: facts },
    notes: {},
    releases: { [GTA]: "2026-11-18T11:00:00Z" },
    covered: ["Will GTA 6 fit on your console?"],
  });
  const pre = ranked.find((r) => r.key === "preorder")!;
  assert.equal(pre.query, "gta 6 pre order", "the best-placed wording");
  assert.deepEqual(pre.variants, ["gta 6 pre order", "gta 6 preorder"]);
  assert.deepEqual(pre.sources.sort(), ["google", "youtube"]);
  assert.equal(pre.dropped, undefined);
  assert.equal(ranked[0], pre, "the best makeable query first");
  assert.ok(
    pre.score > ranked.find((r) => r.query === "does gta 6 have a disc")!.score,
  );
  assert.equal(
    ranked.find((r) => r.query.includes("swim"))!.dropped,
    "needs the owner's play (after launch)",
  );
  assert.match(
    ranked.find((r) => r.query.includes("leaked"))!.dropped!,
    /never courted/,
  );
  assert.match(
    ranked.find((r) => r.query.includes("ending"))!.dropped!,
    /spoiler/,
  );
  assert.equal(
    ranked.find((r) => r.query.includes("fit"))!.dropped,
    "already covered by Pulse",
  );
  assert.ok(ranked.find((r) => r.query === "is gta 6 on pc")!.rumour);
  assert.ok(
    !ranked.some((r) => r.query.includes("red dead") || r.query === "gta 6"),
    "other games and the bare name",
  );
  // Kept queries first, then the rest.
  const firstOut = ranked.findIndex((r) => r.dropped);
  assert.ok(ranked.slice(firstOut).every((r) => r.dropped));
  const hist = updateHistory(undefined, ranked, [GTA], now);
  assert.equal(hist.harvests[GTA], 1);
  assert.equal(hist.started?.[GTA], now.toISOString());
  assert.equal(hist.seen[`${GTA}|preorder`]?.first, "2026-11-12T20:00:00.000Z");
});

test("makeable: over the bar, not made, not the same ask as a recent one; distinct asks for a batch", () => {
  const now = new Date("2026-11-12T20:00:00Z");
  const ranked = rankQueries(
    [
      obs("gta 6 pre order", 0),
      obs("how much is gta 6 pre order", 0),
      obs("does gta 6 have a disc", 0),
      obs("gta 6 price", 1),
    ],
    {
      now,
      facts: { [GTA]: facts },
      notes: {},
      releases: { [GTA]: "2026-11-18T11:00:00Z" },
      covered: [],
    },
  );
  const all = makeable(ranked, 45);
  assert.ok(all.length >= 3);
  assert.ok(
    !makeable(ranked, 45, [searchSlug(GTA, "preorder")]).some(
      (q) => q.key === "preorder",
    ),
  );
  assert.ok(
    !makeable(ranked, 45, [], [`${GTA}|preorder`]).some(
      (q) => q.intent === "preorder",
    ),
  );
  const two = distinctAsks(all, 2);
  assert.equal(two.length, 2);
  assert.notEqual(two[0]!.intent, two[1]!.intent);
  assert.equal(makeable(ranked, 101).length, 0);
});

test("the story: official links, the lines themselves, a brief that answers first and a title that keeps the words", () => {
  const now = new Date("2026-11-12T20:00:00Z");
  const [q] = rankQueries([obs("how much is gta 6 on ps5", 0)], {
    now,
    facts: { [GTA]: facts },
    notes: {},
    releases: { [GTA]: "2026-11-18T11:00:00Z" },
    covered: [],
  });
  const c = searchCluster(q!, now, true);
  assert.match(c.hash, /^search:gta-6-/);
  assert.equal(c.gameHint, GTA);
  assert.equal(c.run, true);
  assert.equal(c.corroborated, true);
  assert.equal(c.search?.ownFootage, true);
  assert.ok(
    c.items.some(
      (i) =>
        i.url.includes("take2games.com") &&
        i.sourceKind === "official" &&
        i.summary.includes("$79.99"),
    ),
  );
  const file = c.items.find((i) => i.source === "Pulse fact file")!;
  assert.match(file.summary, /\$79\.99/);
  assert.doesNotMatch(
    file.summary,
    /Other confirmed facts/,
    "no context given",
  );
  // With the game's other confirmed lines, the check can see a date that contradicts them (pre-load from 10 Nov).
  const withContext = searchCluster(q!, now, true, facts).items.find(
    (i) => i.source === "Pulse fact file",
  )!;
  assert.match(
    withContext.summary,
    /Other confirmed facts[\s\S]*Pre-load from 10 Nov/,
  );
  assert.doesNotMatch(
    withContext.summary,
    /REPORTED, NOT CONFIRMED: PC/,
    "rumours stay out of the context",
  );
  const brief = searchBrief(c.search!, GTA);
  assert.match(brief, /"how much is gta 6 on ps5"/);
  assert.match(brief, /answer itself inside the first three seconds/);
  assert.match(brief, /never guess/);
  assert.match(brief, /"GTA 6"/);
  assert.equal(
    searchTitleFor("Rockstar Sets the Price", c.search!, GTA),
    c.search!.title,
  );
  assert.equal(
    searchTitleFor("How Much Is GTA 6 on PS5? $79.99", c.search!, GTA),
    "How Much Is GTA 6 on PS5? $79.99",
  );
});

test("a sample script goes through the writer and the fact check on the search sites", async () => {
  const now = new Date("2026-11-12T20:00:00Z");
  const [q] = rankQueries([obs("does gta 6 have a disc", 0)], {
    now,
    facts: { [GTA]: facts },
    notes: {},
    releases: { [GTA]: "2026-11-18T11:00:00Z" },
    covered: [],
  });
  const cluster = searchCluster(q!, now, false);
  const sites: string[] = [];
  const prompts: string[] = [];
  const llm = {
    structured: async (o: any): Promise<any> => {
      sites.push(o.site ?? "");
      prompts.push(String(o.content));
      if (o.site === "search.check")
        return {
          verdict: "pass",
          issues: [],
          rumour_labelling_ok: true,
          summary: "ok",
        };
      return goodScript({
        game_title: GTA,
        headline: "No Disc in the GTA 6 Box",
        youtube: {
          title: "Rockstar Explains the Box",
          description: "From Rockstar's own post.",
          tags: [],
        },
      });
    },
  };
  const read = async (url: string) =>
    url.includes("rockstargames")
      ? {
          url,
          title: "Pre-load",
          text: "Boxed copies are a download code, no disc.",
        }
      : undefined;
  const r = await writeSearchSample(llm, cluster, read, now);
  assert.deepEqual(sites, ["search.write", "search.check"]);
  assert.match(
    prompts[0]!,
    /This Short answers one search, in the searcher's own words: "does gta 6 have a disc"/,
  );
  assert.match(prompts[0]!, /download code/);
  assert.equal(r.verdict, "pass");
  assert.equal(
    r.title,
    "Does GTA 6 Have a Disc?",
    "the planned title replaced one that dropped the words",
  );
  assert.ok(r.sources.some((x) => x.read));
  assert.ok(
    r.sources.some((x) => x.source === "Pulse fact file" && !x.read),
    "the fact file is never fetched",
  );
  assert.match(r.markdown.join("\n"), /\*\*Hook:\*\*/);
});

test("the lane: a search slot takes the best makeable query, within the day's allowance, apart from the news cap", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const now = new Date();
  const slotAt = new Date(now.getTime() + 60 * 60_000);
  const hhmm = slotLabel(slotAt, "Europe/London");
  const settings = {
    ...searchShortsSettings({
      SEARCH_SHORTS: "true",
      SEARCH_SLOTS: hhmm,
      SEARCH_PER_DAY: "1",
      SEARCH_PER_DAY_LAUNCH: "1",
    }),
  };
  const cfg = { ...testConfig(dir), searchShorts: settings };
  const ranked = rankQueries(
    [obs("gta 6 pre order", 0), obs("does gta 6 have a disc", 1)],
    {
      now,
      facts: { [GTA]: facts },
      notes: {},
      releases: { [GTA]: "2026-11-18T11:00:00Z" },
      covered: [],
    },
  );
  const deps = { db, cfg, now: () => now, ownFootage: async () => true };
  assert.equal(await maybeSelectSearch(deps), undefined, "no harvest yet");
  await writeQueries(path.join(dir, "search"), {
    harvestedAt: now.toISOString(),
    games: [GTA],
    requests: 2,
    failed: 0,
    refused: [],
    observations: 2,
    queries: ranked,
  });
  const due = await searchSlotDue(deps);
  assert.ok(due);
  assert.equal(slotLabel(due!, "Europe/London"), hhmm);
  const id = await maybeSelectSearch(deps);
  assert.ok(id);
  const [ep] = await db.query<{
    story_json: any;
    slot_at: string;
    lane: string;
  }>(`SELECT story_json, slot_at, lane FROM episodes WHERE id = $1`, [id]);
  assert.equal(ep!.lane, "news");
  assert.equal(ep!.story_json.search.query, "gta 6 pre order");
  assert.equal(ep!.story_json.search.ownFootage, true);
  assert.equal(
    dayKey(new Date(ep!.slot_at), "Europe/London"),
    dayKey(due!, "Europe/London"),
  );
  // The slot is taken and the day's one is made: nothing more today.
  assert.equal(await maybeSelectSearch(deps), undefined);
  // A search Short is not a news Short for the cap.
  assert.equal(await newsMadeToday(db, "Europe/London"), 0);
  // Off: nothing at all.
  assert.equal(
    await searchSlotDue({
      ...deps,
      cfg: { ...cfg, searchShorts: { ...settings, enabled: false } },
    }),
    undefined,
  );
});

test("the owner's page and the growth report line", async () => {
  const html = queriesHtml({
    harvestedAt: "2026-11-12T20:00:00.000Z",
    games: [GTA],
    requests: 1,
    failed: 0,
    refused: [],
    observations: 1,
    queries: rankQueries([obs("gta 6 <script> pre order", 0)], {
      now: new Date("2026-11-12T20:00:00Z"),
      facts: { [GTA]: facts },
      notes: {},
      releases: {},
      covered: [],
    }),
  });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(
    searchShareLine([
      { search: true, sources: { YT_SEARCH: 300, SHORTS: 700 } },
      { search: false, sources: { YT_SEARCH: 100, SHORTS: 1900 } },
      { search: false, sources: { SHORTS: 2000 } },
    ]),
    "🔎 **Search Shorts:** 30% of views from YouTube search (1 Short, 1,000 views) against 2.5% for the other Shorts (2, 4,000 views).",
  );
  assert.match(
    searchShareLine([{ search: false, sources: { YT_SEARCH: 1, SHORTS: 9 } }]),
    /none with traffic sources in yet/,
  );
});

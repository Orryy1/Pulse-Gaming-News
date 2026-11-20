import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { testConfig, testDb, tmpDir } from "./helpers.ts";
import { sizeStories, type SizedSighting } from "../src/discovery/storysize.ts";
import {
  applyChatter,
  chatterPoints,
  chatterTerms,
  parseTrends,
  postsPerHour,
  readChatter,
} from "../src/discovery/chatter.ts";
import {
  applyLaunches,
  launchesWithoutStory,
  readLaunches,
  type LaunchEntry,
} from "../src/discovery/launches.ts";
import {
  coveringEpisode,
  currentStories,
  forgetStories,
  judgeBigStories,
  refreshChatter,
  sendMissReport,
} from "../src/bigstories.ts";

const raw = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/sightings_2to4nov.json", import.meta.url),
    "utf8",
  ),
) as Array<{
  hash: string;
  items: Array<{ t: string; u: string; s: string; k: number; p: string }>;
}>;
const sightings: SizedSighting[] = raw.map((r) => ({
  hash: r.hash,
  cluster_json: {
    items: r.items.map((i) => ({
      title: i.t,
      url: i.u,
      summary: "",
      publishedAt: i.p,
      source: i.s,
      sourceKind: i.k ? ("official" as const) : ("outlet" as const),
    })),
  },
}));
const EVENING = new Date("2026-11-04T22:00:00Z");
const stories = sizeStories(sightings, EVENING, 30);
const TZ = "Europe/London";

test("chatter points: Bluesky rates measured on 5 Nov rank Ocarina over Dragon's Dogma", () => {
  assert.equal(chatterPoints({ blueskyPerHour: 139 }), 10);
  assert.equal(chatterPoints({ blueskyPerHour: 26 }), 6);
  assert.equal(chatterPoints({ blueskyPerHour: 8 }), 0);
  assert.equal(
    chatterPoints({
      blueskyPerHour: 200,
      trendsTraffic: 200000,
      youtubeViews: 5e6,
    }),
    15,
    "capped",
  );
  assert.equal(chatterPoints(undefined), 0);
});

test("chatter pushes a story the press has, never one it does not, and a stale read counts for nothing", () => {
  const gow = stories.find((s) => s.key === "god-of-war|delay")!;
  const small = stories.find((s) => s.entity === "dragons-dogma")!;
  const signal = {
    at: EVENING.toISOString(),
    entities: {
      "god-of-war": { blueskyPerHour: 150 },
      "dragons-dogma": { blueskyPerHour: 150 },
    },
  };
  const out = applyChatter(stories, signal, EVENING);
  assert.equal(out.find((s) => s.key === gow.key)!.size, gow.size + 10);
  assert.match(out.find((s) => s.key === gow.key)!.why, /chatter \+10/);
  if (small.outlets.length < 3)
    assert.equal(out.find((s) => s.key === small.key)!.size, small.size);
  const stale = applyChatter(
    stories,
    signal,
    new Date(EVENING.getTime() + 4 * 3_600_000),
  );
  assert.equal(stale.find((s) => s.key === gow.key)!.size, gow.size);
  assert.equal(applyChatter(stories, undefined, EVENING), stories);
});

test("chatter asks about at most eight games, the biggest first, one search each", () => {
  const terms = chatterTerms(stories);
  assert.ok(terms.length <= 8);
  assert.equal(new Set(terms.map((t) => t.entity)).size, terms.length);
  assert.ok(terms.some((t) => t.term === "God of War"));
});

test("reading sources: rates, the Trends feed and a failing source", async () => {
  const now = new Date("2026-11-05T12:00:00Z");
  assert.equal(
    postsPerHour(["2026-11-05T11:30:00Z", "2026-11-05T11:45:00Z"], now),
    4,
  );
  assert.equal(postsPerHour([], now), 0);
  const xml = `<rss><channel><title>Daily</title><item><title>stardew valley 1.7</title><ht:approx_traffic>500+</ht:approx_traffic></item><item><title>gta 6 reviews</title><ht:approx_traffic>200,000+</ht:approx_traffic></item></channel></rss>`;
  assert.deepEqual(parseTrends(xml), [
    { term: "stardew valley 1.7", traffic: 500 },
    { term: "gta 6 reviews", traffic: 200000 },
  ]);
  // YouTube's chart, with the other sources not asked for: no network at all.
  const s = await readChatter(
    [
      { entity: "gta", term: "GTA" },
      { entity: "halo", term: "Halo" },
    ],
    ["youtube"],
    now,
    async () => [
      { title: "GTA 6 launch trailer", views: 2_000_000, channel: "x" },
    ],
  );
  assert.deepEqual(s.entities, { gta: { youtubeViews: 2_000_000 } });
  const broken = await readChatter(
    [{ entity: "gta", term: "GTA" }],
    ["youtube"],
    now,
    async () => {
      throw new Error("down");
    },
  );
  assert.deepEqual(
    broken.entities,
    {},
    "a failed source adds nothing and stops nothing",
  );
});

test("the chatter read is at most hourly, off without sources, and reaches the sizes", async () => {
  const db = await testDb();
  const c = testConfig(await tmpDir(), {
    bigStoryMode: "report",
    chatterSources: ["youtube"],
  });
  await db.query(
    `INSERT INTO cluster_sightings (hash, headline, first_seen, last_seen, item_count, has_official, max_score, cluster_json)
     SELECT 'h' || g, 'x', $1, $1, 1, false, 1, $2::jsonb FROM generate_series(1, 1) g`,
    [
      EVENING,
      JSON.stringify(
        sightings.find((s) =>
          s.cluster_json.items.some((i) => /Laufey/.test(i.title)),
        )!.cluster_json,
      ),
    ],
  );
  let reads = 0;
  const read = (async (terms: Array<{ entity: string; term: string }>) => {
    reads++;
    return {
      at: EVENING.toISOString(),
      entities: Object.fromEntries(
        terms.map((t) => [t.entity, { blueskyPerHour: 150 }]),
      ),
    };
  }) as never;
  await refreshChatter(db, c, EVENING, async () => [], read);
  await refreshChatter(
    db,
    c,
    new Date(EVENING.getTime() + 10 * 60_000),
    async () => [],
    read,
  );
  assert.equal(reads, 1);
  await refreshChatter(
    db,
    c,
    new Date(EVENING.getTime() + 61 * 60_000),
    async () => [],
    read,
  );
  assert.equal(reads, 2);
  await refreshChatter(
    db,
    { ...c, chatterSources: [] },
    new Date(EVENING.getTime() + 180 * 60_000),
    async () => [],
    read,
  );
  assert.equal(reads, 2, "no sources, no read");
  await db.close();
});

const ocarina: LaunchEntry = {
  game: "The Legend of Zelda: Ocarina of Time",
  match: "ocarina of time",
  reviews: "2026-11-04",
  launch: "2026-11-05",
};

test("the calendar file parses and holds this autumn's two huge releases", () => {
  const file = new URL("../launches.json", import.meta.url);
  const list = readLaunches(file.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  assert.ok(list.some((e) => e.launch === "2026-11-19"));
  assert.ok(list.some((e) => e.launch === "2026-11-05"));
  assert.deepEqual(readLaunches("no-such-file.json"), []);
});

test("reviews day: Ocarina's review coverage from two outlets counts as huge", () => {
  const small = stories.map((s) =>
    s.key === "zelda|acclaim" ? { ...s, size: 40 } : s,
  );
  const out = applyLaunches(small, [ocarina], EVENING, TZ, 90);
  const a = out.find((s) => s.key === "zelda|acclaim")!;
  assert.equal(a.size, 90);
  assert.match(a.why, /reviews day/);
  const before = applyLaunches(
    small,
    [ocarina],
    new Date("2026-11-03T12:00:00Z"),
    TZ,
    90,
  );
  assert.equal(
    before.find((s) => s.key === "zelda|acclaim")!.size,
    40,
    "not the day before",
  );
});

test("launch day: one story from everything written about the game, made unless a Short today already covers it", () => {
  const launchDay = new Date("2026-11-05T09:00:00Z");
  const sized = sizeStories(sightings, launchDay, 36);
  const out = applyLaunches(sized, [ocarina], launchDay, TZ, 90);
  const launch = out.find((s) => s.key.includes("|launch:"))!;
  assert.ok(launch, "a launch-day story");
  assert.equal(
    launch.headline,
    "The Legend of Zelda: Ocarina of Time is out now",
  );
  assert.ok(launch.outlets.length >= 2);
  assert.ok(launch.items.every((i) => /ocarina of time/i.test(i.title)));
  const cfg = {
    bigStoryMode: "make" as "off" | "report" | "make",
    bigStorySize: 70,
    bigStoryHuge: 90,
    bigStoryMaxAgeHours: 36,
    bigStoryPerDay: 3,
    bigStoryBumps: [],
    bigStoryRetryHours: 6,
    breakingWindow: "07:00-03:00",
    timezone: TZ,
  };
  const ctx = {
    now: launchDay,
    episodes: [],
    run: [],
    rumoursToday: 0,
    rumourCap: 2,
    includeRumours: true,
    bigMadeToday: 0,
  };
  assert.equal(judgeBigStories([launch], cfg, ctx)[0]!.action, "make");
  const ep = (headline: string, created_at: string) => ({
    id: "e",
    lane: "news",
    status: "published",
    story_hash: "x",
    created_at,
    story_json: { headline },
  });
  // A release-times Short from days before is not the launch-day story; one from this morning is.
  assert.equal(
    coveringEpisode(launch, [
      ep("Ocarina of Time Remake Global Release Times", "2026-11-02T15:00:00Z"),
    ]),
    undefined,
  );
  assert.ok(
    coveringEpisode(launch, [
      ep(
        "Ocarina of Time Remake launches today on Switch 2",
        "2026-11-05T07:00:00Z",
      ),
    ]),
  );
  // Outside its window there is no such story.
  const after = applyLaunches(
    sized,
    [ocarina],
    new Date("2026-11-07T09:00:00Z"),
    TZ,
    90,
  );
  assert.equal(
    after.find((s) => s.key.includes("|launch:")),
    undefined,
  );
});

test("nothing is invented: with no articles on the day, the report says so", () => {
  const gta: LaunchEntry = {
    game: "Grand Theft Auto VI",
    match: "gta (6|vi)",
    reviews: "2026-11-18",
    launch: "2026-11-19",
  };
  const lines = launchesWithoutStory(
    [],
    [gta],
    new Date("2026-11-19T09:00:00Z"),
    TZ,
  );
  assert.ok(lines.some((l) => /launch day: too few articles/.test(l)));
  assert.deepEqual(
    applyLaunches([], [gta], new Date("2026-11-19T09:00:00Z"), TZ, 90),
    [],
  );
});

test("the evening report names a launch the feeds gave nothing for", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const file = `${dir}/launches.json`;
  fs.writeFileSync(
    file,
    JSON.stringify([
      { game: "Quiet Game", match: "quiet game", launch: "2026-11-04" },
    ]),
  );
  const c = testConfig(dir, {
    bigStoryMode: "report",
    launchCalendarFile: file,
  });
  forgetStories(db);
  assert.deepEqual(await currentStories(db, c, EVENING), []);
  const sent: string[] = [];
  await sendMissReport(
    db,
    c,
    EVENING,
    async (m) => void sent.push(m.content ?? ""),
  );
  assert.match(
    sent[0]!,
    /Launch calendar: Quiet Game launch day: too few articles/,
  );
  await db.close();
});

test("chatter can make a story big, never huge, and does not search ordinary words", () => {
  const gta = { ...stories[0]!, entity: "gta", size: 84, outlets: ["a", "b", "c"] };
  const out = applyChatter([gta], { at: EVENING.toISOString(), entities: { gta: { blueskyPerHour: 200, youtubeViews: 5e6 } } }, EVENING, 90);
  assert.equal(out[0]!.size, 89);
  const kept = applyChatter([{ ...gta, size: 95 }], { at: EVENING.toISOString(), entities: { gta: { blueskyPerHour: 200 } } }, EVENING, 90);
  assert.equal(kept[0]!.size, 95);
  assert.deepEqual(chatterTerms([{ ...gta, entity: "w:cloud", name: "Cloud" }]), []);
});

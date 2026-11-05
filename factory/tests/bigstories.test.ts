import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { testConfig, testDb, tmpDir } from "./helpers.ts";
import {
  isJunkTitle,
  knownEntity,
  sizeStories,
  storyEvent,
  type SizedSighting,
} from "../src/discovery/storysize.ts";
import {
  bigCluster,
  bigMadeToday,
  bumpFiller,
  fillerBumped,
  judgeBigStories,
  lateAngleNote,
  missReportLine,
  recordVerdicts,
  sendMissReport,
  type BigContext,
  type BigRecord,
  type CoverEpisode,
} from "../src/bigstories.ts";
import { newsMadeToday } from "../src/cadence.ts";
import { alertKind } from "../src/alertlog.ts";

// The real sightings of 2 to 4 Nov 2026, from a copy of the live database.
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
const find = (key: string) => {
  const s = stories.find((x) => x.key === key);
  assert.ok(s, `no story ${key}`);
  return s;
};

test("4 Nov: the stories everyone covered come out on top, each merged from its splits", () => {
  const gow = find("god-of-war|delay");
  assert.ok(gow.size >= 90, `God of War delay scored ${gow.size}`);
  assert.ok(gow.outlets.length >= 7, "seven or more independent outlets");
  assert.ok(gow.hashes.length >= 3, "merged from several sightings");
  const ocarina = find("zelda|acclaim");
  assert.ok(ocarina.size >= 70, `Ocarina's reviews scored ${ocarina.size}`);
  assert.ok(ocarina.hashes.length >= 3);
  assert.ok(
    ocarina.items.some((i) => /Metacritic/.test(i.title)),
    "the Metacritic story is part of it",
  );
  const arkane = find("w:arkane|business");
  assert.ok(arkane.size >= 70, `Arkane scored ${arkane.size}`);
  assert.ok(
    arkane.items.some((i) => /Ubisoft/.test(i.title)) &&
      arkane.items.some((i) => /union/i.test(i.title)),
    "the bid and the union statements are one story",
  );
});

test("junk the old score liked ranks below God of War: deals are out, the Dragon's Dogma collaboration is small", () => {
  const gow = find("god-of-war|delay");
  for (const s of stories)
    assert.ok(
      !/black friday/i.test(s.headline),
      `a deals post became a story: ${s.headline}`,
    );
  assert.ok(isJunkTitle("Best PlayStation Black Friday Deals For 2026"));
  assert.ok(
    isJunkTitle("PS Store Black Friday Sale Live Now with 2,200+ PS5 Games"),
  );
  assert.ok(
    isJunkTitle(
      "Last Chance to Save $10 on The Legend of Zelda: Ocarina of Time",
    ),
  );
  assert.ok(
    isJunkTitle(
      "Countdown: Zelda: Ocarina Of Time Dungeon Crawl #9 - The Grand Finale",
    ),
  );
  const dogma = stories.filter((s) => s.entity === "dragons-dogma");
  assert.ok(dogma.length > 0);
  for (const s of dogma) {
    assert.ok(s.size < 70, `Dragon's Dogma scored ${s.size}: ${s.headline}`);
    assert.ok(s.size < gow.size);
  }
});

test("reading real headlines: the franchise named first, and the kind of news", () => {
  assert.equal(
    knownEntity(
      "The Ocarina Of Time Remake Has Claimed 2026's Review Crown, But GTA 6 Could Have Something",
    )?.key,
    "zelda",
  );
  assert.equal(knownEntity("God of War Laufey Hit With Big Delay")?.tier, 1);
  assert.equal(
    storyEvent(
      "Ocarina Of Time Remake Tops Metacritic's GOTY List, And It's High On The All-Time Ranking",
    ),
    "acclaim",
  );
  assert.equal(
    storyEvent(
      "Round Up: The Reviews Are In For The Legend Of Zelda: Ocarina Of Time On Switch 2",
    ),
    "acclaim",
  );
  assert.equal(
    storyEvent("God of War Laufey delayed three months to May 2027"),
    "delay",
  );
  assert.equal(
    storyEvent("Ubisoft reportedly seeking to acquire Arkane Lyon from Xbox"),
    "business",
  );
  assert.equal(
    storyEvent("Phantom Blade Zero Sells 4 Million Copies in 72 Hours"),
    "commercial",
  );
  assert.equal(
    storyEvent("Grand Theft Auto VI pre-download begins November 10"),
    "release",
  );
});

test("Steam News is not a first-party source and does not count as an outlet", () => {
  const s = sizeStories(
    [
      {
        hash: "a",
        cluster_json: {
          items: [
            {
              title: "Pokemon reveals a new game",
              url: "https://store.steampowered.com/news/1",
              summary: "",
              publishedAt: "2026-11-04T10:00:00Z",
              source: "Steam News",
              sourceKind: "official",
            },
            {
              title: "Pokemon reveals a new game today",
              url: "https://ign.com/1",
              summary: "",
              publishedAt: "2026-11-04T10:00:00Z",
              source: "IGN",
              sourceKind: "outlet",
            },
          ],
        },
      },
    ],
    EVENING,
  );
  assert.equal(s[0]!.official, false);
  assert.deepEqual(s[0]!.outlets, ["IGN"]);
});

test("sister sites count once", () => {
  const item = (source: string, n: number) => ({
    title: `Halo studio reveals a new Halo game ${n}`,
    url: `https://x${n}.com/a`,
    summary: "",
    publishedAt: "2026-11-04T10:00:00Z",
    source,
    sourceKind: "outlet" as const,
  });
  const s = sizeStories(
    [
      {
        hash: "a",
        cluster_json: {
          items: [
            item("Push Square", 1),
            item("Pure Xbox", 2),
            item("Nintendo Life", 3),
            item("IGN", 4),
          ],
        },
      },
    ],
    EVENING,
  );
  assert.equal(s[0]!.outlets.length, 2);
});

const cfg = {
  bigStoryMode: "make" as "off" | "report" | "make",
  bigStorySize: 70,
  bigStoryHuge: 90,
  bigStoryMaxAgeHours: 36,
  bigStoryPerDay: 3,
  bigStoryBumps: ["deals", "spare", "evergreen", "why"],
  breakingWindow: "07:00-03:00",
  timezone: "Europe/London",
};
const ctx = (over: Partial<BigContext> = {}): BigContext => ({
  now: EVENING,
  episodes: [],
  run: [],
  rumoursToday: 0,
  rumourCap: 2,
  includeRumours: true,
  bigMadeToday: 0,
  ...over,
});
const episode = (
  over: Partial<CoverEpisode> & { headline: string },
): CoverEpisode => ({
  id: over.id ?? "ep1",
  lane: over.lane ?? "news",
  status: over.status ?? "published",
  story_hash: over.story_hash ?? "x",
  created_at: over.created_at ?? "2026-11-04T10:00:00Z",
  last_error: over.last_error ?? null,
  story_json: over.story_json ?? { headline: over.headline },
});

test("only one is made at a time, the biggest; the next waits and says so", () => {
  const v = judgeBigStories(stories, cfg, ctx());
  const make = v.filter((x) => x.action === "make");
  assert.equal(make.length, 1);
  assert.equal(make[0]!.story.key, "god-of-war|delay");
  assert.ok(
    v.some((x) => x.action === "held" && /next in line/.test(x.reason)),
  );
});

test("a story already covered by any lane counts as made, under a split hash or in other words", () => {
  const gow = find("god-of-war|delay");
  const byHash = judgeBigStories(
    [gow],
    cfg,
    ctx({
      episodes: [episode({ headline: "Anything", story_hash: gow.hashes[0]! })],
    }),
  );
  assert.equal(byHash[0]!.action, "made");
  const byWords = judgeBigStories(
    [gow],
    cfg,
    ctx({
      episodes: [episode({ headline: "God of War Laufey Slips to 2027" })],
    }),
  );
  assert.equal(byWords[0]!.action, "made");
  // Ocarina had a Short on 2 Nov about its launch celebrations; the reviews are still news.
  const other = judgeBigStories(
    [find("zelda|acclaim")],
    cfg,
    ctx({
      episodes: [
        episode({
          headline:
            "The Legend of Zelda: Ocarina of Time Remake Celebrations Continue Before Launch",
        }),
      ],
    }),
  );
  assert.equal(other[0]!.action, "make");
  // A failed Short covers nothing.
  const failed = judgeBigStories(
    [gow],
    cfg,
    ctx({
      episodes: [
        episode({
          headline: "God of War Laufey delayed",
          status: "failed",
          story_hash: gow.hashes[0]!,
        }),
      ],
    }),
  );
  assert.equal(failed[0]!.action, "make");
});

test("a topic in the launch run counts as planned, in its slot", () => {
  const run = JSON.parse(
    fs.readFileSync(new URL("../launch_run.json", import.meta.url), "utf8"),
  );
  const v = judgeBigStories(
    [find("god-of-war|delay"), find("zelda|acclaim")],
    cfg,
    ctx({ run, now: new Date("2026-11-05T09:00:00Z") }),
  );
  assert.deepEqual(
    v.map((x) => x.action),
    ["planned", "planned"],
    JSON.stringify(v.map((x) => x.reason)),
  );
  assert.match(v[0]!.reason, /18:30 on 2026-11-05/);
});

test("nothing holds a big story silently: each refusal names its reason", () => {
  const gow = find("god-of-war|delay");
  const why = (over: Partial<BigContext>, c: typeof cfg = cfg) =>
    judgeBigStories([gow], c, ctx(over))[0]!;
  assert.match(
    judgeBigStories([{ ...gow, size: 80 }], cfg, ctx({ bigMadeToday: 3 }))[0]!.reason,
    /BIG_STORY_PER_DAY/,
  );
  assert.equal(why({ bigMadeToday: 3 }).action, "make", "the ceiling never stops a huge story");
  assert.match(
    why({ blocked: "waiting: 2 Shorts are already in production" }).reason,
    /in production/,
  );
  assert.match(
    why({ now: new Date("2026-11-05T05:00:00Z") }).reason,
    /BREAKING_WINDOW/,
  );
  assert.match(
    why({}, { ...cfg, bigStoryMode: "report" as const }).reason,
    /BIG_STORY_MODE is report/,
  );
  assert.match(
    judgeBigStories([{ ...gow, leak: true }], cfg, ctx())[0]!.reason,
    /leaked or datamined/,
  );
  assert.match(
    judgeBigStories([{ ...gow, unsafe: true }], cfg, ctx())[0]!.reason,
    /advertiser safe/,
  );
  assert.match(
    judgeBigStories(
      [{ ...gow, rumour: true }],
      cfg,
      ctx({ rumoursToday: 2 }),
    )[0]!.reason,
    /rumour Shorts are already made/,
  );
});

test("the cap and the breaking allowance are not in the decision at all: a full day still makes it", () => {
  const gow = find("god-of-war|delay");
  const v = judgeBigStories([gow], cfg, ctx({ rumoursToday: 2 }));
  assert.equal(v[0]!.action, "make");
});

test("a second big Short on one game inside a day needs the huge size", () => {
  const elder = {
    ...find("god-of-war|delay"),
    key: "god-of-war|reveal",
    event: "reveal" as const,
    size: 80,
    hashes: ["z"],
  };
  const made = episode({
    headline: "God of War Laufey delayed",
    story_json: {
      headline: "God of War Laufey delayed",
      bigStory: {
        key: "god-of-war|delay",
        entity: "god-of-war",
        size: 110,
        event: "delay",
      },
    },
    created_at: "2026-11-04T18:00:00Z",
  });
  assert.match(
    judgeBigStories([elder], cfg, ctx({ episodes: [made] }))[0]!.reason,
    /a second needs size 90/,
  );
  assert.equal(
    judgeBigStories(
      [{ ...elder, size: 95 }],
      cfg,
      ctx({ episodes: [made] }),
    )[0]!.action,
    "make",
  );
});

test("a failed Short gets a second go under a new hash, then it is reported", () => {
  const gow = find("god-of-war|delay");
  const bad = (id: string) =>
    episode({
      id,
      headline: "God of War Laufey delayed",
      status: "failed",
      last_error: "render fell over",
      story_json: {
        headline: "God of War Laufey delayed",
        bigStory: {
          key: gow.key,
          entity: gow.entity,
          size: 110,
          event: "delay",
        },
      },
    });
  const second = judgeBigStories([gow], cfg, ctx({ episodes: [bad("a")] }))[0]!;
  assert.equal(second.action, "make");
  assert.equal(second.attempt, 2);
  assert.match(bigCluster(second, EVENING).hash, /:2$/);
  assert.match(
    judgeBigStories([gow], cfg, ctx({ episodes: [bad("a"), bad("b")] }))[0]!
      .reason,
    /failed 2 times \(render fell over\)/,
  );
});

test("late stories: made next chance with the angle moved on, fresh ones are not told they are late", () => {
  const gow = find("god-of-war|delay");
  const v = judgeBigStories(
    [gow],
    cfg,
    ctx({ now: new Date("2026-11-05T07:30:00Z") }),
  )[0]!;
  assert.equal(v.action, "make");
  const hours = bigCluster(v, new Date("2026-11-05T07:30:00Z")).bigStory
    ?.lateHours;
  assert.ok(hours && hours >= 12, `late by ${hours}`);
  assert.match(lateAngleNote(hours), /what has happened since/);
  assert.equal(lateAngleNote(undefined), "");
  const soon = new Date(new Date(gow.firstAt).getTime() + 3_600_000);
  assert.equal(bigCluster(v, soon).bigStory?.lateHours, undefined);
  // A story past the window has gone from the stories altogether, and the report keeps what happened to it.
  const later = sizeStories(sightings, new Date("2026-11-06T12:00:00Z"), 36);
  assert.equal(
    later.find((s) => s.key === "god-of-war|delay"),
    undefined,
  );
});

test("a big story carries all its sources, first-party first, and counts as corroborated", () => {
  const c = bigCluster(
    { story: find("god-of-war|delay"), action: "make", reason: "", attempt: 1 },
    EVENING,
  );
  assert.ok(c.items.length >= 7);
  assert.equal(c.corroborated, true);
  assert.equal(
    c.rumourSignals,
    false,
    "one outlet's hedge does not make it a rumour",
  );
  assert.match(c.hash, /^big:god-of-war\|delay:/);
  const ubisoft = find("w:arkane|business");
  assert.equal(typeof ubisoft.rumour, "boolean");
});

test("filler gives way one lane per big story, in order, and never past the list", () => {
  const order = ["deals", "spare", "evergreen", "why"];
  assert.equal(fillerBumped("deals", 0, order), false);
  assert.equal(fillerBumped("deals", 1, order), true);
  assert.equal(fillerBumped("evergreen", 1, order), false);
  assert.equal(fillerBumped("evergreen", 3, order), true);
  assert.equal(fillerBumped("why", 3, order), false);
  assert.equal(fillerBumped("news", 9, order), false);
});

const addBig = async (
  db: Awaited<ReturnType<typeof testDb>>,
  id: string,
  lane = "news_breaking",
) =>
  db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane) VALUES ($1, $1, 'scripted', $2, $3)`,
    [
      id,
      JSON.stringify({
        headline: "x",
        items: [],
        bigStory: { key: id, entity: "e", size: 90, event: "delay" },
      }),
      lane,
    ],
  );

test("big stories do not use up the cap, and each one takes a filler slot with one event a day", async () => {
  const db = await testDb();
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane) VALUES ('n1', 'n1', 'scripted', '{"headline":"x","items":[]}', 'news')`,
  );
  await addBig(db, "b1");
  assert.equal(await bigMadeToday(db, "Europe/London"), 1);
  assert.equal(
    await newsMadeToday(db, "Europe/London"),
    1,
    "the big one is not counted",
  );
  const c = testConfig(await tmpDir(), { bigStoryMode: "make" });
  const now = new Date();
  assert.equal(await bumpFiller(db, c, "deals", now), true);
  assert.equal(await bumpFiller(db, c, "deals", now), true);
  assert.equal(await bumpFiller(db, c, "evergreen", now), false);
  const ev = await db.query(
    `SELECT detail FROM events WHERE kind = 'filler_bumped'`,
  );
  assert.equal(ev.length, 1, "one event a day");
  c.bigStoryMode = "report";
  assert.equal(
    await bumpFiller(db, c, "deals", now),
    false,
    "report mode changes nothing",
  );
  await db.close();
});

test("every hold is a log and an event, once per change, and the evening line says exactly why", async () => {
  const db = await testDb();
  const c = testConfig(await tmpDir(), { bigStoryMode: "make" });
  const gow = find("god-of-war|delay");
  const held = {
    story: gow,
    action: "held" as const,
    reason: "waiting: 2 Shorts are already in production",
    attempt: 1,
  };
  await recordVerdicts(db, c, [held], EVENING);
  await recordVerdicts(db, c, [held], EVENING);
  assert.equal(
    (await db.query(`SELECT 1 FROM events WHERE kind = 'big_story_held'`))
      .length,
    1,
  );
  await recordVerdicts(db, c, [{ ...held, reason: "another reason" }], EVENING);
  assert.equal(
    (await db.query(`SELECT 1 FROM events WHERE kind = 'big_story_held'`))
      .length,
    2,
  );
  const sent: string[] = [];
  const line = await sendMissReport(
    db,
    c,
    EVENING,
    async (m) => void sent.push(m.content ?? ""),
  );
  assert.equal(sent.length, 1);
  assert.match(
    line!,
    /^Biggest stories today: "God of War Laufey Delayed to May 2027" \(size \d+, \d+ outlets\): missed because another reason\.$/,
  );
  assert.equal(alertKind(line!), "big_story_missed");
  assert.ok(!/[–—]/.test(line!));
  await db.close();
});

test("the evening line: made, planned and missed side by side; nothing big says so", () => {
  const r = (
    headline: string,
    size: number,
    action: BigRecord["action"],
    reason: string,
  ): BigRecord => ({
    headline,
    size,
    action,
    reason,
    name: "x",
    event: "delay",
    outlets: 5,
    articles: 6,
  });
  const line = missReportLine([
    r("Small", 72, "planned", 'planned: "Why" at 18:30 on 2026-11-05'),
    r("Big one", 110, "made", 'made as "Big one"'),
    r(
      "Middle",
      80,
      "held",
      "today's 3 big-story Shorts are already made (BIG_STORY_PER_DAY)",
    ),
  ]);
  assert.equal(
    line,
    `Biggest stories today: "Big one" (size 110, 5 outlets): made; "Middle" (size 80, 5 outlets): missed because today's 3 big-story Shorts are already made (BIG_STORY_PER_DAY); "Small" (size 72, 5 outlets): planned: "Why" at 18:30 on 2026-11-05.`,
  );
  const quiet = missReportLine([], [{ headline: "Halo patch", size: 40 }]);
  assert.match(
    quiet,
    /none reached the big-story bar\. The largest were "Halo patch" \(size 40\)\./,
  );
  assert.equal(alertKind(quiet), "routine");
  assert.equal(alertKind(line), "big_story_missed");
});

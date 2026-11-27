import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  filterCapped,
  fullCap,
  gameCountsToday,
  namesGame,
  parseGameDayCap,
  reserveFor,
} from "../src/gamecap.ts";
import { gameCapCounts, type Services } from "../src/pipeline.ts";
import type { Db } from "../src/db.ts";
import { testConfig, testDb, tmpDir } from "./helpers.ts";

const GTA = "GTA VI|GTA 6|Grand Theft Auto VI|Grand Theft Auto 6=1";
const caps = parseGameDayCap(GTA);

test("GAME_DAY_CAP parses games, skips broken entries and is off when empty", () => {
  assert.deepEqual(parseGameDayCap(""), []);
  assert.deepEqual(parseGameDayCap("   "), []);
  assert.deepEqual(caps, [
    {
      name: "GTA VI",
      aliases: ["GTA VI", "GTA 6", "Grand Theft Auto VI", "Grand Theft Auto 6"],
      perDay: 1,
    },
  ]);
  const two = parseGameDayCap(
    "GTA VI|GTA 6=1; Hollow Knight Silksong|Silksong=2; =3; Halo=x; Doom=-1; Zelda=0",
  );
  assert.deepEqual(
    two.map((c) => [c.name, c.perDay]),
    [
      ["GTA VI", 1],
      ["Hollow Knight Silksong", 2],
      ["Zelda", 0],
    ],
  );
});

test("a headline counts for GTA VI only when it names GTA VI, never GTA V or older GTA history", () => {
  const gta = caps[0]!;
  for (const t of [
    "GTA 6 Passes 39 Million PS5 Players",
    "GTA VI File #3: GTA 6 Radio Now Keeps Playing on Foot",
    "Call of Duty Reportedly Loses 42% of Players After GTA 6",
    "Grand Theft Auto VI patch fixes autosaves",
    "gta6 leaker claims a 209GB build",
  ])
    assert.equal(namesGame(gta, t), true, t);
  for (const t of [
    "Why Driving in GTA 5 Works Better in Third Person",
    "GTA V sells another 5 million",
    "GTA San Andreas at 22: how Rockstar built it",
    "The Witcher 4 Targets a Leap Like GTA's",
    "GTA 60 years of crime games",
    "Grand Theft Auto Vice City remaster rumour",
  ])
    assert.equal(namesGame(gta, t), false, t);
});

test("once GTA VI has its Short for the day, GTA VI stories leave the slot and the rest stay in order", () => {
  const stories = [
    { headline: "GTA 6 Patch Brings 7 Fixes" },
    { headline: "Silksong DLC dated for March" },
    { headline: "GTA 6 Crashes Leave PS5 Players Stuck" },
    { headline: "Halo Infinite gets a final update" },
  ];
  const open = filterCapped(
    stories,
    (s) => s.headline,
    caps,
    new Map([["GTA VI", 0]]),
  );
  assert.deepEqual(open.kept, stories);
  assert.equal(open.dropped.length, 0);
  const full = filterCapped(
    stories,
    (s) => s.headline,
    caps,
    new Map([["GTA VI", 1]]),
  );
  assert.deepEqual(
    full.kept.map((s) => s.headline),
    ["Silksong DLC dated for March", "Halo Infinite gets a final update"],
  );
  assert.deepEqual(
    full.dropped.map((d) => d.game),
    ["GTA VI", "GTA VI"],
  );
  assert.equal(full.allCapped, false);
  assert.equal(fullCap(caps, new Map([["GTA VI", 1]]), "Halo"), undefined);
});

test("a slot whose every story is capped keeps them all, and no caps changes nothing", () => {
  const stories = [{ headline: "GTA 6 Patch" }, { headline: "GTA VI sales" }];
  const all = filterCapped(
    stories,
    (s) => s.headline,
    caps,
    new Map([["GTA VI", 3]]),
  );
  assert.equal(all.allCapped, true);
  assert.deepEqual(all.kept, stories);
  assert.deepEqual(all.dropped, []);
  const none = filterCapped(stories, (s) => s.headline, [], new Map());
  assert.deepEqual(none.kept, stories);
  assert.equal(none.allCapped, false);
  assert.deepEqual(
    filterCapped([], (s: string) => s, caps, new Map([["GTA VI", 3]])).kept,
    [],
  );
});

async function addEpisode(
  db: Db,
  id: string,
  headline: string,
  createdAt: string,
  extra: {
    lane?: string;
    status?: string;
    gameHint?: string;
    title?: string;
    hash?: string;
  } = {},
) {
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, priority, created_at, script_json)
     VALUES ($1, $2, $3, $4, $5, 50, $6, $7)`,
    [
      id,
      extra.hash ?? `h_${id}`,
      extra.status ?? "published",
      JSON.stringify({ headline, gameHint: extra.gameHint }),
      extra.lane ?? "news",
      createdAt,
      extra.title ? JSON.stringify({ youtube: { title: extra.title } }) : null,
    ],
  );
}

test("today's count takes the owner's day, Short lanes only, and leaves failed Shorts and long videos out", async () => {
  const db = await testDb();
  const now = new Date("2026-11-27T10:30:00Z");
  await addEpisode(
    db,
    "a",
    "GTA 6 Passes 39 Million PS5 Players",
    "2026-11-27T03:11:00Z",
  );
  await addEpisode(db, "b", "Witcher 4 news", "2026-11-27T04:00:00Z", {
    gameHint: "Grand Theft Auto VI",
  });
  await addEpisode(db, "c", "Radio keeps playing", "2026-11-27T05:00:00Z", {
    title: "GTA VI File #3: Radio",
  });
  await addEpisode(db, "d", "GTA 6 PSN outage", "2026-11-27T06:00:00Z", {
    status: "failed",
  });
  await addEpisode(
    db,
    "e",
    "Every GTA 6 mission ranked",
    "2026-11-27T07:00:00Z",
    { lane: "longform" },
  );
  await addEpisode(db, "f", "GTA 6 gameplay clip", "2026-11-27T07:00:00Z", {
    lane: "gameplay",
  });
  await addEpisode(db, "g", "GTA 6 yesterday", "2026-11-26T23:59:00Z");
  await addEpisode(db, "h", "Why Halo 3 ended it", "2026-11-27T08:00:00Z");
  await addEpisode(db, "i", "GTA 6 breaking", "2026-11-27T09:00:00Z", {
    lane: "news_breaking",
  });
  const counts = await gameCountsToday(db, caps, "Europe/London", now);
  assert.equal(counts.get("GTA VI"), 4); // a, b (game), c (title), i (breaking counts, it is never held)
  const reserved = await gameCountsToday(
    db,
    caps,
    "Europe/London",
    now,
    new Map([["GTA VI", 1]]),
  );
  assert.equal(reserved.get("GTA VI"), 5);
  assert.equal((await gameCountsToday(db, [], "Europe/London", now)).size, 0);
  await db.close();
});

test("the day's planned GTA File part holds GTA VI's place until it is made or its slot is long past", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const runFile = path.join(dir, "gta_file_run.json");
  await fs.writeFile(
    runFile,
    JSON.stringify([
      {
        kind: "file",
        part: 4,
        date: "2026-11-27",
        title: "GTA 6 Lets You Keep Police Cars",
        question: "q",
        angle: "a",
        recap: "r",
        facts: ["f"],
        sources: [
          {
            url: "https://www.rockstargames.com/x",
            source: "Rockstar",
            official: true,
          },
        ],
      },
    ]),
  );
  const cfg = testConfig(dir, {
    gameDayCap: caps,
    timezone: "Europe/London",
    whyEnabled: true,
    whySlots: ["12:00", "18:30"],
    seriesGtaFileEnabled: true,
    seriesGtaFileSlot: "18:30",
    seriesGtaFileRunFile: runFile,
  });
  const at = (iso: string) =>
    ({ db, cfg, now: () => new Date(iso) }) as unknown as Services;
  // Morning: nothing made yet, the part's 18:30 slot is ahead, so GTA VI's one place is taken.
  assert.equal(
    (await gameCapCounts(at("2026-11-27T10:30:00Z"))).get("GTA VI"),
    1,
  );
  // The part made: it counts once, as a Short, not twice.
  await addEpisode(
    db,
    "p4",
    "GTA VI File #4: GTA 6 Lets You Keep Police Cars",
    "2026-11-27T16:30:00Z",
    {
      hash: "gtafile:4",
      status: "scripted",
    },
  );
  assert.equal(
    (await gameCapCounts(at("2026-11-27T17:00:00Z"))).get("GTA VI"),
    1,
  );
  // Dropped and the slot long past: its place is free again.
  await db.query(`UPDATE episodes SET status = 'rejected' WHERE id = 'p4'`);
  assert.equal(
    (await gameCapCounts(at("2026-11-27T21:00:00Z"))).get("GTA VI"),
    0,
  );
  // Another day with no part planned: nothing reserved.
  assert.equal(
    (await gameCapCounts(at("2026-11-28T10:30:00Z"))).get("GTA VI"),
    0,
  );
  assert.deepEqual([...reserveFor(caps, "Halo 3 File #1").entries()], []);
  await db.close();
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backfillRoom,
  planBackfill,
  seriesBackfill,
  type BackfillYouTube,
} from "../src/seriesplaylists.ts";
import { addToSeries, seriesFor } from "../src/pipeline.ts";
import { goodScript, testConfig, testDb } from "./helpers.ts";

const WHY = "The Why: Gaming's Biggest Questions";
const add = (videoId: string, shelf = WHY) => ({
  episode: `ep_${videoId}`,
  videoId,
  shelf,
  description: "",
});

test("only public videos not already on the shelf are planned, as many as there is room for", () => {
  const privacy = new Map([
    ["a", "public"],
    ["b", "public"],
    ["c", "private"],
    ["d", "unlisted"],
    ["f", "public"],
  ]);
  const members = new Map([[WHY, new Set(["a"])]]);
  const plan = planBackfill(
    [add("a"), add("b"), add("c"), add("d"), add("e"), add("f")],
    privacy,
    members,
    1,
  );
  assert.deepEqual(
    plan.adds.map((x) => x.videoId),
    ["b"],
  );
  assert.equal(plan.already, 1);
  assert.equal(plan.later, 1, "f waits for the next run");
  assert.deepEqual(
    plan.notPublic.map((x) => x.videoId),
    ["c", "d", "e"],
    "private, unlisted and missing videos are never added",
  );
});

test("the catch-up leaves the uploads still due their share of the quota", () => {
  assert.equal(backfillRoom(0, 10_000, 0), 200);
  assert.equal(backfillRoom(9_000, 10_000, 2), 17);
  assert.ok(backfillRoom(10_000, 10_000, 4) < 0);
});

async function seeded() {
  const db = await testDb();
  const script = goodScript({ headline: "Why" });
  const insert = (id: string, vid: string, hash: string, lane = "news") =>
    db.query(
      `INSERT INTO episodes (id, story_hash, lane, status, story_json, script_json, youtube_video_id) VALUES ($1, $2, $3, 'published', '{}', $4, $5)`,
      [id, hash, lane, JSON.stringify(script), vid],
    );
  await insert("ep1", "vidPublic01", "why:one");
  await insert("ep2", "vidPrivate2", "why:two");
  await insert("ep3", "vidOnShelf3", "why:three");
  await insert("ep4", "vidNews0004", "plain-news");
  await db.query(`INSERT INTO settings (key, value) VALUES ($1, 'PLwhy')`, [
    `playlist:${WHY}`,
  ]);
  const calls: string[] = [];
  const yt: BackfillYouTube = {
    stats: async (ids) => {
      calls.push(`stats:${ids.length}`);
      return new Map(
        ids.map((id) => [
          id,
          { privacyStatus: id === "vidPrivate2" ? "private" : "public" },
        ]),
      );
    },
    playlistVideoIds: async () => {
      calls.push("members");
      return { ids: ["vidOnShelf3"], pages: 1 };
    },
    findOrCreatePlaylist: async () => {
      calls.push("create");
      return { id: "PLnew", created: true };
    },
    addToPlaylist: async (p, v) => {
      calls.push(`add:${p}:${v}`);
    },
  };
  return { db, yt, calls };
}

test("a dry run adds nothing; applying adds only the public video that is missing, and running again adds nothing more", async () => {
  const { db, yt, calls } = await seeded();
  const cfg = testConfig(".", { quotaUnitsPerDay: 10_000, newsSlots: [] });
  const run = (apply: boolean) =>
    seriesBackfill({ db, cfg, now: () => new Date(), yt, apply, max: 40 });
  const dry = await run(false);
  assert.equal(dry.added, 0);
  assert.equal(dry.shelves[WHY]!.toAdd, 1);
  assert.ok(!calls.some((c) => c.startsWith("add:")));

  const applied = await run(true);
  assert.equal(applied.added, 1);
  assert.ok(calls.includes("add:PLwhy:vidPublic01"));
  assert.ok(!calls.includes("add:PLwhy:vidPrivate2"), "never a private video");
  assert.ok(!calls.includes("add:PLwhy:vidNews0004"), "the news shelf is left");
  assert.deepEqual(
    applied.notPublic.map((x) => x.privacy),
    ["private"],
  );
  assert.ok(!calls.includes("create"), "the channel's own shelf is reused");
  const [ev] = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM events WHERE kind = 'playlist' AND episode_id = 'ep1'`,
  );
  assert.equal(Number(ev!.n), 1);

  // A second run sees the video on the shelf, as YouTube would report it.
  yt.playlistVideoIds = async () => ({
    ids: ["vidOnShelf3", "vidPublic01"],
    pages: 1,
  });
  const again = await run(true);
  assert.equal(again.added, 0);
  assert.equal(again.already, 2);
  await db.close();
});

test("with SERIES_PLAYLISTS on a video joins only when public, and only once; off, it joins at upload as before", async () => {
  const db = await testDb();
  await db.query(`INSERT INTO settings (key, value) VALUES ($1, 'PLwhy')`, [
    `playlist:${WHY}`,
  ]);
  const added: string[] = [];
  const services = (seriesPlaylists: boolean) =>
    ({
      db,
      cfg: testConfig(".", { seriesPlaylists }),
      now: () => new Date(),
      youtube: () => ({
        findOrCreatePlaylist: async () => ({ id: "PLwhy", created: false }),
        addToPlaylist: async (_: string, v: string) => {
          added.push(v);
        },
      }),
    }) as any;
  const ep = {
    id: "ep1",
    lane: "news",
    story_hash: "why:one",
    youtube_video_id: "vidA",
    story_json: {},
    script_json: goodScript(),
  } as any;
  await db.query(
    `INSERT INTO episodes (id, story_hash, lane, status, story_json) VALUES ('ep1', 'why:one', 'news', 'published', '{}')`,
  );
  await addToSeries(services(true), ep, "private");
  assert.deepEqual(added, [], "a scheduled video stays out while private");
  await addToSeries(services(true), ep, "public");
  assert.deepEqual(added, ["vidA"]);
  await addToSeries(services(true), ep, "public");
  assert.deepEqual(added, ["vidA"], "never twice");
  const off = { ...ep, id: "ep2", youtube_video_id: "vidB" };
  await addToSeries(services(false), off, "private");
  assert.deepEqual(added, ["vidA", "vidB"], "off keeps today's behaviour");
  await db.close();
});

test("a deals list has entries but stays off the rankings shelf; a ranking joins it", () => {
  const cfg = testConfig(".", { timezone: "Europe/London" });
  const shelf = (evergreen_format: string) =>
    seriesFor(
      cfg,
      {
        lane: "evergreen",
        story_hash: "x",
        script_json: {
          ...goodScript(),
          evergreen_format,
          entries: [{ rank: 1 }],
        },
      } as any,
      new Date(),
    ).map((x) => x.title);
  assert.deepEqual(shelf("steam_deals"), []);
  assert.deepEqual(shelf("ranking"), ["Ranked in 60 Seconds"]);
});

test("the weekly explainer files with the weekly videos, never under rankings", () => {
  const cfg = testConfig(".", { timezone: "Europe/London" });
  const ep = {
    lane: "longform",
    story_hash: "x",
    script_json: { ...goodScript(), runtime: "long", explained: true },
  };
  assert.deepEqual(
    seriesFor(cfg, ep as any, new Date()).map((x) => x.title),
    ["The Pulse Weekly: This Week in Gaming"],
  );
});

// AGE_ALARM (19 Nov 2026): Pulse's recent uploads checked for YouTube's age restriction, one line per video, once.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGE_ALARM,
  ageAlarmLine,
  ageAlarmTick,
  ageRatingsFrom,
} from "../src/agealarm.ts";
import { YouTubeClient } from "../src/youtube/upload.ts";
import { testDb } from "./helpers.ts";

const NOW = new Date("2026-11-19T12:00:00Z");
const item = (id: string, title: string, restricted: boolean) => ({
  id,
  snippet: { title },
  contentDetails: restricted
    ? { contentRating: { ytRating: "ytAgeRestricted" } }
    : { contentRating: {} },
  status: { privacyStatus: "public", uploadStatus: "processed" },
});

test("age alarm: ytAgeRestricted is read from videos.list; the line names title, link and what to do", () => {
  const r = ageRatingsFrom([
    item("aaaaaaaaaaa", "GTA 6 map", true),
    item("bbbbbbbbbbb", "Zelda", false),
    { id: "ccccccccccc" },
  ]);
  assert.deepEqual(
    r.map((x) => [x.id, x.ageRestricted]),
    [
      ["aaaaaaaaaaa", true],
      ["bbbbbbbbbbb", false],
      ["ccccccccccc", false],
    ],
  );
  assert.equal(r[0]!.privacy, "public");
  const line = ageAlarmLine("GTA 6 map", "aaaaaaaaaaa");
  assert.match(line, /"GTA 6 map"/);
  assert.match(line, /https:\/\/youtu\.be\/aaaaaaaaaaa/);
  assert.match(line, /appeal in Studio or re-cut/);
  assert.ok(!/—/.test(line), "no em dashes");
});

test("age alarm: one batched call for recent uploads, each restricted video reported once", async () => {
  const db = await testDb();
  const add = (id: string, video: string | null, status: string, at: string) =>
    db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, youtube_video_id, publish_at) VALUES ($1, $1, $2, '{}', $3, $4)`,
      [id, status, video, at],
    );
  await add("e1", "aaaaaaaaaaa", "published", "2026-11-18T10:00:00Z");
  await add("e2", "bbbbbbbbbbb", "published", "2026-11-17T10:00:00Z");
  await add("e3", "ccccccccccc", "published", "2026-10-01T10:00:00Z"); // older than 14 days
  await add("e4", null, "rendered", "2026-11-18T10:00:00Z");
  const asked: string[][] = [];
  const sent: string[] = [];
  const deps = {
    db,
    now: () => NOW,
    notify: async (m: { content: string }) => sent.push(m.content),
    youtube: () => ({
      ageRatings: async (ids: string[]) => {
        asked.push(ids);
        return [
          item("aaaaaaaaaaa", "GTA 6 map", true),
          item("bbbbbbbbbbb", "Zelda", false),
        ];
      },
    }),
  };
  assert.equal(await ageAlarmTick(deps), 1);
  assert.deepEqual(
    asked,
    [["aaaaaaaaaaa", "bbbbbbbbbbb"]],
    "one call, recent uploads only",
  );
  assert.equal(sent.length, 1);
  assert.match(sent[0]!, /GTA 6 map/);
  const ev = await db.query<{ episode_id: string }>(
    `SELECT episode_id FROM events WHERE kind = $1`,
    [AGE_ALARM.kind],
  );
  assert.deepEqual(
    ev.map((e) => e.episode_id),
    ["e1"],
  );
  const quota = await db.query<{ units: number }>(
    `SELECT units FROM quota_ledger`,
  );
  assert.equal(Number(quota[0]!.units), 1, "one quota unit");
  assert.equal(await ageAlarmTick(deps), 0, "never reported twice");
  assert.deepEqual(
    asked[1],
    ["bbbbbbbbbbb"],
    "the reported video is not asked about again",
  );
  assert.equal(sent.length, 1);
  await db.close();
});

test("age alarm: a failed call reports nothing and nothing is asked when there is nothing recent", async () => {
  const db = await testDb();
  let calls = 0;
  const youtube = () => ({
    ageRatings: async () => {
      calls++;
      throw new Error("quota");
    },
  });
  const notify = async () => undefined;
  assert.equal(await ageAlarmTick({ db, now: () => NOW, notify, youtube }), 0);
  assert.equal(calls, 0);
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, youtube_video_id, publish_at) VALUES ('e1','e1','published','{}','aaaaaaaaaaa','2026-11-18T10:00:00Z')`,
  );
  assert.equal(await ageAlarmTick({ db, now: () => NOW, notify, youtube }), 0);
  assert.equal(calls, 1);
  await db.close();
});

test("age alarm: the client asks videos.list for contentDetails and status of up to 50 ids", async () => {
  const urls: string[] = [];
  const client = new YouTubeClient(async () => "token", (async (
    url: string,
  ) => {
    urls.push(String(url));
    return new Response(
      JSON.stringify({ items: [item("aaaaaaaaaaa", "x", true)] }),
      { status: 200 },
    );
  }) as never);
  const ids = Array.from(
    { length: 60 },
    (_, i) => `v${String(i).padStart(10, "0")}`,
  );
  const items = await client.ageRatings(ids);
  assert.equal(items.length, 1);
  assert.equal(urls.length, 1);
  assert.match(urls[0]!, /part=snippet,contentDetails,status/);
  assert.equal(new URL(urls[0]!).searchParams.get("id")!.split(",").length, 50);
  assert.deepEqual(await client.ageRatings([]), []);
});

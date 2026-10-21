import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb, testConfig, tmpDir } from "./helpers.ts";
import { captureMetrics, labelsDue, performanceNotes, weeklyDigest, digestDue, markDigestSent, type VideoStats } from "../src/analytics.ts";
import { quotaUsed } from "../src/lanes.ts";
import { goodScript } from "./helpers.ts";

const H = 3_600_000;

test("a label is due once the Short is old enough, and a window missed by more than half its age is skipped", () => {
  const live = new Date("2026-10-17T12:00:00Z");
  assert.deepEqual(labelsDue(live, new Date(live.getTime() + 0.5 * H), new Set()), []);
  assert.deepEqual(labelsDue(live, new Date(live.getTime() + 1.2 * H), new Set()), ["1h"]);
  assert.deepEqual(labelsDue(live, new Date(live.getTime() + 25 * H), new Set()), ["24h"], "1h and 3h are long gone, never back-filled");
  assert.deepEqual(labelsDue(live, new Date(live.getTime() + 25 * H), new Set(["24h"])), []);
  assert.deepEqual(labelsDue(live, new Date(live.getTime() + 200 * H), new Set()), ["7d"]);
});

async function publishedEpisode(db: Awaited<ReturnType<typeof testDb>>, id: string, videoId: string, liveAt: Date, voice: string, title: string) {
  const script = { ...goodScript(), youtube: { ...goodScript().youtube, title } };
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, script_json, youtube_video_id, publish_at, lane) VALUES ($1, $2, 'published', $3, $4, $5, $6, 'news')`,
    [id, `hash_${id}`, JSON.stringify({ headline: title, items: [] }), JSON.stringify(script), videoId, liveAt],
  );
  await db.query(`INSERT INTO events (episode_id, kind, detail) VALUES ($1, 'voice', $2)`, [id, JSON.stringify({ provider: "elevenlabs", id: "v", name: voice })]);
}

test("captures due numbers in one call, meters a unit, never captures twice, and advises the editor once four Shorts have a 24 h figure", async () => {
  const db = await testDb();
  const now = new Date("2026-10-20T13:00:00Z");
  const views: Record<string, number> = { a: 5000, b: 900, c: 2200, d: 300, e: 100 };
  for (const [k, v] of Object.entries(views)) await publishedEpisode(db, `ep_${k}`, `vid_${k}`, new Date(now.getTime() - 24.5 * H), k < "c" ? "Liam" : "Sarah", `Short ${k} (${v})`);
  let calls = 0;
  const yt = { stats: async (ids: string[]) => { calls++; return new Map(ids.map((id) => [id, { views: views[id.slice(4)]!, likes: 1, comments: 0, privacyStatus: "public" } as VideoStats])); } };
  assert.equal(await captureMetrics(db, yt, now), 5);
  assert.equal(calls, 1, "five videos, one videos.list call");
  assert.equal(await quotaUsed(db, now), 1);
  assert.equal(await captureMetrics(db, yt, now), 0, "nothing due twice");
  const rows = await db.query<{ label: string; views: number }>(`SELECT label, views FROM video_metrics ORDER BY views DESC`);
  assert.deepEqual(rows.map((r) => r.label), ["24h", "24h", "24h", "24h", "24h"]);
  const notes = await performanceNotes(db, now);
  assert.match(notes, /Short a \(5000\)[^\n]*5,000 views/);
  assert.match(notes, /Did worst:/);
  assert.match(notes, /voice Liam/);
  assert.match(notes, /Advice, not rules/);
  const digest = await weeklyDigest(db, testConfig(await tmpDir()), now);
  const text = String(digest.embeds![0]!.description);
  assert.match(text, /news 5/);
  assert.match(text, /Liam: 2,950 over 2/);
  assert.match(text, /Sarah: 300 over 3/);
  await db.close();
});

test("the digest is due on Monday from 09:00 London, once", async () => {
  const db = await testDb();
  const cfg = testConfig(await tmpDir());
  assert.equal(await digestDue(db, cfg, new Date("2026-10-18T10:00:00Z")), undefined, "Sunday");
  assert.equal(await digestDue(db, cfg, new Date("2026-10-19T07:30:00Z")), undefined, "Monday 08:30 London");
  assert.equal(await digestDue(db, cfg, new Date("2026-10-19T08:30:00Z")), "2026-10-19", "Monday 09:30 London");
  await markDigestSent(db, "2026-10-19");
  assert.equal(await digestDue(db, cfg, new Date("2026-10-19T12:00:00Z")), undefined);
  assert.equal(await digestDue(db, cfg, new Date("2026-10-26T09:00:00Z")), "2026-10-26", "next Monday");
  await db.close();
});

import { captureRetention, retentionNotes, hookLessons } from "../src/analytics.ts";

test("retention: captured once a Short is four days old, then taught to the editor and the writer", async () => {
  const db = await testDb();
  const now = new Date();
  const hooks = ["Strong hook one.", "Strong hook two.", "Middling hook.", "Weak hook four.", "Weakest hook."];
  for (const [i, hook] of hooks.entries())
    await db.query(
      `INSERT INTO episodes (id, story_hash, story_json, status, lane, script_json, youtube_video_id, publish_at, updated_at)
       VALUES ($1, $1, '{"headline":"x","items":[]}', 'published', 'news', $2, $3, now() - interval '5 days', now())`,
      [`ep_r${i}`, JSON.stringify(goodScript({ hook, youtube: { ...goodScript().youtube, title: `Title ${i}` } })), `vid${i}`],
    );
  const asked: string[][] = [];
  const yt = {
    retention: async (ids: string[]) => {
      asked.push(ids);
      return new Map(ids.map((id, k) => [id, { views: 100, avgViewSeconds: 30, avgViewPercent: 90 - k * 15, subscribersGained: 5 - k }]));
    },
  };
  assert.equal(await captureRetention(db, yt, now), 5);
  assert.equal(await captureRetention(db, yt, now), 0); // once only
  assert.equal(asked.length, 1);
  const notes = await retentionNotes(db, now);
  assert.match(notes, /Held best:\n- "Title 0": 90% watched on average, \+5 subscribers/);
  const lessons = await hookLessons(db, now);
  assert.match(lessons, /90%: "Strong hook one\."/);
  assert.match(lessons, /lost them:[\s\S]*30%: "Weakest hook\."/);
  await db.close();
});

test("the opening comparison speaks only once both kinds have three Shorts", async () => {
  const { openingLine } = await import("../src/analytics.ts");
  const rows = [
    { stay: 50, opening: "clip" }, { stay: 40, opening: "clip" }, { stay: 45, opening: "clip" },
    { stay: 30, opening: "image" }, { stay: 36, opening: "image" },
  ];
  assert.deepEqual(openingLine(rows), []);
  assert.match(openingLine([...rows, { stay: 33, opening: "image" }])[0]!, /moving footage kept 45% \(3 Shorts\); on a still picture 33% \(3 Shorts\)/);
});

test("the evening summary lists what went live, TikTok drafts waiting and the background news, once a day", async () => {
  const { dailySummary, summaryDue } = await import("../src/analytics.ts");
  const db = await testDb();
  const cfg = { ...testConfig(await tmpDir()), timezone: "Europe/London" };
  await db.query(
    `INSERT INTO episodes (id, story_hash, story_json, status, lane, script_json, youtube_video_id, updated_at)
     VALUES ('ep_s1', 'h1', '{"headline":"x","items":[]}', 'published', 'news', $1, 'vidA', now())`,
    [JSON.stringify(goodScript({ youtube: { ...goodScript().youtube, title: "GTA 6 Slips Again" } }))],
  );
  await db.query(`INSERT INTO events (episode_id, kind, detail) VALUES (NULL, 'note', '{"text":"Gave up on a story at voiced"}'), ('ep_s1', 'crosspost', '{"platform":"tiktok","id":"inbox:v1"}')`);
  const msg = (await dailySummary(db, cfg as any, new Date())).content ?? "";
  assert.match(msg, /1 video live:\n• GTA 6 Slips Again https:\/\/youtube\.com\/shorts\/vidA/);
  assert.match(msg, /TikTok drafts sent: 1/);
  assert.match(msg, /Gave up on a story/);
  const evening = new Date();
  evening.setUTCHours(21, 45, 0, 0);
  assert.ok(await summaryDue(db, cfg as any, evening));
  assert.equal(await summaryDue(db, cfg as any, evening), undefined, "only once a day");
});

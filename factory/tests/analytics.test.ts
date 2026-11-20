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

test("the weekly poll offers four fresh series (requests and focus first) and its winner steers the ranking", async () => {
  const { pollPlan, recordPollResult, readPoll, pollBlock } = await import("../src/social/poll.ts");
  const db = await testDb();
  const cfg = { ...testConfig(await tmpDir()), focusTopic: "Grand Theft Auto" };
  await db.query(`INSERT INTO settings (key, value) VALUES ('audience_requests', $1)`, [JSON.stringify({ at: new Date().toISOString(), requests: [{ name: "Metal Gear Solid", count: 3 }] })]);
  await db.query(`INSERT INTO episodes (id, story_hash, status, story_json, lane, script_json) VALUES ('ep_l', 'l', 'published', '{"headline":"Call of Duty","items":[]}', 'longform', '{"game_title":"Call of Duty"}')`);
  const plan = await pollPlan(db, cfg as any, [{ name: "Call of Duty", source: "franchise seed" }, { name: "Resident Evil", source: "franchise seed" }, { name: "Halo", source: "franchise seed" }, { name: "Zelda", source: "franchise seed" }], new Date());
  assert.deepEqual(plan.options, ["Metal Gear Solid", "Grand Theft Auto", "Resident Evil", "Halo"], "never a series ranked lately");
  await recordPollResult(db, { at: new Date().toISOString(), options: [{ name: "Halo", percent: 54 }, { name: "Resident Evil", percent: 46 }] });
  assert.match(pollBlock(await readPoll(db), new Date()), /Halo 54%, Resident Evil 46%/);
  assert.equal(pollBlock(await readPoll(db), new Date(Date.now() + 15 * 86_400_000)), "", "a stale poll stops steering");
});

test("the evening summary's Claude spend adds the live log and every sandbox log for the day", async () => {
  const { claudeSpend } = await import("../src/editorial/llm.ts");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = await tmpDir();
  const day = "2026-10-22";
  const write = (rel: string, rows: object[]) => {
    fs.mkdirSync(path.join(dir, rel), { recursive: true });
    fs.writeFileSync(path.join(dir, rel, `${day}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  };
  // Opus: 1M in ($4) + 0.1M out ($2) live; Sonnet: 1M cached read ($0.20) in a sandbox.
  write("usage", [{ model: "claude-opus-5-5", in: 1_000_000, out: 100_000, cacheRead: 0, cacheWrite: 0 }]);
  write(path.join("smoke", "gta", "usage"), [{ model: "claude-sonnet-5-5", in: 0, out: 0, cacheRead: 1_000_000, cacheWrite: 0 }]);
  const c = claudeSpend(dir, day);
  assert.equal(c.live.toFixed(2), "6.00");
  assert.equal(c.tests.toFixed(2), "0.20");
  assert.deepEqual(claudeSpend(dir, "2026-01-01"), { live: 0, tests: 0 });
});

test("long videos: entry holds from a retention curve, and lessons for the writer", async () => {
  const { watchAt, entryHolds, longLessons, captureCurves } = await import("../src/analytics.ts");
  // 100 points; viewers fall from 100% to 40% across the video, fastest in the middle entry.
  const curve = Array.from({ length: 101 }, (_, i) => {
    const at = i / 100;
    const watch = at < 0.1 ? 1 - at * 2 : at < 0.5 ? 0.8 - (at - 0.1) * 0.25 : at < 0.7 ? 0.7 - (at - 0.5) * 1.2 : 0.46 - (at - 0.7) * 0.2;
    return { at, watch, relative: 0.5 };
  });
  const duration = 600;
  assert.equal(watchAt(curve, 0, duration), 1);
  assert.ok(Math.abs(watchAt(curve, 60, duration) - 0.8) < 0.011);
  const holds = entryHolds(curve, [60, 300, 420], duration);
  assert.equal(holds.length, 3);
  // The middle entry (300-420 s) loses viewers fastest.
  assert.ok(holds[1]!.lossPerMinute > holds[0]!.lossPerMinute && holds[1]!.lossPerMinute > holds[2]!.lossPerMinute);

  const db = await testDb();
  const now = new Date("2026-11-20T12:00:00Z");
  const script = {
    game_title: "GTA",
    entries: [
      { rank: 3, game_title: "Game C", narration: "Opens slowly on a date. Then more." },
      { rank: 2, game_title: "Game B", narration: "Opens on a list of numbers. Then more." },
      { rank: 1, game_title: "Game A", narration: "Opens on a scene in a car. Then more." },
    ],
  };
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, script_json, assets_json, youtube_video_id, publish_at) VALUES ('ep_long', 'long', 'published', '{"headline":"GTA","items":[]}', 'longform', $1, $2, 'vid1', $3)`,
    [JSON.stringify(script), JSON.stringify({ durationSeconds: 594, entryStarts: [60, 300, 420] }), new Date(now.getTime() - 10 * 86_400_000)],
  );
  assert.equal(await longLessons(db, now), "");
  const got = await captureCurves(db, { retention: async () => new Map(), retentionCurve: async () => curve }, now);
  assert.equal(got, 1);
  const lessons = await longLessons(db, now);
  assert.match(lessons, /Still watching when the first entry begins: 80%/);
  assert.match(lessons, /Entries that lost them fastest:\n- Game B .*"Opens on a list of numbers\."/);
  // Captured once.
  assert.equal(await captureCurves(db, { retention: async () => new Map(), retentionCurve: async () => curve }, now), 0);
});

test("segment losses read the share of viewers lost during each part of a Short", async () => {
  const { segmentLosses, dropLessons } = await import("../src/analytics.ts");
  // A curve that holds through the hook, loses a third during the first card and holds after.
  const curve = Array.from({ length: 101 }, (_, i) => ({ at: i / 100, watch: i < 20 ? 1 : i < 40 ? 1 - ((i - 20) / 20) * 0.33 : 0.67, relative: 1 }));
  const segs = [{ start: 0, end: 6 }, { start: 6, end: 12 }, { start: 12, end: 30 }];
  const l = segmentLosses(curve, segs, 30);
  assert.ok(l[0]! < 0.02, "hook held");
  assert.ok(l[1]! > 0.3 && l[1]! < 0.36, "first card lost a third");
  assert.ok(l[2]! < 0.02, "the rest held");
  const db = await testDb();
  assert.equal(await dropLessons(db, new Date(), () => []), "", "nothing until Shorts have curves");
  await db.close();
});

test("reach: a Short's Shorts-feed share is read once, and the owner hears when the feed stops serving them", async () => {
  const { captureReach, reachAlert, withheld } = await import("../src/analytics.ts");
  // Pure rule: two or more of the last five with almost nothing from the feed; tiny counts say nothing.
  assert.deepEqual(withheld([{ title: "a", views: 600, feed: 520 }, { title: "b", views: 29, feed: 2 }]), []);
  assert.equal(withheld([{ title: "a", views: 29, feed: 2 }, { title: "b", views: 31, feed: 0 }, { title: "c", views: 5, feed: 0 }]).length, 2);

  const db = await testDb();
  const now = new Date("2026-11-20T12:00:00Z");
  const sources: Record<string, Record<string, number>> = {
    v1: { SHORTS: 1, SUBSCRIBER: 20, NO_LINK_OTHER: 8 },
    v2: { SHORTS: 0, SUBSCRIBER: 25, YT_CHANNEL: 6 },
    v3: { SHORTS: 540, SUBSCRIBER: 40 },
    v4: {}, // Analytics has nothing yet
  };
  const hours = [40, 50, 60, 70];
  for (const [i, v] of ["v1", "v2", "v3", "v4"].entries())
    await db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, lane, script_json, youtube_video_id, publish_at) VALUES ($1, $1, 'published', '{"headline":"x","items":[]}', 'news', $2, $3, $4)`,
      [`ep_${v}`, JSON.stringify({ youtube: { title: `Short ${v}` } }), v, new Date(now.getTime() - hours[i]! * H)],
    );
  // A long video is never checked here.
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, youtube_video_id, publish_at) VALUES ('ep_long', 'long', 'published', '{"headline":"x","items":[]}', 'longform', 'vL', $1)`,
    [new Date(now.getTime() - 50 * H)],
  );
  const asked: string[] = [];
  const yt = { trafficSources: async (id: string) => (asked.push(id), sources[id] ?? {}) };
  assert.equal(await captureReach(db, yt, now), 3, "v4 waits for Analytics");
  assert.ok(!asked.includes("vL"));
  assert.equal(await captureReach(db, yt, now), 0, "captured once (v4 still empty)");

  const sent: string[] = [];
  const notify = async (m: { content?: string }) => sent.push(m.content ?? "");
  assert.equal(await reachAlert(db, now, notify), true);
  assert.match(sent[0]!, /2 of our last 5 Shorts/);
  assert.match(sent[0]!, /"Short v1"/);
  assert.match(sent[0]!, /How viewers find this Short/);
  assert.equal(await reachAlert(db, new Date(now.getTime() + 24 * H), notify), false, "at most one alert every three days");
  await db.close();
});

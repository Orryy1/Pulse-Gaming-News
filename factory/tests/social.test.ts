import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { testDb, testConfig, tmpDir, goodScript } from "./helpers.ts";
import {
  ageLabel,
  captionSimilarity,
  captureSocialAccounts,
  captureSocialMetrics,
  insightValues,
  matchTikTok,
  parseCount,
  parseSeconds,
  recordTikTokStats,
  socialLabelsDue,
  socialReaders,
  tiktokStatus,
  type TikTokCandidate,
} from "../src/social/metrics.ts";
import {
  bestHours,
  percentileRanks,
  platformLessons,
  socialLessons,
  socialTable,
  SOCIAL_MIN_SHORTS,
  type PlatformShort,
} from "../src/analytics.ts";
import {
  crosspostTick,
  primeTimeDelay,
  socialCaption,
} from "../src/social/crosspost.ts";
import {
  inPrimeWindow,
  primeTimeLines,
  primeTimeNow,
} from "../src/experiments.ts";
import {
  finishMetaLogin,
  metaAuthorizeUrl,
  metaResultHtml,
} from "../src/social/metaConnect.ts";
import { applyMetaLogin } from "../src/config.ts";
import { handleRoutine } from "../src/routines.ts";

const H = 3_600_000;
type TestDb = Awaited<ReturnType<typeof testDb>>;

async function episode(
  db: TestDb,
  id: string,
  liveAt: Date,
  script = goodScript(),
) {
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, script_json, youtube_video_id, publish_at, lane)
     VALUES ($1, $1, 'published', '{"headline":"x","items":[]}', $2, $3, $4, 'news')`,
    [id, JSON.stringify(script), `yt_${id}`, liveAt],
  );
}

async function crossposted(
  db: TestDb,
  episodeId: string,
  platform: string,
  id: string,
  at: Date,
) {
  await db.query(
    `INSERT INTO events (episode_id, kind, detail, created_at) VALUES ($1, 'crosspost', $2, $3)`,
    [episodeId, JSON.stringify({ platform, id }), at],
  );
}

/** A fake Graph API: each path prefix answers with a body (or an error body and a status). */
function fakeGraph(
  routes: Array<[RegExp, (url: string) => { status?: number; body: unknown }]>,
) {
  const calls: string[] = [];
  const fn = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const r = routes.find(([re]) => re.test(url));
    const out = r
      ? r[1](url)
      : { status: 404, body: { error: { message: "no route", code: 100 } } };
    return new Response(JSON.stringify(out.body), {
      status: out.status ?? 200,
    });
  }) as typeof fetch;
  return { fn, calls };
}

test("ages: a post is read at 1h, 24h, 72h and 7d after it went out there, never back-filled; TikTok readings take the age reached", () => {
  const at = new Date("2026-10-20T12:00:00Z");
  assert.deepEqual(
    socialLabelsDue(at, new Date(at.getTime() + 0.5 * H), new Set()),
    [],
  );
  assert.deepEqual(
    socialLabelsDue(at, new Date(at.getTime() + 1.1 * H), new Set()),
    ["1h"],
  );
  assert.deepEqual(
    socialLabelsDue(at, new Date(at.getTime() + 30 * H), new Set()),
    ["24h"],
  );
  assert.deepEqual(
    socialLabelsDue(at, new Date(at.getTime() + 30 * H), new Set(["24h"])),
    [],
  );
  assert.deepEqual(
    socialLabelsDue(at, new Date(at.getTime() + 300 * H), new Set()),
    [],
    "7d window long gone",
  );
  assert.deepEqual(
    [ageLabel(3), ageLabel(30), ageLabel(80), ageLabel(200)],
    ["1h", "24h", "72h", "7d"],
  );
});

test("per-post capture: Instagram, Facebook and Threads posts are read once per age; TikTok drafts are never polled", async () => {
  const db = await testDb();
  const now = new Date("2026-10-21T13:00:00Z");
  await episode(db, "ep_a", new Date(now.getTime() - 26 * H));
  await crossposted(
    db,
    "ep_a",
    "instagram",
    "ig_1",
    new Date(now.getTime() - 25 * H),
  );
  await crossposted(
    db,
    "ep_a",
    "facebook",
    "fb_1",
    new Date(now.getTime() - 25 * H),
  );
  await crossposted(
    db,
    "ep_a",
    "threads",
    "th_1",
    new Date(now.getTime() - 24.5 * H),
  );
  await crossposted(
    db,
    "ep_a",
    "tiktok",
    "inbox:p1",
    new Date(now.getTime() - 25 * H),
  );
  await crossposted(db, "ep_a", "x", "x1", new Date(now.getTime() - 25 * H));
  const read: string[] = [];
  const readers = {
    instagram: async (id: string) => (
      read.push(id),
      { views: 300, likes: 12, reach: 250, avgWatchSeconds: 6.5 }
    ),
    facebook: async (id: string) => (read.push(id), { views: 120, likes: 3 }),
    threads: async (id: string) => (read.push(id), undefined), // nothing readable: tried again next pass
  };
  assert.equal(await captureSocialMetrics(db, readers, now), 2);
  assert.deepEqual(read.sort(), ["fb_1", "ig_1", "th_1"]);
  assert.equal(
    await captureSocialMetrics(db, readers, now),
    0,
    "Instagram and Facebook are not read twice",
  );
  assert.deepEqual(
    read.sort(),
    ["fb_1", "ig_1", "th_1", "th_1"],
    "Threads is tried again while its 24h is open",
  );
  const rows = await db.query<{
    platform: string;
    label: string;
    views: number;
    avg_watch_seconds: number;
    youtube_video_id: string;
  }>(
    `SELECT platform, label, views, avg_watch_seconds, youtube_video_id FROM social_metrics ORDER BY platform`,
  );
  assert.deepEqual(
    rows.map((r) => [r.platform, r.label, r.views, r.youtube_video_id]),
    [
      ["facebook", "24h", 120, "yt_ep_a"],
      ["instagram", "24h", 300, "yt_ep_a"],
    ],
  );
  assert.equal(rows[1]!.avg_watch_seconds, 6.5);
  await db.close();
});

test("account numbers: once a local day from 06:00, net growth worked out from yesterday's followers", async () => {
  const db = await testDb();
  let followers = 100;
  const readers = {
    accounts: { facebook: async () => ({ extra: { followers } }) },
  };
  assert.equal(
    await captureSocialAccounts(
      db,
      readers,
      new Date("2026-10-20T04:00:00Z"),
      "Europe/London",
    ),
    0,
    "05:00 London is too early",
  );
  assert.equal(
    await captureSocialAccounts(
      db,
      readers,
      new Date("2026-10-20T08:00:00Z"),
      "Europe/London",
    ),
    1,
  );
  assert.equal(
    await captureSocialAccounts(
      db,
      readers,
      new Date("2026-10-20T20:00:00Z"),
      "Europe/London",
    ),
    0,
    "once a day",
  );
  followers = 112;
  await captureSocialAccounts(
    db,
    readers,
    new Date("2026-10-21T08:00:00Z"),
    "Europe/London",
  );
  const [row] = await db.query<{ follows: number }>(
    `SELECT follows FROM social_metrics WHERE label = '2026-10-21'`,
  );
  assert.equal(row!.follows, 12);
  await db.close();
});

test("readers: Instagram without the insights permission says so once and reads the public counts; a refused metric is dropped", async () => {
  const dir = await tmpDir();
  const cfg = testConfig(dir, {
    instagramToken: "tok",
    instagramAccountId: "17841",
    facebookPageToken: "ptok",
    facebookPageId: "6157",
  });
  let insightCalls = 0;
  const g = fakeGraph([
    [
      /\/ig_1\/insights/,
      () => (
        insightCalls++,
        {
          status: 400,
          body: {
            error: {
              message:
                "(#10) Application does not have permission for this action",
              code: 10,
            },
          },
        }
      ),
    ],
    [
      /\/ig_1\?fields=like_count/,
      () => ({ body: { like_count: 7, comments_count: 2 } }),
    ],
    // Facebook: the first ask names a metric that is not allowed; the second gets the rest.
    [
      /\/fb_1\/video_insights/,
      (url) =>
        url.includes("fb_reels_replay_count")
          ? {
              status: 400,
              body: {
                error: {
                  message:
                    "(#100) metric[2] must be one of the following values: blue_reels_play_count, fb_reels_total_plays, post_video_avg_time_watched, post_video_view_time, post_impressions_unique, post_video_followers, post_video_social_actions",
                  code: 100,
                },
              },
            }
          : {
              body: {
                data: [
                  { name: "fb_reels_total_plays", values: [{ value: 410 }] },
                  {
                    name: "post_video_avg_time_watched",
                    values: [{ value: 7300 }],
                  },
                  { name: "post_impressions_unique", values: [{ value: 380 }] },
                  {
                    name: "post_video_social_actions",
                    values: [{ value: { SHARE: 4, COMMENT: 1 } }],
                  },
                ],
              },
            },
    ],
    [
      /\/fb_1\?fields=views/,
      () => ({
        body: {
          views: 400,
          likes: { summary: { total_count: 9 } },
          comments: { summary: { total_count: 1 } },
        },
      }),
    ],
  ]);
  const r = socialReaders(cfg, g.fn);
  assert.deepEqual(await r.instagram!("ig_1"), {
    likes: 7,
    comments: 2,
    extra: { source: "public" },
  });
  await r.instagram!("ig_1");
  assert.equal(insightCalls, 1, "insights rest after a missing permission");
  const fb = (await r.facebook!("fb_1"))!;
  assert.equal(fb.views, 410);
  assert.equal(fb.likes, 9);
  assert.equal(fb.reach, 380);
  assert.equal(fb.shares, 4);
  assert.equal(fb.avgWatchSeconds, 7.3);
  assert.ok(
    !g.calls.at(-1)!.includes("fb_reels_replay_count"),
    "the refused metric is not asked again",
  );
});

test("insight replies: lifetime values and total values are both read", () => {
  assert.deepEqual(
    insightValues({
      data: [
        { name: "views", values: [{ value: 3 }] },
        { name: "likes", total_value: { value: 2 } },
      ],
    }),
    { views: 3, likes: 2 },
  );
});

test("TikTok Studio numbers: counts, durations and caption matching", () => {
  assert.equal(parseCount("1,234"), 1234);
  assert.equal(parseCount("1.2K"), 1200);
  assert.equal(parseCount("3.4M"), 3_400_000);
  assert.equal(parseCount("35%"), 35);
  assert.equal(parseCount("n/a"), undefined);
  assert.equal(parseSeconds("1h 2m 3s"), 3723);
  assert.equal(parseSeconds("12.5s"), 12.5);
  assert.equal(parseSeconds("1:02:03"), 3723);
  assert.equal(parseSeconds(9), 9);
  const sent = new Date("2026-10-20T16:00:00Z");
  const c = (
    episodeId: string,
    caption: string,
    sentAt = sent,
  ): TikTokCandidate => ({
    episodeId,
    youtubeVideoId: `yt_${episodeId}`,
    title: "",
    hook: "",
    caption,
    sentAt,
  });
  const cands = [
    c(
      "ep_gta",
      "GTA 6's trailer is out and November 19 holds. Will you pre-order? #GTA6 #GTA #gamingnews",
    ),
    c(
      "ep_zelda",
      "Switch 2's Zelda costs $80. Day one or wait? #Zelda #Nintendo #gamingnews",
    ),
  ];
  assert.ok(
    captionSimilarity(
      "GTA 6 trailer out, November 19 holds #GTA6",
      cands[0]!.caption,
    ) > 0.6,
  );
  assert.equal(
    matchTikTok(
      {
        text: "GTA 6's trailer is out and November 19 holds. Will you pre-order? #GTA6",
      },
      cands,
    )?.episodeId,
    "ep_gta",
  );
  assert.equal(
    matchTikTok({ text: "my cat playing Elden Ring" }, cands),
    undefined,
    "the owner's own videos are left alone",
  );
  assert.equal(
    matchTikTok(
      {
        text: "Switch 2's Zelda costs $80. Day one or wait?",
        postedAt: new Date("2026-10-19T12:00:00Z"),
      },
      cands,
    ),
    undefined,
    "never a draft sent after the video was posted",
  );
});

test("TikTok ledger: the routine's rows land against the right Short, a later reading replaces the earlier one, and the GET page lists what is missing", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const cfg = testConfig(dir, { timezone: "Europe/London" });
  const now = new Date("2026-10-29T12:00:00Z");
  const sentAt = new Date(now.getTime() - 30 * H);
  const script = goodScript();
  await episode(db, "ep_t", new Date(now.getTime() - 32 * H), script);
  await crossposted(db, "ep_t", "tiktok", "inbox:p9", sentAt);
  await db.query(
    `INSERT INTO events (episode_id, kind, detail, created_at) VALUES ('ep_t', 'tiktok_caption', $1, $2)`,
    [
      JSON.stringify({ caption: socialCaption("tiktok", script, "yt_ep_t") }),
      sentAt,
    ],
  );
  let status = await tiktokStatus(db, now);
  assert.equal(status.length, 1);
  assert.deepEqual(status[0]!.needs, ["24h"]);
  assert.equal(
    status[0]!.caption_first_line,
    socialCaption("tiktok", script, "yt_ep_t").split("\n")[0],
  );
  const body = {
    videos: [
      {
        posted_at: new Date(now.getTime() - 26 * H).toISOString(),
        caption: socialCaption("tiktok", script, "yt_ep_t"),
        views: "1.5K",
        avg_watch_seconds: "8.2s",
        total_play_time: "3h 25m",
        watched_full_pct: "14%",
        new_followers: 3,
        likes: 80,
        comments: 6,
        shares: 4,
        saves: 9,
        traffic: { for_you: "92%", following: "3%", search: "2%" },
        search_terms: ["starfield expansion"],
        stopped_at_second: 4,
      },
      { caption: "My weekend run in Elden Ring", views: 50 },
    ],
    account: {
      followers: 1200,
      net_growth: 14,
      active_hours: [
        { hour: 21, value: 40 },
        { hour: 22, value: 35 },
      ],
      top_territories: ["United States", "United Kingdom"],
    },
  };
  const r = await recordTikTokStats(db, cfg, body, now);
  assert.deepEqual(
    r.matched.map((m) => [m.episode, m.label]),
    [["ep_t", "24h"]],
  );
  assert.deepEqual(r.unmatched, ["My weekend run in Elden Ring"]);
  assert.equal(r.account, true);
  await recordTikTokStats(
    db,
    cfg,
    { videos: [{ ...body.videos[0], views: "2K" }] },
    new Date(now.getTime() + H),
  );
  const rows = await db.query<{
    label: string;
    views: number;
    avg_watch_seconds: number;
    total_watch_seconds: number;
    extra: any;
  }>(
    `SELECT label, views, avg_watch_seconds, total_watch_seconds, extra FROM social_metrics WHERE platform = 'tiktok' AND post_id <> 'account'`,
  );
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0]!.views,
    2000,
    "the later reading at the same age replaced the first",
  );
  assert.equal(rows[0]!.avg_watch_seconds, 8.2);
  assert.equal(rows[0]!.total_watch_seconds, 12_300);
  assert.equal(rows[0]!.extra.traffic.for_you, 92);
  status = await tiktokStatus(db, now);
  assert.deepEqual(status[0]!.needs, []);
  await assert.rejects(recordTikTokStats(db, cfg, "nope", now));
  await db.close();
});

test("the TikTok routine page: GET lists, POST stores; a POST from another site's page is refused", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const cfg = testConfig(dir);
  const ctx = {
    db,
    cfg,
    pollCandidates: async () => [],
    now: () => new Date("2026-10-29T12:00:00Z"),
  };
  const server = http.createServer(async (rq, rs) => {
    if (!(await handleRoutine(rq, rs, new URL(rq.url!, "http://local"), ctx)))
      rs.writeHead(404).end("Not found");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const list = await fetch(`${base}/routine/tiktok-stats`);
    assert.equal(list.status, 200);
    assert.equal((await list.json()).count, 0);
    const ok = await fetch(`${base}/routine/tiktok-stats`, {
      method: "POST",
      headers: { "content-type": "text/plain", origin: base },
      body: JSON.stringify({ videos: [], account: { followers: 10 } }),
    });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).account, true);
    const evil = await fetch(`${base}/routine/tiktok-stats`, {
      method: "POST",
      headers: { "content-type": "text/plain", origin: "https://evil.example" },
      body: JSON.stringify({ videos: [] }),
    });
    assert.equal(evil.status, 404);
    const bad = await fetch(`${base}/routine/tiktok-stats`, {
      method: "POST",
      body: "{nope",
    });
    assert.equal(bad.status, 400);
    assert.equal(
      (await fetch(`${base}/routine/community`, { method: "POST" })).status,
      404,
      "only this page takes a POST",
    );
  } finally {
    server.close();
    await db.close();
  }
});

test("lessons: ranks share ties; nothing is said under six Shorts; a Short that ranks far higher there than on YouTube is named", () => {
  assert.deepEqual(percentileRanks([10, 20, 20, 40]), [0, 0.5, 0.5, 1]);
  const row = (
    i: number,
    yt: number,
    views: number,
    storyType = "delay",
  ): PlatformShort => ({
    title: `Short ${i}`,
    hook: `Hook ${i}`,
    question: i === 0 ? "Day one, or wait?" : "",
    storyType,
    ytViews: yt,
    views,
  });
  const few = [
    row(0, 100, 900),
    row(1, 200, 100),
    row(2, 300, 200),
    row(3, 400, 300),
    row(4, 500, 400),
  ];
  assert.equal(few.length, SOCIAL_MIN_SHORTS - 1);
  assert.deepEqual(
    platformLessons("instagram", few),
    [],
    "thin data says nothing",
  );
  const rows = [...few, row(5, 600, 500)];
  const out = platformLessons("instagram", rows);
  assert.match(out[0]!, /^Instagram \(6 Shorts/);
  assert.ok(out.some((l) => l.startsWith("Did better on Instagram")));
  assert.ok(
    out.some((l) => /"Short 0".*asked "Day one, or wait\?"/.test(l)),
    out.join("\n"),
  );
  // Same order on both platforms: nothing to learn.
  const flat = [0, 1, 2, 3, 4, 5].map((i) =>
    row(i, (i + 1) * 100, (i + 1) * 10),
  );
  assert.deepEqual(platformLessons("tiktok", flat), []);
});

test("best hours come out in US Eastern, and not at all on a quiet account", () => {
  const at = new Date("2026-10-20T12:00:00Z"); // London on BST, New York on EDT: five hours apart
  const counts = Array.from({ length: 24 }, (_, h) =>
    h === 21 ? 50 : h === 22 ? 40 : h === 20 ? 30 : 1,
  );
  assert.deepEqual(bestHours(counts, "Europe/London", at), [15, 16, 17]);
  assert.deepEqual(
    bestHours(Array(24).fill(1), "Europe/London", at),
    [],
    "under the minimum",
  );
});

test("social lessons and the weekly table from stored numbers", async () => {
  const db = await testDb();
  const now = new Date("2026-10-29T12:00:00Z");
  for (let i = 0; i < 6; i++) {
    const id = `ep_${i}`;
    await episode(
      db,
      id,
      new Date(now.getTime() - (50 + i) * H),
      goodScript({
        hook: `Hook number ${i}`,
        youtube: { ...goodScript().youtube, title: `Title ${i}` },
      }),
    );
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, views) VALUES ($1, '24h', $2)`,
      [id, (i + 1) * 100],
    );
    await crossposted(
      db,
      id,
      "instagram",
      `ig_${i}`,
      new Date(now.getTime() - (49 + i) * H),
    );
    await db.query(
      `INSERT INTO social_metrics (platform, post_id, episode_id, label, captured_at, views, likes) VALUES ('instagram', $1, $2, '24h', $3, $4, 2)`,
      [
        `ig_${i}`,
        id,
        new Date(now.getTime() - 20 * H),
        i === 0 ? 5000 : (i + 1) * 10,
      ],
    );
  }
  const text = await socialLessons(db, now);
  assert.match(text, /Did better on Instagram than on YouTube:\n- "Title 0"/);
  const table = await socialTable(db, now);
  assert.match(table.join("\n"), /Instagram\s+6\s+45\s+12/);
  await db.close();
});

test("posting-time test: an early YouTube slot waits for 16:00 Eastern, at most six hours; one in or after the window keeps the stagger", () => {
  // 17:00 London on 29 Oct 2026 is 13:00 in New York (both on standard and summer time apart for a week).
  const at = (iso: string) => new Date(iso);
  assert.equal(
    primeTimeDelay(at("2026-10-29T17:00:00Z"), 30),
    180,
    "13:00 Eastern waits three hours",
  );
  assert.equal(
    primeTimeDelay(at("2026-10-29T17:00:00Z"), 60, 30),
    210,
    "Instagram keeps its place after Facebook",
  );
  assert.equal(
    primeTimeDelay(at("2026-10-29T22:00:00Z"), 30),
    30,
    "18:00 Eastern is inside the window",
  );
  assert.equal(
    primeTimeDelay(at("2026-10-30T02:00:00Z"), 30),
    30,
    "22:00 Eastern is past it",
  );
  assert.equal(
    primeTimeDelay(at("2026-10-29T10:00:00Z"), 30),
    360,
    "06:00 Eastern is capped at six hours",
  );
  assert.equal(
    primeTimeDelay(at("2026-10-29T19:50:00Z"), 30),
    30,
    "15:50 Eastern: the stagger already lands in the window",
  );
  assert.equal(inPrimeWindow(at("2026-10-29T21:00:00Z")), true);
  assert.equal(inPrimeWindow(at("2026-10-29T17:00:00Z")), false);
});

test("posting-time test: on for two weeks from 29 Oct unless the owner's setting says otherwise; the report needs three posts a side", async () => {
  const db = await testDb();
  assert.equal(await primeTimeNow(db, new Date("2026-10-28T12:00:00Z")), false);
  assert.equal(await primeTimeNow(db, new Date("2026-10-29T12:00:00Z")), true);
  assert.equal(
    await primeTimeNow(db, new Date("2026-11-12T12:00:00Z")),
    false,
    "reverts after the end date",
  );
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('override:prime_time_posting', '1')`,
  );
  assert.equal(
    await primeTimeNow(db, new Date("2026-11-20T12:00:00Z")),
    true,
    "kept on by the owner",
  );
  await db.query(
    `UPDATE settings SET value = '0' WHERE key = 'override:prime_time_posting'`,
  );
  assert.equal(
    await primeTimeNow(db, new Date("2026-10-30T12:00:00Z")),
    false,
    "switched off by the owner",
  );
  const evening = (d: number, views: number) => ({
    platform: "instagram",
    at: new Date(`2026-11-0${d}T21:00:00Z`),
    views,
  });
  const morning = (d: number, views: number) => ({
    platform: "instagram",
    at: new Date(`2026-11-0${d}T15:00:00Z`),
    views,
  });
  const lines = primeTimeLines([
    evening(1, 400),
    evening(2, 500),
    evening(3, 600),
    morning(1, 100),
    morning(2, 200),
    morning(3, 300),
  ]);
  assert.match(
    lines.find((l) => l.includes("Instagram"))!,
    /500 median views posted 16:00-20:00 Eastern \(3 posts\) against 200.*the evening did better/,
  );
  assert.match(lines.find((l) => l.includes("TikTok"))!, /not enough numbers/);
  await db.close();
});

test("crossposting with the posting-time test and the Facebook link in the first comment", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const cfg = testConfig(dir);
  await fs.mkdir(path.join(dir, "ep_f"), { recursive: true });
  await fs.writeFile(path.join(dir, "ep_f", "short.mp4"), "x");
  const now = new Date("2026-10-29T17:45:00Z"); // 13:45 Eastern
  await episode(db, "ep_f", new Date("2026-10-29T17:00:00Z"));
  const captions: string[] = [];
  const comments: string[] = [];
  let failComment = false;
  const repaired: string[] = [];
  const deps = {
    db,
    cfg,
    now: () => now,
    isPublic: async () => true,
    notify: async () => true,
    episodeDir: (id: string) => path.join(dir, id),
    primeTime: async () => true,
    posters: {
      facebook: async (_f: string, _t: string, caption: string) => (
        captions.push(caption),
        "fbv1"
      ),
      facebookComment: async (_id: string, text: string) => {
        if (failComment)
          throw new Error("(#200) needs pages_manage_engagement");
        comments.push(text);
        return "c1";
      },
      facebookDescription: async (_id: string, d: string) =>
        void repaired.push(d),
    },
  };
  assert.deepEqual(
    await crosspostTick(deps),
    [],
    "45 minutes after a 13:00 Eastern slot, Facebook waits for 16:00",
  );
  const later = { ...deps, now: () => new Date("2026-10-29T20:01:00Z") };
  assert.equal((await crosspostTick(later)).length, 1);
  assert.doesNotMatch(
    captions[0]!,
    /youtube\.com/,
    "no outside link in the reel's caption",
  );
  assert.deepEqual(comments, [
    "Full story and sources: https://youtube.com/shorts/yt_ep_f",
  ]);
  const [ev] = await db.query<{ detail: any }>(
    `SELECT detail FROM events WHERE kind = 'crosspost'`,
  );
  assert.equal(ev!.detail.timing, "prime");
  // When the comment is refused the caption gets its link back.
  await episode(db, "ep_g", new Date("2026-10-29T19:00:00Z"));
  await fs.mkdir(path.join(dir, "ep_g"), { recursive: true });
  await fs.writeFile(path.join(dir, "ep_g", "short.mp4"), "x");
  failComment = true;
  await crosspostTick(later);
  assert.match(
    repaired[0]!,
    /Full story and sources: https:\/\/youtube\.com\/shorts\/yt_ep_g/,
  );
  const [failed] = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM events WHERE kind = 'crosspost_comment_failed'`,
  );
  assert.equal(Number(failed!.n), 1);
  await db.close();
});

test("Meta connect: the dialog asks for insights and comments, the callback keeps the page token, and the login replaces the .env tokens", async () => {
  const dir = await tmpDir();
  const cfg = testConfig(dir, {
    siteUrl: "https://pulsegmg.com",
    facebookAppId: "123456",
    facebookAppSecret: "s3cret",
    facebookPageId: "6157",
    facebookPageToken: "env-token",
    instagramToken: "env-token",
  });
  const url = new URL(metaAuthorizeUrl(cfg, "n.sig"));
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://pulsegmg.com/oauth/meta",
  );
  for (const s of [
    "read_insights",
    "instagram_manage_insights",
    "instagram_manage_comments",
    "pages_manage_engagement",
    "business_management",
  ])
    assert.ok(url.searchParams.get("scope")!.split(",").includes(s), s);
  assert.equal(url.searchParams.get("auth_type"), "rerequest");
  const g = fakeGraph([
    [
      /oauth\/access_token\?client_id/,
      () => ({ body: { access_token: "short" } }),
    ],
    [
      /grant_type=fb_exchange_token/,
      () => ({ body: { access_token: "long", expires_in: 5_184_000 } }),
    ],
    [
      /\/me\/permissions/,
      () => ({
        body: {
          data: [
            { permission: "publish_video", status: "granted" },
            { permission: "read_insights", status: "granted" },
            { permission: "instagram_manage_insights", status: "declined" },
          ],
        },
      }),
    ],
    [
      /\/6157\?fields=/,
      () => ({
        body: {
          id: "6157",
          name: "Pulse Gaming",
          access_token: "page-token",
          instagram_business_account: { id: "17841" },
        },
      }),
    ],
  ]);
  const login = await finishMetaLogin(
    cfg,
    "code1",
    g.fn,
    new Date("2026-10-29T12:00:00Z"),
  );
  assert.equal(login.pageToken, "page-token");
  assert.equal(login.instagramAccountId, "17841");
  assert.deepEqual(login.granted, ["publish_video", "read_insights"]);
  assert.ok(login.declined.includes("instagram_manage_insights"));
  assert.ok(
    login.declined.includes("pages_manage_engagement"),
    "never offered counts as refused",
  );
  const html = metaResultHtml(login);
  assert.match(html, /Refused or not offered/);
  assert.match(html, /read Instagram numbers/);
  assert.doesNotMatch(html, /page-token/, "no token on the page");
  assert.equal(applyMetaLogin(cfg, login), true);
  assert.equal(cfg.facebookPageToken, "page-token");
  assert.equal(cfg.instagramToken, "page-token");
  assert.deepEqual(cfg.metaGranted, ["publish_video", "read_insights"]);
});

test("an insights refusal that names no metric: each is asked once alone, the refused ones are dropped, the rest kept", async () => {
  const dir = await tmpDir();
  const cfg = testConfig(dir, { facebookPageToken: "ptok", facebookPageId: "6157" });
  const asked: string[] = [];
  const g = fakeGraph([
    [
      /\/fb_2\/video_insights/,
      (url) => {
        const metrics = new URL(url).searchParams.get("metric")!.split(",");
        asked.push(metrics.join(","));
        return metrics.some((m) => m !== "post_video_avg_time_watched" && m !== "post_impressions_unique")
          ? { status: 400, body: { error: { message: "(#100) The value must be a valid insights metric", code: 100 } } }
          : { body: { data: metrics.map((m) => ({ name: m, values: [{ value: 5000 }] })) } };
      },
    ],
    [/\/fb_2\?fields=views/, () => ({ body: { views: 400, likes: { summary: { total_count: 9 } } } })],
  ]);
  const r = socialReaders(cfg, g.fn);
  const fb = (await r.facebook!("fb_2"))!;
  assert.equal(fb.views, 400, "public views kept");
  assert.equal(fb.reach, 5000);
  assert.equal(fb.avgWatchSeconds, 5);
  const before = asked.length;
  await r.facebook!("fb_2");
  assert.equal(asked.length, before + 1, "next time only the good metrics, in one ask");
});

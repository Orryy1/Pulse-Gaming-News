import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { goodScript, testConfig, testDb, tmpDir } from "./helpers.ts";
import {
  analyticsLoopDue,
  breakoutBar,
  captionCoverage,
  healthChecks,
  instagramHolds,
  lessonLines,
  markAnalyticsLoopSent,
  matchByCaption,
  matchByTitle,
  matchRows,
  platformPatterns,
  runAnalyticsLoop,
  spearman,
  storyWeights,
  strengthOf,
  tiktokBoost,
  titleOverlap,
  type EpisodeInfo,
  type LoopPattern,
  type LoopRow,
} from "../src/analyticsloop.ts";
import {
  guessKind,
  heldMayPost,
  isFit,
  loopLessonLines,
  loopPosting,
  loopWeights,
  rankForTikTok,
  storyWeight,
} from "../src/loopfeedback.ts";
import {
  bufferNumbers,
  bufferPostStats,
  parseBufferPosts,
} from "../src/social/buffer.ts";
import { captureBufferTikTok, socialReaders } from "../src/social/metrics.ts";
import { socialLessons } from "../src/analytics.ts";
import { nextForTikTok } from "../src/social/crosspost.ts";

const H = 3_600_000;
const DAY = 24 * H;

const ep = (
  over: Partial<EpisodeInfo> & { id: string; title: string; live_at: string },
): EpisodeInfo => ({
  video: `v_${over.id}`,
  caption_title: over.title,
  hook: "",
  headline: "",
  loop: "",
  game: "",
  lane: "news",
  story_type: "other",
  format: "news",
  long: false,
  ...over,
});

const row = (
  over: Partial<LoopRow> & {
    platform: LoopRow["platform"];
    post_id: string;
    posted_at: string;
  },
): LoopRow => ({
  kind: over.platform === "youtube" ? "short" : "reel",
  captured_at: over.posted_at,
  text: "",
  views: 0,
  ...over,
});

// ------------------------------------------------------------------ matching

test("the matcher agrees with the 11 November hand-matched set (Instagram and Facebook by title, TikTok by caption)", () => {
  const f = JSON.parse(
    fs.readFileSync(
      path.join(import.meta.dirname, "fixtures", "analytics_loop_11nov.json"),
      "utf8",
    ),
  );
  const eps: EpisodeInfo[] = f.episodes.map((e: any) =>
    ep({
      id: e.id,
      title: e.title,
      hook: e.hook,
      headline: e.headline,
      loop: e.loop,
      game: e.game,
      live_at: new Date(e.live_at).toISOString(),
    }),
  );
  for (const p of ["instagram", "facebook"]) {
    const xs = f[p] as Array<{
      caption: string;
      posted_at: string;
      episode: string;
    }>;
    const agree = xs.filter(
      (r) =>
        matchByTitle(r.caption, eps, Date.parse(r.posted_at))?.id === r.episode,
    ).length;
    assert.ok(
      agree >= 0.97 * xs.length,
      `${p}: ${agree} of ${xs.length} agree with the hand match`,
    );
  }
  const tt = f.tiktok as Array<{
    caption: string;
    posted_at: string;
    episode: string;
  }>;
  const got = tt.map((r) =>
    matchByCaption(r.caption, Date.parse(r.posted_at), eps),
  );
  const agree = tt.filter((r, i) => got[i]?.id === r.episode).length;
  const wrong = tt.filter((r, i) => got[i] && got[i]!.id !== r.episode).length;
  assert.ok(agree >= 0.9 * tt.length, `tiktok: ${agree} of ${tt.length} agree`);
  assert.ok(wrong <= 1, `tiktok: ${wrong} matched to a different Short`);
});

test("title matching: equality after normalising, else 0.6 word overlap; short words do not count", () => {
  assert.equal(
    titleOverlap(
      "Why Sony Lost Crash Bandicoot",
      "why sony lost crash bandicoot!",
    ),
    1,
  );
  assert.ok(titleOverlap("The GTA 6 map is huge", "GTA 6 map leaks") < 0.6);
  const eps = [
    ep({
      id: "a",
      title: "Nier Automata Patch Bug Balloons PC Install to 366GB",
      live_at: "2026-11-07T10:00:00Z",
    }),
  ];
  assert.equal(
    matchByTitle(
      "Nier Automata patch bug balloons PC install to 366GB\n\nmore",
      eps,
    )?.id,
    "a",
  );
  assert.equal(
    matchByTitle("Something else entirely about Halo", eps),
    undefined,
    "never guesses",
  );
  assert.ok(
    captionCoverage(
      "Does your GTA 6 preload include GTA Online?",
      "GTA 6 preload GTA Online included your download",
    ) >= 0.6,
  );
});

test("two Shorts on the same story stay separate: the one live closest before the post wins", () => {
  const eps = [
    ep({
      id: "early",
      title: "GTA 6 on PC Confirmed for 2027",
      live_at: "2026-11-07T09:00:00Z",
    }),
    ep({
      id: "late",
      title: "GTA 6 on PC Confirmed for 2027",
      live_at: "2026-11-07T18:00:00Z",
    }),
  ];
  assert.equal(
    matchByTitle(
      "GTA 6 on PC Confirmed for 2027",
      eps,
      Date.parse("2026-11-07T19:00:00Z"),
    )?.id,
    "late",
  );
  assert.equal(
    matchByTitle(
      "GTA 6 on PC Confirmed for 2027",
      eps,
      Date.parse("2026-11-07T10:00:00Z"),
    )?.id,
    "early",
  );
  // TikTok: only Shorts live between 8 days before and an hour after the post are candidates.
  const tt = [
    ep({
      id: "old",
      title: "Hollow Knight Silksong free DLC",
      hook: "Silksong's free DLC lands next week",
      live_at: "2026-10-20T10:00:00Z",
    }),
  ];
  assert.equal(
    matchByCaption(
      "Silksong's free DLC lands next week",
      Date.parse("2026-11-09T10:00:00Z"),
      tt,
    ),
    undefined,
  );
  assert.equal(
    matchByCaption(
      "Silksong's free DLC lands next week",
      Date.parse("2026-10-21T10:00:00Z"),
      tt,
    )?.id,
    "old",
  );
});

test("matchRows: the ledger wins, one post per Short per platform, the rest left unmatched", () => {
  const eps = [
    ep({
      id: "e1",
      title: "Mass Effect Petition Hits 200,000",
      live_at: "2026-11-01T10:00:00Z",
    }),
  ];
  const rows = [
    row({
      platform: "instagram",
      post_id: "m1",
      posted_at: "2026-11-01T11:00:00Z",
      text: "Mass Effect Petition Hits 200,000",
    }),
    row({
      platform: "instagram",
      post_id: "m2",
      posted_at: "2026-11-01T12:00:00Z",
      text: "Mass Effect Petition Hits 200,000",
    }),
    row({
      platform: "tiktok",
      post_id: "buffer:x",
      posted_at: "2026-11-01T13:00:00Z",
      text: "",
    }),
    row({
      platform: "tiktok",
      post_id: "buffer:y",
      posted_at: "2026-11-01T14:00:00Z",
      text: "",
    }),
  ];
  const out = matchRows(
    rows,
    eps,
    new Map([
      ["instagram:m2", "e1"],
      ["tiktok:buffer:x", "e1"],
    ]),
  );
  const by = new Map(out.rows.map((r) => [r.post_id, r]));
  assert.equal(by.get("m2")!.match, "ledger");
  assert.equal(
    by.get("m1")!.episode_id,
    undefined,
    "the Short already has its Instagram post",
  );
  assert.equal(by.get("buffer:x")!.episode_id, "e1");
  assert.equal(
    by.get("buffer:y")!.episode_id,
    undefined,
    "an empty caption stays unmatched",
  );
  assert.equal(out.unmatched.length, 2);
});

// ------------------------------------------------------------------ the maths and its guards

test("strength words at the sample-size boundaries", () => {
  assert.equal(strengthOf(7, true), undefined, "under 8 is not a pattern");
  assert.equal(strengthOf(8, true), "weak");
  assert.equal(strengthOf(14, true), "weak");
  assert.equal(strengthOf(15, true), "moderate");
  assert.equal(strengthOf(29, true), "moderate");
  assert.equal(strengthOf(30, true), "strong");
  assert.equal(strengthOf(30, false), "moderate", "new this week");
  assert.equal(
    strengthOf(40, true, true),
    "moderate",
    "confounded caps at moderate",
  );
});

test("spearman, the breakout bar and the middle value", () => {
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40])!.toFixed(2), "1.00");
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1])!.toFixed(2), "-1.00");
  assert.equal(spearman([1, 2], [1, 2]), undefined, "under three pairs");
  assert.equal(spearman([1, 1, 1], [1, 2, 3]), undefined, "no spread");
  assert.equal(breakoutBar([100, 200, 300]), 600);
});

function shorts(
  n: number,
  views: (i: number) => number,
  traits: (i: number) => Partial<EpisodeInfo>,
  now: Date,
) {
  const eps = new Map<string, EpisodeInfo>();
  const rows: Array<LoopRow & { v: number }> = [];
  for (let i = 0; i < n; i++) {
    const at = new Date(now.getTime() - (4 + (i % 20)) * DAY).toISOString();
    eps.set(
      `e${i}`,
      ep({ id: `e${i}`, title: `Short ${i}`, live_at: at, ...traits(i) }),
    );
    rows.push({
      ...row({
        platform: "instagram",
        post_id: `p${i}`,
        posted_at: at,
        episode_id: `e${i}`,
        views: views(i),
      }),
      v: views(i),
    });
  }
  return { eps, rows };
}

test("patterns: nothing under 8 a side, middle values until there are five breakouts, then breakout rates", () => {
  const now = new Date("2026-11-16T09:00:00Z");
  // 12 Shorts, 6 deals; one breakout only: compared on the middle value.
  const few = shorts(
    12,
    (i) => (i === 0 ? 5000 : i < 6 ? 50 : 200),
    (i) => ({ format: i < 6 ? "deals" : "news" }),
    now,
  );
  const a = platformPatterns("instagram", few.rows, few.eps, [], now);
  assert.ok(
    !a.patterns.some((p) => p.dim === "format"),
    "6 against 6 is too few",
  );
  assert.ok(a.tooFew.some((t) => t.startsWith("format: deals")));
  // 60 Shorts, 30 under 30 s with all the breakouts.
  const many = shorts(
    60,
    (i) => (i < 30 && i % 3 === 0 ? 3000 : 150),
    (i) => ({ duration: i < 30 ? 25 : 50 }),
    now,
  );
  const b = platformPatterns("instagram", many.rows, many.eps, [], now);
  assert.ok(b.breakouts >= 5);
  const short = b.patterns.find(
    (p) => p.dim === "length" && p.group === "under 30 s",
  )!;
  assert.ok(short, "the under-30 s group is a pattern");
  assert.equal(short.uses_rate, true);
  assert.equal(short.direction, "better");
  assert.equal(short.strength, "moderate", "30 a side but new this week");
  const again = platformPatterns(
    "instagram",
    many.rows,
    many.eps,
    b.patterns,
    now,
  );
  assert.equal(
    again.patterns.find((p) => p.dim === "length" && p.group === "under 30 s")!
      .strength,
    "strong",
    "30 a side and the same direction as last week",
  );
});

test("health checks: a dead window, a halved week and a platform nobody is shown", () => {
  const now = new Date("2026-11-16T09:00:00Z");
  const mk = (i: number, views: number, p: LoopRow["platform"] = "tiktok") =>
    row({
      platform: p,
      post_id: `${p}${i}`,
      posted_at: new Date(now.getTime() - (27 - i) * DAY).toISOString(),
      views,
    });
  const tiktok = Array.from({ length: 20 }, (_, i) =>
    mk(i, i >= 8 && i <= 11 ? 5 : 800),
  );
  const t = healthChecks("tiktok", tiktok, now, "Europe/London");
  assert.ok(
    t.some((l) => /4 posts in a row/.test(l)),
    t.join("\n"),
  );
  const fb = Array.from({ length: 10 }, (_, i) => mk(i, 1, "facebook"));
  assert.ok(
    healthChecks("facebook", fb, now, "Europe/London").some((l) =>
      /Nobody is being shown/.test(l),
    ),
  );
  const drop = Array.from({ length: 27 }, (_, i) =>
    mk(i, i >= 21 ? 100 : 400, "instagram"),
  );
  assert.ok(
    healthChecks("instagram", drop, now, "Europe/London").some((l) =>
      /down by half/.test(l),
    ),
  );
});

test("Tier 2 levers stay inside their bounds and need 30 a side", () => {
  assert.equal(
    tiktokBoost({ fit: 29, fitBreaks: 10, rest: 40, restBreaks: 1 }),
    0,
    "29 fit Shorts is too few",
  );
  assert.equal(
    tiktokBoost({ fit: 30, fitBreaks: 6, rest: 30, restBreaks: 2 }),
    0.25,
  );
  assert.equal(
    tiktokBoost({ fit: 30, fitBreaks: 4, rest: 30, restBreaks: 3 }),
    0.1,
  );
  assert.deepEqual(
    instagramHolds(
      [
        { key: "deals", n: 30, breakouts: 0 },
        { key: "45s+", n: 39, breakouts: 0 },
      ],
      8,
      [],
    ),
    ["deals"],
    "one new hold a week",
  );
  assert.deepEqual(
    instagramHolds(
      [
        { key: "deals", n: 30, breakouts: 0 },
        { key: "45s+", n: 39, breakouts: 0 },
      ],
      8,
      ["deals"],
    ),
    ["deals", "45s+"],
  );
  assert.deepEqual(
    instagramHolds([{ key: "deals", n: 30, breakouts: 0 }], 4, ["deals"]),
    [],
    "no breakouts anywhere: nothing to judge against",
  );
  assert.deepEqual(
    instagramHolds([{ key: "deals", n: 18, breakouts: 0 }], 8, []),
    [],
  );
  assert.equal(
    heldMayPost([false, false, false, false], false),
    true,
    "one in five",
  );
  assert.equal(heldMayPost([false, true, false, false], false), false);
  assert.equal(
    heldMayPost([true, true, true, true], true),
    true,
    "never starves the platform",
  );
  // Story weights: two runs the same way, 0.05 a week, never past 0.85 to 1.15, one key a week.
  const g = [
    { key: "explainer|why", n: 30, rest_n: 60, score: 1.6 },
    { key: "sales|news", n: 30, rest_n: 60, score: 1.3 },
  ];
  assert.equal(
    storyWeights(g, {}, {}).moved,
    undefined,
    "first run only records the direction",
  );
  const w = storyWeights(
    g,
    { "explainer|why": 1.15 },
    { "explainer|why": 1, "sales|news": 1 },
  );
  assert.deepEqual(
    w.moved,
    { key: "sales|news", from: 1, to: 1.05, score: 1.3 },
    "the capped key cannot move, the next one does",
  );
  assert.equal(w.weights["explainer|why"], 1.15);
  assert.equal(
    storyWeights(
      [{ key: "a|b", n: 29, rest_n: 60, score: 2 }],
      {},
      { "a|b": 1 },
    ).moved,
    undefined,
  );
  assert.equal(storyWeight({ "a|b": 3 }, "a", "b"), 1.15, "bounded when read");
  assert.deepEqual(guessKind("Why Rockstar Never Made a San Andreas Sequel"), {
    storyType: "other",
    format: "why",
  });
  assert.equal(
    guessKind("Witchbrook slips to January 2027").storyType,
    "delay",
  );
});

test("lessons: only strong or moderate patterns, at most six, dated, and the blocklist wins", () => {
  const p = (over: Partial<LoopPattern>): LoopPattern => ({
    platform: "instagram",
    dim: "length",
    group: "under 30 s",
    n: 20,
    rest_n: 40,
    breakouts: 6,
    rest_breakouts: 1,
    median: 300,
    rest_median: 140,
    uses_rate: true,
    direction: "better",
    strength: "moderate",
    ...over,
  });
  const lines = lessonLines(
    [
      p({}),
      p({ group: "35 to 44 s", strength: "weak" }),
      p({
        dim: "format",
        group: "deals",
        n: 18,
        breakouts: 0,
        direction: "worse",
      }),
    ],
    [{ platform: "instagram", breakout: 13.6, rest: 7.9, n: 8, rest_n: 100 }],
    { format: "why", rate: 1.3, rest: 0.36, n: 16 },
    [],
    "2026-11-16",
  );
  assert.ok(lines.length <= 6);
  assert.ok(lines.every((l) => l.includes("2026-11-16")));
  assert.ok(
    !lines.some((l) => l.includes("35 to 44 s")),
    "weak patterns never reach the writers",
  );
  assert.ok(lines.some((l) => l.startsWith("0 of 18 format deals")));
  assert.ok(
    !lines.some((l) => l.includes("watched 13.6")),
    "8 breakouts is under 15 a side",
  );
  assert.ok(lines.some((l) => l.startsWith("why Shorts brought 1.3")));
  const blocked = lessonLines(
    [p({})],
    [],
    undefined,
    ["under 30 s"],
    "2026-11-16",
  );
  assert.deepEqual(blocked, []);
});

// ------------------------------------------------------------------ Buffer statistics (fixture, no network)

const bufferFixture = () =>
  JSON.parse(
    fs.readFileSync(
      path.join(import.meta.dirname, "fixtures", "buffer_posts.json"),
      "utf8",
    ),
  );

test("Buffer statistics: parsed from the fixture; a post under a day old or not yet refreshed has no reading", () => {
  const page = parseBufferPosts(bufferFixture());
  assert.equal(page.next, "cursor-2");
  assert.equal(page.posts.length, 4);
  const now = new Date("2026-11-11T15:00:00Z");
  const [fresh, old, app, draft] = page.posts;
  assert.equal(
    bufferNumbers(fresh!, now),
    undefined,
    "13 hours old and Buffer has not refreshed it: no reading, not zero",
  );
  assert.equal(
    bufferNumbers(fresh!, new Date("2026-11-13T15:00:00Z")),
    undefined,
    "refreshed before it was sent: still no reading",
  );
  const n = bufferNumbers(old!, now)!;
  assert.equal(n.views, 22077);
  assert.equal(n.likes, 512, "reactions are likes");
  assert.equal(n.shares, 113);
  assert.equal(n.avgWatchSeconds, 13.1, "a string value is still a number");
  assert.equal(
    n.totalWatchSeconds,
    4820 * 60,
    "Buffer gives total watch time in minutes",
  );
  assert.equal(app!.text, "");
  assert.equal(draft!.sentAt, undefined);
  assert.throws(
    () => parseBufferPosts({ errors: [{ message: "Unauthorized" }] }),
    /Unauthorized/,
  );
});

test("bufferPostStats asks for Pulse's channel only, pages until past the window and drops unsent posts", async () => {
  const bodies: any[] = [];
  const fetchFn = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (body.query.includes("organizations"))
      return new Response(
        JSON.stringify({
          data: { account: { organizations: [{ id: "org1" }] } },
        }),
      );
    return new Response(JSON.stringify(bufferFixture()));
  }) as typeof fetch;
  const posts = await bufferPostStats(
    "key",
    "pulse-channel",
    new Date("2026-10-25T00:00:00Z"),
    fetchFn,
  );
  assert.deepEqual(bodies[1].variables.i.filter, {
    channelIds: ["pulse-channel"],
  });
  assert.equal(bodies[1].variables.i.organizationId, "org1");
  assert.equal(
    bodies.length,
    2,
    "the page reached past the window, so no second page",
  );
  assert.deepEqual(
    posts.map((p) => p.id),
    ["post-new", "post-old"],
    "the app post is older than the window, the draft never went out",
  );
});

test("Buffer TikTok numbers land in social_metrics under buffer:<id>, joined through the ledger, read at most every six hours", async () => {
  const db = await testDb();
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, script_json, youtube_video_id, publish_at, lane) VALUES ('e1', 'h1', 'published', '{}', $1, 'vid1', $2, 'news')`,
    [JSON.stringify(goodScript()), new Date("2026-11-05T18:00:00Z")],
  );
  await db.query(
    `INSERT INTO events (episode_id, kind, detail) VALUES ('e1', 'crosspost', '{"platform":"tiktok","id":"buffer:post-old"}')`,
  );
  const posts = parseBufferPosts(bufferFixture()).posts;
  let reads = 0;
  const readers = { tiktokPosts: async () => (reads++, posts) };
  // 80 hours after it was sent: inside the 72-hour reading's window.
  const at72 = new Date(Date.parse("2026-11-05T19:10:00Z") + 80 * H);
  assert.equal(await captureBufferTikTok(db, readers, at72), 1);
  const rows = await db.query<{
    post_id: string;
    episode_id: string;
    label: string;
    views: number;
  }>(`SELECT post_id, episode_id, label, views FROM social_metrics`);
  assert.deepEqual(rows, [
    {
      post_id: "buffer:post-old",
      episode_id: "e1",
      label: "72h",
      views: 22077,
    },
  ]);
  assert.equal(
    await captureBufferTikTok(db, readers, new Date(at72.getTime() + 2 * H)),
    0,
  );
  assert.equal(reads, 1, "throttled to one read every six hours");
  await db.close();
});

// ------------------------------------------------------------------ the settings, off

test("ANALYTICS_LOOP off: the job is never due and Buffer is never read; on, due Monday from 09:00 London, once", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const mon = new Date("2026-11-16T09:30:00Z");
  assert.equal(await analyticsLoopDue(db, testConfig(dir), mon), undefined);
  const on = testConfig(dir, { analyticsLoop: true });
  assert.equal(
    await analyticsLoopDue(db, on, new Date("2026-11-16T08:30:00Z")),
    undefined,
    "08:30 London",
  );
  assert.equal(
    await analyticsLoopDue(db, on, new Date("2026-11-17T10:00:00Z")),
    undefined,
    "Tuesday",
  );
  assert.equal(await analyticsLoopDue(db, on, mon), "2026-11-16");
  await markAnalyticsLoopSent(db, "2026-11-16");
  assert.equal(await analyticsLoopDue(db, on, mon), undefined, "once a week");
  const creds = { bufferApiKey: "k", bufferTiktokChannel: "c" };
  assert.equal(socialReaders(testConfig(dir, creds)).tiktokPosts, undefined);
  assert.ok(
    socialReaders(testConfig(dir, { ...creds, analyticsLoop: true }))
      .tiktokPosts,
  );
  await db.close();
});

function writeFeedback(dir: string, runAt: string) {
  const out = path.join(dir, "reports", "analytics");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(
    path.join(out, "latest.json"),
    JSON.stringify({
      version: 1,
      run_at: runAt,
      lessons_blocklist: ["never say this"],
      feedback: {
        lessons: [
          "Instagram: short ones broke out (weekly report 2026-11-16)",
          "never say this again (weekly report 2026-11-16)",
        ],
        posting: { tiktok_boost: 0.25, instagram_held: ["deals"] },
        weights: { "sales|news": 1.1 },
      },
    }),
  );
}

test("the three feedback settings: off they hand back nothing, on they read the report, a stale report is ignored", async () => {
  const dir = await tmpDir();
  const now = new Date("2026-11-17T10:00:00Z");
  writeFeedback(dir, "2026-11-16T09:05:00Z");
  const off = testConfig(dir);
  assert.deepEqual(loopLessonLines(off, now), []);
  assert.deepEqual(loopPosting(off, now), {
    tiktok_boost: 0,
    instagram_held: [],
  });
  assert.deepEqual(loopWeights(off, now), {});
  const on = testConfig(dir, {
    analyticsLoopLessons: true,
    analyticsLoopPosting: true,
    analyticsLoopScoring: true,
  });
  assert.deepEqual(
    loopLessonLines(on, now),
    ["Instagram: short ones broke out (weekly report 2026-11-16)"],
    "the blocklist wins",
  );
  assert.deepEqual(loopPosting(on, now), {
    tiktok_boost: 0.25,
    instagram_held: ["deals"],
  });
  assert.deepEqual(loopWeights(on, now), { "sales|news": 1.1 });
  assert.deepEqual(
    loopLessonLines(on, new Date("2026-12-05T10:00:00Z")),
    [],
    "over 15 days old",
  );
  // The writers' lessons: unchanged with no lines, a heading of their own with them.
  const db = await testDb();
  assert.equal(await socialLessons(db, now), "");
  assert.match(
    await socialLessons(db, now, loopLessonLines(on, now)),
    /From the weekly cross-platform report[\s\S]*- Instagram: short ones/,
  );
  await db.close();
});

test("ANALYTICS_LOOP_POSTING: TikTok's order is untouched while off; on, a fit Short gets at most a 25% lift", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  writeFeedback(dir, "2026-11-16T09:05:00Z");
  const now = new Date("2026-11-17T20:00:00Z");
  const live = new Date(now.getTime() - 10 * H);
  const put = async (
    id: string,
    title: string,
    duration: number,
    views: number,
  ) => {
    await db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, script_json, assets_json, youtube_video_id, publish_at, lane) VALUES ($1, $1, 'published', '{}', $2, $3, $4, $5, 'news')`,
      [
        id,
        JSON.stringify(
          goodScript({
            youtube: { ...goodScript().youtube, title },
            game_title: title.split(" ")[0]!,
          }),
        ),
        JSON.stringify({ durationSeconds: duration }),
        `v_${id}`,
        live,
      ],
    );
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, captured_at, views, likes, comments) VALUES ($1, '3h', $2, $3, 0, 0)`,
      [id, now, views],
    );
  };
  await put("plain", "Witchbrook Slips to January", 50, 1100);
  await put("fit", "GTA 6 Could Eat Half Your Xbox Series S", 30, 1000);
  assert.equal(
    isFit({
      title: "GTA 6 Could Eat Half Your Xbox Series S",
      game: "GTA",
      durationSeconds: 30,
    }),
    true,
  );
  const base = testConfig(dir, { tiktokDaily: 4, tiktokFromHour: 0 });
  assert.equal(
    (await nextForTikTok(db, base, now))!.id,
    "plain",
    "off: views per hour alone",
  );
  assert.equal(
    (await nextForTikTok(db, { ...base, analyticsLoopPosting: true }, now))!.id,
    "fit",
  );
  const ranked = rankForTikTok(
    [
      { v: 2000, t: { title: "x" } },
      {
        v: 1000,
        t: { title: "GTA 6 eats your 100GB", game: "GTA", durationSeconds: 30 },
      },
    ],
    (r) => r.v,
    (r) => r.t,
    5,
  );
  assert.equal(
    ranked[0]!.v,
    2000,
    "the boost is capped at 25%, never enough to double",
  );
  await db.close();
});

// ------------------------------------------------------------------ the whole run

test("a run with one platform failing still writes all three files in the six-section format", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const cfg = testConfig(dir);
  const now = new Date("2026-11-16T09:05:00Z");
  for (let i = 0; i < 10; i++) {
    const live = new Date(now.getTime() - (5 + i) * DAY);
    const title = `Short number ${i} about Elden Ring`;
    await db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, script_json, assets_json, youtube_video_id, publish_at, lane) VALUES ($1, $1, 'published', '{}', $2, $3, $4, $5, 'news')`,
      [
        `e${i}`,
        JSON.stringify(
          goodScript({ youtube: { ...goodScript().youtube, title } }),
        ),
        JSON.stringify({ durationSeconds: 30 + i * 3 }),
        `v${i}`,
        live,
      ],
    );
    for (const [label, mult] of [
      ["24h", 1],
      ["72h", 2],
    ] as const)
      await db.query(
        `INSERT INTO video_metrics (episode_id, label, captured_at, views, likes, comments, raw) VALUES ($1, $2, $3, $4, 0, 0, '{"privacyStatus":"public"}')`,
        [`e${i}`, label, live, (100 + i * 50) * mult],
      );
  }
  const media = Array.from({ length: 10 }, (_, i) => ({
    id: `m${i}`,
    caption: `Short number ${i} about Elden Ring\n\nhook`,
    product: "REELS",
    timestamp: new Date(now.getTime() - (5 + i) * DAY + H).toISOString(),
  }));
  const { markdown, json, files } = await runAnalyticsLoop(
    db,
    cfg,
    {
      youtube: {},
      instagram: {
        list: async () => media,
        insights: async (id) => ({
          views: 100 + Number(id.slice(1)) * 30,
          avgWatchSeconds: 8,
        }),
      },
      tiktok: async () => {
        throw new Error("Buffer said no");
      },
    },
    now,
  );
  assert.equal(files.length, 3);
  for (const f of ["latest.md", "latest.json", "2026-11-16.md"])
    assert.ok(fs.existsSync(path.join(dir, "reports", "analytics", f)), f);
  for (const h of [
    "## 1. Updated",
    "## 2. Winners",
    "## 3. Losers",
    "## 4. Patterns",
    "## 5. Changes made",
    "## 6. Next test",
  ])
    assert.ok(markdown.includes(h), h);
  assert.ok(!markdown.includes("\u2014"), "no em dashes");
  assert.match(markdown, /TikTok \| not read: Buffer said no/);
  assert.equal(json.platforms.tiktok!.read, false);
  assert.equal(
    json.matched.instagram!.matched,
    10,
    "every Reel matched by title",
  );
  assert.equal(json.posts.filter((r) => r.platform === "youtube").length, 10);
  assert.deepEqual(
    json.changes.filter((c) => c.applied),
    [],
    "report only while the feedback settings are off",
  );
  assert.match(markdown, /Do "fit" Shorts/);
  // Next week's run reads this one: the hand-kept blocklist carries over.
  const saved = JSON.parse(
    fs.readFileSync(
      path.join(dir, "reports", "analytics", "latest.json"),
      "utf8",
    ),
  );
  saved.lessons_blocklist = ["keep me"];
  fs.writeFileSync(
    path.join(dir, "reports", "analytics", "latest.json"),
    JSON.stringify(saved),
  );
  const next = await runAnalyticsLoop(
    db,
    cfg,
    { youtube: {} },
    new Date(now.getTime() + 7 * DAY),
  );
  assert.deepEqual(next.json.lessons_blocklist, ["keep me"]);
  assert.match(next.markdown, /Instagram \| not read: no Instagram login/);
  await db.close();
});

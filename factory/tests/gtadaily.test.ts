import { test } from "node:test";
import assert from "node:assert/strict";
import {
  askFirst,
  claimDay,
  claimedDays,
  dailyCommentLine,
  dailyParts,
  dailySpoilerProblems,
  dailyTheme,
  dailyTitle,
  dailyTitleProblems,
  dayNumber,
  dayOf,
  gtaDailyFrom,
  gtaDailyProblem,
  gtaDailySummary,
  isGtaVi,
  liveClaims,
  nextDay,
  previousDay,
  releaseDay,
  slotOfDay,
  targetDay,
  withNextLink,
  withPreviousLink,
  GTA_DAILY_PLAYLIST,
  type GtaDaily,
} from "../src/gtadaily.ts";
import { nextPartFor } from "../src/nextpart.ts";
import { spoilerWindow } from "../src/sceneindex/spoilers.ts";
import {
  applyGtaDaily,
  gtaDailyComment,
  gtaDailyKept,
  linkGtaDaily,
  nextGameplaySlot,
  refreshGtaDailyLinks,
  seriesFor,
  videoMetadata,
  type Services,
} from "../src/pipeline.ts";
import { createEpisode, getEpisode, type Episode } from "../src/episodes.ts";
import type { GameplayReview } from "../src/gameplay.ts";
import { gameplayScript } from "../src/gameplay.ts";
import { loadConfig, type Config } from "../src/config.ts";
import { testConfig, testDb } from "./helpers.ts";
import type { Db } from "../src/db.ts";

const ON: Partial<Config> = {
  gtaDaily: true,
  gtaDailyStart: "2026-11-19",
  gtaDailySlot: "21:00",
  gtaDailyDays: 28,
  gameplayEnabled: true,
  gameplaySlots: ["21:00", "23:30"],
  timezone: "Europe/London",
  spoilerWindowDays: 28,
  minUploadGapMinutes: 90,
};
const DAILY: GtaDaily = gtaDailyFrom(testConfig("x", ON))!;
const at = (iso: string) => new Date(iso);

function review(over: Partial<GameplayReview> = {}): GameplayReview {
  return {
    keep: true,
    score: 8,
    reason: "A clean test with the answer on screen.",
    game_title: "Grand Theft Auto VI",
    real_test: true,
    experiment_number: 0,
    question: "CAN YOU OUTSWIM 5 STARS?",
    result_line: "THE COPS GAVE UP",
    result: "The police boats lost track about forty seconds offshore.",
    start_seconds: 4,
    end_seconds: 30,
    youtube_title: "GTA 6: Can You Outswim a 5-Star Wanted Level?",
    description:
      "We swam out to sea with five stars. Here is what the police did.",
    hashtags: ["#GTA6"],
    radio_audible: false,
    spoiler: false,
    strong_language: false,
    captions_ok: true,
    ...over,
  };
}

async function gameplayEpisode(
  db: Db,
  id: string,
  r: GameplayReview,
): Promise<Episode> {
  await createEpisode(
    db,
    id,
    {
      hash: `gameplay:${id}`,
      headline: r.question,
      items: [],
      sources: ["Pulse Gaming"],
      hasOfficial: true,
      corroborated: true,
      rumourSignals: false,
      newestAt: "2026-11-19T10:00:00Z",
      score: r.score,
      gameHint: r.game_title,
      gameplay: { id, dir: "", review: r },
    },
    { lane: "gameplay", priority: 10 },
  );
  return (await getEpisode(db, id))!;
}

function services(
  db: Db,
  cfg: Config,
  now: Date,
  yt: Record<string, unknown> = {},
): Services {
  return { db, cfg, now: () => now, youtube: () => yt } as unknown as Services;
}

// ------------------------------------------------------------------ off by default

test("off by default: no setting means no daily, no kept slot and nothing changed on a GTA VI Short", async () => {
  const before = { ...process.env };
  delete process.env.GTA_DAILY;
  try {
    const cfg = loadConfig();
    assert.equal(cfg.gtaDaily, false);
    assert.equal(cfg.gtaDailyStart, "2026-11-19");
    assert.equal(cfg.gtaDailySlot, "21:00");
    assert.equal(gtaDailyFrom(cfg), undefined);
    assert.equal(gtaDailySummary(cfg), "off");
  } finally {
    process.env = before;
  }
  const off = testConfig("x", { ...ON, gtaDaily: false });
  assert.equal(gtaDailyKept(off)(at("2026-11-20T21:00:00Z")), false);
  const db = await testDb();
  const ep = await gameplayEpisode(db, "gp_off", review());
  const script = gameplayScript(review(), "gp_off", []);
  await applyGtaDaily(
    services(db, off, at("2026-11-19T12:00:00Z")),
    ep,
    script,
    {},
  );
  assert.equal(script.youtube.title, review().youtube_title);
  assert.equal(script.series, undefined);
  assert.equal((await claimedDays(db)).size, 0);
  assert.equal((await getEpisode(db, "gp_off"))!.slot_at, null);
  assert.deepEqual(
    seriesFor(off, { ...ep, script_json: script }, at("2026-11-19T12:00:00Z")),
    [],
  );
});

test("switched on, it must reuse a gameplay slot and the gameplay lane", () => {
  assert.equal(gtaDailyProblem(testConfig("x", ON)), undefined);
  assert.match(
    gtaDailyProblem(testConfig("x", { ...ON, gtaDailySlot: "19:00" }))!,
    /not one of GAMEPLAY_SLOTS/,
  );
  assert.match(
    gtaDailyProblem(testConfig("x", { ...ON, gameplayEnabled: false }))!,
    /GAMEPLAY_ENABLED/,
  );
  assert.match(
    gtaDailyProblem(testConfig("x", { ...ON, gtaDailyStart: "19 Nov" }))!,
    /YYYY-MM-DD/,
  );
  assert.equal(
    gtaDailyFrom(testConfig("x", { ...ON, gtaDailySlot: "19:00" })),
    undefined,
  );
  assert.match(
    gtaDailySummary(testConfig("x", ON)),
    /at 21:00 from 2026-11-19/,
  );
});

// ------------------------------------------------------------------ numbering

test("Day N counts calendar days from launch, so a skipped day still counts", () => {
  assert.equal(dayNumber("2026-11-19", "2026-11-19"), 1);
  assert.equal(dayNumber("2026-11-19", "2026-11-21"), 3);
  assert.equal(dayNumber("2026-11-19", "2026-11-18"), 0);
  assert.equal(dayNumber("2026-11-19", "2026-12-01"), 13, "across the month");
  // 23:30 London on 19 Nov is still Day 1; 00:30 on the 20th is Day 2.
  assert.equal(dayOf(DAILY, at("2026-11-19T23:30:00Z")), 1);
  assert.equal(dayOf(DAILY, at("2026-11-20T00:30:00Z")), 2);
  assert.equal(
    dayOf(DAILY, at("2026-11-18T21:00:00Z")),
    undefined,
    "before launch",
  );
  assert.equal(
    dayOf(DAILY, at("2026-12-17T21:00:00Z")),
    undefined,
    "after the run",
  );
  assert.equal(slotOfDay(DAILY, 3).toISOString(), "2026-11-21T21:00:00.000Z");
});

test("a new episode takes the first free day; a missed day is never reused and the next keeps its own number", () => {
  // Day 1, morning: Day 1 is free.
  assert.deepEqual(
    targetDay(DAILY, at("2026-11-19T10:00:00Z"), new Set(), [], 90)?.day,
    1,
  );
  // A backlog fills Day 2 and Day 3 ahead, never further than two days.
  assert.equal(
    targetDay(DAILY, at("2026-11-19T10:00:00Z"), new Set([1]), [], 90)?.day,
    2,
  );
  assert.equal(
    targetDay(DAILY, at("2026-11-19T10:00:00Z"), new Set([1, 2, 3]), [], 90),
    undefined,
  );
  // Nothing was made on Day 2 (skipped). On Day 3, after Day 2's slot, the clip is Day 3, not Day 2.
  assert.equal(
    targetDay(DAILY, at("2026-11-21T09:00:00Z"), new Set([1]), [], 90)?.day,
    3,
  );
  // Too close to tonight's slot: tomorrow.
  assert.equal(
    targetDay(DAILY, at("2026-11-21T20:50:00Z"), new Set([1]), [], 90)?.day,
    4,
  );
  // A video already scheduled near the slot keeps its gap.
  assert.equal(
    targetDay(
      DAILY,
      at("2026-11-21T09:00:00Z"),
      new Set(),
      [at("2026-11-21T20:30:00Z")],
      90,
    )?.day,
    4,
  );
  // The day before launch: Day 1 still.
  assert.equal(
    targetDay(DAILY, at("2026-11-18T12:00:00Z"), new Set(), [], 90)?.day,
    1,
  );
});

test("a day is claimed in the database once, survives a restart and frees itself when its episode dies", async () => {
  const db = await testDb();
  await gameplayEpisode(db, "gp_a", review());
  await gameplayEpisode(db, "gp_b", review());
  assert.equal(await claimDay(db, 1, "gp_a"), true);
  assert.equal(await claimDay(db, 1, "gp_b"), false, "never two Day 1s");
  assert.equal(
    await claimDay(db, 1, "gp_a"),
    true,
    "the owner's claim holds on a retry",
  );
  // A restart reads the same claims from the settings table.
  assert.deepEqual([...(await claimedDays(db))], [[1, "gp_a"]]);
  assert.deepEqual(await liveClaims(db), [1]);
  await db.query(`UPDATE episodes SET status = 'rejected' WHERE id = 'gp_a'`);
  assert.deepEqual(
    await liveClaims(db),
    [],
    "a rejected episode gives its day back",
  );
  assert.equal(await claimDay(db, 1, "gp_b"), true);
  assert.equal(await releaseDay(db, "gp_b"), 1);
});

test("applying the daily numbers the Short, pins the daily slot and keeps the number on a retried step", async () => {
  const db = await testDb();
  const cfg = testConfig("x", ON);
  const now = at("2026-11-19T12:00:00Z");
  const ep = await gameplayEpisode(db, "gp_1", review());
  const script = gameplayScript(review(), "gp_1", []);
  const meta = {
    stream_ask: {
      question: "Can you outswim five stars?",
      claim: "",
      rumour: false,
      verdict: "proved" as const,
      confidence: 0.8,
      reason: "",
    },
  };
  await applyGtaDaily(services(db, cfg, now), ep, script, meta);
  assert.equal(
    script.youtube.title,
    "GTA 6 Day 1: Can You Outswim a 5-Star Wanted Level?",
  );
  assert.deepEqual(dailyTitleProblems(script.youtube.title, 1), []);
  assert.equal(script.series, "gta_daily");
  const saved = (await getEpisode(db, "gp_1"))!;
  assert.equal(
    new Date(saved.slot_at!).toISOString(),
    "2026-11-19T21:00:00.000Z",
  );
  assert.equal(saved.story_json.gtaDaily?.day, 1);
  assert.equal(saved.story_json.gtaDaily?.ask, "Can you outswim five stars?");
  // The step runs again after a restart: same day, same title, no second claim.
  const again = gameplayScript(review(), "gp_1", []);
  await applyGtaDaily(
    services(db, cfg, at("2026-11-19T13:00:00Z")),
    saved,
    again,
    meta,
  );
  assert.equal(again.youtube.title, script.youtube.title);
  assert.deepEqual([...(await claimedDays(db))], [[1, "gp_1"]]);
  // The next clip the same day becomes Day 2 (made ahead).
  const ep2 = await gameplayEpisode(
    db,
    "gp_2",
    review({ youtube_title: "GTA 6: How Long Does a Full Tank Last?" }),
  );
  const s2 = gameplayScript(
    review({ youtube_title: "GTA 6: How Long Does a Full Tank Last?" }),
    "gp_2",
    [],
  );
  await applyGtaDaily(services(db, cfg, now), ep2, s2, {});
  assert.equal(
    s2.youtube.title,
    "GTA 6 Day 2: How Long Does a Full Tank Last?",
  );
  // Not GTA VI: left alone.
  const ep3 = await gameplayEpisode(
    db,
    "gp_3",
    review({ game_title: "Grand Theft Auto V" }),
  );
  const s3 = gameplayScript(
    review({ game_title: "Grand Theft Auto V" }),
    "gp_3",
    [],
  );
  await applyGtaDaily(services(db, cfg, now), ep3, s3, {});
  assert.equal(s3.series, undefined);
  // Other gameplay Shorts keep off the daily slot on the run's days.
  const kept = gtaDailyKept(cfg);
  assert.equal(kept(at("2026-11-20T21:00:00Z")), true);
  assert.equal(kept(at("2026-11-20T23:30:00Z")), false);
  assert.equal(
    nextGameplaySlot(
      cfg,
      now,
      [],
      [at("2026-11-19T21:00:00Z")],
      kept,
    )!.toISOString(),
    "2026-11-19T23:30:00.000Z",
  );
});

// ------------------------------------------------------------------ titles

test("titles: GTA 6 Day N first, within the channel's length, no em dashes, no shouting", () => {
  assert.equal(
    dailyTitle(3, "GTA VI — I tested what Reddit asked"),
    "GTA 6 Day 3: I tested what Reddit asked",
  );
  assert.equal(
    dailyTitle(3, "CAN YOU OUTSWIM 5 STARS?"),
    "GTA 6 Day 3: Can you outswim 5 stars?",
  );
  assert.equal(
    dailyTitle(2, "GTA 6 Day 9: the map edge"),
    "GTA 6 Day 2: The map edge",
  );
  assert.equal(
    dailyTitle(4, "", { ask: true }),
    "GTA 6 Day 4: I tested what you asked",
  );
  const long = dailyTitle(
    12,
    "Can you drive from one end of Leonida to the other without ever stopping once at all",
  );
  assert.equal(long, "GTA 6 Day 12: I tested it", "never cut a question half way");
  assert.equal(
    dailyTitle(2, ["GTA 6: Is the map really about twice the size of GTA V's?", "IS THE MAP TWICE GTA V?"]),
    "GTA 6 Day 2: Is the map twice GTA V?",
    "the shorter question when the title does not fit whole",
  );
  assert.equal(
    dailyTitle(5, ["Does splitting Jason and Lucia up drop part of your wanted level?"], { ask: true }),
    "GTA 6 Day 5: I tested what you asked",
  );
  assert.ok(!/[–—]/.test(dailyTitle(1, "A – B")));
  assert.deepEqual(
    dailyTitleProblems("GTA 6 Day 5: Can you rob every store?", 5),
    [],
  );
  assert.ok(dailyTitleProblems("GTA 6 Day 5: The ending explained", 5).length);
  assert.ok(dailyTitleProblems("GTA 6 Day 5: Can you kill a shark?", 5).length);
  assert.ok(
    dailyTitleProblems("GTA 6 Day 4: Rob every store", 5).length,
    "wrong day",
  );
  assert.equal(dailyTheme("Previews said the map is twice GTA V"), "myth");
  assert.equal(dailyTheme("Can you run out of fuel?"), "test");
});

// ------------------------------------------------------------------ spoilers

test("no story for four weeks after launch: plot words, guard phrases, late names and the reviewer's flag all block", () => {
  const now = at("2026-11-22T12:00:00Z");
  assert.deepEqual(
    dailySpoilerProblems(DAILY, ["GTA 6 Day 4: Can you outswim 5 stars?"], now),
    [],
  );
  assert.ok(
    dailySpoilerProblems(DAILY, ["GTA 6 Day 4: the final mission"], now).length,
  );
  assert.ok(
    dailySpoilerProblems(
      DAILY,
      ["What happens in the story after the bank job"],
      now,
    ).length,
  );
  assert.ok(
    dailySpoilerProblems(DAILY, ["Lucia betrayed everyone"], now).length,
  );
  assert.ok(
    dailySpoilerProblems(DAILY, ["Can you swim?"], now, {
      reviewerSawStory: true,
    }).length,
  );
  assert.ok(
    dailySpoilerProblems(DAILY, ["Can you swim?"], now, { spoilerHeld: true })
      .length,
  );
  const late = spoilerWindow("Grand Theft Auto VI", "2026-11-19", {
    days: 28,
    openingShare: 0.1,
    lateTerms: ["Cal Hampton"],
  })!;
  assert.ok(
    dailySpoilerProblems(DAILY, ["We found Cal Hampton's boat"], now, {
      live: [late],
    }).length,
  );
  // After the window the rule lifts (Day 30).
  assert.deepEqual(
    dailySpoilerProblems(
      DAILY,
      ["the final mission"],
      at("2026-12-19T12:00:00Z"),
    ),
    [],
  );
  assert.ok(
    isGtaVi("Grand Theft Auto VI") &&
      isGtaVi("GTA 6 tests") &&
      !isGtaVi("Grand Theft Auto V"),
  );
});

test("a clip that fails the spoiler gate stays an ordinary gameplay Short", async () => {
  const db = await testDb();
  const cfg = testConfig("x", ON);
  const r = review({
    youtube_title: "GTA 6: The Final Mission Twist",
    question: "WHAT HAPPENS AT THE END?",
  });
  const ep = await gameplayEpisode(db, "gp_s", r);
  const script = gameplayScript(r, "gp_s", []);
  await applyGtaDaily(
    services(db, cfg, at("2026-11-20T12:00:00Z")),
    ep,
    script,
    {},
  );
  assert.equal(script.series, undefined);
  assert.equal((await claimedDays(db)).size, 0);
  const [ev] = await db.query<{ kind: string }>(
    `SELECT kind FROM events WHERE episode_id = 'gp_s'`,
  );
  assert.equal(ev?.kind, "gta_daily_skipped");
});

// ------------------------------------------------------------------ playlist and next links

test("every episode joins the one playlist", async () => {
  const cfg = testConfig("x", ON);
  const db = await testDb();
  const ep = await gameplayEpisode(db, "gp_p", review());
  const script = gameplayScript(review(), "gp_p", []);
  const story = {
    day: 2,
    date: "2026-11-20",
    slot: "21:00",
    theme: "test" as const,
  };
  const titles = seriesFor(
    cfg,
    {
      ...ep,
      script_json: script,
      story_json: { ...ep.story_json, gtaDaily: story },
    },
    at("2026-11-20T22:00:00Z"),
  ).map((x) => x.title);
  assert.deepEqual(titles, [GTA_DAILY_PLAYLIST]);
  // With SERIES_PLAYLISTS on as well, still the one shelf.
  const titles2 = seriesFor(
    { ...cfg, seriesPlaylists: true },
    {
      ...ep,
      script_json: script,
      story_json: { ...ep.story_json, gtaDaily: story },
    },
    at("2026-11-20T22:00:00Z"),
  ).map((x) => x.title);
  assert.deepEqual(titles2, [GTA_DAILY_PLAYLIST]);
});

test("the next link uses the next-part machinery and promises only a day already made", () => {
  const parts = dailyParts(DAILY, [3, 1, 2]);
  assert.deepEqual(
    parts.map((p) => p.part),
    [1, 2, 3],
  );
  assert.equal(
    nextPartFor(parts, slotOfDay(DAILY, 1), "Europe/London")?.part,
    2,
  );
  assert.equal(nextDay(DAILY, 1, [1, 2])?.day, "tomorrow");
  assert.equal(nextDay(DAILY, 1, [1, 2])?.part, 2);
  assert.equal(
    nextDay(DAILY, 1, [1]),
    undefined,
    "Day 2 not made yet: no promise",
  );
  assert.equal(
    nextDay(DAILY, 1, [1, 3])?.day,
    "on Saturday",
    "Day 2 skipped: Day 3 on its own day",
  );
  assert.equal(
    dailyCommentLine(1, nextDay(DAILY, 1, [1, 2]), "PL123"),
    "GTA 6 Day 2 lands tomorrow. Every day so far, in order: https://www.youtube.com/playlist?list=PL123",
  );
  assert.equal(
    dailyCommentLine(1, undefined),
    `That was GTA 6 Day 1. Every day so far is in the "${GTA_DAILY_PLAYLIST}" playlist.`,
  );
  assert.ok(
    !/subscribe|follow/i.test(dailyCommentLine(1, nextDay(DAILY, 1, [1, 2]))),
  );
});

test("next and previous lines go into a live description once, and stay one line", () => {
  const base = "GTA 6 Day 1: fuel test\n\nWe drove until it stopped.";
  const once = withNextLink(base, { day: 2, videoId: "v2" });
  assert.equal(once.split("\n")[1], "Next: GTA 6 Day 2 https://youtu.be/v2");
  assert.equal(
    withNextLink(once, { day: 2, videoId: "v2" }),
    once,
    "idempotent",
  );
  const moved = withNextLink(once, { day: 3, videoId: "v3" });
  assert.equal(moved.match(/^Next:/gm)?.length, 1);
  assert.ok(moved.includes("Next: GTA 6 Day 3 https://youtu.be/v3"));
  const prev = withPreviousLink(base, { day: 1, videoId: "v1" });
  assert.equal(withPreviousLink(prev, { day: 1, videoId: "v1" }), prev);
});

test("upload, comment and go-live wiring: previous link, playlist, next promise and the forward link on the day before", async () => {
  const db = await testDb();
  const cfg = testConfig("x", ON);
  // Day 1 is out and public.
  const d1 = await gameplayEpisode(db, "gp_d1", review());
  await db.query(
    `UPDATE episodes SET status = 'published', youtube_video_id = 'vid1', publish_at = '2026-11-19T21:00:00Z',
       script_json = $2, story_json = story_json || '{"gtaDaily":{"day":1,"date":"2026-11-19","slot":"21:00","theme":"test"}}'::jsonb
     WHERE id = $1`,
    [
      "gp_d1",
      JSON.stringify({
        ...gameplayScript(review(), "gp_d1", []),
        youtube: {
          ...gameplayScript(review(), "gp_d1", []).youtube,
          title: "GTA 6 Day 1: Fuel",
        },
      }),
    ],
  );
  await claimDay(db, 1, "gp_d1");
  await db.query(`INSERT INTO settings (key, value) VALUES ($1, 'PLDAILY')`, [
    `playlist:${GTA_DAILY_PLAYLIST}`,
  ]);
  // Day 2 is made on Day 2.
  const now = at("2026-11-20T12:00:00Z");
  const ep = await gameplayEpisode(db, "gp_d2", review());
  const script = gameplayScript(review(), "gp_d2", []);
  await applyGtaDaily(services(db, cfg, now), ep, script, {});
  await db.query(`UPDATE episodes SET script_json = $2 WHERE id = $1`, [
    "gp_d2",
    JSON.stringify(script),
  ]);
  let d2 = (await getEpisode(db, "gp_d2"))!;
  assert.equal(d2.story_json.gtaDaily?.day, 2);
  d2 = await refreshGtaDailyLinks(services(db, cfg, now), d2);
  assert.deepEqual(d2.story_json.gtaDaily?.previous, {
    day: 1,
    videoId: "vid1",
    title: "GTA 6 Day 1: Fuel",
  });
  const meta = videoMetadata(d2, "public", true, undefined, false, now);
  assert.ok(
    meta.description.includes("Previous: GTA 6 Day 1 https://youtu.be/vid1"),
    meta.description,
  );
  assert.ok(
    meta.description.includes("https://www.youtube.com/playlist?list=PLDAILY"),
  );
  assert.ok(meta.title.startsWith("GTA 6 Day 2"), meta.title);
  // Day 1's comment, written at its go-live, would now promise Day 2 tomorrow.
  const d1row = (await getEpisode(db, "gp_d1"))!;
  assert.match(
    await gtaDailyComment(services(db, cfg, now), d1row),
    /^GTA 6 Day 2 lands tomorrow\./,
  );
  // Day 2 goes public: Day 1's description gains its Next line, once.
  const rewrites: Array<{ id: string; out: string }> = [];
  const yt = {
    rewriteDescriptions: async (
      id: string,
      fn: (d: string, l: string) => string,
    ) => {
      rewrites.push({ id, out: fn("Day one lead\n\nBody", "en") });
      return 1;
    },
  };
  await db.query(
    `UPDATE episodes SET status = 'published', youtube_video_id = 'vid2', publish_at = '2026-11-20T21:00:00Z' WHERE id = 'gp_d2'`,
  );
  const live = (await getEpisode(db, "gp_d2"))!;
  const later = at("2026-11-20T21:20:00Z");
  await linkGtaDaily(services(db, cfg, later, yt), live);
  await linkGtaDaily(services(db, cfg, later, yt), live);
  assert.equal(
    rewrites.length,
    1,
    "once, and Day 2's own previous link was already right",
  );
  assert.equal(rewrites[0]!.id, "vid1");
  assert.ok(
    rewrites[0]!.out.includes("Next: GTA 6 Day 2 https://youtu.be/vid2"),
  );
  void d1;
});

test("with the daily on, stream-ask answers are looked at first, otherwise in the finder's order", () => {
  const clips = [
    { id: "a", meta: {} },
    { id: "b", meta: { stream_ask: { question: "q" } } },
    { id: "c", meta: { live: { ask: "x" } } },
    { id: "d", meta: {} },
  ];
  assert.deepEqual(
    askFirst(clips).map((c) => c.id),
    ["b", "c", "a", "d"],
  );
});

test("previous day finds the latest earlier public day, skipping gaps", async () => {
  const db = await testDb();
  for (const [id, day] of [
    ["e1", 1],
    ["e3", 3],
  ] as const) {
    await gameplayEpisode(db, id, review());
    await db.query(
      `UPDATE episodes SET status = 'published', youtube_video_id = $2, publish_at = $3,
         story_json = story_json || jsonb_build_object('gtaDaily', jsonb_build_object('day', $4::int)) WHERE id = $1`,
      [id, `v${day}`, slotOfDay(DAILY, day), day],
    );
  }
  assert.equal((await previousDay(db, 4, at("2026-11-22T12:00:00Z")))?.day, 3);
  assert.equal(
    (await previousDay(db, 3, at("2026-11-22T12:00:00Z")))?.day,
    1,
    "Day 2 was skipped",
  );
  assert.equal(
    (await previousDay(db, 4, at("2026-11-21T12:00:00Z")))?.day,
    1,
    "Day 3 not out yet",
  );
});

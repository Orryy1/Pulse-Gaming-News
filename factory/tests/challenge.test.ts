import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  challengeCommentLine,
  challengeDescriptionLines,
  challengeEpisodeTitle,
  challengeSeriesTitle,
  challengeTally,
  challengeTitleProblems,
  closeQuiet,
  counterItems,
  emptyRegistry,
  endByHand,
  ideasReport,
  noteStream,
  parseChallengeTag,
  rankChallengeIdeas,
  readRegistry,
  startByHand,
  verdictLine,
  withNextEpisode,
  withPreviousEpisode,
  writeRegistry,
  type ChallengeStory,
} from "../src/challenge.ts";
import {
  applyChallenge,
  challengeCounter,
  challengeHousekeeping,
  claimedEpisodes,
  ideasFileFor,
  previousEpisode,
  refreshChallengeLinks,
} from "../src/challengestep.ts";
import {
  applyGtaDaily,
  seriesFor,
  videoMetadata,
  type Services,
} from "../src/pipeline.ts";
import { createEpisode, getEpisode, type Episode } from "../src/episodes.ts";
import { gameplayScript, type GameplayReview } from "../src/gameplay.ts";
import { loadConfig, type Config } from "../src/config.ts";
import { relaySettings } from "../src/relay/settings.ts";
import { saveVodIndex, emptyVodIndex } from "../src/vodindex/schema.ts";
import { testConfig, testDb, tmpDir } from "./helpers.ts";
import type { Db } from "../src/db.ts";

const at = (iso: string) => new Date(iso);

// ------------------------------------------------------------------ the tag

test("the stream title's tag is read in every way the owner may write it, file names included", () => {
  assert.deepEqual(
    parseChallengeTag("GTA 6 day 3 [CHALLENGE: no cars] !discord"),
    { rule: "no cars", slug: "no-cars" },
  );
  assert.deepEqual(parseChallengeTag("[Challenge - No Guns]"), {
    rule: "no guns",
    slug: "no-guns",
  });
  assert.deepEqual(
    parseChallengeTag("2026-11-25 GTA 6 [CHALLENGE_ no cars] [v123]"),
    { rule: "no cars", slug: "no-cars" },
  );
  assert.deepEqual(parseChallengeTag("(challenge no dying)"), {
    rule: "no dying",
    slug: "no-dying",
  });
  assert.deepEqual(parseChallengeTag("[CHALLENGE: no cars, done]"), {
    rule: "no cars",
    slug: "no-cars",
    end: "made it",
  });
  assert.deepEqual(parseChallengeTag("[CHALLENGE: no cars | failed]"), {
    rule: "no cars",
    slug: "no-cars",
    end: "failed",
  });
  assert.equal(parseChallengeTag("GTA 6 day 3, chill stream"), undefined);
  assert.equal(parseChallengeTag("the challenge of the week"), undefined);
});

test("series and episode titles: searchable, within the title limit, never cut half way", () => {
  assert.equal(
    challengeSeriesTitle("no cars", "Grand Theft Auto VI"),
    "Can I Beat GTA 6 Without Cars?",
  );
  assert.equal(
    challengeSeriesTitle("without dying", "GTA VI"),
    "Can I Beat GTA 6 Without Dying?",
  );
  assert.equal(
    challengeSeriesTitle("only melee", "GTA 6"),
    "Can I Beat GTA 6 With Only Melee?",
  );
  assert.equal(
    challengeSeriesTitle("no hud", "GTA 6"),
    "Can I Beat GTA 6 Without the HUD?",
  );
  assert.equal(
    challengeSeriesTitle("pacifist", "GTA 6"),
    "Can I Beat GTA 6: Pacifist?",
  );
  const s = "Can I Beat GTA 6 Without Cars?";
  assert.equal(
    challengeEpisodeTitle(s, 3, ["The airport on foot"]),
    "Can I Beat GTA 6 Without Cars? Ep 3: The airport on foot",
  );
  assert.equal(
    challengeEpisodeTitle(s, 3, [
      "A very long claim that will never ever fit inside the sixty characters",
      "Short one",
    ]),
    "Can I Beat GTA 6 Without Cars? Ep 3: Short one",
  );
  assert.equal(
    challengeEpisodeTitle(s, 4, ["SHOUTING CLAIM"]),
    "Can I Beat GTA 6 Without Cars? Ep 4",
  );
  assert.equal(
    challengeEpisodeTitle(s, 9, [], true),
    "Can I Beat GTA 6 Without Cars? The Verdict",
  );
  for (const t of [
    challengeEpisodeTitle(s, 3, ["The airport on foot"]),
    challengeEpisodeTitle(s, 9, [], true),
  ])
    assert.deepEqual(challengeTitleProblems(t, s), []);
  assert.ok(
    challengeTitleProblems(
      "Can I Beat GTA 6 Without Cars? Ep 2: I kill everyone",
      s,
    ).length,
  );
  assert.doesNotMatch(
    challengeEpisodeTitle(s, 2, ["Wanted level — how long?"]),
    /[–—]/,
  );
});

// ------------------------------------------------------------------ the registry

test("a tag opens a challenge, the same tag keeps it, an outcome ends it, and quiet days close it", () => {
  const now = at("2026-11-25T20:00:00Z");
  const s1 = {
    id: "s1",
    title: "[CHALLENGE: no cars]",
    date: "2026-11-25",
    startedAt: "2026-11-25T19:00:00Z",
    game: "Grand Theft Auto VI",
  };
  const a = noteStream(emptyRegistry(), s1, now);
  assert.equal(a.started, true);
  assert.equal(a.challenge?.number, 1);
  const b = noteStream(a.reg, s1, at("2026-11-25T20:01:00Z"));
  assert.equal(b.started, false);
  assert.equal(b.reg.challenges[0]!.streams.length, 1);
  const c = noteStream(
    b.reg,
    { ...s1, id: "s2", date: "2026-11-26", startedAt: "2026-11-26T19:00:00Z" },
    at("2026-11-26T20:00:00Z"),
  );
  assert.equal(c.reg.challenges[0]!.streams.length, 2);
  assert.equal(
    noteStream(c.reg, { ...s1, id: "x", title: "chill stream" }, now).reg,
    c.reg,
  );
  const q = closeQuiet(c.reg, at("2026-12-04T20:00:00Z"), 7);
  assert.equal(q.closed.length, 1);
  assert.equal(q.reg.challenges[0]!.ended?.how, "quiet");
  // The tag back after a quiet close carries on the same challenge.
  const back = noteStream(
    q.reg,
    { ...s1, id: "s3", date: "2026-12-05", startedAt: "2026-12-05T19:00:00Z" },
    at("2026-12-05T20:00:00Z"),
  );
  assert.equal(back.started, false);
  assert.equal(back.reg.challenges[0]!.ended, undefined);
  const done = noteStream(
    back.reg,
    {
      ...s1,
      id: "s4",
      title: "[CHALLENGE: no cars, done]",
      startedAt: "2026-12-06T19:00:00Z",
    },
    at("2026-12-06T20:00:00Z"),
  );
  assert.equal(done.ended, true);
  assert.equal(done.reg.challenges[0]!.ended?.outcome, "made it");
  // The same rule after a finished run is a new challenge, number 2.
  const again = noteStream(
    done.reg,
    { ...s1, id: "s5", startedAt: "2026-12-20T19:00:00Z" },
    at("2026-12-20T20:00:00Z"),
  );
  assert.equal(again.started, true);
  assert.equal(again.challenge?.number, 2);
  // By hand.
  const h = startByHand(emptyRegistry(), "no guns", "GTA 6", now, "2026-11-25");
  assert.equal(h.challenge?.how, "admin");
  assert.equal(
    endByHand(h.reg, "no-guns", "failed", now).challenge?.ended?.outcome,
    "failed",
  );
});

// ------------------------------------------------------------------ the count

test("the count is measured: missions from the HUD, restarts and rule breaks from his words, nothing guessed", () => {
  assert.deepEqual(challengeTally([]), {});
  assert.deepEqual(challengeTally([{ words: "" }]), {});
  const t = challengeTally([
    {
      events: [
        { kind: "mission_passed" },
        { kind: "wasted" },
        { kind: "mission_passed" },
      ],
      words: "ok that's a rule break, restarting the run",
    },
    { words: "I broke the rule again. Attempt three, here we go" },
  ]);
  assert.deepEqual(t, { attempt: 3, ruleBreaks: 2, missions: 2 });
  assert.deepEqual(counterItems({ ruleBreaks: 0 }), [
    { label: "RULE BREAKS", value: 0 },
  ]);
  assert.deepEqual(counterItems({}), []);
});

test("links, comment and verdict lines", () => {
  const story: ChallengeStory = {
    slug: "no-cars",
    rule: "no cars",
    game: "Grand Theft Auto VI",
    series: "Can I Beat GTA 6 Without Cars?",
    episode: 2,
    tally: { attempt: 1, missions: 4, ruleBreaks: 0 },
    previous: { episode: 1, videoId: "abc123" },
    playlistId: "PL1",
  };
  const lines = challengeDescriptionLines(story);
  assert.equal(lines[0], "Previous episode: https://youtu.be/abc123");
  assert.match(lines[1]!, /playlist\?list=PL1/);
  assert.match(lines[2]!, /attempt 1, missions 4, rule breaks 0/);
  const d = withNextEpisode("Line one\nLine two", "zzz999");
  assert.equal(d, "Line one\nNext episode: https://youtu.be/zzz999\nLine two");
  assert.equal(
    withNextEpisode(d, "yyy888"),
    "Line one\nNext episode: https://youtu.be/yyy888\nLine two",
  );
  assert.equal(
    withPreviousEpisode("", "q1w2e3"),
    "Previous episode: https://youtu.be/q1w2e3",
  );
  assert.match(challengeCommentLine(story, true), /^Episode 3 is already made/);
  assert.match(challengeCommentLine(story, false), /^That was episode 2/);
  assert.doesNotMatch(challengeCommentLine(story, false), /subscribe/i);
  assert.match(verdictLine({ ...story, outcome: "made it" }), /^I made it/);
  assert.match(
    verdictLine({ ...story, outcome: "failed" }),
    /^I did not make it/,
  );
  const counter = challengeCounter(story, 2, 30)!;
  assert.equal(counter.title, "EP 2");
  assert.equal(counter.items.length, 3);
  assert.equal(challengeCounter(story, 2, 3), undefined);
});

// ------------------------------------------------------------------ ideas

test("ideas are ranked by what people ask, ones already run go last, and the report names the tag", () => {
  const ranked = rankChallengeIdeas(
    [
      { text: "can you beat gta 6 without guns??", weight: 5 },
      { text: "do a no cars run" },
      { text: "melee only please" },
    ],
    ["no cars"],
  );
  assert.equal(ranked[0]!.rule, "no guns");
  assert.equal(ranked[0]!.mentions, 6); // "melee only" is a no-guns cue as well
  assert.equal(ranked.at(-1)!.rule, "no cars");
  assert.equal(ranked.at(-1)!.done, true);
  const md = ideasReport(ranked, at("2026-11-20T10:00:00Z"));
  assert.match(md, /\[CHALLENGE: no guns\]/);
  assert.doesNotMatch(md, /[–—]/);
});

// ------------------------------------------------------------------ the gameplay lane

function review(over: Partial<GameplayReview> = {}): GameplayReview {
  return {
    keep: true,
    score: 8,
    reason: "A clean run on foot.",
    game_title: "Grand Theft Auto VI",
    real_test: true,
    experiment_number: 0,
    question: "CAN YOU REACH THE AIRPORT ON FOOT?",
    result_line: "IT TOOK NINE MINUTES",
    result: "The walk to the airport took about nine minutes.",
    start_seconds: 4,
    end_seconds: 30,
    youtube_title: "The airport on foot",
    description: "We walked to the airport with no cars at all.",
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
  dir = "",
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
      newestAt: "2026-11-25T10:00:00Z",
      score: r.score,
      gameHint: r.game_title,
      gameplay: { id, dir, review: r },
    },
    { lane: "gameplay", priority: 10 },
  );
  return (await getEpisode(db, id))!;
}

const services = (db: Db, cfg: Config, now: Date) =>
  ({ db, cfg, now: () => now, youtube: () => ({}) }) as unknown as Services;

test("off by default: no setting, no challenge, and a tagged clip stays an ordinary gameplay Short", async () => {
  const before = { ...process.env };
  delete process.env.CHALLENGE_SERIES;
  try {
    assert.equal(loadConfig().challenge.enabled, false);
    assert.equal(relaySettings({}).challengeSeries, false);
  } finally {
    process.env = before;
  }
  const data = await tmpDir();
  const cfg = testConfig("x", { dataDir: data });
  const db = await testDb();
  const ep = await gameplayEpisode(db, "gp_off", review());
  const script = gameplayScript(review(), "gp_off", []);
  const ok = await applyChallenge(
    services(db, cfg, at("2026-11-25T21:00:00Z")),
    ep,
    script,
    {
      source: {
        file: "a.mp4",
        title: "GTA 6 [CHALLENGE: no cars]",
        kind: "twitch_vod",
      },
    },
  );
  assert.equal(ok, false);
  assert.equal(script.series, undefined);
  assert.equal(readRegistry(data).challenges.length, 0);
});

test("switched on: tagged clips become numbered episodes with their shelf, the Day N daily steps aside, and the verdict ends the run", async () => {
  const data = await tmpDir();
  const cfg = testConfig("x", {
    dataDir: data,
    challenge: { enabled: true, quietDays: 7, ideasFile: "" },
    gtaDaily: true,
    gtaDailyStart: "2026-11-19",
    gtaDailySlot: "21:00",
    gameplayEnabled: true,
    gameplaySlots: ["21:00", "23:30"],
  });
  const db = await testDb();
  const now = at("2026-11-25T12:00:00Z");
  // An earlier recording of the challenge, indexed, with its HUD track read.
  const vod = emptyVodIndex(
    "/v/2026-11-24 GTA 6 [CHALLENGE_ no cars] [v900].mp4",
    3600,
    "Grand Theft Auto VI",
    now,
  );
  vod.lines = [
    {
      id: 0,
      start: 10,
      end: 12,
      text: "that's a rule break, restarting the run",
      via: "voice",
      shot: 0,
    },
  ];
  await saveVodIndex(data, vod);
  await fs.mkdir(path.join(data, "hud", "vods", "v900"), { recursive: true });
  await fs.writeFile(
    path.join(data, "hud", "vods", "v900", "track.json"),
    JSON.stringify({
      events: [{ kind: "mission_passed" }, { kind: "mission_passed" }],
    }),
  );
  const clipDir = await tmpDir();
  await fs.writeFile(
    path.join(clipDir, "words.json"),
    JSON.stringify([{ text: "no cars", start: 0, end: 1 }]),
  );
  const meta = {
    source: {
      file: "/v/clip.mp4",
      title: "GTA 6 day 7 [CHALLENGE: no cars]",
      kind: "twitch_vod",
    },
  };

  const ep1 = await gameplayEpisode(db, "gp_c1", review(), clipDir);
  const s1 = gameplayScript(review(), "gp_c1", []);
  assert.equal(
    await applyChallenge(services(db, cfg, now), ep1, s1, meta),
    true,
  );
  assert.equal(
    s1.youtube.title,
    "Can I Beat GTA 6 Without Cars? Ep 1: The airport on foot",
  );
  assert.equal(s1.series, "challenge");
  const saved1 = (await getEpisode(db, "gp_c1"))!;
  assert.equal(saved1.story_json.challenge?.episode, 1);
  assert.deepEqual(saved1.story_json.challenge?.tally, {
    attempt: 2,
    ruleBreaks: 1,
    missions: 2,
  });
  assert.equal(readRegistry(data).challenges[0]!.how, "recording");
  // The daily leaves a challenge episode alone: the pipeline only calls it when applyChallenge says no.
  assert.equal(saved1.story_json.gtaDaily, undefined);
  assert.deepEqual(
    seriesFor(cfg, { ...saved1, script_json: s1 }, now).map((x) => x.title),
    ["Can I Beat GTA 6 Without Cars?"],
  );
  // A retried step keeps its number.
  const again = gameplayScript(review(), "gp_c1", []);
  await applyChallenge(services(db, cfg, now), saved1, again, meta);
  assert.equal(again.youtube.title, s1.youtube.title);

  // Episode 2, then episode 1 goes public and episode 2 links back to it.
  const ep2 = await gameplayEpisode(
    db,
    "gp_c2",
    review({ youtube_title: "The longest swim" }),
    clipDir,
  );
  const s2 = gameplayScript(
    review({ youtube_title: "The longest swim" }),
    "gp_c2",
    [],
  );
  await applyChallenge(services(db, cfg, now), ep2, s2, meta);
  assert.equal(
    (await getEpisode(db, "gp_c2"))!.story_json.challenge?.episode,
    2,
  );
  assert.deepEqual(
    [...(await claimedEpisodes(db, "no-cars")).keys()].sort(),
    [1, 2],
  );
  await db.query(
    `UPDATE episodes SET status = 'published', youtube_video_id = 'vid111', script_json = $1 WHERE id = 'gp_c1'`,
    [JSON.stringify(s1)],
  );
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('playlist:Can I Beat GTA 6 Without Cars?', 'PLchal')`,
  );
  assert.deepEqual(await previousEpisode(db, "no-cars", 2, now), {
    episode: 1,
    videoId: "vid111",
  });
  await db.query(`UPDATE episodes SET script_json = $1 WHERE id = 'gp_c2'`, [
    JSON.stringify(s2),
  ]);
  const linked = await refreshChallengeLinks(
    services(db, cfg, now),
    (await getEpisode(db, "gp_c2"))!,
  );
  assert.equal(linked.story_json.challenge?.playlistId, "PLchal");
  const meta2 = videoMetadata(linked, "public");
  assert.match(
    meta2.description,
    /Previous episode: https:\/\/youtu\.be\/vid111/,
  );
  assert.match(meta2.description, /playlist\?list=PLchal/);

  // A rejected episode frees its number.
  await db.query(`UPDATE episodes SET status = 'rejected' WHERE id = 'gp_c2'`);
  assert.deepEqual([...(await claimedEpisodes(db, "no-cars")).keys()], [1]);

  // The run ends ("done" in the title): the next clip is the verdict, and only one verdict is ever made.
  writeRegistry(
    data,
    endByHand(readRegistry(data), "no-cars", "made it", now).reg,
  );
  const ep3 = await gameplayEpisode(db, "gp_c3", review(), clipDir);
  const s3 = gameplayScript(review(), "gp_c3", []);
  await applyChallenge(services(db, cfg, now), ep3, s3, meta);
  assert.equal(s3.youtube.title, "Can I Beat GTA 6 Without Cars? The Verdict");
  assert.match(s3.youtube.description, /^I made it/);
  const v = (await getEpisode(db, "gp_c3"))!.story_json.challenge!;
  assert.equal(v.final, true);
  assert.equal(v.episode, 2);
  const ep4 = await gameplayEpisode(db, "gp_c4", review(), clipDir);
  const s4 = gameplayScript(review(), "gp_c4", []);
  assert.equal(
    await applyChallenge(services(db, cfg, now), ep4, s4, meta),
    false,
  );
  // Not a challenge clip: the daily may still number it.
  const ep5 = await gameplayEpisode(db, "gp_c5", review());
  const s5 = gameplayScript(review(), "gp_c5", []);
  assert.equal(
    await applyChallenge(services(db, cfg, now), ep5, s5, {
      source: { file: "b.mp4", title: "GTA 6 day 7", kind: "twitch_vod" },
    }),
    false,
  );
  await applyGtaDaily(
    services(db, cfg, at("2026-11-25T12:00:00Z")),
    ep5,
    s5,
    {},
  );
  assert.match(s5.youtube.title, /^GTA 6 Day 7: /);
});

test("a clip with a story spoiler during the window is never a challenge episode", async () => {
  const data = await tmpDir();
  const cfg = testConfig("x", {
    dataDir: data,
    challenge: { enabled: true, quietDays: 7, ideasFile: "" },
  });
  const db = await testDb();
  const ep = await gameplayEpisode(db, "gp_sp", review({ spoiler: true }));
  const s = gameplayScript(review({ spoiler: true }), "gp_sp", []);
  assert.equal(
    await applyChallenge(services(db, cfg, at("2026-11-25T12:00:00Z")), ep, s, {
      source: {
        file: "a.mp4",
        title: "[CHALLENGE: no cars]",
        kind: "twitch_vod",
      },
    }),
    false,
  );
});

test("housekeeping files tagged recordings, closes quiet challenges and writes the ideas report", async () => {
  const data = await tmpDir();
  const cfg = testConfig("x", {
    dataDir: data,
    challenge: { enabled: true, quietDays: 7, ideasFile: "" },
  });
  const db = await testDb();
  await saveVodIndex(
    data,
    emptyVodIndex(
      "/v/2026-11-01 GTA 6 [CHALLENGE: no guns] [v1].mp4",
      600,
      "Grand Theft Auto VI",
      at("2026-11-01T20:00:00Z"),
    ),
  );
  await fs.mkdir(path.join(data, "streamasks"), { recursive: true });
  const told: string[] = [];
  const r = await challengeHousekeeping(
    cfg,
    db,
    async (m) => void told.push(m.content),
    at("2026-11-20T10:00:00Z"),
  );
  assert.equal(r.filed, 1);
  assert.equal(r.closed, 0); // seen just now, when it was filed
  assert.equal(
    ideasFileFor(cfg),
    path.join(data, "reports", "Challenge ideas.md"),
  );
  const md = await fs.readFile(r.ideas, "utf8");
  assert.match(md, /\[CHALLENGE: no guns\] \(already run\)/);
  assert.ok(told.some((t) => /Can I Beat GTA 6 Without Guns\?/.test(t)));
});

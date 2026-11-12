import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "./helpers.ts";
import {
  applyVerdict,
  claimQuestion,
  extractAsks,
  foldSightings,
  isNewsy,
  markCovered,
  openAsks,
  refreshList,
  scoreAsk,
  topicOf,
  type Mention,
  type StreamAsk,
} from "../src/streamasks/asks.ts";
import { mergeSeeds, parseSeed } from "../src/streamasks/seed.ts";
import { sightingsOf } from "../src/streamasks/extract.ts";
import {
  asksHtml,
  asksKey,
  asksMarkdown,
  dailyMessage,
} from "../src/streamasks/page.ts";
import { streamAsksSettings } from "../src/streamasks/settings.ts";
import {
  blueskyPosts,
  gameNamed,
  gatherPosts,
  pressPosts,
  searchTerms,
  youtubeGetter,
} from "../src/streamasks/sources.ts";
import { dailyDue, localClock, vodTurnCommand } from "../src/streamasks/job.ts";
import {
  decide,
  findMoments,
  mineVod,
  parseVerdict,
  verdictTimes,
} from "../src/streamasks/miner.ts";
import {
  asSceneIndex,
  parseVodIndex,
  parseVodName,
  saveVodIndex,
  loadVodIndex,
  type VodIndex,
} from "../src/vodindex/schema.ts";
import { detectGame, gamesStreamed } from "../src/vodindex/vods.ts";
import { spoilerWindow } from "../src/sceneindex/spoilers.ts";
import { emptySceneIndex, saveSceneIndex } from "../src/sceneindex/schema.ts";
import { findShots } from "../src/sceneindex/lookup.ts";

const GTA6 = "Grand Theft Auto VI";
const NOW = new Date("2026-11-20T12:00:00Z");
const mention = (o: Partial<Mention> = {}): Mention => ({
  source: "social",
  name: "Bluesky",
  at: NOW.toISOString(),
  text: "x",
  engagement: 0,
  ...o,
});

test("settings: both features are off unless switched on, Reddit only by choice", () => {
  const s = streamAsksSettings({});
  assert.equal(s.enabled, false);
  assert.equal(s.vodMiner, false);
  assert.ok(!s.sources.includes("reddit"));
  assert.deepEqual(s.games, [GTA6]);
  assert.equal(s.minConfidence, 0.75);
  const on = streamAsksSettings({
    STREAM_ASKS: "true",
    VOD_MINER: "1",
    STREAM_ASKS_SOURCES: "press,reddit,bogus",
    STREAM_ASKS_POST_AT: "9:00",
  });
  assert.equal(on.enabled, true);
  assert.equal(on.vodMiner, true);
  assert.deepEqual(on.sources, ["press", "reddit"]);
  assert.equal(on.postAt, "10:00", "a malformed time falls back");
});

test("extractAsks: questions, claims and requests about systems; news and chatter are not asks", () => {
  const q = extractAsks(
    "Honestly can you swim away from the cops in GTA 6? I need to know",
  );
  assert.equal(q.length, 1);
  assert.equal(q[0]!.kind, "question");
  assert.match(q[0]!.question, /^Can you swim away from the cops/);
  const c = extractAsks("Previews say you can rob every store in Vice City.");
  assert.equal(c[0]!.kind, "claim");
  assert.equal(c[0]!.question, "Can you really rob every store in Vice City?");
  const r = extractAsks(
    "A leaker claims you can't flip your car back over anymore.",
  );
  assert.equal(r[0]!.rumour, true, "a leak is labelled");
  const want = extractAsks(
    "Someone needs to test if the police react to your outfit.",
  );
  assert.equal(want[0]!.kind, "request");
  assert.deepEqual(
    extractAsks(
      "GTA 6 has sold 10 million copies in pre-orders, Rockstar confirmed.",
    ),
    [],
  );
  assert.deepEqual(
    extractAsks("Are you getting GTA 6?"),
    [],
    "not about a system",
  );
  assert.ok(isNewsy("the most pre-ordered game in PS Store history"));
  assert.equal(
    claimQuestion("You can't enter most buildings"),
    "Is it true you can't enter most buildings?",
  );
});

test("topics: one ask however it is said; GTA topics only for GTA", () => {
  assert.equal(
    topicOf("my car ran out of gas mid chase lol", GTA6)?.id,
    "fuel",
  );
  assert.equal(
    topicOf("does changing your outfit make the cops lose you", GTA6)?.id,
    "clothes-wanted",
  );
  assert.equal(
    topicOf("Rockstar confirmed it runs at 30 frames per second", GTA6)?.id,
    "performance",
  );
  assert.equal(
    topicOf("the sales tracker says 10 million", GTA6),
    undefined,
    "not a car tracker",
  );
  assert.equal(
    topicOf("my car ran out of fuel", "Mario Kart World"),
    undefined,
  );
  const s1 = sightingsOf([
    {
      source: "social",
      name: "Bluesky",
      at: NOW.toISOString(),
      text: "Can your car really run out of fuel in GTA 6?",
      engagement: 10,
      game: GTA6,
    },
  ]);
  const s2 = sightingsOf([
    {
      source: "comments",
      name: "YouTube comments: x",
      at: NOW.toISOString(),
      text: "Is it true cars run out of gas now?",
      engagement: 30,
      game: GTA6,
    },
  ]);
  const list = foldSightings(foldSightings([], s1, NOW), s2, NOW);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.topic, "fuel");
  assert.equal(list[0]!.mentionCount, 2);
  assert.equal(list[0]!.engagement, 40);
  assert.ok(
    list[0]!.cues.said.includes("out of gas"),
    "the miner gets the topic's cues",
  );
});

test("foldSightings: unknown asks join by shared words; spoilers are held", () => {
  const mk = (text: string) =>
    sightingsOf([
      {
        source: "social",
        name: "Bluesky",
        at: NOW.toISOString(),
        text,
        engagement: 1,
        game: GTA6,
      },
    ]);
  let list = foldSightings(
    [],
    mk("Can you ride a horse across the swamp in GTA 6?"),
    NOW,
  );
  list = foldSightings(
    list,
    mk("Can you ride a horse across the whole swamp?"),
    NOW,
  );
  assert.equal(list.length, 1);
  assert.equal(list[0]!.mentionCount, 2);
  list = foldSightings(
    list,
    mk("Does Lucia die in the final mission of GTA 6? Can you save her?"),
    NOW,
  );
  const held = list.find((a) => /die/.test(a.question));
  assert.equal(held?.status, "held");
  assert.equal(held?.spoiler, true);
});

test("sightingsOf: spam is dropped; a topic named in passing still counts as buzz", () => {
  assert.deepEqual(
    sightingsOf([
      {
        source: "social",
        name: "Bluesky",
        at: "",
        text: "GIVEAWAY! Can you rob every store? Follow me to win",
        engagement: 99,
        game: GTA6,
      },
    ]),
    [],
  );
  const s = sightingsOf([
    {
      source: "social",
      name: "Bluesky",
      at: "",
      text: "GTA 6 running at native 720p and targeting 30fps on PS5?",
      engagement: 5,
      game: GTA6,
    },
  ]);
  assert.equal(s.length, 1);
  assert.equal(topicOf(s[0]!.raw.text, GTA6)?.id, "performance");
});

test("scoring: viewers and the press outweigh one post; Pulse coverage drops an ask; stale and held leave the list", () => {
  const base = (o: Partial<StreamAsk>): StreamAsk => ({
    id: Math.random().toString(36).slice(2),
    game: GTA6,
    question: "Q?",
    claim: "",
    howToTest: "",
    kind: "question",
    rumour: false,
    earlyGame: true,
    spoiler: false,
    cues: { said: [], seen: [], text: [] },
    mentions: [mention()],
    mentionCount: 1,
    engagement: 0,
    firstSeen: "2026-11-18T00:00:00Z",
    lastSeen: NOW.toISOString(),
    status: "open",
    ...o,
  });
  const viewers = base({
    mentions: [
      mention({ source: "viewers" }),
      mention({ source: "press", name: "IGN" }),
    ],
    mentionCount: 2,
  });
  const one = base({});
  assert.ok(scoreAsk(viewers, NOW).score > scoreAsk(one, NOW).score);
  const covered = markCovered(
    [base({ topic: "fuel", question: "Can your car really run out of fuel?" })],
    [{ title: "I ran out of fuel in GTA 6 so you don't have to", game: GTA6 }],
  );
  assert.ok(covered[0]!.covered);
  assert.ok(
    scoreAsk(covered[0]!, NOW).score <
      scoreAsk(base({ topic: "fuel" }), NOW).score,
  );
  const old = base({ lastSeen: "2026-11-01T00:00:00Z" });
  const seedOld = base({
    lastSeen: "2026-11-01T00:00:00Z",
    mentions: [mention({ source: "seed" })],
  });
  const spoil = base({ spoiler: true });
  const list = refreshList([old, seedOld, spoil, one], NOW, { staleDays: 10 });
  assert.equal(list.find((a) => a.id === old.id)!.status, "stale");
  assert.equal(
    list.find((a) => a.id === seedOld.id)!.status,
    "open",
    "seeds last three times as long",
  );
  assert.equal(list.find((a) => a.id === spoil.id)!.status, "held");
  assert.equal(list[0]!.status, "open");
  const done = applyVerdict(list, one.id, {
    result: "proved",
    confidence: 0.9,
    vodId: "v1",
    recordedOn: "2026-11-19",
    at: 100,
    reason: "r",
    decidedAt: NOW.toISOString(),
  });
  assert.equal(done.find((a) => a.id === one.id)!.status, "proved");
  assert.equal(
    openAsks(done).some((a) => a.id === one.id),
    false,
    "a verdict moves it off the list",
  );
  const weaker = applyVerdict(done, one.id, {
    result: "disproved",
    confidence: 0.8,
    vodId: "v2",
    recordedOn: "",
    at: 1,
    reason: "",
    decidedAt: "",
  });
  assert.equal(
    weaker.find((a) => a.id === one.id)!.status,
    "proved",
    "a weaker verdict never replaces a stronger one",
  );
});

test("seed: the hand-made list becomes asks with its own tests, myths labelled", async () => {
  const md = await fs.readFile(
    path.resolve("docs", "streamasks-seed-gta6.md"),
    "utf8",
  );
  const seeds = parseSeed(md, GTA6, "2026-11-12T00:00:00Z");
  assert.ok(seeds.length >= 28, `got ${seeds.length}`);
  const fuel = seeds.find((a) => a.topic === "fuel")!;
  assert.equal(
    fuel.howToTest,
    "Drive one car until it stops. Time it. Then refuel and time that.",
  );
  assert.match(fuel.mentions[0]!.name, /Edge/);
  assert.equal(
    seeds.find((a) => a.topic === "interiors")!.rumour,
    true,
    "the 70% myth has no official source",
  );
  assert.equal(seeds.find((a) => a.topic === "story-length")!.earlyGame, false);
  assert.equal(
    seeds.find((a) => a.topic === "first-person")!.howToTest,
    "Check the settings menu on day 1.",
  );
  assert.equal(new Set(seeds.map((a) => a.id)).size, seeds.length);
  const merged = mergeSeeds([{ ...fuel, mentionCount: 9 }], seeds);
  assert.equal(merged.length, seeds.length);
  assert.equal(
    merged.find((a) => a.id === fuel.id)!.mentionCount,
    9,
    "history is kept",
  );
});

test("page and message: rumours say so, the page is noindex, the key is stable and secret-bound", () => {
  const a: StreamAsk = {
    id: "a1",
    game: GTA6,
    question: "Can you rob every store?",
    claim: "",
    howToTest: "Try ten shops.",
    kind: "claim",
    rumour: true,
    earlyGame: true,
    spoiler: false,
    cues: { said: [], seen: [], text: [] },
    mentions: [
      mention({
        text: "<b>leak</b> says every store",
        url: "https://bsky.app/x",
      }),
    ],
    mentionCount: 1,
    engagement: 3,
    firstSeen: NOW.toISOString(),
    lastSeen: NOW.toISOString(),
    status: "open",
    score: 5,
    why: ["1 mention"],
  };
  const msg = dailyMessage(
    [a, { ...a, id: "a2", rumour: false, question: "Second?" }],
    1,
    "https://pulsegmg.com/asks/k",
  );
  assert.match(msg, /1\. RUMOUR, unconfirmed: Can you rob every store\?/);
  assert.match(msg, /Test: Try ten shops\./);
  assert.doesNotMatch(msg, /Second/);
  assert.match(msg, /Full list: https:\/\/pulsegmg\.com\/asks\/k/);
  assert.ok(msg.length < 2000);
  const html = asksHtml([a], NOW);
  assert.match(html, /noindex,nofollow/);
  assert.doesNotMatch(html, /<b>leak/, "what people wrote is escaped");
  assert.match(asksMarkdown([a], NOW), /RUMOUR, unconfirmed/);
  assert.equal(asksKey("s1"), asksKey("s1"));
  assert.notEqual(asksKey("s1"), asksKey("s2"));
  assert.equal(asksKey("s1").length, 22);
  assert.equal(dailyMessage([], 5, ""), "");
});

test("sources: press and Bluesky as posts, Reddit and YouTube only when listed, an expired key falls back to the login", async () => {
  assert.equal(
    gameNamed("GTA 6 cops are wild", [GTA6, "Grand Theft Auto V"]),
    GTA6,
  );
  assert.equal(
    gameNamed("GTA V cops", [GTA6, "Grand Theft Auto V"]),
    "Grand Theft Auto V",
  );
  assert.deepEqual(searchTerms(GTA6), ["GTA 6", "GTA VI"]);
  assert.equal(
    pressPosts(
      [
        {
          title: "GTA 6 has a fuel system",
          url: "u",
          summary: "",
          publishedAt: NOW.toISOString(),
          source: "IGN",
          sourceKind: "outlet",
        },
        {
          title: "Mario news",
          url: "u",
          summary: "",
          publishedAt: "",
          source: "IGN",
          sourceKind: "outlet",
        },
      ],
      [GTA6],
    ).length,
    1,
  );
  const bs = blueskyPosts(
    [
      {
        uri: "at://did/app.bsky.feed.post/abc",
        author: { handle: "a.bsky.social" },
        record: { text: "hi", createdAt: "2026-11-20T00:00:00Z" },
        likeCount: 2,
        repostCount: 1,
      },
    ],
    GTA6,
  );
  assert.equal(bs[0]!.url, "https://bsky.app/profile/a.bsky.social/post/abc");
  assert.equal(bs[0]!.engagement, 4);
  const asked: string[] = [];
  const fetchFake = async (url: string) => {
    asked.push(url);
    return new Response(
      JSON.stringify({
        posts: [
          { record: { text: "Can you swim away from the cops in GTA 6?" } },
        ],
      }),
      { status: 200 },
    );
  };
  const r = await gatherPosts(
    [GTA6],
    ["bluesky"],
    { youtubeApiKey: "" },
    { fetch: fetchFake, feeds: async () => [] },
  );
  assert.ok(asked.every((u) => !u.includes("reddit.com")));
  assert.equal(r.posts.length, 2, "one search term, top and latest");
  const noYt = await gatherPosts(
    [GTA6],
    ["youtube"],
    { youtubeApiKey: "" },
    { fetch: fetchFake },
  );
  assert.match(noYt.notes[0]!, /unavailable/);
  const calls: Array<{ url: string; auth?: string }> = [];
  const yt = youtubeGetter(
    "dead",
    async (url, init) => {
      calls.push({
        url,
        auth: (init?.headers as Record<string, string> | undefined)
          ?.authorization,
      });
      return new Response("{}", { status: url.includes("key=") ? 400 : 200 });
    },
    async () => "tok",
  );
  assert.equal((await yt("search?q=x")).status, 200);
  assert.equal((await yt("search?q=y")).status, 200);
  assert.equal(calls.length, 3, "the dead key is tried once");
  assert.equal(calls[2]!.auth, "Bearer tok");
});

test("job clock: the daily message once a day from its time; the turn waits its turn on each machine", () => {
  const c = localClock(new Date("2026-11-20T10:30:00Z"), "Europe/London");
  assert.deepEqual(c, { day: "2026-11-20", minutes: 630 });
  assert.equal(dailyDue({}, c, "10:00"), true);
  assert.equal(dailyDue({ postedDay: "2026-11-20" }, c, "10:00"), false);
  assert.equal(dailyDue({}, c, "11:00"), false);
  assert.deepEqual(
    vodTurnCommand("darwin", { macrun: "/m.sh" }, "node", ["a"], 20),
    ["/bin/bash", ["/m.sh", "pulse-vodindex", "node", "a"]],
  );
  const [cmd, args] = vodTurnCommand(
    "win32",
    { orch: "C:\\o.cmd" },
    "node",
    ["a"],
    20,
  );
  assert.equal(cmd, "cmd.exe");
  assert.deepEqual(
    args.slice(args.indexOf("--class"), args.indexOf("--class") + 2),
    ["--class", "gpu"],
  );
  assert.equal(args[args.indexOf("--priority") + 1], "20");
  assert.equal(args[args.indexOf("--est") + 1], "20");
});

// ---------------------------------------------------------------- the stream index and the miner

function fakeVod(): VodIndex {
  const shot = (
    id: number,
    start: number,
    desc: string,
    text = "",
    tags: string[] = [],
  ) => ({
    id,
    start,
    end: start + 10,
    keyframes: [start + 5],
    desc,
    who: [],
    where: "",
    mood: "",
    tags,
    text,
    luma: 90,
    motion: 10,
  });
  return {
    version: 1,
    vodId: "v2917738469",
    file: "/vods/2026-11-19 GTA VI day one [v2917738469].mp4",
    title: "GTA VI day one",
    game: GTA6,
    recordedOn: "2026-11-19",
    duration: 600,
    builtAt: "2026-11-19T23:00:00Z",
    coverage: [{ from: 0, to: 600 }],
    shots: [
      shot(0, 0, "a man walks down a sunny street"),
      shot(1, 100, "a red car drives along a highway", "", ["road", "car"]),
      shot(2, 110, "a car stopped on the road with smoke", "", [
        "empty",
        "fuel",
        "gauge",
      ]),
      shot(3, 120, "a man fills a car at a gas station pump", "FUEL", ["pump"]),
      shot(4, 400, "a man in a clothing store", "", ["outfit"]),
    ],
    lines: [
      {
        id: 0,
        start: 112,
        end: 116,
        text: "no way, we ran out of gas",
        via: "voice",
        shot: 2,
      },
      {
        id: 1,
        start: 405,
        end: 409,
        text: "nice jacket",
        via: "voice",
        shot: 4,
      },
    ],
  };
}

const fuelAsk = (): StreamAsk => ({
  id: "fuel1",
  game: GTA6,
  topic: "fuel",
  question: "Can your car really run out of fuel?",
  claim: "Every car has a fuel gauge (Edge)",
  howToTest: "Drive until it stops.",
  kind: "claim",
  rumour: false,
  earlyGame: true,
  spoiler: false,
  cues: topicOf("fuel", GTA6)!.cues,
  mentions: [mention({ source: "seed" })],
  mentionCount: 1,
  engagement: 0,
  firstSeen: NOW.toISOString(),
  lastSeen: NOW.toISOString(),
  status: "open",
});

test("vod index: names, games and the scene index's lookups work on a stream", async () => {
  assert.deepEqual(parseVodName("/x/2026-11-02 GTA V 100% [v2917738469].mp4"), {
    vodId: "v2917738469",
    title: "GTA V 100%",
    recordedOn: "2026-11-02",
  });
  assert.equal(parseVodName("/x/clip.mp4").vodId, "f-clip");
  assert.equal(
    detectGame("GTA V 100%", [GTA6, "Grand Theft Auto V"]),
    "Grand Theft Auto V",
  );
  assert.equal(
    detectGame("GTA VI first day!", [GTA6, "Grand Theft Auto V"]),
    GTA6,
  );
  assert.equal(detectGame("Silent Hill: Feegie Park", [GTA6]), undefined);
  assert.deepEqual(
    gamesStreamed(
      [
        {
          file: "",
          vodId: "1",
          title: "",
          recordedOn: "2026-11-19",
          game: GTA6,
          bytes: 1,
          mtimeMs: 1,
        },
        {
          file: "",
          vodId: "2",
          title: "",
          recordedOn: "2026-10-01",
          game: "Old",
          bytes: 1,
          mtimeMs: 1,
        },
      ],
      "2026-11-20",
      3,
    ),
    [GTA6],
  );
  const v = fakeVod();
  const hits = findShots(asSceneIndex(v), {
    text: "a car stopped on the road",
  });
  assert.equal(hits[0]?.shot, 2);
  const dir = await tmpDir();
  await saveVodIndex(dir, v);
  const back = await loadVodIndex(dir, v.vodId);
  assert.equal(back?.shots.length, 5);
  assert.equal(
    parseVodIndex({ ...v, version: 99 }),
    undefined,
    "a newer file is never misread",
  );
});

test("findMoments: words, writing and pictures together find the moment; one kind alone scores lower", () => {
  const moments = findMoments(fakeVod(), fuelAsk());
  assert.ok(moments.length >= 1);
  const best = moments[0]!;
  assert.ok(best.peak >= 100 && best.peak <= 130, `peak ${best.peak}`);
  assert.ok(best.signals.includes("said") && best.signals.includes("seen"));
  assert.ok(best.cue >= 0.45);
  assert.equal(
    findMoments(fakeVod(), {
      ...fuelAsk(),
      cues: { said: ["helicopter"], seen: ["a plane"], text: [] },
    }).length,
    0,
  );
  assert.deepEqual(verdictTimes(0, 60, 3), [10, 30, 50]);
});

test("decide: proved or disproved only when sure and backed by two kinds of evidence", () => {
  const two = { signals: ["said", "seen"] as const, cue: 0.8 };
  assert.equal(
    decide(
      { verdict: "proved", confidence: 0.8, reason: "r", best: 1 },
      { ...two, signals: [...two.signals] },
      0.75,
    ).result,
    "proved",
  );
  assert.equal(
    decide(
      { verdict: "proved", confidence: 0.7, reason: "r", best: 1 },
      { ...two, signals: [...two.signals] },
      0.75,
    ).result,
    "unclear",
  );
  assert.equal(
    decide(
      { verdict: "disproved", confidence: 0.8, reason: "r", best: 1 },
      { signals: ["seen"], cue: 0.5 },
      0.75,
    ).result,
    "unclear",
  );
  assert.equal(
    decide(
      { verdict: "disproved", confidence: 0.95, reason: "r", best: 1 },
      { signals: ["seen"], cue: 0.5 },
      0.75,
    ).result,
    "disproved",
  );
  assert.equal(
    decide(
      { verdict: "unclear", confidence: 1, reason: "", best: 1 },
      { ...two, signals: [...two.signals] },
      0.5,
    ).result,
    "unclear",
  );
  assert.deepEqual(
    parseVerdict({ verdict: "maybe", confidence: 80, best: 9 }, 6),
    { verdict: "unclear", confidence: 0.8, reason: "", best: 6 },
  );
});

test("mineVod: a confident moment proves the ask, lands in the lane's inbox and the week's list; unclear stays open", async () => {
  const dir = await tmpDir();
  const deps = {
    frame: async (_f: string, _t: number, out: string) =>
      fs.writeFile(out, "jpg"),
    strip: async (_f: string, _t: number[], out: string) =>
      fs.writeFile(out, "jpg"),
    cut: async (_f: string, _s: number, _l: number, out: string) =>
      fs.writeFile(out, "mp4"),
    now: () => NOW,
    windows: [],
  };
  const s = {
    dataDir: dir,
    minCue: 0.45,
    minConfidence: 0.75,
    toLane: true,
    gameplayRoot: path.join(dir, "gp"),
    spoilerGuard: true,
  };
  const r = await mineVod(fakeVod(), [fuelAsk()], s, {
    ...deps,
    verdict: async () => ({
      verdict: "proved",
      confidence: 0.86,
      reason: "the car stops with an empty gauge",
      best: 3,
    }),
  });
  assert.equal(r.asks[0]!.status, "proved");
  assert.equal(r.asks[0]!.verdict?.vodId, "v2917738469");
  const m = r.moments[0]!;
  assert.ok(m.inbox);
  const meta = JSON.parse(
    await fs.readFile(path.join(m.inbox!, "meta.json"), "utf8"),
  );
  assert.equal(meta.status, "new");
  assert.equal(meta.stream_ask.verdict, "proved");
  assert.equal(meta.frames.length, 8);
  const tested = JSON.parse(
    await fs.readFile(path.join(dir, "streamasks", "tested.json"), "utf8"),
  );
  assert.equal(tested[0].question, "Can your car really run out of fuel?");
  // The same moment is never judged twice.
  let asked = 0;
  const again = await mineVod(fakeVod(), [fuelAsk()], s, {
    ...deps,
    verdict: async () => (
      asked++,
      { verdict: "proved", confidence: 0.9, reason: "", best: 1 }
    ),
  });
  assert.equal(asked, 0);
  assert.equal(again.asks[0]!.status, "proved", "a list rewritten meanwhile gets the verdict back");

  const dir2 = await tmpDir();
  const u = await mineVod(
    fakeVod(),
    [fuelAsk()],
    { ...s, dataDir: dir2, gameplayRoot: path.join(dir2, "gp") },
    {
      ...deps,
      verdict: async () => ({
        verdict: "proved",
        confidence: 0.6,
        reason: "maybe",
        best: 1,
      }),
    },
  );
  assert.equal(u.asks[0]!.status, "open");
  assert.equal(u.asks[0]!.unclear, u.moments.length);
  assert.equal(
    u.moments.every((x) => !x.inbox),
    true,
    "an unclear moment never goes to the lane",
  );
});

test("mineVod: the spoiler guard holds a story cutscene from the lane during the window", async () => {
  const dir = await tmpDir();
  const w = spoilerWindow(GTA6, "2026-11-19", { days: 28, openingShare: 0.1 })!;
  const v = fakeVod();
  // The moment's words are a line the game's scene index places late in the story: a story cutscene.
  const story = "you will never see your brother again unless you bring me the money tonight";
  v.lines = [
    { id: 0, start: 108, end: 111, text: "we ran out of gas", via: "voice", shot: 2 },
    { id: 1, start: 112, end: 118, text: story, via: "voice", shot: 2 },
  ];
  const scene = emptySceneIndex(GTA6, { videoId: "abcdefghijk", title: "movie", uploader: "u", duration: 3600, kind: "movie", pickedAt: "" }, NOW);
  scene.coverage = [{ from: 0, to: 3600 }];
  scene.lines = [{ id: 0, start: 2000, end: 2006, text: story, via: "voice", shot: 0 }];
  await saveSceneIndex(dir, scene);
  const r = await mineVod(
    v,
    [fuelAsk()],
    {
      dataDir: dir,
      minCue: 0.45,
      minConfidence: 0.75,
      toLane: true,
      gameplayRoot: path.join(dir, "gp"),
      spoilerGuard: true,
    },
    {
      frame: async (_f, _t, out) => fs.writeFile(out, "jpg"),
      strip: async (_f, _t, out) => fs.writeFile(out, "jpg"),
      cut: async (_f, _s, _l, out) => fs.writeFile(out, "mp4"),
      verdict: async () => ({
        verdict: "proved",
        confidence: 0.9,
        reason: "r",
        best: 1,
      }),
      windows: [w],
      now: () => NOW,
    },
  );
  const m = r.moments[0]!;
  assert.ok(m.held, "held");
  assert.equal(m.inbox, undefined);
});

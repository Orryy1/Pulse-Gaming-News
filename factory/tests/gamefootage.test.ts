// GAME_FETCH (footage of every big release into the scene index) and SPOILER_GUARD (no story spoilers during a
// game's first weeks), with synthetic indexes, uploads and drafts: no game, network or model needed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { testConfig, tmpDir } from "./helpers.ts";
import {
  emptySceneIndex,
  saveSceneIndex,
  type SceneIndex,
  type SceneShot,
} from "../src/sceneindex/schema.ts";
import {
  clipStoryMoment,
  footageAllowed,
  gameAliases,
  hasSpoilerWarning,
  lateTerms,
  setSpoilerWindows,
  spoilerHits,
  spoilerProblems,
  spoilerWindow,
  streamClipHold,
  windowFor,
  windowOpen,
  type SpoilerWindow,
} from "../src/sceneindex/spoilers.ts";
import {
  judgeUploads,
  moreCompleteSource,
  pickComplete,
  pickSource,
} from "../src/sceneindex/build.ts";
import {
  fetchCandidates,
  fetchPlan,
  filedLines,
  filedStatus,
  gameFetchPass,
  mergeFiled,
  canonicalGame,
  isAddOn,
  isHardware,
  isSeriesName,
  pruneFiled,
  resolveSeries,
  unplanDropped,
  type FiledGame,
  parseFetchTitles,
  parseSignals,
  readFiled,
} from "../src/sceneindex/gamefetch.ts";
import {
  nextJob,
  planGame,
  readQueue,
  sceneIndexTick,
  type SceneQueue,
} from "../src/sceneindex/job.ts";
import {
  indexFirstCutscenes,
  planIndexedClips,
  spoilerAllow,
} from "../src/sceneindex/footage.ts";
import { speechShare } from "../src/sceneindex/spoilerclips.ts";
import { phraseProblems } from "../src/editorial/voice.ts";
import { guardScript, scriptSpoilers } from "../src/writerguard.ts";
import type { CutsceneClip, CutsceneUpload } from "../src/assets/cutscenes.ts";
import type { FootageTarget } from "../src/assets/clipscore.ts";

const GTA = "Grand Theft Auto VI";
const DURING = new Date("2026-11-25T12:00:00Z");
const AFTER = new Date("2026-12-20T12:00:00Z");
const SETTINGS = { days: 28, openingShare: 0.1 };

/** A 10-hour GTA VI movie: the opening hour, then the story's late part. */
function gtaIndex(): SceneIndex {
  const index = emptySceneIndex(
    GTA,
    {
      videoId: "abcdefghijk",
      title: "GTA VI All Cutscenes (Full Game Movie)",
      uploader: "Clean Movies",
      duration: 36_000,
      height: 2160,
      kind: "movie",
      pickedAt: "2026-11-19T00:00:00Z",
    },
    new Date("2026-11-19T00:00:00Z"),
  );
  const shot = (
    id: number,
    start: number,
    desc: string,
    who: string[],
    where: string,
  ): SceneShot => ({
    id,
    start,
    end: start + 8,
    keyframes: [start + 4],
    desc,
    who,
    where,
    mood: "",
    tags: [],
    text: "",
    luma: 90,
    motion: 20,
  });
  index.cast = ["Lucia", "Jason", "Cal", "Brian"];
  index.places = ["Vice City", "Leonida Keys", "Port Gellhorn"];
  index.shots = [
    shot(
      0,
      100,
      "Lucia walks out of the prison gates into the sun",
      ["Lucia"],
      "Leonida Keys",
    ),
    shot(
      1,
      900,
      "Jason drives a red convertible along the Vice City beach road",
      ["Jason"],
      "Vice City",
    ),
    shot(
      2,
      2400,
      "Lucia and Jason laugh at a petrol station at night",
      ["Lucia", "Jason"],
      "Vice City",
    ),
    shot(
      3,
      20_000,
      "Lucia and Jason drive a red convertible through Port Gellhorn",
      ["Lucia", "Jason", "Cal"],
      "Port Gellhorn",
    ),
    shot(
      4,
      34_000,
      "Jason kneels by the water as the sun sets",
      ["Jason"],
      "Leonida Keys",
    ),
  ];
  index.lines = [
    {
      id: 0,
      start: 905,
      end: 909,
      text: "Nobody in this town is ever going to stop us now",
      via: "voice",
      shot: 1,
    },
    {
      id: 1,
      start: 34_002,
      end: 34_007,
      text: "So this is how it all ends for the two of us",
      via: "voice",
      shot: 4,
    },
  ];
  index.coverage = [{ from: 0, to: 36_000 }];
  return index;
}

const gtaWindow = (index?: SceneIndex) =>
  spoilerWindow(GTA, "2026-11-18T11:00Z", {
    ...SETTINGS,
    until: "2026-12-17",
    lateTerms: index ? lateTerms(index, 0.1) : [],
  })!;

test("a spoiler window runs from the first release to the end of its last day; GTA VI goes by all its names", () => {
  const w = gtaWindow();
  assert.equal(w.from, "2026-11-18T11:00:00.000Z");
  assert.equal(w.until, "2026-12-18T00:00:00.000Z");
  assert.equal(windowOpen(w, new Date("2026-11-18T10:59:00Z")), false);
  assert.equal(windowOpen(w, DURING), true);
  assert.equal(windowOpen(w, new Date("2026-12-17T23:00:00Z")), true);
  assert.equal(windowOpen(w, AFTER), false);
  for (const name of ["GTA VI", "GTA 6", "GTA6", "Grand Theft Auto 6"])
    assert.ok(gameAliases(GTA).includes(name), name);
  assert.equal(windowFor([w], "GTA 6", DURING)?.game, GTA);
  assert.equal(windowFor([w], "Halo 3", DURING), undefined);
  // The default: four weeks after a date-only release, which starts the day before (New Zealand is ahead).
  const d = spoilerWindow("Some Game", "2026-11-19", SETTINGS)!;
  assert.equal(d.from, "2026-11-18T00:00:00.000Z");
  assert.equal(d.until, "2026-12-18T00:00:00.000Z");
});

test("the names the index first meets after the opening are the late ones", () => {
  assert.deepEqual(lateTerms(gtaIndex(), 0.1), ["Cal", "Port Gellhorn"]);
});

test("footage: an early-story shot passes, a late-story shot is blocked in every short form and passes after the window", () => {
  const index = gtaIndex();
  const w = gtaWindow(index);
  const early = 904;
  const late = 20_004;
  assert.equal(footageAllowed(w, index, early, "short", DURING).ok, true);
  assert.equal(footageAllowed(w, index, early, "thumbnail", DURING).ok, true);
  for (const use of [
    "short",
    "title",
    "thumbnail",
    "cover",
    "first-frame",
  ] as const)
    assert.equal(footageAllowed(w, index, late, use, DURING).ok, false, use);
  // A long video: only after its spoiler warning, never in its first minute.
  assert.equal(footageAllowed(w, index, late, "long", DURING).ok, false);
  assert.equal(
    footageAllowed(w, index, late, "long", DURING, {
      warned: true,
      placedAt: 30,
    }).ok,
    false,
  );
  assert.equal(
    footageAllowed(w, index, late, "long", DURING, {
      warned: true,
      placedAt: 300,
    }).ok,
    true,
  );
  // After the window anything goes.
  assert.equal(footageAllowed(w, index, late, "short", AFTER).ok, true);
  assert.equal(
    hasSpoilerWarning([
      "Spoiler warning: this one covers the whole story.",
      "x",
    ]),
    true,
  );
  assert.equal(
    hasSpoilerWarning(["A spoiler-free look at the opening hours.", "x"]),
    false,
  );
});

test("the planner never gives a Short a late shot during the window, and does after it", () => {
  const index = gtaIndex();
  const w = gtaWindow(index);
  const targets: FootageTarget[] = [
    {
      key: "beat:1",
      text: "Jason drives a red convertible",
      want: "cinematic",
      energy: "medium",
      keywords: ["convertible"],
    },
    {
      key: "beat:2",
      text: "Lucia and Jason drive a red convertible through Port Gellhorn",
      want: "cinematic",
      energy: "medium",
      keywords: [],
    },
  ];
  const plan = (now: Date) => {
    const allow = spoilerAllow(w, { long: false }, now);
    return planIndexedClips(index, targets, {
      maxClips: 4,
      maxSeconds: 30,
      minConfidence: 0.3,
      allow: (shot, key) =>
        allow(index, shot.start, key) && allow(index, shot.end - 0.05, key),
    }).map((p) => p.shot);
  };
  assert.ok(!plan(DURING).includes(3), "the late shot is not used");
  assert.ok(plan(DURING).includes(1));
  assert.ok(plan(AFTER).includes(3), "after the window it is");
});

test("the ordinary cutscene search keeps only moments the index places in the opening during the window", async () => {
  const dir = await tmpDir();
  const index = gtaIndex();
  await saveSceneIndex(dir, index);
  const w = gtaWindow(index);
  const clip = (videoId: string, from: number, beatIndex = 1): CutsceneClip =>
    ({
      kind: "clip",
      file: `a_${from}.mp4`,
      sourceUrl: "",
      durationSeconds: 4,
      beatIndex,
      provenance: "",
      credit: "",
      youtubeSource: { videoId, title: "", uploader: "" },
      span: {
        source: `https://www.youtube.com/watch?v=${videoId}`,
        from,
        to: from + 4,
      },
    }) as unknown as CutsceneClip;
  const found = [
    clip("abcdefghijk", 903),
    clip("abcdefghijk", 20_001),
    clip("zzzzzzzzzzz", 50),
  ];
  const options = {
    gameTitle: GTA,
    episodeDir: dir,
    targets: [],
    maxClips: 4,
    maxSeconds: 20,
  };
  const cfg = testConfig(dir, { sceneIndex: false, spoilerGuard: true });
  const during = await indexFirstCutscenes(
    cfg,
    options,
    async () => found,
    undefined,
    DURING,
    [w],
  );
  assert.deepEqual(
    during.map((c) => c.span.from),
    [903],
  );
  const after = await indexFirstCutscenes(
    cfg,
    options,
    async () => found,
    undefined,
    AFTER,
    [w],
  );
  assert.equal(after.length, 3);
  const off = await indexFirstCutscenes(
    testConfig(dir),
    options,
    async () => found,
    undefined,
    DURING,
    [w],
  );
  assert.equal(off.length, 3, "SPOILER_GUARD off changes nothing");
});

test("words: 'the ending' and late names are blocked for the game during the window and pass after it", () => {
  const index = gtaIndex();
  const w = gtaWindow(index);
  const ending = "GTA 6 has the ending everyone will argue about for years.";
  assert.equal(spoilerHits(ending, [w], DURING).length, 1);
  assert.equal(spoilerHits(ending, [w], AFTER).length, 0);
  // A line about the game that does not name it counts when the script is about it.
  assert.equal(
    spoilerHits("Then Cal turns up in the swamp.", [w], DURING, [GTA]).length,
    1,
  );
  assert.equal(
    spoilerHits("Lucia walks out of prison in the first scene.", [w], DURING, [
      GTA,
    ]).length,
    0,
  );
  assert.equal(
    spoilerHits("Jason dies in the final mission.", [w], DURING, [GTA]).length,
    2,
  );
  // Another game's ending is not this window's business.
  assert.equal(
    spoilerHits(
      "Red Dead Redemption 2 has the ending everyone remembers.",
      [w],
      DURING,
    ).length,
    0,
  );
  // The writers' validators send it back while the window is registered.
  // phraseProblems reads the clock: a window that opened yesterday.
  const today = spoilerWindow(
    GTA,
    new Date(Date.now() - 86_400_000).toISOString(),
    SETTINGS,
  )!;
  setSpoilerWindows([w, today]);
  try {
    assert.ok(spoilerProblems(ending, DURING)[0]?.includes("the ending"));
    assert.ok(
      phraseProblems("GTA 6 has a plot twist in its last act.").some((p) =>
        p.includes("plot twist"),
      ),
    );
  } finally {
    setSpoilerWindows([]);
  }
  assert.deepEqual(spoilerProblems(ending, DURING), []);
});

test("the door after the writer stops a script that spoils a game in its window", async () => {
  const w = gtaWindow(gtaIndex());
  const script = {
    game_title: GTA,
    headline: "GTA 6's best opening hour",
    hook: "The first hour of GTA 6 is wild.",
    beats: [
      { narration: "You start in a prison yard." },
      { narration: "And the ending ties it all together." },
    ],
    youtube: { title: "GTA 6's first hour", description: "" },
  };
  const hits = scriptSpoilers(script as never, [w], DURING);
  assert.deepEqual(
    hits.map((h) => [h.where, h.what]),
    [["beat 1", "the ending"]],
  );
  assert.deepEqual(scriptSpoilers(script as never, [w], AFTER), []);
  const sent: string[] = [];
  const s = {
    db: {
      query: async () => [],
      exec: async () => undefined,
      close: async () => undefined,
    },
    notify: async (m: { content?: string }) => void sent.push(m.content ?? ""),
    cfg: { writerNotesGuard: true, spoilerGuard: true },
  };
  await assert.rejects(
    guardScript(
      s as never,
      { id: "e1" } as never,
      script as never,
      "after writing",
      [w],
      DURING,
    ),
    /story spoiler/,
  );
  assert.match(sent[0]!, /spoil a game still in its spoiler window/);
  await guardScript(
    s as never,
    { id: "e1" } as never,
    script as never,
    "after writing",
    [w],
    AFTER,
  );
  await guardScript(
    { ...s, cfg: { spoilerGuard: false } } as never,
    { id: "e1" } as never,
    script as never,
    "after writing",
    [w],
    DURING,
  );
});

test("the owner's stream clips: gameplay goes on, story cutscenes beyond the opening wait for the window to close", () => {
  const index = gtaIndex();
  const w = gtaWindow(index);
  // A chase with the owner talking over it: no bars, not a scene's line.
  assert.equal(
    streamClipHold(w, index, { speechShare: 0.7, letterboxShare: 0 }, DURING)
      .hold,
    false,
  );
  // Cinema bars on most frames: a cutscene.
  assert.equal(
    streamClipHold(w, index, { letterboxShare: 0.75 }, DURING).hold,
    true,
  );
  assert.equal(
    streamClipHold(w, index, { speechShare: 0.6, letterboxShare: 0.25 }, DURING)
      .hold,
    true,
  );
  assert.equal(
    streamClipHold(w, index, { reviewSpoiler: true }, DURING).hold,
    true,
  );
  // The clip's words are a line of the index: the opening's line passes, the late one waits.
  const early = clipStoryMoment(
    index,
    "uh nobody in this town is ever going to stop us now haha",
  );
  const late = clipStoryMoment(
    index,
    "so this is how it all ends for the two of us",
  );
  assert.equal(early, 905);
  assert.equal(late, 34_002);
  assert.equal(
    streamClipHold(w, index, { letterboxShare: 0.9, storyAt: early }, DURING)
      .hold,
    false,
  );
  assert.equal(streamClipHold(w, index, { storyAt: late }, DURING).hold, true);
  assert.equal(
    streamClipHold(w, index, { storyAt: late, letterboxShare: 1 }, AFTER).hold,
    false,
  );
  assert.equal(
    clipStoryMoment(
      index,
      "watch this jump off the pier into the water lets go",
    ),
    undefined,
  );
  assert.ok(
    Math.abs(
      speechShare(
        [
          { start: 0, end: 1 },
          { start: 1.2, end: 2 },
          { start: 10, end: 11 },
        ],
        20,
      ) - 0.15,
    ) < 1e-9,
  );
});

// ---- launch fetching ----

const up = (
  videoId: string,
  title: string,
  minutes: number,
  height?: number,
  extra: Partial<CutsceneUpload> = {},
): CutsceneUpload => ({
  videoId,
  title,
  uploader: "Someone",
  duration: minutes * 60,
  ...(height ? { height } : {}),
  isLive: false,
  liveStatus: "not_live",
  ...extra,
});

test("launch sources: the most complete clean upload, never parts, dubs, one character, previews or low resolution", () => {
  const game = "Resident Evil Requiem";
  const list = [
    up(
      "aaaaaaaaaa1",
      "Resident Evil Requiem: All Cutscenes (Full Game Movie)",
      145,
      1440,
    ),
    up(
      "aaaaaaaaaa2",
      "RESIDENT EVIL REQUIEM All Cutscenes (Full Game Movie) 4K 60FPS Ultra HD",
      133,
      2160,
    ),
    up(
      "aaaaaaaaaa3",
      "Resident Evil Requiem Full Movie | All Cutscenes + Complete Story | 4K 60FPS Türkçe Altyazılı",
      146,
      2160,
    ),
    up(
      "aaaaaaaaaa4",
      "All Leon Cutscenes | Resident Evil Requiem (RE9)",
      150,
      1440,
    ),
    up(
      "aaaaaaaaaa5",
      "Resident Evil Requiem Gameplay Walkthrough - Part 11 No Commentary",
      74,
    ),
    up("aaaaaaaaaa6", "Resident Evil Requiem All Cutscenes Reaction", 200),
    up(
      "aaaaaaaaaa7",
      "Resident Evil Requiem — All Cutscenes | Full Game Movie [No Commentary]",
      135,
      720,
    ),
    up(
      "aaaaaaaaaa8",
      "Resident Evil Requiem Full Game Movie | Cinematic Gameplay (4K No Commentary)",
      500,
      2160,
    ),
    up(
      "aaaaaaaaaa9",
      "Resident Evil Requiem Extended Look Full Movie",
      30,
      1080,
    ),
    up(
      "aaaaaaaaab1",
      "Resident Evil Requiem All Cutscenes No Subtitles",
      120,
      1080,
    ),
    up(
      "aaaaaaaaab2",
      'Resident Evil Requiem "GAME MOVIE" [GERMAN/PC/4K/60FPS]',
      265,
      2160,
    ),
  ];
  const v = new Map(
    judgeUploads(list, game, { recentRelease: true }).map((x) => [
      x.upload.videoId,
      x,
    ]),
  );
  assert.equal(v.get("aaaaaaaaaa1")!.ok, true);
  assert.equal(
    v.get("aaaaaaaaab1")!.ok,
    true,
    "'No Subtitles' is a clean upload",
  );
  for (const id of [
    "aaaaaaaaaa3",
    "aaaaaaaaaa4",
    "aaaaaaaaaa5",
    "aaaaaaaaaa6",
    "aaaaaaaaaa7",
    "aaaaaaaaaa9",
    "aaaaaaaaab2",
  ])
    assert.equal(v.get(id)!.ok, false, `${id}: ${v.get(id)!.reason}`);
  assert.equal(v.get("aaaaaaaaaa8")!.kind, "playthrough");
  assert.equal(
    pickComplete(list, game, { recentRelease: true })?.videoId,
    "aaaaaaaaaa1",
  );
  assert.equal(
    pickSource(list, game, { recentRelease: true, complete: true })?.videoId,
    "aaaaaaaaaa1",
  );
  // An upload from before the release is marketing, not the game.
  const old = up(
    "aaaaaaaaab3",
    "Grand Theft Auto VI All Cutscenes Full Movie",
    30,
    1080,
    { uploadDate: "2026-08-20" },
  );
  assert.match(
    judgeUploads([old], GTA, { releasedOn: "2026-11-18" })[0]!.reason,
    /before the game came out/,
  );
  assert.equal(
    judgeUploads([{ ...old, uploadDate: "2026-11-21" }], GTA, {
      releasedOn: "2026-11-18",
    })[0]!.ok,
    true,
  );
});

test("a later, clearly longer upload replaces the index's source; a shorter one never does", () => {
  const cur = {
    videoId: "aaaaaaaaaa1",
    kind: "movie" as const,
    height: 1080,
    duration: 3600,
  };
  assert.equal(
    moreCompleteSource(cur, {
      videoId: "bbbbbbbbbb1",
      kind: "movie",
      height: 1080,
      duration: 4500,
    }),
    true,
  );
  assert.equal(
    moreCompleteSource(cur, {
      videoId: "bbbbbbbbbb2",
      kind: "movie",
      height: 2160,
      duration: 2000,
    }),
    false,
  );
  assert.equal(
    moreCompleteSource(cur, {
      videoId: "bbbbbbbbbb3",
      kind: "playthrough",
      height: 2160,
      duration: 30000,
    }),
    false,
  );
  assert.equal(
    moreCompleteSource(
      { ...cur, kind: "playthrough" },
      { videoId: "bbbbbbbbbb4", kind: "movie", height: 1080, duration: 3000 },
    ),
    true,
  );
});

test("the fetcher picks games from every signal and plans them from release", () => {
  assert.deepEqual(
    parseFetchTitles(
      "Grand Theft Auto VI@2026-11-18T11:00Z~2026-12-17; Halo, Reach",
    ),
    [
      { game: GTA, release: "2026-11-18T11:00Z", until: "2026-12-17" },
      { game: "Halo, Reach" },
    ],
  );
  assert.equal(parseSignals("").size, 5);
  assert.deepEqual([...parseSignals("titles,calendar")], ["owner", "calendar"]);
  const now = new Date("2026-11-12T12:00:00Z");
  const c = fetchCandidates({
    titles: parseFetchTitles(
      "Grand Theft Auto VI@2026-11-18T11:00Z~2026-12-17",
    ),
    launches: [
      { game: GTA, match: "GTA", launch: "2026-11-19" },
      { game: "Old Game", match: "x", launch: "2025-01-01" },
    ],
    radar: [
      { name: "Indie Thing", appId: 1, date: "2026-11-20" },
      { name: "Big Sequel", appId: 2, date: "2026-11-13" },
    ],
    stories: [
      {
        name: "Big Sequel",
        event: "release",
        size: 90,
        firstAt: "2026-11-11T08:00:00Z",
      },
      {
        name: "Small News",
        event: "release",
        size: 20,
        firstAt: "2026-11-11T08:00:00Z",
      },
      {
        name: "Delayed Game",
        event: "delay",
        size: 95,
        firstAt: "2026-11-11T08:00:00Z",
      },
    ],
    videoGames: [
      { game: "Halo 3", at: "2026-11-10T00:00:00Z" },
      { game: "halo 3", at: "2026-11-11T00:00:00Z" },
      { game: "Once Only", at: "2026-11-11T00:00:00Z" },
    ],
    bigSize: 70,
    now,
    signals: parseSignals(""),
  });
  assert.deepEqual(
    c.map((x) => [x.game, x.signal]),
    [
      [GTA, "owner"],
      [GTA, "calendar"],
      ["Big Sequel", "radar"],
      ["Big Sequel", "bigstory"],
      ["Halo 3", "videos"],
    ],
  );
  const book = mergeFiled({ games: [] }, c, now, SETTINGS);
  const gta = book.games.find((g) => g.game === GTA)!;
  assert.equal(gta.release, "2026-11-18T11:00Z", "the owner's release wins");
  assert.equal(gta.spoilerUntil, "2026-12-18T00:00:00.000Z");
  assert.deepEqual(gta.signals, ["owner", "calendar"]);
  const plan = fetchPlan(gta, now, {
    hours: 3,
    recheckHours: 24,
    recheckDays: 28,
    ...SETTINGS,
  })!;
  assert.equal(plan.notBefore, "2026-11-18T11:00:00.000Z");
  assert.equal(plan.searchEveryHours, 3);
  assert.equal(plan.priority, 50);
  assert.equal(plan.recheckUntil, "2026-12-18T00:00:00.000Z");
  // Long after its window and its looks, a game is no longer planned.
  assert.equal(
    fetchPlan(gta, new Date("2027-02-01T00:00:00Z"), {
      hours: 3,
      recheckHours: 24,
      recheckDays: 28,
      ...SETTINGS,
    }),
    undefined,
  );
});

test("the job: nothing before release, the owner's game first, a search every few hours, then daily looks", () => {
  const plan = (priority: number) => ({
    notBefore: "2026-11-18T11:00:00.000Z",
    searchEveryHours: 3,
    recheckEveryHours: 24,
    recheckUntil: "2026-12-18T00:00:00.000Z",
    priority,
  });
  let q: SceneQueue = {
    games: [
      {
        game: "Halo 3",
        reason: "a video",
        requestedAt: "2026-11-01T00:00:00Z",
        state: "done",
        lastTry: "2026-11-17T00:00:00Z",
      },
    ],
  };
  q = planGame(
    q,
    "Indie Thing",
    plan(10),
    "radar",
    new Date("2026-11-12T00:00:00Z"),
  );
  q = planGame(q, GTA, plan(50), "owner", new Date("2026-11-12T00:00:00Z"));
  assert.equal(
    nextJob(q, new Date("2026-11-18T10:00:00Z")),
    undefined,
    "not out yet",
  );
  assert.equal(nextJob(q, new Date("2026-11-18T11:05:00Z"))?.game, GTA);
  const searched = {
    games: q.games.map((g) =>
      g.game === GTA
        ? { ...g, state: "no-source" as const, lastTry: "2026-11-18T11:05:00Z" }
        : g,
    ),
  };
  assert.equal(
    nextJob(searched, new Date("2026-11-18T12:00:00Z"))?.game,
    "Indie Thing",
  );
  const both = {
    games: searched.games.map((g) =>
      g.game === "Indie Thing"
        ? { ...g, state: "no-source" as const, lastTry: "2026-11-18T11:30:00Z" }
        : g,
    ),
  };
  assert.equal(nextJob(both, new Date("2026-11-18T13:00:00Z")), undefined);
  assert.equal(
    nextJob(both, new Date("2026-11-18T14:10:00Z"))?.game,
    GTA,
    "three hours on, the next search",
  );
  const done = {
    games: [
      {
        ...both.games.find((g) => g.game === GTA)!,
        state: "done" as const,
        lastTry: "2026-11-20T00:00:00Z",
      },
    ],
  };
  assert.equal(nextJob(done, new Date("2026-11-20T20:00:00Z")), undefined);
  assert.equal(
    nextJob(done, new Date("2026-11-21T01:00:00Z"))?.game,
    GTA,
    "a day on, a look for a longer upload",
  );
  assert.equal(
    nextJob(done, new Date("2026-12-19T01:00:00Z")),
    undefined,
    "the looks end with the window",
  );
});

test("a planned game's turn asks for the most complete upload from its release day", async () => {
  const dir = await tmpDir();
  const cfg = testConfig(dir, { sceneIndex: true, macMinFreeGb: 40 });
  await fs.mkdir(path.join(dir, "sceneindex"), { recursive: true });
  const q = planGame(
    { games: [] },
    GTA,
    {
      notBefore: "2026-11-18T11:00:00.000Z",
      searchEveryHours: 3,
      recheckEveryHours: 24,
      recheckUntil: "2026-12-18T00:00:00.000Z",
      priority: 50,
    },
    "owner",
    new Date("2026-11-12T00:00:00Z"),
  );
  await fs.writeFile(
    path.join(dir, "sceneindex", "queue.json"),
    JSON.stringify(q),
  );
  const calls: string[] = [];
  const run = async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args].join(" "));
    return { stdout: "no-source {} in 30 s\n", code: 0 };
  };
  assert.equal(
    await sceneIndexTick(cfg, [], {
      now: () => new Date("2026-11-17T00:00:00Z"),
      run,
      freeGb: async () => 85,
    }),
    undefined,
  );
  assert.equal(
    await sceneIndexTick(cfg, [], {
      now: () => new Date("2026-11-18T12:00:00Z"),
      run,
      freeGb: async () => 85,
    }),
    "no-source",
  );
  assert.match(
    calls[0]!,
    /build Grand Theft Auto VI --steps=3 --recent --complete --released=2026-11-18$/,
  );
  // Under the free-space floor (the Mac keeps 40 GB): no turn.
  assert.equal(
    await sceneIndexTick(cfg, [], {
      now: () => new Date("2026-11-18T16:00:00Z"),
      run,
      freeGb: async () => 44,
    }),
    undefined,
  );
  assert.equal((await readQueue(dir)).games[0]!.state, "no-source");
});

test("the pass files every game, plans the queue and registers the spoiler windows", async () => {
  const dir = await tmpDir();
  await saveSceneIndex(dir, gtaIndex());
  const cfg = testConfig(dir, {
    sceneIndex: true,
    gameFetch: true,
    spoilerGuard: true,
    gameFetchTitles: "Grand Theft Auto VI@2026-11-18T11:00Z~2026-12-17",
  });
  try {
    const { book, windows } = await gameFetchPass(cfg, {
      now: () => DURING,
      launches: [
        { game: "Another Big One", match: "Another", launch: "2026-11-20" },
      ],
      radar: async () => {
        throw new Error("steam down");
      },
      videoGames: async () => [],
    });
    assert.deepEqual(
      book.games.map((g) => [g.game, g.status]),
      [
        [GTA, "filed"],
        ["Another Big One", "searching"],
      ],
    );
    assert.equal(book.games[0]!.source?.videoId, "abcdefghijk");
    assert.deepEqual(
      windows.map((w) => w.game),
      [GTA, "Another Big One"],
    );
    assert.deepEqual(windows[0]!.lateTerms, ["Cal", "Port Gellhorn"]);
    assert.ok(
      spoilerProblems("Cal shows up late in GTA 6.", DURING).length > 0,
    );
    const q = await readQueue(dir);
    assert.deepEqual(
      q.games.map((g) => [g.game, g.fetch?.priority]),
      [
        [GTA, 50],
        ["Another Big One", 40],
      ],
    );
    assert.equal((await readFiled(dir)).games.length, 2);
    const lines = filedLines(book, DURING);
    assert.match(
      lines.join("\n"),
      /Grand Theft Auto VI\*\* \(out 2026-11-18\): filed, movie "GTA VI All Cutscenes/,
    );
    assert.match(lines.join("\n"), /spoilers held until 2026-12-18/);
  } finally {
    setSpoilerWindows([]);
  }
  // Both settings off: nothing is filed and no window is registered.
  const off = await gameFetchPass(testConfig(await tmpDir()), {
    now: () => DURING,
  });
  assert.deepEqual([off.book.games.length, off.windows.length], [0, 0]);
});

test("a record's status follows its index and its place in the queue", () => {
  const rec = {
    game: GTA,
    slug: "grand-theft-auto-vi",
    signals: ["owner" as const],
    why: [],
    firstSeen: "2026-11-12T00:00:00Z",
    status: "searching" as const,
    updatedAt: "",
  };
  const plan = {
    notBefore: "2026-11-18T11:00:00.000Z",
    searchEveryHours: 3,
    recheckEveryHours: 24,
    recheckUntil: "2026-12-18T00:00:00.000Z",
    priority: 50,
  };
  const queued = { game: GTA, reason: "", requestedAt: "", fetch: plan };
  assert.equal(
    filedStatus(rec, undefined, queued, new Date("2026-11-13T00:00:00Z"))
      .status,
    "before-release",
  );
  assert.equal(
    filedStatus(rec, undefined, { ...queued, state: "no-source" }, DURING)
      .status,
    "no-source",
  );
  const index = gtaIndex();
  index.shots.forEach((s) => (s.desc = s.desc || "x"));
  assert.equal(filedStatus(rec, index, queued, DURING).status, "filed");
  assert.equal(
    filedStatus(
      rec,
      { ...index, coverage: [{ from: 0, to: 1000 }] },
      queued,
      DURING,
    ).status,
    "indexing",
  );
});

test("windows: only open ones count", () => {
  const w: SpoilerWindow = gtaWindow();
  assert.equal(
    spoilerHits("GTA 6: the ending", [w], new Date("2026-11-10T00:00:00Z"))
      .length,
    0,
  );
});
// ---------------------------------------------------------------- the picker (12 Nov 2026 live pass fixtures)

/** The live filed.json of 12 Nov 2026, as the first pass left it. */
function liveBook(): { games: FiledGame[] } {
  const at = "2026-11-12T04:43:55.782Z";
  const rec = (
    game: string,
    signals: FiledGame["signals"],
    why: string[],
    extra: Partial<FiledGame> = {},
  ): FiledGame => ({
    game,
    slug: game
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, ""),
    signals,
    why,
    firstSeen: at,
    status: "searching",
    updatedAt: at,
    ...extra,
  });
  const radar = (game: string, date: string) =>
    rec(game, ["radar"], [`release radar ${date}`], { release: date });
  return {
    games: [
      rec(
        GTA,
        ["owner", "calendar", "videos"],
        [
          "GAME_FETCH_TITLES",
          "launch calendar 2026-11-19",
          "14 Pulse videos in 7 days",
        ],
        {
          status: "before-release",
          release: "2026-11-18T11:00Z",
          until: "2026-12-17",
        },
      ),
      rec(
        "The Legend of Zelda: Ocarina of Time",
        ["calendar", "videos"],
        ["launch calendar 2026-11-05", "4 Pulse videos in 7 days"],
        {
          status: "indexing",
          release: "2026-11-05",
          indexed: 0.65,
          described: 0,
          source: {
            videoId: "L45cq1H2d1s",
            title:
              "ZELDA: OCARINA OF TIME REMAKE All Cutscenes (Full Game Movie) 4K 60FPS Ultra HD",
            uploader: "Gamer's Little Playground",
            minutes: 325,
            height: 2160,
            kind: "movie",
          },
        },
      ),
      radar("Euro Truck Simulator 2 - Coaches", "2026-11-12"),
      radar("One More Lawn", "2026-11-12"),
      radar("Main Sequence", "2026-11-12"),
      radar("SONIC PICO PARK", "2026-11-12"),
      radar("Drawquarium", "2026-11-13"),
      radar("Warota: I Live Next to The Demon King's Castle LOL", "2026-11-13"),
      radar("Dice Hoarder", "2026-11-13"),
      radar("DERELIKT", "2026-11-13"),
      radar("Dungeonbound", "2026-11-15"),
      radar("Trafficity", "2026-11-16"),
      rec("GTA", ["bigstory"], ["big story (release, size 89)"], {
        release: "2026-11-10",
      }),
      rec("Nintendo Switch 2", ["videos"], ["2 Pulse videos in 7 days"]),
      rec("Grand Theft Auto 6", ["videos"], ["4 Pulse videos in 7 days"]),
      rec("Fallout", ["videos"], ["2 Pulse videos in 7 days"]),
      rec(
        "Grand Theft Auto: San Andreas",
        ["videos"],
        ["2 Pulse videos in 7 days"],
      ),
      rec("Grand Theft Auto V", ["videos"], ["3 Pulse videos in 7 days"]),
      rec("Warhammer Survivors", ["videos"], ["2 Pulse videos in 7 days"]),
    ],
  };
}

const LIVE_LAUNCHES = [
  {
    game: "The Legend of Zelda: Ocarina of Time",
    match: "ocarina of time",
    launch: "2026-11-05",
  },
  {
    game: GTA,
    match: "gta (6|vi)\\b|grand theft auto (6|vi)\\b",
    launch: "2026-11-19",
  },
  {
    game: "Monster Hunter Wilds on Switch 2",
    match: "monster hunter wilds",
    launch: "2026-12-04",
  },
  { game: "Path of Exile 2", match: "path of exile 2", launch: "2026-12-11" },
];
const LIVE_NOW = new Date("2026-11-12T12:00:00Z");
const LIVE_RADAR = [
  {
    name: "Euro Truck Simulator 2 - Coaches",
    appId: 1,
    date: "2026-11-12",
    developer: "SCS Software",
    type: "dlc",
  },
  {
    name: "One More Lawn",
    appId: 2,
    date: "2026-11-12",
    developer: "Some Small Studio",
  },
  {
    name: "SONIC PICO PARK",
    appId: 3,
    date: "2026-11-12",
    developer: "TECOPARK",
  },
  { name: "Main Sequence", appId: 4, date: "2026-11-12" },
  {
    name: "Trafficity",
    appId: 5,
    date: "2026-11-16",
    developer: "Trafficity Team",
  },
];

test("canonical names: numerals, short forms and punctuation make one game", () => {
  const six = canonicalGame(GTA);
  for (const n of [
    "GTA",
    "GTA 6",
    "GTA VI",
    "gta6",
    "GTAVI",
    "Grand Theft Auto 6",
    "GRAND THEFT AUTO VI",
  ].slice(1))
    assert.equal(canonicalGame(n), six, n);
  assert.equal(canonicalGame("GTA"), canonicalGame("Grand Theft Auto"));
  assert.equal(
    canonicalGame("Grand Theft Auto: San Andreas"),
    canonicalGame("GTA San Andreas"),
  );
  assert.notEqual(canonicalGame("Grand Theft Auto V"), six, "V is not VI");
  assert.equal(canonicalGame("Grand Theft Auto V"), canonicalGame("GTA 5"));
  assert.equal(
    canonicalGame("Final Fantasy VII Rebirth"),
    canonicalGame("FF7 Rebirth"),
  );
  assert.equal(
    canonicalGame("Call of Duty: Black Ops III"),
    canonicalGame("COD Black Ops 3"),
  );
  assert.equal(
    canonicalGame("The Legend of Zelda: Ocarina of Time"),
    canonicalGame("Legend of Zelda Ocarina of Time"),
  );
  assert.equal(
    canonicalGame("Path of Exile II"),
    canonicalGame("Path of Exile 2"),
  );
  // Words that only look like numerals stay words.
  assert.equal(
    canonicalGame("Warota: I Live Next to The Demon King's Castle LOL"),
    "warota i live next to the demon kings castle lol",
  );
  assert.equal(canonicalGame("Mega Man X"), "mega man x");
  assert.equal(canonicalGame("DERELIKT"), "derelikt");
});

test("hardware, add-ons and series names are not games", () => {
  for (const n of [
    "Nintendo Switch 2",
    "PS5 Pro",
    "PlayStation 5",
    "Xbox Series X",
    "Steam Deck OLED",
    "Steam hardware",
    "Switch 2",
    "PlayStation Portal",
    "Xbox Game Pass",
  ])
    assert.ok(isHardware(n), n);
  for (const n of [
    "Monster Hunter Wilds on Switch 2",
    "Portal 2",
    "Nintendo Switch Sports",
    GTA,
    "Mario Kart World",
  ])
    assert.ok(!isHardware(n), n);
  assert.ok(isAddOn("Euro Truck Simulator 2 - Coaches", "dlc"));
  assert.ok(isAddOn("Cyberpunk 2077 Soundtrack"));
  assert.ok(isAddOn("Some Game Season Pass"));
  assert.ok(!isAddOn("One More Lawn", "game"));
  for (const n of ["GTA", "Fallout", "Zelda", "Grand Theft Auto"])
    assert.ok(isSeriesName(n), n);
  for (const n of [
    GTA,
    "Fallout 4",
    "Grand Theft Auto V",
    "The Legend of Zelda: Ocarina of Time",
    "Minecraft",
  ])
    assert.ok(!isSeriesName(n), n);
});

test("a series name resolves to the one game the story or the calendar makes clear, else nothing", () => {
  const known = [
    { game: GTA, release: "2026-11-18T11:00Z", match: "gta (6|vi)\\b" },
    { game: "Grand Theft Auto V" },
    { game: "Grand Theft Auto: San Andreas" },
  ];
  const story = new Date("2026-11-10T08:00:00Z");
  assert.equal(
    resolveSeries("GTA", known, story),
    GTA,
    "the one released near the story",
  );
  assert.equal(
    resolveSeries("GTA", known, story, "GTA 6 preloads go live"),
    GTA,
  );
  assert.equal(
    resolveSeries("GTA", known, story, "GTA San Andreas gets a surprise patch"),
    "Grand Theft Auto: San Andreas",
    "the headline names the game",
  );
  assert.equal(
    resolveSeries("GTA", known, new Date("2027-06-01T00:00:00Z")),
    undefined,
    "nothing near, nothing named",
  );
  assert.equal(
    resolveSeries("Fallout", known, story),
    undefined,
    "no Fallout game known",
  );
  assert.equal(
    resolveSeries(
      "Fallout",
      [
        { game: "Fallout 3 Remastered", release: "2026-11-20" },
        { game: "Fallout 5", release: "2026-11-25" },
      ],
      story,
    ),
    undefined,
    "two near: ambiguous",
  );
});

test("the release radar alone never picks a game; DLC never counts", () => {
  const c = fetchCandidates({
    titles: parseFetchTitles(
      "Grand Theft Auto VI@2026-11-18T11:00Z~2026-12-17",
    ),
    launches: LIVE_LAUNCHES,
    radar: [
      ...LIVE_RADAR,
      {
        name: "Big Studio Game",
        appId: 9,
        date: "2026-11-20",
        developer: "FromSoftware Inc.",
      },
      {
        name: "Big Studio Game: Soundtrack",
        appId: 10,
        date: "2026-11-20",
        developer: "FromSoftware Inc.",
      },
      {
        name: "Covered Indie",
        appId: 11,
        date: "2026-11-14",
        developer: "Two People",
      },
    ],
    stories: [],
    videoGames: [
      { game: "Covered Indie", at: "2026-11-11T00:00:00Z" },
      { game: "Covered Indie", at: "2026-11-12T00:00:00Z" },
    ],
    bigSize: 70,
    now: LIVE_NOW,
    signals: parseSignals(""),
  });
  const radar = c.filter((x) => x.signal === "radar").map((x) => x.game);
  assert.deepEqual(
    radar,
    ["Big Studio Game", "Covered Indie"],
    "a major studio, or another signal, and never the DLC",
  );
  for (const small of [
    "Euro Truck Simulator 2 - Coaches",
    "One More Lawn",
    "SONIC PICO PARK",
    "Main Sequence",
    "Trafficity",
  ])
    assert.ok(!c.some((x) => x.game === small), small);
  assert.match(c.find((x) => x.signal === "radar")!.why, /FromSoftware/);
});

test("big stories and videos: aliases land on one game, hardware and bare series are skipped", () => {
  const c = fetchCandidates({
    titles: parseFetchTitles(
      "Grand Theft Auto VI@2026-11-18T11:00Z~2026-12-17",
    ),
    launches: LIVE_LAUNCHES,
    radar: [],
    stories: [
      {
        name: "GTA",
        event: "release",
        size: 89,
        firstAt: "2026-11-10T09:00:00Z",
        headline: "GTA 6 preload date confirmed",
      },
      {
        name: "Nintendo Switch 2",
        event: "release",
        size: 95,
        firstAt: "2026-11-10T09:00:00Z",
      },
      {
        name: "Fallout",
        event: "release",
        size: 80,
        firstAt: "2026-11-10T09:00:00Z",
      },
    ],
    videoGames: [
      ...["Grand Theft Auto 6", "GTA 6", "Grand Theft Auto 6", "GTA VI"].map(
        (game) => ({ game, at: "2026-11-11T00:00:00Z" }),
      ),
      ...["Nintendo Switch 2", "Nintendo Switch 2", "Fallout", "Fallout"].map(
        (game) => ({ game, at: "2026-11-11T00:00:00Z" }),
      ),
      ...[
        "Grand Theft Auto V",
        "GTA 5",
        "Grand Theft Auto: San Andreas",
        "GTA San Andreas",
      ].map((game) => ({ game, at: "2026-11-11T00:00:00Z" })),
    ],
    bigSize: 70,
    now: LIVE_NOW,
    signals: parseSignals(""),
  });
  assert.deepEqual(
    c.map((x) => [x.game, x.signal]),
    [
      [GTA, "owner"],
      ["The Legend of Zelda: Ocarina of Time", "calendar"],
      [GTA, "calendar"],
      [GTA, "bigstory"],
      [GTA, "videos"],
      ["Grand Theft Auto V", "videos"],
      ["Grand Theft Auto: San Andreas", "videos"],
    ],
  );
  assert.equal(
    c.find((x) => x.signal === "videos" && x.game === GTA)!.why,
    "4 Pulse videos in 7 days",
  );
  assert.equal(
    c.find((x) => x.signal === "bigstory")!.release,
    "2026-11-19",
    "the calendar dates the resolved game",
  );
  const book = mergeFiled({ games: [] }, c, LIVE_NOW, SETTINGS);
  assert.deepEqual(
    book.games.map((g) => g.game),
    [
      GTA,
      "The Legend of Zelda: Ocarina of Time",
      "Grand Theft Auto V",
      "Grand Theft Auto: San Andreas",
    ],
  );
  assert.deepEqual(book.games[0]!.signals, [
    "owner",
    "calendar",
    "bigstory",
    "videos",
  ]);
});

test("on load the live book's records that no longer qualify are dropped with a reason, footage untouched", () => {
  const before = liveBook();
  const book = pruneFiled(before, {
    now: LIVE_NOW,
    titles: parseFetchTitles(
      "Grand Theft Auto VI@2026-11-18T11:00Z~2026-12-17",
    ),
    launches: LIVE_LAUNCHES,
  });
  const live = book.games
    .filter((g) => g.status !== "dropped")
    .map((g) => g.game);
  assert.deepEqual(live, [
    GTA,
    "The Legend of Zelda: Ocarina of Time",
    "Grand Theft Auto: San Andreas",
    "Grand Theft Auto V",
    "Warhammer Survivors",
  ]);
  const why = (game: string) =>
    book.games.find((g) => g.game === game)!.dropped;
  assert.equal(
    why("Euro Truck Simulator 2 - Coaches"),
    "picked by the release radar alone, not a big release",
  );
  assert.equal(
    why("SONIC PICO PARK"),
    "picked by the release radar alone, not a big release",
  );
  assert.equal(why("Nintendo Switch 2"), "hardware or a platform, not a game");
  assert.equal(why("Fallout"), "a series name, not one game");
  assert.equal(why("GTA"), `a series name; its signals moved to ${GTA}`);
  assert.equal(why("Grand Theft Auto 6"), `the same game as ${GTA}`);
  const gta = book.games.find((g) => g.game === GTA)!;
  assert.deepEqual(gta.signals, ["owner", "calendar", "videos", "bigstory"]);
  assert.ok(gta.why.includes("big story (release, size 89)"));
  assert.equal(gta.release, "2026-11-18T11:00Z", "the owner's release stays");
  // The Ocarina record that is indexing is exactly as it was.
  assert.deepEqual(book.games[1], before.games[1]);
  // Nothing is deleted: every record is still there.
  assert.equal(book.games.length, before.games.length);
  // Dropped records are never planned, keep their status and leave the weekly report.
  const dropped = book.games.find((g) => g.game === "One More Lawn")!;
  assert.equal(
    fetchPlan(dropped, LIVE_NOW, {
      hours: 3,
      recheckHours: 24,
      recheckDays: 28,
      ...SETTINGS,
    }),
    undefined,
  );
  assert.equal(
    filedStatus(dropped, undefined, undefined, LIVE_NOW).status,
    "dropped",
  );
  assert.doesNotMatch(
    filedLines(book, LIVE_NOW).join("\n"),
    /One More Lawn|Nintendo Switch 2|\*\*GTA\*\*/,
  );
  // A second prune changes nothing.
  assert.deepEqual(
    pruneFiled(book, { now: LIVE_NOW, launches: LIVE_LAUNCHES }),
    book,
  );
});

test("a dropped radar game comes back when a real signal names it; the queue loses dropped plans only", () => {
  const book = pruneFiled(liveBook(), {
    now: LIVE_NOW,
    launches: LIVE_LAUNCHES,
  });
  const back = mergeFiled(
    book,
    [
      {
        game: "Dungeonbound",
        signal: "bigstory",
        why: "big story (release, size 75)",
        release: "2026-11-15",
      },
    ],
    LIVE_NOW,
    SETTINGS,
  );
  const d = back.games.find((g) => g.game === "Dungeonbound")!;
  assert.equal(d.status, "searching");
  assert.equal(d.dropped, undefined);
  assert.deepEqual(d.signals, ["bigstory"]);
  const plan = {
    searchEveryHours: 3,
    recheckEveryHours: 24,
    recheckUntil: "2026-12-11T00:00:00.000Z",
    priority: 10,
  };
  const queue: SceneQueue = {
    games: [
      {
        game: "One More Lawn",
        reason: "footage: release radar 2026-11-12",
        requestedAt: "",
        fetch: plan,
      },
      {
        game: "Nintendo Switch 2",
        reason: "footage: 2 Pulse videos in 7 days",
        requestedAt: "",
        fetch: plan,
        state: "building",
      },
      {
        game: "Fallout",
        reason: "script: Fallout 4 next-gen",
        requestedAt: "",
      },
      {
        game: "The Legend of Zelda: Ocarina of Time",
        reason: "footage: launch calendar 2026-11-05",
        requestedAt: "",
        fetch: plan,
        state: "building",
      },
      {
        game: "Dungeonbound",
        reason: "footage: release radar 2026-11-15",
        requestedAt: "",
        fetch: plan,
      },
    ],
  };
  assert.deepEqual(
    unplanDropped(queue, back).games.map((g) => g.game),
    [
      "Nintendo Switch 2",
      "Fallout",
      "The Legend of Zelda: Ocarina of Time",
      "Dungeonbound",
    ],
    "a started index and another lane's request stay; a revived game stays",
  );
});

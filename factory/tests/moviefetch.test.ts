// Full game movies and playthroughs (26 Nov 2026): every scene-index turn signs in within the ration, a covered game's
// movie goes before other background work and counts as one request, later movie chapters and clean playthroughs are
// planned from the Data API and held by the spoiler guard. Fixed clock, no network, a faked yt-dlp.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpDir, testConfig } from "./helpers.ts";
import {
  createYtGuard,
  decide,
  emptyState,
  envPurpose,
  guardSettings,
  isYtPaused,
  YtPausedError,
  type GuardSettings,
} from "../src/lib/ytguard.ts";
import { buildStep, fetcherRun, proxyArgs } from "../src/sceneindex/build.ts";
import { buildLight, lightSignedOptions } from "../src/sceneindex/light.ts";
import { signedPull } from "../src/lib/ytsignin.ts";
import {
  afterTurn,
  hasPlannedParts,
  PIN_MAX_TRIES,
  nextJob,
  parsePin,
  parseQueue,
  pickTurn,
  proxyMarginGb,
  sceneIndexTick,
  type PinnedUpload,
  type QueuedGame,
  type SceneQueue,
} from "../src/sceneindex/job.ts";
import {
  chapterOf,
  judgeHit,
  moviePlanPass,
  cleanChannels,
  planQueries,
  planUploads,
  pinQueue,
  type PlanHit,
} from "../src/sceneindex/movieplan.ts";
import { plannedGames } from "../src/sceneindex/gamefetch.ts";
import {
  baseGameOf,
  emptySceneIndex,
  indexNamesFor,
  isGameplayIndex,
  loadSceneIndex,
  parseSceneIndex,
  partIndexName,
  saveSceneIndex,
  type SceneSource,
} from "../src/sceneindex/schema.ts";
import { footageAllowed, inOpening, spoilerWindow, windowFor } from "../src/sceneindex/spoilers.ts";

const GTA = "Grand Theft Auto VI";
const NOW = new Date("2026-11-26T20:00:00Z");
const H = 3600;

// The real Data API answers of 26 Nov 2026 (titles, channels, lengths), trimmed.
const HITS: PlanHit[] = [
  { videoId: "PVFdrS4SYzo", title: "GTA 6 - ALL Cutscenes Full Movie & Ending Chapter 2 (Grand Theft Auto VI)", uploader: "GAMERALISIMUS", duration: 2.2 * H, views: 37402 },
  { videoId: "gDICCTM6Lbk", title: "GTA 6 - ALL Cutscenes Full Movie & Ending Chapter 3 (Grand Theft Auto VI)", uploader: "GAMERALISIMUS", duration: 3.4 * H, views: 12946 },
  { videoId: "F4Vp81sFSg4", title: "GTA 6 All Cutscenes (PART 2) Game Movie 4K PS5 Pro Ultra HD", uploader: "Gamer's Little Playground", duration: 1.7 * H, views: 338132 },
  { videoId: "Rh6pNkapKjo", title: "GTA 6 All Cutscenes Full Movie (4K ULTRA HD)", uploader: "Shirrako", duration: 16.8 * H, views: 113040 },
  { videoId: "BGUTv2K_SWs", title: "GTA 6 Gameplay Walkthrough Part 1 FULL GAME [4K ULTRA HD PS5 PRO] No Commentary", uploader: "Shirrako", duration: 11.9 * H, views: 3697433 },
  { videoId: "CjuXgo28_nE", title: "GTA 6 - Full Game Walkthrough (No Commentary) 100% 4K", uploader: "Sirloin", duration: 11.0 * H, views: 1767261 },
  { videoId: "EbrQWwu0ang", title: "GTA 6 Gameplay Walkthrough FULL GAME [4K PS5 PRO] - No Commentary", uploader: "MKIceAndFire", duration: 28.7 * H, views: 306404 },
  { videoId: "RfKOBr9FOE4", title: "GTA 6 Gameplay Walkthrough Part 4 FULL GAME [4K ULTRA HD PS5 PRO] No Commentary", uploader: "Shirrako", duration: 10.7 * H, views: 442427 },
  { videoId: "4t6I6S0JNDo", title: "GTA 6 - 100% Walkthrough Part 8 | 4K Livestream [No Commentary]", uploader: "GTA Series Videos", duration: 11.3 * H, views: 131603 },
  { videoId: "P1JHukLmHFQ", title: "GTA 6 with Licensed Music | 100% Platinum Walkthrough Part 1 | PS5 Pro 4K HDR | No Commentary", uploader: "Pineapple Express", duration: 2.8 * H, views: 285114 },
  { videoId: "lOGyysf6pDo", title: "🔴 GTA 6 - Full Game Walkthrough [PS5 PRO 4K 60FPS] GRAND THEFT AUTO VI", uploader: "Ben-Gun", duration: 11.8 * H, views: 187642 },
  { videoId: "Elr4EZzGGEM", title: "GTA 6  Gameplay Walkthrough FULL GAME [4K 60FPS PC]", uploader: "Vishu gaming ", duration: 6.2 * H, views: 90089 },
  { videoId: "mIlpTOX3lMk", title: "GTA 5 PS5 All Cutscenes Full Movie (2022) 4K ULTRA HD", uploader: "GameClips", duration: 4.8 * H, views: 2343246 },
  { videoId: "ysbqpxsaDb0", title: "GTA 6 - 100% Walkthrough Part 1 | 4K Livestream [No Commentary]", uploader: "GTA Series Videos", duration: 10.6 * H, views: 1274184 },
];
const CHAPTER1: SceneSource = {
  videoId: "qpTWAD4FYF4",
  title: "GTA 6 - All Cutscenes Full Movie & Ending Chapter 1 (Grand Theft Auto VI)",
  uploader: "GAMERALISIMUS",
  duration: 2.7 * H,
  kind: "movie",
  pickedAt: "2026-11-19T17:00:00Z",
};
const opts = { maxHours: 12, clean: cleanChannels(""), now: NOW };

// ---------------------------------------------------------------- names and the spoiler tag

test("part index names: chapters and second playthroughs get their own index, and map back to the game", () => {
  assert.equal(partIndexName(GTA, "movie", 1), GTA);
  assert.equal(partIndexName(GTA, "movie", 2), `${GTA} (movie 2)`);
  assert.equal(partIndexName(GTA, "playthrough", 1), `${GTA} (gameplay)`);
  assert.equal(partIndexName(GTA, "playthrough", 2), `${GTA} (gameplay 2)`);
  assert.equal(baseGameOf(`${GTA} (movie 3)`), GTA);
  assert.equal(baseGameOf(`${GTA} (gameplay 2)`), GTA);
  assert.equal(baseGameOf(`${GTA} (gameplay)`), GTA);
  assert.ok(isGameplayIndex(`${GTA} (gameplay 2)`));
  assert.ok(!isGameplayIndex(`${GTA} (movie 2)`));
  const dirs = ["grand-theft-auto-vi", "grand-theft-auto-vi-movie-3", "grand-theft-auto-vi-movie-2", "grand-theft-auto-vi-gameplay-2", "grand-theft-auto-v", "grand-theft-auto-vi-movie-1"];
  assert.deepEqual(indexNamesFor("/d", GTA, undefined, () => dirs), [
    GTA,
    `${GTA} (gameplay)`,
    `${GTA} (movie 2)`,
    `${GTA} (movie 3)`,
    `${GTA} (gameplay 2)`,
  ]);
  assert.deepEqual(indexNamesFor("/d", `${GTA} (movie 2)`, ["movie"], () => dirs), [GTA, `${GTA} (movie 2)`, `${GTA} (movie 3)`]);
});

test("the spoiler guard holds a later chapter's whole upload in Shorts, and finds the game's window from its index name", () => {
  const w = spoilerWindow(GTA, "2026-11-19", { days: 28, openingShare: 0.2, until: "2026-12-17" })!;
  assert.equal(windowFor([w], `${GTA} (movie 2)`, NOW)?.game, GTA);
  assert.equal(windowFor([w], `${GTA} (gameplay)`, NOW)?.game, GTA);
  const ch2 = emptySceneIndex(`${GTA} (movie 2)`, { ...CHAPTER1, videoId: "PVFdrS4SYzo", chapter: 2, spoiler: true }, NOW);
  ch2.shots = [{ id: 0, start: 10, end: 14, keyframes: [12], desc: "a car at a pier", who: [], where: "", mood: "", tags: [], text: "", luma: 0.4, motion: 0.1 }];
  assert.equal(inOpening(ch2, 10, 0.2), false, "no opening in chapter 2");
  assert.equal(footageAllowed(w, ch2, 11, "short", NOW).ok, false);
  assert.equal(footageAllowed(w, ch2, 11, "long", NOW, { warned: true, placedAt: 90 }).ok, true, "a long video after its warning");
  assert.equal(footageAllowed(w, ch2, 11, "short", new Date("2026-12-19T00:00:00Z")).ok, true, "after 18 Dec");
  const ch1 = emptySceneIndex(GTA, CHAPTER1, NOW);
  assert.equal(inOpening(ch1, 60, 0.2), true, "chapter 1 keeps its opening");
  // The tag survives a save and a read.
  const back = parseSceneIndex(JSON.parse(JSON.stringify(ch2)))!;
  assert.equal(back.source.chapter, 2);
  assert.equal(back.source.spoiler, true);
});

// ---------------------------------------------------------------- the planner

test("judging uploads: clean chapters and 1440p/4K no-commentary full playthroughs pass; talk, streams, music and parts do not", () => {
  const by = (id: string) => judgeHit(HITS.find((h) => h.videoId === id)!, GTA, opts);
  assert.deepEqual(by("PVFdrS4SYzo"), { ...by("PVFdrS4SYzo"), ok: true, kind: "movie", chapter: 2 });
  assert.equal(by("BGUTv2K_SWs").ok && (by("BGUTv2K_SWs") as { kind: string }).kind, "playthrough");
  assert.equal(by("CjuXgo28_nE").ok, true);
  const why = (id: string) => {
    const v = by(id);
    return v.ok ? "ok" : v.why;
  };
  assert.equal(why("Rh6pNkapKjo"), "longer than 12 hours");
  assert.equal(why("EbrQWwu0ang"), "longer than 12 hours");
  assert.equal(why("RfKOBr9FOE4"), "a later part, not a full playthrough");
  assert.equal(why("4t6I6S0JNDo"), "not clean footage");
  assert.equal(why("P1JHukLmHFQ"), "not clean footage");
  assert.equal(why("lOGyysf6pDo"), "not clean footage");
  assert.equal(why("Elr4EZzGGEM"), "neither a cutscene movie nor a no-commentary playthrough");
  assert.equal(why("mIlpTOX3lMk"), "another game");
  assert.equal(judgeHit({ ...HITS[0]!, liveStatus: "was_live" }, GTA, opts).ok, false);
  assert.equal(judgeHit({ ...HITS[4]!, title: "GTA 6 Walkthrough with commentary 4K FULL GAME" }, GTA, opts).ok, false);
  assert.equal(judgeHit({ ...HITS[5]!, title: "GTA 6 - Full Game Walkthrough (No Commentary) 1080p" }, GTA, opts).ok, false);
  assert.equal(chapterOf("GTA 6 All Cutscenes (PART 3) Game Movie"), 3);
  assert.deepEqual(planQueries(GTA), ["GTA 6 all cutscenes full movie chapter", "GTA 6 full game walkthrough no commentary 4K"]);
});

test("the plan for GTA VI: chapters 2 and 3 from chapter 1's uploader, tagged as spoilers, and two playthroughs from two channels", () => {
  const have = [{ name: GTA, videoId: CHAPTER1.videoId, title: CHAPTER1.title, uploader: CHAPTER1.uploader, kind: "movie" as const }];
  const plan = planUploads(HITS, GTA, have, opts);
  assert.deepEqual(
    plan.map((p) => [p.name, p.pin.videoId, p.pin.kind, p.pin.chapter ?? 0, Boolean(p.pin.spoiler)]),
    [
      [`${GTA} (movie 2)`, "PVFdrS4SYzo", "movie", 2, true],
      [`${GTA} (movie 3)`, "gDICCTM6Lbk", "movie", 3, true],
      [`${GTA} (gameplay)`, "BGUTv2K_SWs", "playthrough", 0, false],
      [`${GTA} (gameplay 2)`, "CjuXgo28_nE", "playthrough", 0, false],
    ],
  );
  // Another channel's "PART 2" is cut differently: never mixed into GAMERALISIMUS's chapters.
  assert.ok(!plan.some((p) => p.pin.videoId === "F4Vp81sFSg4"));
  // Planned again with those in hand: nothing new.
  const after = [...have, ...plan.map((p) => ({ name: p.name, videoId: p.pin.videoId, title: p.pin.title, uploader: p.pin.uploader, kind: p.pin.kind, chapter: p.pin.chapter }))];
  assert.deepEqual(planUploads(HITS, GTA, after, opts), []);
  // No chapter 1 index (a whole-story movie): no chapter plan, playthroughs only.
  const whole = planUploads(HITS, GTA, [{ ...have[0]!, title: "GTA 6 Story - All Cutscenes Game Movie (4K)" }], opts);
  assert.ok(whole.every((p) => p.pin.kind === "playthrough"));
});

test("planned uploads go on the queue: a new entry for a chapter, the pin set on the waiting gameplay plan", () => {
  const gameplay: QueuedGame = {
    game: `${GTA} (gameplay)`,
    reason: "gameplay footage",
    requestedAt: "2026-11-20T12:18:14.118Z",
    recentRelease: true,
    fetch: { notBefore: "2026-11-19T11:00:00.000Z", searchEveryHours: 3, recheckEveryHours: 24, recheckUntil: "2026-12-18T00:00:00.000Z", priority: 45 },
    state: "no-source",
  };
  const have = [{ name: GTA, videoId: CHAPTER1.videoId, title: CHAPTER1.title, uploader: CHAPTER1.uploader, kind: "movie" as const }];
  const plan = planUploads(HITS, GTA, have, opts);
  const q = pinQueue({ games: [gameplay] }, plan, NOW);
  assert.equal(q.games.length, 4);
  const gp = q.games.find((g) => g.game === `${GTA} (gameplay)`)!;
  assert.equal(gp.pin?.videoId, "BGUTv2K_SWs");
  assert.equal(gp.state, undefined, "ready again");
  assert.equal(q.games.find((g) => g.game === `${GTA} (movie 2)`)?.pin?.spoiler, true);
  // A pin is kept through a read of the queue file, a bad one dropped.
  const back = parseQueue(JSON.parse(JSON.stringify({ games: [...q.games, { ...gameplay, game: "X", pin: { videoId: "bad" } }] })));
  assert.equal(back.games.find((g) => g.game === `${GTA} (movie 3)`)?.pin?.chapter, 3);
  assert.equal(back.games.find((g) => g.game === "X")?.pin, undefined);
  assert.equal(parsePin({ videoId: "PVFdrS4SYzo", duration: 0 }), undefined);
});

test("the planning pass: Data API answers only, once a day, nothing written when the API cannot answer", async () => {
  const dir = await tmpDir();
  await saveSceneIndex(dir, emptySceneIndex(GTA, CHAPTER1, NOW));
  const asked: string[] = [];
  const api = async (q: string) => {
    asked.push(q);
    return HITS.map((h) => JSON.stringify({ id: h.videoId, title: h.title, uploader: h.uploader, duration: h.duration, view_count: h.views ?? null, live_status: null })).join("\n");
  };
  const planned = await moviePlanPass({ dataDir: dir, sceneIndexMaxHours: 12 }, [GTA], { now: () => NOW, search: api });
  assert.equal(asked.length, 2);
  assert.equal(planned.length, 4);
  const q = JSON.parse(fs.readFileSync(path.join(dir, "sceneindex", "queue.json"), "utf8"));
  assert.deepEqual(
    q.games.map((g: QueuedGame) => g.game).sort(),
    [`${GTA} (gameplay 2)`, `${GTA} (gameplay)`, `${GTA} (movie 2)`, `${GTA} (movie 3)`],
  );
  // Again within the day: no search at all.
  await moviePlanPass({ dataDir: dir }, [GTA], { now: () => new Date(NOW.getTime() + 3 * 3_600_000), search: api });
  assert.equal(asked.length, 2);
  // A day later: searched again, nothing new planned (everything is queued).
  const again = await moviePlanPass({ dataDir: dir }, [GTA], { now: () => new Date(NOW.getTime() + 25 * 3_600_000), search: api });
  assert.equal(asked.length, 4);
  assert.equal(again.length, 0);
  // No API answer (no key, allowance spent): nothing written, tried on the next pass.
  const empty = await tmpDir();
  await moviePlanPass({ dataDir: empty }, [GTA], { now: () => NOW, search: async () => undefined });
  assert.equal(fs.existsSync(path.join(empty, "sceneindex", "movieplan.json")), false);
});

test("the planned games: the owner's and the calendar's released games, not dropped, not radar-only", () => {
  const rec = (game: string, signals: string[], release: string, status = "queued") => ({ game, signals, release, status }) as never;
  const book = {
    games: [
      rec(GTA, ["owner"], "2026-11-19"),
      rec("Radar Game", ["radar"], "2026-11-01"),
      rec("Future Game", ["calendar"], "2027-02-01"),
      rec("Old Calendar", ["calendar"], "2026-06-01"),
      rec("Dropped", ["owner"], "2026-11-10", "dropped"),
    ],
  };
  assert.deepEqual(plannedGames(book, NOW, 28), [GTA]);
});

// ---------------------------------------------------------------- the job

const pin = (over: Partial<PinnedUpload> = {}): PinnedUpload => ({
  videoId: "PVFdrS4SYzo",
  title: "GTA 6 - ALL Cutscenes Full Movie & Ending Chapter 2 (Grand Theft Auto VI)",
  uploader: "GAMERALISIMUS",
  duration: 2.2 * H,
  kind: "movie",
  chapter: 2,
  spoiler: true,
  priority: 48,
  plannedAt: NOW.toISOString(),
  ...over,
});
const lightGame: QueuedGame = { game: "Sunset Overdrive", reason: "a video about it", requestedAt: "2026-11-26T10:00:00Z" };
const pinned: QueuedGame = { game: `${GTA} (movie 2)`, reason: "planned upload", requestedAt: NOW.toISOString(), recentRelease: true, pin: pin() };

test("a covered game's planned movie goes ahead of light turns when the disk allows; a long one needs room for its proxy", () => {
  const o = { freeGb: 54, floorGb: 40, archiveBacklog: true, hasIndex: () => false, hasProxy: () => false };
  const r = pickTurn({ games: [lightGame, pinned] }, NOW, o);
  assert.equal(r.job?.game, `${GTA} (movie 2)`);
  assert.equal(r.light, false);
  // An 11.9-hour playthrough's proxy needs about 6 GB: at 44 GB free (floor 40) the light turn goes instead.
  const play: QueuedGame = { ...pinned, game: `${GTA} (gameplay)`, pin: pin({ kind: "playthrough", duration: 11.9 * H, chapter: undefined, spoiler: undefined }) };
  assert.equal(proxyMarginGb(play), 6);
  const r2 = pickTurn({ games: [lightGame, play] }, NOW, { ...o, freeGb: 44 });
  assert.equal(r2.job?.game, "Sunset Overdrive");
  assert.equal(r2.light, true);
  // An ordinary build of an uncovered game still waits behind light turns.
  const plain: QueuedGame = { ...lightGame, game: "Grand Theft Auto IV", reason: "archive: full index", state: "building" };
  assert.equal(pickTurn({ games: [plain, lightGame] }, NOW, { ...o, hasIndex: (g) => g === plain }).light, true);
});

test("a planned upload is built once and kept; a launch plan whose later chapters are planned keeps its chapter", () => {
  const done: QueuedGame = { ...pinned, state: "done", lastTry: "2026-11-20T00:00:00Z" };
  assert.equal(nextJob({ games: [done] }, NOW), undefined);
  const launch: QueuedGame = {
    game: GTA,
    reason: "footage: GAME_FETCH_TITLES",
    requestedAt: "2026-11-12T04:43:55.782Z",
    recentRelease: true,
    fetch: { notBefore: "2026-11-18T11:00:00.000Z", searchEveryHours: 3, recheckEveryHours: 24, recheckUntil: "2026-12-18T00:00:00.000Z", priority: 50 },
    state: "done",
    lastTry: "2026-11-24T00:00:00Z",
  };
  assert.equal(nextJob({ games: [launch] }, NOW)?.game, GTA, "due its daily look alone");
  const q: SceneQueue = { games: [launch, done] };
  assert.ok(hasPlannedParts(q, launch));
  assert.equal(nextJob(q, NOW), undefined, "kept while its chapters are planned");
});

test("the tick: every turn signs in; a planned movie is a movie turn with its own source, a light turn is library", async () => {
  const dir = await tmpDir();
  const cookies = "/f/data/yt_cookies.txt";
  fs.mkdirSync(path.join(dir, "sceneindex"), { recursive: true });
  fs.writeFileSync(path.join(dir, "sceneindex", "queue.json"), JSON.stringify({ games: [lightGame, pinned] }));
  const seen: Array<{ line: string; env: NodeJS.ProcessEnv }> = [];
  const run = async (cmd: string, args: string[], env: NodeJS.ProcessEnv) => {
    seen.push({ line: [cmd, ...args].join(" "), env });
    return { stdout: "waiting {} in 3 s\n", code: 0 };
  };
  const cfg = testConfig(dir, { sceneIndex: true, macMinFreeGb: 40, ytdlpCookiesFile: cookies, archiveBacklog: true });
  const deps = { now: () => NOW, run, freeGb: async () => 54, platform: "darwin" };
  await sceneIndexTick(cfg, [], deps);
  assert.equal(seen.length, 1);
  assert.match(seen[0]!.line, /build Grand Theft Auto VI \(movie 2\)/);
  assert.doesNotMatch(seen[0]!.line, /--complete|--refresh/);
  assert.equal(seen[0]!.env.YTDLP_COOKIES_FILE, cookies);
  assert.equal(seen[0]!.env.YT_PURPOSE, "movie");
  assert.equal(parsePin(JSON.parse(String(seen[0]!.env.SCENE_INDEX_PIN)))?.videoId, "PVFdrS4SYzo");
  // The movie rests after "waiting"; the light turn runs next, signed in as library work.
  await sceneIndexTick(cfg, [], deps);
  assert.match(seen[1]!.line, /light Sunset Overdrive/);
  assert.equal(seen[1]!.env.YTDLP_COOKIES_FILE, cookies);
  assert.equal(seen[1]!.env.YT_PURPOSE, "library");
  assert.equal(envPurpose(seen[1]!.env), "library");
});

test("the tick on the PC: below 320 GB free on D: no turn fetches a proxy; a light turn still may", async () => {
  const dir = await tmpDir();
  fs.mkdirSync(path.join(dir, "sceneindex"), { recursive: true });
  fs.writeFileSync(path.join(dir, "sceneindex", "queue.json"), JSON.stringify({ games: [lightGame, pinned] }));
  const seen: string[] = [];
  const run = async (cmd: string, args: string[]) => {
    seen.push([cmd, ...args].join(" "));
    return { stdout: "waiting\n", code: 0 };
  };
  const cfg = testConfig(dir, { sceneIndex: true, macMinFreeGb: 40, archiveBacklog: true });
  await sceneIndexTick(cfg, [], { now: () => NOW, run, freeGb: async () => 500, platform: "win32", pcFreeGb: async () => 300 });
  assert.equal(seen.length, 1);
  assert.match(seen[0]!, /light Sunset Overdrive/);
  // With room on D: the movie goes first.
  const dir2 = await tmpDir();
  fs.mkdirSync(path.join(dir2, "sceneindex"), { recursive: true });
  fs.writeFileSync(path.join(dir2, "sceneindex", "queue.json"), JSON.stringify({ games: [lightGame, pinned] }));
  await sceneIndexTick(testConfig(dir2, { sceneIndex: true, macMinFreeGb: 40, archiveBacklog: true }), [], {
    now: () => NOW,
    run,
    freeGb: async () => 500,
    platform: "win32",
    pcFreeGb: async () => 380,
  });
  assert.match(seen[1]!, /build Grand Theft Auto VI \(movie 2\)/);
});

test("a planned build makes its index from the pinned source: no search, no details", async () => {
  const dir = await tmpDir();
  let searched = 0;
  const s = { dataDir: dir, ytdlp: "yt-dlp-not-run", whisperPython: "", proxyHeight: 480, ocrFps: 2, chunkSeconds: 600, maxHours: 12 };
  const src: SceneSource = { videoId: "PVFdrS4SYzo", title: pin().title, uploader: "GAMERALISIMUS", duration: 2.2 * H, kind: "movie", chapter: 2, spoiler: true, pickedAt: "" };
  // A proxy already on disk, so nothing is downloaded; the stretch step then fails on the fake proxy, which is fine here.
  const folder = path.join(dir, "sceneindex", "grand-theft-auto-vi-movie-2");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "proxy.mp4"), Buffer.alloc(1_100_000));
  await buildStep(`${GTA} (movie 2)`, s, { pinned: src, refreshSource: true, complete: true }, {
    search: async () => {
      searched++;
      return [];
    },
    details: async () => {
      searched++;
      return undefined;
    },
    names: async () => ({ cast: ["Lucia", "Jason"], places: [] }),
    now: () => NOW,
  }).catch(() => undefined);
  assert.equal(searched, 0);
  const index = await loadSceneIndex(dir, `${GTA} (movie 2)`);
  assert.equal(index?.source.videoId, "PVFdrS4SYzo");
  assert.equal(index?.source.spoiler, true);
  assert.deepEqual(index?.cast, ["Lucia", "Jason"]);
});

test("light and movie turns take turns, and a planned upload that keeps failing is given up", () => {
  const o = { freeGb: 54, floorGb: 40, archiveBacklog: true, hasIndex: () => false, hasProxy: () => false };
  assert.equal(pickTurn({ games: [lightGame, pinned] }, NOW, { ...o, lastHighValue: true }).light, true);
  assert.equal(pickTurn({ games: [lightGame, pinned] }, NOW, { ...o, lastHighValue: false }).job?.game, `${GTA} (movie 2)`);
  assert.equal(pickTurn({ games: [pinned] }, NOW, { ...o, lastHighValue: true }).job?.game, `${GTA} (movie 2)`, "nothing else waiting");
  // The PC: the proxy must leave 320 GB on D: after it.
  assert.equal(pickTurn({ games: [pinned] }, NOW, { ...o, pcFreeGb: 322 }).job, undefined);
  assert.equal(pickTurn({ games: [pinned] }, NOW, { ...o, pcFreeGb: 324 }).job?.game, `${GTA} (movie 2)`);
  let q: SceneQueue = { games: [pinned] };
  for (let i = 0; i < PIN_MAX_TRIES - 1; i++) q = afterTurn(q, pinned.game, "waiting", NOW);
  assert.equal(q.games[0]!.state, "waiting");
  assert.equal(afterTurn(q, pinned.game, "stretch", NOW).games[0]!.tries, 0, "progress starts the count again");
  q = afterTurn(q, pinned.game, "waiting", NOW);
  assert.equal(q.games[0]!.state, "no-source");
  assert.equal(nextJob(q, new Date(NOW.getTime() + 7 * 86_400_000)), undefined, "never ready again");
});

// ---------------------------------------------------------------- never anonymous

test("a light turn with cookies signs in only: no anonymous try, nothing at all when the cookies cannot be used", async () => {
  const o = lightSignedOptions({ YTDLP_COOKIES_FILE: "/f/data/yt_cookies.txt" });
  assert.equal(o.enabled, true);
  assert.equal(o.signedOnly, true);
  assert.equal(o.purpose, "library");
  assert.equal(lightSignedOptions({}).signedOnly, false);
  const args = ["--skip-download", "--dump-single-json", "https://www.youtube.com/watch?v=PVFdrS4SYzo"];
  const tried: string[][] = [];
  const attempt = async (a: string[]) => {
    tried.push(a);
    return "{}";
  };
  const deps = { anonOpen: () => true, knownGated: () => false };
  await signedPull(args, attempt, o, { ...deps, cookies: async () => ["--cookies", "/f/data/yt_cookies.txt"] });
  assert.deepEqual(tried, [["--cookies", "/f/data/yt_cookies.txt", ...args]], "signed straight away although the anonymous lane is open");
  await assert.rejects(signedPull(args, attempt, o, { ...deps, cookies: async () => [] }), /nothing is fetched anonymously/);
  assert.equal(tried.length, 1, "no anonymous call");
});

test("a build with cookies it cannot use makes no call at all", async (t) => {
  const dir = await tmpDir();
  // The guard notes the missing file in its state: kept in this test's own folder.
  const before = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  t.after(() => {
    if (before === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = before;
  });
  // The cookies file is set but missing: the call fails before yt-dlp is started (a started one would fail ENOENT).
  const s = { ytdlp: path.join(dir, "yt-dlp-must-not-run"), cookiesFile: path.join(dir, "missing_cookies.txt") };
  await assert.rejects(
    fetcherRun(s, ["--skip-download", "--dump-single-json", "https://www.youtube.com/watch?v=PVFdrS4SYzo"]),
    /nothing is fetched anonymously/,
  );
});

// ---------------------------------------------------------------- the guard

const signedS = (over: Partial<GuardSettings> = {}): GuardSettings => ({ ...guardSettings({}), ...over });

function rig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moviefetch-"));
  const cookies = path.join(dir, "cookies.txt");
  fs.writeFileSync(cookies, "# Netscape HTTP Cookie File\n");
  let now = Date.parse("2026-11-28T16:00:00Z");
  const g = createYtGuard({
    dir,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    rand: () => 0,
    settings: () => signedS(),
    cls: () => "background",
    apiKey: () => "",
  });
  return { g, dir, cookies, advance: (ms: number) => (now += ms) };
}

test("guard: a whole movie download is one signed-in request; the next background call never books ahead of a Short", async () => {
  const { g, dir, cookies, advance } = rig();
  // The faked yt-dlp: writes a long movie's proxy (in many pieces, as yt-dlp would) and exits once.
  const fake = (file: string) => async () => {
    for (let i = 0; i < 20; i++) fs.appendFileSync(file, Buffer.alloc(100_000));
    return { stdout: "", stderr: "" };
  };
  const file1 = path.join(dir, "p1.mp4");
  await g.run("yt-dlp", ["--cookies", cookies, ...proxyArgs("PVFdrS4SYzo", 480, file1)], fake(file1), { purpose: "movie" });
  let st = await g.state();
  assert.equal(st.signed?.calls.length, 1, "one request for the whole movie");
  assert.equal(st.signed?.dayBackground?.length, 1);
  // A second movie straight after is held (no wait, no request): it tries again on a later turn.
  let asked = 0;
  const count = async () => {
    asked++;
    return { stdout: "{}", stderr: "" };
  };
  const file2 = path.join(dir, "p2.mp4");
  await assert.rejects(
    g.run("yt-dlp", ["--cookies", cookies, ...proxyArgs("gDICCTM6Lbk", 480, file2)], count, { purpose: "movie" }),
    (e: unknown) => isYtPaused(e) && (e as { reason?: string }).reason === "busy",
  );
  assert.equal(asked, 0);
  // A Short asking now still fits within its wait: the background booking is never ahead of the gap.
  await g.run("yt-dlp", ["--cookies", cookies, "--skip-download", "--dump-single-json", "https://www.youtube.com/watch?v=bbbbbbbbbbb"], count, {
    cls: "urgent",
    priority: "short",
  });
  assert.equal(asked, 1);
  st = await g.state();
  assert.equal(st.signed?.calls.length, 2);
  // Later the second movie goes.
  advance(30 * 60_000);
  await g.run("yt-dlp", ["--cookies", cookies, ...proxyArgs("gDICCTM6Lbk", 480, file2)], fake(file2), { purpose: "movie" });
  st = await g.state();
  assert.equal(st.signed?.dayBackground?.length, 2);
});

test("guard: the library, clips and trends take at most half the day's background share; movies and the fetcher keep the rest", () => {
  const s = signedS({ signedHourlyBudget: 0, signedMinGapMs: 0 });
  const root = emptyState();
  let t = Date.parse("2026-11-28T16:00:00Z");
  const go = (purpose: "movie" | "library" | "fetcher" | "clip") => decide(root, (t += 1000), "background", s, 0, "signed", purpose, "background");
  // Daily 30, background share 0.3: 9 background a day; the smaller users stop at 4 of them.
  for (let i = 0; i < 4; i++) assert.equal(go(i % 2 ? "clip" : "library").go, true);
  const held = go("library");
  assert.equal(held.go, false);
  assert.equal(!held.go && held.reason, "share");
  for (let i = 0; i < 4; i++) assert.equal(go(i % 2 ? "fetcher" : "movie").go, true, "the movies keep the rest");
  assert.equal(go("movie").go, true);
  assert.equal(go("movie").go, false, "the whole background share is used");
  // A day later the library has its share again.
  t += 86_400_000;
  assert.equal(go("library").go, true);
  assert.equal(envPurpose({ YT_PURPOSE: "movie" }), "movie");
  assert.equal(envPurpose({ YT_PURPOSE: "anything" }), undefined);
});

test("a signed-in light turn whose captions the ration holds back waits; it never saves an index without them", async () => {
  const dir = await tmpDir();
  const src: SceneSource = { videoId: "PVFdrS4SYzo", title: "x", uploader: "y", duration: 600, kind: "movie", pickedAt: "" };
  await assert.rejects(
    buildLight(GTA, src, { dataDir: dir, ytdlp: "yt-dlp-not-run", comments: 0, ocr: false }, {
      info: async () => ({ duration: 600 }),
      captions: async () => {
        throw new YtPausedError("busy", Date.now() + 300_000, "signed");
      },
      names: async () => ({ cast: [], places: [] }),
      now: () => NOW,
    }),
    (e: unknown) => isYtPaused(e),
  );
  assert.equal(await loadSceneIndex(dir, GTA), undefined);
});

test("a planned upload's waits count only before its proxy is fetched", () => {
  let q: SceneQueue = { games: [pinned] };
  q = afterTurn(q, pinned.game, "waiting", NOW, false);
  assert.equal(q.games[0]!.tries ?? 0, 0, "vision down or the Mac busy: not counted");
  q = afterTurn(q, pinned.game, "waiting", NOW, true);
  assert.equal(q.games[0]!.tries, 1);
});

test("guard: the trend feed is not shut out by a day of light turns", () => {
  const s = signedS({ signedHourlyBudget: 0, signedMinGapMs: 0 });
  const root = emptyState();
  let t = Date.parse("2026-11-28T16:00:00Z");
  for (let i = 0; i < 4; i++) decide(root, (t += 1000), "background", s, 0, "signed", "library", "background");
  assert.equal(decide(root, (t += 1000), "background", s, 0, "signed", "library", "background").go, false);
  assert.equal(decide(root, (t += 1000), "background", s, 0, "signed", "trend", "background").go, true);
});

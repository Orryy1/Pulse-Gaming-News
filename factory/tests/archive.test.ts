import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ARCHIVE_BACKLOG,
  afterLightTurn,
  archiveLines,
  archiveTick,
  inArchiveHours,
  lightOutcome,
  mergeRanking,
  namesGame,
  nextArchiveTurn,
  rankBacklog,
  readArchive,
  type ArchiveBook,
} from "../src/sceneindex/archive.ts";
import {
  assembleLight,
  chaptersOf,
  clockSeconds,
  json3Words,
  lightShots,
  momentsOf,
  pickStoryboard,
  storyboardTiles,
  thumbDiff,
  timestampsIn,
  type TileStats,
} from "../src/sceneindex/light.ts";
import {
  parseSceneIndex,
  saveSceneIndex,
  loadSceneIndex,
  type SceneIndex,
} from "../src/sceneindex/schema.ts";
import {
  buildStep,
  releaseProxy,
  sectionArgs,
} from "../src/sceneindex/build.ts";
import { findQuote, findShots } from "../src/sceneindex/lookup.ts";
import { readQueue } from "../src/sceneindex/job.ts";

const src = {
  videoId: "L45cq1H2d1s",
  title: "Game Movie",
  uploader: "U",
  duration: 600,
  kind: "movie" as const,
  pickedAt: "2026-11-12T00:00:00Z",
};

test("the backlog is curated: 60 to 120 games, no game twice", () => {
  assert.ok(
    ARCHIVE_BACKLOG.length >= 60 && ARCHIVE_BACKLOG.length <= 120,
    String(ARCHIVE_BACKLOG.length),
  );
  const names = ARCHIVE_BACKLOG.map((g) => g.game.toLowerCase());
  assert.equal(new Set(names).size, names.length);
});

test("ranking: Pulse's own episodes lift a game, aliases count, the top games are marked full", () => {
  const ranked = rankBacklog(
    ARCHIVE_BACKLOG,
    [
      { game: "GTA 5", n: 12, views: 400_000 },
      { game: "Half-Life 2", n: 9, views: 50_000 },
    ],
    { fullTop: 3 },
  );
  assert.equal(ranked[0]!.game, "Grand Theft Auto V");
  assert.equal(ranked[0]!.episodes, 12);
  assert.ok(
    ranked.findIndex((g) => g.game === "Half-Life 2") <
      ranked.findIndex((g) => g.game === "Half-Life"),
  );
  assert.deepEqual(ranked.map((g) => g.full).slice(0, 4), [
    true,
    true,
    true,
    false,
  ]);
  assert.ok(
    namesGame(
      "Ocarina of Time",
      ARCHIVE_BACKLOG.find((g) => g.game.includes("Ocarina"))!,
    ),
  );
});

test("the next archive turn: gone uploads first, then full upgrades, then unindexed by rank, then weekly looks", () => {
  const now = new Date("2026-11-12T23:00:00Z");
  const book: ArchiveBook = {
    games: [
      {
        game: "A",
        slug: "a",
        rank: 1,
        full: true,
        status: "light",
        checkedAt: now.toISOString(),
      },
      { game: "B", slug: "b", rank: 2, full: false, status: "waiting" },
      {
        game: "C",
        slug: "c",
        rank: 3,
        full: false,
        status: "light",
        checkedAt: "2026-11-01T00:00:00Z",
      },
    ],
  };
  assert.deepEqual(nextArchiveTurn(book, now), {
    kind: "full",
    rec: book.games[0],
  });
  // Asked once: the job has it; the next turn is the waiting game.
  book.games[0]!.fullQueuedAt = now.toISOString();
  assert.equal(nextArchiveTurn(book, now)?.rec.slug, "b");
  book.games[1]!.status = "light";
  book.games[1]!.checkedAt = now.toISOString();
  book.games[0]!.status = "full";
  assert.equal(nextArchiveTurn(book, now)?.kind, "check");
  book.games[2]!.status = "gone";
  assert.deepEqual(nextArchiveTurn(book, now), {
    kind: "light",
    rec: book.games[2],
  });
});

test("archive hours wrap midnight; turns and report lines", () => {
  assert.ok(
    inArchiveHours("22-7", 23) &&
      inArchiveHours("22-7", 3) &&
      !inArchiveHours("22-7", 12),
  );
  assert.ok(inArchiveHours("all", 12));
  assert.deepEqual(lightOutcome("x\nlight abcdefghijk 900000\n"), {
    outcome: "light",
    videoId: "abcdefghijk",
    bytes: 900000,
  });
  assert.equal(lightOutcome("no-source\n").outcome, "no-source");
  const now = new Date("2026-11-12T23:00:00Z");
  let book = mergeRanking(
    { games: [] },
    rankBacklog(ARCHIVE_BACKLOG.slice(0, 5), [], { fullTop: 1 }),
  );
  book = afterLightTurn(
    book,
    book.games[0]!.slug,
    { outcome: "light", videoId: "abcdefghijk", bytes: 1_000_000 },
    now,
  );
  book = afterLightTurn(
    book,
    book.games[1]!.slug,
    { outcome: "no-source" },
    now,
  );
  assert.equal(book.games[0]!.status, "light");
  const lines = archiveLines(book).join("\n");
  assert.match(lines, /1 of 5 games archived/);
  assert.match(lines, /3 queued/);
  assert.match(lines, /no clean full movie/);
});

test("light parsing: timestamps, chapters, captions, storyboard tiles", () => {
  assert.equal(clockSeconds("3:21:05"), 12065);
  assert.equal(clockSeconds("12:34"), 754);
  assert.deepEqual(
    timestampsIn("the Ganondorf reveal at 3:21:05 gave me chills", 20000),
    [{ at: 12065, label: "gave me chills" }],
  );
  assert.deepEqual(timestampsIn("1:02 Kokiri Forest\n2:30 - Deku Tree", 600), [
    { at: 62, label: "Kokiri Forest" },
    { at: 150, label: "Deku Tree" },
  ]);
  assert.deepEqual(
    chaptersOf(
      { chapters: [{ start_time: 0, end_time: 60, title: "Intro" }] },
      600,
    ),
    [{ start: 0, end: 60, title: "Intro" }],
  );
  const words = json3Words({
    events: [
      {
        tStartMs: 1000,
        dDurationMs: 2000,
        segs: [{ utf8: "Hey" }, { utf8: " listen", tOffsetMs: 500 }],
      },
      { tStartMs: 4000, segs: [{ utf8: "[Music]" }] },
    ],
  });
  assert.deepEqual(
    words.map((w) => [w.text, w.start, w.end]),
    [
      ["Hey", 1, 1.5],
      ["listen", 1.5, 3],
    ],
  );
  const sb = pickStoryboard([
    {
      format_id: "sb1",
      width: 160,
      height: 90,
      rows: 5,
      columns: 5,
      fps: 0.1,
      fragments: [{ url: "x", duration: 250 }],
    },
    {
      format_id: "sb0",
      width: 320,
      height: 180,
      rows: 3,
      columns: 3,
      fps: 0.1,
      fragments: [
        { url: "a", duration: 90 },
        { url: "b", duration: 30 },
      ],
    },
    { format_id: "137", width: 1920 },
  ])!;
  assert.equal(sb.format_id, "sb0");
  const tiles = storyboardTiles(sb, 115);
  assert.equal(tiles.length, 11);
  assert.deepEqual(tiles[0], { time: 5, sheet: 0, cell: 0 });
  assert.deepEqual(tiles[9], { time: 95, sheet: 1, cell: 0 });
});

const tile = (time: number, v: number): TileStats => ({
  time,
  luma: v,
  thumb: new Uint8Array(144).fill(v),
});

test("light shots: cuts from the storyboard, dialogue turns and chapters; moments tag their shot", () => {
  assert.equal(thumbDiff(new Uint8Array([0, 10]), new Uint8Array([10, 10])), 5);
  const tiles = [tile(5, 100), tile(15, 100), tile(25, 200), tile(35, 200)];
  const shots = lightShots(
    tiles,
    [{ start: 31, end: 33 }],
    [{ start: 0, end: 40, title: "Kokiri Forest" }],
    40,
  );
  assert.deepEqual(
    shots.map((s) => s.start),
    [0, 10, 20, 31],
  );
  assert.ok(shots.every((s) => s.end - s.start <= 12));
  const index = assembleLight({
    game: "Test Game",
    source: { ...src, duration: 40 },
    words: [
      { text: "The", start: 31, end: 31.3 },
      { text: "Great", start: 31.3, end: 31.6 },
      { text: "Deku", start: 31.6, end: 32 },
      { text: "Tree", start: 32, end: 32.4 },
      { text: "awaits.", start: 32.4, end: 33 },
    ],
    tiles,
    chapters: [{ start: 0, end: 40, title: "Kokiri Forest" }],
    moments: [{ at: 21, label: "Mido blocks the path", from: "comment" }],
    now: new Date("2026-11-12T00:00:00Z"),
  });
  assert.equal(index.tier, "light");
  assert.deepEqual(index.coverage, [{ from: 0, to: 40 }]);
  assert.ok(index.shots.every((s) => s.where === "Kokiri Forest"));
  const back = parseSceneIndex(JSON.parse(JSON.stringify(index)))!;
  assert.equal(back.tier, "light");
  assert.equal(back.chapters?.length, 1);
  assert.equal(back.moments?.[0]?.label, "Mido blocks the path");
  assert.equal(findQuote(back, "the Great Deku Tree awaits")[0]?.start, 31);
  const hit = findShots(
    back,
    { text: "Mido blocks the path" },
    { minConfidence: 0 },
  )[0]!;
  assert.ok(hit.start <= 21 && hit.end > 21, JSON.stringify(hit));
  assert.deepEqual(
    momentsOf(
      "0:00 Intro\n1:00 Boss",
      [{ text: "1:01 best boss ever", likes: 5 }],
      [{ start: 0, end: 600, title: "Intro" }],
      600,
    ).map((m) => m.at),
    [60],
  );
});

test("a light index asked to build becomes the full one stretch by stretch, then the proxy can go", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "archive-"));
  try {
    const light = assembleLight({
      game: "Test Game",
      source: src,
      words: [],
      tiles: [tile(5, 100)],
      chapters: [],
      moments: [],
      now: new Date(),
    });
    await saveSceneIndex(dataDir, light);
    // No network: the stretch work is skipped by a failing proxy fetch, but the conversion is saved first.
    await buildStep("Test Game", {
      dataDir,
      ytdlp: "definitely-not-yt-dlp",
      whisperPython: "",
      proxyHeight: 480,
      ocrFps: 2,
      chunkSeconds: 600,
      maxHours: 12,
    }).catch(() => undefined);
    const after = (await loadSceneIndex(dataDir, "Test Game"))!;
    assert.equal(after.tier, "upgrading");
    assert.deepEqual(after.coverage, []);
    // A finished full index with a proxy: releaseProxy removes it and records it.
    const full: SceneIndex = {
      ...after,
      tier: "full",
      coverage: [{ from: 0, to: 600 }],
      proxy: { file: "proxy.mp4", height: 480, bytes: 0 },
    };
    await saveSceneIndex(dataDir, full);
    await fs.writeFile(
      path.join(dataDir, "sceneindex", "test-game", "proxy.mp4"),
      Buffer.alloc(2_000_000),
    );
    assert.equal(
      await releaseProxy(full, { dataDir }, new Date("2026-11-12T00:00:00Z")),
      2_000_000,
    );
    const gone = (await loadSceneIndex(dataDir, "Test Game"))!;
    assert.equal(gone.proxy?.released, "2026-11-12T00:00:00.000Z");
    await assert.rejects(
      fs.stat(path.join(dataDir, "sceneindex", "test-game", "proxy.mp4")),
    );
    assert.equal(
      await releaseProxy({ ...light, tier: "light" }, { dataDir }, new Date()),
      0,
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("sections are fetched small and exact", () => {
  const a = sectionArgs("L45cq1H2d1s", 10, 13.5, 360, "out.mp4");
  assert.ok(a.includes("*10.00-13.50"));
  assert.ok(a.some((x) => x.includes("height<=360")));
});

test("the archive tick does nothing while off or outside its hours; a full turn queues the scene index job", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "archive-"));
  try {
    const cfg = {
      dataDir,
      sceneIndex: true,
      archiveBacklog: false,
      archiveFullTop: 1,
      archiveHours: "all",
      archiveComments: 0,
      ytdlpPath: "yt-dlp",
      macMinFreeGb: 0,
    };
    assert.equal(await archiveTick(cfg), undefined);
    assert.equal(
      await archiveTick(
        { ...cfg, archiveBacklog: true, archiveHours: "1-2" },
        { now: () => new Date(2026, 10, 12, 12) },
      ),
      undefined,
    );
    const top = rankBacklog(ARCHIVE_BACKLOG, [], { fullTop: 1 })[0]!;
    await saveSceneIndex(
      dataDir,
      assembleLight({
        game: top.game,
        source: src,
        words: [],
        tiles: [],
        chapters: [],
        moments: [],
        now: new Date(),
      }),
    );
    let ran = 0;
    const first = await archiveTick(
      { ...cfg, archiveBacklog: true },
      {
        run: async () => {
          ran++;
          return { stdout: "no-source\n", code: 0 };
        },
      },
    );
    // The top game already has a light index: it is the one marked full, so it is queued for the full build.
    assert.equal(first, "full-queued");
    assert.equal(ran, 0);
    assert.equal((await readQueue(dataDir)).games[0]?.game, top.game);
    const book = await readArchive(dataDir);
    assert.equal(book.games.find((g) => g.game === top.game)?.status, "light");
    const second = await archiveTick(
      { ...cfg, archiveBacklog: true },
      { run: async () => ({ stdout: "no-source\n", code: 0 }) },
    );
    assert.equal(second, "no-source");
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("the picker refuses an upload of a sibling game: Vice City Stories for Vice City, Half-Life 2 for Half-Life", async () => {
  const { siblingNamed, judgeUploads } = await import("../src/sceneindex/build.ts");
  const { siblingsOf } = await import("../src/sceneindex/archive.ts");
  const vc = siblingsOf("Grand Theft Auto: Vice City");
  assert.equal(siblingNamed("GTA Vice City Stories - All Cutscenes (Game Movie)", "Grand Theft Auto: Vice City", vc), "Grand Theft Auto: Vice City Stories");
  assert.equal(siblingNamed("GTA Vice City - All Cutscenes (Game Movie)", "Grand Theft Auto: Vice City", vc), undefined);
  assert.equal(siblingNamed("Half-Life 2 Full Movie", "Half-Life", siblingsOf("Half-Life")), "Half-Life 2");
  const v = judgeUploads(
    [{ videoId: "aaaaaaaaaaa", title: "GTA Vice City Stories - All Cutscenes (Game Movie)", uploader: "U", duration: 9000 }],
    "Grand Theft Auto: Vice City",
    { siblings: vc },
  )[0]!;
  assert.equal(v.ok, false);
});

test("with ARCHIVE_BACKLOG a game a video asks for gets the light index first; launch plans still build in full", async () => {
  const { sceneIndexTick, queueGame, writeQueue, readQueue: rq, planGame } = await import("../src/sceneindex/job.ts");
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "archive-"));
  try {
    const now = new Date("2026-11-12T23:00:00Z");
    await writeQueue(dataDir, queueGame({ games: [] }, "Some Game", "a video about it", now));
    const seen: string[][] = [];
    const cfg = { dataDir, sceneIndex: true, sceneIndexProxyHeight: 480, sceneIndexOcrFps: 2, sceneIndexChunkMinutes: 10, sceneIndexMaxHours: 12, sceneIndexTurnSteps: 3, ytdlpPath: "yt-dlp", whisperPython: "", macMinFreeGb: 0, archiveBacklog: true, archiveComments: 50 };
    const run = async (_c: string, a: string[]) => {
      seen.push(a);
      return { stdout: a.includes("light") ? "light abcdefghijk 800000\n" : "stretch {}\n", code: 0 };
    };
    assert.equal(await sceneIndexTick(cfg, [], { now: () => now, freeGb: async () => 999, run }), "done");
    assert.ok(seen[0]!.includes("light") && seen[0]!.includes("--comments=50"));
    assert.equal((await rq(dataDir)).games[0]!.state, "done");
    const plan = { searchEveryHours: 3, recheckEveryHours: 24, recheckUntil: "2026-12-30T00:00:00Z", priority: 50 };
    await writeQueue(dataDir, planGame({ games: [] }, "Big Game", plan, "footage: owner", now));
    assert.equal(await sceneIndexTick(cfg, [], { now: () => now, freeGb: async () => 999, run }), "stretch");
    assert.ok(seen[1]!.includes("build"));
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("captions are found in the upload's own subtitles or the automatic ones", async () => {
  const { hasCaptions } = await import("../src/sceneindex/light.ts");
  assert.equal(hasCaptions({ subtitles: {}, automatic_captions: { "en-orig": [] } }), true);
  assert.equal(hasCaptions({ subtitles: { "en-GB": [] } }), true);
  assert.equal(hasCaptions({ subtitles: { de: [] }, automatic_captions: {} }), false);
});

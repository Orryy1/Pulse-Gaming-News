// The Mass Effect ranking audit (25 Nov 2026, UVB7zlh3ssU): 0.6% moving footage, one IGDB screenshot shown 11 times
// for 52 s, and no character the narration named ever on screen. The fixes: later Steam editions of the same game
// are taken (STEAM_EDITIONS), every copy of one picture counts as one under a hard cap (LONG_STILL_MAX_SHOWS), a
// chapter asks its trailers for a share of moving footage and plays it first (LONG_MIN_MOVING_SHARE), the IGDB
// top-up skips pictures already held, and a named character gets their own picture (LONG_NAMED_ART).
import { test } from "node:test";
import assert from "node:assert/strict";
import { steamEditionOf, storeBase } from "../src/assets/steamedition.ts";
import { capPool, pictureKey } from "../src/render/stillcap.ts";
import { buildLongPlan, chapterPictureAudit } from "../src/render/longplan.ts";
import { capSamePicture } from "../src/render/picturecap.ts";
import type { Segment } from "../src/render/timeline.ts";
import { entryFillSeconds, steamAppForEntry } from "../src/pipeline.ts";
import {
  namedSubjects,
  pickIgdbCharacter,
  seriesOf,
} from "../src/assets/namedart.ts";
import { parseIgdbCharacters, fetchIgdbArt } from "../src/assets/igdb.ts";
import { loadConfig } from "../src/config.ts";
import { chooseFillers, thinChapter } from "../src/assets/fillers.ts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------- Steam editions

test("STEAM_EDITIONS: a later edition of the same game is taken; a remake, a reboot or an unasked collection is not", () => {
  // The four pages the year rule refused on the Mass Effect ranking.
  assert.equal(
    steamEditionOf(
      "Mass Effect: Andromeda",
      "Mass Effect™: Andromeda Deluxe Edition",
      3,
    ),
    "edition",
  );
  assert.equal(
    steamEditionOf("Mass Effect 2", "Mass Effect 2 (2010) Edition", 13),
    "edition",
  );
  assert.equal(
    steamEditionOf(
      "Mass Effect",
      "Mass Effect™ Legendary Edition",
      14,
      "Mass Effect Legendary Edition",
    ),
    "edition",
  );
  assert.equal(
    steamEditionOf(
      "Mass Effect 3",
      "Mass Effect™ Legendary Edition",
      9,
      "Mass Effect Legendary Edition",
    ),
    "collection",
  );
  // A collection the writer did not ask for may not contain the game (the Legendary Edition has no Andromeda).
  assert.equal(
    steamEditionOf(
      "Mass Effect: Andromeda",
      "Mass Effect™ Legendary Edition",
      4,
      "Mass Effect: Andromeda",
    ),
    undefined,
  );
  // What the year rule is for: a remake's purchase tier and a reboot stay refused.
  assert.equal(
    steamEditionOf("Resident Evil 4", "Resident Evil 4 Gold Edition", 18),
    undefined,
  );
  assert.equal(
    steamEditionOf("Resident Evil 4", "Resident Evil 4", 18),
    undefined,
  );
  assert.equal(
    steamEditionOf(
      "Call of Duty 4: Modern Warfare",
      "Call of Duty®: Modern Warfare®",
      12,
    ),
    undefined,
  );
  assert.equal(
    steamEditionOf(
      "Final Fantasy VII",
      "Final Fantasy VII Remake Intergrade",
      24,
    ),
    undefined,
  );
  // A remaster is the same game at any distance; a numbered sequel's collection is not a collection of this game.
  assert.equal(
    steamEditionOf("Dark Souls", "Dark Souls: Remastered", 7),
    "edition",
  );
  // An older store page, a year in the name that is not the entry's, and remakes sold under edition words.
  assert.equal(
    steamEditionOf("Resident Evil 4", "Resident Evil 4 (2005)", -9, "", 2023),
    undefined,
  );
  assert.equal(steamEditionOf("DOOM", "DOOM (1993)", 0, "", 2016), undefined);
  assert.equal(
    steamEditionOf(
      "Mass Effect 2",
      "Mass Effect 2 (2010) Edition",
      13,
      "",
      2010,
    ),
    "edition",
  );
  assert.equal(
    steamEditionOf("Tomb Raider", "Tomb Raider: Anniversary", 11),
    undefined,
  );
  assert.equal(
    steamEditionOf("Mafia", "Mafia: Definitive Edition", 18),
    undefined,
  );
  assert.equal(
    steamEditionOf("SimCity", "SimCity Complete Edition", 24),
    undefined,
  );
  assert.deepEqual(storeBase("Mass Effect™ Legendary Edition"), [
    "mass",
    "effect",
  ]);
});

test("steamAppForEntry takes the edition only with STEAM_EDITIONS on, and keeps refusing the remake", async () => {
  const page = (name: string, date: string) => ({
    appId: 1,
    name,
    details: { release_date: { date } },
  });
  const entry = {
    steam_search_term: "Mass Effect 2",
    year: 2010,
    game_title: "Mass Effect 2",
  };
  const s = (name: string, date: string, on?: boolean) => ({
    findGame: async () => page(name, date) as never,
    cfg: on === undefined ? undefined : { steamEditions: on },
  });
  assert.ok(
    await steamAppForEntry(
      s("Mass Effect 2 (2010) Edition", "7 Jun, 2023"),
      entry,
    ),
  );
  assert.ok(
    await steamAppForEntry(
      s("Mass Effect 2 (2010) Edition", "7 Jun, 2023", true),
      entry,
    ),
  );
  assert.equal(
    await steamAppForEntry(
      s("Mass Effect 2 (2010) Edition", "7 Jun, 2023", false),
      entry,
    ),
    undefined,
  );
  const re4 = {
    steam_search_term: "Resident Evil 4",
    year: 2005,
    game_title: "Resident Evil 4",
  };
  assert.equal(
    await steamAppForEntry(
      {
        findGame: async () => page("Resident Evil 4", "24 Mar, 2023") as never,
      },
      re4,
    ),
    undefined,
  );
});

test("the new switches default on", () => {
  const cfg = loadConfig();
  assert.equal(cfg.steamEditions, true);
  assert.equal(cfg.longStillMaxShows, 2);
  assert.equal(cfg.longMinMovingShare, 0.5);
  assert.equal(cfg.longEntryClipTargets, 24);
  assert.equal(cfg.longNamedArt, true);
});

// ---------------------------------------------------------------- one picture, every copy

test("pictureKey: every copy of one picture is one picture (IGDB sizes and folders, Steam sizes and queries)", () => {
  assert.equal(
    pictureKey({
      sourceUrl: "https://images.igdb.com/igdb/image/upload/t_1080p/scsuxd.jpg",
      file: "entry_0/assets/igdb-scsuxd.jpg",
    }),
    pictureKey({
      sourceUrl:
        "https://images.igdb.com/igdb/image/upload/t_screenshot_big/scsuxd.jpg",
      file: "entry_0/more/assets/igdb-scsuxd.jpg",
    }),
  );
  // No source recorded: the IGDB file name still names the picture.
  assert.equal(
    pictureKey({ file: "entry_0/assets/igdb-scsuxd.jpg" }),
    pictureKey({ file: "entry_0/fill/assets/igdb-scsuxd.jpg" }),
  );
  assert.equal(
    pictureKey({
      sourceUrl:
        "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/ss_ab12.1920x1080.jpg?t=1",
    }),
    pictureKey({
      sourceUrl:
        "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/ss_ab12.600x338.jpg?t=2",
    }),
  );
  assert.notEqual(
    pictureKey({ file: "a/one.jpg" }),
    pictureKey({ file: "b/one.jpg" }),
  );
  // Any other source keeps its whole address: two stills from one video page at different times are two pictures.
  assert.notEqual(
    pictureKey({
      sourceUrl: "https://www.youtube.com/watch?v=abc&t=10",
      file: "a.jpg",
    }),
    pictureKey({
      sourceUrl: "https://www.youtube.com/watch?v=abc&t=95",
      file: "b.jpg",
    }),
  );
  // Faces cut from one trailer share its source but are different pictures.
  assert.notEqual(
    pictureKey({
      kind: "portrait",
      sourceUrl: "https://video.akamai.steamstatic.com/t.m3u8",
      file: "e/assets/portrait_m1.jpg",
    }),
    pictureKey({
      kind: "portrait",
      sourceUrl: "https://video.akamai.steamstatic.com/t.m3u8",
      file: "e/assets/portrait_m4.jpg",
    }),
  );
});

test("capPool: under the cap first, then one more showing of a picture off screen for a minute, then nothing", () => {
  const key = (k: number) => `p${k}`;
  const fps = 30;
  const shows = new Map([
    ["p0", 2],
    ["p1", 1],
  ]);
  const last = new Map([
    ["p0", 0],
    ["p1", 0],
  ]);
  assert.deepEqual(capPool([0, 1], key, shows, last, 100, 2, fps), {
    pool: [1],
    reshow: false,
  });
  const spent = new Map([
    ["p0", 2],
    ["p1", 2],
  ]);
  // Both seen within the minute: nothing may go up.
  assert.deepEqual(
    capPool(
      [0, 1],
      key,
      spent,
      new Map([
        ["p0", 10],
        ["p1", 1700],
      ]),
      1900,
      2,
      fps,
    ).pool,
    [0],
  );
  assert.equal(
    capPool(
      [0, 1],
      key,
      spent,
      new Map([
        ["p0", 1790],
        ["p1", 1790],
      ]),
      1800,
      2,
      fps,
    ).pool.length,
    0,
  );
  // Off: everything as before.
  assert.deepEqual(capPool([0, 1], key, spent, last, 0, 0, fps).pool, [0, 1]);
});

// ---------------------------------------------------------------- the planner

function chapter(n: number) {
  const words: Array<{ text: string; start: number; end: number }> = [];
  let t = 0;
  const say = (text: string) => {
    for (const w of text.split(/\s+/).filter(Boolean)) {
      words.push({ text: w, start: t, end: t + 0.35 });
      t += 0.4;
    }
    t += 0.3;
  };
  say("A short intro to the ranking.");
  const beatStart = t;
  const sentences = Array.from(
    { length: n },
    (_, i) =>
      `Sentence ${i} goes on for a good while about the squad and the ship and the war.`,
  );
  for (const s of sentences) say(s);
  const takeStart = t;
  say("That was the ranking.");
  const segments: Segment[] = [
    {
      kind: "hook",
      text: "A short intro to the ranking.",
      start: 0,
      end: beatStart,
    },
    {
      kind: "beat",
      text: sentences.join(" "),
      start: beatStart,
      end: takeStart,
      visual: {
        kind: "rank",
        primary: "Mass Effect Galaxy",
        secondary: "",
        items: ["2009"],
      } as never,
    },
    { kind: "take", text: "That was the ranking.", start: takeStart, end: t },
  ];
  return { words, segments, duration: t + 6 };
}

/** The Galaxy entry as it was: three IGDB screenshots, each downloaded into two folders, pinned to many lines. */
function galaxy(n: number) {
  const ids = ["scsuxd", "scsuxc", "scsuxe"];
  const images = ids.flatMap((id, j) =>
    ["assets", "more/assets"].map((dir, d) => ({
      kind: "screenshot",
      aspect: 16 / 9,
      beatIndex: 0,
      // Pinned copies on several lines, as the still editor and the sentence top-up left them.
      moment: d === 0 ? j : j + 3,
      file: `entry_0/${dir}/igdb-${id}.jpg`,
      sourceUrl: `https://images.igdb.com/igdb/image/upload/t_1080p/${id}.jpg`,
    })),
  );
  return { ...chapter(n), images };
}

const shownBySource = (
  plan: ReturnType<typeof buildLongPlan>,
  images: Array<{ file?: string; sourceUrl?: string }>,
) => {
  const n = new Map<string, number>();
  for (const s of plan.shots)
    if (s.media.type === "image") {
      const k = pictureKey(images[s.media.index]!);
      n.set(k, (n.get(k) ?? 0) + 1);
    }
  return n;
};

test("LONG_STILL_MAX_SHOWS: no picture past the cap while footage can fill, every copy counted as one", () => {
  const { words, segments, duration, images } = galaxy(14);
  const clips = Array.from({ length: 16 }, (_, k) => ({
    durationSeconds: 4.8,
    beatIndex: 0,
    span: { source: "trailer", from: k * 10, to: k * 10 + 4.8 },
  }));
  const input = {
    segments,
    words,
    durationSeconds: duration,
    images,
    clips: [] as typeof clips,
    variant: 0,
    momentCounts: [14],
    noRepeats: true,
  };
  // Before: three pictures fill a 14-sentence chapter, each shown again and again.
  const before = buildLongPlan(input);
  assert.ok(
    Math.max(...shownBySource(before, images).values()) > 3,
    "the old plan repeats",
  );
  assert.equal(before.notes, undefined, "no notes with the cap off");
  // After, with footage to spend: every clip plays before any picture goes past the cap; once the footage is spent a
  // picture off screen for a minute may come back once more (on the depth camera), and nothing goes past that.
  const after = buildLongPlan({ ...input, clips, stillMaxShows: 2 });
  const shown = shownBySource(after, images);
  for (const [k, n] of shown) assert.ok(n <= 3, `${k} shown ${n} times`);
  const third = [...shown.values()].filter((n) => n === 3).length;
  assert.ok(
    third <= (after.notes?.reshows ?? 0),
    "a third showing is always a counted depth-camera reshow",
  );
  assert.equal(
    new Set(
      after.shots
        .filter((s) => s.segment === 1 && s.media.type === "clip")
        .map((s) => s.media.index),
    ).size,
    clips.length,
  );
  assert.equal(after.notes?.overCap, 0);
  assert.ok(
    Math.max(...shown.values()) <
      Math.max(...shownBySource(before, images).values()),
  );
});

test("LONG_STILL_MAX_SHOWS with nothing else to show: one more showing on the depth camera, then counted repeats, never the plate", () => {
  const { words, segments, duration, images } = galaxy(14);
  const plan = buildLongPlan({
    segments,
    words,
    durationSeconds: duration,
    images,
    clips: [],
    variant: 0,
    momentCounts: [14],
    noRepeats: true,
    stillMaxShows: 2,
  });
  // The chapter is never left on the empty plate to keep the cap: what went past it is counted for the top-up.
  assert.equal(
    plan.shots.filter((s) => s.segment === 1 && s.media.type === "plate")
      .length,
    0,
  );
  assert.ok((plan.notes?.reshows ?? 0) + (plan.notes?.overCap ?? 0) > 0);
});

test("LONG_MIN_MOVING_SHARE: the chapter's footage plays before its stills even without LONG_MOVING_FIRST", () => {
  const { words, segments, duration, images } = galaxy(10);
  const clips = Array.from({ length: 6 }, (_, k) => ({
    durationSeconds: 4.8,
    beatIndex: 0,
    span: { source: "trailer", from: k * 10, to: k * 10 + 4.8 },
  }));
  const input = {
    segments,
    words,
    durationSeconds: duration,
    images,
    clips,
    variant: 0,
    momentCounts: [10],
    noRepeats: true,
  };
  const fps = 30;
  const moving = (p: ReturnType<typeof buildLongPlan>) =>
    p.shots
      .filter((s) => s.segment === 1 && s.media.type === "clip")
      .reduce((n, s) => n + s.end - s.start, 0) / fps;
  assert.ok(
    moving(buildLongPlan({ ...input, minMovingShare: 0.5 })) >
      moving(buildLongPlan(input)),
  );
  const audit = chapterPictureAudit(
    buildLongPlan({ ...input, minMovingShare: 0.5 }),
    segments,
    images,
  );
  const ch = audit.chapters.find((c) => c.entry === 0)!;
  assert.ok(ch.movingShare > 0.3, `chapter moving share ${ch.movingShare}`);
});

test("a character picture (LONG_NAMED_ART) opens the line that names them, before that line's footage", () => {
  const { words, segments, duration } = chapter(4);
  const images = [
    {
      kind: "screenshot",
      aspect: 16 / 9,
      beatIndex: 0,
      moment: 0,
      file: "a.jpg",
    },
    { kind: "screenshot", aspect: 16 / 9, beatIndex: 0, file: "b.jpg" },
    {
      kind: "hero",
      aspect: 0.8,
      beatIndex: 0,
      moment: 2,
      file: "garrus.jpg",
      named: "Garrus Vakarian",
    },
  ];
  const clips = [{ durationSeconds: 4.8, beatIndex: 0, moment: 2 }];
  const plan = buildLongPlan({
    segments,
    words,
    durationSeconds: duration,
    images,
    clips,
    variant: 0,
    momentCounts: [4],
    minMovingShare: 0.5,
  });
  const first = plan.shots
    .filter((s) => s.segment === 1)
    .findIndex((s) => s.media.type === "image" && s.media.index === 2);
  const clip = plan.shots
    .filter((s) => s.segment === 1)
    .findIndex((s) => s.media.type === "clip" && s.media.index === 0);
  assert.ok(
    first >= 0 && clip >= 0 && first < clip,
    `named picture at ${first}, clip at ${clip}`,
  );
});

test("capSamePicture counts two copies of one source as one picture", () => {
  const fps = 30;
  const images = [
    {
      kind: "screenshot",
      beatIndex: 0,
      file: "e/assets/igdb-x.jpg",
      sourceUrl: "https://images.igdb.com/igdb/image/upload/t_1080p/x.jpg",
    },
    {
      kind: "screenshot",
      beatIndex: 0,
      file: "e/more/assets/igdb-x.jpg",
      sourceUrl: "https://images.igdb.com/igdb/image/upload/t_720p/x.jpg",
    },
    { kind: "screenshot", beatIndex: 0, file: "e/assets/igdb-y.jpg" },
  ];
  const shots = [0, 1, 0, 1].map((index, i) => ({
    start: i * 6 * fps,
    end: (i + 1) * 6 * fps,
    segment: 1,
    media: { type: "image" as const, index },
    move: "pushIn" as const,
  }));
  const r = capSamePicture(shots, 12, fps, {
    images,
    clips: [],
    real: () => false,
    entryOf: () => 0,
    clipsPlayed: new Set(),
  });
  // 24 s of one picture in a minute, cap 12: the second half goes to the other picture.
  assert.ok(r.replaced > 0);
  assert.ok(
    r.shots.some((s) => s.media.type === "image" && s.media.index === 2),
  );
});

// ---------------------------------------------------------------- the gather

test("entryFillSeconds: the share of the chapter's estimated length, none when off or empty", () => {
  const words = Array.from({ length: 216 }, () => "word").join(" ");
  assert.deepEqual(entryFillSeconds(words, 0.5), { seconds: 40 });
  assert.equal(entryFillSeconds(words, 0), undefined);
  assert.equal(entryFillSeconds("", 0.5), undefined);
});

test("the IGDB top-up skips the pictures the episode already has", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mealign-"));
  const asked: string[] = [];
  const fetchFn = (async (url: string) => {
    asked.push(String(url));
    return new Response(new Uint8Array([1, 2, 3]));
  }) as unknown as typeof fetch;
  const game = {
    id: 1,
    name: "Mass Effect Galaxy",
    screenshots: ["a", "b", "c", "d"],
    artworks: [],
  };
  const got = await fetchIgdbArt(game, dir, 2, fetchFn, new Set(["a", "b"]));
  assert.deepEqual(
    got.map((g) => path.basename(g.file)),
    ["igdb-c.jpg", "igdb-d.jpg"],
  );
  await fs.rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- named characters

test("namedSubjects: the writer's person first, then a keyword that reads as a name, never the game's own words", () => {
  assert.deepEqual(
    namedSubjects(
      {
        person: "Jacob Taylor",
        keywords: ["Mass Effect Galaxy", "Jacob combat", "Miranda Lawson"],
      },
      "Mass Effect Galaxy",
    ),
    ["Jacob Taylor", "Miranda Lawson"],
  );
  assert.deepEqual(
    namedSubjects(
      { person: "", keywords: ["Loyalty Missions", "the Normandy", "2009"] },
      "Mass Effect 2",
    ),
    [],
  );
  assert.deepEqual(
    namedSubjects(
      { person: "Garrus Vakarian", keywords: ["Garrus Vakarian"] },
      "Mass Effect",
    ),
    ["Garrus Vakarian"],
  );
});

test("pickIgdbCharacter: the same name, with a picture, in a game of this series; otherwise nothing", () => {
  const rows = parseIgdbCharacters([
    {
      name: "Garrus Vakarian",
      mug_shot: { image_id: "g1" },
      games: [{ name: "Mass Effect" }, { name: "Mass Effect 2" }],
    },
    {
      name: "Commander Shepard (male)",
      mug_shot: { image_id: "s1" },
      games: [{ name: "Mass Effect 2" }],
    },
    { name: "Saren", games: [{ name: "Mass Effect" }] },
    {
      name: "Jacob Frye",
      mug_shot: { image_id: "j1" },
      games: [{ name: "Assassin's Creed Syndicate" }],
    },
  ]);
  assert.equal(seriesOf("Mass Effect: Andromeda"), "mass effect");
  assert.equal(seriesOf("Mass Effect 3"), "mass effect");
  assert.equal(
    pickIgdbCharacter(rows, "Garrus Vakarian", "Mass Effect")?.mugShot,
    "g1",
  );
  assert.equal(
    pickIgdbCharacter(rows, "Commander Shepard", "Mass Effect 2")?.mugShot,
    "s1",
  );
  // No picture on IGDB, or another series' Jacob: nothing rather than the wrong face.
  assert.equal(pickIgdbCharacter(rows, "Saren", "Mass Effect"), undefined);
  assert.equal(pickIgdbCharacter(rows, "Jacob Frye", "Mass Effect"), undefined);
  assert.equal(pickIgdbCharacter(rows, "Garrus Vakarian", "Halo"), undefined);
});

test("LONG_THIN_CARD_SHARE: a chapter its pictures cannot fill under the cap takes more cards than LONG_CARD_SHARE alone", () => {
  const moments = Array.from({ length: 12 }, () => ({
    show: "x",
    graphic: { kind: "none", primary: "", secondary: "", items: [] },
    emphasis: "",
    person: "",
  }));
  const ch = {
    entry: 0,
    game: "G",
    year: 2020,
    sentences: moments.map((_, k) =>
      k % 2
        ? "Players with limited free time shaped the design too."
        : "The replacement announcement presents a separate sourcing gap.",
    ),
    moments,
  };
  // Two IGDB pictures, each downloaded into two folders and pinned to six lines: two pictures, not twelve.
  const images = moments.map((_, k) => ({
    file: `entry_0/${k % 4 < 2 ? "assets" : "more/assets"}/igdb-${k % 2 ? "a" : "b"}.jpg`,
    sourceUrl: `https://images.igdb.com/igdb/image/upload/t_1080p/${k % 2 ? "a" : "b"}.jpg`,
    kind: "screenshot",
    beatIndex: 0,
    moment: k,
  }));
  assert.equal(thinChapter(ch as never, images, [] as never, 2), true);
  // With footage enough for every line it is not thin.
  const clips = moments.map((_, k) => ({ beatIndex: 0, moment: k, durationSeconds: 4 }));
  assert.equal(thinChapter(ch as never, images, clips as never, 2), false);
  const share = chooseFillers([ch] as never, { images, clips: [], seed: 1, cardShare: 0.3 });
  const thin = chooseFillers([ch] as never, {
    images,
    clips: [],
    seed: 1,
    cardShare: 0.3,
    thin: { share: 0.6, maxShows: 2 },
  });
  assert.ok(thin.picks.length > share.picks.length, `${thin.picks.length} > ${share.picks.length}`);
});

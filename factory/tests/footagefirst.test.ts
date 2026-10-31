import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { createHash } from "node:crypto";
import {
  assignSegments,
  ccBy,
  condemnedSources,
  footageNeed,
  footageNotice,
  footageQueries,
  footageShare,
  footageWants,
  gatherChapterFootage,
  gatherFootageFirst,
  emptyReport,
  junkSourceReason,
  matchWords,
  namesGame,
  otherEntry,
  pullWindow,
  roundRobin,
  segmentRejectReason,
  segmentsOf,
  poorSources,
  letterboxed,
  fairDeadline,
  prefetchChapter,
  dHash,
  hamming,
  captionWords,
  FOOTAGE_FIRST_DEFAULTS,
  DOWNLOADS_AT_ONCE,
  type FootageClip,
  type FootageFirstDeps,
} from "../src/assets/footagefirst.ts";
import { junkTitleReason, notOutYet } from "../src/assets/junk.ts";
import { lookAnswer, type SegmentLook } from "../src/assets/localvision.ts";
import { parseSearchRows } from "../src/assets/footagedeps.ts";
import {
  chapterSeconds,
  footageShareNotice,
  runFootageFirst,
} from "../src/assets/footagestep.ts";
import { gameplayClips } from "../src/assets/gameplay.ts";
import { buildLongPlan, overlappingClips } from "../src/render/longplan.ts";
import type { Segment } from "../src/render/timeline.ts";

const VC = "Grand Theft Auto: Vice City";
const GTA = "Grand Theft Auto";

test("junk is refused by title and channel before any download: the GTA VI chapter's mods, kids' videos, reactions, remasters", () => {
  // Titles seen on YouTube's Creative Commons search for these games (31 Oct 2026).
  const refused: Array<[string, string, string, string, number?]> = [
    [
      "Spider-Man vs Hulk MEGA RAMP challenge GTA 6",
      "Kids Gaming TV",
      "Grand Theft Auto VI",
      GTA,
      2026,
    ],
    ["Grand Theft Auto. Vice City - Real Mod # 9 !!!!!!", "Pro100Man", VC, GTA],
    ["I destroyed GTA Vice City with the Chaos Mod", "Call Me Kevin", VC, GTA],
    [
      "GTA Vice City Reviced Full Gameplay Playthrough 2025",
      "COOP Walkthrough",
      VC,
      GTA,
    ],
    ["GTA Vice City Hardlined Walkthrough Part 1", "SCuprikov", VC, GTA],
    [
      "GTA VI: Vice City FULL MAP EXPLORATION w/ Commentary | Washington Beach [2015 build]",
      "dons",
      VC,
      GTA,
    ],
    [
      "GTA Vice City DE - The Chase | Part 11 | No Copyright Gameplay",
      "Games Gossip Gameplays",
      VC,
      GTA,
    ],
    [
      "[First Play] GTA Vice City - The Definitive Edition | Ep. 3",
      "Killusion",
      VC,
      GTA,
    ],
    [
      "GTA VICE CITY NEXTGEN EDITION Free Roam Gameplay 2025",
      "Purple Boy GamerX",
      VC,
      GTA,
    ],
    [
      "How to Get City Sleuth Trophy in Grand Theft Auto Vice City",
      "How2Trophies",
      VC,
      GTA,
    ],
    [
      "GTA 6 Extended Look - Full 5 Minute Gameplay *Fan Made Concept Graphics*",
      "Gta6Domination",
      "Grand Theft Auto VI",
      GTA,
    ],
    ["Grand Theft Auto San Andreas gameplay", "Someone", VC, GTA],
    ["GTA Vice City gameplay in GTA 5", "Someone", VC, GTA],
    [
      "GAME SINS | Everything WRONG With Grand Theft Auto: San Andreas",
      "Dartigan",
      "Grand Theft Auto: San Andreas",
      GTA,
    ],
    [
      "Why Does GTA San Andreas Feel like a Horror Game?? | Game Explorations",
      "sot0sam",
      "Grand Theft Auto: San Andreas",
      GTA,
    ],
    [
      "Grand Theft Auto: Vice City (2002) Kill Count",
      "Video Game Kill Counts",
      VC,
      GTA,
    ],
    [
      "What Happens If CJ knows everything from the Beginning - GTA San Andreas",
      "DiezMod97",
      "Grand Theft Auto: San Andreas",
      GTA,
    ],
  ];
  for (const [title, channel, game, franchise, year] of refused)
    assert.ok(
      junkSourceReason(title, channel, game, franchise, year),
      `refused: ${title}`,
    );
  const kept: Array<[string, string, string, number?]> = [
    [
      "Grand Theft Auto Vice City (PC) Gameplay Walkthrough FULL GAME",
      "JohnSilvaGaming",
      VC,
    ],
    [
      "Grand Theft Auto Vice City #48 · No Escape · GTA VICE CITY · NON COPYRIGHT GAMEPLAY · NCG",
      "Non Copyright Gameplay",
      VC,
    ],
    [
      "GTA Vice City Walkthrough Missions : Land of the Cops (2002) 1080p",
      "Pro100Man",
      VC,
    ],
    [
      "GTA VICE CITY Walkthrough Part 8 (Havana And Malibu Club) Full HD- No Commentary",
      "CrimsonShadow",
      VC,
    ],
    [
      "Grand Theft Auto III (PC) Gameplay Walkthrough FULL GAME",
      "JohnSilvaGaming",
      "Grand Theft Auto III",
    ],
    ["GTA 3 gameplay no commentary", "Archive", "Grand Theft Auto III"],
    ["Grand Theft Auto Vice City #12 [GamePlay Only]", "GameMania", VC],
    [
      "GTA San Andreas walkthrough #5 l Drive-Thru",
      "ARConfidential",
      "Grand Theft Auto: San Andreas",
    ],
    [
      "Grand Theft Auto (1997) DOS gameplay, no commentary",
      "The Dot Eaters",
      GTA,
      1997,
    ],
  ];
  for (const [title, channel, game, year] of kept)
    assert.equal(
      junkSourceReason(title, channel, game, GTA, year),
      undefined,
      `kept: ${title}`,
    );
  // The remaster a chapter is itself about is that game, not a remaster of it.
  assert.equal(
    junkTitleReason(
      "GTA Trilogy Definitive Edition gameplay",
      "x",
      "Grand Theft Auto: The Trilogy - Definitive Edition",
    ),
    undefined,
  );
});

test("the first game of a series needs its year or 'original': every sequel's title names the series too", () => {
  assert.equal(namesGame("GTA Vice City gameplay", GTA, GTA, 1997), false);
  assert.equal(namesGame("GTA 1997 gameplay PC", GTA, GTA, 1997), true);
  assert.equal(namesGame("Original GTA gameplay", GTA, GTA), true);
  assert.equal(namesGame("GTA Vice City gameplay", VC, GTA), true);
  assert.equal(
    otherEntry("GTA VI: Vice City map", VC),
    true,
    "Vice City has no number of its own",
  );
  assert.equal(otherEntry("GTA 3 Liberty City", "Grand Theft Auto III"), false);
  assert.equal(otherEntry("GTA 6 in GTA 5", "Grand Theft Auto V"), true);
});

test("a game not out yet gets no uploaded gameplay at all, in the gather and in the licensed-gameplay search", async () => {
  const now = new Date("2026-10-31T12:00:00Z");
  assert.equal(notOutYet(2026, now), true);
  assert.equal(notOutYet(2002, now), false);
  assert.equal(notOutYet(undefined, now), false);
  let searched = 0;
  const clips = await gameplayClips({
    token: async () => {
      searched++;
      return "x";
    },
    ytdlp: "never-run",
    game: "Grand Theft Auto VI",
    franchise: GTA,
    year: new Date().getFullYear(),
    episodeDir: os.tmpdir(),
    targets: [
      {
        key: "beat:7#m0",
        text: "Lucia in Vice City",
        want: "gameplay",
        energy: "medium",
        keywords: [],
      },
    ],
    maxClips: 4,
  });
  assert.deepEqual(clips, []);
  assert.equal(searched, 0, "nothing was searched");
});

test("only a Creative Commons Attribution licence counts", () => {
  assert.ok(ccBy("Creative Commons Attribution license (reuse allowed)"));
  assert.ok(!ccBy(""));
  assert.ok(!ccBy("Standard YouTube License"));
  assert.ok(!ccBy("Creative Commons Attribution-NonCommercial"));
});

test("each video is pulled from a different depth, clear of its intro and outro, never past its end", () => {
  const a = pullWindow(3600, 0, 420);
  const b = pullWindow(3600, 1, 420);
  assert.notEqual(a.from, b.from);
  for (const w of [a, b, pullWindow(3600, 7, 420)]) {
    assert.equal(w.to - w.from, 420);
    assert.ok(w.from >= 45 && w.to <= 3600 - 30);
  }
  // A mission video shorter than the pull is taken whole, minus its ends.
  const m = pullWindow(300, 3, 420);
  assert.ok(m.from > 0 && m.to < 300 && m.to - m.from > 250);
});

test("a window is cut at its own edits into segments of at most seven seconds; dark stretches are left out", () => {
  const rows: Array<{
    time: number;
    luma: number;
    motion: number;
    scene?: number;
  }> = [];
  for (let t = 0; t <= 30; t += 0.1) {
    const time = Math.round(t * 10) / 10;
    rows.push({
      time,
      luma: time > 22 ? 5 : 90,
      motion: 3,
      scene: Math.abs(time - 10) < 0.01 ? 0.6 : 0.01,
    });
  }
  const segs = segmentsOf(rows, 30);
  assert.ok(segs.length >= 3);
  for (const s of segs) {
    assert.ok(s.len <= 7 + 1e-9 && s.len >= 2.4 - 1e-9, `length ${s.len}`);
    assert.ok(
      !(s.from < 10 && s.from + s.len > 10),
      "no segment crosses the edit at 10 s",
    );
    assert.ok(s.from + s.len <= 22.8, "the dark tail is left out");
  }
});

const look = (over: Partial<SegmentLook> = {}): SegmentLook => ({
  label: "red car on beach road",
  hud: false,
  text: false,
  webcam: false,
  gore: false,
  letterbox: false,
  dark: false,
  blurry: false,
  mod: false,
  menu: false,
  live: false,
  ...over,
});

test("a dim stretch is left out even with no black frame in it", () => {
  const rows = Array.from({ length: 201 }, (_, i) => ({
    time: i / 10,
    luma: i < 100 ? 38 : 90,
    motion: 3,
    scene: 0.01,
  }));
  const segs = segmentsOf(rows, 20);
  assert.ok(segs.length > 0);
  assert.ok(
    !segs.some((s) => s.from + s.len <= 10),
    "no segment wholly in the dim half",
  );
});

test("a segment is refused for mods, facecams, menus, text, real footage; a mostly-mod video loses every segment", () => {
  assert.equal(segmentRejectReason(look()), undefined);
  assert.equal(
    segmentRejectReason(look({ mod: true })),
    "mod or kids' content",
  );
  assert.equal(
    segmentRejectReason(look({ menu: true })),
    "menu or loading screen",
  );
  assert.equal(
    segmentRejectReason(look({ hud: true })),
    undefined,
    "the game's own HUD is fine",
  );
  assert.equal(segmentRejectReason(look({ text: true })), "text on screen");
  assert.equal(segmentRejectReason(undefined), "not looked at");
  const bad = condemnedSources([
    { source: "a", reason: "mod or kids' content" },
    { source: "a", reason: "mod or kids' content" },
    { source: "a" },
    { source: "a" },
    { source: "b", reason: "text on screen" },
    { source: "b" },
  ]);
  assert.deepEqual([...bad], ["a"]);
  assert.deepEqual(
    lookAnswer({
      label: " Tommy  on a pier ",
      text: true,
      hud_only: true,
      mod: true,
    }),
    look({ label: "Tommy on a pier", hud: true, text: false, mod: true }),
  );
});

test("segments are pinned to the sentences their labels describe, at most two each, never one twice, the game's name aside", () => {
  assert.deepEqual(matchWords("Driving a sports car at sunset"), [
    "car",
    "sport",
    "night",
  ]);
  const wants = [
    {
      moment: 3,
      text: "You could steal any car and drive it down Ocean Drive.",
    },
    { moment: 5, text: "Police helicopters chase you over the bay." },
    { moment: 6, text: "Vice City itself was the star." },
  ];
  const segs = [
    { id: 0, source: "a", label: "red sports car on palm street", len: 5 },
    { id: 1, source: "a", label: "car driving at night by neon", len: 6 },
    { id: 2, source: "b", label: "blue sedan on a road", len: 4 },
    { id: 3, source: "b", label: "police helicopter over water", len: 5 },
    { id: 4, source: "c", label: "Vice City skyline", len: 5 },
  ];
  const pins = assignSegments(wants, segs, [VC, GTA], 2);
  const of = (m: number) =>
    [...pins].filter(([, k]) => k === m).map(([s]) => s);
  assert.equal(of(3).length, 2, "two segments for the car line");
  assert.ok(
    new Set(of(3).map((s) => segs[s]!.source)).size === 2,
    "from two videos",
  );
  assert.deepEqual(of(5), [3]);
  assert.deepEqual(of(6), [], "the game's own name is not a match");
  assert.equal(new Set(pins.keys()).size, pins.size);
});

test("the share counts moving game footage over narrated game-chapter time; stock and stills do not count", () => {
  const shots = [
    { start: 0, end: 300, segment: 0, media: { type: "clip", index: 0 } }, // the intro: not a chapter
    { start: 300, end: 600, segment: 1, media: { type: "clip", index: 1 } },
    { start: 600, end: 900, segment: 1, media: { type: "image", index: 0 } },
    { start: 900, end: 1200, segment: 2, media: { type: "clip", index: 2 } }, // stock
  ];
  const m = footageShare(
    shots,
    30,
    (s) => (s === 0 ? undefined : s - 1),
    (k) => k === 2,
  );
  assert.equal(m.seconds, 30);
  assert.equal(m.footage, 10);
  assert.equal(m.stock, 10);
  assert.ok(Math.abs(m.share - 1 / 3) < 1e-9);
  assert.equal(m.perChapter.get(0), 0.5);
  assert.equal(m.perChapter.get(1), 0);
  // 60% of 300 s is 180 s on screen; 100 s of clips play about 60 s; 120 s more to play is 200 s to gather.
  assert.equal(Math.round(footageNeed(300, 100, 60)), 200);
  assert.equal(footageNeed(100, 110, 60), 0);
  assert.match(
    footageShareNotice("Vice City", m, 60, ["Vice City", "San Andreas"]),
    /33% .*target 60%.*San Andreas 0%/,
  );
  assert.ok(!/—/.test(footageShareNotice("x", m, 60, [])), "no long dashes");
});

test("wants skip real-world lines and lines already on their own footage", () => {
  const ch = {
    entry: 2,
    game: VC,
    franchise: GTA,
    moments: [
      { show: "Ocean Drive" },
      { show: "Sam Houser", person: "Sam Houser" },
      { show: "office", broll: "office at night" },
      { show: "boat" },
    ],
    sentences: ["a", "b", "c", "d"],
  };
  assert.deepEqual(
    footageWants(ch, [{ beatIndex: 2, moment: 3 }]).map((w) => w.moment),
    [0],
  );
  assert.equal(footageQueries(VC, 2002).length, 4);
  assert.ok(
    chapterSeconds([
      "one two three four five six seven eight nine ten eleven twelve thirteen",
    ]) > 4,
  );
});

/** Fakes for the whole pass: three search hits (one junk), licences, a 60 s window, looks by frame name. */
function fakes(
  dir: string,
  looks: (i: number, src: string) => SegmentLook | undefined,
) {
  const calls = { downloads: [] as string[], looked: 0, leases: 0 };
  const deps: FootageFirstDeps = {
    search: async () => [
      {
        videoId: "aaaaaaaaaaa",
        title: "GTA Vice City Gameplay Walkthrough Part 1",
        channel: "Alpha",
      },
      {
        videoId: "bbbbbbbbbbb",
        title: "GTA Vice City Spider-Man Mega Ramp",
        channel: "Fun Kids",
      },
      {
        videoId: "ccccccccccc",
        title: "Grand Theft Auto Vice City gameplay no commentary",
        channel: "Beta",
      },
      {
        videoId: "ddddddddddd",
        title: "GTA Vice City gameplay (standard licence)",
        channel: "Gamma",
      },
    ],
    details: async (id) => ({
      license:
        id === "ddddddddddd"
          ? ""
          : "Creative Commons Attribution license (reuse allowed)",
      seconds: 1800,
      channel:
        id === "aaaaaaaaaaa"
          ? "Alpha"
          : id === "ccccccccccc"
            ? "Beta"
            : "Gamma",
      title: "",
    }),
    download: async (url, _from, _to, dest) => {
      calls.downloads.push(url);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, "x".repeat(1000));
      return 1000;
    },
    scan: async () =>
      Array.from({ length: 601 }, (_, i) => ({
        time: i / 10,
        luma: 90,
        motion: 3,
        scene: 0.01,
      })),
    frames: async (_f, _at, _s, prefix) => {
      const out = [1, 2, 3].map((k) => `${prefix}_0${k}.jpg`);
      for (const f of out) await fs.writeFile(f, "jpg");
      return out;
    },
    compose: async (_files, dest) => {
      await fs.writeFile(dest, "jpg");
    },
    // Every segment its own picture unless a test says otherwise.
    hash: async (f) => {
      const n = Number(f.match(/seg_(\d+)/)?.[1] ?? 0);
      // A pseudo-random 64-bit pattern per segment: two segments differ in about 32 bits.
      return [...createHash("sha256").update(String(n)).digest().subarray(0, 8)]
        .map((x) => x.toString(2).padStart(8, "0"))
        .join("");
    },
    ocr: async () => new Map(),
    look: async (files) => {
      calls.looked += files.length;
      // Looks keyed by segment: both frames of one segment get the same answer.
      return files.map((f, i) =>
        looks(Number(f.match(/seg_(\d+)/)?.[1] ?? i), f),
      );
    },
    cut: async (_f, _at, seconds, dest) => {
      await fs.writeFile(dest, "mp4");
      return seconds;
    },
    lease: async () => {
      calls.leases++;
      return () => undefined;
    },
  };
  return { deps, calls, dir };
}

test("the pass gathers credited CC BY segments, pins the matching ones, refuses junk and counts everything", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-"));
  const { deps, calls } = fakes(dir, (i) =>
    i % 5 === 4
      ? look({ mod: true })
      : look({
          label:
            i % 2 ? "red sports car on palm street" : "pink motel by the beach",
        }),
  );
  const ch = {
    entry: 2,
    game: VC,
    franchise: GTA,
    year: 2002,
    moments: [{ show: "a car on Ocean Drive" }, { show: "the beach" }],
    sentences: ["You steal a car.", "The beach at dusk."],
  };
  const report = emptyReport();
  const out: FootageClip[] = [];
  await gatherChapterFootage(
    deps,
    ch,
    [],
    path.join(dir, "entry_2"),
    "entry_2",
    200,
    FOOTAGE_FIRST_DEFAULTS,
    report,
    out,
    Number.POSITIVE_INFINITY,
  );
  assert.equal(
    calls.downloads.length,
    2,
    "the kids' video and the standard-licence one are never downloaded",
  );
  assert.ok(!calls.downloads.some((u) => u.includes("bbbbbbbbbbb")));
  assert.equal(calls.leases, 1, "one GPU turn for the looks");
  assert.ok(
    report.sourcesRejected.some((r) => r.why === "kids or stunt video"),
  );
  assert.ok(report.sourcesRejected.some((r) => /not CC BY/.test(r.why)));
  assert.ok(
    report.segmentsRejected.some((r) => r.why === "mod or kids' content"),
  );
  assert.ok(out.length > 0);
  for (const c of out) {
    assert.match(c.credit, /^GAMEPLAY: (ALPHA|BETA) \/ CC BY$/);
    assert.match(
      c.provenance,
      /Creative Commons Attribution licence \(CC BY\)/,
    );
    assert.ok(
      c.span.to > c.span.from &&
        c.span.source.startsWith("https://www.youtube.com/watch?v="),
    );
    assert.ok(c.file.startsWith(path.join("entry_2", "assets")));
    assert.equal(c.beatIndex, 2);
  }
  assert.ok(
    out.some((c) => c.moment === 0),
    "a car segment is pinned to the car line",
  );
  assert.ok(
    out.some((c) => c.moment === 1),
    "a beach segment to the beach line",
  );
  assert.equal(report.kept, out.length);
  assert.ok(
    report.keptSeconds > 0 && report.downloads === 2 && report.looked > 0,
  );
  await fs.rm(dir, { recursive: true, force: true });
});

test("a game not out yet, or a chapter already on enough footage, is skipped without a search", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-"));
  const { deps, calls } = fakes(dir, () => look());
  let searched = 0;
  const counted = {
    ...deps,
    search: async (q: string) => (searched++, deps.search(q)),
  };
  const report = emptyReport();
  const out: FootageClip[] = [];
  const vi = {
    entry: 7,
    game: "Grand Theft Auto VI",
    franchise: GTA,
    year: new Date().getFullYear(),
    moments: [{ show: "Lucia" }],
    sentences: ["Lucia."],
  };
  await gatherChapterFootage(
    counted,
    vi,
    [],
    dir,
    "entry_7",
    200,
    FOOTAGE_FIRST_DEFAULTS,
    report,
    out,
    Infinity,
  );
  const full = {
    entry: 1,
    game: "Grand Theft Auto III",
    franchise: GTA,
    year: 2001,
    moments: [{ show: "x" }],
    sentences: ["x"],
  };
  await gatherChapterFootage(
    counted,
    full,
    [{ beatIndex: 1, durationSeconds: 220 }],
    dir,
    "entry_1",
    200,
    FOOTAGE_FIRST_DEFAULTS,
    report,
    out,
    Infinity,
  );
  assert.equal(searched, 0);
  assert.equal(calls.downloads.length, 0);
  assert.deepEqual(
    report.skipped.map((s) => s.entry),
    [7, 1],
  );
  assert.match(footageNotice("Vice City", report), /not out yet/);
  await fs.rm(dir, { recursive: true, force: true });
});

test("a video whose segments are mostly mods loses every segment, even the clean-looking ones", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-"));
  // Every frame of the first video (src_0) is a mod but one; the second video is clean.
  const { deps } = fakes(dir, (_i, f) =>
    /seg_\d+(_b)?\.jpg$/.test(f) && Number(f.match(/seg_(\d+)/)![1]) < 30
      ? look({ mod: Number(f.match(/seg_(\d+)/)![1]) !== 3 })
      : look(),
  );
  const ch = {
    entry: 2,
    game: VC,
    franchise: GTA,
    year: 2002,
    moments: [{ show: "x" }],
    sentences: ["x"],
  };
  const report = emptyReport();
  const out: FootageClip[] = [];
  await gatherChapterFootage(
    deps,
    ch,
    [],
    path.join(dir, "entry_2"),
    "entry_2",
    300,
    FOOTAGE_FIRST_DEFAULTS,
    report,
    out,
    Infinity,
  );
  assert.ok(
    report.segmentsRejected.some(
      (r) => r.why === "its video is mostly mods or facecams",
    ),
  );
  assert.ok(
    out.every((c) => !c.provenance.includes("by Alpha")),
    "nothing from the modded video",
  );
  await fs.rm(dir, { recursive: true, force: true });
});

test("the step appends the new clips with their spans, logs the counts and tells the owner once", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-"));
  const { deps } = fakes(dir, () => look());
  const clips: Array<{
    file: string;
    sourceUrl: string;
    provenance: string;
    durationSeconds: number;
    beatIndex?: number;
    span?: { source: string; from: number; to: number };
  }> = [];
  const events: string[] = [];
  const notes: string[] = [];
  const r = await runFootageFirst({
    deps,
    chapters: [
      {
        entry: 0,
        game: VC,
        franchise: GTA,
        year: 2002,
        moments: [{ show: "x" }],
        sentences: ["word ".repeat(400)],
      },
    ],
    clips,
    dir,
    options: { ...FOOTAGE_FIRST_DEFAULTS, maxMinutes: 0 },
    headline: "Vice City",
    logEvent: async (k) => void events.push(k),
    notify: async (m) => void notes.push(m.content),
  });
  assert.ok(
    r.kept > 0 && clips.length === r.kept && clips.every((c) => c.span),
  );
  assert.deepEqual(events, ["footage_first"]);
  assert.deepEqual(r.perChapter?.map((c) => [c.entry, c.kept]), [[0, r.kept]], "minutes and clips per chapter");
  assert.ok(r.phases && r.phases.download! >= 0 && r.phases.look! >= 0, "seconds per step");
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /Creative Commons gameplay clips/);
  assert.ok(!/—/.test(notes[0]!));
  await fs.rm(dir, { recursive: true, force: true });
});

test("videos and loose segments are taken in turns from each uploader", () => {
  assert.deepEqual(
    roundRobin(["a1", "a2", "a3", "b1", "c1", "c2"], (x) => x[0]),
    ["a1", "b1", "c1", "a2", "c2", "a3"],
  );
});

test("search rows from yt-dlp keep ids, channels and titles with tabs", () => {
  assert.deepEqual(
    parseSearchRows(
      "Bn-0OnxWjSk\tPro100Man\tGTA Vice City\tLand of the Cops\nnot a row\n",
    ),
    [
      {
        videoId: "Bn-0OnxWjSk",
        channel: "Pro100Man",
        title: "GTA Vice City\tLand of the Cops",
      },
    ],
  );
});

function timeline(sentences: string[]) {
  const words: Array<{ text: string; start: number; end: number }> = [];
  let t = 0;
  const say = (text: string) => {
    for (const w of text.split(/\s+/).filter(Boolean)) {
      words.push({ text: w, start: t, end: t + 0.35 });
      t += 0.4;
    }
    t += 0.3;
  };
  say("A short intro to the story.");
  const beatStart = t;
  for (const s of sentences) say(s);
  const takeStart = t;
  say("That was the story.");
  const segments: Segment[] = [
    {
      kind: "hook",
      text: "A short intro to the story.",
      start: 0,
      end: beatStart,
    },
    {
      kind: "beat",
      text: sentences.join(" "),
      start: beatStart,
      end: takeStart,
      visual: {
        kind: "chapter",
        primary: "1",
        secondary: "Vice City",
        items: ["2002"],
      } as never,
    },
    { kind: "take", text: "That was the story.", start: takeStart, end: t },
  ];
  return { words, segments, duration: t + 6 };
}

test("the planner never plays one moment of a source twice in a chapter, nor loops its clips when told not to", () => {
  assert.deepEqual(
    overlappingClips([
      { span: { source: "a", from: 10, to: 15 } },
      { span: { source: "a", from: 14, to: 19 } },
      { span: { source: "a", from: 19, to: 24 } },
      { span: { source: "b", from: 10, to: 15 } },
      {},
    ]),
    [[1], [0], [], [], []],
  );
  const sentences = Array.from(
    { length: 6 },
    (_, i) =>
      `Sentence number ${i} goes on for a good while about the city at night.`,
  );
  const { words, segments, duration } = timeline(sentences);
  // No pictures at all, two clips (the second cut from the same moment as the first): before, the chapter looped them.
  const input = {
    segments,
    words,
    durationSeconds: duration,
    images: [],
    clips: [
      {
        durationSeconds: 5,
        beatIndex: 0,
        span: { source: "a", from: 0, to: 5 },
      },
      {
        durationSeconds: 5,
        beatIndex: 0,
        span: { source: "a", from: 2, to: 7 },
      },
      {
        durationSeconds: 5,
        beatIndex: 0,
        span: { source: "b", from: 0, to: 5 },
      },
    ],
    variant: 0,
    momentCounts: [6],
  };
  const chapterClips = (p: ReturnType<typeof buildLongPlan>) =>
    p.shots
      .filter((s) => s.segment === 1 && s.media.type === "clip")
      .map((s) => s.media.index);
  const loose = buildLongPlan(input);
  assert.ok(
    chapterClips(loose).length > new Set(chapterClips(loose)).size,
    "without the setting the chapter loops its clips",
  );
  const strict = buildLongPlan({ ...input, noRepeats: true });
  const played = chapterClips(strict);
  assert.equal(played.length, new Set(played).size, "no clip twice");
  assert.ok(
    !(played.includes(0) && played.includes(1)),
    "two clips of one moment never both play",
  );
  assert.ok(
    strict.shots.some((s) => s.segment === 1 && s.media.type === "plate"),
    "the rest is the plate, for the thin-entry top-up",
  );
});

test("source windows download a few at a time, never more than DOWNLOADS_AT_ONCE", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-"));
  const { deps } = fakes(dir, () => look());
  let running = 0;
  let most = 0;
  const hits = Array.from({ length: 6 }, (_, i) => ({
    videoId: `vid${i}xxxxxxx`.slice(0, 11),
    title: `GTA Vice City gameplay part ${i + 1}`,
    channel: `Ch${i}`,
  }));
  const slow: FootageFirstDeps = {
    ...deps,
    search: async () => hits,
    details: async () => ({
      license: "Creative Commons Attribution license (reuse allowed)",
      seconds: 1800,
      channel: "",
      title: "",
    }),
    download: async (url, from, to, dest) => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      return deps.download(url, from, to, dest);
    },
  };
  const ch = {
    entry: 2,
    game: VC,
    franchise: GTA,
    year: 2002,
    moments: [{ show: "x" }],
    sentences: ["x"],
  };
  const report = emptyReport();
  await gatherChapterFootage(
    slow,
    ch,
    [],
    path.join(dir, "entry_2"),
    "entry_2",
    300,
    FOOTAGE_FIRST_DEFAULTS,
    report,
    [],
    Infinity,
  );
  assert.equal(report.downloads, 6);
  assert.equal(most, DOWNLOADS_AT_ONCE);
  await fs.rm(dir, { recursive: true, force: true });
});

test("segments are looked at in rounds: more when most are refused, no more than needed when they pass", async () => {
  const run = async (refuse: (i: number) => boolean) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-"));
    let n = 0;
    const { deps } = fakes(dir, () =>
      refuse(n++) ? look({ text: true }) : look(),
    );
    const long: FootageFirstDeps = {
      ...deps,
      scan: async () =>
        Array.from({ length: 3001 }, (_, i) => ({
          time: i / 10,
          luma: 90,
          motion: 3,
          scene: 0.01,
        })),
    };
    const ch = {
      entry: 2,
      game: VC,
      franchise: GTA,
      year: 2002,
      moments: [{ show: "x" }],
      sentences: ["x"],
    };
    const report = emptyReport();
    await gatherChapterFootage(
      long,
      ch,
      [],
      path.join(dir, "entry_2"),
      "entry_2",
      100,
      FOOTAGE_FIRST_DEFAULTS,
      report,
      [],
      Infinity,
    );
    await fs.rm(dir, { recursive: true, force: true });
    return report;
  };
  const clean = await run(() => false);
  const hard = await run((i) => i % 5 !== 0);
  assert.ok(
    clean.segments > clean.looked / 2,
    "a clean chapter stops looking once it has enough",
  );
  assert.ok(
    hard.looked > clean.looked,
    "a chapter whose frames are mostly refused looks at more",
  );
  assert.ok(hard.looked <= 2 * FOOTAGE_FIRST_DEFAULTS.visionMax);
});

test("cheap tests settle a segment before the model: a frozen picture, the same picture again, words the OCR reads", async () => {
  // A difference hash and its distance.
  const ramp = Array.from({ length: 72 }, (_, i) => (i % 9) * 10);
  assert.equal(dHash(ramp), "0".repeat(64));
  assert.equal(dHash(ramp.map((v) => 255 - v)), "1".repeat(64));
  assert.equal(hamming("0101", "0110"), 2);
  assert.equal(hamming(undefined, "0"), 64);
  // OCR words: a subtitle counts, HUD digits and corner scraps do not.
  const page = (words: Array<[string, number, number]>) => ({ width: 640, height: 360, words: words.map(([text, x, y]) => ({ text, x, y, w: 40, h: 12 })) });
  assert.equal(captionWords(page([["Sniper", 280, 300], ["roof!", 330, 300]])), 2);
  assert.equal(captionWords(page([["sunne7274", 540, 30], ["Ian", 560, 40], ["0-30", 300, 70]])), 0);
  assert.equal(captionWords(page([["Ocean", 30, 300], ["Beach", 60, 300]])), 0, "the minimap corner");
  assert.equal(captionWords(undefined), 0);
  // The flow: segment 0 frozen, 1 the same picture as 2, 3 has a subtitle; one composite look per remaining segment.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-"));
  const { deps } = fakes(dir, () => look());
  const looked: string[] = [];
  const rows = Array.from({ length: 601 }, (_, i) => ({ time: i / 10, luma: 90, motion: i < 70 ? 0 : 3, scene: 0.01 }));
  const counted: FootageFirstDeps = {
    ...deps,
    search: async () => [{ videoId: "aaaaaaaaaaa", title: "GTA Vice City gameplay", channel: "Alpha" }],
    scan: async () => rows,
    hash: async (f) => (/seg_(1|2)_/.test(f) ? "0".repeat(64) : deps.hash(f)),
    ocr: async (files) => new Map(files.filter((f) => /seg_3_/.test(f)).map((f) => [f, page([["Sniper", 280, 300], ["roof!", 330, 300]])])),
    look: async (files) => {
      looked.push(...files);
      return deps.look(files);
    },
  };
  const report = emptyReport();
  const ch = { entry: 2, game: VC, franchise: GTA, year: 2002, moments: [{ show: "x" }], sentences: ["x"] };
  await gatherChapterFootage(counted, ch, [], path.join(dir, "entry_2"), "entry_2", 300, FOOTAGE_FIRST_DEFAULTS, report, [], Infinity);
  const why = (n: number) => report.segmentsRejected.find((r) => r.at === Math.round(pullWindow(1800, 0, FOOTAGE_FIRST_DEFAULTS.pullSeconds).from + n * 7))?.why;
  assert.equal(why(0), "frozen picture");
  assert.equal(why(2), "same picture as another segment");
  assert.equal(why(3), "text on screen (read)");
  assert.ok(!looked.some((f) => /seg_(0|2|3)\.jpg$/.test(f)), "none of them reached the model");
  assert.ok(looked.every((f) => /seg_\d+\.jpg$/.test(f)), "one composite image a segment");
  assert.equal(report.looked, looked.length);
  await fs.rm(dir, { recursive: true, force: true });
});

test("a video whose segments keep failing gets no more looks", () => {
  const v = (source: number, ok: boolean, n: number) => Array.from({ length: n }, () => ({ source, ok }));
  assert.deepEqual([...poorSources([...v(0, false, 6), ...v(1, false, 5), ...v(2, true, 2), ...v(2, false, 4)])], [0]);
});

test("the next chapter downloads while this one is looked at", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-"));
  const { deps } = fakes(dir, () => look());
  const events: string[] = [];
  const traced: FootageFirstDeps = {
    ...deps,
    download: async (url, a, b, dest) => {
      events.push(`download ${dest.includes("entry_3") ? 3 : 2}`);
      return deps.download(url, a, b, dest);
    },
    look: async (files) => {
      events.push(`look ${files[0]?.includes("entry_3") ? 3 : 2}`);
      await new Promise((r) => setTimeout(r, 30));
      return deps.look(files);
    },
  };
  const ch = (entry: number) => ({ entry, game: VC, franchise: GTA, year: 2002, moments: [{ show: "x" }], sentences: ["x"], seconds: 300 });
  const { report } = await gatherFootageFirst(traced, [ch(2), ch(3)], [], dir, FOOTAGE_FIRST_DEFAULTS);
  const firstLook2 = events.indexOf("look 2");
  const lastDownload3 = events.lastIndexOf("download 3");
  assert.ok(firstLook2 >= 0 && events.indexOf("download 3") < events.lastIndexOf("look 2"), "chapter 3's downloads start before chapter 2's looks end");
  assert.ok(lastDownload3 > 0);
  assert.equal(report.perChapter?.length, 2);
  assert.equal(typeof prefetchChapter, "function");
  await fs.rm(dir, { recursive: true, force: true });
});

test("letterboxing is measured from a thumbnail, not asked of the model", async () => {
  const frame = (top: number, mid: number) => Array.from({ length: 72 }, (_, i) => (Math.floor(i / 9) === 0 || Math.floor(i / 9) === 7 ? top : mid));
  assert.equal(letterboxed(frame(2, 90)), true);
  assert.equal(letterboxed(frame(60, 90)), false);
  assert.equal(letterboxed(frame(2, 5)), false, "a black frame is dark, not letterboxed");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-"));
  const { deps } = fakes(dir, () => look());
  const looked: string[] = [];
  const barred: FootageFirstDeps = {
    ...deps,
    bars: async () => true,
    look: async (files) => (looked.push(...files), deps.look(files)),
  };
  const report = emptyReport();
  const ch = { entry: 2, game: VC, franchise: GTA, year: 2002, moments: [{ show: "x" }], sentences: ["x"] };
  await gatherChapterFootage(barred, ch, [], path.join(dir, "entry_2"), "entry_2", 300, FOOTAGE_FIRST_DEFAULTS, report, [], Infinity);
  assert.equal(looked.length, 0);
  assert.ok(report.segmentsRejected.every((r) => r.why === "letterboxed" || r.why === "frozen picture"));
  await fs.rm(dir, { recursive: true, force: true });
});

test("every released chapter gets an even share of the time left, so the limit never leaves chapters untouched", async () => {
  assert.equal(fairDeadline(0, 600_000, 3), 200_000);
  assert.equal(fairDeadline(500_000, 600_000, 1), 600_000);
  assert.equal(fairDeadline(700_000, 600_000, 2), 700_000, "past the limit: no time");
  assert.equal(fairDeadline(0, Infinity, 4), Infinity);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-"));
  const { deps } = fakes(dir, () => look());
  let clock = 0;
  const slow: FootageFirstDeps = {
    ...deps,
    now: () => clock,
    // Each look costs five seconds on the fake clock.
    look: async (files) => ((clock += files.length * 5000), deps.look(files)),
  };
  const ch = (entry: number) => ({ entry, game: VC, franchise: GTA, year: 2002, moments: [{ show: "x" }], sentences: ["x"], seconds: 2000 });
  const { report } = await gatherFootageFirst(slow, [ch(1), ch(2), ch(3)], [], dir, { ...FOOTAGE_FIRST_DEFAULTS, maxMinutes: 4 });
  assert.deepEqual(report.perChapter?.map((c) => c.entry), [1, 2, 3], "all three chapters gathered");
  assert.ok(report.perChapter!.every((c) => c.kept > 0));
  assert.ok(clock <= 4 * 60_000 + 4 * 5000 * 3, "within the limit, give or take a short round");
  await fs.rm(dir, { recursive: true, force: true });
});

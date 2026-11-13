// Moving footage in long videos (owner, 12 Nov 2026: "nearly all moving footage from start to finish"): the in-world
// text screen, the corner-mark crop, remaster footage in a retrospective's reception and legacy chapters, B-roll for
// chapters about the game, the planner's footage-first fallback with stills as accents, the moving-share measure and
// the night-only shot describing gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { overlayWords, uploaderWords } from "../src/assets/cliptext.ts";
import {
  cleanFrameReason,
  cropFilter,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  overlayCornerCrop,
} from "../src/assets/cutscenes.ts";
import { editionOf, junkTitleReason } from "../src/assets/junk.ts";
import { junkSourceReason } from "../src/assets/footagefirst.ts";
import { retroRemasterChapters } from "../src/retrostep.ts";
import { brollShotAtPlace, shotAtPlace } from "../src/sceneindex/lookup.ts";
import { emptySceneIndex, type SceneIndex } from "../src/sceneindex/schema.ts";
import { buildLongPlan } from "../src/render/longplan.ts";
import type { Segment } from "../src/render/timeline.ts";
import {
  movingShare,
  movingShareLines,
  speechSpans,
} from "../src/qa/movingshare.ts";
import {
  blockingLease,
  describeGate,
  inDescribeHours,
} from "../src/sceneindex/describegate.ts";
import { describeShots } from "../src/sceneindex/build.ts";

// ---------------------------------------------------------------- in-world text

const page = (words: Array<[string, number, number, number?]>) => ({
  width: 960,
  height: 540,
  words: words.map(([text, x, y, h]) => ({
    text,
    x,
    y,
    w: text.length * 20,
    h: h ?? 40,
  })),
});

test("in-world text: a shop sign, the HUD and the game's own subtitles pass; uploader marks, links and fixed edge captions fail", () => {
  // THE WELL STACKED PIZZA CO. in the middle of the frame, moving with the camera: in-world, never a fault.
  const sign = [0, 1, 2, 3, 4].map((i) =>
    page([
      ["THE", 300 + i * 25, 200],
      ["WELL", 380 + i * 25, 200],
      ["STACKED", 470 + i * 25, 200],
      ["PIZZA", 300 + i * 25, 250],
      ["CO.", 420 + i * 25, 250],
    ]),
  );
  assert.deepEqual(overlayWords(sign).faulted, [
    false,
    false,
    false,
    false,
    false,
  ]);
  // The HUD's money and clock sit fixed at the edge in every sample: digits, so the game's own.
  const hud = [0, 1, 2, 3].map(() =>
    page([
      ["$00000350", 800, 30],
      ["12:00", 840, 80],
    ]),
  );
  assert.ok(!overlayWords(hud).faulted.some(Boolean), "the HUD passes");
  // The game's subtitle line at the bottom changes from sample to sample: passes.
  const subs = ["Grove Street", "home", "at least", "it was"].map((t, i) =>
    page([[t.split(" ")[0]!, 380 + i * 7, 470]]),
  );
  assert.ok(
    !overlayWords(subs).faulted.some(Boolean),
    "the game's subtitles pass",
  );
  // An uploader's words, a link, a handle and the channel's own name fail wherever they sit.
  assert.deepEqual(overlayWords([page([["SUBSCRIBE", 400, 250]])]).faulted, [
    true,
  ]);
  assert.deepEqual(
    overlayWords([page([["www.example.com", 400, 250]])]).faulted,
    [true],
  );
  assert.deepEqual(overlayWords([page([["@gtaclips", 400, 250]])]).faulted, [
    true,
  ]);
  assert.deepEqual(
    overlayWords([page([["ThirstyHyena", 400, 250]])], {
      uploader: "ThirstyHyena",
    }).faulted,
    [true],
  );
  assert.ok(
    uploaderWords("ThirstyHyena").includes("thirsty") &&
      uploaderWords("ThirstyHyena").includes("thirstyhyena"),
  );
  // A caption fixed at the frame's edge in nearly every sample is the uploader's: it fails.
  const tag = [0, 1, 2, 3, 4].map((i) =>
    page([
      ["HYENAPLAYS", 20, 20],
      ["DOWNTOWN", 300 + i * 30, 250],
    ]),
  );
  const read = overlayWords(tag);
  assert.ok(
    read.faulted.every(Boolean),
    "a fixed edge caption fails every sample",
  );
  assert.ok(read.words.includes("hyenaplays"));
});

// ---------------------------------------------------------------- corner mark crop

/** Five frames of a moving picture (a drifting gradient with noise) with an optional fixed textured mark. */
function frames(mark?: {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}): Uint8Array[] {
  const W = FRAME_WIDTH,
    H = FRAME_HEIGHT;
  return Array.from({ length: 5 }, (_, k) => {
    const f = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const moving = ((x * 7 + y * 3 + k * 37) * 2654435761) % 251;
        const inMark =
          mark && x >= mark.x0 && x < mark.x1 && y >= mark.y0 && y < mark.y1;
        f[y * W + x] = inMark ? ((x + y) % 2 ? 230 : 30) : moving;
      }
    return f;
  });
}

test("a small corner mark is cropped away when the crop keeps most of the picture; a big one or two marks are not", () => {
  const W = FRAME_WIDTH,
    H = FRAME_HEIGHT;
  // A channel mark filling the corner's first tile (a tenth of the width and height).
  const small = frames({
    x0: 0,
    y0: 0,
    x1: Math.floor(W * 0.1),
    y1: Math.floor(H * 0.1),
  });
  assert.equal(
    cleanFrameReason(small),
    "persistent corner overlay",
    "the screen refuses it as before",
  );
  const crop = overlayCornerCrop(small, 0.78);
  assert.ok(crop, "a mark in a tenth of the frame is cropped");
  assert.equal(crop!.corner, "top-left");
  assert.ok(
    crop!.x > 0 && crop!.y > 0 && crop!.keeps >= 0.78 && crop!.keeps < 0.85,
  );
  assert.match(
    cropFilter(crop!),
    /^crop=trunc\(iw\*0\.\d{4}\/2\)\*2:trunc\(ih\*0\.\d{4}\/2\)\*2:trunc\(iw\*0\.\d{4}\):trunc\(ih\*0\.\d{4}\)$/,
  );
  // Bottom-right: the crop starts at the top left.
  const br = overlayCornerCrop(
    frames({
      x0: W - Math.floor(W * 0.1),
      y0: H - Math.floor(H * 0.1),
      x1: W,
      y1: H,
    }),
    0.78,
  );
  assert.equal(br?.corner, "bottom-right");
  assert.equal(br?.x, 0);
  assert.equal(br?.y, 0);
  // A mark filling the whole corner would cost too much picture.
  assert.equal(
    overlayCornerCrop(
      frames({
        x0: 0,
        y0: 0,
        x1: Math.floor(W * 0.2),
        y1: Math.floor(H * 0.2),
      }),
      0.78,
    ),
    undefined,
  );
  // A clean moving picture has nothing to crop.
  assert.equal(overlayCornerCrop(frames(), 0.78), undefined);
});

// ---------------------------------------------------------------- remasters

test("remaster footage: allowed only where asked, credited as its edition, a fan build still refused", () => {
  const game = "Grand Theft Auto: San Andreas";
  assert.equal(
    junkTitleReason("GTA San Andreas Definitive Edition gameplay", "Ch", game),
    "remaster, remake or fan build",
  );
  assert.equal(
    junkTitleReason("GTA San Andreas Definitive Edition gameplay", "Ch", game, {
      remasterOk: true,
    }),
    undefined,
  );
  assert.equal(
    junkTitleReason("GTA San Andreas DE gameplay part 1", "Ch", game, {
      remasterOk: true,
    }),
    undefined,
  );
  assert.equal(
    junkTitleReason("GTA San Andreas remastered RTX ray tracing", "Ch", game, {
      remasterOk: true,
    }),
    "remaster, remake or fan build",
  );
  assert.equal(
    junkTitleReason(
      "GTA San Andreas Definitive Edition mod showcase",
      "Ch",
      game,
      { remasterOk: true },
    ),
    "mod",
  );
  assert.equal(
    junkSourceReason(
      "GTA San Andreas Definitive Edition gameplay walkthrough part 3",
      "Ch",
      game,
      "Grand Theft Auto",
      2004,
      { remasterOk: true },
    ),
    undefined,
  );
  assert.equal(
    editionOf("Grand Theft Auto: San Andreas – The Definitive Edition"),
    "DEFINITIVE EDITION",
  );
  assert.equal(editionOf("GTA SA DE gameplay"), "DEFINITIVE EDITION");
  assert.equal(editionOf("Resident Evil 2 Remake gameplay"), "REMAKE");
  assert.equal(editionOf("GTA San Andreas gameplay"), undefined);
  const retro = {
    chapters: [
      { section: "history" },
      { section: "story", act: 1 },
      { section: "reception" },
      { section: "legacy" },
    ],
  } as never;
  assert.deepEqual(retroRemasterChapters(retro, [0, 1, 2, 3]), [
    false,
    false,
    true,
    true,
  ]);
  assert.deepEqual(retroRemasterChapters(retro, [3, 1]), [true, false]);
});

// ---------------------------------------------------------------- B-roll

function index(): SceneIndex {
  const ix = emptySceneIndex(
    "Grand Theft Auto: San Andreas",
    {
      videoId: "DtArUwDHHeY",
      title: "Full Game Movie",
      uploader: "u",
      duration: 600,
      kind: "movie",
      pickedAt: "2026-11-12T00:00:00Z",
    },
    new Date("2026-11-12T00:00:00Z"),
  );
  for (let t = 0, id = 0; t < 600; t += 6, id++)
    ix.shots.push({
      id,
      start: t,
      end: t + 6,
      keyframes: [t + 3],
      desc: "",
      who: [],
      where: "",
      mood: "",
      tags: [],
      text: "",
      luma: 90,
      motion: id === 52 ? 35 : 4,
    });
  // Two people talk over shot 50 (the one at the line's place); shot 52 nearby is a lively drive.
  ix.lines.push({
    start: 300,
    end: 305.5,
    text: "We go way back",
    speaker: "Sweet",
  } as never);
  return ix;
}

test("a chapter about the game takes the liveliest quiet shot near its place, not the cutscene's talk", () => {
  const ix = index();
  const within = { from: 0, to: 600, at: 0.508 };
  assert.equal(
    shotAtPlace(ix, within, 2),
    50,
    "the story pick is the shot at the place",
  );
  assert.equal(
    brollShotAtPlace(ix, within, 2),
    52,
    "the B-roll pick is the drive two shots on",
  );
});

// ---------------------------------------------------------------- planner

function timeline(n: number) {
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
  const sentences = Array.from(
    { length: n },
    (_, i) =>
      `Sentence ${i} goes on for a good while about the city at night and the people in it.`,
  );
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
        secondary: "San Andreas",
        items: ["2004"],
      } as never,
    },
    { kind: "take", text: "That was the story.", start: takeStart, end: t },
  ];
  return { words, segments, duration: t + 6 };
}

test("LONG_MOVING_FIRST: unplayed footage comes before stills, and a still with footage to come is a brief accent", () => {
  const { words, segments, duration } = timeline(8);
  // Eight sentences, each with a pinned still; footage: loose clips plus one per even sentence.
  const images = Array.from({ length: 8 }, (_, m) => ({
    kind: "screenshot",
    aspect: 16 / 9,
    beatIndex: 0,
    moment: m,
    file: `s${m}.jpg`,
  }));
  const clips = [
    ...Array.from({ length: 4 }, (_, k) => ({
      durationSeconds: 5,
      beatIndex: 0,
      moment: k * 2,
      span: { source: "m", from: k * 100, to: k * 100 + 5 },
    })),
    ...Array.from({ length: 6 }, (_, k) => ({
      durationSeconds: 5,
      beatIndex: 0,
      span: { source: "m", from: 1000 + k * 100, to: 1005 + k * 100 },
    })),
  ];
  const input = {
    segments,
    words,
    durationSeconds: duration,
    images,
    clips,
    variant: 0,
    momentCounts: [8],
    noRepeats: true,
  };
  const fps = 30;
  const chapter = (p: ReturnType<typeof buildLongPlan>, type: string) =>
    p.shots
      .filter((s) => s.segment === 1 && s.media.type === type)
      .reduce((n, s) => n + (s.end - s.start) / fps, 0);
  const before = buildLongPlan(input);
  const after = buildLongPlan({
    ...input,
    movingFirst: true,
    accentStillFrames: 75,
  });
  assert.ok(
    chapter(after, "clip") > chapter(before, "clip"),
    `more footage: ${chapter(after, "clip")} > ${chapter(before, "clip")}`,
  );
  assert.ok(
    chapter(after, "image") < chapter(before, "image"),
    "fewer seconds on stills",
  );
  // While footage is left, no still holds longer than the accent (a still may run longer once footage is spent).
  const shots = after.shots.filter((s) => s.segment === 1);
  const lastClipEnd = Math.max(
    ...shots.filter((s) => s.media.type === "clip").map((s) => s.end),
  );
  for (const s of shots.filter(
    (x) => x.media.type === "image" && x.end < lastClipEnd,
  ))
    assert.ok(
      s.end - s.start <= 75 + 1,
      `a still of ${(s.end - s.start) / fps}s while footage was left`,
    );
  // Every clip still plays at most once in the chapter (the closing recap may replay the chapter's footage).
  const played = after.shots
    .filter((s) => s.segment === 1 && s.media.type === "clip")
    .map((s) => s.media.index);
  assert.equal(played.length, new Set(played).size);
});

// ---------------------------------------------------------------- the measure

test("the moving share counts narration over game footage, stock apart, and the stills share of the runtime", () => {
  assert.deepEqual(
    speechSpans([
      { start: 0, end: 1 },
      { start: 1.2, end: 2 },
      { start: 3, end: 4 },
    ]),
    [
      [0, 2],
      [3, 4],
    ],
  );
  const m = movingShare({
    fps: 10,
    words: [{ start: 0, end: 10 }],
    clips: [{}, { stock: true }],
    shots: [
      { start: 0, end: 40, media: { type: "clip", index: 0 } },
      { start: 40, end: 60, media: { type: "clip", index: 1 } },
      { start: 60, end: 80, media: { type: "image", index: 0 } },
      { start: 80, end: 100, media: { type: "filler", index: 0 } },
    ],
  });
  assert.equal(m.narration, 10);
  assert.equal(m.moving, 4);
  assert.equal(m.stock, 2);
  assert.equal(m.movingShare, 0.4);
  assert.equal(m.stillShare, 0.2);
  assert.equal(m.graphicsShare, 0.2);
  assert.deepEqual(movingShareLines([]), []);
  const line = movingShareLines([
    { title: "The Full Story of GTA San Andreas", moving: 0.255, stills: 0.68 },
    { title: "Best GTA Missions", moving: 0.9, stills: 0.05 },
  ])[0]!;
  assert.match(line, /2 renders this week/);
  assert.match(line, /Lowest: "The Full Story of GTA San Andreas" 26%/);
});

// ---------------------------------------------------------------- night describing

test("describing runs only in its quiet hours and while the PC shows no Orryy render or other heavy turn", async () => {
  const at = (h: number) => new Date(Date.UTC(2026, 10, 13, h, 30));
  assert.equal(inDescribeHours("", at(14)), true, "unset: any time");
  assert.equal(inDescribeHours("01-07", at(3)), true);
  assert.equal(inDescribeHours("01-07", at(7)), false);
  assert.equal(inDescribeHours("22-06", at(23)), true, "wraps past midnight");
  assert.equal(inDescribeHours("22-06", at(12)), false);
  assert.equal(
    inDescribeHours("rubbish", at(3)),
    false,
    "a window that does not parse never opens",
  );
  assert.equal(
    blockingLease([{ project: "pulse", class: "heavy", kind: "pulse:render" }]),
    undefined,
    "Pulse's own turn",
  );
  assert.equal(
    blockingLease([{ project: "orryy", class: "heavy", kind: "orryy:render" }])
      ?.kind,
    "orryy:render",
  );
  assert.equal(
    blockingLease([{ project: "sleepy", class: "gpu" }])?.project,
    "sleepy",
  );
  const env = { DESCRIBE_HOURS: "01-07", TIMEZONE: "UTC" };
  assert.equal(
    (await describeGate(env, { now: () => at(12), readLeases: async () => [] }))
      .ok,
    false,
    "outside the window",
  );
  assert.equal(
    (await describeGate(env, { now: () => at(3), readLeases: async () => [] }))
      .ok,
    true,
  );
  const busy = await describeGate(env, {
    now: () => at(3),
    readLeases: async () => [
      {
        project: "orryy",
        class: "heavy",
        kind: "orryy:render",
        job: "Render X",
      },
    ],
  });
  assert.equal(busy.ok, false);
  assert.match(busy.why!, /Render X/);
  // The Mac: no lease file, so the PC's relay answers for it (it refuses while an Orryy render runs).
  assert.equal(
    (
      await describeGate(env, {
        now: () => at(3),
        readLeases: async () => undefined,
        relayUp: async () => false,
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await describeGate(env, {
        now: () => at(3),
        readLeases: async () => undefined,
        relayUp: async () => true,
      })
    ).ok,
    true,
  );
  // A closed gate leaves every shot undescribed and asks the model nothing.
  let looked = 0;
  const r = await describeShots(
    index(),
    { dataDir: "/nonexistent" } as never,
    10,
    {
      describeGate: async () => ({ ok: false, why: "test" }),
      look: async () => {
        looked++;
        return undefined;
      },
    },
  );
  assert.equal(r.described, 0);
  assert.equal(looked, 0);
});

// ---------------------------------------------------------------- per-chapter allowance for any long video

test("LONG_CHAPTER_FOOTAGE: each chapter of a long video gets its own publisher allowance, scaled to its length", async () => {
  const { longChapterFootageCaps } = await import("../src/retrostep.ts");
  const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
  const script = {
    beats: [
      { narration: words(300), visual: { kind: "chapter" } },
      { narration: words(200) },
      { narration: words(150), visual: { kind: "chapter" } },
    ],
    entries: [
      { rank: 2, game_title: "Grand Theft Auto: San Andreas" },
      { rank: 1, game_title: "The Legend of Zelda: Ocarina of Time" },
    ],
  } as never;
  const caps = longChapterFootageCaps({ retroFootageScale: 1, retroChapterFootageMax: 150 }, script);
  assert.equal(caps.length, 2);
  // Rockstar's per-Short cap (10 s unless PUBLISHER_FOOTAGE_SECONDS says more) scaled to 500 words of chapter.
  assert.ok(caps[0]! > 10, `the GTA chapter carries more than one Short's allowance: ${caps[0]}`);
  // Nintendo is stills only: no footage allowance at all.
  assert.equal(caps[1], 0);
});

test("LONG_CLIP_REMAINDERS: a clip cut short keeps its unseen rest, which plays later from where it stopped", () => {
  const { words, segments, duration } = timeline(8);
  // Few, long clips: each first shot uses part of one, the rest is left over.
  const clips = Array.from({ length: 3 }, (_, k) => ({
    durationSeconds: 14,
    beatIndex: 0,
    span: { source: "m", from: k * 100, to: k * 100 + 14 },
  }));
  const images = Array.from({ length: 8 }, (_, m) => ({
    kind: "screenshot",
    aspect: 16 / 9,
    beatIndex: 0,
    moment: m,
    file: `s${m}.jpg`,
  }));
  const input = {
    segments,
    words,
    durationSeconds: duration,
    images,
    clips,
    variant: 0,
    momentCounts: [8],
    noRepeats: true,
    movingFirst: true,
    accentStillFrames: 75,
    rhythm: true,
  };
  const fps = 30;
  const seconds = (p: ReturnType<typeof buildLongPlan>) =>
    p.shots.filter((s) => s.segment === 1 && s.media.type === "clip").reduce((n, s) => n + (s.end - s.start) / fps, 0);
  const off = buildLongPlan(input);
  const on = buildLongPlan({ ...input, clipRemainders: true });
  assert.ok(seconds(on) >= seconds(off), `no less footage: ${seconds(on)} >= ${seconds(off)}`);
  // Every frame of a clip plays at most once in the chapter: its shots never overlap inside it.
  const byClip = new Map<number, Array<[number, number]>>();
  for (const s of on.shots.filter((x) => x.segment === 1 && x.media.type === "clip")) {
    const from = s.media.from ?? 0;
    byClip.set(s.media.index, [...(byClip.get(s.media.index) ?? []), [from, from + s.end - s.start]]);
    assert.ok(from + (s.end - s.start) <= 14 * fps, "never past the clip's last frame");
  }
  for (const spans of byClip.values()) {
    const sorted = [...spans].sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i]![0] >= sorted[i - 1]![1], "no frame twice");
  }
  // A remainder never follows its own first part straight away.
  const shots = on.shots;
  for (let i = 1; i < shots.length; i++)
    if (shots[i]!.media.type === "clip" && shots[i]!.media.from)
      assert.ok(!(shots[i - 1]!.media.type === "clip" && shots[i - 1]!.media.index === shots[i]!.media.index));
  assert.ok(on.shots.some((s) => s.media.type === "clip" && (s.media.from ?? 0) > 0), "a remainder plays");
  // Off: no shot starts partway into its clip.
  assert.ok(off.shots.every((s) => s.media.from === undefined));
});

test("a one-game film's opening and closing play its chapters' footage before a still (oneGame, LONG_MOVING_FIRST)", () => {
  const { words, segments, duration } = timeline(2);
  const clips = Array.from({ length: 12 }, (_, k) => ({
    durationSeconds: 5,
    beatIndex: 0,
    span: { source: "m", from: k * 100, to: k * 100 + 5 },
  }));
  const images = [
    { kind: "hero", aspect: 16 / 9, file: "topic.jpg" },
    { kind: "screenshot", aspect: 16 / 9, beatIndex: 0, file: "c.jpg" },
  ];
  const input = { segments, words, durationSeconds: duration, images, clips, variant: 0, movingFirst: true, accentStillFrames: 75 };
  const edges = (p: ReturnType<typeof buildLongPlan>) =>
    p.shots
      .filter((s) => segments[s.segment]!.kind !== "beat" && s.media.type === "clip")
      .reduce((n, s) => n + (s.end - s.start), 0);
  const off = buildLongPlan(input);
  const on = buildLongPlan({ ...input, oneGame: true });
  assert.ok(edges(on) > edges(off), `more footage in the opening and closing: ${edges(on)} > ${edges(off)}`);
  // Off by default: the opening keeps to its own media.
  assert.equal(edges(buildLongPlan({ ...input, movingFirst: false, oneGame: true })), edges(buildLongPlan({ ...input, movingFirst: false })));
});

// The finished-video critic (CRITIC, src/criticstep.ts, src/qa/criticcore.ts): its pure rules, the measurements'
// arithmetic, the model choice, a whole run on fakes and the pipeline step's three outcomes on a real database.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  criticMode,
  DEFAULT_CRITIC,
  findingsOf,
  foreignWatermark,
  frameJudgement,
  gameMentioned,
  isBigModel,
  lineAt,
  matchScores,
  ocrShare,
  openingTimes,
  reportMarkdown,
  sampleTimes,
  scoresOf,
  sentencesOf,
  verdictOf,
  wrongGame,
  type CriticTimeline,
  type FrameJudgement,
  type JudgedSample,
  type Measurements,
} from "../src/qa/criticcore.ts";
import {
  analyseFrames,
  frameStat,
  parseSilence,
  type FrameStat,
} from "../src/qa/criticmeasure.ts";
import { chooseCriticModel, framePrompt } from "../src/qa/criticvision.ts";
import { applyCriticHolds } from "../src/qa/critictimeline.ts";
import {
  applyFixPlan,
  blockedNotice,
  criticStep,
  dropCriticFaulted,
  faultedFiles,
  runCritic,
  type CriticDeps,
} from "../src/criticstep.ts";
import { createEpisode, getEpisode, transition } from "../src/episodes.ts";
import { item, testConfig, testDb, tmpDir } from "./helpers.ts";
import { clusterItems } from "../src/discovery/cluster.ts";

const words = (text: string, from = 0, step = 0.4) =>
  text
    .split(" ")
    .map((w, i) => ({
      text: w,
      start: from + i * step,
      end: from + i * step + 0.3,
    }));

function timeline(over: Partial<CriticTimeline> = {}): CriticTimeline {
  return {
    kind: "short",
    duration: 12,
    fps: 30,
    headline: "GTA 6 preloads open",
    game: "Grand Theft Auto VI",
    chapters: [],
    mentions: "Grand Theft Auto VI preloads open on PS5. Like GTA V before it.",
    shots: [
      {
        index: 0,
        start: 0,
        end: 4,
        media: { type: "clip", index: 0 },
        label: "Jason on a bike",
        file: "assets/clip_0.mp4",
      },
      {
        index: 1,
        start: 4,
        end: 8,
        media: { type: "image", index: 0 },
        label: "key art",
        file: "assets/art.jpg",
      },
      {
        index: 2,
        start: 8,
        end: 11,
        media: { type: "plate", index: 0 },
        label: "plate",
      },
    ],
    lines: [
      { start: 0, end: 3.8, text: "GTA 6 preloads are open." },
      { start: 4, end: 7.8, text: "Jason and Lucia arrive in Vice City." },
      { start: 8, end: 10.8, text: "It needs 212 gigabytes." },
    ],
    graphics: [
      {
        key: "card1",
        kind: "card",
        from: 4.2,
        to: 5.0,
        text: "212 GB on PS5 and Xbox Series",
        words: 6,
      },
    ],
    breaks: [],
    freezes: [],
    tailFrom: 11,
    ...over,
  };
}

const judgement = (over: Partial<FrameJudgement> = {}): FrameJudgement => ({
  seen: "a man on a motorbike",
  match: 3,
  game: "named",
  otherGame: "",
  fanMod: false,
  watermark: false,
  watermarkText: "",
  ...over,
});

const noMeasure = (): Measurements => ({
  black: [],
  white: [],
  frozen: [],
  silence: [],
  cuts: [],
});

test("CRITIC reads off, report and fix; anything else is off", () => {
  assert.equal(criticMode(undefined), "off");
  assert.equal(criticMode("report"), "report");
  assert.equal(criticMode("LOG"), "report");
  assert.equal(criticMode("fix"), "fix");
  assert.equal(criticMode("on"), "fix");
  assert.equal(criticMode("maybe"), "off");
  assert.equal(DEFAULT_CRITIC.mode, "off");
});

test("big models are matched by tag, a bare name meaning :latest", () => {
  assert.equal(isBigModel("qwen3-vl:30b", DEFAULT_CRITIC.bigModels), true);
  assert.equal(isBigModel("Gemma4:31B", DEFAULT_CRITIC.bigModels), true);
  assert.equal(isBigModel("qwen3-vl:8b", DEFAULT_CRITIC.bigModels), false);
  assert.equal(isBigModel("qwen3-vl", ["qwen3-vl:latest"]), true);
});

test("sentences end on . ! ? (quotes allowed after) or on a long pause", () => {
  const w = [
    ...words("Is it out? Yes.", 0),
    ...words("Then a pause", 3),
    ...words('He said "go."', 6),
  ];
  const s = sentencesOf(w);
  assert.deepEqual(
    s.map((x) => x.text),
    ["Is it out?", "Yes.", "Then a pause", 'He said "go."'],
  );
  assert.equal(s[0]!.start, 0);
});

test("the line in force: the one spoken, else the one just finished, else the next close by", () => {
  const lines = [
    { start: 0, end: 2, text: "one" },
    { start: 5, end: 7, text: "two" },
  ];
  assert.equal(lineAt(lines, 1)?.text, "one");
  assert.equal(lineAt(lines, 3)?.text, "one");
  assert.equal(lineAt(lines, 4.6)?.text, "two");
  assert.equal(lineAt(lines, 4)?.text, undefined);
  assert.equal(lineAt(lines, 30)?.text, "two");
});

test("samples: one after every cut, a tick every two seconds clear of them, none in the end card", () => {
  const tl = timeline();
  const s = sampleTimes(tl, 2, 100);
  const cuts = s.filter((x) => x.kind === "cut");
  assert.deepEqual(
    cuts.map((c) => c.t),
    [0.25, 4.25, 8.25],
  );
  assert.ok(s.every((x) => x.t < 11));
  assert.ok(
    s
      .filter((x) => x.kind === "tick")
      .every((t) => cuts.every((c) => Math.abs(c.t - t.t) >= 0.5)),
  );
  assert.equal(s.find((x) => x.t === 3)?.shot, 0);
  // Capped: the grid widens, the cuts stay.
  const capped = sampleTimes(tl, 0.5, 5);
  assert.ok(capped.length <= 6);
  assert.equal(capped.filter((x) => x.kind === "cut").length, 3);
});

test("the opening is screened four times a second", () => {
  const t = openingTimes(20, 7, 4);
  assert.equal(t[0], 0);
  assert.equal(t[1], 0.25);
  assert.ok(t[t.length - 1]! <= 7);
  assert.equal(t.length, 29);
});

test("a judgement is read safely: match clamped and rounded, an unknown game call is unsure", () => {
  assert.equal(frameJudgement({}), undefined);
  assert.equal(frameJudgement({ match: "x" }), undefined);
  const j = frameJudgement({
    match: 4.6,
    game: "dunno",
    seen: "x",
    watermark: true,
    watermark_text: "@someone",
  })!;
  assert.equal(j.match, 3);
  assert.equal(j.game, "unsure");
  assert.equal(j.watermark, true);
});

test("Pulse's own marks and credits are never someone else's watermark", () => {
  assert.equal(
    foreignWatermark({ watermark: true, watermarkText: "PULSE" }),
    false,
  );
  assert.equal(
    foreignWatermark({
      watermark: true,
      watermarkText: "FOOTAGE: OFFICIAL TRAILERS · STEAM",
    }),
    false,
  );
  assert.equal(
    foreignWatermark({ watermark: true, watermarkText: "@GTAWorldX4U" }),
    true,
  );
  assert.equal(
    foreignWatermark({ watermark: true, watermarkText: "shutterstock" }),
    true,
  );
  assert.equal(foreignWatermark({ watermark: true, watermarkText: "" }), true);
  assert.equal(
    foreignWatermark({ watermark: false, watermarkText: "@x" }),
    false,
  );
});

test("another game is wrong only when the video never mentions it; a fan mod always is", () => {
  const m = "Grand Theft Auto VI preloads open on PS5. Like GTA V before it.";
  assert.equal(gameMentioned("Grand Theft Auto V", m), true);
  assert.equal(gameMentioned("GTA 5", "Grand Theft Auto V"), true);
  assert.equal(gameMentioned("Spider-Man", m), false);
  assert.equal(
    wrongGame(
      { game: "other", otherGame: "Marvel's Spider-Man 2", fanMod: false },
      m,
    ),
    true,
  );
  assert.equal(
    wrongGame(
      { game: "other", otherGame: "Grand Theft Auto V", fanMod: false },
      m,
    ),
    false,
  );
  assert.equal(
    wrongGame({ game: "none", otherGame: "", fanMod: false }, m),
    false,
  );
  assert.equal(
    wrongGame({ game: "named", otherGame: "", fanMod: true }, m),
    true,
  );
});

test("OCR share: the graphic's words found on its frame, short words and stop words aside", () => {
  assert.equal(ocrShare("212 GB on PS5", ["212", "GB", "PS5"]), 1);
  assert.equal(ocrShare("212 GB on PS5", ["212"]), 0.33);
  assert.equal(ocrShare("Rockstar Newswire", ["ROCKSTARNEWSWIRE"]), 1);
  assert.equal(ocrShare("", []), 1);
});

const sample = (
  t: number,
  shot: number,
  j?: Partial<FrameJudgement>,
  line = "a line",
): JudgedSample => ({
  t,
  kind: "tick",
  shot,
  line,
  frame: `frames/s_${t}.jpg`,
  ...(j ? { judgement: judgement(j) } : {}),
});

test("findings: a shot of another game, a watermark and an unrelated picture are each swaps", () => {
  const tl = timeline();
  const samples = [
    sample(0.25, 0, {
      game: "other",
      otherGame: "Marvel's Spider-Man 2",
      match: 1,
    }),
    sample(2, 0, {
      game: "other",
      otherGame: "Marvel's Spider-Man 2",
      match: 1,
    }),
    sample(4.25, 1, { watermark: true, watermarkText: "@fanpage", match: 2 }),
    sample(6, 1, { watermark: true, watermarkText: "@fanpage", match: 2 }),
    sample(8.25, 2, { match: 0 }),
    sample(10, 2, { match: 0 }),
  ];
  const f = findingsOf({
    tl,
    samples,
    graphics: [],
    opening: [],
    measured: noMeasure(),
    settings: DEFAULT_CRITIC,
    words: [],
  });
  const wrong = f.find((x) => x.check === "wrong_game")!;
  assert.equal(wrong.shot, 0);
  assert.equal(wrong.action, "swap");
  assert.match(wrong.detail, /Spider-Man/);
  const mark = f.find((x) => x.check === "watermark")!;
  assert.equal(mark.shot, 1);
  // The plate is the plan's own: it cannot be swapped by dropping media, so it is only noted.
  const plate = f.find((x) => x.check === "match" && x.shot === 2)!;
  assert.equal(plate.level, "warn");
  assert.equal(plate.action, undefined);
});

test("findings: the whole film blocks when the pictures do not follow the words", () => {
  const tl = timeline();
  const samples = [0.25, 2, 4.25, 6, 8.25, 10].map((t, i) =>
    sample(t, Math.min(2, Math.floor(i / 2)), { match: 1 }),
  );
  const f = findingsOf({
    tl,
    samples,
    graphics: [],
    opening: [],
    measured: noMeasure(),
    settings: DEFAULT_CRITIC,
    words: [],
  });
  const film = f.find((x) => x.check === "match" && x.level === "block")!;
  assert.match(film.detail, /mean 1\.00 of 3/);
});

test("findings: a card up too briefly is held on a Short and muted on a long video; an unreadable one is muted", () => {
  const tl = timeline();
  const g = {
    key: "card1",
    from: 4.2,
    to: 5,
    text: "212 GB on PS5 and Xbox Series",
    shown: 0.8,
    need: 2.4,
    frame: "frames/g.jpg",
  };
  const f = findingsOf({
    tl,
    samples: [],
    graphics: [g],
    opening: [],
    measured: noMeasure(),
    settings: DEFAULT_CRITIC,
    words: [],
  });
  assert.equal(f[0]!.action, "hold");
  const long = findingsOf({
    tl: { ...tl, kind: "long" },
    samples: [],
    graphics: [g],
    opening: [],
    measured: noMeasure(),
    settings: DEFAULT_CRITIC,
    words: [],
  });
  assert.equal(long[0]!.action, "mute");
  const unread = findingsOf({
    tl,
    samples: [],
    graphics: [{ ...g, shown: 3, read: 0.2, visible: false }],
    opening: [],
    measured: noMeasure(),
    settings: DEFAULT_CRITIC,
    words: [],
  });
  // Card designs draw part of their text: a frame without all the words is reported, never acted on.
  assert.equal(unread[0]!.level, "warn");
  assert.equal(unread[0]!.action, undefined);
  // OCR missed it but the model can read it: fine.
  const seen = findingsOf({
    tl,
    samples: [],
    graphics: [{ ...g, shown: 3, read: 0.2, visible: true }],
    opening: [],
    measured: noMeasure(),
    settings: DEFAULT_CRITIC,
    words: [],
  });
  assert.equal(seen.length, 0);
});

test("findings: black flashes block, planned pauses and the end card do not; frozen and silent stretches by their limits", () => {
  const tl = timeline({
    breaks: [{ start: 5, end: 6 }],
    freezes: [{ start: 2, end: 3.5 }],
  });
  const measured: Measurements = {
    black: [
      { start: 0, end: 0.1 },
      { start: 3, end: 3.07 },
      { start: 5.2, end: 5.6 },
      { start: 11.2, end: 12 },
    ],
    white: [{ start: 7, end: 7.05 }],
    frozen: [
      { start: 2, end: 3.5 },
      { start: 8, end: 9 },
      { start: 0.5, end: 3.9 },
    ],
    silence: [
      { start: 9, end: 10.5 },
      { start: 9.5, end: 9.8 },
    ],
    cuts: [4, 4.2, 8],
  };
  const f = findingsOf({
    tl,
    samples: [],
    graphics: [],
    opening: [],
    measured,
    settings: DEFAULT_CRITIC,
    words: [],
  });
  const black = f.filter((x) => x.check === "black");
  assert.equal(black.length, 1);
  assert.match(black[0]!.detail, /black flash at 0:03\.0/);
  assert.equal(f.filter((x) => x.check === "white").length, 1);
  // The planned freeze is meant; 1 s is under the limit; 3.4 s on a moving clip blocks.
  const frozen = f.filter((x) => x.check === "frozen");
  assert.equal(frozen.length, 1);
  assert.equal(frozen[0]!.level, "block");
  const dead = f.filter((x) => x.check === "dead_air");
  assert.equal(dead.length, 1);
  assert.equal(f.filter((x) => x.check === "flash_cut").length, 1);
});

test("findings: the narration stopping is a warning; ad-safety frames in a row are one block", () => {
  const tl = timeline();
  const w = [...words("one two", 0), ...words("three four", 4)];
  const f = findingsOf({
    tl,
    samples: [],
    graphics: [],
    opening: [
      { t: 1, screened: true, problem: "gore" },
      { t: 1.25, screened: true, problem: "gore" },
      { t: 1.5, screened: true, problem: "gore" },
      { t: 6, screened: true, problem: "a weapon aimed at the viewer" },
    ],
    measured: noMeasure(),
    settings: DEFAULT_CRITIC,
    words: w,
  });
  assert.equal(
    f.filter((x) => x.check === "dead_air" && x.level === "warn").length,
    1,
  );
  const ad = f.filter((x) => x.check === "ad_safety");
  assert.equal(ad.length, 2);
  assert.equal(ad[0]!.end, 1.5);
});

test("the verdict: clean passes, fixable faults get one pass, a second pass or an unfixable fault blocks", () => {
  const tl = timeline();
  assert.equal(verdictOf(tl, [], { pass: 0 }).verdict, "pass");
  const swap = {
    check: "wrong_game" as const,
    level: "fix" as const,
    t: 0,
    shot: 0,
    action: "swap" as const,
    detail: "0:00 shows Spider-Man",
  };
  const hold = {
    check: "graphics" as const,
    level: "fix" as const,
    t: 4.2,
    graphic: "card1",
    action: "hold" as const,
    detail: "too short",
  };
  const v = verdictOf(tl, [swap, hold], {
    pass: 0,
    mediaLeft: { clips: 4, images: 3 },
  });
  assert.equal(v.verdict, "fix");
  assert.deepEqual(v.plan.dropClips, [0]);
  assert.equal(v.plan.holds[0]!.key, "card1");
  assert.ok(v.plan.holds[0]!.to - v.plan.holds[0]!.from >= 2.39);
  assert.equal(v.plan.steps.length, 2);
  const again = verdictOf(tl, [swap], { pass: 1 });
  assert.equal(again.verdict, "block");
  assert.match(again.reasons[0]!, /still after the fix pass/);
  const black = {
    check: "black" as const,
    level: "block" as const,
    t: 3,
    detail: "black flash at 0:03.0",
  };
  const b = verdictOf(tl, [swap, black], { pass: 0 });
  assert.equal(b.verdict, "block");
  assert.deepEqual(b.reasons, ["black flash at 0:03.0"]);
  assert.deepEqual(b.plan.dropClips, [0]);
  // Taking out most of the clips would starve the re-plan.
  const starving = verdictOf(tl, [swap], {
    pass: 0,
    mediaLeft: { clips: 1, images: 3 },
  });
  assert.equal(starving.verdict, "block");
  // Warnings alone pass.
  assert.equal(
    verdictOf(tl, [{ check: "flash_cut", level: "warn", t: 1, detail: "x" }], {
      pass: 0,
    }).verdict,
    "pass",
  );
});

test("a card with no room to hold before the end card is dropped instead", () => {
  const tl = timeline({
    graphics: [
      {
        key: "card9",
        kind: "card",
        from: 10.5,
        to: 10.8,
        text: "a long card with many words on it here",
        words: 9,
      },
    ],
  });
  const v = verdictOf(
    tl,
    [
      {
        check: "graphics",
        level: "fix",
        t: 10.5,
        graphic: "card9",
        action: "hold",
        detail: "x",
      },
    ],
    { pass: 0 },
  );
  assert.deepEqual(v.plan.mutes, ["card9"]);
  assert.equal(v.plan.holds.length, 0);
});

test("scores weight each frame by the screen time it stands for", () => {
  const s = matchScores(
    [sample(1, 0, { match: 3 }), sample(9, 1, { match: 0 })],
    10,
  );
  assert.equal(s.judged, 2);
  assert.equal(s.match, 1.5);
  assert.equal(s.zeroShare, 0.5);
  const sc = scoresOf(
    { tl: timeline(), samples: [sample(1, 0, { match: 3 })], graphics: [] },
    [],
  );
  assert.equal(sc.overall, 100);
});

test("frame numbers: brightness, spread and the change from the last frame", () => {
  const a = new Uint8Array([0, 0, 10, 10]);
  const b = new Uint8Array([0, 0, 30, 30]);
  assert.deepEqual(frameStat(a, undefined), { mean: 5, max: 10, diff: 0 });
  assert.deepEqual(frameStat(b, a), { mean: 15, max: 30, diff: 10 });
});

test("frames analysed: black and white runs, a frozen run past its minimum, a hard cut", () => {
  const fps = 10;
  const st: FrameStat[] = [];
  const push = (n: number, s: FrameStat) => {
    for (let i = 0; i < n; i++) st.push({ ...s });
  };
  push(10, { mean: 100, max: 200, diff: 3 }); // 0-1 s moving
  push(2, { mean: 5, max: 20, diff: 3 }); // 1-1.2 s black
  st.push({ mean: 120, max: 220, diff: 80 }); // a cut at 1.2 s
  push(15, { mean: 120, max: 220, diff: 0.01 }); // frozen 1.3-2.8 s
  push(1, { mean: 245, max: 255, diff: 60 }); // white flash (and a cut)
  push(5, { mean: 100, max: 200, diff: 3 });
  const r = analyseFrames(st, { fps, minFrozen: 1 });
  assert.deepEqual(r.black, [{ start: 1, end: 1.2 }]);
  assert.deepEqual(r.white, [{ start: 2.8, end: 2.9 }]);
  assert.deepEqual(r.frozen, [{ start: 1.3, end: 2.8 }]);
  assert.deepEqual(r.cuts, [1.2, 2.8]);
});

test("silencedetect's lines become spans, an open one running to the end", () => {
  const err =
    "[silencedetect @ 0x1] silence_start: 3.5\n[silencedetect @ 0x1] silence_end: 5.25 | silence_duration: 1.75\n[silencedetect @ 0x1] silence_start: 28.1\n";
  assert.deepEqual(parseSilence(err, 30), [
    { start: 3.5, end: 5.25 },
    { start: 28.1, end: 30 },
  ]);
});

test("the critic's model: its own setting; a big one only where there is an orchestrator", () => {
  const s = { model: "qwen3-vl:30b", bigModels: DEFAULT_CRITIC.bigModels };
  assert.deepEqual(
    chooseCriticModel(s, { everyday: "qwen3-vl:8b", orchestrator: true }).big,
    true,
  );
  const mac = chooseCriticModel(s, {
    everyday: "qwen3-vl:8b",
    orchestrator: false,
  });
  assert.equal(mac.model, "qwen3-vl:8b");
  assert.equal(mac.big, false);
  assert.match(mac.why, /no.*orchestrator|there is none/);
  assert.equal(
    chooseCriticModel(
      { model: "", bigModels: [] },
      { everyday: "qwen3.5:9b", orchestrator: false },
    ).model,
    "qwen3.5:9b",
  );
});

test("the frame question names the game, the chapter's game, the line and the graphic", () => {
  const p = framePrompt({
    line: "Vice City followed in 2002.",
    game: "Grand Theft Auto",
    chapterGame: "Grand Theft Auto: Vice City",
    graphic: "2002",
  });
  assert.match(p, /about Grand Theft Auto\./);
  assert.match(p, /This part of it is about Grand Theft Auto: Vice City/);
  assert.match(p, /"Vice City followed in 2002\."/);
  assert.match(p, /"2002"/);
  assert.doesNotMatch(p, /—/); // no em dashes
});

test("holds set a card's span; a plan drops faulted media, holds and mutes, and lists the files", () => {
  const segs: Array<{ visual?: { span?: [number, number] } }> = [
    {},
    { visual: {} },
  ];
  assert.equal(
    applyCriticHolds(segs, { card1: [4, 7], card0: [1, 2], bogus: [1, 2] }),
    1,
  );
  assert.deepEqual(segs[1]!.visual!.span, [4, 7]);
  const assets = {
    video: "short.mp4",
    clips: [{ file: "a.mp4" }, { file: "b.mp4" }],
    images: [{ file: "x.jpg" }, { file: "y.jpg" }],
  } as any;
  const plan = {
    dropClips: [1],
    dropImages: [0],
    holds: [{ key: "card1", from: 4, to: 7 }],
    mutes: ["card3"],
    steps: [],
  };
  assert.deepEqual(faultedFiles(assets, plan), ["b.mp4", "x.jpg"]);
  const r = applyFixPlan(assets, plan, "short");
  assert.deepEqual((r.assets as any).clips, [{ file: "a.mp4" }]);
  assert.deepEqual((r.assets as any).images, [{ file: "y.jpg" }]);
  assert.deepEqual(r.assets.criticHolds, { card1: [4, 7] });
  assert.deepEqual(r.assets.gfxMuted, ["card3"]);
  assert.deepEqual(r.assets.criticDropped, ["b.mp4", "x.jpg"]);
  assert.equal(assets.clips.length, 2, "the original is untouched");
  const long = applyFixPlan(assets, { ...plan, mutes: ["2:5"] }, "long");
  assert.deepEqual((long.assets as any).quietMoments, ["2:5"]);
  assert.equal(long.assets.criticHolds, undefined);
});

test("a new plan leaves out what the critic faulted, never the last still", () => {
  const a = {
    clips: [{ file: "a" }, { file: "b" }],
    images: [{ file: "x" }],
    criticDropped: ["b", "x"],
  };
  assert.equal(dropCriticFaulted(a), 1);
  assert.deepEqual(a.clips, [{ file: "a" }]);
  assert.deepEqual(a.images, [{ file: "x" }]);
  assert.equal(dropCriticFaulted({ clips: [{ file: "a" }] }), 0);
});

// ---------------------------------------------------------------- a whole run on fakes

function fakeDeps(
  o: {
    judge?: (line: string, t: number) => Partial<FrameJudgement>;
    measured?: Measurements;
    opening?: string;
    ocr?: string[];
  } = {},
): CriticDeps {
  let clock = Date.parse("2026-11-14T12:00:00Z");
  return {
    measure: async () => o.measured ?? noMeasure(),
    frames: async (_v, dir, times, prefix) => {
      await fs.mkdir(dir, { recursive: true });
      return Promise.all(
        times.map(async (t, i) => {
          const f = path.join(dir, `${prefix}_${i}_${t}.jpg`);
          await fs.writeFile(f, "jpg");
          return f;
        }),
      );
    },
    opening: async (file) => {
      const t = Number(path.basename(file).split("_")[2]!.replace(".jpg", ""));
      return {
        gameplay: true,
        gore: o.opening === "gore" && t >= 2 && t < 3,
        nudity: false,
        weapon: false,
        shocking: false,
        strength: 7,
      };
    },
    ocr: async (files) =>
      new Map(
        files.map((f) => [f, o.ocr ?? ["212", "GB", "PS5", "Xbox", "Series"]]),
      ),
    withModel: (fn) => fn({ model: "fake-vl", big: false, why: "fake-vl" }),
    judge: async (_m, file, ask) => {
      const t = Number(path.basename(file).split("_")[2]!.replace(".jpg", ""));
      return judgement(o.judge?.(ask.line, t) ?? {});
    },
    visible: async () => false,
    now: () => new Date((clock += 1000)),
  };
}

test("runCritic writes a report and its Markdown; a clean video passes", async () => {
  const dir = path.join(await tmpDir(), "critic");
  const { report, plan } = await runCritic(
    {
      episode: "ep1",
      video: "v.mp4",
      dir,
      tl: timeline({
        graphics: [
          {
            key: "card1",
            kind: "card",
            from: 4.2,
            to: 7.5,
            text: "212 GB on PS5",
            words: 4,
          },
        ],
      }),
      words: [],
      settings: DEFAULT_CRITIC,
      pass: 0,
    },
    fakeDeps(),
  );
  assert.equal(report.verdict, "pass");
  assert.equal(report.scores.match, 3);
  assert.equal(report.graphics[0]!.read, 1);
  assert.equal(plan.steps.length, 0);
  assert.ok(report.opening.every((x) => x.screened));
  const md = await fs.readFile(path.join(dir, "report.md"), "utf8");
  assert.match(md, /verdict \*\*PASS\*\*/);
  const json = JSON.parse(
    await fs.readFile(path.join(dir, "report.json"), "utf8"),
  );
  assert.equal(json.episode, "ep1");
  assert.ok(reportMarkdown(report, "x").includes("Picture to line"));
});

test("runCritic: an ad-safety fault in the first 7 seconds and an unreadable card are found with their frames", async () => {
  const dir = path.join(await tmpDir(), "critic");
  const { report } = await runCritic(
    {
      episode: "ep1",
      video: "v.mp4",
      dir,
      tl: timeline({
        graphics: [
          {
            key: "card1",
            kind: "card",
            from: 4.2,
            to: 7.5,
            text: "212 GB on PS5",
            words: 4,
          },
        ],
      }),
      words: [],
      settings: DEFAULT_CRITIC,
      pass: 0,
    },
    fakeDeps({ opening: "gore", ocr: ["nothing"] }),
  );
  assert.equal(report.verdict, "block");
  const ad = report.findings.find((f) => f.check === "ad_safety")!;
  assert.equal(ad.t, 2);
  assert.match(ad.frame!, /^frames\/o_/);
  const g = report.findings.find((f) => f.check === "graphics")!;
  assert.equal(g.level, "warn");
  assert.match(report.reasons[0]!, /first 7 seconds show gore/);
});

// ---------------------------------------------------------------- the pipeline step

async function rendered(dir: string, mode: "report" | "fix", pass = 0) {
  const db = await testDb();
  const cfg = testConfig(dir);
  cfg.critic = { ...DEFAULT_CRITIC, mode };
  await createEpisode(db, "s1", clusterItems([item("GTA 6 preloads open", "PlayStation", "official")])[0]!);
  await transition(db, "s1", "selected", "rendered", {
    script_json: {
      headline: "GTA 6 preloads open",
      game_title: "Grand Theft Auto VI",
      youtube: { title: "GTA 6 preloads" },
    },
    assets_json: {
      video: "short.mp4",
      words: words(
        "GTA 6 preloads are open. Jason and Lucia arrive in Vice City. It needs 212 gigabytes.",
      ),
      durationSeconds: 10,
      clips: [
        { file: "assets/clip_0.mp4" },
        { file: "assets/clip_1.mp4" },
        { file: "assets/clip_2.mp4" },
      ],
      images: [{ file: "assets/a.jpg" }, { file: "assets/b.jpg" }],
      criticPass: pass,
      plan: {
        version: 1,
        fps: 30,
        totalFrames: 330,
        tailFrames: 30,
        heroIndex: 0,
        turns: [],
        sfx: [],
        shelf: [],
        shots: [
          { start: 0, end: 120, media: { type: "clip", index: 0 }, segment: 0 },
          {
            start: 120,
            end: 240,
            media: { type: "clip", index: 1 },
            segment: 0,
          },
          {
            start: 240,
            end: 300,
            media: { type: "image", index: 0 },
            segment: 0,
          },
        ],
      },
    },
    qa_json: { checked_at: "2026-11-14T10:00:00.000Z" },
  });
  const notices: any[] = [];
  const spider = (_line: string, t: number) =>
    t >= 4 && t < 8
      ? { game: "other" as const, otherGame: "Marvel's Spider-Man 2", match: 0 }
      : {};
  const s = {
    db,
    cfg,
    notify: async (m: any) => void notices.push(m),
    now: () => new Date("2026-11-14T12:00:00Z"),
    episodeDir: () => dir,
    deps: fakeDeps({ judge: spider }),
  };
  const ctx = {
    links: { approve: "a", reject: "r", preview: "p" },
    timeline: { segmentInputs: () => [], stampsFor: () => [] },
  };
  return { db, s, ctx, notices };
}

test("criticStep, report mode: the report is kept and logged, the video carries on", async () => {
  const dir = await tmpDir();
  const { db, s, ctx } = await rendered(dir, "report");
  assert.equal(await criticStep(s, (await getEpisode(db, "s1"))!, ctx), false);
  const ep = (await getEpisode(db, "s1"))!;
  assert.equal(ep.status, "rendered");
  assert.equal((ep.qa_json!.critic as any).verdict, "fix");
  const ev = await db.query<{ kind: string }>(
    `SELECT kind FROM events WHERE episode_id = 's1'`,
  );
  assert.ok(ev.some((e) => e.kind === "critic"));
  await fs.access(path.join(dir, "qa", "critic", "report.md"));
});

test("criticStep, fix mode: a wrong-game shot leaves the media and the episode goes back to render once", async () => {
  const dir = await tmpDir();
  const { db, s, ctx, notices } = await rendered(dir, "fix");
  assert.equal(await criticStep(s, (await getEpisode(db, "s1"))!, ctx), true);
  const ep = (await getEpisode(db, "s1"))!;
  assert.equal(ep.status, "voiced");
  const a = ep.assets_json as any;
  assert.equal(a.plan, undefined);
  assert.equal(a.criticPass, 1);
  assert.deepEqual(
    a.clips.map((c: any) => c.file),
    ["assets/clip_0.mp4", "assets/clip_2.mp4"],
  );
  assert.deepEqual(a.criticDropped, ["assets/clip_1.mp4"]);
  assert.match(notices[0].content, /one fix pass/);
});

test("criticStep, fix mode after its one pass: held for the owner with the reasons, the render untouched", async () => {
  const dir = await tmpDir();
  const { db, s, ctx, notices } = await rendered(dir, "fix", 1);
  assert.equal(await criticStep(s, (await getEpisode(db, "s1"))!, ctx), true);
  const ep = (await getEpisode(db, "s1"))!;
  assert.equal(ep.status, "awaiting_approval");
  assert.equal(ep.approval_mode, "manual");
  const a = ep.assets_json as any;
  assert.equal(
    a.clips.length,
    3,
    "the judged render's media stay as they were",
  );
  assert.ok(a.plan, "and so does its plan");
  assert.deepEqual(a.criticDropped, ["assets/clip_1.mp4"]);
  assert.match(a.criticBlocked[0], /still after the fix pass/);
  assert.match(notices[0].embeds[0].title, /Held by the critic/);
  assert.equal(notices[0].ping, true);
});

test("criticStep does nothing when off, for a twin, or with no video", async () => {
  const dir = await tmpDir();
  const { db, s, ctx } = await rendered(dir, "fix");
  s.cfg.critic = { ...s.cfg.critic, mode: "off" };
  assert.equal(await criticStep(s, (await getEpisode(db, "s1"))!, ctx), false);
  s.cfg.critic = { ...s.cfg.critic, mode: "fix" };
  const ep = (await getEpisode(db, "s1"))!;
  assert.equal(await criticStep(s, { ...ep, lane: "twin" }, ctx), false);
  assert.equal(
    await criticStep(
      s,
      { ...ep, assets_json: { ...ep.assets_json!, video: undefined } as never },
      ctx,
    ),
    false,
  );
});

test("the owner's notice lists the reasons and the places", () => {
  const n = blockedNotice(
    "GTA 6 preloads",
    {
      scores: { overall: 40, match: 1.1 },
      reasons: ["black flash at 0:03.0"],
      findings: [
        {
          check: "black",
          level: "block",
          t: 3,
          detail: "black flash at 0:03.0",
        },
      ],
    } as never,
    { approve: "A", reject: "R", preview: "P" },
  );
  const d = (n.embeds![0] as any).description as string;
  assert.match(d, /black flash at 0:03\.0/);
  assert.match(d, /\[Approve as it is\]\(A\)/);
});

test("a fade through black is a dip, not a flash; a cut to black and back is a flash", () => {
  const fps = 30;
  const fade: FrameStat[] = [];
  for (let i = 0; i < 30; i++) fade.push({ mean: 100, max: 200, diff: 2 });
  for (const m of [80, 60, 40, 25]) fade.push({ mean: m, max: m * 2, diff: 10 });
  fade.push({ mean: 2, max: 10, diff: 20 }, { mean: 2, max: 10, diff: 0 });
  for (const m of [25, 40, 60, 80]) fade.push({ mean: m, max: m * 2, diff: 10 });
  for (let i = 0; i < 30; i++) fade.push({ mean: 100, max: 200, diff: 2 });
  const d = analyseFrames(fade, { fps });
  assert.equal(d.black.length, 1);
  assert.equal(d.black[0]!.dip, true);
  const cut: FrameStat[] = [];
  for (let i = 0; i < 30; i++) cut.push({ mean: 100, max: 200, diff: 2 });
  cut.push({ mean: 2, max: 10, diff: 98 }, { mean: 2, max: 10, diff: 0 });
  for (let i = 0; i < 30; i++) cut.push({ mean: 100, max: 200, diff: 98 });
  const c = analyseFrames(cut, { fps });
  assert.equal(c.black[0]!.dip, undefined);
  const tl = timeline();
  const f = findingsOf({ tl, samples: [], graphics: [], opening: [], measured: { ...noMeasure(), black: [{ start: 3, end: 3.07, dip: true }] }, settings: DEFAULT_CRITIC, words: [] });
  assert.equal(f.length, 0);
});

test("long videos keep the house rule: a graphic is muted only when gone in under half its reading time", () => {
  const tl = timeline({ kind: "long" });
  const g = (shown: number) => ({ key: "2:5", kind: "source", from: 10, to: 10 + shown, text: "a quoted passage of about ten words in all here", shown, need: 3.6 });
  const tight = findingsOf({ tl, samples: [], graphics: [g(2.2)], opening: [], measured: noMeasure(), settings: DEFAULT_CRITIC, words: [] });
  assert.equal(tight.length, 0);
  const flash = findingsOf({ tl, samples: [], graphics: [g(1.2)], opening: [], measured: noMeasure(), settings: DEFAULT_CRITIC, words: [] });
  assert.equal(flash[0]!.action, "mute");
  // A Short's hook headline is measured but never changed; the loop's repeat is not counted.
  const short = timeline();
  const hook = findingsOf({ tl: short, samples: [], graphics: [{ key: "hook", kind: "hook", from: 0, to: 1, text: "Sons of Sparta Gets 2 Free Modes", shown: 1, need: 2.7 }, { key: "loop", kind: "loop", from: 28, to: 29, text: "Sons of Sparta Gets 2 Free Modes", shown: 1, need: 2.7 }], opening: [], measured: noMeasure(), settings: DEFAULT_CRITIC, words: [] });
  assert.equal(hook.length, 1);
  assert.equal(hook[0]!.level, "warn");
});

test("any tag of 20B or more is big, listed or not; small ones are not", () => {
  assert.equal(isBigModel("qwen3-vl:32b-instruct-q8_0", []), true);
  assert.equal(isBigModel("llava:34b", []), true);
  assert.equal(isBigModel("qwen3-vl:30b-a3b-instruct-q4_K_M", []), true);
  assert.equal(isBigModel("qwen3.5:9b", []), false);
  assert.equal(isBigModel("qwen3-vl:8b", []), false);
  assert.equal(isBigModel("gemma3:4b", []), false);
  assert.equal(DEFAULT_CRITIC.leaseRam, 22);
});

test("proof-run precision: hedges and Pulse's cards are not wrong games; the source or a series neighbour only warns", () => {
  const m = "Grand Theft Auto VI";
  assert.equal(wrongGame({ game: "other", otherGame: "unsure", fanMod: false }, m), false);
  assert.equal(wrongGame({ game: "none", otherGame: "", fanMod: true }, m), false);
  assert.equal(wrongGame({ game: "named", otherGame: "", fanMod: true }, m), true);
  const tl = timeline({ shots: [{ index: 0, start: 0, end: 4, media: { type: "clip", index: 0 }, label: 'Official trailer "Grand Theft Auto VI Trailer 2" from the Rockstar Games channel' }] });
  const ride = [sample(0.25, 0, { game: "other", otherGame: "Ride 4", match: 2 }), sample(2, 0, { game: "other", otherGame: "Ride 4", match: 2 })];
  const f = findingsOf({ tl, samples: ride, graphics: [], opening: [], measured: noMeasure(), settings: DEFAULT_CRITIC, words: [] });
  assert.equal(f[0]!.check, "wrong_game");
  assert.equal(f[0]!.level, "warn");
  const plain = timeline({ shots: [{ index: 0, start: 0, end: 4, media: { type: "clip", index: 0 }, label: "a stock clip" }] });
  const gta5 = [sample(0.25, 0, { game: "other", otherGame: "Grand Theft Auto V", match: 2 }), sample(2, 0, { game: "other", otherGame: "Grand Theft Auto V", match: 2 })];
  const g = findingsOf({ tl: { ...plain, mentions: "GTA 6" }, samples: gta5, graphics: [], opening: [], measured: noMeasure(), settings: DEFAULT_CRITIC, words: [] });
  assert.equal(g[0]!.level, "warn");
  const star = [sample(0.25, 0, { game: "other", otherGame: "Starfield", match: 1 }), sample(2, 0, { game: "other", otherGame: "Starfield", match: 1 })];
  const h = findingsOf({ tl: plain, samples: star, graphics: [], opening: [], measured: noMeasure(), settings: DEFAULT_CRITIC, words: [] });
  assert.equal(h[0]!.level, "fix");
  assert.equal(h[0]!.action, "swap");
  // One flagged opening frame alone is a warning.
  const one = findingsOf({ tl: plain, samples: [], graphics: [], opening: [{ t: 3, screened: true, problem: "gore or blood" }, { t: 3.25, screened: true }], measured: noMeasure(), settings: DEFAULT_CRITIC, words: [] });
  assert.equal(one[0]!.level, "warn");
});

test("a ranking's shot whose source names one of its games is never swapped on the model's word", () => {
  const tl = timeline({
    game: "open-world games of the 2010s",
    mentions: "No Man's Sky Skyrim Red Dead Redemption 2",
    shots: [{ index: 0, start: 0, end: 4, media: { type: "image", index: 0 }, label: "Steam store asset for “No Man's Sky” (app 275850)" }],
  });
  const star = [sample(0.25, 0, { game: "other", otherGame: "Starfield", match: 1 }), sample(2, 0, { game: "other", otherGame: "Starfield", match: 1 })];
  const f = findingsOf({ tl, samples: star, graphics: [], opening: [], measured: noMeasure(), settings: DEFAULT_CRITIC, words: [] });
  assert.equal(f.find((x) => x.check === "wrong_game")!.level, "warn");
});

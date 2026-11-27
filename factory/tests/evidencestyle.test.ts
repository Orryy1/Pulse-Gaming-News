import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EVIDENCE_PASS_MARK,
  FACE_LIKENESS_SHARE,
  boardModeFor,
  boardSafe,
  caseTopic,
  evidenceArm,
  evidenceVerdict,
  pinnable,
  planEvidenceBoard,
  spokenDates,
  spokenStamps,
  type BoardPlanInput,
} from "../src/evidencestyle.ts";
import { prepareEvidence } from "../src/evidencestep.ts";
import {
  BOARD_GEOMETRY,
  boardCamera,
  pinSpots,
  stringDrawn,
  windowAt,
} from "../src/render/evidenceboard.ts";
import {
  BoardMarks,
  BoardMode,
} from "../src/render/components/EvidenceStyle.tsx";
import { loadConfig } from "../src/config.ts";
import type { Segment } from "../src/render/timeline.ts";

/** Words at a steady 0.4 s each, from text as the voice speaks it. */
const say = (text: string, from = 0) =>
  text.split(/\s+/).map((t, i) => ({
    text: t,
    start: from + i * 0.4,
    end: from + i * 0.4 + 0.35,
  }));

test("EVIDENCE_STYLE is off unless set; the share defaults to half and is clamped", () => {
  const prev = {
    on: process.env.EVIDENCE_STYLE,
    share: process.env.EVIDENCE_STYLE_SHARE,
  };
  delete process.env.EVIDENCE_STYLE;
  delete process.env.EVIDENCE_STYLE_SHARE;
  assert.equal(loadConfig().evidenceStyle, false);
  assert.equal(loadConfig().evidenceStyleShare, 0.5);
  process.env.EVIDENCE_STYLE = "true";
  process.env.EVIDENCE_STYLE_SHARE = "4";
  assert.equal(loadConfig().evidenceStyle, true);
  assert.equal(loadConfig().evidenceStyleShare, 1);
  for (const [k, v] of [
    ["EVIDENCE_STYLE", prev.on],
    ["EVIDENCE_STYLE_SHARE", prev.share],
  ] as const)
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
});

test("no change when off: no plan, no event, no face check, and the layers draw nothing without a plan", async () => {
  let events = 0;
  let faces = 0;
  const got = await prepareEvidence({
    cfg: { evidenceStyle: false, evidenceStyleShare: 1 },
    episodeId: "ep_x",
    frame: "short",
    fps: 30,
    headline: "The hidden history of GTA's Vice City",
    game: "Grand Theft Auto VI",
    words: say("In nineteen eighty six Vice City was confirmed."),
    segments: [],
    images: [
      { file: "a.jpg", kind: "screenshot", provenance: "IGDB screenshot" },
    ],
    dir: "/tmp/x",
    event: async () => events++,
    faces: async () => {
      faces++;
      return { checked: true, shares: new Map() };
    },
  });
  assert.equal(got, undefined);
  assert.equal(events, 0);
  assert.equal(faces, 0);
  // The render layers: absent plan, absent output (Short.tsx and Long.tsx only mount them with props.board).
  assert.equal(BoardMode({ plan: undefined, images: [] }), null);
  assert.equal(BoardMarks({ plan: undefined }), null);
});

test("an ineligible episode is never armed, even with the style on", async () => {
  let events = 0;
  const got = await prepareEvidence({
    cfg: { evidenceStyle: true, evidenceStyleShare: 1 },
    episodeId: "ep_y",
    frame: "short",
    fps: 30,
    headline: "GTA 6 patch fixes broken autosaves",
    game: "Grand Theft Auto VI",
    words: [],
    segments: [],
    images: [],
    dir: "/tmp/x",
    event: async () => events++,
  });
  assert.equal(got, undefined);
  assert.equal(events, 0);
});

test("the arm is stable by episode and follows the share", () => {
  assert.equal(evidenceArm("ep_a", 0), "plain");
  assert.equal(evidenceArm("ep_a", 1), "board");
  assert.equal(evidenceArm("ep_a", 0.5), evidenceArm("ep_a", 0.5));
  const ids = Array.from({ length: 400 }, (_, i) => `ep_${i}`);
  const board = ids.filter((id) => evidenceArm(id, 0.5) === "board").length;
  assert.ok(board > 160 && board < 240, `about half: ${board}`);
});

test("board mode picks mystery and lore stories: GTA lore, conspiracies, timelines, crime stories", () => {
  const on = (headline: string, game = "") =>
    boardModeFor({ headline, game }).on;
  assert.ok(on("Why GTA 6 Took Thirteen Years", "Grand Theft Auto VI"));
  assert.ok(
    on("The real-life history behind Vice City", "Grand Theft Auto VI"),
  );
  assert.ok(on("The Silksong conspiracy theory that came true"));
  assert.ok(on("The full Half-Life timeline"));
  assert.ok(on("The hackers who stole GTA 6's build"));
  // Everyday news words no longer qualify on their own.
  assert.ok(!on("GTA 6 leak shows a new car", "Grand Theft Auto VI"));
  assert.ok(
    !on("How Rockstar found CJ's voice", "Grand Theft Auto: San Andreas"),
  );
  assert.ok(!on("The hidden settings in Silksong"));
  assert.ok(!on("GTA 6 starts at $79.99", "Grand Theft Auto VI"));
  assert.ok(!on("GTA 6 patch fixes broken autosaves", "Grand Theft Auto VI"));
  assert.ok(!on("Titanfall 2 Still Has No Sequel"));
});

test("dates come from the spoken line as the captions write them", () => {
  const d = spokenDates(
    say(
      "On September 17, twenty thirteen, it launched. In two thousand four you got CJ. It sold 2000 copies.",
    ),
  );
  assert.deepEqual(
    d.map((x) => [x.big, x.sub ?? ""]),
    [
      ["17", "SEPTEMBER 2013"],
      ["2004", ""],
    ],
    "a figure before a unit is a count, not a year",
  );
  assert.deepEqual(
    spokenDates(say("It arrives on the 26th of March.")).map((x) => [
      x.big,
      x.sub,
    ]),
    [["26", "MARCH"]],
  );
  // "may" and "march" as everyday words before a figure are not dates; with a time word they are.
  assert.deepEqual(spokenDates(say("Players may 3 times win.")), []);
  assert.deepEqual(
    spokenDates(say("It lands on May 5.")).map((x) => x.big),
    ["5"],
  );
  // A count before a month word, or a bare figure before a noun, is never a date.
  assert.deepEqual(
    spokenDates(say("The top 3 may surprise you. It has 2000 enemies.")),
    [],
  );
});

test("stamps are spoken words from the neutral list, never negated, never unsafe", () => {
  const got = spokenStamps(
    say(
      "Rockstar confirmed it. The map was never confirmed. It was not leaked. It could be delayed. The project was quietly cancelled.",
    ),
  ).map((s) => s.text);
  assert.deepEqual(got, ["CONFIRMED", "NEVER CONFIRMED", "QUIETLY CANCELLED"]);
  // Crime and harm words are not in the vocabulary and fail the safety check anyway.
  assert.deepEqual(
    spokenStamps(say("He was arrested and the gang was killed.")),
    [],
  );
  for (const bad of [
    "MURDER",
    "MASS ARRESTS",
    "KILLED",
    "DEAD",
    "WAR",
    "ATTACK",
    "CRISIS",
    "GORE",
  ])
    assert.equal(boardSafe(bad), false, bad);
  for (const ok of [
    "CONFIRMED",
    "UNSOLVED",
    "LEAKED",
    "CASE: WHY GTA 6 TOOK THIRTEEN YEARS",
  ])
    assert.ok(boardSafe(ok), ok);
});

test("only Pulse's own pictures are pinned: never a real person's photo or a likeness", () => {
  assert.ok(
    pinnable({
      kind: "screenshot",
      provenance: 'IGDB screenshot for "Grand Theft Auto VI" (2026)',
    }),
  );
  assert.ok(
    pinnable({
      kind: "hero",
      provenance: "Official Rockstar Games screenshot",
    }),
  );
  assert.ok(
    pinnable({
      kind: "still",
      provenance: "Pulse's own gameplay capture of GTA VI (a.mp4)",
    }),
  );
  assert.ok(
    pinnable({
      kind: "article",
      provenance: "Official press image from Rockstar Newswire (https://x)",
    }),
  );
  assert.ok(!pinnable({ kind: "photo", provenance: "Rockstar North office" }));
  assert.ok(
    !pinnable({
      kind: "portrait",
      provenance: "Portrait of Sam Houser cut from: trailer",
    }),
  );
  assert.ok(
    !pinnable({
      kind: "screenshot",
      provenance:
        "Dan Houser's own Wikidata photo (Q1, P18): Wikimedia Commons",
    }),
  );
  assert.ok(
    !pinnable({ kind: "article", provenance: "og:image from ign.com" }),
  );
  assert.ok(
    !pinnable({
      kind: "screenshot",
      provenance: "Illustrative stock footage from Pexels",
    }),
  );
  assert.ok(
    !pinnable({
      kind: "screenshot",
      provenance: "IGDB screenshot",
      faceShare: FACE_LIKENESS_SHARE,
    }),
  );
  assert.ok(
    pinnable({
      kind: "screenshot",
      provenance: "IGDB screenshot",
      faceShare: 0.01,
    }),
  );
});

const segs = (): Segment[] => [
  { kind: "hook", text: "h", start: 0, end: 3 },
  { kind: "beat", text: "b1", start: 3, end: 12 },
  { kind: "beat", text: "b2", start: 12, end: 24 },
  { kind: "loop", text: "l", start: 24, end: 30 },
];

const shortInput = (over: Partial<BoardPlanInput> = {}): BoardPlanInput => ({
  frame: "short",
  fps: 30,
  totalFrames: 900,
  episodeId: "ep_t",
  mode: true,
  words: [
    ...say("Grand Theft Auto was secretly planned.", 0),
    ...say(
      "On September 17, twenty thirteen, it was confirmed by Rockstar.",
      4,
    ),
    ...say(
      "The same city links back to the first game in nineteen ninety seven.",
      13,
    ),
  ],
  segments: segs(),
  headline: "Why GTA 6 Took Thirteen Years",
  shots: [
    { start: 0, end: 90, segment: 0, media: { type: "image", index: 0 } },
    { start: 90, end: 200, segment: 1, media: { type: "image", index: 1 } },
    { start: 200, end: 330, segment: 1, media: { type: "clip", index: 0 } },
    { start: 330, end: 450, segment: 2, media: { type: "image", index: 2 } },
    { start: 450, end: 560, segment: 2, media: { type: "image", index: 3 } },
    { start: 560, end: 720, segment: 2, media: { type: "image", index: 4 } },
  ],
  images: [
    { kind: "hero", provenance: "Official key art" },
    { kind: "screenshot", provenance: "IGDB screenshot" },
    { kind: "screenshot", provenance: "IGDB screenshot" },
    { kind: "photo", provenance: "Photo of a studio boss" },
    { kind: "screenshot", provenance: "Official Rockstar Games screenshot" },
  ],
  avoid: [[0, 90]],
  ...over,
});

test("the Short's board: the case card opens the body, dates and stamps land on their words, stills join the board", () => {
  const p = planEvidenceBoard(shortInput());
  assert.deepEqual(p.cases, [
    { from: 96, frames: 84, topic: "WHY GTA 6 TOOK THIRTEEN YEARS" },
  ]);
  // The September date lands inside the case card's time, so it waits; the 1997 one lands on its word.
  assert.deepEqual(
    p.dates.map((d) => d.big),
    ["1997"],
  );
  assert.ok(
    p.stamps.every((s) => s.from >= 90),
    "nothing over the opening poster",
  );
  assert.deepEqual(
    p.stamps.map((s) => s.text),
    ["CONFIRMED"],
  );
  // The opening's still stays the poster; the photo of a person is never pinned, so it splits the run.
  assert.deepEqual(
    p.pins.map((x) => x.image),
    [1, 2, 4],
  );
  assert.deepEqual(
    p.windows.map((w) => [w.from, w.to, w.pins]),
    [
      [90, 200, [0]],
      [330, 450, [1]],
      [560, 720, [2]],
    ],
  );
  assert.deepEqual(p.allowed, [0, 1, 2, 4]);
  // A string draws on at a linking word said while its pin is up ("same" at 13.4 s), else just after it lands.
  assert.equal(p.pins[1]!.stringAt, Math.round(13.4 * 30));
  assert.equal(p.pins[2]!.stringAt, 570);
});

test("without board mode only the cards and stamps are planned", () => {
  const p = planEvidenceBoard(shortInput({ mode: false }));
  assert.equal(p.pins.length, 0);
  assert.equal(p.windows.length, 0);
  assert.equal(p.allowed.length, 0);
  assert.ok(p.cases.length && p.stamps.length);
});

test("a long video's case card names the video once its first chapter is under way; nothing lands inside a breather", () => {
  const segments: Segment[] = [
    { kind: "hook", text: "h", start: 0, end: 20 },
    {
      kind: "beat",
      text: "c",
      start: 20,
      end: 80,
      visual: {
        kind: "chapter",
        primary: "The Edinburgh Years",
        secondary: "GTA",
      },
    },
    {
      kind: "beat",
      text: "c",
      start: 80,
      end: 200,
      visual: { kind: "chapter", primary: "A war of words", secondary: "GTA" },
    },
  ];
  const plan = (headline: string) =>
    planEvidenceBoard({
      frame: "long",
      fps: 30,
      totalFrames: 6000,
      episodeId: "ep_l",
      mode: false,
      words: say("In twenty thirteen it launched and it was confirmed.", 21),
      segments,
      headline,
      shots: [],
      images: [],
      breaks: [
        { start: 20, end: 24 },
        { start: 80, end: 84 },
      ],
    });
  const p = plan("Why GTA 6 Took Thirteen Years");
  // One case card: the video's headline, 6 s into the first chapter (its title is on the breather and lower third).
  assert.deepEqual(
    p.cases.map((c) => [c.from, c.topic]),
    [[(24 + 6) * 30, "WHY GTA 6 TOOK THIRTEEN YEARS"]],
  );
  // A headline that fails the advertiser check gets no card.
  assert.deepEqual(plan("The war behind GTA's studio").cases, []);
  assert.ok(
    p.dates.every((d) => d.from >= 24 * 30),
    "no date inside the breather",
  );
});

test("case topics are cut at a word boundary", () => {
  assert.equal(
    caseTopic("Why Grand Theft Auto Went Back to Vice City"),
    "WHY GRAND THEFT AUTO WENT BACK TO",
  );
  assert.equal(caseTopic("Leonida"), "LEONIDA");
});

test("the layout keeps every pin on the board and apart; the camera starts on its pin and moves to the next", () => {
  for (const frame of ["short", "long"] as const) {
    const g = BOARD_GEOMETRY[frame];
    const spots = pinSpots(12, frame, 1234);
    for (const s of spots) {
      assert.ok(
        s.x >= g.print * 0.7 && s.x <= g.w - g.print * 0.7,
        `${frame} x ${s.x}`,
      );
      assert.ok(
        s.y >= g.print * 0.7 && s.y <= g.h - g.print * 0.7,
        `${frame} y ${s.y}`,
      );
    }
    for (let i = 1; i < spots.length; i++)
      assert.ok(
        Math.hypot(
          spots[i]!.x - spots[i - 1]!.x,
          spots[i]!.y - spots[i - 1]!.y,
        ) >
          g.print * 0.4,
      );
  }
  const pins = [
    { image: 0, from: 0, to: 60, stringAt: 10 },
    { image: 1, from: 60, to: 120, stringAt: 70 },
  ];
  const win = { from: 0, to: 120, pins: [0, 1] };
  const spots = pinSpots(2, "short", 7);
  const a = boardCamera(0, win, pins, spots, "short");
  assert.equal(a.x, spots[0]!.x);
  const mid = boardCamera(70, win, pins, spots, "short");
  assert.ok(mid.zoom < 1, "pulls back on the way");
  const end = boardCamera(119, win, pins, spots, "short");
  assert.equal(end.x, spots[1]!.x);
  assert.equal(windowAt({ windows: [win] }, 50), win);
  assert.equal(windowAt({ windows: [win] }, 120), undefined);
  assert.equal(stringDrawn(70, 70), 0);
  assert.equal(stringDrawn(200, 70), 1);
});

test("the pass mark: no verdict under 10 a side; a pass needs better average viewed and no fewer views", () => {
  const rows = (
    arm: "board" | "plain",
    n: number,
    viewed: number,
    views: number,
  ) => Array.from({ length: n }, () => ({ arm, avgViewedPct: viewed, views }));
  assert.equal(
    evidenceVerdict([
      ...rows("board", 9, 80, 9000),
      ...rows("plain", 12, 50, 100),
    ]).ready,
    false,
  );
  assert.equal(EVIDENCE_PASS_MARK.minPerArm, 10);
  const pass = evidenceVerdict([
    ...rows("board", 10, 62, 5000),
    ...rows("plain", 10, 60, 5000),
  ]);
  assert.equal(pass.ready, true);
  assert.equal(pass.pass, true);
  assert.equal(
    evidenceVerdict([
      ...rows("board", 10, 60.5, 5000),
      ...rows("plain", 10, 60, 5000),
    ]).pass,
    false,
  );
  assert.equal(
    evidenceVerdict([
      ...rows("board", 10, 70, 4000),
      ...rows("plain", 10, 60, 5000),
    ]).pass,
    false,
  );
});

test("in the board arm the plan is made after the face check, and the arm, the pass mark and the plan are logged once", async () => {
  const events: Array<Record<string, unknown>> = [];
  const prep = await prepareEvidence({
    cfg: { evidenceStyle: true, evidenceStyleShare: 1 },
    episodeId: "ep_b",
    frame: "short",
    fps: 30,
    ...(() => {
      const i = shortInput();
      return { words: i.words, segments: i.segments, headline: i.headline };
    })(),
    game: "Grand Theft Auto VI",
    images: shortInput().images.map((c, k) => ({
      file: `img${k}.jpg`,
      kind: c.kind,
      provenance: c.provenance,
    })),
    dir: "/ep",
    avoid: [[0, 90]],
    event: async (_k, d) => events.push(d),
    // Picture 2 shows a big face: it is never pinned.
    faces: async (files) => ({
      checked: true,
      shares: new Map(files.map((f) => [f, f.endsWith("img2.jpg") ? 0.2 : 0])),
    }),
  });
  assert.equal(prep?.arm, "board");
  const plan = prep!.plan(shortInput().shots, 900)!;
  prep!.plan(shortInput().shots, 900);
  assert.deepEqual(
    plan.pins.map((p) => p.image),
    [1, 4],
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]!.arm, "board");
  assert.equal(events[0]!.passMark, EVIDENCE_PASS_MARK.text);
  assert.equal(events[0]!.faceDropped, 1);
});

test("the plain arm is logged and gets no plan", async () => {
  const events: string[] = [];
  const prep = await prepareEvidence({
    cfg: { evidenceStyle: true, evidenceStyleShare: 0 },
    episodeId: "ep_p",
    frame: "short",
    fps: 30,
    headline: "Why GTA 6 Took Thirteen Years",
    game: "Grand Theft Auto VI",
    words: [],
    segments: segs(),
    images: [],
    dir: "/ep",
    event: async (k, d) => events.push(`${k}:${d.arm}`),
  });
  assert.equal(prep?.arm, "plain");
  assert.equal(prep!.plan([], 900), undefined);
  assert.deepEqual(events, ["evidence_style:plain"]);
});

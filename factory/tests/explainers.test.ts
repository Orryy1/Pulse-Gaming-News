import { test } from "node:test";
import assert from "node:assert/strict";
import { goodScript } from "./helpers.ts";
import {
  anatomyReady,
  explainerAt,
  explainerWindow,
  figure,
  groundExplainer,
  numbersIn,
  sameWord,
  ungrounded,
  haystackOf,
} from "../src/render/components/explainers/ground.ts";
import { layoutProblems } from "../src/render/components/explainers/layout.ts";
import { ICON_NAMES } from "../src/render/components/explainers/icons.ts";
import {
  EXPLAINER_TYPES,
  ITEM_COUNTS,
  type Explainer,
} from "../src/render/components/explainers/types.ts";
import { placeCallouts } from "../src/render/components/explainers/Anatomy.tsx";
import {
  runningTotals,
  tallCounterSize,
  tileUnit,
} from "../src/render/components/explainers/HowMuch.tsx";
import { fitLabel, fitValue, tallContentUsed } from "../src/render/components/explainers/layout.ts";
import { textWidth } from "../src/render/components/packs/fit.ts";
import {
  anchorFor,
  project,
  turnAt,
} from "../src/render/components/explainers/Object3D.tsx";
import { playheadAt } from "../src/render/components/explainers/Playhead.tsx";
import {
  EXPLAINERS,
  explainerSettle,
} from "../src/render/components/explainers/index.tsx";
import { anatomyPoints, placeAnatomy } from "../src/assets/anatomy.ts";
import {
  groundMarks,
  shortLines,
  shortSources,
  markShortExplainers,
  ExplainerMarksSchema,
} from "../src/editorial/explainers.ts";
import { segmentInputs } from "../src/pipeline.ts";
import { cardWindow } from "../src/render/shortcraft.ts";
import { chooseFillers } from "../src/assets/fillers.ts";
import {
  FAMILY_WORDS,
  FILLER_FAMILIES,
  fillerSettle,
  fillerSound,
} from "../src/render/fillerplan.ts";
import {
  anatomyPictures,
  explainersOn,
  shortExplainersStep,
} from "../src/explainerstep.ts";
import type { Llm } from "../src/editorial/llm.ts";

// The Scooter Bros Short (ep_20261115_17efaecf), as it went out.
const SCOOTER = {
  line: "A driver arrives within a few seconds. Then they leave on a scooter they brought along.",
  texts: [
    "In GTA 6, your car could come to you.",
    "Edge's preview describes Scooter Bros, a handy phone app that delivers your own car for a fee.",
    "Edge says your weapons are stored in the trunk. Even better, delivery brings your weapons back too.",
    "Scooter Bros sends a driver to deliver the car within a few seconds.",
  ],
};
const ctx = { ...SCOOTER, orientation: "tall" as const };

test("explainers: a grounded step flow is kept word for word, with its cues", () => {
  const g = groundExplainer(
    {
      type: "steps",
      title: "Scooter Bros delivery",
      items: [
        { label: "Driver arrives", icon: "car", cue: "A driver arrives" },
        { label: "Car delivered", icon: "box" },
        {
          label: "Leaves on scooter",
          icon: "scooter",
          cue: "leave on a scooter",
        },
      ],
    },
    ctx,
  );
  assert.ok(g.explainer, g.dropped.join("; "));
  assert.deepEqual(
    g.explainer.items.map((i) => i.label),
    ["Driver arrives", "Car delivered", "Leaves on scooter"],
  );
  assert.equal(g.explainer.items[0]!.cue, "A driver arrives");
  assert.equal(g.explainer.title, "Scooter Bros delivery");
});

test("explainers: an invented word or number drops its item, and too few items drop the explainer", () => {
  const g = groundExplainer(
    {
      type: "steps",
      title: "",
      items: [
        { label: "Driver arrives" },
        { label: "Tip the driver" },
        { label: "Wait 30 seconds" },
      ],
    },
    ctx,
  );
  assert.equal(g.explainer, undefined);
  assert.ok(g.dropped.some((d) => /Tip the driver.*tip/.test(d)));
  assert.ok(g.dropped.some((d) => /Wait 30 seconds.*30/.test(d)));
  const t = groundExplainer(
    {
      type: "steps",
      title: "Rockstar's secret plan",
      items: [{ label: "Driver arrives" }, { label: "Leaves on scooter" }],
    },
    ctx,
  );
  assert.ok(t.explainer);
  assert.equal(
    t.explainer.title,
    "",
    "an ungrounded title is dropped, the explainer kept",
  );
});

test("explainers: shapes without values lose them, shapes with values need them", () => {
  const s = groundExplainer(
    {
      type: "chain",
      title: "",
      items: [
        { label: "Driver arrives", value: "few seconds" },
        { label: "Leaves on scooter" },
      ],
    },
    ctx,
  );
  assert.ok(s.explainer);
  assert.equal(s.explainer.items[0]!.value, undefined);
  const v = groundExplainer(
    {
      type: "versus",
      title: "",
      items: [{ label: "Driver", value: "few seconds" }, { label: "Scooter" }],
    },
    ctx,
  );
  assert.equal(v.explainer, undefined);
});

test("explainers: a price build must add up", () => {
  const c = {
    line: "Pure Xbox lists Standard at $79.99 and Ultimate at $99.99.",
    texts: ["Ultimate costs $20 more."],
    orientation: "tall" as const,
  };
  const ok = groundExplainer(
    {
      type: "howmuch",
      title: "",
      items: [
        { label: "Standard", value: "$79.99" },
        { label: "Ultimate", value: "+$20" },
        { label: "Ultimate", value: "$99.99" },
      ],
    },
    c,
  );
  assert.ok(ok.explainer, ok.dropped.join("; "));
  const bad = groundExplainer(
    {
      type: "howmuch",
      title: "",
      items: [
        { label: "Standard", value: "$79.99" },
        { label: "Ultimate", value: "+$20" },
        { label: "Ultimate", value: "$79.99" },
      ],
    },
    c,
  );
  // The wrong total is caught twice: $79.99 is said with Standard, not Ultimate, so that row goes, and no row shows it.
  assert.ok(!bad.explainer?.items.some((x) => x.label === "Ultimate" && x.value === "$79.99"));
  assert.ok(bad.dropped.some((d) => /never said together/.test(d)));
});

test("explainers: a cue naming another item's number is dropped (the stop then times from its own words)", () => {
  const g = groundExplainer(
    {
      type: "timeline",
      title: "",
      items: [
        { label: "New Zealand", value: "November 18", cue: "November 19" },
        {
          label: "Midnight local",
          value: "November 19",
          cue: "at midnight local",
        },
      ],
    },
    {
      line: "Elsewhere, GTA 6 unlocks November 19 at midnight local.",
      texts: [
        "Rockstar Support says GTA 6 unlocks from November 18 in New Zealand.",
      ],
      orientation: "tall",
    },
  );
  assert.ok(g.explainer);
  assert.equal(g.explainer.items[0]!.cue, undefined);
  assert.equal(g.explainer.items[1]!.cue, "at midnight local");
});

test("explainers: a label too long for two lines is dropped before it can render clipped", () => {
  const e: Explainer = {
    type: "cycle",
    title: "",
    items: [
      { label: "Wwwwwwwwwwww Mmmmmmmmmmmm" },
      { label: "A" },
      { label: "B" },
    ],
  };
  assert.ok(layoutProblems(e, "tall").length > 0);
  assert.equal(
    groundExplainer(e, {
      line: "Wwwwwwwwwwww Mmmmmmmmmmmm A B",
      texts: [],
      orientation: "tall",
    }).explainer,
    undefined,
  );
});

test("explainers: numbers from figures and words, stems and the haystack", () => {
  assert.deepEqual(
    [
      ...numbersIn("three hours, twenty five, two thousand, $79.99, 1,950"),
    ].sort(),
    ["1950", "2000", "25", "3", "79.99"].sort(),
  );
  assert.ok(sameWord("delivered", "delivery"));
  assert.ok(sameWord("stored", "storage"));
  assert.ok(!sameWord("car", "card"));
  assert.deepEqual(
    ungrounded("3 hours earlier", haystackOf(["three hours before"])),
    ["earlier"],
  );
  assert.equal(figure("+$20"), 20);
  assert.equal(figure("-5 FPS"), -5);
  assert.equal(figure("$79.99"), 79.99);
});

test("explainers: items land a beat before their words, in order and apart", () => {
  const e: Explainer = {
    type: "steps",
    title: "",
    items: [
      { label: "Driver arrives", cue: "A driver arrives" },
      { label: "Car delivered" },
      { label: "Leaves on scooter", cue: "leave on a scooter" },
    ],
  };
  const words = SCOOTER.line
    .split(" ")
    .map((text, i) => ({ text, start: 0.5 + i * 0.35, end: 0.8 + i * 0.35 }));
  const at = explainerAt(e, words, 30, 180);
  assert.equal(at.length, 3);
  assert.ok(at[0]! < at[1]! && at[1]! < at[2]!);
  assert.ok(at[1]! - at[0]! >= 8 && at[2]! - at[1]! >= 8);
  // The cue "leave on a scooter" lands on its telling word ("scooter", word 13: 0.5 s + 12 x 0.35 s = 4.7 s), a few frames early.
  assert.equal(at[2], Math.round(4.7 * 30) - 4);
  const untimed = explainerAt(e, [], 30, 150);
  assert.deepEqual(
    untimed,
    [...untimed].sort((a, b) => a - b),
  );
});

test("explainers: a Short's window covers the line from just before its first item, at least 2.5 s", () => {
  const e: Explainer = {
    type: "steps",
    title: "",
    items: [
      { label: "Driver arrives", cue: "A driver arrives" },
      { label: "Leaves on scooter" },
    ],
  };
  const words = [
    { text: "x", start: 1 },
    ...SCOOTER.line.split(" ").map((text, i) => ({ text, start: 3 + i * 0.3 })),
  ];
  const w = explainerWindow(e, words, { start: 90, end: 240 }, 30);
  assert.equal(w.from, 90);
  assert.equal(w.from + w.len, 240);
  const short = explainerWindow(e, words, { start: 90, end: 120 }, 30);
  assert.equal(short.len, 30);
});

test("explainers: the Short's segments carry each beat's explainer, and the card window becomes the explainer's", () => {
  const script = goodScript();
  const e: Explainer = {
    type: "steps",
    title: "",
    items: [{ label: "A" }, { label: "B" }],
  };
  script.explainers = [{ part: "beat", index: 1, explainer: e }];
  const inputs = segmentInputs(script);
  const beats = inputs.filter((x) => x.kind === "beat");
  assert.equal(beats[1]!.explainer, e);
  assert.equal(beats[0]!.explainer, undefined);
  assert.equal(inputs.find((x) => x.kind === "take")!.explainer, undefined);
  const segments = inputs.map((x, i) => ({
    ...x,
    start: i * 4,
    end: i * 4 + 4,
  }));
  const k = inputs.indexOf(beats[1]!);
  const w = cardWindow(segments, [], k, 30, 600);
  assert.equal(
    w.from + w.len,
    (k + 1) * 4 * 30,
    "an explainer stays to the end of its line",
  );
});

test("explainers: the pass's marks are guarded: eligible lines only, never neighbours, at most the cap", () => {
  const lines = [
    { text: "Hook.", eligible: false },
    { text: SCOOTER.line, eligible: true },
    { text: SCOOTER.line, eligible: true },
    { text: "Loop.", eligible: false },
  ];
  const mark = (line: number) => ({
    line,
    type: "steps" as const,
    title: "",
    object: "",
    items: [
      { label: "Driver arrives", value: "", icon: "car", cue: "", lead: false },
      { label: "Leaves on scooter", value: "", icon: "", cue: "", lead: false },
    ],
  });
  const r = groundMarks(
    { explainers: [mark(1), mark(2), mark(3), mark(4)] },
    { lines, texts: SCOOTER.texts, orientation: "tall", max: 2 },
  );
  assert.deepEqual(
    r.kept.map((k) => k.line),
    [1],
  );
  assert.ok(r.dropped.some((d) => /line 1 steps: that line cannot/.test(d)));
  assert.ok(r.dropped.some((d) => /line 3 steps: the line beside it/.test(d)));
  assert.ok(ExplainerMarksSchema.safeParse({ explainers: [mark(2)] }).success);
});

test("explainers: a ranked entry keeps its rank card; the pass reads the script's own cards as its words", () => {
  const script = goodScript();
  script.beats[0]!.visual = {
    kind: "rank",
    primary: "Game",
    secondary: "",
  } as never;
  const lines = shortLines(script);
  assert.equal(lines[1]!.part, undefined);
  assert.equal(lines[2]!.part, "beat");
  assert.ok(shortSources(script).includes(script.headline));
});

test("explainers: the Short step marks once, keeps an empty list, and never throws", async () => {
  const script = goodScript();
  const calls: string[] = [];
  const db = {
    query: async (sql: string) => (calls.push(sql), { rows: [] }),
  } as never;
  const llm: Llm = { structured: async () => ({ explainers: [] }) as never };
  await shortExplainersStep(
    { db, llm, cfg: { explainers: "off" } },
    { id: "e" },
    script,
    {},
    "/d",
  );
  assert.equal(script.explainers, undefined, "off: nothing runs");
  await shortExplainersStep(
    { db, llm, cfg: { explainers: "short" } },
    { id: "e" },
    script,
    {},
    "/d",
  );
  assert.deepEqual(script.explainers, []);
  const failing: Llm = {
    structured: async () => {
      throw new Error("down");
    },
  };
  const fresh = goodScript();
  await shortExplainersStep(
    { db, llm: failing, cfg: { explainers: "all" } },
    { id: "e" },
    fresh,
    {},
    "/d",
  );
  assert.equal(fresh.explainers, undefined);
  assert.ok(
    explainersOn("all", "long") &&
      explainersOn("long", "long") &&
      !explainersOn("short", "long"),
  );
  const marks = await markShortExplainers(llm, script);
  assert.deepEqual(marks.explainers, []);
});

test("explainers: anatomy is placed only where the vision model sees the parts", async () => {
  assert.deepEqual(
    anatomyPoints(
      {
        parts: [
          { n: 1, visible: true, x: 310, y: 600 },
          { n: 2, visible: false, x: 0, y: 0 },
          { n: 3, visible: true, x: 999, y: 500 },
        ],
      },
      3,
    ),
    [{ x: 0.31, y: 0.6 }, undefined, undefined],
  );
  const e: Explainer = {
    type: "anatomy",
    title: "",
    items: [{ label: "Phone" }, { label: "Your own car" }, { label: "Trunk" }],
  };
  const answers: Record<string, unknown> = {
    a: { parts: [{ n: 1, visible: true, x: 300, y: 600 }] },
    b: {
      parts: [
        { n: 1, visible: true, x: 310, y: 600 },
        { n: 2, visible: true, x: 600, y: 700 },
      ],
    },
  };
  const placed = await placeAnatomy(
    e,
    [
      { file: "a", src: "a.jpg" },
      { file: "b", src: "b.jpg" },
    ],
    "GTA",
    async (f) => answers[f],
  );
  assert.ok(placed && anatomyReady(placed));
  assert.equal(placed.picture, "b.jpg");
  assert.deepEqual(
    placed.items.map((i) => i.label),
    ["Phone", "Your own car"],
  );
  assert.equal(
    await placeAnatomy(
      e,
      [{ file: "a", src: "a.jpg" }],
      "GTA",
      async (f) => answers[f],
    ),
    undefined,
  );
  assert.ok(!anatomyReady(e));
  const pics = anatomyPictures(
    [
      { file: "logo.png", kind: "logo", aspect: 2 },
      { file: "s.jpg", kind: "screenshot", aspect: 1.78 },
      { file: "t.jpg", kind: "portrait", aspect: 0.7 },
    ],
    "/ep",
  );
  assert.deepEqual(
    pics.map((p) => p.src),
    ["s.jpg"],
  );
});

test("explainers: callouts never overlap and keep their order down each side", () => {
  const pts = [
    { x: 0.2, y: 0.5 },
    { x: 0.25, y: 0.52 },
    { x: 0.8, y: 0.1 },
    { x: 0.7, y: 0.95 },
  ];
  const c = placeCallouts(pts, 700, 150);
  for (const side of ["left", "right"] as const) {
    const col = c.filter((x) => x.side === side).sort((a, b) => a.y - b.y);
    for (let k = 1; k < col.length; k++)
      assert.ok(col[k]!.y - col[k - 1]!.y >= 150 - 1e-6);
    for (const x of col) assert.ok(x.y >= 75 - 1e-6 && x.y <= 625 + 1e-6);
  }
  assert.equal(c.filter((x) => x.side === "left").length, 2);
});

test("explainers: the price build's totals, tiles, playhead and the 3D object's maths", () => {
  assert.deepEqual(
    runningTotals(["$79.99", "+$20", "$99.99"]),
    [79.99, 99.99, 99.99],
  );
  assert.deepEqual(runningTotals(["$70", "$80"]), [70, 80]);
  assert.equal(tileUnit(99.99), 10);
  assert.equal(tileUnit(2000), 200);
  assert.equal(playheadAt(0, [20, 60]), 0);
  assert.equal(playheadAt(60, [20, 60]), 1);
  assert.deepEqual(anchorFor("console", "Disc drive"), [0.0, -0.35, 0.3]);
  assert.equal(
    anchorFor("console", "30 FPS target"),
    undefined,
    "a label naming no part points at the whole object",
  );
  const t = turnAt(200, 240, 30);
  const [x, y] = project([0, 0, 0], t, 900, 700);
  assert.ok(Math.abs(x - 450) < 1 && Math.abs(y - 350) < 1);
});

test("explainers: every shape is registered, settles inside its shot and has sane item counts", () => {
  for (const type of EXPLAINER_TYPES) {
    assert.ok(EXPLAINERS[type].component, type);
    const [lo, hi] = ITEM_COUNTS[type];
    assert.ok(lo >= 2 && hi >= lo && hi <= 4, type);
    const e: Explainer = {
      type,
      title: "",
      items: [{ label: "A" }, { label: "B" }],
    };
    assert.ok(explainerSettle(e, [10, 40], 150) <= 140);
  }
});

test("explainers: the icon set is generic (no brand or logo glyphs)", () => {
  assert.ok(ICON_NAMES.length >= 60);
  assert.ok(!ICON_NAMES.some((n) => /brand|logo/.test(n)));
});

test("explainers: a documentary moment's explainer becomes its filler shot, over its own pictures too", () => {
  const e: Explainer = {
    type: "steps",
    title: "",
    items: [{ label: "A" }, { label: "B" }],
  };
  const moments = [{ show: "x" }, { show: "y", explainer: e }, { show: "z" }];
  const choice = chooseFillers(
    [
      {
        entry: 0,
        game: "Game",
        sentences: ["One.", "Two works like this.", "Three."],
        moments,
      },
    ],
    {
      images: [
        {
          file: "own.jpg",
          kind: "screenshot",
          aspect: 1.78,
          beatIndex: 0,
          moment: 1,
        } as never,
      ],
      clips: [],
      seed: 1,
      explainers: true,
    },
  );
  const pick = choice.picks.find((p) => p.moment === 1);
  assert.ok(pick, JSON.stringify(choice.left));
  assert.equal(pick.filler.family, "explainer");
  assert.equal(fillerSound(pick.filler), "pop");
  assert.equal(fillerSettle(pick.filler, 300, 30), 100);
  for (const f of FILLER_FAMILIES) assert.ok(FAMILY_WORDS[f], f);
});

test("tall boards: bigger type for cards and the price build, the long video's sizes unchanged", () => {
  assert.equal(fitLabel("Driver arrives", "steps", "tall", 3, "Scooter Bros delivery").size, 66);
  assert.equal(fitLabel("Driver arrives", "steps", "wide", 3).size, 44);
  assert.equal(fitLabel("Driver arrives", "timeline", "tall", 3).size, 52);
  // One line while it can stay at the old largest size, so no word is left alone on a second line.
  assert.equal(fitLabel("World loads around you", "chain", "tall", 2).lines.length, 1);
  assert.equal(fitValue("$79.99", "versus", "tall", 2).size > 76, true);
  // A short flow is centred in the board; a full one fills it.
  assert.ok(tallContentUsed("chain", "tall", 2, "") !== undefined);
  assert.equal(tallContentUsed("steps", "tall", 3, "Scooter Bros delivery"), undefined);
  assert.equal(tallContentUsed("steps", "wide", 2, ""), undefined);
});

test("tall price build: the counter shrinks until it clears a total row set top left", () => {
  const items = [
    { label: "Console", value: "$999.99" },
    { label: "Pro extra", value: "+$300" },
    { label: "Total price", value: "$1,299.99" },
  ];
  const totals = runningTotals(items.map((x) => x.value));
  const size = tallCounterSize(items, totals, Math.max(...totals), 952);
  assert.ok(size < 176);
  const flat = fitValue("$1,299.99", "howmuch", "tall", 3).size * 0.8;
  const label = fitLabel("Total price", "howmuch", "tall", 3);
  const rowW = Math.max(textWidth("$1,299.99", "anton", flat), textWidth("Total price", "inter", label.size, -0.3));
  assert.ok(952 - textWidth("$1,299.99", "anton", size) >= rowW + 30);
  // No total row: the counter keeps its full size.
  assert.equal(tallCounterSize(items.slice(0, 2), totals.slice(0, 2), Math.max(...totals.slice(0, 2)), 952), 176);
});

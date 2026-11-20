import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCodeScenes,
  biomeOf,
  daysBetween,
  figureIn,
  sceneForSegment,
  type SceneContext,
} from "../src/render/codescene.ts";
import { buildPlan, type RenderPlan } from "../src/render/plan.ts";
import { scorePlan } from "../src/qa/rubric.ts";
import { loadConfig } from "../src/config.ts";
import {
  delayScene,
  isoDay,
  reviewsScene,
  shareScene,
} from "../src/render/components/codescene/GfxScene.tsx";
import type { Segment } from "../src/render/timeline.ts";

const ctx = (sourced = ""): SceneContext => ({
  sourced,
  game: "God of War Laufey",
  today: "2026-11-05",
});
const beat = (text: string, visual: Record<string, unknown>): Segment =>
  ({
    kind: "beat",
    text,
    start: 0,
    end: 6,
    visual: { secondary: "", items: [], ...visual },
  }) as unknown as Segment;

test("the delay needs both real days, and the days between are plain arithmetic", () => {
  const s = sceneForSegment(
    beat("It moved from February 16 to May 20.", {
      kind: "timeline",
      primary: "Delayed",
      date_from: "2027-02-16",
      date_to: "2027-05-20",
    }),
    ctx(),
  );
  assert.equal(s?.type, "slide");
  assert.equal(daysBetween("2027-02-16", "2027-05-20"), 93);
  // Evercold's script knew only the old month: no calendar is drawn from a guess.
  assert.equal(
    sceneForSegment(
      beat("It moved to February 23.", {
        kind: "timeline",
        primary: "Delayed",
        date_from: "2027-01",
        date_to: "2027-02-23",
      }),
      ctx(),
    ),
    undefined,
  );
});

test("a figure nobody sourced draws nothing", () => {
  const rows = {
    kind: "versus",
    primary: "Input lag",
    items: ["*Switch 2:100ms", "PS5:49.1ms"],
  };
  assert.equal(
    sceneForSegment(beat("Switch 2 clocks 100 and PS5 49.1.", rows), ctx())
      ?.type,
    "lag",
  );
  assert.equal(
    sceneForSegment(beat("Switch 2 is slower than PS5.", rows), ctx()),
    undefined,
  );
  assert.equal(
    sceneForSegment(
      beat("Switch 2 is slower.", rows),
      ctx("Digital Foundry measured 100ms and 49.1ms"),
    )?.type,
    "lag",
  );
  assert.equal(figureIn("9", "released in 1998"), false);
  assert.equal(figureIn("1,000", "sold 1000 copies"), true);
});

test("scores need three rows and rank highest first; shares and years come from the card", () => {
  const s = sceneForSegment(
    beat("Sektori has 93, Big Walk 91 and the remake 96.", {
      kind: "specs",
      primary: "Metacritic",
      items: ["Sektori:93", "Big Walk:91", "*Remake:96"],
    }),
    ctx(),
  );
  assert.ok(s?.type === "ladder");
  assert.deepEqual(
    s.rows.map((r) => r.score),
    [96, 93, 91],
  );
  const lost = sceneForSegment(
    beat("Sales dropped 22%.", {
      kind: "stat",
      primary: "-22%",
      secondary: "UK Xbox sales",
    }),
    ctx(),
  );
  assert.ok(lost?.type === "crowd" && lost.lost && lost.percent === 22);
  assert.equal(
    sceneForSegment(
      beat("Sales dropped.", {
        kind: "stat",
        primary: "-22%",
        secondary: "UK Xbox sales",
      }),
      ctx(),
    ),
    undefined,
  );
  assert.equal(
    sceneForSegment(
      beat("Its studio turns 40.", {
        kind: "stat",
        primary: "40 years",
        secondary: "Bethesda",
      }),
      ctx(),
    )?.type,
    "years",
  );
});

test("a stated wait says whose estimate it is, or draws nothing", () => {
  const take = (text: string) =>
    ({ kind: "take", text, start: 0, end: 10 }) as Segment;
  const s = sceneForSegment(
    take("Jason Schreier believes it's still more than two years away."),
    ctx(),
  );
  assert.ok(
    s?.type === "wait" && s.months === 24 && s.note.includes("Jason Schreier"),
  );
  assert.equal(
    sceneForSegment(take("It's more than two years away."), ctx()),
    undefined,
  );
});

// A Short with a clip on the delay line: the scene must not take it.
const segments: Segment[] = [
  {
    kind: "hook",
    text: "God of War Laufey lost three months.",
    start: 0,
    end: 3,
  },
  beat("It moved from February 16 to May 20 on the calendar now.", {
    kind: "timeline",
    primary: "Delayed",
    date_from: "2027-02-16",
    date_to: "2027-05-20",
  }),
  beat("Bethesda celebrates 40 years of its studio this month.", {
    kind: "stat",
    primary: "40 years",
    secondary: "Bethesda",
  }),
  { kind: "loop", text: "Will you wait?", start: 12, end: 15 },
] as Segment[];
segments[1]!.start = 3;
segments[1]!.end = 8;
segments[2]!.start = 8;
segments[2]!.end = 12;
const words = segments.flatMap((s) => {
  const ws = s.text.split(" ");
  return ws.map((text, i) => ({
    text,
    start: s.start + (i * (s.end - s.start)) / ws.length,
    end: s.start + ((i + 0.8) * (s.end - s.start)) / ws.length,
  }));
});
const planFor = (
  clips: Array<{ durationSeconds: number; beatIndex?: number }>,
  images: Array<{ kind: string; aspect: number; beatIndex?: number }> = [],
) =>
  buildPlan({
    segments,
    words,
    durationSeconds: 16,
    images,
    clips,
    storyType: "delay",
    isRumour: false,
    attribution: "",
    variant: 0,
  });
const on = (
  plan: RenderPlan,
  stampsAt: number[] = [],
  images: Array<{ beatIndex?: number }> = [],
) =>
  applyCodeScenes(
    plan,
    segments,
    words,
    ctx("February 16 May 20"),
    stampsAt,
    images,
  );

test("thin media: the plate becomes the scene and the empty-panel limit passes", () => {
  const before = planFor([]);
  const rate = (p: RenderPlan) =>
    scorePlan({
      plan: p,
      segments,
      words,
      footageSeconds: 0,
      footageBudgetSeconds: 20,
      hookWords: 7,
      plateShareMax: 0.15,
    }).metrics.find((m) => m.name === "plate_share")!;
  assert.equal(rate(before).grade, "red");
  const after = on(before);
  assert.deepEqual(
    after.scenes!.map((s) => s.scene.type),
    ["slide", "years"],
  );
  assert.ok(after.shots.some((s) => s.media.type === "scene"));
  assert.ok(Number(rate(after).value) < Number(rate(before).value));
  // The opening and the closing shot are never taken: frame 0 is the thumbnail and the last frame meets it.
  assert.notEqual(after.shots[0]!.media.type, "scene");
  assert.notEqual(after.shots.at(-1)!.media.type, "scene");
  // The source plan is left as it was, so a plan with the setting off is untouched.
  assert.ok(
    before.shots.every((s) => s.media.type !== "scene") && !before.scenes,
  );
});

test("footage is never replaced", () => {
  const clips = [
    { durationSeconds: 30, beatIndex: 0 },
    { durationSeconds: 30, beatIndex: 1 },
    { durationSeconds: 30 },
    { durationSeconds: 30 },
    { durationSeconds: 30 },
    { durationSeconds: 30 },
    { durationSeconds: 30 },
  ];
  const before = planFor(clips);
  const after = on(before);
  const count = (p: RenderPlan) =>
    p.shots.filter((s) => s.media.type === "clip").length;
  assert.ok(count(before) > 0);
  assert.equal(count(after), count(before));
  for (const s of after.scenes ?? [])
    for (const shot of before.shots)
      if (shot.start >= s.from && shot.start < s.to)
        assert.notEqual(shot.media.type, "clip");
});

test("a line's own still stays; what footage cannot show may take a general one", () => {
  const images = [
    { kind: "hero", aspect: 1.78 },
    { kind: "screenshot", aspect: 1.78, beatIndex: 0 },
    { kind: "screenshot", aspect: 1.78 },
    { kind: "screenshot", aspect: 1.78 },
  ];
  const before = planFor([], images);
  const after = on(before, [], images);
  for (const shot of after.shots.filter((s) => s.media.type === "scene")) {
    const was = before.shots.find((b) => b.start === shot.start)!;
    if (was.media.type === "image")
      assert.notEqual(images[was.media.index]!.beatIndex, 0);
  }
});

test("nothing is laid under a word moment, and a run too short to read is left", () => {
  const before = planFor([]);
  assert.equal(
    on(before, [4]).scenes?.some((s) => s.scene.type === "slide"),
    false,
  );
  assert.ok(before.shots.length > 0);
});

test("a landscape only when a title line names the place", () => {
  assert.equal(biomeOf("That's the desert province"), "desert");
  assert.equal(biomeOf("a surprising new shooter"), undefined);
  const named: Segment[] = [
    { kind: "hook", text: "Sentinel is official.", start: 0, end: 3 },
    beat("The trailer names the desert province of Hammerfell here.", {
      kind: "title",
      primary: "Hammerfell",
      secondary: "Named",
    }),
    { kind: "loop", text: "Will you go there?", start: 8, end: 12 },
  ] as Segment[];
  named[1]!.start = 3;
  named[1]!.end = 8;
  const plan = buildPlan({
    segments: named,
    words,
    durationSeconds: 12,
    images: [],
    clips: [],
    storyType: "reveal",
    isRumour: false,
    attribution: "",
    variant: 0,
  });
  const after = applyCodeScenes(plan, named, words, ctx());
  const titled = (after.scenes ?? []).filter(
    (s) => s.scene.type === "terrain" && s.scene.title,
  );
  assert.equal(titled.length, 1);
  assert.equal(titled[0]!.segment, 1);
  // A deal Short that says "ocean" in a ranked line gets no landscape.
  const ranked = [
    { kind: "hook", text: "Five deals.", start: 0, end: 3 },
    beat("Subnautica strands you on an alien ocean.", {
      kind: "rank",
      primary: "Subnautica",
    }),
    { kind: "loop", text: "Which one?", start: 8, end: 12 },
  ] as Segment[];
  const none = buildPlan({
    segments: ranked,
    words,
    durationSeconds: 12,
    images: [],
    clips: [],
    storyType: "reveal",
    isRumour: false,
    attribution: "",
    variant: 0,
  });
  assert.equal(applyCodeScenes(none, ranked, words, ctx()).scenes, undefined);
});

test("the setting is off by default, and the plan is untouched without it", () => {
  process.env.CODE_SCENES = "";
  assert.equal(loadConfig().codeScenes, false);
  assert.equal(planFor([]).scenes, undefined);
});

test("the long videos' styles fit only their own exact rows", () => {
  const g = (o: Record<string, unknown>) =>
    ({
      kind: "delay",
      primary: "Release date",
      secondary: "",
      items: [],
      ...o,
    }) as never;
  assert.equal(isoDay("February 16, 2027"), "2027-02-16");
  assert.equal(isoDay("May 2027"), undefined);
  assert.equal(
    delayScene(g({ items: ["February 16, 2027", "May 20, 2027"] }))?.type,
    "slide",
  );
  assert.equal(
    delayScene(g({ items: ["February 2027", "May 2027"] })),
    undefined,
  );
  assert.equal(
    reviewsScene(g({ items: ["IGN: 9", "GameSpot: 8", "VGC: 10"] }))?.type,
    "ladder",
  );
  assert.equal(
    reviewsScene(g({ items: ["IGN: great", "GameSpot: 8", "VGC: 10"] })),
    undefined,
  );
  assert.equal(
    shareScene(g({ primary: "25%", secondary: "of the workforce" }))?.type,
    "crowd",
  );
});

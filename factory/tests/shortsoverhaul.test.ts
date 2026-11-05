// The Shorts overhaul (world-class audit, Nov 2026): footage first, no blank panels, the art check's frames.
import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan, MIN_SHOT, pickHero, type PlanInput } from "../src/render/plan.ts";
import { argumentArm, cardFigureProblems, sourceTag, endingProblems, evergreenRuleNote, shortRuleNote, thinProblems } from "../src/editorial/shortrules.ts";
import { whyFollowProblems } from "../src/editorial/why.ts";
import { evergreenTitle } from "../src/editorial/seo.ts";
import { scorePlan } from "../src/qa/rubric.ts";
import { shortSampleTimes, VISION_PROMPT } from "../src/qa/vision.ts";
import { fillCandidates } from "../src/assets/clipscore.ts";
import { capFootage } from "../src/assets/footage.ts";
import { numberVariant } from "../src/assets/igdb.ts";
import { framesNeeded } from "../src/qa/mediarich.ts";
import { bigWordsInCrop, longestCleanRun } from "../src/assets/cliptext.ts";
import type { Segment } from "../src/render/timeline.ts";
import type { Word } from "../src/voice/elevenlabs.ts";

function words(seconds: number): Word[] {
  const out: Word[] = [];
  for (let t = 0; t < seconds - 0.4; t += 0.4)
    out.push({ text: "word", start: t, end: t + 0.35 } as Word);
  return out;
}

function segments(rank = false): Segment[] {
  const seg = (
    kind: string,
    start: number,
    end: number,
    visual?: string,
  ): Segment =>
    ({
      kind,
      start,
      end,
      text: "line",
      visual: visual ? { kind: visual } : undefined,
    }) as unknown as Segment;
  return [
    seg("hook", 0, 4),
    seg("beat", 4, 14, rank ? "rank" : "none"),
    seg("beat", 14, 24, rank ? "rank" : "stat"),
    seg("beat", 24, 32, rank ? "rank" : "none"),
    seg("take", 32, 38),
    seg("loop", 38, 41),
  ];
}

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  segments: segments(),
  words: words(41),
  durationSeconds: 41,
  images: [
    { kind: "hero", aspect: 1.78 },
    { kind: "screenshot", aspect: 1.78 },
    { kind: "screenshot", aspect: 1.78 },
  ],
  clips: [
    { durationSeconds: 4.7, role: "hook", motion: 0.9 },
    { durationSeconds: 4.7, beatIndex: 0, motion: 0.6 },
    { durationSeconds: 4.7, beatIndex: 1, motion: 0.4 },
    { durationSeconds: 4.7, beatIndex: 2, motion: 0.5 },
    { durationSeconds: 4.7, motion: 0.5 },
    { durationSeconds: 4.7, motion: 0.3 },
  ],
  storyType: "reveal",
  isRumour: false,
  attribution: "",
  variant: 0,
  openOnClip: true,
  ...over,
});

const share = (p: ReturnType<typeof buildPlan>, type: string) =>
  p.shots
    .filter((s) => s.media.type === type)
    .reduce((n, s) => n + s.end - s.start, 0) / p.totalFrames;

function contiguous(p: ReturnType<typeof buildPlan>) {
  assert.equal(p.shots[0]!.start, 0);
  for (let i = 1; i < p.shots.length; i++)
    assert.equal(p.shots[i]!.start, p.shots[i - 1]!.end, `gap at shot ${i}`);
  assert.equal(p.shots.at(-1)!.end, p.totalFrames);
}

test("footage first shows far more of the same clips, with no gaps", () => {
  const before = buildPlan(input());
  const after = buildPlan(input({ footageFirst: true }));
  contiguous(after);
  assert.ok(
    share(after, "clip") > share(before, "clip") * 1.3,
    `${share(before, "clip")} -> ${share(after, "clip")}`,
  );
  // Almost every frame of the 28 s of clips is on screen.
  assert.ok(share(after, "clip") * 41 > 22, String(share(after, "clip") * 41));
});

test("footage first never shows a frame past a clip's end", () => {
  const p = buildPlan(input({ footageFirst: true }));
  const clips = input().clips;
  for (const s of p.shots)
    if (s.media.type === "clip") {
      const end = (s.media.trimFrom ?? 0) + (s.end - s.start);
      const have = Math.floor(clips[s.media.index]!.durationSeconds * 30);
      assert.ok(end <= have + 6, `clip ${s.media.index}: ${end} of ${have}`);
    }
});

test("footage first keeps shots long enough to read, except the sting", () => {
  const p = buildPlan(input({ footageFirst: true }));
  for (const [i, s] of p.shots.entries())
    if (i > 0) assert.ok(s.end - s.start >= MIN_SHOT - 1, `shot ${i}`);
});

test("off, the plan is what it always was", () => {
  assert.deepEqual(
    buildPlan(input()),
    buildPlan(input({ footageFirst: false })),
  );
});

test("a Short with art tagged to its lines does not open on the plate", () => {
  const images = [0, 1, 2, 3].flatMap((b) => [
    { kind: "hero", aspect: 1.78, beatIndex: b },
    { kind: "screenshot", aspect: 1.78, beatIndex: b },
  ]);
  const i = input({ images, clips: [] });
  const before = buildPlan(i);
  const after = buildPlan({ ...i, footageFirst: true });
  assert.ok(share(before, "plate") > 0);
  const opening = after.shots.filter(
    (s) => s.media.type === "plate" && s.start < 150,
  );
  assert.equal(opening.length, 0);
});

test("a ranking's opening never borrows the winner's art", () => {
  const entries = [0, 1, 2];
  const images = entries.flatMap((b) => [
    { kind: "hero", aspect: 1.78, beatIndex: b },
    { kind: "screenshot", aspect: 1.78, beatIndex: b },
  ]);
  const p = buildPlan(
    input({
      segments: segments(true),
      images,
      clips: [],
      footageFirst: true,
    }),
  );
  const firstWinnerLine = 3; // segment of the last beat
  for (const s of p.shots)
    if (s.segment < firstWinnerLine && s.media.type === "image")
      assert.notEqual(
        images[s.media.index]!.beatIndex,
        2,
        `shot at ${s.start}`,
      );
});

test("a ranking entry only ever shows its own clips", () => {
  const clips = [0, 1, 2].flatMap((b) => [
    { durationSeconds: 4, beatIndex: b, motion: 0.5 },
    { durationSeconds: 4, beatIndex: b, motion: 0.4 },
  ]);
  const seg = segments(true);
  const p = buildPlan(
    input({
      segments: seg,
      images: [0, 1, 2].map((b) => ({
        kind: "hero",
        aspect: 1.78,
        beatIndex: b,
      })),
      clips,
      footageFirst: true,
    }),
  );
  for (const s of p.shots) {
    if (s.media.type !== "clip" || seg[s.segment]!.kind !== "beat") continue;
    const beat = seg
      .slice(0, s.segment)
      .filter((x) => x.kind === "beat").length;
    assert.equal(clips[s.media.index]!.beatIndex, beat);
  }
});

const rubricOf = (
  p: ReturnType<typeof buildPlan>,
  over: Partial<Parameters<typeof scorePlan>[0]> = {},
) =>
  scorePlan({
    plan: p,
    segments: segments(),
    words: words(41),
    footageSeconds: 10,
    footageBudgetSeconds: 34,
    hookWords: 7,
    plateShareMax: 0.1,
    plateFirstSeconds: 5,
    ...over,
  });

test("the rubric goes red on any plate in the opening seconds", () => {
  const p = buildPlan(input({ images: [], clips: [] }));
  const m = rubricOf(p).metrics.find(
    (x) => x.name === "plate_opening_seconds",
  )!;
  assert.equal(m.grade, "red");
  assert.equal(m.value, 5);
  const ok = rubricOf(buildPlan(input({ footageFirst: true })));
  assert.equal(
    ok.metrics.find((x) => x.name === "plate_opening_seconds")!.grade,
    "green",
  );
  assert.equal(
    rubricOf(p, { plateFirstSeconds: 0 }).metrics.some(
      (x) => x.name === "plate_opening_seconds",
    ),
    false,
  );
});

test("the vision check no longer calls an empty panel deliberate", () => {
  assert.ok(!/deliberate choice/.test(VISION_PROMPT));
  assert.match(VISION_PROMPT, /empty screen/);
  assert.match(VISION_PROMPT, /last frame/);
  assert.match(VISION_PROMPT, /burned into a trailer/);
});

test("both ends of a Short are always judged", () => {
  const starts = Array.from({ length: 14 }, (_, i) => i * 4);
  const t = shortSampleTimes(starts, 60);
  assert.equal(t.length, 8);
  assert.equal(t[0], 0.8);
  assert.equal(t.at(-1), 59);
  assert.deepEqual(
    [...t].sort((a, b) => a - b),
    t,
  );
  assert.deepEqual(shortSampleTimes([0, 5, 10], 30), [0.8, 6.2, 11.2, 29]);
});

test("the fill takes clean, lit, moving moments away from those already used", () => {
  const c = (
    index: number,
    time: number,
    motion = 10,
    luma = 90,
    movie = 0,
  ) => ({
    index,
    movie,
    time,
    motion,
    luma,
  });
  const got = fillCandidates(
    [
      c(0, 10),
      c(1, 12, 30),
      c(2, 30, 20),
      c(3, 40, 40),
      c(4, 50, 50, 10),
      c(5, 60, 0.5),
      c(6, 12, 25, 90, 1),
    ],
    [{ movie: 0, time: 11 }],
    new Set([3]),
  );
  assert.deepEqual(
    got.map((x) => x.index),
    [6, 2],
  );
});

test("only big lettering inside the vertical crop counts as burned-in text", () => {
  const page = (words: Array<[string, number, number, number, number]>) => ({
    width: 960,
    height: 540,
    words: words.map(([text, x, y, w, h]) => ({ text, x, y, w, h })),
  });
  assert.deepEqual(bigWordsInCrop(page([["ULTIMATE", 350, 200, 300, 60]])), [
    "ULTIMATE",
  ]);
  // A HUD line: small.
  assert.deepEqual(bigWordsInCrop(page([["AMMO", 460, 500, 40, 12]])), []);
  // Big, but well outside what the crop keeps.
  assert.deepEqual(bigWordsInCrop(page([["TRAILER", 10, 200, 150, 60]])), []);
});

test("the longest clean run of a clip", () => {
  assert.deepEqual(longestCleanRun([false, false, false], 0.5, 1.5), {
    start: 0,
    length: 1.5,
  });
  const r = longestCleanRun([true, false, false, false, false, true], 0.5, 3);
  assert.equal(r.start, 0.6);
  assert.ok(Math.abs(r.length - 1.8) < 1e-9, String(r.length));
  assert.equal(longestCleanRun([true, true], 0.5, 1).length, 0);
});
// ---- Writer rules, labels, titles

test("a script admitting it has nothing is thin; one telling its story is not", () => {
  assert.equal(thinProblems("A name and little else.").length, 1);
  assert.equal(
    thinProblems("The record doesn't say why it moved on.").length,
    1,
  );
  assert.equal(thinProblems("We don't know the date yet.").length, 1);
  assert.equal(
    thinProblems("It ships in May, and your save carries over.").length,
    0,
  );
  assert.equal(thinProblems("A fine story.", "Only a name so far.").length, 1);
});

test("the ending is a statement with no advert", () => {
  assert.equal(endingProblems("Would you take that patch back?").length, 1);
  assert.equal(endingProblems("The next Why lands tomorrow.").length, 1);
  assert.equal(endingProblems("And that glide still works.").length, 0);
});

test("a Why with the rule on no longer has to point at tomorrow", () => {
  assert.equal(
    whyFollowProblems("The glide still works.", undefined, true).length,
    0,
  );
  assert.ok(
    whyFollowProblems("The glide still works.", undefined, false).length > 0,
  );
  // A real long video is still pointed to.
  assert.ok(
    whyFollowProblems(
      "The glide still works.",
      { kind: "documentary", title: "X", franchise: "Y" },
      true,
    ).length > 0,
  );
});

test("the argument test holds about half of news Shorts, stable, and no lists", () => {
  const cfg = { shortArgumentShare: 0.5 };
  const ids = Array.from({ length: 400 }, (_, i) => `ep_${i * 7919}`);
  const armed = ids.filter((id) =>
    argumentArm(cfg, { id, lane: "news" }),
  ).length;
  assert.ok(armed > 160 && armed < 240, String(armed));
  assert.equal(argumentArm(cfg, { id: "a", lane: "evergreen" }), false);
  assert.equal(
    argumentArm({ shortArgumentShare: 0 }, { id: "a", lane: "news" }),
    false,
  );
});

test("the rules the writer reads follow their settings", () => {
  const off = {
    shortStakeFirst: false,
    shortRefuseThin: false,
    shortEndPayoff: false,
    shortTightScript: false,
    shortArgumentShare: 0,
  };
  assert.equal(shortRuleNote(off, { id: "a", lane: "news" }), "");
  assert.equal(evergreenRuleNote(off), "");
  const on = shortRuleNote(
    { ...off, shortStakeFirst: true, shortEndPayoff: true },
    { id: "a", lane: "news" },
  );
  assert.match(on, /First line/);
  assert.match(on, /never a question/);
  assert.doesNotMatch(
    evergreenRuleNote({ ...off, shortStakeFirst: true }),
    /Do not pre-order/,
  );
});

const titleOf = (game_title: string, headline: string, n = 6) =>
  evergreenTitle({
    game_title,
    headline,
    evergreen_format: "ranking",
    entries: Array.from({ length: n }, () => ({})),
    youtube: { title: headline },
  } as never);

test("the title builder keeps its grammar", () => {
  assert.equal(
    titleOf("3D Super Mario games", "Mario's Best Worlds", 9),
    "Every 3D Super Mario Game Ranked Worst to Best",
  );
  assert.equal(
    titleOf("The Legend of Zelda", "Zelda's Best Adventures", 7),
    "7 Legend of Zelda Games Ranked Worst to Best",
  );
  assert.equal(
    titleOf("Street Fighter's six numbered games", "Who Wins", 6),
    "6 Street Fighter Games Ranked Worst to Best",
  );
  assert.equal(
    titleOf("Fallout", "Ranked Today", 6),
    "6 Fallout Games Ranked Worst to Best",
  );
  assert.equal(
    titleOf("Fallout", "Fallout Games Ranked Today", 6),
    "Fallout Games Ranked Worst to Best",
  );
});

test("our own work carries no CONFIRMED chip, and a chip only under a line that names it", () => {
  const base = input({
    attribution: "Pulse",
    steam: { price: "$59.99", prices: { usd: "$59.99" }, metacritic: 90 },
    images: [
      { kind: "capsule", aspect: 0.5 },
      { kind: "hero", aspect: 1.78 },
    ],
  });
  const before = buildPlan(base);
  assert.ok(before.shelf.some((x) => /CONFIRMED/.test(x.data.label ?? "")));
  assert.ok(before.shelf.some((x) => x.device === "stat"));
  const clean = buildPlan({
    ...base,
    noSourceChip: true,
    statsWhenSpoken: true,
  });
  assert.ok(!clean.shelf.some((x) => /CONFIRMED/.test(x.data.label ?? "")));
  assert.ok(
    !clean.shelf.some((x) => x.device === "stat"),
    "no line says the price",
  );
  const spoken = buildPlan({
    ...base,
    statsWhenSpoken: true,
    words: words(41).map((w, i) => (i === 20 ? { ...w, text: "dollars" } : w)),
  });
  const tile = spoken.shelf.filter((x) => x.device === "stat");
  assert.equal(tile.length, 1);
  assert.equal(tile[0]!.data.value, "$59.99");
});

test("brighter art is chosen only when asked", () => {
  const images: PlanInput["images"] = [
    { kind: "hero", aspect: 1.78, luma: 30 },
    { kind: "screenshot", aspect: 1.78, luma: 150 },
  ];
  assert.equal(pickHero(images), 0);
  assert.equal(pickHero(images, true), 1);
});

test("a tight cap is spent to the second and never passed", () => {
  const clips = [3.13, 4.17, 3.37, 4.4].map((durationSeconds) => ({ durationSeconds }));
  const kept = capFootage(clips, 10, 3.4, true);
  const total = kept.reduce((n, c) => n + c.durationSeconds, 0);
  assert.ok(total <= 10.001 && total >= 9.9, String(total));
  assert.equal(capFootage(clips, 10).length, 2);
  const p = buildPlan(input({ clips: kept, footageFirst: true }));
  const shown = p.shots
    .filter((s) => s.media.type === "clip")
    .reduce((n, s) => n + s.end - s.start, 0);
  assert.ok(shown / 30 <= 10.2, String(shown / 30));
});

test("a game's number is tried both ways", () => {
  assert.equal(numberVariant("Grand Theft Auto 6"), "Grand Theft Auto VI");
  assert.equal(numberVariant("Grand Theft Auto VI"), "Grand Theft Auto 6");
  assert.equal(numberVariant("Halo"), undefined);
});

test("a card's figure must be in the line it sits on", () => {
  const b = (narration: string, primary: string, kind = "stat") => ({ narration, visual: { kind, primary } });
  assert.equal(cardFigureProblems([b("And 40% plan extra purchases.", "40%")]).length, 0);
  assert.equal(cardFigureProblems([b("Sixteen missions run seven hours.", "16 missions")]).length, 0);
  assert.equal(cardFigureProblems([b("That's what players are reporting.", "~30GB")]).length, 1);
  assert.equal(cardFigureProblems([b("That's 23 games over 24 years.", "$40B")]).length, 1);
  assert.equal(cardFigureProblems([b("Any line.", "\"single-player\"", "quote")]).length, 0);
});

test("trailer frames only fill what published art leaves blank, under the ceiling", () => {
  assert.equal(framesNeeded(47, 10, 9, 6), 0);
  assert.equal(framesNeeded(47, 10, 1, 6), 6);
  assert.equal(framesNeeded(47, 10, 5, 6), 3);
  assert.equal(framesNeeded(47, 10, 1, 0), 0);
});

test("a trailer frame comes last, once, never twice in a row and never as the hero", () => {
  const images: PlanInput["images"] = [
    { kind: "hero", aspect: 1.78 },
    { kind: "screenshot", aspect: 1.78 },
    ...[0, 1, 2, 3, 4, 5].map(() => ({ kind: "screenshot", aspect: 1.78, frame: true })),
  ];
  const p = buildPlan(
    input({ images, clips: [{ durationSeconds: 5, role: "hook", motion: 0.9 }, { durationSeconds: 5, motion: 0.5 }], footageFirst: true }),
  );
  const seen = new Map<number, number>();
  let prevFrame = false;
  for (const s of p.shots) {
    const isFrame = s.media.type === "image" && !!images[s.media.index]!.frame;
    assert.ok(!(isFrame && prevFrame), `two frames in a row at ${s.start}`);
    if (isFrame) seen.set(s.media.index, (seen.get(s.media.index) ?? 0) + 1);
    prevFrame = isFrame;
  }
  assert.ok(![...seen.values()].some((n) => n > 2));
  assert.ok(!images[p.heroIndex]!.frame);
});

test("CONFIRMED only for what an official source states; estimates and reports say so", () => {
  assert.equal(sourceTag("GTA 6 pre-orders estimated past $750 million", true), "ESTIMATE");
  assert.equal(sourceTag("Sensor Tower puts it at $750 million", false), "ESTIMATE");
  assert.equal(sourceTag("Bethesda names The Elder Scrolls VI", false), "REPORTED");
  assert.equal(sourceTag("It reportedly slips to May", true), "REPORTED");
  assert.equal(sourceTag("Sony moves God of War to May 2027", true), "CONFIRMED");
  const plan = buildPlan(input({ attribution: "IGN", sourceTag: "ESTIMATE" }));
  assert.ok(plan.shelf.some((x) => x.data.label === "ESTIMATE · IGN"));
  assert.ok(!plan.shelf.some((x) => /CONFIRMED/.test(x.data.label ?? "")));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPlan,
  planCuts,
  MIN_SHOT,
  MAX_SHOT,
  STING_FRAMES,
  MAX_SFX,
  type PlanInput,
} from "../src/render/plan.ts";
import type { Segment } from "../src/render/timeline.ts";

function narration(): {
  segments: Segment[];
  words: Array<{ text: string; start: number; end: number }>;
  duration: number;
} {
  const texts: Array<[Segment["kind"], string, Segment["visual"]]> = [
    [
      "hook",
      "Starfield's first expansion has slipped to early twenty twenty seven and that changes the plan.",
      undefined,
    ],
    [
      "beat",
      "Bethesda now says the expansion lands in early twenty twenty seven, three months later than planned.",
      { kind: "stat", primary: "3+ MONTHS", secondary: "later than planned" },
    ],
    [
      "beat",
      "The studio blames polish on the new star systems and a bigger ship interior overhaul.",
      { kind: "list", primary: "New systems | Ship interiors", secondary: "" },
    ],
    [
      "beat",
      "Players on Steam have been patient before and the numbers are still steady.",
      { kind: "date", primary: "EARLY 2027", secondary: "new window" },
    ],
    [
      "take",
      "Our read: a slip this small on a project this big is not a red flag yet.",
      { kind: "title", primary: "Not a red flag yet", secondary: "" },
    ],
    [
      "loop",
      "And the new date to remember is early twenty twenty seven.",
      undefined,
    ],
  ];
  const words: Array<{ text: string; start: number; end: number }> = [];
  const segments: Segment[] = [];
  let t = 0;
  for (const [kind, text, visual] of texts) {
    const start = t;
    for (const w of text.split(/\s+/)) {
      const dur = 0.28 + (w.length % 3) * 0.05;
      words.push({ text: w, start: t, end: t + dur });
      t += dur + 0.06;
    }
    t += 0.3; // breath between segments
    segments.push({
      kind,
      text,
      start,
      end: t,
      visual,
      label: kind === "take" ? "OUR READ" : undefined,
    });
  }
  const duration = t + 1.0;
  segments[segments.length - 1]!.end = duration;
  return { segments, words, duration };
}

function input(over: Partial<PlanInput> = {}): PlanInput {
  const n = narration();
  return {
    segments: n.segments,
    words: n.words,
    durationSeconds: n.duration,
    images: [
      { kind: "hero", aspect: 3.1 },
      { kind: "capsule", aspect: 0.667 },
      { kind: "screenshot", aspect: 1.778 },
      { kind: "screenshot", aspect: 1.778 },
    ],
    clips: [
      { durationSeconds: 4.8, motion: 0.9 },
      { durationSeconds: 4.8, motion: 0.3 },
    ],
    storyType: "delay",
    isRumour: false,
    attribution: "Source: Bethesda / IGN",
    variant: 1,
    steam: {
      currentPlayers: 4088,
      positivePercent: 72,
      totalReviews: 180000,
      price: "£39.99",
    },
    ...over,
  };
}

test("cuts respect the sting, segment starts and the 45-130 frame bounds", () => {
  const i = input();
  const total = Math.ceil(i.durationSeconds * 30);
  const cuts = planCuts(i.segments, i.words, total);
  assert.equal(cuts[0]!.start, 0);
  assert.equal(cuts[0]!.end, STING_FRAMES, "the opening sting is its own shot");
  for (const c of cuts.slice(1)) {
    assert.ok(
      c.end - c.start >= MIN_SHOT,
      `shot ${c.start}-${c.end} is shorter than ${MIN_SHOT}`,
    );
    assert.ok(
      c.end - c.start <= MAX_SHOT,
      `shot ${c.start}-${c.end} is longer than ${MAX_SHOT}`,
    );
  }
  for (let k = 1; k < cuts.length; k++)
    assert.equal(cuts[k]!.start, cuts[k - 1]!.end, "shots tile the timeline");
  assert.equal(cuts.at(-1)!.end, total);
  for (const [si, s] of i.segments.entries()) {
    if (si === 0) continue;
    assert.ok(
      cuts.some((c) => c.start === Math.round(s.start * 30)),
      `a cut lands on segment ${si} start`,
    );
  }
});

test("intra-segment cuts land on word ends", () => {
  const i = input();
  const total = Math.ceil(i.durationSeconds * 30);
  const cuts = planCuts(i.segments, i.words, total);
  const ends = new Set(i.words.map((w) => Math.round(w.end * 30)));
  const segStarts = new Set(i.segments.map((s) => Math.round(s.start * 30)));
  const inner = cuts.filter(
    (c) => c.start !== 0 && c.start !== STING_FRAMES && !segStarts.has(c.start),
  );
  assert.ok(inner.length >= 2, "long segments are split");
  for (const c of inner)
    assert.ok(ends.has(c.start), `cut at ${c.start} is not on a word end`);
});

test("shots open and close on the hero still, never repeat an asset back to back, and keep clips inside their length", () => {
  const i = input();
  const plan = buildPlan(i);
  assert.equal(
    plan.heroIndex,
    2,
    "a 16:9 screenshot is the hero over the 3.1:1 strip",
  );
  assert.deepEqual(plan.shots[0]!.media, { type: "image", index: 2 });
  assert.deepEqual(plan.shots.at(-1)!.media, { type: "image", index: 2 });
  assert.equal(plan.shots.at(-1)!.move, "settle");
  for (let k = 1; k < plan.shots.length; k++) {
    const a = plan.shots[k - 1]!.media;
    const b = plan.shots[k]!.media;
    const closing =
      plan.shots[k]!.segment === i.segments.length - 1 ||
      i.segments[plan.shots[k]!.segment]!.kind === "take";
    if (!closing)
      assert.ok(
        !(a.type === b.type && a.index === b.index),
        `shot ${k} repeats shot ${k - 1}`,
      );
  }
  const clipShots = plan.shots.filter((s) => s.media.type === "clip");
  assert.ok(clipShots.length >= 1, "trailer clips are used");
  for (const s of clipShots)
    assert.ok(
      s.end - s.start <= 4.8 * 30,
      "a clip shot never outlasts its clip",
    );
  const seen = new Set<number>();
  for (const s of clipShots) {
    assert.ok(!seen.has(s.media.index), "each clip is used once");
    seen.add(s.media.index);
  }
  assert.equal(
    plan.shots[1]!.media.type,
    "clip",
    "the first cut after the sting is the liveliest clip",
  );
  assert.equal(plan.shots[1]!.media.index, 0);
});

test("quiet beats sit on framed stills and the plan is identical for identical input", () => {
  const i = input();
  const plan = buildPlan(i);
  const statShots = plan.shots.filter(
    (s) => i.segments[s.segment]!.visual?.kind === "stat",
  );
  assert.ok(statShots.length > 0);
  assert.ok(
    statShots.every((s) => s.framed),
    "number cards get a framed, calm background",
  );
  assert.deepEqual(buildPlan(input()), plan);
});

test("no media at all produces brand-plate shots, not an empty frame", () => {
  const plan = buildPlan(input({ images: [], clips: [] }));
  assert.ok(plan.shots.length > 0);
  assert.ok(plan.shots.every((s) => s.media.type === "plate"));
  assert.equal(plan.heroIndex, -1);
});

test("turns, sound cues and the shelf follow the structure", () => {
  const i = input();
  const plan = buildPlan(i);
  const hook = i.segments[0]!;
  const take = i.segments.find((s) => s.kind === "take")!;
  assert.deepEqual(plan.turns, [
    Math.round(hook.end * 30),
    Math.round(take.start * 30),
  ]);
  assert.ok(plan.sfx.length <= MAX_SFX);
  assert.equal(plan.sfx[0]!.file, "sfx/sting.mp3");
  assert.equal(plan.sfx.at(-1)!.frame, plan.totalFrames - STING_FRAMES);
  assert.ok(plan.sfx.some((c) => c.file === "sfx/riser-fast.mp3"));
  assert.ok(
    plan.shelf.length <= i.segments.length,
    "at most one shelf device per segment",
  );
  assert.equal(plan.shelf[0]!.from, 0);
  assert.equal(plan.shelf.at(-1)!.to, plan.totalFrames);
  for (let k = 1; k < plan.shelf.length; k++)
    assert.equal(
      plan.shelf[k]!.from,
      plan.shelf[k - 1]!.to,
      "the shelf is never empty",
    );
  const bare = buildPlan(
    input({ steam: null, images: [{ kind: "screenshot", aspect: 1.778 }] }),
  );
  assert.ok(
    bare.shelf.every((x) => x.device === "source"),
    "with no data the source chip stays rather than an empty shelf",
  );
  assert.equal(bare.shelf.length, 1, "consecutive source chips merge into one");
  assert.equal(plan.shelf[0]!.device, "source");
  assert.equal(plan.shelf[0]!.data.label, "CONFIRMED · BETHESDA / IGN");
  for (let k = 1; k < plan.shelf.length; k++)
    assert.notEqual(
      plan.shelf[k]!.device,
      plan.shelf[k - 1]!.device,
      "never the same device twice in a row",
    );
  assert.ok(
    plan.shelf.some((s) => s.device === "live" && s.data.value === "4,088"),
  );
  const rumour = buildPlan(input({ isRumour: true }));
  assert.equal(rumour.shelf[0]!.data.label, "RUMOUR · UNCONFIRMED");
});

test("beat-matched clips land under their own line, the hook clip opens, and nothing borrows another line's moment", () => {
  const i = input({
    clips: [
      { durationSeconds: 4.8, motion: 0.9, role: "hook" },
      { durationSeconds: 4.8, motion: 0.2, beatIndex: 0 },
      { durationSeconds: 4.8, motion: 0.6, beatIndex: 2 },
    ],
  });
  const plan = buildPlan(i);
  const beats = i.segments.map((s, n) => ({ s, n })).filter((x) => x.s.kind === "beat");
  const underBeat = (b: number) => plan.shots.filter((s) => s.segment === beats[b]!.n && s.media.type === "clip").map((s) => s.media.index);
  assert.deepEqual(plan.shots[1]!.media, { type: "clip", index: 0, trimFrom: 0 }, "the hook clip follows the sting");
  assert.ok(underBeat(0).includes(1), "beat 0 shows the clip chosen for it (framed under its number card)");
  assert.ok(plan.shots.filter((s) => s.segment === beats[0]!.n && s.media.type === "clip" && s.media.index === 1).every((s) => s.framed));
  assert.ok(underBeat(2).includes(2), "beat 2 shows the clip chosen for it");
  assert.ok(!underBeat(1).includes(2) && !underBeat(1).includes(1), "beat 1 never borrows another line's moment");
});

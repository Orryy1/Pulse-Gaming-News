import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPlan,
  pickHero,
  planCuts,
  MIN_SHOT,
  MAX_SHOT,
  maxShotFor,
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
    const limit = maxShotFor(i.segments[c.segment]!.kind);
    assert.ok(
      c.end - c.start <= limit,
      `shot ${c.start}-${c.end} is longer than ${limit}`,
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
  assert.equal(plan.sfx[0]!.file, "sfx/v3/sting.mp3");
  assert.equal(
    plan.sfx.at(-1)!.frame,
    plan.totalFrames - 60,
    "the closing sting rings out before the end",
  );
  assert.ok(
    plan.sfx.some((c) => c.file === "sfx/v3/swell.mp3"),
    "a swell into the verdict",
  );
  for (let k = 1; k < plan.sfx.length; k++)
    assert.ok(
      plan.sfx[k]!.frame - plan.sfx[k - 1]!.frame >= 75,
      "never two sounds within 2.5 s",
    );
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
  assert.equal(rumour.shelf[0]!.data.label, "RUMOR · UNCONFIRMED");
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
  const beats = i.segments
    .map((s, n) => ({ s, n }))
    .filter((x) => x.s.kind === "beat");
  const underBeat = (b: number) =>
    plan.shots
      .filter((s) => s.segment === beats[b]!.n && s.media.type === "clip")
      .map((s) => s.media.index);
  assert.deepEqual(
    plan.shots[1]!.media,
    { type: "clip", index: 0, trimFrom: 0 },
    "the hook clip follows the sting",
  );
  assert.ok(
    underBeat(0).includes(1),
    "beat 0 shows the clip chosen for it (framed under its number card)",
  );
  assert.ok(
    plan.shots
      .filter(
        (s) =>
          s.segment === beats[0]!.n &&
          s.media.type === "clip" &&
          s.media.index === 1,
      )
      .every((s) => s.framed),
  );
  assert.ok(underBeat(2).includes(2), "beat 2 shows the clip chosen for it");
  assert.ok(
    !underBeat(1).includes(2) && !underBeat(1).includes(1),
    "beat 1 never borrows another line's moment",
  );
});

test("a long take does not sit on the hero still shot after shot; the hero opens it and returns for the loop", () => {
  const i = input();
  // Stretch the take to ~14 s so it spans several shots.
  const take = i.segments.find((s) => s.kind === "take")!;
  const loop = i.segments.find((s) => s.kind === "loop")!;
  const extra = 10;
  take.end += extra;
  loop.start += extra;
  loop.end += extra;
  i.words = i.words.map((w) =>
    w.start >= loop.start - extra
      ? { ...w, start: w.start + extra, end: w.end + extra }
      : w,
  );
  i.durationSeconds += extra;
  const plan = buildPlan(i);
  const takeIndex = i.segments.indexOf(take);
  const takeShots = plan.shots.filter((s) => s.segment === takeIndex);
  assert.ok(takeShots.length >= 3, `take has ${takeShots.length} shots`);
  assert.deepEqual(
    takeShots[0]!.media,
    { type: "image", index: plan.heroIndex },
    "the take opens on the hero",
  );
  assert.ok(
    takeShots
      .slice(1)
      .some(
        (s) => !(s.media.type === "image" && s.media.index === plan.heroIndex),
      ),
    "later take shots use other media",
  );
  assert.deepEqual(
    plan.shots.at(-1)!.media,
    { type: "image", index: plan.heroIndex },
    "the loop returns to the hero",
  );
});

test("the shelf never puts a Steam number under a card that already shows a number", () => {
  const plan = buildPlan(input());
  const numeric = new Set([
    "stat",
    "date",
    "timeline",
    "compare",
    "countdown",
    "price",
    "score",
  ]);
  for (const item of plan.shelf) {
    const seg = input().segments[item.segment]!;
    if (seg.kind === "beat" && numeric.has(seg.visual?.kind ?? "none"))
      assert.ok(
        item.device !== "stat" && item.device !== "live",
        `beat with a ${seg.visual?.kind} card got a ${item.device} tile`,
      );
  }
  const chip = buildPlan(
    input({
      attribution: "Source: Steam / Insider Gaming / Nintendo Life / IGN",
    }),
  ).shelf[0]!;
  assert.equal(chip.data.label, "CONFIRMED · STEAM / INSIDER GAMING +2");
});

test("a clip shorter than its shot is still used: the shot ends with the clip and the rest becomes its own shot", () => {
  const i = input({
    clips: [
      { durationSeconds: 4.8, motion: 0.9, role: "hook" },
      { durationSeconds: 2.4, motion: 0.6, beatIndex: 2 },
    ],
  });
  const plan = buildPlan(i);
  const beats = i.segments
    .map((s, n) => ({ s, n }))
    .filter((x) => x.s.kind === "beat");
  const short = plan.shots.find(
    (s) => s.media.type === "clip" && s.media.index === 1,
  );
  assert.ok(short, "the 2.4 s clip is used under beat 2");
  assert.equal(short!.segment, beats[2]!.n);
  assert.ok(
    short!.end - short!.start <= 2.4 * 30 + 6,
    "the shot ends where the clip ends",
  );
  for (const s of plan.shots)
    assert.ok(
      s.end - s.start >= 45 || s.start === 0,
      `shot at ${s.start} is ${s.end - s.start} frames`,
    );
  for (let k = 1; k < plan.shots.length; k++)
    assert.equal(
      plan.shots[k]!.start,
      plan.shots[k - 1]!.end,
      "shots stay contiguous",
    );
  assert.equal(plan.shots.at(-1)!.end, Math.ceil(i.durationSeconds * 30));
});

test("a ranking entry only ever shows its own art or moment, never the hero or another entry's", () => {
  const base = input();
  const segments = base.segments.map((s) =>
    s.kind === "beat"
      ? {
          ...s,
          visual: {
            kind: "rank" as const,
            primary: "Game",
            secondary: "Verdict",
            value_a: 1,
          },
        }
      : s,
  );
  const i = input({
    segments,
    images: [
      { kind: "hero", aspect: 1.778 },
      { kind: "screenshot", aspect: 1.778 },
      { kind: "capsule", aspect: 0.667, beatIndex: 0 },
      { kind: "capsule", aspect: 0.667, beatIndex: 2 },
    ],
    clips: [
      { durationSeconds: 4.8, motion: 0.9, role: "hook" },
      { durationSeconds: 2.4, motion: 0.6, beatIndex: 1 },
    ],
  });
  const plan = buildPlan(i);
  const beatSegs = segments
    .map((s, n) => ({ s, n }))
    .filter((x) => x.s.kind === "beat");
  for (const [b, { n }] of beatSegs.entries()) {
    for (const shot of plan.shots.filter((s) => s.segment === n)) {
      if (shot.media.type === "image")
        assert.equal(
          i.images[shot.media.index]!.beatIndex,
          b,
          `entry ${b} shows image ${shot.media.index}`,
        );
      if (shot.media.type === "clip")
        assert.equal(
          i.clips[shot.media.index]!.beatIndex,
          b,
          `entry ${b} shows clip ${shot.media.index}`,
        );
    }
  }
  const noArt = plan.shots.filter((s) => s.segment === beatSegs[1]!.n);
  assert.ok(
    noArt.some((s) => s.media.type === "clip") ||
      noArt.every((s) => s.media.type === "plate"),
    "entry 1 uses its clip, then the plate",
  );
  for (const item of plan.shelf) {
    const seg = segments[item.segment]!;
    if (seg.kind === "beat")
      assert.ok(
        !["stat", "live", "gamecard"].includes(item.device),
        `rank entry got a ${item.device} tile`,
      );
  }
  // An entry with one piece of art holds it as one longer shot rather than cutting to itself.
  for (let k = 1; k < plan.shots.length; k++) {
    const a = plan.shots[k - 1]!;
    const b = plan.shots[k]!;
    if (a.segment === b.segment && segments[b.segment]!.kind === "beat")
      assert.ok(
        !(a.media.type === b.media.type && a.media.index === b.media.index),
        `shot ${k} repeats its neighbour inside an entry`,
      );
  }
  for (let k = 1; k < plan.shots.length; k++)
    assert.equal(
      plan.shots[k]!.start,
      plan.shots[k - 1]!.end,
      "shots stay contiguous after merging",
    );
  assert.equal(
    plan.heroIndex,
    0,
    "the topic's own 16:9 art is the hero, not an entry's",
  );
  const takeSeg = segments.findIndex((s) => s.kind === "take");
  const winner = beatSegs.length - 1;
  for (const shot of plan.shots.filter((s) => s.segment === takeSeg)) {
    if (shot.media.type === "image")
      assert.equal(
        i.images[shot.media.index]!.beatIndex,
        winner,
        "the pick shows the winner's art",
      );
    if (shot.media.type === "clip")
      assert.equal(
        i.clips[shot.media.index]!.beatIndex,
        winner,
        "the pick shows the winner's moment",
      );
  }
  assert.ok(
    plan.shots
      .filter((s) => s.segment === takeSeg)
      .some((s) => s.media.type === "image"),
    "the winner's art appears in the pick",
  );
  for (const item of plan.shelf)
    assert.ok(
      !["stat", "live", "gamecard"].includes(item.device),
      `a ranking never shows a topic tile (${item.device})`,
    );
});

test("the hero is never one ranking entry's art while the topic has its own", () => {
  assert.equal(
    pickHero([
      { kind: "hero", aspect: 1.778, beatIndex: 3 },
      { kind: "hero", aspect: 3.1 },
      { kind: "capsule", aspect: 0.667 },
    ]),
    2,
  );
  assert.equal(
    pickHero([
      { kind: "hero", aspect: 1.778, beatIndex: 3 },
      { kind: "capsule", aspect: 0.667, beatIndex: 1 },
    ]),
    0,
    "with only entry art the first 16:9 one will do",
  );
});

test("the opening still skips wide art with lettering when a clean one exists (QA notes, 26 Oct 2026)", () => {
  assert.equal(
    pickHero([
      { kind: "article", aspect: 1.778, wordy: true },
      { kind: "screenshot", aspect: 1.778 },
    ]),
    1,
  );
  assert.equal(
    pickHero([
      { kind: "article", aspect: 1.778, wordy: true },
      { kind: "capsule", aspect: 0.667 },
    ]),
    0,
    "lettered wide art still beats no wide art",
  );
});

test("a ranking entry opens on its clean art; box art with the printed logo only comes after", () => {
  const base = input();
  const segments = base.segments.map((s) =>
    s.kind === "beat"
      ? {
          ...s,
          visual: {
            kind: "rank" as const,
            primary: "Game",
            secondary: "Verdict",
            value_a: 1,
          },
        }
      : s,
  );
  const i = input({
    segments,
    images: [
      { kind: "hero", aspect: 1.778 },
      { kind: "capsule", aspect: 0.667, beatIndex: 0 },
      { kind: "header", aspect: 2.14, beatIndex: 0 },
      { kind: "hero", aspect: 3.1, beatIndex: 0 },
      { kind: "screenshot", aspect: 1.778, beatIndex: 0 },
    ],
    clips: [],
  });
  const plan = buildPlan(i);
  const firstBeat = segments.findIndex((s) => s.kind === "beat");
  const shots = plan.shots.filter(
    (s) => s.segment === firstBeat && s.media.type === "image",
  );
  assert.ok(shots.length > 0);
  const kinds = shots.map(
    (s) => i.images[(s.media as { index: number }).index]!.kind,
  );
  assert.ok(
    !["capsule", "header"].includes(kinds[0]!),
    `entry opened on ${kinds[0]}`,
  );
  const firstLogo = kinds.findIndex((k) => k === "capsule" || k === "header");
  if (firstLogo >= 0)
    assert.ok(
      kinds.slice(0, firstLogo).length >= 2,
      "clean art is used up before logo art",
    );
});

test("with openOnClip the Short opens on the hook's moving clip; without one it falls back to the hero still", () => {
  const withClip = input({
    images: [
      { kind: "hero", aspect: 1.778 },
      { kind: "screenshot", aspect: 1.778 },
    ],
    clips: [
      { durationSeconds: 4.8, motion: 0.9, role: "hook" },
      { durationSeconds: 4.8, motion: 0.5 },
    ],
    openOnClip: true,
  });
  const a = buildPlan(withClip);
  assert.equal(a.shots[0]!.media.type, "clip", "opens on motion");
  assert.equal(withClip.clips[a.shots[0]!.media.index]!.role, "hook");
  const b = buildPlan({ ...withClip, clips: [] });
  assert.deepEqual(
    b.shots[0]!.media,
    { type: "image", index: b.heroIndex },
    "no clip: the hero still opens",
  );
  const c = buildPlan({ ...withClip, openOnClip: false });
  assert.deepEqual(
    c.shots[0]!.media,
    { type: "image", index: c.heroIndex },
    "switched off: the hero still opens",
  );
});

test("prices the voice says in words are shown as prices again", async () => {
  const { displayWords } = await import("../src/render/timeline.ts");
  const show = (t: string) =>
    displayWords(
      t.split(" ").map((text, i) => ({ text, start: i, end: i + 1 })),
    )
      .map((w) => w.text)
      .join(" ");
  assert.equal(
    show("hits October 21 at forty-nine dollars ninety-nine. The title"),
    "hits October 21 at $49.99. The title",
  );
  assert.equal(
    show("down to two dollars forty-nine, a steal"),
    "down to $2.49, a steal",
  );
  assert.equal(
    show("a one point five billion dollars deal"),
    "a $1.5 billion deal",
  );
  assert.equal(
    show(
      "it costs one thousand two hundred ninety-nine dollars ninety-nine today",
    ),
    "it costs $1,299.99 today",
  );
  assert.equal(
    show("only seventy dollars for twenty games"),
    "only $70 for 20 games",
  );
  assert.equal(
    show("fifty-nine pounds ninety-nine in the UK"),
    "£59.99 in the UK",
  );
  assert.equal(
    show("twenty million copies in twenty sixteen"),
    "20 million copies in 2016",
    "round millions read as figures, years as years",
  );
  assert.equal(
    show("only twenty games"),
    "only 20 games",
    "10 and up are figures (28 Oct 2026); one to nine stay words",
  );
  assert.equal(
    show("Majora's Mask, two thousand. Its clock"),
    "Majora's Mask, 2000. Its clock",
  );
  assert.equal(
    show("released in two thousand on the N64"),
    "released in 2000 on the N64",
  );
  assert.equal(
    show("two thousand players joined"),
    "2,000 players joined",
    "a count reads as a figure, not a year",
  );
  assert.equal(
    show("two thousand five hundred players"),
    "2,500 players",
    "a count, not the year 2005",
  );
  assert.equal(show("in two thousand seven, the Wii"), "in 2007, the Wii");
  const merged = displayWords(
    "at forty-nine dollars ninety-nine now"
      .split(" ")
      .map((text, i) => ({ text, start: i, end: i + 1 })),
  );
  assert.deepEqual(
    merged[1],
    { text: "$49.99", start: 1, end: 4 },
    "the caption lights for the whole spoken price",
  );
});

test("game sound sits under the narrator and fades at each cut", async () => {
  const { gameSoundVolume, GAME_SOUND_VOLUME } =
    await import("../src/render/longplan.ts");
  assert.equal(gameSoundVolume(0, 120), 0, "silent on the cut");
  assert.equal(
    gameSoundVolume(60, 120),
    GAME_SOUND_VOLUME,
    "full (low) level mid-shot",
  );
  assert.equal(gameSoundVolume(120, 120), 0, "silent at the next cut");
  assert.ok(GAME_SOUND_VOLUME <= 0.2, "never competes with the voice");
});

test("long-video moment sounds are spaced out and keep clear of each entry's swell and landing", async () => {
  const { gateLongSounds } = await import("../src/render/soundscape.ts");
  const fps = 30;
  const cands = [
    { key: 0, frame: 100, kind: "glint" as const },
    { key: 1, frame: 160, kind: "glint" as const }, // 2 s after the last: too soon
    { key: 2, frame: 400, kind: "pop" as const },
    { key: 3, frame: 610, kind: "glint" as const }, // inside the entry change at 600
    { key: 4, frame: 900, kind: "glint" as const },
    { key: 5, frame: 1100, kind: "pop" as const }, // 23 s after the last pop, 6.7 s after any sound: fine
  ];
  const out = gateLongSounds(cands, [600], fps);
  assert.deepEqual(
    [...out.keys()].sort((a, b) => a - b),
    [0, 2, 4, 5],
  );
  assert.notEqual(out.get(2), out.get(5), "whoosh variants rotate");
  // The delay card's stamp lands on the low hit, and two stamps never come within 20 s.
  const stamps = gateLongSounds(
    [
      { key: 0, frame: 100, kind: "stamp" as const },
      { key: 1, frame: 500, kind: "stamp" as const },
      { key: 2, frame: 800, kind: "stamp" as const },
    ],
    [],
    fps,
  );
  assert.deepEqual([...stamps.keys()], [0, 2]);
  assert.match(stamps.get(0)!, /land/);
  // The retro kit's sounds claim their moment first: a glint 2 s before an old TV switching on gives way,
  // and the TV still keeps clear of the entry change.
  const retro = gateLongSounds(
    [
      { key: 0, frame: 100, kind: "glint" as const },
      { key: 1, frame: 160, kind: "tvon" as const },
      { key: 2, frame: 610, kind: "vhs" as const },
      { key: 3, frame: 900, kind: "static" as const },
    ],
    [600],
    fps,
  );
  assert.deepEqual(
    [...retro.keys()].sort((a, b) => a - b),
    [1, 3],
  );
  assert.equal(retro.get(1), "retro/tvon");
  assert.equal(retro.get(3), "retro/static");
});

test("a corner credit's fades always form a strictly increasing range, however short the shot", async () => {
  const { creditFade } = await import("../src/render/motion.ts");
  for (let d = 0; d <= 40; d++) {
    const f = creditFade(d);
    if (f < 1) continue;
    const range = [0, f, d - f, d];
    for (let k = 1; k < range.length; k++)
      assert.ok(range[k]! > range[k - 1]!, `shot of ${d} frames: ${range}`);
  }
  assert.equal(
    creditFade(12),
    5,
    "the 12-frame shot that crashed renders now fades over 5 frames",
  );
  assert.equal(creditFade(60), 8);
});

test("the spoken caption word never grows across the gap to the next word", async () => {
  const { captionGrow } = await import("../src/render/motion.ts");
  const font = 80;
  for (const letters of [2, 5, 8, 12, 16]) {
    const width = letters * font * 0.66;
    const perSide = (width * (captionGrow(letters, font) - 1)) / 2;
    assert.ok(
      perSide <= 9.5,
      `${letters} letters grow ${perSide.toFixed(1)} px a side`,
    );
  }
  assert.equal(captionGrow(2, font), 1.06, "short words keep the full pop");
});

test("the closing line does not repeat the hero still cut after cut; only the last shot returns to it", () => {
  const base = input({
    images: Array.from({ length: 8 }, (_, k) => ({
      kind: k === 0 ? "hero" : "screenshot",
      aspect: 1.778,
    })) as PlanInput["images"],
  });
  // A long closing line so it needs several cuts.
  const segs = base.segments.map((s) => ({ ...s }));
  const loop = segs.at(-1)!;
  loop.end = loop.start + 9;
  const plan = buildPlan({
    ...base,
    segments: segs,
    durationSeconds: loop.end,
  });
  const closing = plan.shots.filter((s) => segs[s.segment]?.kind === "loop");
  const last = plan.shots.at(-1)!;
  assert.ok(
    closing.length >= 2,
    `the closing line has ${closing.length} shots`,
  );
  for (let k = 1; k < plan.shots.length; k++) {
    const a = plan.shots[k - 1]!.media,
      b = plan.shots[k]!.media;
    if (a.type === "image" && b.type === "image")
      assert.notEqual(
        a.index,
        b.index,
        `shots ${k - 1} and ${k} show the same still`,
      );
  }
  assert.equal(last.media.type, "image", "the Short ends on a still");
});

test("a render waits for memory while another program holds it, then goes anyway after the limit", async () => {
  const { waitForHeadroom } = await import("../src/render/render.ts");
  const GB = 1024 ** 3;
  let t = 0;
  const sleep = async (ms: number) => {
    t += ms;
  };
  // Room frees up after 90 s: it waits that long and no longer.
  const waited = await waitForHeadroom(
    () => (t < 90_000 ? 3 * GB : 10 * GB),
    sleep,
    () => t,
  );
  assert.equal(waited, 90_000);
  // Never frees up: it stops waiting at 20 minutes.
  t = 0;
  assert.equal(
    await waitForHeadroom(
      () => 2 * GB,
      sleep,
      () => t,
    ),
    20 * 60_000,
  );
  // Plenty of room: no wait at all.
  t = 0;
  assert.equal(
    await waitForHeadroom(
      () => 12 * GB,
      sleep,
      () => t,
    ),
    0,
  );
});

test("a moving opening runs straight through the sting; a still one cuts to motion at 0.4 s", async () => {
  const { planCuts, STING_FRAMES } = await import("../src/render/plan.ts");
  const segments = [
    { kind: "hook", text: "x", start: 0, end: 3 },
    { kind: "beat", text: "y", start: 3, end: 10 },
  ] as never;
  const still = planCuts(segments, [], 300);
  const moving = planCuts(segments, [], 300, true);
  assert.equal(still[0]!.end, STING_FRAMES);
  assert.ok(
    moving[0]!.end > STING_FRAMES + 30,
    `first shot ends at frame ${moving[0]!.end}`,
  );
});

test("an old game opens on the hardware of its platform and era", async () => {
  const { deviceFor } = await import("../src/render/retroplan.ts");
  assert.equal(deviceFor(2004, "Game Boy Advance", 0), "handheld");
  assert.equal(deviceFor(2005, "Nintendo DS", 0), "handheld");
  assert.equal(deviceFor(1991, "SNES", 0), "tv"); // a home console plays on a TV, however old
  assert.equal(deviceFor(1998, "Arcade, PS1", 0), "arcade");
  assert.equal(deviceFor(1999, "PC", 0), "monitor");
  assert.equal(deviceFor(2004, "PS2, Xbox", 0), "tv");
  assert.equal(deviceFor(2004, "PS2, Xbox", 1), "vcr");
  // "DS" only as a word: not inside another platform's name.
  assert.equal(deviceFor(2001, "Windows, PS2", 0), "monitor");
});

test("the graphics check reads which frames a problem names", async () => {
  const { framesNamed } = await import("../src/qa/vision.ts");
  assert.deepEqual(
    framesNamed([
      "Frame 3: heading cut off",
      "Frames 5 and 7: text overlaps",
      "frame 2, 4: misspelt",
    ]).sort(),
    [2, 3, 4, 5, 7],
  );
  assert.deepEqual(framesNamed(["looks fine"]), []);
  // A cross-reference inside a problem is not a fault of that frame (tonight's real lines, 30 Oct 2026).
  assert.deepEqual(
    framesNamed([
      'Frame 4: Quote is attributed to "Sam Houser" while Frame 2 names Dan Houser as Rockstar Producer.',
      "Frame 4: The rank badge reads #9, but Frame 6 and Frame 8 show Halo 5 as #8.",
    ]),
    [4],
  );
  // With no leading frame, every frame named still counts.
  assert.deepEqual(
    framesNamed(["Text overlaps in frames 3 and 5"]).sort(),
    [3, 5],
  );
});

test("a picture's own colour is its strongest vivid hue, and a grey picture has none", async () => {
  const { dominantVivid } = await import("../src/assets/palette.ts");
  const px = (r: number, g: number, b: number, n: number) =>
    Array.from({ length: n }, () => [r, g, b]).flat();
  const red = dominantVivid(
    new Uint8Array([
      ...px(200, 40, 30, 300),
      ...px(40, 40, 200, 60),
      ...px(90, 90, 90, 200),
    ]),
  )!;
  assert.match(red, /^#[0-9a-f]{6}$/);
  assert.ok(
    parseInt(red.slice(1, 3), 16) > parseInt(red.slice(5, 7), 16),
    "red wins",
  );
  assert.equal(
    dominantVivid(new Uint8Array(px(120, 120, 120, 500))),
    undefined,
  );
});

test("spoken years keep their possessive and decades as figures in captions", async () => {
  const { displayWords } = await import("../src/render/timeline.ts");
  const show = (t: string) =>
    displayWords(
      t.split(" ").map((text, i) => ({ text, start: i, end: i + 1 })),
    )
      .map((w) => w.text)
      .join(" ");
  assert.equal(show("twenty eighteen's best seller"), "2018's best seller");
  assert.equal(show("after twenty eighteen’s launch,"), "after 2018’s launch,");
  assert.equal(show("two thousand seven's sequel"), "2007's sequel");
  assert.equal(
    show("back in the nineteen nineties, arcades"),
    "back in the 1990s, arcades",
  );
  assert.equal(
    show("twenty sixteen. Then"),
    "2016. Then",
    "the plain year is unchanged",
  );
  assert.equal(
    show("two thousand players"),
    "2,000 players",
    "a count is a figure, not a year",
  );
});

test("title numbers said as words for the voice, and 10 to 99, are figures in captions", async () => {
  const { displayWords } = await import("../src/render/timeline.ts");
  const show = (t: string) =>
    displayWords(
      t.split(" ").map((text, i) => ({ text, start: i, end: i + 1 })),
    )
      .map((w) => w.text)
      .join(" ");
  assert.equal(
    show("the size of GTA three's Liberty City."),
    "the size of GTA 3's Liberty City.",
  );
  assert.equal(
    show("fix GTA four's awkward controls"),
    "fix GTA 4's awkward controls",
  );
  assert.equal(show("Modern Warfare twenty's"), "Modern Warfare 20's");
  assert.equal(
    show("on Xbox One's store"),
    "on Xbox One's store",
    "a console's name stays",
  );
  assert.equal(
    show("241 tracks across fifteen radio stations, plus"),
    "241 tracks across 15 radio stations, plus",
  );
  assert.equal(show("it lasted twenty-four hours."), "it lasted 24 hours.");
  assert.equal(
    show("its first year. Ten years after its launch"),
    "its first year. Ten years after its launch",
    "sentence start stays",
  );
  assert.equal(
    show("two days later, three islands"),
    "two days later, three islands",
    "small counts stay words",
  );
  assert.equal(
    show("that's everyone's favourite"),
    "that's everyone's favourite",
  );
});

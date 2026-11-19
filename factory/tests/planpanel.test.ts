import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPlan,
  type PlanInput,
  type RenderPlan,
  type Shot,
} from "../src/render/plan.ts";
import type { Segment } from "../src/render/timeline.ts";
import type { Rubric } from "../src/qa/rubric.ts";
import { scorePlan } from "../src/qa/rubric.ts";
import {
  CARD,
  cardMedia,
  carriesLine,
  measurePlan,
  measuresLine,
  namesGame,
  planCard,
  planSignature,
  sameness,
  tokens,
  type CardMedia,
  type PanelContext,
} from "../src/render/plancards.ts";
import {
  PANEL,
  PLAN_CRITIC_SITE,
  PlanCriticSchema,
  buildCandidates,
  candidateSpecs,
  fixWeakest,
  measureMark,
  panelApplies,
  panelArm,
  panelEvent,
  panelLinesForReport,
  panelMarks,
  panelSummary,
  pickCandidate,
  readPlan,
  runPanel,
  type PlanCriticRead,
} from "../src/render/planpanel.ts";
import {
  panelContext,
  planPanelStep,
  scriptGames,
} from "../src/planpanelstep.ts";
import { loadConfig } from "../src/config.ts";

// ---------------------------------------------------------------- fixtures

function narration(): {
  segments: Segment[];
  words: Array<{ text: string; start: number; end: number }>;
  duration: number;
} {
  const texts: Array<[Segment["kind"], string, Segment["visual"]]> = [
    [
      "hook",
      "Starfield's first expansion has slipped and Elden Ring fans are laughing at it.",
      undefined,
    ],
    [
      "beat",
      "Bethesda says the expansion now lands in early twenty twenty seven, three months later than planned.",
      { kind: "stat", primary: "3+ MONTHS", secondary: "later than planned" },
    ],
    [
      "beat",
      "The studio blames polish on the new star systems and a bigger ship interior overhaul for the crew.",
      undefined,
    ],
    [
      "beat",
      "Starfield against Elden Ring is the comparison every fan keeps making this week online.",
      undefined,
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
    t += 0.3;
    segments.push({ kind, text, start, end: t, visual });
  }
  const duration = t + 1.0;
  segments[segments.length - 1]!.end = duration;
  return { segments, words, duration };
}

const ASSET_IMAGES = [
  {
    kind: "hero",
    aspect: 1.778,
    label: "Starfield key art",
    provenance: "steam",
  },
  {
    kind: "screenshot",
    aspect: 1.778,
    label: "Starfield ship interior",
    provenance: "steam",
  },
  {
    kind: "screenshot",
    aspect: 1.778,
    label: "Starfield star systems map",
    provenance: "steam",
  },
  {
    kind: "screenshot",
    aspect: 1.778,
    label: "Starfield city",
    provenance: "steam",
  },
  {
    kind: "screenshot",
    aspect: 1.778,
    label: "Starfield crew",
    provenance: "steam",
  },
  {
    kind: "screenshot",
    aspect: 1.778,
    label: "Elden Ring castle",
    provenance: "igdb",
  },
];
const ASSET_CLIPS = [
  {
    durationSeconds: 2.6,
    motion: 0.9,
    label: "Starfield ship take off",
    provenance: "youtube",
  },
  {
    durationSeconds: 2.6,
    motion: 0.8,
    label: "Starfield planet walk",
    provenance: "youtube",
  },
  {
    durationSeconds: 2.6,
    motion: 0.7,
    label: "Starfield space combat",
    provenance: "youtube",
  },
  {
    durationSeconds: 2.6,
    motion: 0.6,
    label: "Starfield city walk",
    provenance: "youtube",
  },
  {
    durationSeconds: 2.6,
    motion: 0.5,
    label: "Elden Ring boss fight",
    provenance: "youtube",
  },
  {
    durationSeconds: 3.0,
    motion: 0.4,
    label: "Starfield ship interior crew",
    provenance: "youtube",
    beatIndex: 1,
  },
];
const GAMES = ["Starfield", "Elden Ring"];

function input(over: Partial<PlanInput> = {}): PlanInput {
  const n = narration();
  return {
    segments: n.segments,
    words: n.words,
    durationSeconds: n.duration,
    images: ASSET_IMAGES.map((i) => ({ kind: i.kind, aspect: i.aspect })),
    clips: ASSET_CLIPS.map((c) => ({
      durationSeconds: c.durationSeconds,
      motion: c.motion,
      beatIndex: c.beatIndex,
    })),
    storyType: "delay",
    isRumour: false,
    attribution: "Source: Bethesda",
    variant: 1,
    footageFirst: true,
    ...over,
  };
}

function ctxFor(segments: Segment[]): PanelContext {
  const media = cardMedia(ASSET_IMAGES, ASSET_CLIPS, GAMES);
  return {
    segments,
    lineKeywords: segments.map((s, i) =>
      i === 2
        ? ["ship interior", "star systems"]
        : i === 1
          ? ["expansion"]
          : [],
    ),
    images: media.images,
    clips: media.clips,
    game: "Starfield",
    games: GAMES,
  };
}

const rubricOf =
  (i: PlanInput) =>
  (plan: RenderPlan): Rubric =>
    scorePlan({
      plan,
      segments: i.segments,
      words: i.words,
      footageSeconds: 15,
      footageBudgetSeconds: 20,
      hookWords: 8,
    });

const read = (overall: number, weakest = 0, should = ""): PlanCriticRead => ({
  lines: [1, 2, 3, 4, 5, 6].map((line) => ({ line, mark: 2 })),
  overall,
  weakest_line: weakest,
  should_show: should,
});

// A small hand-made plan for exact measurements: 4 shots over 300 frames.
function handPlan(): { plan: RenderPlan; ctx: PanelContext } {
  const segments: Segment[] = [
    { kind: "hook", text: "Starfield is late again.", start: 0, end: 3 },
    {
      kind: "beat",
      text: "The ship interior is being rebuilt.",
      start: 3,
      end: 6,
    },
    {
      kind: "beat",
      text: "Starfield and Elden Ring keep being compared.",
      start: 6,
      end: 10,
    },
  ];
  const shot = (
    start: number,
    end: number,
    segment: number,
    media: Shot["media"],
  ): Shot => ({
    start,
    end,
    segment,
    media,
    move: "pushIn",
    framed: false,
    luma: 128,
  });
  const plan = {
    version: 1,
    fps: 30,
    totalFrames: 300,
    tailFrames: 30,
    heroIndex: 0,
    shots: [
      shot(0, 60, 0, { type: "image", index: 0 }),
      shot(60, 150, 1, { type: "clip", index: 0, trimFrom: 0 }),
      shot(150, 210, 2, { type: "image", index: 0 }),
      shot(210, 300, 2, { type: "image", index: 0 }),
    ],
    turns: [],
    sfx: [{ file: "sfx/whoosh.mp3", frame: 10, volume: 1 }],
    shelf: [],
  } satisfies RenderPlan;
  const images: CardMedia[] = [
    {
      moving: false,
      kind: "hero",
      title: "Starfield key art",
      game: "Starfield",
      keywords: ["starfield"],
    },
  ];
  const clips: CardMedia[] = [
    {
      moving: true,
      kind: "clip",
      title: "Ship interior walk",
      game: "Starfield",
      keywords: ["ship", "interior", "walk"],
      seconds: 4,
    },
  ];
  return {
    plan,
    ctx: {
      segments,
      lineKeywords: [[], ["ship interior"], []],
      images,
      clips,
      game: "Starfield",
      games: GAMES,
    },
  };
}

// ---------------------------------------------------------------- plan cards

test("the plan card reads one row per line with the media, its length, repeats and the card, deterministically", () => {
  const { plan, ctx } = handPlan();
  const card = planCard(plan, ctx);
  assert.equal(card, planCard(plan, ctx), "the same plan gives the same text");
  assert.match(card, /^SHORT about Starfield: 10 s, 4 shots\./);
  assert.match(card, /LINE 1 \(hook\): "Starfield is late again\."/);
  assert.match(
    card,
    /LINE 2 \(beat\): "The ship interior is being rebuilt\."\n  subject: ship interior/,
  );
  assert.match(
    card,
    /- 3 s: F1 moving footage; "Ship interior walk"; game: Starfield; about: ship, interior, walk/,
  );
  assert.match(
    card,
    /- 2 s: P1 still \(hero\); "Starfield key art"; game: Starfield; about: starfield \[shown 3 times in this Short\]/,
  );
  const seg = narration().segments;
  const withCard = planCard(buildPlan(input()), ctxFor(seg));
  assert.match(
    withCard,
    /card on screen: stat: 3\+ MONTHS \/ later than planned/,
  );
  assert.match(withCard, /card on screen: title: Not a red flag yet/);
  assert.equal(
    (withCard.match(/^LINE /gm) ?? []).length,
    seg.length,
    "every spoken line has a row",
  );
});

test("tokens, game names and the media description", () => {
  assert.deepEqual(tokens("The Ship's interior, at 4K!"), ["ship", "interior"]);
  assert.ok(namesGame("Starfield against Elden Ring", "Elden Ring"));
  assert.ok(!namesGame("an elden blade", "Elden Ring"));
  const m = cardMedia(
    [
      {
        kind: "screenshot",
        label: "Elden Ring castle",
        sourceUrl: "https://x/a%ZZ.jpg",
      },
    ],
    [
      {
        label: "boss fight",
        youtubeSource: { title: "Elden Ring Official Trailer" },
        durationSeconds: 3,
        cutsceneMatch: { targetKey: "beat:1" },
      },
    ],
    GAMES,
  );
  assert.equal(m.images[0]!.game, "Elden Ring");
  assert.equal(m.clips[0]!.title, "Elden Ring Official Trailer");
  assert.equal(m.clips[0]!.targetKey, "beat:1");
  assert.equal(m.clips[0]!.seconds, 3);
  const plain = cardMedia([{ kind: "hero", label: "key art" }], [], GAMES);
  assert.equal(
    plain.images[0]!.game,
    "Starfield",
    "media naming no game is taken as the Short's game",
  );
});

// ---------------------------------------------------------------- measurements

test("every measurement on a hand-made plan", () => {
  const { plan, ctx } = handPlan();
  const recent = [
    planSignature(plan),
    { layout: "x", opening: "clip", moves: "y", sound: "z" },
  ];
  const m = measurePlan(plan, ctx, recent);
  assert.equal(m.moving, 0.3, "90 of 300 frames on footage");
  assert.equal(m.distinct, 0.5, "2 media over 4 shots");
  assert.equal(m.longestRun, 5, "the hero runs 150-300 unbroken");
  assert.equal(m.maxUses, 3);
  assert.equal(m.firstShot, 2);
  assert.equal(m.lines, 3);
  assert.deepEqual(
    m.offSubject,
    [],
    "the hook and the comparison show the game, the ship line shows the ship",
  );
  assert.equal(m.comparisons, 1);
  assert.deepEqual(m.oneGame, [3], "the comparison line shows only Starfield");
  assert.equal(
    m.sameness,
    0.5,
    "identical to one recent plan, nothing shared with the other",
  );
  assert.ok(m.own >= 0 && m.own <= 1);
  assert.match(
    measuresLine(m),
    /moving 30%, distinct 50%, longest run 5 s, most used x3, first shot 2 s, off subject 0\/3, one game 1\/1/,
  );
  // A line whose media carries none of its keywords is off subject.
  const off = { ...ctx, lineKeywords: [[], ["dragon"], []] };
  assert.deepEqual(measurePlan(plan, off).offSubject, [2]);
  // Media tagged for the beat carries it whatever its words.
  const tagged = { ...off, clips: [{ ...ctx.clips[0]!, beatIndex: 0 }] };
  assert.ok(carriesLine(tagged, plan.shots[1]!));
});

test("the first shot is the first full shot behind the brand sting", () => {
  const { plan, ctx } = handPlan();
  const sting = { ...plan, shots: [{ ...plan.shots[0]!, end: 12 }, { ...plan.shots[1]!, start: 12 }, ...plan.shots.slice(2)] };
  assert.equal(measurePlan(sting, ctx).firstShot, 4.6, "frames 12-150");
});

test("sameness compares layout, opening, moves and sound with at most the last eight plans", () => {
  const { plan } = handPlan();
  const sig = planSignature(plan);
  assert.equal(sig.opening, "image");
  assert.equal(sig.sound, "whoosh.mp3");
  assert.equal(sameness(sig, []), 0);
  assert.equal(sameness(sig, [sig]), 1);
  const other = { layout: "a", opening: "b", moves: "c", sound: "d" };
  assert.equal(
    sameness(sig, [...Array(CARD.recentPlans).fill(other), sig]),
    0,
    "a ninth plan is not compared",
  );
});

test("the measurements' mark rewards footage, variety and on-subject lines, within 0-10", () => {
  const base = {
    moving: 0.6,
    distinct: 1,
    longestRun: 2,
    maxUses: 1,
    firstShot: 1,
    lines: 5,
    offSubject: [],
    comparisons: 0,
    oneGame: [],
    sameness: 0,
    own: 1,
  };
  assert.equal(measureMark(base), 10);
  assert.ok(measureMark({ ...base, moving: 0.1 }) < 10);
  assert.ok(
    measureMark({ ...base, offSubject: [1, 2] }) <
      measureMark({ ...base, offSubject: [1] }),
  );
  assert.ok(
    measureMark({ ...base, maxUses: 7 }) < measureMark({ ...base, maxUses: 2 }),
  );
  assert.equal(
    measureMark({
      ...base,
      moving: 0,
      distinct: 0,
      offSubject: [1, 2, 3, 4, 5],
      sameness: 1,
      firstShot: 9,
      maxUses: 30,
    }),
    0,
  );
});

// ---------------------------------------------------------------- the planner knob and the candidates

test("off changes nothing in the planner: no rotate and rotate 0 give the plan as it always was", () => {
  const i = input();
  const before = buildPlan(i);
  assert.deepEqual(buildPlan({ ...i, rotate: 0 }), before);
  assert.deepEqual(buildPlan({ ...i, rotate: undefined }), before);
  const nf = input({ footageFirst: false });
  assert.deepEqual(buildPlan({ ...nf, rotate: 0 }), buildPlan(nf));
});

test("candidate recipes: A as built, B and C turn the variant and the free media, capped at three", () => {
  const i = input();
  assert.deepEqual(
    candidateSpecs(i, 9).map((s) => s.label),
    ["A", "B", "C"],
  );
  assert.deepEqual(
    candidateSpecs(i, 1).map((s) => s.label),
    ["A"],
  );
  assert.deepEqual(
    candidateSpecs(i, 0).map((s) => s.label),
    ["A"],
  );
  const [, b, c] = candidateSpecs(i, 3);
  assert.deepEqual(b!.patch, { variant: 2, rotate: 1, openOnClip: true });
  assert.deepEqual(c!.patch, { variant: 3, rotate: 2 });
  assert.equal(
    candidateSpecs({ ...i, openOnClip: true }, 3)[1]!.patch.openOnClip,
    undefined,
    "an opening on footage stays",
  );
  assert.equal(
    candidateSpecs({ ...i, clips: [] }, 3)[1]!.patch.openOnClip,
    undefined,
    "no footage, no footage opening",
  );
});

test("candidates come from the same pool under the same rules", () => {
  const i = input();
  const base = buildPlan(i);
  const cands = buildCandidates(i, 3, base);
  assert.equal(cands[0]!.plan, base, "A is the very plan the factory built");
  const keys = (p: RenderPlan) =>
    p.shots.map((s) => `${s.media.type}:${s.media.index}`).join(" ");
  assert.ok(
    new Set(cands.map((c) => keys(c.plan))).size >= 2,
    "the turns give at least one other set of pictures",
  );
  for (const { plan } of cands) {
    for (const s of plan.shots) {
      if (s.media.type === "image") assert.ok(s.media.index < i.images.length);
      if (s.media.type === "clip") {
        assert.ok(s.media.index < i.clips.length);
        // The clip tagged for beat 1 (segment 2) never goes under another line.
        if (s.media.index === 5) assert.equal(s.segment, 2);
      }
    }
    // Never the same media twice in a row.
    plan.shots.forEach((s, n) => {
      if (n === 0 || n === plan.shots.length - 1) return;
      const p = plan.shots[n - 1]!;
      assert.ok(
        !(
          p.media.type === s.media.type &&
          p.media.index === s.media.index &&
          s.media.type !== "plate"
        ),
        `shot ${n} repeats`,
      );
    });
    assert.equal(plan.totalFrames, base.totalFrames);
  }
});

// ---------------------------------------------------------------- the pick

test("the pick: the critic's overall and the measurements averaged, the first plan wins ties", () => {
  assert.equal(pickCandidate([5, 5, 4]), 0);
  assert.equal(pickCandidate([4, 6, 6]), 1);
  assert.equal(pickCandidate([7]), 0);
  assert.deepEqual(
    panelMarks([
      { label: "A", measureMark: 6, overall: 8 },
      { label: "B", measureMark: 5 },
    ]),
    [7, 5],
  );
  const withRet = panelMarks([
    { label: "A", measureMark: 6, overall: 6, predicted: 40 },
    { label: "B", measureMark: 6, overall: 6, predicted: 50 },
  ]);
  assert.ok(
    withRet[1]! > withRet[0]!,
    "the retention model breaks an even read",
  );
  assert.equal(withRet[1]! - withRet[0]!, PANEL.retentionWeight * 10);
});

// ---------------------------------------------------------------- the one-line fix

test("the fix swaps the weakest line's longest shot for an unused, better-matching media from the pool", () => {
  const { plan, ctx } = handPlan();
  const pool: PanelContext = {
    ...ctx,
    lineKeywords: [[], [], ["elden ring"]],
    images: [
      ...ctx.images,
      {
        moving: false,
        kind: "screenshot",
        title: "Elden Ring castle",
        game: "Elden Ring",
        keywords: ["elden", "ring", "castle"],
        aspect: 1.778,
      },
      {
        moving: false,
        kind: "screenshot",
        title: "Elden Ring old",
        game: "Elden Ring",
        keywords: ["elden", "ring", "castle"],
        then: true,
      },
      {
        moving: false,
        kind: "screenshot",
        title: "Elden Ring tagged",
        game: "Elden Ring",
        keywords: ["elden", "ring", "castle", "boss"],
        beatIndex: 0,
      },
    ],
    clips: [
      ...ctx.clips,
      {
        moving: true,
        kind: "clip",
        title: "Elden Ring boss",
        game: "Elden Ring",
        keywords: ["elden", "ring", "boss"],
        seconds: 1,
      },
    ],
  };
  const out = fixWeakest(plan, pool, 3, "Elden Ring castle and boss");
  assert.ok(out);
  assert.equal(
    out.fix.shot,
    2,
    "the line's longest shot that is neither the opening nor the closing one",
  );
  assert.deepEqual(
    out.plan.shots[2]!.media,
    { type: "image", index: 1 },
    "not the old game's, not another line's, not a clip too short",
  );
  assert.equal(out.plan.shots[2]!.framed, false);
  assert.equal(plan.shots[2]!.media.index, 0, "the input plan is untouched");
  assert.deepEqual(
    out.plan.shots.filter((_, n) => n !== 2),
    plan.shots.filter((_, n) => n !== 2),
    "one shot changes",
  );
  assert.equal(fixWeakest(plan, pool, 3, ""), undefined, "no words, no fix");
  assert.equal(
    fixWeakest(plan, pool, 1, "Elden Ring castle"),
    undefined,
    "the opening shot is never swapped",
  );
  assert.equal(
    fixWeakest(plan, ctx, 3, "a dragon"),
    undefined,
    "nothing better in the pool",
  );
});

// ---------------------------------------------------------------- the run

const fakeReader = (marks: number[], weakest = 0, should = "") => {
  const seen: string[] = [];
  return {
    seen,
    read: async (card: string) => {
      seen.push(card);
      return read(marks[seen.length - 1] ?? 5, weakest, should);
    },
  };
};

test("check: one read of the plan as built, recorded with its measurements, nothing changes", async () => {
  const i = input();
  const base = buildPlan(i);
  const r = fakeReader([7]);
  const out = await runPanel({
    mode: "check",
    arm: "panel",
    input: i,
    base,
    ctx: ctxFor(i.segments),
    recent: [],
    candidates: 3,
    rubric: rubricOf(i),
    read: r.read,
    predict: () => 44.44,
    now: new Date("2026-11-19T10:00:00Z"),
  });
  assert.equal(out.plan, base);
  assert.equal(out.record.calls.critic, 1);
  assert.equal(r.seen.length, 1);
  assert.equal(
    r.seen[0],
    planCard(base, ctxFor(i.segments)),
    "the critic sees the plan card and nothing else",
  );
  assert.equal(out.record.candidates.length, 1);
  assert.equal(out.record.candidates[0]!.critic?.overall, 7);
  assert.equal(out.record.candidates[0]!.predicted, 44.4);
  assert.equal(out.record.pick, "A");
  assert.equal(out.record.at, "2026-11-19T10:00:00.000Z");
});

test("the control arm is measured only: no read, no change", async () => {
  const i = input();
  const base = buildPlan(i);
  const r = fakeReader([9]);
  const out = await runPanel({
    mode: "on",
    arm: "control",
    input: i,
    base,
    ctx: ctxFor(i.segments),
    recent: [],
    candidates: 3,
    rubric: rubricOf(i),
    read: r.read,
    now: new Date(),
  });
  assert.equal(out.plan, base);
  assert.equal(r.seen.length, 0);
  assert.equal(out.record.calls.critic, 0);
  assert.equal(out.record.candidates.length, 1);
});

test("on: up to three plans, at most three reads, the best kept, red plans dropped", async () => {
  const i = input();
  const base = buildPlan(i);
  const r = fakeReader([4, 9, 5]);
  const out = await runPanel({
    mode: "on",
    arm: "panel",
    input: i,
    base,
    ctx: ctxFor(i.segments),
    recent: [],
    candidates: 3,
    rubric: rubricOf(i),
    read: r.read,
    now: new Date(),
  });
  assert.ok(out.record.calls.critic <= PANEL.readsMax);
  assert.equal(out.record.calls.critic, r.seen.length);
  const live = out.record.candidates.filter((c) => !c.dropped);
  assert.ok(live.length >= 2);
  assert.equal(
    out.record.pick,
    live[1]!.label,
    "the second plan read got the 9",
  );
  assert.notEqual(out.plan, base);
  assert.notEqual(rubricOf(i)(out.plan).grade, "red");
  // Red on the rubric: dropped and never read.
  let n = 0;
  const redB = (plan: RenderPlan): Rubric =>
    plan === base || n++ > 0
      ? { grade: "amber", metrics: [] }
      : { grade: "red", metrics: [] };
  const r2 = fakeReader([5, 5, 5]);
  const out2 = await runPanel({
    mode: "on",
    arm: "panel",
    input: i,
    base,
    ctx: ctxFor(i.segments),
    recent: [],
    candidates: 3,
    rubric: redB,
    read: r2.read,
    now: new Date(),
  });
  assert.equal(out2.record.candidates[1]!.dropped, "red on the rubric");
  assert.equal(out2.record.calls.critic, r2.seen.length);
  assert.ok(r2.seen.length <= 2);
});

test("on: every plan red leaves the base plan to the rebuild; a failed read falls back to the measurements", async () => {
  const i = input();
  const base = buildPlan(i);
  const red = (): Rubric => ({ grade: "red", metrics: [] });
  const r = fakeReader([9]);
  const out = await runPanel({
    mode: "on",
    arm: "panel",
    input: i,
    base,
    ctx: ctxFor(i.segments),
    recent: [],
    candidates: 3,
    rubric: red,
    read: r.read,
    now: new Date(),
  });
  assert.equal(out.plan, base);
  assert.equal(r.seen.length, 0);
  assert.match(out.record.note ?? "", /every plan red/);
  const failing = async (): Promise<PlanCriticRead> => {
    throw new Error("model down");
  };
  const out2 = await runPanel({
    mode: "on",
    arm: "panel",
    input: i,
    base,
    ctx: ctxFor(i.segments),
    recent: [],
    candidates: 3,
    rubric: rubricOf(i),
    read: failing,
    now: new Date(),
  });
  assert.equal(out2.record.error, "model down");
  assert.ok(out2.record.pick);
  for (const c of out2.record.candidates.filter((c) => !c.dropped))
    assert.equal(c.mark, c.measure_mark);
});

test("on: the weakest line gets one fix and no second read; identical plans are read once", async () => {
  const i = input();
  const base = buildPlan(i);
  const ctx = ctxFor(i.segments);
  // An unused Elden Ring picture waits in the pool (the plans never reach it: it sits beyond the planner's list).
  const pool: PanelContext = {
    ...ctx,
    images: [
      ...ctx.images,
      { moving: false, kind: "screenshot", title: "Elden Ring boss arena", game: "Elden Ring", keywords: ["elden", "ring", "boss", "arena"], aspect: 1.778 },
    ],
  };
  // The critic names line 4 (the comparison) and asks for Elden Ring.
  const r = fakeReader([6, 6, 6], 4, "Elden Ring boss fight");
  const out = await runPanel({ mode: "on", arm: "panel", input: i, base, ctx: pool, recent: [], candidates: 3, rubric: rubricOf(i), read: r.read, now: new Date() });
  assert.equal(out.record.calls.critic, r.seen.length, "no read after the fix");
  assert.equal(out.record.calls.critic, 3);
  assert.ok(out.record.fix?.kept, "the fix is kept");
  assert.equal(out.record.fix!.line, 4);
  assert.match(out.record.fix!.to, /image:6 "Elden Ring boss arena"/);
  const picked = buildCandidates(i, 3, base).find((c) => c.spec.label === out.record.pick)!.plan;
  const changed = out.plan.shots.filter((s, n) => s.media.index !== picked.shots[n]!.media.index || s.media.type !== picked.shots[n]!.media.type);
  assert.equal(changed.length, 1, "exactly one shot changes");
  assert.equal(changed[0]!.segment, 3, "on the weakest line");
  assert.ok(out.record.fix!.measures!.oneGame.length <= out.record.candidates.find((c) => c.label === out.record.pick)!.measures.oneGame.length);
  // A fix that turns the plan red is not kept.
  let calls = 0;
  const redAfter = (plan: RenderPlan): Rubric => ({ grade: ++calls > 3 ? "red" : "amber", metrics: [] });
  const r3 = fakeReader([6, 6, 6], 4, "Elden Ring boss fight");
  const out3 = await runPanel({ mode: "on", arm: "panel", input: i, base, ctx: pool, recent: [], candidates: 3, rubric: redAfter, read: r3.read, now: new Date() });
  assert.equal(out3.record.fix?.kept, false);
  assert.deepEqual(out3.plan.shots, buildCandidates(i, 3, base).find((c) => c.spec.label === out3.record.pick)!.plan.shots, "the picked plan as built");
  assert.ok(!out3.plan.shots.some((s) => s.media.type === "image" && s.media.index === 6), "the red fix is dropped");
  // One candidate only when the pictures are the same: the twin is dropped unread.
  const same = (x: PlanInput) =>
    buildPlan({
      ...x,
      rotate: undefined,
      variant: x.variant,
      openOnClip: undefined,
    });
  const r2 = fakeReader([5, 5, 5]);
  const out2 = await runPanel({
    mode: "on",
    arm: "panel",
    input: i,
    base,
    ctx,
    recent: [],
    candidates: 3,
    rubric: rubricOf(i),
    read: r2.read,
    build: same,
    now: new Date(),
  });
  assert.equal(r2.seen.length, 1);
  assert.match(
    out2.record.candidates[1]!.dropped ?? "",
    /the same pictures as A/,
  );
  assert.equal(out2.record.pick, "A");
});

test("the event and the summary the weekly report reads", async () => {
  const i = input();
  const base = buildPlan(i);
  const out = await runPanel({
    mode: "check",
    arm: "panel",
    input: i,
    base,
    ctx: ctxFor(i.segments),
    recent: [],
    candidates: 3,
    rubric: rubricOf(i),
    read: fakeReader([6]).read,
    now: new Date(),
  });
  const ev = panelEvent(out.record) as {
    arm: string;
    candidates: Array<{ overall?: number }>;
  };
  assert.equal(ev.arm, "panel");
  assert.equal(ev.candidates[0]!.overall, 6);
  const sum = panelSummary(out.record)!;
  assert.equal(sum.mark, 6);
  assert.equal(sum.changed, false);
  assert.ok(sum.measures);
  assert.equal(panelSummary(undefined), undefined);
});

// ---------------------------------------------------------------- the critic call shape

test("the critic is the mid tier at plan.critic with the plan card as its only content", async () => {
  let got: Record<string, unknown> = {};
  const llm = {
    async structured(o: Record<string, unknown>) {
      got = o;
      return read(5);
    },
  };
  await readPlan(llm as never, "CARD TEXT");
  assert.equal(got.site, PLAN_CRITIC_SITE);
  assert.equal(got.tier, "mid");
  assert.equal(got.content, "CARD TEXT");
  assert.ok(PlanCriticSchema.safeParse(read(5)).success);
  assert.ok(!PlanCriticSchema.safeParse({ ...read(5), overall: 11 }).success);
});

// ---------------------------------------------------------------- the split, the scope, the settings

test("the arm is stable per episode and follows the share", () => {
  assert.equal(panelArm("ep1", 0), "control");
  assert.equal(panelArm("ep1", 1), "panel");
  assert.equal(panelArm("ep1", 0.5), panelArm("ep1", 0.5));
  const n = Array.from({ length: 2000 }, (_, k) =>
    panelArm(`ep-${k}`, 0.5),
  ).filter((a) => a === "panel").length;
  assert.ok(n > 900 && n < 1100, `${n} of 2000 in the panel's arm`);
});

test("the panel covers news, breaking and Why Shorts only", () => {
  assert.ok(panelApplies({ lane: "news" }));
  assert.ok(panelApplies({ lane: "news_breaking" }));
  assert.ok(panelApplies({ lane: "evergreen", why: true }));
  assert.ok(!panelApplies({ lane: "evergreen" }));
  assert.ok(!panelApplies({ lane: "news", reply: true }));
  assert.ok(!panelApplies({ lane: "news", search: true }));
  assert.ok(!panelApplies({ lane: "news", gtaFile: true }));
  assert.ok(!panelApplies({ lane: "news", entries: 5 }));
  assert.ok(!panelApplies({ lane: "news", everyGame: true }));
});

test("settings default off: no panel, half share, three candidates", () => {
  const keys = [
    "SHOT_PLAN_PANEL",
    "SHOT_PLAN_PANEL_SHARE",
    "SHOT_PLAN_CANDIDATES",
  ];
  const saved = keys.map((k) => process.env[k]);
  for (const k of keys) delete process.env[k];
  try {
    const cfg = loadConfig();
    assert.equal(cfg.shotPlanPanel, "off");
    assert.equal(cfg.shotPlanPanelShare, 0.5);
    assert.equal(cfg.shotPlanCandidates, 3);
    process.env.SHOT_PLAN_PANEL = "bogus";
    process.env.SHOT_PLAN_CANDIDATES = "9";
    assert.equal(loadConfig().shotPlanPanel, "off");
    assert.equal(loadConfig().shotPlanCandidates, 3, "capped at three");
    process.env.SHOT_PLAN_PANEL = "check";
    assert.equal(loadConfig().shotPlanPanel, "check");
  } finally {
    keys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  }
});

test("off changes nothing in the factory: the step returns the very plan and touches nothing", async () => {
  const i = input();
  const plan = buildPlan(i);
  const boom = () => {
    throw new Error("must not be called");
  };
  const s = {
    db: { query: boom } as never,
    llm: { structured: boom } as never,
    cfg: {
      shotPlanPanel: "off" as const,
      shotPlanPanelShare: 1,
      shotPlanCandidates: 3,
      retentionDirector: "off",
      dataDir: ".",
    },
    now: () => new Date(),
  };
  const assets: Record<string, unknown> = {
    images: ASSET_IMAGES,
    clips: ASSET_CLIPS,
  };
  const script = { game_title: "Starfield", beats: [] } as never;
  const out = await planPanelStep(
    s,
    { id: "e1", lane: "news" },
    {
      assets,
      script,
      words: i.words,
      segments: i.segments,
      input: i,
      plan,
      rubric: rubricOf(i),
      segmentsOf: boom as never,
    },
  );
  assert.equal(out, plan);
  assert.equal(assets.plan_panel, undefined);
  // On, but a lane the panel does not cover: also untouched.
  const out2 = await planPanelStep(
    { ...s, cfg: { ...s.cfg, shotPlanPanel: "on" } },
    { id: "e1", lane: "evergreen" },
    {
      assets,
      script,
      words: i.words,
      segments: i.segments,
      input: i,
      plan,
      rubric: rubricOf(i),
      segmentsOf: boom as never,
    },
  );
  assert.equal(out2, plan);
  assert.equal(assets.plan_panel, undefined);
});

test("the script's games and the panel's context", () => {
  const script = {
    game_title: "Starfield",
    beats: [
      {
        narration: "a",
        footage: { want: "gameplay", keywords: ["ship interior"] },
      },
      {
        narration: "b",
        visual: {
          kind: "versus",
          primary: "",
          secondary: "",
          items: ["*Starfield:2023", "Elden Ring:2022"],
        },
      },
    ],
  } as never;
  assert.deepEqual(scriptGames(script), ["Starfield", "Elden Ring"]);
  const segments: Segment[] = [
    { kind: "hook", text: "h", start: 0, end: 1 },
    { kind: "beat", text: "a", start: 1, end: 2 },
    { kind: "beat", text: "b", start: 2, end: 3 },
  ];
  const ctx = panelContext(script, segments, {
    images: ASSET_IMAGES,
    clips: ASSET_CLIPS,
  });
  assert.deepEqual(ctx.lineKeywords, [[], ["ship interior"], []]);
  assert.equal(ctx.images.length, ASSET_IMAGES.length);
  assert.equal(ctx.clips[4]!.game, "Elden Ring");
});

// ---------------------------------------------------------------- the weekly report

test("report lines: no verdict before twenty a side, then the difference and the correlations", () => {
  const corr = () => 0.31;
  const { plan, ctx } = handPlan();
  const measures = measurePlan(plan, ctx);
  const few = panelLinesForReport(
    [
      { arm: "panel", mark: 6, measures, viewed_pct: 70 },
      { arm: "control", measures, viewed_pct: 65 },
    ],
    corr,
  );
  assert.equal(few.length, 3);
  assert.match(few[1]!, /no verdict before 20 a side/);
  assert.match(few[2]!, /picture editor critic's mark 1 of 20 so far/);
  const rows = [
    ...Array.from({ length: 20 }, (_, k) => ({
      arm: "panel" as const,
      mark: 5 + (k % 4),
      measures,
      viewed_pct: 70,
      changed: k % 2 === 0,
    })),
    ...Array.from({ length: 20 }, () => ({
      arm: "control" as const,
      measures,
      viewed_pct: 65,
    })),
  ];
  const lines = panelLinesForReport(rows, corr);
  assert.match(
    lines[0]!,
    /panel arm 20 Shorts \(10 with a changed plan\), average viewed 70\.0%; control arm 20 Shorts, average viewed 65\.0%/,
  );
  assert.match(
    lines[1]!,
    /70\.0% in the panel's arm against 65\.0% in the control arm \(5\.0 points, 20 against 20 Shorts\)/,
  );
  assert.match(
    lines[2]!,
    /picture editor critic's mark 0\.31 over 20; moving share 0\.31 over 40/,
  );
  assert.deepEqual(panelLinesForReport([], corr), []);
});

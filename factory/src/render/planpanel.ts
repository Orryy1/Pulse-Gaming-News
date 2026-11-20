// The shot plan panel (SHOT_PLAN_PANEL=off|check|on, default off; creator gap plan, 19 Nov 2026). The writers' room
// test showed what lifts quality: make several versions, have a blind critic mark them, keep the best and check the
// marks against real retention. Until now the factory built one picture plan per Short and a second only when the
// first scored red, and never compared the two. The panel applies the loop to the picture plan before any render:
//   - check: the plan as built is read once by a picture editor critic ("plan.critic", mid tier) that sees only the plan
//     card (src/render/plancards.ts): per line 0 to 3 for "the picture shows what the line is about", an overall 1 to
//     10, the single weakest line and what it should have shown. Recorded with the measurements; nothing changes.
//   - on: up to PANEL.candidatesMax plans from the same media pool, varying only what the planner already varies (the
//     layout variant, the turn of the free footage and stills among equals, the opening on footage); red plans on the
//     rubric are dropped, the rest read once each and, when the retention model is there, predicted; the best kept
//     (the critic's overall and the measurements' mark, averaged; the first plan wins ties). The critic's weakest line
//     may then take one better-matching unused picture from the pool (one swap, re-measured, never a second read).
// Never loosens a gate: the chosen plan is green or amber on the rubric, and the graphics audit, spoiler, repeats,
// first-seconds and ad-safety checks all run on it afterwards as on any plan. Caps: three plans, three reads, no
// downloads, no render. Everything here but the injected read is pure.

import { createHash } from "node:crypto";
import { z } from "zod";
import type { Llm } from "../editorial/llm.ts";
import type { Rubric } from "../qa/rubric.ts";
import {
  buildPlan,
  FREEZE_TOLERANCE,
  isFramedStill,
  QUIET_KINDS,
  type PlanInput,
  type RenderPlan,
  type Shot,
} from "./plan.ts";
import {
  beatOf,
  carriesLine,
  mediaKey,
  mediaOf,
  measurePlan,
  planCard,
  subjectOf,
  tokens,
  type CardMedia,
  type PanelContext,
  type PlanMeasures,
  type PlanSignature,
} from "./plancards.ts";

// ---------------------------------------------------------------- the numbers, in one place

export const PANEL = {
  /** Plans built and read at most, whatever SHOT_PLAN_CANDIDATES says. */
  candidatesMax: 3,
  /** Critic reads a Short at most. */
  readsMax: 3,
  /** The measurements' mark out of 10: these weights add up to 10. */
  weights: {
    moving: 2,
    distinct: 2,
    subject: 3,
    comparison: 1,
    fresh: 1,
    firstShot: 1,
  },
  /** A media shown more than this many times costs the measurements' mark this much a time. */
  usesFree: 2,
  usePenalty: 0.5,
  /** Moving footage counts in full from this share (a creator's Short is mostly footage). */
  movingFull: 0.6,
  /** A first shot up to this many seconds is quick; it loses its point linearly until twice this. */
  firstShotQuick: 2.5,
  /** Points of the panel's mark per point of predicted retention above the candidates' mean. */
  retentionWeight: 0.1,
  /** The weekly report gives no verdict before this many Shorts a side. */
  verdictMin: 20,
} as const;

export const PLAN_CRITIC_SITE = "plan.critic";

export type PanelMode = "off" | "check" | "on";
export type PanelArm = "panel" | "control";

/** Which arm of the SHOT_PLAN_PANEL_SHARE split an episode is in (pure): the same id always lands the same way. */
export function panelArm(episodeId: string, share: number): PanelArm {
  if (share <= 0) return "control";
  if (share >= 1) return "panel";
  const n = createHash("sha1")
    .update(`shot-plan-panel:${episodeId}`)
    .digest()
    .readUInt16BE(0);
  return n / 65536 < share ? "panel" : "control";
}

/** The Shorts the panel covers (pure): news, breaking and Why; not replies, search Shorts, GTA File parts or lists. */
export function panelApplies(o: {
  lane: string;
  why?: boolean;
  reply?: boolean;
  search?: boolean;
  gtaFile?: boolean;
  entries?: number;
  everyGame?: boolean;
}): boolean {
  if (o.reply || o.search || o.gtaFile || (o.entries ?? 0) > 0 || o.everyGame)
    return false;
  return o.lane === "news" || o.lane === "news_breaking" || !!o.why;
}

// ---------------------------------------------------------------- candidates

export interface CandidateSpec {
  label: string;
  /** What differs, in words. */
  how: string;
  patch: Partial<Pick<PlanInput, "variant" | "rotate" | "openOnClip">>;
}

/**
 * The candidate plans' recipes (pure). A is the plan as built. B and C turn the layout variant on and give the free
 * footage and the equally ranked stills another turn; B also opens on footage when the plan opened on a still and
 * there is footage. Nothing else moves: the same pool, the same tags, the same rules.
 */
export function candidateSpecs(
  input: Pick<PlanInput, "variant" | "openOnClip" | "clips">,
  n: number,
): CandidateSpec[] {
  const v = input.variant;
  const all: CandidateSpec[] = [
    { label: "A", how: "the plan as built", patch: {} },
    {
      label: "B",
      how: `layout variant ${(v + 1) % 4}, the free footage and stills one turn on${!input.openOnClip && input.clips.length ? ", opening on footage" : ""}`,
      patch: {
        variant: (v + 1) % 4,
        rotate: 1,
        ...(!input.openOnClip && input.clips.length
          ? { openOnClip: true }
          : {}),
      },
    },
    {
      label: "C",
      how: `layout variant ${(v + 2) % 4}, the free footage and stills two turns on`,
      patch: { variant: (v + 2) % 4, rotate: 2 },
    },
  ];
  return all.slice(
    0,
    Math.max(1, Math.min(PANEL.candidatesMax, Math.floor(n))),
  );
}

/** Builds the candidates from one input (pure): A is `base` itself when given, so it is the very plan the factory built. */
export function buildCandidates(
  input: PlanInput,
  n: number,
  base?: RenderPlan,
  build: (i: PlanInput) => RenderPlan = buildPlan,
): Array<{ spec: CandidateSpec; plan: RenderPlan }> {
  return candidateSpecs(input, n).map((spec) => ({
    spec,
    plan:
      spec.label === "A" && base ? base : build({ ...input, ...spec.patch }),
  }));
}

// ---------------------------------------------------------------- the critic

export const PlanCriticSchema = z.object({
  lines: z
    .array(
      z.object({
        line: z.number().int().min(1).describe("The LINE number"),
        mark: z
          .number()
          .int()
          .min(0)
          .max(3)
          .describe(
            "0 to 3: the picture shows what the line is about (0 nothing to do with it, 3 exactly it)",
          ),
      }),
    )
    .describe("One mark for every LINE"),
  overall: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe("1 to 10: how well the pictures serve this Short as a whole"),
  weakest_line: z
    .number()
    .int()
    .min(0)
    .describe(
      "The LINE number whose picture lets it down most; 0 if none does",
    ),
  should_show: z
    .string()
    .describe(
      "What that line should have shown instead, as a short picture description",
    ),
});
export type PlanCriticRead = z.infer<typeof PlanCriticSchema>;

export function planCriticPrompt(): string {
  return `You are the picture editor at a top human gaming Shorts channel. You get one Short's shot plan as text: every spoken line, then each shot under it with how long it runs and what is on screen (moving footage or a still, its source title, the game, what it is about), and any card. You know nothing else about the Short.

For every line mark 0 to 3 whether the picture shows what the line is about (0 nothing to do with it, 1 the right game but not the thing said, 2 close, 3 exactly it). A comparison line must show both games. A still shown again and again, or a long run on one picture, is weak. Then mark the whole Short 1 to 10 for how well its pictures serve it: 5 is average for a competent channel; 8 or more only for a plan you would cut as it stands. Name the single weakest line and what it should have shown. Don't reward length.`;
}

export async function readPlan(
  llm: Llm,
  card: string,
): Promise<PlanCriticRead> {
  return llm.structured({
    site: PLAN_CRITIC_SITE,
    tier: "mid",
    effort: "medium",
    system: planCriticPrompt(),
    content: card,
    schema: PlanCriticSchema,
    maxTokens: 1500,
  });
}

// ---------------------------------------------------------------- marks and the pick

/** The measurements' mark out of 10 (pure). */
export function measureMark(m: PlanMeasures): number {
  const w = PANEL.weights;
  const moving = Math.min(1, m.moving / PANEL.movingFull);
  const subject = m.lines ? 1 - m.offSubject.length / m.lines : 1;
  const comparison = m.comparisons ? 1 - m.oneGame.length / m.comparisons : 1;
  const first =
    m.firstShot <= PANEL.firstShotQuick
      ? 1
      : Math.max(
          0,
          1 - (m.firstShot - PANEL.firstShotQuick) / PANEL.firstShotQuick,
        );
  const raw =
    w.moving * moving +
    w.distinct * Math.min(1, m.distinct) +
    w.subject * subject +
    w.comparison * comparison +
    w.fresh * (1 - m.sameness) +
    w.firstShot * first -
    PANEL.usePenalty * Math.max(0, m.maxUses - PANEL.usesFree);
  return Math.round(Math.max(0, Math.min(10, raw)) * 100) / 100;
}

export interface ScoredCandidate {
  label: string;
  measureMark: number;
  overall?: number;
  predicted?: number;
}

/**
 * The panel's mark for each candidate (pure): the critic's overall and the measurements' mark averaged (the
 * measurements alone when the critic did not read it), plus a small retention term when the model predicted.
 */
export function panelMarks(cands: readonly ScoredCandidate[]): number[] {
  const preds = cands
    .map((c) => c.predicted)
    .filter((p): p is number => typeof p === "number");
  const mean = preds.length
    ? preds.reduce((a, p) => a + p, 0) / preds.length
    : 0;
  return cands.map((c) => {
    const base =
      typeof c.overall === "number"
        ? (c.overall + c.measureMark) / 2
        : c.measureMark;
    const ret =
      typeof c.predicted === "number" && preds.length > 1
        ? PANEL.retentionWeight * (c.predicted - mean)
        : 0;
    return Math.round((base + ret) * 1000) / 1000;
  });
}

/** The pick (pure): the best mark; a tie goes to the earlier plan, so the plan as built wins any tie. */
export function pickCandidate(marks: readonly number[]): number {
  let best = -1;
  marks.forEach((m, i) => {
    if (best < 0 || m > marks[best]!) best = i;
  });
  return best;
}

// ---------------------------------------------------------------- the one-line fix

export interface PanelFix {
  line: number;
  shot: number;
  from: string;
  to: string;
  why: string;
}

const matchScore = (m: CardMedia, want: Set<string>) =>
  m.keywords.filter((w) => want.has(w)).length;

/**
 * One swap on the critic's weakest line (pure): the line's longest shot (never the opening or the closing shot) takes
 * the unused media in the pool that best matches the critic's words and the line's subject, when it matches better
 * than what is there. Media tagged for another line, the old game's pictures and trailer frames are never taken; a
 * clip must run the whole shot. Returns a new plan, or undefined when nothing better is in the pool.
 */
export function fixWeakest(
  plan: RenderPlan,
  ctx: PanelContext,
  line: number,
  shouldShow: string,
): { plan: RenderPlan; fix: PanelFix } | undefined {
  const seg = line - 1;
  const segment = ctx.segments[seg];
  if (!segment || !shouldShow.trim()) return undefined;
  const beat = beatOf(ctx.segments)[seg];
  const last = plan.shots.length - 1;
  const mine = plan.shots
    .map((s, n) => ({ s, n }))
    .filter(({ s, n }) => s.segment === seg && n > 0 && n < last)
    .sort((a, b) => b.s.end - b.s.start - (a.s.end - a.s.start) || a.n - b.n);
  const target = mine[0];
  if (!target) return undefined;
  const want = new Set([...tokens(shouldShow), ...subjectOf(ctx, seg)]);
  const current = mediaOf(ctx, target.s);
  const currentScore = current ? matchScore(current, want) : 0;
  const used = new Set(plan.shots.map(mediaKey).filter(Boolean));
  const fits = (m: CardMedia): boolean => {
    if (m.then || m.frame) return false;
    if (m.beatIndex !== undefined && m.beatIndex !== beat) return false;
    if (m.role === "hook" && segment.kind !== "hook") return false;
    if (
      m.targetKey &&
      !(
        m.targetKey === `beat:${beat}` ||
        m.targetKey.startsWith(`beat:${beat}#`) ||
        m.targetKey === segment.kind
      )
    )
      return false;
    return true;
  };
  const len = target.s.end - target.s.start;
  const pool: Array<{
    type: "image" | "clip";
    index: number;
    m: CardMedia;
    score: number;
  }> = [
    ...ctx.clips.map((m, index) => ({
      type: "clip" as const,
      index,
      m,
      score: matchScore(m, want),
    })),
    ...ctx.images.map((m, index) => ({
      type: "image" as const,
      index,
      m,
      score: matchScore(m, want),
    })),
  ].filter(
    (x) =>
      !used.has(`${x.type}:${x.index}`) &&
      fits(x.m) &&
      x.score > currentScore &&
      (x.type === "image" ||
        (x.m.seconds ?? 0) * plan.fps + FREEZE_TOLERANCE >= len),
  );
  pool.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.m.moving) - Number(a.m.moving) ||
      a.index - b.index,
  );
  const best = pool[0];
  if (!best) return undefined;
  const quiet = QUIET_KINDS.has(segment.visual?.kind ?? "none");
  const shots: Shot[] = plan.shots.map((s, n) =>
    n === target.n
      ? {
          ...s,
          media:
            best.type === "clip"
              ? { type: "clip", index: best.index, trimFrom: 0 }
              : { type: "image", index: best.index },
          framed:
            best.type === "image"
              ? quiet ||
                (best.m.aspect !== undefined &&
                  isFramedStill({ kind: best.m.kind, aspect: best.m.aspect }))
              : quiet,
          luma: best.m.luma ?? 128,
        }
      : s,
  );
  const name = (m: CardMedia | undefined, k: string) =>
    `${k}${m?.title ? ` "${m.title}"` : ""}`;
  return {
    plan: { ...plan, shots },
    fix: {
      line,
      shot: target.n,
      from: name(current, mediaKey(target.s) ?? target.s.media.type),
      to: name(best.m, `${best.type}:${best.index}`),
      why: shouldShow.trim().slice(0, 160),
    },
  };
}

// ---------------------------------------------------------------- the run

export interface PanelCandidateRecord {
  label: string;
  how: string;
  grade: Rubric["grade"];
  measures: PlanMeasures;
  measure_mark: number;
  dropped?: string;
  critic?: {
    overall: number;
    lines: number[];
    weakest: number;
    should_show: string;
  };
  predicted?: number;
  mark?: number;
}

/** The panel's record on the episode (assets.plan_panel). */
export interface PlanPanelRecord {
  at: string;
  arm: PanelArm;
  mode: Exclude<PanelMode, "off">;
  candidates: PanelCandidateRecord[];
  /** The label of the plan kept ("A" is the plan as built). */
  pick?: string;
  fix?: PanelFix & { kept: boolean; measures?: PlanMeasures };
  calls: { critic: number };
  /** Why nothing changed when the arm was on (every plan red, a failed read). */
  note?: string;
  error?: string;
}

export interface PanelRun {
  mode: Exclude<PanelMode, "off">;
  arm: PanelArm;
  input: PlanInput;
  /** The plan the factory built from `input`. */
  base: RenderPlan;
  ctx: PanelContext;
  recent: readonly PlanSignature[];
  /** SHOT_PLAN_CANDIDATES. */
  candidates: number;
  rubric: (plan: RenderPlan) => Rubric;
  /** The critic's read of one plan card; absent, nothing is read (the proof tool without --yes-spend). */
  read?: (card: string) => Promise<PlanCriticRead>;
  /** The retention model's predicted average watched (percent) for a plan; absent or undefined when there is no model. */
  predict?: (plan: RenderPlan) => number | undefined;
  build?: (i: PlanInput) => RenderPlan;
  now: Date;
}

const criticOf = (
  r: PlanCriticRead,
  lines: number,
): PanelCandidateRecord["critic"] => ({
  overall: r.overall,
  lines: Array.from(
    { length: lines },
    (_, k) => r.lines.find((l) => l.line === k + 1)?.mark ?? -1,
  ),
  weakest: r.weakest_line,
  should_show: r.should_show.slice(0, 200),
});

/**
 * Runs the panel (pure but for the injected read): returns the plan to render (the base plan unless "on" picked
 * another) and the record. The control arm and "check" never change the plan. Never throws: a failed read is recorded
 * and the plans are marked on their measurements alone.
 */
export async function runPanel(
  r: PanelRun,
): Promise<{ plan: RenderPlan; record: PlanPanelRecord }> {
  const calls = { critic: 0 };
  const lines = r.ctx.segments.length;
  const describe = (
    label: string,
    how: string,
    plan: RenderPlan,
  ): PanelCandidateRecord => {
    const measures = measurePlan(plan, r.ctx, r.recent);
    return {
      label,
      how,
      grade: r.rubric(plan).grade,
      measures,
      measure_mark: measureMark(measures),
    };
  };
  const record: PlanPanelRecord = {
    at: r.now.toISOString(),
    arm: r.arm,
    mode: r.mode,
    candidates: [],
    calls,
  };
  const read = async (
    plan: RenderPlan,
  ): Promise<PlanCriticRead | undefined> => {
    if (!r.read || calls.critic >= PANEL.readsMax) return undefined;
    calls.critic++;
    try {
      return await r.read(planCard(plan, r.ctx));
    } catch (err) {
      record.error = String((err as Error)?.message ?? err).slice(0, 200);
      return undefined;
    }
  };
  const predict = (plan: RenderPlan) => {
    try {
      const p = r.predict?.(plan);
      return typeof p === "number" && Number.isFinite(p)
        ? Math.round(p * 10) / 10
        : undefined;
    } catch {
      return undefined;
    }
  };
  // The control arm: the measurements only, for the weekly comparison.
  if (r.arm === "control") {
    record.candidates.push(describe("A", "the plan as built", r.base));
    return { plan: r.base, record };
  }
  if (r.mode === "check") {
    const c = describe("A", "the plan as built", r.base);
    const got = await read(r.base);
    if (got) c.critic = criticOf(got, lines);
    const p = predict(r.base);
    if (p !== undefined) c.predicted = p;
    record.candidates.push(c);
    record.pick = "A";
    return { plan: r.base, record };
  }
  // "on": the candidates, red ones dropped, one read each for the distinct ones.
  const built = buildCandidates(r.input, r.candidates, r.base, r.build);
  const seen = new Map<string, string>();
  const live: Array<{ rec: PanelCandidateRecord; plan: RenderPlan }> = [];
  for (const { spec, plan } of built) {
    const rec = describe(spec.label, spec.how, plan);
    record.candidates.push(rec);
    if (rec.grade === "red") {
      rec.dropped = "red on the rubric";
      continue;
    }
    const card = planCard(plan, r.ctx);
    const twin = seen.get(card);
    if (twin) {
      rec.dropped = `the same pictures as ${twin}`;
      continue;
    }
    seen.set(card, spec.label);
    live.push({ rec, plan });
  }
  if (!live.length) {
    record.note = "every plan red on the rubric: left to the rebuild";
    return { plan: r.base, record };
  }
  for (const c of live) {
    const got = await read(c.plan);
    if (got) c.rec.critic = criticOf(got, lines);
    const p = predict(c.plan);
    if (p !== undefined) c.rec.predicted = p;
  }
  const marks = panelMarks(
    live.map((c) => ({
      label: c.rec.label,
      measureMark: c.rec.measure_mark,
      overall: c.rec.critic?.overall,
      predicted: c.rec.predicted,
    })),
  );
  live.forEach((c, i) => (c.rec.mark = marks[i]));
  const chosen = live[pickCandidate(marks)]!;
  record.pick = chosen.rec.label;
  let plan = chosen.plan;
  // One fix on the weakest line, re-measured and re-graded; kept only when the plan stays out of red and the line
  // now carries its subject.
  const weak = chosen.rec.critic;
  if (weak && weak.weakest > 0) {
    const fixed = fixWeakest(plan, r.ctx, weak.weakest, weak.should_show);
    if (fixed) {
      const grade = r.rubric(fixed.plan).grade;
      const measures = measurePlan(fixed.plan, r.ctx, r.recent);
      const shot = fixed.plan.shots[fixed.fix.shot]!;
      const kept = grade !== "red" && carriesLine(r.ctx, shot);
      record.fix = { ...fixed.fix, kept, measures };
      if (kept) plan = fixed.plan;
    }
  }
  return { plan, record };
}

/** The panel's event (pure): the record without the full measurements of dropped plans. */
export function panelEvent(rec: PlanPanelRecord): Record<string, unknown> {
  return {
    arm: rec.arm,
    mode: rec.mode,
    pick: rec.pick,
    calls: rec.calls,
    candidates: rec.candidates.map((c) => ({
      label: c.label,
      grade: c.grade,
      dropped: c.dropped,
      overall: c.critic?.overall,
      weakest: c.critic?.weakest,
      measure_mark: c.measure_mark,
      predicted: c.predicted,
      mark: c.mark,
    })),
    fix: rec.fix
      ? {
          line: rec.fix.line,
          from: rec.fix.from,
          to: rec.fix.to,
          kept: rec.fix.kept,
        }
      : undefined,
    note: rec.note,
    error: rec.error,
  };
}

/** What the weekly report reads from a record (pure): the arm, the kept plan's critic mark and measurements. */
export function panelSummary(rec: PlanPanelRecord | undefined):
  | {
      arm: PanelArm;
      mark?: number;
      changed: boolean;
      measures?: PlanMeasures;
    }
  | undefined {
  if (!rec?.arm) return undefined;
  const kept =
    rec.candidates.find((c) => c.label === (rec.pick ?? "A")) ??
    rec.candidates[0];
  return {
    arm: rec.arm,
    ...(kept?.critic ? { mark: kept.critic.overall } : {}),
    changed: (rec.pick ?? "A") !== "A" || !!rec.fix?.kept,
    ...(rec.fix?.kept && rec.fix.measures
      ? { measures: rec.fix.measures }
      : kept
        ? { measures: kept.measures }
        : {}),
  };
}

// ---------------------------------------------------------------- the weekly report

/** The measurements the weekly report puts against average viewed, with their names. */
const REPORT_MEASURES: Array<[string, (m: PlanMeasures) => number]> = [
  ["moving share", (m) => m.moving],
  ["distinct media", (m) => m.distinct],
  ["longest run", (m) => m.longestRun],
  ["most uses of one media", (m) => m.maxUses],
  ["first shot", (m) => m.firstShot],
  ["off-subject lines", (m) => (m.lines ? m.offSubject.length / m.lines : 0)],
  ["sameness", (m) => m.sameness],
];

/**
 * The weekly report's panel lines (pure): per arm, Shorts and average viewed; from PANEL.verdictMin a side, the
 * difference; the critic's mark and each measurement against average viewed (rank correlation, from PANEL.verdictMin
 * Shorts). `corr` is the report's own Spearman.
 */
export function panelLinesForReport(
  rows: Array<{
    arm?: PanelArm;
    mark?: number;
    changed?: boolean;
    measures?: PlanMeasures;
    viewed_pct?: number;
  }>,
  corr: (xs: number[], ys: number[]) => number | undefined,
): string[] {
  const all = rows.filter((r) => r.arm);
  if (!all.length) return [];
  const has = (r: (typeof all)[number]) =>
    typeof r.viewed_pct === "number" && Number.isFinite(r.viewed_pct);
  const avg = (xs: number[]) =>
    xs.reduce((a, v) => a + v, 0) / (xs.length || 1);
  const panel = all.filter((r) => r.arm === "panel");
  const control = all.filter((r) => r.arm === "control");
  const vp = panel.filter(has).map((r) => r.viewed_pct!);
  const vc = control.filter(has).map((r) => r.viewed_pct!);
  const side = (label: string, xs: typeof all, v: number[]) =>
    `${label} ${xs.length} Shorts${label === "panel arm" ? ` (${xs.filter((r) => r.changed).length} with a changed plan)` : ""}, average viewed ${v.length ? `${avg(v).toFixed(1)}%` : "n/a"}`;
  const verdict =
    vp.length >= PANEL.verdictMin && vc.length >= PANEL.verdictMin
      ? `Shot plan panel verdict: average viewed ${avg(vp).toFixed(1)}% in the panel's arm against ${avg(vc).toFixed(1)}% in the control arm (${(avg(vp) - avg(vc)).toFixed(1)} points, ${vp.length} against ${vc.length} Shorts).`
      : `Shot plan panel verdict: ${vp.length} panel and ${vc.length} control Shorts with retention data; no verdict before ${PANEL.verdictMin} a side.`;
  const against = (label: string, xs: Array<{ x: number; v: number }>) => {
    if (xs.length < PANEL.verdictMin)
      return `${label} ${xs.length} of ${PANEL.verdictMin} so far`;
    const rho = corr(
      xs.map((a) => a.x),
      xs.map((a) => a.v),
    );
    return `${label} ${rho === undefined ? "n/a" : rho.toFixed(2)} over ${xs.length}`;
  };
  const marked = all
    .filter((r) => has(r) && typeof r.mark === "number")
    .map((r) => ({ x: r.mark!, v: r.viewed_pct! }));
  const measured = all.filter((r) => has(r) && r.measures);
  return [
    `Shot plan panel (SHOT_PLAN_PANEL), by side: ${[side("panel arm", panel, vp), side("control arm", control, vc)].join("; ")}.`,
    verdict,
    `Shot plan panel against average viewed (rank correlation): ${[
      against("picture editor critic's mark", marked),
      ...REPORT_MEASURES.map(([label, f]) =>
        against(
          label,
          measured.map((r) => ({ x: f(r.measures!), v: r.viewed_pct! })),
        ),
      ),
    ].join("; ")}.`,
  ];
}

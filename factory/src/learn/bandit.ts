// Thompson sampling for the growth tests (LEARN_BANDIT, research item 3). src/growth.ts tests one thing at a time and
// gives each side half the Shorts until its verdict, weeks later. Here every open factor (the hook style, the cold-open
// length, the title shape) is tested at once: each news Short draws one arm of each, so their effects are estimated
// separately (a factorial design), and traffic leans towards the arm most likely to be best as evidence comes in.
//
// The model, per factor, on the share still watching at three seconds:
// - each Short's value is first measured against its own baseline: the mean of Shorts of its format and story type,
//   shrunk towards the format's mean and that towards the channel's (so a GTA launch week does not look like an arm);
// - an arm's effect is a normal posterior pooled across formats (what the arm does everywhere), and the arm's effect in
//   one format is that pooled effect updated by the format's own Shorts (partial pooling: a format with few Shorts
//   borrows from the rest, one with many speaks for itself);
// - older Shorts count for less (a half-life, 21 days by default), since YouTube's feed shifts week to week.
// Each Short's arm is drawn by top-two Thompson sampling (built for finding the best arm rather than for this week's
// numbers) with a floor share per live arm (15%), so no arm starves before its verdict. With three or more arms, an arm
// under a 5% chance of being best after 8 Shorts is retired. The draw is seeded by the episode, so a retry keeps its
// arms, and its probability is recorded for unbiased estimates.
//
// The bootstrap of src/growth.ts remains the final verdict: a factor is settled only when growth.ts's own judge
// (judgeTest: six a side, 90 of 100 resamples, a two-point lead, no loss of average viewed) calls a winner on it.

import type { Db } from "../db.ts";
import {
  GROWTH_TESTS,
  judgeTest,
  readGrowthState,
  writeGrowthState,
  type TestShort,
} from "../growth.ts";
import { writeOverride } from "../experiments.ts";
import { logEvent } from "../episodes.ts";
import type { LearnSettings } from "./settings.ts";
import { loadOutcomes, type Outcome } from "./outcomes.ts";
import { mean, normal, rng, seedOf } from "./stats.ts";

export interface Factor {
  key: string;
  arms: string[];
  labels: Record<string, string>;
}

/** The growth tests the bandit runs: the writer-side ones (the clean frame is a render test and stays in growth.ts). */
export const BANDIT_FACTORS: Factor[] = GROWTH_TESTS.filter((t) =>
  t.variants.every((v) => v.instruction.trim()),
).map((t) => ({
  key: t.key,
  arms: t.variants.map((v) => v.id),
  labels: Object.fromEntries(t.variants.map((v) => [v.id, v.label])),
}));

export interface Obs {
  episodeId: string;
  factor: string;
  arm: string;
  format: string;
  stratum?: string;
  y: number;
  at: string;
}

export interface ArmPosterior {
  arm: string;
  mean: number;
  sd: number;
  n: number;
}

export interface ModelOptions {
  now: Date;
  halfLifeDays: number;
  /** Prior SD of an arm's effect (0.05: five points of the 3-second hold). */
  priorSd?: number;
  /** How far an arm's effect may differ between formats (SD). */
  tau?: number;
  /** Pseudo-Shorts of shrinkage for the format and story-type baselines. */
  shrink?: number;
}

const weight = (at: string, o: ModelOptions) =>
  0.5 **
  (Math.max(0, o.now.getTime() - Date.parse(at)) / 86_400_000 / o.halfLifeDays);

/** Each observation's value against its shrunk format-and-story-type baseline (pure). */
export function residuals(
  obs: Obs[],
  o: ModelOptions,
): Array<Obs & { r: number; w: number }> {
  const k = o.shrink ?? 5;
  const ws = obs.map((x) => weight(x.at, o));
  const wsum = ws.reduce((s, w) => s + w, 0);
  const grand = wsum ? obs.reduce((s, x, i) => s + x.y * ws[i]!, 0) / wsum : 0;
  const acc = (key: (x: Obs) => string) => {
    const m = new Map<string, { s: number; w: number }>();
    obs.forEach((x, i) => {
      const a = m.get(key(x)) ?? { s: 0, w: 0 };
      a.s += x.y * ws[i]!;
      a.w += ws[i]!;
      m.set(key(x), a);
    });
    return m;
  };
  const byFormat = acc((x) => x.format);
  const byStratum = acc((x) => `${x.format}|${x.stratum ?? ""}`);
  const fmt = (f: string) => {
    const a = byFormat.get(f)!;
    return (a.s + k * grand) / (a.w + k);
  };
  return obs.map((x, i) => {
    const f = fmt(x.format);
    const a = byStratum.get(`${x.format}|${x.stratum ?? ""}`)!;
    const base = (a.s + k * f) / (a.w + k);
    return { ...x, r: x.y - base, w: ws[i]! };
  });
}

/** Each arm's posterior effect in one format (pure). */
export function posteriors(
  obs: Obs[],
  factor: Factor,
  format: string,
  o: ModelOptions,
): ArmPosterior[] {
  const s0 = o.priorSd ?? 0.05;
  const tau = o.tau ?? 0.02;
  const res = residuals(
    obs.filter((x) => x.factor === factor.key),
    o,
  );
  const wsum = res.reduce((s, x) => s + x.w, 0);
  const sigma2 = Math.max(
    0.02 ** 2,
    wsum ? res.reduce((s, x) => s + x.w * x.r * x.r, 0) / wsum : 0.1 ** 2,
  );
  return factor.arms.map((arm) => {
    const mine = res.filter((x) => x.arm === arm);
    // pooled across the other formats
    const other = mine.filter((x) => x.format !== format);
    const pPrec = 1 / s0 ** 2 + other.reduce((s, x) => s + x.w, 0) / sigma2;
    const pMean = other.reduce((s, x) => s + x.w * x.r, 0) / sigma2 / pPrec;
    // then this format's own Shorts
    const here = mine.filter((x) => x.format === format);
    const priorVar = 1 / pPrec + tau ** 2;
    const prec = 1 / priorVar + here.reduce((s, x) => s + x.w, 0) / sigma2;
    const m =
      (pMean / priorVar + here.reduce((s, x) => s + x.w * x.r, 0) / sigma2) /
      prec;
    return { arm, mean: m, sd: Math.sqrt(1 / prec), n: mine.length };
  });
}

/** P(best) per arm and the top-two Thompson allocation, by Monte Carlo (pure, seeded). */
export function thompson(
  post: ArmPosterior[],
  o: { draws?: number; seed?: number; beta?: number } = {},
): { pBest: Record<string, number>; topTwo: Record<string, number> } {
  const draws = o.draws ?? 4000;
  const beta = o.beta ?? 0.5;
  const r = rng(o.seed ?? 3);
  const best: Record<string, number> = Object.fromEntries(
    post.map((p) => [p.arm, 0]),
  );
  const alloc: Record<string, number> = Object.fromEntries(
    post.map((p) => [p.arm, 0]),
  );
  for (let d = 0; d < draws; d++) {
    const s = post
      .map((p) => ({ arm: p.arm, v: p.mean + p.sd * normal(r) }))
      .sort((a, b) => b.v - a.v);
    best[s[0]!.arm]!++;
    alloc[s[0]!.arm]! += beta;
    alloc[(s[1] ?? s[0])!.arm]! += 1 - beta;
  }
  for (const k of Object.keys(best)) {
    best[k] = best[k]! / draws;
    alloc[k] = alloc[k]! / draws;
  }
  return { pBest: best, topTwo: alloc };
}

/** Shares with a floor per arm, summing to one (pure). */
export function withFloor(
  shares: Record<string, number>,
  floor: number,
): Record<string, number> {
  const arms = Object.keys(shares);
  const f = Math.min(floor, 1 / arms.length);
  const spare = 1 - f * arms.length;
  const total = arms.reduce((s, a) => s + shares[a]!, 0) || 1;
  return Object.fromEntries(
    arms.map((a) => [a, f + (spare * shares[a]!) / total]),
  );
}

/** The arm a uniform number falls on (pure). */
export function pick(shares: Record<string, number>, u: number): string {
  const arms = Object.keys(shares).sort();
  let acc = 0;
  for (const a of arms) {
    acc += shares[a]!;
    if (u < acc) return a;
  }
  return arms.at(-1)!;
}

/** Arms to retire: with three or more live, any under 5% chance of best after 8 Shorts (never the last two). */
export function toRetire(
  post: ArmPosterior[],
  pBest: Record<string, number>,
): string[] {
  if (post.length < 3) return [];
  const out = post
    .filter((p) => p.n >= 8 && (pBest[p.arm] ?? 0) < 0.05)
    .map((p) => p.arm);
  return post.length - out.length >= 2 ? out : out.slice(0, post.length - 2);
}

export interface Draw {
  factor: string;
  arm: string;
  propensity: number;
  pBest: Record<string, number>;
  shares: Record<string, number>;
}

/** One Short's arm for one factor (pure): the posterior, the allocation with its floor, a draw seeded by the episode. */
export function drawFor(
  obs: Obs[],
  factor: Factor,
  live: string[],
  ep: { id: string; format: string },
  o: ModelOptions & { floor: number; draws?: number },
): Draw {
  const f: Factor = {
    ...factor,
    arms: factor.arms.filter((a) => live.includes(a)),
  };
  const post = posteriors(obs, f, ep.format, o);
  const t = thompson(post, { seed: seedOf(`${ep.id}:${factor.key}:mc`), draws: o.draws });
  const shares = withFloor(t.topTwo, o.floor);
  const u = rng(seedOf(`${ep.id}:${factor.key}`))();
  const arm = pick(shares, u);
  return {
    factor: factor.key,
    arm,
    propensity: shares[arm]!,
    pBest: t.pBest,
    shares,
  };
}

// ---- The database side ---------------------------------------------------------------------------

/** Every Short with an arm and a 3-second hold: the bandit's own draws (live ones) and growth.ts's alternate turns. */
export async function observations(
  db: Db,
  outcomes?: Outcome[],
): Promise<Obs[]> {
  const outs = outcomes ?? (await loadOutcomes(db));
  const byId = new Map(
    outs.filter((o) => o.hold3 !== undefined).map((o) => [o.episodeId, o]),
  );
  const out: Obs[] = [];
  const seen = new Set<string>();
  const own = await db.query<{
    episode_id: string;
    factor: string;
    arm: string;
    assigned_at: string;
  }>(
    `SELECT episode_id, factor, arm, assigned_at FROM bandit_assignments WHERE mode = 'on'`,
  );
  for (const r of own) {
    const o = byId.get(r.episode_id);
    if (!o) continue;
    seen.add(`${r.episode_id}|${r.factor}`);
    out.push({
      episodeId: r.episode_id,
      factor: r.factor,
      arm: r.arm,
      format: o.format,
      stratum: o.storyType,
      y: o.hold3!,
      at: new Date(o.publishedAt ?? r.assigned_at).toISOString(),
    });
  }
  const legacy = await db.query<{
    id: string;
    key: string;
    variant: string;
    created_at: string;
  }>(
    `SELECT id, assets_json->'test'->>'key' AS key, assets_json->'test'->>'variant' AS variant, created_at
       FROM episodes WHERE assets_json->'test' IS NOT NULL AND status = 'published'`,
  );
  for (const r of legacy) {
    const o = byId.get(r.id);
    if (!o || !r.key || !r.variant || seen.has(`${r.id}|${r.key}`)) continue;
    out.push({
      episodeId: r.id,
      factor: r.key,
      arm: r.variant,
      format: o.format,
      stratum: o.storyType,
      y: o.hold3!,
      at: new Date(o.publishedAt ?? r.created_at).toISOString(),
    });
  }
  return out;
}

/** The factors still open: not settled by growth.ts (a winner or a closed test) and not the render-side test. */
export async function openFactors(db: Db): Promise<Factor[]> {
  const state = await readGrowthState(db);
  const done = new Set(state.done.map((d) => d.key));
  return BANDIT_FACTORS.filter((f) => !done.has(f.key));
}

async function liveArms(db: Db, factor: Factor): Promise<string[]> {
  const rows = await db.query<{ arm: string; status: string }>(
    `SELECT arm, status FROM bandit_arms WHERE factor = $1`,
    [factor.key],
  );
  const retired = new Set(
    rows.filter((r) => r.status === "retired").map((r) => r.arm),
  );
  return factor.arms.filter((a) => !retired.has(a));
}

/**
 * The arms for a news Short being written: one per open factor, recorded with its probability. In shadow mode they
 * are recorded only (the Short is written as before); a retry reads back the arms it already drew.
 */
export async function banditAssign(
  db: Db,
  ls: Pick<LearnSettings, "bandit" | "banditFloor" | "banditHalfLifeDays">,
  ep: { id: string; format: string; stratum?: string },
  now: Date,
): Promise<Draw[]> {
  if (ls.bandit === "off") return [];
  const prior = await db.query<{
    factor: string;
    arm: string;
    propensity: number;
  }>(
    `SELECT factor, arm, propensity FROM bandit_assignments WHERE episode_id = $1`,
    [ep.id],
  );
  if (prior.length)
    return prior.map((p) => ({
      factor: p.factor,
      arm: p.arm,
      propensity: Number(p.propensity),
      pBest: {},
      shares: {},
    }));
  const obs = await observations(db);
  const out: Draw[] = [];
  for (const f of await openFactors(db)) {
    const live = await liveArms(db, f);
    if (live.length < 2) continue;
    const d = drawFor(obs, f, live, ep, {
      now,
      halfLifeDays: ls.banditHalfLifeDays,
      floor: ls.banditFloor,
    });
    await db.query(
      `INSERT INTO bandit_assignments (episode_id, factor, arm, format, stratum, propensity, mode) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
      [
        ep.id,
        f.key,
        d.arm,
        ep.format,
        ep.stratum ?? null,
        d.propensity,
        ls.bandit,
      ],
    );
    out.push(d);
  }
  return out;
}

/** The bandit's arms in growth.ts's defaults shape, for growthNotes and growthProblems (the factor under test aside). */
export function drawsAsDefaults(
  draws: Draw[],
  except?: string,
): Array<{ test: (typeof GROWTH_TESTS)[number]; variant: "A" | "B" }> {
  const out: Array<{
    test: (typeof GROWTH_TESTS)[number];
    variant: "A" | "B";
  }> = [];
  for (const d of draws) {
    if (d.factor === except) continue;
    const test = GROWTH_TESTS.find((t) => t.key === d.factor);
    if (test && (d.arm === "A" || d.arm === "B"))
      out.push({ test, variant: d.arm });
  }
  return out;
}

export interface FactorStatus {
  factor: string;
  n: Record<string, number>;
  means: Record<string, number>;
  pBest: Record<string, number>;
  shares: Record<string, number>;
  verdict?: { winner?: string; reason: string; prob: number };
}

/** Where each open factor stands (for the weekly summary), using the "news" format's view. */
export async function banditStatus(
  db: Db,
  ls: Pick<LearnSettings, "banditFloor" | "banditHalfLifeDays">,
  now: Date,
): Promise<FactorStatus[]> {
  const obs = await observations(db);
  const out: FactorStatus[] = [];
  for (const f of await openFactors(db)) {
    const live = await liveArms(db, f);
    const d = drawFor(
      obs,
      f,
      live,
      { id: "status", format: "news" },
      { now, halfLifeDays: ls.banditHalfLifeDays, floor: ls.banditFloor },
    );
    const mine = obs.filter((x) => x.factor === f.key);
    out.push({
      factor: f.key,
      n: Object.fromEntries(
        f.arms.map((a) => [a, mine.filter((x) => x.arm === a).length]),
      ),
      means: Object.fromEntries(
        f.arms.map((a) => [
          a,
          mean(mine.filter((x) => x.arm === a).map((x) => x.y)),
        ]),
      ),
      pBest: d.pBest,
      shares: d.shares,
    });
  }
  return out;
}

/**
 * The weekly verdicts on the factors the bandit runs alongside growth.ts's current test: growth.ts's own bootstrap on
 * the bandit's Shorts. A winner becomes the default exactly as a growth.ts winner does, and the test is marked done so
 * growth.ts never re-runs it. Retires hopeless arms of factors with three or more.
 */
export async function banditVerdicts(
  db: Db,
  ls: Pick<LearnSettings, "bandit" | "banditFloor" | "banditHalfLifeDays" | "banditWinProb">,
  now: Date,
  notify?: (m: { content: string }) => Promise<unknown>,
): Promise<FactorStatus[]> {
  if (ls.bandit !== "on") return [];
  const state = await readGrowthState(db);
  const status = await banditStatus(db, ls, now);
  const obs = await observations(db);
  const outs = new Map((await loadOutcomes(db)).map((o) => [o.episodeId, o]));
  for (const s of status) {
    const f = BANDIT_FACTORS.find((x) => x.key === s.factor)!;
    // retirement (three arms or more only)
    const post = posteriors(obs, f, "news", {
      now,
      halfLifeDays: ls.banditHalfLifeDays,
    });
    for (const arm of toRetire(post, s.pBest))
      await db.query(
        `INSERT INTO bandit_arms (factor, arm, status, reason) VALUES ($1, $2, 'retired', $3) ON CONFLICT (factor, arm) DO UPDATE SET status = 'retired', reason = EXCLUDED.reason, changed_at = now()`,
        [
          f.key,
          arm,
          `under 5% chance of best after ${post.find((p) => p.arm === arm)?.n} Shorts`,
        ],
      );
    if (state.current?.key === f.key) continue; // growth.ts judges its own current test
    const rows: TestShort[] = obs
      .filter((x) => x.factor === f.key && (x.arm === "A" || x.arm === "B"))
      .map((x) => ({
        id: x.episodeId,
        variant: x.arm as "A" | "B",
        hold3: x.y,
        pct: outs.get(x.episodeId)?.apv,
      }));
    const j = judgeTest(rows, 7, ls.banditWinProb);
    s.verdict = { winner: j.winner, reason: j.reason, prob: j.prob };
    if (!j.winner) continue;
    await writeOverride(
      db,
      `override:growth_${f.key}`,
      j.winner === "B" ? 1 : 0,
    );
    state.done.push({ key: f.key, winner: j.winner, at: now.toISOString() });
    await writeGrowthState(db, state);
    await db.query(
      `INSERT INTO bandit_arms (factor, arm, status, reason) VALUES ($1, $2, 'winner', 'bootstrap verdict') ON CONFLICT (factor, arm) DO UPDATE SET status = 'winner', changed_at = now()`,
      [f.key, j.winner],
    );
    await logEvent(db, null, "bandit_verdict", {
      factor: f.key,
      winner: j.winner,
      prob: Math.round(j.prob * 100) / 100,
      a: j.a.n,
      b: j.b.n,
    });
    if (notify)
      await notify({
        content: `**Bandit verdict: ${f.key.replace(/_/g, " ")}.** ${f.labels[j.winner]} held more viewers through the first 3 seconds in ${Math.round((j.winner === "B" ? j.prob : 1 - j.prob) * 100)} of 100 resamples (${j.a.n} and ${j.b.n} Shorts). Every news Short now follows the ${f.labels[j.winner]} rule.`,
      });
  }
  return status;
}

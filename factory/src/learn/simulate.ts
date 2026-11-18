// The bandit's proof on the channel's own numbers (research item 3): a simulator that replays news Shorts with the
// spread of 3-second holds the channel actually gets, a known true difference between arms, and the real delay before
// a Short's curve arrives, then compares growth.ts's way (alternate turns, one factor at a time) with the bandit (all
// factors at once, top-two Thompson with a floor). Both use growth.ts's bootstrap rule for the verdict, at weekly
// checks. Also an offline replay of the logged hook-style test (Li et al. 2011's rejection replay). Pure and seeded.

import { judgeTest, type TestShort } from "../growth.ts";
import { drawFor, type Factor, type Obs } from "./bandit.ts";
import { mean, rng, seedOf } from "./stats.ts";

/** alternate: growth.ts today (turns, one factor at a time, 90 of 100); alternate_strict: the same with 97.5 of 100; bandit: all factors, Thompson, 97.5 of 100. */
export type Policy = "alternate" | "alternate_strict" | "bandit";
export const POLICIES: Policy[] = ["alternate", "alternate_strict", "bandit"];
const sequential = (p: Policy) => p !== "bandit";
const winProbOf = (p: Policy) => (p === "alternate" ? 0.9 : 0.975);

export interface SimFactor {
  key: string;
  /** True effect of arm B over arm A on the 3-second hold (A is 0). */
  gap: number;
}

export interface SimOptions {
  factors: SimFactor[];
  /** Residual noise to resample from (the channel's own holds minus their mean). */
  noise: number[];
  base: number;
  shortsPerDay: number;
  /** Days before a Short's curve can be read (2 with the 48-hour curves, 7 with the week-old ones). */
  lagDays: number;
  days: number;
  floor: number;
  /** Bootstrap checks: weekly from day 7, at most 4 per test (growth.ts's MIN_DAYS and MAX_CHECKS). */
  maxChecks: number;
  seed: number;
  mcDraws?: number;
}

export interface FactorResult {
  key: string;
  decidedDay?: number;
  winner?: "A" | "B";
  correct: boolean;
  falseWinner: boolean;
  shortsOnWorse: number;
  shortsInTest: number;
}

export interface SimResult {
  policy: Policy;
  factors: FactorResult[];
  /** Mean true 3-second hold of every Short made, against always making the best arms. */
  regretPerShort: number;
  allDecidedDay?: number;
}

const FACTOR = (key: string): Factor => ({
  key,
  arms: ["A", "B"],
  labels: { A: "A", B: "B" },
});

/** One run of one policy (pure, seeded). */
export function simulate(policy: Policy, o: SimOptions): SimResult {
  const r = rng(o.seed);
  const made: Array<{
    id: string;
    day: number;
    arms: Record<string, "A" | "B">;
    y: number;
    truth: number;
  }> = [];
  const state = new Map<
    string,
    {
      since: number;
      checks: number;
      winner?: "A" | "B";
      decidedDay?: number;
      closed?: boolean;
    }
  >();
  // alternate: one factor at a time, in order; bandit: all at once from day 0
  let seq = 0;
  if (sequential(policy))
    state.set(o.factors[0]!.key, { since: 0, checks: 0 });
  else for (const f of o.factors) state.set(f.key, { since: 0, checks: 0 });
  const best = o.factors.reduce((s, f) => s + Math.max(0, f.gap), 0);
  let regret = 0;
  let n = 0;
  const turn = new Map<string, number>();
  for (let day = 0; day < o.days; day++) {
    for (let k = 0; k < o.shortsPerDay; k++) {
      const id = `s${o.seed}-${n++}`;
      const arms: Record<string, "A" | "B"> = {};
      for (const f of o.factors) {
        const st = state.get(f.key);
        if (st?.winner) arms[f.key] = st.winner;
        else if (!st || st.closed)
          arms[f.key] = r() < 0.5 ? "A" : "B"; // untested or closed: the writer's free choice
        else if (sequential(policy)) {
          const t = turn.get(f.key) ?? 0;
          arms[f.key] = t % 2 === 0 ? "A" : "B";
          turn.set(f.key, t + 1);
        } else {
          const visible: Obs[] = made
            .filter((m) => m.day + o.lagDays <= day)
            .map((m) => ({
              episodeId: m.id,
              factor: f.key,
              arm: m.arms[f.key]!,
              format: "news",
              y: m.y,
              at: new Date(m.day * 86_400_000).toISOString(),
            }));
          const d = drawFor(
            visible,
            FACTOR(f.key),
            ["A", "B"],
            { id, format: "news" },
            {
              now: new Date(day * 86_400_000),
              halfLifeDays: 21,
              floor: o.floor,
              draws: o.mcDraws ?? 600,
            },
          );
          arms[f.key] = d.arm as "A" | "B";
        }
      }
      const truth =
        o.base +
        o.factors.reduce((s, f) => s + (arms[f.key] === "B" ? f.gap : 0), 0);
      const y = truth + o.noise[Math.floor(r() * o.noise.length)]!;
      made.push({ id, day, arms, y, truth });
      regret += o.base + best - truth;
    }
    // weekly bootstrap checks, from a week after each test began
    for (const f of o.factors) {
      const st = state.get(f.key);
      if (!st || st.winner || st.closed) continue;
      const age = day + 1 - st.since;
      if (age < 7 || age % 7 !== 0) continue;
      st.checks++;
      const rows: TestShort[] = made
        .filter((m) => m.day >= st.since && m.day + o.lagDays <= day)
        .map((m) => ({ id: m.id, variant: m.arms[f.key]!, hold3: m.y }));
      const j = judgeTest(rows, seedOf(`${o.seed}:${f.key}:${day}`), winProbOf(policy));
      if (j.winner) {
        st.winner = j.winner;
        st.decidedDay = day + 1;
      } else if (st.checks >= o.maxChecks) {
        st.closed = true;
        st.decidedDay = day + 1;
      }
      if (
        (st.winner || st.closed) &&
        sequential(policy) &&
        seq + 1 < o.factors.length
      ) {
        seq++;
        state.set(o.factors[seq]!.key, { since: day + 1, checks: 0 });
      }
    }
  }
  const factors = o.factors.map((f): FactorResult => {
    const st = state.get(f.key);
    const better = f.gap > 0 ? "B" : f.gap < 0 ? "A" : undefined;
    const inTest = made.filter(
      (m) =>
        st &&
        m.day >= st.since &&
        (st.decidedDay === undefined || m.day < st.decidedDay),
    );
    return {
      key: f.key,
      decidedDay: st?.decidedDay,
      winner: st?.winner,
      correct: better ? st?.winner === better : !st?.winner,
      falseWinner: !better && !!st?.winner,
      shortsOnWorse: better
        ? inTest.filter((m) => m.arms[f.key] !== better).length
        : 0,
      shortsInTest: inTest.length,
    };
  });
  const decided = factors.map((f) => f.decidedDay);
  return {
    policy,
    factors,
    regretPerShort: regret / Math.max(1, n),
    allDecidedDay: decided.every((d) => d !== undefined)
      ? Math.max(...(decided as number[]))
      : undefined,
  };
}

export interface Summary {
  policy: Policy;
  runs: number;
  correct: Record<string, number>;
  falseWinner: Record<string, number>;
  decidedDay: Record<string, number>;
  shortsOnWorse: Record<string, number>;
  regretPerShort: number;
  allDecided: number;
  allDecidedDay: number;
}

/** Many seeded runs of both policies on the same scenario (pure). */
export function compare(
  o: Omit<SimOptions, "seed">,
  runs: number,
  seed = 1,
): Summary[] {
  return POLICIES.map((policy) => {
    const res = Array.from({ length: runs }, (_, i) =>
      simulate(policy, { ...o, seed: seed * 1000 + i }),
    );
    const per = (fn: (f: FactorResult) => number | undefined) =>
      Object.fromEntries(
        o.factors.map((f) => {
          const xs = res
            .map((x) => fn(x.factors.find((y) => y.key === f.key)!))
            .filter((v): v is number => v !== undefined);
          return [f.key, xs.length ? mean(xs) : NaN];
        }),
      );
    const all = res.filter((x) => x.allDecidedDay !== undefined);
    return {
      policy,
      runs,
      correct: per((f) => (f.correct ? 1 : 0)),
      falseWinner: per((f) => (f.falseWinner ? 1 : 0)),
      decidedDay: per((f) => f.decidedDay),
      shortsOnWorse: per((f) => f.shortsOnWorse),
      regretPerShort: mean(res.map((x) => x.regretPerShort)),
      allDecided: all.length / runs,
      allDecidedDay: all.length ? mean(all.map((x) => x.allDecidedDay!)) : NaN,
    };
  });
}

/**
 * The rejection replay (Li et al. 2011) of a logged A/B test that alternated (so each arm was equally likely): walk the
 * Shorts in order; when the bandit, knowing only the accepted Shorts whose curves had arrived, picks the arm that was
 * actually made, the Short counts. The mean hold of the counted Shorts estimates what the bandit would have achieved.
 */
export function replay(
  logged: Array<{ id: string; arm: "A" | "B"; y: number; day: number }>,
  o: { floor: number; lagDays: number },
): {
  accepted: number;
  banditMean: number;
  loggedMean: number;
  shareB: number;
} {
  const accepted: typeof logged = [];
  for (const s of [...logged].sort((a, b) => a.day - b.day)) {
    const visible: Obs[] = accepted
      .filter((m) => m.day + o.lagDays <= s.day)
      .map((m) => ({
        episodeId: m.id,
        factor: "f",
        arm: m.arm,
        format: "news",
        y: m.y,
        at: new Date(m.day * 86_400_000).toISOString(),
      }));
    const d = drawFor(
      visible,
      FACTOR("f"),
      ["A", "B"],
      { id: s.id, format: "news" },
      { now: new Date(s.day * 86_400_000), halfLifeDays: 21, floor: o.floor },
    );
    if (d.arm === s.arm) accepted.push(s);
  }
  return {
    accepted: accepted.length,
    banditMean: mean(accepted.map((a) => a.y)),
    loggedMean: mean(logged.map((a) => a.y)),
    shareB:
      accepted.filter((a) => a.arm === "B").length /
      Math.max(1, accepted.length),
  };
}

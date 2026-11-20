// The Pip mascot test's scorecard (MASCOT_SHARE, from 14 Nov 2026): Shorts with Pip against the news and why Shorts
// made in the same weeks without him, on average viewed and subscribers per 1,000 views, from the shared outcomes
// (src/learn/outcomes.ts). Pure, so the weekly report and the proof tools read it the same way.
// Pass mark (C:\Claude\analytics\pulse\experiments.json, e4): 20+ Shorts a side, average viewed no worse than
// 1 point below and subscribers per 1,000 not lower. Otherwise Pip goes back to MASCOT_SHARE=0.

import type { Outcome } from "./outcomes.ts";

export const MASCOT_MIN_EACH = 20;
/** Average viewed may be this many points lower and still count as "not worse" (normal week-to-week noise). */
export const MASCOT_APV_SLACK = 1;

export interface MascotSide {
  n: number;
  apv?: number;
  subsPer1k?: number;
}

export interface MascotScore {
  with: MascotSide;
  without: MascotSide;
  verdict: "too_few" | "pass" | "fail";
}

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;

function side(xs: Outcome[]): MascotSide {
  const pick = (k: "apv" | "subsPer1k") =>
    mean(xs.map((o) => o[k]).filter((v): v is number => v !== undefined));
  return {
    n: xs.filter((o) => o.apv !== undefined).length,
    apv: pick("apv"),
    subsPer1k: pick("subsPer1k"),
  };
}

/** With Pip against without, among Shorts recorded in the test (pure). */
export function scoreMascot(outcomes: Outcome[]): MascotScore {
  const w = side(outcomes.filter((o) => o.mascot === true));
  const wo = side(outcomes.filter((o) => o.mascot === false));
  if (w.n < MASCOT_MIN_EACH || wo.n < MASCOT_MIN_EACH)
    return { with: w, without: wo, verdict: "too_few" };
  const apvOk = (w.apv ?? 0) >= (wo.apv ?? 0) - MASCOT_APV_SLACK;
  const subsOk = (w.subsPer1k ?? 0) >= (wo.subsPer1k ?? 0);
  return { with: w, without: wo, verdict: apvOk && subsOk ? "pass" : "fail" };
}

const f1 = (x?: number) => (x === undefined ? "n/a" : x.toFixed(1));

/** One plain line for the weekly report, or undefined before the test has any Shorts. */
export function mascotLine(s: MascotScore): string | undefined {
  if (!s.with.n && !s.without.n) return undefined;
  const body = `with him ${f1(s.with.apv)}% viewed and ${f1(s.with.subsPer1k)} subscribers per 1,000 (${s.with.n} Shorts), without ${f1(s.without.apv)}% and ${f1(s.without.subsPer1k)} (${s.without.n})`;
  if (s.verdict === "too_few")
    return `Pip test: ${body}; ${MASCOT_MIN_EACH} a side needed before it is judged.`;
  return s.verdict === "pass"
    ? `Pip test: ${body}. Passes: no worse on either measure, so he can stay.`
    : `Pip test: ${body}. Fails the pass mark: set MASCOT_SHARE=0.`;
}

// The humaniser's step in the pipeline (HUMANISE, src/editorial/humanise/humanise.ts), the same for Shorts and
// documentary chapters. "check" measures the settled script and logs it. "fix" applies the safe fixes, sends what they
// could not do to the delivery writer once with exact notes, then takes the best version that passes the fact guard
// (no figure, name or quotation moved, no house rule newly broken), still reads clearly where a clarity judge is
// given, and passes the fact check, which runs on the humanised words. Nothing passes: the settled script goes out.

import { errorMessage } from "./lib/util.ts";
import {
  humaniseLog,
  type HumaniseResult,
} from "./editorial/humanise/humanise.ts";

export interface HumaniseStepOutcome<T> {
  value: T;
  /** Which version went out: the settled one, the rule fixes or the writer's rewrite on top of them. */
  stage: "settled" | "rules" | "rewrite";
  log: Record<string, unknown>;
}

export async function humaniseStep<T>(o: {
  mode: "off" | "check" | "fix";
  value: T;
  /** The deterministic humaniser on a value (pure). */
  run: (v: T, mode: "check" | "fix") => { value: T; result: HumaniseResult };
  /** Deterministic problems with a humanised version against the settled one: drift and house rules. */
  problems: (before: T, after: T, removedFigures: string[]) => string[];
  /** The delivery writer, once, with the humaniser's notes. */
  rewrite?: (v: T, notes: string[]) => Promise<T>;
  /** True when a rewritten version still reads clearly (the clarity judge); rule fixes alone skip it. */
  clear?: (v: T) => Promise<boolean>;
  /** The fact check's blockers for a version; empty means it passed. Runs after the humaniser, on its words. */
  check: (v: T) => Promise<string[]>;
}): Promise<HumaniseStepOutcome<T>> {
  if (o.mode === "off") return { value: o.value, stage: "settled", log: {} };
  const rules = o.run(o.value, o.mode);
  const log: Record<string, unknown> = {
    mode: o.mode,
    ...humaniseLog(rules.result),
  };
  if (o.mode === "check") return { value: o.value, stage: "settled", log };
  const candidates: Array<{
    value: T;
    stage: "rules" | "rewrite";
    removed: string[];
    score: number;
  }> = [];
  const notes = rules.result.after.notes;
  if (notes.length && o.rewrite) {
    try {
      const written = await o.rewrite(rules.value, notes);
      const again = o.run(written, "fix");
      candidates.push({
        value: again.value,
        stage: "rewrite",
        removed: [
          ...rules.result.removedFigures,
          ...again.result.removedFigures,
        ],
        score: again.result.after.score,
      });
    } catch (err) {
      log.rewrite_failed = errorMessage(err).slice(0, 200);
    }
  }
  if (rules.result.changed)
    candidates.push({
      value: rules.value,
      stage: "rules",
      removed: rules.result.removedFigures,
      score: rules.result.after.score,
    });
  const why: string[] = [];
  for (const c of candidates) {
    // A rewrite that sounds no more human than the rule fixes alone isn't worth its risk.
    if (c.stage === "rewrite" && c.score < rules.result.after.score) {
      why.push(
        `rewrite scored ${c.score}, below the rule fixes' ${rules.result.after.score}`,
      );
      continue;
    }
    const guard = o.problems(o.value, c.value, c.removed);
    if (guard.length) {
      why.push(...guard.slice(0, 3).map((g) => `${c.stage}: ${g}`));
      continue;
    }
    try {
      if (c.stage === "rewrite" && o.clear && !(await o.clear(c.value))) {
        why.push("rewrite: the clarity judge scored it under the minimum");
        continue;
      }
      const blockers = await o.check(c.value);
      if (blockers.length) {
        why.push(
          ...blockers.slice(0, 3).map((b) => `${c.stage}: fact check: ${b}`),
        );
        continue;
      }
    } catch (err) {
      why.push(
        `${c.stage}: the check could not run: ${errorMessage(err).slice(0, 160)}`,
      );
      continue;
    }
    return {
      value: c.value,
      stage: c.stage,
      log: {
        ...log,
        kept: c.stage,
        score_kept: c.score,
        ...(why.length ? { why } : {}),
      },
    };
  }
  return {
    value: o.value,
    stage: "settled",
    log: { ...log, kept: "settled", ...(why.length ? { why } : {}) },
  };
}

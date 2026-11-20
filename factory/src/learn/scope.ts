// One wrapper around every episode step (src/pipeline.ts advance): decides the holdout side, gives a holdout step the
// pinned baseline's settings, files the step's model calls under the episode and stamps the step with its commit and
// settings. With LEARN_STAMPS off and no holdout share it calls the step straight through, changing nothing.

import type { Db } from "../db.ts";
import { log, errorMessage } from "../lib/util.ts";
import type { LearnSettings } from "./settings.ts";
import { applyBaseline, holdoutFor, type HoldoutDecision } from "./holdout.ts";
import {
  codeCommit,
  flushPrompts,
  inScope,
  newScope,
  overrideSnapshot,
  saveSnapshot,
  settingsSnapshot,
  stampStep,
} from "./stamps.ts";

export interface LearnHost {
  db: Db;
  cfg: { dataDir: string; learn: LearnSettings };
  now(): Date;
}

export async function withLearn<S extends LearnHost, T>(
  s: S,
  ep: { id: string; lane: string; status: string },
  fn: (s: S) => Promise<T>,
): Promise<T> {
  const ls = s.cfg.learn;
  if (!ls || (!ls.stamps && !(ls.holdoutShare > 0))) return fn(s);
  let run = s;
  let decision: HoldoutDecision = { profile: "live" };
  try {
    decision = await holdoutFor(s.db, s.cfg, ep, s.now());
    if (decision.profile === "holdout" && decision.hash && decision.baseline)
      run = {
        ...s,
        cfg: applyBaseline(s.cfg, decision.hash, decision.baseline),
      };
  } catch (err) {
    // The holdout must never stop a Short: on a fault the step runs live.
    log("warn", "holdout decision failed; the step runs live", {
      episode: ep.id,
      error: errorMessage(err),
    });
    decision = { profile: "live" };
  }
  if (!ls.stamps && decision.profile === "live") return fn(run);
  const sc = newScope(ep.id, ep.status);
  try {
    return ls.stamps ? await inScope(sc, () => fn(run)) : await fn(run);
  } finally {
    try {
      const calls = ls.stamps ? await flushPrompts(s.db, sc) : 0;
      const settings = await saveSnapshot(s.db, {
        config: settingsSnapshot(run.cfg),
        overrides: await overrideSnapshot(s.db),
      });
      await stampStep(
        s.db,
        ep.id,
        ep.status,
        {
          commit: codeCommit(s.cfg.dataDir),
          settings,
          at: s.now().toISOString(),
          calls,
        },
        { name: decision.profile, hash: decision.hash },
      );
    } catch (err) {
      log("warn", "episode stamp failed", {
        episode: ep.id,
        error: errorMessage(err),
      });
    }
  }
}

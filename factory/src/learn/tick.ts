// The learning core's turn in every pipeline tick (src/pipeline.ts tick). Each part runs only under its own setting and
// never throws: a fault is logged and the tick carries on.

import type { Db } from "../db.ts";
import type { Config } from "../config.ts";
import type { DiscordMessage } from "../approval/discord.ts";
import { log, errorMessage } from "../lib/util.ts";
import { learnAny } from "./settings.ts";
import { ingestIntents, observeChanges } from "./ledger.ts";
import { maybeRepin } from "./holdout.ts";
import { learnJobs } from "./weekly.ts";
import type { Llm } from "../editorial/llm.ts";

export interface LearnTickHost {
  db: Db;
  cfg: Config;
  now(): Date;
  notify(m: DiscordMessage): Promise<unknown>;
  /** For the weekly anchor re-scores (LEARN_ANCHORS). */
  llm?: Llm;
}

/** Extra weekly work other modules hang on the tick (judges, bandit, playbook, the summary), in order. */
export type LearnJob = {
  name: string;
  run: (s: LearnTickHost) => Promise<unknown>;
};
const jobs: LearnJob[] = [];
export function addLearnJob(job: LearnJob): void {
  if (!jobs.some((j) => j.name === job.name)) jobs.push(job);
}

async function safely(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log("warn", `learning core: ${name} failed`, { error: errorMessage(err) });
  }
}

export async function learnTick(s: LearnTickHost): Promise<void> {
  const ls = s.cfg.learn;
  if (!ls || !learnAny(ls)) return;
  const now = s.now();
  if (ls.stamps) {
    await safely("change ledger", () => observeChanges(s.db, s.cfg, now));
    await safely("intents", () => ingestIntents(s.db, s.cfg.dataDir, now));
  }
  if (ls.holdoutShare > 0)
    await safely("holdout pin", () =>
      maybeRepin(s.db, s.cfg, now, ls.holdoutRepinDays),
    );
  for (const j of [...learnJobs(), ...jobs]) await safely(j.name, () => j.run(s));
}

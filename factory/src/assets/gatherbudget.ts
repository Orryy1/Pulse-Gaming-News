// A time budget for a long video's media gather. The gather (store art, trailer downloads, licensed gameplay,
// archive photos, stock) runs entry by entry and on 30 Oct 2026 ran for hours on one ranking; the long lane
// is one tick, so everything behind it waited. The budget (GATHER_MAX_MINUTES, default 45) ends the gather
// with what it has: entries still to come get no gather of their own (the thin-entry top-up and the plate
// cover them), the owner hears once, and the episode carries on. It also yields early when an urgent long
// video (a slot within hours, still unscripted) is waiting for the lane. Pure apart from the clock, so the
// maths is tested without waiting.

import type { Db } from "../db.ts";
import { logEvent } from "../episodes.ts";
import { log } from "../lib/util.ts";

/** Thrown inside an entry's gather to leave it early once the budget is spent; the loop treats it as "done". */
export class GatherOutOfTime extends Error {
  override name = "GatherOutOfTime";
}

export class GatherBudget {
  readonly startedAt: number;
  /** Why it stopped, once it has: "time" or the preemption reason. */
  reason?: string;
  constructor(
    readonly maxMinutes: number,
    /** Asked once per entry: a reason to stop now (an urgent long video waiting), or nothing. */
    private readonly preempt?: () => Promise<string | undefined>,
    private readonly clock: () => number = Date.now,
  ) {
    this.startedAt = clock();
  }

  /** Milliseconds left; zero once the budget is spent or the gather was told to stop. */
  remainingMs(): number {
    if (this.reason) return 0;
    return Math.max(
      0,
      this.startedAt + this.maxMinutes * 60_000 - this.clock(),
    );
  }

  /** True once the time is up or the gather was told to stop; sets the reason the first time. */
  over(): boolean {
    if (this.reason) return true;
    if (this.maxMinutes > 0 && this.remainingMs() <= 0) {
      this.reason = "time";
      return true;
    }
    return false;
  }

  /** `over()` plus the preemption question, asked only while there is still time. */
  async exhausted(): Promise<boolean> {
    if (this.over()) return true;
    const why = await this.preempt?.().catch(() => undefined);
    if (why) this.reason = why;
    return Boolean(why);
  }

  /** Minutes since the gather began, to one decimal. */
  elapsedMinutes(): number {
    return Math.round((this.clock() - this.startedAt) / 6_000) / 10;
  }

  /**
   * Waits for `work` only as long as the budget allows; past that it resolves with `fallback` and the work
   * runs on in the background (its own child timeouts end it) while the gather moves on.
   */
  within<T>(work: Promise<T>, fallback: T): Promise<T> {
    const ms = this.remainingMs();
    if (ms <= 0) {
      work.catch(() => undefined);
      return Promise.resolve(fallback);
    }
    return new Promise<T>((resolve) => {
      const timer = setTimeout(() => {
        this.reason ??= "time";
        resolve(fallback);
      }, ms);
      work.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        () => {
          clearTimeout(timer);
          resolve(fallback);
        },
      );
    });
  }
}

/** The owner's line and the event when a gather stops early; called once by the gather loop. */
export async function reportGatherStop(
  db: Db,
  notify: (m: { content: string }) => Promise<unknown>,
  ep: { id: string; script_json?: { headline?: string } | null },
  budget: GatherBudget,
  entriesLeft: number,
): Promise<void> {
  const title = ep.script_json?.headline ?? ep.id;
  const why =
    budget.reason === "time"
      ? `its ${budget.maxMinutes}-minute budget (GATHER_MAX_MINUTES) ran out`
      : (budget.reason ?? "it was told to stop");
  log("warn", "media gather stopped early", {
    episode: ep.id,
    reason: budget.reason,
    minutes: budget.elapsedMinutes(),
    entriesLeft,
  });
  await logEvent(db, ep.id, "gather_budget", {
    reason: budget.reason,
    minutes: budget.elapsedMinutes(),
    entries_left: entriesLeft,
  });
  await notify({
    content: `⏱️ "${title}": the media gather stopped after ${budget.elapsedMinutes()} minutes because ${why}. ${entriesLeft} entr${entriesLeft === 1 ? "y" : "ies"} still to come get the plate and the top-up instead; the video carries on with what it has.`,
  });
}

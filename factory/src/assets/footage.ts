// How much official trailer footage one Short may carry, by publisher.
// The reporting (narration, cards, captions) runs over every second, so the footage is commentary's
// backdrop, not a re-upload; from 24 Oct 2026 it may carry most of a Short (the owner's call: the
// channel should look like a human creator's, whose Shorts run mostly on moving footage). Rockstar
// material (GTA VI) stays on a shorter leash, about ten seconds a Short, since Take-Two enforces hardest.

import type { SteamApp } from "./steam.ts";

export const DEFAULT_FOOTAGE_SECONDS = 34; // seven 4.8 s clips: the hook, each beat, the take and the loop
export const ROCKSTAR_FOOTAGE_SECONDS = 10;

function names(app: SteamApp): string[] {
  const d = app.details ?? {};
  return [...((d.publishers ?? []) as string[]), ...((d.developers ?? []) as string[])].map((n) => String(n).toLowerCase());
}

/** Seconds of trailer footage allowed for this game's publisher. */
export function footageBudgetSeconds(app: SteamApp): number {
  return names(app).some((n) => n.includes("rockstar")) ? ROCKSTAR_FOOTAGE_SECONDS : DEFAULT_FOOTAGE_SECONDS;
}

/** Keeps clips in order while their total stays within the budget. */
export function capFootage<T extends { durationSeconds?: number }>(clips: T[], budgetSeconds: number, fallbackSeconds = 3.4): T[] {
  const kept: T[] = [];
  let total = 0;
  for (const c of clips) {
    const d = c.durationSeconds ?? fallbackSeconds;
    if (total + d > budgetSeconds + 0.05) break;
    kept.push(c);
    total += d;
  }
  return kept;
}

// How much official trailer footage one Short may carry, by publisher.
// Footage stays short and subordinate to the reporting; Rockstar material
// (GTA VI) is held to about five to six seconds per Short.

import type { SteamApp } from "./steam.ts";

export const DEFAULT_FOOTAGE_SECONDS = 20; // four 4.8 s clips
export const ROCKSTAR_FOOTAGE_SECONDS = 6;

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

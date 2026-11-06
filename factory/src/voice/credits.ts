// ElevenLabs credits: use them all, never go over. A paid plan rolls unused credits into the next cycle
// only up to twice its monthly quota (three months' worth on the account in all); whatever sits above that
// when the cycle resets is lost. The plan here says, each day, how much would be lost at the next reset if
// the channel keeps its current pace, so the factory can spend exactly that on extra long videos. The
// voice step's own floor (src/voice/index.ts) keeps every job inside the balance, so nothing is billed.

import { fetchWithTimeout } from "../lib/util.ts";

export interface Subscription {
  used: number;
  limit: number; // the balance ceiling, rollover included
  resetAt: Date;
}

export interface CreditPlan {
  left: number;
  resetAt: Date;
  daysLeft: number;
  /** Credits a day the channel has been using this cycle. */
  pacePerDay: number;
  /** What would be lost at the reset at the current pace (0 when nothing would be). */
  wasteAtReset: number;
  /** Extra credits a day to spend so nothing is lost. */
  surplusPerDay: number;
}

const DAY = 86_400_000;

export async function elevenLabsSubscription(
  apiKey: string,
): Promise<Subscription | undefined> {
  try {
    const res = await fetchWithTimeout(
      "https://api.elevenlabs.io/v1/user/subscription",
      { headers: { "xi-api-key": apiKey } },
      15_000,
    );
    if (!res.ok) return undefined;
    const s = (await res.json()) as {
      character_count?: number;
      character_limit?: number;
      next_character_count_reset_unix?: number;
    };
    if (
      s.character_count == null ||
      s.character_limit == null ||
      !s.next_character_count_reset_unix
    )
      return undefined;
    return {
      used: s.character_count,
      limit: s.character_limit,
      resetAt: new Date(s.next_character_count_reset_unix * 1000),
    };
  } catch {
    return undefined;
  }
}

/**
 * The cycle's plan. At the reset the plan adds `monthlyQuota` and caps the balance at three quotas, so
 * whatever is left above two quotas then is lost; the pace so far this cycle says how much of today's
 * balance will still be there.
 */
export function creditPlan(
  sub: Subscription,
  monthlyQuota: number,
  now: Date,
): CreditPlan {
  const left = Math.max(0, sub.limit - sub.used);
  const daysLeft = Math.max(0, (sub.resetAt.getTime() - now.getTime()) / DAY);
  const cycleStart = new Date(sub.resetAt);
  cycleStart.setUTCMonth(cycleStart.getUTCMonth() - 1);
  const elapsed = Math.max(1, (now.getTime() - cycleStart.getTime()) / DAY);
  const pacePerDay = sub.used / elapsed;
  const atReset = Math.max(0, left - pacePerDay * daysLeft);
  const wasteAtReset = Math.max(0, Math.round(atReset - 2 * monthlyQuota));
  return {
    left,
    resetAt: sub.resetAt,
    daysLeft: Math.round(daysLeft * 10) / 10,
    pacePerDay: Math.round(pacePerDay),
    wasteAtReset,
    surplusPerDay:
      daysLeft > 0 ? Math.round(wasteAtReset / Math.max(1, daysLeft)) : 0,
  };
}

/** One line for the evening summary. */
export function creditLine(p: CreditPlan): string {
  const reset = p.resetAt.toISOString().slice(0, 10);
  return p.wasteAtReset > 0
    ? `**ElevenLabs:** ${p.left.toLocaleString("en-US")} credits left, resets ${reset}; at today's pace ${p.wasteAtReset.toLocaleString("en-US")} would be lost, so extra documentaries are on until that is used.`
    : `**ElevenLabs:** ${p.left.toLocaleString("en-US")} credits left, resets ${reset}; on pace to use the month without losing any.`;
}

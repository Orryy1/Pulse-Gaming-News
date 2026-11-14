// The story-first mix (owner, 1 Nov 2026). YouTube analytics for 17-31 Oct showed the channel had views but
// no followers: big-game news Shorts were watched 39-46% and brought 0-1 subscribers each, while the "Why
// Rockstar Never Made a San Andreas Sequel" story Short was watched 83% and brought the most. So the day leans
// on stories: at most two scheduled news Shorts (NEWS_SLOTS), one breaking Short (BREAKING_PER_DAY) with a
// second only for a very big story (BREAKING_BIG_SCORE), and two Why Shorts (WHY_SLOTS). The news cap
// (SHORTS_PER_DAY_MAX, src/cadence.ts) counts Why Shorts too, since they are made in the news lane; a news slot
// gives way to the Why slots still to come, so on a crowded day it is the news that is held back, not a story.

import type { Config } from "./config.ts";
import { dayKey, localTime, weekday } from "./lanes.ts";

/**
 * Whether one more breaking Short may fire, and the score it then needs. Under BREAKING_PER_DAY (the
 * sprint's extra already added by the caller) the usual bar stands; one past it only a story scoring at
 * least BREAKING_BIG_SCORE goes (0 turns the extra off); after that, none.
 */
export function breakingAllowance(
  madeToday: number,
  perDay: number,
  bigScore: number,
): { open: boolean; minScore: number } {
  if (madeToday < perDay) return { open: true, minScore: 0 };
  if (bigScore > 0 && madeToday < perDay + 1)
    return { open: true, minScore: bigScore };
  return { open: false, minScore: 0 };
}

/** A sighted story's breaking score: the best the cluster has scored. */
export function breakingScore(
  cluster: { score: number },
  sighting?: { max_score?: number },
): number {
  return Math.max(cluster.score, sighting?.max_score ?? 0);
}

/** Why slots of a day as instants, when the lane runs that day. */
export function whySlotTimes(
  cfg: Pick<Config, "whyEnabled" | "whyDays" | "whySlots" | "timezone">,
  day: string,
): Date[] {
  if (!cfg.whyEnabled) return [];
  const wd = weekday(localTime(day, "12:00", cfg.timezone), cfg.timezone);
  if (!cfg.whyDays.includes(wd)) return [];
  return cfg.whySlots.map((s) => localTime(day, s, cfg.timezone));
}

/**
 * Why slots still to come today that no episode has taken: what a news slot leaves room for under the cap.
 * A slot whose grace has run out without an episode is not waited for (the editor passed on it).
 */
export function whySlotsAhead(
  cfg: Pick<
    Config,
    "whyEnabled" | "whyDays" | "whySlots" | "timezone" | "slotGraceMinutes"
  >,
  now: Date,
  taken: Date[],
): number {
  const today = dayKey(now, cfg.timezone);
  return whySlotTimes(cfg, today).filter(
    (t) =>
      t.getTime() + cfg.slotGraceMinutes * 60_000 > now.getTime() &&
      !taken.some((x) => x.getTime() === t.getTime()),
  ).length;
}

/** The evening-summary line when a breaking story was passed over because the day's breaking Short is made. */
export function breakingHeldLine(
  headline: string,
  score: number,
  perDay: number,
  bigScore: number,
): string {
  return `Breaking: "${headline}" (score ${Math.round(score)}) was not rushed out, because today's ${perDay === 1 ? "breaking Short is" : `${perDay} breaking Shorts are`} already made and a second needs a score of ${bigScore} (BREAKING_BIG_SCORE). It can still fill a news slot.`;
}

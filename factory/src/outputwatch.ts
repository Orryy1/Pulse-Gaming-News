// The factory watching its own output (6 Nov 2026): a wrong pause stopped every lane for an afternoon and nobody
// heard, because nothing failed loudly. During the working day, when no Short has started for QUIET_HOURS, the
// owner's channel is told once, with what is holding things up.

import type { Db } from "./db.ts";
import { localTime, dayKey } from "./lanes.ts";
import { selectionPause } from "./pipeline.ts";
import { countToday } from "./episodes.ts";

export const QUIET_HOURS = 4;
const DAY_FROM = "10:00";
const DAY_TO = "23:00";

/** True when the gap since the last Short started is long enough to say so, inside the working day (pure). */
export function quietTooLong(lastStart: Date | undefined, now: Date, timeZone: string): boolean {
  const day = dayKey(now, timeZone);
  const from = localTime(day, DAY_FROM, timeZone);
  const to = localTime(day, DAY_TO, timeZone);
  if (now < from || now > to) return false;
  const since = Math.max(lastStart?.getTime() ?? 0, from.getTime() - QUIET_HOURS * 3600_000);
  return now.getTime() - since >= QUIET_HOURS * 3600_000;
}

/** The day's slots the output watch measures against: a quiet spell between slots is the plan, not a stall. */
export interface WatchSlots {
  /** Local "HH:MM" of every Short slot (news and Why). */
  slots: string[];
  /** SHORTS_PER_DAY: once the day has this many, the slots left are not owed. */
  dailyTarget: number;
}

/** Slot instants passed (by fifteen minutes or more) since the quiet spell began, with no video made for them (pure). */
export function missedSlots(
  slots: readonly string[],
  since: Date,
  now: Date,
  timeZone: string,
  taken: readonly Date[],
): Date[] {
  const day = dayKey(now, timeZone);
  return slots
    .map((s) => localTime(day, s, timeZone))
    .filter((t) => t > since && t.getTime() <= now.getTime() - 15 * 60_000)
    .filter((t) => !taken.some((x) => Math.abs(x.getTime() - t.getTime()) < 60_000));
}

/**
 * The alert text when output has gone quiet and it has not been said for this spell yet; undefined otherwise.
 * With the day's slots (the flight simulator, 14 Nov 2026: the watch said "no new Short for 4 hours" on ordinary
 * afternoons between the noon and evening slots, as it did on the Mac on 11 Nov twice), a quiet spell counts only
 * when a slot inside it passed with nothing made for it and the day's target is not yet met.
 */
export async function quietAlert(
  db: Db,
  now: Date,
  timeZone: string,
  watch?: WatchSlots,
): Promise<string | undefined> {
  const [last] = await db.query<{ at: string | null }>(
    `SELECT max(created_at) AS at FROM episodes WHERE lane <> 'longform'`,
  );
  const lastStart = last?.at ? new Date(last.at) : undefined;
  if (!quietTooLong(lastStart, now, timeZone)) return undefined;
  let missed: Date[] = [];
  if (watch && watch.slots.length) {
    if ((await countToday(db, timeZone)) >= watch.dailyTarget) return undefined;
    const taken = (
      await db.query<{ at: string | Date }>(
        `SELECT slot_at AS at FROM episodes WHERE slot_at IS NOT NULL AND slot_at > $1::timestamptz - interval '1 day'`,
        [now],
      )
    ).map((r) => new Date(r.at));
    const since = new Date(Math.max(lastStart?.getTime() ?? 0, now.getTime() - 24 * 3600_000));
    missed = missedSlots(watch.slots, since, now, timeZone, taken);
    if (!missed.length) return undefined;
  }
  const key = `quiet:${dayKey(now, timeZone)}:${lastStart?.toISOString() ?? "none"}`;
  const [seen] = await db.query<{ value: string }>(`SELECT value FROM settings WHERE key = 'output_watch'`);
  if (seen?.value === key) return undefined;
  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('output_watch', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key],
  );
  const pause = await selectionPause(db, now);
  const fails = await db.query<{ error: string | null }>(
    `SELECT last_error AS error FROM episodes WHERE status = 'failed' AND updated_at > $1::timestamptz - interval '6 hours' ORDER BY updated_at DESC LIMIT 3`,
    [now],
  );
  const hours = lastStart ? Math.round((now.getTime() - lastStart.getTime()) / 3600_000) : QUIET_HOURS;
  return [
    `🔇 No new Short has started for ${hours} hours${missed.length ? `, and the ${missed.map((m) => slotTime(m, timeZone)).join(" and ")} slot${missed.length > 1 ? "s" : ""} went by with nothing made` : ""}.`,
    pause ? `Story selection is paused: ${pause.slice(0, 200)}` : "",
    ...fails.map((f) => `Recent failure: ${(f.error ?? "").slice(0, 160)}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function slotTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

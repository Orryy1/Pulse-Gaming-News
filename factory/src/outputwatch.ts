// The factory watching its own output (6 Nov 2026): a wrong pause stopped every lane for an afternoon and nobody
// heard, because nothing failed loudly. During the working day, when no Short has started for QUIET_HOURS, the
// owner's channel is told once, with what is holding things up.

import type { Db } from "./db.ts";
import { localTime, dayKey } from "./lanes.ts";
import { selectionPause } from "./pipeline.ts";

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

/** The alert text when output has gone quiet and it has not been said for this spell yet; undefined otherwise. */
export async function quietAlert(db: Db, now: Date, timeZone: string): Promise<string | undefined> {
  const [last] = await db.query<{ at: string | null }>(
    `SELECT max(created_at) AS at FROM episodes WHERE lane <> 'longform'`,
  );
  const lastStart = last?.at ? new Date(last.at) : undefined;
  if (!quietTooLong(lastStart, now, timeZone)) return undefined;
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
    `🔇 No new Short has started for ${hours} hours.`,
    pause ? `Story selection is paused: ${pause.slice(0, 200)}` : "",
    ...fails.map((f) => `Recent failure: ${(f.error ?? "").slice(0, 160)}`),
  ]
    .filter(Boolean)
    .join("\n");
}

// The next part, for the next-part line (format redesign plan, section 4.4 and item 9). On The Why and The GTA File a
// Short may end on one spoken line naming the next part and its day ("Part 8 tomorrow: the map."), but only when the
// launch run (src/shortrun.ts) has that part planned and dated. No plan, no line: a broken promise is worse than none.
//
// The run file is read as plain entries so this works whatever fields the series runs add: an entry's own `series`
// and `part` are used when it has them, else parts are the run's entries on the same arc and game, in date order.

import { localTime } from "./lanes.ts";

/** A run entry as far as the next part needs it (src/shortrun.ts RunWhy, and the series runs' entries). */
export interface PartEntry {
  kind: string;
  date: string;
  slot: string;
  title: string;
  arc?: string;
  game?: string;
  series?: string;
  part?: number;
}

export interface NextPart {
  /** The next part's number, as said and shown ("Part 8"). */
  part: number;
  /** When it goes out, as said: "tomorrow", "tonight", "later today" or "on Friday". */
  day: string;
  /** The next part's planned title, for the writer to name it in a few words. */
  title: string;
  date: string;
  slot: string;
}

/** A promise further out than this is not made: a week is the most a viewer will hold. */
export const NEXT_PART_MAX_DAYS = 6;

const groupKey = (e: PartEntry) =>
  e.series ? `series:${e.series}` : `arc:${e.arc ?? ""}|${e.game ?? ""}`;

const order = (a: PartEntry, b: PartEntry) =>
  `${a.date} ${a.slot}`.localeCompare(`${b.date} ${b.slot}`);

/** How the day is said, from the current part's day to the next's; undefined past NEXT_PART_MAX_DAYS. */
export function dayPhrase(
  from: string,
  to: string,
  slot: string,
): string | undefined {
  const days = Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000,
  );
  if (!Number.isFinite(days) || days < 0 || days > NEXT_PART_MAX_DAYS)
    return undefined;
  if (days === 0)
    return Number(slot.slice(0, 2)) >= 17 ? "tonight" : "later today";
  if (days === 1) return "tomorrow";
  const weekday = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(`${to}T12:00:00Z`));
  return `on ${weekday}`;
}

/** The part after the one planned for this slot, when the run has it planned and dated. */
export function nextPartFor(
  run: ReadonlyArray<Omit<PartEntry, "date" | "slot"> & { date?: string; slot?: string }>,
  slotAt: Date,
  timeZone: string,
): NextPart | undefined {
  // A spare (src/shortrun.ts) has no date or slot of its own until it fills one, so it is never a promised part.
  const parts = run.filter(
    (e): e is PartEntry => e.kind !== "doc" && e.kind !== "spare" && !!e.date && !!e.slot,
  );
  const current = parts.find(
    (e) => localTime(e.date, e.slot, timeZone).getTime() === slotAt.getTime(),
  );
  if (!current) return undefined;
  const group = parts
    .filter((e) => groupKey(e) === groupKey(current))
    .sort(order);
  const i = group.indexOf(current);
  const next = group[i + 1];
  if (!next) return undefined;
  const day = dayPhrase(current.date, next.date, next.slot);
  if (!day) return undefined;
  return {
    part: next.part ?? i + 2,
    day,
    title: next.title,
    date: next.date,
    slot: next.slot,
  };
}

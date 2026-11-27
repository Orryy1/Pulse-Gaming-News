// LONG_RESLOT: a long video (ranking or documentary) finished well after its slot would otherwise go public the
// moment it is ready, at any hour (choosePublishAt gives "now" for a past slot). The Cyberpunk 2077 documentary missed
// its Wed 25 Nov 19:00 slot and would have published in the small hours of the 26th. Instead it is scheduled for the
// next time its planned wall-clock hour comes round. Only the publish time moves: slot_at (the claim every lane's
// scheduler checks) is left alone, so no planned long video or Short loses its slot, and choosePublishAt still keeps
// the usual gap from every other publish.
import { addDays, dayKey, localTime } from "./lanes.ts";

function hhmmIn(d: Date, timeZone: string): string {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

/**
 * When a late long video should go public instead, or undefined to leave it alone (slot still ahead, or passed by
 * less than graceHours, when going out now is still close to the planned hour). At least an hour's notice, so the
 * upload can be scheduled on YouTube ahead of it.
 */
export function longReslot(
  slotAt: Date,
  now: Date,
  timeZone: string,
  graceHours: number,
): Date | undefined {
  if (slotAt.getTime() > now.getTime()) return undefined;
  if (now.getTime() - slotAt.getTime() < graceHours * 3600_000) return undefined;
  const hhmm = hhmmIn(slotAt, timeZone);
  const today = dayKey(now, timeZone);
  for (let i = 0; i <= 2; i++) {
    const at = localTime(addDays(today, i), hhmm, timeZone);
    if (at.getTime() - now.getTime() >= 60 * 60_000) return at;
  }
  return undefined;
}

/** "Thu 26 Nov 19:00" in the channel's time zone, for the owner's notice. */
export function whenLabel(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(d)
    .replace(",", "");
}

// The channel's calendar: angles planned for a date, which the editors see as "planned for today" beside
// the live candidates. Written for moments known in advance (a launch week, an embargo, an anniversary)
// so the channel arrives with a plan instead of reacting. The file is plain text in the factory folder
// (CALENDAR_FILE, default calendar.md), one entry a line:
//
//   2026-11-19 news: GTA 6 release day. Watch for review scores at the embargo, the day-one patch size...
//   2026-11-17 why: Why did GTA 6 take thirteen years?
//
// The lane is optional (why | news | evergreen | long | doc | any). A plan is advice: the editor still
// judges the day's candidates, and never invents a story to fit the calendar.

import fs from "node:fs";

export type CalendarLane =
  | "why"
  | "news"
  | "evergreen"
  | "long"
  | "doc"
  | "any";

export interface CalendarEntry {
  date: string; // YYYY-MM-DD
  lane: CalendarLane;
  text: string;
}

const LANES = new Set<CalendarLane>([
  "why",
  "news",
  "evergreen",
  "long",
  "doc",
  "any",
]);

export function parseCalendar(md: string): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-*]\s*/, "").trim();
    const m = line.match(
      /^(\d{4}-\d{2}-\d{2})\s*(?:\[?([a-z]+)\]?)?\s*:\s*(.+)$/i,
    );
    if (!m) continue;
    const lane = (m[2] ?? "any").toLowerCase() as CalendarLane;
    out.push({
      date: m[1]!,
      lane: LANES.has(lane) ? lane : "any",
      text: m[3]!.trim(),
    });
  }
  return out;
}

let cache:
  | { file: string; mtime: number; entries: CalendarEntry[] }
  | undefined;

/** The calendar's entries, re-read when the file changes. A missing file is an empty calendar. */
export function readCalendar(file: string): CalendarEntry[] {
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (cache && cache.file === file && cache.mtime === mtime)
      return cache.entries;
    const entries = parseCalendar(fs.readFileSync(file, "utf8"));
    cache = { file, mtime, entries };
    return entries;
  } catch {
    return [];
  }
}

/** Entries for one day, for one lane ("any" entries count for every lane). */
export function plannedFor(
  entries: CalendarEntry[],
  day: string,
  lane: CalendarLane,
): CalendarEntry[] {
  return entries.filter(
    (e) =>
      e.date === day && (e.lane === lane || e.lane === "any" || lane === "any"),
  );
}

/**
 * What the editors read: today's plan for their lane, and (for the news desk) what the next days hold,
 * so an embargo or a launch is anticipated rather than discovered.
 */
export function calendarBlock(
  entries: CalendarEntry[],
  today: string,
  lane: CalendarLane,
  ahead: string[] = [],
): string {
  const now = plannedFor(entries, today, lane);
  const coming = ahead.flatMap((d) =>
    plannedFor(entries, d, lane).map((e) => ({ ...e, day: d })),
  );
  if (!now.length && !coming.length) return "";
  const lines: string[] = [];
  if (now.length) {
    lines.push(
      "Planned for today (the channel's calendar; take it when the day's candidates allow, never invent a story to fit it):",
      ...now.map((e) => `- ${e.text}`),
    );
  }
  if (coming.length) {
    lines.push(
      "Coming up (do not cover early; be ready):",
      ...coming.map((e) => `- ${e.day}: ${e.text}`),
    );
  }
  return lines.join("\n");
}

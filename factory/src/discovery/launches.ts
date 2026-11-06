// Known huge releases get planned coverage. The launch calendar (LAUNCH_CALENDAR_FILE, launches.json) lists a game, the
// day its reviews land and the day it launches. On the reviews day any review coverage of it from two outlets counts
// as huge, whatever its size; on launch day everything the press writes about it becomes one launch-day story. Both go
// through the big-story desk, so the writer, the fact check and the report are the usual ones, a planned Why that
// already covers it counts, and with no articles nothing is invented: the evening report says so instead.

import fs from "node:fs";
import { z } from "zod";
import { localTime } from "../lanes.ts";
import { errorMessage, log } from "../lib/util.ts";
import type { SizedStory } from "./storysize.ts";

const EntrySchema = z.object({
  game: z.string(),
  /** A pattern for the game's headlines; "Ocarina of Time", not "Zelda". */
  match: z.string(),
  launch: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reviews: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type LaunchEntry = z.infer<typeof EntrySchema>;

/** How long after the start of its day a reviews or launch story can still be made. */
const WINDOW_HOURS = 36;
const MIN_OUTLETS = 2;

export function readLaunches(file: string): LaunchEntry[] {
  if (!file) return [];
  try {
    return z
      .array(EntrySchema)
      .parse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (err) {
    log("warn", "launch calendar unreadable", {
      file,
      error: errorMessage(err),
    });
    return [];
  }
}

function inWindow(
  day: string | undefined,
  now: Date,
  timeZone: string,
): boolean {
  if (!day) return false;
  const start = localTime(day, "00:00", timeZone).getTime();
  return (
    now.getTime() >= start && now.getTime() < start + WINDOW_HOURS * 3_600_000
  );
}

const about = (s: SizedStory, re: RegExp): boolean =>
  s.items.some((i) => re.test(i.title));

/** The stories with the calendar's reviews and launch days applied, biggest first (pure). */
export function applyLaunches(
  stories: SizedStory[],
  entries: LaunchEntry[],
  now: Date,
  timeZone: string,
  hugeSize: number,
): SizedStory[] {
  let out = stories;
  for (const e of entries) {
    const re = new RegExp(e.match, "i");
    if (inWindow(e.reviews ?? e.launch, now, timeZone))
      out = out.map((s) =>
        s.event === "acclaim" &&
        s.outlets.length >= MIN_OUTLETS &&
        about(s, re) &&
        s.size < hugeSize
          ? { ...s, size: hugeSize, why: `${s.why}, reviews day` }
          : s,
      );
    if (!inWindow(e.launch, now, timeZone)) continue;
    const launchStart = localTime(e.launch, "00:00", timeZone).getTime();
    const items = out
      .filter((s) => about(s, re))
      .flatMap((s) => s.items.filter((i) => re.test(i.title)))
      .filter(
        (i) =>
          new Date(i.publishedAt).getTime() >= launchStart - 12 * 3_600_000,
      )
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const outlets = [...new Set(items.map((i) => i.source))];
    if (outlets.length < MIN_OUTLETS) continue;
    const base = out.find((s) => about(s, re))!;
    out = [
      ...out,
      {
        ...base,
        key: `${base.entity}|launch:${e.launch}`,
        event: "release",
        size: hugeSize,
        why: `launch day, ${outlets.length} outlets`,
        headline: `${e.game} is out now`,
        outlets,
        articles: items.length,
        rumour: false,
        leak: false,
        unsafe: base.unsafe,
        firstAt: items[items.length - 1]!.publishedAt,
        newestAt: items[0]!.publishedAt,
        items,
        // A "release times" Short from before the day is not the launch-day story.
        hashes: [],
        coverFrom: new Date(launchStart - 12 * 3_600_000).toISOString(),
      },
    ];
  }
  return [...out].sort((a, b) => b.size - a.size);
}

/** What the calendar expected today with nothing to make it from (pure): for the evening report. */
export function launchesWithoutStory(
  stories: SizedStory[],
  entries: LaunchEntry[],
  now: Date,
  timeZone: string,
): string[] {
  const lines: string[] = [];
  for (const e of entries) {
    const re = new RegExp(e.match, "i");
    if (
      inWindow(e.launch, now, timeZone) &&
      !stories.some((s) => s.key.includes("|launch:") && about(s, re))
    )
      lines.push(
        `${e.game} launch day: too few articles in the feeds to make a story from`,
      );
    if (
      inWindow(e.reviews, now, timeZone) &&
      !stories.some((s) => s.event === "acclaim" && about(s, re))
    )
      lines.push(`${e.game} reviews day: no review coverage in the feeds yet`);
  }
  return lines;
}

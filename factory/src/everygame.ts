// The every-game schedule (src/editorial/everygame.ts has the format itself). EVERYGAME_ENABLED is the setting
// (off by default); EVERYGAME_FILE names the plan (everygame.json beside package.json when empty). Each entry is
// one series with its Short and its long video fixed by date and slot, and its own "on" switch, so a series can
// sit in the file, planned and proven, until someone turns it on. No setting, no file, no entry that is on:
// nothing changes anywhere.
//
// The Short takes an evergreen slot (the lane's own lead time); the long video starts early and is scheduled
// ahead, as the launch run's documentaries are (src/shortrun.ts docRunDue). Pure functions here; the pipeline
// creates the episodes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { log, errorMessage } from "./lib/util.ts";
import { localTime } from "./lanes.ts";
import type { RosterTweaks } from "./editorial/everygame.ts";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SLOT = z.string().regex(/^\d{2}:\d{2}$/);

export const EveryGameEntrySchema = z.object({
  /** The series as IGDB files its franchise or collection ("Grand Theft Auto"). */
  series: z.string().min(2),
  /** What people call it ("GTA"). */
  short: z.string().optional(),
  /** This series' own switch; false or absent keeps it planned and silent. */
  on: z.boolean().optional(),
  /** The long video's title, in the honest frame ("The Story of Every GTA Game"). */
  title: z.string(),
  /** The through-line of the long video, one sentence. */
  angle: z.string(),
  /** The series' English Wikipedia article. */
  wiki: z.string().optional(),
  roster: z
    .object({
      drop: z.array(z.string()).optional(),
      years: z.record(z.string(), z.number()).optional(),
    })
    .optional(),
  short_video: z
    .object({
      date: DATE,
      slot: SLOT,
      /** The Short's YouTube title, word for word; absent, the writer uses the frame. */
      title: z.string().optional(),
    })
    .optional(),
  long_video: z
    .object({
      date: DATE,
      slot: SLOT,
      /** Production starts this long before the slot: a 50-minute video holds the factory for hours. */
      make_hours_before: z.number(),
    })
    .optional(),
});
export type EveryGameEntry = z.infer<typeof EveryGameEntrySchema>;

const PlanSchema = z.array(EveryGameEntrySchema);

/** The plan beside package.json, used when EVERYGAME_FILE is empty. */
export const DEFAULT_EVERYGAME_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "everygame.json",
);

/** The plan's entries; a missing or broken file means no plan, with a warning, never a stopped factory. */
export function readEveryGamePlan(file: string): EveryGameEntry[] {
  const f = file || DEFAULT_EVERYGAME_FILE;
  try {
    return PlanSchema.parse(JSON.parse(fs.readFileSync(f, "utf8")));
  } catch (err) {
    log("warn", "every-game plan unreadable", {
      file: f,
      error: errorMessage(err),
    });
    return [];
  }
}

export const rosterTweaks = (e: EveryGameEntry): RosterTweaks => ({
  ...(e.roster?.drop ? { drop: e.roster.drop } : {}),
  ...(e.roster?.years ? { years: e.roster.years } : {}),
  ...(e.short ? { short: e.short } : {}),
});

/**
 * The Short whose slot is inside its lead time and that nothing has taken: the entry and the slot. `enabled` is
 * the setting; an entry that is not on is never due.
 */
export function everyShortDue(
  plan: EveryGameEntry[],
  enabled: boolean,
  now: Date,
  taken: Date[],
  opts: { timeZone: string; leadMinutes: number; graceMinutes: number },
): { at: Date; entry: EveryGameEntry } | undefined {
  if (!enabled) return undefined;
  for (const e of plan) {
    if (!e.on || !e.short_video) continue;
    const at = localTime(e.short_video.date, e.short_video.slot, opts.timeZone);
    const ms = at.getTime() - now.getTime();
    if (ms > opts.leadMinutes * 60_000 || ms < -opts.graceMinutes * 60_000)
      continue;
    if (taken.some((t) => t.getTime() === at.getTime())) continue;
    return { at, entry: e };
  }
  return undefined;
}

/** The long video whose making window is open and whose slot nothing has taken. */
export function everyLongDue(
  plan: EveryGameEntry[],
  enabled: boolean,
  now: Date,
  taken: Date[],
  timeZone: string,
): { at: Date; entry: EveryGameEntry } | undefined {
  if (!enabled) return undefined;
  for (const e of plan) {
    if (!e.on || !e.long_video) continue;
    const at = localTime(e.long_video.date, e.long_video.slot, timeZone);
    const open = at.getTime() - e.long_video.make_hours_before * 3_600_000;
    if (now.getTime() < open || now.getTime() >= at.getTime()) continue;
    if (taken.some((t) => t.getTime() === at.getTime())) continue;
    return { at, entry: e };
  }
  return undefined;
}

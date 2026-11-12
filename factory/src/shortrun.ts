// The launch run (GTA VI, Nov 2026; reports/GTA VI launch plan.md). The factory's editors choose freely each day, and
// the Why lane refuses a game it covered in the last two weeks, so a planned run of Shorts on one game cannot reach
// them through the calendar, which is only advice. SHORT_RUN_FILE names a JSON list of topics fixed by date and slot;
// a Why slot with an entry takes that topic, and a "doc" entry starts its documentary early and schedules it ahead.
// The writer, the fact check and every other gate stay as they are. No file or no entry: nothing changes.

import fs from "node:fs";
import { z } from "zod";
import type { DocTopic } from "./editorial/documentary.ts";
import { log, errorMessage } from "./lib/util.ts";
import { localTime } from "./lanes.ts";

const SourceSchema = z.object({
  url: z.string().url(),
  source: z.string(),
  official: z.boolean().optional(),
});

const RunWhySchema = z.object({
  kind: z.literal("why"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.string().regex(/^\d{2}:\d{2}$/),
  question: z.string(),
  title: z.string(),
  game: z.string(),
  arc: z.string(),
  angle: z.string(),
  sources: z.array(SourceSchema).min(1),
  /**
   * Pre-make (launch plan, 11 Nov 2026): the Short is written, voiced, rendered and picture-checked this long before
   * its slot, then held and uploaded at the slot. Wins over RUN_PREMAKE_HOURS; make_at wins over both.
   */
  make_hours_before: z.number().nonnegative().optional(),
  /** Pre-make from this instant (ISO, e.g. "2026-11-14T09:00:00Z"). */
  make_at: z.string().datetime({ offset: true }).optional(),
  /** False: never pre-made (a topic that needs launch-day sources); made in the slot's usual lead time. */
  premake: z.boolean().optional(),
});
export type RunWhy = z.infer<typeof RunWhySchema>;

/**
 * A spare (launch plan section 3): an evergreen Short with no slot of its own, made early and held. When a slot in
 * RUN_SPARE_SLOTS (default WHY_SLOTS) would otherwise go out empty, the first ready spare takes it. Confirmed facts only.
 */
const RunSpareSchema = z.object({
  kind: z.literal("spare"),
  question: z.string(),
  title: z.string(),
  game: z.string(),
  arc: z.string(),
  angle: z.string(),
  sources: z.array(SourceSchema).min(1),
  /** Made from this instant (ISO); absent: as soon as the run file has it. */
  make_at: z.string().datetime({ offset: true }).optional(),
  /** Local YYYY-MM-DD: the first and last day it may fill a slot. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type RunSpare = z.infer<typeof RunSpareSchema>;

const RunDocSchema = z.object({
  kind: z.literal("doc"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.string().regex(/^\d{2}:\d{2}$/),
  /** Production starts this long before the slot: a documentary holds the factory for hours. */
  make_hours_before: z.number(),
  title: z.string(),
  franchise: z.string(),
  wiki: z.string(),
  angle: z.string(),
  /** Our own tests (src/editorial/testevidence.ts): an inbox clip and the claim it tests. */
  evidence: z
    .array(z.object({ clip: z.string(), claim: z.string() }))
    .optional(),
  /** The fewest usable tests this entry needs: under it, it does not run and the slot goes back to the usual lanes. */
  min_evidence: z.number().optional(),
  /** "guide": told as the player's own journey, when LONG_GUIDE_FORMAT is on (src/editorial/longrules.ts). */
  format: z.literal("guide").optional(),
  /** Read at write time and added to every chapter's source, so a verdict can name who said it. */
  sources: z.array(SourceSchema).optional(),
});
export type RunDoc = z.infer<typeof RunDocSchema>;

/**
 * A part of The GTA File (src/gtafile.ts), planned by hand from confirmed facts. It sits in its own run file
 * (SERIES_GTA_FILE_RUN_FILE) and runs in the series slot on its date; the Why writer and the fact check make it.
 */
const RunFileSchema = z.object({
  kind: z.literal("file"),
  part: z.number().int().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Only when this part runs outside SERIES_GTA_FILE_SLOT. */
  slot: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  /** The claim, without the "GTA VI File #n:" prefix the factory adds. */
  title: z.string(),
  question: z.string(),
  angle: z.string(),
  /** What the last part established, for the callback; empty for part 1. */
  recap: z.string(),
  /** The confirmed facts the part stands on, each traceable to a source below. */
  facts: z.array(z.string()).min(1),
  /** For the next-part line (SERIES_NEXT_LINE, claude/series-core): what the next part is about, in a few words. */
  next_teaser: z.string().optional(),
  game: z.string().optional(),
  sources: z.array(SourceSchema).min(1),
});
export type RunFile = z.infer<typeof RunFileSchema>;

const RunSchema = z.array(
  z.discriminatedUnion("kind", [RunWhySchema, RunDocSchema, RunSpareSchema, RunFileSchema]),
);
export type RunEntry = RunWhy | RunDoc | RunSpare | RunFile;

/** The run's entries; a missing or broken file means no run, with a warning, never a stopped factory. */
export function readRun(file: string): RunEntry[] {
  if (!file) return [];
  try {
    return RunSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (err) {
    log("warn", "launch run file unreadable", {
      file,
      error: errorMessage(err),
    });
    return [];
  }
}

/** The entry planned for the Why slot at this instant. */
export function whyRunEntry(
  run: RunEntry[],
  due: Date,
  timeZone: string,
): RunWhy | undefined {
  return run.find(
    (e): e is RunWhy =>
      e.kind === "why" &&
      localTime(e.date, e.slot, timeZone).getTime() === due.getTime(),
  );
}

/** The planned documentary whose making window is open and whose slot nothing has taken: its slot and its topic. */
export function docRunDue(
  run: RunEntry[],
  now: Date,
  taken: Date[],
  timeZone: string,
): { at: Date; topic: DocTopic; entry: RunDoc } | undefined {
  for (const e of run) {
    if (e.kind !== "doc") continue;
    const at = localTime(e.date, e.slot, timeZone);
    const open = at.getTime() - e.make_hours_before * 3600_000;
    if (now.getTime() < open || now.getTime() >= at.getTime()) continue;
    if (taken.some((t) => t.getTime() === at.getTime())) continue;
    return {
      at,
      entry: e,
      topic: {
        kind: "story",
        franchise_index: -1,
        story_index: -1,
        title_idea: e.title,
        angle: e.angle,
        reason: "Planned in the launch run",
        franchise: e.franchise,
        wiki: e.wiki,
        ...(e.format ? { format: e.format } : {}),
        ...(e.sources?.length ? { sources: e.sources } : {}),
      },
    };
  }
  return undefined;
}

/**
 * The repeat guard's exception (REPEAT_MAX, src/authenticity.ts): the guard already ignores a game's own words, but a
 * run on one game says "GTA 6" in every title while its official name is Grand Theft Auto VI. For a run topic those
 * words count as the game's own; every other repeated phrase is still sent back.
 */
export function runRepeatGame(game: string, run?: boolean): string {
  return run ? `${game} gta 6 vi` : game;
}

/** When a planned Why may start being made: make_at, else its own make_hours_before, else RUN_PREMAKE_HOURS; none: undefined. */
export function premakeFrom(
  e: RunWhy,
  timeZone: string,
  defaultHours: number,
): Date | undefined {
  if (e.premake === false) return undefined;
  const at = localTime(e.date, e.slot, timeZone);
  if (e.make_at) return new Date(e.make_at);
  const hours = e.make_hours_before ?? defaultHours;
  return hours > 0 ? new Date(at.getTime() - hours * 3600_000) : undefined;
}

/**
 * The planned Whys whose pre-make has begun and whose slot is still ahead and untaken, earliest slot first. A slot
 * closer than `leadMinutes` is left to the usual Why lane, which makes it in its own lead time.
 */
export function premakeDue(
  run: RunEntry[],
  now: Date,
  taken: Date[],
  timeZone: string,
  defaultHours: number,
  leadMinutes: number,
): Array<{ entry: RunWhy; at: Date }> {
  const out: Array<{ entry: RunWhy; at: Date }> = [];
  for (const e of run) {
    if (e.kind !== "why") continue;
    const from = premakeFrom(e, timeZone, defaultHours);
    if (!from || now.getTime() < from.getTime()) continue;
    const at = localTime(e.date, e.slot, timeZone);
    if (at.getTime() - now.getTime() <= leadMinutes * 60_000) continue;
    if (taken.some((t) => t.getTime() === at.getTime())) continue;
    out.push({ entry: e, at });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** The run's spares whose make time has come, in file order. */
export function sparesDue(run: RunEntry[], now: Date): RunSpare[] {
  return run.filter(
    (e): e is RunSpare =>
      e.kind === "spare" &&
      (!e.make_at || now.getTime() >= new Date(e.make_at).getTime()),
  );
}

/** May this spare fill a slot on this local day (YYYY-MM-DD)? */
export function spareFits(e: Pick<RunSpare, "from" | "until">, day: string): boolean {
  return (!e.from || day >= e.from) && (!e.until || day <= e.until);
}

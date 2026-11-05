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
});
export type RunWhy = z.infer<typeof RunWhySchema>;

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

const RunSchema = z.array(
  z.discriminatedUnion("kind", [RunWhySchema, RunDocSchema]),
);
export type RunEntry = RunWhy | RunDoc;

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

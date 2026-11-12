// The weekly guide (upgrade queue item 9, 12 Nov 2026): one long video a week, 25 to 60 minutes, in one fixed frame,
// starting with practical guides from real play ("best early money", "hidden spots", "beginner mistakes"). Why: 25 to
// 60 minute videos beat 8 to 25 minute ones inside 31 of 36 channels studied, and "what to do, buy or know first"
// videos hit on 36% of small-channel GTA videos against 12% for trailer breakdowns; the Partner Programme needs 8,000
// public watch hours and Pulse has about 38.
//
// GUIDE_WEEKLY is the setting (off by default); GUIDE_WEEKLY_FILE names the plan (guides.json beside package.json
// when empty). The plan is one game, one weekly day and hour (from its first date), one title frame and an ordered
// list of guides, each with its own "on". Every week the first guide that is on, ready and not yet made takes the
// week's slot. It runs through the documentary lane as a "guide" topic (src/editorial/longrules.ts, LONG_GUIDE_FORMAT):
// the writer, the friend voice (src/editorial/voice.ts), the fact check against the plan's confirmed facts file and
// sources, the spoiler guard (src/sceneindex/spoilers.ts) and the long render (src/render/longplan.ts) are the same.
// What the strand adds: the fixed title and thumbnail words, the owner's play notes and tests as sources, the owner's
// recordings for every footage target, no late-story footage even after a warning, and no cold open (the video opens
// on its subject). Pure functions here; the pipeline creates the episode.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { log, errorMessage } from "./lib/util.ts";
import { localTime, addDays } from "./lanes.ts";
import type { DocTopic } from "./editorial/documentary.ts";
import type { RunDoc } from "./shortrun.ts";
import { titleShapeProblems } from "./editorial/titleshape.ts";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SLOT = z.string().regex(/^\d{2}:\d{2}$/);

const SourceSchema = z.object({
  url: z.string().url(),
  source: z.string(),
  official: z.boolean().optional(),
});

export const GuideEntrySchema = z.object({
  /** Stable key, recorded on the episode so a guide is never made twice ("early-money"). */
  key: z.string().regex(/^[a-z0-9-]{2,40}$/),
  /** This guide's own switch; false or absent keeps it planned and silent. */
  on: z.boolean().optional(),
  /** The guide's name inside the frame, 2 to 5 words, title case ("Best Early Money"). */
  guide: z.string().min(3).max(40),
  /** The through-line, one or two sentences: what the player can do after watching. */
  angle: z.string().min(20),
  /** The thumbnail's words, 0 to 4, upper case on the thumbnail ("EARLY MONEY"). */
  thumb: z.string().max(28).default(""),
  /** Not before this local date (a guide that needs weeks of play, or a later part of the map). */
  not_before: DATE.optional(),
  /**
   * What the owner found in his own play, one line each, with where it came from ("TinoTV 19 Nov stream: the
   * Vice Beach car wash pays $300 a run, about 3 minutes each"). These are the guide's real-play source.
   */
  play_notes: z.array(z.string().min(10)).default([]),
  /** Our own tests (src/editorial/testevidence.ts): an inbox clip and the claim it tests. */
  evidence: z
    .array(z.object({ clip: z.string(), claim: z.string() }))
    .optional(),
  /** The fewest play notes plus usable tests this guide needs; under it, it waits (default: the plan's). */
  min_play: z.number().int().nonnegative().optional(),
  /** Extra sources for this guide alone. */
  sources: z.array(SourceSchema).optional(),
});
export type GuideEntry = z.infer<typeof GuideEntrySchema>;

export const GuidePlanSchema = z.object({
  /** The game as the factory files it ("Grand Theft Auto VI"). */
  game: z.string().min(2),
  /** What people call it, first in the title ("GTA 6"). */
  short: z.string().min(2),
  /** The game's English Wikipedia article. */
  wiki: z.string().min(2),
  /** The first guide's local date; every later one is a week on, same weekday and hour. */
  first: DATE,
  slot: SLOT,
  /** Production starts this long before the slot: a 40-minute video holds the factory for hours. */
  make_hours_before: z.number().positive().default(30),
  /** The fixed title: {short} and {guide} are filled in. Stays true for weeks: no dates, no "day one". */
  title_frame: z.string().default("{short} {guide}, Learned From Real Play"),
  /** Confirmed facts, read at write time and added to every chapter's source (a local markdown file). */
  facts_file: z.string().optional(),
  /** The fewest play notes plus usable tests a guide needs before it runs (default 3). */
  min_play: z.number().int().nonnegative().default(3),
  sources: z.array(SourceSchema).default([]),
  guides: z.array(GuideEntrySchema),
});
export type GuidePlan = z.infer<typeof GuidePlanSchema>;

/** The plan beside package.json, used when GUIDE_WEEKLY_FILE is empty. */
export const DEFAULT_GUIDE_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "guides.json",
);

/** The plan; a missing or broken file means no plan, with a warning, never a stopped factory. */
export function readGuidePlan(file: string): GuidePlan | undefined {
  const f = file || DEFAULT_GUIDE_FILE;
  try {
    const plan = GuidePlanSchema.parse(JSON.parse(fs.readFileSync(f, "utf8")));
    // The facts file sits beside the plan unless it is given in full.
    if (plan.facts_file && !path.isAbsolute(plan.facts_file))
      plan.facts_file = path.resolve(path.dirname(f), plan.facts_file);
    return plan;
  } catch (err) {
    log("warn", "weekly guide plan unreadable", {
      file: f,
      error: errorMessage(err),
    });
    return undefined;
  }
}

/** The fixed title for a guide: the game first, a plain statement, no question mark, no year. */
export function guideTitle(
  plan: Pick<GuidePlan, "title_frame" | "short">,
  entry: Pick<GuideEntry, "guide">,
): string {
  return plan.title_frame
    .replaceAll("{short}", plan.short)
    .replaceAll("{guide}", entry.guide.trim())
    .replace(/\s+/g, " ")
    .trim();
}

/** The thumbnail's words: at most 4, upper case; empty when the guide has none. */
export function guideThumb(entry: Pick<GuideEntry, "thumb">): string {
  return entry.thumb
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(" ")
    .toUpperCase();
}

/** What is wrong with the plan's frame for this guide, as lines for the owner; empty when it holds. */
export function guideFrameProblems(
  plan: GuidePlan,
  entry: GuideEntry,
): string[] {
  const t = guideTitle(plan, entry);
  const out = [...titleShapeProblems(t)];
  if (t.length > 60)
    out.push(`"${t}" is ${t.length} characters; keep a guide title under 60.`);
  if (/\?/.test(t))
    out.push(`"${t}" asks a question; a guide title is a statement.`);
  if (!t.toLowerCase().includes(plan.short.toLowerCase()))
    out.push(`"${t}" does not name ${plan.short}.`);
  const words = entry.guide.trim().split(/\s+/).length;
  if (words < 2 || words > 5)
    out.push(`"${entry.guide}" is ${words} words; a guide name is 2 to 5.`);
  if (entry.thumb.trim().split(/\s+/).filter(Boolean).length > 4)
    out.push(`Thumbnail words "${entry.thumb}" are more than 4.`);
  return out;
}

/** The week's slots, from the first date, a week apart (at most two years ahead). */
function weekSlot(plan: GuidePlan, week: number, timeZone: string): Date {
  return localTime(addDays(plan.first, week * 7), plan.slot, timeZone);
}

/** Why a guide cannot run yet (on, date, real play, title frame); undefined when it can. */
export function guideNotReady(
  plan: GuidePlan,
  entry: GuideEntry,
  at: Date,
  timeZone: string,
): string | undefined {
  if (!entry.on) return "not switched on";
  if (
    entry.not_before &&
    at.getTime() < localTime(entry.not_before, "00:00", timeZone).getTime()
  )
    return `not before ${entry.not_before}`;
  const need = entry.min_play ?? plan.min_play;
  const have = entry.play_notes.length + (entry.evidence?.length ?? 0);
  if (have < need)
    return `${have} play note${have === 1 ? "" : "s"} or tests from the owner's play, ${need} needed`;
  const frame = guideFrameProblems(plan, entry);
  if (frame.length) return frame[0];
  return undefined;
}

export interface GuideDue {
  at: Date;
  week: number;
  entry: GuideEntry;
  /** The guide as a planned documentary entry, so the lane's test-evidence check applies as for the launch run. */
  run: RunDoc;
  topic: DocTopic;
}

/**
 * This week's guide when its making window is open and nothing has taken its slot: the first guide that is on, ready
 * and not in `made` (keys of guides already made). `waiting` lists the guides passed over and why, for one notice.
 */
export function guideWeekDue(
  plan: GuidePlan | undefined,
  enabled: boolean,
  now: Date,
  taken: Date[],
  made: readonly string[],
  timeZone: string,
): { due?: GuideDue; waiting: string[] } {
  if (!enabled || !plan) return { waiting: [] };
  for (let week = 0; week < 104; week++) {
    const at = weekSlot(plan, week, timeZone);
    const open = at.getTime() - plan.make_hours_before * 3_600_000;
    if (now.getTime() >= at.getTime()) continue;
    if (now.getTime() < open) return { waiting: [] };
    if (taken.some((t) => t.getTime() === at.getTime())) return { waiting: [] };
    const waiting: string[] = [];
    for (const entry of plan.guides) {
      if (made.includes(entry.key)) continue;
      const why = guideNotReady(plan, entry, at, timeZone);
      if (why) {
        if (entry.on) waiting.push(`${guideTitle(plan, entry)}: ${why}`);
        continue;
      }
      return { due: guideDueFor(plan, entry, at, week), waiting };
    }
    return { waiting };
  }
  return { waiting: [] };
}

/** The guide as a documentary topic and a planned entry (exported for the dry run). */
export function guideDueFor(
  plan: GuidePlan,
  entry: GuideEntry,
  at: Date,
  week: number,
): GuideDue {
  const title = guideTitle(plan, entry);
  const sources = [...plan.sources, ...(entry.sources ?? [])];
  const day = addDays(plan.first, week * 7);
  const run: RunDoc = {
    kind: "doc",
    date: day,
    slot: plan.slot,
    make_hours_before: plan.make_hours_before,
    title,
    franchise: plan.game,
    wiki: plan.wiki,
    angle: entry.angle,
    format: "guide",
    ...(entry.evidence?.length ? { evidence: entry.evidence } : {}),
    ...(sources.length ? { sources } : {}),
  };
  const topic: DocTopic = {
    kind: "story",
    franchise_index: -1,
    story_index: -1,
    title_idea: title,
    angle: `${entry.angle} A practical guide from real play in ${plan.game}: every chapter is something the viewer can do in their own game, told from what was found playing it. Only the opening of the story: no late missions, endings, twists or late characters.`,
    reason: `Weekly guide, week ${week + 1}`,
    franchise: plan.game,
    wiki: plan.wiki,
    format: "guide",
    ...(sources.length ? { sources } : {}),
    guide: {
      key: entry.key,
      title,
      thumb: guideThumb(entry),
      week: week + 1,
      ...(plan.facts_file ? { facts_file: plan.facts_file } : {}),
      play_notes: entry.play_notes,
    },
  };
  return { at, week, entry, run, topic };
}

/**
 * A weekly guide's own source text: the confirmed facts file and the owner's play notes, under "[Outlet] title"
 * headers as the run's sources are (sourceCredit reads those). A facts file that won't open is named, not fatal.
 */
export function guideSourceText(guide: NonNullable<DocTopic["guide"]>): {
  text: string;
  missed: string[];
} {
  const parts: string[] = [];
  const missed: string[] = [];
  if (guide.facts_file) {
    try {
      const md = fs.readFileSync(guide.facts_file, "utf8");
      // Only the confirmed part: "Reported" lines stay out of a guide.
      const confirmed = md.split(/^##\s+Reported/im)[0]!.trim();
      parts.push(
        `[Rockstar and Take-Two, collected] Confirmed launch facts\n${confirmed.slice(0, 6000)}`,
      );
    } catch {
      missed.push(guide.facts_file);
    }
  }
  if (guide.play_notes?.length)
    parts.push(
      `[Pulse's own play] What we found playing it\n${guide.play_notes.map((n) => `- ${n}`).join("\n")}`,
    );
  return { text: parts.join("\n\n"), missed };
}

/** A written guide keeps its fixed title and thumbnail words: the frame is the strand's identity, not the writer's. */
export function applyGuideFrame(
  script: {
    youtube: { title: string; thumb_text?: string; title_variants?: string[] };
  },
  guide: NonNullable<DocTopic["guide"]>,
): void {
  script.youtube.title = guide.title;
  script.youtube.title_variants = [];
  if (guide.thumb) script.youtube.thumb_text = guide.thumb;
}

/** True for an episode made by the weekly guide strand (its factcheck carries the topic). */
export function isWeeklyGuide(factcheck: unknown): boolean {
  const t = (factcheck as { topic?: DocTopic } | null | undefined)?.topic;
  return Boolean(t && t.format === "guide" && t.guide?.key);
}

/** Minutes of narration at Pulse's documentary pace (about 140 words a minute). */
export function guideMinutes(words: number, wpm = 140): number {
  return Math.round((words / wpm) * 10) / 10;
}

// The retrospective strand (upgrade queue item 26): one full game retrospective at a time, 40 to 90 minutes, from a
// plan file (retros.json beside package.json, or RETRO_FILE). RETRO_ENABLED turns the strand on (off by default) and
// each game has its own "on". Slots run from the plan's first date every `every_days` days at its hour; each slot
// takes the first game in the plan's order that is on, allowed and filed:
//   - allowed: after its `allowed_from` date (the end of its spoiler window: the Ocarina remake from 4 Dec, GTA VI
//     from 18 Dec) and with no spoiler window open for it when it goes out (src/sceneindex/spoilers.ts). A
//     retrospective spoils everything, so it never runs inside a window, warning or not;
//   - filed: its full-story movie or playthrough is in the scene index (GAME_FETCH), nearly all of it indexed and with
//     enough heard lines to tell the story from (retroIndexProblems). A game that is not filed yet is queued for the
//     scene index and waits, told once a day.
// It runs through the documentary lane as a "retro" topic: the writer, the fact check on every chapter, the friend
// pass, the shot list, the character quotes, the game sound bed and the long render are the lane's own; what the
// strand adds is in src/editorial/retrospective.ts. Pure functions here; the pipeline creates the episode.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { log, errorMessage } from "./lib/util.ts";
import { localTime, addDays } from "./lanes.ts";
import type { DocTopic } from "./editorial/documentary.ts";
import { titleShapeProblems } from "./editorial/titleshape.ts";
import {
  retroMinutes,
  titleWarnsSpoilers,
  RETRO_SECTIONS,
  type RetroSection,
} from "./editorial/retrospective.ts";
import { coveredSeconds, type SceneIndex } from "./sceneindex/schema.ts";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SLOT = z.string().regex(/^\d{2}:\d{2}$/);

const SourceSchema = z.object({
  url: z.string().url(),
  source: z.string(),
  official: z.boolean().optional(),
  /** The sections whose chapters read this source (all when absent): a review belongs in reception. */
  sections: z.array(z.enum(RETRO_SECTIONS)).optional(),
});

export const RetroGameSchema = z.object({
  /** Stable key, recorded on the episode so a retrospective is never made twice ("gta-san-andreas"). */
  key: z.string().regex(/^[a-z0-9-]{2,40}$/),
  on: z.boolean().optional(),
  /** The game as the scene index files it ("Grand Theft Auto: San Andreas"). */
  game: z.string().min(2),
  /** What people call it ("GTA San Andreas"). */
  short: z.string().min(2),
  /** Its English Wikipedia article. */
  wiki: z.string().min(2),
  year: z.number().int(),
  platforms: z.string().min(2),
  /** Steam search term for the game or its current release; empty when never on Steam. */
  steam: z.string().default(""),
  /** Not before this local date: the end of its spoiler window, or a date the owner picked. */
  allowed_from: DATE.optional(),
  /** The through-line, one or two sentences. */
  angle: z.string().min(20),
  /** Target minutes, 40 to 90 (the plan's when absent). */
  minutes: z.number().int().optional(),
  /** The title, when not the plan's frame; it must say it spoils. */
  title: z.string().optional(),
  thumb: z.string().max(28).optional(),
  /** Other Wikipedia articles worth reading for it (the studio, a controversy, a remaster). */
  also_wiki: z.array(z.string()).default([]),
  /** Reputable press beside Wikipedia: reviews, interviews, making-of features. */
  sources: z.array(SourceSchema).default([]),
});
export type RetroGame = z.infer<typeof RetroGameSchema>;

export const RetroPlanSchema = z.object({
  /** The first slot's local date; later slots every `every_days` days at the same hour. */
  first: DATE,
  slot: SLOT,
  every_days: z.number().int().positive().default(7),
  /** Production starts this long before the slot: a 60-minute video holds the factory for most of a day. */
  make_hours_before: z.number().positive().default(40),
  minutes: z.number().int().default(60),
  /** {short} is filled in. The title says it spoils. */
  title_frame: z
    .string()
    .default("The Full Story of {short}, Spoilers and All"),
  thumb: z.string().max(28).default("THE FULL STORY"),
  games: z.array(RetroGameSchema),
});
export type RetroPlan = z.infer<typeof RetroPlanSchema>;

export const DEFAULT_RETRO_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "retros.json",
);

/** The plan; a missing or broken file means no plan, with a warning, never a stopped factory. */
export function readRetroPlan(file: string): RetroPlan | undefined {
  const f = file || DEFAULT_RETRO_FILE;
  try {
    return RetroPlanSchema.parse(JSON.parse(fs.readFileSync(f, "utf8")));
  } catch (err) {
    log("warn", "retrospective plan unreadable", {
      file: f,
      error: errorMessage(err),
    });
    return undefined;
  }
}

export function retroTitle(
  plan: Pick<RetroPlan, "title_frame">,
  game: Pick<RetroGame, "short" | "title">,
): string {
  return (game.title ?? plan.title_frame.replaceAll("{short}", game.short))
    .replace(/\s+/g, " ")
    .trim();
}

export function retroThumb(
  plan: Pick<RetroPlan, "thumb">,
  game: Pick<RetroGame, "thumb">,
): string {
  return (game.thumb ?? plan.thumb)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(" ")
    .toUpperCase();
}

/** What is wrong with a game's title, for the owner; empty when it holds. */
export function retroTitleProblems(plan: RetroPlan, game: RetroGame): string[] {
  const t = retroTitle(plan, game);
  const out = [...titleShapeProblems(t)];
  if (t.length > 70)
    out.push(`"${t}" is ${t.length} characters; keep it under 70.`);
  if (!titleWarnsSpoilers(t))
    out.push(
      `"${t}" does not say it spoils the story ("Full Story", "Spoilers").`,
    );
  if (!t.toLowerCase().includes(game.short.toLowerCase()))
    out.push(`"${t}" does not name ${game.short}.`);
  return out;
}

export interface RetroIndexNeeds {
  /** The share of the movie that must be indexed (default 0.95). */
  minShare: number;
  /** The fewest heard lines (default 400): a story is told from what its characters say. */
  minHeard: number;
}

/** Why a game's scene index cannot carry a retrospective yet; empty when it can (pure). */
export function retroIndexProblems(
  index: SceneIndex | undefined,
  needs: RetroIndexNeeds,
): string[] {
  if (!index) return ["no full-story movie filed in the scene index yet"];
  const out: string[] = [];
  const share =
    index.source.duration > 0
      ? coveredSeconds(index) / index.source.duration
      : 0;
  if (share < needs.minShare)
    out.push(
      `its movie is ${Math.round(share * 100)}% indexed, ${Math.round(needs.minShare * 100)}% needed`,
    );
  const heard = index.lines.filter((l) => l.via !== "textbox").length;
  if (heard < needs.minHeard)
    out.push(`${heard} heard lines in its index, ${needs.minHeard} needed`);
  if (index.source.duration < 3 * 3600 && index.source.kind === "movie")
    out.push(
      `its movie runs ${Math.round(index.source.duration / 60)} minutes, too short for the whole story`,
    );
  return out;
}

/** Why a game cannot take a slot (on, date, title, filed movie); undefined when it can. `filed` is the pipeline's look at its index. */
export function retroNotReady(
  plan: RetroPlan,
  game: RetroGame,
  at: Date,
  timeZone: string,
  filed: string[],
  windowOpenAt: boolean,
): string | undefined {
  if (!game.on) return "not switched on";
  if (
    game.allowed_from &&
    at.getTime() < localTime(game.allowed_from, "00:00", timeZone).getTime()
  )
    return `not before ${game.allowed_from} (its spoiler window)`;
  if (windowOpenAt) return "its spoiler window is still open";
  const title = retroTitleProblems(plan, game);
  if (title.length) return title[0];
  if (filed.length) return filed[0];
  return undefined;
}

export interface RetroDue {
  at: Date;
  slot: number;
  game: RetroGame;
  topic: DocTopic;
}

/**
 * The slot whose making window is open now and the game that takes it, when nothing else has taken it: the first game
 * in the plan's order that is ready and not in `made`. `waiting` lists the games passed over and why.
 */
export function retroDue(
  plan: RetroPlan | undefined,
  enabled: boolean,
  now: Date,
  taken: Date[],
  made: readonly string[],
  timeZone: string,
  look: (game: RetroGame, at: Date) => { filed: string[]; windowOpen: boolean },
): { due?: RetroDue; waiting: string[] } {
  if (!enabled || !plan) return { waiting: [] };
  for (let k = 0; k < 120; k++) {
    const at = localTime(
      addDays(plan.first, k * plan.every_days),
      plan.slot,
      timeZone,
    );
    if (now.getTime() >= at.getTime()) continue;
    if (now.getTime() < at.getTime() - plan.make_hours_before * 3_600_000)
      return { waiting: [] };
    if (taken.some((t) => t.getTime() === at.getTime())) return { waiting: [] };
    const waiting: string[] = [];
    for (const game of plan.games) {
      if (made.includes(game.key)) continue;
      if (!game.on) continue;
      const l = look(game, at);
      const why = retroNotReady(
        plan,
        game,
        at,
        timeZone,
        l.filed,
        l.windowOpen,
      );
      if (why) {
        waiting.push(`${game.short}: ${why}`);
        continue;
      }
      return {
        due: { at, slot: k, game, topic: retroTopic(plan, game) },
        waiting,
      };
    }
    return { waiting };
  }
  return { waiting: [] };
}

/** The game as a documentary topic (exported for the proof driver and the dry run). */
export function retroTopic(plan: RetroPlan, game: RetroGame): DocTopic {
  const title = retroTitle(plan, game);
  return {
    kind: "story",
    franchise_index: -1,
    story_index: -1,
    title_idea: title,
    angle: game.angle,
    reason: `Retrospective: ${game.short}`,
    franchise: game.game,
    wiki: game.wiki,
    format: "retro",
    ...(game.sources.length
      ? {
          sources: game.sources.map(({ url, source, official }) => ({
            url,
            source,
            ...(official ? { official } : {}),
          })),
        }
      : {}),
    retro: {
      key: game.key,
      title,
      thumb: retroThumb(plan, game),
      short: game.short,
      year: game.year,
      platforms: game.platforms,
      steam: game.steam,
      minutes: retroMinutes(game.minutes ?? plan.minutes),
      also_wiki: game.also_wiki,
      source_sections: Object.fromEntries(
        game.sources.flatMap((s) =>
          s.sections?.length ? [[s.url, s.sections]] : [],
        ),
      ) as Record<string, RetroSection[]>,
    },
  };
}

/** True for an episode made by the retrospective strand (its factcheck carries the topic). */
export function isRetrospective(factcheck: unknown): boolean {
  const t = (factcheck as { topic?: DocTopic } | null | undefined)?.topic;
  return Boolean(t && t.format === "retro" && t.retro?.key);
}

/** The sources a chapter of `section` reads (pure): those with no sections listed, and those that list it. */
export function sourcesForSection<T extends { url: string }>(
  sources: readonly T[],
  section: RetroSection,
  sections: Record<string, RetroSection[]> = {},
): T[] {
  return sources.filter(
    (s) => !sections[s.url]?.length || sections[s.url]!.includes(section),
  );
}

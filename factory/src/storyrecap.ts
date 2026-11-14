// The full story recap from the owner's own play (STORY_RECAP, owner, 14 Nov 2026): "GTA 6 Story Recap: Everything
// That Happens (Full Spoilers)", a long video told in story order from his streams.
//
//   - Planned as a dated run entry (src/shortrun.ts "doc" with story_recap): its date is the first day it may go out,
//     and it moves on day by day, up to its `until`, while the story is not streamed yet. It never runs inside the
//     game's spoiler window: production may only start once the window has closed (the writers' spoiler checks would
//     refuse the script anyway), and the upload holds again if a window is open when it would go out.
//   - "Enough of the story": the owner's recordings of the game in the stream index (src/vodindex), joined in the order
//     he played them, must add up to STORY_RECAP_MIN_HOURS of play with STORY_RECAP_MIN_LINES heard lines, and with
//     STORY_RECAP_NEED_END the end credits must have been read on screen in one of them.
//   - It is a story-only retrospective (src/retrospective.ts machinery): the acts are cut from the joined index, one
//     story chapter per act in order, the first line is the spoiler warning (withRetroWarning) and the title says
//     "Full Spoilers". The owner's recordings come first for the footage, as for every long video.
// Pure functions first, then the loader.

import { addDays, localTime } from "./lanes.ts";
import type { DocTopic } from "./editorial/documentary.ts";
import type { RunDoc } from "./shortrun.ts";
import { titleWarnsSpoilers } from "./editorial/retrospective.ts";
import { titleShapeProblems } from "./editorial/titleshape.ts";
import {
  gameAliases,
  spoilerWindow,
  windowOpen,
  type SpoilerWindow,
} from "./sceneindex/spoilers.ts";
import {
  mergeCoverage,
  sceneSlug,
  type SceneIndex,
} from "./sceneindex/schema.ts";
import { listVodIndexes, type VodIndex } from "./vodindex/schema.ts";
import { parseFetchTitles } from "./sceneindex/gamefetch.ts";

export interface RecapNeeds {
  minHours: number;
  minLines: number;
  needEnd: boolean;
}

/** End credits read on screen. */
export const CREDITS =
  /\b(directed by|executive producers?|a rockstar games production|rockstar north presents|game director|art director|lead designer|original score by|in memory of)\b/i;

/** True when a recording is of this game, by any of its names (pure). */
export function vodOfGame(
  v: Pick<VodIndex, "game" | "title">,
  game: string,
): boolean {
  const slugs = new Set(gameAliases(game).map(sceneSlug));
  if (v.game && slugs.has(sceneSlug(v.game))) return true;
  const t = ` ${sceneSlug(v.title).replace(/-/g, " ")} `;
  return [...slugs].some((s) => t.includes(` ${s.replace(/-/g, " ")} `));
}

/**
 * The owner's recordings of a game joined into one playthrough index (pure), in the order he played them (date, then
 * id), each one's shots, lines and coverage moved along by the recordings before it. Undefined when there are none.
 */
export function recapIndex(
  vods: VodIndex[],
  game: string,
): SceneIndex | undefined {
  const mine = vods
    .filter((v) => vodOfGame(v, game))
    .sort(
      (a, b) =>
        a.recordedOn.localeCompare(b.recordedOn) ||
        a.vodId.localeCompare(b.vodId),
    );
  if (!mine.length) return undefined;
  let at = 0;
  const shots: SceneIndex["shots"] = [];
  const lines: SceneIndex["lines"] = [];
  const coverage: SceneIndex["coverage"] = [];
  for (const v of mine) {
    const base = shots.length;
    for (const s of v.shots)
      shots.push({
        ...s,
        id: base + s.id,
        start: s.start + at,
        end: s.end + at,
        keyframes: s.keyframes.map((k) => k + at),
        ...(s.written
          ? {
              written: s.written.map((w) => ({
                from: w.from + at,
                to: w.to + at,
              })),
            }
          : {}),
      });
    for (const l of v.lines)
      lines.push({
        ...l,
        id: lines.length,
        start: l.start + at,
        end: l.end + at,
        shot: base + l.shot,
        ...(l.words
          ? {
              words: l.words.map((w) => ({
                ...w,
                start: w.start + at,
                end: w.end + at,
              })),
            }
          : {}),
      });
    for (const c of v.coverage)
      coverage.push({ from: c.from + at, to: c.to + at });
    at += v.duration;
  }
  return {
    version: 1,
    game,
    slug: sceneSlug(game),
    source: {
      videoId: `tinotv:${sceneSlug(game)}`,
      title: `Our own playthrough of ${game} (${mine.length} streams)`,
      uploader: "TinoTV",
      duration: at,
      kind: "playthrough",
      pickedAt: mine.at(-1)!.builtAt,
    },
    builtAt: mine.at(-1)!.builtAt,
    coverage: mergeCoverage(coverage),
    cast: [],
    places: [],
    shots,
    lines,
  };
}

/** The recordings a recap is told from, in order (pure). */
export const recapVods = (vods: VodIndex[], game: string): string[] =>
  vods
    .filter((v) => vodOfGame(v, game))
    .sort(
      (a, b) =>
        a.recordedOn.localeCompare(b.recordedOn) ||
        a.vodId.localeCompare(b.vodId),
    )
    .map((v) => v.vodId);

/** Why the streamed story cannot carry the recap yet; empty when it can (pure). */
export function recapProblems(
  index: SceneIndex | undefined,
  needs: RecapNeeds,
): string[] {
  if (!index) return ["no recordings of the game in the stream index yet"];
  const out: string[] = [];
  const hours = index.source.duration / 3600;
  if (hours < needs.minHours)
    out.push(
      `${Math.round(hours * 10) / 10} hours of the story streamed, ${needs.minHours} needed`,
    );
  const heard = index.lines.filter((l) => l.via !== "textbox").length;
  if (heard < needs.minLines)
    out.push(`${heard} heard lines in the streams, ${needs.minLines} needed`);
  if (
    needs.needEnd &&
    !index.shots.some((s) => CREDITS.test(s.text)) &&
    !index.lines.some((l) => l.via !== "voice" && CREDITS.test(l.text))
  )
    out.push("the end credits have not been seen on stream yet");
  return out;
}

/**
 * The game's spoiler windows (pure): the live ones the server registered, and the one GAME_FETCH_TITLES gives it
 * ("Grand Theft Auto VI@2026-11-18T11:00Z~2026-12-17"), so the rule holds even with SPOILER_GUARD off.
 */
export function recapWindows(
  live: readonly SpoilerWindow[],
  gameFetchTitles: string,
  game: string,
  days: number,
): SpoilerWindow[] {
  const slugs = new Set(gameAliases(game).map(sceneSlug));
  const own = parseFetchTitles(gameFetchTitles)
    .filter(
      (t) =>
        t.release && gameAliases(t.game).some((a) => slugs.has(sceneSlug(a))),
    )
    .map((t) =>
      spoilerWindow(game, t.release!, {
        days: days > 0 ? days : 28,
        openingShare: 0.1,
        ...(t.until ? { until: t.until } : {}),
      }),
    )
    .filter((w): w is SpoilerWindow => Boolean(w));
  return [
    ...live.filter((w) => w.aliases.some((a) => slugs.has(sceneSlug(a)))),
    ...own,
  ];
}

/** The latest end of the game's windows that are open at any of the instants (pure); undefined when none is. */
export function recapHeldUntil(
  windows: readonly SpoilerWindow[],
  at: Date[],
): string | undefined {
  const open = windows.filter((w) => at.some((t) => windowOpen(w, t)));
  if (!open.length) return undefined;
  return open
    .map((w) => w.until)
    .sort()
    .at(-1);
}

/** What is wrong with a recap's title (pure): it must say "recap" and warn of spoilers, under 70 characters. */
export function recapTitleProblems(title: string, short: string): string[] {
  const out = [...titleShapeProblems(title)];
  if (title.length > 70)
    out.push(`"${title}" is ${title.length} characters; keep it under 70.`);
  if (!titleWarnsSpoilers(title))
    out.push(`"${title}" does not warn of spoilers ("Full Spoilers").`);
  if (!/\brecap\b/i.test(title))
    out.push(`"${title}" does not say it is a recap.`);
  if (!title.toLowerCase().includes(short.toLowerCase()))
    out.push(`"${title}" does not name ${short}.`);
  if (/[–—]/.test(title))
    out.push(`"${title}" has a dash; house style never uses one.`);
  return out;
}

export interface RecapLook {
  windows: SpoilerWindow[];
  problems: string[];
}

/**
 * The recap's slot when its making window is open now (pure): from the entry's date at its slot, day by day up to
 * `until`. A day whose making would start or whose slot falls inside a spoiler window is passed over; a day not
 * ready (story not streamed) returns why and waits for tomorrow. `waiting` says why nothing is due.
 */
export function recapDue(
  entry: RunDoc,
  now: Date,
  taken: Date[],
  timeZone: string,
  made: boolean,
  look: () => RecapLook,
): { at?: Date; waiting?: string } {
  const r = entry.story_recap;
  if (!r || made) return {};
  for (let k = 0; k < 400; k++) {
    const date = addDays(entry.date, k);
    if (date > r.until)
      return { waiting: `past its last day (${r.until}) without being made` };
    const at = localTime(date, entry.slot, timeZone);
    const open = new Date(at.getTime() - entry.make_hours_before * 3_600_000);
    if (now.getTime() >= at.getTime()) continue;
    if (now.getTime() < open.getTime()) return {};
    if (taken.some((t) => t.getTime() === at.getTime())) continue;
    const l = look();
    const held = recapHeldUntil(l.windows, [now, open, at]);
    if (held) return { waiting: `the spoiler window is open until ${held}` };
    if (l.problems.length) return { waiting: l.problems.join("; ") };
    return { at };
  }
  return {};
}

/** The recap as a story-only retrospective topic (pure). */
export function recapTopic(
  entry: RunDoc,
  vods: string[],
  year: number,
): DocTopic {
  const r = entry.story_recap!;
  return {
    kind: "story",
    franchise_index: -1,
    story_index: -1,
    title_idea: entry.title,
    angle: entry.angle,
    reason: `Story recap: ${r.short}`,
    franchise: r.game,
    wiki: entry.wiki,
    format: "retro",
    ...(entry.sources?.length ? { sources: entry.sources } : {}),
    recap: { game: r.game, vods },
    retro: {
      key: `recap-${sceneSlug(r.game)}`,
      title: entry.title,
      thumb: (entry.thumb ?? "FULL SPOILERS").toUpperCase(),
      short: r.short,
      year,
      platforms: "PS5 and Xbox Series X|S",
      steam: "",
      minutes: r.minutes ?? 60,
      also_wiki: [],
      source_sections: {},
      storyOnly: true,
    },
  };
}

/** True for a recap episode (its factcheck carries the topic). */
export function isStoryRecap(factcheck: unknown): boolean {
  return Boolean(
    (factcheck as { topic?: DocTopic } | null | undefined)?.topic?.recap,
  );
}

// ------------------------------------------------------------------ loading

/** The joined index of the recordings a recap names (or every recording of the game when it names none). */
export async function loadRecapIndex(
  dataDir: string,
  recap: { game: string; vods: string[] },
): Promise<SceneIndex | undefined> {
  const all = await listVodIndexes(dataDir).catch(() => [] as VodIndex[]);
  const want = new Set(recap.vods);
  return recapIndex(
    want.size ? all.filter((v) => want.has(v.vodId)) : all,
    recap.game,
  );
}

/** Every recording of the game, joined, and its ids: for the readiness check and the topic. */
export async function streamedStory(
  dataDir: string,
  game: string,
): Promise<{ index?: SceneIndex; vods: string[] }> {
  const all = await listVodIndexes(dataDir).catch(() => [] as VodIndex[]);
  return { index: recapIndex(all, game), vods: recapVods(all, game) };
}

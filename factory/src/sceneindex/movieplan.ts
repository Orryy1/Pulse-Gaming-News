// The movie planner (26 Nov 2026; owner's rule, project_game_footage_library: for every big release, download the
// full game movies and clean no-commentary full playthroughs and index every scene and line, so videos match exact
// moments). On 26 Nov GTA VI's scene index held one upload, "All Cutscenes Full Movie & Ending Chapter 1", and nothing
// later: the launch fetcher keeps one source a game and replaces it only by a longer one, so a story told in chapter
// uploads never got past chapter 1, and no playthrough was ever fetched.
//
// For each covered game (the owner's titles and the launch calendar's games, once out, while their launch plan runs)
// the planner, at most once a day:
//   - searches through the YouTube Data API only (src/lib/ytguard.ts apiOnlySearch: the guard's daily API allowance,
//     background share; never a page request), two searches a pass;
//   - when the game's own index is chapter 1 of a cutscene series, plans that uploader's later chapters, each its own
//     index ("<game> (movie 2)", "(movie 3)"), tagged as past the story's opening so the spoiler guard holds them for
//     the whole window (src/sceneindex/spoilers.ts inOpening);
//   - plans up to two clean no-commentary full playthroughs at 1440p or 4K from different channels (the gameplay
//     index, then "(gameplay 2)"), judged by title, length, uploader and resolution;
//   - hands each to the scene index queue as a planned upload (src/sceneindex/job.ts pin): built from exactly that
//     source, so the whole movie costs the signed-in lane one request (its proxy), queued ahead of light turns and
//     spaced by the guard's ration (YT_SIGNED_PER_HOUR, YT_SIGNED_DAILY, the gap, the background share).
// Nothing here downloads anything; the job does, behind the Mac's turn-taker, above the disk floor.

import fsp from "node:fs/promises";
import path from "node:path";
import { errorMessage, log } from "../lib/util.ts";
import { guardedApiSearch } from "../lib/ytguard.ts";
import { gameAliases } from "./spoilers.ts";
import {
  indexNamesFor,
  loadSceneIndex,
  partIndexName,
  sceneSlug,
  baseGameOf,
  type SceneSource,
} from "./schema.ts";
import { updateQueue, type PinnedUpload, type QueuedGame, type SceneQueue } from "./job.ts";

/** One search result as the planner reads it (the Data API's flat entry). */
export interface PlanHit {
  videoId: string;
  title: string;
  uploader: string;
  /** Seconds. */
  duration: number;
  views?: number;
  liveStatus?: string;
}

/** Hours between a game's plans: new chapter uploads appear over days. */
export const MOVIE_PLAN_HOURS = 24;
/** Clean full playthroughs a game gets (from different channels). */
export const PLAYTHROUGHS_WANTED = 2;
/** A full playthrough is at least this long (a "Part 1" under it is only the first missions). */
export const FULL_PLAY_MIN_HOURS = 6;
/** A movie chapter is at least this long. */
export const MOVIE_MIN_SECONDS = 30 * 60;
/** Queue places: below the owner's launch plan (50), the chapters above its search-driven gameplay plan (45). */
export const MOVIE_PIN_PRIORITY = 48;
export const PLAY_PIN_PRIORITY = 46;

/**
 * Channels known for clean no-commentary uploads (no facecam, no talking), preferred when two uploads tie; the owner
 * can replace the list with GAME_FETCH_CLEAN_CHANNELS. A channel off the list is still taken when its title is clean.
 */
export const DEFAULT_CLEAN_CHANNELS = [
  "MKIceAndFire",
  "Shirrako",
  "Gamer's Little Playground",
  "Sirloin",
  "GameClips",
  "GAMERALISIMUS",
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The clean-channel list from GAME_FETCH_CLEAN_CHANNELS (pure); the default list when empty. */
export function cleanChannels(raw: string | undefined): Set<string> {
  const list = String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set((list.length ? list : DEFAULT_CLEAN_CHANNELS).map(norm));
}

/** 3 for 4K, 2 for 1440p, 1 for 1080p, 0 when the title does not say (pure). */
export function resolutionScore(title: string): number {
  if (/\b(4k|2160p|uhd|ultra hd)\b/i.test(title)) return 3;
  if (/\b(1440p|2k|qhd)\b/i.test(title)) return 2;
  if (/\b1080p\b/i.test(title)) return 1;
  return 0;
}

/** The chapter or part a title names ("Chapter 2", "(PART 3)", "Part 4"), or undefined (pure). */
export function chapterOf(title: string): number | undefined {
  const m = /\b(?:chapter|part|pt\.?)\s*#?\s*(\d{1,2})\b/i.exec(title);
  return m ? Number(m[1]) : undefined;
}

/** Words that mark an upload as something other than clean footage: talk, reactions, streams, edits, music. */
const NOT_CLEAN =
  /\b(reaction|reacts?|react|live\s?stream(?:ed|ing)?|streaming|stream|facecam|face\s?cam|podcast|explained|recap|theor(?:y|ies)|review|leaks?|leaked|trailer|first look|comparison|vs|mods?|modded|speedrun|glitch(?:es)?|funny|moments|shorts|licensed music|first \d+ hours?|tips|guide|ranking|ranked|all endings?)\b|#shorts|🔴/iu;
const MOVIE = /\b(all cutscenes|full movie|game movie|cutscene movie|the movie)\b/i;
const PLAY = /\b(walkthrough|playthrough|full game|longplay|gameplay)\b/i;
const NO_TALK = /\bno[\s-]*commentary\b/i;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when the title names the game by any of its names ("GTA 6", "GTA VI", "Grand Theft Auto VI") (pure). */
export function namesGame(title: string, game: string): boolean {
  return gameAliases(baseGameOf(game)).some((a) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${esc(a)}(?![\\p{L}\\p{N}])`, "iu").test(title),
  );
}

export type HitVerdict =
  | { ok: true; kind: SceneSource["kind"]; chapter?: number; score: number }
  | { ok: false; why: string };

/**
 * Whether a search result is a clean full movie chapter or full playthrough of the game (pure), and how good: by its
 * title (the game named, movie or no-commentary playthrough words, nothing that marks talk, reactions, streams or
 * licensed music), its length (a playthrough of at least FULL_PLAY_MIN_HOURS and no more than maxHours; a "Part 2"
 * is not a full playthrough), its resolution (a playthrough says 1440p or 4K) and its uploader.
 */
export function judgeHit(
  hit: PlanHit,
  game: string,
  o: { maxHours: number; clean: Set<string> },
): HitVerdict {
  const t = hit.title;
  if (hit.liveStatus && hit.liveStatus !== "not_live") return { ok: false, why: "a live stream" };
  if (!namesGame(t, game)) return { ok: false, why: "another game" };
  if (NOT_CLEAN.test(t)) return { ok: false, why: "not clean footage" };
  if (/commentary/i.test(t) && !NO_TALK.test(t)) return { ok: false, why: "commentary" };
  const hours = hit.duration / 3600;
  if (!(hours > 0)) return { ok: false, why: "no length" };
  if (hours > o.maxHours) return { ok: false, why: `longer than ${o.maxHours} hours` };
  const res = resolutionScore(t);
  const clean = o.clean.has(norm(hit.uploader)) ? 3 : 0;
  const views = Math.log10((hit.views ?? 0) + 1);
  const chapter = chapterOf(t);
  if (MOVIE.test(t) && !/\b(walkthrough|playthrough|longplay)\b/i.test(t)) {
    if (hit.duration < MOVIE_MIN_SECONDS) return { ok: false, why: "too short for a movie chapter" };
    return { ok: true, kind: "movie", ...(chapter ? { chapter } : {}), score: res * 2 + clean + views };
  }
  if (PLAY.test(t) && NO_TALK.test(t)) {
    if (res < 2) return { ok: false, why: "not 1440p or 4K" };
    if (hours < FULL_PLAY_MIN_HOURS) return { ok: false, why: "not a full playthrough" };
    if (chapter && chapter > 1) return { ok: false, why: "a later part, not a full playthrough" };
    return { ok: true, kind: "playthrough", score: res * 2 + clean + views + Math.min(hours, o.maxHours) / 2 };
  }
  return { ok: false, why: "neither a cutscene movie nor a no-commentary playthrough" };
}

/** What the game already has: each index or planned upload's name and source. */
export interface PlanSource {
  name: string;
  videoId: string;
  title: string;
  uploader: string;
  kind: SceneSource["kind"];
  chapter?: number;
}

/** A planned upload with the index it fills. */
export interface PlannedUpload {
  name: string;
  pin: PinnedUpload;
}

/**
 * The uploads to plan for a game (pure). Later movie chapters only when the game's own index is chapter 1 of a series,
 * and only from that series' uploader (another channel's chapters are cut differently); one upload a chapter, the best.
 * Then up to PLAYTHROUGHS_WANTED full playthroughs counting the ones already there, each from a different channel.
 */
export function planUploads(
  hits: PlanHit[],
  game: string,
  have: PlanSource[],
  o: { maxHours: number; clean: Set<string>; now: Date; playthroughs?: number },
): PlannedUpload[] {
  const base = baseGameOf(game.trim());
  const used = new Set(have.map((h) => h.videoId));
  const unique = [...new Map(hits.map((h) => [h.videoId, h])).values()].filter((h) => !used.has(h.videoId));
  const judged = unique.flatMap((h) => {
    const v = judgeHit(h, base, o);
    return v.ok ? [{ hit: h, v }] : [];
  });
  const out: PlannedUpload[] = [];
  const at = o.now.toISOString();
  // Later chapters of the movie the game's own index is chapter 1 of.
  const first = have.find((h) => h.name === base && h.kind === "movie");
  const firstChapter = first ? (first.chapter ?? chapterOf(first.title)) : undefined;
  if (first && firstChapter === 1) {
    const haveChapters = new Set(have.filter((h) => h.kind === "movie").map((h) => h.chapter ?? chapterOf(h.title) ?? 1));
    const best = new Map<number, (typeof judged)[number]>();
    for (const j of judged) {
      const ch = j.v.ok ? j.v.chapter : undefined;
      if (!j.v.ok || j.v.kind !== "movie" || !ch || ch < 2 || haveChapters.has(ch)) continue;
      if (norm(j.hit.uploader) !== norm(first.uploader)) continue;
      const cur = best.get(ch);
      if (!cur || (cur.v.ok && j.v.score > cur.v.score)) best.set(ch, j);
    }
    for (const ch of [...best.keys()].sort((a, b) => a - b)) {
      const j = best.get(ch)!;
      out.push({
        name: partIndexName(base, "movie", ch),
        pin: {
          videoId: j.hit.videoId,
          title: j.hit.title,
          uploader: j.hit.uploader,
          duration: j.hit.duration,
          kind: "movie",
          chapter: ch,
          spoiler: true,
          priority: MOVIE_PIN_PRIORITY,
          plannedAt: at,
          why: `chapter ${ch} of ${first.uploader}'s cutscene movie (chapter 1 is indexed)`,
        },
      });
    }
  }
  // Clean full playthroughs, each from its own channel.
  const plays = have.filter((h) => h.kind === "playthrough");
  const want = Math.max(0, (o.playthroughs ?? PLAYTHROUGHS_WANTED) - plays.length);
  const channels = new Set(plays.map((p) => norm(p.uploader)));
  const names = new Set(have.map((h) => h.name));
  let n = 1;
  const nextName = () => {
    while (names.has(partIndexName(base, "playthrough", n))) n++;
    const name = partIndexName(base, "playthrough", n);
    names.add(name);
    return name;
  };
  const ranked = judged
    .filter((j) => j.v.ok && j.v.kind === "playthrough")
    .sort((a, b) => (b.v.ok ? b.v.score : 0) - (a.v.ok ? a.v.score : 0));
  for (const j of ranked) {
    if (out.filter((p) => p.pin.kind === "playthrough").length >= want) break;
    const ch = norm(j.hit.uploader);
    if (channels.has(ch)) continue;
    channels.add(ch);
    out.push({
      name: nextName(),
      pin: {
        videoId: j.hit.videoId,
        title: j.hit.title,
        uploader: j.hit.uploader,
        duration: j.hit.duration,
        kind: "playthrough",
        priority: PLAY_PIN_PRIORITY,
        plannedAt: at,
        why: `clean no-commentary full playthrough, ${(j.hit.duration / 3600).toFixed(1)} h`,
      },
    });
  }
  return out;
}

/** The queue with each planned upload on its index's entry (pure): added, or set on an entry that has none. */
export function pinQueue(queue: SceneQueue, planned: PlannedUpload[], now: Date): SceneQueue {
  let games = queue.games;
  for (const p of planned) {
    const slug = sceneSlug(p.name);
    const has = games.find((g) => sceneSlug(g.game) === slug);
    if (has?.pin) continue;
    if (has) games = games.map((g) => (g === has ? { ...g, pin: p.pin, state: undefined } : g));
    else
      games = [
        ...games,
        { game: p.name, reason: `planned upload: ${p.pin.why ?? p.pin.title}`, requestedAt: now.toISOString(), recentRelease: true, pin: p.pin },
      ];
  }
  return games === queue.games ? queue : { games };
}

/** The two searches a pass makes for a game (pure): later movie chapters, then clean full playthroughs. */
export function planQueries(game: string): string[] {
  const base = baseGameOf(game.trim());
  // The short name people search by ("GTA 6"): the shortest alias with a number, else the game's own name.
  const short = gameAliases(base)
    .filter((a) => /\d/.test(a) && /\s/.test(a))
    .sort((a, b) => a.length - b.length)[0] ?? base;
  return [`${short} all cutscenes full movie chapter`, `${short} full game walkthrough no commentary 4K`];
}

/** A flat search's output (yt-dlp's shape, as the Data API answer is printed) as planner hits (pure). */
export function parseHits(stdout: string): PlanHit[] {
  return stdout.split(/\r?\n/).flatMap((line) => {
    try {
      const e = JSON.parse(line);
      if (typeof e?.id !== "string") return [];
      return [
        {
          videoId: e.id,
          title: String(e.title ?? ""),
          uploader: String(e.uploader ?? e.channel ?? ""),
          duration: Number(e.duration) || 0,
          ...(Number.isFinite(Number(e.view_count)) && e.view_count !== null ? { views: Number(e.view_count) } : {}),
          ...(e.live_status ? { liveStatus: String(e.live_status) } : {}),
        },
      ];
    } catch {
      return [];
    }
  });
}

interface PlanBook {
  games: Record<string, { lastAt: string; planned?: number }>;
}

const bookFile = (dataDir: string) => path.join(dataDir, "sceneindex", "movieplan.json");

async function readBook(dataDir: string): Promise<PlanBook> {
  try {
    const j = JSON.parse(await fsp.readFile(bookFile(dataDir), "utf8"));
    return { games: j && typeof j.games === "object" && j.games ? j.games : {} };
  } catch {
    return { games: {} };
  }
}

async function writeBook(dataDir: string, book: PlanBook): Promise<void> {
  const file = bookFile(dataDir);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(book, null, 1));
  await fsp.rename(tmp, file);
}

/** What a game already has (its indexes on disk and the planned uploads in the queue). */
export async function haveFor(dataDir: string, game: string, queue: SceneQueue): Promise<PlanSource[]> {
  const base = baseGameOf(game.trim());
  const out = new Map<string, PlanSource>();
  for (const name of indexNamesFor(dataDir, base)) {
    const index = await loadSceneIndex(dataDir, name).catch(() => undefined);
    if (index)
      out.set(sceneSlug(name), {
        name,
        videoId: index.source.videoId,
        title: index.source.title,
        uploader: index.source.uploader,
        kind: index.source.kind,
        ...(index.source.chapter ? { chapter: index.source.chapter } : {}),
      });
  }
  for (const g of queue.games as QueuedGame[]) {
    if (!g.pin || sceneSlug(baseGameOf(g.game)) !== sceneSlug(base) || out.has(sceneSlug(g.game))) continue;
    out.set(sceneSlug(g.game), {
      name: g.game,
      videoId: g.pin.videoId,
      title: g.pin.title,
      uploader: g.pin.uploader,
      kind: g.pin.kind,
      ...(g.pin.chapter ? { chapter: g.pin.chapter } : {}),
    });
  }
  return [...out.values()];
}

/**
 * One planning pass, never throws: each game due (MOVIE_PLAN_HOURS since its last answered plan) is searched through
 * the Data API, and what is worth fetching is queued as planned uploads. Returns what was planned.
 */
export async function moviePlanPass(
  cfg: { dataDir: string; sceneIndexMaxHours?: number; gameFetchCleanChannels?: string },
  games: string[],
  deps: { now?: () => Date; search?: (query: string) => Promise<string | undefined> } = {},
): Promise<PlannedUpload[]> {
  const now = (deps.now ?? (() => new Date()))();
  const search =
    deps.search ?? ((q: string) => guardedApiSearch(["--flat-playlist", "--dump-json", `ytsearch25:${q}`], "background"));
  const planned: PlannedUpload[] = [];
  try {
    const book = await readBook(cfg.dataDir);
    let changed = false;
    for (const game of games) {
      const slug = sceneSlug(baseGameOf(game));
      const last = Date.parse(book.games[slug]?.lastAt ?? "");
      if (Number.isFinite(last) && now.getTime() - last < MOVIE_PLAN_HOURS * 3_600_000) continue;
      const hits: PlanHit[] = [];
      let answered = 0;
      for (const q of planQueries(game)) {
        const out = await search(q).catch((err) => {
          log("warn", "movie plan: search failed", { game, error: errorMessage(err) });
          return undefined;
        });
        if (out === undefined) continue;
        answered++;
        hits.push(...parseHits(out));
      }
      // Not both answered (no key, the day's API allowance spent): what was found is planned, the next pass looks again.
      const complete = answered === planQueries(game).length;
      if (!answered) continue;
      const queue = await updateQueue(cfg.dataDir, (q) => q);
      const have = await haveFor(cfg.dataDir, game, queue);
      const plan = planUploads(hits, game, have, {
        maxHours: cfg.sceneIndexMaxHours ?? 12,
        clean: cleanChannels(cfg.gameFetchCleanChannels),
        now,
      });
      if (plan.length) {
        await updateQueue(cfg.dataDir, (q) => pinQueue(q, plan, now));
        for (const p of plan)
          log("info", "movie plan: upload queued", {
            index: p.name,
            videoId: p.pin.videoId,
            title: p.pin.title.slice(0, 120),
            uploader: p.pin.uploader,
            hours: Math.round((p.pin.duration / 3600) * 10) / 10,
            spoiler: Boolean(p.pin.spoiler),
          });
        planned.push(...plan);
      }
      if (complete) {
        book.games[slug] = { lastAt: now.toISOString(), planned: (book.games[slug]?.planned ?? 0) + plan.length };
        changed = true;
      }
    }
    if (changed) await writeBook(cfg.dataDir, book);
  } catch (err) {
    log("warn", "movie plan: pass failed", { error: errorMessage(err) });
  }
  return planned;
}

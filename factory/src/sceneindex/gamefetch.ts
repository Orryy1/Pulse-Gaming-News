// Footage gathering for every big release (GAME_FETCH, owner, 12 Nov 2026: "keep checking to download full
// cutscenes, movies, HD full playthroughs as quick as you possibly can from top no watermark etc. channels", for
// every big release, GTA VI first). The fetcher picks the games itself from the factory's own signals, besides the
// GAME_FETCH_TITLES override: games in the launch calendar, games on the release radar, games whose story hits the
// big-story size around their release, and games Pulse makes two or more videos about in a week. For each it hands
// the scene index job (src/sceneindex/job.ts) a launch plan: nothing before release; from release a search every
// GAME_FETCH_HOURS for a clean full movie or no-commentary full playthrough (the cutscene picker's rules plus the
// launch rules in build.ts judgeUploads), the most complete one taken; then a daily look for a longer or better one
// while people finish the game. The job does the fetching and indexing, one game at a time, behind ~/orch/macrun.sh,
// never below the Mac's free-space floor (480p proxy plus index; full-quality sections only on demand).
// A record per game (filed.json beside the indexes) says what is filed: title, release, source upload, index
// status and spoiler window end, for the weekly report. The spoiler windows (src/sceneindex/spoilers.ts) are made
// here too, for every game with a known release, and registered for the writers and the footage pickers.

import fsp from "node:fs/promises";
import path from "node:path";
import type { Config } from "../config.ts";
import type { LaunchEntry } from "../discovery/launches.ts";
import type { RadarGame } from "../discovery/weekly.ts";
import { errorMessage, log } from "../lib/util.ts";
import {
  planGame,
  readQueue,
  writeQueue,
  type FetchPlan,
  type QueuedGame,
  type SceneQueue,
} from "./job.ts";
import {
  coveredSeconds,
  loadSceneIndex,
  sceneSlug,
  type SceneIndex,
} from "./schema.ts";
import {
  lateTerms,
  setSpoilerWindows,
  spoilerWindow,
  type SpoilerWindow,
} from "./spoilers.ts";

export type FetchSignal =
  | "owner"
  | "calendar"
  | "bigstory"
  | "videos"
  | "radar";
export const FETCH_SIGNALS: FetchSignal[] = [
  "owner",
  "calendar",
  "bigstory",
  "videos",
  "radar",
];
/** The order the job takes games in: the owner's titles first, the radar's long tail last. */
export const SIGNAL_PRIORITY: Record<FetchSignal, number> = {
  owner: 50,
  calendar: 40,
  bigstory: 30,
  videos: 20,
  radar: 10,
};

export interface FetchTitle {
  game: string;
  /** ISO instant or YYYY-MM-DD: the first release anywhere. */
  release?: string;
  /** YYYY-MM-DD or ISO: the spoiler window's end, when it is not the default. */
  until?: string;
}

/**
 * GAME_FETCH_TITLES (pure): titles separated by ";" or new lines, each optionally "@release" and "~window end":
 * "Grand Theft Auto VI@2026-11-18T11:00Z~2026-12-17". Commas stay inside titles.
 */
export function parseFetchTitles(raw: string): FetchTitle[] {
  return raw
    .split(/[;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(.*?)(?:@([^~]+))?(?:~(.+))?$/)!;
      const release = m[2]?.trim();
      const until = m[3]?.trim();
      return {
        game: m[1]!.trim(),
        ...(release && Number.isFinite(Date.parse(release)) ? { release } : {}),
        ...(until && Number.isFinite(Date.parse(until)) ? { until } : {}),
      };
    })
    .filter((t) => t.game);
}

/** GAME_FETCH_SIGNALS (pure): which signals pick games; unset is all of them. */
export function parseSignals(raw: string): Set<FetchSignal> {
  const words = raw
    .split(/[\s,]+/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  if (!words.length || words.includes("all")) return new Set(FETCH_SIGNALS);
  return new Set(
    FETCH_SIGNALS.filter(
      (s) => words.includes(s) || (s === "owner" && words.includes("titles")),
    ),
  );
}

export interface FetchCandidate {
  game: string;
  signal: FetchSignal;
  release?: string;
  until?: string;
  why: string;
}

/** How near its release a big story must be to count (days either side of the story's first sighting). */
export const BIG_STORY_EVENTS = new Set(["release", "acclaim"]);
export const VIDEO_DAYS = 7;
export const VIDEOS_NEEDED = 2;

/**
 * The games the signals name (pure). The owner's titles always; the launch calendar's games from two weeks before
 * launch to four after; the release radar's games; a story about a release or its reviews at the big-story size;
 * a game with two or more Pulse videos in seven days. A release date found in the calendar or the radar is used
 * for any signal naming the same game.
 */
export function fetchCandidates(input: {
  titles: FetchTitle[];
  launches: LaunchEntry[];
  radar: RadarGame[];
  stories: Array<{
    name: string;
    event: string;
    size: number;
    firstAt: string;
  }>;
  videoGames: Array<{ game: string; at: string }>;
  bigSize: number;
  now: Date;
  signals: Set<FetchSignal>;
}): FetchCandidate[] {
  const day = 86_400_000;
  const now = input.now.getTime();
  const known = new Map<string, string>();
  for (const l of input.launches) known.set(sceneSlug(l.game), l.launch);
  for (const r of input.radar)
    if (!known.has(sceneSlug(r.name))) known.set(sceneSlug(r.name), r.date);
  const out: FetchCandidate[] = [];
  const add = (c: FetchCandidate) =>
    out.push({
      ...c,
      ...(c.release
        ? {}
        : known.has(sceneSlug(c.game))
          ? { release: known.get(sceneSlug(c.game)) }
          : {}),
    });
  if (input.signals.has("owner"))
    for (const t of input.titles)
      add({
        game: t.game,
        signal: "owner",
        release: t.release,
        until: t.until,
        why: "GAME_FETCH_TITLES",
      });
  if (input.signals.has("calendar"))
    for (const l of input.launches) {
      const at = Date.parse(`${l.launch}T00:00:00Z`);
      if (Number.isFinite(at) && now >= at - 14 * day && now <= at + 28 * day)
        add({
          game: l.game,
          signal: "calendar",
          release: l.launch,
          why: `launch calendar ${l.launch}`,
        });
    }
  if (input.signals.has("radar"))
    for (const r of input.radar)
      add({
        game: r.name,
        signal: "radar",
        release: r.date,
        why: `release radar ${r.date}`,
      });
  if (input.signals.has("bigstory"))
    for (const s of input.stories)
      if (
        s.size >= input.bigSize &&
        BIG_STORY_EVENTS.has(s.event) &&
        s.name.trim()
      )
        add({
          game: s.name.trim(),
          signal: "bigstory",
          why: `big story (${s.event}, size ${Math.round(s.size)})`,
          release: known.get(sceneSlug(s.name)) ?? s.firstAt.slice(0, 10),
        });
  if (input.signals.has("videos")) {
    const counts = new Map<string, { game: string; n: number }>();
    for (const v of input.videoGames) {
      if (!v.game?.trim() || now - Date.parse(v.at) > VIDEO_DAYS * day)
        continue;
      const slug = sceneSlug(v.game);
      const c = counts.get(slug) ?? { game: v.game.trim(), n: 0 };
      c.n++;
      counts.set(slug, c);
    }
    for (const c of counts.values())
      if (c.n >= VIDEOS_NEEDED)
        add({
          game: c.game,
          signal: "videos",
          why: `${c.n} Pulse videos in ${VIDEO_DAYS} days`,
        });
  }
  return out;
}

export type FiledStatus =
  | "before-release"
  | "searching"
  | "no-source"
  | "indexing"
  | "describing"
  | "filed"
  | "stopped";

export interface FiledGame {
  game: string;
  slug: string;
  /** ISO or YYYY-MM-DD; unknown for a game picked only by its videos. */
  release?: string;
  /** The owner's window end, when given. */
  until?: string;
  signals: FetchSignal[];
  why: string[];
  firstSeen: string;
  spoilerUntil?: string;
  source?: {
    videoId: string;
    title: string;
    uploader: string;
    minutes: number;
    height?: number;
    kind: string;
  };
  status: FiledStatus;
  /** 0-1: the share of the source indexed, and of its shots described. */
  indexed?: number;
  described?: number;
  updatedAt: string;
}

export interface FiledBook {
  games: FiledGame[];
}

export function parseFiled(raw: unknown): FiledBook {
  const games = (raw as FiledBook | null)?.games;
  return {
    games: (Array.isArray(games) ? games : []).filter(
      (g) =>
        g &&
        typeof g.game === "string" &&
        g.game.trim() &&
        typeof g.slug === "string",
    ),
  };
}

/**
 * The book with today's candidates merged in (pure): one record a game however it is spelt, signals added up, the
 * owner's release and window end winning, otherwise the earliest release any signal knows. A game whose window and
 * daily looks are long over is kept (the weekly report lists what is filed) but no longer planned.
 */
export function mergeFiled(
  book: FiledBook,
  candidates: FetchCandidate[],
  now: Date,
  o: { days: number; openingShare: number },
): FiledBook {
  const games = book.games.map((g) => ({
    ...g,
    signals: [...g.signals],
    why: [...g.why],
  }));
  for (const c of candidates) {
    const slug = sceneSlug(c.game);
    if (!slug) continue;
    let rec = games.find((g) => g.slug === slug);
    if (!rec) {
      rec = {
        game: c.game,
        slug,
        signals: [],
        why: [],
        firstSeen: now.toISOString(),
        status: "searching",
        updatedAt: now.toISOString(),
      };
      games.push(rec);
    }
    if (!rec.signals.includes(c.signal)) rec.signals.push(c.signal);
    if (!rec.why.includes(c.why)) rec.why = [...rec.why, c.why].slice(-6);
    if (c.signal === "owner") {
      rec.game = c.game;
      if (c.release) rec.release = c.release;
      if (c.until) rec.until = c.until;
    } else if (c.release && !(rec.signals.includes("owner") && rec.release)) {
      if (!rec.release || Date.parse(c.release) < Date.parse(rec.release))
        rec.release = c.release;
    }
    if (rec.release)
      rec.spoilerUntil = spoilerWindow(rec.game, rec.release, {
        days: o.days,
        openingShare: o.openingShare,
        until: rec.until,
      })?.until;
  }
  return { games };
}

/**
 * The job's launch plan for a record (pure), or undefined when its time is over: searched every `hours` from its
 * release (a game with no known release is taken as out, searched three times less often), looked at again every
 * `recheckHours` until the later of its spoiler window's end and `recheckDays` after release.
 */
export function fetchPlan(
  rec: FiledGame,
  now: Date,
  o: {
    hours: number;
    recheckHours: number;
    recheckDays: number;
    days: number;
    openingShare: number;
  },
): FetchPlan | undefined {
  const day = 86_400_000;
  const priority = Math.max(
    ...rec.signals.map((s) => SIGNAL_PRIORITY[s] ?? 0),
    0,
  );
  const win = rec.release
    ? spoilerWindow(rec.game, rec.release, {
        days: o.days,
        openingShare: o.openingShare,
        until: rec.until,
      })
    : undefined;
  const start = win ? Date.parse(win.from) : Date.parse(rec.firstSeen);
  const until = Math.max(
    win ? Date.parse(win.until) : 0,
    start + o.recheckDays * day,
  );
  if (now.getTime() > until) return undefined;
  return {
    ...(win ? { notBefore: win.from } : {}),
    searchEveryHours: win ? o.hours : o.hours * 3,
    recheckEveryHours: o.recheckHours,
    recheckUntil: new Date(until).toISOString(),
    priority,
  };
}

/** A record brought up to date from its index and its place in the job's queue (pure). */
export function filedStatus(
  rec: FiledGame,
  index: SceneIndex | undefined,
  queued: QueuedGame | undefined,
  now: Date,
): FiledGame {
  const out: FiledGame = { ...rec, updatedAt: now.toISOString() };
  if (index) {
    const s = index.source;
    out.source = {
      videoId: s.videoId,
      title: s.title,
      uploader: s.uploader,
      minutes: Math.round(s.duration / 60),
      ...(s.height ? { height: s.height } : {}),
      kind: s.kind,
    };
    out.indexed =
      s.duration > 0
        ? Math.min(
            1,
            Math.round((coveredSeconds(index) / s.duration) * 100) / 100,
          )
        : 0;
    const usable = index.shots.filter((x) => !x.blank);
    out.described = usable.length
      ? Math.round(
          (usable.filter((x) => x.desc).length / usable.length) * 100,
        ) / 100
      : 0;
  }
  const notBefore = queued?.fetch?.notBefore;
  if (notBefore && now.getTime() < Date.parse(notBefore))
    out.status = "before-release";
  else if (!index)
    out.status =
      queued?.state === "no-source"
        ? "no-source"
        : queued
          ? "searching"
          : "stopped";
  else if ((out.indexed ?? 0) < 0.99) out.status = "indexing";
  else if ((out.described ?? 0) < 0.99) out.status = "describing";
  else out.status = "filed";
  return out;
}

/** The weekly report's lines on the footage library (pure): one a game, newest release first. */
export function filedLines(book: FiledBook, now: Date): string[] {
  if (!book.games.length) return [];
  const when = (iso?: string) => (iso ? iso.slice(0, 10) : "?");
  const rows = [...book.games]
    .sort(
      (a, b) =>
        (Date.parse(b.release ?? b.firstSeen) || 0) -
        (Date.parse(a.release ?? a.firstSeen) || 0),
    )
    .slice(0, 12)
    .map((g) => {
      const src = g.source
        ? `${g.source.kind} "${g.source.title.slice(0, 50)}" by ${g.source.uploader}, ${g.source.minutes} min${g.source.height ? ` ${g.source.height}p` : ""}`
        : "no clean upload yet";
      const progress =
        g.status === "indexing" || g.status === "describing"
          ? ` (${Math.round((g.indexed ?? 0) * 100)}% indexed, ${Math.round((g.described ?? 0) * 100)}% described)`
          : "";
      const spoiler =
        g.spoilerUntil && now.getTime() < Date.parse(g.spoilerUntil)
          ? `, spoilers held until ${when(g.spoilerUntil)}`
          : "";
      return `- **${g.game}** (out ${when(g.release)}): ${g.status}${progress}, ${src}${spoiler}`;
    });
  return ["", "🎞️ **Game footage library**", ...rows];
}

/**
 * The spoiler windows (pure): every filed game with a release, the owner's titles and the launch calendar, each
 * with the late names its scene index knows. One window a game, the owner's dates first.
 */
export function windowsFrom(
  sources: Array<{ game: string; release?: string; until?: string }>,
  indexes: Map<string, SceneIndex>,
  o: { days: number; openingShare: number },
): SpoilerWindow[] {
  const out = new Map<string, SpoilerWindow>();
  for (const s of sources) {
    const slug = sceneSlug(s.game);
    if (!s.release || !slug || out.has(slug)) continue;
    const index = indexes.get(slug);
    const w = spoilerWindow(s.game, s.release, {
      days: o.days,
      openingShare: o.openingShare,
      until: s.until,
      lateTerms: index ? lateTerms(index, o.openingShare) : [],
    });
    if (w) out.set(slug, w);
  }
  return [...out.values()];
}

// ---------------------------------------------------------------- the pass (files, network, database)

type FetchCfg = Pick<
  Config,
  | "dataDir"
  | "sceneIndex"
  | "gameFetch"
  | "gameFetchTitles"
  | "gameFetchSignals"
  | "gameFetchHours"
  | "gameFetchRecheckHours"
  | "gameFetchRecheckDays"
  | "spoilerGuard"
  | "spoilerWindowDays"
  | "spoilerOpeningShare"
  | "bigStorySize"
>;

const bookFile = (dataDir: string) =>
  path.join(dataDir, "sceneindex", "filed.json");

export async function readFiled(dataDir: string): Promise<FiledBook> {
  try {
    return parseFiled(
      JSON.parse(await fsp.readFile(bookFile(dataDir), "utf8")),
    );
  } catch {
    return { games: [] };
  }
}

async function writeFiled(dataDir: string, book: FiledBook): Promise<void> {
  const file = bookFile(dataDir);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(book, null, 1));
  await fsp.rename(tmp, file);
}

/** The queue with every live record's plan in it (pure). */
export function plannedQueue(
  queue: SceneQueue,
  book: FiledBook,
  now: Date,
  o: Parameters<typeof fetchPlan>[2],
): SceneQueue {
  let q = queue;
  for (const rec of book.games) {
    const plan = fetchPlan(rec, now, o);
    if (plan)
      q = planGame(
        q,
        rec.game,
        plan,
        `footage: ${rec.why[0] ?? rec.signals[0]}`,
        now,
      );
  }
  return q;
}

/**
 * One pass, never throws: with GAME_FETCH the signals are read, the book merged, plans handed to the job's queue and
 * every record's status refreshed; with SPOILER_GUARD the windows are made and registered. The job's own tick
 * (sceneIndexTick) does the fetching, one game at a time.
 */
export async function gameFetchPass(
  cfg: FetchCfg,
  deps: {
    now?: () => Date;
    launches?: LaunchEntry[];
    radar?: () => Promise<RadarGame[]>;
    stories?: () => Promise<
      Array<{ name: string; event: string; size: number; firstAt: string }>
    >;
    videoGames?: () => Promise<Array<{ game: string; at: string }>>;
  } = {},
): Promise<{ book: FiledBook; windows: SpoilerWindow[] }> {
  const now = (deps.now ?? (() => new Date()))();
  const titles = parseFetchTitles(cfg.gameFetchTitles);
  const launches = deps.launches ?? [];
  const settings = {
    days: cfg.spoilerWindowDays,
    openingShare: cfg.spoilerOpeningShare,
  };
  let book = await readFiled(cfg.dataDir);
  try {
    if (cfg.gameFetch && cfg.sceneIndex) {
      const signals = parseSignals(cfg.gameFetchSignals);
      const safe = async <T>(
        f: (() => Promise<T[]>) | undefined,
        what: string,
      ): Promise<T[]> => {
        if (!f) return [];
        try {
          return await f();
        } catch (err) {
          log("warn", "game footage: a signal failed", {
            signal: what,
            error: errorMessage(err),
          });
          return [];
        }
      };
      const candidates = fetchCandidates({
        titles,
        launches,
        radar: signals.has("radar") ? await safe(deps.radar, "radar") : [],
        stories: signals.has("bigstory")
          ? await safe(deps.stories, "bigstory")
          : [],
        videoGames: signals.has("videos")
          ? await safe(deps.videoGames, "videos")
          : [],
        bigSize: cfg.bigStorySize,
        now,
        signals,
      });
      book = mergeFiled(book, candidates, now, settings);
      const queue = await readQueue(cfg.dataDir);
      const next = plannedQueue(queue, book, now, {
        hours: cfg.gameFetchHours,
        recheckHours: cfg.gameFetchRecheckHours,
        recheckDays: cfg.gameFetchRecheckDays,
        ...settings,
      });
      if (next !== queue) await writeQueue(cfg.dataDir, next);
    }
    const queue = await readQueue(cfg.dataDir);
    const indexes = new Map<string, SceneIndex>();
    for (const rec of book.games) {
      const index = await loadSceneIndex(cfg.dataDir, rec.game);
      if (index) indexes.set(rec.slug, index);
    }
    for (const t of titles) {
      if (indexes.has(sceneSlug(t.game))) continue;
      const index = await loadSceneIndex(cfg.dataDir, t.game);
      if (index) indexes.set(sceneSlug(t.game), index);
    }
    if (book.games.length) {
      book = {
        games: book.games.map((g) =>
          filedStatus(
            g,
            indexes.get(g.slug),
            queue.games.find((q) => sceneSlug(q.game) === g.slug),
            now,
          ),
        ),
      };
      await writeFiled(cfg.dataDir, book);
    }
    const windows = cfg.spoilerGuard
      ? windowsFrom(
          [
            ...titles,
            ...book.games.map((g) => ({
              game: g.game,
              release: g.release,
              until: g.until,
            })),
            ...launches.map((l) => ({ game: l.game, release: l.launch })),
          ],
          indexes,
          settings,
        )
      : [];
    setSpoilerWindows(windows);
    return { book, windows };
  } catch (err) {
    log("warn", "game footage: pass failed", { error: errorMessage(err) });
    return { book, windows: [] };
  }
}

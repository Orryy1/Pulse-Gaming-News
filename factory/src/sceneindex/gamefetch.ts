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
// The picker (12 Nov 2026, after the first live pass filed ten small Steam releases, "GTA", "Grand Theft Auto 6",
// "Nintendo Switch 2" and "Fallout"): one record a game however it is written (canonicalGame: "GTA 6", "GTA VI"
// and "Grand Theft Auto 6" are "Grand Theft Auto VI"); hardware, DLC and bare series names are never games (a
// series name is resolved to the one game the story or the calendar makes clear, else skipped); the release
// radar (Steam's popular upcoming list, which carries no wishlist or follower counts) never picks a game alone:
// it dates a game another signal picked, or picks one made by a major studio. Records that no longer qualify are
// marked "dropped" with a reason on every pass and taken out of the job's queue; a record with footage, or the
// owner's, is never dropped and nothing on disk is deleted.

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
/** How near a known release must be to a series story for the story to name that game. */
export const SERIES_RESOLVE_DAYS = 45;

// ---------------------------------------------------------------- what counts as one game

// canonicalGame and isSeriesName live in ./gamenames.ts (shared with the footage title rules).
export { canonicalGame, isSeriesName } from "./gamenames.ts";
import { canonicalGame, isSeriesName } from "./gamenames.ts";

/** Consoles, handhelds, headsets and their services: never a game, whatever the videos say. */
const HARDWARE_ANCHOR =
  /\b(nintendo switch|switch (2|oled|lite)|playstation|ps[1-6]|psp|ps vita|psvr2?|xbox|wii|game ?boy|nintendo (ds|3ds|64)|gamecube|steam hardware|steam (deck|machine|frame|controller)|rog ally|legion go|meta quest|quest [1-3]|vision pro|dualsense)\b/gi;
const HARDWARE_WORDS = new Set(
  "the new next gen pro slim oled lite portal console consoles handheld controller controllers digital edition one series x s 360 u 2 3 5 plus online game pass ultimate hardware price bundle model headset dock edge elite vr".split(
    " ",
  ),
);

/** True when a name is a console, handheld or platform service rather than a game (pure): "Nintendo Switch 2", "PS5 Pro". */
export function isHardware(name: string): boolean {
  const n = name.toLowerCase().replace(/[®™©]/g, "");
  if (!new RegExp(HARDWARE_ANCHOR.source, "i").test(n)) return false;
  return n
    .replace(HARDWARE_ANCHOR, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => HARDWARE_WORDS.has(w));
}

/** True for downloadable content, add-ons, soundtracks, demos and the like (pure); Steam's own type decides when known. */
export function isAddOn(name: string, steamType?: string): boolean {
  if (steamType && steamType.toLowerCase() !== "game") return true;
  return /\b(dlc|soundtrack|ost|season pass|expansion pass|add-?on|upgrade pack|cosmetics?|costume pack|skin pack|character pack|artbook|art book|demo|playtest|supporter pack)\b/i.test(
    name,
  );
}


const hasWords = (hay: string, needle: string) =>
  needle !== "" && ` ${hay} `.includes(` ${needle} `);

const releaseTime = (r?: string) =>
  r ? Date.parse(r.length === 10 ? `${r}T00:00:00Z` : r) : NaN;

/**
 * The one game a series name stands for (pure), or undefined: among the known games of the series (the owner's
 * titles, the launch calendar, games already filed), the one the story's headline names (in full, or by the
 * calendar's match pattern); else the one released within SERIES_RESOLVE_DAYS of `at`. Two or none is undefined.
 */
export function resolveSeries(
  name: string,
  known: Array<{ game: string; release?: string; match?: string }>,
  at: Date,
  headline?: string,
): string | undefined {
  const series = canonicalGame(name);
  const byKey = new Map<
    string,
    { game: string; release?: string; matches: string[] }
  >();
  for (const k of known) {
    const key = canonicalGame(k.game);
    if (
      key === series ||
      !hasWords(key, series) ||
      isSeriesName(k.game) ||
      isHardware(k.game)
    )
      continue;
    const had = byKey.get(key);
    byKey.set(key, {
      game: had?.game ?? k.game.trim(),
      release: had?.release ?? k.release,
      matches: [...(had?.matches ?? []), ...(k.match ? [k.match] : [])],
    });
  }
  const games = [...byKey.entries()];
  if (!games.length) return undefined;
  if (headline?.trim()) {
    const h = canonicalGame(headline);
    const named = games.filter(
      ([key, k]) =>
        hasWords(h, key) ||
        k.matches.some((m) => {
          try {
            return new RegExp(m, "i").test(headline);
          } catch {
            return false;
          }
        }),
    );
    if (named.length === 1) return named[0]![1].game;
    if (named.length > 1) return undefined;
  }
  const near = games.filter(([, k]) => {
    const t = releaseTime(k.release);
    return (
      Number.isFinite(t) &&
      Math.abs(t - at.getTime()) <= SERIES_RESOLVE_DAYS * 86_400_000
    );
  });
  return near.length === 1 ? near[0]![1].game : undefined;
}

/**
 * Studios whose release is a big one on its own, matched against the radar's developer. Steam's developer is the
 * maker: a big publisher's name is on plenty of small games (SEGA publishes SONIC PICO PARK), so publishers alone
 * do not count.
 */
const MAJOR_STUDIOS =
  /\b(rockstar|nintendo|fromsoftware|naughty dog|santa monica studio|insomniac|guerrilla|sucker punch|bend studio|housemarque|nixxes|cd projekt|bethesda game studios|id software|arkane|machinegames|larian|capcom|square enix|ubisoft|blizzard|bungie|remedy entertainment|bioware|respawn|infinity ward|treyarch|sledgehammer|raven software|ea dice|dice stockholm|^dice$|criterion games|motive studio|kojima productions|playground games|turn 10|the coalition|halo studios|343 industries|obsidian entertainment|firaxis|gearbox|sonic team|atlus|ryu ga gotoku|team ninja|koei tecmo|bandai namco|konami|valve|epic games|rocksteady|netherrealm|wb games|avalanche software|io interactive|crystal dynamics|eidos|hoyoverse|mihoyo|game freak|intelligent systems|retro studios|monolith soft|hal laboratory|polyphony|platinumgames|level-5|grinding gear|hello games|supergiant|team cherry|mojang|bluepoint|warhorse|massive entertainment|techland|4a games|asobo|creative assembly)\b/i;

/** True when the radar's developer is a major studio (pure). */
export function majorStudio(developer?: string): boolean {
  return !!developer && MAJOR_STUDIOS.test(developer);
}

/** Why a name is not a game to file (hardware, an add-on, a bare series), or undefined when it is one (pure). */
export function notAGame(
  name: string,
  o: { steamType?: string; seriesAllowed?: boolean } = {},
): string | undefined {
  if (isHardware(name)) return "hardware or a platform, not a game";
  if (isAddOn(name, o.steamType)) return "DLC or an add-on, not a game";
  if (!o.seriesAllowed && isSeriesName(name))
    return "a series name, not one game";
  return undefined;
}

/**
 * The games the signals name (pure). The owner's titles always, as written; the launch calendar's games from two
 * weeks before launch to four after; a story about a release or its reviews at the big-story size; a game with
 * two or more Pulse videos in seven days; a release radar game only when another signal names it too or a major
 * studio makes it (the radar is Steam's popular upcoming list: no wishlist or follower counts, and mostly small
 * games). Hardware, DLC and add-ons never count; a series name counts only as the one game the story or the
 * calendar makes clear (resolveSeries). Every name is written the way the owner, the calendar or the filed record
 * writes the same game, so "GTA 6" from the videos lands on "Grand Theft Auto VI". A release date found in the
 * calendar or the radar is used for any signal naming the same game.
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
    headline?: string;
  }>;
  videoGames: Array<{ game: string; at: string }>;
  bigSize: number;
  now: Date;
  signals: Set<FetchSignal>;
  /** The games already filed, for spellings and for naming a series' game. */
  filed?: FiledGame[];
}): FetchCandidate[] {
  const day = 86_400_000;
  const now = input.now.getTime();
  const live = (input.filed ?? []).filter((g) => g.status !== "dropped");
  // The spelling a game is filed under: the owner's, then the calendar's, then the filed record's.
  const spelling = new Map<string, string>();
  const spell = (game: string) => {
    const key = canonicalGame(game);
    if (key && !spelling.has(key)) spelling.set(key, game.trim());
  };
  input.titles.forEach((t) => spell(t.game));
  input.launches.forEach((l) => spell(l.game));
  live.forEach((g) => spell(g.game));
  const known = new Map<string, string>();
  for (const l of input.launches) known.set(canonicalGame(l.game), l.launch);
  for (const r of input.radar)
    if (!known.has(canonicalGame(r.name)))
      known.set(canonicalGame(r.name), r.date);
  const anchors = [
    ...input.titles.map((t) => ({ game: t.game, release: t.release })),
    ...input.launches.map((l) => ({
      game: l.game,
      release: l.launch,
      match: l.match,
    })),
    ...live.map((g) => ({ game: g.game, release: g.release })),
  ];
  const finish = (c: FetchCandidate): FetchCandidate => {
    const game = spelling.get(canonicalGame(c.game)) ?? c.game.trim();
    const release = c.release ?? known.get(canonicalGame(game));
    return { ...c, game, ...(release ? { release } : {}) };
  };
  /** A story's or a video's name as the one game it is, or undefined to skip it. */
  const asGame = (
    name: string,
    at: Date,
    headline?: string,
  ): string | undefined => {
    const n = name.trim();
    if (!n || notAGame(n, { seriesAllowed: true })) return undefined;
    return isSeriesName(n) ? resolveSeries(n, anchors, at, headline) : n;
  };
  const owner: FetchCandidate[] = [];
  const calendar: FetchCandidate[] = [];
  const big: FetchCandidate[] = [];
  const videos: FetchCandidate[] = [];
  const radar: FetchCandidate[] = [];
  if (input.signals.has("owner"))
    for (const t of input.titles)
      owner.push(
        finish({
          game: t.game,
          signal: "owner",
          release: t.release,
          until: t.until,
          why: "GAME_FETCH_TITLES",
        }),
      );
  if (input.signals.has("calendar"))
    for (const l of input.launches) {
      const at = Date.parse(`${l.launch}T00:00:00Z`);
      if (
        Number.isFinite(at) &&
        now >= at - 14 * day &&
        now <= at + 28 * day &&
        !notAGame(l.game, { seriesAllowed: true })
      )
        calendar.push(
          finish({
            game: l.game,
            signal: "calendar",
            release: l.launch,
            why: `launch calendar ${l.launch}`,
          }),
        );
    }
  if (input.signals.has("bigstory"))
    for (const s of input.stories) {
      if (s.size < input.bigSize || !BIG_STORY_EVENTS.has(s.event)) continue;
      const game = asGame(s.name, new Date(s.firstAt), s.headline);
      if (!game) continue;
      big.push(
        finish({
          game,
          signal: "bigstory",
          why: `big story (${s.event}, size ${Math.round(s.size)})`,
          release: known.get(canonicalGame(game)) ?? s.firstAt.slice(0, 10),
        }),
      );
    }
  if (input.signals.has("videos")) {
    const counts = new Map<string, { game: string; n: number }>();
    for (const v of input.videoGames) {
      if (!v.game?.trim() || now - Date.parse(v.at) > VIDEO_DAYS * day)
        continue;
      const game = asGame(v.game, input.now);
      if (!game) continue;
      const key = canonicalGame(game);
      const c = counts.get(key) ?? { game, n: 0 };
      c.n++;
      counts.set(key, c);
    }
    for (const c of counts.values())
      if (c.n >= VIDEOS_NEEDED)
        videos.push(
          finish({
            game: c.game,
            signal: "videos",
            why: `${c.n} Pulse videos in ${VIDEO_DAYS} days`,
          }),
        );
  }
  if (input.signals.has("radar")) {
    const picked = new Set([
      ...[...owner, ...calendar, ...big, ...videos].map((c) =>
        canonicalGame(c.game),
      ),
      ...live
        .filter((g) => g.signals.some((s) => s !== "radar"))
        .map((g) => canonicalGame(g.game)),
    ]);
    for (const r of input.radar) {
      if (notAGame(r.name, { steamType: r.type })) continue;
      const major = majorStudio(r.developer);
      if (!major && !picked.has(canonicalGame(r.name))) continue;
      radar.push(
        finish({
          game: r.name,
          signal: "radar",
          release: r.date,
          why: major
            ? `release radar ${r.date} (${r.developer})`
            : `release radar ${r.date}`,
        }),
      );
    }
  }
  return [...owner, ...calendar, ...radar, ...big, ...videos];
}

export type FiledStatus =
  | "before-release"
  | "searching"
  | "no-source"
  | "indexing"
  | "describing"
  | "filed"
  | "stopped"
  | "dropped";

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
  /** Why a record no longer qualifies (status "dropped"): kept for the record, never planned. */
  dropped?: string;
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

/** A record's release and spoiler window after a signal's release (pure): the owner's wins, else the earliest. */
function takeRelease(
  rec: FiledGame,
  c: Pick<FetchCandidate, "signal" | "release" | "until">,
  o: { days: number; openingShare: number },
): void {
  if (c.signal === "owner") {
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

/** The live record for a game however it is written, else a dropped one to bring back (pure). */
function findRecord(games: FiledGame[], game: string): FiledGame | undefined {
  const key = canonicalGame(game);
  const slug = sceneSlug(game);
  const same = (g: FiledGame) =>
    g.slug === slug || canonicalGame(g.game) === key;
  return (
    games.find((g) => g.status !== "dropped" && same(g)) ??
    games.find((g) => g.status === "dropped" && same(g))
  );
}

/**
 * The book with today's candidates merged in (pure): one record a game however it is written (canonicalGame),
 * signals added up, the owner's release and window end winning, otherwise the earliest release any signal knows.
 * A dropped record a qualifying candidate names again is brought back with only what qualifies it now. A game
 * whose window and daily looks are long over is kept (the weekly report lists what is filed) but no longer planned.
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
    let rec = findRecord(games, c.game);
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
    if (rec.status === "dropped") {
      delete rec.dropped;
      rec.status = "searching";
      rec.signals = [];
      rec.why = [];
    }
    if (!rec.signals.includes(c.signal)) rec.signals.push(c.signal);
    if (!rec.why.includes(c.why)) rec.why = [...rec.why, c.why].slice(-6);
    if (c.signal === "owner") rec.game = c.game;
    takeRelease(rec, c, o);
  }
  return { games };
}

/** A record that is never dropped: the owner's, or one with footage found or indexed. */
export function keepsRecord(rec: FiledGame): boolean {
  return (
    rec.signals.includes("owner") ||
    !!rec.source ||
    rec.status === "indexing" ||
    rec.status === "describing" ||
    rec.status === "filed"
  );
}

/**
 * The book with records that no longer qualify marked "dropped" with a reason (pure), run on every pass before
 * today's candidates are merged in. Hardware and add-ons go; a series name goes, its signals moving to the one
 * game it resolves to when it does; a second record for a game already filed under another spelling hands over
 * its signals and goes; a game the release radar alone picked goes (the day's candidates bring it back if a
 * major studio makes it). The owner's records and any record with footage are never touched, and nothing is
 * deleted: the record stays, marked.
 */
export function pruneFiled(
  book: FiledBook,
  o: {
    now: Date;
    titles?: FetchTitle[];
    launches?: LaunchEntry[];
  },
): FiledBook {
  const games = book.games.map((g) => ({
    ...g,
    signals: [...g.signals],
    why: [...g.why],
  }));
  const at = o.now.toISOString();
  const drop = (g: FiledGame, why: string) => {
    g.status = "dropped";
    g.dropped = why;
    g.updatedAt = at;
  };
  const handOver = (from: FiledGame, to: FiledGame) => {
    for (const s of from.signals)
      if (!to.signals.includes(s)) to.signals.push(s);
    for (const w of from.why)
      if (!to.why.includes(w)) to.why = [...to.why, w].slice(-6);
    to.updatedAt = at;
  };
  const live = () => games.filter((g) => g.status !== "dropped");
  const anchors = () => [
    ...(o.titles ?? []).map((t) => ({ game: t.game, release: t.release })),
    ...(o.launches ?? []).map((l) => ({
      game: l.game,
      release: l.launch,
      match: l.match,
    })),
    ...live().map((g) => ({ game: g.game, release: g.release })),
  ];
  // The record a game's other spellings fold into: the owner's, then one with footage, then the first filed.
  const rank = (g: FiledGame) =>
    (g.signals.includes("owner") ? 4 : 0) + (keepsRecord(g) ? 2 : 0);
  for (const g of games) {
    if (g.status === "dropped" || keepsRecord(g)) continue;
    const not = notAGame(g.game, { seriesAllowed: true });
    if (not) {
      drop(g, not);
      continue;
    }
    if (isSeriesName(g.game)) {
      const when = g.release ? releaseTime(g.release) : Date.parse(g.firstSeen);
      const target = resolveSeries(g.game, anchors(), new Date(when));
      const rec = target ? findRecord(live(), target) : undefined;
      if (rec && rec !== g && rec.status !== "dropped") {
        handOver(g, rec);
        drop(g, `a series name; its signals moved to ${rec.game}`);
      } else drop(g, "a series name, not one game");
      continue;
    }
    const key = canonicalGame(g.game);
    const twin = live()
      .filter((x) => x !== g && canonicalGame(x.game) === key)
      .sort((a, b) => rank(b) - rank(a))[0];
    if (twin) {
      handOver(g, twin);
      drop(g, `the same game as ${twin.game}`);
      continue;
    }
    if (g.signals.length && g.signals.every((s) => s === "radar"))
      drop(g, "picked by the release radar alone, not a big release");
  }
  return { games };
}

/**
 * The job's queue without the footage plans of dropped records (pure): only entries the fetcher put there
 * ("footage: ..." reasons) that have not started indexing go; downloaded media and other requests stay.
 */
export function unplanDropped(queue: SceneQueue, book: FiledBook): SceneQueue {
  const live = new Set(
    book.games.filter((g) => g.status !== "dropped").map((g) => g.slug),
  );
  const dropped = new Set(
    book.games
      .filter((g) => g.status === "dropped" && !live.has(g.slug))
      .map((g) => g.slug),
  );
  if (!dropped.size) return queue;
  const games = queue.games.filter(
    (q) =>
      !(
        dropped.has(sceneSlug(q.game)) &&
        q.reason.startsWith("footage:") &&
        q.state !== "building" &&
        q.state !== "done"
      ),
  );
  return games.length === queue.games.length ? queue : { games };
}

/**
 * The job's launch plan for a record (pure), or undefined when its time is over: searched every `hours` from its
 * release (a game with no known release is taken as out, searched three times less often), looked at again every
 * `recheckHours` until the later of its spoiler window's end and `recheckDays` after release. A dropped record is
 * never planned.
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
  if (rec.status === "dropped") return undefined;
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
  if (rec.status === "dropped") return rec;
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
  const games = book.games.filter((g) => g.status !== "dropped");
  if (!games.length) return [];
  const when = (iso?: string) => (iso ? iso.slice(0, 10) : "?");
  const rows = [...games]
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
      Array<{
        name: string;
        event: string;
        size: number;
        firstAt: string;
        headline?: string;
      }>
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
      // What no longer qualifies is marked first, so today's candidates can bring a game back.
      book = pruneFiled(book, { now, titles, launches });
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
        filed: book.games,
      });
      book = mergeFiled(book, candidates, now, settings);
      const queue = await readQueue(cfg.dataDir);
      const next = plannedQueue(unplanDropped(queue, book), book, now, {
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
            ...book.games
              .filter((g) => g.status !== "dropped")
              .map((g) => ({
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

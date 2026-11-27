// Demand before making (owner, 1 Nov 2026): an evergreen ranking, a long ranking or a Why Short is only worth
// making when people are watching that game on YouTube now. Before the editor picks, each candidate topic is
// searched on YouTube for the last week's uploads sorted by view count (first YouTube's search page through yt-dlp;
// since 26 Nov 2026 the Data API, see below). The demand is the views of the five
// biggest recent videos that actually name the topic. Candidates are ranked by it, a topic under
// DEMAND_MIN_VIEWS is skipped, the editor sees the figures, and each pick gets one Discord line. Requests stay
// light: at most DEMAND_LOOKUPS searches a pick, each result cached in the settings table (24 hours then, a week now),
// and a failed search counts as unknown (never as "no demand"), so a YouTube hiccup never empties the list.
//
// 26 Nov 2026: the page read went through yt-dlp's anonymous lane, which is retired (YT_ANON_LANE=off), so every
// lookup failed. Lookups now go to the Data API (src/discovery/demandapi.ts, never yt-dlp): a topic's figure is
// cached for DEMAND_CACHE_DAYS (7; a game's demand barely moves day to day), the topics of a run are de-duplicated
// and their view counts read in shared batches, and new topics are rationed to DEMAND_API_PER_DAY (8) a Pacific day,
// at most half of it a run (so the first picker of the day cannot take it all); a lookup never sent is given back.
// Over that, an older reading stands in (DEMAND_STALE_DAYS), and only then is a topic unknown. One log line a run.

import type { Db } from "../db.ts";
import type { EvergreenCandidate } from "../editorial/evergreen.ts";
import { errorMessage, log } from "../lib/util.ts";

/** YouTube's search-page filter: uploaded this week, sorted by view count. */
export const WEEK_BY_VIEWS = "CAMSAggD";
export const CACHE_HOURS = 7 * 24;
/** New topics looked up on the Data API a Pacific day when the setting is missing (DEMAND_API_PER_DAY). */
export const DEMAND_API_PER_DAY = 8;
/** The weight an older (stale) reading's views carry when ranked against fresh ones. */
export const STALE_WEIGHT = 0.5;
/** The recent hits a topic's demand is measured on. */
const TOP = 5;

export interface SearchRow {
  videoId: string;
  views: number;
  channel: string;
  title: string;
}

export interface Demand {
  query: string;
  /** Views of the top recent videos that name the topic. */
  views: number;
  /** How many of the page's videos name the topic. */
  hits: number;
  top?: { title: string; views: number };
  level: "none" | "low" | "medium" | "high";
  at: string;
  /**
   * True when this figure is an older cached reading used because no fresh one could be had (DEMAND_STALE_DAYS):
   * the search was paused or failed, or the pick's lookups ran out. It ranks candidates but never skips one.
   */
  stale?: boolean;
}

/** The search page for a topic: this week's uploads, most viewed first. */
export function demandUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${WEEK_BY_VIEWS}`;
}

/** Rows of `id \t views \t channel \t title` from yt-dlp's flat listing of a search page. */
export function parseDemandRows(stdout: string): SearchRow[] {
  return String(stdout)
    .split(/\r?\n/)
    .map((l) => l.split("\t"))
    .filter((r) => r.length >= 4 && /^[\w-]{11}$/.test(r[0]!))
    .map(([videoId, views, channel, ...title]) => ({
      videoId: videoId!,
      views: Number(views) || 0,
      channel: channel === "NA" ? "" : channel!,
      title: title.join("\t"),
    }));
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "or",
  "to",
  "in",
  "on",
  "for",
  "with",
  "game",
  "games",
  "every",
  "best",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
}

/** True when a video title names the topic: half its words at least, an acronym ("GTA") standing for its words. */
export function namesTopic(title: string, topic: string): boolean {
  const want = [...new Set(words(topic))];
  if (!want.length) return false;
  const have = new Set(words(title));
  // "Grand Theft Auto" is "GTA" in most titles: the initials of three or more capitalised words.
  const caps = topic.replace(/[:(].*$/, "").match(/\b[A-Z][a-z]+/g) ?? [];
  let matched = want.filter((w) => have.has(w)).length;
  if (caps.length >= 3) {
    const acro = caps.map((c) => c[0]!.toLowerCase()).join("");
    const covered = caps.map((c) => c.toLowerCase());
    if (have.has(acro))
      matched += covered.filter((c) => want.includes(c) && !have.has(c)).length;
  }
  return matched >= Math.ceil(want.length / 2);
}

/** The demand a search page shows: the views of the top recent videos that name the topic, and its level. */
export function scoreDemand(
  query: string,
  rows: SearchRow[],
  minViews: number,
  now: Date,
): Demand {
  const named = rows
    .filter((r) => namesTopic(r.title, query))
    .sort((a, b) => b.views - a.views);
  const views = named.slice(0, TOP).reduce((n, r) => n + r.views, 0);
  const level =
    views < minViews
      ? "none"
      : views >= 50 * minViews
        ? "high"
        : views >= 10 * minViews
          ? "medium"
          : "low";
  return {
    query,
    views,
    hits: named.length,
    top: named[0]
      ? { title: named[0].title.slice(0, 90), views: named[0].views }
      : undefined,
    level,
    at: now.toISOString(),
  };
}

export interface DemandCache {
  get(query: string): Promise<Demand | undefined>;
  set(query: string, d: Demand): Promise<void>;
  /** A cached reading of any age within `maxHours` (for the stale fallback); optional, so plain caches still work. */
  getAged?(query: string, maxHours: number): Promise<Demand | undefined>;
}

/** True when a cached reading is younger than `hours` at `now` (pure). */
export function demandYoungerThan(d: Demand, hours: number, now: Date): boolean {
  const age = now.getTime() - Date.parse(d.at);
  return Number.isFinite(age) && age < hours * 3600_000;
}

/** The cache in the settings table: one row per topic, good for `cacheHours` (CACHE_HOURS, a week). */
export function dbDemandCache(db: Db, now: () => Date, cacheHours = CACHE_HOURS): DemandCache {
  const fresh = Number.isFinite(cacheHours) && cacheHours > 0 ? cacheHours : CACHE_HOURS;
  const key = (q: string) => `demand:${q.toLowerCase().trim()}`;
  const read = async (q: string, hours: number): Promise<Demand | undefined> => {
    const [row] = await db.query<{ value: string }>(
      `SELECT value FROM settings WHERE key = $1`,
      [key(q)],
    );
    if (!row) return undefined;
    try {
      const d = JSON.parse(row.value) as Demand;
      return demandYoungerThan(d, hours, now()) ? d : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    get: (q) => read(q, fresh),
    getAged: (q, maxHours) => read(q, maxHours),
    async set(q, d) {
      await db.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key(q), JSON.stringify(d)],
      );
    },
  };
}

/** The day's allowance of new Data API demand lookups: `take(n)` grants up to n and returns how many it granted. */
export interface DemandBudget {
  take(n: number): Promise<number>;
  /** Gives back lookups granted but never sent (refused by the search bucket, quota already spent). */
  refund?(n: number): Promise<void>;
}

/** The Pacific day ("2026-11-26"), when YouTube's quota turns (pure). */
function pacificDayOf(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * DEMAND_API_PER_DAY in the settings table, one counter a Pacific day, taken atomically; one run takes at most
 * `perRun` (half the day's, rounded up), so the first picker of the day leaves some for the others.
 */
export function dbDemandBudget(
  db: Db,
  perDay: number | undefined,
  now: () => Date,
  perRun?: number,
): DemandBudget {
  const cap = Number.isFinite(perDay) && (perDay as number) >= 0 ? Math.floor(perDay as number) : DEMAND_API_PER_DAY;
  const share = perRun !== undefined && Number.isFinite(perRun) && perRun >= 0 ? Math.floor(perRun) : Math.ceil(cap / 2);
  const keyOf = () => `demand_api:${pacificDayOf(now())}`;
  return {
    async refund(n) {
      const back = Math.max(0, Math.floor(n));
      if (!back) return;
      await db.query(
        `UPDATE settings SET value = GREATEST(0, value::int - $2::int)::text, updated_at = now() WHERE key = $1`,
        [keyOf(), back],
      );
    },
    async take(n) {
      const want = Math.min(share, Math.max(0, Math.floor(n)));
      if (!want || !cap) return 0;
      const key = keyOf();
      await db.query(`INSERT INTO settings (key, value) VALUES ($1, '0') ON CONFLICT (key) DO NOTHING`, [key]);
      const [row] = await db.query<{ before: number | string; after: number | string }>(
        `WITH old AS (SELECT value::int AS v FROM settings WHERE key = $1 FOR UPDATE)
         UPDATE settings SET value = LEAST(old.v + $2::int, GREATEST(old.v, $3::int))::text, updated_at = now()
           FROM old WHERE settings.key = $1
         RETURNING old.v AS before, settings.value AS after`,
        [key, want, cap],
      );
      return row ? Math.max(0, Number(row.after) - Number(row.before)) : 0;
    },
  };
}

/** The tally of one demand run, logged as one line. */
export interface DemandTally {
  topics: number;
  cache: number;
  api: number;
  failed: number;
  /** Topics not asked: over the pick's lookups or the day's allowance. */
  skipped: number;
  stale: number;
  unknown: number;
}

/**
 * The demand of each candidate: from the cache, else one search page each, at most `lookups` pages. A
 * candidate not looked up, or whose search failed, is absent (unknown), unless `staleDays` is set: then its
 * newest cached reading from the last `staleDays` days stands in, marked `stale` (DEMAND_STALE_DAYS, 20 Nov
 * 2026: 20 of 26 picks from 12 to 19 Nov went out with no figure, mostly while YouTube's bot check paused
 * searching, though the same topics had been measured a few days earlier).
 */
export async function demandFor(
  candidates: EvergreenCandidate[],
  o: {
    /** One topic's search page (tests and older callers). */
    search?: (url: string) => Promise<SearchRow[]>;
    /** Several topics at once (the Data API, src/discovery/demandapi.ts): rows, or the Error of a failed search. */
    searchMany?: (queries: string[]) => Promise<Map<string, SearchRow[] | Error>>;
    /** The day's allowance of new lookups (DEMAND_API_PER_DAY); unset: only `lookups` limits. */
    budget?: DemandBudget;
    /** Which picker asked, for the log line. */
    label?: string;
    cache: DemandCache;
    lookups: number;
    minViews: number;
    now: Date;
    /** Days an older cached reading may stand in for a missing one; 0 or unset: never. */
    staleDays?: number;
  },
): Promise<Map<string, Demand>> {
  const norm = (q: string) => q.toLowerCase().trim();
  // One lookup a topic, however many candidates (or spellings in case) name it.
  const unique = new Map<string, string>();
  for (const c of candidates) if (!unique.has(norm(c.name))) unique.set(norm(c.name), c.name);
  const tally: DemandTally = { topics: unique.size, cache: 0, api: 0, failed: 0, skipped: 0, stale: 0, unknown: 0 };
  const found = new Map<string, Demand>();
  const missing: string[] = [];
  for (const [k, name] of unique) {
    const cached = await o.cache.get(name).catch(() => undefined);
    if (cached) {
      found.set(k, cached);
      tally.cache++;
    } else missing.push(name);
  }
  const wanted = o.search || o.searchMany ? missing.slice(0, Math.max(0, o.lookups)) : [];
  const granted = wanted.length && o.budget ? await o.budget.take(wanted.length).catch(() => 0) : wanted.length;
  const ask = wanted.slice(0, Math.max(0, Math.min(granted, wanted.length)));
  tally.skipped = missing.length - ask.length;
  let firstError: string | undefined;
  if (ask.length) {
    const toError = (err: unknown) => (err instanceof Error ? err : new Error(errorMessage(err)));
    let results = new Map<string, SearchRow[] | Error>();
    if (o.searchMany) {
      // A batch that threw sent nothing countable (no login, no network): its lookups are given back.
      results = await o.searchMany(ask).catch((err) => {
        const e = Object.assign(toError(err), { notSent: true });
        return new Map(ask.map((q) => [q, e] as const));
      });
    } else if (o.search) {
      for (const q of ask) results.set(q, await o.search(demandUrl(q)).catch(toError));
    }
    // A lookup refused before its search was sent (or a batch that threw before asking) goes back to the day.
    const notSent = ask.filter((q) => {
      const r = results.get(q);
      return r instanceof Error && (r as { notSent?: boolean }).notSent === true;
    }).length;
    if (notSent && o.budget?.refund) await o.budget.refund(notSent).catch(() => undefined);
    for (const q of ask) {
      const r = results.get(q);
      if (Array.isArray(r)) {
        const d = scoreDemand(q, r, o.minViews, o.now);
        found.set(norm(q), d);
        tally.api++;
        await o.cache.set(q, d).catch(() => undefined);
      } else {
        tally.failed++;
        firstError ??= r ? errorMessage(r) : "no answer";
      }
    }
  }
  // Over the allowance, failed or not asked: an older reading stands in, and only then is the topic unknown.
  const staleHours = Math.max(0, o.staleDays ?? 0) * 24;
  for (const [k, name] of unique) {
    if (found.has(k)) continue;
    const old =
      staleHours > 0 && o.cache.getAged ? await o.cache.getAged(name, staleHours).catch(() => undefined) : undefined;
    if (old) {
      found.set(k, { ...old, stale: true });
      tally.stale++;
    } else tally.unknown++;
  }
  const out = new Map<string, Demand>();
  for (const c of candidates) {
    const d = found.get(norm(c.name));
    if (d) out.set(c.name, d);
  }
  if (tally.topics)
    log(tally.failed ? "warn" : "info", "demand lookups", {
      ...(o.label ? { lane: o.label } : {}),
      ...tally,
      ...(firstError ? { error: firstError.slice(0, 200) } : {}),
    });
  return out;
}

/** The demand searches a services bundle offers: the batched Data API one when present, else one page at a time. */
export function demandSearchers(s: {
  searchDemand?: (url: string) => Promise<SearchRow[]>;
  searchDemandMany?: (queries: string[]) => Promise<Map<string, SearchRow[] | Error>>;
}): {
  search?: (url: string) => Promise<SearchRow[]>;
  searchMany?: (queries: string[]) => Promise<Map<string, SearchRow[] | Error>>;
} {
  return s.searchDemandMany
    ? { searchMany: (queries) => s.searchDemandMany!(queries) }
    : s.searchDemand
      ? { search: (url) => s.searchDemand!(url) }
      : {};
}

/** Views as a short figure: 1.2M, 340K, 900. */
export function viewsLabel(n: number): string {
  return n >= 1e6
    ? `${(n / 1e6).toFixed(1)}M`
    : n >= 1e3
      ? `${Math.round(n / 1e3)}K`
      : String(n);
}

/**
 * The candidates ranked by demand, biggest first (an unknown one sits at the bar, so it is neither favoured
 * nor lost), with the figure in each note for the editor; topics under the bar are skipped.
 */
export function rankByDemand(
  candidates: EvergreenCandidate[],
  demand: Map<string, Demand>,
  minViews: number,
): { kept: EvergreenCandidate[]; skipped: EvergreenCandidate[] } {
  // Only a fresh "none" skips a topic: an older reading ranks it but never drops it.
  const none = (c: EvergreenCandidate) => {
    const d = demand.get(c.name);
    return d?.level === "none" && !d.stale;
  };
  const skipped = candidates.filter(none);
  const kept = candidates
    .filter((c) => !none(c))
    // An older reading counts half against fresh ones, so a launch-week spike does not keep winning for days.
    .map((c, i) => {
      const d = demand.get(c.name);
      return { c, i, v: d ? (d.stale ? d.views * STALE_WEIGHT : d.views) : minViews };
    })
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .map(({ c }) => {
      const d = demand.get(c.name);
      if (!d) return c;
      const fig = d.stale
        ? `YouTube, last measured ${d.at.slice(0, 10)}: ${viewsLabel(d.views)} views on its top videos that week`
        : `YouTube this week: ${viewsLabel(d.views)} views on its top videos`;
      return { ...c, note: c.note ? `${c.note}; ${fig}` : fig };
    });
  return { kept, skipped };
}

/** The one Discord line a pick gets: the topic's demand and what was skipped. */
export function demandLine(
  lane: string,
  picked: string,
  d: Demand | undefined,
  skipped: number,
  now?: Date,
): string {
  const ago = d?.stale && now ? Math.max(1, Math.round((now.getTime() - Date.parse(d.at)) / 86_400_000)) : undefined;
  const when = ago ? `${ago} day${ago === 1 ? "" : "s"} ago` : `on ${d?.at.slice(0, 10)}`;
  const fig = !d
    ? "demand not checked (search unavailable or over the lookup limit)"
    : d.stale
      ? `${viewsLabel(d.views)} views on its top YouTube videos when last measured ${when} (${d.level} demand; a fresh search was not possible)`
      : `${viewsLabel(d.views)} views on its top YouTube videos this week (${d.hits} recent video${d.hits === 1 ? " names" : "s name"} it, ${d.level} demand)`;
  const skip = skipped
    ? ` ${skipped} candidate${skipped === 1 ? "" : "s"} skipped for no recent demand.`
    : "";
  return `Demand check, ${lane}: "${picked}" has ${fig}.${skip}`;
}

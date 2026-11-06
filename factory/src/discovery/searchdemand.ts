// Demand before making (owner, 1 Nov 2026): an evergreen ranking, a long ranking or a Why Short is only worth
// making when people are watching that game on YouTube now. Before the editor picks, each candidate topic is
// searched on YouTube's own search page (no API quota: yt-dlp reads the page, as the footage search does),
// filtered to the last week and sorted by view count (sp=CAMSAggD). The demand is the views of the five
// biggest recent videos that actually name the topic. Candidates are ranked by it, a topic under
// DEMAND_MIN_VIEWS is skipped, the editor sees the figures, and each pick gets one Discord line. Requests stay
// light: at most DEMAND_LOOKUPS search pages a pick, each result cached for 24 hours in the settings table,
// and a failed search counts as unknown (never as "no demand"), so a YouTube hiccup never empties the list.

import type { Db } from "../db.ts";
import type { EvergreenCandidate } from "../editorial/evergreen.ts";
import { errorMessage, log } from "../lib/util.ts";

/** YouTube's search-page filter: uploaded this week, sorted by view count. */
export const WEEK_BY_VIEWS = "CAMSAggD";
export const CACHE_HOURS = 24;
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
}

/** The cache in the settings table: one row per topic, good for CACHE_HOURS. */
export function dbDemandCache(db: Db, now: () => Date): DemandCache {
  const key = (q: string) => `demand:${q.toLowerCase().trim()}`;
  return {
    async get(q) {
      const [row] = await db.query<{ value: string }>(
        `SELECT value FROM settings WHERE key = $1`,
        [key(q)],
      );
      if (!row) return undefined;
      try {
        const d = JSON.parse(row.value) as Demand;
        return now().getTime() - Date.parse(d.at) < CACHE_HOURS * 3600_000
          ? d
          : undefined;
      } catch {
        return undefined;
      }
    },
    async set(q, d) {
      await db.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key(q), JSON.stringify(d)],
      );
    },
  };
}

/**
 * The demand of each candidate: from the cache, else one search page each, at most `lookups` pages. A
 * candidate not looked up, or whose search failed, is absent (unknown).
 */
export async function demandFor(
  candidates: EvergreenCandidate[],
  o: {
    search: (url: string) => Promise<SearchRow[]>;
    cache: DemandCache;
    lookups: number;
    minViews: number;
    now: Date;
  },
): Promise<Map<string, Demand>> {
  const out = new Map<string, Demand>();
  let left = o.lookups;
  for (const c of candidates) {
    const cached = await o.cache.get(c.name).catch(() => undefined);
    if (cached) {
      out.set(c.name, cached);
      continue;
    }
    if (left <= 0) continue;
    left--;
    try {
      const d = scoreDemand(
        c.name,
        await o.search(demandUrl(c.name)),
        o.minViews,
        o.now,
      );
      out.set(c.name, d);
      await o.cache.set(c.name, d).catch(() => undefined);
    } catch (err) {
      log("warn", "demand search failed", {
        topic: c.name,
        error: errorMessage(err),
      });
    }
  }
  return out;
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
  const skipped = candidates.filter(
    (c) => demand.get(c.name)?.level === "none",
  );
  const kept = candidates
    .filter((c) => demand.get(c.name)?.level !== "none")
    .map((c, i) => ({ c, i, v: demand.get(c.name)?.views ?? minViews }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .map(({ c }) => {
      const d = demand.get(c.name);
      if (!d) return c;
      const fig = `YouTube this week: ${viewsLabel(d.views)} views on its top videos`;
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
): string {
  const fig = d
    ? `${viewsLabel(d.views)} views on its top YouTube videos this week (${d.hits} recent video${d.hits === 1 ? " names" : "s name"} it, ${d.level} demand)`
    : "demand not checked (search unavailable or over the lookup limit)";
  const skip = skipped
    ? ` ${skipped} candidate${skipped === 1 ? "" : "s"} skipped for no recent demand.`
    : "";
  return `Demand check, ${lane}: "${picked}" has ${fig}.${skip}`;
}

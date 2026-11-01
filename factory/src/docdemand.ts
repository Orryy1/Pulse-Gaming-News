// The demand interface the breakout documentary picker (src/docpick.ts) reads. The YouTube demand check itself
// (the free search page, this week's uploads sorted by views) is built on the claude/story-mix branch as
// src/discovery/searchdemand.ts and was not on claude/stage when this was written (1 Nov 2026). This is a stub
// with the same shapes (Demand, SearchRow and the Services hook `searchDemand(url)`), so the picker works
// today with demand "unknown" and picks up the real check the moment it lands: when the services bundle carries
// `searchDemand`, the lookup below searches the page the same way. When story-mix merges, replace the body of
// docDemandLookup with searchdemand.ts's demandFor (and its cache) and delete the copies here.

/** One row of the search page (same shape as searchdemand.ts SearchRow). */
export interface SearchRow {
  videoId: string;
  views: number;
  channel: string;
  title: string;
}

/** A topic's demand (same shape as searchdemand.ts Demand). */
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

/** Looks a topic up; undefined means unknown (never "no demand"). */
export type DemandLookup = (topic: string) => Promise<Demand | undefined>;

/** YouTube's search-page filter: uploaded this week, sorted by view count (searchdemand.ts WEEK_BY_VIEWS). */
const WEEK_BY_VIEWS = "CAMSAggD";
/** A topic under this many views on its top recent videos has no demand (searchdemand.ts DEMAND_MIN_VIEWS's role). */
export const DOC_DEMAND_MIN_VIEWS = 20_000;

const words = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(
      (w) => w.length > 2 && !["the", "and", "game", "games"].includes(w),
    );

/** The demand a search page shows: the top five recent videos whose titles carry half the topic's words. */
export function demandOf(
  topic: string,
  rows: SearchRow[],
  now: Date,
  minViews = DOC_DEMAND_MIN_VIEWS,
): Demand {
  const want = [...new Set(words(topic))];
  const named = rows
    .filter((r) => {
      const have = new Set(words(r.title));
      return (
        want.length > 0 &&
        want.filter((w) => have.has(w)).length >= Math.ceil(want.length / 2)
      );
    })
    .sort((a, b) => b.views - a.views);
  const views = named.slice(0, 5).reduce((n, r) => n + r.views, 0);
  return {
    query: topic,
    views,
    hits: named.length,
    top: named[0]
      ? { title: named[0].title.slice(0, 90), views: named[0].views }
      : undefined,
    level:
      views < minViews
        ? "none"
        : views >= 50 * minViews
          ? "high"
          : views >= 10 * minViews
            ? "medium"
            : "low",
    at: now.toISOString(),
  };
}

/**
 * The picker's lookup, or undefined when the services bundle has no demand check yet (claude/story-mix adds
 * `searchDemand`). A failed search is unknown.
 */
export function docDemandLookup(
  services: object,
  now: () => Date,
): DemandLookup | undefined {
  const search = (
    services as { searchDemand?: (url: string) => Promise<SearchRow[]> }
  ).searchDemand;
  if (typeof search !== "function") return undefined;
  return async (topic) => {
    try {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(topic)}&sp=${WEEK_BY_VIEWS}`;
      return demandOf(topic, await search.call(services, url), now());
    } catch {
      return undefined;
    }
  };
}

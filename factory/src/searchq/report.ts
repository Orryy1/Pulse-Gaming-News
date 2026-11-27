// The search Shorts' line in the Sunday growth report (SEARCH_SHORTS): the share of their views that came from YouTube
// search against the share for every other Short, from the traffic sources the factory stores once per Short (the
// "reach" row, src/analytics.ts). The point of the lane is search traffic, so this is the number that judges it.

import type { Db } from "../db.ts";

export interface ReachRow {
  search: boolean;
  /** Views by traffic source type, as YouTube Analytics names them (YT_SEARCH, SHORTS, ...). */
  sources: Record<string, number>;
}

interface Side {
  shorts: number;
  views: number;
  fromSearch: number;
}

const side = (rows: ReachRow[]): Side =>
  rows.reduce<Side>(
    (t, r) => {
      const views = Object.values(r.sources).reduce(
        (a, b) => a + (Number(b) || 0),
        0,
      );
      return {
        shorts: t.shorts + 1,
        views: t.views + views,
        fromSearch: t.fromSearch + (Number(r.sources.YT_SEARCH) || 0),
      };
    },
    { shorts: 0, views: 0, fromSearch: 0 },
  );

const pct = (s: Side) =>
  s.views > 0
    ? `${Math.round((s.fromSearch / s.views) * 1000) / 10}%`
    : "no views";
const n0 = (n: number) => n.toLocaleString("en-US");

/** The report's line (pure). */
export function searchShareLine(rows: ReachRow[]): string {
  const mine = side(rows.filter((r) => r.search));
  const rest = side(rows.filter((r) => !r.search));
  if (!mine.shorts)
    return `🔎 **Search Shorts:** none with traffic sources in yet this week; the other Shorts got ${pct(rest)} of their views from YouTube search (${rest.shorts} Shorts).`;
  return `🔎 **Search Shorts:** ${pct(mine)} of views from YouTube search (${mine.shorts} Short${mine.shorts === 1 ? "" : "s"}, ${n0(mine.views)} views) against ${pct(rest)} for the other Shorts (${rest.shorts}, ${n0(rest.views)} views).`;
}

/** The traffic-source rows stored in the last week, each marked search Short or not. */
export async function searchReachRows(db: Db, now: Date): Promise<ReachRow[]> {
  const rows = await db.query<{ hash: string | null; raw: unknown }>(
    `SELECT e.story_hash AS hash, m.raw FROM video_metrics m JOIN episodes e ON e.id = m.episode_id
      WHERE m.label = 'reach' AND e.lane <> 'twin' AND m.captured_at > $1::timestamptz - interval '7 days'`,
    [now],
  );
  return rows.map((r) => {
    const raw = typeof r.raw === "string" ? JSON.parse(r.raw) : r.raw;
    return {
      search: Boolean(r.hash?.startsWith("search:")),
      sources:
        raw && typeof raw === "object" ? (raw as Record<string, number>) : {},
    };
  });
}

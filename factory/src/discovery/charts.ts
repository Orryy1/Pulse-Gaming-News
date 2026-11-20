// Steam's weekly most-played chart: the top 100 games by peak concurrent
// players, with last week's rank. The weekly "biggest climbers" Short is
// built from it, and each climber carries its own official Steam news so the
// writer can say why it climbed (an update, a free weekend, a launch) instead
// of guessing.

import { fetchWithTimeout, log, errorMessage } from "../lib/util.ts";

export interface ChartRow {
  rank: number;
  appid: number;
  last_week_rank?: number; // -1 when it was not in last week's top 100
  peak_in_game: number;
}

export interface Climber {
  appId: number;
  name: string;
  rank: number;
  lastRank?: number; // undefined: new to the top 100
  climb: number; // places gained; a new entry counts from 101
  peak: number;
  year?: number;
  news: string[]; // official announcements from the last two weeks
}

/** Not games, or games that live on the chart whatever happens. */
const NOT_GAMES =
  /wallpaper engine|steamvr|soundpad|lossless scaling|spacewar|banana|egg|cats\b/i;

/** The biggest movers up the chart: the most places gained, new entries counted from 101. */
export function pickClimbers(
  rows: ChartRow[],
  n = 12,
  minClimb = 5,
): Array<ChartRow & { climb: number; isNew: boolean }> {
  return rows
    .map((r) => {
      const isNew = !r.last_week_rank || r.last_week_rank < 1;
      return {
        ...r,
        isNew,
        climb: isNew ? 101 - r.rank : r.last_week_rank! - r.rank,
      };
    })
    .filter((r) => r.climb >= minClimb)
    .sort((a, b) => b.climb - a.climb || a.rank - b.rank)
    .slice(0, n);
}

const strip = (t: string) =>
  t
    .replace(/\[\/?[a-z0-9*]+(=[^\]]*)?\]/gi, " ")
    .replace(/\{STEAM_CLAN_IMAGE\}[^\s]*/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The publisher's own Steam announcements from the last `days`, as "title (date): opening". */
export function parseNews(json: any, now: Date, days = 14): string[] {
  const items = (json?.appnews?.newsitems ?? []) as Array<{
    title?: string;
    contents?: string;
    date?: number;
    feedname?: string;
    feed_type?: number;
  }>;
  const since = now.getTime() / 1000 - days * 86_400;
  return items
    .filter(
      (i) =>
        (i.feed_type === 1 || i.feedname === "steam_community_announcements") &&
        (i.date ?? 0) >= since,
    )
    .slice(0, 3)
    .map(
      (i) =>
        `${strip(i.title ?? "")} (${new Date((i.date ?? 0) * 1000).toISOString().slice(0, 10)}): ${strip(i.contents ?? "").slice(0, 220)}`,
    );
}

async function getJson(url: string): Promise<any> {
  const res = await fetchWithTimeout(url, {}, 15_000);
  return res.ok ? res.json() : undefined;
}

/** This week's biggest climbers that are games, with names, release years and their official news. */
export async function steamClimbers(now: Date, n = 6): Promise<Climber[]> {
  try {
    const chart = await getJson(
      "https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/",
    );
    const rows = (chart?.response?.ranks ?? []) as ChartRow[];
    const out: Climber[] = [];
    for (const r of pickClimbers(rows, 16)) {
      const d = (
        await getJson(
          `https://store.steampowered.com/api/appdetails?appids=${r.appid}&cc=us&l=english`,
        ).catch(() => undefined)
      )?.[String(r.appid)]?.data;
      if (!d || d.type !== "game" || NOT_GAMES.test(String(d.name ?? "")))
        continue;
      const news = parseNews(
        await getJson(
          `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${r.appid}&count=8&maxlength=400&format=json`,
        ).catch(() => undefined),
        now,
      );
      out.push({
        appId: r.appid,
        name: String(d.name),
        rank: r.rank,
        lastRank: r.isNew ? undefined : r.last_week_rank,
        climb: r.climb,
        peak: r.peak_in_game,
        year:
          Number(
            String(d.release_date?.date ?? "").match(/\b(19|20)\d\d\b/)?.[0],
          ) || undefined,
        news,
      });
      if (out.length >= n) break;
    }
    return out;
  } catch (err) {
    log("warn", "steam chart unavailable", { error: errorMessage(err) });
    return [];
  }
}

/** "UP 36 TO #17" or "NEW AT #35". */
export function climbLabel(
  c: Pick<Climber, "rank" | "lastRank" | "climb">,
): string {
  return c.lastRank === undefined
    ? `NEW AT #${c.rank}`
    : `UP ${c.climb} TO #${c.rank}`;
}

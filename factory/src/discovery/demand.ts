// What people are watching on YouTube right now, for the editor: YouTube's own "most popular"
// charts for the US (the Gaming chart and the overall chart's trailers), fetched at most once an hour (two quota units).
// A candidate story whose game is in those charts has viewers already looking for it.
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";

export interface TrendingVideo {
  title: string;
  views: number;
  channel: string;
}

let cache: { at: number; videos: TrendingVideo[] } | undefined;

async function chart(
  token: string,
  category?: string,
): Promise<TrendingVideo[]> {
  const q = new URLSearchParams({
    part: "snippet,statistics",
    chart: "mostPopular",
    regionCode: "US",
    maxResults: "50",
  });
  if (category) q.set("videoCategoryId", category);
  const res = await fetchWithTimeout(
    `https://www.googleapis.com/youtube/v3/videos?${q}`,
    { headers: { authorization: `Bearer ${token}` } },
    20_000,
  );
  if (!res.ok) throw new Error(`videos.list mostPopular HTTP ${res.status}`);
  return (((await res.json()) as any).items ?? []).map((v: any) => ({
    title: String(v.snippet?.title ?? ""),
    views: Number(v.statistics?.viewCount ?? 0),
    channel: String(v.snippet?.channelTitle ?? ""),
  }));
}

/** The US Gaming chart, cached for an hour; empty when YouTube is unreachable. */
export async function trendingVideos(
  token: () => Promise<string>,
  onQuota?: (units: number) => Promise<void>,
): Promise<TrendingVideo[]> {
  if (cache && Date.now() - cache.at < 60 * 60_000) return cache.videos;
  try {
    // The Gaming chart, plus the overall chart's trailers and gameplay (a big game trailer such as
    // GTA VI's lands there, not in Gaming). The rest of the overall chart is music: left out.
    const t = await token();
    const gaming = await chart(t, "20");
    const all = await chart(t).catch(() => [] as TrendingVideo[]);
    await onQuota?.(2);
    const seen = new Set(gaming.map((v) => v.title));
    const videos = [
      ...gaming,
      ...all.filter(
        (v) =>
          /\b(trailer|gameplay|teaser|reveal|launch)\b/i.test(v.title) &&
          !seen.has(v.title),
      ),
    ];
    cache = { at: Date.now(), videos };
    return videos;
  } catch (err) {
    log("warn", "trending charts unavailable", { error: errorMessage(err) });
    return cache?.videos ?? [];
  }
}

/**
 * The block the editor reads: today's most-watched US gaming videos, biggest first. The editor
 * matches them against the candidates itself ("Fallout RPG" and "Fallout 5 trailer reaction" are
 * the same game, which no word match catches).
 */
export function trendingBlock(videos: TrendingVideo[], max = 40): string {
  if (!videos.length) return "";
  const fmt = (n: number) =>
    n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}K`;
  return [
    "What US viewers are watching on YouTube right now (its most-popular Gaming chart, plus trailers from the overall chart). A candidate about a game in this list has viewers already looking for it:",
    ...[...videos]
      .sort((a, b) => b.views - a.views)
      .slice(0, max)
      .map((v) => `- ${fmt(v.views)} views: ${v.title.slice(0, 100)}`),
  ].join("\n");
}

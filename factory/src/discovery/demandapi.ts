// Demand lookups through the YouTube Data API (26 Nov 2026). The demand check used to read YouTube's search page with
// yt-dlp (this week's uploads by views, sp=CAMSAggD). When the anonymous lane was retired (YT_ANON_LANE=off, 25 Nov:
// the home IP is bot-checked) and the guard's few Data API searches a day (YT_API_SEARCHES_PER_DAY) went to footage
// first, every demand search fell through to the retired lane and failed: 36 times on 26 Nov, so Why Shorts and the
// long-ranking pickers went without figures. This asks the Data API directly and never touches yt-dlp: one
// search.list a topic (100 quota units; its own bucket in the factory's ledger) for this week's uploads by views,
// then videos.list for their view counts, 50 videos a call (1 unit), shared across all the topics of a run. The
// caller (searchdemand.ts demandFor) caches each topic for a week and rations new topics a day (DEMAND_API_PER_DAY).
// The key never appears in a log or an error: only the method, the HTTP status and Google's reason word.

import type { SearchRow } from "./searchdemand.ts";

/** One Data API GET; `path` is relative to youtube/v3 ("search?part=..."), the getter adds the key or the login. */
export type DemandGet = (
  path: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface DemandApiDeps {
  get: DemandGet;
  now: Date;
  /** Called before each search.list: false stops the run's searches (the day's search bucket or shared quota is spent). */
  allowSearch?: () => Promise<boolean>;
  /** Called with the units of each videos.list call. */
  charge?: (units: number) => Promise<void>;
  /** Videos a search returns (the old page read took 20). */
  max?: number;
}

const DAY = 86_400_000;

/** A query's failure from before its search.list was sent (refused allowance, quota already spent): refundable. */
export class DemandNotSentError extends Error {
  readonly notSent = true;
}

/** The search API's snippets come HTML-escaped (pure). */
function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** True for the API's "quota used up" answers (pure). */
export function isDemandQuotaError(text: string): boolean {
  return /quotaExceeded|dailyLimitExceeded/i.test(text);
}

async function call(get: DemandGet, method: string, params: Record<string, string>): Promise<any> {
  const res = await get(`${method}?${new URLSearchParams(params)}`);
  let body: any;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const reason = String(body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? "");
    throw new Error(`YouTube Data API ${method} HTTP ${res.status}${reason ? ` ${reason}` : ""}`);
  }
  return body;
}

/**
 * This week's most-viewed uploads for each query, as search-page rows; a query whose search failed (or was not
 * allowed) maps to its Error, never to an empty list, so it counts as unknown rather than "no demand".
 */
export async function demandApiSearch(
  queries: string[],
  d: DemandApiDeps,
): Promise<Map<string, SearchRow[] | Error>> {
  const out = new Map<string, SearchRow[] | Error>();
  const publishedAfter = new Date(d.now.getTime() - 7 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");
  const hitsOf = new Map<string, { videoId: string; channel: string; title: string }[]>();
  let stopped: Error | undefined;
  for (const q of queries) {
    if (out.has(q) || hitsOf.has(q)) continue;
    if (stopped) {
      out.set(q, stopped instanceof DemandNotSentError ? stopped : new DemandNotSentError(stopped.message));
      continue;
    }
    if (d.allowSearch && !(await d.allowSearch().catch(() => false))) {
      stopped = new DemandNotSentError("YouTube Data API search allowance spent for today");
      out.set(q, stopped);
      continue;
    }
    try {
      const found = await call(d.get, "search", {
        part: "snippet",
        type: "video",
        order: "viewCount",
        maxResults: String(Math.max(1, Math.min(50, d.max ?? 20))),
        q,
        publishedAfter,
      });
      const items: any[] = Array.isArray(found?.items) ? found.items : [];
      hitsOf.set(
        q,
        items
          .filter((i) => typeof i?.id?.videoId === "string" && /^[\w-]{11}$/.test(i.id.videoId))
          .map((i) => ({
            videoId: String(i.id.videoId),
            channel: unescapeHtml(String(i.snippet?.channelTitle ?? "")),
            title: unescapeHtml(String(i.snippet?.title ?? "")),
          })),
      );
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      out.set(q, e);
      if (isDemandQuotaError(e.message)) stopped = e;
    }
  }
  // The view counts, 50 videos a call across every topic of the run.
  const ids = [...new Set([...hitsOf.values()].flat().map((h) => h.videoId))];
  const views = new Map<string, number>();
  const unread = new Map<string, Error>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const got = await call(d.get, "videos", {
        part: "statistics",
        id: chunk.join(","),
        maxResults: "50",
      });
      await d.charge?.(1).catch(() => undefined);
      for (const v of Array.isArray(got?.items) ? got.items : [])
        views.set(String(v?.id), Number(v?.statistics?.viewCount) || 0);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      for (const id of chunk) unread.set(id, e);
    }
  }
  for (const [q, hits] of hitsOf) {
    const lost = hits.map((h) => unread.get(h.videoId)).find(Boolean);
    out.set(
      q,
      lost ?? hits.map((h) => ({ videoId: h.videoId, views: views.get(h.videoId) ?? 0, channel: h.channel, title: h.title })),
    );
  }
  return out;
}

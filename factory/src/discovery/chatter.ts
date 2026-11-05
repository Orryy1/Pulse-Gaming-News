// Is anyone outside the press talking about it? (owner, 4 Nov 2026: "all day long on Twitter".) The feeds only hear
// publishers, so the story size gets a small push from free public signals, read at most once an hour for the few games
// already in the news: Bluesky's public search (posts an hour), Google's Trending Now feed for the US, and YouTube's
// charts, already fetched for the editor. Measured on 5 Nov 2026: "ocarina of time" 139 posts an hour on Bluesky, "gta 6"
// 26, "laufey" 20, "dragon's dogma" 8. A push only: three outlets must already have the story, so chatter alone never
// makes a story big, and any source that fails adds nothing. CHATTER_SOURCES lists which to read; empty is none.
//
// Left out on purpose. Reddit: robots.txt disallows everything for everyone. X: reading costs about $0.005 a post.
// Metacritic and OpenCritic pages: robots.txt allows the lists but their terms could not be read to confirm automated
// reading is allowed, and the OpenCritic API needs a paid key; the press reports scores within the hour anyway.
// Wikipedia pageviews: free and clear (Ocarina went from 4,000 to 36,000 a day) but a day late. Steam's chart has no
// console games.

import type { SizedStory } from "./storysize.ts";
import { knownEntity } from "./storysize.ts";
import type { TrendingVideo } from "./demand.ts";
import { errorMessage, log } from "../lib/util.ts";
import { fetchPublic } from "../lib/publicurl.ts";

export type ChatterSource = "bluesky" | "trends" | "youtube";

export interface EntityChatter {
  blueskyPerHour?: number;
  trendsTraffic?: number;
  youtubeViews?: number;
}

export interface ChatterSignal {
  at: string;
  entities: Record<string, EntityChatter>;
}

/** Reads older than this are ignored: last night's trend is not today's news. */
const STALE_HOURS = 3;
/** The press has to be there first. */
const MIN_OUTLETS = 3;
const MAX_POINTS = 15;
/** Bluesky searches an hour, one for each game in the news. */
export const MAX_TERMS = 8;

/** Points for one game's chatter (pure). */
export function chatterPoints(c: EntityChatter | undefined): number {
  if (!c) return 0;
  const sky = c.blueskyPerHour ?? 0;
  const trend = c.trendsTraffic ?? 0;
  const views = c.youtubeViews ?? 0;
  const points =
    (sky >= 100 ? 10 : sky >= 25 ? 6 : sky >= 10 ? 3 : 0) +
    (trend >= 100_000 ? 8 : trend >= 20_000 ? 5 : trend > 0 ? 3 : 0) +
    (views >= 1_000_000 ? 6 : views > 0 ? 3 : 0);
  return Math.min(MAX_POINTS, points);
}

/** The stories with their chatter added, biggest first again (pure). */
export function applyChatter(
  stories: SizedStory[],
  signal: ChatterSignal | undefined,
  now: Date,
): SizedStory[] {
  if (
    !signal ||
    now.getTime() - new Date(signal.at).getTime() > STALE_HOURS * 3_600_000
  )
    return stories;
  return stories
    .map((s) => {
      const points = chatterPoints(signal.entities[s.entity]);
      if (!points || s.outlets.length < MIN_OUTLETS) return s;
      return {
        ...s,
        size: s.size + points,
        why: `${s.why}, chatter +${points}`,
      };
    })
    .sort((a, b) => b.size - a.size);
}

/** The games worth asking about: those with the biggest stories now (pure). */
export function chatterTerms(
  stories: SizedStory[],
): Array<{ entity: string; term: string }> {
  const out = new Map<string, string>();
  for (const s of stories) {
    if (out.size >= MAX_TERMS) break;
    if (s.entity.startsWith("t:") || out.has(s.entity)) continue;
    out.set(s.entity, s.name);
  }
  return [...out].map(([entity, term]) => ({ entity, term }));
}

/** Posts an hour from one page of newest-first search results (pure): a full page over half an hour is 200 an hour. */
export function postsPerHour(indexedAt: string[], now: Date): number {
  const times = indexedAt.map((t) => Date.parse(t)).filter(Number.isFinite);
  if (times.length < 2) return 0;
  const hours = Math.max(
    0.05,
    (now.getTime() - Math.min(...times)) / 3_600_000,
  );
  return Math.round(times.length / hours);
}

/** Google's Trending Now feed as term and traffic (pure): "<title>x</title> ... <ht:approx_traffic>10000+</...>". */
export function parseTrends(
  xml: string,
): Array<{ term: string; traffic: number }> {
  const out: Array<{ term: string; traffic: number }> = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = /<title>([^<]*)<\/title>/.exec(m[1]!)?.[1];
    const traffic = /<ht:approx_traffic>([\d,]+)/.exec(m[1]!)?.[1];
    if (title)
      out.push({
        term: title.trim(),
        traffic: Number((traffic ?? "0").replace(/,/g, "")),
      });
  }
  return out;
}

const matchesEntity = (text: string, entity: string, term: string): boolean =>
  knownEntity(text)?.key === entity ||
  text.toLowerCase().includes(term.toLowerCase());

/** Reads the chosen sources for these games. Each source fails alone, with a log line, and adds nothing. */
export async function readChatter(
  terms: Array<{ entity: string; term: string }>,
  sources: string[],
  now: Date,
  trending: () => Promise<TrendingVideo[]>,
): Promise<ChatterSignal> {
  const entities: Record<string, EntityChatter> = {};
  const add = (entity: string, c: EntityChatter) => {
    entities[entity] = { ...entities[entity], ...c };
  };
  const quietly = async (source: string, fn: () => Promise<void>) => {
    if (!sources.includes(source)) return;
    await fn().catch((err) =>
      log("warn", "chatter source unavailable", {
        source,
        error: errorMessage(err),
      }),
    );
  };
  await quietly("bluesky", async () => {
    for (const { entity, term } of terms) {
      const q = term.includes(" ") ? `"${term}"` : term;
      const res = await fetchPublic(
        `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=100&sort=latest`,
        {},
        15_000,
      );
      if (!res.ok) throw new Error(`Bluesky search HTTP ${res.status}`);
      const posts =
        ((await res.json()) as { posts?: Array<{ indexedAt?: string }> })
          .posts ?? [];
      add(entity, {
        blueskyPerHour: postsPerHour(
          posts.map((p) => p.indexedAt ?? ""),
          now,
        ),
      });
    }
  });
  await quietly("trends", async () => {
    const res = await fetchPublic(
      "https://trends.google.com/trending/rss?geo=US",
      {},
      15_000,
    );
    if (!res.ok) throw new Error(`Google Trends HTTP ${res.status}`);
    const trends = parseTrends(await res.text());
    for (const { entity, term } of terms) {
      const traffic = trends
        .filter((t) => matchesEntity(t.term, entity, term))
        .reduce((a, t) => Math.max(a, t.traffic), 0);
      if (traffic) add(entity, { trendsTraffic: traffic });
    }
  });
  await quietly("youtube", async () => {
    const videos = await trending();
    for (const { entity, term } of terms) {
      const views = videos
        .filter((v) => matchesEntity(v.title, entity, term))
        .reduce((a, v) => Math.max(a, v.views), 0);
      if (views) add(entity, { youtubeViews: views });
    }
  });
  return { at: now.toISOString(), entities };
}

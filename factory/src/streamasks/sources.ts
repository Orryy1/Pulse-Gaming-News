// Where the stream asks come from (read-only, free, public): the factory's own press feeds (IGN, GameSpot, Eurogamer
// and the rest, src/discovery/feeds.ts), Bluesky's public search (the free social chatter the story-size desk already
// reads), the public comments under the biggest new YouTube videos about each game (YOUTUBE_API_KEY, about 101 quota
// units a game a day, mostly one search a day) and Pulse's own viewers' comments (the comment tables). Reddit's public
// JSON is here only for an owner who lists "reddit" in STREAM_ASKS_SOURCES: its robots.txt disallows automated reading.
// X has no free reading route; it is not read. Any source that fails adds nothing and is named in the refresh's notes.

import fs from "node:fs/promises";
import path from "node:path";
import type { Db } from "../db.ts";
import { FEEDS } from "../discovery/feeds.ts";
import { fetchFeeds, type FeedItem } from "../discovery/rss.ts";
import { fetchPublic } from "../lib/publicurl.ts";
import { errorMessage } from "../lib/util.ts";
import { gameAliases } from "../sceneindex/spoilers.ts";
import type { MentionSource } from "./asks.ts";
import type { AskSourceName } from "./settings.ts";

export interface RawPost {
  source: MentionSource;
  name: string;
  url?: string;
  at: string;
  text: string;
  engagement: number;
  game: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The game a text names, of those listed, longest name first (pure). */
export function gameNamed(text: string, games: string[]): string | undefined {
  const names = games
    .flatMap((g) => gameAliases(g).map((a) => ({ g, a })))
    .sort((x, y) => y.a.length - x.a.length);
  return names.find(({ a }) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${esc(a)}(?![\\p{L}\\p{N}])`, "iu").test(
      text,
    ),
  )?.g;
}

/** The short names people search a game by: "GTA 6" and "GTA VI" before "Grand Theft Auto VI" (pure). */
export function searchTerms(game: string): string[] {
  const aliases = gameAliases(game);
  const short = aliases
    .filter((a) => a !== game && /\s/.test(a))
    .sort(
      (a, b) =>
        a.length - b.length || Number(/\d/.test(b)) - Number(/\d/.test(a)),
    );
  return [...new Set([...short, game])].slice(0, 2);
}

/** Press items about the listed games (pure). */
export function pressPosts(items: FeedItem[], games: string[]): RawPost[] {
  const out: RawPost[] = [];
  for (const it of items) {
    const text = `${it.title}. ${it.summary}`;
    const game = gameNamed(text, games);
    if (!game) continue;
    out.push({
      source: "press",
      name: it.source,
      url: it.url,
      at: it.publishedAt,
      text: text.slice(0, 1200),
      engagement: it.sourceKind === "official" ? 40 : 20,
      game,
    });
  }
  return out;
}

interface BskyPost {
  uri?: string;
  author?: { handle?: string };
  record?: { text?: string; createdAt?: string };
  indexedAt?: string;
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  quoteCount?: number;
}

/** Bluesky search results as posts (pure). */
export function blueskyPosts(posts: BskyPost[], game: string): RawPost[] {
  return posts.flatMap((p) => {
    const text = p.record?.text?.trim();
    if (!text) return [];
    const rkey = p.uri?.split("/").pop();
    return [
      {
        source: "social" as const,
        name: "Bluesky",
        ...(p.author?.handle && rkey
          ? { url: `https://bsky.app/profile/${p.author.handle}/post/${rkey}` }
          : {}),
        at: p.record?.createdAt ?? p.indexedAt ?? "",
        text: text.slice(0, 600),
        engagement:
          (p.likeCount ?? 0) +
          2 * (p.repostCount ?? 0) +
          2 * (p.replyCount ?? 0) +
          2 * (p.quoteCount ?? 0),
        game,
      },
    ];
  });
}

export interface GatherDeps {
  db?: Db;
  feeds?: () => Promise<FeedItem[]>;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: Date;
  /** Where the day's YouTube search is kept, so one search serves every refresh that day. */
  cacheDir?: string;
  /** The factory's own YouTube login, used when there is no YOUTUBE_API_KEY (or it has expired). */
  youtubeToken?: () => Promise<string>;
  /** Counts YouTube calls against the factory's quota: "search" a search.list call, "units" plain units. */
  onQuota?: (kind: "search" | "units", n: number) => Promise<void>;
}

export interface GatherResult {
  posts: RawPost[];
  notes: string[];
}

/** Reads every listed source for the games. Never throws: a failed source is a note. */
export async function gatherPosts(
  games: string[],
  sources: AskSourceName[],
  o: { youtubeApiKey: string },
  deps: GatherDeps = {},
): Promise<GatherResult> {
  const now = deps.now ?? new Date();
  const get =
    deps.fetch ??
    ((url: string, init?: RequestInit) => fetchPublic(url, init ?? {}, 20_000));
  const posts: RawPost[] = [];
  const notes: string[] = [];
  const quietly = async (name: string, fn: () => Promise<number>) => {
    if (!sources.includes(name as AskSourceName)) return;
    try {
      notes.push(`${name}: ${await fn()} posts`);
    } catch (err) {
      notes.push(`${name}: unavailable (${errorMessage(err).slice(0, 120)})`);
    }
  };
  await quietly("press", async () => {
    const items = await (deps.feeds ?? (() => fetchFeeds(FEEDS)))();
    const found = pressPosts(items, games);
    posts.push(...found);
    return found.length;
  });
  await quietly("bluesky", async () => {
    let n = 0;
    for (const game of games)
      for (const term of searchTerms(game).slice(0, 1))
        for (const sort of ["top", "latest"]) {
          const q = term.includes(" ") ? `"${term}"` : term;
          const res = await get(
            `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=100&sort=${sort}&lang=en`,
          );
          if (!res.ok) throw new Error(`Bluesky HTTP ${res.status}`);
          const found = blueskyPosts(
            ((await res.json()) as { posts?: BskyPost[] }).posts ?? [],
            game,
          );
          posts.push(...found);
          n += found.length;
        }
    return n;
  });
  await quietly("youtube", async () => {
    if (!o.youtubeApiKey && !deps.youtubeToken)
      throw new Error("no YOUTUBE_API_KEY or YouTube login");
    const yt = youtubeGetter(o.youtubeApiKey, get, deps.youtubeToken);
    let n = 0;
    for (const game of games) {
      const videos = await bigVideos(
        game,
        yt,
        now,
        deps.cacheDir,
        deps.onQuota,
      );
      for (const v of videos) {
        const q = new URLSearchParams({
          part: "snippet",
          videoId: v.id,
          order: "relevance",
          maxResults: "100",
          textFormat: "plainText",
        });
        const res = await yt(`commentThreads?${q}`);
        await deps.onQuota?.("units", 1);
        if (!res.ok) continue; // comments off on that video
        for (const t of ((await res.json()) as { items?: any[] }).items ?? []) {
          const c = t.snippet?.topLevelComment?.snippet ?? {};
          const text = String(c.textOriginal ?? c.textDisplay ?? "").trim();
          if (!text) continue;
          posts.push({
            source: "comments",
            name: `YouTube comments: ${v.title.slice(0, 60)}`,
            url: `https://www.youtube.com/watch?v=${v.id}&lc=${t.snippet?.topLevelComment?.id ?? ""}`,
            at: String(c.publishedAt ?? now.toISOString()),
            text: text.slice(0, 600),
            engagement:
              Number(c.likeCount ?? 0) +
              3 * Number(t.snippet?.totalReplyCount ?? 0),
            game,
          });
          n++;
        }
      }
    }
    return n;
  });
  await quietly("viewers", async () => {
    if (!deps.db) throw new Error("no database");
    const rows = await deps.db.query<{
      comment: string;
      at: string | Date;
      game: string | null;
      title: string | null;
    }>(
      `SELECT c.comment, c.created_at AS at,
              COALESCE(NULLIF(e.script_json->>'game_title', ''), e.story_json->>'gameHint') AS game,
              e.script_json->>'title' AS title
         FROM comment_replies c LEFT JOIN episodes e ON e.id = c.episode_id
        WHERE c.created_at > now() - interval '14 days'`,
    );
    let n = 0;
    for (const r of rows) {
      const game = gameNamed(
        `${r.game ?? ""} ${r.title ?? ""} ${r.comment}`,
        games,
      );
      if (!game) continue;
      posts.push({
        source: "viewers",
        name: "Pulse viewers",
        at: new Date(r.at).toISOString(),
        text: r.comment.slice(0, 600),
        engagement: 5,
        game,
      });
      n++;
    }
    return n;
  });
  await quietly("reddit", async () => {
    let n = 0;
    for (const sub of ["GTA6", "GTA", "GamingLeaksAndRumours"]) {
      const res = await get(
        `https://www.reddit.com/r/${sub}/top.json?t=day&limit=50`,
      );
      if (!res.ok) throw new Error(`Reddit HTTP ${res.status}`);
      for (const c of ((await res.json()) as any)?.data?.children ?? []) {
        const d = c?.data ?? {};
        const text = `${d.title ?? ""}. ${String(d.selftext ?? "").slice(0, 500)}`;
        const game =
          gameNamed(text, games) ??
          (sub === "GTA6" ? games.find((g) => /\bVI\b|6/.test(g)) : undefined);
        if (!game) continue;
        posts.push({
          source: "reddit",
          name: `r/${sub}`,
          url: d.permalink ? `https://www.reddit.com${d.permalink}` : undefined,
          at: new Date(
            (Number(d.created_utc) || now.getTime() / 1000) * 1000,
          ).toISOString(),
          text,
          engagement: Number(d.score ?? 0) + 2 * Number(d.num_comments ?? 0),
          game,
        });
        n++;
      }
    }
    return n;
  });
  return { posts, notes };
}

/**
 * A YouTube Data API reader: the API key when it works, else the factory's own login (an expired key answers 400
 * "API key expired"; the login then takes over for the rest of the refresh).
 */
export function youtubeGetter(
  key: string,
  get: (url: string, init?: RequestInit) => Promise<Response>,
  token?: () => Promise<string>,
): (pathAndQuery: string) => Promise<Response> {
  let keyDead = !key;
  return async (pq: string) => {
    const url = `https://www.googleapis.com/youtube/v3/${pq}`;
    if (!keyDead) {
      const res = await get(`${url}&key=${encodeURIComponent(key)}`);
      if (res.status !== 400 && res.status !== 403) return res;
      if (!token) return res;
      keyDead = true;
    }
    if (!token) throw new Error("no YouTube login");
    return get(url, { headers: { authorization: `Bearer ${await token()}` } });
  };
}

/** The most viewed videos about a game from the last week: one search a day (100 units), kept in the cache. */
async function bigVideos(
  game: string,
  yt: (pathAndQuery: string) => Promise<Response>,
  now: Date,
  cacheDir?: string,
  onQuota?: GatherDeps["onQuota"],
): Promise<Array<{ id: string; title: string }>> {
  const day = now.toISOString().slice(0, 10);
  const file = cacheDir ? path.join(cacheDir, `videos-${day}.json`) : undefined;
  const cache: Record<string, Array<{ id: string; title: string }>> = file
    ? JSON.parse(await fs.readFile(file, "utf8").catch(() => "{}"))
    : {};
  if (cache[game]) return cache[game]!;
  const q = new URLSearchParams({
    part: "snippet",
    q: searchTerms(game)[0] ?? game,
    type: "video",
    order: "viewCount",
    publishedAfter: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
    maxResults: "5",
    relevanceLanguage: "en",
  });
  const res = await yt(`search?${q}`);
  await onQuota?.("search", 1);
  if (!res.ok) throw new Error(`YouTube search HTTP ${res.status}`);
  const found = (((await res.json()) as { items?: any[] }).items ?? [])
    .map((i) => ({
      id: String(i.id?.videoId ?? ""),
      title: String(i.snippet?.title ?? ""),
    }))
    .filter((v) => /^[\w-]{11}$/.test(v.id));
  cache[game] = found;
  if (file) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(cache));
  }
  return found;
}

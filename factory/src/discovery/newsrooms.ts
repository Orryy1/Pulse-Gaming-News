// Publisher newsrooms that publish no RSS. Rockstar's Newswire is a
// JavaScript app backed by a public GraphQL endpoint with persisted queries;
// the list gives every post's title, date, game and an official 16:9 press
// image, and a post gives its text and full image gallery. Both hashes are
// configurable because Rockstar rotates them when it redeploys the site.
// The factory identifies itself honestly and polls at most every 15 minutes.

import type { FeedItem } from "./rss.ts";
import type { ArticleText } from "./article.ts";
import {
  fetchWithTimeout,
  log,
  errorMessage,
  USER_AGENT,
} from "../lib/util.ts";

const GRAPH = "https://graph.rockstargames.com/";
const MEDIA = "https://media-rockstargames-com.akamaized.net";
export const ROCKSTAR_LIST_HASH =
  "7ec00215aecc70de257b0719a1dfcfa84fe57fdc7bf5c10ec2e8f377defede58";
export const ROCKSTAR_POST_HASH =
  "555658813abe5acc8010de1a1feddd6fd8fddffbdc35d3723d4dc0fe4ded6810";
const LIST_TTL_MS = 15 * 60_000;

function graphUrl(
  operation: string,
  variables: Record<string, unknown>,
  hash: string,
): string {
  const v = encodeURIComponent(JSON.stringify(variables));
  const e = encodeURIComponent(
    JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }),
  );
  return `${GRAPH}?origin=https://www.rockstargames.com&operationName=${operation}&variables=${v}&extensions=${e}`;
}

async function graph(
  operation: string,
  variables: Record<string, unknown>,
  hash: string,
): Promise<any> {
  const res = await fetchWithTimeout(
    graphUrl(operation, variables, hash),
    { headers: { "user-agent": USER_AGENT, accept: "application/json" } },
    20_000,
  );
  if (!res.ok)
    throw new Error(`rockstar graph ${operation} HTTP ${res.status}`);
  const j = (await res.json()) as {
    data?: any;
    errors?: Array<{ message?: string }>;
  };
  if (j.errors?.length)
    throw new Error(
      `rockstar graph ${operation}: ${j.errors.map((e) => e.message).join("; ")}`,
    );
  return j.data;
}

/** "10/15/26, 1:00 PM" in New York time to an ISO instant. */
export function parseRockstarDate(s: string): string | undefined {
  const m = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i,
  );
  if (!m) return undefined;
  const year = Number(m[3]!.length === 2 ? `20${m[3]}` : m[3]);
  let hour = Number(m[4]) % 12;
  if (/pm/i.test(m[6]!)) hour += 12;
  const guess = new Date(
    Date.UTC(year, Number(m[1]) - 1, Number(m[2]), hour, Number(m[5])),
  );
  // The New York offset on that day (GMT-4 in summer, GMT-5 in winter).
  const tz =
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      timeZoneName: "shortOffset",
    })
      .formatToParts(guess)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const offset = Number(tz.replace("GMT", "") || "0");
  return new Date(guess.getTime() - offset * 3_600_000).toISOString();
}

interface ListPost {
  id: string;
  url: string;
  title: string;
  created: string;
  primary_tags?: Array<{ name: string }> | null;
  preview_images_parsed?: {
    newswire_block?: { d16x9?: string; square?: string };
  } | null;
}

export function newswireItems(data: any): FeedItem[] {
  const posts: ListPost[] = data?.posts?.results ?? [];
  const out: FeedItem[] = [];
  for (const p of posts) {
    const publishedAt = parseRockstarDate(p.created);
    if (!publishedAt || !p.url || !p.title) continue;
    const game = p.primary_tags?.map((t) => t.name).join(", ") ?? "";
    out.push({
      title:
        game &&
        !p.title.toLowerCase().includes(game.toLowerCase().split(",")[0]!)
          ? `${game}: ${p.title}`
          : p.title,
      url: new URL(p.url, "https://www.rockstargames.com").toString(),
      summary: `${p.title}. ${game ? `Rockstar Games newswire post about ${game}.` : "Rockstar Games newswire post."}`,
      publishedAt,
      source: "Rockstar Newswire",
      sourceKind: "official",
      imageUrl: p.preview_images_parsed?.newswire_block?.d16x9 ?? undefined,
    });
  }
  return out;
}

let cache: { at: number; items: FeedItem[] } | undefined;

/** The latest Newswire posts as official feed items (cached for 15 minutes; a failure returns none). */
export async function fetchRockstarNewswire(
  hash = ROCKSTAR_LIST_HASH,
  now = Date.now(),
): Promise<FeedItem[]> {
  if (cache && now - cache.at < LIST_TTL_MS) return cache.items;
  try {
    const data = await graph(
      "NewswireList",
      {
        tagIdHash: null,
        page: 1,
        metaUrl: "/newswire",
        limit: 20,
        locale: "en_us",
      },
      hash,
    );
    const items = newswireItems(data);
    cache = { at: now, items };
    return items;
  } catch (err) {
    log("warn", "feed failed", {
      feed: "Rockstar Newswire",
      error: errorMessage(err),
    });
    cache = { at: now, items: [] };
    return [];
  }
}

/** Readable strings inside a post's content tree: no URLs, no markup, at least a short sentence. */
function textOf(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    const t = node
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (
      t.length >= 40 &&
      !/^https?:|\.(jpg|png|webp|mp4)$/i.test(t) &&
      /[a-z]/.test(t) &&
      t.includes(" ")
    )
      out.push(t);
  } else if (Array.isArray(node)) for (const n of node) textOf(n, out);
  else if (node && typeof node === "object")
    for (const v of Object.values(node)) textOf(v, out);
  return out;
}

export function newswireArticle(
  data: any,
  url: string,
): ArticleText | undefined {
  const post = data?.post;
  if (!post?.title) return undefined;
  const raw = JSON.stringify(post);
  const images = [
    ...new Set(
      raw.match(
        /\/tina-uploads\/posts\/[A-Za-z0-9]+\/[A-Za-z0-9]+\.(?:jpg|jpeg|png|webp)/g,
      ) ?? [],
    ),
  ].map((p) => `${MEDIA}${p}`);
  const paragraphs = [
    ...new Set(textOf(post.tina ?? post.content ?? post)),
  ].filter((t) => t !== post.title && t !== post.subtitle);
  const text = [post.subtitle, ...paragraphs]
    .filter(Boolean)
    .join("\n")
    .slice(0, 9000);
  return { url, title: String(post.title), text, ogImage: images[0], images };
}

/** One Newswire post's text and full official image gallery. */
export async function fetchRockstarArticle(
  url: string,
  hash = ROCKSTAR_POST_HASH,
): Promise<ArticleText | undefined> {
  const id = url.match(/\/newswire\/article\/([A-Za-z0-9]+)/)?.[1];
  if (!id) return undefined;
  try {
    return newswireArticle(
      await graph("NewswirePost", { locale: "en_us", id_hash: id }, hash),
      url,
    );
  } catch (err) {
    log("warn", "article fetch failed", { url, error: errorMessage(err) });
    return undefined;
  }
}

// Groups feed items that describe the same story, then scores each cluster.
// Corroboration (an official source, or two independent outlets) is computed
// here so the editorial step never has to trust a single unconfirmed report.

import type { FeedItem } from "./rss.ts";
import { HOT_TERMS, NEWSWORTHY_TERMS, PENALTY_TERMS } from "./feeds.ts";
import { sha256 } from "../lib/util.ts";

export interface StoryCluster {
  hash: string;
  headline: string;
  items: FeedItem[];
  sources: string[];
  hasOfficial: boolean;
  corroborated: boolean;
  rumourSignals: boolean;
  newestAt: string;
  score: number;
  /** Game the editor identified at selection time, used for Steam lookups. */
  gameHint?: string;
  /** What the story needs to be seen, from the editor: real_world_images sends it to the picture desk. */
    visualNeed?: "none" | "game_footage" | "real_world_images";
  /** A Short cut from a long ranking: the long video's episode and the entry's rank. */
  cutdown?: { parent: string; rank: number };
  /** A "Why" Short: the question it answers and the likely answer the writer tests against the sources. */
  why?: { question: string; angle: string };
  /** A gameplay Short: the inbox clip's id and folder, and the reviewer's verdict. */
  gameplay?: { id: string; dir: string; review: import("../gameplay.ts").GameplayReview };
}

const STOPWORDS = new Set(
  "a an and are as at be by for from has have in into is it its of on or that the this to was were will with new now after over just more than you your we our their his her they how why what who".split(" "),
);

export function tokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/['’]s\b/g, "")
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size < 3 || b.size < 3) return 0; // "OUT NOW" style titles never merge
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  if (shared < 3) return 0;
  // Overlap coefficient: headlines vary a lot in length between outlets.
  return shared / Math.min(a.size, b.size);
}

export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^ref$|^cmp$|^ftag$/i.test(k)) u.searchParams.delete(k);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    return url;
  }
}

/** Stable identity for a story: the earliest item's canonical URL plus its normalised title. */
export function storyHash(items: FeedItem[]): string {
  const first = [...items].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))[0]!;
  return sha256(`${canonicalUrl(first.url)}|${[...tokens(first.title)].sort().join(" ")}`).slice(0, 32);
}

function termScore(text: string, table: Array<[RegExp, number]>): number {
  return table.reduce((sum, [re, w]) => (re.test(text) ? sum + w : sum), 0);
}

export function clusterItems(items: FeedItem[], now = new Date(), maxAgeHours = 24): StoryCluster[] {
  const cutoff = now.getTime() - maxAgeHours * 3600_000;
  const fresh = items
    .filter((i) => {
      const t = new Date(i.publishedAt).getTime();
      return t >= cutoff && t <= now.getTime() + 3600_000;
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  const seenUrls = new Set<string>();
  // Each group keeps the token sets of its members; an item joins when it is
  // close to any member (not the union, which would snowball).
  const groups: Array<{ items: FeedItem[]; members: Array<Set<string>> }> = [];
  for (const item of fresh) {
    const cu = canonicalUrl(item.url);
    if (seenUrls.has(cu)) continue;
    seenUrls.add(cu);
    const toks = tokens(item.title);
    let best: (typeof groups)[number] | undefined;
    let bestSim = 0;
    for (const g of groups) {
      for (const m of g.members) {
        const s = similarity(toks, m);
        if (s > bestSim) {
          bestSim = s;
          best = g;
        }
      }
    }
    if (best && bestSim >= 0.5) {
      best.items.push(item);
      best.members.push(toks);
    } else {
      groups.push({ items: [item], members: [toks] });
    }
  }

  return groups.map((g) => scoreCluster(g.items, now)).sort((a, b) => b.score - a.score);
}

export function scoreCluster(items: FeedItem[], now = new Date()): StoryCluster {
  const sources = [...new Set(items.map((i) => i.source))];
  // An outlet that publishes the same story twice still counts once.
  const hasOfficial = items.some((i) => i.sourceKind === "official");
  const outlets = new Set(items.filter((i) => i.sourceKind === "outlet").map((i) => i.source));
  const corroborated = hasOfficial || outlets.size >= 2;
  const text = items.map((i) => `${i.title} ${i.summary.slice(0, 300)}`).join(" ");
  const rumourSignals = /\b(leak|leaked|rumou?r|insider|reportedly|allegedly|datamine|unconfirmed)\b/i.test(text);
  const newestAt = items.map((i) => i.publishedAt).sort().at(-1)!;
  const ageHours = (now.getTime() - new Date(newestAt).getTime()) / 3600_000;

  let score = 0;
  score += Math.min(sources.length, 5) * 12; // coverage breadth is the strongest "this matters" signal
  score += hasOfficial ? 15 : 0;
  score += Math.min(termScore(text, HOT_TERMS), 40);
  score += Math.min(termScore(text, NEWSWORTHY_TERMS), 30);
  score += termScore(text, PENALTY_TERMS);
  score -= Math.max(0, ageHours - 3) * 2; // speed matters: decay after three hours
  if (!corroborated) score -= 20;

  const lead = [...items].sort((a, b) => (a.sourceKind === "official" ? -1 : 0) - (b.sourceKind === "official" ? -1 : 0))[0]!;
  return {
    hash: storyHash(items),
    headline: lead.title,
    items,
    sources,
    hasOfficial,
    corroborated,
    rumourSignals,
    newestAt,
    score: Math.round(score),
  };
}

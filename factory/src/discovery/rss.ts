import { XMLParser } from "fast-xml-parser";
import type { Feed } from "./feeds.ts";
import { fetchWithTimeout, log, errorMessage, stripHtml } from "../lib/util.ts";

export interface FeedItem {
  title: string;
  url: string;
  summary: string;
  publishedAt: string; // ISO
  source: string;
  sourceKind: Feed["kind"];
  imageUrl?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  cdataPropName: "#cdata",
});

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return text(o["#cdata"] ?? o["#text"] ?? "");
  }
  return "";
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function linkOf(entry: Record<string, unknown>): string {
  const link = entry.link;
  if (typeof link === "string") return link.trim();
  for (const l of asArray(link as Record<string, unknown> | Record<string, unknown>[])) {
    if (typeof l === "string") return (l as string).trim();
    const rel = l["@rel"];
    if (!rel || rel === "alternate") return String(l["@href"] ?? text(l)).trim();
  }
  return text(entry.guid).startsWith("http") ? text(entry.guid) : "";
}

function imageOf(entry: Record<string, unknown>): string | undefined {
  const media = (entry["media:content"] ?? entry["media:thumbnail"]) as Record<string, unknown> | Record<string, unknown>[] | undefined;
  for (const m of asArray(media)) {
    const url = m?.["@url"];
    if (typeof url === "string") return url;
  }
  const enc = entry.enclosure as Record<string, unknown> | undefined;
  if (enc && typeof enc["@url"] === "string" && String(enc["@type"] ?? "").startsWith("image")) return enc["@url"] as string;
  return undefined;
}

export function parseFeed(xml: string, feed: Feed): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, any>;
  const entries: Record<string, unknown>[] = doc?.rss?.channel
    ? asArray(doc.rss.channel.item)
    : doc?.feed
      ? asArray(doc.feed.entry)
      : doc?.["rdf:RDF"]
        ? asArray(doc["rdf:RDF"].item)
        : [];
  const items: FeedItem[] = [];
  for (const e of entries) {
    const title = stripHtml(text(e.title));
    const url = linkOf(e);
    if (!title || !url) continue;
    const dateRaw = text(e.pubDate ?? e.published ?? e.updated ?? e["dc:date"]);
    const date = dateRaw ? new Date(dateRaw) : new Date(NaN);
    if (Number.isNaN(date.getTime())) continue;
    const summary = stripHtml(text(e.description ?? e.summary ?? e["content:encoded"] ?? e.content)).slice(0, 1200);
    items.push({
      title,
      url,
      summary,
      publishedAt: date.toISOString(),
      source: feed.name,
      sourceKind: feed.kind,
      imageUrl: imageOf(e),
    });
  }
  return items;
}

export async function fetchFeeds(feeds: Feed[]): Promise<FeedItem[]> {
  const results = await Promise.allSettled(
    feeds.map(async (feed) => {
      const res = await fetchWithTimeout(feed.url, { headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseFeed(await res.text(), feed);
    }),
  );
  const items: FeedItem[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else log("warn", "feed failed", { feed: feeds[i]?.name, error: errorMessage(r.reason) });
  });
  return items;
}

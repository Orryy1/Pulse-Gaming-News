// Pulls readable body text from a source article so the fact-check step can
// compare the script against what the sources actually say, not just headlines.

import * as cheerio from "cheerio";
import { fetchWithTimeout, log, errorMessage } from "../lib/util.ts";
import { fetchPublic } from "../lib/publicurl.ts";
import { fetchRockstarArticle } from "./newsrooms.ts";

export interface ArticleText {
  url: string;
  title: string;
  text: string;
  ogImage?: string;
  /** Official newsroom posts: every press image in the post. */
  images?: string[];
  /** A reprint's original article, whose full text this is (a press group's post on Steam News). */
  via?: string;
}

export function extractArticle(html: string, url: string): ArticleText {
  const $ = cheerio.load(html);
  $(
    "script, style, noscript, nav, header, footer, aside, form, iframe, figure figcaption",
  ).remove();
  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("title").first().text() ||
    "";
  const ogImage = $('meta[property="og:image"]').attr("content") || undefined;
  const container =
    $("article").first().length > 0
      ? $("article").first()
      : $("main").first().length > 0
        ? $("main").first()
        : $("body");
  const paragraphs = container
    .find("p, h2, li")
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter(
      (p) =>
        p.length > 40 &&
        !/cookie|subscribe|newsletter|sign up|affiliate commission/i.test(p),
    );
  return {
    url,
    title: title.trim(),
    text: paragraphs.join("\n").slice(0, 9000),
    ogImage,
  };
}

const WIKI_SECTIONS =
  /development|production|design|release|reception|legacy|re-release|remaster|port|sequel|cancel|history|sales|future|related|versions/i;

/**
 * A Wikipedia article as plain text from the API: the lead plus the sections that answer "why"
 * questions (development, reception, legacy, re-releases), up to 9,000 characters.
 */
export async function fetchWikipedia(
  url: string,
): Promise<ArticleText | undefined> {
  const title = decodeURIComponent(
    url.replace(/^https?:\/\/en\.wikipedia\.org\/wiki\//, "").split("#")[0]!,
  ).replace(/_/g, " ");
  try {
    const api = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(title)}`;
    const res = await fetchWithTimeout(
      api,
      {
        headers: {
          "user-agent": "PulseGamingNews/1.0 (factory; contact via channel)",
        },
      },
      15_000,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pages =
      (
        (await res.json()) as {
          query?: {
            pages?: Record<
              string,
              { title?: string; extract?: string; missing?: string }
            >;
          };
        }
      ).query?.pages ?? {};
    const page = Object.values(pages)[0];
    if (!page?.extract || page.missing !== undefined) return undefined;
    // Top-level sections ("== Legacy ==") with their subsections; each relevant one gets a share, most telling first.
    const sections = page.extract.split(/\n(?=== [^=]+ ==\n)/);
    const lead = sections[0]!.slice(0, 1800);
    const heading = (p: string) => p.split("\n")[0] ?? "";
    const rank = (h: string) =>
      [
        /legacy|future|sequel|cancel|remaster|re-release|port|versions/i,
        /reception|sales/i,
        /release/i,
        /development|production|design|history/i,
      ].findIndex((re) => re.test(h));
    const wanted = sections
      .slice(1)
      .filter((p) => WIKI_SECTIONS.test(heading(p)))
      .sort((a, b) => rank(heading(a)) - rank(heading(b)))
      .map((p) => p.slice(0, 1800));
    const text = [lead, ...wanted]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .slice(0, 9000);
    return text.length > 200
      ? { url, title: page.title ?? title, text }
      : undefined;
  } catch (err) {
    log("warn", "wikipedia fetch failed", { url, error: errorMessage(err) });
    return undefined;
  }
}

/** A Steam News post: /news/app/<appid>/view/<gid> (a game's own announcements) or /news/group/<clan>/view/<gid>. */
export function steamNewsPost(
  url: string,
): { kind: "app" | "group"; id: string; gid: string } | undefined {
  const m = url.match(
    /^https?:\/\/store\.steampowered\.com\/news\/(app|group)\/(\d+)\/view\/(\d+)/,
  );
  return m ? { kind: m[1] as "app" | "group", id: m[2]!, gid: m[3]! } : undefined;
}

/** Steam's BBCode (and the odd HTML tag a feed carries) as plain text: images dropped, links kept as their words. */
export function bbcodeToText(body: string): string {
  return body
    .replace(/\[img[^\]]*\][\s\S]*?\[\/img\]/gi, " ")
    .replace(/\[previewyoutube[^\]]*\][\s\S]*?\[\/previewyoutube\]/gi, " ")
    .replace(/\[\*\]/g, "\n- ")
    .replace(/\[\/?(?:h\d|p|list|olist|tr|table)\]/gi, "\n")
    .replace(/\[[^\]]{1,200}\]/g, "")
    .replace(/<br\s*\/?>|<\/p>|<\/h\d>|<li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export interface SteamPost {
  title: string;
  text: string;
  /** A press reprint's link to the outlet's full article: Steam carries only its opening lines. */
  readMore?: string;
}

/**
 * The post itself from a Steam News page. The page is a JavaScript app, so its paragraphs are not in the HTML, but
 * the post rides along as JSON in data-partnereventstore. Press groups (Screen Rant, PC Gamer...) reprint just the
 * first paragraph there with a read-more link to the full article.
 */
export function parseSteamNewsPage(
  html: string,
  gid: string,
): SteamPost | undefined {
  const $ = cheerio.load(html);
  const raw = $("[data-partnereventstore]").first().attr("data-partnereventstore");
  if (!raw) return undefined;
  try {
    const events = JSON.parse(raw) as Array<{
      gid?: string;
      event_name?: string;
      jsondata?: string;
      announcement_body?: { gid?: string; headline?: string; body?: string };
    }>;
    const e =
      events.find((x) => x.gid === gid || x.announcement_body?.gid === gid) ??
      events[0];
    if (!e?.announcement_body?.body) return undefined;
    let readMore: string | undefined;
    try {
      const link = (JSON.parse(e.jsondata || "{}") as { read_more_link?: string })
        .read_more_link;
      if (link && /^https?:\/\//.test(link) && !/steampowered\.com|steamcommunity\.com/.test(link))
        readMore = link;
    } catch {
      // No jsondata: a post with no outside article.
    }
    return {
      title: e.event_name || e.announcement_body.headline || "",
      text: bbcodeToText(e.announcement_body.body).slice(0, 9000),
      readMore,
    };
  } catch {
    return undefined;
  }
}

/** A game's own post from the Steam Web API, whole (maxlength=0), found by its gid among the latest. */
async function steamAppNews(
  appId: string,
  gid: string,
): Promise<SteamPost | undefined> {
  const res = await fetchWithTimeout(
    `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=100&maxlength=0&format=json`,
    {},
    15_000,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items =
    ((await res.json()) as {
      appnews?: { newsitems?: Array<{ gid?: string; title?: string; contents?: string }> };
    }).appnews?.newsitems ?? [];
  const hit = items.find((i) => i.gid === gid);
  return hit?.contents
    ? { title: hit.title ?? "", text: bbcodeToText(hit.contents).slice(0, 9000) }
    : undefined;
}

/**
 * A Steam News post's full text, so the writer sees what the post says and not the feed's teaser. Press reprints
 * are followed to the outlet's own article. The text keeps the Steam URL, which is how the writer's source block
 * matches it to its story item. Whatever was found comes back even when short, so the thin-source gate can see it.
 */
async function fetchSteamNews(
  url: string,
  post: { kind: "app" | "group"; id: string; gid: string },
): Promise<ArticleText | undefined> {
  let found: SteamPost | undefined;
  try {
    const res = await fetchPublic(url, { headers: { accept: "text/html" } }, 15_000);
    if (res.ok) found = parseSteamNewsPage(await res.text(), post.gid);
  } catch (err) {
    log("warn", "steam news page fetch failed", { url, error: errorMessage(err) });
  }
  if (!found && post.kind === "app")
    found = await steamAppNews(post.id, post.gid).catch((err) => {
      log("warn", "steam app news fetch failed", { url, error: errorMessage(err) });
      return undefined;
    });
  if (found?.readMore) {
    const full = await fetchArticle(found.readMore).catch(() => undefined);
    if (full && full.text.length > found.text.length)
      return { url, title: found.title || full.title, text: full.text, ogImage: full.ogImage, via: found.readMore };
  }
  return found?.text ? { url, title: found.title, text: found.text } : undefined;
}

/** Below this many characters of body text, no source says enough to write a news Short from (SOURCE_MIN_CHARS). */
export const THIN_SOURCE_CHARS = 600;

/**
 * The most any one source says: the longest body the writer would see, fetched text or the feed's own summary.
 * A Steam reprint's opening paragraph (Elden Ring's questline, 4 Nov 2026) is about 400 characters.
 */
export function richestSourceChars(
  articles: ArticleText[],
  items: Array<{ url: string; summary: string }>,
): number {
  const byUrl = new Map(articles.map((a) => [a.url, a.text]));
  return Math.max(
    0,
    ...items.map((i) => (byUrl.get(i.url) || i.summary || "").trim().length),
  );
}

/** Why a story's sources are too thin to write from, or undefined when one says enough. 0 turns the gate off. */
export function thinSourceProblem(
  articles: ArticleText[],
  items: Array<{ url: string; summary: string }>,
  minChars = THIN_SOURCE_CHARS,
): string | undefined {
  if (minChars <= 0) return undefined;
  const most = richestSourceChars(articles, items);
  return most < minChars
    ? `source too thin: the fullest of ${items.length} source${items.length === 1 ? "" : "s"} gives ${most} characters of text (at least ${minChars} needed), so the Short would be written from a headline`
    : undefined;
}

export async function fetchArticle(
  url: string,
): Promise<ArticleText | undefined> {
  if (/^https?:\/\/en\.wikipedia\.org\/wiki\//.test(url))
    return fetchWikipedia(url);
  const steam = steamNewsPost(url);
  if (steam) return fetchSteamNews(url, steam);
  // Rockstar's Newswire is a JavaScript app: its posts come from the site's own data endpoint.
  if (/rockstargames\.com\/newswire\/article\//.test(url))
    return fetchRockstarArticle(
      url,
      process.env.ROCKSTAR_NEWSWIRE_POST_HASH || undefined,
    );
  try {
    const res = await fetchPublic(
      url,
      { headers: { accept: "text/html" } },
      15_000,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const art = extractArticle(html, url);
    return art.text.length > 200 ? art : undefined;
  } catch (err) {
    log("warn", "article fetch failed", { url, error: errorMessage(err) });
    return undefined;
  }
}

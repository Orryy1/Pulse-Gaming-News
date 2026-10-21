// Pulls readable body text from a source article so the fact-check step can
// compare the script against what the sources actually say, not just headlines.

import * as cheerio from "cheerio";
import { fetchWithTimeout, log, errorMessage } from "../lib/util.ts";
import { fetchRockstarArticle } from "./newsrooms.ts";

export interface ArticleText {
  url: string;
  title: string;
  text: string;
  ogImage?: string;
  /** Official newsroom posts: every press image in the post. */
  images?: string[];
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

export async function fetchArticle(
  url: string,
): Promise<ArticleText | undefined> {
  if (/^https?:\/\/en\.wikipedia\.org\/wiki\//.test(url))
    return fetchWikipedia(url);
  // Rockstar's Newswire is a JavaScript app: its posts come from the site's own data endpoint.
  if (/rockstargames\.com\/newswire\/article\//.test(url))
    return fetchRockstarArticle(
      url,
      process.env.ROCKSTAR_NEWSWIRE_POST_HASH || undefined,
    );
  try {
    const res = await fetchWithTimeout(
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

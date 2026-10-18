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
  $("script, style, noscript, nav, header, footer, aside, form, iframe, figure figcaption").remove();
  const title = $('meta[property="og:title"]').attr("content") || $("title").first().text() || "";
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
    .filter((p) => p.length > 40 && !/cookie|subscribe|newsletter|sign up|affiliate commission/i.test(p));
  return { url, title: title.trim(), text: paragraphs.join("\n").slice(0, 9000), ogImage };
}

export async function fetchArticle(url: string): Promise<ArticleText | undefined> {
  // Rockstar's Newswire is a JavaScript app: its posts come from the site's own data endpoint.
  if (/rockstargames\.com\/newswire\/article\//.test(url)) return fetchRockstarArticle(url, process.env.ROCKSTAR_NEWSWIRE_POST_HASH || undefined);
  try {
    const res = await fetchWithTimeout(url, { headers: { accept: "text/html" } }, 15_000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const art = extractArticle(html, url);
    return art.text.length > 200 ? art : undefined;
  } catch (err) {
    log("warn", "article fetch failed", { url, error: errorMessage(err) });
    return undefined;
  }
}

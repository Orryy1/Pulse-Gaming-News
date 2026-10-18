// The public Pulse Gaming News website on pulse.orryy.com: one article per
// published video (the story in prose, the video embedded, its sources and
// shop links in the reader's own Amazon store), an index, and an RSS feed the
// newsletter sends from. Pure renderers; the server supplies the episodes.

import type { Script } from "../editorial/schema.ts";
import { polishTitle } from "../editorial/seo.ts";
import {
  productsFor,
  shopPageHtml,
  type AffiliateTags,
} from "../editorial/affiliate.ts";
import { speakable } from "../voice/speakable.ts";

export interface SiteEpisode {
  id: string;
  lane: string;
  youtube_video_id: string;
  script_json: Script;
  story_json: {
    items?: Array<{ source: string; url: string; title?: string }>;
  };
  live_at: string; // when it went public on YouTube
}

const esc = (t: string) =>
  String(t ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/** "wolf-among-us-remastered-delayed-14ffc0f4": readable, and the id's tail finds the episode. */
export function articleSlug(
  ep: Pick<SiteEpisode, "id" | "script_json">,
): string {
  const words = polishTitle(ep.script_json)
    .toLowerCase()
    .replace(/[\u00ae\u2122\u00a9]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .slice(0, 10)
    .join("-");
  return `${words}-${ep.id.split("_").pop()}`;
}

export const idTailOf = (slug: string) => slug.split("-").pop() ?? "";

/** The story in prose: the hook, each beat, the take. Spoken numbers stay as written figures. */
export function articleParagraphs(s: Script): string[] {
  const beats = s.beats.map((b) => b.narration.trim()).filter(Boolean);
  // Group beats into readable paragraphs of two or three sentences.
  const paras: string[] = [s.hook.trim()];
  for (let i = 0; i < beats.length; i += 2)
    paras.push(beats.slice(i, i + 2).join(" "));
  const take = s.pulse_take.narration.trim();
  const label = s.pulse_take.label.trim().toLowerCase();
  // "Our read: ..." already names itself; only an unlabelled take gets the card's label in front.
  if (take)
    paras.push(
      !label || take.toLowerCase().startsWith(label)
        ? take
        : `${label.replace(/^\w/, (c) => c.toUpperCase())}: ${take}`,
    );
  return paras.filter(Boolean);
}

const STYLE = `<style>
:root{--ink:#0b0b0e;--paper:#f5f5f2;--muted:#a3a3a3;--amber:#ff6b1a;--line:#24242a}
body{margin:0;background:var(--ink);color:var(--paper);font:17px/1.65 system-ui,-apple-system,Segoe UI,sans-serif}
a{color:var(--amber)}header{border-bottom:1px solid var(--line);padding:14px 16px}header a{color:var(--paper);text-decoration:none;font-weight:900;letter-spacing:1px}
header span{color:var(--amber)}main{max-width:720px;margin:0 auto;padding:22px 16px 60px}h1{font-size:30px;line-height:1.2;margin:6px 0 14px}
.meta{color:var(--muted);font-size:14px}.video{position:relative;padding-top:177%;max-width:360px;margin:18px 0;border-radius:14px;overflow:hidden;background:#000}
.video.wide{padding-top:56.25%;max-width:none}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.card{display:block;padding:16px 0;border-bottom:1px solid var(--line);color:var(--paper);text-decoration:none}.card b{font-size:19px}.card small{display:block;color:var(--muted)}
h2{font-size:20px;margin-top:30px}ul{padding-left:20px}footer{color:var(--muted);font-size:13px;margin-top:40px}
.buy{display:inline-block;background:var(--amber);color:var(--ink);font-weight:800;padding:12px 18px;border-radius:10px;text-decoration:none}
</style>`;

function shell(opts: {
  title: string;
  description: string;
  canonical: string;
  body: string;
  jsonLd?: object;
  image?: string;
}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title><meta name="description" content="${esc(opts.description)}"><link rel="canonical" href="${esc(opts.canonical)}">
<meta property="og:title" content="${esc(opts.title)}"><meta property="og:description" content="${esc(opts.description)}"><meta property="og:type" content="article">
${opts.image ? `<meta property="og:image" content="${esc(opts.image)}"><meta name="twitter:card" content="summary_large_image">` : ""}
<link rel="alternate" type="application/rss+xml" title="Pulse Gaming News" href="/rss.xml">
${opts.jsonLd ? `<script type="application/ld+json">${JSON.stringify(opts.jsonLd).replace(/</g, "\\u003c")}</script>` : ""}
${STYLE}</head><body><header><a href="/news">PULSE GAMING NEWS<span>.</span></a></header><main>${opts.body}
<footer>Pulse Gaming News: gaming news, checked and explained. Stories are written with AI assistance from the sources listed and narrated with an AI voice. As an Amazon Associate we earn from qualifying purchases.</footer></main></body></html>`;
}

export function articlePage(
  ep: SiteEpisode,
  base: string,
  tags: AffiliateTags,
  country?: string,
): string {
  const s = ep.script_json;
  const title = polishTitle(s);
  const url = `${base}/news/${articleSlug(ep)}`;
  const long = s.runtime === "long";
  const thumb = `https://i.ytimg.com/vi/${ep.youtube_video_id}/hqdefault.jpg`;
  const sources = [
    ...(ep.story_json.items ?? [])
      .slice(0, 6)
      .map((i) => ({ name: i.source, url: i.url })),
    ...(s.sources ?? []).map((u) => ({ name: "Wikipedia", url: u })),
  ];
  const products = productsFor(s, ep.lane === "free");
  const shop = products.length
    ? shopPageHtml({
        title: "Get the games and gear",
        products,
        tags,
        country,
      })
        .replace(/<h1>[^<]*<\/h1><p>[^<]*<\/p>/, "")
        .replace(
          /<p style="font-size:13px[^"]*">As an Amazon Associate[^<]*<\/p>/,
          "",
        )
    : "";
  const body = `<p class="meta">${new Date(ep.live_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}${s.is_rumour ? " · Unconfirmed report" : ""}</p>
<h1>${esc(title)}</h1>
<div class="video${long ? " wide" : ""}"><iframe src="https://www.youtube-nocookie.com/embed/${esc(ep.youtube_video_id)}" title="${esc(title)}" loading="lazy" allowfullscreen></iframe></div>
${articleParagraphs(s)
  .map((p) => `<p>${esc(p)}</p>`)
  .join("\n")}
${s.is_rumour ? "<p><i>This report is unconfirmed. We will update it when it is confirmed or denied.</i></p>" : ""}
${sources.length ? `<h2>Sources</h2><ul>${sources.map((x) => `<li><a href="${esc(x.url)}" rel="nofollow noopener">${esc(x.name)}</a></li>`).join("")}</ul>` : ""}
${shop ? `<h2>Get the games and gear</h2>${shop}` : ""}
<p><a href="https://www.youtube.com/@PulseGMG?sub_confirmation=1">Subscribe on YouTube</a> for gaming news every day.</p>`;
  return shell({
    title: `${title} | Pulse Gaming News`,
    description: articleParagraphs(s)[0]?.slice(0, 160) ?? title,
    canonical: url,
    image: thumb,
    body,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: title.slice(0, 110),
      datePublished: ep.live_at,
      image: [thumb],
      author: { "@type": "Organization", name: "Pulse Gaming News", url: base },
      publisher: { "@type": "Organization", name: "Pulse Gaming News" },
      mainEntityOfPage: url,
    },
  });
}

export function indexPage(eps: SiteEpisode[], base: string): string {
  const cards = eps
    .map((ep) => {
      const s = ep.script_json;
      return `<a class="card" href="/news/${articleSlug(ep)}"><b>${esc(polishTitle(s))}</b><small>${new Date(ep.live_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} · ${esc(speakable(s.hook).slice(0, 140))}</small></a>`;
    })
    .join("");
  return shell({
    title: "Pulse Gaming News: gaming news, checked and explained",
    description:
      "The day's biggest gaming stories, checked against the sources and explained in a minute, with the video for every story.",
    canonical: `${base}/news`,
    body: `<h1>Gaming news, checked and explained</h1><p class="meta">Every story has its video and its sources. <a href="/rss.xml">RSS</a></p>${cards || "<p>No stories yet.</p>"}`,
  });
}

/** RSS 2.0 for the newsletter and readers: one item per article, the newest first. */
export function rssFeed(eps: SiteEpisode[], base: string): string {
  const items = eps
    .map((ep) => {
      const s = ep.script_json;
      const link = `${base}/news/${articleSlug(ep)}`;
      const html = `<p><a href="https://youtube.com/watch?v=${ep.youtube_video_id}"><img src="https://i.ytimg.com/vi/${ep.youtube_video_id}/hqdefault.jpg" alt=""></a></p>${articleParagraphs(
        s,
      )
        .map((p) => `<p>${esc(p)}</p>`)
        .join("")}<p><a href="${link}">Sources and the full story</a></p>`;
      return `<item><title>${esc(polishTitle(s))}</title><link>${link}</link><guid isPermaLink="false">pulse-${ep.id}</guid><pubDate>${new Date(ep.live_at).toUTCString()}</pubDate><description><![CDATA[${html.replace(/]]>/g, "]]&gt;")}]]></description></item>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Pulse Gaming News</title><link>${base}/news</link><description>Gaming news, checked and explained.</description><language>en-us</language>
${items}
</channel></rss>`;
}

/** The SQL for what the site shows: public videos only, newest first. */
export const SITE_EPISODES_SQL = `SELECT e.id, e.lane, e.youtube_video_id, e.script_json, e.story_json, COALESCE(e.publish_at, e.updated_at) AS live_at
  FROM episodes e
 WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL
   AND COALESCE(e.publish_at, e.updated_at) <= now()
   AND NOT EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind IN ('crosspost_skip','made_private') AND COALESCE(v.detail->>'reason','') IN ('not public on YouTube',''))
 ORDER BY COALESCE(e.publish_at, e.updated_at) DESC
 LIMIT $1`;

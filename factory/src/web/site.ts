// The public Pulse Gaming website: a home page, one article per published
// video (the story in prose, the video embedded, its sources and shop links in
// the reader's own Amazon store), a hub per game (live Steam price, release
// date and reviews, every story about it), the full video library, the legal
// pages, the sitemaps and the RSS feed the newsletter sends from. Pure
// renderers; the server supplies the episodes and the game cards.

import type { Script } from "../editorial/schema.ts";
import { polishTitle } from "../editorial/seo.ts";
import {
  amazonUrl,
  productsFor,
  shopPageHtml,
  storeFor,
  STORES,
  taggedStores,
  type AffiliateTags,
} from "../editorial/affiliate.ts";
import { speakable } from "../voice/speakable.ts";
import type { GameCard } from "./gamedata.ts";

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

export const BRAND = "Pulse Gaming";
const YT = "https://www.youtube.com/@PulseGMG";

const esc = (t: string) =>
  String(t ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

const day = (iso: string, month: "long" | "short" = "long") =>
  new Date(iso).toLocaleDateString("en-US", {
    year: month === "long" ? "numeric" : undefined,
    month,
    day: "numeric",
    timeZone: "UTC",
  });

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

// ---------------------------------------------------------------- games

const ROMAN: Record<string, string> = {
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10",
  xi: "11",
  xii: "12",
  xiii: "13",
  xiv: "14",
  xv: "15",
  xvi: "16",
};
const ALIASES: Array<[RegExp, string]> = [
  [/^gta\b/i, "grand theft auto"],
  [/^cod\b/i, "call of duty"],
  [/^botw\b/i, "the legend of zelda breath of the wild"],
  [/^totk\b/i, "the legend of zelda tears of the kingdom"],
];
/** Titles that name a roundup, not a game. */
const NOT_A_GAME =
  /^(new games?|gaming news|this week|various|multiple|several|free games?|steam|playstation|xbox|nintendo)\b/i;

/** One hub per game however a script spells it: "GTA VI", "Grand Theft Auto 6" and "GTA 6" share grand-theft-auto-6. */
export function gameSlug(title: string): string {
  let t = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u00ae\u2122\u00a9]/g, "")
    .toLowerCase()
    .trim();
  for (const [re, full] of ALIASES) t = t.replace(re, full);
  return t
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => ROMAN[w] ?? w)
    .join("-");
}

export interface GameHub {
  slug: string;
  name: string; // the spelling most stories use
  term: string; // what to look the game up by on Steam
  year?: number; // a ranking entry's release year, to tell a remake from the original
  episodes: SiteEpisode[];
}

/** Every game the published stories cover, the most covered first. */
export function gamesOf(eps: SiteEpisode[]): GameHub[] {
  const hubs = new Map<string, GameHub & { names: Map<string, number> }>();
  const add = (title: string, term: string, ep: SiteEpisode, year?: number) => {
    const name = title.replace(/[\u00ae\u2122\u00a9]/g, "").trim();
    if (!name || name.length > 80 || NOT_A_GAME.test(name)) return;
    const slug = gameSlug(name);
    if (slug.length < 2) return;
    const hub = hubs.get(slug) ?? {
      slug,
      name,
      term: term || name,
      year,
      episodes: [],
      names: new Map<string, number>(),
    };
    hub.names.set(name, (hub.names.get(name) ?? 0) + 1);
    if (!hub.episodes.includes(ep)) hub.episodes.push(ep);
    hub.year ??= year;
    hubs.set(slug, hub);
  };
  for (const ep of eps) {
    const s = ep.script_json;
    const achievements = /achievements$/.test(s.evergreen_format ?? "");
    if (s.entries?.length) {
      for (const e of s.entries) {
        // An achievement list's entries are achievements; the game is its search term.
        const game = achievements ? e.steam_search_term : e.game_title;
        if (game)
          add(
            game,
            e.steam_search_term || game,
            ep,
            achievements ? undefined : e.year || undefined,
          );
      }
    } else if (s.game_title) add(s.game_title, s.game_title, ep);
  }
  return [...hubs.values()]
    .map(({ names, ...h }) => ({
      ...h,
      name: [...names.entries()].sort(
        (a, b) => b[1] - a[1] || b[0].length - a[0].length,
      )[0]![0],
    }))
    .sort(
      (a, b) =>
        b.episodes.length - a.episodes.length ||
        Date.parse(b.episodes[0]!.live_at) - Date.parse(a.episodes[0]!.live_at),
    );
}

/** A hub earns a place in search when it has real substance: live store facts or more than one story. */
export const hubIndexable = (hub: GameHub, card?: GameCard) =>
  Boolean(card?.appId) || hub.episodes.length >= 2;

// ---------------------------------------------------------------- shell

const STYLE = `<style>
@font-face{font-family:Anton;src:url(/assets/fonts/anton-latin-400-normal.woff2) format("woff2");font-display:swap}
@font-face{font-family:Inter;font-weight:600;src:url(/assets/fonts/inter-latin-600-normal.woff2) format("woff2");font-display:swap}
@font-face{font-family:Inter;font-weight:800;src:url(/assets/fonts/inter-latin-800-normal.woff2) format("woff2");font-display:swap}
@font-face{font-family:Inter;font-weight:900;src:url(/assets/fonts/inter-latin-900-normal.woff2) format("woff2");font-display:swap}
:root{--ink:#0b0b0e;--panel:#15151a;--panel2:#1d1d24;--paper:#f5f5f2;--muted:#a3a3ab;--amber:#ff6b1a;--line:#26262e;color-scheme:dark}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--ink);color:var(--paper);font:17px/1.65 Inter,system-ui,-apple-system,Segoe UI,sans-serif;font-weight:600}
a{color:var(--amber)}img{max-width:100%;display:block}
.top{position:sticky;top:0;z-index:5;background:rgba(11,11,14,.92);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top .in{max-width:1180px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;gap:22px}
.logo{display:flex;align-items:center;gap:10px;color:var(--paper);text-decoration:none;font:400 24px/1 Anton,Impact,sans-serif;letter-spacing:1px}
.logo img{width:32px;height:32px;border-radius:7px}.logo span{color:var(--amber)}
nav{display:flex;gap:18px;overflow-x:auto;scrollbar-width:none}nav a{color:var(--muted);text-decoration:none;font-weight:800;font-size:15px;white-space:nowrap}nav a:hover,nav a[aria-current]{color:var(--paper)}
.sub{margin-left:auto;background:var(--amber);color:var(--ink);text-decoration:none;font-weight:900;font-size:14px;padding:8px 14px;border-radius:999px;white-space:nowrap}
main{max-width:1180px;margin:0 auto;padding:26px 16px 70px}
.narrow{max-width:740px;margin:0 auto}
h1{font:400 clamp(34px,5.4vw,58px)/1.04 Anton,Impact,sans-serif;letter-spacing:.3px;margin:6px 0 16px;text-transform:uppercase}
h2{font:400 26px/1.1 Anton,Impact,sans-serif;letter-spacing:.4px;text-transform:uppercase;margin:44px 0 16px}
h2 small{font:800 13px Inter,sans-serif;color:var(--muted);letter-spacing:0;text-transform:none;margin-left:10px}
.kicker{display:inline-block;background:var(--amber);color:var(--ink);font-weight:900;font-size:12px;letter-spacing:1px;padding:4px 9px;border-radius:5px;text-transform:uppercase}
.kicker.alt{background:var(--panel2);color:var(--paper)}
.meta{color:var(--muted);font-size:14px}
.grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.card{display:block;background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;color:var(--paper);text-decoration:none;transition:transform .15s,border-color .15s}
.card:hover{transform:translateY(-3px);border-color:#3a3a46}
.card .pic{aspect-ratio:16/9;background:#000 center/cover no-repeat;position:relative}
.card .pic .kicker{position:absolute;left:10px;top:10px}
.card .tx{padding:12px 14px 16px}.card b{display:block;font-weight:900;font-size:17px;line-height:1.3}.card small{display:block;color:var(--muted);font-size:13px;margin-top:6px}
.hero{display:grid;grid-template-columns:1.5fr 1fr;gap:26px;align-items:center;background:linear-gradient(135deg,#1a1210,#0b0b0e 60%);border:1px solid var(--line);border-radius:18px;overflow:hidden}
.hero .pic{aspect-ratio:16/9;background:#000 center/cover no-repeat;position:relative}
.hero .pic:after{content:"";position:absolute;inset:0;background:radial-gradient(circle at center,rgba(0,0,0,0) 0,rgba(0,0,0,.25) 100%)}
.play{position:absolute;left:50%;top:50%;width:76px;height:76px;margin:-38px 0 0 -38px;border-radius:50%;background:var(--amber);z-index:1;display:flex;align-items:center;justify-content:center}
.play:before{content:"";border-left:24px solid var(--ink);border-top:15px solid transparent;border-bottom:15px solid transparent;margin-left:6px}
.hero .tx{padding:24px 26px 24px 0}.hero h1{font-size:clamp(30px,3.6vw,46px)}.hero p{color:#d6d6da;margin:0 0 16px}
.chips{display:flex;flex-wrap:wrap;gap:10px}.chip{background:var(--panel);border:1px solid var(--line);color:var(--paper);text-decoration:none;font-weight:800;font-size:14px;padding:8px 13px;border-radius:999px}.chip:hover{border-color:var(--amber)}
.video{position:relative;aspect-ratio:9/16;max-width:380px;margin:20px 0;border-radius:16px;overflow:hidden;background:#000}
.video.wide{aspect-ratio:16/9;max-width:none}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.article p{font-size:19px;line-height:1.7;color:#e9e9ec}
.btn{display:inline-block;background:var(--amber);color:var(--ink);font-weight:900;padding:12px 18px;border-radius:10px;text-decoration:none}
.btn.ghost{background:transparent;color:var(--paper);border:1px solid var(--line)}
.buy,.buy:visited{display:inline-block;background:var(--amber);color:var(--ink);font-weight:900;padding:12px 18px;border-radius:10px;text-decoration:none}
.facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin:18px 0}
.fact{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.fact small{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.8px}.fact b{font-size:20px;font-weight:900}
.gamehead{display:grid;grid-template-columns:minmax(0,460px) 1fr;gap:26px;align-items:start}.gamehead img{border-radius:14px;width:100%}
ol.rank{padding-left:0;list-style:none;counter-reset:r}ol.rank li{counter-increment:r;display:flex;gap:14px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
ol.rank li:before{content:counter(r);font:400 26px Anton,sans-serif;color:var(--amber);min-width:34px;text-align:center}
.cta{margin-top:50px;padding:26px;border-radius:18px;background:linear-gradient(120deg,#ff6b1a,#ff9a4d);color:var(--ink)}.cta h2{margin:0 0 8px;color:var(--ink)}.cta p{margin:0 0 14px;font-weight:800}.cta .btn{background:var(--ink);color:var(--paper)}
footer{border-top:1px solid var(--line);color:var(--muted);font-size:13px}footer .in{max-width:1180px;margin:0 auto;padding:26px 16px 40px}footer a{color:#d4d4d8;margin-right:16px;text-decoration:none}
section.shop section{padding:14px 0;border-bottom:1px solid var(--line)}section.shop h2{font:900 18px Inter,sans-serif;text-transform:none;margin:0 0 10px}.more{font-size:14px;color:var(--muted)}.more a{color:#d4d4d8}
@media (max-width:820px){.hero,.gamehead{grid-template-columns:1fr}.hero .tx{padding:0 18px 22px}.sub{display:none}.top .in{gap:16px}}
</style>`;

const NAV: Array<[string, string]> = [
  ["/", "Home"],
  ["/news", "News"],
  ["/games", "Games"],
  ["/videos", "Videos"],
  ["/about", "About"],
];

export interface PageOpts {
  title: string;
  description: string;
  canonical: string;
  body: string;
  jsonLd?: object | object[];
  image?: string;
  type?: "article" | "website" | "video.other";
  noindex?: boolean;
  path?: string; // for the current nav item
}

export function shell(opts: PageOpts): string {
  const here = opts.path ?? new URL(opts.canonical).pathname;
  const ld = opts.jsonLd
    ? (Array.isArray(opts.jsonLd) ? opts.jsonLd : [opts.jsonLd])
        .map(
          (j) =>
            `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`,
        )
        .join("")
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title><meta name="description" content="${esc(opts.description)}"><link rel="canonical" href="${esc(opts.canonical)}">
${opts.noindex ? '<meta name="robots" content="noindex,follow">' : '<meta name="robots" content="max-image-preview:large">'}
<meta property="og:site_name" content="${BRAND}"><meta property="og:title" content="${esc(opts.title)}"><meta property="og:description" content="${esc(opts.description)}"><meta property="og:type" content="${opts.type ?? "website"}"><meta property="og:url" content="${esc(opts.canonical)}">
${opts.image ? `<meta property="og:image" content="${esc(opts.image)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(opts.image)}">` : '<meta name="twitter:card" content="summary">'}
<meta name="theme-color" content="#0b0b0e"><link rel="icon" href="/assets/icon-64.png" type="image/png"><link rel="apple-touch-icon" href="/assets/icon-180.png">
<link rel="preload" href="/assets/fonts/anton-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="alternate" type="application/rss+xml" title="${BRAND} News" href="/rss.xml">${ld}
${STYLE}</head><body><header class="top"><div class="in"><a class="logo" href="/"><img src="/assets/icon-64.png" alt="" width="32" height="32">PULSE GAMING<span>.</span></a>
<nav>${NAV.map(([href, label]) => `<a href="${href}"${(href === "/" ? here === "/" : here.startsWith(href)) ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>
<a class="sub" href="${YT}?sub_confirmation=1" rel="noopener">Subscribe</a></div></header>
<main>${opts.body}</main>
<footer><div class="in"><p><a href="/news">News</a><a href="/games">Games</a><a href="/videos">Videos</a><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/disclosure">Affiliate disclosure</a><a href="/rss.xml">RSS</a><a href="${YT}" rel="noopener">YouTube</a></p>
<p>${BRAND}: gaming news, checked and explained. Stories are written with AI assistance from the sources listed and narrated with an AI voice. As an Amazon Associate we earn from qualifying purchases.</p>
<p>© ${new Date().getUTCFullYear()} ${BRAND}. Game names, art and trailers belong to their publishers.</p></div></footer></body></html>`;
}

/** The site's own picture for a story: its thumbnail or game art, cut to 16:9. */
export const picOf = (ep: Pick<SiteEpisode, "id">) =>
  `/img/${ep.id.split("_").pop()}.jpg`;

function card(ep: SiteEpisode, kicker?: string): string {
  const s = ep.script_json;
  const tag =
    kicker ??
    (s.runtime === "long"
      ? s.recap
        ? "This week"
        : s.evergreen_format === "documentary"
        ? "Documentary"
        : "Ranked"
      : s.is_rumour
        ? "Report"
        : "");
  return `<a class="card" href="/news/${articleSlug(ep)}"><div class="pic" style="background-image:url('${picOf(ep)}')">${tag ? `<span class="kicker${s.is_rumour ? " alt" : ""}">${esc(tag)}</span>` : ""}</div><div class="tx"><b>${esc(polishTitle(s))}</b><small>${day(ep.live_at, "short")} · ${esc(speakable(s.hook).slice(0, 110))}</small></div></a>`;
}

const ctaBlock = `<div class="cta"><h2>Never miss a story</h2><p>Gaming news every day, rankings every week. Checked against the sources, explained in a minute.</p><a class="btn" href="${YT}?sub_confirmation=1" rel="noopener">Subscribe on YouTube</a></div>`;

const orgLd = (base: string) => ({
  "@context": "https://schema.org",
  "@type": "Organization",
  name: BRAND,
  url: base,
  logo: `${base}/assets/icon-512.png`,
  sameAs: [YT],
});

// ---------------------------------------------------------------- pages

export function homePage(
  eps: SiteEpisode[],
  base: string,
  hubs: GameHub[] = [],
): string {
  const [lead, ...rest] = eps;
  const longs = eps.filter((e) => e.script_json.runtime === "long").slice(0, 6);
  const news = rest.filter((e) => e.script_json.runtime !== "long").slice(0, 9);
  const hero = lead
    ? `<a class="hero" href="/news/${articleSlug(lead)}" style="color:inherit;text-decoration:none"><div class="pic" style="background-image:url('${picOf(lead)}')"><span class="play"></span></div><div class="tx"><span class="kicker">${lead.script_json.runtime === "long" ? "New video" : "Latest"}</span><h1>${esc(polishTitle(lead.script_json))}</h1><p>${esc(speakable(lead.script_json.hook))}</p><span class="meta">${day(lead.live_at)}</span></div></a>`
    : "<h1>Gaming news, checked and explained</h1><p>The first stories land here soon.</p>";
  const body = `${hero}
${news.length ? `<h2>Latest news <small><a href="/news">All stories</a></small></h2><div class="grid">${news.map((e) => card(e)).join("")}</div>` : ""}
${longs.length ? `<h2>Rankings and deep dives</h2><div class="grid">${longs.map((e) => card(e)).join("")}</div>` : ""}
${
  hubs.length
    ? `<h2>Games we cover <small><a href="/games">All games</a></small></h2><div class="chips">${hubs
        .slice(0, 18)
        .map(
          (h) => `<a class="chip" href="/games/${h.slug}">${esc(h.name)}</a>`,
        )
        .join("")}</div>`
    : ""
}
${ctaBlock}`;
  return shell({
    title: `${BRAND}: gaming news, checked and explained`,
    description:
      "The day's biggest gaming stories checked against the sources and explained in a minute, plus weekly rankings, release radars and game hubs with live prices.",
    canonical: `${base}/`,
    path: "/",
    image: lead ? `${base}${picOf(lead)}` : undefined,
    body,
    jsonLd: [
      orgLd(base),
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: BRAND,
        url: base,
      },
    ],
  });
}

export function indexPage(eps: SiteEpisode[], base: string): string {
  return shell({
    title: `Gaming news, checked and explained | ${BRAND}`,
    description:
      "The day's biggest gaming stories, checked against the sources and explained in a minute, with the video for every story.",
    canonical: `${base}/news`,
    body: `<h1>Gaming news</h1><p class="meta">Every story has its video and its sources. <a href="/rss.xml">RSS</a></p><div class="grid">${eps.map((e) => card(e)).join("") || "<p>No stories yet.</p>"}</div>${ctaBlock}`,
  });
}

export function articlePage(
  ep: SiteEpisode,
  base: string,
  tags: AffiliateTags,
  country?: string,
  more: { hubs?: GameHub[]; related?: SiteEpisode[] } = {},
): string {
  const s = ep.script_json;
  const title = polishTitle(s);
  const url = `${base}/news/${articleSlug(ep)}`;
  const long = s.runtime === "long";
  const thumb = `https://i.ytimg.com/vi/${ep.youtube_video_id}/hqdefault.jpg`;
  const image = `${base}${picOf(ep)}`;
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
        .replace(/<style>[\s\S]*?<\/style>/, "")
        .replace(/<h1>[^<]*<\/h1><p>[^<]*<\/p>/, "")
        .replace(
          /<p style="font-size:13px[^"]*">As an Amazon Associate[^<]*<\/p>/,
          "",
        )
    : "";
  const hubs = (more.hubs ?? []).filter((h) => h.episodes.includes(ep));
  const hubOf = (game: string) => hubs.find((h) => h.slug === gameSlug(game));
  const ranking = s.entries?.length
    ? `<h2>The full ranking</h2><ol class="rank">${[...s.entries]
        .sort((a, b) => b.rank - a.rank)
        .map((e) => {
          const h = hubOf(
            /achievements$/.test(s.evergreen_format ?? "")
              ? e.steam_search_term
              : e.game_title,
          );
          const name = esc(e.game_title);
          return `<li><span><b>${h ? `<a href="/games/${h.slug}">${name}</a>` : name}</b><br><span class="meta">${[
            e.year,
            e.platforms,
          ]
            .filter(Boolean)
            .map((x) => esc(String(x)))
            .join(" · ")}</span></span></li>`;
        })
        .join(
          "",
        )}</ol><p class="meta">Counted down from number ${s.entries.length} to number one.</p>`
    : "";
  const related = (more.related ?? [])
    .filter((r) => r.id !== ep.id)
    .slice(0, 3);
  const body = `<div class="narrow article"><p class="meta">${day(ep.live_at)}${s.is_rumour ? " · Unconfirmed report" : ""}</p>
<h1>${esc(title)}</h1>
<div class="video${long ? " wide" : ""}"><iframe src="https://www.youtube-nocookie.com/embed/${esc(ep.youtube_video_id)}" title="${esc(title)}" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>
${articleParagraphs(s)
  .map((p) => `<p>${esc(p)}</p>`)
  .join("\n")}
${s.is_rumour ? "<p><i>This report is unconfirmed. We will update it when it is confirmed or denied.</i></p>" : ""}
${ranking}
${hubs.length ? `<h2>Games in this story</h2><div class="chips">${hubs.map((h) => `<a class="chip" href="/games/${h.slug}">${esc(h.name)}: price, release date and news</a>`).join("")}</div>` : ""}
${sources.length ? `<h2>Sources</h2><ul>${sources.map((x) => `<li><a href="${esc(x.url)}" rel="nofollow noopener">${esc(x.name)}</a></li>`).join("")}</ul>` : ""}
${shop ? `<h2>Get the games and gear</h2><section class="shop">${shop}</section><p class="meta">As an Amazon Associate we earn from qualifying purchases.</p>` : ""}
</div>
${related.length ? `<h2>More stories</h2><div class="grid">${related.map((r) => card(r)).join("")}</div>` : ""}
${ctaBlock}`;
  return shell({
    title: `${title} | ${BRAND}`,
    description: articleParagraphs(s)[0]?.slice(0, 160) ?? title,
    canonical: url,
    image,
    type: "article",
    path: "/news",
    body,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        headline: title.slice(0, 110),
        datePublished: ep.live_at,
        dateModified: ep.live_at,
        image: [image, thumb],
        author: { "@type": "Organization", name: BRAND, url: base },
        publisher: {
          "@type": "Organization",
          name: BRAND,
          logo: { "@type": "ImageObject", url: `${base}/assets/icon-512.png` },
        },
        mainEntityOfPage: url,
      },
      {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        name: title.slice(0, 100),
        description: articleParagraphs(s)[0]?.slice(0, 300) ?? title,
        thumbnailUrl: [thumb],
        uploadDate: ep.live_at,
        embedUrl: `https://www.youtube.com/embed/${ep.youtube_video_id}`,
        contentUrl: `https://www.youtube.com/watch?v=${ep.youtube_video_id}`,
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "News",
            item: `${base}/news`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: title.slice(0, 110),
            item: url,
          },
        ],
      },
    ],
  });
}

export function gamesIndexPage(
  hubs: GameHub[],
  base: string,
  cards: Record<string, GameCard | undefined>,
): string {
  const tiles = hubs
    .map((h) => {
      const c = cards[h.slug];
      const pic = c?.header ?? picOf(h.episodes[0]!);
      const line = [
        c?.releaseDate &&
          (c.comingSoon ? `Out ${c.releaseDate}` : `Released ${c.releaseDate}`),
        c?.prices?.usd ?? c?.price,
        `${h.episodes.length} ${h.episodes.length === 1 ? "story" : "stories"}`,
      ]
        .filter(Boolean)
        .join(" · ");
      return `<a class="card" href="/games/${h.slug}"><div class="pic" style="background-image:url('${esc(pic)}')"></div><div class="tx"><b>${esc(h.name)}</b><small>${esc(line)}</small></div></a>`;
    })
    .join("");
  return shell({
    title: `Games: release dates, prices and news | ${BRAND}`,
    description:
      "Every game we cover in one place: release date, price in dollars, pounds and euros, Steam reviews and every story about it.",
    canonical: `${base}/games`,
    body: `<h1>Games</h1><p class="meta">Release dates, live prices and every story, game by game.</p><div class="grid">${tiles || "<p>No games yet.</p>"}</div>${ctaBlock}`,
  });
}

export function gamePage(
  hub: GameHub,
  card: GameCard | undefined,
  base: string,
  tags: AffiliateTags,
  country?: string,
): string {
  // Store pages print trademark marks after every name; a headline reads better without them.
  const tm = (t?: string) =>
    t
      ?.replace(/[®™©]/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  if (card)
    card = { ...card, name: tm(card.name), description: tm(card.description) };
  const name =
    card?.name && gameSlug(card.name) === hub.slug ? card.name : hub.name;
  const year =
    card?.releaseDate?.match(/\b(19|20)\d\d\b/)?.[0] ??
    (hub.year ? String(hub.year) : "");
  const upcoming = card?.comingSoon;
  const stores = taggedStores(tags);
  const want = storeFor(country);
  const home = stores.includes(want) ? want : stores[0];
  const facts: Array<[string, string]> = [];
  if (card?.releaseDate)
    facts.push([upcoming ? "Release date" : "Released", card.releaseDate]);
  else if (hub.year) facts.push(["Released", String(hub.year)]);
  const price = card?.prices
    ? [card.prices.usd, card.prices.gbp, card.prices.eur]
        .filter(Boolean)
        .join(" · ")
    : card?.price;
  if (price) facts.push(["Steam price", price]);
  if (card?.reviewSummary)
    facts.push([
      "Steam reviews",
      `${card.reviewSummary}${card.positivePercent ? ` (${card.positivePercent}%)` : ""}`,
    ]);
  if (card?.metacritic) facts.push(["Metacritic", String(card.metacritic)]);
  if (card?.currentPlayers)
    facts.push([
      "Playing on Steam now",
      card.currentPlayers.toLocaleString("en-US"),
    ]);
  if (card?.developers?.length)
    facts.push(["Developer", card.developers.join(", ")]);
  if (card?.publishers?.length)
    facts.push(["Publisher", card.publishers.join(", ")]);
  if (card?.genres?.length)
    facts.push(["Genre", card.genres.slice(0, 3).join(", ")]);
  const buy = home
    ? `<a class="btn" rel="sponsored nofollow" href="${esc(amazonUrl(`${name} game`, tags[home]!, home))}">Find it on Amazon ${esc(STORES[home].name)}</a> `
    : "";
  const steam = card?.storeUrl
    ? `<a class="btn ghost" href="${esc(card.storeUrl)}" rel="nofollow noopener">See it on Steam</a>`
    : "";
  const intro = card?.description ? `<p>${esc(card.description)}</p>` : "";
  const lead = `${name}${year ? ` (${year})` : ""}: ${upcoming ? "release date, price and the latest news" : "price, reviews and every story"}`;
  const body = `<div class="gamehead">${card?.header ? `<img src="${esc(card.header)}" alt="${esc(name)} key art" width="460" height="215">` : `<img src="${picOf(hub.episodes[0]!)}" alt="" width="460" height="259">`}
<div><span class="kicker">Game hub</span><h1>${esc(name)}</h1>${intro}<p>${buy}${steam}</p></div></div>
${facts.length ? `<div class="facts">${facts.map(([k, v]) => `<div class="fact"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join("")}</div>` : ""}
${card?.fetchedAt ? `<p class="meta">Store facts from Steam, checked ${day(card.fetchedAt)}. Prices change; the store shows today's price.</p>` : ""}
<h2>Every ${esc(name)} story</h2><div class="grid">${hub.episodes.map((e) => card_(e)).join("")}</div>
${home ? `<p class="meta">As an Amazon Associate we earn from qualifying purchases.</p>` : ""}
${ctaBlock}`;
  return shell({
    title: `${lead} | ${BRAND}`.slice(0, 120),
    description: (
      card?.description ||
      `${name}: release date, price in dollars, pounds and euros, reviews and every ${BRAND} story about it.`
    ).slice(0, 160),
    canonical: `${base}/games/${hub.slug}`,
    image: card?.header ?? `${base}${picOf(hub.episodes[0]!)}`,
    noindex: !hubIndexable(hub, card),
    path: "/games",
    body,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "VideoGame",
        name,
        url: `${base}/games/${hub.slug}`,
        image: card?.header,
        description: card?.description,
        datePublished: year || undefined,
        author: card?.developers?.map((d) => ({
          "@type": "Organization",
          name: d,
        })),
        publisher: card?.publishers?.map((d) => ({
          "@type": "Organization",
          name: d,
        })),
        genre: card?.genres,
        gamePlatform: card?.platforms,
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Games",
            item: `${base}/games`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name,
            item: `${base}/games/${hub.slug}`,
          },
        ],
      },
    ],
  });
}
const card_ = (e: SiteEpisode) => card(e);

export interface ChannelVideo {
  id: string;
  title: string;
  published: string;
  short: boolean;
}

export function videosPage(
  videos: ChannelVideo[],
  eps: SiteEpisode[],
  base: string,
): string {
  const article = new Map(eps.map((e) => [e.youtube_video_id, e]));
  const tile = (v: ChannelVideo) => {
    const ep = article.get(v.id);
    const href = ep
      ? `/news/${articleSlug(ep)}`
      : `https://www.youtube.com/${v.short ? "shorts/" : "watch?v="}${v.id}`;
    const pic = ep ? picOf(ep) : `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
    return `<a class="card" href="${esc(href)}"${ep ? "" : ' rel="noopener"'}><div class="pic" style="background-image:url('${esc(pic)}')"><span class="kicker${v.short ? " alt" : ""}">${v.short ? "Short" : "Video"}</span></div><div class="tx"><b>${esc(v.title)}</b><small>${day(v.published, "short")}</small></div></a>`;
  };
  const longs = videos.filter((v) => !v.short);
  const shorts = videos.filter((v) => v.short);
  return shell({
    title: `Videos | ${BRAND}`,
    description: `Every ${BRAND} video: daily news Shorts, weekly rankings, release radars and documentaries.`,
    canonical: `${base}/videos`,
    body: `<h1>Videos</h1><p class="meta">New every day on <a href="${YT}" rel="noopener">YouTube</a>.</p>
${longs.length ? `<h2>Rankings and documentaries</h2><div class="grid">${longs.map(tile).join("")}</div>` : ""}
${shorts.length ? `<h2>News Shorts</h2><div class="grid">${shorts.map(tile).join("")}</div>` : ""}
${videos.length ? "" : "<p>Videos are loading. Try again in a minute.</p>"}${ctaBlock}`,
  });
}

const STATIC: Record<
  string,
  { title: string; description: string; html: string }
> = {
  about: {
    title: "About",
    description: `${BRAND} explains the day's gaming news in a minute, checked against the sources.`,
    html: `<h1>About ${BRAND}</h1>
<p>${BRAND} covers the stories gamers actually care about: releases, delays, prices, leaks and the games worth your time. Every story is checked against its sources before it is published, and every article lists them.</p>
<p>We publish news Shorts every day, a release radar every Monday, rarest and hardest achievements every Wednesday, free games every Thursday, a weekly recap every Friday, the week's Steam climbers every Sunday and a long ranking or documentary every weekend.</p>
<h2>How we work</h2>
<p>Stories are found from publisher announcements, trusted outlets and community reports. Scripts are written with AI assistance from those sources and narrated with an AI voice. Reports that are not yet confirmed are labelled as unconfirmed, on screen and on the page.</p>
<p>Footage comes from official trailers, publishers' own channels and gameplay licensed for reuse under Creative Commons, always credited. Photos come from Wikimedia Commons under their licences. Every video's credits are listed in its description.</p>
<h2>Corrections</h2>
<p>If we get something wrong, tell us in the comments on the video and we will correct the article.</p>`,
  },
  privacy: {
    title: "Privacy policy",
    description: `How the ${BRAND} website handles your data.`,
    html: `<h1>Privacy policy</h1>
<p>This website does not use cookies of its own, does not run advertising trackers and does not ask you for any personal information.</p>
<h2>Videos</h2><p>Videos are embedded from YouTube in privacy-enhanced mode (youtube-nocookie.com): YouTube does not store information about you until you play a video. Once you do, YouTube's own privacy policy applies.</p>
<h2>Shop links</h2><p>Links to Amazon carry our Associates tag so Amazon can credit us for qualifying purchases. Amazon may set cookies when you visit its store; its privacy notice applies there. We pick your nearest Amazon store from the country your connection comes from; we do not store it.</p>
<h2>Hosting</h2><p>The site is served through Cloudflare, which processes standard technical data such as IP addresses to deliver pages and protect the site. We keep simple counts of shop page visits by country, without anything that identifies you.</p>
<h2>Changes</h2><p>We will update this page if anything here changes.</p>`,
  },
  disclosure: {
    title: "Affiliate disclosure",
    description: `How ${BRAND} earns money from links.`,
    html: `<h1>Affiliate disclosure</h1>
<p>${BRAND} is a participant in the Amazon Services LLC Associates Program and Amazon's Associates programmes in the UK, Canada, Australia, Germany, France, Italy and Spain, affiliate advertising programmes designed to provide a means for sites to earn advertising fees by advertising and linking to Amazon.</p>
<p>As an Amazon Associate we earn from qualifying purchases. It costs you nothing extra. Links are search links for the games and hardware a story names, so you always see current listings and every edition; we do not get paid to cover any game, and earning from links never decides what we cover or what we say about it.</p>`,
  },
};

export function staticPage(name: string, base: string): string | undefined {
  const p = STATIC[name];
  if (!p) return undefined;
  return shell({
    title: `${p.title} | ${BRAND}`,
    description: p.description,
    canonical: `${base}/${name}`,
    body: `<div class="narrow article">${p.html}</div>`,
    jsonLd: name === "about" ? orgLd(base) : undefined,
  });
}

// ---------------------------------------------------------------- feeds

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
<rss version="2.0"><channel><title>${BRAND} News</title><link>${base}/news</link><description>Gaming news, checked and explained.</description><language>en-us</language>
${items}
</channel></rss>`;
}

/** Every page worth crawling: the sections, each article and each hub with substance. */
export function sitemapXml(
  eps: SiteEpisode[],
  hubs: Array<{ hub: GameHub; card?: GameCard }>,
  base: string,
): string {
  const now = eps[0]?.live_at ?? new Date().toISOString();
  const urls: Array<[string, string]> = [
    [`${base}/`, now],
    [`${base}/news`, now],
    [`${base}/games`, now],
    [`${base}/videos`, now],
    [`${base}/about`, "2026-10-19T00:00:00.000Z"],
    ...eps.map((e): [string, string] => [
      `${base}/news/${articleSlug(e)}`,
      e.live_at,
    ]),
    ...hubs
      .filter(({ hub, card }) => hubIndexable(hub, card))
      .map(({ hub }): [string, string] => [
        `${base}/games/${hub.slug}`,
        hub.episodes[0]!.live_at,
      ]),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([loc, mod]) => `<url><loc>${esc(loc)}</loc><lastmod>${new Date(mod).toISOString()}</lastmod></url>`).join("\n")}
</urlset>`;
}

/** Google News sitemap: the last two days' articles. */
export function newsSitemapXml(
  eps: SiteEpisode[],
  base: string,
  now = Date.now(),
): string {
  const recent = eps.filter(
    (e) => now - Date.parse(e.live_at) < 48 * 3600 * 1000,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${recent
  .map(
    (e) =>
      `<url><loc>${esc(`${base}/news/${articleSlug(e)}`)}</loc><news:news><news:publication><news:name>${BRAND}</news:name><news:language>en</news:language></news:publication><news:publication_date>${new Date(e.live_at).toISOString()}</news:publication_date><news:title>${esc(polishTitle(e.script_json))}</news:title></news:news></url>`,
  )
  .join("\n")}
</urlset>`;
}

export function robotsTxt(base: string): string {
  return `User-agent: *
Allow: /
Disallow: /episodes
Disallow: /connect
Disallow: /oauth
Disallow: /shop/
Disallow: /credits/
Disallow: /engage/
Disallow: /tick

Sitemap: ${base}/sitemap.xml
Sitemap: ${base}/news-sitemap.xml
`;
}

/** The channel's public upload feed (YouTube's RSS: the latest 15, no key needed). */
export function parseChannelFeed(xml: string): ChannelVideo[] {
  const out: ChannelVideo[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1]!;
    const id = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const title = e.match(/<title>([^<]*)<\/title>/)?.[1];
    const published = e.match(/<published>([^<]+)<\/published>/)?.[1];
    const link = e.match(/<link rel="alternate" href="([^"]+)"/)?.[1] ?? "";
    if (!id || !title || !published) continue;
    out.push({
      id,
      title: title
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">"),
      published,
      short: /\/shorts\//.test(link),
    });
  }
  return out;
}

/** The SQL for what the site shows: public videos only, newest first. */
export const SITE_EPISODES_SQL = `SELECT e.id, e.lane, e.youtube_video_id, e.script_json, e.story_json, COALESCE(e.publish_at, e.updated_at) AS live_at
  FROM episodes e
 WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND e.lane <> 'cutdown'
   AND COALESCE(e.publish_at, e.updated_at) <= now()
   AND NOT EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind IN ('crosspost_skip','made_private') AND COALESCE(v.detail->>'reason','') IN ('not public on YouTube',''))
 ORDER BY COALESCE(e.publish_at, e.updated_at) DESC
 LIMIT $1`;

// The website's routes: every public page, the sitemaps, the pictures and the
// brand assets. Returns false for anything that is not the website so the
// factory's own routes (approvals, OAuth, health) carry on as before.

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import type { AffiliateTags } from "../editorial/affiliate.ts";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";
import { cachedCard, gameCard, type GameCard } from "./gamedata.ts";
import {
  articlePage,
  articleSlug,
  gamePage,
  gamesIndexPage,
  gamesOf,
  homePage,
  idTailOf,
  indexPage,
  newsSitemapXml,
  parseChannelFeed,
  robotsTxt,
  rssFeed,
  shell,
  SITE_EPISODES_SQL,
  sitemapXml,
  staticPage,
  videosPage,
  type ChannelVideo,
  type GameHub,
  type SiteEpisode,
} from "./site.ts";

const run = promisify(execFile);
const PUBLIC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface SiteContext {
  db: Db;
  cfg: Config;
  tags: (episodeId: string) => AffiliateTags;
}

/** The address the site lives at: SITE_URL once the domain is live, else the factory's public address. */
export const siteBase = (cfg: Config) =>
  (cfg.siteUrl || cfg.publicUrl).replace(/\/$/, "");

let epsCache: { at: number; eps: SiteEpisode[] } | undefined;
async function episodes(db: Db): Promise<SiteEpisode[]> {
  if (epsCache && Date.now() - epsCache.at < 60_000) return epsCache.eps;
  const eps = await db.query<SiteEpisode>(SITE_EPISODES_SQL, [500]);
  epsCache = { at: Date.now(), eps };
  return eps;
}

let feedCache: { at: number; videos: ChannelVideo[] } | undefined;
async function channelVideos(cfg: Config): Promise<ChannelVideo[]> {
  if (feedCache && Date.now() - feedCache.at < 30 * 60_000)
    return feedCache.videos;
  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${cfg.youtubeChannelId}`,
      {},
      10_000,
    );
    if (res.ok)
      feedCache = {
        at: Date.now(),
        videos: parseChannelFeed(await res.text()),
      };
  } catch (err) {
    log("warn", "channel feed failed", { error: errorMessage(err) });
  }
  return feedCache?.videos ?? [];
}

const SITE_PATH =
  /^\/($|news(\/|$)|games(\/|$)|videos$|about$|privacy$|disclosure$|rss\.xml$|sitemap\.xml$|news-sitemap\.xml$|robots\.txt$|img\/|assets\/(fonts|icon-))/;

/** A cut-down copy made once and kept: the story's thumbnail or art as a 960x540 JPEG, or the logo at an icon size. */
async function derived(
  src: string,
  dest: string,
  filter: string,
): Promise<string | undefined> {
  if (
    fs.existsSync(dest) &&
    fs.statSync(dest).mtimeMs >= fs.statSync(src).mtimeMs
  )
    return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp${path.extname(dest)}`;
  try {
    await run(FFMPEG, [
      "-v",
      "error",
      "-y",
      "-i",
      src,
      "-vf",
      filter,
      "-frames:v",
      "1",
      ...(dest.endsWith(".jpg") ? ["-q:v", "4"] : []),
      tmp,
    ]);
    fs.renameSync(tmp, dest);
    return dest;
  } catch (err) {
    log("warn", "site image failed", { src, error: errorMessage(err) });
    fs.rmSync(tmp, { force: true });
    return undefined;
  }
}

async function storyPicture(
  ctx: SiteContext,
  ep: SiteEpisode,
): Promise<string | undefined> {
  const dir = path.join(ctx.cfg.dataDir, "episodes", ep.id);
  const [row] = await ctx.db.query<{ assets_json: any }>(
    `SELECT assets_json FROM episodes WHERE id = $1`,
    [ep.id],
  );
  const images: Array<{
    file: string;
    kind: string;
    width?: number;
    height?: number;
  }> = row?.assets_json?.images ?? [];
  const wide = (i: (typeof images)[number]) =>
    !i.width || !i.height || i.width / i.height >= 1.2;
  const pick = [
    path.join(dir, "thumb.jpg"),
    ...["hero", "header", "screenshot", "article", "photo"].flatMap((k) =>
      images
        .filter((i) => i.kind === k && wide(i))
        .map((i) => path.join(dir, i.file)),
    ),
    path.join(dir, "poster.jpg"),
  ].find((f) => fs.existsSync(f));
  if (!pick) return undefined;
  return derived(
    pick,
    path.join(ctx.cfg.dataDir, "site", "img", `${ep.id}.jpg`),
    "scale=960:540:force_original_aspect_ratio=increase,crop=960:540",
  );
}

function sendFile(
  res: http.ServerResponse,
  file: string,
  type: string,
  maxAge: number,
): void {
  res.writeHead(200, {
    "content-type": type,
    "content-length": fs.statSync(file).size,
    "cache-control": `public, max-age=${maxAge}`,
  });
  fs.createReadStream(file).pipe(res);
}

async function hubsWithCards(
  ctx: SiteContext,
  eps: SiteEpisode[],
): Promise<{ hubs: GameHub[]; cards: Record<string, GameCard | undefined> }> {
  const hubs = gamesOf(eps);
  const cards: Record<string, GameCard | undefined> = {};
  for (const h of hubs)
    cards[h.slug] = cachedCard(ctx.cfg.dataDir, h.term, h.year);
  return { hubs, cards };
}

export async function handleSite(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  ctx: SiteContext,
): Promise<boolean> {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (!SITE_PATH.test(url.pathname)) return false;
  const { cfg, db } = ctx;
  const base = siteBase(cfg);
  // Once the site has its own domain, the factory's address sends readers there.
  const host = String(req.headers.host ?? "").toLowerCase();
  const siteHost = new URL(base).host.toLowerCase();
  if (
    cfg.siteUrl &&
    host &&
    host !== siteHost &&
    host === new URL(cfg.publicUrl).host.toLowerCase()
  ) {
    res
      .writeHead(301, { location: `${base}${url.pathname}${url.search}` })
      .end();
    return true;
  }
  const country = String(req.headers["cf-ipcountry"] ?? "");
  const html = (code: number, body: string, cache = "public, max-age=300") =>
    res
      .writeHead(code, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": cache,
      })
      .end(req.method === "HEAD" ? undefined : body);
  const notFound = () =>
    html(
      404,
      shell({
        title: "Not found | Pulse Gaming",
        description: "That page is not here.",
        canonical: `${base}${url.pathname}`,
        noindex: true,
        body: `<h1>That page is not here</h1><p><a href="/news">Latest stories</a> · <a href="/games">Games</a></p>`,
      }),
      "no-store",
    );

  const p = url.pathname;
  // Brand assets.
  const font = p.match(/^\/assets\/fonts\/([\w.-]+\.woff2)$/);
  if (font) {
    const file = path.join(
      PUBLIC_ROOT,
      "public",
      "fonts",
      font[1]!,
    );
    if (!fs.existsSync(file)) return (notFound(), true);
    sendFile(res, file, "font/woff2", 31536000);
    return true;
  }
  const icon = p.match(/^\/assets\/icon-(64|180|512)\.png$/);
  if (icon) {
    const n = icon[1]!;
    const file = await derived(
      path.join(PUBLIC_ROOT, "public", "logo.png"),
      path.join(cfg.dataDir, "site", `icon-${n}.png`),
      `scale=${n}:${n}`,
    );
    if (!file) return (notFound(), true);
    sendFile(res, file, "image/png", 604800);
    return true;
  }
  if (p === "/robots.txt") {
    res
      .writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=3600",
      })
      .end(robotsTxt(base));
    return true;
  }

  const eps = await episodes(db);
  const img = p.match(/^\/img\/([a-z0-9]{6,16})\.jpg$/);
  if (img) {
    const ep = eps.find((e) => e.id.endsWith(`_${img[1]}`));
    const file = ep && (await storyPicture(ctx, ep));
    if (!file) return (notFound(), true);
    sendFile(res, file, "image/jpeg", 86400);
    return true;
  }
  if (p === "/rss.xml") {
    res
      .writeHead(200, {
        "content-type": "application/rss+xml; charset=utf-8",
        "cache-control": "public, max-age=600",
      })
      .end(rssFeed(eps.slice(0, 30), base));
    return true;
  }
  if (p === "/sitemap.xml") {
    const { hubs, cards } = await hubsWithCards(ctx, eps);
    res
      .writeHead(200, {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=1800",
      })
      .end(
        sitemapXml(
          eps,
          hubs.map((hub) => ({ hub, card: cards[hub.slug] })),
          base,
        ),
      );
    return true;
  }
  if (p === "/news-sitemap.xml") {
    res
      .writeHead(200, {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=600",
      })
      .end(newsSitemapXml(eps, base));
    return true;
  }
  if (p === "/") {
    const hubs = gamesOf(eps);
    return (html(200, homePage(eps, base, hubs)), true);
  }
  if (p === "/news" || p === "/news/")
    return (html(200, indexPage(eps.slice(0, 120), base)), true);
  if (p.startsWith("/news/")) {
    const slug = decodeURIComponent(p.slice("/news/".length));
    const tail = idTailOf(slug);
    const ep =
      tail.length >= 6 ? eps.find((e) => e.id.endsWith(`_${tail}`)) : undefined;
    if (!ep) return (notFound(), true);
    const canonical = articleSlug(ep);
    if (slug !== canonical) {
      res.writeHead(301, { location: `/news/${canonical}` }).end();
      return true;
    }
    const hubs = gamesOf(eps);
    const mine = hubs.filter((h) => h.episodes.includes(ep));
    const related = [...new Set([...mine.flatMap((h) => h.episodes), ...eps])]
      .filter((e) => e.id !== ep.id)
      .slice(0, 3);
    // The shop links follow the reader's country: not cacheable by a shared cache.
    return (
      html(
        200,
        articlePage(ep, base, ctx.tags(ep.id), country, {
          hubs: mine,
          related,
        }),
        "private, max-age=300",
      ),
      true
    );
  }
  if (p === "/games" || p === "/games/") {
    const { hubs, cards } = await hubsWithCards(ctx, eps);
    return (html(200, gamesIndexPage(hubs, base, cards)), true);
  }
  const game = p.match(/^\/games\/([a-z0-9-]{2,90})$/);
  if (game) {
    const hub = gamesOf(eps).find((h) => h.slug === game[1]);
    if (!hub) return (notFound(), true);
    const card = await gameCard(cfg.dataDir, hub.term, hub.year);
    return (
      html(
        200,
        gamePage(hub, card, base, ctx.tags(hub.episodes[0]!.id), country),
        "private, max-age=300",
      ),
      true
    );
  }
  if (p === "/videos")
    return (html(200, videosPage(await channelVideos(cfg), eps, base)), true);
  const page = staticPage(p.slice(1), base);
  if (page) return (html(200, page, "public, max-age=3600"), true);
  return (notFound(), true);
}

/** Fetches every hub's store facts in the background so pages never wait on Steam. */
export function startGameWarmer(ctx: SiteContext): void {
  const warm = async () => {
    try {
      const hubs = gamesOf(await episodes(ctx.db));
      for (const h of hubs) {
        await gameCard(ctx.cfg.dataDir, h.term, h.year, 30_000).catch(
          () => undefined,
        );
        await new Promise((r) => setTimeout(r, 1500)); // gentle on the Steam store
      }
    } catch (err) {
      log("warn", "game warmer failed", { error: errorMessage(err) });
    }
  };
  setTimeout(() => void warm(), 60_000);
  setInterval(() => void warm(), 6 * 3600 * 1000);
}

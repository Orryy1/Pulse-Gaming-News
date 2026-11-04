// Publishers' own press pictures: the key art, screenshots and hardware shots a publisher puts on its press or
// newsroom site for the press to use in coverage. They are often the best picture of an announcement (a reveal's
// key art, a launch screenshot), so news Shorts lead with them and documentary chapters about an announcement
// may pin them to its sentence. Owner, 1 Nov 2026 (LIBRARY_PRESS, on by default).
//
// Only sites a publisher runs for press and editorial use, read through their stable WordPress search feeds
// (checked 1 Nov 2026; no scraping of pages that change shape):
//   Xbox Wire            news.xbox.com/en-us/search/<q>/feed/rss2/          images on xboxwire.thesourcemediaassets.com
//   PlayStation Blog     blog.playstation.com/search/<q>/feed/rss2/         images on its tachyon CDN and PlayStation's Flickr
//   Sony Interactive     sonyinteractive.com/en/search/<q>/feed/rss2/       its press releases, the post's share image
//   CD PROJEKT RED       www.cdprojekt.com/en/search/<q>/feed/rss2/         its media news, the post's share image
//   Steam Deck press kit www.steamdeck.com/en/press                         Valve's hardware press images, for Steam Deck lines
// Not used (no stable public press feed, or a login wall, checked 1 Nov 2026): Nintendo (press.nintendo.com
// asks for a login), Bandai Namco (its press portal does not answer), Ubisoft, EA, Capcom and Square Enix (press
// kits behind registration; their public news pages have no feed), Steam's own press page (redirects to the store).
//
// A post counts only when its title names the game (every distinguishing word) and is not a roundup ("Coming to
// Game Pass: A, B, C and More") or a merchandise tie-in, since those posts carry pictures of other things. The
// pictures then go through the same picture editor as everything else (src/assets/stillscore.ts rankStills, the
// local frame screen on Shorts), and carry "Image: <Publisher> press" on screen (src/assets/libraries.ts).

import type { CommonsImage } from "./commons.ts";
import { fetchWithTimeout, log, errorMessage } from "../lib/util.ts";

const UA =
  "PulseGamingFactory/1.0 (https://pulse.orryy.com; documentary research)";

export interface PressSite {
  id: string;
  /** The credit's name: "Image: <publisher> press". */
  publisher: string;
  /** The site's own name, recorded in the licence field. */
  site: string;
  /** The search feed (or, for a kit page, the page) for a query. */
  url: (query: string) => string;
  /** Where the site's own pictures live: anything else in a post (a store badge, an embed) is not its press art. */
  hosts: RegExp;
  /** The feed has no pictures in it: read the post's share image (og:image) instead. */
  shareImage?: boolean;
  /** A static press kit page rather than a feed: only for queries it is about. */
  kit?: RegExp;
}

export const PRESS_SITES: PressSite[] = [
  {
    id: "xbox",
    publisher: "Xbox",
    site: "Xbox Wire",
    url: (q) =>
      `https://news.xbox.com/en-us/search/${encodeURIComponent(q)}/feed/rss2/`,
    hosts: /^https:\/\/xboxwire\.thesourcemediaassets\.com\//,
  },
  {
    id: "playstation",
    publisher: "PlayStation",
    site: "PlayStation Blog",
    url: (q) =>
      `https://blog.playstation.com/search/${encodeURIComponent(q)}/feed/rss2/`,
    hosts:
      /^https:\/\/(blog\.playstation\.com\/tachyon\/|live\.staticflickr\.com\/)/,
  },
  {
    id: "sie",
    publisher: "Sony Interactive",
    site: "Sony Interactive Entertainment press releases",
    url: (q) =>
      `https://sonyinteractive.com/en/search/${encodeURIComponent(q)}/feed/rss2/`,
    hosts: /^https:\/\/sonyinteractive\.com\/tachyon\//,
    shareImage: true,
  },
  {
    id: "cdprojekt",
    publisher: "CD PROJEKT RED",
    site: "CD PROJEKT RED media news",
    url: (q) =>
      `https://www.cdprojekt.com/en/search/${encodeURIComponent(q)}/feed/rss2/`,
    hosts: /^https:\/\/www\.cdprojekt\.com\/en\/wp-content\/uploads/,
    shareImage: true,
  },
  {
    id: "steamdeck",
    publisher: "Valve",
    site: "the Steam Deck press kit",
    url: () => "https://www.steamdeck.com/en/press",
    hosts:
      /^https:\/\/cdn\.[a-z]+\.steamstatic\.com\/steamdeck\/images\/press\//,
    kit: /\bsteam ?deck\b/i,
  },
];

export interface PressItem {
  title: string;
  link: string;
  date?: string;
  images: string[];
}

const decode = (t: string) =>
  t
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#8217;|&#8216;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, "-")
    .replace(/&#038;|&amp;/g, "&")
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Never a press picture of the game: logos, icons, emoji, avatars, badges, thumbnails, animations. */
const NOT_ART =
  /logo|favicon|emoji|avatar|icon|badge|button|sprite|placeholder|_thumb|-\d{2,3}x\d{2,3}\.|\.(gif|svg)(\?|$)/i;

/** The full-size picture behind a resized one: WordPress "-1024x576" copies, tachyon and Photon resizes. */
export function fullSize(url: string): string {
  return url
    .replace(/^https:\/\/i\d\.wp\.com\//, "https://")
    .replace(/[?#].*$/, "")
    .replace(/-\d{2,4}x\d{2,4}(?=\.(jpe?g|png|webp)$)/i, "");
}

/** The site's own pictures in a block of HTML or XML, full size, each once, in order. */
export function siteImages(html: string, hosts: RegExp): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(
    /https:\/\/[^\s"'<>()]+?\.(?:jpe?g|png|webp)(?:\?[^\s"'<>()]*)?/gi,
  )) {
    const raw = m[0].replace(/&amp;/g, "&");
    if (!hosts.test(raw.replace(/^https:\/\/i\d\.wp\.com\//, "https://")))
      continue;
    if (NOT_ART.test(raw)) continue;
    const u = fullSize(raw);
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/** The items of a WordPress RSS feed: title, link, date and the site's own pictures in each. */
export function parsePressFeed(xml: string, site: PressSite): PressItem[] {
  const out: PressItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1]!;
    const title = decode(body.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const link = decode(body.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "");
    if (!title || !/^https?:/.test(link)) continue;
    out.push({
      title,
      link,
      date:
        decode(body.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "") ||
        undefined,
      images: siteImages(body, site.hosts),
    });
  }
  return out;
}

/** A press kit page: one item per picture, titled by its file name ("press oled front"). */
export function parsePressKit(
  html: string,
  site: PressSite,
  page: string,
): PressItem[] {
  return siteImages(html, site.hosts).map((u) => ({
    title: decodeURIComponent(u.split("/").pop() ?? "")
      .replace(/\.[a-z]+$/i, "")
      .replace(/[_-]+/g, " ")
      .trim(),
    link: page,
    images: [u],
  }));
}

const STOP = new Set(["the", "of", "and", "a", "an", "edition", "game"]);

/** The words a post title must carry to be about this game: "gears", "war", "e-day". */
export function gameWords(game: string): string[] {
  return game
    .toLowerCase()
    .replace(/[®™©]/g, "")
    .replace(/[:–—]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter((w) => w && !STOP.has(w));
}

/** A roundup, a deals post or a merchandise tie-in: its pictures are of other things. */
const NOT_ABOUT =
  /free play days|playstation now|games for [a-z]+ \d{4}|next week on|this week (on|in)|coming to .*game pass|game pass (wave|this|adds)|playstation plus|ps plus|monthly games|games with gold|\bdeals?\b|\bsale\b|round-?up|recap|and more$|giveaway|sweepstakes|contest|merch|pizza|liquid death|collab|partnership/i;

/** Whether a post is about this game, and not a roundup or tie-in. */
export function aboutGame(title: string, game: string): boolean {
  const words = gameWords(game);
  if (!words.length) return false;
  const t = ` ${title
    .toLowerCase()
    .replace(/[:–—'"’]/g, " ")
    .replace(/\s+/g, " ")} `;
  const has = (w: string) =>
    new RegExp(
      `(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
    ).test(t);
  if (!words.every(has)) return false;
  if (NOT_ABOUT.test(title)) return false;
  // A list of several games ("A, B, C") is a roundup even without the usual words.
  return (title.match(/,/g) ?? []).length < 2;
}

/** Announcement posts first: a reveal, trailer, date, launch or first look is what a news Short shows. */
const ANNOUNCE =
  /announc|reveal|unveil|trailer|first look|release date|launch|available (now|today)|out now|coming|pre-?order|screenshots|gameplay|showcase|direct|state of play|delay|date/i;

/** The press posts about a game from one site's feed, announcements first. */
export function pressPosts(items: PressItem[], game: string): PressItem[] {
  const about = items.filter((i) => aboutGame(i.title, game));
  return [
    ...about.filter((i) => ANNOUNCE.test(i.title)),
    ...about.filter((i) => !ANNOUNCE.test(i.title)),
  ];
}

/** A post's share image (og:image), when the feed itself carries no pictures. */
export function shareImageOf(html: string, hosts: RegExp): string | undefined {
  const m =
    html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    ) ??
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    );
  const u = m?.[1]?.replace(/&amp;/g, "&");
  return u && hosts.test(u) && !NOT_ART.test(u) ? fullSize(u) : undefined;
}

/** A press picture as the photo pipeline carries it (source "press": credited "Image: <publisher> press"). */
export function pressImage(
  site: PressSite,
  post: PressItem,
  url: string,
): CommonsImage {
  return {
    title: post.title,
    url,
    width: 0, // measured after the download
    height: 0,
    artist: site.publisher,
    license: `editorial use, offered to the press on ${site.site}`,
    pageUrl: post.link,
    description: post.title,
    source: "press",
    via: site.publisher,
  };
}

export interface PressOptions {
  sites?: PressSite[];
  /** At most this many pictures in all (default 8), and per post (default 3). */
  max?: number;
  perPost?: number;
  fetchFn?: typeof fetch;
}

/**
 * Press pictures of a game from every press site that has posts about it, announcements first, interleaved
 * across sites. Each site is asked once; one that fails or times out gives nothing.
 */
export async function searchPress(
  game: string,
  opts: PressOptions = {},
): Promise<CommonsImage[]> {
  const sites = opts.sites ?? PRESS_SITES;
  const max = opts.max ?? 8;
  const perPost = opts.perPost ?? 3;
  const get = async (url: string) => {
    const res = await (opts.fetchFn
      ? opts.fetchFn(url, { headers: { "user-agent": UA } })
      : fetchWithTimeout(url, { headers: { "user-agent": UA } }, 30_000));
    return res.ok ? await res.text() : "";
  };
  const query = gameWords(game).join(" ");
  if (!query) return [];
  const perSite = await Promise.all(
    sites.map(async (site) => {
      const out: CommonsImage[] = [];
      try {
        if (site.kit) {
          if (!site.kit.test(game)) return out;
          const page = site.url(query);
          for (const item of parsePressKit(await get(page), site, page).slice(
            0,
            max,
          ))
            out.push(pressImage(site, item, item.images[0]!));
          return out;
        }
        const posts = pressPosts(
          parsePressFeed(await get(site.url(query)), site),
          game,
        );
        for (const post of posts.slice(0, 4)) {
          let urls = post.images;
          if (!urls.length && site.shareImage) {
            const og = shareImageOf(
              await get(post.link).catch(() => ""),
              site.hosts,
            );
            urls = og ? [og] : [];
          }
          for (const u of urls.slice(0, perPost))
            out.push(pressImage(site, post, u));
          if (out.length >= max) break;
        }
      } catch (err) {
        log("info", "press site unavailable", {
          site: site.id,
          error: errorMessage(err),
        });
      }
      return out;
    }),
  );
  const out: CommonsImage[] = [];
  const longest = Math.max(0, ...perSite.map((l) => l.length));
  for (let i = 0; i < longest && out.length < max; i++)
    for (const l of perSite)
      if (
        i < l.length &&
        out.length < max &&
        !out.some((o) => o.url === l[i]!.url)
      )
        out.push(l[i]!);
  return out;
}

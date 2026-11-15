// Official media from a publisher's own website (15 Nov 2026, after "Why did Rockstar narrow GTA 6's roads?" went out on
// stills alone while YouTube blocked every trailer download). The publisher's site hosts the same trailers as files,
// and usually the full press screenshot pack, so the footage no longer depends on YouTube at all.
//
// Rockstar first:
//   GTA VI: rockstargames.com/VI/media lists the official downloads (trailer MP4s and the screenshot pack, a zip with
//           a folder per place and character), and the site's own short character clips (videos zip);
//   older games: the site's video API (graph.rockstargames.com, the query the site's own player sends) lists each
//           video with its downloadable files on Rockstar's CDN (GTA V's PS5 trailers and others).
// Official trailers only: "An Extended Look" (the 25-minute gameplay video, owner undecided), cover-art loops, pre-load
// adverts, editions, box fronts and wallpapers are left out by name. Another publisher's site is one more entry in
// PUBLISHER_SITES with its own list function; nothing else changes.
import { fetchWithTimeout, errorMessage, log } from "../lib/util.ts";
import { seriesNumber } from "./officialTrailer.ts";

export interface SiteAsset {
  /** A still, a video file, or a zip of stills ("pack") to unpack. */
  kind: "still" | "video" | "pack";
  url: string;
  /** A readable name: the file's title ("Launch Trailer", "Vice City 25"). */
  name: string;
  /** What the publisher's own naming says it shows: the place or character folder, "trailer". */
  tags: string[];
  publisher: string;
  /** Where it was listed: the page or API it came from. */
  listedAt: string;
}

export interface PublisherSite {
  publisher: string;
  /** The games this site has media for, by title match. */
  covers: (gameTitle: string) => boolean;
  list: (gameTitle: string, fetcher?: Fetcher) => Promise<SiteAsset[]>;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: Fetcher = (url, init) =>
  fetchWithTimeout(
    url,
    {
      ...init,
      headers: { "user-agent": "Mozilla/5.0", ...(init?.headers ?? {}) },
    },
    30_000,
  );

/** Names that are not official trailers or clean game media: never taken. */
export const NOT_MEDIA =
  /\b(extended[ _-]?look|cover[ _-]?art|pre[ _-]?load|fob|edition|bundle|poster|logo|wallpaper|benefits|vintage[ _-]vice[ _-]city[ _-]pack|pre[ _-]?order|merch|controller|console)\b/i;

const ROCKSTAR_CDN = "https://media-rockstargames-com.akamaized.net";

/** A file name as words: "Vice_City_25.jpg" is "Vice City 25". */
export function nameOf(file: string): string {
  return decodeURIComponent(file.split("/").pop() ?? file)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\.[0-9a-z~_.-]{8,}$/i, "") // the Next.js build hash on site images
    .replace(/[_]+/g, " ")
    .trim();
}

/**
 * The official downloads a Rockstar game page lists (pure): trailer MP4s and zips under
 * media-rockstargames-com.akamaized.net/<site>/downloads/, filtered to official trailers and screenshot packs.
 */
export function rockstarDownloads(
  html: string,
  site: string,
  pageUrl: string,
): SiteAsset[] {
  const out: SiteAsset[] = [];
  const seen = new Set<string>();
  const re = new RegExp(
    `${ROCKSTAR_CDN.replace(/[.]/g, "\\.")}/${site}/downloads/[^"'\\\\\\s)]+`,
    "g",
  );
  for (const url of html.match(re) ?? []) {
    if (seen.has(url)) continue;
    seen.add(url);
    const name = nameOf(url).replace(/^GTA ?VI /i, "");
    if (NOT_MEDIA.test(name) || NOT_MEDIA.test(url)) continue;
    if (/\.mp4$/i.test(url)) {
      if (!/trailer/i.test(name)) continue; // official trailers only
      out.push({
        kind: "video",
        url,
        name,
        tags: ["trailer"],
        publisher: "Rockstar Games",
        listedAt: pageUrl,
      });
    } else if (
      /screenshots?\/[^/]*screenshots?\.zip$/i.test(url) ||
      /\/videos\/[^/]*videos\.zip$/i.test(url)
    ) {
      out.push({
        kind: "pack",
        url,
        name,
        tags: [/videos\.zip$/i.test(url) ? "site clip" : "screenshot"],
        publisher: "Rockstar Games",
        listedAt: pageUrl,
      });
    }
  }
  return out;
}

/**
 * Trailers a game page does not list but its CDN holds under the same pattern (pure): GTA VI's Trailer 1 and 2 sit
 * beside the listed Launch Trailer as <site>/downloads/videos/<SITE>_Trailer_<n>/<SITE>_Trailer_<n>.mp4.
 */
export function rockstarTrailerGuesses(
  site: string,
  prefix: string,
  count = 4,
): SiteAsset[] {
  return Array.from({ length: count }, (_, i) => {
    const n = `${prefix}_Trailer_${i + 1}`;
    return {
      kind: "video" as const,
      url: `${ROCKSTAR_CDN}/${site}/downloads/videos/${n}/${n}.mp4`,
      name: `Trailer ${i + 1}`,
      tags: ["trailer"],
      publisher: "Rockstar Games",
      listedAt: `${ROCKSTAR_CDN}/${site}/downloads/videos/`,
    };
  });
}

/** The named stills a Rockstar game site shows (pure): "Vice_City_03.<hash>.jpg" with the place or person as its tag. */
export function rockstarSiteStills(
  html: string,
  base: string,
  pageUrl: string,
): SiteAsset[] {
  const out: SiteAsset[] = [];
  const seen = new Set<string>();
  for (const path of html.match(
    /\/[A-Za-z0-9]+\/_next\/static\/media\/[^"'\\\s)]+\.(?:jpe?g|png|webp)/g,
  ) ?? []) {
    const name = nameOf(path);
    // Only the named gallery pictures ("Ambrosia 01"); hashed UI art and the boxes are not game media.
    const m = name.match(/^([A-Za-z][A-Za-z ]+?) (\d{2})$/);
    if (!m || NOT_MEDIA.test(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({
      kind: "still",
      url: `${base}${path}`,
      name,
      tags: [m[1]!],
      publisher: "Rockstar Games",
      listedAt: pageUrl,
    });
  }
  return out;
}

export interface RockstarVideo {
  id: string;
  title: string;
  game?: string;
  files: Array<{
    resolution: string;
    src: string;
    downloadable?: boolean | null;
  }>;
}

/** The best file of a site video: 1080p if listed, else the largest under 2160p, else anything (pure). */
export function bestFile(files: RockstarVideo["files"]): string | undefined {
  const rank = (r: string) =>
    r === "1080p" ? 0 : r === "720p" ? 1 : r === "2160p" ? 2 : 3;
  return [...files].sort((a, b) => rank(a.resolution) - rank(b.resolution))[0]
    ?.src;
}

/** Whether a site video is an official trailer of exactly this game (pure): a series' other number never counts. */
export function trailerOfGame(
  v: Pick<RockstarVideo, "title" | "game">,
  gameTitle: string,
): boolean {
  if (!v.game || !/trailer/i.test(v.title) || NOT_MEDIA.test(v.title))
    return false;
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .trim();
  if (
    norm(v.game) !== norm(gameTitle) &&
    !(
      norm(gameTitle).includes(norm(v.game)) ||
      norm(v.game).includes(norm(gameTitle))
    )
  )
    return false;
  return seriesNumber(v.game) === seriesNumber(gameTitle);
}

const GRAPH = "https://graph.rockstargames.com/";

async function graph<T>(
  query: string,
  fetcher: Fetcher,
): Promise<T | undefined> {
  const res = await fetcher(GRAPH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`rockstar graph HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: unknown };
  return body.data ?? undefined;
}

/** Rockstar's site videos of a game with downloadable files: the official trailers only. */
export async function rockstarSiteTrailers(
  gameTitle: string,
  fetcher: Fetcher = defaultFetch,
): Promise<SiteAsset[]> {
  const list = await graph<{
    videos?: {
      results?: Array<{ id: string; title: string; game?: { title?: string } }>;
    };
  }>(
    `{ videos(locale:"en_us", limit:100) { results { id title game { title } } } }`,
    fetcher,
  );
  const out: SiteAsset[] = [];
  for (const v of list?.videos?.results ?? []) {
    if (!trailerOfGame({ title: v.title, game: v.game?.title }, gameTitle))
      continue;
    const id = String(v.id).replace(/[^a-z0-9]/gi, "");
    const one = await graph<{
      video?: RockstarVideo & { youtubeOnly?: boolean };
    }>(
      `{ video(id:"${id}", locale:"en_us") { id title files { resolution src downloadable } } }`,
      fetcher,
    ).catch(() => undefined);
    const src = bestFile(one?.video?.files ?? []);
    if (!src) continue;
    out.push({
      kind: "video",
      url: src,
      name: v.title,
      tags: ["trailer"],
      publisher: "Rockstar Games",
      listedAt: `https://www.rockstargames.com/videos/${id}`,
    });
  }
  return out;
}

/** The Rockstar game sites with a media page of their own, by the game they cover. */
const ROCKSTAR_GAME_SITES: Array<{
  match: RegExp;
  site: string;
  prefix: string;
}> = [
  {
    match: /\b(grand theft auto (vi|6)|gta ?(vi|6))\b/i,
    site: "VI",
    prefix: "GTAVI",
  },
];

export const PUBLISHER_SITES: PublisherSite[] = [
  {
    publisher: "Rockstar Games",
    covers: (g) =>
      /\b(grand theft auto|gta|red dead|max payne|bully|l\.?a\.? noire)\b/i.test(
        g,
      ),
    list: async (gameTitle, fetcher = defaultFetch) => {
      const out: SiteAsset[] = [];
      const gameSite = ROCKSTAR_GAME_SITES.find((s) => s.match.test(gameTitle));
      if (gameSite) {
        for (const page of ["media", "", "only-in-leonida", "launch-gallery"]) {
          const url = `https://www.rockstargames.com/${gameSite.site}${page ? `/${page}` : ""}`;
          try {
            const res = await fetcher(url);
            if (!res.ok) continue;
            const html = await res.text();
            if (page === "media")
              out.push(...rockstarDownloads(html, gameSite.site, url));
            out.push(
              ...rockstarSiteStills(html, "https://www.rockstargames.com", url),
            );
          } catch (err) {
            log("warn", "publisher site page failed", {
              url,
              error: errorMessage(err),
            });
          }
        }
        // The numbered trailers the page leaves out; each is checked before it is downloaded (a 404 is skipped).
        for (const g of rockstarTrailerGuesses(gameSite.site, gameSite.prefix))
          if (!out.some((o) => o.url === g.url)) out.push(g);
      } else {
        out.push(
          ...(await rockstarSiteTrailers(gameTitle, fetcher).catch((err) => {
            log("warn", "rockstar site trailers failed", {
              game: gameTitle,
              error: errorMessage(err),
            });
            return [] as SiteAsset[];
          })),
        );
      }
      const seen = new Set<string>();
      return out.filter((a) =>
        seen.has(a.url) ? false : (seen.add(a.url), true),
      );
    },
  },
];

/** The publisher site that covers this game, if any. */
export function siteFor(gameTitle: string): PublisherSite | undefined {
  return PUBLISHER_SITES.find((s) => s.covers(gameTitle));
}

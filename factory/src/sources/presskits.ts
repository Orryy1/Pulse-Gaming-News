// Official press kits (PRESS_KITS, 20 Nov 2026). Owner: more rights-safe, high-quality pictures. The publishers' and
// platform holders' own media galleries, the ones published for the press to use in coverage, harvested per game and
// indexed with each asset's terms of use. Only an asset whose source's terms allow editorial or press use is kept,
// and the picture choice ranks these above every other still source, wikis included (src/assets/gamelib.ts
// sourceBonus; src/services.ts searchPress puts indexed kit pictures first).
//
// Every source below was checked by hand on 20 Nov 2026: its robots.txt, whether it sits behind a login, and the
// terms its owner publishes. The checks are recorded in the registry itself, so the index carries them with every
// asset. Fetching goes through src/sources/polite.ts (robots.txt, a pace per host, no login walls).
//
// Harvested automatically:
//   Rockstar Games   rockstargames.com/<game>/media and gallery pages: the official screenshot pack, trailers and named
//                    gallery stills (src/assets/publishersite.ts does the listing).
//   Xbox Wire        news.xbox.com search feed: Xbox and Bethesda posts (no robots.txt; Microsoft's Game Content Usage
//                    Rules allow YouTube partner-programme revenue).
//   PlayStation Blog the main feed only, pictures on PlayStation's Flickr only: robots.txt forbids /search/ and the
//                    /tachyon/ image resizer to every reader but named social previewers.
//   Sony Interactive press releases (search feed, share image).
//   CD PROJEKT RED   media news (search feed, share image); its fan content guidelines allow partner-programme revenue.
//   Valve            the Steam Deck press kit page.
// Checked and not harvested (recorded so nobody tries again without a reason): Nintendo and Capcom (press.nintendo.com
// and press.capcom.com: registered press only), EA (press.ea.com, PressXtra sign-in), Ubisoft and Bandai Namco America
// (registration and approval), Bandai Namco Europe (robots.txt reserves all text and data mining under Article 4 of
// EU Directive 2019/790), Square Enix (no public press gallery; per-game material guidelines only), Sega (sega.com
// answered robots.txt with HTTP 429), Bethesda (covered by Xbox Wire).

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { canonicalGame } from "../assets/gamelib.ts";
import { sceneSlug } from "../sceneindex/schema.ts";
import {
  gameWords,
  parsePressFeed,
  parsePressKit,
  PRESS_SITES,
  pressPosts,
  shareImageOf,
  type PressItem,
  type PressSite,
} from "../assets/press.ts";
import { siteFor, type SiteAsset } from "../assets/publishersite.ts";
import type { CommonsImage } from "../assets/commons.ts";
import { errorMessage, log } from "../lib/util.ts";
import { sharedPolite, RobotsRefused, type PoliteFetch } from "./polite.ts";

export const PRESS_KIT_VERSION = 1;
export const TERMS_CHECKED = "2026-11-20";

export type AllowedUse = "editorial" | "none";

export interface PressKitTerms {
  /** Where the owner's terms (or the page itself) can be read. */
  url: string;
  /** What the terms allow, in a line. */
  summary: string;
  /** The owner's own words, when the terms state them. */
  quote?: string;
  allowedUse: AllowedUse;
  checked: string;
}

export type Access =
  | "auto" // harvested
  | "login" // behind a press login or registration
  | "tdm-reserved" // robots.txt reserves text and data mining
  | "unavailable" // no public gallery, or the host turned us away
  | "via-other"; // covered by another source

export interface PressKitSource {
  id: string;
  publisher: string;
  site: string;
  access: Access;
  terms: PressKitTerms;
  note?: string;
  /** The assets this source offers for a game (auto sources only). */
  list?: (game: string, fetch: PoliteFetch) => Promise<RawAsset[]>;
}

export type AssetKind = "screenshot" | "key_art" | "logo" | "video" | "pack";

/** What a source lists before it is classified and given its terms. */
export interface RawAsset {
  url: string;
  pageUrl: string;
  title: string;
  /** The publisher's own naming: a place or character folder, "trailer". */
  tags: string[];
  kind?: AssetKind;
}

export interface PressKitAsset {
  id: string;
  url: string;
  pageUrl: string;
  title: string;
  kind: AssetKind;
  game: string;
  /** The places, characters and things the publisher filed it under, plus the game. */
  entities: string[];
  sourceId: string;
  publisher: string;
  terms: Pick<PressKitTerms, "url" | "summary" | "allowedUse" | "checked">;
  listedAt: string;
}

export interface SourceRun {
  id: string;
  status: "ok" | "none" | "refused" | "failed" | "skipped";
  count: number;
  note?: string;
}

export interface PressKitIndex {
  version: number;
  game: string;
  updatedAt: string;
  assets: PressKitAsset[];
  sources: SourceRun[];
}

// ---------------------------------------------------------------- feed sources (shared with src/assets/press.ts)

/** A WordPress feed source: the feed's posts about the game, the site's own pictures in each (share image if none). */
function feedSource(site: PressSite, feedUrl: (q: string) => string) {
  return async (game: string, fetch: PoliteFetch): Promise<RawAsset[]> => {
    const query = gameWords(game).join(" ");
    if (!query) return [];
    const res = await fetch(feedUrl(query));
    if (!res.ok) return [];
    const posts = pressPosts(
      parsePressFeed(await res.text(), site),
      game,
    ).slice(0, 6);
    const out: RawAsset[] = [];
    for (const post of posts) {
      let urls = post.images;
      if (!urls.length && site.shareImage) {
        const page = await fetch(post.link)
          .then((r) => (r.ok ? r.text() : ""))
          .catch(() => "");
        const og = shareImageOf(page, site.hosts);
        urls = og ? [og] : [];
      }
      for (const u of urls.slice(0, 6))
        out.push({ url: u, pageUrl: post.link, title: post.title, tags: [] });
    }
    return out;
  };
}

function kitSource(site: PressSite, page: string, about: RegExp) {
  return async (game: string, fetch: PoliteFetch): Promise<RawAsset[]> => {
    if (!about.test(game)) return [];
    const res = await fetch(page);
    if (!res.ok) return [];
    return parsePressKit(await res.text(), site, page).map((i: PressItem) => ({
      url: i.images[0]!,
      pageUrl: page,
      title: i.title,
      tags: [],
    }));
  };
}

/** The press sites src/assets/press.ts already reads, by id (one definition of each site, its feed and its picture hosts). */
const site = (id: string): PressSite => {
  const s = PRESS_SITES.find((x) => x.id === id);
  if (!s) throw new Error(`no press site ${id}`);
  return s;
};
const XBOX = site("xbox");
const PLAYSTATION = site("playstation");
const SIE = site("sie");
const CDPR = site("cdprojekt");
const STEAMDECK = site("steamdeck");

/** Rockstar's own media pages through the publisher-site lister; zips stay packs (unpacked by the library tool). */
async function rockstarList(
  game: string,
  fetch: PoliteFetch,
): Promise<RawAsset[]> {
  const site = siteFor(game);
  if (!site || site.publisher !== "Rockstar Games") return [];
  const listed: SiteAsset[] = await site.list(game, (u, init) =>
    fetch(u, init),
  );
  return listed.map((a) => ({
    url: a.url,
    pageUrl: a.listedAt,
    title: a.name,
    tags: a.tags,
    kind: a.kind === "pack" ? "pack" : a.kind === "video" ? "video" : undefined,
  }));
}

const editorial = (
  url: string,
  summary: string,
  quote?: string,
): PressKitTerms => ({
  url,
  summary,
  ...(quote ? { quote } : {}),
  allowedUse: "editorial",
  checked: TERMS_CHECKED,
});
const notUsed = (
  url: string,
  summary: string,
  quote?: string,
): PressKitTerms => ({
  url,
  summary,
  ...(quote ? { quote } : {}),
  allowedUse: "none",
  checked: TERMS_CHECKED,
});

export const PRESS_KIT_SOURCES: PressKitSource[] = [
  {
    id: "rockstar",
    publisher: "Rockstar Games",
    site: "Rockstar Games media and downloads pages",
    access: "auto",
    terms: editorial(
      "https://www.rockstargames.com/VI/media",
      "Official downloads Rockstar offers publicly on its own media page, used editorially in news coverage and credited; Rockstar's separate video policy for players' own footage is non-commercial, so its gameplay is never re-used beyond the press assets.",
    ),
    list: rockstarList,
  },
  {
    id: "xbox",
    publisher: "Xbox",
    site: "Xbox Wire",
    access: "auto",
    terms: editorial(
      "https://www.xbox.com/en-US/developers/rules",
      "Microsoft's Game Content Usage Rules let videos using its game content earn partner-programme revenue on YouTube; Xbox Wire posts are its newsroom.",
      "You may make your Item available on Youtube or Twitch",
    ),
    list: feedSource(XBOX, XBOX.url),
  },
  {
    id: "playstation",
    publisher: "PlayStation",
    site: "PlayStation Blog",
    access: "auto",
    terms: editorial(
      "https://blog.playstation.com/robots.txt",
      "PlayStation's official blog for announcements; only the main feed and PlayStation's Flickr pictures, because robots.txt forbids /search/ and /tachyon/ to automated readers.",
    ),
    note: "robots.txt: Disallow /search/, /tachyon/, /?s=*, /tag/, /category/ for User-agent *; Crawl-delay 5",
    list: feedSource(PLAYSTATION, PLAYSTATION.url),
  },
  {
    id: "sie",
    publisher: "Sony Interactive",
    site: "Sony Interactive Entertainment press releases",
    access: "auto",
    terms: editorial(
      "https://sonyinteractive.com/en/press-releases/",
      "Sony Interactive's own press releases, issued for the press; the share image of each release.",
    ),
    list: feedSource(SIE, SIE.url),
  },
  {
    id: "cdprojekt",
    publisher: "CD PROJEKT RED",
    site: "CD PROJEKT RED media news",
    access: "auto",
    terms: editorial(
      "https://www.cdprojektred.com/en/fan-content",
      "CD PROJEKT RED's fan content guidelines allow partner-programme revenue on YouTube; its media news is issued for the press.",
      "We're cool with you monetising your videos and streams via the YouTube and Twitch partner programs",
    ),
    list: feedSource(CDPR, CDPR.url),
  },
  {
    id: "steamdeck",
    publisher: "Valve",
    site: "the Steam Deck press kit",
    access: "auto",
    terms: editorial(
      "https://www.steamdeck.com/en/press",
      "Valve's press page for Steam Deck: renderings, photos and logos offered for download to the press (no further licence text on the page).",
    ),
    list: kitSource(STEAMDECK, STEAMDECK.url(""), /\bsteam ?deck\b/i),
  },
  {
    id: "nintendo",
    publisher: "Nintendo",
    site: "press.nintendo.com",
    access: "login",
    terms: notUsed(
      "https://press.nintendo.com/",
      "Registered press only: assets sit behind a press login.",
    ),
    note: "robots.txt: Disallow /Files/Download, Crawl-Delay 5",
  },
  {
    id: "capcom",
    publisher: "Capcom",
    site: "press.capcom.com",
    access: "login",
    terms: notUsed(
      "https://press.capcom.com/",
      "Registered press only (the same press platform as Nintendo's).",
    ),
    note: "robots.txt: Disallow /Files/Download, Crawl-Delay 5",
  },
  {
    id: "ea",
    publisher: "Electronic Arts",
    site: "press.ea.com (PressXtra)",
    access: "login",
    terms: notUsed(
      "https://press.ea.com/",
      "PressXtra press portal: sign-in required.",
    ),
  },
  {
    id: "ubisoft",
    publisher: "Ubisoft",
    site: "Ubisoft press",
    access: "login",
    terms: notUsed(
      "https://news.ubisoft.com/",
      "Press assets need registration; the public news site has no feed.",
    ),
  },
  {
    id: "bandainamco-us",
    publisher: "Bandai Namco",
    site: "Bandai Namco Entertainment America press room",
    access: "login",
    terms: notUsed(
      "https://www.bandainamcoent.com/press-center",
      "Static assets need registration and approval.",
    ),
  },
  {
    id: "bandainamco-eu",
    publisher: "Bandai Namco",
    site: "en.bandainamcoent.eu press kits",
    access: "tdm-reserved",
    terms: notUsed(
      "https://en.bandainamcoent.eu/robots.txt",
      "Public per-game press kits, but robots.txt reserves all text and data mining, so nothing is fetched automatically.",
      "BNE expressly reserves all rights concerning the use of this website for text and data mining.",
    ),
  },
  {
    id: "squareenix",
    publisher: "Square Enix",
    site: "square-enix-games.com",
    access: "unavailable",
    terms: notUsed(
      "https://square-enix-games.com/documents/final-fantasy-vii-material-usage-guidelines",
      "No public press gallery found; per-game material guidelines allow partner-programme monetisation of fan videos only.",
    ),
  },
  {
    id: "sega",
    publisher: "Sega",
    site: "sega.com",
    access: "unavailable",
    terms: notUsed(
      "https://www.sega.com/robots.txt",
      "robots.txt answered HTTP 429 on 20 Nov 2026: not asked again.",
    ),
  },
  {
    id: "bethesda",
    publisher: "Bethesda",
    site: "bethesda.net",
    access: "via-other",
    terms: notUsed(
      "https://news.xbox.com/",
      "Bethesda's announcements come through Xbox Wire, harvested there.",
    ),
  },
];

// ---------------------------------------------------------------- classification (pure)

/** What an asset is, from its kind, file name and title (pure). */
export function assetKind(
  a: Pick<RawAsset, "url" | "title" | "kind" | "tags">,
): AssetKind {
  if (a.kind) return a.kind;
  const t =
    `${a.title} ${decodeURIComponent(a.url.split("/").pop() ?? "")}`.toLowerCase();
  if (/\.(mp4|webm|mov)(\?|$)/.test(a.url)) return "video";
  if (/\blogo|wordmark|logotype/.test(t)) return "logo";
  if (
    /key ?art|keyart|cover|box ?art|hero|poster|wallpaper|artwork|render/.test(
      t,
    )
  )
    return "key_art";
  return "screenshot";
}

/** The entities an asset is filed under (pure): the publisher's own tags and the game. */
export function assetEntities(
  game: string,
  a: Pick<RawAsset, "tags">,
): string[] {
  const out = [canonicalGame(game)];
  for (const t of a.tags)
    if (
      t &&
      !/^(screenshot|trailer|site clip|people|places)$/i.test(t) &&
      !out.includes(t)
    )
      out.push(t);
  return out;
}

export const assetId = (url: string): string =>
  crypto.createHash("sha1").update(url).digest("hex").slice(0, 12);

/** A source's listed assets as index entries, only when its terms allow editorial use (pure). */
export function toAssets(
  game: string,
  src: PressKitSource,
  raw: RawAsset[],
): PressKitAsset[] {
  if (src.terms.allowedUse !== "editorial") return [];
  const seen = new Set<string>();
  const out: PressKitAsset[] = [];
  for (const r of raw) {
    if (!/^https:\/\//.test(r.url) || seen.has(r.url)) continue;
    seen.add(r.url);
    const { url: tUrl, summary, allowedUse, checked } = src.terms;
    out.push({
      id: assetId(r.url),
      url: r.url,
      pageUrl: r.pageUrl,
      title: r.title,
      kind: assetKind(r),
      game: canonicalGame(game),
      entities: assetEntities(game, r),
      sourceId: src.id,
      publisher: src.publisher,
      terms: { url: tUrl, summary, allowedUse, checked },
      listedAt: new Date().toISOString(),
    });
  }
  return out;
}

// ---------------------------------------------------------------- harvest and index

export interface HarvestOptions {
  fetch?: PoliteFetch;
  sources?: PressKitSource[];
  /** At most this many assets from one source (default 200). */
  perSource?: number;
}

/** Every auto source's assets for a game, each source asked once; a refused or failing source gives nothing. */
export async function harvestPressKits(
  game: string,
  o: HarvestOptions = {},
): Promise<PressKitIndex> {
  const fetch = o.fetch ?? sharedPolite();
  const assets: PressKitAsset[] = [];
  const sources: SourceRun[] = [];
  for (const src of o.sources ?? PRESS_KIT_SOURCES) {
    if (src.access !== "auto" || !src.list) {
      sources.push({
        id: src.id,
        status: "skipped",
        count: 0,
        note: `${src.access}: ${src.terms.summary}`,
      });
      continue;
    }
    try {
      const got = toAssets(game, src, await src.list(game, fetch)).slice(
        0,
        o.perSource ?? 200,
      );
      for (const a of got)
        if (!assets.some((x) => x.url === a.url)) assets.push(a);
      sources.push({
        id: src.id,
        status: got.length ? "ok" : "none",
        count: got.length,
      });
    } catch (err) {
      const refused = err instanceof RobotsRefused;
      sources.push({
        id: src.id,
        status: refused ? "refused" : "failed",
        count: 0,
        note: errorMessage(err).slice(0, 200),
      });
      log("info", "press kit source gave nothing", {
        source: src.id,
        game,
        error: errorMessage(err),
      });
    }
  }
  return {
    version: PRESS_KIT_VERSION,
    game: canonicalGame(game),
    updatedAt: new Date().toISOString(),
    assets,
    sources,
  };
}

export function pressKitRoot(dataDir: string): string {
  return process.env.PRESS_KIT_DIR || path.join(dataDir, "presskits");
}

export function pressKitFile(root: string, game: string): string {
  return path.join(root, `${sceneSlug(canonicalGame(game))}.json`);
}

export async function readPressIndex(
  root: string,
  game: string,
): Promise<PressKitIndex | undefined> {
  try {
    const idx = JSON.parse(
      await fs.readFile(pressKitFile(root, game), "utf8"),
    ) as PressKitIndex;
    return idx.version === PRESS_KIT_VERSION && Array.isArray(idx.assets)
      ? idx
      : undefined;
  } catch {
    return undefined;
  }
}

/** Writes a game's index, keeping assets found before that this run did not see (a feed only shows recent posts). */
export async function writePressIndex(
  root: string,
  idx: PressKitIndex,
): Promise<PressKitIndex> {
  const old = await readPressIndex(root, idx.game);
  const merged: PressKitIndex = {
    ...idx,
    assets: [
      ...idx.assets,
      ...(old?.assets ?? []).filter(
        (a) => !idx.assets.some((n) => n.url === a.url),
      ),
    ],
  };
  await fs.mkdir(root, { recursive: true });
  const file = pressKitFile(root, idx.game);
  // A temporary name of its own, so a hand run and a background refresh never write the same file at once.
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(merged, null, 1), "utf8");
  await fs.rename(tmp, file);
  return merged;
}

/** Entity to assets (pure): "Vice City" to every still the publisher filed under it. */
export function entityIndex(
  idx: Pick<PressKitIndex, "assets">,
): Map<string, PressKitAsset[]> {
  const out = new Map<string, PressKitAsset[]>();
  for (const a of idx.assets)
    for (const e of a.entities) {
      const k = e.toLowerCase();
      out.set(k, [...(out.get(k) ?? []), a]);
    }
  return out;
}

/** The provenance line a kit picture carries: whose kit, what its terms allow, where they are written. */
export function kitProvenance(a: PressKitAsset): string {
  return `Press image from ${a.publisher} press (press kit; ${a.terms.summary.split(";")[0]!.slice(0, 160)}; terms ${a.terms.url}, checked ${a.terms.checked}): ${a.pageUrl} [${a.url}]`;
}

/**
 * A game's indexed kit pictures as the photo pipeline carries them (source "press", credited "Image: <publisher>
 * press"), screenshots and key art first, logos and packs left out (pure).
 */
export function kitImages(
  idx: PressKitIndex | undefined,
  max = 8,
): CommonsImage[] {
  if (!idx) return [];
  const rank = (k: AssetKind) =>
    k === "screenshot" ? 0 : k === "key_art" ? 1 : 9;
  return (
    idx.assets
      .filter(
        (a) =>
          a.terms.allowedUse === "editorial" &&
          (a.kind === "screenshot" || a.kind === "key_art"),
      )
      .filter((a) => /\.(jpe?g|png|webp)(\?|#|$)/i.test(a.url))
      // The newest harvest first (the latest announcement's pictures), screenshots before key art within it.
      .sort(
        (a, b) =>
          b.listedAt.slice(0, 10).localeCompare(a.listedAt.slice(0, 10)) ||
          rank(a.kind) - rank(b.kind),
      )
      .slice(0, max)
      .map((a) => ({
        title: a.title,
        url: a.url,
        width: 0,
        height: 0,
        artist: a.publisher,
        license: `editorial use, offered to the press (${a.terms.url})`,
        pageUrl: a.pageUrl,
        description: a.title,
        source: "press" as const,
        via: a.publisher,
      }))
  );
}

/**
 * A game's press pictures for a news Short: its indexed press kit pictures first (PRESS_KITS), then the live press
 * feeds (LIBRARY_PRESS), each picture once, at most `max`. Never throws.
 */
export async function pressWithKits(o: {
  root: string;
  game: string;
  kits: boolean;
  live?: () => Promise<CommonsImage[]>;
  max?: number;
}): Promise<CommonsImage[]> {
  const max = o.max ?? 8;
  const kit = o.kits
    ? kitImages(
        await readPressIndex(o.root, o.game).catch(() => undefined),
        max,
      )
    : [];
  const live = o.live ? await o.live().catch(() => [] as CommonsImage[]) : [];
  const out: CommonsImage[] = [];
  for (const i of [...kit, ...live])
    if (out.length < max && !out.some((x) => x.url === i.url)) out.push(i);
  return out;
}

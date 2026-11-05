// Official trailers from a publisher's own YouTube channel, for games that
// are not on Steam (console-only titles such as GTA VI). Only channels that
// match a known publisher by name and size are accepted, never a reupload;
// the footage then goes through the same keyframe matching as Steam trailers
// and the same per-publisher budget.

import fs from "node:fs/promises";
import path from "node:path";
import { runCapped } from "../lib/child.ts";
import { fetchWithTimeout, log, errorMessage } from "../lib/util.ts";
import { YTDLP_TEXT } from "../lib/bin.ts";
import { matchClips, type FootageTarget } from "./clipscore.ts";
import { stillBigText } from "./cliptext.ts";
import type { VisualAsset } from "./steam.ts";
import type { Llm } from "../editorial/llm.ts";

// Every child (yt-dlp, ffmpeg) runs under the download cap and is killed on overrun (src/lib/child.ts).
const run = runCapped;
const API = "https://www.googleapis.com/youtube/v3";

export interface PublisherRule {
  match: RegExp; // channel title
  name: string;
  minSubscribers: number;
  clipSeconds: number; // 0 = stills only
}

/** Publisher channels the factory may take footage from, with the per-Short footage cap. */
export const PUBLISHER_CHANNELS: PublisherRule[] = [
  {
    match: /^rockstar games$/i,
    name: "Rockstar Games",
    minSubscribers: 1_000_000,
    clipSeconds: 10, // the same cap as ROCKSTAR_FOOTAGE_SECONDS (src/assets/footage.ts); this line said 6 until 5 Nov 2026
  },
  {
    match: /^nintendo( of america| uk| europe)?$/i,
    name: "Nintendo",
    minSubscribers: 1_000_000,
    clipSeconds: 0,
  },
  {
    match: /^playstation( uk| europe)?$/i,
    name: "PlayStation",
    minSubscribers: 1_000_000,
    clipSeconds: 14,
  },
  {
    match: /^xbox( uk)?$/i,
    name: "Xbox",
    minSubscribers: 1_000_000,
    clipSeconds: 14,
  },
  {
    match: /^bethesda softworks$/i,
    name: "Bethesda",
    minSubscribers: 500_000,
    clipSeconds: 14,
  },
  {
    match: /^ubisoft( north america| uk)?$/i,
    name: "Ubisoft",
    minSubscribers: 500_000,
    clipSeconds: 8,
  },
  {
    match: /^(ea|electronic arts|ea sports|ea sports fc|battlefield)$/i,
    name: "EA",
    minSubscribers: 500_000,
    clipSeconds: 14,
  },
  {
    match: /^activision$/i,
    name: "Activision",
    minSubscribers: 500_000,
    clipSeconds: 14,
  },
  {
    match: /^call of duty$/i,
    name: "Activision",
    minSubscribers: 500_000,
    clipSeconds: 14,
  },
  {
    match: /^capcom( usa| uk| europe)?$/i,
    name: "Capcom",
    minSubscribers: 300_000,
    clipSeconds: 14,
  },
  {
    match: /^square enix( na| europe)?$/i,
    name: "Square Enix",
    minSubscribers: 300_000,
    clipSeconds: 14,
  },
  {
    match: /^sega( europe| america)?$/i,
    name: "Sega",
    minSubscribers: 300_000,
    clipSeconds: 14,
  },
  {
    match: /^bandai namco entertainment( america| europe)?$/i,
    name: "Bandai Namco",
    minSubscribers: 300_000,
    clipSeconds: 14,
  },
  {
    match: /^epic games$/i,
    name: "Epic Games",
    minSubscribers: 300_000,
    clipSeconds: 14,
  },
  { match: /^2k$/i, name: "2K", minSubscribers: 300_000, clipSeconds: 14 },
  {
    match: /^cd projekt red$/i,
    name: "CD Projekt Red",
    minSubscribers: 300_000,
    clipSeconds: 14,
  },
  {
    match: /^fromsoftware$/i,
    name: "FromSoftware",
    minSubscribers: 100_000,
    clipSeconds: 14,
  },
  {
    match: /^warner bros\.? games$/i,
    name: "Warner Bros. Games",
    minSubscribers: 300_000,
    clipSeconds: 14,
  },
];

/** Who owns the footage, by franchise: a PlayStation upload of a Rockstar trailer is still Rockstar footage. */
export const FRANCHISE_PUBLISHERS: Array<{ match: RegExp; name: string }> = [
  {
    match:
      /\b(grand theft auto|gta|red dead|max payne|bully|l\.?a\.? noire|midnight club)\b/i,
    name: "Rockstar Games",
  },
  {
    match:
      /\b(mario|zelda|pok[eé]mon|metroid|kirby|splatoon|animal crossing|fire emblem|pikmin|donkey kong|xenoblade|smash bros|nintendo|luigi|yoshi)\b/i,
    name: "Nintendo",
  },
  {
    match: /\b(call of duty|warzone|black ops|modern warfare)\b/i,
    name: "Activision",
  },
  {
    match:
      /\b(assassin'?s creed|far cry|rainbow six|ghost recon|watch dogs|the division|anno|prince of persia|beyond good)\b/i,
    name: "Ubisoft",
  },
  {
    match:
      /\b(battlefield|ea sports|fc 2\d|madden|apex legends|the sims|mass effect|dragon age|need for speed|skate)\b/i,
    name: "EA",
  },
  {
    match:
      /\b(elder scrolls|fallout|starfield|doom|wolfenstein|dishonored|indiana jones)\b/i,
    name: "Bethesda",
  },
  {
    match:
      /\b(halo|forza|gears of war|fable|flight simulator|sea of thieves|state of decay|avowed|hellblade)\b/i,
    name: "Xbox",
  },
  {
    match:
      /\b(god of war|the last of us|uncharted|horizon|ghost of|spider-man|ratchet|gran turismo|marathon|helldivers|astro bot)\b/i,
    name: "PlayStation",
  },
  {
    match:
      /\b(resident evil|monster hunter|street fighter|devil may cry|dragon'?s dogma|mega man|okami|pragmata)\b/i,
    name: "Capcom",
  },
  {
    match: /\b(final fantasy|kingdom hearts|dragon quest|nier|tomb raider)\b/i,
    name: "Square Enix",
  },
  {
    match:
      /\b(sonic|yakuza|like a dragon|persona|metaphor|total war|football manager)\b/i,
    name: "Sega",
  },
  {
    match:
      /\b(elden ring|dark souls|armored core|sekiro|bloodborne|nightreign|duskbloods)\b/i,
    name: "FromSoftware",
  },
  {
    match: /\b(tekken|dragon ball|naruto|ace combat|elden ring)\b/i,
    name: "Bandai Namco",
  },
  { match: /\b(fortnite|unreal)\b/i, name: "Epic Games" },
  { match: /\b(cyberpunk|witcher)\b/i, name: "CD Projekt Red" },
  {
    match:
      /\b(hogwarts legacy|mortal kombat|batman|arkham|injustice|wonder woman)\b/i,
    name: "Warner Bros. Games",
  },
  {
    match: /\b(borderlands|mafia|bioshock|nba 2k|wwe 2k|civilization|xcom)\b/i,
    name: "2K",
  },
];

export function franchisePublisher(gameTitle: string): string | undefined {
  return FRANCHISE_PUBLISHERS.find((f) => f.match.test(gameTitle))?.name;
}

export interface OfficialTrailer {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publisher: string;
  clipSeconds: number;
  publishedAt: string;
}

const EXCLUDE =
  /\b(reaction|reacts?|breakdown|analysis|explained|review|leak|leaked|fan[- ]?made|concept|remake|recreated|in real life|parody|react)\b/i;

/** Candidate ranking: a trailer from a known publisher, titled as a trailer, naming the game, newest first. */
const SERIES_NUMERAL: Record<string, number> = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 };

/** The instalment a title names: "Grand Theft Auto IV" is 4, "Grand Theft Auto: Vice City" none. */
export function seriesNumber(title: string): number | undefined {
  // A platform's number is not the game's: "Ocarina of Time - Nintendo Switch 2" has no instalment number.
  const name = title
    .toLowerCase()
    .replace(/\b(?:nintendo\s+)?switch\s*2\b|\bps\s?[2-5]\b|\bplaystation\s*[2-5]\b|\bxbox\s+series\s+[xs]\b|\bsteam\s+deck\b/g, " ");
  for (const w of name.split(/[^a-z0-9]+/))
    if (SERIES_NUMERAL[w] !== undefined) return SERIES_NUMERAL[w];
  return undefined;
}

export function pickOfficial(
  items: Array<{
    videoId: string;
    title: string;
    channelId: string;
    channelTitle: string;
    publishedAt: string;
  }>,
  gameTitle: string,
  subscribers: Map<string, number>,
): OfficialTrailer | undefined {
  const game = gameTitle.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  const owner = franchisePublisher(gameTitle);
  const ownerRule = owner
    ? PUBLISHER_CHANNELS.find((r) => r.name === owner)
    : undefined;
  const tokens = game.split(/\s+/).filter((t) => t.length > 2);
  const scored = items
    .map((it) => {
      const rule = PUBLISHER_CHANNELS.find((r) =>
        r.match.test(it.channelTitle.trim()),
      );
      if (!rule) return undefined;
      if ((subscribers.get(it.channelId) ?? 0) < rule.minSubscribers)
        return undefined;
      const t = it.title.toLowerCase();
      if (EXCLUDE.test(t)) return undefined;
      // A series' other instalment is the wrong game: "GTA IV" must never take GTA VI's launch trailer.
      const wanted = seriesNumber(gameTitle);
      const shown = seriesNumber(it.title);
      if (shown !== wanted && (shown !== undefined || wanted !== undefined)) return undefined;
      const named =
        tokens.filter((tok) => t.includes(tok)).length /
        Math.max(1, tokens.length);
      if (named < 0.5) return undefined;
      const score =
        (/\btrailer\b/.test(t) ? 2 : 0) +
        (/\b(launch|official|reveal|announce|gameplay)\b/.test(t) ? 1 : 0) +
        (owner && rule.name === owner ? 3 : 0) + // the franchise's own channel beats a platform's copy
        named;
      return { it, rule, score };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort(
      (a, b) =>
        b.score - a.score || b.it.publishedAt.localeCompare(a.it.publishedAt),
    );
  const best = scored[0];
  if (!best) return undefined;
  return {
    videoId: best.it.videoId,
    title: best.it.title,
    channelId: best.it.channelId,
    channelTitle: best.it.channelTitle,
    publisher: owner ?? best.rule.name,
    // The stricter of the hosting channel's cap and the footage owner's cap.
    clipSeconds: Math.min(
      best.rule.clipSeconds,
      ownerRule?.clipSeconds ?? best.rule.clipSeconds,
    ),
    publishedAt: best.it.publishedAt,
  };
}

/** Finds the game's official trailer on YouTube (search 100 units + channels 1 unit). */
type SearchItem = {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
};

/** One YouTube search (100 units) plus the channels' audience sizes (1 unit). */
async function searchVideos(
  token: () => Promise<string>,
  query: string,
  extra = "",
): Promise<{ items: SearchItem[]; subscribers: Map<string, number> }> {
  const auth = { headers: { authorization: `Bearer ${await token()}` } };
  const q = encodeURIComponent(query.replace(/\s+/g, " ").trim());
  const res = await fetchWithTimeout(
    `${API}/search?part=snippet&type=video&maxResults=15&order=relevance&q=${q}${extra}`,
    auth,
    20_000,
  );
  if (!res.ok) throw new Error(`youtube search HTTP ${res.status}`);
  const items: SearchItem[] = (((await res.json()) as any).items ?? [])
    .map((i: any) => ({
      videoId: i.id?.videoId as string,
      title: String(i.snippet?.title ?? ""),
      channelId: String(i.snippet?.channelId ?? ""),
      channelTitle: String(i.snippet?.channelTitle ?? ""),
      publishedAt: String(i.snippet?.publishedAt ?? ""),
    }))
    .filter((i: SearchItem) => i.videoId);
  const channelIds = [...new Set(items.map((i) => i.channelId))].filter(
    Boolean,
  );
  const subscribers = new Map<string, number>();
  if (channelIds.length) {
    const ch = await fetchWithTimeout(
      `${API}/channels?part=statistics&id=${channelIds.join(",")}`,
      auth,
      20_000,
    );
    if (ch.ok)
      for (const c of ((await ch.json()) as any).items ?? [])
        subscribers.set(c.id, Number(c.statistics?.subscriberCount ?? 0));
  }
  return { items, subscribers };
}

/** Finds the game's official trailer on YouTube (search 100 units + channels 1 unit). */
export async function findOfficialTrailer(
  token: () => Promise<string>,
  gameTitle: string,
  hint = "", // e.g. the release year, to steer a short or reused title ("Resident Evil" 2002)
): Promise<OfficialTrailer | undefined> {
  const { items, subscribers } = await searchVideos(
    token,
    `${gameTitle} ${hint} official trailer`,
  );
  return pickOfficial(items, gameTitle, subscribers);
}

const STORY_STOP = new Set(
  "the a an and of to in on for with as at by from is are was were be has have its it this that new now just after over into game games trailer official video".split(
    " ",
  ),
);

/** Words that carry a story: no stopwords, no game title words. */
export function storyWords(text: string, gameTitle: string): string[] {
  const game = new Set(
    gameTitle
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !STORY_STOP.has(w) && !game.has(w)),
    ),
  ];
}

/**
 * The publisher's own video of the story itself (a stunt, an event, a
 * reveal), uploaded on or after `after`: same channel rules as trailers, and
 * the title must share at least one story word.
 */
export function pickStoryVideo(
  items: SearchItem[],
  gameTitle: string,
  story: string,
  after: Date,
  subscribers: Map<string, number>,
): OfficialTrailer | undefined {
  const owner = franchisePublisher(gameTitle);
  const ownerRule = owner
    ? PUBLISHER_CHANNELS.find((r) => r.name === owner)
    : undefined;
  const words = storyWords(story, gameTitle);
  const scored = items
    .map((it) => {
      const rule = PUBLISHER_CHANNELS.find((r) =>
        r.match.test(it.channelTitle.trim()),
      );
      if (!rule || (subscribers.get(it.channelId) ?? 0) < rule.minSubscribers)
        return undefined;
      if (!it.publishedAt || new Date(it.publishedAt) < after) return undefined;
      const t = it.title.toLowerCase();
      if (EXCLUDE.test(t)) return undefined;
      const hits = words.filter((w) => t.includes(w)).length;
      if (!hits) return undefined;
      return { it, rule, score: hits + (owner && rule.name === owner ? 2 : 0) };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort(
      (a, b) =>
        b.score - a.score || b.it.publishedAt.localeCompare(a.it.publishedAt),
    );
  const best = scored[0];
  if (!best) return undefined;
  return {
    videoId: best.it.videoId,
    title: best.it.title,
    channelId: best.it.channelId,
    channelTitle: best.it.channelTitle,
    publisher: owner ?? best.rule.name,
    clipSeconds: Math.min(
      best.rule.clipSeconds,
      ownerRule?.clipSeconds ?? best.rule.clipSeconds,
    ),
    publishedAt: best.it.publishedAt,
  };
}

/** Official TikTok accounts that publish openly, by publisher; platform holders also post third-party marketing. */
export const SOCIAL_HANDLES: Record<string, string[]> = {
  "Rockstar Games": ["rockstargames"],
  PlayStation: ["playstation"],
  Xbox: ["xbox"],
  Bethesda: ["bethesda", "xbox"],
  Activision: ["xbox"],
  Ubisoft: ["ubisoft"],
  "Epic Games": ["epicgames", "fortnite"],
  "2K": ["2k"],
  "CD Projekt Red": ["cdprojektred"],
  "Bandai Namco": ["bandainamcous"],
};
const PLATFORM_HANDLES = ["playstation", "xbox"];

/** "id | YYYYMMDD | description" lines from yt-dlp's flat listing. */
export function parseSocialListing(
  text: string,
  handle: string,
): Array<{ url: string; date: string; title: string; handle: string }> {
  const out: Array<{
    url: string;
    date: string;
    title: string;
    handle: string;
  }> = [];
  for (const line of text.split(/\r?\n/)) {
    const [id, date, ...rest] = line.split(" | ");
    if (
      !id ||
      !/^\d{8,}$/.test(id.trim()) ||
      !date ||
      !/^\d{8}$/.test(date.trim())
    )
      continue;
    out.push({
      url: `https://www.tiktok.com/@${handle}/video/${id.trim()}`,
      date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
      title: rest.join(" | ").trim(),
      handle,
    });
  }
  return out;
}

/** Best official social post about the story: posted since `after`, naming the game or sharing two story words. */
export function pickSocialPost(
  posts: Array<{ url: string; date: string; title: string; handle: string }>,
  gameTitle: string,
  story: string,
  after: Date,
): { url: string; date: string; title: string; handle: string } | undefined {
  const words = storyWords(story, gameTitle);
  const game = gameTitle
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  const since = after.toISOString().slice(0, 10);
  return posts
    .filter((p) => p.date >= since)
    .map((p) => {
      const t = p.title.toLowerCase();
      const storyHits = words.filter((w) => t.includes(w)).length;
      const gameHits =
        game.filter((w) => t.includes(w)).length / Math.max(1, game.length);
      return {
        p,
        score: storyHits * 2 + gameHits * 3,
        ok: storyHits >= 2 || (gameHits >= 0.5 && storyHits >= 1),
      };
    })
    .filter((x) => x.ok)
    .sort((a, b) => b.score - a.score || b.p.date.localeCompare(a.p.date))[0]
    ?.p;
}

/** The publisher's (or platform holder's) own TikTok post about the story, via yt-dlp's public listing. */
export async function findSocialStoryVideo(
  gameTitle: string,
  story: string,
  after: Date,
  ytdlp = "yt-dlp",
): Promise<OfficialTrailer | undefined> {
  const owner = franchisePublisher(gameTitle);
  const handles = [
    ...new Set([
      ...(owner ? (SOCIAL_HANDLES[owner] ?? []) : []),
      ...PLATFORM_HANDLES,
    ]),
  ];
  const posts: Array<{
    url: string;
    date: string;
    title: string;
    handle: string;
  }> = [];
  for (const h of handles) {
    try {
      const { stdout } = await run(
        ytdlp,
        [
          ...YTDLP_TEXT.args,
          "--no-warnings",
          "--flat-playlist",
          "--playlist-end",
          "15",
          "--print",
          "%(id)s | %(upload_date)s | %(title)s",
          `https://www.tiktok.com/@${h}`,
        ],
        { timeout: 90_000, maxBuffer: 4 * 1024 * 1024, env: YTDLP_TEXT.env },
      );
      posts.push(...parseSocialListing(String(stdout), h));
    } catch (err) {
      log("warn", "social listing failed", {
        handle: h,
        error: errorMessage(err).split("\n")[0],
      });
    }
  }
  const best = pickSocialPost(posts, gameTitle, story, after);
  if (!best) return undefined;
  const rule = owner
    ? PUBLISHER_CHANNELS.find((r) => r.name === owner)
    : undefined;
  const hostRule =
    PUBLISHER_CHANNELS.find(
      (r) =>
        r.name.toLowerCase().replace(/ games$/, "") ===
        best.handle.replace(/games$/, ""),
    ) ?? rule;
  return {
    videoId: best.url,
    title: best.title.slice(0, 120),
    channelId: `tiktok:${best.handle}`,
    channelTitle: `@${best.handle} on TikTok`,
    publisher: owner ?? hostRule?.name ?? best.handle,
    clipSeconds: Math.min(rule?.clipSeconds ?? 14, hostRule?.clipSeconds ?? 14),
    publishedAt: `${best.date}T00:00:00Z`,
  };
}

export async function findStoryVideo(
  token: () => Promise<string>,
  gameTitle: string,
  story: string,
  after: Date,
): Promise<OfficialTrailer | undefined> {
  const words = storyWords(story, gameTitle).slice(0, 5);
  const { items, subscribers } = await searchVideos(
    token,
    `${gameTitle} ${words.join(" ")}`,
    `&publishedAfter=${encodeURIComponent(after.toISOString())}`,
  );
  return pickStoryVideo(items, gameTitle, story, after, subscribers);
}

/** Downloads the trailer as a 1080p video-only mp4 with yt-dlp; returns its duration in seconds. */
export async function downloadTrailer(
  videoId: string,
  dest: string,
  ytdlp = "yt-dlp",
  retry = true,
  /** Above 1080: for stills only, any codec, since nothing plays it back. */
  maxHeight = 1080,
): Promise<number> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await downloadOnce(videoId, dest, ytdlp, maxHeight);
  } catch (err) {
    // A 403 or a signature failure means YouTube moved and yt-dlp is behind: update once and try again.
    if (
      retry &&
      /403|signature|n function|unable to extract|precondition/i.test(
        errorMessage(err),
      )
    ) {
      log("warn", "yt-dlp failed; self-updating and retrying once", {
        videoId,
        error: errorMessage(err).split("\n").pop(),
      });
      await run(ytdlp, ["-U"], { timeout: 120_000 }).catch(() => undefined);
      return downloadTrailer(videoId, dest, ytdlp, false, maxHeight);
    }
    throw err;
  }
  const { stdout } = await run(
    ytdlp,
    [
      "--no-playlist",
      "--no-warnings",
      "--print",
      "duration",
      /^https?:/.test(videoId)
        ? videoId
        : `https://www.youtube.com/watch?v=${videoId}`,
    ],
    { timeout: 60_000 },
  ).catch(() => ({ stdout: "0" }));
  const d = Number(String(stdout).trim());
  return Number.isFinite(d) && d > 0 ? d : 0;
}

async function downloadOnce(
  videoId: string,
  dest: string,
  ytdlp: string,
  maxHeight = 1080,
): Promise<void> {
  const target = /^https?:/.test(videoId)
    ? videoId
    : `https://www.youtube.com/watch?v=${videoId}`;
  await run(
    ytdlp,
    [
      "--no-playlist",
      "--no-warnings",
      "-f",
      maxHeight > 1080
        ? `bv*[height<=${maxHeight}][vcodec^=vp9]/bv*[height<=${maxHeight}][vcodec^=vp09]/bv*[height<=1080][ext=mp4]/b`
        : "bv*[height<=1080][ext=mp4][vcodec^=avc1]/bv*[height<=1080][ext=mp4]/b[height<=1080][ext=mp4]/b",
      "--merge-output-format",
      "mp4",
      "-o",
      dest,
      target,
    ],
    { timeout: maxHeight > 1080 ? 600_000 : 180_000, maxBuffer: 8 * 1024 * 1024 },
  );
}

/** The trailer's largest thumbnail, saved as a 16:9 still. */
export async function downloadThumbnail(
  videoId: string,
  dest: string,
): Promise<boolean> {
  for (const name of ["maxresdefault", "sddefault", "hqdefault"]) {
    try {
      const res = await fetchWithTimeout(
        `https://i.ytimg.com/vi/${videoId}/${name}.jpg`,
        {},
        15_000,
      );
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 8_000) continue;
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, buf);
      return true;
    } catch (err) {
      log("warn", "thumbnail fetch failed", {
        videoId,
        name,
        error: errorMessage(err),
      });
    }
  }
  return false;
}

export interface OfficialMedia {
  /** true when the footage is the publisher's own video of the story, not a trailer */
  storyVideo?: boolean;
  trailer?: {
    videoId: string;
    title: string;
    publisher: string;
    channelTitle: string;
    url: string;
    clipSeconds: number;
  };
  clips: VisualAsset[];
  stills: VisualAsset[];
}

export interface OfficialMediaOptions {
  token: () => Promise<string>;
  gameTitle: string;
  episodeDir: string;
  targets: FootageTarget[];
  maxClips: number;
  llm?: Llm;
  ytdlp?: string;
  /** Returns false when the YouTube quota cannot spare the search (about 101 units). */
  quotaOk?: () => Promise<boolean>;
  /** Extra words for the search only, such as the release year. */
  hint?: string;
  /** A picture story: look first for the publisher's own video of it, uploaded since this date. */
  story?: { text: string; after: Date };
  /** Footage first on Shorts: see MatchClipsOptions. The publisher's cap still applies. */
  fill?: { seconds?: number; textCheck?: boolean };
  /**
   * OFFICIAL_STILL_FRAMES: a stills-only publisher (clipSeconds 0, Nintendo) gives up to this many frames of its own
   * trailer as stills, matched to the lines like footage. No moving footage is used; 0 keeps only the thumbnail.
   */
  stillFrames?: number;
}

/** The sharpest of a few frames across a stretch, largest JPEG first (fine detail costs bytes): at most `take`, kept apart. */
async function sharpestFrames(
  source: string,
  from: number,
  seconds: number,
  take: number,
  scratch: string,
): Promise<number[]> {
  const samples = 5;
  const found: Array<{ at: number; bytes: number }> = [];
  await fs.mkdir(scratch, { recursive: true });
  for (let i = 0; i < samples; i++) {
    const at = from + (seconds * (i + 0.5)) / samples;
    const file = path.join(scratch, `s${i}.jpg`);
    await run(
      "ffmpeg",
      ["-y", "-ss", at.toFixed(2), "-i", source, "-frames:v", "1", "-vf", "scale=-2:720", "-q:v", "3", file],
      { timeout: 60_000 },
    );
    const st = await fs.stat(file).catch(() => undefined);
    if (st) found.push({ at, bytes: st.size });
  }
  const out: number[] = [];
  for (const f of found.sort((x, y) => y.bytes - x.bytes))
    if (out.length < take && out.every((o) => Math.abs(o - f.at) >= seconds / 4))
      out.push(f.at);
  return out;
}

/**
 * Frames of a stills-only publisher's trailer at its full resolution: the moment chosen for each line (the sharpest
 * two of each, tagged with that line), then a pool of clean frames from across the trailer for the other shots.
 */
async function trailerStills(
  o: Pick<OfficialMediaOptions, "episodeDir" | "gameTitle" | "targets" | "stillFrames" | "llm" | "ytdlp">,
  trailer: { videoId: string; title: string; channelTitle: string },
  url: string,
  /** The pool alone, at most this many: no moments matched to lines, so no model call. */
  poolOnly?: number,
): Promise<VisualAsset[]> {
  const work = path.join(o.episodeDir, "trailers");
  const file = path.join(work, "official.mp4");
  const keep = path.join(o.episodeDir, "stillsource.video");
  const scratch = path.join(o.episodeDir, "stillscratch");
  const out: VisualAsset[] = [];
  const grab = async (at: number, name: string) => {
    const still = path.join("assets", name);
    await run(
      "ffmpeg",
      ["-y", "-ss", at.toFixed(2), "-i", keep, "-frames:v", "1", "-q:v", "2", path.join(o.episodeDir, still)],
      { timeout: 120_000 },
    );
    return still;
  };
  try {
    const total = await downloadTrailer(trailer.videoId, file, o.ytdlp, true, 2160);
    await fs.copyFile(file, keep);
    const moments = poolOnly ? [] : await matchClips({
      trailers: [{ file, name: trailer.title, url, total: total || 120 }],
      episodeDir: o.episodeDir,
      targets: o.targets,
      maxClips: o.stillFrames!,
      llm: o.llm,
      prefix: "officialstill",
      describe: (t, seconds, at) =>
        `Frame of official trailer "${t.name}" from the ${trailer.channelTitle} YouTube channel (${url}), at ${at.toFixed(1)}s`,
    });
    const used: number[] = [];
    for (const [k, m] of moments.entries()) {
      const seconds = m.durationSeconds ?? 2;
      const ats = await sharpestFrames(keep, m.startSeconds ?? 0, seconds, 1, scratch);
      for (const [j, at] of ats.entries()) {
        used.push(at);
        out.push({
          kind: "screenshot",
          file: await grab(at, `official_frame_${k}_${j}.jpg`),
          sourceUrl: url,
          provenance: m.provenance,
          beatIndex: m.beatIndex,
          role: m.role,
          label: m.label,
          reason: m.reason,
        });
      }
      await fs.rm(path.join(o.episodeDir, m.file), { force: true });
    }
    // The pool: one look every few seconds, clean of on-screen text, each at least 6 s from a frame already taken.
    const span = total || 120;
    const looks = Math.min(36, Math.floor(span / 4));
    const pool: Array<{ at: number; file: string }> = [];
    await fs.mkdir(scratch, { recursive: true });
    for (let i = 0; i < looks; i++) {
      const at = (span * (i + 0.5)) / looks;
      if (used.some((u) => Math.abs(u - at) < 6)) continue;
      const small = path.join(scratch, `p${i}.jpg`);
      await run(
        "ffmpeg",
        ["-y", "-skip_frame", "nokey", "-ss", at.toFixed(2), "-i", keep, "-frames:v", "1", "-vf", "scale=-2:540", "-q:v", "4", small],
        { timeout: 60_000 },
      ).catch(() => undefined);
      const st = await fs.stat(small).catch(() => undefined);
      if (st && st.size > 25_000) pool.push({ at, file: small });
    }
    // The picture editor reads these afterwards. The local screen is not asked: it calls a game's own interface text
    // (the ocarina's music staff, the frame the "hum" line needs), and it adds a GPU job for no gain here.
    const poolMax = poolOnly ?? 16;
    const step = Math.max(1, Math.floor(pool.length / poolMax));
    for (const [k, p] of pool.filter((_, i) => i % step === 0).slice(0, poolMax).entries())
      out.push({
        kind: "screenshot",
        file: await grab(p.at, `official_pool_${k}.jpg`),
        sourceUrl: url,
        provenance: `Frame of official trailer "${trailer.title}" from the ${trailer.channelTitle} YouTube channel (${url}), at ${p.at.toFixed(1)}s`,
      });
  } catch (err) {
    log("warn", "official trailer stills failed", {
      game: o.gameTitle,
      error: errorMessage(err),
    });
  }
  await fs.rm(work, { recursive: true, force: true });
  await fs.rm(scratch, { recursive: true, force: true });
  await fs.rm(keep, { force: true });
  return out;
}

/** At or under this many seconds of footage, a publisher's trailer may fill gaps with stills (SHORT_CAPPED_STILLS). */
export const TIGHT_CAP_SECONDS = 10;

/**
 * Frames of a tight-cap publisher's trailer, as a last fallback once its own screenshots, press art and IGDB are in
 * (ruling of 5 Nov 2026). Spread across the trailer at least 6 s apart, clean of text, no big lettering in the crop,
 * marked `frame` so the planner uses them last, once each and never two in a row: never a way to rebuild the trailer.
 */
export async function trailerFrames(
  o: Pick<OfficialMediaOptions, "episodeDir" | "gameTitle" | "ytdlp">,
  trailer: { videoId: string; title: string; channelTitle: string; url: string },
  count: number,
  textCheck: boolean,
): Promise<VisualAsset[]> {
  if (count <= 0) return [];
  const frames = await trailerStills(
    { ...o, targets: [], stillFrames: count },
    trailer,
    trailer.url,
    // A few spare: the text check may drop some.
    count + 3,
  );
  const out: VisualAsset[] = [];
  for (const f of frames) {
    const words =
      textCheck && out.length < count
        ? await stillBigText(path.join(o.episodeDir, f.file))
        : [];
    if (out.length >= count || words.length) {
      await fs.rm(path.join(o.episodeDir, f.file), { force: true }).catch(() => undefined);
      continue;
    }
    out.push({ ...f, frame: true });
  }
  return out;
}

/**
 * Footage and a still for a game that is not on Steam: the publisher's own
 * trailer on YouTube, matched to the narration like a Steam trailer, under
 * that publisher's footage cap (Nintendo: stills only).
 */
export async function officialMedia(
  o: OfficialMediaOptions,
): Promise<OfficialMedia> {
  const none: OfficialMedia = { clips: [], stills: [] };
  if (!o.gameTitle.trim()) return none;
  if (o.quotaOk && !(await o.quotaOk())) {
    log("info", "official trailer search skipped: quota reserved for uploads", {
      game: o.gameTitle,
    });
    return none;
  }
  const storyVideo = o.story
    ? await findStoryVideo(
        o.token,
        o.gameTitle,
        o.story.text,
        o.story.after,
      ).catch((err) => {
        log("warn", "story video search failed", {
          game: o.gameTitle,
          error: errorMessage(err),
        });
        return undefined;
      })
    : undefined;
  const socialVideo =
    o.story && !storyVideo
      ? await findSocialStoryVideo(
          o.gameTitle,
          o.story.text,
          o.story.after,
          o.ytdlp,
        ).catch(() => undefined)
      : undefined;
  if (o.story)
    log(
      "info",
      storyVideo || socialVideo
        ? "publisher story video found"
        : "no publisher story video",
      {
        game: o.gameTitle,
        title: (storyVideo ?? socialVideo)?.title,
        where: storyVideo
          ? "youtube"
          : socialVideo
            ? socialVideo.channelTitle
            : "none",
      },
    );
  const trailer =
    storyVideo ??
    socialVideo ??
    (await findOfficialTrailer(o.token, o.gameTitle, o.hint));
  if (!trailer) {
    log("info", "no official trailer found", { game: o.gameTitle });
    return none;
  }
  const url = /^https?:/.test(trailer.videoId)
    ? trailer.videoId
    : `https://www.youtube.com/watch?v=${trailer.videoId}`;
  const out: OfficialMedia = {
    storyVideo: Boolean(storyVideo || socialVideo),
    trailer: {
      videoId: trailer.videoId,
      title: trailer.title,
      publisher: trailer.publisher,
      channelTitle: trailer.channelTitle,
      url,
      clipSeconds: trailer.clipSeconds,
    },
    clips: [],
    stills: [],
  };
  const stillFile = path.join("assets", "official_trailer.jpg");
  if (
    !socialVideo &&
    (await downloadThumbnail(
      trailer.videoId,
      path.join(o.episodeDir, stillFile),
    ))
  ) {
    out.stills.push({
      kind: "hero",
      file: stillFile,
      sourceUrl: url,
      provenance: `Official trailer thumbnail "${trailer.title}" from the ${trailer.channelTitle} YouTube channel (${url})`,
    });
  }
  if (trailer.clipSeconds <= 0 && (o.stillFrames ?? 0) > 0 && o.targets.length) {
    out.stills.push(...(await trailerStills(o, trailer, url)));
    return out;
  }
  if (trailer.clipSeconds <= 0 || o.maxClips <= 0 || !o.targets.length)
    return out;
  const work = path.join(o.episodeDir, "trailers");
  const file = path.join(work, "official.mp4");
  try {
    const total = await downloadTrailer(trailer.videoId, file, o.ytdlp);
    out.clips = await matchClips({
      trailers: [{ file, name: trailer.title, url, total: total || 120 }],
      episodeDir: o.episodeDir,
      targets: o.targets,
      maxClips: o.maxClips,
      llm: o.llm,
      prefix: "official",
      fillSeconds: o.fill?.seconds
        ? Math.min(o.fill.seconds, trailer.clipSeconds)
        : undefined,
      textCheck: o.fill?.textCheck,
      describe: (t, seconds, at) =>
        socialVideo
          ? `Official post "${t.name.slice(0, 80)}" by ${trailer.channelTitle}, publisher: ${trailer.publisher} (${url}), ${seconds}s at ${at.toFixed(1)}s, muted`
          : `Official trailer "${t.name}" from the ${trailer.channelTitle} YouTube channel, publisher: ${trailer.publisher} (${url}), ${seconds}s at ${at.toFixed(1)}s, muted`,
    });
  } catch (err) {
    log("warn", "official trailer footage failed", {
      game: o.gameTitle,
      videoId: trailer.videoId,
      error: errorMessage(err),
    });
    await fs.rm(work, { recursive: true, force: true });
  }
  return out;
}

// Official trailers from a publisher's own YouTube channel, for games that
// are not on Steam (console-only titles such as GTA VI). Only channels that
// match a known publisher by name and size are accepted, never a reupload;
// the footage then goes through the same keyframe matching as Steam trailers
// and the same per-publisher budget.

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetchWithTimeout, log, errorMessage } from "../lib/util.ts";
import { matchClips, type FootageTarget } from "./clipscore.ts";
import type { VisualAsset } from "./steam.ts";
import type { Llm } from "../editorial/llm.ts";

const run = promisify(execFile);
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
    clipSeconds: 6,
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
  { match: /\b(grand theft auto|gta|red dead|max payne|bully|l\.?a\.? noire|midnight club)\b/i, name: "Rockstar Games" },
  { match: /\b(mario|zelda|pok[eé]mon|metroid|kirby|splatoon|animal crossing|fire emblem|pikmin|donkey kong|xenoblade|smash bros|nintendo|luigi|yoshi)\b/i, name: "Nintendo" },
  { match: /\b(call of duty|warzone|black ops|modern warfare)\b/i, name: "Activision" },
  { match: /\b(assassin'?s creed|far cry|rainbow six|ghost recon|watch dogs|the division|anno|prince of persia|beyond good)\b/i, name: "Ubisoft" },
  { match: /\b(battlefield|ea sports|fc 2\d|madden|apex legends|the sims|mass effect|dragon age|need for speed|skate)\b/i, name: "EA" },
  { match: /\b(elder scrolls|fallout|starfield|doom|wolfenstein|dishonored|indiana jones)\b/i, name: "Bethesda" },
  { match: /\b(halo|forza|gears of war|fable|flight simulator|sea of thieves|state of decay|avowed|hellblade)\b/i, name: "Xbox" },
  { match: /\b(god of war|the last of us|uncharted|horizon|ghost of|spider-man|ratchet|gran turismo|marathon|helldivers|astro bot)\b/i, name: "PlayStation" },
  { match: /\b(resident evil|monster hunter|street fighter|devil may cry|dragon'?s dogma|mega man|okami|pragmata)\b/i, name: "Capcom" },
  { match: /\b(final fantasy|kingdom hearts|dragon quest|nier|tomb raider)\b/i, name: "Square Enix" },
  { match: /\b(sonic|yakuza|like a dragon|persona|metaphor|total war|football manager)\b/i, name: "Sega" },
  { match: /\b(elden ring|dark souls|armored core|sekiro|bloodborne|nightreign|duskbloods)\b/i, name: "FromSoftware" },
  { match: /\b(tekken|dragon ball|naruto|ace combat|elden ring)\b/i, name: "Bandai Namco" },
  { match: /\b(fortnite|unreal)\b/i, name: "Epic Games" },
  { match: /\b(cyberpunk|witcher)\b/i, name: "CD Projekt Red" },
  { match: /\b(hogwarts legacy|mortal kombat|batman|arkham|injustice|wonder woman)\b/i, name: "Warner Bros. Games" },
  { match: /\b(borderlands|mafia|bioshock|nba 2k|wwe 2k|civilization|xcom)\b/i, name: "2K" },
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
  const ownerRule = owner ? PUBLISHER_CHANNELS.find((r) => r.name === owner) : undefined;
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
    clipSeconds: Math.min(best.rule.clipSeconds, ownerRule?.clipSeconds ?? best.rule.clipSeconds),
    publishedAt: best.it.publishedAt,
  };
}

/** Finds the game's official trailer on YouTube (search 100 units + channels 1 unit). */
type SearchItem = { videoId: string; title: string; channelId: string; channelTitle: string; publishedAt: string };

/** One YouTube search (100 units) plus the channels' audience sizes (1 unit). */
async function searchVideos(token: () => Promise<string>, query: string, extra = ""): Promise<{ items: SearchItem[]; subscribers: Map<string, number> }> {
  const auth = { headers: { authorization: `Bearer ${await token()}` } };
  const q = encodeURIComponent(query.replace(/\s+/g, " ").trim());
  const res = await fetchWithTimeout(`${API}/search?part=snippet&type=video&maxResults=15&order=relevance&q=${q}${extra}`, auth, 20_000);
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
  const channelIds = [...new Set(items.map((i) => i.channelId))].filter(Boolean);
  const subscribers = new Map<string, number>();
  if (channelIds.length) {
    const ch = await fetchWithTimeout(`${API}/channels?part=statistics&id=${channelIds.join(",")}`, auth, 20_000);
    if (ch.ok) for (const c of ((await ch.json()) as any).items ?? []) subscribers.set(c.id, Number(c.statistics?.subscriberCount ?? 0));
  }
  return { items, subscribers };
}

/** Finds the game's official trailer on YouTube (search 100 units + channels 1 unit). */
export async function findOfficialTrailer(
  token: () => Promise<string>,
  gameTitle: string,
  hint = "", // e.g. the release year, to steer a short or reused title ("Resident Evil" 2002)
): Promise<OfficialTrailer | undefined> {
  const { items, subscribers } = await searchVideos(token, `${gameTitle} ${hint} official trailer`);
  return pickOfficial(items, gameTitle, subscribers);
}

const STORY_STOP = new Set("the a an and of to in on for with as at by from is are was were be has have its it this that new now just after over into game games trailer official video".split(" "));

/** Words that carry a story: no stopwords, no game title words. */
export function storyWords(text: string, gameTitle: string): string[] {
  const game = new Set(gameTitle.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STORY_STOP.has(w) && !game.has(w)))];
}

/**
 * The publisher's own video of the story itself (a stunt, an event, a
 * reveal), uploaded on or after `after`: same channel rules as trailers, and
 * the title must share at least one story word.
 */
export function pickStoryVideo(items: SearchItem[], gameTitle: string, story: string, after: Date, subscribers: Map<string, number>): OfficialTrailer | undefined {
  const owner = franchisePublisher(gameTitle);
  const ownerRule = owner ? PUBLISHER_CHANNELS.find((r) => r.name === owner) : undefined;
  const words = storyWords(story, gameTitle);
  const scored = items
    .map((it) => {
      const rule = PUBLISHER_CHANNELS.find((r) => r.match.test(it.channelTitle.trim()));
      if (!rule || (subscribers.get(it.channelId) ?? 0) < rule.minSubscribers) return undefined;
      if (!it.publishedAt || new Date(it.publishedAt) < after) return undefined;
      const t = it.title.toLowerCase();
      if (EXCLUDE.test(t)) return undefined;
      const hits = words.filter((w) => t.includes(w)).length;
      if (!hits) return undefined;
      return { it, rule, score: hits + (owner && rule.name === owner ? 2 : 0) };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort((a, b) => b.score - a.score || b.it.publishedAt.localeCompare(a.it.publishedAt));
  const best = scored[0];
  if (!best) return undefined;
  return {
    videoId: best.it.videoId,
    title: best.it.title,
    channelId: best.it.channelId,
    channelTitle: best.it.channelTitle,
    publisher: owner ?? best.rule.name,
    clipSeconds: Math.min(best.rule.clipSeconds, ownerRule?.clipSeconds ?? best.rule.clipSeconds),
    publishedAt: best.it.publishedAt,
  };
}

export async function findStoryVideo(token: () => Promise<string>, gameTitle: string, story: string, after: Date): Promise<OfficialTrailer | undefined> {
  const words = storyWords(story, gameTitle).slice(0, 5);
  const { items, subscribers } = await searchVideos(token, `${gameTitle} ${words.join(" ")}`, `&publishedAfter=${encodeURIComponent(after.toISOString())}`);
  return pickStoryVideo(items, gameTitle, story, after, subscribers);
}

/** Downloads the trailer as a 1080p video-only mp4 with yt-dlp; returns its duration in seconds. */
export async function downloadTrailer(
  videoId: string,
  dest: string,
  ytdlp = "yt-dlp",
  retry = true,
): Promise<number> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await downloadOnce(videoId, dest, ytdlp);
  } catch (err) {
    // A 403 or a signature failure means YouTube moved and yt-dlp is behind: update once and try again.
    if (retry && /403|signature|n function|unable to extract|precondition/i.test(errorMessage(err))) {
      log("warn", "yt-dlp failed; self-updating and retrying once", { videoId, error: errorMessage(err).split("\n").pop() });
      await run(ytdlp, ["-U"], { timeout: 120_000 }).catch(() => undefined);
      return downloadTrailer(videoId, dest, ytdlp, false);
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
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    { timeout: 60_000 },
  ).catch(() => ({ stdout: "0" }));
  const d = Number(String(stdout).trim());
  return Number.isFinite(d) && d > 0 ? d : 0;
}

async function downloadOnce(videoId: string, dest: string, ytdlp: string): Promise<void> {
  await run(
    ytdlp,
    [
      "--no-playlist",
      "--no-warnings",
      "-f",
      "bv*[height<=1080][ext=mp4][vcodec^=avc1]/bv*[height<=1080][ext=mp4]/b[height<=1080][ext=mp4]/b",
      "--merge-output-format",
      "mp4",
      "-o",
      dest,
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
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
  trailer?: { videoId: string; title: string; publisher: string; channelTitle: string; url: string; clipSeconds: number };
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
}

/**
 * Footage and a still for a game that is not on Steam: the publisher's own
 * trailer on YouTube, matched to the narration like a Steam trailer, under
 * that publisher's footage cap (Nintendo: stills only).
 */
export async function officialMedia(o: OfficialMediaOptions): Promise<OfficialMedia> {
  const none: OfficialMedia = { clips: [], stills: [] };
  if (!o.gameTitle.trim()) return none;
  if (o.quotaOk && !(await o.quotaOk())) {
    log("info", "official trailer search skipped: quota reserved for uploads", { game: o.gameTitle });
    return none;
  }
  const storyVideo = o.story ? await findStoryVideo(o.token, o.gameTitle, o.story.text, o.story.after).catch((err) => {
    log("warn", "story video search failed", { game: o.gameTitle, error: errorMessage(err) });
    return undefined;
  }) : undefined;
  if (o.story) log("info", storyVideo ? "publisher story video found" : "no publisher story video", { game: o.gameTitle, title: storyVideo?.title });
  const trailer = storyVideo ?? (await findOfficialTrailer(o.token, o.gameTitle, o.hint));
  if (!trailer) {
    log("info", "no official trailer found", { game: o.gameTitle });
    return none;
  }
  const url = `https://www.youtube.com/watch?v=${trailer.videoId}`;
  const out: OfficialMedia = { storyVideo: Boolean(storyVideo), trailer: { videoId: trailer.videoId, title: trailer.title, publisher: trailer.publisher, channelTitle: trailer.channelTitle, url, clipSeconds: trailer.clipSeconds }, clips: [], stills: [] };
  const stillFile = path.join("assets", "official_trailer.jpg");
  if (await downloadThumbnail(trailer.videoId, path.join(o.episodeDir, stillFile))) {
    out.stills.push({ kind: "hero", file: stillFile, sourceUrl: url, provenance: `Official trailer thumbnail "${trailer.title}" from the ${trailer.channelTitle} YouTube channel (${url})` });
  }
  if (trailer.clipSeconds <= 0 || o.maxClips <= 0 || !o.targets.length) return out;
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
      describe: (t, seconds, at) => `Official trailer "${t.name}" from the ${trailer.channelTitle} YouTube channel, publisher: ${trailer.publisher} (${url}), ${seconds}s at ${at.toFixed(1)}s, muted`,
    });
  } catch (err) {
    log("warn", "official trailer footage failed", { game: o.gameTitle, videoId: trailer.videoId, error: errorMessage(err) });
    await fs.rm(work, { recursive: true, force: true });
  }
  return out;
}

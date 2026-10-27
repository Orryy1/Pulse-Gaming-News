// The factory: one idempotent state machine advanced by a periodic tick.
// Each step reads its inputs from Postgres/disk and writes its outputs before
// the status moves, so any step can crash and be retried safely.

import { pollBlock, readPoll } from "./social/poll.ts";
import { selectWhyTopic } from "./editorial/why.ts";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { withLease } from "./db.ts";
import type { Llm } from "./editorial/llm.ts";
import type { StoryCluster } from "./discovery/cluster.ts";
import type { ArticleText } from "./discovery/article.ts";
import type { Narration } from "./voice/elevenlabs.ts";
import type { VisualAsset, SteamApp, SteamFacts } from "./assets/steam.ts";
import { factsText } from "./assets/steam.ts";
import { capFootage, footageBudgetSeconds } from "./assets/footage.ts";
import { targetsFor, type FootageTarget } from "./assets/clipscore.ts";
import type { OfficialMedia } from "./assets/officialTrailer.ts";
import type { RadarGame, FreeGame } from "./discovery/weekly.ts";
import { rarest, type Achievement } from "./discovery/achievements.ts";
import {
  EVERGREEN_MIN_SECONDS,
  evergreenToScript,
  selectEvergreenTopic,
  validateEvergreen,
  writeEvergreen,
  type EvergreenCandidate,
} from "./editorial/evergreen.ts";
import {
  longformToScript,
  selectLongformTopic,
  validateLongform,
  writeLongform,
} from "./editorial/longform.ts";
import { trailerMatchesGame } from "./assets/commons.ts";
import { rankStills } from "./assets/stillscore.ts";
import { makeParallax, LAYERED_KINDS } from "./render/parallax.ts";
import { annotationLabel, locate } from "./assets/annotate.ts";
import { unloadLocalVision } from "./assets/localvision.ts";
import {
  tightenPauses,
  chapterGaps,
  insertSilence,
  openWords,
} from "./voice/pauses.ts";

/** Seconds of breather before each documentary chapter: narrator silent, music up, the chapter's title full screen. */
const DOC_BREAK_SECONDS = 4;
import { sentencesOf } from "./editorial/longform.ts";
import {
  pickPhotos,
  selectDocTopic,
  outlineDoc,
  writeChapter,
  checkChapter,
  groundCallouts,
  validateChapter,
  writeBookends,
  validateBookends,
  docToScript,
  writeDocMoments,
  groundDocMoments,
  type DocMoment,
  docWordCount,
  DOC_CHAPTERS_MIN,
  DOC_WORDS_MIN,
  DOC_WORDS_MAX,
  type DocTopic,
  type DocDraft,
} from "./editorial/documentary.ts";
import {
  packageRecap,
  recapToScript,
  validateRecapChapter,
  writeRecapBookends,
  writeRecapChapter,
  RECAP_STORIES_MAX,
  RECAP_STORIES_MIN,
  type RecapStory,
} from "./editorial/recap.ts";
import {
  buildLongPlan,
  momentKeys,
  planGaps,
  openChaptersAtBreaks,
  momentWindows,
  LONG_FPS,
  chapterLines,
  LONG_TAIL_SECONDS,
} from "./render/longplan.ts";
import type { LongRenderInput } from "./render/render.ts";
import type { renderCutdown } from "./render/render.ts";
import {
  CUTDOWN_TAIL_SECONDS,
  cutdownRanks,
  cutdownScript,
  cutdownWindow,
  wordsIn,
  writeCutdownCopy,
} from "./editorial/cutdown.ts";
import { FFMPEG } from "./lib/bin.ts";
import { cutPortrait } from "./assets/localvision.ts";
import { normTitle } from "./assets/igdb.ts";
import type { RenderInput } from "./render/render.ts";
import type { TechQa } from "./qa/media.ts";
import type { VisionQa } from "./editorial/schema.ts";
import { narrationSummary, type NarrationCheck } from "./qa/narration.ts";
import type { YouTubeClient } from "./youtube/upload.ts";
import type { DiscordMessage } from "./approval/discord.ts";
import { COLOURS } from "./approval/discord.ts";
import {
  selectStory,
  writeScript,
  factCheck,
  factCheckRanking,
  validateScript,
} from "./editorial/editorial.ts";
import { narrationOf, tidyLoopLine, type Script } from "./editorial/schema.ts";
import { translateMetadata } from "./editorial/localize.ts";
import { hotBlock, readHotTopic, watchHits } from "./hits.ts";
import type { Deal } from "./discovery/deals.ts";
import { trendingBlock } from "./discovery/demand.ts";
import { screenFrames } from "./assets/localvision.ts";
import { readRequests, requestsBlock } from "./social/requests.ts";
import {
  buildTags,
  hashtags,
  keywordLead,
  pinnedComment,
  polishTitle,
  thumbTitle,
} from "./editorial/seo.ts";
import {
  affiliateBlock,
  affiliateCommentLine,
  type AffiliateTags,
} from "./editorial/affiliate.ts";
import { pickVoice } from "./voice/index.ts";
import { speakable } from "./voice/speakable.ts";
import {
  buildSegments,
  srtFromWords,
  type SegmentInput,
} from "./render/timeline.ts";
import { buildPlan, TAIL_SECONDS, MAX_SFX } from "./render/plan.ts";
import { leadFrames, LEVEL, SFX, sfxFile } from "./render/soundscape.ts";
import { bedFor } from "./render/soundscape.ts";
import { formatOpen } from "./formats.ts";
import { blurPlate } from "./assets/plates.ts";
import { scorePlan, rubricSummary } from "./qa/rubric.ts";
import {
  captureMetrics,
  captureRetention,
  hookLessons,
  longLessons,
  captureCurves,
  performanceNotes,
  retentionNotes,
} from "./analytics.ts";
import { offendingMedia, dropOffending } from "./qa/retry.ts";
import {
  addDays,
  localTime,
  dayKey,
  LANE_PRIORITY,
  QUOTA,
  QUOTA_RESERVE_FOR_UPLOAD,
  quotaCall,
  quotaCalls,
  dueSlot,
  evergreenDue,
  franchiseKey,
  inWindow,
  isBreaking,
  SHOWCASE,
  showcaseLive,
  slotsLeftToday,
  weekday,
  storyText,
  lastPublishAt,
  publishHeld,
  staleAfterHours,
  nextWindowStart,
  quotaAdd,
  quotaResetAt,
  quotaUsed,
  type Sighting,
} from "./lanes.ts";
import { buildResource, markerTag, SessionGone } from "./youtube/upload.ts";
import { signToken } from "./lib/crypto.ts";
import { FatalError, errorMessage, log, shortId } from "./lib/util.ts";
import type { RecentShapes } from "./editorial/editorial.ts";
import { calendarBlock, readCalendar, type CalendarLane } from "./calendar.ts";
import { stampColour } from "./render/brand.ts";
import {
  translateScript,
  twinFooter,
  twinNarration,
} from "./editorial/twin.ts";
import {
  captionable,
  gameplayScript,
  gameplayWindow,
  newClips,
  parseExperiments,
  readMeta,
  reviewClip,
  wordsInWindow,
  worthPosting,
  writeManifest,
  writeMeta,
  type GameplayStatus,
} from "./gameplay.ts";
import { pruneCommentRecords } from "./youtube/replies.ts";
import {
  type Episode,
  type EpisodeAssets,
  countToday,
  createEpisode,
  dueEpisodes,
  getEpisode,
  logEvent,
  markSeen,
  recentHeadlines,
  recordFailure,
  seenHashes,
  transition,
  countProducing,
  takenSlots,
} from "./episodes.ts";

export interface Services {
  db: Db;
  cfg: Config;
  llm: Llm;
  discover(): Promise<StoryCluster[]>;
  discoverEvergreen(): Promise<EvergreenCandidate[]>;
  fetchArticle(url: string): Promise<ArticleText | undefined>;
  synthesise(
    text: string,
    outPath: string,
    voice?: { id: string; name: string },
    opts?: { provider?: Config["voiceProvider"] },
  ): Promise<
    Narration & {
      voice?: { provider: "local" | "elevenlabs"; id: string; name: string };
    }
  >;
  findGame(term: string): Promise<SteamApp | undefined>;
  gameFacts(app: SteamApp): Promise<SteamFacts>;
  fetchArt(
    app: SteamApp,
    episodeDir: string,
    maxScreens?: number,
  ): Promise<VisualAsset[]>;
  /** Freely licensed archive photos (Wikimedia Commons) for a search. */
  searchPhotos(
    query: string,
  ): Promise<import("./assets/commons.ts").CommonsImage[]>;
  /** Official screenshots, key art and cover from IGDB for a game by exact title (empty without Twitch keys). */
  igdbArt(
    title: string,
    year: number | undefined,
    episodeDir: string,
    max: number,
  ): Promise<VisualAsset[]>;
  /** Licensed gameplay (Creative Commons, then the publisher's own uploads) matched to the given lines. */
  gameplayClips(
    game: string,
    franchise: string,
    year: number | undefined,
    episodeDir: string,
    targets: FootageTarget[],
    maxClips: number,
    scope?: "campaign",
  ): Promise<Array<VisualAsset & { credit: string }>>;
  /** Moments from the owner's own recordings of this game (none when there are none). */
  ownClips(
    game: string,
    franchise: string,
    episodeDir: string,
    targets: FootageTarget[],
    maxClips: number,
  ): Promise<VisualAsset[]>;
  /** True when a video title is footage of exactly this game (and, for a campaign video, of its campaign). */
  judgeFootage(
    game: string,
    year: number | undefined,
    title: string,
    scope?: "campaign",
  ): Promise<boolean>;
  downloadPhoto(
    img: import("./assets/commons.ts").CommonsImage,
    dest: string,
  ): Promise<boolean>;
  fetchClips(
    app: SteamApp,
    episodeDir: string,
    targets: FootageTarget[],
    maxClips: number,
    scope?: "campaign",
  ): Promise<VisualAsset[]>;
  fetchOfficialMedia(
    gameTitle: string,
    episodeDir: string,
    targets: FootageTarget[],
    maxClips: number,
    hint?: string,
    story?: { text: string; after: Date },
  ): Promise<OfficialMedia>;
  fetchStock(
    episodeDir: string,
    targets: FootageTarget[],
    gameWords: string[],
    maxClips: number,
  ): Promise<VisualAsset[]>;
  releaseRadar(from: Date): Promise<RadarGame[]>;
  freeGames(now: Date): Promise<{ now: FreeGame[]; next: FreeGame[] }>;
  achievements(appId: number): Promise<Achievement[]>;
  /** This week's biggest climbers on Steam's most-played chart, with their official news. */
  steamClimbers(now: Date): Promise<import("./discovery/charts.ts").Climber[]>;
  /** Today's best Steam deals, skipping games featured recently. */
  steamDeals(exclude: string[]): Promise<import("./discovery/deals.ts").Deal[]>;
  /** YouTube's most-popular US charts (Gaming and everything), cached hourly, for the editor. */
  trending(): Promise<import("./discovery/demand.ts").TrendingVideo[]>;
  /** A Wikipedia article's useful sections, by title or else by search (documentary research). */
  research(
    title: string,
    fallbackQuery: string,
    maxChars?: number,
  ): Promise<import("./discovery/wikipedia.ts").WikiArticle | undefined>;
  downloadImage(url: string, dest: string): Promise<boolean>;
  imageAspect(file: string): Promise<number>;
  render(input: RenderInput): Promise<void>;
  renderLong(input: LongRenderInput): Promise<void>;
  renderCutdown?: typeof renderCutdown;
  normalise(input: string, output: string): Promise<void>;
  technicalQa(
    file: string,
    expectedSeconds: number,
    band?: {
      minSeconds: number;
      maxSeconds: number;
      width?: number;
      height?: number;
    },
  ): Promise<TechQa>;
  extractFrames(
    file: string,
    outDir: string,
    times: number[],
  ): Promise<string[]>;
  visionQa(
    frames: string[],
    ctx: { headline: string; gameTitle: string; format?: "short" | "long" },
  ): Promise<VisionQa>;
  /** The ElevenLabs cycle: what is left and what would be lost at the reset (undefined when unknown). */
  creditPlan?(): Promise<import("./voice/credits.ts").CreditPlan | undefined>;
  /** Joins voiced takes into one narration with the word timings shifted onto one timeline. */
  stitchTakes?(parts: Narration[], outPath: string): Promise<Narration>;
  /** What Whisper hears in a gameplay clip, word by word (empty when no Whisper is set up). */
  hearClip?(
    file: string,
  ): Promise<Array<{ text: string; start: number; end: number }>>;
  /** What the voice actually says against its script (undefined when no Whisper is set up). */
  checkNarration?(
    file: string,
    words: Array<{ text: string; start: number; end: number }>,
  ): Promise<NarrationCheck | undefined>;
  /** The YouTube client for the main channel, or for a named second account (the Spanish twin, "es"). */
  youtube(account?: string): YouTubeClient;
  /** Whether a login is stored for the account (undefined in tests: treated as connected). */
  youtubeConnected?(account?: string): Promise<boolean>;
  /** true = delivered, false = failed, undefined/void = Discord not configured. */
  notify(msg: DiscordMessage): Promise<boolean | undefined | void>;
  /** True when PUBLIC_URL answers (or is local), so approval links could have been used. */
  publicReachable(): Promise<boolean>;
  now(): Date;
}

const IN_FLIGHT = [
  "selected",
  "scripted",
  "voiced",
  "rendered",
  "awaiting_approval",
  "approved",
  "uploading",
];

export function episodeDir(cfg: Config, id: string): string {
  return path.join(cfg.dataDir, "episodes", id);
}

export function approvalLinks(cfg: Config, id: string) {
  const ttl = 3 * 24 * 3600;
  const t = (action: string) =>
    signToken(`${action}:${id}`, cfg.appSecret, ttl);
  return {
    approve: `${cfg.publicUrl}/episodes/${id}/approve?t=${t("approve")}`,
    reject: `${cfg.publicUrl}/episodes/${id}/reject?t=${t("reject")}`,
    preview: `${cfg.publicUrl}/episodes/${id}/video.mp4?t=${t("preview")}`,
  };
}

// ---------------------------------------------------------------- selection

/**
 * Discovery on its own clock: fetch the feeds, cluster, and remember when each
 * story was first seen. Selection reads these sightings and never refetches.
 */
export async function discoverTick(s: Services): Promise<number> {
  const clusters = await s.discover();
  const now = s.now();
  for (const c of clusters) {
    await s.db.query(
      `INSERT INTO cluster_sightings (hash, headline, first_seen, last_seen, item_count, has_official, max_score, cluster_json)
       VALUES ($1, $2, least($3::timestamptz, $8::timestamptz), $3, $4, $5, $6, $7)
       ON CONFLICT (hash) DO UPDATE SET last_seen = EXCLUDED.last_seen, item_count = EXCLUDED.item_count,
         has_official = cluster_sightings.has_official OR EXCLUDED.has_official,
         max_score = greatest(cluster_sightings.max_score, EXCLUDED.max_score), cluster_json = EXCLUDED.cluster_json, headline = EXCLUDED.headline`,
      // first_seen never predates the poll but never postdates the newest article either, so a
      // restart does not make every old story look minutes old.
      [
        c.hash,
        c.headline,
        now,
        c.items.length,
        c.hasOfficial,
        c.score,
        JSON.stringify(c),
        new Date(c.newestAt),
      ],
    );
  }
  // Age is measured on the pipeline's clock (s.now()), the same one that stamped last_seen.
  await s.db.query(
    `DELETE FROM cluster_sightings WHERE last_seen < $1::timestamptz - interval '7 days'`,
    [now],
  );
  return clusters.length;
}

async function recentSightings(
  s: Services,
): Promise<Array<{ cluster: StoryCluster; sighting: Sighting }>> {
  const rows = await s.db.query<Sighting & { cluster_json: StoryCluster }>(
    // Judged by the factory's clock, like every other hold, so the scheduler is testable.
    `SELECT hash, first_seen, last_seen, item_count, has_official, max_score, cluster_json FROM cluster_sightings WHERE last_seen > $2::timestamptz - ($1 || ' hours')::interval ORDER BY max_score DESC`,
    [String(s.cfg.maxStoryAgeHours), s.now()],
  );
  return rows.map((r) => ({ cluster: r.cluster_json, sighting: r }));
}

/**
 * Uploads still due before YouTube's quota resets (midnight Pacific): the news slots, the evening
 * feature, and the deals and long-video slots on their days. Slots after the reset spend the next
 * day's quota, so they are not counted against this one.
 */
export function uploadsLeftToday(cfg: Config, now: Date): number {
  const reset = quotaResetAt(now).getTime();
  const today = dayKey(now, cfg.timezone);
  let n = 0;
  for (const d of [today, addDays(today, 1)]) {
    const day = weekday(localTime(d, "12:00", cfg.timezone), cfg.timezone);
    const slots = [...cfg.newsSlots, cfg.weeklySlot];
    if (cfg.dealsDays.includes(day)) slots.push(cfg.dealsSlot);
    if (cfg.longformEnabled && cfg.longformDays.includes(day))
      slots.push(cfg.longformSlot);
    if (cfg.whyEnabled && cfg.whyDays.includes(day)) slots.push(cfg.whySlot);
    for (const slot of slots) {
      const t = localTime(d, slot, cfg.timezone).getTime();
      if (t > now.getTime() && t < reset) n++;
    }
  }
  return n;
}

/** Episodes that will still upload: in production, awaiting approval or waiting to upload. */
async function uploadsInFlight(db: Db): Promise<number> {
  const [row] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes WHERE status IN ('selected','scripted','voiced','rendered','awaiting_approval','approved','uploading')`,
  );
  return Number(row?.n ?? 0);
}

/** Units this quota day can still spend on an extra upload once every due and in-flight upload is covered. */
export function spareUnits(
  cfg: Config,
  used: number,
  dueUploads: number,
  inFlight: number,
): number {
  return (
    cfg.quotaUnitsPerDay -
    used -
    QUOTA_RESERVE_FOR_UPLOAD * (dueUploads + inFlight)
  );
}

// The spare-quota lane runs in the last hours before the reset, and starts nothing in the final hour
// (production takes up to about forty minutes and the upload must land before the reset).
const SPARE_WINDOW_MINUTES = 180;
const SPARE_LAST_START_MINUTES = 60;

/**
 * Spare quota. Whatever YouTube quota is unspent at the reset is lost, so in the last hours of the
 * quota day (about 05:00 to 07:00 in London) the factory makes an extra evergreen Short with what is
 * left and uploads it scheduled for a good publish time later that day. The upload spends today's
 * quota; the publish lands at a US-friendly hour. One a tick, while the spare covers another upload.
 */
export async function maybeSelectSpare(
  s: Services,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.spareUploads || !cfg.evergreenEnabled) return undefined;
  const now = s.now();
  const minutesLeft = (quotaResetAt(now).getTime() - now.getTime()) / 60_000;
  if (
    minutesLeft > SPARE_WINDOW_MINUTES ||
    minutesLeft < SPARE_LAST_START_MINUTES
  )
    return undefined;
  const spare = spareUnits(
    cfg,
    await quotaUsed(db, now),
    uploadsLeftToday(cfg, now),
    await uploadsInFlight(db),
  );
  if (spare < QUOTA_RESERVE_FOR_UPLOAD) return undefined;
  // At most one editor call every 20 minutes: a topic the editor passes on is not retried every tick.
  if (await weeklyTried(db, `spare:${Math.floor(now.getTime() / 1_200_000)}`))
    return undefined;
  const taken = new Set((await takenSlots(db)).map((t) => t.getTime()));
  const today = dayKey(now, cfg.timezone);
  const slotAt = [today, addDays(today, 1)]
    .flatMap((d) => cfg.spareSlots.map((x) => localTime(d, x, cfg.timezone)))
    // In the order given (best US hour first), today before tomorrow.
    .find(
      (t) =>
        t.getTime() > now.getTime() + 3 * 3_600_000 && !taken.has(t.getTime()),
    );
  if (!slotAt) return undefined;
  const id = await createEvergreen(s, slotAt, true);
  if (id)
    log("info", "spare quota Short selected", {
      id,
      spare,
      slot: slotAt.toISOString(),
    });
  return id;
}

/** Units free for optional work (comment replies, sprints) once every upload still due today is covered. */
export async function quotaHeadroom(
  db: Db,
  cfg: Config,
  now: Date,
): Promise<number> {
  return (
    cfg.quotaUnitsPerDay -
    (await quotaUsed(db, now)) -
    QUOTA_RESERVE_FOR_UPLOAD * uploadsLeftToday(cfg, now)
  );
}

/**
 * A franchise the channel leans into for a while (GTA in the four weeks before GTA 6): told to every
 * editor that picks a story or a topic, as a tie-breaker and a source of angles, never a reason to run
 * a weak story or repeat one.
 */
export function focusBlock(cfg: Config, now: Date): string {
  if (!cfg.focusTopic) return "";
  if (
    cfg.focusUntil &&
    now.getTime() > new Date(`${cfg.focusUntil}T23:59:59Z`).getTime()
  )
    return "";
  const wave = launchWave(cfg, now)
    ? ` LAUNCH WEEK: this is the launch wave for ${cfg.focusTopic}. Cover it from every angle (reviews, performance, hidden details, what fans are finding, how it compares, prices and editions) and prefer a strong ${cfg.focusTopic} story over anything of equal weight.`
    : "";
  return `Channel focus${cfg.focusUntil ? ` until ${cfg.focusUntil}` : ""}: ${cfg.focusTopic}.${cfg.focusNote ? ` ${cfg.focusNote}` : ""} When a ${cfg.focusTopic} story or topic is as strong as the alternatives, pick it, and prefer fresh angles (history, hidden details, why things happened, what fans argue about) over repeating news already covered. Never pick a weak story or invent one because of the focus.${wave}`;
}

/** True when a story or title is about the channel focus (FOCUS_MATCH). */
export function focusMatch(cfg: Config, text: string): boolean {
  if (!cfg.focusMatch) return false;
  try {
    return new RegExp(cfg.focusMatch, "i").test(text);
  } catch {
    return false;
  }
}

/** True during a launch wave (LAUNCH_WAVE_FROM to LAUNCH_WAVE_TO, London dates): extra Shorts on the focus. */
export function launchWave(cfg: Config, now: Date): boolean {
  if (!cfg.waveFrom || !cfg.waveTo || !cfg.focusTopic) return false;
  const day = dayKey(now, cfg.timezone);
  return day >= cfg.waveFrom && day <= cfg.waveTo;
}

// Named series shelves. The channels that grew fastest file every video in a playlist named the way
// people search, and point their end screens at them; a series also tells YouTube who the video is for.
const SERIES = {
  rankedLong: {
    title: "Every Game Ranked: Worst to Best",
    description:
      "Pulse Gaming's full rankings: every game in a series, ranked on one clear rule and explained. A new ranking every Saturday.",
  },
  weekly: {
    title: "The Pulse Weekly: This Week in Gaming",
    description:
      "The week's biggest gaming stories, checked and explained. Every Friday.",
  },
  docs: {
    title: "Gaming Documentaries",
    description: "The stories behind the games, checked and explained.",
  },
  why: {
    title: "The Why: Gaming's Biggest Questions",
    description:
      "One question fans argue about, answered from the record in under a minute. A new one every day.",
  },
  rankedShort: {
    title: "Ranked in 60 Seconds",
    description: "Game rankings in under a minute, one clear rule each.",
  },
  news: {
    title: "Gaming News Today",
    description:
      "Fast gaming news, checked and explained. New Shorts every day.",
  },
};

/** The playlists a published video belongs to. */
export function seriesFor(
  cfg: Config,
  ep: Episode,
  now: Date,
): Array<{ title: string; description: string }> {
  const sc = ep.script_json;
  if (!sc) return [];
  const out: Array<{ title: string; description: string }> = [];
  if (sc.recap) out.push(SERIES.weekly);
  else if (sc.runtime === "long")
    out.push(
      sc.evergreen_format === "documentary" ? SERIES.docs : SERIES.rankedLong,
    );
  else if (ep.story_hash?.startsWith("why:")) out.push(SERIES.why);
  else if (
    ep.lane === "cutdown" ||
    (ep.lane === "evergreen" && sc.entries?.length)
  )
    out.push(SERIES.rankedShort);
  else if (ep.lane === "news" || ep.lane === "news_breaking")
    out.push(SERIES.news);
  const focusOn =
    cfg.focusPlaylist &&
    (!cfg.focusUntil || dayKey(now, cfg.timezone) <= cfg.focusUntil);
  if (
    focusOn &&
    focusMatch(
      cfg,
      `${sc.game_title} ${sc.headline} ${sc.youtube?.title ?? ""}`,
    )
  )
    out.push({
      title: cfg.focusPlaylist,
      description: `${cfg.focusTopic} news, explainers and rankings from Pulse Gaming.${cfg.focusNote ? ` ${cfg.focusNote}` : ""}`,
    });
  return out;
}

/** The YouTube login an episode belongs to: "" for the main channel, the twin's account for a twin. */
export function accountOf(ep: Pick<Episode, "story_json">): string {
  return ep.story_json.twin?.account ?? "";
}

/** Files a published video in its series playlists (50 units each, plus 50 the first time a playlist is made). */
async function addToSeries(s: Services, ep: Episode): Promise<void> {
  if (ep.lane === "twin") return; // the twin channel's playlists are not set up
  const yt = s.youtube() as Partial<{
    findOrCreatePlaylist: (
      t: string,
      d: string,
    ) => Promise<{ id: string; created: boolean }>;
    addToPlaylist: (p: string, v: string) => Promise<void>;
  }>;
  if (!yt.findOrCreatePlaylist || !yt.addToPlaylist || !ep.youtube_video_id)
    return;
  for (const series of seriesFor(s.cfg, ep, s.now())) {
    try {
      const key = `playlist:${series.title}`;
      const [row] = await s.db.query<{ value: string }>(
        `SELECT value FROM settings WHERE key = $1`,
        [key],
      );
      let id = row?.value;
      if (!id) {
        const made = await yt.findOrCreatePlaylist(
          series.title,
          series.description,
        );
        await quotaAdd(s.db, s.now(), made.created ? 51 : 1);
        id = made.id;
        await s.db.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [key, id],
        );
      }
      await yt.addToPlaylist(id, ep.youtube_video_id);
      await quotaAdd(s.db, s.now(), QUOTA.comment);
      await logEvent(s.db, ep.id, "playlist", { title: series.title });
    } catch (err) {
      log("warn", "playlist add failed", {
        episode: ep.id,
        playlist: series.title,
        error: errorMessage(err),
      });
    }
  }
}

/** For ranking topic pickers: YouTube's trending gaming videos and what viewers asked us to rank. */
/** The calendar's plan for a lane: today's entries, and the next days' for the news desk. */
export function calendarFor(
  cfg: Config,
  now: Date,
  lane: CalendarLane,
  aheadDays = 0,
): string {
  if (!cfg.calendarFile) return "";
  const today = dayKey(now, cfg.timezone);
  const ahead = Array.from({ length: aheadDays }, (_, i) =>
    addDays(today, i + 1),
  );
  return calendarBlock(readCalendar(cfg.calendarFile), today, lane, ahead);
}

/**
 * Questions people type into YouTube where the answers are old, off-target or long videos (search_gaps.md,
 * from the 26 Oct 2026 demand study): almost none had a Short among the top 20 results.
 */
export function searchGapsBlock(file: string): string {
  if (!file) return "";
  let md = "";
  try {
    md = readFileSync(file, "utf8");
  } catch {
    return "";
  }
  const lines = md
    .split(/\r?\n/)
    .filter((l) => l.startsWith("- "))
    .slice(0, 60);
  if (!lines.length) return "";
  return `Questions people search for on YouTube where the answers are stale, off-target or 20-minute videos (almost no Shorts answer them). When a candidate can honestly answer one, prefer it and use the searcher's own words in the question and the title:\n${lines.join("\n")}`;
}

async function topicDemand(
  s: Services,
  lane: CalendarLane = "any",
): Promise<string> {
  return [
    focusBlock(s.cfg, s.now()),
    hotBlock(await readHotTopic(s.db, s.now()).catch(() => undefined)),
    calendarFor(s.cfg, s.now(), lane),
    searchGapsBlock(s.cfg.searchGapsFile),
    trendingBlock(await s.trending().catch(() => []), 25),
    requestsBlock(await readRequests(s.db).catch(() => undefined)),
    pollBlock(await readPoll(s.db).catch(() => undefined), s.now()),
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function createFromChoice(
  s: Services,
  candidates: StoryCluster[],
  lane: { lane: string; priority: number; slotAt?: Date },
  why: string,
): Promise<string | undefined> {
  const { db } = s;
  const pool = candidates;
  const choice = await selectStory(
    s.llm,
    pool,
    await recentHeadlines(db),
    [
      focusBlock(s.cfg, s.now()),
      hotBlock(await readHotTopic(db, s.now()).catch(() => undefined)),
      calendarFor(s.cfg, s.now(), "news", 3),
      await performanceNotes(db, s.now()).catch(() => ""),
      await retentionNotes(db, s.now()).catch(() => ""),
      trendingBlock(await s.trending().catch(() => [])),
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
  const picked = pool[choice.candidate_index];
  if (!picked) {
    log("info", "editor passed on every candidate", {
      lane: lane.lane,
      reason: choice.reason,
    });
    return undefined;
  }
  const id = shortId();
  const created = await createEpisode(
    db,
    id,
    {
      ...picked,
      gameHint: choice.game_title || undefined,
      visualNeed: choice.visual_dependency,
    },
    lane,
  );
  await markSeen(
    db,
    picked.hash,
    picked.headline,
    created ? "selected" : "duplicate",
    choice.reason,
  );
  if (!created) return undefined;
  await logEvent(db, id, "selected", {
    headline: picked.headline,
    reason: choice.reason,
    story_type: choice.story_type,
    score: picked.score,
    lane: lane.lane,
    slot_at: lane.slotAt?.toISOString() ?? null,
    why,
  });
  log("info", "story selected", {
    id,
    lane: lane.lane,
    headline: picked.headline,
    slot: lane.slotAt?.toISOString(),
  });
  return id;
}

/**
 * Two lanes, one producer. The breaking lane fires on a massive official story
 * seen for the first time minutes ago, any time inside its window, at most a
 * few times a day with a per-franchise cooldown. The news lane fills fixed
 * daily slots: an episode is started a lead time before its slot and
 * publishes at the slot. Episodes waiting on approval or YouTube never block
 * the next one; only MAX_PRODUCING episodes are mid-production at once.
 */
export async function maybeSelect(s: Services): Promise<string | undefined> {
  const { db, cfg } = s;
  const now = s.now();
  const paused = await selectionPause(db, now);
  if (paused) {
    log("info", "story selection paused", { reason: paused });
    return undefined;
  }
  if ((await countProducing(db)) >= cfg.maxProducing) return undefined;
  const cut = await maybeSelectCutdown(s).catch((err) => {
    log("warn", "cutdown selection failed", { error: errorMessage(err) });
    return undefined;
  });
  if (cut) return cut;
  // Spare-quota Shorts are extra: they never take one of the day's planned Shorts.
  const total =
    (await countToday(db, cfg.timezone)) -
    (await countSpareToday(db, cfg.timezone));
  if (total >= cfg.dailyTarget + (launchWave(cfg, now) ? cfg.sprintExtra : 0))
    return (await maybeSelectSpare(s)) ?? undefined;

  const seen = await seenHashes(db);
  const sightings = (await recentSightings(s)).filter(
    (x) => !seen.has(x.cluster.hash),
  );
  // Rumours are capped a day: once today's is in, stories carrying rumour signals wait for tomorrow.
  const rumoursToday = cfg.includeRumours
    ? await countRumoursToday(db, cfg.timezone)
    : 0;
  const eligible = sightings
    .filter(
      (x) =>
        x.cluster.corroborated ||
        (cfg.includeRumours && x.cluster.rumourSignals),
    )
    .filter(
      (x) => !(x.cluster.rumourSignals && rumoursToday >= cfg.rumoursPerDay),
    )
    .filter((x) => x.cluster.score > 0);

  // 1. Breaking lane. During a live showcase (a Direct, a State of Play) it sprints: a few more
  // Shorts that day and a lower bar for the showcase's own stories, but only while the quota still
  // covers every upload already scheduled for today.
  const showcase = showcaseLive(eligible, now);
  const wave = launchWave(cfg, now);
  const sprint =
    (!!showcase || wave) &&
    (await quotaHeadroom(db, cfg, now)) >= QUOTA_RESERVE_FOR_UPLOAD;
  if (
    cfg.breakingEnabled &&
    (await countToday(db, cfg.timezone, "news_breaking")) <
      cfg.breakingPerDay + (sprint ? cfg.sprintExtra : 0)
  ) {
    const rule = {
      scoreMin: cfg.breakingScoreMin,
      maxAgeMinutes: cfg.breakingMaxAgeMinutes,
      window: cfg.breakingWindow,
      timeZone: cfg.timezone,
    };
    const cooled = new Set(
      (
        await db.query<{ franchise: string }>(
          `SELECT franchise FROM breaking_log WHERE fired_at > $2::timestamptz - ($1 || ' hours')::interval`,
          [String(cfg.breakingCooldownHours), now],
        )
      ).map((r) => r.franchise),
    );
    const breaking = eligible
      .filter(
        (x) =>
          (isBreaking(x.cluster, x.sighting, now, rule) ||
            (sprint &&
              (SHOWCASE.test(storyText(x.cluster)) ||
                (wave && focusMatch(cfg, storyText(x.cluster)))) &&
              isBreaking(x.cluster, x.sighting, now, {
                ...rule,
                scoreMin: cfg.sprintScoreMin,
              }))) &&
          !cooled.has(franchiseKey(x.cluster)),
      )
      .map((x) => x.cluster)
      .slice(0, 4);
    if (breaking.length) {
      const id = await createFromChoice(
        s,
        breaking,
        { lane: "news_breaking", priority: LANE_PRIORITY.news_breaking },
        "breaking: official, fresh and scored above the bar",
      );
      if (id) {
        const ep = await getEpisode(db, id);
        await db.query(
          `INSERT INTO breaking_log (story_hash, franchise, episode_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [ep!.story_hash, franchiseKey(ep!.story_json), id],
        );
        await s.notify({
          level: "info",
          content: `Breaking story picked${sprint ? ` (${showcase ?? `${cfg.focusTopic} launch wave`})` : ""}: "${ep!.story_json.headline}"`,
        });
        return id;
      }
    }
  }

  // 2. News lane: the next slot whose lead time has begun.
  const slot = dueSlot(
    now,
    {
      slots: cfg.newsSlots,
      leadMinutes: cfg.slotLeadMinutes,
      graceMinutes: cfg.slotGraceMinutes,
      timeZone: cfg.timezone,
    },
    await takenSlots(db),
  );
  if (!slot)
    return (
      (await maybeSelectDocumentary(s)) ??
      (await maybeSelectEvergreen(s)) ??
      (await maybeSelectWeekly(s)) ??
      (await maybeSelectLongform(s)) ??
      (await maybeSelectWhy(s)) ??
      (await maybeSelectSpare(s))
    );
  const candidates = eligible.map((x) => x.cluster).slice(0, 12);
  if (candidates.length === 0) {
    log("info", "no eligible stories for the slot", {
      slot: slot.toISOString(),
      sightings: sightings.length,
    });
    return undefined;
  }
  return createFromChoice(
    s,
    candidates,
    { lane: "news", priority: LANE_PRIORITY.news, slotAt: slot },
    `news slot ${slot.toISOString()}`,
  );
}

/**
 * Evergreen lane: on its days, a lead time before its slot, pick a ranking
 * topic from what people are buying and the franchise seeds, avoiding topics
 * covered in the last six months.
 */
export async function maybeSelectEvergreen(
  s: Services,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.evergreenEnabled) return undefined;
  const now = s.now();
  const due = evergreenDue(
    now,
    {
      days: cfg.evergreenDays,
      slot: cfg.evergreenSlot,
      leadMinutes: cfg.slotLeadMinutes + 45,
      graceMinutes: cfg.slotGraceMinutes,
      timeZone: cfg.timezone,
    },
    await takenSlots(db),
  );
  if (!due) return undefined;
  return createEvergreen(s, due);
}

/** Picks an evergreen ranking topic and creates its episode for `due`; `spare` marks a spare-quota Short. */
async function createEvergreen(
  s: Services,
  due: Date,
  spare = false,
): Promise<string | undefined> {
  const { db } = s;
  const now = s.now();
  const covered = (
    await db.query<{ headline: string }>(
      `SELECT story_json->>'headline' AS headline FROM episodes WHERE lane = 'evergreen' AND status NOT IN ('failed','rejected') AND created_at > $1::timestamptz - interval '180 days'`,
      [now],
    )
  ).map((r) => r.headline);
  const candidates = await s.discoverEvergreen();
  if (!candidates.length) return undefined;
  const topic = await selectEvergreenTopic(
    s.llm,
    candidates,
    covered,
    await topicDemand(s, "evergreen"),
  );
  if (topic.candidate_index < 0 || !candidates[topic.candidate_index]) {
    log("info", "editor passed on every evergreen candidate", {
      reason: topic.reason,
    });
    return undefined;
  }
  const slug = topic.theme
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const cluster: StoryCluster = {
    hash: `evergreen:${topic.format}:${slug}:${now.toISOString().slice(0, 7)}`,
    headline: topic.title_idea,
    items: [],
    sources: ["Steam"],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: false,
    newestAt: now.toISOString(),
    score: 0,
    gameHint: topic.theme,
  };
  const id = shortId();
  const created = await createEpisode(db, id, cluster, {
    lane: "evergreen",
    priority: LANE_PRIORITY.evergreen,
    slotAt: due,
  });
  if (!created) return undefined;
  await db.query(
    `UPDATE episodes SET script_json = NULL, factcheck_json = $2 WHERE id = $1`,
    [id, JSON.stringify(spare ? { topic, spare: true } : { topic })],
  );
  await logEvent(db, id, "selected", {
    headline: topic.title_idea,
    lane: "evergreen",
    spare,
    format: topic.format,
    theme: topic.theme,
    criterion: topic.criterion,
    reason: topic.reason,
    slot_at: due.toISOString(),
  });
  log("info", "evergreen topic selected", {
    id,
    format: topic.format,
    theme: topic.theme,
  });
  return id;
}

/**
 * The "Why" lane: on its days, a lead time before its slot, the editor picks one question about a
 * well-known game that its Wikipedia article can answer; the Short is then written and fact-checked
 * like a news Short, from that article.
 */
export async function maybeSelectWhy(s: Services): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.whyEnabled) return undefined;
  const now = s.now();
  const due = evergreenDue(
    now,
    {
      days: cfg.whyDays,
      slot: cfg.whySlot,
      leadMinutes: cfg.slotLeadMinutes + 30,
      graceMinutes: cfg.slotGraceMinutes,
      timeZone: cfg.timezone,
    },
    await takenSlots(db),
  );
  if (!due) return undefined;
  // One editor call per slot: a pass is not retried every tick.
  if (await weeklyTried(db, `why:${due.toISOString()}`)) return undefined;
  const covered = (
    await db.query<{ headline: string }>(
      `SELECT story_json->>'headline' AS headline FROM episodes WHERE story_hash LIKE 'why:%' AND created_at > $1::timestamptz - interval '120 days'`,
      [now],
    )
  ).map((r) => r.headline);
  const candidates = await s.discoverEvergreen();
  if (!candidates.length) return undefined;
  const topic = await selectWhyTopic(
    s.llm,
    candidates,
    covered,
    await topicDemand(s, "why"),
  );
  if (topic.candidate_index < 0) {
    log("info", "editor passed on every why question", {
      reason: topic.reason,
    });
    return undefined;
  }
  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(topic.wikipedia_title.replace(/ /g, "_"))}`;
  const article = await s.fetchArticle(url);
  if (!article) {
    log("info", "why question has no usable Wikipedia article", {
      title: topic.wikipedia_title,
    });
    return undefined;
  }
  const slug = topic.question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  const cluster: StoryCluster = {
    hash: `why:${slug}`,
    headline: topic.title,
    items: [
      {
        title: article.title,
        url,
        summary: "",
        publishedAt: now.toISOString(),
        source: "Wikipedia",
        sourceKind: "outlet",
      },
    ],
    sources: ["Wikipedia"],
    hasOfficial: false,
    corroborated: true,
    rumourSignals: false,
    newestAt: now.toISOString(),
    score: 0,
    gameHint: topic.game,
    visualNeed: "game_footage",
    why: { question: topic.question, angle: topic.angle },
  };
  const id = shortId();
  if (
    !(await createEpisode(db, id, cluster, {
      lane: "news",
      priority: LANE_PRIORITY.news,
      slotAt: due,
    }))
  )
    return undefined;
  await logEvent(db, id, "selected", {
    headline: topic.title,
    lane: "why",
    question: topic.question,
    game: topic.game,
    reason: topic.reason,
    slot_at: due.toISOString(),
  });
  log("info", "why question selected", {
    id,
    question: topic.question,
    game: topic.game,
  });
  return id;
}

/** Spare-quota Shorts created today (owner's day), which sit outside the daily target. */
async function countSpareToday(db: Db, timeZone: string): Promise<number> {
  const [row] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes
      WHERE created_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1
        AND status NOT IN ('failed','rejected') AND factcheck_json->>'spare' = 'true'`,
    [timeZone],
  );
  return Number(row?.n ?? 0);
}

/** Once per day and kind: a weekly lane that found too little data does not retry every tick. */
async function weeklyTried(db: Db, key: string): Promise<boolean> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [`weekly_tried:${key}`],
  );
  if (row) return true;
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, 'yes') ON CONFLICT (key) DO NOTHING`,
    [`weekly_tried:${key}`],
  );
  return false;
}

/**
 * The weekly lanes, each on its own day at the weekly slot: Release Radar
 * (Steam's popular releases this week), Free This Week (Epic's giveaway, a
 * news-style Short from the store's own data) and the Weekly Recap (the
 * week's biggest corroborated stories from the factory's own sightings).
 */
export async function maybeSelectWeekly(
  s: Services,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.weeklyEnabled) return undefined;
  const now = s.now();
  const today = dayKey(now, cfg.timezone);
  const plan = (days: string[]) => ({
    days,
    slot: cfg.weeklySlot,
    leadMinutes: cfg.slotLeadMinutes + 30,
    graceMinutes: cfg.slotGraceMinutes,
    timeZone: cfg.timezone,
  });
  const taken = await takenSlots(db);
  const make = async (
    kind: string,
    cluster: StoryCluster,
    due: Date,
    factcheck: Record<string, unknown> | null,
    lane: "evergreen" | "free",
  ) => {
    const id = shortId();
    if (
      !(await createEpisode(db, id, cluster, {
        lane,
        priority: LANE_PRIORITY[lane],
        slotAt: due,
      }))
    )
      return undefined;
    if (factcheck)
      await db.query(
        `UPDATE episodes SET script_json = NULL, factcheck_json = $2 WHERE id = $1`,
        [id, JSON.stringify(factcheck)],
      );
    await logEvent(db, id, "selected", {
      headline: cluster.headline,
      lane,
      weekly: kind,
      slot_at: due.toISOString(),
    });
    log("info", "weekly lane selected", {
      id,
      kind,
      headline: cluster.headline,
    });
    return id;
  };
  const base = (
    hash: string,
    headline: string,
    gameHint: string,
  ): StoryCluster => ({
    hash,
    headline,
    items: [],
    sources: ["Steam"],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: false,
    newestAt: now.toISOString(),
    score: 0,
    gameHint,
  });

  // Steam's biggest climbers: real chart movement, each with the publisher's own news for the why.
  const climbDue = (await formatOpen(db, "steam_climbers", now))
    ? evergreenDue(now, plan(cfg.climbersDays), taken)
    : undefined;
  if (climbDue && !(await weeklyTried(db, `climbers:${today}`))) {
    const games = await s.steamClimbers(now);
    if (games.length >= 4) {
      const topic = {
        candidate_index: 0,
        format: "steam_climbers" as const,
        theme: "Steam charts",
        title_idea: "The Games That Exploded on Steam This Week",
        criterion: "Places climbed on Steam's most-played chart this week",
        reason: "weekly Steam climbers",
      };
      const brief = games
        .map(
          (g) =>
            `- ${g.name} | ${g.lastRank === undefined ? `new to the top 100 at #${g.rank}` : `#${g.rank} this week, #${g.lastRank} last week (up ${g.climb})`} | peak ${g.peak} players | released ${g.year ?? "unknown"} | Steam news: ${g.news.length ? g.news.join(" || ") : "none in the last two weeks"}`,
        )
        .join("\n");
      const climbers = games.map((g) => ({
        name: g.name,
        rank: g.rank,
        lastRank: g.lastRank,
        climb: g.climb,
        peak: g.peak,
        year: g.year,
      }));
      return make(
        "climbers",
        base(`weekly:climbers:${today}`, topic.title_idea, "Steam charts"),
        climbDue,
        { topic, brief, climbers },
        "evergreen",
      );
    }
    log("info", "steam climbers skipped: too few games climbed", {
      found: games.length,
    });
  }

  // Release Radar
  const radarDue = (await formatOpen(db, "release_radar", now))
    ? evergreenDue(now, plan(cfg.radarDays), taken)
    : undefined;
  if (radarDue && !(await weeklyTried(db, `radar:${today}`))) {
    const games = await s.releaseRadar(now);
    if (games.length >= 4) {
      const topic = {
        candidate_index: 0,
        format: "release_radar" as const,
        theme: "New games this week",
        title_idea: `${games.length} Big Games Out This Week`,
        criterion: "Release order, earliest first",
        reason: "weekly release radar",
      };
      const brief = games
        .map(
          (g) =>
            `- ${g.name} | out ${g.date} | ${g.price ?? "price not listed"} | developer ${g.developer ?? "unknown"} | Steam app ${g.appId}`,
        )
        .join("\n");
      return make(
        "radar",
        base(`weekly:radar:${today}`, topic.title_idea, "New games"),
        radarDue,
        { topic, brief },
        "evergreen",
      );
    }
    log("info", "release radar skipped: too few dated releases this week", {
      found: games.length,
    });
  }

  // Free This Week
  const freeDue = (await formatOpen(db, "free", now))
    ? evergreenDue(now, plan(cfg.freeDays), taken)
    : undefined;
  if (freeDue && !(await weeklyTried(db, `free:${today}`))) {
    const free = await s.freeGames(now);
    if (free.now.length) {
      const until = (iso?: string) =>
        iso
          ? new Intl.DateTimeFormat("en-US", {
              timeZone: "America/New_York",
              weekday: "long",
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }).format(new Date(iso)) + " Eastern"
          : "next week";
      const nextLine = free.next.length
        ? ` Next week's free ${free.next.length > 1 ? "games are" : "game is"} ${free.next.map((g) => g.title).join(" and ")}, from ${until(free.next[0]!.starts)}.`
        : "";
      const items = free.now.map((g) => ({
        title: `${g.title} is free to keep on the Epic Games Store`,
        url: g.url,
        summary: `${g.title} is free to keep on the Epic Games Store until ${until(g.until)}.${g.originalPrice ? ` It normally costs ${g.originalPrice}.` : ""}${g.seller ? ` Published by ${g.seller}.` : ""} ${g.description}${nextLine}`,
        publishedAt: now.toISOString(),
        source: "Epic Games Store",
        sourceKind: "official" as const,
        imageUrl: g.imageUrl,
      }));
      const headline = `Free To Keep This Week: ${free.now.map((g) => g.title).join(" And ")}`;
      const cluster: StoryCluster = {
        ...base(
          `weekly:free:${today}:${free.now
            .map((g) => g.title)
            .join("|")
            .toLowerCase()}`,
          headline,
          free.now[0]!.title,
        ),
        items,
        sources: ["Epic Games Store"],
        visualNeed: "game_footage",
      };
      return make("free", cluster, freeDue, null, "free");
    }
    log("info", "free this week skipped: nothing free on Epic right now");
  }

  // Achievement Hunt: odd ISO weeks the rarest in one big game, even weeks the hardest across today's biggest games.
  const achDue = (await formatOpen(db, "achievements", now))
    ? evergreenDue(now, plan(cfg.achievementDays), taken)
    : undefined;
  if (achDue && !(await weeklyTried(db, `achievements:${today}`))) {
    const week = Math.floor(
      (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
        Date.UTC(now.getUTCFullYear(), 0, 1)) /
        (7 * 86_400_000),
    );
    const across = week % 2 === 0;
    const covered = (
      await db.query<{ headline: string }>(
        `SELECT story_json->>'headline' AS headline FROM episodes WHERE lane = 'evergreen' AND created_at > $1::timestamptz - interval '120 days'`,
        [now],
      )
    ).map((r) => r.headline.toLowerCase());
    // Established games first (the franchise seeds), then what is selling now.
    const candidates = await s.discoverEvergreen();
    const pool = [
      ...candidates.filter((c) => c.source !== "steam top sellers"),
      ...candidates.filter((c) => c.source === "steam top sellers"),
    ]
      .map((c) => c.name)
      .filter(
        (n) =>
          !/steam deck|steam machine|controller|bundle|soundtrack/i.test(n),
      );
    const games: Array<{
      game: string;
      appId: number;
      year?: number;
      list: Achievement[];
    }> = [];
    for (const name of pool.slice(0, 24)) {
      const app = await s.findGame(name).catch(() => undefined);
      if (!app) continue;
      const list = rarest(await s.achievements(app.appId), 6);
      if (list.length < (across ? 1 : 5)) continue;
      const year =
        Number(
          String(app.details?.release_date?.date ?? "").match(
            /\b(19|20)\d\d\b/,
          )?.[0],
        ) || undefined;
      // A game out for under a year has "rare" achievements only because few have finished it yet.
      if (!year || year > now.getUTCFullYear() - 1) continue;
      if (!across && (list.at(-1)?.percent ?? 0) < 0.5) continue;
      // Steam names carry trademark marks ("Call of Duty®"), which look sloppy on a card.
      const game = app.name.replace(/[®™©]/g, "").replace(/\s+/g, " ").trim();
      games.push({ game, appId: app.appId, year, list });
      if (!across && !covered.some((h) => h.includes(game.toLowerCase())))
        break;
      if (across && games.length >= 8) break;
    }
    const single = !across
      ? games.find(
          (g) =>
            g.list.length >= 5 &&
            !covered.some((h) => h.includes(g.game.toLowerCase())),
        )
      : undefined;
    const rows = across
      ? games
          .map((g) => ({ ...g.list[0]!, game: g.game, year: g.year }))
          .filter((r) => r.percent <= 10)
          .sort((a, b) => a.percent - b.percent)
          .slice(0, 6)
      : (single?.list ?? []).map((a) => ({
          ...a,
          game: single!.game,
          year: single!.year,
        }));
    if (rows.length >= 4) {
      const format = across
        ? ("hardest_achievements" as const)
        : ("rarest_achievements" as const);
      const theme = across ? "Achievements" : single!.game;
      const topic = {
        candidate_index: 0,
        format,
        theme,
        title_idea: across
          ? "The Hardest Achievements in Gaming Right Now"
          : `The Rarest Achievements in ${single!.game}`,
        criterion: "Share of players who unlocked it (Steam global stats)",
        reason: "weekly achievement hunt",
      };
      const brief = rows
        .map(
          (r) =>
            `- ${r.name} | ${r.game}${r.year ? ` (${r.year})` : ""} | ${r.percent}% of players | ${r.description || "description hidden"}`,
        )
        .join("\n");
      const achievements = rows.map((r) => ({
        name: r.name,
        game: r.game,
        percent: r.percent,
        icon: r.icon,
        year: r.year,
      }));
      return make(
        "achievements",
        base(`weekly:achievements:${today}`, topic.title_idea, theme),
        achDue,
        { topic, brief, achievements },
        "evergreen",
      );
    }
    log("info", "achievement hunt skipped: not enough achievement data", {
      games: games.length,
    });
  }

  // Steam deals: their own daily slot, only when at least four strong deals are new to the channel.
  // Each format's slot is open only while it earns it (src/formats.ts); deals always run in a Steam sale.
  const dealsDue = (await formatOpen(db, "steam_deals", now))
    ? evergreenDue(now, { ...plan(cfg.dealsDays), slot: cfg.dealsSlot }, taken)
    : undefined;
  if (dealsDue && !(await weeklyTried(db, `deals:${today}`))) {
    const recent = await db.query<{ script_json: Script }>(
      `SELECT script_json FROM episodes WHERE lane = 'evergreen' AND script_json->>'evergreen_format' = 'steam_deals' AND created_at > $1`,
      [new Date(now.getTime() - 14 * 86_400_000)],
    );
    const exclude = recent.flatMap(
      (r) => r.script_json?.entries?.map((e) => e.game_title) ?? [],
    );
    const deals = await s.steamDeals(exclude);
    if (deals.length >= 4) {
      const topic = {
        candidate_index: 0,
        format: "steam_deals" as const,
        theme: "Steam deals",
        title_idea: `${deals.length} Great Steam Games on Sale Right Now`,
        criterion: "The biggest cut on the best-reviewed games",
        reason: "daily Steam deals",
      };
      const brief = deals
        .map(
          (d) =>
            `- ${d.name} | ${d.usd.final}, down from ${d.usd.initial} (${d.usd.pct}% off) | ${d.rating}% positive from ${d.reviews.toLocaleString("en-US")} Steam reviews | released ${d.year ?? "unknown"}`,
        )
        .join("\n");
      return make(
        "deals",
        base(`daily:deals:${today}`, topic.title_idea, "Steam deals"),
        dealsDue,
        { topic, brief, deals },
        "evergreen",
      );
    }
    log("info", "steam deals skipped: too few fresh deals", {
      found: deals.length,
    });
  }

  // Weekly Recap as a long video: the week's most-watched Shorts, one chapter each. Production
  // starts five hours before the slot; with too few stories it falls back to the Short below.
  if (cfg.recapLong && cfg.longformEnabled) {
    const longDue = evergreenDue(
      now,
      { ...plan(cfg.recapDays), leadMinutes: 300 },
      taken,
    );
    if (longDue && !(await weeklyTried(db, `recaplong:${today}`))) {
      const stories = await recapStoryIds(db, now);
      if (stories.length >= RECAP_STORIES_MIN) {
        const id = shortId();
        const cluster = base(
          `weekly:recaplong:${today}`,
          "This Week in Gaming",
          "Gaming news",
        );
        if (
          await createEpisode(db, id, cluster, {
            lane: "longform",
            priority: LANE_PRIORITY.longform,
            slotAt: longDue,
          })
        ) {
          await db.query(
            `UPDATE episodes SET script_json = NULL, factcheck_json = $2 WHERE id = $1`,
            [id, JSON.stringify({ recap: true, stories })],
          );
          await logEvent(db, id, "selected", {
            headline: cluster.headline,
            lane: "longform",
            recap: true,
            stories,
            slot_at: longDue.toISOString(),
          });
          log("info", "weekly recap video selected", {
            id,
            stories: stories.length,
          });
          return id;
        }
      } else
        log("info", "weekly recap video skipped: too few stories", {
          found: stories.length,
        });
    }
  }

  // Weekly Recap
  const recapDue = (await formatOpen(db, "weekly_recap", now))
    ? evergreenDue(now, plan(cfg.recapDays), taken)
    : undefined;
  if (recapDue && !(await weeklyTried(db, `recap:${today}`))) {
    const rows = await db.query<{
      headline: string;
      max_score: number;
      item_count: number;
      has_official: boolean;
      cluster_json: StoryCluster;
      first_seen: string;
    }>(
      `SELECT headline, max_score, item_count, has_official, cluster_json, first_seen FROM cluster_sightings
       WHERE first_seen > $1 AND (has_official OR item_count >= 2) ORDER BY max_score DESC LIMIT 12`,
      [new Date(now.getTime() - 7 * 86_400_000)],
    );
    const stories = rows.filter((r) => !r.cluster_json?.rumourSignals);
    if (stories.length >= 5) {
      const topic = {
        candidate_index: 0,
        format: "weekly_recap" as const,
        theme: "This week in gaming",
        title_idea: "The 5 Biggest Gaming Stories This Week",
        criterion: "How much each story changes things for players",
        reason: "weekly recap",
      };
      const brief = stories
        .slice(0, 10)
        .map(
          (r) =>
            `- ${r.headline} | reported by ${(r.cluster_json?.sources ?? []).slice(0, 3).join(", ") || "outlets"}${r.has_official ? " (official)" : ""} | first seen ${new Date(r.first_seen).toISOString().slice(0, 10)} | ${(r.cluster_json?.items?.[0]?.summary ?? "").slice(0, 220)}`,
        )
        .join("\n");
      return make(
        "recap",
        base(`weekly:recap:${today}`, topic.title_idea, "Gaming news"),
        recapDue,
        { topic, brief },
        "evergreen",
      );
    }
    log("info", "weekly recap skipped: too few corroborated stories", {
      found: stories.length,
    });
  }
  return undefined;
}

/**
 * A documentary paid for by credits that would otherwise be lost: the plan says at least one
 * documentary's worth would go at the reset, there are days enough to make it, and no documentary is
 * already in production.
 */
export async function surplusDocumentary(s: Services): Promise<boolean> {
  const plan = await s.creditPlan?.().catch(() => undefined);
  if (!plan || plan.wasteAtReset < s.cfg.surplusDocChars || plan.daysLeft < 1)
    return false;
  const [busy] = await s.db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes WHERE lane = 'longform' AND factcheck_json->>'doc' = 'true'
       AND status IN ('selected','scripted','voiced','rendered','awaiting_approval','approved')`,
  );
  if (Number(busy?.n ?? 0) > 0) return false;
  log(
    "info",
    "surplus documentary: ElevenLabs credits would be lost at the reset",
    { waste: plan.wasteAtReset, daysLeft: plan.daysLeft },
  );
  return true;
}

/**
 * Where a banked documentary goes: the first documentary evening (SURPLUS_DOC_DAYS at DOC_SLOT) at least
 * 20 hours away (it takes hours to make), clear of the monthly documentary's own evening and an hour from
 * any other scheduled video.
 */
export function nextBankSlot(
  cfg: Config,
  now: Date,
  taken: Date[],
): Date | undefined {
  const today = dayKey(now, cfg.timezone);
  const earliest = now.getTime() + 20 * 3600_000;
  for (let d = 0; d < 180; d++) {
    const at = localTime(addDays(today, d), cfg.docSlot, cfg.timezone);
    if (at.getTime() < earliest) continue;
    const wd = weekday(at, cfg.timezone);
    if (!cfg.surplusDocDays.includes(wd)) continue;
    if (
      cfg.docDays.includes(wd) &&
      cfg.docWeeks.includes(weekOfMonth(at, cfg.timezone))
    )
      continue;
    if (taken.some((t) => Math.abs(t.getTime() - at.getTime()) < 3600_000))
      continue;
    return at;
  }
  return undefined;
}

/** Week of the month (1-5) for a date in the channel's time zone. */
function weekOfMonth(now: Date, timeZone: string): number {
  const day = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric" }).format(now),
  );
  return Math.ceil(day / 7);
}

/**
 * The monthly documentary: a franchise history, game by game, in the long-form
 * lane. Production starts hours before its slot because a 30-minute video takes
 * a while to write, voice and render.
 */
export async function maybeSelectDocumentary(
  s: Services,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.docEnabled || !cfg.longformEnabled) return undefined;
  const now = s.now();
  // The monthly documentary on its own week and day; otherwise, while ElevenLabs credits would be lost at
  // the reset, a banked one: made overnight now, while the credits are there, and scheduled for the next
  // free documentary evening, weeks ahead if need be (the owner's idea, 25 Oct 2026).
  let due = cfg.docWeeks.includes(weekOfMonth(now, cfg.timezone))
    ? evergreenDue(
        now,
        {
          days: cfg.docDays,
          slot: cfg.docSlot,
          leadMinutes: cfg.docLeadMinutes,
          graceMinutes: cfg.slotGraceMinutes,
          timeZone: cfg.timezone,
        },
        await takenSlots(db),
      )
    : undefined;
  let banked = false;
  if (!due) {
    // Overnight only: a documentary holds the factory for hours, and the day's Shorts come first.
    if (!inWindow(now, cfg.bankWindow, cfg.timezone)) return undefined;
    if (!(await surplusDocumentary(s))) return undefined;
    due = nextBankSlot(cfg, now, await takenSlots(db));
    if (!due) return undefined;
    banked = true;
  }
  const covered = (
    await db.query<{ franchise: string }>(
      `SELECT factcheck_json->'topic'->>'franchise' AS franchise FROM episodes WHERE lane = 'longform' AND factcheck_json->>'doc' = 'true' AND status NOT IN ('failed','rejected') AND created_at > $1::timestamptz - interval '3 years'`,
      [now],
    )
  )
    .map((r) => r.franchise)
    .filter(Boolean);
  const inTheNews = (
    await db.query<{ headline: string }>(
      `SELECT story_json->>'headline' AS headline FROM episodes WHERE lane IN ('news','news_breaking') AND created_at > $1::timestamptz - interval '14 days' ORDER BY created_at DESC LIMIT 40`,
      [now],
    )
  ).map((r) => r.headline);
  const topic = await selectDocTopic(
    s.llm,
    covered,
    inTheNews,
    undefined,
    undefined,
    await topicDemand(s, "doc"),
  );
  if (!topic) {
    log("info", "no documentary topic this month");
    return undefined;
  }
  const cluster: StoryCluster = {
    hash: `documentary:${dayKey(now, cfg.timezone)}:${topic.franchise.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    headline: topic.title_idea,
    items: [],
    sources: ["Wikipedia"],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: false,
    newestAt: now.toISOString(),
    score: 0,
    gameHint: topic.franchise,
  };
  const id = shortId();
  const created = await createEpisode(db, id, cluster, {
    lane: "longform",
    priority: LANE_PRIORITY.longform,
    slotAt: due,
  });
  if (!created) return undefined;
  await db.query(
    `UPDATE episodes SET script_json = NULL, factcheck_json = $2 WHERE id = $1`,
    [id, JSON.stringify({ doc: true, topic })],
  );
  await logEvent(db, id, "selected", {
    headline: topic.title_idea,
    lane: "longform",
    documentary: true,
    franchise: topic.franchise,
    reason: topic.reason,
    slot_at: due.toISOString(),
    banked,
  });
  log(
    "info",
    banked
      ? "documentary banked: made now on credits that would be lost, scheduled ahead"
      : "documentary topic selected",
    {
      id,
      franchise: topic.franchise,
      publishes: due.toISOString(),
    },
  );
  return id;
}

/**
 * Writes the documentary: outline, then each chapter against its own Wikipedia
 * article with a fact-check pass and up to two rewrites, then the intro and
 * outro from what the chapters actually say.
 */
async function stepScriptDocumentary(
  s: Services,
  ep: Episode,
  topic: DocTopic,
): Promise<void> {
  // A single story starts from its overview article; a franchise from the series article.
  const franchise = await s.research(
    topic.wiki ?? topic.franchise,
    topic.kind === "story"
      ? topic.franchise
      : `${topic.franchise} video game series`,
    6000,
  );
  const outline = await outlineDoc(s.llm, topic, franchise?.text ?? "");
  const chapters: DocDraft["chapters"] = [];
  const warnings: string[] = [];
  for (const [index, plan] of outline.chapters.entries()) {
    const source = await s.research(
      plan.wiki_title,
      `${plan.game_title} ${plan.year} video game`,
      9000,
    );
    if (!source) {
      warnings.push(
        `No Wikipedia article for ${plan.game_title}; chapter dropped.`,
      );
      continue;
    }
    let feedback: string[] = [];
    let chapter: import("./editorial/documentary.ts").DocChapter | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      chapter = await writeChapter(s.llm, {
        franchise: topic.franchise,
        plan,
        index,
        outline,
        source,
        previousEnding: chapters.at(-1)?.chapter.paragraphs.at(-1)?.narration,
        feedback,
      });
      const problems = validateChapter(chapter);
      const unsupported = await checkChapter(s.llm, chapter, source).catch(
        (err) => {
          log("warn", "documentary fact check failed", {
            error: errorMessage(err),
          });
          return [] as string[];
        },
      );
      feedback = [
        ...problems,
        ...unsupported.map(
          (u) => `Not supported by the source, remove or correct it: ${u}`,
        ),
      ];
      if (!feedback.length) break;
      if (attempt === 2)
        warnings.push(...feedback.map((f) => `${plan.game_title}: ${f}`));
    }
    const grounded = groundCallouts(chapter!, source);
    if (grounded.removed.length)
      warnings.push(
        ...grounded.removed.map(
          (r) =>
            `${plan.game_title}: on-screen ${r} not in the source, removed`,
        ),
      );
    // The shot list: a picture, graphic, caption or B-roll for every sentence (one mid-tier call a chapter).
    let moments: DocMoment[] | undefined;
    try {
      const sentences = grounded.chapter.paragraphs.flatMap((p) =>
        sentencesOf(p.narration),
      );
      const shot = groundDocMoments(
        await writeDocMoments(s.llm, {
          game: plan.game_title,
          chapterTitle: plan.chapter_title,
          sentences,
          source,
          games: outline.chapters.map((c) => c.game_title),
        }),
        source,
        outline.chapters.map((c) => c.game_title),
      );
      moments = shot.moments;
      if (shot.removed.length)
        warnings.push(
          ...shot.removed.map(
            (r) =>
              `${plan.game_title}: on-screen ${r} not in the source, removed`,
          ),
        );
    } catch (err) {
      log("warn", "documentary shot list failed", {
        episode: ep.id,
        chapter: index + 1,
        error: errorMessage(err),
      });
    }
    chapters.push({ plan, chapter: grounded.chapter, source, moments });
    log("info", "documentary chapter written", {
      episode: ep.id,
      chapter: index + 1,
      game: plan.game_title,
    });
  }
  if (chapters.length < DOC_CHAPTERS_MIN)
    throw new FatalError(
      `documentary has only ${chapters.length} chapters with sources`,
    );
  let bookends = await writeBookends(
    s.llm,
    outline,
    chapters,
    franchise?.text ?? "",
  );
  if (validateBookends(bookends).length)
    bookends = await writeBookends(
      s.llm,
      outline,
      chapters,
      franchise?.text ?? "",
    );
  const draft: DocDraft = { topic, outline, chapters, bookends };
  const words = docWordCount(draft);
  if (words < DOC_WORDS_MIN || words > DOC_WORDS_MAX)
    warnings.push(
      `Documentary is ${words} words (aim ${DOC_WORDS_MIN}-${DOC_WORDS_MAX}).`,
    );
  if (warnings.length)
    await logEvent(s.db, ep.id, "style_warnings", { problems: warnings });
  const script = docToScript(draft);
  if (franchise && !script.sources?.includes(franchise.url))
    script.sources = [franchise.url, ...(script.sources ?? [])];
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    factcheck_json: {
      doc: true,
      topic,
      words,
      sources: script.sources,
      warnings,
    },
  });
}

/** The weekly long-form ranking video: same topic pool as the evergreen Shorts, its own slot and lane. */
export async function maybeSelectLongform(
  s: Services,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.longformEnabled) return undefined;
  const now = s.now();
  if (cfg.longformSkip.includes(dayKey(now, cfg.timezone))) return undefined;
  const due = evergreenDue(
    now,
    {
      days: cfg.longformDays,
      slot: cfg.longformSlot,
      // Fifteen to twenty minutes of footage takes four hours or more to gather, voice and render.
      leadMinutes: cfg.slotLeadMinutes + 420,
      graceMinutes: cfg.slotGraceMinutes,
      timeZone: cfg.timezone,
    },
    await takenSlots(db),
  );
  if (!due) return undefined;
  const covered = (
    await db.query<{ headline: string }>(
      `SELECT story_json->>'headline' AS headline FROM episodes WHERE lane IN ('evergreen','longform') AND status NOT IN ('failed','rejected') AND created_at > $1::timestamptz - interval '180 days'`,
      [now],
    )
  ).map((r) => r.headline);
  const candidates = await s.discoverEvergreen();
  if (!candidates.length) return undefined;
  const topic = await selectLongformTopic(
    s.llm,
    candidates,
    covered,
    await topicDemand(s, "long"),
  );
  if (topic.candidate_index < 0 || !candidates[topic.candidate_index]) {
    log("info", "no long-form topic today", { reason: topic.reason });
    return undefined;
  }
  const cluster: StoryCluster = {
    hash: `longform:${dayKey(now, cfg.timezone)}:${topic.theme.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    headline: topic.title_idea,
    items: [],
    sources: ["Steam"],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: false,
    newestAt: now.toISOString(),
    score: 0,
    gameHint: topic.theme,
  };
  const id = shortId();
  const created = await createEpisode(db, id, cluster, {
    lane: "longform",
    priority: LANE_PRIORITY.longform,
    slotAt: due,
  });
  if (!created) return undefined;
  await db.query(
    `UPDATE episodes SET script_json = NULL, factcheck_json = $2 WHERE id = $1`,
    [id, JSON.stringify({ topic })],
  );
  await logEvent(db, id, "selected", {
    headline: topic.title_idea,
    lane: "longform",
    theme: topic.theme,
    criterion: topic.criterion,
    reason: topic.reason,
    slot_at: due.toISOString(),
  });
  log("info", "long-form topic selected", { id, theme: topic.theme });
  return id;
}

// ------------------------------------------------------------------ cutdowns

/**
 * One Short a day cut from a recent long ranking (published at least a day
 * ago, still public): the last place first, then number two, then number one.
 */
export async function maybeSelectCutdown(
  s: Services,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.cutdownsEnabled || cfg.cutdownsPerLong <= 0) return undefined;
  const now = s.now();
  const due = evergreenDue(
    now,
    {
      days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      slot: cfg.cutdownSlot,
      leadMinutes: cfg.slotLeadMinutes,
      graceMinutes: cfg.slotGraceMinutes,
      timeZone: cfg.timezone,
    },
    await takenSlots(db),
  );
  if (!due) return undefined;
  const parents = await db.query<Episode>(
    `SELECT e.* FROM episodes e
      WHERE e.lane = 'longform' AND e.status = 'published' AND e.youtube_video_id IS NOT NULL
        AND COALESCE(e.script_json->>'evergreen_format', '') <> 'documentary'
        AND COALESCE(e.publish_at, e.updated_at) < $1::timestamptz - interval '20 hours'
        AND COALESCE(e.publish_at, e.updated_at) > $1::timestamptz - interval '21 days'
        AND NOT EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind IN ('made_private','crosspost_skip') AND COALESCE(v.detail->>'reason','') IN ('not public on YouTube',''))
      ORDER BY COALESCE(e.publish_at, e.updated_at) DESC`,
    [now],
  );
  for (const parent of parents) {
    const entries = parent.script_json?.entries ?? [];
    if (!entries.length) continue;
    if (
      !(await fs
        .stat(path.join(episodeDir(cfg, parent.id), "short.mp4"))
        .catch(() => undefined))
    )
      continue;
    const done = new Set(
      (
        await db.query<{ rank: string }>(
          `SELECT story_json->'cutdown'->>'rank' AS rank FROM episodes WHERE lane = 'cutdown' AND story_json->'cutdown'->>'parent' = $1`,
          [parent.id],
        )
      ).map((r) => Number(r.rank)),
    );
    const rank = cutdownRanks(
      entries.map((e) => e.rank),
      cfg.cutdownsPerLong,
    ).find((r) => !done.has(r));
    if (rank === undefined) continue;
    const entry = entries.find((e) => e.rank === rank)!;
    const cluster: StoryCluster = {
      hash: `cutdown:${parent.id}:${rank}`,
      headline: `${entry.game_title}: number ${rank} of ${entries.length}`,
      items: [],
      sources: ["Pulse Gaming"],
      hasOfficial: true,
      corroborated: true,
      rumourSignals: false,
      newestAt: now.toISOString(),
      score: 0,
      gameHint: entry.game_title,
      cutdown: { parent: parent.id, rank },
    };
    const id = shortId();
    if (
      !(await createEpisode(db, id, cluster, {
        lane: "cutdown",
        priority: LANE_PRIORITY.cutdown,
        slotAt: due,
      }))
    )
      continue;
    await logEvent(db, id, "selected", {
      lane: "cutdown",
      parent: parent.id,
      rank,
      slot_at: due.toISOString(),
    });
    log("info", "cutdown selected", { id, parent: parent.id, rank });
    return id;
  }
  return undefined;
}

/** Cuts the entry's section from the long video (with a blurred fill for the background) and writes its packaging. */
async function stepScriptCutdown(s: Services, ep: Episode): Promise<void> {
  const ref = ep.story_json.cutdown;
  if (!ref) throw new FatalError("cutdown episode has no parent");
  const parent = await getEpisode(s.db, ref.parent);
  const pScript = parent?.script_json;
  if (!parent?.youtube_video_id || !pScript?.entries?.length)
    throw new FatalError("the long video for this cutdown is gone");
  const beatIndex = pScript.entries.findIndex((e) => e.rank === ref.rank);
  if (beatIndex < 0)
    throw new FatalError(`the long video has no number ${ref.rank}`);
  const pAssets = parent.assets_json ?? {};
  const words = pAssets.words ?? [];
  const duration = (pAssets.durationSeconds ?? 300) + LONG_TAIL_SECONDS;
  const segments = buildSegments(segmentInputs(pScript), words, duration);
  const win = cutdownWindow(segments, beatIndex, words);
  if (!win) throw new FatalError("the entry does not fit in a Short");
  const source = path.join(episodeDir(s.cfg, parent.id), "short.mp4");
  const dir = episodeDir(s.cfg, ep.id);
  await fs.mkdir(dir, { recursive: true });
  const len = win.end - win.start;
  const total = len + CUTDOWN_TAIL_SECONDS;
  const run = promisify(execFile);
  // The picture runs on under the end card; the narration fades out where the entry ends.
  // The section ends on its own last frame, held under the end card: running on would show the next entry (and give it away).
  const hold = (CUTDOWN_TAIL_SECONDS + 0.1).toFixed(2);
  const vLen = Math.min(len, win.videoEnd - win.start);
  const vHold = (total - vLen + 0.1).toFixed(2);
  await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-ss",
      win.start.toFixed(3),
      "-t",
      vLen.toFixed(3),
      "-i",
      source,
      "-ss",
      win.start.toFixed(3),
      "-t",
      len.toFixed(3),
      "-i",
      source,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-vf",
      `tpad=stop_mode=clone:stop_duration=${vHold}`,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-af",
      `afade=t=out:st=${Math.max(0, len - 0.12).toFixed(3)}:d=0.12,apad=pad_dur=${hold}`,
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-t",
      total.toFixed(3),
      path.join(dir, "cut.mp4"),
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-ss",
      win.start.toFixed(3),
      "-t",
      vLen.toFixed(3),
      "-i",
      source,
      "-an",
      "-vf",
      `scale=-2:1920,crop=1080:1920,boxblur=28:3,eq=brightness=-0.10:saturation=1.15,fps=30,tpad=stop_mode=clone:stop_duration=${vHold}`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "30",
      "-pix_fmt",
      "yuv420p",
      path.join(dir, "bg.mp4"),
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const narration = pScript.beats[beatIndex]?.narration ?? "";
  const copy = await writeCutdownCopy(
    s.llm,
    pScript,
    pScript.entries[beatIndex]!,
    narration,
    pScript.entries.length,
  );
  const script = cutdownScript(
    pScript,
    beatIndex,
    copy,
    parent.youtube_video_id,
  );
  script.cutdown!.theme = pScript.game_title;
  // The footage credits travel with the clips seen in this section.
  const plan = pAssets.longPlan;
  const fps = plan?.fps ?? 30;
  const seen = new Set(
    (plan?.shots ?? [])
      .filter(
        (sh) =>
          sh.media.type === "clip" &&
          sh.end / fps > win.start &&
          sh.start / fps < win.end,
      )
      .map((sh) => sh.media.index),
  );
  const clips = (pAssets.clips ?? [])
    .filter((_, i) => seen.has(i))
    .map((c) => ({ ...c, file: "" }));
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    assets_json: {
      words: wordsIn(words, win),
      durationSeconds: total,
      clips,
      officialTrailer: pAssets.officialTrailer,
      cutdown: {
        start: win.start,
        end: win.end,
        video: "cut.mp4",
        background: "bg.mp4",
      },
    },
  });
  await logEvent(s.db, ep.id, "cutdown_cut", {
    parent: parent.id,
    rank: ref.rank,
    start: win.start,
    end: win.end,
    title: copy.youtube_title,
  });
}

async function stepRenderCutdown(s: Services, ep: Episode): Promise<void> {
  if (!s.renderCutdown) throw new Error("this build cannot render cutdowns");
  const dir = episodeDir(s.cfg, ep.id);
  const script = ep.script_json!;
  const assets = ep.assets_json ?? {};
  const raw = path.join(dir, "render_raw.mp4");
  const final = path.join(dir, "short.mp4");
  const duration = assets.durationSeconds ?? 30;
  // A gameplay Short asks its question from the first frame and answers it on the end card.
  const g = script.gameplay;
  await s.renderCutdown({
    episodeDir: dir,
    props: {
      videoFile: assets.cutdown?.video ?? "cut.mp4",
      backgroundFile: assets.cutdown?.background ?? null,
      words: assets.words ?? [],
      durationSeconds: duration,
      title: script.headline.toUpperCase(),
      kicker: g
        ? g.experiment_number
          ? `TEST #${g.experiment_number}`
          : "WE TESTED IT"
        : `#${script.cutdown?.rank ?? ""} OF ${script.cutdown?.total ?? ""}`,
      cta: g ? g.result_line.toUpperCase() : "FULL RANKING ON THE CHANNEL",
      accent: "#FF6B1A",
      emphasis: g ? [] : emphasisWords(script),
      // Gameplay is the point: a band a quarter taller than the full 16:9 (cropped a little at the sides), still clear of the Shorts buttons.
      ...(g ? { videoHeight: 760 } : {}),
    },
    outFile: raw,
    posterFile: path.join(dir, "poster.jpg"),
    concurrency: s.cfg.remotionConcurrency,
    gl: s.cfg.remotionGl,
    browserExecutable: s.cfg.browserExecutable,
  });
  await s.normalise(raw, final);
  await fs.rm(raw, { force: true });
  const tech = await s.technicalQa(final, duration, {
    minSeconds: 8,
    maxSeconds: 59.5,
  });
  const qa = {
    technical: tech,
    vision: null,
    checked_at: s.now().toISOString(),
  };
  if (!tech.ok) {
    await s.db.query(`UPDATE episodes SET qa_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(qa),
    ]);
    throw new Error(`QA failed: ${tech.problems.join(" | ")}`);
  }
  await transition(s.db, ep.id, "voiced", "rendered", {
    assets_json: { ...assets, video: "short.mp4", poster: "poster.jpg" },
    qa_json: qa,
  });
  if (ep.lane === "gameplay") await gameplayStatus(s.cfg, ep, "rendered");
}

// ------------------------------------------------------------------ gameplay lane

async function gameplayExperiments(cfg: Config) {
  const md = await fs.readFile(cfg.gameplayExperiments, "utf8").catch(() => "");
  return parseExperiments(md);
}

/**
 * Hears and looks at new inbox clips (a few a tick, a daily cap on vision calls) and makes an episode
 * from each one worth posting. One gameplay Short is in production at a time, so a long stream's dozen
 * clips never crowd the news renders; the rest wait in the inbox as "new".
 */
export async function ingestGameplay(
  s: Services,
  perTick = 3,
): Promise<string[]> {
  const { db, cfg } = s;
  if (!cfg.gameplayEnabled || !cfg.gameplayRoot) return [];
  const [busy] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes WHERE lane = 'gameplay' AND status IN ('selected','scripted','voiced','rendered')`,
  );
  if (Number(busy?.n ?? 0) > 0) return [];
  const [reviewed] = await db.query<{ n: string | number }>(
    // The database's own clock, as the rows are stamped with it.
    `SELECT count(*) AS n FROM events WHERE kind = 'gameplay_reviewed' AND created_at > now() - interval '24 hours'`,
  );
  let left = Math.min(
    perTick,
    cfg.gameplayReviewsPerDay - Number(reviewed?.n ?? 0),
  );
  if (left <= 0) return [];
  const experiments = await gameplayExperiments(cfg);
  const made: string[] = [];
  for (const { dir, meta } of await newClips(cfg.gameplayRoot)) {
    if (left-- <= 0) break;
    await writeMeta(dir, { status: "reviewing" });
    try {
      const clip = path.join(dir, meta.clip.file || "clip.mp4");
      const words = (await s.hearClip?.(clip).catch(() => [])) ?? [];
      await fs.writeFile(path.join(dir, "words.json"), JSON.stringify(words));
      const review = await reviewClip(
        s.llm,
        dir,
        meta,
        words.map((w) => w.text).join(" "),
        experiments,
      );
      await logEvent(db, null, "gameplay_reviewed", {
        id: meta.id,
        keep: review.keep,
        score: review.score,
        reason: review.reason,
      });
      const keep = worthPosting(review, cfg.gameplayMinScore);
      let episode: string | undefined;
      if (keep) {
        const cluster: StoryCluster = {
          hash: `gameplay:${meta.id}`,
          headline: review.question,
          items: [],
          sources: ["Pulse Gaming"],
          hasOfficial: true,
          corroborated: true,
          rumourSignals: false,
          newestAt: s.now().toISOString(),
          score: review.score,
          gameHint: review.game_title,
          gameplay: { id: meta.id, dir, review },
        };
        episode = shortId();
        if (
          await createEpisode(db, episode, cluster, {
            lane: "gameplay",
            priority: LANE_PRIORITY.gameplay,
          })
        ) {
          await logEvent(db, episode, "selected", {
            lane: "gameplay",
            clip: meta.id,
            score: review.score,
            question: review.question,
          });
          made.push(episode);
        } else episode = undefined;
      }
      await writeMeta(dir, {
        status: keep && episode ? "picked" : "rejected",
        review: {
          at: s.now().toISOString(),
          keep: Boolean(keep && episode),
          reason: review.reason,
          episode,
          radio: review.radio_audible,
        },
      });
      log("info", "gameplay clip reviewed", {
        id: meta.id,
        keep,
        score: review.score,
      });
      // One in production at a time: the next clip waits for this one to reach the owner.
      if (episode) break;
    } catch (err) {
      // A failed look is tried again later, never thrown away.
      await writeMeta(dir, { status: "new" });
      log("warn", "gameplay review failed", {
        id: meta.id,
        error: errorMessage(err),
      });
      break;
    }
  }
  return made;
}

/** Trims the clip to the reviewer's window, with a blurred 9:16 fill behind it; the game's own sound is kept. */
async function stepScriptGameplay(s: Services, ep: Episode): Promise<void> {
  const ref = ep.story_json.gameplay;
  if (!ref) throw new FatalError("gameplay episode has no clip");
  const clipDir = gameplayDir(s.cfg, ref.id);
  const meta = await readMeta(clipDir);
  if (!meta) throw new FatalError("the gameplay clip is gone from the inbox");
  const source = path.join(clipDir, meta.clip.file || "clip.mp4");
  const win = gameplayWindow(ref.review, meta.clip.seconds);
  const len = win.end - win.start;
  const dir = episodeDir(s.cfg, ep.id);
  await fs.mkdir(dir, { recursive: true });
  const run = promisify(execFile);
  await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-ss",
      win.start.toFixed(3),
      "-t",
      len.toFixed(3),
      "-i",
      source,
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-af",
      `afade=t=in:d=0.08,afade=t=out:st=${Math.max(0, len - 0.25).toFixed(3)}:d=0.25`,
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      path.join(dir, "cut.mp4"),
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-ss",
      win.start.toFixed(3),
      "-t",
      len.toFixed(3),
      "-i",
      source,
      "-an",
      "-vf",
      "scale=-2:1920,crop=1080:1920,boxblur=28:3,eq=brightness=-0.10:saturation=1.15,fps=30",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "30",
      "-pix_fmt",
      "yuv420p",
      path.join(dir, "bg.mp4"),
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const heard = JSON.parse(
    await fs
      .readFile(path.join(clipDir, "words.json"), "utf8")
      .catch(() => "[]"),
  ) as Array<{ text: string; start: number; end: number }>;
  const inWindow = wordsInWindow(heard, win);
  const words = ref.review.captions_ok && captionable(inWindow) ? inWindow : [];
  const script = gameplayScript(
    ref.review,
    ref.id,
    await gameplayExperiments(s.cfg),
  );
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    assets_json: {
      words,
      durationSeconds: len,
      clips: [],
      cutdown: {
        start: win.start,
        end: win.end,
        video: "cut.mp4",
        background: "bg.mp4",
      },
    },
  });
  await logEvent(s.db, ep.id, "gameplay_cut", {
    clip: ref.id,
    start: win.start,
    end: win.end,
    title: script.youtube.title,
  });
}

/** Keeps the inbox clip's status in step with its episode, for the finder's owner and Leonida Intel. */
async function gameplayStatus(
  cfg: Config,
  ep: Episode,
  status: GameplayStatus,
): Promise<void> {
  const id = ep.story_json.gameplay?.id;
  if (id)
    await writeMeta(gameplayDir(cfg, id), { status }).catch(() => undefined);
}

/** A clip's inbox folder, found by id under GAMEPLAY_ROOT (so it survives the move to the Mac). */
function gameplayDir(cfg: Config, id: string): string {
  return path.join(cfg.gameplayRoot, "inbox", id);
}

/** Once a gameplay Short is public: published/<id>.json for Leonida Intel's article. */
async function gameplayLive(s: Services, ep: Episode): Promise<void> {
  const g = ep.script_json?.gameplay;
  if (ep.lane !== "gameplay" || !g || !ep.youtube_video_id) return;
  // A scheduled video is not watchable yet: the go-live check writes it after its slot.
  if (ep.publish_at && new Date(ep.publish_at) > s.now()) return;
  const wrote = await writeManifest(s.cfg.gameplayRoot, {
    id: g.inbox_id,
    youtube_id: ep.youtube_video_id,
    title: polishTitle(ep.script_json!),
    question: g.question,
    result: g.result,
    experiment_slug: g.experiment_slug,
    published_at: (ep.publish_at
      ? new Date(ep.publish_at)
      : s.now()
    ).toISOString(),
  }).catch((err) => {
    log("warn", "gameplay manifest failed", {
      episode: ep.id,
      error: errorMessage(err),
    });
    return false;
  });
  await gameplayStatus(s.cfg, ep, "published");
  if (wrote)
    await logEvent(s.db, ep.id, "gameplay_manifest", { clip: g.inbox_id });
}

/** Rejected, expired or failed gameplay episodes mark their clip "skipped" so nobody wonders about it. */
export async function syncGameplaySkips(s: Services): Promise<void> {
  if (!s.cfg.gameplayEnabled) return;
  const rows = await s.db.query<Episode>(
    `SELECT * FROM episodes WHERE lane = 'gameplay' AND status IN ('rejected','failed') AND updated_at > now() - interval '3 days'`,
  );
  for (const ep of rows) {
    const id = ep.story_json.gameplay?.id;
    if (!id) continue;
    const dir = gameplayDir(s.cfg, id);
    const meta = await readMeta(dir);
    if (meta && meta.status !== "skipped" && meta.status !== "published")
      await writeMeta(dir, { status: "skipped" });
  }
}

/**
 * The gameplay slot for an approved Short: the first of GAMEPLAY_SLOTS, today or on the next days, that is
 * at least 20 minutes away, holds no other gameplay Short and is a full upload gap from every other
 * scheduled video. Gameplay is extra, so it moves out of the planned lanes' way, never the reverse.
 */
export function nextGameplaySlot(
  cfg: Config,
  now: Date,
  scheduled: Date[],
  gameplayTaken: Date[],
): Date | undefined {
  const gap = cfg.minUploadGapMinutes * 60_000;
  const today = dayKey(now, cfg.timezone);
  for (let d = 0; d < 14; d++) {
    for (const hhmm of cfg.gameplaySlots) {
      const at = localTime(addDays(today, d), hhmm, cfg.timezone);
      if (at.getTime() - now.getTime() < 20 * 60_000) continue;
      if (gameplayTaken.some((t) => t.getTime() === at.getTime())) continue;
      if (scheduled.some((t) => Math.abs(t.getTime() - at.getTime()) < gap))
        continue;
      return at;
    }
  }
  return undefined;
}

/** Rumour Shorts made today: written as a rumour, or still unwritten from a story with rumour signals. */
export async function countRumoursToday(
  db: Db,
  timeZone: string,
): Promise<number> {
  const [row] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes
      WHERE created_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1
        AND status NOT IN ('failed','rejected')
        AND (script_json->>'is_rumour' = 'true' OR (script_json IS NULL AND story_json->>'rumourSignals' = 'true'))`,
    [timeZone],
  );
  return Number(row?.n ?? 0);
}

// ------------------------------------------------------------------ the twin channel

/** The twin channel is on and its login is stored. */
async function twinReady(s: Services): Promise<boolean> {
  if (!s.cfg.twinLanguage) return false;
  return (await s.youtubeConnected?.(s.cfg.twinLanguage)) ?? true;
}

/**
 * A twin for every Short that went public on the main channel in the last three days and has none yet:
 * the same story and media, re-written in the twin language, uploaded to the twin channel a little after
 * the original. One in production at a time, behind every other lane.
 */
export async function maybeSelectTwin(
  s: Services,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!(await twinReady(s))) return undefined;
  const lang = cfg.twinLanguage;
  const [busy] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes WHERE lane = 'twin' AND status IN ('selected','scripted','voiced','rendered')`,
  );
  if (Number(busy?.n ?? 0) > 0) return undefined;
  const now = s.now();
  const parents = await db.query<Episode>(
    `SELECT e.* FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND e.script_json IS NOT NULL
        AND e.lane IN ('news','news_breaking','evergreen','free')
        AND COALESCE(e.script_json->>'runtime', 'short') = 'short'
        AND COALESCE(e.publish_at, e.updated_at) <= $1::timestamptz - interval '15 minutes'
        AND COALESCE(e.publish_at, e.updated_at) > $1::timestamptz - interval '3 days'
        AND NOT EXISTS (SELECT 1 FROM episodes t WHERE t.story_hash = 'twin:' || $2 || ':' || e.id)
        AND NOT EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind IN ('made_private','crosspost_skip') AND COALESCE(v.detail->>'reason','') IN ('not public on YouTube',''))
      ORDER BY COALESCE(e.publish_at, e.updated_at) DESC LIMIT 5`,
    [now, lang],
  );
  for (const parent of parents) {
    // The original's folder must still be there (pruned, whole, after two weeks).
    if (!(await fs.stat(episodeDir(cfg, parent.id)).catch(() => undefined)))
      continue;
    const id = shortId();
    const live = new Date(parent.publish_at ?? parent.updated_at);
    const slotAt = new Date(
      Math.max(
        now.getTime() + 20 * 60_000,
        live.getTime() + cfg.twinDelayMinutes * 60_000,
      ),
    );
    const cluster: StoryCluster = {
      ...parent.story_json,
      hash: `twin:${lang}:${parent.id}`,
      twin: { parent: parent.id, language: lang, account: lang },
    };
    if (
      !(await createEpisode(db, id, cluster, {
        lane: "twin",
        priority: LANE_PRIORITY.twin,
        slotAt,
      }))
    )
      continue;
    await logEvent(db, id, "selected", {
      lane: "twin",
      parent: parent.id,
      language: lang,
      slot_at: slotAt.toISOString(),
    });
    log("info", "twin selected", { id, parent: parent.id, language: lang });
    return id;
  }
  return undefined;
}

/** Translates the original's script and copies its media, so the twin is voiced and rendered like any Short. */
async function stepScriptTwin(s: Services, ep: Episode): Promise<void> {
  const ref = ep.story_json.twin;
  if (!ref) throw new FatalError("twin episode has no original");
  const parent = await getEpisode(s.db, ref.parent);
  if (!parent?.script_json || !parent.youtube_video_id)
    throw new FatalError("the original Short is gone");
  const { script, problems } = await translateScript(
    s.llm,
    parent.script_json,
    ref.language,
    {
      parent: parent.id,
      parentVideo: parent.youtube_video_id,
    },
  );
  if (problems.length) {
    // A translation that changes a figure is not a twin: drop it rather than say something the original did not.
    await transition(s.db, ep.id, "selected", "rejected", {
      last_error: problems.join(" | "),
    });
    await logEvent(s.db, ep.id, "rejected", { by: "translation", problems });
    log("warn", "twin dropped: translation changed a figure", {
      episode: ep.id,
      problems,
    });
    return;
  }
  // The original's media, file for file, so the render finds everything under this episode's folder.
  const from = episodeDir(s.cfg, parent.id);
  const dir = episodeDir(s.cfg, ep.id);
  const pa = parent.assets_json ?? {};
  const files = [
    ...(pa.images ?? []).flatMap((i) => [i.file, i.blurFile]),
    ...(pa.clips ?? []).flatMap((c) => [c.file, c.blurFile]),
  ].filter((f): f is string => Boolean(f));
  for (const f of files) {
    await fs.mkdir(path.dirname(path.join(dir, f)), { recursive: true });
    await fs
      .copyFile(path.join(from, f), path.join(dir, f))
      .catch(() => undefined);
  }
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    factcheck_json: parent.factcheck_json,
    assets_json: {
      images: pa.images,
      clips: pa.clips,
      steam: pa.steam,
      officialTrailer: pa.officialTrailer,
      rich: pa.rich,
    },
  });
  await logEvent(s.db, ep.id, "twin_translated", {
    parent: parent.id,
    language: ref.language,
    title: script.youtube.title,
  });
}

/** The script's stamp, timed to the first spoken word that matches it (none when the word was not found). */
export function stampsFor(
  script: Pick<Script, "stamp">,
  words: Array<{ text: string; start: number }>,
): Array<{ at: number; text: string; sub?: string; colour: string }> {
  const st = script.stamp;
  if (!st?.word?.trim() || !st.text?.trim()) return [];
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9$]/g, "");
  // The voice reads figures in words ("19" may come out "nineteenth"): match the spoken form's first token too.
  const wants = [
    norm(st.word),
    norm(speakable(st.word).split(/\s+/)[0] ?? ""),
  ].filter(Boolean);
  const hit = words.find((w) =>
    wants.some((x) => norm(w.text) === x || norm(w.text).startsWith(x)),
  );
  if (!hit) return [];
  return [
    {
      at: hit.start,
      text: st.text.toUpperCase().slice(0, 14),
      sub: st.sub?.trim() ? st.sub.toUpperCase() : undefined,
      colour: stampColour(st.tone),
    },
  ];
}

/** How the last eight Shorts opened their take and closed, so the writer and the validator keep the shapes varied. */
export async function recentShapes(
  db: Db,
  exceptId: string,
): Promise<RecentShapes> {
  const rows = await db.query<{ take: string | null; loop: string | null }>(
    `SELECT script_json->'pulse_take'->>'narration' AS take, script_json->>'loop_line' AS loop
       FROM episodes WHERE script_json IS NOT NULL AND id <> $1 AND status NOT IN ('failed','rejected')
         AND COALESCE(script_json->>'runtime', 'short') = 'short'
       ORDER BY created_at DESC LIMIT 8`,
    [exceptId],
  );
  return {
    takes: rows
      .map((r) => (r.take ?? "").trim().split(/\s+/).slice(0, 4).join(" "))
      .filter(Boolean),
    loops: rows.map((r) => (r.loop ?? "").trim()).filter(Boolean),
  };
}

/** The week's published news Shorts, most watched first (their best captured view count), rumours left out. */
export async function recapStoryIds(db: Db, now: Date): Promise<string[]> {
  const rows = await db.query<{
    id: string;
    views: number | null;
    game: string | null;
  }>(
    `SELECT e.id, (SELECT max(m.views) FROM video_metrics m WHERE m.episode_id = e.id) AS views,
            e.script_json->>'game_title' AS game
       FROM episodes e
      WHERE e.lane IN ('news','news_breaking') AND e.status = 'published' AND e.youtube_video_id IS NOT NULL
        AND coalesce(e.publish_at, e.updated_at) > $1::timestamptz - interval '7 days'
        AND coalesce((e.script_json->>'is_rumour')::boolean, false) = false
      ORDER BY 2 DESC NULLS LAST, coalesce(e.publish_at, e.updated_at) DESC
      LIMIT 40`,
    [now],
  );
  // One story per game, its most-watched: two chapters on the same game read as a repeat.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const key = (r.game ?? r.id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r.id);
    if (out.length >= RECAP_STORIES_MAX) break;
  }
  return out;
}

/**
 * Writes the weekly recap: packaging, then each story against its own sources (the Short's checked
 * narration and the articles it came from) with a fact-check pass and up to two rewrites, then the
 * intro and outro.
 */
async function stepScriptRecap(
  s: Services,
  ep: Episode,
  ids: string[],
): Promise<void> {
  const stories: RecapStory[] = [];
  for (const id of ids) {
    const short = await getEpisode(s.db, id);
    const script = short?.script_json;
    if (!short || !script) continue;
    const articles: string[] = [];
    for (const item of (short.story_json?.items ?? []).slice(0, 3)) {
      const a = await s.fetchArticle(item.url).catch(() => undefined);
      if (a?.text)
        articles.push(`[${item.source}] ${a.title}\n${a.text.slice(0, 3500)}`);
    }
    const urls = (short.story_json?.items ?? []).slice(0, 3).map((i) => i.url);
    stories.push({
      episodeId: id,
      headline: script.youtube?.title ?? script.headline,
      game: script.game_title || short.story_json.headline,
      steamTerm: script.steam_search_term ?? "",
      views: 0,
      source: {
        title: short.story_json.sources.slice(0, 3).join(" / ") || "outlets",
        url: urls[0] ?? "",
        text: [
          `[Pulse Short, fact-checked against these sources] ${narrationOf(script)}`,
          ...articles,
        ].join("\n\n"),
      },
    });
  }
  if (stories.length < RECAP_STORIES_MIN)
    throw new FatalError(
      `weekly recap has only ${stories.length} stories with sources`,
    );
  const packaging = await packageRecap(
    s.llm,
    stories,
    dayKey(s.now(), s.cfg.timezone),
  );
  const titles = stories.map(
    (st, i) => packaging.chapter_titles[i] ?? st.headline,
  );
  const chapters: import("./editorial/documentary.ts").DocChapter[] = [];
  const recapMoments: Array<DocMoment[] | undefined> = [];
  const warnings: string[] = [];
  for (const [index, story] of stories.entries()) {
    let feedback: string[] = [];
    let chapter: import("./editorial/documentary.ts").DocChapter | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      chapter = await writeRecapChapter(s.llm, {
        story,
        title: titles[index]!,
        index,
        titles,
        previousEnding: chapters.at(-1)?.paragraphs.at(-1)?.narration,
        feedback,
      });
      const unsupported = await checkChapter(
        s.llm,
        chapter,
        story.source,
      ).catch(() => [] as string[]);
      feedback = [
        ...validateRecapChapter(chapter),
        ...unsupported.map(
          (u) => `Not supported by the sources, remove or correct it: ${u}`,
        ),
      ];
      if (!feedback.length) break;
      if (attempt === 2)
        warnings.push(...feedback.map((f) => `${story.game}: ${f}`));
    }
    const grounded = groundCallouts(chapter!, story.source);
    if (grounded.removed.length)
      warnings.push(
        ...grounded.removed.map(
          (r) => `${story.game}: on-screen ${r} not in the sources, removed`,
        ),
      );
    chapters.push(grounded.chapter);
    // The recap's shot list, as a documentary chapter's: graphics, clippings of the coverage, captions.
    try {
      const shot = groundDocMoments(
        await writeDocMoments(s.llm, {
          game: story.game,
          chapterTitle: titles[index]!,
          sentences: grounded.chapter.paragraphs.flatMap((p) =>
            sentencesOf(p.narration),
          ),
          source: story.source,
          games: stories.map((st) => st.game),
        }),
        story.source,
        stories.map((st) => st.game),
      );
      recapMoments[index] = shot.moments;
    } catch (err) {
      log("warn", "recap shot list failed", {
        episode: ep.id,
        story: index + 1,
        error: errorMessage(err),
      });
    }
    log("info", "recap story written", {
      episode: ep.id,
      story: index + 1,
      game: story.game,
    });
  }
  const bookends = await writeRecapBookends(
    s.llm,
    packaging,
    chapters.map((chapter, i) => ({ title: titles[i]!, chapter })),
  );
  const script = recapToScript(
    packaging,
    stories,
    chapters,
    bookends,
    Number(dayKey(s.now(), s.cfg.timezone).slice(0, 4)),
    recapMoments,
  );
  script.sources = [
    ...new Set(stories.flatMap((st) => (st.source.url ? [st.source.url] : []))),
  ];
  if (warnings.length)
    await logEvent(s.db, ep.id, "style_warnings", { problems: warnings });
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    factcheck_json: {
      recap: true,
      stories: ids,
      warnings,
      sources: script.sources,
    },
  });
}

/**
 * A game's fact sheet with a short Wikipedia background (development, release, sales, reception, legacy),
 * so a ranking has more to say than store numbers; games off Steam get a sheet of their own this way.
 */
async function withBackground(
  s: Services,
  title: string,
  facts: SteamFacts | undefined,
  maxChars = 2200,
): Promise<SteamFacts | undefined> {
  const wiki = await s
    .research(title, `${title} video game`, maxChars)
    .catch(() => undefined);
  if (!facts && !wiki) return undefined;
  return {
    ...(facts ?? {
      name: title,
      storeUrl: "",
      fetchedAt: s.now().toISOString(),
    }),
    ...(wiki ? { background: wiki.text, backgroundUrl: wiki.url } : {}),
  };
}

/** Writes the long-form ranking against live Steam facts for each entry, with one rewrite on problems. */
/**
 * The final factual adjudication of a ranking or long video: a blocker goes back to the writer once as
 * feedback (returned); a blocker that survives the rewrite fails the episode so nothing wrong goes out.
 */
async function adjudicateRanking(
  s: Services,
  ep: Episode,
  script: Script,
  facts: Array<{ title: string; facts: SteamFacts }>,
  attempt: number,
  extra: Array<{ title: string; facts: string }> = [],
): Promise<string[]> {
  const check = await factCheckRanking(s.llm, script, [
    ...facts.map((f) => ({ title: f.title, facts: factsText(f.facts) })),
    ...extra,
  ]);
  const blockers = check.issues
    .filter((i) => i.severity === "blocker")
    .map((i) => `Fact-check: "${i.quote}" - ${i.problem}`);
  await logEvent(s.db, ep.id, "factcheck", {
    attempt,
    verdict: check.verdict,
    blockers,
    summary: check.summary,
  });
  if (check.verdict !== "fail" && !blockers.length) return [];
  if (attempt === 0)
    return blockers.length ? blockers : [`Fact-check failed: ${check.summary}`];
  throw new FatalError(
    `fact-check still failing after a rewrite: ${(blockers[0] ?? check.summary).slice(0, 300)}`,
  );
}

async function stepScriptLongform(s: Services, ep: Episode): Promise<void> {
  const fc = ep.factcheck_json as {
    doc?: boolean;
    recap?: boolean;
    stories?: string[];
    topic?: import("./editorial/evergreen.ts").EvergreenTopic;
  } | null;
  if (fc?.recap && fc.stories?.length)
    return stepScriptRecap(s, ep, fc.stories);
  if (fc?.doc && fc.topic)
    return stepScriptDocumentary(s, ep, fc.topic as unknown as DocTopic);
  const topic = fc?.topic;
  if (!topic) throw new FatalError("long-form episode has no topic");
  let facts: Array<{ title: string; facts: SteamFacts }> = [];
  let feedback: string[] = [];
  let draft: import("./editorial/longform.ts").LongformScript | undefined;
  // The plan names the games; their Steam facts are looked up once and every entry is written with them.
  const lookup = async (
    entries: Array<{ game_title: string; steam_search_term: string }>,
  ) => {
    if (facts.length) return facts;
    for (const entry of entries) {
      try {
        const app = entry.steam_search_term
          ? await s.findGame(entry.steam_search_term)
          : undefined;
        const f = await withBackground(
          s,
          entry.game_title,
          app ? await s.gameFacts(app) : undefined,
        );
        if (f) facts.push({ title: entry.game_title, facts: f });
      } catch (err) {
        log("warn", "long-form steam lookup failed", {
          game: entry.game_title,
          error: errorMessage(err),
        });
      }
    }
    return facts;
  };
  // What earlier long videos taught us about holding viewers, entry by entry (empty until there is a curve).
  const lessons = await longLessons(s.db, s.now()).catch(() => "");
  for (let attempt = 0; attempt < 2; attempt++) {
    draft = await writeLongform(s.llm, topic, lookup, feedback, lessons);
    const problems = validateLongform(draft);
    const factual = await adjudicateRanking(
      s,
      ep,
      longformToScript(draft),
      facts,
      attempt,
    );
    if (!problems.length && !factual.length) break;
    // One rewrite with the problems named; style misses that survive are logged, facts are not (adjudicateRanking throws).
    if (attempt === 1 && problems.length)
      await logEvent(s.db, ep.id, "style_warnings", { problems });
    feedback = [...factual, ...problems];
  }
  if (!draft) throw new Error("long-form script produced nothing");
  const script = withSpoilerWarning(longformToScript(draft));
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    factcheck_json: {
      topic,
      facts: facts.map((f) => ({ title: f.title, facts: f.facts })),
    },
  });
}

/**
 * Achievement entries come from Steam's numbers, not the writer's memory: an
 * entry that names no achievement in the data is dropped, the rest take the
 * data's exact name, percentage and icon, and ranks follow rarity (1 = rarest).
 */
/** The criterion line under a ranking's thumbnail headline: "By campaign strength", never "By ranked by...". */
export function thumbCriterion(criterion: string): string {
  const core = criterion
    .trim()
    .replace(/[.]$/, "")
    .replace(/^(ranked\s+|judged\s+|sorted\s+)?(by|on)\s+/i, "");
  const line = `By ${core.charAt(0).toLowerCase()}${core.slice(1)}`;
  if (line.length <= 48) return line;
  const cut = line.slice(0, 48);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:\s]+$/, "");
}

/** A euro price as Steam formats it ("5,99€") written for an English screen ("€5.99"). */
export function euro(v: string): string {
  const m = v.replace(/\s/g, "").match(/^([\d.,]+)€$/);
  return m ? `€${m[1]!.replace(/\.(?=\d{3})/g, "").replace(",", ".")}` : v;
}

/**
 * Deal entries take Steam's prices, never the writer's: name and year from the data, the screen
 * shows the dollar price with pounds and euros beside it and the original price, and an entry that
 * names no game in the data is dropped.
 */
export function groundDeals<
  T extends {
    entries: Array<{
      rank: number;
      game_title: string;
      steam_search_term: string;
      platforms: string;
      year: number;
      verdict_chip: string;
      price?: string;
      was?: string;
    }>;
  },
>(draft: T, data: Deal[]): T {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[\u00ae\u2122\u00a9]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const kept = draft.entries
    .map((e) => {
      const d =
        data.find((x) => norm(x.name) === norm(e.game_title)) ??
        data.find(
          (x) =>
            norm(e.game_title).includes(norm(x.name)) ||
            norm(x.name).includes(norm(e.game_title)),
        );
      if (!d) return undefined;
      const name = d.name.replace(/[\u00ae\u2122\u00a9]/g, "").trim();
      return {
        ...e,
        game_title: name,
        steam_search_term: name,
        year: d.year ?? e.year,
        platforms: "PC (Steam)",
        // The dollar price and the cut are the big chip; the card line carries pounds, euros and the old price.
        verdict_chip: `${d.usd.final} · ${d.usd.pct}% OFF`,
        price:
          [d.gbp, d.eur ? euro(d.eur) : undefined]
            .filter(Boolean)
            .join(" · ") || "PC (STEAM)",
        was: `WAS ${d.usd.initial}`,
      };
    })
    .filter((e): e is NonNullable<typeof e> => !!e);
  // The writer's order stands (rank 1 = its best pick); ranks are closed up after any drop.
  kept.sort((a, b) => a.rank - b.rank).forEach((e, i) => (e.rank = i + 1));
  return { ...draft, entries: kept };
}

export interface ClimberData {
  name: string;
  rank: number;
  lastRank?: number;
  climb: number;
  peak: number;
  year?: number;
}

/**
 * Climber entries take the chart's numbers, never the writer's: name, year,
 * the climb label and the peak come from Steam, ranks follow places climbed
 * (1 = biggest), and an entry that names no game in the data is dropped.
 */
export function groundClimbers<
  T extends {
    entries: Array<{
      rank: number;
      game_title: string;
      steam_search_term: string;
      platforms: string;
      year: number;
      peak?: number;
    }>;
  },
>(draft: T, data: ClimberData[]): T {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[\u00ae\u2122\u00a9]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const kept = draft.entries
    .map((e) => {
      const d =
        data.find((x) => norm(x.name) === norm(e.game_title)) ??
        data.find(
          (x) =>
            norm(e.game_title).includes(norm(x.name)) ||
            norm(x.name).includes(norm(e.game_title)),
        );
      if (!d) return undefined;
      const name = d.name.replace(/[\u00ae\u2122\u00a9]/g, "").trim();
      return {
        ...e,
        game_title: name,
        steam_search_term: name,
        year: d.year ?? e.year,
        platforms:
          d.lastRank === undefined
            ? `NEW AT #${d.rank}`
            : `UP ${d.climb} TO #${d.rank}`,
        peak: d.peak,
        climb: d.climb,
      };
    })
    .filter((e): e is NonNullable<typeof e> => Boolean(e))
    .filter(
      (e, i, a) => a.findIndex((x) => x.game_title === e.game_title) === i,
    )
    .sort((a, b) => b.climb - a.climb);
  return {
    ...draft,
    entries: kept.map(({ climb: _c, ...e }, i) => ({ ...e, rank: i + 1 })),
  };
}

export function groundAchievements<
  T extends {
    entries: Array<{
      rank: number;
      game_title: string;
      steam_search_term: string;
      platforms: string;
      year: number;
      percent?: number;
      icon?: string;
    }>;
  },
>(
  draft: T,
  data: Array<{
    name: string;
    game: string;
    percent: number;
    icon?: string;
    year?: number;
  }>,
): T {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const kept = draft.entries
    .map((e) => {
      const d =
        data.find((x) => norm(x.name) === norm(e.game_title)) ??
        data.find(
          (x) =>
            norm(e.game_title).includes(norm(x.name)) ||
            norm(x.name).includes(norm(e.game_title)),
        );
      return d
        ? {
            ...e,
            game_title: d.name,
            steam_search_term: d.game,
            platforms: d.game,
            year: d.year ?? e.year,
            percent: d.percent,
            icon: d.icon,
          }
        : undefined;
    })
    .filter((e): e is NonNullable<typeof e> => Boolean(e));
  const unique = kept.filter(
    (e, i) =>
      kept.findIndex(
        (x) =>
          x.game_title === e.game_title &&
          x.steam_search_term === e.steam_search_term,
      ) === i,
  );
  unique
    .sort((a, b) => (a.percent ?? 100) - (b.percent ?? 100))
    .forEach((e, i) => (e.rank = i + 1));
  return { ...draft, entries: unique };
}

/** Writes a ranking Short against live Steam facts for each entry, with one rewrite on problems. */
async function stepScriptEvergreen(s: Services, ep: Episode): Promise<void> {
  const topic = (
    ep.factcheck_json as {
      topic?: import("./editorial/evergreen.ts").EvergreenTopic;
    } | null
  )?.topic;
  // Weekly formats carry the week's data for the writer.
  const brief = (ep.factcheck_json as { brief?: string } | null)?.brief ?? "";
  if (!topic) throw new FatalError("evergreen episode has no topic");
  let facts: Array<{ title: string; facts: SteamFacts }> = [];
  let feedback: string[] = [];
  let draft: import("./editorial/evergreen.ts").EvergreenScript | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    draft = await writeEvergreen(s.llm, topic, facts, feedback, brief);
    const problems = validateEvergreen(draft);
    // Fetch the facts for the entries the writer chose, then rewrite once against them.
    if (attempt === 0) {
      facts = [];
      for (const entry of draft.entries) {
        try {
          const app = entry.steam_search_term
            ? await s.findGame(entry.steam_search_term)
            : undefined;
          const f = await withBackground(
            s,
            entry.game_title,
            app ? await s.gameFacts(app) : undefined,
            1200,
          );
          if (f) facts.push({ title: entry.game_title, facts: f });
        } catch (err) {
          log("warn", "evergreen steam lookup failed", {
            game: entry.game_title,
            error: errorMessage(err),
          });
        }
      }
      feedback = [
        ...problems,
        ...(facts.length
          ? [
              "Check every year, score and price against the Steam facts now provided and correct any that differ.",
            ]
          : []),
      ];
      if (!feedback.length) break;
      continue;
    }
    if (problems.length)
      await logEvent(s.db, ep.id, "style_warnings", { problems });
  }
  if (!draft) throw new Error("evergreen script produced nothing");
  // The format's own data (Steam's chart, deals or achievement rates) replaces the writer's numbers.
  const data = (
    ep.factcheck_json as {
      achievements?: Array<{
        name: string;
        game: string;
        percent: number;
        icon?: string;
        year?: number;
      }>;
    } | null
  )?.achievements;
  const climbers = (ep.factcheck_json as { climbers?: ClimberData[] } | null)
    ?.climbers;
  const deals = (ep.factcheck_json as { deals?: Deal[] } | null)?.deals;
  const ground = (d: typeof draft) => {
    let g = d!;
    if (data?.length) g = groundAchievements(g, data);
    if (climbers?.length) g = groundClimbers(g, climbers);
    if (deals?.length) g = groundDeals(g, deals);
    return g;
  };
  // The final adjudication, on the grounded script and against everything the writer was given: the Steam
  // facts and the format's own data (the chart's climbs, the deal prices). Without the data, a climbers
  // Short was dropped for chart moves that came from the chart itself (25 Oct 2026). One rewrite, then fail.
  const dataFacts = brief.trim()
    ? [
        {
          title:
            "The data this Short was built from (the format's own source, e.g. Steam's chart or store)",
          facts: brief,
        },
      ]
    : [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const factual = await adjudicateRanking(
      s,
      ep,
      evergreenToScript(ground(draft)),
      facts,
      attempt,
      dataFacts,
    );
    if (!factual.length) break;
    draft = await writeEvergreen(s.llm, topic, facts, factual, brief);
  }
  draft = ground(draft);
  const script = evergreenToScript(draft);
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    factcheck_json: {
      topic,
      facts: facts.map((f) => ({ title: f.title, facts: f.facts })),
    },
  });
}

// --------------------------------------------------------------------- steps

async function stepScript(s: Services, ep: Episode): Promise<void> {
  if (ep.lane === "cutdown") return stepScriptCutdown(s, ep);
  if (ep.lane === "gameplay") return stepScriptGameplay(s, ep);
  if (ep.lane === "twin") return stepScriptTwin(s, ep);
  if (ep.lane === "evergreen") return stepScriptEvergreen(s, ep);
  if (ep.lane === "longform") return stepScriptLongform(s, ep);
  const cluster = ep.story_json;
  const items = [...cluster.items]
    .sort(
      (a, b) =>
        (a.sourceKind === "official" ? -1 : 1) -
        (b.sourceKind === "official" ? -1 : 1),
    )
    .slice(0, 4);
  const articles = (
    await Promise.all(items.map((i) => s.fetchArticle(i.url)))
  ).filter((a): a is ArticleText => Boolean(a));
  const mustLabelRumour = !cluster.corroborated;

  // Live Steam numbers give the take something the headline doesn't have.
  let steam: EpisodeAssets["steam"];
  if (cluster.gameHint) {
    try {
      const app = await s.findGame(cluster.gameHint);
      if (app)
        steam = {
          appId: app.appId,
          name: app.name,
          facts: await s.gameFacts(app),
        };
    } catch (err) {
      log("warn", "steam lookup failed", {
        game: cluster.gameHint,
        error: errorMessage(err),
      });
    }
  }
  const storeData = steam ? factsText(steam.facts) : undefined;

  let script: Script | undefined;
  let feedback: string[] = [];
  let check;
  // Draft, check house rules, fact-check; one rewrite with the problems fed back.
  const recent = await recentShapes(s.db, ep.id).catch(() => undefined);
  for (let attempt = 0; attempt < 2; attempt++) {
    script = await writeScript(s.llm, cluster, articles, {
      lessons: await hookLessons(s.db, s.now(), segmentInputs).catch(() => ""),
      mustLabelRumour,
      feedback,
      storeData,
      recent,
    });
    const problems = validateScript(script, recent);
    // A report card is credited to an outlet: it must be one of this story's own sources.
    const outlets = cluster.items.map((i) => i.source.toLowerCase());
    for (const b of script.beats)
      if (
        b.visual.kind === "report" &&
        !outlets.some(
          (o) =>
            o.includes(b.visual.secondary.toLowerCase().trim()) ||
            b.visual.secondary.toLowerCase().includes(o),
        )
      )
        problems.push(
          `Report card names "${b.visual.secondary}", which is not one of this story's sources (${[...new Set(cluster.items.map((i) => i.source))].join(", ")}).`,
        );
    check = await factCheck(s.llm, script, cluster, articles, storeData);
    const blockers = check.issues
      .filter((i) => i.severity === "blocker")
      .map((i) => `Fact-check: "${i.quote}" - ${i.problem}`);
    if (
      check.verdict === "pass" &&
      check.rumour_labelling_ok &&
      blockers.length === 0 &&
      problems.length === 0
    )
      break;
    feedback = [
      ...blockers,
      ...problems,
      ...(check.rumour_labelling_ok ? [] : ["Rumour labelling is inadequate."]),
    ];
    if (attempt === 1) {
      // House-style misses alone are accepted with a warning; facts are not.
      if (
        check.verdict === "fail" ||
        blockers.length > 0 ||
        !check.rumour_labelling_ok
      ) {
        await markSeen(
          s.db,
          cluster.hash,
          cluster.headline,
          "rejected",
          "failed fact-check",
        );
        await transition(s.db, ep.id, "selected", "rejected", {
          script_json: script,
          factcheck_json: check,
          last_error: feedback.join(" | "),
        });
        log("info", "story dropped: failed fact-check twice", {
          episode: ep.id,
          headline: cluster.headline,
          problems: feedback.slice(0, 4),
        });
        await s.notify({
          level: "info",
          embeds: [
            {
              title: `🛑 Dropped: ${cluster.headline}`,
              description: `Failed fact-check twice.\n${feedback
                .slice(0, 6)
                .map((f) => `• ${f}`)
                .join("\n")}`,
              color: COLOURS.warn,
            },
          ],
        });
        return;
      }
      await logEvent(s.db, ep.id, "style_warnings", { problems });
    }
  }
  if (!script || !check) throw new Error("script step produced nothing");
  if ((script.is_rumour || mustLabelRumour) && !s.cfg.includeRumours) {
    log("info", "story dropped: a rumour, and rumours are off", {
      episode: ep.id,
      headline: cluster.headline,
    });
    await markSeen(
      s.db,
      cluster.hash,
      cluster.headline,
      "rejected",
      "rumour while INCLUDE_RUMOURS=false",
    );
    await transition(s.db, ep.id, "selected", "rejected", {
      script_json: script,
      factcheck_json: check,
      last_error: "rumour story; rumours are disabled",
    });
    return;
  }
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    factcheck_json: check,
    assets_json: steam ? { steam } : null,
  });
}

async function stepVoice(s: Services, ep: Episode): Promise<void> {
  // A cutdown speaks with the long video's own narration, cut with its section; a gameplay Short keeps the game's sound.
  if (ep.lane === "cutdown" || ep.lane === "gameplay") {
    await transition(s.db, ep.id, "scripted", "voiced");
    return;
  }
  const dir = episodeDir(s.cfg, ep.id);
  await fs.mkdir(dir, { recursive: true });
  // Voice rotation: the n-th Short the channel has made picks the n-th voice of the pool, so a few Shorts in a row share a voice and the analytics can say which one sticks.
  const [ord] = await s.db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes WHERE created_at < $1 AND status NOT IN ('failed','rejected')`,
    [ep.created_at],
  );
  // The narrator test: half of news Shorts are narrated by the test voice (Alice), the rest by the usual one.
  const voice = narratorFor(s.cfg, ep) ?? pickVoice(s.cfg, Number(ord?.n ?? 0));
  // A twin reads its figures in its own language (no English number-to-words pass) and only ElevenLabs
  // speaks it: the local clone speaks English.
  const twin = ep.lane === "twin";
  const desk0 = deskFor(s.cfg, ep);
  // When the desk partner would be the narrator, the usual narrator asks the question instead.
  const desk =
    desk0 && desk0.voice.id === voice.id
      ? { voice: { id: s.cfg.elevenLabsVoiceId, name: s.cfg.narratorName } }
      : desk0;
  let narration: Awaited<ReturnType<Services["synthesise"]>>;
  if (desk && s.stitchTakes) {
    // The desk experiment: the narrator up to the facts, the desk partner's question in a second voice,
    // the narrator's take and close; three takes stitched onto one timeline.
    const sc = ep.script_json!;
    const partA = speakable(
      [sc.hook, ...sc.beats.map((b) => b.narration)].join(" "),
    );
    const partQ = speakable(sc.desk_question!);
    const partB = speakable(
      [sc.pulse_take.narration, tidyLoopLine(sc.loop_line)].join(" "),
    );
    const a = await s.synthesise(partA, path.join(dir, "voice_a.mp3"), voice, {
      provider: "elevenlabs",
    });
    const q = await s.synthesise(
      partQ,
      path.join(dir, "voice_q.mp3"),
      desk.voice,
      { provider: "elevenlabs" },
    );
    const b = await s.synthesise(partB, path.join(dir, "voice_b.mp3"), voice, {
      provider: "elevenlabs",
    });
    const joined = await s.stitchTakes([a, q, b], path.join(dir, "voice.mp3"));
    narration = { ...joined, voice: a.voice };
    await logEvent(s.db, ep.id, "desk", {
      voice: desk.voice.name,
      question: sc.desk_question,
    });
  } else {
    narration = await s.synthesise(
      twin ? twinNarration(ep.script_json!) : narrationOf(ep.script_json!),
      path.join(dir, "voice.mp3"),
      voice,
      twin ? { provider: "elevenlabs" } : undefined,
    );
  }
  await logEvent(s.db, ep.id, "voice", {
    provider: narration.voice?.provider ?? "unknown",
    id: narration.voice?.id,
    name: narration.voice?.name,
  });
  // The voice sometimes stalls mid-sentence: cut those silences to a natural beat, with the word timings shifted to match.
  const tight = await tightenPauses(
    path.join(dir, "voice.mp3"),
    narration.words,
    narration.durationSeconds,
  ).catch((err) => {
    log("warn", "pause tightening failed; keeping the voice as recorded", {
      error: errorMessage(err),
    });
    return undefined;
  });
  if (tight && tight.removedSeconds > 0) {
    narration.words = tight.words;
    narration.durationSeconds = tight.durationSeconds;
    await logEvent(s.db, ep.id, "pauses_tightened", {
      seconds: Math.round(tight.removedSeconds * 10) / 10,
    });
  }
  // The narration check: what the voice says against its script, before anything is rendered on it.
  // A fault re-voices once; a second one is reported and the episode goes on (a misheard line should
  // not cost a week's long video). Caught the GTA ranking's "Sayus" and drifting timings (23 Oct 2026).
  const check = await (
    twin
      ? undefined
      : s.checkNarration?.(path.join(dir, "voice.mp3"), narration.words)
  )?.catch((err) => {
    log("warn", "narration check unavailable", { error: errorMessage(err) });
    return undefined;
  });
  if (check) {
    await logEvent(s.db, ep.id, "narration_check", {
      ok: check.ok,
      drift: check.drift,
      matched: Math.round(check.matched * 1000) / 1000,
      issues: check.issues.slice(0, 10),
      pauses: check.pauses.slice(0, 10),
    });
    if (check.pauses.length)
      log("warn", "mid-sentence pauses in the narration", {
        episode: ep.id,
        pauses: check.pauses
          .slice(0, 5)
          .map((p) => `${p.seconds}s between "${p.before}" and "${p.after}"`),
      });
    if (!check.ok) {
      const [prior] = await s.db.query<{ n: string | number }>(
        `SELECT count(*) AS n FROM events WHERE episode_id = $1 AND kind = 'narration_check' AND detail->>'ok' = 'false'`,
        [ep.id],
      );
      if (Number(prior?.n ?? 0) <= 1)
        throw new Error(
          `narration check failed, voicing again: ${narrationSummary(check)}`,
        );
      log("warn", "narration check failed twice; going on", {
        episode: ep.id,
        problems: narrationSummary(check),
      });
      await s.notify({
        content: `🎙️ The narration for "${ep.script_json?.headline ?? ep.id}" still has a fault after a second take, so it goes ahead: ${narrationSummary(check)}`,
      });
    } else
      log("info", "narration check passed", {
        episode: ep.id,
        drift: check.drift,
      });
  }
  const maxSeconds =
    ep.lane === "evergreen"
      ? s.cfg.evergreenMaxSeconds
      : ep.lane === "longform"
        ? ep.script_json?.evergreen_format === "documentary"
          ? s.cfg.docMaxSeconds
          : s.cfg.longformMaxSeconds
        : 58;
  if (narration.durationSeconds > maxSeconds)
    throw new FatalError(
      `narration is ${narration.durationSeconds.toFixed(1)}s, over the ${maxSeconds}s cap for the ${ep.lane} lane`,
    );
  // A documentary breathes before each chapter: a few seconds with the narrator silent, the music up
  // and the chapter's title full screen (owner, 27 Oct 2026: "very narrative and word heavy").
  let breaks: EpisodeAssets["breaks"];
  if (
    ep.script_json?.evergreen_format === "documentary" &&
    narration.words.length
  ) {
    try {
      const segs = buildSegments(
        segmentInputs(ep.script_json),
        narration.words,
        narration.durationSeconds,
      );
      const firstWords = segs
        .filter((g) => g.kind === "beat" && g.visual?.kind === "chapter")
        .map((g) => narration.words.findIndex((w) => w.start >= g.start - 0.05))
        .filter((k) => k > 0);
      const gaps = chapterGaps(narration.words, firstWords, DOC_BREAK_SECONDS);
      if (gaps.length) {
        await insertSilence(path.join(dir, "voice.mp3"), gaps);
        narration.words = openWords(narration.words, gaps);
        narration.durationSeconds += gaps.reduce((n, g) => n + g.seconds, 0);
        let added = 0;
        breaks = gaps.map((g) => {
          const start = g.at + added;
          added += g.seconds;
          return { start, end: start + g.seconds };
        });
      }
    } catch (err) {
      log("warn", "documentary breathers skipped", {
        episode: ep.id,
        error: errorMessage(err),
      });
    }
  }
  await fs.writeFile(
    path.join(dir, "captions.srt"),
    srtFromWords(narration.words),
    "utf8",
  );
  const assets: EpisodeAssets = {
    ...(ep.assets_json ?? {}),
    audio: "voice.mp3",
    words: narration.words,
    durationSeconds: narration.durationSeconds,
    srt: "captions.srt",
    voice: narration.voice,
    ...(breaks?.length ? { breaks } : {}),
    ...(desk && s.stitchTakes
      ? {
          desk: { voice: desk.voice, question: ep.script_json!.desk_question! },
        }
      : {}),
  };
  await transition(s.db, ep.id, "scripted", "voiced", { assets_json: assets });
}

/**
 * Whether this Short gets the desk partner's question: the experiment is on, the writer gave one, the lane
 * is news, and the episode falls in the experiment's share (by a stable hash of its id, so a re-voice gets
 * the same answer). Returns the partner's voice.
 */
/**
 * The narrator test: on news, breaking and free Shorts, NARRATOR_TEST_SHARE of them (by a stable hash of
 * the episode id, salted so it is independent of the desk test's split) are narrated by the test voice.
 * Returns that voice, or undefined for the usual narrator.
 */
export function narratorFor(
  cfg: Config,
  ep: Pick<Episode, "id" | "lane">,
): { id: string; name: string } | undefined {
  if (!cfg.narratorTestVoiceId || cfg.narratorTestShare <= 0) return undefined;
  if (!["news", "news_breaking", "free"].includes(ep.lane)) return undefined;
  let h = 7;
  for (const c of `narrator:${ep.id}`) h = (h * 131 + c.charCodeAt(0)) >>> 0;
  if (h % 1000 >= cfg.narratorTestShare * 1000) return undefined;
  return { id: cfg.narratorTestVoiceId, name: cfg.narratorTestVoiceName };
}

/**
 * The new-look test (owner, 27 Oct 2026: "a huge channel overhaul"): SHORT_SUITE_SHARE of Shorts (by a
 * stable hash of the episode id, salted so it is independent of the other tests) get the editor's dressing.
 * The Spanish twin copies its source and is left out.
 */
export function suiteFor(cfg: Config, ep: Pick<Episode, "id" | "lane">): boolean {
  if (cfg.shortSuiteShare <= 0 || ep.lane === "twin") return false;
  let h = 11;
  for (const c of `suite:${ep.id}`) h = (h * 137 + c.charCodeAt(0)) >>> 0;
  return h % 1000 < cfg.shortSuiteShare * 1000;
}

export function deskFor(
  cfg: Config,
  ep: Pick<Episode, "id" | "lane" | "script_json">,
): { voice: { id: string; name: string } } | undefined {
  if (!cfg.deskVoiceId || cfg.deskShare <= 0) return undefined;
  if (!ep.script_json?.desk_question?.trim()) return undefined;
  if (!["news", "news_breaking", "free"].includes(ep.lane)) return undefined;
  let h = 0;
  for (const c of ep.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  if (h % 1000 >= cfg.deskShare * 1000) return undefined;
  return { voice: { id: cfg.deskVoiceId, name: cfg.deskVoiceName } };
}

async function gatherMedia(
  s: Services,
  ep: Episode,
  dir: string,
  /** The second pass after a red media rubric: more screenshots and clips so the plan can vary. */
  rich = false,
): Promise<Pick<EpisodeAssets, "images" | "clips" | "officialTrailer">> {
  const script = ep.script_json!;
  // Prefer the exact store name resolved at script time so art and clips come from the same app as the facts.
  const term =
    ep.assets_json?.steam?.name ||
    script.steam_search_term ||
    script.game_title ||
    ep.story_json.gameHint ||
    "";
  const app = term ? await s.findGame(term).catch(() => undefined) : undefined;
  const art = app
    ? await s.fetchArt(app, dir, rich ? 8 : 4).catch(() => [] as VisualAsset[])
    : [];
  // Official trailer B-roll: short muted clips, at most MAX_TRAILER_CLIPS.
  // Beat-matched trailer moments: the hook and each beat ask for what they name.
  // A ranking Short's entries bring their own moments; the topic's page supplies only the hook moment.
  const ranking = Boolean(script.entries?.length);
  const topicTargets = ranking
    ? targetsFor(script).filter((t) => t.key === "hook")
    : targetsFor(script);
  const clipAssets =
    app && s.cfg.footage && s.cfg.maxClips > 0 && topicTargets.length
      ? await s
          .fetchClips(
            app,
            dir,
            topicTargets,
            ranking ? 1 : s.cfg.maxClips + (rich ? 2 : 0),
          )
          .catch((err) => {
            log("warn", "trailer clips failed", {
              episode: ep.id,
              error: errorMessage(err),
            });
            return [] as VisualAsset[];
          })
      : [];
  // Per-publisher footage budget (Rockstar: about 6 s per Short). Clips beyond it are dropped, in order.
  const narrationSeconds = ep.assets_json?.durationSeconds ?? 45;
  // Not on Steam (GTA VI, Nintendo titles): the publisher's own YouTube trailer stands in, under that publisher's cap.
  // A picture story: the publisher's own video of it comes first, whether or not the game is on Steam.
  const pictureStory = ep.story_json.visualNeed === "real_world_images";
  const storyAfter = new Date(
    new Date(ep.story_json.newestAt ?? s.now().toISOString()).getTime() -
      7 * 86_400_000,
  );
  const official: OfficialMedia =
    // The publisher's own YouTube trailer: for games not on Steam, picture stories, and Steam pages with no
    // usable trailer (Metal Gear Solid matched an old bundle whose one video would not download, 25 Oct 2026).
    (pictureStory || !app || clipAssets.length < 2) &&
    s.cfg.footage &&
    script.game_title
      ? await s
          .fetchOfficialMedia(
            script.game_title,
            dir,
            topicTargets,
            ranking ? 1 : s.cfg.maxClips,
            "",
            pictureStory
              ? {
                  text: `${ep.story_json.headline} ${script.headline}`,
                  after: storyAfter,
                }
              : undefined,
          )
          .catch((err) => {
            log("warn", "official trailer media failed", {
              episode: ep.id,
              error: errorMessage(err),
            });
            return { clips: [], stills: [] } as OfficialMedia;
          })
      : { clips: [], stills: [] };
  if (official.trailer)
    await logEvent(s.db, ep.id, "official_trailer", {
      videoId: official.trailer.videoId,
      publisher: official.trailer.publisher,
      title: official.trailer.title,
      clips: official.clips.length,
      still: official.stills.length > 0,
    });
  const steamBudget = app
    ? Math.max(
        footageBudgetSeconds(app),
        clipAssets.length < 2 ? (official.trailer?.clipSeconds ?? 0) : 0,
      )
    : (official.trailer?.clipSeconds ?? 0);
  // Up to 85% of the narration may run on footage (the owner raised the cap, 24 Oct 2026); this line held
  // it at 40% after the publisher budget was raised, so Shorts stayed at about a third footage.
  const budget = Math.min(steamBudget, Math.max(10, narrationSeconds * 0.85));
  const clips: NonNullable<EpisodeAssets["clips"]> = capFootage(
    official.storyVideo || !app
      ? official.clips
      : clipAssets.length < 2
        ? [...clipAssets, ...official.clips]
        : clipAssets,
    budget,
  ).map((c) => ({
    file: c.file,
    sourceUrl: c.sourceUrl,
    provenance: c.provenance,
    durationSeconds: c.durationSeconds ?? 3.4,
    beatIndex: c.beatIndex,
    role: c.role,
    motion: c.motion,
    luma: c.luma,
    label: c.label,
    reason: c.reason,
    startSeconds: c.startSeconds,
    stock: c.stock,
  }));
  // Licensed stock for the real-world lines of a picture story that has no publisher video of it.
  if (pictureStory && !official.storyVideo) {
    // Every fact line can carry an illustrative shot: quiet lines show it in the framed panel under their card.
    const realLines = targetsFor(script).filter((t) =>
      t.key.startsWith("beat:"),
    );
    const stock = await s
      .fetchStock(
        dir,
        realLines,
        script.game_title.split(/\s+/),
        Math.min(3, realLines.length),
      )
      .catch((err) => {
        log("warn", "stock footage failed", {
          episode: ep.id,
          error: errorMessage(err),
        });
        return [] as VisualAsset[];
      });
    for (const c of stock)
      clips.push({
        file: c.file,
        sourceUrl: c.sourceUrl,
        provenance: c.provenance,
        durationSeconds: c.durationSeconds ?? 4,
        beatIndex: c.beatIndex,
        role: undefined,
        motion: 0.5,
        luma: undefined,
        label: c.label,
        reason: c.reason,
        startSeconds: 0,
        stock: true,
      });
  }
  if (clips.length < clipAssets.length)
    log("info", "footage capped", {
      episode: ep.id,
      budgetSeconds: budget,
      dropped: clipAssets.length - clips.length,
    });
  // Off Steam (GTA VI, Nintendo, console exclusives): IGDB's official stills for the story's game.
  const igdb =
    !app && !ranking && script.game_title
      ? await s
          .igdbArt(script.game_title, undefined, dir, 8)
          .catch(() => [] as VisualAsset[])
      : [];
  // In a ranking, the topic page's screenshots would land under the wrong entry: keep its hero and header only.
  const images = [
    ...igdb,
    ...art.filter(
      (a) =>
        a.kind !== "logo" &&
        (!ranking || a.kind === "hero" || a.kind === "header"),
    ),
    ...official.stills,
  ];
  // First-party newsroom images (PlayStation Blog, Xbox Wire) are press
  // material meant for coverage. Outlet images are never used.
  {
    const official = ep.story_json.items.filter(
      (i) => i.sourceKind === "official",
    );
    let k = 0;
    for (const item of official) {
      // A newsroom post's whole gallery (Rockstar Newswire), else its one share image.
      const article =
        item.imageUrl && !/rockstargames\.com/.test(item.url)
          ? undefined
          : await s.fetchArticle(item.url);
      const urls = [
        ...new Set(
          [item.imageUrl, ...(article?.images ?? []), article?.ogImage].filter(
            (u): u is string => Boolean(u),
          ),
        ),
      ].slice(0, 6);
      for (const og of urls) {
        const file = path.join("assets", `official_${k}.jpg`);
        await fs.mkdir(path.join(dir, "assets"), { recursive: true });
        if (await s.downloadImage(og, path.join(dir, file))) {
          images.push({
            kind: "article",
            file,
            sourceUrl: og,
            provenance: `Official press image from ${item.source} (${item.url})`,
          });
          k++;
        }
      }
    }
  }
  // Ranking Shorts: each entry brings its own box art and one trailer moment, tagged with its line.
  if (script.entries?.length) {
    const sorted = [...script.entries].sort((a, b) => b.rank - a.rank);
    for (const [beatIndex, entry] of sorted.entries()) {
      // An achievement's own icon is its card's box art (Steam community assets, official).
      if (entry.icon) {
        const file = path.join(
          `entry_${beatIndex}`,
          "assets",
          "achievement_icon.jpg",
        );
        await fs.mkdir(path.join(dir, `entry_${beatIndex}`, "assets"), {
          recursive: true,
        });
        if (
          await s
            .downloadImage(entry.icon, path.join(dir, file))
            .catch(() => false)
        )
          images.push({
            kind: "capsule",
            file,
            sourceUrl: entry.icon,
            provenance: `Steam achievement icon for "${entry.game_title}" (${entry.platforms})`,
            beatIndex,
          });
      }
      try {
        // A long-form entry with a shot list: a picture for every sentence.
        if (
          ep.lane === "longform" &&
          entry.moments?.length &&
          script.evergreen_format !== "documentary"
        ) {
          await gatherLongEntryMedia(
            s,
            script,
            entry,
            beatIndex,
            dir,
            images,
            clips,
          );
          continue;
        }
        // A recap chapter reuses its Short's media, already picked and passed by QA.
        if (
          entry.from_episode &&
          (await copyShortMedia(
            s,
            entry.from_episode,
            beatIndex,
            dir,
            images,
            clips,
          ))
        )
          continue;
        // A documentary chapter runs minutes: its own gallery, matched footage and archive photos.
        if (script.evergreen_format === "documentary") {
          await gatherChapterMedia(
            s,
            script,
            entry,
            beatIndex,
            dir,
            images,
            clips,
          );
          continue;
        }
        // An empty Steam term means the writer knows the game is not on Steam: straight to the publisher's trailer.
        const eapp = await steamAppForEntry(s, entry);
        if (!eapp) {
          if (!s.cfg.footage) continue;
          const want = script.beats[beatIndex]?.footage;
          const edir = path.join(dir, `entry_${beatIndex}`);
          const om = await s.fetchOfficialMedia(
            entry.game_title,
            edir,
            [
              {
                key: `beat:${beatIndex}`,
                text: entry.game_title,
                want: want?.want ?? "gameplay",
                energy: "medium",
                keywords: want?.keywords ?? [entry.game_title],
              },
            ],
            1,
            entry.year ? String(entry.year) : "",
          );
          for (const a of om.stills)
            images.push({
              ...a,
              file: path.join(`entry_${beatIndex}`, a.file),
              beatIndex,
            });
          // Off Steam, IGDB supplies the box art and stills the card and shots need.
          for (const a of await s
            .igdbArt(entry.game_title, entry.year, edir, 3)
            .catch(() => [] as VisualAsset[]))
            images.push({
              ...a,
              file: path.join(`entry_${beatIndex}`, a.file),
              beatIndex,
            });
          for (const c of capFootage(om.clips, om.trailer?.clipSeconds ?? 0))
            clips.push({
              file: path.join(`entry_${beatIndex}`, c.file),
              sourceUrl: c.sourceUrl,
              provenance: c.provenance,
              durationSeconds: Math.min(c.durationSeconds ?? 4, 4),
              beatIndex,
              role: undefined,
              motion: c.motion,
              luma: c.luma,
              label: c.label,
              reason: c.reason,
              startSeconds: c.startSeconds,
            });
          continue;
        }
        const doc = (script.evergreen_format as string) === "documentary"; // documentaries take gatherChapterMedia above
        // A documentary chapter runs minutes, not seconds: it needs the game's whole gallery.
        // A Short's entry keeps its hero, its box art and three screenshots: when the trailer yields no
        // usable moment (pixel art reads as text, dark games fail the luma floor) the line still cuts.
        let screens = 0;
        const art = (
          await s.fetchArt(eapp, path.join(dir, `entry_${beatIndex}`))
        ).filter((a) =>
          doc
            ? a.kind !== "logo"
            : (a.kind === "capsule" && !entry.icon) ||
              a.kind === "hero" ||
              // A new release often has no hero art yet: its store header is the last-resort still.
              a.kind === "header" ||
              (a.kind === "screenshot" && screens++ < (rich ? 6 : 3)),
        );
        for (const a of art)
          images.push({
            ...a,
            file: path.join(`entry_${beatIndex}`, a.file),
            beatIndex,
          });
        const want = doc
          ? chapterFootage(script, beatIndex)[0]
          : script.beats[beatIndex]?.footage;
        const long = ep.lane === "longform";
        const perEntry = doc
          ? Math.max(1, s.cfg.docClipsPerChapter)
          : long
            ? Math.max(1, s.cfg.longformClipsPerEntry)
            : 1;
        const entryTargets: FootageTarget[] = [
          {
            key: `beat:${beatIndex}`,
            text: entry.game_title,
            want: want?.want ?? "gameplay",
            energy: "medium",
            keywords: want?.keywords ?? [entry.game_title],
          },
        ];
        // A documentary chapter asks for the moments its paragraphs name.
        if (doc)
          for (const [k, f] of chapterFootage(script, beatIndex)
            .slice(1, perEntry)
            .entries())
            entryTargets.push({
              key: `beat:${beatIndex}#${k + 2}`,
              text: `${entry.game_title}: ${f.keywords.join(", ")}`,
              want: f.want,
              energy: "medium",
              keywords: [entry.game_title, ...f.keywords].slice(0, 4),
            });
        // A long entry runs 30-45 s: a second, different moment keeps it moving.
        else if (perEntry > 1)
          entryTargets.push({
            key: `beat:${beatIndex}#2`,
            text: `${entry.game_title}, a different moment`,
            want: want?.want === "gameplay" ? "cinematic" : "gameplay",
            energy: "medium",
            keywords: [entry.game_title, "gameplay"],
          });
        const fetched = await s.fetchClips(
          eapp,
          path.join(dir, `entry_${beatIndex}`),
          entryTargets,
          perEntry,
        );
        // Footage stays subordinate: a documentary chapter gets the same publisher budget a Short does.
        const got = doc
          ? capFootage(fetched, footageBudgetSeconds(eapp), 4.8)
          : fetched;
        for (const c of got)
          clips.push({
            file: path.join(`entry_${beatIndex}`, c.file),
            sourceUrl: c.sourceUrl,
            provenance: c.provenance,
            durationSeconds: Math.min(c.durationSeconds ?? 4, long ? 4.8 : 4),
            beatIndex,
            role: undefined,
            motion: c.motion,
            luma: c.luma,
            label: c.label,
            reason: c.reason,
            startSeconds: c.startSeconds,
          });
      } catch (err) {
        log("warn", "entry media failed", {
          game: entry.game_title,
          error: errorMessage(err),
        });
      }
    }
  }
  // A story about a person shows the person: a freely licensed photo from Wikimedia Commons,
  // credited on screen, on the first line that names them (else wherever a still is needed).
  if (script.person?.trim())
    await personPhoto(s, ep, dir, script.person.trim(), images);
  // Screenshots get the same local screen as clip frames: a webcam or gore is never used, and
  // one with menu or HUD text across it ("SET V'S APPEARANCE") is used only after the clean ones.
  // Key art and article images are screened for text only: one with the game's logo printed
  // across it should not open the Short under the headline (QA notes, 26 Oct 2026: the
  // headline collided with the FINAL FANTASY VII REMAKE INTERGRADE logo on frame 1).
  const shots = images.filter(
    (a) => a.kind === "screenshot" || a.kind === "hero" || a.kind === "article",
  );
  const flags = shots.length
    ? await screenFrames(shots.map((a) => path.join(dir, a.file))).catch(
        () => [],
      )
    : [];
  const unusable = new Set<string>();
  const wordy = new Set<string>();
  for (const [k, f] of flags.entries()) {
    if (!f) continue;
    if ((f.webcam || f.gore) && shots[k]!.kind === "screenshot")
      unusable.add(shots[k]!.file);
    else if (f.text) wordy.add(shots[k]!.file);
  }
  if (unusable.size || wordy.size)
    log("info", "screenshots screened", {
      episode: ep.id,
      dropped: unusable.size,
      wordy: wordy.size,
    });
  const out: NonNullable<EpisodeAssets["images"]> = [];
  for (const a of images) {
    if (unusable.has(a.file)) continue;
    out.push({
      file: a.file,
      kind: a.kind,
      sourceUrl: a.sourceUrl,
      provenance: a.provenance,
      aspect: await s.imageAspect(path.join(dir, a.file)),
      beatIndex: a.beatIndex,
      moment: a.moment,
      label: a.label,
      ...(wordy.has(a.file) ? { wordy: true } : {}),
    });
  }
  // Lead with the most cinematic art; screenshots fill the middle.
  const rank: Record<string, number> = {
    hero: 0,
    photo: 1,
    article: 2,
    capsule: 3,
    screenshot: 4,
    header: 5,
  };
  return {
    images: out.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9)),
    clips,
    officialTrailer: official.trailer,
  };
}

/** "Steve Hammond / CC BY-SA 2.0 / Wikimedia Commons" for an archive photo, else nothing. */
export function photoCredit(i: {
  kind: string;
  provenance?: string;
}): string | undefined {
  if (i.kind !== "photo") return undefined;
  const m = (i.provenance ?? "").match(
    /^Wikimedia Commons photo by (.+?), ([^,:]+): /,
  );
  return m
    ? `${m[1]!.slice(0, 40)} / ${m[2]} / Wikimedia Commons`
    : "Wikimedia Commons";
}

/** A video about single-player campaigns keeps multiplayer footage out of every pick. */
/** A story ranking warns about spoilers in its first spoken lines. */
export function withSpoilerWarning(script: Script): Script {
  if (scopeOf(script) !== "campaign" || /spoiler/i.test(script.hook))
    return script;
  return {
    ...script,
    // The script may already say "Fair warning" about the ranking itself: never twice in one intro.
    hook: `${script.hook.trim()} ${/fair warning/i.test(script.hook) ? "And expect story spoilers." : "Fair warning: story spoilers ahead."}`,
  };
}

export function scopeOf(script: Script): "campaign" | undefined {
  // A week's recap covers many games: one story's "campaign" must not scope the whole video.
  if (script.recap) return undefined;
  const t = `${script.criterion ?? ""} ${script.headline} ${script.kicker ?? ""} ${script.youtube?.title ?? ""}`;
  return /\bcampaigns?\b|story mode|single[- ]player/i.test(t)
    ? "campaign"
    : undefined;
}

/**
 * Copies a published Short's images and clips into a recap chapter (entry_<beat>/short_*), tagged for
 * that chapter. False when the Short's media is gone (pruned after 14 days), so the chapter gathers its own.
 */
async function copyShortMedia(
  s: Services,
  episodeId: string,
  beatIndex: number,
  dir: string,
  images: Array<VisualAsset & { beatIndex?: number }>,
  clips: NonNullable<EpisodeAssets["clips"]>,
): Promise<boolean> {
  const short = await getEpisode(s.db, episodeId);
  const a = short?.assets_json;
  if (!a) return false;
  const from = episodeDir(s.cfg, episodeId);
  const sub = `entry_${beatIndex}`;
  await fs.mkdir(path.join(dir, sub), { recursive: true });
  const copy = async (file: string): Promise<string | undefined> => {
    const dest = path.join(sub, `short_${file.replace(/[\\/]/g, "_")}`);
    try {
      await fs.copyFile(path.join(from, file), path.join(dir, dest));
      return dest;
    } catch {
      return undefined;
    }
  };
  let n = 0;
  for (const img of a.images ?? []) {
    if (img.kind === "logo") continue;
    const file = await copy(img.file);
    if (!file) continue;
    images.push({
      ...img,
      file,
      beatIndex,
      moment: undefined,
    } as VisualAsset & { beatIndex?: number });
    n++;
  }
  for (const c of a.clips ?? []) {
    const file = await copy(c.file);
    if (!file) continue;
    clips.push({ ...c, file, beatIndex, role: undefined, moment: undefined });
    n++;
  }
  return n >= 3;
}

/** Up to two licensed photos of a named person for a Short, chosen by a cheap model from a Commons search. */
async function personPhoto(
  s: Services,
  ep: Episode,
  dir: string,
  person: string,
  images: Array<VisualAsset & { beatIndex?: number }>,
): Promise<void> {
  const script = ep.script_json!;
  try {
    const candidates = (await s.searchPhotos(person).catch(() => []))
      .filter((c) => c.width >= 800)
      .slice(0, 20);
    if (!candidates.length) return;
    const keep = (
      await pickPhotos(
        s.llm,
        {
          franchise: person,
          game: script.game_title,
          title: script.headline,
          opening: `A news story about ${person}: ${script.hook}`,
        },
        candidates,
      )
    ).slice(0, 2);
    const surname = person.split(/\s+/).pop()!.toLowerCase();
    const line = script.beats.findIndex((b) =>
      b.narration.toLowerCase().includes(surname),
    );
    await fs.mkdir(path.join(dir, "assets"), { recursive: true });
    for (const [k, i] of keep.entries()) {
      const img = candidates[i]!;
      const file = path.join("assets", `person_${k}.jpg`);
      if (!(await s.downloadPhoto(img, path.join(dir, file)))) continue;
      images.push({
        kind: "photo",
        file,
        sourceUrl: img.pageUrl,
        provenance: `Wikimedia Commons photo by ${img.artist}, ${img.license}: ${img.pageUrl}`,
        label: person,
        ...(line >= 0 && k === 0 ? { beatIndex: line } : {}),
      } as VisualAsset & { beatIndex?: number });
    }
    log("info", "person photo added", {
      episode: ep.id,
      person,
      photos: keep.length,
    });
  } catch (err) {
    log("warn", "person photo failed", {
      episode: ep.id,
      person,
      error: errorMessage(err),
    });
  }
}

/** The footage asks of one documentary chapter's paragraphs, in order. */
export function chapterFootage(
  script: Script,
  chapter: number,
): Array<{ want: FootageTarget["want"]; keywords: string[] }> {
  const out: Array<{ want: FootageTarget["want"]; keywords: string[] }> = [];
  let c = -1;
  for (const b of script.beats) {
    if (b.visual?.kind === "chapter") c++;
    if (c === chapter && b.footage && b.footage.want !== "none")
      out.push({ want: b.footage.want, keywords: b.footage.keywords });
  }
  return out;
}

function titleCaseLabel(label: string): string {
  return label.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

/**
 * One long-form ranking entry's media, sentence by sentence: the store
 * gallery (topped up from IGDB), a trailer moment matched to each sentence's
 * shot note, then a vision pass that gives each sentence the still showing
 * what it names and drops any picture with text in it.
 */
export async function gatherLongEntryMedia(
  s: Services,
  script: Script,
  entry: NonNullable<Script["entries"]>[number],
  beatIndex: number,
  dir: string,
  images: Array<VisualAsset & { beatIndex?: number }>,
  clips: NonNullable<EpisodeAssets["clips"]>,
): Promise<void> {
  const edir = path.join(dir, `entry_${beatIndex}`);
  const rel = (f: string) => path.join(`entry_${beatIndex}`, f);
  const moments = entry.moments ?? [];
  const sentences = sentencesOf(script.beats[beatIndex]?.narration ?? "");
  const scope = scopeOf(script);
  const targets: FootageTarget[] = moments.slice(0, 6).map((m, k) => ({
    key: `beat:${beatIndex}#m${k}`,
    text: `${sentences[k] ?? ""} (show: ${m.show})${scope === "campaign" ? " [single-player campaign footage only: no multiplayer, Zombies or Warzone, no multiplayer HUD]" : ""}`,
    want: script.beats[beatIndex]?.footage?.want ?? "gameplay",
    energy: "medium",
    // A named person leads the keywords so their own footage is searched for (and a portrait can be cut from it).
    keywords: [
      entry.game_title,
      ...(m.person ? [m.person] : []),
      ...m.keywords.filter((k) => k !== m.person),
    ].slice(0, 4),
  }));
  const pushClip = (c: VisualAsset) =>
    clips.push({
      file: rel(c.file),
      sourceUrl: c.sourceUrl,
      provenance: c.provenance,
      durationSeconds: Math.min(c.durationSeconds ?? 4, 4.8),
      beatIndex,
      moment: c.moment,
      role: undefined,
      motion: c.motion,
      luma: c.luma,
      label: c.label,
      reason: c.reason,
      startSeconds: c.startSeconds,
    });
  const mine: Array<VisualAsset & { beatIndex?: number }> = [];
  try {
    const eapp = await steamAppForEntry(s, entry).catch(() => undefined);
    if (eapp) {
      mine.push(
        ...(await s.fetchArt(eapp, edir, 12)).filter((a) => a.kind !== "logo"),
      );
      if (s.cfg.footage && targets.length)
        for (const c of capFootage(
          await s.fetchClips(
            eapp,
            edir,
            targets,
            targets.length,
            scopeOf(script),
          ),
          Math.max(
            footageBudgetSeconds(eapp),
            Math.min(45, footageBudgetSeconds(eapp) * 2.25),
          ),
          4.8,
        ))
          pushClip(c);
    } else if (s.cfg.footage && targets.length) {
      const om = await s
        .fetchOfficialMedia(
          entry.game_title,
          edir,
          targets,
          targets.length,
          entry.year ? String(entry.year) : "",
        )
        .catch(() => ({ clips: [], stills: [] }) as OfficialMedia);
      if (
        om.trailer &&
        trailerMatchesGame(
          om.trailer.title,
          entry.game_title,
          script.game_title || entry.game_title,
        ) &&
        (await s.judgeFootage(
          entry.game_title,
          entry.year,
          om.trailer.title,
          scope,
        ))
      )
        for (const c of capFootage(om.clips, om.trailer.clipSeconds ?? 0))
          pushClip(c);
      else if (om.trailer)
        log("info", "official trailer refused for this entry", {
          game: entry.game_title,
          trailer: om.trailer.title,
        });
    }
    // The owner's own recordings come first: the best footage there is.
    for (const c of await s
      .ownClips(
        entry.game_title,
        script.game_title || entry.game_title,
        edir,
        targets.slice(0, 12),
        12,
      )
      .catch(() => [] as VisualAsset[]))
      clips.push({
        file: rel(c.file),
        sourceUrl: c.sourceUrl,
        provenance: c.provenance,
        durationSeconds: Math.min(c.durationSeconds ?? 4, 8),
        beatIndex,
        moment: c.moment,
        role: undefined,
        motion: c.motion,
        luma: c.luma,
        label: c.label,
        reason: c.reason,
        startSeconds: c.startSeconds,
        audio: c.audio,
      });
    // Licensed gameplay for every sentence (real missions and moments, credited), on top of any trailer moment:
    // a sentence then plays as footage, not a still.
    // Two different moments per sentence: footage for the whole line, not one clip and then a still.
    const missing = targets.slice(0, 10).flatMap((t) => [
      t,
      {
        ...t,
        key: t.key.replace(/#m(\d+)$/, "#alt#m$1"),
        text: `${t.text}, a different moment`,
      },
    ]);
    if (missing.length)
      for (const c of await s
        .gameplayClips(
          entry.game_title,
          script.game_title || entry.game_title,
          entry.year,
          edir,
          missing,
          missing.length,
          scope,
        )
        .catch(() => [] as Array<VisualAsset & { credit: string }>))
        clips.push({
          file: rel(c.file),
          sourceUrl: c.sourceUrl,
          provenance: c.provenance,
          durationSeconds: Math.min(c.durationSeconds ?? 4, 8),
          beatIndex,
          moment: c.moment,
          role: undefined,
          motion: c.motion,
          luma: c.luma,
          label: c.label,
          reason: c.reason,
          startSeconds: c.startSeconds,
          credit: c.credit,
          audio: c.audio,
        });
    // IGDB tops up a thin gallery (and supplies everything for games off Steam).
    const have = mine.filter((a) => a.kind !== "capsule").length;
    if (have < 10)
      for (const a of await s
        .igdbArt(entry.game_title, entry.year, edir, 12 - have)
        .catch(() => [] as VisualAsset[]))
        if (a.kind !== "capsule" || !mine.some((m) => m.kind === "capsule"))
          mine.push(a);
  } catch (err) {
    log("warn", "long entry media failed", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
  // The picture editor: a still per sentence, and no picture with text behind the graphics.
  const stills = mine.filter((a) => a.kind !== "capsule");
  try {
    const ranked = await rankStills(
      s.llm,
      moments.map((m, k) => ({
        key: `m${k}`,
        show: m.show,
        sentence: sentences[k] ?? "",
      })),
      stills.map((a) => ({ file: path.join(edir, a.file) })),
      path.join(edir, "stillscore"),
      scope,
    );
    for (const [i, a] of stills.entries()) {
      a.label = ranked.labels.get(i);
      if (ranked.withText.has(i)) (a as { drop?: boolean }).drop = true;
    }
    for (const p of ranked.picks)
      stills[p.image]!.moment = Number(p.key.slice(1));
    // A handheld game shows its interface in every screenshot: dropping them all left GTA Advance on the
    // blank plate for 70 s (GTA ranking, 23 Oct 2026). Below three clean stills, the first few stay.
    const clean = stills.filter((a) => !(a as { drop?: boolean }).drop).length;
    if (clean < 3)
      for (const a of stills
        .filter((x) => (x as { drop?: boolean }).drop)
        .slice(0, 4 - clean))
        delete (a as { drop?: boolean }).drop;
    // A story video uses no store screenshots: for shooters they are mostly multiplayer maps, and
    // no picture editor can tell a map from a campaign level by eye (a Vanguard map passed as a
    // campaign shot). Footage carries the story; key art stays for the rank card.
    if (scope === "campaign")
      for (const a of stills)
        if (a.kind === "screenshot") (a as { drop?: boolean }).drop = true;
  } catch (err) {
    log("warn", "still ranking failed; stills keep entry order", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
  for (const a of mine)
    if (!(a as { drop?: boolean }).drop)
      images.push({ ...a, file: rel(a.file), beatIndex });
  // A face for every sentence that names a person, cut from the footage chosen for that sentence.
  for (const [k, m] of moments.entries()) {
    const person = (m as { person?: string }).person?.trim();
    if (!person) continue;
    // Only footage from a video whose title names this person: a face from anywhere else could be anyone, and a wrong name is misinformation.
    const named = (t: string) => normTitle(t).includes(normTitle(person));
    const clip = clips.find(
      (c) => c.beatIndex === beatIndex && c.moment === k && named(c.provenance),
    );
    if (!clip) continue;
    const file = path.join("assets", `portrait_m${k}.jpg`);
    const ok = await cutPortrait(
      path.join(dir, clip.file),
      path.join(edir, file),
    ).catch(() => false);
    if (!ok) continue;
    images.push({
      kind: "portrait",
      file: rel(file),
      sourceUrl: clip.sourceUrl,
      provenance: `Portrait of ${person} cut from: ${clip.provenance}`,
      beatIndex,
      moment: k,
      label: person.toUpperCase(),
      width: 960,
      height: 540,
    });
    log("info", "character portrait", {
      game: entry.game_title,
      person,
      moment: k,
    });
  }
}

/**
 * One documentary chapter's media. Steam first (the writer's term, then the
 * game's re-release names), only when the store page is this game and not a
 * sibling; its whole screenshot gallery and footage matched to the chapter's
 * paragraphs, within the publisher's budget. Off Steam, the publisher's trailer
 * only when its title names this game, and never its thumbnail. Then archive
 * photos of the real studio, people and places, picked by an editor pass.
 */
async function gatherChapterMedia(
  s: Services,
  script: Script,
  entry: NonNullable<Script["entries"]>[number],
  beatIndex: number,
  dir: string,
  images: Array<VisualAsset & { beatIndex?: number }>,
  clips: NonNullable<EpisodeAssets["clips"]>,
): Promise<void> {
  const franchise = script.game_title;
  const edir = path.join(dir, `entry_${beatIndex}`);
  const rel = (f: string) => path.join(`entry_${beatIndex}`, f);
  const terms = [
    ...new Set(
      [
        entry.steam_search_term,
        `${entry.game_title} Definitive Edition`,
        `${entry.game_title} Remastered`,
        entry.game_title,
      ].filter(Boolean),
    ),
  ];
  let eapp: SteamApp | undefined;
  for (const t of terms) {
    const a = await s.findGame(t).catch(() => undefined);
    if (a && trailerMatchesGame(a.name, entry.game_title, franchise)) {
      eapp = a;
      break;
    }
  }
  const pushClip = (c: VisualAsset) =>
    clips.push({
      file: rel(c.file),
      sourceUrl: c.sourceUrl,
      provenance: c.provenance,
      durationSeconds: Math.min(c.durationSeconds ?? 4, 4.8),
      beatIndex,
      role: undefined,
      motion: c.motion,
      luma: c.luma,
      label: c.label,
      reason: c.reason,
      startSeconds: c.startSeconds,
    });
  try {
    if (eapp) {
      for (const a of (await s.fetchArt(eapp, edir, 12)).filter(
        (a) => a.kind !== "logo",
      ))
        images.push({ ...a, file: rel(a.file), beatIndex });
      if (s.cfg.footage) {
        const targets: FootageTarget[] = chapterFootage(script, beatIndex)
          .slice(0, Math.max(1, s.cfg.docClipsPerChapter))
          .map((f, k) => ({
            key: `beat:${beatIndex}#${k + 1}`,
            text: `${entry.game_title}: ${f.keywords.join(", ")}`,
            want: f.want,
            energy: "medium" as const,
            keywords: [entry.game_title, ...f.keywords].slice(0, 4),
          }));
        if (targets.length)
          for (const c of capFootage(
            await s.fetchClips(
              eapp,
              edir,
              targets,
              targets.length,
              scopeOf(script),
            ),
            footageBudgetSeconds(eapp),
            4.8,
          ))
            pushClip(c);
      }
    } else if (s.cfg.footage) {
      const want = chapterFootage(script, beatIndex)[0];
      const om = await s
        .fetchOfficialMedia(
          entry.game_title,
          edir,
          [
            {
              key: `beat:${beatIndex}`,
              text: entry.game_title,
              want: want?.want ?? "gameplay",
              energy: "medium",
              keywords: want?.keywords ?? [entry.game_title],
            },
          ],
          1,
          entry.year ? String(entry.year) : "",
        )
        .catch(() => ({ clips: [], stills: [] }) as OfficialMedia);
      if (
        om.trailer &&
        trailerMatchesGame(om.trailer.title, entry.game_title, franchise) &&
        (await s.judgeFootage(
          entry.game_title,
          entry.year,
          om.trailer.title,
          scopeOf(script),
        ))
      )
        for (const c of capFootage(om.clips, om.trailer.clipSeconds ?? 0))
          pushClip(c);
      else if (om.trailer)
        log("info", "documentary trailer rejected: it names another game", {
          game: entry.game_title,
          trailer: om.trailer.title,
        });
    }
  } catch (err) {
    log("warn", "documentary chapter media failed", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
  // Licensed gameplay: a few real moments per chapter, matched to its paragraphs, credited.
  try {
    const paragraphs = chapterFootage(script, beatIndex).slice(0, 4);
    const have = clips.filter((c) => c.beatIndex === beatIndex).length;
    if (paragraphs.length && have < 6) {
      const targets: FootageTarget[] = paragraphs.map((f, k) => ({
        key: `beat:${beatIndex}#g${k}`,
        text: `${entry.game_title}: ${f.keywords.join(", ")}`,
        want: f.want,
        energy: "medium",
        keywords: [entry.game_title, ...f.keywords].slice(0, 4),
      }));
      for (const c of await s.gameplayClips(
        entry.game_title,
        franchise,
        entry.year,
        edir,
        targets,
        targets.length,
      ))
        clips.push({
          file: rel(c.file),
          sourceUrl: c.sourceUrl,
          provenance: c.provenance,
          durationSeconds: Math.min(c.durationSeconds ?? 4, 8),
          beatIndex,
          role: undefined,
          motion: c.motion,
          luma: c.luma,
          label: c.label,
          reason: c.reason,
          startSeconds: c.startSeconds,
          credit: c.credit,
          audio: c.audio,
        });
    }
  } catch (err) {
    log("warn", "documentary gameplay failed", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
  // IGDB: official screenshots and key art for games Steam cannot supply, or a thin Steam gallery.
  try {
    const have = images.filter(
      (i) => i.beatIndex === beatIndex && i.kind !== "capsule",
    ).length;
    if (have < 8)
      for (const a of await s.igdbArt(
        entry.game_title,
        entry.year,
        edir,
        12 - have,
      ))
        if (
          a.kind !== "capsule" ||
          !images.some((i) => i.beatIndex === beatIndex && i.kind === "capsule")
        )
          images.push({ ...a, file: rel(a.file), beatIndex });
  } catch (err) {
    log("warn", "documentary IGDB art failed", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
  // Archive photos: the real places and people, freely licensed and credited on screen.
  try {
    const queries = (
      entry.photos?.length ? entry.photos : [`${entry.game_title} video game`]
    ).slice(0, 4);
    const seen = new Set<string>();
    const candidates = (
      await Promise.all(queries.map((q) => s.searchPhotos(q).catch(() => [])))
    )
      .flat()
      .filter((c) => !seen.has(c.title) && seen.add(c.title))
      .slice(0, 30);
    const opening =
      script.beats.filter((b) => b.visual?.kind === "chapter")[beatIndex]
        ?.narration ?? "";
    const keep = await pickPhotos(
      s.llm,
      {
        franchise,
        game: entry.game_title,
        title:
          script.beats.filter((b) => b.visual?.kind === "chapter")[beatIndex]
            ?.visual.primary ?? entry.game_title,
        opening,
      },
      candidates,
    );
    for (const [k, i] of keep.entries()) {
      const img = candidates[i]!;
      const file = rel(path.join("assets", `photo_${k}.jpg`));
      if (await s.downloadPhoto(img, path.join(dir, file)))
        images.push({
          kind: "photo",
          file,
          sourceUrl: img.pageUrl,
          provenance: `Wikimedia Commons photo by ${img.artist}, ${img.license}: ${img.pageUrl}`,
          beatIndex,
        } as VisualAsset & { beatIndex?: number });
    }
  } catch (err) {
    log("warn", "documentary photos failed", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
  // Real-world B-roll: licensed stock for the sentences the shot list marks (the studio, money, a leak),
  // played on its own sentence and labelled illustrative on screen.
  try {
    const targets: FootageTarget[] = (entry.moments ?? [])
      .map((m, k) => ({ m, k }))
      .filter((x) => x.m.broll?.trim())
      .slice(0, DOC_BROLL_PER_CHAPTER)
      .map(({ m, k }) => ({
        key: `beat:${beatIndex}#m${k}`,
        text: m.broll!,
        want: "cinematic" as const,
        energy: "medium" as const,
        keywords: [m.broll!],
      }));
    if (targets.length)
      for (const c of await s.fetchStock(
        edir,
        targets,
        franchise.split(/\s+/),
        targets.length,
      ))
        clips.push({
          file: rel(c.file),
          sourceUrl: c.sourceUrl,
          provenance: c.provenance,
          durationSeconds: c.durationSeconds ?? 4,
          beatIndex,
          role: undefined,
          motion: 0.5,
          luma: undefined,
          label: c.label,
          reason: c.reason,
          startSeconds: 0,
          stock: true,
          moment: c.moment,
          credit: "ILLUSTRATIVE · STOCK FOOTAGE: PEXELS",
        });
  } catch (err) {
    log("warn", "documentary B-roll failed", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
}

/** Licensed stock shots a documentary chapter may use for its real-world sentences. */
const DOC_BROLL_PER_CHAPTER = 5;

/**
 * The Steam page for a ranking entry, only when it is that release: Steam's
 * search hands "Call of Duty 4: Modern Warfare" (2007) the 2019 reboot, and
 * "Resident Evil 4" the remake. A page more than a year off the entry's year
 * is refused, and the entry's pictures come from IGDB by exact title instead.
 */
export async function steamAppForEntry(
  s: Pick<Services, "findGame">,
  entry: { steam_search_term: string; year?: number; game_title: string },
): Promise<SteamApp | undefined> {
  if (!entry.steam_search_term) return undefined;
  const app = await s.findGame(entry.steam_search_term);
  if (!app || !entry.year) return app;
  const appYear =
    Number(
      String(app.details?.release_date?.date ?? "").match(
        /\b(19|20)\d\d\b/,
      )?.[0],
    ) || undefined;
  if (appYear && Math.abs(appYear - entry.year) > 1) {
    log("info", "steam page refused: another release of the game", {
      entry: entry.game_title,
      year: entry.year,
      store: app.name,
      storeYear: appYear,
    });
    return undefined;
  }
  return app;
}

export function segmentInputs(script: Script, desk = false): SegmentInput[] {
  return [
    // The same speakable text the voice was given, so segment timings line up word for word.
    { kind: "hook", text: speakable(script.hook) },
    ...script.beats.map((b) => ({
      kind: "beat" as const,
      text: speakable(b.narration),
      visual: b.visual,
    })),
    // The desk partner's question sits between the facts and the take when the Short has one.
    ...(desk && script.desk_question
      ? [{ kind: "desk" as const, text: speakable(script.desk_question) }]
      : []),
    {
      kind: "take",
      text: speakable(script.pulse_take.narration),
      label: script.pulse_take.label,
      visual: {
        kind: "title" as const,
        primary: script.pulse_take.on_screen,
        secondary: "",
      },
    },
    // The same tidied last line the voice was given, so timings line up.
    { kind: "loop", text: speakable(tidyLoopLine(script.loop_line)) },
  ];
}

/** Words the captions keep lit after they are spoken: the game title and the on-screen card text. */
export function emphasisWords(script: Script): string[] {
  const out = new Set<string>();
  const add = (t: string) => {
    for (const w of t.toLowerCase().split(/[^a-z0-9£$%']+/))
      if (w.length > 2) out.add(w);
  };
  add(script.game_title);
  for (const b of script.beats)
    if (b.visual && b.visual.kind !== "none") add(b.visual.primary);
  return [...out];
}

/** One live number for the end of the take, if Steam has a good one. */
export function steamStat(
  f?: SteamFacts,
): { value: string; label: string } | null {
  if (!f) return null;
  if (f.currentPlayers && f.currentPlayers >= 1000)
    return {
      value: f.currentPlayers.toLocaleString("en-US"),
      label: "playing on Steam right now",
    };
  if (f.positivePercent !== undefined && (f.totalReviews ?? 0) >= 500)
    return {
      value: `${f.positivePercent}%`,
      label: `positive Steam reviews (${f.reviewSummary})`,
    };
  return null;
}

function variantOf(id: string): number {
  return [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % 4;
}

/** Pictures a Short needs before it is worth making: two distinct real images or clips. */
export const MEDIA_FLOOR = 2;

/**
 * A Short with nothing real to show (only the brand plate) is not published:
 * the story is dropped, its slot freed for the next story, and Discord told.
 */
async function belowMediaFloor(
  s: Services,
  ep: Episode,
  assets: EpisodeAssets,
): Promise<boolean> {
  const count = (assets.images?.length ?? 0) + (assets.clips?.length ?? 0);
  // A picture story needs pictures of the story: the publisher's video of it, or illustrative stock for its lines.
  const pictureStory = ep.story_json.visualNeed === "real_world_images";
  const storyPictures =
    (assets.clips ?? []).filter((c) => c.stock).length +
    (assets.officialTrailer &&
    pictureStory &&
    (assets.clips ?? []).some(
      (c) => !c.stock && /YouTube channel/.test(c.provenance),
    )
      ? 2
      : 0);
  if (count >= MEDIA_FLOOR && (!pictureStory || storyPictures >= 2))
    return false;
  const headline = ep.story_json.headline;
  await markSeen(
    s.db,
    ep.story_hash,
    headline,
    "rejected",
    `only ${count} pictures to show`,
  );
  await transition(s.db, ep.id, "voiced", "rejected", {
    last_error: pictureStory
      ? `picture story with nothing safe to show: no publisher video of it and ${storyPictures} stock clips`
      : `nothing worth showing: ${count} official images or clips (need ${MEDIA_FLOOR})`,
  });
  await logEvent(s.db, ep.id, "media_floor", { count, floor: MEDIA_FLOOR });
  log("warn", "story dropped: not enough pictures", {
    episode: ep.id,
    headline,
    count,
  });
  await s.notify({
    level: "info",
    embeds: [
      {
        title: `🛑 Dropped: ${headline}`,
        description: `Only ${count} official image or clip to show, so it would have run on a blank background. The slot goes to the next story.`,
        color: COLOURS.warn,
      },
    ],
  });
  return true;
}

/** The long-form 16:9 render: its own plan, composition, QA band and thumbnail. */
async function stepRenderLong(s: Services, ep: Episode): Promise<void> {
  const dir = episodeDir(s.cfg, ep.id);
  const script = ep.script_json!;
  const assets = { ...(ep.assets_json ?? {}) };
  if (!assets.images) {
    Object.assign(assets, await gatherMedia(s, ep, dir));
    await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(assets),
    ]);
  }
  const duration = (assets.durationSeconds ?? 300) + LONG_TAIL_SECONDS;
  const words = assets.words ?? [];
  // A documentary's breathers open each chapter (assets.breaks, put in when it was voiced).
  const segments = openChaptersAtBreaks(
    buildSegments(segmentInputs(script, Boolean(assets.desk)), words, duration),
    assets.breaks,
  );
  const variant = variantOf(ep.id);
  const musicFile = s.cfg.musicBed ? bedFor(variant) : null;
  // 2.5D: the wide stills get depth layers on this machine's GPU, once per video (kept in assets).
  if (s.cfg.parallax && s.cfg.whisperPython && assets.images?.length) {
    const want = assets.images.filter(
      (i) => !i.layers && LAYERED_KINDS.has(i.kind) && i.aspect >= 1.2,
    );
    if (want.length) {
      const made = await makeParallax(
        s.cfg.whisperPython,
        dir,
        want.map((i) => i.file),
      );
      for (const i of assets.images) {
        const l = made.get(i.file.split(path.sep).join("/"));
        if (l) i.layers = l;
      }
      if (made.size)
        await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
          ep.id,
          JSON.stringify(assets),
        ]);
    }
  }
  const images = (assets.images ?? []).map((i) => ({
    file: i.file,
    kind: i.kind,
    aspect: i.aspect,
    beatIndex: i.beatIndex,
    credit: photoCredit(i),
    moment: i.moment,
    label: i.label,
    layers: i.layers,
  }));
  // The shot list per entry, in on-screen order (lowest rank first), for sentence-level pictures and graphics.
  const moments = [...(script.entries ?? [])]
    .sort((a, b) => b.rank - a.rank)
    .map((e) => e.moments ?? []);
  const hasMoments = moments.some((m) => m.length);
  const clips = (assets.clips ?? []).map((c) => ({
    file: c.file,
    durationSeconds: c.durationSeconds,
    beatIndex: c.beatIndex,
    role: c.role,
    moment: c.moment,
    credit: c.credit,
    audio: c.audio,
  }));
  const makePlan = () =>
    buildLongPlan({
      segments,
      words,
      durationSeconds: duration,
      images: images.map((i) => ({
        kind: i.kind,
        aspect: i.aspect,
        beatIndex: i.beatIndex,
        moment: i.moment,
      })),
      clips: clips.map((c) => ({
        durationSeconds: c.durationSeconds,
        beatIndex: c.beatIndex,
        role: c.role,
        moment: c.moment,
      })),
      variant,
      momentCounts: hasMoments ? moments.map((m) => m.length) : undefined,
      momentKeys: hasMoments
        ? moments.map((e) => e.map(momentKeys))
        : undefined,
      takeEntry: script.take_entry,
    });
  let plan = assets.longPlan ?? makePlan();
  if (!assets.longPlan) {
    // An entry left on the plate or looping its few clips gets official screenshots from IGDB, then a new plan.
    const ranked = [...(script.entries ?? [])].sort((a, b) => b.rank - a.rank);
    const gaps = planGaps(plan, segments, script.take_entry);
    let added = 0;
    for (const g of gaps) {
      const entry = ranked[g.entry];
      if (!entry) continue;
      const more = await s
        .igdbArt(
          entry.game_title,
          entry.year,
          path.join(dir, `entry_${g.entry}`, "more"),
          8,
        )
        .catch(() => [] as VisualAsset[]);
      for (const a of more.filter((x) => x.kind !== "capsule")) {
        const file = path.join(`entry_${g.entry}`, "more", a.file);
        if ((assets.images ?? []).some((i) => i.file === file)) continue;
        const aspect = await s
          .imageAspect(path.join(dir, file))
          .catch(() => 16 / 9);
        const img = { ...a, file, aspect, beatIndex: g.entry };
        (assets.images ??= []).push(img);
        images.push({
          file,
          kind: a.kind,
          aspect,
          beatIndex: g.entry,
          credit: photoCredit(img),
          moment: undefined,
          label: undefined,
          layers: undefined,
        });
        added++;
      }
    }
    if (added) plan = makePlan();
    const left = planGaps(plan, segments, script.take_entry);
    if (gaps.length)
      log(left.length ? "warn" : "info", "thin entries topped up", {
        episode: ep.id,
        before: gaps,
        added,
        after: left,
      });
    if (left.length)
      await s.notify({
        content: `🖼️ "${script.headline}" is short of pictures for ${left.map((g) => ranked[g.entry]?.game_title ?? `entry ${g.entry}`).join(", ")} (${left.map((g) => (g.plateSeconds > 15 ? `${g.plateSeconds}s on the plain background` : `a shot shown ${g.maxRepeat} times`)).join("; ")}). It renders anyway.`,
      });
  }
  assets.longPlan = plan;
  // Zoom to the detail: a sentence that names something on screen gets the camera pushed in on it, with a
  // label, when the local vision model finds it in that picture. At most one every 40 s, 30 a video.
  if (s.cfg.annotate && hasMoments && !assets.annotations) {
    const ws = momentWindows(
      segments,
      words,
      moments.map((m) => m.length),
      moments.map((e) => e.map(momentKeys)),
    );
    const ranked = [...(script.entries ?? [])].sort((a, b) => b.rank - a.rank);
    const found: NonNullable<EpisodeAssets["annotations"]> = [];
    let lastAt = -Infinity;
    for (const w of ws) {
      if (found.length >= 30) break;
      const m = moments[w.entry]?.[w.moment];
      if (!m || m.graphic.kind !== "none" || w.moment === 0) continue;
      const from = Math.round(Math.max(w.start, w.at - 0.15) * LONG_FPS);
      if (from - lastAt < 40 * LONG_FPS) continue;
      const shot = plan.shots.find((x) => from >= x.start && from < x.end);
      if (!shot || shot.media.type !== "image" || shot.end - from < 3.5 * LONG_FPS) continue;
      const img = assets.images?.[shot.media.index];
      if (!img || !LAYERED_KINDS.has(img.kind)) continue;
      const label = annotationLabel(m, ranked[w.entry]?.game_title ?? script.game_title);
      if (!label) continue;
      const box = await locate(path.join(dir, img.file), label);
      if (!box) continue;
      found.push({ entry: w.entry, moment: w.moment, image: shot.media.index, box, label });
      lastAt = from;
    }
    assets.annotations = found;
    await unloadLocalVision();
    log("info", "detail annotations", { episode: ep.id, count: found.length });
  }
  await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
    ep.id,
    JSON.stringify(assets),
  ]);
  const doc = script.evergreen_format === "documentary";
  const footageCredit = clips.length
    ? "FOOTAGE: OFFICIAL TRAILERS · STEAM"
    : "";
  // The thumbnail: the winner's widest art, else the topic's.
  const winnerBeat = (script.entries?.length ?? 0) - 1;
  const thumbArt =
    images.find((i) => i.beatIndex === winnerBeat && i.kind === "hero") ??
    images.find((i) => i.beatIndex === winnerBeat && i.aspect >= 1.2) ??
    images.find((i) => i.beatIndex === undefined && i.aspect >= 1.2) ??
    images[0];
  // Two more designs for YouTube's Test & compare, on the same key art so the test measures the
  // design: full-bleed art and, for a ranking, last place against the winner.
  const wide = (b: number) =>
    images.find((i) => i.beatIndex === b && i.kind === "hero") ??
    images.find((i) => i.beatIndex === b && i.aspect >= 1.2);
  const lastArt = !doc && winnerBeat > 0 ? wide(0) : undefined;
  // The second design: the subject cut out in front of the headline when the art has depth layers (the
  // big creators' trick), else the full-bleed art. The third: last place against the winner for a ranking,
  // the headline as a newspaper cutting for a documentary.
  const depthArt =
    (thumbArt?.layers ? thumbArt : undefined) ??
    images.find((i) => i.layers && i.kind === "hero" && (i.beatIndex === winnerBeat || i.beatIndex === undefined));
  const thumbVariants = [
    {
      file: path.join(dir, "thumb_b.jpg"),
      thumb: depthArt?.layers
        ? {
            headline: thumbTitle(script),
            kicker: doc ? "DOCUMENTARY" : "RANKED",
            game: "",
            accent: "#FF6B1A",
            imageFile: depthArt.file,
            fgFile: depthArt.layers.fg,
            subjectX: depthArt.layers.fgx,
            layout: "depth" as const,
          }
        : {
            headline: thumbTitle(script),
            kicker: doc ? "DOCUMENTARY" : "RANKED",
            game: "",
            accent: "#FF6B1A",
            imageFile: thumbArt?.file ?? null,
            layout: "full" as const,
          },
    },
    ...(doc && thumbArt
      ? [
          {
            file: path.join(dir, "thumb_c.jpg"),
            thumb: {
              headline: thumbTitle(script),
              kicker: "",
              game: script.recap ? "This week" : script.game_title,
              accent: "#FF6B1A",
              imageFile: thumbArt.file,
              layout: "clipping" as const,
            },
          },
        ]
      : []),
    ...(lastArt && thumbArt
      ? [
          {
            file: path.join(dir, "thumb_c.jpg"),
            thumb: {
              headline: thumbTitle(script),
              kicker: "",
              game: "",
              accent: "#FF6B1A",
              imageFile: lastArt.file,
              image2File: thumbArt.file,
              layout: "versus" as const,
              labels: [`#${script.entries![0]!.rank}`, "#1"] as [
                string,
                string,
              ],
            },
          },
        ]
      : []),
  ];
  const raw = path.join(dir, "render_raw.mp4");
  const final = path.join(dir, "short.mp4");
  await s.renderLong({
    episodeDir: dir,
    outFile: raw,
    posterFile: path.join(dir, "poster.jpg"),
    thumbFile: path.join(dir, "thumb.jpg"),
    thumb: {
      headline: thumbTitle(script),
      kicker: script.recap ? "THIS WEEK" : doc ? "DOCUMENTARY" : "RANKED",
      game: doc
        ? (script.kicker ?? script.game_title).slice(0, 48)
        : script.criterion
          ? thumbCriterion(script.criterion)
          : script.game_title,
      accent: "#FF6B1A",
      imageFile: thumbArt?.file ?? null,
    },
    thumbVariants,
    concurrency: s.cfg.remotionConcurrency,
    gl: s.cfg.remotionGl,
    browserExecutable: s.cfg.browserExecutable,
    props: {
      title: script.headline,
      kicker: script.kicker ?? "",
      criterion: script.criterion ?? "",
      spoilers: scopeOf(script) === "campaign",
      recap: !!script.recap,
      theme: script.recap ? script.headline : script.game_title,
      footageCredit,
      endLine: script.recap
        ? "The week's biggest stories every Friday · Shorts every day"
        : doc
          ? "A new documentary every month · Shorts every day"
          : "A new ranking every week · Shorts every day",
      moments: hasMoments
        ? moments.map((ms) =>
            ms.map((m) => ({
              show: m.show,
              graphic: m.graphic,
              emphasis: m.emphasis,
              person: m.person || undefined,
            })),
          )
        : undefined,
      segments,
      words,
      durationSeconds: duration,
      variant,
      audioFile: assets.audio ?? null,
      musicFile,
      imageFiles: images,
      clipFiles: clips,
      plan,
      renderDate: s.now().toISOString().slice(0, 10),
      breaks: assets.breaks,
      annotations: assets.annotations,
    },
  });
  await s.normalise(raw, final);
  await fs.rm(raw, { force: true });
  const tech = await s.technicalQa(final, duration, {
    minSeconds: 180,
    // The breathers are on top of the narration cap.
    maxSeconds:
      (doc ? s.cfg.docMaxSeconds : s.cfg.longformMaxSeconds) +
      60 +
      (assets.breaks ?? []).reduce((n, b) => n + b.end - b.start, 0),
    width: 1920,
    height: 1080,
  });
  let vision: VisionQa | undefined;
  let times: number[] = [];
  if (tech.ok && s.cfg.visionQa) {
    const marks = segments
      .map((g) => g.start + 2)
      .filter((t) => t > 1 && t < duration - 2);
    const step = Math.max(1, Math.ceil(marks.length / 6));
    times = [
      1.5,
      ...marks.filter((_, i) => i % step === 0),
      duration - 2,
    ].slice(0, 8);
    await fs.rm(path.join(dir, "qa"), { recursive: true, force: true });
    const frames = await s.extractFrames(final, path.join(dir, "qa"), times);
    vision = await s.visionQa(frames, {
      headline: script.headline,
      gameTitle: script.game_title,
      format: "long",
    });
  }
  const qa = {
    technical: tech,
    vision: vision ?? null,
    rubric: null,
    checked_at: s.now().toISOString(),
  };
  const visionProblems =
    vision?.verdict === "fail"
      ? vision.problems.length
        ? vision.problems
        : [`vision QA failed: ${vision.notes || "no reason given"}`]
      : [];
  const problems = [...tech.problems, ...visionProblems];
  if (problems.length > 0) {
    const { longPlan: _dropped, ...withoutPlan } = assets;
    const dropped = dropOffending(
      withoutPlan,
      offendingMedia(visionProblems, times, plan),
    );
    if (dropped.clips || dropped.images) {
      log("warn", "faulted media dropped for the retry", {
        episode: ep.id,
        ...dropped,
      });
      await logEvent(s.db, ep.id, "media_dropped", dropped);
    }
    await s.db.query(
      `UPDATE episodes SET qa_json = $2, assets_json = $3 WHERE id = $1`,
      [ep.id, JSON.stringify(qa), JSON.stringify(withoutPlan)],
    );
    throw new Error(`QA failed: ${problems.join(" | ")}`);
  }
  await transition(s.db, ep.id, "voiced", "rendered", {
    assets_json: {
      ...assets,
      video: "short.mp4",
      poster: "poster.jpg",
      thumb: "thumb.jpg",
      thumbVariants: thumbVariants.map((v) => path.basename(v.file)),
      musicFile,
      // When each entry begins (seconds), so its retention can be read off the curve later.
      entryStarts: segments
        .filter(
          (g, i) =>
            g.kind === "beat" &&
            (g.visual?.kind === "rank" || g.visual?.kind === "chapter") &&
            i > 0,
        )
        .map((g) => Math.round(g.start * 10) / 10),
    },
    qa_json: qa,
  });
}

async function stepRender(s: Services, ep: Episode): Promise<void> {
  if (ep.lane === "longform") return stepRenderLong(s, ep);
  if (ep.lane === "cutdown" || ep.lane === "gameplay")
    return stepRenderCutdown(s, ep);
  const dir = episodeDir(s.cfg, ep.id);
  const script = ep.script_json!;
  const assets = { ...(ep.assets_json ?? {}) };
  if (!assets.images) {
    Object.assign(assets, await gatherMedia(s, ep, dir));
    await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(assets),
    ]);
  }
  if (await belowMediaFloor(s, ep, assets)) return;
  const duration = (assets.durationSeconds ?? 30) + TAIL_SECONDS;
  const words = assets.words ?? [];
  const segments = buildSegments(
    segmentInputs(script, Boolean(assets.desk)),
    words,
    duration,
  );
  const variant = variantOf(ep.id);
  const musicFile = s.cfg.musicBed ? bedFor(variant) : null;
  // Blurred plates sit behind framed footage; made once per asset, idempotent on retry.
  for (const img of assets.images ?? [])
    if (!img.blurFile)
      img.blurFile = await blurPlate(dir, img.file).catch(() => undefined);
  for (const clip of assets.clips ?? [])
    if (!clip.blurFile)
      clip.blurFile = await blurPlate(dir, clip.file).catch(() => undefined);
  const steamLite = assets.steam?.facts
    ? {
        currentPlayers: assets.steam.facts.currentPlayers,
        positivePercent: assets.steam.facts.positivePercent,
        totalReviews: assets.steam.facts.totalReviews,
        price: assets.steam.facts.price,
        prices: assets.steam.facts.prices,
        releaseDate: assets.steam.facts.releaseDate,
        metacritic: assets.steam.facts.metacritic,
      }
    : null;
  // Plan then render: the plan is persisted so a retry renders the identical Short.
  // A red rubric rebuilds the plan once with another variant, then fails the episode.
  const planInput = {
    segments,
    words,
    durationSeconds: duration,
    images: (assets.images ?? []).map((i) => ({
      kind: i.kind,
      aspect: i.aspect,
      beatIndex: i.beatIndex,
      wordy: i.wordy,
    })),
    clips: (assets.clips ?? []).map((c) => ({
      durationSeconds: c.durationSeconds,
      motion: c.motion,
      luma: c.luma,
      beatIndex: c.beatIndex,
      role: c.role,
    })),
    storyType: script.is_rumour ? "rumour" : script.story_type,
    isRumour: script.is_rumour,
    attribution: script.attribution,
    variant,
    steam: steamLite,
    openOnClip: s.cfg.openOnMotion,
  };
  const footageSeconds = (assets.clips ?? []).reduce(
    (n, c) => n + c.durationSeconds,
    0,
  );
  const footageBudget = Math.max(20, footageSeconds); // clips were already trimmed to the publisher budget in gatherMedia
  const rubricFor = (plan: ReturnType<typeof buildPlan>) =>
    scorePlan({
      plan,
      segments,
      words,
      footageSeconds,
      footageBudgetSeconds: footageBudget,
      hookWords: script.hook.split(/\s+/).filter(Boolean).length,
    });
  let plan = assets.plan ?? buildPlan(planInput);
  let rubric = rubricFor(plan);
  if (rubric.grade === "red" && !assets.plan) {
    log("warn", "plan rejected by rubric, rebuilding", {
      episode: ep.id,
      problems: rubricSummary(rubric),
    });
    plan = buildPlan({ ...planInput, variant: (variant + 1) % 4 });
    rubric = rubricFor(plan);
    const mediaRed = rubric.metrics.some(
      (m) =>
        m.grade === "red" &&
        /^(unique_media_ratio|max_media_repeat|adjacent_repeats)$/.test(m.name),
    );
    if (rubric.grade === "red" && mediaRed && !assets.rich) {
      // Too little media to vary with: fetch more (screenshots, another clip) and plan again.
      log("info", "red media rubric: gathering more media", { episode: ep.id });
      Object.assign(assets, await gatherMedia(s, ep, dir, true), {
        rich: true,
      });
      for (const img of assets.images ?? [])
        if (!img.blurFile)
          img.blurFile = await blurPlate(dir, img.file).catch(() => undefined);
      for (const clip of assets.clips ?? [])
        if (!clip.blurFile)
          clip.blurFile = await blurPlate(dir, clip.file).catch(
            () => undefined,
          );
      const richInput = {
        ...planInput,
        images: (assets.images ?? []).map((i) => ({
          kind: i.kind,
          aspect: i.aspect,
          beatIndex: i.beatIndex,
          wordy: i.wordy,
        })),
        clips: (assets.clips ?? []).map((c) => ({
          durationSeconds: c.durationSeconds,
          motion: c.motion,
          luma: c.luma,
          beatIndex: c.beatIndex,
          role: c.role,
        })),
      };
      const tries = [0, 1, 2, 3].map((k) =>
        buildPlan({ ...richInput, variant: (variant + k) % 4 }),
      );
      const order = { green: 0, amber: 1, red: 2 } as const;
      const best = tries
        .map((p) => ({ p, r: rubricFor(p) }))
        .sort((a, b) => order[a.r.grade] - order[b.r.grade])[0]!;
      plan = best.p;
      rubric = best.r;
      await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
        ep.id,
        JSON.stringify(assets),
      ]);
    }
    if (rubric.grade === "red") {
      // A slot is worth more than a perfect plan: render anyway and say so.
      log("warn", "rubric still red after rebuild; rendering anyway", {
        episode: ep.id,
        problems: rubricSummary(rubric),
      });
      await s.notify({
        level: "info",
        content: `Quality note: "${script.headline}" renders with a red rubric (${rubricSummary(rubric)}). Worth a look.`,
      });
    }
  }
  await logEvent(s.db, ep.id, "rubric", {
    grade: rubric.grade,
    summary: rubricSummary(rubric) || "all green",
  });
  // The stamp lands with the channel's landing sound, peak on the word, when the mix has room for it.
  for (const st of stampsFor(script, words)) {
    const name = SFX.land[0];
    const f = Math.max(
      0,
      Math.round(st.at * plan.fps) - leadFrames(name, plan.fps),
    );
    if (
      plan.sfx.length < MAX_SFX &&
      plan.sfx.every((c) => Math.abs(c.frame - f) >= 60)
    )
      plan.sfx.push({ file: sfxFile(name), frame: f, volume: LEVEL.land });
  }
  assets.plan = plan;
  assets.suite = suiteFor(s.cfg, ep);
  await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
    ep.id,
    JSON.stringify(assets),
  ]);
  const publisher = String(
    (assets.steam
      ? (await s.findGame(assets.steam.name).catch(() => undefined))?.details
          ?.publishers?.[0]
      : assets.officialTrailer?.publisher) ?? "",
  );
  // A person's licensed photo is credited on screen, as its licence asks.
  const photoLine = [
    ...new Set((assets.images ?? []).map(photoCredit).filter(Boolean)),
  ].join(" · ");
  const footageCredit = [
    (assets.clips ?? []).length
      ? `Footage: ${publisher || script.game_title} · official trailer`
      : "",
    photoLine ? `Photo: ${photoLine}` : "",
  ]
    .filter(Boolean)
    .join("   ");
  const year = assets.steam?.facts?.releaseDate?.match(/\b(19|20)\d\d\b/)?.[0];
  const gameSubtitle = [publisher, year].filter(Boolean).join(" · ");

  const raw = path.join(dir, "render_raw.mp4");
  const final = path.join(dir, "short.mp4");
  await s.render({
    episodeDir: dir,
    outFile: raw,
    posterFile: path.join(dir, "poster.jpg"),
    concurrency: s.cfg.remotionConcurrency,
    gl: s.cfg.remotionGl,
    browserExecutable: s.cfg.browserExecutable,
    props: {
      headline: script.headline,
      storyType: script.is_rumour ? "rumour" : script.story_type,
      gameTitle: script.game_title,
      isRumour: script.is_rumour,
      attribution: script.attribution,
      gameSubtitle,
      footageCredit,
      segments,
      words,
      durationSeconds: duration,
      variant,
      audioFile: assets.audio ?? null,
      musicFile,
      imageFiles: (assets.images ?? []).map((i) => ({
        file: i.file,
        kind: i.kind,
        aspect: i.aspect,
        blurFile: i.blurFile,
        beatIndex: i.beatIndex,
      })),
      clipFiles: (assets.clips ?? []).map((c) => ({
        file: c.file,
        durationSeconds: c.durationSeconds,
        blurFile: c.blurFile,
        beatIndex: c.beatIndex,
        role: c.role,
        motion: c.motion,
        luma: c.luma,
        stock: c.stock,
      })),
      steam: steamLite,
      emphasis: emphasisWords(script),
      deskName: assets.desk?.voice.name,
      stamps: stampsFor(script, words),
      plan,
      suite: assets.suite,
      renderDate: s.now().toISOString().slice(0, 10),
    },
  });
  await s.normalise(raw, final);
  await fs.rm(raw, { force: true });

  const tech = await s.technicalQa(
    final,
    duration,
    ep.lane === "evergreen"
      ? { minSeconds: EVERGREEN_MIN_SECONDS, maxSeconds: 179 }
      : undefined,
  );
  let vision: VisionQa | undefined;
  let times: number[] = [];
  if (tech.ok && s.cfg.visionQa) {
    // Sampled after each card's counters have landed (24 frames) so a mid-count figure is never judged.
    times = [0.8, ...segments.slice(1).map((g) => g.start + 1.2), duration - 1]
      .filter((t) => t < duration)
      .slice(0, 8);
    await fs.rm(path.join(dir, "qa"), { recursive: true, force: true });
    const frames = await s.extractFrames(
      final,
      path.join(dir, "qa"),
      times.slice(0, 8),
    );
    vision = await s.visionQa(frames, {
      headline: script.headline,
      gameTitle: script.game_title,
    });
  }
  const qa = {
    technical: tech,
    vision: vision ?? null,
    rubric,
    checked_at: s.now().toISOString(),
  };
  const visionProblems =
    vision?.verdict === "fail"
      ? vision.problems.length
        ? vision.problems
        : [`vision QA failed: ${vision.notes || "no reason given"}`]
      : [];
  const problems = [...tech.problems, ...visionProblems];
  if (problems.length > 0) {
    // The retry re-plans from scratch (the planner or the components may have changed since) and judges fresh frames.
    const { plan: _dropped, ...withoutPlan } = assets;
    // A moment the checker faulted for text, a logo or the wrong game is not tried again.
    const dropped = dropOffending(
      withoutPlan,
      offendingMedia(visionProblems, times, plan),
    );
    if (dropped.clips || dropped.images) {
      log("warn", "faulted media dropped for the retry", {
        episode: ep.id,
        ...dropped,
      });
      await logEvent(s.db, ep.id, "media_dropped", dropped);
    }
    await s.db.query(
      `UPDATE episodes SET qa_json = $2, assets_json = $3 WHERE id = $1`,
      [ep.id, JSON.stringify(qa), JSON.stringify(withoutPlan)],
    );
    throw new Error(`QA failed: ${problems.join(" | ")}`);
  }
  await transition(s.db, ep.id, "voiced", "rendered", {
    assets_json: {
      ...assets,
      video: "short.mp4",
      poster: "poster.jpg",
      musicFile,
    },
    qa_json: qa,
  });
}

async function stepRequestApproval(s: Services, ep: Episode): Promise<void> {
  const script = ep.script_json!;
  const links = approvalLinks(s.cfg, ep.id);
  // A single-source story always waits for a human. A rumour that two outlets (or an official source)
  // carry is reported as a labelled report ("reportedly" throughout, the title says so) under the lane's
  // usual mode: from 25 Oct 2026 the channel covers leaks and reports, clearly marked.
  const risky = !ep.story_json.corroborated;
  // The owner taps every gameplay Short: their own recordings never publish on a timer.
  // A twin repeats a Short the owner already approved: it goes out on its own.
  const mode =
    ep.lane === "twin"
      ? "auto"
      : risky || ep.lane === "gameplay"
        ? "manual"
        : ep.lane === "evergreen"
          ? s.cfg.evergreenApprovalMode
          : ep.lane === "longform"
            ? s.cfg.longformApprovalMode
            : s.cfg.approvalMode;
  const when =
    mode === "auto"
      ? "Auto mode: publishing now."
      : mode === "timeout"
        ? `Publishes automatically in ${ep.lane === "news_breaking" ? s.cfg.breakingApprovalMinutes : s.cfg.approvalTimeoutMinutes} min unless rejected.`
        : "Waiting for your approval.";
  const dir = episodeDir(s.cfg, ep.id);
  // Auto mode needs nothing from the owner: a short "going out" note with a Watch link, no buttons.
  const g = script.gameplay;
  const description = g
    ? [
        `**Question:** ${g.question}`,
        `**Result:** ${g.result}`,
        `**Game:** ${script.game_title}${g.experiment_number ? `  ·  test #${g.experiment_number} on the list` : "  ·  a fresh test"}`,
        `**Why it was picked:** ${ep.story_json.gameplay?.review.reason ?? "n/a"} (score ${ep.story_json.gameplay?.review.score ?? "?"}/10)`,
        g.radio
          ? "⚠️ **Radio or licensed music may be audible.** That can trigger a Content ID claim; reject if you would rather not risk it."
          : "No licensed music heard.",
        "",
        `▶️ [Watch preview](${links.preview})  ·  ✅ [Approve](${links.approve})  ·  ❌ [Reject](${links.reject})`,
        when,
      ]
    : mode === "auto"
      ? [
          `**Hook:** ${script.hook}`,
          `Fact-checked against ${ep.story_json.sources.length} source${ep.story_json.sources.length === 1 ? "" : "s"}. Going out automatically, nothing for you to do.`,
          `▶️ [Watch](${links.preview})`,
        ]
      : [
          `**Hook:** ${script.hook}`,
          `**Pulse take:** ${script.pulse_take.narration}`,
          `**Sources:** ${ep.story_json.sources.join(", ")}${ep.story_json.hasOfficial ? " (official)" : ""}`,
          `**Fact-check:** ${ep.factcheck_json?.summary ?? "n/a"}`,
          "",
          `▶️ [Watch preview](${links.preview})  ·  ✅ [Approve](${links.approve})  ·  ❌ [Reject](${links.reject})`,
          when,
        ];
  const delivered = await s.notify({
    embeds: [
      {
        title: `🎬 ${script.youtube.title}`,
        url: links.preview,
        description: description.join("\n"),
        color: script.is_rumour ? COLOURS.alert : COLOURS.brand,
        image: { url: "attachment://poster.jpg" },
      },
    ],
    files: [path.join(dir, "poster.jpg")],
  });
  // Never start a publish countdown nobody was told about.
  if (delivered === false && mode === "timeout")
    throw new Error(
      "approval notice could not be posted to Discord; retrying before any auto-publish",
    );
  if (mode === "auto") {
    await transition(s.db, ep.id, "rendered", "approved", {
      approval_mode: mode,
      approved_by: "auto",
      approval_requested_at: s.now(),
    });
  } else {
    await transition(s.db, ep.id, "rendered", "awaiting_approval", {
      approval_mode: mode,
      approval_requested_at: s.now(),
    });
    if (ep.lane === "gameplay")
      await gameplayStatus(s.cfg, ep, "awaiting_approval");
  }
}

const MANUAL_APPROVAL_EXPIRY_HOURS = 48; // the Discord links last 3 days

async function stepAwaitApproval(s: Services, ep: Episode): Promise<void> {
  if (!ep.approval_requested_at) return;
  const waited =
    s.now().getTime() - new Date(ep.approval_requested_at).getTime();
  if (ep.approval_mode === "manual") {
    // An unanswered episode must not block tomorrow's Short forever.
    if (
      waited >= MANUAL_APPROVAL_EXPIRY_HOURS * 3600_000 &&
      (await transition(s.db, ep.id, "awaiting_approval", "rejected", {
        last_error: "approval expired unanswered",
      }))
    ) {
      await logEvent(s.db, ep.id, "rejected", { by: "expiry" });
      await s.notify({
        level: "info",
        content: `⌛ "${ep.script_json?.youtube.title ?? ep.story_json.headline}" expired after ${MANUAL_APPROVAL_EXPIRY_HOURS}h without approval; moving on to new stories.`,
      });
    }
    return;
  }
  if (ep.approval_mode !== "timeout") return;
  const timeoutMinutes =
    ep.lane === "news_breaking"
      ? s.cfg.breakingApprovalMinutes
      : ep.lane === "evergreen"
        ? s.cfg.evergreenApprovalMinutes
        : ep.lane === "longform"
          ? s.cfg.longformApprovalMinutes
          : s.cfg.approvalTimeoutMinutes;
  if (waited >= timeoutMinutes * 60_000) {
    // The countdown only publishes if the owner could actually have tapped Reject: when the
    // public URL (the tunnel) is down the Discord links are dead, so the episode is held.
    if (!(await s.publicReachable())) {
      log("warn", "approval timeout held: public URL unreachable", {
        episode: ep.id,
        url: s.cfg.publicUrl,
      });
      return;
    }
    if (
      await transition(s.db, ep.id, "awaiting_approval", "approved", {
        approved_by: "timeout",
      })
    ) {
      await logEvent(s.db, ep.id, "approved", { by: "timeout" });
    }
  }
}

/** Publish now if inside the window, otherwise at the next window opening. */
/**
 * When this episode goes live: breaking publishes now inside its window (else
 * at the window's next opening); news publishes at its slot (now if the slot
 * has passed); every lane keeps MIN_UPLOAD_GAP_MINUTES after the last publish.
 * Returns undefined for "now".
 */
export function choosePublishAt(
  cfg: Config,
  now: Date,
  ep?: Pick<Episode, "lane" | "slot_at">,
  lastPublish?: Date,
): Date | undefined {
  let at: Date | undefined;
  if (ep?.lane === "news_breaking") {
    at = inWindow(now, cfg.breakingWindow, cfg.timezone)
      ? undefined
      : nextWindowStart(now, cfg.breakingWindow, cfg.timezone);
  } else if (ep?.slot_at) {
    const slot = new Date(ep.slot_at);
    at = slot > now ? slot : undefined;
  } else {
    // Legacy window behaviour for episodes without a slot.
    const earliest = new Date(now.getTime() + cfg.youtubeVetoMinutes * 60_000);
    const h = earliest.getUTCHours();
    if (h < cfg.publishWindowStartUtc)
      at = new Date(
        Date.UTC(
          earliest.getUTCFullYear(),
          earliest.getUTCMonth(),
          earliest.getUTCDate(),
          cfg.publishWindowStartUtc,
        ),
      );
    else if (h >= cfg.publishWindowEndUtc)
      at = new Date(
        Date.UTC(
          earliest.getUTCFullYear(),
          earliest.getUTCMonth(),
          earliest.getUTCDate() + 1,
          cfg.publishWindowStartUtc,
        ),
      );
    else if (cfg.youtubeVetoMinutes > 0) at = earliest;
  }
  if (lastPublish) {
    const gapEnd = new Date(
      lastPublish.getTime() + cfg.minUploadGapMinutes * 60_000,
    );
    if (gapEnd > (at ?? now)) at = gapEnd;
  }
  // YouTube needs scheduled times comfortably in the future; otherwise go now.
  if (at && at.getTime() - now.getTime() < 15 * 60_000) return undefined;
  return at;
}

async function stepApproved(s: Services, ep: Episode): Promise<void> {
  // A gameplay Short takes the first free gameplay slot, clear of everything already scheduled.
  if (ep.lane === "gameplay" && !ep.slot_at) {
    const rows = await s.db.query<{ at: string; lane: string }>(
      `SELECT COALESCE(publish_at, slot_at) AS at, lane FROM episodes
        WHERE COALESCE(publish_at, slot_at) IS NOT NULL AND COALESCE(publish_at, slot_at) > $1::timestamptz - interval '1 hour'
          AND status NOT IN ('failed','rejected') AND id <> $2`,
      [s.now(), ep.id],
    );
    const slot = nextGameplaySlot(
      s.cfg,
      s.now(),
      rows.filter((r) => r.lane !== "gameplay").map((r) => new Date(r.at)),
      rows.filter((r) => r.lane === "gameplay").map((r) => new Date(r.at)),
    );
    if (slot) {
      await s.db.query(`UPDATE episodes SET slot_at = $2 WHERE id = $1`, [
        ep.id,
        slot,
      ]);
      ep = { ...ep, slot_at: slot.toISOString() };
    }
  }
  const publishAt = choosePublishAt(
    s.cfg,
    s.now(),
    ep,
    await lastPublishAt(s.db, ep.lane === "twin"),
  );
  // Public uploads are scheduled on YouTube (private until publish_at). Anything else
  // cannot be scheduled there, so the upload itself waits until the slot.
  const holdUpload = publishAt && s.cfg.youtubePrivacy !== "public";
  await transition(s.db, ep.id, "approved", "uploading", {
    publish_at: publishAt ?? null,
    ...(holdUpload ? { next_attempt_at: publishAt } : {}),
  });
  if (publishAt)
    await logEvent(s.db, ep.id, "scheduled", {
      publish_at: publishAt.toISOString(),
      lane: ep.lane,
    });
}

/**
 * The description's footage credit, built from each clip's provenance: Steam
 * trailers grouped by game, publisher YouTube trailers listed with their link,
 * the Xbox content rules line when Microsoft material is involved.
 */
/** Chapter lines for the long-form description: the intro at 0:00, each entry, the pick. */
export function longChapters(ep: Episode): string[] {
  const script = ep.script_json;
  const words = ep.assets_json?.words ?? [];
  if (!script || !words.length) return [];
  const duration = (ep.assets_json?.durationSeconds ?? 0) + LONG_TAIL_SECONDS;
  const segments = openChaptersAtBreaks(
    buildSegments(
      segmentInputs(script, Boolean(ep.assets_json?.desk)),
      words,
      duration,
    ),
    ep.assets_json?.breaks,
  );
  return chapterLines(segments, (seg) =>
    seg.kind === "hook"
      ? "Intro"
      : seg.kind === "beat" && seg.visual?.kind === "rank"
        ? `#${seg.visual.value_a} ${seg.visual.primary}`
        : seg.kind === "beat" && seg.visual?.kind === "chapter"
          ? seg.visual.primary
          : seg.kind === "take"
            ? script.evergreen_format === "documentary"
              ? titleCaseLabel(script.pulse_take.label)
              : "Our pick"
            : undefined,
  );
}

export function footageCredits(
  script: Script,
  clips: Array<{ provenance: string }>,
  official: EpisodeAssets["officialTrailer"] | undefined,
  publisher: string | undefined,
  headline: string,
): string {
  if (!clips.length && !official) return "";
  const steamGames = new Set<string>();
  const channels = new Map<string, string>(); // channel -> url
  for (const c of clips) {
    const steam = c.provenance.match(
      /^Official Steam trailer "[^"]*" for "([^"]+)"/,
    );
    if (steam) steamGames.add(steam[1]!);
    const yt = c.provenance.match(
      /from the (.+?) YouTube channel, publisher: [^(]+\((https?:[^)]+)\)/,
    );
    const social = c.provenance.match(
      /^Official post "[^"]*" by (.+? on TikTok), publisher: [^(]+\((https?:[^)]+)\)/,
    );
    if (social) channels.set(social[1]!, social[2]!);
    if (yt) channels.set(yt[1]!, yt[2]!);
  }
  if (official) channels.set(official.channelTitle, official.url);
  const lines: string[] = [];
  // Clips whose provenance names no trailer (older episodes, test fixtures) still get the generic credit.
  if (!steamGames.size && !channels.size && clips.length)
    lines.push(
      `Footage: ${script.game_title} official trailer${publisher ? ` (${publisher})` : ""}, via Steam. Store art: Steam.`,
    );
  if (steamGames.size === 1 && !script.entries?.length)
    lines.push(
      `Footage: ${[...steamGames][0]} official trailer${publisher ? ` (${publisher})` : ""}, via Steam, a few seconds. Store art: Steam.`,
    );
  else if (steamGames.size)
    lines.push(
      `Footage: official Steam trailers, a few seconds each: ${[...steamGames].join(", ")}. Store art: Steam.`,
    );
  for (const [channel, url] of channels)
    lines.push(
      /on TikTok$/.test(channel)
        ? `Footage: official post by ${channel} (${url}).`
        : `Footage and still: the official ${channel} YouTube channel (${url}).`,
    );
  const cc = new Map<string, string>();
  for (const c of clips) {
    const m = c.provenance.match(
      /^Gameplay "[^"]*" by (.+?), Creative Commons Attribution licence \(CC BY\) \((https?:[^)]+)\)/,
    );
    if (m) cc.set(m[1]!, m[2]!);
  }
  for (const [channel, url] of cc)
    lines.push(`Gameplay: ${channel}, licensed CC BY (${url}).`);
  const stock = clips
    .filter((c) => /^Illustrative stock footage from Pexels/.test(c.provenance))
    .map((c) => c.provenance.match(/\((https?:[^)]+)\)/)?.[1])
    .filter(Boolean);
  if (stock.length)
    lines.push(
      `Illustrative stock footage (not the real event): Pexels, ${stock.join(", ")}.`,
    );
  if (
    /microsoft|xbox game studios|bethesda/i.test(
      `${publisher ?? ""} ${headline}`,
    )
  )
    lines.push(
      "Game footage used under Microsoft's Game Content Usage Rules: https://www.xbox.com/en-US/developers/rules",
    );
  return lines.length ? `\n${lines.join("\n")}` : "";
}

export function videoMetadata(
  ep: Episode,
  privacy: Config["youtubePrivacy"],
  syntheticMedia = true,
  affiliate?: AffiliateTags,
) {
  const script = ep.script_json!;
  const credits = ep.story_json.items
    .slice(0, 4)
    .map((i) => `• ${i.source}: ${i.url}`)
    .join("\n");
  if (script.twin) {
    // The twin's description in its language: the body, the original, the sources, the fixed lines.
    const parentUrl = `https://youtube.com/shorts/${script.twin.parent_video}`;
    const hashtags = (script.hashtags ?? [])
      .map((h) => (h.startsWith("#") ? h : `#${h}`))
      .slice(0, 5)
      .join(" ");
    return {
      title: script.youtube.title.slice(0, 100),
      description: [
        script.youtube.description
          .trim()
          .replace(/#\w+/g, "")
          .replace(/\s{2,}/g, " ")
          .trim(),
        credits ? `\nFuentes:\n${credits}` : "",
        ...twinFooter(script.twin.language, parentUrl).map((l) => `\n${l}`),
        hashtags,
      ]
        .filter((line) => line !== "")
        .join("\n")
        .slice(0, 4950),
      tags: script.youtube.tags.slice(0, 15),
      categoryId: "20",
      privacyStatus: privacy,
      publishAt: ep.publish_at
        ? new Date(ep.publish_at).toISOString()
        : undefined,
      containsSyntheticMedia: syntheticMedia,
      defaultLanguage: script.twin.language,
    };
  }
  const clips = ep.assets_json?.clips ?? [];
  const publisher =
    clips[0]?.provenance.match(/publisher[^:]*:\s*([^;)]+)/i)?.[1]?.trim() ??
    ep.assets_json?.officialTrailer?.publisher;
  const official = ep.assets_json?.officialTrailer;
  const footage = footageCredits(
    script,
    clips,
    official,
    publisher,
    ep.story_json.headline,
  );
  const body = script.youtube.description
    .trim()
    .replace(/#\w+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const long = script.runtime === "long";
  const chapters = long ? longChapters(ep) : [];
  // Shop links for every game and piece of hardware the video names, right under the summary.
  const shop = affiliateBlock(script, affiliate, { free: ep.lane === "free" });
  const description = [
    keywordLead(script),
    "",
    body,
    shop,
    script.is_rumour
      ? "\nThis story is unconfirmed. We will update if it is confirmed or denied."
      : "",
    chapters.length ? `\nChapters:\n${chapters.join("\n")}` : "",
    credits ? `\nSources:\n${credits}` : "",
    script.sources?.length
      ? `\nSources:\n${script.sources.map((u) => `• Wikipedia: ${u}`).join("\n")}`
      : "",
    (ep.assets_json?.images ?? []).some((i) => i.kind === "photo") &&
    affiliate?.shopUrl
      ? `\nPhotos: Wikimedia Commons, credited on screen. Full photo and footage credits: ${affiliate.shopUrl.replace(/\/shop\//, "/credits/")}`
      : "",
    footage,
    script.gameplay
      ? `\nGameplay recorded by Pulse Gaming on Xbox Series X from our own copy of ${script.game_title}. No AI voice: the sound is the game's own.`
      : "\nNarration: AI-generated synthetic voice. Visuals: official publisher material, credited.",
    script.gameplay
      ? "\nPulse Gaming: we test what games let you do, one question at a time. Tell us what to test next in the comments."
      : script.recap
        ? "\nPulse Gaming News: gaming news, checked and explained. The week's biggest stories every Friday, a new ranking every week, Shorts every day."
        : script.evergreen_format === "documentary"
          ? "\nPulse Gaming News: the stories behind the games, checked and explained. A new documentary every month, a new ranking every week, Shorts every day."
          : long
            ? "\nPulse Gaming News: rankings, news and takes, checked and explained. A new ranking every week, Shorts every day."
            : "\nPulse Gaming News: fast gaming news, checked and explained. New Shorts every day.",
    (long
      ? hashtags(script)
          .filter((h) => h !== "#Shorts")
          .concat("#Gaming")
      : hashtags(script)
    ).join(" "),
  ]
    .filter((line) => line !== "")
    .join("\n")
    .slice(0, 4950);
  return {
    title: polishTitle(script),
    description,
    tags: buildTags(script),
    categoryId: "20",
    privacyStatus: privacy,
    publishAt: ep.publish_at
      ? new Date(ep.publish_at).toISOString()
      : undefined,
    // The narrator is a cloned voice, so disclose it (as Codex did). The
    // label does not affect reach or monetisation.
    containsSyntheticMedia: syntheticMedia,
    defaultLanguage: "en",
  };
}

async function stepUpload(s: Services, ep: Episode): Promise<void> {
  if (s.cfg.dryRun) {
    await transition(s.db, ep.id, "uploading", "published", {
      youtube_status: "dry_run",
    });
    await s.notify({
      content: `🧪 DRY_RUN: "${ep.script_json!.youtube.title}" would have been uploaded now.`,
    });
    return;
  }
  // The owner's publishing hold: wait, and look again in a quarter of an hour.
  if (await publishHeld(s.db)) {
    await s.db.query(`UPDATE episodes SET next_attempt_at = $2 WHERE id = $1`, [
      ep.id,
      new Date(s.now().getTime() + 15 * 60_000),
    ]);
    return;
  }
  const used = await quotaCalls(s.db, s.now(), "upload");
  if (used >= s.cfg.uploadCallsPerDay) {
    const resetAt = quotaResetAt(s.now());
    log("warn", "YouTube quota nearly spent; upload deferred", {
      episode: ep.id,
      used,
      resetAt: resetAt.toISOString(),
    });
    await s.db.query(`UPDATE episodes SET next_attempt_at = $2 WHERE id = $1`, [
      ep.id,
      resetAt,
    ]);
    await logEvent(s.db, ep.id, "quota_deferred", {
      used,
      reset_at: resetAt.toISOString(),
    });
    return;
  }
  const yt = s.youtube(accountOf(ep));
  const marker = markerTag(ep.id);
  const file = path.join(episodeDir(s.cfg, ep.id), "short.mp4");

  // A previous attempt may have sent some or all of the bytes. With its session still on record, the
  // session itself says how much arrived and the rest is sent below. A video found only by its marker
  // tag can be a stub whose bytes never finished (three sat at "Processing will begin shortly" after a
  // dropped connection and restarts, 26 Oct 2026), so it is adopted only when YouTube has the whole file.
  if (!ep.upload_session_uri && ep.attempts > 0) {
    const existing = await yt.findByMarker(marker);
    const st = existing
      ? await yt.status(existing).catch(() => undefined)
      : undefined;
    const complete =
      !!st &&
      (st.uploadStatus === "processed" ||
        st.processingStatus === "succeeded" ||
        (st.partsProcessed ?? 0) > 0);
    if (existing && !complete)
      await logEvent(s.db, ep.id, "upload_stub_skipped", {
        videoId: existing,
        uploadStatus: st?.uploadStatus,
        processingStatus: st?.processingStatus,
      });
    if (existing && complete) {
      // Adopting it makes no new upload call, so nothing is charged.
      await transition(s.db, ep.id, "uploading", "uploaded", {
        youtube_video_id: existing,
      });
      await logEvent(s.db, ep.id, "upload_adopted", { videoId: existing });
      return;
    }
  }
  // A delayed Short: news or deals past their moment go back to the owner; anything else whose planned
  // time has passed gets a fresh slot spaced from the last publish. A scheduled time in the past makes
  // YouTube publish at once, so a backlog would otherwise all go live together.
  if (ep.publish_at) {
    const now = s.now();
    const planned = new Date(ep.publish_at);
    const staleHours = staleAfterHours(
      ep.lane,
      ep.script_json?.evergreen_format,
    );
    if (
      staleHours !== undefined &&
      now.getTime() - planned.getTime() > staleHours * 3600_000
    ) {
      await transition(s.db, ep.id, "uploading", "awaiting_approval", {
        approval_mode: "manual",
        approval_requested_at: now,
        publish_at: null,
        upload_session_uri: null,
      });
      const links = approvalLinks(s.cfg, ep.id);
      await logEvent(s.db, ep.id, "stale_review", {
        planned: planned.toISOString(),
      });
      await s.notify({
        content: `⏳ "${ep.script_json!.youtube.title}" was due at ${ukTime(planned, now)} but was held up, so it may be out of date now. It stays unpublished unless you approve it.
▶️ [Watch](${links.preview}) · ✅ [Approve](${links.approve}) · ❌ [Reject](${links.reject})`,
      });
      return;
    }
    if (planned.getTime() - now.getTime() < 15 * 60_000) {
      const [other] = await s.db.query<{ t: string | null }>(
        `SELECT max(publish_at) AS t FROM episodes WHERE id <> $1 AND status IN ('uploading','uploaded','published') AND publish_at IS NOT NULL AND youtube_status IS DISTINCT FROM 'dry_run'`,
        [ep.id],
      );
      let at = new Date(now.getTime() + 20 * 60_000);
      const gapEnd = other?.t
        ? new Date(
            new Date(other.t).getTime() + s.cfg.minUploadGapMinutes * 60_000,
          )
        : undefined;
      if (gapEnd && gapEnd > at) at = gapEnd;
      await s.db.query(
        `UPDATE episodes SET publish_at = $2, upload_session_uri = NULL WHERE id = $1`,
        [ep.id, at],
      );
      await logEvent(s.db, ep.id, "rescheduled", {
        from: planned.toISOString(),
        to: at.toISOString(),
      });
      ep = {
        ...ep,
        publish_at: at.toISOString(),
        upload_session_uri: null,
      } as Episode;
    }
  }
  let session = ep.upload_session_uri;
  if (!session) {
    const size = (await fs.stat(file)).size;
    session = await yt.createSession(
      buildResource(
        videoMetadata(
          ep,
          s.cfg.youtubePrivacy,
          ep.lane === "gameplay" ? false : s.cfg.syntheticMedia,
          affiliateTags(s.cfg, ep.id),
        ),
        marker,
      ),
      size,
    );
    // Opening the session is the videos.insert call: it counts even if the bytes never arrive.
    await quotaCall(s.db, s.now(), "upload");
    await s.db.query(
      `UPDATE episodes SET upload_session_uri = $2 WHERE id = $1 AND status = 'uploading'`,
      [ep.id, session],
    );
  }
  try {
    const videoId = await yt.uploadToSession(session, file);
    await transition(s.db, ep.id, "uploading", "uploaded", {
      youtube_video_id: videoId,
    });
    await logEvent(s.db, ep.id, "uploaded", { videoId });
    await localizeMetadata(s, ep, videoId, yt);
  } catch (err) {
    if (err instanceof SessionGone) {
      await s.db.query(
        `UPDATE episodes SET upload_session_uri = NULL WHERE id = $1`,
        [ep.id],
      );
    }
    throw err;
  }
}

/**
 * The title and description in the channel's other languages (LOCALIZE_LANGUAGES): one small model call
 * and one 50-unit videos.update, right after the upload. YouTube shows the matching pair to viewers whose
 * interface is in that language and indexes the video for their searches. Never blocks the upload.
 */
async function localizeMetadata(
  s: Services,
  ep: Episode,
  videoId: string,
  yt: ReturnType<Services["youtube"]>,
): Promise<void> {
  const langs = s.cfg.localizeLanguages.filter((l) => l.toLowerCase() !== "en");
  if (!langs.length || ep.lane === "twin") return;
  try {
    const meta = videoMetadata(
      ep,
      s.cfg.youtubePrivacy,
      s.cfg.syntheticMedia,
      affiliateTags(s.cfg, ep.id),
    );
    const loc = await translateMetadata(
      s.llm,
      { title: meta.title, description: meta.description },
      langs,
    );
    const done = Object.keys(loc);
    if (!done.length) return;
    await yt.setLocalizations(videoId, loc);
    await quotaAdd(s.db, s.now(), QUOTA.localize);
    await logEvent(s.db, ep.id, "localized", { languages: done });
  } catch (err) {
    log("warn", "localisation skipped", {
      episode: ep.id,
      error: errorMessage(err),
    });
    await logEvent(s.db, ep.id, "localize_failed", {
      error: errorMessage(err).slice(0, 300),
    }).catch(() => undefined);
  }
}

/**
 * Videos published before localisation existed get their titles and descriptions in the other
 * languages too: one every half hour, newest first, only while the day's spare quota covers it
 * comfortably. A video that failed is not tried again for a week.
 */
export async function localizeBackfill(s: Services): Promise<boolean> {
  if (!s.cfg.localizeLanguages.some((l) => l.toLowerCase() !== "en"))
    return false;
  const now = s.now();
  if ((await quotaHeadroom(s.db, s.cfg, now)) < 500) return false;
  if (
    await weeklyTried(s.db, `localize:${Math.floor(now.getTime() / 1_800_000)}`)
  )
    return false;
  const [row] = await s.db.query<{ id: string }>(
    `SELECT e.id FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND e.lane <> 'twin'
        AND coalesce(e.publish_at, e.updated_at) > $1::timestamptz - interval '120 days'
        AND coalesce(e.publish_at, e.updated_at) < $1::timestamptz
        AND NOT EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind = 'localized')
        AND NOT EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind = 'localize_failed' AND v.created_at > $1::timestamptz - interval '7 days')
      ORDER BY coalesce(e.publish_at, e.updated_at) DESC LIMIT 1`,
    [now],
  );
  const ep = row ? await getEpisode(s.db, row.id) : undefined;
  if (!ep?.youtube_video_id) return false;
  await localizeMetadata(s, ep, ep.youtube_video_id, s.youtube(accountOf(ep)));
  return true;
}

/** Every Associates ID the channel has, plus the video's shop page when the public address works from outside. */
export function affiliateTags(cfg: Config, episodeId: string): AffiliateTags {
  const publicOk =
    cfg.publicUrl &&
    !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(cfg.publicUrl);
  return {
    uk: cfg.amazonUkTag,
    us: cfg.amazonUsTag || undefined,
    ...cfg.amazonMoreTags,
    shopUrl: publicOk
      ? `${(cfg.siteUrl || cfg.publicUrl).replace(/\/$/, "")}/shop/${episodeId}`
      : undefined,
  };
}

/**
 * Ten minutes after a scheduled publish time, checks the video really went
 * public. Public: the first comment goes up now (YouTube refuses comments on
 * private videos). Still private: the owner is told once and never overridden,
 * since they may have made it private themselves.
 */
export async function confirmPublished(s: Services): Promise<void> {
  const due = await s.db.query<{
    id: string;
    youtube_video_id: string;
    title: string | null;
    account: string;
  }>(
    // Every tick for the first two hours after the slot, then once an hour for three days: an outage or
    // a slow YouTube no longer ends the check, so "published" is only ever confirmed, not assumed.
    `SELECT e.id, e.youtube_video_id, e.script_json->'youtube'->>'title' AS title, COALESCE(e.story_json->'twin'->>'account', '') AS account FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND e.publish_at IS NOT NULL
        AND e.publish_at < $1::timestamptz - interval '10 minutes' AND e.publish_at > $1::timestamptz - interval '72 hours'
        AND NOT EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind IN ('public_confirmed','made_public'))
        AND NOT (e.publish_at < $1::timestamptz - interval '2 hours'
                 AND EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind = 'public_pending' AND v.created_at > $1::timestamptz - interval '55 minutes'))`,
    [s.now()],
  );
  for (const ep of due) {
    const st = await s.youtube(ep.account).status(ep.youtube_video_id);
    if (st?.privacyStatus === "public") {
      // The time we saw it public: the truthful release time for the site and the analytics, which the
      // planned slot only approximates (YouTube can run late, and a delayed video keeps its old slot).
      await logEvent(s.db, ep.id, "public_confirmed", {
        at: s.now().toISOString(),
      });
      const live = await getEpisode(s.db, ep.id);
      if (live) await gameplayLive(s, live);
    } else if (st?.privacyStatus === "private") {
      // Never publish it ourselves: the owner may have made it private on purpose, and YouTube cannot say who did.
      await logEvent(s.db, ep.id, "made_public", {
        skipped: true,
        was: st.privacyStatus,
      });
      log("warn", "scheduled video is still private after its slot", {
        episode: ep.id,
        video: ep.youtube_video_id,
      });
      await s.notify({
        ping: true,
        content: `⚠️ Needs you? "${ep.title ?? ep.id}" is still private after its scheduled time. If you made it private, ignore this. If not, set it to public in YouTube Studio: https://studio.youtube.com/video/${ep.youtube_video_id}/edit`,
      });
      continue;
    } else {
      // Not public yet (still processing, or YouTube running late): noted, and looked at again.
      await logEvent(s.db, ep.id, "public_pending", {
        was: st?.privacyStatus ?? "unknown",
      });
      continue;
    }
    // The first comment waits until the video is public.
    const [posted] = await s.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM events WHERE episode_id = $1 AND kind = 'comment_posted'`,
      [ep.id],
    );
    const full =
      Number(posted?.n ?? 0) === 0 ? await getEpisode(s.db, ep.id) : undefined;
    if (full) await addPinnedComment(s, full);
  }
}

/** Posts the channel's own first comment (the owner pins it from the app; the API cannot pin). Never blocks a live video. */
async function addPinnedComment(s: Services, ep: Episode): Promise<void> {
  if (await publishHeld(s.db)) return; // the owner's publishing hold
  try {
    // Comment links are clickable on long videos (not on Shorts): the long video's pin carries its top pick.
    const text =
      (ep.script_json!.twin?.pinned || pinnedComment(ep.script_json!)) +
      (ep.script_json!.runtime === "long"
        ? affiliateCommentLine(ep.script_json!, affiliateTags(s.cfg, ep.id))
        : "");
    const id = await s
      .youtube(accountOf(ep))
      .insertComment(ep.youtube_video_id!, text);
    await quotaAdd(s.db, s.now(), QUOTA.comment);
    await logEvent(s.db, ep.id, "comment_posted", { id, text });
  } catch (err) {
    log("warn", "pinned comment failed", {
      episode: ep.id,
      error: errorMessage(err),
    });
    await logEvent(s.db, ep.id, "comment_failed", { error: errorMessage(err) });
  }
}

/** Uploads the SRT as the video's English caption track. Captions are an enhancement: a failure is logged, never blocks a video that is already live. */
async function addCaptions(s: Services, ep: Episode): Promise<void> {
  const file = path.join(episodeDir(s.cfg, ep.id), ep.assets_json!.srt!);
  try {
    const yt = s.youtube(accountOf(ep));
    if (
      (await yt.listCaptions(ep.youtube_video_id!)).some(
        (c) => c.language === "en" || c.language === "en-GB",
      )
    )
      return;
    const id = await yt.insertCaption(
      ep.youtube_video_id!,
      file,
      "en",
      "English",
    );
    await quotaAdd(s.db, s.now(), QUOTA.captions);
    await logEvent(s.db, ep.id, "captions_uploaded", { id });
  } catch (err) {
    log("warn", "caption upload failed", {
      episode: ep.id,
      error: errorMessage(err),
    });
    await logEvent(s.db, ep.id, "captions_failed", {
      error: errorMessage(err),
    });
  }
}

/** The long-form video's custom thumbnail; a refusal (unverified channel) is logged, never fatal. */
async function setThumbnail(s: Services, ep: Episode): Promise<void> {
  try {
    await s
      .youtube()
      .setThumbnail(
        ep.youtube_video_id!,
        path.join(episodeDir(s.cfg, ep.id), ep.assets_json!.thumb!),
      );
    await quotaAdd(s.db, s.now(), QUOTA.comment);
    await logEvent(s.db, ep.id, "thumbnail", { ok: true });
  } catch (err) {
    log("warn", "thumbnail upload failed", {
      episode: ep.id,
      error: errorMessage(err),
    });
    await logEvent(s.db, ep.id, "thumbnail", {
      ok: false,
      error: errorMessage(err).slice(0, 300),
    });
  }
}

async function stepConfirm(s: Services, ep: Episode): Promise<void> {
  const st = await s.youtube(accountOf(ep)).status(ep.youtube_video_id!);
  await quotaAdd(s.db, s.now(), QUOTA.poll);
  if (!st) throw new Error("uploaded video not found yet");
  if (st.uploadStatus === "rejected" || st.uploadStatus === "failed") {
    await transition(s.db, ep.id, "uploaded", "failed", {
      youtube_status: st.uploadStatus,
      last_error: st.rejectionReason ?? st.failureReason ?? st.uploadStatus,
    });
    throw new FatalError(
      `YouTube ${st.uploadStatus} the video: ${st.rejectionReason ?? st.failureReason ?? "no reason given"}`,
    );
  }
  if (st.uploadStatus !== "processed") {
    await s.db.query(
      `UPDATE episodes SET youtube_status = $2, next_attempt_at = now() + interval '5 minutes' WHERE id = $1`,
      [ep.id, st.uploadStatus],
    );
    return;
  }
  // Captions go up on long videos only: YouTube captions a Short itself, and the 450 units each
  // upload cost pay for a fifth daily video (the deals Short) instead.
  if (ep.assets_json?.srt && ep.script_json?.runtime === "long")
    await addCaptions(s, ep);
  // YouTube refuses comments on a video that is still private: a scheduled one is commented once it is public.
  if (!ep.publish_at || new Date(ep.publish_at) <= s.now())
    await addPinnedComment(s, ep);
  if (ep.assets_json?.thumb) await setThumbnail(s, ep);
  await addToSeries(s, ep);
  await transition(s.db, ep.id, "uploaded", "published", {
    youtube_status: st.privacyStatus,
  });
  if (st.privacyStatus === "public") await gameplayLive(s, ep);
  const url = `https://youtube.com/shorts/${ep.youtube_video_id}`;
  const longVideo = ep.script_json?.runtime === "long";
  await s.notify({
    content: `✅ ${ep.publish_at && new Date(ep.publish_at) > s.now() ? `Uploaded, goes live ${ukTime(new Date(ep.publish_at), s.now())}` : "Live now"}${longVideo ? " (long video)" : ""}: ${ep.script_json!.youtube.title}\n${longVideo ? `https://youtu.be/${ep.youtube_video_id}` : url}`,
  });
}

/** "19:00 UK" (or "Thu 19:00 UK" when it is not today). */
function ukTime(d: Date, now = new Date()): string {
  const fmt = (o: Intl.DateTimeFormatOptions, x: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      ...o,
    }).format(x);
  const sameDay =
    fmt({ dateStyle: "short" }, d) === fmt({ dateStyle: "short" }, now);
  return `${sameDay ? "" : `${fmt({ weekday: "short" }, d)} `}${fmt({ hour: "2-digit", minute: "2-digit", hour12: false }, d)} UK`;
}

const STEPS: Partial<
  Record<Episode["status"], (s: Services, ep: Episode) => Promise<void>>
> = {
  selected: stepScript,
  scripted: stepVoice,
  voiced: stepRender,
  rendered: stepRequestApproval,
  awaiting_approval: stepAwaitApproval,
  approved: stepApproved,
  uploading: stepUpload,
  uploaded: stepConfirm,
};

/** Runs one step; on failure records it and backs off, alerting once it gives up. */
export async function advance(s: Services, ep: Episode): Promise<boolean> {
  const step = STEPS[ep.status];
  if (!step) return false;
  try {
    await step(s, ep);
    const after = await getEpisode(s.db, ep.id);
    return Boolean(after && after.status !== ep.status);
  } catch (err) {
    const msg = errorMessage(err);
    const fatal = err instanceof FatalError;
    const attempts = await recordFailure(
      s.db,
      ep.id,
      msg,
      Math.min(60, 5 * 2 ** ep.attempts),
    );
    log("error", "step failed", {
      id: ep.id,
      status: ep.status,
      attempts,
      fatal,
      error: msg,
    });
    // Only a platform-wide fault (credentials, quota, policy) justifies pausing new stories;
    // a fatal error inside one episode's own content must not take the whole day with it.
    const platformFault =
      fatal &&
      ep.lane !== "twin" && // the twin channel's login or quota must never pause the main channel
      (["uploading", "uploaded"].includes(ep.status) ||
        /invalid_grant|quota|credential|api key|x-api-key|forbidden|unauthori[sz]ed|refused/i.test(
          msg,
        ));
    if (platformFault)
      await pauseSelection(s.db, s.now(), FATAL_PAUSE_HOURS, msg);
    if (fatal || attempts >= s.cfg.maxAttempts) {
      const fresh = await getEpisode(s.db, ep.id);
      if (
        fresh &&
        !["failed", "published", "rejected"].includes(fresh.status)
      ) {
        await transition(s.db, ep.id, fresh.status, "failed", {
          last_error: msg,
        });
      }
      const where =
        (ep.status === "uploading"
          ? "\nThe upload may be incomplete; the next run will search the channel before re-uploading."
          : "") +
        (platformFault
          ? `\nNew stories are paused for ${FATAL_PAUSE_HOURS}h (or until YouTube is reconnected) so this can be fixed.`
          : "");
      if (platformFault)
        await s.notify({
          ping: true,
          content: `⚠️ Needs you: YouTube refused an upload (${msg.slice(0, 300)}). New stories are paused for ${FATAL_PAUSE_HOURS}h. Reconnect YouTube from the dashboard if it says the login expired.${where}`,
        });
      else
        await s.notify({
          level: "info",
          content: `Gave up on "${ep.script_json?.headline ?? ep.story_json.headline}" at ${ep.status}: ${msg.slice(0, 200)}`,
        });
    }
    return false;
  }
}

const FATAL_PAUSE_HOURS = 12;

export async function pauseSelection(
  db: Db,
  now: Date,
  hours: number,
  reason: string,
): Promise<void> {
  const value = JSON.stringify({
    until: new Date(now.getTime() + hours * 3600_000).toISOString(),
    reason: reason.slice(0, 300),
  });
  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('selection_pause', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [value],
  );
}

export async function clearSelectionPause(db: Db): Promise<void> {
  await db.query(`DELETE FROM settings WHERE key = 'selection_pause'`);
}

/** The pause reason while selection is paused, otherwise undefined. */
export async function selectionPause(
  db: Db,
  now: Date,
): Promise<string | undefined> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'selection_pause'`,
  );
  if (!row) return undefined;
  try {
    const p = JSON.parse(row.value) as { until: string; reason: string };
    return new Date(p.until).getTime() > now.getTime() ? p.reason : undefined;
  } catch {
    return undefined;
  }
}

/** Deletes media for finished episodes after two weeks so the volume never fills. */
export async function pruneMedia(s: Services, days = 14): Promise<number> {
  const rows = await s.db.query<{ id: string }>(
    `SELECT id FROM episodes WHERE status IN ('published','rejected','failed') AND updated_at < now() - make_interval(days => $1)`,
    [days],
  );
  let n = 0;
  for (const { id } of rows) {
    const dir = episodeDir(s.cfg, id);
    try {
      await fs.access(dir);
    } catch {
      continue;
    }
    await fs.rm(dir, { recursive: true, force: true });
    n++;
  }
  return n;
}

export async function tick(
  s: Services,
): Promise<{ ran: boolean; selected?: string }> {
  // A monthly documentary can hold the tick for over an hour (write, voice, render); a crashed holder is cleared at boot.
  const result = await withLease(s.db, "tick", 180 * 60, async () => {
    let selected: string | undefined;
    try {
      await discoverTick(s);
      selected = await maybeSelect(s);
    } catch (err) {
      log("error", "selection failed", { error: errorMessage(err) });
      if (err instanceof FatalError)
        await s.notify({
          level: "info",
          content: `Story selection failed once: ${errorMessage(err)}`,
        });
    }
    for (const ep of await dueEpisodes(s.db, s.now())) {
      // Push one episode as far as it can go this tick (script → upload);
      // it stops on its own at a wait (approval, processing, a slot, a quota reset) or a failure.
      let current: Episode | undefined = ep;
      for (let i = 0; i < 10 && current; i++) {
        const moved = await advance(s, current);
        if (!moved) break;
        current = await getEpisode(s.db, ep.id);
        if (
          current?.next_attempt_at &&
          new Date(current.next_attempt_at) > s.now()
        )
          break;
      }
    }
    // The owner's recordings: new clips heard and looked at, picked ones started on (they ride the same tick next time).
    await ingestGameplay(s).catch((err) =>
      log("warn", "gameplay intake failed", { error: errorMessage(err) }),
    );
    // The twin channel: every Short that went public gets its translated twin.
    await maybeSelectTwin(s).catch((err) =>
      log("warn", "twin selection failed", { error: errorMessage(err) }),
    );
    await syncGameplaySkips(s).catch((err) =>
      log("warn", "gameplay status sync failed", { error: errorMessage(err) }),
    );
    await pruneMedia(s).catch((err) =>
      log("warn", "prune failed", { error: errorMessage(err) }),
    );
    // Records of comments we judged are kept 90 days (the privacy notice says so), then deleted.
    await pruneCommentRecords(s.db, s.now()).catch((err) =>
      log("warn", "comment record prune failed", { error: errorMessage(err) }),
    );
    // Public numbers for every published Short at fixed ages (one unit per fifty videos).
    if (!s.cfg.dryRun)
      await captureMetrics(s.db, s.youtube(), s.now()).catch((err) =>
        log("warn", "metrics capture failed", { error: errorMessage(err) }),
      );
    // The twin channel's numbers, with its own login.
    if (!s.cfg.dryRun && (await twinReady(s)))
      await captureMetrics(
        s.db,
        s.youtube(s.cfg.twinLanguage),
        s.now(),
        s.cfg.twinLanguage,
      ).catch((err) =>
        log("warn", "twin metrics capture failed", {
          error: errorMessage(err),
        }),
      );
    // After each scheduled slot: confirm the video went public and post its first comment, or tell the owner it did not.
    if (!s.cfg.dryRun && s.cfg.youtubePrivacy === "public")
      await confirmPublished(s).catch((err) =>
        log("warn", "publish check failed", { error: errorMessage(err) }),
      );
    // How much of each Short people watched, once Analytics has the numbers (needs the analytics scope).
    if (!s.cfg.dryRun)
      await captureRetention(s.db, s.youtube(), s.now()).catch((err) =>
        log("warn", "retention capture failed", { error: errorMessage(err) }),
      );
    if (!s.cfg.dryRun && (await twinReady(s)))
      await captureRetention(
        s.db,
        s.youtube(s.cfg.twinLanguage),
        s.now(),
        s.cfg.twinLanguage,
      ).catch((err) =>
        log("warn", "twin retention capture failed", {
          error: errorMessage(err),
        }),
      );
    // A Short taking off: checked every 20 minutes in its first two days; the editors lean into its game.
    if (
      !s.cfg.dryRun &&
      !(await weeklyTried(
        s.db,
        `hits:${Math.floor(s.now().getTime() / 1_200_000)}`,
      ))
    )
      await watchHits({
        db: s.db,
        cfg: s.cfg,
        now: s.now,
        stats: (ids) => s.youtube().stats(ids),
        notify: (m) => s.notify(m),
      }).catch((err) =>
        log("warn", "take-off check failed", { error: errorMessage(err) }),
      );
    // Older videos: titles and descriptions in the other languages, one every half hour from spare quota.
    if (!s.cfg.dryRun)
      await localizeBackfill(s).catch((err) =>
        log("warn", "localisation backfill failed", {
          error: errorMessage(err),
        }),
      );
    // Long videos: the whole retention curve a week after going live, for the long-form writer's lessons.
    if (!s.cfg.dryRun)
      await captureCurves(s.db, s.youtube(), s.now()).catch((err) =>
        log("warn", "retention curve capture failed", {
          error: errorMessage(err),
        }),
      );
    return { selected };
  });
  return result ? { ran: true, ...result } : { ran: false };
}

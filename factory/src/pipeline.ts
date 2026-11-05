// The factory: one idempotent state machine advanced by a periodic tick.
// Each step reads its inputs from Postgres/disk and writes its outputs before
// the status moves, so any step can crash and be retried safely.

import { firstComment } from "./social/firstcomment.ts";
import { pollBlock, readPoll } from "./social/poll.ts";
import {
  selectWhyTopic,
  whyCandidates,
  whyAnswerProblems,
  whyFollowProblems,
  whyFreshProblems,
  whyHookProblems,
  whyPinnedLine,
  whySlug,
} from "./editorial/why.ts";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { withLease } from "./db.ts";
import {
  INHERIT_MINUTES,
  longRenderMinutes,
  PcTurnTimeout,
  shortWindows,
} from "./pcschedule.ts";
import type { Llm } from "./editorial/llm.ts";
import type { StoryCluster } from "./discovery/cluster.ts";
import type { ArticleText } from "./discovery/article.ts";
import type { Narration } from "./voice/elevenlabs.ts";
import type { VisualAsset, SteamApp, SteamFacts } from "./assets/steam.ts";
import { factsText } from "./assets/steam.ts";
import { capFootage, DEFAULT_FOOTAGE_SECONDS, footageBudgetSeconds } from "./assets/footage.ts";
import { targetsFor, type FootageTarget } from "./assets/clipscore.ts";
import type { OfficialMedia } from "./assets/officialTrailer.ts";
import type { RadarGame, FreeGame } from "./discovery/weekly.ts";
import { rarest, type Achievement } from "./discovery/achievements.ts";
import {
  EVERGREEN_MIN_SECONDS,
  ACHIEVEMENT_ENTRIES,
  ACHIEVEMENT_FORMATS,
  achievementProblems,
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
  narrationOfLongform,
  writeLongform,
} from "./editorial/longform.ts";
import { trailerMatchesGame } from "./assets/commons.ts";
import { captureHold } from "./capture.ts";
import { rankStills } from "./assets/stillscore.ts";
import { PUBLISHER_CHANNELS } from "./assets/officialTrailer.ts";
import { coverageShare, fillSentencePictures } from "./assets/fill.ts";
import {
  footageShareNotice,
  measureFootage,
  runFootageFirst,
} from "./assets/footagestep.ts";
import { footageOptions } from "./assets/footagefirst.ts";
import { capStockTargets } from "./assets/repeats.ts";
import { stockCredit, stockCreditLines, stockQuery } from "./assets/stock.ts";
import {
  isPressProvenance,
  photoCreditLine,
  photoCreditOf,
  photoProvenance,
  photoSourcesLine,
} from "./assets/libraries.ts";
import { pressForShort, reportLibraries } from "./assets/librarystep.ts";
import { comfyReachable, createSketchRun } from "./assets/illustrate.ts";
import {
  animateSketches,
  chooseEpisodeFillers,
  episodeClipCheck,
} from "./assets/fillerstep.ts";

/** The share of a long video's sentences that should have a picture, clip or graphic of their own. */
export const MEDIA_RICH_TARGET = 0.85;
import { makeParallax, LAYERED_KINDS } from "./render/parallax.ts";
import { annotationLabel, locate } from "./assets/annotate.ts";
import { unloadLocalVision } from "./assets/localvision.ts";
import {
  tightenPauses,
  chapterGaps,
  gapSpans,
  insertSilence,
  openWords,
} from "./voice/pauses.ts";
import { quietBeatGaps } from "./voice/quietbeats.ts";
import { soundDesignLine, soundDesignSummary } from "./render/sounddesign.ts";
import { soundCraftLine } from "./render/soundfx.ts";
import { prepareSoundCraft, type SoundCraftPrep } from "./render/voicefx.ts";

/** Seconds of breather before each documentary chapter: narrator silent, music up, the chapter's title full screen. */
const DOC_BREAK_SECONDS = 4;
import { sentencesOf } from "./editorial/longform.ts";
import {
  pickPhotos,
  selectDocTopic,
  outlineDoc,
  writeChapter,
  chapterRefusal,
  DOC_CHAPTER_SOURCE_CHARS,
  DOC_OUTLINE_SOURCE_CHARS,
  DOC_WIDE_SOURCE_CHARS,
  checkChapter,
  checkChapterItems,
  groundCallouts,
  validateChapter,
  chapterRuleProblems,
  narrationOfDoc,
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
  placeDocLoops,
  loopsOfScript,
} from "./editorial/documentary.ts";
import { groundOpenLoops, openLoopsLine } from "./editorial/openloops.ts";
import {
  LONG_RULE_REVISIONS,
  writerNoteProblems,
  hookStackProblems,
  longRulesFor,
  longRulesOn,
  longRuleWarnings,
  scriptMeasures,
} from "./editorial/longrules.ts";
import { structureLine, structureSummary } from "./render/structure.ts";
import {
  longCraft,
  longCraftEvent,
  longKindLabel,
  loopsFor,
} from "./longformat.ts";
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
  selectExplainedEpisode,
  stepScriptExplained,
} from "./explainedstep.ts";
import type { ExplainedStory } from "./editorial/explained.ts";
import { recordWeeklyArm, weeklyArm, weeklyVerdict, fallbackNotice } from "./weeklytest.ts";
import {
  buildLongPlan,
  momentKeys,
  planGaps,
  openChaptersAtBreaks,
  momentWindows,
  LONG_FPS,
  chapterLines,
  LONG_TAIL_SECONDS,
  entryOf,
  realWorldImage,
} from "./render/longplan.ts";
import type { LongRenderInput, LongStillsInput } from "./render/render.ts";
import { motifPictureOrder } from "./render/motifpictures.ts";
import { heroLook } from "./assets/localvision.ts";
import { repairPictures, thumbOutcome } from "./qa/thumbrepair.ts";
import {
  artVerdict,
  cutoutProblems,
  heroRuleDesigns,
  heroRuleFallback,
  posterProblems,
} from "./qa/thumbrule.ts";
import type { renderCutdown, renderGameplayShort } from "./render/render.ts";
import {
  blackSpans,
  cleanLine,
  directClip,
  directCut,
  directFilter,
  directFrames,
  directProblems,
  directTiming,
  DIRECT_MIN_WPM,
  fitLines,
  loopLeadIn,
  loopDangles,
  loopRepeatsHook,
} from "./gameplaydirect.ts";
import {
  CUTDOWN_TAIL_SECONDS,
  cutdownRanks,
  cutdownScript,
  cutdownWindow,
  wordsIn,
  writeCutdownCopy,
} from "./editorial/cutdown.ts";
import { FFMPEG, FFPROBE } from "./lib/bin.ts";
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
import { withAlertScope } from "./alertlog.ts";
import {
  turnDownBreaths,
  voiceProblems,
  wordsPerMinute,
} from "./voice/breathcheck.ts";
import { speakable, speakContext } from "./voice/speakable.ts";
import {
  buildSegments,
  srtFromWords,
  type SegmentInput,
} from "./render/timeline.ts";
import { buildPlan, TAIL_SECONDS, MAX_SFX } from "./render/plan.ts";
import { leadFrames, LEVEL, SFX, sfxFile } from "./render/soundscape.ts";
import { bedFor } from "./render/soundscape.ts";
import { cameraNotice } from "./render/camera.ts";
import { findTextDetails } from "./assets/ocr.ts";
import { formatOpen } from "./formats.ts";
import { blurPlate, meanLuma } from "./assets/plates.ts";
import { TIGHT_CAP_SECONDS } from "./assets/officialTrailer.ts";
import { cardWindow } from "./render/shortcraft.ts";
import { CLIP_DETAIL_FLOOR_KB, clipDetailKb, stillBigText } from "./assets/cliptext.ts";
import { framesNeeded } from "./qa/mediarich.ts";
import {
  argumentArm,
  cardFigureProblems,
  eraConflict,
  lineNamesLaterVersion,
  sourceTag,
  endingProblems,
  evergreenRuleNote,
  shortRuleNote,
  thinProblems,
} from "./editorial/shortrules.ts";
import { scorePlan, rubricSummary } from "./qa/rubric.ts";
import {
  captureMetrics,
  captureRetention,
  hookLessons,
  longLessons,
  captureCurves,
  captureReach,
  reachAlert,
  performanceNotes,
  retentionNotes,
  socialLessons,
  visualLessons,
} from "./analytics.ts";
import {
  deskShareNow,
  experimentVerdicts,
  mascotFor,
  mascotShareNow,
  primeTimeVerdict,
  rumoursPerDayNow,
} from "./experiments.ts";
import {
  growthAssign,
  growthDefaults,
  growthNotes,
  growthProblems,
  growthVerdict,
} from "./growth.ts";
import { holdSlotForCap, holdWhyForCap } from "./cadence.ts";
import {
  refreshChatter,
  bigCluster,
  coveredHashes,
  EDITOR_REPEAT,
  noteEditorRepeat,
  readEditorRepeats,
  runEntryCovered,
  bigEditorNote,
  bigMadeToday,
  bumpFiller,
  currentStories,
  judgeBigStories,
  recentCover,
  recordVerdicts,
  type BigVerdict,
} from "./bigstories.ts";
import {
  breakingAllowance,
  breakingHeldLine,
  breakingScore,
  whySlotsAhead,
} from "./storymix.ts";
import {
  fitDescription,
  recentShortTexts,
  repetitionProblems,
} from "./authenticity.ts";
import { followFor } from "./youtube/longlink.ts";
import {
  dbDemandCache,
  demandFor,
  demandLine,
  rankByDemand,
  type Demand,
} from "./discovery/searchdemand.ts";
import { slotLabel } from "./cadence.ts";
import { recentWhyHooks, sameGame } from "./editorial/why.ts";
import { mediaRichNotice, shortMediaRichness } from "./qa/mediarich.ts";
import { craftForShort, shortsCleanStep } from "./shortcraftstep.ts";
import { arbitrate, overlaySpans, shortLayout } from "./render/cleanframe.ts";
import {
  cardRequirement,
  entryCardProblems,
  entryHolds,
  fitRequirement,
} from "./render/rankcard.ts";
import {
  normTitle as normRankTitle,
  patchSpoilers,
  spoilerProblems,
  underFigure,
} from "./editorial/spoilers.ts";
import { ccCredit } from "./render/cleanframe.ts";
import { offendingMedia, dropOffending } from "./qa/retry.ts";
import { shortSampleTimes, framesNamed } from "./qa/vision.ts";
import {
  checkFrame,
  clearOfEntrances,
  graphicChecks,
  graphicsNotice,
  badTextAlert,
  badTextMutes,
  judgeGraphics,
  muteFaults,
  passDecision,
} from "./qa/graphicscheck.ts";
import { releaseGateStep } from "./qa/releaseGate.ts";
import { releaseWriterNotes, writerNoteHits } from "./editorial/writernotes.ts";
import { guardScript, stopForWriterNotes } from "./writerguard.ts";
import { planSlate } from "./qa/slate.ts";
import { distinguishing, sameNumberedGame } from "./assets/commons.ts";
import { mergeArticles } from "./discovery/wikipedia.ts";
import {
  GatherBudget,
  GatherOutOfTime,
  reportGatherStop,
} from "./assets/gatherbudget.ts";
import {
  LONG_LEASE,
  LONG_URGENT_HOURS,
  isUrgentLong,
  orderLongEpisodes,
} from "./longlane.ts";
import { titleVariants } from "./editorial/titles.ts";
import { pickBreakoutDoc } from "./docpick.ts";
import {
  HYPE_COMMENT_LINE,
  HYPE_END_LINE,
  hypeAllowed,
} from "./youtube/hype.ts";
import { pulseCheckProblems } from "./editorial/newssegment.ts";
import { rankingSequels, sequelWinners } from "./sequels.ts";
import { markEvidence } from "./editorial/evidence.ts";
import { applyTitleShape, writerTitleProblems } from "./titlestep.ts";
import { paletteOf } from "./assets/palette.ts";
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
  publishTimes,
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
import { cleanBookends, cutSentences, resolveTestRecords, testOutlineNote, unbackedTestClaims, withTestRecords } from "./editorial/testevidence.ts";
import { calendarBlock, readCalendar, type CalendarLane } from "./calendar.ts";
import {
  docRunDue,
  readRun,
  runRepeatGame,
  whyRunEntry,
  type RunWhy,
} from "./shortrun.ts";
import { stampColour } from "./render/brand.ts";
import { chooseWordLook, motifIdFor, wordSoundCue } from "./render/wordlook.ts";
import {
  translateScript,
  twinFooter,
  twinNarration,
} from "./editorial/twin.ts";
import {
  captionable,
  gameplayScript,
  gameplayWindow,
  GameplayReviewSchema,
  writeWhole,
  type GameplayReview,
  articleFields,
  cleanWindow,
  hdrFilter,
  isRehearsal,
  minScoreFor,
  parseBlackSpans,
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
import { pruneForSpace } from "./retention.ts";
import { finishChapters } from "./youtube/chapters.ts";
import { docPinnedComment } from "./youtube/pinned.ts";
import { latestPublicDocumentary, nextLine } from "./youtube/nextdoc.ts";
import { communityBlock, communityDrafts } from "./social/community.ts";
import {
  coldOpenLine,
  coldOpenTiming,
  END_CARD_SECONDS,
} from "./render/bookends.ts";
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
    opts?: { provider?: Config["voiceProvider"]; minWpm?: number },
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
  /** Freely licensed archive photos for a search: Wikimedia Commons, then Openverse and Pixabay when on. */
  searchPhotos(
    query: string,
  ): Promise<import("./assets/commons.ts").CommonsImage[]>;
  /** Publishers' press pictures of a game (src/assets/press.ts, LIBRARY_PRESS); absent in tests. */
  searchPress?(
    game: string,
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
  /** The outside calls of the footage-first gather (src/assets/footagedeps.ts); absent in tests, which skips it. */
  footageFirstDeps?(): import("./assets/footagefirst.ts").FootageFirstDeps;
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
    /** Footage first on Shorts: more clean moments up to these seconds, and the local text check. */
    fill?: { seconds?: number; textCheck?: boolean },
  ): Promise<VisualAsset[]>;
  fetchOfficialMedia(
    gameTitle: string,
    episodeDir: string,
    targets: FootageTarget[],
    maxClips: number,
    hint?: string,
    story?: { text: string; after: Date },
    fill?: { seconds?: number; textCheck?: boolean },
  ): Promise<OfficialMedia>;
  /** A tight-cap publisher's trailer as last-resort stills, once published art has been counted. */
  trailerFrames?(
    trailer: { videoId: string; title: string; channelTitle: string; url: string },
    episodeDir: string,
    gameTitle: string,
    count: number,
    textCheck: boolean,
  ): Promise<VisualAsset[]>;
  fetchStock(
    episodeDir: string,
    targets: FootageTarget[],
    gameWords: string[],
    maxClips: number,
    /** Pexels page URLs already in the video: never picked again. */
    avoidUrls?: string[],
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
  /** One YouTube search page's videos with their views, read without the API (src/discovery/searchdemand.ts); absent in tests. */
  searchDemand?(
    url: string,
  ): Promise<import("./discovery/searchdemand.ts").SearchRow[]>;
  /** A Wikipedia article's useful sections, by title or else by search (documentary research). */
  research(
    title: string,
    fallbackQuery: string,
    maxChars?: number,
    /** What the text is for: the sections that mention it come first and whole. */
    focus?: string,
  ): Promise<import("./discovery/wikipedia.ts").WikiArticle | undefined>;
  downloadImage(url: string, dest: string): Promise<boolean>;
  imageAspect(file: string): Promise<number>;
  render(input: RenderInput): Promise<void>;
  renderLong(input: LongRenderInput): Promise<void>;
  /** Single frames of the long composition for the graphics check before the render (absent in tests). */
  renderLongStills?(input: LongStillsInput): Promise<void>;
  renderCutdown?: typeof renderCutdown;
  renderGameplayShort?: typeof renderGameplayShort;
  normalise(input: string, output: string): Promise<void>;
  technicalQa(
    file: string,
    expectedSeconds: number,
    band?: {
      minSeconds: number;
      maxSeconds: number;
      width?: number;
      height?: number;
      chapterStarts?: number[];
    },
  ): Promise<TechQa>;
  extractFrames(
    file: string,
    outDir: string,
    times: number[],
  ): Promise<string[]>;
  visionQa(
    frames: string[],
    ctx: {
      headline: string;
      gameTitle: string;
      format?: "short" | "long" | "graphics" | "thumbs";
      heroRule?: boolean;
      narration?: string;
      cardTexts?: string[];
    },
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

/** A gameplay card's links: with GAMEPLAY_ONE_TAP, Approve and Reject act on the tap (src/server.ts). */
export function gameplayLinks(cfg: Config, id: string) {
  const links = approvalLinks(cfg, id);
  return cfg.gameplayOneTap
    ? {
        ...links,
        approve: `${links.approve}&now=1`,
        reject: `${links.reject}&now=1`,
      }
    : links;
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
  await refreshChatter(s.db, s.cfg, now, () => s.trending()).catch((err) =>
    log("warn", "chatter read failed", { error: errorMessage(err) }),
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
  // Discovery may hold older articles for a late big story (BIG_STORY_MAX_AGE_HOURS); the usual lanes stay fresh.
  const oldest = s.now().getTime() - s.cfg.maxStoryAgeHours * 3_600_000;
  return rows
    .filter((r) => new Date(r.cluster_json.newestAt).getTime() >= oldest)
    .map((r) => ({ cluster: r.cluster_json, sighting: r }));
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
    if (cfg.whyEnabled && cfg.whyDays.includes(day))
      slots.push(...cfg.whySlots);
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
  if (await bumpFiller(db, cfg, "spare", now)) return undefined;
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
  // The explainer takes the weekly slot in turn with the recap (src/weeklytest.ts), so it shares the weekly shelf.
  if (sc.recap || sc.explained) out.push(SERIES.weekly);
  else if (sc.runtime === "long")
    out.push(
      sc.evergreen_format === "documentary" ? SERIES.docs : SERIES.rankedLong,
    );
  else if (ep.story_hash?.startsWith("why:")) out.push(SERIES.why);
  else if (
    ep.lane === "cutdown" ||
    (ep.lane === "evergreen" &&
      sc.entries?.length &&
      // A deals list or a release list has entries but ranks nothing: it stays off the rankings shelf.
      !["steam_deals", "release_radar", "steam_climbers", "weekly_recap"].includes(
        sc.evergreen_format ?? "",
      ))
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

/**
 * Files a published video in its series playlists (50 units each, plus 50 the first time a playlist is made).
 * With SERIES_PLAYLISTS on (src/seriesplaylists.ts) only a video seen public joins: a scheduled one is filed by
 * confirmPublished when it goes live, and one the owner keeps private never joins. Nothing here changes a video.
 */
export async function addToSeries(
  s: Services,
  ep: Episode,
  privacy?: string,
): Promise<void> {
  if (ep.lane === "twin") return; // the twin channel's playlists are not set up
  if (s.cfg.seriesPlaylists && privacy !== "public") return;
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
      // Filed once: the check after a scheduled video goes live must not add it a second time.
      if (
        s.cfg.seriesPlaylists &&
        (
          await s.db.query(
            `SELECT 1 FROM events WHERE episode_id = $1 AND kind = 'playlist' AND detail->>'title' = $2 LIMIT 1`,
            [ep.id, series.title],
          )
        ).length
      )
        continue;
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
  /** A big story (src/bigstories.ts): what the editor is told, and whether its pass is overruled. */
  big?: {
    note: string;
    force: boolean;
    alsoSeen: string[];
    onPass: (reason: string) => void;
    /** Our own dropped attempts at this story: never published, so not "already covered". */
    notCovered: string[];
  },
): Promise<string | undefined> {
  const { db } = s;
  const pool = candidates;
  const choice = await selectStory(
    s.llm,
    pool,
    (await recentHeadlines(db)).filter((h) => !big?.notCovered.includes(h)),
    [
      big?.note ?? "",
      focusBlock(s.cfg, s.now()),
      hotBlock(await readHotTopic(db, s.now()).catch(() => undefined)),
      calendarFor(s.cfg, s.now(), "news", 3),
      await performanceNotes(db, s.now()).catch(() => ""),
      await retentionNotes(db, s.now()).catch(() => ""),
      await socialLessons(db, s.now()).catch(() => ""),
      trendingBlock(await s.trending().catch(() => [])),
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
  let picked = pool[choice.candidate_index];
  if (!picked) {
    log("info", "editor passed on every candidate", {
      lane: lane.lane,
      reason: choice.reason,
    });
    big?.onPass(choice.reason);
    // Too big to pass, unless the editor says it has been told already.
    if (!big?.force || EDITOR_REPEAT.test(choice.reason)) return undefined;
    picked = pool[0]!;
    choice.reason = `editor overruled, the story is too big to pass: ${choice.reason}`;
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
  // Every split of a big story is the same story: none of them comes back through a news slot.
  for (const h of big?.alsoSeen ?? [])
    await markSeen(db, h, picked.headline, "big_story", "the same story as a big story made");
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
 * The big-story desk, ahead of every allowance (src/bigstories.ts): judges the day's biggest stories, records what is
 * happening to each, and makes the biggest one not yet covered. It fills a news slot when one is open, else it goes
 * out like a breaking Short. Report mode and a blocked factory still judge and record, so nothing is passed silently.
 */
let lastBigCovered = new Set<string>();

async function maybeSelectBig(
  s: Services,
  blocked?: string,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (cfg.bigStoryMode === "off") return undefined;
  const now = s.now();
  const stories = await currentStories(db, cfg, now);
  const context = {
    now,
    episodes: await recentCover(db, now),
    run: readRun(cfg.shortRunFile),
    rumoursToday: cfg.includeRumours
      ? await countRumoursToday(db, cfg.timezone)
      : 0,
    rumourCap: await rumoursPerDayNow(db, cfg),
    includeRumours: cfg.includeRumours,
    bigMadeToday: await bigMadeToday(db, cfg.timezone),
    editorRepeats: await readEditorRepeats(db, now),
    ...(blocked ? { blocked } : {}),
  };
  const verdicts = judgeBigStories(stories, cfg, context);
  lastBigCovered = coveredHashes(verdicts);
  const make = verdicts.find((v) => v.action === "make");
  if (make) {
    // The quota is the one limit a big story cannot overrule: an upload past it just fails.
    const headroom = await quotaHeadroom(db, cfg, now);
    if (headroom < QUOTA_RESERVE_FOR_UPLOAD) {
      make.action = "held";
      make.reason = `YouTube's upload quota for today is spoken for (${headroom} units spare)`;
    }
  }
  await recordVerdicts(db, cfg, verdicts, now);
  if (!make || make.action !== "make") return undefined;
  return createBig(s, make);
}

/** One editor call per story every three hours: a pass is reported, not retried each tick. */
async function createBig(s: Services, v: BigVerdict): Promise<string | undefined> {
  const { db, cfg } = s;
  const now = s.now();
  const bucket = Math.floor(now.getTime() / (3 * 3_600_000));
  if (await weeklyTried(db, `big:${v.story.key}:${v.attempt}:${bucket}`)) return undefined;
  const cluster = bigCluster(v, now);
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
  // A follow-up to a story already covered is the editor's call, however big.
  const force = v.story.size >= cfg.bigStoryHuge && !v.development;
  let passed: string | undefined;
  const id = await createFromChoice(
    s,
    [cluster],
    slot
      ? { lane: "news", priority: LANE_PRIORITY.news, slotAt: slot }
      : { lane: "news_breaking", priority: LANE_PRIORITY.news_breaking },
    `big story: size ${v.story.size} (${v.story.why})`,
    {
      note: bigEditorNote(v.story),
      force,
      alsoSeen: v.story.hashes,
      onPass: (reason) => {
        passed = reason;
      },
      notCovered: (await recentCover(db, now))
        .filter(
          (e) =>
            e.story_json.bigStory?.key === v.story.key &&
            (e.status === "failed" || e.status === "rejected"),
        )
        .flatMap((e) => [e.story_json.headline, e.script_headline ?? ""]),
    },
  );
  if (!id) {
    if (passed !== undefined && EDITOR_REPEAT.test(passed))
      await noteEditorRepeat(db, v.story.key, passed, now);
    if (passed !== undefined)
      await recordVerdicts(
        db,
        cfg,
        [{ ...v, action: "held", reason: `the editor passed on it: ${passed.slice(0, 200)}` }],
        now,
      );
    return undefined;
  }
  if (!slot) {
    const ep = await getEpisode(db, id);
    await db.query(
      `INSERT INTO breaking_log (story_hash, franchise, episode_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [ep!.story_hash, franchiseKey(ep!.story_json), id],
    );
  }
  await recordVerdicts(db, cfg, [{ ...v, action: "made", reason: "in production", episode: id }], now);
  await s.notify({
    level: "info",
    content: `Big story picked: "${v.story.headline}" (size ${v.story.size}: ${v.story.outlets.length} outlets, ${v.story.articles} articles)${cluster.bigStory?.lateHours ? `, ${cluster.bigStory.lateHours} hours old, so the angle is what has happened since` : ""}.`,
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
  // A big story that cannot go yet is still judged and recorded; a fault here must never stop the usual lanes.
  const bigStep = (blocked?: string) =>
    maybeSelectBig(s, blocked).catch((err) => {
      log("warn", "big story desk failed", { error: errorMessage(err) });
      return undefined;
    });
  if (paused) {
    log("info", "story selection paused", { reason: paused });
    await bigStep(`story selection is paused: ${paused}`);
    return undefined;
  }
  if ((await countProducing(db)) >= cfg.maxProducing) {
    await bigStep(`waiting: ${cfg.maxProducing} Shorts are already in production`);
    return undefined;
  }
  const big = await bigStep();
  if (big) return big;
  const cut = await maybeSelectCutdown(s).catch((err) => {
    log("warn", "cutdown selection failed", { error: errorMessage(err) });
    return undefined;
  });
  if (cut) return cut;
  // Spare-quota Shorts are extra: they never take one of the day's planned Shorts. Nor does a big story, and a long
  // video is not a Short at all (4 Nov 2026: a documentary and a ranking used up the 22:00 slot's turn, silently).
  const total =
    (await countToday(db, cfg.timezone)) -
    (await countSpareToday(db, cfg.timezone)) -
    (await bigMadeToday(db, cfg.timezone)) -
    (cfg.dailyTargetShortsOnly
      ? await countToday(db, cfg.timezone, "longform")
      : 0);
  if (total >= cfg.dailyTarget + (launchWave(cfg, now) ? cfg.sprintExtra : 0))
    return (await maybeSelectSpare(s)) ?? undefined;

  const seen = await seenHashes(db);
  const sightings = (await recentSightings(s)).filter(
    (x) =>
      !seen.has(x.cluster.hash) &&
      // A story the big-story desk has made or sees planned is not picked again by a slot under another of its hashes.
      !(cfg.bigStoryMode === "make" && lastBigCovered.has(x.cluster.hash)),
  );
  // Rumours are capped a day: once today's is in, stories carrying rumour signals wait for tomorrow.
  const rumoursToday = cfg.includeRumours
    ? await countRumoursToday(db, cfg.timezone)
    : 0;
  const rumourCap = await rumoursPerDayNow(db, cfg); // the leak verdict may have lowered it (src/experiments.ts)
  const eligible = sightings
    .filter(
      (x) =>
        x.cluster.corroborated ||
        (cfg.includeRumours && x.cluster.rumourSignals),
    )
    .filter((x) => !(x.cluster.rumourSignals && rumoursToday >= rumourCap))
    .filter((x) => x.cluster.score > 0);

  // 1. Breaking lane. During a live showcase (a Direct, a State of Play) it sprints: a few more
  // Shorts that day and a lower bar for the showcase's own stories, but only while the quota still
  // covers every upload already scheduled for today.
  const showcase = showcaseLive(eligible, now);
  const wave = launchWave(cfg, now);
  const sprint =
    (!!showcase || wave) &&
    (await quotaHeadroom(db, cfg, now)) >= QUOTA_RESERVE_FOR_UPLOAD;
  // One a day; a second only for a very big story (BREAKING_BIG_SCORE, src/storymix.ts).
  const allowance = breakingAllowance(
    await countToday(db, cfg.timezone, "news_breaking"),
    cfg.breakingPerDay + (sprint ? cfg.sprintExtra : 0),
    cfg.breakingBigScore,
  );
  if (cfg.breakingEnabled && allowance.open) {
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
    const qualified = eligible.filter(
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
    );
    const big = qualified.filter(
      (x) => breakingScore(x.cluster, x.sighting) >= allowance.minScore,
    );
    // A story that would have broken but for the one-a-day rule: logged, and one evening-summary line a day.
    const passed = qualified.find((x) => !big.includes(x));
    if (
      passed &&
      !(await weeklyTried(db, `breaking_held:${dayKey(now, cfg.timezone)}`))
    ) {
      const score = breakingScore(passed.cluster, passed.sighting);
      await logEvent(db, null, "breaking_held", {
        headline: passed.cluster.headline,
        score,
        bar: allowance.minScore,
      });
      await s.notify({
        level: "info",
        content: breakingHeldLine(
          passed.cluster.headline,
          score,
          cfg.breakingPerDay,
          allowance.minScore,
        ),
      });
    }
    const breaking = big.map((x) => x.cluster).slice(0, 4);
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
  // SHORTS_PER_DAY_MAX (src/cadence.ts): once the day's news allowance is used, the slot is held back and the
  // stories that were waiting for it are named once in the evening summary. The slot also leaves room for
  // the Why slots still to come today (story first, src/storymix.ts).
  const capped =
    !!slot &&
    (await holdSlotForCap(
      db,
      cfg,
      now,
      slot,
      eligible.map((x) => ({
        headline: x.cluster.headline,
        score: x.cluster.score,
      })),
      (m) => s.notify(m),
      whySlotsAhead(cfg, now, await takenSlots(db)),
    ).catch((err) => {
      log("warn", "news cap check failed", { error: errorMessage(err) });
      return false;
    }));
  if (!slot || capped)
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
  if (await bumpFiller(db, cfg, "evergreen", now)) return undefined;
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
  // Ranked by recent YouTube demand, topics with none skipped (src/discovery/searchdemand.ts).
  const { candidates, demand, skipped } = await demandRanked(
    s,
    await s.discoverEvergreen(),
  );
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
  const pickedDemand = demand.get(candidates[topic.candidate_index]!.name);
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
    demand: pickedDemand ?? null,
    demand_skipped: skipped.map((c) => c.name),
    slot_at: due.toISOString(),
  });
  await reportDemand(
    s,
    `ranking Short at ${slotLabel(due, s.cfg.timezone)}`,
    topic.theme,
    pickedDemand,
    skipped.length,
  );
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
const WHY_DROP_RETRIES = 2;

/**
 * A Why Short from the launch run. The topic, its sources and its angle come from the plan, so the editor, the
 * two-week freshness rule and the demand check stay out of it; the writer and the fact check run as usual against
 * the entry's own sources. With no source readable there is nothing to check against, so the slot goes to the editor.
 */
export async function selectRunWhy(
  s: Services,
  e: RunWhy,
  due: Date,
): Promise<string | undefined> {
  const now = s.now();
  const read = await Promise.all(
    e.sources.map((u) => s.fetchArticle(u.url).catch(() => undefined)),
  );
  const items = e.sources
    .map((u, i) => ({ u, a: read[i] }))
    .filter((x) => x.a)
    .map(({ u, a }) => ({
      title: a!.title,
      url: u.url,
      summary: "",
      publishedAt: now.toISOString(),
      source: u.source,
      sourceKind: u.official ? ("official" as const) : ("outlet" as const),
    }));
  if (!items.length) {
    log("warn", "launch run topic has no readable source", { topic: e.question });
    return undefined;
  }
  const follow = await followFor(s.db, e.game, now).catch(() => ({
    kind: "series" as const,
  }));
  const cluster: StoryCluster = {
    hash: `why:${whySlug(e.question)}`,
    headline: e.title,
    items,
    sources: [...new Set(items.map((i) => i.source))],
    hasOfficial: items.some((i) => i.sourceKind === "official"),
    corroborated: true,
    rumourSignals: false,
    newestAt: now.toISOString(),
    score: 0,
    gameHint: e.game,
    visualNeed: "game_footage",
    run: true,
    why: { question: e.question, angle: e.angle, arc: e.arc, follow },
  };
  const id = shortId();
  if (
    !(await createEpisode(s.db, id, cluster, {
      lane: "news",
      priority: LANE_PRIORITY.news,
      slotAt: due,
    }))
  )
    return undefined;
  await logEvent(s.db, id, "selected", {
    headline: e.title,
    lane: "why",
    run: true,
    question: e.question,
    game: e.game,
    slot_at: due.toISOString(),
  });
  log("info", "launch run topic selected", { id, question: e.question });
  return id;
}

export async function maybeSelectWhy(s: Services): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.whyEnabled) return undefined;
  const now = s.now();
  // WHY_SLOTS: the first slot whose lead time has begun and no episode has taken (src/storymix.ts).
  const taken = await takenSlots(db);
  const due = cfg.whySlots
    .map((slot) =>
      evergreenDue(
        now,
        {
          days: cfg.whyDays,
          slot,
          leadMinutes: cfg.slotLeadMinutes + 30,
          graceMinutes: cfg.slotGraceMinutes,
          timeZone: cfg.timezone,
        },
        taken,
      ),
    )
    .find((d): d is Date => !!d);
  if (!due) return undefined;
  // One editor call per slot: a pass is not retried every tick. A pick dropped for failing its fact-check gets
  // a fresh game instead, up to WHY_DROP_RETRIES (1 Nov 2026: Diablo II failed at 16:55 and 18:30 went empty).
  const dropped = await db.query<{ game: string | null }>(
    `SELECT story_json->>'gameHint' AS game FROM episodes
      WHERE story_hash LIKE 'why:%' AND status = 'rejected'
        AND created_at > $1::timestamptz - interval '3 hours'`,
    [now],
  );
  if (dropped.length > WHY_DROP_RETRIES) return undefined;
  const tryKey = `why:${due.toISOString()}${dropped.length ? `:${dropped.length}` : ""}`;
  if (await weeklyTried(db, tryKey)) return undefined;
  // The news slots already gave way to this one; it is held only once the cap itself is reached.
  if (
    await holdWhyForCap(db, cfg, now, due, (m) => s.notify(m)).catch(
      () => false,
    )
  )
    return undefined;
  // A topic planned for this slot (the launch run, src/shortrun.ts) goes first; with none usable the editor picks.
  let planned = whyRunEntry(readRun(cfg.shortRunFile), due, cfg.timezone);
  // The news got there first: a big Short already said it, so the slot goes to the editor's pick.
  const beaten =
    planned && cfg.bigStoryMode === "make"
      ? runEntryCovered(planned, await recentCover(db, now), now)
      : undefined;
  if (planned && beaten) {
    log("info", "planned Why gives way to a big story already made", {
      topic: planned.title,
      episode: beaten.id,
    });
    await logEvent(db, beaten.id, "run_topic_superseded", { topic: planned.title });
    planned = undefined;
  }
  if (planned) {
    const made = await selectRunWhy(s, planned, due).catch((err) => {
      log("warn", "launch run topic failed", {
        topic: planned.question,
        error: errorMessage(err),
      });
      return undefined;
    });
    if (made) return made;
  }
  // Only a free pick gives way to a big story: a planned run topic never does.
  if (await bumpFiller(db, cfg, "why", now)) return undefined;
  const covered = (
    await db.query<{ headline: string }>(
      `SELECT story_json->>'headline' AS headline FROM episodes WHERE story_hash LIKE 'why:%' AND created_at > $1::timestamptz - interval '120 days'`,
      [now],
    )
  ).map((r) => r.headline);
  // Freshness (WHY_FRESH_DAYS, src/editorial/why.ts): no game or topic of the last two weeks' Why Shorts.
  const fresh = await db.query<{ game: string | null; hash: string }>(
    `SELECT story_json->>'gameHint' AS game, story_hash AS hash FROM episodes
      WHERE story_hash LIKE 'why:%' AND status NOT IN ('failed','rejected')
        AND created_at > $1::timestamptz - ($2 || ' days')::interval`,
    [now, String(cfg.whyFreshDays)],
  );
  const recent = {
    games: fresh.map((r) => r.game ?? "").filter(Boolean),
    slugs: fresh.map((r) => r.hash.replace(/^why:/, "")),
  };
  recent.games.push(...dropped.map((r) => r.game ?? "").filter(Boolean));
  // Well-loved games with a story arc first (WHY_SEEDS), then the evergreen list; recent games left out.
  const base = whyCandidates(
    await s.discoverEvergreen(),
    dayKey(now, cfg.timezone),
  ).filter((c) => !recent.games.some((g) => sameGame(g, c.name)));
  const { candidates, demand, skipped } = await demandRanked(s, base);
  if (!candidates.length) return undefined;
  const demandText = await topicDemand(s, "why");
  let topic = await selectWhyTopic(
    s.llm,
    candidates,
    covered,
    demandText,
    recent.games,
  );
  let stale =
    topic.candidate_index >= 0
      ? whyFreshProblems(topic, recent, cfg.whyFreshDays)
      : [];
  if (stale.length) {
    // One more low-tier call with the reason; a second miss passes on the slot.
    topic = await selectWhyTopic(
      s.llm,
      candidates,
      covered,
      demandText,
      recent.games,
      stale,
    );
    stale =
      topic.candidate_index >= 0
        ? whyFreshProblems(topic, recent, cfg.whyFreshDays)
        : [];
  }
  if (topic.candidate_index < 0 || stale.length) {
    log("info", "editor passed on every why question", {
      reason: stale.length ? stale.join(" ") : topic.reason,
    });
    await logEvent(db, null, "why_passed", {
      slot_at: due.toISOString(),
      reason: stale.length ? stale.join(" ") : topic.reason,
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
  const slug = whySlug(topic.question);
  // The reason to follow in the last line: our documentary or ranking on the game, else the series.
  const follow = await followFor(db, topic.game, now).catch(() => ({
    kind: "series" as const,
  }));
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
    why: {
      question: topic.question,
      angle: topic.angle,
      arc: topic.arc,
      follow,
    },
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
  const picked = candidates[topic.candidate_index];
  const pickedDemand = picked ? demand.get(picked.name) : undefined;
  await logEvent(db, id, "selected", {
    headline: topic.title,
    lane: "why",
    question: topic.question,
    game: topic.game,
    arc: topic.arc,
    follow,
    reason: topic.reason,
    demand: pickedDemand ?? null,
    demand_skipped: skipped.map((c) => c.name),
    slot_at: due.toISOString(),
  });
  await reportDemand(
    s,
    `Why Short at ${slotLabel(due, cfg.timezone)}`,
    topic.game,
    pickedDemand,
    skipped.length,
  );
  log("info", "why question selected", {
    id,
    question: topic.question,
    game: topic.game,
  });
  return id;
}

/**
 * Candidates ranked by recent YouTube demand, the topics with none left out (src/discovery/searchdemand.ts).
 * With DEMAND_CHECK off or no search service (tests), the list is unchanged.
 */
async function demandRanked(
  s: Services,
  base: EvergreenCandidate[],
): Promise<{
  candidates: EvergreenCandidate[];
  demand: Map<string, Demand>;
  skipped: EvergreenCandidate[];
}> {
  if (!s.cfg.demandCheck || !s.searchDemand)
    return { candidates: base, demand: new Map(), skipped: [] };
  const demand = await demandFor(base, {
    search: (url) => s.searchDemand!(url),
    cache: dbDemandCache(s.db, () => s.now()),
    lookups: s.cfg.demandLookups,
    minViews: s.cfg.demandMinViews,
    now: s.now(),
  }).catch((err) => {
    log("warn", "demand check failed", { error: errorMessage(err) });
    return new Map<string, Demand>();
  });
  const { kept, skipped } = rankByDemand(base, demand, s.cfg.demandMinViews);
  if (skipped.length)
    log("info", "topics skipped for no recent YouTube demand", {
      skipped: skipped.map((c) => c.name),
    });
  return { candidates: kept, demand, skipped };
}

/** A pick's one Discord line about its demand; none when the check is off. */
async function reportDemand(
  s: Services,
  lane: string,
  picked: string,
  d: Demand | undefined,
  skipped: number,
): Promise<void> {
  if (!s.cfg.demandCheck || !s.searchDemand) return;
  await s
    .notify({ content: demandLine(lane, picked, d, skipped) })
    .catch(() => undefined);
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
      // An achievement Steam gives no description for can't say what it asks: it stays out, never made up.
      const list = rarest(
        (await s.achievements(app.appId)).filter((a) => a.description.trim()),
        ACHIEVEMENT_ENTRIES,
      );
      if (list.length < (across ? 1 : ACHIEVEMENT_ENTRIES)) continue;
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
          .slice(0, ACHIEVEMENT_ENTRIES)
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
            `- ${r.name} | ${r.game}${r.year ? ` (${r.year})` : ""} | ${r.percent}% of players | ${r.description}`,
        )
        .concat(
          `Hook figure: every achievement here is held by under ${underFigure(rows.map((r) => r.percent))}% of players. The hook may use that; it never gives the rarest one's percentage.`,
        )
        .join("\n");
      const achievements = rows.map((r) => ({
        name: r.name,
        game: r.game,
        percent: r.percent,
        icon: r.icon,
        year: r.year,
        description: r.description,
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
  if (
    dealsDue &&
    !(await bumpFiller(db, cfg, "deals", now)) &&
    !(await weeklyTried(db, `deals:${today}`))
  ) {
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
      {
        ...plan(cfg.recapDays),
        // The weekly shape test (src/weeklytest.ts): both arms start early enough for a 15-20 minute explainer.
        leadMinutes: cfg.weeklyExplainedTest
          ? Math.max(300, cfg.weeklyExplainedLeadMinutes)
          : 300,
      },
      taken,
    );
    if (longDue && !(await weeklyTried(db, `recaplong:${today}`))) {
      // An explainer week (src/weeklytest.ts) makes one story in depth; with no story strong and safe enough,
      // the round-up below takes the slot and counts as a round-up week.
      let fallback: string | undefined;
      if (
        (await weeklyArm(db, cfg, now, (m) => s.notify(m)).catch(
          () => "roundup" as const,
        )) === "explained"
      ) {
        const made = await selectExplainedEpisode(s, now, longDue, today).catch(
          (err) => ({ id: undefined, reason: errorMessage(err) }),
        );
        if (made.id) return made.id;
        fallback = made.reason ?? "no story";
        log("info", "weekly explainer fell back to the round-up", { reason: fallback });
        await s.notify({ content: fallbackNotice(fallback) }).catch(() => undefined);
      }
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
          await recordWeeklyArm(db, cfg, id, "roundup", now, fallback).catch(
            () => undefined,
          );
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
  // A long video planned by date (the launch run, src/shortrun.ts): started early enough to be finished and
  // scheduled well ahead, so the PC is free when it goes out.
  let plannedDoc = docRunDue(
    readRun(cfg.shortRunFile),
    now,
    await takenSlots(db),
    cfg.timezone,
  );
  // A planned documentary built on our own tests needs enough approved ones (DOC_TEST_EVIDENCE); without them it does
  // not run at all, once told, and the slot goes back to the usual lanes.
  if (plannedDoc?.entry.min_evidence || plannedDoc?.entry.evidence?.length) {
    const entry = plannedDoc.entry;
    const { records, refused } = cfg.docTestEvidence
      ? await resolveTestRecords(db, entry.evidence ?? [], entry.franchise)
      : { records: [], refused: ["DOC_TEST_EVIDENCE is off"] };
    if (records.length < Math.max(1, entry.min_evidence ?? 1)) {
      if (!(await weeklyTried(db, `doc_evidence:${entry.date}:${entry.slot}`)))
        await s.notify({
          content: `"${entry.title}" will not run: ${records.length} usable test${records.length === 1 ? "" : "s"}, ${entry.min_evidence ?? 1} needed.${refused.length ? ` Not used: ${refused.join("; ").slice(0, 900)}.` : ""}`,
        });
      plannedDoc = undefined;
    } else {
      plannedDoc.topic.test_records = records;
      if (refused.length)
        await s.notify({
          level: "info",
          content: `"${entry.title}": tests not used: ${refused.join("; ").slice(0, 900)}.`,
        });
    }
  }
  // The monthly documentary on its own week and day; otherwise, while ElevenLabs credits would be lost at
  // the reset, a banked one: made overnight now, while the credits are there, and scheduled for the next
  // free documentary evening, weeks ahead if need be (the owner's idea, 25 Oct 2026).
  let due = plannedDoc
    ? plannedDoc.at
    : cfg.docWeeks.includes(weekOfMonth(now, cfg.timezone))
    ? evergreenDue(
        now,
        {
          days: cfg.docDays,
          slot: cfg.docSlot,
          leadMinutes: Math.max(cfg.docLeadMinutes, cfg.longLeadMinutes),
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
  // The breakout picker (src/docpick.ts, DOC_BREAKOUT_PICKER) scores every candidate and takes the best with no
  // model call; the writer's pick from the lists stays the fallback.
  const breakout = plannedDoc
    ? undefined
    : s.cfg.docBreakoutPicker
    ? await pickBreakoutDoc(s).catch((err) => {
        log("warn", "breakout documentary picker failed", {
          error: errorMessage(err),
        });
        return undefined;
      })
    : undefined;
  const topic =
    plannedDoc?.topic ??
    breakout?.topic ??
    (await selectDocTopic(
    s.llm,
    covered,
    inTheNews,
    undefined,
    undefined,
    await topicDemand(s, "doc"),
    ));
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
  if (breakout) {
    await logEvent(db, id, "doc_pick", breakout.detail);
    await s.notify({ level: "info", content: breakout.line });
  }
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
 * More to write from: the chapter's own article at greater length, the story's main article and the other articles
 * the outline names. A chapter short of evidence gets this rather than a tighter restriction.
 */
export async function widerDocSource(
  s: Pick<Services, "research">,
  plan: { wiki_title: string; game_title: string; year: number; focus: string; chapter_title: string },
  mainTitle: string | undefined,
  otherTitles: readonly string[],
): Promise<import("./discovery/wikipedia.ts").WikiArticle | undefined> {
  const focus = `${plan.chapter_title} ${plan.focus}`;
  const titles = [
    ...new Set(
      [plan.wiki_title, mainTitle, ...otherTitles].filter(
        (t): t is string => Boolean(t),
      ),
    ),
  ].slice(0, 4);
  const found: Array<import("./discovery/wikipedia.ts").WikiArticle> = [];
  for (const [i, title] of titles.entries()) {
    const a = await s
      .research(
        title,
        i === 0 ? `${plan.game_title} ${plan.year} video game` : title,
        DOC_WIDE_SOURCE_CHARS,
        focus,
      )
      .catch(() => undefined);
    if (a) found.push(a);
  }
  return mergeArticles(found);
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
  // Our own tests as a source, for this documentary alone and under a stricter check (src/editorial/testevidence.ts).
  const records = s.cfg.docTestEvidence ? (topic.test_records ?? []) : [];
  const strict = records.length > 0;
  // The Inspiration rules (src/editorial/longrules.ts), all off by default; a guide is a planned entry's own format.
  const rules = longRulesFor(s.cfg, "documentary", topic.format === "guide");
  // A planned entry's own sources, beside each chapter's article, so a verdict can name who said it.
  const runSources = await readRunSources(s, topic);
  const withRunSources = (a: import("./discovery/wikipedia.ts").WikiArticle) =>
    runSources.text ? { ...a, text: `${a.text}\n\n${runSources.text}` } : a;
  // A single story starts from its overview article; a franchise from the series article.
  const franchiseArticle = await s.research(
    topic.wiki ?? topic.franchise,
    topic.kind === "story"
      ? topic.franchise
      : `${topic.franchise} video game series`,
    DOC_OUTLINE_SOURCE_CHARS,
  );
  const franchise = franchiseArticle
    ? withRunSources(withTestRecords(franchiseArticle, records))
    : franchiseArticle;
  const outline = await outlineDoc(
    s.llm,
    topic,
    `${franchise?.text ?? ""}${strict ? testOutlineNote(records) : ""}`,
    { openLoops: s.cfg.docOpenLoops, rules },
  );
  // The questions it raises and answers (src/editorial/openloops.ts), kept only when they can work.
  const openLoops = s.cfg.docOpenLoops
    ? groundOpenLoops(outline.open_loops, outline.chapters.length, {
        max: rules.loopsMax,
        coldOpen: rules.loopsMax ? Math.max(2, rules.hookStack) : 0,
      })
    : { loops: [], removed: [] };
  // A rule-led revision is one call; a video gets a few at most, then a miss is a style warning (longRuleWarnings).
  let ruleRevisions = LONG_RULE_REVISIONS;
  // An earlier documentary on the same franchise: its wording and opening are not reused.
  const priorDoc = await priorDocNarration(s.db, ep.id, topic.franchise).catch(
    () => undefined,
  );
  const chapters: DocDraft["chapters"] = [];
  const warnings: string[] = [];
  // A sandbox writes only the opening chapters (DOC_SANDBOX_CHAPTERS, 0 in production).
  for (const [index, plan] of (s.cfg.docSandboxChapters
    ? outline.chapters.slice(0, s.cfg.docSandboxChapters)
    : outline.chapters
  ).entries()) {
    const article = await s.research(
      plan.wiki_title,
      `${plan.game_title} ${plan.year} video game`,
      DOC_CHAPTER_SOURCE_CHARS,
      `${plan.chapter_title} ${plan.focus}`,
    );
    if (!article) {
      warnings.push(
        `No Wikipedia article for ${plan.game_title}; chapter dropped.`,
      );
      continue;
    }
    let source = withRunSources(withTestRecords(article, records));
    let widened = false;
    // Short of evidence: more to write from, on the first sign. A refusal or a list of unsupported lines is what a
    // thin brief produces; asking again with the same brief and a tighter rule turned a chapter into its own refusal.
    const widen = async () => {
      if (widened) return;
      widened = true;
      const wider = await widerDocSource(
        s,
        plan,
        topic.wiki ?? franchiseArticle?.title,
        outline.chapters.map((c) => c.wiki_title),
      ).catch(() => undefined);
      if (wider) source = withRunSources(withTestRecords(wider, records));
      await logEvent(s.db, ep.id, "doc_source_widened", {
        chapter: index + 1,
        also: wider?.also ?? [],
        chars: source.text.length,
      });
    };
    let feedback: string[] = [];
    let chapter: import("./editorial/documentary.ts").DocChapter | undefined;
    // In a documentary with records: what is still unsupported after the rewrites, and whether the check ever ran.
    let stillUnsupported: string[] = [];
    let checkRan = false;
    // Only the rules asked for this revision: if its edits don't land the draft stands, and it isn't checked again.
    let ruleOnly = false;
    let attempts = 3;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const previous = chapter;
      chapter = await writeChapter(s.llm, {
        franchise: topic.franchise,
        plan,
        index,
        outline,
        source,
        previousEnding: chapters.at(-1)?.chapter.paragraphs.at(-1)?.narration,
        feedback,
        earlier: chapters,
        priorDoc,
        // A refusal is not a draft to patch: it is written again from the wider sources.
        draft:
          attempt > 0 && chapter && !chapterRefusal(chapter).length
            ? chapter
            : undefined,
        loops: openLoops.loops,
        rules,
        keepDraft: ruleOnly,
      });
      if (ruleOnly && chapter === previous) break;
      // The writer says it can't, or wrote notes instead: no fact check to spend, more sources and again.
      const refused = chapterRefusal(chapter);
      if (refused.length && s.cfg.writerNotesGuard) {
        await logEvent(s.db, ep.id, "doc_chapter_refused", {
          chapter: index + 1,
          attempt,
          why: refused.slice(0, 3),
        });
        // Its last try may be the first to refuse: the wider sources always get one go.
        if (!widened) attempts = Math.max(attempts, attempt + 2);
        await widen();
        feedback = [
          "The SOURCE below now holds more of the record. Tell the chapter from it, as a story.",
          ...refused,
        ];
        continue;
      }
      const problems = validateChapter(chapter, {
        earlier: chapters,
        priorDoc,
        loops: openLoops.loops,
        chapter: index + 1,
      });
      // A note to the editor instead of narration goes back every time (DOC_META_GUARD).
      if (s.cfg.docMetaGuard)
        problems.push(
          ...writerNoteProblems(
            chapter.paragraphs.map((x) => x.narration).join(" "),
          ),
        );
      // The rules read the first draft only, so each costs one revision at most.
      let misses: string[] = [];
      if (attempt === 0 && ruleRevisions > 0) {
        misses = chapterRuleProblems(chapter, {
          rules,
          written: chapters.map((c) =>
            c.chapter.paragraphs.map((x) => x.narration).join(" "),
          ),
          loops: openLoops.loops,
          chapter: index + 1,
        });
        if (misses.length) {
          ruleRevisions--;
          problems.push(...misses);
        }
      }
      let unsupported: string[];
      if (strict) {
        const items = await checkChapterItems(s.llm, chapter, source).catch(
          (err) => {
            log("warn", "documentary fact check failed", {
              error: errorMessage(err),
            });
            return undefined;
          },
        );
        checkRan = items !== undefined;
        const unbacked = chapter.paragraphs.flatMap((p) =>
          unbackedTestClaims(p.narration, records),
        );
        stillUnsupported = [...(items ?? []).map((u) => u.quote), ...unbacked];
        unsupported = [
          ...(items ?? []).map((u) => `"${u.quote}": ${u.problem}`),
          ...unbacked.map(
            (q) => `"${q}": it reports a test of ours with no record behind it`,
          ),
          ...(items ? [] : ["The fact check could not run on this draft."]),
        ];
      } else
        unsupported = await checkChapter(s.llm, chapter, source).catch(
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
      ruleOnly = misses.length > 0 && feedback.length === misses.length;
      if (attempt === attempts - 1)
        warnings.push(...feedback.map((f) => `${plan.game_title}: ${f}`));
      // Lines the source doesn't back: the next try has more of the record in front of it.
      else if (unsupported.length && s.cfg.writerNotesGuard) await widen();
    }
    // Still a refusal after the wider sources: this chapter can't be told, so the video stops here. Never a warning.
    if (s.cfg.writerNotesGuard) {
      const refused = chapterRefusal(chapter!);
      if (refused.length) {
        const title = outline.title;
        await logEvent(s.db, ep.id, "doc_chapter_refused", {
          chapter: index + 1,
          final: true,
          why: refused.slice(0, 3),
        });
        await s.notify({
          ping: true,
          content: `🛑 Stopped the documentary "${title}": chapter ${index + 1} ("${plan.chapter_title}") still can't be written after widening its sources. ${refused[0]!.slice(0, 300)}`,
        });
        throw new FatalError(
          `documentary chapter ${index + 1} refused after widening its sources: ${refused[0]!.slice(0, 200)}`,
        );
      }
    }
    // Still a note and not narration after every rewrite: no chapter is better than that one.
    if (
      s.cfg.docMetaGuard &&
      writerNoteProblems(
        chapter!.paragraphs.map((x) => x.narration).join(" "),
      ).length
    ) {
      warnings.push(
        `${plan.game_title}: chapter dropped, the writer returned a note instead of narration.`,
      );
      continue;
    }
    if (strict) {
      // Nothing unchecked or unsupported goes out here: no check, no chapter; unsupported sentences are cut.
      const cut = cutSentences(chapter!, stillUnsupported);
      if (!checkRan || cut.lost) {
        warnings.push(
          `${plan.game_title}: chapter dropped, ${checkRan ? "an unsupported line could not be cut" : "the fact check could not run"}.`,
        );
        continue;
      }
      if (stillUnsupported.length)
        warnings.push(
          `${plan.game_title}: ${stillUnsupported.length} unsupported line${stillUnsupported.length === 1 ? "" : "s"} cut.`,
        );
      chapter = cut.chapter;
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
          lessons: await visualLessons(s.db, s.now(), segmentInputs).catch(
            () => "",
          ),
          evidence: s.cfg.docEvidence,
          verdicts: rules.verdicts,
        }),
        source,
        outline.chapters.map((c) => c.game_title),
        sentences,
        rules.verdicts,
      );
      moments = shot.moments;
      // DOC_EVIDENCE: the key beats show the record itself, word for word from the source (src/editorial/evidence.ts).
      if (s.cfg.docEvidence) {
        const ev = markEvidence(moments, sentences, source);
        moments = ev.moments;
        if (ev.added.length)
          await logEvent(s.db, ep.id, "doc_evidence", {
            chapter: index + 1,
            added: ev.added,
          });
      }
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
  if (!s.cfg.docSandboxChapters && chapters.length < DOC_CHAPTERS_MIN)
    throw new FatalError(
      `documentary has only ${chapters.length} chapters with sources`,
    );
  const ends = {
    priorDoc,
    loops: openLoops.loops,
    echo: s.cfg.docBookendEnding,
    rules,
    chapters: chapters.map((c) =>
      c.chapter.paragraphs.map((x) => x.narration).join(" "),
    ),
  };
  let bookends = await writeBookends(
    s.llm,
    outline,
    chapters,
    franchise?.text ?? "",
    ends,
  );
  const endProblems = validateBookends(bookends, ends);
  if (endProblems.length)
    bookends = await writeBookends(
      s.llm,
      outline,
      chapters,
      franchise?.text ?? "",
      { ...ends, feedback: endProblems },
    );
  if (strict) {
    const clean = cleanBookends(bookends, records);
    bookends = clean.bookends;
    if (clean.removed.length)
      warnings.push(
        ...clean.removed.map((r) => `Bookend line with no test behind it cut: ${r}`),
      );
  }
  const draft: DocDraft = { topic, outline, chapters, bookends };
  if (s.cfg.docOpenLoops) {
    const placed = placeDocLoops(draft, openLoops.loops);
    draft.loops = placed.placed;
    warnings.push(...openLoops.removed, ...placed.removed);
    await logEvent(s.db, ep.id, "open_loops", {
      planned: openLoops.loops.length,
      placed: placed.placed,
      removed: [...openLoops.removed, ...placed.removed],
    });
    await s.notify({
      content: openLoopsLine(
        outline.title,
        placed.placed,
        openLoops.loops.length,
      ),
    });
  }
  const words = docWordCount(draft);
  if (words < DOC_WORDS_MIN || words > DOC_WORDS_MAX)
    warnings.push(
      `Documentary is ${words} words (aim ${DOC_WORDS_MIN}-${DOC_WORDS_MAX}).`,
    );
  if (warnings.length)
    await logEvent(s.db, ep.id, "style_warnings", { problems: warnings });
  // The fact check's last word used to be a line in the log nobody reads, and the FFXIV refusals were in it.
  const stillUnbacked = warnings.filter((w) => /Not supported by the source/.test(w));
  if (stillUnbacked.length)
    await s.notify({
      content: `⚠️ "${outline.title}": the fact check still disputes ${stillUnbacked.length} line${stillUnbacked.length === 1 ? "" : "s"} after the rewrites, and they stay in. First: ${stillUnbacked[0]!.slice(0, 280)}`,
    });
  if (longRulesOn(rules)) {
    const said = narrationOfDoc(draft);
    warnings.push(...longRuleWarnings(said, rules));
    await logEvent(s.db, ep.id, "long_rules", {
      kind: rules.kind,
      measures: scriptMeasures(said),
      revisionsLeft: ruleRevisions,
      hookStack: bookends.intro.hook_stack,
      runSources: runSources.read,
      runSourcesMissed: runSources.missed,
    });
  }
  const script = docToScript(draft);
  if (franchise && !script.sources?.includes(franchise.url))
    script.sources = [franchise.url, ...(script.sources ?? [])];
  for (const u of runSources.urls)
    if (!script.sources?.includes(u)) (script.sources ??= []).push(u);
  await guardScript(s, ep, script, "after writing");
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

/** A planned entry's own sources as source text under "[Outlet] title" headers (sourceCredit reads those); a page that won't open is left out and named. */
async function readRunSources(
  s: Services,
  topic: DocTopic,
): Promise<{ text: string; urls: string[]; read: number; missed: string[] }> {
  const list = topic.sources ?? [];
  if (!list.length || topic.format !== "guide" || !s.cfg.longGuideFormat)
    return { text: "", urls: [], read: 0, missed: [] };
  const got = await Promise.all(
    list.map((u) => s.fetchArticle(u.url).catch(() => undefined)),
  );
  const parts: string[] = [];
  const urls: string[] = [];
  const missed: string[] = [];
  list.forEach((u, i) => {
    const a = got[i];
    if (!a?.text?.trim()) return void missed.push(u.url);
    parts.push(`[${u.source}] ${a.title}\n${a.text.slice(0, 2500)}`);
    urls.push(u.url);
  });
  return { text: parts.join("\n\n"), urls, read: urls.length, missed };
}

/**
 * The remake (owner, 28 Oct 2026: "remake the documentaries that haven't posted yet, saving their
 * narration ... with this whole new massive visual overhaul"). A long video keeps its narration (no new
 * ElevenLabs credits) and gets what it was made without: a shot list for every sentence (one mid-tier call a
 * chapter, grounded in its Wikipedia source), the breathers before each chapter (silence put into the same
 * voice file), and fresh media matched to the shot list. Its old upload goes private for the owner to delete
 * (never deleted here) and the pipeline renders and uploads it again into its original slot.
 */
export async function prepareRemake(
  s: Services,
  id: string,
): Promise<{ moments: number; breaks: number; oldVideo?: string }> {
  const ep = await getEpisode(s.db, id);
  if (!ep?.script_json || !ep.assets_json?.audio)
    throw new Error("no voiced episode with that id");
  if (ep.script_json.runtime !== "long")
    throw new Error("only long videos are remade");
  if (ep.status === "uploading")
    throw new Error("it is uploading now; try again once that finishes");
  const dir = episodeDir(s.cfg, ep.id);
  const script = structuredClone(ep.script_json);
  const assets: EpisodeAssets = { ...ep.assets_json };
  const doc = script.evergreen_format === "documentary";
  let moments = 0;
  // 1. The shot list, chapter by chapter, for a documentary made before it existed.
  if (
    doc &&
    script.entries?.length &&
    !script.entries.some((e) => e.moments?.length)
  ) {
    const chapterBeats: string[][] = [];
    for (const b of script.beats) {
      if (b.visual?.kind === "chapter" || !chapterBeats.length)
        chapterBeats.push([]);
      chapterBeats[chapterBeats.length - 1]!.push(b.narration);
    }
    const games = script.entries.map((e) => e.game_title);
    const norm = (t: string) =>
      decodeURIComponent(t)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    for (const [ci, entry] of script.entries.entries()) {
      const sentences = (chapterBeats[ci] ?? []).flatMap((n) => sentencesOf(n));
      if (!sentences.length) continue;
      const url = (script.sources ?? []).find(
        (u) => norm(u.split("/wiki/")[1] ?? "") === norm(entry.game_title),
      );
      const source = await s.research(
        url
          ? decodeURIComponent(url.split("/wiki/")[1]!).replace(/_/g, " ")
          : entry.game_title,
        `${entry.game_title} ${entry.year} video game`,
        9000,
      );
      if (!source) continue;
      const chapterTitle =
        script.beats.filter((b) => b.visual?.kind === "chapter")[ci]?.visual
          ?.primary ?? entry.game_title;
      const shot = groundDocMoments(
        await writeDocMoments(s.llm, {
          game: entry.game_title,
          chapterTitle,
          sentences,
          source,
          games,
          lessons: await visualLessons(s.db, s.now(), segmentInputs).catch(
            () => "",
          ),
        }),
        source,
        games,
        sentences,
      );
      entry.moments = shot.moments;
      moments += shot.moments.filter((m) => m.graphic.kind !== "none").length;
    }
  }
  // 2. The breathers before each chapter, put into the narration it already has.
  let breaks = 0;
  if (doc && !assets.breaks?.length && assets.words?.length) {
    const words = assets.words;
    const duration = assets.durationSeconds ?? words[words.length - 1]!.end;
    const segs = buildSegments(segmentInputs(script), words, duration);
    const firstWords = segs
      .filter((g) => g.kind === "beat" && g.visual?.kind === "chapter")
      .map((g) => words.findIndex((w) => w.start >= g.start - 0.05))
      .filter((k) => k > 0);
    const gaps = chapterGaps(words, firstWords, DOC_BREAK_SECONDS);
    if (gaps.length) {
      await insertSilence(path.join(dir, assets.audio!), gaps);
      assets.words = openWords(words, gaps);
      assets.durationSeconds =
        duration + gaps.reduce((n, g) => n + g.seconds, 0);
      let added = 0;
      assets.breaks = gaps.map((g) => {
        const start = g.at + added;
        added += g.seconds;
        return { start, end: start + g.seconds };
      });
      await fs.writeFile(
        path.join(dir, "captions.srt"),
        srtFromWords(assets.words),
        "utf8",
      );
      breaks = gaps.length;
    }
  }
  // 3. Fresh media matched to the shot list, and a new plan, details and thumbnails.
  for (const k of [
    "images",
    "clips",
    "plan",
    "longPlan",
    "annotations",
    "thumb",
  ] as const)
    delete (assets as Record<string, unknown>)[k];
  // 4. The old upload goes private (the owner deletes it); the episode renders again into its slot.
  const oldVideo = ep.youtube_video_id ?? undefined;
  if (oldVideo)
    await s
      .youtube(accountOf(ep))
      .setPrivacy(oldVideo, "private")
      .catch(() => undefined);
  await s.db.query(
    `UPDATE episodes SET status = 'voiced', script_json = $2, assets_json = $3, youtube_video_id = NULL,
            youtube_status = NULL, upload_session_uri = NULL, qa_json = NULL, attempts = 0, last_error = NULL,
            next_attempt_at = NULL WHERE id = $1`,
    [ep.id, JSON.stringify(script), JSON.stringify(assets)],
  );
  await logEvent(s.db, ep.id, "remake", {
    moments,
    breaks,
    oldVideo,
    publishAt: ep.publish_at,
  });
  return { moments, breaks, oldVideo };
}

/** The weekly long-form ranking video: same topic pool as the evergreen Shorts, its own slot and lane. */
/** The ranking Shorts that did well and have no long ranking yet (src/sequels.ts). */
async function longSequels(s: Services, now: Date) {
  const { winners, norm } = await sequelWinners(s.db, now);
  const made = await s.db.query<{ theme: string | null }>(
    `SELECT story_json->>'gameHint' AS theme FROM episodes WHERE lane = 'longform' AND status NOT IN ('failed','rejected') AND created_at > $1::timestamptz - interval '180 days'`,
    [now],
  );
  return rankingSequels(
    winners,
    norm,
    made.map((r) => r.theme ?? ""),
  );
}

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
      // Fifteen to twenty minutes of footage takes four hours or more to gather, voice and render; the day
      // before, so the owner's recordings can join and the render can wait for a gap between Shorts.
      leadMinutes: Math.max(cfg.slotLeadMinutes + 420, cfg.longLeadMinutes),
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
  // Ranked by recent YouTube demand, topics with none skipped (src/discovery/searchdemand.ts).
  const ranked = await demandRanked(s, await s.discoverEvergreen());
  const { demand, skipped } = ranked;
  // The long version of a ranking Short that did well (SEQUEL_WINNERS, src/sequels.ts): already proven on our own
  // channel, so it joins the list whatever the demand check says, and its Short does not count as covering it.
  const sequels = s.cfg.sequelWinners ? await longSequels(s, now) : undefined;
  const candidates = [
    ...(sequels?.candidates ?? []),
    ...ranked.candidates.filter(
      (c) => !sequels?.candidates.some((x) => x.name === c.name),
    ),
  ];
  if (!candidates.length) return undefined;
  const topic = await selectLongformTopic(
    s.llm,
    candidates,
    covered.filter((h) => !sequels?.headlines.includes(h)),
    [await topicDemand(s, "long"), sequels?.block ?? ""]
      .filter(Boolean)
      .join("\n\n"),
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
    demand: demand.get(candidates[topic.candidate_index]!.name) ?? null,
    demand_skipped: skipped.map((c) => c.name),
    slot_at: due.toISOString(),
  });
  await reportDemand(
    s,
    "long ranking",
    topic.theme,
    demand.get(candidates[topic.candidate_index]!.name),
    skipped.length,
  );
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
  await guardScript(s, ep, script, "after writing");
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

/** The rebuilt gameplay Short's render: its faults stop it here, before the owner is asked. */
async function stepRenderGameplayDirect(s: Services, ep: Episode): Promise<void> {
  if (!s.renderGameplayShort) throw new Error("this build cannot render gameplay Shorts");
  const dir = episodeDir(s.cfg, ep.id);
  const script = ep.script_json!;
  const assets = ep.assets_json ?? {};
  const g = script.gameplay!;
  const timing = assets.gameplayShort!;
  const raw = path.join(dir, "render_raw.mp4");
  const final = path.join(dir, "short.mp4");
  const duration = assets.durationSeconds ?? 20;
  await s.renderGameplayShort({
    episodeDir: dir,
    props: {
      videoFile: assets.cutdown?.video ?? "cut.mp4",
      voiceFile: "voice.mp3",
      words: assets.words ?? [],
      durationSeconds: duration,
      hook: g.direct!.hook,
      hookEnd: timing.hookEnd,
      resultLine: g.result_line,
      payoffAt: timing.payoffAt,
      voiced: timing.voiced,
      accent: "#FF6B1A",
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
  const problems = [
    ...tech.problems,
    ...directProblems({
      blacks: await blackSpans(final),
      firstWordAt: assets.words?.[0]?.start,
      payoffAt: timing.payoffAt,
      seconds: duration,
      answerAt: timing.answerAt,
      loopLine: g.direct!.loop_line,
    }),
  ];
  const qa = {
    technical: { ...tech, ok: problems.length === 0, problems },
    vision: null,
    checked_at: s.now().toISOString(),
  };
  if (problems.length) {
    await s.db.query(`UPDATE episodes SET qa_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(qa),
    ]);
    throw new Error(`QA failed: ${problems.join(" | ")}`);
  }
  await transition(s.db, ep.id, "voiced", "rendered", {
    assets_json: { ...assets, video: "short.mp4", poster: "poster.jpg" },
    qa_json: qa,
  });
  await gameplayStatus(s.cfg, ep, "rendered");
}

async function stepRenderCutdown(s: Services, ep: Episode): Promise<void> {
  if (ep.script_json?.gameplay?.direct) return stepRenderGameplayDirect(s, ep);
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

/** The full verdict a clip got in the last day, when its file write never landed. */
async function priorGameplayReview(
  db: Db,
  id: string,
): Promise<GameplayReview | undefined> {
  const [row] = await db.query<{ review: unknown }>(
    `SELECT detail->'review' AS review FROM events
      WHERE kind = 'gameplay_reviewed' AND detail->>'id' = $1 AND detail->'review' IS NOT NULL
        AND created_at > now() - interval '24 hours'
      ORDER BY created_at DESC LIMIT 1`,
    [id],
  );
  const parsed = GameplayReviewSchema.safeParse(row?.review);
  return parsed.success ? parsed.data : undefined;
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
    try {
      await writeMeta(dir, { status: "reviewing" });
      // A verdict whose file write failed (a locked folder) is not paid for or lost: the event holds it, and an
      // episode already made from it is the same episode (4 Nov 2026: clips reviewed up to five times over).
      const prior = await priorGameplayReview(db, meta.id);
      let review: GameplayReview;
      if (prior) review = prior;
      else {
        const clip = path.join(dir, meta.clip.file || "clip.mp4");
        const words = (await s.hearClip?.(clip).catch(() => [])) ?? [];
        await writeWhole(path.join(dir, "words.json"), JSON.stringify(words));
        review = await reviewClip(
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
          review,
        });
      }
      const keep =
        worthPosting(review, minScoreFor(meta, cfg)) ||
        Boolean(meta.rehearsal && meta.rehearsal_force);
      const [made_before] = await db.query<{ id: string }>(
        `SELECT id FROM episodes WHERE story_hash = $1`,
        [`gameplay:${meta.id}`],
      );
      let episode: string | undefined = made_before?.id;
      if (keep && !episode) {
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
          gameplay: {
            id: meta.id,
            dir,
            review,
            rehearsal: isRehearsal(
              meta,
              dayKey(s.now(), cfg.timezone),
              cfg.gameplayRehearsalUntil,
            ),
          },
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
          game: review.game_title,
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
      // A failed look is tried again later, never thrown away (a write that fails here leaves "reviewing", which
      // newClips also comes back to).
      await writeMeta(dir, { status: "new" }).catch(() => undefined);
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
  const run = promisify(execFile);
  // Dead air out and the payoff in (cleanWindow): a failed look at the clip keeps the reviewer's window.
  const blacks = await run(
    FFMPEG,
    ["-hide_banner", "-nostats", "-i", source, "-vf", "blackdetect=d=0.2:pix_th=0.08", "-an", "-f", "null", "-"],
    { maxBuffer: 16 * 1024 * 1024 },
  )
    .then((r) => parseBlackSpans(r.stderr))
    .catch(() => []);
  const win = cleanWindow(
    gameplayWindow(ref.review, meta.clip.seconds),
    blacks,
    meta.clip.seconds,
  );
  // The rebuilt Short: a second look times the attempt and the outcome and writes the lines; the cut waits for the
  // voice, since the answer's real length decides how the ending runs.
  if (s.cfg.gameplayDirect) {
    const look = path.join(episodeDir(s.cfg, ep.id), "look");
    const direction = await directClip(
      s.llm,
      await directFrames(source, meta.clip.seconds, look),
      ref.review,
      blacks,
    );
    await fs.rm(look, { recursive: true, force: true });
    direction.hook = cleanLine(direction.hook);
    direction.setup = cleanLine(direction.setup);
    direction.payoff_line = cleanLine(direction.payoff_line);
    direction.loop_line = cleanLine(direction.loop_line);
    // A loop that says the hook again sounds like a stutter on the replay: a lead-in takes its place.
    if (loopRepeatsHook(direction.loop_line, direction.hook) || loopDangles(direction.loop_line))
      direction.loop_line = loopLeadIn(ref.id);
    await logEvent(s.db, ep.id, "gameplay_direction", { clip: ref.id, direction });
    if (!direction.payoff_visible && !(meta.rehearsal && meta.rehearsal_force))
      throw new FatalError("no clean payoff: the clip stops before anything is answered");
    const cut = directCut(direction, blacks, meta.clip.seconds);
    const lines = fitLines(direction, cut.payoffAt);
    const script = gameplayScript(ref.review, ref.id, await gameplayExperiments(s.cfg));
    script.hook = lines.hook;
    script.beats = [
      {
        narration: lines.setup,
        visual: { kind: "none", primary: "", secondary: "" },
      },
    ];
    script.pulse_take.narration = direction.payoff_line.trim();
    script.loop_line = direction.loop_line.trim();
    script.gameplay!.direct = {
      hook: lines.hook,
      setup: lines.setup,
      payoff_line: direction.payoff_line.trim(),
      loop_line: direction.loop_line.trim(),
      segments: cut.segments,
      seconds: cut.seconds,
      payoff_at: cut.payoffAt,
      focus_start: direction.focus_start,
      focus_payoff: direction.focus_payoff,
    };
    await guardScript(s, ep, script, "after writing");
    await transition(s.db, ep.id, "selected", "scripted", {
      script_json: script,
      assets_json: { words: [], durationSeconds: cut.seconds, clips: [] },
    });
    await logEvent(s.db, ep.id, "gameplay_cut", {
      clip: ref.id,
      segments: cut.segments,
      payoff_at: cut.payoffAt,
      title: script.youtube.title,
    });
    return;
  }
  const len = win.end - win.start;
  // An HDR capture is tone-mapped so it does not look washed out.
  const tone = hdrFilter(
    await run(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_transfer", "-of", "csv=p=0", source])
      .then((r) => r.stdout.trim())
      .catch(() => ""),
  );
  const dir = episodeDir(s.cfg, ep.id);
  await fs.mkdir(dir, { recursive: true });
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
      `${tone}scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30`,
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
      `${tone}scale=-2:1920,crop=1080:1920,boxblur=28:3,eq=brightness=-0.10:saturation=1.15,fps=30`,
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
  await guardScript(s, ep, script, "after writing");
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
    ...articleFields(g, ep.script_json!.game_title),
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
  await guardScript(s, ep, script, "after writing");
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
): Array<{
  at: number;
  text: string;
  sub?: string;
  colour: string;
  tone?: string;
}> {
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
      tone: st.tone,
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
  // The last 20 Shorts' whole spoken scripts: the concession, data-feed and repeated-story checks read them.
  const full = await db.query<{ script: Script }>(
    `SELECT script_json AS script FROM episodes WHERE script_json IS NOT NULL AND id <> $1 AND status NOT IN ('failed','rejected')
         AND COALESCE(script_json->>'runtime', 'short') = 'short'
       ORDER BY created_at DESC LIMIT 20`,
    [exceptId],
  );
  const scripts = full.flatMap((r) => {
    try {
      return r.script?.hook && r.script.pulse_take
        ? [narrationOf({ ...r.script, beats: r.script.beats ?? [] })]
        : [];
    } catch {
      return [];
    }
  });
  return {
    takes: rows
      .map((r) => (r.take ?? "").trim().split(/\s+/).slice(0, 4).join(" "))
      .filter(Boolean),
    loops: rows.map((r) => (r.loop ?? "").trim()).filter(Boolean),
    scripts,
  };
}

/**
 * The narration of the newest earlier documentary on the same franchise ("Grand Theft Auto" matches
 * "Grand Theft Auto VI"), so a new one reuses none of its wording; undefined when there is none.
 */
export async function priorDocNarration(
  db: Db,
  exceptId: string,
  franchise: string,
): Promise<string | undefined> {
  const rows = await db.query<{ script: Script }>(
    `SELECT script_json AS script FROM episodes
      WHERE id <> $1 AND script_json->>'evergreen_format' = 'documentary' AND status NOT IN ('failed','rejected')
        AND (position(lower($2) in lower(coalesce(script_json->>'game_title', ''))) > 0
             OR position(lower(coalesce(script_json->>'game_title', '~')) in lower($2)) > 0)
      ORDER BY created_at DESC LIMIT 1`,
    [exceptId, franchise],
  );
  const sc = rows[0]?.script;
  if (!sc) return undefined;
  return (
    [
      sc.hook,
      ...(sc.beats ?? []).map((b) => b.narration),
      sc.pulse_take?.narration ?? "",
    ]
      .join(" ")
      .trim() || undefined
  );
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
        ...validateRecapChapter(chapter, chapters),
        ...unsupported.map(
          (u) => `Not supported by the sources, remove or correct it: ${u}`,
        ),
      ];
      if (!feedback.length) break;
      if (attempt === 2)
        warnings.push(...feedback.map((f) => `${story.game}: ${f}`));
    }
    if (s.cfg.writerNotesGuard && chapterRefusal(chapter!).length)
      throw new FatalError(
        `recap story "${story.game}" refused: ${chapterRefusal(chapter!)[0]!.slice(0, 200)}`,
      );
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
          lessons: await visualLessons(s.db, s.now(), segmentInputs).catch(
            () => "",
          ),
        }),
        story.source,
        stories.map((st) => st.game),
        grounded.chapter.paragraphs.flatMap((p) => sentencesOf(p.narration)),
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
  await guardScript(s, ep, script, "after writing");
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
    explained?: boolean;
    story?: ExplainedStory;
    stories?: string[];
    topic?: import("./editorial/evergreen.ts").EvergreenTopic;
  } | null;
  if (fc?.recap && fc.stories?.length)
    return stepScriptRecap(s, ep, fc.stories);
  // The week's biggest story, explained (src/explainedstep.ts).
  if (fc?.explained && fc.story)
    return stepScriptExplained(s, ep, fc.story, {
      segmentInputs: (sc) => segmentInputs(sc),
    });
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
  // The Inspiration rules (src/editorial/longrules.ts): measured while it's written, so they never force a whole new draft.
  const rules = longRulesFor(s.cfg, "ranking");
  for (let attempt = 0; attempt < 2; attempt++) {
    draft = await writeLongform(s.llm, topic, lookup, feedback, lessons, {
      punchyHook: s.cfg.longPunchyHook,
      soundBeats: s.cfg.docSoundBeats,
      rules,
    });
    const problems = [
      ...validateLongform(draft, rules),
      ...writerTitleProblems(s.cfg, draft.youtube.title),
    ];
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
  if (longRulesOn(rules)) {
    const said = narrationOfLongform(draft);
    const missed = [
      ...longRuleWarnings(said, rules),
      ...hookStackProblems(
        draft.intro.narration,
        draft.intro.hook_stack,
        rules.hookStack,
        [...draft.entries]
          .sort((a, b) => b.rank - a.rank)
          .map((x) => x.narration),
        draft.outro.narration,
      ),
    ];
    await logEvent(s.db, ep.id, "long_rules", {
      kind: rules.kind,
      measures: scriptMeasures(said),
      loops: draft.placed_loops?.length ?? 0,
      hookStack: draft.intro.hook_stack,
      missed,
    });
    if (missed.length)
      await logEvent(s.db, ep.id, "style_warnings", { problems: missed });
  }
  const script = withSpoilerWarning(longformToScript(draft));
  await guardScript(s, ep, script, "after writing");
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

/** What the card says you must do: Steam's words if they fit, the writer's shorter ones if not, always within the card. */
export function achievementRequirement(
  description: string | undefined,
  written: string | undefined,
): string {
  const steam = (description ?? "").trim();
  if (steam && fitRequirement(steam).fits) return steam;
  const own = (written ?? "").trim();
  if (own && fitRequirement(own).fits) return own;
  return cardRequirement(steam || own);
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
      requirement?: string;
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
    description?: string;
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
            // The card's words: Steam's own when they fit three readable lines, else the writer's plain version.
            requirement: achievementRequirement(d.description, e.requirement),
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
  // The recent Shorts' scripts, so an evergreen Short never retells one of them.
  const recentScripts =
    (await recentShapes(s.db, ep.id).catch(() => undefined))?.scripts ?? [];
  const recentTexts = await recentShortTexts(s.db, ep.id, s.now()).catch(
    () => [],
  );
  // The format's own data (Steam's chart, deals or achievement rates) replaces the writer's numbers.
  const data = (
    ep.factcheck_json as {
      achievements?: Array<{
        name: string;
        game: string;
        percent: number;
        icon?: string;
        year?: number;
        description?: string;
      }>;
    } | null
  )?.achievements;
  const climbers = (ep.factcheck_json as { climbers?: ClimberData[] } | null)
    ?.climbers;
  const deals = (ep.factcheck_json as { deals?: Deal[] } | null)?.deals;
  const ground = (d: NonNullable<typeof draft>) => {
    let g = d;
    if (data?.length) g = groundAchievements(g, data);
    if (climbers?.length) g = groundClimbers(g, climbers);
    if (deals?.length) g = groundDeals(g, deals);
    return g;
  };
  // What may never ship: number one given away, an achievement that goes unnamed or a condition made up. Read on
  // the grounded script, because ranks and figures come from the data, not the writer.
  const mustFix = (d: NonNullable<typeof draft>) => {
    const g = ground(d);
    return [
      ...spoilerProblems(g),
      ...(ACHIEVEMENT_FORMATS.has(g.format)
        ? achievementProblems(
            g,
            data?.length
              ? new Map(
                  data
                    .filter((x) => x.description)
                    .map((x) => [normRankTitle(x.name), x.description!]),
                )
              : undefined,
          )
        : []),
    ];
  };
  // The audit's writer rules for a Short's list (src/editorial/shortrules.ts); a long video's brief is left alone.
  const ruleNote = ep.lane !== "longform" ? evergreenRuleNote(s.cfg) : "";
  const ruledBrief = ruleNote ? [brief, ruleNote].filter(Boolean).join("\n\n") : brief;
  for (let attempt = 0; attempt < 2; attempt++) {
    draft = await writeEvergreen(s.llm, topic, facts, feedback, ruledBrief);
    const problems = [
      ...new Set([
      ...validateEvergreen(draft, recentScripts),
        ...mustFix(draft),
      ]),
      ...writerTitleProblems(s.cfg, draft.youtube.title, topic.format),
    ];
    // No title or hook phrase a few recent Shorts already used (REPEAT_MAX, src/authenticity.ts).
    problems.push(
      ...repetitionProblems(
        { title: draft.youtube.title, hook: draft.hook, game: draft.theme },
        recentTexts,
        s.cfg.repeatMax,
      ),
    );
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
  // The fact-check's rewrite and a stubborn writer both get a last look: one more rewrite, then the plain wording.
  let left = mustFix(draft);
  if (left.length) {
    await logEvent(s.db, ep.id, "style_warnings", { problems: left });
    draft = await writeEvergreen(s.llm, topic, facts, left, brief);
  }
  draft = patchSpoilers(ground(draft));
  left = mustFix(draft);
  // An entry that still names number one or goes unnamed has no plain wording to fall back on: the step runs again.
  if (left.length) throw new Error(`ranking script not fit to voice: ${left[0]}`);
  const script = evergreenToScript(draft);
  await guardScript(s, ep, script, "after writing");
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
    // A planned run topic lists its sources on purpose (src/shortrun.ts), so all of them are read.
    .slice(0, cluster.run ? 8 : 4);
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
  // Draft, check house rules, fact-check; one fix with the problems fed back (edits to the draft, or a
  // whole new draft when the edits do not apply).
  const recent = await recentShapes(s.db, ep.id).catch(() => undefined);
  // The weekly retention test (src/growth.ts): this Short's variant of the thing under test, and the rules the
  // finished tests settled. Recorded on the episode so the judge can find it; a failure here never stops a Short.
  // A planned run topic's angle sets its opener, so it stays out of the opening-line test.
  const test = await (cluster.run
    ? Promise.resolve(undefined)
    : growthAssign(s.db, s.cfg, s.now(), ep, (m) => s.notify(m))
  ).catch((err) => {
    log("warn", "growth test assignment failed", { error: errorMessage(err) });
    return undefined;
  });
  const testDefaults = await growthDefaults(s.db).catch(() => []);
  // The audit's writer rules (src/editorial/shortrules.ts) come after the test's variant, nearest the draft.
  const argument = argumentArm(s.cfg, ep);
  if (argument)
    await logEvent(s.db, ep.id, "short_argument", { arm: "argument" });
  const variantNote = [growthNotes(test, testDefaults), shortRuleNote(s.cfg, ep)]
    .filter(Boolean)
    .join("\n\n");
  const recentTexts = await recentShortTexts(s.db, ep.id, s.now()).catch(
    () => [],
  );
  const whyHooks = cluster.why
    ? await recentWhyHooks(s.db, ep.id, s.now(), s.cfg.whyFreshDays).catch(
        () => [],
      )
    : [];
  // The Pulse Check is the news desk's own segment: a Why Short has its question and its reason to follow instead.
  const pulseCheck =
    s.cfg.newsSegment &&
    !argument &&
    !cluster.why &&
    (ep.lane === "news" || ep.lane === "news_breaking");
  for (let attempt = 0; attempt < 2; attempt++) {
    script = await writeScript(s.llm, cluster, articles, {
      variantNote,
      // YouTube's lessons, then how the same Shorts did on Instagram, Facebook, Threads and TikTok.
      lessons: [
        await hookLessons(s.db, s.now(), segmentInputs).catch(() => ""),
        await socialLessons(s.db, s.now()).catch(() => ""),
      ]
        .filter(Boolean)
        .join("\n\n"),
      mustLabelRumour,
      feedback,
      storeData,
      recent,
      draft: attempt > 0 ? script : undefined,
      segment: pulseCheck,
      noSeriesFollow: s.cfg.shortEndPayoff,
    });
    const problems = validateScript(script, recent);
    const thin = s.cfg.shortRefuseThin
      ? thinProblems(narrationOf(script), script.thin_reason)
      : [];
    problems.push(...thin);
    if (s.cfg.shortLabelsClean) problems.push(...cardFigureProblems(script.beats));
    if (s.cfg.shortEndPayoff) problems.push(...endingProblems(script.loop_line));
    if (pulseCheck) problems.push(...pulseCheckProblems(script));
    // The test variant is a house rule for this Short: a draft that ignored it is sent back like any other.
    problems.push(...growthProblems(script, test, testDefaults));
    // No title or hook phrase a few recent Shorts already used (REPEAT_MAX, src/authenticity.ts); a Why
    // Short also opens unlike the last two weeks' and gives its reason to follow (src/editorial/why.ts).
    problems.push(
      ...repetitionProblems(
        {
          title: script.youtube.title,
          hook: script.hook,
          game: runRepeatGame(script.game_title, cluster.run),
        },
        recentTexts,
        s.cfg.repeatMax,
      ),
    );
    if (cluster.why)
      problems.push(
        ...whyHookProblems(script.hook, whyHooks),
        ...whyFollowProblems(
          script.loop_line,
          cluster.why.follow,
          s.cfg.shortEndPayoff,
        ),
        ...whyAnswerProblems(narrationOf(script)),
      );
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
      // Thin after a rewrite: nothing to watch for. A big story is the channel's duty to cover, so it goes on and the
      // owner is told why it reads thin; anything else gives its slot to the next story, and he is told that too.
      if (thin.length) {
        await logEvent(s.db, ep.id, "thin_story", {
          big: !!cluster.bigStory,
          why: thin,
        });
        if (cluster.bigStory) {
          await s.notify({
            level: "info",
            content: `Big story "${cluster.headline}" reads thin but is going out, since big stories are always made: ${thin.join(" ").slice(0, 500)}`,
          });
        } else {
          await markSeen(
            s.db,
            cluster.hash,
            cluster.headline,
            "rejected",
            "too thin",
          );
          await transition(s.db, ep.id, "selected", "rejected", {
            script_json: script,
            factcheck_json: check,
            last_error: `too thin: ${thin.join(" | ")}`,
          });
          await s.notify({
            level: "info",
            content: `Dropped as too thin, the slot goes to the next story: "${cluster.headline}". ${thin.join(" ").slice(0, 500)}`,
          });
          return;
        }
      }
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
  await guardScript(s, ep, script, "after writing");
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    factcheck_json: check,
    assets_json:
      steam || test
        ? { ...(steam ? { steam } : {}), ...(test ? { test } : {}) }
        : null,
  });
}

/**
 * The rebuilt gameplay Short's voice and cut. Two takes: the question and stake over the attempt, the answer and loop
 * after the outcome, with the game's own sound alone between them. The answer's real length decides whether the
 * ending replays slowed (directTiming), so the picture is cut here.
 */
async function stepVoiceGameplayDirect(s: Services, ep: Episode): Promise<void> {
  const script = ep.script_json!;
  const g = script.gameplay!;
  const d = g.direct!;
  const ref = ep.story_json.gameplay!;
  const clipDir = gameplayDir(s.cfg, ref.id);
  const meta = await readMeta(clipDir);
  if (!meta) throw new FatalError("the gameplay clip is gone from the inbox");
  const dir = episodeDir(s.cfg, ep.id);
  await fs.mkdir(dir, { recursive: true });
  const ctx = speakContext();
  const voice = { id: s.cfg.elevenLabsVoiceId, name: s.cfg.narratorName };
  const question = await s.synthesise(
    speakable([d.hook, d.setup].filter(Boolean).join(" "), ctx),
    path.join(dir, "voice_a.mp3"),
    voice,
    { minWpm: DIRECT_MIN_WPM },
  );
  const answer = await s.synthesise(
    speakable([d.payoff_line, d.loop_line].filter(Boolean).join(" "), ctx),
    path.join(dir, "voice_b.mp3"),
    voice,
    { minWpm: DIRECT_MIN_WPM },
  );
  const timing = directTiming(
    d.seconds,
    d.payoff_at,
    question.durationSeconds,
    answer.durationSeconds,
  );
  const run = promisify(execFile);
  const source = path.join(clipDir, meta.clip.file || "clip.mp4");
  const tone = hdrFilter(
    await run(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_transfer", "-of", "csv=p=0", source])
      .then((r) => r.stdout.trim())
      .catch(() => ""),
  );
  await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-i",
      source,
      "-filter_complex",
      directFilter(
        { segments: d.segments, seconds: d.seconds, payoffAt: d.payoff_at },
        {
          tone,
          focusStart: d.focus_start,
          focusPayoff: d.focus_payoff,
          replaySource: timing.replaySource,
        },
      ),
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      path.join(dir, "cut.mp4"),
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  // The two takes on one clock, padded to the film's length.
  await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-i",
      path.join(dir, "voice_a.mp3"),
      "-i",
      path.join(dir, "voice_b.mp3"),
      "-filter_complex",
      `[1]adelay=${Math.round(timing.answerAt * 1000)}:all=1[b];[0][b]amix=inputs=2:normalize=0:duration=longest,apad,atrim=0:${timing.seconds}[out]`,
      "-map",
      "[out]",
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      path.join(dir, "voice.mp3"),
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const hookWords = d.hook.trim().split(/\s+/).length;
  const hookEnd =
    question.words[Math.min(hookWords, question.words.length) - 1]?.end ?? 0;
  const words = [
    ...question.words,
    ...answer.words.map((w) => ({
      ...w,
      start: w.start + timing.answerAt,
      end: w.end + timing.answerAt,
    })),
  ];
  await logEvent(s.db, ep.id, "voice", {
    provider: question.voice?.provider ?? "unknown",
    id: question.voice?.id,
    name: question.voice?.name,
  });
  await transition(s.db, ep.id, "scripted", "voiced", {
    assets_json: {
      ...(ep.assets_json ?? {}),
      words,
      durationSeconds: timing.seconds,
      clips: [],
      audio: "voice.mp3",
      voice: question.voice,
      cutdown: {
        start: 0,
        end: timing.seconds,
        video: "cut.mp4",
        background: "",
      },
      gameplayShort: {
        hookEnd: Math.round(hookEnd * 100) / 100,
        payoffAt: d.payoff_at,
        answerAt: timing.answerAt,
        voiced: [
          { start: 0, end: question.durationSeconds },
          {
            start: timing.answerAt,
            end: timing.answerAt + answer.durationSeconds,
          },
        ],
      },
    },
  });
}

async function stepVoice(s: Services, ep: Episode): Promise<void> {
  // The last door before any credit is spent, whatever the lane and however the script got here.
  await guardScript(s, ep, ep.script_json, "before the voice");
  if (ep.script_json?.gameplay?.direct) return stepVoiceGameplayDirect(s, ep);
  // A cutdown speaks with the long video's own narration, cut with its section; a gameplay Short keeps the game's sound.
  if (ep.lane === "cutdown" || ep.lane === "gameplay") {
    await transition(s.db, ep.id, "scripted", "voiced");
    return;
  }
  const dir = episodeDir(s.cfg, ep.id);
  await fs.mkdir(dir, { recursive: true });
  // The pictures before the credit: a Short that cannot be pictured is refused before anything is voiced.
  if (
    s.cfg.shortMediaBeforeVoice &&
    ["news", "news_breaking", "free", "evergreen"].includes(ep.lane) &&
    !ep.assets_json?.images
  ) {
    const estSeconds =
      (narrationOf(ep.script_json!).split(/\s+/).filter(Boolean).length / 160) * 60;
    const probe = {
      ...ep,
      assets_json: { ...(ep.assets_json ?? {}), durationSeconds: estSeconds },
    } as Episode;
    const media: Pick<EpisodeAssets, "images" | "clips" | "officialTrailer" | "eraDropped"> & { rich?: boolean } =
      await gatherMedia(s, probe, dir);
    const limit = ep.story_json.bigStory
      ? Math.max(s.cfg.shortPlateMax, s.cfg.shortPlateMaxBig)
      : s.cfg.shortPlateMax;
    // The real planner on evenly spaced stand-in word timings: what the render step will decide, before the credit.
    const estimate = (m: typeof media): number => {
      try {
        const script = ep.script_json!;
        const toks = narrationOf(script).split(/\s+/).filter(Boolean);
        const per = estSeconds / Math.max(1, toks.length);
        const words = toks.map((text, i) => ({
          text,
          start: i * per,
          end: i * per + per * 0.85,
        }));
        const duration = estSeconds + TAIL_SECONDS;
        const plan = buildPlan({
          segments: buildSegments(segmentInputs(script, false), words, duration),
          words,
          durationSeconds: duration,
          images: (m.images ?? []).map((i) => ({
            kind: i.kind,
            aspect: i.aspect,
            beatIndex: i.beatIndex,
            wordy: i.wordy,
            frame: i.frame,
          })),
          clips: (m.clips ?? []).map((c) => ({
            durationSeconds: c.durationSeconds,
            motion: c.motion,
            luma: c.luma,
            beatIndex: c.beatIndex,
            role: c.role,
          })),
          storyType: script.is_rumour ? "rumour" : script.story_type,
          isRumour: script.is_rumour,
          attribution: script.attribution,
          variant: variantOf(ep.id),
          openOnClip: s.cfg.openOnMotion,
          footageFirst: s.cfg.shortFootageFirst,
        });
        return (
          plan.shots
            .filter((x) => x.media.type === "plate")
            .reduce((n, x) => n + x.end - x.start, 0) / plan.totalFrames
        );
      } catch (err) {
        // A check that cannot run never stops a Short: the render step's gate still stands.
        log("warn", "media estimate failed", { error: errorMessage(err) });
        return 0;
      }
    };
    let share = estimate(media);
    if (share > limit) {
      Object.assign(media, await gatherMedia(s, probe, dir, true), { rich: true });
      share = estimate(media);
    }
    await logEvent(s.db, ep.id, "media_before_voice", {
      images: (media.images ?? []).length,
      clips: (media.clips ?? []).length,
      plateEstimate: Math.round(share * 100) / 100,
      limit,
    });
    if (share > limit) {
      const why = `about ${Math.round(share * 100)}% of the Short would be an empty panel${media.eraDropped ? `: the only footage and art are of a later version than the ${ep.script_json?.story_year} game it is about` : ""}`;
      await markSeen(s.db, ep.story_hash, ep.story_json.headline, "rejected", why);
      await transition(s.db, ep.id, "scripted", "rejected", {
        last_error: `not voiced, too little media: ${why}`,
      });
      await s.notify({
        level: "info",
        content: `Dropped before the voice, no credit spent: "${ep.story_json.headline}". ${why}, even after looking for more. The slot goes to the next story.`,
      });
      return;
    }
    ep = { ...ep, assets_json: { ...(ep.assets_json ?? {}), ...media } as Episode["assets_json"] };
    await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(ep.assets_json),
    ]);
  }
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
  const desk0 = deskFor(
    { ...s.cfg, deskShare: await deskShareNow(s.db, s.cfg) },
    ep,
  );
  // When the desk partner would be the narrator, the usual narrator asks the question instead.
  const desk =
    desk0 && desk0.voice.id === voice.id
      ? { voice: { id: s.cfg.elevenLabsVoiceId, name: s.cfg.narratorName } }
      : desk0;
  // A Short outside the desk test still has a take written as the reply to its question, so the narrator asks
  // it himself. 3 Nov 2026: the GTA 6 pre-load Short said "No. That box holds a download code" to nobody.
  if (!desk && !twin && ep.script_json?.desk_question?.trim()) {
    const sc = ep.script_json;
    sc.pulse_take.narration = `${sc.desk_question!.trim()} ${sc.pulse_take.narration}`;
    delete sc.desk_question;
    await s.db.query(`UPDATE episodes SET script_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(sc),
    ]);
  }
  let narration: Awaited<ReturnType<Services["synthesise"]>>;
  if (desk && s.stitchTakes) {
    // The desk experiment: the narrator up to the facts, the desk partner's question in a second voice,
    // the narrator's take and close; three takes stitched onto one timeline.
    const sc = ep.script_json!;
    const ctx = speakContext(); // the same order as segmentInputs, so the timings match the voice
    const partA = speakable(
      [sc.hook, ...sc.beats.map((b) => b.narration)].join(" "),
      ctx,
    );
    const partQ = speakable(sc.desk_question!, ctx);
    const partB = speakable(
      [sc.pulse_take.narration, tidyLoopLine(sc.loop_line)].join(" "),
      ctx,
    );
    const a = await s.synthesise(partA, path.join(dir, "voice_a.mp3"), voice, {
      provider: "elevenlabs",
      ...(s.cfg.shortMinWpm ? { minWpm: s.cfg.shortMinWpm } : {}),
    });
    const q = await s.synthesise(
      partQ,
      path.join(dir, "voice_q.mp3"),
      desk.voice,
      { provider: "elevenlabs" },
    );
    const b = await s.synthesise(partB, path.join(dir, "voice_b.mp3"), voice, {
      provider: "elevenlabs",
      ...(s.cfg.shortMinWpm ? { minWpm: s.cfg.shortMinWpm } : {}),
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
      twin
        ? { provider: "elevenlabs" }
        : // A test dial, off by default: documentaries keep their natural pace whatever it says.
          s.cfg.longMinWpm && ep.script_json?.evergreen_format === "ranking"
          ? { minWpm: s.cfg.longMinWpm }
          : // SHORT_MIN_WPM: off until the owner has heard the samples. Never slows a voice, and lifts 25% at most.
            s.cfg.shortMinWpm && ep.lane !== "longform"
            ? { minWpm: s.cfg.shortMinWpm }
            : undefined,
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
  // What the voice actually said, as much as the script: this fails closed, unlike a misheard word below.
  if (s.cfg.writerNotesGuard) {
    const found = [
      ...writerNoteHits(check?.heard ?? "").map((h) => ({
        ...h,
        where: "the voice as heard",
      })),
      ...releaseWriterNotes({ words: narration.words }),
    ];
    if (found.length)
      await stopForWriterNotes(s, ep, "at the narration check", found);
  }
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
  // How the take sounds, measured (owner, 30 Oct 2026: "run tests on everything as you generate it"; the
  // new voice's intakes of breath were "quite off-putting"). Audible breaths are found on the loudness
  // envelope and turned down in place (timings unchanged); a take still breathy after that, or a rushed
  // one, is reported. The old narrator measured 0.3 audible breaths a minute, the new one 6 before this.
  if (!twin) {
    try {
      const file = path.join(dir, "voice.mp3");
      const turned = await turnDownBreaths(file);
      const breath = turned.after;
      const before = turned.before.loudPerMinute;
      const wpm = wordsPerMinute(narration.words);
      const problems = voiceProblems(
        breath,
        wpm,
        s.cfg.shortMinWpm && ep.lane !== "longform"
          ? Math.max(190, s.cfg.shortMinWpm + 25)
          : 190,
      );
      await logEvent(s.db, ep.id, "voice_quality", {
        ok: problems.length === 0,
        wpm,
        loudBreathsPerMinute: breath.loudPerMinute,
        loudBreathsBefore: before,
        breathPasses: turned.passes,
        breaths: breath.breaths,
        loudest: breath.loudest,
        problems,
      });
      if (problems.length) {
        log("warn", "voice quality check failed; going on", {
          episode: ep.id,
          problems,
        });
        await s.notify({
          content: `🎙️ The narration for "${ep.script_json?.headline ?? ep.id}" sounds off and goes ahead anyway: ${problems.join("; ")}`,
        });
      } else
        log("info", "voice quality check passed", {
          episode: ep.id,
          wpm,
          loudBreathsPerMinute: breath.loudPerMinute,
          loudBreathsBefore: before,
        });
    } catch (err) {
      log("warn", "voice quality check unavailable", {
        error: errorMessage(err),
      });
    }
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
  // and the chapter's title full screen (owner, 27 Oct 2026: "very narrative and word heavy"). Every long
  // video's quiet beats take a breath (31 Oct 2026); only chapter cards get breathers, so a ranking gets none.
  let breaks: EpisodeAssets["breaks"];
  if (
    ep.script_json &&
    (ep.script_json.evergreen_format === "documentary" ||
      ep.lane === "longform") &&
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
      // The writer's quiet beats take a breath after their sentence too (src/voice/quietbeats.ts).
      const quiet = s.cfg.docSoundBeats
        ? quietBeatGaps(ep.script_json, narration.words, segs)
        : [];
      const gaps = [
        ...chapterGaps(narration.words, firstWords, DOC_BREAK_SECONDS),
        ...quiet,
      ];
      if (gaps.length) {
        await insertSilence(path.join(dir, "voice.mp3"), gaps);
        narration.words = openWords(narration.words, gaps);
        narration.durationSeconds += gaps.reduce((n, g) => n + g.seconds, 0);
        breaks = gapSpans(gaps)
          .filter((g) => g.kind === "chapter")
          .map((g) => ({ start: g.start, end: g.end }));
        if (quiet.length)
          await logEvent(s.db, ep.id, "quiet_beats", {
            breaths: quiet.length,
            seconds:
              Math.round(quiet.reduce((n, g) => n + g.seconds, 0) * 10) / 10,
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
export function suiteFor(
  cfg: Config,
  ep: Pick<Episode, "id" | "lane">,
): boolean {
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

/** Clips kept within each capped publisher's total for one Short (src/assets/officialTrailer.ts PUBLISHER_CHANNELS). */
export function capPublisherTotal<T extends { provenance: string; durationSeconds: number; beatIndex?: number }>(clips: T[]): T[] {
  const used = new Map<string, number>();
  const order = [...clips].sort(
    (a, b) =>
      Number(b.beatIndex === undefined) - Number(a.beatIndex === undefined) ||
      (b.beatIndex ?? 0) - (a.beatIndex ?? 0),
  );
  const keep = new Set<T>();
  for (const c of order) {
    const rule = PUBLISHER_CHANNELS.find((r) => c.provenance.includes(`publisher: ${r.name}`));
    if (!rule) {
      keep.add(c);
      continue;
    }
    const sofar = used.get(rule.name) ?? 0;
    if (sofar + c.durationSeconds > rule.clipSeconds) continue;
    used.set(rule.name, sofar + c.durationSeconds);
    keep.add(c);
  }
  return clips.filter((c) => keep.has(c));
}

/** The game's name for picture searches: a writer's "(Switch 2 remake)" hides an exact title match. */
export function mediaTitle(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, "").trim() || title;
}

async function gatherMedia(
  s: Services,
  ep: Episode,
  dir: string,
  /** The second pass after a red media rubric: more screenshots and clips so the plan can vary. */
  rich = false,
): Promise<
  Pick<EpisodeAssets, "images" | "clips" | "officialTrailer" | "eraDropped">
> {
  const script = ep.script_json!;
  // The gather's time budget (GATHER_MAX_MINUTES, src/assets/gatherbudget.ts): past it the entry loop below
  // stops with what it has; and a long video yields the lane early to an urgent one (a slot within hours,
  // still unscripted) rather than keep it waiting behind hours of downloads (30 Oct 2026, the missed recap).
  // A Short's slot is 75 to 120 minutes off: its gather gets its own, shorter limit.
  const gatherBudget = new GatherBudget(ep.lane === "longform" ? s.cfg.gatherMaxMinutes : Math.min(s.cfg.gatherMaxMinutes, s.cfg.shortGatherMaxMinutes), async () => {
    if (ep.lane !== "longform") return undefined;
    const other = (await dueEpisodes(s.db, s.now())).find(
      (e) => e.id !== ep.id && isLongEpisode(e) && isUrgentLong(e, s.now()),
    );
    return other
      ? `"${other.script_json?.headline ?? other.story_json.headline}" is due within ${LONG_URGENT_HOURS} hours and still unscripted`
      : undefined;
  });
  let budgetReported = false;
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
  // Footage first on a Short: past one moment per line, more clean moments up to this much of the narration.
  const shortFill =
    ep.lane !== "longform" && s.cfg.shortFootageFirst
      ? {
          seconds: ranking
            ? 0
            : ((ep.assets_json?.durationSeconds ?? 45) *
                s.cfg.shortFootageShare) /
              100,
          textCheck: s.cfg.shortClipTextCheck,
        }
      : undefined;
  const clipAssets =
    app && s.cfg.footage && s.cfg.maxClips > 0 && topicTargets.length
      ? await s
          .fetchClips(
            app,
            dir,
            topicTargets,
            ranking ? 1 : s.cfg.maxClips + (rich ? 2 : 0),
            undefined,
            shortFill,
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
  // Footage first: a Steam page whose trailers gave well under the target also tries the publisher's own trailer.
  const steamSeconds = clipAssets.reduce(
    (n, c) => n + (c.durationSeconds ?? 0),
    0,
  );
  const steamShort =
    !ranking && !!shortFill?.seconds && steamSeconds < shortFill.seconds * 0.6;
  const official: OfficialMedia =
    // The publisher's own YouTube trailer: for games not on Steam, picture stories, and Steam pages with no
    // usable trailer (Metal Gear Solid matched an old bundle whose one video would not download, 25 Oct 2026).
    (pictureStory || !app || clipAssets.length < 2 || steamShort) &&
    s.cfg.footage &&
    script.game_title
      ? await s
          .fetchOfficialMedia(
            mediaTitle(script.game_title),
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
            shortFill
              ? {
                  ...shortFill,
                  seconds: Math.max(0, (shortFill.seconds ?? 0) - steamSeconds),
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
      : clipAssets.length < 2 || steamShort
        ? [...clipAssets, ...official.clips]
        : clipAssets,
    budget,
    3.4,
    s.cfg.shortFootageFirst,
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
          .igdbArt(mediaTitle(script.game_title), undefined, dir, 8)
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
  // Trailer frames in hand (OFFICIAL_STILL_FRAMES): the thumbnail, with its logos, is no longer needed, and an IGDB
  // entry years older than today is the old game of a remake, kept for the words about the old game (thenWindows).
  if (official.stills.length >= 4) {
    const nowYear = s.now().getUTCFullYear();
    for (const a of igdb) {
      const y = Number(a.provenance.match(/\((\d{4})\)/)?.[1]);
      if (y && y <= nowYear - 5) a.then = true;
    }
    const thumb = images.findIndex((a) => a.file.endsWith("official_trailer.jpg"));
    if (thumb >= 0) images.splice(thumb, 1);
    // The picture editor puts the pool on the lines it shows (the ocarina on "hum its songs"), and each frame is
    // cropped on its subject for the vertical screen. Neither stops the Short if it fails.
    const frames = official.stills.filter((a) => !a.file.endsWith("official_trailer.jpg"));
    const clauses = (text: string) =>
      text
        .split(/(?<=[,.;?!])\s+/)
        .reduce<string[]>((out, c) => {
          // A short tail stays with the clause before it: it would be under a shot's length.
          if (out.length && c.split(/\s+/).length < 3) out[out.length - 1] += ` ${c}`;
          else out.push(c);
          return out;
        }, []);
    // One target for each clause of a line, in order, so a line with two ideas cuts to two pictures.
    const targets = targetsFor(script)
      .filter((t) => t.key === "hook" || t.key.startsWith("beat:"))
      .flatMap((t) => {
        const parts = clauses(t.text);
        return parts.map((sentence, k) => ({
          key: `${t.key}#${k}`,
          // The writer's keywords describe the whole line; a clause of it asks for what it says itself.
          show:
            t.key === "hook"
              ? "the most striking picture of the main character: large in the frame, face visible, easy to read on a phone"
              : parts.length > 1
                ? "exactly what this clause says"
                : [t.want, ...t.keywords].join(", "),
          sentence,
        }));
      });
    clauses(script.pulse_take.narration).forEach((sentence, k) =>
      targets.push({ key: `take#${k}`, show: "what the line says", sentence }),
    );
    const order = new Map<VisualAsset, number>();
    try {
      const ranked = await rankStills(
        s.llm,
        targets,
        frames.map((a) => ({ file: path.join(dir, a.file) })),
        path.join(dir, "stillscore"),
        undefined,
        "frames",
      );
      for (const p of ranked.picks) {
        const a = frames[p.image]!;
        a.label = p.label;
        const [line, clause] = p.key.split("#");
        order.set(a, targets.findIndex((t) => t.key === p.key));
        a.forWords = targets.find((t) => t.key === p.key)?.sentence;
        if (line === "hook") {
          a.role = "hook";
          a.beatIndex = undefined;
        } else if (line!.startsWith("beat:")) {
          a.role = undefined;
          a.beatIndex = Number(line!.slice(5));
        }
        else a.beatIndex = undefined;
        void clause;
      }
      for (const [i, x] of ranked.focus?.entries() ?? [])
        if (frames[i]) frames[i]!.focusX = x;
      // A frame with no clear subject (spray, fog) shows nothing once it is cropped tall.
      if (ranked.focus?.size)
        for (const [i, a] of frames.entries())
          if (!ranked.focus.has(i) && !order.has(a) && images.includes(a) && images.length > 12)
            images.splice(images.indexOf(a), 1);
      for (const i of ranked.withText) {
        const at = images.indexOf(frames[i]!);
        if (at >= 0 && images.length > 12) images.splice(at, 1);
      }
    } catch (err) {
      log("warn", "trailer frames not ranked", { episode: ep.id, error: errorMessage(err) });
    }
    await fs.rm(path.join(dir, "stillscore"), { recursive: true, force: true }).catch(() => undefined);
    // The frames the editor chose lead, in the order of the lines, ahead of the moments and the pool.
    images.sort((x, y) => (order.get(x) ?? 999) - (order.get(y) ?? 999));
  }
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
  // Publishers' press pictures of the story's game (src/assets/press.ts, LIBRARY_PRESS): an announcement's key
  // art and screenshots from Xbox Wire, the PlayStation Blog and the other press sites, credited on screen.
  if (!ranking && script.game_title)
    images.push(
      ...(await pressForShort(
        {
          searchPress: s.searchPress && ((g) => s.searchPress!(g)),
          downloadPhoto: (i, d) => s.downloadPhoto(i, d),
        },
        dir,
        script.game_title,
        new Set(images.map((i) => i.sourceUrl)),
      )),
    );
  // Last, and only for what the published art leaves blank: frames of a tight-cap publisher's own trailer (Rockstar).
  if (
    !ranking &&
    s.cfg.shortCappedStills > 0 &&
    s.trailerFrames &&
    official.trailer &&
    official.trailer.clipSeconds > 0 &&
    official.trailer.clipSeconds <= TIGHT_CAP_SECONDS
  ) {
    const count = framesNeeded(
      narrationSeconds,
      clips.reduce((n, c) => n + c.durationSeconds, 0),
      images.filter((i) => !i.file.endsWith("official_trailer.jpg")).length,
      s.cfg.shortCappedStills,
    );
    if (count > 0) {
      const frames = await s
        .trailerFrames(official.trailer, dir, script.game_title, count, s.cfg.shortClipTextCheck)
        .catch((err) => {
          log("warn", "trailer frames failed", { error: errorMessage(err) });
          return [] as VisualAsset[];
        });
      images.push(...frames);
      await logEvent(s.db, ep.id, "trailer_frames", { wanted: count, used: frames.length });
    }
  }
  // Ranking Shorts: each entry brings its own box art and one trailer moment, tagged with its line.
  if (script.entries?.length) {
    const sorted = [...script.entries].sort((a, b) => b.rank - a.rank);
    for (const [beatIndex, entry] of sorted.entries()) {
      // Footage first on a Short: the entries share the publisher's budget, a few clean moments each.
      const entryFill =
        shortFill && ep.lane !== "longform" && gatherBudget.elapsedMinutes() < s.cfg.shortGatherMaxMinutes / 2
          ? { ...shortFill, seconds: DEFAULT_FOOTAGE_SECONDS / Math.max(1, sorted.length) }
          : undefined;
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
        // Out of time, or an urgent long video waiting for the lane: this and the entries after it get no
        // gather of their own (the thin-entry top-up and the plate cover them), reported once.
        if (await gatherBudget.exhausted()) {
          if (!budgetReported) {
            budgetReported = true;
            await reportGatherStop(
              s.db,
              (m) => s.notify(m),
              ep,
              gatherBudget,
              sorted.length - beatIndex,
            );
          }
          continue;
        }
        // A long-form entry with a shot list: a picture for every sentence.
        if (
          ep.lane === "longform" &&
          entry.moments?.length &&
          script.evergreen_format !== "documentary"
        ) {
          await gatherBudget.within(
            gatherLongEntryMedia(
            s,
            script,
            entry,
            beatIndex,
            dir,
            images,
            clips,
              gatherBudget,
            ),
            undefined,
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
          await gatherBudget.within(
            gatherChapterMedia(
            s,
            script,
            entry,
            beatIndex,
            dir,
            images,
            clips,
              gatherBudget,
            ),
            undefined,
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
            undefined,
            entryFill,
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
              durationSeconds: Math.min(
                c.durationSeconds ?? 4,
                entryFill?.seconds ? 4.8 : 4,
              ),
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
          undefined,
          entryFill,
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
            durationSeconds: Math.min(
              c.durationSeconds ?? 4,
              long || entryFill?.seconds ? 4.8 : 4,
            ),
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
  // A Short about an older release shows that release: the store page and the publisher's trailer are of its later
  // remake, so they go (a line that names the later version keeps its own clip) and IGDB's stills of the right year
  // come in. Owner's rule, 5 Nov 2026: 2012 pictures over the 2005 story are a failure, better caught before the voice.
  let eraDropped = false;
  const storeDate = app?.details?.release_date?.date as string | undefined;
  if (
    s.cfg.shortEraMatch &&
    !ranking &&
    ep.lane !== "longform" &&
    eraConflict(script.story_year, storeDate)
  ) {
    eraDropped = true;
    const keptClips = clips.filter(
      (c) =>
        c.beatIndex !== undefined &&
        lineNamesLaterVersion(script.beats[c.beatIndex]?.narration, storeDate),
    );
    const lateArt = new Set([...art, ...official.stills].map((a) => a.file));
    const before = { clips: clips.length, images: images.length };
    clips.splice(0, clips.length, ...keptClips);
    images.splice(
      0,
      images.length,
      ...images.filter((a) => !lateArt.has(a.file)),
    );
    for (const a of await s
      .igdbArt(mediaTitle(script.game_title), script.story_year, dir, rich ? 12 : 8)
      .catch(() => [] as VisualAsset[])) {
      const y = Number(a.provenance.match(/\((\d{4})\)/)?.[1]);
      if (!y || Math.abs(y - script.story_year!) <= 2) images.push(a);
    }
    await logEvent(s.db, ep.id, "era_match", {
      story: script.story_year,
      store: storeDate,
      before,
      after: { clips: clips.length, images: images.length },
    });
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
    // A press picture is screened like a screenshot: a webcam or gore is never used.
    if (
      (f.webcam || f.gore) &&
      (shots[k]!.kind === "screenshot" || isPressProvenance(shots[k]!.provenance))
    )
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
      ...(a.then ? { then: true } : {}),
      ...(a.frame ? { frame: true } : {}),
      ...(a.focusX !== undefined ? { focusX: a.focusX } : {}),
      ...(a.forWords ? { forWords: a.forWords } : {}),
      ...(a.role ? { role: a.role } : {}),
    });
  }
  // What the newer picture libraries gave this Short, in its log and the owner's note (long videos: after the top-up).
  if (!isLongEpisode(ep) && !rich)
    await reportLibraries(s, ep.id, `Short "${script.headline}"`, out, clips);
  // Lead with the most cinematic art; screenshots fill the middle.
  const rank: Record<string, number> = {
    hero: 0,
    photo: 1,
    article: 2,
    capsule: 3,
    screenshot: 4,
    header: 5,
  };
  // A Short's whole footage from a capped publisher stays under that cap, however many entries asked for some: the
  // opening moment, then the winner backwards (a ranking of one publisher's series got 45 s of Rockstar, 5 Nov 2026).
  const shortClips = isLongEpisode(ep) ? clips : capPublisherTotal(clips);
  return {
    images: out.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9)),
    // A copy: an entry's gather left behind by the budget may still push into the live array for a while.
    clips: [...shortClips],
    officialTrailer: official.trailer,
    ...(eraDropped ? { eraDropped } : {}),
  };
}

/**
 * "Steve Hammond / CC BY-SA 2.0 / Wikimedia Commons" for a licensed photo (Commons, Flickr, Openverse, Pixabay),
 * "Image: Xbox press" for a publisher's press picture, else nothing (src/assets/libraries.ts photoCreditOf).
 */
export function photoCredit(i: {
  kind: string;
  provenance?: string;
}): string | undefined {
  return photoCreditOf(i);
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
        provenance: photoProvenance(img),
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

/**
 * A chapter's sentences in order: the ones its shot list (entry.moments) was written for. A ranking's chapters
 * are its entries, one "rank" beat each (31 Oct 2026: before, a ranking's came back empty, so its picture top-up
 * and graphics for bare lines worked without the words).
 */
export function chapterSentences(script: Script, chapter: number): string[] {
  const out: string[] = [];
  let c = -1;
  for (const b of script.beats) {
    if (b.visual?.kind === "chapter" || b.visual?.kind === "rank") c++;
    if (c === chapter) out.push(...sentencesOf(b.narration));
  }
  return out;
}

/**
 * The footage asks of a documentary chapter, one per in-game sentence of its shot list, so a matched clip
 * plays on the sentence that names it (29 Oct 2026: chapters played their footage in gathering order and
 * barely one shot in ten showed what the narrator said). Real-world sentences (B-roll) get photos instead.
 */
export function docShotTargets(
  entry: NonNullable<Script["entries"]>[number],
  sentences: string[],
  beatIndex: number,
): FootageTarget[] {
  return (entry.moments ?? []).flatMap((m, k) =>
    m.broll?.trim()
      ? []
      : [
          {
            key: `beat:${beatIndex}#m${k}`,
            text: `${sentences[k] ?? ""} (show: ${m.show})`,
            want: "gameplay" as const,
            energy: "medium" as const,
            // A named real person is left out of the keywords: licensed gameplay has no footage of Sam
            // Houser, and the search for a "mission" by that name costs YouTube quota (29 Oct 2026).
            keywords: [
              entry.game_title,
              ...m.keywords.filter((x) => x !== m.person),
            ].slice(0, 4),
          },
        ],
  );
}

/** Up to n items spread evenly across a list, so a chapter's late sentences are asked for too. */
function spreadPick<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  return Array.from(
    { length: n },
    (_, i) => xs[Math.floor((i * xs.length) / n)]!,
  );
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
  /** The gather's time budget: past it the slow fetches (own recordings, licensed gameplay) are skipped. */
  budget?: GatherBudget,
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
    // Past the gather budget the entry keeps its art and stops here: no own recordings, no licensed gameplay.
    if (budget?.over()) throw new GatherOutOfTime();
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
    if (missing.length && !budget?.over())
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
    if (!(err instanceof GatherOutOfTime))
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
export async function gatherChapterMedia(
  s: Services,
  script: Script,
  entry: NonNullable<Script["entries"]>[number],
  beatIndex: number,
  dir: string,
  images: Array<VisualAsset & { beatIndex?: number }>,
  clips: NonNullable<EpisodeAssets["clips"]>,
  /** The gather's time budget: past it each remaining fetch block (footage, gameplay, photos, stock) is skipped. */
  budget?: GatherBudget,
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
    if (
      a &&
      (trailerMatchesGame(a.name, entry.game_title, franchise) ||
        sameNumberedGame(a.name, franchise))
    ) {
      eapp = a;
      break;
    }
  }
  // Footage from a re-release says so on screen instead of wearing the original's year (29 Oct 2026 review:
  // 2021 Definitive Edition footage captioned 2001).
  const RERELEASE = /definitive|remaster|trilogy|enhanced|\bHD\b|anniversary/i;
  // So does footage from the living version of a game whose first release is gone (FFXIV's 2010 chapters).
  const laterVersion =
    eapp &&
    !trailerMatchesGame(eapp.name, entry.game_title, franchise) &&
    sameNumberedGame(eapp.name, franchise);
  const sameTitle =
    eapp &&
    eapp.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ===
      entry.game_title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const remaster =
    eapp &&
    ((RERELEASE.test(eapp.name) && !RERELEASE.test(entry.game_title)) ||
      laterVersion ||
      (distinguishing(entry.game_title, franchise).length === 0 && !sameTitle))
      ? `FOOTAGE: ${eapp.name.toUpperCase()} · STEAM`
      : undefined;
  const pushClip = (c: VisualAsset) =>
    clips.push({
      file: rel(c.file),
      sourceUrl: c.sourceUrl,
      provenance: c.provenance,
      durationSeconds: Math.min(c.durationSeconds ?? 4, 4.8),
      beatIndex,
      moment: c.moment,
      credit: remaster,
      role: undefined,
      motion: c.motion,
      luma: c.luma,
      label: c.label,
      reason: c.reason,
      startSeconds: c.startSeconds,
    });
  // Footage is asked for sentence by sentence from the shot list; a chapter written before the shot list
  // existed falls back to its paragraphs.
  const sentences = chapterSentences(script, beatIndex);
  const shots = docShotTargets(entry, sentences, beatIndex);
  const paragraphTargets = (n: number, tag: string): FootageTarget[] =>
    chapterFootage(script, beatIndex)
      .slice(0, n)
      .map((f, k) => ({
        key: `beat:${beatIndex}#${tag}${k + 1}`,
        text: `${entry.game_title}: ${f.keywords.join(", ")}`,
        want: f.want,
        energy: "medium" as const,
        keywords: [entry.game_title, ...f.keywords].slice(0, 4),
      }));
  const tagged = () =>
    new Set(
      clips
        .filter((c) => c.beatIndex === beatIndex && c.moment !== undefined)
        .map((c) => c.moment!),
    );
  if (!budget?.over())
  try {
    if (eapp) {
      for (const a of (await s.fetchArt(eapp, edir, 12)).filter(
        (a) => a.kind !== "logo",
      ))
        images.push({ ...a, file: rel(a.file), beatIndex });
      if (s.cfg.footage) {
        const targets: FootageTarget[] = shots.length
          ? spreadPick(shots, 24)
          : paragraphTargets(Math.max(1, s.cfg.docClipsPerChapter), "");
        if (targets.length)
          for (const c of capFootage(
            await s.fetchClips(
              eapp,
              edir,
              targets,
                Math.max(
                  s.cfg.docClipsPerChapter,
                  Math.min(16, targets.length),
                ),
              scopeOf(script),
            ),
            footageBudgetSeconds(eapp),
            4.8,
          ))
            pushClip(c);
      }
    } else if (s.cfg.footage) {
      const want = chapterFootage(script, beatIndex)[0];
      const asks: FootageTarget[] = shots.length
        ? spreadPick(shots, 12)
        : [
            {
              key: `beat:${beatIndex}`,
              text: entry.game_title,
              want: want?.want ?? "gameplay",
              energy: "medium",
              keywords: want?.keywords ?? [entry.game_title],
            },
          ];
      const om = await s
        .fetchOfficialMedia(
          entry.game_title,
          edir,
          asks,
          asks.length,
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
  // Licensed gameplay: real moments for the in-game sentences no trailer shot matched, credited.
  // Not for a game from this year on (30 Oct 2026 review: the GTA VI chapter's "gameplay" was a fake upload full
  // of Spider-Man, Sonic and Minions mods, and re-uploads of Rockstar's trailers wrongly marked Creative Commons).
  // Before a game is out, uploaded "gameplay" can only be fake or someone else's trailer.
  const upcoming = upcomingGame(entry.year);
  if (upcoming)
    log("info", "documentary gameplay skipped: the game is not out", {
      game: entry.game_title,
      year: entry.year,
    });
  if (!upcoming && !budget?.over())
    try {
      const done = tagged();
      const open = shots.filter(
        (t) => !done.has(Number(t.key.match(/#m(\d+)$/)?.[1])),
      );
      const have = clips.filter((c) => c.beatIndex === beatIndex).length;
      const targets: FootageTarget[] = shots.length
        ? spreadPick(open, 16)
        : have < 6
          ? paragraphTargets(4, "g")
          : [];
      if (targets.length) {
        // The owner's own recordings of this game come first (owner, 28 Oct 2026); licensed gameplay fills the rest.
        const own = await s
          .ownClips(
            entry.game_title,
            franchise,
            edir,
            targets,
            Math.ceil(targets.length / 2),
          )
          .catch(() => [] as VisualAsset[]);
        for (const c of own)
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
        for (const c of await s.gameplayClips(
          entry.game_title,
          franchise,
          entry.year,
          edir,
          targets,
          Math.max(1, targets.length - own.length),
        ))
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
  if (!budget?.over())
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
          provenance: photoProvenance(img),
          beatIndex,
        } as VisualAsset & { beatIndex?: number });
    }
  } catch (err) {
    log("warn", "documentary photos failed", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
  // The people the narration names, on the sentence that names them (29 Oct 2026 review: Sam Houser,
  // Leslie Benzies and the critics only ever got a name tag on an unrelated picture).
  if (!budget?.over())
  try {
    const people = new Map<string, number>();
    for (const [k, m] of (entry.moments ?? []).entries()) {
      const p = m.person?.trim();
      if (p && p.split(/\s+/).length >= 2 && !people.has(p)) people.set(p, k);
    }
    let n = 0;
    for (const [person, k] of [...people].slice(0, DOC_PEOPLE_PER_CHAPTER)) {
        const found = (await s.searchPhotos(person).catch(() => [])).slice(
          0,
          8,
        );
      if (!found.length) continue;
      const [pick] = await pickPhotos(
        s.llm,
        {
          franchise,
          game: entry.game_title,
          title: `${person}, the real person`,
          opening: `${sentences[k] ?? ""} Keep only a photo of ${person} themself, never a game character, a building or someone else.`,
        },
        found,
      ).catch(() => [] as number[]);
      const img = pick === undefined ? undefined : found[pick];
      if (!img) continue;
      const file = rel(path.join("assets", `person_${n++}.jpg`));
      if (await s.downloadPhoto(img, path.join(dir, file)))
        images.push({
          kind: "photo",
          file,
          sourceUrl: img.pageUrl,
          provenance: photoProvenance(img),
          beatIndex,
          moment: k,
          label: person.toUpperCase(),
        } as VisualAsset & { beatIndex?: number });
    }
  } catch (err) {
    log("warn", "documentary people photos failed", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
  // Real-world B-roll: licensed stock for the sentences the shot list marks (the studio, money, a leak),
  // played on its own sentence and labelled illustrative on screen.
  if (!budget?.over())
  try {
    const asked: FootageTarget[] = (entry.moments ?? [])
      .map((m, k) => ({ m, k }))
      .filter((x) => x.m.broll?.trim())
      .map(({ m, k }) => ({
        key: `beat:${beatIndex}#m${k}`,
        // The sentence itself, so the picture editor judges the preview against what is said.
        text: `${sentences[k] ?? ""} (show: ${m.broll})`,
        want: "cinematic" as const,
        energy: "medium" as const,
        keywords: [m.broll!],
      }));
    // A stock theme ("office at night") at most STOCK_THEME_MAX times in the whole video (src/assets/repeats.ts).
    const capped = capStockTargets(
      asked,
      clips,
      (t) => stockQuery(t, franchise.split(/\s+/)),
      s.cfg.stockThemeMax,
    );
    if (capped.dropped.length)
      log("info", "documentary B-roll: repeated stock themes skipped", {
        game: entry.game_title,
        skipped: capped.dropped.map((t) => t.keywords[0]),
      });
    const targets = capped.kept.slice(0, DOC_BROLL_PER_CHAPTER);
    if (targets.length)
      for (const c of await s.fetchStock(
        edir,
        targets,
        franchise.split(/\s+/),
        targets.length,
        clips.map((c) => c.sourceUrl).filter((u): u is string => !!u),
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
          credit: stockCredit(c.provenance),
        });
  } catch (err) {
    log("warn", "documentary B-roll failed", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
  // The picture editor, as the ranked videos have it: every still and photo of the chapter is looked at and
  // each sentence gets the one showing what it names; pictures carrying text are kept off the screen.
  const moments = entry.moments ?? [];
  if (!moments.length) return;
  try {
    const stills = images.filter(
      (i) =>
        i.beatIndex === beatIndex &&
        i.kind !== "capsule" &&
        i.moment === undefined,
    );
    const placed = new Set(
      images
        .filter((i) => i.beatIndex === beatIndex && i.moment !== undefined)
        .map((i) => i.moment!),
    );
    const noText = new Set<VisualAsset>();
    for (let b = 0; b < stills.length; b += 24) {
      const batch = stills.slice(b, b + 24);
      const want = moments
        .map((m, k) => ({
          key: `m${k}`,
          show: m.show,
          sentence: sentences[k] ?? "",
        }))
        .filter((t) => !placed.has(Number(t.key.slice(1))));
      if (!want.length) break;
      const ranked = await rankStills(
        s.llm,
        want,
        batch.map((a) => ({ file: path.join(dir, a.file) })),
        path.join(edir, `stillscore_${b}`),
        scopeOf(script),
        "documentary",
      );
      for (const [i, a] of batch.entries()) {
        a.label ??= ranked.labels.get(i);
        if (ranked.withText.has(i)) noText.add(a);
      }
      for (const p of ranked.picks) {
        batch[p.image]!.moment = Number(p.key.slice(1));
        placed.add(Number(p.key.slice(1)));
      }
    }
    // Text-laden pictures leave, unless that would leave the chapter almost bare.
    if (stills.length - noText.size >= 3)
      for (const a of noText) {
        const at = images.indexOf(a as never);
        if (at >= 0 && a.moment === undefined) images.splice(at, 1);
      }
    log("info", "documentary chapter pictures matched", {
      game: entry.game_title,
      sentences: moments.length,
      withPicture: placed.size,
      withFootage: tagged().size,
      stills: stills.length,
      textDropped: noText.size,
    });
  } catch (err) {
    log("warn", "documentary still ranking failed", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
}

/** A game from this calendar year or later: its uploaded "gameplay" is not trusted in a documentary. */
export function upcomingGame(
  year: number | undefined,
  now = new Date(),
): boolean {
  return !!year && year >= now.getFullYear();
}

/** The share of a long video's sentences with a clip or still chosen for that sentence (moments[entry][k]). */
export function matchedShare(
  moments: unknown[][],
  images: Array<{ beatIndex?: number; moment?: number }>,
  clips: Array<{ beatIndex?: number; moment?: number }>,
): number {
  const total = moments.reduce((n, m) => n + m.length, 0);
  if (!total) return 0;
  const hit = new Set(
    [...images, ...clips]
      .filter((x) => x.beatIndex !== undefined && x.moment !== undefined)
      .map((x) => `${x.beatIndex}:${x.moment}`),
  );
  let n = 0;
  for (const [e, ms] of moments.entries())
    for (let k = 0; k < ms.length; k++) if (hit.has(`${e}:${k}`)) n++;
  return n / total;
}

/**
 * Which of a long video's chapters are about one game: a series whose name ends in its number means one game in all
 * its versions, so its chapters may share their footage. A franchise's chapters are different games, and stay apart.
 */
export function sameGameGroups(
  script: Pick<Script, "entries" | "game_title">,
): Array<number | undefined> | undefined {
  const sorted = [...(script.entries ?? [])].sort((a, b) => b.rank - a.rank);
  const groups = sorted.map((e) =>
    sameNumberedGame(e.game_title, script.game_title) ? 0 : undefined,
  );
  return groups.some((g) => g !== undefined) ? groups : undefined;
}

/**
 * The sentences a stock shot must keep off: those that name a real person the shot list knows about, by the moment's
 * own "person" or by surname anywhere in the sentence. A stock man at a desk under "Yoshida" reads as Yoshida.
 */
export function linesNamingPeople(
  moments: ReadonlyArray<{ person?: string }>,
  sentences: readonly string[],
  all: ReadonlyArray<{ person?: string }> = moments,
): boolean[] {
  const surnames = [
    ...new Set(
      all
        .flatMap((m) => (m.person ?? "").split(/[,&]| and /))
        .map((p) => p.trim().split(/\s+/).at(-1) ?? "")
        .filter((n) => n.length >= 3),
    ),
  ];
  return moments.map((m, k) => {
    if (m.person?.trim()) return true;
    const line = sentences[k] ?? "";
    return surnames.some((n) =>
      new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(line),
    );
  });
}

/** Licensed stock shots a documentary chapter may use for its real-world sentences. */
const DOC_BROLL_PER_CHAPTER = 5;
/** Named real people a documentary chapter looks up photos of. */
const DOC_PEOPLE_PER_CHAPTER = 5;

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
  // One context in spoken order, as the voice was given it (narrationOf and the desk parts do the same).
  const ctx = speakContext();
  return [
    // The same speakable text the voice was given, so segment timings line up word for word.
    { kind: "hook", text: speakable(script.hook, ctx) },
    ...script.beats.map((b) => ({
      kind: "beat" as const,
      text: speakable(b.narration, ctx),
      visual: b.visual,
    })),
    // The desk partner's question sits between the facts and the take when the Short has one.
    ...(desk && script.desk_question
      ? [{ kind: "desk" as const, text: speakable(script.desk_question, ctx) }]
      : []),
    {
      kind: "take",
      text: speakable(script.pulse_take.narration, ctx),
      label: script.pulse_take.label,
      visual: {
        kind: "title" as const,
        primary: script.pulse_take.on_screen,
        secondary: "",
      },
    },
    // The same tidied last line the voice was given, so timings line up.
    { kind: "loop", text: speakable(tidyLoopLine(script.loop_line), ctx) },
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

export function variantOf(id: string): number {
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

/**
 * The PC goes to the Shorts first: a long render does not start while a Short's window (the same windows the PC
 * orchestrator keeps free, src/pcschedule.ts) is open or would open before it is done. It looks again in five
 * minutes (undefined); on a busy afternoon that can mean the evening, and a long video past its slot goes out
 * once made. In a gap it returns how long its turn may wait in the orchestrator's queue (behind an Orryy
 * render, say): until half an hour before the next Short's window, after which it would take that Short's place.
 */
async function longRenderGap(
  s: Services,
  ep: Episode,
): Promise<number | undefined> {
  const minutes = longRenderMinutes();
  const now = s.now().getTime();
  const ahead = await shortWindows(
    s.db,
    s.cfg,
    s.now(),
    ep.slot_at ? new Date(ep.slot_at) : undefined,
  );
  const clash = ahead.find((w) => Date.parse(w.from) < now + minutes * 60_000);
  if (!clash) {
    const next = Math.min(...ahead.map((w) => Date.parse(w.from)));
    return Math.min(180, (next - now) / 60_000 - INHERIT_MINUTES);
  }
  await deferLong(s, ep);
  log("info", "long render waits for a Short's slot", {
    episode: ep.id,
    lane: clash.lane,
    window: `${clash.from} to ${clash.until}`,
    note: clash.note,
    minutes: Math.round(minutes),
  });
  return undefined;
}

/** Looks again in five minutes; not a failure, so no attempt is used. */
async function deferLong(s: Services, ep: Episode): Promise<void> {
  await s.db.query(`UPDATE episodes SET next_attempt_at = $2 WHERE id = $1`, [
    ep.id,
    new Date(s.now().getTime() + 5 * 60_000),
  ]);
}

/** The long-form 16:9 render: its own plan, composition, QA band and thumbnail. */
async function stepRenderLong(s: Services, ep: Episode): Promise<void> {
  const dir = episodeDir(s.cfg, ep.id);
  const script = ep.script_json!;
  const assets = { ...(ep.assets_json ?? {}) };
  if (!assets.images) {
    // The shot list is final: the owner gets a "record these moments" list when it covers a game they play.
    // A video about the owner's games waits for their recordings: the list goes out now, and the footage
    // is gathered CAPTURE_GATHER_LEAD_HOURS before the slot.
    const holdUntil = await captureHold(s, ep);
    if (holdUntil) {
      await s.db.query(
        `UPDATE episodes SET next_attempt_at = $2 WHERE id = $1`,
        [ep.id, holdUntil],
      );
      log("info", "footage waits for the owner's recordings", {
        episode: ep.id,
        until: holdUntil.toISOString(),
      });
      return;
    }
    Object.assign(assets, await gatherMedia(s, ep, dir));
    await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(assets),
    ]);
  }
  // Which long-video craft this format gets (src/longformat.ts), each behind its own setting.
  const craft = longCraft(script, s.cfg);
  const kind = longKindLabel(craft.format);
  // Footage first (src/assets/footagestep.ts; owner, 31 Oct 2026: "loads of gameplay footage" instead of stills):
  // before the picture top-up, each released game's chapter gathers licensed gameplay until moving footage can
  // carry FOOTAGE_SHARE_TARGET of its narration, junk refused at intake. Once per video (FOOTAGE_FIRST).
  if (
    s.cfg.footageFirst &&
    s.footageFirstDeps &&
    !assets.footageFirst &&
    assets.images &&
    script.entries?.some((e) => e.moments?.length)
  ) {
    assets.clips ??= [];
    assets.footageFirst = await runFootageFirst({
      deps: s.footageFirstDeps(),
      chapters: [...script.entries]
        .sort((a, b) => b.rank - a.rank)
        .map((e, i) => ({
          entry: i,
          game: e.game_title,
          franchise: script.game_title || e.game_title,
          year: e.year,
          moments: e.moments ?? [],
          sentences: chapterSentences(script, i),
        })),
      clips: assets.clips,
      dir,
      options: footageOptions(s.cfg),
      headline: script.headline,
      logEvent: (kind, detail) => logEvent(s.db, ep.id, kind, detail),
      notify: (m) => s.notify(m),
    });
    // A plan made before the new clips existed would never play them.
    if (assets.footageFirst.kept) delete assets.longPlan;
    await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(assets),
    ]);
  }
  // Every sentence still without a picture or graphic of its own is searched for on its own, once per video
  // (src/assets/fill.ts; owner, 30 Oct 2026: "all videos must be fully media rich all the way through").
  if (
    !assets.filled &&
    assets.images &&
    script.entries?.some((e) => e.moments?.length)
  ) {
    const chapters = [...script.entries]
      .sort((a, b) => b.rank - a.rank)
      .map((e, i) => ({
        entry: i,
        game: e.game_title,
        year: e.year,
        moments: e.moments ?? [],
        sentences: chapterSentences(script, i),
      }));
    assets.clips ??= [];
    // Scene lines nothing filmed can show get a drawn concept sketch, tagged ILLUSTRATION, when switched on
    // (ILLUSTRATE_ENABLED, off by default; src/assets/illustrate.ts). Off, nothing here changes. A server that
    // does not answer (closed on the PC, or none on the Mac) skips them for this video, said once.
    const comfyUp =
      s.cfg.illustrate &&
      (s.cfg.illustrateStub || (await comfyReachable(s.cfg.illustrateUrl)));
    if (s.cfg.illustrate && !comfyUp) {
      await logEvent(s.db, ep.id, "sketches_skipped", {
        url: s.cfg.illustrateUrl,
      });
      await s.notify({
        level: "info",
        content: `${kind} "${script.headline}": no concept sketches this time, because the image server (ComfyUI at ${s.cfg.illustrateUrl}) is not answering. Those lines get a graphic or stay on the game's pictures. Setting: ILLUSTRATE_URL.`,
      });
    }
    const sketches = comfyUp
      ? createSketchRun({
          llm: s.llm,
          dir,
          episodeId: ep.id,
          url: s.cfg.illustrateUrl,
          max: s.cfg.illustrateMax,
          stub: s.cfg.illustrateStub,
          timeoutMs: s.cfg.illustrateTimeoutSeconds * 1000,
        })
      : undefined;
    const r = await fillSentencePictures(
      s,
      dir,
      chapters,
      assets.images,
      assets.clips,
      script.game_title || script.headline,
      scopeOf(script),
      sketches?.forChapter,
      { stockThemeMax: s.cfg.stockThemeMax },
    );
    assets.filled = { before: r.before, after: r.after };
    // What the newer picture libraries gave the whole video, in its log and the owner's note.
    await reportLibraries(
      s,
      ep.id,
      `${kind} "${script.headline}"`,
      assets.images ?? [],
      assets.clips ?? [],
    );
    if (r.stockCapped) {
      await logEvent(s.db, ep.id, "stock_themes_capped", {
        skipped: r.stockCapped,
        max: s.cfg.stockThemeMax,
      });
      await s.notify({
        level: "info",
        content: `${kind} "${script.headline}": ${r.stockCapped} stock clip${r.stockCapped === 1 ? "" : "s"} not fetched because the video already has ${s.cfg.stockThemeMax} of that theme (such as "office at night"); those lines get a graphic or stay on the game's footage. Setting: STOCK_THEME_MAX.`,
      });
    }
    if (sketches) {
      const sum = sketches.summary();
      assets.sketches = sum;
      await logEvent(s.db, ep.id, "sketches", {
        ...sum,
        animated: s.cfg.sketchAnimation,
      });
      if (sum.asked)
        await s.notify({
          level: "info",
          content: `${kind} "${script.headline}": ${sum.kept} concept sketch${sum.kept === 1 ? "" : "es"} drawn for lines nothing filmed can show (${sum.asked} asked, ${sum.dropped} refused by the picture editor, ${sum.failed} not drawn; ${sum.seconds}s). Each is tagged ILLUSTRATION on screen${s.cfg.sketchAnimation ? " and animated: drawn on, stop-motion paper, flipbook, light table or cork board (SKETCH_ANIMATION)" : " as a framed print (SKETCH_ANIMATION=false)"}. Setting: ILLUSTRATE_ENABLED.`,
        });
      // A few kept sketches of lines with movement come to life on this PC's video model (off by default).
      if (s.cfg.illustrateVideo && sum.kept)
        await animateSketches({
          chapters: chapters as never,
          images: assets.images,
          clips: assets.clips as never,
          dir,
          episodeId: ep.id,
          url: s.cfg.illustrateUrl,
          max: s.cfg.illustrateVideoMax,
          stub: s.cfg.illustrateVideoStub,
          timeoutMs: s.cfg.illustrateVideoTimeoutSeconds * 1000,
          headline: script.headline,
          logEvent: (kind, detail) => logEvent(s.db, ep.id, kind, detail),
          notify: (m) => s.notify(m),
        });
    }
    // The graphics pass writes into the shot list (script.entries[].moments), so the script is kept too.
    await s.db.query(
      `UPDATE episodes SET assets_json = $2, script_json = $3 WHERE id = $1`,
      [ep.id, JSON.stringify(assets), JSON.stringify(script)],
    );
  }
  // A filler visual for each long video's line still bare or on stock (kinetic type, a diagram, a document, a
  // drawn scene, silhouettes or an in-game reconstruction; src/assets/fillers.ts), once per video and behind
  // FILLERS_ENABLED. The picks are written on the shot list, so the plan is made again with them.
  if (
    craft.fillers &&
    !assets.fillersChosen &&
    assets.images &&
    script.entries?.some((e) => e.moments?.length)
  ) {
    const done = await chooseEpisodeFillers({
      cardShare: s.cfg.longCardShare,
      chapters: [...script.entries]
        .sort((a, b) => b.rank - a.rank)
        .map((e, i) => ({
          entry: i,
          game: e.game_title,
          year: e.year,
          moments: (e.moments ?? []) as never,
          sentences: chapterSentences(script, i),
        })),
      images: assets.images,
      clips: assets.clips ?? [],
      variant: variantOf(ep.id),
      sketches: s.cfg.illustrate,
      check: episodeClipCheck(dir),
      now: s.now(),
      headline: script.headline,
      kind,
      logEvent: (kind, detail) => logEvent(s.db, ep.id, kind, detail),
      notify: (m) => s.notify(m),
    });
    if (done) {
      assets.fillersChosen = done;
      delete assets.longPlan;
      await s.db.query(
        `UPDATE episodes SET assets_json = $2, script_json = $3 WHERE id = $1`,
        [ep.id, JSON.stringify(assets), JSON.stringify(script)],
      );
    }
  }
  // Media are kept; everything from here on works this PC, so it waits for a gap between the Shorts.
  if ((await longRenderGap(s, ep)) === undefined) return;
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
  if (s.cfg.parallax && s.cfg.parallaxPython && assets.images?.length) {
    const want = assets.images.filter(
      (i) => !i.layers && LAYERED_KINDS.has(i.kind) && i.aspect >= 1.2,
    );
    if (want.length) {
      const made = await makeParallax(
        s.cfg.parallaxPython,
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
  // Some pictures were stored without their shape (older episodes, some entry art); measure them now, since
  // the framing and the zoom-to-detail maths need it.
  for (const i of assets.images ?? [])
    if (!Number.isFinite(i.aspect))
      i.aspect = await s
        .imageAspect(path.join(dir, i.file))
        .catch(() => 16 / 9);
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
    stock: c.stock,
    // The picture check's words for the clip: a freeze frame's label (src/render/camera.ts freezeLabel).
    label: c.label,
    span: c.span,
  }));
  // A sentence's filler visual, read afresh each time: one the graphics check faulted is left out.
  const fillerAt = (e: number, m: number) =>
    s.cfg.fillers && !(assets.quietMoments ?? []).includes(`${e}:${m}`)
      ? moments[e]?.[m]?.filler
      : undefined;
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
        file: i.file,
      })),
      clips: clips.map((c) => ({
        durationSeconds: c.durationSeconds,
        beatIndex: c.beatIndex,
        role: c.role,
        moment: c.moment,
        span: c.span,
        stock: c.stock,
      })),
      // Footage first: a chapter never replays a moment it has shown (FOOTAGE_FIRST).
      noRepeats: s.cfg.footageFirst,
      sameGame: sameGameGroups(script),
      noStockOn: s.cfg.longStockNotOnPeople
        ? moments.map((e, i) =>
            linesNamingPeople(e, chapterSentences(script, i), moments.flat()),
          )
        : undefined,
      // No one still too long in any minute (LONG_SAME_PICTURE_MAX_SECONDS, src/render/picturecap.ts).
      samePictureMaxSeconds: s.cfg.longSamePictureMaxSeconds,
      stillXfadeFrames: s.cfg.longStillXfadeFrames,
      variant,
      // Real-world photos only on their own sentence (REAL_PHOTOS_PINNED_ONLY; 31 Oct 2026 owner review).
      realPinnedOnly: s.cfg.realPhotosPinnedOnly,
      momentCounts: hasMoments ? moments.map((m) => m.length) : undefined,
      momentKeys: hasMoments
        ? moments.map((e) => e.map(momentKeys))
        : undefined,
      // Each sentence's filler visual (src/assets/fillers.ts) opens it on its own shot.
      momentFillers: hasMoments
        ? moments.map((e, ei) => e.map((_, mi) => fillerAt(ei, mi)))
        : undefined,
      // What each sentence says, shows and names, so the cold open can preview its chapters: a cold-open line
      // that restates a chapter's fact ("production was meant to end by July 1, 1996") finds that sentence's
      // own picture (30 Oct 2026 shot audit: the cold open matched nothing and played unrelated photos).
      momentShows: hasMoments
        ? moments.map((e, i) => {
            const said = chapterSentences(script, i);
            return e.map(
              (m, k) =>
                `${said[k] ?? ""} ${m.show} ${m.person ?? ""} ${m.keywords?.join(" ") ?? ""}`,
            );
          })
        : undefined,
      takeEntry: script.take_entry,
      // The cut rhythm, a ranking's per-entry pace and the bookend ending (src/render/structure.ts).
      rhythm: craft.rhythm,
      entryPace: craft.entryPace,
      bookend: craft.bookend,
      coldOpenFrames: craft.coldOpen ? coldOpenTiming(LONG_FPS).frames : 0,
    });
  const freshPlan = !assets.longPlan;
  let plan = assets.longPlan ?? makePlan();
  if (!assets.longPlan) {
    // Real-world photos pinned to no sentence stay off screen (REAL_PHOTOS_PINNED_ONLY): say how many.
    const withheld =
      hasMoments && s.cfg.realPhotosPinnedOnly
        ? images.filter((i) => realWorldImage(i) && i.moment === undefined)
            .length
      : 0;
    if (withheld)
      await logEvent(s.db, ep.id, "real_photos_withheld", { count: withheld });
    // An entry left on the plate or looping its few clips gets official screenshots from IGDB, then a new plan.
    const ranked = [...(script.entries ?? [])].sort((a, b) => b.rank - a.rank);
    const gaps = planGaps(
      plan,
      segments,
      script.take_entry,
      s.cfg.longSamePictureMaxSeconds,
    );
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
    const left = planGaps(
      plan,
      segments,
      script.take_entry,
      s.cfg.longSamePictureMaxSeconds,
    );
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
  // A video never renders on the empty slate: everything to fill it has been tried by here, so this one stops and says.
  if (hasMoments) {
    const slate = planSlate({
      plan,
      windows: momentWindows(
        segments,
        words,
        moments.map((m) => m.length),
        moments.map((e) => e.map(momentKeys)),
      ),
      moments,
      quiet: assets.quietMoments,
      clips: assets.clips,
    });
    await logEvent(s.db, ep.id, "slate_share", {
      share: Math.round(slate.share * 1000) / 1000,
      plate: Math.round(slate.plateShare * 1000) / 1000,
      footage: Math.round(slate.footageShare * 1000) / 1000,
    });
    if (slate.share > s.cfg.planSlateMax) {
      const line = `${Math.round(slate.share * 100)}% of the video would sit on the empty slate (the most allowed is ${Math.round(s.cfg.planSlateMax * 100)}%)`;
      await s.notify({
        ping: true,
        content: `🛑 Stopped "${script.headline}" before its render: ${line}. Its chapters have too little media. Nothing was rendered.`,
      });
      throw new FatalError(`empty slate: ${line}`);
    }
  }
  // How much of the game chapters' narration plays on moving game footage, against FOOTAGE_SHARE_TARGET.
  if (freshPlan && hasMoments && s.cfg.footageFirst) {
    const fm = measureFootage({
      shots: plan.shots,
      fps: plan.fps,
      segments,
      entryOf: (i) => entryOf(segments, i, script.take_entry),
      clips: assets.clips ?? [],
    });
    await logEvent(s.db, ep.id, "footage_share", {
      share: Math.round(fm.share * 1000) / 1000,
      target: s.cfg.footageShareTarget,
      stock: Math.round(fm.stock),
      perChapter: Object.fromEntries(
        [...fm.perChapter].map(([c, x]) => [c, Math.round(x * 100) / 100]),
      ),
    });
    await s.notify({
      level: "info",
      content: footageShareNotice(
        script.headline,
        fm,
        s.cfg.footageShareTarget,
        [...(script.entries ?? [])]
          .sort((a, b) => b.rank - a.rank)
          .map((e) => e.game_title),
      ),
    });
  }
  // How much of the narration has something chosen for its own words on screen: a picture or clip of its own,
  // or a graphic (29 Oct 2026 review: barely one shot in ten matched; 30 Oct, owner: every video must be media
  // rich all the way through). Logged for every long video; the owner hears when under MEDIA_RICH_TARGET.
  if (hasMoments) {
    const own = matchedShare(moments, images, clips);
    const covered = coverageShare(
      moments.map((m, i) => ({
        entry: i,
        game: "",
        moments: m,
        sentences: [],
      })),
      images,
      clips,
    );
    log(
      covered < MEDIA_RICH_TARGET ? "warn" : "info",
      "sentences with their own picture",
      {
        episode: ep.id,
        share: Math.round(own * 100),
        covered: Math.round(covered * 100),
      },
    );
    if (covered < MEDIA_RICH_TARGET)
      await s.notify({
        content: `🎞️ "${script.headline}": ${Math.round(covered * 100)}% of its sentences have something chosen for their own words (${Math.round(own * 100)}% a picture or clip of their own, the rest a graphic), under the ${Math.round(MEDIA_RICH_TARGET * 100)}% target. It renders anyway; the rest sit on the chapter's footage.`,
      });
  }
  // Each game's own colour, from its key art (src/assets/palette.ts): its chapter's footage is washed in it.
  if (!assets.palette) {
    const entries = [
      ...new Set(
        images
          .map((i) => i.beatIndex)
          .filter((b): b is number => b !== undefined),
      ),
    ];
    const palette: Array<string | null> = [];
    for (const b of entries) {
      const art =
        images.find((i) => i.beatIndex === b && i.kind === "hero") ??
        images.find(
          (i) => i.beatIndex === b && i.aspect >= 1.2 && i.kind !== "photo",
        );
      palette[b] = (art && (await paletteOf(path.join(dir, art.file)))) || null;
    }
    assets.palette = palette;
  }
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
      if (
        !shot ||
        shot.media.type !== "image" ||
        shot.end - from < 3.5 * LONG_FPS
      )
        continue;
      const img = assets.images?.[shot.media.index];
      if (!img || !LAYERED_KINDS.has(img.kind)) continue;
      const label = annotationLabel(
        m,
        ranked[w.entry]?.game_title ?? script.game_title,
      );
      if (!label) continue;
      const box = await locate(path.join(dir, img.file), label);
      if (!box) continue;
      found.push({
        entry: w.entry,
        moment: w.moment,
        image: shot.media.index,
        box,
        label,
      });
      lastAt = from;
    }
    assets.annotations = found;
    await unloadLocalVision();
    log("info", "detail annotations", { episode: ep.id, count: found.length });
  }
  // Named details written in the pictures (src/assets/ocr.ts): a sign or shop front the narrator names gets
  // a hand-drawn circle or arrow from the long video's camera (LONG_CAMERA detail). Once per video.
  const docCamera = craft.camera;
  if (docCamera.length && hasMoments && !assets.textDetails) {
    assets.textDetails = !docCamera.includes("detail")
      ? []
      : await findTextDetails({
      dir,
      fps: LONG_FPS,
      windows: momentWindows(
        segments,
        words,
        moments.map((m) => m.length),
        moments.map((e) => e.map(momentKeys)),
      ),
      moments,
      keys: (e, m) => (moments[e]?.[m] ? momentKeys(moments[e]![m]!) : []),
      shots: plan.shots,
      images,
      brands: [
        script.game_title,
        ...(script.entries ?? []).map((x) => x.game_title),
        "Rockstar",
        "Take-Two",
      ],
      });
    await logEvent(s.db, ep.id, "camera", {
      techniques: docCamera,
      textDetails: assets.textDetails.map((d) => d.label),
    });
    await s.notify({
      level: "info",
      content: cameraNotice(
        script.headline,
        docCamera,
        assets.textDetails.length,
        kind,
      ),
    });
  }
  await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
    ep.id,
    JSON.stringify(assets),
  ]);
  const doc = script.evergreen_format === "documentary";
  // Which craft this long video gets, for the log (src/longformat.ts); once per render attempt.
  await logEvent(s.db, ep.id, "long_craft", longCraftEvent(craft));
  // What the mix will do with the writer's beats and the era beds (src/render/sounddesign.ts), logged and
  // told to the owner in one line; DOC_SOUND_BEATS off means neither.
  if (craft.soundBeats && hasMoments) {
    const sound = soundDesignSummary(
      moments,
      [...(script.entries ?? [])]
        .sort((a, b) => b.rank - a.rank)
        .map((e) => e.year),
      true,
    );
    await logEvent(s.db, ep.id, "sound_design", { ...sound });
    if (sound.total || sound.chapters)
      await s.notify({
        content: soundDesignLine(script.headline, sound, kind),
      });
  }
  // The structure devices (src/render/structure.ts): title drop, chapter index and year, callbacks, cut
  // rhythm, bookend ending; logged and told to the owner in one line. A plan made before them keeps its cuts.
  const docLoops = loopsFor(craft, script.open_loops, () =>
    loopsOfScript(script),
  );
  {
    const structure = structureSummary({
      segments,
      words,
      windows: hasMoments
        ? momentWindows(
            segments,
            words,
            moments.map((m) => m.length),
            moments.map((e) => e.map(momentKeys)),
          )
        : [],
      fps: LONG_FPS,
      breaks: (assets.breaks ?? []).map((b) => ({
        from: Math.round(b.start * LONG_FPS),
        to: Math.round(b.end * LONG_FPS),
      })),
      loops: docLoops,
      plan,
      on: {
        titleDrop: craft.titleDrop,
        chapterIndex: craft.chapterIndex,
        loops: craft.loops !== "off",
        rhythm: craft.rhythm && freshPlan,
        bookend: craft.bookend,
        entryPace: craft.entryPace,
      },
    });
    await logEvent(s.db, ep.id, "doc_structure", {
      ...structure,
      format: craft.format,
    });
    await s.notify({
      content: structureLine(script.headline, structure, kind),
    });
  }
  // The documentary's sound craft (src/render/soundfx.ts, SOUND_* settings): the voice's texture slices made
  // now, and what the mix will place, logged and told to the owner in one line.
  const soundCraft = doc ? s.cfg.soundCraft : undefined;
  let voiceFxFiles: SoundCraftPrep["voiceFxFiles"] = [];
  if (soundCraft && Object.values(soundCraft).some(Boolean)) {
    const prep = await prepareSoundCraft({
      episodeDir: dir,
      voiceFile: assets.audio,
      craft: soundCraft,
      segments,
      words,
      moments: moments.map((ms) =>
        ms.map((m) => ({
          ...m,
          beat: s.cfg.docSoundBeats ? m.beat : undefined,
        })),
      ),
      breaks: assets.breaks,
      shots: plan.shots,
      clips,
      fps: LONG_FPS,
    }).catch((err) => {
      log("warn", "sound soundCraft prep failed", {
        episode: ep.id,
        error: errorMessage(err),
      });
      return undefined;
    });
    voiceFxFiles = prep?.voiceFxFiles ?? [];
    await logEvent(s.db, ep.id, "sound_craft", {
      settings: soundCraft,
      counts: prep?.counts,
      failedSlices: prep?.failed ?? 0,
    });
    if (prep)
      await s.notify({
        level: "info",
        content: soundCraftLine(script.headline, soundCraft, prep.counts),
      });
  }
  // Two alternative titles for the Test & compare (one mid-tier call; a failure only means no title test).
  if (!script.youtube.title_variants) {
    // TITLE_ANGLES: three angles written, the two most distinct from the current title kept (src/editorial/titles.ts).
    const variants = await titleVariants(s.llm, script, {
      angles: s.cfg.titleAngles,
      allow: s.cfg.titleShapeAllow,
    }).catch(() => [] as string[]);
    script.youtube.title_variants = variants;
    await applyTitleShape(s, ep, script);
    await s.db.query(`UPDATE episodes SET script_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(script),
    ]);
  }
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
    images.find(
      (i) =>
        i.layers &&
        i.kind === "hero" &&
        (i.beatIndex === winnerBeat || i.beatIndex === undefined),
    );
  // The thumbnail overhaul (src/render/ThumbStudio.tsx): every design that suits this video, best first;
  // the first is the thumbnail, the next two go to YouTube's Test & compare. The niche study ranked them:
  // a huge subject with a rim and a few words, a giant number, an old game's nostalgia, a hard versus, a
  // circle on the thing that matters; the older designs stay as fallbacks.
  const tag = script.recap ? "THIS WEEK" : doc ? "DOC" : "RANKED";
  const text = thumbTitle(script);
  const entryInfo = (b: number | undefined) => {
    if (b === undefined) return undefined;
    const k = segments.findIndex(
      (x, i) =>
        x.kind === "beat" &&
        (x.visual?.kind === "rank" || x.visual?.kind === "chapter") &&
        entryOf(segments, i) === b,
    );
    const v = k >= 0 ? segments[k]!.visual : undefined;
    return v
      ? {
          year: Number(v.items?.[0]) || undefined,
          game: (v.kind === "rank" ? v.primary : v.secondary) ?? "",
        }
      : undefined;
  };
  // An old game: the thumbnail art's own entry, else the oldest entry with wide art.
  const oldEntry = [thumbArt?.beatIndex, ...images.map((i) => i.beatIndex)]
    .map((b) => ({ b, info: entryInfo(b) }))
    .find((x) => x.info?.year && x.info.year <= 2006 && wide(x.b!));
  const thumbIndex = thumbArt ? images.indexOf(thumbArt) : -1;
  const circled = (assets.annotations ?? []).find(
    (a) => a.image === thumbIndex,
  );
  const base = { headline: text, kicker: tag, game: "", accent: "#FF6B1A" };
  type Candidate = {
    layout: string;
    thumb: Record<string, unknown> & { imageFile: string | null };
  };
  // The video's own look first (src/render/components/motifs): its series', console's or genre's card with
  // the thumbnail's words. Loaded on demand so a motif can never stop a render.
  const motif = await import("./render/components/motifs/index.ts")
    .then(
      (m) =>
        m.motifsFor({
          title: script.headline,
          platforms: "",
          theme: script.recap ? script.headline : script.game_title,
        })[0],
    )
    .catch(() => undefined);
  // Panel-shaped pictures first, one per chapter in turn, logo banners last (src/render/motifpictures.ts):
  // the first six used to be Steam library banners whose empty middle filled the grid's biggest panel.
  const sourceOf = new Map((assets.images ?? []).map((i) => [i.file, i]));
  // Under the hero rule, never a picture of another game (the GTA 6 documentary's Red Dead chapter).
  const motifPictures = motifPictureOrder(
    s.cfg.thumbHeroRule
      ? images.filter((i) => artVerdict(sourceOf.get(i.file)?.provenance, script.game_title) !== "other")
      : images,
  ).map((i) => i.file);
  const candidates: Candidate[] = [
    ...(motif?.card && motifPictures.length
      ? [
          {
            layout: "motif",
            thumb: {
              ...base,
              layout: "motif" as const,
              motif: motif.id,
              game: script.recap ? "" : script.game_title,
              imageFile: thumbArt?.file ?? null,
              fgFile: depthArt?.layers?.fg ?? null,
              pictureFiles: motifPictures,
            },
          },
        ]
      : []),
    ...(depthArt?.layers
      ? [
          {
            layout: "hero",
            thumb: {
              ...base,
              layout: "hero" as const,
              imageFile: depthArt.file,
              fgFile: depthArt.layers.fg,
              subjectX: depthArt.layers.fgx,
            },
          },
        ]
      : []),
    ...(/\d/.test(text) && thumbArt
      ? [
          {
            layout: "number",
            thumb: {
              ...base,
              layout: "number" as const,
              imageFile: thumbArt.file,
            },
          },
        ]
      : []),
    ...(oldEntry
      ? [
          {
            layout: "retro",
            thumb: {
              ...base,
              layout: "retro" as const,
              game: oldEntry.info!.game,
              year: String(oldEntry.info!.year),
              imageFile: wide(oldEntry.b!)!.file,
            },
          },
        ]
      : []),
    ...(lastArt && thumbArt
      ? [
          {
            layout: "clash",
            thumb: {
              ...base,
              layout: "clash" as const,
              imageFile: lastArt.file,
              image2File: thumbArt.file,
              labels: [`#${script.entries![0]!.rank}`, "#1"] as [
                string,
                string,
              ],
            },
          },
        ]
      : []),
    ...(circled && thumbArt
      ? [
          {
            layout: "mystery",
            thumb: {
              ...base,
              layout: "mystery" as const,
              imageFile: thumbArt.file,
              focus: [
                circled.box[0],
                circled.box[1],
                circled.box[2] - circled.box[0],
                circled.box[3] - circled.box[1],
              ] as [number, number, number, number],
            },
          },
        ]
      : []),
    ...(doc && thumbArt
      ? [
          {
            layout: "clipping",
            thumb: {
              ...base,
              kicker: "",
              game: script.recap ? "This week" : script.game_title,
              layout: "clipping" as const,
              imageFile: thumbArt.file,
            },
          },
        ]
      : []),
    {
      layout: "split",
      thumb: {
        headline: text,
        kicker: script.recap ? "THIS WEEK" : doc ? "DOCUMENTARY" : "RANKED",
        game: doc
          ? (script.kicker ?? script.game_title).slice(0, 48)
          : script.criterion
            ? thumbCriterion(script.criterion)
            : script.game_title,
        accent: "#FF6B1A",
        imageFile: thumbArt?.file ?? null,
      },
    },
  ];
  // The hero rule (THUMB_HERO_RULE, src/qa/thumbrule.ts): the GTA grid where it applies, then posters on the art
  // that belongs to the game; with no picture to use, the older designs below carry the release.
  const ruled = s.cfg.thumbHeroRule
    ? await heroRuleDesigns({
        images: images.map((i) => ({
          ...i,
          provenance: sourceOf.get(i.file)?.provenance,
          sourceUrl: sourceOf.get(i.file)?.sourceUrl,
        })),
        script,
        dir,
        grid: candidates.find((c) => c.layout === "motif"),
        motifId: motif?.id,
        look: heroLook,
      }).catch(() => [])
    : [];
  const designs: Candidate[] = ruled.length
    ? ruled
    : s.cfg.thumbHeroRule
      ? heroRuleFallback(
          candidates.find((c) => c.layout === "split")!,
          script,
          sourceOf.get(thumbArt?.file ?? "")?.provenance,
        )
      : candidates;
  const [mainThumb, ...restThumbs] = designs;
  const thumbVariants = restThumbs.slice(0, 2).map((c, i) => ({
    file: path.join(dir, i === 0 ? "thumb_b.jpg" : "thumb_c.jpg"),
    thumb: c.thumb as never,
  }));
  // The series grid's own repair (THUMB_MOTIF_REPAIR, src/qa/thumbrepair.ts): its next layout with the
  // pictures in another order, rendered beside it so a failed grid can be swapped for a grid.
  const motifRepair =
    mainThumb?.layout === "motif" && s.cfg.thumbMotifRepair
      ? {
          file: path.join(dir, "thumb_grid_b.jpg"),
          thumb: {
            ...mainThumb.thumb,
            variant: 1,
            pictureFiles: repairPictures(motifPictures),
          } as never,
        }
      : undefined;
  // A poster's repair is the next poster, on another picture, rendered beside it the same way.
  const thumbRepair =
    motifRepair ??
    (ruled.length && mainThumb?.layout === "poster" && restThumbs[2]
      ? {
          file: path.join(dir, "thumb_hero_b.jpg"),
          thumb: restThumbs[2].thumb as never,
        }
      : undefined);
  log("info", "thumbnail designs", {
    episode: ep.id,
    designs: designs.map((c) => c.layout).slice(0, 3),
  });
  // A documentary's end card (DOC_END_CARD): the newest public documentary, decided now and kept on the
  // episode so the description's "Next" line matches the card; its thumbnail is copied in beside the render.
  const endCard = doc && s.cfg.docEndCard;
  const hypeLine = endCard && (await hypeOn(s, script));
  let nextDoc: EpisodeAssets["nextDoc"];
  let nextThumb: string | null = null;
  if (endCard) {
    const next = await latestPublicDocumentary(s.db, s.now(), ep.id);
    nextDoc = next ?? null;
    if (next?.thumb) {
      try {
        await fs.copyFile(
          path.join(episodeDir(s.cfg, next.id), next.thumb),
          path.join(dir, "next_thumb.jpg"),
        );
        nextThumb = "next_thumb.jpg";
      } catch {
        /* that thumbnail is gone (older episodes are pruned): the card shows the title alone */
      }
    }
    assets.nextDoc = nextDoc;
    await logEvent(s.db, ep.id, "end_card", {
      next: next ? { id: next.id, title: next.title } : null,
      thumb: Boolean(nextThumb),
    });
  }
  // The render runs past the narration's tail by the end card; the plan and the chapter marks do not change.
  const renderSeconds = duration + (endCard ? END_CARD_SECONDS : 0);
  // The composition's props, read afresh each time: the graphics check below mutes faulted graphics
  // (quietMoments, quietBreaks) and the render must see the lists as they stand then.
  const longPropsNow = (): LongRenderInput["props"] => ({
        title: script.headline,
        kicker: script.kicker ?? "",
        criterion: script.criterion ?? "",
        spoilers: scopeOf(script) === "campaign",
        recap: !!script.recap,
        theme: script.recap ? script.headline : script.game_title,
        footageCredit,
        endLine: script.recap
          ? "The week's biggest stories every Friday · Shorts every day"
          : script.explained
            ? "The biggest gaming story, explained · Shorts every day"
          : hypeLine
            ? HYPE_END_LINE
          : doc
            ? "A new documentary every month · Shorts every day"
            : "A new ranking every week · Shorts every day",
        moments: hasMoments
          ? moments.map((ms, ei) =>
              ms.map((m, mi) => ({
                show: m.show,
                // A graphic the graphics check faulted is left out (the sentence keeps its picture).
                graphic: (assets.quietMoments ?? []).includes(`${ei}:${mi}`)
                  ? {
                      kind: "none" as const,
                      primary: "",
                      secondary: "",
                      items: [],
                    }
                  : m.graphic,
                emphasis: m.emphasis,
                person: m.person || undefined,
                // The sound editor's cue (src/render/musicplan.ts), when the setting is on.
                beat: s.cfg.docSoundBeats ? m.beat : undefined,
            // The sentence's filler visual (src/assets/fillers.ts), unless the graphics check muted it.
            filler: fillerAt(ei, mi),
              })),
            )
          : undefined,
        segments,
        words,
        durationSeconds: renderSeconds,
        // The documentary bookends (src/render/bookends.ts): the signature opening's line and the end card.
        coldOpenLine: craft.coldOpen ? coldOpenLine(script.hook) : undefined,
    // The structure devices (src/render/structure.ts), each behind its setting, for every long format.
    codeScenes: s.cfg.codeScenes,
    titleDrop: craft.titleDrop,
    chapterIndex: craft.chapterIndex,
    loops: docLoops,
    cutRhythm: craft.rhythm,
    entryPace: craft.entryPace,
    bookendEnding: craft.bookend,
        next: endCard
          ? nextDoc
            ? { title: nextDoc.title, thumbFile: nextThumb }
            : null
          : undefined,
        variant,
        audioFile: assets.audio ?? null,
        musicFile,
        imageFiles: images,
        clipFiles: clips,
        plan,
        renderDate: s.now().toISOString().slice(0, 10),
        breaks: assets.breaks,
        quietBreaks: assets.quietBreaks,
        palette: assets.palette,
        // The vision model's boxes, then the details read from the pictures' text (src/assets/ocr.ts).
    annotations: [...(assets.annotations ?? []), ...(assets.textDetails ?? [])],
        // The camera grammar (src/render/camera.ts, LONG_CAMERA), every long format.
        camera: docCamera,
        eraBeds: craft.eraBeds,
        // Concept sketches drawn on, stepped, flipped, dissolved or pinned up (src/render/sketchplan.ts).
        sketchAnimation: s.cfg.sketchAnimation,
    // Photos and portraits as instant prints, tape, pins, trays and screens; screenshots in the display
    // of their day (src/render/photoplan.ts).
    photoTreatments: s.cfg.photoTreatments,
    // The documentary's sound craft and the narration's texture slices (src/render/soundfx.ts, voicefx.ts).
    soundCraft,
    voiceFxFiles,
  });
  // The graphics check before the render (src/qa/graphicscheck.ts): every graphic and breather as a still
  // from the same composition and props, faulted ones muted, so the full render runs once instead of again
  // per fault. Once per episode; a check that cannot run (no stills service, a browser fault) never stops
  // the render, and the check on the finished video below still catches what it would have.
  const graphicsCtx = {
    headline: script.headline,
    gameTitle: script.game_title,
    format: "graphics" as const,
  };
  // Which sentence graphics the renderer draws at all (src/render/gfxdraws.ts); loaded on demand like the
  // motifs, so the style registry can never stop a render (without it every useful graphic is checked).
  const drawsGraphic = await import("./render/gfxdraws.ts")
    .then((m) =>
      m.graphicDrawsFor(
        segments,
        script.recap ? script.headline : script.game_title,
      ),
    )
    .catch(() => undefined);
  const graphicsInput = () => ({
    windows: hasMoments
      ? momentWindows(
          segments,
          words,
          moments.map((m) => m.length),
          moments.map((e) => e.map(momentKeys)),
        )
      : [],
    graphicOf: (e: number, m: number) => moments[e]?.[m]?.graphic,
    breaks: assets.breaks,
    durationSeconds: duration,
    // Filler shots are checked at their own settle frame (src/render/fillerplan.ts fillerSettle).
    shots: plan.shots,
    // Each graphic at the span the renderer draws it for, and only if it draws (src/render/momentspan.ts).
    momentOf: (e: number, m: number) => moments[e]?.[m],
    draws: drawsGraphic
      ? (e: number, m: number) =>
          !moments[e]?.[m] || drawsGraphic(e, moments[e]![m]!.graphic)
      : undefined,
  });
  // Filler visuals chosen after an earlier pre-pass are checked on their own (the rest were checked then).
  const fillersOnly =
    !!assets.graphicsPrepass &&
    !!assets.fillersChosen &&
    !assets.fillersChosen.checked;
  const fillerKeys = new Set(
    plan.shots
      .filter((sh) => sh.media.type === "filler")
      .map((sh) => `${sh.media.entry}:${sh.media.index}`),
  );
  if (
    s.cfg.visionQa &&
    s.cfg.graphicsPrepass &&
    s.renderLongStills &&
    (!assets.graphicsPrepass || fillersOnly)
  ) {
    const checks = graphicChecks(
      graphicsInput(),
      assets,
      s.cfg.graphicsPrepassMax,
    ).filter((c) => !fillersOnly || fillerKeys.has(c.what));
    if (checks.length) {
      const stillDir = path.join(dir, "qa", "prepass");
      await fs.rm(stillDir, { recursive: true, force: true });
      const items = checks.map((c, i) => ({
        ...c,
        file: path.join(stillDir, `g${i}.jpg`),
      }));
      try {
        await s.renderLongStills({
          episodeDir: dir,
          props: longPropsNow(),
          stills: items.map((c) => ({
            frame: checkFrame(c, LONG_FPS),
            file: c.file,
          })),
          gl: s.cfg.remotionGl,
          browserExecutable: s.cfg.browserExecutable,
        });
        const r = await judgeGraphics(items, (frames) =>
          s.visionQa(frames, graphicsCtx),
        );
        const muted = muteFaults(assets, r.faulted);
        assets.quietMoments = muted.quietMoments;
        assets.quietBreaks = muted.quietBreaks;
        // A faulted filler gives its sentence back to the chapter's pictures: the plan is made again without it.
        if (
          plan.shots.some(
            (sh) =>
              sh.media.type === "filler" &&
              r.faulted.includes(`${sh.media.entry}:${sh.media.index}`),
          )
        ) {
          plan = makePlan();
          assets.longPlan = plan;
        }
        const prior = fillersOnly ? assets.graphicsPrepass : undefined;
        assets.graphicsPrepass = {
          checked: (prior?.checked ?? 0) + items.length,
          muted: (prior?.muted ?? 0) + r.faulted.length,
          at: s.now().toISOString(),
        };
        if (assets.fillersChosen) assets.fillersChosen.checked = true;
        await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
          ep.id,
          JSON.stringify(assets),
        ]);
        const problems = r.problems.flatMap((p) => p.problems);
        await logEvent(s.db, ep.id, "graphics_prepass", {
          checked: items.length,
          faulted: r.faulted,
          problems: r.problems,
        });
        log(
          r.faulted.length ? "warn" : "info",
          "graphics checked before the render",
          { episode: ep.id, checked: items.length, muted: r.faulted },
        );
        const content = graphicsNotice(
          script.headline,
          "prepass",
          items.length,
          r.faulted,
          problems,
        );
        const bad = badTextMutes(problems);
        await s.notify(
          bad.length
            ? { ping: true, content: `${badTextAlert(script.headline, bad)}\n${content}` }
            : r.faulted.length
              ? { content }
              : { level: "info", content },
        );
      } catch (err) {
        log("warn", "graphics pre-pass skipped", {
          episode: ep.id,
          error: errorMessage(err),
        });
        await logEvent(s.db, ep.id, "graphics_prepass", {
          skipped: errorMessage(err).slice(0, 300),
        });
      }
      await fs
        .rm(stillDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }
  // Again just before the turn is asked for: a breaking Short may have started while the stills were prepared.
  const turnWait = await longRenderGap(s, ep);
  if (turnWait === undefined) return;
  const raw = path.join(dir, "render_raw.mp4");
  const final = path.join(dir, "short.mp4");
  const rendered = await s
    .renderLong({
      turnWaitMinutes: turnWait,
      episodeDir: dir,
      outFile: raw,
      posterFile: path.join(dir, "poster.jpg"),
      thumbFile: path.join(dir, "thumb.jpg"),
      thumb: mainThumb!.thumb as never,
      thumbVariants: thumbRepair ? [...thumbVariants, thumbRepair] : thumbVariants,
      concurrency: s.cfg.remotionConcurrency,
      gl: s.cfg.remotionGl,
      browserExecutable: s.cfg.browserExecutable,
      props: longPropsNow(),
    })
    .then(
      () => true,
      (err) => {
        if (err instanceof PcTurnTimeout) return false;
        throw err;
      },
    );
  if (!rendered) {
    log("info", "long render's turn did not come before a Short's window", {
      episode: ep.id,
    });
    return deferLong(s, ep);
  }
  await s.normalise(raw, final);
  await fs.rm(raw, { force: true });
  const tech = await s.technicalQa(final, renderSeconds, {
    minSeconds: 180,
    // The breathers are on top of the narration cap.
    maxSeconds:
      (doc ? s.cfg.docMaxSeconds : s.cfg.longformMaxSeconds) +
      60 +
      (assets.breaks ?? []).reduce((n, b) => n + b.end - b.start, 0),
    width: 1920,
    height: 1080,
    // An old game's last shot switches off like a tube just before the next chapter: meant, not a flash.
    chapterStarts: segments
      .filter(
        (g, i) =>
          i > 0 &&
          g.kind === "beat" &&
          (g.visual?.kind === "chapter" || g.visual?.kind === "rank"),
      )
      .map((g) => g.start),
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
    // Never mid-way through a graphic's entrance (src/qa/graphicscheck.ts clearOfEntrances).
    times = clearOfEntrances(times, graphicsInput().windows);
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
  // The graphics check on the finished video (owner, 28 Oct 2026: "do all safely"), now the safety net
  // behind the stills pre-pass above: a sample of the graphics and breathers (GRAPHICS_POSTCHECK_MAX) goes to
  // the vision checker. A fault mutes the graphic and may ask for one more full render, at most
  // GRAPHICS_RERENDER_PASSES times an episode; past that the video is accepted as rendered, the faults stay
  // muted for any later render, and the owner hears which and why either way (src/qa/graphicscheck.ts).
  // A faulted thumbnail is dropped, and a passing design takes the main thumbnail's place if it was that one.
  let thumbFiles = thumbVariants.map((v) => path.basename(v.file));
  let acceptedFaults: string[] | undefined;
  if (s.cfg.visionQa) {
    const sample = graphicChecks(
      graphicsInput(),
      assets,
      s.cfg.graphicsPostcheckMax,
      );
    const frames = sample.length
      ? await s.extractFrames(
        final,
          path.join(dir, "qa", "gfx"),
          sample.map((c) => c.t),
        )
      : [];
    const r = await judgeGraphics(
      sample.map((c, i) => ({ ...c, file: frames[i]! })),
      (fs) => s.visionQa(fs, graphicsCtx),
      );
    for (const p of r.problems)
      await logEvent(s.db, ep.id, "graphics_check", p);
    if (r.faulted.length) {
      const muted = muteFaults(assets, r.faulted);
      assets.quietMoments = muted.quietMoments;
      assets.quietBreaks = muted.quietBreaks;
      const passes = assets.graphicsPasses ?? 0;
      const decision = passDecision(passes, s.cfg.graphicsRerenderPasses);
      await logEvent(s.db, ep.id, "graphics_faulted", {
        faulted: r.faulted,
        decision,
        passes,
        max: s.cfg.graphicsRerenderPasses,
        });
      log("warn", "graphics faulted on the finished video", {
        episode: ep.id,
        faulted: r.faulted,
        decision,
        passes,
      });
      const badText = badTextMutes(r.problems.flatMap((p) => p.problems));
      await s.notify({
        ...(badText.length ? { ping: true } : {}),
        content: `${badText.length ? `${badTextAlert(script.headline, badText)}\n` : ""}${graphicsNotice(
          script.headline,
          decision,
          sample.length,
          r.faulted,
          r.problems.flatMap((p) => p.problems),
        )}`,
      });
      if (decision === "rerender") {
        assets.graphicsPasses = passes + 1;
      const { longPlan: _dropped, ...again } = assets;
      await s.db.query(
        `UPDATE episodes SET qa_json = $2, assets_json = $3 WHERE id = $1`,
        [
          ep.id,
            JSON.stringify({ ...qa, graphics: r.faulted }),
          JSON.stringify(again),
        ],
      );
      throw new Error(
          `graphics check: ${r.faulted.length} graphic(s) left out, rendering again (re-render ${passes + 1} of ${s.cfg.graphicsRerenderPasses})`,
      );
    }
      acceptedFaults = r.faulted;
    }
  }
  const repair = thumbRepair ? path.basename(thumbRepair.file) : undefined;
    const thumbs = ["thumb.jpg", ...thumbFiles, ...(repair ? [repair] : [])];
  const tv = s.cfg.visionQa
    ? await s
      .visionQa(
        thumbs.map((f) => path.join(dir, f)),
        {
          headline: script.headline,
          gameTitle: script.game_title,
          format: "thumbs",
            heroRule: s.cfg.thumbHeroRule,
        },
      )
        .catch(() => undefined)
    : undefined;
  const bad = new Set<string | undefined>(
      tv?.verdict === "fail"
        ? framesNamed(tv.problems)
            .map((n) => thumbs[n - 1])
            .filter(Boolean)
        : [],
    );
  // The rule's own measurements (the words at 168x94), which need no model. Never a block: a failed design only
  // gives way to the next, and with none left the thumbnail stays as rendered.
  const ruleProblems: string[] = [];
  {
    const rendered: Array<[string, unknown]> = [
      ["thumb.jpg", mainThumb!.thumb],
      ...thumbVariants.map((v): [string, unknown] => [path.basename(v.file), v.thumb]),
      ...(thumbRepair ? [[path.basename(thumbRepair.file), thumbRepair.thumb] as [string, unknown]] : []),
    ];
    for (const [name, thumb] of rendered) {
      const t = thumb as { layout?: string; fgFile?: string | null; imageFile?: string | null };
      let problems: string[] = [];
      if (t.layout === "poster" && ruled.length)
        problems = await posterProblems(path.join(dir, name), thumb as never);
      // Any older design that draws a depth cut-out must keep the face whole, rule or no rule.
      else if ((t.layout === "hero" || t.layout === "depth") && t.fgFile && t.imageFile) {
        const face = await heroLook(path.join(dir, t.imageFile));
        if (face?.kind === "face" && face.box)
          problems = await cutoutProblems(path.join(dir, t.fgFile), face.box);
      }
      if (!problems.length) continue;
      bad.add(name);
      ruleProblems.push(`${name}: ${problems.join(", ")}`);
    }
  }
    if (bad.size) {
      await logEvent(s.db, ep.id, "thumbnail_check", {
      problems: [...(tv?.problems ?? []), ...ruleProblems],
      });
      const out = thumbOutcome({ main: "thumb.jpg", variants: thumbFiles, repair, bad });
      if (out.mainFrom)
        await fs.copyFile(path.join(dir, out.mainFrom), path.join(dir, "thumb.jpg"));
      thumbFiles = out.variants;
      if (repair && bad.has("thumb.jpg")) {
        await logEvent(s.db, ep.id, "thumbnail_repair", {
          repaired: out.repaired,
          replacedBy: out.mainFrom ?? null,
        });
      const what = mainThumb?.layout === "motif" ? "series-grid" : "hero";
      const second = mainThumb?.layout === "motif" ? "its second layout with other pictures" : "the next picture";
        await s.notify({
          level: "info",
          content: out.repaired
          ? `🖼️ "${script.headline}": the thumbnail check failed the ${what} thumbnail, so ${second} replaced it (it passed the same check).`
          : `🖼️ "${script.headline}": the thumbnail check failed the ${what} thumbnail and ${second} too, so ${out.mainFrom ? "another design" : mainThumb?.layout === "motif" ? "the grid, as rendered," : "the first design, as rendered,"} is the thumbnail.`,
        });
      }
    }
  await transition(s.db, ep.id, "voiced", "rendered", {
    assets_json: {
      ...assets,
      video: "short.mp4",
      poster: "poster.jpg",
      thumb: "thumb.jpg",
      thumbVariants: thumbFiles,
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
    qa_json: acceptedFaults
      ? { ...qa, graphics: { faulted: acceptedFaults, accepted: true } }
      : qa,
  });
}

/** A Short that is our own reading, not a report of someone else's news: a ranking, a list, a Why. */
export function ownWorkShort(
  script: Pick<Script, "evergreen_format" | "story_type" | "is_rumour">,
): boolean {
  return (
    !script.is_rumour &&
    (!!script.evergreen_format || script.story_type === "explainer")
  );
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
  // The argument test: the conclusion is spoken, not labelled, so the take has no card of its own.
  if (argumentArm(s.cfg, ep))
    for (const g of segments)
      if (g.kind === "take") g.visual = undefined;
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
  if (s.cfg.shortBright)
    for (const img of assets.images ?? [])
      if (img.luma === undefined)
        img.luma = await meanLuma(path.join(dir, img.file));
  // Art with big lettering in what the crop keeps ("LDEN RIN" over the verdict) goes while enough other pictures are
  // left; the vision check would fail it and cost a whole render to find out.
  if (s.cfg.shortClipTextCheck && !script.entries?.length) {
    for (const img of assets.images ?? [])
      if (img.kind !== "capsule" && img.bigText === undefined)
        img.bigText = (await stillBigText(path.join(dir, img.file))).length > 0;
    const clean = (assets.images ?? []).filter((i) => !i.bigText);
    if (clean.length >= 4 && clean.length < (assets.images ?? []).length) {
      await logEvent(s.db, ep.id, "lettered_art_dropped", {
        files: (assets.images ?? []).filter((i) => i.bigText).map((i) => i.file),
      });
      assets.images = clean;
    }
  }
  // A ranking's old games: a clip with no detail left in the crop is a 240p smear, worse than a sharp still. Lists only:
  // the same measure reads foggy or dark modern footage as low (Silent Hill 2 lost all six clips), and a blur measure
  // separated them no better. Elsewhere a blurred clip is left to the vision check, whose fault drops it for the retry.
  if (s.cfg.shortClipTextCheck && script.entries?.length) {
    for (const c of assets.clips ?? [])
      if (c.detailKb === undefined)
        c.detailKb = await clipDetailKb(path.join(dir, c.file), c.durationSeconds);
    const sharp = (assets.clips ?? []).filter(
      (c) => c.detailKb === undefined || c.detailKb >= CLIP_DETAIL_FLOOR_KB,
    );
    if (sharp.length < (assets.clips ?? []).length) {
      await logEvent(s.db, ep.id, "smeared_clips_dropped", {
        files: (assets.clips ?? []).filter((c) => !sharp.includes(c)).map((c) => c.file),
      });
      assets.clips = sharp;
    }
  }
  // Never CONFIRMED on an estimate or a report, on the chip or on a stamp: a rule, not a setting.
  const tag = sourceTag(
    `${script.headline} ${script.youtube?.title ?? ""} ${narrationOf(script)}`,
    (ep.story_json.items ?? []).some((i) => i.sourceKind === "official"),
  );
  if (tag !== "CONFIRMED" && script.stamp && /confirm/i.test(`${script.stamp.text} ${script.stamp.sub ?? ""}`)) {
    await logEvent(s.db, ep.id, "stamp_dropped", { stamp: script.stamp.text, tag });
    script.stamp = undefined;
  }
  const planInput = {
    segments,
    words,
    durationSeconds: duration,
    images: (assets.images ?? []).map((i) => ({
      kind: i.kind,
      aspect: i.aspect,
      beatIndex: i.beatIndex,
      wordy: i.wordy,
      luma: i.luma,
      frame: i.frame,
      then: i.then,
      forWords: i.forWords,
      role: i.role,
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
    footageFirst: s.cfg.shortFootageFirst,
    sourceTag: tag,
    noSourceChip: s.cfg.shortLabelsClean && ownWorkShort(script),
    statsWhenSpoken: s.cfg.shortLabelsClean,
    preferBright: s.cfg.shortBright,
    codeScenes: s.cfg.codeScenes
      ? {
          ctx: {
            sourced: [
              ...segments.map((x) => x.text),
              ...(script.claims ?? []).map((c: { claim: string }) => c.claim),
            ].join(" "),
            game: script.game_title,
            today: new Date(s.now()).toISOString().slice(0, 10),
          },
          stampsAt: stampsFor(script, words).map((x) => x.at),
        }
      : undefined,
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
      // 5 Nov 2026: of 25 failed news Shorts in 45 days, 20 had their slot or one within 3 hours filled by another Short
      // (the other 5 were one day's render bug), so a stop costs little. A big story has no better story to yield to.
      plateShareMax: ep.story_json.bigStory
        ? Math.max(s.cfg.shortPlateMax, s.cfg.shortPlateMaxBig)
        : s.cfg.shortPlateMax,
      plateFirstSeconds: s.cfg.shortPlateFirstSeconds,
      shelfOptional: s.cfg.shortLabelsClean,
      wpmMax: s.cfg.shortMinWpm ? Math.max(190, s.cfg.shortMinWpm + 25) : 190,
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
        /^(unique_media_ratio|max_media_repeat|adjacent_repeats|plate_share|plate_opening_seconds)$/.test(m.name),
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
      if (s.cfg.shortBright)
        for (const img of assets.images ?? [])
          if (img.luma === undefined)
            img.luma = await meanLuma(path.join(dir, img.file));
      const richInput = {
        ...planInput,
        images: (assets.images ?? []).map((i) => ({
          kind: i.kind,
          aspect: i.aspect,
          beatIndex: i.beatIndex,
          wordy: i.wordy,
          luma: i.luma,
          frame: i.frame,
          then: i.then,
          forWords: i.forWords,
          role: i.role,
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
    const plateRed = rubric.metrics.find(
      (m) => m.name === "plate_share" && m.grade === "red",
    );
    if (plateRed)
      // Unlike the other notes this one is what the viewer sees: an empty screen. The story's slot goes to the next one,
      // at once: the retries would plan the same media again and hold the slot while they did.
      throw new FatalError(
        `QA failed: ${Math.round(Number(plateRed.value) * 100)}% of the Short would be an empty panel: too little media`,
      );
    const openingRed = rubric.metrics.find(
      (m) => m.name === "plate_opening_seconds" && m.grade === "red",
    );
    if (openingRed)
      throw new FatalError(
        `QA failed: the Short would open on an empty panel for ${openingRed.value} s: too little media`,
      );
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
  // The word moment's look (src/render/wordlook.ts): one of the suite, never the previous Short's, with a
  // memory of the channel's last twelve; off (SHORT_WORD_LOOKS=false) it is always the rubber stamp.
  const [stamp] = stampsFor(script, words);
  if (stamp && !plan.wordLook) {
    const gameYear =
      Number(assets.steam?.facts?.releaseDate?.match(/\b(19|20)\d\d\b/)?.[0]) ||
      undefined;
    const chosen = s.cfg.shortWordLooks
      ? await chooseWordLook(s.db, stamp, {
          year: gameYear,
          motif: await motifIdFor(script.game_title, gameYear),
          day: s.now().toISOString().slice(0, 10),
          seed: variant,
        })
      : { look: "Stamp", recent: [] };
    plan.wordLook = chosen.look;
    await logEvent(s.db, ep.id, "word_look", {
      look: chosen.look,
      text: stamp.text,
      tone: stamp.tone,
      recent: chosen.recent,
    });
  }
  // The moment lands with its look's sound (the stamp's landing by default), peak on the word, when the mix has room for it.
  for (const st of stampsFor(script, words)) {
    const cue = wordSoundCue(plan.wordLook);
    const name = cue.name;
    const f = Math.max(
      0,
      Math.round(st.at * plan.fps) - leadFrames(name, plan.fps),
    );
    if (
      plan.sfx.length < MAX_SFX &&
      plan.sfx.every((c) => Math.abs(c.frame - f) >= 60)
    )
      plan.sfx.push({ file: sfxFile(name), frame: f, volume: cue.volume });
  }
  assets.plan = plan;
  // How much of the narration has something chosen for its own words on screen (src/qa/mediarich.ts): measured
  // on every Short and kept in qa_json; under SHORT_MEDIA_RICH_TARGET it is a line in the evening summary.
  // The long videos' craft on the new-look Shorts (src/shortcraftstep.ts): planned once, stored on the plan.
  const craftFills = await craftForShort(s, ep.id, {
    suite: suiteFor(s.cfg, ep),
    segments,
    words,
    plan,
    images: (assets.images ?? []).map((i) => ({
      kind: i.kind,
      credit: photoCredit(i),
      beatIndex: i.beatIndex,
    })),
    clips: assets.clips ?? [],
    stamps: stampsFor(script, words),
    game: script.game_title,
    gameYear:
      Number(assets.steam?.facts?.releaseDate?.match(/\b(19|20)\d\d\b/)?.[0]) ||
      undefined,
    seed: variant,
  });
  const mediaRich = shortMediaRichness(
    segments,
    plan,
    assets.images ?? [],
    assets.clips ?? [],
    craftFills,
  );
  log(
    mediaRich.covered < s.cfg.shortMediaRichTarget ? "warn" : "info",
    "short media richness",
    {
      episode: ep.id,
      covered: Math.round(mediaRich.covered * 100),
      own: Math.round(mediaRich.own * 100),
      target: Math.round(s.cfg.shortMediaRichTarget * 100),
    },
  );
  await logEvent(s.db, ep.id, "media_rich", {
    covered: mediaRich.covered,
    own: mediaRich.own,
    graphicOnly: mediaRich.graphicOnly,
    target: s.cfg.shortMediaRichTarget,
  });
  if (mediaRich.covered < s.cfg.shortMediaRichTarget)
    await s.notify({
      level: "info",
      content: mediaRichNotice(
        script.headline,
        mediaRich,
        s.cfg.shortMediaRichTarget,
      ),
    });
  assets.suite = suiteFor(s.cfg, ep);
  // Pip the mascot (src/experiments.ts): recorded either way only while the test runs, and kept on a re-render.
  const mascotShare = await mascotShareNow(s.db, s.cfg);
  if (assets.mascot === undefined && mascotShare > 0)
    assets.mascot = mascotFor(mascotShare, ep);
  // The new-look opening poster (src/render/components/HookPoster.tsx): the hero art's subject cut out once.
  const heroImage = assets.images?.[plan.heroIndex];
  if (
    assets.suite &&
    !assets.heroCut &&
    s.cfg.parallax &&
    s.cfg.parallaxPython &&
    heroImage &&
    plan.shots[0]?.media.type === "image" &&
    plan.shots[0].media.index === plan.heroIndex
  ) {
    const made = await makeParallax(s.cfg.parallaxPython, dir, [
      heroImage.file,
    ]);
    const cut = made.get(heroImage.file);
    if (cut) assets.heroCut = { fg: cut.fg, x: cut.fgx };
  }
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
  const photoLine = photoCreditLine((assets.images ?? []).map(photoCredit));
  const footageCredit = [
    (assets.clips ?? []).length
      ? // A list has no one game to credit: "Steam Deals" is not a publisher.
        s.cfg.shortLabelsClean && !publisher && script.entries?.length
        ? "Footage: official trailers"
        : `Footage: ${publisher || script.game_title} · official trailer`
      : "",
    photoLine,
  ]
    .filter(Boolean)
    .join("   ");
  const year = assets.steam?.facts?.releaseDate?.match(/\b(19|20)\d\d\b/)?.[0];
  // The store page's year can be a re-release's, and a Why about the 2005 game read "Electronic Arts · 2020".
  const gameSubtitle = [
    publisher,
    s.cfg.shortLabelsClean && ownWorkShort(script) ? undefined : year,
  ]
    .filter(Boolean)
    .join(" · ");

  const raw = path.join(dir, "render_raw.mp4");
  const final = path.join(dir, "short.mp4");
  if (assets.suite) assets.shortThumb = "thumb_short.jpg";
  const shortClean = await shortsCleanStep(s, ep.id, assets.test);
  const entrySpans = overlaySpans({
    segments,
    words,
    plan,
    layout: shortLayout(segments, plan.fps, plan.totalFrames, plan.tailFrames),
    stamps: stampsFor(script, words),
    sting: false,
  });
  await s.render({
    episodeDir: dir,
    outFile: raw,
    posterFile: path.join(dir, "poster.jpg"),
    thumbFile: assets.shortThumb
      ? path.join(dir, assets.shortThumb)
      : undefined,
    concurrency: s.cfg.remotionConcurrency,
    gl: s.cfg.remotionGl,
    browserExecutable: s.cfg.browserExecutable,
    props: {
      headline: script.headline,
      storyType: script.is_rumour ? "rumour" : script.story_type,
      gameTitle: mediaTitle(script.game_title),
      isRumour: script.is_rumour,
      attribution:
        s.cfg.shortLabelsClean && ownWorkShort(script) ? "" : script.attribution,
      bright: s.cfg.shortBright,
      quickFigures: s.cfg.shortLabelsClean,
      ownWork: s.cfg.shortLabelsClean && !!script.evergreen_format,
      gameSubtitle,
      vivid: s.cfg.shortVivid,
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
        credit: photoCredit(i),
        focusX: i.focusX,
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
        credit: ccCredit(c.provenance),
      })),
      steam: steamLite,
      emphasis: emphasisWords(script),
      deskName: assets.desk?.voice.name,
      stamps: stampsFor(script, words),
      plan,
      suite: assets.suite,
      // The clean frame (src/render/cleanframe.ts): SHORTS_CLEAN, or the clean-frame retention test's arm or winner.
      clean: shortClean,
      mascot: assets.mascot,
      heroCutFile: assets.heroCut,
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
    // A card now lands on its word, not at its line's start: judged after it has landed, or an empty panel still
    // building up reads as a fault (ep_20261105_d8d0e098 at 0:05.3).
    times = shortSampleTimes(
      segments.map((g, i) =>
        g.visual && g.visual.kind !== "none"
          ? Math.max(
              g.start,
              cardWindow(segments, words, i, plan.fps, plan.totalFrames).from /
                plan.fps -
                0.3,
            )
          : g.start,
      ),
      duration,
    );
    await fs.rm(path.join(dir, "qa"), { recursive: true, force: true });
    const frames = await s.extractFrames(final, path.join(dir, "qa"), times);
    vision = await s.visionQa(frames, {
      headline: script.headline,
      gameTitle: script.game_title,
      narration: narrationOf(script),
      cardTexts: segments.flatMap((g) =>
        g.visual && g.visual.kind !== "none"
          ? [g.visual.primary, g.visual.secondary, ...(g.visual.items ?? [])].filter(
              (t): t is string => !!t,
            )
          : [],
      ),
    });
  }
  // Every rank card must stay up for its whole entry, in text the card can show (src/render/rankcard.ts).
  const entryCards = entryHolds(
    segments,
    shortClean ? arbitrate(entrySpans) : entrySpans,
    plan.fps,
    plan.totalFrames,
  );
  const entryProblems = entryCardProblems(entryCards, segments);
  const qa = {
    technical: tech,
    vision: vision ?? null,
    rubric,
    media_rich: mediaRich,
    ...(entryCards.length ? { entry_cards: entryCards } : {}),
    checked_at: s.now().toISOString(),
  };
  const visionProblems =
    vision?.verdict === "fail"
      ? vision.problems.length
        ? vision.problems
        : [`vision QA failed: ${vision.notes || "no reason given"}`]
      : [];
  const problems = [...tech.problems, ...visionProblems, ...entryProblems];
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
  // At release, every lane: the script, the words as voiced and the captions. Fails, never holds for a tap.
  if (s.cfg.writerNotesGuard) {
    const srtFile = ep.assets_json?.srt
      ? path.join(episodeDir(s.cfg, ep.id), ep.assets_json.srt)
      : undefined;
    const srt = srtFile
      ? await fs.readFile(srtFile, "utf8").catch(() => undefined)
      : undefined;
    const found = releaseWriterNotes({
      script,
      words: ep.assets_json?.words,
      srt,
    });
    if (found.length) await stopForWriterNotes(s, ep, "at release", found);
  }
  // The release gate (src/qa/releaseGate.ts): every long video's shots (documentary, ranking, recap) are
  // scored against the words spoken over them before it may go out on its own, with the same thresholds.
  // A held one waits here for the owner like a manual approval.
  if (
    ep.lane === "longform" &&
    longCraft(script, s.cfg).releaseGate &&
    ep.assets_json?.longPlan
  ) {
    const a = ep.assets_json;
    const segments = openChaptersAtBreaks(
      buildSegments(
        segmentInputs(script, Boolean(a.desk)),
        a.words ?? [],
        (a.durationSeconds ?? 0) + LONG_TAIL_SECONDS,
      ),
      a.breaks,
    );
    const chapters = [...(script.entries ?? [])]
      .sort((x, y) => y.rank - x.rank)
      .map((e) => ({ game: e.game_title, year: e.year }));
    const held = await releaseGateStep(
      {
        db: s.db,
        cfg: s.cfg,
        llm: s.llm,
        notify: (m) => s.notify(m),
        now: () => s.now(),
        episodeDir: (id) => episodeDir(s.cfg, id),
      },
      ep,
      { segments, chapters, links },
    );
    if (held) return;
  }
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
  const tap = gameplayLinks(s.cfg, ep.id);
  const rehearsal = ep.lane === "gameplay" && !!ep.story_json.gameplay?.rehearsal;
  const description = rehearsal && g
    ? [
        "🧪 **Rehearsal: nothing here can publish.**",
        `**Question:** ${g.question}`,
        `**Result:** ${g.result}`,
        `**Game:** ${script.game_title}`,
        `**Why it was picked:** ${ep.story_json.gameplay?.review.reason ?? "n/a"} (score ${ep.story_json.gameplay?.review.score ?? "?"}/10)`,
        ...(ep.story_json.gameplay?.review.keep
          ? []
          : ["The reviewer would have passed on this; it was sent on to test the lane."]),
        "",
        `▶️ [Watch preview](${links.preview})`,
      ]
    : g
    ? [
        `**Question:** ${g.question}`,
        `**Result:** ${g.result}`,
        `**Game:** ${script.game_title}${g.experiment_number ? `  ·  test #${g.experiment_number} on the list` : "  ·  a fresh test"}`,
        `**Why it was picked:** ${ep.story_json.gameplay?.review.reason ?? "n/a"} (score ${ep.story_json.gameplay?.review.score ?? "?"}/10)`,
        g.radio
          ? "⚠️ **Radio or licensed music may be audible.** That can trigger a Content ID claim; reject if you would rather not risk it."
          : "No licensed music heard.",
        "",
        `▶️ [Watch preview](${links.preview})  ·  ✅ [Approve](${tap.approve})  ·  ❌ [Reject](${tap.reject})`,
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
    // Gameplay notices buzz the phone: the Maze Bank Short sat unseen for 48 hours among the channel's alerts.
    ping: ep.lane === "gameplay",
    embeds: [
      {
        title: `🎬 ${rehearsal ? "[REHEARSAL] " : ""}${script.youtube.title}`,
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
  // The owner's tap is the only way a gameplay Short moves: a notice that never arrived is tried again.
  if (delivered === false && ep.lane === "gameplay")
    throw new Error(
      "gameplay approval notice could not be posted to Discord; trying again",
    );
  if (rehearsal) {
    // Told, and finished: with no approval state left, nothing can publish it.
    await transition(s.db, ep.id, "rendered", "rejected", {
      last_error: "rehearsal: reached Discord, nothing published",
    });
    await logEvent(s.db, ep.id, "gameplay_rehearsal", {
      clip: g?.inbox_id,
      delivered: delivered ?? null,
    });
    return;
  }
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
    const gameplay = ep.lane === "gameplay";
    const expiryHours = gameplay
      ? s.cfg.gameplayApprovalHours
      : MANUAL_APPROVAL_EXPIRY_HOURS;
    // One nudge with fresh links, since a gameplay Short has no other way forward.
    if (
      gameplay &&
      s.cfg.gameplayRemindHours > 0 &&
      waited >= s.cfg.gameplayRemindHours * 3600_000 &&
      waited < expiryHours * 3600_000
    ) {
      const [told] = await s.db.query<{ n: string | number }>(
        `SELECT count(*) AS n FROM events WHERE episode_id = $1 AND kind = 'gameplay_reminded'`,
        [ep.id],
      );
      if (Number(told?.n ?? 0) === 0) {
        const links = gameplayLinks(s.cfg, ep.id);
        await logEvent(s.db, ep.id, "gameplay_reminded", {});
        await s.notify({
          ping: true,
          content: `🎮 Still waiting for your tap: "${ep.script_json?.youtube.title ?? ep.story_json.headline}". It expires ${Math.round(expiryHours - waited / 3600_000)} hours from now.\n▶️ [Watch preview](${links.preview})  ·  ✅ [Approve](${links.approve})  ·  ❌ [Reject](${links.reject})`,
        });
      }
    }
    // An unanswered episode must not block tomorrow's Short forever.
    if (
      waited >= expiryHours * 3600_000 &&
      (await transition(s.db, ep.id, "awaiting_approval", "rejected", {
        last_error: "approval expired unanswered",
      }))
    ) {
      await logEvent(s.db, ep.id, "rejected", { by: "expiry" });
      await s.notify({
        ...(gameplay ? {} : { level: "info" as const }),
        content: `⌛ "${ep.script_json?.youtube.title ?? ep.story_json.headline}" expired after ${expiryHours}h without approval; ${gameplay ? "the clip stays in the inbox." : "moving on to new stories."}`,
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
 * has passed); every lane keeps MIN_UPLOAD_GAP_MINUTES clear of any other publish.
 * Returns undefined for "now".
 */
export function choosePublishAt(
  cfg: Config,
  now: Date,
  ep?: Pick<Episode, "lane" | "slot_at">,
  /** Other publish times on the same channel, past and scheduled (src/lanes.ts publishTimes). */
  published?: Date | Date[],
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
  // Clear of every other publish by the gap, past or scheduled. Only publishes near this one move it: a
  // documentary scheduled two days out once held every Short behind it (27-28 Oct 2026, nine videos queued).
  const others = (
    Array.isArray(published) ? published : published ? [published] : []
  )
    .map((d) => d.getTime())
    .sort((x, y) => x - y);
  const gap = cfg.minUploadGapMinutes * 60_000;
  let t = (at ?? now).getTime();
  for (let moved = true, i = 0; moved && i < 200; i++) {
    moved = false;
    for (const o of others)
      if (Math.abs(o - t) < gap) {
        t = o + gap;
        moved = true;
      }
  }
  if (t > (at ?? now).getTime()) at = new Date(t);
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
    await publishTimes(s.db, s.now(), ep.lane === "twin"),
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
  // Stock and archive footage, one line per library (src/assets/stock.ts).
  lines.push(...stockCreditLines(clips));
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
  // The chapter marks YouTube reads (src/youtube/chapters.ts): 0:00 first, three or more, ten seconds apart.
  const chapters = long ? finishChapters(longChapters(ep), body) : [];
  // Shop links for every game and piece of hardware the video names, right under the summary.
  const shop = affiliateBlock(script, affiliate, { free: ep.lane === "free" });
  // A Why Short's long video on the same game (src/youtube/longlink.ts), under the summary.
  const follow = ep.story_json.why?.follow;
  // The disclosure and channel lines always survive the length cut (src/authenticity.ts fitDescription).
  const description = fitDescription(
    [
      keywordLead(script),
      // A documentary's second line: the same "next" its end card shows (src/youtube/nextdoc.ts).
      nextLine(ep.assets_json?.nextDoc ?? undefined),
      "",
      body,
      follow?.videoId && follow.title
        ? `\nThe whole story, in our ${follow.kind}: ${follow.title} https://youtu.be/${follow.videoId}`
        : "",
      shop,
      script.is_rumour
        ? "\nThis story is unconfirmed. We will update if it is confirmed or denied."
        : "",
      chapters.length ? `\nChapters:\n${chapters.join("\n")}` : "",
      credits ? `\nSources:\n${credits}` : "",
      script.sources?.length
        ? `\nSources:\n${script.sources.map((u) => `• Wikipedia: ${u}`).join("\n")}`
        : "",
      // The photo libraries used, named (only Commons: the line the channel always had).
      affiliate?.shopUrl
        ? photoSourcesLine(
            ep.assets_json?.images ?? [],
            affiliate.shopUrl.replace(/\/shop\//, "/credits/"),
          )
        : "",
      footage,
    ],
    [
      script.gameplay?.direct
        ? `\nGameplay recorded by Pulse Gaming on Xbox Series X from our own copy of ${script.game_title}. Narration: AI-generated synthetic voice.`
        : script.gameplay
        ? `\nGameplay recorded by Pulse Gaming on Xbox Series X from our own copy of ${script.game_title}. No AI voice: the sound is the game's own.`
        : "\nNarration: AI-generated synthetic voice. Visuals: official publisher material, credited.",
      script.gameplay
        ? "\nPulse Gaming: we test what games let you do, one question at a time. Tell us what to test next in the comments."
        : script.recap
          ? "\nPulse Gaming News: gaming news, checked and explained. The week's biggest stories every Friday, a new ranking every week, Shorts every day."
          : script.explained
            ? "\nPulse Gaming News: gaming news, checked and explained. The biggest story in gaming explained in depth, a new ranking every week, Shorts every day."
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
    ],
  );
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
          ep.lane === "gameplay" && !ep.script_json?.gameplay?.direct
            ? false
            : s.cfg.syntheticMedia,
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
      // Now it is public it can join its series playlist (SERIES_PLAYLISTS; off, it joined at upload).
      if (live && s.cfg.seriesPlaylists) await addToSeries(s, live, "public");
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

/** Whether this video asks for a Hype (HYPE_ASK, src/youtube/hype.ts): one quota unit for the look-up, only when it could. */
async function hypeOn(s: Services, script: Script): Promise<boolean> {
  return hypeAllowed(s.cfg.hypeAsk, script, async () => {
    const n = await s.youtube().subscriberCount();
    await quotaAdd(s.db, s.now(), QUOTA.poll);
    return n;
  });
}

/** Posts the channel's own first comment (the owner pins it from the app; the API cannot pin). Never blocks a live video. */
async function addPinnedComment(s: Services, ep: Episode): Promise<void> {
  if (await publishHeld(s.db)) return; // the owner's publishing hold
  try {
    // Comment links are clickable on long videos (not on Shorts): the long video's pin carries its top pick.
    // A documentary's comment points at one chapter with its timestamp (DOC_PIN_MOMENT, src/youtube/pinned.ts).
    const script = ep.script_json!;
    const text =
      (script.twin?.pinned ||
        (script.evergreen_format === "documentary" && s.cfg.docPinMoment
          ? docPinnedComment(script, longChapters(ep))
          : s.cfg.firstCommentQuestion
            ? firstComment(script)
            : pinnedComment(script))) +
      (!script.twin && (await hypeOn(s, script))
        ? ` ${HYPE_COMMENT_LINE}`
        : "") +
      (ep.script_json!.runtime === "long"
        ? affiliateCommentLine(ep.script_json!, affiliateTags(s.cfg, ep.id))
        : "") +
      // A Why Short's comment names our long video on the same game, found now in case one came out since.
      (ep.story_json.why && !script.twin
        ? whyPinnedLine(
            await followFor(
              s.db,
              ep.story_json.gameHint || script.game_title,
              s.now(),
            ).catch(() => ep.story_json.why?.follow),
          )
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
/**
 * Hands a long video's Test & compare to the Studio browser task (scheduled task pulse-studio-abtest):
 * data/abtests/pending.json lists the video, its title and the alternatives, and its thumbnails.
 */
async function queueAbTest(s: Services, ep: Episode): Promise<void> {
  try {
    const dir = episodeDir(s.cfg, ep.id);
    const file = path.join(s.cfg.dataDir, "abtests", "pending.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    const list = JSON.parse(
      await fs.readFile(file, "utf8").catch(() => "[]"),
    ) as Array<{ videoId: string }>;
    if (list.some((x) => x.videoId === ep.youtube_video_id)) return;
    const thumbs = ["thumb.jpg", ...(ep.assets_json?.thumbVariants ?? [])].map(
      (f) => path.join(dir, f),
    );
    list.push({
      videoId: ep.youtube_video_id!,
      episode: ep.id,
      titles: [
        ep.script_json!.youtube.title,
        ...(ep.script_json!.youtube.title_variants ?? []),
      ],
      thumbs,
      publishAt: ep.publish_at,
      added: s.now().toISOString(),
    } as { videoId: string });
    await fs.writeFile(file, JSON.stringify(list, null, 2), "utf8");
    await logEvent(s.db, ep.id, "abtest_queued", { thumbs: thumbs.length });
  } catch (err) {
    log("warn", "a/b test hand-off failed", {
      episode: ep.id,
      error: errorMessage(err),
    });
  }
}

async function setThumbnail(
  s: Services,
  ep: Episode,
  file = ep.assets_json!.thumb!,
): Promise<void> {
  try {
    await s
      .youtube(accountOf(ep))
      .setThumbnail(
        ep.youtube_video_id!,
        path.join(episodeDir(s.cfg, ep.id), file),
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
  if (ep.assets_json?.thumb) {
    await setThumbnail(s, ep);
    await queueAbTest(s, ep);
  }
  // The new-look Short's frame 0 as its custom thumbnail (custom Shorts thumbnails opened in July 2026; if
  // the API refuses them for Shorts the refusal is logged and the Short keeps the frame YouTube picks).
  else if (ep.assets_json?.shortThumb && ep.script_json?.runtime !== "long")
    await setThumbnail(s, ep, ep.assets_json.shortThumb);
  await addToSeries(s, ep, st.privacyStatus);
  await transition(s.db, ep.id, "uploaded", "published", {
    youtube_status: st.privacyStatus,
  });
  if (st.privacyStatus === "public") await gameplayLive(s, ep);
  const url = `https://youtube.com/shorts/${ep.youtube_video_id}`;
  const longVideo = ep.script_json?.runtime === "long";
  // A documentary's community post and poll (COMMUNITY_DRAFTS, src/social/community.ts): drafted now from
  // its chapters, kept on the episode and put in this notice for the owner to paste; the API cannot post them.
  let community = "";
  if (
    ep.script_json?.evergreen_format === "documentary" &&
    s.cfg.communityDrafts
  ) {
    const drafts = communityDrafts(ep.script_json, ep.youtube_video_id!);
    await s.db.query(
      `UPDATE episodes SET assets_json = COALESCE(assets_json, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
      [ep.id, JSON.stringify({ community: drafts })],
    );
    await logEvent(s.db, ep.id, "community_drafted", {
      post: drafts.post,
      poll: drafts.poll ?? null,
    });
    community = `\n\n${communityBlock(drafts)}\n\nThe first comment goes up when the video is public; pin it from YouTube Studio (the API cannot pin).`;
  }
  await s.notify({
    content: `✅ ${ep.publish_at && new Date(ep.publish_at) > s.now() ? `Uploaded, goes live ${ukTime(new Date(ep.publish_at), s.now())}` : "Live now"}${longVideo ? " (long video)" : ""}: ${ep.script_json!.youtube.title}\n${longVideo ? `https://youtu.be/${ep.youtube_video_id}` : url}${community}`,
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

/** Runs one step, with whatever it posts filed under this video in the alert ledger. */
export async function advance(s: Services, ep: Episode): Promise<boolean> {
  return withAlertScope(
    {
      episode: ep.id,
      title: ep.script_json?.headline ?? ep.story_json?.headline,
    },
    () => advanceStep(s, ep),
  );
}

/** On failure records it and backs off, alerting once it gives up. */
async function advanceStep(s: Services, ep: Episode): Promise<boolean> {
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

/** Long videos (rankings, documentaries, recaps, remakes): made in their own lane (tickLong), never in the Shorts tick. */
export function isLongEpisode(ep: Pick<Episode, "lane">): boolean {
  return ep.lane === "longform";
}

/**
 * Pushes one episode as far as it can go (script → upload); it stops on its own at a wait (approval,
 * processing, a slot, a quota reset) or a failure.
 */
async function pushEpisode(s: Services, ep: Episode): Promise<void> {
  let current: Episode | undefined = ep;
  for (let i = 0; i < 10 && current; i++) {
    const moved = await advance(s, current);
    if (!moved) break;
    current = await getEpisode(s.db, ep.id);
    if (current?.next_attempt_at && new Date(current.next_attempt_at) > s.now())
      break;
  }
}

/**
 * The long-form lane. A long video takes hours to gather and render, and inside the Shorts tick it once held
 * every Short back (28 Oct 2026: a documentary remake from 15:31 cost the 17:00 and 18:30 slots). It has its
 * own lease, so one long video is worked on at a time and the Shorts tick never waits for it; a crashed holder
 * is cleared at boot with the other leases. Selection stays in the Shorts tick.
 */
export async function tickLong(
  s: Services,
): Promise<{ ran: boolean; episodes?: string[] }> {
  const result = await withLease(s.db, LONG_LEASE, 360 * 60, async (lease) => {
    // One step at a time, the lane re-ordered after each (src/longlane.ts): the nearest slot first, and an
    // unscripted video due within hours ahead of everything, so another's gather or render never queues it
    // (30 Oct 2026: the recap for 20:00 sat behind the Halo ranking's gather and missed its slot). An episode
    // that did not move (a wait, a failure) rests for the remainder of this pass; the pass ends when nothing
    // is left to do or the lease is gone (the lane watchdog released it).
    const worked: string[] = [];
    const resting = new Set<string>();
    for (let guard = 0; guard < 60; guard++) {
      if (!(await lease.held())) {
        log("warn", "long tick stopping: its lease was released", { worked });
        break;
      }
      const due = orderLongEpisodes(
        (await dueEpisodes(s.db, s.now())).filter(isLongEpisode),
        s.now(),
      ).filter((e) => !resting.has(e.id));
      const ep = due[0];
      if (!ep) break;
      if (!worked.includes(ep.id)) worked.push(ep.id);
      const moved = await advance(s, ep);
      const after = await getEpisode(s.db, ep.id);
      if (
        !moved ||
        !after ||
        (after.next_attempt_at && new Date(after.next_attempt_at) > s.now())
      )
        resting.add(ep.id);
    }
    return { episodes: worked };
  });
  return result ? { ran: true, ...result } : { ran: false };
}

export async function tick(
  s: Services,
): Promise<{ ran: boolean; selected?: string }> {
  // Shorts only: long videos advance in tickLong. A crashed holder is cleared at boot.
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
    // A long video selected above is left to its own lane.
    for (const ep of await dueEpisodes(s.db, s.now()))
      if (!isLongEpisode(ep)) await pushEpisode(s, ep);
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
    await pruneMedia(s, s.cfg.mediaKeepDays).catch((err) =>
      log("warn", "prune failed", { error: errorMessage(err) }),
    );
    // Sooner, oldest first, when the disk runs low (the Mac's 256 GB SSD; src/retention.ts).
    await pruneForSpace(s, (id) => episodeDir(s.cfg, id)).catch((err) =>
      log("warn", "space prune failed", { error: errorMessage(err) }),
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
    // The experiments' verdicts: once on EXPERIMENT_VERDICT_DATE, then weekly while the desk test is undecided.
    if (!s.cfg.dryRun)
      await experimentVerdicts(s.db, s.cfg, s.now(), (m) => s.notify(m)).catch(
        (err) =>
          log("warn", "experiment verdicts failed", {
            error: errorMessage(err),
          }),
      );
    // The posting-time test's report on its last day (src/experiments.ts). The other platforms' numbers are read on their own clock (server.ts).
    if (!s.cfg.dryRun)
      await primeTimeVerdict(s.db, s.cfg, s.now(), (m) => s.notify(m)).catch(
        (err) =>
          log("warn", "posting-time report failed", {
            error: errorMessage(err),
          }),
      );
    // The weekly retention test on news Shorts (src/growth.ts): judged a week after it starts, then weekly until called.
    if (!s.cfg.dryRun)
      await growthVerdict(s.db, s.cfg, s.now(), (m) => s.notify(m)).catch(
        (err) =>
          log("warn", "growth test verdict failed", {
            error: errorMessage(err),
          }),
      );
    // The weekly long video's shape test (src/weeklytest.ts): each finished week, then the verdict.
    if (!s.cfg.dryRun)
      await weeklyVerdict(s.db, s.cfg, s.now(), (m) => s.notify(m)).catch(
        (err) =>
          log("warn", "weekly shape verdict failed", {
            error: errorMessage(err),
          }),
      );
    // Shorts: whether the Shorts feed served each one, and a warning when it stops (read-only).
    if (!s.cfg.dryRun) {
      await captureReach(s.db, s.youtube(), s.now()).catch((err) =>
        log("warn", "reach capture failed", { error: errorMessage(err) }),
      );
      await reachAlert(s.db, s.now(), (m) => s.notify(m)).catch((err) =>
        log("warn", "reach alert failed", { error: errorMessage(err) }),
      );
    }
    return { selected };
  });
  return result ? { ran: true, ...result } : { ran: false };
}

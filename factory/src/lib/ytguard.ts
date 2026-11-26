// The YouTube guard (14 Nov 2026). From the afternoon of 13 Nov YouTube answered yt-dlp on the PC and the Mac mini
// (one home IP) with "Sign in to confirm you're not a bot": the factory, the scene index, the archive and a day of
// helper tests had made far too many requests. Nothing here gets around that check (no tokens, no spoofed clients,
// no proxies, and no cookies except the one exception below). It makes the factory a polite, low-volume client and
// copes while a block lasts:
//
// - One budget for every process (the factory and its scene-index and archive children share a state file in
//   DATA_DIR/ytguard): YT_HOURLY_BUDGET yt-dlp calls to YouTube in any hour (default 60), background work (the scene
//   index, the archive, library growth: children started with YT_CLASS=background) at most a quarter of it.
// - Spacing with jitter between calls: a few seconds for a video's own fetches, most of a minute for background.
// - A "not a bot" answer (or a 429) stops every YouTube call for YT_BLOCK_COOLDOWN_HOURS (default 6), doubling on
//   each new strike within a day, up to 48 hours. A refused call throws YtPausedError at once, so the video's own
//   fetches fall straight through to the fallbacks the callers already have (Steam, IGDB, press kits, the owner's
//   footage, saved clips) and no slot waits. When the pause ends one call tries YouTube; if it works the block lifts.
// - Answers are kept: search and detail listings for hours, downloaded files on disk, so a retry or the next video
//   about the same game asks YouTube nothing.
// - One Discord line when a block starts and one when it lifts, sent by the factory process, never repeated.
//
// The one exception, approved by the owner on 19 Nov 2026 (age-restricted GTA VI uploads cannot be fetched
// anonymously): the game footage fetcher alone (GAME_FETCH's `build --complete` turns: its searches, the details
// of its candidates and the download of the chosen full movie or no-commentary playthrough proxy) may sign in
// with YTDLP_COOKIES_FILE, the cookies of a separate, disposable 18+ Google account made only for this, never the
// Pulse or Orryy channel accounts (src/lib/ytsignin.ts signedInArgs; mac/ytcookies.sh exports them on the Mac
// mini). Nothing else in the factory sends those cookies unless switched on (19 Nov 2026, each default off:
// SIGNED_CLIPS, SIGNED_LIGHT_INDEX, TREND_FEED; together at most YT_SIGNED_CLIP_SHARE of the signed-in budget, so the
// fetcher keeps the rest), and no signed-in call may name Pulse's own channel or videos (src/lib/ytown.ts; refused
// here). A call carrying --cookies is a signed-in call and has its own lane here:
// - its own budget, YT_SIGNED_HOURLY calls in any hour (default 20), not counted in the anonymous budget;
// - its own pause: a bot answer on the signed-in lane pauses only that lane (6 hours, doubling, 48 at most), and the
//   anonymous lane's pause does not stop it. While it is paused the fetcher's calls go anonymous instead;
// - "Sign in to confirm your age" on the anonymous lane is not a bot strike: that one video is marked as needing
//   sign-in (the fetcher skips it while it cannot sign in, and fetches it signed in when it can) and work moves on;
// - a missing cookies file, or YouTube saying the cookies are invalid or signed out, logs a warning once a day,
//   queues one Discord line (the download account needs signing in again on the Mac mini) and the fetcher goes
//   anonymous until the file is exported again (a newer file) or a day has passed.
//
// Rationing (25 Nov 2026). The logs of 20-25 Nov showed the home IP refused anonymously for good (each block lift
// was met by a bot check on the very first anonymous request, inside 34 seconds) and the signed-in download account
// lasting only 3 to 6 hours after each lift at up to 20 requests an hour. Nothing here gets around a check either; it
// only asks YouTube less, and in a better order:
// - YT_ANON_LANE (auto, the default; on; off): in auto, when the first anonymous answer after a lift is a bot check
//   twice running (two lifts), the anonymous lane retires for YT_ANON_RETIRE_DAYS (14) and every anonymous call is
//   refused at once, with no request. Nothing goes anonymous after a signed-in try (src/lib/ytsignin.ts, build.ts).
// - The signed-in lane is rationed: YT_SIGNED_PER_HOUR (4) and YT_SIGNED_DAILY (30) requests, at least
//   YT_SIGNED_MIN_GAP_SECONDS (300, plus up to half again at random) apart, in priority order: the current Short's
//   lines (and its named missions and characters), then long videos, then background library building (the scene
//   index, the game fetcher, cutscene harvesting, the light index, the trend feed). Background goes only when no Short
//   or long video has asked in the last 15 minutes, only into a free slot, and within YT_SIGNED_BG_SHARE (0.3) of the
//   day; long videos leave the last 30% of the day for Shorts.
// - Searches go to the YouTube Data API (YOUTUBE_API_KEY, src/lib/ytapisearch.ts) when it can answer in yt-dlp's own
//   shape, within YT_API_SEARCHES_PER_DAY (40), so page requests are left for downloads.
// - A call that failed is not asked again for a while (a gone video for a week, a bot-checked call until its lane's
//   pause ends, anything else for 6 hours): YtRecentFailureError at once, no request.
//
// The rules (decide, afterCall) are pure and tested; the rest is file locking and caching around them.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { log } from "./util.ts";
import { ownChannel, touchesOwnChannel, type OwnChannel } from "./ytown.ts";
import { apiSearch, isApiQuotaError, parseSearchCall, type ApiGet } from "./ytapisearch.ts";

// ---------------------------------------------------------------- settings

export interface GuardSettings {
  /** yt-dlp calls to YouTube allowed in any rolling hour; 0: no budget. */
  hourlyBudget: number;
  /** Share of the budget background work may use. */
  backgroundShare: number;
  /** First pause after a bot check, in hours; 0: no pause (the budget still applies). */
  cooldownHours: number;
  /** The longest pause, in hours. */
  maxCooldownHours: number;
  /** Least gap between a video's own calls, and the extra random part on top. */
  urgentGapMs: number;
  urgentJitterMs: number;
  /** The same for background calls. */
  backgroundGapMs: number;
  backgroundJitterMs: number;
  /** A video's call waits at most this long for its turn; past it the call is refused and the fallbacks take over. */
  urgentMaxWaitMs: number;
  /** Background calls may wait longer: nothing is waiting on them. */
  backgroundMaxWaitMs: number;
  /** YT_SIGNED_PER_HOUR (YT_SIGNED_HOURLY before 25 Nov): signed-in requests in any rolling hour; 0: no hourly cap. */
  signedHourlyBudget: number;
  /** YT_SIGNED_DAILY: signed-in requests in any rolling 24 hours; 0: no daily cap. */
  signedDailyBudget: number;
  /** YT_SIGNED_MIN_GAP_SECONDS, in ms: the least gap between signed-in requests (up to half again is added at random). */
  signedMinGapMs: number;
  /** YT_SIGNED_BG_SHARE: the most of the daily signed-in budget background library building may use. */
  signedBackgroundShare: number;
  /** The share of the daily signed-in budget kept for Shorts: long videos and background stop short of it. */
  signedShortReserve: number;
  /** How long a Short's or a long video's signed-in request may wait for its slot (background never waits). */
  signedShortMaxWaitMs: number;
  signedLongMaxWaitMs: number;
  /**
   * YT_SIGNED_CLIP_SHARE (default 0.5): the most of the hourly signed-in budget that background users other than the
   * game fetcher (the light index, the trend feed) may take. A Short's or a long video's own pulls are not held to it.
   */
  signedClipShare: number;
  /**
   * YT_SIGNED_MOVIE_SHARE (default 0.5; 26 Nov 2026): the share of the day's background allowance kept for the game
   * fetcher and covered games' movies ("fetcher", "movie"): the library, clips and the trend feed together stop at the
   * rest, so a full movie always finds room in the day.
   */
  signedMovieShare: number;
  /** YT_ANON_LANE: auto (retire after failed lifts), on (never retire), off (never ask YouTube anonymously). */
  anonLane: "auto" | "on" | "off";
  /** YT_ANON_RETIRE_DAYS: how long the anonymous lane stays retired. */
  anonRetireDays: number;
  /** Lifts in a row whose first anonymous answer was a bot check before the lane retires. */
  anonRetireAfterLiftFails: number;
  /** YT_API_SEARCH: on unless "off"; the Data API answers searches when YOUTUBE_API_KEY is set. */
  apiSearch: boolean;
  /** YT_API_SEARCHES_PER_DAY: Data API searches (100 quota units each) a Pacific day; background takes at most half. */
  apiSearchesPerDay: number;
}

const num = (v: string | undefined, d: number): number => {
  if (v === undefined || v.trim() === "") return d;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

/** The settings from the environment (pure given `env`). Both defaults are on: the guard is protective. */
export function guardSettings(
  env: NodeJS.ProcessEnv = process.env,
): GuardSettings {
  const anon = String(env.YT_ANON_LANE ?? "").trim().toLowerCase();
  return {
    hourlyBudget: Math.floor(num(env.YT_HOURLY_BUDGET, 60)),
    backgroundShare: 0.25,
    cooldownHours: num(env.YT_BLOCK_COOLDOWN_HOURS, 6),
    maxCooldownHours: 48,
    urgentGapMs: 6_000,
    urgentJitterMs: 6_000,
    backgroundGapMs: 45_000,
    backgroundJitterMs: 45_000,
    urgentMaxWaitMs: 3 * 60_000,
    backgroundMaxWaitMs: 15 * 60_000,
    // Measured 20-25 Nov: at up to 20 an hour the download account lasted 3 to 6 hours after each lift. A fifth of
    // that rate, spaced, and a daily ceiling below the fewest requests it can have taken before a check.
    signedHourlyBudget: Math.floor(num(env.YT_SIGNED_PER_HOUR, num(env.YT_SIGNED_HOURLY, 4))),
    signedDailyBudget: Math.floor(num(env.YT_SIGNED_DAILY, 30)),
    signedMinGapMs: num(env.YT_SIGNED_MIN_GAP_SECONDS, 300) * 1000,
    signedBackgroundShare: Math.min(1, num(env.YT_SIGNED_BG_SHARE, 0.3)),
    signedShortReserve: 0.3,
    signedShortMaxWaitMs: 8 * 60_000,
    signedLongMaxWaitMs: 15 * 60_000,
    signedClipShare: Math.min(1, num(env.YT_SIGNED_CLIP_SHARE, 0.5)),
    signedMovieShare: Math.min(1, num(env.YT_SIGNED_MOVIE_SHARE, 0.5)),
    anonLane: anon === "on" || anon === "off" ? anon : "auto",
    anonRetireDays: num(env.YT_ANON_RETIRE_DAYS, 14),
    anonRetireAfterLiftFails: 2,
    apiSearch: String(env.YT_API_SEARCH ?? "").trim().toLowerCase() !== "off",
    apiSearchesPerDay: Math.floor(num(env.YT_API_SEARCHES_PER_DAY, 40)),
  };
}

// ---------------------------------------------------------------- what counts as a YouTube call

/** True for a yt-dlp child pointed at YouTube (pure). Twitch clips, self-updates and --version pass untouched. */
export function isYouTubeCall(cmd: string, args: readonly string[]): boolean {
  const base = path.basename(String(cmd)).toLowerCase();
  const ytdlp = /yt[-_]dlp/.test(base) || args.some((a) => a === "yt_dlp");
  if (!ytdlp) return false;
  return args.some((a) =>
    /(^|[/.])youtube\.com\/|youtu\.be\/|^ytsearch\d*:|^ytsearchdate\d*:/i.test(
      String(a),
    ),
  );
}

/** YouTube's bot wall or its rate limit, in yt-dlp's words (pure). */
export function isBotCheck(text: string): boolean {
  return (
    /confirm (?:that )?you(?:’|'|`)?re not a bot|confirm you are not a bot/i.test(
      text,
    ) ||
    /HTTP Error 429|Too Many Requests/i.test(text) ||
    // YouTube's soft rate limit (25 Nov 2026): "This content isn't available, try again later" and "The current session
    // has been rate-limited". A wall like the bot check, never a gone video.
    /content isn(?:’|'|`)?t available, try again later|session has been rate-limited|rate-limited by YouTube/i.test(text)
  );
}

/** YouTube's age gate, in yt-dlp's words (pure): the video needs a signed-in 18+ account, nothing to do with bots. */
export function isAgeGate(text: string): boolean {
  return /sign in to confirm your age|age[- ]restricted|inappropriate for some users/i.test(text);
}

/** yt-dlp saying the cookies it was given are no good: rotated, signed out, unreadable or gone (pure). */
export function isCookieTrouble(text: string): boolean {
  return /cookies are no longer valid|cookies? (?:has|have) expired|does not look like a Netscape format cookies file|invalid (?:Netscape|cookies?) file|(?:no such file|not found|cannot open|could not (?:open|load)).{0,80}cookie|cookie.{0,80}(?:no such file|not found|cannot open|could not (?:open|load))/i.test(
    text,
  );
}

/** Which lane a call takes: one carrying --cookies (only the game fetcher's, src/lib/ytsignin.ts) is signed in (pure). */
export type Lane = "anon" | "signed";
export function laneOfCall(args: readonly string[]): Lane {
  return args.some((a) => a === "--cookies" || a.startsWith("--cookies=")) ? "signed" : "anon";
}

/** The YouTube video id a call is about, from its watch or short link (pure); undefined for searches. */
export function videoIdOf(args: readonly string[]): string | undefined {
  for (const a of args) {
    const m =
      /[?&]v=([\w-]{11})/.exec(String(a)) ??
      /youtu\.be\/([\w-]{11})/.exec(String(a)) ??
      /youtube\.com\/(?:shorts|embed|live)\/([\w-]{11})/.exec(String(a));
    if (m) return m[1];
  }
  return undefined;
}

export type CallClass = "urgent" | "background";

/**
 * Who a signed-in call is for: the game fetcher (the default, the whole signed-in budget) or one of the smaller users
 * that share YT_SIGNED_CLIP_SHARE of it: an age-gated clip pull (SIGNED_CLIPS), the light index (SIGNED_LIGHT_INDEX)
 * or the trend feed (TREND_FEED). Carried through the async call chain, so the callers' own runners need no change.
 */
export type YtPurpose = "fetcher" | "clip" | "trend" | "library" | "movie";
// 26 Nov 2026 (every scene-index turn signs in now, src/sceneindex/job.ts): "movie" is a full cutscene movie or a
// no-commentary playthrough for a covered game (a launch plan or a planned upload, src/sceneindex/movieplan.ts), the
// most valuable background work, counted like the fetcher (other background yields to both, YT_SIGNED_MOVIE_SHARE).
// "library" is the rest of the scene index (light turns, archive builds) and shares YT_SIGNED_CLIP_SHARE with clips
// and trends. Background calls never wait for a slot (a Short's or long video's wait would grow behind a booking).
const purposeStore = new AsyncLocalStorage<YtPurpose>();
const PURPOSES: readonly YtPurpose[] = ["fetcher", "clip", "trend", "library", "movie"];

/** YT_PURPOSE, set by the scene index job on its children (pure): the purpose their calls count as. */
export function envPurpose(env: NodeJS.ProcessEnv = process.env): YtPurpose | undefined {
  const v = String(env.YT_PURPOSE ?? "").trim().toLowerCase() as YtPurpose;
  return PURPOSES.includes(v) ? v : undefined;
}

/** Runs `fn` with every YouTube call inside it counted as `purpose` on the signed-in lane. */
export function withYtPurpose<T>(purpose: YtPurpose, fn: () => Promise<T>): Promise<T> {
  return purposeStore.run(purpose, fn);
}

/** The purpose of the calls being made now (the fetcher when none was set). */
export function currentYtPurpose(): YtPurpose {
  return purposeStore.getStore() ?? envPurpose() ?? "fetcher";
}

/**
 * How urgent a call is on the signed-in lane and for the Data API's search quota: the current Short's own lines (and
 * its named missions and characters) first, then a long video's footage, then background library building. Set around
 * an episode's step (src/pipeline.ts advance); anything outside one is background.
 */
export type YtPriority = "short" | "long" | "background";
const priorityStore = new AsyncLocalStorage<YtPriority>();

/** Runs `fn` with every YouTube call inside it made at `priority`. */
export function withYtPriority<T>(priority: YtPriority, fn: () => Promise<T>): Promise<T> {
  return priorityStore.run(priority, fn);
}

/** The priority of the calls being made now: a background child or the trend feed is always background. */
export function currentYtPriority(
  cls: CallClass = callClass(),
  purpose: YtPurpose = currentYtPurpose(),
): YtPriority {
  if (cls === "background" || purpose === "trend") return "background";
  return priorityStore.getStore() ?? "background";
}

/** A child started with YT_CLASS=background (the scene index, the archive) is background; anything else is a video's own fetch. */
export function callClass(env: NodeJS.ProcessEnv = process.env): CallClass {
  return String(env.YT_CLASS ?? "").toLowerCase() === "background"
    ? "background"
    : "urgent";
}

// ---------------------------------------------------------------- the rules (pure)

/** One lane's budget and pause: the anonymous lane is the state's own fields, the signed-in lane is `signed`. */
export interface LaneState {
  /** When each recent call started (ms), the last hour's only. */
  calls: number[];
  /** Background calls among them. */
  backgroundCalls: number[];
  /** The earliest moment the next call may start. */
  nextAt: number;
  /** Set while YouTube is refusing us; cleared by a call that works after the pause. */
  block?: {
    since: number;
    until: number;
    strikes: number;
    /** Calls made between the last lift and this block: how long the lane lasted. */
    calls?: number;
  };
  /** A call trying YouTube after the pause (ms), so only one tries at a time. */
  probeAt?: number;
  /** When the last block lifted (ms), for the backoff. */
  liftedAt?: number;
  /** Strikes of the last block, carried into the next one when it comes within a day. */
  lastStrikes?: number;
  /** Signed-in lane only: the background calls made for the light index and the trend feed (YT_SIGNED_CLIP_SHARE). */
  auxCalls?: number[];
  /** Signed-in lane only: every call of the last 24 hours (YT_SIGNED_DAILY), and the background ones among them. */
  dayCalls?: number[];
  dayBackground?: number[];
  /** Signed-in lane only: when a Short's or a long video's call last asked for the lane (what background yields to). */
  demand?: { short?: number; long?: number };
  /** Signed-in lane only: the day's background calls by the library, clips and the trend feed (YT_SIGNED_MOVIE_SHARE). */
  dayAux?: number[];
  /** Calls made since the last lift (or since the state began): the measured window, logged when a block starts. */
  sinceLift?: number;
  /** Calls made per UTC day, the last 14 days. */
  days?: Record<string, number>;
}

export interface GuardState extends LaneState {
  /** Discord lines waiting for the factory to send them (each queued once). */
  alerts: string[];
  /** The signed-in lane (the game fetcher with the download account's cookies): its own budget and pause. */
  signed?: LaneState;
  /** Videos YouTube age-gated on the anonymous lane (id: when), for the signed-in lane to fetch. */
  needsSignIn?: Record<string, number>;
  /** The cookies file missing or refused, until a signed-in call works again. */
  cookieTrouble?: {
    reason: "missing" | "signed-out";
    since: number;
    /** When the last warning was logged (once a day). */
    warnedAt: number;
  };
  /** The anonymous lane retired (YT_ANON_LANE=auto): its first answer after a lift was a bot check, lifts in a row. */
  anonRetired?: { since: number; until: number; liftFails: number };
  /** Lifts in a row whose first anonymous answer was a bot check (a working answer clears it). */
  anonLiftFails?: number;
  /** Set when the anonymous lane's block lifts, until its first answer (working or a bot check) comes back. */
  anonAfterLift?: number;
  /** Calls that failed, not asked again until `until`: "<lane>:k:<cache key>", or "v:<video id>" for a gone video. */
  failures?: Record<string, { until: number; why: string }>;
  /** The Data API's searches this Pacific day (YT_API_SEARCHES_PER_DAY). */
  api?: { day: string; used: number; background: number };
}

export const emptyLane = (): LaneState => ({
  calls: [],
  backgroundCalls: [],
  nextAt: 0,
});

export const emptyState = (): GuardState => ({
  ...emptyLane(),
  alerts: [],
});

/** The lane's own state inside the shared state (the signed-in one made on first use). */
export function laneState(state: GuardState, lane: Lane): LaneState {
  if (lane === "anon") return state;
  state.signed ??= emptyLane();
  return state.signed;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PROBE_MS = 10 * 60_000;
/** How long a Short's or a long video's request keeps lower priorities off the signed-in lane. */
export const DEMAND_MS = 15 * 60_000;

/** Why a call was held back without asking YouTube. */
export type HoldReason =
  | "blocked"
  | "probing"
  | "budget"
  | "share"
  | "busy"
  | "daily"
  | "reserve"
  | "queue"
  | "retired";

export type Decision =
  | { go: true; at: number; probe: boolean }
  | {
      go: false;
      reason: HoldReason;
      until?: number;
    };

/**
 * When the anonymous lane may be asked again (pure): undefined while it is open, Infinity with YT_ANON_LANE=off. A
 * retirement that has ended is cleared in place, and the lane gets a fresh count of failed lifts.
 */
export function anonRetiredUntil(root: GuardState, now: number, s: GuardSettings): number | undefined {
  if (s.anonLane === "off") return Infinity;
  if (s.anonLane === "on" || !root.anonRetired) return undefined;
  if (now < root.anonRetired.until) return root.anonRetired.until;
  root.anonRetired = undefined;
  root.anonLiftFails = 0;
  return undefined;
}

/**
 * The anonymous lane's closed window, for the Shorts that would wait for YouTube (pure; reads only): while it is
 * retired, until the retirement ends (a year with YT_ANON_LANE=off), so nothing waits for it; else its bot-check pause.
 */
export function anonClosedWindow(
  root: GuardState,
  now: number,
  s: GuardSettings,
): { since?: number; until: number } | undefined {
  const r = anonRetiredUntil({ ...root }, now, s);
  if (r !== undefined) return { since: root.anonRetired?.since, until: Number.isFinite(r) ? r : now + 365 * DAY };
  return root.block ? { since: root.block.since, until: root.block.until } : undefined;
}

/** True when an anonymous call could be asked now (pure; reads only): not retired and not paused for a bot check. */
export function anonOpenNow(root: GuardState, now: number, s: GuardSettings): boolean {
  if (anonRetiredUntil({ ...root }, now, s) !== undefined) return false;
  return !(root.block && now < root.block.until);
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Counts a call that goes, for the measured windows (pure; in place). */
function countCall(state: LaneState, at: number): void {
  state.sinceLift = (state.sinceLift ?? 0) + 1;
  const days = { ...(state.days ?? {}) };
  days[utcDay(at)] = (days[utcDay(at)] ?? 0) + 1;
  state.days = Object.fromEntries(
    Object.entries(days)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 14),
  );
}

/**
 * The signed-in lane's rules (pure; in place): its pause, the hourly and daily budgets, the Shorts' reserve and the
 * background share, then the priority order and the spacing. A Short's call may wait for the next slot, a long video's
 * too unless a Short asked in the last 15 minutes; background takes only a free slot nobody else wants.
 */
function decideSigned(
  root: GuardState,
  now: number,
  s: GuardSettings,
  rand: number,
  purpose: YtPurpose,
  priority: YtPriority,
): Decision {
  const state = laneState(root, "signed");
  state.calls = state.calls.filter((t) => now - t < HOUR);
  state.backgroundCalls = state.backgroundCalls.filter((t) => now - t < HOUR);
  state.auxCalls = (state.auxCalls ?? []).filter((t) => now - t < HOUR);
  state.dayCalls = (state.dayCalls ?? []).filter((t) => now - t < DAY);
  state.dayBackground = (state.dayBackground ?? []).filter((t) => now - t < DAY);
  const demand = (state.demand ??= {});
  if (priority !== "background") demand[priority] = now;
  state.dayAux = (state.dayAux ?? []).filter((t) => now - t < DAY);
  // The light index, the library, clips and the trend feed are the smaller background users; the game fetcher and a
  // covered game's movie keep the rest of the background allowance.
  const aux = priority === "background" && purpose !== "fetcher" && purpose !== "movie";
  let probe = false;
  if (state.block) {
    if (now < state.block.until) return { go: false, reason: "blocked", until: state.block.until };
    if (state.probeAt && now - state.probeAt < PROBE_MS)
      return { go: false, reason: "probing", until: state.probeAt + PROBE_MS };
    probe = true;
  }
  const hourly = s.signedHourlyBudget;
  const daily = s.signedDailyBudget;
  if (hourly > 0 && state.calls.length >= hourly)
    return { go: false, reason: "budget", until: state.calls[0]! + HOUR };
  if (daily > 0) {
    if (state.dayCalls.length >= daily) return { go: false, reason: "daily", until: state.dayCalls[0]! + DAY };
    if (priority !== "short" && state.dayCalls.length >= Math.floor(daily * (1 - s.signedShortReserve)))
      return { go: false, reason: "reserve", until: state.dayCalls[0]! + DAY };
    const bgDaily = Math.floor(daily * s.signedBackgroundShare);
    if (priority === "background" && state.dayBackground.length >= bgDaily)
      return { go: false, reason: "share", until: (state.dayBackground[0] ?? now) + DAY };
    // The trend feed has only its hourly share: a busy day of light turns never shuts it out.
    if (aux && purpose !== "trend" && state.dayAux.length >= Math.floor(bgDaily * (1 - s.signedMovieShare)))
      return { go: false, reason: "share", until: (state.dayAux[0] ?? now) + DAY };
  }
  // The light index and the trend feed share YT_SIGNED_CLIP_SHARE of the hour among background users; the game
  // fetcher keeps the rest.
  if (aux && hourly > 0 && state.auxCalls.length >= Math.floor(hourly * s.signedClipShare))
    return { go: false, reason: "share", until: (state.auxCalls[0] ?? now) + HOUR };
  const asked = (p: "short" | "long") => demand[p] !== undefined && now - demand[p]! < DEMAND_MS;
  if (priority === "background" && (asked("short") || asked("long")))
    return { go: false, reason: "queue", until: Math.max(demand.short ?? 0, demand.long ?? 0) + DEMAND_MS };
  if (priority === "long" && asked("short")) return { go: false, reason: "queue", until: demand.short! + DEMAND_MS };
  const at = Math.max(now, state.nextAt);
  const maxWait =
    priority === "short"
      ? s.signedShortMaxWaitMs
      : priority === "long"
        ? s.signedLongMaxWaitMs
        : 0;
  if (at - now > maxWait) return { go: false, reason: "busy", until: at };
  state.nextAt = at + s.signedMinGapMs * (1 + 0.5 * rand);
  state.calls.push(at);
  state.dayCalls.push(at);
  if (priority === "background") {
    state.backgroundCalls.push(at);
    state.dayBackground.push(at);
  }
  if (aux) {
    state.auxCalls.push(at);
    if (purpose !== "trend") state.dayAux.push(at);
  }
  if (probe) state.probeAt = now;
  countCall(state, at);
  return { go: true, at, probe };
}

/**
 * Whether a call may go and when (pure). `rand` is in [0, 1). The state is changed in place: a call that goes is
 * counted and books its start, so the next call is spaced after it.
 */
export function decide(
  root: GuardState,
  now: number,
  cls: CallClass,
  s: GuardSettings,
  rand: number,
  lane: Lane = "anon",
  purpose: YtPurpose = "fetcher",
  /** The signed-in lane's order (currentYtPriority); background when not given. */
  priority: YtPriority = "background",
): Decision {
  // Each lane keeps its own count, spacing and pause: the anonymous pause never stops a signed-in call, nor the
  // reverse. The signed-in lane is rationed and ordered by priority (decideSigned).
  if (lane === "signed") return decideSigned(root, now, s, rand, purpose, priority);
  const retired = anonRetiredUntil(root, now, s);
  if (retired !== undefined)
    return { go: false, reason: "retired", until: Number.isFinite(retired) ? retired : undefined };
  const state = root;
  const budget = s.hourlyBudget;
  state.calls = state.calls.filter((t) => now - t < HOUR);
  state.backgroundCalls = state.backgroundCalls.filter((t) => now - t < HOUR);
  let probe = false;
  if (state.block) {
    if (now < state.block.until)
      return { go: false, reason: "blocked", until: state.block.until };
    if (state.probeAt && now - state.probeAt < PROBE_MS)
      return { go: false, reason: "probing", until: state.probeAt + PROBE_MS };
    probe = true;
  }
  if (budget > 0) {
    if (state.calls.length >= budget)
      return { go: false, reason: "budget", until: state.calls[0]! + HOUR };
    const bgCap = Math.max(1, Math.floor(budget * s.backgroundShare));
    if (cls === "background" && state.backgroundCalls.length >= bgCap)
      return {
        go: false,
        reason: "budget",
        until: state.backgroundCalls[0]! + HOUR,
      };
  }
  const at = Math.max(now, state.nextAt);
  const maxWait =
    cls === "background" ? s.backgroundMaxWaitMs : s.urgentMaxWaitMs;
  if (at - now > maxWait) return { go: false, reason: "busy", until: at };
  const gap =
    cls === "background"
      ? s.backgroundGapMs + rand * s.backgroundJitterMs
      : s.urgentGapMs + rand * s.urgentJitterMs;
  state.nextAt = at + gap;
  state.calls.push(at);
  if (cls === "background") state.backgroundCalls.push(at);
  if (probe) state.probeAt = now;
  countCall(state, at);
  return { go: true, at, probe };
}

/** The pause for a block's nth strike, in ms (pure): the base, doubled per strike, capped. */
export function cooldownMs(strikes: number, s: GuardSettings): number {
  const hours = Math.min(
    s.maxCooldownHours,
    s.cooldownHours * 2 ** Math.max(0, strikes - 1),
  );
  return Math.round(hours * HOUR);
}

const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** The owner's line when a block starts (pure). */
export function startAlert(until: number, now: number): string {
  const hours = Math.max(1, Math.round((until - now) / HOUR));
  return (
    `⏸️ YouTube is asking the factory to prove it is not a bot, so I have stopped fetching from YouTube for about ${hours} hours ` +
    `(until about ${clock(until)} UTC). Library and index building wait; videos keep going out with Steam, IGDB, ` +
    `press kits, your own footage and clips already saved. Nothing for you to do. I will say once when it lifts.`
  );
}

/** The owner's line when a block lifts (pure). */
export function liftAlert(budget: number): string {
  return budget > 0
    ? `▶️ YouTube is answering the factory normally again. Footage fetching has restarted at a gentle pace (at most ${budget} requests an hour).`
    : `▶️ YouTube is answering the factory normally again. Footage fetching has restarted.`;
}

/** The owner's line when the signed-in lane meets a bot check (pure). */
export function signedStartAlert(until: number, now: number): string {
  const hours = Math.max(1, Math.round((until - now) / HOUR));
  return (
    `⏸️ YouTube asked the signed-in download account to prove it is not a bot, so the game footage fetcher has stopped ` +
    `signing in for about ${hours} hours (until about ${clock(until)} UTC). It keeps searching anonymously meanwhile; ` +
    `age-restricted uploads wait. Nothing for you to do. I will say once when it lifts.`
  );
}

/** The owner's line when the signed-in lane's pause lifts (pure). */
export function signedLiftAlert(budget: number): string {
  return budget > 0
    ? `▶️ The signed-in download account is answering normally again. The game footage fetcher signs in again (at most ${budget} requests an hour).`
    : `▶️ The signed-in download account is answering normally again. The game footage fetcher signs in again.`;
}

/** The owner's one line when the download account's cookies are missing or refused (pure). */
export function cookieAlert(reason: "missing" | "signed-out"): string {
  return (
    `🔑 The download account needs signing in again on the Mac mini: ` +
    (reason === "missing"
      ? `the cookies file (YTDLP_COOKIES_FILE) is not there. `
      : `YouTube says its cookies are no longer valid or signed out. `) +
    `The game footage fetcher carries on anonymously, so age-restricted uploads wait. To fix it, sign the download ` +
    `account in again in its Brave profile on the Mac mini, then run mac/ytcookies.sh in Terminal.`
  );
}

/** The owner's one line when the anonymous lane retires (pure). */
export function retireAlert(until: number, liftFails: number): string {
  return (
    `⏹️ YouTube refused the factory's very first anonymous request after each of the last ${liftFails} pauses, so I have ` +
    `retired anonymous YouTube fetching until ${new Date(until).toISOString().slice(0, 10)}. Only the signed-in download ` +
    `account fetches now, at a slow rationed pace with Shorts first; searches go through the YouTube Data API. Videos ` +
    `keep going out with Steam, IGDB, press kits, your own footage and saved clips. Nothing for you to do.`
  );
}

export type Outcome = "ok" | "bot" | "age" | "cookies" | "other";

/**
 * Records a call's outcome on its lane (pure; changes the state in place). A bot answer starts a block, or
 * lengthens it when a probe after the pause meets the wall again; a call that works after the pause lifts it. Each
 * block queues one start line and one lift line. An age gate or refused cookies is never a strike (the guard marks
 * the video or the cookies instead). Returns what changed, for the log.
 */
export function afterCall(
  root: GuardState,
  now: number,
  outcome: Outcome,
  probe: boolean,
  s: GuardSettings,
  lane: Lane = "anon",
): "started" | "extended" | "lifted" | "retired" | undefined {
  // The anonymous lane's first answer after a lift (an age gate is an answer; a removed video says nothing): a bot
  // check there, lifts in a row, retires the lane (YT_ANON_LANE=auto); a working answer clears the count.
  // The lift this answer may be the first after (a probe lifting the block now is not its own first answer).
  const pending = lane === "anon" ? root.anonAfterLift : undefined;
  const alertsBefore = root.alerts.length;
  const change = laneAfterCall(root, now, outcome, probe, s, lane);
  if (pending === undefined || !(outcome === "ok" || outcome === "age" || outcome === "bot")) return change;
  if (root.anonAfterLift === pending) root.anonAfterLift = undefined;
  if (outcome !== "bot") {
    root.anonLiftFails = 0;
    return change;
  }
  root.anonLiftFails = (root.anonLiftFails ?? 0) + 1;
  if (s.anonLane !== "auto" || root.anonLiftFails < s.anonRetireAfterLiftFails) return change;
  root.anonRetired = { since: now, until: now + Math.round(s.anonRetireDays * DAY), liftFails: root.anonLiftFails };
  // The retirement's line replaces the ordinary "paused, I will say when it lifts" one queued just now.
  root.alerts.splice(alertsBefore);
  root.alerts.push(retireAlert(root.anonRetired.until, root.anonLiftFails));
  return "retired";
}

function laneAfterCall(
  root: GuardState,
  now: number,
  outcome: Outcome,
  probe: boolean,
  s: GuardSettings,
  lane: Lane,
): "started" | "extended" | "lifted" | undefined {
  const state = laneState(root, lane);
  const signed = lane === "signed";
  if (outcome === "bot") {
    if (s.cooldownHours <= 0) return undefined;
    if (state.block) {
      // Calls already under way when the wall went up report it too; only a probe's answer is a new strike.
      if (!probe) return undefined;
      const strikes = state.block.strikes + 1;
      state.block = {
        ...state.block,
        strikes,
        until: now + cooldownMs(strikes, s),
      };
      state.probeAt = undefined;
      return "extended";
    }
    const recent =
      state.liftedAt !== undefined && now - state.liftedAt < 24 * HOUR;
    const strikes = recent ? (state.lastStrikes ?? 1) + 1 : 1;
    const until = now + cooldownMs(strikes, s);
    state.block = { since: now, until, strikes, calls: state.sinceLift };
    state.probeAt = undefined;
    root.alerts.push(signed ? signedStartAlert(until, now) : startAlert(until, now));
    return "started";
  }
  if (!probe) return undefined;
  if (outcome === "ok" && state.block) {
    state.lastStrikes = state.block.strikes;
    state.liftedAt = now;
    state.block = undefined;
    state.probeAt = undefined;
    state.sinceLift = 0;
    if (!signed) root.anonAfterLift = now;
    root.alerts.push(signed ? signedLiftAlert(s.signedHourlyBudget) : liftAlert(s.hourlyBudget));
    return "lifted";
  }
  // Another failure (a removed video, a 403 on one stream) says nothing about the wall: let the next call try.
  state.probeAt = undefined;
  return undefined;
}

const SIGN_IN_KEEP_MS = 30 * 24 * HOUR;
const SIGN_IN_KEEP_COUNT = 500;

/** Marks a video YouTube age-gated on the anonymous lane (pure; in place): the newest 500 of the last 30 days kept. */
export function markNeedsSignIn(state: GuardState, videoId: string, now: number): void {
  const kept = Object.entries({ ...(state.needsSignIn ?? {}), [videoId]: now })
    .filter(([, at]) => now - at < SIGN_IN_KEEP_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, SIGN_IN_KEEP_COUNT);
  state.needsSignIn = Object.fromEntries(kept);
}

const LIFT_FAIL_MS = 10 * 60_000;

/**
 * The count of failed lifts for a state written before 25 Nov (pure; in place): a block that started within ten
 * minutes of the last lift is one, so the evidence already on the Mac mini counts.
 */
export function seedLiftFails(state: GuardState): void {
  if (state.anonLiftFails !== undefined) return;
  const b = state.block;
  state.anonLiftFails =
    b && state.liftedAt !== undefined && b.since >= state.liftedAt && b.since - state.liftedAt <= LIFT_FAIL_MS ? 1 : 0;
}

const GONE_MS = 7 * DAY;
const FAIL_MS = 6 * HOUR;
const FAIL_KEEP = 1500;

/** yt-dlp saying the video itself is gone or closed to us (pure): removed, private, terminated, claimed, members only. */
export function isGoneVideo(text: string): boolean {
  if (isBotCheck(text) || isAgeGate(text)) return false;
  return /video unavailable|private video|has been removed|no longer available|account associated with this video has been terminated|copyright claim|members[- ]only|join this channel to get access/i.test(
    text,
  );
}

/** The failure keys a call is looked up under (pure): its video when it names one, and the call itself on its lane. */
export function failureKeys(lane: Lane, args: readonly string[]): string[] {
  const id = videoIdOf(args);
  return [...(id ? [`v:${id}`] : []), `${lane}:k:${cacheKey(args)}`];
}

/** A failure still standing for this call (pure; drops ended ones in place). */
export function recentFailure(
  root: GuardState,
  lane: Lane,
  args: readonly string[],
  now: number,
): { until: number; why: string } | undefined {
  for (const key of failureKeys(lane, args)) {
    const f = root.failures?.[key];
    if (!f) continue;
    if (now < f.until) return f;
    delete root.failures![key];
  }
  return undefined;
}

/**
 * Records a failed call so it is not asked again soon (pure; in place): a gone video for a week on both lanes, a
 * bot-checked call until its lane's pause ends (an hour at least), anything else for 6 hours. Age gates and refused
 * cookies are not failures of the call (the guard handles them), nor is a timeout.
 */
export function noteFailure(
  root: GuardState,
  lane: Lane,
  args: readonly string[],
  now: number,
  outcome: Outcome,
  text: string,
): void {
  if (outcome === "ok" || outcome === "age" || outcome === "cookies") return;
  // Only YouTube's own answers are remembered: a local fault (yt-dlp missing, a full disk, an ffmpeg step) is fixed
  // on our side and the call may go again at once.
  if (outcome === "other" && !/ERROR:\s*\[youtube|HTTP Error \d{3}|video unavailable|private video/i.test(text)) return;
  const id = videoIdOf(args);
  let key = `${lane}:k:${cacheKey(args)}`;
  let until = now + FAIL_MS;
  let why = (text.split("\n").find((l) => /ERROR/.test(l)) ?? text.split("\n")[0] ?? "").trim().slice(0, 160);
  if (outcome === "bot") {
    until = Math.max(laneState(root, lane).block?.until ?? 0, now + HOUR);
    why = "bot check";
  } else if (id && isGoneVideo(text)) {
    key = `v:${id}`;
    until = now + GONE_MS;
    why = "video unavailable";
  }
  const kept = Object.entries({ ...(root.failures ?? {}), [key]: { until, why } })
    .filter(([, f]) => now < f.until)
    .sort((a, b) => b[1].until - a[1].until)
    .slice(0, FAIL_KEEP);
  root.failures = Object.fromEntries(kept);
}

/** The day the Data API's quota counts in (it resets at midnight Pacific time). */
export function pacificDay(now: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Takes one Data API search from the day's allowance (pure; in place): YT_API_SEARCHES_PER_DAY in all, background at
 * most half of it, so a Short's and a long video's searches always find some left. False: none left for this one.
 */
export function takeApiSearch(root: GuardState, now: number, priority: YtPriority, s: GuardSettings): boolean {
  const day = pacificDay(now);
  if (!root.api || root.api.day !== day) root.api = { day, used: 0, background: 0 };
  if (s.apiSearchesPerDay <= 0 || root.api.used >= s.apiSearchesPerDay) return false;
  if (priority === "background" && root.api.background >= Math.floor(s.apiSearchesPerDay / 2)) return false;
  root.api.used++;
  if (priority === "background") root.api.background++;
  return true;
}

/** The Data API said its quota is spent: no more API searches until the Pacific day turns (pure; in place). */
export function apiSpent(root: GuardState, now: number, s: GuardSettings): void {
  const day = pacificDay(now);
  root.api = { day, used: Math.max(s.apiSearchesPerDay, root.api?.day === day ? root.api.used : 0), background: root.api?.background ?? 0 };
}

/** True when the video was age-gated on the anonymous lane within the last 30 days (pure). */
export function needsSignInNow(state: GuardState, videoId: string, now: number): boolean {
  const at = state.needsSignIn?.[videoId];
  return at !== undefined && now - at < SIGN_IN_KEEP_MS;
}

/**
 * Records trouble with the download account's cookies (pure; in place). The first time in an episode queues the one
 * Discord line; returns true when the warning is due in the log (once a day).
 */
export function noteCookieTrouble(state: GuardState, now: number, reason: "missing" | "signed-out"): boolean {
  const had = state.cookieTrouble;
  if (!had) state.alerts.push(cookieAlert(reason));
  const due = !had || now - had.warnedAt >= 24 * HOUR;
  state.cookieTrouble = {
    reason,
    // A refusal restarts the day's wait before the next signed-in try; a missing file keeps its first moment.
    since: had && reason === "missing" && had.reason === "missing" ? had.since : now,
    warnedAt: due ? now : had!.warnedAt,
  };
  return due;
}

/**
 * Whether the cookies file may be used now (pure): yes unless YouTube refused it, and then only once the owner has
 * exported a newer file or a day has passed since the refusal (one signed-in try a day).
 */
export function cookiesUsable(state: GuardState, fileMtimeMs: number, now: number): boolean {
  const t = state.cookieTrouble;
  if (!t || t.reason === "missing") return true;
  return fileMtimeMs > t.since || now - t.since >= 24 * HOUR;
}

// ---------------------------------------------------------------- the refusal callers see

/** A YouTube call refused by the guard: the caller falls back as it does for any failed fetch. */
export class YtPausedError extends Error {
  constructor(
    readonly reason: HoldReason,
    until?: number,
    readonly lane: Lane = "anon",
  ) {
    const signed = lane === "signed";
    const why =
      reason === "blocked"
        ? `YouTube asked for a bot check, so ${signed ? "signed-in " : ""}fetching is paused${until ? ` until ${clock(until)} UTC` : ""}`
        : reason === "probing"
          ? `${signed ? "signed-in " : ""}YouTube fetching is paused while one call checks whether the bot check has lifted`
          : reason === "budget"
            ? signed
              ? "the hourly signed-in YouTube budget (YT_SIGNED_PER_HOUR) is used up"
              : "the hourly YouTube budget (YT_HOURLY_BUDGET) is used up"
            : reason === "daily"
              ? "the daily signed-in YouTube budget (YT_SIGNED_DAILY) is used up"
              : reason === "reserve"
                ? "the rest of today's signed-in YouTube budget is kept for Shorts"
                : reason === "share"
                  ? "background work has used its share of the signed-in YouTube budget (YT_SIGNED_BG_SHARE, YT_SIGNED_CLIP_SHARE)"
                  : reason === "queue"
                    ? "a Short or long video is using the signed-in YouTube lane; background work waits"
                    : reason === "retired"
                      ? `anonymous YouTube fetching is retired${until ? ` until ${new Date(until).toISOString().slice(0, 10)}` : ""} (YT_ANON_LANE)`
                      : "too many YouTube calls are queued ahead of this one";
    super(`YouTube fetch skipped: ${why}`);
    this.name = "YtPausedError";
  }
}

/** A call that failed recently, not asked again yet (src/lib/ytguard.ts noteFailure): the caller falls back. */
export class YtRecentFailureError extends Error {
  constructor(
    readonly until: number,
    why: string,
  ) {
    super(`YouTube fetch skipped: the same call failed recently (${why}); not asked again until ${new Date(until).toISOString().slice(0, 16)} UTC`);
    this.name = "YtRecentFailureError";
  }
}

export function isYtRecentFailure(err: unknown): boolean {
  return err instanceof YtRecentFailureError || (err as Error | undefined)?.name === "YtRecentFailureError";
}

export function isYtPaused(err: unknown): boolean {
  return (
    err instanceof YtPausedError ||
    (err as Error | undefined)?.name === "YtPausedError"
  );
}

/** A signed-in call that names Pulse's own channel or one of its videos: refused outright, never a strike. */
export class YtOwnChannelError extends Error {
  constructor() {
    super("YouTube fetch refused: the signed-in download account never touches Pulse's own channel or videos");
    this.name = "YtOwnChannelError";
  }
}

// ---------------------------------------------------------------- caching (pure parts)

/** The value after -o/--output, when the call writes one named media file (pure). */
export function outputFile(args: readonly string[]): string | undefined {
  const i = args.findIndex((a) => a === "-o" || a === "--output");
  const out = i >= 0 ? args[i + 1] : undefined;
  if (!out || out.includes("%(")) return undefined;
  if (!/\.(mp4|webm|mkv|m4a|mp3|opus|wav)$/i.test(out)) return undefined;
  if (args.some((a) => /^--(write|print|dump)|^-[jJ]$|^--load-info/.test(a)))
    return undefined;
  return out;
}

/** True when the call only reads listings or details to stdout and writes nothing (pure). */
export function stdoutOnly(args: readonly string[]): boolean {
  if (
    args.some(
      (a) =>
        a === "-o" ||
        a === "--output" ||
        a === "-P" ||
        a === "--paths" ||
        /^--write|^--no-simulate|^--exec/.test(a),
    )
  )
    return false;
  return args.some((a) =>
    /^(--skip-download|--flat-playlist|--dump-single-json|--dump-json|-J|-j|--print|--get-\w+|--simulate)$/.test(
      a,
    ),
  );
}

/** How long a stdout answer is kept (pure): details carry signed links that expire, listings keep longer. */
export function stdoutTtlMs(args: readonly string[]): number {
  return args.some((a) => /^(--dump-single-json|--dump-json|-J|-j)$/.test(a)) &&
    !args.includes("--flat-playlist")
    ? 3 * HOUR
    : 12 * HOUR;
}

/** The cache key of a call (pure): its arguments, with the output path reduced to its extension. */
export function cacheKey(args: readonly string[]): string {
  const i = args.findIndex((a) => a === "-o" || a === "--output");
  const norm = args.map((a, j) =>
    i >= 0 && j === i + 1 ? path.extname(a).toLowerCase() : a,
  );
  return createHash("sha1").update(JSON.stringify(norm)).digest("hex");
}

// ---------------------------------------------------------------- the shared state file

export interface GuardIo {
  dir: string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  rand: () => number;
  settings: () => GuardSettings;
  cls: () => CallClass;
  /** Pulse's own channel (src/lib/ytown.ts); the environment's when not given. */
  own?: () => OwnChannel;
  /** YOUTUBE_API_KEY for the Data API's searches; the environment's when not given. */
  apiKey?: () => string;
  /** The HTTP getter for the Data API (tests give their own); fetch with a 20-second timeout when not given. */
  apiGet?: ApiGet;
}

function readState(file: string): GuardState {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<GuardState>;
    const st: GuardState = {
      ...emptyState(),
      ...j,
      calls: Array.isArray(j.calls) ? j.calls : [],
      backgroundCalls: Array.isArray(j.backgroundCalls)
        ? j.backgroundCalls
        : [],
      alerts: Array.isArray(j.alerts) ? j.alerts : [],
      signed:
        j.signed && typeof j.signed === "object"
          ? {
              ...emptyLane(),
              ...j.signed,
              calls: Array.isArray(j.signed.calls) ? j.signed.calls : [],
              backgroundCalls: Array.isArray(j.signed.backgroundCalls) ? j.signed.backgroundCalls : [],
              auxCalls: Array.isArray(j.signed.auxCalls) ? j.signed.auxCalls : [],
              dayCalls: Array.isArray(j.signed.dayCalls) ? j.signed.dayCalls : [],
              dayBackground: Array.isArray(j.signed.dayBackground) ? j.signed.dayBackground : [],
              dayAux: Array.isArray(j.signed.dayAux) ? j.signed.dayAux : [],
            }
          : undefined,
      failures: j.failures && typeof j.failures === "object" ? j.failures : undefined,
    };
    seedLiftFails(st);
    return st;
  } catch {
    return emptyState();
  }
}

function writeState(file: string, state: GuardState): void {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file);
}

/** Runs `fn` on the state under a lock shared by every process using the same directory. */
async function withState<T>(io: GuardIo, fn: (s: GuardState) => T): Promise<T> {
  fs.mkdirSync(io.dir, { recursive: true });
  const lock = path.join(io.dir, "state.lock");
  const file = path.join(io.dir, "state.json");
  for (let i = 0; ; i++) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch {
      try {
        // A lock left by a killed process is taken over after 15 seconds.
        if (Date.now() - fs.statSync(lock).mtimeMs > 15_000)
          fs.rmSync(lock, { recursive: true, force: true });
      } catch {
        // gone already
      }
      if (i > 400) throw new Error("YouTube guard: state lock busy");
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  try {
    const state = readState(file);
    const out = fn(state);
    writeState(file, state);
    return out;
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- the guard

export interface GuardRunOptions {
  cls?: CallClass;
  cache?: boolean;
  purpose?: YtPurpose;
  priority?: YtPriority;
}

export interface YtGuard {
  /** Runs a yt-dlp call through the guard: cached answer, budget, spacing, block. Non-YouTube calls pass straight through. */
  run<T extends { stdout: string | Buffer; stderr: string | Buffer }>(
    cmd: string,
    args: readonly string[],
    fn: () => Promise<T>,
    o?: GuardRunOptions,
  ): Promise<T>;
  /**
   * A flat search answered by the Data API only (its cache, then the day's API allowance at `priority`), in yt-dlp's
   * own shape; undefined when the API cannot answer. Never a page request (src/sceneindex/movieplan.ts).
   */
  apiOnlySearch(args: readonly string[], priority?: YtPriority): Promise<string | undefined>;
  /** True when an anonymous call could go now: the lane is neither retired nor paused (read without the lock). */
  anonOpen(): boolean;
  /** Sends the queued Discord lines, each once. */
  flushAlerts(send: (text: string) => unknown): Promise<number>;
  /** The state now (for the doctor and tests). */
  state(): Promise<GuardState>;
  /** True when YouTube age-gated the video on the anonymous lane (read without the lock). */
  needsSignIn(videoId: string): boolean;
  /** Whether the cookies file (last changed at `mtimeMs`) may be used now (read without the lock). */
  cookiesUsable(mtimeMs: number): boolean;
  /** The cookies file is set but not there: warn once a day, one Discord line per episode. */
  cookiesMissing(file: string): Promise<void>;
}

const defaultApiGet: ApiGet = (url) => fetch(url, { signal: AbortSignal.timeout(20_000) });

const errText = (err: unknown): string => {
  const e = err as
    | { message?: unknown; stderr?: unknown; stdout?: unknown }
    | undefined;
  return `${String(e?.message ?? err)} ${String(e?.stderr ?? "")}`;
};

export function createYtGuard(io: GuardIo): YtGuard {
  // Read each time: DATA_DIR may be set by the .env after this module loads.
  const dirs = () => ({ fileDir: path.join(io.dir, "files"), metaDir: path.join(io.dir, "meta") });
  const maxCacheBytes = () => num(process.env.YT_CACHE_MAX_GB, 5) * 1024 ** 3;

  const fromCache = <T>(
    args: readonly string[],
    cache: boolean,
  ): T | undefined => {
    if (!cache) return undefined;
    const { fileDir, metaDir } = dirs();
    const key = cacheKey(args);
    const out = outputFile(args);
    try {
      if (out) {
        const cached = path.join(
          fileDir,
          key + path.extname(out).toLowerCase(),
        );
        if (fs.statSync(cached).size > 0) {
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.copyFileSync(cached, out, fs.constants.COPYFILE_FICLONE);
          const t = new Date(io.now());
          fs.utimesSync(cached, t, t);
          return { stdout: "", stderr: "" } as T;
        }
      } else if (stdoutOnly(args)) {
        const j = JSON.parse(
          fs.readFileSync(path.join(metaDir, `${key}.json`), "utf8"),
        ) as {
          at: number;
          stdout: string;
        };
        if (io.now() - j.at < stdoutTtlMs(args))
          return { stdout: j.stdout, stderr: "" } as T;
      }
    } catch {
      // not kept
    }
    return undefined;
  };

  const keep = (
    args: readonly string[],
    r: { stdout: string | Buffer },
    cache: boolean,
  ) => {
    if (!cache) return;
    const { fileDir, metaDir } = dirs();
    const key = cacheKey(args);
    const out = outputFile(args);
    try {
      if (out) {
        const size = fs.statSync(out).size;
        // A whole long upload (a scene-index proxy) is not worth a second copy.
        if (size <= 0 || size > 400 * 1024 ** 2) return;
        fs.mkdirSync(fileDir, { recursive: true });
        fs.copyFileSync(
          out,
          path.join(fileDir, key + path.extname(out).toLowerCase()),
          fs.constants.COPYFILE_FICLONE,
        );
        prune(fileDir);
      } else if (
        stdoutOnly(args) &&
        typeof r.stdout === "string" &&
        r.stdout.trim()
      ) {
        fs.mkdirSync(metaDir, { recursive: true });
        fs.writeFileSync(
          path.join(metaDir, `${key}.json`),
          JSON.stringify({ at: io.now(), stdout: r.stdout }),
        );
      }
    } catch {
      // a cache that cannot be written never stops the work
    }
  };

  const prune = (fileDir: string) => {
    const files = fs
      .readdirSync(fileDir)
      .map((f) => {
        const p = path.join(fileDir, f);
        const st = fs.statSync(p);
        return { p, size: st.size, at: st.mtimeMs };
      })
      .sort((a, b) => a.at - b.at);
    let total = files.reduce((n, f) => n + f.size, 0);
    const cap = maxCacheBytes();
    for (const f of files) {
      if (total <= cap) break;
      fs.rmSync(f.p, { force: true });
      total -= f.size;
    }
  };

  const stateFile = () => path.join(io.dir, "state.json");

  // The Data API's answer to a search, in the shape yt-dlp would have printed; undefined when it cannot answer (not a
  // search it understands, no key, the day's allowance used, an error), and the call goes on as before.
  const searchViaApi = async (
    args: readonly string[],
    s: GuardSettings,
    priority: YtPriority,
  ): Promise<string | undefined> => {
    if (!s.apiSearch) return undefined;
    const call = parseSearchCall(args, io.now());
    if (!call) return undefined;
    // In the test runner only a key the test gives is used: no test ever reaches the real API.
    const key = (io.apiKey ? io.apiKey() : process.env.NODE_TEST_CONTEXT ? "" : String(process.env.YOUTUBE_API_KEY ?? "")).trim();
    if (!key) return undefined;
    const took = await withState(io, (st) => takeApiSearch(st, io.now(), priority, s)).catch(() => false);
    if (!took) return undefined;
    try {
      const out = await apiSearch(call, key, io.apiGet ?? defaultApiGet);
      log("info", "youtube search answered by the Data API", {
        query: call.query.slice(0, 80),
        results: out.split("\n").filter(Boolean).length,
        priority,
      });
      return out;
    } catch (err) {
      const msg = errText(err).split("\n")[0]!.slice(0, 200);
      if (isApiQuotaError(msg)) await withState(io, (st) => apiSpent(st, io.now(), s)).catch(() => undefined);
      log("warn", "youtube Data API search failed; the search goes the usual way", { error: msg });
      return undefined;
    }
  };

  // What an answer means for signing in: an age gate on the anonymous lane marks that one video (never a strike);
  // refused cookies on the signed-in lane warn once a day and queue the one Discord line; a signed-in call that
  // works ends any cookie trouble, so the next episode is reported again.
  const afterSignIn = async (lane: Lane, outcome: Outcome, args: readonly string[]) => {
    try {
      if (lane === "anon" && outcome === "age") {
        const id = videoIdOf(args);
        if (!id) return;
        await withState(io, (st) => markNeedsSignIn(st, id, io.now()));
        log("info", "youtube age gate: video marked as needing sign-in", { videoId: id });
      } else if (lane === "signed" && outcome === "cookies") {
        const due = await withState(io, (st) => noteCookieTrouble(st, io.now(), "signed-out"));
        if (due) {
          log(
            "warn",
            "YouTube refused the download account's cookies (invalid or signed out): signed-in fetching stops until mac/ytcookies.sh is run again on the Mac mini (anonymous calls only while that lane is open)",
          );
          void flushNow();
        }
      } else if (lane === "signed" && outcome === "ok" && readState(stateFile()).cookieTrouble) {
        await withState(io, (st) => {
          st.cookieTrouble = undefined;
        });
        log("info", "the download account is signed in again");
      }
    } catch {
      // bookkeeping that cannot be written never stops the work
    }
  };

  return {
    async run(cmd, args, fn, o = {}) {
      if (!isYouTubeCall(cmd, args)) return fn();
      const lane = laneOfCall(args);
      // The hard rule: the download account never views, reads or touches Pulse's own channel or videos.
      if (lane === "signed" && touchesOwnChannel(args, io.own ? io.own() : ownChannel())) {
        log("warn", "signed-in youtube call refused: it names Pulse's own channel or video");
        throw new YtOwnChannelError();
      }
      const cache = o.cache !== false;
      const hit = fromCache<Awaited<ReturnType<typeof fn>>>(args, cache);
      if (hit) return hit;
      const s = io.settings();
      const cls = o.cls ?? io.cls();
      const purpose = o.purpose ?? currentYtPurpose();
      const priority = o.priority ?? currentYtPriority(cls, purpose);
      // A search the Data API can answer in yt-dlp's own shape never becomes a page request.
      const viaApi = await searchViaApi(args, s, priority);
      if (viaApi !== undefined) {
        const r = { stdout: viaApi, stderr: "" } as Awaited<ReturnType<typeof fn>>;
        keep(args, r, cache);
        return r;
      }
      const d = await withState(io, (st) => {
        // The same call failed recently: not asked again yet (no request, no budget spent).
        const failed = recentFailure(st, lane, args, io.now());
        if (failed) return { failed } as const;
        return decide(st, io.now(), cls, s, io.rand(), lane, purpose, priority);
      });
      if ("failed" in d) throw new YtRecentFailureError(d.failed.until, d.failed.why);
      if (!d.go) {
        if (d.reason !== "blocked" && d.reason !== "retired")
          log("info", "youtube call held back", {
            reason: d.reason,
            class: cls,
            lane,
            ...(lane === "signed" ? { purpose, priority } : {}),
          });
        throw new YtPausedError(d.reason, d.until, lane);
      }
      const wait = d.at - io.now();
      if (wait > 0) await io.sleep(wait);
      let outcome: Outcome = "other";
      let failText = "";
      let killed = false;
      // A signed-in call can still work while yt-dlp warns the cookies were refused (it carries on anonymously):
      // the pause counts it as working, the sign-in bookkeeping as refused cookies.
      let staleCookies = false;
      try {
        const r = await fn();
        outcome = "ok";
        staleCookies = lane === "signed" && isCookieTrouble(String(r.stderr ?? ""));
        keep(args, r, cache);
        return r;
      } catch (err) {
        const text = errText(err);
        failText = text;
        killed = Boolean((err as { killed?: boolean } | undefined)?.killed);
        outcome = isBotCheck(text)
          ? "bot"
          : lane === "signed" && (isCookieTrouble(text) || isAgeGate(text))
            ? "cookies" // an age gate while signed in means the cookies did not sign in (signed out or rotated)
            : lane === "anon" && isAgeGate(text)
              ? "age"
              : "other";
        throw err;
      } finally {
        // A bot answer, a probe's outcome, the first answer after an anonymous lift and a failure to remember need the
        // second lock; an ordinary working call skips it.
        const failed = outcome !== "ok" && outcome !== "age" && outcome !== "cookies" && !killed;
        const afterLift = lane === "anon" && outcome !== "other" && readState(stateFile()).anonAfterLift !== undefined;
        const wrote =
          outcome !== "bot" && !d.probe && !failed && !afterLift
            ? undefined
            : await withState(io, (st) => {
                const change = afterCall(st, io.now(), outcome, d.probe, s, lane);
                if (failed) noteFailure(st, lane, args, io.now(), outcome, failText);
                return {
                  change,
                  block: laneState(st, lane).block,
                  retired: st.anonRetired,
                };
              }).catch(() => undefined);
        const change = wrote?.change;
        const what = lane === "signed" ? "signed-in fetching" : "fetching";
        if (change === "started" || change === "extended" || change === "retired") {
          const st = wrote?.block;
          log("warn", `youtube bot check: ${what} paused (${change === "retired" ? "started" : change})`, {
            until: st ? new Date(st.until).toISOString() : undefined,
            strikes: st?.strikes,
            // How many requests the lane made between its last lift and this check: the measured window.
            callsSinceLift: st?.calls,
          });
        } else if (change === "lifted")
          log("info", `youtube bot check lifted; ${what} again`);
        if (change === "retired" && wrote?.retired)
          log("warn", "youtube anonymous lane retired: its first request after a lift met a bot check, lifts in a row; signed-in fetches only", {
            until: new Date(wrote.retired.until).toISOString(),
            liftFails: wrote.retired.liftFails,
          });
        if (change === "started" || change === "lifted" || change === "retired") void flushNow();
        await afterSignIn(lane, staleCookies ? "cookies" : outcome, args);
      }
    },
    async apiOnlySearch(args, priority = "background") {
      const hit = fromCache<{ stdout: string; stderr: string }>(args, true);
      if (hit) return String(hit.stdout);
      const out = await searchViaApi(args, io.settings(), priority);
      if (out !== undefined) keep(args, { stdout: out }, true);
      return out;
    },
    needsSignIn(videoId) {
      return needsSignInNow(readState(stateFile()), videoId, io.now());
    },
    anonOpen() {
      return anonOpenNow(readState(stateFile()), io.now(), io.settings());
    },
    cookiesUsable(mtimeMs) {
      return cookiesUsable(readState(stateFile()), mtimeMs, io.now());
    },
    async cookiesMissing(file) {
      const due = await withState(io, (st) => noteCookieTrouble(st, io.now(), "missing")).catch(() => false);
      if (due) {
        log(
          "warn",
          "the download account's cookies file is missing: signed-in fetching stops (run mac/ytcookies.sh on the Mac mini; anonymous calls only while that lane is open)",
          { file },
        );
        void flushNow();
      }
    },
    async flushAlerts(send) {
      const lines = await withState(io, (st) => st.alerts.splice(0));
      for (const line of lines) {
        try {
          await send(line);
        } catch {
          // an alert that cannot be sent never stops the work
        }
      }
      return lines.length;
    },
    state: () => withState(io, (st) => ({ ...st })),
  };
}

// ---------------------------------------------------------------- the process's guard

/** DATA_DIR as the config resolves it, so the factory and its children share one state file. */
export function guardDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(path.resolve(env.DATA_DIR || "./data"), "ytguard");
}

/** Off in the test runner (its children carry NODE_TEST_CONTEXT) unless a test asks, and with YT_GUARD=false. */
export function guardActive(env: NodeJS.ProcessEnv = process.env): boolean {
  if (String(env.YT_GUARD ?? "").toLowerCase() === "false") return false;
  return !env.NODE_TEST_CONTEXT;
}

let alertSink: ((text: string) => unknown) | undefined;

export const ytGuard: YtGuard = createYtGuard({
  get dir() {
    return guardDir();
  },
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  rand: Math.random,
  settings: () => guardSettings(),
  cls: () => callClass(),
});

async function flushNow(): Promise<void> {
  if (alertSink) await ytGuard.flushAlerts(alertSink).catch(() => 0);
}

/**
 * Where the block's start and lift lines go (src/services.ts: Discord and the event log). Only the factory process
 * registers one; a child's block is queued in the state file and sent from here within a minute.
 */
export function onYtGuardAlert(fn: (text: string) => unknown): void {
  alertSink = fn;
  if (!guardActive()) return;
  void flushNow();
  setInterval(() => void flushNow(), 60_000).unref();
}

/** A Data API search through this process's guard (undefined when the guard is off or the API cannot answer). */
export function guardedApiSearch(args: readonly string[], priority: YtPriority = "background"): Promise<string | undefined> {
  if (!guardActive()) return Promise.resolve(undefined);
  return ytGuard.apiOnlySearch(args, priority);
}

/** A yt-dlp call through this process's guard (or straight through when the guard is off). */
export function guardedYt<
  T extends { stdout: string | Buffer; stderr: string | Buffer },
>(
  cmd: string,
  args: readonly string[],
  fn: () => Promise<T>,
  o?: GuardRunOptions,
): Promise<T> {
  if (!guardActive()) return fn();
  return ytGuard.run(cmd, args, fn, o);
}

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
// The rules (decide, afterCall) are pure and tested; the rest is file locking and caching around them.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { log } from "./util.ts";
import { ownChannel, touchesOwnChannel, type OwnChannel } from "./ytown.ts";

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
  /** The signed-in lane's own budget (YT_SIGNED_HOURLY): the game fetcher's calls with the download account's cookies. */
  signedHourlyBudget: number;
  /**
   * YT_SIGNED_CLIP_SHARE (default 0.5): the most of that budget everything other than the game fetcher may use (age-gated
   * Shorts clips, the light index's captions, the trend feed), so the fetcher is never starved. 0: none of it.
   */
  signedClipShare: number;
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
    signedHourlyBudget: Math.floor(num(env.YT_SIGNED_HOURLY, 20)),
    signedClipShare: Math.min(1, num(env.YT_SIGNED_CLIP_SHARE, 0.5)),
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
    ) || /HTTP Error 429|Too Many Requests/i.test(text)
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
export type YtPurpose = "fetcher" | "clip" | "trend";
const purposeStore = new AsyncLocalStorage<YtPurpose>();

/** Runs `fn` with every YouTube call inside it counted as `purpose` on the signed-in lane. */
export function withYtPurpose<T>(purpose: YtPurpose, fn: () => Promise<T>): Promise<T> {
  return purposeStore.run(purpose, fn);
}

/** The purpose of the calls being made now (the fetcher when none was set). */
export function currentYtPurpose(): YtPurpose {
  return purposeStore.getStore() ?? "fetcher";
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
  };
  /** A call trying YouTube after the pause (ms), so only one tries at a time. */
  probeAt?: number;
  /** When the last block lifted (ms), for the backoff. */
  liftedAt?: number;
  /** Strikes of the last block, carried into the next one when it comes within a day. */
  lastStrikes?: number;
  /** Signed-in lane only: the calls made for clips, the light index and the trend feed (YT_SIGNED_CLIP_SHARE). */
  auxCalls?: number[];
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
const PROBE_MS = 10 * 60_000;

export type Decision =
  | { go: true; at: number; probe: boolean }
  | {
      go: false;
      reason: "blocked" | "probing" | "budget" | "share" | "busy";
      until?: number;
    };

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
): Decision {
  // Each lane keeps its own count, spacing and pause: the anonymous pause never stops a signed-in call, nor the
  // reverse. The signed-in lane has its own small budget and no background share (only the fetcher uses it).
  const state = laneState(root, lane);
  const budget = lane === "signed" ? s.signedHourlyBudget : s.hourlyBudget;
  state.calls = state.calls.filter((t) => now - t < HOUR);
  state.backgroundCalls = state.backgroundCalls.filter((t) => now - t < HOUR);
  const aux = lane === "signed" && purpose !== "fetcher";
  if (lane === "signed") state.auxCalls = (state.auxCalls ?? []).filter((t) => now - t < HOUR);
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
    if (lane === "anon" && cls === "background" && state.backgroundCalls.length >= bgCap)
      return {
        go: false,
        reason: "budget",
        until: state.backgroundCalls[0]! + HOUR,
      };
    // Clips, the light index and the trend feed share at most YT_SIGNED_CLIP_SHARE of the signed-in budget: the rest
    // is always left for the game fetcher.
    const auxCap = Math.floor(budget * s.signedClipShare);
    if (aux && state.auxCalls!.length >= auxCap)
      return { go: false, reason: "share", until: (state.auxCalls![0] ?? now) + HOUR };
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
  if (aux) state.auxCalls!.push(at);
  if (probe) state.probeAt = now;
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
    state.block = { since: now, until, strikes };
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
    readonly reason: "blocked" | "probing" | "budget" | "share" | "busy",
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
              ? "the hourly signed-in YouTube budget (YT_SIGNED_HOURLY) is used up"
              : "the hourly YouTube budget (YT_HOURLY_BUDGET) is used up"
            : reason === "share"
              ? "the clips' share of the signed-in YouTube budget (YT_SIGNED_CLIP_SHARE) is used up; the rest is kept for the game fetcher"
              : "too many YouTube calls are queued ahead of this one";
    super(`YouTube fetch skipped: ${why}`);
    this.name = "YtPausedError";
  }
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
}

function readState(file: string): GuardState {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<GuardState>;
    return {
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
            }
          : undefined,
    };
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

export interface YtGuard {
  /** Runs a yt-dlp call through the guard: cached answer, budget, spacing, block. Non-YouTube calls pass straight through. */
  run<T extends { stdout: string | Buffer; stderr: string | Buffer }>(
    cmd: string,
    args: readonly string[],
    fn: () => Promise<T>,
    o?: { cls?: CallClass; cache?: boolean; purpose?: YtPurpose },
  ): Promise<T>;
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
            "YouTube refused the download account's cookies (invalid or signed out): the game fetcher goes anonymous until mac/ytcookies.sh is run again on the Mac mini",
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
      const d = await withState(io, (st) =>
        decide(st, io.now(), cls, s, io.rand(), lane, purpose),
      );
      if (!d.go) {
        if (d.reason !== "blocked")
          log("info", "youtube call held back", {
            reason: d.reason,
            class: cls,
            lane,
            ...(lane === "signed" ? { purpose } : {}),
          });
        throw new YtPausedError(d.reason, d.until, lane);
      }
      const wait = d.at - io.now();
      if (wait > 0) await io.sleep(wait);
      let outcome: Outcome = "other";
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
        outcome = isBotCheck(text)
          ? "bot"
          : lane === "signed" && (isCookieTrouble(text) || isAgeGate(text))
            ? "cookies" // an age gate while signed in means the cookies did not sign in (signed out or rotated)
            : lane === "anon" && isAgeGate(text)
              ? "age"
              : "other";
        throw err;
      } finally {
        // Only a bot answer or a probe's outcome changes the pause; an ordinary call skips the second lock.
        const change =
          outcome !== "bot" && !d.probe
            ? undefined
            : await withState(io, (st) =>
                afterCall(st, io.now(), outcome, d.probe, s, lane),
              ).catch(() => undefined);
        const what = lane === "signed" ? "signed-in fetching" : "fetching";
        if (change === "started" || change === "extended") {
          const st = await withState(io, (x) => laneState(x, lane).block).catch(() => undefined);
          log("warn", `youtube bot check: ${what} paused (${change})`, {
            until: st ? new Date(st.until).toISOString() : undefined,
            strikes: st?.strikes,
          });
        } else if (change === "lifted")
          log("info", `youtube bot check lifted; ${what} again`);
        if (change === "started" || change === "lifted") void flushNow();
        await afterSignIn(lane, staleCookies ? "cookies" : outcome, args);
      }
    },
    needsSignIn(videoId) {
      return needsSignInNow(readState(stateFile()), videoId, io.now());
    },
    cookiesUsable(mtimeMs) {
      return cookiesUsable(readState(stateFile()), mtimeMs, io.now());
    },
    async cookiesMissing(file) {
      const due = await withState(io, (st) => noteCookieTrouble(st, io.now(), "missing")).catch(() => false);
      if (due) {
        log(
          "warn",
          "the download account's cookies file is missing: the game fetcher goes anonymous (run mac/ytcookies.sh on the Mac mini)",
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

/** A yt-dlp call through this process's guard (or straight through when the guard is off). */
export function guardedYt<
  T extends { stdout: string | Buffer; stderr: string | Buffer },
>(
  cmd: string,
  args: readonly string[],
  fn: () => Promise<T>,
  o?: { cls?: CallClass; cache?: boolean; purpose?: YtPurpose },
): Promise<T> {
  if (!guardActive()) return fn();
  return ytGuard.run(cmd, args, fn, o);
}

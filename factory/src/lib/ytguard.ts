// The YouTube guard (14 Nov 2026). From the afternoon of 13 Nov YouTube answered yt-dlp on the PC and the Mac mini
// (one home IP) with "Sign in to confirm you're not a bot": the factory, the scene index, the archive and a day of
// helper tests had made far too many requests. Nothing here gets around that check (no cookies, no tokens, no
// spoofed clients, no proxies). It makes the factory a polite, low-volume client and copes while a block lasts:
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
// The rules (decide, afterCall) are pure and tested; the rest is file locking and caching around them.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { log } from "./util.ts";

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

export type CallClass = "urgent" | "background";

/** A child started with YT_CLASS=background (the scene index, the archive) is background; anything else is a video's own fetch. */
export function callClass(env: NodeJS.ProcessEnv = process.env): CallClass {
  return String(env.YT_CLASS ?? "").toLowerCase() === "background"
    ? "background"
    : "urgent";
}

// ---------------------------------------------------------------- the rules (pure)

export interface GuardState {
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
  /** Discord lines waiting for the factory to send them (each queued once). */
  alerts: string[];
}

export const emptyState = (): GuardState => ({
  calls: [],
  backgroundCalls: [],
  nextAt: 0,
  alerts: [],
});

const HOUR = 3_600_000;
const PROBE_MS = 10 * 60_000;

export type Decision =
  | { go: true; at: number; probe: boolean }
  | {
      go: false;
      reason: "blocked" | "probing" | "budget" | "busy";
      until?: number;
    };

/**
 * Whether a call may go and when (pure). `rand` is in [0, 1). The state is changed in place: a call that goes is
 * counted and books its start, so the next call is spaced after it.
 */
export function decide(
  state: GuardState,
  now: number,
  cls: CallClass,
  s: GuardSettings,
  rand: number,
): Decision {
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
  if (s.hourlyBudget > 0) {
    if (state.calls.length >= s.hourlyBudget)
      return { go: false, reason: "budget", until: state.calls[0]! + HOUR };
    const bgCap = Math.max(1, Math.floor(s.hourlyBudget * s.backgroundShare));
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

export type Outcome = "ok" | "bot" | "other";

/**
 * Records a call's outcome (pure; changes the state in place). A bot answer starts a block, or lengthens it when a
 * probe after the pause meets the wall again; a call that works after the pause lifts it. Each block queues one
 * start line and one lift line. Returns what changed, for the log.
 */
export function afterCall(
  state: GuardState,
  now: number,
  outcome: Outcome,
  probe: boolean,
  s: GuardSettings,
): "started" | "extended" | "lifted" | undefined {
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
    state.alerts.push(startAlert(until, now));
    return "started";
  }
  if (!probe) return undefined;
  if (outcome === "ok" && state.block) {
    state.lastStrikes = state.block.strikes;
    state.liftedAt = now;
    state.block = undefined;
    state.probeAt = undefined;
    state.alerts.push(liftAlert(s.hourlyBudget));
    return "lifted";
  }
  // Another failure (a removed video, a 403 on one stream) says nothing about the wall: let the next call try.
  state.probeAt = undefined;
  return undefined;
}

// ---------------------------------------------------------------- the refusal callers see

/** A YouTube call refused by the guard: the caller falls back as it does for any failed fetch. */
export class YtPausedError extends Error {
  constructor(
    readonly reason: "blocked" | "probing" | "budget" | "busy",
    until?: number,
  ) {
    const why =
      reason === "blocked"
        ? `YouTube asked for a bot check, so fetching is paused${until ? ` until ${clock(until)} UTC` : ""}`
        : reason === "probing"
          ? "YouTube fetching is paused while one call checks whether the bot check has lifted"
          : reason === "budget"
            ? "the hourly YouTube budget (YT_HOURLY_BUDGET) is used up"
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
    o?: { cls?: CallClass; cache?: boolean },
  ): Promise<T>;
  /** Sends the queued Discord lines, each once. */
  flushAlerts(send: (text: string) => unknown): Promise<number>;
  /** The state now (for the doctor and tests). */
  state(): Promise<GuardState>;
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

  return {
    async run(cmd, args, fn, o = {}) {
      if (!isYouTubeCall(cmd, args)) return fn();
      const cache = o.cache !== false;
      const hit = fromCache<Awaited<ReturnType<typeof fn>>>(args, cache);
      if (hit) return hit;
      const s = io.settings();
      const cls = o.cls ?? io.cls();
      const d = await withState(io, (st) =>
        decide(st, io.now(), cls, s, io.rand()),
      );
      if (!d.go) {
        if (d.reason !== "blocked")
          log("info", "youtube call held back", {
            reason: d.reason,
            class: cls,
          });
        throw new YtPausedError(d.reason, d.until);
      }
      const wait = d.at - io.now();
      if (wait > 0) await io.sleep(wait);
      let outcome: Outcome = "other";
      try {
        const r = await fn();
        outcome = "ok";
        keep(args, r, cache);
        return r;
      } catch (err) {
        outcome = isBotCheck(errText(err)) ? "bot" : "other";
        throw err;
      } finally {
        // Only a bot answer or a probe's outcome changes anything; an ordinary call skips the second lock.
        const change =
          outcome !== "bot" && !d.probe
            ? undefined
            : await withState(io, (st) =>
                afterCall(st, io.now(), outcome, d.probe, s),
              ).catch(() => undefined);
        if (change === "started" || change === "extended") {
          const st = await withState(io, (x) => x.block).catch(() => undefined);
          log("warn", `youtube bot check: fetching paused (${change})`, {
            until: st ? new Date(st.until).toISOString() : undefined,
            strikes: st?.strikes,
          });
        } else if (change === "lifted")
          log("info", "youtube bot check lifted; fetching again");
        if (change === "started" || change === "lifted") void flushNow();
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
  o?: { cls?: CallClass; cache?: boolean },
): Promise<T> {
  if (!guardActive()) return fn();
  return ytGuard.run(cmd, args, fn, o);
}

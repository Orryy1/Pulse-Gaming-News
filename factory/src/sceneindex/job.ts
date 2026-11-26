// The scene index as a background job (SCENE_INDEX, off by default). Games are queued when a video about them is
// being made and there is no index yet, and when the launch calendar (launches.json) says a big release is out or a
// dated calendar entry names one for the days ahead. Every few minutes the factory gives the first queued game one
// bounded turn: a child process (src/tools/sceneindex.ts build) behind the Mac's turn-taker (~/orch/macrun.sh), so
// a render always wins and nothing else heavy runs beside it; on the PC the child takes its own orchestrator turn.
// One turn indexes a few stretches or describes a batch of shots, saves and exits; the next turn carries on. The
// queue is a small JSON file beside the indexes. The rules are pure and tested; only the tick runs anything.

import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage, log } from "../lib/util.ts";
import type { Config } from "../config.ts";
import type { LaunchEntry } from "../discovery/launches.ts";
import type { CalendarEntry } from "../calendar.ts";
import { baseGameOf, isGameplayIndex, sceneIndexDir, sceneSlug, type SceneSource } from "./schema.ts";

export interface QueuedGame {
  game: string;
  /** Chosen like a recent release: its remake's or remaster's uploads are the right ones. */
  recentRelease?: boolean;
  reason: string;
  requestedAt: string;
  lastTry?: string;
  tries?: number;
  /** "building": more turns to come; "waiting": the vision model or a turn was not available; "no-source": no clean upload yet; "done". */
  state?: "building" | "waiting" | "no-source" | "done";
  /** GAME_FETCH (src/sceneindex/gamefetch.ts): the launch fetcher's plan for a big release. */
  fetch?: FetchPlan;
  /**
   * A planned upload (src/sceneindex/movieplan.ts, 26 Nov 2026): a later movie chapter or a clean playthrough chosen
   * from the Data API's search. Built from exactly this source (no search, no details call: one signed-in request for
   * its proxy), never replaced by a recheck, and ahead of light turns. Wins over the launch plan on the same entry.
   */
  pin?: PinnedUpload;
}

/** A planned upload as the queue keeps it. */
export interface PinnedUpload {
  videoId: string;
  title: string;
  uploader: string;
  /** Seconds. */
  duration: number;
  kind: SceneSource["kind"];
  /** The movie's chapter (2 and up for a later chapter's index). */
  chapter?: number;
  /** The whole upload is past the story's opening: held during the spoiler window. */
  spoiler?: boolean;
  /** Its place in the queue (higher first), below the owner's own launch plan. */
  priority: number;
  plannedAt: string;
  /** Why the planner chose it, for the log and the weekly report. */
  why?: string;
}

/** A planned upload from the queue or the build's SCENE_INDEX_PIN (pure); undefined when it is not one. */
export function parsePin(raw: unknown): PinnedUpload | undefined {
  const p = raw as Partial<PinnedUpload> | null;
  if (!p || typeof p !== "object" || !/^[\w-]{11}$/.test(String(p.videoId ?? ""))) return undefined;
  const duration = Number(p.duration);
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  return {
    videoId: String(p.videoId),
    title: String(p.title ?? ""),
    uploader: String(p.uploader ?? ""),
    duration,
    kind: p.kind === "playthrough" ? "playthrough" : "movie",
    ...(Number.isInteger(p.chapter) && p.chapter! >= 1 ? { chapter: p.chapter } : {}),
    ...(p.spoiler === true ? { spoiler: true } : {}),
    priority: Number.isFinite(Number(p.priority)) ? Number(p.priority) : 0,
    plannedAt: String(p.plannedAt ?? ""),
    ...(typeof p.why === "string" && p.why ? { why: p.why } : {}),
  };
}

/** The source a planned upload's index is made from (pure). */
export function pinSource(p: PinnedUpload, now: Date): SceneSource {
  return {
    videoId: p.videoId,
    title: p.title,
    uploader: p.uploader,
    duration: p.duration,
    kind: p.kind,
    pickedAt: now.toISOString(),
    ...(p.chapter ? { chapter: p.chapter } : {}),
    ...(p.spoiler ? { spoiler: true } : {}),
  };
}

/** A queued game's place in the turn order (pure): its launch plan's or planned upload's priority, else 0. */
export function jobPriority(g: QueuedGame): number {
  return Math.max(g.fetch?.priority ?? 0, g.pin?.priority ?? 0);
}

/**
 * True when other planned uploads carry this game's story on (pure): a launch plan whose later chapters are planned
 * keeps the chapter it has, so the daily look for "a longer or better upload" never swaps it for a whole-story upload.
 */
export function hasPlannedParts(queue: SceneQueue, g: QueuedGame): boolean {
  const kind = isGameplayIndex(g.game) ? "playthrough" : "movie";
  const base = sceneSlug(baseGameOf(g.game));
  return queue.games.some(
    (x) => x !== g && x.pin?.kind === kind && sceneSlug(baseGameOf(x.game)) === base,
  );
}

/** How the launch fetcher looks for a big release's uploads (GAME_FETCH). */
export interface FetchPlan {
  /** ISO: nothing is searched before the game is out. */
  notBefore?: string;
  /** Hours between searches while no clean upload is found. */
  searchEveryHours: number;
  /** Hours between looks for a longer or better upload once one is indexed, until `recheckUntil`. */
  recheckEveryHours: number;
  recheckUntil: string;
  /** Higher goes first: the owner's titles, then the calendar, the big stories, the videos, the radar. */
  priority: number;
}

/** The queue with the launch fetcher's plan for a game: added when missing, the plan and recent-release flag set when present. */
export function planGame(
  queue: SceneQueue,
  game: string,
  plan: FetchPlan,
  reason: string,
  now: Date,
): SceneQueue {
  const slug = sceneSlug(game);
  if (!slug) return queue;
  const has = queue.games.find((g) => sceneSlug(g.game) === slug);
  if (has && JSON.stringify(has.fetch) === JSON.stringify(plan) && has.recentRelease) return queue;
  if (!has)
    return {
      games: [
        ...queue.games,
        { game: game.trim(), reason, requestedAt: now.toISOString(), recentRelease: true, fetch: plan },
      ],
    };
  return {
    games: queue.games.map((g) => (sceneSlug(g.game) === slug ? { ...g, recentRelease: true, fetch: plan } : g)),
  };
}

export interface SceneQueue {
  games: QueuedGame[];
}

/** A queue file's contents as a queue; anything unreadable is an empty queue. */
export function parseQueue(raw: unknown): SceneQueue {
  const games = (raw as SceneQueue | null)?.games;
  return {
    games: (Array.isArray(games) ? games : []).filter(
      (g) =>
        g &&
        typeof g.game === "string" &&
        g.game.trim() &&
        typeof g.requestedAt === "string",
    ).map((g) => {
      if (g.pin === undefined) return g;
      const pin = parsePin(g.pin);
      const { pin: _drop, ...rest } = g;
      void _drop;
      return pin ? { ...rest, pin } : rest;
    }),
  };
}

/** The queue with a game added, once a game however it is spelt; an existing entry is left as it is. */
export function queueGame(
  queue: SceneQueue,
  game: string,
  reason: string,
  now: Date,
  recentRelease = false,
): SceneQueue {
  const slug = sceneSlug(game);
  if (!slug || queue.games.some((g) => sceneSlug(g.game) === slug))
    return queue;
  return {
    games: [
      ...queue.games,
      {
        game: game.trim(),
        reason,
        requestedAt: now.toISOString(),
        ...(recentRelease ? { recentRelease } : {}),
      },
    ],
  };
}

/**
 * The games a script is about, for the queue (pure): each ranked entry's game, or the one game of a Short. A game
 * counts as a recent release (its remake's or remaster's uploads are the right ones) when its entry is from this
 * year or last, or when the script itself says remake or remaster. Games not out yet have nothing to index.
 */
export function gamesOfScript(
  script: {
    game_title?: string;
    headline?: string;
    hook?: string;
    entries?: Array<{ game_title?: string; year?: number }>;
  },
  now: Date,
): Array<{ game: string; recentRelease: boolean }> {
  const year = now.getUTCFullYear();
  const out = new Map<string, { game: string; recentRelease: boolean }>();
  for (const e of script.entries ?? []) {
    const game = e.game_title?.trim();
    if (!game || (e.year ?? 0) > year) continue;
    out.set(sceneSlug(game), { game, recentRelease: (e.year ?? 0) >= year - 1 });
  }
  const one = script.game_title?.trim();
  if (!out.size && one)
    out.set(sceneSlug(one), {
      game: one,
      recentRelease: /\b(remake|remaster(?:ed)?|reimagined)\b/i.test([script.headline, script.hook].join(" ")),
    });
  return [...out.values()];
}

/** Days after launch a big release is still looked for: the clean full movies appear within days, not hours. */
export const LAUNCH_SEARCH_DAYS = 14;
/** A dated calendar entry that names a launch-calendar game this many days ahead asks for its index now. */
export const CALENDAR_AHEAD_DAYS = 7;

/**
 * The launch calendar's games that want an index today: every game from its launch day for two weeks (found on
 * day one when a movie is already up, otherwise as soon as one appears), and any game a dated calendar entry of the
 * coming week names (a planned documentary on an older game gets its index before the writer needs it).
 */
export function launchGames(
  launches: LaunchEntry[],
  calendar: CalendarEntry[],
  now: Date,
): Array<{ game: string; reason: string }> {
  const day = 86_400_000;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const out: Array<{ game: string; reason: string }> = [];
  for (const l of launches) {
    const launch = Date.parse(`${l.launch}T00:00:00Z`);
    if (
      Number.isFinite(launch) &&
      today >= launch &&
      today <= launch + LAUNCH_SEARCH_DAYS * day
    ) {
      out.push({ game: l.game, reason: `launched ${l.launch}` });
      continue;
    }
    let re: RegExp | undefined;
    try {
      re = new RegExp(l.match, "i");
    } catch {
      re = undefined;
    }
    const entry = calendar.find((c) => {
      const at = Date.parse(`${c.date}T00:00:00Z`);
      return (
        Number.isFinite(at) &&
        at >= today &&
        at <= today + CALENDAR_AHEAD_DAYS * day &&
        re?.test(c.text)
      );
    });
    // A game that is not out yet has no playthrough to index.
    if (entry && Number.isFinite(launch) && launch <= today)
      out.push({ game: l.game, reason: `calendar ${entry.date}` });
  }
  return out;
}

const HOUR = 3_600_000;

/**
 * The queued game to work on now, or undefined: the first that is not done and not resting. A game with no clean
 * source rests twelve hours between searches (and is given up after two weeks of them); one waiting for the vision
 * model or for a turn rests half an hour.
 */
export function nextJob(queue: SceneQueue, now: Date): QueuedGame | undefined {
  // A launch plan (GAME_FETCH) waits for release, searches every few hours and goes in its priority's order.
  const ready = queue.games.filter((g) => {
    if (!g.pin && g.fetch?.notBefore && now.getTime() < Date.parse(g.fetch.notBefore)) return false;
    // A planned upload is built once and kept; a launch plan with planned later chapters keeps its chapter.
    if (g.state === "done") return !g.pin && !hasPlannedParts(queue, g) && sourceRecheckDue(g, now);
    const since = g.lastTry ? now.getTime() - Date.parse(g.lastTry) : Infinity;
    if (g.state === "no-source" && g.pin) return false;
    if (g.state === "no-source")
      return g.fetch
        ? now.getTime() <= Date.parse(g.fetch.recheckUntil) && since >= g.fetch.searchEveryHours * HOUR
        : (g.tries ?? 0) < 28 && since >= 12 * HOUR;
    if (g.state === "waiting") return since >= HOUR / 2;
    return true;
  });
  return ready.sort((a, b) => jobPriority(b) - jobPriority(a))[0];
}

/** A finished index is checked for a better source once a week for this long after it was asked for. */
export const RECHECK_DAYS = 45;

/**
 * Whether a finished game is due a look for a better source (pure): weekly for its first weeks, when the clean
 * full movies of a new release are still appearing (an index made on launch day from a playthrough is rebuilt
 * from the movie that follows). After that the index is left alone.
 */
export function sourceRecheckDue(g: QueuedGame, now: Date): boolean {
  if (g.state !== "done" || !g.lastTry || g.pin) return false;
  // A launch plan looks daily (GAME_FETCH_RECHECK_HOURS) for a longer or better upload while people finish the game.
  if (g.fetch)
    return (
      now.getTime() - Date.parse(g.lastTry) >= g.fetch.recheckEveryHours * HOUR &&
      now.getTime() <= Date.parse(g.fetch.recheckUntil)
    );
  const day = 86_400_000;
  return (
    now.getTime() - Date.parse(g.lastTry) >= 7 * day &&
    now.getTime() - Date.parse(g.requestedAt) <= RECHECK_DAYS * day
  );
}

/** The queue after a turn: the game's state from the last word the build printed, the try counted. */
export function afterTurn(
  queue: SceneQueue,
  game: string,
  outcome: string,
  now: Date,
  /**
   * Whether a planned upload's "waiting" counts towards giving it up: only while its proxy is not yet fetched (the
   * download is what a removed or private upload fails), never for the vision model being down or the Mac busy.
   */
  pinWaitCounts = true,
): SceneQueue {
  const slug = sceneSlug(game);
  const state: QueuedGame["state"] =
    outcome === "done"
      ? "done"
      : outcome === "no-source"
        ? "no-source"
        : outcome === "stretch" || outcome === "described"
          ? "building"
          : "waiting";
  return {
    games: queue.games.map((g) => {
      if (sceneSlug(g.game) !== slug) return g;
      // A planned upload counts its turns that got nowhere (removed, private, refused): after PIN_MAX_TRIES it is
      // given up ("no-source", never ready again); any progress starts the count again.
      if (g.pin && state === "waiting") {
        const tries = (g.tries ?? 0) + (pinWaitCounts ? 1 : 0);
        return { ...g, state: tries >= PIN_MAX_TRIES ? "no-source" : state, lastTry: now.toISOString(), tries };
      }
      return {
        ...g,
        state,
        lastTry: now.toISOString(),
        tries: state === "no-source" ? (g.tries ?? 0) + 1 : g.pin ? 0 : g.tries,
      };
    }),
  };
}

/**
 * Turns a planned upload may end "waiting" in a row before it is given up: the signed-in lane's longest pause (48
 * hours) at a turn every half hour, and a day more.
 */
export const PIN_MAX_TRIES = 150;

/** The last outcome word in a build's output ("stretch", "described", "done", "waiting", "no-source"); "" when none. */
export function turnOutcome(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/)[0] ?? "");
  return (
    lines
      .reverse()
      .map((w) => (w === "light" ? "done" : w))
      .find((w) =>
        ["stretch", "described", "done", "waiting", "no-source"].includes(w),
      ) ?? ""
  );
}

/**
 * The command for one turn (pure): behind the Mac's turn-taker where it is installed (renders always win), at
 * background priority on a Mac without it, plain on the PC (the tool takes the orchestrator's turn itself).
 */
export function turnCommand(
  platform: string,
  macrun: string | undefined,
  node: string,
  args: string[],
): [string, string[]] {
  if (platform !== "darwin") return [node, args];
  return macrun
    ? ["/bin/bash", [macrun, "pulse-sceneindex", node, ...args]]
    : ["taskpolicy", ["-b", node, ...args]];
}

type JobConfig = Pick<
  Config,
  | "dataDir"
  | "sceneIndex"
  | "sceneIndexProxyHeight"
  | "sceneIndexOcrFps"
  | "sceneIndexChunkMinutes"
  | "sceneIndexMaxHours"
  | "sceneIndexTurnSteps"
  | "ytdlpPath"
  | "whisperPython"
  | "macMinFreeGb"
> &
  Partial<Pick<Config, "archiveProxy" | "archiveBacklog" | "archiveComments" | "ytdlpCookiesFile">>;

const queueFile = (dataDir: string) =>
  path.join(dataDir, "sceneindex", "queue.json");

export async function readQueue(dataDir: string): Promise<SceneQueue> {
  try {
    return parseQueue(
      JSON.parse(await fsp.readFile(queueFile(dataDir), "utf8")),
    );
  } catch {
    return { games: [] };
  }
}

let tmpSeq = 0;

export async function writeQueue(dataDir: string, queue: SceneQueue): Promise<void> {
  const file = queueFile(dataDir);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  // 12-19 Nov 2026: two writers in one process shared "queue.json.<pid>.tmp", so the second rename found the file
  // already moved (ENOENT) and the game was never queued (Assassin's Creed Shadows, Bully, Fable and ten more).
  // Every write has its own temporary file now, and updateQueue runs one change at a time.
  const tmp = `${file}.${process.pid}.${++tmpSeq}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    await fsp.writeFile(tmp, JSON.stringify(queue, null, 1));
    await fsp.rename(tmp, file);
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
  }
}

let queueChain: Promise<unknown> = Promise.resolve();

/**
 * One change to the queue at a time in this process: read, change, write, so two callers never write over each
 * other's entry. `change` returns the same object to write nothing. Returns the queue as it now stands.
 */
export function updateQueue(
  dataDir: string,
  change: (q: SceneQueue) => SceneQueue,
): Promise<SceneQueue> {
  const run = queueChain.then(async () => {
    const queue = await readQueue(dataDir);
    const next = change(queue);
    if (next !== queue) await writeQueue(dataDir, next);
    return next;
  });
  queueChain = run.catch(() => undefined);
  return run;
}

/** Asks for a game's index (a video about it is being made, or it has launched). Does nothing while the setting is off. */
export async function requestSceneIndex(
  cfg: Pick<Config, "dataDir" | "sceneIndex">,
  game: string,
  reason: string,
  recentRelease = false,
  now = new Date(),
): Promise<void> {
  if (!cfg.sceneIndex || !game.trim()) return;
  try {
    let added = false;
    await updateQueue(cfg.dataDir, (queue) => {
      const next = queueGame(queue, game, reason, now, recentRelease);
      added = next !== queue;
      return next;
    });
    if (added) log("info", "scene index: game queued", { game, reason });
  } catch (err) {
    log("warn", "scene index: could not queue", {
      game,
      error: errorMessage(err),
    });
  }
}

/** Several games at once, one after another (two writers at once would lose one's entry). Never throws. */
export async function requestSceneIndexes(
  cfg: Pick<Config, "dataDir" | "sceneIndex">,
  games: Array<{ game: string; recentRelease?: boolean }>,
  reason: string,
): Promise<void> {
  for (const g of games) await requestSceneIndex(cfg, g.game, reason, Boolean(g.recentRelease));
}

/** Free disk above the floor a turn needs, GB: a proxy download for a launch plan, a proxy for anything else. */
export const LAUNCH_PROXY_MARGIN_GB = 3;
export const PROXY_MARGIN_GB = 6;
/** A 480p proxy's size an hour of source, GB (GTA VI's 2.7-hour movie: 0.97 GB), rounded up. */
export const PROXY_GB_PER_HOUR = 0.4;
/** A launch plan at this priority or above (the owner's titles, the calendar) is a covered game's high-value work. */
export const HIGH_VALUE_PRIORITY = 40;
/** On the PC the D: drive keeps this much free whatever the turn (owner, 15 Nov: Lore Lodge stops at 300). */
export const PC_D_MIN_FREE_GB = 320;

/** Free disk above the floor a turn must fetch its proxy into (pure): a planned upload's by its length. */
export function proxyMarginGb(g: QueuedGame): number {
  if (g.pin) return Math.max(LAUNCH_PROXY_MARGIN_GB, Math.ceil((g.pin.duration / 3600) * PROXY_GB_PER_HOUR) + 1);
  return g.fetch ? LAUNCH_PROXY_MARGIN_GB : PROXY_MARGIN_GB;
}

/**
 * A covered game's full movie or playthrough (26 Nov 2026, owner: high-value background): a planned upload, or a
 * launch plan for the owner's titles or the calendar. It goes before light turns whenever the disk allows.
 */
export function highValue(g: QueuedGame): boolean {
  return Boolean(g.pin) || (g.fetch?.priority ?? 0) >= HIGH_VALUE_PRIORITY;
}

/** Whether a queued game's next turn is the light index (ARCHIVE_BACKLOG, src/sceneindex/light.ts): no video at all. */
export function isLightTurn(g: QueuedGame, archiveBacklog: boolean, hasIndex: boolean): boolean {
  return (
    archiveBacklog &&
    !g.fetch &&
    !g.pin &&
    !g.reason.startsWith("archive: full") &&
    g.state !== "done" &&
    !hasIndex
  );
}

/**
 * The turn to give now (pure). 12-19 Nov 2026 the job gave GTA VI's launch build every turn (priority 50, always
 * "building") and the disk gate refused all of them at 42 GB free: 493 refusals, while thirty games a video had asked
 * for never got their one-minute light index, so no quote could come from them. Now:
 *   - a light turn downloads no video, so it needs only the floor itself, and a ready one goes first (a minute each);
 *   - a turn whose proxy is already on disk needs no margin above the floor (it only transcribes and describes);
 *   - a turn that must fetch a proxy keeps its margin, and when it cannot have it the next ready game that can run
 *     goes instead of nothing.
 * `blocked` is the first game the disk refused, for the log, when nothing could run.
 */
export function pickTurn(
  queue: SceneQueue,
  now: Date,
  o: {
    freeGb: number;
    floorGb: number;
    archiveBacklog: boolean;
    hasIndex: (g: QueuedGame) => boolean;
    hasProxy: (g: QueuedGame) => boolean;
    /** The last turn was a covered game's movie: a ready light turn goes now, so neither starves the other. */
    lastHighValue?: boolean;
    /** On the PC: D:'s free space, GB; a proxy must leave PC_D_MIN_FREE_GB after it. */
    pcFreeGb?: number;
  },
): { job?: QueuedGame; light?: boolean; blocked?: QueuedGame } {
  // Every ready game, in the order nextJob would give them.
  let rest = queue;
  const ready: QueuedGame[] = [];
  for (;;) {
    const g = nextJob(rest, now);
    if (!g) break;
    ready.push(g);
    rest = { games: rest.games.filter((x) => x !== g) };
  }
  const light = ready.filter((g) => isLightTurn(g, o.archiveBacklog, o.hasIndex(g)));
  const fits = (g: QueuedGame) => {
    const margin = o.hasProxy(g) ? 0 : proxyMarginGb(g);
    return o.freeGb >= o.floorGb + margin && (margin === 0 || (o.pcFreeGb ?? Infinity) - margin >= PC_D_MIN_FREE_GB);
  };
  // 26 Nov 2026: 20-26 Nov light turns took every turn and GTA VI's movie and gameplay plans got none. A covered game's
  // full movie or playthrough now goes first when the disk lets it, every other turn while light turns are waiting.
  const lightReady = light.length > 0 && o.freeGb >= o.floorGb;
  const first = ready.find((g) => !light.includes(g) && highValue(g) && fits(g));
  if (first && !(o.lastHighValue && lightReady)) return { job: first, light: false };
  if (lightReady) return { job: light[0], light: true };
  let blocked: QueuedGame | undefined;
  for (const g of ready) {
    if (light.includes(g)) continue;
    if (fits(g)) return { job: g, light: false };
    blocked ??= g;
  }
  return { blocked: blocked ?? light[0] };
}

let running = false;
/** Whether this process's last turn was a covered game's movie (pickTurn alternates it with light turns). */
let lastHighValue = false;

/** One turn's child process: its output and exit code (75: the Mac's turn-taker gave no turn). */
function runTool(c: string, a: string[], e: NodeJS.ProcessEnv): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      c,
      a,
      {
        env: e,
        cwd: path.join(path.dirname(TOOL), "..", ".."),
        timeout: 4 * HOUR,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout) =>
        resolve({
          stdout: String(stdout),
          code: err ? Number((err as { code?: number }).code ?? 1) : 0,
        }),
    );
  });
}
const TOOL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "tools",
  "sceneindex.ts",
);

/**
 * One pass of the job: queue what the launch calendar asks for, then give the next game one turn. Never two turns
 * at once, never throws, and nothing at all while SCENE_INDEX is off.
 */
export async function sceneIndexTick(
  cfg: JobConfig,
  wanted: Array<{ game: string; reason: string }> = [],
  deps: {
    now?: () => Date;
    freeGb?: () => Promise<number>;
    /** On the PC: the D: drive's free space, GB (PC_D_MIN_FREE_GB). */
    pcFreeGb?: () => Promise<number>;
    platform?: string;
    run?: (
      cmd: string,
      args: string[],
      env: NodeJS.ProcessEnv,
    ) => Promise<{ stdout: string; code: number }>;
  } = {},
): Promise<string | undefined> {
  if (!cfg.sceneIndex || running) return undefined;
  running = true;
  const now = deps.now ?? (() => new Date());
  try {
    const queue = await updateQueue(cfg.dataDir, (q0) => {
      let q = q0;
      for (const w of wanted) q = queueGame(q, w.game, w.reason, now(), true);
      return q;
    });
    if (!nextJob(queue, now())) return undefined;
    // The proxy is the only big file: never start a turn with the disk near the Mac's floor.
    const free = await (
      deps.freeGb ??
      (async () => {
        const s = await fsp.statfs(cfg.dataDir);
        return (s.bavail * s.bsize) / 1e9;
      })
    )().catch(() => Infinity);
    const has = (g: QueuedGame, file: string) => fs.existsSync(path.join(sceneIndexDir(cfg.dataDir, g.game), file));
    // The PC keeps D: above its floor (big downloads and libraries live there): below it, no turn that fetches a proxy.
    const platform = deps.platform ?? process.platform;
    const pcFree =
      platform === "win32"
        ? await (
            deps.pcFreeGb ??
            (async () => {
              const s = await fsp.statfs("D:/");
              return (s.bavail * s.bsize) / 1e9;
            })
          )().catch(() => Infinity)
        : Infinity;
    const picked = pickTurn(queue, now(), {
      freeGb: free,
      pcFreeGb: pcFree,
      lastHighValue,
      floorGb: cfg.macMinFreeGb,
      archiveBacklog: Boolean(cfg.archiveBacklog),
      hasIndex: (g) => has(g, "index.json"),
      hasProxy: (g) => has(g, "proxy.mp4"),
    });
    if (!picked.job) {
      if (picked.blocked)
        log("warn", "scene index: not enough free disk for a turn", {
          freeGb: Math.round(free),
          game: picked.blocked.game,
        });
      return undefined;
    }
    const job = picked.job;
    lastHighValue = highValue(job);
    const macrun = path.join(os.homedir(), "orch", "macrun.sh");
    // Every turn signs in since 26 Nov 2026 (the anonymous lane is retired, so an anonymous turn fetched nothing):
    // within the signed-in ration, a covered game's movie as "movie", everything else as "library" (src/lib/ytguard.ts).
    const cookies = cfg.ytdlpCookiesFile ?? "";
    // ARCHIVE_BACKLOG (src/sceneindex/light.ts): a game a video asked for gets the light index first, built in a
    // minute from what YouTube serves without the video; the full build is for launch plans and the archive's top.
    if (picked.light) {
      const [lc, la] = turnCommand(process.platform, fs.existsSync(macrun) ? macrun : undefined, process.execPath, [
        "--import",
        "tsx",
        TOOL,
        "light",
        job.game,
        `--comments=${cfg.archiveComments ?? 300}`,
        ...(job.recentRelease ? ["--recent"] : []),
      ]);
      const lr = await (deps.run ?? runTool)(lc, la, { ...process.env, DATA_DIR: cfg.dataDir, YTDLP_PATH: cfg.ytdlpPath, MACRUN_WAIT_MIN: "20", YT_CLASS: "background", YT_PURPOSE: "library", YTDLP_COOKIES_FILE: cookies });
      const lightOut = lr.code === 75 ? "waiting" : turnOutcome(lr.stdout) || "waiting";
      await updateQueue(cfg.dataDir, (q) => afterTurn(q, job.game, lightOut, now()));
      log("info", "scene index: light turn finished", { game: job.game, outcome: lightOut });
      return lightOut;
    }
    const [cmd, args] = turnCommand(
      process.platform,
      fs.existsSync(macrun) ? macrun : undefined,
      process.execPath,
      [
        "--import",
        "tsx",
        TOOL,
        "build",
        job.game,
        `--steps=${cfg.sceneIndexTurnSteps}`,
        ...(job.recentRelease ? ["--recent"] : []),
        // A planned upload is built from its own source (SCENE_INDEX_PIN below): no refresh, no launch search.
        ...(!job.pin && job.state === "done" ? ["--refresh"] : []),
        ...(!job.pin && job.fetch ? ["--complete", ...(job.fetch.notBefore ? [`--released=${job.fetch.notBefore.slice(0, 10)}`] : [])] : []),
      ],
    );
    const env = {
      ...process.env,
      DATA_DIR: cfg.dataDir,
      YTDLP_PATH: cfg.ytdlpPath,
      WHISPER_PYTHON: cfg.whisperPython,
      SCENE_INDEX_PROXY_HEIGHT: String(cfg.sceneIndexProxyHeight),
      SCENE_INDEX_OCR_FPS: String(cfg.sceneIndexOcrFps),
      SCENE_INDEX_CHUNK_MINUTES: String(cfg.sceneIndexChunkMinutes),
      SCENE_INDEX_MAX_HOURS: String(cfg.sceneIndexMaxHours),
      MACRUN_WAIT_MIN: "20",
      // Library work: the YouTube guard gives it the background share and pauses it first (src/lib/ytguard.ts).
      YT_CLASS: "background",
      // The download account's cookies go to every build, inside the signed-in ration: a covered game's movie (a launch
      // plan or a planned upload) as "movie", the rest as "library" (src/lib/ytguard.ts, src/lib/ytsignin.ts).
      YTDLP_COOKIES_FILE: cookies,
      YT_PURPOSE: job.fetch || job.pin ? "movie" : "library",
      ...(job.pin ? { SCENE_INDEX_PIN: JSON.stringify(job.pin) } : {}),
      // ARCHIVE_PROXY=delete: the build removes the proxy once every stretch is indexed.
      ...(cfg.archiveProxy === "delete" ? { SCENE_INDEX_RELEASE_PROXY: "delete" } : {}),
    };
    const r = await (deps.run ?? runTool)(cmd, args, env);
    // Exit 75 is the turn-taker saying a render had the Mac the whole time: wait, it is not a failure.
    const outcome =
      r.code === 75 ? "waiting" : turnOutcome(r.stdout) || "waiting";
    const pinWaitCounts = r.code !== 75 && !has(job, "proxy.mp4");
    await updateQueue(cfg.dataDir, (q) => afterTurn(q, job.game, outcome, now(), pinWaitCounts));
    log("info", "scene index: turn finished", {
      game: job.game,
      outcome,
      code: r.code,
    });
    return outcome;
  } catch (err) {
    log("warn", "scene index: turn failed", { error: errorMessage(err) });
    return undefined;
  } finally {
    running = false;
  }
}

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
import { sceneSlug } from "./schema.ts";

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
    ),
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
    if (g.fetch?.notBefore && now.getTime() < Date.parse(g.fetch.notBefore)) return false;
    if (g.state === "done") return sourceRecheckDue(g, now);
    const since = g.lastTry ? now.getTime() - Date.parse(g.lastTry) : Infinity;
    if (g.state === "no-source")
      return g.fetch
        ? now.getTime() <= Date.parse(g.fetch.recheckUntil) && since >= g.fetch.searchEveryHours * HOUR
        : (g.tries ?? 0) < 28 && since >= 12 * HOUR;
    if (g.state === "waiting") return since >= HOUR / 2;
    return true;
  });
  return ready.sort((a, b) => (b.fetch?.priority ?? 0) - (a.fetch?.priority ?? 0))[0];
}

/** A finished index is checked for a better source once a week for this long after it was asked for. */
export const RECHECK_DAYS = 45;

/**
 * Whether a finished game is due a look for a better source (pure): weekly for its first weeks, when the clean
 * full movies of a new release are still appearing (an index made on launch day from a playthrough is rebuilt
 * from the movie that follows). After that the index is left alone.
 */
export function sourceRecheckDue(g: QueuedGame, now: Date): boolean {
  if (g.state !== "done" || !g.lastTry) return false;
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
    games: queue.games.map((g) =>
      sceneSlug(g.game) === slug
        ? {
            ...g,
            state,
            lastTry: now.toISOString(),
            tries: state === "no-source" ? (g.tries ?? 0) + 1 : g.tries,
          }
        : g,
    ),
  };
}

/** The last outcome word in a build's output ("stretch", "described", "done", "waiting", "no-source"); "" when none. */
export function turnOutcome(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/)[0] ?? "");
  return (
    lines
      .reverse()
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
>;

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

export async function writeQueue(dataDir: string, queue: SceneQueue): Promise<void> {
  const file = queueFile(dataDir);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(queue, null, 1));
  await fsp.rename(tmp, file);
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
    const queue = await readQueue(cfg.dataDir);
    const next = queueGame(queue, game, reason, now, recentRelease);
    if (next !== queue) {
      await writeQueue(cfg.dataDir, next);
      log("info", "scene index: game queued", { game, reason });
    }
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

let running = false;
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
    let queue = await readQueue(cfg.dataDir);
    const before = queue;
    for (const w of wanted)
      queue = queueGame(queue, w.game, w.reason, now(), true);
    if (queue !== before) await writeQueue(cfg.dataDir, queue);
    const job = nextJob(queue, now());
    if (!job) return undefined;
    // The proxy is the only big file: never start a turn with the disk near the Mac's floor.
    const free = await (
      deps.freeGb ??
      (async () => {
        const s = await fsp.statfs(cfg.dataDir);
        return (s.bavail * s.bsize) / 1e9;
      })
    )().catch(() => Infinity);
    if (free < cfg.macMinFreeGb + 6) {
      log("warn", "scene index: not enough free disk for a turn", {
        freeGb: Math.round(free),
      });
      return undefined;
    }
    const macrun = path.join(os.homedir(), "orch", "macrun.sh");
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
        ...(job.state === "done" ? ["--refresh"] : []),
        ...(job.fetch ? ["--complete", ...(job.fetch.notBefore ? [`--released=${job.fetch.notBefore.slice(0, 10)}`] : [])] : []),
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
    };
    const r = await (
      deps.run ??
      ((c: string, a: string[], e: NodeJS.ProcessEnv) =>
        new Promise<{ stdout: string; code: number }>((resolve) => {
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
        }))
    )(cmd, args, env);
    // Exit 75 is the turn-taker saying a render had the Mac the whole time: wait, it is not a failure.
    const outcome =
      r.code === 75 ? "waiting" : turnOutcome(r.stdout) || "waiting";
    await writeQueue(
      cfg.dataDir,
      afterTurn(await readQueue(cfg.dataDir), job.game, outcome, now()),
    );
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

// The settings of the living stream-asks list (STREAM_ASKS) and the VOD moment miner (VOD_MINER), read in one place
// (pure: the environment is passed in) so the rest of the config stays untouched. Both are off by default.

import os from "node:os";
import path from "node:path";

export type AskSourceName =
  | "seed"
  | "press"
  | "bluesky"
  | "youtube"
  | "viewers"
  | "reddit";
export const ASK_SOURCES: AskSourceName[] = [
  "seed",
  "press",
  "bluesky",
  "youtube",
  "viewers",
  "reddit",
];

export interface StreamAsksSettings {
  /** STREAM_ASKS: keep the list fresh, serve its page and send the daily top five. */
  enabled: boolean;
  /** STREAM_ASKS_GAMES: the games always listed, besides any the owner's recent streams name. */
  games: string[];
  /**
   * STREAM_ASKS_SOURCES: where asks come from. Reddit is left out unless listed: its robots.txt disallows automated
   * reading and the factory has kept away from it since Oct 2026 (src/discovery/chatter.ts).
   */
  sources: AskSourceName[];
  /** STREAM_ASKS_SEED_FILE: the hand-made list the living one starts from (the previews' claims). */
  seedFile: string;
  /** STREAM_ASKS_REFRESH_HOURS: hours between refreshes (four a day by default). */
  refreshHours: number;
  /** STREAM_ASKS_POST_AT: "HH:MM" in the owner's time zone, before he usually goes live. */
  postAt: string;
  /** STREAM_ASKS_TOP: asks in the daily message. */
  top: number;
  /** STREAM_ASKS_STALE_DAYS: an ask nobody has mentioned for this long leaves the list (seeds get three times as long). */
  staleDays: number;
  /** STREAM_ASKS_DRY_RUN: the daily message is written to a file instead of Discord. */
  dryRun: boolean;
  /** YOUTUBE_API_KEY: reads the public comments under the biggest videos about each game (a few quota units a refresh). */
  youtubeApiKey: string;

  /** VOD_MINER: index each new recording and search it for moments that answer the open asks. */
  vodMiner: boolean;
  /** VOD_MINER_DIR: where the nightly download puts the recordings. */
  vodDir: string;
  /** VOD_MINER_DAYS: recordings older than this are not indexed. */
  vodDays: number;
  /** VOD_MINER_OCR_FPS: frames a second whose writing is read (0.5: one every two seconds). */
  ocrFps: number;
  /** VOD_MINER_CHUNK_MINUTES: minutes of a recording indexed in one piece of work. */
  chunkMinutes: number;
  /** VOD_MINER_DESCRIBE_BATCH: shots the vision model looks at in one piece of work. */
  describeBatch: number;
  /** VOD_MINER_MIN_CUE: how well a moment's words, writing and pictures must fit an ask before the verdict is asked. */
  minCue: number;
  /** VOD_MINER_MIN_CONFIDENCE: the verdict's confidence needed to call an ask proved or disproved; below it: unclear. */
  minConfidence: number;
  /** VOD_MINER_TO_LANE: confident, spoiler-free moments go to the gameplay lane's inbox as candidate Shorts. */
  toLane: boolean;
}

const bool = (env: NodeJS.ProcessEnv, name: string, fallback: boolean) => {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
};
const num = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  lo: number,
  hi: number,
) => {
  const n = Number(env[name]);
  return env[name] === undefined || env[name] === "" || !Number.isFinite(n)
    ? fallback
    : Math.min(hi, Math.max(lo, n));
};
const list = (raw: string | undefined, fallback: string) =>
  (raw === undefined || raw === "" ? fallback : raw)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

export function streamAsksSettings(env: NodeJS.ProcessEnv): StreamAsksSettings {
  const sources = list(
    env.STREAM_ASKS_SOURCES,
    "seed,press,bluesky,youtube,viewers",
  )
    .map((s) => s.toLowerCase())
    .filter((s): s is AskSourceName => (ASK_SOURCES as string[]).includes(s));
  const postAt = /^\d\d:\d\d$/.test(env.STREAM_ASKS_POST_AT ?? "")
    ? env.STREAM_ASKS_POST_AT!
    : "10:00";
  return {
    enabled: bool(env, "STREAM_ASKS", false),
    games: list(env.STREAM_ASKS_GAMES, "Grand Theft Auto VI"),
    sources,
    seedFile:
      env.STREAM_ASKS_SEED_FILE ||
      path.resolve("docs", "streamasks-seed-gta6.md"),
    refreshHours: num(env, "STREAM_ASKS_REFRESH_HOURS", 6, 1, 48),
    postAt,
    top: Math.round(num(env, "STREAM_ASKS_TOP", 5, 1, 10)),
    staleDays: num(env, "STREAM_ASKS_STALE_DAYS", 10, 1, 90),
    dryRun: bool(env, "STREAM_ASKS_DRY_RUN", false),
    youtubeApiKey: env.YOUTUBE_API_KEY ?? "",
    vodMiner: bool(env, "VOD_MINER", false),
    vodDir:
      env.VOD_MINER_DIR || path.join(os.homedir(), "Videos", "TinoTV VODs"),
    vodDays: num(env, "VOD_MINER_DAYS", 7, 1, 60),
    ocrFps: num(env, "VOD_MINER_OCR_FPS", 0.5, 0, 4),
    chunkMinutes: num(env, "VOD_MINER_CHUNK_MINUTES", 20, 2, 120),
    describeBatch: Math.round(
      num(env, "VOD_MINER_DESCRIBE_BATCH", 300, 10, 5000),
    ),
    minCue: num(env, "VOD_MINER_MIN_CUE", 0.45, 0.1, 1),
    minConfidence: num(env, "VOD_MINER_MIN_CONFIDENCE", 0.75, 0.5, 0.99),
    toLane: bool(env, "VOD_MINER_TO_LANE", true),
  };
}

/** One line for the boot summary. */
export function streamAsksSummary(s: StreamAsksSettings): string {
  const asks = s.enabled
    ? `on (${s.games.join(", ")}; ${s.sources.join(",")}; every ${s.refreshHours} h; daily top ${s.top} at ${s.postAt}${s.dryRun ? ", dry run" : ""})`
    : "off";
  const miner = s.vodMiner
    ? `on (${s.vodDir}; confidence >= ${s.minConfidence}${s.toLane ? "; to the gameplay lane" : ""})`
    : "off";
  return `asks ${asks}; miner ${miner}`;
}

// The settings of the search-demand engine (SEARCH_SHORTS, 12 Nov 2026), read in one place (pure: the environment is
// passed in) so the rest of the config stays untouched. Off by default: with SEARCH_SHORTS unset nothing is harvested,
// nothing is made and no slot changes.

import path from "node:path";

export interface SearchGame {
  /** The game as the factory files it ("Grand Theft Auto VI"). */
  name: string;
  /** ISO instant it first unlocks anywhere; before it, nothing can be answered from play. Empty: already out. */
  release: string;
}

export interface SearchShortsSettings {
  /** SEARCH_SHORTS: harvest what people search, and make Shorts that answer one search each. */
  enabled: boolean;
  /** SEARCH_GAMES: "Name@release-ISO" entries, ";" between them; a game with no release is taken as already out. */
  games: SearchGame[];
  /** SEARCH_FACTS: "Name=file" entries, ";" between them: each game's confirmed-facts markdown (relative: beside package.json). */
  facts: Record<string, string>;
  /** SEARCH_HARVEST_HOURS: hours between harvests (every four hours by default). */
  harvestHours: number;
  /** SEARCH_RATE_MS: the pause between two requests to one site (a polite reader, one request at a time). */
  rateMs: number;
  /** SEARCH_MAX_REQUESTS: the most suggestion requests in one harvest, all games together. */
  maxRequests: number;
  /** SEARCH_PAA: also ask DuckDuckGo's public suggestions for question forms ("people also ask"-style). */
  paa: boolean;
  /** SEARCH_SLOTS: local "HH:MM" publish slots of the search Shorts, apart from the news and Why slots. */
  slots: string[];
  /** SEARCH_PER_DAY: search Shorts a day outside the launch week. */
  perDay: number;
  /** SEARCH_PER_DAY_LAUNCH: search Shorts a day during the launch week. */
  perDayLaunch: number;
  /** SEARCH_LAUNCH_FROM / SEARCH_LAUNCH_UNTIL: the launch week, local YYYY-MM-DD, both days included. */
  launchFrom: string;
  launchUntil: string;
  /** SEARCH_MIN_SCORE: a query under this score (0-100) is never made into a Short. */
  minScore: number;
  /** SEARCH_COVERED_DAYS: a Pulse video this recent that answers a query covers it. */
  coveredDays: number;
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
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_SEARCH_GAMES = "Grand Theft Auto VI@2026-11-18T11:00:00Z";
export const DEFAULT_SEARCH_FACTS = "Grand Theft Auto VI=guide_facts_gta6.md";

/** "Name@ISO;Name" as games (pure). A release that does not parse is dropped, leaving the game as already out. */
export function parseSearchGames(raw: string): SearchGame[] {
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const at = s.lastIndexOf("@");
      const name = (at > 0 ? s.slice(0, at) : s).trim();
      const rel = at > 0 ? s.slice(at + 1).trim() : "";
      return {
        name,
        release:
          rel && Number.isFinite(Date.parse(rel))
            ? new Date(rel).toISOString()
            : "",
      };
    })
    .filter((g) => g.name.length >= 2);
}

/** "Name=file;Name=file" as a map (pure); relative files resolve against `base`. */
export function parseSearchFacts(
  raw: string,
  base: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const file = part.slice(eq + 1).trim();
    if (name && file)
      out[name] = path.isAbsolute(file) ? file : path.resolve(base, file);
  }
  return out;
}

export function searchShortsSettings(
  env: NodeJS.ProcessEnv,
  base = process.cwd(),
): SearchShortsSettings {
  const slots = (env.SEARCH_SLOTS || "15:00,20:00")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d\d:\d\d$/.test(s));
  return {
    enabled: bool(env, "SEARCH_SHORTS", false),
    games: parseSearchGames(env.SEARCH_GAMES || DEFAULT_SEARCH_GAMES),
    facts: parseSearchFacts(env.SEARCH_FACTS || DEFAULT_SEARCH_FACTS, base),
    harvestHours: num(env, "SEARCH_HARVEST_HOURS", 4, 1, 48),
    rateMs: num(env, "SEARCH_RATE_MS", 1200, 300, 10_000),
    maxRequests: Math.round(num(env, "SEARCH_MAX_REQUESTS", 240, 10, 1000)),
    paa: bool(env, "SEARCH_PAA", true),
    slots: [...new Set(slots)].sort(),
    perDay: Math.round(num(env, "SEARCH_PER_DAY", 1, 0, 6)),
    perDayLaunch: Math.round(num(env, "SEARCH_PER_DAY_LAUNCH", 2, 0, 6)),
    launchFrom: DAY.test(env.SEARCH_LAUNCH_FROM ?? "")
      ? env.SEARCH_LAUNCH_FROM!
      : "2026-11-18",
    launchUntil: DAY.test(env.SEARCH_LAUNCH_UNTIL ?? "")
      ? env.SEARCH_LAUNCH_UNTIL!
      : "2026-11-25",
    minScore: num(env, "SEARCH_MIN_SCORE", 45, 0, 100),
    coveredDays: Math.round(num(env, "SEARCH_COVERED_DAYS", 120, 1, 730)),
  };
}

/** The day's allowance (pure): the launch week's number inside it, the usual one outside. */
export function searchCapFor(
  s: Pick<
    SearchShortsSettings,
    "perDay" | "perDayLaunch" | "launchFrom" | "launchUntil"
  >,
  day: string,
): number {
  return day >= s.launchFrom && day <= s.launchUntil
    ? s.perDayLaunch
    : s.perDay;
}

/** One line for the boot summary. */
export function searchShortsSummary(s: SearchShortsSettings): string {
  if (!s.enabled) return "off";
  return `on (${s.games.map((g) => g.name).join(", ")}; every ${s.harvestHours} h; slots ${s.slots.join(",")}; ${s.perDayLaunch}/day ${s.launchFrom} to ${s.launchUntil}, then ${s.perDay}/day; score >= ${s.minScore})`;
}

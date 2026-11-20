// The harvest pass (SEARCH_SHORTS): every SEARCH_HARVEST_HOURS the suggestions are read again, clustered and scored
// against the confirmed facts, the owner's play notes and what Pulse already covered, and the ranked list is written to
// data/search/. The search lane (src/searchq/step.ts) picks from that file; the owner reads queries.html beside it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "../db.ts";
import { log, errorMessage } from "../lib/util.ts";
import { gameAliases } from "../sceneindex/spoilers.ts";
import { sceneSlug } from "../sceneindex/schema.ts";
import {
  readFacts,
  factsFileFor,
  readPlayNotes,
  type Fact,
  type PlayNote,
} from "./facts.ts";
import { harvest, type HarvestFetch } from "./harvest.ts";
import { rankQueries, updateHistory, type History } from "./rank.ts";
import {
  readHistory,
  readState,
  searchDir,
  writeQueries,
  type QueryFile,
} from "./store.ts";
import type { SearchShortsSettings } from "./settings.ts";

/** Two names for one game ("GTA 6" and "Grand Theft Auto VI"). */
export function sameName(a: string, b: string): boolean {
  const as = new Set(gameAliases(a).map(sceneSlug));
  return gameAliases(b).some((x) => as.has(sceneSlug(x)));
}

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** The planned topics' questions and titles (the launch run and The GTA File): planned is as good as covered. */
export function plannedTexts(files: string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (!f) continue;
    try {
      const run = JSON.parse(
        fs.readFileSync(path.isAbsolute(f) ? f : path.join(ROOT, f), "utf8"),
      ) as Array<Record<string, unknown>>;
      for (const e of Array.isArray(run) ? run : [])
        for (const k of ["question", "title"])
          if (typeof e[k] === "string") out.push(e[k] as string);
    } catch {
      // no plan: nothing planned
    }
  }
  return out;
}

/** Headlines and titles of Pulse's own videos in the last `days` (failed and rejected ones did not cover anything). */
export async function coveredTexts(db: Db, days: number): Promise<string[]> {
  const rows = await db.query<{ h: string | null; t: string | null }>(
    `SELECT story_json->>'headline' AS h, script_json->'youtube'->>'title' AS t FROM episodes
      WHERE created_at > now() - ($1 || ' days')::interval AND status NOT IN ('failed','rejected')`,
    [String(days)],
  );
  return rows.flatMap((r) => [r.h, r.t]).filter((x): x is string => Boolean(x));
}

export interface PassInput {
  settings: SearchShortsSettings;
  dataDir: string;
  /** Where the list is written: the data folder's search/ unless another is given (the proof run). */
  outDir?: string;
  covered: string[];
  guideFile?: string;
  fetchFn?: HarvestFetch;
  now?: Date;
  /** For the proof run: the games to harvest instead of SEARCH_GAMES. */
  games?: SearchShortsSettings["games"];
}

/** One harvest: suggestions read, ranked and written. Returns the file written. */
export async function harvestPass(p: PassInput): Promise<QueryFile> {
  const now = p.now ?? new Date();
  const games = p.games ?? p.settings.games;
  const outDir = p.outDir ?? searchDir(p.dataDir);
  const facts: Record<string, Fact[]> = {};
  const notes: Record<string, PlayNote[]> = {};
  const releases: Record<string, string> = {};
  for (const g of games) {
    const file = factsFileFor(p.settings.facts, g.name, sameName);
    facts[g.name] = readFacts(file);
    if (file && !facts[g.name]!.length)
      log("warn", "search: facts file empty or unreadable", {
        game: g.name,
        file,
      });
    notes[g.name] = readPlayNotes(g.name, {
      guideFile: p.guideFile ?? path.join(ROOT, "guides.json"),
      dataDir: p.dataDir,
      same: sameName,
    });
    if (g.release) releases[g.name] = g.release;
  }
  const history: History | undefined = await readHistory(outDir);
  const got = await harvest(
    games.map((g) => g.name),
    {
      paa: p.settings.paa,
      rateMs: p.settings.rateMs,
      maxRequests: p.settings.maxRequests,
      fetchFn: p.fetchFn,
      now: () => now,
    },
  );
  const queries = rankQueries(got.observations, {
    now,
    facts,
    notes,
    releases,
    covered: p.covered,
    history,
  });
  const file: QueryFile = {
    harvestedAt: now.toISOString(),
    games: games.map((g) => g.name),
    requests: got.requests,
    failed: got.failed,
    refused: got.refused,
    observations: got.observations.length,
    queries,
  };
  await writeQueries(
    outDir,
    file,
    updateHistory(history, queries, file.games, now),
  );
  return file;
}

let harvesting = false;

/** The server's pass: a harvest when SEARCH_HARVEST_HOURS have gone by since the last. Never throws. */
export async function searchHarvestTick(
  cfg: {
    searchShorts: SearchShortsSettings;
    dataDir: string;
    shortRunFile: string;
    seriesGtaFileRunFile?: string;
  },
  deps: { db: Db; fetchFn?: HarvestFetch; now?: () => Date },
): Promise<QueryFile | undefined> {
  if (!cfg.searchShorts.enabled || harvesting) return undefined;
  harvesting = true;
  try {
    const now = deps.now?.() ?? new Date();
    const state = await readState(searchDir(cfg.dataDir));
    const age = state.harvestedAt
      ? now.getTime() - Date.parse(state.harvestedAt)
      : Infinity;
    if (age < cfg.searchShorts.harvestHours * 3_600_000) return undefined;
    const covered = [
      ...(await coveredTexts(deps.db, cfg.searchShorts.coveredDays)),
      ...plannedTexts([cfg.shortRunFile, cfg.seriesGtaFileRunFile ?? ""]),
    ];
    const file = await harvestPass({
      settings: cfg.searchShorts,
      dataDir: cfg.dataDir,
      covered,
      fetchFn: deps.fetchFn,
      now,
    });
    log("info", "search: queries ranked", {
      queries: file.queries.length,
      makeable: file.queries.filter((q) => !q.dropped).length,
    });
    return file;
  } catch (err) {
    log("warn", "search: harvest failed", { error: errorMessage(err) });
    return undefined;
  } finally {
    harvesting = false;
  }
}

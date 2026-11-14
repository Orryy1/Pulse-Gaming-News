// The stream-asks jobs the server runs (STREAM_ASKS, VOD_MINER; both off by default):
//   refresh  every STREAM_ASKS_REFRESH_HOURS: read the sources, fold what people ask into the list, score it, write
//            data/streamasks/asks.json, asks.md and the page's HTML;
//   daily    once a day at STREAM_ASKS_POST_AT (owner's time zone): the top asks to Discord (or to a file on a dry run);
//   miner    every pass: one bounded turn of indexing on the newest recording not yet indexed (behind the Mac's
//            turn-taker; on the PC behind the orchestrator), then every fully indexed recording not yet searched is
//            searched for the open asks, and the verdicts move asks off the list.
// The page is served by the server at /asks/<key> (src/streamasks/page.ts asksKey), private and unlinked.

import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import type { Llm } from "../editorial/llm.ts";
import { postDiscord } from "../approval/discord.ts";
import { errorMessage, log } from "../lib/util.ts";
import { spoilerWindows, windowFor } from "../sceneindex/spoilers.ts";
import { listVodIndexes, loadVodIndex } from "../vodindex/schema.ts";
import { vodIndexReady } from "../vodindex/build.ts";
import { gamesStreamed, listRecordings } from "../vodindex/vods.ts";
import {
  foldSightings,
  markCovered,
  refreshList,
  type StreamAsk,
} from "./asks.ts";
import { refineAsks, sightingsOf } from "./extract.ts";
import { mineVod } from "./miner.ts";
import { asksHtml, asksKey, asksMarkdown, dailyMessage } from "./page.ts";
import { mergeSeeds, parseSeed } from "./seed.ts";
import { gameNamed, gatherPosts, type GatherDeps } from "./sources.ts";

const TOOL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "tools",
  "vodindex.ts",
);

export interface AsksStore {
  updatedAt: string;
  asks: StreamAsk[];
  notes: string[];
}

interface JobState {
  refreshedAt?: string;
  postedDay?: string;
  /** VOD id -> the index's builtAt it was last searched at. */
  mined?: Record<string, string>;
}

export const asksDir = (dataDir: string) => path.join(dataDir, "streamasks");

export async function readAsks(dataDir: string): Promise<AsksStore> {
  try {
    const o = JSON.parse(
      await fsp.readFile(path.join(asksDir(dataDir), "asks.json"), "utf8"),
    ) as AsksStore;
    return {
      updatedAt: o.updatedAt ?? "",
      asks: Array.isArray(o.asks) ? o.asks : [],
      notes: o.notes ?? [],
    };
  } catch {
    return { updatedAt: "", asks: [], notes: [] };
  }
}

async function writeWhole(file: string, text: string) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, text);
  await fsp.rename(tmp, file);
}

/** The list, its markdown and its page, written together. */
export async function writeAsks(
  dataDir: string,
  store: AsksStore,
  now: Date,
): Promise<void> {
  const dir = asksDir(dataDir);
  await writeWhole(path.join(dir, "asks.json"), JSON.stringify(store, null, 1));
  await writeWhole(
    path.join(dir, "asks.md"),
    asksMarkdown(store.asks, now, store.notes),
  );
  await writeWhole(path.join(dir, "asks.html"), asksHtml(store.asks, now));
}

async function readState(dataDir: string): Promise<JobState> {
  try {
    return JSON.parse(
      await fsp.readFile(path.join(asksDir(dataDir), "state.json"), "utf8"),
    ) as JobState;
  } catch {
    return {};
  }
}

async function writeState(
  dataDir: string,
  patch: Partial<JobState>,
): Promise<void> {
  const next = { ...(await readState(dataDir)), ...patch };
  await writeWhole(
    path.join(asksDir(dataDir), "state.json"),
    JSON.stringify(next, null, 1),
  );
}

/** The games the list is kept for: the configured ones, then the ones the owner streamed in the last three days. */
export async function askGames(
  cfg: Pick<Config, "streamAsks" | "ownerGames">,
  now: Date,
): Promise<string[]> {
  const known = [...new Set([...cfg.streamAsks.games, ...cfg.ownerGames])];
  const recent = gamesStreamed(
    await listRecordings(cfg.streamAsks.vodDir, known),
    now.toISOString().slice(0, 10),
    3,
  );
  return [...new Set([...cfg.streamAsks.games, ...recent])];
}

export interface RefreshDeps extends GatherDeps {
  llm?: Llm;
}

/** One refresh of the list. Returns the stored list. */
export async function refreshAsks(
  cfg: Pick<Config, "dataDir" | "streamAsks" | "ownerGames">,
  deps: RefreshDeps = {},
): Promise<AsksStore> {
  const now = deps.now ?? new Date();
  const s = cfg.streamAsks;
  const games = await askGames(cfg, now);
  const store = await readAsks(cfg.dataDir);
  let asks = store.asks;
  if (s.sources.includes("seed")) {
    const md = await fsp.readFile(s.seedFile, "utf8").catch(() => "");
    if (md) {
      const heading = md.split(/\r?\n/).find((l) => l.startsWith("# ")) ?? "";
      const game = gameNamed(heading, games) ?? games[0]!;
      // The list's own date ("(12 Nov 2026)" in its heading), so a redeploy never makes old seeds look new.
      const dated = Date.parse(
        heading.match(/\((\d{1,2} \w+ \d{4})\)/)?.[1] ?? "",
      );
      asks = mergeSeeds(
        asks,
        parseSeed(
          md,
          game,
          new Date(
            Number.isFinite(dated) ? dated : now.getTime(),
          ).toISOString(),
        ),
      );
    }
  }
  const { posts, notes } = await gatherPosts(
    games,
    s.sources,
    { youtubeApiKey: s.youtubeApiKey },
    {
      ...deps,
      now,
      cacheDir: asksDir(cfg.dataDir),
    },
  );
  const before = new Set(asks.map((a) => a.id));
  const lateTerms = Object.fromEntries(
    games.map((g) => [g, windowFor(spoilerWindows(), g, now)?.lateTerms ?? []]),
  );
  asks = foldSightings(asks, sightingsOf(posts), now, { lateTerms });
  const added = new Set(asks.filter((a) => !before.has(a.id)).map((a) => a.id));
  asks = await refineAsks(deps.llm, asks, added);
  if (deps.db) {
    const rows = await deps.db
      .query<{ title: string | null; game: string | null }>(
        `SELECT script_json->>'title' AS title, COALESCE(NULLIF(script_json->>'game_title', ''), story_json->>'gameHint') AS game
           FROM episodes WHERE lane = 'gameplay' AND status = 'published' AND updated_at > now() - interval '60 days'`,
      )
      .catch(() => []);
    asks = markCovered(
      asks,
      rows.flatMap((r) =>
        r.title
          ? [{ title: r.title, ...(r.game ? { game: r.game } : {}) }]
          : [],
      ),
    );
  }
  asks = refreshList(asks, now, { staleDays: s.staleDays });
  const next: AsksStore = { updatedAt: now.toISOString(), asks, notes };
  await writeAsks(cfg.dataDir, next, now);
  log("info", "stream asks: list refreshed", {
    games,
    open: asks.filter((a) => a.status === "open").length,
    added: added.size,
    notes,
  });
  return next;
}

/** The page's address (the site's own domain when it has one). */
export function asksLink(
  cfg: Pick<Config, "siteUrl" | "publicUrl" | "appSecret">,
): string {
  return `${cfg.siteUrl || cfg.publicUrl}/asks/${asksKey(cfg.appSecret)}`;
}

/** The owner's local day and minutes past midnight (pure apart from the clock). */
export function localClock(
  now: Date,
  timezone: string,
): { day: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
}

/** True once a day from postAt (pure). */
export function dailyDue(
  state: { postedDay?: string },
  clock: { day: string; minutes: number },
  postAt: string,
): boolean {
  const [h, m] = postAt.split(":").map(Number);
  return (
    state.postedDay !== clock.day && clock.minutes >= (h ?? 10) * 60 + (m ?? 0)
  );
}

/** The daily message, to Discord or (dry run) to data/streamasks/discord-<day>.txt. Returns what was sent. */
export async function sendDaily(
  cfg: Pick<
    Config,
    | "dataDir"
    | "streamAsks"
    | "discordWebhookUrl"
    | "siteUrl"
    | "publicUrl"
    | "appSecret"
    | "dryRun"
  >,
  day: string,
  post: typeof postDiscord = postDiscord,
): Promise<{ text: string; to: string }> {
  const store = await readAsks(cfg.dataDir);
  const text = dailyMessage(store.asks, cfg.streamAsks.top, asksLink(cfg));
  if (!text) return { text: "", to: "nothing to send" };
  if (cfg.streamAsks.dryRun || cfg.dryRun || !cfg.discordWebhookUrl) {
    const file = path.join(asksDir(cfg.dataDir), `discord-${day}.txt`);
    await writeWhole(file, text);
    return { text, to: file };
  }
  await post(cfg.discordWebhookUrl, { content: text });
  return { text, to: "discord" };
}

let refreshing = false;

/** The server's stream-asks pass: refresh when due, the daily message when due. Never throws. */
export async function streamAsksTick(
  cfg: Config,
  deps: Omit<RefreshDeps, "now"> & { now?: () => Date } = {},
): Promise<void> {
  if (!cfg.streamAsks.enabled || refreshing) return;
  refreshing = true;
  try {
    const now = deps.now?.() ?? new Date();
    const state = await readState(cfg.dataDir);
    const age = state.refreshedAt
      ? now.getTime() - Date.parse(state.refreshedAt)
      : Infinity;
    if (age >= cfg.streamAsks.refreshHours * 3_600_000) {
      const { now: _clock, ...rest } = deps;
      await refreshAsks(cfg, { ...rest, now });
      await writeState(cfg.dataDir, { refreshedAt: now.toISOString() });
    }
    const clock = localClock(now, cfg.timezone);
    if (dailyDue(state, clock, cfg.streamAsks.postAt)) {
      const sent = await sendDaily(cfg, clock.day);
      await writeState(cfg.dataDir, { postedDay: clock.day });
      log("info", "stream asks: daily message", { to: sent.to });
    }
  } catch (err) {
    log("warn", "stream asks: pass failed", { error: errorMessage(err) });
  } finally {
    refreshing = false;
  }
}

let mining = false;

/** One turn of indexing behind the turn-taker (pure command). */
export function vodTurnCommand(
  platform: string,
  o: { macrun?: string; orch?: string },
  node: string,
  args: string[],
  estMinutes: number,
): [string, string[]] {
  if (platform === "darwin")
    return o.macrun
      ? ["/bin/bash", [o.macrun, "pulse-vodindex", node, ...args]]
      : ["taskpolicy", ["-b", node, ...args]];
  if (o.orch)
    return [
      "cmd.exe",
      [
        "/c",
        o.orch,
        "run",
        "--class",
        "gpu",
        "--project",
        "pulse",
        "--job",
        "stream index turn",
        "--priority",
        "20",
        "--est",
        String(estMinutes),
        "--",
        node,
        ...args,
      ],
    ];
  return [node, args];
}

/** The server's miner pass (VOD_MINER): index a little of the newest recording, then search what is fully indexed. */
export async function vodMinerTick(
  cfg: Config,
  deps: { now?: () => Date } = {},
): Promise<void> {
  const s = cfg.streamAsks;
  if (!s.vodMiner || mining) return;
  mining = true;
  try {
    const now = deps.now?.() ?? new Date();
    const known = [...new Set([...s.games, ...cfg.ownerGames])];
    const since = new Date(now.getTime() - s.vodDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const recordings = (await listRecordings(s.vodDir, known)).filter(
      (r) => !r.recordedOn || r.recordedOn >= since,
    );
    for (const r of recordings) {
      const have = await loadVodIndex(cfg.dataDir, r.vodId);
      if (have && vodIndexReady(have)) continue;
      const macrun = path.join(os.homedir(), "orch", "macrun.sh");
      const orch = "C:\\Claude\\orchestrator\\orch.cmd";
      const [cmd, args] = vodTurnCommand(
        process.platform,
        {
          macrun: fs.existsSync(macrun) ? macrun : undefined,
          orch: fs.existsSync(orch) ? orch : undefined,
        },
        process.execPath,
        [
          "--import",
          "tsx",
          TOOL,
          r.file,
          ...(r.game ? ["--game", r.game] : []),
          "--steps",
          "3",
        ],
        s.chunkMinutes,
      );
      await new Promise<void>((resolve) =>
        execFile(
          cmd,
          args,
          {
            env: {
              ...process.env,
              DATA_DIR: cfg.dataDir,
              MACRUN_WAIT_MIN: "20",
            },
            cwd: path.join(path.dirname(TOOL), "..", ".."),
            timeout: 4 * 3_600_000,
            maxBuffer: 16 * 1024 * 1024,
            windowsHide: true,
          },
          (err) => {
            if (err)
              log("warn", "stream index: turn did not finish", {
                vod: r.vodId,
                error: errorMessage(err),
              });
            resolve();
          },
        ),
      );
      break; // one recording a pass
    }
    await mineReady(cfg, now);
  } catch (err) {
    log("warn", "stream asks: miner pass failed", { error: errorMessage(err) });
  } finally {
    mining = false;
  }
}

/** Searches every fully indexed recording not yet searched (or re-indexed since) for the open asks. */
export async function mineReady(cfg: Config, now: Date): Promise<number> {
  const state = await readState(cfg.dataDir);
  const mined = { ...(state.mined ?? {}) };
  let store = await readAsks(cfg.dataDir);
  let found = 0;
  for (const vod of await listVodIndexes(cfg.dataDir)) {
    if (
      !vodIndexReady(vod) ||
      mined[vod.vodId] === `${vod.builtAt}|${store.updatedAt}`
    )
      continue;
    const r = await mineVod(vod, store.asks, {
      dataDir: cfg.dataDir,
      minCue: cfg.streamAsks.minCue,
      minConfidence: cfg.streamAsks.minConfidence,
      toLane: cfg.streamAsks.toLane,
      gameplayRoot: cfg.gameplayRoot,
      spoilerGuard: cfg.spoilerGuard,
    });
    store = {
      ...store,
      asks: refreshList(r.asks, now, { staleDays: cfg.streamAsks.staleDays }),
    };
    await writeAsks(cfg.dataDir, store, now);
    mined[vod.vodId] = `${vod.builtAt}|${store.updatedAt}`;
    found += r.moments.filter((m) => m.decision.result !== "unclear").length;
  }
  await writeState(cfg.dataDir, { mined });
  return found;
}

/** The open asks as numbered tests the gameplay lane's reviewer can match a clip to (after its own list). */
export async function askExperiments(
  dataDir: string,
  from: number,
): Promise<Array<{ number: number; question: string; slug: null }>> {
  const store = await readAsks(dataDir);
  return store.asks
    .filter((a) => a.status === "open")
    .slice(0, 25)
    .map((a, i) => ({
      number: from + i,
      question: `${a.rumour ? "(rumour) " : ""}${a.question}`,
      slug: null,
    }));
}

// Where the game library lives (15 Nov 2026, storage design): the master copy on the PC (D:\pulse-data\library,
// GAME_LIBRARY_DIR there), where the 4090 tags and describes it; a capped working cache on the Mac mini.
//   - The Mac keeps every game's library.json (small, never evicted) and the media of its active games: GTA VI, GTA V
//     (GAMELIB_ACTIVE_GAMES) and whatever a Short used in the last GAMELIB_RECENT_DAYS days, under GAMELIB_MAC_CACHE_GB
//     (default 40 GB), least recently used first out, and never below the Mac's free-disk floor.
//   - A Short that needs media the Mac does not hold reads only that segment from the PC over the LAN
//     (GAMELIB_REMOTE: the PC's read-only range server, src/tools/gamelib-serve.ts), with ffmpeg seeking by byte range.
//   - The PC off or busy: the Mac picks from what it holds and never waits (a reachability check of a few seconds,
//     remembered for a minute).
// The 1 TB SanDisk holds stream recordings and playthrough originals only, never the working library.
import fs from "node:fs/promises";
import path from "node:path";
import { fetchWithTimeout } from "../lib/util.ts";
import {
  canonicalGame,
  libraryDir,
  type GameLibrary,
  type LibItem,
  type UsageEntry,
} from "./gamelib.ts";

export interface StoreSettings {
  /** The PC's range server through the orchestrator's relay, http://192.168.0.93:8793 on the Mac; empty: local files only. */
  remote: string;
  capBytes: number;
  activeGames: string[];
  recentDays: number;
}

export function storeSettings(
  env: Record<string, string | undefined> = process.env,
): StoreSettings {
  return {
    remote: (env.GAMELIB_REMOTE ?? "").replace(/\/$/, ""),
    capBytes: Math.max(0, Number(env.GAMELIB_MAC_CACHE_GB ?? 40)) * 1e9,
    activeGames: (
      env.GAMELIB_ACTIVE_GAMES ?? "Grand Theft Auto VI,Grand Theft Auto V"
    )
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean),
    recentDays: Number(env.GAMELIB_RECENT_DAYS ?? 14),
  };
}

/** The URL of a library file on the PC's range server (pure): /<game slug>/<file>, each part encoded. */
export function remoteUrl(
  remote: string,
  gameDir: string,
  file: string,
): string {
  return `${remote}/${[path.basename(gameDir), ...file.split(/[\\/]/)].map(encodeURIComponent).join("/")}`;
}

let reach: { at: number; ok: boolean; remote: string } | undefined;

/** Whether the PC's server answers now (a few seconds at most; the answer is kept for a minute). */
export async function remoteUp(
  remote: string,
  now = Date.now(),
): Promise<boolean> {
  if (!remote) return false;
  if (reach && reach.remote === remote && now - reach.at < 60_000)
    return reach.ok;
  const ok = await fetchWithTimeout(`${remote}/health`, {}, 3_000)
    .then((r) => r.ok)
    .catch(() => false);
  reach = { at: now, ok, remote };
  return ok;
}

/** Forget the remembered answer (tests, or after the PC came back). */
export function resetRemoteCheck(): void {
  reach = undefined;
}

/**
 * Where to read a library file from: the local copy, else the PC's server when it answers, else nowhere (the item is
 * skipped and the Short goes on with what the Mac holds). Absolute paths (scene-index proxies) are local only.
 */
export async function sourceOf(
  root: string,
  game: string,
  file: string,
  s: StoreSettings,
): Promise<{ local?: string; url?: string } | undefined> {
  const local = path.isAbsolute(file)
    ? file
    : path.join(libraryDir(root, game), file);
  if (
    await fs
      .stat(local)
      .then((st) => st.isFile())
      .catch(() => false)
  )
    return { local };
  if (path.isAbsolute(file)) return undefined;
  if (await remoteUp(s.remote))
    return { url: remoteUrl(s.remote, libraryDir(root, game), file) };
  return undefined;
}

/** A game's library cut down to the items whose media can be read now (locally, or from the PC when it answers). */
export async function readableLibrary(
  root: string,
  lib: GameLibrary,
  s: StoreSettings,
): Promise<GameLibrary> {
  const up = await remoteUp(s.remote);
  const dir = libraryDir(root, lib.game);
  const items: LibItem[] = [];
  for (const i of lib.items) {
    const local = path.isAbsolute(i.file) ? i.file : path.join(dir, i.file);
    if (
      await fs
        .stat(local)
        .then((st) => st.isFile())
        .catch(() => false)
    )
      items.push(i);
    else if (up && !path.isAbsolute(i.file)) items.push(i);
  }
  return { ...lib, items };
}

// ---------------------------------------------------------------- the Mac's cache

export interface CacheEntry {
  game: string;
  file: string; // relative to the game's folder
  bytes: number;
  /** ISO time of the last Short that showed it, else when it joined the library. */
  lastUsed: string;
}

/**
 * Which media files leave the Mac's cache (pure): active games and anything used in the last `recentDays` stay unless
 * the cap still cannot be met without them; otherwise the least recently used go first until the cache is under the
 * cap and the disk keeps its floor. Indexes are not entries here: they are never evicted.
 */
export function planEviction(
  entries: CacheEntry[],
  o: {
    capBytes: number;
    activeGames: string[];
    recentDays: number;
    now: Date;
    freeBytes?: number;
    floorBytes?: number;
  },
): CacheEntry[] {
  const total = entries.reduce((n, e) => n + e.bytes, 0);
  const needForFloor =
    o.freeBytes !== undefined && o.floorBytes !== undefined
      ? Math.max(0, o.floorBytes - o.freeBytes)
      : 0;
  let excess = Math.max(total - o.capBytes, needForFloor);
  if (excess <= 0) return [];
  const active = new Set(o.activeGames.map(canonicalGame));
  const recentFrom = o.now.getTime() - o.recentDays * 86_400_000;
  const protectedOf = (e: CacheEntry) =>
    active.has(canonicalGame(e.game)) || Date.parse(e.lastUsed) >= recentFrom;
  const order = [...entries].sort(
    (a, b) =>
      Number(protectedOf(a)) - Number(protectedOf(b)) ||
      a.lastUsed.localeCompare(b.lastUsed) ||
      b.bytes - a.bytes,
  );
  const out: CacheEntry[] = [];
  for (const e of order) {
    if (excess <= 0) break;
    out.push(e);
    excess -= e.bytes;
  }
  return out;
}

/** The cache's media entries with their last use, from the libraries and the usage ledger. */
export async function cacheEntries(
  root: string,
  libs: GameLibrary[],
  usage: UsageEntry[],
): Promise<CacheEntry[]> {
  const last = new Map<string, string>();
  for (const u of usage)
    for (const k of u.keys) {
      const id = k.split("@")[0]!;
      if ((last.get(id) ?? "") < u.at) last.set(id, u.at);
    }
  const out: CacheEntry[] = [];
  for (const lib of libs) {
    const dir = libraryDir(root, lib.game);
    for (const i of lib.items) {
      if (path.isAbsolute(i.file)) continue;
      const st = await fs.stat(path.join(dir, i.file)).catch(() => undefined);
      if (!st?.isFile()) continue;
      out.push({
        game: lib.game,
        file: i.file,
        bytes: st.size,
        lastUsed: last.get(i.id) ?? i.addedAt ?? "",
      });
    }
  }
  return out;
}

/** Removes the planned files (media only; library.json stays) and returns the bytes freed. */
export async function evict(root: string, plan: CacheEntry[]): Promise<number> {
  let freed = 0;
  for (const e of plan) {
    const file = path.join(libraryDir(root, e.game), e.file);
    if (!file.startsWith(libraryDir(root, e.game))) continue;
    await fs.rm(file, { force: true });
    freed += e.bytes;
  }
  return freed;
}

/** The media a game's Mac cache should hold (pure): an active game's every file, another game's recently used ones. */
export function wantedOnMac(
  lib: GameLibrary,
  s: Pick<StoreSettings, "activeGames" | "recentDays">,
  usage: UsageEntry[],
  now: Date,
): LibItem[] {
  const active = s.activeGames
    .map(canonicalGame)
    .includes(canonicalGame(lib.game));
  if (active)
    return lib.items.filter((i) => !path.isAbsolute(i.file) && !i.unusable);
  const from = now.getTime() - s.recentDays * 86_400_000;
  const recent = new Set(
    usage
      .filter((u) => Date.parse(u.at) >= from)
      .flatMap((u) => u.keys.map((k) => k.split("@")[0]!)),
  );
  return lib.items.filter((i) => recent.has(i.id) && !path.isAbsolute(i.file));
}

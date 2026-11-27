// Keeping the press kit index and the wiki leads fresh without slowing a video down (20 Nov 2026). When a Short asks
// for a game's press pictures or leads and the stored file is missing or older than a week, a harvest starts in the
// background and the Short goes on with what is stored; the next one about the game gets the new file. One try per
// game every six hours, so a site that is down is not asked again and again.

import { errorMessage, log } from "../lib/util.ts";
import { canonicalGame } from "../assets/gamelib.ts";
import {
  harvestPressKits,
  readPressIndex,
  writePressIndex,
} from "./presskits.ts";
import { findWikiLeads, readWikiLeads, writeWikiLeads } from "./wikileads.ts";

export const REFRESH_DAYS = 7;
export const RETRY_HOURS = 6;

const tried = new Map<string, number>();
const running = new Set<string>();

/** Whether a stored file is due a refresh (pure): missing, unreadable or older than `days`. */
export function due(
  updatedAt: string | undefined,
  now: number,
  days = REFRESH_DAYS,
): boolean {
  const t = updatedAt ? Date.parse(updatedAt) : NaN;
  return !Number.isFinite(t) || now - t > days * 86_400_000;
}

/** Starts `work` for `key` unless it ran in the last RETRY_HOURS or is running; never throws, never waits. */
export function inBackground(
  key: string,
  work: () => Promise<unknown>,
  now = Date.now(),
): boolean {
  if (running.has(key) || now - (tried.get(key) ?? 0) < RETRY_HOURS * 3_600_000)
    return false;
  tried.set(key, now);
  running.add(key);
  void work()
    .catch((err) =>
      log("info", "background source refresh failed", {
        key,
        error: errorMessage(err),
      }),
    )
    .finally(() => running.delete(key));
  return true;
}

/** PRESS_KITS: harvests a game's press kits in the background when its index is missing or stale. */
export async function ensurePressIndex(
  root: string,
  game: string,
  now = Date.now(),
): Promise<boolean> {
  if (!game.trim()) return false;
  const idx = await readPressIndex(root, game).catch(() => undefined);
  if (!due(idx?.updatedAt, now)) return false;
  return inBackground(
    `presskit:${canonicalGame(game)}`,
    async () => {
      const idx = await harvestPressKits(game);
      // Nothing found (a site down, or no kit yet): nothing written, so the next try is in hours, not a week.
      if (idx.assets.length) await writePressIndex(root, idx);
    },
    now,
  );
}

/** WIKI_LEADS: finds and checks a game's wiki leads in the background when its file is missing or stale. */
export async function ensureWikiLeads(
  root: string,
  game: string,
  now = Date.now(),
): Promise<boolean> {
  if (!game.trim()) return false;
  const f = await readWikiLeads(root, game).catch(() => undefined);
  if (!due(f?.updatedAt, now)) return false;
  return inBackground(
    `wikileads:${canonicalGame(game)}`,
    async () => {
      const f = await findWikiLeads(game);
      if (f.leads.length) await writeWikiLeads(root, f);
    },
    now,
  );
}

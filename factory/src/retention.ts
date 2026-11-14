// How long an episode's media folder (voice, footage, renders: 0.1-2.7 GB each) is kept once the episode is
// finished. The rule since October: finished episodes' media goes after MEDIA_KEEP_DAYS (14). That was
// enough on the PC's big drives, but the Mac mini has a 256 GB SSD shared with macOS, the code, the speech
// model and Remotion's working files, and one week of long videos can be 20 GB. So a second rule (1 Nov
// 2026, before the move): when free space on the data disk falls below MEDIA_MIN_FREE_GB (40), finished
// episodes' media is deleted sooner, oldest first, until there is that much free again, but never media
// younger than MEDIA_FLOOR_DAYS (2), so a video just published keeps its files for its checks and A/B
// thumbnails. Only finished episodes (published, rejected, failed) are ever touched, and the database row,
// with its scripts, titles and metrics, always stays; the media can be made again from it.
import fs from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { logEvent } from "./episodes.ts";
import { errorMessage, log } from "./lib/util.ts";

const GB = 1e9;
const DAY = 86_400_000;

export interface PruneCandidate {
  id: string;
  /** When the episode last changed (ms): its finish, near enough. */
  finishedAt: number;
  /** Bytes its media folder holds. */
  bytes: number;
}

/**
 * The episodes whose media goes to bring free space back to `minFreeGb` (pure): oldest first, none younger
 * than `floorDays`, and none at all while there is already enough free.
 */
export function planSpacePrune(
  cands: PruneCandidate[],
  freeBytes: number,
  o: { minFreeGb: number; floorDays: number; now: number },
): PruneCandidate[] {
  const want = o.minFreeGb * GB;
  if (!want || freeBytes >= want) return [];
  const out: PruneCandidate[] = [];
  let free = freeBytes;
  for (const c of [...cands].sort((a, b) => a.finishedAt - b.finishedAt)) {
    if (free >= want) break;
    if (o.now - c.finishedAt < o.floorDays * DAY) continue;
    out.push(c);
    free += c.bytes;
  }
  return out;
}

/** Bytes under a folder (0 when it is gone). */
export async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs
    .readdir(dir, { withFileTypes: true, recursive: true })
    .catch(() => []);
  for (const e of entries) {
    if (!e.isFile()) continue;
    const st = await fs
      .stat(path.join(e.parentPath, e.name))
      .catch(() => undefined);
    total += st?.size ?? 0;
  }
  return total;
}

/** Free bytes on the disk that holds `dir`, or undefined when it cannot be read. */
export async function freeBytes(dir: string): Promise<number | undefined> {
  try {
    const st = await fs.statfs(dir);
    return st.bavail * st.bsize;
  } catch {
    return undefined;
  }
}

let lastLowWarning = 0;

/**
 * The free-space rule: deletes finished episodes' media, oldest first, while the data disk has less than
 * MEDIA_MIN_FREE_GB free. Returns the ids pruned; logs an event and tells Discord when it prunes anything.
 */
export async function pruneForSpace(
  s: {
    db: Db;
    cfg: Pick<Config, "dataDir" | "mediaMinFreeGb" | "mediaFloorDays">;
    now: () => Date;
    notify: (m: { level?: "info"; content: string }) => Promise<unknown>;
  },
  dirOf: (id: string) => string,
  free: (dir: string) => Promise<number | undefined> = freeBytes,
): Promise<string[]> {
  const minFreeGb = s.cfg.mediaMinFreeGb;
  if (!minFreeGb) return [];
  const before = await free(s.cfg.dataDir);
  if (before === undefined || before >= minFreeGb * GB) return [];
  const rows = await s.db.query<{ id: string; updated_at: string | Date }>(
    `SELECT id, updated_at FROM episodes WHERE status IN ('published','rejected','failed') ORDER BY updated_at`,
  );
  const cands: PruneCandidate[] = [];
  for (const r of rows) {
    const bytes = await folderBytes(dirOf(r.id));
    if (bytes > 0)
      cands.push({
        id: r.id,
        finishedAt: new Date(r.updated_at).getTime(),
        bytes,
      });
  }
  const plan = planSpacePrune(cands, before, {
    minFreeGb,
    floorDays: s.cfg.mediaFloorDays,
    now: s.now().getTime(),
  });
  const now = Date.now();
  if (!plan.length) {
    if (now - lastLowWarning > 3_600_000) {
      lastLowWarning = now;
      log("warn", "disk low and no finished media old enough to delete", {
        freeGb: +(before / GB).toFixed(1),
        minFreeGb,
      });
    }
    return [];
  }
  const done: string[] = [];
  for (const c of plan) {
    try {
      await fs.rm(dirOf(c.id), { recursive: true, force: true });
      done.push(c.id);
    } catch (err) {
      log("warn", "media not deleted", { id: c.id, error: errorMessage(err) });
    }
  }
  const freedGb = plan
    .filter((c) => done.includes(c.id))
    .reduce((n, c) => n + c.bytes / GB, 0);
  await logEvent(s.db, null, "media_pruned_for_space", {
    episodes: done,
    freedGb: +freedGb.toFixed(1),
    freeGbBefore: +(before / GB).toFixed(1),
    minFreeGb,
  });
  await s.notify({
    level: "info",
    content: `Disk space: only ${(before / GB).toFixed(0)} GB was free, so I deleted the media files of ${done.length} finished episode${done.length === 1 ? "" : "s"} early (${freedGb.toFixed(1)} GB, oldest first). The videos, their database records and their stats are untouched. Settings: MEDIA_MIN_FREE_GB, MEDIA_FLOOR_DAYS.`,
  });
  return done;
}

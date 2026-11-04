// Series playlists (owner's plan, 4 Nov 2026, item 8): "The Why", "Ranked" and "Documentaries", every video filed
// automatically. The channel already had these shelves under fuller, searchable names (SERIES in src/pipeline.ts:
// "The Why: Gaming's Biggest Questions", "Every Game Ranked: Worst to Best", "Gaming Documentaries"), so nothing new
// is made and no second copy of a shelf appears. What SERIES_PLAYLISTS adds is the owner's rule: only a public video
// joins. This file is the one-off catch-up for the back catalogue, run by src/tools/series-playlists.ts through the
// running factory (only it may open the database). It can be run any number of times: what a playlist already holds
// is read from YouTube first. It never adds a video YouTube does not report as public, it never changes a video and
// it stops short of the day's quota, leaving the uploads their share. What is left waits for the next run.
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { logEvent } from "./episodes.ts";
import {
  QUOTA,
  QUOTA_RESERVE_FOR_UPLOAD,
  publishHeld,
  quotaAdd,
  quotaUsed,
} from "./lanes.ts";
import { seriesFor, uploadsLeftToday } from "./pipeline.ts";
import type { Episode } from "./episodes.ts";
import { errorMessage } from "./lib/util.ts";

/**
 * The shelves the catch-up fills. The news shelf is left out on purpose: news Shorts are the format the growth plan
 * cuts back, and 50 units each are better spent on the series. Focus playlists come and go with their focus.
 */
export const BACKFILL_SHELVES = [
  "The Why: Gaming's Biggest Questions",
  "Every Game Ranked: Worst to Best",
  "Gaming Documentaries",
  "The Pulse Weekly: This Week in Gaming",
  "Ranked in 60 Seconds",
] as const;

export interface WantedAdd {
  episode: string;
  videoId: string;
  shelf: string;
  description: string;
}

export interface BackfillPlan {
  adds: WantedAdd[];
  /** Already on the shelf. */
  already: number;
  /** Not public on YouTube right now (private, unlisted, gone): never added. */
  notPublic: WantedAdd[];
  /** Would fit the rule but not today's quota or this run's limit: the next run takes them. */
  later: number;
}

/** What to add (pure): public, not already on the shelf, as many as the room allows. */
export function planBackfill(
  wanted: WantedAdd[],
  privacy: ReadonlyMap<string, string>,
  members: ReadonlyMap<string, ReadonlySet<string>>,
  room: number,
): BackfillPlan {
  const notPublic = wanted.filter((w) => privacy.get(w.videoId) !== "public");
  const open = wanted.filter((w) => privacy.get(w.videoId) === "public");
  const missing = open.filter((w) => !members.get(w.shelf)?.has(w.videoId));
  const fit = Math.max(0, Math.floor(room));
  return {
    adds: missing.slice(0, fit),
    already: open.length - missing.length,
    notPublic,
    later: Math.max(0, missing.length - fit),
  };
}

/** Additions the day's quota can spare after the uploads still due (50 units each). */
export function backfillRoom(
  used: number,
  perDay: number,
  uploadsLeft: number,
): number {
  return Math.floor(
    (perDay - used - uploadsLeft * QUOTA_RESERVE_FOR_UPLOAD) / QUOTA.comment,
  );
}

/** The YouTube calls the catch-up makes. Only addToPlaylist and findOrCreatePlaylist write, and only playlists. */
export interface BackfillYouTube {
  stats(ids: string[]): Promise<Map<string, { privacyStatus: string }>>;
  playlistVideoIds(id: string): Promise<{ ids: string[]; pages: number }>;
  findOrCreatePlaylist(
    title: string,
    description: string,
  ): Promise<{ id: string; created: boolean }>;
  addToPlaylist(playlistId: string, videoId: string): Promise<void>;
}

export interface BackfillReport {
  apply: boolean;
  shelves: Record<
    string,
    { id: string | null; holds: number; toAdd: number; added: number }
  >;
  already: number;
  notPublic: Array<{ episode: string; videoId: string; privacy: string }>;
  later: number;
  added: number;
  unitsSpent: number;
  errors: string[];
}

/** One catch-up. A dry run reads only (about one unit per 50 videos) and adds nothing. */
export async function seriesBackfill(o: {
  db: Db;
  cfg: Config;
  now: () => Date;
  yt: BackfillYouTube;
  apply: boolean;
  max: number;
}): Promise<BackfillReport> {
  const { db, cfg, yt, apply } = o;
  const now = o.now();
  const eps = await db.query<Episode>(
    `SELECT * FROM episodes WHERE status = 'published' AND youtube_video_id IS NOT NULL AND lane <> 'twin'
       AND COALESCE(story_json->'twin'->>'account', '') = '' ORDER BY COALESCE(publish_at, updated_at)`,
  );
  const shelves = new Set<string>(BACKFILL_SHELVES);
  const wanted: WantedAdd[] = eps.flatMap((ep) =>
    seriesFor(cfg, ep, now)
      .filter((x) => shelves.has(x.title))
      .map((x) => ({
        episode: ep.id,
        videoId: ep.youtube_video_id!,
        shelf: x.title,
        description: x.description,
      })),
  );
  let units = 0;
  const spend = async (n: number) => {
    units += n;
    await quotaAdd(db, now, n);
  };
  // What YouTube says now, not what the factory remembers: the owner may have made a video private since.
  const privacy = new Map<string, string>();
  const ids = [...new Set(wanted.map((w) => w.videoId))];
  for (let i = 0; i < ids.length; i += 50) {
    const got = await yt.stats(ids.slice(i, i + 50));
    await spend(QUOTA.poll);
    for (const [id, v] of got) privacy.set(id, v.privacyStatus);
  }
  const playlistIds = new Map<string, string>();
  const members = new Map<string, Set<string>>();
  for (const shelf of new Set(wanted.map((w) => w.shelf))) {
    const [row] = await db.query<{ value: string }>(
      `SELECT value FROM settings WHERE key = $1`,
      [`playlist:${shelf}`],
    );
    if (!row?.value) continue; // made on the first add, when applying
    playlistIds.set(shelf, row.value);
    const held = await yt.playlistVideoIds(row.value);
    await spend(held.pages * QUOTA.poll);
    members.set(shelf, new Set(held.ids));
  }
  const room = Math.min(
    o.max,
    backfillRoom(
      await quotaUsed(db, now),
      cfg.quotaUnitsPerDay,
      uploadsLeftToday(cfg, now),
    ),
  );
  const plan = planBackfill(wanted, privacy, members, room);
  const report: BackfillReport = {
    apply,
    shelves: Object.fromEntries(
      [...new Set(wanted.map((w) => w.shelf))].map((shelf) => [
        shelf,
        {
          id: playlistIds.get(shelf) ?? null,
          holds: members.get(shelf)?.size ?? 0,
          toAdd: plan.adds.filter((a) => a.shelf === shelf).length,
          added: 0,
        },
      ]),
    ),
    already: plan.already,
    notPublic: plan.notPublic.map((w) => ({
      episode: w.episode,
      videoId: w.videoId,
      privacy: privacy.get(w.videoId) ?? "not found",
    })),
    later: plan.later,
    added: 0,
    unitsSpent: 0,
    errors: [],
  };
  if (apply && (await publishHeld(db)))
    report.errors.push("the owner's publishing hold is on: nothing added");
  else if (apply) {
    for (const add of plan.adds) {
      try {
        let id = playlistIds.get(add.shelf);
        if (!id) {
          const made = await yt.findOrCreatePlaylist(
            add.shelf,
            add.description,
          );
          await spend(made.created ? 51 : 1);
          id = made.id;
          playlistIds.set(add.shelf, id);
          await db.query(
            `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [`playlist:${add.shelf}`, id],
          );
          report.shelves[add.shelf]!.id = id;
        }
        await yt.addToPlaylist(id, add.videoId);
        await spend(QUOTA.comment);
        await logEvent(db, add.episode, "playlist", {
          title: add.shelf,
          backfill: true,
        });
        report.shelves[add.shelf]!.added++;
        report.added++;
      } catch (err) {
        report.errors.push(`${add.videoId}: ${errorMessage(err)}`);
        break; // a refusal (quota, scope) will not improve on the next video
      }
    }
  }
  report.unitsSpent = units;
  return report;
}

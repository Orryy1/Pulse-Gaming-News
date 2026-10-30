// The long lane's order and its watchdog. The lane is one tick with one lease: on 30 Oct 2026 the Halo
// ranking's footage gather ran for hours inside it, the weekly recap selected at 15:08 for the 20:00 slot was
// never scripted, and a stale tick-long lease was cleared only by the 20:05 restart. Now the tick takes one
// step at a time, nearest slot first, an unscripted episode due within LONG_URGENT_HOURS always first; and
// the Shorts tick watches the lane: a long tick not completed for LONG_TICK_STALL_MINUTES while no render or
// upload is in progress is reported and its lease released, so the next tick can run. Pure functions here,
// side effects in watchLongLane; a render is never killed.

import type { Db } from "./db.ts";
import { logEvent } from "./episodes.ts";
import { log } from "./lib/util.ts";

/** An unscripted long video whose slot is this close goes ahead of every other long step. */
export const LONG_URGENT_HOURS = 3;
/** The long lane's lease name (src/pipeline.ts tickLong). */
export const LONG_LEASE = "tick-long";

/** The statuses before anything is made: an episode here still needs the whole lane. */
const UNMADE = new Set(["selected", "scripted"]);
/** The statuses before the render. */
const PRE_RENDER = new Set(["selected", "scripted", "voiced"]);

export interface LongRow {
  id: string;
  status: string;
  slot_at: string | Date | null;
  publish_at: string | Date | null;
}

/** When the episode must be out: its publish time, else its slot; undefined when it has neither. */
export function longDueAt(ep: LongRow): number | undefined {
  const t = ep.publish_at ?? ep.slot_at;
  if (!t) return undefined;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

/** Still unscripted (or unvoiced) with a slot within `hours` of now, a missed slot included. */
export function isUrgentLong(
  ep: LongRow,
  now: Date,
  hours = LONG_URGENT_HOURS,
): boolean {
  if (!UNMADE.has(ep.status)) return false;
  const at = longDueAt(ep);
  return at !== undefined && at - now.getTime() <= hours * 3_600_000;
}

/**
 * The order the lane works in: urgent episodes first (nearest slot first among them), then everything else by
 * nearest slot, a made episode (approval, upload, checks) ahead of an unmade one at the same time, episodes
 * without a slot last. Stable, so equals keep the order they came in (oldest first from the query).
 */
export function orderLongEpisodes<T extends LongRow>(eps: T[], now: Date): T[] {
  const key = (e: T): [number, number, number] => [
    isUrgentLong(e, now) ? 0 : 1,
    longDueAt(e) ?? Number.POSITIVE_INFINITY,
    PRE_RENDER.has(e.status) ? 1 : 0,
  ];
  return eps
    .map((e, i) => ({ e, i, k: key(e) }))
    .sort((a, b) => {
      for (let n = 0; n < 3; n++)
        if (a.k[n] !== b.k[n]) return a.k[n]! - b.k[n]!;
      return a.i - b.i;
    })
    .map((x) => x.e);
}

export interface LaneState {
  /** When the long tick last completed (ISO). */
  lastLongTick?: string;
  /** When this process started (ISO), the baseline before the first completed tick. */
  startedAt: string;
  longTicking: boolean;
  rendering: boolean;
  uploading: boolean;
}

/**
 * Whether the long lane has stalled: no completed tick for `stallMinutes` while nothing that may legitimately
 * take that long (a render, an upload) is in progress. A lane that is simply idle completes a tick every few
 * minutes, so a stale timestamp means a tick is stuck.
 */
export function longLaneStalled(
  s: LaneState,
  now: Date,
  stallMinutes: number,
): { stalled: boolean; minutes: number; why: string } {
  const since = new Date(s.lastLongTick ?? s.startedAt).getTime();
  const minutes = Math.round((now.getTime() - since) / 60_000);
  if (minutes <= stallMinutes) return { stalled: false, minutes, why: "fresh" };
  if (s.rendering)
    return { stalled: false, minutes, why: "a render is in progress" };
  if (s.uploading)
    return { stalled: false, minutes, why: "an upload is in progress" };
  return {
    stalled: true,
    minutes,
    why: `no long tick completed for ${minutes} minutes${s.longTicking ? " and one is still running" : ""}`,
  };
}

/** Lets the lease go: the next tick may take it, and the holder's loop stops at its next step. */
export async function releaseLongLease(db: Db): Promise<string | undefined> {
  const [row] = await db.query<{ holder: string }>(
    `UPDATE leases SET expires_at = now() WHERE name = $1 AND expires_at > now() RETURNING holder`,
    [LONG_LEASE],
  );
  return row?.holder;
}

export interface WatchDeps {
  db: Db;
  now: Date;
  stallMinutes: number;
  state: LaneState & { stallReported?: string };
  notify: (m: { content: string }) => Promise<unknown>;
  /** Clears the in-process "long tick running" flag so the next interval may start a tick. */
  reset: () => void;
}

/**
 * The watchdog, run from the Shorts tick: reports a stalled lane once per stall (keyed on the last completed
 * tick), releases its lease and resets the running flag. Returns true when it acted.
 */
export async function watchLongLane(d: WatchDeps): Promise<boolean> {
  const r = longLaneStalled(d.state, d.now, d.stallMinutes);
  if (!r.stalled) return false;
  const key = d.state.lastLongTick ?? d.state.startedAt;
  if (d.state.stallReported === key) return false;
  d.state.stallReported = key;
  const holder = await releaseLongLease(d.db);
  log("warn", "long lane stalled; lease released", {
    minutes: r.minutes,
    holder,
    ticking: d.state.longTicking,
  });
  await logEvent(d.db, null, "long_lane_stalled", {
    minutes: r.minutes,
    holder: holder ?? null,
    ticking: d.state.longTicking,
  });
  await d.notify({
    content: `⚠️ The long-video lane has not finished a pass for ${r.minutes} minutes with no render or upload running, so its turn has been released; the next pass starts within a few minutes. The stuck step stops at its next check. If this repeats, the log (data\\logs) says which step it was.`,
  });
  d.reset();
  return true;
}

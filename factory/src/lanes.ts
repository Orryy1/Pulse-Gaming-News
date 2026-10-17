// Cadence: when a news Short is due, when a story is breaking, how the
// YouTube quota is metered. Pure functions take the clock as an argument so
// the scheduler is tested without waiting for real time.

import type { Db } from "./db.ts";
import type { StoryCluster } from "./discovery/cluster.ts";

export type Lane = "news" | "news_breaking";
export const LANE_PRIORITY: Record<Lane, number> = {
  news_breaking: 100,
  news: 50,
};

// YouTube Data API costs: videos.insert 1600, captions.list 50, captions.insert 400, videos.list 1, playlistItems.list 1.
export const QUOTA = {
  upload: 1650,
  captions: 450,
  poll: 1,
  marker: 3,
} as const;
export const QUOTA_RESERVE_FOR_UPLOAD = QUOTA.upload + QUOTA.captions + 20;

// ------------------------------------------------------------------ time zones

function parts(
  date: Date,
  timeZone: string,
): { y: number; m: number; d: number; h: number; min: number } {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(
    f.formatToParts(date).map((x) => [x.type, x.value]),
  );
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour),
    min: Number(p.minute),
  };
}

/** "YYYY-MM-DD" of the instant in a time zone. */
export function dayKey(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** The UTC instant of a wall-clock time (HH:MM) on the given local day. */
export function localTime(
  dayKeyStr: string,
  hhmm: string,
  timeZone: string,
): Date {
  const [y, m, d] = dayKeyStr.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const [h, min] = hhmm.split(":").map(Number) as [number, number];
  // Two passes handle the zone offset (and DST) without a time-zone library.
  let guess = new Date(Date.UTC(y, m - 1, d, h, min));
  for (let i = 0; i < 2; i++) {
    const p = parts(guess, timeZone);
    const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    guess = new Date(guess.getTime() + (Date.UTC(y, m - 1, d, h, min) - wall));
  }
  return guess;
}

export function addDays(dayKeyStr: string, n: number): string {
  const [y, m, d] = dayKeyStr.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** True when the instant falls inside a local "HH:MM-HH:MM" window. */
export function inWindow(now: Date, window: string, timeZone: string): boolean {
  const [a, b] = window.split("-") as [string, string];
  const day = dayKey(now, timeZone);
  return (
    now >= localTime(day, a, timeZone) && now < localTime(day, b, timeZone)
  );
}

/** Next instant the window opens (today if still ahead, else tomorrow). */
export function nextWindowStart(
  now: Date,
  window: string,
  timeZone: string,
): Date {
  const [a] = window.split("-") as [string, string];
  const day = dayKey(now, timeZone);
  const today = localTime(day, a, timeZone);
  return today > now ? today : localTime(addDays(day, 1), a, timeZone);
}

// ------------------------------------------------------------------ news slots

export interface SlotPlan {
  slots: string[]; // "HH:MM" local, sorted
  leadMinutes: number; // start producing this long before the slot
  graceMinutes: number; // a slot missed by less than this is still filled
  timeZone: string;
}

/** Today's and tomorrow's slot instants, sorted. */
export function slotInstants(now: Date, plan: SlotPlan): Date[] {
  const day = dayKey(now, plan.timeZone);
  const out: Date[] = [];
  for (const d of [day, addDays(day, 1)])
    for (const s of plan.slots) out.push(localTime(d, s, plan.timeZone));
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * The slot an episode should be produced for right now, if any: the earliest
 * slot not yet taken whose lead time has begun and which is not missed by
 * more than the grace period.
 */
export function dueSlot(
  now: Date,
  plan: SlotPlan,
  taken: Date[],
): Date | undefined {
  const takenMs = new Set(taken.map((t) => t.getTime()));
  for (const slot of slotInstants(now, plan)) {
    if (takenMs.has(slot.getTime())) continue;
    const ms = slot.getTime() - now.getTime();
    if (ms > plan.leadMinutes * 60_000) return undefined; // next slot is not due yet
    if (ms < -plan.graceMinutes * 60_000) continue; // missed: skip it
    return slot;
  }
  return undefined;
}

// --------------------------------------------------------------------- breaking

export interface BreakingRule {
  scoreMin: number;
  maxAgeMinutes: number; // since first seen
  window: string; // local publish window
  timeZone: string;
}

export interface Sighting {
  hash: string;
  first_seen: string;
  last_seen: string;
  item_count: number;
  has_official: boolean;
  max_score: number;
}

/** A massive, official, fresh story: the breaking lane's definition. */
export function isBreaking(
  cluster: StoryCluster,
  sighting: Sighting | undefined,
  now: Date,
  rule: BreakingRule,
): boolean {
  if (!cluster.hasOfficial || cluster.rumourSignals || !cluster.corroborated)
    return false;
  const firstSeen = sighting
    ? new Date(sighting.first_seen)
    : new Date(cluster.newestAt);
  const ageMinutes = (now.getTime() - firstSeen.getTime()) / 60_000;
  return (
    ageMinutes <= rule.maxAgeMinutes &&
    Math.max(cluster.score, sighting?.max_score ?? 0) >= rule.scoreMin
  );
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "to",
  "in",
  "for",
  "on",
  "and",
  "is",
  "are",
  "with",
  "new",
  "its",
  "it's",
  "has",
  "have",
  "will",
  "be",
  "at",
  "by",
  "from",
  "as",
  "this",
  "that",
  "gets",
  "get",
  "just",
  "now",
  "out",
]);

/** A coarse franchise key for the breaking cooldown: the headline's first two content words. */
export function franchiseKey(cluster: StoryCluster): string {
  // The headline only: the editor's game hint arrives after the breaking decision, so both sides must agree.
  const base = cluster.headline;
  const words = base
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
  return words.slice(0, 2).join(" ") || base.toLowerCase().slice(0, 20);
}

// ------------------------------------------------------------------------ quota

const PACIFIC = "America/Los_Angeles";

export async function quotaUsed(db: Db, now: Date): Promise<number> {
  const [row] = await db.query<{ units: number | string }>(
    `SELECT units FROM quota_ledger WHERE day = $1`,
    [dayKey(now, PACIFIC)],
  );
  return Number(row?.units ?? 0);
}

export async function quotaAdd(
  db: Db,
  now: Date,
  units: number,
): Promise<void> {
  await db.query(
    `INSERT INTO quota_ledger (day, units) VALUES ($1, $2)
     ON CONFLICT (day) DO UPDATE SET units = quota_ledger.units + EXCLUDED.units, updated_at = now()`,
    [dayKey(now, PACIFIC), units],
  );
}

/** Midnight Pacific after `now`, when the quota resets. */
export function quotaResetAt(now: Date): Date {
  return localTime(addDays(dayKey(now, PACIFIC), 1), "00:00", PACIFIC);
}

/** Last publish instant across lanes: the later of a scheduled publish_at and a published row's update. */
export async function lastPublishAt(db: Db): Promise<Date | undefined> {
  const [row] = await db.query<{ t: string | null }>(
    `SELECT max(greatest(coalesce(publish_at, updated_at), updated_at)) AS t FROM episodes WHERE status IN ('uploading','uploaded','published') AND youtube_status IS DISTINCT FROM 'dry_run'`,
  );
  return row?.t ? new Date(row.t) : undefined;
}

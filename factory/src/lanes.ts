// Cadence: when a news Short is due, when a story is breaking, how the
// YouTube quota is metered. Pure functions take the clock as an argument so
// the scheduler is tested without waiting for real time.

import type { Db } from "./db.ts";
import type { StoryCluster } from "./discovery/cluster.ts";

export type Lane = "news" | "news_breaking" | "evergreen" | "longform" | "free" | "cutdown";
export const LANE_PRIORITY: Record<Lane, number> = {
  news_breaking: 100,
  news: 50,
  free: 40,
  evergreen: 30,
    longform: 20,
  cutdown: 25,
};

// YouTube Data API costs: videos.insert 1600, captions.list 50, captions.insert 400, videos.list 1, playlistItems.list 1.
export const QUOTA = {
  upload: 1650,
  captions: 450,
  poll: 1,
  marker: 3,
  comment: 50,
  search: 101, // search.list plus channels.list for an official trailer
} as const;
// Kept back for a Short's upload and its pinned comment (captions ride only on long videos).
export const QUOTA_RESERVE_FOR_UPLOAD = QUOTA.upload + QUOTA.comment + 20;

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
  const start = localTime(day, a, timeZone);
  const end = localTime(day, b, timeZone);
  // "07:00-03:00" runs past midnight: open from 07:00 today, or until 03:00 this morning.
  if (b <= a) return now >= start || now < end;
  return now >= start && now < end;
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

// -------------------------------------------------------------------- evergreen

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Local weekday name ("mon".."sun") of an instant. */
export function weekday(now: Date, timeZone: string): string {
  const d = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(now).toLowerCase().slice(0, 3);
  return DAYS.includes(d) ? d : "mon";
}

/**
 * The evergreen slot due right now, if any: today is an evergreen day, the
 * slot's lead time has begun, it is not missed by more than the grace, and
 * no evergreen episode already claims it.
 */
export function evergreenDue(now: Date, plan: { days: string[]; slot: string; leadMinutes: number; graceMinutes: number; timeZone: string }, taken: Date[]): Date | undefined {
  if (!plan.days.includes(weekday(now, plan.timeZone))) return undefined;
  const slot = localTime(dayKey(now, plan.timeZone), plan.slot, plan.timeZone);
  if (taken.some((t) => t.getTime() === slot.getTime())) return undefined;
  const ms = slot.getTime() - now.getTime();
  if (ms > plan.leadMinutes * 60_000 || ms < -plan.graceMinutes * 60_000) return undefined;
  return slot;
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

// ---------------------------------------------------------------- showcase sprint

/** The big live showcases: while one is running, a small channel can be picked up by being first. */
export const SHOWCASE =
  /\b(nintendo direct|state of play|xbox (games )?showcase|xbox developer direct|summer game fest|the game awards|gamescom opening night|playstation showcase|ubisoft forward|tokyo game show)\b/i;

/** The showcase running now, when at least two fresh stories (first seen in the last three hours) come from it. */
export function showcaseLive(
  sightings: Array<{ cluster: StoryCluster; sighting?: { first_seen: string } }>,
  now: Date,
): string | undefined {
  const fresh = sightings.filter((x) => {
    const seen = new Date(x.sighting?.first_seen ?? x.cluster.newestAt).getTime();
    return now.getTime() - seen <= 3 * 3600_000 && SHOWCASE.test(storyText(x.cluster));
  });
  if (fresh.length < 2) return undefined;
  const counts = new Map<string, number>();
  for (const x of fresh) {
    const name = storyText(x.cluster).match(SHOWCASE)![0].toLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

/** A story's headline and first summaries: where a showcase is named. */
export function storyText(c: StoryCluster): string {
  return [c.headline, ...c.items.slice(0, 3).map((i) => `${i.title ?? ""} ${i.summary ?? ""}`)].join(" ");
}

/** Scheduled publish times still to come today (local "HH:MM" slots), so a sprint never spends their quota. */
export function slotsLeftToday(now: Date, slots: string[], timeZone: string): number {
  const today = dayKey(now, timeZone);
  return slots.filter((s) => localTime(today, s, timeZone).getTime() > now.getTime()).length;
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

// ------------------------------------------------------------------ publishing hold

/**
 * The owner's publishing hold: while it is on, nothing goes out anywhere (uploads, cross-posts, comment
 * replies, pinned comments, community posts). Checked right before each outward action, and kept in the
 * database so it survives a restart and a quota reset.
 */
export async function publishHeld(db: Db): Promise<boolean> {
  const [row] = await db.query<{ value: string }>(`SELECT value FROM settings WHERE key = 'publish_hold'`);
  return row?.value === "on";
}

export async function setPublishHold(db: Db, on: boolean): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('publish_hold', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [on ? "on" : "off"],
  );
}

/**
 * How late (hours past its planned time) a Short may still go out on its own. News and deals go stale;
 * a later one comes back to the owner instead. Undefined: it never goes stale (rankings, explainers).
 */
export function staleAfterHours(lane: string, evergreenFormat?: string): number | undefined {
  if (lane === "news_breaking") return 8;
  if (lane === "news") return 18;
  if (lane === "free") return 48;
  if (lane === "evergreen" && evergreenFormat === "steam_deals") return 20;
  return undefined;
}

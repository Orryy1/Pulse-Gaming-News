// The Partner Programme readiness tracker (YPP_TRACKER, research of 14 Nov 2026, section 0). From 1 Feb 2027 a new
// channel needs 8,000 qualified watch hours; until 31 Jan 2027 it is 4,000 (with 1,000 subscribers), and the expanded
// fan-funding tier stays at 500 subscribers and 3,000 hours. Qualified hours are public long videos and archived live
// streams over the last 365 days; Shorts never count, nor do private, unlisted or deleted videos.
//
// Once a week it asks YouTube Analytics (read only) for the watch time of every video in the window by content type,
// keeps only the videos YouTube reports as public right now, and projects the 28-day pace to the deadline, allowing
// for the hours that leave the 365-day window on the way. Analytics lags about two days, so the window ends two days
// back. The figure is an estimate of YouTube's own counter (Studio's Earn tab is the authority): it is said so in the
// line, and every number in it was read from the API at the time.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { LeverApi, VideoInfo } from "./ytapi.ts";

export const YPP_HOURS = 4000;
export const YPP_SUBS = 1000;
export const TIER_HOURS = 3000;
export const TIER_SUBS = 500;
/** Analytics is complete to about two days back. */
export const ANALYTICS_LAG_DAYS = 2;
/** A video this short with no content type is taken as a Short (the fallback when the type filter is refused). */
export const SHORT_MAX_SECONDS = 180;

export type ContentKind = "long" | "live" | "short";

export interface VideoMinutes {
  videoId: string;
  minutes: number;
  kind: ContentKind;
}

export interface YppMeasure {
  measuredAt: string;
  /** The 365-day window (inclusive), YYYY-MM-DD. */
  from: string;
  to: string;
  /** Watch hours of public long videos and public archived streams in the window. */
  longHours: number;
  liveHours: number;
  /** The same over the last 28 days of the window. */
  recentHours: number;
  /** Long and live hours on videos that are not public now (private, unlisted, deleted): not counted. */
  notPublicHours: number;
  /** Shorts hours in the window: shown only to say they do not count. */
  shortsHours: number;
  /** Hours that leave the window between `to` and the deadline (an upper bound: every content type). */
  leavingHours: number;
  subscribers?: number;
  /** Net subscribers over the last 28 days. */
  recentSubs?: number;
  /**
   * Analytics' channel-wide long-form and live total for the window, without the per-video split (an upper bound: on
   * 14 Nov 2026 it read 95 hours against 49 summed per public video, the rest on videos the per-video report omits).
   */
  channelLongHours?: number;
  /** How the videos were sorted into long, live and Shorts. */
  method: "content type" | "length";
}

export interface YppProjection extends YppMeasure {
  deadline: string;
  daysLeft: number;
  publicHours: number;
  perDay: number;
  projectedHours: number;
  neededPerDay: number;
  tierNeededPerDay: number;
  projectedSubs?: number;
  /** The day the pace reaches 4,000 hours, YYYY-MM-DD, when it does within five years. */
  reach4000On?: string;
}

const DAY_MS = 86_400_000;
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The window for a measurement on `now` (pure): 365 days ending ANALYTICS_LAG_DAYS back. */
export function yppWindow(now: Date): {
  from: string;
  to: string;
  recentFrom: string;
} {
  const to = dayMs(dayStr(now.getTime())) - ANALYTICS_LAG_DAYS * DAY_MS;
  return {
    from: dayStr(to - 364 * DAY_MS),
    to: dayStr(to),
    recentFrom: dayStr(to - 27 * DAY_MS),
  };
}

/** Minutes by kind, public only (pure): what counts, and what is left out because it is not public now. */
export function tallyMinutes(
  rows: VideoMinutes[],
  privacy: ReadonlyMap<string, string | undefined>,
): { long: number; live: number; short: number; notPublic: number } {
  const out = { long: 0, live: 0, short: 0, notPublic: 0 };
  for (const r of rows) {
    if (r.kind === "short") {
      out.short += r.minutes;
      continue;
    }
    if (privacy.get(r.videoId) !== "public") out.notPublic += r.minutes;
    else out[r.kind] += r.minutes;
  }
  return out;
}

/** A video's kind from its length when the content type is unknown (pure): live content is live, short is a Short. */
export function kindByLength(
  v: Pick<VideoInfo, "durationSeconds" | "liveBroadcastContent"> | undefined,
): ContentKind {
  if (!v) return "long";
  if (v.liveBroadcastContent && v.liveBroadcastContent !== "none")
    return "live";
  return (v.durationSeconds ?? Infinity) <= SHORT_MAX_SECONDS
    ? "short"
    : "long";
}

/** The projection to the deadline (pure). */
export function yppProjection(m: YppMeasure, deadline: string): YppProjection {
  const daysLeft = Math.max(
    0,
    Math.round((dayMs(deadline) - dayMs(m.to)) / DAY_MS),
  );
  const publicHours = m.longHours + m.liveHours;
  const perDay = m.recentHours / 28;
  const projectedHours = Math.max(
    0,
    publicHours + perDay * daysLeft - m.leavingHours,
  );
  const need = (bar: number) =>
    daysLeft > 0
      ? Math.max(0, (bar - publicHours + m.leavingHours) / daysLeft)
      : Infinity;
  const days4000 =
    perDay > 0 ? Math.ceil((YPP_HOURS - publicHours) / perDay) : Infinity;
  return {
    ...m,
    deadline,
    daysLeft,
    publicHours: round1(publicHours),
    perDay: round1(perDay),
    projectedHours: Math.round(projectedHours),
    neededPerDay: round1(need(YPP_HOURS)),
    tierNeededPerDay: round1(need(TIER_HOURS)),
    ...(m.subscribers !== undefined && m.recentSubs !== undefined
      ? {
          projectedSubs: Math.round(
            m.subscribers + (m.recentSubs / 28) * daysLeft,
          ),
        }
      : {}),
    ...(publicHours >= YPP_HOURS
      ? { reach4000On: m.to }
      : Number.isFinite(days4000) && days4000 <= 5 * 365
        ? { reach4000On: dayStr(dayMs(m.to) + days4000 * DAY_MS) }
        : {}),
  };
}

const n0 = (n: number) => Math.round(n).toLocaleString("en-GB");
const longDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** The weekly plain-English line (pure): the count, the pace, the projection and what it would take. */
export function yppLine(p: YppProjection): string {
  const counted = `${n0(p.publicHours)} public watch hours in the last 365 days (long videos ${n0(p.longHours)}, saved streams ${n0(p.liveHours)}; Shorts never count)`;
  const pace = `At the last 28 days' pace (${p.perDay.toFixed(1)} a day) that is about ${n0(p.projectedHours)} by ${longDate(p.deadline)}`;
  const verdict =
    p.projectedHours >= YPP_HOURS
      ? "enough for the 4,000-hour bar"
      : `short of 4,000: it needs ${n0(p.neededPerDay)} hours a day from now`;
  const tier =
    p.projectedHours >= TIER_HOURS
      ? "the 3,000-hour fan-funding tier is on course"
      : `the 3,000-hour fan-funding tier needs ${n0(p.tierNeededPerDay)} a day`;
  const subs =
    p.subscribers !== undefined
      ? ` Subscribers ${n0(p.subscribers)}${p.projectedSubs !== undefined ? `, about ${n0(p.projectedSubs)} by then at this pace` : ""} (500 for the tier, 1,000 for full YPP).`
      : "";
  return `Partner Programme: ${counted}. ${pace}, ${verdict}; ${tier}.${subs} Estimated from YouTube Analytics; Studio's Earn tab is the official count.`;
}

/** The dashboard's short form (pure): label, value and change for status.json. */
export function yppStatusNumber(p: YppProjection): {
  label: string;
  value: string;
  change: string;
} {
  return {
    label: "Public watch hours, 365 days (YPP needs 4,000 by 31 Jan)",
    value: n0(p.publicHours),
    change: `${p.perDay.toFixed(1)}/day; ~${n0(p.projectedHours)} by ${longDate(p.deadline)}; needs ${n0(p.neededPerDay)}/day`,
  };
}

const minutesOf = (rows: Array<Array<string | number>>) =>
  new Map(rows.map((r) => [String(r[0]), Number(r[1] ?? 0)]));

/**
 * Reads the numbers (read only): per-video watch minutes for long videos, streams and Shorts over the window and the
 * last 28 days, the videos' privacy now, the subscribers and the hours that leave the window before the deadline.
 * About eight Analytics requests and a few one-unit Data API calls.
 */
export async function measureYpp(
  api: LeverApi,
  now: Date,
  deadline: string,
): Promise<YppMeasure> {
  const w = yppWindow(now);
  const byType = async (from: string, type: string) =>
    minutesOf(
      (
        await api.report({
          startDate: from,
          endDate: w.to,
          metrics: "estimatedMinutesWatched",
          dimensions: "video",
          filters: `creatorContentType==${type}`,
          sort: "-estimatedMinutesWatched",
          maxResults: "200",
        })
      ).rows,
    );
  let method: YppMeasure["method"] = "content type";
  const rows: VideoMinutes[] = [];
  const recent: VideoMinutes[] = [];
  try {
    // The filter takes the values as the API returns them (checked 14 Nov 2026: "videoOnDemand", "shorts"; the docs
    // list them in capitals, which the API refuses).
    for (const [type, kind] of [
      ["videoOnDemand", "long"],
      ["liveStream", "live"],
      ["shorts", "short"],
    ] as const) {
      // Only the long-video query decides the method; a channel with no streams yet may get nothing back for them.
      const get = (from: string) =>
        byType(from, type).catch((err) => {
          if (kind === "long") throw err;
          return new Map<string, number>();
        });
      for (const [videoId, minutes] of await get(w.from))
        rows.push({ videoId, minutes, kind });
      for (const [videoId, minutes] of await get(w.recentFrom))
        recent.push({ videoId, minutes, kind });
    }
  } catch {
    // The content-type filter refused: sort by each video's length and live flag instead.
    method = "length";
    rows.length = 0;
    recent.length = 0;
    const all = async (from: string) =>
      minutesOf(
        (
          await api.report({
            startDate: from,
            endDate: w.to,
            metrics: "estimatedMinutesWatched",
            dimensions: "video",
            sort: "-estimatedMinutesWatched",
            maxResults: "200",
          })
        ).rows,
      );
    const whole = await all(w.from);
    const last = await all(w.recentFrom);
    const info = new Map(
      (await api.videos([...whole.keys()])).map((v) => [v.id, v]),
    );
    for (const [videoId, minutes] of whole)
      rows.push({ videoId, minutes, kind: kindByLength(info.get(videoId)) });
    for (const [videoId, minutes] of last)
      recent.push({ videoId, minutes, kind: kindByLength(info.get(videoId)) });
  }
  const ids = [
    ...new Set(rows.filter((r) => r.kind !== "short").map((r) => r.videoId)),
  ];
  const privacy = new Map(
    (await api.videos(ids)).map((v) => [v.id, v.privacyStatus]),
  );
  const whole = tallyMinutes(rows, privacy);
  const last = tallyMinutes(recent, privacy);
  // What leaves the window by the deadline: every type watched from the window's start to a year before the deadline.
  const leaveTo = dayStr(dayMs(deadline) - 365 * DAY_MS);
  let leavingHours = 0;
  if (leaveTo >= w.from) {
    const r = await api.report({
      startDate: w.from,
      endDate: leaveTo,
      metrics: "estimatedMinutesWatched",
    });
    leavingHours = Number(r.rows[0]?.[0] ?? 0) / 60;
  }
  const totals = await api
    .report({ startDate: w.from, endDate: w.to, metrics: "estimatedMinutesWatched", dimensions: "creatorContentType" })
    .catch(() => undefined);
  const channelLong = totals?.rows
    .filter((r) => /^(videoOnDemand|liveStream)$/i.test(String(r[0])))
    .reduce((a, r) => a + Number(r[1] ?? 0), 0);
  const subscribers = await api.subscribers().catch(() => undefined);
  const subs = await api
    .report({
      startDate: w.recentFrom,
      endDate: w.to,
      metrics: "subscribersGained,subscribersLost",
    })
    .catch(() => undefined);
  const recentSubs = subs?.rows[0]
    ? Number(subs.rows[0][0] ?? 0) - Number(subs.rows[0][1] ?? 0)
    : undefined;
  return {
    measuredAt: now.toISOString(),
    from: w.from,
    to: w.to,
    longHours: round1(whole.long / 60),
    liveHours: round1(whole.live / 60),
    recentHours: round1((last.long + last.live) / 60),
    notPublicHours: round1(whole.notPublic / 60),
    shortsHours: round1(whole.short / 60),
    leavingHours: round1(leavingHours),
    ...(channelLong !== undefined ? { channelLongHours: round1(channelLong / 60) } : {}),
    ...(subscribers !== undefined ? { subscribers } : {}),
    ...(recentSubs !== undefined ? { recentSubs } : {}),
    method,
  };
}

export const yppFile = (dataDir: string) =>
  path.join(dataDir, "levers", "ypp.json");

export interface YppRecord {
  latest: YppProjection;
  line: string;
  /** One entry a week: the date measured and the public hours then. */
  history: Array<{
    at: string;
    publicHours: number;
    perDay: number;
    projectedHours: number;
  }>;
}

export function readYpp(dataDir: string): YppRecord | undefined {
  try {
    return JSON.parse(fs.readFileSync(yppFile(dataDir), "utf8")) as YppRecord;
  } catch {
    return undefined;
  }
}

/** The record with this week's projection added (pure): history keeps one entry per measurement day, newest last. */
export function withYpp(
  prev: YppRecord | undefined,
  p: YppProjection,
): YppRecord {
  const at = p.measuredAt.slice(0, 10);
  const history = (prev?.history ?? []).filter((h) => h.at !== at);
  history.push({
    at,
    publicHours: p.publicHours,
    perDay: p.perDay,
    projectedHours: p.projectedHours,
  });
  return { latest: p, line: yppLine(p), history: history.slice(-104) };
}

export async function writeYpp(dataDir: string, rec: YppRecord): Promise<void> {
  const file = yppFile(dataDir);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(`${file}.tmp`, JSON.stringify(rec, null, 2), "utf8");
  await fsp.rename(`${file}.tmp`, file);
}

/** True when the last measurement is six and a half days old or more (pure), so it lands before Sunday's report. */
export function yppDue(rec: YppRecord | undefined, now: Date): boolean {
  const last = rec ? Date.parse(rec.latest.measuredAt) : NaN;
  return !Number.isFinite(last) || now.getTime() - last >= 6.5 * DAY_MS;
}

/**
 * The status dashboard with the tracker's number in (pure): the entry with the same label is replaced, else the
 * number goes first and the list stays at five (the README's limit), dropping the last.
 */
export function mergeStatus<
  T extends {
    numbers?: Array<{ label: string; value: string; change?: string }>;
  },
>(status: T, p: YppProjection, at: Date): T & { updated: string } {
  const entry = yppStatusNumber(p);
  const numbers = [...(status.numbers ?? [])];
  const i = numbers.findIndex((x) => x.label.startsWith("Public watch hours"));
  if (i >= 0) numbers[i] = entry;
  else numbers.unshift(entry);
  return {
    ...status,
    numbers: numbers.slice(0, 5),
    updated: at.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

/** The growth report's lines (YPP_TRACKER): this week's line, and the change since the week before when there is one. */
export function yppReportLines(rec: YppRecord | undefined): string[] {
  if (!rec) return [];
  const prev = rec.history.at(-2);
  const delta = prev ? ` (${rec.latest.publicHours - prev.publicHours >= 0 ? "+" : ""}${Math.round(rec.latest.publicHours - prev.publicHours)} hours since ${prev.at})` : "";
  return ["", `🎯 ${rec.line}${delta}`];
}

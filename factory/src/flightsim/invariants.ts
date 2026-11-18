// What must always hold over a simulated stretch of the factory's life (src/flightsim). Each check is pure: it reads
// the run's record (episodes, events, Discord notices, the fake channel, the faults that were on) and answers with
// what broke, in plain words. A whole-day failure that unit tests miss shows up here as a broken invariant.

import { dayKey, localTime, inWindow } from "../lanes.ts";
import type { FaultWindow } from "./faults.ts";
import type { ChannelVideo, Notice } from "./world.ts";
import { scriptSpoilers } from "../writerguard.ts";
import type { SpoilerWindow } from "../sceneindex/spoilers.ts";

export interface SimEpisode {
  id: string;
  lane: string;
  status: string;
  slot_at: string | null;
  publish_at: string | null;
  created_at: string;
  updated_at: string;
  last_error: string | null;
  youtube_video_id: string | null;
  headline: string;
  rumour: boolean;
  big: boolean;
  script: unknown;
  events?: Array<{ at: string; kind: string; detail: string }>;
}

export interface SimRecord {
  start: string;
  end: string;
  cfg: {
    timezone: string;
    newsSlots: string[];
    whySlots: string[];
    whyEnabled: boolean;
    dailyTarget: number;
    shortsPerDayMax: number;
    breakingPerDay: number;
    breakingBigScore: number;
    rumoursPerDay: number;
    minUploadGapMinutes: number;
    breakingWindow: string;
  };
  faults: FaultWindow[];
  episodes: SimEpisode[];
  notices: Notice[];
  videos: ChannelVideo[];
  crashes: Array<{ at: string; where: string; inFlight: string[] }>;
  spoilerWindows: SpoilerWindow[];
  /** Hours with no published Short before it counts as a silent factory. */
  maxSilentHours: number;
}

export interface InvariantResult {
  id: string;
  what: string;
  ok: boolean;
  problems: string[];
}

const HOUR = 3_600_000;
const SHORT_LANES = new Set([
  "news",
  "news_breaking",
  "evergreen",
  "free",
  "gameplay",
  "cutdown",
]);
const IN_FLIGHT = new Set([
  "selected",
  "scripted",
  "voiced",
  "rendered",
  "awaiting_approval",
  "approved",
  "uploading",
  "uploaded",
]);
// A notice that tells the owner about a video that will not go out, or why the factory is holding.
const EXPLAINS =
  /gave up|dropped|stopped|paused|shorts cap|held back|no new short|could not|failed|refused|moves to/i;
const PAUSE = /new stories are paused/i;
const QUIET = /no new short has started/i;
const RECONNECT = /reconnect youtube|login expired|youtube refused an upload/i;

function faultsNear(
  rec: SimRecord,
  at: number,
  beforeMs: number,
  kinds: string[],
): FaultWindow[] {
  return rec.faults.filter(
    (f) =>
      kinds.includes(f.kind) &&
      f.from.getTime() - 60_000 <= at &&
      at <= f.to.getTime() + beforeMs,
  );
}

function label(at: Date, tz: string): string {
  return `${dayKey(at, tz)} ${new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at)}`;
}

/** Every news slot gets a video, or the day's target was met by others, or the owner was told why. */
export function slotsAccounted(rec: SimRecord): InvariantResult {
  const problems: string[] = [];
  const tz = rec.cfg.timezone;
  const start = new Date(rec.start).getTime();
  const end = new Date(rec.end).getTime();
  const slots = [
    ...rec.cfg.newsSlots,
    ...(rec.cfg.whyEnabled ? rec.cfg.whySlots : []),
  ];
  for (let t = start; t < end; t += 24 * HOUR) {
    const day = dayKey(new Date(t), tz);
    for (const hhmm of slots) {
      const slot = localTime(day, hhmm, tz);
      // Only slots the run saw whole: lead time before, and three hours after for the upload.
      if (slot.getTime() < start + 3 * HOUR || slot.getTime() > end - 3 * HOUR)
        continue;
      const mine = rec.episodes.filter(
        (e) =>
          e.slot_at &&
          Math.abs(new Date(e.slot_at).getTime() - slot.getTime()) < 60_000,
      );
      if (
        mine.some(
          (e) =>
            e.status === "published" ||
            (e.status === "uploading" && e.youtube_video_id),
        )
      )
        continue;
      const dayShorts = rec.episodes.filter(
        (e) =>
          SHORT_LANES.has(e.lane) &&
          dayKey(new Date(e.created_at), tz) === day &&
          ["published", "uploaded", "uploading"].includes(e.status),
      );
      if (!mine.length && dayShorts.length >= rec.cfg.dailyTarget) continue;
      const told = rec.notices.some(
        (n) =>
          dayKey(new Date(n.at), tz) === day &&
          EXPLAINS.test(n.text) &&
          new Date(n.at).getTime() <= slot.getTime() + 6 * HOUR,
      );
      if (told) continue;
      const why = mine
        .map(
          (e) =>
            `${e.status}${e.last_error ? `: ${e.last_error.slice(0, 100)}` : ""}`,
        )
        .join("; ");
      problems.push(
        `${label(slot, tz)} slot: ${mine.length ? `its video ended ${why}` : "nothing was made"}, and the owner was not told`,
      );
    }
  }
  return {
    id: "slots_accounted",
    what: "every slot gets a video or a clear reason",
    ok: !problems.length,
    problems,
  };
}

/** No stretch longer than maxSilentHours without a published Short, and no unannounced stall of six working hours. */
export function laneNotSilent(rec: SimRecord): InvariantResult {
  const problems: string[] = [];
  const tz = rec.cfg.timezone;
  const start = new Date(rec.start).getTime();
  const end = new Date(rec.end).getTime();
  const times = rec.videos
    .map((v) => new Date(v.publishAt ?? v.uploadedAt).getTime())
    .filter((t) => t <= end)
    .sort((a, b) => a - b);
  const marks = [start + 12 * HOUR, ...times, end];
  for (let i = 1; i < marks.length; i++) {
    const a = marks[i - 1]!;
    const b = marks[i]!;
    const gap = (b - a) / HOUR;
    if (gap > rec.maxSilentHours) {
      const told = rec.notices.some((n) => {
        const t = new Date(n.at).getTime();
        return (
          t >= a &&
          t <= b &&
          /no new short|paused|no short published/i.test(n.text)
        );
      });
      problems.push(
        `${Math.round(gap)} hours with no Short going out (${label(new Date(a), tz)} to ${label(new Date(b), tz)})${told ? ", though the owner was told" : " and nobody said so"}`,
      );
    }
  }
  return {
    id: "lane_not_silent",
    what: `no stretch over ${rec.maxSilentHours} hours without a Short`,
    ok: !problems.length,
    problems,
  };
}

/** A pause of every lane only ever follows a platform fault (the login or the quota), never one video's content. */
export function noCrossLanePause(rec: SimRecord): InvariantResult {
  const problems: string[] = [];
  for (const n of rec.notices.filter((x) => PAUSE.test(x.text))) {
    const at = new Date(n.at).getTime();
    if (faultsNear(rec, at, 3 * HOUR, ["auth", "quota"]).length) continue;
    problems.push(
      `${label(new Date(at), rec.cfg.timezone)}: every lane paused with no platform fault on (${n.faults.join(", ") || "no fault"}): ${n.text.slice(0, 220)}`,
    );
  }
  return {
    id: "no_cross_lane_pause",
    what: "no single episode failure pauses other lanes",
    ok: !problems.length,
    problems,
  };
}

/** The day's caps hold: SHORTS_PER_DAY_MAX on news Shorts, BREAKING_PER_DAY, RUMOURS_PER_DAY. */
export function cadenceCaps(rec: SimRecord): InvariantResult {
  const problems: string[] = [];
  const tz = rec.cfg.timezone;
  const byDay = new Map<string, SimEpisode[]>();
  // As the factory counts them: a failed or dropped video never used up the day's allowance.
  for (const e of rec.episodes.filter((x) => x.status !== "failed" && x.status !== "rejected")) {
    const d = dayKey(new Date(e.created_at), tz);
    byDay.set(d, [...(byDay.get(d) ?? []), e]);
  }
  for (const [day, eps] of byDay) {
    const news = eps.filter(
      (e) => (e.lane === "news" || e.lane === "news_breaking") && !e.big,
    ).length;
    if (rec.cfg.shortsPerDayMax > 0 && news > rec.cfg.shortsPerDayMax)
      problems.push(
        `${day}: ${news} news Shorts, over SHORTS_PER_DAY_MAX ${rec.cfg.shortsPerDayMax}`,
      );
    const breaking = eps.filter((e) => e.lane === "news_breaking").length;
    if (rec.cfg.breakingBigScore <= 0 && breaking > rec.cfg.breakingPerDay)
      problems.push(
        `${day}: ${breaking} breaking Shorts, over BREAKING_PER_DAY ${rec.cfg.breakingPerDay}`,
      );
    const rumours = eps.filter((e) => e.rumour).length;
    if (rumours > rec.cfg.rumoursPerDay)
      problems.push(
        `${day}: ${rumours} rumours, over RUMOURS_PER_DAY ${rec.cfg.rumoursPerDay}`,
      );
  }
  return {
    id: "cadence_caps",
    what: "the cadence caps hold",
    ok: !problems.length,
    problems,
  };
}

/** Nothing goes public inside another publish's gap, outside the breaking window, or before its slot. */
export function uploadRules(rec: SimRecord): InvariantResult {
  const problems: string[] = [];
  const tz = rec.cfg.timezone;
  const gap = rec.cfg.minUploadGapMinutes * 60_000 - 60_000;
  const seen = new Set<string>();
  const live = rec.videos
    .filter((v) =>
      v.marker ? !seen.has(v.marker) && seen.add(v.marker) : true,
    )
    .map((v) => ({ v, t: new Date(v.publishAt ?? v.uploadedAt).getTime() }))
    .sort((a, b) => a.t - b.t);
  for (let i = 1; i < live.length; i++)
    if (gap > 0 && live[i]!.t - live[i - 1]!.t < gap)
      problems.push(
        `"${live[i - 1]!.v.title}" and "${live[i]!.v.title}" go public ${Math.round((live[i]!.t - live[i - 1]!.t) / 60_000)} minutes apart (MIN_UPLOAD_GAP_MINUTES ${rec.cfg.minUploadGapMinutes})`,
      );
  for (const e of rec.episodes) {
    if (!e.youtube_video_id) continue;
    const v = rec.videos.find((x) => x.id === e.youtube_video_id);
    if (!v) continue;
    const t = new Date(v.publishAt ?? v.uploadedAt);
    if (e.slot_at && t.getTime() < new Date(e.slot_at).getTime() - 60_000)
      problems.push(
        `"${v.title}" goes public at ${label(t, tz)}, before its slot ${label(new Date(e.slot_at), tz)}`,
      );
    if (e.lane === "news_breaking" && !inWindow(t, rec.cfg.breakingWindow, tz))
      problems.push(
        `breaking "${v.title}" goes public at ${label(t, tz)}, outside BREAKING_WINDOW ${rec.cfg.breakingWindow}`,
      );
  }
  return {
    id: "upload_rules",
    what: "no upload breaks the spacing, window or slot rules",
    ok: !problems.length,
    problems,
  };
}

/** Alerts say what is true: "reconnect YouTube" or "YouTube refused" only while the login or the quota is at fault. */
export function truthfulAlerts(rec: SimRecord): InvariantResult {
  const problems: string[] = [];
  for (const n of rec.notices) {
    const at = new Date(n.at).getTime();
    if (
      RECONNECT.test(n.text) &&
      !faultsNear(rec, at, 6 * HOUR, ["auth", "quota"]).length
    )
      problems.push(
        `${label(new Date(at), rec.cfg.timezone)}: told the owner YouTube was at fault when it was not: ${n.text.slice(0, 220)}`,
      );
  }
  // "No new Short has started" is only true when a slot went by with nothing made for it: otherwise it cries wolf
  // between ordinary slots and the owner learns to ignore the one that matters.
  const tz = rec.cfg.timezone;
  const slots = [...rec.cfg.newsSlots, ...(rec.cfg.whyEnabled ? rec.cfg.whySlots : [])];
  for (const n of rec.notices.filter((x) => QUIET.test(x.text))) {
    const at = new Date(n.at).getTime();
    const day = dayKey(new Date(at), tz);
    const missed = slots
      .map((s) => localTime(day, s, tz).getTime())
      .filter((t) => t > at - 8 * HOUR && t <= at - 15 * 60_000)
      .filter((t) => !rec.episodes.some((e) => e.slot_at && Math.abs(new Date(e.slot_at).getTime() - t) < 60_000));
    if (!missed.length)
      problems.push(`${label(new Date(at), tz)}: said no Short had started for hours, but no slot had gone by without one (the next was still to come)`);
  }
  return {
    id: "truthful_alerts",
    what: "alerts are truthful",
    ok: !problems.length,
    problems,
  };
}

/** One video per episode on the channel, however the upload was interrupted. */
export function noDuplicates(rec: SimRecord): InvariantResult {
  const problems: string[] = [];
  const count = new Map<string, ChannelVideo[]>();
  for (const v of rec.videos)
    if (v.marker) count.set(v.marker, [...(count.get(v.marker) ?? []), v]);
  for (const [marker, vs] of count)
    if (vs.length > 1)
      problems.push(
        `"${vs[0]!.title}" is on the channel ${vs.length} times (${marker})`,
      );
  return {
    id: "no_duplicate_upload",
    what: "no duplicate uploads",
    ok: !problems.length,
    problems,
  };
}

/** After a restart mid-step every interrupted episode moves on or ends with a reason; nothing sits stuck. */
export function restartsRecover(rec: SimRecord): InvariantResult {
  const problems: string[] = [];
  const end = new Date(rec.end).getTime();
  for (const c of rec.crashes)
    for (const id of c.inFlight) {
      const e = rec.episodes.find((x) => x.id === id);
      if (!e) continue;
      if (
        IN_FLIGHT.has(e.status) &&
        new Date(e.updated_at).getTime() <= new Date(c.at).getTime() &&
        end - new Date(c.at).getTime() > 6 * HOUR
      )
        problems.push(
          `"${e.headline}" was at ${e.status} when the factory restarted (${c.where}) and never moved again`,
        );
    }
  for (const e of rec.episodes) {
    if (!IN_FLIGHT.has(e.status) || e.lane === "longform") continue;
    const due = Math.max(
      new Date(e.updated_at).getTime(),
      e.slot_at ? new Date(e.slot_at).getTime() : 0,
      e.publish_at ? new Date(e.publish_at).getTime() : 0,
    );
    if (end - due > 8 * HOUR)
      problems.push(
        `"${e.headline}" (${e.lane}) has sat at ${e.status} for ${Math.round((end - due) / HOUR)} hours`,
      );
  }
  return {
    id: "restarts_recover",
    what: "restarts mid-step recover and nothing is stuck",
    ok: !problems.length,
    problems,
  };
}

/** No published video carries a story spoiler for a game in its spoiler window. */
export function spoilerGate(rec: SimRecord): InvariantResult {
  const problems: string[] = [];
  for (const e of rec.episodes) {
    if (!e.youtube_video_id || !e.script) continue;
    const hits = scriptSpoilers(
      e.script as Parameters<typeof scriptSpoilers>[0],
      rec.spoilerWindows,
      new Date(e.created_at),
    );
    if (hits.length)
      problems.push(
        `"${e.headline}" went out with a spoiler: ${hits[0]!.where} "${hits[0]!.phrase}"`,
      );
  }
  for (const v of rec.videos)
    if (/\btrue ending\b/i.test(`${v.title} ${v.description}`))
      problems.push(
        `"${v.title}" carries a spoiler in its title or description`,
      );
  return {
    id: "spoiler_gate",
    what: "the spoiler gate holds",
    ok: !problems.length,
    problems,
  };
}

export const INVARIANTS = [
  slotsAccounted,
  laneNotSilent,
  noCrossLanePause,
  cadenceCaps,
  uploadRules,
  truthfulAlerts,
  noDuplicates,
  restartsRecover,
  spoilerGate,
] as const;

export function checkAll(rec: SimRecord): InvariantResult[] {
  return INVARIANTS.map((f) => f(rec));
}

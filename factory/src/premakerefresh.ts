// Pre-made Shorts made again before they go out (PREMAKE_REFRESH, owner, 20 Nov 2026). "GTA 6: Why its Scooter Bros
// could save you the walk back" was made on 15 Nov from the launch run, during a YouTube bot-check pause: no trailer,
// no scene, no library yet, so it showed IGDB pre-release screenshots and press shots with no moving footage at all.
// GTA VI came out on 19 Nov with a library of official Rockstar clips on disk by then, and the Short still went out on
// 20 Nov exactly as made. Now a pre-made Short is looked at again while it is held for its slot:
//
// - its game came out (the launch calendar, LAUNCH_CALENDAR_FILE) or the Short's own story date passed after its media
//   was gathered, or
// - under half its screen time is moving footage (looked at in its last PREMAKE_THIN_WINDOW_HOURS, when the most
//   material is out),
//
// and there is time before the slot, it goes back to "voiced" with every gathered picture and clip dropped (the
// retry fresh=1 rule, src/server.ts), so the render gathers afresh. The made video, its poster and its assets are kept
// beside it; if the remake fails, comes back with less footage, or is not ready shortly before the slot, the made
// video goes out as it was. Once a Short.
//
// Also here (SHORT_FOOTAGE_WAIT): a Short the footage gate holds while YouTube downloads are paused (17 Nov 2026: "GTA
// Online needed more than heists" and "Why GTA 3 Left Dreamcast" were held for no footage only because every trailer
// and scene fetch met the bot-check pause) waits for the pause to lift and gathers again, once, as a spare.
//
// Pure decisions here; the moves on the database and the files are in the small helpers at the end.

import fs from "node:fs/promises";
import path from "node:path";
import type { LaunchEntry } from "./discovery/launches.ts";
import type { EpisodeAssets } from "./episodes.ts";

/** Under this share of the video on moving footage a pre-made Short is made again when it can be. */
export const PREMAKE_MIN_FOOTAGE_SHARE = 0.5;
/** A remake needs this long before the slot to start (a Short is made in about 20 minutes, then checked). */
export const PREMAKE_REFRESH_LEAD_MINUTES = 75;
/** A remake not approved this close to the slot gives way to the made video. */
export const PREMAKE_FALLBACK_MINUTES = 35;
/** Short of footage, a pre-made Short is made again only inside this many hours of its slot (the latest material). */
export const PREMAKE_THIN_WINDOW_HOURS = 12;
/** While a pre-made Short is held it is looked at again this often, so a launch during the hold is caught in time. */
export const PREMAKE_RECHECK_HOURS = 6;
/** The made video is kept beside the remake under these names. */
export const PREMADE_VIDEO = "short.premade.mp4";
export const PREMADE_POSTER = "poster.premade.jpg";

/** The media a gather made: dropped so the render gathers again (images missing is what makes it gather). */
export const GATHERED_KEYS: ReadonlyArray<keyof EpisodeAssets> = [
  "images",
  "clips",
  "steam",
  "officialTrailer",
  "eraDropped",
  "rich",
  "plan",
  "plan_panel",
  "footageFirst",
  "filled",
  "fillersChosen",
  "sketches",
  "palette",
  "graphicsPrepass",
  "graphicsPasses",
  "gfxMuted",
  "heroCut",
  "shortThumb",
  "annotations",
  "textDetails",
  "frame_focus",
  "mentions",
];

/** What the refresh keeps in the assets while it runs and after. */
export interface PremakeRefresh {
  state: "remaking" | "done" | "restored";
  at: string;
  why: string;
  /** The made video's share of moving footage. */
  share: number;
  /** The assets as made, with video and poster pointing at the kept copies. */
  original?: Record<string, unknown>;
  /** The quality record as made. */
  originalQa?: unknown;
  /** Why the made video went out instead (restored). */
  outcome?: string;
}

/** Share of a plan's frames on moving footage (pure); 0 for no plan. */
export function planFootageShare(
  plan:
    | {
        totalFrames: number;
        shots: Array<{ start: number; end: number; media: { type: string } }>;
      }
    | undefined,
): number {
  if (!plan?.totalFrames) return 0;
  const clip = plan.shots
    .filter((x) => x.media.type === "clip")
    .reduce((n, x) => n + Math.max(0, x.end - x.start), 0);
  return Math.min(1, clip / plan.totalFrames);
}

/** The launch calendar entry a Short is about (its game, else its headline), or undefined (pure). */
export function launchOf(
  entries: readonly LaunchEntry[],
  game: string | undefined,
  headline: string | undefined,
): LaunchEntry | undefined {
  for (const e of entries) {
    let re: RegExp;
    try {
      re = new RegExp(e.match, "i");
    } catch {
      continue;
    }
    if ((game && re.test(game)) || (headline && re.test(headline))) return e;
  }
  return undefined;
}

/** The moment a YYYY-MM-DD day starts, earliest time zone first (UTC+14: a launch reaches New Zealand first). */
const dayStart = (day: string): number =>
  Date.parse(`${day}T00:00:00Z`) - 14 * 3_600_000;

/**
 * Whether a held pre-made Short should be made again now (pure). `gatheredAt` is when its media was gathered (the
 * episode's creation when not kept). `keyDate` is the story's own date (a YYYY-MM-DD the run entry or the story names),
 * if any. Refreshes once; never when the slot is too close.
 */
export function premakeRefreshDecision(o: {
  now: Date;
  slotAt: string;
  gatheredAt: string;
  launches: readonly LaunchEntry[];
  game?: string;
  headline?: string;
  keyDate?: string;
  plan?: Parameters<typeof planFootageShare>[0];
  already?: boolean;
  leadMinutes?: number;
}): { refresh: boolean; why: string; share: number } {
  const share = planFootageShare(o.plan);
  const lead = (o.leadMinutes ?? PREMAKE_REFRESH_LEAD_MINUTES) * 60_000;
  const left = Date.parse(o.slotAt) - o.now.getTime();
  if (o.already)
    return { refresh: false, why: "already made again once", share };
  const gathered = Date.parse(o.gatheredAt);
  const reasons: string[] = [];
  const launch = launchOf(o.launches, o.game, o.headline);
  if (launch) {
    const out = dayStart(launch.launch);
    if (Number.isFinite(gathered) && gathered < out && o.now.getTime() >= out)
      reasons.push(
        `${launch.game} came out on ${launch.launch}, after its media was gathered`,
      );
  }
  if (o.keyDate && /^\d{4}-\d{2}-\d{2}$/.test(o.keyDate)) {
    const key = dayStart(o.keyDate);
    if (Number.isFinite(gathered) && gathered < key && o.now.getTime() >= key)
      reasons.push(
        `its story's date (${o.keyDate}) passed after its media was gathered`,
      );
  }
  if (o.plan && share < PREMAKE_MIN_FOOTAGE_SHARE && left <= PREMAKE_THIN_WINDOW_HOURS * 3_600_000)
    reasons.push(`only ${Math.round(share * 100)}% of it is moving footage`);
  if (!reasons.length)
    return { refresh: false, why: "nothing has changed", share };
  if (!(left >= lead))
    return {
      refresh: false,
      why: `${reasons.join("; ")}, but the slot is too close to make it again`,
      share,
    };
  return { refresh: true, why: reasons.join("; "), share };
}

/** When a held pre-made Short is looked at next (pure): its upload time, or sooner while a refresh could still come. */
export function premakeNextLook(
  holdUntil: Date,
  now: Date,
  mayRefresh: boolean,
): Date {
  if (!mayRefresh) return holdUntil;
  const soon = new Date(now.getTime() + PREMAKE_RECHECK_HOURS * 3_600_000);
  return soon < holdUntil ? soon : holdUntil;
}

/** The assets for the remake (pure): every gathered thing dropped, the made ones kept under `premadeRefresh`. */
export function refreshAssets(
  assets: Record<string, unknown>,
  o: {
    at: Date;
    why: string;
    share: number;
    qa?: unknown;
    video: boolean;
    poster: boolean;
  },
): Record<string, unknown> {
  const original: Record<string, unknown> = {
    ...assets,
    ...(o.video ? { video: PREMADE_VIDEO } : {}),
    ...(o.poster ? { poster: PREMADE_POSTER } : {}),
  };
  delete original.premadeRefresh;
  const next: Record<string, unknown> = { ...assets };
  for (const k of GATHERED_KEYS) delete next[k];
  delete next.video;
  delete next.poster;
  const record: PremakeRefresh = {
    state: "remaking",
    at: o.at.toISOString(),
    why: o.why,
    share: Math.round(o.share * 100) / 100,
    original,
    ...(o.qa !== undefined ? { originalQa: o.qa } : {}),
  };
  next.premadeRefresh = record;
  return next;
}

/**
 * What happens to a remaking Short now (pure): keep waiting, keep the remake, or put the made video back. The remake is
 * kept once approved with at least the made video's footage; it gives way when it failed, was approved with less
 * footage, or is not approved by PREMAKE_FALLBACK_MINUTES before the slot.
 */
export function remakeVerdict(o: {
  status: string;
  now: Date;
  slotAt: string;
  originalShare: number;
  newShare?: number;
}): { action: "wait" | "keep" | "restore"; why: string } {
  if (o.status === "approved") {
    const n = o.newShare ?? 0;
    if (n + 1e-9 < o.originalShare)
      return {
        action: "restore",
        why: `the remake had less moving footage (${Math.round(n * 100)}% against ${Math.round(o.originalShare * 100)}%)`,
      };
    return {
      action: "keep",
      why: `the remake has ${Math.round(n * 100)}% moving footage (was ${Math.round(o.originalShare * 100)}%)`,
    };
  }
  if (["uploading", "uploaded", "published", "rejected"].includes(o.status))
    return { action: "wait", why: "past the point of choosing" };
  if (o.status === "failed")
    return { action: "restore", why: "the remake failed" };
  if (
    Date.parse(o.slotAt) - o.now.getTime() <=
    PREMAKE_FALLBACK_MINUTES * 60_000
  )
    return { action: "restore", why: "the remake was not ready in time" };
  return { action: "wait", why: "the remake is under way" };
}

/** The made assets put back (pure), the record marked restored. */
export function restoredAssets(
  assets: Record<string, unknown>,
  why: string,
): Record<string, unknown> | undefined {
  const r = assets.premadeRefresh as PremakeRefresh | undefined;
  if (!r?.original) return undefined;
  const back: Record<string, unknown> = { ...r.original };
  // The kept copies are copied back over the file names the upload reads.
  if (back.video === PREMADE_VIDEO) back.video = "short.mp4";
  if (back.poster === PREMADE_POSTER) back.poster = "poster.jpg";
  const record: PremakeRefresh = { ...r, state: "restored", outcome: why };
  delete record.original;
  back.premadeRefresh = record;
  return back;
}

/** Keeps the made video and poster beside the remake (the render writes over short.mp4 and poster.jpg). */
export async function keepMadeFiles(
  dir: string,
): Promise<{ video: boolean; poster: boolean }> {
  const copy = (from: string, to: string) =>
    fs.copyFile(path.join(dir, from), path.join(dir, to)).then(
      () => true,
      () => false,
    );
  return {
    video: await copy("short.mp4", PREMADE_VIDEO),
    poster: await copy("poster.jpg", PREMADE_POSTER),
  };
}

/** Puts the made video and poster back under the names the upload reads; false when the kept video is gone. */
export async function putMadeFilesBack(dir: string): Promise<boolean> {
  try {
    await fs.copyFile(
      path.join(dir, PREMADE_VIDEO),
      path.join(dir, "short.mp4"),
    );
  } catch {
    return false;
  }
  await fs
    .copyFile(path.join(dir, PREMADE_POSTER), path.join(dir, "poster.jpg"))
    .catch(() => undefined);
  return true;
}

// ---- SHORT_FOOTAGE_WAIT ------------------------------------------------------------------------------------------

/** Minutes after the YouTube pause lifts before the held Short gathers again (the first calls after a lift are probes). */
export const FOOTAGE_WAIT_AFTER_LIFT_MINUTES = 15;
/** A pause longer than this is not waited for: the Short is held as before. */
export const FOOTAGE_WAIT_MAX_HOURS = 72;
/** A Short already held for no footage is tried once more only within this many days of its hold. */
export const FOOTAGE_RETRY_DAYS = 5;

/**
 * Whether a Short the footage gate would hold should wait for YouTube instead (pure): only when the anonymous lane is
 * paused now (or its gather met the pause), only once, only for a pause that ends within FOOTAGE_WAIT_MAX_HOURS.
 * `until` is the pause's end (ms); `metPause` is true when the gather's fetches were refused by the pause.
 */
export function footageWaitPlan(o: {
  now: number;
  blockUntil?: number;
  metPause: boolean;
  waitedBefore: boolean;
}): { wait: true; at: Date } | { wait: false; why: string } {
  if (o.waitedBefore)
    return { wait: false, why: "it already waited for YouTube once" };
  const until = o.blockUntil && o.blockUntil > o.now ? o.blockUntil : undefined;
  if (!until && !o.metPause)
    return { wait: false, why: "YouTube was not paused" };
  const at = (until ?? o.now) + FOOTAGE_WAIT_AFTER_LIFT_MINUTES * 60_000;
  if (at - o.now > FOOTAGE_WAIT_MAX_HOURS * 3_600_000)
    return { wait: false, why: "the YouTube pause is too long to wait for" };
  return { wait: true, at: new Date(at) };
}

/** True for the footage gate's hold message (src/pipeline.ts SHORT_FOOTAGE_GATE). */
export const isFootageHold = (lastError: string | null | undefined): boolean =>
  /^QA held: .* is held: no moving footage of /s.test(String(lastError ?? ""));

/** The assets for a footage retry (pure): the gather starts from nothing; the wait is recorded so it happens once. */
export function footageRetryAssets(
  assets: Record<string, unknown>,
  o: { at: Date; why: string },
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...assets };
  for (const k of GATHERED_KEYS) delete next[k];
  next.footageWait = { at: o.at.toISOString(), why: o.why };
  return next;
}

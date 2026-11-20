// The weekly stream compilation's settings (STREAM_WEEKLY, owner 14 Nov 2026: every week the owner's own streams become
// one 15 to 25 minute long video, "GTA 6 Week N: the best moments, tests and discoveries"). Read in one place (pure:
// the environment is passed in) so the rest of the config stays untouched. Off by default.

import path from "node:path";
import os from "node:os";

export interface StreamWeeklySettings {
  /** STREAM_WEEKLY: build, render and hand over one compilation a week. */
  enabled: boolean;
  /** STREAM_WEEKLY_DAY: the weekday it goes out ("sun"). */
  day: string;
  /** STREAM_WEEKLY_SLOT: "HH:MM" in the factory's time zone. */
  slot: string;
  /** STREAM_WEEKLY_START: YYYY-MM-DD, the first day of Week 1 (GTA VI's launch day). */
  start: string;
  /** STREAM_WEEKLY_GAME: the game the series is about. */
  game: string;
  /** STREAM_WEEKLY_MIN_MINUTES / STREAM_WEEKLY_MAX_MINUTES: the cut's length. */
  minMinutes: number;
  maxMinutes: number;
  /** STREAM_WEEKLY_MAKE_HOURS: how long before the slot the week is compiled (the render needs the PC or the Mac). */
  makeHours: number;
  /** STREAM_WEEKLY_UPLOAD: upload it private, scheduled for the slot. Off: the file and the package go to Discord. */
  upload: boolean;
  /** STREAM_WEEKLY_MIN_MOMENTS: fewer usable moments than this and the week is skipped (said so in Discord). */
  minMoments: number;
  /** VOD_MINER_DIR is shared: where the recordings are. */
  vodDir: string;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const bool = (raw: string | undefined, fallback: boolean) =>
  raw === undefined || raw === ""
    ? fallback
    : ["1", "true", "yes", "on"].includes(raw.toLowerCase());
const num = (
  raw: string | undefined,
  fallback: number,
  lo: number,
  hi: number,
) => {
  const n = Number(raw);
  return raw === undefined || raw === "" || !Number.isFinite(n)
    ? fallback
    : Math.min(hi, Math.max(lo, n));
};

export function streamWeeklySettings(
  env: NodeJS.ProcessEnv,
): StreamWeeklySettings {
  const day = (env.STREAM_WEEKLY_DAY ?? "").trim().slice(0, 3).toLowerCase();
  const slot = (env.STREAM_WEEKLY_SLOT ?? "").trim();
  const start = (env.STREAM_WEEKLY_START ?? "").trim();
  const minMinutes = num(env.STREAM_WEEKLY_MIN_MINUTES, 15, 3, 60);
  return {
    enabled: bool(env.STREAM_WEEKLY, false),
    day: DAYS.includes(day) ? day : "sun",
    slot: /^\d\d:\d\d$/.test(slot) ? slot : "18:00",
    start: /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : "2026-11-19",
    game: env.STREAM_WEEKLY_GAME?.trim() || "Grand Theft Auto VI",
    minMinutes,
    maxMinutes: Math.max(
      minMinutes + 1,
      num(env.STREAM_WEEKLY_MAX_MINUTES, 25, 4, 90),
    ),
    makeHours: num(env.STREAM_WEEKLY_MAKE_HOURS, 20, 2, 96),
    upload: bool(env.STREAM_WEEKLY_UPLOAD, false),
    minMoments: Math.round(num(env.STREAM_WEEKLY_MIN_MOMENTS, 8, 3, 100)),
    vodDir:
      env.VOD_MINER_DIR || path.join(os.homedir(), "Videos", "TinoTV VODs"),
  };
}

/** One line for the boot summary. */
export function streamWeeklySummary(s: StreamWeeklySettings): string {
  if (!s.enabled) return "off";
  return `on: ${s.game}, ${s.day} ${s.slot} from ${s.start}, ${s.minMinutes}-${s.maxMinutes} min, compiled ${s.makeHours} h ahead, ${s.upload ? "uploaded private for the slot" : "handed over in Discord"}`;
}

// The dependency forecaster (FORECAST_ENABLED, off by default): the outside things the factory leans on, measured
// each day and projected forward, so the owner hears days ahead that one is about to run out, never on the morning
// it does. Each forecast is pure (numbers in, a plain line out) and names the fallback already in place, if any.
// The readers live in src/doctor.ts beside the boot checks they extend; the alert goes out through the usual
// notify path, once per dependency per level per day.

export type ForecastLevel = "ok" | "warn" | "urgent";

export interface Forecast {
  id: string;
  level: ForecastLevel;
  /** Days until it runs out (or lapses), when that can be said. */
  daysLeft?: number;
  line: string;
  /** What already happens by itself when it does run out. */
  fallback?: string;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

function level(daysLeft: number, horizon: number): ForecastLevel {
  if (daysLeft <= 1) return "urgent";
  if (daysLeft <= horizon) return "warn";
  return "ok";
}

function days(n: number): string {
  if (n < 1) return `${Math.max(0, Math.round(n * 24))} hours`;
  const r = Math.round(n * 10) / 10;
  return `${r} day${r === 1 ? "" : "s"}`;
}

/** ElevenLabs characters at the cycle's pace: run out before the reset, and when. */
export function forecastElevenLabs(
  plan: { left: number; resetAt: Date; pacePerDay: number } | undefined,
  now: Date,
  horizonDays: number,
  reserve = 0,
): Forecast {
  const fallback =
    "the local voice takes over by itself (VOICE_PROVIDER elevenlabs-first)";
  if (!plan)
    return {
      id: "elevenlabs",
      level: "ok",
      line: "ElevenLabs: balance unknown (no key, or the API did not answer)",
      fallback,
    };
  const usable = Math.max(0, plan.left - reserve);
  const toReset = (plan.resetAt.getTime() - now.getTime()) / DAY;
  if (plan.pacePerDay <= 0 || usable / plan.pacePerDay >= toReset)
    return {
      id: "elevenlabs",
      level: usable <= 0 ? "warn" : "ok",
      line: `ElevenLabs: ${plan.left.toLocaleString("en-US")} characters left, enough until the reset in ${days(toReset)}`,
      fallback,
    };
  const left = usable / plan.pacePerDay;
  return {
    id: "elevenlabs",
    level: level(left, horizonDays),
    daysLeft: left,
    line: `ElevenLabs: ${plan.left.toLocaleString("en-US")} characters left at about ${Math.round(plan.pacePerDay).toLocaleString("en-US")} a day runs out in ${days(left)}, ${days(toReset - left)} before the reset`,
    fallback,
  };
}

/** Hours to the next Pacific midnight, when the YouTube quota resets (pure). */
export function hoursToPacificMidnight(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return 24 - h - m / 60;
}

/** The YouTube Data API day: shared units and upload calls at today's pace, against the day's limits. */
export function forecastYouTubeQuota(o: {
  units: number;
  unitLimit: number;
  uploads: number;
  uploadLimit: number;
  now: Date;
}): Forecast {
  const left = hoursToPacificMidnight(o.now);
  const gone = Math.max(0.5, 24 - left);
  const projUnits = o.units + (o.units / gone) * left;
  const projUploads = o.uploads + (o.uploads / gone) * left;
  const over = projUnits > o.unitLimit || projUploads > o.uploadLimit;
  const fallback =
    "finished Shorts wait for the reset at midnight Pacific (quota_deferred) and keep their slot order";
  if (o.units >= o.unitLimit || o.uploads >= o.uploadLimit)
    return {
      id: "youtube_quota",
      level: "urgent",
      daysLeft: 0,
      line: `YouTube quota: used up for today (${o.units}/${o.unitLimit} units, ${o.uploads}/${o.uploadLimit} uploads); it resets in ${days(left / 24)}`,
      fallback,
    };
  if (over)
    return {
      id: "youtube_quota",
      level: "warn",
      line: `YouTube quota: at today's pace ${Math.round(projUnits)} of ${o.unitLimit} units and ${Math.round(projUploads)} of ${o.uploadLimit} uploads by the reset in ${days(left / 24)}`,
      fallback,
    };
  return {
    id: "youtube_quota",
    level: "ok",
    line: `YouTube quota: ${o.units}/${o.unitLimit} units and ${o.uploads}/${o.uploadLimit} uploads today, on course`,
  };
}

/**
 * The YouTube login: refused now (urgent), or lapsing on a known lifetime. Google's refresh tokens last seven days
 * while the OAuth app is in Testing; FORECAST_YOUTUBE_TOKEN_DAYS says so (0: no known lifetime).
 */
export function forecastYouTubeToken(o: {
  savedAt?: Date;
  lifetimeDays: number;
  refreshOk?: boolean;
  refreshDetail?: string;
  now: Date;
  horizonDays: number;
}): Forecast {
  if (o.refreshOk === false)
    return {
      id: "youtube_token",
      level: "urgent",
      daysLeft: 0,
      line: `YouTube login: refused now (${(o.refreshDetail ?? "").slice(0, 120)}). Uploads will fail until it is reconnected at /connect`,
    };
  if (!o.savedAt || o.lifetimeDays <= 0)
    return {
      id: "youtube_token",
      level: "ok",
      line: "YouTube login: refreshes fine",
    };
  const left =
    (o.savedAt.getTime() + o.lifetimeDays * DAY - o.now.getTime()) / DAY;
  return {
    id: "youtube_token",
    level: level(left, o.horizonDays),
    daysLeft: left,
    line:
      left > 0
        ? `YouTube login: lapses in ${days(left)} (a ${o.lifetimeDays}-day token); reconnect at /connect before then`
        : "YouTube login: past its lifetime; reconnect at /connect",
  };
}

/** The start of the Codex week (UTC midnight of the reset weekday, 0 Sunday) on or before now (pure). */
export function weekStart(now: Date, resetDay: number): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  while (d.getUTCDay() !== resetDay) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/** Codex's weekly allowance at this week's pace (CODEX_WEEKLY_CALLS; 0 means the allowance is unknown). */
export function forecastCodex(o: {
  calls: number;
  failures: number;
  budget: number;
  now: Date;
  resetDay: number;
  horizonDays: number;
}): Forecast {
  const fallback =
    "routed steps go to Claude by themselves (paid, so the Claude budget feels it)";
  const start = weekStart(o.now, o.resetDay);
  const elapsed = Math.max(0.25, (o.now.getTime() - start.getTime()) / DAY);
  const toReset = 7 - elapsed;
  if (o.failures >= 5 && o.calls === 0)
    return {
      id: "codex",
      level: "urgent",
      line: `Codex: ${o.failures} failures and no answers this week; it may be out or logged out`,
      fallback,
    };
  if (o.budget <= 0)
    return {
      id: "codex",
      level: "ok",
      line: `Codex: ${o.calls} answers this week (no weekly allowance set: CODEX_WEEKLY_CALLS)`,
      fallback,
    };
  const pace = o.calls / elapsed;
  const left = pace > 0 ? (o.budget - o.calls) / pace : Infinity;
  if (left >= toReset)
    return {
      id: "codex",
      level: "ok",
      line: `Codex: ${o.calls}/${o.budget} this week, enough until the reset in ${days(toReset)}`,
      fallback,
    };
  return {
    id: "codex",
    level: level(left, o.horizonDays),
    daysLeft: Math.max(0, left),
    line: `Codex: ${o.calls}/${o.budget} this week; at ${Math.round(pace)} a day it runs out in ${days(Math.max(0, left))}, ${days(toReset - Math.max(0, left))} before the reset`,
    fallback,
  };
}

/** Free space by its trend over the samples (a straight line through them), against the floor. */
export function forecastDisk(o: {
  machine: string;
  freeGb: number;
  samples: Array<{ at: string; freeGb: number }>;
  floorGb: number;
  now: Date;
  horizonDays: number;
}): Forecast {
  const id = `disk_${o.machine.toLowerCase()}`;
  const fallback =
    "old episode media is pruned first, oldest first (MEDIA_MIN_FREE_GB)";
  const pts = [...o.samples, { at: o.now.toISOString(), freeGb: o.freeGb }].map(
    (s) => ({ x: new Date(s.at).getTime() / DAY, y: s.freeGb }),
  );
  if (o.freeGb <= o.floorGb)
    return {
      id,
      level: "urgent",
      daysLeft: 0,
      line: `${o.machine} disk: ${o.freeGb.toFixed(0)} GB free, at or under the ${o.floorGb} GB floor`,
      fallback,
    };
  if (pts.length < 3)
    return {
      id,
      level: "ok",
      line: `${o.machine} disk: ${o.freeGb.toFixed(0)} GB free (trend after three days of samples)`,
    };
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  const slope =
    pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) /
    Math.max(
      1e-9,
      pts.reduce((a, p) => a + (p.x - mx) ** 2, 0),
    );
  if (slope >= -0.05)
    return {
      id,
      level: "ok",
      line: `${o.machine} disk: ${o.freeGb.toFixed(0)} GB free and steady`,
    };
  const left = (o.freeGb - o.floorGb) / -slope;
  return {
    id,
    level: level(left, o.horizonDays),
    daysLeft: left,
    line: `${o.machine} disk: ${o.freeGb.toFixed(0)} GB free, falling ${(-slope).toFixed(1)} GB a day: the ${o.floorGb} GB floor in ${days(left)}`,
    fallback,
  };
}

/** The PC's Ollama (the free picture checker): down now, and how much of the last day it was down. */
export function forecastOllama(o: {
  downNow: boolean;
  downSince?: Date;
  outagesLastDay: number;
  now: Date;
}): Forecast {
  const fallback =
    "picture checks are skipped and marked, never sent to the paid API (VISION_PAID_FALLBACK off)";
  if (o.downNow) {
    const h = o.downSince
      ? (o.now.getTime() - o.downSince.getTime()) / HOUR
      : 0;
    return {
      id: "ollama",
      level: h >= 2 ? "urgent" : "warn",
      line: `PC Ollama: down${o.downSince ? ` for ${days(h / 24)}` : ""}; Shorts go out without the picture check`,
      fallback,
    };
  }
  if (o.outagesLastDay >= 3)
    return {
      id: "ollama",
      level: "warn",
      line: `PC Ollama: up, but down ${o.outagesLastDay} times in the last day; something on the PC keeps stopping it`,
      fallback,
    };
  return { id: "ollama", level: "ok", line: "PC Ollama: up" };
}

/** Last night's backup: present, or how long since the last one. */
export function forecastBackup(o: { lastAt?: Date; now: Date }): Forecast {
  if (!o.lastAt)
    return { id: "backup", level: "warn", line: "Backups: none recorded yet" };
  const h = (o.now.getTime() - o.lastAt.getTime()) / HOUR;
  if (h > 50)
    return {
      id: "backup",
      level: "urgent",
      line: `Backups: the last one is ${days(h / 24)} old; two nights have been missed`,
    };
  if (h > 28)
    return {
      id: "backup",
      level: "warn",
      line: `Backups: the last one is ${Math.round(h)} hours old; last night's did not happen`,
    };
  return {
    id: "backup",
    level: "ok",
    line: `Backups: fresh (${Math.round(h)} hours old)`,
  };
}

/**
 * The alert for forecasts that changed for the worse today (pure): each dependency is said once per level per day.
 * Returns the text (undefined: nothing new) and the record to keep.
 */
export function forecastAlert(
  forecasts: readonly Forecast[],
  sent: Record<string, string>,
  day: string,
): { text?: string; sent: Record<string, string> } {
  const next = { ...sent };
  const fresh = forecasts.filter((f) => {
    if (f.level === "ok") {
      delete next[f.id];
      return false;
    }
    const key = `${day}:${f.level}`;
    if (sent[f.id] === key) return false;
    next[f.id] = key;
    return true;
  });
  if (!fresh.length) return { sent: next };
  const urgent = fresh.some((f) => f.level === "urgent");
  const lines = fresh
    .sort((a, b) =>
      a.level === b.level
        ? (a.daysLeft ?? 99) - (b.daysLeft ?? 99)
        : a.level === "urgent"
          ? -1
          : 1,
    )
    .map(
      (f) =>
        `- ${f.level === "urgent" ? "🔴" : "🟠"} ${f.line}.${f.fallback ? ` If it does: ${f.fallback}.` : ""}`,
    );
  return {
    text: `${urgent ? "⚠️ Running out soon" : "🔭 Heads-up, days ahead"}:\n${lines.join("\n")}`.slice(
      0,
      1900,
    ),
    sent: next,
  };
}

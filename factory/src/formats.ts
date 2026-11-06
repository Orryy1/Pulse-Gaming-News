// Format trials: every kind of video has to earn its upload slot (the YouTube quota allows about five a
// day, so a weak format costs a news Short). Each format's median views 24 h after publish over the last
// 28 days is compared with news, the channel's core. A format needs six videos before it is judged; under
// 40% of news' median it is paused for four weeks, then tried afresh on new videos only. Seasonal formats
// (Steam deals during the big Steam sales) run in their season whatever their score.

import type { Db } from "./db.ts";
import type { Script } from "./editorial/schema.ts";

export const MIN_SAMPLES = 6;
export const PAUSE_BELOW = 0.4;
export const PAUSE_DAYS = 28;
const WINDOW_DAYS = 28;

/** The big Steam sales (UTC dates, inclusive; Valve's usual windows, confirm each year's announcement). */
export const STEAM_SALES: ReadonlyArray<readonly [string, string]> = [
  ["2026-11-24", "2026-12-02"], // Autumn Sale
  ["2026-12-17", "2027-01-05"], // Winter Sale
  ["2027-03-18", "2027-03-26"], // Spring Sale
  ["2027-06-24", "2027-07-09"], // Summer Sale
];

const SEASONS: Record<string, ReadonlyArray<readonly [string, string]>> = {
  steam_deals: STEAM_SALES,
};

export const inSeason = (format: string, now: Date): boolean => {
  const day = now.toISOString().slice(0, 10);
  return (SEASONS[format] ?? []).some(([a, b]) => day >= a && day <= b);
};

/** A video's format: news (breaking included), an evergreen format, the free-games Short or the long video. */
export function formatOf(
  lane: string,
  script: Pick<Script, "evergreen_format"> | null | undefined,
): string {
  if (lane.startsWith("news")) return "news";
  if (lane !== "evergreen") return lane;
  const f = script?.evergreen_format ?? "ranking";
  return /achievements$/.test(f) ? "achievements" : f;
}

export interface FormatScore {
  format: string;
  n: number;
  median: number;
}

export interface Pause {
  until: string; // ISO
  why: string;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

export async function readPauses(db: Db): Promise<Record<string, Pause>> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'format_pauses'`,
  );
  try {
    return row ? (JSON.parse(row.value) as Record<string, Pause>) : {};
  } catch {
    return {};
  }
}

async function writePauses(
  db: Db,
  pauses: Record<string, Pause>,
): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('format_pauses', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(pauses)],
  );
}

/** False while a format is paused (out of its season); the scheduler then leaves its slot to news. */
export async function formatOpen(
  db: Db,
  format: string,
  now: Date,
): Promise<boolean> {
  if (inSeason(format, now)) return true;
  const p = (await readPauses(db))[format];
  return !p || new Date(p.until) <= now;
}

/**
 * Median views 24 h after publish per format, last 28 days. After a pause only videos published since it
 * ended count, so a re-trial is judged on its own results.
 */
export async function scoreboard(db: Db, now: Date): Promise<FormatScore[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const rows = await db.query<{
    lane: string;
    views: number | string;
    script_json: Script | null;
    captured_at: string | Date;
  }>(
    `SELECT e.lane, m.views, e.script_json, m.captured_at
     FROM video_metrics m JOIN episodes e ON e.id = m.episode_id
     WHERE m.label = '24h' AND m.captured_at > $1`,
    [since],
  );
  const pauses = await readPauses(db);
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const f = formatOf(r.lane, r.script_json);
    const ended = pauses[f]?.until;
    if (ended && new Date(r.captured_at) < new Date(ended)) continue;
    if (!by.has(f)) by.set(f, []);
    by.get(f)!.push(Number(r.views));
  }
  return [...by.entries()]
    .map(([format, v]) => ({ format, n: v.length, median: median(v) }))
    .sort((a, b) => b.median - a.median);
}

export type Verdict = "core" | "trial" | "keep" | "pause";

export function verdict(s: FormatScore, newsMedian: number): Verdict {
  if (s.format === "news") return "core";
  if (s.n < MIN_SAMPLES || !newsMedian) return "trial";
  return s.median < PAUSE_BELOW * newsMedian ? "pause" : "keep";
}

const NAMES: Record<string, string> = {
  news: "News",
  steam_deals: "Steam deals",
  release_radar: "Release Radar",
  steam_climbers: "Steam climbers",
  achievements: "Achievement hunts",
  weekly_recap: "Weekly recap",
  free: "Free games",
  ranking: "Rankings",
  longform: "Long rankings",
};
export const formatName = (f: string) => NAMES[f] ?? f.replace(/_/g, " ");

/**
 * The weekly review: pauses formats that fall short, and returns the scoreboard as plain lines for the
 * digest (a format already paused keeps its pause; one past its pause is back on trial).
 */
export async function reviewFormats(db: Db, now: Date): Promise<string[]> {
  const board = await scoreboard(db, now);
  const news = board.find((b) => b.format === "news")?.median ?? 0;
  const pauses = await readPauses(db);
  const lines: string[] = [];
  let changed = false;
  for (const s of board) {
    const v = verdict(s, news);
    const share = news ? Math.round((100 * s.median) / news) : 0;
    const p = pauses[s.format];
    const pausedNow = p && new Date(p.until) > now;
    if (v === "pause" && !pausedNow && !inSeason(s.format, now)) {
      const until = new Date(now.getTime() + PAUSE_DAYS * 86_400_000);
      pauses[s.format] = {
        until: until.toISOString(),
        why: `${s.median} median views at 24 h over ${s.n} videos, ${share}% of news`,
      };
      changed = true;
      lines.push(
        `• ${formatName(s.format)}: **paused until ${until.toISOString().slice(0, 10)}** (${share}% of news over ${s.n} videos); its slots go to news, then it gets a fresh trial.`,
      );
    } else if (pausedNow) {
      lines.push(
        `• ${formatName(s.format)}: paused until ${p.until.slice(0, 10)}.`,
      );
    } else if (v === "core") {
      lines.push(
        `• News: ${s.median.toLocaleString("en-US")} median views at 24 h over ${s.n} Shorts (the bar).`,
      );
    } else if (v === "trial") {
      lines.push(
        `• ${formatName(s.format)}: on trial, ${s.n} of ${MIN_SAMPLES} videos so far (${share}% of news).`,
      );
    } else {
      lines.push(
        `• ${formatName(s.format)}: keeps its slot at ${share}% of news over ${s.n} videos.`,
      );
    }
  }
  for (const [f, p] of Object.entries(pauses))
    if (new Date(p.until) > now && !board.some((b) => b.format === f))
      lines.push(`• ${formatName(f)}: paused until ${p.until.slice(0, 10)}.`);
  if (changed) await writePauses(db, pauses);
  return lines;
}

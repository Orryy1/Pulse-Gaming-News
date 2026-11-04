// The Sunday growth report (owner's plan, 4 Nov 2026, item 12): subscribers per 1,000 views for each format, week on
// week, and one line on what to back. The growth plan's whole argument rests on this number, so it goes to the alerts
// channel where the decision gets made. It reads only the "retention" rows the factory keeps (YouTube Analytics' views
// and subscribers gained for each video, taken once from day four: src/analytics.ts), so a video counts in the week
// its numbers arrived and shows its first days, not its whole life. Nothing is estimated: a format short of data says
// so, and the call says so when no format has earned one. GROWTH_REPORT turns it on.
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { dayKey, weekday } from "./lanes.ts";
import type { DiscordMessage } from "./approval/discord.ts";

export type GrowthFormat =
  | "news"
  | "why"
  | "ranking"
  | "doc"
  | "explainer"
  | "other";

const NAMES: Record<GrowthFormat, string> = {
  news: "News",
  why: "The Why",
  ranking: "Rankings",
  doc: "Documentaries",
  explainer: "Explainers",
  other: "Other (deals, release lists, recaps)",
};

/** Under this many views in a week, a rate is noise: "not enough data". */
export const MIN_WEEK_VIEWS = 300;
/** What a format needs over 28 days before the report will back it. */
export const BACK_MIN_VIDEOS = 3;
export const BACK_MIN_VIEWS = 500;
export const BACK_MIN_SUBS = 2;
/** It must also beat the next format with data by this much. */
export const BACK_LEAD = 1.5;

/** Which format a video belongs to, from how it was made. */
export function growthFormat(ep: {
  lane: string;
  story_hash?: string | null;
  evergreen_format?: string | null;
  explained?: boolean | null;
  recap?: boolean | null;
}): GrowthFormat {
  if (ep.explained) return "explainer";
  if (ep.recap) return "other";
  if (ep.evergreen_format === "documentary") return "doc";
  if (ep.story_hash?.startsWith("why:")) return "why";
  if (
    ep.lane === "cutdown" ||
    ep.evergreen_format === "ranking" ||
    ep.story_hash?.startsWith("evergreen:ranking")
  )
    return "ranking";
  if (ep.lane === "news" || ep.lane === "news_breaking") return "news";
  return "other";
}

export interface GrowthRow {
  format: GrowthFormat;
  views: number;
  subs: number;
  at: number;
}

export interface FormatTally {
  videos: number;
  views: number;
  subs: number;
}

const per1k = (t: FormatTally) => (t.subs / t.views) * 1000;

/** Each format's videos, views and subscribers between two times (pure). */
export function tally(
  rows: GrowthRow[],
  from: number,
  to: number,
): Map<GrowthFormat, FormatTally> {
  const out = new Map<GrowthFormat, FormatTally>();
  for (const r of rows) {
    if (r.at < from || r.at >= to) continue;
    const t = out.get(r.format) ?? { videos: 0, views: 0, subs: 0 };
    t.videos++;
    t.views += r.views;
    t.subs += r.subs;
    out.set(r.format, t);
  }
  return out;
}

const n0 = (n: number) => n.toLocaleString("en-US");

/** A week's figure for one format, or why there is none. */
function reading(t: FormatTally | undefined): string {
  if (!t) return "no videos";
  const of = `${n0(t.views)} views, ${t.videos} video${t.videos === 1 ? "" : "s"}, +${t.subs} subscriber${t.subs === 1 ? "" : "s"}`;
  return t.views < MIN_WEEK_VIEWS
    ? `not enough data (${of})`
    : `**${per1k(t).toFixed(1)}** (${of})`;
}

function change(a?: FormatTally, b?: FormatTally): string {
  if (!b || b.views < MIN_WEEK_VIEWS) return "last week: not enough data";
  const last = `last week ${per1k(b).toFixed(1)}`;
  if (!a || a.views < MIN_WEEK_VIEWS) return last;
  const d = per1k(a) - per1k(b);
  return `${last}, ${Math.abs(d) < 0.05 ? "level" : d > 0 ? `up ${d.toFixed(1)}` : `down ${(-d).toFixed(1)}`}`;
}

/** The one-line call from 28 days of numbers, or a plain "not enough data". */
export function backThis(month: Map<GrowthFormat, FormatTally>): string {
  const ready = [...month.entries()]
    .filter(([f, t]) => f !== "other" && t.views >= BACK_MIN_VIEWS)
    .sort((a, b) => per1k(b[1]) - per1k(a[1]));
  const [top, next] = ready;
  const none =
    "Back this: not enough data yet to call one format over the others, so hold the mix.";
  if (!top) return none;
  const [format, t] = top;
  if (t.videos < BACK_MIN_VIDEOS || t.subs < BACK_MIN_SUBS) return none;
  if (next && per1k(t) < BACK_LEAD * per1k(next[1])) return none;
  const lead = next
    ? `, against ${per1k(next[1]).toFixed(1)} for ${NAMES[next[0]]}, the next best`
    : "";
  const early =
    t.subs < 10
      ? ` Early: that is only ${t.subs} subscribers, so lean, do not bet the mix.`
      : "";
  return `Back this: **${NAMES[format]}**, ${per1k(t).toFixed(1)} subscribers per 1,000 views over 28 days${lead}.${early}`;
}

/** The report's lines (pure), for the embed and for the tests. */
export function growthLines(rows: GrowthRow[], now: Date): string[] {
  const t = now.getTime();
  const day = 86_400_000;
  const week = tally(rows, t - 7 * day, t);
  const before = tally(rows, t - 14 * day, t - 7 * day);
  const month = tally(rows, t - 28 * day, t);
  const formats: GrowthFormat[] = [
    "news",
    "why",
    "ranking",
    "doc",
    "explainer",
    "other",
  ];
  const shown = formats.filter(
    (f) => f !== "other" || week.has(f) || before.has(f),
  );
  return [
    "**Subscribers per 1,000 views, by format.** Videos whose numbers came in this week.",
    ...shown.map(
      (f) =>
        `• ${NAMES[f]}: ${reading(week.get(f))}; ${change(week.get(f), before.get(f))}`,
    ),
    "",
    backThis(month),
    "",
    "Each video's first days as YouTube Analytics reported them from day four, subscribers gained before any losses. Long videos keep earning after that, so treat documentaries as a floor.",
  ];
}

/** The rows on file: one per video, from the "retention" row. */
export async function growthRows(db: Db): Promise<GrowthRow[]> {
  const rows = await db.query<{
    lane: string;
    story_hash: string | null;
    script_json: any;
    raw: any;
    captured_at: string | Date;
  }>(
    `SELECT e.lane, e.story_hash, e.script_json, m.raw, m.captured_at
       FROM video_metrics m JOIN episodes e ON e.id = m.episode_id
      WHERE m.label = 'retention' AND e.lane <> 'twin'`,
  );
  return rows.map((r) => {
    const raw = typeof r.raw === "string" ? JSON.parse(r.raw) : r.raw;
    const sc = r.script_json ?? {};
    return {
      format: growthFormat({
        lane: r.lane,
        story_hash: r.story_hash,
        evergreen_format: sc.evergreen_format,
        explained: sc.explained,
        recap: sc.recap,
      }),
      views: Number(raw?.views ?? 0),
      subs: Number(raw?.subscribersGained ?? 0),
      at: new Date(r.captured_at).getTime(),
    };
  });
}

/** The Discord message. */
export async function growthReport(
  db: Db,
  cfg: Pick<Config, "timezone">,
  now: Date,
): Promise<DiscordMessage> {
  return {
    embeds: [
      {
        title: `🌱 Pulse growth report, week to ${new Intl.DateTimeFormat("en-GB", { timeZone: cfg.timezone, day: "numeric", month: "short" }).format(now)}`,
        description: growthLines(await growthRows(db), now)
          .join("\n")
          .slice(0, 3900),
        color: 0xff6b1a,
      },
    ],
  };
}

const REPORT_HOUR = 10;

/** True once a week: Sunday from 10:00 local, until that Sunday's report is recorded. */
export async function growthReportDue(
  db: Db,
  cfg: Pick<Config, "growthReport" | "timezone">,
  now: Date,
): Promise<string | undefined> {
  if (!cfg.growthReport || weekday(now, cfg.timezone) !== "sun")
    return undefined;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: cfg.timezone,
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
  if (hour < REPORT_HOUR) return undefined;
  const key = dayKey(now, cfg.timezone);
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'growth_report_sent'`,
  );
  return row?.value === key ? undefined : key;
}

export async function markGrowthReportSent(db: Db, key: string): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('growth_report_sent', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key],
  );
}

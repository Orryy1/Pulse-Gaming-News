// The daily alert digest (owner, 4 Nov 2026): what the factory has been complaining about, so a fault that keeps coming
// back gets fixed instead of scrolling away. It reads only the ledger (src/alertlog.ts) and spends nothing: counts per
// kind for the last 24 hours and 7 days, rising or falling, the worst video per kind, and repeats of one fault. It is
// written to data/logs/alert_digest.md every day and posted only when a kind is new or rising, so a quiet day adds no
// noise to the channel. Routine "uploaded/live" messages are left out. ALERT_DIGEST turns it on.
import fs from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import type { DiscordMessage } from "./approval/discord.ts";
import { OTHER, ROUTINE, readAlerts, type AlertRecord } from "./alertlog.ts";
import { dayKey } from "./lanes.ts";

export type Trend = "new" | "rising" | "steady" | "falling";

export interface KindRow {
  kind: string;
  day: number;
  week: number;
  trend: Trend;
  /** The video with the most of this kind in the 7 days, once one stands out: more than one, or the only one. */
  worst?: { name: string; count: number };
}

export interface Repeat {
  fault: string;
  kind: string;
  count: number;
  videos: number;
}

const DAY = 24 * 3_600_000;
/** One fault seen this often in the 7 days is a pattern worth a line. */
export const REPEAT_MIN = 3;
const REPORT_HOUR = 9;
/** Kinds that report a measure rather than name a fault: their count already says it all. */
const MEASURES = new Set([
  "sentence_matching",
  "short_of_pictures",
  "no_beats",
]);

/** Is the last day out of line with the six before it? One more of a rare kind is not a trend (pure). */
export function trendOf(day: number, week: number): Trend {
  const earlier = week - day;
  if (day > 0 && earlier === 0) return "new";
  const perDay = earlier / 6;
  if (day >= 2 && day > perDay * 1.5) return "rising";
  if (day < perDay * 0.5) return "falling";
  return "steady";
}

/** Counts, trends and the worst video for each kind (pure). Routine messages are not in it. */
export function kindRows(records: AlertRecord[], now: Date): KindRow[] {
  const end = now.getTime();
  const rows = new Map<
    string,
    { day: number; week: number; by: Map<string, number> }
  >();
  for (const r of records) {
    const at = Date.parse(r.t);
    if (r.kind === ROUTINE || !(at > end - 7 * DAY && at <= end)) continue;
    const row = rows.get(r.kind) ?? { day: 0, week: 0, by: new Map() };
    row.week++;
    if (at > end - DAY) row.day++;
    const name = r.title ?? r.episode;
    if (name) row.by.set(name, (row.by.get(name) ?? 0) + 1);
    rows.set(r.kind, row);
  }
  return [...rows]
    .map(([kind, { day, week, by }]) => {
      const [top] = [...by].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      );
      return {
        kind,
        day,
        week,
        trend: trendOf(day, week),
        ...(top && (top[1] > 1 || week === 1)
          ? { worst: { name: top[0], count: top[1] } }
          : {}),
      };
    })
    .sort(
      (a, b) =>
        b.day - a.day || b.week - a.week || a.kind.localeCompare(b.kind),
    );
}

/**
 * The separate faults in one alert, in a form that matches across videos: the video's title and its place in the
 * narration go, so `0:09 "2nd," came out as "Second,"` is the same fault wherever it turns up (pure).
 */
export function faultsIn(r: AlertRecord): string[] {
  let text = r.text;
  if (r.title) text = text.split(`"${r.title}"`).join("");
  // What follows the notice's own opening: "... goes ahead: A; B" or a boot check's lines.
  const colon = text.search(/:\s/);
  const body =
    colon >= 0 && colon < 120 ? text.slice(colon + 1).trim() : text.trim();
  const out = new Set<string>();
  for (const piece of body.split(/;\s+|\n/)) {
    // Figures outside the quotes are this video's (levels, seconds, addresses); inside them they are the fault.
    const f = piece
      .replace(/\b\d+:\d\d(?::\d\d)?\b/g, "")
      .split('"')
      .map((part, k) => (k % 2 ? part : part.replace(/\d+(?:\.\d+)*/g, "#")))
      .join('"')
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .slice(0, 140);
    if (f.length >= 8) out.add(f);
  }
  return [...out];
}

/** One fault coming back within the 7 days, most often first (pure). */
export function repeatsOf(records: AlertRecord[], now: Date): Repeat[] {
  const end = now.getTime();
  const seen = new Map<
    string,
    { kind: string; count: number; videos: Set<string> }
  >();
  for (const r of records) {
    const at = Date.parse(r.t);
    if (
      r.kind === ROUTINE ||
      r.kind === OTHER ||
      MEASURES.has(r.kind) ||
      !(at > end - 7 * DAY && at <= end)
    )
      continue;
    for (const fault of faultsIn(r)) {
      const key = `${r.kind}\n${fault}`;
      const e = seen.get(key) ?? {
        kind: r.kind,
        count: 0,
        videos: new Set<string>(),
      };
      e.count++;
      const name = r.title ?? r.episode;
      if (name) e.videos.add(name);
      seen.set(key, e);
    }
  }
  return [...seen]
    .filter(([, e]) => e.count >= REPEAT_MIN)
    .map(([key, e]) => ({
      fault: key.slice(key.indexOf("\n") + 1),
      kind: e.kind,
      count: e.count,
      videos: e.videos.size,
    }))
    .sort((a, b) => b.count - a.count || a.fault.localeCompare(b.fault));
}

/** The digest as a page (pure). */
export function digestMarkdown(records: AlertRecord[], now: Date): string {
  const rows = kindRows(records, now);
  const repeats = repeatsOf(records, now);
  const lines = [
    `# Alert digest, ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    "From data/logs/alerts.jsonl. Routine uploaded and live messages are left out.",
    "",
  ];
  if (!rows.length) lines.push("No alerts in the last 7 days.");
  else {
    lines.push(
      "| Kind | Last 24 h | Last 7 days | Trend | Worst video |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const r of rows)
      lines.push(
        `| ${r.kind} | ${r.day} | ${r.week} | ${r.trend} | ${r.worst ? `${r.worst.name.replace(/\|/g, "/")} (${r.worst.count})` : ""} |`,
      );
  }
  if (repeats.length) {
    lines.push("", `## One fault ${REPEAT_MIN} or more times in 7 days`, "");
    for (const r of repeats)
      lines.push(
        `- ${r.count}x (${r.kind}${r.videos > 1 ? `, ${r.videos} videos` : ""}): ${r.fault}`,
      );
  }
  return `${lines.join("\n")}\n`;
}

/** The channel's message: only for a kind that is new or rising, and nothing on a day without one (pure). */
export function digestPost(
  records: AlertRecord[],
  now: Date,
): DiscordMessage | undefined {
  const moved = kindRows(records, now).filter(
    (r) => r.kind !== OTHER && (r.trend === "new" || r.trend === "rising"),
  );
  if (!moved.length) return undefined;
  const repeats = repeatsOf(records, now);
  const lines = [
    `📋 Alert digest: ${moved.length} kind${moved.length === 1 ? "" : "s"} of alert new or rising.`,
    ...moved.map(
      (r) =>
        `- ${r.kind} is ${r.trend}: ${r.day} in 24 hours, ${r.week} in 7 days${r.worst ? `; worst "${r.worst.name}" (${r.worst.count})` : ""}`,
    ),
    ...(repeats.length
      ? [
          "Keeps coming back:",
          ...repeats
            .slice(0, 5)
            .map((r) => `- ${r.count}x (${r.kind}): ${r.fault}`),
        ]
      : []),
    "Full digest: data/logs/alert_digest.md",
  ];
  return { content: lines.join("\n").slice(0, 1900) };
}

const ledgerFile = (cfg: Pick<Config, "dataDir">) =>
  path.join(cfg.dataDir, "logs", "alerts.jsonl");

/** Writes today's page; what comes back is the message to post, if the day earned one. */
export async function writeAlertDigest(
  cfg: Pick<Config, "dataDir">,
  now: Date,
  /** Summary lines from elsewhere (the graphics audit's day, src/gfxauditstep.ts graphicsDigest): on the page, and on a post the day already earns. */
  extra: string[] = [],
): Promise<DiscordMessage | undefined> {
  const records = await readAlerts(ledgerFile(cfg));
  const file = path.join(cfg.dataDir, "logs", "alert_digest.md");
  await fs.mkdir(path.dirname(file), { recursive: true });
  const page = digestMarkdown(records, now);
  await fs.writeFile(file, extra.length ? `${page}\n${extra.map((x) => `- ${x}`).join("\n")}\n` : page, "utf8");
  const post = digestPost(records, now);
  return post && extra.length
    ? { ...post, content: `${post.content}\n${extra.join("\n")}`.slice(0, 1900) }
    : post;
}

/** Today's key once the digest is due: from 09:00 local, once a day, only with the setting on. */
export async function alertDigestDue(
  db: Db,
  cfg: Pick<Config, "alertDigest" | "timezone">,
  now: Date,
): Promise<string | undefined> {
  if (!cfg.alertDigest) return undefined;
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
    `SELECT value FROM settings WHERE key = 'alert_digest_sent'`,
  );
  return row?.value === key ? undefined : key;
}

export async function markAlertDigestSent(db: Db, key: string): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('alert_digest_sent', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key],
  );
}

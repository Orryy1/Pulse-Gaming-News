// The first feedback loop. Every published Short's public numbers are
// captured at fixed ages, the editor sees how recent Shorts did when it
// picks the next story (advice, never a rule), and a Monday digest tells the
// owner what worked, including which narrator voice is sticking.

import type { Db } from "./db.ts";
import type { Config } from "./config.ts";
import type { Episode } from "./episodes.ts";
import { logEvent } from "./episodes.ts";
import { QUOTA, dayKey, quotaAdd, quotaUsed, weekday } from "./lanes.ts";
import type { DiscordMessage } from "./approval/discord.ts";
import { log } from "./lib/util.ts";

/** Ages at which a Short's numbers are read, and the window in which a late capture still counts. */
export const CAPTURE_LABELS: ReadonlyArray<{ label: string; hours: number }> = [
  { label: "1h", hours: 1 },
  { label: "3h", hours: 3 },
  { label: "24h", hours: 24 },
  { label: "72h", hours: 72 },
  { label: "7d", hours: 168 },
  { label: "28d", hours: 672 },
];

export interface VideoStats {
  views: number;
  likes: number;
  comments: number;
  privacyStatus: string;
}

export interface StatsSource {
  stats(videoIds: string[]): Promise<Map<string, VideoStats>>;
}

export interface Capture {
  episodeId: string;
  videoId: string;
  label: string;
}

/** A label is due once the Short is old enough and not yet captured; a capture missed by more than half its age is skipped, never back-filled with today's number. */
export function labelsDue(
  liveAt: Date,
  now: Date,
  have: Set<string>,
): string[] {
  const hours = (now.getTime() - liveAt.getTime()) / 3_600_000;
  return CAPTURE_LABELS.filter(
    (l) => !have.has(l.label) && hours >= l.hours && hours <= l.hours * 1.5 + 1,
  ).map((l) => l.label);
}

export async function dueCaptures(db: Db, now: Date): Promise<Capture[]> {
  const eps = await db.query<{
    id: string;
    youtube_video_id: string;
    live_at: string;
  }>(
    `SELECT id, youtube_video_id, coalesce(publish_at, updated_at) AS live_at FROM episodes
     WHERE status = 'published' AND youtube_video_id IS NOT NULL AND coalesce(publish_at, updated_at) > $1`,
    [new Date(now.getTime() - 40 * 24 * 3_600_000)],
  );
  if (!eps.length) return [];
  const have = new Map<string, Set<string>>();
  for (const m of await db.query<{ episode_id: string; label: string }>(
    `SELECT episode_id, label FROM video_metrics WHERE captured_at > $1`,
    [new Date(now.getTime() - 45 * 24 * 3_600_000)],
  )) {
    if (!have.has(m.episode_id)) have.set(m.episode_id, new Set());
    have.get(m.episode_id)!.add(m.label);
  }
  const out: Capture[] = [];
  for (const e of eps) {
    for (const label of labelsDue(
      new Date(e.live_at),
      now,
      have.get(e.id) ?? new Set(),
    ))
      out.push({ episodeId: e.id, videoId: e.youtube_video_id, label });
  }
  return out;
}

/** Reads every due number in as few videos.list calls as possible (fifty ids per unit). */
export async function captureMetrics(
  db: Db,
  youtube: StatsSource,
  now: Date,
): Promise<number> {
  const due = await dueCaptures(db, now);
  if (!due.length) return 0;
  const ids = [...new Set(due.map((d) => d.videoId))];
  const stats = new Map<string, VideoStats>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    for (const [k, v] of await youtube.stats(chunk)) stats.set(k, v);
    await quotaAdd(db, now, QUOTA.poll);
  }
  let n = 0;
  for (const d of due) {
    const s = stats.get(d.videoId);
    if (!s) continue;
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, captured_at, views, likes, comments, raw) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (episode_id, label) DO NOTHING`,
      [
        d.episodeId,
        d.label,
        now,
        s.views,
        s.likes,
        s.comments,
        JSON.stringify(s),
      ],
    );
    await logEvent(db, d.episodeId, "metrics", {
      label: d.label,
      views: s.views,
      likes: s.likes,
      comments: s.comments,
    });
    n++;
  }
  log("info", "metrics captured", { captures: n, videos: ids.length });
  return n;
}

interface PerfRow {
  id: string;
  lane: string;
  label: string;
  views: number | string;
  likes: number | string;
  comments: number | string;
  script_json: Episode["script_json"];
  voice: string | null;
}

async function perfRows(
  db: Db,
  since: Date,
  label: string,
): Promise<PerfRow[]> {
  return db.query<PerfRow>(
    `SELECT e.id, e.lane, m.label, m.views, m.likes, m.comments, e.script_json,
            (SELECT detail->>'name' FROM events v WHERE v.episode_id = e.id AND v.kind = 'voice' ORDER BY v.id DESC LIMIT 1) AS voice
     FROM video_metrics m JOIN episodes e ON e.id = m.episode_id
     WHERE m.label = $1 AND m.captured_at > $2 ORDER BY m.views DESC, m.captured_at DESC`,
    [label, since],
  );
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

const describe = (r: PerfRow): string => {
  const sc = r.script_json;
  const title = sc?.youtube?.title ?? sc?.headline ?? r.id;
  const bits = [
    sc?.story_type,
    sc?.game_title,
    r.lane,
    r.voice ? `voice ${r.voice}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return `"${title}" (${bits}): ${Number(r.views).toLocaleString("en-US")} views`;
};

/**
 * What the editor is told about recent results when it picks the next story.
 * Views 24 h after publish over the last 28 days; empty until four Shorts have
 * that number, so nothing is learned from noise.
 */
export async function performanceNotes(db: Db, now: Date): Promise<string> {
  const rows = await perfRows(
    db,
    new Date(now.getTime() - 28 * 24 * 3_600_000),
    "24h",
  );
  if (rows.length < 4) return "";
  const med = median(rows.map((r) => Number(r.views)));
  const top = rows.slice(0, 5).map((r) => `- ${describe(r)}`);
  const bottom = rows
    .slice(-5)
    .reverse()
    .map((r) => `- ${describe(r)}`);
  return [
    `Recent results (views 24 h after publish, last 28 days, median ${med.toLocaleString("en-US")}). Advice, not rules: a strong story on an under-performing pattern still wins.`,
    "Did best:",
    ...top,
    "Did worst:",
    ...bottom,
  ].join("\n");
}

/** Monday morning: the week in numbers, and which voices are sticking. */
export async function weeklyDigest(
  db: Db,
  cfg: Config,
  now: Date,
): Promise<DiscordMessage> {
  const week = new Date(now.getTime() - 7 * 24 * 3_600_000);
  const month = new Date(now.getTime() - 28 * 24 * 3_600_000);
  const lanes = await db.query<{ lane: string; n: string | number }>(
    `SELECT lane, count(*) AS n FROM episodes WHERE status = 'published' AND updated_at > $1 GROUP BY lane ORDER BY lane`,
    [week],
  );
  const fails = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes WHERE status = 'failed' AND updated_at > $1`,
    [week],
  );
  const weekRows = await perfRows(db, week, "24h");
  const monthRows = await perfRows(db, month, "24h");
  const byVoice = new Map<string, number[]>();
  for (const r of monthRows) {
    const k = r.voice ?? "unknown";
    if (!byVoice.has(k)) byVoice.set(k, []);
    byVoice.get(k)!.push(Number(r.views));
  }
  const voices = [...byVoice.entries()]
    .map(([name, v]) => ({ name, n: v.length, med: median(v) }))
    .sort((a, b) => b.med - a.med);
  const lines = [
    `**Published this week:** ${lanes.length ? lanes.map((l) => `${l.lane} ${l.n}`).join(" · ") : "nothing"}${Number(fails[0]?.n ?? 0) ? ` · failed ${fails[0]!.n}` : ""}`,
    weekRows.length
      ? `**Median views at 24 h:** ${median(weekRows.map((r) => Number(r.views))).toLocaleString("en-US")} (${weekRows.length} Shorts)`
      : "**Views at 24 h:** none captured yet",
    ...(weekRows.length
      ? ["**Best:**", ...weekRows.slice(0, 3).map((r) => `• ${describe(r)}`)]
      : []),
    ...(weekRows.length > 3
      ? [
          "**Weakest:**",
          ...weekRows
            .slice(-3)
            .reverse()
            .map((r) => `• ${describe(r)}`),
        ]
      : []),
    ...(voices.length
      ? [
          "**Voices (median 24 h views, last 28 days):**",
          ...voices.map(
            (v) => `• ${v.name}: ${v.med.toLocaleString("en-US")} over ${v.n}`,
          ),
        ]
      : []),
    `**YouTube quota used today:** ${(await quotaUsed(db, now)).toLocaleString("en-US")} of ${cfg.quotaUnitsPerDay.toLocaleString("en-US")}`,
    "Reminders: check Studio for Content ID claims on anything over 60 s; the retention curve arrives once analytics is reconnected.",
  ];
  return {
    embeds: [
      {
        title: `📈 Pulse Factory week to ${dayKey(now, cfg.timezone)}`,
        description: lines.join("\n").slice(0, 3900),
        color: 0xff6b1a,
      },
    ],
  };
}

/** True once a week: Monday from 09:00 local, until the digest for that Monday is recorded. */
export async function digestDue(
  db: Db,
  cfg: Config,
  now: Date,
): Promise<string | undefined> {
  if (weekday(now, cfg.timezone) !== "mon") return undefined;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: cfg.timezone,
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
  if (hour < 9) return undefined;
  const key = dayKey(now, cfg.timezone);
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'digest_sent'`,
  );
  return row?.value === key ? undefined : key;
}

export async function markDigestSent(db: Db, key: string): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('digest_sent', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key],
  );
}

export interface RetentionSource {
  retention(
    videoIds: string[],
    start: string,
    end: string,
  ): Promise<Map<string, { views: number; avgViewSeconds: number; avgViewPercent: number; subscribersGained: number; engagedViews?: number }>>;
}

/**
 * Once a Short is four days old (Analytics lags about two), record how much of
 * it people watched and the subscribers it brought: one "retention" row each.
 */
export async function captureRetention(db: Db, yt: RetentionSource, now: Date): Promise<number> {
  const eps = await db.query<{ id: string; youtube_video_id: string; live_at: string }>(
    `SELECT e.id, e.youtube_video_id, coalesce(e.publish_at, e.updated_at) AS live_at FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL
        AND coalesce(e.publish_at, e.updated_at) < $1::timestamptz - interval '4 days'
        AND coalesce(e.publish_at, e.updated_at) > $1::timestamptz - interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM video_metrics m WHERE m.episode_id = e.id AND m.label = 'retention')
      LIMIT 100`,
    [now],
  );
  if (!eps.length) return 0;
  const start = new Date(Math.min(...eps.map((e) => new Date(e.live_at).getTime()))).toISOString().slice(0, 10);
  const end = now.toISOString().slice(0, 10);
  const got = await yt.retention(eps.map((e) => e.youtube_video_id), start, end);
  let n = 0;
  for (const e of eps) {
    const r = got.get(e.youtube_video_id);
    if (!r) continue;
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, captured_at, views, likes, comments, raw) VALUES ($1, 'retention', $2, $3, 0, 0, $4)
       ON CONFLICT (episode_id, label) DO NOTHING`,
      [e.id, now, r.views, JSON.stringify(r)],
    );
    n++;
  }
  log("info", "retention captured", { videos: n });
  return n;
}

interface RetentionRow {
  id: string;
  script_json: Episode["script_json"];
  raw: { avgViewPercent: number; subscribersGained: number; views: number; engagedViews?: number } | string;
}

async function retentionRows(db: Db, now: Date): Promise<Array<{ title: string; hook: string; pct: number; subs: number; views: number; stay?: number }>> {
  const rows = await db.query<RetentionRow>(
    `SELECT e.id, e.script_json, m.raw FROM video_metrics m JOIN episodes e ON e.id = m.episode_id
      WHERE m.label = 'retention' AND m.captured_at > $1::timestamptz - interval '45 days'`,
    [now],
  );
  return rows
    .map((r) => {
      const raw = typeof r.raw === "string" ? JSON.parse(r.raw) : r.raw;
      return {
        title: r.script_json?.youtube?.title ?? r.id,
        hook: r.script_json?.hook ?? "",
        pct: Number(raw?.avgViewPercent ?? 0),
        subs: Number(raw?.subscribersGained ?? 0),
        views: Number(raw?.views ?? 0),
        // Share of viewers who stayed to watch rather than swiping away: on our channel it tracks reach, % watched does not.
        stay: raw?.engagedViews && Number(raw?.views) > 0 ? (100 * Number(raw.engagedViews)) / Number(raw.views) : undefined,
      };
    })
    .filter((r) => r.views >= 20)
    .sort((a, b) => (b.stay ?? b.pct) - (a.stay ?? a.pct));
}

/** For the editor: which Shorts people watched to the end and which they swiped away from. */
export async function retentionNotes(db: Db, now: Date): Promise<string> {
  const rows = await retentionRows(db, now);
  if (rows.length < 4) return "";
  const line = (r: (typeof rows)[number]) =>
    `- "${r.title}": ${r.stay !== undefined ? `${Math.round(r.stay)}% stayed to watch, ` : ""}${Math.round(r.pct)}% watched on average, ${r.subs >= 0 ? "+" : ""}${r.subs} subscribers`;
  return [
    "How each Short held its viewers (YouTube Analytics, last 45 days; ranked by the share who stayed to watch instead of swiping away). Stories like the best held ones keep viewers; advice, not rules:",
    "Held best:",
    ...rows.slice(0, 4).map(line),
    "Held worst:",
    ...rows.slice(-3).reverse().map(line),
  ].join("\n");
}

/** For the writer: the opening lines that held viewers best, as patterns to learn from (never to copy). */
export async function hookLessons(db: Db, now: Date): Promise<string> {
  const rows = (await retentionRows(db, now)).filter((r) => r.hook);
  if (rows.length < 4) return "";
  return [
    "Openings that held our viewers best (share who stayed to watch instead of swiping away). Learn the pattern, never reuse the words:",
    ...rows.slice(0, 3).map((r) => `- ${Math.round(r.stay ?? r.pct)}%: "${r.hook}"`),
    "Openings that lost them:",
    ...rows.slice(-2).map((r) => `- ${Math.round(r.stay ?? r.pct)}%: "${r.hook}"`),
  ].join("\n");
}

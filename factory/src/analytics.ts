// The first feedback loop. Every published Short's public numbers are
// captured at fixed ages, the editor sees how recent Shorts did when it
// picks the next story (advice, never a rule), and a Monday digest tells the
// owner what worked, including which narrator voice is sticking.

import type { Db } from "./db.ts";
import type { Config } from "./config.ts";
import type { Episode } from "./episodes.ts";
import { logEvent } from "./episodes.ts";
import { QUOTA, dayKey, quotaAdd, quotaCalls, quotaUsed, weekday } from "./lanes.ts";
import { reviewFormats } from "./formats.ts";
import { claudeSpend } from "./editorial/llm.ts";
import type { DiscordMessage } from "./approval/discord.ts";
import { log } from "./lib/util.ts";

/** Ages at which a Short's numbers are read, and the window in which a late capture still counts. */
/**
 * When a video actually went public, as SQL: the time the go-live check saw it public, else the planned
 * slot, else the last update. Snapshot ages and the site's dates count from this.
 */
export const LIVE_AT = (t: string) =>
  `coalesce((SELECT (v.detail->>'at')::timestamptz FROM events v WHERE v.episode_id = ${t}.id AND v.kind = 'public_confirmed' AND v.detail ? 'at' LIMIT 1), ${t}.publish_at, ${t}.updated_at)`;

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

export async function dueCaptures(db: Db, now: Date,
  account = ""): Promise<Capture[]> {
  const eps = await db.query<{
    id: string;
    youtube_video_id: string;
    live_at: string;
  }>(
    `SELECT id, youtube_video_id, ${LIVE_AT("episodes")} AS live_at FROM episodes
     WHERE status = 'published' AND youtube_video_id IS NOT NULL AND ${LIVE_AT("episodes")} > $1
       AND COALESCE(story_json->'twin'->>'account', '') = $2`,
    [new Date(now.getTime() - 40 * 24 * 3_600_000), account],
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
  account = "",
): Promise<number> {
  const due = await dueCaptures(db, now, account);
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
    ...((formats) =>
      formats.length
        ? [
            "**Formats (median views at 24 h vs news; under 40% after six videos pauses a format for four weeks):**",
            ...formats,
          ]
        : [])(await reviewFormats(db, now)),
    `**YouTube quota used today:** ${(await quotaUsed(db, now)).toLocaleString("en-US")} of ${cfg.quotaUnitsPerDay.toLocaleString("en-US")} units; uploads ${await quotaCalls(db, now, "upload")} of ${cfg.uploadCallsPerDay}`,
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
  ): Promise<
    Map<
      string,
      {
        views: number;
        avgViewSeconds: number;
        avgViewPercent: number;
        subscribersGained: number;
        engagedViews?: number;
      }
    >
  >;
  /** A long video's retention curve (optional: only the live YouTube client has it). */
  retentionCurve?(
    videoId: string,
    start: string,
    end: string,
  ): Promise<Array<{ at: number; watch: number; relative: number }>>;
}

/**
 * Once a Short is four days old (Analytics lags about two), record how much of
 * it people watched and the subscribers it brought: one "retention" row each.
 */
export async function captureRetention(
  db: Db,
  yt: RetentionSource,
  now: Date,
  account = "",
): Promise<number> {
  const eps = await db.query<{
    id: string;
    youtube_video_id: string;
    live_at: string;
  }>(
    `SELECT e.id, e.youtube_video_id, ${LIVE_AT("e")} AS live_at FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL
        AND ${LIVE_AT("e")} < $1::timestamptz - interval '4 days'
        AND ${LIVE_AT("e")} > $1::timestamptz - interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM video_metrics m WHERE m.episode_id = e.id AND m.label = 'retention')
        AND COALESCE(e.story_json->'twin'->>'account', '') = $2
      LIMIT 100`,
    [now, account],
  );
  if (!eps.length) return 0;
  const start = new Date(
    Math.min(...eps.map((e) => new Date(e.live_at).getTime())),
  )
    .toISOString()
    .slice(0, 10);
  const end = now.toISOString().slice(0, 10);
  const got = await yt.retention(
    eps.map((e) => e.youtube_video_id),
    start,
    end,
  );
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
  lane?: string;
  metrics?: unknown;
  script_json: Episode["script_json"];
  raw:
    | {
        avgViewPercent: number;
        subscribersGained: number;
        views: number;
        engagedViews?: number;
      }
    | string;
  opening?: string | null;
}

async function retentionRows(
  db: Db,
  now: Date,
): Promise<
  Array<{
    title: string;
    hook: string;
    pct: number;
    subs: number;
    views: number;
    stay?: number;
    opening?: string;
    hookWords?: number;
    footageShare?: number;
    format?: string;
  }>
> {
  const rows = await db.query<RetentionRow>(
    `SELECT e.id, e.lane, e.script_json, m.raw, e.assets_json->'plan'->'shots'->0->'media'->>'type' AS opening, e.qa_json->'rubric'->'metrics' AS metrics
       FROM video_metrics m JOIN episodes e ON e.id = m.episode_id
      WHERE m.label = 'retention' AND m.captured_at > $1::timestamptz - interval '45 days' AND e.lane <> 'twin'`,
    [now],
  );
  return rows
    .map((r) => {
      const raw = typeof r.raw === "string" ? JSON.parse(r.raw) : r.raw;
      const metrics = (typeof r.metrics === "string" ? JSON.parse(r.metrics) : r.metrics) as Array<{ name: string; value: number | string }> | null;
      const metric = (name: string) => {
        const v = metrics?.find((m) => m.name === name)?.value;
        return typeof v === "number" ? v : undefined;
      };
      return {
        title: r.script_json?.youtube?.title ?? r.id,
        hook: r.script_json?.hook ?? "",
        hookWords: r.script_json?.hook ? r.script_json.hook.split(/\s+/).filter(Boolean).length : undefined,
        footageShare: metric("footage_share"),
        format: r.script_json?.evergreen_format ?? (r.script_json?.runtime === "long" ? "long" : r.lane ?? "news"),
        pct: Number(raw?.avgViewPercent ?? 0),
        subs: Number(raw?.subscribersGained ?? 0),
        views: Number(raw?.views ?? 0),
        // Share of viewers who stayed to watch rather than swiping away: on our channel it tracks reach, % watched does not.
        stay:
          raw?.engagedViews && Number(raw?.views) > 0
            ? (100 * Number(raw.engagedViews)) / Number(raw.views)
            : undefined,
        opening: r.opening ?? undefined,
      };
    })
    .filter((r) => r.views >= 20)
    .sort((a, b) => (b.stay ?? b.pct) - (a.stay ?? a.pct));
}

/** Whether opening on moving footage keeps more viewers than opening on a still, once each has three Shorts. */
export function openingLine(
  rows: Array<{ stay?: number; opening?: string }>,
): string[] {
  const avg = (kind: string) => {
    const xs = rows
      .filter((r) => r.opening === kind && r.stay !== undefined)
      .map((r) => r.stay!);
    return xs.length >= 3
      ? { n: xs.length, v: xs.reduce((a, b) => a + b, 0) / xs.length }
      : undefined;
  };
  const clip = avg("clip");
  const still = avg("image");
  if (!clip || !still) return [];
  return [
    `Openings: Shorts that opened on moving footage kept ${Math.round(clip.v)}% (${clip.n} Shorts); on a still picture ${Math.round(still.v)}% (${still.n} Shorts).`,
  ];
}

/**
 * What the numbers say about how we make Shorts, one comparison per line, only once each side has three
 * Shorts: short against long hooks, footage-led against card-led, and each format against the rest.
 * Advice for the editor and the writer, never a rule: the samples are small and the metric is a proxy.
 */
export function formatLessons(
  rows: Array<{ stay?: number; pct: number; hookWords?: number; footageShare?: number; format?: string }>,
): string[] {
  const score = (r: (typeof rows)[number]) => r.stay ?? r.pct;
  const avg = (xs: typeof rows) =>
    xs.length >= 3 ? { n: xs.length, v: xs.reduce((a, r) => a + score(r), 0) / xs.length } : undefined;
  const line = (what: string, a: { n: number; v: number }, aName: string, b: { n: number; v: number }, bName: string) =>
    `${what}: ${aName} kept ${Math.round(a.v)}% (${a.n} Shorts), ${bName} ${Math.round(b.v)}% (${b.n} Shorts).`;
  const out: string[] = [];
  const shortHook = avg(rows.filter((r) => r.hookWords !== undefined && r.hookWords <= 10));
  const longHook = avg(rows.filter((r) => r.hookWords !== undefined && r.hookWords > 10));
  if (shortHook && longHook) out.push(line("Hooks", shortHook, "ten words or fewer", longHook, "longer"));
  const footage = avg(rows.filter((r) => r.footageShare !== undefined && r.footageShare >= 0.4));
  const cards = avg(rows.filter((r) => r.footageShare !== undefined && r.footageShare < 0.4));
  if (footage && cards) out.push(line("Picture", footage, "mostly moving footage", cards, "mostly stills and cards"));
  const formats = [...new Set(rows.map((r) => r.format).filter((f): f is string => !!f))];
  for (const f of formats) {
    const mine = avg(rows.filter((r) => r.format === f));
    const rest = avg(rows.filter((r) => r.format !== f));
    if (mine && rest && Math.abs(mine.v - rest.v) >= 5) out.push(line("Format", mine, f.replace(/_/g, " "), rest, "everything else"));
  }
  return out;
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
    ...openingLine(rows),
    ...formatLessons(rows),
  ].join("\n");
}

/** For the writer: the opening lines that held viewers best, as patterns to learn from (never to copy). */
export async function hookLessons(db: Db, now: Date): Promise<string> {
  const rows = (await retentionRows(db, now)).filter((r) => r.hook);
  if (rows.length < 4) return "";
  return [
    "Openings that held our viewers best (share who stayed to watch instead of swiping away). Learn the pattern, never reuse the words:",
    ...rows
      .slice(0, 3)
      .map((r) => `- ${Math.round(r.stay ?? r.pct)}%: "${r.hook}"`),
    "Openings that lost them:",
    ...rows
      .slice(-2)
      .map((r) => `- ${Math.round(r.stay ?? r.pct)}%: "${r.hook}"`),
    ...formatLessons(rows),
  ].join("\n");
}

/** The evening summary: what went live today, what is waiting on the owner, and the background news in one message. */
export async function dailySummary(
  db: Db,
  cfg: Config,
  now: Date,
): Promise<DiscordMessage> {
  const since = `date_trunc('day', $1::timestamptz AT TIME ZONE '${cfg.timezone}') AT TIME ZONE '${cfg.timezone}'`;
  const live = await db.query<{
    title: string;
    vid: string;
    runtime: string | null;
  }>(
    `SELECT script_json->'youtube'->>'title' AS title, youtube_video_id AS vid, script_json->>'runtime' AS runtime
       FROM episodes WHERE status = 'published' AND youtube_video_id IS NOT NULL AND updated_at >= ${since} ORDER BY updated_at`,
    [now],
  );
  const [drafts] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM events WHERE kind = 'crosspost' AND detail->>'platform' = 'tiktok' AND detail->>'id' LIKE 'inbox:%' AND created_at >= ${since}`,
    [now],
  );
  const notes = await db.query<{ text: string }>(
    `SELECT detail->>'text' AS text FROM events WHERE kind = 'note' AND created_at >= ${since} ORDER BY id DESC LIMIT 5`,
    [now],
  );
  const used = await quotaUsed(db, now);
  const lines = [
    "📊 **Today on Pulse**",
    live.length
      ? `✅ ${live.length} video${live.length === 1 ? "" : "s"} live:\n${live.map((v) => `• ${v.title} ${v.runtime === "long" ? `https://youtu.be/${v.vid}` : `https://youtube.com/shorts/${v.vid}`}`).join("\n")}`
      : "✅ No new videos today.",
    Number(drafts?.n ?? 0)
      ? `📲 TikTok drafts sent: ${drafts!.n}. Post any still in your TikTok inbox.`
      : "",
    notes.length
      ? `📝 Behind the scenes (handled, nothing for you to do):\n${notes.map((n) => `• ${n.text}`).join("\n")}`
      : "",
    `YouTube allowance used: ${used.toLocaleString("en-US")} of ${cfg.quotaUnitsPerDay.toLocaleString("en-US")} units; uploads ${await quotaCalls(db, now, "upload")} of ${cfg.uploadCallsPerDay}`,
    ((c) =>
      `Claude spend today: $${(c.live + c.tests).toFixed(2)}${c.tests >= 0.01 ? ` (tests $${c.tests.toFixed(2)})` : ""}`)(
      claudeSpend(cfg.dataDir, now.toISOString().slice(0, 10)),
    ),
  ].filter(Boolean);
  return { content: lines.join("\n\n").slice(0, 1990) };
}

/** True once a day after 21:30 local, until the summary is marked sent for that day. */
export async function summaryDue(
  db: Db,
  cfg: Config,
  now: Date,
): Promise<string | undefined> {
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: cfg.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  if (hm < "21:30") return undefined;
  const day = dayKey(now, cfg.timezone);
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'summary_sent'`,
  );
  if (row?.value === day) return undefined;
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('summary_sent', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [day],
  );
  return day;
}

type Curve = Array<{ at: number; watch: number; relative: number }>;

/**
 * Long videos only: the full retention curve a week after going live (one Analytics request each), so the
 * long-form writer can learn which entries held viewers. Stored as a "curve" row.
 */
export async function captureCurves(
  db: Db,
  yt: RetentionSource,
  now: Date,
): Promise<number> {
  if (!yt.retentionCurve) return 0;
  const eps = await db.query<{
    id: string;
    youtube_video_id: string;
    live_at: string;
  }>(
    `SELECT e.id, e.youtube_video_id, ${LIVE_AT("e")} AS live_at FROM episodes e
      WHERE e.status = 'published' AND e.lane = 'longform' AND e.youtube_video_id IS NOT NULL
        AND ${LIVE_AT("e")} < $1::timestamptz - interval '7 days'
        AND ${LIVE_AT("e")} > $1::timestamptz - interval '60 days'
        AND NOT EXISTS (SELECT 1 FROM video_metrics m WHERE m.episode_id = e.id AND m.label = 'curve')
      LIMIT 5`,
    [now],
  );
  let n = 0;
  for (const e of eps) {
    const curve = await yt.retentionCurve(
      e.youtube_video_id,
      new Date(e.live_at).toISOString().slice(0, 10),
      now.toISOString().slice(0, 10),
    );
    if (curve.length < 20) continue; // too few views for a curve yet
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, captured_at, views, likes, comments, raw) VALUES ($1, 'curve', $2, 0, 0, 0, $3)
       ON CONFLICT (episode_id, label) DO NOTHING`,
      [e.id, now, JSON.stringify(curve)],
    );
    n++;
  }
  if (n) log("info", "long-video retention curves captured", { videos: n });
  return n;
}

/** The share of viewers still watching at a point (seconds) of a video, from its curve. */
export function watchAt(
  curve: Curve,
  seconds: number,
  duration: number,
): number {
  if (!curve.length || duration <= 0) return 0;
  const r = Math.min(1, Math.max(0, seconds / duration));
  let best = curve[0]!;
  for (const p of curve)
    if (Math.abs(p.at - r) < Math.abs(best.at - r)) best = p;
  return best.watch;
}

/**
 * How each entry of a long video held its viewers: the share watching as it starts, and how many it lost
 * per minute (as a share of those watching when it began, so late entries are judged fairly).
 */
export function entryHolds(
  curve: Curve,
  starts: number[],
  duration: number,
): Array<{ entry: number; startWatch: number; lossPerMinute: number }> {
  return starts.map((s, k) => {
    const end = starts[k + 1] ?? duration - 6;
    const a = watchAt(curve, s, duration);
    const b = watchAt(curve, end, duration);
    const minutes = Math.max(0.25, (end - s) / 60);
    return {
      entry: k,
      startWatch: a,
      lossPerMinute: a > 0 ? (a - b) / a / minutes : 0,
    };
  });
}

/** For the long-form writer: how our long videos held viewers, entry by entry. Empty until a curve exists. */
export async function longLessons(db: Db, now: Date): Promise<string> {
  const rows = await db.query<{
    id: string;
    script_json: any;
    assets_json: any;
    raw: unknown;
  }>(
    `SELECT e.id, e.script_json, e.assets_json, m.raw FROM video_metrics m JOIN episodes e ON e.id = m.episode_id
      WHERE m.label = 'curve' AND m.captured_at > $1::timestamptz - interval '120 days'`,
    [now],
  );
  const intros: number[] = [];
  const entries: Array<{ game: string; opening: string; loss: number }> = [];
  for (const r of rows) {
    const curve = (
      typeof r.raw === "string" ? JSON.parse(r.raw) : r.raw
    ) as Curve;
    const starts = r.assets_json?.entryStarts as number[] | undefined;
    const duration = Number(r.assets_json?.durationSeconds ?? 0) + 6;
    if (!starts?.length || !duration) continue;
    intros.push(watchAt(curve, starts[0]!, duration));
    const ranked = [...(r.script_json?.entries ?? [])].sort(
      (a: any, b: any) => b.rank - a.rank,
    );
    for (const h of entryHolds(curve, starts, duration)) {
      const e = ranked[h.entry];
      if (!e) continue;
      entries.push({
        game: e.game_title,
        opening: String(e.narration ?? "").split(/(?<=[.!?])\s/)[0] ?? "",
        loss: h.lossPerMinute,
      });
    }
  }
  if (!entries.length) return "";
  entries.sort((a, b) => a.loss - b.loss);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const line = (e: (typeof entries)[number]) =>
    `- ${e.game} (lost ${pct(e.loss)} of its viewers a minute): "${e.opening}"`;
  return [
    `How our long videos held viewers (YouTube retention, ${rows.length} video${rows.length === 1 ? "" : "s"}). Learn the patterns, never reuse the words:`,
    `- Still watching when the first entry begins: ${pct(intros.reduce((a, b) => a + b, 0) / intros.length)} on average.`,
    "Entries that held viewers best:",
    ...entries.slice(0, 3).map(line),
    "Entries that lost them fastest:",
    ...entries.slice(-3).reverse().map(line),
  ].join("\n");
}

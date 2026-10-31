// The first feedback loop. Every published Short's public numbers are
// captured at fixed ages, the editor sees how recent Shorts did when it
// picks the next story (advice, never a rule), and a Monday digest tells the
// owner what worked, including which narrator voice is sticking.

import type { Db } from "./db.ts";
import type { Config } from "./config.ts";
import type { Episode } from "./episodes.ts";
import { logEvent } from "./episodes.ts";
import {
  QUOTA,
  dayKey,
  quotaAdd,
  quotaCalls,
  quotaUsed,
  weekday,
} from "./lanes.ts";
import { reviewFormats } from "./formats.ts";
import { claudeSpend } from "./editorial/llm.ts";
import type { DiscordMessage } from "./approval/discord.ts";
import { log } from "./lib/util.ts";
import { buildSegments, type SegmentInput } from "./render/timeline.ts";
import { momentKeys, momentWindows } from "./render/longplan.ts";
import type { Script } from "./editorial/schema.ts";

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

export async function dueCaptures(
  db: Db,
  now: Date,
  account = "",
): Promise<Capture[]> {
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
    ...((lab) =>
      lab.length
        ? [
            "**The lab (what held viewers, last 45 days; each line needs three Shorts a side):**",
            ...lab.map((l) => `• ${l}`),
          ]
        : [
            "**The lab:** not enough Shorts a side yet to compare hooks, footage or the desk question.",
          ])(
      await retentionRows(db, now)
        .then((rows) => [...openingLine(rows), ...formatLessons(rows)])
        .catch(() => [] as string[]),
    ),
    `**YouTube quota used today:** ${(await quotaUsed(db, now)).toLocaleString("en-US")} of ${cfg.quotaUnitsPerDay.toLocaleString("en-US")} units; uploads ${await quotaCalls(db, now, "upload")} of ${cfg.uploadCallsPerDay}`,
    "Reminders: check Studio for Content ID claims on anything over 60 s; the retention curve arrives once analytics is reconnected.",
  ];
  // The other platforms in an embed of their own, so a long week above never cuts the table in half.
  const social = await socialTable(db, now).catch(() => [] as string[]);
  return {
    embeds: [
      {
        title: `📈 Pulse Factory week to ${dayKey(now, cfg.timezone)}`,
        description: lines.join("\n").slice(0, 3900),
        color: 0xff6b1a,
      },
      ...(social.length
        ? [{ description: social.join("\n").slice(0, 3900), color: 0xff6b1a }]
        : []),
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
  desk?: boolean;
  suite?: string | boolean | null;
  mascot?: string | boolean | null;
  narrator?: string | null;
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
    desk?: boolean;
    suite?: boolean;
    mascot?: boolean;
    narrator?: string;
  }>
> {
  const rows = await db.query<RetentionRow>(
    `SELECT e.id, e.lane, e.script_json, m.raw, e.assets_json->'plan'->'shots'->0->'media'->>'type' AS opening, e.qa_json->'rubric'->'metrics' AS metrics, (e.assets_json->'desk') IS NOT NULL AS desk, e.assets_json->>'suite' AS suite, e.assets_json->>'mascot' AS mascot, e.assets_json->'voice'->>'name' AS narrator
       FROM video_metrics m JOIN episodes e ON e.id = m.episode_id
      WHERE m.label = 'retention' AND m.captured_at > $1::timestamptz - interval '45 days' AND e.lane <> 'twin'`,
    [now],
  );
  return rows
    .map((r) => {
      const raw = typeof r.raw === "string" ? JSON.parse(r.raw) : r.raw;
      const metrics = (
        typeof r.metrics === "string" ? JSON.parse(r.metrics) : r.metrics
      ) as Array<{ name: string; value: number | string }> | null;
      const metric = (name: string) => {
        const v = metrics?.find((m) => m.name === name)?.value;
        return typeof v === "number" ? v : undefined;
      };
      return {
        title: r.script_json?.youtube?.title ?? r.id,
        hook: r.script_json?.hook ?? "",
        hookWords: r.script_json?.hook
          ? r.script_json.hook.split(/\s+/).filter(Boolean).length
          : undefined,
        footageShare: metric("footage_share"),
        desk: Boolean(r.desk),
        // Set only on Shorts made since the new-look test began: older ones are on neither side.
        suite: r.suite == null ? undefined : String(r.suite) === "true",
        // Likewise Pip: set only since the mascot test began.
        mascot: r.mascot == null ? undefined : String(r.mascot) === "true",
        // The old rotation stored the voice id as its name; Liam's id reads as Liam.
        narrator:
          r.narrator === "TX3LPaxmHKxFdv7VOQHJ"
            ? "Liam"
            : (r.narrator ?? undefined),
        format:
          r.script_json?.evergreen_format ??
          (r.script_json?.runtime === "long" ? "long" : (r.lane ?? "news")),
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
  rows: Array<{
    stay?: number;
    pct: number;
    hookWords?: number;
    footageShare?: number;
    format?: string;
    desk?: boolean;
    suite?: boolean;
    mascot?: boolean;
    narrator?: string;
  }>,
): string[] {
  const score = (r: (typeof rows)[number]) => r.stay ?? r.pct;
  const avg = (xs: typeof rows) =>
    xs.length >= 3
      ? { n: xs.length, v: xs.reduce((a, r) => a + score(r), 0) / xs.length }
      : undefined;
  const line = (
    what: string,
    a: { n: number; v: number },
    aName: string,
    b: { n: number; v: number },
    bName: string,
  ) =>
    `${what}: ${aName} kept ${Math.round(a.v)}% (${a.n} Shorts), ${bName} ${Math.round(b.v)}% (${b.n} Shorts).`;
  const out: string[] = [];
  const shortHook = avg(
    rows.filter((r) => r.hookWords !== undefined && r.hookWords <= 10),
  );
  const longHook = avg(
    rows.filter((r) => r.hookWords !== undefined && r.hookWords > 10),
  );
  if (shortHook && longHook)
    out.push(
      line("Hooks", shortHook, "ten words or fewer", longHook, "longer"),
    );
  const footage = avg(
    rows.filter((r) => r.footageShare !== undefined && r.footageShare >= 0.4),
  );
  const cards = avg(
    rows.filter((r) => r.footageShare !== undefined && r.footageShare < 0.4),
  );
  if (footage && cards)
    out.push(
      line(
        "Picture",
        footage,
        "mostly moving footage",
        cards,
        "mostly stills and cards",
      ),
    );
  // The narrator test: the two narrators with the most Shorts, each against the other.
  const counts = new Map<string, number>();
  for (const r of rows)
    if (r.narrator) counts.set(r.narrator, (counts.get(r.narrator) ?? 0) + 1);
  const [n1, n2] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([n]) => n);
  if (n1 && n2) {
    const a = avg(rows.filter((r) => r.narrator === n1));
    const b = avg(rows.filter((r) => r.narrator === n2));
    if (a && b) out.push(line("Narrator", a, n1, b, n2));
  }
  const withDesk = avg(rows.filter((r) => r.desk === true));
  const noDesk = avg(rows.filter((r) => r.desk === false));
  if (withDesk && noDesk)
    out.push(
      line(
        "Desk question before the take",
        withDesk,
        "with it",
        noDesk,
        "without",
      ),
    );
  // The new-look test (src/render/Short.tsx `suite`): only Shorts made since it began count on either side.
  const withSuite = avg(rows.filter((r) => r.suite === true));
  const noSuite = avg(rows.filter((r) => r.suite === false));
  if (withSuite && noSuite)
    out.push(line("New look (accents, punch-ins, period looks)", withSuite, "with it", noSuite, "without"));
  // Pip the mascot test (src/render/components/Pip.tsx): only Shorts made since it began count on either side.
  const withPip = avg(rows.filter((r) => r.mascot === true));
  const noPip = avg(rows.filter((r) => r.mascot === false));
  if (withPip && noPip) out.push(line("Mascot (Pip beside the logo)", withPip, "with him", noPip, "without"));
  const formats = [
    ...new Set(rows.map((r) => r.format).filter((f): f is string => !!f)),
  ];
  for (const f of formats) {
    const mine = avg(rows.filter((r) => r.format === f));
    const rest = avg(rows.filter((r) => r.format !== f));
    if (mine && rest && Math.abs(mine.v - rest.v) >= 5)
      out.push(
        line("Format", mine, f.replace(/_/g, " "), rest, "everything else"),
      );
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
export async function hookLessons(
  db: Db,
  now: Date,
  segmentsOf?: (script: Script, desk: boolean) => SegmentInput[],
): Promise<string> {
  const rows = (await retentionRows(db, now)).filter((r) => r.hook);
  const drops = await dropLessons(db, now, segmentsOf).catch(() => "");
  if (rows.length < 4) return drops;
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
    drops,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The evening summary: what went live today, what is waiting on the owner, and the background news in one message. */
export async function dailySummary(
  db: Db,
  cfg: Config,
  now: Date,
  credits?: string,
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
    credits ?? "",
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
 * The full retention curve a week after going live (one Analytics request each): long videos for the
 * long-form writer's entry lessons, Shorts for the news writer's "where viewers leave". Stored as a
 * "curve" row. Five a tick, oldest first, so the backlog clears over a day or two.
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
      WHERE e.status = 'published' AND e.lane <> 'twin' AND e.youtube_video_id IS NOT NULL
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
  if (n) log("info", "retention curves captured", { videos: n });
  return n;
}

/**
 * For the documentary shot-list writer (owner, 28 Oct 2026: learn from the retention curves): how fast
 * viewers left while each kind of graphic was on screen, and during the breathers, against each long video's
 * own average. Empty until a few long videos with shot lists have curves.
 */
export async function visualLessons(
  db: Db,
  now: Date,
  segmentsOf?: (script: Script, desk: boolean) => SegmentInput[],
): Promise<string> {
  if (!segmentsOf) return "";
  const rows = await db.query<{ id: string; script_json: any; assets_json: any; raw: unknown }>(
    `SELECT e.id, e.script_json, e.assets_json, m.raw FROM video_metrics m JOIN episodes e ON e.id = m.episode_id
      WHERE m.label = 'curve' AND e.lane = 'longform' AND m.captured_at > $1::timestamptz - interval '180 days'`,
    [now],
  );
  const groups = new Map<string, { ratios: number[]; videos: Set<string> }>();
  const add = (k: string, r: number, id: string) => {
    const g = groups.get(k) ?? { ratios: [], videos: new Set<string>() };
    g.ratios.push(r);
    g.videos.add(id);
    groups.set(k, g);
  };
  for (const r of rows) {
    const curve = (typeof r.raw === "string" ? JSON.parse(r.raw) : r.raw) as Curve;
    const script = r.script_json as Script | null;
    const words = r.assets_json?.words;
    const duration = Number(r.assets_json?.durationSeconds ?? 0);
    const moments = (script?.entries ?? []).map((e) => e.moments ?? []);
    if (!script?.beats || !Array.isArray(words) || !duration || curve.length < 20 || !moments.some((m) => m.length)) continue;
    // The video's own pace of loss, between its first and last twentieth.
    const avg = (watchAt(curve, duration * 0.05, duration) - watchAt(curve, duration * 0.95, duration)) / (duration * 0.9);
    if (avg <= 0) continue;
    const rate = (a: number, b: number) =>
      b - a > 2 ? (watchAt(curve, a, duration) - watchAt(curve, b, duration)) / (b - a) / avg : undefined;
    try {
      const segments = buildSegments(segmentsOf(script, false), words, duration);
      const ws = momentWindows(segments, words, moments.map((m) => m.length), moments.map((e) => e.map(momentKeys)));
      for (const w of ws) {
        const kind = moments[w.entry]?.[w.moment]?.graphic?.kind ?? "none";
        const x = rate(w.start, Math.min(w.end, w.start + 12));
        if (x !== undefined) add(kind === "none" ? "no graphic (footage and pictures)" : `${kind} graphics`, x, r.id);
      }
    } catch {
      continue;
    }
    for (const b of (r.assets_json?.breaks ?? []) as Array<{ start: number; end: number }>) {
      const x = rate(b.start, b.end + 4);
      if (x !== undefined) add("chapter breathers", x, r.id);
    }
  }
  const lines = [...groups.entries()]
    .filter(([, g]) => g.ratios.length >= 6 && g.videos.size >= 2)
    .map(([k, g]) => {
      const mean = g.ratios.reduce((a, b) => a + b, 0) / g.ratios.length;
      return { k, mean, n: g.ratios.length, v: g.videos.size };
    })
    .sort((a, b) => a.mean - b.mean);
  if (lines.length < 2) return "";
  const word = (m: number) =>
    m < 0.95 ? `viewers left ${Math.round((1 - m) * 100)}% slower than average` : m > 1.05 ? `viewers left ${Math.round((m - 1) * 100)}% faster than average` : "about average";
  return [
    "How our long videos' audiences reacted while each kind of graphic was on screen (YouTube retention, against each video's own average; lean on what held them, use what lost them more sparingly):",
    ...lines.map((l) => `- ${l.k}: ${word(l.mean)} (${l.n} moments in ${l.v} videos)`),
  ].join("\n");
}

/** The share of viewers watching at each segment's start who had left by its end, from a Short's curve. */
export function segmentLosses(
  curve: Curve,
  segments: Array<{ start: number; end: number }>,
  duration: number,
): number[] {
  return segments.map((g) => {
    const a = watchAt(curve, g.start, duration);
    const b = watchAt(curve, g.end, duration);
    return a > 0 ? Math.max(0, (a - b) / a) : 0;
  });
}

/** The part of a Short a segment belongs to, for the lessons: hook, first card, second card, later cards, desk, take, loop. */
function partOf(kind: string, beat: number): string {
  if (kind !== "beat") return kind;
  return beat === 0 ? "first card" : beat === 1 ? "second card" : "later cards";
}

/**
 * For the news writer: where viewers leave our Shorts (YouTube retention), part by part, and the exact
 * lines that lost or held them. `segmentsOf` is the pipeline's segmentInputs (kept out of here to avoid
 * an import cycle). Empty until a few Shorts have curves.
 */
export async function dropLessons(
  db: Db,
  now: Date,
  segmentsOf?: (script: Script, desk: boolean) => SegmentInput[],
): Promise<string> {
  if (!segmentsOf) return "";
  const rows = await db.query<{
    id: string;
    script_json: any;
    assets_json: any;
    raw: unknown;
  }>(
    `SELECT e.id, e.script_json, e.assets_json, m.raw FROM video_metrics m JOIN episodes e ON e.id = m.episode_id
      WHERE m.label = 'curve' AND e.lane NOT IN ('longform', 'twin') AND m.captured_at > $1::timestamptz - interval '90 days'`,
    [now],
  );
  const byPart: Record<string, number[]> = {};
  const moments: Array<{
    loss: number;
    perSecond: number;
    text: string;
    part: string;
    headline: string;
  }> = [];
  const endWatch: number[] = [];
  let shorts = 0;
  for (const r of rows) {
    const curve = (
      typeof r.raw === "string" ? JSON.parse(r.raw) : r.raw
    ) as Curve;
    const script = r.script_json as Script | null;
    const assets = r.assets_json ?? {};
    const words = assets.words;
    const duration = Number(assets.durationSeconds ?? 0);
    if (
      !script?.beats ||
      !Array.isArray(words) ||
      !words.length ||
      !duration ||
      curve.length < 20
    )
      continue;
    let segments: ReturnType<typeof buildSegments>;
    try {
      segments = buildSegments(
        segmentsOf(script, !!assets.desk),
        words,
        duration,
      );
    } catch {
      continue;
    }
    const losses = segmentLosses(curve, segments, duration);
    endWatch.push(watchAt(curve, Math.max(0, duration - 0.5), duration));
    shorts++;
    let beat = 0;
    segments.forEach((g, k) => {
      const part = partOf(g.kind, beat);
      if (g.kind === "beat") beat++;
      (byPart[part] ??= []).push(losses[k]!);
      const secs = g.end - g.start;
      if (secs >= 1.5)
        moments.push({
          loss: losses[k]!,
          perSecond: losses[k]! / secs,
          text: g.text.slice(0, 110),
          part,
          headline: script.headline,
        });
    });
  }
  if (shorts < 3 || !moments.length) return "";
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const order = [
    "hook",
    "first card",
    "second card",
    "later cards",
    "desk",
    "take",
    "loop",
  ];
  const parts = order
    .filter((p) => byPart[p]?.length)
    .map((p) => `${p} ${pct(avg(byPart[p]!))}`);
  moments.sort((a, b) => b.perSecond - a.perSecond);
  const line = (m: (typeof moments)[number]) =>
    `- lost ${pct(m.loss)} during the ${m.part} of "${m.headline}": "${m.text}"`;
  return [
    `Where viewers leave our Shorts (YouTube retention, ${shorts} Shorts; of those still watching as each part begins, the share gone by its end): ${parts.join(", ")}. Still watching at the end: ${pct(avg(endWatch))}.`,
    "Lines that lost viewers fastest (learn what to avoid, never reuse the words):",
    ...moments.slice(0, 3).map(line),
    "Lines that held them:",
    ...moments.slice(-3).reverse().map(line),
  ].join("\n");
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

/**
 * Reach check (command centre, 28 Oct 2026): between 17 Jun and 2 Jul YouTube withheld 18 of 19 Pulse Shorts
 * from the Shorts feed (about 29 views each instead of about 600) and nothing noticed for two weeks. Once a
 * Short is a day and a half old (Analytics lags), its traffic sources are read once and stored as a "reach"
 * row; when two or more of the last five got almost nothing from the Shorts feed, the owner hears once.
 */
export interface ReachSource {
  trafficSources?(
    videoId: string,
    start: string,
    end: string,
  ): Promise<Record<string, number>>;
}

/** The lanes that publish Shorts (long videos and the twin channel are judged elsewhere). */
const SHORT_LANES = ["news_breaking", "news", "free", "evergreen", "cutdown", "gameplay"];
/** Below this share of views from the Shorts feed, a Short was not served there. */
export const REACH_FEED_SHARE = 0.2;
/** Fewer views than this says nothing either way. */
export const REACH_MIN_VIEWS = 10;

export async function captureReach(db: Db, yt: ReachSource, now: Date): Promise<number> {
  if (!yt.trafficSources) return 0;
  const eps = await db.query<{ id: string; youtube_video_id: string; live_at: string }>(
    `SELECT e.id, e.youtube_video_id, ${LIVE_AT("e")} AS live_at FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND e.lane = ANY($2)
        AND ${LIVE_AT("e")} < $1::timestamptz - interval '36 hours'
        AND ${LIVE_AT("e")} > $1::timestamptz - interval '4 days'
        AND NOT EXISTS (SELECT 1 FROM video_metrics m WHERE m.episode_id = e.id AND m.label = 'reach')
      ORDER BY 3 LIMIT 6`,
    [now, SHORT_LANES],
  );
  let n = 0;
  for (const e of eps) {
    const sources = await yt.trafficSources(
      e.youtube_video_id,
      new Date(e.live_at).toISOString().slice(0, 10),
      now.toISOString().slice(0, 10),
    );
    const views = Object.values(sources).reduce((a, b) => a + b, 0);
    if (!views) continue; // Analytics has nothing yet: tried again next tick
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, captured_at, views, likes, comments, raw) VALUES ($1, 'reach', $2, $3, 0, 0, $4)
       ON CONFLICT (episode_id, label) DO NOTHING`,
      [e.id, now, views, JSON.stringify(sources)],
    );
    n++;
  }
  if (n) log("info", "reach captured", { videos: n });
  return n;
}

export interface ReachRow {
  title: string;
  views: number;
  feed: number; // views from the Shorts feed
}

/** The Shorts the feed passed over, when two or more of the last five were; otherwise none. */
export function withheld(latestFirst: ReachRow[]): ReachRow[] {
  const low = latestFirst
    .slice(0, 5)
    .filter((r) => r.views >= REACH_MIN_VIEWS && r.feed / r.views < REACH_FEED_SHARE);
  return low.length >= 2 ? low : [];
}

/** One Discord alert, at most every three days, when the Shorts feed stops serving our Shorts. */
export async function reachAlert(
  db: Db,
  now: Date,
  notify: (m: DiscordMessage) => Promise<unknown>,
): Promise<boolean> {
  const rows = await db.query<{ title: string | null; views: number; raw: unknown }>(
    `SELECT COALESCE(e.script_json->'youtube'->>'title', e.story_json->>'headline', e.id) AS title, m.views, m.raw
       FROM video_metrics m JOIN episodes e ON e.id = m.episode_id
      WHERE m.label = 'reach' AND m.captured_at > $1::timestamptz - interval '7 days'
      ORDER BY ${LIVE_AT("e")} DESC LIMIT 5`,
    [now],
  );
  const low = withheld(
    rows.map((r) => {
      const raw = (typeof r.raw === "string" ? JSON.parse(r.raw) : r.raw) as Record<string, number>;
      return { title: r.title ?? "", views: Number(r.views), feed: Number(raw?.SHORTS ?? 0) };
    }),
  );
  if (!low.length) return false;
  const [recent] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM events WHERE kind = 'reach_alert' AND (detail->>'at')::timestamptz > $1::timestamptz - interval '3 days'`,
    [now],
  );
  if (Number(recent?.n ?? 0) > 0) return false;
  const lines = low.map(
    (r) => `- "${r.title}": ${r.views} views, ${Math.round((r.feed / r.views) * 100)}% from the Shorts feed`,
  );
  await notify({
    content: [
      `**Reach warning:** YouTube is not showing ${low.length} of our last 5 Shorts in the Shorts feed (normally most views come from there).`,
      ...lines,
      `Check YouTube Studio > the Short > Analytics > Reach > "How viewers find this Short". If the feed share stays near zero, the channel may be held back; tell Claude and it will look into why.`,
    ].join("\n"),
  });
  await logEvent(db, null, "reach_alert", { at: now.toISOString(), videos: low.length, titles: low.map((r) => r.title) });
  log("warn", "reach alert sent", { videos: low.length });
  return true;
}
// ------------------------------------------------------------------ the other platforms

/** Shorts a platform needs with numbers on both sides before anything is said about it. */
export const SOCIAL_MIN_SHORTS = 6;
/** A Short whose rank there is this far (as a share of the field) from its YouTube rank over- or under-performed. */
export const SOCIAL_RANK_GAP = 0.25;
/** A story type needs this many Shorts before its average gap counts, and this big a gap. */
const SOCIAL_TYPE_MIN = 3;
const SOCIAL_TYPE_GAP = 0.15;

export interface PlatformShort {
  title: string;
  hook: string;
  question: string;
  storyType?: string;
  ytViews: number;
  views: number;
}

/** Each value's rank as a share of the field, 0 for the lowest to 1 for the highest; ties share their average rank. */
export function percentileRanks(values: number[]): number[] {
  if (values.length < 2) return values.map(() => 0.5);
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  for (let k = 0; k < order.length; ) {
    let j = k;
    while (j + 1 < order.length && order[j + 1]!.v === order[k]!.v) j++;
    const rank = (k + j) / 2 / (values.length - 1);
    for (let m = k; m <= j; m++) out[order[m]!.i] = rank;
    k = j + 1;
  }
  return out;
}

/** How far each Short ranked higher (positive) or lower on the platform than on YouTube. */
export function rankGaps(
  rows: PlatformShort[],
): Array<PlatformShort & { gap: number }> {
  const yt = percentileRanks(rows.map((r) => r.ytViews));
  const there = percentileRanks(rows.map((r) => r.views));
  return rows.map((r, i) => ({ ...r, gap: there[i]! - yt[i]! }));
}

const PLATFORM_NAMES: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  tiktok: "TikTok",
  bluesky: "Bluesky",
  x: "X",
};

/** For the writers: which Shorts did better or worse on a platform than their YouTube rank says; nothing on thin data. */
export function platformLessons(
  platform: string,
  rows: PlatformShort[],
): string[] {
  if (rows.length < SOCIAL_MIN_SHORTS) return [];
  const ranked = rankGaps(rows).sort((a, b) => b.gap - a.gap);
  const over = ranked.filter((r) => r.gap >= SOCIAL_RANK_GAP).slice(0, 3);
  const under = ranked
    .filter((r) => r.gap <= -SOCIAL_RANK_GAP)
    .slice(-3)
    .reverse();
  const describe = (r: (typeof ranked)[number]) =>
    `- "${r.title}" (${r.views.toLocaleString("en-US")} views there, ${r.ytViews.toLocaleString("en-US")} on YouTube): hook "${r.hook}"${r.question ? `, asked "${r.question}"` : ""}`;
  const types = new Map<string, number[]>();
  for (const r of ranked)
    if (r.storyType)
      types.set(r.storyType, [...(types.get(r.storyType) ?? []), r.gap]);
  const typeLines = [...types.entries()]
    .filter(([, g]) => g.length >= SOCIAL_TYPE_MIN)
    .map(([t, g]) => ({
      t,
      n: g.length,
      mean: g.reduce((a, b) => a + b, 0) / g.length,
    }))
    .filter((x) => Math.abs(x.mean) >= SOCIAL_TYPE_GAP)
    .map(
      (x) =>
        `- ${x.t.replace(/_/g, " ")} stories ranked ${x.mean > 0 ? "higher" : "lower"} there than on YouTube (${x.n} Shorts).`,
    );
  if (!over.length && !under.length && !typeLines.length) return [];
  const name = PLATFORM_NAMES[platform] ?? platform;
  return [
    `${name} (${rows.length} Shorts, median ${median(rows.map((r) => r.views)).toLocaleString("en-US")} views a day after posting):`,
    ...(over.length
      ? [`Did better on ${name} than on YouTube:`, ...over.map(describe)]
      : []),
    ...(under.length
      ? [`Did worse on ${name} than on YouTube:`, ...under.map(describe)]
      : []),
    ...typeLines,
  ];
}

/** The hour of day (0-23) in `to` that an hour in `from` falls on, at `at`. */
function shiftHour(hour: number, from: string, to: string, at: Date): number {
  const h = (tz: string) =>
    Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(at),
    );
  return (((hour + h(to) - h(from)) % 24) + 24) % 24;
}

/** The three busiest hours, in US Eastern, from 24 counts by hour in `timeZone`; none below `minTotal`. */
export function bestHours(
  counts: Array<number | undefined>,
  timeZone: string,
  at: Date,
  minTotal = 50,
): number[] {
  const xs = counts
    .slice(0, 24)
    .map((c) => (typeof c === "number" && Number.isFinite(c) ? c : 0));
  if (xs.length < 24 || xs.reduce((a, b) => a + b, 0) < minTotal) return [];
  return xs
    .map((v, hour) => ({ v, hour }))
    .sort((a, b) => b.v - a.v || a.hour - b.hour)
    .slice(0, 3)
    .map((x) => shiftHour(x.hour, timeZone, "America/New_York", at))
    .sort((a, b) => a - b);
}

/** 24 counts by hour from Instagram's {"0": n, ...} map, TikTok's 24 numbers or [{hour, value}] rows. */
export function hourCounts(raw: unknown): Array<number | undefined> {
  if (Array.isArray(raw)) {
    if (raw.every((x) => typeof x === "number" || x === null))
      return raw as number[];
    const out = new Array<number | undefined>(24).fill(0);
    for (const r of raw as Array<{ hour?: number; value?: number }>)
      if (r && typeof r.hour === "number" && r.hour >= 0 && r.hour < 24)
        out[r.hour] = Number(r.value) || 0;
    return out;
  }
  if (raw && typeof raw === "object")
    return Array.from(
      { length: 24 },
      (_, h) => Number((raw as Record<string, unknown>)[String(h)]) || 0,
    );
  return [];
}

const hhmm = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * For the editor and the news writer: how our Shorts did on the other platforms against their YouTube rank, and
 * the hours their followers are about. Each platform's numbers a day after posting (or the nearest age read).
 */
export async function socialLessons(db: Db, now: Date): Promise<string> {
  const rows = await db.query<{
    platform: string;
    views: number | string;
    yt_views: number | string;
    script_json: Episode["script_json"];
  }>(
    `SELECT DISTINCT ON (s.platform, s.episode_id) s.platform, s.views, ym.views AS yt_views, e.script_json
       FROM social_metrics s
       JOIN episodes e ON e.id = s.episode_id
       JOIN video_metrics ym ON ym.episode_id = e.id AND ym.label = '24h'
      WHERE s.post_id <> 'account' AND s.views IS NOT NULL AND s.label IN ('24h', '72h', '7d')
        AND s.captured_at > $1::timestamptz - interval '45 days'
      ORDER BY s.platform, s.episode_id, CASE s.label WHEN '24h' THEN 0 WHEN '72h' THEN 1 ELSE 2 END`,
    [now],
  );
  const by = new Map<string, PlatformShort[]>();
  for (const r of rows) {
    const sc = r.script_json;
    const loop = (sc?.loop_line ?? "").trim();
    by.set(r.platform, [
      ...(by.get(r.platform) ?? []),
      {
        title: sc?.youtube?.title ?? sc?.headline ?? "",
        hook: sc?.hook ?? "",
        question: /\?$/.test(loop) ? loop : "",
        storyType: sc?.story_type,
        ytViews: Number(r.yt_views),
        views: Number(r.views),
      },
    ]);
  }
  const lines: string[] = [];
  for (const p of ["instagram", "facebook", "threads", "tiktok"])
    lines.push(...platformLessons(p, by.get(p) ?? []));
  // When followers are about: Instagram's online followers (Meta counts those hours in Pacific time) and
  // TikTok's active hours (as TikTok Studio shows them, in the time zone the routine names).
  const accounts = await db.query<{ platform: string; extra: any }>(
    `SELECT DISTINCT ON (platform) platform, extra FROM social_metrics
      WHERE post_id = 'account' AND platform IN ('instagram', 'tiktok') AND captured_at > $1::timestamptz - interval '14 days'
        AND (extra ? 'online_followers' OR extra ? 'active_hours')
      ORDER BY platform, label DESC`,
    [now],
  );
  for (const a of accounts) {
    const extra = typeof a.extra === "string" ? JSON.parse(a.extra) : a.extra;
    const hours =
      a.platform === "instagram"
        ? bestHours(
            hourCounts(extra?.online_followers),
            "America/Los_Angeles",
            now,
          )
        : bestHours(
            hourCounts(extra?.active_hours),
            String(extra?.active_hours_timezone || "Europe/London"),
            now,
            3,
          );
    if (hours.length)
      lines.push(
        `${PLATFORM_NAMES[a.platform]} followers are most active around ${hours.map(hhmm).join(", ")} US Eastern.`,
      );
  }
  if (!lines.length) return "";
  return [
    "How our Shorts did on the other platforms against their YouTube rank (a day after posting there). A story that wins on Instagram or TikTok but not on YouTube says something about its hook and its question; advice, not rules:",
    ...lines,
  ].join("\n");
}

/** The Monday table: each platform's last seven days of posts and what they drew (latest reading of each post). */
export async function socialTable(db: Db, now: Date): Promise<string[]> {
  const posts = await db.query<{ platform: string; n: string | number }>(
    `SELECT detail->>'platform' AS platform, count(*) AS n FROM events
      WHERE kind = 'crosspost' AND created_at > $1::timestamptz - interval '7 days' GROUP BY 1`,
    [now],
  );
  const nums = await db.query<{
    platform: string;
    views: Array<number | string> | null;
    likes: string | number | null;
    comments: string | number | null;
    shares: string | number | null;
  }>(
    `WITH latest AS (
       SELECT DISTINCT ON (s.platform, s.post_id) s.* FROM social_metrics s
        WHERE s.post_id <> 'account' AND EXISTS (
          SELECT 1 FROM events v WHERE v.kind = 'crosspost' AND v.episode_id = s.episode_id
             AND v.detail->>'platform' = s.platform AND v.created_at > $1::timestamptz - interval '7 days')
        ORDER BY s.platform, s.post_id, s.captured_at DESC)
     SELECT platform, array_agg(views) FILTER (WHERE views IS NOT NULL) AS views,
            sum(likes) AS likes, sum(comments) AS comments, sum(shares) AS shares
       FROM latest GROUP BY platform`,
    [now],
  );
  const growth = await db.query<{
    platform: string;
    follows: string | number | null;
  }>(
    `SELECT platform, sum(follows) AS follows FROM social_metrics
      WHERE post_id = 'account' AND captured_at > $1::timestamptz - interval '7 days' GROUP BY platform`,
    [now],
  );
  const order = ["facebook", "instagram", "threads", "tiktok", "bluesky", "x"];
  const platforms = order.filter(
    (p) =>
      posts.some((r) => r.platform === p) || nums.some((r) => r.platform === p),
  );
  if (!platforms.length) return [];
  const cell = (v: unknown) =>
    v === null || v === undefined || v === ""
      ? "-"
      : Number(v).toLocaleString("en-US");
  const row = (cols: string[]) =>
    cols
      .map((c, i) => (i === 0 ? c.padEnd(9) : c.padStart(i === 2 ? 9 : 6)))
      .join(" ");
  const lines = [
    row([
      "Platform",
      "Posts",
      "Med views",
      "Likes",
      "Comms",
      "Shares",
      "Follow",
    ]),
  ];
  for (const p of platforms) {
    const n = nums.find((r) => r.platform === p);
    const g = growth.find((r) => r.platform === p)?.follows;
    const views = (n?.views ?? []).map(Number);
    lines.push(
      row([
        PLATFORM_NAMES[p] ?? p,
        cell(posts.find((r) => r.platform === p)?.n ?? 0),
        views.length ? cell(median(views)) : "-",
        cell(n?.likes),
        cell(n?.comments),
        cell(n?.shares),
        g === null || g === undefined
          ? "-"
          : `${Number(g) >= 0 ? "+" : ""}${Number(g).toLocaleString("en-US")}`,
      ]),
    );
  }
  return [
    "**Other platforms (last 7 days; TikTok counts drafts sent, Follow is followers gained):**",
    "```",
    ...lines,
    "```",
  ];
}

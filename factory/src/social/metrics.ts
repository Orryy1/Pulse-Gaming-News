// The other platforms' numbers, fed back like YouTube's (src/analytics.ts). Every Short crossposted to
// Instagram, Facebook or Threads is read at fixed ages after it went out there (1h, 24h, 72h, 7d), and each
// account once a day (followers gained, reach, when followers are online, where they live). TikTok has no API
// for us: a browser routine copies TikTok Studio's numbers to /routine/tiktok-stats and they land in the same
// table. Everything here is read-only. A permission the login lacks is logged once, in plain words, and that
// platform falls back to its public numbers (or is left alone) until the login changes.

import fs from "node:fs";
import type { Db } from "../db.ts";
import type { Config } from "../config.ts";
import type { Script } from "../editorial/schema.ts";
import { polishTitle } from "../editorial/seo.ts";
import { dayKey } from "../lanes.ts";
import { errorMessage, log } from "../lib/util.ts";
import { GRAPH, THREADS, threadsLogin } from "./platforms.ts";
import { socialCaption } from "./crosspost.ts";

type FetchLike = typeof fetch;
export type SocialPlatform = "instagram" | "facebook" | "threads" | "tiktok";
export const API_PLATFORMS = ["instagram", "facebook", "threads"] as const;
type ApiPlatform = (typeof API_PLATFORMS)[number];

/** Ages at which a post's numbers are read, counted from when it went out on that platform. */
export const SOCIAL_LABELS: ReadonlyArray<{ label: string; hours: number }> = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "72h", hours: 72 },
  { label: "7d", hours: 168 },
];

export interface SocialNumbers {
  views?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  avgWatchSeconds?: number;
  totalWatchSeconds?: number;
  follows?: number;
  extra?: Record<string, unknown>;
}

/** Same rule as YouTube's labelsDue: due once old enough, skipped (never back-filled) once missed by half its age. */
export function socialLabelsDue(
  postedAt: Date,
  now: Date,
  have: Set<string>,
): string[] {
  const hours = (now.getTime() - postedAt.getTime()) / 3_600_000;
  return SOCIAL_LABELS.filter(
    (l) => !have.has(l.label) && hours >= l.hours && hours <= l.hours * 1.5 + 1,
  ).map((l) => l.label);
}

/** The oldest age a reading taken this long after posting stands for (TikTok is read whenever the routine runs). */
export function ageLabel(hours: number): string {
  return hours >= 168 ? "7d" : hours >= 72 ? "72h" : hours >= 24 ? "24h" : "1h";
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};
const int = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined ? undefined : Math.round(n);
};
const ms = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined ? undefined : Math.round(n / 100) / 10;
};

export async function saveSocial(
  db: Db,
  r: {
    platform: SocialPlatform;
    postId: string;
    episodeId?: string | null;
    youtubeVideoId?: string | null;
    label: string;
    capturedAt: Date;
    numbers: SocialNumbers;
    /** A later reading in the same age replaces the earlier one (TikTok); otherwise the first one stands. */
    replace?: boolean;
  },
): Promise<void> {
  const n = r.numbers;
  await db.query(
    `INSERT INTO social_metrics (platform, post_id, episode_id, youtube_video_id, label, captured_at, views, reach, likes, comments, shares, saves, avg_watch_seconds, total_watch_seconds, follows, extra)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (platform, post_id, label) DO ${
       r.replace
         ? `UPDATE SET episode_id = EXCLUDED.episode_id, youtube_video_id = EXCLUDED.youtube_video_id, captured_at = EXCLUDED.captured_at,
              views = EXCLUDED.views, reach = EXCLUDED.reach, likes = EXCLUDED.likes, comments = EXCLUDED.comments, shares = EXCLUDED.shares,
              saves = EXCLUDED.saves, avg_watch_seconds = EXCLUDED.avg_watch_seconds, total_watch_seconds = EXCLUDED.total_watch_seconds,
              follows = EXCLUDED.follows, extra = EXCLUDED.extra`
         : "NOTHING"
     }`,
    [
      r.platform,
      r.postId,
      r.episodeId ?? null,
      r.youtubeVideoId ?? null,
      r.label,
      r.capturedAt,
      int(n.views) ?? null,
      int(n.reach) ?? null,
      int(n.likes) ?? null,
      int(n.comments) ?? null,
      int(n.shares) ?? null,
      int(n.saves) ?? null,
      num(n.avgWatchSeconds) ?? null,
      num(n.totalWatchSeconds) ?? null,
      int(n.follows) ?? null,
      n.extra ? JSON.stringify(n.extra) : null,
    ],
  );
}

// ------------------------------------------------------------------ per-post captures

export interface SocialCapture {
  platform: ApiPlatform;
  postId: string;
  episodeId: string;
  youtubeVideoId: string | null;
  postedAt: Date;
  label: string;
}

/** Every crossposted Short with an age due on Instagram, Facebook or Threads; the crosspost events are the ledger. */
export async function dueSocialCaptures(
  db: Db,
  now: Date,
): Promise<SocialCapture[]> {
  const posts = await db.query<{
    episode_id: string;
    platform: ApiPlatform;
    post_id: string;
    posted_at: string;
    youtube_video_id: string | null;
  }>(
    `SELECT v.episode_id, v.detail->>'platform' AS platform, v.detail->>'id' AS post_id, v.created_at AS posted_at, e.youtube_video_id
       FROM events v JOIN episodes e ON e.id = v.episode_id
      WHERE v.kind = 'crosspost' AND v.detail->>'platform' = ANY($2) AND v.created_at > $1::timestamptz - interval '9 days'
        AND COALESCE(v.detail->>'id', '') <> '' AND v.detail->>'id' NOT LIKE 'inbox:%'
      ORDER BY v.created_at`,
    [now, [...API_PLATFORMS]],
  );
  if (!posts.length) return [];
  const have = new Map<string, Set<string>>();
  for (const m of await db.query<{
    platform: string;
    post_id: string;
    label: string;
  }>(
    `SELECT platform, post_id, label FROM social_metrics WHERE post_id = ANY($1)`,
    [posts.map((p) => p.post_id)],
  )) {
    const k = `${m.platform}:${m.post_id}`;
    if (!have.has(k)) have.set(k, new Set());
    have.get(k)!.add(m.label);
  }
  const out: SocialCapture[] = [];
  for (const p of posts) {
    const postedAt = new Date(p.posted_at);
    for (const label of socialLabelsDue(
      postedAt,
      now,
      have.get(`${p.platform}:${p.post_id}`) ?? new Set(),
    ))
      out.push({
        platform: p.platform,
        postId: p.post_id,
        episodeId: p.episode_id,
        youtubeVideoId: p.youtube_video_id,
        postedAt,
        label,
      });
  }
  return out;
}

export interface SocialReaders {
  instagram?: (mediaId: string) => Promise<SocialNumbers | undefined>;
  facebook?: (videoId: string) => Promise<SocialNumbers | undefined>;
  threads?: (mediaId: string) => Promise<SocialNumbers | undefined>;
  /** One account's numbers for the day (followers, reach, online hours). */
  accounts?: Partial<
    Record<ApiPlatform, () => Promise<SocialNumbers | undefined>>
  >;
}

/** Reads every due post once; a post a platform cannot read now is tried again next pass while its age is still open. */
export async function captureSocialMetrics(
  db: Db,
  readers: SocialReaders,
  now: Date,
): Promise<number> {
  const due = await dueSocialCaptures(db, now);
  let n = 0;
  // One reading serves every label due for the same post (a late 24h and a 1h never both fall due, but be safe).
  const read = new Map<string, Promise<SocialNumbers | undefined>>();
  for (const d of due) {
    const reader = readers[d.platform];
    if (!reader) continue;
    const key = `${d.platform}:${d.postId}`;
    if (!read.has(key))
      read.set(
        key,
        reader(d.postId).catch((err) => {
          log("warn", "social numbers could not be read", {
            platform: d.platform,
            post: d.postId,
            error: errorMessage(err).slice(0, 300),
          });
          return undefined;
        }),
      );
    const numbers = await read.get(key)!;
    if (!numbers) continue;
    await saveSocial(db, {
      platform: d.platform,
      postId: d.postId,
      episodeId: d.episodeId,
      youtubeVideoId: d.youtubeVideoId,
      label: d.label,
      capturedAt: now,
      numbers: {
        ...numbers,
        extra: {
          ...numbers.extra,
          age_hours:
            Math.round(
              ((now.getTime() - d.postedAt.getTime()) / 3_600_000) * 10,
            ) / 10,
        },
      },
    });
    n++;
  }
  if (n) log("info", "social numbers captured", { captures: n });
  return n;
}

/** Each account once a local day, from 06:00; a missing net-growth figure is worked out from yesterday's followers. */
export async function captureSocialAccounts(
  db: Db,
  readers: SocialReaders,
  now: Date,
  timeZone: string,
): Promise<number> {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  if (hour < 6) return 0;
  const day = dayKey(now, timeZone);
  let n = 0;
  for (const [platform, reader] of Object.entries(
    readers.accounts ?? {},
  ) as Array<[ApiPlatform, () => Promise<SocialNumbers | undefined>]>) {
    const [have] = await db.query<{ n: string | number }>(
      `SELECT count(*) AS n FROM social_metrics WHERE platform = $1 AND post_id = 'account' AND label = $2`,
      [platform, day],
    );
    if (Number(have?.n ?? 0) > 0) continue;
    const numbers = await reader().catch((err) => {
      log("warn", "account numbers could not be read", {
        platform,
        error: errorMessage(err).slice(0, 300),
      });
      return undefined;
    });
    if (!numbers) continue;
    const followers = num(numbers.extra?.followers);
    if (numbers.follows === undefined && followers !== undefined) {
      const [prev] = await db.query<{ extra: any }>(
        `SELECT extra FROM social_metrics WHERE platform = $1 AND post_id = 'account' AND label < $2 ORDER BY label DESC LIMIT 1`,
        [platform, day],
      );
      const before = num(prev?.extra?.followers);
      if (before !== undefined) numbers.follows = followers - before;
    }
    await saveSocial(db, {
      platform,
      postId: "account",
      label: day,
      capturedAt: now,
      numbers,
    });
    n++;
  }
  if (n) log("info", "account numbers captured", { accounts: n });
  return n;
}

// ------------------------------------------------------------------ the Graph and Threads readers

export class GraphError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

async function graphGet(url: string, fetchFn: FetchLike): Promise<any> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  if (!res.ok || body?.error)
    throw new GraphError(
      String(body?.error?.message ?? `HTTP ${res.status}`).slice(0, 400),
      num(body?.error?.code),
    );
  return body;
}

/** Meta's "you may not": error 10, the 200-299 permission family, or a message about permissions (not about a metric). */
export function isPermissionError(err: unknown): boolean {
  if (!(err instanceof GraphError)) return false;
  if (
    err.code === 10 ||
    (err.code !== undefined && err.code >= 200 && err.code < 300)
  )
    return true;
  return /permission/i.test(err.message) && !/metric/i.test(err.message);
}

/** Every metric in an insights reply by name: lifetime metrics carry values[], newer ones total_value. */
export function insightValues(body: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of body?.data ?? [])
    if (d?.name) out[d.name] = d.total_value?.value ?? d.values?.at(-1)?.value;
  return out;
}

/**
 * Asks for a list of metrics; when Meta refuses one by name (renamed, retired, not for this kind of post) it
 * is dropped, remembered and the rest asked again, so one bad name never loses the others.
 */
export async function insightsDropping(
  url: (metrics: string[]) => string,
  metrics: readonly string[],
  bad: Set<string>,
  fetchFn: FetchLike,
): Promise<Record<string, unknown>> {
  let list = metrics.filter((m) => !bad.has(m));
  for (let i = 0; i < 5 && list.length; i++) {
    try {
      return insightValues(await graphGet(url(list), fetchFn));
    } catch (err) {
      if (!(err instanceof GraphError) || isPermissionError(err)) throw err;
      const allowed = err.message
        .match(/one of the following values:\s*([\w, ]+)/i)?.[1]
        ?.split(/,\s*/)
        .map((s) => s.trim());
      const drop = allowed
        ? list.filter((m) => !allowed.includes(m))
        : list.filter((m) => new RegExp(`\\b${m}\\b`).test(err.message));
      if (!drop.length) {
        // Meta named nothing ("The value must be a valid insights metric", 29 Oct 2026 on Facebook reels): each
        // metric is asked once on its own, the refused ones remembered, and the rest asked together again.
        const good: string[] = [];
        for (const m of list)
          try {
            await graphGet(url([m]), fetchFn);
            good.push(m);
          } catch (e) {
            if (!(e instanceof GraphError) || isPermissionError(e)) throw e;
            bad.add(m);
          }
        log("info", "insight metrics checked one by one", {
          kept: good,
          dropped: list.filter((m) => !good.includes(m)),
        });
        if (!good.length) return {};
        list = good;
        continue;
      }
      for (const m of drop) bad.add(m);
      list = list.filter((m) => !drop.includes(m));
      log("info", "insight metric dropped", {
        metrics: drop,
        reason: err.message.slice(0, 160),
      });
    }
  }
  return {};
}

export const IG_MEDIA_METRICS = [
  "views",
  "reach",
  "likes",
  "comments",
  "shares",
  "saved",
  "total_interactions",
  "ig_reels_avg_watch_time",
  "ig_reels_video_view_total_time",
] as const;
export const FB_REEL_METRICS = [
  "blue_reels_play_count",
  "fb_reels_total_plays",
  "fb_reels_replay_count",
  "post_video_avg_time_watched",
  "post_video_view_time",
  "post_impressions_unique",
  "post_video_followers",
  "post_video_social_actions",
] as const;
export const THREADS_MEDIA_METRICS = [
  "views",
  "likes",
  "replies",
  "reposts",
  "quotes",
  "shares",
] as const;

const PERMISSION_FOR: Record<ApiPlatform, string> = {
  instagram: "instagram_manage_insights",
  facebook: "read_insights",
  threads: "threads_manage_insights",
};
const RECONNECT: Record<ApiPlatform, string> = {
  instagram: "http://localhost:8080/connect?account=meta",
  facebook: "http://localhost:8080/connect?account=meta",
  threads: "http://localhost:8080/connect?account=threads",
};

/**
 * The live readers, from the tokens in cfg at call time (a new Meta login applies at once). A missing
 * permission is logged once and that platform's insights rest for six hours, or until the login changes.
 */
export function socialReaders(
  cfg: Config,
  fetchFn: FetchLike = fetch,
): SocialReaders {
  const resting = new Map<ApiPlatform, { until: number; login: string }>();
  const loginKey = (p: ApiPlatform) =>
    p === "threads"
      ? String(safeMtime(cfg.threadsLoginPath))
      : `${(cfg.metaGranted ?? []).join(",")}|${cfg.facebookPageToken.slice(-6)}`;
  // Metrics Meta refused, per platform, forgotten when the login changes (new permissions may allow them).
  const refused = new Map<ApiPlatform, { login: string; set: Set<string> }>();
  const badFor = (p: ApiPlatform): Set<string> => {
    const r = refused.get(p);
    if (r && r.login === loginKey(p)) return r.set;
    const set = new Set<string>();
    refused.set(p, { login: loginKey(p), set });
    return set;
  };
  const bad = {
    get instagram() {
      return badFor("instagram");
    },
    get facebook() {
      return badFor("facebook");
    },
    get threads() {
      return badFor("threads");
    },
  };
  // Any other refusal (not a permission): logged once, the public numbers kept, insights asked again in an hour.
  const unavailable = (p: ApiPlatform, err: unknown) => {
    if (!(err instanceof GraphError)) throw err;
    if (!rests(p))
      log("warn", `${p} insights refused; keeping its public numbers`, {
        error: errorMessage(err).slice(0, 200),
      });
    resting.set(p, { until: Date.now() + 3_600_000, login: loginKey(p) });
  };
  const rests = (p: ApiPlatform) => {
    const r = resting.get(p);
    return Boolean(r && r.until > Date.now() && r.login === loginKey(p));
  };
  const missing = (p: ApiPlatform, err: unknown) => {
    if (!rests(p))
      log(
        "warn",
        `${p} insights need the ${PERMISSION_FOR[p]} permission; reading public numbers only until the owner reconnects at ${RECONNECT[p]}`,
        {
          error: errorMessage(err).slice(0, 200),
        },
      );
    resting.set(p, { until: Date.now() + 6 * 3_600_000, login: loginKey(p) });
  };
  const q = (token: string) => `access_token=${encodeURIComponent(token)}`;
  const out: SocialReaders = { accounts: {} };

  if (cfg.instagramToken && cfg.instagramAccountId) {
    const publicIg = async (id: string): Promise<SocialNumbers> => {
      const b = await graphGet(
        `${GRAPH}/${id}?fields=like_count,comments_count&${q(cfg.instagramToken)}`,
        fetchFn,
      );
      return {
        likes: int(b.like_count),
        comments: int(b.comments_count),
        extra: { source: "public" },
      };
    };
    out.instagram = async (id) => {
      if (!rests("instagram"))
        try {
          const v = await insightsDropping(
            (m) =>
              `${GRAPH}/${id}/insights?metric=${m.join(",")}&${q(cfg.instagramToken)}`,
            IG_MEDIA_METRICS,
            bad.instagram,
            fetchFn,
          );
          if (Object.keys(v).length)
            return {
              views: int(v.views),
              reach: int(v.reach),
              likes: int(v.likes),
              comments: int(v.comments),
              shares: int(v.shares),
              saves: int(v.saved),
              avgWatchSeconds: ms(v.ig_reels_avg_watch_time),
              totalWatchSeconds: ms(v.ig_reels_video_view_total_time),
              extra: { total_interactions: int(v.total_interactions) },
            };
        } catch (err) {
          if (isPermissionError(err)) missing("instagram", err);
          else unavailable("instagram", err);
        }
      return publicIg(id);
    };
    out.accounts!.instagram = async () => {
      const id = cfg.instagramAccountId;
      const prof = await graphGet(
        `${GRAPH}/${id}?fields=followers_count,media_count&${q(cfg.instagramToken)}`,
        fetchFn,
      );
      const extra: Record<string, unknown> = {
        followers: int(prof.followers_count),
        media: int(prof.media_count),
      };
      const numbers: SocialNumbers = { extra };
      if (rests("instagram")) return numbers;
      const until = Math.floor(Date.now() / 1000);
      const since = until - 86_400;
      const span = `since=${since}&until=${until}`;
      // One refused account metric never loses the others (or the follower count read above).
      const ask = (params: string) =>
        graphGet(
          `${GRAPH}/${id}/insights?${params}&${q(cfg.instagramToken)}`,
          fetchFn,
        ).catch((err) => {
          if (!(err instanceof GraphError) || isPermissionError(err)) throw err;
          log("info", "instagram account metric refused", {
            ask: params.split("&")[0],
            error: err.message.slice(0, 160),
          });
          return undefined;
        });
      try {
        const fu = (
          await ask(
            `metric=follows_and_unfollows&period=day&metric_type=total_value&breakdown=follow_type&${span}`,
          )
        )?.data?.[0];
        const split = Object.fromEntries(
          (fu?.total_value?.breakdowns?.[0]?.results ?? []).map((r: any) => [
            String(r.dimension_values?.[0] ?? ""),
            int(r.value) ?? 0,
          ]),
        ) as Record<string, number>;
        numbers.follows = split.FOLLOWER ?? split.FOLLOW;
        extra.unfollows = split.NON_FOLLOWER ?? split.UNFOLLOW;
        extra.follow_breakdown = split;
        numbers.reach = int(
          insightValues(
            await ask(
              `metric=reach&period=day&metric_type=total_value&${span}`,
            ),
          ).reach,
        );
        extra.profile_views = int(
          insightValues(
            await ask(
              `metric=profile_views&period=day&metric_type=total_value&${span}`,
            ),
          ).profile_views,
        );
        // Hour of day (0-23) to followers online. Meta's day boundaries for this metric are Pacific time.
        const online =
          (await ask(`metric=online_followers&period=lifetime&${span}`))
            ?.data?.[0]?.values ?? [];
        const latest = [...online]
          .reverse()
          .find((v: any) => v?.value && Object.keys(v.value).length);
        if (latest) extra.online_followers = latest.value;
        const demo = (
          await ask(
            `metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=country&timeframe=this_month`,
          )
        )?.data?.[0];
        extra.countries = (demo?.total_value?.breakdowns?.[0]?.results ?? [])
          .map((r: any) => ({
            country: String(r.dimension_values?.[0] ?? ""),
            followers: int(r.value) ?? 0,
          }))
          .sort((a: any, b: any) => b.followers - a.followers)
          .slice(0, 10);
      } catch (err) {
        if (!isPermissionError(err)) throw err;
        missing("instagram", err);
      }
      return numbers;
    };
  }

  if (cfg.facebookPageToken && cfg.facebookPageId) {
    out.facebook = async (id) => {
      const pub = await graphGet(
        `${GRAPH}/${id}?fields=views,likes.summary(true).limit(0),comments.summary(true).limit(0)&${q(cfg.facebookPageToken)}`,
        fetchFn,
      );
      const numbers: SocialNumbers = {
        views: int(pub.views),
        likes: int(pub.likes?.summary?.total_count),
        comments: int(pub.comments?.summary?.total_count),
        extra: { source: "public" },
      };
      if (rests("facebook")) return numbers;
      try {
        const v = await insightsDropping(
          (m) =>
            `${GRAPH}/${id}/video_insights?metric=${m.join(",")}&${q(cfg.facebookPageToken)}`,
          FB_REEL_METRICS,
          bad.facebook,
          fetchFn,
        );
        const social = v.post_video_social_actions;
        const actions =
          social && typeof social === "object"
            ? Object.fromEntries(
                Object.entries(social).map(([k, x]) => [
                  k.toLowerCase(),
                  int(x),
                ]),
              )
            : undefined;
        return {
          ...numbers,
          views:
            int(v.fb_reels_total_plays) ??
            int(v.blue_reels_play_count) ??
            numbers.views,
          reach: int(v.post_impressions_unique),
          shares: actions?.share ?? actions?.shares,
          avgWatchSeconds: ms(v.post_video_avg_time_watched),
          totalWatchSeconds: ms(v.post_video_view_time),
          follows: int(v.post_video_followers),
          extra: {
            replays: int(v.fb_reels_replay_count),
            initial_plays: int(v.blue_reels_play_count),
            social_actions: actions ?? int(social),
          },
        };
      } catch (err) {
        if (isPermissionError(err)) missing("facebook", err);
        else unavailable("facebook", err);
        return numbers;
      }
    };
    out.accounts!.facebook = async () => {
      const b = await graphGet(
        `${GRAPH}/${cfg.facebookPageId}?fields=followers_count,fan_count&${q(cfg.facebookPageToken)}`,
        fetchFn,
      );
      return {
        extra: { followers: int(b.followers_count), fans: int(b.fan_count) },
      };
    };
  }

  if (cfg.threadsLoginPath && fs.existsSync(cfg.threadsLoginPath)) {
    out.threads = async (id) => {
      if (rests("threads")) return undefined;
      const login = await threadsLogin(cfg.threadsLoginPath, fetchFn);
      try {
        const v = await insightsDropping(
          (m) =>
            `${THREADS}/${id}/insights?metric=${m.join(",")}&${q(login.token)}`,
          THREADS_MEDIA_METRICS,
          bad.threads,
          fetchFn,
        );
        return {
          views: int(v.views),
          likes: int(v.likes),
          comments: int(v.replies),
          shares: int(v.shares),
          extra: { reposts: int(v.reposts), quotes: int(v.quotes) },
        };
      } catch (err) {
        if (isPermissionError(err)) missing("threads", err);
        else unavailable("threads", err);
        return undefined;
      }
    };
    out.accounts!.threads = async () => {
      if (rests("threads")) return undefined;
      const login = await threadsLogin(cfg.threadsLoginPath, fetchFn);
      try {
        const v = insightValues(
          await graphGet(
            `${THREADS}/me/threads_insights?metric=followers_count&${q(login.token)}`,
            fetchFn,
          ),
        );
        return { extra: { followers: int(v.followers_count) } };
      } catch (err) {
        if (!isPermissionError(err)) throw err;
        missing("threads", err);
        return undefined;
      }
    };
  }
  return out;
}

function safeMtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** One pass for the scheduler: the posts that are due, then each account once a day. */
export async function socialMetricsTick(
  db: Db,
  cfg: Config,
  readers: SocialReaders,
  now: Date,
): Promise<{ posts: number; accounts: number }> {
  const posts = await captureSocialMetrics(db, readers, now);
  const accounts = await captureSocialAccounts(db, readers, now, cfg.timezone);
  return { posts, accounts };
}

// ------------------------------------------------------------------ TikTok, from the Studio routine

/** "1,234", "1.2K", "3.4M", "35%", 12: a count as TikTok Studio shows it. */
export function parseCount(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const m = v
    .trim()
    .replace(/,/g, "")
    .match(/^(-?\d+(?:\.\d+)?)\s*([kmb])?\s*%?$/i);
  if (!m) return undefined;
  const scale =
    { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? "").toLowerCase() as "k"] ?? 1;
  return Number(m[1]) * scale;
}

/** Seconds from 12, "12.5s", "1m 3s", "2h 1m 3s" or "1:02:03". */
export function parseSeconds(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
  if (/^\d+(?::\d{1,2}){1,2}$/.test(s))
    return s.split(":").reduce((a, p) => a * 60 + Number(p), 0);
  const parts = [
    ...s.matchAll(
      /(\d+(?:\.\d+)?)\s*(h|hr|hours?|m|min|minutes?|s|sec|seconds?)\b/g,
    ),
  ];
  if (!parts.length) return undefined;
  return parts.reduce(
    (a, [, n, u]) =>
      a + Number(n) * (u!.startsWith("h") ? 3600 : u!.startsWith("m") ? 60 : 1),
    0,
  );
}

const words = (t: string) =>
  new Set(
    (
      t
        .toLowerCase()
        .replace(/#/g, " ")
        .match(/[a-z0-9$']{3,}/g) ?? []
    ).filter(
      (w) =>
        !/^(the|and|for|you|your|with|this|that|are|was|has|have|its|it's|from|but|not|now|just|narrated|voice)$/.test(
          w,
        ),
    ),
  );

/** How much of the shorter text's words the other shares (0 to 1). */
export function captionSimilarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size);
}

export interface TikTokCandidate {
  episodeId: string;
  youtubeVideoId: string | null;
  title: string;
  caption: string;
  hook: string;
  sentAt: Date;
}

/**
 * The episode a TikTok video is: the draft whose caption (or title and hook) its caption matches best, never
 * one sent after the video was posted, a little against drafts sent long before it. Nothing under 40% shared words.
 */
export function matchTikTok(
  video: { text: string; postedAt?: Date },
  candidates: TikTokCandidate[],
): TikTokCandidate | undefined {
  let best: { c: TikTokCandidate; score: number } | undefined;
  for (const c of candidates) {
    const sim = Math.max(
      captionSimilarity(video.text, c.caption),
      captionSimilarity(video.text, `${c.title} ${c.hook}`),
    );
    if (sim < 0.4) continue;
    let score = sim;
    if (video.postedAt) {
      const days = (video.postedAt.getTime() - c.sentAt.getTime()) / 86_400_000;
      if (days < -2 / 24) continue; // posted before the draft existed
      score -= 0.02 * Math.min(days, 10);
    }
    if (!best || score > best.score) best = { c, score };
  }
  return best?.c;
}

/** Shorts sent to the owner's TikTok inbox in the last month, with the caption the owner was given. */
export async function tiktokCandidates(
  db: Db,
  now: Date,
): Promise<TikTokCandidate[]> {
  const rows = await db.query<{
    episode_id: string;
    youtube_video_id: string | null;
    script_json: Script | null;
    sent_at: string;
    caption: string | null;
  }>(
    `SELECT v.episode_id, e.youtube_video_id, e.script_json, v.created_at AS sent_at,
            (SELECT c.detail->>'caption' FROM events c WHERE c.episode_id = v.episode_id AND c.kind = 'tiktok_caption' ORDER BY c.id DESC LIMIT 1) AS caption
       FROM events v JOIN episodes e ON e.id = v.episode_id
      WHERE v.kind = 'crosspost' AND v.detail->>'platform' = 'tiktok' AND v.created_at > $1::timestamptz - interval '30 days'
      ORDER BY v.created_at DESC`,
    [now],
  );
  return rows.map((r) => {
    const script = r.script_json;
    return {
      episodeId: r.episode_id,
      youtubeVideoId: r.youtube_video_id,
      title: script ? polishTitle(script) : "",
      hook: script?.hook ?? "",
      caption:
        r.caption ??
        (script && r.youtube_video_id
          ? socialCaption("tiktok", script, r.youtube_video_id)
          : ""),
      sentAt: new Date(r.sent_at),
    };
  });
}

const text = (v: unknown, max = 600) =>
  typeof v === "string" ? v.replace(/\p{C}/gu, " ").trim().slice(0, max) : "";

/**
 * What the TikTok Studio routine posts: per video its numbers, matched to an episode and stored under the age it
 * has reached (a later reading at the same age replaces the earlier one), plus the account's numbers for the day.
 */
export async function recordTikTokStats(
  db: Db,
  cfg: Pick<Config, "timezone">,
  body: unknown,
  now: Date,
): Promise<{
  matched: Array<{ caption: string; episode: string; label: string }>;
  unmatched: string[];
  account: boolean;
}> {
  if (!body || typeof body !== "object")
    throw new Error('expected {"videos":[...],"account":{...}}');
  const b = body as { videos?: unknown; account?: unknown };
  const videos = Array.isArray(b.videos) ? b.videos.slice(0, 200) : [];
  if (b.videos !== undefined && !Array.isArray(b.videos))
    throw new Error("videos must be a list");
  const candidates = await tiktokCandidates(db, now);
  const matched: Array<{ caption: string; episode: string; label: string }> =
    [];
  const unmatched: string[] = [];
  for (const raw of videos) {
    if (!raw || typeof raw !== "object") continue;
    const v = raw as Record<string, unknown>;
    const caption = text(v.caption) || text(v.title);
    const postedAt =
      typeof v.posted_at === "string" && !Number.isNaN(Date.parse(v.posted_at))
        ? new Date(v.posted_at)
        : undefined;
    const c = caption
      ? matchTikTok({ text: caption, postedAt }, candidates)
      : undefined;
    if (!c) {
      if (caption) unmatched.push(caption.slice(0, 80));
      continue;
    }
    const from = postedAt ?? c.sentAt;
    const label = ageLabel((now.getTime() - from.getTime()) / 3_600_000);
    const traffic =
      v.traffic && typeof v.traffic === "object"
        ? Object.fromEntries(
            Object.entries(v.traffic as Record<string, unknown>)
              .slice(0, 12)
              .map(([k, x]) => [k.slice(0, 20), parseCount(x)]),
          )
        : undefined;
    await saveSocial(db, {
      platform: "tiktok",
      postId: `ep:${c.episodeId}`,
      episodeId: c.episodeId,
      youtubeVideoId: c.youtubeVideoId,
      label,
      capturedAt: now,
      replace: true,
      numbers: {
        views: parseCount(v.views),
        likes: parseCount(v.likes),
        comments: parseCount(v.comments),
        shares: parseCount(v.shares),
        saves: parseCount(v.saves),
        follows: parseCount(v.new_followers),
        avgWatchSeconds: parseSeconds(v.avg_watch_seconds),
        totalWatchSeconds: parseSeconds(v.total_play_time),
        extra: {
          caption: caption.slice(0, 200),
          posted_at: postedAt?.toISOString(),
          video_id: text(v.video_id, 40) || undefined,
          watched_full_pct: parseCount(v.watched_full_pct),
          stopped_at_second: parseSeconds(v.stopped_at_second),
          traffic,
          search_terms: Array.isArray(v.search_terms)
            ? v.search_terms
                .slice(0, 20)
                .map((t) => text(t, 80))
                .filter(Boolean)
            : undefined,
          age_hours:
            Math.round(((now.getTime() - from.getTime()) / 3_600_000) * 10) /
            10,
        },
      },
    });
    matched.push({
      caption: caption.slice(0, 80),
      episode: c.episodeId,
      label,
    });
  }
  let account = false;
  if (b.account && typeof b.account === "object") {
    const a = b.account as Record<string, unknown>;
    const hours = Array.isArray(a.active_hours)
      ? a.active_hours.slice(0, 24)
      : undefined;
    await saveSocial(db, {
      platform: "tiktok",
      postId: "account",
      label: dayKey(now, cfg.timezone),
      capturedAt: now,
      replace: true,
      numbers: {
        follows: parseCount(a.net_growth),
        extra: {
          followers: parseCount(a.followers),
          profile_views: parseCount(a.profile_views),
          // Either 24 numbers by hour or [{hour, value}], in the hours TikTok Studio shows (this PC's time zone).
          active_hours: hours?.map((h) =>
            h && typeof h === "object"
              ? {
                  hour: parseCount((h as any).hour),
                  value: parseCount((h as any).value ?? (h as any).followers),
                }
              : parseCount(h),
          ),
          active_hours_timezone: text(a.timezone, 40) || cfg.timezone,
          top_territories: Array.isArray(a.top_territories)
            ? a.top_territories
                .slice(0, 10)
                .map((t) =>
                  t && typeof t === "object"
                    ? {
                        name: text((t as any).name ?? (t as any).country, 40),
                        share: parseCount(
                          (t as any).share ?? (t as any).percent,
                        ),
                      }
                    : text(t, 40),
                )
            : undefined,
        },
      },
    });
    account = true;
  }
  return { matched, unmatched, account };
}

/** For the routine: what to look for in TikTok Studio, and which posts still lack a 24 h or 7 d reading. */
export async function tiktokStatus(
  db: Db,
  now: Date,
): Promise<
  Array<{
    episode: string;
    youtube_video_id: string | null;
    title: string;
    caption_first_line: string;
    draft_sent_at: string;
    have: string[];
    needs: string[];
  }>
> {
  const cands = await tiktokCandidates(db, now);
  const have = new Map<string, { labels: Set<string>; postedAt?: string }>();
  for (const r of await db.query<{
    episode_id: string;
    label: string;
    posted_at: string | null;
  }>(
    `SELECT episode_id, label, extra->>'posted_at' AS posted_at FROM social_metrics WHERE platform = 'tiktok' AND post_id <> 'account'`,
  )) {
    const h = have.get(r.episode_id) ?? { labels: new Set<string>() };
    h.labels.add(r.label);
    h.postedAt ??= r.posted_at ?? undefined;
    have.set(r.episode_id, h);
  }
  return cands.map((c) => {
    const h = have.get(c.episodeId);
    const labels = h?.labels ?? new Set<string>();
    const from = h?.postedAt ? new Date(h.postedAt) : c.sentAt;
    const hours = (now.getTime() - from.getTime()) / 3_600_000;
    const needs: string[] = [];
    if (hours >= 24 && !["24h", "72h", "7d"].some((l) => labels.has(l)))
      needs.push("24h");
    if (hours >= 168 && !labels.has("7d")) needs.push("7d");
    return {
      episode: c.episodeId,
      youtube_video_id: c.youtubeVideoId,
      title: c.title,
      caption_first_line: c.caption.split("\n")[0] ?? "",
      draft_sent_at: c.sentAt.toISOString(),
      have: [...labels],
      needs,
    };
  });
}

// The social scoreboard (SOCIAL_SCOREBOARD): one honest line per platform for the Sunday growth report, and the short list
// of things gone quiet for the morning alert digest. Only reads what the factory already stores, no API or model calls.

import type { Db } from "../db.ts";
import { firstCommentStats } from "./commentcheck.ts";

export const BOARD_PLATFORMS = [
  "instagram",
  "facebook",
  "threads",
  "tiktok",
  "bluesky",
] as const;

export interface BoardRow {
  platform: string;
  posts: number;
  failed: number;
  views?: number;
  comments?: number;
  answered?: number;
  followers?: number;
  followersBefore?: number;
}

export interface Board {
  rows: BoardRow[];
  youtube: {
    videos: number;
    comments: number;
    answered: number;
    followUps: number;
  };
  firstComments: { checked: number; hidden: number };
}

const DAY = 86_400_000;

async function countByPlatform(
  db: Db,
  kind: string,
  from: Date,
  to: Date,
): Promise<Map<string, number>> {
  const rows = await db.query<{ p: string; n: string }>(
    `SELECT detail->>'platform' AS p, count(*) AS n FROM events
      WHERE kind = $1 AND created_at > $2 AND created_at <= $3 GROUP BY 1`,
    [kind, from, to],
  );
  return new Map(rows.map((r) => [r.p, Number(r.n)]));
}

export async function socialBoard(db: Db, now: Date): Promise<Board> {
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const posts = await countByPlatform(db, "crosspost", weekAgo, now);
  const failed = await countByPlatform(db, "crosspost_failed", weekAgo, now);
  const numbers = await db.query<{
    platform: string;
    views: string | null;
    comments: string | null;
  }>(
    `WITH latest AS (
       SELECT DISTINCT ON (platform, post_id) platform, post_id, views, comments FROM social_metrics
        WHERE post_id <> 'account' AND captured_at > $1 ORDER BY platform, post_id, captured_at DESC)
     SELECT platform, sum(views) AS views, sum(comments) AS comments FROM latest GROUP BY 1`,
    [weekAgo],
  );
  const accounts = await db.query<{ platform: string; extra: any }>(
    `SELECT platform, extra FROM social_metrics WHERE post_id = 'account' AND captured_at > $1 ORDER BY captured_at`,
    [new Date(now.getTime() - 8 * DAY)],
  );
  const answered = await db.query<{ p: string; n: string }>(
    `SELECT left(video_id, 3) AS p, count(*) AS n FROM comment_replies
      WHERE decision = 'reply' AND video_id ~ '^(ig|fb):' AND created_at > $1 GROUP BY 1`,
    [weekAgo],
  );
  const answeredOf = (p: string) =>
    Number(
      answered.find((a) => a.p === (p === "instagram" ? "ig:" : "fb:"))?.n ?? 0,
    );
  const followers = (extra: any) => {
    const raw = typeof extra === "string" ? JSON.parse(extra) : extra;
    const n = raw?.followers;
    return typeof n === "number" ? n : undefined;
  };
  const rows: BoardRow[] = BOARD_PLATFORMS.map((platform) => {
    const n = numbers.find((x) => x.platform === platform);
    const acc = accounts.filter((a) => a.platform === platform);
    return {
      platform,
      posts: posts.get(platform) ?? 0,
      failed: failed.get(platform) ?? 0,
      ...(n
        ? {
            views: n.views === null ? undefined : Number(n.views),
            comments: n.comments === null ? undefined : Number(n.comments),
          }
        : {}),
      ...(platform === "instagram" || platform === "facebook"
        ? { answered: answeredOf(platform) }
        : {}),
      followers: acc.length ? followers(acc.at(-1)!.extra) : undefined,
      followersBefore: acc.length ? followers(acc[0]!.extra) : undefined,
    };
  });
  const [yt] = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM episodes WHERE status = 'published' AND lane <> 'twin' AND coalesce(publish_at, updated_at) > $1 AND coalesce(publish_at, updated_at) <= $2`,
    [weekAgo, now],
  );
  const [c] = await db.query<{ total: string; rep: string; fu: string }>(
    `SELECT count(*) AS total, count(*) FILTER (WHERE decision = 'reply') AS rep,
            count(*) FILTER (WHERE decision = 'reply' AND comment_id LIKE '%.%') AS fu
       FROM comment_replies WHERE video_id !~ '^(ig|fb):' AND created_at > $1`,
    [weekAgo],
  );
  return {
    rows,
    youtube: {
      videos: Number(yt?.n ?? 0),
      comments: Number(c?.total ?? 0),
      answered: Number(c?.rep ?? 0),
      followUps: Number(c?.fu ?? 0),
    },
    firstComments: await firstCommentStats(db, now),
  };
}

const LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  tiktok: "TikTok drafts",
  bluesky: "Bluesky",
};

/** The Sunday report's section (pure). */
export function scoreboardLines(b: Board): string[] {
  const fc = b.firstComments;
  const lines = [
    "",
    "**Socials, last 7 days**",
    `YouTube: ${b.youtube.videos} videos, ${b.youtube.comments} viewer comments read, ${b.youtube.answered} answered${b.youtube.followUps ? ` (${b.youtube.followUps} carried on a conversation)` : ""}${fc.checked ? `, first comments hidden on ${fc.hidden} of ${fc.checked} checked` : ""}.`,
  ];
  for (const r of b.rows) {
    if (!r.posts && !r.failed && r.followers === undefined) {
      lines.push(`${LABEL[r.platform]}: nothing posted.`);
      continue;
    }
    const bits = [`${r.posts} posted`];
    if (r.failed) bits.push(`${r.failed} failed`);
    bits.push(r.views === undefined ? "no view numbers" : `${r.views} views`);
    if (r.comments !== undefined)
      bits.push(
        `${r.comments} comments${r.answered !== undefined ? `, ${r.answered} answered` : ""}`,
      );
    if (r.followers !== undefined) {
      const moved = r.followers - (r.followersBefore ?? r.followers);
      bits.push(
        `${r.followers} followers (${moved >= 0 ? "+" : ""}${moved} this week)`,
      );
    }
    lines.push(`${LABEL[r.platform]}: ${bits.join(", ")}.`);
  }
  return lines;
}

/** What has gone quiet or started failing: for the morning digest, empty on a normal day. */
export async function socialProblems(db: Db, now: Date): Promise<string[]> {
  const out: string[] = [];
  const day = new Date(now.getTime() - DAY);
  const twoDays = new Date(now.getTime() - 2 * DAY);
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const recent = await countByPlatform(db, "crosspost", twoDays, now);
  const before = await countByPlatform(db, "crosspost", weekAgo, twoDays);
  for (const [p, n] of before)
    if (n > 0 && !recent.get(p))
      out.push(
        `${LABEL[p] ?? p} has posted nothing for two days (${n} in the five days before).`,
      );
  for (const [p, n] of await countByPlatform(db, "crosspost_failed", day, now))
    if (n >= 5) out.push(`${LABEL[p] ?? p} failed ${n} times in 24 hours.`);
  const fc = await firstCommentStats(db, now);
  if (fc.checked >= 5 && fc.hidden / fc.checked >= 0.5)
    out.push(
      `First comments hidden from viewers on ${fc.hidden} of ${fc.checked} videos checked.`,
    );
  return out;
}

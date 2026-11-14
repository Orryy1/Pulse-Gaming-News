// Is the channel's first comment actually visible? (FIRST_COMMENT_CHECK.) On 4 Nov 2026 the public comment list of 68 of
// the 70 videos checked showed none of the channel's own first comments, though YouTube counted them ("1 Comment" over an
// empty list), in a signed-out read and in another signed-in account; the two that showed were pinned. The factory had
// logged every one as posted. This reads the list a visitor sees (no login, no quota), logs the result per video and tells
// the owner once a week if most are hidden. One quota unit per hidden comment asks YouTube for its moderation status, which
// is what says why.

import type { Db } from "../db.ts";
import { logEvent } from "../episodes.ts";
import { QUOTA, quotaAdd } from "../lanes.ts";
import { errorMessage, log } from "../lib/util.ts";
import type { YouTubeClient } from "../youtube/upload.ts";

type FetchLike = typeof fetch;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export interface PublicComment {
  id: string;
  text: string;
  byChannel: boolean;
}

/** The comments in YouTube's reply to the page's comment request (pure). */
export function parsePublicComments(body: unknown): PublicComment[] {
  const mutations: any[] =
    (body as any)?.frameworkUpdates?.entityBatchUpdate?.mutations ?? [];
  return mutations
    .map((m) => m?.payload?.commentEntityPayload)
    .filter(Boolean)
    .map((p) => ({
      id: String(p.properties?.commentId ?? ""),
      text: String(p.properties?.content?.content ?? ""),
      byChannel: Boolean(p.author?.isCreator),
    }));
}

/** The first page of a video's comments as a signed-out visitor gets it; undefined when the page could not be read. */
export async function readPublicComments(
  videoId: string,
  fetchFn: FetchLike = fetch,
): Promise<PublicComment[] | undefined> {
  const page = await fetchFn(
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=US`,
    {
      headers: {
        "user-agent": UA,
        "accept-language": "en",
        cookie: "SOCS=CAI",
      },
    },
  );
  if (!page.ok) return undefined;
  const html = await page.text();
  const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const version = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1];
  const token = [
    ...html.matchAll(
      /"continuationCommand":\{"token":"([^"]+)","request":"CONTINUATION_REQUEST_TYPE_WATCH_NEXT"/g,
    ),
  ].at(-1)?.[1];
  if (!key || !version || !token) return undefined;
  const res = await fetchFn(
    `https://www.youtube.com/youtubei/v1/next?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": UA },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB",
            clientVersion: version,
            hl: "en",
            gl: "US",
          },
        },
        continuation: token,
      }),
    },
  );
  if (!res.ok) return undefined;
  return parsePublicComments(await res.json());
}

export const CHECK_LIMITS = {
  minAgeHours: 6, // YouTube needs a little while to list a new comment
  maxAgeDays: 5,
  perPass: 6,
  alertMinChecks: 5,
  alertShare: 0.5,
  alertEveryDays: 7,
} as const;

export interface CheckDeps {
  db: Db;
  now: () => Date;
  fetchFn?: FetchLike;
  youtube?: () => YouTubeClient;
  notify: (m: { content: string; level?: "info" }) => Promise<unknown>;
}

/** The last week's checks: how many looked and how many first comments were not on the public list. */
export async function firstCommentStats(
  db: Db,
  now: Date,
  days = 7,
): Promise<{ checked: number; hidden: number }> {
  const [r] = await db.query<{ checked: string; hidden: string }>(
    `SELECT count(*) AS checked, count(*) FILTER (WHERE detail->>'visible' = 'false') AS hidden FROM events
      WHERE kind = 'first_comment_check' AND created_at > $1::timestamptz - make_interval(days => $2)`,
    [now, days],
  );
  return { checked: Number(r?.checked ?? 0), hidden: Number(r?.hidden ?? 0) };
}

/** One pass: a few comments old enough to judge. Returns how many were checked. */
export async function firstCommentCheckTick(d: CheckDeps): Promise<number> {
  const now = d.now();
  const due = await d.db.query<{
    episode_id: string;
    video: string;
    comment: string;
  }>(
    `SELECT c.episode_id, e.youtube_video_id AS video, c.detail->>'id' AS comment
       FROM events c JOIN episodes e ON e.id = c.episode_id
      WHERE c.kind = 'comment_posted' AND e.youtube_video_id IS NOT NULL AND e.status = 'published'
        AND c.created_at < $1::timestamptz - make_interval(hours => $2)
        AND c.created_at > $1::timestamptz - make_interval(days => $3)
        AND NOT EXISTS (SELECT 1 FROM events k WHERE k.kind = 'first_comment_check' AND k.episode_id = c.episode_id)
      ORDER BY c.id DESC LIMIT $4`,
    [
      now,
      CHECK_LIMITS.minAgeHours,
      CHECK_LIMITS.maxAgeDays,
      CHECK_LIMITS.perPass,
    ],
  );
  let checked = 0;
  for (const row of due) {
    let list: PublicComment[] | undefined;
    try {
      list = await readPublicComments(row.video, d.fetchFn);
    } catch (err) {
      log("info", "first comment check could not read the page", {
        video: row.video,
        error: errorMessage(err),
      });
    }
    // A page we could not read says nothing, and a full page may simply not reach ours.
    if (!list || list.length >= 20) continue;
    const visible = list.some((c) => c.byChannel);
    let moderation: string | undefined;
    if (!visible && d.youtube) {
      moderation = await d
        .youtube()
        .commentStatus(row.comment)
        .then(async (s) => (await quotaAdd(d.db, now, QUOTA.poll), s))
        .catch(() => undefined);
    }
    await logEvent(d.db, row.episode_id, "first_comment_check", {
      video: row.video,
      visible,
      ...(moderation ? { moderation } : {}),
    });
    checked++;
  }
  if (checked) await alertIfHidden(d, now);
  return checked;
}

async function alertIfHidden(d: CheckDeps, now: Date): Promise<void> {
  const s = await firstCommentStats(d.db, now);
  if (
    s.checked < CHECK_LIMITS.alertMinChecks ||
    s.hidden / s.checked < CHECK_LIMITS.alertShare
  )
    return;
  const [row] = await d.db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'first_comment_alert'`,
  );
  if (
    row &&
    now.getTime() - new Date(row.value).getTime() <
      CHECK_LIMITS.alertEveryDays * 86_400_000
  )
    return;
  await d.db.query(
    `INSERT INTO settings (key, value) VALUES ('first_comment_alert', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [now.toISOString()],
  );
  await d.notify({
    level: "info",
    content: `Viewers cannot see most of the channel's first comments: ${s.hidden} of the last ${s.checked} checked are missing from the public list. The questions they carry are not reaching anyone.`,
  });
}

/** Recent first comments the Studio routine should pin (pinned ones were the only ones showing). */
export async function pinPlan(
  db: Db,
  now: Date,
  done: string[],
  max = 5,
): Promise<Array<{ video: string; url: string; text: string }>> {
  const rows = await db.query<{ video: string; text: string }>(
    `SELECT DISTINCT ON (e.youtube_video_id) e.youtube_video_id AS video, c.detail->>'text' AS text
       FROM events c JOIN episodes e ON e.id = c.episode_id
      WHERE c.kind = 'comment_posted' AND e.status = 'published' AND e.lane <> 'twin' AND e.youtube_video_id IS NOT NULL
        AND c.created_at > $1::timestamptz - interval '3 days'
      ORDER BY e.youtube_video_id, c.id DESC`,
    [now],
  );
  return rows
    .filter((r) => !done.includes(r.video))
    .slice(0, max)
    .map((r) => ({
      video: r.video,
      url: `https://www.youtube.com/watch?v=${r.video}`,
      text: r.text,
    }));
}

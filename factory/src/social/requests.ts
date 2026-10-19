// What viewers ask us to rank next. The long ranking video's pinned comment asks; once a day the
// factory reads the comments on the last month's long videos (one quota unit each), a cheap model
// pulls out the series people named, and the tally steers the ranking topic pickers. Stored in the
// settings table under "audience_requests".
import { z } from "zod";
import type { Db } from "../db.ts";
import type { Llm } from "../editorial/llm.ts";
import { QUOTA, quotaAdd } from "../lanes.ts";
import { errorMessage, log } from "../lib/util.ts";
import type { YouTubeClient } from "../youtube/upload.ts";

const KEY = "audience_requests";

const RequestsSchema = z.object({
  requests: z
    .array(
      z.object({
        name: z
          .string()
          .describe(
            "The series or game as commonly written, e.g. 'Metal Gear Solid'",
          ),
        count: z.number().int(),
      }),
    )
    .describe(
      "Series or games viewers asked us to rank or cover next, with how many separate comments asked. Empty if none",
    ),
});

export interface AudienceRequests {
  at: string;
  requests: Array<{ name: string; count: number }>;
}

export async function readRequests(
  db: Db,
): Promise<AudienceRequests | undefined> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [KEY],
  );
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as AudienceRequests;
  } catch {
    return undefined;
  }
}

/** The line the topic pickers read, or nothing when no one has asked yet. */
export function requestsBlock(r: AudienceRequests | undefined): string {
  const top = (r?.requests ?? []).filter((x) => x.count > 0).slice(0, 8);
  if (!top.length) return "";
  return `Viewers asked us to rank next (comments on our long videos, last 30 days): ${top.map((x) => `${x.name} (${x.count})`).join(", ")}.`;
}

/** Reads the comments and refreshes the tally, at most once a day. Returns the number of comments read. */
export async function collectRequests(d: {
  db: Db;
  youtube: () => YouTubeClient;
  llm: Llm;
  now: Date;
}): Promise<number> {
  const prior = await readRequests(d.db);
  if (prior && d.now.getTime() - new Date(prior.at).getTime() < 20 * 3600_000)
    return 0;
  const videos = await d.db.query<{ youtube_video_id: string }>(
    `SELECT youtube_video_id FROM episodes WHERE lane = 'longform' AND status = 'published' AND youtube_video_id IS NOT NULL
       AND coalesce(publish_at, updated_at) > $1::timestamptz - interval '30 days'`,
    [d.now],
  );
  const yt = d.youtube();
  const own = await yt.myChannelId().catch(() => "");
  const texts: string[] = [];
  for (const v of videos) {
    try {
      const comments = await yt.listComments(v.youtube_video_id);
      await quotaAdd(d.db, d.now, QUOTA.poll);
      texts.push(
        ...comments
          .filter((c) => c.authorChannelId !== own)
          .map((c) => c.text.replace(/\s+/g, " ").slice(0, 300)),
      );
    } catch (err) {
      log("warn", "request comments unavailable", {
        video: v.youtube_video_id,
        error: errorMessage(err),
      });
    }
  }
  let requests: AudienceRequests["requests"] = [];
  if (texts.length) {
    const out = await d.llm.structured({
      system:
        'You read YouTube comments on a gaming channel\'s ranking videos. List the game series or games that commenters ask the channel to rank or cover next ("do Halo next", "rank the Metal Gear games"). Count each comment once per series. Ignore opinions about the video itself and games mentioned only as part of the current ranking. Return an empty list if no one asked.',
      content: texts
        .slice(0, 300)
        .map((t, i) => `${i + 1}. ${t}`)
        .join("\n"),
      schema: RequestsSchema,
      tier: "low",
      effort: "low",
    });
    requests = out.requests
      .filter((r) => r.name.trim() && r.count > 0)
      .sort((a, b) => b.count - a.count);
  }
  await d.db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [
      KEY,
      JSON.stringify({
        at: d.now.toISOString(),
        requests,
      } satisfies AudienceRequests),
    ],
  );
  if (requests.length)
    log("info", "audience requests updated", {
      comments: texts.length,
      top: requests.slice(0, 3),
    });
  return texts.length;
}

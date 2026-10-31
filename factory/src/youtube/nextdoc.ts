// "Next: ..." for a documentary's end card and the top of its description. YouTube's Data API cannot set
// end screens, so the factory renders its own: the channel's most recent public documentary, with its
// thumbnail, is the one a viewer who stayed to the end is sent to. "Most recent public" means an episode
// row that is published, long, a documentary, has a video id and whose publish time (when scheduled) has
// passed; the episode being made is never its own next.

import type { Db } from "../db.ts";

export interface NextDoc {
  id: string;
  videoId: string;
  title: string;
  /** The thumbnail file inside that episode's folder (assets.thumb), when it kept one. */
  thumb: string | null;
}

export async function latestPublicDocumentary(
  db: Db,
  now: Date,
  excludeId = "",
): Promise<NextDoc | undefined> {
  const [row] = await db.query<{
    id: string;
    video_id: string;
    title: string | null;
    thumb: string | null;
  }>(
    `SELECT id, youtube_video_id AS video_id,
            script_json->'youtube'->>'title' AS title,
            assets_json->>'thumb' AS thumb
       FROM episodes
      WHERE status = 'published'
        AND youtube_video_id IS NOT NULL
        AND script_json->>'runtime' = 'long'
        AND script_json->>'evergreen_format' = 'documentary'
        AND (publish_at IS NULL OR publish_at <= $1::timestamptz)
        AND id <> $2
      ORDER BY COALESCE(publish_at, updated_at) DESC
      LIMIT 1`,
    [now, excludeId],
  );
  if (!row?.title) return undefined;
  return {
    id: row.id,
    videoId: row.video_id,
    title: row.title,
    thumb: row.thumb,
  };
}

/** The description's second line: where to go next, as a full link so YouTube makes it clickable. */
export function nextLine(
  next: Pick<NextDoc, "title" | "videoId"> | undefined,
): string {
  return next ? `Next: ${next.title} https://youtu.be/${next.videoId}` : "";
}

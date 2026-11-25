// The age-restriction alarm (AGE_ALARM, default off; owner, 19 Nov 2026). An age-restricted video is shown to almost
// nobody: no Shorts feed, no signed-out viewers, no ads. YouTube says so only in Studio. Every hour this asks the
// YouTube Data API, with the channel's own login, about Pulse's uploads from the last 14 days in one batched
// videos.list call (one quota unit for up to 50 videos): contentDetails.contentRating.ytRating === "ytAgeRestricted".
// Each newly restricted video gets one Discord line naming its title and link and what to do (appeal in Studio or
// re-cut), and an "age_restricted_alert" event so it is never reported twice. Never the download account
// (YTDLP_COOKIES_FILE): nothing here signs in to YouTube as anyone but the channel.

import type { Db } from "./db.ts";
import { logEvent } from "./episodes.ts";
import { QUOTA, quotaAdd } from "./lanes.ts";
import { errorMessage, log } from "./lib/util.ts";
import type { YouTubeClient } from "./youtube/upload.ts";

export const AGE_ALARM = {
  /** Uploads this recent are checked. */
  days: 14,
  /** One videos.list call takes 50 ids. */
  perCall: 50,
  /** The event that marks a video as reported. */
  kind: "age_restricted_alert",
} as const;

export interface AgeRating {
  id: string;
  title: string;
  ageRestricted: boolean;
  privacy?: string;
  uploadStatus?: string;
}

/** The age rating of each video in a videos.list answer (pure). */
export function ageRatingsFrom(
  items: ReadonlyArray<Record<string, unknown>>,
): AgeRating[] {
  return items.map((raw) => {
    const it = raw as {
      id?: unknown;
      snippet?: { title?: unknown };
      contentDetails?: { contentRating?: { ytRating?: unknown } };
      status?: { privacyStatus?: unknown; uploadStatus?: unknown };
    };
    return {
      id: String(it.id ?? ""),
      title: String(it.snippet?.title ?? ""),
      ageRestricted:
        it.contentDetails?.contentRating?.ytRating === "ytAgeRestricted",
      ...(it.status?.privacyStatus
        ? { privacy: String(it.status.privacyStatus) }
        : {}),
      ...(it.status?.uploadStatus
        ? { uploadStatus: String(it.status.uploadStatus) }
        : {}),
    };
  });
}

/** The owner's one line for a newly age-restricted video (pure). */
export function ageAlarmLine(title: string, videoId: string): string {
  const name = title.trim() ? `"${title.trim()}"` : "One of our videos";
  return (
    `🔞 YouTube has age-restricted ${name} (https://youtu.be/${videoId}). Age-restricted videos reach almost nobody ` +
    `and earn nothing, so appeal in Studio or re-cut it.`
  );
}

export interface AgeAlarmDeps {
  db: Db;
  youtube: () => Pick<YouTubeClient, "ageRatings">;
  notify: (m: { content: string; level?: "info" }) => Promise<unknown>;
  now: () => Date;
}

/**
 * One hourly pass: Pulse's uploads from the last 14 days not yet reported, newest first, at most 50, asked about in
 * one videos.list call; each age-restricted one is reported once. Returns how many were reported.
 */
export async function ageAlarmTick(d: AgeAlarmDeps): Promise<number> {
  const now = d.now();
  const rows = await d.db.query<{ id: string; video: string }>(
    `SELECT e.id, e.youtube_video_id AS video
       FROM episodes e
      WHERE e.youtube_video_id IS NOT NULL AND e.status IN ('uploaded', 'published')
        AND COALESCE(e.publish_at, e.created_at) > $1::timestamptz - make_interval(days => $2)
        AND NOT EXISTS (SELECT 1 FROM events k WHERE k.kind = $3 AND k.episode_id = e.id)
      ORDER BY COALESCE(e.publish_at, e.created_at) DESC
      LIMIT $4`,
    [now, AGE_ALARM.days, AGE_ALARM.kind, AGE_ALARM.perCall],
  );
  if (!rows.length) return 0;
  const episodeOf = new Map(rows.map((r) => [r.video, r.id]));
  let items: Array<Record<string, unknown>>;
  try {
    items = await d.youtube().ageRatings([...episodeOf.keys()]);
  } catch (err) {
    log("warn", "age alarm: videos.list failed", { error: errorMessage(err) });
    return 0;
  }
  await quotaAdd(d.db, now, QUOTA.poll).catch(() => undefined);
  let reported = 0;
  for (const r of ageRatingsFrom(items)) {
    const episode = episodeOf.get(r.id);
    if (!r.ageRestricted || !episode) continue;
    await logEvent(d.db, episode, AGE_ALARM.kind, {
      video: r.id,
      title: r.title,
      ...(r.privacy ? { privacy: r.privacy } : {}),
      ...(r.uploadStatus ? { uploadStatus: r.uploadStatus } : {}),
    });
    await d
      .notify({ content: ageAlarmLine(r.title, r.id) })
      .catch(() => undefined);
    log("warn", "age alarm: a Pulse video is age-restricted", {
      video: r.id,
      episode,
    });
    reported++;
  }
  return reported;
}

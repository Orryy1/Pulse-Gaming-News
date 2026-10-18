// Every Short that goes public on YouTube follows it to Facebook Reels,
// Instagram Reels, TikTok and X, staggered after the YouTube publish so each
// platform gets a fresh post at a good hour. Runs on its own clock and lease,
// never inside the production tick, and never blocks a YouTube upload. The
// events table is the ledger: "crosspost" (done), "crosspost_failed" (up to
// three tries) and "crosspost_skip" (not public on YouTube, file gone).

import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db.ts";
import type { Config } from "../config.ts";
import type { Script } from "../editorial/schema.ts";
import { polishTitle } from "../editorial/seo.ts";
import { logEvent } from "../episodes.ts";
import { errorMessage, log } from "../lib/util.ts";

export type Platform = "facebook" | "instagram" | "tiktok" | "x";
export const PLATFORMS: Platform[] = ["x", "facebook", "instagram", "tiktok"];
export const MAX_TRIES = 3;

export interface SocialPosters {
  facebook?: (
    file: string,
    title: string,
    description: string,
  ) => Promise<string>;
  instagram?: (file: string, caption: string, videoUrl?: string) => Promise<string>;
  tiktok?: (file: string, caption: string) => Promise<string>;
  x?: (text: string) => Promise<string>;
}

const PLATFORM_TAGS: Record<Platform, string[]> = {
  facebook: ["#GamingNews", "#Gaming"],
  instagram: ["#gamingnews", "#gaming", "#gamer", "#videogames", "#reels"],
  tiktok: ["#gamingnews", "#gaming", "#gamer", "#gamertok"],
  x: ["#GamingNews"],
};

const gameTag = (script: Script) => {
  const t = script.game_title.replace(/[^A-Za-z0-9]/g, "").slice(0, 30);
  return t ? `#${t}` : "";
};

/** The words that go with the video on each platform. */
export function socialCaption(
  platform: Platform,
  script: Script,
  youtubeId: string,
): string {
  const title = polishTitle(script);
  const url = `https://youtube.com/shorts/${youtubeId}`;
  const tags = [gameTag(script), ...PLATFORM_TAGS[platform]].filter(Boolean);
  const rumour = script.is_rumour
    ? "Unconfirmed report: we will update when it is confirmed or denied."
    : "";
  if (platform === "x") {
    // 280 characters, a link counts as 23.
    const tail = `\n\n${url} ${tags.slice(0, 2).join(" ")}`;
    const room = 280 - 23 - tags.slice(0, 2).join(" ").length - 4;
    const body = script.is_rumour ? `${title} (unconfirmed)` : title;
    const hook =
      script.hook && body.length + script.hook.length + 2 <= room
        ? `\n\n${script.hook}`
        : "";
    return `${body.slice(0, room)}${hook}${tail}`;
  }
  const lines = [
    title,
    "",
    script.hook,
    rumour,
    platform === "facebook" ? `\nFull story and sources: ${url}` : "",
    platform === "instagram"
      ? "\nFollow @pulse.gmg for gaming news every day."
      : "",
    platform === "tiktok" ? "" : "\nNarrated with an AI voice.",
    "",
    tags.join(" "),
  ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""));
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface CrosspostCandidate {
  id: string;
  youtube_video_id: string;
  script_json: Script;
}

/** The next Short a platform should get: public long enough, not done, not given up on. */
export async function nextForPlatform(
  db: Db,
  platform: Platform,
  delayMinutes: number,
  windowHours: number,
  now: Date,
): Promise<CrosspostCandidate | undefined> {
  const rows = await db.query<CrosspostCandidate>(
    `SELECT e.id, e.youtube_video_id, e.script_json FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND e.lane <> 'longform'
        AND COALESCE(e.script_json->>'runtime', 'short') = 'short'
        AND COALESCE(e.publish_at, e.updated_at) <= $1::timestamptz - make_interval(mins => $2)
        AND COALESCE(e.publish_at, e.updated_at) > $1::timestamptz - make_interval(hours => $3)
        AND NOT EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind IN ('crosspost','crosspost_skip') AND v.detail->>'platform' = $4)
        AND (SELECT count(*) FROM events v WHERE v.episode_id = e.id AND v.kind = 'crosspost_failed' AND v.detail->>'platform' = $4) < $5
      ORDER BY COALESCE(e.publish_at, e.updated_at) ASC
      LIMIT 1`,
    [now, delayMinutes, windowHours, platform, MAX_TRIES],
  );
  return rows[0];
}

/** True when anyone can watch it: YouTube's public oEmbed answers for public and unlisted videos only. */
export async function isPublicOnYouTube(
  videoId: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const res = await fetchFn(
    `https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${videoId}`,
    { signal: AbortSignal.timeout(15_000) },
  ).catch(() => undefined);
  if (!res) throw new Error("YouTube oEmbed unreachable");
  return res.status === 200;
}

export interface CrosspostDeps {
  db: Db;
  cfg: Config;
  posters: SocialPosters;
  now: () => Date;
  isPublic: (videoId: string) => Promise<boolean>;
  notify: (m: { content: string }) => Promise<unknown>;
  episodeDir: (id: string) => string;
  /** A signed public link to the episode's video, for platforms that fetch it themselves. */
  videoUrl?: (id: string) => string;
}

/** One pass: at most one post per platform, oldest eligible Short first. */
export async function crosspostTick(
  d: CrosspostDeps,
): Promise<Array<{ platform: Platform; episode: string; ok: boolean }>> {
  const done: Array<{ platform: Platform; episode: string; ok: boolean }> = [];
  for (const platform of PLATFORMS) {
    const post = d.posters[platform];
    if (!post) continue;
    const ep = await nextForPlatform(
      d.db,
      platform,
      d.cfg.crosspostDelays[platform],
      d.cfg.crosspostWindowHours,
      d.now(),
    );
    if (!ep) continue;
    const file = path.join(d.episodeDir(ep.id), "short.mp4");
    try {
      if (!(await d.isPublic(ep.youtube_video_id))) {
        await logEvent(d.db, ep.id, "crosspost_skip", {
          platform,
          reason: "not public on YouTube",
        });
        continue;
      }
      if (platform !== "x" && !fs.existsSync(file)) {
        await logEvent(d.db, ep.id, "crosspost_skip", {
          platform,
          reason: "video file no longer on disk",
        });
        continue;
      }
      const script = ep.script_json;
      const caption = socialCaption(platform, script, ep.youtube_video_id);
      const id =
        platform === "facebook"
          ? await d.posters.facebook!(file, polishTitle(script), caption)
          : platform === "instagram"
            ? await d.posters.instagram!(file, caption, d.videoUrl?.(ep.id))
            : platform === "tiktok"
              ? await d.posters.tiktok!(file, caption)
              : await d.posters.x!(caption);
      await logEvent(d.db, ep.id, "crosspost", { platform, id });
      // TikTok has not approved the app for public posting yet: the video waits in the owner's TikTok inbox.
      if (id.startsWith("inbox:"))
        await d.notify({ content: `📲 TikTok draft ready: "${polishTitle(script)}". Open TikTok, tap the notification in your inbox, paste this caption and post:\n${caption.slice(0, 1500)}` }).catch(() => undefined);
      log("info", "crossposted", { platform, episode: ep.id, id });
      done.push({ platform, episode: ep.id, ok: true });
    } catch (err) {
      const error = errorMessage(err);
      await logEvent(d.db, ep.id, "crosspost_failed", {
        platform,
        error: error.slice(0, 500),
      });
      log("warn", "crosspost failed", { platform, episode: ep.id, error });
      done.push({ platform, episode: ep.id, ok: false });
      const [n] = await d.db.query<{ n: string }>(
        `SELECT count(*) AS n FROM events WHERE episode_id = $1 AND kind = 'crosspost_failed' AND detail->>'platform' = $2`,
        [ep.id, platform],
      );
      if (Number(n?.n ?? 0) >= MAX_TRIES)
        await d
          .notify({
            content: `⚠️ Could not post "${polishTitle(ep.script_json)}" to ${platform} after ${MAX_TRIES} tries: ${error.slice(0, 300)}`,
          })
          .catch(() => undefined);
    }
  }
  return done;
}

let tiktokUnaudited = false;

/** The posters this PC has credentials for and the owner has switched on. */
export async function buildPosters(cfg: Config): Promise<SocialPosters> {
  const p = await import("./platforms.ts");
  const out: SocialPosters = {};
  if (cfg.crosspost.facebook && cfg.facebookPageId && cfg.facebookPageToken)
    out.facebook = (file, title, description) => p.postFacebookReel({ pageId: cfg.facebookPageId, token: cfg.facebookPageToken, file, title, description });
  if (cfg.crosspost.instagram && cfg.instagramAccountId && cfg.instagramToken)
    out.instagram = (file, caption, videoUrl) => p.postInstagramReel({ accountId: cfg.instagramAccountId, token: cfg.instagramToken, file, caption, videoUrl });
  if (cfg.crosspost.tiktok && cfg.tiktokClientKey && cfg.tiktokTokenPath && fs.existsSync(cfg.tiktokTokenPath))
    out.tiktok = async (file, caption) => {
      const accessToken = await p.tiktokAccessToken(cfg.tiktokTokenPath, cfg.tiktokClientKey, cfg.tiktokClientSecret);
      if (!tiktokUnaudited) {
        try {
          return await p.postTikTok({ accessToken, file, title: caption });
        } catch (err) {
          if (!/unaudited_client/.test(errorMessage(err))) throw err;
          tiktokUnaudited = true; // until TikTok approves the app, every video goes to the inbox
        }
      }
      return p.postTikTok({ accessToken, file, title: caption, inbox: true });
    };
  if (cfg.crosspost.x && cfg.xKeys.consumerKey && cfg.xKeys.token) out.x = (text) => p.postX(cfg.xKeys, text);
  return out;
}

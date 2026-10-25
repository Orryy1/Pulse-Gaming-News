import { publishHeld } from "../lanes.ts";
// Every Short that goes public on YouTube follows it to Facebook Reels,
// Instagram Reels, TikTok and X, staggered after the YouTube publish so each
// platform gets a fresh post at a good hour. Runs on its own clock and lease,
// never inside the production tick, and never blocks a YouTube upload. The
// events table is the ledger: "crosspost" (done), "crosspost_failed" (up to
// three tries) and "crosspost_skip" (not public on YouTube, file gone).

import { signToken } from "../lib/crypto.ts";
import { topicTags } from "../editorial/seo.ts";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db.ts";
import type { Config } from "../config.ts";
import type { Script } from "../editorial/schema.ts";
import { polishTitle } from "../editorial/seo.ts";
import { logEvent } from "../episodes.ts";
import { errorMessage, log } from "../lib/util.ts";
import { markSignedOut, postTikTokBrowser, signedIn, TikTokChallenge, TikTokSignedOut } from "./tiktokBrowser.ts";

export type Platform = "facebook" | "instagram" | "tiktok" | "x";
export const PLATFORMS: Platform[] = ["x", "facebook", "instagram", "tiktok"];
export const MAX_TRIES = 3;
/** Failures before this process started do not count: a restart usually carries a fix, and a Short still inside its window deserves a fresh try. */
const BOOT = new Date();

/** A platform asked us to come back later: no attempt is spent and nothing is logged against the Short. */
export class Deferred extends Error {}

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

// Hashtags per platform: the story's own tags first, then at most the niche tag. Instagram allows five;
// TikTok's top gaming accounts use four or five (franchise, series, company, niche); Facebook two; X none.
const PLATFORM_TAGS: Record<Platform, { topic: number; tail: string[] }> = {
  facebook: { topic: 1, tail: ["#GamingNews"] },
  instagram: { topic: 3, tail: ["#gamingnews", "#gaming"] },
  tiktok: { topic: 3, tail: ["#gamingnews", "#gaming"] },
  x: { topic: 0, tail: [] },
};

/** A closing question for the caption: the script's own loop line when it asks one. */
/**
 * A closing question for the caption: the script's own loop line when it asks one. The loop line echoes
 * the hook for the rewatch, so when it repeats the hook's words the caption keeps only its question
 * ("..., so will you keep buying physical?" becomes "So will you keep buying physical?").
 */
export function questionOf(script: Script): string {
  const loop = (script.loop_line ?? "").trim();
  if (!/\?$/.test(loop)) return "";
  const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9']{4,}/g) ?? []);
  const hook = words(script.hook ?? "");
  const shared = [...words(loop)].filter((w) => hook.has(w)).length;
  if (shared < 3) return loop;
  const tail = loop.split(/,\s+|\s+(?:and|so)\s+(?=(?:will|would|do|does|are|is|can|could|should|did|have|has|what|which|who|how|why)\b)/i).at(-1)!.trim();
  return tail === loop || tail.split(/\s+/).length < 3 ? "" : tail[0]!.toUpperCase() + tail.slice(1);
}

/** The words that go with the video on each platform. */
export function socialCaption(
  platform: Platform,
  script: Script,
  youtubeId: string,
): string {
  const title = polishTitle(script);
  const url = `https://youtube.com/shorts/${youtubeId}`;
  const spec = PLATFORM_TAGS[platform];
  const tags = [...topicTags(script, spec.topic), ...spec.tail];
  const question = questionOf(script);
  const rumour = script.is_rumour
    ? "Unconfirmed report: we will update when it is confirmed or denied."
    : "";
  if (platform === "x") {
    // 280 characters, a link counts as 23. The top gaming accounts on X use no topic hashtags.
    const tail = `\n\n${url}`;
    const room = 280 - 23 - 4;
    const body = script.is_rumour ? `${title} (unconfirmed)` : title;
    const hook =
      script.hook && body.length + script.hook.length + 2 <= room
        ? `\n\n${script.hook}`
        : "";
    return `${body.slice(0, room)}${hook}${tail}`;
  }
  // The search phrase first (TikTok and Instagram read captions for search; Instagram posts reach
  // Google), then the fact, then a real question; no emoji.
  const lines = [
    platform === "tiktok" ? `${script.hook}${question ? ` ${question}` : ""}` : title,
    platform === "tiktok" ? "" : "",
    platform === "tiktok" ? "" : `${script.hook}${question ? ` ${question}` : ""}`,
    rumour,
    platform === "facebook" ? `\nFull story and sources: ${url}` : "",
    platform === "instagram" ? "\nFull story and sources: link in bio." : "",
    "\nNarrated with an AI voice.",
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
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND e.lane NOT IN ('longform','twin')
        AND COALESCE(e.script_json->>'runtime', 'short') = 'short'
        AND COALESCE(e.publish_at, e.updated_at) <= $1::timestamptz - make_interval(mins => $2)
        AND COALESCE(e.publish_at, e.updated_at) > $1::timestamptz - make_interval(hours => $3)
        AND NOT EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind IN ('crosspost','crosspost_skip') AND v.detail->>'platform' = $4)
        AND (SELECT count(*) FROM events v WHERE v.episode_id = e.id AND v.kind = 'crosspost_failed' AND v.detail->>'platform' = $4 AND v.created_at >= $6) < $5
      ORDER BY COALESCE(e.publish_at, e.updated_at) ASC
      LIMIT 1`,
    [now, delayMinutes, windowHours, platform, MAX_TRIES, BOOT],
  );
  return rows[0];
}

/**
 * TikTok gets only the day's strongest Shorts: posting is a manual step for the owner until a paid,
 * TikTok-approved service is worth it, so from TIKTOK_FROM_HOUR (local) it sends at most TIKTOK_DAILY a
 * day, choosing the eligible Short with the most YouTube views per hour since it went live.
 */
export async function nextForTikTok(
  db: Db,
  cfg: Pick<Config, "tiktokDaily" | "tiktokFromHour" | "timezone" | "crosspostDelays" | "crosspostWindowHours">,
  now: Date,
): Promise<CrosspostCandidate | undefined> {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: cfg.timezone, hour: "2-digit", hour12: false }).format(now),
  );
  if (hour < cfg.tiktokFromHour) return undefined;
  const [sent] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM events WHERE kind = 'crosspost' AND detail->>'platform' = 'tiktok' AND created_at > $1::timestamptz - interval '24 hours'`,
    [now],
  );
  if (Number(sent?.n ?? 0) >= cfg.tiktokDaily) return undefined;
  const rows = await db.query<CrosspostCandidate>(
    `SELECT e.id, e.youtube_video_id, e.script_json FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND e.lane NOT IN ('longform','twin')
        AND COALESCE(e.script_json->>'runtime', 'short') = 'short'
        AND COALESCE(e.publish_at, e.updated_at) <= $1::timestamptz - make_interval(mins => $2)
        AND COALESCE(e.publish_at, e.updated_at) > $1::timestamptz - make_interval(hours => $3)
        AND NOT EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind IN ('crosspost','crosspost_skip') AND v.detail->>'platform' = 'tiktok')
        AND (SELECT count(*) FROM events v WHERE v.episode_id = e.id AND v.kind = 'crosspost_failed' AND v.detail->>'platform' = 'tiktok' AND v.created_at >= $5) < $4
      ORDER BY COALESCE((SELECT max(m.views) FROM video_metrics m WHERE m.episode_id = e.id), 0)
               / GREATEST(1, EXTRACT(EPOCH FROM ($1::timestamptz - COALESCE(e.publish_at, e.updated_at))) / 3600) DESC,
               COALESCE(e.publish_at, e.updated_at) DESC
      LIMIT 1`,
    [now, cfg.crosspostDelays.tiktok, cfg.crosspostWindowHours, MAX_TRIES, BOOT],
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
  notify: (m: { content: string; level?: "info"; ping?: boolean }) => Promise<unknown>;
  episodeDir: (id: string) => string;
  /** A signed public link to the episode's video, for platforms that fetch it themselves. */
  videoUrl?: (id: string) => string;
  /** Finds a post that may already exist remotely for this episode (after a lost response); its id, or undefined. */
  reconcile?: (platform: Platform, episodeId: string, file: string) => Promise<string | undefined>;
}

/** One pass: at most one post per platform, oldest eligible Short first. */
export async function crosspostTick(
  d: CrosspostDeps,
): Promise<Array<{ platform: Platform; episode: string; ok: boolean }>> {
  const done: Array<{ platform: Platform; episode: string; ok: boolean }> = [];
  if (await publishHeld(d.db)) return done; // the owner's publishing hold
  for (const platform of PLATFORMS) {
    const post = d.posters[platform];
    if (!post) continue;
    const ep =
      platform === "tiktok" && d.cfg.tiktokDaily > 0
        ? await nextForTikTok(d.db, d.cfg, d.now())
        : await nextForPlatform(
            d.db,
            platform,
            d.cfg.crosspostDelays[platform],
            d.cfg.crosspostWindowHours,
            d.now(),
          );
    if (!ep) continue;
    const file = path.join(d.episodeDir(ep.id), "short.mp4");
    try {
      let isPublic: boolean;
      try {
        isPublic = await d.isPublic(ep.youtube_video_id);
      } catch (err) {
        // YouTube unreachable: try again next pass, never a permanent skip.
        log("info", "crosspost waits: YouTube check failed", { platform, episode: ep.id, error: errorMessage(err) });
        continue;
      }
      if (!isPublic) {
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
      // A crash or a lost response between the remote post and its record used to make the next pass
      // post again (one Short reached TikTok's inbox twice, 23 Oct 2026). The attempt is recorded first;
      // a "started" with no "crosspost" after it is uncertain and is reconciled before anything is re-sent.
      const [started] = await d.db.query<{ n: string | number }>(
        `SELECT count(*) AS n FROM events WHERE episode_id = $1 AND kind = 'crosspost_started' AND detail->>'platform' = $2
           AND created_at > $3::timestamptz - interval '6 hours'`,
        [ep.id, platform, d.now()],
      );
      if (Number(started?.n ?? 0) > 0) {
        const found = await d.reconcile?.(platform, ep.id, file).catch(() => undefined);
        if (found) {
          await logEvent(d.db, ep.id, "crosspost", { platform, id: found, reconciled: true });
          log("info", "crosspost reconciled", { platform, episode: ep.id, id: found });
          done.push({ platform, episode: ep.id, ok: true });
          continue;
        }
        if (!d.reconcile) {
          // Nothing can tell whether it landed: leave it for the owner rather than risk a duplicate.
          await logEvent(d.db, ep.id, "crosspost_skip", { platform, reason: "uncertain after a lost response" });
          await d.notify({ level: "info", content: `${platform}: "${polishTitle(script)}" may or may not have posted after a lost response; not retried. Check and post by hand if missing.` });
          continue;
        }
      }
      await logEvent(d.db, ep.id, "crosspost_started", { platform });
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
      // TikTok's draft upload has no caption field (no tool can prefill one). The owner gets one link: a page
      // with the caption, a Copy button and an Open TikTok button. The caption also follows on its own.
      if (id.startsWith("inbox:")) {
        await logEvent(d.db, ep.id, "tiktok_caption", { caption });
        const base = (d.cfg.publicUrl || "").replace(/\/$/, "");
        const link = base ? `${base}/tiktok/${ep.id}?t=${signToken(`tiktok:${ep.id}`, d.cfg.appSecret, 3 * 86_400)}` : "";
        await d.notify({
          ping: true,
          content: `📲 Your turn, TikTok: "${polishTitle(script)}"${link ? `\nTap: ${link}\n(one button copies the caption and opens TikTok: tap the draft, paste, post)` : "\nOpen TikTok, tap the draft, paste the next message as the caption, post."}`,
        }).catch(() => undefined);
        await d.notify({ content: caption.slice(0, 2000) }).catch(() => undefined);
      }
      log("info", "crossposted", { platform, episode: ep.id, id });
      done.push({ platform, episode: ep.id, ok: true });
    } catch (err) {
      if (err instanceof Deferred) {
        log("info", "crosspost deferred", { platform, episode: ep.id, reason: err.message });
        continue;
      }
      const error = errorMessage(err);
      // A caught error means nothing was posted (or the platform said so): the attempt marker is withdrawn
      // so the usual retries go ahead. Only a pass that dies silently leaves its marker behind.
      await d.db.query(
        `DELETE FROM events WHERE episode_id = $1 AND kind = 'crosspost_started' AND detail->>'platform' = $2`,
        [ep.id, platform],
      );
      await logEvent(d.db, ep.id, "crosspost_failed", {
        platform,
        error: error.slice(0, 500),
      });
      log("warn", "crosspost failed", { platform, episode: ep.id, error });
      done.push({ platform, episode: ep.id, ok: false });
      const [n] = await d.db.query<{ n: string }>(
        `SELECT count(*) AS n FROM events WHERE episode_id = $1 AND kind = 'crosspost_failed' AND detail->>'platform' = $2 AND created_at >= $3`,
        [ep.id, platform, BOOT],
      );
      if (Number(n?.n ?? 0) >= MAX_TRIES)
        await d
          .notify({
            level: "info",
            content: `Could not post "${polishTitle(ep.script_json)}" to ${platform} after ${MAX_TRIES} tries: ${error.slice(0, 200)}`,
          })
          .catch(() => undefined);
    }
  }
  return done;
}

let tiktokUnaudited = false;
let tiktokPausedUntil = 0;
let tiktokPauseReason = "";
const pauseTikTok = (hours: number, reason: string) => {
  tiktokPausedUntil = Date.now() + hours * 3_600_000;
  tiktokPauseReason = reason;
};

const TIKTOK_SINGLE_CHUNK = 60 * 1024 * 1024;

/**
 * TikTok takes a file of up to 64 MB in one piece and fights multi-chunk uploads,
 * so a bigger Short gets a TikTok copy re-encoded to fit (same picture, lower bitrate).
 */
/**
 * The Instagram copy of a Short, encoded to Meta's Reels spec: standard (not full) colour range, closed
 * keyframe groups every 2 s, no MP4 edit list, AAC 48 kHz stereo, index at the front. Instagram's
 * processing refused some renders as they were (error 2207076).
 */
export async function instagramFile(file: string): Promise<string> {
  const out = path.join(path.dirname(file), "instagram.mp4");
  if (fs.existsSync(out) && (await fs.promises.stat(out)).mtimeMs >= (await fs.promises.stat(file)).mtimeMs) return out;
  const { FFMPEG } = await import("../lib/bin.ts");
  const { execFile } = await import("node:child_process");
  await new Promise<void>((resolve, reject) =>
    execFile(
      FFMPEG,
      ["-y", "-v", "error", "-i", file, "-vf", "scale=in_range=auto:out_range=tv,format=yuv420p", "-color_range", "tv", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", "9M", "-bufsize", "18M", "-profile:v", "high", "-level", "4.1", "-r", "30", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", "-flags", "+cgop", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-use_editlist", "0", "-movflags", "+faststart", out],
      { maxBuffer: 10 * 1024 * 1024 },
      (err) => (err ? reject(err) : resolve()),
    ),
  );
  return out;
}

export async function tiktokFile(file: string): Promise<string> {
  const { size } = await fs.promises.stat(file);
  if (size <= TIKTOK_SINGLE_CHUNK) return file;
  const out = path.join(path.dirname(file), "tiktok.mp4");
  if (fs.existsSync(out) && (await fs.promises.stat(out)).size <= TIKTOK_SINGLE_CHUNK) return out;
  const { FFMPEG } = await import("../lib/bin.ts");
  const { probe } = await import("../qa/media.ts");
  const seconds = Math.max(10, (await probe(file)).durationSeconds || 60);
  // 55 MB budget, 128 kbps of it for audio.
  const videoKbps = Math.max(1500, Math.floor((55 * 8 * 1024) / seconds - 128));
  const { execFile } = await import("node:child_process");
  await new Promise<void>((resolve, reject) =>
    execFile(
      FFMPEG,
      ["-y", "-v", "error", "-i", file, "-c:v", "libx264", "-preset", "medium", "-b:v", `${videoKbps}k`, "-maxrate", `${Math.floor(videoKbps * 1.3)}k`, "-bufsize", `${videoKbps * 2}k`, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out],
      { maxBuffer: 10 * 1024 * 1024 },
      (err) => (err ? reject(err) : resolve()),
    ),
  );
  return out;
}

/** The posters this PC has credentials for and the owner has switched on. */
export async function buildPosters(cfg: Config, notifyOwner?: (text: string) => Promise<unknown>): Promise<SocialPosters> {
  const p = await import("./platforms.ts");
  const out: SocialPosters = {};
  if (cfg.crosspost.facebook && cfg.facebookPageId && cfg.facebookPageToken)
    out.facebook = (file, title, description) => p.postFacebookReel({ pageId: cfg.facebookPageId, token: cfg.facebookPageToken, file, title, description });
  if (cfg.crosspost.instagram && cfg.instagramAccountId && cfg.instagramToken)
    out.instagram = async (file, caption, videoUrl) => p.postInstagramReel({ accountId: cfg.instagramAccountId, token: cfg.instagramToken, file: await instagramFile(file), caption, videoUrl });
  if (cfg.crosspost.tiktok && cfg.tiktokClientKey && cfg.tiktokTokenPath && fs.existsSync(cfg.tiktokTokenPath))
    out.tiktok = async (file, caption) => {
      if (Date.now() < tiktokPausedUntil) throw new Deferred(tiktokPauseReason);
      // Public posting through the owner's own signed-in Chrome profile, when there is one.
      if (cfg.tiktokBrowser && signedIn(cfg.dataDir)) {
        try {
          return await postTikTokBrowser({
            dataDir: cfg.dataDir,
            file: await tiktokFile(file),
            caption: `${caption}\n\nNarrated with an AI voice.`,
            shotsDir: path.join(cfg.dataDir, "logs", "tiktok"),
          });
        } catch (err) {
          if (err instanceof TikTokChallenge) {
            pauseTikTok(24, "TikTok asked for a verification check; TikTok posting is paused for a day");
            await notifyOwner?.(`⚠️ TikTok showed a verification check, so TikTok posting is paused for 24 hours. Open TikTok on your phone once to clear it. Screenshot: ${err.screenshot ?? "none"}`);
            throw new Deferred(tiktokPauseReason);
          }
          if (err instanceof TikTokSignedOut) {
            markSignedOut(cfg.dataDir);
            await notifyOwner?.("⚠️ TikTok signed the Pulse profile out. Double-click Connect TikTok (Pulse) on the desktop to sign in again. Until then Shorts go to your TikTok inbox as drafts.");
          } else throw err;
        }
      }
      const accessToken = await p.tiktokAccessToken(cfg.tiktokTokenPath, cfg.tiktokClientKey, cfg.tiktokClientSecret);
      file = await tiktokFile(file);
      if (!tiktokUnaudited) {
        try {
          return await p.postTikTok({ accessToken, file, title: caption });
        } catch (err) {
          if (!/unaudited_client/.test(errorMessage(err))) throw err;
          tiktokUnaudited = true; // until TikTok approves the app, every video goes to the inbox
        }
      }
      try {
        return await p.postTikTok({ accessToken, file, title: caption, inbox: true });
      } catch (err) {
        // TikTok holds only a few unposted drafts: wait six hours for the owner to post them.
        if (/spam_risk_too_many_pending_share/.test(errorMessage(err))) {
          pauseTikTok(6, "TikTok inbox is full of unposted drafts; trying again in six hours");
          throw new Deferred(tiktokPauseReason);
        }
        throw err;
      }
    };
  if (cfg.crosspost.x && cfg.xKeys.consumerKey && cfg.xKeys.token) out.x = (text) => p.postX(cfg.xKeys, text);
  return out;
}

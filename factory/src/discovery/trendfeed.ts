// The trend-scouting feed (TREND_FEED, default off; owner, 19 Nov 2026). The download account (YTDLP_COOKIES_FILE,
// a separate, disposable 18+ Google account, never Pulse's) subscribes to the big gaming news, platform and
// documentary channels (TREND_CHANNELS; src/tools/trendchannels.ts tells the owner which). Every 3 hours the factory
// reads that account's subscriptions feed through the signed-in lane: a flat listing, metadata only (titles, channel,
// views, age), no downloads, at most TREND_MAX_CALLS (2) signed-in calls a run, counted on the clips' share of the
// signed-in budget (YT_SIGNED_CLIP_SHARE) so the game fetcher is never starved. New uploads become story leads for
// discovery, labelled "YouTube trend feed: <channel>" with sourceKind "lead": a lead joins a press story about the
// same thing (a small push, never a source the editor may cite as confirmation) and on its own is never picked
// (src/discovery/cluster.ts). Nothing here likes, comments, subscribes or watches; Pulse's own channel and videos are
// dropped, and the guard refuses any signed-in call that names them (src/lib/ytown.ts).

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FeedItem } from "./rss.ts";
import { YTDLP_TEXT } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import { guardedYt, withYtPurpose } from "../lib/ytguard.ts";
import { signedInArgs } from "../lib/ytsignin.ts";
import { ownChannel, type OwnChannel } from "../lib/ytown.ts";

const exec = promisify(execFile);

export const TREND_FEED_URL = "https://www.youtube.com/feed/subscriptions";
/** Signed-in calls one run may make, at most. */
export const TREND_MAX_CALLS = 2;
/** Entries read from the feed (newest first). */
const FEED_DEPTH = 60;
/** Uploads older than this are not leads. */
export const TREND_MAX_AGE_HOURS = 24;
/** Leads kept on disk. */
const KEEP = 300;

export interface TrendUpload {
  videoId: string;
  title: string;
  channel: string;
  channelId: string;
  views: number;
  /** Upload time (ms) when the feed gives one (approximate: "3 hours ago"). */
  uploadedAt?: number;
}

export interface TrendLead extends TrendUpload {
  /** When the factory first saw it (ms): its age when the feed gives none. */
  firstSeen: number;
}

/** The yt-dlp arguments for one read of the feed (pure): flat, metadata only, approximate upload times. */
export function trendArgs(url = TREND_FEED_URL): string[] {
  return [
    ...YTDLP_TEXT.args,
    "--no-warnings",
    "--flat-playlist",
    "--skip-download",
    "--playlist-end",
    String(FEED_DEPTH),
    "--extractor-args",
    "youtubetab:approximate_date",
    "--print",
    "%(id)s\t%(view_count)s\t%(timestamp)s\t%(channel_id)s\t%(channel)s\t%(title)s",
    url,
  ];
}

/** Rows of `id \t views \t timestamp \t channel id \t channel \t title` (pure). */
export function parseTrendRows(stdout: string): TrendUpload[] {
  return String(stdout)
    .split(/\r?\n/)
    .map((l) => l.split("\t"))
    .filter((r) => r.length >= 6 && /^[\w-]{11}$/.test(r[0]!))
    .map(([videoId, views, ts, channelId, channel, ...title]) => {
      const t = Number(ts);
      const na = (v: string | undefined) => (!v || v === "NA" ? "" : v);
      return {
        videoId: videoId!,
        title: title.join("\t").trim(),
        channel: na(channel),
        channelId: na(channelId),
        views: Number(views) || 0,
        ...(Number.isFinite(t) && t > 0 ? { uploadedAt: t * 1000 } : {}),
      };
    })
    .filter((u) => u.title && u.title !== "NA");
}

/** Pulse's own channel or one of its videos (pure): never a lead. */
export function isOwnUpload(
  u: Pick<TrendUpload, "videoId" | "channelId">,
  own: OwnChannel,
): boolean {
  return (
    own.videoIds.has(u.videoId) ||
    (!!u.channelId && own.channelIds.includes(u.channelId))
  );
}

/**
 * Merges a read into the kept leads (pure): new uploads added with their first sighting, known ones refreshed (views
 * grow), Pulse's own dropped, anything older than two days forgotten, the newest 300 kept.
 */
export function mergeLeads(
  kept: TrendLead[],
  read: TrendUpload[],
  now: number,
  own: OwnChannel,
): TrendLead[] {
  const byId = new Map(kept.map((l) => [l.videoId, l]));
  for (const u of read) {
    if (isOwnUpload(u, own)) continue;
    const had = byId.get(u.videoId);
    byId.set(u.videoId, { ...had, ...u, firstSeen: had?.firstSeen ?? now });
  }
  return [...byId.values()]
    .filter(
      (l) => !isOwnUpload(l, own) && now - publishedMs(l) < 48 * 3_600_000,
    )
    .sort((a, b) => publishedMs(b) - publishedMs(a))
    .slice(0, KEEP);
}

const publishedMs = (l: TrendLead): number => l.uploadedAt ?? l.firstSeen;

const views = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${Math.round(n / 1_000)}K`
      : String(n);

/** A lead as a discovery item (pure): clearly labelled, a lead and never an outlet. */
export function leadItem(l: TrendLead, now: number): FeedItem {
  const hours = Math.max(0, Math.round((now - publishedMs(l)) / 3_600_000));
  const channel = l.channel || "a subscribed channel";
  return {
    title: l.title,
    url: `https://www.youtube.com/watch?v=${l.videoId}`,
    summary: `Trend lead, not a source: a YouTube upload by ${channel}, ${views(l.views)} views, about ${hours} hours old. Confirm with the press before reporting it.`,
    publishedAt: new Date(publishedMs(l)).toISOString(),
    source: `YouTube trend feed: ${channel}`,
    sourceKind: "lead",
  };
}

export function trendLeadsFile(dataDir: string): string {
  return path.join(dataDir, "trendfeed", "leads.json");
}

function readLeads(file: string): TrendLead[] {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as { leads?: unknown };
    return Array.isArray(j.leads) ? (j.leads as TrendLead[]) : [];
  } catch {
    return [];
  }
}

/** The kept leads young enough for discovery, as feed items (read by src/services.ts discover; no YouTube call). */
export function readTrendItems(
  dataDir: string,
  now: Date,
  maxAgeHours = TREND_MAX_AGE_HOURS,
): FeedItem[] {
  const t = now.getTime();
  return readLeads(trendLeadsFile(dataDir))
    .filter((l) => t - publishedMs(l) < maxAgeHours * 3_600_000)
    .map((l) => leadItem(l, t));
}

export interface TrendFeedSettings {
  dataDir: string;
  ytdlp: string;
  cookiesFile: string;
}

export interface TrendFeedDeps {
  /** The sign-in arguments for the feed (signedInArgs). */
  cookies?: () => Promise<string[]>;
  /** One signed-in read: yt-dlp's stdout. */
  read?: (args: string[]) => Promise<string>;
  own?: () => OwnChannel;
  now?: () => number;
}

/**
 * One run: reads the subscriptions feed signed in (at most TREND_MAX_CALLS calls; one today) and keeps the new
 * uploads as leads. Without usable cookies nothing is read. Returns how many new leads were found.
 */
export async function trendFeedRun(
  s: TrendFeedSettings,
  deps: TrendFeedDeps = {},
): Promise<number> {
  const now = (deps.now ?? Date.now)();
  const own = (deps.own ?? (() => ownChannel()))();
  const cookies = await (
    deps.cookies ??
    (() =>
      signedInArgs({ ytdlpCookiesFile: s.cookiesFile }, undefined, undefined, [
        TREND_FEED_URL,
      ]))
  )();
  if (!cookies.length) {
    log("info", "trend feed: no usable download-account cookies, nothing read");
    return 0;
  }
  const read =
    deps.read ??
    ((a: string[]) =>
      withYtPurpose("trend", () =>
        guardedYt(
          s.ytdlp,
          a,
          () =>
            exec(s.ytdlp, a, {
              timeout: 120_000,
              maxBuffer: 16 * 1024 * 1024,
              env: YTDLP_TEXT.env,
              windowsHide: true,
            }),
          // A fresh read every time: the guard's 12-hour listing cache would hide the new uploads.
          { cache: false, purpose: "trend" },
        ),
      ).then((r) => String(r.stdout)));
  const urls = [TREND_FEED_URL].slice(0, TREND_MAX_CALLS);
  const found: TrendUpload[] = [];
  for (const url of urls) {
    try {
      found.push(
        ...parseTrendRows(await read([...cookies, ...trendArgs(url)])),
      );
    } catch (err) {
      log("warn", "trend feed: read failed", {
        error: errorMessage(err).split("\n")[0],
      });
      break;
    }
  }
  const file = trendLeadsFile(s.dataDir);
  const kept = readLeads(file);
  const before = new Set(kept.map((l) => l.videoId));
  const leads = mergeLeads(kept, found, now, own);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({ at: new Date(now).toISOString(), leads }),
  );
  fs.renameSync(tmp, file);
  const fresh = leads.filter((l) => !before.has(l.videoId)).length;
  log("info", "trend feed read", {
    uploads: found.length,
    newLeads: fresh,
    kept: leads.length,
  });
  return fresh;
}

// The platform levers' background work, started by the server: the live watcher every LIVE_POLL_MINUTES
// (LIVE_AUTOFILL), the Partner Programme tracker once a week (YPP_TRACKER) and the podcast flag once a day
// (PODCAST_PLAYLIST). Each pass catches its own errors and logs them; none can stop the factory.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import { quotaAdd } from "../lanes.ts";
import { YTDLP_TEXT } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import { readState } from "../liveclips/job.ts";
import { vodIndexReady } from "../vodindex/build.ts";
import { loadVodIndex } from "../vodindex/schema.ts";
import { readArchives, writeArchives, type StreamArchive } from "./archives.ts";
import { liveWatchTick, localDay } from "./livewatch.ts";
import { LeverApi, YtApiError } from "./ytapi.ts";
import {
  measureYpp,
  readYpp,
  withYpp,
  writeYpp,
  yppDue,
  yppProjection,
} from "./ypp.ts";

export interface LeverJobDeps {
  db: Db;
  token: () => Promise<string>;
  notify: (text: string) => Promise<unknown>;
}

const safe = (name: string, fn: () => Promise<unknown>) => async () => {
  try {
    await fn();
  } catch (err) {
    log("warn", `${name} failed`, { error: errorMessage(err) });
  }
};

/** The archive's file name in the recordings folder (pure): the VOD miner reads the date, title and id from it. */
export function archiveFileName(
  a: Pick<StreamArchive, "videoId" | "title" | "startedAt">,
  timeZone: string,
): string {
  const title = a.title
    .replace(/[\\/:*?"<>|[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  return `${localDay(new Date(a.startedAt), timeZone)} ${title} [yt-${a.videoId}].mp4`;
}

let fetching = false;

/** Fetches a public archive into the recordings folder with yt-dlp, in the background (one at a time). */
function fetchArchive(cfg: Config, a: StreamArchive): Promise<string> {
  const dir = cfg.streamAsks.vodDir;
  const name = archiveFileName(a, cfg.timezone);
  if (!dir) return Promise.reject(new Error("no recordings folder (VOD_DIR)"));
  if (fetching)
    return Promise.reject(new Error("another archive is being fetched"));
  fs.mkdirSync(dir, { recursive: true });
  const h = cfg.levers.liveArchiveHeight;
  // Written under a .part name and renamed by yt-dlp at the end, so the miner never reads half a file.
  const child = spawn(
    process.env.YTDLP_PATH || "yt-dlp",
    [
      ...YTDLP_TEXT.args,
      "--no-warnings",
      "--no-playlist",
      "-f",
      `bv*[height<=${h}]+ba/b[height<=${h}]`,
      "--merge-output-format",
      "mp4",
      "-o",
      path.join(dir, name),
      `https://www.youtube.com/watch?v=${a.videoId}`,
    ],
    { env: YTDLP_TEXT.env, stdio: "ignore", detached: false },
  );
  fetching = true;
  child.on("exit", (code) => {
    fetching = false;
    log(code === 0 ? "info" : "warn", "stream archive fetch finished", {
      video: a.videoId,
      code,
    });
  });
  child.on("error", (err) => {
    fetching = false;
    log("warn", "stream archive fetch failed", {
      video: a.videoId,
      error: errorMessage(err),
    });
  });
  return Promise.resolve(name);
}

export function startLeverJobs(cfg: Config, deps: LeverJobDeps): void {
  const L = cfg.levers;
  const api = new LeverApi(deps.token);
  const quota = (n: number) => quotaAdd(deps.db, new Date(), n);

  if (L.liveAutofill) {
    let notEnabledSaid = false;
    const watch = safe("live watcher", async () => {
      try {
        const did = await liveWatchTick({
          api,
          settings: L,
          dailyStart: cfg.gtaDailyStart,
          timeZone: cfg.timezone,
          now: () => new Date(),
          readArchives: () => readArchives(cfg.dataDir),
          writeArchives: (list) => writeArchives(cfg.dataDir, list),
          twitchStreams: () => readState(cfg.dataDir).streams,
          readyIndex: async (vodId) => {
            const v = await loadVodIndex(cfg.dataDir, vodId);
            return v && vodIndexReady(v) ? v : undefined;
          },
          download: (a) => fetchArchive(cfg, a),
          notify: deps.notify,
          quota,
        });
        if (did.length) log("info", "live watcher", { did });
      } catch (err) {
        // Live streaming not switched on yet (the owner asked for it on 14 Nov): say so once, then stay quiet.
        if (
          err instanceof YtApiError &&
          err.reasons.includes("liveStreamingNotEnabled")
        ) {
          if (!notEnabledSaid)
            log(
              "info",
              "live watcher: live streaming is not enabled on the channel yet",
            );
          notEnabledSaid = true;
          return;
        }
        throw err;
      }
    });
    setTimeout(watch, 90_000);
    setInterval(watch, L.livePollMinutes * 60_000);
  }

  if (L.yppTracker) {
    const ypp = safe("YPP tracker", async () => {
      const prev = readYpp(cfg.dataDir);
      const now = new Date();
      if (!yppDue(prev, now)) return;
      const p = yppProjection(
        await measureYpp(api, now, L.yppDeadline),
        L.yppDeadline,
      );
      const rec = withYpp(prev, p);
      await writeYpp(cfg.dataDir, rec);
      await quota(4);
      log("info", "YPP tracker", {
        public_hours: p.publicHours,
        per_day: p.perDay,
        projected: p.projectedHours,
      });
    });
    setTimeout(ypp, 10 * 60_000);
    setInterval(ypp, 6 * 3600_000);
  }

  if (L.podcastPlaylist) {
    let said = "";
    const podcast = safe("podcast playlist", async () => {
      const lists = await api.playlists();
      await quota(1);
      const want = L.podcastPlaylist.toLowerCase();
      const p = lists.find(
        (x) => x.id === L.podcastPlaylist || x.title.toLowerCase() === want,
      );
      if (!p) {
        if (said !== "missing")
          await deps.notify(
            `🎙️ PODCAST_PLAYLIST: no playlist called "${L.podcastPlaylist}" on the channel.`,
          );
        said = "missing";
        return;
      }
      if (p.podcastStatus === "enabled") return;
      try {
        await api.enablePodcast(p);
        await quota(50);
        await deps.notify(
          `🎙️ "${p.title}" is now marked as a podcast on YouTube (Podcasts tab and YouTube Music).`,
        );
      } catch (err) {
        if (said !== "refused")
          await deps.notify(
            `🎙️ YouTube would not mark "${p.title}" as a podcast through the API (${errorMessage(err).slice(0, 160)}). It needs a square playlist image first; in Studio: Content > Playlists > "${p.title}" > Edit > set as podcast.`,
          );
        said = "refused";
      }
    });
    setTimeout(podcast, 12 * 60_000);
    setInterval(podcast, 24 * 3600_000);
  }
}

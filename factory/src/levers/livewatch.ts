// The live watcher (LIVE_AUTOFILL, owner's brief 14 Nov 2026: he streams GTA VI daily on Pulse alongside Twitch). Every
// LIVE_POLL_MINUTES it asks YouTube for the channel's active broadcast, whoever made it (the Twitch relay, src/relay,
// or the owner from Studio), and:
//
// - names it: the day's title and description from src/liveclips/simulcast.ts (streamTitle and streamDescription,
//   "Day N" from GTA_DAILY_START as src/gtadaily.ts counts it), with the disclosure line and the Twitch link. A title
//   already in that shape (the relay's) is kept; LIVE_AUTOFILL_TITLE=false keeps any title and sets only the text;
// - watches the archive: a broadcast that will keep no archive (recordFromStart false), or a stream or archive that is
//   not public, is reported to the owner once. It never changes privacy and never deletes anything: the owner may
//   have hidden it on purpose (feedback: respect owner privacy), so it says what it saw and what to click;
// - after the stream ends: records the end, ties the archive to the Twitch stream and recording it mirrors (the
//   live-clips state), and once that recording is indexed (src/vodindex) adds chapters to the description, shifted
//   by the gap between the Twitch and YouTube starts. With no Twitch recording indexed after LIVE_ARCHIVE_WAIT_HOURS
//   it fetches the YouTube archive itself into the recordings folder (LIVE_ARCHIVE_DOWNLOAD), named so the VOD miner
//   indexes it like any recording ("[yt-<id>]"), and Shorts mined from it link back to it (src/levers/archives.ts).
//
// Quota: one unit a poll, one per ended archive per pass, 50 per write (at most a title, a description and the
// chapters per stream). The work is in liveWatchTick; the YouTube calls, the files and the clock are passed in.

import type { LeverSettings } from "./settings.ts";
import type { Broadcast, LeverApi, VideoInfo } from "./ytapi.ts";
import {
  matchTwitch,
  type StreamArchive,
  type TwitchStreams,
} from "./archives.ts";
import {
  chaptersFromIndex,
  streamDescription,
  streamTitle,
  type Chapter,
} from "../liveclips/simulcast.ts";
import type { VodIndex } from "../vodindex/schema.ts";

/** The disclosure every stream description carries (the same words as the relay's, so it is never doubled). */
export const STREAM_AI_LINE =
  "The gameplay and voice are live and real. The title, description and chapters are written with AI tools and checked automatically.";

/** A title already in the daily shape ("GTA 6 LIVE Day 3: ..."): the relay's or ours, kept as it is. */
const DAILY_TITLE = /\bLIVE Day \d+\b/;
const CHAPTERS_HEAD = /\n\nChapters\n[\s\S]*?(?=\n\n#|$)/;

export interface LiveWatchDeps {
  api: Pick<
    LeverApi,
    "broadcasts" | "broadcastsById" | "videos" | "setSnippet"
  >;
  settings: Pick<
    LeverSettings,
    | "liveTitle"
    | "liveGame"
    | "liveTwitch"
    | "liveArchiveDownload"
    | "liveArchiveWaitHours"
  >;
  /** GTA_DAILY_START (Day 1, local) and the factory's time zone, for the day number and the date line. */
  dailyStart: string;
  timeZone: string;
  now: () => Date;
  readArchives: () => StreamArchive[];
  writeArchives: (list: StreamArchive[]) => Promise<void>;
  /** The live-clips job's Twitch streams (src/liveclips/job.ts readState().streams). */
  twitchStreams: () => TwitchStreams;
  /** A recording's index when it is complete (vodIndexReady), else undefined. */
  readyIndex: (
    vodId: string,
  ) => Promise<Pick<VodIndex, "shots" | "duration"> | undefined>;
  /** Starts fetching the archive into the recordings folder; resolves with the file it is saved as. */
  download?: (a: StreamArchive) => Promise<string>;
  notify: (text: string) => Promise<unknown>;
  quota: (units: number) => Promise<unknown>;
  log?: (msg: string, detail?: Record<string, unknown>) => void;
}

/** The local date of an instant, YYYY-MM-DD (pure). */
export function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Day N as src/gtadaily.ts counts it (pure): the start date is Day 1; before it, Day 1 too (the first stream). */
export function streamDay(start: string, date: string): number {
  const d =
    Math.round(
      (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) /
        86_400_000,
    ) + 1;
  return Number.isFinite(d) && d >= 1 ? d : 1;
}

/** Chapters from a recording's index moved onto the YouTube clock (pure): `shift` seconds later on YouTube. */
export function shiftChapters(
  chapters: Chapter[],
  shift: number,
  duration?: number,
): Chapter[] {
  const moved = chapters
    .map((c, i) => ({
      at: i === 0 ? 0 : Math.round(c.at + shift),
      title: c.title,
    }))
    .filter(
      (c, i) =>
        i === 0 ||
        (c.at >= 10 && (duration === undefined || c.at < duration - 30)),
    );
  const out: Chapter[] = [];
  for (const c of moved)
    if (!out.length || c.at - out.at(-1)!.at >= 10) out.push(c);
  return out.length >= 3 ? out : [];
}

/** The stream's description (pure): the day's text, the disclosure once, the Twitch link, the chapters when known. */
export function liveDescription(o: {
  game: string;
  day: number;
  date: string;
  twitch?: string;
  chapters?: Chapter[];
}): string {
  const base = streamDescription({
    game: o.game,
    day: o.day,
    date: o.date,
    ...(o.twitch ? { twitch: o.twitch } : {}),
    ...(o.chapters?.length ? { chapters: o.chapters } : {}),
  });
  if (base.includes(STREAM_AI_LINE)) return base;
  // Before the chapters and hashtags: the disclosure sits with the text it describes.
  const cut = base.search(/\n\nChapters\n|\n\n#/);
  return cut >= 0
    ? `${base.slice(0, cut)}\n\n${STREAM_AI_LINE}${base.slice(cut)}`
    : `${base}\n\n${STREAM_AI_LINE}`;
}

/** A description with its chapter list replaced (pure), for a description someone else wrote. */
export function withChapters(
  description: string,
  chapters: Chapter[],
  stampOf: (s: number) => string,
): string {
  const block = `\n\nChapters\n${chapters.map((c) => `${stampOf(c.at)} ${c.title}`).join("\n")}`;
  if (CHAPTERS_HEAD.test(description))
    return description.replace(CHAPTERS_HEAD, block);
  const tags = description.search(/\n\n#/);
  return tags >= 0
    ? `${description.slice(0, tags)}${block}${description.slice(tags)}`
    : `${description}${block}`;
}

const alertOnce = async (
  a: StreamArchive,
  key: string,
  text: string,
  deps: LiveWatchDeps,
) => {
  a.alerts ??= [];
  if (a.alerts.includes(key)) return;
  a.alerts.push(key);
  await deps.notify(text);
};

/** One pass of the watcher. Returns what it did, for the log and the tests. */
export async function liveWatchTick(deps: LiveWatchDeps): Promise<string[]> {
  const done: string[] = [];
  const now = deps.now();
  const list = deps.readArchives();
  const byId = new Map(list.map((a) => [a.videoId, a]));
  const studio = (id: string) =>
    `https://studio.youtube.com/video/${id}/livestreaming`;

  // 1. The active broadcast: record it, name it, check its archive and privacy.
  const active = await deps.api.broadcasts("active");
  await deps.quota(1);
  for (const b of active) {
    let a = byId.get(b.id);
    if (!a) {
      const startedAt = b.actualStartTime ?? now.toISOString();
      const day = streamDay(
        deps.dailyStart,
        localDay(new Date(startedAt), deps.timeZone),
      );
      a = { videoId: b.id, title: b.title, startedAt, day, alerts: [] };
      list.push(a);
      byId.set(b.id, a);
      done.push(`recorded ${b.id}`);
    }
    await nameBroadcast(a, b, deps, done);
    if (b.recordFromStart === false)
      await alertOnce(
        a,
        "no_archive",
        `🔴 The live stream "${b.title}" is set not to keep its recording, so its watch hours will be lost when it ends. Turn on "Enable DVR / record" for future streams in Studio: ${studio(b.id)}`,
        deps,
      );
    if (b.privacyStatus && b.privacyStatus !== "public")
      await alertOnce(
        a,
        `live_${b.privacyStatus}`,
        `🔴 The live stream "${b.title}" is ${b.privacyStatus}, so its watch time will not count toward the Partner Programme. Pulse never changes privacy: if that was not on purpose, set it to Public in Studio: ${studio(b.id)}`,
        deps,
      );
    a.privacy = b.privacyStatus ?? a.privacy;
  }

  // 2. Recorded broadcasts no longer active: their end, the archive's privacy, the Twitch match, the chapters.
  const activeIds = new Set(active.map((b) => b.id));
  const open = list.filter(
    (a) => !activeIds.has(a.videoId) && (!a.endedAt || !a.chaptersSet),
  );
  const recent = open.filter(
    (a) => now.getTime() - Date.parse(a.startedAt) < 14 * 86_400_000,
  );
  if (recent.length) {
    const ended = await deps.api.broadcastsById(
      recent.filter((a) => !a.endedAt).map((a) => a.videoId),
    );
    if (recent.some((a) => !a.endedAt)) await deps.quota(1);
    for (const b of ended) {
      const a = byId.get(b.id)!;
      if (b.lifeCycleStatus === "complete" || b.actualEndTime) {
        a.endedAt = b.actualEndTime ?? now.toISOString();
        done.push(`ended ${b.id}`);
      }
    }
    for (const a of recent) {
      if (!a.endedAt) continue;
      // The Twitch stream it mirrors, and its recording once the live-clips job knows it.
      const tw = matchTwitch(a.startedAt, deps.twitchStreams());
      if (tw) {
        a.twitchStream = tw.id;
        a.twitchStartedAt = tw.startedAt;
        if (tw.vod) a.vodId = tw.vod;
      }
    }
    const videos = await deps.api.videos(
      recent.filter((a) => a.endedAt).map((a) => a.videoId),
    );
    if (videos.length) await deps.quota(1);
    const info = new Map(videos.map((v) => [v.id, v]));
    for (const a of recent) {
      if (!a.endedAt) continue;
      const v = info.get(a.videoId);
      if (!v) {
        await alertOnce(
          a,
          "archive_gone",
          `🔴 The saved stream "${a.title}" (${a.videoId}) is not on the channel any more, so its watch hours are gone. Pulse never deletes archives; check Studio > Content > Live.`,
          deps,
        );
        continue;
      }
      a.privacy = v.privacyStatus;
      if (v.privacyStatus !== "public")
        await alertOnce(
          a,
          `archive_${v.privacyStatus}`,
          `🟠 The saved stream "${a.title}" is ${v.privacyStatus}: its watch time only counts while it is public. Pulse never changes privacy; if that was not on purpose, set it to Public: https://studio.youtube.com/video/${a.videoId}/edit`,
          deps,
        );
      if (!a.chaptersSet) await addChapters(a, v, deps, done, now);
    }
  }
  await deps.writeArchives(list);
  return done;
}

/** Sets the day's title (when wanted) and description on a live broadcast, once. */
async function nameBroadcast(
  a: StreamArchive,
  b: Broadcast,
  deps: LiveWatchDeps,
  done: string[],
): Promise<void> {
  if (a.titleSet && a.describedAt) return;
  const s = deps.settings;
  const day = a.day ?? 1;
  const date = localDay(new Date(a.startedAt), deps.timeZone);
  const keepTitle = !s.liveTitle || DAILY_TITLE.test(b.title);
  const title = keepTitle ? b.title : streamTitle({ game: s.liveGame, day });
  const description =
    b.description.includes(STREAM_AI_LINE) &&
    (!s.liveTwitch || b.description.includes(`twitch.tv/${s.liveTwitch}`))
      ? b.description
      : liveDescription({
          game: s.liveGame,
          day,
          date,
          ...(s.liveTwitch ? { twitch: s.liveTwitch } : {}),
        });
  if (title === b.title && description === b.description) {
    a.titleSet = true;
    a.describedAt = new Date().toISOString();
    return;
  }
  const [v] = await deps.api.videos([b.id]);
  await deps.quota(1);
  if (!v) return;
  await deps.api.setSnippet(v, title, description);
  await deps.quota(50);
  a.title = title;
  a.titleSet = true;
  a.describedAt = deps.now().toISOString();
  done.push(`named ${b.id}: ${title}`);
}

const stampOf = (seconds: number) => {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

/** After the stream: chapters from the indexed recording (Twitch's, else the fetched archive), or the fetch itself. */
async function addChapters(
  a: StreamArchive,
  v: VideoInfo,
  deps: LiveWatchDeps,
  done: string[],
  now: Date,
): Promise<void> {
  const fromTwitch = a.vodId ? await deps.readyIndex(a.vodId) : undefined;
  const fromArchive =
    !fromTwitch && a.downloaded
      ? await deps.readyIndex(`yt-${a.videoId}`)
      : undefined;
  const index = fromTwitch ?? fromArchive;
  if (index) {
    const shift =
      fromTwitch && a.twitchStartedAt
        ? (Date.parse(a.twitchStartedAt) - Date.parse(a.startedAt)) / 1000
        : 0;
    const chapters = shiftChapters(
      chaptersFromIndex(index),
      shift,
      v.durationSeconds,
    );
    if (!chapters.length) {
      a.chaptersSet = true; // fewer than three places: YouTube would show none
      done.push(`no chapters for ${a.videoId}`);
      return;
    }
    await deps.api.setSnippet(
      v,
      v.title,
      withChapters(v.description, chapters, stampOf),
    );
    await deps.quota(50);
    a.chaptersSet = true;
    done.push(`chapters ${a.videoId}: ${chapters.length}`);
    return;
  }
  const waited = now.getTime() - Date.parse(a.endedAt ?? a.startedAt);
  if (
    deps.settings.liveArchiveDownload &&
    deps.download &&
    !a.downloaded &&
    !fromTwitch &&
    // A Twitch recording on its way to the index is the same stream: wait four times as long for it before fetching.
    (!a.vodId || waited >= 4 * deps.settings.liveArchiveWaitHours * 3600_000) &&
    v.privacyStatus === "public" &&
    waited >= deps.settings.liveArchiveWaitHours * 3600_000
  ) {
    a.downloaded = await deps.download(a);
    done.push(`fetching ${a.videoId}`);
  }
}

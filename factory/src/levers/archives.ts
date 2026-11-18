// Stream-archive linking (STREAM_ARCHIVE_LINKS, research of 14 Nov 2026, sections 3.1 and 3.3): once the owner streams
// on Pulse, a Short cut from a stream points at that stream's YouTube archive at the moment it was cut from, in its
// description, its pinned comment and its related-video link (the Studio routine). The archive is the strongest
// Shorts-to-long match there is (the live footage behind the Short), and archive watch time counts toward the Partner
// Programme. Prepared ahead: with no archive on record nothing changes, and it switches itself on with the first one.
//
// The archives are recorded by the live watcher (src/levers/livewatch.ts) in <data>/levers/archives.json: each with
// its YouTube start and end, and the Twitch stream and recording it mirrors when one started within the match window.
// A Short's moment is found in one of three ways (pure):
//   - a near-live Short (LIVE_CLIPS, source kind "twitch_live"): the Twitch stream's start plus the clip's offset;
//   - a Short mined from a Twitch recording ("twitch_vod"): the recording's stream start plus the offset;
//   - a Short mined from the downloaded YouTube archive itself (recording id "yt-<video id>"): the offset as it is.
// The Twitch and YouTube clocks differ by the relay's start-up delay, so the link starts a few seconds early.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { stamp } from "../youtube/chapters.ts";
import type { GameplayMeta } from "../gameplay.ts";

export interface StreamArchive {
  /** The YouTube video id (a broadcast's id is its video's id). */
  videoId: string;
  title: string;
  /** actualStartTime / actualEndTime, ISO. */
  startedAt: string;
  endedAt?: string;
  /** GTA 6 Day N of the stream, when the daily run is configured. */
  day?: number;
  /** The Twitch stream it mirrors and when that started (ISO), and the Twitch recording once known ("v123"). */
  twitchStream?: string;
  twitchStartedAt?: string;
  vodId?: string;
  /** The YouTube archive fetched for the VOD index (LIVE_ARCHIVE_DOWNLOAD): the file it was saved as. */
  downloaded?: string;
  /** What the watcher has done: title, description, chapters set; alerts already sent (by key). */
  titleSet?: boolean;
  describedAt?: string;
  chaptersSet?: boolean;
  privacy?: string;
  alerts?: string[];
}

export interface ArchiveLink {
  videoId: string;
  seconds: number;
  title: string;
}

/** The Twitch streams the live-clips job saw (src/liveclips/job.ts LiveState.streams). */
export type TwitchStreams = Record<
  string,
  { startedAt: string; ended?: string; vod?: string }
>;

/** Seconds the link starts before the moment, for the relay's delay between Twitch and YouTube. */
export const LINK_LEAD_SECONDS = 8;
/** A Twitch stream started this close to a YouTube broadcast is the same stream. */
export const MATCH_WINDOW_MS = 45 * 60_000;
/** YouTube keeps archives up to 12 hours long. */
const MAX_ARCHIVE_MS = 12 * 3600_000;
const YT_RECORDING = /^yt-([\w-]{11})$/;
const RECORDING_ID = /\[([\w-]+)\]\s*\.[a-z0-9]+$/i;

export const archivesFile = (dataDir: string) =>
  path.join(dataDir, "levers", "archives.json");

export function readArchives(dataDir: string): StreamArchive[] {
  try {
    const v = JSON.parse(fs.readFileSync(archivesFile(dataDir), "utf8"));
    return Array.isArray(v) ? (v as StreamArchive[]) : [];
  } catch {
    return [];
  }
}

export async function writeArchives(
  dataDir: string,
  list: StreamArchive[],
): Promise<void> {
  const file = archivesFile(dataDir);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(`${file}.tmp`, JSON.stringify(list, null, 2), "utf8");
  await fsp.rename(`${file}.tmp`, file);
}

/** The archive an instant falls in (pure), or undefined. */
export function archiveAt(
  at: number,
  archives: StreamArchive[],
): StreamArchive | undefined {
  return archives.find((a) => {
    const from = Date.parse(a.startedAt);
    const to = a.endedAt ? Date.parse(a.endedAt) : from + MAX_ARCHIVE_MS;
    return Number.isFinite(from) && at >= from && at <= to;
  });
}

/** The Twitch stream that matches a YouTube broadcast (pure): the nearest start inside the window. */
export function matchTwitch(
  startedAt: string,
  streams: TwitchStreams,
): { id: string; startedAt: string; vod?: string } | undefined {
  const at = Date.parse(startedAt);
  let best: { id: string; startedAt: string; vod?: string } | undefined;
  let gap = MATCH_WINDOW_MS;
  for (const [id, s] of Object.entries(streams)) {
    const d = Math.abs(Date.parse(s.startedAt) - at);
    if (Number.isFinite(d) && d <= gap) {
      gap = d;
      best = { id, startedAt: s.startedAt, ...(s.vod ? { vod: s.vod } : {}) };
    }
  }
  return best;
}

/** The recording id in a file name ("2026-11-19 GTA 6 [v2917738469].mp4" is "v2917738469"), pure. */
export function recordingId(file: string): string | undefined {
  return path.basename(file).match(RECORDING_ID)?.[1];
}

/**
 * Where a Short cut from a stream sits in the YouTube archive (pure): the archive and the second to start at, a few
 * seconds before the clip. Undefined when the Short was not cut from a stream or no archive covers it.
 */
export function archiveLinkFor(
  meta: Pick<GameplayMeta, "source" | "clip" | "live">,
  streams: TwitchStreams,
  archives: StreamArchive[],
): ArchiveLink | undefined {
  const offset = meta.clip.start_in_source ?? 0;
  const link = (a: StreamArchive, seconds: number): ArchiveLink => ({
    videoId: a.videoId,
    seconds: Math.max(0, Math.floor(seconds - LINK_LEAD_SECONDS)),
    title: a.title,
  });
  const abs = (streamStart: string | undefined) => {
    const t = streamStart ? Date.parse(streamStart) : NaN;
    if (!Number.isFinite(t)) return undefined;
    const at = t + offset * 1000;
    const a = archiveAt(at, archives);
    return a ? link(a, (at - Date.parse(a.startedAt)) / 1000) : undefined;
  };
  if (meta.source.kind === "twitch_live" && meta.live?.stream_id)
    return abs(streams[meta.live.stream_id]?.startedAt);
  if (
    meta.source.kind === "twitch_vod" ||
    meta.source.kind === "youtube_archive"
  ) {
    const id = recordingId(meta.source.file) ?? "";
    const yt = id.match(YT_RECORDING)?.[1];
    if (yt) {
      const a = archives.find((x) => x.videoId === yt);
      return a ? link(a, offset) : undefined;
    }
    const byVod = archives.find((x) => x.vodId && x.vodId === id);
    if (byVod?.twitchStartedAt) return abs(byVod.twitchStartedAt);
    const stream = Object.values(streams).find((s) => s.vod === id);
    return abs(stream?.startedAt);
  }
  return undefined;
}

export const archiveUrl = (l: ArchiveLink) =>
  `https://youtu.be/${l.videoId}${l.seconds > 0 ? `?t=${l.seconds}` : ""}`;

/** The Short's description line (pure). */
export function archiveDescriptionLine(l: ArchiveLink): string {
  return `Watch it happen in the full stream (from ${stamp(l.seconds)}): ${l.title} ${archiveUrl(l)}`;
}

/** The Short's comment line (pure): links are not clickable in Shorts comments, so the time is said too. */
export function archiveCommentLine(l: ArchiveLink): string {
  return `The full stream, from this exact moment (${stamp(l.seconds)}): ${archiveUrl(l)}`;
}

export interface ArchiveRow {
  youtube_video_id: string | null;
  stream_archive?: ArchiveLink | null;
}

/**
 * The related-video plan with stream archives first (pure): a Short cut from a stream links to its archive instead of
 * the planned long video. Items stay in order; Shorts the plan did not list are left out (the plan decides which are due).
 */
export function withArchiveTargets<
  T extends {
    short: string;
    target: string;
    targetTitle: string;
    reason: string;
  },
>(plan: T[], rows: ArchiveRow[]): T[] {
  const by = new Map(
    rows
      .filter((r) => r.youtube_video_id && r.stream_archive?.videoId)
      .map((r) => [r.youtube_video_id!, r.stream_archive!] as const),
  );
  return plan.map((p) => {
    const a = by.get(p.short);
    if (!a || ("action" in p && (p as { action?: string }).action === "clear"))
      return p;
    return {
      ...p,
      target: a.videoId,
      targetTitle: a.title,
      reason: `cut from this stream archive at ${stamp(a.seconds)}`,
    };
  });
}

/** The Twitch streams the live-clips job recorded (data/liveclips/state.json, src/liveclips/job.ts), read without its job. */
export function readTwitchStreams(dataDir: string): TwitchStreams {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(dataDir, "liveclips", "state.json"), "utf8"));
    return o && typeof o.streams === "object" && o.streams ? (o.streams as TwitchStreams) : {};
  } catch {
    return {};
  }
}

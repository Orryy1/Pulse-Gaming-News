// The signed-in lane never touches Pulse's own channel (owner, 19 Nov 2026). The download account (YTDLP_COOKIES_FILE)
// is a separate, disposable 18+ Google account; a view, like, comment or subscription from it on Pulse's own videos
// would look like the channel boosting itself. So every place that turns the cookies into yt-dlp arguments asks here
// first, and the YouTube guard refuses any signed-in call that still names Pulse's channel (src/lib/ytguard.ts).
//
// What counts as Pulse's own: the channel ids (YOUTUBE_CHANNEL_ID and TWIN_YOUTUBE_CHANNEL_ID, the same defaults as
// src/config.ts), its handles (YT_OWN_HANDLES, default PulseGMG) and every video id the factory has uploaded, kept in
// DATA_DIR/ytguard/own_videos.json by the factory process (refreshOwnVideos, from the episodes table).

import fs from "node:fs";
import path from "node:path";

export interface OwnChannel {
  channelIds: string[];
  handles: string[];
  videoIds: Set<string>;
}

/** Pulse's main channel id when YOUTUBE_CHANNEL_ID is unset (the same default as src/config.ts). */
export const PULSE_CHANNEL_ID = "UCvgNDjtTezrpxL8oUe6mYwA";

const list = (v: string | undefined): string[] =>
  String(v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** The file the factory keeps Pulse's uploaded video ids in, beside the guard's state. */
export function ownVideosFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(
    path.resolve(env.DATA_DIR || "./data"),
    "ytguard",
    "own_videos.json",
  );
}

/** Pulse's channel ids and handles from the environment, and the video ids from `videoIds` (pure given its inputs). */
export function ownChannelFrom(
  env: NodeJS.ProcessEnv,
  videoIds: Iterable<string> = [],
): OwnChannel {
  const ids = [
    String(env.YOUTUBE_CHANNEL_ID ?? "").trim() || PULSE_CHANNEL_ID,
    String(env.TWIN_YOUTUBE_CHANNEL_ID ?? "").trim(),
  ].filter(Boolean);
  const handles = (
    env.YT_OWN_HANDLES === undefined ? ["PulseGMG"] : list(env.YT_OWN_HANDLES)
  ).map((h) => h.replace(/^@/, "").toLowerCase());
  return {
    channelIds: [...new Set(ids)],
    handles: [...new Set(handles)],
    videoIds: new Set(videoIds),
  };
}

function readVideoIds(file: string): string[] {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as { ids?: unknown };
    return Array.isArray(j.ids)
      ? j.ids.map(String).filter((x) => /^[\w-]{11}$/.test(x))
      : [];
  } catch {
    return [];
  }
}

let cached: { at: number; own: OwnChannel } | undefined;

/** Pulse's own channel as this process knows it now (the video list re-read at most once a minute). */
export function ownChannel(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): OwnChannel {
  if (cached && now - cached.at < 60_000) return cached.own;
  const own = ownChannelFrom(env, readVideoIds(ownVideosFile(env)));
  cached = { at: now, own };
  return own;
}

/** Forgets the cached list (after refreshOwnVideos, and for tests). */
export function forgetOwnChannel(): void {
  cached = undefined;
}

const VIDEO_ID = [
  /[?&]v=([\w-]{11})/,
  /youtu\.be\/([\w-]{11})/,
  /youtube\.com\/(?:shorts|embed|live)\/([\w-]{11})/,
];

/**
 * True when any argument names Pulse's own channel (pure): its channel id, a link to its handle, or one of its videos
 * (a watch, short or embed link, or a bare 11-character id that is one of Pulse's uploads).
 */
export function touchesOwnChannel(
  args: readonly string[],
  own: OwnChannel,
): boolean {
  for (const raw of args) {
    const a = String(raw);
    if (own.channelIds.some((id) => id && a.includes(id))) return true;
    const lower = a.toLowerCase();
    if (
      own.handles.some(
        (h) =>
          h &&
          new RegExp(
            `(^|youtube\\.com/)@${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\b|/|$)`,
          ).test(lower),
      )
    )
      return true;
    for (const re of VIDEO_ID) {
      const m = re.exec(a);
      if (m && own.videoIds.has(m[1]!)) return true;
    }
    if (/^[\w-]{11}$/.test(a) && own.videoIds.has(a)) return true;
  }
  return false;
}

/**
 * Writes Pulse's uploaded video ids for every process to read (the factory process, from the episodes table; no
 * YouTube quota). Returns how many were written.
 */
export async function refreshOwnVideos(
  db: { query<T>(sql: string, params?: unknown[]): Promise<T[]> },
  file = ownVideosFile(),
): Promise<number> {
  const rows = await db.query<{ id: string }>(
    `SELECT youtube_video_id AS id FROM episodes WHERE youtube_video_id IS NOT NULL`,
  );
  const ids = [
    ...new Set(
      rows.map((r) => String(r.id)).filter((x) => /^[\w-]{11}$/.test(x)),
    ),
  ];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ at: new Date().toISOString(), ids }));
  fs.renameSync(tmp, file);
  forgetOwnChannel();
  return ids.length;
}

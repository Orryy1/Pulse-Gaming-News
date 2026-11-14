// The Twitch-to-YouTube relay's settings (STREAM_RELAY, off by default), read in one place (pure: the environment is
// passed in). See src/relay/job.ts for what the relay does with them.

import os from "node:os";
import path from "node:path";

export interface RelaySettings {
  /** STREAM_RELAY: mirror the owner's Twitch stream to the Pulse YouTube channel while he is live. */
  enabled: boolean;
  /** STREAM_RELAY_CHANNEL: the Twitch login watched (LIVE_CLIPS_CHANNEL, then tinotv). */
  channel: string;
  /** STREAM_RELAY_POLL_SECONDS: how often Twitch is asked whether he is live, and YouTube how the stream is doing. */
  pollSeconds: number;
  /** STREAM_RELAY_PRIVACY: the broadcast's privacy (public; private only for tests). */
  privacy: "public" | "unlisted" | "private";
  /** STREAM_RELAY_QUALITY: the Twitch quality streamlink asks for ("best": exactly what the Xbox sends). */
  quality: string;
  /** STREAM_RELAY_OFFLINE_MINUTES: how long Twitch must say offline before the relay stops (an Xbox reconnect is not an end). */
  offlineMinutes: number;
  /** STREAM_RELAY_HEALTH_MINUTES: YouTube showing no data this long while Twitch is live restarts the relay once, then alerts. */
  healthMinutes: number;
  /** STREAM_RELAY_MAX_RESTARTS: fresh broadcasts after YouTube ends one mid-stream (a Content ID stop), per stream. */
  maxRestarts: number;
  /** STREAM_RELAY_ARCHIVE_WAIT_HOURS: hours to wait for the Twitch VOD before the YouTube archive is fetched for the index instead. */
  archiveWaitHours: number;
  /** STREAM_RELAY_GAME: the game named in titles when Twitch names none (the Xbox usually sets it). */
  fallbackGame: string;
  /** RELAY_MUSIC_STRIP: pass the audio through RELAY_MUSIC_STRIP_CMD (licensed car radio out); off means untouched audio. */
  musicStrip: boolean;
  /** RELAY_MUSIC_STRIP_CMD: the filter: 48 kHz stereo s16le PCM on stdin, the same on stdout, run through /bin/sh. */
  musicStripCmd: string;
  /** GTA_DAILY_START: Day 1 of the GTA 6 series, so the stream's Day N matches the Shorts' Day N. */
  dailyStart: string;
  /** TIMEZONE: the owner's day. */
  timeZone: string;
  /** CHALLENGE_SERIES (src/challenge.ts): read "[CHALLENGE: rule]" in the live title and file the challenge. */
  challengeSeries: boolean;
  /** CHALLENGE_END_DAYS: days without the tag that end a challenge. */
  challengeQuietDays: number;
  /** VOD_MINER_DIR: where the stream index looks for recordings (the Twitch VOD downloader's folder). */
  vodDir: string;
  dataDir: string;
  streamlink: string;
  ffmpeg: string;
  ytdlp: string;
}

const bool = (env: NodeJS.ProcessEnv, name: string, fallback: boolean) => {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
};
const num = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  lo: number,
  hi: number,
) => {
  const n = Number(env[name]);
  return env[name] === undefined || env[name] === "" || !Number.isFinite(n)
    ? fallback
    : Math.min(hi, Math.max(lo, n));
};

export function relaySettings(
  env: NodeJS.ProcessEnv,
  platform = process.platform,
): RelaySettings {
  const brew = (name: string) =>
    platform === "darwin" ? `/opt/homebrew/bin/${name}` : name;
  const privacy = (env.STREAM_RELAY_PRIVACY || "public").toLowerCase();
  return {
    enabled: bool(env, "STREAM_RELAY", false),
    channel: (env.STREAM_RELAY_CHANNEL || env.LIVE_CLIPS_CHANNEL || "tinotv")
      .toLowerCase()
      .trim(),
    pollSeconds: num(env, "STREAM_RELAY_POLL_SECONDS", 60, 20, 300),
    privacy:
      privacy === "private" || privacy === "unlisted" ? privacy : "public",
    quality: env.STREAM_RELAY_QUALITY || "best",
    offlineMinutes: num(env, "STREAM_RELAY_OFFLINE_MINUTES", 3, 1, 30),
    healthMinutes: num(env, "STREAM_RELAY_HEALTH_MINUTES", 3, 1, 30),
    maxRestarts: Math.round(num(env, "STREAM_RELAY_MAX_RESTARTS", 3, 0, 10)),
    archiveWaitHours: num(env, "STREAM_RELAY_ARCHIVE_WAIT_HOURS", 6, 1, 72),
    fallbackGame: env.STREAM_RELAY_GAME || "Grand Theft Auto VI",
    musicStrip: bool(env, "RELAY_MUSIC_STRIP", false),
    musicStripCmd: env.RELAY_MUSIC_STRIP_CMD || "",
    dailyStart: env.GTA_DAILY_START || "2026-11-19",
    timeZone: env.TIMEZONE || "Europe/London",
    challengeSeries: bool(env, "CHALLENGE_SERIES", false),
    challengeQuietDays: num(env, "CHALLENGE_END_DAYS", 7, 1, 60),
    vodDir:
      env.VOD_MINER_DIR || path.join(os.homedir(), "Videos", "TinoTV VODs"),
    dataDir: path.resolve(env.DATA_DIR || "./data"),
    streamlink: env.STREAMLINK_PATH || brew("streamlink"),
    ffmpeg: env.FFMPEG_PATH || brew("ffmpeg"),
    ytdlp: env.YTDLP_PATH || brew("yt-dlp"),
  };
}

/** One line for logs and the boot summary. */
export function relaySummary(s: RelaySettings): string {
  if (!s.enabled) return "off";
  return `on (twitch.tv/${s.channel} to YouTube, ${s.privacy}; up to ${s.maxRestarts} restarts a stream${s.musicStrip ? (s.musicStripCmd ? "; car radio filtered" : "; RELAY_MUSIC_STRIP on but no RELAY_MUSIC_STRIP_CMD, audio untouched") : ""})`;
}

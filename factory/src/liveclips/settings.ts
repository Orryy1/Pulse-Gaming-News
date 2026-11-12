// The settings of near-live clips (LIVE_CLIPS, off by default), read in one place (pure: the environment is passed
// in) so the rest of the config stays untouched. See src/liveclips/job.ts for what the job does with them.

export interface LiveClipsSettings {
  /** LIVE_CLIPS: while the owner is live on Twitch, find big moments within minutes and send them to the gameplay lane. */
  enabled: boolean;
  /** LIVE_CLIPS_CHANNEL: the Twitch login watched (the owner's channel). */
  channel: string;
  /** LIVE_CLIPS_PER_HOUR: candidates sent to the lane in any hour of a stream. */
  perHour: number;
  /** LIVE_CLIPS_PER_DAY: candidates sent to the lane in a day (the owner's local day). */
  perDay: number;
  /** LIVE_CLIPS_GAP_MINUTES: minutes between two candidates, so one long fight is one Short, not three. */
  gapMinutes: number;
  /** LIVE_CLIPS_MIN_SCORE: the signals' combined score a moment needs (1 = one clear signal on its own). */
  minScore: number;
  /** LIVE_CLIPS_WARMUP_MINUTES: minutes of stream heard before loudness alone may pick a moment (it needs a baseline). */
  warmupMinutes: number;
  /** LIVE_CLIPS_CHAT: read the channel's chat (Twitch's free anonymous read) for activity spikes and "clip it". */
  chat: boolean;
  /** LIVE_CLIPS_CHAT_LOG: keep the chat in data/liveclips/chat/, so a past stream can be replayed to tune the detector. */
  chatLog: boolean;
  /** LIVE_CLIPS_VIEWER_CLIPS: Twitch clips viewers make (Helix, with TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET). */
  viewerClips: boolean;
  /** LIVE_CLIPS_LOUDNESS: sudden loudness and on-screen action in the stream itself (works with an empty chat). */
  loudness: boolean;
  /** LIVE_CLIPS_BUFFER_MINUTES: minutes of the live stream kept on disk to cut from (about 60 MB a minute at 1080p60). */
  bufferMinutes: number;
  /** LIVE_CLIPS_MAX_HEIGHT: the stream quality recorded (1080 by default; 720 halves the download). */
  maxHeight: number;
  /** LIVE_CLIPS_WAIT_MINUTES: how long a cut waits behind Pulse's renders (~/orch/macrun.sh) before trying again. */
  waitMinutes: number;
  /** LIVE_CLIPS_PUBLISH_NOW: an approved live Short goes out at the next free gap, not the evening gameplay slot. */
  publishNow: boolean;
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

export function liveClipsSettings(env: NodeJS.ProcessEnv): LiveClipsSettings {
  return {
    enabled: bool(env, "LIVE_CLIPS", false),
    channel: (env.LIVE_CLIPS_CHANNEL || "tinotv").toLowerCase().trim(),
    perHour: Math.round(num(env, "LIVE_CLIPS_PER_HOUR", 2, 1, 6)),
    perDay: Math.round(num(env, "LIVE_CLIPS_PER_DAY", 8, 1, 30)),
    gapMinutes: num(env, "LIVE_CLIPS_GAP_MINUTES", 10, 2, 120),
    minScore: num(env, "LIVE_CLIPS_MIN_SCORE", 1, 0.5, 10),
    warmupMinutes: num(env, "LIVE_CLIPS_WARMUP_MINUTES", 8, 2, 60),
    chat: bool(env, "LIVE_CLIPS_CHAT", true),
    chatLog: bool(env, "LIVE_CLIPS_CHAT_LOG", true),
    viewerClips: bool(env, "LIVE_CLIPS_VIEWER_CLIPS", true),
    loudness: bool(env, "LIVE_CLIPS_LOUDNESS", true),
    bufferMinutes: num(env, "LIVE_CLIPS_BUFFER_MINUTES", 6, 2, 30),
    maxHeight: Math.round(num(env, "LIVE_CLIPS_MAX_HEIGHT", 1080, 360, 2160)),
    waitMinutes: Math.round(num(env, "LIVE_CLIPS_WAIT_MINUTES", 20, 1, 120)),
    publishNow: bool(env, "LIVE_CLIPS_PUBLISH_NOW", true),
  };
}

/** One line for the boot summary. */
export function liveClipsSummary(s: LiveClipsSettings): string {
  if (!s.enabled) return "off";
  const signals = [
    s.loudness ? "loudness" : "",
    s.chat ? "chat" : "",
    s.viewerClips ? "viewer clips" : "",
  ].filter(Boolean);
  return `on (twitch.tv/${s.channel}; ${signals.join("+")}; up to ${s.perHour}/h, ${s.perDay}/day, ${s.gapMinutes} min apart${s.publishNow ? "; out on approval" : ""})`;
}

// The platform levers (research of 14 Nov 2026, reports/research-2026-11-14/platform.md), read in one place (pure: the
// environment is passed in) so the rest of the config stays untouched. Every lever that changes what goes public is
// off by default; the read-only ones (the Partner Programme tracker and the Studio plans) are on.

export type TrialGraduation = "MANUAL" | "SS_PERFORMANCE";

export interface LeverSettings {
  /** ANSWER_PACK: long videos get a 2 to 3 sentence summary on top, question-style chapters and a key-facts list. */
  answerPack: boolean;
  /** ANSWER_PAGES: a long video's pulsegmg.com page gets the summary, chapters, key facts, Clip and SeekToAction. */
  answerPages: boolean;
  /** STREAM_ARCHIVE_LINKS: a Short cut from a stream points at the YouTube archive at that moment (description, comment, related video). */
  streamArchiveLinks: boolean;
  /** LIVE_AUTOFILL: watch the channel's live broadcasts, title and describe them, check the archive stays public, add chapters after. */
  liveAutofill: boolean;
  /** LIVE_AUTOFILL_TITLE: also set the stream's title (on by default; off keeps the owner's own title and sets only the description). */
  liveTitle: boolean;
  /** LIVE_GAME: the game streamed, for the title and description. */
  liveGame: string;
  /** LIVE_TWITCH: the Twitch login the stream also runs on, linked in the description ("" for none). */
  liveTwitch: string;
  /** LIVE_POLL_MINUTES: how often the watcher asks YouTube for an active broadcast (one quota unit each). */
  livePollMinutes: number;
  /** LIVE_ARCHIVE_DOWNLOAD: with no Twitch recording indexed after LIVE_ARCHIVE_WAIT_HOURS, fetch the YouTube archive for the VOD index. */
  liveArchiveDownload: boolean;
  liveArchiveWaitHours: number;
  /** LIVE_ARCHIVE_HEIGHT: the archive quality fetched for the index (720 keeps a 4-hour stream near 6 GB). */
  liveArchiveHeight: number;
  /** PODCAST_PLAYLIST: the playlist (title or id) marked as a podcast through the Data API; "" leaves playlists alone. */
  podcastPlaylist: string;
  /** IG_TRIAL_SHARE: the share of Instagram Reels posted as trial reels (shown to non-followers first); 0 is off. */
  igTrialShare: number;
  /** IG_TRIAL_GRADUATION: SS_PERFORMANCE (Instagram shares a trial that does well) or MANUAL (the owner decides in the app). */
  igTrialGraduation: TrialGraduation;
  /** YPP_TRACKER: the weekly public watch-hours count against the Partner Programme bars (YouTube Analytics, read only). */
  yppTracker: boolean;
  /** YPP_DEADLINE: the last day to apply on the 4,000-hour rule (YYYY-MM-DD). */
  yppDeadline: string;
  /** STUDIO_PLANS: serve the Studio-only steps (game title, Shorts series) to the Brave routines at /routine/gametitle and /routine/shortsseries. */
  studioPlans: boolean;
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
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function leverSettings(env: NodeJS.ProcessEnv): LeverSettings {
  const grad = String(env.IG_TRIAL_GRADUATION ?? "")
    .trim()
    .toUpperCase();
  return {
    answerPack: bool(env, "ANSWER_PACK", false),
    answerPages: bool(env, "ANSWER_PAGES", false),
    streamArchiveLinks: bool(env, "STREAM_ARCHIVE_LINKS", false),
    liveAutofill: bool(env, "LIVE_AUTOFILL", false),
    liveTitle: bool(env, "LIVE_AUTOFILL_TITLE", true),
    liveGame: (env.LIVE_GAME || "Grand Theft Auto VI").trim(),
    liveTwitch: (env.LIVE_TWITCH ?? env.LIVE_CLIPS_CHANNEL ?? "tinotv")
      .trim()
      .toLowerCase(),
    livePollMinutes: Math.round(num(env, "LIVE_POLL_MINUTES", 5, 2, 60)),
    liveArchiveDownload: bool(env, "LIVE_ARCHIVE_DOWNLOAD", true),
    liveArchiveWaitHours: num(env, "LIVE_ARCHIVE_WAIT_HOURS", 3, 0.5, 72),
    liveArchiveHeight: Math.round(
      num(env, "LIVE_ARCHIVE_HEIGHT", 720, 360, 2160),
    ),
    podcastPlaylist: (env.PODCAST_PLAYLIST ?? "").trim(),
    igTrialShare: num(env, "IG_TRIAL_SHARE", 0, 0, 1),
    igTrialGraduation: grad === "MANUAL" ? "MANUAL" : "SS_PERFORMANCE",
    yppTracker: bool(env, "YPP_TRACKER", true),
    yppDeadline: DAY.test(env.YPP_DEADLINE ?? "")
      ? env.YPP_DEADLINE!
      : "2027-01-31",
    studioPlans: bool(env, "STUDIO_PLANS", true),
  };
}

/** One line for the boot summary. */
export function leverSummary(s: LeverSettings): string {
  const on = [
    s.answerPack ? "answer pack" : "",
    s.answerPages ? "answer pages" : "",
    s.streamArchiveLinks ? "stream-archive links" : "",
    s.liveAutofill
      ? `live autofill (${s.liveGame}, every ${s.livePollMinutes} min${s.liveTwitch ? `, Twitch ${s.liveTwitch}` : ""})`
      : "",
    s.podcastPlaylist ? `podcast "${s.podcastPlaylist}"` : "",
    s.igTrialShare > 0
      ? `Instagram trials ${Math.round(s.igTrialShare * 100)}% (${s.igTrialGraduation})`
      : "",
    s.yppTracker ? `YPP tracker to ${s.yppDeadline}` : "",
    s.studioPlans ? "Studio plans" : "",
  ].filter(Boolean);
  return on.length ? on.join("; ") : "off";
}

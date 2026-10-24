// Every runtime knob lives here and is read from the environment once.
// Nothing secret is ever logged; see redactedConfig().

import fs from "node:fs";
import path from "node:path";

// Local installs keep settings in factory/.env (never committed).
const ENV_FILE = path.resolve(process.env.PULSE_ENV_FILE ?? ".env");
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export type ApprovalMode = "manual" | "timeout" | "auto";
export type PrivacyStatus = "public" | "unlisted" | "private";
// local: the Codex Liam clone only. elevenlabs: ElevenLabs only. auto: local first,
// ElevenLabs if the local server is down and the plan has credits for the script.
// elevenlabs-first: spend the credits already paid for on the real ElevenLabs voice
// while the month's balance covers the script, never beyond it, then the local clone.
export type VoiceProvider = "local" | "elevenlabs" | "auto" | "elevenlabs-first";
export const VOICE_PROVIDERS: VoiceProvider[] = ["local", "elevenlabs", "auto", "elevenlabs-first"];
// Chromium GL backend for Remotion. "angle" uses the GPU (5x faster on the
// production PC, pixel-identical output); "swangle" is the software fallback.
export type RemotionGl = "swangle" | "angle" | "egl" | "swiftshader" | "vulkan" | "angle-egl";
const REMOTION_GLS: RemotionGl[] = ["swangle", "angle", "egl", "swiftshader", "vulkan", "angle-egl"];

export interface Config {
  port: number;
  publicUrl: string;
  siteUrl: string; // the website's own domain once it is live (SITE_URL); empty: the public URL
  dataDir: string;
  databaseUrl: string;
  appSecret: string;
  adminToken: string;

  anthropicModel: string;
  claudeModelMid: string; // picking footage, posts, story selection
  claudeModelLow: string; // simple filtering
  voiceProvider: VoiceProvider;
  localTtsUrl: string;
  localVoiceId: string;
  localSpeakingRate: number;
  localTtsStart: string;
  syntheticMedia: boolean;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsModel: string;
  voicePool: Array<{ id: string; name: string }>; // ElevenLabs voices rotated across Shorts; empty = always elevenLabsVoiceId
  voiceRotation: number; // Shorts per voice before moving to the next

  discordWebhookUrl: string;
  healthcheckPingUrl: string;

  legacyTokenDir: string;
  googleClientId: string;
  googleClientSecret: string;
  youtubeRefreshToken: string;
  youtubePrivacy: PrivacyStatus;
  youtubeVetoMinutes: number;

  dailyTarget: number; // Shorts per day across all lanes
  timezone: string; // the owner's day and slot clock
  newsSlots: string[]; // "HH:MM" local publish slots for the news lane
  slotLeadMinutes: number; // start producing this long before a slot
  slotGraceMinutes: number; // a slot missed by less than this is still filled
  maxProducing: number; // episodes allowed mid-production at once (waiting ones never block)
  minUploadGapMinutes: number;
  discoverMinutes: number;
  breakingEnabled: boolean;
  breakingPerDay: number;
  breakingScoreMin: number;
  breakingMaxAgeMinutes: number;
  breakingCooldownHours: number;
  breakingApprovalMinutes: number;
  breakingWindow: string; // local "HH:MM-HH:MM"
  sprintExtra: number; // extra breaking Shorts allowed on a showcase day
  sprintScoreMin: number; // the breaking score bar for a showcase story
  quotaUnitsPerDay: number;
  /** videos.insert calls a day (its own bucket; check the project's Cloud Console for the real limit). */
  uploadCallsPerDay: number;
  /** search.list calls a day (its own bucket). */
  searchCallsPerDay: number;
  evergreenEnabled: boolean;
  evergreenDays: string[]; // local weekdays, e.g. tue,thu,sat
  evergreenSlot: string; // local "HH:MM"
  focusTopic: string; // a franchise the editors favour for a while (e.g. a huge launch), empty = none
  focusUntil: string; // ISO date the focus ends
  focusNote: string; // one line on why, for the editors
  focusMatch: string; // regex (case-insensitive) a story about the focus matches, e.g. "grand theft auto|\\bgta\\b"
  focusPlaylist: string; // a playlist every focus video joins while the focus runs, empty = none
  waveFrom: string; // ISO date a launch wave starts: extra Shorts on the focus, like a showcase sprint
  waveTo: string; // ISO date it ends (inclusive)
  whyEnabled: boolean; // the daily "Why" Short
  whyDays: string[];
  whySlot: string; // local "HH:MM"
  spareUploads: boolean; // spend the quota left before YouTube's daily reset on extra scheduled Shorts
  spareSlots: string[]; // local "HH:MM" publish times for those Shorts, the first free one is used
  evergreenApprovalMode: ApprovalMode;
  evergreenApprovalMinutes: number;
  evergreenMaxSeconds: number; // narration cap for the lane
    longformEnabled: boolean; // weekly 16:9 ranking video
  cutdownsEnabled: boolean; // Shorts cut from each long ranking
  cutdownSlot: string; // local publish time for them, one a day
  cutdownsPerLong: number;
  commentReplies: boolean; // answer good comments in a video's first hours
  openOnMotion: boolean; // Shorts open on the hook clip, not the hero still
  weeklyEnabled: boolean; // Release Radar, Free This Week and the Weekly Recap
  radarDays: string[];
  freeDays: string[];
  recapDays: string[];
  recapLong: boolean; // Friday's recap is a 6-10 minute long video instead of a Short
  achievementDays: string[];
  climbersDays: string[]; // the weekly Steam climbers Short
  dealsDays: string[]; // the Steam deals Short
  dealsSlot: string; // its own local slot, so it never takes a weekly format's
  weeklySlot: string;
  longformDays: string[];
  longformSlot: string;
  longformSkip: string[]; // ISO dates (London) with no factory-made long video, e.g. one uploaded by hand
  longformApprovalMode: ApprovalMode;
  longformApprovalMinutes: number;
  longformMaxSeconds: number;
  longformClipsPerEntry: number;
  docEnabled: boolean; // monthly franchise documentary (long-form lane)
  docDays: string[];
  docSlot: string;
  docWeeks: number[]; // weeks of the month it runs: 1 = the first such weekday
  docLeadMinutes: number; // how long before the slot production starts
  docMaxSeconds: number;
  docClipsPerChapter: number;
  crosspost: { facebook: boolean; instagram: boolean; tiktok: boolean; x: boolean }; // which platforms get every public Short
  crosspostDelays: { facebook: number; instagram: number; tiktok: number; x: number }; // minutes after the YouTube publish
  crosspostWindowHours: number; // how far back a Short is still worth posting
  /** TikTok gets only the day's strongest Shorts (by YouTube views per hour), this many a day; 0 = every Short. */
  tiktokDaily: number;
  /** Local hour (TIMEZONE) from which the day's TikTok picks are sent: 16 = US lunchtime. */
  tiktokFromHour: number;
  engageEnabled: boolean; // a daily community post on Facebook and Instagram
  engageSlot: string; // local time it goes out
  facebookPageId: string;
  facebookPageToken: string;
  instagramAccountId: string;
  instagramToken: string;
  tiktokClientKey: string;
  tiktokClientSecret: string;
  tiktokTokenPath: string;
  tiktokBrowser: boolean; // post publicly through the signed-in Chrome profile (off: drafts go to the owner's TikTok inbox)
  twitchClientId: string; // IGDB pictures for games Steam cannot supply
  twitchClientSecret: string;
  xKeys: { consumerKey: string; consumerSecret: string; token: string; tokenSecret: string };
  selectFromHourUtc: number;
  minGapHours: number;
  tickMinutes: number;
  maxStoryAgeHours: number;
  includeRumours: boolean;
  approvalMode: ApprovalMode;
  approvalTimeoutMinutes: number;
  publishWindowStartUtc: number;
  publishWindowEndUtc: number;
  visionQa: boolean;
  /** Python with faster-whisper (PC) or MLX Whisper (Mac) for the narration check; empty switches it off. */
  whisperPython: string;
  /** Where nightly encrypted restore points go: a folder synced off the PC (the owner's Google Drive). */
  backupDir: string;
  footage: boolean;
  maxClips: number;
  clipRanking: "llm" | "rule"; // how trailer moments are matched to narration lines
  officialTrailers: boolean; // games not on Steam: the publisher's own YouTube trailer
  ytdlpPath: string;
  footageLibrary: string; // the owner's own recordings (NVIDIA: Videos\\<Game>\\...); empty = off
  pexelsApiKey: string; // licensed stock for the real-world part of picture stories
  amazonUkTag: string; // Amazon Associates UK tracking ID
  amazonUsTag: string; // Amazon Associates US tracking ID, when there is one
  amazonMoreTags: { ca?: string; de?: string; fr?: string; it?: string; es?: string; au?: string }; // other national stores
  youtubeChannelId: string; // the only channel the factory may connect to
  oauthRedirectUri: string; // where Google returns after consent; this PC's own address works for the desktop OAuth client
  musicBed: boolean;
  dryRun: boolean;
  maxAttempts: number;
  remotionConcurrency: number;
  remotionGl: RemotionGl;
  browserExecutable: string;
}

export function loadConfig(): Config {
  const approvalMode = str("APPROVAL_MODE", "timeout") as ApprovalMode;
  if (!["manual", "timeout", "auto"].includes(approvalMode)) {
    throw new Error(`APPROVAL_MODE must be manual, timeout or auto, got "${approvalMode}"`);
  }
  if (!VOICE_PROVIDERS.includes(str("VOICE_PROVIDER", "auto") as VoiceProvider)) {
    throw new Error(`VOICE_PROVIDER must be one of ${VOICE_PROVIDERS.join(", ")}`);
  }
  const youtubePrivacy = str("YOUTUBE_PRIVACY", "public") as PrivacyStatus;
  if (!["public", "unlisted", "private"].includes(youtubePrivacy)) {
    throw new Error(`YOUTUBE_PRIVACY must be public, unlisted or private, got "${youtubePrivacy}"`);
  }
  const remotionGl = str("REMOTION_GL", "swangle") as RemotionGl;
  if (!REMOTION_GLS.includes(remotionGl)) throw new Error(`REMOTION_GL must be one of ${REMOTION_GLS.join(", ")}, got "${remotionGl}"`);
  const railwayDomain = str("RAILWAY_PUBLIC_DOMAIN");
  const cfg: Config = {
    port: int("PORT", 8080),
    publicUrl: str("PUBLIC_URL", railwayDomain ? `https://${railwayDomain}` : "http://localhost:8080").replace(/\/$/, ""),
    siteUrl: str("SITE_URL").replace(/\/$/, ""),
    dataDir: path.resolve(str("DATA_DIR", "./data")),
    databaseUrl: str("DATABASE_URL"),
    appSecret: str("APP_SECRET"),
    adminToken: str("ADMIN_TOKEN"),

    anthropicModel: str("CLAUDE_MODEL", "claude-opus-5-5"),
    claudeModelMid: str("CLAUDE_MODEL_MID", "claude-sonnet-5-5"),
    claudeModelLow: str("CLAUDE_MODEL_LOW", "claude-haiku-5-5"),
    voiceProvider: str("VOICE_PROVIDER", "auto") as VoiceProvider,
    localTtsUrl: str("LOCAL_TTS_URL", "http://127.0.0.1:8765").replace(/\/$/, ""),
    localVoiceId: str("LOCAL_TTS_VOICE_ID", "TX3LPaxmHKxFdv7VOQHJ"),
    localSpeakingRate: Number(str("LOCAL_TTS_SPEAKING_RATE", "1.0")),
    localTtsStart: str("LOCAL_TTS_START"),
    syntheticMedia: bool("SYNTHETIC_MEDIA_DISCLOSURE", true),
    elevenLabsApiKey: str("ELEVENLABS_API_KEY"),
    elevenLabsVoiceId: str("ELEVENLABS_VOICE_ID", "TX3LPaxmHKxFdv7VOQHJ"),
    elevenLabsModel: str("ELEVENLABS_MODEL", "eleven_multilingual_v2"),
    // "id:Name,id:Name,..."; names are for the Discord card and the analytics join.
    voicePool: str("ELEVENLABS_VOICE_POOL")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => {
        const [id, ...name] = v.split(":");
        return { id: id!.trim(), name: name.join(":").trim() || id!.trim() };
      }),
    voiceRotation: Math.max(1, int("VOICE_ROTATION", 2)),

    discordWebhookUrl: str("DISCORD_WEBHOOK_URL"),
    healthcheckPingUrl: str("HEALTHCHECK_PING_URL"),

    legacyTokenDir: str("PULSE_TOKEN_DIR"),
    googleClientId: str("GOOGLE_CLIENT_ID", str("YOUTUBE_CLIENT_ID")),
    googleClientSecret: str("GOOGLE_CLIENT_SECRET", str("YOUTUBE_CLIENT_SECRET")),
    youtubeRefreshToken: str("YOUTUBE_REFRESH_TOKEN"),
    youtubePrivacy,
    youtubeVetoMinutes: int("YOUTUBE_VETO_MINUTES", 0),

    dailyTarget: int("SHORTS_PER_DAY", int("DAILY_TARGET", 3)),
    timezone: str("TIMEZONE", "Europe/London"),
    newsSlots: str("NEWS_SLOTS", "13:00,17:00,22:00").split(",").map((t) => t.trim()).filter((t) => /^\d\d:\d\d$/.test(t)).sort(),
    slotLeadMinutes: int("SLOT_LEAD_MINUTES", 75),
    slotGraceMinutes: int("SLOT_GRACE_MINUTES", 30),
    maxProducing: int("MAX_PRODUCING", 2),
    minUploadGapMinutes: int("MIN_UPLOAD_GAP_MINUTES", 60),
    discoverMinutes: int("DISCOVER_MINUTES", 3),
    breakingEnabled: bool("BREAKING_ENABLED", true),
    breakingPerDay: int("BREAKING_PER_DAY", 2),
    breakingScoreMin: int("BREAKING_SCORE_MIN", 75),
    breakingMaxAgeMinutes: int("BREAKING_MAX_AGE_MINUTES", 90),
    breakingCooldownHours: int("BREAKING_COOLDOWN_HOURS", 2),
    sprintExtra: int("SPRINT_EXTRA", 3),
    sprintScoreMin: int("SPRINT_SCORE_MIN", 60),
    breakingApprovalMinutes: int("BREAKING_APPROVAL_MINUTES", 20),
    breakingWindow: str("BREAKING_WINDOW", "07:00-03:00"),
    quotaUnitsPerDay: int("QUOTA_UNITS_PER_DAY", 10000),
    uploadCallsPerDay: int("UPLOAD_CALLS_PER_DAY", 100),
    searchCallsPerDay: int("SEARCH_CALLS_PER_DAY", 100),
    evergreenEnabled: bool("EVERGREEN_ENABLED", true),
    evergreenDays: str("EVERGREEN_DAYS", "tue,sat").toLowerCase().split(",").map((d) => d.trim().slice(0, 3)).filter(Boolean),
    evergreenSlot: str("EVERGREEN_SLOT", "20:00"),
    focusTopic: str("FOCUS_TOPIC", ""),
    focusUntil: str("FOCUS_UNTIL", ""),
    focusNote: str("FOCUS_NOTE", ""),
    focusMatch: str("FOCUS_MATCH", ""),
    focusPlaylist: str("FOCUS_PLAYLIST", ""),
    waveFrom: str("LAUNCH_WAVE_FROM", ""),
    waveTo: str("LAUNCH_WAVE_TO", ""),
    whyEnabled: bool("WHY_ENABLED", true),
    whyDays: str("WHY_DAYS", "mon,tue,wed,thu,fri,sat,sun").toLowerCase().split(",").map((d) => d.trim().slice(0, 3)).filter(Boolean),
    whySlot: str("WHY_SLOT", "18:30"),
    // Off: with uploads on their own bucket of 100 a day there is no use-it-or-lose-it quota to spend.
    spareUploads: bool("SPARE_UPLOADS", false),
    spareSlots: str("SPARE_SLOTS", "19:00,15:00,11:00").split(",").map((x) => x.trim()).filter(Boolean),
    evergreenApprovalMode: str("EVERGREEN_APPROVAL_MODE", "manual") as ApprovalMode,
    evergreenApprovalMinutes: int("EVERGREEN_APPROVAL_MINUTES", 120),
    evergreenMaxSeconds: int("EVERGREEN_MAX_SECONDS", 95),
        longformEnabled: bool("LONGFORM_ENABLED", true),
    cutdownsEnabled: bool("CUTDOWNS_ENABLED", false), // on once a sandbox run has been checked
    cutdownSlot: str("CUTDOWN_SLOT", "15:30"),
    cutdownsPerLong: int("CUTDOWNS_PER_LONG", 3),
    commentReplies: bool("COMMENT_REPLIES", true),
    openOnMotion: bool("OPEN_ON_MOTION", true),
    weeklyEnabled: bool("WEEKLY_ENABLED", true),
    radarDays: str("RADAR_DAYS", "mon").toLowerCase().split(",").map((d) => d.trim().slice(0, 3)).filter(Boolean),
    freeDays: str("FREE_DAYS", "thu").toLowerCase().split(",").map((d) => d.trim().slice(0, 3)).filter(Boolean),
    recapLong: bool("RECAP_LONG", false), // on once a sandbox run has been checked
    recapDays: str("RECAP_DAYS", "fri").toLowerCase().split(",").map((d) => d.trim().slice(0, 3)).filter(Boolean),
    climbersDays: str("CLIMBERS_DAYS", "sun").toLowerCase().split(",").map((d) => d.trim().slice(0, 3)).filter(Boolean),
    dealsDays: str("DEALS_DAYS", "").toLowerCase().split(",").map((d) => d.trim().slice(0, 3)).filter(Boolean),
    dealsSlot: str("DEALS_SLOT", "16:30"),
    achievementDays: str("ACHIEVEMENT_DAYS", "wed").toLowerCase().split(",").map((d) => d.trim().slice(0, 3)).filter(Boolean),
    weeklySlot: str("WEEKLY_SLOT", "20:00"),
    longformDays: str("LONGFORM_DAYS", "sun").toLowerCase().split(",").map((d) => d.trim().slice(0, 3)).filter(Boolean),
    longformSlot: str("LONGFORM_SLOT", "19:00"),
    longformSkip: str("LONGFORM_SKIP", "").split(",").map((d) => d.trim()).filter(Boolean),
    longformApprovalMode: str("LONGFORM_APPROVAL_MODE", "auto") as ApprovalMode,
    longformApprovalMinutes: int("LONGFORM_APPROVAL_MINUTES", 180),
    longformMaxSeconds: int("LONGFORM_MAX_SECONDS", 1560), // 3,200 words at a natural pace, with room
    longformClipsPerEntry: int("LONGFORM_CLIPS_PER_ENTRY", 2),
    docEnabled: bool("DOC_ENABLED", true),
    docDays: str("DOC_DAYS", "sat").toLowerCase().split(",").map((d) => d.trim().slice(0, 3)).filter(Boolean),
    docSlot: str("DOC_SLOT", "19:00"),
    docWeeks: str("DOC_WEEKS", "1").split(",").map((w) => Number(w.trim())).filter((w) => w >= 1 && w <= 5),
    docLeadMinutes: int("DOC_LEAD_MINUTES", 600),
    docMaxSeconds: int("DOC_MAX_SECONDS", 3000),
    docClipsPerChapter: int("DOC_CLIPS_PER_CHAPTER", 4),
    crosspost: {
      facebook: bool("CROSSPOST_FACEBOOK", true),
      instagram: bool("CROSSPOST_INSTAGRAM", true),
      tiktok: bool("CROSSPOST_TIKTOK", true),
      x: bool("CROSSPOST_X", true),
    },
    crosspostDelays: {
      x: int("CROSSPOST_X_DELAY", 5),
      facebook: int("CROSSPOST_FACEBOOK_DELAY", 30),
      instagram: int("CROSSPOST_INSTAGRAM_DELAY", 60),
      tiktok: int("CROSSPOST_TIKTOK_DELAY", 90),
    },
    crosspostWindowHours: int("CROSSPOST_WINDOW_HOURS", 36),
    tiktokDaily: int("TIKTOK_DAILY", 0),
    tiktokFromHour: int("TIKTOK_FROM_HOUR", 16),
    engageEnabled: bool("ENGAGE_ENABLED", true),
    engageSlot: str("ENGAGE_SLOT", "15:00"),
    facebookPageId: str("FACEBOOK_PAGE_ID"),
    facebookPageToken: str("FACEBOOK_PAGE_TOKEN"),
    instagramAccountId: str("INSTAGRAM_BUSINESS_ACCOUNT_ID"),
    instagramToken: str("INSTAGRAM_ACCESS_TOKEN"),
    tiktokClientKey: str("TIKTOK_CLIENT_KEY"),
    tiktokClientSecret: str("TIKTOK_CLIENT_SECRET"),
    tiktokTokenPath: str("TIKTOK_TOKEN_PATH"),
    // Off by default: every Short posted through the automated browser from 19 Oct got 0 views (no For You
    // distribution), while drafts the owner posts from the app reached 939 views a week.
    tiktokBrowser: bool("TIKTOK_BROWSER", false),
    twitchClientId: str("TWITCH_CLIENT_ID"),
    twitchClientSecret: str("TWITCH_CLIENT_SECRET"),
    xKeys: {
      consumerKey: str("TWITTER_API_KEY"),
      consumerSecret: str("TWITTER_API_SECRET"),
      token: str("TWITTER_ACCESS_TOKEN"),
      tokenSecret: str("TWITTER_ACCESS_SECRET"),
    },
    selectFromHourUtc: int("SELECT_FROM_HOUR_UTC", 9),
    minGapHours: int("MIN_GAP_HOURS", 4),
    tickMinutes: int("TICK_MINUTES", 10),
    maxStoryAgeHours: int("MAX_STORY_AGE_HOURS", 24),
    includeRumours: bool("INCLUDE_RUMOURS", false),
    approvalMode,
    approvalTimeoutMinutes: int("APPROVAL_TIMEOUT_MINUTES", 60),
    publishWindowStartUtc: int("PUBLISH_WINDOW_START_UTC", 7),
    publishWindowEndUtc: int("PUBLISH_WINDOW_END_UTC", 22),
    visionQa: bool("VISION_QA", true),
    whisperPython: str("WHISPER_PYTHON", defaultWhisperPython()),
    backupDir: str("BACKUP_DIR", "G:/My Drive/Pulse backups"),
    footage: bool("TRAILER_FOOTAGE", true),
    maxClips: int("MAX_TRAILER_CLIPS", 4),
    clipRanking: (str("CLIP_RANKING", "llm") === "rule" ? "rule" : "llm") as "llm" | "rule",
    officialTrailers: bool("OFFICIAL_TRAILERS", true),
    ytdlpPath: str("YTDLP_PATH", "yt-dlp"),
    footageLibrary: str("FOOTAGE_LIBRARY", path.join(process.env.USERPROFILE ?? "", "Videos")),
    pexelsApiKey: str("PEXELS_API_KEY"),
    amazonUkTag: str("AMAZON_AFFILIATE_TAG"),
    amazonUsTag: str("AMAZON_US_TAG"),
    amazonMoreTags: {
      ca: str("AMAZON_CA_TAG") || undefined,
      de: str("AMAZON_DE_TAG") || undefined,
      fr: str("AMAZON_FR_TAG") || undefined,
      it: str("AMAZON_IT_TAG") || undefined,
      es: str("AMAZON_ES_TAG") || undefined,
      au: str("AMAZON_AU_TAG") || undefined,
    },
    oauthRedirectUri: str("OAUTH_REDIRECT_URI", "http://localhost:8080/oauth/callback"),
    youtubeChannelId: str("YOUTUBE_CHANNEL_ID", "UCvgNDjtTezrpxL8oUe6mYwA"),
    musicBed: bool("MUSIC_BED", true),
    dryRun: bool("DRY_RUN", false),
    maxAttempts: int("MAX_ATTEMPTS", 3),
    remotionConcurrency: int("REMOTION_CONCURRENCY", 2),
    remotionGl,
    browserExecutable: str("REMOTION_BROWSER_EXECUTABLE"),
  };
  if (cfg.legacyTokenDir) adoptLegacyYouTubeTokens(cfg);
  return cfg;
}

/**
 * Reuses the YouTube login the Codex pipeline already has on this PC
 * (tokens/youtube_credentials.json + tokens/youtube_token.json) so the
 * channel never needs re-connecting. Explicit env values win.
 */
export function adoptLegacyYouTubeTokens(cfg: Config): void {
  const read = (f: string): any => {
    try {
      return JSON.parse(fs.readFileSync(path.join(cfg.legacyTokenDir, f), "utf8"));
    } catch {
      return undefined;
    }
  };
  const creds = read("youtube_credentials.json");
  const client = creds?.installed ?? creds?.web;
  if (client && !cfg.googleClientId) {
    cfg.googleClientId = client.client_id ?? "";
    cfg.googleClientSecret = client.client_secret ?? "";
  }
  const token = read("youtube_token.json");
  const refresh = token?.refresh_token ?? token?.credentials?.refresh_token ?? token?.tokens?.refresh_token;
  if (refresh && !cfg.youtubeRefreshToken) cfg.youtubeRefreshToken = refresh;
}

/** Safe-to-log view: booleans for secrets, values for everything else. */
export function redactedConfig(c: Config): Record<string, unknown> {
  return {
    publicUrl: c.publicUrl,
    dataDir: c.dataDir,
    database: Boolean(c.databaseUrl),
    anthropicModel: c.anthropicModel,
    anthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    voiceProvider: c.voiceProvider,
    localTtsUrl: c.localTtsUrl,
    elevenLabsFallback: Boolean(c.elevenLabsApiKey),
    discord: Boolean(c.discordWebhookUrl),
    youtubeOAuthClient: Boolean(c.googleClientId && c.googleClientSecret),
    youtubePrivacy: c.youtubePrivacy,
    dailyTarget: c.dailyTarget,
    newsSlots: c.newsSlots.join(","),
    breaking: c.breakingEnabled ? `${c.breakingPerDay}/day, score>=${c.breakingScoreMin}, <=${c.breakingMaxAgeMinutes}min old` : "off",
    approvalMode: c.approvalMode,
    approvalTimeoutMinutes: c.approvalTimeoutMinutes,
    includeRumours: c.includeRumours,
    visionQa: c.visionQa,
    dryRun: c.dryRun,
  };
}

/** The Python that has Whisper on this machine: the PC's speech runtime or the Mac's MLX one. */
function defaultWhisperPython(): string {
  const candidates = [
    "D:/pulse-tools/pulse-python-runtime/Scripts/python.exe",
    `${process.env.HOME ?? ""}/PulseFactory/asr/bin/python`,
  ];
  return candidates.find((p) => p && fs.existsSync(p)) ?? "";
}

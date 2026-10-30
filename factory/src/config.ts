// Every runtime knob lives here and is read from the environment once.
// Nothing secret is ever logged; see redactedConfig().

import fs from "node:fs";
import os from "node:os";
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
  if (!Number.isFinite(n))
    throw new Error(`${name} must be an integer, got "${raw}"`);
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
export type VoiceProvider =
  | "local"
  | "elevenlabs"
  | "auto"
  | "elevenlabs-first";
export const VOICE_PROVIDERS: VoiceProvider[] = [
  "local",
  "elevenlabs",
  "auto",
  "elevenlabs-first",
];
// Chromium GL backend for Remotion. "angle" uses the GPU (5x faster on the
// production PC, pixel-identical output); "swangle" is the software fallback.
export type RemotionGl =
  | "swangle"
  | "angle"
  | "egl"
  | "swiftshader"
  | "vulkan"
  | "angle-egl";
const REMOTION_GLS: RemotionGl[] = [
  "swangle",
  "angle",
  "egl",
  "swiftshader",
  "vulkan",
  "angle-egl",
];

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

  discordTiktokWebhookUrl: string; // #tiktok-posts: the TikTok draft links on their own
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
  /** Search questions with weak answers on YouTube (search_gaps.md), shown to the topic pickers; empty = none. */
  searchGapsFile: string;
  calendarFile: string; // dated angles the editors see as "planned for today" (src/calendar.ts); empty = none
  /** The desk experiment: a second presenter asks the viewer's question before the take, on a share of news Shorts. */
  deskVoiceId: string; // ElevenLabs voice of the desk partner; empty = off
  deskVoiceName: string;
  deskShare: number; // 0-1: the share of eligible Shorts that get the desk question
  /** The narrator test: a share of news Shorts narrated by another ElevenLabs voice. */
  narratorTestVoiceId: string; // empty = off
  narratorTestVoiceName: string;
  narratorTestShare: number;
  /** The new-look test: a share of Shorts get the editor's dressing (cut accents, punch-ins, period looks). */
  shortSuiteShare: number;
  /** Pip the mascot: a share of Shorts carry the code-drawn amber mascot (src/render/components/Pip.tsx). */
  mascotShare: number;
  /** The UK day the factory first judges its experiments (src/experiments.ts), as YYYY-MM-DD. */
  experimentVerdictDate: string;
  narratorName: string; // the usual narrator's name, for the Discord card and the lessons
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
  /** The owner's own recordings, cut into an inbox by the Windows tasks in C:\Claude	inotv-vods. */
  gameplayEnabled: boolean;
  gameplayRoot: string; // holds inbox/ (written by the finder) and published/ (read by Leonida Intel)
  gameplayExperiments: string; // the numbered test list the reviewer matches clips against
  gameplaySlots: string[]; // local publish times, at most one gameplay Short each
  gameplayReviewsPerDay: number; // clips heard and looked at a day (each costs a vision call)
  gameplayMinScore: number; // the reviewer's 1-10 score a clip needs to reach the owner
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
  /** ElevenLabs: the plan's monthly credits (Pro: 500,000); unused credits above two months' worth are lost at the reset. */
  elevenLabsMonthlyCredits: number;
  elevenLabsReserve: number; // credits never spent, a cushion against overage
  surplusDocDays: string[]; // extra documentary days while credits would otherwise be lost
  surplusDocChars: number; // what one documentary costs in credits, roughly
  bankWindow: string; // local "HH:MM-HH:MM" when a banked documentary may start (it holds the factory for hours)
  docDays: string[];
  docSlot: string;
  docWeeks: number[]; // weeks of the month it runs: 1 = the first such weekday
  docLeadMinutes: number; // how long before the slot production starts
  /** Long videos (rankings, documentaries) start this long before their slot: script and voice the day before,
   * so the owner can record what the shot list wants and the render finds a gap between Shorts (28 Oct 2026). */
  longLeadMinutes: number;
  /** Narration slower than this is sped up (by up to 25%, pitch kept): MIN_WORDS_PER_MINUTE, 0 turns it off. */
  minWordsPerMinute: number;
  docMaxSeconds: number;
  docClipsPerChapter: number;
  crosspost: {
    facebook: boolean;
    instagram: boolean;
    tiktok: boolean;
    x: boolean;
    threads: boolean;
    bluesky: boolean;
  }; // which platforms get every public Short
  crosspostDelays: {
    facebook: number;
    instagram: number;
    tiktok: number;
    x: number;
    threads: number;
    bluesky: number;
  }; // minutes after the YouTube publish
  /** Threads login saved by /connect?account=threads ({ userId, token, refreshedAt }). */
  threadsLoginPath: string;
  threadsAppId: string;
  threadsAppSecret: string;
  /** Bluesky handle and app password saved by /connect?account=bluesky. */
  blueskyLoginPath: string;
  crosspostWindowHours: number; // how far back a Short is still worth posting
  /** TikTok gets only the day's strongest Shorts (by YouTube views per hour), this many a day; 0 = every Short. */
  tiktokDaily: number;
  /** Local hour (TIMEZONE) from which the day's TikTok picks are sent: 16 = US lunchtime. */
  tiktokFromHour: number;
  engageEnabled: boolean; // a daily community post on Facebook and Instagram
  /** The daily question picture on Instagram as well (ENGAGE_INSTAGRAM): off, 9 posts drew 0 likes by 29 Oct 2026. */
  engageInstagram: boolean;
  engageSlot: string; // local time it goes out
  /** The Meta login saved by /connect?account=meta; when present its page token wins over the .env tokens. */
  metaLoginPath: string;
  /** A Facebook Login for Business configuration id (FACEBOOK_LOGIN_CONFIG_ID), when the app uses one instead of scopes. */
  facebookLoginConfigId: string;
  /** Permissions the saved Meta login was granted (set from the login file; empty until the owner connects). */
  metaGranted?: string[];
  /** The YouTube link goes in the Facebook reel's first comment, not its caption, when the login may comment as the page. */
  facebookLinkComment: boolean;
  /** The Meta app the connect page signs in with (FACEBOOK_APP_ID, FACEBOOK_APP_SECRET). */
  facebookAppId: string;
  facebookAppSecret: string;
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
  xKeys: {
    consumerKey: string;
    consumerSecret: string;
    token: string;
    tokenSecret: string;
  };
  selectFromHourUtc: number;
  minGapHours: number;
  tickMinutes: number;
  maxStoryAgeHours: number;
  includeRumours: boolean;
  rumoursPerDay: number; // rumour Shorts a day at most, so the channel stays news first
  /** A Short taking off: this many times the usual views an hour in its first two days (src/hits.ts). */
  hitMultiple: number;
  /** ...and never fewer views an hour than this. */
  hitMinPerHour: number;
  /** How long the editors lean towards a hit's game. */
  hitHours: number;
  approvalMode: ApprovalMode;
  approvalTimeoutMinutes: number;
  publishWindowStartUtc: number;
  publishWindowEndUtc: number;
  visionQa: boolean;
  /** Languages each video's title and description are also set in on YouTube (empty switches it off). */
  localizeLanguages: string[];
  /** Python with faster-whisper (PC) or MLX Whisper (Mac) for the narration check; empty switches it off. */
  whisperPython: string;
  /** Python for the depth layers (src/render/parallax.py): its own environment, so OpenCV and Pillow stay
   * out of the speech recogniser's locked runtime (adding them there broke PulseGaming-ASR on 27 Oct 2026). */
  parallaxPython: string;
  /** Where nightly encrypted restore points go: a folder synced off the PC (the owner's Google Drive). */
  backupDir: string;
  footage: boolean;
  maxClips: number;
  clipRanking: "llm" | "rule"; // how trailer moments are matched to narration lines
  officialTrailers: boolean; // games not on Steam: the publisher's own YouTube trailer
  ytdlpPath: string;
  /** Games the owner plays (and records): long videos about them send them a "record these moments" list. */
  ownerGames: string[];
  captureChecklist: boolean; // send that list on Discord when a long video or documentary covers one of their games
  footageLibrary: string; // the owner's own recordings (NVIDIA: Videos\\<Game>\\...); empty = off
  pexelsApiKey: string; // licensed stock for the real-world part of picture stories
  amazonUkTag: string; // Amazon Associates UK tracking ID
  amazonUsTag: string; // Amazon Associates US tracking ID, when there is one
  amazonMoreTags: {
    ca?: string;
    de?: string;
    fr?: string;
    it?: string;
    es?: string;
    au?: string;
  }; // other national stores
  youtubeChannelId: string; // the only channel the factory may connect to
  /** The twin channel: every Short re-voiced in this language and uploaded to a second channel; "" = off. */
  twinLanguage: string;
  twinChannelId: string; // the second channel's id, checked when it is connected (/connect?account=es)
  twinDelayMinutes: number; // the twin follows the original by this long
  oauthRedirectUri: string; // where Google returns after consent; this PC's own address works for the desktop OAuth client
  musicBed: boolean;
  /** 2.5D depth layers for long videos' stills (src/render/parallax.ts). */
  parallax: boolean;
  /** Zoom-to-the-detail annotations on long videos' stills (src/assets/annotate.ts). */
  annotate: boolean;
  /** Drawn concept sketches for documentary lines nothing filmed can show (src/assets/illustrate.ts); off by default. */
  illustrate: boolean;
  /** The ComfyUI server that draws them (this PC's FLUX.1 dev). */
  illustrateUrl: string;
  /** At most this many sketches per documentary, so a run cannot take all night. */
  illustrateMax: number;
  /** Each sketch's time to queue, draw and download; past it the job is dropped. */
  illustrateTimeoutSeconds: number;
  /** A placeholder PNG instead of the model: dry runs and the trial without the GPU. */
  illustrateStub: boolean;
  dryRun: boolean;
  maxAttempts: number;
  remotionConcurrency: number;
  remotionGl: RemotionGl;
  browserExecutable: string;
}

export function loadConfig(): Config {
  const approvalMode = str("APPROVAL_MODE", "timeout") as ApprovalMode;
  if (!["manual", "timeout", "auto"].includes(approvalMode)) {
    throw new Error(
      `APPROVAL_MODE must be manual, timeout or auto, got "${approvalMode}"`,
    );
  }
  if (
    !VOICE_PROVIDERS.includes(str("VOICE_PROVIDER", "auto") as VoiceProvider)
  ) {
    throw new Error(
      `VOICE_PROVIDER must be one of ${VOICE_PROVIDERS.join(", ")}`,
    );
  }
  const youtubePrivacy = str("YOUTUBE_PRIVACY", "public") as PrivacyStatus;
  if (!["public", "unlisted", "private"].includes(youtubePrivacy)) {
    throw new Error(
      `YOUTUBE_PRIVACY must be public, unlisted or private, got "${youtubePrivacy}"`,
    );
  }
  const remotionGl = str("REMOTION_GL", "swangle") as RemotionGl;
  if (!REMOTION_GLS.includes(remotionGl))
    throw new Error(
      `REMOTION_GL must be one of ${REMOTION_GLS.join(", ")}, got "${remotionGl}"`,
    );
  const railwayDomain = str("RAILWAY_PUBLIC_DOMAIN");
  // Logins saved by the factory's own connect pages sit beside the TikTok token, outside the repo.
  const tokenDir = str("TIKTOK_TOKEN_PATH")
    ? path.dirname(str("TIKTOK_TOKEN_PATH"))
    : path.resolve(str("DATA_DIR", "./data"), "tokens");
  const cfg: Config = {
    port: int("PORT", 8080),
    publicUrl: str(
      "PUBLIC_URL",
      railwayDomain ? `https://${railwayDomain}` : "http://localhost:8080",
    ).replace(/\/$/, ""),
    siteUrl: str("SITE_URL").replace(/\/$/, ""),
    dataDir: path.resolve(str("DATA_DIR", "./data")),
    databaseUrl: str("DATABASE_URL"),
    appSecret: str("APP_SECRET"),
    adminToken: str("ADMIN_TOKEN"),

    anthropicModel: str("CLAUDE_MODEL", "claude-opus-5-5"),
    claudeModelMid: str("CLAUDE_MODEL_MID", "claude-sonnet-5-5"),
    claudeModelLow: str("CLAUDE_MODEL_LOW", "claude-haiku-5-5"),
    voiceProvider: str("VOICE_PROVIDER", "auto") as VoiceProvider,
    localTtsUrl: str("LOCAL_TTS_URL", "http://127.0.0.1:8765").replace(
      /\/$/,
      "",
    ),
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
    discordTiktokWebhookUrl: str("DISCORD_TIKTOK_WEBHOOK_URL"),
    healthcheckPingUrl: str("HEALTHCHECK_PING_URL"),

    legacyTokenDir: str("PULSE_TOKEN_DIR"),
    googleClientId: str("GOOGLE_CLIENT_ID", str("YOUTUBE_CLIENT_ID")),
    googleClientSecret: str(
      "GOOGLE_CLIENT_SECRET",
      str("YOUTUBE_CLIENT_SECRET"),
    ),
    youtubeRefreshToken: str("YOUTUBE_REFRESH_TOKEN"),
    youtubePrivacy,
    youtubeVetoMinutes: int("YOUTUBE_VETO_MINUTES", 0),

    dailyTarget: int("SHORTS_PER_DAY", int("DAILY_TARGET", 3)),
    timezone: str("TIMEZONE", "Europe/London"),
    newsSlots: str("NEWS_SLOTS", "13:00,17:00,22:00")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => /^\d\d:\d\d$/.test(t))
      .sort(),
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
    evergreenDays: str("EVERGREEN_DAYS", "tue,sat")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    evergreenSlot: str("EVERGREEN_SLOT", "20:00"),
    focusTopic: str("FOCUS_TOPIC", ""),
    focusUntil: str("FOCUS_UNTIL", ""),
    focusNote: str("FOCUS_NOTE", ""),
    calendarFile: str("CALENDAR_FILE", "calendar.md"),
    searchGapsFile: str("SEARCH_GAPS_FILE", "search_gaps.md"),
    deskVoiceId: str("DESK_VOICE_ID", ""),
    deskVoiceName: str("DESK_VOICE_NAME", "Alice"),
    deskShare: Math.max(0, Math.min(1, Number(str("DESK_SHARE", "0.5")))),
    narratorTestVoiceId: str("NARRATOR_TEST_VOICE_ID", ""),
    narratorTestVoiceName: str("NARRATOR_TEST_VOICE_NAME", "Alice"),
    narratorTestShare: Math.max(
      0,
      Math.min(1, Number(str("NARRATOR_TEST_SHARE", "0.5"))),
    ),
    shortSuiteShare: Math.max(
      0,
      Math.min(1, Number(str("SHORT_SUITE_SHARE", "0.5"))),
    ),
    mascotShare: Math.max(0, Math.min(1, Number(str("MASCOT_SHARE", "0")))),
    experimentVerdictDate: str("EXPERIMENT_VERDICT_DATE", "2026-11-08"),
    narratorName: str("NARRATOR_NAME", "Liam"),
    focusMatch: str("FOCUS_MATCH", ""),
    focusPlaylist: str("FOCUS_PLAYLIST", ""),
    waveFrom: str("LAUNCH_WAVE_FROM", ""),
    waveTo: str("LAUNCH_WAVE_TO", ""),
    whyEnabled: bool("WHY_ENABLED", true),
    whyDays: str("WHY_DAYS", "mon,tue,wed,thu,fri,sat,sun")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    whySlot: str("WHY_SLOT", "18:30"),
    // Off: with uploads on their own bucket of 100 a day there is no use-it-or-lose-it quota to spend.
    spareUploads: bool("SPARE_UPLOADS", false),
    spareSlots: str("SPARE_SLOTS", "19:00,15:00,11:00")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    evergreenApprovalMode: str(
      "EVERGREEN_APPROVAL_MODE",
      "manual",
    ) as ApprovalMode,
    evergreenApprovalMinutes: int("EVERGREEN_APPROVAL_MINUTES", 120),
    evergreenMaxSeconds: int("EVERGREEN_MAX_SECONDS", 95),
    longformEnabled: bool("LONGFORM_ENABLED", true),
    cutdownsEnabled: bool("CUTDOWNS_ENABLED", false), // on once a sandbox run has been checked
    cutdownSlot: str("CUTDOWN_SLOT", "15:30"),
    cutdownsPerLong: int("CUTDOWNS_PER_LONG", 3),
    gameplayEnabled: bool("GAMEPLAY_ENABLED", true),
    gameplayRoot: str(
      "GAMEPLAY_ROOT",
      path.join(os.homedir(), "Videos", "Pulse Gameplay"),
    ),
    gameplayExperiments: str(
      "GAMEPLAY_EXPERIMENTS",
      path.join(
        os.homedir(),
        "gaming-studio",
        "pulse-gaming",
        "docs",
        "GTA6_EXPERIMENT_SHORTS.md",
      ),
    ),
    // US evening (16:00 and 18:30 Eastern), clear of the news, deals, evergreen and long-form slots.
    gameplaySlots: str("GAMEPLAY_SLOTS", "21:00,23:30")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => /^\d\d:\d\d$/.test(t))
      .sort(),
    gameplayReviewsPerDay: int("GAMEPLAY_REVIEWS_PER_DAY", 30),
    gameplayMinScore: int("GAMEPLAY_MIN_SCORE", 7),
    commentReplies: bool("COMMENT_REPLIES", true),
    openOnMotion: bool("OPEN_ON_MOTION", true),
    weeklyEnabled: bool("WEEKLY_ENABLED", true),
    radarDays: str("RADAR_DAYS", "mon")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    freeDays: str("FREE_DAYS", "thu")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    recapLong: bool("RECAP_LONG", false), // on once a sandbox run has been checked
    recapDays: str("RECAP_DAYS", "fri")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    climbersDays: str("CLIMBERS_DAYS", "sun")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    dealsDays: str("DEALS_DAYS", "")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    dealsSlot: str("DEALS_SLOT", "16:30"),
    achievementDays: str("ACHIEVEMENT_DAYS", "wed")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    weeklySlot: str("WEEKLY_SLOT", "20:00"),
    longformDays: str("LONGFORM_DAYS", "sun")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    longformSlot: str("LONGFORM_SLOT", "19:00"),
    longformSkip: str("LONGFORM_SKIP", "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
    longformApprovalMode: str("LONGFORM_APPROVAL_MODE", "auto") as ApprovalMode,
    longformApprovalMinutes: int("LONGFORM_APPROVAL_MINUTES", 180),
    longformMaxSeconds: int("LONGFORM_MAX_SECONDS", 1560), // 3,200 words at a natural pace, with room
    longformClipsPerEntry: int("LONGFORM_CLIPS_PER_ENTRY", 2),
    docEnabled: bool("DOC_ENABLED", true),
    elevenLabsMonthlyCredits: int("ELEVENLABS_MONTHLY_CREDITS", 500_000),
    elevenLabsReserve: int("ELEVENLABS_RESERVE", 10_000),
    surplusDocDays: str("SURPLUS_DOC_DAYS", "tue,thu,sat")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    surplusDocChars: int("SURPLUS_DOC_CHARS", 35_000),
    bankWindow: str("BANK_WINDOW", "23:45-03:00"),
    docDays: str("DOC_DAYS", "sat")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    docSlot: str("DOC_SLOT", "19:00"),
    docWeeks: str("DOC_WEEKS", "1")
      .split(",")
      .map((w) => Number(w.trim()))
      .filter((w) => w >= 1 && w <= 5),
    docLeadMinutes: int("DOC_LEAD_MINUTES", 600),
    longLeadMinutes: int("LONG_LEAD_MINUTES", 30 * 60),
    minWordsPerMinute: int("MIN_WORDS_PER_MINUTE", 145),
    docMaxSeconds: int("DOC_MAX_SECONDS", 3000),
    docClipsPerChapter: int("DOC_CLIPS_PER_CHAPTER", 4),
    crosspost: {
      facebook: bool("CROSSPOST_FACEBOOK", true),
      instagram: bool("CROSSPOST_INSTAGRAM", true),
      tiktok: bool("CROSSPOST_TIKTOK", true),
      x: bool("CROSSPOST_X", true),
      threads: bool("CROSSPOST_THREADS", true),
      bluesky: bool("CROSSPOST_BLUESKY", true),
    },
    crosspostDelays: {
      x: int("CROSSPOST_X_DELAY", 5),
      facebook: int("CROSSPOST_FACEBOOK_DELAY", 30),
      instagram: int("CROSSPOST_INSTAGRAM_DELAY", 60),
      tiktok: int("CROSSPOST_TIKTOK_DELAY", 90),
      threads: int("CROSSPOST_THREADS_DELAY", 45),
      bluesky: int("CROSSPOST_BLUESKY_DELAY", 20),
    },
    threadsLoginPath: str(
      "THREADS_LOGIN_PATH",
      path.join(tokenDir, "threads.json"),
    ),
    threadsAppId: str("THREADS_APP_ID"),
    threadsAppSecret: str("THREADS_APP_SECRET"),
    blueskyLoginPath: str(
      "BLUESKY_LOGIN_PATH",
      path.join(tokenDir, "bluesky.json"),
    ),
    crosspostWindowHours: int("CROSSPOST_WINDOW_HOURS", 36),
    tiktokDaily: int("TIKTOK_DAILY", 0),
    tiktokFromHour: int("TIKTOK_FROM_HOUR", 16),
    engageEnabled: bool("ENGAGE_ENABLED", true),
    engageInstagram: bool("ENGAGE_INSTAGRAM", false),
    engageSlot: str("ENGAGE_SLOT", "15:00"),
    metaLoginPath: str("META_LOGIN_PATH", path.join(tokenDir, "meta.json")),
    facebookLoginConfigId: str("FACEBOOK_LOGIN_CONFIG_ID"),
    facebookLinkComment: bool("FACEBOOK_LINK_COMMENT", true),
    facebookAppId: str("FACEBOOK_APP_ID"),
    facebookAppSecret: str("FACEBOOK_APP_SECRET"),
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
    rumoursPerDay: int("RUMOURS_PER_DAY", 1),
    hitMultiple: Number(str("HIT_MULTIPLE", "6")) || 6,
    hitMinPerHour: int("HIT_MIN_PER_HOUR", 40),
    hitHours: int("HIT_HOURS", 72),
    approvalMode,
    approvalTimeoutMinutes: int("APPROVAL_TIMEOUT_MINUTES", 60),
    publishWindowStartUtc: int("PUBLISH_WINDOW_START_UTC", 7),
    publishWindowEndUtc: int("PUBLISH_WINDOW_END_UTC", 22),
    visionQa: bool("VISION_QA", true),
    localizeLanguages: str("LOCALIZE_LANGUAGES", "es,pt,de,fr,ja")
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean),
    whisperPython: str("WHISPER_PYTHON", defaultWhisperPython()),
    parallaxPython: str("PARALLAX_PYTHON", defaultParallaxPython()),
    backupDir: str("BACKUP_DIR", "G:/My Drive/Pulse backups"),
    footage: bool("TRAILER_FOOTAGE", true),
    maxClips: int("MAX_TRAILER_CLIPS", 8), // enough for the hook, four beats, the take and the loop
    clipRanking: (str("CLIP_RANKING", "llm") === "rule" ? "rule" : "llm") as
      | "llm"
      | "rule",
    officialTrailers: bool("OFFICIAL_TRAILERS", true),
    ytdlpPath: str("YTDLP_PATH", "yt-dlp"),
    ownerGames: str("OWNER_GAMES", "Grand Theft Auto V, Grand Theft Auto VI")
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean),
    captureChecklist: bool("CAPTURE_CHECKLIST", true),
    footageLibrary: str(
      "FOOTAGE_LIBRARY",
      path.join(process.env.USERPROFILE ?? "", "Videos"),
    ),
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
    oauthRedirectUri: str(
      "OAUTH_REDIRECT_URI",
      "http://localhost:8080/oauth/callback",
    ),
    youtubeChannelId: str("YOUTUBE_CHANNEL_ID", "UCvgNDjtTezrpxL8oUe6mYwA"),
    twinLanguage: str("TWIN_LANGUAGE", "").toLowerCase().slice(0, 2),
    twinChannelId: str("TWIN_YOUTUBE_CHANNEL_ID", ""),
    twinDelayMinutes: int("TWIN_DELAY_MINUTES", 30),
    musicBed: bool("MUSIC_BED", true),
    parallax: bool("PARALLAX", true),
    annotate: bool("ANNOTATE", true),
    illustrate: bool("ILLUSTRATE_ENABLED", false),
    illustrateUrl: str("ILLUSTRATE_URL", "http://127.0.0.1:8188"),
    illustrateMax: int("ILLUSTRATE_MAX", 24),
    illustrateTimeoutSeconds: int("ILLUSTRATE_TIMEOUT_SECONDS", 180),
    illustrateStub: bool("ILLUSTRATE_STUB", false),
    dryRun: bool("DRY_RUN", false),
    maxAttempts: int("MAX_ATTEMPTS", 3),
    remotionConcurrency: int("REMOTION_CONCURRENCY", 2),
    remotionGl,
    browserExecutable: str("REMOTION_BROWSER_EXECUTABLE"),
  };
  if (cfg.legacyTokenDir) adoptLegacyYouTubeTokens(cfg);
  applyMetaLogin(cfg);
  return cfg;
}

/** The Meta login saved by /connect?account=meta: a never-expiring page token and the accounts it reaches. */
export interface MetaLogin {
  pageId: string;
  pageName?: string;
  pageToken: string;
  instagramAccountId?: string;
  granted: string[];
  declined: string[];
  savedAt: string;
}

export function readMetaLogin(file: string): MetaLogin | undefined {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as MetaLogin;
    return j?.pageToken && j?.pageId ? j : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Puts the saved Meta login in place of the .env tokens, everywhere the factory reads them (crossposting,
 * the community posts, the numbers poller). A page token reaches the page's Instagram account as well.
 * Called at start-up and again by the connect page, so a new login works without a restart.
 */
export function applyMetaLogin(
  cfg: Config,
  login: MetaLogin | undefined = cfg.metaLoginPath
    ? readMetaLogin(cfg.metaLoginPath)
    : undefined,
): boolean {
  if (!login) return false;
  cfg.facebookPageId = login.pageId;
  cfg.facebookPageToken = login.pageToken;
  cfg.instagramToken = login.pageToken;
  if (login.instagramAccountId)
    cfg.instagramAccountId = login.instagramAccountId;
  cfg.metaGranted = login.granted ?? [];
  return true;
}

/**
 * Reuses the YouTube login the Codex pipeline already has on this PC
 * (tokens/youtube_credentials.json + tokens/youtube_token.json) so the
 * channel never needs re-connecting. Explicit env values win.
 */
export function adoptLegacyYouTubeTokens(cfg: Config): void {
  const read = (f: string): any => {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(cfg.legacyTokenDir, f), "utf8"),
      );
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
  const refresh =
    token?.refresh_token ??
    token?.credentials?.refresh_token ??
    token?.tokens?.refresh_token;
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
    breaking: c.breakingEnabled
      ? `${c.breakingPerDay}/day, score>=${c.breakingScoreMin}, <=${c.breakingMaxAgeMinutes}min old`
      : "off",
    approvalMode: c.approvalMode,
    approvalTimeoutMinutes: c.approvalTimeoutMinutes,
    includeRumours: c.includeRumours,
    visionQa: c.visionQa,
    dryRun: c.dryRun,
  };
}

/** The Python that has Whisper on this machine: the PC's speech runtime or the Mac's MLX one. */
/** The parallax environment (D:/pulse-tools/parallax-venv: the runtime's torch plus its own OpenCV and Pillow), else the Whisper Python. */
function defaultParallaxPython(): string {
  const venv = "D:/pulse-tools/parallax-venv/Scripts/python.exe";
  return fs.existsSync(venv) ? venv : defaultWhisperPython();
}

function defaultWhisperPython(): string {
  const candidates = [
    "D:/pulse-tools/pulse-python-runtime/Scripts/python.exe",
    `${process.env.HOME ?? ""}/PulseFactory/asr/bin/python`,
  ];
  return candidates.find((p) => p && fs.existsSync(p)) ?? "";
}

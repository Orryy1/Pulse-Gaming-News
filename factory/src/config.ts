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
  dataDir: string;
  databaseUrl: string;
  appSecret: string;
  adminToken: string;

  anthropicModel: string;
  voiceProvider: VoiceProvider;
  localTtsUrl: string;
  localVoiceId: string;
  localSpeakingRate: number;
  localTtsStart: string;
  syntheticMedia: boolean;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsModel: string;

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
  quotaUnitsPerDay: number;
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
  footage: boolean;
  maxClips: number;
  clipRanking: "llm" | "rule"; // how trailer moments are matched to narration lines
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
    dataDir: path.resolve(str("DATA_DIR", "./data")),
    databaseUrl: str("DATABASE_URL"),
    appSecret: str("APP_SECRET"),
    adminToken: str("ADMIN_TOKEN"),

    anthropicModel: str("CLAUDE_MODEL", "claude-opus-5-5"),
    voiceProvider: str("VOICE_PROVIDER", "auto") as VoiceProvider,
    localTtsUrl: str("LOCAL_TTS_URL", "http://127.0.0.1:8765").replace(/\/$/, ""),
    localVoiceId: str("LOCAL_TTS_VOICE_ID", "TX3LPaxmHKxFdv7VOQHJ"),
    localSpeakingRate: Number(str("LOCAL_TTS_SPEAKING_RATE", "1.0")),
    localTtsStart: str("LOCAL_TTS_START"),
    syntheticMedia: bool("SYNTHETIC_MEDIA_DISCLOSURE", true),
    elevenLabsApiKey: str("ELEVENLABS_API_KEY"),
    elevenLabsVoiceId: str("ELEVENLABS_VOICE_ID", "TX3LPaxmHKxFdv7VOQHJ"),
    elevenLabsModel: str("ELEVENLABS_MODEL", "eleven_multilingual_v2"),

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
    newsSlots: str("NEWS_SLOTS", "12:00,16:00,19:30").split(",").map((t) => t.trim()).filter((t) => /^\d\d:\d\d$/.test(t)).sort(),
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
    breakingApprovalMinutes: int("BREAKING_APPROVAL_MINUTES", 20),
    breakingWindow: str("BREAKING_WINDOW", "07:00-23:00"),
    quotaUnitsPerDay: int("QUOTA_UNITS_PER_DAY", 10000),
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
    footage: bool("TRAILER_FOOTAGE", true),
    maxClips: int("MAX_TRAILER_CLIPS", 4),
    clipRanking: (str("CLIP_RANKING", "llm") === "rule" ? "rule" : "llm") as "llm" | "rule",
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

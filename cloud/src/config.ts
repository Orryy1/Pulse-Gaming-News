// Every runtime knob lives here and is read from the environment once.
// Nothing secret is ever logged; see redactedConfig().

import path from "node:path";

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

export interface Config {
  port: number;
  publicUrl: string;
  dataDir: string;
  databaseUrl: string;
  appSecret: string;
  adminToken: string;

  anthropicModel: string;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsModel: string;

  discordWebhookUrl: string;
  healthcheckPingUrl: string;

  googleClientId: string;
  googleClientSecret: string;
  youtubeRefreshToken: string;
  youtubePrivacy: PrivacyStatus;
  youtubeVetoMinutes: number;

  dailyTarget: number;
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
  musicBed: boolean;
  dryRun: boolean;
  maxAttempts: number;
  remotionConcurrency: number;
  browserExecutable: string;
}

export function loadConfig(): Config {
  const approvalMode = str("APPROVAL_MODE", "timeout") as ApprovalMode;
  if (!["manual", "timeout", "auto"].includes(approvalMode)) {
    throw new Error(`APPROVAL_MODE must be manual, timeout or auto, got "${approvalMode}"`);
  }
  const youtubePrivacy = str("YOUTUBE_PRIVACY", "public") as PrivacyStatus;
  if (!["public", "unlisted", "private"].includes(youtubePrivacy)) {
    throw new Error(`YOUTUBE_PRIVACY must be public, unlisted or private, got "${youtubePrivacy}"`);
  }
  const railwayDomain = str("RAILWAY_PUBLIC_DOMAIN");
  return {
    port: int("PORT", 8080),
    publicUrl: str("PUBLIC_URL", railwayDomain ? `https://${railwayDomain}` : "http://localhost:8080").replace(/\/$/, ""),
    dataDir: path.resolve(str("DATA_DIR", "./data")),
    databaseUrl: str("DATABASE_URL"),
    appSecret: str("APP_SECRET"),
    adminToken: str("ADMIN_TOKEN"),

    anthropicModel: str("CLAUDE_MODEL", "claude-opus-5-5"),
    elevenLabsApiKey: str("ELEVENLABS_API_KEY"),
    elevenLabsVoiceId: str("ELEVENLABS_VOICE_ID", "TX3LPaxmHKxFdv7VOQHJ"),
    elevenLabsModel: str("ELEVENLABS_MODEL", "eleven_multilingual_v2"),

    discordWebhookUrl: str("DISCORD_WEBHOOK_URL"),
    healthcheckPingUrl: str("HEALTHCHECK_PING_URL"),

    googleClientId: str("GOOGLE_CLIENT_ID"),
    googleClientSecret: str("GOOGLE_CLIENT_SECRET"),
    youtubeRefreshToken: str("YOUTUBE_REFRESH_TOKEN"),
    youtubePrivacy,
    youtubeVetoMinutes: int("YOUTUBE_VETO_MINUTES", 0),

    dailyTarget: int("DAILY_TARGET", 1),
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
    musicBed: bool("MUSIC_BED", true),
    dryRun: bool("DRY_RUN", false),
    maxAttempts: int("MAX_ATTEMPTS", 3),
    remotionConcurrency: int("REMOTION_CONCURRENCY", 2),
    browserExecutable: str("REMOTION_BROWSER_EXECUTABLE"),
  };
}

/** Safe-to-log view: booleans for secrets, values for everything else. */
export function redactedConfig(c: Config): Record<string, unknown> {
  return {
    publicUrl: c.publicUrl,
    dataDir: c.dataDir,
    database: Boolean(c.databaseUrl),
    anthropicModel: c.anthropicModel,
    anthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    elevenLabs: Boolean(c.elevenLabsApiKey),
    discord: Boolean(c.discordWebhookUrl),
    youtubeOAuthClient: Boolean(c.googleClientId && c.googleClientSecret),
    youtubePrivacy: c.youtubePrivacy,
    dailyTarget: c.dailyTarget,
    approvalMode: c.approvalMode,
    approvalTimeoutMinutes: c.approvalTimeoutMinutes,
    includeRumours: c.includeRumours,
    visionQa: c.visionQa,
    dryRun: c.dryRun,
  };
}

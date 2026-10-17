// Boot-time and on-demand health checks for the things that silently stop an
// unattended factory: the model key, the YouTube login and its scopes, the
// local voice server, ffmpeg, free disk, the public URL and the webhook.
// Each check is a plain fact; the server posts the failures to Discord once.

import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "./config.ts";
import { FFMPEG } from "./lib/bin.ts";
import { fetchWithTimeout } from "./lib/util.ts";
import { SCOPES } from "./youtube/oauth.ts";

const run = promisify(execFile);

export interface Check {
  name: string;
  ok: boolean;
  critical: boolean; // a failed critical check means no Short can be published
  detail: string;
}

/** Scopes the factory needs that a granted scope string lacks. */
export function missingScopes(
  granted: string,
  required: readonly string[] = SCOPES,
): string[] {
  const have = new Set(granted.split(/\s+/).filter(Boolean));
  // youtube.force-ssl is a superset of youtube and youtube.upload for our calls.
  const covers = (s: string) =>
    have.has(s) ||
    (s !== "https://www.googleapis.com/auth/yt-analytics.readonly" &&
      have.has("https://www.googleapis.com/auth/youtube.force-ssl"));
  return required.filter((s) => !covers(s));
}

async function checkAnthropic(): Promise<Check> {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  if (key.length < 40)
    return {
      name: "anthropic_key",
      ok: false,
      critical: true,
      detail: "ANTHROPIC_API_KEY is missing or a placeholder",
    };
  try {
    const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
    const res = await fetchWithTimeout(
      "https://api.anthropic.com/v1/models?limit=1",
      {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          ...(workspace ? { "anthropic-workspace-id": workspace } : {}),
        },
      },
      15_000,
    );
    const body = res.ok
      ? undefined
      : (
          (await res.json().catch(() => ({}))) as {
            error?: { message?: string };
          }
        ).error?.message;
    const hint =
      body && /workspace/i.test(body)
        ? "organisation-level key: set ANTHROPIC_WORKSPACE_ID in .env (console.anthropic.com/settings/workspaces) or create the key inside a workspace"
        : body;
    return {
      name: "anthropic_key",
      ok: res.ok,
      critical: true,
      detail: res.ok ? "valid" : `HTTP ${res.status}: ${hint ?? ""}`.trim(),
    };
  } catch (e) {
    return {
      name: "anthropic_key",
      ok: false,
      critical: true,
      detail: `unreachable: ${(e as Error).message}`,
    };
  }
}

async function checkYouTube(
  cfg: Config,
  refreshToken: string,
): Promise<Check[]> {
  if (!cfg.googleClientId || !cfg.googleClientSecret || !refreshToken)
    return [
      {
        name: "youtube_login",
        ok: false,
        critical: !cfg.dryRun,
        detail: "not connected: open /oauth/start?key=ADMIN_TOKEN",
      },
    ];
  try {
    const res = await fetchWithTimeout(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: cfg.googleClientId,
          client_secret: cfg.googleClientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      },
      15_000,
    );
    const body = (await res.json()) as {
      access_token?: string;
      error?: string;
      scope?: string;
    };
    if (!body.access_token)
      return [
        {
          name: "youtube_login",
          ok: false,
          critical: !cfg.dryRun,
          detail: `refresh failed: ${body.error ?? res.status}`,
        },
      ];
    const missing = missingScopes(body.scope ?? "");
    return [
      {
        name: "youtube_login",
        ok: true,
        critical: !cfg.dryRun,
        detail: "refresh token valid",
      },
      {
        name: "youtube_scopes",
        ok: missing.length === 0,
        critical: false,
        detail: missing.length
          ? `missing ${missing.map((m) => m.replace("https://www.googleapis.com/auth/", "")).join(", ")}: captions and analytics need a reconnect at /oauth/start?key=ADMIN_TOKEN`
          : "captions and analytics scopes granted",
      },
    ];
  } catch (e) {
    return [
      {
        name: "youtube_login",
        ok: false,
        critical: !cfg.dryRun,
        detail: `unreachable: ${(e as Error).message}`,
      },
    ];
  }
}

async function checkLocalVoice(cfg: Config): Promise<Check> {
  try {
    const res = await fetchWithTimeout(`${cfg.localTtsUrl}/health`, {}, 5_000);
    if (!res.ok)
      return {
        name: "local_voice",
        ok: false,
        critical: false,
        detail: `${cfg.localTtsUrl} answered HTTP ${res.status} (the factory starts it on demand)`,
      };
    const probe = await fetchWithTimeout(
      `${cfg.localTtsUrl}/v1/text-to-speech/${cfg.localVoiceId}/with-timestamps`,
      {},
      5_000,
    );
    if (probe.status === 404)
      return {
        name: "local_voice",
        ok: false,
        critical: false,
        detail: `a different server answers on ${cfg.localTtsUrl}; set LOCAL_TTS_URL to a free port`,
      };
    return {
      name: "local_voice",
      ok: true,
      critical: false,
      detail: "up and speaks the /with-timestamps contract",
    };
  } catch {
    return {
      name: "local_voice",
      ok: true,
      critical: false,
      detail: `down; the factory starts it on demand via ${cfg.localTtsStart || "LOCAL_TTS_START (unset)"}`,
    };
  }
}

async function checkElevenLabs(cfg: Config): Promise<Check | undefined> {
  if (!cfg.elevenLabsApiKey) return undefined;
  try {
    const res = await fetchWithTimeout(
      "https://api.elevenlabs.io/v1/user/subscription",
      { headers: { "xi-api-key": cfg.elevenLabsApiKey } },
      15_000,
    );
    if (!res.ok)
      return {
        name: "elevenlabs",
        ok: false,
        critical: false,
        detail: `key rejected (HTTP ${res.status}); ${cfg.voiceProvider === "elevenlabs" ? "VOICE_PROVIDER=elevenlabs cannot narrate" : "falling through to the local voice"}`,
      };
    const s = (await res.json()) as {
      character_count?: number;
      character_limit?: number;
      tier?: string;
    };
    const left = (s.character_limit ?? 0) - (s.character_count ?? 0);
    return {
      name: "elevenlabs",
      ok: true,
      critical: false,
      detail: `${s.tier ?? "plan"}: ${left.toLocaleString("en-GB")} characters left this month`,
    };
  } catch (e) {
    return {
      name: "elevenlabs",
      ok: false,
      critical: false,
      detail: `unreachable: ${(e as Error).message}`,
    };
  }
}

async function checkFfmpeg(): Promise<Check> {
  try {
    const { stdout } = await run(FFMPEG, ["-version"]);
    return {
      name: "ffmpeg",
      ok: true,
      critical: true,
      detail: stdout.split("\n")[0]?.slice(0, 60) ?? "ok",
    };
  } catch (e) {
    return {
      name: "ffmpeg",
      ok: false,
      critical: true,
      detail: (e as Error).message,
    };
  }
}

/** yt-dlp fetches official trailers for games that are not on Steam; without it those Shorts fall back to stills. */
async function checkYtDlp(cfg: Config): Promise<Check | undefined> {
  if (!cfg.officialTrailers) return undefined;
  try {
    const { stdout } = await run(cfg.ytdlpPath, ["--version"]);
    const version = stdout.trim();
    const [y, m] = version.split(".").map(Number);
    const ageMonths = (new Date().getUTCFullYear() - (y ?? 0)) * 12 + (new Date().getUTCMonth() + 1 - (m ?? 0));
    return {
      name: "yt-dlp",
      ok: true,
      critical: false,
      detail: ageMonths > 3 ? `${version} is ${ageMonths} months old; the factory self-updates it when a download fails` : version,
    };
  } catch (e) {
    return {
      name: "yt-dlp",
      ok: false,
      critical: false,
      detail: `${cfg.ytdlpPath}: ${(e as Error).message.split("\n")[0]}; official trailers for non-Steam games will be stills only (set YTDLP_PATH or OFFICIAL_TRAILERS=false)`,
    };
  }
}

async function checkDisk(cfg: Config): Promise<Check> {
  try {
    const st = await fs.statfs(cfg.dataDir);
    const freeGb = (st.bavail * st.bsize) / 1e9;
    return {
      name: "disk",
      ok: freeGb >= 20,
      critical: freeGb < 5,
      detail: `${freeGb.toFixed(1)} GB free at ${cfg.dataDir}`,
    };
  } catch (e) {
    return {
      name: "disk",
      ok: false,
      critical: false,
      detail: (e as Error).message,
    };
  }
}

async function checkPublicUrl(cfg: Config): Promise<Check | undefined> {
  if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(cfg.publicUrl))
    return undefined;
  try {
    const res = await fetchWithTimeout(`${cfg.publicUrl}/health`, {}, 8_000);
    return {
      name: "public_url",
      ok: res.ok,
      critical: false,
      detail: res.ok
        ? `${cfg.publicUrl} reachable (approval links work from a phone)`
        : `${cfg.publicUrl} answered HTTP ${res.status}`,
    };
  } catch {
    return {
      name: "public_url",
      ok: false,
      critical: false,
      detail: `${cfg.publicUrl} unreachable: timeout approvals are held until the tunnel is up (windows\\install-tunnel.ps1)`,
    };
  }
}

async function checkDiscord(cfg: Config): Promise<Check | undefined> {
  if (!cfg.discordWebhookUrl) return undefined;
  try {
    const res = await fetchWithTimeout(cfg.discordWebhookUrl, {}, 8_000); // GET returns the webhook object, sends nothing
    return {
      name: "discord",
      ok: res.ok,
      critical: false,
      detail: res.ok ? "webhook valid" : `webhook HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      name: "discord",
      ok: false,
      critical: false,
      detail: (e as Error).message,
    };
  }
}

export async function runDoctor(
  cfg: Config,
  refreshToken: string,
): Promise<Check[]> {
  const results = await Promise.all([
    checkAnthropic(),
    checkYouTube(cfg, refreshToken),
    checkLocalVoice(cfg),
    checkElevenLabs(cfg),
    checkFfmpeg(),
    checkYtDlp(cfg),
    checkDisk(cfg),
    checkPublicUrl(cfg),
    checkDiscord(cfg),
  ]);
  return results.flat().filter((c): c is Check => Boolean(c));
}

export function formatDoctor(checks: Check[]): string {
  return checks
    .map(
      (c) => `${c.ok ? "✅" : c.critical ? "⛔" : "⚠️"} ${c.name}: ${c.detail}`,
    )
    .join("\n");
}

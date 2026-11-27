// Boot-time and on-demand health checks for the things that silently stop an
// unattended factory: the model key, the YouTube login and its scopes, the
// local voice server, ffmpeg, free disk, the public URL and the webhook.
// Each check is a plain fact; the server posts the failures to Discord once.

import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "./config.ts";
import { FFMPEG } from "./lib/bin.ts";
import { errorMessage, fetchWithTimeout, log } from "./lib/util.ts";
import { SCOPES } from "./youtube/oauth.ts";
import { fetchRockstarNewswire } from "./discovery/newsrooms.ts";
import path from "node:path";
import type { Db } from "./db.ts";
import { tokenKey } from "./youtube/oauth.ts";
import { quotaCalls, quotaUsed } from "./lanes.ts";
import {
  forecastBackup,
  forecastCodex,
  forecastDisk,
  forecastElevenLabs,
  forecastOllama,
  forecastYouTubeQuota,
  forecastYouTubeToken,
  weekStart,
  type Forecast,
} from "./forecast.ts";

const run = promisify(execFile);

/**
 * The waits between tries when a request gets no answer at all. A boot is the busiest moment the process has, so one
 * lost connection says little; a real outage fails all three and still alerts. An answer of any kind, such as a
 * refused login, is taken the first time.
 */
export const NETWORK_RETRY_WAITS: readonly number[] = [5_000, 15_000];

async function steadyFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  waits: readonly number[] = NETWORK_RETRY_WAITS,
): Promise<Response> {
  for (let k = 0; ; k++) {
    try {
      return await fetchWithTimeout(url, init, timeoutMs);
    } catch (err) {
      if (k >= waits.length) throw err;
      log("info", "doctor: no answer, trying again", {
        host: new URL(url).host,
        error: errorMessage(err),
      });
      await new Promise((r) => setTimeout(r, waits[k]));
    }
  }
}

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
    const res = await steadyFetch(
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
      detail: `unreachable: ${errorMessage(e)}`,
    };
  }
}

export async function checkYouTube(
  cfg: Config,
  refreshToken: string,
  waits: readonly number[] = NETWORK_RETRY_WAITS,
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
    const res = await steadyFetch(
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
      waits,
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
          ? `missing ${missing.map((m) => m.replace("https://www.googleapis.com/auth/", "")).join(", ")}: captions and analytics need a reconnect: open http://localhost:8080/connect on this PC`
          : "captions and analytics scopes granted",
      },
    ];
  } catch (e) {
    return [
      {
        name: "youtube_login",
        ok: false,
        critical: !cfg.dryRun,
        detail: `unreachable: ${errorMessage(e)}`,
      },
    ];
  }
}

/** The filters that quietly go missing on a slim ffmpeg build (Homebrew's plain ffmpeg, 4 Nov 2026): the HDR tone-map for console clips above all. */
export const NEEDED_FILTERS = ["zscale", "tonemap", "rubberband", "loudnorm"];

/** The filters from NEEDED_FILTERS not in `ffmpeg -filters` (pure). */
export function missingFilters(listing: string): string[] {
  return NEEDED_FILTERS.filter(
    (f) => !new RegExp(`^\\s*\\S+\\s+${f}\\s`, "m").test(listing),
  );
}

async function checkFfmpegFilters(): Promise<Check> {
  try {
    const { stdout } = await run(FFMPEG, ["-hide_banner", "-filters"], {
      maxBuffer: 4 * 1024 * 1024,
    });
    const missing = missingFilters(stdout);
    return {
      name: "ffmpeg_filters",
      ok: missing.length === 0,
      critical: false,
      detail: missing.length
        ? `${FFMPEG} has no ${missing.join(", ")}: HDR console clips and some audio steps will fail or degrade. On the Mac use ffmpeg-full (FFMPEG_PATH).`
        : "all present",
    };
  } catch (e) {
    return {
      name: "ffmpeg_filters",
      ok: false,
      critical: false,
      detail: `could not list filters: ${errorMessage(e)}`,
    };
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
    const res = await steadyFetch(
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
      detail: `${s.tier ?? "plan"}: ${left.toLocaleString("en-US")} characters left this month`,
    };
  } catch (e) {
    return {
      name: "elevenlabs",
      ok: false,
      critical: false,
      detail: `unreachable: ${errorMessage(e)}`,
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

/** Rockstar's Newswire data endpoint: a rotated hash silently stops Rockstar news and press images. */
async function checkRockstar(): Promise<Check> {
  const items = await fetchRockstarNewswire(process.env.ROCKSTAR_NEWSWIRE_LIST_HASH || undefined, 0);
  return items.length
    ? { name: "rockstar_newswire", ok: true, critical: false, detail: `${items.length} posts, latest "${items[0]!.title.slice(0, 60)}"` }
    : { name: "rockstar_newswire", ok: false, critical: false, detail: "no posts: the data endpoint hash may have rotated (set ROCKSTAR_NEWSWIRE_LIST_HASH from the site's NewswireList request)" };
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

/**
 * Every per-episode link something outside fetches: approval and reject pages, the Short Instagram and Threads
 * pull, and (SHORT_FULL_COVER) the social copy TikTok pulls through Buffer and its cover still. The tunnel's
 * ingress list must let each one through; on 25-26 Nov 2026 social.mp4 was missing from it and every
 * TikTok draft of a Short with a social copy failed ("Video could not be read from its URL").
 */
export const PUBLIC_EPISODE_ROUTES = ["approve", "reject", "video.mp4", "social.mp4", "cover.jpg"] as const;

/** The public routes that did not reach the factory: it answers a wrong token with 403, anything else (0 = no answer) is the tunnel or Cloudflare. */
export function blockedPublicRoutes(statuses: Readonly<Record<string, number>>): string[] {
  return PUBLIC_EPISODE_ROUTES.filter((r) => statuses[r] !== 403);
}

/** The check's verdict from each route's status (0 when it never answered). */
export function publicUrlCheck(publicUrl: string, statuses: Readonly<Record<string, number>>): Check {
  const blocked = blockedPublicRoutes(statuses);
  if (blocked.length === PUBLIC_EPISODE_ROUTES.length && blocked.every((r) => !statuses[r]))
    return {
      name: "public_url",
      ok: false,
      critical: false,
      detail: `${publicUrl} unreachable: timeout approvals are held until the tunnel is up (windows\\install-tunnel.ps1)`,
    };
  return {
    name: "public_url",
    ok: blocked.length === 0,
    critical: false,
    detail:
      blocked.length === 0
        ? `${publicUrl} reachable (approval and video links work from outside)`
        : `${publicUrl} blocks ${blocked.map((r) => `${r} (${statuses[r] ? `HTTP ${statuses[r]}` : "no answer"})`).join(", ")}: add it to the tunnel's episodes path rule (cloudflared-pulse.yml)`,
  };
}

export async function checkPublicUrl(
  cfg: Pick<Config, "publicUrl">,
  fetcher: (url: string) => Promise<Response> = (url) => steadyFetch(url, { redirect: "manual" }, 8_000),
): Promise<Check | undefined> {
  if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(cfg.publicUrl))
    return undefined;
  // Each route with a wrong token: the factory itself answers 403. (/health is hidden from the internet
  // by a Cloudflare rule, so its 404 said nothing about whether the links work.) The changing query keeps
  // a cached 404 from Cloudflare out of the answer. A route that never answers counts as 0, not the lot.
  const statuses: Record<string, number> = {};
  await Promise.all(
    PUBLIC_EPISODE_ROUTES.map(async (route) => {
      try {
        const res = await fetcher(`${cfg.publicUrl}/episodes/doctor/${route}?t=0&n=${Date.now()}`);
        statuses[route] = res.status;
        await res.body?.cancel().catch(() => undefined);
      } catch {
        statuses[route] = 0;
      }
    }),
  );
  return publicUrlCheck(cfg.publicUrl, statuses);
}

async function checkDiscord(cfg: Config): Promise<Check | undefined> {
  if (!cfg.discordWebhookUrl) return undefined;
  try {
    const res = await steadyFetch(cfg.discordWebhookUrl, {}, 8_000); // GET returns the webhook object, sends nothing
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
    checkFfmpegFilters(),
    checkLocalVoice(cfg),
    checkElevenLabs(cfg),
    checkFfmpeg(),
    checkYtDlp(cfg),
    checkRockstar(),
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

// ---------------------------------------------------------------- the dependency forecaster (FORECAST_ENABLED)
// The boot checks above say what is broken now; these say what will be, days ahead (src/forecast.ts).

/** What the forecaster reads beside the database: each optional, so a missing one is skipped, never a failure. */
export interface ForecastDeps {
  creditPlan?: () => Promise<{ left: number; resetAt: Date; pacePerDay: number } | undefined>;
  /** The stored refresh token, for the live refresh test (undefined: not tested). */
  refreshToken?: string;
  visionDown?: () => Promise<boolean>;
  /** Free space where the data lives, in GB (defaults to statfs on DATA_DIR). */
  freeGb?: () => Promise<number>;
  fetchJson?: (url: string) => Promise<unknown>;
  now: Date;
}

async function setting(db: Db, key: string): Promise<{ value: string; updated_at: string | Date } | undefined> {
  const [row] = await db.query<{ value: string; updated_at: string | Date }>(
    `SELECT value, updated_at FROM settings WHERE key = $1`,
    [key],
  );
  return row;
}

async function putSetting(db: Db, key: string, value: string): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
}

/** One free-space sample a day per machine, the last fourteen kept, for the trend; returns the earlier ones. */
async function diskSamples(
  db: Db,
  machine: string,
  freeGb: number,
  now: Date,
): Promise<Array<{ at: string; freeGb: number }>> {
  const key = `forecast_disk_${machine.toLowerCase()}`;
  const row = await setting(db, key);
  let samples: Array<{ at: string; freeGb: number }> = [];
  try {
    samples = row ? (JSON.parse(row.value) as typeof samples) : [];
  } catch {
    samples = [];
  }
  const last = samples[samples.length - 1];
  if (!last || now.getTime() - new Date(last.at).getTime() >= 20 * 3_600_000) {
    await putSetting(db, key, JSON.stringify([...samples, { at: now.toISOString(), freeGb }].slice(-14)));
  }
  return samples;
}

/** Codex answers this week, from the usage meter (data/usage/<day>.jsonl, provider "codex"). */
async function codexCallsSince(dataDir: string, since: Date, now: Date): Promise<number> {
  let n = 0;
  for (let t = since.getTime(); t <= now.getTime() + 86_400_000; t += 86_400_000) {
    const file = path.join(dataDir, "usage", `${new Date(t).toISOString().slice(0, 10)}.jsonl`);
    const text = await fs.readFile(file, "utf8").catch(() => "");
    for (const line of text.split("\n")) if (line.includes(CODEX_LINE)) n++;
  }
  return n;
}
const CODEX_LINE = `"provider":"codex"`;

/** Every forecast the factory can make here, with what it read; a reader that fails gives an "unknown" line. */
export async function gatherForecasts(db: Db, cfg: Config, deps: ForecastDeps): Promise<Forecast[]> {
  const { now } = deps;
  const horizon = cfg.forecastHorizonDays;
  const out: Forecast[] = [];
  const safely = async (id: string, fn: () => Promise<Forecast | undefined>) => {
    try {
      const f = await fn();
      if (f) out.push(f);
    } catch (err) {
      out.push({ id, level: "ok", line: `${id}: could not be read (${errorMessage(err).slice(0, 100)})` });
    }
  };
  await safely("elevenlabs", async () =>
    forecastElevenLabs(await deps.creditPlan?.(), now, horizon, cfg.elevenLabsReserve),
  );
  await safely("youtube_quota", async () =>
    forecastYouTubeQuota({
      units: await quotaUsed(db, now),
      unitLimit: cfg.quotaUnitsPerDay,
      uploads: await quotaCalls(db, now, "upload"),
      uploadLimit: cfg.uploadCallsPerDay,
      now,
    }),
  );
  await safely("youtube_token", async () => {
    const row = await setting(db, tokenKey(""));
    // The live refresh: free (no quota), and it says "refused" the day the login dies, before an upload finds out.
    const check =
      deps.refreshToken !== undefined && !cfg.dryRun ? (await checkYouTube(cfg, deps.refreshToken, []))[0] : undefined;
    return forecastYouTubeToken({
      savedAt: row ? new Date(row.updated_at) : undefined,
      lifetimeDays: cfg.forecastYoutubeTokenDays,
      refreshOk: check ? check.ok : undefined,
      refreshDetail: check?.detail,
      now,
      horizonDays: horizon,
    });
  });
  await safely("codex", async () => {
    if (!cfg.codexLlm) return undefined;
    const since = weekStart(now, cfg.codexWeekResetDay);
    return forecastCodex({
      calls: await codexCallsSince(cfg.dataDir, since, now),
      failures: 0,
      budget: cfg.codexWeeklyCalls,
      now,
      resetDay: cfg.codexWeekResetDay,
      horizonDays: horizon,
    });
  });
  await safely("disk", async () => {
    const freeGb = deps.freeGb
      ? await deps.freeGb()
      : await fs.statfs(cfg.dataDir).then((st) => (st.bavail * st.bsize) / 1e9);
    const machine = process.platform === "darwin" ? "Mac" : "PC";
    return forecastDisk({
      machine,
      freeGb,
      samples: await diskSamples(db, machine, freeGb, now),
      floorGb: cfg.forecastDiskFloorGb,
      now,
      horizonDays: horizon,
    });
  });
  if (cfg.forecastPcDiskUrl)
    await safely("disk_pc", async () => {
      const body = (
        deps.fetchJson
          ? await deps.fetchJson(cfg.forecastPcDiskUrl)
          : await (await fetchWithTimeout(cfg.forecastPcDiskUrl, {}, 10_000)).json()
      ) as { freeGb?: number };
      if (typeof body.freeGb !== "number") throw new Error("no freeGb in the answer");
      return forecastDisk({
        machine: "PC",
        freeGb: body.freeGb,
        samples: await diskSamples(db, "PC", body.freeGb, now),
        floorGb: cfg.forecastDiskFloorGb,
        now,
        horizonDays: horizon,
      });
    });
  await safely("ollama", async () => {
    if (!deps.visionDown) return undefined;
    const down = await deps.visionDown();
    const row = await setting(db, "forecast_ollama_down");
    if (down && !row) await putSetting(db, "forecast_ollama_down", now.toISOString());
    if (!down && row) await db.query(`DELETE FROM settings WHERE key = 'forecast_ollama_down'`);
    const [n] = await db.query<{ n: string | number }>(
      `SELECT count(*) AS n FROM events WHERE kind = 'note' AND detail->>'text' ILIKE '%relay%down%' AND created_at > $1::timestamptz - interval '1 day'`,
      [now],
    );
    return forecastOllama({
      downNow: down,
      downSince: down ? (row ? new Date(row.value) : now) : undefined,
      outagesLastDay: Number(n?.n ?? 0),
      now,
    });
  });
  await safely("backup", async () => {
    const [row] = await db.query<{ at: string | Date | null }>(
      `SELECT max(created_at) AS at FROM events WHERE kind = 'backup'`,
    );
    return forecastBackup({ lastAt: row?.at ? new Date(row.at) : undefined, now });
  });
  return out;
}

/** The forecasts as doctor checks, for the /doctor page beside the boot checks. */
export function forecastChecks(forecasts: readonly Forecast[]): Check[] {
  return forecasts.map((f) => ({ name: `forecast_${f.id}`, ok: f.level === "ok", critical: false, detail: f.line }));
}

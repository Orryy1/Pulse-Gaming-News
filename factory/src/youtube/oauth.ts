// OAuth for a single owned channel. Consent happens once in a browser via the
// service's own /oauth routes; the refresh token is stored encrypted in Postgres.

import type { Db } from "../db.ts";
import { encrypt, decrypt } from "../lib/crypto.ts";
import { fetchWithTimeout, FatalError } from "../lib/util.ts";

export const SCOPES = [
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  appSecret: string;
  envRefreshToken: string;
}

export function consentUrl(cfg: OAuthConfig, state: string): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

export async function exchangeCode(cfg: OAuthConfig, code: string): Promise<{ refreshToken: string; scope: string }> {
  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = (await res.json()) as { refresh_token?: string; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !body.refresh_token) throw new Error(`token exchange failed: ${body.error ?? res.status} ${body.error_description ?? ""}`.trim());
  return { refreshToken: body.refresh_token, scope: body.scope ?? "" };
}

export async function saveRefreshToken(db: Db, cfg: OAuthConfig, token: string): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('youtube_refresh_token', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [encrypt(token, cfg.appSecret)],
  );
}

async function loadRefreshToken(db: Db, cfg: OAuthConfig): Promise<string> {
  const [row] = await db.query<{ value: string }>(`SELECT value FROM settings WHERE key = 'youtube_refresh_token'`);
  if (row) return decrypt(row.value, cfg.appSecret);
  if (cfg.envRefreshToken) return cfg.envRefreshToken;
  throw new FatalError("YouTube is not connected yet: open /oauth/start?key=ADMIN_TOKEN on the service");
}

let cached: { token: string; expiresAt: number } | undefined;

export async function accessToken(db: Db, cfg: OAuthConfig): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const refresh = await loadRefreshToken(db, cfg);
  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (body.error === "invalid_grant") {
    // Revoked or expired (Testing-mode consent screens expire tokens after 7 days).
    throw new FatalError("YouTube refresh token is invalid (invalid_grant): reconnect via /oauth/start");
  }
  if (!res.ok || !body.access_token) throw new Error(`token refresh failed: HTTP ${res.status} ${body.error ?? ""}`);
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

export function clearTokenCache(): void {
  cached = undefined;
}

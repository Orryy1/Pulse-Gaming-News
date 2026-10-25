// OAuth for the owned channels. Consent happens once in a browser via the service's own /oauth routes;
// each refresh token is stored encrypted in the settings table: the main channel under
// youtube_refresh_token, a second account (the Spanish twin channel, "es") under youtube_refresh_token:es.

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

/** The channel a fresh login belongs to, so a wrong brand account is caught before it is saved. */
export async function channelOf(refreshToken: string, cfg: OAuthConfig): Promise<{ id: string; title: string } | undefined> {
  const t = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const tok = (await t.json()) as { access_token?: string };
  if (!tok.access_token) return undefined;
  const r = await fetchWithTimeout("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { authorization: `Bearer ${tok.access_token}` } });
  const c = ((await r.json()) as { items?: Array<{ id: string; snippet?: { title?: string } }> }).items?.[0];
  return c ? { id: c.id, title: c.snippet?.title ?? c.id } : undefined;
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

/** The settings key a login is stored under: the main channel's, or a named second account's. */
export function tokenKey(account = ""): string {
  return account ? `youtube_refresh_token:${account}` : "youtube_refresh_token";
}

export async function saveRefreshToken(db: Db, cfg: OAuthConfig, token: string, account = ""): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [tokenKey(account), encrypt(token, cfg.appSecret)],
  );
}

/** The refresh token the factory would use, or "" when that account is not connected. */
export async function storedRefreshToken(db: Db, cfg: OAuthConfig, account = ""): Promise<string> {
  try {
    return await loadRefreshToken(db, cfg, account);
  } catch {
    return "";
  }
}

async function loadRefreshToken(db: Db, cfg: OAuthConfig, account = ""): Promise<string> {
  const [row] = await db.query<{ value: string }>(`SELECT value FROM settings WHERE key = $1`, [tokenKey(account)]);
  if (row) return decrypt(row.value, cfg.appSecret);
  if (!account && cfg.envRefreshToken) return cfg.envRefreshToken;
  throw new FatalError(
    account
      ? `YouTube account "${account}" is not connected yet: open /connect?account=${account} on the PC running the factory`
      : "YouTube is not connected yet: open /oauth/start?key=ADMIN_TOKEN on the service",
  );
}

const cached = new Map<string, { token: string; expiresAt: number }>();

export async function accessToken(db: Db, cfg: OAuthConfig, account = ""): Promise<string> {
  const have = cached.get(account);
  if (have && have.expiresAt > Date.now() + 60_000) return have.token;
  const refresh = await loadRefreshToken(db, cfg, account);
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
  cached.set(account, { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 });
  return body.access_token;
}

export function clearTokenCache(): void {
  cached.clear();
}

const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const dotenv = require("dotenv");
const { withRetry } = require("./lib/retry");
const { addBreadcrumb, captureException } = require("./lib/sentry");
const { getPublicUrl } = require("./lib/deployment-mode");
const { validateVideo } = require("./lib/validate");
const {
  assertPlatformVideoQaPass,
} = require("./lib/services/platform-video-qa");
const {
  assertBatchUploadPreflight,
  storyIsBatchUploadCandidate,
} = require("./lib/services/batch-upload-preflight");
const db = require("./lib/db");
const mediaPaths = require("./lib/media-paths");

dotenv.config({ override: true });

const DEFAULT_TOKEN_PATH = path.join(__dirname, "tokens", "tiktok_token.json");

function envExplicitFalse(name) {
  return /^(false|0|no|off)$/i.test(String(process.env[name] || "").trim());
}

function isTikTokOperatorDisabled() {
  return envExplicitFalse("TIKTOK_ENABLED") || envExplicitFalse("TIKTOK_AUTO_UPLOAD_ENABLED");
}

function assertTikTokOperatorEnabled() {
  if (isTikTokOperatorDisabled()) {
    throw new Error("tiktok_operator_disabled");
  }
}

/**
 * Pick the `privacy_level` we send to TikTok's Content Posting API.
 *
 * Background (2026-04-24): the live probe showed our init requests
 * fail with error code
 *   `unaudited_client_can_only_post_to_private_accounts`
 * even though the token carries `video.publish` + `video.upload` +
 * `user.info.basic` and `creator_info` returns full posting options
 * (`PUBLIC_TO_EVERYONE`, 60min max duration, no restrictions). The
 * 403 is app-level: until TikTok audits the Pulse Gaming app via
 * developers.tiktok.com, EVERY `PUBLIC_TO_EVERYONE` init returns
 * the same 403.
 *
 * Env var contract:
 *
 *   `TIKTOK_PRIVACY_LEVEL=PUBLIC_TO_EVERYONE` (default) — the
 *     post-audit goal state. TikTok refuses this for unaudited
 *     apps; keep this value for production once audit clears.
 *
 *   `TIKTOK_PRIVACY_LEVEL=SELF_ONLY` — diagnostic / audit-pending
 *     workaround. Upload lands as a private draft in the creator's
 *     TikTok inbox. Operator manually publishes from the TikTok
 *     app if desired. Proves the end-to-end upload chain works.
 *
 *   `TIKTOK_PRIVACY_LEVEL=MUTUAL_FOLLOW_FRIENDS` — also accepted
 *     by unaudited apps; visible only to the creator's followers.
 *     Less useful than SELF_ONLY for most ops scenarios.
 *
 * Anything else falls back to the default and logs a warning so
 * the operator doesn't silently ship a typo. Never trust the env
 * var verbatim as a free-form string.
 */
const TIKTOK_ALLOWED_PRIVACY_LEVELS = new Set([
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR", // rarely used but valid per Content Posting API docs
  "SELF_ONLY",
]);
const TIKTOK_DEFAULT_PRIVACY_LEVEL = "PUBLIC_TO_EVERYONE";

function resolveTikTokPrivacyLevel() {
  const raw = (process.env.TIKTOK_PRIVACY_LEVEL || "").trim().toUpperCase();
  if (!raw) return TIKTOK_DEFAULT_PRIVACY_LEVEL;
  if (TIKTOK_ALLOWED_PRIVACY_LEVELS.has(raw)) return raw;
  console.log(
    `[tiktok] WARNING: TIKTOK_PRIVACY_LEVEL="${raw}" is not a recognised TikTok privacy level ` +
      `(expected one of ${[...TIKTOK_ALLOWED_PRIVACY_LEVELS].join(", ")}). ` +
      `Falling back to default ${TIKTOK_DEFAULT_PRIVACY_LEVEL}.`,
  );
  return TIKTOK_DEFAULT_PRIVACY_LEVEL;
}

/**
 * Resolve the TikTok token file path.
 *
 * Production (Railway): TIKTOK_TOKEN_PATH=/data/tokens/tiktok_token.json —
 * lives on the persistent volume so it survives deploys. Without this the
 * token is wiped every redeploy (the /app filesystem is ephemeral) and
 * TikTok publishing silently fails.
 *
 * Dev: falls back to tokens/tiktok_token.json alongside the repo.
 *
 * Resolved fresh on every call so tests can mutate process.env and so
 * swapping Railway config doesn't require a restart.
 */
function resolveTokenPath() {
  const override = (process.env.TIKTOK_TOKEN_PATH || "").trim();
  return override || DEFAULT_TOKEN_PATH;
}

// TikTok access tokens are documented as 24h lifetime. We use this as a
// conservative fallback when TikTok's OAuth response omits or corrupts
// `expires_in` (observed on the sandbox endpoint 2026-04-19). Never
// raise this without evidence — it's better to refresh one cycle early
// than let a stale token reach a publish job.
const DEFAULT_EXPIRES_IN_SECONDS = 24 * 60 * 60;

/**
 * Parse a TikTok OAuth `expires_in` value defensively.
 *
 * Accepts:
 *   - numbers (86400)
 *   - numeric strings ("86400", "  86400  ")
 *
 * Returns null for anything else (undefined, null, "", "abc", NaN, 0,
 * negatives) so callers can tell the difference between "TikTok said N
 * seconds" and "TikTok didn't tell us".
 *
 * Exported for unit testing.
 */
function coerceExpiresIn(raw) {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/**
 * Turn a TikTok OAuth response body into a stored token record with
 * guaranteed numeric `expires_at` (epoch ms). Keeps every field TikTok
 * returned (access_token, refresh_token, scope, open_id, etc.) and adds:
 *
 *   - `expires_at`            : number (epoch ms) — the critical field
 *   - `refresh_expires_at`    : number (epoch ms) — only if TikTok
 *                                returned `refresh_expires_in`
 *
 * Logs a single `[tiktok] WARNING: ...` line if TikTok omitted
 * `expires_in` or returned something we can't parse. The log contains
 * no token content.
 *
 * Exported for unit testing.
 */
function buildTokenRecord(apiResponseData, { now = Date.now() } = {}) {
  const data =
    apiResponseData && typeof apiResponseData === "object"
      ? apiResponseData
      : {};

  const parsedExpires = coerceExpiresIn(data.expires_in);
  const effectiveExpires = parsedExpires || DEFAULT_EXPIRES_IN_SECONDS;
  if (parsedExpires == null) {
    console.log(
      `[tiktok] WARNING: OAuth response missing/invalid expires_in; ` +
        `falling back to ${DEFAULT_EXPIRES_IN_SECONDS}s (${DEFAULT_EXPIRES_IN_SECONDS / 3600}h) default. ` +
        `Token will be refreshed on schedule.`,
    );
  }

  const record = { ...data };
  record.expires_at = now + effectiveExpires * 1000;

  const parsedRefresh = coerceExpiresIn(data.refresh_expires_in);
  if (parsedRefresh != null) {
    record.refresh_expires_at = now + parsedRefresh * 1000;
  }

  return record;
}

/*
  TikTok Content Posting API - Direct Post flow
  Docs: https://developers.tiktok.com/doc/content-posting-api-get-started

  Setup:
  1. Register at developers.tiktok.com
  2. Create app → request "Content Posting API" scope
  3. Complete app review (required for direct posting)
  4. Set env: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET
  5. (Railway) set TIKTOK_TOKEN_PATH=/data/tokens/tiktok_token.json so the
     OAuth token survives deploys on the persistent volume.
  6. Visit GET /auth/tiktok on the deployed server, complete consent.
  7. Callback /auth/tiktok/callback writes the token to the resolved path.
*/

// Read-only structural check of the on-disk TikTok token. Never
// contacts TikTok, never burns a refresh, never logs token values.
// Callers (the proactive auth-check job, /api/platforms/status) use
// this to decide whether to alert or trigger a refresh.
//
// Return shape:
//   { ok: boolean,
//     reason: string — enum-style tag if !ok
//     expires_at: number | null (epoch ms),
//     expires_in_seconds: number | null,
//     refresh_available: boolean,
//     needs_reauth: boolean }
//
// `needs_reauth: true` means the operator must visit /auth/tiktok —
// no refresh can save this state. `ok: false` with
// needs_reauth: false means we can probably refresh our way out.
async function inspectTokenStatus({ now = Date.now() } = {}) {
  const tokenPath = resolveTokenPath();
  if (!(await fs.pathExists(tokenPath))) {
    return {
      ok: false,
      reason: "token_file_missing",
      expires_at: null,
      expires_in_seconds: null,
      refresh_available: false,
      needs_reauth: true,
    };
  }
  let tokenData;
  try {
    tokenData = await fs.readJson(tokenPath);
  } catch {
    return {
      ok: false,
      reason: "token_file_unreadable",
      expires_at: null,
      expires_in_seconds: null,
      refresh_available: false,
      needs_reauth: true,
    };
  }
  if (
    typeof tokenData.access_token !== "string" ||
    tokenData.access_token.length < 8
  ) {
    return {
      ok: false,
      reason: "access_token_missing",
      expires_at: null,
      expires_in_seconds: null,
      refresh_available:
        typeof tokenData.refresh_token === "string" &&
        tokenData.refresh_token.length >= 8,
      needs_reauth: true,
    };
  }
  const expiresAt = Number(tokenData.expires_at);
  const hasValidExpiry = Number.isFinite(expiresAt);
  const refreshAvailable =
    typeof tokenData.refresh_token === "string" &&
    tokenData.refresh_token.length >= 8;
  if (!hasValidExpiry) {
    return {
      ok: false,
      reason: "expires_at_invalid",
      expires_at: null,
      expires_in_seconds: null,
      refresh_available: refreshAvailable,
      needs_reauth: !refreshAvailable,
    };
  }
  const expiresInSeconds = Math.round((expiresAt - now) / 1000);
  if (expiresInSeconds <= 0) {
    return {
      ok: false,
      reason: "expired",
      expires_at: expiresAt,
      expires_in_seconds: expiresInSeconds,
      refresh_available: refreshAvailable,
      needs_reauth: !refreshAvailable,
    };
  }
  return {
    ok: true,
    reason: "ok",
    expires_at: expiresAt,
    expires_in_seconds: expiresInSeconds,
    refresh_available: refreshAvailable,
    needs_reauth: false,
  };
}

async function getAccessToken() {
  const tokenPath = resolveTokenPath();
  if (!(await fs.pathExists(tokenPath))) {
    throw new Error(
      "TikTok not authenticated. Visit /auth/tiktok on the server to re-auth.\n" +
        "Requires TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in env.",
    );
  }

  const tokenData = await fs.readJson(tokenPath);

  // Defensive: an earlier bug (pre-fix) wrote TikTok's JSON-body error
  // response to this file as a fake token with {error, error_description,
  // log_id, expires_at}. Detect that shape and treat it as "not
  // authenticated" so publish paths fail loudly instead of sending
  // `undefined` as the bearer. This also covers any future drift where
  // the on-disk record is missing the one field that actually matters.
  if (
    typeof tokenData.access_token !== "string" ||
    tokenData.access_token.length < 8
  ) {
    throw new Error(
      "TikTok token file present but has no access_token. Visit /auth/tiktok on the server to re-auth." +
        (tokenData.error ? ` (previous error: ${tokenData.error})` : ""),
    );
  }

  // `expires_at` can be missing on tokens written by older code paths
  // (before the 2026-04-19 sandbox fix) OR corrupt (NaN serialised as
  // null by JSON.stringify). Coerce defensively and treat non-finite
  // values as "missing — try to self-heal".
  const expiresAt = Number(tokenData.expires_at);
  const hasValidExpiry = Number.isFinite(expiresAt);
  const isExpiring = hasValidExpiry && Date.now() > expiresAt - 60000;
  const needsHeal = !hasValidExpiry;

  if (needsHeal || isExpiring) {
    if (!tokenData.refresh_token) {
      // No refresh token on disk AND either expired or missing
      // expires_at. Nothing we can do from here — the operator must
      // complete /auth/tiktok. Previous code silently returned the
      // (likely stale) access_token in this path; that produced
      // false "heal_attempted: true" + "publish failed later" signals
      // in production. Fail loudly instead so upstream callers (the
      // proactive auth-check job, /api/platforms/status?heal=true)
      // can surface the real state.
      throw new Error(
        "TikTok token cannot self-heal — no refresh_token on disk. Visit /auth/tiktok on the server to re-auth.",
      );
    }
    console.log(
      needsHeal
        ? "[tiktok] Token file missing/invalid expires_at; refreshing to repair..."
        : "[tiktok] Refreshing expired token...",
    );
    // Propagate refresh failure honestly. The previous silent-swallow
    // for legacy tokens hid revoked/expired refresh_tokens behind a
    // "heal_attempted: true" lie — see the 2026-04-20 incident where
    // the heal returned success but the token was garbage.
    const refreshed = await refreshToken(tokenData.refresh_token);
    return refreshed.access_token;
  }

  return tokenData.access_token;
}

async function refreshToken(refreshToken) {
  // TikTok v2 /oauth/token/ REQUIRES `application/x-www-form-urlencoded`
  // per their API docs; any JSON-body POST comes back with a 200 OK that
  // carries `{error:"invalid_request", error_description:"Only
  // \`application/x-www-form-urlencoded\` is accepted as Content-Type."}`.
  // Axios defaults to JSON for a plain object, so we build a
  // URLSearchParams body explicitly and assert the response is a real
  // token before touching disk.
  const body = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY || "",
    client_secret: process.env.TIKTOK_CLIENT_SECRET || "",
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await axios.post(
    "https://open.tiktokapis.com/v2/oauth/token/",
    body.toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    },
  );

  assertTokenResponse(response.data, "refresh");

  const tokenData = buildTokenRecord(response.data);
  const tokenPath = resolveTokenPath();
  await fs.ensureDir(path.dirname(tokenPath));
  await fs.writeJson(tokenPath, tokenData, { spaces: 2 });
  return tokenData;
}

// --- Reject error-shaped OAuth responses before they ever hit disk ----
// TikTok returns HTTP 200 on token-exchange/refresh errors and signals
// failure in the body (`{error, error_description, log_id}`). Without an
// explicit check, buildTokenRecord would happily spread the error keys
// into a fake "token record" with a default expires_at, which is how
// the /data file ended up holding {error:"invalid_request", ...}.
// `flavor` tags the error so the callback page / heal log distinguishes
// code-exchange failures from refresh failures.
function assertTokenResponse(data, flavor) {
  if (!data || typeof data !== "object") {
    throw new Error(
      `TikTok ${flavor} response had no JSON body — cannot save token.`,
    );
  }
  if (data.error) {
    // error_description is human-readable, safe to surface. We
    // deliberately do NOT include `data` itself in the thrown error so
    // no token-shaped field can leak if TikTok ever returns a mixed
    // body.
    const desc = data.error_description || "(no description)";
    throw new Error(`TikTok ${flavor} rejected: ${data.error} — ${desc}`);
  }
  if (typeof data.access_token !== "string" || data.access_token.length < 8) {
    throw new Error(
      `TikTok ${flavor} response missing access_token — refusing to save.`,
    );
  }
}

// --- Build the TikTok OAuth authorise URL ---
// Pure helper so the server's GET /auth/tiktok initiator and the CLI
// `node upload_tiktok.js auth` path share one source of truth.
//
// `state` is optional because the CLI flow is local-dev only (no
// browser in the loop, no CSRF surface). The server initiator passes
// a state minted by lib/oauth-state.js; omitting it keeps the CLI
// path working unchanged.
function resolveRedirectUri(redirectUri) {
  return (
    redirectUri ||
    process.env.TIKTOK_REDIRECT_URI ||
    `${getPublicUrl()}/auth/tiktok/callback`
  );
}

function isLoopbackRedirectUri(redirectUri) {
  try {
    const parsed = new URL(redirectUri);
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      ["localhost", "127.0.0.1"].includes(parsed.hostname) &&
      parsed.port.length > 0
    );
  } catch {
    return false;
  }
}

function generatePkceVerifier() {
  // 48 random bytes -> 64 base64url chars. TikTok accepts OAuth
  // unreserved characters with a verifier length of 43-128 chars.
  return crypto.randomBytes(48).toString("base64url");
}

function buildPkceChallenge(codeVerifier) {
  if (typeof codeVerifier !== "string" || codeVerifier.length < 43) {
    throw new Error("TikTok PKCE code verifier must be at least 43 characters");
  }
  // TikTok's Desktop Login Kit docs specify hex-encoded SHA256 here
  // rather than the RFC 7636 base64url form used by many providers.
  return crypto.createHash("sha256").update(codeVerifier).digest("hex");
}

function buildAuthorizeUrl({ state, codeChallenge, redirectUri } = {}) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  if (!clientKey) {
    throw new Error("TIKTOK_CLIENT_KEY not set");
  }
  const resolvedRedirectUri = resolveRedirectUri(redirectUri);
  const scope = "user.info.basic,video.publish,video.upload";
  const params = {
    client_key: clientKey,
    scope,
    response_type: "code",
    redirect_uri: resolvedRedirectUri,
  };
  if (typeof state === "string" && state.length > 0) params.state = state;
  if (typeof codeChallenge === "string" && codeChallenge.length > 0) {
    params.code_challenge = codeChallenge;
    params.code_challenge_method = "S256";
  }
  const qs = new URLSearchParams(params);
  return `https://www.tiktok.com/v2/auth/authorize/?${qs.toString()}`;
}

// --- Generate auth URL (CLI use) ---
function generateAuthUrl() {
  try {
    const url = buildAuthorizeUrl();
    console.log("[tiktok] Visit this URL to authorise:");
    console.log(url);
    console.log("\nThen run: node upload_tiktok.js token YOUR_CODE");
  } catch (err) {
    console.log(`[tiktok] ${err.message}`);
  }
}

// --- Exchange code for token ---
async function exchangeCode(code, opts = {}) {
  // See refreshToken() for why this MUST be form-urlencoded. Sending JSON
  // made TikTok return a 200 + `{error:"invalid_request"}` body which we
  // then saved to /data/tokens/tiktok_token.json as a fake token — that's
  // the bug this fix addresses.
  const body = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY || "",
    client_secret: process.env.TIKTOK_CLIENT_SECRET || "",
    code: code || "",
    grant_type: "authorization_code",
    redirect_uri: resolveRedirectUri(opts.redirectUri),
  });
  if (typeof opts.codeVerifier === "string" && opts.codeVerifier.length > 0) {
    body.set("code_verifier", opts.codeVerifier);
  }
  const response = await axios.post(
    "https://open.tiktokapis.com/v2/oauth/token/",
    body.toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    },
  );

  assertTokenResponse(response.data, "code exchange");

  const tokenData = buildTokenRecord(response.data);
  const tokenPath = resolveTokenPath();
  await fs.ensureDir(path.dirname(tokenPath));
  await fs.writeJson(tokenPath, tokenData, { spaces: 2 });
  console.log(`[tiktok] Token saved to ${tokenPath}`);
  return tokenData;
}

function buildInboxUploadInitRequest({
  videoSize,
  chunkSize = videoSize,
  totalChunkCount = 1,
} = {}) {
  const size = Number(videoSize);
  const chunk = Number(chunkSize);
  const chunks = Number(totalChunkCount);
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("TikTok inbox upload requires a positive videoSize");
  }
  if (!Number.isFinite(chunk) || chunk <= 0) {
    throw new Error("TikTok inbox upload requires a positive chunkSize");
  }
  if (!Number.isFinite(chunks) || chunks <= 0) {
    throw new Error("TikTok inbox upload requires a positive totalChunkCount");
  }
  return {
    url: "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/",
    body: {
      source_info: {
        source: "FILE_UPLOAD",
        video_size: size,
        chunk_size: chunk,
        total_chunk_count: chunks,
      },
    },
    safety: {
      publicAutoPublish: false,
      requiresManualCompletion: true,
    },
  };
}

async function uploadVideoToInbox(story) {
  assertTikTokOperatorEnabled();
  addBreadcrumb(`TikTok inbox upload: ${story.title}`, "upload");
  return withRetry(
    async () => {
      const accessToken = await getAccessToken();
      const exportedAbs =
        (await mediaPaths.resolveExisting(story.exported_path)) ||
        story.exported_path;
      await validateVideo(exportedAbs, "tiktok");
      await assertPlatformVideoQaPass(exportedAbs, { platform: "tiktok" });

      const fileSize = (await fs.stat(exportedAbs)).size;
      const init = buildInboxUploadInitRequest({
        videoSize: fileSize,
        chunkSize: fileSize,
        totalChunkCount: 1,
      });
      const initResponse = await axios.post(init.url, init.body, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      });

      const { publish_id, upload_url } = initResponse.data.data || {};
      if (!publish_id || !upload_url) {
        throw new Error(
          `TikTok inbox init returned incomplete data: publish_id=${publish_id || "missing"} upload_url=${upload_url ? "present" : "missing"}`,
        );
      }

      const videoBuffer = await fs.readFile(exportedAbs);
      await axios.put(upload_url, videoBuffer, {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": fileSize,
          "Content-Range": `bytes 0-${fileSize - 1}/${fileSize}`,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      return {
        platform: "tiktok_inbox",
        publishId: publish_id,
        status: "SEND_TO_USER_INBOX",
        requiresManualCompletion: true,
      };
    },
    { label: "tiktok inbox upload" },
  );
}

function buildPublishStatusFetchRequest(publishId) {
  if (!publishId) {
    throw new Error("TikTok publish status fetch requires publishId");
  }
  return {
    url: "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
    body: { publish_id: publishId },
    safety: {
      publicAutoPublish: false,
      requiresManualCompletion: true,
      printsToken: false,
    },
  };
}

async function fetchPublishStatus(publishId, { accessToken = null } = {}) {
  const token = accessToken || (await getAccessToken());
  const req = buildPublishStatusFetchRequest(publishId);
  const response = await axios.post(req.url, req.body, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
  });
  const error = response.data?.error || {};
  const data = response.data?.data || {};
  return {
    ok: error.code === "ok" || response.status === 200,
    status: data.status || null,
    raw_error_code: error.code || null,
    raw_error_message: error.message || null,
  };
}

// --- Upload video to TikTok ---
async function uploadVideo(story) {
  assertTikTokOperatorEnabled();
  addBreadcrumb(`TikTok upload: ${story.title}`, "upload");
  return withRetry(
    async () => {
      const accessToken = await getAccessToken();

      // Resolve MP4 via media-paths so TikTok reads from MEDIA_ROOT
      // (persistent) when set, falling back to the repo-root
      // `output/...` location for legacy rows.
      const exportedAbs =
        (await mediaPaths.resolveExisting(story.exported_path)) ||
        story.exported_path;
      await validateVideo(exportedAbs, "tiktok");
      await assertPlatformVideoQaPass(exportedAbs, { platform: "tiktok" });

      const fileSize = (await fs.stat(exportedAbs)).size;

      // Build caption (TikTok max 2200 chars) - channel-aware hashtags
      const { getChannel } = require("./channels");
      const channel = getChannel();
      let caption =
        story.suggested_title || story.suggested_thumbnail_text || story.title;
      if (caption.length > 100) caption = caption.substring(0, 97) + "...";
      const tags = (channel.hashtags || []).join(" ") + " #viral #fyp";
      caption += " " + tags;

      console.log(`[tiktok] Uploading: "${caption.substring(0, 60)}..."`);

      // Step 1: Init upload
      const initResponse = await axios.post(
        "https://open.tiktokapis.com/v2/post/publish/video/init/",
        {
          post_info: {
            title: caption,
            privacy_level: (() => {
              const lvl = resolveTikTokPrivacyLevel();
              if (lvl !== TIKTOK_DEFAULT_PRIVACY_LEVEL) {
                console.log(
                  `[tiktok] privacy_level override active: ${lvl} ` +
                    `(TIKTOK_PRIVACY_LEVEL env var). Default would be ${TIKTOK_DEFAULT_PRIVACY_LEVEL}.`,
                );
              }
              return lvl;
            })(),
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
          },
          source_info: {
            source: "FILE_UPLOAD",
            video_size: fileSize,
            chunk_size: fileSize,
            total_chunk_count: 1,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json; charset=UTF-8",
          },
        },
      );

      const { publish_id, upload_url } = initResponse.data.data;

      // Step 2: Upload video file
      const videoBuffer = await fs.readFile(exportedAbs);
      await axios.put(upload_url, videoBuffer, {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": fileSize,
          "Content-Range": `bytes 0-${fileSize - 1}/${fileSize}`,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      console.log(`[tiktok] Upload complete. Publish ID: ${publish_id}`);

      // Step 3: Check publish status (TikTok processes async)
      let status = "PROCESSING";
      let attempts = 0;

      while (status === "PROCESSING" && attempts < 30) {
        await new Promise((r) => setTimeout(r, 10000));
        attempts++;

        try {
          const statusResponse = await axios.post(
            "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
            { publish_id },
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
            },
          );

          status = statusResponse.data.data?.status || "UNKNOWN";
          console.log(`[tiktok] Status check ${attempts}: ${status}`);
        } catch (err) {
          console.log(`[tiktok] Status check failed: ${err.message}`);
        }
      }

      if (status === "PROCESSING") {
        console.warn(
          `[tiktok] Video still processing after ${attempts} checks - will be available later`,
        );
        // Don't throw - TikTok is slow. Return partial success.
      }
      if (status === "FAILED") {
        throw new Error(`TikTok publishing failed. Publish ID: ${publish_id}`);
      }

      return {
        platform: "tiktok",
        publishId: publish_id,
        status,
      };
    },
    { label: "tiktok upload" },
  );
}

// --- Batch upload all ready stories ---
async function uploadAll() {
  if (isTikTokOperatorDisabled()) {
    console.log("[tiktok] Upload skipped: operator disabled");
    return [];
  }

  const stories = await db.getStories();
  if (!stories.length) {
    console.log("[tiktok] No stories found");
    return [];
  }

  const ready = stories.filter((s) =>
    storyIsBatchUploadCandidate(s, "tiktok_post_id"),
  );

  console.log(`[tiktok] ${ready.length} videos ready for upload`);

  const results = [];

  for (const story of ready) {
    try {
      await assertBatchUploadPreflight(story, { platform: "tiktok" });
      const result = await uploadVideo(story);
      story.tiktok_post_id = result.publishId;
      story.tiktok_status = result.status;
      results.push(result);

      // Rate limiting
      await new Promise((r) => setTimeout(r, 3000));
    } catch (err) {
      captureException(err, { platform: "tiktok", storyId: story.id });
      console.log(`[tiktok] Upload failed for ${story.id}: ${err.message}`);
      story.tiktok_error = err.message;
    }
  }

  await db.saveStories(stories);
  console.log(`[tiktok] ${results.length} videos uploaded`);
  return results;
}

// Alias for publisher.js compatibility
async function uploadShort(story) {
  return uploadVideo(story);
}

module.exports = {
  uploadVideo,
  uploadVideoToInbox,
  uploadShort,
  uploadAll,
  isTikTokOperatorDisabled,
  generateAuthUrl,
  buildAuthorizeUrl,
  resolveRedirectUri,
  isLoopbackRedirectUri,
  generatePkceVerifier,
  buildPkceChallenge,
  exchangeCode,
  // Exported so server.js's `/api/platforms/status?heal=true` route can
  // invoke the self-heal path in getAccessToken(). Missing from this
  // list since commit 4e08301 which added the route but not the export,
  // which is why every heal attempt returned `getAccessToken is not a
  // function` instead of repairing legacy tokens.
  getAccessToken,
  inspectTokenStatus,
  refreshToken,
  resolveTokenPath,
  coerceExpiresIn,
  buildTokenRecord,
  assertTokenResponse,
  buildInboxUploadInitRequest,
  buildPublishStatusFetchRequest,
  fetchPublishStatus,
  DEFAULT_EXPIRES_IN_SECONDS,
  // Privacy-level resolver + constants — exported for tests and
  // for any operator tooling that wants to read the live effective
  // value without re-implementing the env-var contract.
  resolveTikTokPrivacyLevel,
  TIKTOK_ALLOWED_PRIVACY_LEVELS,
  TIKTOK_DEFAULT_PRIVACY_LEVEL,
};

if (require.main === module) {
  const cmd = process.argv[2];

  if (cmd === "auth") {
    generateAuthUrl();
  } else if (cmd === "token") {
    const code = process.argv[3];
    if (!code) {
      console.log("Usage: node upload_tiktok.js token YOUR_CODE");
      process.exit(1);
    }
    exchangeCode(code).catch(console.error);
  } else {
    uploadAll().catch((err) => {
      console.log(`[tiktok] ERROR: ${err.message}`);
      process.exit(1);
    });
  }
}

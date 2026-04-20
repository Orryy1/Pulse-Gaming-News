const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const dotenv = require("dotenv");
const { withRetry } = require("./lib/retry");
const { addBreadcrumb, captureException } = require("./lib/sentry");
const { validateVideo } = require("./lib/validate");
const db = require("./lib/db");

dotenv.config({ override: true });

const DEFAULT_TOKEN_PATH = path.join(__dirname, "tokens", "tiktok_token.json");

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

  if ((needsHeal || isExpiring) && tokenData.refresh_token) {
    console.log(
      needsHeal
        ? "[tiktok] Token file missing/invalid expires_at; refreshing to repair..."
        : "[tiktok] Refreshing expired token...",
    );
    try {
      const refreshed = await refreshToken(tokenData.refresh_token);
      return refreshed.access_token;
    } catch (err) {
      // Real expiry with a failed refresh is unrecoverable — surface it.
      if (!needsHeal) throw err;
      // Legacy-token repair failed; best-effort return the stored
      // access_token. Publishing will either succeed (if TikTok still
      // honours the old token) or fail with a clear auth error.
      console.log(
        `[tiktok] Self-heal refresh failed (${err.message}); using stored access_token as-is.`,
      );
    }
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
function buildAuthorizeUrl() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  if (!clientKey) {
    throw new Error("TIKTOK_CLIENT_KEY not set");
  }
  const redirectUri =
    process.env.TIKTOK_REDIRECT_URI ||
    "https://marvelous-curiosity-production.up.railway.app/auth/tiktok/callback";
  const scope = "user.info.basic,video.publish,video.upload";
  const qs = new URLSearchParams({
    client_key: clientKey,
    scope,
    response_type: "code",
    redirect_uri: redirectUri,
  });
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
async function exchangeCode(code) {
  // See refreshToken() for why this MUST be form-urlencoded. Sending JSON
  // made TikTok return a 200 + `{error:"invalid_request"}` body which we
  // then saved to /data/tokens/tiktok_token.json as a fake token — that's
  // the bug this fix addresses.
  const body = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY || "",
    client_secret: process.env.TIKTOK_CLIENT_SECRET || "",
    code: code || "",
    grant_type: "authorization_code",
    redirect_uri:
      process.env.TIKTOK_REDIRECT_URI ||
      "https://marvelous-curiosity-production.up.railway.app/auth/tiktok/callback",
  });
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

// --- Upload video to TikTok ---
async function uploadVideo(story) {
  addBreadcrumb(`TikTok upload: ${story.title}`, "upload");
  return withRetry(
    async () => {
      const accessToken = await getAccessToken();

      await validateVideo(story.exported_path, "tiktok");

      const fileSize = (await fs.stat(story.exported_path)).size;

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
            privacy_level: "PUBLIC_TO_EVERYONE",
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
      const videoBuffer = await fs.readFile(story.exported_path);
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
  const stories = await db.getStories();
  if (!stories.length) {
    console.log("[tiktok] No stories found");
    return [];
  }

  const ready = stories.filter(
    (s) => s.approved && s.exported_path && !s.tiktok_post_id,
  );

  console.log(`[tiktok] ${ready.length} videos ready for upload`);

  const results = [];

  for (const story of ready) {
    try {
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
  uploadShort,
  uploadAll,
  generateAuthUrl,
  buildAuthorizeUrl,
  exchangeCode,
  // Exported so server.js's `/api/platforms/status?heal=true` route can
  // invoke the self-heal path in getAccessToken(). Missing from this
  // list since commit 4e08301 which added the route but not the export,
  // which is why every heal attempt returned `getAccessToken is not a
  // function` instead of repairing legacy tokens.
  getAccessToken,
  resolveTokenPath,
  coerceExpiresIn,
  buildTokenRecord,
  assertTokenResponse,
  DEFAULT_EXPIRES_IN_SECONDS,
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

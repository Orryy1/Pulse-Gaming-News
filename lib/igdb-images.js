"use strict";

/**
 * lib/igdb-images.js — IGDB cover + screenshot fetcher.
 *
 * fetch_broll.js already uses IGDB for video b-roll. That side covers
 * trailer/reveal clips, but says nothing about still images. The
 * production image pipeline (images_download.js) only had Steam as the
 * gaming-image source, so when Steam missed (PS/Xbox exclusives, mobile,
 * indie, retro) and the article scrape was paywalled, we fell straight
 * through to Pexels / Unsplash stock — which produced thin-visual
 * composite-only renders for any RSS story whose game wasn't on Steam.
 *
 * This module fills that hole. It hits IGDB's /games endpoint with a
 * search-then-fetch dance to pull the cover_big and screenshot_big image
 * URLs for the top match.
 *
 * Behaviour:
 *   - Returns [] when TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET are unset
 *     (graceful no-op for ops that haven't provisioned IGDB yet).
 *   - Returns [] when no game matches the title.
 *   - Returns up to 1 cover + N screenshots, in priority order.
 *
 * URLs are returned for the caller to download via the existing
 * downloadImage() helper in images_download.js — keeping all SSRF +
 * caching logic in one place.
 *
 * Token lifecycle is shared with fetch_broll.js to avoid two parallel
 * Twitch token caches.
 */

const axios = require("axios");

const IGDB_GAMES_URL = "https://api.igdb.com/v4/games";
const IGDB_COVERS_URL = "https://api.igdb.com/v4/covers";
const IGDB_SCREENSHOTS_URL = "https://api.igdb.com/v4/screenshots";

// IGDB's image CDN serves multiple sizes via path-segment swap.
// t_cover_big = 264x374, t_screenshot_big = 889x500. For YouTube Shorts
// (1080x1920 portrait) we want the largest sizes available. Use
// t_1080p for screenshots and t_cover_big_2x for cover where supported.
const COVER_SIZE = "t_cover_big_2x";
const SCREENSHOT_SIZE = "t_1080p";

const MAX_SCREENSHOTS_DEFAULT = 4;

/**
 * Build a Twitch app token. Returns null when env vars are missing or
 * the request fails. Cached in-process for the token's TTL.
 *
 * Caller passes a tokenStore so unit tests can inject a fresh state per
 * test instead of relying on module-level mutable state.
 */
async function getIgdbAccessToken({
  http = axios,
  env = process.env,
  tokenStore = getIgdbAccessToken._defaultStore,
} = {}) {
  const cid = env.TWITCH_CLIENT_ID;
  const secret = env.TWITCH_CLIENT_SECRET;
  if (!cid || !secret) return null;
  if (tokenStore.token && Date.now() < tokenStore.expiresAt) {
    return tokenStore.token;
  }
  try {
    const resp = await http.post(
      `https://id.twitch.tv/oauth2/token?client_id=${cid}&client_secret=${secret}&grant_type=client_credentials`,
      null,
      { timeout: 8000 },
    );
    tokenStore.token = resp.data && resp.data.access_token;
    const ttl = (resp.data && resp.data.expires_in) || 3600;
    tokenStore.expiresAt = Date.now() + (ttl - 60) * 1000;
    return tokenStore.token;
  } catch {
    return null;
  }
}
getIgdbAccessToken._defaultStore = { token: null, expiresAt: 0 };

/**
 * Build the public IGDB image URL given an image id and a size key.
 * IGDB serves images at:
 *   https://images.igdb.com/igdb/image/upload/{size}/{image_id}.jpg
 */
function buildImageUrl(imageId, size) {
  if (!imageId) return null;
  return `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`;
}

/**
 * Search IGDB for the supplied game title. Returns the top match's
 * record with `cover` (id) and `screenshots` (id[]) populated, or null
 * if nothing matches.
 *
 * Exported for unit tests.
 */
async function searchGame({ gameTitle, token, clientId, http = axios }) {
  if (!gameTitle) return null;
  const safe = String(gameTitle).replace(/"/g, "");
  // `search` returns relevance-ranked. Limit 3 so we can fall through
  // to candidate #2 if the top match has no cover/screenshots.
  const body = `search "${safe}"; fields id,name,cover,screenshots; limit 3;`;
  let res;
  try {
    res = await http.post(IGDB_GAMES_URL, body, {
      headers: {
        "Client-ID": clientId,
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
      },
      timeout: 8000,
    });
  } catch {
    return null;
  }
  const games = (res && res.data) || [];
  // Prefer a result that actually has imagery. A game record without
  // a cover or screenshots is useless to the caller.
  const withImages = games.find(
    (g) =>
      g &&
      ((g.cover && Number.isFinite(g.cover)) ||
        (Array.isArray(g.screenshots) && g.screenshots.length > 0)),
  );
  return withImages || games[0] || null;
}

/**
 * Fetch the image_id for a given cover-id. Returns null if the lookup
 * fails or returns nothing.
 */
async function fetchCoverImageId({ coverId, token, clientId, http = axios }) {
  if (!coverId) return null;
  const body = `fields image_id; where id = ${coverId}; limit 1;`;
  try {
    const res = await http.post(IGDB_COVERS_URL, body, {
      headers: {
        "Client-ID": clientId,
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
      },
      timeout: 8000,
    });
    const row = (res && res.data && res.data[0]) || null;
    return row ? row.image_id : null;
  } catch {
    return null;
  }
}

/**
 * Fetch image_ids for a list of screenshot ids.
 */
async function fetchScreenshotImageIds({
  screenshotIds,
  token,
  clientId,
  http = axios,
  max = MAX_SCREENSHOTS_DEFAULT,
}) {
  if (!Array.isArray(screenshotIds) || screenshotIds.length === 0) return [];
  const ids = screenshotIds.slice(0, max).join(",");
  const body = `fields image_id; where id = (${ids}); limit ${max};`;
  try {
    const res = await http.post(IGDB_SCREENSHOTS_URL, body, {
      headers: {
        "Client-ID": clientId,
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
      },
      timeout: 8000,
    });
    const rows = (res && res.data) || [];
    return rows.map((r) => r && r.image_id).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Top-level: fetch IGDB cover + screenshots for the supplied game
 * title. Returns an array of `{ url, type, source: "igdb", game_name }`,
 * cover first then screenshots, capped at `max` total entries.
 *
 * Returns [] when:
 *   - TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET unset
 *   - token request fails
 *   - search returns no match
 *   - the matched game has no cover and no screenshots
 *
 * No throws — every error path returns [].
 */
async function fetchIgdbImages(
  gameTitle,
  { http = axios, env = process.env, max = 5, tokenStore } = {},
) {
  if (!gameTitle || typeof gameTitle !== "string") return [];
  const clientId = env.TWITCH_CLIENT_ID;
  if (!clientId) return [];

  const token = await getIgdbAccessToken({ http, env, tokenStore });
  if (!token) return [];

  const game = await searchGame({ gameTitle, token, clientId, http });
  if (!game) return [];

  const out = [];

  // Cover first — it's the strongest single visual for a thumbnail.
  if (game.cover) {
    const imageId = await fetchCoverImageId({
      coverId: game.cover,
      token,
      clientId,
      http,
    });
    const url = buildImageUrl(imageId, COVER_SIZE);
    if (url) {
      out.push({
        url,
        type: "key_art",
        source: "igdb",
        game_name: game.name || null,
      });
    }
  }

  if (out.length < max && Array.isArray(game.screenshots)) {
    const imageIds = await fetchScreenshotImageIds({
      screenshotIds: game.screenshots,
      token,
      clientId,
      http,
      max: max - out.length,
    });
    for (const id of imageIds) {
      const url = buildImageUrl(id, SCREENSHOT_SIZE);
      if (url) {
        out.push({
          url,
          type: "screenshot",
          source: "igdb",
          game_name: game.name || null,
        });
      }
      if (out.length >= max) break;
    }
  }

  return out;
}

module.exports = {
  fetchIgdbImages,
  searchGame,
  fetchCoverImageId,
  fetchScreenshotImageIds,
  getIgdbAccessToken,
  buildImageUrl,
  COVER_SIZE,
  SCREENSHOT_SIZE,
};

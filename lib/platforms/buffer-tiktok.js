/**
 * lib/platforms/buffer-tiktok.js — Buffer API → TikTok bypass.
 *
 * The Pulse Gaming TikTok app is currently blocked at the
 * `unaudited_client_can_only_post_to_private_accounts` policy — every
 * `PUBLIC_TO_EVERYONE` init returns 403. Until TikTok's audit clears,
 * `upload_tiktok.js` cannot post live content.
 *
 * Buffer (https://buffer.com) is a third-party service that has
 * COMPLETED TikTok's audit and can post to TikTok on your behalf via
 * their own API. This module is the integration scaffold:
 *
 *   1. Authenticates with Buffer via a personal access token
 *   2. Discovers your linked TikTok profile id
 *   3. Schedules a post (queued for "now") with the rendered MP4 +
 *      caption + hashtags from the SEO package
 *   4. Returns the Buffer update id so the publisher can record it
 *
 * Env contract:
 *   BUFFER_ACCESS_TOKEN   — required to activate (a personal access
 *                           token from buffer.com → settings → access
 *                           tokens)
 *   BUFFER_TIKTOK_PROFILE_ID — optional override; if absent, the
 *                              first TikTok-platform profile is used
 *   USE_BUFFER_TIKTOK=true — explicit gate. Without this, the
 *                            publisher does NOT route to Buffer even
 *                            if a token is present.
 *
 * Safety:
 *   - Reads BUFFER_ACCESS_TOKEN as bearer; never logs it
 *   - On any 4xx/5xx, reports the failure and surfaces the upstream
 *     error code/message — does NOT retry, does NOT loop
 *   - When the gate is OFF, every function in this module
 *     short-circuits to a "not enabled" return so importing it has
 *     no side effects
 *
 * Buffer API reference (v1, the public stable version):
 *   - Profiles:  GET  https://api.bufferapp.com/1/profiles.json
 *   - Updates:   POST https://api.bufferapp.com/1/updates/create.json
 *   - Upload:    POST https://api.bufferapp.com/1/updates/upload.json
 *
 * v2 (newer GraphQL) is in beta but rate-limits change frequently;
 * v1 REST is sufficient for queue posting.
 */

"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const BUFFER_API_BASE = "https://api.bufferapp.com/1";

function isEnabled() {
  return (
    process.env.USE_BUFFER_TIKTOK === "true" &&
    typeof process.env.BUFFER_ACCESS_TOKEN === "string" &&
    process.env.BUFFER_ACCESS_TOKEN.length > 0
  );
}

function authHeader() {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) throw new Error("BUFFER_ACCESS_TOKEN not set");
  return { Authorization: `Bearer ${token}` };
}

/**
 * Discover the linked TikTok profile id. Returns null if the account
 * has no TikTok profile or if BUFFER_TIKTOK_PROFILE_ID is set as
 * override (returns the override directly without an API round-trip).
 */
async function discoverTiktokProfileId() {
  const override = process.env.BUFFER_TIKTOK_PROFILE_ID;
  if (override) return override;
  const res = await fetch(`${BUFFER_API_BASE}/profiles.json`, {
    headers: authHeader(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Buffer profiles fetch failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }
  const profiles = await res.json();
  // Each profile has { id, service: "tiktok" | "twitter" | ... }
  const tiktok = (Array.isArray(profiles) ? profiles : []).find(
    (p) => String(p.service || "").toLowerCase() === "tiktok",
  );
  return tiktok ? tiktok.id : null;
}

/**
 * Upload a video file to Buffer's media store. Returns the upload
 * descriptor Buffer expects when creating an update. Buffer's
 * /updates/upload.json takes multipart/form-data with the binary.
 */
async function uploadVideoToBuffer({ filePath, profileId }) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Buffer upload: file does not exist: ${filePath}`);
  }
  const stat = await fs.stat(filePath);
  if (stat.size > 287_000_000) {
    // Buffer's TikTok limit is 287MB. Refuse before sending.
    throw new Error(
      `Buffer upload: file size ${Math.round(stat.size / 1024 / 1024)}MB exceeds TikTok 287MB ceiling`,
    );
  }
  const buffer = await fs.readFile(filePath);
  // Use the modern undici-style FormData (built into node 22).
  const form = new FormData();
  form.append("profile_id", profileId);
  form.append(
    "video",
    new Blob([buffer], { type: "video/mp4" }),
    path.basename(filePath),
  );
  const res = await fetch(`${BUFFER_API_BASE}/updates/upload.json`, {
    method: "POST",
    headers: authHeader(),
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Buffer video upload failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }
  return res.json(); // { upload_id, video_url, ... }
}

/**
 * Schedule a TikTok post via Buffer.
 *
 * @param {object} args
 * @param {string} args.videoPath   — local MP4 path
 * @param {string} args.caption     — TikTok caption (≤ 2200 chars
 *                                    safe; Buffer enforces TikTok's
 *                                    own limits)
 * @param {string[]} args.hashtags  — array of hashtags including #
 * @param {string} [args.scheduledAt] — ISO timestamp; if absent,
 *                                       Buffer queues for "now" and
 *                                       posts at the next scheduled
 *                                       slot
 * @returns {Promise<object>} { ok: true, updateId, profileId, queuedAt }
 */
async function publishToTiktokViaBuffer({
  videoPath,
  caption,
  hashtags = [],
  scheduledAt,
}) {
  if (!isEnabled()) {
    return {
      ok: false,
      reason: "not-enabled",
      note: "Set USE_BUFFER_TIKTOK=true and BUFFER_ACCESS_TOKEN to activate",
    };
  }

  const profileId = await discoverTiktokProfileId();
  if (!profileId) {
    return {
      ok: false,
      reason: "no-tiktok-profile",
      note: "Buffer account has no TikTok profile linked. Add at buffer.com → connect channel.",
    };
  }

  // Upload binary first
  const upload = await uploadVideoToBuffer({ filePath: videoPath, profileId });
  const uploadId = upload.upload_id || upload.id;
  if (!uploadId) {
    return {
      ok: false,
      reason: "upload-no-id",
      raw: upload,
    };
  }

  // Compose the full caption: trim to TikTok's 2200 char ceiling
  const fullCaption = [caption, hashtags.join(" ")]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2197)
    .replace(/\s+$/, "");

  const params = new URLSearchParams();
  params.set("profile_ids[]", profileId);
  params.set("text", fullCaption);
  params.set("media[upload_id]", uploadId);
  if (scheduledAt) {
    // Buffer expects unix epoch seconds for scheduled_at
    const epoch = Math.floor(new Date(scheduledAt).getTime() / 1000);
    if (Number.isFinite(epoch)) params.set("scheduled_at", String(epoch));
  } else {
    params.set("now", "true");
  }
  // shorten=false: keep our affiliate links intact (we already track
  // them via Amazon's tag — Buffer's shortener would replace them).
  params.set("shorten", "false");

  const res = await fetch(`${BUFFER_API_BASE}/updates/create.json`, {
    method: "POST",
    headers: {
      ...authHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Buffer create-update failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }
  const data = await res.json();
  const updateId =
    Array.isArray(data.updates) && data.updates[0]
      ? data.updates[0].id
      : data.id;
  return {
    ok: true,
    updateId,
    profileId,
    queuedAt: new Date().toISOString(),
    via: "buffer",
  };
}

module.exports = {
  isEnabled,
  discoverTiktokProfileId,
  publishToTiktokViaBuffer,
};

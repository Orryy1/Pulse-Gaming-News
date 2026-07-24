/*
  X/Twitter Video Upload via API v2

  Setup:
  1. Create a project + app in the X Developer Console
  2. Add prepaid pay-per-use API credits
  3. Enable OAuth 1.0a User Context with Read and Write permission
  4. Generate an Access Token and Secret, then set:
             TWITTER_API_KEY, TWITTER_API_SECRET,
             TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET

  Video upload and Post creation both use the current X API v2 endpoints.
*/

const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const dotenv = require("dotenv");
const { withRetry } = require("./lib/retry");
const { addBreadcrumb, captureException } = require("./lib/sentry");
const { validateVideo } = require("./lib/validate");
const db = require("./lib/db");
const mediaPaths = require("./lib/media-paths");
const {
  assertDirectUploadAllowed,
  buildDirectUploadPolicy,
} = require("./lib/services/direct-upload-policy");

dotenv.config({ override: true });

/**
 * Twitter/X is an OPTIONAL publishing channel for Pulse Gaming.
 * X API access is pay-per-usage and requires prepaid API credits, so a
 * billing error is expected when credits are unavailable. This module
 * treats Twitter as disabled unless TWITTER_ENABLED === "true" is set
 * explicitly.
 *
 * When disabled:
 *   - uploadShort + uploadAll short-circuit with a structured
 *     `{ skipped: true, reason: "twitter_disabled" }` result
 *   - no network calls are made (so no 402, no spurious Sentry noise)
 *   - publisher.js routes the skipped result into result.skipped.twitter
 *     rather than result.errors.twitter — the Discord summary then shows
 *     "X ⏸ disabled" instead of "X FAIL".
 */
function twitterEnabled() {
  return (process.env.TWITTER_ENABLED || "").toLowerCase() === "true";
}

// --- OAuth 1.0a signing ---
function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

function generateOAuthSignature(
  method,
  url,
  params,
  consumerSecret,
  tokenSecret,
) {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");
  const baseString = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");
}

function generateOAuthHeader(
  method,
  url,
  extraParams = {},
  env = process.env,
) {
  const apiKey = env.TWITTER_API_KEY;
  const apiSecret = env.TWITTER_API_SECRET;
  const accessToken = env.TWITTER_ACCESS_TOKEN;
  const accessSecret = env.TWITTER_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    throw new Error(
      "Twitter credentials not configured. Set TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET",
    );
  }

  const oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
    ...extraParams,
  };

  const signature = generateOAuthSignature(
    method,
    url,
    oauthParams,
    apiSecret,
    accessSecret,
  );
  oauthParams.oauth_signature = signature;

  const headerParts = Object.keys(oauthParams)
    .filter((k) => k.startsWith("oauth_"))
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");

  return `OAuth ${headerParts}`;
}

function verificationError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.retriable = false;
  err.nonRetriable = true;
  return err;
}

function expectedTwitterUsername(env = process.env) {
  const explicit = String(
    env.X_EXPECTED_USERNAME || env.TWITTER_EXPECTED_USERNAME || "",
  ).trim();
  if (explicit) return explicit.replace(/^@/, "");

  try {
    const { getChannel } = require("./channels");
    const channel = getChannel(env.CHANNEL || "pulse-gaming");
    const socialUrl = new URL(channel?.socials?.twitter || "");
    return decodeURIComponent(
      socialUrl.pathname.split("/").filter(Boolean)[0] || "",
    ).replace(/^@/, "");
  } catch {
    return "";
  }
}

async function verifyPublicPost(
  postId,
  { env = process.env, httpClient = axios } = {},
) {
  const cleanPostId = String(postId || "").trim();
  if (!/^[0-9]{1,19}$/.test(cleanPostId)) {
    throw verificationError(
      "x_public_verification_invalid_post_id",
      "X public verification requires a numeric post ID",
    );
  }

  const expectedUsername = expectedTwitterUsername(env);
  if (!expectedUsername) {
    throw verificationError(
      "x_public_verification_identity_not_configured",
      "X public verification requires X_EXPECTED_USERNAME",
    );
  }

  const meUrl = "https://api.x.com/2/users/me";
  const meParams = { "user.fields": "id,name,username,protected" };
  const meResponse = await httpClient.get(meUrl, {
    params: meParams,
    headers: {
      Authorization: generateOAuthHeader("GET", meUrl, meParams, env),
    },
  });
  const authenticatedUser = meResponse?.data?.data;
  const expectedUserId = String(
    env.X_EXPECTED_USER_ID || env.TWITTER_EXPECTED_USER_ID || "",
  ).trim();
  if (
    !authenticatedUser?.id ||
    String(authenticatedUser.username || "").toLowerCase() !==
      expectedUsername.toLowerCase() ||
    (expectedUserId && String(authenticatedUser.id) !== expectedUserId) ||
    authenticatedUser.protected === true
  ) {
    throw verificationError(
      "x_public_verification_identity_mismatch",
      "Authenticated X account does not match the configured public Pulse Gaming identity",
    );
  }

  const postUrl = `https://api.x.com/2/tweets/${cleanPostId}`;
  const postParams = {
    expansions: "author_id,attachments.media_keys",
    "tweet.fields": "author_id,attachments",
    "user.fields": "id,name,username,protected",
    "media.fields": "media_key,type,duration_ms,preview_image_url",
  };
  const postResponse = await httpClient.get(postUrl, {
    params: postParams,
    headers: {
      Authorization: generateOAuthHeader("GET", postUrl, postParams, env),
    },
  });
  const post = postResponse?.data?.data;
  const mediaKeys = Array.isArray(post?.attachments?.media_keys)
    ? post.attachments.media_keys.map(String)
    : [];
  const media = Array.isArray(postResponse?.data?.includes?.media)
    ? postResponse.data.includes.media
    : [];
  const videoAttached = media.some(
    (item) =>
      mediaKeys.includes(String(item?.media_key || "")) &&
      item?.type === "video",
  );
  if (
    String(post?.id || "") !== cleanPostId ||
    String(post?.author_id || "") !== String(authenticatedUser.id) ||
    !videoAttached
  ) {
    throw verificationError(
      "x_public_verification_post_mismatch",
      "X post lookup did not prove the requested Pulse Gaming video post",
    );
  }

  const publicUrl = `https://x.com/${authenticatedUser.username}/status/${cleanPostId}`;
  const oembedUrl = "https://publish.x.com/oembed";
  const oembedResponse = await httpClient.get(oembedUrl, {
    params: {
      url: publicUrl,
      omit_script: "true",
      dnt: "true",
    },
  });
  const oembed = oembedResponse?.data || {};
  const oembedAuthorUrl = String(oembed.author_url || "").replace(/\/+$/, "");
  const expectedAuthorUrl = `https://x.com/${authenticatedUser.username}`;
  const oembedPostUrl = String(oembed.url || "").replace(/\/+$/, "");
  const exactPostInHtml = new RegExp(
    `/status/${cleanPostId}(?:[^0-9]|$)`,
    "i",
  ).test(String(oembed.html || ""));
  if (
    oembedAuthorUrl.toLowerCase() !== expectedAuthorUrl.toLowerCase() ||
    oembedPostUrl.toLowerCase() !== publicUrl.toLowerCase() ||
    !exactPostInHtml
  ) {
    throw verificationError(
      "x_public_verification_oembed_mismatch",
      "Official X oEmbed did not corroborate the public Pulse Gaming post",
    );
  }

  return {
    postId: cleanPostId,
    url: publicUrl,
    publicVerified: true,
    mediaAttached: true,
  };
}

function assertXApiMediaResponse(response, phase) {
  const errors = Array.isArray(response?.data?.errors)
    ? response.data.errors
    : [];
  if (errors.length > 0) {
    const detail = errors
      .map((item) => item?.detail || item?.title || "unknown X API error")
      .join("; ");
    throw verificationError(
      `x_media_${phase}_rejected`,
      `X v2 media ${phase} rejected: ${detail}`,
    );
  }
  return response?.data?.data || null;
}

// --- Chunked video media upload (X API v2) ---
async function uploadMedia(
  filePath,
  {
    env = process.env,
    httpClient = axios,
    chunkSize = 5 * 1024 * 1024,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    maxStatusPolls = 60,
  } = {},
) {
  const fileSize = (await fs.stat(filePath)).size;
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
    throw verificationError(
      "x_media_invalid_file",
      "X v2 media upload requires a non-empty file",
    );
  }
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw verificationError(
      "x_media_invalid_chunk_size",
      "X v2 media upload requires a positive integer chunk size",
    );
  }
  if (!Number.isSafeInteger(maxStatusPolls) || maxStatusPolls <= 0) {
    throw verificationError(
      "x_media_invalid_poll_limit",
      "X v2 media upload requires a positive integer status-poll limit",
    );
  }

  const initializeUrl = "https://api.x.com/2/media/upload/initialize";
  const initBody = {
    total_bytes: fileSize,
    media_type: "video/mp4",
    media_category: "tweet_video",
  };
  const initResponse = await httpClient.post(initializeUrl, initBody, {
    headers: {
      Authorization: generateOAuthHeader("POST", initializeUrl, {}, env),
      "Content-Type": "application/json",
    },
  });
  const initialized = assertXApiMediaResponse(initResponse, "initialize");
  const mediaId = String(initialized?.id || "").trim();
  if (!/^[0-9]{1,19}$/.test(mediaId)) {
    throw verificationError(
      "x_media_initialize_invalid_id",
      "X v2 media initialize did not return a valid media ID",
    );
  }
  console.log(`[twitter] X v2 media initialize: ${mediaId}`);

  let segmentIndex = 0;
  const appendUrl = `https://api.x.com/2/media/upload/${mediaId}/append`;
  const stream = fs.createReadStream(filePath, { highWaterMark: chunkSize });
  for await (const chunk of stream) {
    if (segmentIndex > 999) {
      throw verificationError(
        "x_media_too_many_segments",
        "X v2 media upload exceeded the 1,000-segment limit",
      );
    }
    const appendResponse = await httpClient.post(
      appendUrl,
      {
        media: chunk.toString("base64"),
        segment_index: segmentIndex,
      },
      {
        headers: {
          Authorization: generateOAuthHeader("POST", appendUrl, {}, env),
          "Content-Type": "application/json",
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      },
    );
    assertXApiMediaResponse(appendResponse, "append");
    segmentIndex += 1;
  }
  if (segmentIndex === 0) {
    throw verificationError(
      "x_media_no_segments",
      "X v2 media upload produced no append segments",
    );
  }
  console.log(`[twitter] X v2 media append: ${segmentIndex} chunks uploaded`);

  const finalizeUrl = `https://api.x.com/2/media/upload/${mediaId}/finalize`;
  const finalizeResponse = await httpClient.post(finalizeUrl, null, {
    headers: {
      Authorization: generateOAuthHeader("POST", finalizeUrl, {}, env),
    },
  });
  const finalized = assertXApiMediaResponse(finalizeResponse, "finalize");
  if (finalized?.id && String(finalized.id) !== mediaId) {
    throw verificationError(
      "x_media_finalize_id_mismatch",
      "X v2 media finalize returned a different media ID",
    );
  }
  let processing = finalized?.processing_info || null;
  let statusPolls = 0;
  const pollableStates = new Set(["pending", "in_progress"]);
  while (processing && processing.state !== "succeeded") {
    if (processing.state === "failed") {
      const failureDetail =
        processing.error?.message ||
        processing.error?.name ||
        "unspecified processing failure";
      throw verificationError(
        "x_media_processing_failed",
        `X v2 media processing failed: ${failureDetail}`,
      );
    }
    if (!pollableStates.has(processing.state)) {
      throw verificationError(
        "x_media_processing_unknown_state",
        `X v2 media processing returned an unknown state: ${processing.state || "missing"}`,
      );
    }
    if (statusPolls >= maxStatusPolls) {
      throw verificationError(
        "x_media_processing_poll_limit",
        `X v2 media processing did not complete after ${maxStatusPolls} status polls`,
      );
    }

    const requestedWait = Number(processing.check_after_secs);
    const waitSeconds = Number.isFinite(requestedWait) && requestedWait > 0
      ? Math.min(60, requestedWait)
      : 5;
    await sleep(waitSeconds * 1000);

    const statusUrl = "https://api.x.com/2/media/upload";
    const statusParams = { command: "STATUS", media_id: mediaId };
    const statusResponse = await httpClient.get(statusUrl, {
      params: statusParams,
      headers: {
        Authorization: generateOAuthHeader(
          "GET",
          statusUrl,
          statusParams,
          env,
        ),
      },
    });
    const status = assertXApiMediaResponse(statusResponse, "status");
    if (status?.id && String(status.id) !== mediaId) {
      throw verificationError(
        "x_media_status_id_mismatch",
        "X v2 media status returned a different media ID",
      );
    }
    processing = status?.processing_info || null;
    statusPolls += 1;
    if (!processing) {
      throw verificationError(
        "x_media_status_missing_processing",
        "X v2 media status omitted processing information before completion",
      );
    }
    console.log(
      `[twitter] X v2 media processing: ${processing.state || "unknown"} (${processing.progress_percent || 0}%)`,
    );
  }
  console.log("[twitter] X v2 media finalize: ready");
  return mediaId;
}

// --- Post tweet with video via v2 ---
async function postTweet(text, mediaId) {
  const TWEET_URL = "https://api.x.com/2/tweets";
  const auth = generateOAuthHeader("POST", TWEET_URL);

  const response = await axios.post(
    TWEET_URL,
    {
      text,
      media: { media_ids: [mediaId] },
    },
    {
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
    },
  );

  return response.data.data;
}

function buildXPostText(
  story = {},
  {
    hashtags = ["#GamingNews", "#GamingLeaks"],
    maxLength = 280,
  } = {},
) {
  const cleanCopy = (value) =>
    String(value || "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/\[[^\]\r\n]{1,80}\]\s*/g, "")
      .trim();
  const base =
    [
      story.platform_caption,
      story.x_post_text,
      story.twitter_post_text,
      story.post_text,
      story.caption,
      story.description,
      story.suggested_title,
      story.suggested_thumbnail_text,
      story.title,
    ]
      .map(cleanCopy)
      .find(Boolean) || "Pulse Gaming update";
  const seen = new Set();
  const candidateHashtags = (Array.isArray(hashtags) ? hashtags : [])
    .map((value) => String(value || "").trim())
    .filter((tag) => {
      if (!/^#[a-z0-9]+$/i.test(tag)) return false;
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const safeMaxLength =
    Number.isSafeInteger(maxLength) && maxLength > 0 ? maxLength : 280;
  const reservedSuffix = candidateHashtags.length
    ? `\n\n${candidateHashtags.join(" ")}`
    : "";
  const bodyBudget = Math.max(0, safeMaxLength - reservedSuffix.length);
  const body =
    base.length > bodyBudget
      ? bodyBudget > 3
        ? `${base.slice(0, bodyBudget - 3).trimEnd()}...`
        : base.slice(0, bodyBudget)
      : base;
  const missingHashtags = candidateHashtags.filter(
    (tag) => !new RegExp(`(^|\\s)${tag}(?=\\s|$)`, "i").test(body),
  );
  const suffix = missingHashtags.length
    ? `\n\n${missingHashtags.join(" ")}`
    : "";
  return `${body}${suffix}`.trim().slice(0, safeMaxLength);
}

// --- Upload a single video to X/Twitter ---
async function uploadShort(story) {
  if (!twitterEnabled()) {
    console.log(
      "[twitter] Skipped: TWITTER_ENABLED != true — X is optional, " +
        "set TWITTER_ENABLED=true only when API billing is active.",
    );
    return { skipped: true, reason: "twitter_disabled", platform: "twitter" };
  }
  addBreadcrumb(`Twitter upload: ${story.title}`, "upload");
  return withRetry(
    async () => {
      // Resolve through media-paths so the MP4 is found under
      // MEDIA_ROOT (persistent) when set, with repo-root fallback.
      const exportedAbs =
        (await mediaPaths.resolveExisting(story.exported_path)) ||
        story.exported_path;
      await validateVideo(exportedAbs, "twitter");

      const finalText = buildXPostText(story);

      console.log(
        `[twitter] Uploading video for: "${finalText.substring(0, 50)}..."`,
      );

      // Upload media
      const mediaId = await uploadMedia(exportedAbs);

      // Post tweet
      const tweet = await postTweet(finalText, mediaId);
      console.log(`[twitter] Tweet posted: ${tweet.id}`);

      return {
        platform: "twitter",
        tweetId: tweet.id,
      };
    },
    { label: "twitter upload" },
  );
}

// --- Batch upload ---
async function uploadAll() {
  if (!twitterEnabled()) {
    console.log(
      "[twitter] Batch skipped: TWITTER_ENABLED != true (optional channel)",
    );
    return [];
  }
  const stories = await db.getStories();
  if (!stories.length) {
    console.log("[twitter] No stories found");
    return [];
  }

  const ready = stories.filter(
    (s) => s.approved && s.exported_path && !s.twitter_post_id,
  );

  console.log(`[twitter] ${ready.length} videos ready for upload`);
  const results = [];

  for (const story of ready) {
    try {
      const result = await uploadShort(story);
      if (result && result.skipped) continue;
      story.twitter_post_id = result.tweetId;
      results.push(result);
      await new Promise((r) => setTimeout(r, 5000));
    } catch (err) {
      captureException(err, { platform: "twitter", storyId: story.id });
      console.log(`[twitter] Upload failed for ${story.id}: ${err.message}`);
      story.twitter_error = err.message;
    }
  }

  await db.saveStories(stories);
  console.log(`[twitter] ${results.length} tweets posted`);
  return results;
}

// --- Upload a story card image as a tweet ---
async function postImageTweet(story) {
  if (!twitterEnabled()) {
    console.log(
      "[twitter] Image tweet skipped: TWITTER_ENABLED != true (optional)",
    );
    return {
      skipped: true,
      reason: "twitter_disabled",
      platform: "twitter_image",
    };
  }
  addBreadcrumb(`Twitter image tweet: ${story.title}`, "upload");
  return withRetry(
    async () => {
      const storyImageAbs = story.story_image_path
        ? await mediaPaths.resolveExisting(story.story_image_path)
        : null;
      if (!storyImageAbs || !(await fs.pathExists(storyImageAbs))) {
        throw new Error("Story image not found on disk");
      }

      // Build tweet text (280 char limit)
      let text =
        story.suggested_title || story.suggested_thumbnail_text || story.title;
      text = text.replace(/\[.*?\]\s*/g, "").trim();

      // Append YouTube link if available
      const link = story.youtube_url || "";
      const hashtags = "#GamingNews #GamingLeaks";

      // Budget characters: text + newlines + link + hashtags
      const maxTextLen =
        280 - 4 - hashtags.length - (link ? link.length + 1 : 0);
      if (text.length > maxTextLen)
        text = text.substring(0, maxTextLen - 3) + "...";

      let tweetText = text + "\n\n" + hashtags;
      if (link) tweetText = text + "\n\n" + link + "\n" + hashtags;

      if (tweetText.length > 280)
        tweetText = tweetText.substring(0, 277) + "...";

      console.log(
        `[twitter] Uploading story image for: "${text.substring(0, 50)}..."`,
      );

      // Upload image via chunked media upload
      const fileSize = (await fs.stat(storyImageAbs)).size;
      const UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";

      // INIT for image - query params MUST be in OAuth signature
      const imgInitParams = {
        command: "INIT",
        total_bytes: fileSize.toString(),
        media_type: "image/png",
        media_category: "tweet_image",
      };
      const initAuth = generateOAuthHeader("POST", UPLOAD_URL, imgInitParams);
      const initResponse = await axios.post(UPLOAD_URL, null, {
        params: imgInitParams,
        headers: { Authorization: initAuth },
      });

      const mediaId = initResponse.data.media_id_string;
      console.log(`[twitter] Image INIT: ${mediaId}`);

      // APPEND - single chunk for images (typically under 5MB)
      const fileBuffer = await fs.readFile(storyImageAbs);
      const FormData =
        (await import("form-data")).default || require("form-data");
      const form = new FormData();
      form.append("command", "APPEND");
      form.append("media_id", mediaId);
      form.append("segment_index", "0");
      form.append("media_data", fileBuffer.toString("base64"));

      const appendAuth = generateOAuthHeader("POST", UPLOAD_URL);
      await axios.post(UPLOAD_URL, form, {
        headers: {
          Authorization: appendAuth,
          ...form.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      console.log(`[twitter] Image APPEND complete`);

      // FINALIZE - query params MUST be in OAuth signature
      const imgFinalizeParams = { command: "FINALIZE", media_id: mediaId };
      const finalizeAuth = generateOAuthHeader(
        "POST",
        UPLOAD_URL,
        imgFinalizeParams,
      );
      await axios.post(UPLOAD_URL, null, {
        params: imgFinalizeParams,
        headers: { Authorization: finalizeAuth },
      });

      console.log(`[twitter] Image FINALIZE: ready`);

      // Post tweet with image
      const tweet = await postTweet(tweetText, mediaId);
      console.log(`[twitter] Image tweet posted: ${tweet.id}`);

      return {
        platform: "twitter_image",
        tweetId: tweet.id,
      };
    },
    { label: "twitter image tweet" },
  );
}

module.exports = {
  uploadShort,
  uploadAll,
  uploadMedia,
  postTweet,
  postImageTweet,
  twitterEnabled,
  generateOAuthHeader,
  verifyPublicPost,
  buildXPostText,
};

if (require.main === module) {
  try {
    const directPolicy = buildDirectUploadPolicy({ platform: "twitter" });
    assertDirectUploadAllowed(directPolicy);
    if (directPolicy.mode !== "actual_upload") {
      console.log(
        `[twitter] Direct upload ${directPolicy.mode}: no upload dispatched`,
      );
    } else {
      uploadAll().catch((err) => {
        console.log(`[twitter] ERROR: ${err.message}`);
        process.exit(1);
      });
    }
  } catch (err) {
    console.log(`[twitter] ERROR: ${err.message}`);
    process.exit(1);
  }
}

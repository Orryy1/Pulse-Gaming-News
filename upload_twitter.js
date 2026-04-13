/*
  X/Twitter Video Upload via API v2

  Setup:
  1. Apply for Elevated access at developer.twitter.com
  2. Create a project + app with OAuth 1.0a (Read and Write)
  3. Generate Access Token and Secret
  4. Set env: TWITTER_API_KEY, TWITTER_API_SECRET,
             TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET

  Twitter video upload uses the chunked media upload endpoint (v1.1)
  then creates a tweet with the media via v2 API.
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

dotenv.config({ override: true });

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

function generateOAuthHeader(method, url, extraParams = {}) {
  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  if (!apiKey || !accessToken) {
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

// --- Chunked media upload (v1.1) ---
async function uploadMedia(filePath) {
  const fileSize = (await fs.stat(filePath)).size;
  const UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";

  // INIT - query params MUST be included in OAuth 1.0a signature
  const initParams = {
    command: "INIT",
    total_bytes: fileSize.toString(),
    media_type: "video/mp4",
    media_category: "tweet_video",
  };
  const initAuth = generateOAuthHeader("POST", UPLOAD_URL, initParams);

  const initResponse = await axios.post(UPLOAD_URL, null, {
    params: initParams,
    headers: { Authorization: initAuth },
  });

  const mediaId = initResponse.data.media_id_string;
  console.log(`[twitter] Media INIT: ${mediaId}`);

  // APPEND - upload in 5MB chunks
  const CHUNK_SIZE = 5 * 1024 * 1024;
  const fileBuffer = await fs.readFile(filePath);
  let segmentIndex = 0;

  for (let offset = 0; offset < fileSize; offset += CHUNK_SIZE) {
    const chunk = fileBuffer.subarray(
      offset,
      Math.min(offset + CHUNK_SIZE, fileSize),
    );
    const FormData =
      (await import("form-data")).default || require("form-data");
    const form = new FormData();
    form.append("command", "APPEND");
    form.append("media_id", mediaId);
    form.append("segment_index", segmentIndex.toString());
    form.append("media_data", chunk.toString("base64"));

    const appendAuth = generateOAuthHeader("POST", UPLOAD_URL);

    await axios.post(UPLOAD_URL, form, {
      headers: {
        Authorization: appendAuth,
        ...form.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    segmentIndex++;
  }

  console.log(`[twitter] Media APPEND: ${segmentIndex} chunks uploaded`);

  // FINALIZE - query params MUST be included in OAuth 1.0a signature
  const finalizeParams = { command: "FINALIZE", media_id: mediaId };
  const finalizeAuth = generateOAuthHeader("POST", UPLOAD_URL, finalizeParams);

  const finalizeResponse = await axios.post(UPLOAD_URL, null, {
    params: finalizeParams,
    headers: { Authorization: finalizeAuth },
  });

  // Check processing status
  let processing = finalizeResponse.data.processing_info;
  while (processing && processing.state !== "succeeded") {
    if (processing.state === "failed") {
      throw new Error(
        `Twitter media processing failed: ${JSON.stringify(processing.error)}`,
      );
    }

    const waitSecs = processing.check_after_secs || 5;
    await new Promise((r) => setTimeout(r, waitSecs * 1000));

    const statusParams = { command: "STATUS", media_id: mediaId };
    const statusAuth = generateOAuthHeader("GET", UPLOAD_URL, statusParams);

    const statusResponse = await axios.get(UPLOAD_URL, {
      params: statusParams,
      headers: { Authorization: statusAuth },
    });

    processing = statusResponse.data.processing_info;
    console.log(
      `[twitter] Processing: ${processing?.state || "unknown"} (${processing?.progress_percent || 0}%)`,
    );
  }

  console.log(`[twitter] Media FINALIZE: ready`);
  return mediaId;
}

// --- Post tweet with video via v2 ---
async function postTweet(text, mediaId) {
  const TWEET_URL = "https://api.twitter.com/2/tweets";
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

// --- Upload a single video to X/Twitter ---
async function uploadShort(story) {
  addBreadcrumb(`Twitter upload: ${story.title}`, "upload");
  return withRetry(
    async () => {
      await validateVideo(story.exported_path, "twitter");

      // Build tweet text (280 char limit)
      let text =
        story.suggested_title || story.suggested_thumbnail_text || story.title;
      text = text.replace(/\[.*?\]\s*/g, "").trim();
      if (text.length > 220) text = text.substring(0, 217) + "...";

      const hashtags = "#GamingNews #GamingLeaks";
      const tweetText = `${text}\n\n${hashtags}`;
      const finalText =
        tweetText.length > 280
          ? tweetText.substring(0, 277) + "..."
          : tweetText;

      console.log(
        `[twitter] Uploading video for: "${text.substring(0, 50)}..."`,
      );

      // Upload media
      const mediaId = await uploadMedia(story.exported_path);

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
  addBreadcrumb(`Twitter image tweet: ${story.title}`, "upload");
  return withRetry(
    async () => {
      if (
        !story.story_image_path ||
        !(await fs.pathExists(story.story_image_path))
      ) {
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
      const fileSize = (await fs.stat(story.story_image_path)).size;
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
      const fileBuffer = await fs.readFile(story.story_image_path);
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
};

if (require.main === module) {
  uploadAll().catch((err) => {
    console.log(`[twitter] ERROR: ${err.message}`);
    process.exit(1);
  });
}

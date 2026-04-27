/*
  Facebook Reels Upload via Graph API

  Setup:
  1. Create Facebook App at developers.facebook.com
  2. Add Facebook Login + Pages API permissions
  3. Get a Page Access Token with pages_manage_posts, pages_read_engagement
  4. Set env: FACEBOOK_PAGE_ID, FACEBOOK_PAGE_TOKEN
  5. Or save token to tokens/facebook_token.json

  Facebook Reels use a 3-step resumable upload (direct binary - no public URL needed).
*/

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const dotenv = require("dotenv");
const { withRetry } = require("./lib/retry");
const { addBreadcrumb, captureException } = require("./lib/sentry");
const { validateVideo } = require("./lib/validate");
const db = require("./lib/db");
const mediaPaths = require("./lib/media-paths");

dotenv.config({ override: true });

const TOKEN_PATH = path.join(__dirname, "tokens", "facebook_token.json");

async function getAccessToken() {
  // Prefer env var (persists across Railway deploys, token files get wiped)
  if (process.env.FACEBOOK_PAGE_TOKEN) return process.env.FACEBOOK_PAGE_TOKEN;

  // Fallback to token file (local dev)
  if (await fs.pathExists(TOKEN_PATH)) {
    const tokenData = await fs.readJson(TOKEN_PATH);
    if (
      tokenData.expires_at &&
      tokenData.expires_at > 0 &&
      Date.now() > tokenData.expires_at
    ) {
      throw new Error("Facebook token has EXPIRED. Re-auth at /auth/facebook");
    }
    return tokenData.access_token;
  }
  throw new Error(
    "Facebook not authenticated. Set FACEBOOK_PAGE_TOKEN env var or re-auth at /auth/facebook",
  );
}

function getPageId() {
  const id = process.env.FACEBOOK_PAGE_ID;
  if (!id) throw new Error("FACEBOOK_PAGE_ID not set in .env");
  return id;
}

// --- Upload a Reel to Facebook ---
async function uploadReel(story) {
  addBreadcrumb(`Facebook upload: ${story.title}`, "upload");
  return withRetry(
    async () => {
      const accessToken = await getAccessToken();
      const pageId = getPageId();

      // Resolve the MP4 via media-paths so Facebook reads from
      // MEDIA_ROOT (persistent) when set, with repo-root fallback.
      const exportedAbs =
        (await mediaPaths.resolveExisting(story.exported_path)) ||
        story.exported_path;
      await validateVideo(exportedAbs, "facebook");

      const publicBaseUrl =
        process.env.RAILWAY_PUBLIC_URL ||
        `http://localhost:${process.env.PORT || 3001}`;
      const videoUrl = `${publicBaseUrl}/api/download/${story.id}.mp4`;

      // Build description
      let description =
        story.suggested_title || story.suggested_thumbnail_text || story.title;
      const cleanScript = (story.full_script || "")
        .replace(/\[PAUSE\]/gi, "")
        .replace(/\[VISUAL:[^\]]*\]/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      description += "\n\n" + cleanScript.substring(0, 300);
      description +=
        "\n\n#gaming #gamingnews #gamingleaks #gamingcommunity #reels";
      if (description.length > 2000)
        description = description.substring(0, 1997) + "...";

      console.log(
        `[facebook] Uploading Reel: "${(story.title || "").substring(0, 50)}..."`,
      );

      // Step 1: Initiate Reel upload
      console.log(`[facebook] Step 1/3: Initiating reel upload...`);
      const initResponse = await axios.post(
        `https://graph.facebook.com/v21.0/${pageId}/video_reels`,
        {
          upload_phase: "start",
          access_token: accessToken,
        },
      );

      const videoId = initResponse.data.video_id;
      const uploadUrl = initResponse.data.upload_url;
      if (!videoId || !uploadUrl) {
        throw new Error(
          `Facebook init phase returned incomplete data: video_id=${videoId}, upload_url=${uploadUrl ? "present" : "MISSING"}, response=${JSON.stringify(initResponse.data)}`,
        );
      }
      console.log(`[facebook] Step 1 OK: video_id=${videoId}`);

      // Step 2: Upload the video binary (with 120s timeout)
      const videoBuffer = await fs.readFile(exportedAbs);
      const fileSize = videoBuffer.length;
      console.log(
        `[facebook] Step 2/3: Uploading ${Math.round(fileSize / 1024 / 1024)}MB binary to ${uploadUrl.substring(0, 60)}...`,
      );

      const uploadResponse = await axios({
        method: "POST",
        url: uploadUrl,
        headers: {
          Authorization: `OAuth ${accessToken}`,
          offset: "0",
          file_size: fileSize.toString(),
          "Content-Type": "application/octet-stream",
        },
        data: videoBuffer,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 120000,
      });
      console.log(
        `[facebook] Step 2 OK: upload status ${uploadResponse.status}, data: ${JSON.stringify(uploadResponse.data).substring(0, 200)}`,
      );

      // Step 3: Finish the upload and publish
      console.log(`[facebook] Step 3/3: Publishing reel...`);
      const finishResponse = await axios.post(
        `https://graph.facebook.com/v21.0/${pageId}/video_reels`,
        {
          upload_phase: "finish",
          video_id: videoId,
          title: (
            story.suggested_title ||
            story.suggested_thumbnail_text ||
            story.title ||
            ""
          ).substring(0, 100),
          description,
          published: true,
          access_token: accessToken,
        },
      );

      // Verify the finish phase succeeded
      if (finishResponse.data && finishResponse.data.success === false) {
        throw new Error(
          `Facebook finish phase failed: ${JSON.stringify(finishResponse.data)}`,
        );
      }
      console.log(
        `[facebook] Step 3 response: ${JSON.stringify(finishResponse.data)}`,
      );

      // Verify the reel actually published. Meta's /video_reels finish
      // phase happily returns { success: true } even when the video is
      // stuck in async processing or fails moderation — then the Page's
      // Reels tab stays empty while our pipeline reports FB Reel ✅.
      // Poll the video's upload_phase + status until we see the reel is
      // actually ready & published, or bail with a descriptive error.
      await verifyReelPublished(videoId, accessToken);

      console.log(`[facebook] Reel published! Video ID: ${videoId}`);

      return {
        platform: "facebook",
        videoId,
      };
    },
    { label: "facebook upload" },
  );
}

// --- Poll a Reel's upload/publish status until it's actually live ---
// Meta returns status.video_status ('ready' | 'processing' | 'error') and
// status.publishing_phase.status ('published' | 'scheduled' | 'draft').
// We consider the reel verified when video_status=ready AND the
// publishing phase is 'published'. Anything else is treated as a failure
// so the caller can retry rather than falsely marking FB Reel ✅.
// --- Decide whether a /{video_id} status snapshot means ready/published ---
// Pulled out as a pure helper so we can unit-test the decision without
// mocking axios. Returns one of:
//   { outcome: "ready" }
//   { outcome: "errored", reason: string }
//   { outcome: "processing" }
// `reason` is an enum-style tag (video_status, publish_status) — never
// the raw Graph response, which can contain redirect URLs that embed
// short-lived access codes we don't want in our own error messages.
function interpretReelStatusSnapshot(data) {
  const videoStatus = data && data.status && data.status.video_status;
  const publishStatus =
    data && data.status && data.status.publishing_phase
      ? data.status.publishing_phase.status
      : undefined;
  const publishedFlag = data && data.published;
  if (videoStatus === "error") {
    return {
      outcome: "errored",
      reason: `video_status=error publish=${publishStatus || "(absent)"}`,
    };
  }
  if (
    videoStatus === "ready" &&
    (publishStatus === "published" ||
      publishStatus === "complete" ||
      publishedFlag === true)
  ) {
    return { outcome: "ready" };
  }
  return { outcome: "processing" };
}

async function verifyReelPublished(videoId, accessToken) {
  const maxAttempts = 24; // ~2 min at 5s intervals
  let lastTags = { video_status: null, publish_status: null };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    let resp;
    try {
      resp = await axios.get(`https://graph.facebook.com/v21.0/${videoId}`, {
        params: {
          fields: "status,published,permalink_url",
          access_token: accessToken,
        },
        timeout: 15000,
      });
    } catch (err) {
      // Network flake / 5xx — keep polling. A Graph 4xx surfaces as
      // err.response and is also retried; if the condition is real
      // (e.g. token revoked) the whole window will time out and we'll
      // throw below with a non-secret-bearing message.
      console.log(
        `[facebook] Reel verify poll ${attempt} error (will retry): ${err.message}`,
      );
      continue;
    }
    const verdict = interpretReelStatusSnapshot(resp.data);
    const videoStatus = resp.data?.status?.video_status;
    const publishStatus = resp.data?.status?.publishing_phase?.status;
    lastTags = {
      video_status: videoStatus || null,
      publish_status: publishStatus || null,
    };
    if (verdict.outcome === "errored") {
      throw new Error(`Facebook Reel processing errored: ${verdict.reason}`);
    }
    if (verdict.outcome === "ready") {
      // permalink_url is safe to log — it's the public Reel URL.
      console.log(
        `[facebook] Reel verified live after ${attempt} poll(s): ${resp.data?.permalink_url || "(no permalink)"}`,
      );
      return;
    }
    console.log(
      `[facebook] Reel verify ${attempt}/${maxAttempts}: video_status=${videoStatus || "?"} publish=${publishStatus || "?"}`,
    );
  }
  // Timeout: still processing past 2 min. Surface only the last safe
  // status tags — no raw Graph response body, which could embed a
  // transient CDN URL with an access code.
  throw new Error(
    `Facebook Reel did not go live within 2 min — last video_status=${lastTags.video_status || "(none)"} publish=${lastTags.publish_status || "(none)"}`,
  );
}

// --- URL-based Reel upload (fallback when binary upload fails) ---
// Uses the 3-step /video_reels API with a hosted file_url in step 2 so the
// result is an actual Reel, not a feed post. The previous fallback wrote to
// /videos which silently produced feed videos when the user expected Reels.
async function uploadReelViaUrl(story) {
  addBreadcrumb(`Facebook URL upload: ${story.title}`, "upload");

  const accessToken = await getAccessToken();
  const pageId = getPageId();

  const publicBaseUrl =
    process.env.RAILWAY_PUBLIC_URL ||
    `http://localhost:${process.env.PORT || 3001}`;
  const videoUrl = `${publicBaseUrl}/api/download/${story.id}.mp4`;

  let description =
    story.suggested_title || story.suggested_thumbnail_text || story.title;
  const cleanScript = (story.full_script || "")
    .replace(/\[PAUSE\]/gi, "")
    .replace(/\[VISUAL:[^\]]*\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  description += "\n\n" + cleanScript.substring(0, 300);
  description += "\n\n#gaming #gamingnews #gamingleaks #gamingcommunity #reels";
  if (description.length > 2000)
    description = description.substring(0, 1997) + "...";

  console.log(`[facebook] URL fallback: posting Reel via ${videoUrl}`);

  // Step 1: init
  const initResponse = await axios.post(
    `https://graph.facebook.com/v21.0/${pageId}/video_reels`,
    { upload_phase: "start", access_token: accessToken },
  );
  const videoId = initResponse.data.video_id;
  const uploadUrl = initResponse.data.upload_url;
  if (!videoId || !uploadUrl) {
    throw new Error(
      `Facebook init phase returned incomplete data: video_id=${videoId}, upload_url=${uploadUrl ? "present" : "MISSING"}`,
    );
  }

  // Step 2: tell FB to fetch from URL instead of sending binary
  const uploadResponse = await axios({
    method: "POST",
    url: uploadUrl,
    headers: {
      Authorization: `OAuth ${accessToken}`,
      file_url: videoUrl,
    },
    timeout: 180000,
  });
  if (uploadResponse.data && uploadResponse.data.success === false) {
    throw new Error(
      `Facebook Reel URL fetch failed: ${JSON.stringify(uploadResponse.data)}`,
    );
  }

  // Step 3: finish/publish
  const finishResponse = await axios.post(
    `https://graph.facebook.com/v21.0/${pageId}/video_reels`,
    {
      upload_phase: "finish",
      video_id: videoId,
      title: (
        story.suggested_title ||
        story.suggested_thumbnail_text ||
        story.title ||
        ""
      ).substring(0, 100),
      description,
      published: true,
      access_token: accessToken,
    },
  );
  if (finishResponse.data && finishResponse.data.success === false) {
    throw new Error(
      `Facebook Reel finish phase failed: ${JSON.stringify(finishResponse.data)}`,
    );
  }

  // Same verify-after-publish guard as the binary upload path — see
  // verifyReelPublished for why Meta's success:true isn't trustworthy
  // without a second confirmation poll.
  await verifyReelPublished(videoId, accessToken);

  console.log(`[facebook] Reel published via URL! ID: ${videoId}`);
  return {
    platform: "facebook",
    videoId,
  };
}

// --- Batch upload ---
async function uploadAll() {
  const stories = await db.getStories();
  if (!stories.length) {
    console.log("[facebook] No stories found");
    return [];
  }

  const ready = stories.filter(
    (s) => s.approved && s.exported_path && !s.facebook_post_id,
  );

  console.log(`[facebook] ${ready.length} videos ready for upload`);
  const results = [];

  for (const story of ready) {
    try {
      const result = await uploadReel(story);
      story.facebook_post_id = result.videoId;
      results.push(result);
      await new Promise((r) => setTimeout(r, 10000));
    } catch (err) {
      captureException(err, { platform: "facebook", storyId: story.id });
      console.log(`[facebook] Upload failed for ${story.id}: ${err.message}`);
      story.facebook_error = err.message;
    }
  }

  await db.saveStories(stories);
  console.log(`[facebook] ${results.length} reels uploaded`);
  return results;
}

// Alias for publisher.js compatibility
async function uploadShort(story) {
  return uploadReel(story);
}

// --- Upload a Story image to Facebook Stories ---
async function uploadStoryImage(story) {
  addBreadcrumb(`Facebook Story image upload: ${story.title}`, "upload");
  return withRetry(
    async () => {
      const accessToken = await getAccessToken();
      const pageId = getPageId();

      // Resolve through media-paths — card may live under
      // MEDIA_ROOT on Railway, repo-root in dev.
      const storyImageAbs = story.story_image_path
        ? await mediaPaths.resolveExisting(story.story_image_path)
        : null;
      if (!storyImageAbs || !(await fs.pathExists(storyImageAbs))) {
        throw new Error("Story image not found on disk");
      }

      console.log(
        `[facebook] Uploading Story image: "${(story.title || "").substring(0, 50)}..."`,
      );

      // Step 1: Upload the photo to the page (unpublished) so we get a photo_id
      const imageBuffer = await fs.readFile(storyImageAbs);
      const FormData =
        (await import("form-data")).default || require("form-data");
      const form = new FormData();
      form.append("source", imageBuffer, {
        filename: `${story.id}_story.png`,
        contentType: "image/png",
      });
      form.append("published", "false");
      form.append("access_token", accessToken);

      const photoResponse = await axios.post(
        `https://graph.facebook.com/v21.0/${pageId}/photos`,
        form,
        {
          headers: form.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        },
      );

      const photoId = photoResponse.data.id;
      console.log(`[facebook] Photo uploaded (unpublished): ${photoId}`);

      // Step 2: Create the Story using the photo_id
      const storyResponse = await axios.post(
        `https://graph.facebook.com/v21.0/${pageId}/photo_stories`,
        {
          photo_id: photoId,
          access_token: accessToken,
        },
      );

      const storyId = storyResponse.data.id || storyResponse.data.post_id;
      console.log(`[facebook] Story published! Story ID: ${storyId}`);

      return {
        platform: "facebook_story",
        storyId,
      };
    },
    { label: "facebook story upload" },
  );
}

module.exports = {
  uploadReel,
  uploadReelViaUrl,
  uploadShort,
  uploadAll,
  uploadStoryImage,
  // Exported for unit-testing the decision logic without mocking axios.
  interpretReelStatusSnapshot,
};

if (require.main === module) {
  uploadAll().catch((err) => {
    console.log(`[facebook] ERROR: ${err.message}`);
    process.exit(1);
  });
}

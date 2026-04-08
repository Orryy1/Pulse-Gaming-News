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

dotenv.config({ override: true });

const TOKEN_PATH = path.join(__dirname, "tokens", "facebook_token.json");

async function getAccessToken() {
  // Try file first (may have refresh info)
  if (await fs.pathExists(TOKEN_PATH)) {
    const tokenData = await fs.readJson(TOKEN_PATH);
    if (tokenData.expires_at && Date.now() > tokenData.expires_at) {
      console.warn(
        "[facebook] Token has EXPIRED. Uploads will fail until token is refreshed.",
      );
    } else if (
      tokenData.expires_at &&
      Date.now() > tokenData.expires_at - 7 * 24 * 60 * 60 * 1000
    ) {
      console.warn(
        "[facebook] Token expiring within 7 days. Consider refreshing.",
      );
    }
    return tokenData.access_token;
  }
  if (process.env.FACEBOOK_PAGE_TOKEN) return process.env.FACEBOOK_PAGE_TOKEN;
  throw new Error("Facebook not authenticated.");
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

      await validateVideo(story.exported_path, "facebook");

      const publicBaseUrl =
        process.env.RAILWAY_PUBLIC_URL ||
        `http://localhost:${process.env.PORT || 3001}`;
      const videoUrl = `${publicBaseUrl}/api/download/${story.id}`;

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
      const initResponse = await axios.post(
        `https://graph.facebook.com/v21.0/${pageId}/video_reels`,
        {
          upload_phase: "start",
          access_token: accessToken,
        },
      );

      const videoId = initResponse.data.video_id;
      const uploadUrl = initResponse.data.upload_url;

      // Step 2: Upload the video binary
      const videoBuffer = await fs.readFile(story.exported_path);
      const fileSize = videoBuffer.length;

      await axios({
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
      });

      // Step 3: Finish the upload and publish (published: true is required or it stays as draft)
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

      console.log(`[facebook] Reel published! Video ID: ${videoId}`);

      return {
        platform: "facebook",
        videoId,
      };
    },
    { label: "facebook upload" },
  );
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

      if (
        !story.story_image_path ||
        !(await fs.pathExists(story.story_image_path))
      ) {
        throw new Error("Story image not found on disk");
      }

      console.log(
        `[facebook] Uploading Story image: "${(story.title || "").substring(0, 50)}..."`,
      );

      // Step 1: Upload the photo to the page (unpublished) so we get a photo_id
      const imageBuffer = await fs.readFile(story.story_image_path);
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

module.exports = { uploadReel, uploadShort, uploadAll, uploadStoryImage };

if (require.main === module) {
  uploadAll().catch((err) => {
    console.log(`[facebook] ERROR: ${err.message}`);
    process.exit(1);
  });
}

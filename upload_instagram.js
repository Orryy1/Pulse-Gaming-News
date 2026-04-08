const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');
const { withRetry } = require('./lib/retry');
const { addBreadcrumb, captureException } = require('./lib/sentry');
const { validateVideo } = require('./lib/validate');
const db = require('./lib/db');

dotenv.config({ override: true });

const TOKEN_PATH = path.join(__dirname, 'tokens', 'instagram_token.json');

/*
  Instagram Reels via Facebook Graph API
  Docs: https://developers.facebook.com/docs/instagram-platform/content-publishing/

  Setup:
  1. Create Facebook App at developers.facebook.com
  2. Add Instagram Graph API product
  3. Connect Instagram Business/Creator account
  4. Get long-lived page token + Instagram Business Account ID
  5. Set env: INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID
  6. Or save token to tokens/instagram_token.json

  IMPORTANT: Video must be hosted at a public URL for Instagram to fetch.
  The pipeline uploads to a temporary hosting service or your own server.
*/

async function getAccessToken() {
  // Try saved token first (may have been refreshed)
  if (await fs.pathExists(TOKEN_PATH)) {
    const tokenData = await fs.readJson(TOKEN_PATH);
    // Auto-refresh if within 7 days of expiry
    if (tokenData.expires_at && tokenData.expires_at > 0 && Date.now() > tokenData.expires_at - (7 * 24 * 60 * 60 * 1000)) {
      console.log('[instagram] Token expiring soon, refreshing...');
      try {
        const refreshed = await refreshToken(tokenData.access_token);
        return refreshed.access_token;
      } catch (err) {
        // If token is actually expired (not just expiring soon), fail hard
        if (tokenData.expires_at > 0 && Date.now() > tokenData.expires_at) {
          throw new Error(`Instagram token expired and refresh failed: ${err.message}`);
        }
        console.warn(`[instagram] Refresh failed but token still valid: ${err.message}`);
        return tokenData.access_token;
      }
    }
    return tokenData.access_token;
  }

  // Fall back to env var
  if (process.env.INSTAGRAM_ACCESS_TOKEN) {
    return process.env.INSTAGRAM_ACCESS_TOKEN;
  }

  throw new Error(
    'Instagram not authenticated.\n' +
    'Set INSTAGRAM_ACCESS_TOKEN in .env, or save token to tokens/instagram_token.json\n' +
    'Also set INSTAGRAM_BUSINESS_ACCOUNT_ID'
  );
}

async function refreshToken(currentToken) {
  const response = await axios.get('https://graph.instagram.com/refresh_access_token', {
    params: {
      grant_type: 'ig_refresh_token',
      access_token: currentToken,
    },
  });

  const tokenData = {
    access_token: response.data.access_token,
    token_type: response.data.token_type,
    expires_in: response.data.expires_in,
    expires_at: Date.now() + (response.data.expires_in * 1000),
    refreshed_at: new Date().toISOString(),
  };

  await fs.ensureDir(path.dirname(TOKEN_PATH));
  await fs.writeJson(TOKEN_PATH, tokenData, { spaces: 2 });
  console.log(`[instagram] Token refreshed, expires in ${Math.round(response.data.expires_in / 86400)} days`);
  return tokenData;
}

// Save the initial env var token to disk so it can be refreshed later
async function seedTokenFromEnv() {
  if (!await fs.pathExists(TOKEN_PATH) && process.env.INSTAGRAM_ACCESS_TOKEN) {
    const tokenData = {
      access_token: process.env.INSTAGRAM_ACCESS_TOKEN,
      expires_at: Date.now() + (55 * 24 * 60 * 60 * 1000), // assume ~55 days left
      seeded_from_env: true,
      seeded_at: new Date().toISOString(),
    };
    await fs.ensureDir(path.dirname(TOKEN_PATH));
    await fs.writeJson(TOKEN_PATH, tokenData, { spaces: 2 });
    console.log('[instagram] Seeded token from env var to tokens/instagram_token.json');
  }
}

function getAccountId() {
  const id = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  if (!id) throw new Error('INSTAGRAM_BUSINESS_ACCOUNT_ID not set in .env');
  return id;
}

// --- Upload a Reel to Instagram via Resumable Upload (direct binary) ---
async function uploadReel(story) {
  addBreadcrumb(`Instagram upload: ${story.title}`, 'upload');
  return withRetry(async () => {
    const accessToken = await getAccessToken();
    const accountId = getAccountId();

    await validateVideo(story.exported_path, 'instagram');

    // Build caption - channel-aware hashtags
    const { getChannel } = require('./channels');
    const channel = getChannel();
    let caption = story.suggested_title || story.suggested_thumbnail_text || story.title;
    caption += '\n\n' + (story.full_script || '').substring(0, 500);
    const tags = (channel.hashtags || []).map(h => h.replace('#Shorts', '#reels')).join(' ');
    caption += '\n\n' + tags + ' #viral #explore';
    if (story.affiliate_url) {
      caption += `\n\nLink in bio | Source: r/${story.subreddit}`;
    }

    // Trim to Instagram's 2200 char limit
    if (caption.length > 2200) caption = caption.substring(0, 2197) + '...';

    // Seed token from env on first run so auto-refresh can work
    await seedTokenFromEnv();

    const videoBuffer = await fs.readFile(story.exported_path);
    const fileSize = videoBuffer.length;
    console.log(`[instagram] Uploading Reel (${Math.round(fileSize / 1024)}KB): "${(story.suggested_thumbnail_text || story.title).substring(0, 50)}..."`);

    // Step 1: Create resumable upload session
    // Use graph.facebook.com (not graph.instagram.com) - required for resumable uploads
    let initResponse;
    try {
      initResponse = await axios.post(
        `https://graph.facebook.com/v21.0/${accountId}/media`,
        {
          media_type: 'REELS',
          upload_type: 'resumable',
          caption,
          share_to_feed: true,
          access_token: accessToken,
        }
      );
    } catch (err) {
      const errData = err.response?.data?.error || err.response?.data || err.message;
      console.log(`[instagram] Container creation failed: ${JSON.stringify(errData)}`);
      throw new Error(`Instagram container creation failed: ${JSON.stringify(errData)}`);
    }

    const containerId = initResponse.data.id;
    const uploadUrl = initResponse.data.uri || `https://rupload.facebook.com/ig-api-upload/v21.0/${containerId}`;
    console.log(`[instagram] Container created: ${containerId}, upload URL: ${uploadUrl ? 'received' : 'fallback'}`);

    // Step 2: Upload video binary directly to the resumable upload URI
    await axios({
      method: 'POST',
      url: uploadUrl,
      headers: {
        'Authorization': `OAuth ${accessToken}`,
        'offset': '0',
        'file_size': fileSize.toString(),
        'Content-Type': 'video/mp4',
      },
      data: videoBuffer,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    console.log(`[instagram] Binary upload complete`);

    // Step 3: Wait for processing
    let status = 'IN_PROGRESS';
    let attempts = 0;

    while (status === 'IN_PROGRESS' && attempts < 60) {
      await new Promise(r => setTimeout(r, 10000));
      attempts++;

      try {
        const statusResponse = await axios.get(
          `https://graph.facebook.com/v21.0/${containerId}`,
          {
            params: {
              fields: 'status_code,status',
              access_token: accessToken,
            },
          }
        );

        status = statusResponse.data.status_code || 'IN_PROGRESS';
        console.log(`[instagram] Processing check ${attempts}: ${status}`);

        if (status === 'ERROR') {
          throw new Error(`Instagram processing failed: ${JSON.stringify(statusResponse.data)}`);
        }
      } catch (err) {
        if (err.message.includes('processing failed')) throw err;
        console.log(`[instagram] Status check error: ${err.message}`);
      }
    }

    if (status !== 'FINISHED') {
      throw new Error(`Instagram processing timed out (status: ${status})`);
    }

    // Step 4: Publish the container
    const publishResponse = await axios.post(
      `https://graph.facebook.com/v21.0/${accountId}/media_publish`,
      {
        creation_id: containerId,
        access_token: accessToken,
      }
    );

    const mediaId = publishResponse.data.id;
    console.log(`[instagram] Published! Media ID: ${mediaId}`);

    return {
      platform: 'instagram',
      mediaId,
    };
  }, { label: 'instagram upload' });
}

// --- Batch upload all ready stories ---
async function uploadAll() {
  const stories = await db.getStories();
  if (!stories.length) {
    console.log('[instagram] No stories found');
    return [];
  }

  const ready = stories.filter(s =>
    s.approved && s.exported_path && !s.instagram_media_id
  );

  console.log(`[instagram] ${ready.length} videos ready for upload`);

  const results = [];

  for (const story of ready) {
    try {
      const result = await uploadReel(story);
      story.instagram_media_id = result.mediaId;
      results.push(result);

      // Rate limiting (Instagram is strict)
      await new Promise(r => setTimeout(r, 30000));
    } catch (err) {
      captureException(err, { platform: 'instagram', storyId: story.id });
      console.log(`[instagram] Upload failed for ${story.id}: ${err.message}`);
      story.instagram_error = err.message;
    }
  }

  await db.saveStories(stories);
  console.log(`[instagram] ${results.length} reels uploaded`);
  return results;
}

// Alias for publisher.js compatibility
async function uploadShort(story) {
  return uploadReel(story);
}

// --- Upload a Story image to Instagram Stories ---
async function uploadStoryImage(story) {
  addBreadcrumb(`Instagram Story image upload: ${story.title}`, 'upload');
  return withRetry(async () => {
    const accessToken = await getAccessToken();
    const accountId = getAccountId();

    if (!story.story_image_path || !await fs.pathExists(story.story_image_path)) {
      throw new Error('Story image not found on disk');
    }

    const publicBaseUrl = process.env.RAILWAY_PUBLIC_URL;
    if (!publicBaseUrl) {
      throw new Error('RAILWAY_PUBLIC_URL not set - Instagram needs a public URL to fetch the image');
    }

    const imageUrl = `${publicBaseUrl}/api/story-image/${story.id}`;
    console.log(`[instagram] Uploading Story image: "${(story.title || '').substring(0, 50)}..."`);

    // Seed token from env on first run so auto-refresh can work
    await seedTokenFromEnv();

    // Step 1: Create a Stories media container
    let initResponse;
    try {
      initResponse = await axios.post(
        `https://graph.facebook.com/v21.0/${accountId}/media`,
        {
          media_type: 'STORIES',
          image_url: imageUrl,
          access_token: accessToken,
        }
      );
    } catch (err) {
      const errData = err.response?.data?.error || err.response?.data || err.message;
      throw new Error(`Instagram Story container creation failed: ${JSON.stringify(errData)}`);
    }

    const containerId = initResponse.data.id;
    console.log(`[instagram] Story container created: ${containerId}`);

    // Step 2: Wait for processing
    let status = 'IN_PROGRESS';
    let attempts = 0;

    while (status === 'IN_PROGRESS' && attempts < 30) {
      await new Promise(r => setTimeout(r, 5000));
      attempts++;

      try {
        const statusResponse = await axios.get(
          `https://graph.facebook.com/v21.0/${containerId}`,
          {
            params: {
              fields: 'status_code,status',
              access_token: accessToken,
            },
          }
        );

        status = statusResponse.data.status_code || 'IN_PROGRESS';
        console.log(`[instagram] Story processing check ${attempts}: ${status}`);

        if (status === 'ERROR') {
          throw new Error(`Instagram Story processing failed: ${JSON.stringify(statusResponse.data)}`);
        }
      } catch (err) {
        if (err.message.includes('processing failed')) throw err;
        console.log(`[instagram] Story status check error: ${err.message}`);
      }
    }

    if (status !== 'FINISHED') {
      throw new Error(`Instagram Story processing timed out (status: ${status})`);
    }

    // Step 3: Publish the container
    const publishResponse = await axios.post(
      `https://graph.facebook.com/v21.0/${accountId}/media_publish`,
      {
        creation_id: containerId,
        access_token: accessToken,
      }
    );

    const mediaId = publishResponse.data.id;
    console.log(`[instagram] Story published! Media ID: ${mediaId}`);

    return {
      platform: 'instagram_story',
      mediaId,
    };
  }, { label: 'instagram story upload' });
}

module.exports = { uploadReel, uploadShort, uploadAll, uploadStoryImage, refreshToken, seedTokenFromEnv };

if (require.main === module) {
  uploadAll().catch(err => {
    console.log(`[instagram] ERROR: ${err.message}`);
    process.exit(1);
  });
}

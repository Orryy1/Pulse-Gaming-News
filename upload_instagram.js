const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');

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
    if (tokenData.expires_at && Date.now() > tokenData.expires_at - (7 * 24 * 60 * 60 * 1000)) {
      console.log('[instagram] Token expiring soon, refreshing...');
      try {
        const refreshed = await refreshToken(tokenData.access_token);
        return refreshed.access_token;
      } catch (err) {
        console.log(`[instagram] Refresh failed: ${err.message}, using existing token`);
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

// --- Upload a Reel to Instagram ---
async function uploadReel(story) {
  const accessToken = await getAccessToken();
  const accountId = getAccountId();

  if (!story.exported_path || !await fs.pathExists(story.exported_path)) {
    throw new Error(`Video file not found: ${story.exported_path}`);
  }

  // Instagram requires a public URL for the video
  const publicBaseUrl = process.env.RAILWAY_PUBLIC_URL || `http://localhost:${process.env.PORT || 3001}`;
  const videoUrl = `${publicBaseUrl}/api/download/${story.id}`;

  // Verify the video is actually accessible at the public URL before telling Instagram to fetch it
  try {
    const probe = await axios.head(videoUrl, { timeout: 10000 });
    const contentType = probe.headers['content-type'] || '';
    const contentLength = parseInt(probe.headers['content-length'] || '0', 10);
    if (contentLength < 100000) {
      throw new Error(`Video file too small (${contentLength} bytes) — likely missing or corrupt`);
    }
    console.log(`[instagram] Video URL verified: ${contentLength} bytes, ${contentType}`);
  } catch (err) {
    throw new Error(`Video not accessible at ${videoUrl} — skipping Instagram upload (${err.message})`);
  }

  // Build caption — channel-aware hashtags
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

  console.log(`[instagram] Uploading Reel: "${(story.suggested_thumbnail_text || story.title).substring(0, 50)}..."`);

  // Step 1: Create media container
  const createResponse = await axios.post(
    `https://graph.instagram.com/v19.0/${accountId}/media`,
    {
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      share_to_feed: true,
      access_token: accessToken,
    }
  );

  const containerId = createResponse.data.id;
  console.log(`[instagram] Container created: ${containerId}`);

  // Step 2: Wait for processing (Instagram needs to fetch and process the video)
  let status = 'IN_PROGRESS';
  let attempts = 0;

  while (status === 'IN_PROGRESS' && attempts < 60) {
    await new Promise(r => setTimeout(r, 10000));
    attempts++;

    try {
      const statusResponse = await axios.get(
        `https://graph.instagram.com/v19.0/${containerId}`,
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

  // Step 3: Publish the container
  const publishResponse = await axios.post(
    `https://graph.instagram.com/v19.0/${accountId}/media_publish`,
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
}

// --- Batch upload all ready stories ---
async function uploadAll() {
  if (!await fs.pathExists('daily_news.json')) {
    console.log('[instagram] No daily_news.json found');
    return [];
  }

  const stories = await fs.readJson('daily_news.json');
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
      console.log(`[instagram] Upload failed for ${story.id}: ${err.message}`);
      story.instagram_error = err.message;
    }
  }

  await fs.writeJson('daily_news.json', stories, { spaces: 2 });
  console.log(`[instagram] ${results.length} reels uploaded`);
  return results;
}

// Alias for publisher.js compatibility
async function uploadShort(story) {
  return uploadReel(story);
}

module.exports = { uploadReel, uploadShort, uploadAll, refreshToken, seedTokenFromEnv };

if (require.main === module) {
  uploadAll().catch(err => {
    console.log(`[instagram] ERROR: ${err.message}`);
    process.exit(1);
  });
}

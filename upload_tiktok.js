const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config({ override: true });

const TOKEN_PATH = path.join(__dirname, 'tokens', 'tiktok_token.json');

/*
  TikTok Content Posting API — Direct Post flow
  Docs: https://developers.tiktok.com/doc/content-posting-api-get-started

  Setup:
  1. Register at developers.tiktok.com
  2. Create app → request "Content Posting API" scope
  3. Complete app review (required for direct posting)
  4. Set env: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET
  5. Run: node upload_tiktok.js auth → visit URL → get code
  6. Run: node upload_tiktok.js token YOUR_CODE
*/

async function getAccessToken() {
  if (!await fs.pathExists(TOKEN_PATH)) {
    throw new Error(
      'TikTok not authenticated. Run: node upload_tiktok.js auth\n' +
      'Requires TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in .env'
    );
  }

  const tokenData = await fs.readJson(TOKEN_PATH);

  // Auto-refresh if expired
  if (tokenData.expires_at && Date.now() > tokenData.expires_at - 60000) {
    console.log('[tiktok] Refreshing expired token...');
    const refreshed = await refreshToken(tokenData.refresh_token);
    return refreshed.access_token;
  }

  return tokenData.access_token;
}

async function refreshToken(refreshToken) {
  const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', {
    client_key: process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const tokenData = {
    ...response.data,
    expires_at: Date.now() + (response.data.expires_in * 1000),
  };

  await fs.ensureDir(path.dirname(TOKEN_PATH));
  await fs.writeJson(TOKEN_PATH, tokenData, { spaces: 2 });
  return tokenData;
}

// --- Generate auth URL ---
function generateAuthUrl() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  if (!clientKey) {
    console.log('[tiktok] Set TIKTOK_CLIENT_KEY in .env first');
    return;
  }

  const redirectUri = encodeURIComponent(process.env.TIKTOK_REDIRECT_URI || 'https://marvelous-curiosity-production.up.railway.app/auth/tiktok/callback');
  const scope = encodeURIComponent('user.info.basic,video.publish,video.upload');

  const url = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=${scope}&response_type=code&redirect_uri=${redirectUri}`;

  console.log('[tiktok] Visit this URL to authorise:');
  console.log(url);
  console.log('\nThen run: node upload_tiktok.js token YOUR_CODE');
}

// --- Exchange code for token ---
async function exchangeCode(code) {
  const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', {
    client_key: process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: process.env.TIKTOK_REDIRECT_URI || 'https://marvelous-curiosity-production.up.railway.app/auth/tiktok/callback',
  });

  const tokenData = {
    ...response.data,
    expires_at: Date.now() + (response.data.expires_in * 1000),
  };

  await fs.ensureDir(path.dirname(TOKEN_PATH));
  await fs.writeJson(TOKEN_PATH, tokenData, { spaces: 2 });
  console.log('[tiktok] Token saved successfully!');
  return tokenData;
}

// --- Upload video to TikTok ---
async function uploadVideo(story) {
  const accessToken = await getAccessToken();

  if (!story.exported_path || !await fs.pathExists(story.exported_path)) {
    throw new Error(`Video file not found: ${story.exported_path}`);
  }

  const fileSize = (await fs.stat(story.exported_path)).size;

  // Build caption (TikTok max 2200 chars) — channel-aware hashtags
  const { getChannel } = require('./channels');
  const channel = getChannel();
  let caption = story.suggested_thumbnail_text || story.title;
  if (caption.length > 100) caption = caption.substring(0, 97) + '...';
  const tags = (channel.hashtags || []).join(' ') + ' #viral #fyp';
  caption += ' ' + tags;

  console.log(`[tiktok] Uploading: "${caption.substring(0, 60)}..."`);

  // Step 1: Init upload
  const initResponse = await axios.post(
    'https://open.tiktokapis.com/v2/post/publish/video/init/',
    {
      post_info: {
        title: caption,
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: fileSize,
        chunk_size: fileSize,
        total_chunk_count: 1,
      },
    },
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
    }
  );

  const { publish_id, upload_url } = initResponse.data.data;

  // Step 2: Upload video file
  const videoBuffer = await fs.readFile(story.exported_path);
  await axios.put(upload_url, videoBuffer, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': fileSize,
      'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`,
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  console.log(`[tiktok] Upload complete. Publish ID: ${publish_id}`);

  // Step 3: Check publish status (TikTok processes async)
  let status = 'PROCESSING';
  let attempts = 0;

  while (status === 'PROCESSING' && attempts < 30) {
    await new Promise(r => setTimeout(r, 10000));
    attempts++;

    try {
      const statusResponse = await axios.post(
        'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
        { publish_id },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      status = statusResponse.data.data?.status || 'UNKNOWN';
      console.log(`[tiktok] Status check ${attempts}: ${status}`);
    } catch (err) {
      console.log(`[tiktok] Status check failed: ${err.message}`);
    }
  }

  return {
    platform: 'tiktok',
    publishId: publish_id,
    status,
  };
}

// --- Batch upload all ready stories ---
async function uploadAll() {
  if (!await fs.pathExists('daily_news.json')) {
    console.log('[tiktok] No daily_news.json found');
    return [];
  }

  const stories = await fs.readJson('daily_news.json');
  const ready = stories.filter(s =>
    s.approved && s.exported_path && !s.tiktok_post_id
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
      await new Promise(r => setTimeout(r, 3000));
    } catch (err) {
      console.log(`[tiktok] Upload failed for ${story.id}: ${err.message}`);
      story.tiktok_error = err.message;
    }
  }

  await fs.writeJson('daily_news.json', stories, { spaces: 2 });
  console.log(`[tiktok] ${results.length} videos uploaded`);
  return results;
}

// Alias for publisher.js compatibility
async function uploadShort(story) {
  return uploadVideo(story);
}

module.exports = { uploadVideo, uploadShort, uploadAll, generateAuthUrl, exchangeCode };

if (require.main === module) {
  const cmd = process.argv[2];

  if (cmd === 'auth') {
    generateAuthUrl();
  } else if (cmd === 'token') {
    const code = process.argv[3];
    if (!code) {
      console.log('Usage: node upload_tiktok.js token YOUR_CODE');
      process.exit(1);
    }
    exchangeCode(code).catch(console.error);
  } else {
    uploadAll().catch(err => {
      console.log(`[tiktok] ERROR: ${err.message}`);
      process.exit(1);
    });
  }
}

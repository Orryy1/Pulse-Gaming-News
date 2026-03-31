/*
  Facebook Reels Upload via Graph API

  Setup:
  1. Create Facebook App at developers.facebook.com
  2. Add Facebook Login + Pages API permissions
  3. Get a Page Access Token with pages_manage_posts, pages_read_engagement
  4. Set env: FACEBOOK_PAGE_ID, FACEBOOK_PAGE_TOKEN
  5. Or save token to tokens/facebook_token.json

  Facebook Reels require the video be hosted at a public URL
  (same approach as Instagram — uses the Railway download endpoint).
*/

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config({ override: true });

const TOKEN_PATH = path.join(__dirname, 'tokens', 'facebook_token.json');

async function getAccessToken() {
  if (process.env.FACEBOOK_PAGE_TOKEN) return process.env.FACEBOOK_PAGE_TOKEN;

  if (await fs.pathExists(TOKEN_PATH)) {
    const tokenData = await fs.readJson(TOKEN_PATH);
    return tokenData.access_token;
  }

  throw new Error(
    'Facebook not authenticated.\n' +
    'Set FACEBOOK_PAGE_TOKEN in .env, or save token to tokens/facebook_token.json\n' +
    'Also set FACEBOOK_PAGE_ID'
  );
}

function getPageId() {
  const id = process.env.FACEBOOK_PAGE_ID;
  if (!id) throw new Error('FACEBOOK_PAGE_ID not set in .env');
  return id;
}

// --- Upload a Reel to Facebook ---
async function uploadReel(story) {
  const accessToken = await getAccessToken();
  const pageId = getPageId();

  if (!story.exported_path || !await fs.pathExists(story.exported_path)) {
    throw new Error(`Video file not found: ${story.exported_path}`);
  }

  const publicBaseUrl = process.env.RAILWAY_PUBLIC_URL || `http://localhost:${process.env.PORT || 3001}`;
  const videoUrl = `${publicBaseUrl}/api/download/${story.id}`;

  // Build description
  let description = story.suggested_thumbnail_text || story.title;
  description += '\n\n' + (story.full_script || '').substring(0, 300);
  description += '\n\n#gaming #gamingnews #gamingleaks #gamingcommunity #reels';
  if (description.length > 2000) description = description.substring(0, 1997) + '...';

  console.log(`[facebook] Uploading Reel: "${(story.title || '').substring(0, 50)}..."`);

  // Step 1: Initiate Reel upload
  const initResponse = await axios.post(
    `https://graph.facebook.com/v19.0/${pageId}/video_reels`,
    {
      upload_phase: 'start',
      access_token: accessToken,
    }
  );

  const videoId = initResponse.data.video_id;
  const uploadUrl = initResponse.data.upload_url;

  // Step 2: Upload the video binary
  const videoBuffer = await fs.readFile(story.exported_path);
  const fileSize = videoBuffer.length;

  await axios({
    method: 'POST',
    url: uploadUrl,
    headers: {
      'Authorization': `OAuth ${accessToken}`,
      'offset': '0',
      'file_size': fileSize.toString(),
      'Content-Type': 'application/octet-stream',
    },
    data: videoBuffer,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  // Step 3: Finish the upload and publish
  await axios.post(
    `https://graph.facebook.com/v19.0/${pageId}/video_reels`,
    {
      upload_phase: 'finish',
      video_id: videoId,
      title: (story.suggested_thumbnail_text || story.title || '').substring(0, 100),
      description,
      access_token: accessToken,
    }
  );

  console.log(`[facebook] Reel published! Video ID: ${videoId}`);

  return {
    platform: 'facebook',
    videoId,
  };
}

// --- Batch upload ---
async function uploadAll() {
  if (!await fs.pathExists('daily_news.json')) {
    console.log('[facebook] No daily_news.json found');
    return [];
  }

  const stories = await fs.readJson('daily_news.json');
  const ready = stories.filter(s =>
    s.approved && s.exported_path && !s.facebook_post_id
  );

  console.log(`[facebook] ${ready.length} videos ready for upload`);
  const results = [];

  for (const story of ready) {
    try {
      const result = await uploadReel(story);
      story.facebook_post_id = result.videoId;
      results.push(result);
      await new Promise(r => setTimeout(r, 10000));
    } catch (err) {
      console.log(`[facebook] Upload failed for ${story.id}: ${err.message}`);
      story.facebook_error = err.message;
    }
  }

  await fs.writeJson('daily_news.json', stories, { spaces: 2 });
  console.log(`[facebook] ${results.length} reels uploaded`);
  return results;
}

// Alias for publisher.js compatibility
async function uploadShort(story) {
  return uploadReel(story);
}

module.exports = { uploadReel, uploadShort, uploadAll };

if (require.main === module) {
  uploadAll().catch(err => {
    console.log(`[facebook] ERROR: ${err.message}`);
    process.exit(1);
  });
}

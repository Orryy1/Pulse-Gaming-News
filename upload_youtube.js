const fs = require('fs-extra');
const path = require('path');
const { google } = require('googleapis');
const dotenv = require('dotenv');

dotenv.config({ override: true });

const TOKEN_PATH = path.join(__dirname, 'tokens', 'youtube_token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'tokens', 'youtube_credentials.json');

// --- OAuth2 client setup ---
async function getAuthClient() {
  // Support env vars for cloud deployment (Railway)
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

  let client_id, client_secret, redirect_uri;

  if (await fs.pathExists(CREDENTIALS_PATH)) {
    const credentials = await fs.readJson(CREDENTIALS_PATH);
    const inst = credentials.installed || credentials.web || {};
    client_id = inst.client_id;
    client_secret = inst.client_secret;
    redirect_uri = inst.redirect_uris?.[0] || 'http://localhost';
  } else if (clientId && clientSecret) {
    client_id = clientId;
    client_secret = clientSecret;
    redirect_uri = 'http://localhost';
  } else {
    throw new Error(
      `YouTube credentials not found.\n` +
      'Set up OAuth2: https://console.cloud.google.com/apis/credentials\n' +
      '1. Create OAuth 2.0 Client ID (Desktop app)\n' +
      '2. Download JSON → save as tokens/youtube_credentials.json\n' +
      '3. Run: node upload_youtube.js auth'
    );
  }

  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

  // Load token from file or env var
  if (await fs.pathExists(TOKEN_PATH)) {
    const token = await fs.readJson(TOKEN_PATH);
    oauth2Client.setCredentials(token);

    if (token.expiry_date && Date.now() > token.expiry_date - 60000) {
      console.log('[youtube] Refreshing expired token...');
      const { credentials: newToken } = await oauth2Client.refreshAccessToken();
      await fs.ensureDir(path.dirname(TOKEN_PATH));
      await fs.writeJson(TOKEN_PATH, newToken, { spaces: 2 });
      oauth2Client.setCredentials(newToken);
    }

    return oauth2Client;
  } else if (refreshToken) {
    console.log('[youtube] Using refresh token from env...');
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
  }

  throw new Error(
    'YouTube not authenticated. Run: node upload_youtube.js auth\n' +
    'Then visit the URL and paste the code back.'
  );
}

// --- Generate auth URL for initial setup ---
async function generateAuthUrl() {
  const credentials = await fs.readJson(CREDENTIALS_PATH);
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web || {};

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob'
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube',
    ],
  });

  console.log('[youtube] Visit this URL to authorise:');
  console.log(url);
  console.log('\nThen run: node upload_youtube.js token YOUR_CODE_HERE');

  return { oauth2Client, url };
}

// --- Exchange auth code for token ---
async function exchangeCode(code) {
  const credentials = await fs.readJson(CREDENTIALS_PATH);
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web || {};

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob'
  );

  const { tokens } = await oauth2Client.getToken(code);
  await fs.ensureDir(path.dirname(TOKEN_PATH));
  await fs.writeJson(TOKEN_PATH, tokens, { spaces: 2 });
  console.log('[youtube] Token saved successfully!');
  return tokens;
}

// --- Build YouTube metadata (SEO-optimised for Shorts discovery) ---
function buildMetadata(story) {
  const brand = require('./brand');
  const classInfo = brand.classificationColour(story.classification || story.flair);

  // Title: prepend classification, under 60 chars, primary keyword front-loaded
  let baseTitle = story.suggested_thumbnail_text || story.title;
  baseTitle = baseTitle.replace(/#\s*shorts?\s*/gi, '').replace(/\[.*?\]\s*/g, '').trim();
  const prefix = `[${classInfo.label}] `;
  const maxTitleLen = 58 - prefix.length;
  if (baseTitle.length > maxTitleLen) baseTitle = baseTitle.substring(0, maxTitleLen - 3) + '...';
  const title = prefix + baseTitle;

  const gameName = extractGameName(story.title);
  const platform = detectPlatform(story.title + ' ' + (story.body || ''));

  const descLines = [];
  // First line: keyword-rich summary (most SEO weight)
  descLines.push(
    story.full_script
      ? story.full_script.substring(0, 150).replace(/\n/g, ' ').replace(/\[.*?\]/g, '').trim()
      : story.title
  );
  descLines.push('');
  if (story.affiliate_url) {
    descLines.push(`Check it out: ${story.affiliate_url}`);
    descLines.push('');
  }
  descLines.push(`${brand.CHANNEL_NAME} — ${brand.TAGLINE}`);
  descLines.push(brand.CTA ? brand.CTA.replace(/^Follow /i, 'Follow ') : 'Follow so you never miss an update.');
  descLines.push('');
  if (story.subreddit) {
    descLines.push(`Source: r/${story.subreddit}`);
    descLines.push('');
  }
  // Hashtags: from channel config + dynamic extras
  const { getChannel } = require('./channels');
  const channel = getChannel();
  const hashtags = [...(channel.hashtags || ['#Shorts'])];
  if (gameName) hashtags.push(`#${gameName.replace(/[^a-zA-Z0-9]/g, '')}`);
  if (platform) hashtags.push(`#${platform}`);
  descLines.push(hashtags.slice(0, 6).join(' '));

  const description = descLines.join('\n');

  const tags = [
    channel.niche + ' news', channel.name.toLowerCase(),
    gameName, platform,
    'youtube shorts', channel.niche + ' shorts',
    classInfo.label.toLowerCase(), story.content_pillar,
    ...(story.title.split(/\s+/).map(w => w.replace(/[^a-zA-Z0-9]/g, '')).filter(w => w.length > 3 && !/^(the|and|for|with|from|that|this|have|been|will|could|would)$/i.test(w)).slice(0, 5)),
  ].filter(Boolean);

  return { title, description, tags };
}

// --- Extract game name from title for hashtag ---
function extractGameName(title) {
  const patterns = [
    /\b(GTA\s*\d+|Grand Theft Auto\s*\d*)/i,
    /\b(Final Fantasy\s*\w*)/i, /\b(Zelda[\w\s]*)/i,
    /\b(Mario[\w\s]*)/i, /\b(Call of Duty[\w\s]*)/i,
    /\b(Halo[\w\s]*)/i, /\b(Fortnite)/i, /\b(Minecraft)/i,
    /\b(Elden Ring)/i, /\b(Starfield)/i, /\b(Cyberpunk\s*\d*)/i,
    /\b(Assassins? Creed[\w\s]*)/i, /\b(God of War[\w\s]*)/i,
    /\b(Spider-?Man[\w\s]*)/i, /\b(Resident Evil\s*\d*)/i,
    /\b(Pokemon|Pokémon[\w\s]*)/i, /\b(Doom[\w\s]*)/i,
    /\b(Fallout\s*\d*)/i, /\b(Elder Scrolls[\w\s]*)/i,
    /\b(Red Dead[\w\s]*)/i, /\b(Horizon[\w\s]*)/i,
    /\b(Hogwarts Legacy)/i, /\b(Diablo\s*\d*)/i,
    /\b(Overwatch\s*\d*)/i, /\b(Valorant)/i, /\b(Apex Legends)/i,
    /\b(Monster Hunter[\w\s]*)/i, /\b(Death Stranding[\w\s]*)/i,
    /\b(Metroid[\w\s]*)/i, /\b(Smash Bros[\w\s]*)/i,
    /\b(Fable[\w\s]*)/i, /\b(Avowed)/i, /\b(Silksong)/i,
    /\b(Hollow Knight[\w\s]*)/i, /\b(Persona\s*\d*)/i,
    /\b(Metal Gear[\w\s]*)/i, /\b(Silent Hill[\w\s]*)/i,
    /\b(Splinter Cell[\w\s]*)/i, /\b(BioShock[\w\s]*)/i,
    /\b(Half-?Life\s*\d*)/i, /\b(Portal\s*\d*)/i,
    /\b(Borderlands\s*\d*)/i, /\b(Dragon Age[\w\s]*)/i,
    /\b(Mass Effect[\w\s]*)/i, /\b(Witcher\s*\d*)/i,
  ];
  for (const pat of patterns) {
    const m = title.match(pat);
    if (m) return m[1].trim();
  }
  return null;
}

// --- Detect platform from text for hashtag ---
function detectPlatform(text) {
  if (/\b(PS5|PlayStation\s*5|Sony)/i.test(text)) return 'PlayStation';
  if (/\b(Xbox|Microsoft Gaming)/i.test(text)) return 'Xbox';
  if (/\b(Nintendo|Switch\s*2|Switch)/i.test(text)) return 'Nintendo';
  if (/\b(PC|Steam|Epic Games)/i.test(text)) return 'PCGaming';
  return null;
}

// --- Upload a single video as YouTube Short ---
async function uploadShort(story) {
  const auth = await getAuthClient();
  const youtube = google.youtube({ version: 'v3', auth });

  if (!story.exported_path || !await fs.pathExists(story.exported_path)) {
    throw new Error(`Video file not found: ${story.exported_path}`);
  }

  const { title, description, tags } = buildMetadata(story);

  console.log(`[youtube] Uploading: "${title}"`);

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description,
        tags,
        categoryId: require('./channels').getChannel().youtubeCategory || '20',
        defaultLanguage: 'en',
        defaultAudioLanguage: 'en',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
        embeddable: true,
      },
    },
    media: {
      body: fs.createReadStream(story.exported_path),
    },
  });

  const videoId = response.data.id;
  console.log(`[youtube] Uploaded: https://youtube.com/shorts/${videoId}`);

  // Post pinned comment
  if (story.pinned_comment) {
    try {
      const commentResponse = await youtube.commentThreads.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            videoId,
            topLevelComment: {
              snippet: {
                textOriginal: story.pinned_comment,
              },
            },
          },
        },
      });
      console.log(`[youtube] Pinned comment posted`);
    } catch (err) {
      console.log(`[youtube] Comment failed (non-critical): ${err.message}`);
    }
  }

  return {
    platform: 'youtube',
    videoId,
    url: `https://youtube.com/shorts/${videoId}`,
  };
}

// --- Batch upload all ready stories ---
async function uploadAll() {
  if (!await fs.pathExists('daily_news.json')) {
    console.log('[youtube] No daily_news.json found');
    return [];
  }

  const stories = await fs.readJson('daily_news.json');
  const ready = stories.filter(s =>
    s.approved && s.exported_path && !s.youtube_post_id
  );

  console.log(`[youtube] ${ready.length} videos ready for upload`);

  const results = [];

  for (const story of ready) {
    try {
      const result = await uploadShort(story);
      story.youtube_post_id = result.videoId;
      story.youtube_url = result.url;
      story.publish_status = 'published';
      results.push(result);

      // Respect YouTube API quota (10000 units/day, upload = 1600 units)
      await new Promise(r => setTimeout(r, 5000));
    } catch (err) {
      console.log(`[youtube] Upload failed for ${story.id}: ${err.message}`);
      story.publish_error = err.message;
    }
  }

  await fs.writeJson('daily_news.json', stories, { spaces: 2 });
  console.log(`[youtube] ${results.length} videos uploaded`);
  return results;
}

module.exports = { uploadShort, uploadAll, generateAuthUrl, exchangeCode, getAuthClient };

if (require.main === module) {
  const cmd = process.argv[2];

  if (cmd === 'auth') {
    generateAuthUrl().catch(console.error);
  } else if (cmd === 'token') {
    const code = process.argv[3];
    if (!code) {
      console.log('Usage: node upload_youtube.js token YOUR_AUTH_CODE');
      process.exit(1);
    }
    exchangeCode(code).catch(console.error);
  } else {
    uploadAll().catch(err => {
      console.log(`[youtube] ERROR: ${err.message}`);
      process.exit(1);
    });
  }
}

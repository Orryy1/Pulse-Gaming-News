const fs = require('fs-extra');
const path = require('path');
const { google } = require('googleapis');
const dotenv = require('dotenv');
const { withRetry } = require('./lib/retry');
const { addBreadcrumb, captureException } = require('./lib/sentry');
const db = require('./lib/db');

dotenv.config({ override: true });

const TOKEN_PATH = path.join(__dirname, 'tokens', 'youtube_token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'tokens', 'youtube_credentials.json');
const PLAYLIST_PATH = path.join(__dirname, 'tokens', 'youtube_playlists.json');

// --- Playlist definitions ---
const PLAYLIST_DEFS = [
  { key: 'breaking', title: 'Breaking Gaming News', desc: 'The biggest breaking stories in gaming — delivered fast. Follow Pulse Gaming so you never miss a beat.' },
  { key: 'leaks_rumours', title: 'Gaming Leaks & Rumours', desc: 'The latest gaming leaks, insider info and rumours — all in one place. Follow Pulse Gaming so you never miss a beat.' },
  { key: 'confirmed', title: 'Confirmed Gaming News', desc: 'Verified, confirmed gaming news you can trust. Follow Pulse Gaming so you never miss a beat.' },
  { key: 'all_shorts', title: 'All Pulse Gaming Shorts', desc: 'Every Pulse Gaming Short in one playlist. Sit back, hit play and catch up on everything. Follow Pulse Gaming so you never miss a beat.' },
];

// Map classification tags to playlist keys
function getPlaylistKeys(classification) {
  const c = (classification || '').toLowerCase();
  const keys = ['all_shorts']; // every video goes here
  if (c.includes('breaking')) keys.unshift('breaking');
  else if (c.includes('leak') || c.includes('rumor') || c.includes('rumour')) keys.unshift('leaks_rumours');
  else if (c.includes('confirmed')) keys.unshift('confirmed');
  return keys;
}

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

  // Title: use A/B tested variant if available, else LLM-generated curiosity gap title
  // No classification prefix — wastes characters and weakens curiosity gap hooks
  const { getBestTitle } = require('./ab_titles');
  let baseTitle = getBestTitle(story);
  baseTitle = baseTitle.replace(/#\s*shorts?\s*/gi, '').replace(/\[.*?\]\s*/g, '').trim();
  if (baseTitle.length > 80) baseTitle = baseTitle.substring(0, 77) + '...';
  const title = baseTitle;

  const gameName = extractGameName(story.title);
  const platform = detectPlatform(story.title + ' ' + (story.body || ''));

  const { getChannel } = require('./channels');
  const channel = getChannel();

  const descLines = [];

  // --- Section 1: Keyword-rich summary (most SEO weight — first 200 chars indexed) ---
  if (story.full_script) {
    const clean = story.full_script.replace(/\n/g, ' ').replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim();
    const cutoff = clean.substring(0, 300);
    // Find the LAST sentence boundary within 300 chars (not the first)
    let lastSentence = -1;
    const re = /[.!?]\s+(?=[A-Z])/g;
    let m;
    while ((m = re.exec(cutoff)) !== null) lastSentence = m.index;
    if (lastSentence > 80) {
      descLines.push(cutoff.substring(0, lastSentence + 1).trim());
    } else {
      const lastSpace = cutoff.lastIndexOf(' ');
      descLines.push(lastSpace > 80 ? cutoff.substring(0, lastSpace).trim() : cutoff.trim());
    }
  } else {
    descLines.push(story.title);
  }
  descLines.push('');

  // --- Section 2: Affiliate CTA ---
  if (story.affiliate_url) {
    descLines.push(`Check it out: ${story.affiliate_url}`);
    descLines.push('');
  }

  // --- Section 3: Channel identity ---
  descLines.push(`${brand.CHANNEL_NAME} — ${brand.TAGLINE}`);
  descLines.push(brand.CTA ? brand.CTA.replace(/^Follow /i, 'Follow ') : 'Follow so you never miss an update.');
  descLines.push('');

  // --- Section 4: Social links ---
  const socials = channel.socials || {};
  if (Object.keys(socials).length > 0) {
    if (socials.tiktok) descLines.push(`TikTok: ${socials.tiktok}`);
    if (socials.instagram) descLines.push(`Instagram: ${socials.instagram}`);
    if (socials.twitter) descLines.push(`X/Twitter: ${socials.twitter}`);
    if (socials.threads) descLines.push(`Threads: ${socials.threads}`);
    descLines.push('');
  }

  // --- Section 5: Sources ---
  const sourceLinks = [];
  if (story.url && story.url.startsWith('http')) sourceLinks.push(story.url);
  if (story.article_url && story.article_url.startsWith('http') && story.article_url !== story.url) {
    sourceLinks.push(story.article_url);
  }
  if (sourceLinks.length > 0 || story.subreddit) {
    descLines.push('======================');
    descLines.push('Sources:');
    if (story.subreddit) descLines.push(`r/${story.subreddit}`);
    sourceLinks.forEach(link => descLines.push(link));
    descLines.push('======================');
    descLines.push('');
  }

  // --- Section 6: Hashtags (dynamic — company/game specific + channel defaults) ---
  const hashtags = [...(channel.hashtags || ['#Shorts'])];
  if (gameName) hashtags.push(`#${gameName.replace(/[^a-zA-Z0-9]/g, '')}`);
  if (platform) hashtags.push(`#${platform}`);
  // Add company hashtags from story detection
  if (story.company_name) {
    const companyTag = `#${story.company_name.replace(/[^a-zA-Z0-9]/g, '')}`;
    if (!hashtags.some(h => h.toLowerCase() === companyTag.toLowerCase())) {
      hashtags.push(companyTag);
    }
  }
  descLines.push(hashtags.slice(0, 8).join(' '));

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

// --- Ensure playlists exist on YouTube (creates if missing, caches IDs) ---
async function ensurePlaylists(youtube) {
  // Load cached playlist IDs
  let cached = {};
  if (await fs.pathExists(PLAYLIST_PATH)) {
    cached = await fs.readJson(PLAYLIST_PATH);
  }

  // Check if all playlists are already cached
  const allCached = PLAYLIST_DEFS.every(p => cached[p.key]);
  if (allCached) return cached;

  // Fetch existing playlists from channel to avoid duplicates
  const existing = {};
  try {
    let pageToken = null;
    do {
      const res = await youtube.playlists.list({
        part: ['snippet'],
        mine: true,
        maxResults: 50,
        pageToken,
      });
      for (const item of res.data.items || []) {
        existing[item.snippet.title] = item.id;
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken);
  } catch (err) {
    console.log(`[youtube] Could not list playlists: ${err.message}`);
  }

  // Create missing playlists
  for (const def of PLAYLIST_DEFS) {
    if (cached[def.key]) continue;

    // Check if it already exists on the channel
    if (existing[def.title]) {
      cached[def.key] = existing[def.title];
      console.log(`[youtube] Found existing playlist: ${def.title} (${existing[def.title]})`);
      continue;
    }

    try {
      const res = await youtube.playlists.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: { title: def.title, description: def.desc },
          status: { privacyStatus: 'public' },
        },
      });
      cached[def.key] = res.data.id;
      console.log(`[youtube] Created playlist: ${def.title} (${res.data.id})`);
    } catch (err) {
      console.log(`[youtube] Failed to create playlist "${def.title}": ${err.message}`);
    }
  }

  await fs.ensureDir(path.dirname(PLAYLIST_PATH));
  await fs.writeJson(PLAYLIST_PATH, cached, { spaces: 2 });
  return cached;
}

// --- Add a video to playlists based on its classification ---
async function addToPlaylists(youtube, videoId, classification) {
  let playlists = {};
  if (await fs.pathExists(PLAYLIST_PATH)) {
    playlists = await fs.readJson(PLAYLIST_PATH);
  }

  const keys = getPlaylistKeys(classification);
  const added = [];

  for (const key of keys) {
    const playlistId = playlists[key];
    if (!playlistId) continue;

    try {
      await youtube.playlistItems.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            playlistId,
            resourceId: { kind: 'youtube#video', videoId },
          },
        },
      });
      added.push(key);
    } catch (err) {
      console.log(`[youtube] Failed to add to ${key} playlist: ${err.message}`);
    }
  }

  if (added.length > 0) {
    console.log(`[youtube] Added to playlists: ${added.join(', ')}`);
  }
  return added;
}

// --- Upload a single video as YouTube Short ---
async function uploadShort(story) {
  addBreadcrumb(`YouTube upload: ${story.title}`, 'upload');
  return withRetry(async () => {
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

    // Add to playlists based on classification
    try {
      await ensurePlaylists(youtube);
      await addToPlaylists(youtube, videoId, story.classification);
    } catch (err) {
      console.log(`[youtube] Playlist assignment failed (non-critical): ${err.message}`);
    }

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
  }, { label: 'youtube upload' });
}

// --- Batch upload all ready stories ---
async function uploadAll() {
  const stories = await db.getStories();
  if (!stories.length) {
    console.log('[youtube] No stories found');
    return [];
  }

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
      captureException(err, { platform: 'youtube', storyId: story.id });
      console.log(`[youtube] Upload failed for ${story.id}: ${err.message}`);
      story.publish_error = err.message;
    }
  }

  await db.saveStories(stories);
  console.log(`[youtube] ${results.length} videos uploaded`);
  return results;
}

// --- Upload a longform compilation as a regular YouTube video (NOT a Short) ---
async function uploadLongform(compilation) {
  const auth = await getAuthClient();
  const youtube = google.youtube({ version: 'v3', auth });
  const brand = require('./brand');
  const { getChannel } = require('./channels');
  const channel = getChannel();

  const videoPath = compilation.output_path || compilation.outputPath;
  if (!videoPath || !await fs.pathExists(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  // Title: "Gaming News Roundup — Week of April 5, 2026"
  const titleDate = compilation.title_date || new Date().toLocaleDateString('en-GB', { month: 'long', day: 'numeric', year: 'numeric' });
  const title = `${channel.niche.charAt(0).toUpperCase() + channel.niche.slice(1)} News Roundup — Week of ${titleDate}`;

  // Description with chapter timestamps
  const descLines = [];
  descLines.push(`The biggest ${channel.niche} stories of the week, compiled and covered by ${channel.name}.`);
  descLines.push('');

  // Chapter timestamps
  if (compilation.chapter_timestamps && compilation.chapter_timestamps.length > 0) {
    for (const ch of compilation.chapter_timestamps) {
      descLines.push(`${ch.time} ${ch.title}`);
    }
    descLines.push('');
  }

  descLines.push(`${brand.CHANNEL_NAME} — ${brand.TAGLINE}`);
  descLines.push(brand.CTA ? brand.CTA : 'Subscribe so you never miss a roundup.');
  descLines.push('');

  const hashtags = (channel.hashtags || [])
    .filter(h => !h.toLowerCase().includes('shorts'))
    .slice(0, 5);
  hashtags.push('#WeeklyRoundup');
  descLines.push(hashtags.join(' '));

  const description = descLines.join('\n');

  const tags = [
    channel.niche + ' news roundup', channel.name.toLowerCase(),
    'weekly roundup', channel.niche + ' weekly',
    channel.niche + ' news compilation',
    'gaming news this week',
  ].filter(Boolean);

  console.log(`[youtube] Uploading longform: "${title}"`);

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description,
        tags,
        categoryId: channel.youtubeCategory || '20',
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
      body: fs.createReadStream(videoPath),
    },
  });

  const videoId = response.data.id;
  const url = `https://youtube.com/watch?v=${videoId}`;
  console.log(`[youtube] Longform uploaded: ${url}`);

  return {
    platform: 'youtube',
    videoId,
    url,
  };
}

module.exports = { uploadShort, uploadAll, uploadLongform, generateAuthUrl, exchangeCode, getAuthClient, ensurePlaylists, addToPlaylists };

if (require.main === module) {
  const cmd = process.argv[2];

  if (cmd === 'playlists') {
    (async () => {
      const auth = await getAuthClient();
      const youtube = google.youtube({ version: 'v3', auth });
      const ids = await ensurePlaylists(youtube);
      console.log('[youtube] Playlist IDs:', JSON.stringify(ids, null, 2));
    })().catch(console.error);
  } else if (cmd === 'auth') {
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

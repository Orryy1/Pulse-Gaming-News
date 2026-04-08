const fs = require('fs-extra');
const path = require('path');
const { google } = require('googleapis');
const dotenv = require('dotenv');

dotenv.config({ override: true });

const TOKEN_PATH = path.join(__dirname, '..', 'tokens', 'orryy_token.json');
const CREDENTIALS_PATH = path.join(__dirname, '..', 'tokens', 'youtube_credentials.json');
const PROGRESS_PATH = path.join(__dirname, '..', 'output', 'update_progress.json');
const ARTIST_CACHE_PATH = path.join(__dirname, '..', 'output', 'artist_cache.json');

// Standard boilerplate sections
const ORRYY_HEADER = `👑Orryy🦁 Providing you with all the top Scottish dance anthems as they are released! 🔊🔥

❕ Join the Notification Team, click the 🔔 Bell

👍 If you enjoy this song, please give it a like! ✔️

This video was fully made by me, the images used are copyright-free and the track has been bass boosted for your listening pleasure! 🔊

© Any copyright issues, just get in touch and I'll be happy to sort it out for you.`;

const DIVIDER = '▪️◽◼️◽▪️◽◼️◽▪️◽◼️◽▪️◽◼️◽▪️';

const SUBMISSIONS = `💬 SUBMISSIONS! 💬
If you would like to submit either your own track or a request for a song for upload to the channel, fill in this quick form
↪︎ https://goo.gl/VGK6g2`;

const ORRYY_SOCIALS = `Follow Orryy ❤️
» Spotify: https://open.spotify.com/artist/6WeDe0rp3fWjfOGPoHCcId
» Instagram: https://www.instagram.com/OrryyYT
» Soundcloud: https://soundcloud.com/Orryy1
» Facebook: https://www.facebook.com/OrryyYT
» Twitter: https://twitter.com/OrryyYT`;

async function getAuthClient() {
  const credentials = await fs.readJson(CREDENTIALS_PATH);
  const inst = credentials.installed || credentials.web || {};
  const oauth2Client = new google.auth.OAuth2(
    inst.client_id,
    inst.client_secret,
    inst.redirect_uris?.[0] || 'http://localhost'
  );
  const token = await fs.readJson(TOKEN_PATH);
  oauth2Client.setCredentials(token);

  if (token.expiry_date && Date.now() > token.expiry_date - 60000) {
    console.log('Refreshing expired token...');
    const { credentials: newToken } = await oauth2Client.refreshAccessToken();
    await fs.writeJson(TOKEN_PATH, newToken, { spaces: 2 });
    oauth2Client.setCredentials(newToken);
  }

  return oauth2Client;
}

// Parse title to extract artist and remixer
function parseTitle(title) {
  // Common patterns:
  // "Artist - Song Title (Remixer Remix)"
  // "Artist - Song Title (Original Mix)"
  // "Artist - Song Title (Remixer Bootleg)"
  // "Artist ft. Someone - Song Title (Remixer Remix)"
  // "Artist x Artist2 - Song Title"
  // Some titles don't follow the pattern at all

  let artist = null;
  let remixer = null;
  let songTitle = null;

  // Try standard "Artist - Song (Remix info)" pattern
  const dashMatch = title.match(/^(.+?)\s*[---]\s*(.+)$/);
  if (dashMatch) {
    artist = dashMatch[1].trim();
    const remainder = dashMatch[2].trim();

    // Extract remix/bootleg info from parentheses
    const remixMatch = remainder.match(/\((.+?)\s+(remix|bootleg|rework|edit|mix|flip|VIP)\)/i);
    if (remixMatch) {
      const remixerName = remixMatch[1].trim();
      // "Original Mix" means no remixer
      if (remixerName.toLowerCase() !== 'original') {
        remixer = remixerName;
      }
      songTitle = remainder.replace(/\s*\(.+?\)\s*$/, '').trim();
    } else {
      // Check for "(Original Mix)"
      const origMatch = remainder.match(/\(Original Mix\)/i);
      if (origMatch) {
        songTitle = remainder.replace(/\s*\(Original Mix\)\s*/i, '').trim();
      } else {
        songTitle = remainder.replace(/\s*\(.+?\)\s*$/, '').trim() || remainder;
      }
    }
  }

  // Clean up artist - handle "ft.", "feat.", "x", "&"
  let featuredArtists = [];
  if (artist) {
    // Extract featured artists
    const featMatch = artist.match(/(.+?)\s+(?:ft\.?|feat\.?|featuring)\s+(.+)/i);
    if (featMatch) {
      artist = featMatch[1].trim();
      featuredArtists.push(featMatch[2].trim());
    }

    // Handle "x" collaborations
    const xMatch = artist.match(/(.+?)\s+x\s+(.+)/i);
    if (xMatch && !artist.toLowerCase().includes('dj')) {
      artist = xMatch[1].trim();
      featuredArtists.push(xMatch[2].trim());
    }
  }

  return { artist, remixer, songTitle, featuredArtists };
}

// Generate hashtag from title
function generateHashtag(title, artist, songTitle) {
  if (songTitle) {
    return '#' + songTitle.replace(/[^a-zA-Z0-9]/g, '');
  }
  if (artist) {
    return '#' + artist.replace(/[^a-zA-Z0-9]/g, '');
  }
  // Fallback - use first meaningful word from title
  const words = title.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  return '#' + (words[0] || 'Dance');
}

// Check if description already has all required sections
function isComplete(description) {
  const hasCredits = description.includes('Support ') && description.includes('💙');
  const hasSocials = description.includes('Follow Orryy');
  const hasSubs = description.includes('SUBMISSIONS');
  const hasDividers = description.includes('▪️◽◼️◽▪️');
  const hasHeader = description.includes('👑Orryy🦁');
  return hasCredits && hasSocials && hasSubs && hasDividers && hasHeader;
}

// Extract existing SEO intro and chapters from a description
function extractExistingContent(description) {
  const lines = description.split('\n');
  let seoIntro = '';
  let chapters = '';
  let rest = '';

  let inChapters = false;
  let seoLines = [];
  let chapterLines = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Check if this is a chapter timestamp line
    if (/^\d{1,2}:\d{2}/.test(trimmed)) {
      inChapters = true;
      chapterLines.push(line);
      continue;
    }

    // If we were in chapters and hit a non-chapter line, chapters are done
    if (inChapters && trimmed && !/^\d{1,2}:\d{2}/.test(trimmed)) {
      inChapters = false;
    }

    // Skip the old footer line
    if (trimmed.includes('Subscribe for the latest') || trimmed.includes('youtube.com/Orryy')) {
      continue;
    }
    if (trimmed === '----------------------------------------') {
      continue;
    }
    if (trimmed.startsWith('Chapters:')) {
      continue;
    }

    // Everything else before chapters is SEO intro
    if (!inChapters && chapterLines.length === 0) {
      seoLines.push(line);
    }
  }

  seoIntro = seoLines.join('\n').trim();
  chapters = chapterLines.length > 0 ? chapterLines.join('\n') : '';

  return { seoIntro, chapters };
}

// Build the new description
function buildDescription(video, artistData) {
  const { title, description } = video;
  const { artist, remixer, songTitle, featuredArtists } = parseTitle(title);
  const { seoIntro, chapters } = extractExistingContent(description);

  const hashtag = generateHashtag(title, artist, songTitle);
  const allArtists = [artist, ...featuredArtists].filter(Boolean);

  let parts = [];

  // 1. SEO intro paragraph (keep existing or use title as fallback)
  if (seoIntro) {
    parts.push(seoIntro);
  } else {
    // Fallback: just use the title
    parts.push(title);
  }

  parts.push(''); // blank line

  // 2. Standard header
  parts.push(ORRYY_HEADER);
  parts.push('');
  parts.push(`#Orryy #ScottishAnthems ${hashtag}`);
  parts.push('');

  // 3. Chapters (if they exist)
  if (chapters) {
    parts.push(chapters);
    parts.push('');
  }

  // 4. First divider
  parts.push(DIVIDER);
  parts.push('');

  // 5. Submissions
  parts.push(SUBMISSIONS);
  parts.push('');

  // 6. Orryy socials
  parts.push(ORRYY_SOCIALS);
  parts.push('');

  // 7. Artist credits
  if (allArtists.length > 0 || remixer) {
    const creditNames = [...allArtists];
    if (remixer && !creditNames.includes(remixer)) {
      creditNames.push(remixer);
    }
    const creditLine = creditNames.join(' & ');
    parts.push(`Support ${creditLine} 💙`);

    for (const a of allArtists) {
      parts.push(`» ${a}`);
      // Add cached social links if available
      if (artistData && artistData[a.toLowerCase()]) {
        const links = artistData[a.toLowerCase()];
        if (links.youtube) parts.push(`  ↪︎ @${links.youtube}`);
        if (links.soundcloud) parts.push(`  ↪︎ ${links.soundcloud}`);
        if (links.tiktok) parts.push(`  ↪︎ ${links.tiktok}`);
        if (links.instagram) parts.push(`  ↪︎ ${links.instagram}`);
        if (links.spotify) parts.push(`  ↪︎ ${links.spotify}`);
      }
    }

    if (remixer && !allArtists.map(a => a.toLowerCase()).includes(remixer.toLowerCase())) {
      parts.push(`» ${remixer}`);
      if (artistData && artistData[remixer.toLowerCase()]) {
        const links = artistData[remixer.toLowerCase()];
        if (links.youtube) parts.push(`  ↪︎ @${links.youtube}`);
        if (links.soundcloud) parts.push(`  ↪︎ ${links.soundcloud}`);
        if (links.tiktok) parts.push(`  ↪︎ ${links.tiktok}`);
        if (links.instagram) parts.push(`  ↪︎ ${links.instagram}`);
        if (links.spotify) parts.push(`  ↪︎ ${links.spotify}`);
      }
    }

    parts.push('');
  }

  // 8. Second divider
  parts.push(DIVIDER);

  return parts.join('\n');
}

// Load progress tracking
async function loadProgress() {
  if (await fs.pathExists(PROGRESS_PATH)) {
    return await fs.readJson(PROGRESS_PATH);
  }
  return { updated: [], failed: [], skipped: [] };
}

async function saveProgress(progress) {
  await fs.writeJson(PROGRESS_PATH, progress, { spaces: 2 });
}

// Load artist cache
async function loadArtistCache() {
  if (await fs.pathExists(ARTIST_CACHE_PATH)) {
    return await fs.readJson(ARTIST_CACHE_PATH);
  }
  return {};
}

async function saveArtistCache(cache) {
  await fs.writeJson(ARTIST_CACHE_PATH, cache, { spaces: 2 });
}

// Delay helper
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const startFrom = parseInt(process.argv[2] || '0', 10);
  const batchSize = parseInt(process.argv[3] || '536', 10);

  const auth = await getAuthClient();
  const youtube = google.youtube({ version: 'v3', auth });

  // Load all videos
  const allVideos = await fs.readJson(path.join(__dirname, '..', 'output', 'all_videos.json'));
  const artistData = await loadArtistCache();
  const progress = await loadProgress();
  const alreadyDone = new Set(progress.updated.map(u => u.videoId));

  console.log(`Total videos: ${allVideos.length}`);
  console.log(`Already updated: ${alreadyDone.size}`);
  console.log(`Starting from index: ${startFrom}, batch size: ${batchSize}\n`);

  let updateCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (let i = startFrom; i < Math.min(allVideos.length, startFrom + batchSize); i++) {
    const video = allVideos[i];

    // Skip if already done
    if (alreadyDone.has(video.videoId)) {
      console.log(`[${i + 1}/${allVideos.length}] SKIP (already done): ${video.title}`);
      skipCount++;
      continue;
    }

    // Skip if already complete
    if (isComplete(video.description)) {
      console.log(`[${i + 1}/${allVideos.length}] SKIP (complete): ${video.title}`);
      progress.skipped.push({ videoId: video.videoId, title: video.title, reason: 'already_complete' });
      skipCount++;
      continue;
    }

    try {
      // Build new description
      const newDescription = buildDescription(video, artistData);

      // Fetch current video data (need categoryId, tags)
      const current = await youtube.videos.list({
        part: 'snippet',
        id: video.videoId,
      });

      if (!current.data.items || current.data.items.length === 0) {
        console.log(`[${i + 1}/${allVideos.length}] SKIP (not found): ${video.title}`);
        progress.failed.push({ videoId: video.videoId, title: video.title, error: 'Video not found' });
        failCount++;
        continue;
      }

      const currentVideo = current.data.items[0];

      // Update
      await youtube.videos.update({
        part: 'snippet',
        requestBody: {
          id: video.videoId,
          snippet: {
            title: currentVideo.snippet.title,
            description: newDescription,
            categoryId: currentVideo.snippet.categoryId,
            tags: currentVideo.snippet.tags || [],
          },
        },
      });

      console.log(`[${i + 1}/${allVideos.length}] ✓ UPDATED: ${video.title}`);
      progress.updated.push({
        videoId: video.videoId,
        title: video.title,
        timestamp: new Date().toISOString(),
      });
      updateCount++;
      await saveProgress(progress);

      // Rate limit - YouTube API quota: videos.list=1unit, videos.update=50units
      // 10,000 daily quota / 51 units per video ≈ 196 videos per day
      // Add 1s delay between updates to avoid rate limiting
      await delay(1000);

    } catch (err) {
      const errorMsg = err.message || String(err);
      console.error(`[${i + 1}/${allVideos.length}] ✗ FAILED: ${video.title} - ${errorMsg}`);
      progress.failed.push({ videoId: video.videoId, title: video.title, error: errorMsg });
      failCount++;
      await saveProgress(progress);

      // If quota exceeded, stop immediately
      if (errorMsg.includes('quota') || errorMsg.includes('rateLimitExceeded')) {
        console.error('\n⚠️  YouTube API quota exceeded. Run again tomorrow.');
        console.log(`\nTo resume: node scripts/bulk_update_descriptions.js ${i}`);
        // Remove this from failed list since it's a quota issue, not a real failure
        progress.failed = progress.failed.filter(f => !f.error.includes('quota'));
        await saveProgress(progress);
        break;
      }

      // Brief delay on error
      await delay(2000);
    }
  }

  console.log(`\n--- SUMMARY ---`);
  console.log(`Updated: ${updateCount}`);
  console.log(`Skipped: ${skipCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`Total progress: ${progress.updated.length} / ${allVideos.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});

/**
 * Resume script for updating Orryy YouTube descriptions.
 *
 * Picks up where bulk_update_descriptions.js left off by:
 * 1. Loading the artist cache (social links found by research)
 * 2. Loading progress tracking (skips already-updated videos)
 * 3. Rebuilding descriptions with artist socials included
 * 4. Updating remaining videos via YouTube API
 *
 * Usage: node scripts/resume_updates.js
 *
 * The script will:
 * - Skip videos already marked as updated in output/update_progress.json
 * - Use artist socials from output/artist_cache.json
 * - Stop gracefully on quota exhaustion
 * - Save progress after each successful update
 */

const fs = require('fs-extra');
const path = require('path');
const { google } = require('googleapis');
const dotenv = require('dotenv');

dotenv.config({ override: true });

const TOKEN_PATH = path.join(__dirname, '..', 'tokens', 'orryy_token.json');
const CREDENTIALS_PATH = path.join(__dirname, '..', 'tokens', 'youtube_credentials.json');
const PROGRESS_PATH = path.join(__dirname, '..', 'output', 'update_progress.json');
const ARTIST_CACHE_PATH = path.join(__dirname, '..', 'output', 'artist_cache.json');
const LYRICS_CACHE_PATH = path.join(__dirname, '..', 'output', 'lyrics_cache.json');

// Import shared functions from bulk script
const {
  ORRYY_HEADER, DIVIDER, SUBMISSIONS, ORRYY_SOCIALS,
  parseTitle, generateHashtag, isComplete, extractExistingContent
} = (() => {
  // Inline the constants and functions
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

  function parseTitle(title) {
    let artist = null, remixer = null, songTitle = null, featuredArtists = [];
    const dashMatch = title.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (dashMatch) {
      artist = dashMatch[1].trim();
      const remainder = dashMatch[2].trim();
      const remixMatch = remainder.match(/\((.+?)\s+(remix|bootleg|rework|edit|mix|flip|VIP)\)/i);
      if (remixMatch) {
        const r = remixMatch[1].trim();
        if (r.toLowerCase() !== 'original') remixer = r;
        songTitle = remainder.replace(/\s*\(.+?\)\s*$/, '').trim();
      } else {
        const origMatch = remainder.match(/\(Original Mix\)/i);
        if (origMatch) {
          songTitle = remainder.replace(/\s*\(Original Mix\)\s*/i, '').trim();
        } else {
          songTitle = remainder.replace(/\s*\(.+?\)\s*$/, '').trim() || remainder;
        }
      }
      const featMatch = artist.match(/(.+?)\s+(?:ft\.?|feat\.?|featuring)\s+(.+)/i);
      if (featMatch) {
        artist = featMatch[1].trim();
        featuredArtists.push(featMatch[2].trim());
      }
      const xMatch = artist.match(/(.+?)\s+x\s+(.+)/i);
      if (xMatch && !artist.toLowerCase().includes('dj')) {
        artist = xMatch[1].trim();
        featuredArtists.push(xMatch[2].trim());
      }
    }
    return { artist, remixer, songTitle, featuredArtists };
  }

  function generateHashtag(title, artist, songTitle) {
    if (songTitle) return '#' + songTitle.replace(/[^a-zA-Z0-9]/g, '');
    if (artist) return '#' + artist.replace(/[^a-zA-Z0-9]/g, '');
    const words = title.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
    return '#' + (words[0] || 'Dance');
  }

  function isComplete(description) {
    const hasCredits = description.includes('Support ') && description.includes('💙');
    const hasSocials = description.includes('Follow Orryy');
    const hasSubs = description.includes('SUBMISSIONS');
    const hasDividers = description.includes('▪️◽◼️◽▪️');
    const hasHeader = description.includes('👑Orryy🦁');
    return hasCredits && hasSocials && hasSubs && hasDividers && hasHeader;
  }

  function extractExistingContent(description) {
    const lines = description.split('\n');
    let seoLines = [];
    let chapterLines = [];
    let inChapters = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^\d{1,2}:\d{2}/.test(trimmed)) { inChapters = true; chapterLines.push(line); continue; }
      if (inChapters && trimmed && !/^\d{1,2}:\d{2}/.test(trimmed)) inChapters = false;
      if (trimmed.includes('Subscribe for the latest') || trimmed.includes('youtube.com/Orryy')) continue;
      if (trimmed === '----------------------------------------') continue;
      if (trimmed.startsWith('Chapters:')) continue;
      if (!inChapters && chapterLines.length === 0) seoLines.push(line);
    }
    return { seoIntro: seoLines.join('\n').trim(), chapters: chapterLines.length > 0 ? chapterLines.join('\n') : '' };
  }

  return { ORRYY_HEADER, DIVIDER, SUBMISSIONS, ORRYY_SOCIALS, parseTitle, generateHashtag, isComplete, extractExistingContent };
})();

function buildDescription(video, artistData, lyricsData) {
  const { title, description } = video;
  const { artist, remixer, songTitle, featuredArtists } = parseTitle(title);
  const { seoIntro, chapters } = extractExistingContent(description);
  const hashtag = generateHashtag(title, artist, songTitle);
  const allArtists = [artist, ...featuredArtists].filter(Boolean);

  let parts = [];

  // 1. SEO intro
  parts.push(seoIntro || title);
  parts.push('');

  // 2. Standard header
  parts.push(ORRYY_HEADER);
  parts.push('');
  parts.push(`#Orryy #ScottishAnthems ${hashtag}`);
  parts.push('');

  // 3. Chapters
  if (chapters) { parts.push(chapters); parts.push(''); }

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
    if (remixer && !creditNames.includes(remixer)) creditNames.push(remixer);
    parts.push(`Support ${creditNames.join(' & ')} 💙`);

    for (const a of allArtists) {
      parts.push(`» ${a}`);
      const key = a.toLowerCase();
      if (artistData && artistData[key]) {
        const links = artistData[key];
        if (links.youtube) parts.push(`  ↪︎ @${links.youtube}`);
        if (links.soundcloud) parts.push(`  ↪︎ ${links.soundcloud}`);
        if (links.tiktok) parts.push(`  ↪︎ ${links.tiktok}`);
        if (links.instagram) parts.push(`  ↪︎ ${links.instagram}`);
        if (links.spotify) parts.push(`  ↪︎ ${links.spotify}`);
      }
    }
    if (remixer && !allArtists.map(a => a.toLowerCase()).includes(remixer.toLowerCase())) {
      parts.push(`» ${remixer}`);
      const key = remixer.toLowerCase();
      if (artistData && artistData[key]) {
        const links = artistData[key];
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

  // 9. Lyrics (if available)
  const lyricsKey = songTitle ? `${(artist || '').toLowerCase()}_${songTitle.toLowerCase()}` : null;
  if (lyricsKey && lyricsData && lyricsData[lyricsKey]) {
    parts.push('');
    parts.push('🎤 LYRICS 🎵');
    parts.push('');
    parts.push(lyricsData[lyricsKey]);
    parts.push('');
    parts.push(DIVIDER);
  }

  return parts.join('\n');
}

async function getAuthClient() {
  const credentials = await fs.readJson(CREDENTIALS_PATH);
  const inst = credentials.installed || credentials.web || {};
  const oauth2Client = new google.auth.OAuth2(inst.client_id, inst.client_secret, inst.redirect_uris?.[0] || 'http://localhost');
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

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function main() {
  const mode = process.argv[2] || 'run'; // 'run' or 'preview'

  const auth = await getAuthClient();
  const youtube = google.youtube({ version: 'v3', auth });

  const allVideos = await fs.readJson(path.join(__dirname, '..', 'output', 'all_videos.json'));
  const artistData = await fs.pathExists(ARTIST_CACHE_PATH) ? await fs.readJson(ARTIST_CACHE_PATH) : {};
  const lyricsData = await fs.pathExists(LYRICS_CACHE_PATH) ? await fs.readJson(LYRICS_CACHE_PATH) : {};
  const progress = await fs.pathExists(PROGRESS_PATH) ? await fs.readJson(PROGRESS_PATH) : { updated: [], failed: [], skipped: [] };
  const alreadyDone = new Set(progress.updated.map(u => u.videoId));

  const remaining = allVideos.filter(v => !alreadyDone.has(v.videoId) && !isComplete(v.description));
  console.log(`Remaining to update: ${remaining.length}`);
  console.log(`Artist cache entries: ${Object.keys(artistData).length}`);
  console.log(`Lyrics cache entries: ${Object.keys(lyricsData).length}\n`);

  if (mode === 'preview') {
    // Preview first 3 descriptions
    for (const video of remaining.slice(0, 3)) {
      const desc = buildDescription(video, artistData, lyricsData);
      console.log(`=== ${video.title} ===`);
      console.log(desc);
      console.log('\n' + '='.repeat(80) + '\n');
    }
    return;
  }

  let updateCount = 0;
  for (const video of remaining) {
    try {
      const newDescription = buildDescription(video, artistData, lyricsData);

      const current = await youtube.videos.list({ part: 'snippet', id: video.videoId });
      if (!current.data.items?.length) {
        console.log(`SKIP (not found): ${video.title}`);
        continue;
      }

      const cv = current.data.items[0];
      await youtube.videos.update({
        part: 'snippet',
        requestBody: {
          id: video.videoId,
          snippet: {
            title: cv.snippet.title,
            description: newDescription,
            categoryId: cv.snippet.categoryId,
            tags: cv.snippet.tags || [],
          },
        },
      });

      console.log(`✓ UPDATED: ${video.title}`);
      progress.updated.push({ videoId: video.videoId, title: video.title, timestamp: new Date().toISOString() });
      updateCount++;
      await fs.writeJson(PROGRESS_PATH, progress, { spaces: 2 });
      await delay(1000);

    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes('quota') || msg.includes('rateLimitExceeded')) {
        console.error(`\n⚠️  Quota exceeded after ${updateCount} updates. Run again tomorrow.`);
        break;
      }
      console.error(`✗ FAILED: ${video.title} — ${msg}`);
      await delay(2000);
    }
  }

  console.log(`\nUpdated ${updateCount} videos this run.`);
  console.log(`Total progress: ${progress.updated.length} / ${allVideos.length}`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });

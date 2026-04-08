/**
 * Re-update already-updated videos to add artist social links.
 * Run this after artist_cache.json is populated.
 *
 * Usage: node scripts/re_update_with_socials.js
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
const SOCIALS_PROGRESS_PATH = path.join(__dirname, '..', 'output', 'socials_update_progress.json');

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

function parseTitle(title) {
  let artist = null, remixer = null, songTitle = null, featuredArtists = [];
  const dashMatch = title.match(/^(.+?)\s*[---]\s*(.+)$/);
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
      if (origMatch) songTitle = remainder.replace(/\s*\(Original Mix\)\s*/i, '').trim();
      else songTitle = remainder.replace(/\s*\(.+?\)\s*$/, '').trim() || remainder;
    }
    const featMatch = artist.match(/(.+?)\s+(?:ft\.?|feat\.?|featuring)\s+(.+)/i);
    if (featMatch) { artist = featMatch[1].trim(); featuredArtists.push(featMatch[2].trim()); }
    const xMatch = artist.match(/(.+?)\s+x\s+(.+)/i);
    if (xMatch && !artist.toLowerCase().includes('dj')) { artist = xMatch[1].trim(); featuredArtists.push(xMatch[2].trim()); }
  }
  return { artist, remixer, songTitle, featuredArtists };
}

function generateHashtag(title, artist, songTitle) {
  if (songTitle) return '#' + songTitle.replace(/[^a-zA-Z0-9]/g, '');
  if (artist) return '#' + artist.replace(/[^a-zA-Z0-9]/g, '');
  const words = title.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  return '#' + (words[0] || 'Dance');
}

function buildDescription(title, currentDesc, artistData, lyricsData) {
  const { artist, remixer, songTitle, featuredArtists } = parseTitle(title);
  const allArtists = [artist, ...featuredArtists].filter(Boolean);
  const hashtag = generateHashtag(title, artist, songTitle);

  // Extract SEO intro from current description (everything before the header)
  let seoIntro = '';
  let chapters = '';
  const headerIdx = currentDesc.indexOf('👑Orryy🦁');
  if (headerIdx > 0) {
    seoIntro = currentDesc.substring(0, headerIdx).trim();
  } else {
    seoIntro = title;
  }

  // Extract chapters
  const chapterLines = [];
  for (const line of currentDesc.split('\n')) {
    if (/^\d{1,2}:\d{2}/.test(line.trim())) chapterLines.push(line);
  }
  if (chapterLines.length > 0) chapters = chapterLines.join('\n');

  let parts = [];
  parts.push(seoIntro);
  parts.push('');
  parts.push(ORRYY_HEADER);
  parts.push('');
  parts.push(`#Orryy #ScottishAnthems ${hashtag}`);
  parts.push('');
  if (chapters) { parts.push(chapters); parts.push(''); }
  parts.push(DIVIDER);
  parts.push('');
  parts.push(SUBMISSIONS);
  parts.push('');
  parts.push(ORRYY_SOCIALS);
  parts.push('');

  // Artist credits with social links
  if (allArtists.length > 0 || remixer) {
    const creditNames = [...allArtists];
    if (remixer && !creditNames.includes(remixer)) creditNames.push(remixer);
    parts.push(`Support ${creditNames.join(' & ')} 💙`);

    for (const a of allArtists) {
      parts.push(`» ${a}`);
      const key = a.toLowerCase();
      if (artistData[key]) {
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
      if (artistData[key]) {
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

  parts.push(DIVIDER);

  // Lyrics
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
    const { credentials: newToken } = await oauth2Client.refreshAccessToken();
    await fs.writeJson(TOKEN_PATH, newToken, { spaces: 2 });
    oauth2Client.setCredentials(newToken);
  }
  return oauth2Client;
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function main() {
  const auth = await getAuthClient();
  const youtube = google.youtube({ version: 'v3', auth });

  const artistData = await fs.readJson(ARTIST_CACHE_PATH);
  const lyricsData = await fs.pathExists(LYRICS_CACHE_PATH) ? await fs.readJson(LYRICS_CACHE_PATH) : {};
  const progress = await fs.readJson(PROGRESS_PATH);

  // Load socials update progress
  let socialsProgress;
  if (await fs.pathExists(SOCIALS_PROGRESS_PATH)) {
    socialsProgress = await fs.readJson(SOCIALS_PROGRESS_PATH);
  } else {
    socialsProgress = { updated: [], failed: [] };
  }
  const alreadyDone = new Set(socialsProgress.updated.map(u => u.videoId));

  // Only re-update videos that were already updated in the first pass
  // AND have at least one artist match in the cache
  const toUpdate = progress.updated.filter(v => {
    if (alreadyDone.has(v.videoId)) return false;
    const { artist, remixer } = parseTitle(v.title);
    return (artist && artistData[artist.toLowerCase()]) ||
           (remixer && artistData[remixer.toLowerCase()]);
  });

  console.log(`Videos to re-update with socials: ${toUpdate.length}`);
  console.log(`Already re-updated: ${alreadyDone.size}`);

  let count = 0;
  for (const video of toUpdate) {
    try {
      const current = await youtube.videos.list({ part: 'snippet', id: video.videoId });
      if (!current.data.items?.length) continue;

      const cv = current.data.items[0];
      const newDescription = buildDescription(cv.snippet.title, cv.snippet.description, artistData, lyricsData);

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

      console.log(`✓ RE-UPDATED: ${video.title}`);
      socialsProgress.updated.push({ videoId: video.videoId, title: video.title, timestamp: new Date().toISOString() });
      count++;
      await fs.writeJson(SOCIALS_PROGRESS_PATH, socialsProgress, { spaces: 2 });
      await delay(1000);

    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes('quota') || msg.includes('rateLimitExceeded')) {
        console.error(`\n⚠️  Quota exceeded after ${count} re-updates.`);
        break;
      }
      console.error(`✗ FAILED: ${video.title} - ${msg}`);
      await delay(2000);
    }
  }

  console.log(`\nRe-updated ${count} videos with artist socials.`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });

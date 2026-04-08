/**
 * Lyrics fetcher for Orryy YouTube descriptions.
 *
 * Uses the Genius API to search for and fetch lyrics.
 * Saves results to output/lyrics_cache.json.
 *
 * Setup:
 * 1. Get a Genius API token from genius.com/api-clients
 * 2. Set GENIUS_API_TOKEN in .env
 *
 * Usage: node scripts/fetch_lyrics.js
 *
 * This caches lyrics locally. The resume_updates.js and
 * re_update_with_socials.js scripts will pick them up automatically.
 */
const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const dotenv = require('dotenv');

dotenv.config({ override: true });

const LYRICS_CACHE_PATH = path.join(__dirname, '..', 'output', 'lyrics_cache.json');
const GENIUS_TOKEN = process.env.GENIUS_API_TOKEN;

function parseTitle(title) {
  let artist = null, songTitle = null;
  const dashMatch = title.match(/^(.+?)\s*[---]\s*(.+)$/);
  if (dashMatch) {
    artist = dashMatch[1].trim();
    const remainder = dashMatch[2].trim();
    songTitle = remainder.replace(/\s*\(.+?\)\s*$/g, '').trim();
    const featMatch = artist.match(/(.+?)\s+(?:ft\.?|feat\.?)\s+(.+)/i);
    if (featMatch) artist = featMatch[1].trim();
  }
  return { artist, songTitle };
}

function fetch(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function searchGenius(artist, songTitle) {
  const query = encodeURIComponent(`${artist} ${songTitle}`);
  const url = `https://api.genius.com/search?q=${query}`;
  const data = await fetch(url, { Authorization: `Bearer ${GENIUS_TOKEN}` });
  const result = JSON.parse(data);

  if (!result.response?.hits?.length) return null;

  // Find best match
  for (const hit of result.response.hits) {
    const title = hit.result.title.toLowerCase();
    const primary = hit.result.primary_artist?.name?.toLowerCase() || '';
    if (title.includes(songTitle.toLowerCase().substring(0, 10))) {
      return hit.result;
    }
  }

  // Return first result as fallback
  return result.response.hits[0]?.result || null;
}

async function fetchLyricsPage(geniusPath) {
  // Genius lyrics page - scrape from HTML
  const url = `https://genius.com${geniusPath}`;
  const html = await fetch(url);

  // Extract lyrics from data-lyrics-container divs
  const lyricsRegex = /data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/g;
  let lyrics = '';
  let match;
  while ((match = lyricsRegex.exec(html)) !== null) {
    let text = match[1];
    // Strip HTML tags
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');
    // Decode HTML entities
    text = text.replace(/&#x27;/g, "'");
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
    lyrics += text + '\n';
  }

  return lyrics.trim();
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function main() {
  if (!GENIUS_TOKEN) {
    console.error('GENIUS_API_TOKEN not set in .env');
    console.error('Get one from: https://genius.com/api-clients');
    process.exit(1);
  }

  const allVideos = await fs.readJson(path.join(__dirname, '..', 'output', 'all_videos.json'));
  let cache = {};
  if (await fs.pathExists(LYRICS_CACHE_PATH)) {
    cache = await fs.readJson(LYRICS_CACHE_PATH);
  }

  // Get unique songs
  const songs = new Map();
  for (const v of allVideos) {
    const { artist, songTitle } = parseTitle(v.title);
    if (artist && songTitle) {
      const key = `${artist.toLowerCase()}_${songTitle.toLowerCase()}`;
      if (!cache[key] && !songs.has(key)) {
        songs.set(key, { artist, songTitle });
      }
    }
  }

  console.log(`Songs to search: ${songs.size}`);
  console.log(`Already cached: ${Object.keys(cache).length}`);

  let found = 0, notFound = 0;
  for (const [key, { artist, songTitle }] of songs) {
    try {
      console.log(`Searching: ${artist} - ${songTitle}`);
      const result = await searchGenius(artist, songTitle);

      if (!result) {
        console.log(`  ✗ Not found on Genius`);
        cache[key] = null; // Mark as searched but not found
        notFound++;
        await delay(500);
        continue;
      }

      console.log(`  Found: ${result.full_title}`);
      const lyrics = await fetchLyricsPage(result.path);

      if (lyrics && lyrics.length > 50) {
        cache[key] = lyrics;
        console.log(`  ✓ Lyrics saved (${lyrics.length} chars)`);
        found++;
      } else {
        console.log(`  ✗ Could not extract lyrics`);
        cache[key] = null;
        notFound++;
      }

      await fs.writeJson(LYRICS_CACHE_PATH, cache, { spaces: 2 });
      await delay(1000); // Rate limit

    } catch (err) {
      console.error(`  ✗ Error: ${err.message}`);
      notFound++;
      await delay(2000);
    }
  }

  console.log(`\nDone. Found: ${found}, Not found: ${notFound}`);
  console.log(`Total cached: ${Object.keys(cache).filter(k => cache[k]).length}`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });

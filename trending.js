const axios = require('axios');

const USER_AGENT = 'pulse-gaming-trending/1.0 (personal use)';
const TRENDING_SOURCE_URLS = {
  googleGaming: 'https://trends.google.com/trending/rss?geo=US&category=8',
  googleGeneral: 'https://trends.google.com/trending/rss?geo=US',
  redditGamingRising: 'https://www.reddit.com/r/gaming/rising.json?limit=25',
};

// --- Cache ---
let cachedTopics = [];
let cacheTimestamp = 0;
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

// --- Decode HTML entities (lightweight) ---
function decodeEntities(str) {
  if (!str) return str;
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&(\w+);/g, (full, name) => named[name] || full);
}

// --- Source 1: Google Trends gaming category RSS ---
async function fetchGoogleTrendsGaming() {
  const url = TRENDING_SOURCE_URLS.googleGaming;
  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000,
      responseType: 'text',
    });
    const xml = response.data;
    const topics = [];
    const titleRegex = /<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gi;
    let match;
    while ((match = titleRegex.exec(xml)) !== null) {
      const title = decodeEntities(match[1].trim());
      // Skip the feed-level title
      if (title && !title.includes('Trending') && !title.includes('Google') && title.length > 1) {
        topics.push(title.toLowerCase());
      }
    }
    console.log(`[trending] Google Trends gaming: ${topics.length} topics`);
    return topics;
  } catch (err) {
    console.log(`[trending] Google Trends gaming failed: ${err.message}`);
    return [];
  }
}

// --- Source 2: Google Trends general RSS ---
async function fetchGoogleTrendsGeneral() {
  const url = TRENDING_SOURCE_URLS.googleGeneral;
  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000,
      responseType: 'text',
    });
    const xml = response.data;
    const topics = [];
    const titleRegex = /<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gi;
    let match;
    while ((match = titleRegex.exec(xml)) !== null) {
      const title = decodeEntities(match[1].trim());
      if (title && !title.includes('Trending') && !title.includes('Google') && title.length > 1) {
        topics.push(title.toLowerCase());
      }
    }
    console.log(`[trending] Google Trends general: ${topics.length} topics`);
    return topics;
  } catch (err) {
    console.log(`[trending] Google Trends general failed: ${err.message}`);
    return [];
  }
}

// --- Source 3: Reddit r/gaming rising ---
async function fetchRedditGamingRising() {
  const url = TRENDING_SOURCE_URLS.redditGamingRising;
  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000,
    });
    const children = response.data?.data?.children || [];
    const topics = children.map(c => (c.data?.title || '').toLowerCase()).filter(t => t.length > 3);
    console.log(`[trending] Reddit r/gaming rising: ${topics.length} topics`);
    return topics;
  } catch (err) {
    console.log(`[trending] Reddit r/gaming rising failed: ${err.message}`);
    return [];
  }
}

// --- Main: fetch and cache trending topics ---
async function getTrendingTopics() {
  // Return cache if still fresh
  if (cachedTopics.length > 0 && (Date.now() - cacheTimestamp) < CACHE_TTL) {
    console.log(`[trending] Using cached topics (${cachedTopics.length} topics, ${Math.round((Date.now() - cacheTimestamp) / 60000)}min old)`);
    return cachedTopics;
  }

  console.log('[trending] Fetching fresh trending topics...');

  const [gaming, general, reddit] = await Promise.allSettled([
    fetchGoogleTrendsGaming(),
    fetchGoogleTrendsGeneral(),
    fetchRedditGamingRising(),
  ]);

  const allTopics = [
    ...(gaming.status === 'fulfilled' ? gaming.value : []),
    ...(general.status === 'fulfilled' ? general.value : []),
    ...(reddit.status === 'fulfilled' ? reddit.value : []),
  ];

  // Deduplicate
  const seen = new Set();
  const unique = [];
  for (const topic of allTopics) {
    const key = topic.trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      unique.push(key);
    }
  }

  cachedTopics = unique;
  cacheTimestamp = Date.now();

  console.log(`[trending] Total unique trending topics: ${unique.length}`);
  return unique;
}

// --- Score boost: check how many trending terms match a story title ---
function getTrendingBoost(title, trendingTopics) {
  if (!title || !trendingTopics || trendingTopics.length === 0) return 0;

  const lowerTitle = title.toLowerCase();
  const titleWords = new Set(lowerTitle.split(/\s+/).filter(w => w.length > 2));
  let boost = 0;
  let matches = 0;

  for (const topic of trendingTopics) {
    const topicWords = topic.split(/\s+/).filter(w => w.length > 2);

    // Check for full topic match (substring in title)
    if (lowerTitle.includes(topic)) {
      boost += 20;
      matches++;
      continue;
    }

    // Check for significant word overlap (at least half the topic words appear in the title)
    const matchingWords = topicWords.filter(w => titleWords.has(w) || lowerTitle.includes(w));
    if (topicWords.length > 0 && matchingWords.length >= Math.ceil(topicWords.length / 2) && matchingWords.length >= 2) {
      boost += 10;
      matches++;
    }
  }

  // Cap at 40 points max
  const finalBoost = Math.min(boost, 40);
  if (finalBoost > 0) {
    console.log(`[trending] "${title.substring(0, 60)}..." → +${finalBoost} boost (${matches} trending match${matches !== 1 ? 'es' : ''})`);
  }

  return finalBoost;
}

module.exports = { getTrendingTopics, getTrendingBoost, TRENDING_SOURCE_URLS };

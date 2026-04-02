const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config({ override: true });

const DAILY_NEWS_PATH = path.join(__dirname, 'daily_news.json');
const HISTORY_PATH = path.join(__dirname, 'analytics_history.json');

// --- Load / save helpers ---

async function loadDailyNews() {
  if (await fs.pathExists(DAILY_NEWS_PATH)) {
    return fs.readJson(DAILY_NEWS_PATH);
  }
  return [];
}

async function saveDailyNews(stories) {
  await fs.writeJson(DAILY_NEWS_PATH, stories, { spaces: 2 });
}

async function loadHistory() {
  if (await fs.pathExists(HISTORY_PATH)) {
    return fs.readJson(HISTORY_PATH);
  }
  return { entries: [], topicStats: {} };
}

async function saveHistory(history) {
  await fs.writeJson(HISTORY_PATH, history, { spaces: 2 });
}

// --- YouTube Data API v3 stats fetching ---

async function fetchYouTubeStats(videoIds) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || apiKey === 'placeholder') {
    console.log('[analytics] No YOUTUBE_API_KEY configured — skipping stats fetch');
    return {};
  }

  const results = {};

  // YouTube API accepts up to 50 IDs per request
  const batches = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    batches.push(videoIds.slice(i, i + 50));
  }

  for (const batch of batches) {
    try {
      const ids = batch.join(',');
      const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(ids)}&key=${encodeURIComponent(apiKey)}`;
      const res = await axios.get(url, { timeout: 15000 });
      const items = res.data?.items || [];

      for (const item of items) {
        const stats = item.statistics || {};
        results[item.id] = {
          views: parseInt(stats.viewCount || '0', 10),
          likes: parseInt(stats.likeCount || '0', 10),
          comments: parseInt(stats.commentCount || '0', 10),
          fetched_at: new Date().toISOString(),
        };
      }

      console.log(`[analytics] Fetched stats for ${items.length} videos`);
    } catch (err) {
      console.log(`[analytics] YouTube API error: ${err.message}`);
    }
  }

  return results;
}

// --- Virality score calculation ---

function calculateViralityScore(stats, publishedAt) {
  if (!stats || !stats.views) return 0;

  const hoursLive = Math.max(1, (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60));

  // Views per hour — primary signal
  const viewsPerHour = stats.views / hoursLive;

  // Like ratio — likes per view (typical good Shorts: 3-8%)
  const likeRatio = stats.views > 0 ? stats.likes / stats.views : 0;

  // Comment ratio — comments per view (typical good Shorts: 0.5-2%)
  const commentRatio = stats.views > 0 ? stats.comments / stats.views : 0;

  // Composite score (0-100 scale, can exceed for viral hits)
  const score =
    Math.min(viewsPerHour / 10, 40) +          // Up to 40 points for 400+ views/hr
    Math.min(likeRatio * 500, 30) +             // Up to 30 points for 6%+ like ratio
    Math.min(commentRatio * 2000, 30);          // Up to 30 points for 1.5%+ comment ratio

  return Math.round(score * 10) / 10;
}

// --- Extract keywords from a title ---

function extractKeywords(title) {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'will', 'be', 'to', 'in',
    'on', 'at', 'for', 'of', 'and', 'or', 'not', 'it', 'its', 'this', 'that',
    'has', 'have', 'had', 'but', 'from', 'with', 'as', 'by', 'about', 'than',
    'so', 'if', 'can', 'may', 'could', 'would', 'should', 'just', 'now',
    'says', 'said', 'new', 'up', 'out', 'been', 'being', 'very', 'more',
    'also', 'into', 'after', 'before', 'over', 'all', 'they', 'their', 'you',
    'your', 'we', 'our', 'he', 'she', 'him', 'her', 'who', 'which', 'what',
    'when', 'where', 'how', 'no', 'yes', 'do', 'does', 'did', 'get', 'got',
  ]);

  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
}

// --- Update topic statistics in history ---

function updateTopicStats(history, story, viralityScore) {
  if (!history.topicStats) history.topicStats = {};

  const keywords = extractKeywords(story.title);
  const flair = (story.flair || 'News').toLowerCase();

  // Update flair stats
  const flairKey = `flair:${flair}`;
  if (!history.topicStats[flairKey]) {
    history.topicStats[flairKey] = { count: 0, totalVirality: 0, avgVirality: 0 };
  }
  history.topicStats[flairKey].count += 1;
  history.topicStats[flairKey].totalVirality += viralityScore;
  history.topicStats[flairKey].avgVirality =
    Math.round((history.topicStats[flairKey].totalVirality / history.topicStats[flairKey].count) * 10) / 10;

  // Update keyword stats
  for (const kw of keywords) {
    const kwKey = `kw:${kw}`;
    if (!history.topicStats[kwKey]) {
      history.topicStats[kwKey] = { count: 0, totalVirality: 0, avgVirality: 0 };
    }
    history.topicStats[kwKey].count += 1;
    history.topicStats[kwKey].totalVirality += viralityScore;
    history.topicStats[kwKey].avgVirality =
      Math.round((history.topicStats[kwKey].totalVirality / history.topicStats[kwKey].count) * 10) / 10;
  }

  // Update content pillar stats
  if (story.content_pillar) {
    const pillarKey = `pillar:${story.content_pillar.toLowerCase()}`;
    if (!history.topicStats[pillarKey]) {
      history.topicStats[pillarKey] = { count: 0, totalVirality: 0, avgVirality: 0 };
    }
    history.topicStats[pillarKey].count += 1;
    history.topicStats[pillarKey].totalVirality += viralityScore;
    history.topicStats[pillarKey].avgVirality =
      Math.round((history.topicStats[pillarKey].totalVirality / history.topicStats[pillarKey].count) * 10) / 10;
  }
}

// --- Main analytics pass ---

async function runAnalytics() {
  console.log('[analytics] === ANALYTICS PASS ===');

  const stories = await loadDailyNews();
  const history = await loadHistory();

  if (!stories.length) {
    console.log('[analytics] No stories in daily_news.json — nothing to analyse');
    return;
  }

  // Collect YouTube video IDs from published stories
  const publishedStories = stories.filter(s => s.youtube_post_id);
  if (!publishedStories.length) {
    console.log('[analytics] No published stories with youtube_post_id — skipping stats fetch');
    return;
  }

  console.log(`[analytics] Found ${publishedStories.length} published stories`);

  const videoIds = publishedStories.map(s => s.youtube_post_id);
  const statsMap = await fetchYouTubeStats(videoIds);

  let updated = 0;

  for (const story of publishedStories) {
    const stats = statsMap[story.youtube_post_id];
    if (!stats) continue;

    // Store performance data on the story
    story.youtube_views = stats.views;
    story.youtube_likes = stats.likes;
    story.youtube_comments = stats.comments;
    story.stats_fetched_at = stats.fetched_at;

    // Calculate virality score
    const publishedAt = story.youtube_published_at || story.timestamp;
    story.virality_score = calculateViralityScore(stats, publishedAt);

    console.log(`[analytics] ${story.title.substring(0, 50)}... — views: ${stats.views}, virality: ${story.virality_score}`);

    // Archive to history (keyed by story id to avoid duplicates)
    const existingIdx = history.entries.findIndex(e => e.id === story.id);
    const entry = {
      id: story.id,
      title: story.title,
      flair: story.flair,
      content_pillar: story.content_pillar,
      youtube_post_id: story.youtube_post_id,
      youtube_views: stats.views,
      youtube_likes: stats.likes,
      youtube_comments: stats.comments,
      virality_score: story.virality_score,
      published_at: publishedAt,
      updated_at: stats.fetched_at,
    };

    if (existingIdx >= 0) {
      history.entries[existingIdx] = entry;
    } else {
      history.entries.push(entry);
    }

    // Update topic stats
    updateTopicStats(history, story, story.virality_score);
    updated++;
  }

  // Save everything
  await saveDailyNews(stories);
  await saveHistory(history);

  console.log(`[analytics] Updated ${updated} stories, history has ${history.entries.length} total entries`);
  console.log('[analytics] === ANALYTICS PASS COMPLETE ===');
}

// --- Exported analysis functions ---

/**
 * Returns the top-performing topics, keywords, flairs and content pillars
 * sorted by average virality score. Requires at least 2 data points per topic.
 */
function getTopPerformingTopics() {
  let history;
  try {
    if (!fs.pathExistsSync(HISTORY_PATH)) return { keywords: [], flairs: [], pillars: [] };
    history = fs.readJsonSync(HISTORY_PATH);
  } catch {
    return { keywords: [], flairs: [], pillars: [] };
  }

  const stats = history.topicStats || {};
  const MIN_COUNT = 2;

  const keywords = [];
  const flairs = [];
  const pillars = [];

  for (const [key, data] of Object.entries(stats)) {
    if (data.count < MIN_COUNT) continue;

    const entry = { name: key.split(':')[1], count: data.count, avgVirality: data.avgVirality };

    if (key.startsWith('kw:')) keywords.push(entry);
    else if (key.startsWith('flair:')) flairs.push(entry);
    else if (key.startsWith('pillar:')) pillars.push(entry);
  }

  keywords.sort((a, b) => b.avgVirality - a.avgVirality);
  flairs.sort((a, b) => b.avgVirality - a.avgVirality);
  pillars.sort((a, b) => b.avgVirality - a.avgVirality);

  return {
    keywords: keywords.slice(0, 20),
    flairs,
    pillars,
  };
}

/**
 * Returns a score boost (0-30) based on how well similar topics have
 * historically performed. Designed to be added to breaking_score in hunter.js.
 *
 * Scoring:
 *   - Up to 15 points from keyword matches (avg virality of matching keywords)
 *   - Up to 10 points from flair performance
 *   - Up to 5 points from matching a top-performing content pillar
 */
function getPerformanceBoost(title, flair) {
  let history;
  try {
    if (!fs.pathExistsSync(HISTORY_PATH)) return 0;
    history = fs.readJsonSync(HISTORY_PATH);
  } catch {
    return 0;
  }

  const stats = history.topicStats || {};
  if (Object.keys(stats).length === 0) return 0;

  let boost = 0;

  // --- Keyword boost (up to 15) ---
  const titleKeywords = extractKeywords(title);
  const kwScores = [];

  for (const kw of titleKeywords) {
    const data = stats[`kw:${kw}`];
    if (data && data.count >= 2) {
      kwScores.push(data.avgVirality);
    }
  }

  if (kwScores.length > 0) {
    const avgKwVirality = kwScores.reduce((sum, v) => sum + v, 0) / kwScores.length;
    // Scale: virality 50 = 15 points (max), linear
    boost += Math.min(Math.round((avgKwVirality / 50) * 15), 15);
  }

  // --- Flair boost (up to 10) ---
  if (flair) {
    const flairData = stats[`flair:${flair.toLowerCase()}`];
    if (flairData && flairData.count >= 2) {
      // Scale: virality 50 = 10 points (max), linear
      boost += Math.min(Math.round((flairData.avgVirality / 50) * 10), 10);
    }
  }

  // --- Content pillar boost (up to 5) ---
  // Check all pillars and give a small bonus if any have high performance
  for (const [key, data] of Object.entries(stats)) {
    if (!key.startsWith('pillar:') || data.count < 2) continue;
    if (data.avgVirality > 40) {
      boost += 5;
      break;
    }
  }

  return Math.min(boost, 30);
}

module.exports = {
  runAnalytics,
  getTopPerformingTopics,
  getPerformanceBoost,
  calculateViralityScore,
  fetchYouTubeStats,
};

// CLI usage: node analytics.js
if (require.main === module) {
  runAnalytics().catch(err => {
    console.log(`[analytics] ERROR: ${err.message}`);
    process.exit(1);
  });
}

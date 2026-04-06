const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');
const db = require('./lib/db');

dotenv.config({ override: true });

const DAILY_NEWS_PATH = path.join(__dirname, 'daily_news.json');
const HISTORY_PATH = path.join(__dirname, 'analytics_history.json');
const TIKTOK_TOKEN_PATH = path.join(__dirname, 'tokens', 'tiktok_tokens.json');
const INSTAGRAM_TOKEN_PATH = path.join(__dirname, 'tokens', 'instagram_token.json');

// --- Load / save helpers (delegated to db layer, feature-flagged) ---

async function loadDailyNews() {
  return db.getStories();
}

async function saveDailyNews(stories) {
  await db.saveStories(stories);
}

async function loadHistory() {
  return db.getAnalyticsHistory();
}

async function saveHistory(history) {
  await db.saveAnalyticsHistory(history);
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

// --- TikTok Content Posting API stats fetching ---

async function loadTikTokToken() {
  try {
    if (await fs.pathExists(TIKTOK_TOKEN_PATH)) {
      const data = await fs.readJson(TIKTOK_TOKEN_PATH);
      return data.access_token || null;
    }
  } catch (err) {
    console.log(`[analytics] Failed to load TikTok token: ${err.message}`);
  }
  return null;
}

async function fetchTikTokStats(postIds) {
  const token = await loadTikTokToken();
  if (!token) {
    console.log('[analytics] No TikTok token available — skipping TikTok stats');
    return {};
  }

  const results = {};

  // TikTok Content Posting API — query video info in batches of 20
  const batches = [];
  for (let i = 0; i < postIds.length; i += 20) {
    batches.push(postIds.slice(i, i + 20));
  }

  for (const batch of batches) {
    try {
      const res = await axios.post(
        'https://open.tiktokapis.com/v2/video/query/',
        { filters: { video_ids: batch } },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          params: {
            fields: 'id,like_count,comment_count,share_count,view_count',
          },
          timeout: 15000,
        }
      );

      const videos = res.data?.data?.videos || [];
      for (const video of videos) {
        results[video.id] = {
          views: video.view_count || 0,
          likes: video.like_count || 0,
          comments: video.comment_count || 0,
          shares: video.share_count || 0,
          fetched_at: new Date().toISOString(),
        };
      }

      console.log(`[analytics] Fetched TikTok stats for ${videos.length} videos`);
    } catch (err) {
      console.log(`[analytics] TikTok API error: ${err.message}`);
    }
  }

  return results;
}

// --- Instagram Graph API stats fetching ---

async function loadInstagramToken() {
  // Prefer env var, fall back to token file
  if (process.env.INSTAGRAM_ACCESS_TOKEN) {
    return process.env.INSTAGRAM_ACCESS_TOKEN;
  }
  try {
    if (await fs.pathExists(INSTAGRAM_TOKEN_PATH)) {
      const data = await fs.readJson(INSTAGRAM_TOKEN_PATH);
      return data.access_token || null;
    }
  } catch (err) {
    console.log(`[analytics] Failed to load Instagram token: ${err.message}`);
  }
  return null;
}

async function fetchInstagramStats(mediaIds) {
  const token = await loadInstagramToken();
  if (!token) {
    console.log('[analytics] No Instagram token available — skipping Instagram stats');
    return {};
  }

  const results = {};

  for (const mediaId of mediaIds) {
    try {
      // Fetch basic media fields
      const mediaRes = await axios.get(
        `https://graph.facebook.com/v19.0/${mediaId}`,
        {
          params: {
            fields: 'like_count,comments_count,timestamp',
            access_token: token,
          },
          timeout: 10000,
        }
      );

      const media = mediaRes.data || {};

      // Fetch insights (views/reach) for Reels
      let views = 0;
      try {
        const insightsRes = await axios.get(
          `https://graph.facebook.com/v19.0/${mediaId}/insights`,
          {
            params: {
              metric: 'plays,reach',
              access_token: token,
            },
            timeout: 10000,
          }
        );

        const insights = insightsRes.data?.data || [];
        for (const metric of insights) {
          if (metric.name === 'plays') {
            views = metric.values?.[0]?.value || 0;
          }
        }
      } catch (insightErr) {
        // Insights may not be available for all media types
        console.log(`[analytics] Instagram insights unavailable for ${mediaId}: ${insightErr.message}`);
      }

      results[mediaId] = {
        views,
        likes: media.like_count || 0,
        comments: media.comments_count || 0,
        fetched_at: new Date().toISOString(),
      };

      console.log(`[analytics] Fetched Instagram stats for ${mediaId}`);
    } catch (err) {
      console.log(`[analytics] Instagram API error for ${mediaId}: ${err.message}`);
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

/**
 * Calculates a combined virality score across all platforms.
 * Aggregates views, likes and comments then scores the totals.
 */
function calculateCombinedViralityScore(ytStats, ttStats, igStats, publishedAt) {
  const combined = {
    views: (ytStats?.views || 0) + (ttStats?.views || 0) + (igStats?.views || 0),
    likes: (ytStats?.likes || 0) + (ttStats?.likes || 0) + (igStats?.likes || 0),
    comments: (ytStats?.comments || 0) + (ttStats?.comments || 0) + (igStats?.comments || 0),
  };

  if (combined.views === 0) return 0;
  return calculateViralityScore(combined, publishedAt);
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

  // Collect published stories across all platforms
  const publishedStories = stories.filter(s => s.youtube_post_id || s.tiktok_post_id || s.instagram_media_id);
  if (!publishedStories.length) {
    console.log('[analytics] No published stories found — skipping stats fetch');
    return;
  }

  console.log(`[analytics] Found ${publishedStories.length} published stories`);

  // Fetch stats from all platforms in parallel
  const ytIds = publishedStories.filter(s => s.youtube_post_id).map(s => s.youtube_post_id);
  const ttIds = publishedStories.filter(s => s.tiktok_post_id).map(s => s.tiktok_post_id);
  const igIds = publishedStories.filter(s => s.instagram_media_id).map(s => s.instagram_media_id);

  const [ytStatsMap, ttStatsMap, igStatsMap] = await Promise.all([
    ytIds.length > 0 ? fetchYouTubeStats(ytIds) : {},
    ttIds.length > 0 ? fetchTikTokStats(ttIds) : {},
    igIds.length > 0 ? fetchInstagramStats(igIds) : {},
  ]);

  let updated = 0;

  for (const story of publishedStories) {
    const ytStats = story.youtube_post_id ? ytStatsMap[story.youtube_post_id] : null;
    const ttStats = story.tiktok_post_id ? ttStatsMap[story.tiktok_post_id] : null;
    const igStats = story.instagram_media_id ? igStatsMap[story.instagram_media_id] : null;

    if (!ytStats && !ttStats && !igStats) continue;

    // Track youtube_published_at if not already set
    if (story.youtube_post_id && !story.youtube_published_at) {
      story.youtube_published_at = story.timestamp || new Date().toISOString();
    }

    // Store YouTube performance data
    if (ytStats) {
      story.youtube_views = ytStats.views;
      story.youtube_likes = ytStats.likes;
      story.youtube_comments = ytStats.comments;
    }

    // Store TikTok performance data
    if (ttStats) {
      story.tiktok_views = ttStats.views;
      story.tiktok_likes = ttStats.likes;
      story.tiktok_comments = ttStats.comments;
      story.tiktok_shares = ttStats.shares;
    }

    // Store Instagram performance data
    if (igStats) {
      story.instagram_views = igStats.views;
      story.instagram_likes = igStats.likes;
      story.instagram_comments = igStats.comments;
    }

    story.stats_fetched_at = new Date().toISOString();

    // Calculate combined virality score across all platforms
    const publishedAt = story.youtube_published_at || story.timestamp;
    story.virality_score = calculateCombinedViralityScore(ytStats, ttStats, igStats, publishedAt);

    const totalViews = (ytStats?.views || 0) + (ttStats?.views || 0) + (igStats?.views || 0);
    console.log(`[analytics] ${story.title.substring(0, 50)}... — total views: ${totalViews}, virality: ${story.virality_score}`);

    // Archive to history (keyed by story id to avoid duplicates)
    const existingIdx = history.entries.findIndex(e => e.id === story.id);
    const entry = {
      id: story.id,
      title: story.title,
      flair: story.flair,
      content_pillar: story.content_pillar,
      youtube_post_id: story.youtube_post_id,
      tiktok_post_id: story.tiktok_post_id,
      instagram_media_id: story.instagram_media_id,
      youtube_views: story.youtube_views || 0,
      youtube_likes: story.youtube_likes || 0,
      youtube_comments: story.youtube_comments || 0,
      tiktok_views: story.tiktok_views || 0,
      tiktok_likes: story.tiktok_likes || 0,
      tiktok_comments: story.tiktok_comments || 0,
      tiktok_shares: story.tiktok_shares || 0,
      instagram_views: story.instagram_views || 0,
      instagram_likes: story.instagram_likes || 0,
      instagram_comments: story.instagram_comments || 0,
      total_views: totalViews,
      virality_score: story.virality_score,
      published_at: publishedAt,
      updated_at: story.stats_fetched_at,
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
 * Computes recency-weighted average virality from history entries matching a filter.
 * Entries from the last 7 days count 2x vs older data.
 */
function recencyWeightedAvg(entries, filterFn) {
  const now = Date.now();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const entry of entries) {
    if (!filterFn(entry)) continue;
    const publishedMs = entry.published_at ? new Date(entry.published_at).getTime() : 0;
    const isRecent = (now - publishedMs) < SEVEN_DAYS_MS;
    const weight = isRecent ? 2 : 1;
    weightedSum += (entry.virality_score || 0) * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/**
 * Returns a score boost (0-30) based on how well similar topics have
 * historically performed. Designed to be added to breaking_score in hunter.js.
 *
 * Uses recency weighting — performance from the last 7 days counts 2x
 * vs older data, so the system adapts to what is trending now.
 *
 * Scoring:
 *   - Up to 15 points from keyword matches (recency-weighted virality)
 *   - Up to 10 points from flair performance (recency-weighted)
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

  const entries = history.entries || [];
  const stats = history.topicStats || {};
  if (entries.length === 0 && Object.keys(stats).length === 0) return 0;

  let boost = 0;

  // --- Keyword boost (up to 15) — recency-weighted from entries ---
  const titleKeywords = extractKeywords(title);

  if (entries.length >= 2) {
    const kwScores = [];

    for (const kw of titleKeywords) {
      const kwLower = kw.toLowerCase();
      const matchingEntries = entries.filter(e => {
        const entryKws = extractKeywords(e.title || '');
        return entryKws.includes(kwLower);
      });

      if (matchingEntries.length >= 2) {
        const avg = recencyWeightedAvg(matchingEntries, () => true);
        kwScores.push(avg);
      }
    }

    if (kwScores.length > 0) {
      const avgKwVirality = kwScores.reduce((sum, v) => sum + v, 0) / kwScores.length;
      boost += Math.min(Math.round((avgKwVirality / 50) * 15), 15);
    }
  } else {
    // Fall back to topicStats if insufficient entries
    const kwScores = [];
    for (const kw of titleKeywords) {
      const data = stats[`kw:${kw}`];
      if (data && data.count >= 2) {
        kwScores.push(data.avgVirality);
      }
    }
    if (kwScores.length > 0) {
      const avgKwVirality = kwScores.reduce((sum, v) => sum + v, 0) / kwScores.length;
      boost += Math.min(Math.round((avgKwVirality / 50) * 15), 15);
    }
  }

  // --- Flair boost (up to 10) — recency-weighted ---
  if (flair && entries.length >= 2) {
    const flairLower = flair.toLowerCase();
    const flairEntries = entries.filter(e => (e.flair || '').toLowerCase() === flairLower);

    if (flairEntries.length >= 2) {
      const avg = recencyWeightedAvg(flairEntries, () => true);
      boost += Math.min(Math.round((avg / 50) * 10), 10);
    }
  } else if (flair) {
    const flairData = stats[`flair:${flair.toLowerCase()}`];
    if (flairData && flairData.count >= 2) {
      boost += Math.min(Math.round((flairData.avgVirality / 50) * 10), 10);
    }
  }

  // --- Content pillar boost (up to 5) ---
  for (const [key, data] of Object.entries(stats)) {
    if (!key.startsWith('pillar:') || data.count < 2) continue;
    if (data.avgVirality > 40) {
      boost += 5;
      break;
    }
  }

  return Math.min(boost, 30);
}

/**
 * Returns a plain-text analytics summary suitable for injection into Claude
 * script generation prompts. Summarises top-performing topics, keywords,
 * flairs and pillars so the AI can prioritise what resonates with the audience.
 */
function getAnalyticsContext() {
  let history;
  try {
    if (!fs.pathExistsSync(HISTORY_PATH)) return '';
    history = fs.readJsonSync(HISTORY_PATH);
  } catch {
    return '';
  }

  const entries = history.entries || [];
  if (entries.length < 3) return ''; // Need minimum data before making recommendations

  const topics = getTopPerformingTopics();
  const lines = [];

  // Overall average virality for comparison baseline
  const allScores = entries.filter(e => e.virality_score > 0).map(e => e.virality_score);
  const overallAvg = allScores.length > 0
    ? Math.round((allScores.reduce((s, v) => s + v, 0) / allScores.length) * 10) / 10
    : 0;

  if (overallAvg > 0) {
    lines.push(`- Baseline average virality across ${entries.length} videos: ${overallAvg}`);
  }

  // Top keywords with multiplier vs baseline
  if (topics.keywords.length > 0 && overallAvg > 0) {
    const topKw = topics.keywords.slice(0, 5);
    for (const kw of topKw) {
      const multiplier = Math.round((kw.avgVirality / overallAvg) * 10) / 10;
      if (multiplier > 1.1) {
        lines.push(`- "${kw.name}" topics average ${multiplier}x higher engagement (${kw.count} videos)`);
      }
    }
  }

  // Flair/classification performance comparison
  if (topics.flairs.length >= 2 && overallAvg > 0) {
    const sorted = [...topics.flairs].sort((a, b) => b.avgVirality - a.avgVirality);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    if (best.avgVirality > worst.avgVirality && worst.avgVirality > 0) {
      const pctBetter = Math.round(((best.avgVirality - worst.avgVirality) / worst.avgVirality) * 100);
      lines.push(`- [${best.name.toUpperCase()}] classification outperforms [${worst.name.toUpperCase()}] by ${pctBetter}%`);
    }
  }

  // Content pillar insights
  if (topics.pillars.length >= 2 && overallAvg > 0) {
    const bestPillar = topics.pillars[0];
    const multiplier = Math.round((bestPillar.avgVirality / overallAvg) * 10) / 10;
    if (multiplier > 1.1) {
      lines.push(`- "${bestPillar.name}" content pillar performs ${multiplier}x above average`);
    }
  }

  // Recent trend — last 7 days vs overall
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const recentEntries = entries.filter(e => e.published_at && (now - new Date(e.published_at).getTime()) < SEVEN_DAYS);
  if (recentEntries.length >= 2) {
    const recentScores = recentEntries.filter(e => e.virality_score > 0).map(e => e.virality_score);
    const recentAvg = recentScores.length > 0
      ? Math.round((recentScores.reduce((s, v) => s + v, 0) / recentScores.length) * 10) / 10
      : 0;

    if (recentAvg > 0 && overallAvg > 0) {
      const trend = recentAvg > overallAvg ? 'up' : 'down';
      const pctDiff = Math.round(Math.abs(recentAvg - overallAvg) / overallAvg * 100);
      lines.push(`- Recent 7-day trend: engagement is ${trend} ${pctDiff}% vs historical average`);
    }

    // Identify recent top performers for topic hints
    const recentBest = [...recentEntries].sort((a, b) => (b.virality_score || 0) - (a.virality_score || 0));
    if (recentBest.length > 0 && recentBest[0].virality_score > overallAvg) {
      lines.push(`- Best recent performer: "${recentBest[0].title}" (virality: ${recentBest[0].virality_score})`);
    }
  }

  if (lines.length === 0) return '';

  return 'PERFORMANCE INSIGHTS (use these to prioritise topics):\n' + lines.join('\n');
}

module.exports = {
  runAnalytics,
  getTopPerformingTopics,
  getPerformanceBoost,
  getAnalyticsContext,
  calculateViralityScore,
  calculateCombinedViralityScore,
  fetchYouTubeStats,
  fetchTikTokStats,
  fetchInstagramStats,
  loadHistory,
};

// CLI usage: node analytics.js
if (require.main === module) {
  runAnalytics().catch(err => {
    console.log(`[analytics] ERROR: ${err.message}`);
    process.exit(1);
  });
}

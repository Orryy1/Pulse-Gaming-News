const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const CONFIG_PATH = path.join(__dirname, "competitor_config.json");
const DATA_PATH = path.join(__dirname, "competitor_data.json");
const HISTORY_PATH = path.join(__dirname, "analytics_history.json");

// --- Load / save helpers ---

async function loadConfig() {
  if (await fs.pathExists(CONFIG_PATH)) {
    return fs.readJson(CONFIG_PATH);
  }
  return { competitors: [], trackTopics: [], analysisWindowDays: 30 };
}

async function loadData() {
  if (await fs.pathExists(DATA_PATH)) {
    return fs.readJson(DATA_PATH);
  }
  return { lastScan: null, channels: {}, report: null };
}

async function saveData(data) {
  await fs.writeJson(DATA_PATH, data, { spaces: 2 });
}

async function loadOurHistory() {
  if (await fs.pathExists(HISTORY_PATH)) {
    return fs.readJson(HISTORY_PATH);
  }
  return { entries: [], topicStats: {} };
}

// --- YouTube Data API v3 helpers ---

/**
 * Fetches recent videos from a YouTube channel using the Search endpoint.
 * Uses YOUTUBE_API_KEY (read-only, no OAuth required).
 */
async function fetchChannelVideos(channelId, maxResults = 50) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || apiKey === "placeholder") {
    console.log("[competitor] No YOUTUBE_API_KEY configured - skipping fetch");
    return [];
  }

  try {
    // Step 1: Search for recent videos from the channel
    const searchUrl =
      `https://www.googleapis.com/youtube/v3/search?` +
      `part=snippet&channelId=${encodeURIComponent(channelId)}` +
      `&type=video&order=date&maxResults=${maxResults}` +
      `&key=${encodeURIComponent(apiKey)}`;

    const searchRes = await axios.get(searchUrl, { timeout: 15000 });
    const items = searchRes.data?.items || [];

    if (items.length === 0) return [];

    // Step 2: Fetch statistics for all found videos in one batch
    const videoIds = items.map((item) => item.id.videoId).filter(Boolean);
    if (videoIds.length === 0) return [];

    const statsUrl =
      `https://www.googleapis.com/youtube/v3/videos?` +
      `part=statistics,snippet&id=${encodeURIComponent(videoIds.join(","))}` +
      `&key=${encodeURIComponent(apiKey)}`;

    const statsRes = await axios.get(statsUrl, { timeout: 15000 });
    const videoItems = statsRes.data?.items || [];

    return videoItems.map((video) => ({
      videoId: video.id,
      title: video.snippet?.title || "",
      description: (video.snippet?.description || "").substring(0, 500),
      publishedAt: video.snippet?.publishedAt || "",
      viewCount: parseInt(video.statistics?.viewCount || "0", 10),
      likeCount: parseInt(video.statistics?.likeCount || "0", 10),
      commentCount: parseInt(video.statistics?.commentCount || "0", 10),
      tags: video.snippet?.tags || [],
    }));
  } catch (err) {
    console.log(
      `[competitor] Failed to fetch channel ${channelId}: ${err.message}`,
    );
    return [];
  }
}

/**
 * Extracts topic keywords from a video title.
 * Strips stop words and returns lowercase tokens.
 */
function extractTopicKeywords(title) {
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "will",
    "be",
    "to",
    "in",
    "on",
    "at",
    "for",
    "of",
    "and",
    "or",
    "not",
    "it",
    "its",
    "this",
    "that",
    "has",
    "have",
    "had",
    "but",
    "from",
    "with",
    "as",
    "by",
    "about",
    "than",
    "so",
    "if",
    "can",
    "may",
    "could",
    "would",
    "should",
    "just",
    "now",
    "says",
    "said",
    "new",
    "up",
    "out",
    "been",
    "being",
    "very",
    "more",
    "also",
    "into",
    "after",
    "before",
    "over",
    "all",
    "they",
    "their",
    "you",
    "your",
    "we",
    "our",
    "he",
    "she",
    "him",
    "her",
    "who",
    "which",
    "what",
    "when",
    "where",
    "how",
    "no",
    "yes",
    "do",
    "does",
    "did",
    "get",
    "got",
    "shorts",
    "short",
    "video",
    "gaming",
    "news",
    "update",
    "official",
  ]);

  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

// --- Core analysis functions ---

/**
 * Fetches recent videos from all configured competitor channels.
 * Stores results in competitor_data.json.
 */
async function trackCompetitors() {
  const config = await loadConfig();
  const data = await loadData();
  const competitors = config.competitors || [];

  const validCompetitors = competitors.filter(
    (c) => c.channelId && c.channelId !== "REPLACE_ME",
  );

  if (validCompetitors.length === 0) {
    console.log(
      "[competitor] No valid competitor channels configured - add channel IDs to competitor_config.json",
    );
    return data;
  }

  console.log(
    `[competitor] === COMPETITOR SCAN - ${validCompetitors.length} channels ===`,
  );

  const windowDays = config.analysisWindowDays || 30;
  const cutoffDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  for (const competitor of validCompetitors) {
    console.log(
      `[competitor] Fetching: ${competitor.name} (${competitor.channelId})`,
    );

    const videos = await fetchChannelVideos(competitor.channelId);

    // Filter to analysis window
    const recentVideos = videos.filter((v) => {
      if (!v.publishedAt) return false;
      return new Date(v.publishedAt) >= cutoffDate;
    });

    // Extract topic keywords for each video
    const enrichedVideos = recentVideos.map((v) => ({
      ...v,
      topicKeywords: extractTopicKeywords(v.title),
    }));

    data.channels[competitor.channelId] = {
      name: competitor.name,
      lastFetched: new Date().toISOString(),
      videoCount: enrichedVideos.length,
      videos: enrichedVideos,
    };

    console.log(
      `[competitor] ${competitor.name}: ${enrichedVideos.length} videos in last ${windowDays} days`,
    );

    // Politeness delay between API calls
    await new Promise((r) => setTimeout(r, 500));
  }

  data.lastScan = new Date().toISOString();
  await saveData(data);

  console.log("[competitor] === SCAN COMPLETE ===");
  return data;
}

/**
 * Analyses posting patterns across all tracked competitors.
 * Returns: posting hours, days, frequency and topic distribution.
 */
async function analyzePostingPatterns() {
  const data = await loadData();
  const channels = data.channels || {};
  const patterns = {};

  for (const [channelId, channelData] of Object.entries(channels)) {
    const videos = channelData.videos || [];
    if (videos.length === 0) continue;

    // Hour distribution (UTC)
    const hourCounts = new Array(24).fill(0);
    // Day distribution (0=Sunday, 6=Saturday)
    const dayCounts = new Array(7).fill(0);
    // Topic keyword frequency
    const topicCounts = {};

    for (const video of videos) {
      if (video.publishedAt) {
        const date = new Date(video.publishedAt);
        hourCounts[date.getUTCHours()]++;
        dayCounts[date.getUTCDay()]++;
      }

      for (const kw of video.topicKeywords || []) {
        topicCounts[kw] = (topicCounts[kw] || 0) + 1;
      }
    }

    // Find peak posting hours (top 3)
    const peakHours = hourCounts
      .map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .filter((h) => h.count > 0);

    // Find peak posting days (top 3)
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const peakDays = dayCounts
      .map((count, day) => ({ day: dayNames[day], count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .filter((d) => d.count > 0);

    // Top topics (sorted by frequency)
    const topTopics = Object.entries(topicCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([topic, count]) => ({ topic, count }));

    // Calculate average posting frequency (videos per week)
    let videosPerWeek = 0;
    if (videos.length >= 2) {
      const dates = videos
        .map((v) => new Date(v.publishedAt).getTime())
        .filter((t) => !isNaN(t))
        .sort((a, b) => a - b);
      if (dates.length >= 2) {
        const spanDays =
          (dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24);
        videosPerWeek =
          spanDays > 0
            ? Math.round((videos.length / spanDays) * 7 * 10) / 10
            : 0;
      }
    }

    // Average views per video
    const totalViews = videos.reduce((sum, v) => sum + (v.viewCount || 0), 0);
    const avgViews =
      videos.length > 0 ? Math.round(totalViews / videos.length) : 0;

    patterns[channelId] = {
      name: channelData.name,
      totalVideos: videos.length,
      videosPerWeek,
      avgViews,
      peakHours,
      peakDays,
      topTopics,
    };
  }

  return patterns;
}

/**
 * Compares competitor topics against our published topics from analytics_history.json.
 * Returns topics competitors cover that we do not.
 */
async function identifyContentGaps() {
  const data = await loadData();
  const history = await loadOurHistory();
  const config = await loadConfig();
  const channels = data.channels || {};

  // Build a set of our topic keywords from analytics history
  const ourKeywords = new Set();
  for (const entry of history.entries || []) {
    const keywords = extractTopicKeywords(entry.title || "");
    for (const kw of keywords) {
      ourKeywords.add(kw);
    }
  }

  // Also include tracked topics from config as "known" topics
  const trackedTopics = (config.trackTopics || []).map((t) => t.toLowerCase());

  // Aggregate all competitor topic keywords with view counts
  const competitorTopics = {};

  for (const channelData of Object.values(channels)) {
    for (const video of channelData.videos || []) {
      for (const kw of video.topicKeywords || []) {
        if (!competitorTopics[kw]) {
          competitorTopics[kw] = {
            keyword: kw,
            totalViews: 0,
            videoCount: 0,
            avgViews: 0,
          };
        }
        competitorTopics[kw].totalViews += video.viewCount || 0;
        competitorTopics[kw].videoCount++;
      }
    }
  }

  // Calculate average views per topic
  for (const topic of Object.values(competitorTopics)) {
    topic.avgViews =
      topic.videoCount > 0
        ? Math.round(topic.totalViews / topic.videoCount)
        : 0;
  }

  // Find gaps: topics competitors cover (with decent views) that we haven't covered
  const gaps = Object.values(competitorTopics)
    .filter((t) => !ourKeywords.has(t.keyword))
    .filter((t) => t.videoCount >= 2) // At least 2 videos on the topic for significance
    .sort((a, b) => b.avgViews - a.avgViews);

  // Find topics competitors cover that match our tracked topics (opportunities)
  const opportunities = Object.values(competitorTopics)
    .filter((t) =>
      trackedTopics.some(
        (tracked) => t.keyword.includes(tracked) || tracked.includes(t.keyword),
      ),
    )
    .sort((a, b) => b.avgViews - a.avgViews);

  return {
    gaps: gaps.slice(0, 20),
    opportunities: opportunities.slice(0, 10),
    ourTopicCount: ourKeywords.size,
    competitorTopicCount: Object.keys(competitorTopics).length,
  };
}

/**
 * Generates a weekly competitor intelligence report as a formatted string.
 */
async function generateReport() {
  const config = await loadConfig();
  const data = await loadData();
  const patterns = await analyzePostingPatterns();
  const gapAnalysis = await identifyContentGaps();

  const lines = [];
  lines.push("=== COMPETITOR INTELLIGENCE REPORT ===");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Analysis window: ${config.analysisWindowDays || 30} days`);
  lines.push(`Last scan: ${data.lastScan || "Never"}`);
  lines.push("");

  // Per-channel breakdown
  for (const [channelId, pattern] of Object.entries(patterns)) {
    lines.push(`--- ${pattern.name} ---`);
    lines.push(
      `  Videos: ${pattern.totalVideos} (${pattern.videosPerWeek}/week)`,
    );
    lines.push(`  Avg views: ${pattern.avgViews.toLocaleString()}`);

    if (pattern.peakHours.length > 0) {
      const hours = pattern.peakHours
        .map((h) => `${h.hour}:00 UTC (${h.count} videos)`)
        .join(", ");
      lines.push(`  Peak hours: ${hours}`);
    }

    if (pattern.peakDays.length > 0) {
      const days = pattern.peakDays
        .map((d) => `${d.day} (${d.count} videos)`)
        .join(", ");
      lines.push(`  Peak days: ${days}`);
    }

    if (pattern.topTopics.length > 0) {
      const topics = pattern.topTopics
        .slice(0, 10)
        .map((t) => `${t.topic} (${t.count})`)
        .join(", ");
      lines.push(`  Top topics: ${topics}`);
    }

    lines.push("");
  }

  // Content gaps
  lines.push("--- CONTENT GAPS (topics they cover, we don't) ---");
  if (gapAnalysis.gaps.length > 0) {
    for (const gap of gapAnalysis.gaps.slice(0, 10)) {
      lines.push(
        `  "${gap.keyword}" - ${gap.videoCount} competitor videos, avg ${gap.avgViews.toLocaleString()} views`,
      );
    }
  } else {
    lines.push("  No significant gaps identified (good coverage)");
  }
  lines.push("");

  // Opportunities
  lines.push("--- TRACKED TOPIC OPPORTUNITIES ---");
  if (gapAnalysis.opportunities.length > 0) {
    for (const opp of gapAnalysis.opportunities.slice(0, 5)) {
      lines.push(
        `  "${opp.keyword}" - ${opp.videoCount} competitor videos, avg ${opp.avgViews.toLocaleString()} views`,
      );
    }
  } else {
    lines.push("  No tracked topic matches found in competitor content");
  }
  lines.push("");

  lines.push(
    `Our topics: ${gapAnalysis.ourTopicCount} | Competitor topics: ${gapAnalysis.competitorTopicCount}`,
  );
  lines.push("=== END REPORT ===");

  const report = lines.join("\n");

  // Store the report in competitor_data.json
  const dataToSave = await loadData();
  dataToSave.report = {
    generatedAt: new Date().toISOString(),
    text: report,
    patterns,
    gapAnalysis,
  };
  await saveData(dataToSave);

  console.log(
    "[competitor] Report generated and saved to competitor_data.json",
  );
  return report;
}

/**
 * Detects topic saturation: returns true if 3+ competitor channels
 * posted about the same topic within the last 4 hours.
 */
async function detectSaturation(topic) {
  const data = await loadData();
  const channels = data.channels || {};
  const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
  const topicLower = topic.toLowerCase();
  const topicWords = topicLower.split(/\s+/).filter((w) => w.length > 2);

  let matchingChannels = 0;

  for (const channelData of Object.values(channels)) {
    const recentVideos = (channelData.videos || []).filter((v) => {
      if (!v.publishedAt) return false;
      return new Date(v.publishedAt).getTime() >= fourHoursAgo;
    });

    const hasTopicMatch = recentVideos.some((v) => {
      const titleLower = (v.title || "").toLowerCase();
      // Match if 2+ topic words appear in the video title
      const matchCount = topicWords.filter((w) =>
        titleLower.includes(w),
      ).length;
      return matchCount >= Math.min(2, topicWords.length);
    });

    if (hasTopicMatch) matchingChannels++;
  }

  return {
    saturated: matchingChannels >= 3,
    competitorCount: matchingChannels,
    topic,
  };
}

/**
 * Returns an alternative script angle when a topic is saturated.
 * Feeds into processor.js to instruct Claude to differentiate.
 */
function getAngleSuggestion(saturationResult) {
  if (!saturationResult.saturated) return null;

  const angles = [
    `Competitors are covering "${saturationResult.topic}" as straight news. Your script MUST take a SCEPTICAL angle. Question the source. Ask "Is this real?" Frame it as analysis, not news.`,
    `This topic is saturated (${saturationResult.competitorCount} competitors posted in 4h). Your script MUST offer a UNIQUE TAKE: focus on what everyone else is missing. Start with "Everyone is talking about X, but they are missing..."`,
    `Topic saturation detected. Your script MUST take a CONTRARIAN position. Challenge the popular narrative. Use "But here is why that might not be true" framing.`,
    `High competition on this topic. Your script MUST focus on the IMPACT angle: what does this actually mean for the viewer? Skip the news, go straight to consequences.`,
  ];

  return angles[Math.floor(Math.random() * angles.length)];
}

/**
 * Full competitor analysis cycle: track → analyse → report.
 */
async function runCompetitorAnalysis() {
  console.log("[competitor] === FULL COMPETITOR ANALYSIS ===");
  await trackCompetitors();
  const report = await generateReport();
  console.log(report);
  return report;
}

/**
 * Sentiment arbitrage: scrapes top comments from competitor videos
 * about a topic and identifies the main unanswered question or complaint.
 * Returns a hook suggestion that directly addresses viewer frustration.
 */
async function analyzeSentiment(topic) {
  const data = await loadData();
  const channels = data.channels || {};
  const topicLower = topic.toLowerCase();
  const topicWords = topicLower.split(/\s+/).filter((w) => w.length > 2);

  // Find competitor videos about this topic
  const matchingVideos = [];
  for (const channelData of Object.values(channels)) {
    for (const video of channelData.videos || []) {
      const titleLower = (video.title || "").toLowerCase();
      const matchCount = topicWords.filter((w) =>
        titleLower.includes(w),
      ).length;
      if (matchCount >= Math.min(2, topicWords.length)) {
        matchingVideos.push(video);
      }
    }
  }

  if (matchingVideos.length === 0) {
    return { suggestion: null, reason: "No competitor videos found for topic" };
  }

  // Fetch top comments from the best-performing matching video
  const bestVideo = matchingVideos.sort(
    (a, b) => (b.viewCount || 0) - (a.viewCount || 0),
  )[0];

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || apiKey === "placeholder") {
    return { suggestion: null, reason: "No YouTube API key for comment fetch" };
  }

  let comments = [];
  try {
    const commentsUrl =
      `https://www.googleapis.com/youtube/v3/commentThreads?` +
      `part=snippet&videoId=${encodeURIComponent(bestVideo.videoId)}` +
      `&order=relevance&maxResults=20&key=${encodeURIComponent(apiKey)}`;

    const res = await axios.get(commentsUrl, { timeout: 10000 });
    comments = (res.data?.items || [])
      .map((item) => item.snippet?.topLevelComment?.snippet?.textDisplay || "")
      .filter((c) => c.length > 10);
  } catch (err) {
    return { suggestion: null, reason: `Comment fetch failed: ${err.message}` };
  }

  if (comments.length === 0) {
    return { suggestion: null, reason: "No comments found" };
  }

  // Use Claude to extract the main unanswered question
  try {
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system:
        'You analyse YouTube comments to find the main unanswered question or frustration. Reply with ONLY a JSON object: { "question": "the main question/complaint", "hook_suggestion": "a script hook that addresses this" }',
      messages: [
        {
          role: "user",
          content: `Topic: "${topic}"\nVideo: "${bestVideo.title}"\n\nTop ${comments.length} comments:\n${comments.slice(0, 15).join("\n---\n")}`,
        },
      ],
    });

    let text = response.content[0].text.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    const result = JSON.parse(text);
    return {
      suggestion: result.hook_suggestion || null,
      question: result.question || null,
      sourceVideo: bestVideo.title,
      commentCount: comments.length,
    };
  } catch (err) {
    return {
      suggestion: null,
      reason: `Sentiment analysis failed: ${err.message}`,
    };
  }
}

module.exports = {
  trackCompetitors,
  analyzePostingPatterns,
  identifyContentGaps,
  generateReport,
  runCompetitorAnalysis,
  extractTopicKeywords,
  loadData,
  loadConfig,
  detectSaturation,
  getAngleSuggestion,
  analyzeSentiment,
};

// CLI usage: node competitor_monitor.js
if (require.main === module) {
  runCompetitorAnalysis().catch((err) => {
    console.log(`[competitor] ERROR: ${err.message}`);
    process.exit(1);
  });
}

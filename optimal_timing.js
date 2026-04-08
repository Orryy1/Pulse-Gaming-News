const fs = require("fs-extra");
const path = require("path");

const HISTORY_PATH = path.join(__dirname, "analytics_history.json");
const DAILY_NEWS_PATH = path.join(__dirname, "daily_news.json");

const MIN_DATA_POINTS = 20;
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const DEFAULT_SCHEDULE = {
  crons: ["0 7 * * *", "0 13 * * *", "0 19 * * *"],
  labels: [
    "07:00 UTC - default morning",
    "13:00 UTC - default afternoon",
    "19:00 UTC - default evening",
  ],
  confidence: "low",
  dataPoints: 0,
};

// --- Helpers ---

/**
 * Loads analytics history entries and enriches them with publish hour/day
 * by cross-referencing daily_news.json for published_at timestamps.
 */
async function loadEnrichedEntries() {
  if (!(await fs.pathExists(HISTORY_PATH))) return [];

  const history = await fs.readJson(HISTORY_PATH);
  const entries = history.entries || [];
  if (entries.length === 0) return [];

  // Also load daily_news for any published_at data not in history
  let newsStories = [];
  if (await fs.pathExists(DAILY_NEWS_PATH)) {
    newsStories = await fs.readJson(DAILY_NEWS_PATH);
  }

  // Build a lookup of story ID -> published_at from daily_news
  const publishedAtMap = {};
  for (const story of newsStories) {
    if (story.id && (story.youtube_published_at || story.timestamp)) {
      publishedAtMap[story.id] = story.youtube_published_at || story.timestamp;
    }
  }

  // Enrich entries with parsed publish time
  const enriched = [];
  for (const entry of entries) {
    const publishedAt = entry.published_at || publishedAtMap[entry.id];
    if (!publishedAt) continue;

    const date = new Date(publishedAt);
    if (isNaN(date.getTime())) continue;

    enriched.push({
      ...entry,
      published_at: publishedAt,
      publish_hour: date.getUTCHours(),
      publish_day: date.getUTCDay(),
      virality_score: entry.virality_score || 0,
    });
  }

  return enriched;
}

/**
 * Groups entries by a numeric key and computes average virality per bucket.
 * Returns an array of { key, avgVirality, count } sorted by avgVirality desc.
 */
function groupByKey(entries, keyFn) {
  const buckets = {};

  for (const entry of entries) {
    const key = keyFn(entry);
    if (key === undefined || key === null) continue;
    if (!buckets[key]) buckets[key] = { total: 0, count: 0 };
    buckets[key].total += entry.virality_score;
    buckets[key].count += 1;
  }

  return Object.entries(buckets)
    .map(([key, data]) => ({
      key: parseInt(key, 10),
      avgVirality: Math.round((data.total / data.count) * 10) / 10,
      count: data.count,
    }))
    .sort((a, b) => b.avgVirality - a.avgVirality);
}

// --- Public API ---

/**
 * Analyses optimal publish windows by hour of day (UTC).
 * Returns the top 3 hours ranked by average virality score.
 */
async function analyzeOptimalWindows() {
  const entries = await loadEnrichedEntries();

  if (entries.length < MIN_DATA_POINTS) {
    return {
      insufficient: true,
      dataPoints: entries.length,
      required: MIN_DATA_POINTS,
      hours: [],
    };
  }

  const hourBuckets = groupByKey(entries, (e) => e.publish_hour);

  // Edge case: all entries at same hour
  if (hourBuckets.length <= 1) {
    return {
      insufficient: false,
      dataPoints: entries.length,
      singleHour: true,
      hours: hourBuckets,
      message:
        "All entries published at the same hour - insufficient variation to recommend changes.",
    };
  }

  return {
    insufficient: false,
    dataPoints: entries.length,
    singleHour: false,
    hours: hourBuckets.slice(0, 3),
    allHours: hourBuckets,
  };
}

/**
 * Analyses performance by day of week.
 * Returns best and worst days plus the full ranking.
 */
async function analyzeDayOfWeek() {
  const entries = await loadEnrichedEntries();

  if (entries.length < MIN_DATA_POINTS) {
    return {
      insufficient: true,
      dataPoints: entries.length,
      required: MIN_DATA_POINTS,
      best: null,
      worst: null,
      days: [],
    };
  }

  const dayBuckets = groupByKey(entries, (e) => e.publish_day);

  if (dayBuckets.length <= 1) {
    return {
      insufficient: false,
      dataPoints: entries.length,
      singleDay: true,
      best: dayBuckets[0]
        ? { ...dayBuckets[0], name: DAY_NAMES[dayBuckets[0].key] }
        : null,
      worst: null,
      days: dayBuckets.map((d) => ({ ...d, name: DAY_NAMES[d.key] })),
    };
  }

  const withNames = dayBuckets.map((d) => ({ ...d, name: DAY_NAMES[d.key] }));

  return {
    insufficient: false,
    dataPoints: entries.length,
    singleDay: false,
    best: withNames[0],
    worst: withNames[withNames.length - 1],
    days: withNames,
  };
}

/**
 * Combines hour and day analysis into a recommended cron schedule.
 * Falls back to defaults when data is insufficient.
 */
async function getRecommendedSchedule() {
  const entries = await loadEnrichedEntries();

  if (entries.length < MIN_DATA_POINTS) {
    return { ...DEFAULT_SCHEDULE, dataPoints: entries.length };
  }

  const hourBuckets = groupByKey(entries, (e) => e.publish_hour);

  // Need at least 2 distinct hours to make a recommendation
  if (hourBuckets.length < 2) {
    return {
      ...DEFAULT_SCHEDULE,
      confidence: "low",
      dataPoints: entries.length,
      reason: "All entries published at same hour - not enough variation.",
    };
  }

  // Pick top 3 hours (or fewer if less data)
  const topHours = hourBuckets.slice(0, Math.min(3, hourBuckets.length));

  // Determine confidence based on data volume and spread
  let confidence = "medium";
  if (entries.length >= 50 && hourBuckets.length >= 4) {
    confidence = "high";
  } else if (entries.length < 30 || hourBuckets.length < 3) {
    confidence = "medium";
  }

  // Check statistical significance - top hour should be meaningfully better
  if (hourBuckets.length >= 2) {
    const topAvg = hourBuckets[0].avgVirality;
    const bottomAvg = hourBuckets[hourBuckets.length - 1].avgVirality;
    // If difference is less than 10%, the signal is weak
    if (bottomAvg > 0 && (topAvg - bottomAvg) / bottomAvg < 0.1) {
      confidence = confidence === "high" ? "medium" : "low";
    }
  }

  const crons = topHours.map((h) => `0 ${h.key} * * *`);
  const labels = topHours.map((h) => {
    const padded = String(h.key).padStart(2, "0");
    return `${padded}:00 UTC - avg virality ${h.avgVirality} (${h.count} videos)`;
  });

  return {
    crons,
    labels,
    confidence,
    dataPoints: entries.length,
  };
}

/**
 * Returns a human-readable summary of the timing analysis,
 * suitable for Discord notifications or dashboard display.
 */
async function getTimingReport() {
  const [hourAnalysis, dayAnalysis, schedule] = await Promise.all([
    analyzeOptimalWindows(),
    analyzeDayOfWeek(),
    getRecommendedSchedule(),
  ]);

  const lines = [];
  lines.push("**Publish Timing Analysis**");
  lines.push(
    `Data points: ${schedule.dataPoints} | Confidence: ${schedule.confidence}`,
  );
  lines.push("");

  // Hour analysis
  if (hourAnalysis.insufficient) {
    lines.push(
      `**Hours:** Insufficient data (${hourAnalysis.dataPoints}/${hourAnalysis.required} needed)`,
    );
  } else if (hourAnalysis.singleHour) {
    lines.push(`**Hours:** ${hourAnalysis.message}`);
  } else {
    lines.push("**Best Publish Hours (UTC):**");
    for (const h of hourAnalysis.hours) {
      const padded = String(h.key).padStart(2, "0");
      lines.push(
        `  ${padded}:00 - avg virality ${h.avgVirality} (${h.count} videos)`,
      );
    }
  }

  lines.push("");

  // Day analysis
  if (dayAnalysis.insufficient) {
    lines.push(
      `**Days:** Insufficient data (${dayAnalysis.dataPoints}/${dayAnalysis.required} needed)`,
    );
  } else if (dayAnalysis.singleDay) {
    lines.push(
      `**Days:** All data from ${dayAnalysis.best?.name || "one day"} - need more spread`,
    );
  } else {
    lines.push(
      `**Best Day:** ${dayAnalysis.best.name} - avg virality ${dayAnalysis.best.avgVirality} (${dayAnalysis.best.count} videos)`,
    );
    lines.push(
      `**Worst Day:** ${dayAnalysis.worst.name} - avg virality ${dayAnalysis.worst.avgVirality} (${dayAnalysis.worst.count} videos)`,
    );
  }

  lines.push("");

  // Active schedule
  lines.push("**Active Schedule:**");
  for (const label of schedule.labels) {
    lines.push(`  ${label}`);
  }

  return lines.join("\n");
}

/**
 * Ghost slot strategy: post 20 minutes before competitors' peak hours.
 * Loads competitor posting patterns and returns offset cron expressions.
 */
async function getGhostSlots() {
  let competitorPatterns = {};
  try {
    const { analyzePostingPatterns } = require("./competitor_monitor");
    competitorPatterns = await analyzePostingPatterns();
  } catch (err) {
    return { slots: [], reason: "Competitor data not available" };
  }

  // Aggregate peak hours across all competitors
  const hourVotes = new Array(24).fill(0);
  for (const pattern of Object.values(competitorPatterns)) {
    for (const peak of pattern.peakHours || []) {
      hourVotes[peak.hour] += peak.count;
    }
  }

  // Find top 3 competitor peak hours
  const competitorPeaks = hourVotes
    .map((votes, hour) => ({ hour, votes }))
    .filter((h) => h.votes > 0)
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 3);

  if (competitorPeaks.length === 0) {
    return { slots: [], reason: "No competitor peak hours detected" };
  }

  // Ghost slots: 20 minutes before each competitor peak
  const ghostSlots = competitorPeaks.map((peak) => {
    const ghostMinute = 40; // :40 of the previous hour = 20 min before :00
    const ghostHour = peak.hour === 0 ? 23 : peak.hour - 1;
    return {
      cron: `${ghostMinute} ${ghostHour} * * *`,
      label: `${ghostHour}:${ghostMinute} UTC (ghost: 20min before competitor peak ${peak.hour}:00)`,
      competitorHour: peak.hour,
      competitorVotes: peak.votes,
    };
  });

  return { slots: ghostSlots, competitorPeaks };
}

module.exports = {
  analyzeOptimalWindows,
  analyzeDayOfWeek,
  getRecommendedSchedule,
  getTimingReport,
  getGhostSlots,
  DEFAULT_SCHEDULE,
};

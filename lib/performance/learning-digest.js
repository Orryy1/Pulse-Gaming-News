"use strict";

const {
  DEFAULT_SCORE_CONFIG,
  classifyScore,
  scorePerformanceSnapshot,
} = require("./performance-score");

function latestSnapshotByVideo(snapshots = []) {
  const byVideo = new Map();
  for (const row of snapshots.filter(Boolean)) {
    const key = row.video_id || row.story_id || row.title;
    if (!key) continue;
    const prev = byVideo.get(key);
    const currentTime = Date.parse(row.snapshot_at || "") || 0;
    const prevTime = Date.parse(prev?.snapshot_at || "") || 0;
    if (!prev || currentTime >= prevTime) byVideo.set(key, row);
  }
  return Array.from(byVideo.values());
}

function groupAverage(rows, keyFn, valueFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row) || "unknown";
    const value = Number(valueFn(row));
    if (!Number.isFinite(value)) continue;
    const item = groups.get(key) || { key, total: 0, count: 0 };
    item.total += value;
    item.count += 1;
    groups.set(key, item);
  }
  return Array.from(groups.values())
    .map((g) => ({ key: g.key, count: g.count, average: Number((g.total / g.count).toFixed(2)) }))
    .sort((a, b) => b.average - a.average || b.count - a.count);
}

function buildRecommendations({ scored = [], features = [], commentInsights = [] } = {}) {
  const recommendations = [];
  const worstRetention = scored
    .filter((r) => r.snapshot.average_percentage_viewed !== null && r.snapshot.average_percentage_viewed !== undefined && Number.isFinite(Number(r.snapshot.average_percentage_viewed)))
    .sort((a, b) => Number(a.snapshot.average_percentage_viewed) - Number(b.snapshot.average_percentage_viewed))[0];

  if (worstRetention && Number(worstRetention.snapshot.average_percentage_viewed) < 45) {
    recommendations.push({
      type: "retention",
      priority: "high",
      recommendation: "Prioritise shorter setup and earlier payoff on low-retention topics.",
      evidence: {
        video_id: worstRetention.snapshot.video_id,
        average_percentage_viewed: worstRetention.snapshot.average_percentage_viewed,
      },
    });
  }

  const v21Features = features.filter((f) => f.render_version === "studio-v21");
  if (v21Features.some((f) => Number(f.hero_moment_count) > 0)) {
    recommendations.push({
      type: "render_experiment",
      priority: "review",
      recommendation: "Track hero-moment count against retention before promoting Studio V2.1.",
      evidence: {
        sample_count: v21Features.length,
        max_hero_moments: Math.max(...v21Features.map((f) => Number(f.hero_moment_count) || 0)),
      },
    });
  }

  const topicRequests = commentInsights.filter((c) => c.category === "topic_suggestion");
  if (topicRequests.length) {
    recommendations.push({
      type: "comments",
      priority: "review",
      recommendation: "Review repeated viewer topic suggestions before the next hunt cycle.",
      evidence: {
        count: topicRequests.length,
        examples: topicRequests.slice(0, 3).map((c) => c.text || c.useful_signal || c.comment_id),
      },
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      type: "baseline",
      priority: "review",
      recommendation: "Keep collecting snapshots before changing scoring weights.",
      evidence: { reason: "early-channel sample size" },
    });
  }

  return recommendations;
}

function buildPerformanceLearningDigest({
  snapshots = [],
  features = [],
  commentInsights = [],
  generatedAt = new Date().toISOString(),
  dataSource = "fixture",
  scoreConfig = DEFAULT_SCORE_CONFIG,
} = {}) {
  const latest = latestSnapshotByVideo(snapshots);
  const featureByVideo = new Map(features.map((f) => [f.video_id || f.story_id, f]));
  const scored = latest.map((snapshot) => {
    const score = scorePerformanceSnapshot(snapshot, scoreConfig);
    const feature = featureByVideo.get(snapshot.video_id) || featureByVideo.get(snapshot.story_id) || {};
    return {
      snapshot,
      feature,
      score: score.score,
      scoreClass: classifyScore(score.score),
      components: score.components,
      derived: score.derived,
    };
  });

  const topPerformer = [...scored].sort((a, b) => b.score - a.score)[0] || null;
  const worstRetention = [...scored]
    .filter((r) => r.snapshot.average_percentage_viewed !== null && r.snapshot.average_percentage_viewed !== undefined && Number.isFinite(Number(r.snapshot.average_percentage_viewed)))
    .sort((a, b) => Number(a.snapshot.average_percentage_viewed) - Number(b.snapshot.average_percentage_viewed))[0] || null;

  const byTopic = groupAverage(scored, (r) => r.feature.topic || r.snapshot.topic, (r) => r.score);
  const byHook = groupAverage(scored, (r) => r.feature.hook_type || r.snapshot.hook_type, (r) => r.score);
  const byRuntime = groupAverage(
    scored,
    (r) => {
      const runtime = Number(r.feature.runtime_seconds || r.snapshot.runtime_seconds);
      if (!Number.isFinite(runtime)) return "unknown";
      if (runtime < 45) return "under-45s";
      if (runtime <= 60) return "45-60s";
      return "over-60s";
    },
    (r) => r.score,
  );

  const recommendations = buildRecommendations({ scored, features, commentInsights });

  return {
    schemaVersion: 1,
    generatedAt,
    dataSource,
    scoreConfig,
    snapshotCount: snapshots.length,
    videoCount: latest.length,
    topPerformer,
    worstRetention,
    patterns: {
      topic: byTopic,
      hook: byHook,
      runtime: byRuntime,
    },
    commentSignals: {
      count: commentInsights.length,
      usefulSignals: commentInsights
        .filter((c) => c.useful_signal)
        .slice(0, 10)
        .map((c) => c.useful_signal),
    },
    recommendations,
  };
}

function renderDigestMarkdown(digest) {
  const lines = [];
  lines.push("# Performance Intelligence Loop v1");
  lines.push("");
  lines.push(`Generated: ${digest.generatedAt}`);
  lines.push(`Data source: ${digest.dataSource}`);
  lines.push(`Videos analysed: ${digest.videoCount}`);
  lines.push("");
  if (digest.topPerformer) {
    lines.push("## Top performer");
    lines.push(`- ${digest.topPerformer.snapshot.title || digest.topPerformer.snapshot.video_id}: score ${digest.topPerformer.score} (${digest.topPerformer.scoreClass})`);
    lines.push(`- Views/hour: ${digest.topPerformer.derived.views_per_hour}, retention: ${digest.topPerformer.snapshot.average_percentage_viewed ?? "unknown"}%`);
    lines.push("");
  }
  if (digest.worstRetention) {
    lines.push("## Worst retention");
    lines.push(`- ${digest.worstRetention.snapshot.title || digest.worstRetention.snapshot.video_id}: ${digest.worstRetention.snapshot.average_percentage_viewed}% average viewed`);
    lines.push("");
  }
  lines.push("## Winning patterns to watch");
  for (const row of digest.patterns.topic.slice(0, 5)) {
    lines.push(`- Topic ${row.key}: average score ${row.average} across ${row.count}`);
  }
  for (const row of digest.patterns.hook.slice(0, 3)) {
    lines.push(`- Hook ${row.key}: average score ${row.average} across ${row.count}`);
  }
  lines.push("");
  lines.push("## Recommendations");
  for (const rec of digest.recommendations) {
    lines.push(`- [${rec.priority}] ${rec.recommendation}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- Local analytics and fixture digestion only.");
  lines.push("- No production scoring weights were changed.");
  lines.push("- No YouTube comments, likes or replies were mutated.");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildPerformanceLearningDigest,
  buildRecommendations,
  latestSnapshotByVideo,
  renderDigestMarkdown,
};

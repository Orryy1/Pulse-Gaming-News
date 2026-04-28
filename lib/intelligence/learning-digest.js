"use strict";

/**
 * lib/intelligence/learning-digest.js — Session 3 (intelligence pass).
 *
 * Builds a daily/periodic learning digest from local snapshot rows
 * + feature rows. Emits both Markdown (for the operator) and JSON
 * (for downstream tooling).
 *
 * NEVER auto-changes scoring weights. The output is observation +
 * suggested experiment only — the operator decides whether to act.
 *
 * Confidence levels:
 *   - high   : >= 12 samples per bucket
 *   - medium : 6-11 samples
 *   - low    : 3-5 samples
 *   - insufficient : 0-2 samples (no recommendation)
 */

const path = require("node:path");
const fs = require("fs-extra");

function median(values = []) {
  const v = (values || [])
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 0 ? (v[mid - 1] + v[mid]) / 2 : v[mid];
}

function confidenceFor(n) {
  if (n >= 12) return "high";
  if (n >= 6) return "medium";
  if (n >= 3) return "low";
  return "insufficient";
}

function bucketBy(items, keyFn) {
  const out = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!k) continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(it);
  }
  return out;
}

/**
 * Compute aggregate metrics for a list of (snapshot, feature) joined rows.
 * Each row should carry: views, average_percentage_viewed,
 * average_view_duration_seconds, comments, subscribers_gained.
 */
function aggregate(rows) {
  return {
    sample_count: rows.length,
    median_views: median(rows.map((r) => r.views)),
    median_avp: median(rows.map((r) => r.average_percentage_viewed)),
    median_avd_seconds: median(
      rows.map((r) => r.average_view_duration_seconds),
    ),
    median_subscribers_gained: median(rows.map((r) => r.subscribers_gained)),
    median_comments: median(rows.map((r) => r.comments)),
  };
}

function bestAndWorst(rows, metric = "average_percentage_viewed") {
  const ranked = rows
    .filter((r) => Number.isFinite(Number(r[metric])))
    .sort((a, b) => Number(b[metric]) - Number(a[metric]));
  return {
    best: ranked[0] || null,
    worst: ranked[ranked.length - 1] || null,
  };
}

function buildLearningDigest({
  snapshotsByVideo = {},
  features = [],
  commentSummary = null,
  windowDays = 7,
}) {
  // Join: each row = { ...latest snapshot for video, ...features for video }
  const featureByVideo = new Map();
  for (const f of features) {
    if (!f.video_id) continue;
    featureByVideo.set(f.video_id, f);
  }

  const joined = [];
  for (const [videoId, snaps] of Object.entries(snapshotsByVideo)) {
    if (!Array.isArray(snaps) || snaps.length === 0) continue;
    const latest = snaps[snaps.length - 1];
    const f = featureByVideo.get(videoId) || {};
    joined.push({
      video_id: videoId,
      title: f.title || latest.title || "(unknown)",
      format_type: f.format_type || "unknown",
      topic: f.topic || "general",
      franchise: f.franchise || "unknown",
      hook_type: f.hook_type || "unknown",
      title_pattern: f.title_pattern || "unknown",
      runtime_seconds: f.runtime_seconds || 0,
      media_inventory_class: f.media_inventory_class || "unknown",
      visual_qa_class: f.visual_qa_class || "unknown",
      thumbnail_safety_status: f.thumbnail_safety_status || "unknown",
      views: Number(latest.views || 0),
      average_percentage_viewed: Number(latest.average_percentage_viewed || 0),
      average_view_duration_seconds: Number(
        latest.average_view_duration_seconds || 0,
      ),
      comments: Number(latest.comments || 0),
      subscribers_gained: Number(latest.subscribers_gained || 0),
      shorts_feed_views: Number(latest.shorts_feed_views || 0),
    });
  }

  if (joined.length === 0) {
    return {
      window_days: windowDays,
      total_videos: 0,
      generated_at: new Date().toISOString(),
      confidence: "insufficient",
      message: "No video performance snapshots in window — nothing to analyse.",
    };
  }

  const overall = aggregate(joined);
  const overallBestWorst = bestAndWorst(joined);
  const formats = bucketBy(joined, (r) => r.format_type);
  const topics = bucketBy(joined, (r) => r.topic);
  const titlePatterns = bucketBy(joined, (r) => r.title_pattern);
  const inventoryBands = bucketBy(joined, (r) => r.media_inventory_class);

  const formatPerf = Array.from(formats.entries())
    .map(([k, v]) => ({
      format_type: k,
      ...aggregate(v),
      confidence: confidenceFor(v.length),
    }))
    .sort((a, b) => (b.median_avp || 0) - (a.median_avp || 0));
  const topicPerf = Array.from(topics.entries())
    .map(([k, v]) => ({
      topic: k,
      ...aggregate(v),
      confidence: confidenceFor(v.length),
    }))
    .sort((a, b) => (b.median_views || 0) - (a.median_views || 0));
  const titlePatternPerf = Array.from(titlePatterns.entries())
    .map(([k, v]) => ({
      title_pattern: k,
      ...aggregate(v),
      confidence: confidenceFor(v.length),
    }))
    .sort((a, b) => (b.median_avp || 0) - (a.median_avp || 0));
  const inventoryPerf = Array.from(inventoryBands.entries())
    .map(([k, v]) => ({
      inventory_class: k,
      ...aggregate(v),
      confidence: confidenceFor(v.length),
    }))
    .sort((a, b) => (b.median_avp || 0) - (a.median_avp || 0));

  const subsGainers = joined
    .filter((r) => r.subscribers_gained > 0)
    .sort((a, b) => b.subscribers_gained - a.subscribers_gained)
    .slice(0, 5);
  const commentHeavy = joined
    .filter((r) => r.comments > 0)
    .sort((a, b) => b.comments - a.comments)
    .slice(0, 5);
  const underperformers = joined
    .filter(
      (r) => r.average_percentage_viewed < (overall.median_avp || 0) * 0.7,
    )
    .sort((a, b) => a.average_percentage_viewed - b.average_percentage_viewed)
    .slice(0, 5);

  const recommendations = [];
  const topFormat = formatPerf[0];
  if (
    topFormat &&
    topFormat.confidence !== "insufficient" &&
    topFormat.median_avp > (overall.median_avp || 0)
  ) {
    recommendations.push({
      type: "do_more_of",
      priority: "review",
      detail: `Format \`${topFormat.format_type}\` outperformed overall median AVP (${topFormat.median_avp?.toFixed(2)} vs ${overall.median_avp?.toFixed(2) ?? "n/a"}, n=${topFormat.sample_count}, confidence=${topFormat.confidence}). Consider raising cadence.`,
    });
  }
  const worstFormat = formatPerf[formatPerf.length - 1];
  if (
    worstFormat &&
    worstFormat.confidence !== "insufficient" &&
    worstFormat.median_avp < (overall.median_avp || 0) * 0.7
  ) {
    recommendations.push({
      type: "do_less_of",
      priority: "review",
      detail: `Format \`${worstFormat.format_type}\` underperformed (median AVP ${worstFormat.median_avp?.toFixed(2)}, n=${worstFormat.sample_count}, confidence=${worstFormat.confidence}). Hold cadence or pause until causes are identified.`,
    });
  }
  const topInventory = inventoryPerf[0];
  if (topInventory && topInventory.confidence !== "insufficient") {
    recommendations.push({
      type: "inventory_signal",
      priority: "review",
      detail: `Best-performing media-inventory class is \`${topInventory.inventory_class}\` (median AVP ${topInventory.median_avp?.toFixed(2)}, n=${topInventory.sample_count}). Stories that score below this class should be routed to a smaller format.`,
    });
  }

  const experimentsSuggested = [];
  if (titlePatternPerf.length >= 2) {
    const a = titlePatternPerf[0];
    const b = titlePatternPerf[titlePatternPerf.length - 1];
    if (
      a.confidence !== "insufficient" &&
      b.confidence !== "insufficient" &&
      a.median_avp - b.median_avp > 0.05
    ) {
      experimentsSuggested.push({
        key: `title_pattern_${a.title_pattern}_vs_${b.title_pattern}`,
        hypothesis: `Title pattern \`${a.title_pattern}\` retains better than \`${b.title_pattern}\` on Pulse Gaming Shorts.`,
        variant_a: a.title_pattern,
        variant_b: b.title_pattern,
        sample_size_required: 12,
        suggested_window_days: 14,
      });
    }
  }

  return {
    window_days: windowDays,
    generated_at: new Date().toISOString(),
    total_videos: joined.length,
    confidence: confidenceFor(joined.length),
    overall: {
      ...overall,
      best_video: overallBestWorst.best
        ? {
            video_id: overallBestWorst.best.video_id,
            title: overallBestWorst.best.title,
          }
        : null,
      worst_video: overallBestWorst.worst
        ? {
            video_id: overallBestWorst.worst.video_id,
            title: overallBestWorst.worst.title,
          }
        : null,
    },
    by_format: formatPerf,
    by_topic: topicPerf,
    by_title_pattern: titlePatternPerf,
    by_inventory_class: inventoryPerf,
    subscriber_gainers: subsGainers,
    comment_heavy: commentHeavy,
    underperformers,
    recommendations,
    experiments_suggested: experimentsSuggested,
    comment_signal_summary: commentSummary || null,
    safety: {
      auto_promote_formats: false,
      auto_demote_formats: false,
      auto_change_scoring_weights: false,
      operator_review_required: true,
    },
  };
}

function renderDigestMarkdown(digest) {
  const lines = [];
  lines.push("# Pulse Gaming — Learning Digest");
  lines.push("");
  lines.push(`Generated: ${digest.generated_at}`);
  lines.push(
    `Window: ${digest.window_days} days · sample size: ${digest.total_videos} · confidence: **${digest.confidence}**`,
  );
  lines.push("");
  if (digest.message) {
    lines.push(digest.message);
    return lines.join("\n") + "\n";
  }
  lines.push("## Overall");
  lines.push("");
  lines.push(`- median views: ${digest.overall.median_views ?? "n/a"}`);
  lines.push(`- median AVP: ${digest.overall.median_avp?.toFixed(2) ?? "n/a"}`);
  lines.push(
    `- median AVD: ${digest.overall.median_avd_seconds?.toFixed(1) ?? "n/a"}s`,
  );
  lines.push(
    `- median subs gained: ${digest.overall.median_subscribers_gained ?? "n/a"}`,
  );
  if (digest.overall.best_video) {
    lines.push(`- top performer: ${digest.overall.best_video.title}`);
  }
  if (digest.overall.worst_video) {
    lines.push(`- worst retention: ${digest.overall.worst_video.title}`);
  }
  lines.push("");
  lines.push("## By format");
  for (const f of digest.by_format) {
    lines.push(
      `- \`${f.format_type}\` (n=${f.sample_count}, confidence=${f.confidence}): AVP ${f.median_avp?.toFixed(2) ?? "n/a"}, views ${f.median_views ?? "n/a"}`,
    );
  }
  lines.push("");
  lines.push("## By topic / franchise");
  for (const t of digest.by_topic) {
    lines.push(
      `- \`${t.topic}\` (n=${t.sample_count}): views ${t.median_views ?? "n/a"}, AVP ${t.median_avp?.toFixed(2) ?? "n/a"}`,
    );
  }
  lines.push("");
  lines.push("## By title pattern");
  for (const tp of digest.by_title_pattern) {
    lines.push(
      `- \`${tp.title_pattern}\` (n=${tp.sample_count}): AVP ${tp.median_avp?.toFixed(2) ?? "n/a"}`,
    );
  }
  lines.push("");
  lines.push("## By media inventory class");
  for (const inv of digest.by_inventory_class) {
    lines.push(
      `- \`${inv.inventory_class}\` (n=${inv.sample_count}): AVP ${inv.median_avp?.toFixed(2) ?? "n/a"}, views ${inv.median_views ?? "n/a"}`,
    );
  }
  lines.push("");
  lines.push("## Subscriber gainers (top 5)");
  for (const s of digest.subscriber_gainers || []) {
    lines.push(`- ${s.title} — ${s.subscribers_gained} subs gained`);
  }
  lines.push("");
  lines.push("## Comment-heavy (top 5)");
  for (const c of digest.comment_heavy || []) {
    lines.push(`- ${c.title} — ${c.comments} comments`);
  }
  lines.push("");
  lines.push("## Underperformers to inspect");
  for (const u of digest.underperformers || []) {
    lines.push(`- ${u.title} — AVP ${u.average_percentage_viewed.toFixed(2)}`);
  }
  lines.push("");
  lines.push("## Recommendations (review only — never auto-applied)");
  for (const r of digest.recommendations || []) {
    lines.push(`- [${r.type}] (${r.priority}) ${r.detail}`);
  }
  lines.push("");
  lines.push("## Suggested experiments");
  for (const e of digest.experiments_suggested || []) {
    lines.push(
      `- ${e.key}: ${e.hypothesis} (sample size required: ${e.sample_size_required})`,
    );
  }
  lines.push("");
  if (digest.comment_signal_summary) {
    lines.push("## Comment signal summary");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(digest.comment_signal_summary, null, 2));
    lines.push("```");
  }
  lines.push("");
  lines.push("## Safety");
  for (const [k, v] of Object.entries(digest.safety || {})) {
    lines.push(`- ${k}: ${v}`);
  }
  return lines.join("\n") + "\n";
}

async function writeDigestArtefacts(digest, outDir) {
  await fs.ensureDir(outDir);
  const date = new Date().toISOString().slice(0, 10);
  const jsonPath = path.join(outDir, `digest-${date}.json`);
  const mdPath = path.join(outDir, `digest-${date}.md`);
  await fs.writeFile(jsonPath, JSON.stringify(digest, null, 2));
  await fs.writeFile(mdPath, renderDigestMarkdown(digest));
  return { jsonPath, mdPath };
}

module.exports = {
  buildLearningDigest,
  renderDigestMarkdown,
  writeDigestArtefacts,
  median,
  confidenceFor,
};

"use strict";

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function latestValue(values = []) {
  const list = asArray(values);
  if (!list.length) return null;
  const value = list[list.length - 1]?.value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const nums = Object.values(value).map(numberOrNull).filter((item) => item !== null);
    return nums.length ? nums.reduce((sum, item) => sum + item, 0) : null;
  }
  return numberOrNull(value);
}

function extractMetricValue(insights = {}, names = []) {
  return extractMetricEntry(insights, names)?.value ?? null;
}

function extractMetricEntry(insights = {}, names = []) {
  const wanted = new Set(asArray(names).map(lower));
  for (const item of asArray(insights.data)) {
    if (!wanted.has(lower(item.name))) continue;
    const value = latestValue(item.values);
    if (value !== null) return { name: lower(item.name), value };
  }
  return null;
}

function normalisePostPlatform(value) {
  const platform = lower(value);
  if (platform === "instagram" || platform === "instagram_reel" || platform === "instagram_reels") {
    return "instagram_reels";
  }
  if (platform === "facebook" || platform === "facebook_reel" || platform === "facebook_reels") {
    return "facebook_reels";
  }
  return platform;
}

function snapshotPlatform(platform) {
  if (platform === "instagram_reels") return "instagram";
  if (platform === "facebook_reels") return "facebook";
  return null;
}

const METRIC_NAMES = {
  instagram_reels: {
    views: ["views", "plays", "video_views", "ig_reels_video_views"],
    reach: ["reach"],
    likes: ["likes", "like_count"],
    comments: ["comments", "comments_count"],
    shares: ["shares"],
    saves: ["saved", "saves"],
    watchTime: ["ig_reels_video_view_total_time", "watch_time", "total_video_view_time"],
    averageWatchTime: ["ig_reels_avg_watch_time"],
    skipRate: ["reels_skip_rate"],
  },
  facebook_reels: {
    views: ["post_video_views", "total_video_views", "plays", "video_views"],
    reach: ["post_impressions_unique", "post_reach", "reach"],
    likes: ["post_reactions_like_total", "likes"],
    comments: ["post_comments", "comments"],
    shares: ["post_shares", "shares"],
    watchTime: ["post_video_view_time", "watch_time", "total_video_view_time"],
  },
};

const META_INSIGHTS_REQUEST_METRICS = {
  instagram_reels: [
    "views",
    "reach",
    "likes",
    "comments",
    "shares",
    "saved",
    "ig_reels_video_view_total_time",
    "ig_reels_avg_watch_time",
    "reels_skip_rate",
  ],
  // Facebook's video_insights edge returns every metric available to the
  // token when metric is omitted. This avoids coupling collection to aliases
  // that Meta retires between Graph versions.
  facebook_reels: [],
};

function buildMetaInsightsRequest({ target = {}, graphVersion = "v21.0" } = {}) {
  const platform = normalisePostPlatform(target.platform);
  const externalId = clean(target.external_id);
  const edge = platform === "facebook_reels" ? "video_insights" : "insights";
  return {
    url: `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(externalId)}/${edge}`,
    edge,
    platform,
  };
}

function buildMetaMetricSnapshotRow({
  post = {},
  insights = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const normalised = normalisePostPlatform(post.platform);
  const platform = snapshotPlatform(normalised);
  if (!platform) return null;

  const metricNames = METRIC_NAMES[normalised];
  const views = extractMetricValue(insights, metricNames.views);
  const reach = extractMetricValue(insights, metricNames.reach);
  const likes = extractMetricValue(insights, metricNames.likes);
  const comments = extractMetricValue(insights, metricNames.comments);
  const shares = extractMetricValue(insights, metricNames.shares);
  const saves = extractMetricValue(insights, metricNames.saves);
  const watchTimeEntry = extractMetricEntry(insights, metricNames.watchTime);
  const averageWatchTimeEntry = extractMetricEntry(insights, metricNames.averageWatchTime);
  const skipRate = extractMetricValue(insights, metricNames.skipRate);
  const watchTime = watchTimeEntry?.name === "ig_reels_video_view_total_time"
    ? watchTimeEntry.value / 1000
    : watchTimeEntry?.value ?? null;
  const averageWatchTime = averageWatchTimeEntry?.name === "ig_reels_avg_watch_time"
    ? averageWatchTimeEntry.value / 1000
    : averageWatchTimeEntry?.value ?? null;

  return {
    story_id: clean(post.story_id),
    platform,
    external_id: clean(post.external_id) || null,
    snapshot_at: generatedAt,
    channel_id: clean(post.channel_id) || "pulse-gaming",
    views,
    likes,
    comments,
    shares,
    watch_time_seconds: watchTime,
    retention_percent: null,
    raw_json: {
      source: "meta_graph_reels_insights",
      platform: normalised,
      reach,
      saves,
      average_watch_time_seconds: averageWatchTime,
      reels_skip_rate: skipRate,
      watch_time_source_metric: watchTimeEntry?.name || null,
      metric_names: metricNames,
    },
  };
}

async function collectMetaReelsInsightSnapshots({
  targets = [],
  generatedAt = new Date().toISOString(),
  apply = false,
  fetchInsights,
  persistSnapshot,
} = {}) {
  const safeTargets = asArray(targets).filter((target) =>
    ["instagram_reels", "facebook_reels"].includes(normalisePostPlatform(target?.platform)),
  );
  const snapshots = [];
  const errors = [];
  const terminalPlatformBlockers = new Map();
  let networkRequests = 0;

  for (const target of safeTargets) {
    const normalisedTarget = {
      ...target,
      platform: normalisePostPlatform(target.platform),
    };
    const cachedBlocker = terminalPlatformBlockers.get(normalisedTarget.platform);
    if (cachedBlocker) {
      errors.push({
        story_id: clean(normalisedTarget.story_id),
        platform: normalisedTarget.platform,
        external_id: clean(normalisedTarget.external_id),
        ...cachedBlocker,
        skipped_due_to_platform_blocker: true,
      });
      continue;
    }
    try {
      if (typeof fetchInsights !== "function") {
        throw new Error("fetchInsights function is required");
      }
      networkRequests += 1;
      const insights = await fetchInsights(normalisedTarget);
      const row = buildMetaMetricSnapshotRow({
        post: normalisedTarget,
        insights,
        generatedAt,
      });
      if (!row) continue;
      if (apply && typeof persistSnapshot === "function") {
        row.persisted_id = persistSnapshot(row);
      }
      snapshots.push(row);
    } catch (error) {
      const diagnostics = error?.metaDiagnostics || {};
      const errorRow = {
        story_id: clean(normalisedTarget.story_id),
        platform: normalisedTarget.platform,
        external_id: clean(normalisedTarget.external_id),
        message: error?.message || String(error),
        status: error?.response?.status || null,
        code: error?.response?.data?.error?.code || null,
        blocker_kind: diagnostics.blocker_kind || null,
        operator_action_required: diagnostics.operator_action_required === true,
        retryable: diagnostics.retryable === true,
        required_permissions: asArray(diagnostics.required_permissions),
        next_action: clean(diagnostics.next_action) || null,
        skipped_due_to_platform_blocker: false,
      };
      errors.push(errorRow);
      if (["permission_required", "token_invalid_or_expired", "access_token_missing"]
        .includes(errorRow.blocker_kind)) {
        terminalPlatformBlockers.set(normalisedTarget.platform, {
          message: errorRow.message,
          status: errorRow.status,
          code: errorRow.code,
          blocker_kind: errorRow.blocker_kind,
          operator_action_required: errorRow.operator_action_required,
          retryable: errorRow.retryable,
          required_permissions: errorRow.required_permissions,
          next_action: errorRow.next_action,
        });
      }
    }
  }

  const blockerSummary = errors.reduce((summary, error) => {
    const kind = clean(error.blocker_kind) || "unclassified";
    summary[kind] = (summary[kind] || 0) + 1;
    return summary;
  }, {});

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: apply ? "meta_reels_insights_collect_apply" : "meta_reels_insights_collect_dry_run",
    verdict: errors.length && snapshots.length ? "partial" : errors.length ? "failed" : snapshots.length ? "ready" : "no_targets",
    counts: {
      targets: safeTargets.length,
      fetched: snapshots.length,
      failed: errors.length,
      persisted: snapshots.filter((row) => row.persisted_id !== undefined).length,
      network_requests: networkRequests,
    },
    snapshots,
    errors,
    blocker_summary: blockerSummary,
    safety: {
      read_only: !apply,
      network_called: networkRequests > 0,
      no_db_mutation: !apply,
      no_oauth_triggered: true,
      no_token_mutation: true,
      no_social_uploads: true,
      no_public_posts: true,
      story_rows_mutated: false,
    },
  };
}

function buildTarget(row = {}) {
  const platform = normalisePostPlatform(row.platform);
  if (!["instagram_reels", "facebook_reels"].includes(platform)) return null;
  if (lower(row.status) !== "published") return null;
  if (!clean(row.story_id) || !clean(row.external_id)) return null;
  return {
    story_id: clean(row.story_id),
    platform,
    external_id: clean(row.external_id),
    channel_id: clean(row.channel_id) || "pulse-gaming",
    published_at: row.published_at || row.updated_at || row.created_at || null,
    metrics: METRIC_NAMES[platform],
    request_metrics: META_INSIGHTS_REQUEST_METRICS[platform],
  };
}

function buildMetaReelsInsightsPlan({
  platformPosts = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const targets = asArray(platformPosts).map(buildTarget).filter(Boolean);
  const counts = targets.reduce(
    (acc, target) => {
      acc[target.platform] = (acc[target.platform] || 0) + 1;
      return acc;
    },
    { instagram_reels: 0, facebook_reels: 0 },
  );
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "read_only_meta_reels_insights_plan",
    verdict: targets.length ? "ready" : "no_targets",
    counts: {
      targets: targets.length,
      instagram_reels: counts.instagram_reels || 0,
      facebook_reels: counts.facebook_reels || 0,
    },
    targets,
    next_action: targets.length
      ? "Run a guarded Meta insights collector to persist platform_metric_snapshots for these Reels."
      : "Wait for published Instagram/Facebook Reels before collecting Meta insights.",
    safety: {
      read_only: true,
      no_network_calls: true,
      no_db_mutation: true,
      no_oauth_triggered: true,
      no_token_mutation: true,
      no_social_uploads: true,
      no_public_posts: true,
    },
  };
}

function renderMetaReelsInsightsPlanMarkdown(plan = {}) {
  const lines = [
    "# Meta Reels Insights Packet",
    "",
    `Generated: ${plan.generated_at || "unknown"}`,
    `Verdict: ${String(plan.verdict || "unknown").toUpperCase()}`,
    `Targets: ${plan.counts?.targets ?? 0}`,
    `Instagram Reels: ${plan.counts?.instagram_reels ?? 0}`,
    `Facebook Reels: ${plan.counts?.facebook_reels ?? 0}`,
    "",
    "## Targets",
    "",
  ];
  for (const target of asArray(plan.targets)) {
    lines.push(`- ${target.platform} ${target.story_id}: ${target.external_id}`);
  }
  if (!asArray(plan.targets).length) lines.push("- none");
  lines.push(
    "",
    "## Safety",
    "",
    "- Read-only plan",
    "- No network calls",
    "- No DB mutation",
    "- No OAuth or token changes",
    "",
    `Next action: ${plan.next_action || "unknown"}`,
    "",
  );
  return lines.join("\n");
}

module.exports = {
  META_INSIGHTS_REQUEST_METRICS,
  METRIC_NAMES,
  buildMetaInsightsRequest,
  buildMetaMetricSnapshotRow,
  buildMetaReelsInsightsPlan,
  collectMetaReelsInsightSnapshots,
  extractMetricEntry,
  extractMetricValue,
  normalisePostPlatform,
  renderMetaReelsInsightsPlanMarkdown,
};

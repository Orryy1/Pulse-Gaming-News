"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "21_observability_dashboard";

const REQUIRED_DASHBOARD_FIELDS = [
  "discovered_stories",
  "rejected_stories",
  "videos_rendered",
  "blocked_videos",
  "publish_status",
  "render_time",
  "failures",
  "cost",
  "quality_scores",
  "hook_scores",
  "benchmark_scores",
  "policy_risk",
  "rights_risk",
  "affiliate_risk",
  "source_confidence",
  "platform_performance",
  "retention",
  "views",
  "followers",
  "comments",
  "shares",
  "clicks",
  "revenue",
  "profit",
  "recurring_failure_reasons",
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function hasObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
}

function resolveWorkspacePath(workspaceRoot, value) {
  const text = cleanText(value);
  if (!text) return "";
  if (path.isAbsolute(text)) return path.resolve(text);
  return path.resolve(workspaceRoot || process.cwd(), text);
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function storyIdFromPackage(storyPackage = {}) {
  return cleanText(storyPackage.story_id || storyPackage.id || storyPackage.storyId);
}

function normaliseStatus(value) {
  return cleanText(value).toLowerCase();
}

function passLike(value) {
  return ["pass", "passed", "ready", "green", "ok", "clear"].includes(normaliseStatus(value));
}

function failuresFrom(...values) {
  const failures = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    failures.push(
      ...asArray(value.failures),
      ...asArray(value.blockers),
      ...asArray(value.publish_blockers),
      ...asArray(value.reason_codes),
      ...asArray(value.errors),
    );
  }
  return unique(failures);
}

function warningsFrom(...values) {
  const warnings = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    warnings.push(...asArray(value.warnings));
  }
  return unique(warnings);
}

function numericValue(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string" && candidate.trim() !== "" && Number.isFinite(Number(candidate))) {
      return Number(candidate);
    }
    if (candidate && typeof candidate === "object") {
      const nested = numericValue(candidate.value, candidate.amount, candidate.total, candidate.count, candidate.score);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function metric(value, extras = {}) {
  const available = value !== null && value !== undefined && !(typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length);
  return {
    value: available ? value : null,
    status: available ? "available" : "not_available",
    ...extras,
  };
}

function collectNumericValues(value, out = []) {
  if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectNumericValues(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectNumericValues(item, out);
  }
  return out;
}

function hasNumericEvidence(value) {
  return collectNumericValues(value).length > 0;
}

function recognisedRetention(retention = {}) {
  if (!hasObject(retention)) return null;
  const keys = [
    "average_view_duration_seconds",
    "average_view_duration",
    "retention_curve",
    "first_3_second_drop_off",
    "stayed_to_watch",
    "swipe_away",
    "replays",
    "watch_time_seconds",
    "retention_percent",
  ];
  const hasKnown = keys.some((key) => retention[key] !== undefined && retention[key] !== null);
  return hasKnown ? retention : null;
}

function recognisedPlatformPerformance(platformPerformance = {}) {
  if (!hasObject(platformPerformance)) return null;
  return hasNumericEvidence(platformPerformance) ? platformPerformance : null;
}

function mergeObjects(...values) {
  return Object.assign({}, ...values.filter(hasObject));
}

function buildGoal20Index(upstreamAntiSpamReport = {}) {
  const index = new Map();
  for (const row of asArray(upstreamAntiSpamReport.stories || upstreamAntiSpamReport.rows)) {
    const storyId = cleanText(row.story_id || row.id);
    if (storyId) index.set(storyId, row);
  }
  return index;
}

function upstreamBlockers(storyId, antiSpamIndex = new Map()) {
  const row = antiSpamIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal20_anti_spam_uniqueness_missing"];
  const blockers = failuresFrom(row);
  const status = normaliseStatus(row.status || row.verdict || row.direct_uniqueness_status || row.final_verdict);
  if (passLike(status) && blockers.length === 0) return [];
  return unique(["upstream:goal20_anti_spam_uniqueness_blocked", ...blockers]);
}

function readMetricBundle({
  canonical = {},
  scriptScorecard = {},
  renderManifest = {},
  visualQualityReport = {},
  benchmarkReport = {},
  platformPolicyReport = {},
  rightsLedger = {},
  affiliateManifest = {},
  platformManifest = {},
  publishVerdict = {},
  analyticsPerformance = {},
  retentionReport = {},
  revenueAttribution = {},
} = {}) {
  const platformPerformance = recognisedPlatformPerformance(
    analyticsPerformance.platform_performance ||
      analyticsPerformance.platforms ||
      analyticsPerformance.metrics_by_platform ||
      analyticsPerformance,
  );
  const retention = recognisedRetention(
    analyticsPerformance.retention ||
      retentionReport.retention ||
      retentionReport.metrics ||
      retentionReport,
  );
  const currency = cleanText(revenueAttribution.currency || revenueAttribution.revenue?.currency || "GBP") || "GBP";
  const publishStatus = cleanText(
    platformManifest.publish_status ||
      platformManifest.status ||
      publishVerdict.verdict ||
      publishVerdict.status,
  );

  const views = numericValue(
    analyticsPerformance.views,
    analyticsPerformance.total_views,
    analyticsPerformance.metrics?.views,
    platformPerformance?.youtube_shorts?.views,
    platformPerformance?.youtube?.views,
  );
  const followers = numericValue(
    analyticsPerformance.followers,
    analyticsPerformance.follows,
    analyticsPerformance.subscribers,
    analyticsPerformance.follows_or_subscribers_gained,
    analyticsPerformance.metrics?.followers,
  );
  const comments = numericValue(
    analyticsPerformance.comments,
    analyticsPerformance.metrics?.comments,
    platformPerformance?.youtube_shorts?.comments,
  );
  const shares = numericValue(
    analyticsPerformance.shares,
    analyticsPerformance.metrics?.shares,
    platformPerformance?.youtube_shorts?.shares,
  );
  const clicks = numericValue(
    analyticsPerformance.clicks,
    analyticsPerformance.affiliate_clicks,
    analyticsPerformance.landing_page_clicks,
    analyticsPerformance.metrics?.clicks,
  );
  const cost = numericValue(
    revenueAttribution.cost,
    revenueAttribution.total_cost,
    revenueAttribution.production_cost,
  );
  const revenue = numericValue(
    revenueAttribution.revenue,
    revenueAttribution.total_revenue,
    revenueAttribution.affiliate_revenue,
  );
  const profit = numericValue(
    revenueAttribution.profit,
    revenueAttribution.net_profit,
    revenue !== null && cost !== null ? revenue - cost : null,
  );
  const qualityScores = mergeObjects(visualQualityReport.scores, visualQualityReport.metrics);
  const hookScores = mergeObjects(
    scriptScorecard.scores ? { hook_strength: scriptScorecard.scores.hook_strength } : {},
    scriptScorecard.hook_scores,
  );
  const benchmarkScores = mergeObjects(benchmarkReport.scores, benchmarkReport.metrics);

  return {
    discovered_stories: metric(1),
    rejected_stories: metric(0),
    videos_rendered: metric(renderManifest.final_publish_render === true || cleanText(renderManifest.output_path || renderManifest.output) ? 1 : 0),
    blocked_videos: metric(0),
    publish_status: metric(publishStatus || null),
    render_time: metric(numericValue(renderManifest.render_time_ms, renderManifest.elapsed_ms, renderManifest.render_duration_ms), {
      unit: "ms",
    }),
    failures: metric([]),
    cost: metric(cost, { currency }),
    quality_scores: metric(hasNumericEvidence(qualityScores) ? qualityScores : null),
    hook_scores: metric(hasNumericEvidence(hookScores) ? hookScores : null),
    benchmark_scores: metric(hasNumericEvidence(benchmarkScores) ? benchmarkScores : null),
    policy_risk: metric(hasObject(platformPolicyReport) ? {
      verdict: platformPolicyReport.verdict || platformPolicyReport.result || platformPolicyReport.status || null,
      risk_score: numericValue(platformPolicyReport.risk_score, platformPolicyReport.policy_risk_score),
      failures: failuresFrom(platformPolicyReport),
      warnings: warningsFrom(platformPolicyReport),
    } : null),
    rights_risk: metric(hasObject(rightsLedger) ? {
      verdict: rightsLedger.verdict || rightsLedger.result || rightsLedger.status || null,
      risk_score: numericValue(rightsLedger.rights_risk_score, rightsLedger.risk_score),
      failures: failuresFrom(rightsLedger),
      warnings: warningsFrom(rightsLedger),
    } : null),
    affiliate_risk: metric(hasObject(affiliateManifest) ? {
      verdict: affiliateManifest.verdict || affiliateManifest.result || affiliateManifest.status || null,
      risk_score: numericValue(affiliateManifest.affiliate_risk_score, affiliateManifest.risk_score),
      disclosure_required: affiliateManifest.disclosure_required ?? affiliateManifest.disclosure?.required ?? null,
      failures: failuresFrom(affiliateManifest),
      warnings: warningsFrom(affiliateManifest),
    } : null),
    source_confidence: metric(numericValue(
      canonical.source_confidence_score,
      canonical.source_confidence,
      canonical.source_confidence?.score,
    )),
    platform_performance: metric(platformPerformance),
    retention: metric(retention),
    views: metric(views),
    followers: metric(followers),
    comments: metric(comments),
    shares: metric(shares),
    clicks: metric(clicks),
    revenue: metric(revenue, { currency }),
    profit: metric(profit, { currency }),
    recurring_failure_reasons: metric([]),
  };
}

function missingMetricBlockers(metrics = {}) {
  const blockers = [];
  for (const [field, code] of [
    ["publish_status", "observability:publish_status_missing"],
    ["render_time", "observability:render_time_missing"],
    ["quality_scores", "observability:quality_scores_missing"],
    ["hook_scores", "observability:hook_scores_missing"],
    ["benchmark_scores", "observability:benchmark_scores_missing"],
    ["policy_risk", "observability:policy_risk_missing"],
    ["rights_risk", "observability:rights_risk_missing"],
    ["affiliate_risk", "observability:affiliate_risk_missing"],
    ["source_confidence", "observability:source_confidence_missing"],
    ["platform_performance", "observability:platform_performance_missing"],
    ["retention", "observability:retention_missing"],
    ["views", "observability:views_missing"],
    ["followers", "observability:followers_missing"],
    ["comments", "observability:comments_missing"],
    ["shares", "observability:shares_missing"],
    ["clicks", "observability:clicks_missing"],
    ["cost", "observability:cost_missing"],
    ["revenue", "observability:revenue_missing"],
    ["profit", "observability:profit_missing"],
  ]) {
    if (metrics[field]?.status !== "available") blockers.push(code);
  }
  if (!metrics.videos_rendered || metrics.videos_rendered.value < 1) blockers.push("observability:video_render_missing");
  return blockers;
}

async function loadStoryPackage(storyPackage = {}, context = {}) {
  const storyId = storyIdFromPackage(storyPackage);
  const artifactDir = resolveWorkspacePath(context.workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir);
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const scriptScorecard = await readJsonIfPresent(path.join(artifactDir, "script_scorecard.json"), {});
  const renderManifest = await readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {});
  const visualQualityReport = await readJsonIfPresent(path.join(artifactDir, "visual_quality_report.json"), {});
  const benchmarkReport = await readJsonIfPresent(path.join(artifactDir, "benchmark_report.json"), {});
  const platformPolicyReport = await readJsonIfPresent(path.join(artifactDir, "platform_policy_report.json"), {});
  const rightsLedger = await readJsonIfPresent(path.join(artifactDir, "rights_ledger.json"), {});
  const affiliateManifest = await readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"), {});
  const platformManifest = await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {});
  const publishVerdict = await readJsonIfPresent(path.join(artifactDir, "publish_verdict.json"), {});
  const analyticsPerformance = await readJsonIfPresent(path.join(artifactDir, "analytics_performance_report.json"), {});
  const retentionReport = await readJsonIfPresent(path.join(artifactDir, "retention_report.json"), {});
  const revenueAttribution = await readJsonIfPresent(path.join(artifactDir, "revenue_attribution_report.json"), {});

  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    title: cleanText(canonical.selected_title || canonical.canonical_title || storyPackage.title),
    story_package_verdict: storyPackage.verdict || null,
    story_package_blockers: asArray(storyPackage.blockers),
    metrics: readMetricBundle({
      canonical,
      scriptScorecard,
      renderManifest,
      visualQualityReport,
      benchmarkReport,
      platformPolicyReport,
      rightsLedger,
      affiliateManifest,
      platformManifest,
      publishVerdict,
      analyticsPerformance,
      retentionReport,
      revenueAttribution,
    }),
    source_material: {
      canonical_story_manifest_present: hasObject(canonical),
      script_scorecard_present: hasObject(scriptScorecard),
      render_manifest_present: hasObject(renderManifest),
      visual_quality_report_present: hasObject(visualQualityReport),
      benchmark_report_present: hasObject(benchmarkReport),
      platform_policy_report_present: hasObject(platformPolicyReport),
      rights_ledger_present: hasObject(rightsLedger),
      affiliate_manifest_present: hasObject(affiliateManifest),
      platform_publish_manifest_present: hasObject(platformManifest),
      publish_verdict_present: hasObject(publishVerdict),
      analytics_performance_report_present: hasObject(analyticsPerformance),
      retention_report_present: hasObject(retentionReport),
      revenue_attribution_report_present: hasObject(revenueAttribution),
    },
  };
}

function finaliseStory(story = {}, antiSpamIndex = new Map()) {
  const upstream = upstreamBlockers(story.story_id, antiSpamIndex);
  const directBlockers = missingMetricBlockers(story.metrics);
  const directStatus = directBlockers.length ? "blocked" : "pass";
  const blockers = unique([...upstream, ...directBlockers]);
  const status = blockers.length ? "blocked" : "ready";
  const warnings = warningsFrom(story.metrics.policy_risk?.value, story.metrics.rights_risk?.value, story.metrics.affiliate_risk?.value);
  const metrics = {
    ...story.metrics,
    rejected_stories: metric(status === "blocked" ? 1 : 0),
    blocked_videos: metric(status === "blocked" ? 1 : 0),
    failures: metric(blockers),
    recurring_failure_reasons: metric(blockers),
  };
  return {
    ...story,
    status,
    upstream_status: upstream.length ? "blocked" : "ready",
    direct_observability_status: directStatus,
    blockers,
    upstream_blockers: upstream,
    direct_observability_blockers: directBlockers,
    warnings,
    metrics,
    safety: {
      local_proof_only: true,
      dry_run_publish_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
  };
}

function countBy(values = []) {
  const counts = {};
  for (const value of values) {
    const key = cleanText(value) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function blockerCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function directRiskCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.direct_observability_blockers)) {
      counts[blocker] = (counts[blocker] || 0) + 1;
    }
  }
  return counts;
}

function aggregateMetric(stories = [], field, { mode = "sum" } = {}) {
  const metrics = asArray(stories).map((story) => story.metrics?.[field]).filter(Boolean);
  const available = metrics.filter((item) => item.status === "available" && typeof item.value === "number" && Number.isFinite(item.value));
  const missingCount = metrics.length - available.length;
  const sum = available.reduce((total, item) => total + item.value, 0);
  const value = available.length
    ? mode === "average"
      ? Number((sum / available.length).toFixed(4))
      : Number(sum.toFixed(4))
    : null;
  return {
    status: available.length === metrics.length && metrics.length ? "available" : available.length ? "partial" : "not_available",
    value,
    available_count: available.length,
    missing_count: missingCount,
  };
}

function averageScoreMap(stories = [], field) {
  const totals = {};
  const counts = {};
  for (const story of asArray(stories)) {
    const value = story.metrics?.[field]?.value;
    if (!hasObject(value)) continue;
    for (const [key, score] of Object.entries(value)) {
      if (typeof score !== "number" || !Number.isFinite(score)) continue;
      totals[key] = (totals[key] || 0) + score;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  const averages = {};
  for (const [key, total] of Object.entries(totals)) averages[key] = Number((total / counts[key]).toFixed(4));
  return {
    status: Object.keys(averages).length ? "available" : "not_available",
    averages,
    available_count: Math.max(0, ...Object.values(counts), 0),
  };
}

function buildDashboardModel(report = {}) {
  const stories = asArray(report.stories);
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    summary: {
      discovered_stories: stories.length,
      rejected_stories: stories.filter((story) => story.status === "blocked").length,
      videos_rendered: stories.filter((story) => story.metrics?.videos_rendered?.value >= 1).length,
      blocked_videos: stories.filter((story) => story.metrics?.blocked_videos?.value >= 1).length,
      publish_status: countBy(stories.map((story) => story.metrics?.publish_status?.value)),
      render_time: aggregateMetric(stories, "render_time", { mode: "average" }),
      failures: {
        total_stories_with_failures: stories.filter((story) => asArray(story.blockers).length > 0).length,
        by_reason: report.recurring_failure_reasons || {},
      },
      cost: aggregateMetric(stories, "cost"),
      quality_scores: averageScoreMap(stories, "quality_scores"),
      hook_scores: averageScoreMap(stories, "hook_scores"),
      benchmark_scores: averageScoreMap(stories, "benchmark_scores"),
      policy_risk: averageMetricObjectRisk(stories, "policy_risk"),
      rights_risk: averageMetricObjectRisk(stories, "rights_risk"),
      affiliate_risk: averageMetricObjectRisk(stories, "affiliate_risk"),
      source_confidence: aggregateMetric(stories, "source_confidence", { mode: "average" }),
      platform_performance: availabilitySummary(stories, "platform_performance"),
      retention: availabilitySummary(stories, "retention"),
      views: aggregateMetric(stories, "views"),
      followers: aggregateMetric(stories, "followers"),
      comments: aggregateMetric(stories, "comments"),
      shares: aggregateMetric(stories, "shares"),
      clicks: aggregateMetric(stories, "clicks"),
      revenue: aggregateMetric(stories, "revenue"),
      profit: aggregateMetric(stories, "profit"),
      recurring_failure_reasons: report.recurring_failure_reasons || {},
    },
    stories: stories.map((story) => ({
      story_id: story.story_id,
      title: story.title,
      status: story.status,
      upstream_status: story.upstream_status,
      direct_observability_status: story.direct_observability_status,
      blockers: story.blockers,
      warnings: story.warnings,
      metrics: story.metrics,
      source_material: story.source_material,
    })),
    safety: {
      local_proof_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
    },
  };
}

function availabilitySummary(stories = [], field) {
  const metrics = asArray(stories).map((story) => story.metrics?.[field]).filter(Boolean);
  const available = metrics.filter((item) => item.status === "available").length;
  return {
    status: available === metrics.length && metrics.length ? "available" : available ? "partial" : "not_available",
    available_count: available,
    missing_count: metrics.length - available,
  };
}

function averageMetricObjectRisk(stories = [], field) {
  const values = asArray(stories)
    .map((story) => story.metrics?.[field]?.value)
    .filter(hasObject)
    .map((value) => numericValue(value.risk_score))
    .filter((value) => value !== null);
  const average = values.length ? Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(4)) : null;
  return {
    status: values.length ? "available" : "not_available",
    average_risk_score: average,
    available_count: values.length,
    missing_count: Math.max(0, stories.length - values.length),
  };
}

function buildReportingEndpoints(report = {}, outputDir = "") {
  const file = (name, description) => ({
    method: "FILE",
    path: path.join(outputDir || "output/goal-21", name).replace(/\\/g, "/"),
    content_type: "application/json",
    description,
    access: "local_read_only",
  });
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    files: {
      dashboard_model: file("dashboard_model.json", "Dashboard model for operator UI or reporting ingestion."),
      daily_studio_report: file("daily_studio_report.json", "Daily local studio status report."),
      weekly_performance_report: file("weekly_performance_report.json", "Weekly local performance report."),
      blocked_content_report: file("blocked_content_report.json", "Blocked story and blocker rollup."),
      revenue_report: file("revenue_report.json", "Revenue, cost and profit rollup without fake zeros."),
    },
    planned_read_only_api_routes: [
      "/api/observability/dashboard",
      "/api/observability/daily",
      "/api/observability/weekly",
      "/api/observability/blocked-content",
      "/api/observability/revenue",
    ],
    note: "This run writes file-backed reporting artefacts only. It does not register live routes, call analytics APIs, publish or mutate production data.",
    safety: {
      local_proof_only: true,
      no_network_uploads: true,
      no_db_mutation: true,
    },
  };
}

function buildDailyStudioReport(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    date: cleanText(report.generated_at).slice(0, 10) || null,
    mode: "LOCAL_PROOF",
    verdict: report.verdict || "UNKNOWN",
    direct_observability_verdict: report.direct_observability_verdict || "UNKNOWN",
    summary: report.summary || {},
    top_blockers: Object.entries(report.recurring_failure_reasons || {})
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 20)
      .map(([code, count]) => ({ code, count })),
    safety: report.safety || {},
  };
}

function buildWeeklyPerformanceReport(report = {}) {
  const dashboard = report.dashboard_model || buildDashboardModel(report);
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    week_basis: "local_proof_batch",
    verdict: report.verdict || "UNKNOWN",
    performance: {
      platform_performance: dashboard.summary.platform_performance,
      retention: dashboard.summary.retention,
      views: dashboard.summary.views,
      followers: dashboard.summary.followers,
      comments: dashboard.summary.comments,
      shares: dashboard.summary.shares,
      clicks: dashboard.summary.clicks,
      revenue: dashboard.summary.revenue,
      profit: dashboard.summary.profit,
    },
    blocked_by_live_metrics: dashboard.summary.platform_performance.status !== "available",
    safety: report.safety || {},
  };
}

function buildBlockedContentReport(report = {}) {
  const stories = asArray(report.stories).filter((story) => story.status === "blocked");
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    summary: {
      blocked_story_count: stories.length,
      direct_observability_blocked_story_count: stories.filter((story) => story.direct_observability_status === "blocked").length,
      upstream_blocked_story_count: stories.filter((story) => story.upstream_status === "blocked").length,
    },
    blocker_counts: blockerCounts(stories),
    stories: stories.map((story) => ({
      story_id: story.story_id,
      title: story.title,
      blockers: story.blockers,
      upstream_blockers: story.upstream_blockers,
      direct_observability_blockers: story.direct_observability_blockers,
      repair_note: story.direct_observability_blockers.length
        ? "Add the missing local observability evidence or ingest safe read-only metrics, then rerun Goal 21."
        : "Resolve upstream Goal 20 and earlier blockers, then rerun Goal 21.",
    })),
    safety: {
      no_publish_triggered: true,
      no_external_posting: true,
    },
  };
}

function totalMoney(stories = [], field) {
  const metrics = asArray(stories).map((story) => story.metrics?.[field]).filter(Boolean);
  const available = metrics.filter((item) => item.status === "available" && typeof item.value === "number");
  if (!available.length) {
    return {
      status: "not_available",
      value: null,
      currency: "GBP",
      available_count: 0,
      missing_count: metrics.length,
    };
  }
  return {
    status: available.length === metrics.length ? "available" : "partial",
    value: Number(available.reduce((total, item) => total + item.value, 0).toFixed(4)),
    currency: available[0].currency || "GBP",
    available_count: available.length,
    missing_count: metrics.length - available.length,
  };
}

function buildRevenueReport(report = {}) {
  const stories = asArray(report.stories);
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    totals: {
      cost: totalMoney(stories, "cost"),
      revenue: totalMoney(stories, "revenue"),
      profit: totalMoney(stories, "profit"),
    },
    stories: stories.map((story) => ({
      story_id: story.story_id,
      title: story.title,
      cost: story.metrics?.cost || metric(null, { currency: "GBP" }),
      revenue: story.metrics?.revenue || metric(null, { currency: "GBP" }),
      profit: story.metrics?.profit || metric(null, { currency: "GBP" }),
      blocked: story.status === "blocked",
      blockers: story.blockers,
    })),
    safety: {
      no_revenue_estimates_faked: true,
      no_publish_triggered: true,
      no_db_mutation: true,
    },
  };
}

async function buildGoal21ObservabilityDashboard({
  storyPackages = [],
  upstreamAntiSpamReport = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal21ObservabilityDashboard requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const antiSpamIndex = buildGoal20Index(upstreamAntiSpamReport);
  const loadedStories = [];
  for (const storyPackage of asArray(storyPackages)) {
    loadedStories.push(await loadStoryPackage(storyPackage, { workspaceRoot }));
  }
  const stories = loadedStories.map((story) => finaliseStory(story, antiSpamIndex));
  const readyStories = stories.filter((story) => story.status === "ready");
  const blockedStories = stories.filter((story) => story.status === "blocked");
  const directPassStories = stories.filter((story) => story.direct_observability_status === "pass");
  const directBlockedStories = stories.filter((story) => story.direct_observability_status === "blocked");
  const upstreamBlockedStories = stories.filter((story) => story.upstream_status === "blocked");
  const verdict = !stories.length
    ? "FAIL"
    : blockedStories.length && readyStories.length
      ? "PARTIAL"
      : blockedStories.length
        ? "BLOCKED"
        : "PASS";
  const directObservabilityVerdict = !stories.length
    ? "FAIL"
    : directBlockedStories.length && directPassStories.length
      ? "PARTIAL"
      : directBlockedStories.length
        ? "BLOCKED"
        : "PASS";
  const recurringFailureReasons = blockerCounts(stories);
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    direct_observability_verdict: directObservabilityVerdict,
    summary: {
      story_count: stories.length,
      observability_ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      direct_observability_pass_story_count: directPassStories.length,
      direct_observability_blocked_story_count: directBlockedStories.length,
      upstream_blocked_story_count: upstreamBlockedStories.length,
      publish_now_count: 0,
    },
    required_dashboard_fields: REQUIRED_DASHBOARD_FIELDS,
    blocker_counts: recurringFailureReasons,
    direct_risk_counts: directRiskCounts(stories),
    recurring_failure_reasons: recurringFailureReasons,
    upstream_blockers: {
      goal20_anti_spam_and_uniqueness_engine:
        "Goal 21 can compile local dashboard and reporting artefacts, but readiness requires Goal 20 and earlier campaign gates to be ready first.",
      note:
        "This gate emits LOCAL_PROOF files only. It does not publish, post externally, mutate production rows, inspect secrets or change OAuth/token state.",
    },
    stories,
    safety: {
      local_proof_only: true,
      dry_run_publish_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
      no_gate_weakened: true,
    },
  };
  report.dashboard_model = buildDashboardModel(report);
  report.reporting_endpoints = buildReportingEndpoints(report, outputDir);
  report.daily_studio_report = buildDailyStudioReport(report);
  report.weekly_performance_report = buildWeeklyPerformanceReport(report);
  report.blocked_content_report = buildBlockedContentReport(report);
  report.revenue_report = buildRevenueReport(report);
  return report;
}

function renderGoal21ObservabilityDashboardMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 21 Observability Dashboard");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Direct observability verdict: ${report.direct_observability_verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`Ready stories: ${report.summary?.observability_ready_story_count || 0}`);
  lines.push(`Blocked stories: ${report.summary?.blocked_story_count || 0}`);
  lines.push(`Direct pass stories: ${report.summary?.direct_observability_pass_story_count || 0}`);
  lines.push(`Direct blocked stories: ${report.summary?.direct_observability_blocked_story_count || 0}`);
  lines.push(`Upstream-blocked stories: ${report.summary?.upstream_blocked_story_count || 0}`);
  lines.push(`Publish-now actions: ${report.summary?.publish_now_count || 0}`);
  lines.push("");
  lines.push("## Dashboard Fields");
  for (const field of REQUIRED_DASHBOARD_FIELDS) lines.push(`- ${field}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("## Direct observability blockers");
  const direct = Object.keys(report.direct_risk_counts || {}).sort();
  if (!direct.length) lines.push("- none");
  for (const blocker of direct) lines.push(`- ${blocker}: ${report.direct_risk_counts[blocker]}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF and DRY_RUN_PUBLISH only. This run did not publish, post externally, mutate the database, touch OAuth or token files, inspect secrets or weaken gates.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal21ObservabilityDashboard(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal21ObservabilityDashboard requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal21_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal21_readiness_report.md");
  const dashboardModel = path.join(outDir, "dashboard_model.json");
  const reportingEndpoints = path.join(outDir, "reporting_endpoints.json");
  const dailyStudioReport = path.join(outDir, "daily_studio_report.json");
  const weeklyPerformanceReport = path.join(outDir, "weekly_performance_report.json");
  const blockedContentReport = path.join(outDir, "blocked_content_report.json");
  const revenueReport = path.join(outDir, "revenue_report.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal21ObservabilityDashboardMarkdown(report), "utf8");
  await fs.writeJson(dashboardModel, report.dashboard_model || buildDashboardModel(report), { spaces: 2 });
  await fs.writeJson(reportingEndpoints, report.reporting_endpoints || buildReportingEndpoints(report, outDir), { spaces: 2 });
  await fs.writeJson(dailyStudioReport, report.daily_studio_report || buildDailyStudioReport(report), { spaces: 2 });
  await fs.writeJson(weeklyPerformanceReport, report.weekly_performance_report || buildWeeklyPerformanceReport(report), { spaces: 2 });
  await fs.writeJson(blockedContentReport, report.blocked_content_report || buildBlockedContentReport(report), { spaces: 2 });
  await fs.writeJson(revenueReport, report.revenue_report || buildRevenueReport(report), { spaces: 2 });
  return {
    readinessJson,
    readinessMarkdown,
    dashboardModel,
    reportingEndpoints,
    dailyStudioReport,
    weeklyPerformanceReport,
    blockedContentReport,
    revenueReport,
  };
}

module.exports = {
  GOAL_ID,
  REQUIRED_DASHBOARD_FIELDS,
  buildBlockedContentReport,
  buildDailyStudioReport,
  buildDashboardModel,
  buildGoal21ObservabilityDashboard,
  buildReportingEndpoints,
  buildRevenueReport,
  buildWeeklyPerformanceReport,
  renderGoal21ObservabilityDashboardMarkdown,
  writeGoal21ObservabilityDashboard,
};

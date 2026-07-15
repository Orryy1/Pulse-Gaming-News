"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildRetentionIntelligence,
  repeatedClipWindows,
} = require("./intelligence/retention-intelligence");
const {
  hasPublicPlatformEvidence,
  isRealPlatformPostId,
} = require("./services/platform-evidence-status");

const GOAL_ID = "11_retention_intelligence_loop";

const GOAL11_REQUIRED_METRICS = [
  "views",
  "impressions",
  "average_view_duration_seconds",
  "retention_curve",
  "first_3_second_drop_off",
  "stayed_to_watch",
  "swipe_away",
  "replays",
  "likes",
  "comments",
  "shares",
  "saves",
  "follows",
  "clicks",
  "landing_visits",
  "revenue",
];

const METRIC_ALIASES = {
  views: ["views", "view_count"],
  impressions: ["impressions", "shown"],
  average_view_duration_seconds: [
    "average_view_duration_seconds",
    "averageViewDurationSeconds",
    "average_view_duration",
    "averageViewDuration",
    "avg_watch_seconds",
  ],
  retention_curve: [
    "retention_curve",
    "retentionCurve",
    "retentionRows",
    "retention_rows",
    "audience_retention_curve",
  ],
  first_3_second_drop_off: [
    "first_3_second_drop_off",
    "first3SecondDropOff",
    "first_3s_drop_off",
    "three_second_drop_off",
  ],
  stayed_to_watch: ["stayed_to_watch", "stayedToWatch", "stayed_to_watch_rate"],
  swipe_away: ["swipe_away", "swipeAway", "swiped_away", "swipedAway"],
  replays: ["replays", "replay_count"],
  likes: ["likes", "like_count"],
  comments: ["comments", "comment_count"],
  shares: ["shares", "share_count"],
  saves: ["saves", "save_count"],
  follows: ["follows", "follow_count", "subscribers_gained", "subscribersGained"],
  clicks: ["clicks", "click_count"],
  landing_visits: ["landing_visits", "landingVisits", "landing_page_visits"],
  revenue: ["revenue", "estimated_revenue", "estimatedRevenue"],
};

const DIAGNOSIS_DIMENSIONS = [
  "weak_hooks",
  "title",
  "first_frame",
  "pacing",
  "topic",
  "visual_density",
  "cta",
  "source_clarity",
  "platform_mismatch",
  "repeated_structure",
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

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
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

function rowsFromManifest(manifest = {}) {
  if (Array.isArray(manifest)) return manifest;
  return asArray(
    manifest.stories ||
      manifest.metrics ||
      manifest.rows ||
      manifest.retention_metrics ||
      manifest.analytics,
  );
}

function buildMetricsIndex(metricsManifest = {}) {
  const index = new Map();
  for (const row of rowsFromManifest(metricsManifest)) {
    const id = cleanText(row.story_id || row.storyId || row.id || row.video_id || row.videoId);
    if (id) index.set(id, row);
  }
  return index;
}

function buildUpstreamBenchmarkIndex(upstreamBenchmarkReport = {}) {
  const index = new Map();
  for (const row of asArray(upstreamBenchmarkReport.stories)) {
    const id = cleanText(row.story_id || row.id);
    if (id) index.set(id, row);
  }
  return index;
}

function upstreamSkippedInfo(storyId, upstreamBenchmarkIndex = new Map()) {
  const row = upstreamBenchmarkIndex.get(cleanText(storyId));
  if (cleanText(row?.status) !== "skipped") return null;
  return {
    status: cleanText(row.skipped_status || row.status) || "skipped",
    reason: cleanText(row.skipped_reason || row.reason) || "upstream_benchmark_skipped",
  };
}

function upstreamBlockers(storyId, upstreamBenchmarkIndex = new Map()) {
  const row = upstreamBenchmarkIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal10_gold_standard_forensics_missing"];
  if (cleanText(row.status) === "ready") return [];
  return unique([
    "upstream:goal10_gold_standard_forensics_blocked",
    ...asArray(row.blockers),
  ]);
}

function metricValue(row = {}, field) {
  for (const key of METRIC_ALIASES[field] || [field]) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return undefined;
}

function metricPresent(row = {}, field) {
  const value = metricValue(row, field);
  if (Array.isArray(value)) return value.length > 0;
  if (value === 0) return true;
  if (value === false) return true;
  return value !== undefined && value !== null && cleanText(value) !== "";
}

function missingMetrics(row = null) {
  if (!row) return [...GOAL11_REQUIRED_METRICS];
  return GOAL11_REQUIRED_METRICS.filter((field) => !metricPresent(row, field));
}

function metricNumber(row = {}, field, fallback = null) {
  const value = metricValue(row, field);
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function metricRows(row = {}, field) {
  const value = metricValue(row, field);
  return asArray(value);
}

function isShallowMetrics(row = {}) {
  return row?.partial_metrics_only === true || cleanText(row?.analytics_depth) === "shallow_platform_snapshot";
}

function normalisePublicationPhase(value) {
  const phase = cleanText(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (!phase) return null;
  if (["draft", "prepublication", "pre_publication", "pre_publish", "publish_planning"].includes(phase)) {
    return "prepublication";
  }
  if (["published", "public", "live", "postpublication", "post_publication", "post_publish"].includes(phase)) {
    return "published";
  }
  return "unknown";
}

function declaredPublicationPhase(storyPackage = {}) {
  const lifecycle = storyPackage.publication_lifecycle;
  const raw =
    storyPackage.publication_phase ||
    storyPackage.lifecycle_phase ||
    storyPackage.publish_lifecycle_phase ||
    (lifecycle && typeof lifecycle === "object" ? lifecycle.phase : lifecycle);
  return {
    raw: cleanText(raw) || null,
    phase: normalisePublicationPhase(raw),
  };
}

const PLATFORM_POST_ID_FIELDS = {
  youtube: "youtube_post_id",
  tiktok: "tiktok_post_id",
  instagram: "instagram_media_id",
  facebook: "facebook_post_id",
};

const PLATFORM_PUBLISHED_AT_FIELDS = {
  youtube: "youtube_published_at",
  tiktok: "tiktok_published_at",
  instagram: "instagram_published_at",
  facebook: "facebook_published_at",
};

function normalisePlatform(value) {
  const platform = cleanText(value).toLowerCase();
  if (platform.includes("youtube")) return "youtube";
  if (platform.includes("tiktok")) return "tiktok";
  if (platform.includes("instagram")) return "instagram";
  if (platform.includes("facebook")) return "facebook";
  return "";
}

function metricPublicPostId(metrics = {}) {
  return cleanText(
    metrics.public_post_id ||
      metrics.platform_post_id ||
      metrics.external_id ||
      metrics.video_id ||
      metrics.videoId,
  );
}

function timestampMs(value) {
  const timestamp = Date.parse(cleanText(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function assessMetricProvenance({
  storyId,
  storyPackage = {},
  canonical = {},
  platformManifest = {},
  metrics = null,
  generatedAt = null,
} = {}) {
  if (!metrics) {
    return {
      story_linked: false,
      public_post_linked: false,
      metric_public_post_id: null,
      expected_public_post_ids: [],
      observed_at: null,
      published_at: null,
      temporally_valid: false,
    };
  }
  const evidence = { ...canonical, ...platformManifest, ...storyPackage };
  const platform = normalisePlatform(metrics.platform || metrics.platform_id);
  const platformField = PLATFORM_POST_ID_FIELDS[platform];
  const allExpectedIds = unique(
    Object.values(PLATFORM_POST_ID_FIELDS)
      .map((field) => evidence[field])
      .filter(isRealPlatformPostId),
  );
  const platformExpectedId = platformField && isRealPlatformPostId(evidence[platformField])
    ? cleanText(evidence[platformField])
    : "";
  const expectedIds = platform
    ? platformExpectedId ? [platformExpectedId] : []
    : allExpectedIds;
  const postId = metricPublicPostId(metrics);
  const metricStoryId = cleanText(metrics.story_id || metrics.storyId);
  const observedAt = cleanText(
    metrics.observed_at ||
      metrics.metrics_observed_at ||
      metrics.collected_at ||
      metrics.captured_at ||
      metrics.snapshot_at ||
      metrics.generated_at,
  );
  const platformPublishedAtField = PLATFORM_PUBLISHED_AT_FIELDS[platform];
  const publishedAt = cleanText(
    (platformPublishedAtField ? evidence[platformPublishedAtField] : "") ||
      evidence.published_at ||
      evidence.youtube_published_at,
  );
  const observedTimestamp = timestampMs(observedAt);
  const publishedTimestamp = timestampMs(publishedAt);
  const expiresTimestamp = timestampMs(metrics.expires_at || metrics.valid_until);
  const generatedTimestamp = timestampMs(generatedAt);
  const explicitlyStale =
    metrics.stale === true ||
    ["stale", "expired"].includes(
      cleanText(metrics.freshness_status || metrics.evidence_status || metrics.status).toLowerCase(),
    );
  const temporallyValid =
    !explicitlyStale &&
    observedTimestamp !== null &&
    publishedTimestamp !== null &&
    observedTimestamp >= publishedTimestamp &&
    !(expiresTimestamp !== null && generatedTimestamp !== null && expiresTimestamp < generatedTimestamp);
  return {
    story_linked: metricStoryId === cleanText(storyId),
    public_post_linked:
      isRealPlatformPostId(postId) && expectedIds.some((expectedId) => expectedId === postId),
    metric_public_post_id: postId || null,
    expected_public_post_ids: expectedIds,
    platform: platform || null,
    observed_at: observedAt || null,
    published_at: publishedAt || null,
    temporally_valid: temporallyValid,
  };
}

function derivePublicationLifecycle({
  storyPackage = {},
  canonical = {},
  renderManifest = {},
  platformManifest = {},
  metrics = null,
} = {}) {
  const evidence = {
    ...canonical,
    ...platformManifest,
    ...storyPackage,
  };
  const publicEvidence =
    hasPublicPlatformEvidence(evidence) ||
    Object.values(PLATFORM_POST_ID_FIELDS).some((field) =>
      isRealPlatformPostId(evidence[field]),
    );
  const operatingMode = cleanText(
    platformManifest.operating_mode ||
      renderManifest.operating_mode ||
      storyPackage.operating_mode,
  ).toUpperCase();
  const noPublishTriggered = [
    platformManifest.no_publish_triggered,
    platformManifest.safety?.no_publish_triggered,
    renderManifest.no_publish_triggered,
    renderManifest.safety?.no_publish_triggered,
    storyPackage.no_publish_triggered,
    storyPackage.safety?.no_publish_triggered,
  ].some((value) => value === true);
  const verifiedPrepublication =
    ["LOCAL_PROOF", "DRY_RUN_PUBLISH", "HUMAN_REVIEW"].includes(operatingMode) &&
    noPublishTriggered;
  const declared = declaredPublicationPhase(storyPackage);
  let phase = "unknown";
  let conflictReason = null;
  if (declared.phase === "unknown") {
    conflictReason = "declared_publication_phase_unrecognised";
  } else if (declared.phase === "prepublication" && publicEvidence) {
    phase = "conflicted";
    conflictReason = "declared_prepublication_with_public_platform_evidence";
  } else if (declared.phase === "published" && !publicEvidence) {
    phase = "conflicted";
    conflictReason = "declared_published_without_public_platform_evidence";
  } else if (publicEvidence) {
    phase = "published";
  } else if (verifiedPrepublication) {
    phase = "prepublication";
  }
  if (phase === "prepublication" && metrics) {
    phase = "conflicted";
    conflictReason = "verified_prepublication_with_observed_performance_metrics";
  }
  return {
    phase,
    declared_phase: declared.phase,
    declared_phase_raw: declared.raw,
    conflict_reason: conflictReason,
    public_platform_evidence: publicEvidence,
    verified_prepublication_evidence: verifiedPrepublication,
    performance_evidence_present: Boolean(metrics),
    operating_mode: operatingMode || null,
  };
}

function sceneTimelineFromDirector(director = {}) {
  const scenes = asArray(director.scenes || director.timeline || director.shot_plan || director.shots)
    .map((scene) => ({
      ...scene,
      type: scene.type || scene.kind || scene.visual_treatment || "unknown",
      label: scene.label || scene.id || null,
      source: scene.source || scene.path || scene.asset_path || null,
      mediaStartS: scene.mediaStartS ?? scene.media_start_s ?? scene.media_start ?? null,
      startS: scene.startS ?? scene.start_s ?? scene.start ?? 0,
      durationS: scene.durationS ?? scene.duration_s ?? scene.duration ?? 0,
    }));
  return { scenes };
}

function firstFrameText(story = {}, director = {}) {
  const opening = asArray(director.scenes || director.timeline || director.shot_plan || director.shots)
    .find((scene) => numberOr(scene.startS ?? scene.start_s ?? scene.start, 0) <= 0.35) || {};
  return cleanText(
    opening.text ||
      opening.labelText ||
      opening.label_text ||
      opening.headline ||
      story.first_frame_text ||
      story.thumbnail_text ||
      story.suggested_thumbnail_text ||
      story.selected_title ||
      story.title,
  );
}

function wordCount(value) {
  const text = cleanText(value);
  return text ? text.split(/\s+/).length : 0;
}

function isGenericTitle(value) {
  return /^(?:this gaming story|gaming news update|new gaming update|this story)$/i.test(
    cleanText(value).replace(/[.!?]+$/g, ""),
  );
}

function platformOutputs(platformManifest = {}) {
  return platformManifest.outputs || platformManifest.platform_outputs || {};
}

function anyCtaMissing(platformManifest = {}) {
  const outputs = Object.values(platformOutputs(platformManifest));
  if (!outputs.length) return true;
  return outputs.some((output) => !cleanText(output?.cta_style || output?.cta || output?.caption_cta));
}

function requiredPlatformCount(platformManifest = {}) {
  return Object.keys(platformOutputs(platformManifest)).length;
}

function visualScoreBelow(report = {}, key) {
  const score = numberOr(report.scores?.[key], null);
  const threshold = numberOr(report.thresholds?.[key], null);
  return score !== null && threshold !== null && score < threshold;
}

function engagementRate(metrics = {}) {
  const views = metricNumber(metrics, "views", 0) || 0;
  if (!views) return null;
  const engagement =
    (metricNumber(metrics, "likes", 0) || 0) +
    (metricNumber(metrics, "comments", 0) || 0) +
    (metricNumber(metrics, "shares", 0) || 0) +
    (metricNumber(metrics, "saves", 0) || 0);
  return round(engagement / views, 4);
}

function storyObject({ storyId, storyPackage = {}, canonical = {}, director = {} }) {
  return {
    ...canonical,
    id: storyId,
    story_id: storyId,
    title: cleanText(canonical.selected_title || canonical.title || storyPackage.title),
    suggested_title: cleanText(canonical.selected_title || canonical.title || storyPackage.title),
    first_spoken_line: cleanText(canonical.first_spoken_line),
    full_script: cleanText(canonical.narration_script || canonical.full_script),
    tts_script: cleanText(canonical.narration_script || canonical.tts_script),
    first_frame_text: firstFrameText(canonical, director),
  };
}

function retentionRowsFromMetrics(metrics = {}) {
  return metricRows(metrics, "retention_curve");
}

function trafficRowsFromMetrics(metrics = {}, durationS = 60) {
  const explicit = asArray(metrics.traffic_rows || metrics.trafficRows);
  if (explicit.length) return explicit;
  const views = metricNumber(metrics, "views", null);
  const averageViewDuration = metricNumber(metrics, "average_view_duration_seconds", null);
  const averageViewed =
    averageViewDuration !== null && durationS > 0
      ? round(averageViewDuration / durationS, 4)
      : null;
  if (views === null && averageViewDuration === null && averageViewed === null) return [];
  return [
    {
      traffic_source_type: metrics.platform || metrics.platform_id || "SHORTS",
      views,
      average_view_duration_seconds: averageViewDuration,
      average_percentage_viewed: averageViewed,
    },
  ];
}

function addDiagnosis(diagnoses, item) {
  if (!item?.dimension) return;
  if (!DIAGNOSIS_DIMENSIONS.includes(item.dimension)) return;
  const key = `${item.dimension}:${item.id}`;
  if (diagnoses.some((existing) => `${existing.dimension}:${existing.id}` === key)) return;
  diagnoses.push({
    dimension: item.dimension,
    id: item.id,
    severity: item.severity || "medium",
    evidence: cleanText(item.evidence),
    recommendation_id: item.recommendation_id || null,
  });
}

function buildDiagnoses({
  story = {},
  metrics = null,
  hasCompleteMetrics = false,
  intelligence = null,
  director = {},
  platformManifest = {},
  visualQualityReport = {},
}) {
  const diagnoses = [];
  const title = cleanText(story.suggested_title || story.title);
  const openingText = firstFrameText(story, director);
  const repeated = repeatedClipWindows(sceneTimelineFromDirector(director).scenes);

  if (
    hasCompleteMetrics &&
    ((intelligence?.hook?.score ?? 100) < 75 ||
      (metricNumber(metrics, "first_3_second_drop_off", 0) || 0) >= 0.25)
  ) {
    addDiagnosis(diagnoses, {
      dimension: "weak_hooks",
      id: "weak_first_three_seconds",
      severity: "high",
      evidence: `hook_score=${intelligence?.hook?.score ?? "n/a"} first_3_second_drop_off=${metricNumber(metrics, "first_3_second_drop_off", null)}`,
      recommendation_id: "tighten_first_three_seconds",
    });
  }
  if (visualScoreBelow(visualQualityReport, "first_3_seconds_hook_score")) {
    addDiagnosis(diagnoses, {
      dimension: "weak_hooks",
      id: "first_three_seconds_below_visual_floor",
      severity: "high",
      evidence: `first_3_seconds_hook_score=${visualQualityReport.scores?.first_3_seconds_hook_score}`,
      recommendation_id: "tighten_first_three_seconds",
    });
  }
  if (!title || isGenericTitle(title)) {
    addDiagnosis(diagnoses, {
      dimension: "title",
      id: "generic_or_missing_title",
      severity: "high",
      evidence: `title=${title || "missing"}`,
      recommendation_id: "named_entity_title_consequence_tension",
    });
  }
  const firstFrameWords = wordCount(openingText);
  if (!openingText || firstFrameWords > 5) {
    addDiagnosis(diagnoses, {
      dimension: "first_frame",
      id: "first_frame_text_unclear",
      severity: "high",
      evidence: `first_frame_words=${firstFrameWords}`,
      recommendation_id: "first_frame_text_under_5_words",
    });
  }
  if (hasCompleteMetrics && (intelligence?.visual_pacing?.score ?? 100) < 75) {
    addDiagnosis(diagnoses, {
      dimension: "pacing",
      id: "retention_drop_or_slow_pacing",
      severity: "high",
      evidence: `visual_pacing_score=${intelligence?.visual_pacing?.score ?? "n/a"}`,
      recommendation_id: "insert_pattern_interrupt_before_drop",
    });
  }
  if (hasCompleteMetrics && (metricNumber(metrics, "views", 0) || 0) < 500 && (metricNumber(metrics, "impressions", 0) || 0) >= 2000) {
    addDiagnosis(diagnoses, {
      dimension: "topic",
      id: "low_topic_pull_after_impressions",
      severity: "medium",
      evidence: `views=${metricNumber(metrics, "views", 0)} impressions=${metricNumber(metrics, "impressions", 0)}`,
      recommendation_id: "retest_topic_angle_before_scaling",
    });
  }
  if (visualScoreBelow(visualQualityReport, "motion_density_score")) {
    addDiagnosis(diagnoses, {
      dimension: "visual_density",
      id: "motion_density_below_floor",
      severity: "high",
      evidence: `motion_density_score=${visualQualityReport.scores?.motion_density_score}`,
      recommendation_id: "increase_opening_motion_density",
    });
  }
  if (anyCtaMissing(platformManifest)) {
    addDiagnosis(diagnoses, {
      dimension: "cta",
      id: "missing_or_generic_cta",
      severity: "medium",
      evidence: "one_or_more_platform_outputs_missing_cta_style",
      recommendation_id: "platform_native_cta_refresh",
    });
  }
  if (!cleanText(story.primary_source) || visualScoreBelow(visualQualityReport, "source_lock_quality_score")) {
    addDiagnosis(diagnoses, {
      dimension: "source_clarity",
      id: "source_clarity_below_floor",
      severity: "high",
      evidence: cleanText(story.primary_source) ? "source_lock_score_below_threshold" : "primary_source_missing",
      recommendation_id: "source_lock_before_claim",
    });
  }
  if (
    (hasCompleteMetrics && (metricNumber(metrics, "swipe_away", 0) || 0) > 55) ||
    cleanText(platformManifest.platform_native_evidence?.verdict).toLowerCase() === "fail" ||
    requiredPlatformCount(platformManifest) < 2
  ) {
    addDiagnosis(diagnoses, {
      dimension: "platform_mismatch",
      id: "platform_behaviour_mismatch",
      severity: "medium",
      evidence: `swipe_away=${metricNumber(metrics || {}, "swipe_away", "n/a")} platform_outputs=${requiredPlatformCount(platformManifest)}`,
      recommendation_id: "platform_specific_recut_plan",
    });
  }
  if (repeated.length || asArray(intelligence?.visual_pacing?.repeated_clip_windows).length) {
    addDiagnosis(diagnoses, {
      dimension: "repeated_structure",
      id: "repeated_clip_or_structure",
      severity: "high",
      evidence: `${Math.max(repeated.length, asArray(intelligence?.visual_pacing?.repeated_clip_windows).length)} repeated clip window(s)`,
      recommendation_id: "replace_repeated_clip_windows",
    });
  }
  return diagnoses;
}

function blockersFromDiagnostics(diagnoses = []) {
  return unique(
    asArray(diagnoses)
      .filter((item) => item.severity === "high")
      .map((item) => `retention:${item.dimension}`),
  );
}

function recommendationFromDiagnosis(diagnosis = {}) {
  const id = diagnosis.recommendation_id || `repair_${diagnosis.dimension}`;
  const actions = {
    tighten_first_three_seconds:
      "Rebuild the hook so the named subject, consequence and proof land inside the first three seconds.",
    named_entity_title_consequence_tension:
      "Replace generic titles with a named entity, consequence and tension.",
    first_frame_text_under_5_words:
      "Use a 3-5 word first frame with one recognisable subject and no paragraph text.",
    insert_pattern_interrupt_before_drop:
      "Place a pattern interrupt before the largest retention dip.",
    increase_opening_motion_density:
      "Raise motion density in the opening sequence without weakening rights controls.",
    platform_native_cta_refresh:
      "Refresh CTA wording per platform and keep it source-first, not bait-driven.",
    source_lock_before_claim:
      "Show readable source context before the main claim escalates.",
    platform_specific_recut_plan:
      "Plan a platform-specific recut instead of mirroring the same package.",
    replace_repeated_clip_windows:
      "Replace repeated clip windows with fresh source cards, authored cards or verified alternate motion.",
    retest_topic_angle_before_scaling:
      "Retest the topic angle before scaling the format.",
  };
  return {
    id,
    dimension: diagnosis.dimension,
    severity: diagnosis.severity,
    action: actions[id] || "Repair this retention dimension before using it as a future rule.",
    evidence: diagnosis.evidence,
  };
}

function buildLearningRules(stories = [], generatedAt = new Date().toISOString()) {
  const activeStories = stories.filter((story) => story.status !== "skipped");
  const metricsReadyStories = activeStories.filter((story) => story.metrics_status === "complete");
  const pendingStories = activeStories.filter((story) => ["pending", "shallow"].includes(story.metrics_status));
  const rulesById = new Map();
  for (const story of metricsReadyStories) {
    for (const recommendation of [
      ...asArray(story.retention_intelligence?.recommendations),
      ...asArray(story.retention_intelligence?.channel_pressure?.recommendations),
      ...asArray(story.diagnoses).map(recommendationFromDiagnosis),
    ]) {
      const id = cleanText(recommendation.id);
      if (!id) continue;
      if (!rulesById.has(id)) {
        rulesById.set(id, {
          id,
          status: "candidate",
          source: "retention_metrics",
          affected_story_count: 0,
          dimensions: [],
          action: cleanText(recommendation.action),
          evidence_examples: [],
          activation_boundary:
            "Future render recommendation only. Does not publish, mutate OAuth, mutate production DB rows or override upstream blockers.",
        });
      }
      const rule = rulesById.get(id);
      rule.affected_story_count += 1;
      if (recommendation.dimension) rule.dimensions = unique([...rule.dimensions, recommendation.dimension]);
      if (recommendation.evidence && rule.evidence_examples.length < 3) {
        rule.evidence_examples.push(cleanText(recommendation.evidence));
      }
    }
  }
  const missingCount = activeStories.filter((story) => story.metrics_status !== "complete").length;
  const status = !metricsReadyStories.length
    ? pendingStories.length && activeStories.every((story) => story.status === "ready")
      ? "pending_live_metrics_static_guidance_ready"
      : "blocked_pending_analytics"
    : activeStories.some((story) => story.status !== "ready")
      ? "candidate_rules_blocked_by_readiness"
      : "ready_for_future_renders";
  const rules = [...rulesById.values()];
  if (missingCount) {
    rules.unshift({
      id: "analytics_ingest_required_before_learning_rules_activate",
      status: pendingStories.length && activeStories.every((story) => story.status === "ready") ? "pending" : "blocked",
      source: "goal11_gate",
      affected_story_count: missingCount,
      dimensions: [...DIAGNOSIS_DIMENSIONS],
      action:
        "Ingest complete read-only platform metrics before activating retention learning rules.",
      evidence_examples: [`missing_or_incomplete_metrics_story_count=${missingCount}`],
      activation_boundary:
        "Planning only. The gate does not call platform APIs or mutate tokens.",
    });
  }
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    status,
    required_metrics: GOAL11_REQUIRED_METRICS,
    rules,
  };
}

function buildRetentionReport(stories = [], generatedAt = new Date().toISOString()) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    required_metrics: GOAL11_REQUIRED_METRICS,
    stories: stories.map((story) => ({
      story_id: story.story_id,
      status: story.status,
      direct_retention_status: story.direct_retention_status,
      publication_phase: story.publication_phase,
      publication_lifecycle: story.publication_lifecycle,
      performance_evidence_status: story.performance_evidence_status,
      performance_evidence: story.performance_evidence,
      metrics_status: story.metrics_status,
      required_metrics_present: story.metrics_status === "complete",
      missing_metrics: story.missing_metrics,
      metrics_summary: story.metrics_summary,
      retention_intelligence: story.retention_intelligence,
      diagnoses: story.diagnoses,
      blockers: story.blockers,
    })),
  };
}

function buildFutureRenderRecommendations(stories = [], generatedAt = new Date().toISOString()) {
  const activeStories = stories.filter((story) => story.status !== "skipped");
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    status: activeStories.some((story) => story.status !== "ready")
      ? "blocked_planning_only"
      : "ready_for_future_render_rules",
    stories: stories.map((story) => ({
      story_id: story.story_id,
      status: story.status === "skipped"
        ? "skipped"
        : story.status === "ready" ? "ready_for_next_render" : "blocked_pending_upstream_or_metrics",
      upstream_blockers: story.upstream_blockers,
      metrics_status: story.metrics_status,
      missing_metrics: story.missing_metrics,
      recommendations: uniqueRecommendations([
        ...asArray(story.retention_intelligence?.recommendations),
        ...asArray(story.retention_intelligence?.channel_pressure?.recommendations),
        ...asArray(story.diagnoses).map(recommendationFromDiagnosis),
      ]),
    })),
  };
}

function uniqueRecommendations(recommendations = []) {
  const seen = new Set();
  const out = [];
  for (const recommendation of recommendations) {
    const id = cleanText(recommendation.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      dimension: recommendation.dimension || null,
      severity: recommendation.severity || "medium",
      action: cleanText(recommendation.action),
      evidence: cleanText(recommendation.evidence),
    });
  }
  return out;
}

function buildExperimentResults(stories = [], generatedAt = new Date().toISOString()) {
  const activeStories = stories.filter((story) => story.status !== "skipped");
  const metricsReady = activeStories.filter((story) => story.metrics_status === "complete");
  const pendingStories = activeStories.filter((story) => ["pending", "shallow"].includes(story.metrics_status));
  const experiments = metricsReady.flatMap((story) =>
    asArray(story.diagnoses).map((diagnosis) => ({
      story_id: story.story_id,
      experiment_id: `${story.story_id}_${diagnosis.dimension}`,
      status: "planned_only",
      controlled_variable: diagnosis.dimension,
      upstream_blocked: story.upstream_blockers.length > 0,
      metric_basis: {
        views: story.metrics_summary.views,
        impressions: story.metrics_summary.impressions,
        average_view_duration_seconds: story.metrics_summary.average_view_duration_seconds,
        stayed_to_watch: story.metrics_summary.stayed_to_watch,
        swipe_away: story.metrics_summary.swipe_away,
      },
      blocker_note:
        story.status === "ready"
          ? "Ready for Goal 12 controlled variant planning."
          : "Do not run this experiment until upstream blockers and Goal 11 blockers are cleared.",
    })),
  );
  const status = !metricsReady.length
    ? pendingStories.length && activeStories.every((story) => story.status === "ready")
      ? "waiting_for_live_metrics"
      : "not_started"
    : activeStories.some((story) => story.direct_retention_status === "blocked")
      ? "planned_only"
      : "ready_for_experiment_engine";
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    status,
    experiments,
    safety:
      "Planner only. No uncontrolled random variation, external posting, live publishing, OAuth mutation or production DB mutation.",
  };
}

function platformKey(story = {}) {
  return cleanText(story.metrics_summary?.platform || story.retention_intelligence?.traffic?.dominant_source || "unknown").toLowerCase() || "unknown";
}

function averageNumber(values = []) {
  const finite = values.map(Number).filter(Number.isFinite);
  if (!finite.length) return null;
  return round(finite.reduce((sum, value) => sum + value, 0) / finite.length, 4);
}

function completeMetricStories(stories = []) {
  return asArray(stories).filter((story) => story.status !== "skipped" && story.metrics_status === "complete");
}

function observedMetricStories(stories = []) {
  return asArray(stories).filter((story) => story.status !== "skipped" && ["complete", "shallow"].includes(story.metrics_status));
}

function buildDailyRetentionReport(stories = [], generatedAt = new Date().toISOString()) {
  const metricStories = observedMetricStories(stories);
  const completeStories = completeMetricStories(stories);
  const byPlatform = new Map();
  for (const story of metricStories) {
    const platform = platformKey(story);
    if (!byPlatform.has(platform)) byPlatform.set(platform, []);
    byPlatform.get(platform).push(story);
  }
  const platforms = [...byPlatform.entries()].map(([platform, rows]) => ({
    platform,
    story_count: rows.length,
    total_views: rows.reduce((sum, story) => sum + numberOr(story.metrics_summary?.views, 0), 0),
    average_watch_seconds: averageNumber(rows.map((story) => story.metrics_summary?.average_view_duration_seconds)),
    average_stayed_to_watch: averageNumber(rows.map((story) => story.metrics_summary?.stayed_to_watch)),
    average_swipe_away: averageNumber(rows.map((story) => story.metrics_summary?.swipe_away)),
    average_engagement_rate: averageNumber(rows.map((story) => story.metrics_summary?.engagement_rate)),
    follows: rows.reduce((sum, story) => sum + numberOr(story.metrics_summary?.follows, 0), 0),
  }));
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    summary: {
      story_count: stories.length,
      metrics_ready_story_count: completeStories.length,
      analytics_observed_story_count: metricStories.length,
      retention_ready_story_count: stories.filter((story) => story.status === "ready").length,
      blocked_story_count: stories.filter((story) => story.status === "blocked").length,
      platform_count: platforms.length,
    },
    platforms,
    stories: metricStories.map((story) => ({
      story_id: story.story_id,
      title: story.title,
      platform: platformKey(story),
      status: story.status,
      metrics_summary: story.metrics_summary,
      hook_score: story.retention_intelligence?.hook?.score ?? null,
      visual_pacing_score: story.retention_intelligence?.visual_pacing?.score ?? null,
      diagnoses: story.diagnoses,
    })),
    safety: {
      local_metrics_manifest_only: true,
      no_analytics_api_call: true,
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function titlePattern(title = "") {
  const text = cleanText(title).toLowerCase();
  if (!text || isGenericTitle(text)) return "generic_or_missing_title";
  if (/\b(just|finally|broke|changed|confirms?|reveals?|shows?|launch|date|price|deal)\b/.test(text)) return "named_entity_consequence";
  if (/\b\d{2,}(?:[,.]\d+)*\b|%|\b\d+\s*k\b/.test(text)) return "number_led";
  if (/\?$/.test(text) || /\bwhy|how\b/.test(text)) return "question_or_explainer";
  return "named_entity_standard";
}

function hookPattern(story = {}) {
  const text = cleanText(`${story.title || ""} ${story.retention_intelligence?.hook?.status || ""}`).toLowerCase();
  if (/\b\d[\d,.]*|%|k|steam|views|players|date|score\b/.test(text)) return "named_subject_source_or_number";
  if (/\bwhy|how|because\b/.test(text)) return "explain_the_consequence";
  if (/\bjust|finally|broke|changed|revealed|confirmed|shows\b/.test(text)) return "new_information_hook";
  return "standard_subject_hook";
}

function isWinner(story = {}) {
  const metrics = story.metrics_summary || {};
  return (
    numberOr(metrics.views, 0) >= 1000 ||
    numberOr(metrics.stayed_to_watch, 0) >= 50 ||
    numberOr(metrics.engagement_rate, 0) >= 0.035 ||
    numberOr(metrics.follows, 0) > 0
  );
}

function buildPatternWinners(stories = [], generatedAt = new Date().toISOString(), { type = "title" } = {}) {
  const metricStories = completeMetricStories(stories);
  const byPattern = new Map();
  const winners = metricStories.filter(isWinner);
  const candidateStories = winners.length
    ? winners
    : metricStories
        .filter((story) => numberOr(story.metrics_summary?.views, 0) > 0)
        .sort((a, b) => numberOr(b.metrics_summary?.views, 0) - numberOr(a.metrics_summary?.views, 0))
        .slice(0, 5);
  for (const story of candidateStories) {
    const pattern = type === "hook" ? hookPattern(story) : titlePattern(story.title);
    if (!byPattern.has(pattern)) {
      byPattern.set(pattern, {
        pattern,
        story_count: 0,
        total_views: 0,
        average_stayed_to_watch: [],
        average_engagement_rate: [],
        examples: [],
      });
    }
    const row = byPattern.get(pattern);
    row.story_count += 1;
    row.total_views += numberOr(story.metrics_summary?.views, 0);
    row.average_stayed_to_watch.push(story.metrics_summary?.stayed_to_watch);
    row.average_engagement_rate.push(story.metrics_summary?.engagement_rate);
    if (row.examples.length < 5) {
      row.examples.push({
        story_id: story.story_id,
        title: story.title,
        views: story.metrics_summary?.views ?? null,
        stayed_to_watch: story.metrics_summary?.stayed_to_watch ?? null,
        engagement_rate: story.metrics_summary?.engagement_rate ?? null,
      });
    }
  }
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    pattern_type: type,
    patterns: [...byPattern.values()]
      .map((row) => ({
        ...row,
        average_stayed_to_watch: averageNumber(row.average_stayed_to_watch),
        average_engagement_rate: averageNumber(row.average_engagement_rate),
      }))
      .sort((a, b) => b.total_views - a.total_views || b.story_count - a.story_count),
    safety: {
      patterns_only: true,
      no_competitor_assets_copied: true,
      no_publish_triggered: true,
      no_db_mutation: true,
    },
  };
}

function buildFormatKillList(stories = [], generatedAt = new Date().toISOString()) {
  const formats = new Map();
  for (const story of asArray(stories)) {
    for (const diagnosis of asArray(story.diagnoses)) {
      if (diagnosis.severity !== "high") continue;
      const id = cleanText(diagnosis.id || diagnosis.dimension);
      if (!id) continue;
      if (!formats.has(id)) {
        formats.set(id, {
          id,
          dimension: diagnosis.dimension,
          severity: "high",
          story_count: 0,
          evidence_examples: [],
          replacement_rule: recommendationFromDiagnosis(diagnosis).action,
        });
      }
      const format = formats.get(id);
      format.story_count += 1;
      if (diagnosis.evidence && format.evidence_examples.length < 5) format.evidence_examples.push(diagnosis.evidence);
    }
  }
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    status: formats.size ? "active" : "empty",
    formats: [...formats.values()].sort((a, b) => b.story_count - a.story_count || a.id.localeCompare(b.id)),
    safety: {
      planning_only: true,
      no_publish_triggered: true,
      no_db_mutation: true,
      no_gate_weakened: true,
    },
  };
}

function renderNextUploadRecommendationsMarkdown(report = {}) {
  const lines = [];
  lines.push("# Next Upload Recommendations");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Status: ${report.future_render_recommendations?.status || "unknown"}`);
  lines.push("");
  for (const story of asArray(report.future_render_recommendations?.stories)) {
    if (story.status === "skipped") continue;
    lines.push(`## ${story.story_id}`);
    lines.push(`- Status: ${story.status}`);
    if (!asArray(story.recommendations).length) lines.push("- Recommendation: preserve current benchmark profile.");
    for (const recommendation of asArray(story.recommendations).slice(0, 5)) {
      lines.push(`- ${recommendation.id}: ${recommendation.action}`);
    }
    lines.push("");
  }
  lines.push("## Safety");
  lines.push("- Planning only.");
  lines.push("- No publish, upload, DB mutation, OAuth or token action was triggered.");
  return `${lines.join("\n")}\n`;
}

function blockerCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function metricsSummary(metrics = {}, durationS = 60) {
  const retentionCurve = retentionRowsFromMetrics(metrics);
  return {
    video_id: cleanText(metrics.video_id || metrics.videoId),
    platform: cleanText(metrics.platform || metrics.platform_id),
    views: metricNumber(metrics, "views", null),
    impressions: metricNumber(metrics, "impressions", null),
    average_view_duration_seconds: metricNumber(metrics, "average_view_duration_seconds", null),
    retention_curve_points: retentionCurve.length,
    first_3_second_drop_off: metricNumber(metrics, "first_3_second_drop_off", null),
    stayed_to_watch: metricNumber(metrics, "stayed_to_watch", null),
    swipe_away: metricNumber(metrics, "swipe_away", null),
    replays: metricNumber(metrics, "replays", null),
    likes: metricNumber(metrics, "likes", null),
    comments: metricNumber(metrics, "comments", null),
    shares: metricNumber(metrics, "shares", null),
    saves: metricNumber(metrics, "saves", null),
    follows: metricNumber(metrics, "follows", null),
    clicks: metricNumber(metrics, "clicks", null),
    landing_visits: metricNumber(metrics, "landing_visits", null),
    revenue: metricNumber(metrics, "revenue", null),
    engagement_rate: engagementRate(metrics),
    average_percentage_viewed:
      metricNumber(metrics, "average_view_duration_seconds", null) !== null && durationS > 0
        ? round(metricNumber(metrics, "average_view_duration_seconds", 0) / durationS, 4)
        : null,
  };
}

async function inspectStoryPackage(storyPackage = {}, context = {}) {
  const storyId = storyIdFromPackage(storyPackage);
  const artifactDir = resolveWorkspacePath(context.workspaceRoot, storyPackage.artifact_dir);
  const skipped = upstreamSkippedInfo(storyId, context.upstreamBenchmarkIndex);
  if (skipped) {
    return {
      story_id: storyId,
      title: cleanText(storyPackage.title),
      artifact_dir: artifactDir,
      status: "skipped",
      direct_retention_status: "skipped",
      publication_phase: "not_evaluated",
      publication_lifecycle: { phase: "not_evaluated" },
      performance_evidence_status: "not_evaluated",
      metrics_status: "skipped",
      skipped_status: skipped.status,
      skipped_reason: skipped.reason,
      missing_metrics: [],
      metrics_summary: {},
      blockers: [],
      direct_retention_blockers: [],
      upstream_blockers: [],
      diagnoses: [],
      retention_intelligence: {
        verdict: "skipped",
        recommendations: [],
        channel_pressure: { recommendations: [] },
      },
      static_diagnosis_available: false,
      safety: {
        no_api_ingest_triggered: true,
        local_metrics_manifest_only: true,
        no_publish_triggered: true,
        no_platform_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
        no_secret_values_exposed: true,
      },
    };
  }
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const director = await readJsonIfPresent(path.join(artifactDir, "director_beat_map.json"), {});
  const renderManifest = await readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {});
  const platformManifest = await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {});
  const visualQualityReport = await readJsonIfPresent(path.join(artifactDir, "visual_quality_report.json"), {});
  const upstream = upstreamBlockers(storyId, context.upstreamBenchmarkIndex);
  const metrics = context.metricsIndex.get(storyId) || null;
  const publicationLifecycle = derivePublicationLifecycle({
    storyPackage,
    canonical,
    renderManifest,
    platformManifest,
    metrics,
  });
  const missing = missingMetrics(metrics);
  const shallowMetrics = metrics !== null && isShallowMetrics(metrics);
  const hasCompleteMetrics = metrics !== null && !shallowMetrics && missing.length === 0;
  const metricProvenance = assessMetricProvenance({
    storyId,
    storyPackage,
    canonical,
    platformManifest,
    metrics,
    generatedAt: context.generatedAt,
  });
  const metricsLinked = metricProvenance.story_linked && metricProvenance.public_post_linked;
  const metricsFresh = metricProvenance.temporally_valid;
  const retentionProofReady =
    publicationLifecycle.phase === "published" && hasCompleteMetrics && metricsLinked && metricsFresh;
  const analyticsPending =
    publicationLifecycle.phase === "prepublication" && (!metrics || shallowMetrics);
  const story = storyObject({ storyId, storyPackage, canonical, director });
  const durationS = Math.max(
    1,
    numberOr(renderManifest.rendered_duration_s ?? renderManifest.durationS ?? renderManifest.duration_s, 60),
  );
  const intelligence = retentionProofReady
    ? buildRetentionIntelligence({
        story,
        videoId: cleanText(metrics.video_id || metrics.videoId),
        durationS,
        retentionRows: retentionRowsFromMetrics(metrics),
        trafficRows: trafficRowsFromMetrics(metrics, durationS),
        sceneTimeline: sceneTimelineFromDirector(director),
        channelBaseline: metrics.channel_baseline || metrics.channelBaseline || {},
        generatedAt: context.generatedAt,
      })
    : analyticsPending
      ? {
          verdict: "analytics_pending",
          recommendations: [
            {
              id: "preserve_current_benchmark_profile_until_live_metrics_arrive",
              dimension: "platform_mismatch",
              severity: "low",
              action:
                "Keep the current benchmark-approved hook, pacing and platform treatment until live retention metrics are ingested.",
              evidence: "upstream_benchmark_ready_but_live_metrics_not_available_yet",
            },
          ],
          channel_pressure: { recommendations: [] },
        }
      : null;
  const diagnoses = buildDiagnoses({
    story,
    metrics,
    hasCompleteMetrics: retentionProofReady,
    intelligence,
    director,
    platformManifest,
    visualQualityReport,
  });
  const directBlockers = unique([
    ...(publicationLifecycle.phase === "conflicted"
      ? ["retention:publication_lifecycle_conflict"]
      : []),
    ...(publicationLifecycle.phase === "unknown"
      ? ["retention:publication_lifecycle_unknown"]
      : []),
    ...(publicationLifecycle.phase === "published" && !metrics
      ? ["retention:published_metrics_missing"]
      : []),
    ...(publicationLifecycle.phase === "published" && metrics && (shallowMetrics || missing.length > 0)
      ? ["retention:published_metrics_incomplete"]
      : []),
    ...(publicationLifecycle.phase === "published" && hasCompleteMetrics && !metricsLinked
      ? ["retention:published_metrics_unlinked"]
      : []),
    ...(publicationLifecycle.phase === "published" && hasCompleteMetrics && metricsLinked && !metricsFresh
      ? ["retention:published_metrics_stale"]
      : []),
    ...(analyticsPending ? [] : metrics ? [] : ["retention:analytics_missing"]),
    ...(analyticsPending || shallowMetrics ? [] : missing.map((field) => `retention:${field}_missing`)),
    ...blockersFromDiagnostics(diagnoses),
    ...(intelligence?.verdict === "needs_retention_data" ? ["retention:analytics_missing"] : []),
    ...(intelligence?.verdict === "needs_render_adjustment" && !blockersFromDiagnostics(diagnoses).length
      ? ["retention:render_adjustment_required"]
      : []),
  ]);
  const directStatus = directBlockers.length ? "blocked" : "pass";
  const blockers = unique([...upstream, ...directBlockers]);
  const performanceEvidenceStatus = analyticsPending
    ? "pending_not_yet_observable"
    : publicationLifecycle.phase === "conflicted"
      ? "blocked_lifecycle_conflict"
    : publicationLifecycle.phase === "unknown"
      ? "blocked_lifecycle_unknown"
    : publicationLifecycle.phase === "published" && !metrics
      ? "missing_after_publication"
    : publicationLifecycle.phase === "published" && (shallowMetrics || missing.length > 0)
      ? "incomplete_after_publication"
    : publicationLifecycle.phase === "published" && hasCompleteMetrics && !metricsLinked
      ? "unlinked_after_publication"
    : publicationLifecycle.phase === "published" && hasCompleteMetrics && !metricsFresh
      ? "stale_after_publication"
    : retentionProofReady
      ? "observed_complete"
      : metrics
        ? "observed_incomplete"
        : "missing";
  return {
    story_id: storyId,
    title: story.title,
    artifact_dir: artifactDir,
    status: blockers.length ? "blocked" : "ready",
    direct_retention_status: directStatus,
    publication_phase: publicationLifecycle.phase,
    publication_lifecycle: publicationLifecycle,
    performance_evidence_status: performanceEvidenceStatus,
    metrics_status: retentionProofReady
      ? "complete"
      : hasCompleteMetrics
        ? "invalid"
        : shallowMetrics
          ? "shallow"
          : metrics
            ? "incomplete"
            : analyticsPending
              ? "pending"
              : "missing",
    missing_metrics: missing,
    metrics_summary: metrics ? metricsSummary(metrics, durationS) : {},
    performance_evidence: metricProvenance,
    blockers,
    direct_retention_blockers: directBlockers,
    upstream_blockers: upstream,
    diagnoses,
    retention_intelligence: intelligence,
    static_diagnosis_available: true,
    safety: {
      no_api_ingest_triggered: true,
      local_metrics_manifest_only: true,
      no_publish_triggered: true,
      no_platform_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
  };
}

async function buildGoal11RetentionIntelligenceLoop({
  storyPackages = [],
  upstreamBenchmarkReport = {},
  metricsManifest = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal11RetentionIntelligenceLoop requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const upstreamBenchmarkIndex = buildUpstreamBenchmarkIndex(upstreamBenchmarkReport);
  const metricsIndex = buildMetricsIndex(metricsManifest);
  const stories = [];
  for (const storyPackage of asArray(storyPackages)) {
    stories.push(
      await inspectStoryPackage(storyPackage, {
        workspaceRoot,
        upstreamBenchmarkIndex,
        metricsIndex,
        generatedAt,
      }),
    );
  }
  const activeStories = stories.filter((story) => story.status !== "skipped");
  const skippedStories = stories.filter((story) => story.status === "skipped");
  const readyStories = activeStories.filter((story) => story.status === "ready");
  const blockedStories = activeStories.filter((story) => story.status === "blocked");
  const metricsReadyStories = activeStories.filter((story) => story.metrics_status === "complete");
  const missingAnalyticsStories = activeStories.filter((story) => story.metrics_status === "missing");
  const pendingAnalyticsStories = activeStories.filter((story) => story.metrics_status === "pending");
  const shallowAnalyticsStories = activeStories.filter((story) => story.metrics_status === "shallow");
  const upstreamBlockedStories = activeStories.filter((story) => story.upstream_blockers.length > 0);
  const verdict = !activeStories.length
    ? "FAIL"
    : blockedStories.length && readyStories.length
      ? "PARTIAL"
      : blockedStories.length
        ? "BLOCKED"
        : "PASS";
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    summary: {
      story_count: stories.length,
      active_story_count: activeStories.length,
      skipped_story_count: skippedStories.length,
      retention_ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      direct_retention_pass_story_count: activeStories.filter((story) => story.direct_retention_status === "pass").length,
      direct_retention_blocked_story_count: activeStories.filter((story) => story.direct_retention_status === "blocked").length,
      metrics_ready_story_count: metricsReadyStories.length,
      analytics_observed_story_count: metricsReadyStories.length + shallowAnalyticsStories.length,
      analytics_shallow_story_count: shallowAnalyticsStories.length,
      analytics_missing_story_count: missingAnalyticsStories.length,
      analytics_pending_story_count: pendingAnalyticsStories.length,
      analytics_incomplete_story_count: stories.filter((story) => story.metrics_status === "incomplete").length,
      analytics_invalid_story_count: stories.filter((story) => story.metrics_status === "invalid").length,
      upstream_blocked_story_count: upstreamBlockedStories.length,
      static_diagnosis_story_count: activeStories.filter((story) => story.static_diagnosis_available).length,
      diagnosis_dimension_count: DIAGNOSIS_DIMENSIONS.length,
    },
    required_metrics: GOAL11_REQUIRED_METRICS,
    diagnosis_dimensions: DIAGNOSIS_DIMENSIONS,
    blocker_counts: blockerCounts(activeStories),
    upstream_blockers: {
      goal10_gold_standard_forensics_engine:
        "Goal 11 records retention diagnostics and local-proof learning plans, but full readiness requires Goal 10 benchmark readiness first.",
      note:
        "This gate reads local package evidence and optional local analytics manifests. It does not call analytics APIs, publish, post, mutate production DB rows or touch OAuth/token settings.",
    },
    stories,
    safety: {
      read_only_audit: true,
      local_metrics_manifest_only: true,
      no_analytics_api_call: true,
      no_publish_triggered: true,
      no_platform_uploads: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
      no_gate_weakened: true,
    },
  };
  report.retention_report = buildRetentionReport(stories, generatedAt);
  report.learning_rules = buildLearningRules(stories, generatedAt);
  report.future_render_recommendations = buildFutureRenderRecommendations(stories, generatedAt);
  report.experiment_results = buildExperimentResults(stories, generatedAt);
  report.daily_retention_report = buildDailyRetentionReport(stories, generatedAt);
  report.title_pattern_winners = buildPatternWinners(stories, generatedAt, { type: "title" });
  report.hook_pattern_winners = buildPatternWinners(stories, generatedAt, { type: "hook" });
  report.format_kill_list = buildFormatKillList(stories, generatedAt);
  return report;
}

function renderGoal11RetentionIntelligenceLoopMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 11 Retention Intelligence Loop");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`Retention-ready stories: ${report.summary?.retention_ready_story_count || 0}`);
  lines.push(`Direct retention pass stories: ${report.summary?.direct_retention_pass_story_count || 0}`);
  lines.push(`Metrics-ready stories: ${report.summary?.metrics_ready_story_count || 0}`);
  lines.push(`Analytics-missing stories: ${report.summary?.analytics_missing_story_count || 0}`);
  lines.push(`Upstream-blocked stories: ${report.summary?.upstream_blocked_story_count || 0}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("## Learning status");
  lines.push(`- Rules: ${report.learning_rules?.status || "unknown"}`);
  lines.push(`- Experiments: ${report.experiment_results?.status || "unknown"}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF only. This run did not call analytics APIs, publish, upload, post externally, mutate the database, touch OAuth or expose token values.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal11RetentionIntelligenceLoop(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal11RetentionIntelligenceLoop requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal11_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal11_readiness_report.md");
  const retentionReport = path.join(outDir, "retention_report.json");
  const learningRules = path.join(outDir, "learning_rules.json");
  const futureRenderRecommendations = path.join(outDir, "future_render_recommendations.json");
  const experimentResults = path.join(outDir, "experiment_results.json");
  const dailyRetentionReport = path.join(outDir, "daily_retention_report.json");
  const nextUploadRecommendations = path.join(outDir, "next_upload_recommendations.md");
  const titlePatternWinners = path.join(outDir, "title_pattern_winners.json");
  const hookPatternWinners = path.join(outDir, "hook_pattern_winners.json");
  const formatKillList = path.join(outDir, "format_kill_list.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal11RetentionIntelligenceLoopMarkdown(report), "utf8");
  await fs.writeJson(retentionReport, report.retention_report || buildRetentionReport(report.stories || [], report.generated_at), { spaces: 2 });
  await fs.writeJson(learningRules, report.learning_rules || buildLearningRules(report.stories || [], report.generated_at), { spaces: 2 });
  await fs.writeJson(
    futureRenderRecommendations,
    report.future_render_recommendations || buildFutureRenderRecommendations(report.stories || [], report.generated_at),
    { spaces: 2 },
  );
  await fs.writeJson(experimentResults, report.experiment_results || buildExperimentResults(report.stories || [], report.generated_at), { spaces: 2 });
  await fs.writeJson(dailyRetentionReport, report.daily_retention_report || buildDailyRetentionReport(report.stories || [], report.generated_at), { spaces: 2 });
  await fs.writeFile(nextUploadRecommendations, renderNextUploadRecommendationsMarkdown(report), "utf8");
  await fs.writeJson(titlePatternWinners, report.title_pattern_winners || buildPatternWinners(report.stories || [], report.generated_at, { type: "title" }), { spaces: 2 });
  await fs.writeJson(hookPatternWinners, report.hook_pattern_winners || buildPatternWinners(report.stories || [], report.generated_at, { type: "hook" }), { spaces: 2 });
  await fs.writeJson(formatKillList, report.format_kill_list || buildFormatKillList(report.stories || [], report.generated_at), { spaces: 2 });
  return {
    readinessJson,
    readinessMarkdown,
    retentionReport,
    learningRules,
    futureRenderRecommendations,
    experimentResults,
    dailyRetentionReport,
    nextUploadRecommendations,
    titlePatternWinners,
    hookPatternWinners,
    formatKillList,
  };
}

module.exports = {
  DIAGNOSIS_DIMENSIONS,
  GOAL11_REQUIRED_METRICS,
  buildExperimentResults,
  buildDailyRetentionReport,
  buildFormatKillList,
  buildFutureRenderRecommendations,
  buildGoal11RetentionIntelligenceLoop,
  buildLearningRules,
  buildPatternWinners,
  buildRetentionReport,
  inspectStoryPackage,
  renderGoal11RetentionIntelligenceLoopMarkdown,
  writeGoal11RetentionIntelligenceLoop,
};

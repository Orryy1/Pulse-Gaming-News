"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const {
  hasPublicPlatformEvidence,
  isRealPlatformPostId,
} = require("./services/platform-evidence-status");

const GOAL_ID = "12_experimentation_engine";

const EXPERIMENT_AXES = [
  "hook",
  "title",
  "thumbnail",
  "cta",
  "duration",
  "platform_outputs",
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

function normalisePublicationPhase(value) {
  const phase = cleanText(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (!phase) return null;
  if (["draft", "prepublication", "pre_publication", "pre_publish", "publish_planning"].includes(phase)) {
    return "prepublication";
  }
  if (["published", "public", "live", "postpublication", "post_publication", "post_publish"].includes(phase)) {
    return "published";
  }
  if (phase === "conflicted") return "conflicted";
  if (phase === "unknown") return "unknown";
  return "unknown";
}

function declaredPublicationPhase(row = {}) {
  const lifecycle = row.publication_lifecycle;
  const raw =
    row.publication_phase ||
    row.lifecycle_phase ||
    row.publish_lifecycle_phase ||
    (lifecycle && typeof lifecycle === "object" ? lifecycle.phase : lifecycle);
  return {
    raw: cleanText(raw) || null,
    phase: normalisePublicationPhase(raw),
  };
}

function derivePublicationLifecycle({
  storyPackage = {},
  canonical = {},
  renderManifest = {},
  platformManifest = {},
  upstreamRetention = {},
} = {}) {
  const evidence = {
    ...canonical,
    ...platformManifest,
    ...storyPackage,
  };
  const publicEvidence =
    hasPublicPlatformEvidence(evidence) ||
    [
      evidence.youtube_post_id,
      evidence.tiktok_post_id,
      evidence.instagram_media_id,
      evidence.facebook_post_id,
    ].some(isRealPlatformPostId);
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

  const upstream = declaredPublicationPhase(upstreamRetention);
  if (
    ["prepublication", "published"].includes(upstream.phase) &&
    ["prepublication", "published"].includes(phase) &&
    upstream.phase !== phase
  ) {
    phase = "conflicted";
    conflictReason = "goal11_and_goal12_publication_phase_conflict";
  } else if (["conflicted", "unknown"].includes(upstream.phase)) {
    phase = upstream.phase;
    conflictReason = upstream.phase === "conflicted"
      ? "goal11_publication_phase_conflicted"
      : "goal11_publication_phase_unknown";
  }

  return {
    phase,
    declared_phase: declared.phase,
    declared_phase_raw: declared.raw,
    upstream_phase: upstream.phase,
    conflict_reason: conflictReason,
    public_platform_evidence: publicEvidence,
    verified_prepublication_evidence: verifiedPrepublication,
    operating_mode: operatingMode || null,
  };
}

function rowsFromManifest(manifest = {}) {
  if (Array.isArray(manifest)) return manifest;
  return asArray(manifest.stories || manifest.rows || manifest.metrics || manifest.variants);
}

function buildRetentionIndex(upstreamRetentionReport = {}) {
  const index = new Map();
  for (const row of asArray(upstreamRetentionReport.stories)) {
    const id = cleanText(row.story_id || row.id);
    if (id) index.set(id, row);
  }
  return index;
}

function upstreamSkippedInfo(storyId, retentionIndex = new Map()) {
  const row = retentionIndex.get(cleanText(storyId));
  if (cleanText(row?.status) !== "skipped") return null;
  return {
    status: cleanText(row.skipped_status || row.status) || "skipped",
    reason: cleanText(row.skipped_reason || row.reason) || "upstream_retention_skipped",
  };
}

function buildRecommendationIndex(futureRenderRecommendations = {}) {
  const index = new Map();
  for (const row of asArray(futureRenderRecommendations.stories)) {
    const id = cleanText(row.story_id || row.id);
    if (id) index.set(id, row);
  }
  return index;
}

function buildVariantMetricsIndex(variantMetricsManifest = {}) {
  const index = new Map();
  for (const row of rowsFromManifest(variantMetricsManifest)) {
    const storyId = cleanText(row.story_id || row.storyId || row.id);
    const variantId = cleanText(row.variant_id || row.variantId);
    if (!storyId || !variantId) continue;
    if (!index.has(storyId)) index.set(storyId, new Map());
    index.get(storyId).set(variantId, row);
  }
  return index;
}

function upstreamBlockers(storyId, retentionIndex = new Map()) {
  const row = retentionIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal11_retention_intelligence_missing"];
  if (cleanText(row.status) === "ready") return [];
  return unique([
    "upstream:goal11_retention_intelligence_blocked",
    ...asArray(row.blockers),
  ]);
}

function upstreamPerformanceBlockers(upstreamRetention = {}, publicationLifecycle = {}) {
  if (publicationLifecycle.phase !== "published") return [];
  const upstreamPhase = declaredPublicationPhase(upstreamRetention).phase;
  const blockers = [];
  if (upstreamPhase !== "published") {
    blockers.push("upstream:goal11_publication_lifecycle_not_published");
  }
  if (
    cleanText(upstreamRetention.performance_evidence_status) !== "observed_complete" ||
    cleanText(upstreamRetention.metrics_status) !== "complete"
  ) {
    blockers.push("upstream:goal11_performance_evidence_not_ready");
  }
  return blockers;
}

function firstSentence(value = "") {
  const text = cleanText(value);
  if (!text) return "";
  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return cleanText(match ? match[1] : text);
}

function wordLimit(value = "", maxWords = 8) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

function safeTitle(value = "") {
  const title = cleanText(value)
    .replace(/[\u2013\u2014]/g, ",")
    .replace(/[!?]{2,}/g, "")
    .replace(/\b(?:shocking|insane|crazy|you won'?t believe|mind[- ]?blowing|explained)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return "Pulse Gaming Follow-Up";
  return title.length > 78 ? `${title.slice(0, 75).trim()}...` : title;
}

function platformOutputs(platformManifest = {}) {
  return platformManifest.outputs || platformManifest.platform_outputs || {};
}

function normalisePlatform(value) {
  const platform = cleanText(value).toLowerCase();
  if (platform.includes("youtube")) return "youtube";
  if (platform.includes("tiktok")) return "tiktok";
  if (platform.includes("instagram")) return "instagram";
  if (platform.includes("facebook")) return "facebook";
  return platform;
}

function publicPostDescriptor(value) {
  if (typeof value === "string" || typeof value === "number") {
    return {
      public_post_id: cleanText(value),
      platform: null,
    };
  }
  if (!value || typeof value !== "object") return null;
  return {
    public_post_id: cleanText(
      value.public_post_id ||
        value.platform_post_id ||
        value.post_id ||
        value.external_id ||
        value.video_id,
    ),
    platform: normalisePlatform(value.platform || value.platform_id) || null,
  };
}

function variantPublicPostIndex({ storyId, storyPackage = {}, platformManifest = {} } = {}) {
  const index = new Map();
  const sources = [
    platformManifest.variant_public_post_ids,
    platformManifest.experiment_variant_post_ids,
    platformManifest.variant_public_posts,
    storyPackage.variant_public_post_ids,
    storyPackage.experiment_variant_post_ids,
    storyPackage.variant_public_posts,
  ];
  for (const source of sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    for (const [variantId, value] of Object.entries(source)) {
      const descriptor = publicPostDescriptor(value);
      if (cleanText(variantId) && descriptor) index.set(cleanText(variantId), descriptor);
    }
  }
  const controlId = `${storyId}_control`;
  if (!index.has(controlId)) {
    const controlFields = [
      ["youtube", storyPackage.youtube_post_id || platformManifest.youtube_post_id],
      ["tiktok", storyPackage.tiktok_post_id || platformManifest.tiktok_post_id],
      ["instagram", storyPackage.instagram_media_id || platformManifest.instagram_media_id],
      ["facebook", storyPackage.facebook_post_id || platformManifest.facebook_post_id],
    ];
    const control = controlFields.find(([, postId]) => isRealPlatformPostId(postId));
    if (control) {
      index.set(controlId, {
        platform: control[0],
        public_post_id: cleanText(control[1]),
      });
    }
  }
  return index;
}

function metricPublicPostId(row = {}) {
  return cleanText(
    row.public_post_id ||
      row.platform_post_id ||
      row.external_id ||
      row.video_id ||
      row.videoId,
  );
}

function metricRowProvenanceReady({ row = {}, storyId, variantId, expectedPost = null } = {}) {
  const actualPostId = metricPublicPostId(row);
  const actualPlatform = normalisePlatform(row.platform || row.platform_id);
  const expectedPlatform = normalisePlatform(expectedPost?.platform);
  return Boolean(
    cleanText(row.story_id || row.storyId) === cleanText(storyId) &&
      cleanText(row.variant_id || row.variantId) === cleanText(variantId) &&
      expectedPost &&
      isRealPlatformPostId(expectedPost.public_post_id) &&
      isRealPlatformPostId(actualPostId) &&
      actualPostId === cleanText(expectedPost.public_post_id) &&
      (!expectedPlatform || !actualPlatform || expectedPlatform === actualPlatform),
  );
}

function baseExperimentState({ storyId, storyPackage = {}, canonical = {}, renderManifest = {}, platformManifest = {} }) {
  const title = safeTitle(canonical.selected_title || canonical.title || storyPackage.title);
  const subject = cleanText(canonical.canonical_subject || canonical.subject || title);
  const hook = firstSentence(canonical.first_spoken_line || canonical.hook || canonical.narration_script) ||
    `${subject} has a new detail players can judge.`;
  const thumbnail = cleanText(canonical.suggested_thumbnail_text || canonical.thumbnail_text || wordLimit(subject, 4).toUpperCase());
  const outputs = platformOutputs(platformManifest);
  const firstOutput = Object.values(outputs)[0] || {};
  const duration = numberOr(renderManifest.rendered_duration_s || renderManifest.durationS || renderManifest.duration_s, 40);
  return {
    story_id: storyId,
    hook,
    title,
    thumbnail,
    cta: cleanText(firstOutput.cta_style || firstOutput.cta || "identity_follow"),
    duration,
    platform_outputs: Object.keys(outputs).length ? outputs : {
      youtube_shorts: { cta_style: "identity_follow" },
    },
    subject,
  };
}

function recommendationIds(row = {}) {
  return asArray(row.recommendations).map((item) => cleanText(item.id));
}

function buildVariantValue(axis, base = {}, recommendations = {}) {
  const recIds = recommendationIds(recommendations);
  if (axis === "hook") {
    const action = recIds.includes("tighten_first_three_seconds")
      ? "Lead with proof, source and consequence before the claim expands."
      : "Lead with the named subject and the clearest consequence the source supports.";
    return {
      hook: `${base.subject}: the proof lands first.`,
      experiment_note: action,
    };
  }
  if (axis === "title") {
    return {
      title: safeTitle(`${wordLimit(base.subject, 4)} Changes The Story`),
      experiment_note: "Title changes only. Story claim, source and package stay locked.",
    };
  }
  if (axis === "thumbnail") {
    return {
      thumbnail: wordLimit(base.subject, 3).toUpperCase(),
      experiment_note: "Thumbnail text changes only. Keep imagery, title, hook and CTA locked.",
    };
  }
  if (axis === "cta") {
    return {
      cta: "source_trail_follow",
      experiment_note: "CTA changes only. It stays source-first and avoids engagement bait.",
    };
  }
  if (axis === "duration") {
    const target = Math.max(25, Math.min(45, Math.round(numberOr(base.duration, 40) - 4)));
    return {
      duration: target,
      experiment_note: "Duration changes only. No script claim, title or CTA changes are bundled into the test.",
    };
  }
  if (axis === "platform_outputs") {
    return {
      platform_outputs: Object.fromEntries(
        Object.entries(base.platform_outputs || {}).map(([platform, output]) => [
          platform,
          {
            ...output,
            experiment_role: platform === "youtube_shorts"
              ? "searchable_short_holdout"
              : "native_caption_or_cover_variant",
          },
        ]),
      ),
      experiment_note: "Platform packaging changes only. The underlying story and publish safety stay locked.",
    };
  }
  return {};
}

function buildVariants({ storyId, base, recommendations, blocked }) {
  return EXPERIMENT_AXES.map((axis) => {
    const value = buildVariantValue(axis, base, recommendations);
    return {
      variant_id: `${storyId}_${axis}_v1`,
      story_id: storyId,
      axis,
      controlled_variable: axis,
      changed_fields: [axis],
      locked_fields: EXPERIMENT_AXES.filter((item) => item !== axis),
      control_variant_id: `${storyId}_control`,
      status: blocked ? "blocked_planning_only" : "planned_pending_metrics",
      uncontrolled_random_variation: false,
      random_seed: null,
      deterministic_variant_id: true,
      value,
      guardrails: [
        "Change one variable only.",
        "Keep source facts, rights controls, platform safety and disclosure locked.",
        "Do not publish or swap variants without operator approval and scored evidence.",
      ],
    };
  });
}

function scoreMetricRow(row = {}) {
  const impressions = numberOr(row.impressions, 0);
  const views = numberOr(row.views, 0);
  const averageViewDuration = numberOr(row.average_view_duration_seconds ?? row.averageViewDurationSeconds, 0);
  const stayed = numberOr(row.stayed_to_watch ?? row.stayedToWatch, 0);
  const swipe = numberOr(row.swipe_away ?? row.swipeAway ?? row.swiped_away, 0);
  const clicks = numberOr(row.clicks, 0);
  const revenue = numberOr(row.revenue, 0);
  const ctr = impressions > 0 ? views / impressions : 0;
  return round(
    ctr * 120 +
      Math.min(40, averageViewDuration) * 1.4 +
      stayed * 0.45 -
      swipe * 0.18 +
      clicks * 0.05 +
      revenue * 0.2,
    3,
  );
}

function metricRowReady(row = {}) {
  return (
    numberOr(row.sample_size, 0) >= 1000 &&
    numberOr(row.observation_window_hours, 0) >= 24 &&
    numberOr(row.impressions, 0) > 0 &&
    numberOr(row.views, 0) > 0
  );
}

function observationWindow(row = {}) {
  const nested = row.observation_window && typeof row.observation_window === "object"
    ? row.observation_window
    : {};
  const start = cleanText(
    row.observation_window_start ||
      row.observation_window_start_at ||
      nested.start ||
      nested.start_at,
  );
  const end = cleanText(
    row.observation_window_end ||
      row.observation_window_end_at ||
      nested.end ||
      nested.end_at,
  );
  const hours = numberOr(row.observation_window_hours ?? nested.hours, 0);
  const startTimestamp = Date.parse(start);
  const endTimestamp = Date.parse(end);
  const actualHours =
    Number.isFinite(startTimestamp) && Number.isFinite(endTimestamp)
      ? (endTimestamp - startTimestamp) / 36e5
      : 0;
  const valid =
    Boolean(start && end) &&
    Number.isFinite(startTimestamp) &&
    Number.isFinite(endTimestamp) &&
    actualHours >= 24 &&
    hours >= 24 &&
    Math.abs(actualHours - hours) < 0.001;
  return {
    start: start || null,
    end: end || null,
    hours,
    valid,
    key: valid ? `${start}|${end}|${hours}` : null,
  };
}

function buildStoryScorecard({
  storyId,
  variants = [],
  metricsByVariant = new Map(),
  expectedPublicPosts = new Map(),
}) {
  const controlId = `${storyId}_control`;
  const candidateRows = [
    {
      variant_id: controlId,
      story_id: storyId,
      axis: "control",
      controlled_variable: "control",
    },
    ...variants,
  ].map((variant) => {
    const metrics = metricsByVariant.get(variant.variant_id) || null;
    const sampleReady = metrics ? metricRowReady(metrics) : false;
    const window = metrics ? observationWindow(metrics) : null;
    const provenanceReady = metrics
      ? metricRowProvenanceReady({
          row: metrics,
          storyId,
          variantId: variant.variant_id,
          expectedPost: expectedPublicPosts.get(variant.variant_id) || null,
        })
      : false;
    const metricsStatus = !metrics
      ? "missing"
      : !provenanceReady
        ? "public_post_provenance_invalid"
        : !sampleReady
          ? "insufficient_sample"
          : !window.valid
            ? "observation_window_invalid"
            : "complete";
    return {
      story_id: storyId,
      variant_id: variant.variant_id,
      axis: variant.axis || "control",
      controlled_variable: variant.controlled_variable || "control",
      metrics_status: metricsStatus,
      score: metricsStatus === "complete" ? scoreMetricRow(metrics) : null,
      public_post_provenance: metrics
        ? {
            story_id: cleanText(metrics.story_id || metrics.storyId) || null,
            variant_id: cleanText(metrics.variant_id || metrics.variantId) || null,
            platform: normalisePlatform(metrics.platform || metrics.platform_id) || null,
            public_post_id: metricPublicPostId(metrics) || null,
            expected_public_post_id:
              expectedPublicPosts.get(variant.variant_id)?.public_post_id || null,
            linked: provenanceReady,
          }
        : null,
      observation_window: window,
      metrics: metrics
        ? {
            sample_size: numberOr(metrics.sample_size, 0),
            observation_window_hours: numberOr(metrics.observation_window_hours, 0),
            observation_window_start: window.start,
            observation_window_end: window.end,
            impressions: numberOr(metrics.impressions, 0),
            views: numberOr(metrics.views, 0),
            average_view_duration_seconds: numberOr(metrics.average_view_duration_seconds ?? metrics.averageViewDurationSeconds, 0),
            stayed_to_watch: numberOr(metrics.stayed_to_watch ?? metrics.stayedToWatch, 0),
            swipe_away: numberOr(metrics.swipe_away ?? metrics.swipeAway ?? metrics.swiped_away, 0),
            clicks: numberOr(metrics.clicks, 0),
            revenue: numberOr(metrics.revenue, 0),
          }
        : null,
    };
  });
  const comparableControl = candidateRows.find(
    (row) => row.variant_id === controlId && row.metrics_status === "complete",
  );
  if (comparableControl) {
    for (const row of candidateRows) {
      if (
        row.variant_id !== controlId &&
        row.metrics_status === "complete" &&
        row.observation_window?.key !== comparableControl.observation_window?.key
      ) {
        row.metrics_status = "observation_window_mismatch";
        row.score = null;
      } else if (
        row.variant_id !== controlId &&
        row.metrics_status === "complete" &&
        row.public_post_provenance?.public_post_id ===
          comparableControl.public_post_provenance?.public_post_id
      ) {
        row.metrics_status = "public_post_provenance_conflict";
        row.score = null;
      }
    }
  }
  const complete = candidateRows.filter((row) => row.metrics_status === "complete");
  const control = complete.find((row) => row.variant_id === controlId) || null;
  const winner = control
    ? complete
        .filter((row) => row.variant_id !== controlId && row.score > control.score)
        .sort((a, b) => b.score - a.score)[0] || null
    : null;
  return {
    rows: candidateRows,
    control,
    winner,
    hasMetrics: complete.length > 0,
    hasAnyMetrics: candidateRows.some((row) => row.metrics !== null),
    hasCompleteControl: Boolean(control),
    hasCandidateWinner: Boolean(winner),
    hasInvalidProvenance: candidateRows.some(
      (row) => [
        "public_post_provenance_invalid",
        "public_post_provenance_conflict",
      ].includes(row.metrics_status),
    ),
    hasInvalidObservationWindow: candidateRows.some((row) =>
      ["observation_window_invalid", "observation_window_mismatch"].includes(
        row.metrics_status,
      )),
  };
}

function buildExperimentManifest(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    axes: EXPERIMENT_AXES,
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      status: story.status,
      publication_phase: story.publication_phase,
      publication_lifecycle: story.publication_lifecycle,
      performance_evidence_status: story.performance_evidence_status,
      base: story.base,
      experiment_axes: story.experiment_axes,
      variants: story.variants,
      blockers: story.blockers,
    })),
    safety: {
      controlled_variables_only: true,
      uncontrolled_random_variation_allowed: false,
      publish_actions_allowed: false,
    },
  };
}

function buildVariantScorecard(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      status: story.status,
      publication_phase: story.publication_phase,
      performance_evidence_status: story.performance_evidence_status,
      rows: story.variant_scorecard,
    })),
  };
}

function buildWinnerReport(report = {}) {
  const winners = asArray(report.stories)
    .map((story) => story.winner)
    .filter(Boolean);
  const status = winners.length
    ? "winners_ready_for_operator_review"
    : Object.keys(report.blocker_counts || {}).length
      ? "blocked_pending_variant_metrics"
      : "pending_variant_metrics_no_winner_yet";
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    status,
    winners,
    safety:
      "Winner tracking is evidence only. It does not swap titles, publish variants, mutate production rows or update rules automatically.",
  };
}

function buildRuleUpdateRecommendations(report = {}) {
  const winners = asArray(report.stories).filter((story) => story.winner);
  const recommendations = winners.map((story) => ({
    story_id: story.story_id,
    variant_id: story.winner.variant_id,
    controlled_variable: story.winner.controlled_variable,
    status: "candidate_operator_review",
    requires_human_approval: true,
    applies_to_future_renders_only: true,
    rule_update:
      `Prefer the ${story.winner.controlled_variable} treatment only for future packages with matching source and audience conditions.`,
    evidence: {
      score: story.winner.score,
      metrics: story.winner.metrics,
      control_variant_id: story.winner.control_variant_id,
      control_score: story.winner.control_score,
      control_metrics: story.winner.control_metrics,
      observation_window: story.winner.observation_window,
    },
  }));
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    status: recommendations.length
      ? "candidate_updates_ready"
      : Object.keys(report.blocker_counts || {}).length ? "blocked_pending_winners" : "pending_winners",
    recommendations,
    safety: {
      automatic_rule_mutation: false,
      requires_human_approval: true,
      applies_to_future_renders_only: true,
    },
  };
}

function blockerCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

async function inspectStoryPackage(storyPackage = {}, context = {}) {
  const storyId = storyIdFromPackage(storyPackage);
  const artifactDir = resolveWorkspacePath(context.workspaceRoot, storyPackage.artifact_dir);
  const skipped = upstreamSkippedInfo(storyId, context.retentionIndex);
  if (skipped) {
    return {
      story_id: storyId,
      title: cleanText(storyPackage.title),
      artifact_dir: artifactDir,
      status: "skipped",
      experiment_status: "skipped",
      publication_phase: "not_evaluated",
      publication_lifecycle: { phase: "not_evaluated" },
      performance_evidence_status: "not_evaluated",
      skipped_status: skipped.status,
      skipped_reason: skipped.reason,
      blockers: [],
      upstream_blockers: [],
      direct_experiment_blockers: [],
      base: {},
      experiment_axes: [],
      variants: [],
      variant_scorecard: [],
      winner: null,
      safety: {
        no_random_assignment: true,
        no_publish_triggered: true,
        no_platform_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
        no_secret_values_exposed: true,
      },
    };
  }
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const renderManifest = await readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {});
  const platformManifest = await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {});
  const recommendations = context.recommendationIndex.get(storyId) || {};
  const upstreamRetention = context.retentionIndex.get(storyId) || {};
  const baseUpstream = upstreamBlockers(storyId, context.retentionIndex);
  const metricsByVariant = context.variantMetricsIndex.get(storyId) || new Map();
  const base = baseExperimentState({
    storyId,
    storyPackage,
    canonical,
    renderManifest,
    platformManifest,
  });
  const publicationLifecycle = derivePublicationLifecycle({
    storyPackage,
    canonical,
    renderManifest,
    platformManifest,
    upstreamRetention,
  });
  const upstream = unique([
    ...baseUpstream,
    ...upstreamPerformanceBlockers(upstreamRetention, publicationLifecycle),
  ]);
  const variants = buildVariants({
    storyId,
    base,
    recommendations,
    blocked: upstream.length > 0,
  });
  const expectedPublicPosts = variantPublicPostIndex({
    storyId,
    storyPackage,
    platformManifest,
  });
  const scorecard = buildStoryScorecard({
    storyId,
    variants,
    metricsByVariant,
    expectedPublicPosts,
  });
  const metricsPending =
    publicationLifecycle.phase === "prepublication" && !scorecard.hasAnyMetrics;
  const directBlockers = [];
  if (publicationLifecycle.phase === "conflicted") {
    directBlockers.push("experiment:publication_lifecycle_conflict");
  } else if (publicationLifecycle.phase === "unknown") {
    directBlockers.push("experiment:publication_lifecycle_unknown");
  }
  if (!scorecard.hasMetrics && !metricsPending) directBlockers.push("experiment:variant_metrics_missing");
  if (scorecard.hasMetrics && !scorecard.hasCompleteControl) {
    directBlockers.push("experiment:control_metrics_missing");
  }
  if (scorecard.hasInvalidProvenance) {
    directBlockers.push("experiment:variant_metrics_provenance_invalid");
  }
  if (scorecard.hasInvalidObservationWindow) {
    directBlockers.push("experiment:observation_window_invalid_or_mismatched");
  }
  if (scorecard.hasMetrics && !scorecard.hasCandidateWinner) {
    directBlockers.push("experiment:winner_metrics_missing");
  }
  if (scorecard.hasCandidateWinner && publicationLifecycle.phase !== "published") {
    directBlockers.push("experiment:winner_requires_published_lifecycle");
  }
  const blockers = unique([...upstream, ...directBlockers]);
  const performanceEvidenceStatus = metricsPending
    ? "pending_not_yet_observable"
    : publicationLifecycle.phase === "conflicted"
      ? "blocked_lifecycle_conflict"
        : publicationLifecycle.phase === "unknown"
          ? "blocked_lifecycle_unknown"
        : upstream.includes("upstream:goal11_performance_evidence_not_ready")
          ? "blocked_upstream_performance_evidence"
          : scorecard.hasInvalidProvenance
            ? "blocked_variant_provenance_invalid"
            : scorecard.hasInvalidObservationWindow
              ? "blocked_observation_window_invalid"
              : !scorecard.hasAnyMetrics
                ? "missing_after_publication"
                : scorecard.hasCompleteControl && scorecard.hasCandidateWinner
                  ? "observed_complete_control_and_candidate"
                  : "incomplete_experiment_evidence";
  const winner = scorecard.winner && blockers.length === 0
    ? {
        story_id: storyId,
        variant_id: scorecard.winner.variant_id,
        controlled_variable: scorecard.winner.controlled_variable,
        score: scorecard.winner.score,
        metrics: scorecard.winner.metrics,
        control_variant_id: scorecard.control.variant_id,
        control_score: scorecard.control.score,
        control_metrics: scorecard.control.metrics,
        control_public_post_provenance: scorecard.control.public_post_provenance,
        candidate_public_post_provenance: scorecard.winner.public_post_provenance,
        observation_window: scorecard.winner.observation_window,
        status: "ready_for_operator_review",
      }
    : null;
  return {
    story_id: storyId,
    title: base.title,
    artifact_dir: artifactDir,
    status: blockers.length ? "blocked" : "ready",
    experiment_status: blockers.length
      ? upstream.length ? "blocked_planning_only" : "blocked_evidence"
      : metricsPending ? "planned_pending_metrics" : "planned_or_scored",
    publication_phase: publicationLifecycle.phase,
    publication_lifecycle: publicationLifecycle,
    performance_evidence_status: performanceEvidenceStatus,
    blockers,
    upstream_blockers: upstream,
    direct_experiment_blockers: directBlockers,
    base,
    experiment_axes: EXPERIMENT_AXES.map((axis) => ({
      axis,
      variant_id: `${storyId}_${axis}_v1`,
      controlled_variable: axis,
      status: upstream.length ? "blocked_planning_only" : "planned",
    })),
    variants: variants.map((variant) => ({
      ...variant,
      status: upstream.length
        ? "blocked_planning_only"
        : scorecard.rows.find((row) => row.variant_id === variant.variant_id)?.metrics_status === "complete"
          ? "scored"
          : metricsByVariant.has(variant.variant_id)
            ? "blocked_invalid_metrics"
            : "planned_pending_metrics",
    })),
    variant_scorecard: scorecard.rows,
    winner,
    safety: {
      no_random_assignment: true,
      no_publish_triggered: true,
      no_platform_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
  };
}

async function buildGoal12ExperimentationEngine({
  storyPackages = [],
  upstreamRetentionReport = {},
  futureRenderRecommendations = {},
  variantMetricsManifest = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal12ExperimentationEngine requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const retentionIndex = buildRetentionIndex(upstreamRetentionReport);
  const recommendationIndex = buildRecommendationIndex(futureRenderRecommendations);
  const variantMetricsIndex = buildVariantMetricsIndex(variantMetricsManifest);
  const stories = [];
  for (const storyPackage of asArray(storyPackages)) {
    stories.push(
      await inspectStoryPackage(storyPackage, {
        workspaceRoot,
        retentionIndex,
        recommendationIndex,
        variantMetricsIndex,
      }),
    );
  }
  const activeStories = stories.filter((story) => story.status !== "skipped");
  const skippedStories = stories.filter((story) => story.status === "skipped");
  const readyStories = activeStories.filter((story) => story.status === "ready");
  const blockedStories = activeStories.filter((story) => story.status === "blocked");
  const winners = activeStories.filter((story) => story.winner && story.winner.status === "ready_for_operator_review");
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
      experiment_ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      controlled_variant_plan_story_count: activeStories.filter((story) => story.variants.length === EXPERIMENT_AXES.length).length,
      planned_variant_count: activeStories.reduce((sum, story) => sum + story.variants.length, 0),
      planned_pending_metrics_story_count: activeStories.filter((story) => story.experiment_status === "planned_pending_metrics").length,
      scored_variant_count: activeStories.reduce(
        (sum, story) => sum + story.variant_scorecard.filter((row) => row.metrics_status === "complete" && row.axis !== "control").length,
        0,
      ),
      winner_ready_story_count: winners.length,
      axis_count: EXPERIMENT_AXES.length,
    },
    experiment_axes: EXPERIMENT_AXES,
    blocker_counts: blockerCounts(activeStories),
    upstream_blockers: {
      goal11_retention_intelligence_loop:
        "Goal 12 can plan controlled variants, but winner tracking requires Goal 11 retention readiness and local variant metrics first.",
      note:
        "This gate creates deterministic local plans only. It does not randomise audiences, publish variants, swap titles, mutate DB rows or update rules automatically.",
    },
    stories,
    safety: {
      read_only_audit: true,
      deterministic_variant_ids: true,
      uncontrolled_random_variation_allowed: false,
      no_publish_triggered: true,
      no_platform_uploads: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
      no_gate_weakened: true,
    },
  };
  report.experiment_manifest = buildExperimentManifest(report);
  report.variant_scorecard = buildVariantScorecard(report);
  report.winner_report = buildWinnerReport(report);
  report.rule_update_recommendations = buildRuleUpdateRecommendations(report);
  return report;
}

function renderGoal12ExperimentationEngineMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 12 Experimentation Engine");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`Experiment-ready stories: ${report.summary?.experiment_ready_story_count || 0}`);
  lines.push(`Controlled variant plan stories: ${report.summary?.controlled_variant_plan_story_count || 0}`);
  lines.push(`Planned variants: ${report.summary?.planned_variant_count || 0}`);
  lines.push(`Scored variants: ${report.summary?.scored_variant_count || 0}`);
  lines.push(`Winner-ready stories: ${report.summary?.winner_ready_story_count || 0}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("## Axes");
  for (const axis of EXPERIMENT_AXES) lines.push(`- ${axis}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF only. This run did not randomise audiences, render variants, publish, upload, post externally, mutate the database, touch OAuth or expose token values.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal12ExperimentationEngine(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal12ExperimentationEngine requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal12_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal12_readiness_report.md");
  const experimentManifest = path.join(outDir, "experiment_manifest.json");
  const variantScorecard = path.join(outDir, "variant_scorecard.json");
  const winnerReport = path.join(outDir, "winner_report.json");
  const ruleUpdateRecommendations = path.join(outDir, "rule_update_recommendations.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal12ExperimentationEngineMarkdown(report), "utf8");
  await fs.writeJson(experimentManifest, report.experiment_manifest || buildExperimentManifest(report), { spaces: 2 });
  await fs.writeJson(variantScorecard, report.variant_scorecard || buildVariantScorecard(report), { spaces: 2 });
  await fs.writeJson(winnerReport, report.winner_report || buildWinnerReport(report), { spaces: 2 });
  await fs.writeJson(
    ruleUpdateRecommendations,
    report.rule_update_recommendations || buildRuleUpdateRecommendations(report),
    { spaces: 2 },
  );
  return {
    readinessJson,
    readinessMarkdown,
    experimentManifest,
    variantScorecard,
    winnerReport,
    ruleUpdateRecommendations,
  };
}

module.exports = {
  EXPERIMENT_AXES,
  buildExperimentManifest,
  buildGoal12ExperimentationEngine,
  buildRuleUpdateRecommendations,
  buildVariantScorecard,
  buildWinnerReport,
  inspectStoryPackage,
  renderGoal12ExperimentationEngineMarkdown,
  writeGoal12ExperimentationEngine,
};

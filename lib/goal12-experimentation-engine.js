"use strict";

const path = require("node:path");
const fs = require("fs-extra");

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
  if (!title) return "Pulse Gaming Source Update";
  return title.length > 78 ? `${title.slice(0, 75).trim()}...` : title;
}

function platformOutputs(platformManifest = {}) {
  return platformManifest.outputs || platformManifest.platform_outputs || {};
}

function baseExperimentState({ storyId, storyPackage = {}, canonical = {}, renderManifest = {}, platformManifest = {} }) {
  const title = safeTitle(canonical.selected_title || canonical.title || storyPackage.title);
  const subject = cleanText(canonical.canonical_subject || canonical.subject || title);
  const hook = firstSentence(canonical.first_spoken_line || canonical.hook || canonical.narration_script) ||
    `${subject} has a new source-backed update.`;
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
      : "Lead with the named subject and the clearest source-backed consequence.";
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

function buildStoryScorecard({ storyId, variants = [], metricsByVariant = new Map() }) {
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
    return {
      story_id: storyId,
      variant_id: variant.variant_id,
      axis: variant.axis || "control",
      controlled_variable: variant.controlled_variable || "control",
      metrics_status: metrics ? (metricRowReady(metrics) ? "complete" : "insufficient_sample") : "missing",
      score: metrics && metricRowReady(metrics) ? scoreMetricRow(metrics) : null,
      metrics: metrics
        ? {
            sample_size: numberOr(metrics.sample_size, 0),
            observation_window_hours: numberOr(metrics.observation_window_hours, 0),
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
  const complete = candidateRows.filter((row) => row.metrics_status === "complete");
  const winner = complete
    .filter((row) => row.variant_id !== controlId)
    .sort((a, b) => b.score - a.score)[0] || null;
  return {
    rows: candidateRows,
    winner,
    hasMetrics: complete.length > 0,
    hasCandidateWinner: Boolean(winner),
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
    : "blocked_pending_variant_metrics";
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
    },
  }));
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    status: recommendations.length ? "candidate_updates_ready" : "blocked_pending_winners",
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
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const renderManifest = await readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {});
  const platformManifest = await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {});
  const recommendations = context.recommendationIndex.get(storyId) || {};
  const upstream = upstreamBlockers(storyId, context.retentionIndex);
  const metricsByVariant = context.variantMetricsIndex.get(storyId) || new Map();
  const base = baseExperimentState({
    storyId,
    storyPackage,
    canonical,
    renderManifest,
    platformManifest,
  });
  const variants = buildVariants({
    storyId,
    base,
    recommendations,
    blocked: upstream.length > 0,
  });
  const scorecard = buildStoryScorecard({ storyId, variants, metricsByVariant });
  const directBlockers = [];
  if (!scorecard.hasMetrics) directBlockers.push("experiment:variant_metrics_missing");
  if (scorecard.hasMetrics && !scorecard.hasCandidateWinner) {
    directBlockers.push("experiment:winner_metrics_missing");
  }
  const blockers = unique([...upstream, ...directBlockers]);
  const winner = scorecard.winner
    ? {
        story_id: storyId,
        variant_id: scorecard.winner.variant_id,
        controlled_variable: scorecard.winner.controlled_variable,
        score: scorecard.winner.score,
        metrics: scorecard.winner.metrics,
        status: blockers.length ? "blocked_by_upstream" : "ready_for_operator_review",
      }
    : null;
  return {
    story_id: storyId,
    title: base.title,
    artifact_dir: artifactDir,
    status: blockers.length ? "blocked" : "ready",
    experiment_status: upstream.length ? "blocked_planning_only" : "planned_or_scored",
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
        : metricsByVariant.has(variant.variant_id)
          ? "scored"
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
  const readyStories = stories.filter((story) => story.status === "ready");
  const blockedStories = stories.filter((story) => story.status === "blocked");
  const winners = stories.filter((story) => story.winner && story.winner.status === "ready_for_operator_review");
  const verdict = !stories.length
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
      experiment_ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      controlled_variant_plan_story_count: stories.filter((story) => story.variants.length === EXPERIMENT_AXES.length).length,
      planned_variant_count: stories.reduce((sum, story) => sum + story.variants.length, 0),
      scored_variant_count: stories.reduce(
        (sum, story) => sum + story.variant_scorecard.filter((row) => row.metrics_status === "complete" && row.axis !== "control").length,
        0,
      ),
      winner_ready_story_count: winners.length,
      axis_count: EXPERIMENT_AXES.length,
    },
    experiment_axes: EXPERIMENT_AXES,
    blocker_counts: blockerCounts(stories),
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

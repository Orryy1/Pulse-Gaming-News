"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { evaluateIncidentGuard } = require("./incident-guard");

const DEFAULT_PUBLISH_HOURS_UTC = [9, 14, 19];
const DEFAULT_THRESHOLDS = {
  script_score: 75,
  visual_score: 85,
  first_3_seconds_score: 80,
  motion_density_score: 80,
};

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function readJsonIfPresent(filePath, fallback = {}) {
  try {
    if (filePath && await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

function reportVerdict(report = {}, passValues = ["pass", "passed", "green"]) {
  return clean(report.verdict || report.result || report.status).toLowerCase();
}

function passLike(report = {}) {
  const verdict = reportVerdict(report);
  if (!verdict) return true;
  return ["pass", "passed", "green"].includes(verdict);
}

function activeReportFailures(report = {}) {
  const verdict = reportVerdict(report);
  const failures = [
    ...asArray(report.blockers),
    ...asArray(report.failures),
  ];
  if (!failures.length) return [];
  if (verdict && passLike(report)) return [];
  return failures;
}

function scoreAverage(scores = []) {
  const values = scores.map(numberOrNull).filter((value) => value !== null);
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function uniqueClean(values = []) {
  return [...new Set(asArray(values).map(clean).filter(Boolean))];
}

function normaliseOperatorBlockedItem(item = {}) {
  const renderRequirements = asArray(item.render_input_requirements);
  return {
    story_id: item.story_id,
    status: clean(item.status) || "blocked_from_human_approval",
    operator_queue_status: clean(item.operator_queue_status) || "operator_required",
    dead_end_blocker: item.dead_end_blocker === true,
    reject_recommended: item.reject_recommended === true,
    required_action: clean(item.required_action) || "operator_repair_or_review_required",
    blockers: uniqueClean(item.blockers),
    repair_lanes: uniqueClean(renderRequirements.map((requirement) => requirement.repair_lane)),
    missing_inputs: uniqueClean(renderRequirements.map((requirement) => requirement.exact_missing_input)),
  };
}

function buildUpstreamBenchmarkMap(report = {}) {
  const stories = asArray(report.stories);
  if (!stories.length) return null;
  return new Map(stories.map((story) => [clean(story.story_id), story]).filter(([storyId]) => storyId));
}

function applyUpstreamBenchmarkGate(item = {}, upstreamStory = null) {
  if (!upstreamStory) return item;
  const status = clean(upstreamStory.status || upstreamStory.verdict).toLowerCase();
  const blockers = uniqueClean(upstreamStory.blockers);
  if (status && !["ready", "pass", "passed", "green"].includes(status)) {
    return {
      ...item,
      upstream_benchmark_status: status,
      upstream_benchmark_blockers: blockers,
      blockers: uniqueClean([
        ...asArray(item.blockers),
        "upstream_goal10_benchmark_not_ready",
      ]),
    };
  }
  return {
    ...item,
    upstream_benchmark_status: status || "unknown",
    upstream_benchmark_blockers: blockers,
  };
}

function nextPublishWindows({ generatedAt, count, hoursUtc = DEFAULT_PUBLISH_HOURS_UTC } = {}) {
  const start = new Date(generatedAt || Date.now());
  const windows = [];
  const hours = [...hoursUtc].map(Number).filter((hour) => Number.isFinite(hour)).sort((a, b) => a - b);
  for (let dayOffset = 0; windows.length < count && dayOffset < 8; dayOffset += 1) {
    for (const hour of hours) {
      const candidate = new Date(Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth(),
        start.getUTCDate() + dayOffset,
        hour,
        0,
        0,
        0,
      ));
      if (candidate.getTime() >= start.getTime()) windows.push(candidate.toISOString());
      if (windows.length >= count) break;
    }
  }
  return windows;
}

async function assessReviewItem(item = {}, thresholds = DEFAULT_THRESHOLDS) {
  const artifactDir = item.artifact_dir;
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const publishVerdict = await readJsonIfPresent(path.join(artifactDir, "publish_verdict.json"), {});
  const scriptScorecard = await readJsonIfPresent(path.join(artifactDir, "script_scorecard.json"), {});
  const visualQuality = await readJsonIfPresent(path.join(artifactDir, "visual_quality_report.json"), {});
  const benchmarkReport = await readJsonIfPresent(path.join(artifactDir, "benchmark_report.json"), {});
  const coherenceReport = await readJsonIfPresent(path.join(artifactDir, "coherence_report.json"), {});
  const uniquenessReport = await readJsonIfPresent(path.join(artifactDir, "uniqueness_report.json"), {});
  const renderManifest = await readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {});
  const sfxManifest = await readJsonIfPresent(path.join(artifactDir, "sfx_manifest.json"), {});
  const platformManifest = await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {});
  const policyReport = await readJsonIfPresent(path.join(artifactDir, "platform_policy_report.json"), {});
  const landingPageManifest = await readJsonIfPresent(path.join(artifactDir, "landing_page_manifest.json"), {});
  const affiliateManifest = await readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"), {});
  const incidentGuard = evaluateIncidentGuard({
    story_id: item.story_id,
    canonical_story_manifest: canonical,
    render_manifest: renderManifest,
    visual_quality_report: visualQuality,
    benchmark_report: benchmarkReport,
    sfx_manifest: sfxManifest,
    publish_verdict: publishVerdict,
    platform_publish_manifest: platformManifest,
    platform_policy_report: policyReport,
    landing_page_manifest: landingPageManifest,
    affiliate_link_manifest: affiliateManifest,
  });
  const currentCoherencePass =
    incidentGuard.public_output_coherence_report?.verdict === "pass" &&
    !asArray(incidentGuard.public_output_coherence_report?.blockers).length;

  const scriptScore = numberOrNull(scriptScorecard.viral_score || scriptScorecard.score || scriptScorecard.total_score);
  const visualScore = numberOrNull(
    visualQuality.scores?.media_house_polish_score ||
      visualQuality.scores?.visual_quality_score ||
      visualQuality.score,
  );
  const firstThreeScore = numberOrNull(
    benchmarkReport.scores?.first_3_seconds_hook_score ||
      visualQuality.scores?.first_3_seconds_hook_score,
  );
  const motionScore = numberOrNull(
    benchmarkReport.scores?.motion_density_score ||
      visualQuality.scores?.motion_density_score,
  );
  const blockers = [];
  if (item.enabled_platform_verdict !== "GREEN") blockers.push("enabled_platform_verdict_not_green");
  if (!asArray(item.publish_now_platforms).length) blockers.push("no_enabled_publish_platforms");
  if (clean(publishVerdict.verdict || publishVerdict.status) !== "GREEN") blockers.push("publish_verdict_not_green");
  if (scriptScore === null) blockers.push("script_score_missing");
  else if (scriptScore < thresholds.script_score) blockers.push("script_score_below_threshold");
  if (visualScore === null) blockers.push("visual_score_missing");
  else if (visualScore < thresholds.visual_score) blockers.push("visual_score_below_threshold");
  if (firstThreeScore === null) blockers.push("first_3_seconds_score_missing");
  else if (firstThreeScore < thresholds.first_3_seconds_score) blockers.push("first_3_seconds_score_below_threshold");
  if (motionScore === null) blockers.push("motion_density_score_missing");
  else if (motionScore < thresholds.motion_density_score) blockers.push("motion_density_score_below_threshold");
  if (!currentCoherencePass && !passLike(coherenceReport)) blockers.push("coherence_not_pass");
  else if (!currentCoherencePass) blockers.push("coherence_not_pass");
  if (!passLike(uniquenessReport)) blockers.push("uniqueness_not_pass");
  const failures = [
    ...asArray(scriptScorecard.blockers),
    ...activeReportFailures(visualQuality),
    ...activeReportFailures(benchmarkReport),
    ...(currentCoherencePass ? [] : activeReportFailures(coherenceReport)),
    ...activeReportFailures(uniquenessReport),
    ...asArray(incidentGuard.public_output_coherence_report?.blockers),
  ];
  if (failures.length) blockers.push("quality_report_failures_present");

  const qualityScore = scoreAverage([scriptScore, visualScore, firstThreeScore, motionScore]) || 0;
  return {
    story_id: item.story_id,
    artifact_dir: artifactDir,
    title: item.public_copy?.title || item.story_id,
    quality_score: qualityScore,
    scores: {
      script_score: scriptScore,
      visual_score: visualScore,
      first_3_seconds_score: firstThreeScore,
      motion_density_score: motionScore,
    },
    publish_now_platforms: asArray(item.publish_now_platforms),
    deferred_platforms: asArray(item.deferred_platforms),
    blockers,
    warnings: asArray(item.warnings),
    operator_approval_required: item.approval?.operator_approval_required !== false,
  };
}

function buildSchedule({ selected = [], generatedAt, hoursUtc = DEFAULT_PUBLISH_HOURS_UTC } = {}) {
  const windows = nextPublishWindows({ generatedAt, count: selected.length, hoursUtc });
  return selected.map((item, index) => ({
    slot: index + 1,
    story_id: item.story_id,
    title: item.title,
    scheduled_for_utc: windows[index],
    operating_mode: "HUMAN_REVIEW",
    status: "queued_for_operator_review",
    requires_operator_approval: true,
    counted_delivery_platforms: item.publish_now_platforms,
    deferred_platforms_not_counted: item.deferred_platforms,
    quality_score: item.quality_score,
  }));
}

async function buildGoalDailyCadencePlan({
  humanReviewQueue = {},
  upstreamBenchmarkReport = {},
  generatedAt = new Date().toISOString(),
  targetDailyShorts = 3,
  thresholds = DEFAULT_THRESHOLDS,
} = {}) {
  const target = Math.max(1, Math.min(8, Number(targetDailyShorts) || 3));
  const assessed = [];
  const upstreamBenchmarkMap = buildUpstreamBenchmarkMap(upstreamBenchmarkReport);
  for (const item of asArray(humanReviewQueue.review_items)) {
    const assessedItem = await assessReviewItem(item, thresholds);
    assessed.push(
      applyUpstreamBenchmarkGate(
        assessedItem,
        upstreamBenchmarkMap ? upstreamBenchmarkMap.get(clean(item.story_id)) : null,
      ),
    );
  }
  const operatorBlockedItems = asArray(humanReviewQueue.blocked_items).map(normaliseOperatorBlockedItem);
  const ready = assessed
    .filter((item) => item.blockers.length === 0)
    .sort((a, b) => b.quality_score - a.quality_score);
  const rejected = assessed
    .filter((item) => item.blockers.length > 0)
    .map((item) => ({
      story_id: item.story_id,
      title: item.title,
      blockers: item.blockers,
      scores: item.scores,
      upstream_benchmark_status: item.upstream_benchmark_status,
      upstream_benchmark_blockers: asArray(item.upstream_benchmark_blockers),
    }));
  const selected = ready.slice(0, target);
  const readyButUnscheduled = ready.slice(selected.length);
  const publishSchedule = buildSchedule({ selected, generatedAt });
  const minRequired = Math.min(target, 3);
  const belowMinimum = selected.length < minRequired;
  const disabledCounted = publishSchedule.some((slot) =>
    asArray(slot.counted_delivery_platforms).some((platform) => asArray(slot.deferred_platforms_not_counted).includes(platform)),
  );
  const cadenceVerdict = belowMinimum || disabledCounted ? "RED" : "AMBER";
  const qualityReport = {
    schema_version: 1,
    generated_at: generatedAt,
    verdict: cadenceVerdict,
    autonomous_publish_ready: false,
    reason: cadenceVerdict === "RED"
      ? "not_enough_reviewable_strong_candidates"
      : "operator_review_required_before_live_publish",
    gates: {
      target_daily_shorts: target,
      minimum_required_for_plan: minRequired,
      planned_story_count: selected.length,
      no_disabled_platform_counted_as_delivered: !disabledCounted,
      no_red_review_items_scheduled: selected.every((item) => item.blockers.length === 0),
      operator_approval_required: true,
    },
    thresholds,
    rejected_item_count: rejected.length,
    ready_candidate_count: ready.length,
    ready_but_unscheduled_count: readyButUnscheduled.length,
    operator_blocked_count: operatorBlockedItems.length,
  };

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "HUMAN_REVIEW_DAILY_CADENCE",
    daily_content_plan: {
      schema_version: 1,
      generated_at: generatedAt,
      target_daily_shorts: target,
      planned_story_count: selected.length,
      planned_items: selected,
      ready_candidate_count: ready.length,
      ready_but_unscheduled_count: readyButUnscheduled.length,
      ready_but_unscheduled_items: readyButUnscheduled,
      operator_blocked_count: operatorBlockedItems.length,
      operator_blocked_items: operatorBlockedItems,
      rejected_items: rejected,
    },
    publish_schedule: publishSchedule,
    cadence_quality_report: qualityReport,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      disabled_platforms_not_counted_as_delivered: !disabledCounted,
    },
  };
}

function renderGoalDailyCadenceMarkdown(plan = {}) {
  const report = plan.cadence_quality_report || {};
  const lines = [
    "# Daily Content Plan",
    "",
    `Generated: ${plan.generated_at || "unknown"}`,
    `Verdict: ${report.verdict || "unknown"}`,
    `Planned stories: ${plan.daily_content_plan?.planned_story_count || 0}`,
    `Target shorts: ${plan.daily_content_plan?.target_daily_shorts || 0}`,
    "No uploads are triggered. This plan queues operator review only.",
    "",
    "## Schedule",
  ];
  for (const slot of asArray(plan.publish_schedule)) {
    lines.push(
      `- ${slot.scheduled_for_utc}: ${slot.title} (${slot.counted_delivery_platforms.join(", ")})`,
    );
  }
  if (!asArray(plan.publish_schedule).length) lines.push("- none");
  lines.push("", "## Ready but unscheduled", "");
  const readyButUnscheduled = asArray(plan.daily_content_plan?.ready_but_unscheduled_items);
  if (readyButUnscheduled.length) {
    for (const item of readyButUnscheduled.slice(0, 20)) {
      lines.push(`- ${item.story_id}: ${item.title} (quality ${item.quality_score})`);
    }
  } else {
    lines.push("- none");
  }
  lines.push("", "## Operator-blocked", "");
  const operatorBlockedItems = asArray(plan.daily_content_plan?.operator_blocked_items);
  if (operatorBlockedItems.length) {
    for (const item of operatorBlockedItems.slice(0, 20)) {
      const lanes = asArray(item.repair_lanes).join(", ") || "unknown_lane";
      const deadEnd = item.dead_end_blocker ? " dead-end" : "";
      const reject = item.reject_recommended ? " reject-recommended" : "";
      lines.push(`- ${item.story_id}: ${lanes}${deadEnd}${reject}`);
    }
  } else {
    lines.push("- none");
  }
  if (asArray(plan.daily_content_plan?.rejected_items).length) {
    lines.push("", "## Rejected", "");
    for (const item of asArray(plan.daily_content_plan.rejected_items).slice(0, 20)) {
      lines.push(`- ${item.story_id}: ${item.blockers.join(", ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function writeGoalDailyCadencePlan(plan = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalDailyCadencePlan requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const dailyContentPlanPath = path.join(outDir, "daily_content_plan.json");
  const publishSchedulePath = path.join(outDir, "publish_schedule.json");
  const cadenceQualityReportPath = path.join(outDir, "cadence_quality_report.json");
  const markdownPath = path.join(outDir, "daily_content_plan.md");
  await fs.writeJson(dailyContentPlanPath, plan.daily_content_plan || {}, { spaces: 2 });
  await fs.writeJson(publishSchedulePath, plan.publish_schedule || [], { spaces: 2 });
  await fs.writeJson(cadenceQualityReportPath, plan.cadence_quality_report || {}, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalDailyCadenceMarkdown(plan), "utf8");
  return { outputDir: outDir, dailyContentPlanPath, publishSchedulePath, cadenceQualityReportPath, markdownPath };
}

module.exports = {
  DEFAULT_THRESHOLDS,
  buildGoalDailyCadencePlan,
  nextPublishWindows,
  renderGoalDailyCadenceMarkdown,
  writeGoalDailyCadencePlan,
};

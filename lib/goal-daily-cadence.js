"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { evaluateIncidentGuard } = require("./incident-guard");
const { auditPublicOutputCoherenceArtifact } = require("./public-output-coherence-artifact");

const DEFAULT_PUBLISH_HOURS_UTC = [9, 14, 19];
const DEFAULT_THRESHOLDS = {
  script_score: 75,
  visual_score: 85,
  first_3_seconds_score: 80,
  motion_density_score: 80,
  max_temporal_claim_age_days: 14,
  max_daily_per_subject: 1,
};
const MONTH_INDEX = new Map(
  [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].map((month, index) => [month, index]),
);
const CURRENT_NEWS_WORDING_RE =
  /\b(?:today|tonight|this week|this month|right now|out now|available now|just|finally|already|live|went up|drops?|is here|is out|new)\b/i;

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

function normaliseSubjectKey(value = "") {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cadenceSubjectKey({ canonical = {}, item = {} } = {}) {
  return normaliseSubjectKey(
    canonical.canonical_subject ||
      canonical.canonical_game ||
      item.public_copy?.title ||
      item.title ||
      item.story_id,
  );
}

function parseMentionedDates(text = "") {
  const value = clean(text);
  const dates = [];
  const pattern =
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-3]?\d)(?:st|nd|rd|th)?(?:,)?\s+(20\d{2})\b/gi;
  let match;
  while ((match = pattern.exec(value))) {
    const month = MONTH_INDEX.get(String(match[1] || "").toLowerCase());
    const day = Number(match[2]);
    const year = Number(match[3]);
    if (month == null || !Number.isFinite(day) || !Number.isFinite(year)) continue;
    const at = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    if (Number.isNaN(at.getTime())) continue;
    dates.push({
      iso_date: at.toISOString().slice(0, 10),
      matched_text: match[0],
      timestamp_ms: at.getTime(),
    });
  }
  return dates;
}

function assessCadenceFreshness({ canonical = {}, item = {}, generatedAt, thresholds = DEFAULT_THRESHOLDS } = {}) {
  const now = new Date(generatedAt || Date.now()).getTime();
  const maxAgeDays = Number(thresholds.max_temporal_claim_age_days) || DEFAULT_THRESHOLDS.max_temporal_claim_age_days;
  const publicText = [
    item.title,
    item.public_copy?.title,
    canonical.selected_title,
    canonical.thumbnail_headline,
    canonical.thumbnail_text,
    canonical.first_spoken_line,
    canonical.narration_hook,
    canonical.narration_script,
    canonical.description,
  ].join(" ");
  const claimText = [
    ...asArray(canonical.confirmed_claims),
    ...asArray(canonical.claim_inventory?.confirmed),
    ...asArray(canonical.allowed_public_wording),
    publicText,
  ].join(" ");
  const datedClaims = parseMentionedDates(claimText).map((date) => ({
    ...date,
    age_days: Number.isFinite(now)
      ? Math.floor((now - date.timestamp_ms) / 86_400_000)
      : null,
  }));
  const staleDatedClaims = datedClaims.filter((date) => Number.isFinite(date.age_days) && date.age_days > maxAgeDays);
  const currentNewsWording = CURRENT_NEWS_WORDING_RE.test(publicText);
  const manifestStaleRisks = uniqueClean(canonical.stale_wording_risks);
  const blockers = [];
  if (manifestStaleRisks.length) blockers.push("cadence_manifest_stale_wording_risk");
  if (staleDatedClaims.length) blockers.push("cadence_stale_explicit_date");
  if (staleDatedClaims.length && currentNewsWording) {
    blockers.push("cadence_current_wording_on_old_event");
  }
  return {
    max_temporal_claim_age_days: maxAgeDays,
    current_news_wording_detected: currentNewsWording,
    dated_claims: datedClaims.map(({ timestamp_ms, ...date }) => date),
    stale_dated_claims: staleDatedClaims.map(({ timestamp_ms, ...date }) => date),
    stale_wording_risks: manifestStaleRisks,
    oldest_temporal_claim_age_days: staleDatedClaims.length
      ? Math.max(...staleDatedClaims.map((date) => date.age_days))
      : null,
    blockers,
  };
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

async function assessReviewItem(item = {}, thresholds = DEFAULT_THRESHOLDS, generatedAt = new Date().toISOString()) {
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
  const coherenceArtifact = await auditPublicOutputCoherenceArtifact({
    artifactDir,
    canonical,
    coherenceReport,
  });

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
  blockers.push(...asArray(coherenceArtifact.blockers));
  if (!passLike(uniquenessReport)) blockers.push("uniqueness_not_pass");
  const freshness = assessCadenceFreshness({ canonical, item, generatedAt, thresholds });
  blockers.push(...freshness.blockers);
  const failures = [
    ...asArray(scriptScorecard.blockers),
    ...activeReportFailures(visualQuality),
    ...activeReportFailures(benchmarkReport),
    ...(currentCoherencePass ? [] : activeReportFailures(coherenceReport)),
    ...asArray(coherenceArtifact.blockers),
    ...activeReportFailures(uniquenessReport),
    ...asArray(incidentGuard.public_output_coherence_report?.blockers),
  ];
  if (failures.length) blockers.push("quality_report_failures_present");

  const qualityScore = scoreAverage([scriptScore, visualScore, firstThreeScore, motionScore]) || 0;
  return {
    story_id: item.story_id,
    artifact_dir: artifactDir,
    title: item.public_copy?.title || item.story_id,
    canonical_subject: clean(canonical.canonical_subject || canonical.canonical_game) || null,
    cadence_subject_key: cadenceSubjectKey({ canonical, item }),
    quality_score: qualityScore,
    scores: {
      script_score: scriptScore,
      visual_score: visualScore,
      first_3_seconds_score: firstThreeScore,
      motion_density_score: motionScore,
    },
    freshness,
    publish_now_platforms: asArray(item.publish_now_platforms),
    deferred_platforms: asArray(item.deferred_platforms),
    blockers,
    warnings: asArray(item.warnings),
    operator_approval_required: item.approval?.operator_approval_required !== false,
  };
}

function selectDailyCadenceItems(ready = [], target = 3, thresholds = DEFAULT_THRESHOLDS) {
  const maxPerSubject = Math.max(1, Number(thresholds.max_daily_per_subject) || DEFAULT_THRESHOLDS.max_daily_per_subject);
  const selected = [];
  const unscheduled = [];
  const subjectCounts = new Map();
  let deferredSameSubjectCount = 0;

  for (const item of asArray(ready)) {
    const subjectKey = clean(item.cadence_subject_key) || normaliseSubjectKey(item.title || item.story_id);
    const currentCount = subjectCounts.get(subjectKey) || 0;
    if (currentCount >= maxPerSubject) {
      deferredSameSubjectCount += 1;
      unscheduled.push({
        ...item,
        warnings: uniqueClean([
          ...asArray(item.warnings),
          `cadence_subject_cap_deferred:${subjectKey}`,
        ]),
      });
      continue;
    }
    if (selected.length < target) {
      selected.push(item);
      subjectCounts.set(subjectKey, currentCount + 1);
      continue;
    }
    unscheduled.push(item);
  }

  const scheduledSubjectKeys = selected.map((item) =>
    clean(item.cadence_subject_key) || normaliseSubjectKey(item.title || item.story_id),
  );
  return {
    selected,
    ready_but_unscheduled: unscheduled,
    subject_diversity: {
      max_daily_per_subject: maxPerSubject,
      scheduled_subject_count: new Set(scheduledSubjectKeys).size,
      scheduled_subject_keys: scheduledSubjectKeys,
      deferred_same_subject_count: deferredSameSubjectCount,
      no_repeated_subjects_scheduled:
        scheduledSubjectKeys.length === new Set(scheduledSubjectKeys).size,
    },
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
    const assessedItem = await assessReviewItem(item, thresholds, generatedAt);
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
      freshness: item.freshness,
      upstream_benchmark_status: item.upstream_benchmark_status,
      upstream_benchmark_blockers: asArray(item.upstream_benchmark_blockers),
    }));
  const selection = selectDailyCadenceItems(ready, target, thresholds);
  const selected = selection.selected;
  const readyButUnscheduled = selection.ready_but_unscheduled;
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
      no_repeated_subjects_scheduled: selection.subject_diversity.no_repeated_subjects_scheduled,
      operator_approval_required: true,
    },
    thresholds,
    subject_diversity: selection.subject_diversity,
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

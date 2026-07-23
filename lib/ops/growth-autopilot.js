"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const TARGET_WEEKLY = [7, 10];
const SAFETY = Object.freeze({
  no_publish_triggered: true,
  no_external_posting: true,
  no_db_mutation: true,
  no_oauth_or_token_change: true,
});

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
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isRed(value) {
  return ["red", "blocked", "fail", "failed"].includes(lower(value));
}

function hoursBetween(earlier, later) {
  const start = Date.parse(earlier);
  const end = Date.parse(later);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, (end - start) / 3600000);
}

function qualifyingCadenceCohorts(cohorts = []) {
  return asArray(cohorts).filter((cohort) => {
    const posts = numberOrNull(cohort.posts);
    const medianViews = numberOrNull(cohort.median_views);
    return posts >= TARGET_WEEKLY[0] && posts <= TARGET_WEEKLY[1] && medianViews >= 500;
  });
}

function positiveConversionCohorts(cohorts = []) {
  return asArray(cohorts).filter(
    (cohort) => numberOrNull(cohort.subscribers_gained) > 0,
  );
}

function incident(code, severity, evidence, nextSafeAction, blocksExecution = true) {
  return {
    code,
    severity,
    evidence,
    blocks_execution: blocksExecution,
    next_safe_action: nextSafeAction,
  };
}

function workOrder({
  id,
  lane,
  priority,
  status,
  reason,
  inputs = [],
  safeCommand = null,
  validation = null,
  mode = "LOCAL_PROOF",
  requiresApproval = false,
}) {
  return {
    work_order_id: id,
    lane,
    priority,
    status,
    reason,
    input_requirements: inputs,
    safe_command: safeCommand,
    post_validation_command: validation,
    operating_mode: mode,
    requires_operator_approval: requiresApproval,
    safety: { ...SAFETY },
  };
}

function controlledExperiments({ blocked }) {
  return [
    {
      experiment_id: "short_hook_specificity_v1",
      status: blocked ? "planned_blocked" : "planned_review",
      hypothesis:
        "A named-subject, consequence-led first sentence will improve qualified 48-hour views without reducing retention.",
      changed_field: "hook",
      locked_fields: ["story", "source_evidence", "duration_band", "voice", "visual_family", "publish_window"],
      primary_metric: "qualified_views_48h",
      secondary_metrics: ["average_percentage_viewed", "likes_per_100_views", "subscribers_gained"],
      observation_window_hours: 48,
      minimum_sample: { variants: 2, qualified_views_per_variant: 500 },
      guardrails: [
        "rights_and_policy_verdict_must_remain_green",
        "average_percentage_viewed_must_not_decline_over_10_percent",
        "only_future_outputs_may_adopt_a_winner",
      ],
      stopping_rule:
        "Stop on any safety regression or after both variants reach the minimum sample; require human review before promotion.",
      requires_operator_approval: true,
    },
  ];
}

function buildGrowthAutopilotPlan(snapshot = {}) {
  const generatedAt =
    clean(snapshot.generated_at) || new Date().toISOString();
  const channel = snapshot.channel || {};
  const pipeline = snapshot.pipeline || {};
  const readiness = pipeline.publish_readiness || {};
  const controlTower = pipeline.control_tower || {};
  const cohorts = asArray(snapshot.weekly_cohorts);
  const latestCohort = cohorts[cohorts.length - 1] || {};
  const candidateCount = numberOrNull(pipeline.scheduler_candidate_count) ?? 0;
  const postGapHours = hoursBetween(channel.latest_post_at, generatedAt);
  const qualifying = qualifyingCadenceCohorts(cohorts);
  const conversions = positiveConversionCohorts(cohorts);
  const hasConversionObservation = cohorts.some(
    (cohort) => numberOrNull(cohort.subscribers_gained) !== null,
  );
  const incidents = [];

  if (postGapHours === null) {
    incidents.push(
      incident(
        "latest_post_timestamp_unobserved",
        "amber",
        "No trustworthy latest public post timestamp was supplied.",
        "instrument_publication_cadence",
        false,
      ),
    );
  } else if (postGapHours > 48) {
    incidents.push(
      incident(
        "post_gap_over_48h",
        "red",
        { latest_post_at: channel.latest_post_at, gap_hours: Number(postGapHours.toFixed(1)) },
        "restore_scheduler_candidate",
      ),
    );
  }
  if (candidateCount === 0) {
    incidents.push(
      incident(
        "zero_scheduler_candidates",
        "red",
        { scheduler_candidate_count: 0 },
        "restore_scheduler_candidate",
      ),
    );
  }
  if (isRed(readiness.verdict)) {
    incidents.push(
      incident(
        "strict_publish_readiness_red",
        "red",
        { verdict: readiness.verdict, blockers: asArray(readiness.blockers) },
        "repair_publish_readiness",
      ),
    );
  }
  if (asArray(readiness.blockers).some((blocker) => /runtime.*(?:drift|commit)|commit.*(?:drift|mismatch)/i.test(blocker))) {
    incidents.push(
      incident(
        "runtime_commit_drift",
        "red",
        asArray(readiness.blockers),
        "repair_runtime_ownership",
      ),
    );
  }
  if (isRed(controlTower.verdict)) {
    incidents.push(
      incident(
        "control_tower_not_green",
        "red",
        { verdict: controlTower.verdict },
        "repair_control_tower_blockers",
      ),
    );
  }
  if (!hasConversionObservation) {
    incidents.push(
      incident(
        "subscriber_conversion_unobserved",
        "amber",
        "Weekly cohorts do not contain subscribers_gained evidence.",
        "instrument_subscriber_conversion",
        false,
      ),
    );
  }

  const latestPosts = numberOrNull(latestCohort.posts);
  const recoveryRequired =
    postGapHours === null ||
    postGapHours > 48 ||
    candidateCount === 0 ||
    (latestPosts !== null && latestPosts < 5);
  const cadenceScaleReady = qualifying.length >= 4;
  const conversionScaleReady = conversions.length >= 2;
  let growthPhase = "traction_validation";
  if (recoveryRequired) growthPhase = "cadence_recovery";
  else if (cadenceScaleReady && conversionScaleReady) growthPhase = "scale";

  const hardSafetyBlocked =
    isRed(readiness.verdict) || isRed(controlTower.verdict);
  const executionStatus = hardSafetyBlocked || recoveryRequired
    ? "blocked"
    : growthPhase === "scale"
      ? "eligible"
      : "review_required";
  const experiments = controlledExperiments({
    blocked: executionStatus === "blocked",
  });
  const workOrders = [];

  if (candidateCount === 0 || (postGapHours !== null && postGapHours > 48)) {
    workOrders.push(
      workOrder({
        id: "restore_scheduler_candidate",
        lane: "shorts_cadence_recovery",
        priority: 100,
        status: "ready_local_proof",
        reason: "Public cadence cannot recover until at least one fresh strict-GREEN scheduler candidate exists.",
        inputs: ["fresh_verified_story", "rights_ledger", "final_narration", "word_timestamps", "distinct_motion_families"],
        safeCommand: "npm run ops:candidate-supply",
        validation: "npm run ops:next-publish-candidates",
      }),
    );
  }
  if (hardSafetyBlocked) {
    workOrders.push(
      workOrder({
        id: "repair_publish_readiness",
        lane: "safety_recovery",
        priority: 95,
        status: "blocked_until_repaired",
        reason: "Growth execution is subordinate to strict publish readiness and the Goal 19 control tower.",
        inputs: asArray(readiness.blockers),
        safeCommand: "npm run ops:auto-repair-runner",
        validation: "npm run ops:publish-readiness",
      }),
    );
  }
  if (!hasConversionObservation) {
    workOrders.push(
      workOrder({
        id: "instrument_subscriber_conversion",
        lane: "growth_measurement",
        priority: 80,
        status: "ready_read_only",
        reason: "Views without subscribers_gained evidence cannot prove audience conversion or justify scale.",
        inputs: ["youtube_analytics_readonly_scope", "weekly_video_cohort_mapping"],
        safeCommand: "npm run ops:youtube-analytics-packet",
        validation: "npm run ops:learning-loop -- --dry",
      }),
    );
  }
  workOrders.push(
    workOrder({
      id: "short_hook_specificity_v1",
      lane: "controlled_experiment",
      priority: 60,
      status: executionStatus === "blocked" ? "planned_blocked" : "human_review",
      reason: "Run one controlled hook experiment after cadence and measurement are trustworthy.",
      inputs: ["two_comparable_verified_stories", "locked_non_hook_fields", "48h_metric_window"],
      validation: "npm run ops:goal12-experimentation-engine",
      mode: "HUMAN_REVIEW",
      requiresApproval: true,
    }),
  );
  if (growthPhase === "scale") {
    workOrders.push(
      workOrder({
        id: "fortnightly_longform_recap_pilot",
        lane: "longform",
        priority: 50,
        status: "human_review",
        reason: "Stable Shorts cadence and observed subscriber conversion now support a governed recap pilot.",
        inputs: ["original_editorial_angle", "rights_cleared_media", "longform_readiness_green"],
        validation: "node tools/weekly-longform-readiness.js",
        mode: "HUMAN_REVIEW",
        requiresApproval: true,
      }),
    );
  }
  workOrders.push(
    workOrder({
      id: "x_distribution_pilot",
      lane: "x_distribution",
      priority: 40,
      status: pipeline.platforms?.x?.enabled === true
        ? "human_review"
        : "blocked_platform_disabled",
      reason: "X is a governed distribution and funnel lane, not a substitute for the core YouTube product.",
      inputs: ["platform_enabled", "platform_native_copy", "source_link", "campaign_attribution"],
      mode: "HUMAN_REVIEW",
      requiresApproval: true,
    }),
  );

  return {
    schema_version: 1,
    generated_at: generatedAt,
    channel_id: clean(snapshot.channel_id) || "pulse-gaming",
    growth_phase: growthPhase,
    execution_status: executionStatus,
    verdict: executionStatus === "blocked" ? "RED" : executionStatus === "review_required" ? "AMBER" : "GREEN",
    metrics: {
      subscribers: numberOrNull(channel.subscribers),
      views_28d: numberOrNull(channel.views_28d),
      watch_hours_28d: numberOrNull(channel.watch_hours_28d),
      latest_post_at: clean(channel.latest_post_at) || null,
      latest_post_gap_hours: postGapHours === null ? null : Number(postGapHours.toFixed(1)),
      scheduler_candidate_count: candidateCount,
      weekly_cohort_count: cohorts.length,
      subscriber_conversion_observed: hasConversionObservation,
    },
    cadence: {
      target_weekly: TARGET_WEEKLY,
      recovery_floor_weekly: 3,
      max_daily: 2,
      min_gap_hours: 4,
      qualifying_weeks: qualifying.length,
    },
    incidents,
    next_action: workOrders[0]?.work_order_id || "maintain_governed_growth_loop",
    work_orders: workOrders,
    experiments,
    scale_gates: {
      four_stable_cadence_cohorts: {
        passed: cadenceScaleReady,
        observed: qualifying.length,
        required: 4,
      },
      positive_conversion_cohorts: {
        passed: conversionScaleReady,
        observed: conversions.length,
        required: 2,
      },
      strict_safety_green: {
        passed: !hardSafetyBlocked,
        publish_readiness: clean(readiness.verdict) || "unknown",
        control_tower: clean(controlTower.verdict) || "unknown",
      },
    },
    safety: { ...SAFETY },
  };
}

function renderGrowthAutopilotMarkdown(report = {}) {
  const lines = [
    "# Pulse Gaming Growth Autopilot",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Growth phase: ${report.growth_phase || "unknown"}`,
    `Execution status: ${report.execution_status || "unknown"}`,
    `Verdict: ${report.verdict || "unknown"}`,
    `Next action: ${report.next_action || "none"}`,
    "",
    "## Incidents",
    "",
  ];
  for (const item of asArray(report.incidents)) {
    lines.push(`- ${item.severity.toUpperCase()} ${item.code}: next ${item.next_safe_action}`);
  }
  if (!asArray(report.incidents).length) lines.push("- None");
  lines.push("", "## Ranked work orders", "");
  for (const item of asArray(report.work_orders)) {
    lines.push(`- ${item.priority} ${item.work_order_id} — ${item.status}`);
  }
  lines.push(
    "",
    "## Safety",
    "",
    "No uploads or external posts were triggered. No production database, OAuth token or platform setting was changed.",
    "",
  );
  return lines.join("\n");
}

async function writeGrowthAutopilotArtefacts({
  report,
  outDir,
} = {}) {
  if (!report || !outDir) throw new Error("report and outDir are required");
  await fs.ensureDir(outDir);
  const files = {
    report_json: path.join(outDir, "growth_autopilot_report.json"),
    report_markdown: path.join(outDir, "growth_autopilot_report.md"),
    work_orders: path.join(outDir, "growth_work_orders.json"),
    experiment_registry: path.join(outDir, "growth_experiment_registry.json"),
  };
  await Promise.all([
    fs.writeJson(files.report_json, report, { spaces: 2 }),
    fs.writeFile(files.report_markdown, renderGrowthAutopilotMarkdown(report)),
    fs.writeJson(files.work_orders, {
      schema_version: 1,
      generated_at: report.generated_at,
      channel_id: report.channel_id,
      work_orders: report.work_orders,
    }, { spaces: 2 }),
    fs.writeJson(files.experiment_registry, {
      schema_version: 1,
      generated_at: report.generated_at,
      channel_id: report.channel_id,
      experiments: report.experiments,
    }, { spaces: 2 }),
  ]);
  return files;
}

module.exports = {
  SAFETY,
  TARGET_WEEKLY,
  buildGrowthAutopilotPlan,
  renderGrowthAutopilotMarkdown,
  writeGrowthAutopilotArtefacts,
};

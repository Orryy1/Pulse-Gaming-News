"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

function clean(value) {
  return String(value || "").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values = []) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function storyId(value = {}) {
  return clean(value.story_id || value.id || value.storyId);
}

function enabledCorePlatformConfig() {
  return {
    youtube: { state: "enabled", reason: "core_upload_path" },
    instagram_reel: { state: "enabled", reason: "graph_credentials_present" },
    facebook_reel: { state: "enabled", reason: "facebook_reels_enabled" },
    tiktok: { state: "needs_credentials", reason: "operator_token_setup_required" },
    twitter: { state: "disabled", reason: "operator_disabled" },
    threads: { state: "disabled", reason: "operator_disabled" },
    pinterest: { state: "disabled", reason: "operator_disabled" },
  };
}

function defaultDependencies() {
  const {
    buildProductionRenderCutoverPlan,
  } = require("../goal-production-cutover");
  const {
    buildNextPublishCandidatesReport,
    attachPreflightQa,
  } = require("../../tools/next-publish-candidates");
  const {
    buildGoalDryRunPublishPlan,
  } = require("../goal-dry-run-publisher");
  return {
    buildProductionRenderCutoverPlan,
    buildNextPublishCandidatesReport,
    attachPreflightQa,
    buildGoalDryRunPublishPlan,
  };
}

function blockerRows({
  cutover = {},
  candidateReport = {},
  dryRunPlan = {},
} = {}) {
  const rows = [];
  const push = (id, blocker) => {
    const cleanBlocker = clean(blocker);
    if (!cleanBlocker) return;
    rows.push(`${clean(id) || "unknown"}:${cleanBlocker}`);
  };

  for (const row of [...asArray(cutover.blocked), ...asArray(cutover.queue)]) {
    const id = storyId(row);
    for (const blocker of [
      ...asArray(row.blockers),
      ...asArray(row.render_input_blockers),
    ]) {
      push(id, blocker);
    }
  }
  for (const row of asArray(candidateReport.candidates)) {
    const id = storyId(row);
    for (const blocker of [
      ...asArray(row.preflight_qa?.blockers),
      ...asArray(row.preflight_qa?.failures),
    ]) {
      push(id, blocker);
    }
  }
  for (const row of asArray(candidateReport.excluded)) {
    push(storyId(row), row.reason || row.status || "scheduler_candidate_excluded");
  }
  for (const row of asArray(dryRunPlan.blocked_stories)) {
    for (const blocker of asArray(row.blockers)) push(storyId(row), blocker);
  }
  for (const row of asArray(dryRunPlan.held_stories)) {
    for (const blocker of [
      ...asArray(row.blockers),
      ...asArray(row.hold_reasons),
    ]) {
      push(storyId(row), blocker);
    }
  }

  const bridgeCandidates = asArray(cutover.scheduler_bridge?.candidates);
  if (!bridgeCandidates.length) rows.push("scheduler_bridge:no_ready_candidates");
  const enabledActions = asArray(dryRunPlan.actions).filter(
    (action) =>
      action?.platform_enabled === true &&
      action?.autonomous_green_lit_by_dry_run === true &&
      asArray(action?.blockers).length === 0,
  );
  if (!enabledActions.length) rows.push("strict_dry_run:no_enabled_actions");
  return unique(rows);
}

function incidentFingerprint({ attemptedStoryIds = [], blockers = [], target = 1 } = {}) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        attempted_story_ids: unique(attemptedStoryIds).sort(),
        strict_blockers: unique(blockers).sort(),
        minimum_new_green_candidates: Number(target || 0),
      }),
    )
    .digest("hex");
}

function renderMarkdown(report = {}) {
  const lines = [
    "# Fresh Production Refill Outcome",
    "",
    `Generated: ${report.generated_at}`,
    `Status: ${report.status}`,
    `Outcome: ${report.outcome}`,
    `Local package GREEN: ${report.local_package_green_count}`,
    `Strict scheduler GREEN: ${report.strict_green_count}`,
    `Target: ${report.minimum_new_green_candidates}`,
    `Shortfall: ${report.shortfall}`,
    `Target met: ${report.target_met ? "yes" : "no"}`,
    "",
    "## Strict Blockers",
    "",
  ];
  if (report.strict_blockers.length) {
    for (const blocker of report.strict_blockers) lines.push(`- ${blocker}`);
  } else {
    lines.push("- None");
  }
  lines.push(
    "",
    "Safety: read-only verification only. This report does not authorise publishing.",
    "",
  );
  return lines.join("\n");
}

async function evaluateFreshProductionRefillOutcome({
  storyPackages = [],
  localPackageGreenCount = 0,
  minimumNewGreenCandidates = 1,
  parentJobId = null,
  generatedAt = new Date().toISOString(),
  outputDir,
  platformOperationalConfig = null,
  dependencies = null,
} = {}) {
  if (!clean(outputDir)) {
    throw new Error("evaluateFreshProductionRefillOutcome requires outputDir");
  }
  const target = Math.max(1, Number(minimumNewGreenCandidates || 1) || 1);
  const attemptedStoryIds = unique(asArray(storyPackages).map(storyId));
  const deps = {
    ...defaultDependencies(),
    ...(dependencies || {}),
  };
  const platformConfig = platformOperationalConfig || enabledCorePlatformConfig();

  const cutover = await deps.buildProductionRenderCutoverPlan({
    storyPackages,
    generatedAt,
  });
  const bridgeCandidates = asArray(cutover.scheduler_bridge?.candidates);
  const candidateReport = deps.buildNextPublishCandidatesReport(
    bridgeCandidates,
    {
      generatedAt,
      limit: Math.max(target, bridgeCandidates.length, 1),
      platformOperationalConfig: platformConfig,
    },
  );
  await deps.attachPreflightQa(candidateReport, bridgeCandidates, {
    generatedAt,
    platformOperationalConfig: platformConfig,
    enabledPlatformNames: [
      "youtube_shorts",
      "instagram_reels",
      "facebook_reels",
    ],
    mediaHouseQaEnabled: true,
  });
  const dryRunPlan = await deps.buildGoalDryRunPublishPlan({
    storyPackages: bridgeCandidates,
    generatedAt,
    candidatePreflightReport: candidateReport,
    requireSchedulerPreflight: true,
    platformOperationalConfig: platformConfig,
  });

  const enabledStrictActions = asArray(dryRunPlan.actions).filter(
    (action) =>
      action?.platform_enabled === true &&
      action?.autonomous_green_lit_by_dry_run === true &&
      asArray(action?.blockers).length === 0,
  );
  const readyStoryIds = new Set(
    asArray(dryRunPlan.ready_stories).map(storyId).filter(Boolean),
  );
  const strictGreenStoryIds = unique(
    enabledStrictActions
      .map(storyId)
      .filter((id) => readyStoryIds.has(id)),
  );
  const strictBlockers = blockerRows({
    cutover,
    candidateReport,
    dryRunPlan,
  });
  const strictGreenCount = strictGreenStoryIds.length;
  const targetMet = strictGreenCount >= target;
  const shortfall = Math.max(0, target - strictGreenCount);
  const outputRoot = path.resolve(outputDir);
  await fs.ensureDir(outputRoot);

  const report = {
    schema_version: 1,
    generated_at: generatedAt,
    parent_job_id: parentJobId,
    status: targetMet ? "completed" : "incident",
    outcome: strictGreenCount > 0
      ? targetMet
        ? "strict_green_yield"
        : "strict_green_shortfall"
      : "zero_strict_green_yield",
    local_package_green_count: Number(localPackageGreenCount || 0),
    strict_green_count: strictGreenCount,
    enabled_strict_action_count: enabledStrictActions.length,
    minimum_new_green_candidates: target,
    shortfall,
    target_met: targetMet,
    attempted_story_ids: attemptedStoryIds,
    strict_green_story_ids: strictGreenStoryIds,
    strict_blockers: strictBlockers,
    incident_fingerprint: incidentFingerprint({
      attemptedStoryIds,
      blockers: strictBlockers,
      target,
    }),
    evidence: {
      cutover_summary: cutover.summary || null,
      scheduler_bridge_status: cutover.scheduler_bridge?.status || null,
      scheduler_bridge_candidate_count: bridgeCandidates.length,
      scheduler_preflight_summary: candidateReport.preflight_qa || null,
      strict_dry_run_summary: dryRunPlan.summary || null,
    },
    safety: {
      read_only: true,
      publish_authorised: false,
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
      disabled_platforms_unchanged: true,
      gates_weakened: false,
    },
  };

  const reportPath = path.join(outputRoot, "fresh_production_refill_outcome.json");
  const markdownPath = path.join(outputRoot, "fresh_production_refill_outcome.md");
  let incidentReportPath = null;
  let incidentBlockersPath = null;
  if (!targetMet) {
    incidentReportPath = path.join(outputRoot, "incident_report.json");
    incidentBlockersPath = path.join(outputRoot, "incident_blockers.json");
    await fs.writeJson(incidentReportPath, report, { spaces: 2 });
    await fs.writeJson(
      incidentBlockersPath,
      {
        schema_version: 1,
        generated_at: generatedAt,
        parent_job_id: parentJobId,
        incident_fingerprint: report.incident_fingerprint,
        outcome: report.outcome,
        attempted_story_ids: attemptedStoryIds,
        strict_blockers: strictBlockers,
        shortfall,
        safety: report.safety,
      },
      { spaces: 2 },
    );
  }
  report.outputs = {
    report: reportPath,
    markdown: markdownPath,
    incident_report: incidentReportPath,
    incident_blockers: incidentBlockersPath,
  };
  await fs.writeJson(reportPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");
  return report;
}

module.exports = {
  evaluateFreshProductionRefillOutcome,
  enabledCorePlatformConfig,
  incidentFingerprint,
  blockerRows,
};

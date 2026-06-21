"use strict";

const path = require("node:path");
const fs = require("fs-extra");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return Array.from(new Set(asArray(values).map(clean).filter(Boolean)));
}

function normalisePath(value) {
  return clean(value).replace(/\\/g, "/").toLowerCase();
}

function actionKey(action = {}) {
  return `${clean(action.story_id)}:${clean(action.platform)}`;
}

function dryRunSafetyIsIntact(plan = {}) {
  const safety = plan.safety || {};
  return (
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true &&
    safety.dry_run_only === true
  );
}

function approvalGateSafetyIsIntact(report = {}) {
  const safety = report.safety || {};
  const planSafety = report.safe_publish_plan?.safety || {};
  return (
    report.safe_to_publish_boolean === false &&
    report.safe_publish_plan?.live_publish_allowed_from_this_tool === false &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true &&
    planSafety.no_publish_triggered === true &&
    planSafety.no_network_uploads === true &&
    planSafety.no_db_mutation === true &&
    planSafety.no_oauth_or_token_change === true
  );
}

function platformStatusSafetyIsIntact(report = {}) {
  const safety = report.safety || {};
  return (
    safety.dry_run_only === true &&
    safety.no_network_uploads === true &&
    safety.no_public_posts === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true
  );
}

function approvedActionsFrom(report = {}) {
  const direct = asArray(report.approved_actions);
  if (direct.length) return direct;
  return asArray(report.safe_publish_plan?.approved_actions);
}

function autonomousDryRunActionsFrom(plan = {}, manualActions = []) {
  const manualKeys = new Set(asArray(manualActions).map(actionKey));
  const generatedAt = clean(plan.generated_at);
  return asArray(plan.actions)
    .filter((action) =>
      clean(action.action) === "would_publish" &&
      action.platform_enabled === true &&
      action.requires_human_review_before_live_publish !== true &&
      clean(action.live_execution_gate) === "guarded_dispatch_ready" &&
      action.autonomous_green_lit_by_dry_run === true &&
      action.live_publish_allowed_from_dry_run === false &&
      action.requires_guarded_dispatch_command === true &&
      action.requires_enabled_platform_recheck === true &&
      asArray(action.blockers).length === 0 &&
      asArray(action.warnings).length === 0 &&
      !manualKeys.has(actionKey(action))
    )
    .map((action) => ({
      story_id: clean(action.story_id),
      platform: clean(action.platform),
      title: clean(action.title),
      operator: "autonomous_green_dry_run",
      operator_decided_at: generatedAt,
      decision: "autonomous_green_dry_run",
      video_path: clean(action.video_path),
      captions_path: clean(action.captions_path),
      first_frame_source: clean(action.cover_frame_source || action.video_path),
      canonical_manifest_path: clean(action.canonical_manifest_path),
      platform_publish_manifest_path: clean(action.platform_publish_manifest_path),
      live_publish_allowed_from_gate: false,
      requires_guarded_dispatch_command: true,
      requires_enabled_platform_recheck: true,
      autonomous_green_lit_by_dry_run: true,
    }));
}

function currentDryRunActionByKey(plan = {}) {
  const map = new Map();
  for (const action of asArray(plan.actions)) {
    if (clean(action.action) !== "would_publish") continue;
    const key = actionKey(action);
    if (!key.includes(":")) continue;
    map.set(key, action);
  }
  return map;
}

function alreadyPublishedActionKeysFrom(plan = {}) {
  const keys = new Set();
  for (const story of asArray(plan.ready_stories)) {
    const storyId = clean(story.story_id);
    if (!storyId) continue;
    for (const platform of unique([
      ...asArray(story.already_published_platforms),
      ...asArray(story.published_platforms),
      ...asArray(story.skip_platforms),
    ])) {
      keys.add(`${storyId}:${platform}`);
    }
  }
  return keys;
}

function transcriptAudienceRowsByStory(report = {}) {
  const map = new Map();
  for (const story of asArray(report.stories)) {
    const storyId = clean(story.story_id || story.id);
    if (!storyId) continue;
    if (!map.has(storyId)) map.set(storyId, []);
    map.get(storyId).push(story);
  }
  return map;
}

function dirOf(filePath = "") {
  const value = clean(filePath);
  return value ? path.dirname(value) : "";
}

function resolveTranscriptAudienceRow({ rowsByStory = new Map(), action = {}, strictAction = null } = {}) {
  const rows = asArray(rowsByStory.get(clean(action.story_id)));
  if (rows.length <= 1) return rows[0] || null;

  const currentDirs = unique([
    dirOf(action.canonical_manifest_path),
    dirOf(strictAction?.canonical_manifest_path),
    dirOf(action.platform_publish_manifest_path),
    dirOf(strictAction?.platform_publish_manifest_path),
  ]);
  const exact = rows.find((row) =>
    currentDirs.some((dir) => dir && pathMatches(row.artifact_dir, dir)),
  );
  if (exact) return exact;

  return rows[rows.length - 1] || null;
}

function fileExistsWithMinimumBytes(filePath, minBytes = 1024) {
  const resolved = clean(filePath);
  if (!resolved || !fs.existsSync(resolved)) return false;
  try {
    return fs.statSync(resolved).size >= minBytes;
  } catch {
    return false;
  }
}

function pathMatches(left, right) {
  return normalisePath(left) === normalisePath(right);
}

function validateApprovedAction({
  action = {},
  strictAction = null,
  platformStatusMatrix = {},
  transcriptAudienceRow = null,
  transcriptAudienceReportPresent = false,
} = {}) {
  const blockers = [];
  const storyId = clean(action.story_id);
  const platform = clean(action.platform);
  const platformStatus = platformStatusMatrix.platforms?.[platform] || null;

  if (!storyId) blockers.push("approved_action_missing_story_id");
  if (!platform) blockers.push("approved_action_missing_platform");
  if (action.live_publish_allowed_from_gate !== false) {
    blockers.push("approval_gate_live_publish_flag_not_false");
  }
  if (action.requires_guarded_dispatch_command !== true) {
    blockers.push("approval_missing_guarded_dispatch_requirement");
  }
  if (action.requires_enabled_platform_recheck !== true) {
    blockers.push("approval_missing_platform_recheck_requirement");
  }

  if (!strictAction) {
    blockers.push("approved_action_missing_from_current_strict_dry_run");
  } else {
    if (strictAction.platform_enabled !== true) blockers.push(`strict_dry_run_platform_not_enabled:${platform}`);
    if (strictAction.live_publish_allowed_from_dry_run !== false) {
      blockers.push("strict_dry_run_live_publish_flag_not_false");
    }
    if (!pathMatches(action.video_path, strictAction.video_path)) blockers.push("video_path_mismatch_with_strict_dry_run");
    if (!pathMatches(action.captions_path, strictAction.captions_path)) {
      blockers.push("captions_path_mismatch_with_strict_dry_run");
    }
    if (!pathMatches(action.first_frame_source, strictAction.cover_frame_source || strictAction.video_path)) {
      blockers.push("first_frame_source_mismatch_with_strict_dry_run");
    }
  }

  if (!platformStatus) {
    blockers.push(`platform_status_missing:${platform || "missing"}`);
  } else {
    if (clean(platformStatus.status) !== "ready_now") blockers.push(`platform_not_ready_now:${platform}`);
    if (clean(platformStatus.operational_state) !== "enabled") blockers.push(`platform_not_enabled:${platform}`);
    if (Number(platformStatus.blocked_action_count || 0) > 0) blockers.push(`platform_has_blocked_actions:${platform}`);
    if (Number(platformStatus.deferred_action_count || 0) > 0) blockers.push(`platform_has_deferred_actions:${platform}`);
    if (!asArray(platformStatus.planned_story_ids).map(clean).includes(storyId)) {
      blockers.push(`platform_status_missing_story:${platform}`);
    }
  }

  if (transcriptAudienceReportPresent) {
    if (!transcriptAudienceRow) {
      blockers.push("transcript_audience_missing_current_story");
    } else if (clean(transcriptAudienceRow.verdict) !== "pass") {
      const reason = asArray(transcriptAudienceRow.blockers)[0] || "rewrite_required";
      blockers.push(`transcript_audience:${reason}`);
    }
  }

  if (!fileExistsWithMinimumBytes(action.video_path)) blockers.push("video_path_missing_or_too_small");
  if (!fileExistsWithMinimumBytes(action.captions_path, 1)) blockers.push("captions_path_missing_or_empty");
  if (!fileExistsWithMinimumBytes(action.first_frame_source)) blockers.push("first_frame_source_missing_or_too_small");
  if (!fileExistsWithMinimumBytes(action.canonical_manifest_path, 1)) blockers.push("canonical_manifest_missing");
  if (!fileExistsWithMinimumBytes(action.platform_publish_manifest_path, 1)) blockers.push("platform_publish_manifest_missing");

  return unique(blockers);
}

function isStaleApprovalOnlyBlockers(blockers = []) {
  const rows = unique(blockers);
  return rows.length > 0 && rows.every((blocker) =>
    blocker === "approved_action_missing_from_current_strict_dry_run" ||
    /^platform_status_missing_story:/i.test(blocker)
  );
}

function buildDispatchReadyAction(action = {}) {
  return {
    story_id: clean(action.story_id),
    platform: clean(action.platform),
    title: clean(action.title),
    operator: clean(action.operator),
    operator_decided_at: clean(action.operator_decided_at),
    video_path: clean(action.video_path),
    captions_path: clean(action.captions_path),
    first_frame_source: clean(action.first_frame_source),
    canonical_manifest_path: clean(action.canonical_manifest_path),
    platform_publish_manifest_path: clean(action.platform_publish_manifest_path),
    live_publish_allowed_from_preflight: false,
    requires_guarded_live_dispatch_executor: true,
    requires_last_second_kill_switch_check: true,
    requires_last_second_platform_recheck: true,
  };
}

function buildGuardedDispatchPreflight({
  approvalGateReport = {},
  strictDryRunPlan = {},
  platformStatusMatrix = {},
  transcriptAudienceReport = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const approvedActions = approvedActionsFrom(approvalGateReport);
  const autonomousDryRunActions = autonomousDryRunActionsFrom(strictDryRunPlan, approvedActions);
  const candidateActions = [...approvedActions, ...autonomousDryRunActions];
  const strictActions = currentDryRunActionByKey(strictDryRunPlan);
  const alreadyPublishedActionKeys = alreadyPublishedActionKeysFrom(strictDryRunPlan);
  const transcriptRows = transcriptAudienceRowsByStory(transcriptAudienceReport || {});
  const transcriptAudienceReportPresent = !!transcriptAudienceReport;
  const blockedActions = [];
  const staleApprovalActions = [];
  const heldActions = [];
  const dispatchReadyActions = [];
  const ignoredAlreadyPublishedActions = [];
  const safetyBlockers = [];

  if (!approvalGateSafetyIsIntact(approvalGateReport)) {
    safetyBlockers.push("approval_gate_safety_contract_failed");
  }
  if (!dryRunSafetyIsIntact(strictDryRunPlan)) {
    safetyBlockers.push("strict_dry_run_safety_contract_failed");
  }
  if (!platformStatusSafetyIsIntact(platformStatusMatrix)) {
    safetyBlockers.push("platform_status_matrix_safety_contract_failed");
  }

  for (const action of candidateActions) {
    const key = actionKey(action);
    const strictAction = strictActions.get(key);
    if (alreadyPublishedActionKeys.has(key)) {
      ignoredAlreadyPublishedActions.push({
        story_id: clean(action.story_id),
        platform: clean(action.platform),
        title: clean(action.title),
        reason: "already_published_platform_action",
      });
      continue;
    }
    const blockers = validateApprovedAction({
      action,
      strictAction,
      platformStatusMatrix,
      transcriptAudienceRow: resolveTranscriptAudienceRow({ rowsByStory: transcriptRows, action, strictAction }),
      transcriptAudienceReportPresent,
    });
    if (safetyBlockers.length) blockers.push(...safetyBlockers);
    if (blockers.length) {
      const row = {
        story_id: clean(action.story_id),
        platform: clean(action.platform),
        title: clean(action.title),
        blockers: unique(blockers),
      };
      const holdOnly = row.blockers.every((blocker) => clean(blocker).startsWith("transcript_audience"));
      if (holdOnly) {
        heldActions.push({
          ...row,
          reason: "transcript_audience_repair_required",
        });
      } else if (isStaleApprovalOnlyBlockers(row.blockers)) {
        staleApprovalActions.push({
          ...row,
          reason: "stale_approval_not_in_current_strict_dry_run",
        });
      } else {
        blockedActions.push(row);
      }
    } else {
      dispatchReadyActions.push(buildDispatchReadyAction(action));
    }
  }

  const advisory = [];
  if (staleApprovalActions.length && dispatchReadyActions.length) {
    heldActions.push(...staleApprovalActions);
    advisory.push("stale_operator_approved_actions_held_outside_current_dispatch_scope");
  } else {
    blockedActions.push(...staleApprovalActions);
  }

  if (!approvedActions.length && !autonomousDryRunActions.length) advisory.push("no_operator_approved_actions");
  if (autonomousDryRunActions.length) advisory.push("autonomous_green_dry_run_actions_used");
  if (ignoredAlreadyPublishedActions.length) advisory.push("approved_already_published_actions_ignored");
  if (!transcriptAudienceReportPresent) advisory.push("transcript_audience_report_missing");
  const transcriptHeldActionCount = heldActions.filter((action) =>
    asArray(action.blockers).some((blocker) => clean(blocker).startsWith("transcript_audience")),
  ).length;
  const verdict = blockedActions.length
    ? "RED"
    : dispatchReadyActions.length
      ? "GREEN"
      : "AMBER";
  const guardedDispatchPlan = {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "GUARDED_DISPATCH_PREFLIGHT",
    ready_for_guarded_dispatch: verdict === "GREEN" && dispatchReadyActions.length > 0,
    live_publish_allowed_from_this_tool: false,
    dispatch_ready_action_count: dispatchReadyActions.length,
    blocked_action_count: blockedActions.length,
    held_action_count: heldActions.length,
    transcript_held_action_count: transcriptHeldActionCount,
    ignored_already_published_action_count: ignoredAlreadyPublishedActions.length,
    dispatch_ready_actions: dispatchReadyActions,
    held_actions: heldActions,
    ignored_already_published_actions: ignoredAlreadyPublishedActions,
    required_next_step:
      verdict === "GREEN"
        ? "run_guarded_live_dispatch_executor_with_kill_switch_and_final_platform_recheck"
        : blockedActions.length
          ? "repair_guarded_dispatch_preflight_blockers"
          : "record_operator_approved_actions_before_guarded_dispatch",
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "GUARDED_DISPATCH_PREFLIGHT",
    verdict,
    safe_to_publish_boolean: false,
    summary: {
      approved_action_count: approvedActions.length,
      autonomous_dry_run_action_count: autonomousDryRunActions.length,
      dispatch_ready_action_count: dispatchReadyActions.length,
      blocked_action_count: blockedActions.length,
      held_action_count: heldActions.length,
      transcript_held_action_count: transcriptHeldActionCount,
      ignored_already_published_action_count: ignoredAlreadyPublishedActions.length,
      safety_blocker_count: safetyBlockers.length,
    },
    dispatch_ready_actions: dispatchReadyActions,
    held_actions: heldActions,
    blocked_actions: blockedActions,
    ignored_already_published_actions: ignoredAlreadyPublishedActions,
    advisory,
    guarded_dispatch_plan: guardedDispatchPlan,
    safety: guardedDispatchPlan.safety,
  };
}

function renderGuardedDispatchPreflightMarkdown(report = {}) {
  const lines = [
    "# Guarded Dispatch Preflight",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${report.verdict || "UNKNOWN"}`,
    `Approved actions checked: ${report.summary?.approved_action_count || 0}`,
    `Dispatch-ready actions: ${report.summary?.dispatch_ready_action_count || 0}`,
    `Blocked actions: ${report.summary?.blocked_action_count || 0}`,
    `Held actions: ${report.summary?.held_action_count || 0}`,
    `Already-published approvals ignored: ${report.summary?.ignored_already_published_action_count || 0}`,
    "No uploads are triggered. No database rows, OAuth settings or token files are changed.",
    "",
  ];
  if (asArray(report.dispatch_ready_actions).length) {
    lines.push("## Dispatch-Ready After Preflight", "");
    for (const action of asArray(report.dispatch_ready_actions)) {
      lines.push(`- ${action.story_id} -> ${action.platform}: ${action.title}`);
    }
    lines.push("");
  }
  if (asArray(report.ignored_already_published_actions).length) {
    lines.push("## Already Published Approvals Ignored", "");
    for (const action of asArray(report.ignored_already_published_actions)) {
      lines.push(`- ${action.story_id || "unknown"} -> ${action.platform || "unknown"}: ${action.reason || "already_published_platform_action"}`);
    }
    lines.push("");
  }
  if (asArray(report.held_actions).length) {
    lines.push("## Held For Repair", "");
    for (const action of asArray(report.held_actions)) {
      lines.push(`- ${action.story_id || "unknown"} -> ${action.platform || "unknown"}: ${asArray(action.blockers).join(", ")}`);
    }
    lines.push("");
  }
  if (asArray(report.blocked_actions).length) {
    lines.push("## Blocked", "");
    for (const action of asArray(report.blocked_actions)) {
      lines.push(`- ${action.story_id || "unknown"} -> ${action.platform || "unknown"}: ${asArray(action.blockers).join(", ")}`);
    }
    lines.push("");
  }
  if (asArray(report.advisory).length) {
    lines.push("## Advisory", "");
    for (const item of asArray(report.advisory)) lines.push(`- ${item}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function writeGuardedDispatchPreflight(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGuardedDispatchPreflight requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const reportPath = path.join(outDir, "guarded_dispatch_preflight_report.json");
  const guardedDispatchPlanPath = path.join(outDir, "guarded_dispatch_plan.json");
  const markdownPath = path.join(outDir, "guarded_dispatch_preflight.md");
  await fs.writeJson(reportPath, report, { spaces: 2 });
  await fs.writeJson(guardedDispatchPlanPath, report.guarded_dispatch_plan || {}, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGuardedDispatchPreflightMarkdown(report), "utf8");
  return {
    outputDir: outDir,
    reportPath,
    guardedDispatchPlanPath,
    markdownPath,
  };
}

module.exports = {
  buildGuardedDispatchPreflight,
  renderGuardedDispatchPreflightMarkdown,
  writeGuardedDispatchPreflight,
};

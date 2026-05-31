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

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(clean(value));
}

function actionId(action = {}) {
  return `${clean(action.story_id)}:${clean(action.platform)}`;
}

function platformStatusFor(matrix = {}, platform) {
  return matrix.platforms?.[platform] || null;
}

function platformBlockers({ matrix = {}, action = {} } = {}) {
  const blockers = [];
  const platform = clean(action.platform);
  const storyId = clean(action.story_id);
  const status = platformStatusFor(matrix, platform);

  if (!status) {
    blockers.push(`platform_status_missing:${platform || "missing"}`);
    return blockers;
  }
  if (clean(status.status) !== "ready_now") blockers.push(`platform_not_ready_now:${platform}`);
  if (clean(status.operational_state) !== "enabled") blockers.push(`platform_not_enabled:${platform}`);
  if (Number(status.blocked_action_count || 0) > 0) blockers.push(`platform_has_blocked_actions:${platform}`);
  if (Number(status.deferred_action_count || 0) > 0) blockers.push(`platform_has_deferred_actions:${platform}`);
  if (!asArray(status.planned_story_ids).map(clean).includes(storyId)) {
    blockers.push(`platform_status_missing_story:${platform}`);
  }
  return blockers;
}

function platformMatrixSafetyOk(matrix = {}) {
  const safety = matrix.safety || {};
  return (
    safety.dry_run_only === true &&
    safety.no_network_uploads === true &&
    safety.no_public_posts === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true
  );
}

function guardedDispatchPlanSafetyOk(plan = {}) {
  const safety = plan.safety || {};
  return (
    plan.live_publish_allowed_from_this_tool === false &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true
  );
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

function evidenceBlockers(action = {}) {
  const blockers = [];
  if (!fileExistsWithMinimumBytes(action.video_path)) blockers.push("video_path_missing_or_too_small");
  if (!fileExistsWithMinimumBytes(action.first_frame_source || action.video_path)) {
    blockers.push("first_frame_source_missing_or_too_small");
  }
  if (!fileExistsWithMinimumBytes(action.captions_path, 1)) blockers.push("captions_path_missing_or_empty");
  if (!fileExistsWithMinimumBytes(action.canonical_manifest_path, 1)) blockers.push("canonical_manifest_missing");
  if (!fileExistsWithMinimumBytes(action.platform_publish_manifest_path, 1)) {
    blockers.push("platform_publish_manifest_missing");
  }
  return blockers;
}

function executorState(env = {}) {
  const enabled = truthy(env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED);
  const killSwitch = clean(env.PULSE_EMERGENCY_KILL_SWITCH || env.PULSE_KILL_SWITCH || "unknown").toLowerCase();
  return {
    guarded_live_dispatch_enabled: enabled,
    emergency_kill_switch_state: killSwitch,
  };
}

function validateSelectedAction({
  action = {},
  guardedDispatchPlan = {},
  platformStatusMatrix = {},
  state = {},
} = {}) {
  const blockers = [];
  if (state.guarded_live_dispatch_enabled !== true) blockers.push("guarded_live_dispatch_not_armed");
  if (state.emergency_kill_switch_state !== "clear") blockers.push("emergency_kill_switch_not_clear");
  if (!guardedDispatchPlanSafetyOk(guardedDispatchPlan)) {
    blockers.push("guarded_dispatch_plan_safety_contract_failed");
  }
  if (!platformMatrixSafetyOk(platformStatusMatrix)) {
    blockers.push("platform_status_matrix_safety_contract_failed");
  }
  if (action.live_publish_allowed_from_preflight !== false) {
    blockers.push("dispatch_preflight_live_publish_flag_not_false");
  }
  if (action.requires_guarded_live_dispatch_executor !== true) {
    blockers.push("missing_live_executor_requirement");
  }
  if (action.requires_last_second_kill_switch_check !== true) {
    blockers.push("missing_last_second_kill_switch_requirement");
  }
  if (action.requires_last_second_platform_recheck !== true) {
    blockers.push("missing_last_second_platform_recheck_requirement");
  }
  blockers.push(...platformBlockers({ matrix: platformStatusMatrix, action }));
  blockers.push(...evidenceBlockers(action));
  return unique(blockers);
}

function buildHandoffAction(action = {}) {
  return {
    action_id: actionId(action),
    story_id: clean(action.story_id),
    platform: clean(action.platform),
    title: clean(action.title),
    video_path: clean(action.video_path),
    captions_path: clean(action.captions_path),
    first_frame_source: clean(action.first_frame_source),
    canonical_manifest_path: clean(action.canonical_manifest_path),
    platform_publish_manifest_path: clean(action.platform_publish_manifest_path),
    live_publish_allowed_from_preflight_only: false,
    requires_live_executor_command: true,
    requires_last_second_kill_switch_check: true,
    requires_last_second_platform_recheck: true,
  };
}

function buildGuardedDispatchExecutorPreflight({
  guardedDispatchPlan = {},
  platformStatusMatrix = {},
  selectedActionIds = [],
  env = process.env,
  generatedAt = new Date().toISOString(),
} = {}) {
  const dispatchReadyActions = asArray(guardedDispatchPlan.dispatch_ready_actions);
  const actionById = new Map(dispatchReadyActions.map((action) => [actionId(action), action]));
  const selected = unique(selectedActionIds);
  const state = executorState(env);
  const advisory = [];
  const blockedSelectedActions = [];
  const handoffReadyActions = [];

  if (!dispatchReadyActions.length) advisory.push("no_dispatch_ready_actions");
  if (dispatchReadyActions.length && !selected.length) advisory.push("explicit_action_ids_required");

  for (const id of selected) {
    const action = actionById.get(id);
    if (!action) {
      blockedSelectedActions.push({
        action_id: id,
        story_id: clean(id.split(":")[0]),
        platform: clean(id.split(":").slice(1).join(":")),
        blockers: ["selected_action_not_dispatch_ready"],
      });
      continue;
    }
    const blockers = validateSelectedAction({
      action,
      guardedDispatchPlan,
      platformStatusMatrix,
      state,
    });
    if (blockers.length) {
      blockedSelectedActions.push({
        action_id: id,
        story_id: clean(action.story_id),
        platform: clean(action.platform),
        title: clean(action.title),
        blockers,
      });
    } else {
      handoffReadyActions.push(buildHandoffAction(action));
    }
  }

  const verdict = blockedSelectedActions.length
    ? "RED"
    : handoffReadyActions.length
      ? "GREEN"
      : "AMBER";
  const requiredNextStep = verdict === "GREEN"
    ? "run_guarded_live_dispatch_executor"
    : blockedSelectedActions.length
      ? "repair_executor_preflight_blockers"
      : dispatchReadyActions.length
        ? "select_explicit_dispatch_action_ids"
        : "record_operator_approved_actions_before_guarded_dispatch";

  const executorPlan = {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT",
    ready_for_live_executor_handoff: verdict === "GREEN" && handoffReadyActions.length > 0,
    live_publish_allowed_from_this_tool: false,
    required_next_step: requiredNextStep,
    handoff_ready_action_count: handoffReadyActions.length,
    blocked_selected_action_count: blockedSelectedActions.length,
    handoff_ready_actions: handoffReadyActions,
    blocked_selected_actions: blockedSelectedActions,
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
    mode: "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT",
    verdict,
    safe_to_publish_boolean: false,
    executor_state: state,
    summary: {
      dispatch_ready_action_count: dispatchReadyActions.length,
      selected_action_count: selected.length,
      handoff_ready_action_count: handoffReadyActions.length,
      blocked_selected_action_count: blockedSelectedActions.length,
    },
    handoff_ready_actions: handoffReadyActions,
    blocked_selected_actions: blockedSelectedActions,
    advisory,
    executor_plan: executorPlan,
    safety: executorPlan.safety,
  };
}

function renderGuardedDispatchExecutorPreflightMarkdown(report = {}) {
  const lines = [
    "# Guarded Dispatch Executor Preflight",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${report.verdict || "UNKNOWN"}`,
    `Selected actions: ${report.summary?.selected_action_count || 0}`,
    `Handoff-ready actions: ${report.summary?.handoff_ready_action_count || 0}`,
    `Blocked selected actions: ${report.summary?.blocked_selected_action_count || 0}`,
    "No uploads are triggered. No database rows, OAuth settings or token files are changed.",
    "",
  ];
  if (asArray(report.handoff_ready_actions).length) {
    lines.push("## Ready For Live Executor Handoff", "");
    for (const action of asArray(report.handoff_ready_actions)) {
      lines.push(`- ${action.story_id} -> ${action.platform}: ${action.title}`);
    }
    lines.push("");
  }
  if (asArray(report.blocked_selected_actions).length) {
    lines.push("## Blocked", "");
    for (const action of asArray(report.blocked_selected_actions)) {
      lines.push(`- ${action.action_id || "unknown"}: ${asArray(action.blockers).join(", ")}`);
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

async function writeGuardedDispatchExecutorPreflight(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGuardedDispatchExecutorPreflight requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const reportPath = path.join(outDir, "guarded_dispatch_executor_preflight_report.json");
  const executorPlanPath = path.join(outDir, "guarded_dispatch_executor_plan.json");
  const markdownPath = path.join(outDir, "guarded_dispatch_executor_preflight.md");
  await fs.writeJson(reportPath, report, { spaces: 2 });
  await fs.writeJson(executorPlanPath, report.executor_plan || {}, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGuardedDispatchExecutorPreflightMarkdown(report), "utf8");
  return {
    outputDir: outDir,
    reportPath,
    executorPlanPath,
    markdownPath,
  };
}

module.exports = {
  buildGuardedDispatchExecutorPreflight,
  renderGuardedDispatchExecutorPreflightMarkdown,
  writeGuardedDispatchExecutorPreflight,
};

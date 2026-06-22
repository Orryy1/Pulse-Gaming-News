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

function rel(root, filePath) {
  if (!filePath) return null;
  return path.relative(root, path.resolve(root, filePath)).replace(/\\/g, "/");
}

function shellQuote(value) {
  return `"${String(value || "").replace(/"/g, '\\"')}"`;
}

async function readJsonOptional(filePath) {
  if (!filePath || !(await fs.pathExists(filePath))) return null;
  return fs.readJson(filePath);
}

function platformsFromMatrix(platformStatusMatrix = {}) {
  const platforms = platformStatusMatrix.platforms || {};
  return Object.entries(platforms).map(([platform, status]) => ({
    platform,
    status: clean(status?.status),
    operational_state: clean(status?.operational_state),
    operational_reason: clean(status?.operational_reason),
    deferred_action_count: Number(status?.deferred_action_count || 0),
    blocked_action_count: Number(status?.blocked_action_count || 0),
  }));
}

function splitPlatformStatus(platformStatusMatrix = {}) {
  const rows = platformsFromMatrix(platformStatusMatrix);
  return {
    enabled: rows.filter(
      (row) => row.operational_state === "enabled" && row.status !== "deferred_until_platform_enabled",
    ),
    deferred: rows.filter(
      (row) => row.operational_state !== "enabled" || row.status === "deferred_until_platform_enabled",
    ),
  };
}

function actionId(action = {}) {
  return clean(action.action_id) || `${clean(action.story_id)}:${clean(action.platform)}`;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function guardedDispatchReadyActionCount(guardedDispatchPlan = {}, dryRunPlan = {}) {
  if (Object.prototype.hasOwnProperty.call(guardedDispatchPlan, "dispatch_ready_action_count")) {
    return firstFiniteNumber(guardedDispatchPlan.dispatch_ready_action_count);
  }
  return firstFiniteNumber(dryRunPlan.safe_publish_plan?.guarded_dispatch_ready_action_count);
}

function currentReadyStoryCount(dryRunPlan = {}, guardedDispatchPlan = {}) {
  const guardedCountKnown = Object.prototype.hasOwnProperty.call(
    guardedDispatchPlan,
    "dispatch_ready_action_count",
  );
  if (guardedCountKnown && firstFiniteNumber(guardedDispatchPlan.dispatch_ready_action_count) === 0) {
    return 0;
  }
  const guardedStories = unique(asArray(guardedDispatchPlan.dispatch_ready_actions).map((action) => action.story_id));
  if (guardedStories.length) return guardedStories.length;
  return firstFiniteNumber(dryRunPlan.summary?.ready_story_count);
}

function buildLiveDispatchCommand({
  root,
  executorPlanPath,
  handoffReadyActions = [],
} = {}) {
  const actionIds = unique(handoffReadyActions.map(actionId));
  const maxActions = actionIds.length;
  if (!maxActions) return null;
  const executorRel = rel(root, executorPlanPath || "output/goal-contract/guarded_dispatch_executor_plan.json")
    .replace(/\//g, "\\");
  return [
    `cd ${shellQuote(root)};`,
    "$env:PULSE_GUARDED_LIVE_DISPATCH_ENABLED='true'; $env:PULSE_EMERGENCY_KILL_SWITCH='clear';",
    "npm run ops:goal-guarded-live-dispatch --",
    `--executor-plan ${executorRel}`,
    `--action-ids ${shellQuote(actionIds.join(","))}`,
    `--max-actions ${maxActions}`,
    "--apply --json",
  ].join(" ");
}

function summarizeReadyActions(actions = []) {
  return asArray(actions).map((action) => ({
    action_id: actionId(action),
    story_id: clean(action.story_id),
    platform: clean(action.platform),
    title: clean(action.title),
    video_path: clean(action.video_path),
    captions_path: clean(action.captions_path),
    first_frame_source: clean(action.first_frame_source),
    canonical_manifest_path: clean(action.canonical_manifest_path),
    platform_publish_manifest_path: clean(action.platform_publish_manifest_path),
    requires_live_executor_command: action.requires_live_executor_command === true,
    requires_last_second_kill_switch_check:
      action.requires_last_second_kill_switch_check === true,
    requires_last_second_platform_recheck:
      action.requires_last_second_platform_recheck === true,
  }));
}

function buildExecutorArmStatus({
  generatedAt,
  executorPreflightReport = null,
  executorPlan = {},
} = {}) {
  const ready = executorPlan.ready_for_live_executor_handoff === true;
  const handoffReadyActions = summarizeReadyActions(executorPlan.handoff_ready_actions);
  const blockedSelectedActions = asArray(executorPlan.blocked_selected_actions).map((action) => ({
    action_id: actionId(action),
    story_id: clean(action.story_id),
    platform: clean(action.platform),
    title: clean(action.title),
    blockers: unique(action.blockers),
  }));
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "EXECUTOR_ARM_STATUS",
    verdict: ready && handoffReadyActions.length ? "GREEN" : blockedSelectedActions.length ? "RED" : "AMBER",
    ready_for_live_executor_handoff: ready,
    handoff_ready_action_count: handoffReadyActions.length,
    blocked_selected_action_count: blockedSelectedActions.length,
    executor_state: executorPreflightReport?.executor_state || null,
    handoff_ready_actions: handoffReadyActions,
    blocked_selected_actions: blockedSelectedActions,
    required_next_step:
      executorPlan.required_next_step ||
      (ready ? "run_guarded_live_dispatch_executor" : "repair_executor_preflight_blockers"),
    live_publish_allowed_from_this_status: false,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function buildCurrentReadinessReport({
  generatedAt,
  dryRunPlan = {},
  guardedDispatchPlan = {},
  executorPlan = {},
  publishReadinessReport = {},
  platformStatusMatrix = {},
} = {}) {
  const split = splitPlatformStatus(platformStatusMatrix);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "CURRENT_READINESS_REPORT",
    overall_verdict: clean(publishReadinessReport.overall_verdict || dryRunPlan.overall_verdict || "unknown"),
    readiness_scope: publishReadinessReport.readiness_scope || null,
    blocker_count: asArray(publishReadinessReport.blockers).length,
    advisory: asArray(publishReadinessReport.advisory),
    ready_story_count: currentReadyStoryCount(dryRunPlan, guardedDispatchPlan),
    blocked_story_count: Number(dryRunPlan.summary?.blocked_story_count || 0),
    skipped_story_count: Number(dryRunPlan.summary?.skipped_story_count || 0),
    guarded_dispatch_ready_action_count: guardedDispatchReadyActionCount(guardedDispatchPlan, dryRunPlan),
    executor_handoff_ready_action_count: Number(executorPlan.handoff_ready_action_count || 0),
    enabled_platform_actions: split.enabled.map((row) => row.platform),
    deferred_platform_actions: split.deferred.map((row) => ({
      platform: row.platform,
      status: row.status,
      operational_state: row.operational_state,
      operational_reason: row.operational_reason,
      deferred_action_count: row.deferred_action_count,
    })),
    next_action: publishReadinessReport.next_action || guardedDispatchPlan.required_next_step || null,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function buildOperatorApprovalPack({
  root,
  generatedAt,
  dryRunPlan = {},
  humanReviewQueue = {},
  approvalGateReport = {},
  guardedDispatchPlan = {},
  executorPlan = {},
  publishReadinessReport = {},
  platformStatusMatrix = {},
  executorPlanPath,
} = {}) {
  const handoffReadyActions = summarizeReadyActions(executorPlan.handoff_ready_actions);
  const split = splitPlatformStatus(platformStatusMatrix);
  const command = buildLiveDispatchCommand({
    root,
    executorPlanPath,
    handoffReadyActions,
  });
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "OPERATOR_APPROVAL_PACK",
    current_state: {
      overall_verdict: clean(publishReadinessReport.overall_verdict || "unknown"),
      readiness_scope: publishReadinessReport.readiness_scope || null,
      blocker_count: asArray(publishReadinessReport.blockers).length,
      ready_story_count: currentReadyStoryCount(dryRunPlan, guardedDispatchPlan),
      blocked_story_count: Number(dryRunPlan.summary?.blocked_story_count || 0),
      skipped_story_count: Number(dryRunPlan.summary?.skipped_story_count || 0),
      human_review_verdict: clean(approvalGateReport.verdict || "unknown"),
      pending_review_packet_count: Number(
        approvalGateReport.summary?.pending_review_packet_count ||
          humanReviewQueue.summary?.review_item_count ||
          0,
      ),
      guarded_dispatch_ready:
        guardedDispatchPlan.ready_for_guarded_dispatch === true &&
        Number(guardedDispatchPlan.dispatch_ready_action_count || 0) > 0,
      executor_handoff_ready: executorPlan.ready_for_live_executor_handoff === true,
    },
    controlled_batch: {
      ready_action_count: handoffReadyActions.length,
      actions: handoffReadyActions,
      enabled_platforms: split.enabled.map((row) => row.platform),
      deferred_platforms: split.deferred,
    },
    exact_next_command: command,
    exact_ui_step:
      "No UI step is required for the guarded executor path. Run the exact_next_command from PowerShell in the repo root only after confirming the current pack is still the intended controlled batch.",
    live_publish_allowed_from_pack: false,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      disabled_platforms_excluded: split.deferred.map((row) => row.platform),
    },
  };
}

function renderCurrentReadinessMarkdown(report = {}) {
  const lines = [
    "# Current Readiness Report",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${report.overall_verdict || "unknown"}`,
    `Scope: ${report.readiness_scope?.name || "unknown"}`,
    `Blockers: ${report.blocker_count || 0}`,
    `Ready stories: ${report.ready_story_count || 0}`,
    `Blocked stories: ${report.blocked_story_count || 0}`,
    `Skipped/quarantined stories: ${report.skipped_story_count || 0}`,
    `Guarded dispatch ready actions: ${report.guarded_dispatch_ready_action_count || 0}`,
    `Executor handoff ready actions: ${report.executor_handoff_ready_action_count || 0}`,
    "",
    "## Enabled Platforms",
    "",
  ];
  for (const platform of asArray(report.enabled_platform_actions)) lines.push(`- ${platform}`);
  lines.push("", "## Deferred Platforms", "");
  for (const row of asArray(report.deferred_platform_actions)) {
    lines.push(`- ${row.platform}: ${row.operational_reason || row.status}`);
  }
  lines.push("", "## Next Action", "", report.next_action || "None.", "");
  return lines.join("\n");
}

function renderOperatorApprovalPackMarkdown(pack = {}) {
  const lines = [
    "# Operator Approval Pack",
    "",
    `Generated: ${pack.generated_at || "unknown"}`,
    `Readiness verdict: ${pack.current_state?.overall_verdict || "unknown"}`,
    `Ready actions: ${pack.controlled_batch?.ready_action_count || 0}`,
    `Live publish allowed from this pack: ${pack.live_publish_allowed_from_pack === true ? "yes" : "no"}`,
    "",
    "## Controlled Batch",
    "",
  ];
  for (const action of asArray(pack.controlled_batch?.actions)) {
    lines.push(`- ${action.action_id}: ${action.title}`);
  }
  lines.push("", "## Deferred Platforms", "");
  for (const row of asArray(pack.controlled_batch?.deferred_platforms)) {
    lines.push(`- ${row.platform}: ${row.operational_reason || row.status}`);
  }
  lines.push("", "## Exact Next Command", "");
  if (pack.exact_next_command) {
    lines.push("```powershell", pack.exact_next_command, "```");
  } else {
    lines.push("No guarded live command is currently available.");
  }
  lines.push("", "## Safety", "");
  lines.push("- This pack did not publish anything.");
  lines.push("- This pack did not mutate DB rows.");
  lines.push("- This pack did not change OAuth, token, credential or platform settings.");
  lines.push("- Disabled/deferred platforms remain excluded.");
  lines.push("");
  return lines.join("\n");
}

function renderNextActionsMarkdown({ pack = {}, readiness = {}, executorArm = {} } = {}) {
  const nextStep = clean(executorArm.required_next_step || readiness.next_action);
  const lines = [
    "# Next Actions",
    "",
    `Generated: ${pack.generated_at || readiness.generated_at || "unknown"}`,
    "",
    "1. Keep disabled/deferred platforms excluded until their platform-status gaps are cleared.",
    pack.exact_next_command
      ? "2. If the controlled batch is still intended, run the guarded live dispatch command below."
      : `2. Refresh fresh GREEN candidate supply before the next guarded dispatch.${nextStep ? ` Current executor next step: ${nextStep}.` : ""}`,
    "3. After fresh candidates pass, rerun guarded preflight and use only enabled-platform GREEN actions.",
    "",
    "## Guarded Command",
    "",
  ];
  if (pack.exact_next_command && executorArm.ready_for_live_executor_handoff) {
    lines.push("```powershell", pack.exact_next_command, "```");
  } else {
    lines.push(nextStep ? `No guarded live command is currently available. Next: ${nextStep}.` : "No guarded live command is currently available.");
  }
  lines.push("");
  return lines.join("\n");
}

async function buildGoalControlPack({
  root = process.cwd(),
  outDir = path.join(root, "output", "goal-contract"),
  generatedAt = new Date().toISOString(),
  paths = {},
} = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedOutDir = path.resolve(resolvedRoot, outDir);
  const p = {
    dryRunPlan: path.join(resolvedOutDir, "dry_run_publish_plan.json"),
    humanReviewQueue: path.join(resolvedOutDir, "human_review_queue.json"),
    approvalGateReport: path.join(resolvedOutDir, "human_review_approval_gate_report.json"),
    guardedDispatchPlan: path.join(resolvedOutDir, "guarded_dispatch_plan.json"),
    executorPreflightReport: path.join(resolvedOutDir, "guarded_dispatch_executor_preflight_report.json"),
    executorPlan: path.join(resolvedOutDir, "guarded_dispatch_executor_plan.json"),
    publishReadinessReport: path.join(resolvedOutDir, "publish_readiness_report.json"),
    platformStatusMatrix: path.join(resolvedOutDir, "platform_status_matrix.json"),
    ...paths,
  };

  const data = {
    dryRunPlan: (await readJsonOptional(p.dryRunPlan)) || {},
    humanReviewQueue: (await readJsonOptional(p.humanReviewQueue)) || {},
    approvalGateReport: (await readJsonOptional(p.approvalGateReport)) || {},
    guardedDispatchPlan: (await readJsonOptional(p.guardedDispatchPlan)) || {},
    executorPreflightReport: (await readJsonOptional(p.executorPreflightReport)) || {},
    executorPlan: (await readJsonOptional(p.executorPlan)) || {},
    publishReadinessReport: (await readJsonOptional(p.publishReadinessReport)) || {},
    platformStatusMatrix: (await readJsonOptional(p.platformStatusMatrix)) || {},
  };

  const executorArmStatus = buildExecutorArmStatus({
    generatedAt,
    executorPreflightReport: data.executorPreflightReport,
    executorPlan: data.executorPlan,
  });
  const currentReadinessReport = buildCurrentReadinessReport({
    generatedAt,
    dryRunPlan: data.dryRunPlan,
    guardedDispatchPlan: data.guardedDispatchPlan,
    executorPlan: data.executorPlan,
    publishReadinessReport: data.publishReadinessReport,
    platformStatusMatrix: data.platformStatusMatrix,
  });
  const operatorApprovalPack = buildOperatorApprovalPack({
    root: resolvedRoot,
    generatedAt,
    dryRunPlan: data.dryRunPlan,
    humanReviewQueue: data.humanReviewQueue,
    approvalGateReport: data.approvalGateReport,
    guardedDispatchPlan: data.guardedDispatchPlan,
    executorPlan: data.executorPlan,
    publishReadinessReport: data.publishReadinessReport,
    platformStatusMatrix: data.platformStatusMatrix,
    executorPlanPath: p.executorPlan,
  });

  return {
    schema_version: 1,
    generated_at: generatedAt,
    paths: p,
    executor_arm_status: executorArmStatus,
    current_readiness_report: currentReadinessReport,
    operator_approval_pack: operatorApprovalPack,
    markdown: {
      current_readiness_report: renderCurrentReadinessMarkdown(currentReadinessReport),
      operator_approval_pack: renderOperatorApprovalPackMarkdown(operatorApprovalPack),
      next_actions: renderNextActionsMarkdown({
        pack: operatorApprovalPack,
        readiness: currentReadinessReport,
        executorArm: executorArmStatus,
      }),
    },
  };
}

async function writeGoalControlPack(pack, { outDir }) {
  const resolvedOutDir = path.resolve(outDir || path.join(process.cwd(), "output", "goal-contract"));
  await fs.ensureDir(resolvedOutDir);
  const files = {
    executorArmStatusJson: path.join(resolvedOutDir, "executor_arm_status.json"),
    currentReadinessJson: path.join(resolvedOutDir, "current_readiness_report.json"),
    currentReadinessMd: path.join(resolvedOutDir, "current_readiness_report.md"),
    operatorApprovalJson: path.join(resolvedOutDir, "operator_approval_pack.json"),
    operatorApprovalMd: path.join(resolvedOutDir, "operator_approval_pack.md"),
    nextActionsMd: path.join(resolvedOutDir, "next_actions.md"),
  };
  await fs.writeJson(files.executorArmStatusJson, pack.executor_arm_status, { spaces: 2 });
  await fs.writeJson(files.currentReadinessJson, pack.current_readiness_report, { spaces: 2 });
  await fs.writeFile(files.currentReadinessMd, pack.markdown.current_readiness_report, "utf8");
  await fs.writeJson(files.operatorApprovalJson, pack.operator_approval_pack, { spaces: 2 });
  await fs.writeFile(files.operatorApprovalMd, pack.markdown.operator_approval_pack, "utf8");
  await fs.writeFile(files.nextActionsMd, pack.markdown.next_actions, "utf8");
  return files;
}

module.exports = {
  buildCurrentReadinessReport,
  buildExecutorArmStatus,
  buildGoalControlPack,
  buildLiveDispatchCommand,
  buildOperatorApprovalPack,
  renderCurrentReadinessMarkdown,
  renderNextActionsMarkdown,
  renderOperatorApprovalPackMarkdown,
  splitPlatformStatus,
  writeGoalControlPack,
};

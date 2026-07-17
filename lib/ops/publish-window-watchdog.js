"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const GOAL_CONTRACT_OUT = path.join(ROOT, "output", "goal-contract");

function clean(value) {
  return String(value || "").trim();
}

function normaliseVerdict(value) {
  const text = clean(value).toLowerCase();
  if (["red", "fail", "failed", "blocked", "error"].includes(text)) return "red";
  if (["amber", "warn", "warning", "review"].includes(text)) return "amber";
  if (["green", "pass", "passed", "ok", "success"].includes(text)) return "green";
  return text || "unknown";
}

function prefixedBlockers(prefix, values) {
  return (Array.isArray(values) ? values : [])
    .map(clean)
    .filter(Boolean)
    .map((item) => `${prefix}: ${item}`);
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function unique(values = []) {
  return Array.from(new Set(asArray(values).map(clean).filter(Boolean)));
}

function queueVerdict(queueReport = {}) {
  return normaliseVerdict(queueReport.verdict || queueReport.status);
}

function summariseGuardedSelection(selection = {}) {
  const action =
    selection.action && typeof selection.action === "object"
      ? selection.action
      : null;
  const storyId = clean(action?.story_id);
  const platform = clean(action?.platform);
  const actionId = clean(selection.action_id) || (action ? guardedActionId(action) : "");
  const viable =
    selection.exhausted !== true &&
    Boolean(action && actionId && storyId && platform);
  const skippedActions = asArray(selection.skipped_actions);

  return {
    checked: true,
    exhausted: !viable,
    action_id: viable ? actionId : null,
    story_id: viable ? storyId : null,
    platform: viable ? platform : null,
    reason: viable
      ? null
      : clean(selection.reason) || "no_viable_guarded_action_selected",
    error: clean(selection.error) || null,
    skipped_action_count: skippedActions.length,
    skipped_actions: skippedActions.slice(0, 8).map((item) => ({
      action_id: clean(item.action_id) || null,
      story_id: clean(item.story_id) || null,
      platform: clean(item.platform) || null,
      reason: clean(item.reason) || "unknown",
      blockers: asArray(item.blockers).map(clean).filter(Boolean).slice(0, 8),
    })),
  };
}

function applyGuardedSelectionTruth(report = {}, selection = {}) {
  const guardedSelection = summariseGuardedSelection(selection);
  if (!guardedSelection.exhausted) {
    return {
      ...report,
      guarded_selection: guardedSelection,
    };
  }

  const blockerReason = guardedSelection.error
    ? `${guardedSelection.reason}:${guardedSelection.error}`
    : guardedSelection.reason;
  return {
    ...report,
    verdict: "red",
    safe_to_publish_window: false,
    hold_scheduler_or_dispatch: true,
    guarded_selection: guardedSelection,
    blockers: unique([
      ...asArray(report.blockers),
      `guarded_selection: ${blockerReason}`,
    ]),
    next_action: "hold_scheduler_and_repair_guarded_action_selection",
  };
}

function buildActionRunway({
  executorHandoffActionCount = 0,
  executorHandoffStoryCount = null,
  publishWindows24h = 5,
} = {}) {
  const hasStoryCount =
    executorHandoffStoryCount !== null &&
    executorHandoffStoryCount !== undefined &&
    clean(executorHandoffStoryCount) !== "";
  const storyCount = Number(executorHandoffStoryCount);
  const actionCount = Number(executorHandoffActionCount || 0);
  const windowCount = Number(publishWindows24h || 5);
  const safeWindowCount = Number.isFinite(windowCount) && windowCount > 0 ? windowCount : 5;
  const usableCount =
    hasStoryCount && Number.isFinite(storyCount) && storyCount >= 0
      ? storyCount
      : actionCount;
  const safeHandoffCount = Number.isFinite(usableCount) && usableCount > 0 ? usableCount : 0;
  const covered = Math.min(safeHandoffCount, safeWindowCount);
  const uncovered = Math.max(0, safeWindowCount - safeHandoffCount);
  const reserve = Math.max(0, safeHandoffCount - safeWindowCount);

  return {
    publish_windows_24h: safeWindowCount,
    ready_for_next_24h_boolean: uncovered === 0,
    covered_publish_windows_24h: covered,
    uncovered_publish_windows_24h: uncovered,
    reserve_actions: reserve,
    status: uncovered > 0 ? "undercovered" : reserve > 0 ? "covered_with_reserve" : "covered_no_reserve",
  };
}

function watchdogNeedsRunwayRepair(report = {}) {
  const runway = report.action_runway || {};
  const youtubeRunway = report.youtube_shorts_runway || {};
  const status = clean(runway.status);
  const youtubeStatus = clean(youtubeRunway.status);
  if (youtubeStatus && youtubeStatus !== "covered_with_reserve") return true;
  if (!status) return false;
  return status !== "covered_with_reserve";
}

async function readOptionalJson(filePath) {
  try {
    if (!await fs.pathExists(filePath)) return null;
    return fs.readJson(filePath);
  } catch {
    return null;
  }
}

async function readDefaultSchedulerProof() {
  return {
    dryRunPlan: await readOptionalJson(path.join(GOAL_CONTRACT_OUT, "dry_run_publish_plan.json")),
    guardedDispatchPlan: await readOptionalJson(
      path.join(GOAL_CONTRACT_OUT, "guarded_dispatch_plan.json"),
    ),
    executorPlan: await readOptionalJson(
      path.join(GOAL_CONTRACT_OUT, "guarded_dispatch_executor_plan.json"),
    ),
  };
}

async function resolveDefaultGuardedSelection({
  env = process.env,
  schedulerProof = null,
  executorPlanPath = null,
  storyDb = null,
  selectNextGuardedLiveAction = null,
} = {}) {
  const db = storyDb || require("../db");
  const planPath =
    executorPlanPath ||
    env.PULSE_GUARDED_EXECUTOR_PLAN_PATH ||
    path.join(GOAL_CONTRACT_OUT, "guarded_dispatch_executor_plan.json");
  const executorPlan =
    schedulerProof?.executorPlan ||
    (await readOptionalJson(planPath)) ||
    {};
  const stories = await db.getStories();
  let platformPosts = db.platformPosts || null;
  if (
    !platformPosts &&
    env.USE_SQLITE === "true" &&
    typeof db.getDb === "function"
  ) {
    try {
      platformPosts = require("../repositories/platform_posts").bind(db.getDb());
    } catch {
      platformPosts = null;
    }
  }
  const selectAction =
    selectNextGuardedLiveAction ||
    require("../goal-guarded-live-dispatch-executor").selectNextGuardedLiveAction;

  return selectAction({
    executorPlan,
    stories,
    platformPosts,
  });
}

function guardedActionId(action = {}) {
  const storyId = clean(action.story_id);
  const platform = clean(action.platform);
  return clean(action.action_id) || `${storyId}:${platform}`;
}

function dispatchActionToExecutorHandoff(action = {}) {
  return {
    action_id: guardedActionId(action),
    story_id: clean(action.story_id),
    platform: clean(action.platform),
    title: clean(action.title),
    video_path: clean(action.video_path),
    captions_path: clean(action.captions_path),
    first_frame_source: clean(action.first_frame_source),
    canonical_manifest_path: clean(action.canonical_manifest_path),
    platform_publish_manifest_path: clean(action.platform_publish_manifest_path),
    story_image_path: clean(action.story_image_path || action.image_path),
    image_path: clean(action.image_path || action.story_image_path),
    live_publish_allowed_from_preflight_only: false,
    requires_live_executor_command: true,
    requires_last_second_kill_switch_check: true,
    requires_last_second_platform_recheck: true,
  };
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

function guardedDispatchPlanReadyForScheduler(plan = {}) {
  return (
    plan.mode === "GUARDED_DISPATCH_PREFLIGHT" &&
    plan.ready_for_guarded_dispatch === true &&
    guardedDispatchPlanSafetyOk(plan)
  );
}

function buildSchedulerScopedExecutorPlanFromGuardedDispatchPlan(
  guardedDispatchPlan = {},
  generatedAt = new Date().toISOString(),
) {
  const handoffReadyActions = asArray(guardedDispatchPlan.dispatch_ready_actions)
    .map(dispatchActionToExecutorHandoff)
    .filter((action) => action.story_id && action.platform);

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT",
    source_mode: "publish_window_watchdog_auto_refresh",
    source_generated_at: guardedDispatchPlan.generated_at || null,
    ready_for_live_executor_handoff: handoffReadyActions.length > 0,
    live_publish_allowed_from_this_tool: false,
    required_next_step: handoffReadyActions.length
      ? "run_guarded_live_dispatch_executor"
      : "record_operator_approved_actions_before_guarded_dispatch",
    handoff_ready_action_count: handoffReadyActions.length,
    blocked_selected_action_count: 0,
    handoff_ready_actions: handoffReadyActions,
    blocked_selected_actions: [],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function isExecutorHandoffRefreshBlocker(value) {
  const text = clean(value).toLowerCase();
  return (
    text.includes("guarded dispatch plan is newer than executor handoff") ||
    text.includes("guarded executor handoff stale") ||
    text.includes("missing current enabled dry-run actions from executor handoff")
  );
}

function watchdogNeedsExecutorHandoffRefresh(report = {}) {
  const blockers = asArray(report.blockers);
  return (
    blockers.length > 0 &&
    blockers.some(isExecutorHandoffRefreshBlocker) &&
    blockers.every(isExecutorHandoffRefreshBlocker)
  );
}

async function refreshGuardedExecutorHandoffProof({
  generatedAt = new Date().toISOString(),
  guardedDispatchPlan = null,
  outputDir = GOAL_CONTRACT_OUT,
  guardedDispatchPlanPath = path.join(outputDir, "guarded_dispatch_plan.json"),
  executorPlanPath = path.join(outputDir, "guarded_dispatch_executor_plan.json"),
  refreshReportPath = path.join(outputDir, "guarded_dispatch_executor_handoff_refresh.json"),
} = {}) {
  const sourcePlan = guardedDispatchPlan || await readOptionalJson(guardedDispatchPlanPath);
  const attemptedAt = generatedAt;
  if (!sourcePlan) {
    return {
      attempted: true,
      refreshed: false,
      generated_at: attemptedAt,
      reason: "guarded_dispatch_plan_missing",
      guarded_dispatch_plan_path: guardedDispatchPlanPath,
      executor_plan_path: executorPlanPath,
      safety: {
        live_publish_attempted: false,
        db_mutation: false,
        oauth_or_token_mutation: false,
      },
    };
  }

  if (!guardedDispatchPlanReadyForScheduler(sourcePlan)) {
    return {
      attempted: true,
      refreshed: false,
      generated_at: attemptedAt,
      reason: "guarded_dispatch_plan_not_scheduler_ready",
      guarded_dispatch_plan_path: guardedDispatchPlanPath,
      executor_plan_path: executorPlanPath,
      source_mode: sourcePlan.mode || null,
      ready_for_guarded_dispatch: sourcePlan.ready_for_guarded_dispatch === true,
      safety_ok: guardedDispatchPlanSafetyOk(sourcePlan),
      safety: {
        live_publish_attempted: false,
        db_mutation: false,
        oauth_or_token_mutation: false,
      },
    };
  }

  const executorPlan = buildSchedulerScopedExecutorPlanFromGuardedDispatchPlan(
    sourcePlan,
    generatedAt,
  );
  if (!executorPlan.ready_for_live_executor_handoff) {
    return {
      attempted: true,
      refreshed: false,
      generated_at: attemptedAt,
      reason: "guarded_dispatch_plan_has_no_dispatch_ready_actions",
      guarded_dispatch_plan_path: guardedDispatchPlanPath,
      executor_plan_path: executorPlanPath,
      dispatch_ready_action_count: asArray(sourcePlan.dispatch_ready_actions).length,
      safety: {
        live_publish_attempted: false,
        db_mutation: false,
        oauth_or_token_mutation: false,
      },
    };
  }

  await fs.ensureDir(path.dirname(executorPlanPath));
  await fs.writeJson(executorPlanPath, executorPlan, { spaces: 2 });
  const report = {
    attempted: true,
    refreshed: true,
    generated_at: attemptedAt,
    reason: "executor_handoff_refreshed_from_current_guarded_dispatch_plan",
    guarded_dispatch_plan_path: guardedDispatchPlanPath,
    executor_plan_path: executorPlanPath,
    source_generated_at: sourcePlan.generated_at || null,
    handoff_ready_action_count: executorPlan.handoff_ready_action_count,
    handoff_ready_story_count: unique(
      executorPlan.handoff_ready_actions.map((action) => action.story_id),
    ).length,
    safety: {
      live_publish_attempted: false,
      db_mutation: false,
      oauth_or_token_mutation: false,
    },
  };
  await fs.writeJson(refreshReportPath, report, { spaces: 2 });
  return report;
}

function buildPublishWindowWatchdogReport({
  generatedAt = new Date().toISOString(),
  windowLabel = "next_publish_window",
  runtimeSentinel = {},
  publishReadiness = {},
  queueReport = {},
  publishWindows24h = 5,
} = {}) {
  const runtimeVerdict = normaliseVerdict(runtimeSentinel.verdict);
  const readinessVerdict = normaliseVerdict(
    publishReadiness.overall_verdict || publishReadiness.verdict,
  );
  const queue = queueVerdict(queueReport);
  const blockers = [
    ...prefixedBlockers("runtime_sentinel", runtimeSentinel.blockers),
    ...prefixedBlockers("publish_readiness", publishReadiness.blockers),
    ...prefixedBlockers("queue_inspect", queueReport.blockers),
  ];
  if (runtimeVerdict === "red" && blockers.length === 0) {
    blockers.push("runtime_sentinel: red verdict without blocker details");
  }
  if (readinessVerdict === "red" && blockers.length === 0) {
    blockers.push("publish_readiness: red verdict without blocker details");
  }
  if (queue === "red" && blockers.length === 0) {
    blockers.push("queue_inspect: red verdict without blocker details");
  }

  const queueReason = clean(queueReport.reason);
  const queueProofIncomplete = queue === "skip" || queue === "unknown";
  const schedulerWindow = runtimeSentinel.scheduler_window_readiness || {};
  const readinessScope = publishReadiness.readiness_scope || {};
  const readinessGuardDeclared = Object.prototype.hasOwnProperty.call(
    readinessScope,
    "guard_ready",
  );
  const runtimeSafe =
    runtimeVerdict === "green" &&
    schedulerWindow.safe_to_observe_next_window !== false &&
    schedulerWindow.hold_scheduler_or_dispatch !== true;
  const schedulerProof = runtimeSentinel.scheduler_proof || {};
  const enabledDryRunActionCount = Number(schedulerProof.enabled_dry_run_action_count || 0);
  const executorHandoffActionCount = Number(schedulerProof.executor_handoff_action_count || 0);
  const rawEnabledDryRunStoryCount = Number(schedulerProof.enabled_dry_run_story_count);
  const rawExecutorHandoffStoryCount = Number(schedulerProof.executor_handoff_story_count);
  const enabledDryRunStoryCount = Number.isFinite(rawEnabledDryRunStoryCount)
    ? rawEnabledDryRunStoryCount
    : enabledDryRunActionCount;
  const executorHandoffStoryCount = Number.isFinite(rawExecutorHandoffStoryCount)
    ? rawExecutorHandoffStoryCount
    : executorHandoffActionCount;
  const actionRunway = buildActionRunway({
    executorHandoffActionCount,
    executorHandoffStoryCount,
    publishWindows24h,
  });
  const youtubeProofAvailable =
    schedulerProof.enabled_dry_run_youtube_action_count !== undefined ||
    schedulerProof.executor_handoff_youtube_action_count !== undefined ||
    schedulerProof.enabled_dry_run_youtube_story_count !== undefined ||
    schedulerProof.executor_handoff_youtube_story_count !== undefined;
  const enabledDryRunYoutubeActionCount = Number(schedulerProof.enabled_dry_run_youtube_action_count || 0);
  const executorHandoffYoutubeActionCount = Number(schedulerProof.executor_handoff_youtube_action_count || 0);
  const rawEnabledDryRunYoutubeStoryCount = Number(schedulerProof.enabled_dry_run_youtube_story_count);
  const rawExecutorHandoffYoutubeStoryCount = Number(schedulerProof.executor_handoff_youtube_story_count);
  const enabledDryRunYoutubeStoryCount = Number.isFinite(rawEnabledDryRunYoutubeStoryCount)
    ? rawEnabledDryRunYoutubeStoryCount
    : enabledDryRunYoutubeActionCount;
  const executorHandoffYoutubeStoryCount = Number.isFinite(rawExecutorHandoffYoutubeStoryCount)
    ? rawExecutorHandoffYoutubeStoryCount
    : executorHandoffYoutubeActionCount;
  const youtubeShortsRunway = youtubeProofAvailable
    ? buildActionRunway({
        executorHandoffActionCount: executorHandoffYoutubeActionCount,
        executorHandoffStoryCount: executorHandoffYoutubeStoryCount,
        publishWindows24h,
      })
    : null;
  const missingFromExecutorCount = Number(schedulerProof.missing_from_executor_count || 0);
  const missingFromExecutorStoryCount = Number(schedulerProof.missing_from_executor_story_count || 0);
  const runtimeSchedulerProofGuardReady =
    runtimeSafe &&
    enabledDryRunActionCount > 0 &&
    executorHandoffActionCount > 0 &&
    missingFromExecutorCount === 0 &&
    missingFromExecutorStoryCount === 0 &&
    (!youtubeProofAvailable || executorHandoffYoutubeStoryCount > 0);
  const readinessScopeName = clean(readinessScope.name);
  const broadScopeHeldOnlyByAllPlatformReadiness =
    readinessScopeName === "all_platforms" &&
    readinessScope.guard_ready === false &&
    Array.isArray(readinessScope.overridden_pillars) &&
    readinessScope.overridden_pillars.length === 0;
  const runtimeSchedulerProofCanCoverReadiness =
    runtimeSchedulerProofGuardReady &&
    (!readinessGuardDeclared || broadScopeHeldOnlyByAllPlatformReadiness);
  const effectiveReadinessGuardReady =
    readinessScope.guard_ready === true ||
    runtimeSchedulerProofCanCoverReadiness;
  const effectiveReadinessScopeName =
    readinessScope.guard_ready === true
      ? readinessScopeName || null
      : runtimeSchedulerProofCanCoverReadiness
      ? "runtime_scheduler_proof"
      : readinessScopeName || null;
  const readinessSafe =
    readinessVerdict !== "red" &&
    effectiveReadinessGuardReady &&
    blockers.filter((item) => item.startsWith("publish_readiness:")).length === 0;
  const queueSafe = queue !== "red";
  const baseSafe = runtimeSafe && readinessSafe && queueSafe;
  const actionRunwayAdvisory = [];
  if (!actionRunway.ready_for_next_24h_boolean) {
    actionRunwayAdvisory.push(
      `scheduler_runway: executor_action_runway_short:${actionRunway.covered_publish_windows_24h}/${actionRunway.publish_windows_24h}`,
    );
  } else if (actionRunway.reserve_actions === 0) {
    actionRunwayAdvisory.push("scheduler_runway: executor_action_reserve_empty");
  }
  if (youtubeProofAvailable) {
    if (executorHandoffYoutubeStoryCount <= 0) {
      blockers.push("youtube_shorts_runway: no_youtube_shorts_handoff_actions_for_publish_window");
    } else if (!youtubeShortsRunway.ready_for_next_24h_boolean) {
      actionRunwayAdvisory.push(
        `youtube_shorts_runway: youtube_short_runway_short:${youtubeShortsRunway.covered_publish_windows_24h}/${youtubeShortsRunway.publish_windows_24h}`,
      );
    } else if (youtubeShortsRunway.reserve_actions === 0) {
      actionRunwayAdvisory.push("youtube_shorts_runway: youtube_short_reserve_empty");
    }
  }
  const advisory = [
    ...prefixedBlockers("runtime_sentinel", runtimeSentinel.warnings),
    ...prefixedBlockers("publish_readiness", publishReadiness.advisory),
    ...prefixedBlockers("queue_inspect", queueReport.advisory),
    ...actionRunwayAdvisory,
    ...(queueProofIncomplete
      ? [
          `queue_inspect: queue proof unavailable${
            queueReason ? `: ${queueReason}` : ""
          }`,
        ]
      : []),
  ];
  const safe = baseSafe && blockers.length === 0;
  const hasAdvisoryVerdict =
    runtimeVerdict !== "green" ||
    readinessVerdict !== "green" ||
    (queue !== "green" && queue !== "pass") ||
    advisory.length > 0;

  return {
    schema_version: 1,
    generated_at: generatedAt,
    window_label: windowLabel,
    verdict: safe ? (hasAdvisoryVerdict ? "amber" : "green") : blockers.length ? "red" : "amber",
    safe_to_publish_window: safe,
    hold_scheduler_or_dispatch: !safe || schedulerWindow.hold_scheduler_or_dispatch === true,
    runtime_verdict: runtimeVerdict,
    queue_verdict: queue,
    queue_inspect_reason: queueReason || null,
    publish_readiness_verdict: readinessVerdict,
    readiness_scope: effectiveReadinessScopeName,
    readiness_guard_ready: effectiveReadinessGuardReady,
    enabled_dry_run_action_count: enabledDryRunActionCount,
    executor_handoff_action_count: executorHandoffActionCount,
    enabled_dry_run_story_count: enabledDryRunStoryCount,
    executor_handoff_story_count: executorHandoffStoryCount,
    enabled_dry_run_youtube_action_count: enabledDryRunYoutubeActionCount,
    executor_handoff_youtube_action_count: executorHandoffYoutubeActionCount,
    enabled_dry_run_youtube_story_count: enabledDryRunYoutubeStoryCount,
    executor_handoff_youtube_story_count: executorHandoffYoutubeStoryCount,
    missing_from_executor_count: missingFromExecutorCount,
    missing_from_executor_story_count: missingFromExecutorStoryCount,
    action_runway: actionRunway,
    youtube_shorts_runway: youtubeShortsRunway,
    blockers,
    advisory,
    next_action: safe
      ? schedulerWindow.next_action || publishReadiness.next_action || "observe_guarded_scheduler_window"
      : schedulerWindow.next_action ||
        publishReadiness.next_action ||
        "hold_scheduler_and_diagnose_pre_window_blockers",
    safety: {
      read_only: true,
      live_publish_attempted: false,
      db_mutation: false,
      oauth_or_token_mutation: false,
      disabled_platforms_counted_live: false,
    },
  };
}

function formatPublishWindowWatchdogDiscord(report = {}) {
  const actionRunway = report.action_runway || buildActionRunway({
    executorHandoffActionCount: Number(report.executor_handoff_action_count || 0),
  });
  const youtubeRunway = report.youtube_shorts_runway || null;
  const handoffRefresh = report.handoff_refresh || null;
  const lines = [
    `**Pulse Gaming Pre-Window Watchdog** (${report.window_label || "next"})`,
    `Status:    ${normaliseVerdict(report.verdict)}`,
    `Safe:      ${report.safe_to_publish_window ? "yes" : "no"}`,
    `Runtime:   ${normaliseVerdict(report.runtime_verdict)}`,
    `Queue:     ${normaliseVerdict(report.queue_verdict)}${
      report.queue_inspect_reason ? ` (${report.queue_inspect_reason})` : ""
    }`,
    `Readiness: ${normaliseVerdict(report.publish_readiness_verdict)}${
      report.readiness_scope ? ` (${report.readiness_scope})` : ""
    }`,
    `Actions:   ${Number(report.enabled_dry_run_action_count || 0)} dry-run / ${Number(
      report.executor_handoff_action_count || 0,
    )} handoff`,
    `Stories:   ${Number(report.enabled_dry_run_story_count || 0)} dry-run / ${Number(
      report.executor_handoff_story_count || 0,
    )} handoff`,
    `Runway:    ${Number(actionRunway.covered_publish_windows_24h || 0)}/${Number(actionRunway.publish_windows_24h || 0)} windows | reserve ${Number(actionRunway.reserve_actions || 0)}`,
  ];
  if (youtubeRunway) {
    lines.push(
      `YouTube:   ${Number(youtubeRunway.covered_publish_windows_24h || 0)}/${Number(youtubeRunway.publish_windows_24h || 0)} windows | reserve ${Number(youtubeRunway.reserve_actions || 0)}`,
    );
  }
  if (handoffRefresh?.attempted) {
    lines.push(
      `Handoff:   ${
        handoffRefresh.refreshed
          ? `refreshed (${Number(handoffRefresh.handoff_ready_action_count || 0)} actions)`
          : `refresh failed (${handoffRefresh.reason || "unknown"})`
      }`,
    );
  }
  if (Array.isArray(report.blockers) && report.blockers.length) {
    lines.push(`Blockers:  ${report.blockers.slice(0, 3).join("; ")}`);
  }
  lines.push(`Next:      ${report.next_action || "unknown"}`);
  return lines.join("\n");
}

async function runPublishWindowWatchdog({
  windowLabel,
  generatedAt = new Date().toISOString(),
  postDiscord = true,
  notifyGreen = true,
  persistReport = true,
  reportOutputPath = path.join(GOAL_CONTRACT_OUT, "publish_window_watchdog.json"),
  env = process.env,
  schedulerProof,
  buildRuntimeSentinel,
  buildReadiness,
  buildQueue,
  sendDiscord,
  executorHandoffRefresh,
  resolveGuardedSelection,
  storyDb,
  selectNextGuardedLiveAction,
} = {}) {
  const runtimeBuilder =
    buildRuntimeSentinel ||
    (async () =>
      require("./runtime-ownership-sentinel").buildRuntimeOwnershipSentinelFromEnvironment({
        env,
        schedulerProof: schedulerProof || (await readDefaultSchedulerProof()),
      }));
  const readinessBuilder =
    buildReadiness || (() => require("./publish-readiness").buildPublishReadinessReport({ env }));
  const queueBuilder = buildQueue || (() => require("./queue-inspect").buildQueueReport());

  const [runtimeSentinel, publishReadiness, queueReport] = await Promise.all([
    runtimeBuilder(),
    readinessBuilder(),
    queueBuilder(),
  ]);
  let report = buildPublishWindowWatchdogReport({
    generatedAt,
    windowLabel,
    runtimeSentinel,
    publishReadiness,
    queueReport,
    publishWindows24h: Number(env.PULSE_PUBLISH_WINDOWS_24H || 5),
  });
  const autoRefreshExecutorHandoff = env.PULSE_WATCHDOG_AUTO_REFRESH_EXECUTOR_HANDOFF !== "false";
  if (autoRefreshExecutorHandoff && watchdogNeedsExecutorHandoffRefresh(report)) {
    const handoffRefresh = await refreshGuardedExecutorHandoffProof({
      generatedAt,
      ...(executorHandoffRefresh || {}),
    });
    if (handoffRefresh.refreshed) {
      const [refreshedRuntimeSentinel, refreshedPublishReadiness, refreshedQueueReport] =
        await Promise.all([
          runtimeBuilder(),
          readinessBuilder(),
          queueBuilder(),
        ]);
      report = buildPublishWindowWatchdogReport({
        generatedAt,
        windowLabel,
        runtimeSentinel: refreshedRuntimeSentinel,
        publishReadiness: refreshedPublishReadiness,
        queueReport: refreshedQueueReport,
        publishWindows24h: Number(env.PULSE_PUBLISH_WINDOWS_24H || 5),
      });
    }
    report.handoff_refresh = handoffRefresh;
  }

  if (
    report.safe_to_publish_window === true &&
    Number(report.executor_handoff_action_count || 0) > 0
  ) {
    let guardedSelection;
    try {
      const selectionResolver =
        resolveGuardedSelection ||
        (() =>
          resolveDefaultGuardedSelection({
            env,
            schedulerProof,
            executorPlanPath: executorHandoffRefresh?.executorPlanPath,
            storyDb,
            selectNextGuardedLiveAction,
          }));
      guardedSelection = await selectionResolver({
        generatedAt,
        env,
        schedulerProof,
      });
    } catch (err) {
      guardedSelection = {
        exhausted: true,
        action_id: null,
        action: null,
        reason: "guarded_selection_error",
        error: clean(err?.message || err),
        skipped_actions: [],
      };
    }
    report = applyGuardedSelectionTruth(report, guardedSelection);
  }

  if (persistReport && reportOutputPath) {
    await fs.ensureDir(path.dirname(reportOutputPath));
    await fs.writeJson(reportOutputPath, report, { spaces: 2 });
  }

  if (postDiscord && (notifyGreen || report.verdict !== "green")) {
    const notify = sendDiscord || require("../../notify");
    await notify(formatPublishWindowWatchdogDiscord(report));
  }
  return report;
}

module.exports = {
  buildPublishWindowWatchdogReport,
  formatPublishWindowWatchdogDiscord,
  runPublishWindowWatchdog,
  normaliseVerdict,
  buildActionRunway,
  watchdogNeedsRunwayRepair,
  watchdogNeedsExecutorHandoffRefresh,
  refreshGuardedExecutorHandoffProof,
  buildSchedulerScopedExecutorPlanFromGuardedDispatchPlan,
  applyGuardedSelectionTruth,
  resolveDefaultGuardedSelection,
};

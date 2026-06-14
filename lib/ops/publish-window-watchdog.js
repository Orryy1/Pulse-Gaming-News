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

function queueVerdict(queueReport = {}) {
  return normaliseVerdict(queueReport.verdict || queueReport.status);
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

function buildPublishWindowWatchdogReport({
  generatedAt = new Date().toISOString(),
  windowLabel = "next_publish_window",
  runtimeSentinel = {},
  publishReadiness = {},
  queueReport = {},
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
  const runtimeSafe =
    runtimeVerdict === "green" &&
    schedulerWindow.safe_to_observe_next_window !== false &&
    schedulerWindow.hold_scheduler_or_dispatch !== true;
  const readinessSafe =
    readinessVerdict !== "red" &&
    readinessScope.guard_ready === true &&
    blockers.filter((item) => item.startsWith("publish_readiness:")).length === 0;
  const queueSafe = queue !== "red";
  const safe = runtimeSafe && readinessSafe && queueSafe && blockers.length === 0;
  const schedulerProof = runtimeSentinel.scheduler_proof || {};
  const advisory = [
    ...prefixedBlockers("runtime_sentinel", runtimeSentinel.warnings),
    ...prefixedBlockers("publish_readiness", publishReadiness.advisory),
    ...prefixedBlockers("queue_inspect", queueReport.advisory),
    ...(queueProofIncomplete
      ? [
          `queue_inspect: queue proof unavailable${
            queueReason ? `: ${queueReason}` : ""
          }`,
        ]
      : []),
  ];
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
    readiness_scope: readinessScope.name || null,
    readiness_guard_ready: readinessScope.guard_ready === true,
    enabled_dry_run_action_count: Number(schedulerProof.enabled_dry_run_action_count || 0),
    executor_handoff_action_count: Number(schedulerProof.executor_handoff_action_count || 0),
    missing_from_executor_count: Number(schedulerProof.missing_from_executor_count || 0),
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
  ];
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
  env = process.env,
  schedulerProof,
  buildRuntimeSentinel,
  buildReadiness,
  buildQueue,
  sendDiscord,
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
  const report = buildPublishWindowWatchdogReport({
    generatedAt,
    windowLabel,
    runtimeSentinel,
    publishReadiness,
    queueReport,
  });

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
};

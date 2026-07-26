"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_OUTPUT_DIR = path.join(ROOT, "output", "operations");

function clean(value) {
  return String(value || "").trim();
}

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(clean(value));
}

function parseExactDailyCron(cronExpr) {
  const parts = clean(cronExpr).split(/\s+/);
  if (
    parts.length !== 5 ||
    !/^\d{1,2}$/.test(parts[0]) ||
    !/^\d{1,2}$/.test(parts[1]) ||
    parts.slice(2).some((part) => part !== "*")
  ) {
    return null;
  }
  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;
  return { hour, minute };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function expandWindowIdempotency(template, scheduledAt) {
  return clean(template)
    .replace("{date}", isoDate(scheduledAt))
    .replace("{hour}", String(scheduledAt.getUTCHours()).padStart(2, "0"))
    .replace("{minute}", String(scheduledAt.getUTCMinutes()).padStart(2, "0"));
}

function parseJobPayload(job = {}) {
  if (job.payload && typeof job.payload === "object") return job.payload;
  if (!clean(job.payload)) return {};
  try {
    return JSON.parse(job.payload);
  } catch {
    return {};
  }
}

function parseJobResult(job = {}) {
  const value = job.result_summary || job.log_excerpt || job.result || null;
  if (value && typeof value === "object") return value;
  if (!clean(value)) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseTimeMs(value) {
  if (value instanceof Date) return value.getTime();
  const text = clean(value);
  if (!text) return null;
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const ms = Date.parse(normalised);
  return Number.isFinite(ms) ? ms : null;
}

function jobCoversCanonicalWindow(job = {}) {
  const status = clean(job.status).toLowerCase();
  if (status === "failed") return false;
  if (["pending", "claimed", "running"].includes(status)) return true;
  if (status !== "done") return !status;

  const result = parseJobResult(job);
  if (!result) return true;
  if (
    result.publish_window_blocked === true ||
    result.publish_dispatch_blocked === true ||
    result.no_safe_candidate === true ||
    result.skipped === true
  ) {
    return false;
  }
  const resultStatus = clean(result.status).toLowerCase();
  if (["blocked", "held", "failed", "red"].includes(resultStatus)) return false;
  return true;
}

function buildPublishWindowInstances({
  now,
  schedules = [],
  lookbackHours = 24,
  graceMinutes = 5,
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now || Date.now());
  const nowMs = nowDate.getTime();
  const oldestMs = nowMs - Math.max(1, Number(lookbackHours || 24)) * 3_600_000;
  const latestMs = nowMs - Math.max(0, Number(graceMinutes || 0)) * 60_000;
  const dayStart = new Date(Date.UTC(
    nowDate.getUTCFullYear(),
    nowDate.getUTCMonth(),
    nowDate.getUTCDate(),
  ));
  const dayCount = Math.max(2, Math.ceil(Number(lookbackHours || 24) / 24) + 1);
  const windows = [];

  for (let dayOffset = -(dayCount - 1); dayOffset <= 0; dayOffset += 1) {
    const date = new Date(dayStart.getTime() + dayOffset * 86_400_000);
    for (const schedule of schedules) {
      if (clean(schedule?.kind) !== "publish") continue;
      const cron = parseExactDailyCron(schedule.cron_expr);
      if (!cron) continue;
      const scheduledAt = new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        cron.hour,
        cron.minute,
      ));
      const scheduledMs = scheduledAt.getTime();
      if (scheduledMs < oldestMs || scheduledMs > latestMs) continue;
      const expectedKey = expandWindowIdempotency(
        schedule.idempotencyTemplate,
        scheduledAt,
      );
      windows.push({
        name: clean(schedule.name),
        scheduled_at_utc: scheduledAt.toISOString(),
        scheduled_at_ms: scheduledMs,
        expected_idempotency_key: expectedKey,
        recovery_idempotency_key: `publish_recovery:${isoDate(scheduledAt)}:${String(
          cron.hour,
        ).padStart(2, "0")}`,
      });
    }
  }

  return windows.sort((left, right) => left.scheduled_at_ms - right.scheduled_at_ms);
}

function nextPublishWindow({ now, schedules = [] } = {}) {
  const nowDate = now instanceof Date ? now : new Date(now || Date.now());
  const dayStart = new Date(Date.UTC(
    nowDate.getUTCFullYear(),
    nowDate.getUTCMonth(),
    nowDate.getUTCDate(),
  ));
  const candidates = [];
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    const date = new Date(dayStart.getTime() + dayOffset * 86_400_000);
    for (const schedule of schedules) {
      if (clean(schedule?.kind) !== "publish") continue;
      const cron = parseExactDailyCron(schedule.cron_expr);
      if (!cron) continue;
      const scheduledAt = new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        cron.hour,
        cron.minute,
      ));
      if (scheduledAt.getTime() <= nowDate.getTime()) continue;
      candidates.push({
        name: clean(schedule.name),
        scheduled_at_utc: scheduledAt.toISOString(),
        scheduled_at_ms: scheduledAt.getTime(),
      });
    }
  }
  candidates.sort((left, right) => left.scheduled_at_ms - right.scheduled_at_ms);
  return candidates[0] || null;
}

function buildMissedPublishWindowRecoveryPlan({
  now = new Date(),
  schedules = [],
  jobs = [],
  runtimeArmed = false,
  watchdogReport = {},
  selection = {},
  lookbackHours = 24,
  graceMinutes = 5,
  maxCatchupAgeHours = 6,
  minRecoveryGapMinutes = 90,
  minMinutesBeforeNextWindow = 20,
  operatorCatchupApproved = true,
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  const windows = buildPublishWindowInstances({
    now: nowDate,
    schedules,
    lookbackHours,
    graceMinutes,
  });
  const canonicalJobsByKey = new Map();
  const recoveryKeys = new Set();
  const recoveredSourceKeys = new Set();
  const recoveryJobTimes = [];

  for (const job of jobs) {
    const key = clean(job?.idempotency_key);
    if (key) {
      if (!canonicalJobsByKey.has(key)) canonicalJobsByKey.set(key, []);
      canonicalJobsByKey.get(key).push(job);
    }
    const payload = parseJobPayload(job);
    const sourceKey = clean(payload.missed_window_idempotency_key);
    if (sourceKey) recoveredSourceKeys.add(sourceKey);
    if (key.startsWith("publish_recovery:")) {
      recoveryKeys.add(key);
      const createdMs = parseTimeMs(job.created_at || job.updated_at || job.run_at);
      if (createdMs !== null) recoveryJobTimes.push(createdMs);
    }
  }

  const missedWindows = windows.filter((window) => {
    const canonicalJobs = canonicalJobsByKey.get(window.expected_idempotency_key) || [];
    const canonicalWindowCovered = canonicalJobs.some(jobCoversCanonicalWindow);
    return (
      !canonicalWindowCovered &&
      !recoveryKeys.has(window.recovery_idempotency_key) &&
      !recoveredSourceKeys.has(window.expected_idempotency_key)
    );
  });
  const catchupAgeLimitMs = Math.max(0, Number(maxCatchupAgeHours || 0)) * 3_600_000;
  const eligibleWindows = missedWindows.filter((window) =>
    catchupAgeLimitMs === 0 || nowMs - window.scheduled_at_ms <= catchupAgeLimitMs
  );
  const selectedWindow = eligibleWindows.length
    ? eligibleWindows[eligibleWindows.length - 1]
    : null;
  const selectedPlatforms = Array.isArray(selection.selected_platforms)
    ? selection.selected_platforms.map(clean).filter(Boolean)
    : [];
  const selectedActionIds = Array.isArray(selection.selected_action_ids)
    ? selection.selected_action_ids.map(clean).filter(Boolean)
    : [clean(selection.action_id)].filter(Boolean);
  const freshYoutubeFirst =
    selection.exhausted === false &&
    selectedPlatforms.includes("youtube_shorts") &&
    clean(selection.priority?.reason) === "fresh_story_youtube_first";
  const watchdogSafe =
    watchdogReport.safe_to_publish_window === true &&
    watchdogReport.hold_scheduler_or_dispatch !== true;
  const newestRecoveryMs = recoveryJobTimes.length
    ? Math.max(...recoveryJobTimes)
    : null;
  const recoveryGapClear =
    newestRecoveryMs === null ||
    nowMs - newestRecoveryMs >= Math.max(0, Number(minRecoveryGapMinutes || 0)) * 60_000;
  const upcomingWindow = nextPublishWindow({ now: nowDate, schedules });
  const minutesUntilNextWindow = upcomingWindow
    ? Math.max(0, Math.round((upcomingWindow.scheduled_at_ms - nowMs) / 60_000))
    : null;
  const nextWindowSpacingClear =
    minutesUntilNextWindow === null ||
    minutesUntilNextWindow >= Math.max(0, Number(minMinutesBeforeNextWindow || 0));

  let reason = "missed_window_recovery_ready";
  if (!missedWindows.length) reason = "no_missed_publish_windows";
  else if (!selectedWindow) reason = "missed_windows_outside_catchup_age";
  else if (!operatorCatchupApproved) reason = "catch_up_requires_operator_approval";
  else if (!runtimeArmed) reason = "guarded_live_publish_not_armed";
  else if (!watchdogSafe) reason = "publish_window_watchdog_not_safe";
  else if (!freshYoutubeFirst) reason = "no_fresh_youtube_first_action";
  else if (!recoveryGapClear) reason = "recovery_minimum_gap_active";
  else if (!nextWindowSpacingClear) reason = "next_canonical_window_imminent";

  const shouldEnqueue = reason === "missed_window_recovery_ready";
  const enqueueJob = shouldEnqueue
    ? {
        kind: "publish",
        channel_id: "pulse-gaming",
        priority: 18,
        max_attempts: 3,
        idempotency_key: selectedWindow.recovery_idempotency_key,
        payload: {
          phase: "T0",
          phase_scheduled_at_utc: selectedWindow.scheduled_at_utc,
          publish_hour_utc: new Date(
            selectedWindow.scheduled_at_utc,
          ).getUTCHours(),
          window_label: selectedWindow.name,
          immutable_runway_required: true,
          require_runway_lock: true,
          reason: "missed_publish_window_recovery",
          recovery_policy: "single_guarded_catchup",
          missed_window_name: selectedWindow.name,
          missed_window_at_utc: selectedWindow.scheduled_at_utc,
          missed_window_idempotency_key: selectedWindow.expected_idempotency_key,
          selected_action_ids: selectedActionIds,
        },
      }
    : null;

  return {
    schema_version: 1,
    generated_at: nowDate.toISOString(),
    verdict: shouldEnqueue ? "green" : watchdogSafe && runtimeArmed ? "amber" : "red",
    should_enqueue: shouldEnqueue,
    reason,
    runtime_armed: runtimeArmed === true,
    operator_catchup_approved: operatorCatchupApproved === true,
    watchdog_safe: watchdogSafe,
    fresh_youtube_first_action: freshYoutubeFirst,
    recovery_minimum_gap_clear: recoveryGapClear,
    next_window_spacing_clear: nextWindowSpacingClear,
    next_canonical_window: upcomingWindow
      ? {
          name: upcomingWindow.name,
          scheduled_at_utc: upcomingWindow.scheduled_at_utc,
        }
      : null,
    minutes_until_next_canonical_window: minutesUntilNextWindow,
    missed_window_count: missedWindows.length,
    eligible_missed_window_count: eligibleWindows.length,
    missed_windows: missedWindows.map(({ scheduled_at_ms, ...window }) => window),
    selected_window: selectedWindow
      ? Object.fromEntries(
          Object.entries(selectedWindow).filter(([key]) => key !== "scheduled_at_ms"),
        )
      : null,
    selection: {
      action_id: clean(selection.action_id) || null,
      selected_action_ids: selectedActionIds,
      selected_platforms: selectedPlatforms,
      priority_reason: clean(selection.priority?.reason) || null,
      exhausted: selection.exhausted === true,
    },
    enqueue_job: enqueueJob,
    safety: {
      at_most_one_catchup_job: true,
      guarded_publish_handler_required: true,
      burst_replay_forbidden: true,
      live_publish_attempted: false,
      oauth_or_token_mutation: false,
      direct_db_story_mutation: false,
    },
  };
}

function formatMissedPublishWindowRecoveryMarkdown(report = {}) {
  const lines = [
    "# Missed Publish Window Recovery",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${clean(report.verdict).toUpperCase() || "UNKNOWN"}`,
    `Missed windows: ${Number(report.missed_window_count || 0)}`,
    `Catch-up queued: ${report.enqueued === true ? "yes" : "no"}`,
    `Reason: ${report.reason || "unknown"}`,
  ];
  if (report.selected_window) {
    lines.push(
      `Selected window: ${report.selected_window.name || "unknown"} at ${
        report.selected_window.scheduled_at_utc || "unknown"
      }`,
    );
  }
  if (report.queued_job_id) lines.push(`Queued job: #${report.queued_job_id}`);
  lines.push(
    "",
    "Recovery replays at most one missed window and still uses the normal guarded publish handler.",
    "",
  );
  return lines.join("\n");
}

function formatMissedPublishWindowRecoveryDiscord(report = {}) {
  const lines = [
    "**Pulse Gaming Missed-Window Recovery**",
    `Status:    ${clean(report.verdict).toLowerCase() || "unknown"}`,
    `Missed:    ${Number(report.missed_window_count || 0)}`,
    `Catch-up:  ${report.enqueued === true ? `queued job #${report.queued_job_id}` : "not queued"}`,
    `Reason:    ${report.reason || "unknown"}`,
  ];
  if (report.selected_window) {
    lines.push(
      `Window:    ${report.selected_window.name || "unknown"} @ ${
        report.selected_window.scheduled_at_utc || "unknown"
      }`,
    );
  }
  return lines.join("\n");
}

async function recoverMissedPublishWindows({
  now = new Date(),
  schedules = [],
  jobs = [],
  runtimeArmed = false,
  runWatchdog = async () => ({}),
  resolveSelection = async () => ({ exhausted: true }),
  enqueue = null,
  persist = true,
  notify = true,
  outputDir = DEFAULT_OUTPUT_DIR,
  sendDiscord = null,
  planOptions = {},
} = {}) {
  const preliminary = buildMissedPublishWindowRecoveryPlan({
    now,
    schedules,
    jobs,
    runtimeArmed,
    watchdogReport: {},
    selection: {},
    ...planOptions,
  });
  let watchdogReport = {};
  let selection = {};
  if (preliminary.missed_window_count > 0) {
    watchdogReport = await runWatchdog();
    selection = await resolveSelection();
  }
  const plan = buildMissedPublishWindowRecoveryPlan({
    now,
    schedules,
    jobs,
    runtimeArmed,
    watchdogReport,
    selection,
    ...planOptions,
  });

  let queuedJob = null;
  if (plan.should_enqueue) {
    if (typeof enqueue !== "function") {
      throw new Error("missed-window recovery requires enqueue() when a catch-up is ready");
    }
    queuedJob = await enqueue(plan.enqueue_job);
  }
  const report = {
    ...plan,
    enqueued: !!queuedJob,
    queued_job_id: queuedJob?.id || null,
  };

  if (persist) {
    await fs.ensureDir(outputDir);
    await fs.writeJson(
      path.join(outputDir, "missed_publish_window_recovery.json"),
      report,
      { spaces: 2 },
    );
    await fs.writeFile(
      path.join(outputDir, "missed_publish_window_recovery.md"),
      formatMissedPublishWindowRecoveryMarkdown(report),
      "utf8",
    );
  }
  if (notify && report.missed_window_count > 0 && typeof sendDiscord === "function") {
    await sendDiscord(formatMissedPublishWindowRecoveryDiscord(report));
  }
  return report;
}

function recentPublishJobs({ repos, now = new Date(), lookbackHours = 48 } = {}) {
  if (!repos?.db || typeof repos.db.prepare !== "function") return [];
  const cutoff = new Date(
    (now instanceof Date ? now.getTime() : new Date(now).getTime()) -
      Math.max(1, Number(lookbackHours || 48)) * 3_600_000,
  ).toISOString();
  return repos.db.prepare(`
    SELECT
      j.*,
      (
        SELECT jr.log_excerpt
        FROM job_runs jr
        WHERE jr.job_id = j.id
        ORDER BY jr.id DESC
        LIMIT 1
      ) AS result_summary
    FROM jobs j
    WHERE j.kind = 'publish'
      AND datetime(j.created_at) >= datetime(?)
    ORDER BY j.created_at ASC, j.id ASC
  `).all(cutoff);
}

async function defaultGuardedSelection({
  now = new Date(),
  env = process.env,
  storyDb = null,
  executorPlanPath = path.join(
    ROOT,
    "output",
    "goal-contract",
    "guarded_dispatch_executor_plan.json",
  ),
} = {}) {
  const db = storyDb || require("../db");
  const {
    readGuardedLiveExecutorPlanForScheduler,
  } = require("../job-handlers");
  const {
    selectNextGuardedLiveAction,
  } = require("../goal-guarded-live-dispatch-executor");
  const executorPlan = await readGuardedLiveExecutorPlanForScheduler(
    env.PULSE_GUARDED_EXECUTOR_PLAN_PATH || executorPlanPath,
    (now instanceof Date ? now : new Date(now)).toISOString(),
  );
  const stories = await db.getStories();
  let platformPosts = null;
  try {
    platformPosts = require("../repositories/platform_posts").bind(db.getDb());
  } catch {
    platformPosts = null;
  }
  return selectNextGuardedLiveAction({
    executorPlan,
    stories,
    platformPosts,
  });
}

async function recoverMissedPublishWindowsFromEnvironment({
  now = new Date(),
  schedules = null,
  repos = null,
  env = process.env,
  jobs = null,
  runtimeArmed = null,
  runWatchdog = null,
  resolveSelection = null,
  persist = true,
  notify = true,
  outputDir = DEFAULT_OUTPUT_DIR,
  sendDiscord = null,
  planOptions = {},
} = {}) {
  const activeRepos = repos || require("../repositories").getRepos();
  const activeSchedules = schedules || require("../scheduler").DEFAULT_SCHEDULES;
  const queueJobs = jobs || recentPublishJobs({
    repos: activeRepos,
    now,
    lookbackHours: Math.max(48, Number(planOptions.lookbackHours || 24) + 24),
  });
  const armed = runtimeArmed === null || runtimeArmed === undefined
    ? require("../job-handlers").guardedLivePublishArmed(env)
    : runtimeArmed === true;
  const watchdog = runWatchdog || (() =>
    require("./publish-window-watchdog").runPublishWindowWatchdog({
      windowLabel: "startup_missed_window_recovery",
      postDiscord: false,
      notifyGreen: false,
      persistReport: false,
      env,
    }));
  const selection = resolveSelection || (() =>
    defaultGuardedSelection({ now, env }));
  const notifier = sendDiscord || (notify ? require("../../notify") : null);

  return recoverMissedPublishWindows({
    now,
    schedules: activeSchedules,
    jobs: queueJobs,
    runtimeArmed: armed,
    runWatchdog: watchdog,
    resolveSelection: selection,
    enqueue: (job) => activeRepos.jobs.enqueue(job),
    persist,
    notify,
    outputDir,
    sendDiscord: notifier,
    planOptions: {
      ...planOptions,
      operatorCatchupApproved:
        planOptions.operatorCatchupApproved === true ||
        truthy(env.PULSE_BREAKING_EXCEPTION_OPERATOR_APPROVED),
    },
  });
}

module.exports = {
  buildMissedPublishWindowRecoveryPlan,
  buildPublishWindowInstances,
  formatMissedPublishWindowRecoveryDiscord,
  formatMissedPublishWindowRecoveryMarkdown,
  parseExactDailyCron,
  nextPublishWindow,
  recoverMissedPublishWindows,
  recoverMissedPublishWindowsFromEnvironment,
  recentPublishJobs,
};

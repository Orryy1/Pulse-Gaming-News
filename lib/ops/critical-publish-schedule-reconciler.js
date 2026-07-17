"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const {
  parseExactDailyCron,
} = require("./missed-publish-window-recovery");
const {
  createPublishRunwayGenerationStore,
} = require("./publish-runway-generation-store");
const {
  createPublishRunwayLockController,
  resolvePublishWindow,
} = require("./publish-runway-lock-controller");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_OUTPUT_PATH = path.join(
  ROOT,
  "output",
  "operations",
  "critical_publish_schedule_reconciliation.json",
);
const PREP_CATCHUP_MINUTES = Object.freeze({
  publish_runway_generate: 180,
  publish_window_watchdog: 90,
});

function clean(value) {
  return String(value || "").trim();
}

function parsePayload(value) {
  if (value && typeof value === "object") return { ...value };
  if (!clean(value)) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function expandDailyIdempotency(template, scheduledAt) {
  return clean(template).replace(
    "{date}",
    scheduledAt.toISOString().slice(0, 10),
  );
}

function scheduledOccurrence({ now, cron }) {
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    cron.hour,
    cron.minute,
  ));
}

function coverageForSchedule(runwayCoverage, schedule, idempotencyKey) {
  if (runwayCoverage instanceof Map) {
    return (
      runwayCoverage.get(schedule?.id) ||
      runwayCoverage.get(String(schedule?.id)) ||
      runwayCoverage.get(idempotencyKey) ||
      null
    );
  }
  if (!runwayCoverage || typeof runwayCoverage !== "object") return null;
  return (
    runwayCoverage[schedule?.id] ||
    runwayCoverage[String(schedule?.id)] ||
    runwayCoverage[idempotencyKey] ||
    null
  );
}

function activeJob(job) {
  return ["pending", "claimed", "running"].includes(
    clean(job?.status).toLowerCase(),
  );
}

function relatedJobsForKey(jobs, idempotencyKey) {
  const recoveryPrefix = `${idempotencyKey}:recovery:`;
  return (jobs || []).filter((job) => {
    const key = clean(job?.idempotency_key);
    return key === idempotencyKey || key.startsWith(recoveryPrefix);
  });
}

function terminalJobIdentity(jobs) {
  const terminal = (jobs || [])
    .filter((job) => !activeJob(job))
    .sort((left, right) => {
      const leftId = Number(left?.id || 0);
      const rightId = Number(right?.id || 0);
      if (leftId !== rightId) return rightId - leftId;
      return clean(right?.created_at).localeCompare(clean(left?.created_at));
    })[0];
  return clean(terminal?.id) || "terminal";
}

function safeKeyPart(value, fallback = "unknown") {
  const part = clean(value).replace(/[^A-Za-z0-9._-]+/g, "-");
  return part || fallback;
}

function recoveryIdempotencyKey({
  canonicalKey,
  kind,
  coverage,
  relatedJobs,
}) {
  if (!relatedJobs.length) return canonicalKey;
  const terminalIdentity = terminalJobIdentity(relatedJobs);
  const generationPart =
    kind === "publish_window_watchdog"
      ? `${safeKeyPart(coverage?.generation_id, "no-generation")}:`
      : "";
  return `${canonicalKey}:recovery:${generationPart}${safeKeyPart(
    terminalIdentity,
  )}`;
}

function coverageSatisfied(kind, coverage) {
  if (kind === "publish_runway_generate") {
    return coverage?.generation_valid === true;
  }
  if (kind === "publish_window_watchdog") {
    return (
      coverage?.lock_valid === true &&
      clean(coverage?.generation_id) &&
      clean(coverage?.lock_generation_id) === clean(coverage?.generation_id)
    );
  }
  return false;
}

function buildCriticalPublishScheduleCatchupPlan({
  now = new Date(),
  schedules = [],
  jobs = [],
  runwayCoverage = {},
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const catchupJobs = [];

  for (const schedule of schedules || []) {
    const maxAgeMinutes = PREP_CATCHUP_MINUTES[clean(schedule?.kind)];
    if (!maxAgeMinutes) continue;
    const cron = parseExactDailyCron(schedule?.cron_expr);
    if (!cron) continue;
    const payload = parsePayload(schedule?.payload);
    const template = clean(
      payload.idempotencyTemplate || schedule?.idempotencyTemplate,
    );
    if (!template) continue;
    const scheduledAt = scheduledOccurrence({ now: nowDate, cron });
    const ageMinutes = (nowDate.getTime() - scheduledAt.getTime()) / 60_000;
    if (ageMinutes < 0 || ageMinutes > maxAgeMinutes) continue;
    const canonicalKey = expandDailyIdempotency(template, scheduledAt);
    const coverage = coverageForSchedule(
      runwayCoverage,
      schedule,
      canonicalKey,
    );
    if (coverageSatisfied(clean(schedule.kind), coverage)) continue;
    const relatedJobs = relatedJobsForKey(jobs, canonicalKey);
    if (relatedJobs.some(activeJob)) continue;
    const idempotencyKey = recoveryIdempotencyKey({
      canonicalKey,
      kind: clean(schedule.kind),
      coverage,
      relatedJobs,
    });
    delete payload.idempotencyTemplate;
    payload.phase_scheduled_at_utc = scheduledAt.toISOString();
    if (clean(schedule.kind) === "publish_window_watchdog") {
      payload.require_runway_lock = true;
      payload.immutable_runway_required = true;
      if (clean(coverage?.generation_id)) {
        payload.runway_generation_id = clean(coverage.generation_id);
      }
    }
    catchupJobs.push({
      schedule_id: schedule.id ?? null,
      schedule_name: clean(schedule.name),
      scheduled_at_utc: scheduledAt.toISOString(),
      age_minutes: Math.floor(ageMinutes),
      kind: clean(schedule.kind),
      channel_id: schedule.channel_id || null,
      payload: {
        ...payload,
        schedule_recovery: {
          policy: "evidence_backed_prep_catchup",
          scheduled_at_utc: scheduledAt.toISOString(),
          canonical_idempotency_key: canonicalKey,
        },
      },
      priority: Number(schedule.priority ?? 50),
      requires_gpu: !!schedule.requires_gpu,
      max_attempts: Number(schedule.max_attempts || 5),
      idempotency_key: idempotencyKey,
    });
  }

  catchupJobs.sort((left, right) =>
    left.priority - right.priority ||
    left.scheduled_at_utc.localeCompare(right.scheduled_at_utc)
  );
  return {
    schema_version: 1,
    generated_at: nowDate.toISOString(),
    verdict: catchupJobs.length ? "amber" : "green",
    catchup_job_count: catchupJobs.length,
    catchup_jobs: catchupJobs,
    safety: {
      prep_only: true,
      evidence_backed_coverage: true,
      publish_recovery_delegated_to_guarded_path: true,
      live_publish_attempted: false,
      gate_bypass_allowed: false,
    },
  };
}

async function inspectCriticalPublishScheduleCoverage({
  now = new Date(),
  schedules = [],
  env = process.env,
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const evidenceRoot = path.resolve(
    clean(env.PULSE_PUBLISH_RUNWAY_EVIDENCE_ROOT) || ROOT,
  );
  const storeRoot = path.resolve(
    clean(env.PULSE_PUBLISH_RUNWAY_ROOT) ||
      path.join(evidenceRoot, "output", "runtime", "publish-runway"),
  );
  const store = createPublishRunwayGenerationStore({ rootDir: storeRoot });
  const coverage = {};

  for (const schedule of schedules || []) {
    const kind = clean(schedule?.kind);
    if (!Object.hasOwn(PREP_CATCHUP_MINUTES, kind)) continue;
    const cron = parseExactDailyCron(schedule?.cron_expr);
    const payload = parsePayload(schedule?.payload);
    const phase = clean(payload.phase).toUpperCase();
    const publishHour = Number(payload.publish_hour_utc);
    if (
      !cron ||
      !["T-180", "T-90"].includes(phase) ||
      !Number.isInteger(publishHour) ||
      publishHour < 0 ||
      publishHour > 23
    ) {
      continue;
    }
    const scheduledAt = scheduledOccurrence({ now: nowDate, cron });
    const canonicalKey = expandDailyIdempotency(
      clean(payload.idempotencyTemplate || schedule?.idempotencyTemplate),
      scheduledAt,
    );
    const key = schedule?.id ?? canonicalKey;
    try {
      const window = resolvePublishWindow({
        at: scheduledAt,
        phase,
        publishHoursUtc: [publishHour],
      });
      const generation = await store.selectNewestValidGeneration({
        windowId: window.window_id,
      });
      const row = {
        window_id: window.window_id,
        generation_valid: Boolean(generation),
        generation_id: generation?.generation_id || null,
        lock_valid: false,
        lock_generation_id: null,
        inspection_error: null,
      };
      if (phase === "T-90") {
        const controller = createPublishRunwayLockController({
          store,
          publishHoursUtc: [publishHour],
        });
        const inspection = await controller.inspectAtT90({ at: scheduledAt });
        row.lock_valid =
          inspection.verdict === "GREEN" && Boolean(inspection.lock);
        row.lock_generation_id =
          inspection.lock?.generation_id || null;
        if (inspection.verdict === "RED") {
          row.inspection_error =
            inspection.reason_codes?.[0] || "RUNWAY_LOCK_INSPECTION_RED";
        }
      }
      coverage[key] = row;
    } catch (error) {
      coverage[key] = {
        generation_valid: false,
        generation_id: null,
        lock_valid: false,
        lock_generation_id: null,
        inspection_error: clean(error?.code || error?.message) ||
          "RUNWAY_COVERAGE_INSPECTION_FAILED",
      };
    }
  }
  return coverage;
}

async function reconcileCriticalPublishSchedules({
  now = new Date(),
  schedules = [],
  repos,
  env = process.env,
  inspectRunwayCoverage = inspectCriticalPublishScheduleCoverage,
  persist = true,
  outputPath = DEFAULT_OUTPUT_PATH,
} = {}) {
  if (!repos?.jobs || typeof repos.jobs.enqueue !== "function") {
    throw new Error("critical schedule reconciliation requires jobs.enqueue()");
  }
  if (!repos?.db || typeof repos.db.prepare !== "function") {
    throw new Error("critical schedule reconciliation requires a readable queue database");
  }
  const existingJobs = repos.db.prepare(`
    SELECT id, kind, status, idempotency_key, attempt_count, max_attempts,
           created_at, updated_at, last_error
    FROM jobs
    WHERE idempotency_key IS NOT NULL
      AND created_at >= datetime('now', '-4 hours')
  `).all();
  const runwayCoverage = await inspectRunwayCoverage({
    now,
    schedules,
    env,
  });
  const plan = buildCriticalPublishScheduleCatchupPlan({
    now,
    schedules,
    jobs: existingJobs,
    runwayCoverage,
  });
  const updateSchedule = repos.db.prepare(
    `UPDATE schedules SET last_enqueued_at = datetime('now') WHERE id = ?`,
  );
  const enqueuedJobs = [];
  for (const candidate of plan.catchup_jobs) {
    const queued = await repos.jobs.enqueue({
      kind: candidate.kind,
      channel_id: candidate.channel_id,
      payload: candidate.payload,
      priority: candidate.priority,
      requires_gpu: candidate.requires_gpu,
      max_attempts: candidate.max_attempts,
      idempotency_key: candidate.idempotency_key,
    });
    if (candidate.schedule_id !== null) {
      updateSchedule.run(candidate.schedule_id);
    }
    enqueuedJobs.push({
      schedule_name: candidate.schedule_name,
      idempotency_key: candidate.idempotency_key,
      job_id: queued?.id || null,
    });
  }
  const report = {
    ...plan,
    runway_coverage: runwayCoverage,
    enqueued_count: enqueuedJobs.length,
    enqueued_jobs: enqueuedJobs,
  };
  if (persist) {
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeJson(outputPath, report, { spaces: 2 });
  }
  return report;
}

module.exports = {
  DEFAULT_OUTPUT_PATH,
  PREP_CATCHUP_MINUTES,
  buildCriticalPublishScheduleCatchupPlan,
  inspectCriticalPublishScheduleCoverage,
  reconcileCriticalPublishSchedules,
};

"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const {
  parseExactDailyCron,
} = require("./missed-publish-window-recovery");

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

function buildCriticalPublishScheduleCatchupPlan({
  now = new Date(),
  schedules = [],
  jobs = [],
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const existingKeys = new Set(
    (jobs || []).map((job) => clean(job?.idempotency_key)).filter(Boolean),
  );
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
    const idempotencyKey = expandDailyIdempotency(template, scheduledAt);
    if (existingKeys.has(idempotencyKey)) continue;
    delete payload.idempotencyTemplate;
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
          policy: "canonical_prep_catchup",
          scheduled_at_utc: scheduledAt.toISOString(),
        },
      },
      priority: Number(schedule.priority ?? 50),
      requires_gpu: !!schedule.requires_gpu,
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
      publish_recovery_delegated_to_guarded_path: true,
      live_publish_attempted: false,
      gate_bypass_allowed: false,
    },
  };
}

async function reconcileCriticalPublishSchedules({
  now = new Date(),
  schedules = [],
  repos,
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
    SELECT idempotency_key
    FROM jobs
    WHERE idempotency_key IS NOT NULL
      AND created_at >= datetime('now', '-4 hours')
  `).all();
  const plan = buildCriticalPublishScheduleCatchupPlan({
    now,
    schedules,
    jobs: existingJobs,
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
  reconcileCriticalPublishSchedules,
};

"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { redactSensitive } = require("./railway-health");

const CONTENT_RUNWAY_JOB_KINDS = new Set([
  "candidate_supply_monitor",
  "fresh_production_refill",
  "fresh_review_script_repair",
  "local_tts_retry_recovery",
  "safe_auto_repair_runner",
]);

function isUnixVolumePathOnWindows(dbPath) {
  return process.platform === "win32" && /^\/[^/\\]/.test(String(dbPath || ""));
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function safeJson(value) {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getTableColumns(db, tableName) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
  } catch {
    return new Set();
  }
}

function selectColumn(columns, name) {
  return columns.has(name) ? name : `NULL AS ${name}`;
}

function redactJobError(job) {
  if (!job || typeof job !== "object") return job;
  return {
    ...job,
    last_error: redactSensitive(job.last_error || ""),
  };
}

function parseTimeMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const normalised =
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
      ? `${raw.replace(" ", "T")}Z`
      : raw;
  const ts = Date.parse(normalised);
  return Number.isFinite(ts) ? ts : 0;
}

function jobAgeHours(job, nowMs) {
  const ts = parseTimeMs(job?.updated_at);
  if (!ts) return null;
  return Math.max(0, (nowMs - ts) / (60 * 60 * 1000));
}

function normaliseWorkerTags(worker = {}) {
  const tags = safeJson(worker.tags);
  if (Array.isArray(tags)) return tags.map((tag) => String(tag || "").trim()).filter(Boolean);
  return String(tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function workerSeenWithin(worker = {}, nowMs, staleAfterMinutes = 15) {
  const seenMs = parseTimeMs(worker.last_seen_at);
  if (!seenMs) return false;
  return nowMs - seenMs <= staleAfterMinutes * 60 * 1000;
}

function workerCanRunContentRunway(worker = {}, nowMs) {
  if (!workerSeenWithin(worker, nowMs)) return false;
  const status = String(worker.status || "").trim().toLowerCase();
  if (["offline", "dead", "stale", "stopped"].includes(status)) return false;
  const tags = new Set(normaliseWorkerTags(worker));
  for (const kind of CONTENT_RUNWAY_JOB_KINDS) {
    if (tags.has(kind)) return true;
  }
  return false;
}

function buildContentRunwayHealth({ pendingJobs = [], activeJobs = [], workers = [], nowMs = Date.now() } = {}) {
  const pendingRunwayJobs = asArray(pendingJobs).filter((job) => CONTENT_RUNWAY_JOB_KINDS.has(job.kind));
  const runningRunwayJobs = asArray(activeJobs).filter((job) => CONTENT_RUNWAY_JOB_KINDS.has(job.kind));
  const activeFreshWorkers = asArray(workers).filter((worker) => workerCanRunContentRunway(worker, nowMs));
  const activeFreshWorkerIds = new Set(activeFreshWorkers.map((worker) => String(worker.id || "")).filter(Boolean));
  const busyFreshWorkerIds = new Set(
    activeFreshWorkers
      .filter((worker) => String(worker.status || "").trim().toLowerCase() === "busy")
      .map((worker) => String(worker.id || ""))
      .filter(Boolean),
  );
  for (const job of asArray(activeJobs)) {
    const claimedBy = String(job?.claimed_by || "").trim();
    if (activeFreshWorkerIds.has(claimedBy)) busyFreshWorkerIds.add(claimedBy);
  }
  const pendingCount = pendingRunwayJobs.length;
  const runningCount = runningRunwayJobs.length;
  const activeWorkerCount = activeFreshWorkers.length;
  const occupiedWorkerCount = busyFreshWorkerIds.size;
  return {
    pending_count: pendingCount,
    running_count: runningCount,
    active_fresh_worker_count: activeWorkerCount,
    occupied_fresh_worker_count: occupiedWorkerCount,
    saturated: pendingCount > 0 && activeWorkerCount > 0 && occupiedWorkerCount >= activeWorkerCount,
    no_active_worker: pendingCount > 0 && activeWorkerCount === 0,
    pending_jobs: pendingRunwayJobs.slice(0, 10),
    running_jobs: runningRunwayJobs.slice(0, 10),
    active_workers: activeFreshWorkers
      .map((worker) => ({
        id: worker.id,
        status: worker.status,
        last_seen_at: worker.last_seen_at,
        tags: normaliseWorkerTags(worker),
      }))
      .slice(0, 10),
  };
}

function contentRunwayKindClause() {
  return Array.from(CONTENT_RUNWAY_JOB_KINDS).map(() => "?").join(", ");
}

function mergeJobsById(...groups) {
  const byId = new Map();
  for (const group of groups) {
    for (const job of asArray(group)) {
      const key = job && job.id !== undefined && job.id !== null ? String(job.id) : JSON.stringify(job);
      if (!byId.has(key)) byId.set(key, job);
    }
  }
  return Array.from(byId.values());
}

function inspectQueue({ db, now = Date.now(), recentFailedWindowHours = 24 } = {}) {
  if (!db) {
    return {
      generatedAt: new Date().toISOString(),
      verdict: "skip",
      reason: "sqlite_unavailable",
    };
  }

  const jobCounts = db
    .prepare("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status ORDER BY status")
    .all();
  const recentJobs = db
    .prepare(
      `SELECT id, kind, status, priority, attempt_count, max_attempts,
              run_at, claimed_by, claimed_at, lease_until, last_error, updated_at
       FROM jobs
       ORDER BY id DESC
       LIMIT 20`,
    )
    .all()
    .map(redactJobError);
  const failedJobs = db
    .prepare(
      `SELECT id, kind, status, attempt_count, max_attempts, last_error, updated_at
       FROM jobs
       WHERE status = 'failed'
       ORDER BY updated_at DESC, id DESC
       LIMIT 20`,
    )
    .all()
    .map(redactJobError);
  const pendingJobs = db
    .prepare(
      `SELECT id, kind, priority, run_at, attempt_count, max_attempts, updated_at
       FROM jobs
       WHERE status = 'pending'
       ORDER BY priority ASC, run_at ASC
       LIMIT 20`,
    )
    .all();
  const contentRunwayPendingJobs = db
    .prepare(
      `SELECT id, kind, priority, run_at, attempt_count, max_attempts, updated_at
       FROM jobs
       WHERE status = 'pending'
         AND kind IN (${contentRunwayKindClause()})
       ORDER BY priority ASC, run_at ASC
       LIMIT 50`,
    )
    .all(...Array.from(CONTENT_RUNWAY_JOB_KINDS));
  const activeJobs = db
    .prepare(
      `SELECT id, kind, status, priority, run_at, attempt_count, max_attempts,
              claimed_by, claimed_at, lease_until, updated_at
       FROM jobs
       WHERE status IN ('claimed','running')
       ORDER BY priority ASC, run_at ASC
       LIMIT 20`,
    )
    .all();
  const contentRunwayActiveJobs = db
    .prepare(
      `SELECT id, kind, status, priority, run_at, attempt_count, max_attempts,
              claimed_by, claimed_at, lease_until, updated_at
       FROM jobs
       WHERE status IN ('claimed','running')
         AND kind IN (${contentRunwayKindClause()})
       ORDER BY priority ASC, run_at ASC
       LIMIT 50`,
    )
    .all(...Array.from(CONTENT_RUNWAY_JOB_KINDS));
  const scheduleColumns = getTableColumns(db, "schedules");
  const schedules = db
    .prepare(
      `SELECT name, kind, cron_expr, enabled,
              ${selectColumn(scheduleColumns, "last_run_at")},
              ${selectColumn(scheduleColumns, "last_enqueued_at")},
              ${selectColumn(scheduleColumns, "next_run_at")}
       FROM schedules
       ORDER BY name`,
    )
    .all();
  const workers = db
    .prepare(
      `SELECT id, status, last_seen_at, last_job_id, tags, version
       FROM workers
       ORDER BY last_seen_at DESC`,
    )
    .all()
    .map((w) => ({ ...w, tags: safeJson(w.tags) }));
  const staleClaims = db
    .prepare(
      `SELECT id, kind, status, claimed_by, claimed_at, lease_until, attempt_count
       FROM jobs
       WHERE status IN ('claimed','running')
         AND (
           (lease_until IS NOT NULL AND datetime(lease_until) < datetime('now'))
           OR (lease_until IS NULL AND claimed_at IS NOT NULL AND datetime(claimed_at, '+10 minutes') < datetime('now'))
         )
       ORDER BY id`,
    )
    .all();

  const counts = Object.fromEntries(jobCounts.map((r) => [r.status, r.count]));
  const hardFails = [];
  const warnings = [];
  const green = [];
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const failedWindowHours = Math.max(1, Number(recentFailedWindowHours) || 24);
  const recentFailedJobs = failedJobs.filter((job) => {
    const age = jobAgeHours(job, nowMs);
    return age !== null && age <= failedWindowHours;
  });
  const historicalFailedJobs = failedJobs.filter((job) => !recentFailedJobs.includes(job));

  if (recentFailedJobs.length > 0) warnings.push("recent_failed_jobs_present");
  else if ((counts.failed || 0) > 0) green.push("historical_failed_jobs_tracked");
  if (staleClaims.length > 0) warnings.push("stale_claims_present");
  if (schedules.length === 0) hardFails.push("no_schedules_registered");
  else green.push("schedules_registered");
  const contentRunway = buildContentRunwayHealth({
    pendingJobs: mergeJobsById(pendingJobs, contentRunwayPendingJobs),
    activeJobs: mergeJobsById(activeJobs, contentRunwayActiveJobs),
    workers,
    nowMs,
  });
  if (contentRunway.no_active_worker) warnings.push("content_runway_jobs_pending_without_active_worker");
  else if (contentRunway.saturated) warnings.push("content_runway_worker_capacity_saturated");
  else if (contentRunway.active_fresh_worker_count > 0) green.push("content_runway_worker_available");
  if ((counts.pending || 0) + (counts.claimed || 0) + (counts.running || 0) === 0) {
    green.push("no_active_backlog");
  }

  return {
    generatedAt: new Date().toISOString(),
    verdict: hardFails.length ? "fail" : warnings.length ? "review" : "pass",
    counts,
    failedJobs,
    recentFailedJobs,
    historicalFailedJobs,
    recentFailedWindowHours: failedWindowHours,
    pendingJobs,
    activeJobs,
    recentJobs,
    schedules,
    workers,
    staleClaims,
    contentRunway,
    hardFails,
    warnings,
    green,
  };
}

function buildSkipReport(reason, extra = {}) {
  return {
    generatedAt: new Date().toISOString(),
    verdict: "skip",
    reason,
    ...extra,
  };
}

async function buildQueueReport({ db, dbModule, dbPath } = {}) {
  if (db) return inspectQueue({ db });

  let resolvedDbModule = dbModule;
  try {
    resolvedDbModule = resolvedDbModule || require("../db");
  } catch (err) {
    return buildSkipReport(`db_module_unavailable: ${err.message}`);
  }

  if (
    !resolvedDbModule ||
    typeof resolvedDbModule.useSqlite !== "function" ||
    !resolvedDbModule.useSqlite()
  ) {
    return buildSkipReport("USE_SQLITE_not_enabled");
  }

  const resolvedDbPath = dbPath || resolvedDbModule.DB_PATH;
  if (!resolvedDbPath) return buildSkipReport("sqlite_db_path_unavailable");

  if (isUnixVolumePathOnWindows(resolvedDbPath)) {
    return buildSkipReport("railway_volume_path_not_local", {
      dbPath: resolvedDbPath,
    });
  }

  if (!(await fs.pathExists(resolvedDbPath))) {
    return buildSkipReport("sqlite_db_missing", { dbPath: resolvedDbPath });
  }

  let sqlite;
  try {
    const Database = require("better-sqlite3");
    sqlite = new Database(path.resolve(resolvedDbPath), {
      readonly: true,
      fileMustExist: true,
    });
    return {
      ...inspectQueue({ db: sqlite }),
      dbPath: resolvedDbPath,
      readOnly: true,
    };
  } catch (err) {
    return buildSkipReport(err.message, { dbPath: resolvedDbPath });
  } finally {
    if (sqlite) sqlite.close();
  }
}

function renderQueueInspectMarkdown(report) {
  const reason = report.reason || null;
  const commandHint =
    reason === "USE_SQLITE_not_enabled"
      ? "Run with the production/Railway environment or set USE_SQLITE=true and SQLITE_DB_PATH to the target database."
      : reason === "sqlite_unavailable"
        ? "Run from an environment where the SQLite queue database is mounted and readable."
        : reason === "sqlite_db_missing"
          ? "The configured SQLite database file does not exist on this machine. Run this inside the environment where the DB is mounted, or point SQLITE_DB_PATH at a local copy."
          : reason === "railway_volume_path_not_local"
            ? "Railway CLI injected a Unix volume path into a Windows shell. That path is only valid inside the Railway container, so this local run was skipped instead of inspecting a fake local database."
            : null;
  const lines = [
    "# Queue Inspect",
    "",
    `Generated: ${report.generatedAt}`,
    `Verdict: ${report.verdict}`,
    ...(reason ? [`Reason: ${reason}`] : []),
    ...(report.dbPath ? [`DB path: ${report.dbPath}`] : []),
    ...(report.readOnly ? ["Mode: read-only"] : []),
    ...(commandHint ? ["", "## How To Inspect", "", `- ${commandHint}`] : []),
    "",
    "## Counts",
    ...(Object.keys(report.counts || {}).length
      ? Object.entries(report.counts || {}).map(([k, v]) => `- ${k}: ${v}`)
      : ["- unavailable"]),
    "",
    "## Warnings",
    ...(report.warnings?.length ? report.warnings.map((w) => `- ${w}`) : ["- none"]),
    "",
    "## Recent Failed Jobs",
    ...(report.recentFailedJobs?.length
      ? report.recentFailedJobs.map((j) => `- #${j.id} ${j.kind}: ${redactSensitive(j.last_error || "failed")}`)
      : [`- none in the last ${report.recentFailedWindowHours || 24}h`]),
    "",
    "## Failed Jobs",
    ...(report.failedJobs?.length
      ? report.failedJobs.map((j) => `- #${j.id} ${j.kind}: ${redactSensitive(j.last_error || "failed")}`)
      : ["- none"]),
    ...(report.historicalFailedJobs?.length
      ? [
          "",
          "## Historical Failed Jobs",
          "- These are retained for audit and do not make the queue unhealthy unless they are recent.",
          ...report.historicalFailedJobs.map((j) => `- #${j.id} ${j.kind}: ${redactSensitive(j.last_error || "failed")}`),
        ]
      : []),
    "",
    "## Stale Claims",
    ...(report.staleClaims?.length
      ? report.staleClaims.map((j) => `- #${j.id} ${j.kind} claimed_by=${j.claimed_by || "unknown"}`)
      : ["- none"]),
    "",
    "## Content Runway",
    `- Pending refill/repair jobs: ${report.contentRunway?.pending_count ?? 0}`,
    `- Running refill/repair jobs: ${report.contentRunway?.running_count ?? 0}`,
    `- Active fresh-capable workers: ${report.contentRunway?.active_fresh_worker_count ?? 0}`,
    `- Occupied fresh-capable workers: ${report.contentRunway?.occupied_fresh_worker_count ?? 0}`,
    `- Saturated: ${report.contentRunway?.saturated ? "yes" : "no"}`,
  ];
  return lines.join("\n") + "\n";
}

module.exports = {
  CONTENT_RUNWAY_JOB_KINDS,
  buildContentRunwayHealth,
  buildQueueReport,
  inspectQueue,
  renderQueueInspectMarkdown,
  redactJobError,
};

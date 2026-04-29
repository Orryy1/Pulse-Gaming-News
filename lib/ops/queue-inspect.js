"use strict";

const { redactSensitive } = require("./railway-health");

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

function inspectQueue({ db } = {}) {
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

  if ((counts.failed || 0) > 0) warnings.push("failed_jobs_present");
  if (staleClaims.length > 0) warnings.push("stale_claims_present");
  if (schedules.length === 0) hardFails.push("no_schedules_registered");
  else green.push("schedules_registered");
  if ((counts.pending || 0) + (counts.claimed || 0) + (counts.running || 0) === 0) {
    green.push("no_active_backlog");
  }

  return {
    generatedAt: new Date().toISOString(),
    verdict: hardFails.length ? "fail" : warnings.length ? "review" : "pass",
    counts,
    failedJobs,
    pendingJobs,
    recentJobs,
    schedules,
    workers,
    staleClaims,
    hardFails,
    warnings,
    green,
  };
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
    "## Failed Jobs",
    ...(report.failedJobs?.length
      ? report.failedJobs.map((j) => `- #${j.id} ${j.kind}: ${redactSensitive(j.last_error || "failed")}`)
      : ["- none"]),
    "",
    "## Stale Claims",
    ...(report.staleClaims?.length
      ? report.staleClaims.map((j) => `- #${j.id} ${j.kind} claimed_by=${j.claimed_by || "unknown"}`)
      : ["- none"]),
  ];
  return lines.join("\n") + "\n";
}

module.exports = { inspectQueue, renderQueueInspectMarkdown, redactJobError };

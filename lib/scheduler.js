/**
 * lib/scheduler.js — unified scheduler on top of the jobs table.
 *
 * Context:
 *   Before Phase 3, the pipeline had three parallel cron registries
 *   (run.js, server.js, cloud.js) — 17 entries spread across three
 *   processes, with no awareness of each other. Duplicate hunts were
 *   possible, nothing persisted across restarts, and "did yesterday's
 *   publish window even fire?" was unanswerable without grepping logs.
 *
 *   This module centralises that logic:
 *     - DEFAULT_SCHEDULES is the single source of truth for recurring work.
 *     - `seed(db)` writes those rows into the `schedules` table
 *       (idempotent — rows with existing name keep their cron_expr unless
 *       explicitly told to reset).
 *     - `start({ db, enqueueOnly })` registers node-cron handlers that
 *       translate fires into jobs.enqueue() calls. If `enqueueOnly` is
 *       false (the default) the caller is expected to also run
 *       `startJobsRunner()` to actually execute the jobs.
 *
 *   Everything runs behind the `USE_JOB_QUEUE` env flag. When off, the
 *   legacy cron handlers in run.js / server.js / cloud.js continue to
 *   drive the pipeline unchanged.
 */

const cron = require("node-cron");
const { getRepos } = require("./repositories");

/**
 * Default recurring schedule. Each entry becomes a `schedules` row and
 * a node-cron registration. `kind` matches a handler in
 * lib/services/jobs-runner.js. `idempotencyTemplate` is expanded at fire
 * time with the current UTC date so we get one job per intended run —
 * restarting the scheduler mid-tick can't double-enqueue.
 */
const DEFAULT_SCHEDULES = [
  // ── Hunt cycles (four windows that cover every major announcement region) ──
  {
    name: "hunt_morning",
    kind: "hunt",
    cron_expr: "0 6 * * *",
    priority: 40,
    payload: { reason: "morning_us_leaks" },
    idempotencyTemplate: "hunt:{date}:06",
  },
  {
    name: "hunt_mid_morning",
    kind: "hunt",
    cron_expr: "0 10 * * *",
    priority: 40,
    payload: { reason: "embargo_lifts" },
    idempotencyTemplate: "hunt:{date}:10",
  },
  {
    name: "hunt_afternoon",
    kind: "hunt",
    cron_expr: "0 14 * * *",
    priority: 40,
    payload: { reason: "nintendo_direct" },
    idempotencyTemplate: "hunt:{date}:14",
  },
  {
    name: "hunt_evening",
    kind: "hunt",
    cron_expr: "0 17 * * *",
    priority: 40,
    payload: { reason: "xbox_embargo" },
    idempotencyTemplate: "hunt:{date}:17",
  },
  {
    name: "hunt_late",
    kind: "hunt",
    cron_expr: "0 22 * * *",
    priority: 40,
    payload: { reason: "playstation_sop" },
    idempotencyTemplate: "hunt:{date}:22",
  },

  // ── Produce (before each publish window) ──
  {
    name: "produce_primary",
    kind: "produce",
    cron_expr: "0 18 * * *",
    priority: 30,
    idempotencyTemplate: "produce:{date}:18",
  },

  // ── Publish (staggered by platform happens inside the handler) ──
  {
    name: "publish_primary",
    kind: "publish",
    cron_expr: "0 19 * * *",
    priority: 20,
    idempotencyTemplate: "publish:{date}:19",
  },

  // ── Engagement ──
  {
    name: "engage_after_publish",
    kind: "engage",
    cron_expr: "30 19 * * *",
    priority: 50,
    idempotencyTemplate: "engage:{date}:19-30",
  },
  {
    name: "engage_first_hour_sweep",
    kind: "engage_first_hour",
    cron_expr: "*/15 * * * *",
    priority: 60,
    idempotencyTemplate: "engage_first_hour:{date}:{hour}:{minute}",
  },

  // ── Analytics (morning + evening) ──
  {
    name: "analytics_morning",
    kind: "analytics",
    cron_expr: "0 8 * * *",
    priority: 70,
    idempotencyTemplate: "analytics:{date}:08",
  },
  {
    name: "analytics_evening",
    kind: "analytics",
    cron_expr: "0 20 * * *",
    priority: 70,
    idempotencyTemplate: "analytics:{date}:20",
  },

  // ── Weekly roundup (Sunday afternoon) ──
  {
    name: "weekly_roundup",
    kind: "roundup_weekly",
    cron_expr: "0 14 * * 0",
    priority: 30,
    idempotencyTemplate: "roundup_weekly:{iso_week}",
  },

  // ── Monthly topic compilations ──
  {
    name: "monthly_topic_compilations",
    kind: "roundup_monthly_topics",
    cron_expr: "0 10 1 * *",
    priority: 35,
    idempotencyTemplate: "roundup_monthly:{year_month}",
  },

  // ── Blog rebuild ──
  {
    name: "blog_rebuild_daily",
    kind: "blog_rebuild",
    cron_expr: "0 22 * * *",
    priority: 80,
    idempotencyTemplate: "blog_rebuild:{date}",
  },

  // ── DB backup ──
  {
    name: "db_backup_daily",
    kind: "db_backup",
    cron_expr: "0 4 * * *",
    priority: 90,
    idempotencyTemplate: "db_backup:{date}",
  },

  // ── Weekly timing re-analysis ──
  {
    name: "timing_reanalysis_weekly",
    kind: "timing_reanalysis",
    cron_expr: "0 0 * * 0",
    priority: 80,
    idempotencyTemplate: "timing_reanalysis:{iso_week}",
  },

  // ── Instagram token auto-refresh ──
  {
    name: "instagram_token_refresh",
    kind: "instagram_token_refresh",
    cron_expr: "0 3 * * 1",
    priority: 85,
    idempotencyTemplate: "instagram_token_refresh:{iso_week}",
  },

  // ── Stale-claim reaper (every minute, cheap) ──
  {
    name: "jobs_reap_stale",
    kind: "jobs_reap",
    cron_expr: "*/1 * * * *",
    priority: 99,
    idempotencyTemplate: "jobs_reap:{date}:{hour}:{minute}",
  },

  // ── Daily scoring digest to Discord (morning recap) ──
  {
    name: "scoring_digest_daily",
    kind: "scoring_digest",
    cron_expr: "30 8 * * *",
    priority: 95,
    idempotencyTemplate: "scoring_digest:{date}",
  },
];

function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
function isoWeek(d = new Date()) {
  // ISO year-week, e.g. 2026-W16
  const t = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
function yearMonth(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function expandIdempotency(template, now = new Date()) {
  if (!template) return null;
  return template
    .replace("{date}", isoDate(now))
    .replace("{iso_week}", isoWeek(now))
    .replace("{year_month}", yearMonth(now))
    .replace("{hour}", String(now.getUTCHours()).padStart(2, "0"))
    .replace("{minute}", String(now.getUTCMinutes()).padStart(2, "0"));
}

/**
 * Write DEFAULT_SCHEDULES into the `schedules` table. Idempotent: rows
 * are left alone if they already exist, unless `{ reset: true }` is
 * passed, in which case cron_expr/payload/priority are overwritten.
 *
 * This is not called automatically on boot — you invoke it once per
 * deployment (e.g. on container start or via `node lib/scheduler.js seed`).
 */
function seed({ reset = false, log = console.log } = {}) {
  const { db } = getRepos();
  const getByName = db.prepare(`SELECT * FROM schedules WHERE name = ?`);
  const insert = db.prepare(`
    INSERT INTO schedules
      (name, kind, channel_id, cron_expr, payload, enabled, requires_gpu, priority)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE schedules
    SET cron_expr = ?, payload = ?, priority = ?, kind = ?
    WHERE name = ?
  `);

  let added = 0;
  let updated = 0;
  const txn = db.transaction(() => {
    for (const s of DEFAULT_SCHEDULES) {
      const existing = getByName.get(s.name);
      const payload = JSON.stringify({
        ...(s.payload || {}),
        idempotencyTemplate: s.idempotencyTemplate,
      });
      if (!existing) {
        insert.run(
          s.name,
          s.kind,
          s.channel_id || null,
          s.cron_expr,
          payload,
          s.requires_gpu ? 1 : 0,
          s.priority ?? 50,
        );
        added++;
      } else if (reset) {
        update.run(s.cron_expr, payload, s.priority ?? 50, s.kind, s.name);
        updated++;
      }
    }
  });
  txn();
  log(`[scheduler] seed: +${added} added, ~${updated} updated`);
  return { added, updated };
}

/**
 * Start the cron-based dispatcher. For every enabled schedule row in
 * the DB, register a node-cron handler that (a) builds an idempotency
 * key from the template and (b) calls jobs.enqueue().
 *
 * Returns a stop() function that cancels every registered task.
 */
function start({ log = console.log } = {}) {
  const { jobs, db } = getRepos();
  const rows = db
    .prepare(`SELECT * FROM schedules WHERE enabled = 1 ORDER BY id`)
    .all();

  const tasks = [];
  for (const row of rows) {
    if (!cron.validate(row.cron_expr)) {
      log(
        `[scheduler] skipping ${row.name}: invalid cron_expr "${row.cron_expr}"`,
      );
      continue;
    }
    let parsed = {};
    try {
      parsed = row.payload ? JSON.parse(row.payload) : {};
    } catch {
      parsed = {};
    }
    const template = parsed.idempotencyTemplate;
    const basePayload = { ...parsed };
    delete basePayload.idempotencyTemplate;

    const task = cron.schedule(
      row.cron_expr,
      () => {
        const now = new Date();
        const idempotency_key = expandIdempotency(template, now);
        try {
          const job = jobs.enqueue({
            kind: row.kind,
            channel_id: row.channel_id || null,
            payload: basePayload,
            priority: row.priority ?? 50,
            requires_gpu: !!row.requires_gpu,
            idempotency_key,
          });
          db.prepare(
            `UPDATE schedules SET last_enqueued_at = datetime('now') WHERE id = ?`,
          ).run(row.id);
          log(
            `[scheduler] fired ${row.name} → job #${job.id} (${row.kind}) key=${idempotency_key}`,
          );
        } catch (err) {
          log(`[scheduler] ${row.name} enqueue failed: ${err.message}`);
        }
      },
      { timezone: "UTC" },
    );
    tasks.push({ row, task });
  }

  log(`[scheduler] registered ${tasks.length} schedules`);
  return {
    tasks,
    stop() {
      for (const t of tasks) {
        try {
          t.task.stop();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

// CLI: `node lib/scheduler.js seed [--reset]`
if (require.main === module) {
  const cmd = process.argv[2] || "seed";
  if (cmd === "seed") {
    const reset = process.argv.includes("--reset");
    const r = seed({ reset });
    console.log(JSON.stringify(r));
    process.exit(0);
  } else if (cmd === "list") {
    const { db } = getRepos();
    const rows = db.prepare(`SELECT * FROM schedules ORDER BY cron_expr`).all();
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } else {
    console.error("usage: node lib/scheduler.js [seed [--reset] | list]");
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_SCHEDULES,
  seed,
  start,
  expandIdempotency,
};

/**
 * lib/scheduler.js — unified scheduler on top of the jobs table.
 *
 * Context:
 *   Before Phase 3, the pipeline had three parallel cron registries
 *   (run.js, server.js, and the now-retired cloud.js) — 17 entries
 *   spread across three processes, with no awareness of each other.
 *   Duplicate hunts were possible, nothing persisted across restarts,
 *   and "did yesterday's publish window even fire?" was unanswerable
 *   without grepping logs.
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
 *   legacy cron handlers in run.js / server.js continue to drive the
 *   pipeline unchanged. (cloud.js was deleted in Phase B — Dockerfile
 *   + railway.json + package.json all point at server.js now.)
 */

const cron = require("node-cron");
const { getRepos } = require("./repositories");
const {
  DEFAULT_SCHEDULER_LEASE_MS,
  acquireSchedulerLease,
  defaultSchedulerOwnerId,
  heartbeatSchedulerLease,
  releaseSchedulerLease,
} = require("./services/scheduler-lock");
const QUIET_ENQUEUE_KINDS = new Set([
  "jobs_reap",
  "publish_schedule_recovery_monitor",
]);
const SINGLE_FLIGHT_JOB_KINDS = new Set([
  "publish_schedule_recovery_monitor",
]);

function shouldLogScheduleEnqueue(row) {
  return !QUIET_ENQUEUE_KINDS.has(row?.kind);
}

function latestActiveJobForKind({ jobs, db }, kind) {
  if (typeof jobs?.findLatestActiveByKind === "function") {
    return jobs.findLatestActiveByKind(kind);
  }
  if (!db || typeof db.prepare !== "function") {
    throw new Error(`single-flight inspection unavailable for ${kind}`);
  }
  return db.prepare(`
    SELECT *
    FROM jobs
    WHERE kind = ?
      AND status IN ('pending', 'claimed', 'running')
    ORDER BY id DESC
    LIMIT 1
  `).get(kind);
}

function enqueueScheduleOccurrence({
  row,
  jobs,
  db,
  now = new Date(),
  log = console.log,
} = {}) {
  let parsed = {};
  try {
    parsed =
      row?.payload && typeof row.payload === "object"
        ? { ...row.payload }
        : row?.payload
          ? JSON.parse(row.payload)
          : {};
  } catch {
    parsed = {};
  }
  const template = parsed.idempotencyTemplate;
  const payload = { ...parsed };
  delete payload.idempotencyTemplate;

  if (SINGLE_FLIGHT_JOB_KINDS.has(row?.kind)) {
    const active = latestActiveJobForKind({ jobs, db }, row.kind);
    if (active) {
      return {
        status: "skipped_active",
        active_job_id: active.id,
        active_job_status: active.status,
      };
    }
  }

  const idempotencyKey = expandIdempotency(template, now);
  const job = jobs.enqueue({
    kind: row.kind,
    channel_id: row.channel_id || null,
    payload,
    priority: row.priority ?? 50,
    requires_gpu: !!row.requires_gpu,
    idempotency_key: idempotencyKey,
  });
  db.prepare(
    `UPDATE schedules SET last_enqueued_at = datetime('now') WHERE id = ?`,
  ).run(row.id);
  if (shouldLogScheduleEnqueue(row)) {
    log(
      `[scheduler] fired ${row.name} -> job #${job.id} (${row.kind}) key=${idempotencyKey}`,
    );
  }
  return {
    status: "enqueued",
    job,
    idempotency_key: idempotencyKey,
  };
}

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
  //
  // Task 3 (2026-04-21): three produce windows feeding three publish
  // windows. Produce runs 1h before its matching publish so the
  // pipeline has slack if a single story takes a few minutes to
  // render. The handler scopes each child process to one fresh story
  // and queues a bounded continuation after success. This preserves
  // per-story checkpoints and prevents a slow narration near the end
  // of a batch from losing every earlier story to one process timeout.
  // Keep produce_primary at 18:00 as produce_evening so the existing
  // 19:00 publish_primary / publish_evening flow behaves identically.
  {
    name: "produce_morning",
    kind: "produce",
    cron_expr: "0 8 * * *",
    priority: 30,
    idempotencyTemplate: "produce:{date}:08",
  },
  {
    name: "produce_late_morning",
    kind: "produce",
    cron_expr: "30 10 * * *",
    priority: 30,
    idempotencyTemplate: "produce:{date}:10-30",
  },
  {
    name: "produce_afternoon",
    kind: "produce",
    cron_expr: "0 13 * * *",
    priority: 30,
    idempotencyTemplate: "produce:{date}:13",
  },
  {
    name: "produce_mid_afternoon",
    kind: "produce",
    cron_expr: "0 15 * * *",
    priority: 30,
    idempotencyTemplate: "produce:{date}:15",
  },
  {
    name: "produce_primary",
    kind: "produce",
    cron_expr: "0 18 * * *",
    priority: 30,
    idempotencyTemplate: "produce:{date}:18",
  },

  // ── Proactive TikTok auth check (90 min before publish) ──
  // Catches expiring / dead tokens while there's still time for the
  // operator to visit /auth/tiktok. Uses inspectTokenStatus() for a
  // read-only check and, if warranted, burns a refresh. Discord
  // alerts on failure. Silent on healthy tokens.
  {
    name: "tiktok_auth_check",
    kind: "tiktok_auth_check",
    cron_expr: "30 17 * * *",
    priority: 25,
    idempotencyTemplate: "tiktok_auth_check:{date}:17-30",
  },

  // Renew renewable credentials throughout the day and validate the rest.
  // This route has no social-posting capability.
  {
    name: "oauth_uptime_6h",
    kind: "oauth_uptime_maintenance",
    cron_expr: "20 */6 * * *",
    priority: 24,
    payload: {
      allow_token_refresh: true,
      no_social_posting: true,
    },
    idempotencyTemplate: "oauth_uptime:{date}:{hour}",
  },

  {
    name: "publish_schedule_recovery_monitor",
    kind: "publish_schedule_recovery_monitor",
    cron_expr: "*/1 * * * *",
    priority: 13,
    payload: { phase: "RECOVERY_MONITOR" },
    idempotencyTemplate:
      "publish_schedule_recovery_monitor:{date}:{hour}:{minute}",
  },

  // Immutable runway snapshots are created three hours before each publish
  // window. T-90 locks one snapshot and T0 may only consume that lock.
  {
    name: "publish_runway_generate_morning",
    kind: "publish_runway_generate",
    cron_expr: "0 6 * * *",
    priority: 14,
    payload: { phase: "T-180", window_label: "publish_morning", publish_hour_utc: 9 },
    idempotencyTemplate: "publish_runway_generate:{date}:06",
  },
  {
    name: "publish_runway_generate_late_morning",
    kind: "publish_runway_generate",
    cron_expr: "0 8 * * *",
    priority: 14,
    payload: { phase: "T-180", window_label: "publish_late_morning", publish_hour_utc: 11 },
    idempotencyTemplate: "publish_runway_generate:{date}:08",
  },
  {
    name: "publish_runway_generate_afternoon",
    kind: "publish_runway_generate",
    cron_expr: "0 11 * * *",
    priority: 14,
    payload: { phase: "T-180", window_label: "publish_afternoon", publish_hour_utc: 14 },
    idempotencyTemplate: "publish_runway_generate:{date}:11",
  },
  {
    name: "publish_runway_generate_mid_afternoon",
    kind: "publish_runway_generate",
    cron_expr: "0 13 * * *",
    priority: 14,
    payload: { phase: "T-180", window_label: "publish_mid_afternoon", publish_hour_utc: 16 },
    idempotencyTemplate: "publish_runway_generate:{date}:13",
  },
  {
    name: "publish_runway_generate_primary",
    kind: "publish_runway_generate",
    cron_expr: "0 16 * * *",
    priority: 14,
    payload: { phase: "T-180", window_label: "publish_primary", publish_hour_utc: 19 },
    idempotencyTemplate: "publish_runway_generate:{date}:16",
  },

  // ── Publish window watchdog (five minutes before every publish) ──
  // Read-only sentinel that checks runtime ownership, queue health,
  // publish-readiness and guarded-dispatch proof before the scheduler
  // reaches a live publish window. This is the proactive tripwire:
  // operators see the RED/AMBER/GREEN state before Discord publish
  // jobs fail, and the publish handler runs the same guard again at
  // dispatch time.
  {
    name: "publish_watchdog_morning",
    kind: "publish_window_watchdog",
    cron_expr: "30 7 * * *",
    priority: 15,
    payload: { phase: "T-90", window_label: "publish_morning", publish_hour_utc: 9, require_runway_lock: true, immutable_runway_required: true, enqueue_repair_on_runway: true, enqueue_candidate_refill_on_runway: true, repair_limit: 8 },
    idempotencyTemplate: "publish_window_watchdog:{date}:07-30",
  },
  {
    name: "publish_watchdog_late_morning",
    kind: "publish_window_watchdog",
    cron_expr: "30 9 * * *",
    priority: 15,
    payload: { phase: "T-90", window_label: "publish_late_morning", publish_hour_utc: 11, require_runway_lock: true, immutable_runway_required: true, enqueue_repair_on_runway: true, enqueue_candidate_refill_on_runway: true, repair_limit: 8 },
    idempotencyTemplate: "publish_window_watchdog:{date}:09-30",
  },
  {
    name: "publish_watchdog_afternoon",
    kind: "publish_window_watchdog",
    cron_expr: "30 12 * * *",
    priority: 15,
    payload: { phase: "T-90", window_label: "publish_afternoon", publish_hour_utc: 14, require_runway_lock: true, immutable_runway_required: true, enqueue_repair_on_runway: true, enqueue_candidate_refill_on_runway: true, repair_limit: 8 },
    idempotencyTemplate: "publish_window_watchdog:{date}:12-30",
  },
  {
    name: "publish_watchdog_mid_afternoon",
    kind: "publish_window_watchdog",
    cron_expr: "30 14 * * *",
    priority: 15,
    payload: { phase: "T-90", window_label: "publish_mid_afternoon", publish_hour_utc: 16, require_runway_lock: true, immutable_runway_required: true, enqueue_repair_on_runway: true, enqueue_candidate_refill_on_runway: true, repair_limit: 8 },
    idempotencyTemplate: "publish_window_watchdog:{date}:14-30",
  },
  {
    name: "publish_watchdog_primary",
    kind: "publish_window_watchdog",
    cron_expr: "30 17 * * *",
    priority: 15,
    payload: { phase: "T-90", window_label: "publish_primary", publish_hour_utc: 19, require_runway_lock: true, immutable_runway_required: true, enqueue_repair_on_runway: true, enqueue_candidate_refill_on_runway: true, repair_limit: 8 },
    idempotencyTemplate: "publish_window_watchdog:{date}:17-30",
  },

  // ── Publish (staggered by platform happens inside the handler) ──
  //
  // Task 3 (2026-04-21): three daily publish windows. Each publish
  // job calls publishNextStory() which picks the single highest-
  // priority unpublished story — so the cadence is "at most one
  // new public post per window", not a batch flood. Backlog
  // scenario: we sit at ~1 publish/day worth of content and add
  // two more windows, expecting 2-3 publishes/day once the
  // approved-not-produced queue drains. Keep publish_primary at
  // 19:00 so the long-standing idempotency key (publish:{date}:19)
  // stays stable and yesterday's / today's row in `schedules`
  // doesn't need a rename-migration.
  {
    name: "publish_morning",
    kind: "publish",
    cron_expr: "0 9 * * *",
    priority: 20,
    payload: { phase: "T0", window_label: "publish_morning", publish_hour_utc: 9, immutable_runway_required: true },
    idempotencyTemplate: "publish:{date}:09",
  },
  {
    name: "publish_late_morning",
    kind: "publish",
    cron_expr: "0 11 * * *",
    priority: 20,
    payload: { phase: "T0", window_label: "publish_late_morning", publish_hour_utc: 11, immutable_runway_required: true },
    idempotencyTemplate: "publish:{date}:11",
  },
  {
    name: "publish_afternoon",
    kind: "publish",
    cron_expr: "0 14 * * *",
    priority: 20,
    payload: { phase: "T0", window_label: "publish_afternoon", publish_hour_utc: 14, immutable_runway_required: true },
    idempotencyTemplate: "publish:{date}:14",
  },
  {
    name: "publish_mid_afternoon",
    kind: "publish",
    cron_expr: "0 16 * * *",
    priority: 20,
    payload: { phase: "T0", window_label: "publish_mid_afternoon", publish_hour_utc: 16, immutable_runway_required: true },
    idempotencyTemplate: "publish:{date}:16",
  },
  {
    name: "publish_primary",
    kind: "publish",
    cron_expr: "0 19 * * *",
    priority: 20,
    payload: { phase: "T0", window_label: "publish_primary", publish_hour_utc: 19, immutable_runway_required: true },
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

  // ── Studio v2 LLM-driven analytics loop (daily, after evening stats) ──
  // Reads platform metrics already stamped by the analytics pass, hands
  // a 14-day window to Claude Haiku, writes findings to
  // data/analytics_findings.md and posts a Discord summary. Runs at
  // 21:00 UTC so the evening analytics row at 20:00 has fresh views/likes
  // to chew on.
  {
    name: "studio_analytics_loop",
    kind: "studio_analytics_loop",
    cron_expr: "0 21 * * *",
    priority: 75,
    idempotencyTemplate: "studio_analytics_loop:{date}:21",
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

  // ── Instagram pending-processing verifier (env-gated) ──
  // Reels that timed out the in-process processing wait but were
  // accepted by Meta finish later on Meta's side. Without follow-up,
  // story.instagram_error sits as `pending_processing_timeout` forever
  // and instagram_media_id never gets stamped. This pass hits the
  // Graph status endpoint per pending container and publishes the
  // ones that finished. Default-OFF — handler returns early when
  // INSTAGRAM_PENDING_VERIFIER_ENABLED is not "true". Hourly during
  // daytime (07–23 UTC) is enough; containers expire ~24h.
  {
    name: "instagram_pending_verify_hourly",
    kind: "instagram_pending_verify",
    cron_expr: "15 7-23 * * *",
    priority: 60,
    idempotencyTemplate: "instagram_pending_verify:{date}:{hour}",
  },

  // ── Stale-claim reaper (every minute, cheap) ──
  {
    name: "jobs_reap_stale",
    kind: "jobs_reap",
    cron_expr: "*/1 * * * *",
    priority: 1,
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

  // ── Overnight workshop (env-gated, default OFF) ──
  // Four-pass autonomous improvement run that fires through the night.
  // All four handlers return early when OVERNIGHT_WORKSHOP_ENABLED!=true.
  // - 02:00 UTC: produce sweep (whole approved-but-not-exported queue)
  // - 04:00 UTC: analytics backfill (YT + TT, rate-limited)
  // - 05:30 UTC: Claude analyst — daily briefing
  // - 06:00 UTC: morning Discord digest
  {
    name: "overnight_produce_sweep",
    kind: "overnight_produce_sweep",
    cron_expr: "0 2 * * *",
    priority: 30,
    idempotencyTemplate: "overnight_produce_sweep:{date}",
  },
  {
    name: "overnight_analytics_backfill",
    kind: "overnight_analytics_backfill",
    cron_expr: "0 4 * * *",
    priority: 70,
    idempotencyTemplate: "overnight_analytics_backfill:{date}",
  },
  {
    name: "overnight_claude_analyst",
    kind: "overnight_claude_analyst",
    cron_expr: "30 5 * * *",
    priority: 75,
    idempotencyTemplate: "overnight_claude_analyst:{date}",
  },
  {
    name: "overnight_morning_digest",
    kind: "overnight_morning_digest",
    cron_expr: "0 6 * * *",
    priority: 95,
    idempotencyTemplate: "overnight_morning_digest:{date}",
  },

  // ── Live continuous-analysis model (env-gated, default OFF) ──
  // Fires every 30 minutes. Reads platform_metric_snapshots <72h old,
  // updates incremental Welford running statistics per (feature,
  // metric), flags outliers (>=1.5σ logged, >=2.5σ Discord-notified).
  // The "living, breathing" model — learns continuously across
  // restarts via persisted live_model_state. Returns enabled=false
  // when LIVE_ANALYST_ENABLED!=true.
  {
    name: "live_performance_analyst_30m",
    kind: "live_performance_analyst",
    cron_expr: "*/30 * * * *",
    priority: 65,
    idempotencyTemplate: "live_performance_analyst:{date}:{hour}:{minute}",
  },

  // Orchestrated learning loop (safe by default). Ties together the
  // capability checks, public-counter model updates, YouTube Analytics
  // readiness packet and Visual V3 retention recommendation files.
  // It never posts, triggers OAuth or changes production story rows.
  {
    name: "continuous_learning_loop_hourly",
    kind: "continuous_learning_loop",
    cron_expr: "15 * * * *",
    priority: 66,
    payload: { limit: 12, maxAgeDays: 45 },
    idempotencyTemplate: "continuous_learning_loop:{date}:{hour}",
  },

  // Growth governor. Reconciles cadence, candidate supply, safety and
  // conversion evidence every 30 minutes. It writes local proof artefacts
  // and may enqueue only explicitly whitelisted diagnostic/recovery jobs.
  // Goal 19 and strict publish readiness remain authoritative: this job
  // has no publish, OAuth, token, platform-enablement or DB-mutation route.
  {
    name: "growth_autopilot_30m",
    kind: "growth_autopilot",
    cron_expr: "10,40 * * * *",
    priority: 65,
    payload: {
      execute_safe_followups: true,
      no_publish: true,
    },
    idempotencyTemplate: "growth_autopilot:{date}:{hour}:{minute}",
  },

  // Read-only fresh candidate buffer monitor. This is the early warning
  // for the failure mode where the runtime is healthy but the scheduler
  // has no GREEN story it should safely publish.
  {
    name: "candidate_supply_monitor_2h",
    kind: "candidate_supply_monitor",
    cron_expr: "5 * * * *",
    priority: 64,
    payload: {
      limit: 30,
      post_discord_on_red: true,
      post_discord_on_amber: true,
      enqueue_repair_on_amber: true,
      enqueue_hunt_on_runway_gap: true,
      enqueue_fresh_review_script_repair: true,
      enqueue_fresh_production_refill: true,
      enqueue_local_tts_retry_recovery: true,
      fresh_review_script_repair_limit: 6,
      fresh_production_refill_limit: 12,
      fresh_production_refill_rss_per_feed: 4,
      fresh_production_refill_tts_provider: "elevenlabs",
      local_tts_retry_limit: 6,
      local_tts_retry_apply_limit: 3,
      repair_limit: 10,
    },
    idempotencyTemplate: "candidate_supply_monitor:{date}:{hour}",
  },

  // Daily lawful competitor pattern refresh. Metadata and structural
  // patterns only: no competitor media downloads, no copied assets, no
  // transcript cloning, no publish side effects.
  {
    name: "competitor_forensics_daily",
    kind: "competitor_forensics_lab",
    cron_expr: "10 5 * * *",
    priority: 63,
    payload: { max_videos_per_channel: 5, collect_public_feeds: true },
    idempotencyTemplate: "competitor_forensics:{date}",
  },

  // Applies the current competitor-derived Pulse rulebook to local story
  // packages so scripts, visuals, audio and source locks keep moving
  // toward media-house parity before candidates can become GREEN.
  {
    name: "competitor_quality_gate_daily",
    kind: "competitor_quality_gate",
    cron_expr: "40 5 * * *",
    priority: 63,
    payload: {},
    idempotencyTemplate: "competitor_quality_gate:{date}",
  },

  // Commercial learning pass. Reads affiliate/click evidence and writes
  // recommendations; it does not rewrite stories, post publicly or touch
  // payment/token settings.
  {
    name: "commercial_learning_daily",
    kind: "commercial_learning_loop",
    cron_expr: "45 20 * * *",
    priority: 68,
    payload: {},
    idempotencyTemplate: "commercial_learning:{date}",
  },

  // Read-only ops alignment monitor. It reconciles Discord digest
  // feedback, current preflight, recent publish jobs and platform
  // evidence so stale warnings do not mask the current scheduler state.
  {
    name: "autonomous_feedback_monitor_30m",
    kind: "autonomous_feedback_monitor",
    cron_expr: "20,50 * * * *",
    priority: 67,
    payload: { post_discord: true, enqueue_followups: true },
    idempotencyTemplate: "autonomous_feedback_monitor:{date}:{hour}:{minute}",
  },

  // Local TTS health guard. Runs before the repair loop so fresh story
  // generation does not keep failing with server_down/timeout artefacts.
  // It is local-only: no posting, OAuth/token work or platform settings.
  {
    name: "local_tts_doctor_hourly",
    kind: "local_tts_doctor",
    cron_expr: "25 * * * *",
    priority: 68,
    payload: { restart: true, prewarm: true, smoke: true },
    idempotencyTemplate: "local_tts_doctor:{date}:{hour}",
  },

  // Guarded local repair runner. It regenerates the publish-blocker plan
  // and executes only whitelisted local-proof/dry-run repair commands.
  // No uploads, OAuth/token work, production DB applies or disabled
  // platform changes are permitted by the runner.
  {
    name: "safe_auto_repair_runner_2h",
    kind: "safe_auto_repair_runner",
    cron_expr: "35 * * * *",
    priority: 69,
    payload: { limit: 8, execute: true },
    idempotencyTemplate: "safe_auto_repair_runner:{date}:{hour}",
  },

  // ── Daily render-health digest to Discord ──
  // Summarises the render-lane / render-quality / outro-present
  // metadata stamps from the last 24h of produced stories. Drives
  // the operator's decision on flipping BLOCK_THIN_VISUALS=true.
  // 09:30 UTC sits just after scoring_digest_daily so the operator
  // gets one combined morning view of yesterday's work.
  {
    name: "render_health_digest_daily",
    kind: "render_health_digest",
    cron_expr: "30 9 * * *",
    priority: 95,
    idempotencyTemplate: "render_health_digest:{date}",
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
function activeSchedulesForEnvironment(
  schedules = DEFAULT_SCHEDULES,
  env = process.env,
) {
  const {
    selectStabilisationSchedules,
  } = require("./stabilisation/scheduler-profile");
  const active = selectStabilisationSchedules(schedules);
  const requested = String(
    env.PULSE_SCHEDULER_PROFILE || "stabilisation_30d",
  ).trim();
  Object.defineProperty(active, "profile", {
    value: requested === "stabilisation_30d" ? requested : "stabilisation_30d",
    enumerable: false,
  });
  return active;
}

function start({
  log = console.log,
  env = process.env,
  ownerId = defaultSchedulerOwnerId(),
  heartbeatIntervalMs = Math.floor(DEFAULT_SCHEDULER_LEASE_MS / 3),
  repos = null,
} = {}) {
  const { jobs, db, runtimeLeases } = repos || getRepos();
  let lease;
  try {
    lease = acquireSchedulerLease({
      leases: runtimeLeases,
      ownerId,
      metadata: { process_id: process.pid },
    });
  } catch (error) {
    log(`[scheduler] scheduler_lease_unavailable: ${error.message}`);
    return {
      active: false,
      blocked_reason: "scheduler_lease_unavailable",
      tasks: [],
      stop() {},
    };
  }
  if (!lease.acquired) {
    log(
      `[scheduler] scheduler_lease_unavailable: held by another live owner until ${lease.expires_at}`,
    );
    return {
      active: false,
      blocked_reason: "scheduler_lease_unavailable",
      lease,
      tasks: [],
      stop() {},
    };
  }

  const tasks = [];
  try {
  const configuredRows = db
    .prepare(`SELECT * FROM schedules WHERE enabled = 1 ORDER BY id`)
    .all();
  const rows = activeSchedulesForEnvironment(configuredRows, env);
  const suppressed = configuredRows.length - rows.length;

  for (const row of rows) {
    if (!cron.validate(row.cron_expr)) {
      log(
        `[scheduler] skipping ${row.name}: invalid cron_expr "${row.cron_expr}"`,
      );
      continue;
    }
    const task = cron.schedule(
      row.cron_expr,
      () => {
        try {
          enqueueScheduleOccurrence({ row, jobs, db, log });
        } catch (err) {
          log(`[scheduler] ${row.name} enqueue failed: ${err.message}`);
        }
      },
      { timezone: "UTC" },
    );
    tasks.push({ row, task });
  }

  let active = true;
  const stopTasks = () => {
    if (!active) return;
    active = false;
    for (const t of tasks) {
      try {
        t.task.stop();
      } catch {
        /* ignore */
      }
    }
  };
  const heartbeat = setInterval(() => {
    let healthy = false;
    try {
      healthy = heartbeatSchedulerLease({
        leases: runtimeLeases,
        ownerId,
      });
    } catch (error) {
      log(`[scheduler] scheduler lease heartbeat failed: ${error.message}`);
    }
    if (!healthy) {
      log("[scheduler] scheduler lease lost; stopping all cron tasks");
      stopTasks();
      clearInterval(heartbeat);
    }
  }, Math.max(1000, Number(heartbeatIntervalMs) || 30_000));
  heartbeat.unref?.();

  log(
    `[scheduler] registered ${tasks.length} schedules profile=stabilisation_30d suppressed=${suppressed} owner=${ownerId}`,
  );
  return {
    active: true,
    lease,
    tasks,
    stop() {
      clearInterval(heartbeat);
      stopTasks();
      releaseSchedulerLease({ leases: runtimeLeases, ownerId });
    },
  };
  } catch (error) {
    for (const scheduled of tasks) {
      try {
        scheduled.task.stop();
      } catch {
        /* best-effort cleanup before startup failure propagates */
      }
    }
    try {
      releaseSchedulerLease({ leases: runtimeLeases, ownerId });
    } catch {
      /* preserve the original startup failure */
    }
    throw error;
  }
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
  activeSchedulesForEnvironment,
  seed,
  start,
  expandIdempotency,
  enqueueScheduleOccurrence,
  shouldLogScheduleEnqueue,
};

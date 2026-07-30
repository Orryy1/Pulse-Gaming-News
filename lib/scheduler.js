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
  "external_creative_critic_queue_reconcile",
]);
const AUTONOMOUS_WINDOW_TARGET_KINDS = new Set([
  "plan_governed_autonomous_window_production",
  "prepare_governed_autonomous_pre_t90_window",
]);
const GUARDED_AUTONOMOUS_PUBLISH_HOURS_UTC = new Set([
  9, 19,
]);

function shouldLogScheduleEnqueue(row) {
  return !QUIET_ENQUEUE_KINDS.has(row?.kind);
}

function bindAutonomousWindowScheduledFor({
  kind,
  payload,
  now,
}) {
  if (
    !AUTONOMOUS_WINDOW_TARGET_KINDS.has(kind) ||
    !Object.hasOwn(payload, "publish_hour_utc")
  ) {
    return payload;
  }
  const publishHourUtc = Number(payload.publish_hour_utc);
  if (
    !GUARDED_AUTONOMOUS_PUBLISH_HOURS_UTC.has(
      publishHourUtc,
    )
  ) {
    throw new Error(
      "scheduler_autonomous_publish_hour_utc_invalid",
    );
  }
  return {
    ...payload,
    scheduled_for: new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        publishHourUtc,
      ),
    ).toISOString(),
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
  // render. Each produce job iterates through every approved-not-
  // exported story, so catching a missed window just means the next
  // run covers two stories. Keep produce_primary at 18:00 as
  // produce_evening so the existing 19:00 publish_primary /
  // publish_evening flow behaves identically on day one.
  {
    name: "produce_morning",
    kind: "produce",
    cron_expr: "0 8 * * *",
    priority: 30,
    idempotencyTemplate: "produce:{date}:08",
  },
  {
    name: "produce_afternoon",
    kind: "produce",
    cron_expr: "0 13 * * *",
    priority: 30,
    idempotencyTemplate: "produce:{date}:13",
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
    idempotencyTemplate: "publish:{date}:09",
  },
  {
    name: "publish_afternoon",
    kind: "publish",
    cron_expr: "0 14 * * *",
    priority: 20,
    idempotencyTemplate: "publish:{date}:14",
  },
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

  // Governed multi-lane planning. This plans breaking Shorts,
  // evergreen verdict Shorts and weekly longform independently. It
  // has no publish authority: external dispatch still requires one
  // exact, fresh SCHEDULED lifecycle ticket.
  {
    name: "governed_multi_lane_plan",
    kind: "governed_multi_lane_plan",
    cron_expr: "*/15 * * * *",
    priority: 18,
    payload: {
      live_publish_enabled: false,
      human_admission_required: true,
    },
    idempotencyTemplate:
      "governed_multi_lane_plan:{date}:{hour}:{minute}",
  },
  {
    name: "governed_youtube_window_inventory_monitor",
    kind: "governed_youtube_window_inventory_monitor",
    cron_expr: "*/5 * * * *",
    priority: 5,
    payload: {
      phase: "CANDIDATE_INVENTORY",
      horizon_hours: 36,
      human_review_required: true,
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
    idempotencyTemplate:
      "governed_youtube_window_inventory_monitor:{date}:{hour}:{minute}",
  },
  {
    name: "plan_governed_autonomous_window_production_morning",
    kind: "plan_governed_autonomous_window_production",
    cron_expr: "35 6 * * *",
    priority: 3,
    payload: {
      phase: "AUTONOMOUS_WINDOW_PRODUCTION_PLAN",
      publish_hour_utc: 9,
      job_max_attempts: 8,
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
    idempotencyTemplate:
      "plan_governed_autonomous_window_production:{date}:09",
  },
  {
    name: "plan_governed_autonomous_window_production_evening",
    kind: "plan_governed_autonomous_window_production",
    cron_expr: "35 16 * * *",
    priority: 3,
    payload: {
      phase: "AUTONOMOUS_WINDOW_PRODUCTION_PLAN",
      publish_hour_utc: 19,
      job_max_attempts: 8,
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
    idempotencyTemplate:
      "plan_governed_autonomous_window_production:{date}:19",
  },
  {
    name: "prepare_governed_autonomous_pre_t90_window_morning",
    kind: "prepare_governed_autonomous_pre_t90_window",
    cron_expr: "26 7 * * *",
    priority: 3,
    payload: {
      phase: "T-94",
      publish_hour_utc: 9,
      maximum_start_lateness_seconds: 60,
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
    idempotencyTemplate:
      "prepare_governed_autonomous_pre_t90_window:{date}:09",
  },
  {
    name: "prepare_governed_autonomous_pre_t90_window_evening",
    kind: "prepare_governed_autonomous_pre_t90_window",
    cron_expr: "26 17 * * *",
    priority: 3,
    payload: {
      phase: "T-94",
      publish_hour_utc: 19,
      maximum_start_lateness_seconds: 60,
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
    idempotencyTemplate:
      "prepare_governed_autonomous_pre_t90_window:{date}:19",
  },
  {
    name: "governed_youtube_runway_t90_morning",
    kind: "governed_youtube_runway_t90",
    cron_expr: "30 7 * * *",
    priority: 4,
    payload: {
      phase: "T-90",
      publish_hour_utc: 9,
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
    idempotencyTemplate:
      "governed_youtube_runway_t90:{date}:09",
  },
  {
    name: "governed_youtube_runway_t90_evening",
    kind: "governed_youtube_runway_t90",
    cron_expr: "30 17 * * *",
    priority: 4,
    payload: {
      phase: "T-90",
      publish_hour_utc: 19,
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
    idempotencyTemplate:
      "governed_youtube_runway_t90:{date}:19",
  },
  {
    name: "governed_youtube_runway_tplus15_morning",
    kind: "governed_youtube_runway_tplus15",
    cron_expr: "15 9 * * *",
    priority: 4,
    payload: {
      phase: "T+15",
      publish_hour_utc: 9,
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
    idempotencyTemplate:
      "governed_youtube_runway_tplus15:{date}:09",
  },
  {
    name: "governed_youtube_runway_tplus15_evening",
    kind: "governed_youtube_runway_tplus15",
    cron_expr: "15 19 * * *",
    priority: 4,
    payload: {
      phase: "T+15",
      publish_hour_utc: 19,
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
    idempotencyTemplate:
      "governed_youtube_runway_tplus15:{date}:19",
  },
  {
    name: "governed_youtube_runway_slo_monitor",
    kind: "governed_youtube_runway_slo_monitor",
    cron_expr: "*/1 * * * *",
    priority: 3,
    payload: {
      phase: "SLO_MONITOR",
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
    idempotencyTemplate:
      "governed_youtube_runway_slo_monitor:{date}:{hour}:{minute}",
  },
  {
    name: "governed_youtube_window_checkpoint_prime_daily",
    kind: "prime_governed_youtube_window_checkpoints",
    cron_expr: "5 0 * * *",
    priority: 3,
    payload: {
      planning_only: true,
      horizon_hours: 36,
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
    idempotencyTemplate:
      "governed_youtube_window_checkpoint_prime:{date}",
  },
  {
    name: "governed_editorial_evidence_backfill",
    kind: "governed_editorial_evidence_backfill",
    cron_expr: "5 */2 * * *",
    priority: 13,
    payload: {
      live_publish_enabled: false,
      planning_only: true,
      publish_authority: false,
      human_admission_required: true,
      human_review_required: true,
    },
    idempotencyTemplate:
      "governed_editorial_evidence_backfill:{date}:{hour}",
  },
  {
    name: "editorial_inventory_reconcile",
    kind: "reconcile_editorial_inventory",
    cron_expr: "*/30 * * * *",
    priority: 21,
    payload: {
      live_publish_enabled: false,
      planning_only: true,
      publish_authority: false,
      human_admission_required: true,
      human_review_required: true,
    },
    idempotencyTemplate:
      "reconcile_editorial_inventory:{date}:{hour}:{minute}",
  },
  {
    name: "evergreen_candidate_builder",
    kind: "evergreen_candidate_builder",
    cron_expr: "30 */6 * * *",
    priority: 24,
    payload: {
      live_publish_enabled: false,
      planning_only: true,
    },
    idempotencyTemplate:
      "evergreen_candidate_builder:{date}:{hour}",
  },
  {
    name: "longform_evidence_refresh",
    kind: "longform_evidence_refresh",
    cron_expr: "15 5 * * *",
    priority: 42,
    payload: {
      live_publish_enabled: false,
      human_admission_required: true,
    },
    idempotencyTemplate: "longform_evidence_refresh:{date}",
  },
  {
    name: "weekly_longform_planner",
    kind: "plan_weekly_longform",
    cron_expr: "15 */6 * * *",
    priority: 32,
    payload: {
      live_publish_enabled: false,
      planning_only: true,
      human_admission_required: true,
    },
    idempotencyTemplate:
      "plan_weekly_longform:{iso_week}:{date}:{hour}",
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
    priority: 99,
    idempotencyTemplate: "jobs_reap:{date}:{hour}:{minute}",
  },
  {
    name: "external_creative_critic_queue_reconcile",
    kind: "external_creative_critic_queue_reconcile",
    cron_expr: "* * * * *",
    priority: 100,
    payload: {
      advisory_only: true,
      publish_authority: false,
      external_posting: false,
    },
    idempotencyTemplate:
      "external_creative_critic_queue_reconcile:{date}:{hour}:{minute}",
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

const LEGACY_SCHEDULER_PROFILE = "legacy";
const STABILISATION_SCHEDULER_PROFILE = "stabilisation_30d";
const MULTI_LANE_SCHEDULER_PROFILE = "governed_multi_lane";
const STABILISATION_ACTIVE_SCHEDULES = new Set([
  "hunt_morning",
  "hunt_mid_morning",
  "hunt_afternoon",
  "hunt_evening",
  "hunt_late",
  "produce_morning",
  "produce_primary",
  "publish_morning",
  "publish_primary",
  "analytics_morning",
  "analytics_evening",
  "governed_multi_lane_plan",
  "evergreen_candidate_builder",
  "longform_evidence_refresh",
  "weekly_longform_planner",
  "db_backup_daily",
  "jobs_reap_stale",
  "render_health_digest_daily",
]);
const STABILISATION_CADENCE_POLICY = Object.freeze({
  rolling_window_hours: 24,
  max_publish_windows: 2,
  minimum_gap_hours: 4,
  catch_up: false,
});
const MULTI_LANE_ACTIVE_SCHEDULES = new Set([
  "hunt_morning",
  "hunt_mid_morning",
  "hunt_afternoon",
  "hunt_evening",
  "hunt_late",
  "analytics_morning",
  "analytics_evening",
  "governed_multi_lane_plan",
  "governed_youtube_window_inventory_monitor",
  "plan_governed_autonomous_window_production_morning",
  "plan_governed_autonomous_window_production_evening",
  "prepare_governed_autonomous_pre_t90_window_morning",
  "prepare_governed_autonomous_pre_t90_window_evening",
  "governed_youtube_runway_t90_morning",
  "governed_youtube_runway_t90_evening",
  "governed_youtube_runway_tplus15_morning",
  "governed_youtube_runway_tplus15_evening",
  "governed_youtube_runway_slo_monitor",
  "governed_youtube_window_checkpoint_prime_daily",
  "governed_editorial_evidence_backfill",
  "editorial_inventory_reconcile",
  "evergreen_candidate_builder",
  "weekly_longform_planner",
  "db_backup_daily",
  "jobs_reap_stale",
  "external_creative_critic_queue_reconcile",
  "render_health_digest_daily",
]);

function cloneSchedule(schedule) {
  const cloned = { ...schedule };
  if (schedule.payload) cloned.payload = { ...schedule.payload };
  return cloned;
}

const GOVERNED_YOUTUBE_RUNWAY_SCHEDULE_EXPECTATIONS =
  Object.freeze([
    Object.freeze({
      name: "governed_youtube_runway_t90_morning",
      kind: "governed_youtube_runway_t90",
      cron_expr: "30 7 * * *",
      publish_hour_utc: 9,
    }),
    Object.freeze({
      name: "governed_youtube_runway_t90_evening",
      kind: "governed_youtube_runway_t90",
      cron_expr: "30 17 * * *",
      publish_hour_utc: 19,
    }),
    Object.freeze({
      name: "governed_youtube_runway_tplus15_morning",
      kind: "governed_youtube_runway_tplus15",
      cron_expr: "15 9 * * *",
      publish_hour_utc: 9,
    }),
    Object.freeze({
      name: "governed_youtube_runway_tplus15_evening",
      kind: "governed_youtube_runway_tplus15",
      cron_expr: "15 19 * * *",
      publish_hour_utc: 19,
    }),
  ]);
const GOVERNED_AUTONOMOUS_WINDOW_PRODUCTION_PLAN_SCHEDULE_EXPECTATIONS =
  Object.freeze([
    Object.freeze({
      name: "plan_governed_autonomous_window_production_morning",
      kind: "plan_governed_autonomous_window_production",
      cron_expr: "35 6 * * *",
      phase: "AUTONOMOUS_WINDOW_PRODUCTION_PLAN",
      publish_hour_utc: 9,
      job_max_attempts: 8,
    }),
    Object.freeze({
      name: "plan_governed_autonomous_window_production_evening",
      kind: "plan_governed_autonomous_window_production",
      cron_expr: "35 16 * * *",
      phase: "AUTONOMOUS_WINDOW_PRODUCTION_PLAN",
      publish_hour_utc: 19,
      job_max_attempts: 8,
    }),
  ]);
const GOVERNED_AUTONOMOUS_PRE_T90_SCHEDULE_EXPECTATIONS =
  Object.freeze([
    Object.freeze({
      name: "prepare_governed_autonomous_pre_t90_window_morning",
      kind: "prepare_governed_autonomous_pre_t90_window",
      cron_expr: "26 7 * * *",
      phase: "T-94",
      publish_hour_utc: 9,
      maximum_start_lateness_seconds: 60,
    }),
    Object.freeze({
      name: "prepare_governed_autonomous_pre_t90_window_evening",
      kind: "prepare_governed_autonomous_pre_t90_window",
      cron_expr: "26 17 * * *",
      phase: "T-94",
      publish_hour_utc: 19,
      maximum_start_lateness_seconds: 60,
    }),
  ]);

function governedYoutubeRunwayScheduleContract(
  schedules = [],
) {
  const blockers = [];
  for (const expected of
    GOVERNED_YOUTUBE_RUNWAY_SCHEDULE_EXPECTATIONS) {
    const schedule = schedules.find(
      (entry) => entry?.name === expected.name,
    );
    if (!schedule) {
      blockers.push(`runway_schedule_missing:${expected.name}`);
      continue;
    }
    if (
      schedule.kind !== expected.kind ||
      schedule.cron_expr !== expected.cron_expr ||
      Number(schedule.payload?.publish_hour_utc) !==
        expected.publish_hour_utc ||
      schedule.payload?.catch_up_allowed !== false ||
      schedule.payload?.publish_authority !== false ||
      schedule.payload?.external_posting !== false
    ) {
      blockers.push(`runway_schedule_drifted:${expected.name}`);
    }
  }
  const actualRunwayCount = schedules.filter((schedule) =>
    [
      "governed_youtube_runway_t90",
      "governed_youtube_runway_tplus15",
    ].includes(schedule?.kind),
  ).length;
  if (
    actualRunwayCount !==
    GOVERNED_YOUTUBE_RUNWAY_SCHEDULE_EXPECTATIONS.length
  ) {
    blockers.push("runway_schedule_count_must_equal_four");
  }
  let autonomousProductionPlanningEnabled = true;
  for (const expected of
    GOVERNED_AUTONOMOUS_WINDOW_PRODUCTION_PLAN_SCHEDULE_EXPECTATIONS) {
    const schedule = schedules.find(
      (entry) => entry?.name === expected.name,
    );
    if (!schedule) {
      blockers.push(
        `autonomous_production_plan_schedule_missing:${expected.name}`,
      );
      autonomousProductionPlanningEnabled = false;
      continue;
    }
    if (
      schedule.kind !== expected.kind ||
      schedule.cron_expr !== expected.cron_expr ||
      schedule.payload?.phase !== expected.phase ||
      Number(schedule.payload?.publish_hour_utc) !==
        expected.publish_hour_utc ||
      Number(schedule.payload?.job_max_attempts) !==
        expected.job_max_attempts ||
      schedule.payload?.scheduler_profile !==
        MULTI_LANE_SCHEDULER_PROFILE ||
      schedule.payload?.catch_up_allowed !== false ||
      schedule.payload?.publish_authority !== false ||
      schedule.payload?.external_posting !== false
    ) {
      blockers.push(
        `autonomous_production_plan_schedule_drifted:${expected.name}`,
      );
      autonomousProductionPlanningEnabled = false;
    }
  }
  const autonomousProductionPlanScheduleCount =
    schedules.filter(
      (schedule) =>
        schedule?.kind ===
        "plan_governed_autonomous_window_production",
    ).length;
  if (
    autonomousProductionPlanScheduleCount !==
    GOVERNED_AUTONOMOUS_WINDOW_PRODUCTION_PLAN_SCHEDULE_EXPECTATIONS.length
  ) {
    blockers.push(
      "autonomous_production_plan_schedule_count_must_equal_two",
    );
    autonomousProductionPlanningEnabled = false;
  }
  let autonomousPreT90PreparationEnabled = true;
  for (const expected of
    GOVERNED_AUTONOMOUS_PRE_T90_SCHEDULE_EXPECTATIONS) {
    const schedule = schedules.find(
      (entry) => entry?.name === expected.name,
    );
    if (!schedule) {
      blockers.push(
        `autonomous_pre_t90_schedule_missing:${expected.name}`,
      );
      autonomousPreT90PreparationEnabled = false;
      continue;
    }
    if (
      schedule.kind !== expected.kind ||
      schedule.cron_expr !== expected.cron_expr ||
      schedule.payload?.phase !== expected.phase ||
      Number(schedule.payload?.publish_hour_utc) !==
        expected.publish_hour_utc ||
      Number(
        schedule.payload?.maximum_start_lateness_seconds,
      ) !== expected.maximum_start_lateness_seconds ||
      schedule.payload?.scheduler_profile !==
        MULTI_LANE_SCHEDULER_PROFILE ||
      schedule.payload?.catch_up_allowed !== false ||
      schedule.payload?.publish_authority !== false ||
      schedule.payload?.external_posting !== false
    ) {
      blockers.push(
        `autonomous_pre_t90_schedule_drifted:${expected.name}`,
      );
      autonomousPreT90PreparationEnabled = false;
    }
  }
  const autonomousPreT90ScheduleCount = schedules.filter(
    (schedule) =>
      schedule?.kind ===
      "prepare_governed_autonomous_pre_t90_window",
  ).length;
  if (
    autonomousPreT90ScheduleCount !==
    GOVERNED_AUTONOMOUS_PRE_T90_SCHEDULE_EXPECTATIONS.length
  ) {
    blockers.push(
      "autonomous_pre_t90_schedule_count_must_equal_two",
    );
    autonomousPreT90PreparationEnabled = false;
  }
  const monitor = schedules.find(
    (schedule) =>
      schedule?.name ===
      "governed_youtube_runway_slo_monitor",
  );
  const recoveryMonitorEnabled =
    monitor?.kind ===
      "governed_youtube_runway_slo_monitor" &&
    monitor?.cron_expr === "*/1 * * * *" &&
    monitor?.payload?.catch_up_allowed === false &&
    monitor?.payload?.publish_authority === false &&
    monitor?.payload?.external_posting === false;
  if (!recoveryMonitorEnabled) {
    blockers.push("runway_slo_monitor_missing_or_drifted");
  }
  const candidateInventoryMonitor = schedules.find(
    (schedule) =>
      schedule?.name ===
      "governed_youtube_window_inventory_monitor",
  );
  const candidateInventoryMonitorEnabled =
    candidateInventoryMonitor?.kind ===
      "governed_youtube_window_inventory_monitor" &&
    candidateInventoryMonitor?.cron_expr ===
      "*/5 * * * *" &&
    Number(
      candidateInventoryMonitor?.payload?.horizon_hours,
    ) === 36 &&
    candidateInventoryMonitor?.payload
      ?.human_review_required === true &&
    candidateInventoryMonitor?.payload
      ?.catch_up_allowed === false &&
    candidateInventoryMonitor?.payload
      ?.publish_authority === false &&
    candidateInventoryMonitor?.payload
      ?.external_posting === false;
  if (!candidateInventoryMonitorEnabled) {
    blockers.push(
      "runway_candidate_inventory_monitor_missing_or_drifted",
    );
  }
  const dailyPrime = schedules.find(
    (schedule) =>
      schedule?.name ===
      "governed_youtube_window_checkpoint_prime_daily",
  );
  const dailyHorizonPrimingEnabled =
    dailyPrime?.kind ===
      "prime_governed_youtube_window_checkpoints" &&
    dailyPrime?.cron_expr === "5 0 * * *" &&
    Number(dailyPrime?.payload?.horizon_hours) === 36 &&
    dailyPrime?.payload?.catch_up_allowed === false &&
    dailyPrime?.payload?.publish_authority === false &&
    dailyPrime?.payload?.external_posting === false;
  if (!dailyHorizonPrimingEnabled) {
    blockers.push(
      "runway_daily_horizon_priming_missing_or_drifted",
    );
  }
  return {
    schema_version:
      "pulse-governed-youtube-runway-schedule-contract-v1",
    verdict: blockers.length ? "HOLD" : "GREEN",
    schedule_count: actualRunwayCount,
    blockers: [...new Set(blockers)],
    expected: GOVERNED_YOUTUBE_RUNWAY_SCHEDULE_EXPECTATIONS.map(
      (entry) => ({ ...entry }),
    ),
    autonomous_production_plan_schedule_count:
      autonomousProductionPlanScheduleCount,
    autonomous_pre_t90_schedule_count:
      autonomousPreT90ScheduleCount,
    autonomous_production_planning_enabled:
      autonomousProductionPlanningEnabled,
    autonomous_pre_t90_preparation_enabled:
      autonomousPreT90PreparationEnabled,
    utc_only: true,
    catch_up_allowed: false,
    publish_authority: false,
    recovery_monitor_enabled: recoveryMonitorEnabled,
    candidate_inventory_monitor_enabled:
      candidateInventoryMonitorEnabled,
    daily_horizon_priming_enabled:
      dailyHorizonPrimingEnabled,
  };
}

function schedulesForProfile(
  profile = LEGACY_SCHEDULER_PROFILE,
  { livePublishEnabled = false } = {},
) {
  const selected = String(profile || LEGACY_SCHEDULER_PROFILE).trim();
  if (selected === LEGACY_SCHEDULER_PROFILE) {
    return DEFAULT_SCHEDULES.map(cloneSchedule);
  }
  if (selected === MULTI_LANE_SCHEDULER_PROFILE) {
    return DEFAULT_SCHEDULES.filter((schedule) =>
      MULTI_LANE_ACTIVE_SCHEDULES.has(schedule.name),
    ).map((schedule) => {
      const cloned = cloneSchedule(schedule);
      const planningOnly =
        cloned.payload?.planning_only === true;
      cloned.payload = {
        ...(cloned.payload || {}),
        scheduler_profile: MULTI_LANE_SCHEDULER_PROFILE,
        governed_multi_lane: true,
        live_publish_enabled:
          planningOnly ? false : livePublishEnabled === true,
        human_admission_required: true,
      };
      return cloned;
    });
  }
  if (selected !== STABILISATION_SCHEDULER_PROFILE) {
    throw new Error(`unknown_scheduler_profile:${selected}`);
  }
  return DEFAULT_SCHEDULES.filter((schedule) =>
    STABILISATION_ACTIVE_SCHEDULES.has(schedule.name),
  ).map((schedule) => {
    const cloned = cloneSchedule(schedule);
    if (cloned.kind !== "publish") return cloned;
    cloned.payload = {
      ...(cloned.payload || {}),
      target_platform: "youtube",
      scheduler_profile: STABILISATION_SCHEDULER_PROFILE,
      cadence_policy: { ...STABILISATION_CADENCE_POLICY },
    };
    return cloned;
  });
}

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

function utcTimestampMs(value) {
  if (!value) return null;
  let normalised = String(value).trim();
  if (
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(normalised)
  ) {
    normalised = `${normalised.replace(" ", "T")}Z`;
  }
  const parsed = Date.parse(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

function evaluateStabilisationPublishCadence({
  db,
  now = new Date(),
  excludeJobId = null,
} = {}) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("scheduler_cadence_database_required");
  }
  const effectiveNow = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(effectiveNow.getTime())) {
    throw new Error("scheduler_cadence_time_invalid");
  }
  const rollingCutoff = new Date(
    effectiveNow.getTime() -
      STABILISATION_CADENCE_POLICY.rolling_window_hours * 60 * 60 * 1000,
  ).toISOString();
  const recent = db
    .prepare(`
      WITH ledger_candidates AS (
        SELECT
          COALESCE(
            NULLIF(TRIM(external_id), ''),
            NULLIF(
              TRIM(
                CASE
                  WHEN json_valid(
                    COALESCE(verification_evidence_json, '')
                  ) = 1
                  THEN json_extract(
                    verification_evidence_json,
                    '$.external_id'
                  )
                END
              ),
              ''
            )
          ) AS verified_external_id,
          created_at AS publication_at
        FROM platform_dispatch_ledger
        WHERE LOWER(platform) = 'youtube'
          AND UPPER(event_type) = 'PUBLISHED'
          AND LOWER(verification_status) = 'confirmed'
          AND julianday(created_at) IS NOT NULL
      ),
      publication_evidence AS (
        SELECT
          'youtube:' || TRIM(external_id) AS publication_key,
          published_at AS publication_at
        FROM platform_posts
        WHERE LOWER(platform) = 'youtube'
          AND LOWER(status) = 'published'
          AND NULLIF(TRIM(external_id), '') IS NOT NULL
          AND julianday(published_at) IS NOT NULL

        UNION ALL

        SELECT
          'youtube:' || verified_external_id AS publication_key,
          publication_at
        FROM ledger_candidates
        WHERE verified_external_id IS NOT NULL
      ),
      canonical_publications AS (
        SELECT
          publication_key,
          MIN(julianday(publication_at)) AS published_julian_day
        FROM publication_evidence
        GROUP BY publication_key
      )
      SELECT
        publication_key,
        strftime(
          '%Y-%m-%dT%H:%M:%fZ',
          published_julian_day
        ) AS published_at
      FROM canonical_publications
      WHERE published_julian_day > julianday(?)
      ORDER BY published_julian_day DESC, publication_key
    `)
    .all(rollingCutoff);
  if (
    recent.length >= STABILISATION_CADENCE_POLICY.max_publish_windows
  ) {
    return {
      allowed: false,
      reason: "stabilisation_rolling_publish_limit",
      recent_count: recent.length,
    };
  }
  const normalisedExcludedJobId = Number(excludeJobId);
  const excludedJobId =
    Number.isInteger(normalisedExcludedJobId) &&
    normalisedExcludedJobId > 0
      ? normalisedExcludedJobId
      : 0;
  const activeJobCount = Number(
    db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM jobs
        WHERE kind = 'publish'
          AND status IN ('pending', 'claimed', 'running')
          AND (? = 0 OR id <> ?)
      `)
      .get(excludedJobId, excludedJobId)?.count || 0,
  );
  if (activeJobCount > 0) {
    return {
      allowed: false,
      reason: "stabilisation_publish_job_already_active",
      recent_count: recent.length,
      active_job_count: activeJobCount,
    };
  }
  const latestAt = utcTimestampMs(recent[0]?.published_at);
  const minimumGapMs =
    STABILISATION_CADENCE_POLICY.minimum_gap_hours * 60 * 60 * 1000;
  if (
    latestAt !== null &&
    effectiveNow.getTime() - latestAt < minimumGapMs
  ) {
    return {
      allowed: false,
      reason: "stabilisation_minimum_publish_gap",
      recent_count: recent.length,
      latest_at: new Date(latestAt).toISOString(),
    };
  }
  return {
    allowed: true,
    reason: null,
    recent_count: recent.length,
    latest_at: latestAt === null ? null : new Date(latestAt).toISOString(),
  };
}

/**
 * Write DEFAULT_SCHEDULES into the `schedules` table. Idempotent: rows
 * are left alone if they already exist, unless `{ reset: true }` is
 * passed, in which case cron_expr/payload/priority are overwritten.
 *
 * This is not called automatically on boot — you invoke it once per
 * deployment (e.g. on container start or via `node lib/scheduler.js seed`).
 */
function seed({
  reset = false,
  log = console.log,
  repos = null,
  profile = process.env.PULSE_SCHEDULER_PROFILE ||
    STABILISATION_SCHEDULER_PROFILE,
  env = process.env,
} = {}) {
  const { db } = repos || getRepos();
  const selectedProfile = String(profile).trim();
  const {
    governedLivePublishRequested,
  } = require("./services/multi-lane-runtime-control");
  const selectedSchedules = schedulesForProfile(selectedProfile, {
    livePublishEnabled: governedLivePublishRequested({
      env,
      schedulerProfile: selectedProfile,
    }),
  });
  const reconcileProfile =
    selectedProfile !== LEGACY_SCHEDULER_PROFILE;
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
  const reconcile = db.prepare(`
    UPDATE schedules
    SET kind = ?,
        channel_id = ?,
        cron_expr = ?,
        payload = ?,
        enabled = 1,
        requires_gpu = ?,
        priority = ?
    WHERE name = ?
  `);
  const disableOutsideProfile = reconcileProfile
    ? db.prepare(`
        UPDATE schedules
        SET enabled = 0
        WHERE enabled <> 0
          AND name NOT IN (${selectedSchedules.map(() => "?").join(", ")})
      `)
    : null;

  let added = 0;
  let updated = 0;
  let disabled = 0;
  const txn = db.transaction(() => {
    for (const s of selectedSchedules) {
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
      } else if (reconcileProfile) {
        reconcile.run(
          s.kind,
          s.channel_id || null,
          s.cron_expr,
          payload,
          s.requires_gpu ? 1 : 0,
          s.priority ?? 50,
          s.name,
        );
        updated++;
      } else if (reset) {
        update.run(s.cron_expr, payload, s.priority ?? 50, s.kind, s.name);
        updated++;
      }
    }
    if (disableOutsideProfile) {
      disabled = disableOutsideProfile.run(
        ...selectedSchedules.map((schedule) => schedule.name),
      ).changes;
    }
  });
  if (typeof txn.immediate === "function") txn.immediate();
  else txn();
  log(
    `[scheduler] seed profile=${selectedProfile}: +${added} added, ` +
      `~${updated} updated, -${disabled} disabled`,
  );
  return { profile: selectedProfile, added, updated, disabled };
}

/**
 * Start the cron-based dispatcher. For every enabled schedule row in
 * the DB, register a node-cron handler that (a) builds an idempotency
 * key from the template and (b) calls jobs.enqueue().
 *
 * Returns a stop() function that cancels every registered task.
 */
function startUnlocked({
  log = console.log,
  repos = null,
  cronImpl = cron,
  assertLeaseHealthy = () => true,
  nowProvider = () => new Date(),
} = {}) {
  const { jobs, db } = repos || getRepos();
  const rows = db
    .prepare(`SELECT * FROM schedules WHERE enabled = 1 ORDER BY id`)
    .all();
  const getCurrentSchedule = db.prepare(
    "SELECT * FROM schedules WHERE id = ?",
  );

  const tasks = [];
  for (const row of rows) {
    if (!cronImpl.validate(row.cron_expr)) {
      log(
        `[scheduler] skipping ${row.name}: invalid cron_expr "${row.cron_expr}"`,
      );
      continue;
    }
    const task = cronImpl.schedule(
      row.cron_expr,
      () => {
        const currentRow = getCurrentSchedule.get(row.id);
        if (!currentRow || currentRow.enabled !== 1) {
          log(`[scheduler] skipped ${row.name}: schedule_disabled`);
          return;
        }
        if (currentRow.cron_expr !== row.cron_expr) {
          log(`[scheduler] skipped ${row.name}: schedule_definition_changed`);
          return;
        }
        let parsed = {};
        try {
          parsed = currentRow.payload
            ? JSON.parse(currentRow.payload)
            : {};
        } catch {
          log(`[scheduler] skipped ${row.name}: schedule_payload_invalid`);
          return;
        }
        const template = parsed.idempotencyTemplate;
        const stabilisationPublish =
          currentRow.kind === "publish" &&
          parsed.scheduler_profile === STABILISATION_SCHEDULER_PROFILE &&
          parsed.target_platform === "youtube";
        let basePayload = { ...parsed };
        delete basePayload.idempotencyTemplate;
        const jobMaxAttempts =
          basePayload.job_max_attempts === undefined
            ? null
            : Number(basePayload.job_max_attempts);
        delete basePayload.job_max_attempts;
        if (
          jobMaxAttempts !== null &&
          (!Number.isInteger(jobMaxAttempts) ||
            jobMaxAttempts < 1 ||
            jobMaxAttempts > 100)
        ) {
          log(
            `[scheduler] skipped ${row.name}: schedule_job_max_attempts_invalid`,
          );
          return;
        }
        const now = nowProvider();
        const idempotency_key = expandIdempotency(template, now);
        try {
          basePayload = bindAutonomousWindowScheduledFor({
            kind: currentRow.kind,
            payload: basePayload,
            now,
          });
          const fireTransaction = db.transaction(() => {
            if (!assertLeaseHealthy()) {
              throw new Error("scheduler_lease_lost");
            }
            if (stabilisationPublish) {
              const cadence = evaluateStabilisationPublishCadence({ db, now });
              if (!cadence.allowed) {
                return { skipped: true, cadence };
              }
            }
            const job = jobs.enqueue({
              kind: currentRow.kind,
              channel_id: currentRow.channel_id || null,
              payload: basePayload,
              priority: currentRow.priority ?? 50,
              requires_gpu: !!currentRow.requires_gpu,
              idempotency_key,
              ...(jobMaxAttempts === null
                ? {}
                : {
                    max_attempts: jobMaxAttempts,
                  }),
            });
            db.prepare(
              `UPDATE schedules SET last_enqueued_at = datetime('now') WHERE id = ?`,
            ).run(row.id);
            return { skipped: false, job };
          });
          const outcome = fireTransaction.immediate();
          if (outcome.skipped) {
            log(
              `[scheduler] skipped ${row.name}: ${outcome.cadence.reason} ` +
                `(recent=${outcome.cadence.recent_count})`,
            );
          } else if (shouldLogScheduleEnqueue(currentRow)) {
            log(
              `[scheduler] fired ${row.name} → job #${outcome.job.id} (${currentRow.kind}) key=${idempotency_key}`,
            );
          }
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

function start({
  log = console.log,
  ownerId = defaultSchedulerOwnerId(),
  heartbeatIntervalMs = Math.floor(DEFAULT_SCHEDULER_LEASE_MS / 3),
  monitorIntervalMs = heartbeatIntervalMs,
  repos = null,
  cronImpl = cron,
  nowProvider = () => new Date(),
} = {}) {
  const resolvedRepos = repos || getRepos();
  let active = false;
  let stopped = false;
  let lease = null;
  let inner = null;
  let monitor = null;
  const deactivate = () => {
    if (inner) inner.stop();
    inner = null;
    active = false;
  };
  const heartbeatNow = () => {
    if (!active) return false;
    let healthy = false;
    try {
      healthy = heartbeatSchedulerLease({
        leases: resolvedRepos.runtimeLeases,
        ownerId,
      });
    } catch (error) {
      log(`[scheduler] scheduler lease heartbeat failed: ${error.message}`);
    }
    if (!healthy) {
      log("[scheduler] scheduler lease lost; stopping all cron tasks");
      deactivate();
    }
    return healthy;
  };

  const retryNow = ({ throwOnRegistrationFailure = false } = {}) => {
    if (stopped) return false;
    if (active) return true;
    let candidate;
    try {
      candidate = acquireSchedulerLease({
        leases: resolvedRepos.runtimeLeases,
        ownerId,
        metadata: { process_id: process.pid },
      });
    } catch (error) {
      log(`[scheduler] scheduler_lease_unavailable: ${error.message}`);
      return false;
    }
    lease = candidate;
    if (!candidate.acquired) {
      log(
        `[scheduler] scheduler_lease_unavailable: held by another owner until ${candidate.expires_at}`,
      );
      return false;
    }

    active = true;
    try {
      inner = startUnlocked({
        log,
        repos: resolvedRepos,
        cronImpl,
        nowProvider,
        assertLeaseHealthy() {
          if (!heartbeatNow()) throw new Error("scheduler_lease_lost");
          return true;
        },
      });
      log(`[scheduler] scheduler lease acquired by ${ownerId}`);
      return true;
    } catch (error) {
      deactivate();
      releaseSchedulerLease({
        leases: resolvedRepos.runtimeLeases,
        ownerId,
      });
      lease = null;
      if (throwOnRegistrationFailure) throw error;
      log(`[scheduler] schedule registration failed: ${error.message}`);
      return false;
    }
  };

  retryNow({ throwOnRegistrationFailure: true });
  monitor = setInterval(
    () => {
      if (active) heartbeatNow();
      else retryNow();
    },
    Math.max(1000, Number(monitorIntervalMs) || 30_000),
  );
  monitor.unref?.();

  return {
    get active() {
      return active;
    },
    get blocked_reason() {
      return active ? null : "scheduler_lease_unavailable";
    },
    get lease() {
      return lease;
    },
    get tasks() {
      return inner?.tasks || [];
    },
    heartbeatNow,
    retryNow,
    stop() {
      if (stopped) return;
      stopped = true;
      if (monitor) clearInterval(monitor);
      const owned = active && lease?.acquired;
      deactivate();
      if (owned) {
        releaseSchedulerLease({
          leases: resolvedRepos.runtimeLeases,
          ownerId,
        });
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
  GOVERNED_AUTONOMOUS_PRE_T90_SCHEDULE_EXPECTATIONS,
  GOVERNED_AUTONOMOUS_WINDOW_PRODUCTION_PLAN_SCHEDULE_EXPECTATIONS,
  LEGACY_SCHEDULER_PROFILE,
  STABILISATION_SCHEDULER_PROFILE,
  MULTI_LANE_SCHEDULER_PROFILE,
  STABILISATION_CADENCE_POLICY,
  GOVERNED_YOUTUBE_RUNWAY_SCHEDULE_EXPECTATIONS,
  evaluateStabilisationPublishCadence,
  governedYoutubeRunwayScheduleContract,
  schedulesForProfile,
  seed,
  start,
  expandIdempotency,
  shouldLogScheduleEnqueue,
};

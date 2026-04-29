/**
 * lib/services/scheduler-plan.js — build the human-readable
 * payload for GET /api/scheduler/plan.
 *
 * Operators asked for a single endpoint that surfaces:
 *   - every registered schedule
 *   - its cron + human time
 *   - which lane it belongs to (normal / maintenance / analytics /
 *     auth-check / engagement / roundup)
 *   - whether it's enabled
 *
 * Pure / sync. No DB read. Consumes the DEFAULT_SCHEDULES export
 * from lib/scheduler so the doc stays in lock-step with the
 * runtime. Production's `schedules` SQLite table may diverge if
 * an operator toggles `enabled` via SQL — this plan endpoint
 * reflects the DEFAULT list (the source of truth in code); a
 * future follow-up can join against the live rows.
 */

// Lane classification by schedule name (stable) or kind (fallback).
const LANE_BY_NAME = {
  produce_morning: "normal",
  produce_afternoon: "normal",
  produce_primary: "normal",
  publish_morning: "normal",
  publish_afternoon: "normal",
  publish_primary: "normal",
  hunt_morning: "hunt",
  hunt_mid_morning: "hunt",
  hunt_afternoon: "hunt",
  hunt_evening: "hunt",
  hunt_late: "hunt",
  tiktok_auth_check: "auth-check",
  engage_after_publish: "engagement",
  engage_first_hour_sweep: "engagement",
  analytics_morning: "analytics",
  analytics_evening: "analytics",
  studio_analytics_loop: "analytics",
  scoring_digest_daily: "analytics",
  render_health_digest_daily: "analytics",
  timing_reanalysis_weekly: "analytics",
  weekly_roundup: "roundup",
  monthly_topic_compilations: "roundup",
  instagram_token_refresh: "auth-check",
  instagram_pending_verify_hourly: "auth-check",
  blog_rebuild_daily: "maintenance",
  db_backup_daily: "maintenance",
  jobs_reap_stale: "maintenance",
};

const LANE_BY_KIND = {
  produce: "normal",
  publish: "normal",
  hunt: "hunt",
  tiktok_auth_check: "auth-check",
  engage: "engagement",
  engage_first_hour: "engagement",
  analytics: "analytics",
  studio_analytics_loop: "analytics",
  scoring_digest: "analytics",
  render_health_digest: "analytics",
  timing_reanalysis: "analytics",
  roundup_weekly: "roundup",
  roundup_monthly_topics: "roundup",
  instagram_token_refresh: "auth-check",
  instagram_pending_verify: "auth-check",
  blog_rebuild: "maintenance",
  db_backup: "maintenance",
  jobs_reap: "maintenance",
};

function laneFor(schedule) {
  return LANE_BY_NAME[schedule.name] || LANE_BY_KIND[schedule.kind] || "other";
}

/**
 * Render a cron expression as a human-readable UTC time string
 * ONLY for the simple "M H * * *" case we use. Everything more
 * exotic (e.g. `*\/1 * * * *`, `0 0 * * 0`) returns the raw
 * cron expression so the operator still sees something useful.
 */
function humaniseCron(cronExpr) {
  if (typeof cronExpr !== "string") return null;
  // M H * * *  → daily at HH:MM UTC
  const dailyMatch = cronExpr.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (dailyMatch) {
    const mm = dailyMatch[1].padStart(2, "0");
    const hh = dailyMatch[2].padStart(2, "0");
    return `daily ${hh}:${mm} UTC`;
  }
  // M H * * D  → weekly
  const weeklyMatch = cronExpr.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+(\d+)$/);
  if (weeklyMatch) {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const d = days[parseInt(weeklyMatch[3], 10)] || `day${weeklyMatch[3]}`;
    const mm = weeklyMatch[1].padStart(2, "0");
    const hh = weeklyMatch[2].padStart(2, "0");
    return `weekly ${d} ${hh}:${mm} UTC`;
  }
  // M H D * *  → monthly
  const monthlyMatch = cronExpr.match(/^(\d+)\s+(\d+)\s+(\d+)\s+\*\s+\*$/);
  if (monthlyMatch) {
    const dom = monthlyMatch[3];
    const mm = monthlyMatch[1].padStart(2, "0");
    const hh = monthlyMatch[2].padStart(2, "0");
    return `monthly day-${dom} ${hh}:${mm} UTC`;
  }
  // */N  interval
  const intervalMatch = cronExpr.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (intervalMatch) {
    return `every ${intervalMatch[1]} min`;
  }
  return cronExpr;
}

/**
 * Shape one schedule into the API payload. Pure.
 */
function sanitiseScheduleEntry(schedule) {
  if (!schedule || typeof schedule !== "object") return null;
  const out = {
    name: schedule.name || null,
    kind: schedule.kind || null,
    cron_expr: schedule.cron_expr || null,
    human_time: humaniseCron(schedule.cron_expr),
    priority: typeof schedule.priority === "number" ? schedule.priority : null,
    lane: laneFor(schedule),
    enabled: schedule.enabled === undefined ? true : !!schedule.enabled,
  };
  return out;
}

/**
 * Build the full plan payload.
 *
 * @param {Array} schedules — typically DEFAULT_SCHEDULES
 */
function buildSchedulerPlan(schedules) {
  const list = Array.isArray(schedules) ? schedules : [];
  const items = list.map(sanitiseScheduleEntry).filter(Boolean);

  // Group counts for dashboard cards.
  const byLane = {};
  for (const it of items) {
    byLane[it.lane] = (byLane[it.lane] || 0) + 1;
  }

  // Quick sanity flags for the dashboard.
  const hasMorningPublish = items.some(
    (i) => i.name === "publish_morning" && i.enabled,
  );
  const hasAfternoonPublish = items.some(
    (i) => i.name === "publish_afternoon" && i.enabled,
  );
  const hasEveningPublish = items.some(
    (i) => i.name === "publish_primary" && i.enabled,
  );

  return {
    generated_at: new Date().toISOString(),
    total: items.length,
    by_lane: byLane,
    cadence_status: {
      morning_publish: hasMorningPublish,
      afternoon_publish: hasAfternoonPublish,
      evening_publish: hasEveningPublish,
      daily_publish_slots: [
        hasMorningPublish,
        hasAfternoonPublish,
        hasEveningPublish,
      ].filter(Boolean).length,
    },
    schedules: items.sort((a, b) => {
      // Stable display order: lane group, then cron_expr.
      const la = a.lane || "";
      const lb = b.lane || "";
      if (la !== lb) return la.localeCompare(lb);
      return (a.cron_expr || "").localeCompare(b.cron_expr || "");
    }),
  };
}

module.exports = {
  buildSchedulerPlan,
  sanitiseScheduleEntry,
  humaniseCron,
  laneFor,
  LANE_BY_NAME,
  LANE_BY_KIND,
};

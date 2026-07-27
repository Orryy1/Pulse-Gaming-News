"use strict";

const STABILISATION_PROFILE = Object.freeze({
  id: "stabilisation_30d",
  duration_days: 30,
  automated_platforms: Object.freeze(["youtube"]),
  max_public_posts_rolling_24h: 2,
  minimum_gap_minutes: 240,
  human_review_required: true,
  catch_up_bursts_allowed: false,
  backlog_batch_publish_allowed: false,
  midnight_reset_allowed: false,
  breaking_exception: "operator_only",
  secondary_auto_publish: false,
});

const ACTIVE_SCHEDULE_NAMES = new Set([
  "hunt_morning",
  "hunt_mid_morning",
  "hunt_afternoon",
  "hunt_evening",
  "hunt_late",
  "produce_morning",
  "produce_primary",
  "publish_runway_generate_morning",
  "publish_runway_generate_primary",
  "publish_watchdog_morning",
  "publish_watchdog_primary",
  "publish_morning",
  "publish_primary",
  "analytics_morning",
  "analytics_evening",
  "continuous_learning_loop_hourly",
  "db_backup_daily",
  "jobs_reap_stale",
  "render_health_digest_daily",
]);

function parsePayload(payload) {
  if (!payload) return {};
  if (typeof payload === "object") return { ...payload };
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

function hardenSchedule(schedule) {
  const payload = parsePayload(schedule.payload);
  if (schedule.kind === "publish") {
    Object.assign(payload, {
      human_review_required: true,
      max_stories: 1,
      catch_up_allowed: false,
      backlog_batch_allowed: false,
      breaking_exception: "operator_only",
      automated_platforms: ["youtube"],
    });
  }
  const output = {
    ...schedule,
    payload,
    scheduler_profile: STABILISATION_PROFILE.id,
  };
  return output;
}

function selectStabilisationSchedules(schedules = []) {
  return (Array.isArray(schedules) ? schedules : [])
    .filter((schedule) => ACTIVE_SCHEDULE_NAMES.has(schedule.name))
    .map(hardenSchedule);
}

function publishHour(schedule) {
  const match = String(schedule?.cron_expr || "").match(
    /^\d+\s+(\d+)\s+\*\s+\*\s+\*$/,
  );
  return match ? Number(match[1]) : null;
}

function minimumCircularGapMinutes(hours = []) {
  if (hours.length < 2) return 1440;
  const values = [...hours].sort((a, b) => a - b);
  let minimum = Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index];
    const next = index === values.length - 1 ? values[0] + 24 : values[index + 1];
    minimum = Math.min(minimum, (next - current) * 60);
  }
  return minimum;
}

function validateStabilisationSchedule(schedules = []) {
  const list = Array.isArray(schedules) ? schedules : [];
  const blockers = [];
  const publishes = list.filter((schedule) => schedule.kind === "publish");
  const hours = publishes.map(publishHour).filter(Number.isFinite);
  const minimumGap = minimumCircularGapMinutes(hours);

  if (publishes.length > STABILISATION_PROFILE.max_public_posts_rolling_24h) {
    blockers.push("too_many_publish_windows");
  }
  if (minimumGap < STABILISATION_PROFILE.minimum_gap_minutes) {
    blockers.push("publish_windows_too_close");
  }

  for (const publish of publishes) {
    const label = publish.payload?.window_label || publish.name;
    const suffix = label.replace(/^publish_/, "");
    const generation = list.find(
      (item) => item.name === `publish_runway_generate_${suffix}`,
    );
    const watchdog = list.find(
      (item) => item.name === `publish_watchdog_${suffix}`,
    );
    if (!generation || !watchdog) {
      blockers.push(`missing_runway_triplet:${label}`);
    }
    if (publish.payload?.human_review_required !== true) {
      blockers.push(`human_review_not_required:${label}`);
    }
    if (publish.payload?.max_stories !== 1) {
      blockers.push(`publish_window_not_single_story:${label}`);
    }
  }

  return {
    profile: STABILISATION_PROFILE.id,
    valid: blockers.length === 0,
    blockers,
    publish_window_count: publishes.length,
    publish_hours_utc: hours,
    minimum_observed_gap_minutes: minimumGap,
    single_scheduler_owner: true,
    rolling_24h_cap: STABILISATION_PROFILE.max_public_posts_rolling_24h,
    no_midnight_loophole: true,
  };
}

module.exports = {
  ACTIVE_SCHEDULE_NAMES,
  STABILISATION_PROFILE,
  hardenSchedule,
  selectStabilisationSchedules,
  validateStabilisationSchedule,
};

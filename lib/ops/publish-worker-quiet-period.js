"use strict";

const DEFAULT_PUBLISH_HOURS_UTC = Object.freeze([9, 11, 14, 16, 19]);
const QUIET_PERIOD_SAFE_KINDS = Object.freeze(["candidate_supply_monitor"]);

function boundedMinutes(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(180, Math.floor(number)));
}

function evaluatePublishWorkerQuietPeriod({
  now = new Date(),
  publishHoursUtc = DEFAULT_PUBLISH_HOURS_UTC,
  beforeMinutes = 15,
  afterMinutes = 20,
  kinds = [],
} = {}) {
  const current = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(current.getTime())) {
    throw new Error("publish worker quiet period requires a valid timestamp");
  }
  const before = boundedMinutes(beforeMinutes, 15);
  const after = boundedMinutes(afterMinutes, 20);
  const hours = Array.from(new Set(publishHoursUtc || []))
    .map(Number)
    .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);
  const dayStart = Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate(),
  );

  for (const dayOffset of [-1, 0, 1]) {
    for (const hour of hours) {
      const windowAt = new Date(
        dayStart + dayOffset * 24 * 60 * 60 * 1000 + hour * 60 * 60 * 1000,
      );
      const deltaMinutes = (current.getTime() - windowAt.getTime()) / 60000;
      if (deltaMinutes < -before || deltaMinutes > after) continue;
      const resumeAt = new Date(windowAt.getTime() + after * 60000);
      const configuredKinds = Array.from(new Set(kinds || []))
        .map((kind) => String(kind || "").trim())
        .filter(Boolean);
      if (
        configuredKinds.length > 0 &&
        configuredKinds.every((kind) => QUIET_PERIOD_SAFE_KINDS.includes(kind))
      ) {
        return {
          allow_claim: true,
          reason: "guarded_publish_window_safe_kinds",
          window_hour_utc: hour,
          window_at: windowAt.toISOString(),
          resume_at: resumeAt.toISOString(),
          retry_after_ms: 2000,
        };
      }
      return {
        allow_claim: false,
        reason: "guarded_publish_window_quiet_period",
        window_hour_utc: hour,
        window_at: windowAt.toISOString(),
        resume_at: resumeAt.toISOString(),
        retry_after_ms: Math.max(
          1000,
          Math.min(60_000, resumeAt.getTime() - current.getTime()),
        ),
      };
    }
  }

  return {
    allow_claim: true,
    reason: null,
    window_hour_utc: null,
    window_at: null,
    resume_at: null,
    retry_after_ms: 2000,
  };
}

module.exports = {
  DEFAULT_PUBLISH_HOURS_UTC,
  QUIET_PERIOD_SAFE_KINDS,
  evaluatePublishWorkerQuietPeriod,
};

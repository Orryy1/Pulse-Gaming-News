"use strict";

const DEFAULT_PUBLISH_HOURS_UTC = [9, 14, 19];
const DEFAULT_TOLERANCE_MINUTES = 20;

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || "").trim());
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function nearestPublishWindow({
  now = new Date(),
  expectedHoursUtc = DEFAULT_PUBLISH_HOURS_UTC,
} = {}) {
  const date = parseDate(now) || new Date();
  let best = { hour: null, minutesFromWindow: Infinity };

  for (const dayOffset of [-1, 0, 1]) {
    for (const rawHour of expectedHoursUtc || []) {
      const hour = Number(rawHour);
      if (!Number.isFinite(hour)) continue;
      const candidate = new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate() + dayOffset,
          hour,
          0,
          0,
          0,
        ),
      );
      const minutes = Math.round(
        Math.abs(date.getTime() - candidate.getTime()) / 60000,
      );
      if (minutes < best.minutesFromWindow) {
        best = { hour, minutesFromWindow: minutes };
      }
    }
  }

  return {
    windowUtc:
      best.hour === null ? null : `${String(best.hour).padStart(2, "0")}:00`,
    minutesFromWindow:
      best.minutesFromWindow === Infinity ? null : best.minutesFromWindow,
  };
}

function normaliseDispatchSource(value) {
  const source = String(value || "").trim().toLowerCase();
  return source || "unspecified";
}

function buildPublishWindowPolicy({
  now = new Date(),
  dispatchSource = "unspecified",
  env = process.env,
  expectedHoursUtc = DEFAULT_PUBLISH_HOURS_UTC,
  toleranceMinutes = DEFAULT_TOLERANCE_MINUTES,
} = {}) {
  const source = normaliseDispatchSource(dispatchSource);
  const nearest = nearestPublishWindow({ now, expectedHoursUtc });
  const insideWindow =
    nearest.minutesFromWindow !== null &&
    nearest.minutesFromWindow <= Number(toleranceMinutes);
  const requireWindow =
    truthy(env?.PUBLISH_REQUIRE_WINDOW) ||
    truthy(env?.PUBLISH_WINDOW_HARD_GATE);
  const blockers = [];
  const advisory = [];

  if (!insideWindow) {
    advisory.push(
      `${source} is outside the canonical publish windows (${expectedHoursUtc
        .map((h) => `${String(h).padStart(2, "0")}:00`)
        .join(", ")} UTC).`,
    );
    if (requireWindow) blockers.push("publish_window_blocked");
  }

  return {
    dispatchSource: source,
    generatedAt: (parseDate(now) || new Date()).toISOString(),
    expectedHoursUtc: expectedHoursUtc.map(Number),
    toleranceMinutes: Number(toleranceMinutes),
    nearestWindowUtc: nearest.windowUtc,
    minutesFromWindow: nearest.minutesFromWindow,
    insideWindow,
    hardGateEnabled: requireWindow,
    blocked: blockers.length > 0,
    verdict: blockers.length > 0 ? "red" : advisory.length > 0 ? "amber" : "green",
    blockers,
    advisory,
  };
}

module.exports = {
  DEFAULT_PUBLISH_HOURS_UTC,
  DEFAULT_TOLERANCE_MINUTES,
  buildPublishWindowPolicy,
  nearestPublishWindow,
};

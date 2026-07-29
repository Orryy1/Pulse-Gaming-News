"use strict";

const GUARDED_YOUTUBE_PUBLISH_HOURS_UTC = new Set([9, 19]);
const MINIMUM_YOUTUBE_SCHEDULE_LEAD_MS = 5 * 60 * 1000;

function resolveYoutubeScheduledPublishAt(
  scheduledFor,
  { now = new Date(), requireFuture = true } = {},
) {
  if (
    scheduledFor === undefined ||
    scheduledFor === null ||
    String(scheduledFor).trim() === ""
  ) {
    return null;
  }
  const raw = String(scheduledFor).trim();
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    throw new Error("youtube_scheduled_publish_timezone_required");
  }
  const scheduledAt = new Date(raw);
  const evaluatedAt =
    now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (
    Number.isNaN(scheduledAt.getTime()) ||
    Number.isNaN(evaluatedAt.getTime())
  ) {
    throw new Error("youtube_scheduled_publish_time_invalid");
  }
  if (
    !GUARDED_YOUTUBE_PUBLISH_HOURS_UTC.has(
      scheduledAt.getUTCHours(),
    ) ||
    scheduledAt.getUTCMinutes() !== 0 ||
    scheduledAt.getUTCSeconds() !== 0 ||
    scheduledAt.getUTCMilliseconds() !== 0
  ) {
    throw new Error("youtube_scheduled_publish_window_not_guarded");
  }
  if (requireFuture) {
    const leadMs =
      scheduledAt.getTime() - evaluatedAt.getTime();
    if (leadMs <= 0) {
      throw new Error("youtube_scheduled_publish_time_expired");
    }
    if (leadMs < MINIMUM_YOUTUBE_SCHEDULE_LEAD_MS) {
      throw new Error(
        "youtube_scheduled_publish_lead_time_insufficient",
      );
    }
  }
  return scheduledAt.toISOString();
}

module.exports = {
  GUARDED_YOUTUBE_PUBLISH_HOURS_UTC,
  MINIMUM_YOUTUBE_SCHEDULE_LEAD_MS,
  resolveYoutubeScheduledPublishAt,
};

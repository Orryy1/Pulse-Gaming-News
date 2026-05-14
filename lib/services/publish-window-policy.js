"use strict";

const DEFAULT_PUBLISH_HOURS_UTC = [9, 14, 19];
const DEFAULT_TOLERANCE_MINUTES = 20;
const DEFAULT_MIN_GAP_MINUTES = 120;

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || "").trim());
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRealPlatformId(value) {
  const id = String(value || "").trim();
  return !!id && !id.startsWith("DUPE_");
}

function storyHasRealPlatformId(story) {
  return !!(
    isRealPlatformId(story?.youtube_post_id) ||
    isRealPlatformId(story?.tiktok_post_id) ||
    isRealPlatformId(story?.instagram_media_id) ||
    isRealPlatformId(story?.facebook_post_id) ||
    isRealPlatformId(story?.twitter_post_id) ||
    isRealPlatformId(story?.youtube_url)
  );
}

function storyPublishedAt(story) {
  return (
    story?.published_at ||
    story?.youtube_published_at ||
    story?.instagram_published_at ||
    story?.facebook_published_at ||
    null
  );
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

function latestPublishedStory({ stories = [], now = new Date() } = {}) {
  const nowDate = parseDate(now) || new Date();
  let latest = null;
  for (const story of Array.isArray(stories) ? stories : []) {
    if (!storyHasRealPlatformId(story)) continue;
    const at = parseDate(storyPublishedAt(story));
    if (!at || at.getTime() > nowDate.getTime()) continue;
    if (!latest || at.getTime() > latest.at.getTime()) {
      latest = { story, at };
    }
  }
  return latest;
}

function buildPublishCooldownPolicy({
  now = new Date(),
  stories = [],
  env = process.env,
  minGapMinutes = DEFAULT_MIN_GAP_MINUTES,
} = {}) {
  const minGap = Number(minGapMinutes);
  const latest = latestPublishedStory({ stories, now });
  const requireGap =
    truthy(env?.PUBLISH_REQUIRE_MIN_GAP) ||
    truthy(env?.PUBLISH_COOLDOWN_HARD_GATE);
  const blockers = [];
  const advisory = [];

  let minutesSinceLastPost = null;
  if (latest) {
    const nowDate = parseDate(now) || new Date();
    minutesSinceLastPost = Math.round(
      (nowDate.getTime() - latest.at.getTime()) / 60000,
    );
    if (Number.isFinite(minGap) && minutesSinceLastPost < minGap) {
      advisory.push(
        `Latest public post was posted ${minutesSinceLastPost} minutes ago; recommended minimum gap is ${minGap} minutes.`,
      );
      if (requireGap) blockers.push("publish_cooldown_blocked");
    }
  }

  return {
    minGapMinutes: minGap,
    lastStoryId: latest?.story?.id || null,
    lastStoryTitle: latest?.story?.title || null,
    lastPublishedAt: latest ? latest.at.toISOString() : null,
    minutesSinceLastPost,
    hardGateEnabled: requireGap,
    blocked: blockers.length > 0,
    verdict: blockers.length > 0 ? "red" : advisory.length > 0 ? "amber" : "green",
    blockers,
    advisory,
  };
}

module.exports = {
  DEFAULT_PUBLISH_HOURS_UTC,
  DEFAULT_MIN_GAP_MINUTES,
  DEFAULT_TOLERANCE_MINUTES,
  buildPublishCooldownPolicy,
  buildPublishWindowPolicy,
  latestPublishedStory,
  nearestPublishWindow,
};

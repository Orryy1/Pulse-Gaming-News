"use strict";

const {
  hasScriptValidationFailure,
  isRealPlatformValue,
  isPublishFailureOrReviewBlocked,
} = require("../services/discord-post-gate");
const { isPrimary } = require("../deployment-mode");

const DEFAULT_EXPECTED_HOURS_UTC = [9, 14, 19];
const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_TOLERANCE_MINUTES = 20;
const DEFAULT_MIN_GAP_MINUTES = 120;
const DEFAULT_MAX_POSTS_PER_24H = 3;
const ONE_MINUTE_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

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

function minutesBetween(a, b) {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!da || !db) return null;
  return Math.round(Math.abs(da.getTime() - db.getTime()) / 60000);
}

function publishedAt(story) {
  return (
    story?.published_at ||
    story?.youtube_published_at ||
    story?.instagram_published_at ||
    story?.facebook_published_at ||
    story?.updated_at ||
    null
  );
}

function failedRowTouchedAt(story) {
  return (
    story?.qa_failed_at ||
    story?.updated_at ||
    story?.published_at ||
    story?.youtube_published_at ||
    story?.instagram_published_at ||
    story?.facebook_published_at ||
    story?.created_at ||
    story?.timestamp ||
    null
  );
}

function platformsForStory(story) {
  const platforms = [];
  if (isRealPlatformValue(story?.youtube_post_id) || isRealPlatformValue(story?.youtube_url)) {
    platforms.push("youtube");
  }
  if (isRealPlatformValue(story?.instagram_media_id)) platforms.push("instagram");
  if (isRealPlatformValue(story?.facebook_post_id)) platforms.push("facebook");
  if (isRealPlatformValue(story?.tiktok_post_id)) platforms.push("tiktok");
  if (isRealPlatformValue(story?.twitter_post_id)) platforms.push("x");
  return platforms;
}

function hasPlatformId(story) {
  return platformsForStory(story).length > 0;
}

function isFailedStory(story) {
  return isPublishFailureOrReviewBlocked(story);
}

function hasExplicitFailureMarker(story = {}) {
  const publishStatus = String(story.publish_status || "").toLowerCase();
  const qaStatus = String(story.qa_status || "").toLowerCase();
  const qaFailed = story.qa_failed === true ||
    story.qa_failed === 1 ||
    String(story.qa_failed || "").toLowerCase() === "true";
  return (
    qaFailed ||
    publishStatus === "failed" ||
    publishStatus === "qa_failed" ||
    qaStatus === "failed" ||
    qaStatus === "qa_failed"
  );
}

function isPublicCadenceStory(story) {
  if (!hasPlatformId(story)) return false;
  if (isPublishFailureOrReviewBlocked(story)) return false;
  return !!(story?.published_at || story?.youtube_published_at);
}

function hasScriptValidationFailureText(story) {
  return hasScriptValidationFailure(story);
}

function nearestExpectedWindow(date, expectedHoursUtc = DEFAULT_EXPECTED_HOURS_UTC) {
  const d = parseDate(date);
  if (!d) return { hour: null, minutes: null };

  let best = { hour: null, minutes: Infinity };
  for (const dayOffset of [-1, 0, 1]) {
    for (const hour of expectedHoursUtc) {
      const candidate = new Date(
        Date.UTC(
          d.getUTCFullYear(),
          d.getUTCMonth(),
          d.getUTCDate() + dayOffset,
          Number(hour),
          0,
          0,
          0,
        ),
      );
      const minutes = Math.round(Math.abs(d.getTime() - candidate.getTime()) / 60000);
      if (minutes < best.minutes) {
        best = { hour: Number(hour), minutes };
      }
    }
  }
  return best.minutes === Infinity ? { hour: null, minutes: null } : best;
}

function nextExpectedWindowAfter(
  date,
  expectedHoursUtc = DEFAULT_EXPECTED_HOURS_UTC,
) {
  const d = parseDate(date) || new Date();
  const hours = [...(expectedHoursUtc || [])]
    .map(Number)
    .filter((hour) => Number.isFinite(hour) && hour >= 0 && hour <= 23)
    .sort((a, b) => a - b);
  if (hours.length === 0) return null;

  for (const dayOffset of [0, 1, 2]) {
    for (const hour of hours) {
      const candidate = new Date(
        Date.UTC(
          d.getUTCFullYear(),
          d.getUTCMonth(),
          d.getUTCDate() + dayOffset,
          hour,
          0,
          0,
          0,
        ),
      );
      if (candidate.getTime() >= d.getTime()) return candidate;
    }
  }
  return null;
}

function nearestPublishJob(date, publishJobs = []) {
  const d = parseDate(date);
  if (!d) return null;
  let best = null;
  for (const job of publishJobs || []) {
    const jobDate = parseDate(job.completed_at || job.updated_at || job.run_at || job.created_at);
    if (!jobDate) continue;
    const minutes = Math.round(Math.abs(d.getTime() - jobDate.getTime()) / 60000);
    if (!best || minutes < best.minutes) {
      best = {
        id: job.id,
        status: job.status || null,
        run_at: job.run_at || null,
        minutes,
      };
    }
  }
  return best;
}

function classifyPublishEvent({
  story,
  publishJobs = [],
  expectedHoursUtc = DEFAULT_EXPECTED_HOURS_UTC,
  toleranceMinutes = DEFAULT_TOLERANCE_MINUTES,
} = {}) {
  const at = publishedAt(story);
  const nearest = nearestExpectedWindow(at, expectedHoursUtc);
  const job = nearestPublishJob(at, publishJobs);
  const scheduled =
    nearest.minutes !== null && nearest.minutes <= Number(toleranceMinutes);

  return {
    id: story?.id || null,
    title: story?.title || "(untitled)",
    published_at: at,
    classification: scheduled
      ? "scheduled_window"
      : "off_schedule_direct_or_fast_lane",
    nearest_window_utc:
      nearest.hour === null ? null : `${String(nearest.hour).padStart(2, "0")}:00`,
    minutes_from_window: nearest.minutes,
    nearest_publish_job: job,
    platforms: platformsForStory(story),
    publish_status: story?.publish_status || null,
  };
}

function directPublishRouteCandidates({ offScheduleCount = 0, env = {} } = {}) {
  if (!Number(offScheduleCount)) return [];
  const autoPublish = String(env?.AUTO_PUBLISH || "").toLowerCase() === "true";
  const primary = isPrimary(env);
  return [
    {
      id: "breaking_fast_lane",
      label: "Breaking fast lane",
      reason: autoPublish && primary
        ? "AUTO_PUBLISH and primary mode allow urgent stories to publish immediately outside queue windows."
        : "Can publish immediately when AUTO_PUBLISH is enabled on a primary instance.",
      evidence: "breaking_queue.js -> publishNextStory()",
    },
    {
      id: "api_autonomous_publish",
      label: "Manual/API autonomous publish",
      reason: "Dashboard or API calls can invoke publishToAllPlatforms() directly.",
      evidence: "server.js /api/autonomous/publish",
    },
    {
      id: "api_autonomous_run",
      label: "Manual/API full autonomous run",
      reason: "Full autonomous runs can publish immediately when AUTO_PUBLISH is true.",
      evidence: "server.js /api/autonomous/run",
    },
    {
      id: "cli_publish_or_full",
      label: "CLI publish/full/watch",
      reason: "Local CLI commands can bypass the jobs table and normal publish windows.",
      evidence: "run.js publish/full/watch",
    },
  ];
}

function computeNextSafePublishWindow({
  nowDate,
  publishEvents = [],
  expectedHoursUtc = DEFAULT_EXPECTED_HOURS_UTC,
  minRecommendedGapMinutes = DEFAULT_MIN_GAP_MINUTES,
  maxRecommendedPostsPer24h = DEFAULT_MAX_POSTS_PER_24H,
} = {}) {
  const now = parseDate(nowDate) || new Date();
  let earliest = new Date(now);
  const blockers = [];
  const sorted = [...(publishEvents || [])]
    .map((event) => ({
      ...event,
      at: parseDate(event.published_at),
    }))
    .filter((event) => event.at)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const cap = Math.max(1, Number(maxRecommendedPostsPer24h) || DEFAULT_MAX_POSTS_PER_24H);
  const allowedBeforeNextPost = Math.max(0, cap - 1);
  if (sorted.length > allowedBeforeNextPost) {
    const expireIndex = sorted.length - allowedBeforeNextPost - 1;
    const expiringEvent = sorted[expireIndex];
    const capClearsAt = new Date(expiringEvent.at.getTime() + 24 * ONE_HOUR_MS + ONE_MINUTE_MS);
    if (capClearsAt.getTime() > earliest.getTime()) earliest = capClearsAt;
    blockers.push({
      type: "post_cap",
      clears_at: capClearsAt.toISOString(),
      story_id: expiringEvent.id || null,
      reason: `${sorted.length}_posts_in_24h_cap_${cap}`,
    });
  }

  const last = sorted[sorted.length - 1] || null;
  if (last) {
    const gapClearsAt = new Date(
      last.at.getTime() +
        Math.max(1, Number(minRecommendedGapMinutes) || DEFAULT_MIN_GAP_MINUTES) *
          ONE_MINUTE_MS,
    );
    if (gapClearsAt.getTime() > earliest.getTime()) earliest = gapClearsAt;
    if (gapClearsAt.getTime() > now.getTime()) {
      blockers.push({
        type: "minimum_gap",
        clears_at: gapClearsAt.toISOString(),
        story_id: last.id || null,
        reason: `${minRecommendedGapMinutes}_minute_gap_after_latest_post`,
      });
    }
  }

  const canonical = nextExpectedWindowAfter(earliest, expectedHoursUtc);
  return {
    earliest_possible_at_utc: earliest.toISOString(),
    next_canonical_window_at_utc: canonical ? canonical.toISOString() : null,
    next_safe_publish_at_utc: canonical ? canonical.toISOString() : earliest.toISOString(),
    blockers,
    recommendation: canonical
      ? `Let the scheduler resume at ${canonical.toISOString()} if readiness remains non-red.`
      : "Cadence cap is clear; publish only through the normal scheduler or an explicit targeted QA-gated command.",
  };
}

function buildPublishCadenceReport({
  stories = [],
  jobs = [],
  env = process.env,
  now = new Date().toISOString(),
  windowHours = DEFAULT_WINDOW_HOURS,
  expectedHoursUtc = DEFAULT_EXPECTED_HOURS_UTC,
  toleranceMinutes = DEFAULT_TOLERANCE_MINUTES,
  minRecommendedGapMinutes = DEFAULT_MIN_GAP_MINUTES,
  maxRecommendedPostsPer24h = DEFAULT_MAX_POSTS_PER_24H,
} = {}) {
  const nowDate = parseDate(now) || new Date();
  const sinceMs = nowDate.getTime() - Number(windowHours) * 60 * 60 * 1000;
  const publishJobs = (jobs || []).filter((job) => job?.kind === "publish");

  const publishedStories = (stories || [])
    .filter(isPublicCadenceStory)
    .map((story) => ({ story, at: parseDate(publishedAt(story)) }))
    .filter(({ at }) => at && at.getTime() >= sinceMs && at.getTime() <= nowDate.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const publishEvents = publishedStories.map(({ story }) =>
    classifyPublishEvent({
      story,
      publishJobs,
      expectedHoursUtc,
      toleranceMinutes,
    }),
  );

  const gaps = [];
  for (let i = 1; i < publishEvents.length; i++) {
    const previous = publishEvents[i - 1];
    const current = publishEvents[i];
    const minutes = minutesBetween(previous.published_at, current.published_at);
    if (minutes !== null) {
      gaps.push({
        previous_id: previous.id,
        current_id: current.id,
        minutes,
      });
    }
  }

  const burstPairs = gaps.filter((gap) => gap.minutes < minRecommendedGapMinutes);
  const offSchedule = publishEvents.filter(
    (event) => event.classification !== "scheduled_window",
  );
  const scheduled = publishEvents.filter(
    (event) => event.classification === "scheduled_window",
  );

  const failedRowsWithPlatformIds = (stories || [])
    .filter(isFailedStory)
    .filter(hasPlatformId)
    .map((story) => {
      const touched = parseDate(failedRowTouchedAt(story));
      return {
        id: story.id,
        title: story.title,
        publish_error: story.publish_error || null,
        platforms: platformsForStory(story),
        last_touched_at: touched ? touched.toISOString() : null,
        age_hours: touched
          ? Math.max(0, Math.round((nowDate.getTime() - touched.getTime()) / ONE_HOUR_MS))
          : null,
      };
    });
  const recentFailedRowsWithPlatformIds = failedRowsWithPlatformIds.filter((row) => {
    const touched = parseDate(row.last_touched_at);
    return touched && touched.getTime() >= sinceMs && touched.getTime() <= nowDate.getTime();
  });
  const historicalFailedRowsWithPlatformIds = failedRowsWithPlatformIds.filter(
    (row) => !recentFailedRowsWithPlatformIds.includes(row),
  );

  const invalidPublicStoryRows = (stories || [])
    .filter(hasPlatformId)
    .filter((story) => !!(story?.published_at || story?.youtube_published_at))
    .filter((story) => !hasExplicitFailureMarker(story))
    .filter(hasScriptValidationFailureText)
    .map((story) => ({
      id: story.id,
      title: story.title,
      published_at: publishedAt(story),
      publish_status: story.publish_status || null,
      platforms: platformsForStory(story),
      reason: story.script_review_reason || "script_validation_review_required",
    }));

  const advisory = [];
  if (offSchedule.length > 0) {
    advisory.push(
      `${offSchedule.length} off-schedule public post(s) detected; likely direct/manual/fast-lane publish calls rather than normal queued windows.`,
    );
  }
  if (burstPairs.length > 0) {
    advisory.push(
      `${burstPairs.length} tight publish spacing pair(s) under ${minRecommendedGapMinutes} minutes.`,
    );
  }
  if (publishEvents.length > maxRecommendedPostsPer24h && Number(windowHours) <= 24) {
    advisory.push(
      `${publishEvents.length} public post(s) in ${windowHours}h exceeds the recommended cap of ${maxRecommendedPostsPer24h}.`,
    );
  }
  if (recentFailedRowsWithPlatformIds.length > 0) {
    advisory.push(
      `${recentFailedRowsWithPlatformIds.length} recent failed row(s) still have platform IDs; these can confuse Discord/status reporting.`,
    );
  }
  if (invalidPublicStoryRows.length > 0) {
    advisory.push(
      `${invalidPublicStoryRows.length} public row(s) still contain script-validation fallback text; repair status/body before treating them as clean publishes.`,
    );
  }

  const blockers = [];
  const verdict = blockers.length > 0 ? "red" : advisory.length > 0 ? "amber" : "green";
  const nextSafePublish = computeNextSafePublishWindow({
    nowDate,
    publishEvents,
    expectedHoursUtc,
    minRecommendedGapMinutes,
    maxRecommendedPostsPer24h,
  });
  const directPublishRoutes = directPublishRouteCandidates({
    offScheduleCount: offSchedule.length,
    env,
  });

  return {
    generated_at: nowDate.toISOString(),
    window_hours: Number(windowHours),
    verdict,
    env: {
      DEPLOYMENT_MODE: env?.DEPLOYMENT_MODE || null,
      PULSE_PRIMARY_INSTANCE: env?.PULSE_PRIMARY_INSTANCE || null,
      USE_JOB_QUEUE: env?.USE_JOB_QUEUE || null,
      AUTO_PUBLISH: env?.AUTO_PUBLISH || null,
      TIKTOK_ENABLED: env?.TIKTOK_ENABLED || null,
      TIKTOK_AUTO_UPLOAD_ENABLED: env?.TIKTOK_AUTO_UPLOAD_ENABLED || null,
    },
    thresholds: {
      expected_hours_utc: expectedHoursUtc,
      tolerance_minutes: Number(toleranceMinutes),
      min_recommended_gap_minutes: Number(minRecommendedGapMinutes),
      max_recommended_posts_per_24h: Number(maxRecommendedPostsPer24h),
    },
    summary: {
      published_count: publishEvents.length,
      scheduled_count: scheduled.length,
      off_schedule_count: offSchedule.length,
      burst_pairs: burstPairs.length,
      min_gap_minutes: gaps.length
        ? Math.min(...gaps.map((gap) => gap.minutes))
        : null,
      failed_rows_with_platform_ids: failedRowsWithPlatformIds.length,
      failed_rows_with_platform_ids_recent: recentFailedRowsWithPlatformIds.length,
      failed_rows_with_platform_ids_historical:
        historicalFailedRowsWithPlatformIds.length,
      invalid_public_story_rows: invalidPublicStoryRows.length,
      publish_jobs_seen: publishJobs.length,
      next_safe_publish_at_utc: nextSafePublish.next_safe_publish_at_utc,
    },
    publish_events: publishEvents,
    burst_pairs: burstPairs,
    failed_rows_with_platform_ids: failedRowsWithPlatformIds,
    recent_failed_rows_with_platform_ids: recentFailedRowsWithPlatformIds,
    historical_failed_rows_with_platform_ids: historicalFailedRowsWithPlatformIds,
    invalid_public_story_rows: invalidPublicStoryRows,
    direct_publish_route_candidates: directPublishRoutes,
    next_safe_publish: nextSafePublish,
    blockers,
    advisory,
    next_action:
      advisory.length > 0
        ? nextSafePublish.recommendation
        : "Cadence looks controlled for the inspected window.",
  };
}

function emoji(verdict) {
  if (verdict === "red") return "RED";
  if (verdict === "amber") return "AMBER";
  if (verdict === "green") return "GREEN";
  return "UNKNOWN";
}

function shortTitle(title, len = 96) {
  const value = String(title || "(untitled)").replace(/\s+/g, " ").trim();
  return value.length > len ? `${value.slice(0, len - 1)}...` : value;
}

function formatPublishCadenceMarkdown(report) {
  const lines = [];
  lines.push(`# Publish Cadence Doctor - ${emoji(report.verdict)}`);
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Window: last ${report.window_hours}h`);
  lines.push(
    `Env: primary=${report.env?.PULSE_PRIMARY_INSTANCE || "(unset)"} | auto_publish=${report.env?.AUTO_PUBLISH || "(unset)"} | queue=${report.env?.USE_JOB_QUEUE || "(unset)"}`,
  );
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Public posts: ${report.summary?.published_count || 0}`);
  lines.push(`- Scheduled-window posts: ${report.summary?.scheduled_count || 0}`);
  lines.push(`- Off-schedule posts: ${report.summary?.off_schedule_count || 0}`);
  lines.push(`- Tight spacing pairs: ${report.summary?.burst_pairs || 0}`);
  lines.push(
    `- Minimum gap: ${report.summary?.min_gap_minutes ?? "n/a"} minutes`,
  );
  lines.push(
    `- Failed rows with platform IDs: ${report.summary?.failed_rows_with_platform_ids || 0}`,
  );
  lines.push(
    `  - Recent: ${report.summary?.failed_rows_with_platform_ids_recent || 0}`,
  );
  lines.push(
    `  - Historical: ${report.summary?.failed_rows_with_platform_ids_historical || 0}`,
  );
  lines.push(
    `- Invalid public story rows: ${report.summary?.invalid_public_story_rows || 0}`,
  );
  if (report.next_safe_publish?.next_safe_publish_at_utc) {
    lines.push(
      `- Next safe canonical publish window: ${report.next_safe_publish.next_safe_publish_at_utc}`,
    );
  }

  if (report.advisory?.length) {
    lines.push("");
    lines.push("## Advisory");
    for (const item of report.advisory) lines.push(`- ${item}`);
  }

  if (report.publish_events?.length) {
    lines.push("");
    lines.push("## Recent Public Posts");
    for (const event of report.publish_events.slice(-20)) {
      lines.push(
        `- ${event.published_at || "(unknown time)"} | ${event.classification} | ${event.platforms.join(", ") || "unknown"} | ${shortTitle(event.title)}`,
      );
    }
  }

  if (report.failed_rows_with_platform_ids?.length) {
    lines.push("");
    lines.push("## Recent Failed Rows Carrying Platform IDs");
    const recentRows =
      report.recent_failed_rows_with_platform_ids ||
      report.failed_rows_with_platform_ids;
    if (recentRows.length === 0) {
      lines.push("- None in the inspected window.");
    }
    for (const row of recentRows.slice(0, 10)) {
      lines.push(
        `- ${row.id}: ${row.platforms.join(", ")} | ${row.last_touched_at || "unknown time"} | ${shortTitle(row.title)}`,
      );
    }
    if (report.historical_failed_rows_with_platform_ids?.length) {
      lines.push("");
      lines.push("## Historical Failed Rows Carrying Platform IDs");
      lines.push(
        `- ${report.historical_failed_rows_with_platform_ids.length} older row(s) are tracked for cleanup, but do not block current cadence.`,
      );
      for (const row of report.historical_failed_rows_with_platform_ids.slice(0, 5)) {
        lines.push(
          `- ${row.id}: ${row.platforms.join(", ")} | ${row.last_touched_at || "unknown time"} | ${shortTitle(row.title)}`,
        );
      }
    }
  }

  if (report.invalid_public_story_rows?.length) {
    lines.push("");
    lines.push("## Invalid Public Story Rows");
    for (const row of report.invalid_public_story_rows.slice(0, 10)) {
      lines.push(
        `- ${row.id}: ${row.platforms?.join(", ") || "unknown"} | ${shortTitle(row.title)}`,
      );
    }
  }

  const directRoutes =
    report.direct_publish_route_candidates?.length
      ? report.direct_publish_route_candidates
      : directPublishRouteCandidates({
          offScheduleCount: report.summary?.off_schedule_count || 0,
          env: report.env || {},
        });
  if (directRoutes.length) {
    lines.push("");
    lines.push("## Likely Direct Publish Routes");
    for (const route of directRoutes) {
      lines.push(`- ${route.label}: ${route.reason} (${route.evidence})`);
    }
  }

  lines.push("");
  lines.push(`Next action: ${report.next_action}`);
  return lines.join("\n");
}

function formatSqliteUtc(date) {
  const d = parseDate(date) || new Date();
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function loadPublishCadenceInputs({ windowHours = DEFAULT_WINDOW_HOURS, now = new Date() } = {}) {
  const db = require("../db");
  const stories =
    typeof db.getStoriesSync === "function" ? db.getStoriesSync() : await db.getStories();
  let jobs = [];
  try {
    const { getRepos } = require("../repositories");
    const repos = getRepos();
    const since = new Date((parseDate(now) || new Date()).getTime() - windowHours * 60 * 60 * 1000);
    jobs = repos.db
      .prepare(
        `SELECT id, kind, story_id, status, run_at, attempt_count, last_error,
                idempotency_key, created_at, updated_at, completed_at
         FROM jobs
         WHERE COALESCE(completed_at, updated_at, created_at, run_at) >= ?
         ORDER BY COALESCE(completed_at, updated_at, created_at, run_at)`,
      )
      .all(formatSqliteUtc(since));
  } catch {
    jobs = [];
  }
  return { stories, jobs };
}

async function buildPublishCadenceReportFromDb(opts = {}) {
  const inputs = await loadPublishCadenceInputs(opts);
  return buildPublishCadenceReport({ ...opts, ...inputs });
}

module.exports = {
  DEFAULT_EXPECTED_HOURS_UTC,
  buildPublishCadenceReport,
  buildPublishCadenceReportFromDb,
  classifyPublishEvent,
  computeNextSafePublishWindow,
  formatPublishCadenceMarkdown,
  nearestExpectedWindow,
  nextExpectedWindowAfter,
  parseDate,
  platformsForStory,
};

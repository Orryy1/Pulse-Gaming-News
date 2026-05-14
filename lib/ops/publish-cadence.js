"use strict";

const DEFAULT_EXPECTED_HOURS_UTC = [9, 14, 19];
const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_TOLERANCE_MINUTES = 20;
const DEFAULT_MIN_GAP_MINUTES = 120;
const DEFAULT_MAX_POSTS_PER_24H = 3;

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

function platformsForStory(story) {
  const platforms = [];
  if (story?.youtube_post_id || story?.youtube_url) platforms.push("youtube");
  if (story?.instagram_media_id) platforms.push("instagram");
  if (story?.facebook_post_id) platforms.push("facebook");
  if (story?.tiktok_post_id) platforms.push("tiktok");
  if (story?.twitter_post_id) platforms.push("x");
  return platforms;
}

function hasPlatformId(story) {
  return platformsForStory(story).length > 0;
}

function isFailedStory(story) {
  return String(story?.publish_status || "").toLowerCase() === "failed";
}

function isPublicCadenceStory(story) {
  if (!hasPlatformId(story)) return false;
  if (isFailedStory(story)) return false;
  return !!(story?.published_at || story?.youtube_published_at);
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
  const primary = String(env?.PULSE_PRIMARY_INSTANCE || "").toLowerCase() === "true";
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
    .map((story) => ({
      id: story.id,
      title: story.title,
      publish_error: story.publish_error || null,
      platforms: platformsForStory(story),
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
  if (failedRowsWithPlatformIds.length > 0) {
    advisory.push(
      `${failedRowsWithPlatformIds.length} failed row(s) still have platform IDs; these can confuse Discord/status reporting.`,
    );
  }

  const blockers = [];
  const verdict = blockers.length > 0 ? "red" : advisory.length > 0 ? "amber" : "green";
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
      publish_jobs_seen: publishJobs.length,
    },
    publish_events: publishEvents,
    burst_pairs: burstPairs,
    failed_rows_with_platform_ids: failedRowsWithPlatformIds,
    direct_publish_route_candidates: directPublishRoutes,
    blockers,
    advisory,
    next_action:
      advisory.length > 0
        ? "Review direct publish paths and keep cadence intentional before increasing volume."
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
    lines.push("## Failed Rows Carrying Platform IDs");
    for (const row of report.failed_rows_with_platform_ids.slice(0, 10)) {
      lines.push(
        `- ${row.id}: ${row.platforms.join(", ")} | ${shortTitle(row.title)}`,
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
  formatPublishCadenceMarkdown,
  nearestExpectedWindow,
  parseDate,
  platformsForStory,
};

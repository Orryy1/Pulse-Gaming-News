/**
 * lib/job-handlers.js — the kind → function map consumed by JobsRunner.
 *
 * Each handler is an async (job, ctx) => any. The whole point of the
 * Phase 3 refactor is that the actual business logic stays where it
 * already lives (publisher.js, hunter.js, engagement.js, ...) — we
 * just adapt them to the job-row signature here.
 *
 * Handlers MUST:
 *   - Be idempotent with respect to the idempotency_key where possible
 *     (the jobs table already dedupes on that key, but external side
 *     effects like "upload to YouTube" need their own idempotency —
 *     platform_posts rows + tokens/*.json are the authoritative guard).
 *   - Throw on failure. The runner converts throws to
 *     jobs.fail(), which triggers backoff + retry.
 *   - Return a small JSON-serialisable result on success (stored in
 *     job_runs.log_excerpt for observability).
 *
 * A handler that wants to fan out multiple child jobs should do so via
 * ctx.repos.jobs.enqueue(...) before returning.
 */

const path = require("path");
const fs = require("fs-extra");

const DATA_FILE = path.join(__dirname, "..", "daily_news.json");

function lazy(modulePath, exportName) {
  // Defer the require until the handler actually runs. Keeps jobs-runner
  // cold-start fast and avoids pulling in ffmpeg/anthropic clients for
  // kinds we never see in this process.
  return async (...args) => {
    const mod = require(modulePath);
    const fn = exportName ? mod[exportName] : mod;
    if (typeof fn !== "function") {
      throw new Error(
        `handler ${modulePath}::${exportName || "default"} is not a function`,
      );
    }
    return fn(...args);
  };
}

async function handleHunt(job, ctx) {
  const hunter = lazy("../hunter");
  const { autoApprove } = require("../publisher");
  const processStories = require("../processor");
  const stories = await hunter();
  await processStories();
  // New scoring engine gates approvals when USE_SCORING_ENGINE=true;
  // otherwise the legacy "approve everything" heuristic stays in effect.
  if (process.env.USE_SCORING_ENGINE === "true") {
    const { runScoringPass } = require("./decision-engine");
    const summary = runScoringPass({
      repos: ctx.repos,
      log: { log: (m) => ctx.log && ctx.log(m), error: () => {} },
    });
    return {
      fetched: Array.isArray(stories) ? stories.length : 0,
      scoring: summary,
    };
  }
  await autoApprove();
  return { fetched: Array.isArray(stories) ? stories.length : 0 };
}

async function handleProduce(job, ctx) {
  const { produce } = require("../publisher");
  const result = await produce();
  return result || { ok: true };
}

async function handlePublish(job, ctx) {
  const { publishNextStory } = require("../publisher");
  const result = await publishNextStory();
  if (!result) return { skipped: true };
  // Mirror the legacy Discord notification.
  try {
    const sendDiscord = require("../notify");
    const errorDetails =
      result.errors && Object.keys(result.errors).length > 0
        ? "\n" +
          Object.entries(result.errors)
            .map(([p, msg]) => `${p}: ${msg}`)
            .join("\n")
        : "";
    await sendDiscord(
      `**Pulse Gaming Published** (job #${job.id})\n` +
        `"${result.title}"\n` +
        `YT: ${result.youtube ? "yes" : "FAIL"} | ` +
        `TT: ${result.tiktok ? "yes" : "FAIL"} | ` +
        `IG: ${result.instagram ? "yes" : "FAIL"} | ` +
        `FB: ${result.facebook ? "yes" : "FAIL"} | ` +
        `X: ${result.twitter ? "yes" : "FAIL"}` +
        errorDetails,
    );
  } catch (err) {
    ctx.log && ctx.log(`notify error: ${err.message}`);
  }
  return {
    title: result.title,
    platforms: {
      youtube: !!result.youtube,
      tiktok: !!result.tiktok,
      instagram: !!result.instagram,
      facebook: !!result.facebook,
      twitter: !!result.twitter,
    },
  };
}

async function handleEngage(job, ctx) {
  const { engageRecent } = require("../engagement");
  await engageRecent();
  return { ok: true };
}

async function handleEngageFirstHour(job, ctx) {
  const news = await fs.readJson(DATA_FILE).catch(() => []);
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const recent = news.filter((s) => {
    if (!s.youtube_post_id || s.publish_status !== "published") return false;
    const t = s.published_at || s.timestamp;
    return t && new Date(t).getTime() >= cutoff;
  });
  if (!recent.length) return { skipped: true };
  const { engageFirstHour } = require("../engagement");
  for (const story of recent) {
    try {
      await engageFirstHour(story.youtube_post_id, story);
    } catch (err) {
      ctx.log && ctx.log(`engageFirstHour error ${story.id}: ${err.message}`);
    }
  }
  return { processed: recent.length };
}

async function handleAnalytics(job, ctx) {
  const { runAnalytics } = require("../analytics");
  await runAnalytics();
  return { ok: true };
}

async function handleRoundupWeekly(job, ctx) {
  const { compileWeekly } = require("../weekly_compile");
  const result = await compileWeekly();
  if (!result) return { skipped: true };
  try {
    const sendDiscord = require("../notify");
    await sendDiscord(
      `**Weekly Roundup Published**\n` +
        `${result.story_count} stories, ${Math.round((result.duration_seconds || 0) / 60)} min\n` +
        `${result.youtube_url || "Upload pending"}`,
    );
  } catch {
    /* ignore */
  }
  return {
    story_count: result.story_count,
    duration_seconds: result.duration_seconds,
    youtube_url: result.youtube_url || null,
  };
}

async function handleRoundupMonthlyTopics(job, ctx) {
  const {
    identifyCompilableTopics,
    compileByTopic,
  } = require("../weekly_compile");
  const topics = await identifyCompilableTopics(30);
  const top3 = topics.slice(0, 3);
  if (!top3.length) return { skipped: true };
  const completed = [];
  for (const topic of top3) {
    try {
      const r = await compileByTopic(topic.keyword);
      completed.push({ keyword: topic.keyword, ok: true, ...r });
    } catch (err) {
      completed.push({ keyword: topic.keyword, ok: false, error: err.message });
    }
  }
  return { completed };
}

async function handleBlogRebuild(job, ctx) {
  const { build } = require("../blog/build");
  await build();
  return { ok: true };
}

async function handleDbBackup(job, ctx) {
  const { backupDatabase } = require("./db_backup");
  await backupDatabase();
  return { ok: true };
}

async function handleTimingReanalysis(job, ctx) {
  const { getTimingReport } = require("../optimal_timing");
  const report = await getTimingReport();
  try {
    const sendDiscord = require("../notify");
    await sendDiscord("**Weekly Timing Report**\n" + report);
  } catch {
    /* ignore */
  }
  return { ok: true };
}

async function handleInstagramTokenRefresh(job, ctx) {
  const { seedTokenFromEnv, refreshToken } = require("../upload_instagram");
  const tokenPath = path.join(
    __dirname,
    "..",
    "tokens",
    "instagram_token.json",
  );
  await seedTokenFromEnv();
  if (!(await fs.pathExists(tokenPath))) return { skipped: "no_token_file" };
  const tokenData = await fs.readJson(tokenPath);
  const daysLeft = Math.round(
    (tokenData.expires_at - Date.now()) / (24 * 60 * 60 * 1000),
  );
  if (daysLeft < 30) {
    await refreshToken(tokenData.access_token);
    return { refreshed: true, daysLeft };
  }
  return { refreshed: false, daysLeft };
}

async function handleJobsReap(job, ctx) {
  const { jobs } = ctx.repos;
  const changed = jobs.reapStaleClaims();
  return { reclaimed: changed };
}

const handlers = {
  hunt: handleHunt,
  produce: handleProduce,
  publish: handlePublish,
  engage: handleEngage,
  engage_first_hour: handleEngageFirstHour,
  analytics: handleAnalytics,
  roundup_weekly: handleRoundupWeekly,
  roundup_monthly_topics: handleRoundupMonthlyTopics,
  blog_rebuild: handleBlogRebuild,
  db_backup: handleDbBackup,
  timing_reanalysis: handleTimingReanalysis,
  instagram_token_refresh: handleInstagramTokenRefresh,
  jobs_reap: handleJobsReap,
};

module.exports = { handlers };

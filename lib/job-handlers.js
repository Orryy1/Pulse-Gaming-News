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
  // Phase E cutover: scoring engine is the canonical approval path.
  // autoApprove() is now a thin wrapper that always routes through
  // lib/decision-engine::runScoringPass (or returns an explicit no-op
  // summary in non-prod dev modes — never blanket-approves). The old
  // USE_SCORING_ENGINE=true branch is gone; see publisher.js::autoApprove
  // doc for the production / dev semantics.
  const summary = await autoApprove();
  return {
    fetched: Array.isArray(stories) ? stories.length : 0,
    scoring: summary,
  };
}

async function handleProduce(job, ctx) {
  const { produce } = require("../publisher");
  const result = await produce();
  return result || { ok: true };
}

// Core platforms carry the commercial model — a failure here is worth
// alerting on. TikTok is core (not optional) per the 2026-04-19 priority
// reset. Twitter/X is explicitly optional because the free API tier
// cannot post videos and the paid tiers are expensive.
//
// The labels in `CORE_LABEL` refer to the Reel/Short video upload per
// platform, NOT any static card / Story variant that posts alongside.
// See `FALLBACK_POSTS` for the card/Story variants (FB Card, IG Story,
// X image tweet).
const CORE_PLATFORMS = ["youtube", "tiktok", "instagram", "facebook"];
const OPTIONAL_PLATFORMS = ["twitter"];

// Fallback / complementary posts that live ALONGSIDE the Reel/Short —
// static card images posted to IG Stories, FB Stories, and Twitter as
// an image tweet. These post regardless of whether the Reel succeeded,
// and they have materially lower reach, so they render on a separate
// "Fallbacks:" line and do NOT weigh in on the overall status.
const FALLBACK_POSTS = [
  { key: "facebook_card", label: "FB Card", errorKey: "facebook_story" },
  { key: "instagram_story", label: "IG Story", errorKey: "instagram_story" },
  { key: "twitter_image", label: "X Card", errorKey: "twitter_image" },
];

/**
 * Render the publish result into a Discord-friendly summary and compute
 * an overall status ("ok" / "degraded" / "failed") driven by CORE Reel
 * outcomes only. Optional platforms (Twitter/X) and static fallback
 * cards (FB Card / IG Story / X Card) render on their own lines and
 * cannot make the publish look broken.
 *
 * Exported for unit testing so the shape stays stable.
 */
function renderPublishSummary(result, { jobId } = {}) {
  if (!result) return null;

  // --- No-safe-candidate path (2026-04-22 multi-candidate fallback) ---
  // The publisher walked through up to MAX_PUBLISH_CANDIDATES_PER_WINDOW
  // produced stories and every single one failed preflight QA. No
  // upload happened. Discord needs to say so clearly — "skipped" /
  // "unknown" don't cut it at 09/14/19 UTC when the operator is
  // waiting for the day's post to ship.
  if (result.no_safe_candidate) {
    const tried = result.candidates_tried || 0;
    const n = result.qa_skipped_count || 0;
    const top = result.top_reason || "unknown";
    const qaSkipped = Array.isArray(result.qa_skipped) ? result.qa_skipped : [];
    const lines = [
      `**Pulse Gaming Publish Attempt**${jobId ? ` (job #${jobId})` : ""}`,
      `Status:    failed`,
      `No safe publish candidate passed QA.`,
      `Candidates tried: ${tried}`,
      `Skipped QA-failed candidates: ${n}`,
      `Top reason: ${top}`,
    ];
    // Include up to the first 3 skipped candidates' titles + reasons
    // so operators can eyeball what broke without hitting the DB.
    // Truncate titles to keep the summary under Discord's 2000-char cap.
    const sample = qaSkipped.slice(0, 3);
    if (sample.length > 0) {
      lines.push("Failed candidates:");
      for (const c of sample) {
        const t = String(c.title || "(untitled)").slice(0, 80);
        const r = c.source
          ? `${c.source}_qa: ${c.reason}`
          : c.reason || "unknown";
        lines.push(`• ${t} — ${r}`);
      }
    }
    return { message: lines.join("\n"), status: "failed" };
  }

  const skipped = result.skipped || {};
  const errors = result.errors || {};
  const fallbacks = result.fallbacks || {};

  // CORE: Reel / Short upload per platform. Labels include "Reel" for
  // IG and FB so the summary can't be mistaken for the static card
  // success (which posts separately — see FALLBACK_POSTS).
  const label = {
    youtube: "YT",
    tiktok: "TT",
    instagram: "IG Reel",
    facebook: "FB Reel",
    twitter: "X",
  };
  const renderPlatform = (p) => {
    if (result[p]) return `${label[p]} ✅`;
    if (skipped[p]) return `${label[p]} ⏸ ${skipped[p]}`;
    return `${label[p]} ❌`;
  };

  // Core status: ok if every core platform succeeded; failed if none did
  // OR both YouTube and TikTok failed (the critical pair); degraded in
  // between. Skipped core platforms count as neither success nor failure.
  const coreResults = CORE_PLATFORMS.map((p) => ({
    platform: p,
    ok: !!result[p],
    skipped: !!skipped[p],
    failed: !result[p] && !skipped[p],
  }));
  const coreAttempted = coreResults.filter((r) => !r.skipped);
  const coreOk = coreAttempted.filter((r) => r.ok);
  const coreFailed = coreAttempted.filter((r) => r.failed);
  const ytFailed =
    !result.youtube && !skipped.youtube; /* treat skipped YouTube as neutral */
  const ttFailed = !result.tiktok && !skipped.tiktok;

  let status;
  if (coreAttempted.length === 0) {
    // Nothing to judge — shouldn't happen in practice; mark degraded so
    // it doesn't silently read as "ok" when nothing actually shipped.
    status = "degraded";
  } else if (coreOk.length === coreAttempted.length) {
    status = "ok";
  } else if (
    coreFailed.length === coreAttempted.length ||
    (ytFailed && ttFailed)
  ) {
    status = "failed";
  } else {
    status = "degraded";
  }

  const corePlatformsLine = CORE_PLATFORMS.map(renderPlatform).join(" · ");
  const optionalPlatformsLine =
    OPTIONAL_PLATFORMS.map(renderPlatform).join(" · ");

  // Fallbacks line — only rendered when at least one fallback post was
  // actually attempted (succeeded or failed). A publish with no
  // story_image_path produces zero fallbacks; suppress the line so the
  // summary isn't cluttered with three never-attempted entries.
  const fallbackEntries = FALLBACK_POSTS.map(
    ({ key, label: flabel, errorKey }) => {
      if (fallbacks[key]) return `${flabel} ✅`;
      if (errors[errorKey]) return `${flabel} ❌`;
      return null;
    },
  ).filter(Boolean);
  const fallbacksLine =
    fallbackEntries.length > 0 ? fallbackEntries.join(" · ") : null;

  // Only CORE errors are surfaced in the details block — Twitter 402s
  // and static-card failures live on their own lines and shouldn't
  // pollute the main summary.
  const coreErrorDetails = CORE_PLATFORMS.filter((p) => errors[p])
    .map((p) => `${label[p]}: ${errors[p]}`)
    .join("\n");

  const lines = [
    `**Pulse Gaming Published**${jobId ? ` (job #${jobId})` : ""}`,
    `"${result.title || "(untitled)"}"`,
    `Core:      ${corePlatformsLine}`,
  ];
  if (fallbacksLine) lines.push(`Fallbacks: ${fallbacksLine}`);
  lines.push(`Optional:  ${optionalPlatformsLine}`);
  lines.push(`Status:    ${status}`);
  // Multi-candidate fallback signal: if the publisher walked past
  // one or more QA-failed candidates before landing on this one,
  // tell the operator so they know the window nearly burned.
  if (
    typeof result.qa_skipped_count === "number" &&
    result.qa_skipped_count > 0
  ) {
    lines.push(`Skipped QA-failed candidates: ${result.qa_skipped_count}`);
  }
  if (coreErrorDetails) lines.push(coreErrorDetails);

  return { message: lines.join("\n"), status };
}

async function handlePublish(job, ctx) {
  const { publishNextStory } = require("../publisher");
  const result = await publishNextStory();
  if (!result) return { skipped: true };
  const summary = renderPublishSummary(result, { jobId: job.id });
  try {
    const sendDiscord = require("../notify");
    if (summary) await sendDiscord(summary.message);
  } catch (err) {
    ctx.log && ctx.log(`notify error: ${err.message}`);
  }

  // No-safe-candidate path: every candidate in the window's top N
  // hit a hard-fail QA block. Record that structurally so the jobs
  // row's result_summary makes the failure legible without having
  // to read Discord.
  if (result.no_safe_candidate) {
    return {
      no_safe_candidate: true,
      status: "failed",
      candidates_tried: result.candidates_tried || 0,
      qa_skipped_count: result.qa_skipped_count || 0,
      top_reason: result.top_reason || "unknown",
    };
  }

  return {
    title: result.title,
    status: summary ? summary.status : "unknown",
    platforms: {
      youtube: !!result.youtube,
      tiktok: !!result.tiktok,
      instagram: !!result.instagram,
      facebook: !!result.facebook,
      twitter: !!result.twitter,
    },
    skipped: result.skipped || {},
    qa_skipped_count: result.qa_skipped_count || 0,
  };
}

async function handleEngage(job, ctx) {
  const { engageRecent } = require("../engagement");
  await engageRecent();
  return { ok: true };
}

async function handleEngageFirstHour(job, ctx) {
  // Task 6 (2026-04-21): moved from daily_news.json to the
  // canonical SQLite store. The JSON file is a fallback mirror
  // that can be stale or absent on fresh deploys; reading it here
  // meant a valid-but-recent publish could get skipped because
  // the mirror hadn't been rewritten. Go straight to the DB.
  const db = require("./db");
  let news = [];
  try {
    news =
      db.useSqlite && db.useSqlite()
        ? db.getStoriesSync()
        : await db.getStories();
  } catch (err) {
    // If the DB read throws, fail the job so the runner records
    // the error and retries. Previously the JSON fallback
    // swallowed errors and silently returned an empty list,
    // which meant a broken read looked identical to "no stories"
    // — no alert, no retry. That's the exact silent-skip class
    // of bug the Task 6 brief is asking us to close.
    throw new Error(`engage_first_hour: DB read failed: ${err.message || err}`);
  }
  if (!Array.isArray(news)) news = [];
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const recent = news.filter((s) => {
    if (!s || !s.youtube_post_id) return false;
    // Sentinel guard — DUPE_* rows are pre-2026-04-19 block
    // markers, not real post ids.
    if (String(s.youtube_post_id).startsWith("DUPE_")) return false;
    if (s.publish_status !== "published") return false;
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
  // Phase 6b: if the scoring engine is on, precompute the week's
  // selection + chapter plan into the roundups table before handing
  // off to compileWeekly. The render pipeline can then read either
  // the legacy virality ranking or the scored selection depending on
  // USE_SCORED_ROUNDUP — keeping both paths alive while the new
  // editorial flow stabilises.
  let scoringPlan = null;
  if (process.env.USE_SCORING_ENGINE === "true") {
    try {
      const { buildWeeklyRoundup } = require("./roundup");
      scoringPlan = buildWeeklyRoundup({
        repos: ctx.repos,
        log: {
          log: (m) => ctx.log && ctx.log(m),
          error: () => {},
        },
      });
      ctx.log &&
        ctx.log(
          `[roundup_weekly] scoring plan: ` +
            (scoringPlan.skipped
              ? `skipped (${scoringPlan.reason})`
              : `roundup #${scoringPlan.roundup_id}, ${scoringPlan.main_count} main + ${scoringPlan.quickfire_count} quickfire`),
        );
    } catch (err) {
      ctx.log &&
        ctx.log(`[roundup_weekly] scoring plan failed: ${err.message}`);
    }
  }

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

  // Phase 7: fan out the finished roundup into derivative rows + jobs.
  // Only runs when the scoring engine already produced a roundup row;
  // the legacy weekly_compile doesn't write to the roundups table.
  if (
    process.env.USE_SCORING_ENGINE === "true" &&
    scoringPlan &&
    !scoringPlan.skipped &&
    scoringPlan.roundup_id
  ) {
    try {
      const { jobs } = ctx.repos;
      jobs.enqueue({
        kind: "roundup_fanout",
        idempotency_key: `roundup_fanout:${scoringPlan.roundup_id}`,
        payload: { roundup_id: scoringPlan.roundup_id },
        channel_id: job.channel_id || process.env.CHANNEL || "pulse-gaming",
        priority: 45,
      });
      ctx.log &&
        ctx.log(
          `[roundup_weekly] enqueued fanout for roundup #${scoringPlan.roundup_id}`,
        );
    } catch (err) {
      ctx.log &&
        ctx.log(`[roundup_weekly] fanout enqueue failed: ${err.message}`);
    }
  }

  return {
    story_count: result.story_count,
    duration_seconds: result.duration_seconds,
    youtube_url: result.youtube_url || null,
    roundup_id: scoringPlan ? scoringPlan.roundup_id : null,
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

// Proactive TikTok auth health check. Runs before the daily
// publish window so a dead/expired token gets flagged in Discord
// while there's still time for the operator to re-auth, rather than
// surfacing as a silent `TT ❌` at 19:00 UTC.
//
// Never logs access_token or refresh_token. Discord alert embeds
// only the reason enum, expiry metadata, and the /auth/tiktok URL.
async function handleTiktokAuthCheck(job, ctx) {
  const { inspectTokenStatus, getAccessToken } = require("../upload_tiktok");

  // Near-expiry threshold — if the token dies within this window
  // we attempt a refresh now. Conservative 3h so a flapping
  // refresh endpoint still has room for the 19:00 publish window.
  const REFRESH_IF_LESS_THAN_SECONDS = 3 * 60 * 60;

  const inspect = await inspectTokenStatus();
  const result = {
    initial_reason: inspect.reason,
    expires_in_seconds: inspect.expires_in_seconds,
    needs_reauth: inspect.needs_reauth,
    refresh_attempted: false,
    refresh_ok: false,
    refresh_error: null,
  };

  // Structured Discord alert lines. We build them up and only send
  // a message if alerting is actually warranted, so the healthy path
  // is silent (noisy green pings drown out real problems).
  const alerts = [];

  if (!inspect.ok) {
    // Broken state — token missing / invalid / expired with no
    // refresh path. Operator must re-auth.
    if (inspect.needs_reauth) {
      alerts.push(`⚠ **TikTok token broken** — reason: \`${inspect.reason}\``);
      alerts.push(
        "Operator action required: visit https://marvelous-curiosity-production.up.railway.app/auth/tiktok",
      );
    } else if (inspect.refresh_available) {
      // Expired or `expires_at_invalid` but with a refresh_token
      // on disk — try to repair.
      result.refresh_attempted = true;
      try {
        await getAccessToken();
        result.refresh_ok = true;
      } catch (err) {
        result.refresh_error = err.message;
        alerts.push(
          `⚠ **TikTok token refresh failed** — reason: \`${inspect.reason}\``,
        );
        alerts.push(`Refresh error: ${err.message}`);
        alerts.push(
          "Operator action required: visit https://marvelous-curiosity-production.up.railway.app/auth/tiktok",
        );
      }
    }
  } else if (
    typeof inspect.expires_in_seconds === "number" &&
    inspect.expires_in_seconds <= REFRESH_IF_LESS_THAN_SECONDS
  ) {
    // Token still valid but close to expiry — refresh now so the
    // publish window doesn't cross the boundary with a stale token.
    result.refresh_attempted = true;
    try {
      await getAccessToken();
      result.refresh_ok = true;
    } catch (err) {
      result.refresh_error = err.message;
      alerts.push(
        `⚠ **TikTok proactive refresh failed** — token expires in ${inspect.expires_in_seconds}s`,
      );
      alerts.push(`Refresh error: ${err.message}`);
      alerts.push(
        "Operator action required: visit https://marvelous-curiosity-production.up.railway.app/auth/tiktok",
      );
    }
  }

  if (alerts.length > 0) {
    try {
      const sendDiscord = require("../notify");
      // Redact belt-and-braces: the alerts were built from enum
      // tags and a refresh error message. Our own code doesn't put
      // token values in those, but axios/TikTok error strings might
      // echo a URL that contains a code. Scrub any obvious bearer /
      // long-random-string patterns before sending.
      const scrubbed = alerts.map((line) =>
        line
          .replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>")
          .replace(/access_token=[^\s&"']+/gi, "access_token=<redacted>")
          .replace(/refresh_token=[^\s&"']+/gi, "refresh_token=<redacted>"),
      );
      await sendDiscord(scrubbed.join("\n"));
    } catch (err) {
      if (ctx.log)
        ctx.log(`[tiktok_auth_check] discord alert failed: ${err.message}`);
    }
  }

  return result;
}

async function handleJobsReap(job, ctx) {
  const { jobs } = ctx.repos;
  const changed = jobs.reapStaleClaims();
  return { reclaimed: changed };
}

async function handleScoringDigest(job, ctx) {
  const {
    getScoringDigest,
    buildScoringDigestMessage,
  } = require("./observability");
  const hours = (job.payload && job.payload.hours) || 24;
  const summary = getScoringDigest({ repos: ctx.repos, sinceHours: hours });
  try {
    const sendDiscord = require("../notify");
    await sendDiscord(buildScoringDigestMessage(summary));
  } catch (err) {
    ctx.log && ctx.log(`scoring_digest notify error: ${err.message}`);
  }
  return {
    scored: summary.scored,
    by_decision: summary.by_decision,
    avg_total: summary.avg_total,
  };
}

// Phase 7 derivative handlers — all delegate to lib/repurpose.runDerivative.
async function handleDerivative(job, ctx) {
  const { runDerivative } = require("./repurpose");
  return runDerivative(job, ctx);
}

// Fan out a just-published roundup into its derivative rows + jobs.
async function handleRoundupFanout(job, ctx) {
  const { fanoutRoundup } = require("./repurpose");
  const roundupId = job.payload && job.payload.roundup_id;
  if (!roundupId)
    throw new Error("[roundup_fanout] payload.roundup_id required");
  return fanoutRoundup({
    repos: ctx.repos,
    roundupId,
    channelId: job.channel_id || process.env.CHANNEL || "pulse-gaming",
    log: {
      log: (m) => ctx.log && ctx.log(m),
      error: (m) => ctx.log && ctx.log("ERROR: " + m),
    },
  });
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
  roundup_fanout: handleRoundupFanout,
  derivative_teaser_short: handleDerivative,
  derivative_community_post: handleDerivative,
  derivative_blog_post: handleDerivative,
  derivative_story_short: handleDerivative,
  blog_rebuild: handleBlogRebuild,
  db_backup: handleDbBackup,
  timing_reanalysis: handleTimingReanalysis,
  instagram_token_refresh: handleInstagramTokenRefresh,
  tiktok_auth_check: handleTiktokAuthCheck,
  jobs_reap: handleJobsReap,
  scoring_digest: handleScoringDigest,
};

module.exports = {
  handlers,
  renderPublishSummary,
  CORE_PLATFORMS,
  OPTIONAL_PLATFORMS,
  FALLBACK_POSTS,
};

"use strict";

const { resolveFacebookReelsMode } = require("../platforms/facebook-reels-mode");
const {
  isPublishFailureOrReviewBlocked,
} = require("../services/discord-post-gate");

const PLATFORM_FIELDS = {
  youtube: {
    idField: "youtube_post_id",
    urlField: "youtube_url",
    errorField: "youtube_error",
  },
  tiktok: { idField: "tiktok_post_id", errorField: "tiktok_error" },
  instagram_reel: {
    idField: "instagram_media_id",
    errorField: "instagram_error",
  },
  facebook_reel: {
    idField: "facebook_post_id",
    errorField: "facebook_error",
  },
  twitter: { idField: "twitter_post_id", errorField: "twitter_error" },
  threads: { idField: "threads_post_id", errorField: "threads_error" },
  pinterest: { idField: "pinterest_post_id", errorField: "pinterest_error" },
};

function envFlag(env, name) {
  return String(env?.[name] || "").trim().toLowerCase() === "true";
}

function envExplicitFalse(env, name) {
  return /^(false|0|no|off)$/i.test(String(env?.[name] || "").trim());
}

function hasEnv(env, name) {
  return String(env?.[name] || "").trim().length > 0;
}

function buildPlatformOperationalConfig(env = process.env) {
  const tiktokOperatorDisabled =
    envExplicitFalse(env, "TIKTOK_ENABLED") ||
    envExplicitFalse(env, "TIKTOK_AUTO_UPLOAD_ENABLED");
  const bufferTikTok = envFlag(env, "USE_BUFFER_TIKTOK") && hasEnv(env, "BUFFER_ACCESS_TOKEN");
  const tiktokDirectApproved =
    envFlag(env, "TIKTOK_DIRECT_POST_APPROVED") || envFlag(env, "TIKTOK_CONTENT_POSTING_APPROVED");
  const threadsOperatorEnabled = envFlag(env, "THREADS_ENABLED");
  const pinterestOperatorEnabled = envFlag(env, "PINTEREST_ENABLED");

  return {
    youtube: {
      state: "enabled",
      reason: "core_upload_path",
    },
    tiktok: tiktokOperatorDisabled
      ? { state: "disabled", reason: "operator_disabled" }
      : bufferTikTok
        ? { state: "enabled_via_scheduler", reason: "buffer_tiktok_enabled" }
        : tiktokDirectApproved
          ? { state: "enabled", reason: "direct_post_approved" }
          : { state: "blocked_external", reason: "tiktok_direct_post_app_review" },
    instagram_reel:
      hasEnv(env, "INSTAGRAM_ACCESS_TOKEN") && hasEnv(env, "INSTAGRAM_BUSINESS_ACCOUNT_ID")
        ? { state: "enabled", reason: "graph_credentials_present" }
        : { state: "needs_credentials", reason: "instagram_graph_credentials_missing" },
    facebook_reel: (() => {
      const mode = resolveFacebookReelsMode(env);
      return { state: mode.state, reason: mode.reason };
    })(),
    twitter: envFlag(env, "TWITTER_ENABLED")
      ? { state: "enabled", reason: "x_video_enabled" }
      : { state: "disabled", reason: "x_optional_disabled" },
    threads: envExplicitFalse(env, "THREADS_ENABLED")
      ? { state: "disabled", reason: "operator_disabled" }
      : threadsOperatorEnabled
        ? hasEnv(env, "THREADS_ACCESS_TOKEN") && hasEnv(env, "THREADS_USER_ID")
          ? { state: "enabled", reason: "threads_credentials_present" }
          : { state: "needs_credentials", reason: "threads_credentials_missing" }
        : { state: "disabled", reason: "threads_not_configured" },
    pinterest: envExplicitFalse(env, "PINTEREST_ENABLED")
      ? { state: "disabled", reason: "operator_disabled" }
      : pinterestOperatorEnabled
        ? hasEnv(env, "PINTEREST_ACCESS_TOKEN") && hasEnv(env, "PINTEREST_BOARD_ID")
          ? { state: "enabled", reason: "pinterest_credentials_present" }
          : { state: "needs_credentials", reason: "pinterest_credentials_missing" }
        : { state: "disabled", reason: "pinterest_not_configured" },
  };
}

function normalisePostPlatform(platform) {
  if (platform === "twitter_video") return "twitter";
  return platform;
}

function latestPostsByStoryPlatform(platformPosts = []) {
  const latest = new Map();
  for (const post of Array.isArray(platformPosts) ? platformPosts : []) {
    const storyId = post.story_id || post.storyId;
    const platform = normalisePostPlatform(post.platform);
    if (!storyId || !platform) continue;
    const key = `${storyId}:${platform}`;
    if (!latest.has(key)) latest.set(key, post);
  }
  return latest;
}

function statusFromPost(post) {
  if (!post) return null;
  if (post.status === "published") {
    return {
      status: "published",
      externalId: post.external_id || null,
      url: post.external_url || null,
      source: "platform_posts",
    };
  }
  if (post.status === "blocked") {
    return {
      status: "blocked",
      reason: post.block_reason || "blocked",
      source: "platform_posts",
    };
  }
  if (post.status === "failed") {
    return {
      status: "failed",
      error: post.error_message || "failed",
      source: "platform_posts",
    };
  }
  if (post.status) {
    return {
      status: post.status,
      source: "platform_posts",
    };
  }
  return null;
}

function statusFromStory(story, fields = {}, operationalState, platform) {
  const { idField, urlField, errorField } = fields;
  const hasPublicPlatformId = Boolean(idField && story?.[idField]);
  const platformUnavailable =
    operationalState &&
    operationalState.state !== "enabled" &&
    operationalState.state !== "enabled_via_scheduler";

  if (!hasPublicPlatformId && platformUnavailable) {
    return { status: operationalState.state, reason: operationalState.reason };
  }
  if (isPublishFailureOrReviewBlocked(story)) {
    return {
      status: "blocked_review",
      reason: "publish_failure_or_review_required",
    };
  }
  if (hasPublicPlatformId) return { status: "published", externalId: story[idField], url: story[urlField] || null };
  if (errorField && story?.[errorField]) return { status: "failed", error: story[errorField] };
  if (platformUnavailable) {
    return { status: operationalState.state, reason: operationalState.reason };
  }
  return { status: "not_published" };
}

function buildPlatformSummary(operational = {}) {
  const platforms = Object.entries(operational || {});
  const byState = (state) => platforms.filter(([, config]) => config?.state === state).map(([platform]) => platform);
  const disabledPlatforms = byState("disabled");
  const needsCredentialsPlatforms = byState("needs_credentials");
  const blockedExternalPlatforms = byState("blocked_external");
  const enabledPlatforms = platforms
    .filter(([, config]) => config?.state === "enabled" || config?.state === "enabled_via_scheduler")
    .map(([platform]) => platform);

  return {
    platform_count: platforms.length,
    enabled_platform_count: enabledPlatforms.length,
    disabled_platform_count: disabledPlatforms.length,
    needs_credentials_platform_count: needsCredentialsPlatforms.length,
    blocked_external_platform_count: blockedExternalPlatforms.length,
    enabled_platforms: enabledPlatforms,
    disabled_platforms: disabledPlatforms,
    needs_credentials_platforms: needsCredentialsPlatforms,
    blocked_external_platforms: blockedExternalPlatforms,
  };
}

function tiktokNeedsCredentialRepair(platformReadinessDoctor = {}) {
  const tiktok = platformReadinessDoctor?.platforms?.tiktok || {};
  const signals = [
    tiktok.status,
    tiktok.recommendation,
    tiktok?.no_post_readiness?.local_token?.status,
    tiktok?.no_post_readiness?.local_token?.next_action,
    ...(Array.isArray(platformReadinessDoctor.blockers) ? platformReadinessDoctor.blockers : []),
  ].map((value) => String(value || ""));

  return signals.some((signal) =>
    /needs_credentials|token_refresh|refresh_or_sync|expired_but_refreshable|needs_local_token_refresh_or_sync/i.test(signal),
  );
}

function applyPlatformReadinessDoctorEvidence(operational = {}, platformReadinessDoctor = null) {
  if (!platformReadinessDoctor || !tiktokNeedsCredentialRepair(platformReadinessDoctor)) {
    return operational;
  }

  const currentTikTok = operational.tiktok || {};
  const tiktok = platformReadinessDoctor.platforms?.tiktok || {};
  return {
    ...operational,
    tiktok: {
      ...currentTikTok,
      state: "needs_credentials",
      reason: "tiktok_local_token_refresh_or_sync_required",
      operator_state: currentTikTok.state || null,
      operator_reason: currentTikTok.reason || null,
      enablement_next_action: tiktok.recommendation || null,
      effective_readiness_source: "platform_readiness_doctor",
    },
  };
}

function verdictFromPlatformSummary(summary = {}) {
  if (
    Number(summary.disabled_platform_count || 0) > 0 ||
    Number(summary.needs_credentials_platform_count || 0) > 0 ||
    Number(summary.blocked_external_platform_count || 0) > 0
  ) {
    return "amber";
  }
  return "green";
}

function buildPlatformStatus({
  stories = [],
  platformPosts = [],
  platformConfig,
  operationalConfig,
  platformReadinessDoctor = null,
} = {}) {
  const operational = applyPlatformReadinessDoctorEvidence(
    platformConfig || operationalConfig || buildPlatformOperationalConfig(),
    platformReadinessDoctor,
  );
  const latestPosts = latestPostsByStoryPlatform(platformPosts);
  const rows = [];
  const platformKeys = Object.keys(operational || {});
  for (const story of Array.isArray(stories) ? stories : []) {
    const storyRow = { storyId: story.id, title: story.title, platforms: {} };
    const storyBlocked = isPublishFailureOrReviewBlocked(story);
    for (const platform of platformKeys) {
      const fields = PLATFORM_FIELDS[platform] || {};
      const postStatus = statusFromPost(latestPosts.get(`${story.id}:${platform}`));
      storyRow.platforms[platform] =
        storyBlocked
          ? statusFromStory(story, fields, operational[platform], platform)
          : postStatus || statusFromStory(story, fields, operational[platform], platform);
    }
    rows.push(storyRow);
  }

  const counts = {};
  for (const row of rows) {
    for (const [platform, status] of Object.entries(row.platforms)) {
      counts[platform] = counts[platform] || {};
      counts[platform][status.status] = (counts[platform][status.status] || 0) + 1;
    }
  }
  const summary = buildPlatformSummary(operational);

  return {
    generatedAt: new Date().toISOString(),
    verdict: verdictFromPlatformSummary(summary),
    storyCount: rows.length,
    summary,
    operational,
    counts,
    recent: rows.slice(-20),
  };
}

function renderPlatformStatusMarkdown(report) {
  const lines = [
    "# Platform Status",
    "",
    `Generated: ${report.generatedAt}`,
    `Stories inspected: ${report.storyCount}`,
    `Verdict: ${report.verdict || "unknown"}`,
  ];
  if (report.summary) {
    lines.push(
      "",
      "## Summary",
      `- Platforms: ${report.summary.platform_count ?? 0}`,
      `- Enabled platforms: ${report.summary.enabled_platform_count ?? 0}`,
      `- Disabled platforms: ${report.summary.disabled_platform_count ?? 0}`,
      `- Needs credentials: ${report.summary.needs_credentials_platform_count ?? 0}`,
      `- External blockers: ${report.summary.blocked_external_platform_count ?? 0}`,
    );
  }
  if (report.operational) {
    lines.push("", "## Operational State");
    for (const [platform, config] of Object.entries(report.operational)) {
      const operatorState =
        config.operator_state && config.operator_state !== config.state
          ? `; operator=${config.operator_state}/${config.operator_reason || "unknown"}`
          : "";
      lines.push(`- ${platform}: ${config.state}${config.reason || operatorState ? ` (${[config.reason, operatorState.trim()].filter(Boolean).join("")})` : ""}`);
    }
  }
  lines.push("", "## Counts");
  for (const [platform, counts] of Object.entries(report.counts || {})) {
    lines.push(`- ${platform}: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  return lines.join("\n") + "\n";
}

module.exports = {
  applyPlatformReadinessDoctorEvidence,
  buildPlatformOperationalConfig,
  buildPlatformStatus,
  renderPlatformStatusMarkdown,
};

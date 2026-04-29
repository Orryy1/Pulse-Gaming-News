"use strict";

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
};

function envFlag(env, name) {
  return String(env?.[name] || "").trim().toLowerCase() === "true";
}

function hasEnv(env, name) {
  return String(env?.[name] || "").trim().length > 0;
}

function buildPlatformOperationalConfig(env = process.env) {
  const bufferTikTok = envFlag(env, "USE_BUFFER_TIKTOK") && hasEnv(env, "BUFFER_ACCESS_TOKEN");
  const tiktokDirectApproved =
    envFlag(env, "TIKTOK_DIRECT_POST_APPROVED") || envFlag(env, "TIKTOK_CONTENT_POSTING_APPROVED");

  return {
    youtube: {
      state: "enabled",
      reason: "core_upload_path",
    },
    tiktok: bufferTikTok
      ? { state: "enabled_via_scheduler", reason: "buffer_tiktok_enabled" }
      : tiktokDirectApproved
        ? { state: "enabled", reason: "direct_post_approved" }
        : { state: "blocked_external", reason: "tiktok_direct_post_app_review" },
    instagram_reel:
      hasEnv(env, "INSTAGRAM_ACCESS_TOKEN") && hasEnv(env, "INSTAGRAM_BUSINESS_ACCOUNT_ID")
        ? { state: "enabled", reason: "graph_credentials_present" }
        : { state: "needs_credentials", reason: "instagram_graph_credentials_missing" },
    facebook_reel: envFlag(env, "FACEBOOK_REELS_ENABLED")
      ? { state: "enabled", reason: "facebook_reels_enabled" }
      : { state: "disabled", reason: "facebook_page_reels_gate" },
    twitter: envFlag(env, "TWITTER_ENABLED")
      ? { state: "enabled", reason: "x_video_enabled" }
      : { state: "disabled", reason: "x_optional_disabled" },
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

function statusFromStory(story, fields, operationalState) {
  const { idField, urlField, errorField } = fields;
  if (story?.[idField]) return { status: "published", externalId: story[idField], url: story[urlField] || null };
  if (story?.[errorField]) return { status: "failed", error: story[errorField] };
  if (operationalState && operationalState.state !== "enabled" && operationalState.state !== "enabled_via_scheduler") {
    return { status: operationalState.state, reason: operationalState.reason };
  }
  return { status: "not_published" };
}

function buildPlatformStatus({ stories = [], platformPosts = [], platformConfig } = {}) {
  const operational = platformConfig || buildPlatformOperationalConfig();
  const latestPosts = latestPostsByStoryPlatform(platformPosts);
  const rows = [];
  for (const story of Array.isArray(stories) ? stories : []) {
    const storyRow = { storyId: story.id, title: story.title, platforms: {} };
    for (const [platform, fields] of Object.entries(PLATFORM_FIELDS)) {
      const postStatus = statusFromPost(latestPosts.get(`${story.id}:${platform}`));
      storyRow.platforms[platform] =
        postStatus || statusFromStory(story, fields, operational[platform]);
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

  return {
    generatedAt: new Date().toISOString(),
    verdict: "pass",
    storyCount: rows.length,
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
  ];
  if (report.operational) {
    lines.push("", "## Operational State");
    for (const [platform, config] of Object.entries(report.operational)) {
      lines.push(`- ${platform}: ${config.state}${config.reason ? ` (${config.reason})` : ""}`);
    }
  }
  lines.push("", "## Counts");
  for (const [platform, counts] of Object.entries(report.counts || {})) {
    lines.push(`- ${platform}: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  return lines.join("\n") + "\n";
}

module.exports = {
  buildPlatformOperationalConfig,
  buildPlatformStatus,
  renderPlatformStatusMarkdown,
};

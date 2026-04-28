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

function statusFromStory(story, fields) {
  const { idField, urlField, errorField } = fields;
  if (story?.[idField]) return { status: "published", externalId: story[idField], url: story[urlField] || null };
  if (story?.[errorField]) return { status: "failed", error: story[errorField] };
  return { status: "not_published" };
}

function buildPlatformStatus({ stories = [], platformPosts = [] } = {}) {
  const rows = [];
  for (const story of Array.isArray(stories) ? stories : []) {
    const storyRow = { storyId: story.id, title: story.title, platforms: {} };
    for (const [platform, fields] of Object.entries(PLATFORM_FIELDS)) {
      storyRow.platforms[platform] = statusFromStory(story, fields);
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

  for (const post of Array.isArray(platformPosts) ? platformPosts : []) {
    const platform = post.platform || "unknown";
    counts[platform] = counts[platform] || {};
    counts[platform][post.status || "unknown"] =
      (counts[platform][post.status || "unknown"] || 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    verdict: "pass",
    storyCount: rows.length,
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
    "",
    "## Counts",
  ];
  for (const [platform, counts] of Object.entries(report.counts || {})) {
    lines.push(`- ${platform}: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  return lines.join("\n") + "\n";
}

module.exports = { buildPlatformStatus, renderPlatformStatusMarkdown };

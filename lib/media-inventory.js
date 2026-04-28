"use strict";

const { classifyThumbnailImage } = require("./thumbnail-safety");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function classifyStoryVisualInventory(story) {
  const downloaded = asArray(story?.downloaded_images);
  const clips = asArray(story?.video_clips);
  const trailerClips = clips.filter((p) => /trailer|steam|igdb|youtube/i.test(String(p)));
  const stock = downloaded.filter((img) => /pexels|unsplash|bing|stock/i.test(String(img.source || img.path)));
  const logos = downloaded.filter((img) => /logo/i.test(String(img.type)));
  const gameAssets = downloaded.filter((img) => {
    const c = classifyThumbnailImage(story, img);
    return c.isGameAsset || c.isPlatformAsset;
  });
  const unsafeFaces = downloaded
    .map((img) => classifyThumbnailImage(story, img))
    .filter((r) => !r.safeForThumbnail && r.reasons.includes("unsafe_thumbnail_face"));
  const sources = new Set(downloaded.map((img) => img.source || img.type || "unknown"));
  const uniqueStillKeys = new Set(downloaded.map((img) => img.path || JSON.stringify(img)));

  let score = 0;
  score += Math.min(40, trailerClips.length * 20);
  score += Math.min(28, gameAssets.length * 7);
  score += Math.min(15, sources.size * 5);
  score += Math.min(10, uniqueStillKeys.size * 2);
  score -= Math.min(25, stock.length * 8);
  score -= Math.min(40, unsafeFaces.length * 20);
  score = Math.max(0, Math.min(100, Math.round(score)));

  let className = "reject_visuals";
  let recommendedRuntimeSeconds = 0;
  const reasons = [];

  if (unsafeFaces.length > 0) reasons.push("unsafe_thumbnail_face");
  if (stock.length > 0) reasons.push("stock_or_search_filler_present");
  if (uniqueStillKeys.size < 2 && clips.length === 0) reasons.push("thin_visual_inventory");
  if (sources.size < 2 && downloaded.length > 2) reasons.push("repeated_source_risk");

  if (score >= 75 && clips.length >= 2 && gameAssets.length >= 3) {
    className = "premium_video";
    recommendedRuntimeSeconds = 65;
  } else if (score >= 55 && (clips.length >= 1 || gameAssets.length >= 3)) {
    className = "standard_video";
    recommendedRuntimeSeconds = 50;
  } else if (score >= 35 && gameAssets.length >= 1) {
    className = "short_only";
    recommendedRuntimeSeconds = 38;
  } else if (score >= 20) {
    className = "briefing_item";
    recommendedRuntimeSeconds = 30;
  } else if (story?.url) {
    className = "blog_only";
    recommendedRuntimeSeconds = 0;
  }

  if (className === "premium_video" && reasons.length > 0) {
    className = "standard_video";
    reasons.push("premium_downgraded_by_risk");
  }

  return {
    storyId: story?.id || null,
    title: story?.title || "",
    score,
    className,
    recommendedRuntimeSeconds,
    counts: {
      clips: clips.length,
      trailerClips: trailerClips.length,
      stills: downloaded.length,
      gameAssets: gameAssets.length,
      logos: logos.length,
      stock: stock.length,
      sources: sources.size,
      uniqueStills: uniqueStillKeys.size,
      unsafeFaces: unsafeFaces.length,
    },
    reasons,
    recommendations: recommendationsFor({ className, clips, gameAssets, stock, unsafeFaces }),
  };
}

function recommendationsFor({ className, clips, gameAssets, stock, unsafeFaces }) {
  const out = [];
  if (clips.length === 0) out.push("fetch_official_trailer_or_store_clip");
  if (gameAssets.length < 2) out.push("prefer_steam_igdb_store_assets");
  if (stock.length > 0) out.push("remove_stock_filler_before_premium_render");
  if (unsafeFaces.length > 0) out.push("replace_unknown_people_with_game_art");
  if (className === "briefing_item" || className === "blog_only") {
    out.push("do_not_force_60s_premium_video");
  }
  return out;
}

function buildMediaInventoryReport(stories = []) {
  const items = asArray(stories).map(classifyStoryVisualInventory);
  const counts = items.reduce((acc, item) => {
    acc[item.className] = (acc[item.className] || 0) + 1;
    return acc;
  }, {});
  return {
    generatedAt: new Date().toISOString(),
    counts,
    items,
  };
}

function renderMediaInventoryMarkdown(report) {
  const lines = [
    "# Media Inventory Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Class Counts",
    ...Object.entries(report.counts).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## Stories",
    ...report.items.map(
      (item) =>
        `- ${item.storyId}: ${item.className} score=${item.score} runtime=${item.recommendedRuntimeSeconds}s reasons=${item.reasons.join(", ") || "none"}`,
    ),
  ];
  return lines.join("\n") + "\n";
}

module.exports = {
  classifyStoryVisualInventory,
  buildMediaInventoryReport,
  renderMediaInventoryMarkdown,
};

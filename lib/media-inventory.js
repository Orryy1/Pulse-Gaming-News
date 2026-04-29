"use strict";

const { classifyThumbnailImage } = require("./thumbnail-safety");
const {
  scoreStoryMediaInventory,
} = require("./creative/media-inventory-scorer");
const {
  recommendRuntime,
} = require("./creative/runtime-recommender");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueList(values) {
  return Array.from(new Set(asArray(values).filter(Boolean)));
}

function compactReasons(reasons) {
  return uniqueList(reasons);
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
  const detailed = scoreStoryMediaInventory(story);
  const runtimePlan = recommendRuntime(detailed.classification);

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

  const blockerReasons = compactReasons([
    ...reasons,
    ...detailed.classificationReasons,
    ...(detailed.counts.unknown_human_portrait_risk > 0 ? ["unsafe_thumbnail_face"] : []),
    ...(detailed.counts.generic_stock > 0 ? ["stock_or_search_filler_present"] : []),
    ...(detailed.counts.repeated_source_risk > 1 ? ["repeated_source_risk"] : []),
    ...(detailed.counts.total_images === 0 && detailed.counts.total_clips === 0
      ? ["no_visual_inventory"]
      : []),
  ]);
  const recommendations = recommendationsFor({
    className,
    clips,
    gameAssets,
    stock,
    unsafeFaces,
    detailed,
  });
  const nextBestAction = recommendations[0] || "ready_for_render_qa";

  return {
    storyId: story?.id || null,
    title: story?.title || "",
    score,
    className,
    recommendedRuntimeSeconds,
    route: runtimeRouteFor(className, runtimePlan),
    renderDecision: {
      shouldRender: recommendedRuntimeSeconds > 0 && !["blog_only", "reject_visuals"].includes(className),
      route: runtimeRouteFor(className, runtimePlan),
      runtimeTargetSeconds: recommendedRuntimeSeconds,
      nextBestAction,
    },
    scores: {
      legacyScore: score,
      visualStrength: detailed.scores.visualStrength,
      thumbnailSafety: detailed.scores.thumbnailSafety,
      premiumSuitability: detailed.scores.premiumSuitability,
    },
    counts: {
      clips: clips.length,
      trailerClips: Math.max(trailerClips.length, detailed.counts.official_trailer_clips),
      gameplayClips: detailed.counts.gameplay_clips,
      stills: downloaded.length,
      gameAssets: gameAssets.length,
      logos: logos.length,
      stock: stock.length,
      sources: sources.size,
      uniqueStills: uniqueStillKeys.size,
      unsafeFaces: unsafeFaces.length,
      trailerFrames: detailed.counts.trailer_extracted_frames,
      articleImages: detailed.counts.article_images,
      publisherOfficialImages: detailed.counts.publisher_official_images,
      repeatedSourceRisk: detailed.counts.repeated_source_risk,
    },
    sourceMix: {
      clipRatio: detailed.ratios.clipRatio,
      stillRatio: detailed.ratios.stillRatio,
      cardRatio: detailed.ratios.cardRatio,
      sources: detailed.sources,
    },
    reasons: blockerReasons,
    recommendations,
    nextBestAction,
  };
}

function runtimeRouteFor(className, detailedRuntimePlan) {
  const legacyRoutes = {
    premium_video: "premium_short_or_breakdown",
    standard_video: "daily_short_or_briefing",
    short_only: "daily_short",
    briefing_item: "daily_briefing_segment",
    blog_only: "blog",
    reject_visuals: "manual_review",
  };
  return legacyRoutes[className] || detailedRuntimePlan.route || "manual_review";
}

function recommendationsFor({ className, clips, gameAssets, stock, unsafeFaces, detailed }) {
  const out = [];
  const detailedCounts = detailed?.counts || {};
  if (clips.length === 0) out.push("fetch_official_trailer_or_store_clip");
  if (gameAssets.length < 2) out.push("prefer_steam_igdb_store_assets");
  if ((detailedCounts.trailer_extracted_frames || 0) < 3 && clips.length === 0) {
    out.push("extract_trailer_frames_once_clip_exists");
  }
  if ((detailedCounts.publisher_official_images || 0) === 0) {
    out.push("look_for_publisher_logo_or_platform_ui");
  }
  if (stock.length > 0) out.push("remove_stock_filler_before_premium_render");
  if (unsafeFaces.length > 0) out.push("replace_unknown_people_with_game_art");
  if ((detailedCounts.repeated_source_risk || 0) > 1) {
    out.push("add_second_visual_source_before_premium_render");
  }
  if (className === "briefing_item" || className === "blog_only") {
    out.push("do_not_force_60s_premium_video");
  }
  if (className === "reject_visuals") out.push("manual_editor_review_required");
  return uniqueList(out);
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
  const renderable = report.items.filter((item) => item.renderDecision.shouldRender).length;
  const blocked = report.items.length - renderable;
  const lines = [
    "# Media Inventory Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Stories analysed: ${report.items.length}`,
    `Renderable as standalone video: ${renderable}`,
    `Downgraded or blocked: ${blocked}`,
    "",
    "## Class Counts",
    ...Object.entries(report.counts).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## Stories",
    ...report.items.flatMap(renderStoryMarkdown),
  ];
  return lines.join("\n") + "\n";
}

function renderStoryMarkdown(item) {
  const c = item.counts || {};
  const s = item.scores || {};
  const lines = [
    `### ${item.storyId} - ${item.className}`,
    `- Title: ${item.title || "(untitled)"}`,
    `- Route: ${item.route}; render=${item.renderDecision.shouldRender ? "yes" : "no"}; runtime=${item.recommendedRuntimeSeconds}s`,
    `- Scores: legacy=${item.score}; visual=${s.visualStrength}; thumbnail=${s.thumbnailSafety}; premium=${s.premiumSuitability}`,
    `- Visuals: clips=${c.clips} (trailer=${c.trailerClips}, gameplay=${c.gameplayClips || 0}), stills=${c.stills}, gameAssets=${c.gameAssets}, trailerFrames=${c.trailerFrames || 0}, logos=${c.logos}, stock=${c.stock}, unsafeFaces=${c.unsafeFaces}, sources=${c.sources}`,
    `- Reasons: ${item.reasons.join(", ") || "none"}`,
    `- Next: ${item.nextBestAction}`,
  ];
  if (item.recommendations.length > 1) {
    lines.push(`- Queue: ${item.recommendations.slice(1).join(", ")}`);
  }
  lines.push("");
  return lines;
}

module.exports = {
  classifyStoryVisualInventory,
  buildMediaInventoryReport,
  renderMediaInventoryMarkdown,
};

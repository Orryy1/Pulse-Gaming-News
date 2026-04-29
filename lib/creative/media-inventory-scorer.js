"use strict";

/**
 * lib/creative/media-inventory-scorer.js — Session 2 (creative pass).
 *
 * Pure / sync scoring helper. Given a story's media bag (downloaded
 * images + cached video clips) it emits a per-bucket count, a set
 * of derived ratios, and a six-bucket inventory class:
 *
 *   premium_video | standard_video | short_only |
 *   briefing_item | blog_only      | reject_visuals
 *
 * The classification feeds two downstream modules:
 *   - lib/creative/runtime-recommender.js (how long the video can be)
 *   - lib/creative/visual-qa-gate.js      (whether the story should
 *                                          render at all)
 *
 * Intentionally heuristic-only. No image content analysis, no face
 * detection — those are explicitly out of scope per the Session 2
 * stop conditions. The scorer reads the metadata fields the
 * existing image-pipeline already attaches (type, source, priority,
 * stock flag) and the existing thumbnail-safety classifier's
 * verdict for unsafe-human flagging.
 */

const { classifyThumbnailImage } = require("../thumbnail-safety");

const TRAILER_CLIP_TYPES = new Set([
  "trailer",
  "trailer_clip",
  "official_trailer",
  "gameplay_trailer",
]);
const GAMEPLAY_CLIP_TYPES = new Set(["gameplay", "gameplay_clip", "broll"]);
const TRAILER_FRAME_TYPES = new Set([
  "trailer_frame",
  "trailerframe",
  "trailerframe_smartcrop",
]);
const ARTICLE_IMAGE_TYPES = new Set([
  "article_hero",
  "article_image",
  "article_inline",
]);
const PUBLISHER_OFFICIAL_TYPES = new Set([
  "company_logo",
  "platform_logo",
  "platform_ui",
  "logo",
]);
const STORE_ASSET_TYPES = new Set([
  "key_art",
  "hero",
  "capsule",
  "screenshot",
  "steam_header",
  "steam_hero",
  "steam_capsule",
  "store_asset",
]);

const STOCK_SOURCES = new Set(["pexels", "unsplash", "bing"]);

function isTrailerClip(clip) {
  if (!clip) return false;
  const text = clipText(clip);
  const type = String(clip.type || "").toLowerCase();
  const source = String(clip.source || "").toLowerCase();
  if (TRAILER_CLIP_TYPES.has(type)) return true;
  if (source === "trailer") return true;
  if (source === "youtube" && /trailer/i.test(text)) return true;
  if (/trailer/i.test(text)) return true;
  return false;
}

function isGameplayClip(clip) {
  if (!clip) return false;
  const text = clipText(clip);
  const type = String(clip.type || "").toLowerCase();
  if (GAMEPLAY_CLIP_TYPES.has(type)) return true;
  if (/gameplay|broll|b-roll/i.test(text)) return true;
  return false;
}

function clipText(clip) {
  if (!clip) return "";
  if (typeof clip === "string") return clip;
  return [clip.path, clip.url, clip.type, clip.source, clip.title, clip.label]
    .filter(Boolean)
    .map(String)
    .join(" ");
}

function tallyImages(story) {
  const images = Array.isArray(story?.downloaded_images)
    ? story.downloaded_images
    : [];

  const counts = {
    article_image: 0,
    publisher_official: 0,
    store_asset: 0,
    trailer_frame: 0,
    generic_stock: 0,
    unknown_human_portrait: 0,
    other: 0,
  };
  const sources = new Set();
  const paths = new Set();
  let repeatedSourceCount = 0;
  const seenSources = new Map();

  for (const img of images) {
    if (!img) continue;
    const type = String(img.type || "").toLowerCase();
    const source = String(img.source || "").toLowerCase();
    if (source) sources.add(source);
    const p = String(img.path || img.url || "");
    if (p) {
      if (paths.has(p)) repeatedSourceCount++;
      paths.add(p);
    }
    if (source) {
      seenSources.set(source, (seenSources.get(source) || 0) + 1);
    }

    // Order matters: generic-stock check FIRST so a stock-source image
    // typed as "screenshot" is not silently counted as a Steam screenshot.
    if (STOCK_SOURCES.has(source) || img.stock === true) {
      counts.generic_stock++;
      const verdict = classifyThumbnailImage(story, img);
      if (verdict.isLikelyHuman) counts.unknown_human_portrait++;
      continue;
    }
    if (TRAILER_FRAME_TYPES.has(type) || /trailerframe/.test(type)) {
      counts.trailer_frame++;
      continue;
    }
    if (PUBLISHER_OFFICIAL_TYPES.has(type)) {
      counts.publisher_official++;
      continue;
    }
    if (STORE_ASSET_TYPES.has(type) || source === "steam") {
      counts.store_asset++;
      continue;
    }
    if (ARTICLE_IMAGE_TYPES.has(type) || source === "article") {
      counts.article_image++;
      continue;
    }

    const verdict = classifyThumbnailImage(story, img);
    if (verdict.isLikelyHuman && !verdict.namedPersonAllowed) {
      counts.unknown_human_portrait++;
      continue;
    }

    counts.other++;
  }

  for (const [, n] of seenSources) {
    if (n > 3) repeatedSourceCount += n - 3;
  }

  return {
    counts,
    sources: Array.from(sources).sort(),
    repeatedSourceCount,
    totalImages: images.length,
  };
}

function tallyClips(story) {
  const clips = Array.isArray(story?.video_clips) ? story.video_clips : [];
  let trailers = 0;
  let gameplay = 0;
  for (const clip of clips) {
    // Explicit gameplay types win — a trailer-source clip tagged as
    // gameplay/broll counts as gameplay, not as another trailer cut.
    if (isGameplayClip(clip)) {
      gameplay++;
      continue;
    }
    if (isTrailerClip(clip)) trailers++;
  }
  return {
    trailerClips: trailers,
    gameplayClips: gameplay,
    totalClips: clips.length,
  };
}

function ratios(images, clips) {
  const stillsKept =
    images.counts.store_asset +
    images.counts.publisher_official +
    images.counts.article_image +
    images.counts.trailer_frame;
  const total =
    stillsKept + clips.totalClips + Math.max(0, images.counts.other);
  if (total === 0) {
    return { clipRatio: 0, stillRatio: 0, cardRatio: 0, total: 0 };
  }
  return {
    clipRatio: Number((clips.totalClips / total).toFixed(3)),
    stillRatio: Number((stillsKept / total).toFixed(3)),
    cardRatio: Number((images.counts.publisher_official / total).toFixed(3)),
    total,
  };
}

function visualStrengthScore(images, clips) {
  const c = images.counts;
  let s = 0;
  s += Math.min(c.store_asset, 6) * 9;
  s += Math.min(c.trailer_frame, 6) * 7;
  s += Math.min(clips.trailerClips, 3) * 12;
  s += Math.min(clips.gameplayClips, 4) * 6;
  s += Math.min(c.publisher_official, 3) * 4;
  s += Math.min(c.article_image, 3) * 3;
  s -= Math.min(c.generic_stock, 6) * 4;
  s -= c.unknown_human_portrait * 12;
  s -= Math.max(0, images.repeatedSourceCount - 1) * 2;
  if (images.totalImages === 0 && clips.totalClips === 0) s = 0;
  return Math.max(0, Math.min(100, Math.round(s)));
}

function thumbnailSafetyScore(story) {
  const images = Array.isArray(story?.downloaded_images)
    ? story.downloaded_images
    : [];
  if (images.length === 0) return 25;
  let safe = 0;
  let unsafe = 0;
  for (const img of images) {
    const v = classifyThumbnailImage(story, img);
    if (v.safeForThumbnail && (v.isGameAsset || v.isPlatformAsset)) safe++;
    if (!v.safeForThumbnail) unsafe++;
  }
  const base = images.length > 0 ? Math.round((safe / images.length) * 100) : 0;
  return Math.max(0, base - unsafe * 8);
}

function premiumSuitabilityScore(story, visualStrength, clips, images) {
  let s = visualStrength;
  if (clips.trailerClips >= 1) s += 8;
  if (clips.gameplayClips >= 2) s += 6;
  if (images.counts.store_asset >= 3) s += 6;
  if (images.counts.unknown_human_portrait > 0) s -= 25;
  if (images.counts.generic_stock > 3) s -= 10;
  if (images.sources.length < 2) s -= 6;
  return Math.max(0, Math.min(100, Math.round(s)));
}

function classify({ visualStrength, thumbnailSafety, premium, images, clips }) {
  const reasons = [];
  const c = images.counts;
  const usableStills =
    c.store_asset + c.trailer_frame + c.publisher_official + c.article_image;
  const totalUsable = usableStills + clips.totalClips;

  if (
    c.unknown_human_portrait >= 2 ||
    (totalUsable === 0 && images.totalImages > 0)
  ) {
    if (c.unknown_human_portrait >= 2)
      reasons.push("multiple_unsafe_human_portraits");
    if (totalUsable === 0 && images.totalImages > 0)
      reasons.push("no_usable_visual_after_filtering");
    return { class: "reject_visuals", reasons };
  }

  if (totalUsable === 0) {
    reasons.push("no_visual_inventory");
    return { class: "blog_only", reasons };
  }

  if (totalUsable <= 2 && clips.totalClips === 0) {
    reasons.push("very_thin_visual_inventory");
    if (c.generic_stock >= totalUsable) reasons.push("mostly_stock_filler");
    return { class: "briefing_item", reasons };
  }

  if (premium >= 70 && clips.trailerClips >= 1 && c.store_asset >= 2) {
    reasons.push(
      `premium_inventory_score_${premium}_with_${clips.trailerClips}_trailer_clip(s)`,
    );
    return { class: "premium_video", reasons };
  }

  if (visualStrength >= 55 && totalUsable >= 5) {
    reasons.push(`solid_inventory_visualStrength_${visualStrength}`);
    return { class: "standard_video", reasons };
  }

  reasons.push(
    `limited_inventory_visualStrength_${visualStrength}_total_${totalUsable}`,
  );
  if (thumbnailSafety < 40) reasons.push("thumbnail_safety_marginal");
  return { class: "short_only", reasons };
}

function scoreStoryMediaInventory(story) {
  const images = tallyImages(story);
  const clips = tallyClips(story);
  const r = ratios(images, clips);
  const visualStrength = visualStrengthScore(images, clips);
  const thumbnailSafety = thumbnailSafetyScore(story);
  const premium = premiumSuitabilityScore(story, visualStrength, clips, images);
  const verdict = classify({
    visualStrength,
    thumbnailSafety,
    premium,
    images,
    clips,
  });

  return {
    storyId: story?.id || null,
    counts: {
      official_trailer_clips: clips.trailerClips,
      gameplay_clips: clips.gameplayClips,
      trailer_extracted_frames: images.counts.trailer_frame,
      article_images: images.counts.article_image,
      publisher_official_images: images.counts.publisher_official,
      store_assets: images.counts.store_asset,
      generic_stock: images.counts.generic_stock,
      unknown_human_portrait_risk: images.counts.unknown_human_portrait,
      other: images.counts.other,
      total_images: images.totalImages,
      total_clips: clips.totalClips,
      distinct_sources: images.sources.length,
      repeated_source_risk: images.repeatedSourceCount,
    },
    ratios: r,
    scores: {
      visualStrength,
      thumbnailSafety,
      premiumSuitability: premium,
    },
    sources: images.sources,
    classification: verdict.class,
    classificationReasons: verdict.reasons,
  };
}

function scoreStories(stories = []) {
  return (Array.isArray(stories) ? stories : []).map(scoreStoryMediaInventory);
}

module.exports = {
  scoreStoryMediaInventory,
  scoreStories,
  TRAILER_CLIP_TYPES,
  GAMEPLAY_CLIP_TYPES,
};

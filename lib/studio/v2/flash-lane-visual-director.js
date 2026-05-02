"use strict";

const { sourceId } = require("../../scene-composer");

const ACTUAL_CLIP_TYPES = new Set(["clip", "punch", "speed-ramp", "freeze-frame"]);
const CARD_TYPE_PREFIX = "card.";

const MIN_UNIQUE_CLIP_SOURCES_60S = 3;
const MAX_CLIP_SCENES_PER_SOURCE = 3;
const MIN_SAFE_CLIP_START_S = 22;
const MIN_DISTINCT_SCENE_BEATS_60S = 8;
const MAX_FLASH_CARD_RATIO = 0.28;
const MAX_COVER_ART_RATIO = 0.2;
const MAX_SOURCE_CARD_COUNT = 1;
const LOW_SEGMENT_QUALITY_SCORE = 75;
const BAD_FRAME_TASTE_REASONS = new Set([
  "white_text_on_dark_card",
  "dead_dark_frame",
  "washed_low_detail_frame",
  "rating_slate",
  "title_card",
  "logo_slate",
]);
const RATING_SLATE_RE = /\b(?:pegi|esrb|usk|cero|age[_ -]?rating|content[_ -]?rating|rating[_ -]?board|17\+|18\+|www\.pegi\.info|blood and gore|intense violence)\b/i;

function sceneType(scene) {
  return String(scene?.type || scene?.sceneType || "");
}

function isClipBackedOpener(scene) {
  return sceneType(scene) === "opener" && scene?.isClipBacked === true;
}

function isActualClipScene(scene) {
  return ACTUAL_CLIP_TYPES.has(sceneType(scene)) || isClipBackedOpener(scene);
}

function isCardScene(scene) {
  return sceneType(scene).startsWith(CARD_TYPE_PREFIX);
}

function normaliseSource(value) {
  return String(value || "").trim();
}

function sceneStart(scene) {
  const start = Number(scene?.mediaStartS ?? scene?.media_start_s);
  return Number.isFinite(start) ? start : null;
}

function sceneSourceType(scene) {
  return String(scene?.sourceType || scene?.source_type || scene?.kind || "").toLowerCase();
}

function isCoverArtSourceType(type) {
  return /\b(?:steam_)?(?:capsule|header|hero|library|cover)\b/.test(String(type || ""));
}

function isCoverArtScene(scene) {
  if (!["still", "opener"].includes(sceneType(scene))) return false;
  if (isClipBackedOpener(scene)) return false;
  const type = sceneSourceType(scene);
  if (isCoverArtSourceType(type)) return true;
  return /(?:capsule|header|library|cover|hero)[._-]/i.test(normaliseSource(scene?.source || scene?.backgroundSource));
}

function countDistinctSceneBeats(scenes) {
  const beats = new Set();
  for (const scene of scenes) {
    const type = sceneType(scene);
    if (isActualClipScene(scene)) {
      beats.add(`clip:${sourceId(scene)}:${sceneStart(scene) ?? "x"}`);
    } else if (type === "clip.frame" || type === "still") {
      beats.add(`${type}:${sourceId(scene)}`);
    } else if (isCardScene(scene)) {
      beats.add(`card:${scene?.label || type}`);
    }
  }
  return beats.size;
}

function clipQualityWarnings(media) {
  const warnings = [];
  for (const clip of Array.isArray(media?.clips) ? media.clips : []) {
    const score = Number(clip?.provenance?.segment_quality_score);
    if (Number.isFinite(score) && score < LOW_SEGMENT_QUALITY_SCORE) {
      warnings.push({
        source: clip.path || null,
        score,
        reason: "low_segment_quality_score",
      });
    }
  }
  return warnings;
}

function clipByPath(media) {
  const map = new Map();
  for (const clip of Array.isArray(media?.clips) ? media.clips : []) {
    const key = normaliseSource(clip?.path || clip?.source);
    if (key && !map.has(key)) map.set(key, clip);
  }
  return map;
}

function mediaCandidateByPath(media) {
  const map = new Map();
  for (const bucket of ["clips", "frames", "stills", "images"]) {
    for (const item of Array.isArray(media?.[bucket]) ? media[bucket] : []) {
      const key = normaliseSource(item?.path || item?.source || item?.local_path);
      if (key && !map.has(key)) map.set(key, item);
    }
  }
  return map;
}

function firstTasteObject(...items) {
  for (const item of items) {
    const candidates = [
      item?.taste,
      item?.frameTaste,
      item?.frame_taste,
      item?.provenance?.taste,
      item?.provenance?.frame_taste,
      item?.provenance?.frameTaste,
      item?.provenance?.prescan_taste,
      item?.quality?.taste,
    ];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === "object") return candidate;
    }
  }
  return null;
}

function badFrameTasteScenes({ scenes, media }) {
  const byPath = mediaCandidateByPath(media);
  const out = [];
  for (const scene of scenes) {
    const source = normaliseSource(scene?.source || scene?.backgroundSource);
    const candidate = byPath.get(source);
    const taste = firstTasteObject(scene, candidate);
    const reason = String(taste?.reason || "").trim();
    const verdict = String(taste?.verdict || "").trim().toLowerCase();
    if (verdict === "reject" || BAD_FRAME_TASTE_REASONS.has(reason)) {
      out.push({
        label: scene?.label || null,
        source: source || null,
        reason: reason || "prescan_rejected_frame",
        verdict: taste?.verdict || null,
      });
    }
  }
  return out;
}

function ratingSlateScenes({ scenes, media }) {
  const byPath = mediaCandidateByPath(media);
  const out = [];
  for (const scene of scenes) {
    const source = normaliseSource(scene?.source || scene?.backgroundSource);
    const candidate = byPath.get(source);
    const text = [
      scene?.label,
      scene?.source,
      scene?.sourceType,
      scene?.source_type,
      scene?.title,
      scene?.text,
      scene?.provenance?.source_type,
      scene?.provenance?.source_url,
      candidate?.path,
      candidate?.source,
      candidate?.label,
      candidate?.title,
      candidate?.sourceType,
      candidate?.provenance?.source_type,
      candidate?.provenance?.source_url,
      firstTasteObject(scene, candidate)?.reason,
    ]
      .filter(Boolean)
      .join(" ");
    if (RATING_SLATE_RE.test(text)) {
      out.push({
        label: scene?.label || null,
        source: source || null,
        mediaStartS: sceneStart(scene),
        reason: "rating_or_age_slate_detected",
      });
    }
  }
  return out;
}

function unvalidatedOfficialClipSegments({ scenes, media }) {
  const clips = clipByPath(media);
  const out = [];
  for (const scene of scenes.filter(isActualClipScene)) {
    const clip = clips.get(normaliseSource(scene?.source));
    const provenance = clip?.provenance || {};
    if (
      provenance.requires_segment_validation === true &&
      (provenance.segment_validated !== true || provenance.allowed_for_flash_lane !== true)
    ) {
      out.push({
        label: scene?.label || null,
        source: scene?.source || null,
        mediaStartS: sceneStart(scene),
        reason: provenance.segment_validation_reason || "official_segment_not_validated",
      });
    }
  }
  return out;
}

function buildFlashLaneVisualDirector({ scenes, media, narrationDurationS } = {}) {
  const list = Array.isArray(scenes) ? scenes : [];
  const totalScenes = list.length;
  const runtimeS = Number(narrationDurationS) || list.reduce((sum, scene) => sum + Number(scene?.duration || 0), 0);
  const is60sLane = runtimeS >= 60;
  const actualClipScenes = list.filter(isActualClipScene);
  const clipCounts = new Map();
  const earlyClipScenes = [];
  for (const scene of actualClipScenes) {
    const id = normaliseSource(sourceId(scene));
    if (id) clipCounts.set(id, (clipCounts.get(id) || 0) + 1);
    const start = sceneStart(scene);
    if (start !== null && start < MIN_SAFE_CLIP_START_S) {
      earlyClipScenes.push({
        label: scene?.label || null,
        source: scene?.source || null,
        mediaStartS: start,
      });
    }
  }

  const overusedClipSources = [...clipCounts.entries()]
    .filter(([, count]) => count > MAX_CLIP_SCENES_PER_SOURCE)
    .map(([source, count]) => ({ source, count }));
  const uniqueClipSources = clipCounts.size;
  const cardScenes = list.filter(isCardScene);
  const sourceCards = cardScenes.filter((scene) => sceneType(scene) === "card.source");
  const firstSourceCardIndex = list.findIndex((scene) => sceneType(scene) === "card.source");
  const coverArtScenes = list.filter(isCoverArtScene);
  const cardRatio = totalScenes > 0 ? Number((cardScenes.length / totalScenes).toFixed(2)) : 0;
  const coverArtRatio = totalScenes > 0 ? Number((coverArtScenes.length / totalScenes).toFixed(2)) : 0;
  const distinctSceneBeats = countDistinctSceneBeats(list);
  const weakClipSegments = clipQualityWarnings(media);
  const unvalidatedOfficialSegments = unvalidatedOfficialClipSegments({
    scenes: list,
    media,
  });
  const rejectedFrameTasteScenes = badFrameTasteScenes({
    scenes: list,
    media,
  });
  const detectedRatingSlateScenes = ratingSlateScenes({
    scenes: list,
    media,
  });

  const blockers = [];
  const warnings = [];

  if (is60sLane && uniqueClipSources < MIN_UNIQUE_CLIP_SOURCES_60S) {
    blockers.push("flash_visual_requires_three_unique_clip_refs_for_60s");
  }
  if (overusedClipSources.length > 0) {
    blockers.push("flash_visual_clip_source_overused");
  }
  if (earlyClipScenes.length > 0) {
    blockers.push("flash_visual_clip_start_too_early");
  }
  if (is60sLane && distinctSceneBeats < MIN_DISTINCT_SCENE_BEATS_60S) {
    blockers.push("flash_visual_not_enough_distinct_scene_beats");
  }
  if (unvalidatedOfficialSegments.length > 0) {
    blockers.push("flash_visual_unvalidated_official_clip_segment");
  }
  if (weakClipSegments.length > 0) {
    blockers.push("flash_visual_low_quality_clip_segment");
  }
  if (rejectedFrameTasteScenes.length > 0) {
    blockers.push("flash_visual_bad_frame_taste");
  }
  if (detectedRatingSlateScenes.length > 0) {
    blockers.push("flash_visual_rating_slate_scene");
  }
  if (detectedRatingSlateScenes.length > 1) {
    blockers.push("flash_visual_rating_slate_repeated");
  }
  if (sourceCards.length > MAX_SOURCE_CARD_COUNT) {
    warnings.push("flash_visual_too_many_plain_source_cards");
  }
  if (firstSourceCardIndex >= 0 && firstSourceCardIndex <= 2) {
    warnings.push("flash_visual_source_card_appears_too_early");
  }
  if (cardRatio > MAX_FLASH_CARD_RATIO) {
    warnings.push("flash_visual_card_ratio_high");
  }
  if (coverArtRatio > MAX_COVER_ART_RATIO) {
    warnings.push("flash_visual_cover_art_ratio_high");
  } else if (coverArtScenes.length > 0) {
    warnings.push("flash_visual_cover_art_should_only_support");
  }
  let recommendation = "visual_plan_allowed_for_local_flash_proof";
  if (blockers.includes("flash_visual_requires_three_unique_clip_refs_for_60s")) {
    recommendation = "acquire_more_unique_official_footage_or_downgrade_runtime";
  } else if (blockers.includes("flash_visual_rating_slate_scene")) {
    recommendation = "reject_rating_title_and_logo_frames_then_resample_footage";
  } else if (blockers.includes("flash_visual_bad_frame_taste")) {
    recommendation = "resample_trailer_segments_using_prescan_quality_filters";
  } else if (blockers.includes("flash_visual_unvalidated_official_clip_segment")) {
    recommendation = "sample_and_validate_clip_segments_before_flash_render";
  } else if (blockers.includes("flash_visual_clip_start_too_early")) {
    recommendation = "move_clip_anchors_past_rating_and_logo_intro_material";
  } else if (blockers.length > 0) {
    recommendation = "rebuild_visual_plan_before_render";
  } else if (warnings.length > 0) {
    recommendation = "allowed_with_visual_warnings";
  }

  return {
    verdict: blockers.length > 0 ? "block" : "allow",
    blockers,
    warnings,
    recommendation,
    thresholds: {
      minUniqueClipSources60s: MIN_UNIQUE_CLIP_SOURCES_60S,
      maxClipScenesPerSource: MAX_CLIP_SCENES_PER_SOURCE,
      minSafeClipStartS: MIN_SAFE_CLIP_START_S,
      minDistinctSceneBeats60s: MIN_DISTINCT_SCENE_BEATS_60S,
      maxFlashCardRatio: MAX_FLASH_CARD_RATIO,
      maxCoverArtRatio: MAX_COVER_ART_RATIO,
      lowSegmentQualityScore: LOW_SEGMENT_QUALITY_SCORE,
    },
    metrics: {
      runtimeS: Number.isFinite(runtimeS) ? Number(runtimeS.toFixed(3)) : null,
      totalScenes,
      actualClipScenes: actualClipScenes.length,
      uniqueClipSources,
      maxClipScenesPerSource: Math.max(0, ...clipCounts.values()),
      overusedClipSources,
      earlyClipSceneCount: earlyClipScenes.length,
      earlyClipScenes,
      cardScenes: cardScenes.length,
      sourceCardCount: sourceCards.length,
      firstSourceCardIndex,
      cardRatio,
      coverArtScenes: coverArtScenes.length,
      coverArtRatio,
      distinctSceneBeats,
      weakClipSegments,
      unvalidatedOfficialSegments,
      badFrameTasteScenes: rejectedFrameTasteScenes,
      ratingSlateScenes: detectedRatingSlateScenes,
    },
  };
}

module.exports = {
  buildFlashLaneVisualDirector,
  isActualClipScene,
  MIN_UNIQUE_CLIP_SOURCES_60S,
  MAX_CLIP_SCENES_PER_SOURCE,
  MIN_SAFE_CLIP_START_S,
};

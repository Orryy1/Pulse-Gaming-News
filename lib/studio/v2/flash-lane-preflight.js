"use strict";

const { narrationVoiceBlocker } = require("./proof-render-safety");
const {
  buildFlashLaneVisualDirector,
} = require("./flash-lane-visual-director");
const {
  validateFlashLaneOverlayGeometry,
} = require("./flash-lane-overlays");

const FLASH_ACTUAL_CLIP_TYPES = new Set(["clip", "punch", "speed-ramp", "freeze-frame"]);
const FLASH_SUPPORTING_MOTION_TYPES = new Set(["clip.frame"]);
const TARGET_ACTUAL_CLIP_DOMINANCE = 0.55;
const MIN_ACTUAL_CLIP_SCENES = 2;
const MAX_ACTUAL_CLIP_SCENES_PER_REF = 3;
const MAX_CARD_RATIO = 0.35;
const MIN_CARD_HEAVY_STORY_BEAT_OVERLAYS = 2;
const MIN_CARD_HEAVY_UNIQUE_CLIP_SOURCES = 3;
const MIN_CARD_HEAVY_DISTINCT_SCENE_BEATS = 8;
const MIN_FLASH_RUNTIME_S = 61;
const MAX_FLASH_RUNTIME_S = 75;
const MIN_PUBLISHABLE_WPM = 110;
const MIN_TARGET_WPM = 130;
const MAX_TARGET_WPM = 160;
const MAX_PUBLISHABLE_WPM = 180;
const IDEAL_FLASH_WPM_MIN = 140;
const IDEAL_FLASH_WPM_MAX = 155;

function sceneType(scene) {
  return String(scene?.type || scene?.sceneType || "");
}

function isClipBackedOpener(scene) {
  return sceneType(scene) === "opener" && scene?.isClipBacked === true;
}

function isActualClipScene(scene) {
  return FLASH_ACTUAL_CLIP_TYPES.has(sceneType(scene)) || isClipBackedOpener(scene);
}

function isSupportingMotionScene(scene) {
  return FLASH_SUPPORTING_MOTION_TYPES.has(sceneType(scene));
}

function isCardScene(scene) {
  return sceneType(scene).startsWith("card.");
}

function countStoryBeatOverlays(overlayPlan) {
  const timeline = Array.isArray(overlayPlan?.timeline) ? overlayPlan.timeline : [];
  return timeline.filter((item) => item?.kind === "beat_chip").length;
}

function buildFlashLaneNarrationPlan({ scriptWordCount, narrationDurationS } = {}) {
  const wordCount = Number(scriptWordCount);
  const duration = Number(narrationDurationS);
  const targetWordMin = Math.ceil((MIN_FLASH_RUNTIME_S / 60) * IDEAL_FLASH_WPM_MIN);
  const targetWordMax = Math.floor((MAX_FLASH_RUNTIME_S / 60) * IDEAL_FLASH_WPM_MAX);
  const spokenWpm =
    Number.isFinite(wordCount) && wordCount > 0 && Number.isFinite(duration) && duration > 0
      ? Number(((wordCount / duration) * 60).toFixed(1))
      : null;
  const issues = [];
  if (Number.isFinite(wordCount) && wordCount > 0) {
    if (wordCount < targetWordMin) issues.push("script_too_short_for_flash_lane_target");
    if (wordCount > targetWordMax) issues.push("script_too_long_for_flash_lane_target");
  }
  if (Number.isFinite(duration) && duration > 0) {
    if (duration < MIN_FLASH_RUNTIME_S) issues.push("narration_too_short_for_creator_rewards_target");
    if (duration > MAX_FLASH_RUNTIME_S) issues.push("narration_too_long_for_flash_lane");
  }
  if (spokenWpm !== null) {
    if (spokenWpm < MIN_PUBLISHABLE_WPM) issues.push("spoken_pace_too_slow");
    if (spokenWpm > MAX_PUBLISHABLE_WPM) issues.push("spoken_pace_too_fast");
  }

  let recommendation = "script_length_ok_generate_approved_voice";
  if (issues.includes("spoken_pace_too_slow") || issues.includes("spoken_pace_too_fast")) {
    recommendation = "regenerate_narration_at_normal_creator_pace";
  } else if (issues.includes("script_too_short_for_flash_lane_target")) {
    recommendation = "expand_script_before_flash_lane_voice";
  } else if (issues.includes("script_too_long_for_flash_lane_target")) {
    recommendation = "tighten_script_before_flash_lane_voice";
  } else if (issues.includes("narration_too_long_for_flash_lane")) {
    recommendation = "regenerate_or_tighten_voice_before_render";
  } else if (issues.includes("narration_too_short_for_creator_rewards_target")) {
    recommendation = "expand_or_slow_slightly_before_render";
  }

  return {
    targetRuntimeS: [MIN_FLASH_RUNTIME_S, MAX_FLASH_RUNTIME_S],
    idealWpmRange: [IDEAL_FLASH_WPM_MIN, IDEAL_FLASH_WPM_MAX],
    targetWordRange: [targetWordMin, targetWordMax],
    scriptWordCount: Number.isFinite(wordCount) && wordCount > 0 ? wordCount : null,
    narrationDurationS: Number.isFinite(duration) && duration > 0 ? Number(duration.toFixed(3)) : null,
    spokenWpm,
    issues,
    recommendation,
  };
}

function buildFlashLaneProofPreflight({
  narration,
  scenes,
  media,
  overlayPlan,
  scriptWordCount,
  env = process.env,
} = {}) {
  const list = Array.isArray(scenes) ? scenes : [];
  const totalScenes = list.length;
  const actualClipScenes = list.filter(isActualClipScene).length;
  const supportingMotionScenes = list.filter(isSupportingMotionScene).length;
  const cardScenes = list.filter(isCardScene).length;
  const actualClipDominance =
    totalScenes > 0 ? Number((actualClipScenes / totalScenes).toFixed(2)) : 0;
  const motionDominance =
    totalScenes > 0
      ? Number(((actualClipScenes + supportingMotionScenes) / totalScenes).toFixed(2))
      : 0;
  const cardRatio = totalScenes > 0 ? Number((cardScenes / totalScenes).toFixed(2)) : 0;
  const narrationDurationS = Number(narration?.durationS);
  const wordCount = Number(scriptWordCount);
  const narrationPlan = buildFlashLaneNarrationPlan({
    scriptWordCount: wordCount,
    narrationDurationS,
  });
  const spokenWpm =
    Number.isFinite(wordCount) && wordCount > 0 && Number.isFinite(narrationDurationS) && narrationDurationS > 0
      ? Number(((wordCount / narrationDurationS) * 60).toFixed(1))
      : null;
  const availableClipRefs = Array.isArray(media?.clips) ? media.clips.length : 0;
  const availableTrailerFrames = Array.isArray(media?.trailerFrames)
    ? media.trailerFrames.length
    : 0;
  const storyBeatOverlayCount = countStoryBeatOverlays(overlayPlan);
  const overlayGeometry = validateFlashLaneOverlayGeometry({
    overlayPlan,
    scenes: list,
  });

  const blockers = [];
  const warnings = [];
  const visualDirector = buildFlashLaneVisualDirector({
    scenes: list,
    media,
    narrationDurationS,
  });
  const voiceBlocker = narrationVoiceBlocker(narration, env);
  if (voiceBlocker) blockers.push(voiceBlocker);
  if (
    Number.isFinite(narrationDurationS) &&
    (narrationDurationS < MIN_FLASH_RUNTIME_S || narrationDurationS > MAX_FLASH_RUNTIME_S)
  ) {
    blockers.push("flash_lane_runtime_outside_61_to_75_seconds");
  }
  if (spokenWpm !== null) {
    if (spokenWpm < MIN_PUBLISHABLE_WPM || spokenWpm > MAX_PUBLISHABLE_WPM) {
      blockers.push("flash_lane_spoken_wpm_outside_publishable_range");
    } else if (spokenWpm < MIN_TARGET_WPM || spokenWpm > MAX_TARGET_WPM) {
      warnings.push("flash_lane_spoken_wpm_outside_target_range");
    }
  }
  if (availableClipRefs < MIN_ACTUAL_CLIP_SCENES || actualClipScenes < MIN_ACTUAL_CLIP_SCENES) {
    blockers.push("flash_lane_requires_two_actual_clip_scenes");
  }
  if (
    availableClipRefs > 0 &&
    actualClipScenes > availableClipRefs * MAX_ACTUAL_CLIP_SCENES_PER_REF
  ) {
    blockers.push("flash_lane_clip_reuse_too_high");
  }
  if (actualClipDominance < TARGET_ACTUAL_CLIP_DOMINANCE) {
    const exhaustedValidatedClipRefs =
      availableClipRefs > 0 && actualClipScenes >= availableClipRefs;
    const trailerFramesCarryGap =
      exhaustedValidatedClipRefs && supportingMotionScenes >= 3 && motionDominance >= 0.75;
    if (trailerFramesCarryGap) {
      warnings.push("flash_lane_clip_dominance_supported_by_trailer_frames");
    } else {
      blockers.push("flash_lane_clip_dominance_below_target");
    }
  }
  if (supportingMotionScenes === 0 && availableTrailerFrames === 0) {
    warnings.push("flash_lane_has_no_trailer_frame_support");
  }
  if (cardRatio > MAX_CARD_RATIO) {
    warnings.push("flash_lane_card_ratio_high");
    if (storyBeatOverlayCount < MIN_CARD_HEAVY_STORY_BEAT_OVERLAYS) {
      blockers.push("flash_lane_card_ratio_requires_story_beat_coverage");
    }
    const directorMetrics = visualDirector.metrics || {};
    if (
      motionDominance <= 0 ||
      Number(directorMetrics.uniqueClipSources || 0) < MIN_CARD_HEAVY_UNIQUE_CLIP_SOURCES ||
      Number(directorMetrics.distinctSceneBeats || 0) < MIN_CARD_HEAVY_DISTINCT_SCENE_BEATS
    ) {
      blockers.push("flash_lane_card_ratio_requires_motion_diversity");
    }
  }
  if (overlayGeometry.verdict === "block") {
    blockers.push("flash_lane_overlay_geometry_blocked");
  }
  blockers.push(...visualDirector.blockers);
  warnings.push(...visualDirector.warnings);

  return {
    verdict: blockers.length > 0 ? "block" : "allow",
    blockers,
    warnings,
    thresholds: {
      minActualClipScenes: MIN_ACTUAL_CLIP_SCENES,
      maxActualClipScenesPerRef: MAX_ACTUAL_CLIP_SCENES_PER_REF,
      targetActualClipDominance: TARGET_ACTUAL_CLIP_DOMINANCE,
      maxCardRatio: MAX_CARD_RATIO,
      minCardHeavyStoryBeatOverlays: MIN_CARD_HEAVY_STORY_BEAT_OVERLAYS,
      minCardHeavyUniqueClipSources: MIN_CARD_HEAVY_UNIQUE_CLIP_SOURCES,
      minCardHeavyDistinctSceneBeats: MIN_CARD_HEAVY_DISTINCT_SCENE_BEATS,
      minRuntimeS: MIN_FLASH_RUNTIME_S,
      maxRuntimeS: MAX_FLASH_RUNTIME_S,
      minTargetWpm: MIN_TARGET_WPM,
      maxTargetWpm: MAX_TARGET_WPM,
      minPublishableWpm: MIN_PUBLISHABLE_WPM,
      maxPublishableWpm: MAX_PUBLISHABLE_WPM,
    },
    metrics: {
      totalScenes,
      actualClipScenes,
      supportingMotionScenes,
      cardScenes,
      actualClipDominance,
      motionDominance,
      cardRatio,
      narrationDurationS: Number.isFinite(narrationDurationS)
        ? Number(narrationDurationS.toFixed(3))
        : null,
      scriptWordCount: Number.isFinite(wordCount) && wordCount > 0 ? wordCount : null,
      spokenWpm,
      availableClipRefs,
      maxAllowedActualClipScenesFromRefs:
        availableClipRefs > 0 ? availableClipRefs * MAX_ACTUAL_CLIP_SCENES_PER_REF : null,
      availableTrailerFrames,
      storyBeatOverlayCount,
    },
    narrationPlan,
    visualDirector,
    overlayGeometry,
  };
}

function buildFlashLaneProofReadinessSummary({ preflight, overlayPlan, scenes } = {}) {
  const blockers = Array.isArray(preflight?.blockers) ? preflight.blockers : [];
  const warnings = Array.isArray(preflight?.warnings) ? preflight.warnings : [];
  const metrics = preflight?.metrics || {};
  const visualMetrics = preflight?.visualDirector?.metrics || {};
  const thresholds = preflight?.thresholds || {};
  const storyBeatOverlayCount = Number.isFinite(Number(metrics.storyBeatOverlayCount))
    ? Number(metrics.storyBeatOverlayCount)
    : countStoryBeatOverlays(overlayPlan);
  const requiredBeatOverlayMinimum = Number.isFinite(
    Number(thresholds.minCardHeavyStoryBeatOverlays),
  )
    ? Number(thresholds.minCardHeavyStoryBeatOverlays)
    : MIN_CARD_HEAVY_STORY_BEAT_OVERLAYS;
  const motionDominance = Number.isFinite(Number(metrics.motionDominance))
    ? Number(metrics.motionDominance)
    : null;
  const uniqueClipSources = Number.isFinite(Number(visualMetrics.uniqueClipSources))
    ? Number(visualMetrics.uniqueClipSources)
    : null;
  const distinctSceneBeats = Number.isFinite(Number(visualMetrics.distinctSceneBeats))
    ? Number(visualMetrics.distinctSceneBeats)
    : null;
  const cardRatio = Number.isFinite(Number(metrics.cardRatio)) ? Number(metrics.cardRatio) : null;
  const hasPreflight = Boolean(preflight && typeof preflight === "object");
  const cardHeavyWithoutBeatCoverage =
    cardRatio !== null &&
    cardRatio > (Number(thresholds.maxCardRatio) || MAX_CARD_RATIO) &&
    storyBeatOverlayCount < requiredBeatOverlayMinimum;

  let verdict = "review";
  if (preflight?.verdict === "block" || blockers.length > 0) {
    verdict = "blocked";
  } else if (warnings.length === 0 && !cardHeavyWithoutBeatCoverage) {
    verdict = "render_ready";
  }

  const readinessClass =
    verdict === "render_ready" ? "green" : verdict === "blocked" ? "red" : "amber";
  const reasons = [];
  if (!hasPreflight) reasons.push("flash_lane_preflight_not_run");
  if (blockers.length) reasons.push(...blockers);
  if (!blockers.length && warnings.length) reasons.push(...warnings);
  if (!blockers.length && cardHeavyWithoutBeatCoverage) {
    reasons.push("card_heavy_proof_needs_more_story_beat_overlays");
  }
  if (!reasons.length) reasons.push("preflight_passed_with_required_motion_and_overlay_coverage");

  let recommendation = "Ready for local Flash Lane proof render.";
  if (verdict === "blocked") {
    recommendation = "Fix blockers before attempting the local Flash Lane proof render.";
  } else if (verdict === "review") {
    recommendation = "Operator review advised before local proof render.";
  }

  return {
    verdict,
    readinessClass,
    statusColour: readinessClass,
    blockers,
    warnings,
    reasons,
    motionDominance,
    storyBeatOverlayCount,
    requiredBeatOverlayMinimum,
    uniqueClipSources,
    distinctSceneBeats,
    cardRatio,
    sceneCount: Array.isArray(scenes)
      ? scenes.length
      : Number.isFinite(Number(metrics.totalScenes))
        ? Number(metrics.totalScenes)
        : null,
    recommendation,
  };
}

function assertFlashLaneProofReady(args = {}, opts = {}) {
  const report = buildFlashLaneProofPreflight(args);
  if (report.verdict === "allow" || opts.allowDiagnosticRender === true) return report;
  throw new Error(`Flash Lane proof preflight blocked render: ${report.blockers.join(", ")}`);
}

module.exports = {
  assertFlashLaneProofReady,
  buildFlashLaneNarrationPlan,
  buildFlashLaneProofPreflight,
  buildFlashLaneProofReadinessSummary,
  isActualClipScene,
};
